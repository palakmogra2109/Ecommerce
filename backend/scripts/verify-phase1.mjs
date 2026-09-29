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
