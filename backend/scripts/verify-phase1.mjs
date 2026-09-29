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
// Later tasks append `verifyPhase1({ name, run })` registrations below this
// marker. Never edit or remove anything under the RUNNER heading below — new
// registrations must be inserted between this comment and the RUNNER comment.

// Task 2: live column inventory. Read-only introspection against DATABASE_URL —
// no writes, no DDL. loadEnv() already ran above, so the pool can be created here.
const { default: pg } = await import("pg");
const { listColumns, assertColumn } = await import("./lib/columns.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on("error", (e) => console.error(`pool  idle-client error: ${e.message}`));

const INVENTORY_TABLES = [
  "branches",
  "branch_products",
  "branch_stock_transfers",
  "branch_transfer_items",
  "branch_inventory_transactions",
  "orders",
  "users",
];

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
      let threw = false;
      try {
        await assertColumn(pool, table, bogus);
      } catch {
        threw = true;
      }
      if (!threw) throw new Error(`${table}.${bogus} unexpectedly exists (camelCase leaking in?)`);
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
      let threw = false;
      try {
        await assertColumn(pool, table, bogus);
      } catch {
        threw = true;
      }
      if (!threw) throw new Error(`${table}.${bogus} unexpectedly exists (snake_case spelling present)`);
    }
  },
});

verifyPhase1({
  name: "sql/inventory.md matches the live schema exactly",
  run: async () => {
    const path = await import("node:path");
    const text = fs.readFileSync(path.join(process.cwd(), "sql", "inventory.md"), "utf8");
    for (const table of INVENTORY_TABLES) {
      const section = text.split(`### ${table}\n`)[1]?.split("\n### ")[0];
      if (!section) throw new Error(`sql/inventory.md is missing a section for ${table}`);
      const documented = [...section.matchAll(/^([a-z0-9_]+)\s{2,}\S/gm)].map((m) => m[1]);
      const live = (await listColumns(pool, table)).map((c) => c.name);
      const missing = live.filter((n) => !documented.includes(n));
      const extra = documented.filter((n) => !live.includes(n));
      if (missing.length || extra.length) {
        throw new Error(
          `sql/inventory.md is stale for ${table}: not documented [${missing.join(", ")}], ` +
            `documented but absent [${extra.join(", ")}] — regenerate the file`,
        );
      }
    }
  },
});

verifyPhase1({
  name: "pg pool closed after inventory checks",
  run: async () => {
    await pool.end();
  },
});

// ==== RUNNER ====
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await report();
