import test from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/lib/env.mjs";

// lib/db.js builds its Pool at module scope out of DATABASE_URL, so the model can
// only be imported after the environment is loaded. `stubPool` then replaces
// `pool.query` with a recorder, so nothing in this file ever opens a connection.
await loadEnv();

const { Order } = await import("../models/order.js");
const db = (await import("../db.js")).default;

const calls = [];
let realQuery;

test.beforeEach(() => {
  realQuery = Object.getOwnPropertyDescriptor(db, "query");
  calls.length = 0;
});

test.afterEach(() => {
  if (realQuery) Object.defineProperty(db, "query", realQuery);
  else delete db.query;
});

function stubPool(respond) {
  Object.defineProperty(db, "query", {
    configurable: true,
    writable: true,
    value: (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      return Promise.resolve(respond(calls[calls.length - 1]) ?? { rows: [] });
    },
  });
  return calls;
}

function lastCall() {
  assert.ok(calls.length > 0, "the model issued no query");
  return calls[calls.length - 1];
}

function callMatching(prefix) {
  const call = calls.find((c) => c.sql.startsWith(prefix));
  assert.ok(call, `no ${prefix} statement was issued; got: ${calls.map((c) => c.sql.slice(0, 40)).join(" | ")}`);
  return call;
}

const PUBLIC_ORDER = {
  uuid: "o-1",
  order_number: "ORD-0000042",
  customer_name: "Test Customer",
  status: "PACKED",
  branchid: "7",
};

test("Order.updateByNumber matches on order_number and scopes the write to one branch", async () => {
  stubPool(({ sql }) => {
    if (sql.startsWith("SELECT")) return { rows: [PUBLIC_ORDER] };
    if (sql.startsWith("INSERT")) return { rows: [] };
    return { rows: [{ id: 42, uuid: "o-1", order_number: "ORD-0000042", status: "PACKED", branchid: "7" }] };
  });

  const updated = await Order.updateByNumber("ORD-0000042", { status: "PACKED", branchId: 7 });

  const write = callMatching("UPDATE orders");
  assert.match(write.sql, /^UPDATE orders SET status = \$1, updated_at = now\(\)/);
  assert.match(write.sql, /WHERE order_number = \$2 AND branchid = \$3/);
  // orders is snake_case; branchid is the one folded column (sql/inventory.md).
  assert.doesNotMatch(write.sql, /branch_id|branchId =|orderNumber =|order_number = \$1/);
  assert.deepEqual(write.params, ["PACKED", "ORD-0000042", 7]);
  // The RETURNING list has to be quoted where it is camelCase, and it must not
  // be a wildcard (a wildcard comes back folded).
  assert.match(write.sql, /RETURNING id, uuid, order_number, status, branchid/);
  assert.doesNotMatch(write.sql, /RETURNING \*/);
  // The row is re-read through the public BASE_SELECT, so the route gets the
  // same shape Order.update returns.
  assert.match(calls.at(-1).sql, /FROM orders o LEFT JOIN customers c/);
  assert.deepEqual(calls.at(-1).params, ["o-1"]);
  assert.equal(updated.order_number, "ORD-0000042");
  assert.equal(updated.status, "PACKED");
});

test("Order.updateByNumber writes a status_history row for the transition", async () => {
  stubPool(({ sql }) => {
    if (sql.startsWith("SELECT")) return { rows: [PUBLIC_ORDER] };
    if (sql.startsWith("INSERT")) return { rows: [] };
    return { rows: [{ id: 42, uuid: "o-1", order_number: "ORD-0000042", status: "PACKED", branchid: "7" }] };
  });

  await Order.updateByNumber("ORD-0000042", { status: "PACKED", branchId: 7 });

  const history = callMatching("INSERT INTO order_status_history");
  // The first argument is the numeric order id, not the uuid.
  assert.deepEqual(history.params, [42, "PACKED", "", "system"]);
});

test("Order.updateByNumber returns null when the order is not in that branch", async () => {
  stubPool(({ sql }) => (sql.startsWith("UPDATE") ? { rows: [] } : { rows: [] }));

  const updated = await Order.updateByNumber("ORD-0000042", { status: "PACKED", branchId: 999 });

  assert.equal(updated, null);
  // A cross-branch update must not be followed by a history insert or a re-read.
  assert.equal(calls.length, 1, `expected exactly one statement, got ${calls.length}`);
});

test("Order.updateByNumber refuses to run without an order number or a branch", async () => {
  stubPool(() => ({ rows: [] }));

  assert.equal(await Order.updateByNumber("", { status: "PACKED", branchId: 7 }), null);
  assert.equal(await Order.updateByNumber("ORD-0000042", { status: "PACKED" }), null);
  assert.equal(await Order.updateByNumber(null, { status: "PACKED", branchId: 7 }), null);
  // `branchId: null` is the unresolvable-branch case, not a "match any branch".
  assert.equal(await Order.updateByNumber("ORD-0000042", { status: "PACKED", branchId: null }), null);

  assert.equal(calls.length, 0, "the model hit the database for an unusable call");
});

test("Order.updateByNumber is loaded with extensioned specifiers so Node can import it", async () => {
  // Next resolves "../db" through its own bundler, but plain Node ESM does not,
  // so the model would be unloadable from scripts/ or a unit test.
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../models/order.js", import.meta.url), "utf8"),
  );
  assert.doesNotMatch(source, /from "\.\.\/(db|pagination)"/);
  assert.match(source, /from "\.\.\/db\.js"/);
  assert.match(source, /from "\.\.\/pagination\.js"/);
});

test("Order.nextOrderNumber still derives from MAX(id) - Task 11 owns the sequence", async () => {
  stubPool(() => ({ rows: [{ next_id: "42" }] }));

  assert.equal(await Order.nextOrderNumber(), "ORD-0000042");
  assert.match(lastCall().sql, /SELECT COALESCE\(MAX\(id\), 0\) \+ 1 AS next_id FROM orders/);
});
