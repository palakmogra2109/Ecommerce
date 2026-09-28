# Per-item order status and consolidated order details

## Purpose

Two related changes to how orders are tracked and displayed:

1. **Per-item order status.** Every item in an order carries its own fulfilment
   status, so a customer can see that one item is packing while another is still
   being prepared — the Zomato experience. Today `order_items` has no status
   column at all and the whole order moves as a single unit.
2. **All order details in one module.** Order details are currently rendered by
   four separate screens from three different API response shapes, with nine
   hardcoded copies of the order-status list. This consolidates them onto one
   normalized data module and one shared component.

Success means: a customer opens the tracking page and sees each item's live
status; the store advances items individually; the order's own status is always
consistent with its slowest item; and the order details render from one place
instead of four.

## Current state

- `orders.status` is the single source of truth for fulfilment. It drives a DB
  `CHECK` constraint, `ORDER_FLOW` forward-only validation, and dashboard
  counts.
- `order_items` has 11 columns: no status, no timestamps, no `uuid`.
- `order_status_history` records order-level transitions only. There is no
  per-item equivalent.
- Order detail is rendered by `OrderView.jsx` (admin), `OrderTrack` inside
  `Storefront.jsx` (customer), `StorePanel.jsx` (store manager) and
  `BranchOrders.jsx` (branch manager).
- The three read endpoints return three different shapes for the same order:
  snake_case from `/api/orders/:id`, camelCase from
  `/api/store/my/orders/:uuid`, and a mixed shape from
  `/api/store/orders/track`.
- The storefront fetches an order once on form submit and never polls.
- Live data: 8 orders, 22 order items, 13 status-history rows. Two orders are
  `CANCELLED` and 7 items belong to them.

## Decisions

These were settled with the requester and are not reopened here.

| Decision | Choice |
|---|---|
| Relationship between order and item status | Items are the source of truth; the order status is derived |
| Roll-up rule | Slowest item wins |
| Item status vocabulary | Reuse the existing `ORDER_FLOW` — no second vocabulary |
| Who may set item status | Store managers and branch managers, following existing rules |
| "One module" scope | Shared data module **and** one shared component |
| Customer live updates | Poll while the order is active, then stop |
| Cancellation | Stays order-level and overrides the roll-up |

## Data model

Appended to `backend/sql/schema.sql` in the file's existing style. That file is
applied directly with `psql -v ON_ERROR_STOP=1`; there is no migration runner.

```sql
-- Per-item fulfilment status. The order's own status is rolled up from these
-- (the furthest-behind item wins), so a single item can be packing while
-- another is still cooking. Only ORDER_FLOW values are valid here:
-- CANCELLED and REFUNDED are order-level states set directly.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_status_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS order_items_status_idx ON order_items(item_status);
```

Column naming is snake_case (`item_status`, not `itemStatus`). The existing
`orders.branchId` is declared camelCase and folds to `branchid` in Postgres,
and every query uses the lowercase spelling — repeating that trap here would be
a needless source of bugs.

### Item status history

Mirrors the existing `order_status_history` so the customer can see when each
item changed.

```sql
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

No `uuid` is added to `order_items`. Items are addressed only through their
parent order's `uuid`, matching how every resource is addressed publicly, and
this avoids exposing the BIGINT `id`.

### No CHECK constraint on `item_status`

`orders.status` carries a `CHECK` in the live database. `ADD COLUMN IF NOT
EXISTS` silently skips a column that already exists, so adding a constraint
that way gives a false sense of protection — it will not apply to a database
where the column already exists. Validation is therefore enforced in one
shared function instead, and the database constraint question is left for a
future migration that can drop and re-add constraints deliberately.

### Backfill of existing rows

New items default to `PENDING`, which would make all 22 existing items read
PENDING and cause the 6 non-cancelled existing orders to roll up incorrectly — a
DELIVERED order would report as PENDING. A one-time backfill sets each existing
item to its parent order's status:

- parent order status is in `ORDER_FLOW` → items take that status
- parent order is `CANCELLED` or `REFUNDED` → items take `PENDING`, because
  those are order-level states that override the roll-up
- consequently the 7 items belonging to the 2 cancelled orders stay `PENDING`,
  and the order's own `CANCELLED` is displayed unchanged

The backfill runs as a plain `UPDATE` in `schema.sql`, guarded by
`WHERE item_status = 'PENDING' AND o.status IN (...)` so it is idempotent and
never overwrites an item that has genuinely been advanced.

## Roll-up logic

One pure function in `shared/constants.js`, beside `ORDER_FLOW`. It has no
React and no database dependency, so every app can import it.

```js
// The order's fulfilment status is the furthest-behind item: if one item is
// packing and another is still cooking, the order reads as the slower one.
// CANCELLED and REFUNDED are order-level states set directly, so they are not
// derived from items and are not accepted here.
export function rollUpOrderStatus(itemStatuses) {
  const reached = ORDER_FLOW.filter((status) =>
    itemStatuses.some((item) => item === status)
  );
  if (reached.length === 0) return ORDER_STATUS.PENDING;
  return reached[0];
}
```

`filter` preserves `ORDER_FLOW` order, so the first hit is the earliest stage
any item is still sitting at.

### Defined behaviour

| Input | Result |
|---|---|
| Empty item list | `PENDING` |
| All items `DELIVERED` | `DELIVERED` |
| Items `PACKED` and `PROCESSING` | `PROCESSING` (the slowest) |
| Any unrecognised value | Ignored; cannot produce a crash or a bad value |
| Items of a `CANCELLED` order | Computed but **not written**; the order keeps its own status |

### Write path

Setting an item's status performs three writes in one transaction:

1. update `order_items.item_status` and `item_status_updated_at`
2. append a row to `order_item_status_history`
3. recompute the roll-up and write `orders.status` **only if it changed**; when
   it changed, also append to `order_status_history` so the existing
   order-level timeline stays truthful

An unchanged roll-up writes no order history, so a 22-item order does not
produce 22 identical history rows.

### Incidental fixes

Two existing defects are resolved as a direct consequence of this design, not
as separate work:

- `Storefront.jsx:1432` defines `STEPS = ["PLACED", ...]`, but `PLACED` has
  never existed in the database. The status stepper therefore highlighted no
  dot for `PENDING` or `CONFIRMED` orders. Deriving the timeline from
  `ORDER_FLOW` removes the divergence.
- `REFUNDED` is in `ORDER_STATUSES` but not in `ORDER_FLOW`, so
  `PATCH /api/store/my/orders/:uuid` rejects it even though the database allows
  it. Because cancellation and refund are now explicitly order-level, that
  endpoint gains an explicit `REFUNDED` path rather than the accidental
  rejection it has today.

## Shared module

Two pieces, because the duplication has two causes: divergent API shapes, and
four hand-written UIs.

### Data module

`frontend/src/lib/orderDetail.js` — pure, performs no fetching.

```js
// The API returns three different shapes for the same order: snake_case from
// /api/orders/:id, camelCase from /api/store/my/orders/:uuid, and a mixed one
// from /api/store/orders/track. Everything downstream works on this shape.
export function normalizeOrder(raw) { ... }
```

It resolves status and payment-status labels, the ordered timeline from
`ORDER_FLOW`, each item's status and label, totals, and the address.

The address needs explicit care. `OrderView.jsx:361` reads
`shipping_address.line1` and `shipping_address.postal`, while checkout writes
`address` and `pincode`, so **the admin shipping block currently renders `—`
for real orders**. `backend/lib/invoice.js:60-66` has the same mismatch. The
normalizer accepts both spellings, which fixes the admin block.

### Component

`frontend/src/components/OrderDetails.jsx` — presentational only. Receives a
normalized order and renders header, items with per-item status, totals,
address, and the timeline.

### Why not `shared/`

`storepub` and `storepanel` each have their own `node_modules` and their own
copy of `react`, so a React component placed in `shared/` risks a
duplicate-React hook error. The component stays in `frontend/src/components/`,
which all three Vite apps already reach through relative imports
(`storepub/src/main.jsx:4` already imports `../../src/pages/Storefront.jsx`).
Only pure logic goes in `shared/`.

### The `@shared` alias

`storepub` and `storepanel` have no `@shared` alias, which is the actual reason
`backend/app/api/orders/store/route.js:28` states that the checkout rule sets
are kept in step "by hand". Both apps already import out-of-root files
successfully, so adding `resolve.alias` to `frontend/storepub/vite.config.js`
and `frontend/storepanel/vite.config.js` is the only missing configuration.

### Which screens change

- **Full `OrderDetails`**: admin `OrderView.jsx`, customer `OrderTrack`.
- **Data module plus per-item status badges in rows**: `StorePanel.jsx` and
  `BranchOrders.jsx`. These are list screens; forcing a detail component into a
  table would be worse than the duplication it removes.

This also retires the nine hardcoded status lists at `BranchOrders.jsx:7`,
`StorePanel.jsx:762`, `Storefront.jsx:1432` and others, replacing them with
the shared constants.

## API surface

### New endpoints

```
PATCH /api/store/my/orders/:uuid/items/:itemId      { status, note? }
PATCH /api/branches/:id/orders/:orderId/items/:itemId { status, note? }
```

Both are gated by `requireBranchAccess(branchUuid)`, the check that is
genuinely enforced today. They validate that `status` is in `ORDER_FLOW`, block
changes once the order is `CANCELLED`, `REFUNDED` or `DELIVERED`, and refuse
backwards transitions, matching the forward-only rule already applied at
`backend/app/api/store/my/orders/[uuid]/route.js:181-183`.

### Existing endpoints

`GET /api/orders/:id`, `GET /api/store/my/orders/:uuid` and
`GET /api/store/orders/track` gain `itemStatus` on each item and an
`itemStatusHistory` array. The track route's `trackable` flag, which today
tests the non-existent `PLACED` value and is therefore permanently `false`, is
replaced with a real check against `ORDER_FLOW`.

A customer who lost their order id cannot use the track lookup at all, so
the track route gains an email-only branch: a request with `email` but no
`order_number` returns every order on that email as a five-column pick-list
(`orderNumber`, `status`, `total`, `paymentStatus`, `createdAt`), newest
first. Picking a row loads the unchanged single-order branch. No login is
involved — checkout works as guest, so the email is the only identifier
every order carries, and the existing lookup already trusts order-number +
email with no password.

### Backward compatibility

`PATCH /api/orders/:id` with a plain `{ status }` continues to work, because
the admin UI depends on it. It sets the status on the order and propagates it
to all items, so the order-level path and the item-level path converge on the
same roll-up rather than diverging.

## Store and admin UI

- `StorePanel.jsx:800-817` currently renders six hardcoded buttons per row.
  These become one control driven by `ORDER_FLOW`, and the detail view gains a
  per-item status control. The forward-only chain staff already use is
  unchanged.
- Admin keeps a single "Move to next" control at order level, which now
  propagates to items, and gains a per-item override for support cases.
- `BranchOrders.jsx` gains per-item status alongside its existing single-step
  button.

## Customer polling

The storefront currently fetches once on submit and never again. It gains a
10-second poll that:

- runs only while the order is in an active `ORDER_FLOW` state
- **stops** on `DELIVERED`, `CANCELLED` or `REFUNDED`
- clears its interval on unmount and on view change, so navigating away does
  not leak a timer

This is the one behaviour that cannot be verified by running code; it requires
a browser with a live order.

## Known gaps, deliberately not fixed here

- **`authorize()` ignores its permission argument.** `backend/lib/authorization.js:167-175`
  returns `authenticate()` regardless, so any logged-in user can update any
  order. The store item path is properly gated via `requireBranchAccess`; the
  admin path inherits this pre-existing gap. Enforcing permissions properly
  means changing the whole application and is out of scope. This spec does not
  make the situation worse, and does not claim to improve it.
- **`order_items.product_id` is never populated** — checkout writes only
  `product_uuid`. Unrelated to this feature, so left alone.
- **`Order.PUBLIC_COLUMNS`** in `backend/lib/models/order.js:6` is declared but
  never referenced. Dead code, left alone.

## Verification

No test framework exists in this repository. Verification follows the existing
`frontend/scripts/verify-geocode.mjs` convention: plain `node:assert/strict`
scripts with a final `ok` marker, plus live command checks.

1. `frontend/scripts/verify-order-status.mjs` — asserts `rollUpOrderStatus`
   across every row of the defined-behaviour table above, including the empty
   list, the all-delivered case, the slowest-item case, and unrecognised
   values; asserts `normalizeOrder` against all three real API response shapes
   and both address spellings.
2. Mutation-check the roll-up tests: reverting `rollUpOrderStatus` to "return
   the first item's status" must fail the suite, proving the tests have teeth.
3. Live `psql` checks: confirm the columns exist, the backfill produced the
   expected distribution, and re-running the backfill changes nothing.
4. Live `curl` checks through the Vite proxy at `localhost:5174`, as used by
   the storefront: advance one item and assert the order status rolls up;
   assert a backwards transition is rejected; assert a cancelled order cannot
   be changed.
5. `npm run lint` and `npm run build` in `backend`, `frontend`,
   `frontend/storepub` and `frontend/storepanel`. Lint warning counts are
   compared against a pre-change baseline so no new warnings are introduced.
6. Manual browser check of the polling loop with a live order.
