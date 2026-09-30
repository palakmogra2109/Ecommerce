# Storefront Address Book and Delivery Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user storefront address book, header delivery-location picker, current-location detection, address search, and location-aware catalog/store results.

**Architecture:** Persist up to ten normalized addresses in a new additive `customers.addresses` JSONB column, expose them through authenticated `/api/store` routes, proxy Nominatim through the backend, and integrate a reusable frontend address-book hook, modal, form, styles, checkout prefill, and catalog/store scoping.

**Tech Stack:** Next.js 16 App Router, raw `pg`, Node test runner, React 19, Vite, OpenStreetMap Nominatim.

**Spec:** `docs/superpowers/specs/2026-09-30-storefront-address-book-design.md`

## Global Constraints

- Do not alter, remove, or write through the legacy single-address `customers.address` column while implementing the address book.
- The live database contains real customer data; every SQL migration must be additive and idempotent.
- Tables with unquoted camelCase DDL remain folded lowercase in SQL; continue using `postalcode`, `deliveryenabled`, `branchid`, `createdat`, and `updatedat` where applicable.
- Use plain logged-in `authenticate()` for shopper address routes; do not require branch access or a branch role.
- Nominatim access must remain backend-proxied, India-scoped, cached, and throttled.
- The address book must never become a hard dependency for checkout submission or order placement.
- Storefront checkout still accepts manually entered addresses when the address service is unavailable.
- Preserve browser compatibility with both the admin-mounted storefront and the standalone storefront entry point.

## Review Focus

- Two tabs saving addresses simultaneously must not silently lose an address; concurrent writers must serialize through a locked customer row.
- An admin editing a legacy customer address must not overwrite, delete, or corrupt the new address book.
- Logged-out browsing must remain possible while saving, editing, deleting, and claiming addresses still require login.
- A Nominatim timeout, HTTP error, or throttling response must leave manual address entry and checkout fully usable.
- Selecting, adding, or geolocating an address must not send `NaN`, empty coordinates, malformed pincodes, or unvalidated server-trusted locations to catalog, branch, order, or geocode APIs.

---

## File structure

- `backend/sql/migrations/002-customer-addresses.sql`
  - Adds `customers.addresses JSONB NOT NULL DEFAULT '[]'`.
- `backend/sql/schema.sql`
  - Mirrors the new `addresses` column and documents that `address` remains legacy.
- `backend/lib/addressBook.js`
  - Pure normalization, validation, default-address, cap, claim, update, deletion, Nominatim-response mapping, and throttle/cache policy logic.
- `backend/lib/__tests__/addressBook.test.mjs`
  - Pure unit tests with no database or network access.
- `backend/lib/models/customer.js`
  - Adds transactional address-book reads/writes and safe on-demand customer creation by email.
- `backend/app/api/store/addresses/route.js`
  - Authenticated collection endpoint for GET, POST, PATCH, and DELETE.
- `backend/lib/storeCatalogScope.js`
  - Shares pincode and coordinate predicates between products and branches.
- `backend/lib/__tests__/storeCatalogScope.test.mjs`
  - Extended with branch-column location coverage while retaining all existing product behavior.
- `backend/lib/models/branch.js`
  - Adds location-aware public branch search without changing admin `Branch.list`.
- `backend/app/api/store/branches/route.js`
  - Public `ACTIVE`, delivery-enabled store endpoint supporting pincode and coordinates.
- `backend/lib/geocode.js`
  - Nominatim client, TTL cache, minimum request interval, response shaping, and error classification.
- `backend/lib/__tests__/geocode.test.mjs`
  - Tests mapping, caching, throttling, and upstream failures with injected fetch/time functions.
- `backend/app/api/store/geocode/search/route.js`
  - Public query-based autocomplete proxy.
- `backend/app/api/store/geocode/reverse/route.js`
  - Public coordinate-based reverse-geocode proxy.
- `frontend/src/services/storefront.js`
  - Adds address, branch-location, and geocode client functions.
- `frontend/src/hooks/useAddressBook.js`
  - Owns server address state, selection, claim migration, and Nominatim request behavior.
- `frontend/src/components/storefront/LocationChip.jsx`
  - Header delivery-location button.
- `frontend/src/components/storefront/AddressBookModal.jsx`
  - Address selection, search, current-location, add/edit entry, deletion, and default controls.
- `frontend/src/components/storefront/AddressForm.jsx`
  - Shared modal and full-page address-entry interface.
- `frontend/src/styles/Storefront.css`
  - Adds only address/location components and responsive behavior using the existing V2 tokens.
- `frontend/src/pages/Storefront.jsx`
  - Integrates the chip, modal, full-page address book, checkout prefill, catalog/store location, and claim-on-login.

### Task 1: Persist the address-book column safely

**Files:**
- Create: `backend/sql/migrations/002-customer-addresses.sql`
- Modify: `backend/sql/schema.sql`

**Interfaces:**
- Consumes: Existing `customers` table and `backend/scripts/migrate.mjs` filename-ordered migration behavior.
- Produces: Guaranteed `customers.addresses JSONB NOT NULL DEFAULT '[]'` on migrated and fresh databases.

- [ ] **Step 1: Write the migration and schema documentation.**

```sql
-- Additive customer address-book storage.
--
-- The legacy customers.address column remains a single-address object used by
-- the admin customer form. customers.addresses is the storefront's saved
-- address array. Nothing in this migration modifies existing values.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS addresses JSONB NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Mirror the column in the fresh-install schema.**

Add this immediately after the existing `address JSONB NOT NULL DEFAULT '{}'` definition in the `customers` table:

```sql
  addresses      JSONB NOT NULL DEFAULT '[]',
```

Also add the following migration-style statement near the existing customers `ALTER TABLE` compatibility block:

```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS addresses JSONB NOT NULL DEFAULT '[]';
```

- [ ] **Step 3: Inspect the migration for destructive statements.**

Run:

```bash
grep -n -i -E "drop |truncate |delete from|update customers|alter table customers drop|alter table customers alter" backend/sql/migrations/002-customer-addresses.sql backend/sql/schema.sql
```

Expected: No matches in the newly added address-book lines. Do not alter unrelated schema matches without a separate task.

- [ ] **Step 4: Commit.**

```bash
git add backend/sql/migrations/002-customer-addresses.sql backend/sql/schema.sql
git commit -m "feat: add additive customer address-book column"
```

### Task 2: Implement pure address-book rules and unit tests

**Files:**
- Create: `backend/lib/addressBook.js`
- Create: `backend/lib/__tests__/addressBook.test.mjs`

**Interfaces:**
- Consumes: Raw address input, stored JSONB arrays, legacy localStorage claimed arrays, and Nominatim JSON.
- Produces:
  - `normalizeAddressBook(raw): SavedAddress[]`
  - `validateAddressInput(input: unknown): { address?: NewAddressFields; errors?: Record<string,string> }`
  - `createAddressEntry(book: SavedAddress[], input: unknown, now?: string): { address?: SavedAddress; error?: string }`
  - `updateAddressEntry(book: SavedAddress[], id: string, patch: unknown): { addresses?: SavedAddress[]; error?: string }`
  - `deleteAddressEntry(book: SavedAddress[], id: string): SavedAddress[]`
  - `validateClaimedAddress(raw: unknown, fallback?: { name?: string; phone?: string }): { address?: SavedAddressFields; errors?: Record<string,string> }`
  - `mergeClaimedAddresses(book: SavedAddress[], claimed: unknown, now?: string, fallback?: { name?: string; phone?: string }): { addresses: SavedAddress[]; claimed: number }`
  - `MAX_SAVED_ADDRESSES = 10`

`NewAddressFields` is `SavedAddress` without `id`, `createdAt`, or `updatedAt`. `ClaimedAddressFields` is `NewAddressFields` without `isDefault`, because the merge function assigns default status itself.

`SavedAddress` has this exact shape:

```js
{
  id: "uuid",
  label: "Home",
  recipient: "Anita Sharma",
  phone: "9876543210",
  line1: "12, Nehru Road",
  line2: "Near Post Office",
  landmark: "",
  city: "Pune",
  state: "Maharashtra",
  country: "India",
  postalCode: "411001",
  latitude: 18.5204,
  longitude: 73.8567,
  isDefault: true,
  source: "manual",
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z"
}
```

- [ ] **Step 1: Write failing pure-function tests.**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SAVED_ADDRESSES,
  createAddressEntry,
  deleteAddressEntry,
  mergeClaimedAddresses,
  normalizeAddressBook,
  updateAddressEntry,
  validateAddressInput,
} from "../addressBook.js";

const valid = {
  label: "Home",
  recipient: "Anita Sharma",
  phone: "9876543210",
  line1: "12, Nehru Road",
  line2: "Near Post Office",
  landmark: "Opposite park",
  city: "Pune",
  state: "Maharashtra",
  country: "India",
  postalCode: "411001",
  latitude: 18.5204,
  longitude: 73.8567,
  source: "manual",
};

test("legacy non-array storage becomes an empty address book", () => {
  assert.deepEqual(normalizeAddressBook({}), []);
  assert.deepEqual(normalizeAddressBook(null), []);
});

test("the first saved address is forced to default", () => {
  const { address, error } = createAddressEntry([], valid, "2026-09-30T00:00:00.000Z");
  assert.equal(error, undefined);
  assert.equal(address.isDefault, true);
  assert.equal(typeof address.id, "string");
});

test("the book rejects an eleventh address", () => {
  const book = Array.from({ length: MAX_SAVED_ADDRESSES }, (_, index) => ({
    ...valid,
    id: `address-${index + 1}`,
    isDefault: index === 0,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  }));
  const result = createAddressEntry(book, valid);
  assert.match(result.error, /up to 10 addresses/);
});

test("setting a default clears the old default", () => {
  const first = createAddressEntry([], valid).address;
  const second = createAddressEntry([first], { ...valid, label: "Work" }).address;
  const { addresses, error } = updateAddressEntry([first, second], second.id, { isDefault: true });
  assert.equal(error, undefined);
  assert.deepEqual(addresses.map((entry) => entry.isDefault), [false, true]);
});

test("deleting the default promotes the next remaining address", () => {
  const first = createAddressEntry([], valid).address;
  const second = createAddressEntry([first], { ...valid, label: "Work" }).address;
  const addresses = deleteAddressEntry([first, second], first.id);
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].id, second.id);
  assert.equal(addresses[0].isDefault, true);
});

test("legacy geography-only records are claimed with the account fallback", () => {
  const claimed = [
    { address: "12, Nehru Road", city: "Pune", state: "Maharashtra", pincode: "411001" },
    { line1: "", city: "Pune", state: "Maharashtra", postalCode: "411001" },
  ];
  const result = mergeClaimedAddresses([], claimed, "2026-09-30T00:00:00.000Z", { name: "Anita Sharma" });
  assert.equal(result.claimed, 1);
  assert.equal(result.addresses.length, 1);
  assert.equal(result.addresses[0].source, "claimed");
  assert.equal(result.addresses[0].postalCode, "411001");
  assert.equal(result.addresses[0].recipient, "Anita Sharma");
});

test("address pincode and phone validation reject malformed values", () => {
  const result = validateAddressInput({ ...valid, postalCode: "4110", phone: "123" });
  assert.equal(result.address, undefined);
  assert.equal(result.errors.postalCode, "Enter a 6-digit pincode.");
  assert.equal(result.errors.phone, "Enter a 10-digit mobile number.");
});
```

- [ ] **Step 2: Run the new test and verify it fails because the module is absent.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm test -- lib/__tests__/addressBook.test.mjs
```

Expected: FAIL with `Cannot find module '../addressBook.js'`.

- [ ] **Step 3: Implement the minimal pure address-book module.**

```js
import { randomUUID } from "node:crypto";
import { validateMobile } from "./phone.js";

export const MAX_SAVED_ADDRESSES = 10;
const REQUIRED_FIELDS = ["line1", "city", "state", "postalCode"];
const ADDRESS_SOURCES = new Set(["manual", "geolocation", "claimed"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value, max = 200) {
  return text(value).slice(0, max);
}

function coordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeAddressBook(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry) => entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.length > 0
  );
}

export function validateAddressInput(input = {}) {
  const source = text(input.source) || "manual";
  const candidate = {
    label: optionalText(input.label, 40) || "Home",
    recipient: optionalText(input.recipient, 120),
    phone: text(input.phone).replace(/\D/g, "").slice(-10),
    line1: optionalText(input.line1),
    line2: optionalText(input.line2),
    landmark: optionalText(input.landmark),
    city: optionalText(input.city, 120),
    state: optionalText(input.state, 120),
    country: optionalText(input.country, 120) || "India",
    postalCode: text(input.postalCode).replace(/\D/g, ""),
    latitude: coordinate(input.latitude),
    longitude: coordinate(input.longitude),
    isDefault: input.isDefault === true,
    source: ADDRESS_SOURCES.has(source) ? source : "manual",
  };
  const errors = {};
  if (!candidate.recipient) errors.recipient = "Enter the recipient name.";
  if (!candidate.line1) errors.line1 = "Enter house, street, or area.";
  if (!candidate.city) errors.city = "Enter city.";
  if (!candidate.state) errors.state = "Enter state.";
  if (!/^\d{6}$/.test(candidate.postalCode)) errors.postalCode = "Enter a 6-digit pincode.";
  if (validateMobile(candidate.phone).ok !== true) errors.phone = "Enter a 10-digit mobile number.";
  if (Object.keys(errors).length > 0) return { errors };
  for (const field of REQUIRED_FIELDS) {
    if (!candidate[field]) return { errors: { [field]: "This field is required." } };
  }
  return { address: candidate };
}

function stamp(entry, now) {
  return { ...entry, createdAt: entry.createdAt || now, updatedAt: now };
}

export function createAddressEntry(book, input, now = new Date().toISOString()) {
  const existing = normalizeAddressBook(book);
  if (existing.length >= MAX_SAVED_ADDRESSES) {
    return { error: "You can save up to 10 addresses. Delete one to add another." };
  }
  const { address, errors } = validateAddressInput(input);
  if (errors) return { error: "Enter a complete address.", errors };
  return {
    address: stamp(
      {
        ...address,
        id: randomUUID(),
        isDefault: existing.length === 0 ? true : address.isDefault,
      },
      now
    ),
  };
}

function applySingleDefault(book) {
  let found = false;
  return book.map((entry) => {
    if (entry.isDefault && !found) {
      found = true;
      return entry;
    }
    return { ...entry, isDefault: false };
  });
}

export function updateAddressEntry(book, id, patch = {}) {
  const existing = normalizeAddressBook(book);
  const target = existing.find((entry) => entry.id === id);
  if (!target) return { error: "Address not found." };
  const merged = { ...target, ...patch, id: target.id };
  const { address, errors } = validateAddressInput(merged);
  if (errors) return { error: "Enter a complete address.", errors };
  const updated = existing.map((entry) =>
    entry.id === id
      ? stamp({ ...address, id, createdAt: entry.createdAt }, new Date().toISOString())
      : entry
  );
  const withDefault = updated.some((entry) => entry.isDefault)
    ? updated
    : updated.map((entry, index) => ({ ...entry, isDefault: index === 0 }));
  return { addresses: applySingleDefault(withDefault) };
}

export function deleteAddressEntry(book, id) {
  const remaining = normalizeAddressBook(book).filter((entry) => entry.id !== id);
  if (remaining.length === 0) return [];
  if (remaining.some((entry) => entry.isDefault)) return applySingleDefault(remaining);
  return remaining.map((entry, index) => ({ ...entry, isDefault: index === 0 }));
}

export function validateClaimedAddress(raw = {}, fallback = {}) {
  const legacy = raw && typeof raw === "object" ? raw : {};
  const phoneDigits = text(legacy.phone || legacy.mobile || fallback.phone).replace(/\D/g, "").slice(-10);
  const candidate = {
    label: optionalText(legacy.label, 40) || "Home",
    recipient: optionalText(legacy.recipient || legacy.name || fallback.name, 120) || "Saved address",
    phone: phoneDigits,
    line1: optionalText(legacy.line1 || legacy.address),
    line2: optionalText(legacy.line2),
    landmark: optionalText(legacy.landmark),
    city: optionalText(legacy.city, 120),
    state: optionalText(legacy.state, 120),
    country: optionalText(legacy.country, 120) || "India",
    postalCode: text(legacy.postalCode || legacy.pincode).replace(/\D/g, ""),
    latitude: coordinate(legacy.latitude),
    longitude: coordinate(legacy.longitude),
    source: "claimed",
  };
  const errors = {};
  if (!candidate.line1) errors.line1 = "Enter house, street, or area.";
  if (!candidate.city) errors.city = "Enter city.";
  if (!candidate.state) errors.state = "Enter state.";
  if (!/^\d{6}$/.test(candidate.postalCode)) errors.postalCode = "Enter a 6-digit pincode.";
  if (candidate.phone && validateMobile(candidate.phone).ok !== true) errors.phone = "Enter a 10-digit mobile number.";
  if (Object.keys(errors).length > 0) return { errors };
  return { address: candidate };
}

export function mergeClaimedAddresses(book, claimed, now = new Date().toISOString(), fallback = {}) {
  const merged = normalizeAddressBook(book);
  if (!Array.isArray(claimed)) return { addresses: merged, claimed: 0 };
  let claimedCount = 0;
  for (const raw of claimed) {
    if (merged.length >= MAX_SAVED_ADDRESSES) break;
    const { address, errors } = validateClaimedAddress(raw, fallback);
    if (errors) continue;
    merged.push(
      stamp(
        { ...address, id: randomUUID(), isDefault: merged.length === 0 },
        now
      )
    );
    claimedCount += 1;
  }
  return { addresses: applySingleDefault(merged), claimed: claimedCount };
}
```

- [ ] **Step 4: Run the address-book tests.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm test -- lib/__tests__/addressBook.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/lib/addressBook.js backend/lib/__tests__/addressBook.test.mjs
git commit -m "feat: add pure customer address-book rules and tests"
```

### Task 3: Add transactional customer address-book persistence

**Files:**
- Modify: `backend/lib/models/customer.js`

**Interfaces:**
- Consumes: `normalizeAddressBook` and related helpers from `backend/lib/addressBook.js`.
- Produces:
  - `Customer.getAddressBookByEmail(email: string): Promise<SavedAddress[]>`
  - `Customer.mutateAddressBookByEmail(email: string, mutate: (existing: SavedAddress[], context: { mobile: string | null }) => { addresses?: SavedAddress[]; claimed?: number; error?: string; errors?: Record<string,string>; status?: number }, identity?: { name?: string }): Promise<{ addresses?: SavedAddress[]; claimed?: number; error?: string; errors?: Record<string,string>; status?: number }>`
  - The mutation callback runs only after `SELECT ... FOR UPDATE`, so concurrent browser tabs cannot read stale books, calculate divergent arrays, and overwrite each other.

- [ ] **Step 1: Extend the customer model without touching `customers.address`.**

Add `getAddressBookByEmail` and `mutateAddressBookByEmail` after `findByEmail`:

```js
async getAddressBookByEmail(email) {
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  if (!normalizedEmail) return [];
  const result = await pool.query(
    `SELECT addresses FROM ${TABLE} WHERE email = $1`,
    [normalizedEmail]
  );
  return normalizeAddressBook(result.rows[0]?.addresses);
},

async mutateAddressBookByEmail(email, mutate, identity = {}) {
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  if (!normalizedEmail) throw new Error("A customer email is required");
  if (typeof mutate !== "function") throw new Error("An address-book mutation is required");
  const name = (identity.name ?? "").trim() || normalizedEmail;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let row = (
      await client.query(
        `SELECT id, mobile, addresses FROM ${TABLE} WHERE email = $1 FOR UPDATE`,
        [normalizedEmail]
      )
    ).rows[0];
    if (!row) {
      try {
        row = (
          await client.query(
            `INSERT INTO ${TABLE} (name, email, mobile, address, addresses, status)
             VALUES ($1, $2, NULL, '{}', '[]', 'ACTIVE')
             RETURNING id, mobile, addresses`,
            [name, normalizedEmail]
          )
        ).rows[0];
      } catch (error) {
        if (error?.code !== "23505") throw error;
        row = (
          await client.query(
            `SELECT id, mobile, addresses FROM ${TABLE} WHERE email = $1 FOR UPDATE`,
            [normalizedEmail]
          )
        ).rows[0];
      }
    }
    const mutation = await mutate(normalizeAddressBook(row?.addresses), { mobile: row?.mobile ?? null });
    if (!mutation || mutation.error || !Array.isArray(mutation.addresses)) {
      await client.query("ROLLBACK");
      return mutation && mutation.error ? mutation : { error: "Could not save this address." };
    }
    const saved = (
      await client.query(
        `UPDATE ${TABLE}
         SET addresses = $1::jsonb, updated_at = now()
         WHERE id = $2
         RETURNING addresses`,
        [JSON.stringify(normalizeAddressBook(mutation.addresses)), row.id]
      )
    ).rows[0];
    await client.query("COMMIT");
    return { ...mutation, addresses: normalizeAddressBook(saved?.addresses) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
},
```

Import the helper at the top:

```js
import { normalizeAddressBook } from "../addressBook";
```

- [ ] **Step 2: Verify no legacy address behavior changed.**

Run:

```bash
grep -n "updates.address\|address," /var/www/html/Node-JS/Ecommerce/backend/lib/models/customer.js
```

Expected: The pre-existing update path still writes `customers.address`; the new code only reads/writes `customers.addresses`.

- [ ] **Step 3: Run the backend unit suite.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm test
```

Expected: PASS for all existing tests plus the new address-book tests.

- [ ] **Step 4: Commit.**

```bash
git add backend/lib/models/customer.js
git commit -m "feat: persist customer address books transactionally"
```

### Task 4: Expose authenticated address-book routes

**Files:**
- Create: `backend/app/api/store/addresses/route.js`

**Interfaces:**
- Consumes: `authenticate()` from `backend/lib/authorization.js`, `Customer.getAddressBookByEmail`, `Customer.mutateAddressBookByEmail`, and pure helpers from `backend/lib/addressBook.js`.
- Produces:
  - `GET /api/store/addresses -> { success: true, addresses }`
  - `POST /api/store/addresses` accepts either `{ claim: [...] }` or one address object and returns `{ success: true, addresses, claimed? }`
  - `PATCH /api/store/addresses` accepts `{ id, ...fields }` and returns `{ success: true, addresses }`
  - `DELETE /api/store/addresses` accepts `{ id }` and returns `{ success: true, addresses }`

- [ ] **Step 1: Implement the collection endpoint.**

```js
import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { Customer } from "@/lib/models/customer";
import {
  createAddressEntry,
  deleteAddressEntry,
  mergeClaimedAddresses,
  updateAddressEntry,
} from "@/lib/addressBook";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function failure(message, status) {
  return Response.json({ success: false, message }, { status, headers: corsHeaders() });
}

function success(addresses, extra = {}, status = 200) {
  return Response.json({ success: true, addresses, ...extra }, { status, headers: corsHeaders() });
}

export async function GET() {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;
    const addresses = await Customer.getAddressBookByEmail(auth.user.email);
    return success(addresses);
  } catch (error) {
    console.error("List storefront addresses error:", error);
    return failure("Could not load saved addresses.", 500);
  }
}

export async function POST(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => ({}));
    const result = await Customer.mutateAddressBookByEmail(
      auth.user.email,
      (existing, context) => {
        if (Array.isArray(body.claim)) {
          const merged = mergeClaimedAddresses(existing, body.claim, new Date().toISOString(), {
            name: auth.user.name,
            phone: context.mobile,
          });
          return { addresses: merged.addresses, claimed: merged.claimed };
        }
        const created = createAddressEntry(existing, body);
        if (created.error) return { error: created.error, errors: created.errors, status: 400 };
        return { addresses: [...existing, created.address] };
      },
      { name: auth.user.name }
    );
    if (result.error) {
      return Response.json(
        { success: false, message: result.error, errors: result.errors },
        { status: result.status || 400, headers: corsHeaders() }
      );
    }
    return success(result.addresses, result.claimed == null ? {} : { claimed: result.claimed }, 201);
  } catch (error) {
    console.error("Create storefront address error:", error);
    return failure("Could not save this address.", 500);
  }
}

export async function PATCH(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => ({}));
    if (!body?.id || typeof body.id !== "string") return failure("An address id is required.", 400);
    const result = await Customer.mutateAddressBookByEmail(
      auth.user.email,
      (existing) => {
        const updated = updateAddressEntry(existing, body.id, body);
        if (updated.error) {
          return {
            error: updated.error,
            errors: updated.errors,
            status: updated.error === "Address not found." ? 404 : 400,
          };
        }
        return { addresses: updated.addresses };
      },
      { name: auth.user.name }
    );
    if (result.error) {
      return Response.json(
        { success: false, message: result.error, errors: result.errors },
        { status: result.status || 400, headers: corsHeaders() }
      );
    }
    return success(result.addresses);
  } catch (error) {
    console.error("Update storefront address error:", error);
    return failure("Could not update this address.", 500);
  }
}

export async function DELETE(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => ({}));
    if (!body?.id || typeof body.id !== "string") return failure("An address id is required.", 400);
    const result = await Customer.mutateAddressBookByEmail(
      auth.user.email,
      (existing) => {
        if (!existing.some((entry) => entry.id === body.id)) {
          return { error: "Address not found.", status: 404 };
        }
        return { addresses: deleteAddressEntry(existing, body.id) };
      },
      { name: auth.user.name }
    );
    if (result.error) {
      return Response.json(
        { success: false, message: result.error },
        { status: result.status || 400, headers: corsHeaders() }
      );
    }
    return success(result.addresses);
  } catch (error) {
    console.error("Delete storefront address error:", error);
    return failure("Could not delete this address.", 500);
  }
}
```

- [ ] **Step 2: Start the backend and smoke-test the unauthenticated shape manually.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm run dev
```

In another shell, run:

```bash
curl -i http://localhost:3000/api/store/addresses
```

Expected: HTTP 401 and JSON containing `"success":false`. Stop the dev server after this check.

- [ ] **Step 3: Run lint and backend tests.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm run lint
cd /var/www/html/Node-JS/Ecommerce/backend && npm test
```

Expected: Both PASS.

- [ ] **Step 4: Commit.**

```bash
git add backend/app/api/store/addresses/route.js
git commit -m "feat: add authenticated storefront address-book API"
```

### Task 5: Share one location definition and publish a public store list

**Files:**
- Modify: `backend/lib/storeCatalogScope.js`
- Modify: `backend/lib/__tests__/storeCatalogScope.test.mjs`
- Modify: `backend/lib/models/branch.js`
- Create: `backend/app/api/store/branches/route.js`

**Interfaces:**
- Consumes: Existing pincode and latitude/longitude behavior used by `/api/store/products`.
- Produces:
  - `buildLocationPredicates({ pincode, lat, lng, params, branchIdColumn }): string[]`
  - `buildBranchScope(...)` unchanged externally
  - `Branch.listServingBranches({ pincode, lat, lng, limit }): Promise<BranchRow[]>`
  - `GET /api/store/branches?pincode=&lat=&lng=&limit= -> { success: true, branches }`

- [ ] **Step 1: Add focused branch predicate tests first.**

Append these tests to `backend/lib/__tests__/storeCatalogScope.test.mjs`:

```js
test("location predicates can target a standalone branches query", async () => {
  const { buildLocationPredicates } = await import("../storeCatalogScope.js");
  const params = [];
  const conditions = buildLocationPredicates({
    pincode: "411001",
    lat: 18.5204,
    lng: 73.8567,
    params,
    branchIdColumn: "b.id",
  });
  assert.equal(conditions.length, 2);
  assert.match(conditions.join(" "), /nb\.id = b\.id/);
  assert.deepEqual(params.slice(0, 2), ["411001%", "411001"]);
});

test("location predicates omit coordinates when only one axis is supplied", async () => {
  const { buildLocationPredicates } = await import("../storeCatalogScope.js");
  const params = [];
  const conditions = buildLocationPredicates({ pincode: "", lat: 18.5204, lng: 0, params, branchIdColumn: "b.id" });
  assert.deepEqual(conditions, []);
  assert.deepEqual(params, []);
});
```

- [ ] **Step 2: Run the tests and verify the new helper is missing.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm test -- lib/__tests__/storeCatalogScope.test.mjs
```

Expected: FAIL because `buildLocationPredicates` is not a function.

- [ ] **Step 3: Extract shared location predicates.**

Replace the pincode/radius section of `buildBranchScope` with:

```js
export function buildLocationPredicates({ pincode = "", lat = 0, lng = 0, params, branchIdColumn }) {
  if (!Array.isArray(params)) throw new Error("params must be an array");
  if (!branchIdColumn || typeof branchIdColumn !== "string") throw new Error("branchIdColumn is required");
  const conditions = [];
  const latNum = Number(lat) || 0;
  const lngNum = Number(lng) || 0;

  if (pincode) {
    params.push(`${pincode}%`);
    params.push(`${pincode}`);
    conditions.push(
      `EXISTS (SELECT 1 FROM branches nb WHERE (nb.postalcode LIKE $${params.length - 1} OR nb.postalcode = $${params.length}) AND nb.status = 'ACTIVE' AND nb.deliveryenabled = TRUE AND nb.id = ${branchIdColumn})`
    );
  }

  if (latNum !== 0 && lngNum !== 0) {
    const maxLat = 50 / 111.32;
    const maxLng = 50 / (111.32 * Math.cos((latNum * Math.PI) / 180));
    const latIdx = params.push(latNum);
    const lngIdx = params.push(lngNum);
    const maxLatIdx = params.push(maxLat);
    const maxLngIdx = params.push(maxLng);
    conditions.push(
      `EXISTS (SELECT 1 FROM branches nb WHERE nb.latitude BETWEEN $${latIdx}::numeric - $${maxLatIdx}::numeric AND $${latIdx}::numeric + $${maxLatIdx}::numeric AND nb.longitude BETWEEN $${lngIdx}::numeric - $${maxLngIdx}::numeric AND $${lngIdx}::numeric + $${maxLngIdx}::numeric AND nb.status = 'ACTIVE' AND nb.deliveryenabled = TRUE AND nb.id = ${branchIdColumn})`
    );
  }

  return conditions;
}

export function buildBranchScope({ branchId, pincode, lat, lng, params }) {
  const conditions = [];
  if (branchId) {
    params.push(branchId);
    conditions.push(`bp.branchid = (SELECT id FROM branches WHERE uuid = $${params.length})`);
  }
  conditions.push(...buildLocationPredicates({ pincode, lat, lng, params, branchIdColumn: "bp.branchid" }));
  return { conditions, scoped: conditions.length > 0 };
}
```

- [ ] **Step 4: Add the public branch search method.**

Append this method to the exported `Branch` object:

```js
async listServingBranches({ pincode = "", lat = 0, lng = 0, limit = 100 } = {}) {
  const params = [];
  const conditions = ["status = 'ACTIVE'", "deliveryenabled = TRUE"];
  const locationConditions = buildLocationPredicates({
    pincode: (pincode ?? "").trim(),
    lat,
    lng,
    params,
    branchIdColumn: "b.id",
  });
  conditions.push(...locationConditions);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 100));
  params.push(safeLimit);
  const result = await pool.query(
    `SELECT ${PUBLIC_COLUMNS}
     FROM ${TABLE} b
     WHERE ${conditions.join(" AND ")}
     ORDER BY name ASC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
},
```

Import the helper:

```js
import { buildLocationPredicates } from "../storeCatalogScope.js";
```

- [ ] **Step 5: Create the public route.**

```js
import { corsHeaders } from "@/lib/cors";
import { Branch } from "@/lib/models/branch";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url, process.env.APP_URL || "http://localhost:3000");
    const branches = await Branch.listServingBranches({
      pincode: searchParams.get("pincode") || "",
      lat: Number(searchParams.get("lat") || 0),
      lng: Number(searchParams.get("lng") || 0),
      limit: Number(searchParams.get("limit") || 100),
    });
    return Response.json({ success: true, branches }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("List serving stores error:", error);
    return Response.json({ success: false, message: "Could not load stores." }, { status: 500, headers: corsHeaders() });
  }
}
```

- [ ] **Step 6: Run focused and full backend tests.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm test -- lib/__tests__/storeCatalogScope.test.mjs
cd /var/www/html/Node-JS/Ecommerce/backend && npm test
```

Expected: PASS in both commands.

- [ ] **Step 7: Commit.**

```bash
git add backend/lib/storeCatalogScope.js backend/lib/__tests__/storeCatalogScope.test.mjs backend/lib/models/branch.js backend/app/api/store/branches/route.js
git commit -m "feat: publish location-aware public store list"
```

### Task 6: Add the backend Nominatim proxy with cache and throttle

**Files:**
- Create: `backend/lib/geocode.js`
- Create: `backend/lib/__tests__/geocode.test.mjs`
- Create: `backend/app/api/store/geocode/search/route.js`
- Create: `backend/app/api/store/geocode/reverse/route.js`

**Interfaces:**
- Consumes: Browser search text or coordinates; upstream Nominatim JSON.
- Produces:
  - `searchLocations(query: string, dependencies?: GeocodeDependencies): Promise<GeocodedSuggestion[]>`
  - `reverseGeocode({ lat: number; lng: number }, dependencies?: GeocodeDependencies): Promise<GeocodedSuggestion | null>`
  - `GET /api/store/geocode/search?q=... -> { success: true, results }`
  - `GET /api/store/geocode/reverse?lat=...&lng=... -> { success: true, result }`
  - Upstream failures return `{ success: false, message: "Location search is temporarily unavailable." }` and never leak fetch internals.

- [ ] **Step 1: Write failing geocode tests with injected fetch and clock.**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { __resetGeocodeCacheForTests, reverseGeocode, searchLocations } from "../geocode.js";

function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("short queries do not call Nominatim", async () => {
  let calls = 0;
  const results = await searchLocations("Pu", {
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
  });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test("forward search maps the Indian address parts used by the form", async () => {
  __resetGeocodeCacheForTests();
  const results = await searchLocations("Kothrud, Pune", {
    fetchImpl: async () => response([
      {
        place_id: 1,
        display_name: "Kothrud, Pune, Maharashtra, 411038, India",
        lat: "18.5074",
        lon: "73.8077",
        address: {
          road: "Paud Road",
          suburb: "Kothrud",
          city: "Pune",
          state: "Maharashtra",
          postcode: "411038",
          country: "India",
        },
      },
    ]),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].city, "Pune");
  assert.equal(results[0].state, "Maharashtra");
  assert.equal(results[0].postalCode, "411038");
  assert.equal(results[0].latitude, 18.5074);
  assert.equal(results[0].longitude, 73.8077);
});

test("repeated searches use the cache and do not call Nominatim again", async () => {
  __resetGeocodeCacheForTests();
  let calls = 0;
  const dependencies = {
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
    now: () => 1_000,
  };
  await searchLocations("Kothrud Pune", dependencies);
  await searchLocations("Kothrud Pune", dependencies);
  assert.equal(calls, 1);
});

test("distinct upstream searches observe the minimum request interval", async () => {
  __resetGeocodeCacheForTests();
  let calls = 0;
  let nowValue = 1000;
  const slept = [];
  const dependencies = {
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
    now: () => nowValue,
    sleep: async (ms) => {
      slept.push(ms);
      nowValue += ms;
    },
  };
  await searchLocations("Kothrud Pune", dependencies);
  await searchLocations("Baner Pune", dependencies);
  assert.equal(calls, 2);
  assert.deepEqual(slept, [1000]);
});

test("an expired search-cache entry triggers another upstream call", async () => {
  __resetGeocodeCacheForTests();
  let calls = 0;
  let nowValue = 1000;
  const dependencies = {
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
    now: () => nowValue,
  };
  await searchLocations("Kothrud Pune", dependencies);
  nowValue = 601001;
  await searchLocations("Kothrud Pune", dependencies);
  assert.equal(calls, 2);
});

test("an upstream Nominatim failure is classified as temporary", async () => {
  __resetGeocodeCacheForTests();
  await assert.rejects(
    () => searchLocations("Kothrud Pune", { fetchImpl: async () => response({ message: "busy" }, false, 503) }),
    /temporarily unavailable/
  );
});

test("reverse geocoding validates coordinates before calling Nominatim", async () => {
  let calls = 0;
  const result = await reverseGeocode(
    { lat: Number.NaN, lng: 73.85 },
    { fetchImpl: async () => {
      calls += 1;
      return response({});
    } }
  );
  assert.equal(result, null);
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run the test and verify it fails because the module is absent.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm test -- lib/__tests__/geocode.test.mjs
```

Expected: FAIL with `Cannot find module '../geocode.js'`.

- [ ] **Step 3: Implement the cached Nominatim client.**

```js
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const SEARCH_TTL_MS = 10 * 60 * 1000;
const REVERSE_TTL_MS = 30 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const USER_AGENT = "Ecommerce-Storefront/1.0 (address autocomplete)";
const TEMPORARY_ERROR = "Location search is temporarily unavailable.";

const cache = new Map();
let lastUpstreamAt = 0;

export function __resetGeocodeCacheForTests() {
  cache.clear();
  lastUpstreamAt = 0;
}

function cached(key, now) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

async function throttledFetch(url, { fetchImpl, now, sleep }) {
  const elapsed = now() - lastUpstreamAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastUpstreamAt = now();
  const res = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    const error = new Error(TEMPORARY_ERROR);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function addressPart(address, keys, fallback = "") {
  for (const key of keys) {
    if (address[key]) return String(address[key]);
  }
  return fallback;
}

function mapResult(row) {
  const address = row.address || {};
  return {
    label: row.display_name || "",
    line1: [address.house_number, address.road].filter(Boolean).join(" "),
    line2: addressPart(address, ["suburb", "neighbourhood", "quarter"]),
    city: addressPart(address, ["city", "town", "village", "municipality"]),
    state: addressPart(address, ["state"]),
    postalCode: addressPart(address, ["postcode"]),
    country: addressPart(address, ["country"], "India"),
    latitude: Number(row.lat),
    longitude: Number(row.lon),
  };
}

export async function searchLocations(query, dependencies = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 3) return [];
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => Date.now());
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const key = `search:${q.toLowerCase()}`;
  const hit = cached(key, now());
  if (hit) return hit;
  const params = new URLSearchParams({
    format: "jsonv2",
    q,
    countrycodes: "in",
    limit: "5",
    addressdetails: "1",
  });
  const rows = await throttledFetch(`${NOMINATIM_BASE}/search?${params}`, { fetchImpl, now, sleep });
  const results = Array.isArray(rows) ? rows.map(mapResult) : [];
  cache.set(key, { value: results, expiresAt: now() + SEARCH_TTL_MS });
  return results;
}

export async function reverseGeocode({ lat, lng } = {}, dependencies = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => Date.now());
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const key = `reverse:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const hit = cached(key, now());
  if (hit) return hit;
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "18",
  });
  const row = await throttledFetch(`${NOMINATIM_BASE}/reverse?${params}`, { fetchImpl, now, sleep });
  const result = row ? mapResult(row) : null;
  cache.set(key, { value: result, expiresAt: now() + REVERSE_TTL_MS });
  return result;
}
```

- [ ] **Step 4: Add both public proxy routes.**

`backend/app/api/store/geocode/search/route.js`:

```js
import { corsHeaders } from "@/lib/cors";
import { searchLocations } from "@/lib/geocode";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url, process.env.APP_URL || "http://localhost:3000");
    const results = await searchLocations(searchParams.get("q") || "");
    return Response.json({ success: true, results }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Geocode search error:", error);
    return Response.json(
      { success: false, message: "Location search is temporarily unavailable." },
      { status: 502, headers: corsHeaders() }
    );
  }
}
```

`backend/app/api/store/geocode/reverse/route.js`:

```js
import { corsHeaders } from "@/lib/cors";
import { reverseGeocode } from "@/lib/geocode";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url, process.env.APP_URL || "http://localhost:3000");
    const result = await reverseGeocode({
      lat: Number(searchParams.get("lat")),
      lng: Number(searchParams.get("lng")),
    });
    return Response.json({ success: true, result }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Reverse geocode error:", error);
    return Response.json(
      { success: false, message: "Location search is temporarily unavailable." },
      { status: 502, headers: corsHeaders() }
    );
  }
}
```

- [ ] **Step 5: Run the geocode and full backend tests.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm test -- lib/__tests__/geocode.test.mjs
cd /var/www/html/Node-JS/Ecommerce/backend && npm test
cd /var/www/html/Node-JS/Ecommerce/backend && npm run lint
```

Expected: All PASS.

- [ ] **Step 6: Commit.**

```bash
git add backend/lib/geocode.js backend/lib/__tests__/geocode.test.mjs backend/app/api/store/geocode/search/route.js backend/app/api/store/geocode/reverse/route.js
git commit -m "feat: add cached Nominatim search and reverse proxy"
```

### Task 7: Add storefront service calls and the address-book hook

**Files:**
- Modify: `frontend/src/services/storefront.js`
- Create: `frontend/src/hooks/useAddressBook.js`

**Interfaces:**
- Consumes: Existing `storefrontFetch` and storefront token behavior.
- Produces:
  - `getAddresses(): Promise<{ ok, data: { success, addresses } }>`
  - `createAddress(payload): Promise<{ ok, data }>`
  - `claimAddresses(payload: unknown[]): Promise<{ ok, data }>`
  - `updateAddress(id: string, patch: object): Promise<{ ok, data }>`
  - `deleteAddress(id: string): Promise<{ ok, data }>`
  - `geocodeSearch(q: string): Promise<{ ok, data }>`
  - `geocodeReverse({ lat, lng }): Promise<{ ok, data }>`
  - `getStoreBranches({ limit?, pincode?, lat?, lng? }): Promise<{ ok, data }>`
  - `getStoreProducts({ page?, limit?, search?, category?, branchId?, pincode?, lat?, lng? }): Promise<{ ok, data }>`
  - `useAddressBook({ user, notify }): { addresses, selectedAddress, selectedAddressId, loading, error, refresh, selectAddress, saveAddress, editAddress, removeAddress, claimLegacyAddresses(loginUser?) }`

- [ ] **Step 1: Extend the storefront service.**

Replace `getStoreProducts` and `getStoreBranches` with:

```js
export function getStoreProducts({ page = 1, limit = 12, search = "", category = "", branchId = null, pincode = "", lat = null, lng = null } = {}) {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search.trim()) qs.set("search", search.trim());
  if (category) qs.set("category", category);
  if (branchId) qs.set("branchId", branchId);
  if (String(pincode || "").trim()) qs.set("pincode", String(pincode).trim());
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    qs.set("lat", String(Number(lat)));
    qs.set("lng", String(Number(lng)));
  }
  return storefrontFetch(`/products?${qs}`);
}

export function getStoreBranches({ limit = 100, pincode = "", lat = null, lng = null } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (String(pincode || "").trim()) qs.set("pincode", String(pincode).trim());
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    qs.set("lat", String(Number(lat)));
    qs.set("lng", String(Number(lng)));
  }
  return storefrontFetch(`/branches?${qs}`);
}
```

Add these functions after `storeRegister`:

```js
export function getAddresses() {
  return storefrontFetch("/addresses");
}

export function createAddress(payload) {
  return storefrontFetch("/addresses", { method: "POST", body: JSON.stringify(payload || {}) });
}

export function claimAddresses(payload) {
  return storefrontFetch("/addresses", { method: "POST", body: JSON.stringify({ claim: payload || [] }) });
}

export function updateAddress(id, patch) {
  return storefrontFetch("/addresses", { method: "PATCH", body: JSON.stringify({ ...(patch || {}), id }) });
}

export function deleteAddress(id) {
  return storefrontFetch("/addresses", { method: "DELETE", body: JSON.stringify({ id }) });
}

export function geocodeSearch(q) {
  const qs = new URLSearchParams({ q: String(q || "").trim() });
  return storefrontFetch(`/geocode/search?${qs}`);
}

export function geocodeReverse({ lat, lng }) {
  const qs = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  return storefrontFetch(`/geocode/reverse?${qs}`);
}
```

- [ ] **Step 2: Create the address-book hook.**

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  claimAddresses,
  createAddress,
  deleteAddress,
  getAddresses,
  updateAddress,
} from "../services/storefront";

function readJSON(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export default function useAddressBook({ user, notify }) {
  const userKey = user?.email ? user.email.toLowerCase() : "guest";
  const selectionKey = `sf_current_address_${userKey}`;
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(() => readJSON(selectionKey, null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  const loadAddresses = useCallback(async (email) => {
    if (!email) {
      setAddresses([]);
      setSelectedAddressId(null);
      return [];
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    const { ok, data } = await safeRequest(getAddresses(), "Could not load saved addresses.");
    if (controller.signal.aborted) return [];
    if (!ok || !data.success) {
      setError(data.message || "Could not load saved addresses.");
      setLoading(false);
      return [];
    }
    const next = Array.isArray(data.addresses) ? data.addresses : [];
    setAddresses(next);
    setSelectedAddressId((current) => {
      if (current && next.some((entry) => entry.id === current)) return current;
      const fallback = next.find((entry) => entry.isDefault) || next[0];
      return fallback ? fallback.id : null;
    });
    setLoading(false);
    return next;
  }, []);

  const refresh = useCallback(() => loadAddresses(user?.email), [loadAddresses, user?.email]);

  useEffect(() => {
    setSelectedAddressId(readJSON(selectionKey, null));
  }, [selectionKey]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    writeJSON(selectionKey, selectedAddressId);
  }, [selectionKey, selectedAddressId]);

  const selectedAddress = useMemo(
    () => addresses.find((entry) => entry.id === selectedAddressId) || null,
    [addresses, selectedAddressId]
  );

  async function safeRequest(promise, fallbackMessage) {
    try {
      return await promise;
    } catch {
      return { ok: false, data: { message: fallbackMessage } };
    }
  }

  async function mutate(promise, successMessage) {
    const { ok, data } = await safeRequest(promise, "Could not save this address.");
    if (!ok || !data.success) {
      notify(data.message || "Could not save this address.");
      return null;
    }
    const next = Array.isArray(data.addresses) ? data.addresses : [];
    setAddresses(next);
    setSelectedAddressId((current) => {
      if (current && next.some((entry) => entry.id === current)) return current;
      const fallback = next.find((entry) => entry.isDefault) || next[0];
      return fallback ? fallback.id : null;
    });
    if (successMessage) notify(successMessage);
    return next;
  }

  const selectAddress = useCallback((id) => setSelectedAddressId(id), []);
  const saveAddress = useCallback((payload) => mutate(createAddress(payload), "Address saved."), [notify]);
  const editAddress = useCallback((id, patch) => mutate(updateAddress(id, patch), "Address updated."), [notify]);
  const removeAddress = useCallback((id) => mutate(deleteAddress(id), "Address deleted."), [notify]);

  const claimLegacyAddresses = useCallback(async (loginUser) => {
    const email = loginUser?.email || user?.email;
    let legacy = [];
    try {
      legacy = JSON.parse(localStorage.getItem("sf_addresses")) || [];
    } catch {
      legacy = [];
    }
    if (!email || !Array.isArray(legacy) || legacy.length === 0) return 0;
    const current = await loadAddresses(email);
    if (current.length > 0) return 0;
    const { ok, data } = await safeRequest(claimAddresses(legacy), "Could not import saved addresses.");
    if (ok && data.success) {
      const next = Array.isArray(data.addresses) ? data.addresses : [];
      setAddresses(next);
      try {
        localStorage.removeItem("sf_addresses");
      } catch {}
      const fallback = next.find((entry) => entry.isDefault) || next[0];
      if (fallback) setSelectedAddressId(fallback.id);
      notify(data.claimed ? `Imported ${data.claimed} saved address${data.claimed === 1 ? "" : "es"}.` : "Saved addresses imported.");
      return data.claimed || 0;
    }
    notify(data.message || "Could not import saved addresses.");
    return 0;
  }, [loadAddresses, notify, user?.email]);

  return {
    addresses,
    selectedAddress,
    selectedAddressId,
    loading,
    error,
    refresh,
    selectAddress,
    saveAddress,
    editAddress,
    removeAddress,
    claimLegacyAddresses,
  };
}
```

- [ ] **Step 3: Run frontend lint.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add frontend/src/services/storefront.js frontend/src/hooks/useAddressBook.js
git commit -m "feat: add storefront address-book services and hook"
```

### Task 8: Build the delivery-location header, picker, form, and styles

**Files:**
- Create: `frontend/src/components/storefront/LocationChip.jsx`
- Create: `frontend/src/components/storefront/AddressBookModal.jsx`
- Create: `frontend/src/components/storefront/AddressForm.jsx`
- Modify: `frontend/src/styles/Storefront.css`

**Interfaces:**
- Consumes: `useAddressBook`, `geocodeSearch`, `geocodeReverse`, and `validatePhone` behavior for a 10-digit mobile.
- Produces:
  - `<LocationChip address loading onOpen />`
  - `<AddressBookModal open addressBook user onSelect onClose notify />`
  - `<AddressForm initial saving serverErrors notify onCancel onSubmit />`
  - New `.sf-location-*` and `.sf-address-*` styles and a `max-width: 640px` responsive rule.

- [ ] **Step 1: Create the header chip.**

```jsx
import { FiMapPin } from "react-icons/fi";

export default function LocationChip({ address, loading, onOpen }) {
  const title = address ? `${address.label || "Saved address"} · ${address.city || ""}` : "Add location";
  return (
    <button type="button" className="sf-location-chip" onClick={onOpen} aria-label={loading ? "Loading delivery location" : `Deliver to ${title}`} title={loading ? "Loading delivery location" : `Deliver to ${title}`}>
      <FiMapPin aria-hidden="true" />
      <span className="sf-location-txt">
        <small>Deliver to</small>
        <strong>{loading ? "Locating…" : title}</strong>
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Create the shared address form.**

The form owns Nominatim search and current-location lookup, so the modal and
full-page address book share exactly one implementation.

```jsx
import { useEffect, useRef, useState } from "react";
import { validatePhone } from "../../utils/validation";
import { geocodeReverse, geocodeSearch } from "../../services/storefront";

const LABELS = ["Home", "Work", "Other"];
const EMPTY = {
  label: "Home",
  recipient: "",
  phone: "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  state: "",
  country: "India",
  postalCode: "",
  latitude: null,
  longitude: null,
  isDefault: false,
};

export default function AddressForm({ initial, saving, serverErrors, notify, onCancel, onSubmit }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [errors, setErrors] = useState({});
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const searchAbort = useRef(null);

  useEffect(() => {
    setForm({ ...EMPTY, ...(initial || {}) });
    setErrors({});
  }, [initial?.id]);

  useEffect(() => {
    if (searchText.trim().length < 3) {
      setSuggestions([]);
      setSuggestionsBusy(false);
      return;
    }
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSuggestionsBusy(true);
    const timer = setTimeout(async () => {
      let response;
      try {
        response = await geocodeSearch(searchText.trim());
      } catch {
        response = { ok: false, data: { message: "Location search is temporarily unavailable." } };
      }
      if (controller.signal.aborted) return;
      setSuggestionsBusy(false);
      if (!response.ok || !response.data.success) {
        notify(response.data.message || "Location search is temporarily unavailable.");
        setSuggestions([]);
        return;
      }
      setSuggestions(Array.isArray(response.data.results) ? response.data.results : []);
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [notify, searchText]);

  const set = (key) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  function chooseSuggestion(suggestion) {
    setForm((current) => ({
      ...current,
      line1: suggestion.line1 || current.line1,
      line2: suggestion.line2 || current.line2,
      city: suggestion.city || current.city,
      state: suggestion.state || current.state,
      postalCode: suggestion.postalCode || current.postalCode,
      latitude: Number.isFinite(Number(suggestion.latitude)) ? Number(suggestion.latitude) : current.latitude,
      longitude: Number.isFinite(Number(suggestion.longitude)) ? Number(suggestion.longitude) : current.longitude,
    }));
  }

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      notify("Location is unavailable in this browser. Add your address manually.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        let response;
        try {
          response = await geocodeReverse({ lat: position.coords.latitude, lng: position.coords.longitude });
        } catch {
          response = { ok: false, data: { message: "Location search is temporarily unavailable." } };
        }
        setLocating(false);
        if (!response.ok || !response.data.success || !response.data.result) {
          notify(response.data.message || "Location search is temporarily unavailable.");
          return;
        }
        const result = response.data.result;
        setForm((current) => ({
          ...current,
          line1: result.line1 || current.line1,
          line2: result.line2 || current.line2,
          city: result.city || current.city,
          state: result.state || current.state,
          postalCode: result.postalCode || current.postalCode,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: "geolocation",
        }));
      },
      () => {
        setLocating(false);
        notify("Location permission denied — add your address manually.");
      },
      { timeout: 10000 }
    );
  }

  function submit(event) {
    event.preventDefault();
    const nextErrors = { ...(serverErrors || {}) };
    if (!form.recipient.trim()) nextErrors.recipient = "Enter the recipient name.";
    if (!form.line1.trim()) nextErrors.line1 = "Enter house, street, or area.";
    if (!form.city.trim()) nextErrors.city = "Enter city.";
    if (!form.state.trim()) nextErrors.state = "Enter state.";
    if (!/^\d{6}$/.test(form.postalCode.trim())) nextErrors.postalCode = "Enter a 6-digit pincode.";
    const phoneError = validatePhone(form.phone.trim());
    if (phoneError) nextErrors.phone = phoneError;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit({
      ...form,
      label: form.label.trim() || "Home",
      recipient: form.recipient.trim(),
      phone: form.phone.trim(),
      line1: form.line1.trim(),
      line2: form.line2.trim(),
      landmark: form.landmark.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      country: form.country.trim() || "India",
      postalCode: form.postalCode.trim(),
      latitude: form.latitude == null || form.latitude === "" ? null : Number(form.latitude),
      longitude: form.longitude == null || form.longitude === "" ? null : Number(form.longitude),
    });
  }

  return (
    <form className="sf-address-form" onSubmit={submit} noValidate>
      <div className="sf-field">
        <label>Search location</label>
        <input className="sf-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search area, landmark, or pincode" />
        {suggestionsBusy && <p className="muted small">Searching locations…</p>}
        {suggestions.length > 0 && (
          <div className="sf-address-suggestions">
            {suggestions.map((suggestion, index) => (
              <button type="button" key={`${suggestion.label}-${index}`} onClick={() => chooseSuggestion(suggestion)}>
                <strong>{suggestion.city || suggestion.label}</strong>
                <span>{suggestion.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="sf-btn sf-address-current" onClick={useCurrentLocation} disabled={locating}>
        {locating ? "Detecting current location…" : "Use my current location"}
      </button>

      <div className="sf-row-2">
        <div className="sf-field">
          <label>Label *</label>
          <select className="sf-input" value={form.label} onChange={set("label")}>
            {(LABELS.includes(form.label) ? LABELS : [...LABELS, form.label]).map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </div>
        <div className="sf-field">
          <label>Recipient *</label>
          <input className="sf-input" value={form.recipient} onChange={set("recipient")} placeholder="Full name" />
          {errors.recipient && <p className="sf-field-error">{errors.recipient}</p>}
        </div>
      </div>

      <div className="sf-row-2">
        <div className="sf-field">
          <label>Mobile *</label>
          <input className="sf-input" value={form.phone} onChange={set("phone")} inputMode="numeric" placeholder="10-digit mobile" />
          {errors.phone && <p className="sf-field-error">{errors.phone}</p>}
        </div>
        <div className="sf-field">
          <label>Pincode *</label>
          <input className="sf-input" value={form.postalCode} onChange={set("postalCode")} inputMode="numeric" placeholder="6-digit pincode" />
          {errors.postalCode && <p className="sf-field-error">{errors.postalCode}</p>}
        </div>
      </div>

      <div className="sf-field">
        <label>House / street *</label>
        <textarea className="sf-input" rows={2} value={form.line1} onChange={set("line1")} placeholder="House, street, building" />
        {errors.line1 && <p className="sf-field-error">{errors.line1}</p>}
      </div>

      <div className="sf-row-2">
        <div className="sf-field">
          <label>Area / locality</label>
          <input className="sf-input" value={form.line2} onChange={set("line2")} />
        </div>
        <div className="sf-field">
          <label>Landmark</label>
          <input className="sf-input" value={form.landmark} onChange={set("landmark")} />
        </div>
      </div>

      <div className="sf-row-2">
        <div className="sf-field">
          <label>City *</label>
          <input className="sf-input" value={form.city} onChange={set("city")} />
          {errors.city && <p className="sf-field-error">{errors.city}</p>}
        </div>
        <div className="sf-field">
          <label>State *</label>
          <input className="sf-input" value={form.state} onChange={set("state")} />
          {errors.state && <p className="sf-field-error">{errors.state}</p>}
        </div>
      </div>

      <label className="sf-check">
        <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} />
        Save as default address
      </label>

      <div className="sf-address-actions">
        <button type="button" className="sf-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="sf-btn primary" disabled={saving}>{saving ? "Saving…" : "Save address"}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Create the address-book modal.**

The modal filters saved addresses locally. Location search remains inside
`AddressForm`, so it is not duplicated here.

```jsx
import { useEffect, useMemo, useState } from "react";
import { FiCheck, FiMapPin, FiPencil, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import AddressForm from "./AddressForm";

function formatAddress(entry) {
  return [entry.line1, entry.line2, entry.landmark].filter(Boolean).join(", ");
}

export default function AddressBookModal({ open, addressBook, user, notify, onSelect, onClose }) {
  const [tab, setTab] = useState("saved");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filterText, setFilterText] = useState("");

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return addressBook.addresses;
    return addressBook.addresses.filter((entry) =>
      [entry.label, entry.recipient, entry.line1, entry.line2, entry.city, entry.state, entry.postalCode]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [addressBook.addresses, filterText]);

  useEffect(() => {
    if (!open) return;
    setTab("saved");
    setEditing(null);
    setFilterText("");
  }, [open ]);

  if (!open) return null;

  async function handleSubmit(payload) {
    setSaving(true);
    const saved = editing
      ? await addressBook.editAddress(editing.id, payload)
      : await addressBook.saveAddress(payload);
    setSaving(false);
    if (saved) {
      setEditing(null);
      setTab("saved");
    }
  }

  return (
    <div className="sf-modal-veil" role="dialog" aria-modal="true" aria-label="Choose delivery address">
      <div className="sf-address-modal">
        <div className="sf-address-modal-head">
          <div>
            <h3>Deliver to</h3>
            <p>{user?.email || "Choose where your order should go."}</p>
          </div>
          <button type="button" className="sf-icon-btn" onClick={onClose} aria-label="Close address book"><FiX /></button>
        </div>

        <div className="sf-address-tabs">
          <button type="button" className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>Saved addresses</button>
          <button type="button" className={tab === "add" ? "on" : ""} onClick={() => { setEditing(null); setTab("add"); }}>
            <FiPlus /> Add new address
          </button>
        </div>

        {tab === "saved" && (
          <div className="sf-address-list">
            <div className="sf-field">
              <label>Filter saved addresses</label>
              <input className="sf-input" value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Search Home, city, or pincode" />
            </div>
            {addressBook.loading && <p className="muted">Loading saved addresses…</p>}
            {addressBook.error && <p className="sf-err">{addressBook.error}</p>}
            {!addressBook.loading && filtered.length === 0 && (
              <div className="sf-empty"><FiMapPin size={28} /><p>No saved addresses yet.</p></div>
            )}
            {filtered.map((entry) => (
              <div key={entry.id} className={`sf-address-row${addressBook.selectedAddressId === entry.id ? " on" : ""}`}>
                <button type="button" className="sf-address-pick" onClick={() => onSelect(entry)}>
                  <span className="sf-radio-dot">{addressBook.selectedAddressId === entry.id && <FiCheck />}</span>
                  <span>
                    <strong>{entry.label}{entry.isDefault && <em>Default</em>}</strong>
                    <span>{formatAddress(entry)}</span>
                    <span>{entry.city}, {entry.state} — {entry.postalCode} · {entry.phone}</span>
                  </span>
                </button>
                <span className="sf-address-row-actions">
                  <button type="button" className="sf-icon-btn" title="Edit" onClick={() => { setEditing(entry); setTab("add"); }}><FiPencil /></button>
                  <button type="button" className="sf-icon-btn" title="Delete" onClick={() => addressBook.removeAddress(entry.id)}><FiTrash2 /></button>
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "add" && (
          <AddressForm
            initial={editing}
            saving={saving}
            notify={notify}
            onCancel={() => { setEditing(null); setTab("saved"); }}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append component styles.**

Append this block to `frontend/src/styles/Storefront.css`:

```css
/* Delivery location + address book */
.sf-location-chip{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--sf-line);border-radius:var(--sf-r-sm);padding:6px 12px;cursor:pointer;color:var(--sf-ink)}
.sf-location-chip:hover{border-color:var(--sf-ac);background:var(--sf-ac-soft)}
.sf-location-chip > svg{color:var(--sf-ac);flex-shrink:0}
.sf-location-txt{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;min-width:0}
.sf-location-txt small{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--sf-mut);font-weight:600}
.sf-location-txt strong{font-size:13px;font-weight:700;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-modal-veil{position:fixed;inset:0;background:rgba(13,31,18,.52);display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;z-index:120;overflow:auto}
.sf-address-modal{width:min(680px,100%);background:#fff;border-radius:var(--sf-r-lg);box-shadow:var(--sf-sh-lg);overflow:hidden}
.sf-address-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 12px}
.sf-address-modal-head h3{margin:0;font-size:18px}
.sf-address-modal-head p{margin:4px 0 0;color:var(--sf-mut);font-size:12.5px}
.sf-address-tabs{display:flex;gap:8px;padding:0 20px 14px}
.sf-address-tabs button{border:1px solid var(--sf-line);background:#fff;border-radius:99px;padding:8px 14px;font-size:13px;font-weight:700;color:var(--sf-mut);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.sf-address-tabs button.on{background:var(--sf-ink);border-color:var(--sf-ink);color:#fff}
.sf-address-list{display:grid;gap:10px;padding:0 20px 20px;max-height:52vh;overflow:auto}
.sf-address-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;border:1px solid var(--sf-line);border-radius:var(--sf-r-md);padding:12px}
.sf-address-row.on{border-color:var(--sf-ac);background:var(--sf-ac-soft)}
.sf-address-pick{display:flex;gap:10px;background:none;border:0;text-align:left;cursor:pointer;color:var(--sf-ink);flex:1;min-width:0}
.sf-radio-dot{width:22px;height:22px;border-radius:50%;border:2px solid var(--sf-line);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;margin-top:2px}
.sf-address-row.on .sf-radio-dot{background:var(--sf-ac);border-color:var(--sf-ac)}
.sf-address-pick strong{display:flex;align-items:center;gap:8px;font-size:14px}
.sf-address-pick strong em{font-style:normal;font-size:10px;font-weight:800;color:var(--sf-ac-dark);background:#d8f2e2;border-radius:99px;padding:2px 8px;text-transform:uppercase;letter-spacing:.4px}
.sf-address-pick span span{display:block;font-size:12.5px;color:var(--sf-mut);margin-top:3px}
.sf-address-row-actions{display:flex;gap:6px}
.sf-address-form{display:grid;gap:12px;padding:0 20px 20px}
.sf-address-suggestions{display:grid;border:1px solid var(--sf-line);border-radius:var(--sf-r-sm);overflow:hidden;margin-top:8px}
.sf-address-suggestions button{background:#fff;border:0;border-bottom:1px solid var(--sf-line-soft);padding:10px 12px;text-align:left;cursor:pointer}
.sf-address-suggestions button:last-child{border-bottom:0}
.sf-address-suggestions button:hover{background:var(--sf-ac-soft)}
.sf-address-suggestions strong{display:block;font-size:13px}
.sf-address-suggestions span{display:block;font-size:12px;color:var(--sf-mut)}
.sf-address-current{justify-content:center}
.sf-address-actions{display:flex;justify-content:flex-end;gap:10px}
.sf-check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.sf-field-error{color:var(--sf-red);font-size:12px;margin:5px 0 0}
@media (max-width:640px){
  .sf-location-txt strong{max-width:96px}
  .sf-location-txt small{display:none}
  .sf-modal-veil{padding:18px 10px}
}
```

- [ ] **Step 5: Run frontend lint.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/storefront/LocationChip.jsx frontend/src/components/storefront/AddressBookModal.jsx frontend/src/components/storefront/AddressForm.jsx frontend/src/styles/Storefront.css
git commit -m "feat: build delivery-location picker and address form"
```

### Task 9: Integrate selection, checkout, catalog, branches, and legacy claim

**Files:**
- Modify: `frontend/src/pages/Storefront.jsx`

**Interfaces:**
- Consumes: `useAddressBook`, `LocationChip`, `AddressBookModal`, `AddressForm`, updated service functions.
- Produces:
  - Header order: brand, location chip, Track, spacer, cart, store selector, account control.
  - Address selection changes catalog and branch requests through valid pincode/coordinates only.
  - Checkout prefill uses the server address book.
  - The full-page saved-address route reuses `AddressForm`.
  - First login imports legacy localStorage addresses once.
  - Checkout still works if address-book loading fails.

- [ ] **Step 1: Wire hook state, modal visibility, and location-aware fetching.**

Declare the hook immediately after `postLoginView`, so it is available to login
and navigation handlers:

```jsx
const addressBook = useAddressBook({ user, notify });
const [addressModalOpen, setAddressModalOpen] = useState(false);
const [storeCount, setStoreCount] = useState(null);
```

Add this helper and derived location object near the cart totals:

```js
function locationParamsFor(address) {
  const latitude = Number(address?.latitude);
  const longitude = Number(address?.longitude);
  return {
    pincode: address?.postalCode || "",
    lat: Number.isFinite(latitude) ? latitude : null,
    lng: Number.isFinite(longitude) ? longitude : null,
  };
}

const selectedAddress = addressBook.selectedAddress;
const locationParams = locationParamsFor(selectedAddress);
```

Change the catalog request to:

```js
getStoreProducts({
  page,
  limit: 12,
  search,
  category,
  branchId: selectedBranch?.uuid || null,
  pincode: locationParams.pincode,
  lat: locationParams.lat,
  lng: locationParams.lng,
})
```

Add `selectedAddress?.id`, `selectedAddress?.postalCode`, `selectedAddress?.latitude`, and `selectedAddress?.longitude` to that effect’s dependency array.

Replace `loadBranches` with a location-aware version:

```js
async function loadBranchesFor(address) {
  const location = locationParamsFor(address);
  let response;
  try {
    response = await getStoreBranches({
      limit: 100,
      pincode: location.pincode,
      lat: location.lat,
      lng: location.lng,
    });
  } catch {
    response = { ok: false, data: { message: "Could not load stores." } };
  }
  if (!response.ok || !response.data.success) {
    notify(response.data.message || "Could not load stores.");
    return null;
  }
  const branches = Array.isArray(response.data.branches) ? response.data.branches : [];
  setBranchList(branches);
  setStoreCount(branches.length);
  return branches;
}

async function loadBranches() {
  return loadBranchesFor(selectedAddress);
}
```

Replace `handleAddressSelect` with a version that refreshes compatible stores:

```js
async function handleAddressSelect(entry) {
  addressBook.selectAddress(entry.id);
  setAddressModalOpen(false);
  setPage(1);
  const branches = await loadBranchesFor(entry);
  if (!branches) {
    notify(`Delivering to ${entry.label || "saved address"} · ${entry.city || ""}`);
    return;
  }
  if (selectedBranch && !branches.some((branch) => branch.uuid === selectedBranch.uuid)) {
    setSelectedBranch(null);
    try {
      localStorage.removeItem("sf_branch");
    } catch {}
  }
  notify(`Delivering to ${entry.label || "saved address"} · ${entry.city || ""} — ${branches.length} store${branches.length === 1 ? "" : "s"}`);
}
```

Replace `handleLogin` with an explicit-user claim:

```js
function handleLogin(u) {
  setUser(u);
  try { localStorage.setItem("sf_user", JSON.stringify(u)); } catch {}
  setView(postLoginView || VIEWS.CATALOG);
  setPostLoginView(null);
  addressBook.claimLegacyAddresses(u);
  notify(`Welcome, ${u?.name || u?.email || "back"}!`);
}
```

Require login before opening the address modal or full-page address view:

```js
function openAddressBook() {
  if (!requireLogin(VIEWS.ADDRESSES, "Please log in to manage saved addresses.")) return;
  setAddressModalOpen(true);
}

function goTo(v) {
  if (v === VIEWS.ADDRESSES && !user) {
    setShowUserMenu(false);
    requireLogin(VIEWS.ADDRESSES, "Please log in to manage saved addresses.");
    return;
  }
  setShowUserMenu(false);
  setView(v);
}
```

Place this immediately after the brand button and before `<nav className="sf-nav">`:

```jsx
<LocationChip address={selectedAddress} loading={addressBook.loading} onOpen={openAddressBook} />
```

Render this immediately before `</main>`:

```jsx
<AddressBookModal
  open={addressModalOpen}
  addressBook={addressBook}
  user={user}
  notify={notify}
  onSelect={handleAddressSelect}
  onClose={() => setAddressModalOpen(false)}
/>
```

- [ ] **Step 2: Replace local saved-address behavior in checkout.**

Change the checkout signature to accept the hook, then pass it in:

```jsx
function CheckoutForm({ lines, subtotal, selectedBranch, user, addressBook, notify, onDone, onBack }) {
```

```jsx
<CheckoutForm
  lines={cart}
  subtotal={cartTotal}
  selectedBranch={selectedBranch}
  user={user}
  addressBook={addressBook}
  notify={notify}
  onDone={...}
  onBack={() => setView(VIEWS.CART)}
/>
```

Replace the `saved` localStorage state with `addressBook.addresses`, and replace `applySaved` with:

```js
function applySaved(a) {
  setForm((f) => ({
    ...f,
    customerName: a.recipient || f.customerName,
    customerMobile: a.phone || f.customerMobile,
    address: [a.line1, a.line2, a.landmark].filter(Boolean).join(", "),
    city: a.city || "",
    state: a.state || "",
    pincode: a.postalCode || "",
  }));
}
```

Render the saved-address buttons from `addressBook.addresses`, using `a.id` as the key and `${a.label} · ${a.city} — ${a.postalCode}` as the label. Keep all manual fields editable and submittable when `addressBook.error` is set.

- [ ] **Step 3: Replace the full-page AddressesPanel implementation.**

Change its signature to:

```jsx
function AddressesPanel({ addressBook, notify, onBack }) { ... }
```

Replace the component body with this server-backed implementation. Delete every `localStorage.getItem("sf_addresses")` and `localStorage.setItem("sf_addresses", ...)` call from this component.

```jsx
function AddressesPanel({ addressBook, notify, onBack }) {
  const [mode, setMode] = useState("list");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(payload) {
    setSaving(true);
    const saved = editing
      ? await addressBook.editAddress(editing.id, payload)
      : await addressBook.saveAddress(payload);
    setSaving(false);
    if (saved) {
      setEditing(null);
      setMode("list");
    }
  }

  return (
    <div className="sf-auth-wrap">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
        <h2>Saved addresses</h2>
      </div>
      {mode === "list" ? (
        <>
          <div className="sf-address-list">
            {addressBook.loading && <p className="muted">Loading saved addresses…</p>}
            {addressBook.error && <p className="sf-err">{addressBook.error}</p>}
            {!addressBook.loading && addressBook.addresses.length === 0 && (
              <div className="sf-empty"><p>No saved addresses yet.</p></div>
            )}
            {addressBook.addresses.map((entry) => (
              <div key={entry.id} className="sf-address-row">
                <div className="sf-line-mid">
                  <div className="sf-line-name"><FiMapPin /> {entry.label}{entry.isDefault ? " · Default" : ""}</div>
                  <div className="muted">{[entry.line1, entry.line2, entry.landmark].filter(Boolean).join(", ")}</div>
                  <div className="muted">{entry.city}, {entry.state} — {entry.postalCode} · {entry.phone}</div>
                </div>
                <span className="sf-address-row-actions">
                  <button type="button" className="sf-icon-btn" title="Edit" onClick={() => { setEditing(entry); setMode("form"); }}><FiPencil /></button>
                  <button type="button" className="sf-icon-btn" title="Delete" onClick={() => addressBook.removeAddress(entry.id)}><FiTrash2 /></button>
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="sf-btn green" style={{ width: "100%", marginTop: 14, padding: 12 }} onClick={() => { setEditing(null); setMode("form"); }}>
            <FiPlus /> Add address
          </button>
        </>
      ) : (
        <AddressForm
          initial={editing}
          saving={saving}
          notify={notify}
          onCancel={() => { setEditing(null); setMode("list"); }}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
```

Pass props at the route:

```jsx
[VIEWS.ADDRESSES]: <AddressesPanel addressBook={addressBook} notify={notify} onBack={goCatalog} />,
```

- [ ] **Step 4: Run lint and production build.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run lint
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run build
```

Expected: Both PASS.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/pages/Storefront.jsx
git commit -m "feat: integrate delivery location across storefront"
```

### Task 10: Run migration, API, UI, and regression verification

**Files:**
- Verify only; no new implementation unless verification exposes a defect.

- [ ] **Step 1: Apply the additive migration.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm run migrate
```

Expected: `apply 002-customer-addresses.sql` on a database that has not seen it, or `skip 002-customer-addresses.sql` on rerun. No other migration output changes.

- [ ] **Step 2: Verify the column and defaults directly.**

Run SQL equivalent to:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'customers' AND column_name IN ('address', 'addresses');
```

Expected: `address` remains JSONB and `addresses` is JSONB `NOT NULL DEFAULT '[]'`.

- [ ] **Step 3: Run backend verification.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm test
cd /var/www/html/Node-JS/Ecommerce/backend && npm run lint
```

Expected: PASS for both.

- [ ] **Step 4: Run frontend verification.**

Run:

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run lint
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run build
```

Expected: PASS for both.

- [ ] **Step 5: Complete the manual browser pass.**

Using logged-in and logged-out sessions, verify:
  1. Logged-out browsing, cart, tracking, and checkout initiation still work.
  2. Login imports legacy `sf_addresses` only when the server book is empty, then clears that key.
  3. Add, edit, set-default, delete, and tenth/eleventh-address behavior all return the full updated book.
  4. Search suggestions, current-location reverse lookup, denied geolocation permission, and Nominatim outage messaging all behave per the spec.
  5. Selecting an address changes the shown product and store results.
  6. Checkout prefill fills recipient, phone, address, city, state, and pincode.
  7. An admin editing the legacy customer `address` leaves the new `addresses` array intact.

- [ ] **Step 6: Commit only if verification required a fix.**

If no fix was needed, do not create an empty commit. If a fix was needed:

```bash
git add -A
git commit -m "fix: correct address-book verification findings"
```

---

## Self-review

- Spec coverage: migration/column, pure rules, transactions, address API, shared location predicates, public branches, Nominatim proxy, frontend services/hook, chip/modal/form/styles, page integration, and verification each have an owning task.
- Placeholder scan: every code-bearing step supplies exact code, commands, expected results, and commit operations. The plan contains no unfinished markers or cross-task shorthand instructions.
- Type consistency: `SavedAddress`, service signatures, hook API, modal/form props, and route response shapes use the same names across tasks.
- Review Focus: concurrency, admin/legacy collision, logged-out behavior, Nominatim failure behavior, and malformed location inputs are assigned to Tasks 3, 3, 9, 6/8/10, and 2/5/7/9 respectively.
