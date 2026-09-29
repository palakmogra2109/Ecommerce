import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./lib/env.mjs";

await loadEnv();

const SCENARIO_TIMEOUT_MS = 60_000;

const scenarios = [];
export function verifyPhase1({ name, run }) { scenarios.push({ name, run }); }

function withTimeout(run) {
  const running = Promise.resolve().then(() => run());
  running.catch(() => {});
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS}ms`)),
      SCENARIO_TIMEOUT_MS,
    );
  });
  return Promise.race([running, expiry]).finally(() => clearTimeout(timer));
}

export async function report() {
  let failed = 0;
  for (const { name, run } of scenarios) {
    try { await withTimeout(run); console.log(`PASS  ${name}`); }
    catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e?.message ?? e)}`); }
  }
  console.log(`\n${scenarios.length - failed}/${scenarios.length} passed`);
  if (scenarios.length === 0) console.log("no scenarios registered - nothing was verified");
  process.exit(failed || scenarios.length === 0 ? 1 : 0);
}

// ==== SCENARIOS ====
// Later tasks append `verifyPhase1({ name, run })` registrations at the BOTTOM of
// this region, i.e. the last thing before the RUNNER heading. Never edit or
// remove anything under the RUNNER heading below.
//
// The shared `pool` below lives for the whole run and is closed by the RUNNER,
// after every scenario has finished. Do NOT register a `pool.end()` scenario:
// registration order is execution order, so a teardown scenario placed here
// would run before scenarios appended after it and every one of those would
// fail with "Cannot use a pool after calling end". Standalone scripts that need
// their own pool should use `withPool()` from ./lib/pool.mjs instead.

// Task 2: live column inventory. Read-only introspection against DATABASE_URL —
// no writes, no DDL. loadEnv() already ran above, so the pool can be created here.
const { listColumns, assertColumn } = await import("./lib/columns.mjs");
const { createPool } = await import("./lib/pool.mjs");
const { INVENTORY_TABLES, INVENTORY_PATH, renderInventory } = await import("./gen-inventory.mjs");

const pool = createPool();

for (const table of INVENTORY_TABLES) {
  verifyPhase1({
    name: `column inventory: ${table} reachable and non-empty`,
    run: async () => {
      const cols = await listColumns(pool, table);
      if (cols.length === 0) {
        throw new Error(
          `${table} exposes no columns in information_schema (missing table or wrong schema)`,
        );
      }
    },
  });
}

// Column names below are copied verbatim from the live database — see
// sql/inventory.md. Do NOT "fix" folded lowercase names into snake_case.
const INVENTORY_EXPECTATIONS = [
  ["branches", "id"],
  ["branches", "uuid"],
  ["branches", "addressline1"],
  ["branches", "postalcode"],
  ["branches", "deliveryradius"],
  ["branches", "createdat"],
  ["branches", "updatedat"],
  ["branches", "countryid"],
  ["branch_products", "branchid"],
  ["branch_products", "productid"],
  ["branch_products", "productuuid"],
  ["branch_products", "variantid"],
  ["branch_products", "stockquantity"],
  ["branch_products", "reservedquantity"],
  ["branch_products", "availablequantity"],
  ["branch_products", "lowstockthreshold"],
  ["branch_products", "createdat"],
  ["branch_stock_transfers", "transfernumber"],
  ["branch_stock_transfers", "sourcebranchid"],
  ["branch_stock_transfers", "destinationbranchid"],
  ["branch_stock_transfers", "status"],
  ["branch_stock_transfers", "createdat"],
  ["branch_transfer_items", "transferid"],
  ["branch_transfer_items", "productid"],
  ["branch_transfer_items", "quantity"],
  ["branch_transfer_items", "previousstocksource"],
  ["branch_transfer_items", "previousstockdest"],
  ["branch_inventory_transactions", "branchid"],
  ["branch_inventory_transactions", "productid"],
  ["branch_inventory_transactions", "transactiontype"],
  ["branch_inventory_transactions", "quantity"],
  ["branch_inventory_transactions", "previousstock"],
  ["branch_inventory_transactions", "newstock"],
  ["branch_inventory_transactions", "referencetype"],
  ["branch_inventory_transactions", "referenceid"],
  ["branch_inventory_transactions", "createdat"],
  ["orders", "id"],
  ["orders", "uuid"],
  ["orders", "order_number"],
  ["orders", "customer_id"],
  ["orders", "shipping_address"],
  ["orders", "payment_method"],
  ["orders", "created_at"],
  ["orders", "branchid"],
  ["orders", "estimated_delivery_at"],
  ["users", "id"],
  ["users", "uuid"],
  ["users", "email"],
  ["users", "created_at"],
  ["users", "status"],
  ["users", "parent_id"],
];

for (const [table, column] of INVENTORY_EXPECTATIONS) {
  verifyPhase1({
    name: `column exists: ${table}.${column}`,
    run: async () => {
      await assertColumn(pool, table, column);
    },
  });
}

// Orders is snake_case, so the camelCase spellings must NOT be accepted. This
// pins the trap that later model tasks keep falling into.
verifyPhase1({
  name: "no camelCase column spellings on snake_case tables (orders, users)",
  run: async () => {
    for (const [table, bogus] of [
      ["orders", "createdAt"],
      ["orders", "orderNumber"],
      ["orders", "customerId"],
      ["orders", "paymentMethod"],
      ["users", "createdAt"],
      ["users", "parentId"],
    ]) {
      // assert a *column* miss specifically, not merely "something threw" — a
      // dropped connection would otherwise read as a passing guard.
      const e = await assertColumn(pool, table, bogus).then(
        () => null,
        (err) => err,
      );
      if (!e) throw new Error(`${table}.${bogus} unexpectedly exists (camelCase leaking in?)`);
      if (!e.message.startsWith(`missing column ${table}.${bogus}; have: `)) {
        throw new Error(
          `expected a missing-column error for ${table}.${bogus}, got: ${e.message}`,
        );
      }
    }
  },
});

// And the mirror image: the folded tables must not gain snake_case spellings.
verifyPhase1({
  name: "no snake_case column spellings on folded tables (branches, branch_products)",
  run: async () => {
    for (const [table, bogus] of [
      ["branches", "address_line_1"],
      ["branches", "postal_code"],
      ["branches", "created_at"],
      ["branches", "country_id"],
      ["branch_products", "branch_id"],
      ["branch_products", "stock_quantity"],
      ["branch_products", "reserved_quantity"],
    ]) {
      const e = await assertColumn(pool, table, bogus).then(
        () => null,
        (err) => err,
      );
      if (!e) throw new Error(`${table}.${bogus} unexpectedly exists (snake_case spelling present)`);
      if (!e.message.startsWith(`missing column ${table}.${bogus}; have: `)) {
        throw new Error(
          `expected a missing-column error for ${table}.${bogus}, got: ${e.message}`,
        );
      }
    }
  },
});

// Byte-for-byte comparison against the generator's own output, so a hand-edit
// to sql/inventory.md fails even when the column names still line up. This also
// pins the format contract (### <table> headings, the "N columns." line, the
// two-space separator) in code rather than prose.
verifyPhase1({
  name: "sql/inventory.md is byte-identical to `npm run gen:inventory` output",
  run: async () => {
    const text = fs.readFileSync(INVENTORY_PATH, "utf8");
    const expected = await renderInventory(pool);
    if (text !== expected) {
      throw new Error(
        "sql/inventory.md differs from the live schema; run `npm run gen:inventory` and commit the result",
      );
    }
  },
});

// ==== APPEND NEW SCENARIOS HERE ====
// This is the append point for Tasks 3+. Nothing below it may call pool.end()
// or otherwise tear down the shared pool; the RUNNER closes it after the last
// scenario completes.

// Task 5: schema.sql is the bootstrap file for a future EMPTY database, so it
// has to describe the same tables the running system has. countries / states /
// cities were created outside this file, which is why a fresh install came up
// without them even though `branches` already had countryid/stateid/cityid
// foreign keys pointing at them.
//
// `fs` is imported at the top of this file (Task 2 needs it for the inventory
// comparison), so it is not re-imported here.
verifyPhase1({
  name: "schema.sql covers live tables",
  run: async () => {
    const schema = fs.readFileSync("sql/schema.sql", "utf8");
    for (const t of ["countries", "states", "cities"]) {
      // The brief's literal `CREATE TABLE ${t}` cannot match a file that uses
      // `CREATE TABLE IF NOT EXISTS` on all 27 of its other tables - and a bare
      // CREATE TABLE here would break the header's promise that the file is
      // safe to re-run. Both spellings count; a table that is absent entirely
      // still fails.
      if (!schema.includes(`CREATE TABLE ${t} `) && !schema.includes(`CREATE TABLE IF NOT EXISTS ${t} `)) {
        throw new Error(`schema.sql missing ${t}`);
      }
    }
  },
});

// The check above only proves the three reference tables are MENTIONED. This is
// the one that keeps the whole file honest: every table the live database has has
// to be described here, and the columns of each `CREATE TABLE` block have to
// match information_schema exactly - same names, same order, same spelling.
//
// The comparison is case-SENSITIVE on purpose. The branch tables were created
// with unquoted camelCase column names, which PostgreSQL folded to lowercase, so
// the live columns are `addressline1`, `stockquantity`, `createdat`. A schema.sql
// that wrote `addressLine1` would only match by relying on that folding, and the
// models in lib/models/ have to alias those folded names back to camelCase
// precisely because the database folded them (see sql/inventory.md).
const TABLE_CONSTRAINT_KEYWORDS = new Set([
  "PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "CONSTRAINT", "EXCLUDE", "LIKE",
]);

// Splits on commas that are not inside parentheses, brackets or a string
// literal, so a `CHECK (status IN ('A', 'B'))` does not tear a column apart.
function splitTopLevel(body) {
  const parts = [];
  let current = "";
  let depth = 0;
  let inString = false;
  for (const ch of body) {
    if (inString) {
      current += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// table name -> column names, in the order a fresh database ends up with them:
// the `CREATE TABLE` block first, then every column the file backfills with
// `ALTER TABLE ... ADD COLUMN`, in the order those statements appear. Several
// tables (orders, order_items, products, banners, customers) only reach their
// live shape through the trailing ALTERs, so a parser that stopped at the
// closing paren would report them as missing columns.
function parseSchemaColumns(sql) {
  const tables = new Map();
  const createRe = /CREATE TABLE(?: IF NOT EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/g;
  let match;
  while ((match = createRe.exec(sql)) !== null) {
    const name = match[1];
    let depth = 1;
    let body = "";
    let inString = false;
    for (let i = createRe.lastIndex; i < sql.length && depth > 0; i++) {
      const ch = sql[i];
      if (inString) { body += ch; if (ch === "'") inString = false; continue; }
      if (ch === "'") { inString = true; body += ch; continue; }
      if (ch === "(") { depth++; body += ch; continue; }
      if (ch === ")") { depth--; if (depth === 0) break; body += ch; continue; }
      body += ch;
    }
    if (depth !== 0) throw new Error(`unterminated CREATE TABLE ${name} in sql/schema.sql`);

    const cols = [];
    for (const part of splitTopLevel(body)) {
      const first = part.trim().split(/[\s(]+/)[0];
      if (!first || TABLE_CONSTRAINT_KEYWORDS.has(first.toUpperCase())) continue;
      cols.push(first.replace(/"/g, ""));
    }
    tables.set(name, cols);
  }

  const alterRe =
    /ALTER TABLE(?: IF EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ADD COLUMN(?: IF NOT EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/g;
  while ((match = alterRe.exec(sql)) !== null) {
    const cols = tables.get(match[1]);
    if (!cols) continue;
    if (!cols.includes(match[2])) cols.push(match[2]);
  }
  return tables;
}

verifyPhase1({
  name: "sql/schema.sql describes every live table, column for column and in order",
  run: async () => {
    const schema = fs.readFileSync("sql/schema.sql", "utf8");
    const declared = parseSchemaColumns(schema);
    if (declared.size === 0) throw new Error("no CREATE TABLE blocks parsed out of sql/schema.sql");

    // Direction 1: nothing live may be missing from the bootstrap file.
    // schema_migrations is created by scripts/migrate.mjs, not by schema.sql.
    const { rows: liveTables } = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    const undocumented = liveTables
      .map((r) => r.table_name)
      .filter((t) => t !== "schema_migrations" && !declared.has(t));
    if (undocumented.length > 0) {
      throw new Error(`live tables with no CREATE TABLE in sql/schema.sql: ${undocumented.join(", ")}`);
    }

    // Direction 2: every declared table has to match the live columns, in the
    // live order. Order matters because a fresh install has to be
    // indistinguishable from the running one, and because several tables only
    // reach their final shape through trailing ALTER TABLE ... ADD COLUMN.
    const problems = [];
    for (const [table, cols] of declared) {
      const live = (await listColumns(pool, table)).map((c) => c.name);
      if (live.length === 0) {
        problems.push(`${table}: no such table in the live database`);
        continue;
      }
      const missing = live.filter((c) => !cols.includes(c));
      const unknown = cols.filter((c) => !live.includes(c));
      if (missing.length || unknown.length) {
        problems.push(
          `${table}: missing [${missing.join(", ")}] not in schema [${unknown.join(", ")}]`,
        );
      } else if (cols.join(",") !== live.join(",")) {
        problems.push(
          `${table}: column order differs - schema [${cols.join(", ")}] vs live [${live.join(", ")}]`,
        );
      }
    }
    if (problems.length > 0) throw new Error(problems.join("\n      "));
  },
});

// Task 3: column-case aliases. Postgres folded the unquoted camelCase DDL to
// lowercase, so a `SELECT addressLine1` hands the driver the key `addressline1`
// and every consumer reading `row.addressLine1` sees undefined. The models must
// alias each column back to camelCase on the way out.
//
// These have to be dynamic imports: lib/db.js builds its Pool at module scope
// from DATABASE_URL, and a static import would be hoisted above the
// `await loadEnv()` at the top of this file, leaving the models pointed at an
// unauthenticated pool.
const { Branch } = await import("../lib/models/branch.js");
const { BranchProduct } = await import("../lib/models/branchProduct.js");
const { BranchStockTransfer, TRANSFER_COLUMNS, TRANSFER_ITEM_COLUMNS } =
  await import("../lib/models/branchStockTransfer.js");

const BRANCH_KEYS = [
  "uuid", "name", "code", "phone", "email", "address", "addressLine1", "addressLine2",
  "city", "state", "country", "postalCode", "latitude", "longitude", "openingTime",
  "closingTime", "timezone", "status", "deliveryEnabled", "pickupEnabled",
  "deliveryRadius", "createdAt", "updatedAt",
];

// Folded spellings that must never survive onto a row. Single-word columns like
// `name` or `status` are legitimately lower-case and so cannot be used here.
const BRANCH_FOLDED = [
  "addressline1", "addressline2", "postalcode", "openingtime", "closingtime",
  "deliveryenabled", "pickupenabled", "deliveryradius", "createdat", "updatedat",
  "onboarding_completed", "countryid", "stateid", "cityid",
];

const BRANCH_PRODUCT_KEYS = [
  "uuid", "branchId", "productId", "productUuid", "variantId", "sellingPrice",
  "compareAtPrice", "costPrice", "stockQuantity", "reservedQuantity",
  "availableQuantity", "lowStockThreshold", "isAvailable", "status",
  "createdAt", "updatedAt",
];

const BRANCH_PRODUCT_FOLDED = [
  "branchid", "productid", "productuuid", "variantid", "sellingprice",
  "compareatprice", "costprice", "stockquantity", "reservedquantity",
  "availablequantity", "lowstockthreshold", "isavailable", "createdat", "updatedat",
];

const TRANSFER_KEYS = [
  "uuid", "transferNumber", "sourceBranchId", "destinationBranchId", "status",
  "requestById", "approvedById", "receivedById", "reason", "createdAt", "updatedAt",
];

const TRANSFER_FOLDED = [
  "transfernumber", "sourcebranchid", "destinationbranchid", "requestbyid",
  "approvedbyid", "receivedbyid", "createdat", "updatedat",
];

const TRANSFER_ITEM_KEYS = [
  "uuid", "transferId", "productId", "productUuid", "variantId", "quantity",
  "previousStockSource", "previousStockDest", "createdAt",
];

const TRANSFER_ITEM_FOLDED = [
  "transferid", "productid", "productuuid", "variantid", "previousstocksource",
  "previousstockdest", "createdat",
];

function assertKeys(row, keys, what) {
  if (!row) throw new Error(`${what}: model returned no row`);
  const missing = keys.filter((k) => row[k] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `${what}: ${missing.join(", ")} undefined; got keys: ${Object.keys(row).join(", ")}`,
    );
  }
}

function assertNoFoldedLeaks(row, folded, what) {
  const leaked = folded.filter((k) => Object.hasOwn(row, k));
  if (leaked.length > 0) {
    throw new Error(`${what}: folded keys still on the row: ${leaked.join(", ")}`);
  }
}

// Runs `fn` with every model query funnelled through one connection that is
// wrapped in a transaction which is always rolled back. The models build their
// own pool in lib/db.js, so swapping its `query` is what lets the write paths
// (INSERT/UPDATE ... RETURNING) run against the live schema - which is where a
// wrong column name or a bad alias would actually blow up - while persisting
// nothing. The swap is undone in `finally`, and lib/db.js's `query` lives on
// pg.Pool.prototype, so deleting the own property restores it.
const modelPool = (await import("../lib/db.js")).default;
async function inRolledBackTransaction(fn) {
  const client = await pool.connect();
  const hadOwnQuery = Object.hasOwn(modelPool, "query");
  const previousQuery = modelPool.query;
  await client.query("BEGIN");
  modelPool.query = (sql, params) => client.query(sql, params);
  try {
    return await fn(client);
  } finally {
    delete modelPool.query;
    if (hadOwnQuery) modelPool.query = previousQuery;
    await client.query("ROLLBACK");
    client.release();
  }
}

verifyPhase1({
  name: "branch model rows are camelCase (findByUuid / getById / getWithStats)",
  run: async () => {
    const { rows } = await pool.query("SELECT uuid, id FROM branches ORDER BY createdat DESC LIMIT 1");
    if (!rows[0]) throw new Error("no branches in DB");

    const byUuid = await Branch.findByUuid(rows[0].uuid);
    assertKeys(byUuid, BRANCH_KEYS, "Branch.findByUuid");
    assertNoFoldedLeaks(byUuid, BRANCH_FOLDED, "Branch.findByUuid");

    const byId = await Branch.getById(rows[0].id);
    assertKeys(byId, BRANCH_KEYS, "Branch.getById");
    assertNoFoldedLeaks(byId, BRANCH_FOLDED, "Branch.getById");

    const withStats = await Branch.getWithStats(rows[0].uuid);
    assertKeys(
      withStats,
      [...BRANCH_KEYS, "productCount", "lowStockCount", "outOfStockCount", "totalOrders"],
      "Branch.getWithStats",
    );
  },
});

verifyPhase1({
  name: "branch list() rows are camelCase",
  run: async () => {
    const result = await Branch.list({ page: 1, limit: 5 });
    if (result.rows.length === 0) throw new Error("Branch.list returned no rows; nothing verified");
    for (const row of result.rows) {
      assertKeys(row, BRANCH_KEYS, "Branch.list row");
      assertNoFoldedLeaks(row, BRANCH_FOLDED, "Branch.list row");
    }
  },
});

verifyPhase1({
  name: "branchProduct model rows are camelCase (getByBranchProduct / getByBranchAndProductUuid)",
  run: async () => {
    const { rows } = await pool.query(
      "SELECT branchid, productid FROM branch_products ORDER BY id LIMIT 1",
    );
    if (!rows[0]) throw new Error("no branch_products in DB");

    const byIds = await BranchProduct.getByBranchProduct(rows[0].branchid, rows[0].productid);
    assertKeys(byIds, BRANCH_PRODUCT_KEYS, "BranchProduct.getByBranchProduct");
    assertNoFoldedLeaks(byIds, BRANCH_PRODUCT_FOLDED, "BranchProduct.getByBranchProduct");

    const { rows: byUuid } = await pool.query(
      "SELECT branchid, productuuid FROM branch_products WHERE productuuid IS NOT NULL ORDER BY id LIMIT 1",
    );
    if (!byUuid[0]) {
      throw new Error(
        "no branch_products row with a non-null productuuid; getByBranchAndProductUuid is unverified",
      );
    }
    const row = await BranchProduct.getByBranchAndProductUuid(byUuid[0].branchid, byUuid[0].productuuid);
    assertKeys(row, BRANCH_PRODUCT_KEYS, "BranchProduct.getByBranchAndProductUuid");
    assertNoFoldedLeaks(row, BRANCH_PRODUCT_FOLDED, "BranchProduct.getByBranchAndProductUuid");
  },
});

verifyPhase1({
  name: "branchProduct list queries expose camelCase branch and product keys",
  run: async () => {
    const { rows } = await pool.query(
      "SELECT DISTINCT branchid FROM branch_products ORDER BY branchid LIMIT 1",
    );
    if (!rows[0]) throw new Error("no branch_products in DB");
    // branch_products.branchid is a bigint, so the model takes the numeric id
    // here. The API route still passes the branch uuid; that is Task 8's wiring.
    const branchId = rows[0].branchid;

    const joined = [...BRANCH_PRODUCT_KEYS, "productName", "productSlug", "productImages",
      "globalPrice", "globalDiscountPrice", "globalInventoryMode"];

    const byBranch = await BranchProduct.getByBranch(branchId, { page: 1, limit: 5 });
    if (byBranch.rows.length === 0) {
      throw new Error("BranchProduct.getByBranch returned no rows; the products join matched nothing");
    }
    for (const row of byBranch.rows) {
      assertKeys(row, joined, "BranchProduct.getByBranch row");
      assertNoFoldedLeaks(row, BRANCH_PRODUCT_FOLDED, "BranchProduct.getByBranch row");
    }

    const forBranches = await BranchProduct.listForBranches([branchId], { page: 1, limit: 5 });
    if (forBranches.rows.length === 0) {
      throw new Error("BranchProduct.listForBranches returned no rows; nothing verified");
    }
    for (const row of forBranches.rows) {
      assertKeys(row, [...BRANCH_PRODUCT_KEYS, "productName", "productSlug", "productImages",
        "globalPrice", "globalDiscountPrice"], "BranchProduct.listForBranches row");
      assertNoFoldedLeaks(row, BRANCH_PRODUCT_FOLDED, "BranchProduct.listForBranches row");
    }
  },
});

// branch_stock_transfers and branch_transfer_items are empty on this database,
// so there is no committed row for the model to read. Instead the model's own
// column lists are run against a real inserted row inside a transaction that is
// always rolled back: that proves every column name resolves against the live
// schema and that the rows come back camelCase, without leaving anything behind.
verifyPhase1({
  name: "branchStockTransfer column aliases resolve and yield camelCase keys",
  run: async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: branches } = await client.query("SELECT id FROM branches ORDER BY id LIMIT 2");
      if (branches.length < 2) throw new Error("need at least 2 branches to build a transfer row");
      const { rows: products } = await client.query("SELECT id, uuid FROM products ORDER BY id LIMIT 1");
      if (!products[0]) throw new Error("no products in DB");

      const inserted = await client.query(
        `INSERT INTO branch_stock_transfers
           (transfernumber, sourcebranchid, destinationbranchid, status, reason)
         VALUES ('ST-VERIFY-PHASE1', $1, $2, 'REQUESTED', 'verify-phase1')
         RETURNING id AS "id"`,
        [branches[0].id, branches[1].id],
      );
      const transferId = inserted.rows[0].id;

      const selected = await client.query(
        `SELECT ${TRANSFER_COLUMNS} FROM branch_stock_transfers WHERE id = $1`,
        [transferId],
      );
      assertKeys(selected.rows[0], TRANSFER_KEYS, "branch_stock_transfers row");
      assertNoFoldedLeaks(selected.rows[0], TRANSFER_FOLDED, "branch_stock_transfers row");

      const updated = await client.query(
        `UPDATE branch_stock_transfers SET status = $1, updatedat = now() WHERE id = $2
         RETURNING ${TRANSFER_COLUMNS}`,
        ["APPROVED", transferId],
      );
      assertKeys(updated.rows[0], TRANSFER_KEYS, "branch_stock_transfers RETURNING row");
      assertNoFoldedLeaks(updated.rows[0], TRANSFER_FOLDED, "branch_stock_transfers RETURNING row");

      await client.query(
        `INSERT INTO branch_transfer_items
           (transferid, productid, productuuid, quantity, previousstocksource, previousstockdest)
         VALUES ($1, $2, $3, 5, 5, 5)`,
        [transferId, products[0].id, products[0].uuid],
      );
      const items = await client.query(
        `SELECT ${TRANSFER_ITEM_COLUMNS} FROM branch_transfer_items WHERE transferid = $1 ORDER BY createdat ASC`,
        [transferId],
      );
      assertKeys(items.rows[0], TRANSFER_ITEM_KEYS, "branch_transfer_items row");
      assertNoFoldedLeaks(items.rows[0], TRANSFER_ITEM_FOLDED, "branch_transfer_items row");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  },
});

// The write paths are the other half of the aliasing problem: `RETURNING <col>`
// comes back folded just as `SELECT <col>` does. Each of these runs the real
// model methods against the live database inside a rolled-back transaction, so
// a bad column name, a bad alias or a broken placeholder shows up here without
// writing anything.
verifyPhase1({
  name: "branch write paths return camelCase rows (create / update)",
  run: async () => {
    await inRolledBackTransaction(async () => {
      const created = await Branch.create({
        name: "verify-phase1 branch",
        code: `VP1-${process.pid}-${Date.now()}`,
        addressLine1: "1 Test Street",
        addressLine2: "Unit 2",
        postalCode: "99999",
        city: "Testville",
        deliveryRadius: 7,
        openingTime: "09:00",
        closingTime: "21:00",
      });
      assertKeys(created, BRANCH_KEYS, "Branch.create");
      assertNoFoldedLeaks(created, BRANCH_FOLDED, "Branch.create");
      if (created.addressLine1 !== "1 Test Street") {
        throw new Error(`Branch.create lost addressLine1: ${JSON.stringify(created.addressLine1)}`);
      }
      if (!created.uuid) throw new Error("Branch.create returned no uuid");

      const updated = await Branch.update(created.uuid, {
        name: "verify-phase1 branch renamed",
        addressLine1: "2 Test Street",
        deliveryRadius: 9,
      });
      assertKeys(updated, BRANCH_KEYS, "Branch.update");
      assertNoFoldedLeaks(updated, BRANCH_FOLDED, "Branch.update");
      if (updated.name !== "verify-phase1 branch renamed") {
        throw new Error(`Branch.update did not persist name: ${updated.name}`);
      }
      if (updated.addressLine1 !== "2 Test Street") {
        throw new Error(`Branch.update did not persist addressLine1: ${updated.addressLine1}`);
      }
      if (Number(updated.deliveryRadius) !== 9) {
        throw new Error(`Branch.update did not persist deliveryRadius: ${updated.deliveryRadius}`);
      }
    });
  },
});

verifyPhase1({
  name: "branchProduct write paths return camelCase rows (create / update / updateStock)",
  run: async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows: branches } = await client.query("SELECT id FROM branches ORDER BY id LIMIT 1");
      const { rows: products } = await client.query("SELECT id, uuid FROM products ORDER BY id LIMIT 1");
      if (!branches[0] || !products[0]) throw new Error("need a branch and a product to build a branch_product");

      const created = await BranchProduct.create({
        branchId: branches[0].id,
        productId: products[0].id,
        productUuid: products[0].uuid,
        sellingPrice: "19.99",
        stockQuantity: 10,
        lowStockThreshold: 3,
      });
      assertKeys(created, BRANCH_PRODUCT_KEYS, "BranchProduct.create");
      assertNoFoldedLeaks(created, BRANCH_PRODUCT_FOLDED, "BranchProduct.create");
      if (Number(created.sellingPrice) !== 19.99) {
        throw new Error(`BranchProduct.create lost sellingPrice: ${created.sellingPrice}`);
      }
      if (created.stockQuantity !== 10) {
        throw new Error(`BranchProduct.create lost stockQuantity: ${created.stockQuantity}`);
      }

      // The same call a second time has to take the ON CONFLICT branch.
      const upserted = await BranchProduct.create({
        branchId: branches[0].id,
        productId: products[0].id,
        sellingPrice: "21.50",
        stockQuantity: 12,
      });
      assertKeys(upserted, BRANCH_PRODUCT_KEYS, "BranchProduct.create (upsert)");
      if (Number(upserted.sellingPrice) !== 21.5) {
        throw new Error(`BranchProduct.create upsert lost sellingPrice: ${upserted.sellingPrice}`);
      }

      const updated = await BranchProduct.update(created.uuid, { costPrice: "7.25", status: "INACTIVE" });
      assertKeys(updated, BRANCH_PRODUCT_KEYS, "BranchProduct.update");
      assertNoFoldedLeaks(updated, BRANCH_PRODUCT_FOLDED, "BranchProduct.update");
      if (Number(updated.costPrice) !== 7.25) {
        throw new Error(`BranchProduct.update lost costPrice: ${updated.costPrice}`);
      }
      if (updated.status !== "INACTIVE") {
        throw new Error(`BranchProduct.update lost status: ${updated.status}`);
      }

      const restocked = await BranchProduct.updateStock(created.uuid, 3, "restock");
      if (!restocked) throw new Error("BranchProduct.updateStock returned null for a row it just wrote");
      // updateStock used to read bp.stockQuantity off a folded row, so
      // previousStock was undefined and newStock was NaN.
      if (restocked.previousStock !== 12) {
        throw new Error(`BranchProduct.updateStock mis-read previousStock: ${restocked.previousStock}`);
      }
      if (restocked.newStock !== 15 || restocked.actualChange !== 3) {
        throw new Error(
          `BranchProduct.updateStock maths wrong: newStock=${restocked.newStock} actualChange=${restocked.actualChange}`,
        );
      }
      assertKeys(restocked.branchProduct, BRANCH_PRODUCT_KEYS, "BranchProduct.updateStock");
      assertNoFoldedLeaks(restocked.branchProduct, BRANCH_PRODUCT_FOLDED, "BranchProduct.updateStock");
    });
  },
});

verifyPhase1({
  name: "branchStockTransfer write paths return camelCase rows (create / updateStatus / getItems)",
  run: async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows: branches } = await client.query("SELECT id FROM branches ORDER BY id LIMIT 2");
      const { rows: products } = await client.query("SELECT id, uuid FROM products ORDER BY id LIMIT 1");
      if (branches.length < 2) throw new Error("need at least 2 branches to build a transfer");
      if (!products[0]) throw new Error("no products in DB");

      const created = await BranchStockTransfer.create({
        sourceBranchId: branches[0].id,
        destinationBranchId: branches[1].id,
        reason: "verify-phase1",
        items: [{ productId: products[0].id, productUuid: products[0].uuid, quantity: 4 }],
      });
      assertKeys(created, TRANSFER_KEYS, "BranchStockTransfer.create");
      assertNoFoldedLeaks(created, TRANSFER_FOLDED, "BranchStockTransfer.create");
      if (!created.transferNumber) {
        throw new Error("BranchStockTransfer.create returned no transferNumber");
      }

      // updateStatus used to build $2/$3/$4 placeholders conditionally but always
      // passed four parameters, so the no-optional-argument call could not run.
      const approved = await BranchStockTransfer.updateStatus(created.uuid, "APPROVED");
      assertKeys(approved, TRANSFER_KEYS, "BranchStockTransfer.updateStatus (no optional args)");
      assertNoFoldedLeaks(approved, TRANSFER_FOLDED, "BranchStockTransfer.updateStatus (no optional args)");
      if (approved.status !== "APPROVED") {
        throw new Error(`BranchStockTransfer.updateStatus did not persist status: ${approved.status}`);
      }
      if (approved.approvedById !== null) {
        throw new Error(`BranchStockTransfer.updateStatus invented an approver: ${approved.approvedById}`);
      }

      const received = await BranchStockTransfer.updateStatus(created.uuid, "RECEIVED", 1, 1);
      assertKeys(received, TRANSFER_KEYS, "BranchStockTransfer.updateStatus (both optional args)");
      if (String(received.approvedById) !== "1" || String(received.receivedById) !== "1") {
        throw new Error(
          `BranchStockTransfer.updateStatus mis-bound the optional ids: ${received.approvedById}/${received.receivedById}`,
        );
      }

      const items = await BranchStockTransfer.getItems(created.id);
      if (items.length !== 1) {
        throw new Error(`BranchStockTransfer.getItems returned ${items.length} rows, expected 1`);
      }
      assertKeys(items[0], TRANSFER_ITEM_KEYS, "BranchStockTransfer.getItems row");
      assertNoFoldedLeaks(items[0], TRANSFER_ITEM_FOLDED, "BranchStockTransfer.getItems row");
      if (items[0].quantity !== 4) {
        throw new Error(`BranchStockTransfer.getItems lost quantity: ${items[0].quantity}`);
      }
    });
  },
});

// Task 4: 500-route repairs, proven over real HTTP against the dev server.
//
// The brief's original scenario fetched `/api/branches/nearby` anonymously and
// asserted 200. That cannot pass: every branches/** route still calls
// `authorize()`, which is `authenticate()` under a different name, so an
// anonymous request is answered 401 before the handler runs. These scenarios
// mint a JWT for an existing active user instead - the token is never printed,
// never written to a file, and never included in an error message.
//
// The dev server has to be up (`npm run dev` in backend/) or these fail with a
// connection error. That is deliberate: "does not 500" is only meaningful if the
// route actually answered.
const { apiUrl, apiGet } = await import("./lib/http.mjs");
const { createToken } = await import("../lib/auth.js");

let httpToken;
async function authToken() {
  if (httpToken) return httpToken;
  const { rows } = await pool.query(
    "SELECT id, email FROM users WHERE status = 'ACTIVE' ORDER BY id LIMIT 1",
  );
  if (!rows[0]) throw new Error("no ACTIVE user to authenticate the HTTP scenarios as");
  httpToken = await createToken(rows[0]);
  return httpToken;
}

async function httpGet(path, { authed = true } = {}) {
  const token = authed ? await authToken() : null;
  return await apiGet(apiUrl(path), token);
}

// A 500 here is the failure this task exists to remove; the body is included so
// the message says what the route said rather than just the status code.
async function expectNotServerError(label, res, allowed) {
  if (res.status === 500) {
    throw new Error(`${label} returned 500: ${JSON.stringify(res.data)}`);
  }
  if (allowed && !allowed.includes(res.status)) {
    throw new Error(`${label} returned ${res.status}, expected one of ${allowed.join("/")}: ${JSON.stringify(res.data)}`);
  }
  return res;
}

const { rows: httpBranches } = await pool.query(
  "SELECT uuid, latitude, longitude, postalcode FROM branches WHERE status = 'ACTIVE' ORDER BY id",
);
if (httpBranches.length === 0) throw new Error("no ACTIVE branch rows; HTTP scenarios cannot run");
const HTTP_BRANCH = httpBranches[0];

// Branch-code prefix for the `nearby` scenario's coordinate fixtures. Constant
// on purpose - see the comment inside that scenario.
const NEARBY_MARKER = "VP1-NEARBY";

verifyPhase1({
  name: "nearby returns 200 and puts the in-radius branch in the result",
  run: async () => {
    // Every seeded branch has null latitude/longitude, so an in-radius branch has
    // to be created for the radius filter to be exercised at all.
    //
    // The marker is a CONSTANT, not `${process.pid}`. A pid-scoped marker makes
    // the defensive pre-cleanup useless across restarts (a new process has a new
    // pid and can never match a previous run's residue), so an aborted run would
    // leave two ACTIVE, delivery-enabled phantom branches in a customer-facing
    // table - served by GET /api/branches and GET /api/branches/nearby, and
    // liable to be picked as the dedupe fixture's `otherBranch` below. The
    // constant prefix also sweeps residue left by the *old* pid-scoped marker,
    // so upgrading this scenario cleans up after the previous version too.
    const code = NEARBY_MARKER;
    await pool.query("DELETE FROM branches WHERE code LIKE $1", [`${code}%`]);

    let uuid;
    try {
      // ~11km north of the query point, inside the 50km radius; and a second
      // branch far outside it, which must not come back. `code` is UNIQUE, so
      // each fixture needs its own value.
      const fixtures = [
        ["verify-phase1 nearby in-radius", `${code}-IN`, 19.17, 72.8777, "400001"],
        ["verify-phase1 nearby out-of-radius", `${code}-OUT`, 21.17, 72.8777, "499999"],
      ];
      for (const [name, fixtureCode, latitude, longitude, postalcode] of fixtures) {
        const inserted = await pool.query(
          `INSERT INTO branches
             (name, code, latitude, longitude, postalcode, status, deliveryenabled, pickupenabled)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', TRUE, TRUE)
           RETURNING uuid`,
          [name, fixtureCode, latitude, longitude, postalcode],
        );
        if (name.endsWith("in-radius")) uuid = inserted.rows[0].uuid;
      }
      if (!uuid) throw new Error("the in-radius nearby fixture was not created");

      const res = await httpGet("/api/branches/nearby?lat=19.0760&lng=72.8777&radius=50");
      if (res.status !== 200) {
        throw new Error("nearby status " + res.status + " -> " + JSON.stringify(res.data));
      }
      if (!Array.isArray(res.data?.branches)) {
        throw new Error(`nearby returned no branches array: ${JSON.stringify(res.data)}`);
      }

      // The radius filter moved from a HAVING (which Postgres rejects over
      // ungrouped rows) into a WHERE over a derived table, so a branch inside
      // the radius has to come back with a numeric distance_km.
      const hit = res.data.branches.find((b) => b.uuid === uuid);
      if (!hit) throw new Error(`nearby dropped the in-radius branch ${uuid}`);
      if (typeof hit.distance_km !== "number" || Number.isNaN(hit.distance_km)) {
        throw new Error(`nearby returned a non-numeric distance_km: ${JSON.stringify(hit.distance_km)}`);
      }
      if (hit.distance_km <= 0 || hit.distance_km > 50) {
        throw new Error(`nearby reported ${hit.distance_km}km for a branch ~11km away, radius 50`);
      }

      const outOfRadius = res.data.branches.find((b) => b.name?.includes("out-of-radius"));
      if (outOfRadius) {
        throw new Error(`nearby returned an out-of-radius branch at ${outOfRadius.distance_km}km`);
      }

      // The bind order is [lat, lng, maxLat, maxLng, radius, limit]; a narrower
      // radius has to drop the ~11km branch rather than return it regardless.
      const tight = await httpGet("/api/branches/nearby?lat=19.0760&lng=72.8777&radius=1");
      if (tight.status !== 200) throw new Error(`nearby (radius=1) status ${tight.status}`);
      if (tight.data.branches.some((b) => b.uuid === uuid)) {
        throw new Error("nearby ignored the radius parameter and returned an 11km branch for radius=1");
      }
    } finally {
      await pool.query("DELETE FROM branches WHERE code LIKE $1", [`${code}%`]);
    }
  },
});

verifyPhase1({
  name: "nearby still short-circuits without lat/lng instead of scanning",
  run: async () => {
    const res = await httpGet("/api/branches/nearby");
    if (res.status !== 200) throw new Error(`nearby (no coords) status ${res.status}`);
    if (res.data?.branches?.length !== 0) {
      throw new Error("nearby without lat/lng should return an empty list");
    }
  },
});

verifyPhase1({
  name: "GET /api/branches/:uuid returns 200 with stats",
  run: async () => {
    // This route called Branch.getWithStats() without importing Branch, so every
    // request was a ReferenceError -> 500.
    const res = await expectNotServerError(
      "GET /api/branches/:uuid",
      await httpGet(`/api/branches/${HTTP_BRANCH.uuid}`),
      [200],
    );
    for (const key of ["uuid", "name", "addressLine1", "deliveryEnabled", "productCount", "totalOrders"]) {
      if (res.data?.branch?.[key] === undefined) {
        throw new Error(`branch payload is missing ${key}: ${Object.keys(res.data?.branch ?? {}).join(", ")}`);
      }
    }
  },
});

verifyPhase1({
  name: "GET /api/branches/:uuid/products returns 200 for the bigint branch id",
  run: async () => {
    // The route passed the branch uuid to BranchProduct.getByBranch, which
    // filters bp.branchid = $1 (a bigint) - 22P02 invalid input syntax.
    const res = await expectNotServerError(
      "GET /api/branches/:uuid/products",
      await httpGet(`/api/branches/${HTTP_BRANCH.uuid}/products?page=1&limit=5`),
      [200],
    );
    if (!Array.isArray(res.data?.products)) {
      throw new Error(`no products array: ${JSON.stringify(res.data)}`);
    }
    // With a real bigint the join can match, so every row must be one of this
    // branch's own listings rather than an empty page.
    const { rows: owned } = await pool.query(
      `SELECT bp.uuid FROM branch_products bp WHERE bp.branchid = (SELECT id FROM branches WHERE uuid = $1)`,
      [HTTP_BRANCH.uuid],
    );
    if (owned.length > 0 && res.data.products.length === 0) {
      throw new Error(
        `${owned.length} branch_products rows belong to this branch but the route returned none`,
      );
    }
  },
});

verifyPhase1({
  name: "GET /api/branches/:uuid/products tolerates a search term and the legacy status param",
  run: async () => {
    // The status filter is gone from the handler (getByBranch never accepted
    // one), so passing it must not change the result or blow up.
    const plain = await httpGet(`/api/branches/${HTTP_BRANCH.uuid}/products?page=1&limit=5`);
    const withStatus = await httpGet(
      `/api/branches/${HTTP_BRANCH.uuid}/products?page=1&limit=5&status=ACTIVE&search=rice`,
    );
    await expectNotServerError("GET products?search=", withStatus, [200]);
    if (withStatus.data?.pagination?.total > plain.data?.pagination?.total) {
      throw new Error("adding a search term widened the result set");
    }
  },
});

verifyPhase1({
  name: "PATCH /api/branches/:uuid/orders refuses an order from another branch",
  run: async () => {
    // The route used to call Order.update(<branch uuid>), so it could never find
    // an order. It now resolves the branch and updates by order identity, with
    // the branch as an ownership guard. Picking an order that belongs to a
    // *different* branch proves the guard fires and writes nothing.
    const { rows: foreign } = await pool.query(
      `SELECT o.order_number
         FROM orders o
        WHERE o.branchid IS NOT NULL
          AND o.branchid <> (SELECT id FROM branches WHERE uuid = $1)
        LIMIT 1`,
      [HTTP_BRANCH.uuid],
    );
    if (!foreign[0]) {
      throw new Error("no order belongs to a different branch; the ownership guard is unverified");
    }
    const { jsonPatch } = await import("./lib/http.mjs");
    const res = await jsonPatch(
      apiUrl(`/api/branches/${HTTP_BRANCH.uuid}/orders`),
      { orderNumber: foreign[0].order_number, status: "CONFIRMED" },
      await authToken(),
    );
    if (res.status === 500) throw new Error(`orders PATCH returned 500: ${JSON.stringify(res.data)}`);
    if (res.status !== 404) {
      throw new Error(
        `orders PATCH returned ${res.status} for an order owned by another branch, expected 404: ${JSON.stringify(res.data)}`,
      );
    }
  },
});

verifyPhase1({
  name: "PATCH /api/branches/:uuid/orders requires an order identity in the body",
  run: async () => {
    const { jsonPatch } = await import("./lib/http.mjs");
    const res = await jsonPatch(
      apiUrl(`/api/branches/${HTTP_BRANCH.uuid}/orders`),
      { status: "CONFIRMED" },
      await authToken(),
    );
    if (res.status === 500) throw new Error(`orders PATCH returned 500: ${JSON.stringify(res.data)}`);
    if (res.status !== 400) {
      throw new Error(`orders PATCH with no order identity returned ${res.status}, expected 400`);
    }
  },
});

verifyPhase1({
  name: "Order.updateByNumber updates by order identity inside the branch",
  run: async () => {
    // The HTTP scenarios above can only assert the *refusals* without writing to
    // live data. This is the other half: the real UPDATE, the real RETURNING
    // and the real order_status_history insert, all inside a transaction that
    // is always rolled back, so the statement is proven against the live schema
    // and nothing is persisted.
    const { Order } = await import("../lib/models/order.js");
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT o.order_number, o.branchid, o.status, o.uuid
           FROM orders o
          WHERE o.branchid IS NOT NULL
          ORDER BY o.id DESC LIMIT 1`,
      );
      if (!rows[0]) throw new Error("no order with a branch; updateByNumber is unverified");
      const order = rows[0];
      const next = order.status === "PROCESSING" ? "PACKED" : "PROCESSING";

      const updated = await Order.updateByNumber(order.order_number, {
        status: next,
        branchId: order.branchid,
      });
      assertKeys(updated, ["uuid", "order_number", "status", "branchid", "customer_name"], "Order.updateByNumber");
      if (updated.order_number !== order.order_number) {
        throw new Error(`updateByNumber moved the wrong order: ${updated.order_number}`);
      }
      if (updated.status !== next) {
        throw new Error(`updateByNumber did not persist status: ${updated.status}`);
      }

      // The wrong branch must not match, which is the whole point of the guard.
      const wrongBranch = await Order.updateByNumber(order.order_number, {
        status: next,
        branchId: Number(order.branchid) + 99999,
      });
      if (wrongBranch !== null) {
        throw new Error("updateByNumber updated an order across branches");
      }

      const history = await client.query(
        "SELECT status FROM order_status_history WHERE order_id = (SELECT id FROM orders WHERE order_number = $1)",
        [order.order_number],
      );
      if (history.rows.length === 0) {
        throw new Error("updateByNumber wrote no order_status_history row");
      }
    });
  },
});

verifyPhase1({
  name: "GET /api/store/products returns 200 with a pincode and with lat/lng",
  run: async () => {
    // Both 500'd: `branches b` collided with the `brands b` already in the
    // select list (42712), and the bounding box was `$1 - $3` on untyped
    // parameters (42725 operator is not unique).
    const pincode = httpBranches.find((b) => b.postalcode)?.postalcode;
    const cases = [
      ["plain", "/api/store/products?limit=5", { authed: false }],
      ["branchId", `/api/store/products?limit=5&branchId=${HTTP_BRANCH.uuid}`, { authed: false }],
      ["pincode", `/api/store/products?limit=5&pincode=${pincode || "400001"}`, { authed: false }],
      ["lat/lng", "/api/store/products?limit=5&lat=19.0760&lng=72.8777", { authed: false }],
      ["pincode+lat/lng", `/api/store/products?limit=5&pincode=${pincode || "400001"}&lat=19.0760&lng=72.8777`, { authed: false }],
      ["search+pincode+lat/lng", `/api/store/products?limit=5&search=a&pincode=${pincode || "400001"}&lat=19.0760&lng=72.8777`, { authed: false }],
    ];
    for (const [label, path, opts] of cases) {
      const res = await expectNotServerError(`GET ${label}`, await httpGet(path, opts), [200]);
      if (!Array.isArray(res.data?.products)) {
        throw new Error(`${label} returned no products array: ${JSON.stringify(res.data)}`);
      }
      if (typeof res.data?.pagination?.total !== "number") {
        throw new Error(`${label} returned no pagination.total`);
      }
    }

    // A status of 200 is not proof the filter ran: the route's catch block turns
    // any scoped-query error into a 200 with the unfiltered catalog. These two
    // invariants are what make the scenario falsifiable for a filter reason.
    //
    // A scoped catalog can never be larger than the unfiltered one.
    const unfiltered = await httpGet("/api/store/products?limit=24", { authed: false });
    const unfilteredTotal = unfiltered.data.pagination.total;
    for (const pin of [pincode || "400001", "999999"]) {
      const scopedRes = await httpGet(`/api/store/products?limit=24&pincode=${pin}`, { authed: false });
      if (scopedRes.data.pagination.total > unfilteredTotal) {
        throw new Error(
          `pincode=${pin} returned ${scopedRes.data.pagination.total} products, more than the unfiltered ${unfilteredTotal}`,
        );
      }
    }

    // When the route is not falling back, a scoped response carries a branch
    // listing on every product (bp.id IS NOT NULL). If the scoped query had
    // failed and fallen back, products with no listing anywhere would appear -
    // which is exactly the bug this assertion exists to catch, and the reason
    // "200" alone was vacuous for this route.
    const knownPin = await httpGet(
      `/api/store/products?limit=24&pincode=${pincode || "400001"}`,
      { authed: false },
    );
    if (knownPin.data.products.length > 0) {
      for (const p of knownPin.data.products) {
        if (!p.branch) {
          throw new Error(
            `pincode-scoped catalog returned ${p.uuid} with no branch listing; the scoped query probably fell back`,
          );
        }
      }
    }
  },
});

// The store catalog has to stay deduped no matter how many branches list the
// same product, but no product in this database is listed at more than one
// branch, so the duplicate has to be manufactured to make the assertion mean
// anything. The extra row is tagged in `variantid` and removed in a `finally`;
// a cleanup also runs first, so a run that was killed mid-scenario cannot poison
// the next one. This is the only scenario that writes outside a rolled-back
// transaction, and it writes one row that never outlives the scenario.
const DEDUPE_MARKER = "__verify_phase1_dedupe__";

verifyPhase1({
  name: "GET /api/store/products is deduped and carries branch pricing",
  run: async () => {
    await pool.query("DELETE FROM branch_products WHERE variantid = $1", [DEDUPE_MARKER]);

    let inserted = null;
    try {
      // A product that is already listed and available at one branch, plus a
      // second branch to list it at: without the LATERAL this product comes
      // back twice.
      const { rows: target } = await pool.query(
        `SELECT bp.productid, bp.branchid
           FROM branch_products bp
          WHERE bp.isavailable = TRUE
            AND bp.status = 'ACTIVE'
            AND EXISTS (SELECT 1 FROM branches o WHERE o.id <> bp.branchid)
          ORDER BY bp.id LIMIT 1`,
      );
      if (!target[0]) {
        throw new Error("no available branch_products row to duplicate; the dedupe guard is unverified");
      }
      // The second branch must NOT already list this product. The insert below
      // upserts on (branchid, productid), so a candidate that already had a row
      // would have its real variantid overwritten and an inactive/unavailable
      // listing silently re-published to the storefront - and the `finally`
      // would then delete the real row. NOT EXISTS makes that impossible, and a
      // dataset with no safe pair fails loudly instead of destroying data.
      const { rows: otherBranch } = await pool.query(
        `SELECT b.id
           FROM branches b
          WHERE b.status = 'ACTIVE'
            AND b.id <> $1
            AND NOT EXISTS (SELECT 1 FROM branch_products x
                             WHERE x.branchid = b.id AND x.productid = $2)
          ORDER BY b.id LIMIT 1`,
        [target[0].branchid, target[0].productid],
      );
      if (!otherBranch[0]) {
        throw new Error(
          "no ACTIVE branch that does not already list this product; refusing to upsert over a live row",
        );
      }

      // Plain INSERT, no ON CONFLICT: the NOT EXISTS above means this cannot
      // collide, and an upsert here would be able to overwrite real data.
      const ins = await pool.query(
        `INSERT INTO branch_products
           (branchid, productid, variantid, sellingprice, stockquantity, isavailable, status)
         VALUES ($1, $2, $3, 1, 1, TRUE, 'ACTIVE')
         RETURNING id`,
        [otherBranch[0].id, target[0].productid, DEDUPE_MARKER],
      );
      inserted = ins.rows[0].id;

      const res = await httpGet("/api/store/products?limit=24", { authed: false });
      if (res.status !== 200) throw new Error(`store/products returned ${res.status}`);

      const seen = new Set();
      for (const p of res.data.products) {
        if (seen.has(p.uuid)) {
          throw new Error(`the branch_products join duplicated product ${p.uuid}`);
        }
        seen.add(p.uuid);
      }
      if (res.data.products.length !== res.data.pagination.total && res.data.products.length < 24) {
        throw new Error(
          `returned ${res.data.products.length} rows for a total of ${res.data.pagination.total} without hitting the limit`,
        );
      }
      // bp.* aliases were unquoted, so Postgres folded them and `branch` was
      // always null; a product listed at a branch must now surface its listing.
      const listed = res.data.products.find((p) => p.branch);
      if (!listed) {
        throw new Error(
          `no product carried a branch listing; bp.uuid alias is still folding (keys: ${Object.keys(res.data.products[0] ?? {}).join(", ")})`,
        );
      }
      for (const key of ["uuid", "branchPrice", "compareAtPrice", "stock", "isAvailable", "status", "lowStockThreshold"]) {
        if (listed.branch[key] === undefined) {
          throw new Error(`branch listing is missing ${key}: ${JSON.stringify(listed.branch)}`);
        }
      }
    } finally {
      // Delete by primary key so the cleanup provably cannot touch a row this
      // scenario did not insert, then sweep the marker for a run that died
      // between the INSERT and this block.
      if (inserted != null) {
        await pool.query("DELETE FROM branch_products WHERE id = $1", [inserted]);
      }
      await pool.query("DELETE FROM branch_products WHERE variantid = $1", [DEDUPE_MARKER]);
    }
  },
});

verifyPhase1({
  name: "GET /api/store/products pinned to a branch returns only that branch's listings",
  run: async () => {
    const { rows: owned } = await pool.query(
      `SELECT count(*)::int AS count FROM branch_products bp
        WHERE bp.branchid = (SELECT id FROM branches WHERE uuid = $1)
          AND bp.isavailable = TRUE AND bp.status = 'ACTIVE'`,
      [HTTP_BRANCH.uuid],
    );
    const res = await httpGet(`/api/store/products?limit=24&branchId=${HTTP_BRANCH.uuid}`, { authed: false });
    if (res.status !== 200) throw new Error(`store/products?branchId returned ${res.status}`);
    if (res.data.pagination.total !== owned[0].count) {
      throw new Error(
        `branchId catalog returned ${res.data.pagination.total} products, expected ${owned[0].count}`,
      );
    }
    for (const p of res.data.products) {
      if (!p.branch) throw new Error(`branch-scoped catalog returned ${p.uuid} with no branch listing`);
    }
  },
});

verifyPhase1({
  name: "the store catalog's pincode and radius predicates select the serving branch",
  run: async () => {
    // The HTTP scenarios prove the location query does not 500; they cannot prove
    // it *selects* anything, because a filter that always matched nothing would
    // also answer 200. This scenario runs the route's own predicate builder -
    // imported from lib/storeCatalogScope.js, which app/api/store/products/route.js
    // calls, so there is no hand-copied SQL here to drift from the route. The
    // branch is given coordinates inside a transaction that is always rolled back.
    const { buildBranchScope } = await import("../lib/storeCatalogScope.js");

    await inRolledBackTransaction(async (client) => {
      const { rows: target } = await client.query(
        `SELECT bp.branchid
           FROM branch_products bp
          WHERE bp.isavailable = TRUE AND bp.status = 'ACTIVE'
          ORDER BY bp.id LIMIT 1`,
      );
      if (!target[0]) throw new Error("no available branch_products row to scope the catalog to");
      const branchId = target[0].branchid;

      await client.query(
        "UPDATE branches SET latitude = $1, longitude = $2, postalcode = $3, status = 'ACTIVE', deliveryenabled = TRUE WHERE id = $4",
        [19.17, 72.8777, "400001", branchId],
      );

      // Runs the route's predicate against the live schema, parameterised exactly
      // as the route parameterises it.
      async function countWithScope(input) {
        const params = [];
        const { conditions, scoped } = buildBranchScope({ ...input, params });
        if (!scoped) throw new Error("buildBranchScope produced no condition for a scoped request");
        const { rows } = await client.query(
          `SELECT count(*)::int AS count
             FROM branch_products bp
            WHERE bp.isavailable = TRUE
              AND bp.status = 'ACTIVE'
              AND ${conditions.join(" AND ")}`,
          params,
        );
        return rows[0].count;
      }

      if ((await countWithScope({ pincode: "400001" })) === 0) {
        throw new Error("the pincode predicate matched no listing for the branch that serves 400001");
      }
      if ((await countWithScope({ pincode: "999999" })) !== 0) {
        throw new Error("the pincode predicate matched a branch that does not serve the pincode");
      }

      // The radius predicate. The ::numeric casts in the builder are load-bearing:
      // node-postgres sends a JS number untyped, so `$1 - $3` alone is
      // "unknown - unknown" and Postgres rejects it with 42725.
      if ((await countWithScope({ lat: 19.076, lng: 72.8777 })) === 0) {
        throw new Error("the radius predicate excluded a branch ~11km from the query point");
      }
      // A lat/lng pair ~230km away must be excluded by the same predicate.
      if ((await countWithScope({ lat: 21.17, lng: 72.8777 })) !== 0) {
        throw new Error("the radius predicate included a branch ~230km away for a 50km radius");
      }

      // An unscoped request must produce no conditions at all, so the route can
      // tell "no location given" from "location given but nothing matched" - that
      // distinction is what makes the fallback reachable.
      const none = buildBranchScope({ params: [] });
      if (none.scoped || none.conditions.length !== 0) {
        throw new Error(
          `buildBranchScope claimed a scope with no location input: ${JSON.stringify(none)}`,
        );
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Task 6: the throwaway store account.
//
// The permission scenarios need a user who is deliberately NOT allowed to touch
// the admin branch routes, and no such user exists: the seed creates every user
// with an admin-side role. The only way to get one is to register a real store
// account through POST /api/auth/store/register, which is the production path -
// it mints a `store` role, a branch and a branch_users link, and it is the only
// way to obtain a genuinely under-privileged token without writing roles by hand.
//
// The token is never printed, never written to a file and never included in an
// error message.
//
// CLEANUP DISCIPLINE (the deferred minor from Task 1 plus Task 4's rule):
//   * report() abandons a timed-out scenario, it does not cancel it, so a
//     scenario hung on something other than fetch keeps running and can interleave
//     its side effects with a later run. Every cleanup below is therefore
//     idempotent and keyed on a CONSTANT marker, never on ${process.pid}: a
//     pid-scoped marker cannot match a previous run's residue, which is exactly
//     how phantom branches get left behind in a customer-facing table.
//   * the sweep runs BEFORE the register as well as in the `finally`, so a run
//     that was killed between the POST and the finally does not poison the next
//     one.
//   * nothing is swept on a predicate that could match a real row. The marker is
//     an email prefix and a branch-code prefix that no human would use; a test
//     that ever fails to register still finds nothing to delete and says so.
//   * branches.code is UNIQUE, so the pre-cleanup delete needs a prefix rather
//     than an exact value to be able to clear residue from a prior run whose
//     timestamped suffix differs.
// ---------------------------------------------------------------------------

const STORE_EMAIL_PREFIX = "verify-p1-store@";
const STORE_CODE_PREFIX = "VP1STORE";
const { jsonPost } = await import("./lib/http.mjs");

let TEST_STORE = null;

// Deletes every row the fixture can create, in one pass, whether or not this
// process is the one that created it. Returns a list of problems instead of
// throwing, so one bad statement cannot abort the rest and leave the fixture
// half-deleted behind it.
//
// Order matters, though the deletes are belt-and-braces: branch_users and
// user_has_roles both cascade from users, so they are not load-bearing today - but
// only the branches table records the fixture's email, and if the users cascade
// ever went away this ordering is what would still clean up correctly.
async function sweepStoreRows() {
  const problems = [];
  for (const sql of [
    "DELETE FROM branch_users WHERE userid IN (SELECT id FROM users WHERE email LIKE $1)",
    "DELETE FROM user_has_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)",
    "DELETE FROM user_has_permissions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)",
    "DELETE FROM users WHERE email LIKE $1",
    "DELETE FROM branches WHERE code LIKE $1 OR email LIKE $1",
  ]) {
    try {
      await pool.query(sql, [`${STORE_EMAIL_PREFIX}%`]);
    } catch (e) {
      problems.push(`${sql.slice(7, sql.indexOf(" FROM"))}: ${e.message}`);
    }
  }
  return problems;
}

// Counts whatever the marker still matches. Both predicates have to be zero
// before or after this file touches anything.
async function storeFixtureResidue() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM users WHERE email LIKE $1) AS users,
            (SELECT count(*) FROM branches WHERE code LIKE $1 OR email LIKE $1) AS branches`,
    [`${STORE_EMAIL_PREFIX}%`],
  );
  return { users: Number(rows[0].users), branches: Number(rows[0].branches) };
}

export async function storeToken() {
  if (TEST_STORE) return TEST_STORE.token;

  // Sweep before registering, not just after: a run that was killed between the
  // POST and its `finally` leaves rows behind, and those rows carry a timestamped
  // suffix that no exact-match delete could ever find again.
  const problems = await sweepStoreRows();
  if (problems.length) {
    throw new Error(`store fixture pre-cleanup failed: ${problems.join("; ")}`);
  }
  const before = await storeFixtureResidue();
  if (before.users !== 0 || before.branches !== 0) {
    // Better to say this than to let the register 409 on a duplicate email and
    // report that much less obvious error instead.
    throw new Error(
      `store fixture pre-cleanup left residue behind: ${JSON.stringify(before)}`,
    );
  }

  const email = `${STORE_EMAIL_PREFIX}${Date.now()}@earth.local`;
  const reg = await jsonPost(apiUrl("/api/auth/store/register"), {
    name: "Phase1 Verify Store",
    email,
    password: "VerifyPass123!",
    branchName: "Phase1 Verify Branch",
    branchCode: `${STORE_CODE_PREFIX}${Date.now().toString().slice(-6)}`,
    city: "Mumbai",
    address: "1 Test Lane",
    phone: "9876543210",
  });
  if (reg.status !== 201) {
    throw new Error(`store register returned ${reg.status}: ${JSON.stringify(reg.data)}`);
  }
  const userUuid = reg.data?.user?.uuid;
  const branchUuid = reg.data?.branch?.uuid;
  if (!reg.data?.token || !userUuid || !branchUuid) {
    throw new Error(
      `store register returned 201 but no token/user.uuid/branch.uuid: keys=${JSON.stringify(Object.keys(reg.data ?? {}))}`,
    );
  }
  TEST_STORE = { token: reg.data.token, userUuid, branchUuid, email };
  return TEST_STORE.token;
}

export async function cleanupStoreAccount() {
  // Deliberately NOT guarded by `if (!TEST_STORE) return`. That guard assumes
  // the happy path ran, and the happy path is exactly what does not happen when a
  // scenario is abandoned: report() races the run against a 60s timer and lets
  // the loser keep going, so a scenario hung on something other than fetch can
  // create these rows without ever assigning TEST_STORE, or can be re-entered
  // while another caller is already cleaning. Sweeping by the constant marker is
  // correct in all of those cases and a no-op when there is nothing to remove.
  const problems = await sweepStoreRows();
  TEST_STORE = null;
  return problems;
}

// The seeded users never change, so a token per role slug is memoised rather
// than re-minted per call. `super_admin` and `manager` already exist; the two
// throwaways below are only ever created if some future task asks for a role
// that no seeded user carries.
const ROLE_TOKENS = new Map();
async function tokenForRole(slug) {
  if (ROLE_TOKENS.has(slug)) return ROLE_TOKENS.get(slug);
  const { rows } = await pool.query(
    `SELECT u.id, u.email
       FROM users u
       JOIN user_has_roles uhr ON uhr.user_id = u.id
       JOIN roles r ON r.id = uhr.role_id
      WHERE r.slug = $1 AND r.status = 'ACTIVE' AND u.status = 'ACTIVE'
      ORDER BY u.id LIMIT 1`,
    [slug],
  );
  if (!rows[0]) throw new Error(`no ACTIVE user carries the ${slug} role`);
  const { createToken: createTokenForUser } = await import("../lib/auth.js");
  const token = await createTokenForUser(rows[0]);
  ROLE_TOKENS.set(slug, token);
  return token;
}

// The denials below all answer 401 before they answer 403, because
// authenticate() runs first and 401 is what it returns. Pinning that is the
// point: if a future refactor checks permissions before the token, a "not
// logged in" request would start reporting 403 and every negative case here
// would silently stop testing the permission check at all.
const DENIAL_MESSAGE = "You do not have permission to perform this action";

verifyPhase1({
  name: "store user gets 403 on admin branch route",
  run: async () => {
    const t = await storeToken();
    const me = await apiGet(apiUrl("/api/auth/me"), t);
    if (!me.data?.user?.branches?.length) {
      throw new Error(`store user has no branches: ${JSON.stringify(me.data)}`);
    }
    const mine = me.data.user.branches.map((b) => b.uuid);
    const otherRes = await pool.query(
      "SELECT uuid FROM branches WHERE uuid <> ALL($1::uuid[]) AND status = 'ACTIVE' LIMIT 1",
      [mine],
    );
    if (!otherRes.rows[0]) {
      throw new Error("need one branch not owned by the test store");
    }
    const r = await apiGet(
      apiUrl(`/api/branches/${otherRes.rows[0].uuid}/products`),
      t,
    );
    if (r.status !== 403) {
      throw new Error(
        `expected 403 for a store token on an admin branch route, got ${r.status}: ${JSON.stringify(r.data)}`,
      );
    }
    if (r.data?.message !== DENIAL_MESSAGE) {
      throw new Error(`403 body is not the permission refusal: ${JSON.stringify(r.data)}`);
    }
  },
});

verifyPhase1({
  name: "authorize() denies a role that lacks the permission and admits one that has it",
  run: async () => {
    // `manager` holds branches.view / branches.create / branches.update /
    // branches.delete / branches.orders.view / dashboard.view, and holds NONE of
    // branches.inventory.*, branches.orders.update or branches.price.*. One token
    // is therefore enough to show both halves of the decision, on routes inside
    // the same permission family - and both halves have to be here, because a
    // negative case alone would also pass if authorize() had been rewritten to
    // refuse everybody.
    const manager = await tokenForRole("manager");
    const store = await storeToken();
    //
    // Two of the five are PATCHes, because proving a *write* is refused before the
    // handler runs is worth more than proving another read is refused. Their
    // bodies are empty on purpose: PATCH /api/branches/:uuid/products resolves
    // productUuid through the products table and answers 404 without writing a
    // branch_products row, and Task 4 already pinned PATCH
    // /api/branches/:uuid/orders with an empty body at 400. So if a future grant
    // ever handed either permission to manager, these fail with a 4xx and leave
    // nothing behind - a negative test that can half-succeed and write a fixture
    // row is worse than no test at all.
    //
    // (PATCH/DELETE /api/branches is the more obvious thing to reach for, but
    // those handlers `await params` on a binding they never destructure, so they
    // answer 500 before and after this task. Pre-existing, in that route, and not
    // something this scenario should trip over.)
    //
    // The full list of what each role holds is asserted rather than assumed, so a
    // seed or grant change that moves these slugs fails with "the fixture is
    // wrong" instead of a confusing 403-vs-200.
    const { rows: held } = await pool.query(
      `SELECT p.slug FROM roles r
         JOIN role_has_permissions rhp ON rhp.role_id = r.id
         JOIN permissions p ON p.id = rhp.permission_id
        WHERE r.slug = 'manager'`,
    );
    const managerSlugs = new Set(held.map((r) => r.slug));
    for (const slug of ["branches.view", "branches.orders.view"]) {
      if (!managerSlugs.has(slug)) {
        throw new Error(`the fixture assumes manager holds ${slug}, but it does not`);
      }
    }
    for (const slug of [
      "branches.inventory.view",
      "branches.inventory.update",
      "branches.orders.update",
    ]) {
      if (managerSlugs.has(slug)) {
        throw new Error(`the fixture assumes manager lacks ${slug}, but it holds it`);
      }
    }

    const cases = [
      { label: "branches.view", path: "/api/branches", allowed: true },
      { label: "branches.orders.view", path: `/api/branches/${HTTP_BRANCH.uuid}/orders`, allowed: true },
      { label: "branches.inventory.view", path: `/api/branches/${HTTP_BRANCH.uuid}/inventory`, allowed: false },
      { label: "branches.inventory.update", path: `/api/branches/${HTTP_BRANCH.uuid}/products`, method: "PATCH", allowed: false },
      { label: "branches.orders.update", path: `/api/branches/${HTTP_BRANCH.uuid}/orders`, method: "PATCH", allowed: false },
    ];

    for (const c of cases) {
      const { apiGet: get, jsonPatch: patch } = await import("./lib/http.mjs");
      const res =
        c.method === "PATCH"
          ? await patch(apiUrl(c.path), c.body ?? {}, manager)
          : await get(apiUrl(c.path), manager);
      if (c.allowed) {
        if (res.status !== 200) {
          throw new Error(`${c.label}: expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        }
        continue;
      }
      if (res.status !== 403) {
        throw new Error(`${c.label}: expected 403, got ${res.status}: ${JSON.stringify(res.data)}`);
      }
      if (res.data?.message !== DENIAL_MESSAGE) {
        throw new Error(`${c.label}: 403 body is not the permission refusal: ${JSON.stringify(res.data)}`);
      }
    }

    // The store token is the second half of the pair from the other end: it
    // holds no branches.* permission at all, so the same GET /api/branches the
    // manager was just admitted has to be refused for it.
    const admitted = await apiGet(apiUrl("/api/branches"), store);
    if (admitted.status !== 403) {
      throw new Error(
        `a store token on GET /api/branches should be refused with 403, got ${admitted.status}`,
      );
    }
    if (admitted.data?.message !== DENIAL_MESSAGE) {
      throw new Error(`store token 403 body is not the permission refusal: ${JSON.stringify(admitted.data)}`);
    }
  },
});

verifyPhase1({
  name: "authorizeAny() admits a super admin and the store account is cleaned up",
  run: async () => {
    try {
      // The seeded data has more than one super admin, so this counts them rather
      // than naming one: a database where they have all been removed has to fail
      // loudly here instead of quietly testing as some other user.
      const { rows } = await pool.query(
        `SELECT count(*)::int AS count
           FROM users u
           JOIN user_has_roles uhr ON uhr.user_id = u.id
           JOIN roles r ON r.id = uhr.role_id
          WHERE r.slug = 'super_admin' AND u.status = 'ACTIVE'`,
      );
      if (rows[0].count < 1) {
        throw new Error("no ACTIVE super admin exists; the super-admin path is unverified");
      }
      // super_admin IS granted every permission row, so a 200 here is also what a
      // correct role_has_permissions would produce on its own. The short-circuit
      // itself - super_admin passing a slug they hold no row for - is what
      // lib/__tests__/permission-policy.test.mjs pins, with an access object whose
      // permissions array is empty.
      const res = await apiGet(
        apiUrl("/api/branches"),
        await tokenForRole("super_admin"),
      );
      if (res.status !== 200) {
        throw new Error(
          `super admin on GET /api/branches returned ${res.status}: ${JSON.stringify(res.data)}`,
        );
      }
    } finally {
      // Always attempt the cleanup, including when the assertion above threw, so
      // a failure here cannot leave a 25th user and a 5th branch behind in the
      // database the rest of the plan's fixtures count against.
      const problems = await cleanupStoreAccount();
      if (problems.length) {
        throw new Error(`store fixture cleanup failed: ${problems.join("; ")}`);
      }
    }

    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM users WHERE email LIKE $1) AS users,
              (SELECT count(*) FROM branches WHERE code LIKE $2) AS branches`,
      [`${STORE_EMAIL_PREFIX}%`, `${STORE_CODE_PREFIX}%`],
    );
    if (Number(rows[0].users) !== 0 || Number(rows[0].branches) !== 0) {
      throw new Error(`store fixture survived cleanup: ${JSON.stringify(rows[0])}`);
    }
  },
});

// ==== RUNNER ====
// report() is Task 1's code and ends in process.exit(), so the shared pool has
// to be closed on the way out or the idle client keeps the event loop alive.
// The exit is intercepted rather than moved into a scenario, because a scenario
// would be order-dependent (see the header above).
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const exit = process.exit.bind(process);
  process.exit = (code) => {
    pool.end().finally(() => exit(code));
  };
  await report();
}
