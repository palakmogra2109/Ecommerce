import test from "node:test";
import assert from "node:assert/strict";
import { assertColumn, listColumns } from "../../scripts/lib/columns.mjs";

function fakePool(rows) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      return Promise.resolve({ rows: typeof rows === "function" ? rows(sql, params) : rows });
    },
  };
}

const BRANCHES = [
  { name: "id", dataType: "bigint" },
  { name: "uuid", dataType: "uuid" },
  { name: "addressline1", dataType: "text" },
  { name: "createdat", dataType: "timestamp with time zone" },
];

test("listColumns reads information_schema.columns with the table bound as a parameter", async () => {
  const pool = fakePool(BRANCHES);
  const cols = await listColumns(pool, "branches");

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /information_schema\.columns/);
  assert.match(pool.calls[0].sql, /table_name\s*=\s*\$1/);
  assert.match(pool.calls[0].sql, /order by ordinal_position/i);
  assert.deepEqual(pool.calls[0].params, ["branches"]);
  assert.deepEqual(cols, BRANCHES);
});

test("listColumns scopes the lookup to current_schema() so same-named tables cannot leak in", async () => {
  const pool = fakePool(BRANCHES);
  await listColumns(pool, "branches");

  assert.match(
    pool.calls[0].sql,
    /table_schema\s*=\s*current_schema\(\)/i,
    "expected the query to be scoped by table_schema = current_schema()",
  );
});

test("listColumns returns an empty list for an unknown table instead of throwing", async () => {
  const cols = await listColumns(fakePool([]), "no_such_table");
  assert.deepEqual(cols, []);
});

test("assertColumn resolves when the column exists and hands back the full list", async () => {
  const pool = fakePool(BRANCHES);
  const cols = await assertColumn(pool, "branches", "addressline1");
  assert.deepEqual(cols, BRANCHES);
});

test("assertColumn throws the missing-column message listing the actual columns", async () => {
  const pool = fakePool(BRANCHES);
  await assert.rejects(
    () => assertColumn(pool, "branches", "address_line_1"),
    (e) => {
      assert.match(e.message, /^missing column branches\.address_line_1; have: /);
      assert.match(e.message, /id, uuid, addressline1, createdat/);
      return true;
    },
  );
});

test("assertColumn is case-sensitive: the camelCase spelling of a folded column is missing", async () => {
  const pool = fakePool(BRANCHES);
  await assert.rejects(
    () => assertColumn(pool, "branches", "addressLine1"),
    /missing column branches\.addressLine1; have: id, uuid, addressline1, createdat/,
  );
});

test("assertColumn reports an unknown table distinctly from an unknown column", async () => {
  await assert.rejects(
    () => assertColumn(fakePool([]), "branch_widgets", "stockquantity"),
    (e) => {
      assert.match(e.message, /^no such table: branch_widgets /);
      assert.doesNotMatch(e.message, /missing column/);
      return true;
    },
  );
});
