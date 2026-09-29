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
