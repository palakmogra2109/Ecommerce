# Multi-Branch Inventory Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Ecommerce backend trustworthy — real permission checks, branch scoping, authenticated account recovery, functional 500-routes, sequential order numbers, a single stock-mutation path with ledger rows — without changing any feature the customer sees.

**Architecture:** Standardize a "column-case" discipline (explicit `AS "camelCase"` aliases on every read so `row.branchId` is never `undefined`), make `lib/authorization.js` enforce permissions, add a tiny idempotent SQL migration runner, introduce `lib/inventory.js` as the only writer of `branch_products` stock columns and `branch_inventory_transactions`, and prove every fix with a runnable verification script plus Node's built-in test runner (`node --test`). No test framework is installed and none is added; Phase 5 adds a real one.

**Tech Stack:** Node.js (>=22, has `node:test`), Next.js 16.3.4 App Router route handlers (`export const runtime = "nodejs"`, `const { id } = await params`), raw `pg` (no ORM), PostgreSQL 15 (`ecommerce` DB at `localhost:5432`), `jose` (JWT verify/sign). New modules imported via relative paths so plain `node scripts/*.mjs` works.

**Spec:** `docs/superpowers/specs/2026-09-29-multi-branch-inventory-and-fulfillment-design.md` — Phase 1 is its §4 "Phase 1 — Foundation: data integrity + security" items 1–11; verification matrix is its §5 table (scenarios 1–12).

## Global Constraints

- **Live DB is the source of truth**, not `schema.sql`: column names were created by unquoted camelCase DDL and folded to lowercase (e.g. `addressline1`, `stockquantity`, `createdat`), while the `orders`/`users` tables are snake_case (`created_at`, `order_number`). Never assume a column name; confirm against `information_schema` (Task 2) before writing SQL that references it.
- **Migrations must be additive and idempotent.** Real data exists (11 orders, 4 branches, 24 users, 70 permissions, 7 roles, 250 countries/5308 states/152646 cities). No destructive DDL. No deleting rows.
- **No new npm dependencies.** `pg`, `jose`, `bcryptjs` already exist. Node's built-in `node:test` + `assert` for tests. If the plan "needs" a dependency, it is mis-designed.
- **`products.stock` is the admin central pool.** Branch-level stock lives in `branch_products.stockquantity`. Never conflate the two.
- **Keep all three panels and ports** (admin 5173, store 5175, customer 5174). Customer site is the legacy `Storefront.jsx`; do not touch `quickkart-server/` (dead, left on disk).
- **`lib/inventory.js` is the ONLY code permitted to write** `branch_products` stock/reserved columns and `branch_inventory_transactions` rows. Routes and models call it. (Spec §3.1.)
- **Command layout:** work in `/var/www/html/Node-JS/Ecommerce/backend`. Server runs with `npm run dev` on port 3000. Scripts run with `DATABASE_URL` loaded from `backend/.env.local` by `scripts/lib/env.mjs`.
- Files whose consumers read lowercase keys: after alias changes, grep the frontends for `.addressline1`/`.stockquantity`/`.branchid`/`.sellingprice`/`.createdat` and update those reads — do not leave a silent `undefined`.
- Next.js 16 breaking changes: read the relevant guide in `node_modules/next/dist/docs/` before writing route code. Route params must be awaited: `const { id } = await params;`.

## Review Focus

Inputs/failure modes more likely than tests to bite a real user; each is pinned by a test in the owning task:

1. **Column names differ from what the plan's SQL assumes.** The plan aliases `stockQuantity`, but a table's real column might be `stockquantity` — wrong names silently return `undefined` or 500. → Task 2 inventories every relevant table first; every alias task's first step re-checks against that inventory.
2. **A user who was working stops working once `authorize()` is enforced.** The seed grants `branches.*` only to `super_admin`/`admin`/manager-subset; a `store` user calling an admin branch route would suddenly get 403. → Task 6 seeds grants and Task 7 scopes so the verify script's scenarios 2–4 pass (super_admin 200, own branch 200, other branch 403).
3. **Customer flows break when the backend demands auth.** The address book posts `?email=` and the "view my orders" list calls track without an order number. → Tasks 9 & 12 update the legacy Storefront to send its stored JWT and a graceful 401 fallback so checkout still works for guests.
4. **Concurrent checkouts race on order numbers and last-unit.** → Task 11 moves numbers to a sequence and keeps the guarded decrement; verify scenario 9 (two concurrent checkouts, exactly one wins, no duplicate number).
5. **Partial updates zero out fields callers didn't send.** `PATCH store/my/products/[uuid]` and `variant-pricing` currently rewrite every column. → Task 10 asserts only sent fields change.

---

## Task 1: Verification harness + idempotent migration runner

Foundation for every later task's test cycle. Two runnable tools: a unit runner (pure functions, `node --test`) and an integration verifier (live DB + a running dev server).

**Files:**
- Create: `backend/scripts/lib/env.mjs`
- Create: `backend/scripts/lib/http.mjs`
- Create: `backend/scripts/verify-phase1.mjs`
- Create: `backend/scripts/migrate.mjs`
- Modify: `backend/package.json` (add scripts)

**Interfaces:**
- Produces:
  - `loadEnv()` (from `scripts/lib/env.mjs`) → sets `process.env` from `backend/.env.local` unless already set; returns `void`.
  - `jsonPost(url, body, token)` and `apiGet(url, token)` (from `scripts/lib/http.mjs`) → `{ status, data }` wrappers over `fetch`.
  - `verifyPhase1({ name, run })` and `report()` (from `scripts/verify-phase1.mjs`) → named scenario registry; a scenario throws on failure, `report()` prints pass/fail and exits non-zero on any failure. `storeToken()` / `cleanupStoreAccount()` (from the same file, defined in Task 6) → a throwaway store user for the auth scenarios.
  - `scripts/migrate.mjs` → runs every `.sql` in `backend/sql/migrations/` in filename order (each idempotent), skipping already-applied ones via `schema_migrations` table.

- [ ] **Step 1: Write the env loader**

```js
// backend/scripts/lib/env.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const ENV_FILE = path.join(ROOT, ".env.local");

export async function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const text = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!(key in process.env)) process.env[key] = value.trim();
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not found in .env.local");
  }
}
```

- [ ] **Step 2: Write the verify harness skeleton**

```js
// backend/scripts/verify-phase1.mjs
import { loadEnv } from "./lib/env.mjs";

await loadEnv();

const scenarios = [];
export function verifyPhase1({ name, run }) { scenarios.push({ name, run }); }
export async function report() {
  let failed = 0;
  for (const { name, run } of scenarios) {
    try { await run(); console.log(`PASS  ${name}`); }
    catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\n${scenarios.length - failed}/${scenarios.length} passed`);
  process.exit(failed ? 1 : 0);
}
```

- [ ] **Step 3: Write the HTTP helpers**

```js
// backend/scripts/lib/http.mjs
export async function jsonPost(url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
export async function apiGet(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(url, { headers });
  return { status: r.status, data: await r.json() };
}
```

- [ ] **Step 4: Write the migration runner**

```js
// backend/scripts/migrate.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv } from "./lib/env.mjs";

await loadEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const MIGRATIONS_DIR = path.join(process.cwd(), "sql", "migrations");

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);

const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
  if (rows.length) { console.log(`skip  ${file}`); continue; }
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`apply ${file}`);
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
await pool.end();
```

- [ ] **Step 5: Add npm scripts to `backend/package.json`**

```jsonc
// scripts:
"test": "node --test lib/__tests__",
"migrate": "node scripts/migrate.mjs",
"verify:phase1": "node scripts/verify-phase1.mjs"
```

- [ ] **Step 6: Run the tools to prove they work**

Run: `cd backend && node scripts/verify-phase1.mjs && npm run migrate`
Expected: verifier prints `0/0 passed`, exits 1 (no scenarios yet — this is a known-fail state, acceptable only for this bootstrap task). Migration runner prints `apply` lines (once) and `skip` on re-run.

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/lib/env.mjs backend/scripts/lib/http.mjs backend/scripts/verify-phase1.mjs backend/scripts/migrate.mjs backend/package.json
git commit -m "test: add verification harness and migration runner (Phase 1)"
```

---

## Task 2: Live column inventory

Capture the true schema before touching any model SQL. This becomes the reference for every alias task.

**Files:**
- Create: `backend/scripts/lib/columns.mjs`
- Create: `backend/scripts/tests/column-inventory.test.mjs` (extension-style: run as part of verify-phase1)

**Interfaces:**
- Produces: `listColumns(pool, table)` → `[{ name, dataType }]` for one table; `assertColumn(pool, table, name)` → throws listing actual columns if `name` missing.

- [ ] **Step 1: Write the column helper (test-first)**

```js
// backend/scripts/lib/columns.mjs
export async function listColumns(pool, table) {
  const { rows } = await pool.query(
    `SELECT column_name AS name, data_type AS "dataType"
       FROM information_schema.columns WHERE table_name = $1
      ORDER BY ordinal_position`, [table]);
  return rows;
}
export async function assertColumn(pool, table, name) {
  const cols = await listColumns(pool, table);
  if (!cols.some((c) => c.name === name)) {
    throw new Error(`missing column ${table}.${name}; have: ${cols.map(c => c.name).join(", ")}`);
  }
}
```

- [ ] **Step 2: Register the inventory as verify scenario #1**

Add to `scripts/verify-phase1.mjs` (import pool, listColumns):

```js
import { loadEnv } from "./lib/env.mjs";
await loadEnv();
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
import { listColumns } from "./lib/columns.mjs";

const INVENTORY_TABLES = ["branches", "branch_products", "branch_stock_transfers",
  "branch_transfer_items", "branch_inventory_transactions", "orders", "users"];
for (const t of INVENTORY_TABLES) {
  verifyPhase1({ name: `column inventory: ${t} reachable`, run: async () => { await listColumns(pool, t); } });
}
```

- [ ] **Step 3: Print the real columns and record them in the plan's implementation notes**

Run: `cd backend && node scripts/verify-phase1.mjs 2>&1 | head; node -e "...print the table..."` — then capture the output of this one-liner into a `backend/sql/inventory.md` note file so every later task reads the same ground truth:

```bash
cd backend && node --input-type=module -e "
import { loadEnv } from './scripts/lib/env.mjs'; await loadEnv();
import pg from 'pg'; const p = new pg.Pool({connectionString:process.env.DATABASE_URL});
import { listColumns } from './scripts/lib/columns.mjs';
for (const t of ['branches','branch_products','branch_stock_transfers','branch_transfer_items','branch_inventory_transactions','orders','users'])
  console.log(t, (await listColumns(p,t)).map(c=>c.name).join(', '));
await p.end();" | tee backend/sql/inventory.md
```

- [ ] **Step 4: Verify the expected invariants exist**

In `verify-phase1.mjs`, add assertions that pin the disciplines later tasks depend on:

```js
verifyPhase1({ name: "guarded decrement column exists", run: async () => {
  await assertColumn(pool, "branch_products", "reservedquantity");
  await assertColumn(pool, "branch_products", "stockquantity");
}});
```

Run: `cd backend && node scripts/verify-phase1.mjs` → zero FAIL for inventory scenarios.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/lib/columns.mjs backend/scripts/verify-phase1.mjs backend/sql/inventory.md
git commit -m "test: capture live column inventory (Phase 1)"
```

---

## Task 3: Column-case aliases in branch models

Fix `branch.js`, `branchProduct.js`, `branchStockTransfer.js` so every row the API returns has camelCase keys.

**Files:**
- Modify: `backend/lib/models/branch.js`
- Modify: `backend/lib/models/branchProduct.js`
- Modify: `backend/lib/models/branchStockTransfer.js`
- Modify: `backend/lib/models/branchInventoryTransaction.js` (verify only; already aliased — confirm unchanged)

**Interfaces:**
- Consumes: column names from `backend/sql/inventory.md`.
- Produces: identical shapes, but `row.branchId`, `row.stockQuantity`, `row.sellingPrice`, `row.transferNumber`, `row.createdAt`, `row.updatedAt`, `row.addressLine1` … are defined (not `undefined`).

- [ ] **Step 1: Write failing integration scenarios first**

Add to `verify-phase1.mjs`:

```js
import { Branch } from "../lib/models/branch.js";
import { BranchProduct } from "../lib/models/branchProduct.js";
import { BranchStockTransfer } from "../lib/models/branchStockTransfer.js";

verifyPhase1({ name: "branch model rows are camelCase", run: async () => {
  const res = await pool.query("SELECT uuid FROM branches LIMIT 1");
  if (!res.rows[0]) throw new Error("no branches in DB");
  const b = await Branch.findByUuid(res.rows[0].uuid);
  for (const key of ["uuid", "name", "addressLine1", "deliveryRadius", "createdAt", "updatedAt"])
    if (b[key] === undefined) throw new Error(`branch.${key} is undefined; got keys: ${Object.keys(b)}`);
}});
verifyPhase1({ name: "branchProduct rows are camelCase", run: async () => {
  const res = await pool.query("SELECT branchid, productid FROM branch_products LIMIT 1");
  if (!res.rows[0]) throw new Error("no branch_products in DB");
  const bpRes = await pool.query("SELECT uuid FROM branch_products LIMIT 1");
  const bp = await BranchProduct.getByBranchAndProductUuid(res.rows[0].branchid, (await pool.query("SELECT productuuid FROM branch_products LIMIT 1")).rows[0].productuuid);
  for (const key of ["uuid", "productId", "branchId", "sellingPrice", "stockQuantity"])
    if (bp[key] === undefined) throw new Error(`branchProduct.${key} is undefined`);
}});
```

Run: `cd backend && node scripts/verify-phase1.mjs` → both FAIL (undefined keys / SQL error).

- [ ] **Step 2: Fix `branch.js` column constants + `update()` timestamp**

```js
// backend/lib/models/branch.js
const PUBLIC_COLUMNS =
  "id AS \"id\", uuid AS \"uuid\", name AS \"name\", code AS \"code\", phone AS \"phone\", " +
  "email AS \"email\", address AS \"address\", addressline1 AS \"addressLine1\", " +
  "addressline2 AS \"addressLine2\", city AS \"city\", state AS \"state\", " +
  "country AS \"country\", postalcode AS \"postalCode\", latitude AS \"latitude\", " +
  "longitude AS \"longitude\", openingtime AS \"openingTime\", closingtime AS \"closingTime\", " +
  "timezone AS \"timezone\", status AS \"status\", deliveryenabled AS \"deliveryEnabled\", " +
  "pickupenabled AS \"pickupEnabled\", deliveryradius AS \"deliveryRadius\", " +
  "createdat AS \"createdAt\", updatedat AS \"updatedAt\"";

const INTERNAL_COLUMNS = PUBLIC_COLUMNS; // no private columns today
```

In `update()` (line ~175) change `updated_at = now()` → `updatedat = now()` (branch columns follow camelCase-fold, per `inventory.md`). In `getWithStats()` the bare `branchId =`/`stockQuantity <=`/`isAvailable` refs are fine (they fold), but the subquery `(SELECT id FROM branches WHERE uuid = $1)` is duplicated — leave it; it works.

- [ ] **Step 3: Fix `branchProduct.js`**

```js
import pool from "../db";
import { paginate } from "../pagination";          // MISSING IMPORT FIX

const BP_COLUMNS =
  "bp.id AS \"id\", bp.uuid AS \"uuid\", bp.branchid AS \"branchId\", bp.productid AS \"productId\", " +
  "bp.productuuid AS \"productUuid\", bp.variantid AS \"variantId\", bp.sellingprice AS \"sellingPrice\", " +
  "bp.compareatprice AS \"compareAtPrice\", bp.costprice AS \"costPrice\", bp.stockquantity AS \"stockQuantity\", " +
  "bp.reservedquantity AS \"reservedQuantity\", bp.lowstockthreshold AS \"lowStockThreshold\", " +
  "bp.isavailable AS \"isAvailable\", bp.status AS \"status\", bp.createdat AS \"createdAt\", bp.updatedat AS \"updatedAt\"";
```

- `getByBranchProduct(branchId, productId)` → `SELECT ${BP_COLUMNS} FROM ${TABLE} bp WHERE bp.branchid = $1 AND bp.productid = $2`.
- `getByBranchAndProductUuid(branchId, productUuid)` → same pattern with `bp.productuuid = $2`.
- `getByBranch(branchId, ...)` → replace `SELECT bp.*` with `SELECT ${BP_COLUMNS}, p.name AS "productName", p.slug AS "productSlug", p.images AS "productImages", p.price AS "globalPrice", p.discount_price AS "globalDiscountPrice", p.inventory_mode AS "globalInventoryMode"`. The condition `bp.branchid = $1` now receives an **integer** branch id (Task 8 wires the route to pass `access.branchId`, fixing the uuid/bigint mismatch).
- `create()` / `update()` / `updateStock()` → `RETURNING ${BP_COLUMNS}` with the `FROM ${TABLE} bp` trick: `RETURNING` cannot alias, so instead do a follow-up select or wrap: change `UPDATE ... RETURNING ${BP_COLUMNS}` is invalid — alias in RETURNING is not allowed. Use the pattern `UPDATE ${TABLE} SET ... WHERE uuid = $n` then `SELECT ${BP_COLUMNS} FROM ${TABLE} bp WHERE bp.uuid = $1` for the affected `create` (ON CONFLICT) and `update`/`updateStock` rows.

- [ ] **Step 4: Fix `branchStockTransfer.js`**

Alias every `SELECT *`:

```js
const TRANSFER_COLUMNS =
  "id AS \"id\", uuid AS \"uuid\", transfernumber AS \"transferNumber\", " +
  "sourcebranchid AS \"sourceBranchId\", destinationbranchid AS \"destinationBranchId\", " +
  "status AS \"status\", requestbyid AS \"requestById\", approvedbyid AS \"approvedById\", " +
  "receivedbyid AS \"receivedById\", reason AS \"reason\", note AS \"note\", " +
  "createdat AS \"createdAt\", updatedat AS \"updatedAt\", completedat AS \"completedAt\"";
```

Apply to `findByUuid`, `getById`, `list` (`SELECT ${TRANSFER_COLUMNS} FROM ${TABLE}` with `ORDER BY createdat DESC`), and `updateStatus`/`getItems`/`getByProduct` in kind. Also fix **updateStatus**'s bind bug: it builds `$2/$3/$4` placeholders conditioned on optional args but always passes 4 params — rewrite as:

```js
async updateStatus(uuid, status, approvedById = null, receivedById = null) {
  const fields = ["status = $1"];
  const values = [status];
  if (approvedById != null) { values.push(approvedById); fields.push(`approvedbyid = $${values.length}`); }
  if (receivedById != null) { values.push(receivedById); fields.push(`receivedbyid = $${values.length}`); }
  values.push(uuid);
  const result = await pool.query(
    `UPDATE ${TABLE} SET ${fields.join(", ")}, updatedat = now() WHERE uuid = $${values.length} RETURNING ${TRANSFER_COLUMNS}`,
    values);
  return result.rows[0] || null;
}
```

- [ ] **Step 5: Re-run verify; fix any real-column mismatch**

Run: `cd backend && node scripts/verify-phase1.mjs`
Expected: the two Task-3 scenarios PASS. If a column name is wrong, correct it against `backend/sql/inventory.md` (do not "fix" the test constructor).

- [ ] **Step 6: Grep the frontends for lowercase-key reads and patch them**

Run: `cd frontend && grep -rn "\.addressline1\|\.stockquantity\|\.sellingprice\|\.branchid\|\.createdat\|\.updatedat\|\.transfernumber" src storepanel storepub --include=*.jsx --include=*.js | grep -v node_modules`
Patch each occurrence to the camelCase key. Commit only when grep is clean for the branch-family keys.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/models/branch.js backend/lib/models/branchProduct.js backend/lib/models/branchStockTransfer.js frontend/src/...
git commit -m "fix: column-case aliases across branch models (Phase 1)"
```

---

## Task 4: 500-route repairs

Make every route under `backend/app/api/branches/**` and the customer/store routes return data instead of `ReferenceError`/type errors.

**Files:**
- Modify: `backend/app/api/branches/nearby/route.js` (HAVING-without-GROUP-BY)
- Modify: `backend/app/api/branches/[id]/products/route.js` (pass integer `branchId`, drop fake `status` filter)
- Modify: `backend/app/api/branches/[id]/orders/route.js` (PATCH updates by the branch uuid, must update by **order** identity)
- Modify: `backend/app/api/store/products/route.js` (dedupe `LEFT JOIN`, pincode+lat/lng crash)
- Modify: `backend/app/api/branches/[id]/route.js` (verify `getWithStats`; fix if broken)
- Modify: `backend/app/api/products/[id]/variant-pricing/route.js` (merge, don't wipe — move to Task 10's non-zeroing rules, only fix the 500/crash here if present)

**Interfaces:**
- Consumes: Task 3 aliases, `access.branchId` (integer) from `requireBranchAccess` (Task 8 — leaf dependencies are wired in Task 8; here routes keep their existing auth call but stop crashing).

- [ ] **Step 1: Fix `nearby` grouping**

`backend/app/api/branches/nearby/route.js` (line 50) applies `HAVING (...)` without a `GROUP BY` — Postgres rejects `HAVING` over ungrouped rows. Move the radius filter into a `WHERE` over a derived table so the bind params stay `[lat, lng, maxLat, maxLng, radius, limit]`:

```js
const result = await pool.query(
  `
  SELECT * FROM (
    SELECT b.*,
      (
        6371 * acos(
          least(greatest(
            cos(radians($1)) * cos(radians(b.latitude)) * cos(radians(b.longitude) - radians($2)) +
            sin(radians($1)) * sin(radians(b.latitude)),
          -1), 1)
        )
      ) AS distance_km
    FROM branches b
    WHERE b.status = 'ACTIVE'
      AND b.latitude IS NOT NULL
      AND b.longitude IS NOT NULL
      AND b.latitude BETWEEN $1 - $3 AND $1 + $3
      AND b.longitude BETWEEN $2 - $4 AND $2 + $4
      AND b.deliveryenabled = TRUE
  ) d
  WHERE d.distance_km <= $5
  ORDER BY d.distance_km ASC
  LIMIT $6
  `,
  [lat, lng, maxLat, maxLng, radius, limit]
);
```

The mapping below (`{ ...b, distance_km: parseFloat(b.distance_km) }`) is unchanged. `b.*` keeps returning lowercase keys — do not alias in this task (Task 3's grep already covered the branch-key consumers).

- [ ] **Step 2: Add an HTTP smoke check to the verifier**

```js
import { devServer } from "./lib/http.mjs"; // fetch("http://localhost:3000") helper using FRONTEND_URL fallback
verifyPhase1({ name: "nearby returns 200", run: async () => {
  const r = await fetch(`http://localhost:3000/api/branches/nearby?lat=19.0760&lng=72.8777&radius=50`);
  if (r.status !== 200) throw new Error("nearby status " + r.status + " -> " + await r.text());
}});
```

Run (dev server up): `cd backend && node scripts/verify-phase1.mjs` → PASS.

- [ ] **Step 3: Fix `[id]/products` to stop passing a uuid as a bigint**

The route currently calls `BranchProduct.getByBranch(id, { ... })` where `id` is the branch **uuid**. `getByBranch` filters `bp.branchid = $1`. Change the route to resolve the branch first:

```js
const branch = await Branch.findByUuid(id);
if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });
const result = await BranchProduct.getByBranch(branch.id, { search, page, limit });
```

- [ ] **Step 4: Fix `[id]/orders` PATCH**

It calls `Order.update(id, ...)` with the **branch** uuid, so it can never update an order. Update by `order_number` (or a dedicated order-uuid param), then verify it belongs to the branch:

```js
const result = await Order.updateByNumber(id, { status: newStatus, branchId: /* resolved branch id */ });
```

Add `Order.updateByNumber(orderNumber, { status, branchId })` to `backend/lib/models/order.js` — `UPDATE orders SET status = $1, updatedat = now() WHERE order_number = $2 AND branchid = $3 RETURNING <columns>`.

- [ ] **Step 5: Verify `[id]/route.js` `getWithStats` and fix**

Run the HTTP check `GET /api/branches/<uuid>` after a branch exists; if it 500s on a missing import/column, patch it. (`Branch` is already imported; `getWithStats` was verified working in Task 3's model reads.)

- [ ] **Step 6: Fix `store/products` dedupe + coordinate crash**

`backend/app/api/store/products/route.js`: the unconstrained `LEFT JOIN branch_products` duplicates rows. Filter inside the join: `LEFT JOIN branch_products bp ON bp.productid = p.id AND bp.isavailable = TRUE AND bp.status = 'ACTIVE'` then `WHERE bp.id IS NOT NULL` (or `GROUP BY p.id`). When `pincode` AND `lat`/`lng` both arrive, the branch-radius code currently 500s — wrap the coordinate resolution in try/catch and default to no-location catalog.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/branches/nearby/route.js backend/app/api/branches/[id]/products/route.js backend/app/api/branches/[id]/orders/route.js backend/lib/models/order.js backend/app/api/store/products/route.js backend/scripts/verify-phase1.mjs backend/app/api/branches/[id]/route.js
git commit -m "fix: repair five 500-capable routes (Phase 1)"
```

---

## Task 5: `schema.sql` reconciliation

Make `schema.sql` reproduce the live schema so a fresh DB matches production.

**Files:**
- Modify: `backend/sql/schema.sql`

- [ ] **Step 1: Write the divergent-tables check (test-first)**

Add to `verify-phase1.mjs`:

```js
import fs from "node:fs";
verifyPhase1({ name: "schema.sql covers live tables", run: async () => {
  const schema = fs.readFileSync("sql/schema.sql", "utf8");
  for (const t of ["countries", "states", "cities"]) {
    if (!schema.includes(`CREATE TABLE ${t}`)) throw new Error(`schema.sql missing ${t}`);
  }
}});
```

Run → FAIL (schema.sql lacks these tables).

- [ ] **Step 2: Regenerate the affected sections**

For each table in `inventory.md`, update its `CREATE TABLE` block in `schema.sql` so column names/order match the live DB, and append `CREATE TABLE` blocks for `countries (id, name, iso_code, phone_code, status)`, `states (id, country_id, name, state_code, status)`, `cities (id, state_id, name, latitude, longitude, status)` in the column spelling the live DB uses. Copy the 250/5308/152646-row data-preservation rule: do NOT change data in the live DB.

- [ ] **Step 3: Verify idempotence**

Run: `cd backend && node scripts/verify-phase1.mjs` → the new scenario PASSes.

- [ ] **Step 4: Commit**

```bash
git add backend/sql/schema.sql backend/scripts/verify-phase1.mjs
git commit -m "docs(schema): reconcile schema.sql with live DB (Phase 1)"
```

---

## Task 6: Real `authorize()` + permission seeds + constants alignment

**Files:**
- Modify: `backend/lib/authorization.js`
- Modify: `../shared/constants.js` (KEY_PERMISSIONS `STORE_*` slugs → underscores)
- Create: `backend/sql/migrations/001-phase1-permissions.sql`
- Modify: `backend/sql/seed.sql` (same grants for fresh installs)

**Interfaces:**
- Produces:
  - `authorize(permissionSlug)` → real check: authenticate; **super_admin passes everything**; otherwise require the slug in `getUserAccess(userId).permissions`. Returns `{ ok:false, response }` (403) otherwise.
  - `authorizeAny(slugs[])`, `requireBranchAccessOrSuperAdmin(branchUuid)` (helper used by Task 7).
  - Permission slugs: `branches.view|create|update|delete`, `branches.inventory.view|update`, `branches.orders.view|update`, `branches.price.view|update`, `dashboard.view`, and corrected `store_dashboard.view`, `store_products.view|update`, `store_orders.view|update`.

- [ ] **Step 1: Write failing unit tests for the policy (test-first)**

```js
// backend/lib/__tests__/permission-policy.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { hasPermission } from "../permissionPolicy.js";
test("super_admin passes any permission", () => {
  assert.equal(hasPermission({ roles: ["super_admin"], permissions: [] }, "branches.delete"), true);
});
test("non-super needs the slug", () => {
  assert.equal(hasPermission({ roles: ["store"], permissions: ["store_orders.view"] }, "branches.view"), false);
  assert.equal(hasPermission({ roles: ["store"], permissions: ["store_orders.view"] }, "store_orders.view"), true);
});
```

```js
// backend/lib/permissionPolicy.js
export function hasPermission(access, slug) {
  if (access.roles.includes("super_admin")) return true;
  return access.permissions.includes(slug);
}
```

- [ ] **Step 2: Rewrite `authorize`/`authorizeAny` and add branch helper**

```js
// backend/lib/authorization.js — replace lines 164-175
export async function authorize(permissionSlug) {
  const auth = await authenticate();
  if (!auth.ok) return auth;
  if (permissionSlug) {
    const access = await getUserAccess(auth.user.id);
    if (!hasPermission(access, permissionSlug)) {
      return { ok: false, response: Response.json(
        { success: false, message: "You do not have permission to perform this action" },
        { status: 403, headers: corsHeaders() }) };
    }
  }
  return auth;
}
export async function authorizeAny(permissionSlugs = []) {
  const auth = await authenticate();
  if (!auth.ok) return auth;
  const access = await getUserAccess(auth.user.id);
  if (!hasPermission(access, "__any__") && !permissionSlugs.some((s) => hasPermission(access, s))) {
    return { ok: false, response: Response.json(
      { success: false, message: "You do not have permission to perform this action" },
      { status: 403, headers: corsHeaders() }) };
  }
  return auth;
}
export async function requireBranchAccessOrSuperAdmin(branchUuid) {
  const auth = await authenticate();
  if (!auth.ok) return auth;
  const roles = await getUserRoleSlugs(auth.user.id);
  if (roles.includes("super_admin")) {
    const branch = await pool.query(
      "SELECT id FROM branches WHERE uuid = $1 AND status = 'ACTIVE'", [branchUuid]);
    if (branch.rows.length === 0) return { ok: false, response: branchNotFound() };
    return { ok: true, user: auth.user, branchId: branch.rows[0].id, branch: branch.rows[0] };
  }
  return requireBranchAccess(branchUuid);
}
```

- [ ] **Step 3: Write the permission migration (idempotent)**

```sql
-- backend/sql/migrations/001-phase1-permissions.sql
INSERT INTO modules (name, slug) VALUES ('Branches', 'branches')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO permissions (name, slug, module, description) VALUES
  ('View Branches', 'branches.view', 'branches', 'View the branch directory and branch details'),
  ('Create Branches', 'branches.create', 'branches', 'Create new branches'),
  ('Update Branches', 'branches.update', 'branches', 'Edit branch details and settings'),
  ('Delete Branches', 'branches.delete', 'branches', 'Delete branches'),
  ('View Branch Inventory', 'branches.inventory.view', 'branches', 'View branch inventory levels'),
  ('Update Branch Inventory', 'branches.inventory.update', 'branches', 'Adjust branch inventory and pricing'),
  ('View Branch Orders', 'branches.orders.view', 'branches', 'View orders placed at a branch'),
  ('Update Branch Orders', 'branches.orders.update', 'branches', 'Move branch orders through statuses'),
  ('View Branch Pricing', 'branches.price.view', 'branches', 'View branch product pricing'),
  ('Update Branch Pricing', 'branches.price.update', 'branches', 'Edit branch product pricing'),
  ('View Dashboard', 'dashboard.view', 'dashboard', 'View the admin dashboard')
ON CONFLICT (slug) DO NOTHING;

-- super_admin + admin already receive every permission row via seed; re-grant defensively:
INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
CROSS JOIN permissions p
WHERE r.slug IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- manager subset + dashboard
INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.slug IN ('branches.view', 'branches.orders.view', 'dashboard.view')
WHERE r.slug = 'manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO module_has_roles (module_id, role_id)
SELECT m.id, r.id FROM modules m
JOIN roles r ON r.slug IN ('super_admin', 'admin', 'manager')
WHERE m.slug = 'branches'
ON CONFLICT (module_id, role_id) DO NOTHING;
```

Mirror the same INSERTs into `backend/sql/seed.sql`'s permission block so fresh installs converge.

- [ ] **Step 4: Align `STORE_*` constant slugs**

In `../shared/constants.js` change values to underscore form and add the new explicit slugs:

```js
STORE_DASHBOARD_VIEW: "store_dashboard.view",
STORE_PRODUCTS_VIEW: "store_products.view",
STORE_PRODUCTS_UPDATE: "store_products.update",
STORE_ORDERS_VIEW: "store_orders.view",
STORE_ORDERS_UPDATE: "store_orders.update",
BRANCHES_VIEW: "branches.view", BRANCHES_CREATE: "branches.create",
BRANCHES_UPDATE: "branches.update", BRANCHES_DELETE: "branches.delete",
BRANCH_INVENTORY_VIEW: "branches.inventory.view", BRANCH_INVENTORY_UPDATE: "branches.inventory.update",
BRANCH_ORDERS_VIEW: "branches.orders.view", BRANCH_ORDERS_UPDATE: "branches.orders.update",
BRANCH_PRICE_VIEW: "branches.price.view", BRANCH_PRICE_UPDATE: "branches.price.update",
DASHBOARD_VIEW: "dashboard.view",
```

- [ ] **Step 5: Run migration + unit tests**

Run: `cd backend && npm run migrate && npm test`
Expected: migrate applies `001-phase1-permissions.sql`; `npm test` passes both policy tests.

- [ ] **Step 6: Add HTTP permission scenarios**

First add the throwaway-account helpers to `scripts/verify-phase1.mjs` (the seed creates no store user, so the auth scenarios must create their own):

```js
import { jsonPost, apiGet } from "./lib/http.mjs";

let TEST_STORE = null;
export async function storeToken() {
  if (TEST_STORE) return TEST_STORE.token;
  const email = `verify-p1-${Date.now()}@earth.local`;
  const reg = await jsonPost("http://localhost:3000/api/auth/store/register", {
    name: "Phase1 Verify Store", email, password: "VerifyPass123!",
    branchName: `Verify ${Date.now()}`, branchCode: `V${Date.now().toString().slice(-4)}`,
    city: "Mumbai", address: "1 Test Lane", phone: "9876543210",
  });
  if (reg.status !== 201) throw new Error("store register: " + reg.status + " " + JSON.stringify(reg.data));
  TEST_STORE = { token: reg.data.token, userUuid: reg.data.user.uuid, branchUuid: reg.data.branch.uuid, email };
  return TEST_STORE.token;
}
export async function cleanupStoreAccount() {
  if (!TEST_STORE) return;
  const { userUuid, branchUuid, email } = TEST_STORE;
  await pool.query("DELETE FROM user_has_roles WHERE user_id = (SELECT id FROM users WHERE email = $1)", [email]);
  await pool.query("DELETE FROM branch_users WHERE userid = (SELECT id FROM users WHERE email = $1)", [email]);
  await pool.query("DELETE FROM users WHERE uuid = $1", [userUuid]);
  await pool.query("DELETE FROM branches WHERE uuid = $1", [branchUuid]);
  TEST_STORE = null;
}
```

Then the scenario:

```js
verifyPhase1({ name: "store user gets 403 on admin branch route", run: async () => {
  const t = await storeToken();
  const me = await apiGet("http://localhost:3000/api/auth/me", t);
  if (!me.data.user?.branches?.length) throw new Error("store user has no branches");
  const mine = me.data.user.branches.map((b) => b.uuid);
  const otherRes = await pool.query(
    "SELECT uuid FROM branches WHERE uuid <> ALL($1::uuid[]) AND status = 'ACTIVE' LIMIT 1", [mine]);
  if (!otherRes.rows[0]) throw new Error("need one branch not owned by the test store");
  const r = await apiGet(`http://localhost:3000/api/branches/${otherRes.rows[0].uuid}/products`, t);
  if (r.status !== 403) throw new Error("expected 403 got " + r.status);
}});
```

`cleanupStoreAccount()` is invoked at the end of scenario 12 (Task 14) so the `24 users / 4 branches` count stays intact.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/authorization.js backend/lib/permissionPolicy.js backend/lib/__tests__ shared/constants.js backend/sql/migrations/001-phase1-permissions.sql backend/sql/seed.sql backend/scripts/verify-phase1.mjs
git commit -m "security: enforce permissions, seed branches grants, align slugs (Phase 1)"
```

---

## Task 7: Branch scoping on `/api/branches/[id]/**`

Every branch-scoped route either accepts a member `store`/`branch_manager` user of that branch or a super-admin. A branch user must not read another branch by changing the uuid.

**Files:**
- Modify: the 9 route files under `backend/app/api/branches/[id]/` — `route.js`, `dashboard/route.js`, `inventory/route.js`, `orders/route.js`, `products/route.js`, `transfers/route.js`, `transfers/[transferId]/route.js`, `users/route.js`, `users/[userUuid]/route.js`
- Test: `backend/scripts/verify-phase1.mjs` (HTTP scenarios 3, 4)

**Interfaces:**
- Consumes: `requireBranchAccessOrSuperAdmin` from Task 6.
- Produces: each branch route returns `{ ok:false }` (403) for a non-member.

- [ ] **Step 1: Write failing HTTP scenarios (3,4)**

```js
verifyPhase1({ name: "branch user reads own branch 200", run: async () => {
  const t = await storeToken(); // login as a store user (Task 6 helper)
  const me = (await (await fetch("http://localhost:3000/api/auth/me", { headers: { Authorization: `Bearer ${t}` } })).json()).user;
  const own = me.branches[0].uuid;
  const r = await fetch(`http://localhost:3000/api/branches/${own}/products`, { headers: { Authorization: `Bearer ${t}` } });
  if (r.status !== 200) throw new Error("own branch: " + r.status);
}});
verifyPhase1({ name: "branch user gets 403 on another branch", run: async () => {
  const idList = (await pool.query("SELECT uuid FROM branches ORDER BY uuid")).rows;
  const t = await storeToken();
  const me = (await (await fetch("http://localhost:3000/api/auth/me", { headers: { Authorization: `Bearer ${t}` } })).json()).user;
  const mine = new Set(me.branches.map((b) => b.uuid));
  const other = idList.find((b) => !mine.has(b.uuid));
  const r = await fetch(`http://localhost:3000/api/branches/${other.uuid}/products`, { headers: { Authorization: `Bearer ${t}` } });
  if (r.status !== 403) throw new Error("other branch: " + r.status);
}});
```

Run → both FAIL (no scoping yet; the store user even reaches the route).

- [ ] **Step 2: Add the guard to every handler**

For each route's handler, right after the existing `authorize(...)` call, add:

```js
const branchGuard = await requireBranchAccessOrSuperAdmin(id);
if (!branchGuard.ok) return branchGuard.response;
```

The two blog posts: for `/users/[userUuid]` the branch context is `id`; for `/transfers/[transferId]` the transfer itself is scoped by `sourceBranchId`/`destinationBranchId` later (Phase 2) — for Phase 1 the branch guard on `id` plus `authorize` is enough, because `POST /transfers` already passes `sourceBranchId: id`.

Where a handler currently passes the branch **uuid** into a model that needs the integer `branchId`, replace it with `branchGuard.branchId` (e.g. `[id]/products`, `[id]/inventory`, `[id]/orders` list filter).

- [ ] **Step 3: Re-run verify**

Run: `cd backend && node scripts/verify-phase1.mjs` → scenarios 3, 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/branches backend/scripts/verify-phase1.mjs
git commit -m "security: branch-scope all /api/branches/[id] routes (Phase 1)"
```

---

## Task 8: `store/addresses` authentication + Storefront wiring

**Files:**
- Modify: `backend/app/api/store/addresses/route.js`
- Modify: `frontend/src/pages/Storefront.jsx` (address book + checkout call sites)
- Modify: `frontend/src/services/auth.js` or the storefront service used by the customer panel (attach token)

**Interfaces:**
- Produces: GET/POST/PUT/DELETE all require a valid JWT; identity comes from the token (`Customer.findByEmail(user.email)`), never from `?email=` or body.

- [ ] **Step 1: Write failing scenario 5**

```js
verifyPhase1({ name: "store/addresses unauthenticated -> 401", run: async () => {
  const r = await fetch("http://localhost:3000/api/store/addresses?email=anyone@example.com");
  if (r.status !== 401) throw new Error("addresses: " + r.status);
}});
```

Run → FAIL (currently 200).

- [ ] **Step 2: Require auth and bind identity in the route**

At the top of each handler:

```js
import { authenticate } from "@/lib/authorization";
const auth = await authenticate();
if (!auth.ok) return auth.response;
```

Then derive the email from the authenticated user:

```js
const customer = await Customer.findByEmail(auth.user.email.toLowerCase());
```

Remove `email` from the query-string/body handling in GET/POST/PUT/DELETE (keep the `id` path for PUT/DELETE resource identity). If `auth.user.email` maps to no customer, still return `{ success: true, addresses: [] }` on GET and 404 on POST/PUT (the storefront lets a guest check out without saving an address; Phase 3 `delivery_addresses` owns that flow).

- [ ] **Step 3: Wire the Storefront to send the token**

Find the call sites (`grep -n "store/addresses" frontend/src/pages/Storefront.jsx`) and change each `fetch("/api/store/addresses", ...)` to:

```js
import { authHeaders } from "<the storefront's http service>"; // getStoredToken() + Authorization header
fetch("/api/store/addresses", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ ...noEmail, ... }) });
```

GET becomes `POST`-free: `fetch("/api/store/addresses", { headers: authHeaders() })`. If the token is absent (guest), skip the call and continue checkout without persisting the address (the checkout form already collects it).

- [ ] **Step 4: Re-run verify + manual smoke**

Run: `cd backend && node scripts/verify-phase1.mjs` → scenario 5 PASS. Manually: `cd frontend/storepub && npm run dev` must still render catalog + checkout.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/store/addresses/route.js frontend/src/pages/Storefront.jsx frontend/src/services
git commit -m "security: authenticate store/addresses, wire storefront token (Phase 1)"
```

---

## Task 9: Single-use, expiring password-reset token

**Files:**
- Create: `backend/sql/migrations/002-phase1-reset-tokens.sql`
- Create: `backend/lib/email-templates/password_reset.html`
- Create: `backend/lib/email-templates/password_reset.txt`
- Modify: `backend/app/api/auth/forgot-password/route.js`
- Modify: `backend/app/api/auth/reset-password/route.js`
- Modify: `frontend/src/services/auth.js` (`resetPassword(token, password)` sends `{ token, password }`)
- Modify: `frontend/src/pages/ResetPassword.jsx` + `ForgotPassword.jsx` (token from `?token=`, no inline password-set without token)

**Interfaces:**
- Produces:
  - `createPasswordResetToken(pool, userId)` → 32-byte hex token; stores its SHA-256 in `password_reset_tokens` (15 min expiry); returns only the raw token.
  - `consumePasswordResetToken(pool, rawToken)` → `{ ok, message, userId }` verifying existence, unused, unexpired, then marking `used_at`.

- [ ] **Step 1: Write the migration**

```sql
-- backend/sql/migrations/002-phase1-reset-tokens.sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
```

- [ ] **Step 2: Create the email template files (fallbacks when no DB row exists)**

```html
<!-- backend/lib/email-templates/password_reset.html -->
<p>Hello,</p>
<p>We received a request to reset the password for your {{appName}} account.</p>
<p><a href="{{resetLink}}" style="background:#111;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px">Reset my password</a></p>
<p>This link expires in 15 minutes. If you did not request it, you can safely ignore this email.</p>
```

```html
<!-- backend/lib/email-templates/password_reset.txt -->
Hello,

We received a request to reset the password for your {{appName}} account.

Open this link to reset it (expires in 15 minutes):
{{resetLink}}

If you did not request this, you can safely ignore this email.
```

Match the existing template files' naming convention in `backend/lib/email-templates/` (check the `.html`/`.txt` pair format of `credentials.*` there first).

- [ ] **Step 3: Write failing unit tests (pure token policy)**

```js
// backend/lib/__tests__/reset-token.test.mjs — only logic, no DB
import { test } from "node:test"; import assert from "node:assert";
import { tokenStale } from "../resetToken.js";
test("15-minute expiry", () => {
  assert.equal(tokenStale(Date.now() + 14 * 60_000, Date.now()), false);
  assert.equal(tokenStale(Date.now() + 16 * 60_000, Date.now()), true);
});
```

```js
// backend/lib/resetToken.js (pure)
export function tokenStale(expiresAtMs, nowMs) { return expiresAtMs <= nowMs; }
```

- [ ] **Step 4: Implement the endpoints**

`forgot-password`:

```js
const crypto = await import("node:crypto");
import { sendEmailFromTemplate, getAppName } from "@/lib/mail"; // add to imports
const userMatches = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
// NOTE: do NOT reveal account existence — generate+store only if found, and always return 200.
if (userMatches.rows.length) {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '15 minutes')`, [userMatches.rows[0].id, hash]);
  const link = `${process.env.FRONTEND_URL || "http://localhost:5173"}/auth/reset-password?token=${raw}`;
  try {
    await sendEmailFromTemplate({
      slug: "password_reset",
      to: normalizedEmail,
      values: { resetLink: link, appName: getAppName() },
      fallback: {
        subject: `Reset your ${getAppName()} password`,
        htmlFile: "password_reset.html",
        textFile: "password_reset.txt",
      },
    });
  } catch (e) {
    console.error("Password reset email failed:", e.message); // 200 anyway — never leak account existence
  }
}
return Response.json({ success: true, message: "If an account exists for that email, a password reset link has been sent." }, { status: 200, headers: corsHeaders() });
```

`reset-password`:

```js
const { token, password } = body;
const hash = crypto.createHash("sha256").update(token).digest("hex");
const row = await pool.query(
  `SELECT prt.id, prt.user_id, prt.expires_at, u.id AS uid, u.status
     FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
    WHERE prt.token_hash = $1 AND prt.used_at IS NULL`, [hash]);
if (!row.rows.length) return 400 "Invalid or expired reset token";
if (tokenStale(new Date(row.rows[0].expires_at).getTime(), Date.now())) return 400 "Reset token has expired";
const hashed = await bcrypt.hash(password, 12);
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, row.rows[0].uid]);
  await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.rows[0].id]);
  await client.query("COMMIT");
} catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
return Response.json({ success: true, message: "Password updated successfully. You can now login." }, { status: 200, headers: corsHeaders() });
```

`sendEmailFromTemplate` returns a Promise that must be caught so a mail failure still yields 200 (log, don't throw).

- [ ] **Step 5: Update the frontend**

`frontend/src/services/auth.js`:

```js
export async function resetPassword(token, password) {
  return (await fetch(`${API_URL}/auth/reset-password`, { method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ token, password }) })).json();
}
```

`ForgotPassword.jsx`: step 2 becomes a static "Check your email and click the reset link." screen — remove the inline `resetPassword(email, password)` call (no token exists yet). `ResetPassword.jsx`: reads `?token=` (already does), calls `resetPassword(token, form.password)` — which now matches the new service signature.

- [ ] **Step 6: Verify scenarios 6–7**

```js
verifyPhase1({ name: "reset-password valid token", run: async () => {
  const u = (await pool.query("SELECT id, email FROM users LIMIT 1")).rows[0];
  const t = await createPasswordResetToken(pool, u.id);
  const r = await fetch("http://localhost:3000/api/auth/reset-password", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, password: "NewPass123!" }) });
  if (r.status !== 200) throw new Error("expected 200 got " + r.status + " " + await r.text());
  const again = await fetch("http://localhost:3000/api/auth/reset-password", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, password: "NewPass123!" }) });
  if (again.status !== 400) throw new Error("single-use violated: " + again.status);
  // restore original password
  if (u.password) await pool.query("UPDATE users SET password = $1 WHERE id = $2", [u.password, u.id]);
}});
```

(Reset restores the original hash afterwards so the live seed password stays valid.)

- [ ] **Step 7: Commit**

```bash
git add backend/sql/migrations/002-phase1-reset-tokens.sql backend/lib/resetToken.js backend/lib/__tests__ backend/lib/email-templates/password_reset.html backend/lib/email-templates/password_reset.txt backend/app/api/auth/forgot-password/route.js backend/app/api/auth/reset-password/route.js frontend/src/services/auth.js frontend/src/pages/ForgotPassword.jsx frontend/src/pages/ResetPassword.jsx backend/scripts/verify-phase1.mjs
git commit -m "security: one-time expiring password reset tokens (Phase 1)"
```

---

## Task 10: Partial-update safety

**Files:**
- Modify: `backend/app/api/store/my/products/[uuid]/route.js`
- Modify: `backend/app/api/products/[id]/variant-pricing/route.js`

- [ ] **Step 1: Write failing scenarios**

```js
verifyPhase1({ name: "PATCH store product partial update", run: async () => {
  const t = await storeToken();
  const me = await apiGet("http://localhost:3000/api/auth/me", t);
  const branchUuid = me.data.user.branches[0].uuid;
  // The throwaway store's own branch has no products; add a branch_products row
  // on the test branch for the partially-updated fixture, snapshotting its values.
  const fixture = (await pool.query(
    `INSERT INTO branch_products (branchid, productid, productuuid, sellingprice, compareatprice, stockquantity, lowstockthreshold, isavailable, status)
     SELECT id, (SELECT id FROM products LIMIT 1), (SELECT uuid FROM products LIMIT 1), 199, 249, 42, 5, TRUE, 'ACTIVE'
     FROM branches WHERE uuid = $1
     RETURNING uuid, sellingprice, stockquantity`, [branchUuid])).rows[0];
  const r = await fetch(`http://localhost:3000/api/store/my/products/${fixture.uuid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, "x-branch-id": branchUuid },
    body: JSON.stringify({ isAvailable: false }) });
  const after = (await r.json()).product;
  if (r.status !== 200) throw new Error("patch: " + r.status + " " + JSON.stringify(await r.json()));
  if (Number(after.sellingPrice) !== Number(fixture.sellingprice) || Number(after.stockQuantity) !== Number(fixture.stockquantity))
    throw new Error("partial update zeroed fields: " + JSON.stringify(after));
  await pool.query("DELETE FROM branch_products WHERE uuid = $1", [fixture.uuid]);
}});
```

- [ ] **Step 2: Fix `store/my/products/[uuid]`**

Build an explicit SET list from the keys the caller sent (whitelist `sellingPrice, compareAtPrice, stockQuantity, isAvailable, lowStockThreshold`), never fill defaults:

```js
const setFields = []; const values = []; const set = (col, v) => { setFields.push(`${col} = $${values.length + 1}`); values.push(v); };
if (body.sellingPrice !== undefined) set("sellingprice", Number(body.sellingPrice));
if (body.compareAtPrice !== undefined) set("compareatprice", Number(body.compareAtPrice));
if (body.stockQuantity !== undefined) set("stockquantity", Math.max(0, Number(body.stockQuantity) || 0));
if (body.isAvailable !== undefined) set("isavailable", body.isAvailable);
if (body.lowStockThreshold !== undefined) set("lowstockthreshold", Number(body.lowStockThreshold));
if (!setFields.length) return Response.json({ success: false, message: "No updateable fields provided" }, { status: 400, headers: corsHeaders() });
values.push(uuid, access.branchId);
const result = await pool.query(
  `UPDATE branch_products SET ${setFields.join(", ")}, updatedat = now() WHERE uuid = $${values.length - 1} AND branchid = $${values.length} RETURNING sellingprice, compareatprice, stockquantity, isavailable, lowstockthreshold`, values);
```

(Return keys as before in camelCase.) Keep the `x-branch-id`/`branchId` sourcing and `requireBranchAccess` call.

- [ ] **Step 3: Fix `variant-pricing`**

Only merge rows the caller named; never commit an empty array over the full variants list:

```js
if (variants.length) {
  const map = new Map();
  for (const v of variants) map.set(v.sku ?? v.name, v);
  const updatedVariants = existingVariants.map((variant) => {
    const u = map.get(variant.sku) || map.get(variant.name);
    return u ? { ...variant, price: u.price !== undefined ? Number(u.price) : variant.price,
      stock: u.stock !== undefined ? Number(u.stock) : variant.stock,
      discount_price: u.discountPrice !== undefined ? Number(u.discountPrice) : variant.discount_price } : variant;
  });
  await pool.query(`UPDATE products SET variants = $1::jsonb, updated_at = now() WHERE uuid = $2`, [JSON.stringify(updatedVariants), id]);
}
```

- [ ] **Step 4: Re-run verify**

Run: `cd backend && node scripts/verify-phase1.mjs` → partial-update scenario PASS; a run against the variant route's product with `variants: []` must leave the stored variants untouched.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/store/my/products/[uuid]/route.js backend/app/api/products/[id]/variant-pricing/route.js backend/scripts/verify-phase1.mjs
git commit -m "fix: partial updates no longer zero unsent columns (Phase 1)"
```

---

## Task 11: Order-number sequence + payment-method alignment

**Files:**
- Create: `backend/sql/migrations/003-phase1-order-number-sequence.sql`
- Modify: `backend/lib/models/order.js` (`nextOrderNumber` + `formatOrderNumber`)
- Modify: `backend/app/api/orders/store/route.js` (payment normalization + use the sequence)
- Modify: `backend/scripts/verify-phase1.mjs`

- [ ] **Step 1: Write the migration (sequence + payment CHECK alignment)**

```sql
-- backend/sql/migrations/003-phase1-order-number-sequence.sql
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

-- Continue from the largest existing numeric suffix, or 1000 if none.
SELECT setval('order_number_seq', GREATEST(COALESCE(
  (SELECT MAX(NULLIF(regexp_replace(order_number, '[^0-9]', '', 'g'), '')::bigint) FROM orders), 1000),
  1000));

-- Accept only the CHECK-conforming methods going forward; keep cod/card/upi.
DO $$
BEGIN
  ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
  ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IN ('card', 'cod', 'upi'));
EXCEPTION WHEN others THEN NULL;
END $$;
```

- [ ] **Step 2: Write failing unit + concurrency scenarios**

```js
// backend/lib/__tests__/order-number.test.mjs
import { test } from "node:test"; import assert from "node:assert";
import { formatOrderNumber, parseOrderNumberSuffix } from "../orderNumber.js";
test("formatting and round-trip", () => {
  assert.equal(formatOrderNumber(1005), "ORD-1005");
  assert.equal(parseOrderNumberSuffix("ORD-1005"), 1005);
  assert.equal(parseOrderNumberSuffix("ORD-0000009"), 9);
});
```

```js
// backend/lib/orderNumber.js
export const ORDER_NUMBER_PREFIX = "ORD-";
export function formatOrderNumber(seq) {
  return `${ORDER_NUMBER_PREFIX}${String(seq).padStart(4, "0")}`;
}
export function parseOrderNumberSuffix(orderNumber) {
  const m = String(orderNumber).match(/ORD-(\d+)/i);
  if (!m) return null;
  return parseInt(m[1], 10);
}
```

Verify scenario 9 (run with the dev server up, against the live DB; the scenario cleans up after itself so row counts stay stable):

```js
verifyPhase1({ name: "concurrent checkout: one wins, numbers unique", run: async () => {
  const bp = (await pool.query(
    `SELECT bp.uuid, bp.stockquantity, bp.branchid,
            b.uuid AS branch_uuid, p.uuid AS product_uuid
       FROM branch_products bp
       JOIN branches b ON b.id = bp.branchid
       JOIN products p ON p.id = bp.productid
      WHERE bp.isavailable = TRUE AND bp.status = 'ACTIVE'
        AND bp.stockquantity - COALESCE(bp.reservedquantity, 0) >= 2
      ORDER BY bp.stockquantity DESC LIMIT 1`)).rows[0];
  if (!bp) throw new Error("no branch_product with stock >= 2 to race");

  const fixtureEmail = `race-${Date.now()}@earth.local`;
  const body = {
    customerName: "Phase1 Race",
    customerEmail: fixtureEmail,
    customerMobile: "9876543210",
    shippingAddress: { address: "123 Test Lane", pincode: "400001", city: "Mumbai", state: "Maharashtra", country: "India" },
    branchId: bp.branch_uuid,
    items: [{ product_uuid: bp.product_uuid, quantity: 1 }],
    paymentMethod: "cod",
  };
  const post = () => fetch("http://localhost:3000/api/orders/store", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const [a, b2] = await Promise.all([post(), post()]);
  const statuses = [a.status, b2.status].sort((x, y) => x - y);
  if (statuses[0] !== 201 || (statuses[1] !== 409 && statuses[1] !== 400))
    throw new Error(`expected exactly one 201 and one 409/400, got [${statuses}]`);

  const winner = a.status === 201 ? await a.json() : await b2.json();
  const reply = winner.order ?? {};
  const orderNumber = reply.order_number ?? reply.orderNumber ?? "";
  if (!/^ORD-\d{4,}$/.test(orderNumber)) throw new Error("bad order number: " + orderNumber);

  // Fixture cleanup: delete this race's orders, their items, history and ledger
  // rows, and restore the branch product's stock snapshot.
  await pool.query(`
    DELETE FROM branch_inventory_transactions WHERE referenceid IN
      (SELECT id FROM orders WHERE customer_email = $1)`, [fixtureEmail]);
  await pool.query(`
    DELETE FROM order_status_history WHERE order_id IN
      (SELECT id FROM orders WHERE customer_email = $1)`, [fixtureEmail]);
  await pool.query(`
    DELETE FROM order_items WHERE order_id IN
      (SELECT id FROM orders WHERE customer_email = $1)`, [fixtureEmail]);
  await pool.query(`DELETE FROM orders WHERE customer_email = $1`, [fixtureEmail]);
  await pool.query(
    "UPDATE branch_products SET stockquantity = $1 WHERE uuid = $2",
    [bp.stockquantity, bp.uuid]);
}});
```

- [ ] **Step 3: Rewrite `order.js` numbering**

```js
import { formatOrderNumber, parseOrderNumberSuffix } from "../orderNumber.js";
async nextOrderNumber() {
  const { rows } = await pool.query("SELECT nextval('order_number_seq')::bigint AS seq");
  return formatOrderNumber(parseInt(rows[0].seq, 10));
}
```

- [ ] **Step 4: Normalize payment method in `orders/store`**

When the body carries `paymentMethod` (or `payment_method`), map it:

```js
const method = String(body.paymentMethod ?? body.payment_method ?? "cod").toLowerCase().trim();
const ALLOWED = new Set(["card", "cod", "upi"]);
if (!ALLOWED.has(method)) {
  return Response.json({ success: false, message: "Invalid payment method" }, { status: 400, headers: corsHeaders() });
}
```

and pass that value into the INSERT so it satisfies the CHECK. Keep the guarded decrement (`AND stockquantity - reservedquantity >= $1`) exactly as is; wrap the entire order creation in the same transaction using `applyStockChange` (Task 12) for the decrement + its `ORDER` ledger row.

- [ ] **Step 5: Verify**

Run: `cd backend && npm run migrate && npm test && node scripts/verify-phase1.mjs` → ordering + payment + concurrency scenarios PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/sql/migrations/003-phase1-order-number-sequence.sql backend/lib/orderNumber.js backend/lib/models/order.js backend/app/api/orders/store/route.js backend/lib/__tests__/order-number.test.mjs backend/scripts/verify-phase1.mjs
git commit -m "fix: sequence-backed order numbers, conform payment methods (Phase 1)"
```

---

## Task 12: Ledger discipline — `lib/inventory.js`

**Files:**
- Create: `backend/lib/inventory.js`
- Create: `backend/sql/migrations/004-phase1-ledger-check.sql`
- Modify: `backend/lib/models/branchProduct.js` (`updateStock` → delegate to `applyStockChange`)
- Modify: `backend/app/api/store/my/products/[uuid]/route.js` (ledger on stock change)
- Modify: `backend/app/api/orders/store/route.js` (decrement via `applyStockChange` + `ORDER` ledger)
- Modify: `backend/app/api/orders/[uuid]/route.js` (admin cancel restocks via `RELEASE` ledger)
- Test: `backend/scripts/verify-phase1.mjs` (scenario 11: every mutation has a ledger row)

**Interfaces:**
- Produces: `applyStockChange({ branchProductId, delta, transactionType, referenceType, referenceId, note, client })` — signed `delta` (negative = decrement); optional `minAvailable` guard; writes `branch_inventory_transactions` (previousstock/newstock/referencetype/referenceid) in the SAME transaction as the UPDATE via the passed `client` (a `pg` pool client in a BEGIN/COMMIT block, or `pool` for autocommit). Returns `{ branchProduct, previousStock, newStock, actualChange }`.

- [ ] **Step 1: Write the CHECK extension migration**

```sql
-- backend/sql/migrations/004-phase1-ledger-check.sql
DO $$
BEGIN
  ALTER TABLE branch_inventory_transactions DROP CONSTRAINT IF EXISTS branch_inventory_transactions_transactiontype_check;
  ALTER TABLE branch_inventory_transactions ADD CONSTRAINT branch_inventory_transactions_transactiontype_check
    CHECK (transactiontype IN ('PURCHASE','ORDER','RETURN','DAMAGE','ADJUSTMENT',
      'TRANSFER_IN','TRANSFER_OUT','RESERVATION','RELEASE'));
END $$;
```

- [ ] **Step 2: Implement `applyStockChange` (unit-test the guard logic)**

```js
// backend/lib/inventory.js
import pool from "./db.js";

export function buildGuard(minAvailable) {
  return minAvailable != null
    ? `AND stockquantity - COALESCE(reservedquantity, 0) >= ${Number(minAvailable)}`
    : "";
}

export async function applyStockChange({ branchProductId, delta, transactionType = "ADJUSTMENT", minAvailable = null, referenceType = null, referenceId = null, note = null, client }) {
  const db = client ?? pool;
  const guard = buildGuard(minAvailable);
  const upd = await db.query(
    `UPDATE branch_products SET stockquantity = stockquantity + $1, updatedat = now()
      WHERE uuid = $2 ${guard} RETURNING stockquantity AS stockquantity, reservedquantity AS reservedquantity`,
    [Number(delta), branchProductId]);
  if (!upd.rows.length) throw new StockChangeError("Insufficient stock or branch product not found");
  const previous = Number(upd.rows[0].stockquantity) - Number(delta);
  const newStock = Number(upd.rows[0].stockquantity);
  await db.query(
    `INSERT INTO branch_inventory_transactions
       (branchid, productid, transactiontype, quantity, previousstock, newstock, referencetype, referenceid, note)
     SELECT branchid, productid, $1, $2, $3, $4, $5, $6, $7 FROM branch_products WHERE uuid = $8`,
    [transactionType, Number(delta), previous, newStock, referenceType, referenceId, note, branchProductId]);
  return { branchProductId, previousStock: previous, newStock, actualChange: Number(delta) };
}

export class StockChangeError extends Error {}
```

Unit test:

```js
// backend/lib/__tests__/inventory-guard.test.mjs — logic only, no DB
import { test } from "node:test"; import assert from "node:assert";
import { buildGuard } from "../inventory.js";
test("guard clause strings", () => {
  assert.equal(buildGuard(null), "");
  assert.equal(buildGuard(3), "AND stockquantity - COALESCE(reservedquantity, 0) >= 3");
});
```

Refactor: extract `buildGuard(minAvailable)` into the module for the test to import.

- [ ] **Step 3: Route existing mutations through it**

- `branchProduct.updateStock(uuid, stockChange, reason, transactionType)` → `applyStockChange({ branchProductId: uuid, delta: stockChange, transactionType, note: reason })` (guard `minAvailable: 0`; keep its null-return contract by catching `StockChangeError`).
- `store/my/products/[uuid]` PATCH: when `body.stockQuantity !== undefined` OR an inventory adjustment happens, call `applyStockChange({ branchProductId, delta: newStock - current, transactionType: "ADJUSTMENT", referenceType: "branch_user", referenceId: access.user.id })` inside the same UPDATE transaction (compute delta from the current row, not by overwriting).
- `orders/store`: extend the branch product query (`orders/store/route.js:132-146`) with `bp.uuid AS branch_product_uuid` so each cart line knows its branch product row; replace the bare decrement (`orders/store/route.js:291-299`) with `await applyStockChange({ branchProductId: product.branch_product_uuid, delta: -quantity, transactionType: "ORDER", minAvailable: quantity, client, referenceType: "orders", referenceId: orderId, note: customerEmail })` — the `minAvailable` guard preserves the current `AND stockquantity - reservedquantity >= $1` behavior, with `StockChangeError` translating to the existing 409 response. Note `orderId` must be known first: create the order header before the decrement loop, or capture `(SELECT id FROM orders WHERE uuid = ...)`; simplest is to move `Order.create` before the loop and pass its `id`.
- `orders/[uuid]` admin cancel: find per-order-item branch products and `applyStockChange({ branchProductId, delta: +qty, transactionType: "RELEASE", client: tx, referenceType: "orders", referenceId })` so cancel restocks (spec §2.2 "admin cancel does not restock" → fixed).

- [ ] **Step 4: Write scenario 11**

```js
verifyPhase1({ name: "every stock mutation leaves a ledger row", run: async () => {
  // 1) pick a branch_product, record ledger count;
  // 2) adjust stock through store/my/products/[uuid];
  // 3) assert ledger count increased by >= 1 and the row has previous/new stock = actual;
}});
```

- [ ] **Step 5: Re-run verify + migrate**

Run: `cd backend && npm run migrate && node scripts/verify-phase1.mjs` → ledger + concurrency + partial-update scenarios all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/lib/inventory.js backend/lib/__tests__/inventory-guard.test.mjs backend/sql/migrations/004-phase1-ledger-check.sql backend/lib/models/branchProduct.js backend/app/api/store/my/products/[uuid]/route.js backend/app/api/orders/store/route.js backend/app/api/orders/[uuid]/route.js backend/scripts/verify-phase1.mjs
git commit -m "refactor: single stock-mutation path with ledger rows (Phase 1)"
```

---

## Task 13: Hardening — track, rate limits, headers, upload

**Files:**
- Modify: `backend/app/api/store/orders/track/route.js` (require order_number; drop email-only enumeration)
- Create: `backend/lib/rateLimit.js`
- Modify: `backend/app/api/auth/login/route.js`, `auth/forgot-password/route.js`, `auth/reset-password/route.js`, `orders/store/route.js`, `store/orders/track/route.js`, `media/upload/route.js` (apply limiter)
- Modify: `backend/next.config.ts` (security headers)
- Modify: `backend/app/api/media/upload/route.js` (MIME + magic bytes + 5 MB size; disallow SVG)

- [ ] **Step 1: Write rate-limiter unit tests**

```js
// backend/lib/__tests__/rate-limit.test.mjs
import { test } from "node:test"; import assert from "node:assert";
import { createRateLimiter } from "../rateLimit.js";
test("window limit enforced and resets", async () => {
  const rl = createRateLimiter({ limit: 2, windowMs: 50 });
  assert.ok(rl.hit("a").ok); assert.ok(rl.hit("a").ok);
  assert.ok(!rl.hit("a").ok);
  await new Promise((res) => setTimeout(res, 60));
  assert.ok(rl.hit("a").ok);
});
test("independent keys", () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.ok(rl.hit("x").ok); assert.ok(rl.hit("y").ok); assert.ok(!rl.hit("x").ok);
});
```

```js
// backend/lib/rateLimit.js
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map(); // key -> { count, resetAt }
  return {
    hit(key) {
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || rec.resetAt <= now) { hits.set(key, { count: 1, resetAt: now + windowMs }); return { ok: true }; }
      rec.count += 1;
      if (rec.count > limit) return { ok: false, retryAfterMs: rec.resetAt - now };
      return { ok: true };
    },
  };
}
export function rateLimitedResponse(retryAfterMs) {
  return Response.json({ success: false, message: "Too many requests. Please try again later." },
    { status: 429, headers: { ...corsHeaders(), "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } });
}
```

- [ ] **Step 2: Apply to endpoints**

Create `const ipLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });` etc. per route and at the top of each handler:

```js
const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
const lim = ipLimiter.hit(ip);
if (!lim.ok) return rateLimitedResponse(lim.retryAfterMs);
```

For login: `const loginFail = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });` keyed `ip:email` on failed attempt. For forgot/reset: 5 / 15 min per `ip` + `email`. Track: 60/min per `ip`.

- [ ] **Step 3: Track requires both order number and email**

Remove the email-only branch (the `if (!orderNumber)` picklist mode). Require both: if `!orderNumber || !email` → 400 `"order_number and email are required"`. Keep the single-order query + items + history. Update the Storefront "my orders" list screen to always pass both (grep, wire, and drop the picklist-depend).

- [ ] **Step 4: Upload checks**

```js
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]); // svg removed
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
const SNIFF = { png: [[0x89,0x50,0x4E,0x47]], jpg: [[0xFF,0xD8,0xFF]], gif: [[0x47,0x49,0x46,0x38,"37","39"]] , webp: [0x52,0x49,0x46,0x46] };
if (!ALLOWED_EXTENSIONS.has(extension)) return 400 "Unsupported file type";
if (!ALLOWED_MIME.has(file.type)) return 400 "Unsupported MIME type";
if (buffer.byteLength > MAX_BYTES) return 400 `File exceeds ${MAX_BYTES} byte limit`;
// magic-byte check: compare buffer start to SNIFF[extension]; webp needs RIFF....WEBP
```

- [ ] **Step 5: Security headers in `next.config.ts`**

```ts
// backend/next.config.ts — add/merge
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000", },
  { key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:5173 http://localhost:5174 http://localhost:5175; base-uri 'self'; frame-ancestors 'none'" },
];
const nextConfig = { ...existing, async headers() { return [{ source: "/:path*", headers: securityHeaders }]; } };
```

- [ ] **Step 6: Verify**

Run: `cd backend && npm test && node scripts/verify-phase1.mjs` and `curl -sI http://localhost:3000/api/health` (any route) → headers present; `GET /api/store/orders/track?email=x@y.z` → 400.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/store/orders/track/route.js backend/lib/rateLimit.js backend/lib/__tests__/rate-limit.test.mjs backend/app/api/auth/login/route.js backend/app/api/auth/forgot-password/route.js backend/app/api/auth/reset-password/route.js backend/app/api/orders/store/route.js backend/app/api/media/upload/route.js backend/next.config.ts frontend/src/pages/Storefront.jsx
git commit -m "security: harden track, add rate limits, headers, upload checks (Phase 1)"
```

---

## Task 14: Full Phase-1 verification run

**Files:**
- Modify: `backend/scripts/verify-phase1.mjs` (scenario 12: data intact)

- [ ] **Step 1: Add scenario 12 (data intact)**

```js
verifyPhase1({ name: "existing data intact", run: async () => {
  await cleanupStoreAccount(); // remove the throwaway store user from Task 6-7 scenarios first
  const counts = {};
  for (const t of ["users", "orders", "order_items", "branches", "branch_products", "permissions", "roles"])
    counts[t] = (await pool.query(`SELECT COUNT(*)::int AS c FROM ${t}`)).rows[0].c;
  // Snapshot these values at implementation time and assert equality here.
  if (counts.users !== 24 || counts.orders !== 11 || counts.branches !== 4)
    throw new Error(`counts changed: ${JSON.stringify(counts)}`);
}});
```

Update the hardcoded counts to the live values when the row counts are confirmed (they must match the snapshot taken in Task 2).

- [ ] **Step 2: Run the complete suite**

Run: `cd backend && npm run migrate && npm test && node scripts/verify-phase1.mjs` (dev server on :3000)
Expected: all unit tests and scenarios 1–12 PASS.

- [ ] **Step 3: Manual smoke of all three panels**

- Admin (5173): branch list shows real addresses, create/edit a branch, open branch orders.
- Store panel (5175): own-branch products load (camelCase keys), partial PATCH works.
- Customer (5174): catalog, product detail, cart, checkout (COD/UPI), track with order number.

- [ ] **Step 4: Commit + tag**

```bash
git add backend/scripts/verify-phase1.mjs
git commit -m "test: full Phase 1 verification suite green (Phase 1)"
git tag phase1-foundation
```

---

## Post-plan self-review notes

- All 11 spec Phase-1 items map to tasks: columns (3), schema (5), permissions+seed (6), scoping (7), addresses (8), reset token (9), 500-routes (4), order number+payment (11), ledger+check (12), partial safety (10), hardening (13), verification (1,2,14).
- Migration files are applied in numeric order by `scripts/migrate.mjs`; every migration is idempotent (`IF NOT EXISTS`/`ON CONFLICT`/`DO $$ ... EXCEPTION WHEN others THEN NULL`).
- The frontends read lowercase keys — Task 3 Step 6 patched them; Task 8/13/14 re-check the storefront surfaces the changes touch.
- Spec scenarios 1–12 (§5) are represented: 1=Task 3, 2/4/Task 6+7, 3=Task 7, 5=Task 8, 6=Task 9, 7=Task 9, 8=Task 4, 9=Task 11, 10=Task 10, 11=Task 12, 12=Task 14.