import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadEnv } from "../../scripts/lib/env.mjs";

// lib/db.js builds its Pool at module scope out of DATABASE_URL, so the models
// can only be imported after the environment is loaded. The models are still
// imported dynamically for that reason. `stubPool` then replaces `pool.query`
// with a recorder, so nothing in this file ever opens a connection.
await loadEnv();

const { Branch, PUBLIC_COLUMNS, INTERNAL_COLUMNS } = await import("../models/branch.js");
const { BranchProduct, BP_COLUMNS } = await import("../models/branchProduct.js");
const {
  BranchStockTransfer,
  TRANSFER_COLUMNS,
  TRANSFER_ITEM_COLUMNS,
} = await import("../models/branchStockTransfer.js");

// sql/inventory.md is the authoritative record of the live column names; the
// models are checked against it rather than against a second hand-written list,
// so the two can never drift apart.
function liveColumns() {
  const text = fs.readFileSync(new URL("../../sql/inventory.md", import.meta.url), "utf8");
  const tables = {};
  let table = null;
  for (const line of text.split("\n")) {
    const heading = /^###\s+(\w+)\s*$/.exec(line);
    if (heading) {
      table = heading[1];
      tables[table] = [];
      continue;
    }
    const column = /^([a-z][a-z0-9_]*)\s{2,}\S/.exec(line);
    if (column && table) tables[table].push(column[1]);
  }
  return tables;
}

const INVENTORY = liveColumns();

function aliasPairs(list, label) {
  return list.split(",").map((fragment) => {
    const m = /^(?:(\w+)\.)?(\w+)\s+AS\s+"(\w+)"$/.exec(fragment.trim());
    assert.ok(m, `${label}: cannot parse column fragment ${JSON.stringify(fragment.trim())}`);
    return { qualifier: m[1], source: m[2], alias: m[3] };
  });
}

test("the inventory parser reads every branch-family table out of sql/inventory.md", () => {
  for (const table of [
    "branches",
    "branch_products",
    "branch_stock_transfers",
    "branch_transfer_items",
  ]) {
    assert.ok(INVENTORY[table]?.length > 0, `no columns parsed for ${table}`);
  }
  assert.deepEqual(INVENTORY.branch_stock_transfers, [
    "id", "uuid", "transfernumber", "sourcebranchid", "destinationbranchid",
    "status", "requestbyid", "approvedbyid", "receivedbyid", "reason",
    "createdat", "updatedat",
  ]);
});

const COLUMN_LISTS = [
  ["branches", PUBLIC_COLUMNS, "PUBLIC_COLUMNS"],
  ["branches", INTERNAL_COLUMNS, "INTERNAL_COLUMNS"],
  ["branch_products", BP_COLUMNS, "BP_COLUMNS"],
  ["branch_stock_transfers", TRANSFER_COLUMNS, "TRANSFER_COLUMNS"],
  ["branch_transfer_items", TRANSFER_ITEM_COLUMNS, "TRANSFER_ITEM_COLUMNS"],
];

for (const [table, list, label] of COLUMN_LISTS) {
  test(`${label} aliases every live ${table} column exactly once`, () => {
    const pairs = aliasPairs(list, label);
    const sources = pairs.map((p) => p.source);
    assert.deepEqual(
      [...sources].sort(),
      [...INVENTORY[table]].sort(),
      `${label} does not cover ${table} one-for-one`,
    );
    assert.equal(new Set(sources).size, sources.length, `${label} repeats a column`);
  });

  test(`${label} exposes ${table} rows as unique camelCase keys`, () => {
    const aliases = aliasPairs(list, label).map((p) => p.alias);
    assert.equal(new Set(aliases).size, aliases.length, `${label} repeats an alias`);
    for (const alias of aliases) {
      assert.match(alias, /^[a-z][A-Za-z0-9]*$/, `${label}: ${alias} is not camelCase`);
    }
  });
}

test("the three branch models never select or return a bare wildcard", () => {
  for (const file of ["branch.js", "branchProduct.js", "branchStockTransfer.js"]) {
    const source = fs.readFileSync(new URL(`../models/${file}`, import.meta.url), "utf8");
    // A wildcard comes back with whatever case Postgres folded to, which is the
    // exact bug this task exists to remove.
    assert.doesNotMatch(source, /\bSELECT\s+\*/i, `${file} still has SELECT *`);
    assert.doesNotMatch(source, /\bRETURNING\s+\*/i, `${file} still has RETURNING *`);
  }
});

test("no branch model aliases a column without the double quotes that preserve its case", () => {
  for (const file of ["branch.js", "branchProduct.js", "branchStockTransfer.js"]) {
    const source = fs.readFileSync(new URL(`../models/${file}`, import.meta.url), "utf8");
    // Postgres folds an unquoted alias exactly as it folds an unquoted column
    // reference, so `AS productName` comes back under the key `productname`.
    // A quoted alias is invisible to this pattern, which is the point.
    for (const [, alias] of source.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      assert.equal(
        alias,
        alias.toLowerCase(),
        `${file}: alias ${alias} is camelCase but unquoted, so it will be folded`,
      );
    }
  }
});

const db = (await import("../db.js")).default;
let realQuery;

test.beforeEach(() => {
  realQuery = Object.getOwnPropertyDescriptor(db, "query");
  calls.length = 0;
});

test.afterEach(() => {
  if (realQuery) Object.defineProperty(db, "query", realQuery);
  else delete db.query;
});

const calls = [];
function stubPool(respond) {
  Object.defineProperty(db, "query", {
    configurable: true,
    writable: true,
    value: (sql, params) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: text, params });
      return Promise.resolve(respond(text, params) ?? { rows: [] });
    },
  });
  return calls;
}

function lastCall() {
  assert.ok(calls.length > 0, "the model issued no query");
  return calls[calls.length - 1];
}

test("Branch.update writes the folded updatedat column, not updated_at", async () => {
  stubPool((sql) =>
    sql.startsWith("SELECT") ? { rows: [{ uuid: "b-1" }] } : { rows: [{ uuid: "b-1" }] },
  );

  await Branch.update("b-1", { name: "New name", deliveryRadius: "12" });

  const update = calls.at(-1);
  assert.match(update.sql, /UPDATE branches SET /);
  assert.match(update.sql, /updatedat = now\(\)/);
  assert.doesNotMatch(update.sql, /updated_at/, "updated_at does not exist on branches");
  assert.match(update.sql, /deliveryradius = \$\d+/);
  assert.match(update.sql, /RETURNING .*"addressLine1"/);
  assert.deepEqual(update.params, ["New name", 12, "b-1"]);
});

test("Branch.create inserts the folded column names and returns a camelCase row", async () => {
  stubPool(() => ({ rows: [{ uuid: "b-2", addressLine1: "1 Main St" }] }));

  const row = await Branch.create({ name: "  Corner Shop ", code: "ab-1" });

  assert.deepEqual(row, { uuid: "b-2", addressLine1: "1 Main St" });
  const insert = lastCall();
  assert.match(insert.sql, /INSERT INTO branches \(name, code,/);
  assert.match(insert.sql, /addressline1, addressline2,/);
  assert.match(insert.sql, /deliveryradius\)/);
  assert.equal(insert.params[0], "Corner Shop");
  assert.equal(insert.params[1], "AB-1");
});

test("Branch.getWithStats counts with folded column references", async () => {
  stubPool((sql) => {
    if (sql.startsWith("SELECT")) return { rows: [{ uuid: "b-1" }] };
    return { rows: [{ count: 3 }] };
  });

  await Branch.getWithStats("b-1");

  const stats = calls.filter((c) => c.sql.includes("COUNT(*)")).map((c) => c.sql);
  assert.equal(stats.length, 4);
  for (const sql of stats) {
    assert.doesNotMatch(sql, /branchId|stockQuantity|lowStockThreshold|isAvailable/);
  }
  assert.ok(stats.some((s) => s.includes("branch_products WHERE branchid =")));
  assert.ok(stats.some((s) => s.includes("stockquantity <= lowstockthreshold")));
  assert.ok(stats.some((s) => s.includes("orders WHERE branchid =")));
});

test("BranchStockTransfer.updateStatus drops the unused placeholders it used to bind", async () => {
  stubPool(() => ({ rows: [{ uuid: "t-1", transferNumber: "ST-1" }] }));
  // The RETURNING list legitimately mentions every column, so the SET clause is
  // what has to be inspected.
  const setClause = () => lastCall().sql.split(" RETURNING")[0];

  await BranchStockTransfer.updateStatus("t-1", "APPROVED");
  assert.equal(setClause().includes("approvedbyid"), false, "nothing to approve yet");
  assert.match(setClause(), /WHERE uuid = \$2$/);
  assert.deepEqual(lastCall().params, ["APPROVED", "t-1"]);

  await BranchStockTransfer.updateStatus("t-1", "APPROVED", 7);
  assert.match(setClause(), /approvedbyid = \$2/);
  assert.match(setClause(), /WHERE uuid = \$3$/);
  assert.deepEqual(lastCall().params, ["APPROVED", 7, "t-1"]);

  await BranchStockTransfer.updateStatus("t-1", "RECEIVED", 7, 9);
  assert.match(setClause(), /approvedbyid = \$2/);
  assert.match(setClause(), /receivedbyid = \$3/);
  assert.match(setClause(), /WHERE uuid = \$4$/);
  assert.deepEqual(lastCall().params, ["RECEIVED", 7, 9, "t-1"]);
});

test("BranchStockTransfer.updateStatus keeps receivedById settable on its own", async () => {
  stubPool(() => ({ rows: [{ uuid: "t-1" }] }));

  // receivedById = 0 is falsy: the old truthiness test silently dropped it.
  await BranchStockTransfer.updateStatus("t-1", "RECEIVED", null, 0);

  assert.match(lastCall().sql, /receivedbyid = \$2/);
  assert.deepEqual(lastCall().params, ["RECEIVED", 0, "t-1"]);
});

test("BranchStockTransfer.reads and writes transfer items with folded names", async () => {
  stubPool(() => ({ rows: [{ uuid: "i-1", transferId: 4 }] }));

  await BranchStockTransfer.getItems(4);
  assert.match(lastCall().sql, /branch_transfer_items WHERE transferid = \$1/);
  assert.match(lastCall().sql, /ORDER BY createdat ASC/);
  assert.match(lastCall().sql, /"transferId"/);

  await BranchStockTransfer.getByProduct(4, 9);
  assert.match(lastCall().sql, /branch_transfer_items WHERE transferid = \$1 AND productid = \$2/);
});

test("BranchProduct.create upserts on the folded unique index and returns a camelCase row", async () => {
  stubPool(() => ({ rows: [{ uuid: "bp-1", stockQuantity: 7 }] }));

  const row = await BranchProduct.create({ branchId: 1, productId: 3, stockQuantity: 7 });

  assert.deepEqual(row, { uuid: "bp-1", stockQuantity: 7 });
  const sql = lastCall().sql;
  assert.match(sql, /INSERT INTO branch_products AS bp \(branchid, productid, productuuid, variantid, sellingprice,/);
  assert.match(sql, /ON CONFLICT \(branchid, productid\)/);
  assert.match(sql, /updatedat = now\(\)/);
  assert.match(sql, /RETURNING bp\.id AS "id"/);
  assert.match(sql, /bp\.stockquantity AS "stockQuantity"/);
});

test("BranchProduct.update writes folded columns and returns a camelCase row", async () => {
  stubPool(() => ({ rows: [{ uuid: "bp-1", sellingPrice: 10 }] }));

  await BranchProduct.update("bp-1", { sellingPrice: "10.50", stockQuantity: 3 });

  const sql = lastCall().sql;
  assert.match(sql, /UPDATE branch_products AS bp SET sellingprice = \$1, stockquantity = \$2/);
  assert.match(sql, /updatedat = now\(\)/);
  assert.match(sql, /WHERE uuid = \$3/);
  assert.match(sql, /RETURNING bp\.id AS "id"/);
  assert.deepEqual(lastCall().params, [10.5, 3, "bp-1"]);
});

test("BranchProduct.updateStock reads stockquantity, so previousStock is a number", async () => {
  stubPool((sql) =>
    sql.startsWith("SELECT")
      ? { rows: [{ uuid: "bp-1", stockQuantity: 5 }] }
      : { rows: [{ uuid: "bp-1", stockQuantity: 8 }] },
  );

  const out = await BranchProduct.updateStock("bp-1", 3, "restock");

  assert.deepEqual(out, {
    branchProduct: { uuid: "bp-1", stockQuantity: 8 },
    previousStock: 5,
    newStock: 8,
    actualChange: 3,
  });
  assert.match(calls[0].sql, /bp\.stockquantity AS "stockQuantity"/);
  assert.match(calls.at(-1).sql, /UPDATE branch_products AS bp SET stockquantity = \$1/);
});

test("BranchProduct.updateStock will not let a decrement drive stock below zero", async () => {
  stubPool((sql) =>
    sql.startsWith("SELECT")
      ? { rows: [{ stockQuantity: 2 }] }
      : { rows: [{ stockQuantity: 0 }] },
  );

  const out = await BranchProduct.updateStock("bp-1", -10);

  assert.equal(out.previousStock, 2);
  assert.equal(out.newStock, 0);
  assert.equal(out.actualChange, -2);
  assert.equal(lastCall().params[0], 0);
});

test("BranchProduct list queries join on the folded productid and alias the product columns", async () => {
  stubPool((sql) =>
    sql.includes("COUNT(*)") ? { rows: [{ count: 1 }] } : { rows: [{ uuid: "bp-1" }] },
  );

  const result = await BranchProduct.getByBranch(1, { page: 1, limit: 5 });

  assert.deepEqual(result.pagination, { page: 1, limit: 5, total: 1, totalPages: 1 });
  const data = calls[0].sql;
  assert.match(data, /FROM branch_products bp JOIN products p ON p\.id = bp\.productid/);
  assert.match(data, /WHERE bp\.branchid = \$1/);
  assert.match(data, /ORDER BY bp\.createdat DESC/);
  assert.match(data, /p\.name AS "productName"/);
  assert.match(data, /p\.discount_price AS "globalDiscountPrice"/);
  assert.match(data, /p\.inventory_mode AS "globalInventoryMode"/);
  assert.doesNotMatch(data, /\bbp\.\*/);
  assert.doesNotMatch(data, /AS [a-z]*[A-Z]/, "an unquoted alias folds back to lowercase");

  const before = calls.length;
  await BranchProduct.listForBranches([1, 2], { page: 1, limit: 5 });
  const forBranches = calls[before].sql;
  assert.match(forBranches, /WHERE bp\.branchid IN \(\$1, \$2\)/);
  assert.deepEqual(calls[before].params, [1, 2, 5, 0]);
});
