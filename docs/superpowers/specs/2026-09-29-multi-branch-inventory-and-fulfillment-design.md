# Multi-Branch Inventory & Location-Based Ordering — Design

**Date:** 2026-09-29
**Status:** Approved in chat; pending spec review
**Scope:** Turn the existing QuickKart/earth-dhanya ecommerce app into a multi-branch
inventory + automatic location-based fulfilment system, without rebuilding it.

---

## 1. Context and decisions

### 1.1 What exists

Four apps and one live PostgreSQL database:

| Path | Port | Role | Stack |
|---|---|---|---|
| `backend/` | 3000 | API | Next.js 16 App Router, raw `pg` |
| `frontend/` | 5173 | Admin panel | Vite + React 19 + react-router 7 |
| `frontend/storepanel/` | 5175 | Store (branch) panel | Vite, 1-file app importing `frontend/src` |
| `frontend/storepub/` | 5174 | Customer panel | Vite; currently mounts **two** storefronts |
| `quickkart-server/` | 5000 | — | Express + Mongoose, **unreferenced** |

Live DB `ecommerce`: 34 tables, 24 users, 11 orders, 26 order items, 4 branches,
2 `branch_products` rows, 1 inventory transaction, 250 countries / 5308 states /
152646 cities. **This is real data. All migrations are additive.**

### 1.2 Decisions taken (approved by the user)

1. **All three panels are kept** at their existing ports. Nothing is rebuilt.
2. **Customer site = the legacy `Storefront.jsx`.** QuickKart is removed.
3. **Permissions are enforced properly** — `authorize()` will really check.
4. **Admin's stock pool is the existing `products.stock` column.**

### 1.3 The load-bearing discovery

PostgreSQL folds unquoted identifiers to lowercase, so `SELECT *` returns
`branchid`, `sellingprice`, `stockquantity` — but the models read
`row.branchId`, `row.sellingPrice`, `row.stockQuantity`, which are
**`undefined`**. Writes appear to work; reads silently return nothing.

Verified directly against the live database:

```
branches row keys: id, uuid, name, code, ... addressline1, deliveryradius, ...
  row.addressLine1 = undefined      <- what the code reads
  row.addressline1 = null           <- what Postgres returns

branch_products keys: ... sellingprice, stockquantity, reservedquantity, availablequantity ...
branchStockTransfer.create(): INSERT with transferNumber SUCCEEDS
  returned keys: ... transfernumber, sourcebranchid ...
  r.rows[0].transferNumber = undefined
  r.rows[0].sourceBranchId  = undefined
```

`branchInventoryTransaction.js` already does it correctly with explicit
`AS "branchId"` aliases. That is the pattern the whole codebase converges on.

**Consequence:** auto branch assignment cannot be built first. It reads
`availablequantity` and `reservedquantity` through exactly these broken paths.

### 1.4 Naming: DB vs code

Keep the **database lowercase** (renaming columns on live data is the risky
option). SQL may continue to *write* unquoted camelCase — Postgres folds it — but
every **read** must alias explicitly. `backend/sql/schema.sql` is corrected to
match the live database, including the `countries`/`states`/`cities` tables it
currently omits.

---

## 2. Audit summary

### 2.1 Already working — preserve

- Branch/inventory data model: `branches(latitude, longitude, deliveryradius,
  deliveryenabled, status)`, `branch_products(stockquantity, reservedquantity,
  availablequantity GENERATED STORED)`, header/items transfers, ledger table with
  `previousstock`/`newstock`/`referencetype`/`referenceid`.
- `requireBranchAccess()` (`lib/authorization.js:121-162`) — a correct,
  genuinely-enforced branch guard, used by all 10 store-panel routes.
- Checkout's guarded stock decrement
  (`orders/store/route.js:296`, `AND stockquantity - reservedquantity >= $1`)
  inside a transaction with rollback.
- Branch price precedence at checkout (`bp.sellingprice` over `products.price`).
- RBAC schema (users/roles/permissions/modules + 4 join tables).
- Customer storefront: catalog, product detail, cart, checkout, order tracking,
  account, address book.
- `frontend/src/lib/geocode.js` + `components/UseCurrentLocation.jsx` — working
  geolocation + reverse geocode, currently used only by admin forms.
- No SQL injection anywhere; no committed secrets; `.env*` gitignored.

### 2.2 Broken

Critical:
1. `authorize()` ignores its argument — the entire permission model is inert.
2. `forgot-password` issues no token; `reset-password` takes `{email, password}`
   and runs `UPDATE users SET password = $1 WHERE email = $2`. Unauthenticated
   account takeover.
3. All 12 `/api/branches/[id]/**` routes have **zero** branch check.
4. `/api/store/addresses` has no auth at all — reads and overwrites any
   customer's PII by `?email=`.
5. Stock transfers never move stock; status is client-controlled; no ledger rows.
6. `reservedquantity` is never written — no reservation exists.
7. One ledger write in the entire app; five other sites mutate stock bare.
8. Column-case bug (§1.3).

High: unauthenticated order enumeration by email (`store/orders/track`);
`branches/nearby` 500s (`HAVING` without `GROUP BY`); `store/products` duplicate
rows from an unconstrained `LEFT JOIN branch_products` and 500s on
`pincode`+`lat`/`lng`; `orders/store` accepts payment methods the DB `CHECK`
rejects; `MAX(id)+1` order numbers race; admin cancel does not restock;
`PATCH store/my/products/[uuid]` zeroes price and stock on any partial update;
`variant-pricing` wipes all variants; four routes 500 from missing imports or
undeclared `params`; no seeded users/branches/inventory/permissions.

### 2.3 Missing

Auto branch matching; reservation lifecycle; partial/discrepancy receiving;
transfer admin + receiving UI; location-aware availability; "notify me" backend;
`payments`, `audit_logs`, `delivery_addresses`, `notifications`,
`availability_subscriptions`; `orders.latitude/longitude`; multi-branch
fulfilment setting; admin order reassignment; rate limiting, security headers,
tests, CI; geo indexes.

### 2.4 Duplicates

Two backends (`backend/` live, `quickkart-server/` dead); two customer
storefronts (legacy live, QuickKart dead); admin `BranchDashboard`/`BranchOrders`
vs `storepanel`; `Inventory.jsx` vs `BranchInventory.jsx`; `Branches.jsx` vs
`Stores.jsx`; dual stock truth (`products.stock` vs `branch_products.stockquantity`).

---

## 3. Architecture

### 3.1 Module boundaries

New backend modules, each with one job:

| Module | Responsibility | Depends on |
|---|---|---|
| `lib/geo.js` | haversine, bounding box, radius filter | — |
| `lib/fulfillment.js` | `findFulfillmentBranch`, candidate ranking | `geo`, `db` |
| `lib/availability.js` | which products are deliverable to a location | `geo`, `db` |
| `lib/inventory.js` | `applyStockChange()`, `reserve()`, `release()`, `finalizeSale()` | `db` |
| `lib/transfers.js` | transfer state machine + stock movement | `inventory` |
| `lib/notifications.js` | create + deliver notification | `mail` |
| `lib/audit.js` | `auditLog(actor, action, entity, meta)` | `db` |

`inventory.js` is the **only** module permitted to write `branch_products`
stock/reserved columns or insert ledger rows. Everything else calls it. This is
what makes requirement §7 ("never modify stock without recording why") structural
rather than a convention.

### 3.2 Fulfilment algorithm

`findFulfillmentBranch({ lat, lng, items, excludeBranchIds })`

1. Load active branches with `deliveryenabled = TRUE` and non-null coordinates.
2. Bounding-box prefilter on `latitude`/`longitude` (composite btree) using a
   generous radius (max delivery radius + margin) so the index is used before
   any trigonometry.
3. Exact haversine in SQL; drop branches where distance > `deliveryradius`.
   Branch with NULL `deliveryradius` is treated as unlimited.
4. Drop branches outside `openingtime`/`closingtime` (in branch `timezone`).
5. For each remaining branch, verify **every** cart line has
   `availablequantity >= qty`, `isavailable = TRUE`, `status = 'ACTIVE'`.
6. Rank: can-fulfill-whole-order → distance ascending → `priority` (new column,
   admin-set, default 100) → branch id for determinism.
7. Return the winner with its distance, plus the rejected candidates and the
   reason each failed (for diagnostics and for "unavailable in your area").

When no single branch can fulfil the whole cart the behaviour depends on a
`settings.allow_multi_branch_fulfilment` boolean, default **false**:

- **false (default)** — the order is refused with "Some items in your cart are no
  longer available. Please review your cart."
- **true** — lines are assigned greedily to the nearest eligible branch that has
  stock, so `order_items.branchid` (the column already exists) can differ within
  one order. Reservations are then taken per branch. `orders.branchid` is set to
  the branch holding the most lines, for reporting only; it is not the sole
  fulfiller.

### 3.3 Reservation and oversell prevention

Single transaction, `SELECT ... FOR UPDATE` on each `branch_products` row
(ordered by `productid` to avoid deadlock):

```
BEGIN
  SELECT productid, stockquantity, reservedquantity
    FROM branch_products
   WHERE branchid = $b AND productid = ANY($ids)
   ORDER BY productid
   FOR UPDATE;
  -- verify availablequantity >= qty for every line, else ROLLBACK
  UPDATE branch_products SET reservedquantity = reservedquantity + qty ...
  INSERT INTO orders (...)            -- order created in the same tx
  INSERT INTO branch_inventory_transactions (... 'RESERVATION' ...)  -- Phase 2
  INSERT INTO order_status_history (...)
COMMIT
```

Lifecycle: **reserve** on order creation → **release** on cancel/failure
(`RETURN` ledger row) → **finalize** on delivery (`stockquantity -= qty` and
`reservedquantity -= qty` together, `ORDER` ledger row). Two concurrent
customers cannot buy the last unit: the second blocks on the row lock, then
re-reads and fails the `availablequantity` check.

Order numbers move from `MAX(id)+1` to a Postgres sequence
`order_number_seq`, formatted `ORD-%s` with zero padding.

### 3.4 Transfer state machine

```
DRAFT ──dispatch──> DISPATCHED ──> IN_TRANSIT ──> RECEIVED            (full receipt)
                                        │     └─> PARTIALLY_RECEIVED
                                        │             │
                                        │             └──> RECEIVED (remaining received)
                                        │             └──> DISCREPANCY  (short/over, closed manually)
                                        └──cancel (any non-terminal)──> CANCELLED
```

`branch_transfer_items` gains `received_quantity INTEGER NOT NULL DEFAULT 0`.

- **Dispatch**: decrement source `stockquantity` and `products.stock` (the admin
  pool), guarded so it cannot go negative; ledger `TRANSFER_OUT`.
- **Receive**: increment destination by `received_quantity` **as entered by the
  branch**, never the sent quantity. Sent 20 / received 18 → destination gains
  18; the ledger records a `TRANSFER_IN` of 18, and the 2-unit gap is recorded on
  `branch_transfer_items` (with a `discrepancy_quantity` column) plus an
  `audit_logs` row. The transfer item's status becomes `DISCREPANCY`. No
  `DISCREPANCY` ledger transaction type is invented — the ledger only ever
  records stock that actually moved.
- `approvedbyid`/`receivedbyid` come from the authenticated session, never the
  request body.
- Transfer numbers use a sequence: `ST-YYYYMMDD-NNNN`.

### 3.5 Location-aware availability

`getAvailabilityForLocation({ lat, lng, productIds })` returns, per product, the
best eligible branch and whether it is deliverable. Used by:

- catalog listing — products with no eligible branch are hidden or marked
  unavailable for that location;
- product detail — renders **"Currently unavailable in your area"** plus
  **"Notify me when available"**;
- checkout — re-runs the full check (§17 of the requirements). On failure:
  **"Some items in your cart are no longer available. Please review your cart."**
- when **no** branch serves the location at all: **"We currently don't deliver to
  this location."**

The customer is never shown a branch name, list, or selector.

### 3.6 Data model additions

New tables (additive, no existing data touched):

| Table | Purpose |
|---|---|
| `notifications` | `user_id`/`customer_id`, `type`, `title`, `body`, `data JSONB`, `read_at` |
| `availability_subscriptions` | `customer_id`, `product_id`, `lat/lng`, `address JSONB`, `channel`, `status` |
| `audit_logs` | `actor_user_id`, `action`, `entity_type`, `entity_id`, `meta JSONB`, `ip`, `created_at` |
| `delivery_addresses` | `customer_id`, label, fields, `latitude`, `longitude`, `is_default` |
| `payments` | `order_id`, method, amount, status, gateway ref, timestamps |

New columns:

| Table | Column | Purpose |
|---|---|---|
| `orders` | `latitude`, `longitude` | snapshot of the delivery point, so branch choice is replayable and auditable after the fact |
| `branches` | `priority INTEGER NOT NULL DEFAULT 100` | admin-set tiebreaker in branch ranking (lower wins) |
| `branch_transfer_items` | `received_quantity INTEGER NOT NULL DEFAULT 0` | what the branch actually took |
| `branch_transfer_items` | `discrepancy_quantity INTEGER NOT NULL DEFAULT 0` | sent − received |
| `settings` | `allow_multi_branch_fulfilment BOOLEAN NOT NULL DEFAULT FALSE` | the configurable split rule |

`shared/constants.js` gains the missing enums (`TRANSFER_STATUS`,
`INVENTORY_TRANSACTION_TYPE`, `BRANCH_STATUS`, `BRANCH_PRODUCT_STATUS`,
`FULFILMENT_REJECT_REASON`) so the branch subsystem stops hard-coding strings
that have drifted from the SQL `CHECK` constraints.

Deliberately **not** added: `product_images` and `product_prices`.
`products.images` and `branch_products.sellingprice` already cover them; new
tables would be the duplication the requirements warn against.

### 3.7 Customer flow

```
Home → Products → Product → Cart → Location → Checkout → Order Tracking
```

No store/branch control anywhere. Location comes from
`frontend/src/lib/geocode.js` (geolocation + reverse geocode), falling back to a
manual address; coordinates are sent to the catalog and to checkout, and
**snapshotted onto the order**. The backend ignores any client-sent `branchId`.

### 3.8 Security model

- `authorize(permission)` performs a real permission check; `super_admin` passes
  everything. All `branches.*` and `dashboard.view` permissions get seeded and
  granted by role, so nobody is locked out by the change.
- Every `/api/branches/[id]/**` route calls `requireBranchAccess(branchId)` or
  requires super-admin. Branch users cannot read another branch by changing an
  ID.
- `store/addresses` requires authentication and verifies the customer identity.
- `reset-password` requires a signed, single-use, expiring token.
- `store/orders/track` requires `order_number` **and** email (removing the
  email-only enumeration path) and is rate-limited.
- Rate limiting on auth, checkout, track and upload; security headers via
  `next.config.ts`; upload restricted by MIME, extension, magic bytes and size
  with SVG sanitised or disallowed.

---

## 4. Phases

Each phase is independently shippable and leaves the system working.

### Phase 1 — Foundation: data integrity + security

No new features. Make the codebase trustworthy.

1. **Column-case fix.** Add explicit `AS "camelCase"` aliases everywhere; fix the
   8 `SELECT *` sites in `branchProduct.js` / `branchStockTransfer.js`; fix
   `branch.js` column constant lists. Correct `schema.sql` to match the live DB.
2. **Permission enforcement + seed.** Make `authorize()` real. Seed the
   `branches` module, the 10 `branches.*` permissions, `dashboard.view`, and the
   `branch_manager` role; align `store.*` vs `store_*` slugs. Verify no existing
   user loses access.
3. **Branch scoping** on all 12 `/api/branches/[id]/**` routes.
4. **`store/addresses` authentication.**
5. **Reset-password token** (signed, expiring, single-use) + rate limiting.
6. **Fix the 500 routes**: missing `Branch`/`BranchProduct`/`paginate` imports,
   undeclared `params`, `branches/[id]/orders` updating by the wrong uuid,
   `updateStatus` bind-parameter mismatch.
7. **Order number sequence**; align `paymentMethod` with the DB `CHECK`.
8. **Ledger discipline**: route all stock mutations through `applyStockChange()`;
   extend the `transactiontype` CHECK with `RESERVATION` and `RELEASE` now (the
   reservation lifecycle that writes them lands in Phase 3).
9. **Partial-update safety**: `PATCH store/my/products/[uuid]` and
   `variant-pricing` must not zero columns the caller did not send.
10. **Hardening**: `store/orders/track` requires order number, rate limits,
    security headers, upload MIME/size/magic-byte checks.
11. **Verification**: a repeatable end-to-end script exercising the flows that
    already exist.

### Phase 2 — Inventory & stock transfers

Transfer documents (`ST-YYYYMMDD-NNNN`), full status machine, partial/discrepancy
receiving, ledger on every movement, admin transfer UI, branch receiving UI,
transfer numbering sequence, `branches.priority`.

### Phase 3 — Location-based fulfilment & reservations

`geo.js`, `fulfillment.js`, `inventory.js` reservation lifecycle, `orders.latitude/longitude`,
order-number sequence, order status machine + history, admin order reassignment
with audit, `allow_multi_branch_fulfilment` setting, checkout re-validation.

### Phase 4 — Availability & notifications

`availability.js`, location-aware catalog/product detail, "Currently unavailable
in your area", "Notify me when available", `availability_subscriptions` +
`notifications`, trigger on stock increase, `delivery_addresses` + `payments`.

### Phase 5 — Panels, UX & performance

Admin dashboard widgets (today's orders/sales, low/out-of-stock, stock value),
consolidate `Branches`/`Stores` and `BranchDashboard`/`BranchOrders` duplication,
customer location + availability UX, `response.ok` error handling across the 19
service modules, missing indexes (`order_items` has none; `orders` lacks
`status`/`created_at`/`customer_id`), geo index, 404/error boundaries, tests + CI.

---

## 5. Testing

Phase 1 verification (no test framework exists yet — Phase 5 adds one; Phase 1
adds a runnable script):

| # | Scenario | Expected |
|---|---|---|
| 1 | `branch_products` read through a model | camelCase keys present, not `undefined` |
| 2 | `super_admin` calls a `branches.*` route | 200 |
| 3 | `store` user reads own branch | 200 |
| 4 | `store` user reads another branch by uuid | **403** |
| 5 | `store` user POSTs to `store/addresses` unauthenticated | **401** |
| 6 | `reset-password` with a valid token | 200 |
| 7 | `reset-password` with an expired/absent token | **400/400** |
| 8 | Previously-500 routes (`branches/[id]`, `nearby`, etc.) | 200, no ReferenceError |
| 9 | Two concurrent `orders/store` competing for the last unit | exactly one 201; the other **409** with "Some items in your cart are no longer available." No oversell, no duplicate order number |
| 10 | `PATCH store/my/products/[uuid]` sending only `isAvailable` | price + stock unchanged |
| 11 | Every stock mutation | a matching ledger row exists |
| 12 | Existing data intact | row counts unchanged; 11 orders, 4 branches, 24 users still present |

Phases 2–5 extend this with the 17 scenarios in the requirements (transfer send →
receive → inventory updates, location detection, automatic branch assignment,
notify-me, simultaneous final-stock purchase).

---

## 6. Out of scope

- Payments gateway integration (`payments` table is created; the gateway is not
  implemented — COD/upi/card remain recorded states).
- Delivery-partner/dispatcher apps.
- Customer accounts beyond what `customers` already provides.
- PostGIS. A composite btree + bounding box + exact haversine satisfies the
  performance requirement without an extension migration.
- `quickkart-server/` is left on disk untouched (untracked, unreferenced) and
  reported, not deleted, since deletion is destructive and unrequested.
