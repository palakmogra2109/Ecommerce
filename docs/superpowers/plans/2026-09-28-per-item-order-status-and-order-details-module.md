# Per-item order status and consolidated order details — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every order line its own fulfilment status that rolls up into the order status, and render all order details from one shared data module and one shared component.

**Architecture:** Item status becomes the source of truth. A pure `rollUpOrderStatus` in `shared/constants.js` derives the order status from the furthest-behind item; `backend/lib/orderStatus.js` owns the transactional writes. The API exposes per-item `PATCH` endpoints for stores and branches, and every read endpoint returns `itemStatus`. On the frontend, `frontend/src/lib/orderDetail.js` normalizes the three divergent API shapes into one object, and `frontend/src/components/OrderDetails.jsx` renders it. Cancellation stays order-level and overrides the roll-up.

**Tech Stack:** Next.js App Router (backend, plain JS, no test framework), Vite + React (three frontend apps), PostgreSQL via `pg`, Node `node:assert/strict` verification scripts.

**Spec:** `docs/superpowers/specs/2026-09-28-per-item-order-status-and-order-details-module-design.md`

## Global Constraints

- **No npm workspaces.** Each app installs separately: `backend/`, `frontend/`, `frontend/storepub/`, `frontend/storepanel/`. Run every command from its own directory.
- **New `order_items` columns are snake_case:** `item_status`, `item_status_updated_at`. schema.sql writes FK columns in camelCase (`branchId`) and Postgres folds them to lowercase (`branchid`); reference the folded name in every query and never double-quote an identifier.
- **Item status vocabulary is exactly the 7 `ORDER_FLOW` values.** `CANCELLED` and `REFUNDED` are order-level only and must never be written to `order_items.item_status`.
- **Roll-up is the slowest item and can only produce `ORDER_FLOW` values.** It never returns `CANCELLED` or `REFUNDED`.
- **Forward-only.** A backwards status move is rejected with HTTP 400. Re-selecting the current status is a permitted no-op.
- **Do not add a CHECK constraint to `item_status`.** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` silently skips an existing column, so a constraint added that way would not apply. Validation lives in `shared/constants.js`.
- **Do not run the whole `backend/sql/schema.sql` against the live database.** It already fails at line 615 (`CREATE INDEX ... ON branch_inventory_transactions(created_at)` — the live table has `createdat`). That failure is pre-existing and unrelated. Apply new DDL with a targeted `psql -c` or a scratch file.
- **Do not change** the `orders.payment_method` drift, `Order.PUBLIC_COLUMNS` dead code, or `authorize()`'s unenforced permissions. Out of scope.
- **Do not delete test order `ORD-0000021`.**
- **Tests are Node scripts, not a framework.** Follow `frontend/scripts/verify-geocode.mjs`: `node:assert/strict`, top-level asserts, one `ok` marker at the end. Run `node frontend/scripts/verify-order-status.mjs`.
- **Pure frontend lib files use relative imports, never `@shared`.** `frontend/src/lib/orderDetail.js` must import `../../../shared/constants.js` so the Node test script can load it; `@shared` is a Vite-only alias Node cannot resolve. JSX components may use `@shared/constants` freely.
- **Lint baselines — do not exceed:** `backend` = 34 warnings / 0 errors (`npx eslint`). `frontend` = oxlint, no new warnings. `storepub` and `storepanel` have **no lint script**; verify them with `npm run build` only.
- Commit after every task. If a hook rejects a commit, fix it and make a new one; never amend.
- The working tree has unrelated uncommitted user work. Do not `git add -A`, do not `git checkout` over those files, do not revert them. Stage explicit paths only.

## Review Focus

Failure modes the spec implies that no happy-path test covers. Each has its test in the owning task.

1. **A stale polling response overwrites a newer one.** Two in-flight 10s fetches can resolve out of order, so the customer sees an item jump *backwards* while the store advances it. → Task 10.
2. **An item write on a concurrently cancelled order resurrects it.** A store advances an item at the same moment an admin cancels; the roll-up must not write a flow status over `CANCELLED`. → Task 4.
3. **An order with zero items.** An order whose lines were all deleted makes the roll-up receive `[]` and the detail screen receive `items: []`. It must show PENDING and render an empty list, never crash or print "undefined". → Tasks 2 and 6.
4. **A `quantity: 3` line is one status, not three.** A customer must not see three identical rows or be told three items are packing when one line of three units is. → Tasks 6 and 7.
5. **An address with no `address`/`line1` key at all.** Orders created before the checkout address fields existed produce a `shipping_address` missing the street line. The normalizer must render what exists and never print "undefined". → Task 6.
6. **`DELIVERED` is the last member of `ORDER_FLOW`, so testing flow membership is the wrong way to detect a finished order.** Any `!ORDER_FLOW.includes(status)` or `ORDER_FLOW.includes(status)` test gets `DELIVERED` exactly backwards: the first calls it non-terminal, the second keeps polling it forever. Use `isClosedOrderStatus`. → Tasks 6 and 10.
7. **A list row's per-item control has no item id.** The list aggregates return a status summary per item, but a control that cannot name the item it is changing has nothing to `PATCH`. Item ids must be in the aggregate. → Task 3.

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `shared/package.json` | `{"type": "module"}` so Node can `import` `shared/constants.js`. Without it Node treats the file as CommonJS and named imports fail. Verified not to break any of the four builds. |
| `backend/lib/orderStatus.js` | Transactional writes only. Owns roll-up-on-write and order→items propagation. No React, no routes. |
| `backend/lib/models/orderItem.js` | Per-item reads: list by order, find with parent order, item history, history insert. |
| `backend/app/api/store/my/orders/[uuid]/items/[itemId]/route.js` | Store-manager item status `PATCH`. Gated by `requireBranchAccess`. |
| `backend/app/api/branches/[id]/orders/[orderId]/route.js` | Fixes an existing 404: `services/branches.js:155` PATCHes this path and no handler exists. |
| `backend/app/api/branches/[id]/orders/[orderId]/items/[itemId]/route.js` | Branch-manager item status `PATCH`. |
| `frontend/src/lib/orderDetail.js` | Pure `normalizeOrder(raw)` plus item, timeline, and polling helpers. |
| `frontend/src/components/OrderDetails.jsx` | Presentational order details. Receives a normalized order. |
| `frontend/src/components/OrderDetails.css` | Imported by `OrderDetails.jsx` itself, because the storefront does **not** load `index.css`. |
| `frontend/scripts/verify-order-status.mjs` | All pure-logic tests. Grows across Tasks 2, 6, 10. |

**Modified**

| Path | Change |
|---|---|
| `backend/sql/schema.sql` | Append: 2 columns, 1 index, history table, 1 index, 1 backfill `UPDATE`. |
| `shared/constants.js` | Add `ORDER_CLOSED_STATUSES`, `isClosedOrderStatus`, `isForwardStatusMove`, `rollUpOrderStatus`. |
| `backend/lib/models/order.js` | `getDetailByUuid` returns `item_status` and `item_status_history` per item; add `listWithItemStatuses` (whose `item_statuses` include each item's `id`). |
| `backend/app/api/orders/[id]/route.js` | `GET` returns item statuses; `PATCH` routes status through `applyOrderStatusChange`, and accepts a payment-only body. |
| `backend/app/api/store/my/orders/[uuid]/route.js` | `GET` returns `itemStatus` and `itemStatusHistory`; `PATCH` accepts `REFUNDED`, delegates to `applyOrderStatusChange`. |
| `backend/app/api/store/orders/track/route.js` | Items return `itemStatus` and `itemStatusHistory` as camelCase; fix `trackable` to test `ORDER_FLOW` instead of the nonexistent `"PLACED"`. |
| `backend/app/api/branches/[id]/orders/route.js` | `GET` uses `listWithItemStatuses`; remove its duplicate `PATCH`. |
| `backend/app/api/store/my/orders/route.js` | `GET` includes per-item statuses for list badges. |
| `frontend/src/pages/OrderView.jsx` | Render through `normalizeOrder` + `OrderDetails`. |
| `frontend/src/pages/StorePanel.jsx` | Shared `ORDER_STATUSES` filter, per-item badges with a per-item control each, order-level cancel only. |
| `frontend/src/pages/BranchOrders.jsx` | Shared forward-move rule instead of the local `NEXT_STATUS` map; per-item badges and controls. |
| `frontend/src/pages/Storefront.jsx` | `OrderTrack`: shared timeline, `OrderDetails`, 10s polling, email-only pick-list. Removes `STEPS`/`LABELS`. |
| `frontend/storepub/vite.config.js` | Add `@shared` alias. |
| `frontend/storepanel/vite.config.js` | Add `@shared` alias. |
| `frontend/src/services/orders.js` | Add `updateOrderItem`. |
| `frontend/src/services/branches.js` | Add `updateBranchOrderItem`. |
| `frontend/src/services/store.js` | Add `storeUpdateOrderItem`. |

---

## Task 1: Schema — item status columns, history table, backfill

**Files:**
- Modify: `backend/sql/schema.sql` (append at end of file)
- Create: `/tmp/apply-order-item-status.sql` (scratch, not committed)

**Interfaces:**
- Consumes: nothing.
- Produces: `order_items.item_status TEXT NOT NULL DEFAULT 'PENDING'`, `order_items.item_status_updated_at TIMESTAMPTZ`, table `order_item_status_history(id, order_item_id, status, note, changed_by, created_at)`. Every later task reads these.

- [ ] **Step 1: Record the pre-change state**

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='order_items' AND column_name IN ('item_status','item_status_updated_at');"
psql "$DATABASE_URL" -t -c "SELECT to_regclass('order_item_status_history') IS NULL;"
psql "$DATABASE_URL" -t -c "SELECT o.status, count(*) FROM orders o GROUP BY o.status ORDER BY 2 DESC;"
psql "$DATABASE_URL" -t -c "SELECT md5(string_agg(oi.id || ':' || oi.order_id, ',' ORDER BY oi.id)) FROM order_items oi;"
```

Expected: `0`, `t`, then the status histogram (PENDING 1, CONFIRMED 1, PROCESSING 1, SHIPPED 1, DELIVERED 2, CANCELLED 2), then a hash.

Record that hash. It covers only the item **ids** and their order ids, never `item_status`, because that column does not exist yet and querying it here would abort the whole step. Task 11 re-runs this exact query, so a changed hash would mean an item row was added, removed, or re-parented — which no task in this plan is supposed to do. Item *status* distribution is covered by the histogram above and re-checked per-order in Task 11.

- [ ] **Step 2: Append the DDL to schema.sql**

Append exactly this to the end of `backend/sql/schema.sql`:

```sql
-- =============================================================
-- Per-item order status
-- =============================================================

-- Each order line carries its own fulfilment status so a customer can see
-- one item packing while another is still processing. The order's own status
-- is rolled up from these (the furthest-behind item wins).
-- Only ORDER_FLOW values belong here: CANCELLED and REFUNDED are order-level
-- states set directly, and they override the roll-up.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_status_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS order_items_status_idx ON order_items(item_status);

-- Backfill so existing orders do not regress to PENDING on first roll-up: a
-- DELIVERED order whose items are still PENDING would report as PENDING.
-- Idempotent, because only rows still sitting at the default are touched, so
-- re-running never overwrites an item that has genuinely been advanced.
-- PENDING is excluded because the default already matches it.
UPDATE order_items oi
SET item_status = o.status, item_status_updated_at = now()
FROM orders o
WHERE o.id = oi.order_id
  AND oi.item_status = 'PENDING'
  AND o.status IN ('CONFIRMED','PROCESSING','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED');

-- Per-item audit trail, mirroring order_status_history, so a customer can see
-- when each individual line changed.
CREATE TABLE IF NOT EXISTS order_item_status_history (
  id            BIGSERIAL PRIMARY KEY,
  order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  changed_by    TEXT NOT NULL DEFAULT 'system',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oish_item_idx ON order_item_status_history(order_item_id);
```

- [ ] **Step 3: Apply just this block, not the whole file**

`schema.sql` cannot be run end to end (see Global Constraints). Extract the appended block and run it alone.

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
sed -n '/^-- Per-item order status$/,$p' backend/sql/schema.sql | tail -n +4 > /tmp/apply-order-item-status.sql
head -1 /tmp/apply-order-item-status.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/apply-order-item-status.sql
```

`tail -n +4` skips the matched comment line, the closing rule, and the blank line, leaving the first statement. `tail -n +3` would stop one line early and hand psql a file beginning with a blank line — harmless, but `head` would then show nothing useful, which is exactly the point of checking.

Expected: `head` prints `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_status ...` as the first line, and psql reports the two ALTERs, the index, the `UPDATE`, the table and the index, with no `ERROR`.

- [ ] **Step 4: Verify the schema landed and the backfill is correct**

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -c "\d order_items" | grep -E "item_status"
psql "$DATABASE_URL" -c "\d order_item_status_history"
psql "$DATABASE_URL" -c "SELECT o.status AS order_status, oi.item_status, count(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id GROUP BY 1,2 ORDER BY 1,2;"
psql "$DATABASE_URL" -t -c "SELECT count(*) FROM order_items WHERE item_status NOT IN ('PENDING','CONFIRMED','PROCESSING','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED');"
```

Expected: both columns present; the history table has all six columns; every non-cancelled order's items equal the order's status; **the last query returns `0`**, proving no item holds a value outside `ORDER_FLOW`. The two `CANCELLED` orders' items stay `PENDING`, which is the designed override.

- [ ] **Step 5: Verify the backfill is idempotent**

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -t -c "SELECT md5(string_agg(oi.id || ':' || oi.order_id, ',' ORDER BY oi.id)) FROM order_items oi;"
psql "$DATABASE_URL" -t -c "SELECT o.status, oi.item_status, count(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id GROUP BY 1,2 ORDER BY 1,2;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/apply-order-item-status.sql > /dev/null
psql "$DATABASE_URL" -t -c "SELECT md5(string_agg(oi.id || ':' || oi.order_id, ',' ORDER BY oi.id)) FROM order_items oi;"
psql "$DATABASE_URL" -t -c "SELECT o.status, oi.item_status, count(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id GROUP BY 1,2 ORDER BY 1,2;"
```

Expected: the two hashes are identical (no row was added, removed, or re-parented) and the two status pairings are identical (re-running the backfill changed nothing). The second pair of queries is the one that proves idempotency, since a second pass could in principle move an item's status without touching its id.

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add backend/sql/schema.sql
git commit -m "feat(orders): per-item status columns, history table, and backfill

Item status becomes the source of truth for fulfilment, so each order line
needs its own status and a per-line audit trail mirroring
order_status_history.

Existing items are backfilled from their parent order, otherwise a DELIVERED
order whose items sit at the default PENDING would roll up to PENDING on the
first read.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared pure order-status rules, with tests

**Files:**
- Create: `shared/package.json`
- Modify: `shared/constants.js` (insert after the `ORDER_FLOW` declaration, line 379)
- Create: `frontend/scripts/verify-order-status.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces — all pure, importable by the backend, all three frontends, and the Node test script:
  - `ORDER_CLOSED_STATUSES: readonly string[]` — `[DELIVERED, CANCELLED, REFUNDED]`
  - `isClosedOrderStatus(status): boolean`
  - `isForwardStatusMove(current, next): boolean`
  - `rollUpOrderStatus(itemStatuses: string[]): string`

- [ ] **Step 1: Create `shared/package.json`**

Node treats a `.js` file with no `package.json` above it as CommonJS, so `import { ORDER_FLOW } from "shared/constants.js"` inside a `.mjs` script fails with *"Named export 'ORDER_FLOW' not found"*. This file fixes the module type to match the syntax the file already uses. Verified not to break any of the four builds.

```json
{ "type": "module" }
```

- [ ] **Step 2: Write the failing test script**

Create `frontend/scripts/verify-order-status.mjs`:

```js
// Covers the pure order-status rules shared by the backend, all three frontend
// apps, and the API: which statuses are closed, which moves are legal, and how
// an order's status is derived from its items. The transactional write path in
// backend/lib/orderStatus.js needs a database and is verified by the live
// psql/curl steps in the tasks that own it.
import assert from "node:assert/strict";
import {
  ORDER_FLOW,
  ORDER_STATUS,
  ORDER_CLOSED_STATUSES,
  isClosedOrderStatus,
  isForwardStatusMove,
  rollUpOrderStatus,
} from "../../shared/constants.js";

// --- rollUpOrderStatus: the order is always the furthest-behind item -------
assert.equal(rollUpOrderStatus([]), ORDER_STATUS.PENDING, "no items reads PENDING");
assert.equal(rollUpOrderStatus(["PENDING"]), ORDER_STATUS.PENDING);
assert.equal(rollUpOrderStatus(["CONFIRMED"]), ORDER_STATUS.CONFIRMED);
assert.equal(rollUpOrderStatus(["PACKED", "PROCESSING"]), ORDER_STATUS.PROCESSING,
  "the slowest item wins, not the fastest");
assert.equal(rollUpOrderStatus(["PENDING", "DELIVERED"]), ORDER_STATUS.PENDING,
  "one undelivered item holds the whole order back");
assert.equal(rollUpOrderStatus(["DELIVERED", "DELIVERED"]), ORDER_STATUS.DELIVERED);
assert.equal(rollUpOrderStatus(["OUT_FOR_DELIVERY", "PACKED"]), ORDER_STATUS.PACKED);
assert.equal(rollUpOrderStatus(["SHIPPED", "PENDING", "PACKED"]), ORDER_STATUS.PENDING,
  "position in the list must not matter, only the stage");

// Unknown values are ignored rather than crashing or escaping ORDER_FLOW.
assert.equal(rollUpOrderStatus(["BOGUS"]), ORDER_STATUS.PENDING);
assert.equal(rollUpOrderStatus(["BOGUS", "SHIPPED"]), ORDER_STATUS.SHIPPED);

// The roll-up can only ever produce ORDER_FLOW values. CANCELLED and REFUNDED
// are order-level states and must never be derivable from an item.
for (const bogus of [["CANCELLED"], ["REFUNDED"], ["CANCELLED", "DELIVERED"]]) {
  const rolled = rollUpOrderStatus(bogus);
  assert.ok(ORDER_FLOW.includes(rolled), `roll-up leaked ${rolled} from ${bogus}`);
  assert.notEqual(rolled, ORDER_STATUS.CANCELLED);
  assert.notEqual(rolled, ORDER_STATUS.REFUNDED);
}

// --- closed statuses -------------------------------------------------------
assert.deepEqual(ORDER_CLOSED_STATUSES, ["DELIVERED", "CANCELLED", "REFUNDED"]);
assert.equal(isClosedOrderStatus(ORDER_STATUS.DELIVERED), true);
assert.equal(isClosedOrderStatus(ORDER_STATUS.CANCELLED), true);
assert.equal(isClosedOrderStatus(ORDER_STATUS.REFUNDED), true);
assert.equal(isClosedOrderStatus(ORDER_STATUS.OUT_FOR_DELIVERY), false);
assert.equal(isClosedOrderStatus(undefined), false, "an unknown status is not closed");
assert.equal(isClosedOrderStatus("NONSENSE"), false);

// --- forward-only movement -------------------------------------------------
assert.equal(isForwardStatusMove(ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED), true);
assert.equal(isForwardStatusMove(ORDER_STATUS.PENDING, ORDER_STATUS.DELIVERED), true,
  "a move may skip stages");
assert.equal(isForwardStatusMove(ORDER_STATUS.PENDING, ORDER_STATUS.PENDING), true,
  "re-selecting the current status is a no-op, not an error");
assert.equal(isForwardStatusMove(ORDER_STATUS.PACKED, ORDER_STATUS.PENDING), false);
assert.equal(isForwardStatusMove(ORDER_STATUS.SHIPPED, ORDER_STATUS.PROCESSING), false);
assert.equal(isForwardStatusMove(ORDER_STATUS.PENDING, "BOGUS"), false,
  "an unknown target is never a legal move");
assert.equal(isForwardStatusMove(ORDER_STATUS.DELIVERED, ORDER_STATUS.PENDING), false);
// A side-exit to a closed status is not a flow move; the write path handles
// cancellation and refunds as explicit cases.
assert.equal(isForwardStatusMove(ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED), false);
assert.equal(isForwardStatusMove(ORDER_STATUS.PENDING, ORDER_STATUS.REFUNDED), false);

console.log("verify-order-status ok");
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /var/www/html/Node-JS/Ecommerce
node frontend/scripts/verify-order-status.mjs
```

Expected: FAIL with `SyntaxError: ... does not provide an export named 'ORDER_CLOSED_STATUSES'`. The `shared/package.json` from Step 1 is what makes the import itself resolve; the four functions do not exist yet.

- [ ] **Step 4: Add the rules to `shared/constants.js`**

Insert immediately after the `ORDER_FLOW` declaration:

```js
// Statuses after which fulfilment cannot change. DELIVERED ends the flow;
// CANCELLED and REFUNDED are order-level side-exits set directly on the order.
export const ORDER_CLOSED_STATUSES = Object.freeze([
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REFUNDED,
]);

export function isClosedOrderStatus(status) {
  return ORDER_CLOSED_STATUSES.includes(status);
}

// True when `next` is `current` or any later stage in ORDER_FLOW. Unknown
// targets are rejected; cancellation and refund are not flow moves and are
// handled as explicit cases by the write path.
export function isForwardStatusMove(current, next) {
  const nextIndex = ORDER_FLOW.indexOf(next);
  if (nextIndex === -1) return false;
  const currentIndex = ORDER_FLOW.indexOf(current);
  if (currentIndex === -1) return true;
  return nextIndex >= currentIndex;
}

// The order's fulfilment status is the furthest-behind item: if one item is
// packing and another is still processing, the order reads as the slower one.
// CANCELLED and REFUNDED are order-level states set directly, so they are not
// derived from items and are not accepted here. Unknown values are ignored so
// bad data cannot produce a crash or escape ORDER_FLOW.
export function rollUpOrderStatus(itemStatuses) {
  const reached = ORDER_FLOW.filter((status) =>
    itemStatuses.some((item) => item === status)
  );
  if (reached.length === 0) return ORDER_STATUS.PENDING;
  return reached[0];
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /var/www/html/Node-JS/Ecommerce
node frontend/scripts/verify-order-status.mjs
```

Expected: `verify-order-status ok`

- [ ] **Step 6: Mutation-check the tests**

Replace the body of `rollUpOrderStatus` with the wrong rule:

```js
export function rollUpOrderStatus(itemStatuses) {
  return itemStatuses[0] || ORDER_STATUS.PENDING;
}
```

Run `node frontend/scripts/verify-order-status.mjs` — it must FAIL on `"PACKED", "PROCESSING"`. Restore the correct body from Step 4 and re-run; it must print `verify-order-status ok`. Do not commit the mutant.

- [ ] **Step 7: Verify the shared module still loads in every consumer**

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm run build 2>&1 | tail -3
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run build 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/frontend/storepub && npm run build 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/frontend/storepanel && npm run build 2>&1 | tail -2
```

Expected: all four build successfully. `shared/package.json` is the only new input.

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add shared/package.json shared/constants.js frontend/scripts/verify-order-status.mjs
git commit -m "feat(orders): shared pure rules for item status and roll-up

rollUpOrderStatus, isForwardStatusMove and isClosedOrderStatus live beside
ORDER_FLOW so the backend and all three frontends share one definition
instead of the nine hardcoded status lists already in the tree.

The roll-up takes the furthest-behind item and can only return an ORDER_FLOW
value, so a cancelled or refunded order can never be reconstructed from its
items and silently un-cancelled.

shared/package.json marks the directory as ESM so the Node verification
script can import it; without it Node reads the file as CommonJS and named
imports fail.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Read item statuses through the API

**Files:**
- Create: `backend/lib/models/orderItem.js`
- Modify: `backend/lib/models/order.js:127-131` (`getDetailByUuid` items query) and append `listWithItemStatuses`
- Modify: `backend/app/api/store/my/orders/[uuid]/route.js:100-132` (GET)
- Modify: `backend/app/api/store/orders/track/route.js:52-96` (GET)
- Modify: `backend/app/api/branches/[id]/orders/route.js:27` (GET list)
- Modify: `backend/app/api/store/my/orders/route.js:44-60` (GET list)

**Interfaces:**
- Consumes: `order_items.item_status` (Task 1).
- Produces:
  - `OrderItem.listByOrderId(orderInternalId: number): Promise<object[]>` — includes `id`, `product_name`, `quantity`, `item_status`, `item_status_updated_at`.
  - `OrderItem.findById(id: number): Promise<object|null>` — includes parent `order_uuid`, `order_status`, `branchid`.
  - `OrderItem.statusHistory(orderItemId: number): Promise<object[]>` — oldest first.
  - `OrderItem.recordStatus(orderItemId, status, note = "", changedBy = "system", client = null): Promise<void>`
  - `Order.getDetailByUuid(uuid)` — items now carry `item_status` and `item_status_history` (snake_case, like the rest of the model layer).
  - `Order.listWithItemStatuses(options)` — same result shape as `Order.list`, plus `item_statuses: [{id, productName, quantity, status}]` per row.

- [ ] **Step 1: Create `backend/lib/models/orderItem.js`**

```js
import pool from "../db";

const TABLE = "order_items";

export const OrderItem = {
  TABLE,

  // Item lines for an order, oldest line first. item_status is exposed in
  // snake_case like every other column in this model layer; callers map it to
  // whichever casing their response uses.
  async listByOrderId(orderInternalId) {
    const result = await pool.query(
      `SELECT id, product_uuid, product_name, sku, variant, price, quantity,
              subtotal, item_status, item_status_updated_at
       FROM ${TABLE} WHERE order_id = $1 ORDER BY id ASC`,
      [orderInternalId]
    );

    return result.rows;
  },

  // One item plus the parent order fields a write path needs to authorise and
  // validate a change.
  async findById(id) {
    const result = await pool.query(
      `SELECT oi.id, oi.order_id, oi.product_name, oi.quantity, oi.item_status,
              o.uuid AS order_uuid, o.status AS order_status, o.branchid
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.id = $1`,
      [id]
    );

    return result.rows[0] || null;
  },

  // Full per-item timeline (oldest first) for one item.
  async statusHistory(orderItemId) {
    const result = await pool.query(
      `SELECT status, note, changed_by AS "changedBy", created_at AS "createdAt"
       FROM order_item_status_history
       WHERE order_item_id = $1
       ORDER BY created_at ASC, id ASC`,
      [orderItemId]
    );

    return result.rows;
  },

  // Appends one row to the per-item audit trail. Safe inside or outside a
  // transaction (pass an open client as `client` when in one).
  async recordStatus(orderItemId, status, note = "", changedBy = "system", client = null) {
    await (client || pool).query(
      `INSERT INTO order_item_status_history (order_item_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [orderItemId, status, note, changedBy]
    );
  },
};
```

- [ ] **Step 2: Expose `item_status` on the admin detail read**

In `backend/lib/models/order.js`, replace the items query inside `getDetailByUuid`:

```js
    const itemsResult = await pool.query(
      `SELECT oi.id, oi.product_uuid, oi.product_name, oi.sku, oi.variant, oi.price,
              oi.quantity, oi.subtotal, oi.item_status, oi.item_status_updated_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'status', h.status,
                  'note', h.note,
                  'changedBy', h.changed_by,
                  'createdAt', h.created_at
                ) ORDER BY h.created_at, h.id)
                FROM order_item_status_history h
                WHERE h.order_item_id = oi.id
              ), '[]'::json) AS item_status_history
       FROM order_items oi
       WHERE oi.order_id = (SELECT id FROM orders WHERE uuid = $1)
       ORDER BY oi.id ASC`,
      [uuid]
    );
```

The per-item history rides along as a lateral aggregate so the detail read stays a single round trip. Each item ends up with `item_status_history: [{status, note, changedBy, createdAt}]`, oldest first, which is the shape the shared `OrderDetails` component reads as `itemStatusHistory`.

- [ ] **Step 3: Add `listWithItemStatuses` to `Order`**

Append to the `Order` object. This exists because both list screens render per-item badges and the existing `list()` never touches `order_items`:

```js
  // Same shape as list(), plus a per-item status summary so list rows can show
  // where each line is without a second request per order. The lateral
  // subquery keeps the whole page one round trip.
  async listWithItemStatuses({ search = "", status = "", paymentStatus = "", branchId = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(o.order_number ILIKE $${params.length} OR o.customer_name ILIKE $${params.length} OR o.customer_email ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }

    if (paymentStatus) {
      params.push(paymentStatus);
      conditions.push(`o.payment_status = $${params.length}`);
    }

    if (branchId) {
      params.push(branchId);
      conditions.push(`o.branchid = (SELECT id FROM branches WHERE uuid = $${params.length})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return paginate(
      {
        baseSql: `
          SELECT o.uuid, o.order_number, o.customer_name, o.customer_email,
                 o.customer_mobile, o.subtotal, o.discount, o.total, o.coupon_code,
                 o.payment_method, o.payment_status, o.status, o.branchid,
                 o.created_at, o.updated_at,
                 b.uuid AS branch_uuid, b.name AS branch_name, b.code AS branch_code,
                 (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM order_items oi
                   WHERE oi.order_id = o.id) AS item_count,
                 COALESCE((
                   SELECT json_agg(json_build_object(
                     'id', oi.id,
                     'productName', oi.product_name,
                     'quantity', oi.quantity,
                     'status', oi.item_status
                   ) ORDER BY oi.id)
                   FROM order_items oi WHERE oi.order_id = o.id
                 ), '[]'::json) AS item_statuses
          FROM orders o
          LEFT JOIN branches b ON b.id = o.branchid
          ${where}
        `,
        countSql: `SELECT COUNT(*)::int FROM orders o ${where}`,
        params,
        orderBy: "ORDER BY o.created_at DESC, o.id DESC",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },
```

- [ ] **Step 4: Confirm the admin GET passes the new field through**

`backend/app/api/orders/[id]/route.js:55-61` returns `{ success: true, order, ... }` where `order` is the whole object from `Order.getDetailByUuid`, so `item_status` and `item_status_history` flow through with no edit. Verified by reading the route: it spreads the model object rather than mapping field by field.

- [ ] **Step 5: Return `itemStatus` from the store detail GET**

In `backend/app/api/store/my/orders/[uuid]/route.js`, add `id, item_status` to the items query and two keys to the mapped item:

```js
    const itemsResult = await pool.query(
      `SELECT oi.id, oi.product_uuid, oi.product_name, oi.sku, oi.variant, oi.price,
              oi.quantity, oi.subtotal, oi.item_status,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'status', h.status,
                  'note', h.note,
                  'changedBy', h.changed_by,
                  'createdAt', h.created_at
                ) ORDER BY h.created_at, h.id)
                FROM order_item_status_history h
                WHERE h.order_item_id = oi.id
              ), '[]'::json) AS item_status_history
       FROM order_items oi
       WHERE oi.order_id = $1
       ORDER BY oi.id ASC`,
      [order.id]
    );
```

```js
        items: itemsResult.rows.map((i) => ({
          id: i.id,
          uuid: i.product_uuid,
          productName: i.product_name,
          sku: i.sku,
          variant: i.variant,
          price: Number(i.price) || 0,
          quantity: i.quantity,
          subtotal: Number(i.subtotal) || 0,
          itemStatus: i.item_status,
          itemStatusHistory: i.item_status_history || [],
        })),
```

- [ ] **Step 6: Return `itemStatus` from the tracking GET and fix `trackable`**

In `backend/app/api/store/orders/track/route.js`, add the new columns to the items query and to the mapped items:

```js
      `SELECT oi.id, oi.product_uuid, oi.product_name, oi.sku, oi.variant, oi.price,
              oi.quantity, oi.subtotal, oi.item_status,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'status', h.status,
                  'note', h.note,
                  'changedBy', h.changed_by,
                  'createdAt', h.created_at
                ) ORDER BY h.created_at, h.id)
                FROM order_item_status_history h
                WHERE h.order_item_id = oi.id
              ), '[]'::json) AS item_status_history
       FROM order_items oi
       WHERE oi.order_id = $1
       ORDER BY oi.id ASC`
```

```js
          items: itemsResult.rows.map((it) => ({
            id: it.id,
            uuid: it.product_uuid,
            productName: it.product_name,
            sku: it.sku,
            variant: it.variant,
            price: Number(it.price) || 0,
            quantity: it.quantity,
            subtotal: Number(it.subtotal) || 0,
            itemStatus: it.item_status,
            itemStatusHistory: it.item_status_history || [],
          })),
```

The map names `productName` explicitly instead of spreading `...it`. A spread would leave the key as `product_name`, because that is the column alias, so the customer payload would be snake_case while the other two order endpoints are camelCase — and Task 8's verification reads `i['productName']`, which would raise a `KeyError`.

Then replace line 95. It tests `["PLACED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY"]`: `PLACED` has never existed in the database, so a `PENDING` or `CONFIRMED` order reports `trackable: false` even though the customer should already be watching it, and the list omits `PROCESSING` and `DELIVERED` for no stated reason. Replace the hand-picked list with the flow itself:

```js
        trackable: ORDER_FLOW.includes(order.status),
```

Note this route also returns `timeline: statusesForView(order.status)` at line 94 and `lastStatusAt`/`storeName`/`estimatedDeliveryAt` alongside. Leave all of those; the storefront stops reading `timeline` in Task 10, and the extra scalar fields harm nothing.

Then relax the validation at lines 20-26. Today `if (!orderNumber || !email)` rejects a request with no order number, which is exactly the customer who lost their order id. Email alone must list that customer's orders:

```js
    if (!email) {
      return Response.json(
        { success: false, message: "Email is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Email only, no order number: the customer does not know their order id,
    // so return every order on that email as a pick-list. Five lean columns —
    // the detail branch below still serves the full tracking view once a row
    // is picked. Newest first, so the order they are most likely looking for
    // is on top.
    if (!orderNumber) {
      const list = await pool.query(
        `SELECT o.order_number, o.status, o.total, o.payment_status, o.created_at
         FROM orders o
         WHERE LOWER(o.customer_email) = $1
         ORDER BY o.created_at DESC`,
        [email]
      );

      return Response.json(
        {
          success: true,
          orders: list.rows.map((r) => ({
            orderNumber: r.order_number,
            status: r.status,
            total: Number(r.total) || 0,
            paymentStatus: r.payment_status,
            createdAt: r.created_at,
          })),
        },
        { status: 200, headers: corsHeaders() }
      );
    }
```

The existing single-order branch below stays byte-for-byte identical; it now only runs when both parameters are present. No login is involved: checkout works as guest, so the email is the only identifier every order carries, and the current lookup already trusts order-number + email with no password — an email-only list is the same class of exposure.

- [ ] **Step 7: Add per-item statuses to the two list endpoints**

In `backend/app/api/branches/[id]/orders/route.js` line 27:

```js
    const result = await Order.listWithItemStatuses({ search, status, branchId: id, page, limit });
```

In `backend/app/api/store/my/orders/route.js`, the list builds its own SQL at line 44. Add the same lateral aggregate to that `SELECT` and one key to its mapper:

```sql
             COALESCE((
               SELECT json_agg(json_build_object(
                 'id', oi.id,
                 'productName', oi.product_name,
                 'quantity', oi.quantity,
                 'status', oi.item_status
               ) ORDER BY oi.id)
               FROM order_items oi WHERE oi.order_id = o.id
             ), '[]'::json) AS item_statuses
```

`id` is included in both aggregates because the list rows carry a per-item status control, and a control with no item id in hand has nothing to PATCH. Do not drop it when copying the aggregate.

```js
        itemStatuses: r.item_statuses || [],
```

- [ ] **Step 8: Verify every read endpoint returns item statuses**

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -c "SELECT o.order_number, o.status, oi.item_status, oi.quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id ORDER BY o.id, oi.id LIMIT 6;"
```

With the dev server running (`cd backend && npm run dev`):

```bash
export $(grep -E "^DATABASE_URL=" /var/www/html/Node-JS/Ecommerce/backend/.env.local | xargs)
NUM=$(psql "$DATABASE_URL" -t -A -c "SELECT order_number FROM orders WHERE status='DELIVERED' LIMIT 1")
MAIL=$(psql "$DATABASE_URL" -t -A -c "SELECT customer_email FROM orders WHERE status='DELIVERED' LIMIT 1")
curl -s "http://localhost:3000/api/store/orders/track?order_number=$NUM&email=$MAIL" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('trackable:',d['trackable']);print('items:',[(i['productName'],i['itemStatus'],i['quantity'],i['id'],i['itemStatusHistory']) for i in d['order']['items']])"
```

Expected: `trackable: True` for this `DELIVERED` order (the old hand-picked list omitted `DELIVERED`, so it reported `False`), every item carrying an `itemStatus` equal to its order's status, a non-null numeric `id`, and `itemStatusHistory` present as a list. The history list is empty for backfilled orders — the backfill set item statuses directly without writing audit rows, which is correct and stated in the spec.

Also verify the email-only list branch:

```bash
export $(grep -E "^DATABASE_URL=" /var/www/html/Node-JS/Ecommerce/backend/.env.local | xargs)
MAIL=$(psql "$DATABASE_URL" -t -A -c "SELECT customer_email FROM orders LIMIT 1")
COUNT=$(psql "$DATABASE_URL" -t -A -c "SELECT count(*) FROM orders WHERE LOWER(customer_email)=LOWER('$MAIL')")
curl -s "http://localhost:3000/api/store/orders/track?email=$MAIL" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('rows:',len(d['orders']));print('keys:',sorted(d['orders'][0].keys()));assert all(set(o)=={'orderNumber','status','total','paymentStatus','createdAt'} for o in d['orders'])"
echo "expected rows: $COUNT"
```

Expected: the row count equals `$COUNT`, every row carries exactly the five list keys, and the rows are newest-first. A request with neither parameter still returns `400`.

- [ ] **Step 9: Lint and build**

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npx eslint 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/backend && npm run build 2>&1 | tail -3
```

Expected: at most 34 warnings and 0 errors; the build succeeds.

- [ ] **Step 10: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add backend/lib/models/orderItem.js backend/lib/models/order.js \
  "backend/app/api/store/my/orders/[uuid]/route.js" \
  backend/app/api/store/orders/track/route.js \
  "backend/app/api/branches/[id]/orders/route.js" \
  backend/app/api/store/my/orders/route.js
git commit -m "feat(orders): read per-item status through every order endpoint

Adds the OrderItem model and exposes item_status on the store detail,
tracking, and both list endpoints. The two list screens render per-item
badges, so listWithItemStatuses pulls a json_agg summary in the same round
trip rather than a request per order.

The tracking endpoint gains an email-only branch: a request with no order
number returns every order on that email as a five-column pick-list, for
the customer who lost their order id. The single-order branch is unchanged.

The tracking endpoint's trackable flag tested a hand-picked list containing
"PLACED", a value that has never existed in the database, while omitting
PROCESSING and DELIVERED — so early orders reported not-trackable and the set
had no stated rule. It now tests ORDER_FLOW.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Item status write path and the two item endpoints

**Files:**
- Create: `backend/lib/orderStatus.js`
- Create: `backend/app/api/store/my/orders/[uuid]/items/[itemId]/route.js`
- Create: `backend/app/api/branches/[id]/orders/[orderId]/items/[itemId]/route.js`

**Interfaces:**
- Consumes: `isClosedOrderStatus`, `isForwardStatusMove`, `rollUpOrderStatus` (Task 2), `OrderItem` (Task 3), `Order.recordStatus`.
- Produces:
  - `advanceItemStatus({ orderUuid, orderItemId, status, branchInternalId = null, note = "", changedBy = "store" }): Promise<{ok: true, itemStatus, orderStatus} | {ok: false, code, message}>`
  - `applyOrderStatusChange({ orderUuid, status = null, note = "", changedBy = "admin", paymentStatus = null }): Promise<{ok: true, status, itemsMoved} | {ok: false, code, message}>` — a `null` status means payment-only: the status and items are left alone.
  - `PATCH /api/store/my/orders/:uuid/items/:itemId`
  - `PATCH /api/branches/:id/orders/:orderId/items/:itemId`

- [ ] **Step 1: Create `backend/lib/orderStatus.js`**

This module owns every write that can change fulfilment. The pure rules stay in `shared/constants.js`; this file only does transactions.

```js
import pool from "./db";
import { Order } from "./models/order";
import { OrderItem } from "./models/orderItem";
import {
  ORDER_FLOW,
  ORDER_STATUS,
  isClosedOrderStatus,
  isForwardStatusMove,
  rollUpOrderStatus,
} from "@shared/constants";

const bad = (code, message) => ({ ok: false, code, message });

// Advances ONE item and re-rolls the order in a single transaction:
//   1. the item's own status and timestamp
//   2. the item's history row
//   3. the order status, but only when the roll-up actually moved, in which
//      case the order history is appended too so its timeline stays truthful
// Other items are deliberately left alone: the whole point of per-item status
// is that one line can be packing while another is still processing.
export async function advanceItemStatus({
  orderUuid,
  orderItemId,
  status,
  branchInternalId = null,
  note = "",
  changedBy = "store",
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // FOR UPDATE pins both rows, so a cancel landing mid-flight waits here
    // instead of interleaving with the roll-up below.
    const found = await client.query(
      `SELECT oi.id AS item_id, oi.order_id, oi.item_status,
              o.status AS order_status, o.branchid
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.uuid = $1 AND oi.id = $2
       FOR UPDATE OF o, oi`,
      [orderUuid, orderItemId]
    );

    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      return bad(404, "Item not found on this order");
    }

    const row = found.rows[0];

    // A store may only touch items on its own branch. Reported as 404 so the
    // endpoint does not confirm that another branch's item exists.
    if (branchInternalId !== null && Number(row.branchid) !== Number(branchInternalId)) {
      await client.query("ROLLBACK");
      return bad(404, "Item not found on this order");
    }

    // DELIVERED, CANCELLED and REFUNDED are all final. This guard is what
    // stops a concurrent cancel being undone by a roll-up: it runs against the
    // locked row, so a cancel that committed first is seen here.
    if (isClosedOrderStatus(row.order_status)) {
      await client.query("ROLLBACK");
      return bad(400, `Cannot change items on a ${row.order_status} order`);
    }

    if (!isForwardStatusMove(row.item_status, status)) {
      await client.query("ROLLBACK");
      return bad(400, `Cannot move an item from ${row.item_status} to ${status}`);
    }

    await client.query(
      `UPDATE order_items SET item_status = $1, item_status_updated_at = now() WHERE id = $2`,
      [status, row.item_id]
    );

    await OrderItem.recordStatus(row.item_id, status, note, changedBy, client);

    // Re-read the items inside the transaction so the roll-up sees the UPDATE
    // above. rollUpOrderStatus can only return an ORDER_FLOW value, so it
    // cannot write a flow status over a cancelled or refunded order; that
    // order was already rejected by the guard above.
    const items = await client.query(
      `SELECT item_status FROM order_items WHERE order_id = $1`,
      [row.order_id]
    );

    const rolled = rollUpOrderStatus(items.rows.map((r) => r.item_status));

    if (rolled !== row.order_status) {
      await client.query(
        `UPDATE orders SET status = $1, updated_at = now() WHERE id = $2`,
        [rolled, row.order_id]
      );
      await Order.recordStatus(row.order_id, rolled, "Rolled up from items", changedBy, client);
    }

    await client.query("COMMIT");

    return { ok: true, itemStatus: status, orderStatus: rolled };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Order-level status changes write the order first and then bring every item
// with it, so the two write paths cannot disagree. CANCELLED and REFUNDED are
// not item states and leave the items untouched: the roll-up does not reproduce
// them, and the order's own status overrides it.
// `status` may be null, which makes this a payment-only update: the payment
// columns move and the order status and every item are left alone. The admin
// PATCH sends status and payment independently, and routing the payment-only
// case around this helper with a bare Order.update would create a second write
// path that skips the transaction.
export async function applyOrderStatusChange({
  orderUuid,
  status = null,
  note = "",
  changedBy = "admin",
  paymentStatus = null,
}) {
  if (!status && !paymentStatus) {
    return bad(400, "Nothing to update");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const found = await client.query(
      `SELECT id, status FROM orders WHERE uuid = $1 FOR UPDATE`,
      [orderUuid]
    );

    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      return bad(404, "Order not found");
    }

    const current = found.rows[0];
    const isSideExit =
      status === ORDER_STATUS.CANCELLED || status === ORDER_STATUS.REFUNDED;

    if (status) {
      if (isClosedOrderStatus(current.status) && current.status !== status) {
        await client.query("ROLLBACK");
        return bad(400, `Cannot change a ${current.status} order`);
      }

      if (!isSideExit && !isForwardStatusMove(current.status, status)) {
        await client.query("ROLLBACK");
        return bad(400, `Cannot move from ${current.status} to ${status}`);
      }

      await client.query(
        `UPDATE orders
         SET status = $1,
             payment_status = COALESCE($2, payment_status),
             updated_at = now()
         WHERE id = $3`,
        [status, paymentStatus, current.id]
      );

      if (current.status !== status) {
        await Order.recordStatus(current.id, status, note, changedBy, client);
      }
    } else {
      // Payment-only: COALESCE keeps whichever argument is set, so this also
      // covers a caller that sends status: null with a payment status.
      await client.query(
        `UPDATE orders
         SET payment_status = COALESCE($1, payment_status),
             updated_at = now()
         WHERE id = $2`,
        [paymentStatus, current.id]
      );
    }

    let itemsMoved = 0;

    if (status && ORDER_FLOW.includes(status)) {
      const moved = await client.query(
        `UPDATE order_items SET item_status = $1, item_status_updated_at = now()
         WHERE order_id = $2 AND item_status <> $1
         RETURNING id`,
        [status, current.id]
      );

      for (const item of moved.rows) {
        await OrderItem.recordStatus(
          item.id,
          status,
          `Order moved to ${status}`,
          changedBy,
          client
        );
      }

      itemsMoved = moved.rows.length;
    }

    await client.query("COMMIT");

    return { ok: true, status, itemsMoved };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Create the store item endpoint**

`backend/app/api/store/my/orders/[uuid]/items/[itemId]/route.js`:

```js
import { corsHeaders } from "@/lib/cors";
import { requireBranchAccess } from "@/lib/authorization";
import { advanceItemStatus } from "@/lib/orderStatus";
import { ORDER_FLOW } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Advances one item on an order belonging to the caller's own branch. The
// order status is re-rolled by advanceItemStatus, never set directly here.
export async function PATCH(request, { params }) {
  try {
    const { uuid, itemId } = await params;
    const branchUuid = request.headers.get("x-branch-id") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const body = await request.json();
    const { status, note = "" } = body || {};

    if (!status || !ORDER_FLOW.includes(status)) {
      return Response.json(
        { success: false, message: `status must be one of: ${ORDER_FLOW.join(", ")}` },
        { status: 400, headers: corsHeaders() }
      );
    }

    const itemIdNumber = Number(itemId);

    if (!Number.isInteger(itemIdNumber) || itemIdNumber < 1) {
      return Response.json(
        { success: false, message: "Invalid item id" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const result = await advanceItemStatus({
      orderUuid: uuid,
      orderItemId: itemIdNumber,
      branchInternalId: access.branchId,
      status,
      note,
      changedBy: "store",
    });

    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message },
        { status: result.code, headers: corsHeaders() }
      );
    }

    return Response.json(
      {
        success: true,
        message: `Item moved to ${status}`,
        item: { status: result.itemStatus },
        order: { status: result.orderStatus },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store item status update error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
```

- [ ] **Step 3: Create the branch item endpoint**

`backend/app/api/branches/[id]/orders/[orderId]/items/[itemId]/route.js`. The branch uuid in the path is resolved to its internal id and compared with the authenticated branch, so a branch manager cannot reach another branch's order by editing the URL:

```js
import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { requireBranchAccess } from "@/lib/authorization";
import { advanceItemStatus } from "@/lib/orderStatus";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { ORDER_FLOW } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function PATCH(request, { params }) {
  try {
    const { id, orderId, itemId } = await params;

    if (!isValidUuid(id) || !isValidUuid(orderId)) {
      return invalidUuidResponse();
    }

    const branchUuid = request.headers.get("x-branch-id") || id;
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    // The path branch and the authenticated branch must be the same one, so
    // the URL cannot be used to reach another branch's order.
    const branch = await pool.query(
      `SELECT id FROM branches WHERE uuid = $1`,
      [id]
    );

    if (
      branch.rows.length === 0 ||
      Number(branch.rows[0].id) !== Number(access.branchId)
    ) {
      return Response.json(
        { success: false, message: "Branch not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const body = await request.json();
    const { status, note = "" } = body || {};

    if (!status || !ORDER_FLOW.includes(status)) {
      return Response.json(
        { success: false, message: `status must be one of: ${ORDER_FLOW.join(", ")}` },
        { status: 400, headers: corsHeaders() }
      );
    }

    const itemIdNumber = Number(itemId);

    if (!Number.isInteger(itemIdNumber) || itemIdNumber < 1) {
      return Response.json(
        { success: false, message: "Invalid item id" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const result = await advanceItemStatus({
      orderUuid: orderId,
      orderItemId: itemIdNumber,
      branchInternalId: access.branchId,
      status,
      note,
      changedBy: "branch",
    });

    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message },
        { status: result.code, headers: corsHeaders() }
      );
    }

    return Response.json(
      {
        success: true,
        message: `Item moved to ${status}`,
        item: { status: result.itemStatus },
        order: { status: result.orderStatus },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Branch item status update error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
```

- [ ] **Step 4: Verify the write path end to end with live curl**

Start the server (`cd backend && npm run dev`), then:

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -c "SELECT o.uuid, o.status, oi.id AS item_id, oi.item_status, oi.product_name FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.status='SHIPPED' ORDER BY oi.id;"
```

Take one `uuid`, one `item_id`, and the branch uuid. Authenticate every call with `Authorization: Bearer $TOKEN` (see the token note in Task 5 Step 5 — a bare call returns 401, which proves nothing). Then:

```bash
# a) forward move accepted; the order re-rolls to the SLOWEST item
curl -s -X PATCH "http://localhost:3000/api/store/my/orders/$UUID/items/$ITEM_ID" \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -H "x-branch-id: $BRANCH_UUID" \
  -d '{"status":"OUT_FOR_DELIVERY"}' | python3 -m json.tool

# b) backwards move rejected
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "http://localhost:3000/api/store/my/orders/$UUID/items/$ITEM_ID" \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -H "x-branch-id: $BRANCH_UUID" -d '{"status":"PACKED"}'

# c) a status outside ORDER_FLOW rejected
curl -s -X PATCH "http://localhost:3000/api/store/my/orders/$UUID/items/$ITEM_ID" \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -H "x-branch-id: $BRANCH_UUID" -d '{"status":"CANCELLED"}' | python3 -m json.tool

# d) history rows written
psql "$DATABASE_URL" -c "SELECT status, note, changed_by FROM order_item_status_history WHERE order_item_id=$ITEM_ID ORDER BY id;"
psql "$DATABASE_URL" -c "SELECT status, note FROM order_status_history WHERE order_id=(SELECT id FROM orders WHERE uuid='$UUID') ORDER BY id DESC LIMIT 3;"
```

Expected: (a) `200` with `order.status` equal to the **slowest** item, not the one just moved; (b) `400`; (c) `400` listing the allowed values; (d) one `order_item_status_history` row and, if the order moved, one `order_status_history` row whose `note` is `Rolled up from items`.

- [ ] **Step 5: Verify the terminal-state guard against a cancelled order**

This is Review Focus 2: an item write must not resurrect a cancelled order.

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
CUUID=$(psql "$DATABASE_URL" -t -A -c "SELECT o.uuid FROM orders o WHERE o.status='CANCELLED' LIMIT 1")
CITEM=$(psql "$DATABASE_URL" -t -A -c "SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.uuid='$CUUID' LIMIT 1")
CBRANCH=$(psql "$DATABASE_URL" -t -A -c "SELECT b.uuid FROM orders o JOIN branches b ON b.id=o.branchid WHERE o.uuid='$CUUID'")

curl -s -X PATCH "http://localhost:3000/api/store/my/orders/$CUUID/items/$CITEM" \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -H "x-branch-id: $CBRANCH" -d '{"status":"PROCESSING"}' | python3 -m json.tool

psql "$DATABASE_URL" -t -c "SELECT status FROM orders WHERE uuid='$CUUID';"
psql "$DATABASE_URL" -t -c "SELECT item_status FROM order_items WHERE id=$CITEM;"
```

Expected: `400` with `Cannot change items on a CANCELLED order`; the order is still `CANCELLED`; the item is still `PENDING`. Nothing written.

- [ ] **Step 6: Restore the test data**

Step 4 moved real items. Before running it, capture the exact starting state the way Task 5 Step 7 describes: the order row, each item row, and the max id in both history tables. After verifying, restore the rows to their recorded statuses and delete only the appended history rows by id. Confirm with the Task 1 Step 1 hash query that no row was added or removed. Step 5 writes nothing and the check below writes nothing, so neither needs a restore of its own.

- [ ] **Step 7: Verify cross-branch isolation**

Use an order belonging to branch A but authenticate as branch B:

```bash
OTHER_BRANCH=$(psql "$DATABASE_URL" -t -A -c "SELECT uuid FROM branches WHERE id <> (SELECT branchid FROM orders WHERE uuid='$UUID') LIMIT 1")
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "http://localhost:3000/api/store/my/orders/$UUID/items/$ITEM_ID" \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -H "x-branch-id: $OTHER_BRANCH" -d '{"status":"DELIVERED"}'
psql "$DATABASE_URL" -t -c "SELECT item_status FROM order_items WHERE id=$ITEM_ID;"
```

Expected: `404` and the item status unchanged.

- [ ] **Step 8: Lint and build**

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npx eslint 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/backend && npm run build 2>&1 | grep -E "items/\[itemId\]|✓|Error" | tail -6
```

Expected: no new lint errors; the route table now lists `/api/store/my/orders/[uuid]/items/[itemId]` and `/api/branches/[id]/orders/[orderId]/items/[itemId]`.

- [ ] **Step 9: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add backend/lib/orderStatus.js \
  "backend/app/api/store/my/orders/[uuid]/items/[itemId]/route.js" \
  "backend/app/api/branches/[id]/orders/[orderId]/items/[itemId]/route.js"
git commit -m "feat(orders): transactional per-item status writes and endpoints

Advancing one item updates the item, appends its history, and re-rolls the
order in a single transaction, writing the order status only when the
roll-up actually moved so the order timeline stays truthful and a 22-item
order does not produce 22 identical history rows.

Both FOR UPDATE row locks close the race where a store advances an item at
the moment an admin cancels: the terminal-state guard runs against the
locked row, so a cancel that committed first is seen and the roll-up cannot
overwrite it.

Other items are deliberately not propagated, which is the point of per-item
status. Order-level moves do propagate, in applyOrderStatusChange.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Order-level writes propagate; `REFUNDED` becomes reachable

**Files:**
- Modify: `backend/app/api/orders/[id]/route.js:101-146` (PATCH)
- Modify: `backend/app/api/store/my/orders/[uuid]/route.js:141-211` (PATCH)
- Modify: `backend/app/api/branches/[id]/orders/route.js:35-59` (remove the duplicate PATCH)
- Create: `backend/app/api/branches/[id]/orders/[orderId]/route.js`

**Interfaces:**
- Consumes: `applyOrderStatusChange` (Task 4).
- Produces: admin `PATCH /api/orders/:id` and store `PATCH /api/store/my/orders/:uuid` accept `REFUNDED` and propagate to items; `PATCH /api/branches/:id/orders/:orderId` exists, fixing a 404.

- [ ] **Step 1: Route admin status changes through `applyOrderStatusChange`**

In `backend/app/api/orders/[id]/route.js`, replace everything from `const updates = {};` (line 101) through the `Order.update(id, updates)` call (line 135):

```js
    const body = await request.json();

    if (body.status === undefined && body.paymentStatus === undefined) {
      return Response.json(
        { success: false, message: "Nothing to update" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (body.status !== undefined && !ORDER_STATUSES.includes(body.status)) {
      return Response.json(
        { success: false, message: "Invalid order status" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (body.paymentStatus !== undefined && !PAYMENT_STATUSES.includes(body.paymentStatus)) {
      return Response.json(
        { success: false, message: "Invalid payment status" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Status and payment are applied in one transaction so a caller that
    // sends both cannot end up with a half-applied change.
    const result = await applyOrderStatusChange({
      orderUuid: id,
      status: body.status ?? null,
      changedBy: "admin",
      paymentStatus: body.paymentStatus ?? null,
    });

    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message },
        { status: result.code, headers: corsHeaders() }
      );
    }

    const order = await Order.findByUuid(id);
```

Three follow-ups in the same file:
- Add `import { applyOrderStatusChange } from "@/lib/orderStatus";` to the imports.
- The `const current = await Order.getInternalByUuid(id);` lookup and its "Order not found" 404 in the PATCH handler (lines 92-98) can go; `applyOrderStatusChange` returns the same 404 with the same message. Remove it to avoid an unused binding. Do not touch the identical lookup in the POST cancel handler (line 176) — that endpoint keeps its own flow and stays out of scope.
- Change the call above to pass `status: body.status ?? null`.

That last point is why the helper in Task 4 Step 1 is written with `status = null` and a payment-only branch: the admin PATCH sends `status` and `paymentStatus` independently, and a payment-only request must leave the order status alone. Resolve it inside the helper rather than branching to a bare `Order.update` in the route — `Order.update` opens no transaction and would create a second write path for the same row, which is the divergence this feature exists to remove.

- [ ] **Step 2: Accept `REFUNDED` on the store order PATCH**

`backend/app/api/store/my/orders/[uuid]/route.js` currently rejects `REFUNDED`: at line 175 `ORDER_FLOW.indexOf(newStatus)` is `-1`, so it returns `Invalid status: REFUNDED` even though the database allows it and the admin UI can set it. Replace the validation block (lines 165-184, from the `if (newStatus === ORDER_STATUS.CANCELLED)` branch through the closing brace before the `UPDATE`) and the update (lines 186-201) with:

```js
    // CANCELLED and REFUNDED are order-level side-exits, not steps in the
    // forward ORDER_FLOW chain: both are allowed from any active status, and
    // neither is ever written to an item. REFUNDED previously fell through
    // the ORDER_FLOW index lookup and was rejected despite being a valid
    // database status.
    const isSideExit =
      newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.REFUNDED;

    if (!isSideExit && !ORDER_FLOW.includes(newStatus)) {
      return Response.json(
        { success: false, message: `Invalid status: ${newStatus}` },
        { status: 400, headers: corsHeaders() }
      );
    }

    const result = await applyOrderStatusChange({
      orderUuid: uuid,
      status: newStatus,
      changedBy: "store",
    });

    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message },
        { status: result.code, headers: corsHeaders() }
      );
    }

    // Put the items back into the store's inventory when the order is
    // cancelled. A refund does not return stock. The helper already wrote the
    // item_status_history rows inside its transaction, so nothing here touches
    // per-item history — deleting or re-writing it would fork the audit trail.
    if (newStatus === ORDER_STATUS.CANCELLED) {
      await restockOrder(order.id, access.branchId);
    }

    const refreshed = await Order.findByUuid(uuid);

    return Response.json({
      success: true,
      message: `Order moved to ${newStatus}`,
      order: {
        uuid,
        status: refreshed?.status || newStatus,
        orderNumber: refreshed?.order_number || order.order_number,
        customerName: refreshed?.customer_name || order.customer_name,
        total: Number(refreshed?.total) || 0,
        itemsMoved: result.itemsMoved,
        createdAt: refreshed?.created_at || order.created_at,
        updatedAt: refreshed?.updated_at,
      },
    }, { status: 200, headers: corsHeaders() });
```

Keep the `orderResult` lookup above the replaced block, since `order.id` and `order.order_number` are still used. Add `import { applyOrderStatusChange } from "@/lib/orderStatus";` to the imports.

- [ ] **Step 3: Fix the branch order PATCH 404**

`frontend/src/services/branches.js:155` PATCHes `/api/branches/{id}/orders/{orderId}` but no route handler exists at that path, so the branch manager's status button is a 404 today. Create `backend/app/api/branches/[id]/orders/[orderId]/route.js`:

```js
import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { requireBranchAccess } from "@/lib/authorization";
import { applyOrderStatusChange } from "@/lib/orderStatus";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { ORDER_FLOW, ORDER_STATUS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Order-level advance for a branch manager. The order must belong to the
// caller's branch; applyOrderStatusChange then brings the items with it.
export async function PATCH(request, { params }) {
  try {
    const { id, orderId } = await params;

    if (!isValidUuid(id) || !isValidUuid(orderId)) {
      return invalidUuidResponse();
    }

    const branchUuid = request.headers.get("x-branch-id") || id;
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const body = await request.json();
    const { status: newStatus } = body || {};

    if (!newStatus) {
      return Response.json(
        { success: false, message: "status is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const isSideExit =
      newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.REFUNDED;

    if (!isSideExit && !ORDER_FLOW.includes(newStatus)) {
      return Response.json(
        { success: false, message: `Invalid status: ${newStatus}` },
        { status: 400, headers: corsHeaders() }
      );
    }

    const owned = await pool.query(
      `SELECT 1 FROM orders WHERE uuid = $1 AND branchid = $2`,
      [orderId, access.branchId]
    );

    if (owned.rows.length === 0) {
      return Response.json(
        { success: false, message: "Order not found for this branch" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const result = await applyOrderStatusChange({
      orderUuid: orderId,
      status: newStatus,
      changedBy: "branch",
    });

    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message },
        { status: result.code, headers: corsHeaders() }
      );
    }

    return Response.json(
      {
        success: true,
        message: `Order moved to ${newStatus}`,
        order: { uuid: orderId, status: newStatus, itemsMoved: result.itemsMoved },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Branch order update error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
```

- [ ] **Step 4: Remove the duplicated status handling from the branches list route**

`backend/app/api/branches/[id]/orders/route.js` still has a `PATCH` at line 35 calling `Order.update(id, { status })` directly, which would not propagate to items. Delete that whole function. The new `[orderId]` route becomes the single path for a branch order status change; two handlers writing the same field by different routes is how they drift apart. Keep its `GET` (updated in Task 3) and `OPTIONS`. The `authorize` and `KEY_PERMISSIONS` imports stay: the `GET` at line 17 still uses `authorize(KEY_PERMISSIONS.BRANCH_ORDERS_VIEW)`.

- [ ] **Step 5: Verify propagation and the `REFUNDED` path**

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
UUID=$(psql "$DATABASE_URL" -t -A -c "SELECT uuid FROM orders WHERE status='CONFIRMED' LIMIT 1")
BRANCH_UUID=$(psql "$DATABASE_URL" -t -A -c "SELECT b.uuid FROM orders o JOIN branches b ON b.id=o.branchid WHERE o.uuid='$UUID'")
psql "$DATABASE_URL" -c "SELECT oi.id, oi.item_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.uuid='$UUID';"

# admin advance: the order AND every item move together.
# The frontend authenticates with a Bearer token (see authHeaders in
# frontend/src/services/http.js), not a cookie: sign in through the UI once
# and paste the stored token here as $TOKEN. A bare curl with no auth gets a
# 401 — that is the auth layer working, not a backend bug. Store endpoints
# take the same token, plus the x-branch-id header.
curl -s -X PATCH "http://localhost:3000/api/orders/$UUID" \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"status":"PROCESSING"}' | python3 -m json.tool

psql "$DATABASE_URL" -c "SELECT oi.id, oi.item_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.uuid='$UUID';"
psql "$DATABASE_URL" -c "SELECT status, note, changed_by FROM order_item_status_history WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=(SELECT id FROM orders WHERE uuid='$UUID')) ORDER BY id;"

# store refund is now accepted
curl -s -X PATCH "http://localhost:3000/api/store/my/orders/$UUID" \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -H "x-branch-id: $BRANCH_UUID" -d '{"status":"REFUNDED"}' | python3 -m json.tool
psql "$DATABASE_URL" -t -c "SELECT status FROM orders WHERE uuid='$UUID';"
psql "$DATABASE_URL" -c "SELECT oi.item_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.uuid='$UUID';"
```

Expected: the admin advance sets the order **and** every item to `PROCESSING`, writing one `order_item_status_history` row per item with the note `Order moved to PROCESSING`. The refund returns `200`, the order becomes `REFUNDED`, and the items keep `PROCESSING` — they are never given `REFUNDED`.

- [ ] **Step 6: Verify the branch PATCH is no longer a 404**

```bash
BUUID=$(psql "$DATABASE_URL" -t -A -c "SELECT b.uuid FROM orders o JOIN branches b ON b.id=o.branchid WHERE o.status='PROCESSING' LIMIT 1")
BORDER=$(psql "$DATABASE_URL" -t -A -c "SELECT o.uuid FROM orders o JOIN branches b ON b.id=o.branchid WHERE b.uuid='$BUUID' AND o.status='PROCESSING' LIMIT 1")
curl -s -X PATCH "http://localhost:3000/api/branches/$BUUID/orders/$BORDER" \
  -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -H "x-branch-id: $BUUID" -d '{"status":"PACKED"}' | python3 -m json.tool
```

Expected: `200` with `itemsMoved` equal to the number of items that were not already `PACKED`. This path returned `404` before this task.

- [ ] **Step 7: Lint, build, and restore the test data**

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npx eslint 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/backend && npm run build 2>&1 | grep -E "orders/\[orderId\]|✓|Error" | tail -5
```

Leave the tree as you found it. This task moves real orders, so capture the exact starting state first and restore from that rather than from assumptions:

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
# Before making any change, capture the exact state of the order you are about
# to move. Keep this output; the restore below is generated from it.
psql "$DATABASE_URL" -x -c "SELECT o.id, o.status, o.payment_status, o.updated_at FROM orders o WHERE o.uuid='$UUID';"
psql "$DATABASE_URL" -c "SELECT oi.id, oi.item_status, oi.item_status_updated_at FROM order_items oi WHERE oi.order_id=(SELECT id FROM orders WHERE uuid='$UUID') ORDER BY oi.id;"
psql "$DATABASE_URL" -c "SELECT id, status, note, changed_by, created_at FROM order_status_history WHERE order_id=(SELECT id FROM orders WHERE uuid='$UUID') ORDER BY id;"
psql "$DATABASE_URL" -c "SELECT id, order_item_id, status, note, changed_by, created_at FROM order_item_status_history WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=(SELECT id FROM orders WHERE uuid='$UUID')) ORDER BY id;"
```

Record the highest `id` in each history table. Everything the task appends is a row with an `id` above that mark, so the restore can delete precisely those rows:

```bash
ORDER_HIST_MAX=<paste the max order_status_history.id>
ITEM_HIST_MAX=<paste the max order_item_status_history.id, or 0 if empty>

# Restore the order row.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE orders SET status='<original status>', payment_status='<original payment_status>', updated_at=now() WHERE uuid='$UUID';"

# Restore each item row from the capture above.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE order_items SET item_status='<original>', item_status_updated_at=NULL WHERE id=<item id>;"

# Delete only the history rows this task appended. `note LIKE` is needed:
# without LIKE, `note = 'Order moved to %'` compares the whole string to a
# literal containing a percent sign and matches nothing.
psql "$DATABASE_URL" -c "DELETE FROM order_status_history WHERE order_id=(SELECT id FROM orders WHERE uuid='$UUID') AND id > $ORDER_HIST_MAX;"
psql "$DATABASE_URL" -c "DELETE FROM order_item_status_history WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=(SELECT id FROM orders WHERE uuid='$UUID')) AND id > $ITEM_HIST_MAX;"
```

Deleting by `id >` the recorded maximum is safe even when the task wrote a note that happens to collide with pre-existing text, which a `note LIKE 'Order moved to %'` filter would not be. The whole restore is a series of `psql -c` calls, not bare SQL: a bare `UPDATE ... ;` line in a shell would be a syntax error.

Then confirm the restore: re-run the four capture queries and check they match what you recorded, and re-run the Task 1 Step 1 hash query to confirm no item row was added or removed.

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add "backend/app/api/orders/[id]/route.js" "backend/app/api/store/my/orders/[uuid]/route.js" \
  "backend/app/api/branches/[id]/orders/route.js" "backend/app/api/branches/[id]/orders/[orderId]/route.js"
git commit -m "feat(orders): route order-level status changes through one write path

Admin and store PATCH handlers now call applyOrderStatusChange, so an
order-level advance moves the items with it and the two write paths cannot
disagree.

REFUNDED is now accepted on the store order endpoint. It is a valid
ORDER_STATUS and a valid database value, but the handler validated it with
ORDER_FLOW.indexOf, which returns -1, so it was rejected with 'Invalid
status' despite being reachable from the admin UI.

Adds the missing /api/branches/[id]/orders/[orderId] handler. The branch
manager's status button has been PATCHing a path with no route, so it has
been returning 404. The duplicate PATCH on the parent list route is removed
so one path owns the field.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `normalizeOrder` — the shared data module

**Files:**
- Create: `frontend/src/lib/orderDetail.js`
- Modify: `frontend/scripts/verify-order-status.mjs` (append tests)

**Interfaces:**
- Consumes: `ORDER_FLOW`, `ORDER_STATUS`, `ORDER_STATUS_LABELS`, `PAYMENT_STATUS_LABELS`, `ORDER_PAYMENT_METHODS_LABELS` from `../../../shared/constants.js`.
- Produces:
  - `normalizeOrder(raw: object): object` returning `{ uuid, orderNumber, customerName, customerEmail, customerMobile, status, statusLabel, isTerminal, paymentStatus, paymentLabel, paymentMethod, paymentMethodLabel, totals: {subtotal, discount, total}, address: {line1, line2, city, state, pincode, country, formatted}, items: [{id, name, sku, variant, price, quantity, subtotal, status, statusLabel, history}], timeline: [{status, label, reached, current}] }`
  - `nextOrderStatus(current: string): string|null`
  - `itemStatusOptions(current: string): string[]`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/scripts/verify-order-status.mjs`:

```js
// --- normalizeOrder: three API shapes, one output --------------------------
import { normalizeOrder, nextOrderStatus, itemStatusOptions } from "../src/lib/orderDetail.js";

// The admin endpoint is snake_case, the store and tracking endpoints are
// camelCase. All three reach the same component, so all three are asserted
// against the same expectations.
const adminShape = {
  uuid: "u1",
  order_number: "ORD-0000001",
  customer_name: "Asha Rao",
  customer_email: "asha@example.com",
  customer_mobile: "9876543210",
  status: "DELIVERED",
  payment_status: "PAID",
  payment_method: "cod",
  shipping_address: { address: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India" },
  subtotal: "1200.00", discount: "200.00", total: "1000.00",
  items: [{
    id: 5, product_name: "Coffee", sku: "CF1", variant: "250g", price: "600.00",
    quantity: 2, subtotal: "1200.00", item_status: "DELIVERED",
    item_status_history: [{ status: "SHIPPED", note: "", changedBy: "store", createdAt: "2026-09-20T10:00:00Z" }],
  }],
};

const storeShape = {
  uuid: "u1", orderNumber: "ORD-0000001", customerName: "Asha Rao",
  customerEmail: "asha@example.com", customerMobile: "9876543210",
  status: "DELIVERED", paymentStatus: "PAID", paymentMethod: "cod",
  shippingAddress: { address: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India" },
  subtotal: 1200, discount: 200, total: 1000,
  items: [{
    id: 5, uuid: "p1", productName: "Coffee", sku: "CF1", variant: "250g", price: 600,
    quantity: 2, subtotal: 1200, itemStatus: "DELIVERED",
    itemStatusHistory: [{ status: "SHIPPED", note: "", changedBy: "store", createdAt: "2026-09-20T10:00:00Z" }],
  }],
};

const trackShape = {
  uuid: "u1", order_number: "ORD-0000001", customer_name: "Asha Rao",
  customer_email: "asha@example.com", customer_mobile: "9876543210",
  status: "DELIVERED", payment_status: "PAID", payment_method: "cod",
  shipping_address: { address: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India" },
  subtotal: 1200, discount: 200, total: 1000,
  items: [{
    id: 5, uuid: "p1", productName: "Coffee", sku: "CF1", variant: "250g", price: 600,
    quantity: 2, subtotal: 1200, itemStatus: "DELIVERED",
    itemStatusHistory: [{ status: "SHIPPED", note: "", changedBy: "store", createdAt: "2026-09-20T10:00:00Z" }],
  }],
};

for (const [label, shape] of [["admin", adminShape], ["store", storeShape], ["track", trackShape]]) {
  const n = normalizeOrder(shape);
  assert.equal(n.uuid, "u1", `${label}: uuid`);
  assert.equal(n.orderNumber, "ORD-0000001", `${label}: orderNumber from both casings`);
  assert.equal(n.customerName, "Asha Rao", `${label}: customerName`);
  assert.equal(n.status, "DELIVERED", `${label}: status`);
  assert.equal(n.statusLabel, "Delivered", `${label}: statusLabel from the shared map`);
  assert.equal(n.paymentLabel, "Paid", `${label}: paymentLabel`);
  assert.equal(n.totals.total, 1000, `${label}: totals are numbers, not strings`);
  assert.equal(n.items.length, 1, `${label}: items`);
  assert.equal(n.items[0].status, "DELIVERED", `${label}: itemStatus from both casings`);
  assert.equal(n.items[0].name, "Coffee", `${label}: item name from both casings`);
  assert.equal(n.items[0].id, 5, `${label}: item id survives, so a control can PATCH it`);
  assert.equal(n.items[0].history.length, 1, `${label}: history from both casings`);
  assert.equal(n.items[0].history[0].status, "SHIPPED", `${label}: history entry keeps its status`);
  assert.equal(n.timeline.length, ORDER_FLOW.length, `${label}: timeline covers the whole flow`);
  assert.equal(n.timeline[n.timeline.length - 1].current, true, `${label}: last step is current when delivered`);
  assert.equal(n.isTerminal, true, `${label}: delivered is terminal`);
  assert.ok(n.address.formatted.includes("12 MG Road"), `${label}: address street is not lost`);
  assert.ok(n.address.formatted.includes("560001"), `${label}: address pincode is not lost`);
}

// --- Review Focus 5: an address with no street line at all -----------------
const noStreet = normalizeOrder({
  ...adminShape,
  shipping_address: { city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India" },
});
assert.equal(noStreet.address.line1, "", "a missing street is empty, not undefined");
assert.ok(!noStreet.address.formatted.includes("undefined"), `street: ${noStreet.address.formatted}`);
assert.ok(noStreet.address.formatted.includes("Bengaluru"), "the city still renders");

const noAddressAtAll = normalizeOrder({ ...adminShape, shipping_address: null });
assert.equal(noAddressAtAll.address.formatted, "", "a null address formats to empty");
assert.ok(!noAddressAtAll.address.formatted.includes("undefined"));

// The live table contains both key sets: checkout writes address/pincode
// (Storefront.jsx:1254-1256) while older rows carry line1/postal, and the
// admin screen read only line1/postal — so every checkout-written order
// rendered an em dash. Both resolve here.
const legacy = normalizeOrder({
  ...adminShape,
  shipping_address: { line1: "9 Race Course Rd", line2: "Flat 3", city: "Pune", state: "MH", postal: "411001", country: "India" },
});
assert.equal(legacy.address.line1, "9 Race Course Rd");
assert.equal(legacy.address.pincode, "411001", "postal resolves to pincode");
assert.ok(legacy.address.formatted.includes("411001"));

// --- Review Focus 3: an order with no items --------------------------------
const noItems = normalizeOrder({ ...adminShape, items: [] });
assert.equal(noItems.items.length, 0);
assert.equal(noItems.status, "DELIVERED", "a zero-item order still reports its own status");
assert.equal(noItems.timeline.length, ORDER_FLOW.length, "the timeline still renders");
assert.equal(rollUpOrderStatus(noItems.items.map((i) => i.status)), "PENDING", "and rolls up to PENDING");

// --- Review Focus 4: quantity is a multiplier, not extra status rows -------
const bulk = normalizeOrder({
  ...adminShape,
  status: "PACKED",
  items: [{ id: 9, product_name: "Tea", price: "100.00", quantity: 3, subtotal: "300.00", item_status: "PACKED" }],
});
assert.equal(bulk.items.length, 1, "a quantity-3 line is one item with one status");
assert.equal(bulk.items[0].quantity, 3);
assert.deepEqual(bulk.items[0].history, [], "a missing history is an empty list, not undefined");

// --- timeline reflects the current stage ------------------------------------
  const mid = normalizeOrder({ ...adminShape, status: "PROCESSING" });
assert.equal(mid.timeline.find((s) => s.status === "PROCESSING").current, true);
assert.equal(mid.timeline.find((s) => s.status === "PACKED").current, false);
assert.equal(mid.timeline.find((s) => s.status === "PENDING").reached, true);
assert.equal(mid.timeline.find((s) => s.status === "DELIVERED").reached, false);
assert.equal(mid.isTerminal, false);

// DELIVERED is the final member of ORDER_FLOW, so testing flow membership would
// wrongly call it non-terminal. It is the one status where the advance control
// must disappear.
const delivered = normalizeOrder({ ...adminShape, status: "DELIVERED" });
assert.equal(delivered.isTerminal, true, "DELIVERED is in ORDER_FLOW but is still terminal");
assert.equal(nextOrderStatus(delivered.status), null);

// An unrecognised status is not terminal, so the screen shows the order as
// still in progress rather than disabling every control.
const unknown = normalizeOrder({ ...adminShape, status: "WAT" });
assert.equal(unknown.isTerminal, false, "an unknown status is not silently terminal");

// CANCELLED and REFUNDED are outside the flow, so they show as a single step.
const cancelled = normalizeOrder({ ...adminShape, status: "CANCELLED" });
assert.deepEqual(cancelled.timeline.map((s) => s.status), ["CANCELLED"]);
assert.equal(cancelled.isTerminal, true);

// --- forward-only helpers --------------------------------------------------
assert.equal(nextOrderStatus("PENDING"), "CONFIRMED");
assert.equal(nextOrderStatus("OUT_FOR_DELIVERY"), "DELIVERED");
assert.equal(nextOrderStatus("DELIVERED"), null, "a terminal order has no next step");
assert.equal(nextOrderStatus("CANCELLED"), null);
assert.equal(nextOrderStatus("NONSENSE"), null);
assert.deepEqual(itemStatusOptions("PENDING"), ORDER_FLOW.slice(1),
  "only later stages are offered, so the control cannot move backwards");
assert.deepEqual(itemStatusOptions("DELIVERED"), []);
assert.deepEqual(itemStatusOptions("CANCELLED"), [], "a cancelled order offers nothing");

console.log("verify-order-status ok");
```

Delete that `console.log` line from where Task 2 put it, since the block above is being appended to rather than replacing the file. It is the only success marker, and it has to be the last statement in the file for the marker's output to mean "every assertion above passed" — if it stays where Task 2 wrote it, Task 6 and Task 10 append assertions *after* it, so a failure in those would still print `verify-order-status ok` before failing, and a passing run would print the marker mid-stream. Task 10 Step 1 re-adds it at the end.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /var/www/html/Node-JS/Ecommerce
node frontend/scripts/verify-order-status.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/lib/orderDetail.js`.

- [ ] **Step 3: Create `frontend/src/lib/orderDetail.js`**

`@shared` is a Vite-only alias Node cannot resolve, so this pure file imports through a relative path. JSX components may still use `@shared/constants`.

```js
import {
  ORDER_FLOW,
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  ORDER_PAYMENT_METHODS_LABELS,
  isClosedOrderStatus,
} from "../../../shared/constants.js";

const pick = (...values) => values.find((v) => v !== undefined && v !== null && v !== "");

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// The three order APIs return three shapes for the same order: snake_case from
// /api/orders/:id, camelCase from /api/store/my/orders/:uuid, and a mix from
// /api/store/orders/track. Every screen renders this shape instead.
export function normalizeOrder(raw) {
  const order = raw || {};
  const address = order.shipping_address || order.shippingAddress || {};

  const line1 = pick(address.address, address.line1) || "";
  const line2 = pick(address.line2) || "";
  const city = pick(address.city) || "";
  const state = pick(address.state) || "";
  // checkout has always written `pincode` and `address` (Storefront.jsx
  // calls its street field "address"); older rows carry `line1`/`postal`.
  // The live table contains both key sets.
  const pincode = pick(address.pincode, address.postal) || "";
  const country = pick(address.country) || "";

  const status = pick(order.status) || ORDER_STATUS.PENDING;
  const paymentStatus = pick(order.payment_status, order.paymentStatus) || "";
  const paymentMethod = pick(order.payment_method, order.paymentMethod) || "";

  return {
    uuid: pick(order.uuid) || "",
    orderNumber: pick(order.order_number, order.orderNumber) || "",
    customerName: pick(order.customer_name, order.customerName) || "",
    customerEmail: pick(order.customer_email, order.customerEmail) || "",
    customerMobile: pick(order.customer_mobile, order.customerMobile) || "",

    status,
    statusLabel: ORDER_STATUS_LABELS[status] || status,
    // Ask the shared rule rather than inverting ORDER_FLOW membership:
    // !ORDER_FLOW.includes() would call DELIVERED non-terminal (it IS in the
    // flow) and call a garbage status terminal. isClosedOrderStatus is the
    // tested definition from Task 2.
    isTerminal: isClosedOrderStatus(status),

    paymentStatus,
    paymentLabel: PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus || "",
    paymentMethod,
    paymentMethodLabel: ORDER_PAYMENT_METHODS_LABELS[paymentMethod] || paymentMethod || "",

    totals: {
      subtotal: num(order.subtotal),
      discount: num(order.discount),
      total: num(order.total),
    },

    address: {
      line1,
      line2,
      city,
      state,
      pincode,
      country,
      // .filter(Boolean) drops the empty parts, so a partial address never
      // renders as "undefined" or with a trailing separator.
      formatted: [line1, line2, [city, state].filter(Boolean).join(", "), pincode, country]
        .filter(Boolean)
        .join(", "),
    },

    items: (order.items || []).map((item) => {
      const itemStatus = pick(item.item_status, item.itemStatus) || ORDER_STATUS.PENDING;

      return {
        id: pick(item.id),
        name: pick(item.product_name, item.productName) || "",
        sku: pick(item.sku) || "",
        variant: pick(item.variant) || "",
        price: num(item.price),
        // Quantity is a multiplier on one line, not N statuses. A quantity-3
        // line is one row with one status.
        quantity: num(item.quantity) || 1,
        subtotal: num(item.subtotal),
        status: itemStatus,
        statusLabel: ORDER_STATUS_LABELS[itemStatus] || itemStatus,
        // The admin endpoint is snake_case throughout, the store and tracking
        // endpoints are camelCase, so both spellings are read here. It is [] for
        // backfilled items: the backfill set item statuses without writing audit
        // rows, so an empty list is honest rather than a gap.
        history: item.item_status_history || item.itemStatusHistory || [],
      };
    }),

    timeline: buildTimeline(status),
  };
}

// The ordered chain for the status stepper, derived from ORDER_FLOW so it can
// never drift from the backend. A status outside the flow (CANCELLED,
// REFUNDED) shows as a single step.
function buildTimeline(status) {
  const chain = ORDER_FLOW.includes(status) ? ORDER_FLOW : [status];
  const currentIndex = chain.indexOf(status);

  return chain.map((step, index) => ({
    status: step,
    label: ORDER_STATUS_LABELS[step] || step,
    reached: currentIndex === -1 ? index === 0 : index <= currentIndex,
    current: index === currentIndex,
  }));
}

// The single "move to next" control's target, or null at a terminal status.
export function nextOrderStatus(current) {
  const index = ORDER_FLOW.indexOf(current);
  if (index === -1 || index >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[index + 1];
}

// Every legal target for an item, forward-only. An empty list means the item
// cannot move, which is how the UI disables the control.
export function itemStatusOptions(current) {
  const index = ORDER_FLOW.indexOf(current);
  if (index === -1) return [...ORDER_FLOW];
  return ORDER_FLOW.slice(index + 1);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /var/www/html/Node-JS/Ecommerce
node frontend/scripts/verify-order-status.mjs
```

Expected: `verify-order-status ok`

- [ ] **Step 5: Mutation-check the address handling**

Delete the `pick(address.pincode, address.postal)` fallback so it reads only `address.pincode`, and delete the `.filter(Boolean)`. Re-run the script: it must FAIL on the `legacy` block (`postal resolves to pincode`) and on Review Focus 5 (`undefined`). Restore both from Step 3 and confirm `verify-order-status ok`. Do not commit the mutant.

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add frontend/src/lib/orderDetail.js frontend/scripts/verify-order-status.mjs
git commit -m "feat(orders): normalize the three order API shapes into one

/api/orders/:id returns snake_case, /api/store/my/orders/:uuid camelCase, and
/api/store/orders/track a mix, so four screens each re-derived the same
fields with their own casing. normalizeOrder reads all three and emits one
shape, including a timeline derived from ORDER_FLOW that cannot drift from
the backend.

It also resolves the shipping address, which was silently blank for
checkout-written orders: checkout writes address/pincode
(`Storefront.jsx:1254-1256`) but the admin detail screen and the invoice read
line1/postal, and the live table contains both key sets, so those orders
rendered an em dash.

Imports shared/constants relatively rather than via @shared, because @shared
is a Vite-only alias the Node verification script has to resolve through.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: The shared `OrderDetails` component

**Files:**
- Create: `frontend/src/components/OrderDetails.css`
- Create: `frontend/src/components/OrderDetails.jsx`

**Interfaces:**
- Consumes: `normalizeOrder` output (Task 6), `formatCurrency` from `@shared/constants`.
- Produces: `OrderDetails({ order, showAddress = true, showTotals = true, showCustomer = true, children })` — presentational only, no fetching, no internal state. `children` renders directly below the item list.

- [ ] **Step 1: Create `OrderDetails.css`**

The storefront does not load `index.css` — there is no import in `Storefront.jsx` and no `<link>` in `storepub/index.html` — so styles placed there would never reach the customer-facing app. The component must carry its own stylesheet.

```css
/* Order details shared by the admin order screen and the storefront tracker.
   Imported by OrderDetails.jsx rather than index.css because the storefront
   does not load index.css at all. */

.od-header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16px;
}

.od-order-number {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 18px;
  font-weight: 600;
}

.od-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: #eef2f7;
  color: #334155;
}

.od-status-delivered { background: #dcfce7; color: #166534; }
.od-status-cancelled,
.od-status-refunded { background: #fee2e2; color: #991b1b; }

.od-timeline {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
}

.od-timeline li {
  flex: 1 1 120px;
  padding: 6px 8px;
  border-top: 3px solid #e2e8f0;
  font-size: 12px;
  color: #64748b;
}

.od-timeline li.reached { border-top-color: #22c55e; color: #166534; }
.od-timeline li.current { border-top-color: #16a34a; font-weight: 700; color: #14532d; }

.od-items {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}

.od-items th,
.od-items td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
  font-size: 14px;
  vertical-align: top;
}

.od-items th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}

.od-items td.num { text-align: right; font-variant-numeric: tabular-nums; }
.od-item-name { font-weight: 600; }
.od-item-meta { color: #64748b; font-size: 12px; }

/* One status per line, even when quantity is 3 or more. */
.od-item-status { display: inline-block; margin-top: 4px; }

.od-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.od-block h4 {
  margin: 0 0 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}

.od-block p { margin: 0; font-size: 14px; }

.od-total-row {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 14px;
}

.od-total-row.is-total {
  font-weight: 700;
  border-top: 1px solid #e2e8f0;
  margin-top: 4px;
  padding-top: 6px;
}

.od-empty { padding: 16px; text-align: center; color: #94a3b8; font-size: 14px; }
```

- [ ] **Step 2: Create `OrderDetails.jsx`**

```jsx
import { formatCurrency } from "@shared/constants";
import "./OrderDetails.css";

function money(value) {
  return formatCurrency(Number(value) || 0);
}

const statusClass = (status) =>
  `od-status od-status-${String(status || "").toLowerCase()}`;

// Renders a normalized order (see frontend/src/lib/orderDetail.js).
// Presentational only: it fetches nothing and owns no state, so the admin
// screen and the storefront tracker share exactly one detail view.
//
// `children` renders directly below the item list, which is how the store and
// branch screens inject a per-item status control without this component
// knowing anything about updating.
//
// `showTotals`, `showAddress`, and `showCustomer` exist because the admin
// screen keeps its own versions of two of those blocks: its stat-grid also
// shows the coupon and the placed date, which this component does not know,
// and its customer block links to the customer page. The admin passes false
// for those two and keeps its blocks; the storefront tracker leaves all three
// true.
export default function OrderDetails({
  order,
  showAddress = true,
  showTotals = true,
  showCustomer = true,
  children,
}) {
  if (!order) return null;

  return (
    <div className="od">
      <div className="od-header">
        <span className="od-order-number">{order.orderNumber}</span>
        <span className={statusClass(order.status)}>{order.statusLabel}</span>
      </div>

      <ol className="od-timeline">
        {order.timeline.map((step) => (
          <li
            key={step.status}
            className={`${step.reached ? "reached" : ""} ${step.current ? "current" : ""}`.trim()}
          >
            {step.label}
          </li>
        ))}
      </ol>

      {order.items.length === 0 ? (
        <p className="od-empty">No items on this order.</p>
      ) : (
        <table className="od-items">
          <thead>
            <tr>
              <th>Item</th>
              <th>Status</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={item.id ?? `${item.name}-${index}`}>
                <td>
                  <div className="od-item-name">{item.name}</div>
                  {(item.variant || item.sku) && (
                    <div className="od-item-meta">
                      {[item.variant, item.sku].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                {/* One status for the whole line, regardless of quantity. */}
                <td>
                  <span className={`od-item-status ${statusClass(item.status)}`}>
                    {item.statusLabel}
                  </span>
                </td>
                <td className="num">{item.quantity}</td>
                <td className="num">{money(item.price)}</td>
                <td className="num">{money(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {children}

      <div className="od-grid">
        {showTotals && (
          <div className="od-block">
            <h4>Totals</h4>
            <div className="od-total-row">
              <span>Subtotal</span>
              <span>{money(order.totals.subtotal)}</span>
            </div>
            {order.totals.discount > 0 && (
              <div className="od-total-row">
                <span>Discount</span>
                <span>−{money(order.totals.discount)}</span>
              </div>
            )}
            <div className="od-total-row is-total">
              <span>Total</span>
              <span>{money(order.totals.total)}</span>
            </div>
          </div>
        )}

        {showAddress && (
          <div className="od-block">
            <h4>Shipping address</h4>
            <p>{order.address.formatted || "—"}</p>
          </div>
        )}

        <div className="od-block">
          <h4>Payment</h4>
          <p>{order.paymentLabel || "—"}</p>
          {order.paymentMethodLabel && <p>{order.paymentMethodLabel}</p>}
        </div>

        {(order.customerName || order.customerEmail) && showCustomer && (
          <div className="od-block">
            <h4>Customer</h4>
            {order.customerName && <p>{order.customerName}</p>}
            {order.customerEmail && <p>{order.customerEmail}</p>}
            {order.customerMobile && <p>{order.customerMobile}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the component compiles in the admin app**

The admin app already resolves `@shared` and relative CSS imports. `storepub` and `storepanel` do not have the alias yet, but nothing imports this component in them until Tasks 9 and 10.

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend && npx oxlint src/components/OrderDetails.jsx
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run build 2>&1 | tail -3
```

Expected: oxlint reports no problems for the file; the build succeeds. The component will not be in a bundle until something imports it, which is expected here.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add frontend/src/components/OrderDetails.jsx frontend/src/components/OrderDetails.css
git commit -m "feat(orders): shared OrderDetails component

One presentational order view for the admin order screen and the storefront
tracker, taking a normalized order and rendering the header, status stepper,
per-item statuses, totals, address, and payment.

Styles live in a CSS file the component imports, not index.css, because the
storefront does not load index.css at all - no import in Storefront.jsx and
no link tag in storepub/index.html - so anything put there would silently
never reach the customer-facing app.

Each row shows one status for the line regardless of quantity, so a
quantity-3 line does not read as three separate items.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Admin `OrderView` uses the shared module

**Files:**
- Modify: `frontend/src/pages/OrderView.jsx` — imports, the `advance()` helper (lines 113-124), the derived booleans (lines 197-199), the timeline block (lines 257-300), the shipping-address block (lines 355-370), the items table (from line 388)

**Interfaces:**
- Consumes: `normalizeOrder`, `nextOrderStatus` (Task 6), `OrderDetails` (Task 7), the existing `updateOrder` service.
- Produces: no new exports. The admin detail screen renders the shared component.

- [ ] **Step 1: Add the imports**

```js
import OrderDetails from "../components/OrderDetails";
import { normalizeOrder, nextOrderStatus } from "../lib/orderDetail";
```

Keep the existing `@shared/constants` import for anything the remaining selects still use, and drop any constant that becomes unused once the markup below is deleted.

- [ ] **Step 2: Normalize at render time and retire the server-provided flow**

`orderFlow` is fetched from the server and used in exactly four places: `advance()` (lines 113-124), the three derived lines (197-199), the timeline markup (lines 257-275), and the button label (line 292). Tasks 6 and 7 replace all four, so the state, its three `setOrderFlow` calls (lines 63, 99, 166), and the `TERMINAL` constant (line 21) all go. `TERMINAL` reads `[CANCELLED, REFUNDED]` and silently omits `DELIVERED`, so a delivered order shows neither the terminal hint nor a disabled advance — that is one of the bugs this rewrite fixes.

Replace lines 197-199:

```js
  // One state object, normalized on render, so there is no second source of
  // truth to keep in sync after save(). view.isTerminal asks the shared
  // isClosedOrderStatus rule, which covers DELIVERED — the local TERMINAL
  // constant it replaces did not.
  const view = order ? normalizeOrder(order) : null;
  const terminal = view.isTerminal;
```

Delete line 21 (`const TERMINAL = ...`), line 36 (`const [orderFlow, setOrderFlow] = useState([]);`), and the `setOrderFlow(...)` calls on lines 63, 99, and 166. Keep `CANNOT_CANCEL`, which already covers `DELIVERED` for the cancel button.

- [ ] **Step 3: Drive the advance button from the shared rule**

Replace the `advance()` function (lines 113-124):

```js
  const advance = async () => {
    if (!view) return;
    const target = nextOrderStatus(view.status);
    if (!target) return;
    await save({ status: target });
  };
```

Replace the button block (lines 285-294), whose label reads `orderFlow[currentIdx + 1]` from the server-provided array:

```jsx
            <button
              type="button"
              className="filament-btn filament-btn-primary"
              disabled={busy || nextOrderStatus(view.status) === null}
              onClick={advance}
            >
              {nextOrderStatus(view.status)
                ? `Move to ${ORDER_STATUS_LABELS[nextOrderStatus(view.status)]}`
                : "No further steps in the flow"}
            </button>
```

The payment-status select (line 298) and the cancel button stay untouched — they are outside this feature's scope.

- [ ] **Step 4: Replace the timeline, address, and items markup with `OrderDetails`**

Three blocks go, three blocks stay:
- Delete the timeline div (lines 257-275, the `{orderFlow.length > 0 && (...)}` block). Leave the `{terminal ? ... : canUpdateOrder && (...)}` actions block below it alone — Step 3 already rewired it.
- Delete the `detail-block` Shipping Address (lines 355-370). It is the broken one.
- Delete the `detail-block` Payment (lines 372-387). `OrderDetails` renders the payment label and method; only the badge styling goes, which is cosmetic.
- Delete the Items card (lines 390 to the end of that card).

Keep the `stat-grid` (lines 313-338): `OrderDetails` does not know the coupon or the placed date. Keep the `detail-block` Customer (lines 340-354): it links to the customer page, which `OrderDetails` cannot do. For those two, pass the flags:

```jsx
      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h2>Order details</h2>
          </div>
        </div>
        <OrderDetails order={view} showTotals={false} showCustomer={false} />
      </div>
```

in place of the deleted Items card.

- [ ] **Step 5: Verify lint and build**

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend && npx oxlint src/pages/OrderView.jsx src/components/OrderDetails.jsx
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run lint 2>&1 | grep -c "warning"
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run build 2>&1 | tail -3
```

Expected: no oxlint problems in either file, no increase in the total warning count, and a successful build.

- [ ] **Step 6: Verify the address now renders for a real order**

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run dev
```

Open an order that has a shipping address and confirm the Shipping address block shows the street and pincode. Before this task it rendered `—` for any order whose address was written by checkout (`Storefront.jsx:1254-1256` writes `address`/`pincode`), because the screen read `shipping_address.line1` and `.postal`. Older rows that carry `line1`/`postal` rendered; the live table contains both key sets, which is why the normalizer reads both rather than renaming one. Also confirm the "Move to next" button advances correctly and disappears at `DELIVERED`.

- [ ] **Step 7: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add frontend/src/pages/OrderView.jsx
git commit -m "refactor(orders): render the admin order screen through OrderDetails

Replaces the hand-written timeline, address, and items markup with the
shared component, and drives the advance button from nextOrderStatus
instead of index arithmetic against a server-provided flow.

The shipping block now shows a real address for checkout-written orders:
checkout writes address and pincode while the screen read line1 and postal,
so those orders rendered an em dash. The normalizer reads both key sets,
because the live table contains both.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Store panel and branch screens

**Files:**
- Modify: `frontend/storepub/vite.config.js`, `frontend/storepanel/vite.config.js` (add the `@shared` alias)
- Modify: `frontend/src/pages/StorePanel.jsx:271-281` (status colours), `:762-765` (filter), `:770-822` (table and actions)
- Modify: `frontend/src/pages/BranchOrders.jsx:7-25` (local maps) plus its status column and action
- Modify: `frontend/src/services/store.js`, `frontend/src/services/branches.js` (item PATCH helpers)

**Interfaces:**
- Consumes: `ORDER_STATUSES`, `ORDER_STATUS_LABELS` from `@shared/constants`; `itemStatusOptions` from `../lib/orderDetail`.
- Produces: `storeUpdateOrderItem(branchId, orderUuid, itemId, status)`; `updateBranchOrderItem(branchId, orderId, itemId, status)`.

- [ ] **Step 1: Add the `@shared` alias to both Vite apps**

Neither app has it, which is why `StorePanel.jsx` and `Storefront.jsx` hand-copy the status lists instead of importing them. `frontend/storepub/vite.config.js`:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../shared', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true, rewrite: (p) => p },
      "/media": { target: "http://localhost:3000", changeOrigin: true, rewrite: (p) => p },
    },
  },
});
```

Make the identical change to `frontend/storepanel/vite.config.js`, keeping its `port: 5175`. Both apps already import `../../src/...` files, so reaching out of their roots works.

- [ ] **Step 2: Add the item PATCH service helpers**

Both files already declare `const API_URL = "/api"` and `import { authHeaders } from "./http"`, and every neighbouring function spreads `authHeaders()` into its headers. Match that exactly. A helper that omits it sends an unauthenticated request and gets a 401 that looks like a backend bug.

Append to `frontend/src/services/store.js`, which also sets `x-branch-id` on every store call:

```js
// Advances one item on an order belonging to this store. The order status is
// re-rolled by the backend; this only sets the item.
export async function storeUpdateOrderItem(branchId, uuid, itemId, status) {
  const response = await fetch(`${API_URL}/store/my/orders/${uuid}/items/${itemId}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json", "x-branch-id": branchId },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  return await response.json();
}
```

Append to `frontend/src/services/branches.js`, next to the existing `updateBranchOrderStatus`. Branch endpoints authenticate by cookie and take the branch from the path, so there is no `x-branch-id` header to send:

```js
export async function updateBranchOrderItem(branchId, orderId, itemId, status) {
  const response = await fetch(`${API_URL}/branches/${branchId}/orders/${orderId}/items/${itemId}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  return await response.json();
}
```

- [ ] **Step 3: Replace the duplicated constants in `StorePanel.jsx`**

Add the imports:

```js
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
} from "@shared/constants";
import { itemStatusOptions } from "../lib/orderDetail";
import { storeUpdateOrderItem } from "../services/store";
```

Move the colour map to module scope above the component so it is not rebuilt per row, and add the missing `REFUNDED` key:

```js
const STATUS_COLORS = {
  PENDING: "#f59e0b", CONFIRMED: "#3b82f6", PROCESSING: "#8b5cf6",
  PACKED: "#ec4899", SHIPPED: "#0ea5e9", OUT_FOR_DELIVERY: "#f97316",
  DELIVERED: "#22c55e", CANCELLED: "#ef4444", REFUNDED: "#7c3aed",
};
```

Replace `statusBadge` (lines 271-281) so the label comes from the shared map while keeping the existing chip styling:

```jsx
  function statusBadge(status) {
    return (
      <span className="sf-variant-chip" style={{ background: STATUS_COLORS[status] || "#666", color: "#fff" }}>
        {ORDER_STATUS_LABELS[status] || status}
      </span>
    );
  }
```

Replace the hardcoded filter array (lines 761-763):

```jsx
                  <select className="filament-select" value={orderStatusFilter} onChange={(e) => setOrderStatusFilter(e.target.value)}>
                    <option value="">All Status</option>
                    {ORDER_STATUSES.map((s) => (
                      <option key={s} value={s}>{ORDER_STATUS_LABELS[s] || s}</option>
                    ))}
                  </select>
```

`ORDER_STATUSES` is `Object.values(ORDER_STATUS)`, so it already includes `REFUNDED`, which the hardcoded list omits — a refunded order is currently unfilterable. The labels come from the shared map instead of `s.replace(/_/g, " ")`, so they read "Out For Delivery" the same way everywhere else.

- [ ] **Step 4: Collapse the six hardcoded buttons into one control and show per-item badges**

Add a handler above the component's return, reusing the refresh pattern already used by `handleStatusChange`:

```jsx
  async function handleItemStatus(order, itemId, status) {
    if (!itemId || !status) return;
    const result = await storeUpdateOrderItem(branchUuid, order.uuid, itemId, status);
    // Follow the existing handleStatusChange pattern exactly: no message state
    // exists on this screen, so a success just re-reads the page with loadOrders().
    // The rolled-up status and the item badges both come from the server rather
    // than being recomputed here.
    if (result.success) {
      loadOrders();
    }
  }
```

Task 3's aggregates include `'id', oi.id` in `item_statuses`, so each badge already carries the item id its control needs — no separate `itemIds` field. Put the control on each item's own row inside the Items column rather than offering one control for the order, because the whole point of per-item status is that two lines on the same order move independently. `handleItemStatus` takes the item id as its second argument for that reason.

One prerequisite, in `loadOrders` (lines 118-133): the row mapper lists every field explicitly, so `item_statuses` would be silently dropped. Add one line to that map:

```js
          itemStatuses: o.item_statuses || o.itemStatuses || [],
```

Add an Items column between Payment and Status (the header row is lines 771-778), so a partially packed order is visible and controllable without opening it:

```jsx
                        <td>
                          {(o.itemStatuses || []).map((it, i) => (
                            <div key={it.id ?? i} style={{ marginBottom: 4 }}>
                              <div>
                                <span className="sf-cat">{it.quantity}×</span>{" "}
                                <span className="sf-variant-chip">
                                  {ORDER_STATUS_LABELS[it.status] || it.status}
                                </span>
                              </div>
                              {itemStatusOptions(it.status).length > 0 ? (
                                <select
                                  className="filament-select"
                                  style={{ marginTop: 2, fontSize: 12 }}
                                  value=""
                                  onChange={(e) =>
                                    e.target.value && handleItemStatus(o, it.id, e.target.value)
                                  }
                                >
                                  <option value="">Move to…</option>
                                  {itemStatusOptions(it.status).map((s) => (
                                    <option key={s} value={s}>
                                      {ORDER_STATUS_LABELS[s] || s}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="sf-item-meta">Final</div>
                              )}
                            </div>
                          ))}
                        </td>
```

and the matching `<th>Items</th>`. Each item gets its own control, driven by `itemStatusOptions(it.status)` — the item's own stage, not the order's. Deriving the options from the order status would offer a backwards move to an item that is already ahead of the order, which the backend then rejects.

Replace the six per-status buttons (lines 799-817) with just the order-level cancel, which stays an order-level action. Keep the Bill button (line 797) and the cancel button (line 818):

```jsx
                          {o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
                            <button className="filament-btn filament-btn-outline" style={{ marginLeft: 6, color: "#ef4444", borderColor: "#ef4444" }} onClick={() => handleCancelOrder(o)}>Cancel</button>
                          )}
```

The row's own order-level advance (`handleStatusChange`) becomes dead code once the last call site goes — delete the function, and remove `storeUpdateOrder` from the import on line 5, which has no other caller on this screen. Leave `storeUpdateOrder` itself in `store.js`: it is a shared service file, and deleting an export another screen might use is out of scope.

- [ ] **Step 5: Replace `BranchOrders.jsx`'s local maps with the shared rule**

`frontend/src/pages/BranchOrders.jsx:7-14` hand-maintains a `NEXT_STATUS` map that duplicates `ORDER_FLOW`. Delete `NEXT_STATUS` and import the shared helpers:

```js
import {
  ORDER_STATUS_LABELS,
  formatCurrency,
  formatDateTime,
} from "@shared/constants";
import { nextOrderStatus, itemStatusOptions } from "../lib/orderDetail";
import { updateBranchOrderItem } from "../services/branches";
```

`ORDER_STATUS` goes too: it was only used as computed keys inside `NEXT_STATUS`, and `STATUS_COLORS` uses plain string keys. Leaving it imported trips the unused-import lint. `isForwardStatusMove` is not needed here; `itemStatusOptions` already returns `[]` for a finished item, which is the entire gate.

Add the missing `REFUNDED: "#7c3aed"` key to `STATUS_COLORS` while here — a refunded order otherwise renders the `#666` fallback grey, which reads as "unknown" rather than "finished". Same reasoning as the `StorePanel` colour-map fix in Step 3.

Rows here are raw API responses (`setOrders(result.orders)` with no field mapper), so Task 3's `item_statuses` arrives without a mapping change — the opposite of `StorePanel`, whose explicit mapper needs the extra line.

Replace the Actions cell (the `{NEXT_STATUS[o.status] && (...)}` button) with the per-item column content below, and add an Items `<th>` between Total and Status. The branch id in scope is `id` from `useParams`, and an order's uuid is `order.uuid`:

```jsx
                  <td>
                    {(o.item_statuses || []).map((it, i) => (
                      <div key={it.id ?? i} style={{ marginBottom: 4 }}>
                        <div>
                          <span className="sf-cat">{it.quantity}× {it.productName}</span>{" "}
                          <span className="stock-badge-ok" style={{ background: STATUS_COLORS[it.status] ?? "#666" }}>
                            {ORDER_STATUS_LABELS[it.status] ?? it.status}
                          </span>
                        </div>
                        {itemStatusOptions(it.status).length > 0 && (
                          <select
                            className="input"
                            style={{ marginTop: 2, fontSize: 12 }}
                            value=""
                            onChange={(e) =>
                              e.target.value && handleItemStatus(o, it.id, e.target.value)
                            }
                          >
                            <option value="">Move to…</option>
                            {itemStatusOptions(it.status).map((s) => (
                              <option key={s} value={s}>
                                {ORDER_STATUS_LABELS[s] ?? s}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </td>
```

with the handler beside the existing `handleStatusChange`, mirroring its refresh block exactly — there is no message or error state on this screen, so a success re-reads the list the same way:

```jsx
  async function handleItemStatus(order, itemId, status) {
    if (!itemId || !status) return;
    const result = await updateBranchOrderItem(id, order.uuid, itemId, status);
    if (result.success) {
      const params = { page: pagination.page, limit: pagination.limit };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const data = await listBranchOrders(id, params);
      if (data.success) {
        setOrders(data.orders);
        setPagination(data.pagination);
      }
    }
  }
```

`handleStatusChange` and `updateBranchOrderStatus` lose their only order-advance call site once the Actions button goes, but the new branch order-level route in Task 5 still needs a caller somewhere, so leave both in place. Code the plan itself gives a future to is not deleted as dead.

- [ ] **Step 6: Verify both apps build and the alias resolves**

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend/storepanel && npm run build 2>&1 | tail -3
cd /var/www/html/Node-JS/Ecommerce/frontend/storepub && npm run build 2>&1 | tail -3
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run lint 2>&1 | grep -c warning
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run build 2>&1 | tail -2
```

Expected: `storepanel` builds — that is the proof the new alias resolves — `storepub` builds, and no new oxlint warnings. Neither app has a lint script, so the build is the only automated check for them.

- [ ] **Step 7: Verify a store can move one item**

With `backend` and `frontend/storepanel` running, open an order with two items in different stages. Move the **first** item one step forward and confirm:

1. the second item's badge does not move,
2. the order status drops back to the slower item if the first item had been ahead,
3. a second item still shows its own select, so the two rows really are independent.

Then bring the second item up to the same stage and confirm the order status advances.

Repeat for a branch manager in `frontend/storepub` to cover the branch endpoint. The store path and the branch path are separate route files with separately-written authorization, so exercising only one proves nothing about the other.

Restore any live orders you moved, following the capture-and-restore procedure in Task 5 Step 7.

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add frontend/storepub/vite.config.js frontend/storepanel/vite.config.js \
  frontend/src/services/store.js frontend/src/services/branches.js \
  frontend/src/pages/StorePanel.jsx frontend/src/pages/BranchOrders.jsx
git commit -m "feat(orders): per-item status in the store panel and branch screens

Adds the @shared alias to storepub and storepanel, which had no way to import
the shared constants - the reason the status lists were hand-copied and the
comment in the checkout route claims the rule sets are kept in step by hand.

StorePanel's six hardcoded per-status buttons become one select driven by
ORDER_FLOW, and both list screens gain per-item status badges so a partially
packed order is visible without opening it. BranchOrders drops its local
NEXT_STATUS map for the shared forward-move rule.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Storefront tracking — shared timeline and live polling

**Files:**
- Modify: `frontend/src/lib/orderDetail.js` (append the polling helpers)
- Modify: `frontend/src/pages/Storefront.jsx` — `OrderTrack` from line 1426
- Modify: `frontend/scripts/verify-order-status.mjs` (append the polling tests)

**Interfaces:**
- Consumes: `normalizeOrder` (Task 6), `OrderDetails` (Task 7).
- Produces: `POLL_INTERVAL_MS = 10000` and `isPollingActive(status): boolean` exported from `frontend/src/lib/orderDetail.js`, so the schedule is testable instead of buried in the component.

- [ ] **Step 1: Add the polling helpers to the pure module**

Append to `frontend/src/lib/orderDetail.js`:

```js
// How often the storefront re-reads an active order: frequent enough to feel
// live, cheap enough not to hammer the tracking endpoint.
export const POLL_INTERVAL_MS = 10000;

// Polling runs only while the order is somewhere in the fulfilment flow, and
// stops for good on a terminal status so it costs nothing after delivery.
//
// DELIVERED is the last member of ORDER_FLOW, so membership alone is the wrong
// test: it would keep polling forever on a delivered order. Exclude the closed
// statuses explicitly, which also covers CANCELLED and REFUNDED, neither of
// which is in ORDER_FLOW at all.
export function isPollingActive(status) {
  return ORDER_FLOW.includes(status) && !isClosedOrderStatus(status);
}
```

Add `isClosedOrderStatus` to the import list at the top of `frontend/src/lib/orderDetail.js` (the Task 6 import block):

```js
import {
  ORDER_FLOW,
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  ORDER_PAYMENT_METHODS_LABELS,
  isClosedOrderStatus,
} from "../../../shared/constants.js";
```

Append to `frontend/scripts/verify-order-status.mjs`:

```js
// --- polling schedule ------------------------------------------------------
// ORDER_FLOW, ORDER_STATUS, ORDER_CLOSED_STATUSES and isClosedOrderStatus are
// already imported at the top of this file by Task 2, so only the new module is
// imported here.
import { POLL_INTERVAL_MS, isPollingActive } from "../src/lib/orderDetail.js";

assert.equal(POLL_INTERVAL_MS, 10000, "the poll interval is 10s");

// Every stage that still has work left keeps polling. The test closes over the
// same isClosedOrderStatus the implementation uses, which is deliberate: the
// assertion is "the two agree", so a change to the definition of closed in
// shared/constants.js is caught by the shared rule's own tests in Task 2
// rather than silently redefining what this one expects.
for (const s of ORDER_FLOW.filter((x) => !isClosedOrderStatus(x))) {
  assert.equal(isPollingActive(s), true, `${s} should keep polling`);
}

// DELIVERED is in ORDER_FLOW, so a membership-only test would pass it and poll
// a delivered order forever. It must stop.
assert.equal(isPollingActive(ORDER_STATUS.DELIVERED), false,
  "DELIVERED is the last flow member but must stop polling");
assert.equal(isPollingActive("CANCELLED"), false, "cancelled stops polling");
assert.equal(isPollingActive("REFUNDED"), false, "refunded stops polling");
assert.equal(isPollingActive(undefined), false, "an unknown status does not poll forever");
assert.equal(isPollingActive("NONSENSE"), false, "a garbage status does not poll forever");

// Nothing in the flow is polled after it closes.
for (const s of ORDER_CLOSED_STATUSES) {
  assert.equal(isPollingActive(s), false, `${s} is closed and must not poll`);
}

// Re-add the success marker as the last statement in the file, so it only
// prints once every assertion above has passed.
console.log("verify-order-status ok");
```

- [ ] **Step 2: Run the tests**

```bash
cd /var/www/html/Node-JS/Ecommerce
node frontend/scripts/verify-order-status.mjs
```

Expected: `verify-order-status ok`

- [ ] **Step 3: Guard against out-of-order poll responses**

This is Review Focus 1: two polls in flight can resolve in the opposite order to when they were sent, which would move the customer's view of an item backwards while the store advances it.

Add `useRef` to the existing React import on line 1 (`import { useEffect, useState } from "react";`) and add, near the other imports at the top of the file:

```js
import OrderDetails from "../components/OrderDetails";
import {
  normalizeOrder,
  POLL_INTERVAL_MS,
  isPollingActive,
} from "../lib/orderDetail";
```

`api()` is a module-level helper in this file (line 19), so the interval below calls it directly — no import needed.

Inside `OrderTrack`, after the existing `track` function:

```jsx
  // Monotonic counter: only the newest in-flight response may write state, so a
  // slow earlier request cannot roll the customer's view backwards.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!result) return undefined;

    const active = normalizeOrder(result);
    if (!isPollingActive(active.status)) return undefined;

    let cancelled = false;

    const timer = setInterval(async () => {
      // Stamp each request at send time, inside the interval. Reading the
      // counter once when the effect was set up would give every poll in this
      // interval the same number, and since the effect is rebuilt whenever
      // `result` changes, two overlapping polls would both pass the guard.
      const number = ++requestSeq.current;

      const { ok, data } = await api(
        `/orders/track?order_number=${encodeURIComponent(form.order_number.trim())}&email=${encodeURIComponent(form.email.trim().toLowerCase())}`
      );

      // A response is stale if a newer request has been sent since, or if this
      // effect was torn down while the request was in flight.
      if (cancelled || number !== requestSeq.current) return;
      if (ok) setResult({ ...data.order, statusHistory: data.statusHistory || [] });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [result, form.order_number, form.email]);
```

`setResult` changes `result`, which is a dependency, so React tears the effect down and starts a new interval on every successful poll. That is intentional here: it re-evaluates `isPollingActive` against the new status, which is how polling stops on its own once the order reaches `DELIVERED`. The `cancelled` flag makes the teardown safe, and the counter keeps a straggling response from an old interval from writing over the new state.

- [ ] **Step 4: Remove the local `STEPS`/`LABELS` and render the shared component**

The `OrderTrack` detail branch (line 1487 onward) has five hand-written sections: the `sf-track-meta` header (lines 1505-1526), the `sf-timeline` stepper (lines 1529-1541) driven by the local `STEPS`, the `sf-history` audit list (lines 1544-1553), the `sf-lines` item list (lines 1555-1575, which shows no per-item status at all), and the `sf-addr` footer (lines 1577-1582). Delete the constants (lines 1432-1439) and replace **all five sections** with:

```jsx
        <OrderDetails order={normalizeOrder(result)} />
```

Keep the page-title header with the Back button (lines 1492-1504) and the bill-download button (lines 1460-1474, called from the meta block — move the call into its own row above `OrderDetails` rather than leaving it orphaned). Keep the `sf-history` order-level audit list: per-item history lives inside the shared component, but the order-level trail has no home there, so it stays as its own block. Replace its label lookup with the shared map:

```jsx
<b>{ORDER_STATUS_LABELS[h.status] || h.status}</b>
```

importing `ORDER_STATUS_LABELS` from `@shared/constants`. Do not keep the local `LABELS` for the history rows — that would leave two label sources on the same screen.

`STEPS` began with `"PLACED"`, which has never existed in the database, so `stepIdx` was `-1` for every `PENDING` and `CONFIRMED` order and the stepper highlighted no dot at all; the shared timeline derives from `ORDER_FLOW` and cannot drift.

There is no Step 5 in this task and no manual refresh button. The design decision was poll-only, so adding one here would put a control on the page that the approved design does not have. The existing submit button already re-runs `track` on demand, which covers the customer who does not want to wait ten seconds.

- [ ] **Step 5: List every order on the email when the order number is missing**

A customer who lost their order id submits the form with the order-number field blank. `track()` must branch on that instead of sending a blank `order_number` to the detail endpoint (which would 404). Add a list state next to the existing `result` state:

```jsx
  const [orderList, setOrderList] = useState(null);
```

Extract the detail fetch so both the form submit and a row click use it — two copies of the same `api()` call is how they drift apart:

```jsx
  async function loadDetail(orderNumber, email) {
    const { ok, data } = await api(
      `/orders/track?order_number=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}`
    );
    if (!ok) {
      setErr(data.message || "Order not found. Check your order number and email.");
      setResult(null);
      return;
    }
    // API returns { order, statusHistory, ... } — keep both for the UI.
    setResult({ ...data.order, statusHistory: data.statusHistory || [] });
  }
```

Rewrite `track()` (lines 1441-1456) around it:

```jsx
  async function track(e) {
    if (e) e.preventDefault();
    setBusy(true);
    setErr("");
    setResult(null);
    setOrderList(null);
    const email = form.email.trim().toLowerCase();
    const orderNumber = form.order_number.trim();
    // No order number: the customer lost it — list every order on the email
    // (Task 3's email-only branch) instead of 404ing on a blank number.
    if (!orderNumber) {
      const { ok, data } = await api(`/orders/track?email=${encodeURIComponent(email)}`);
      setBusy(false);
      if (!ok) {
        setErr(data.message || "Something went wrong. Check the email and try again.");
        return;
      }
      setOrderList(data.orders || []);
      return;
    }
    await loadDetail(orderNumber, email);
    setBusy(false);
  }

  async function pickOrder(orderNumber) {
    setBusy(true);
    setErr("");
    setForm((f) => ({ ...f, order_number: orderNumber }));
    setOrderList(null);
    await loadDetail(orderNumber, form.email.trim().toLowerCase());
    setBusy(false);
  }
```

Render the pick-list above the detail branch (before line 1487's `if (result && ...)`). The storefront loads no stylesheet at all — no import in `main.jsx`, no link in `index.html` — so no shared table class will style this; use a plain table with a few inline styles so it reads as a table even with zero CSS, and the same `sf-btn primary` button class the form already uses:

```jsx
  if (orderList && !result) {
    return (
      <div>
        <div className="sf-page-title">
          <button
            className="sf-link"
            onClick={() => {
              setOrderList(null);
              onBack();
            }}
          >
            <FiChevronLeft /> Back
          </button>
          <h2>Your orders</h2>
        </div>
        {orderList.length === 0 ? (
          <p>No orders found for that email address.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px" }}>Order</th>
                <th style={{ textAlign: "left", padding: "8px" }}>Date</th>
                <th style={{ textAlign: "right", padding: "8px" }}>Total</th>
                <th style={{ textAlign: "left", padding: "8px" }}>Payment</th>
                <th style={{ textAlign: "left", padding: "8px" }}>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orderList.map((o) => (
                <tr key={o.orderNumber} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "8px" }}><code>{o.orderNumber}</code></td>
                  <td style={{ padding: "8px" }}>{fmtTime(o.createdAt)}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{inr(o.total)}</td>
                  <td style={{ padding: "8px" }}>{o.paymentStatus}</td>
                  <td style={{ padding: "8px" }}>{ORDER_STATUS_LABELS[o.status] || o.status}</td>
                  <td style={{ padding: "8px" }}>
                    <button
                      type="button"
                      className="sf-btn primary"
                      disabled={busy}
                      onClick={() => pickOrder(o.orderNumber)}
                    >
                      Track
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
```

`ORDER_STATUS_LABELS` comes from the `@shared/constants` import Step 4 already adds; `inr` and `fmtTime` are module-level helpers already in this file. The form's order-number input needs no change — it is already submittable blank, which is what reaches the new branch. Update its placeholder to hint at that, e.g. `placeholder="Order number (leave blank to list all your orders)"`.

- [ ] **Step 6: Verify the build and the tests**

```bash
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run lint 2>&1 | grep -c warning
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run build 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/frontend/storepub && npm run build 2>&1 | tail -3
cd /var/www/html/Node-JS/Ecommerce && node frontend/scripts/verify-order-status.mjs
```

Expected: no new oxlint warnings; `storepub` builds, which is the real proof that `OrderDetails.css` reaches the storefront despite `index.css` never being loaded there; and the test script prints `verify-order-status ok`.

- [ ] **Step 7: Verify the pick-list in a browser**

With `backend` and `frontend/storepub` running, submit the track form with an email alone and confirm the table lists every order on that email, newest first, with the same row count as `SELECT count(*) FROM orders WHERE LOWER(customer_email)=...`. Click a row's Track button and confirm the detail below matches what the order-number lookup shows for the same order — same timeline stage, same per-item statuses. Submit an email with no orders and confirm the empty message rather than a blank page.

- [ ] **Step 8: Verify the polling loop in a browser**

This cannot be automated. With `backend` and `frontend/storepub` running:

1. Track an order that is still active. Confirm the timeline highlights its current stage and each item shows its own status.
2. In a second tab, advance one item through a `curl` call.
3. Within 10 seconds, confirm the customer tab updates on its own and the order status steps to the **slower** item rather than the one that moved.
4. Advance the order to `DELIVERED`, wait 20 seconds, and confirm no further requests appear in the storefront's Network tab.
5. Navigate away from the tracking view. Confirm the interval is cleared: no requests continue, and no React state-update warning appears in the console.

- [ ] **Step 9: Commit**

```bash
cd /var/www/html/Node-JS/Ecommerce
git add frontend/src/pages/Storefront.jsx frontend/src/lib/orderDetail.js \
  frontend/scripts/verify-order-status.mjs
git commit -m "feat(orders): live per-item status on the storefront tracking page

Replaces the local STEPS array and the hand-written timeline and items
markup with the shared component. STEPS began with PLACED, a value that has
never existed in the database, so the stepper highlighted no dot for PENDING
or CONFIRMED orders.

Adds a 10s poll that runs only while the order is in the fulfilment flow and
stops for good on DELIVERED, CANCELLED or REFUNDED, clearing its interval on
unmount and on view change. A monotonic request counter discards out-of-order
responses so a slow earlier request cannot roll the customer's view of an
item backwards.

The order-number field is now optional: submitting email alone lists every
order on that email as a pick-list, for the customer who lost their order
id. Picking a row loads the same detail view through the shared fetcher.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full verification pass

**Files:** none modified. This task proves the ten before it.

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Run every verification script**

```bash
cd /var/www/html/Node-JS/Ecommerce
node frontend/scripts/verify-order-status.mjs
node frontend/scripts/verify-geocode.mjs
```

Expected: both print their `ok` marker. The geocode script must still pass — Task 10 edits the same file.

- [ ] **Step 2: Confirm the data matches the Task 1 baseline**

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -c "SELECT o.status, count(*) FROM orders o GROUP BY o.status ORDER BY 2 DESC;"
psql "$DATABASE_URL" -t -c "SELECT count(*) FROM orders;"
psql "$DATABASE_URL" -t -c "SELECT count(*) FROM orders WHERE order_number='ORD-0000021';"
psql "$DATABASE_URL" -t -c "SELECT md5(string_agg(oi.id || ':' || oi.order_id, ',' ORDER BY oi.id)) FROM order_items oi;"
psql "$DATABASE_URL" -t -c "SELECT o.status, oi.item_status, count(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id GROUP BY 1,2 ORDER BY 1,2;"
```

Expected: the status histogram matches Task 1 Step 1, the order count is still 8, `ORD-0000021` is still present, the item hash matches the one recorded in Task 1 Step 1, and the per-order status pairing matches the pairing recorded at the end of Task 1 Step 5.

Note that the *hash* is expected to match the pre-change value while the *status pairing* is not: the backfill deliberately changed `item_status` on every item of a non-`PENDING` order. Task 1 Step 5 records the post-backfill pairing, and that is the value to compare here.

- [ ] **Step 3: Prove the roll-up invariant holds across every order**

This is the single most important check. For every order, the stored status must equal the roll-up of its items, unless the order is `CANCELLED` or `REFUNDED`, which override it.

```bash
cd /var/www/html/Node-JS/Ecommerce
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -c "
SELECT o.order_number, o.status AS order_status, string_agg(DISTINCT oi.item_status, ',') AS item_statuses
FROM orders o JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.order_number, o.status
ORDER BY o.order_number;"
```

For each row whose `order_status` is one of the seven flow values, the **earliest** status present in `item_statuses` walking `PENDING → CONFIRMED → PROCESSING → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED` must equal `order_status`. Check each row by hand.

The two `CANCELLED` orders are the expected exception: their items stay `PENDING` while the order reads `CANCELLED`. That is the designed override, not a violation.

- [ ] **Step 4: Confirm no item ever holds a non-flow value**

```bash
psql "$DATABASE_URL" -t -c "SELECT count(*) FROM order_items WHERE item_status NOT IN ('PENDING','CONFIRMED','PROCESSING','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED');"
psql "$DATABASE_URL" -t -c "SELECT count(*) FROM orders o WHERE o.status IN ('CANCELLED','REFUNDED') AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.item_status IN ('CANCELLED','REFUNDED'));"
```

Expected: `0` and `0`. The second query guards the invariant the Global Constraints state in words: `CANCELLED` and `REFUNDED` must never be written to an item, even when the order itself carries them.

- [ ] **Step 5: Lint every app against its baseline**

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npx eslint backend/lib/orderStatus.js backend/lib/models/orderItem.js backend/lib/models/order.js 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/backend && npx eslint 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/frontend && npx oxlint src/lib/orderDetail.js src/components/OrderDetails.jsx src/pages/OrderView.jsx src/pages/StorePanel.jsx src/pages/BranchOrders.jsx src/pages/Storefront.jsx src/services/store.js src/services/branches.js
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run lint 2>&1 | grep -c "warning"
```

Expected: the touched backend files report no errors on their own; the whole backend still reports `0 errors` and no more than the 34 pre-existing warnings; oxlint reports no problems in the touched frontend files; the full frontend lint reports no new warnings. `storepub` and `storepanel` have no lint script — their check is the build in the next step.

- [ ] **Step 6: Build all four apps**

```bash
cd /var/www/html/Node-JS/Ecommerce/backend && npm run build 2>&1 | tail -3
cd /var/www/html/Node-JS/Ecommerce/frontend && npm run build 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/frontend/storepub && npm run build 2>&1 | tail -2
cd /var/www/html/Node-JS/Ecommerce/frontend/storepanel && npm run build 2>&1 | tail -2
```

Expected: all four succeed. Confirm the new routes exist in the Next.js route table the build prints: `/api/store/my/orders/[uuid]/items/[itemId]`, `/api/branches/[id]/orders/[orderId]`, and `/api/branches/[id]/orders/[orderId]/items/[itemId]`. If `next build` does not print the table in this version, list the three directories with `ls` instead — the point is proving the files are where the routes resolve from, not the exact command output.

- [ ] **Step 7: Confirm the hardcoded status lists are gone**

```bash
cd /var/www/html/Node-JS/Ecommerce
grep -rn "\"PENDING\"," frontend/src frontend/storepub/src frontend/storepanel/src --include=*.jsx
grep -rn "OUT_FOR_DELIVERY" frontend/src frontend/storepub/src frontend/storepanel/src --include=*.jsx --include=*.js
grep -rn "NEXT_STATUS" frontend/src
```

Expected: the only remaining literals are colour maps and CSS class names, not status arrays or next-step maps. Any array that enumerates statuses must come from `ORDER_FLOW` or `ORDER_STATUSES`.

- [ ] **Step 8: Review the whole branch**

```bash
cd /var/www/html/Node-JS/Ecommerce
git log --oneline master..HEAD
git diff --stat master...HEAD
```

Confirm every task's commit is present, no unrelated files were staged, and the pre-existing uncommitted work in the working tree is still uncommitted and untouched.
