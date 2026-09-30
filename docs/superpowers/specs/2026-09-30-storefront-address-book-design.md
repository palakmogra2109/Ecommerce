# Storefront Address Book & Delivery Location — Design

**Date:** 2026-09-30
**Status:** Approved in chat; pending spec review
**Scope:** Give the customer storefront a real, per-user saved-address book, a
"deliver to" location chip in the header, current-location detection, and
address search — scoped to the address/location UI only. The catalog grid, hero,
banner and footer are not redesigned.

---

## 1. Context and decisions

### 1.1 What exists today

| Piece | State |
|---|---|
| `frontend/src/pages/Storefront.jsx` | 1594 lines, 9 views, one file |
| Saved addresses | `localStorage["sf_addresses"]` — one shared key, **not per user** |
| `backend/app/api/store/addresses/` | exists on disk, **empty** |
| Store selector | calls `/api/branches`, which needs `branches.view` |
| Catalog location scoping | `lib/storeCatalogScope.js` accepts `pincode`/`lat`/`lng` |
| Geocoding | none anywhere; no API keys in `.env.local` |

### 1.2 The load-bearing discoveries

**(a) The storefront branch list is broken for real shoppers.**
`services/storefront.js:90` calls `getStoreBranches()` → `/api/branches`, whose
GET is guarded by `authorize(KEY_PERMISSIONS.BRANCHES_VIEW)`
(`backend/app/api/branches/route.js:17`). Storefront logins are rows in
`users` with no roles, so `hasPermission` is false and the call returns 403.
The "Deliver from" dropdown therefore only populates for someone who also
happens to hold a staff role. This is fixed as part of this work.

**(b) `customers.address` cannot hold the address book.**
`CustomerView.jsx:82` reads it as a single object (`addr.line1`, `addr.city`,
`addr.state`, `addr.postal`, `addr.country`) and
`backend/app/api/customers/[id]/route.js:112` passes `body.address` straight to
`Customer.update`, which does `JSON.stringify(updates.address)` — replacing the
entire column. Storing an array there would mean an admin saving a customer
silently destroys the shopper's address book. The admin form also keys the
postal field as `postal`, not `postalCode`.

**(c) There is no link from `users` to `customers`.**
`customers` has no `user_id` column. The only common key is `email`, which is
`UNIQUE` on both tables. The storefront login path (`/api/auth/register`,
`/api/auth/login`) never creates a `customers` row; only the admin
`/api/customers` route does.

### 1.3 Decisions taken (approved by the user)

1. **Store the address book as JSONB on the customer row** — a new
   `customers.addresses JSONB NOT NULL DEFAULT '[]'` column. No new address
   table. (Corrects an earlier chat claim of "no migration": this needs one
   1-line migration.)
2. **Resolve the customer row by email**, creating it on demand on first save.
3. **OpenStreetMap Nominatim** for address search and reverse geocoding — no
   API key. Proxied through the backend, cached and throttled.
4. **The chosen address scopes browsing** — its pincode/lat/lng feed the
   existing catalog scope and the branch list.
5. **Legacy localStorage addresses are claimed on first login**, then cleared.
6. **Redesign the address/location UI only**; leave the rest of the storefront.
7. **"Deliver to" (address) and "Deliver from" (store) both stay**, explicitly
   labelled with distinct icons — pin vs bag — so the pair does not blur.

---

## 2. Data model

### 2.1 The column

`sql/migrations/002-customer-addresses.sql`, mirrored into `sql/schema.sql`:

```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS addresses JSONB NOT NULL DEFAULT '[]';
```

`customers.address` is untouched and keeps its single-address meaning.

### 2.2 The address object

```js
{
  id:          "uuid",          // crypto.randomUUID()
  label:       "Home",
  recipient:   "Anita Sharma",
  phone:       "9876543210",
  line1:       "12, Nehru Road",
  line2:       "Near Post Office",
  landmark:    "",
  city:        "Pune",
  state:       "Maharashtra",
  country:     "India",
  postalCode:  "411001",
  latitude:    18.5204,         // nullable
  longitude:   73.8567,         // nullable
  isDefault:   true,
  source:      "manual",        // "manual" | "geolocation" | "claimed"
  createdAt:   "2026-09-30T…",
  updatedAt:   "2026-09-30T…"
}
```

Rules:

- **Cap of 10** addresses per customer. An 11th save returns 400 with
  "You can save up to 10 addresses. Delete one to add another." This bounds
  JSONB growth and keeps the picker usable.
- **At most one default.** The first address ever saved is forced default.
  A set-default write clears siblings in the same round trip.
- **Addresses are only deletable, never orphaned** — nothing references an
  address by id, so `DELETE` just removes the entry.

### 2.3 What B gives up, stated plainly

There is no partial unique index backing "exactly one default" and no foreign
key from `orders` to an address. Both are enforced in application code inside a
transaction (§4.2). This is the accepted cost of not having a table.

---

## 3. API surface

### 3.1 Address book — `/api/store/addresses`

All four guarded by `authenticate()` (plain logged-in; **not**
`requireBranchAccess` — shoppers have no branch role and no `x-branch-id`).
All resolve the customer by the authenticated user's email.

| Route | Body / query | Returns |
|---|---|---|
| `GET` | — | `{ success, addresses: [...] }` |
| `POST` | one address object | `{ success, addresses }` (full book; simple for the client) |
| `POST` | `{ claim: [ ...legacy ] }` | `{ success, addresses, claimed: n }` |
| `PATCH` | `{ id, ...fields }` | `{ success, addresses }` |
| `DELETE` | `{ id }` | `{ success, addresses }` |

No `/[uuid]` route: there is no address table, so the address book is the
resource and the id travels in the body. A fake REST path would imply a row
that does not exist.

Every mutation returns the whole book rather than one address. The client then
never has to reconcile optimistic state against server truth.

### 3.2 Public branch list — `/api/store/branches?pincode=&lat=&lng=`

Replaces the storefront's call to `/api/branches`. Returns ACTIVE,
`deliveryenabled` branches serving the given location. No auth — the catalog is
public.

The postalcode-prefix and lat/lng bounding-box predicates move out of
`buildBranchScope` into two exported helpers in `lib/storeCatalogScope.js`, so
the product catalog and the branch list share **one** definition of "serves
this location" instead of drifting apart.

### 3.3 Geocoding — `/api/store/geocode/{search,reverse}`

| Route | Query | Nominatim call |
|---|---|---|
| `/api/store/geocode/search` | `q` (min 3 chars) | `/search?format=jsonv2&countrycodes=in&limit=5&addressdetails=1` |
| `/api/store/geocode/reverse` | `lat`, `lng` | `/reverse?format=jsonv2&lat=…&lon=…&zoom=18` |

Proxied so the browser never calls Nominatim directly and the cache and
throttle are enforced in one place.

**Cache + throttle** (`lib/geocode.js`): in-memory `Map`, TTL 10 min for
search and 30 min for reverse, plus a minimum 1 s gap between outbound calls.
Nominatim's public usage policy requires both; the throttle is a per-process
serialiser, which is correct for this single-instance deployment and is called
out in a comment as the thing to revisit if this is ever scaled out.

Response shaping: Nominatim returns nested `address` parts. The helper maps
`house_number`/`road`/`suburb`/`neighbourhood` → `line1`/`line2`, `city`/
`town`/`village`/`municipality` → `city`, `state` → `state`, `postcode` →
`postalCode`, and keeps `lat`/`lon`.

### 3.4 Errors

Every route returns `{ success: false, message }` with CORS headers, matching
the existing store routes. 400 validation, 401 unauthenticated, 404 unknown
address id, 500 unexpected.

---

## 4. Backend design

### 4.1 `lib/models/address.js`

Pure, synchronous helpers — no pool — so they are unit-testable in the style of
`lib/__tests__/storeCatalogScope.test.mjs`:

- `normalizeAddress(input, { now })` → a clean, capped, string-only address or
  `null` if the required fields (`line1`, `city`, `state`, `postalCode`) are
  missing. Phone is normalised via the existing `lib/phone.js`.
- `applyUpsert(book, address, { now })` → returns `{ book, error }`; enforces the
  10-cap and the single-default invariant.
- `applyDelete(book, id)`.
- `normalizeBook(raw)` → non-array `raw` becomes `[]`, so any future hand-edited
  row cannot crash the reader.

Pool-backed methods: `Customer.getAddressBookByEmail(email)`,
`Customer.upsertAddressByEmail(email, ...)`,
`Customer.patchAddressByEmail(email, id, fields)`,
`Customer.deleteAddressByEmail(email, id)`.

### 4.2 Concurrency — the main hazard of a JSONB book

Two browser tabs saving at once would clobber each other. Every mutation runs:

```sql
BEGIN;
SELECT id, addresses FROM customers WHERE email = $1 FOR UPDATE;
  -- mutate the array in JS
UPDATE customers SET addresses = $2, updated_at = now() WHERE id = $3;
COMMIT;
```

`FOR UPDATE` serialises concurrent writers in Postgres. Without it this is
last-write-wins and a shopper loses an address.

### 4.3 On-demand customer creation race

Two tabs can both find no `customers` row and both insert. `email` is `UNIQUE`,
so the loser gets `23505`. The model catches that specific code, re-selects the
winning row, and proceeds — rather than surfacing a 500.

---

## 5. Frontend design

### 5.1 New files

| File | Role |
|---|---|
| `src/hooks/useAddressBook.js` | list / add / patch / delete, current selection, claim-on-login |
| `src/components/storefront/LocationChip.jsx` | header pill |
| `src/components/storefront/AddressBookModal.jsx` | the picker |
| `src/components/storefront/AddressForm.jsx` | add / edit form |

### 5.2 Header layout

```
brand · LocationChip · Track · ——— · Cart · Deliver-from · Account
```

`LocationChip`: `<FiMapPin/>`, a small "Deliver to" label over a bold short form
(`Home · Pune`, or `Add location` when unset). Truncates to icon + city below
~640 px.

The header now carries both **Deliver to** (address) and **Deliver from**
(store). They are different things and both are kept; they are labelled
explicitly and use distinct icons so the pair does not read as a duplicate.

### 5.3 Why a modal, not a header dropdown

Ten addresses plus a search field plus an autocomplete popup will not fit in a
header dropdown without z-index and focus-trap problems. The modal is the same
pattern used for this exact flow elsewhere in retail. It escapes the header's
stacking context entirely.

### 5.4 `AddressBookModal`

- Search-as-you-type across **saved addresses and** Nominatim suggestions
  (debounced 350 ms, min 3 chars, in-flight requests aborted on keystroke).
- Saved-address rows: radio selection, `Home` chip, `Default` tag, two-line
  address, phone, edit and delete icon buttons.
- Ghost footer button **"Use my current location"** with a crosshair icon and an
  inline spinner while locating.
- Empty state: "Add your first address".
- Picking an address closes the modal, refetches the catalog with that address's
  `pincode`/`lat`/`lng`, and toasts `Delivering to Home · Pune — 3 stores`.

### 5.5 `AddressForm`

Used in the modal *and* full-page behind the existing "Saved addresses" menu
entry, so there is one form.

- Search field at the top when creating; picking a suggestion fills
  city/state/postalCode and the hidden lat/lng.
- Fields: label (Home / Work / Other), full name, phone (reusing the existing
  `components/PhoneInput.jsx`), house/street, area/locality, landmark, city,
  state, country (fixed "India"), pincode (6-digit numeric).
- "Save as default", auto-checked when it is the only address.
- Client-side validation, then server-side validation; server messages render
  against the field they belong to.

### 5.6 State ownership

`useAddressBook` owns the list and the current selection. **The book is server
truth.** Only the selected *id* is mirrored to `localStorage` under
`sf_current_address_<userId>`, so the chip paints instantly before the fetch
lands and so two accounts on one browser never share a selection.

### 5.7 Claim on first login

On successful login: if `sf_addresses` exists **and** the server book came back
empty, POST `{ claim: [...] }`, then remove the old key. One-time. If the claim
fails the shopper still lands on a working, empty address book — a failed
migration is never a failed login.

### 5.8 Checkout

`CheckoutForm`'s existing saved-address strip now reads `useAddressBook`
instead of `localStorage`. Selecting an address fills recipient and phone as
well as the address fields.

**The address book is never a hard dependency of checkout.** Orders snapshot
`shipping_address` JSONB already; the book is a convenience that fills the
form. If it fails to load, the shopper types their address and checkout
proceeds. This is a stated property, not an accident.

### 5.9 `services/storefront.js`

Adds `getAddresses`, `createAddress`, `claimAddresses`, `updateAddress`,
`deleteAddress`, `geocodeSearch`, `geocodeReverse`. `getStoreBranches` repoints
to `/store/branches`. `getStoreProducts` gains `pincode`, `lat`, `lng`.

---

## 6. Failure modes

| Case | Behaviour |
|---|---|
| Geolocation denied or unavailable | Toast "Location permission denied — add your address manually". The form stays open. Never a dead end. |
| Geolocation on an insecure origin | Blocked by the browser except on `localhost`. Dev on `localhost:5174` works; opening the dev server over a LAN IP will not. |
| Nominatim unreachable or 403-throttled | "Location search is temporarily unavailable" — **distinct from "no results"**. Manual entry unaffected either way. |
| Address book fetch fails | Last successful book from `useAddressBook` state stays rendered; checkout unaffected. |
| 401 from any address route | Route to the login panel with `postLoginView` set to the address view. |
| 11th address | 400, surfaced against the form. |
| Offline | Cached book renders; new saves fail with a clear message. |

---

## 7. Testing

**Backend — `node --test`, pure functions, no DB** (matching
`lib/__tests__/storeCatalogScope.test.mjs`):

- `normalizeAddress` — missing required fields, phone normalisation, trimming,
  non-string coercion
- `applyUpsert` — first save forced default; set-default clears siblings; 10-cap
  rejects; ids are stable across updates
- `applyDelete` — removes by id, ignores unknown ids
- `normalizeBook` — object and `null` inputs become `[]`
- geocode helpers — response mapping and cache TTL/expiry behaviour

**Frontend — there is no test runner** in this project, only `oxlint` and
`vite build`. Verification is `npm run lint`, `npm run build`, and a manual pass
over: claim-on-login, add / edit / delete / set-default, current-location,
search, checkout prefill, and catalog re-scoping. This is stated here rather
than implied as coverage that does not exist.

**Migration — verified against the live database**, which has real customer
data. The migration is additive only.

---

## 8. Out of scope

- Redesigning the catalog grid, hero, banner, cart, or footer
- Address edit from the admin customer form
- A real map view or map-based address picker
- Server-side validation of phone numbers as deliverable (phone is normalised,
  not verified)
- Per-customer cap configuration
- Caching Nominatim results across process restarts

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Whole-array writes lose an address under concurrency | `SELECT … FOR UPDATE` on the customer row inside a transaction (§4.2) |
| Storing the book in `customers.address` corrupts the admin form | The separate `addresses` column (§1.2b) |
| Nominatim's public instance rate-limits or blocks the server | 1 s throttle, TTL cache, distinct error copy (§3.3) |
| Email is the only link from `users` to `customers` | Documented; `email` is `UNIQUE` on both tables (§1.2c) |
| Two tabs race to create the customer row | `23505` caught, row re-selected (§4.3) |
