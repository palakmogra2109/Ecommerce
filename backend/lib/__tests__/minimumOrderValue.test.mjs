import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { loadEnv } from "../../scripts/lib/env.mjs";
import "./helpers/aliasHooks.mjs";

await loadEnv();

const base = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH = "gc_mov";
const admin = new pg.Pool({ connectionString: base + "postgres" });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH}`);
await admin.end();
process.env.DATABASE_URL = base + SCRATCH;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(fs.readFileSync("sql/schema.sql", "utf8"));
// Migrations 029 and 030 are not in schema.sql yet; replay the one under test.
await pool.query(fs.readFileSync("sql/migrations/030-minimum-order-value.sql", "utf8"));

const settingsRoute = await import("../../app/api/settings/order/route.js");
const historyRoute = await import("../../app/api/settings/order/history/route.js");
const {
  getMinimumOrderValue, setMinimumOrderValue, evaluateMinimumOrderValue,
  parseAmount, OrderSettingsError,
} = await import("../../lib/orderSettings.js");
const servicePool = (await import("../../lib/db.js")).default;

const user = (await pool.query(
  "INSERT INTO users (name,email,password,status) VALUES ('MOV','mov@example.test','x','ACTIVE') RETURNING id"
)).rows[0];
const role = (await pool.query(
  "INSERT INTO roles (name,slug,description,status) VALUES ('Super','super_admin','d','ACTIVE') RETURNING id"
)).rows[0];
await pool.query("INSERT INTO user_has_roles (user_id,role_id) VALUES ($1,$2)", [user.id, role.id]);
const { createToken } = await import("../auth.js");
globalThis.__requestAuth = { token: await createToken({ id: user.id, email: "mov@example.test" }), headers: new Headers() };

const put = (body) => settingsRoute.PUT({
  headers: new Headers(), json: async () => body,
});

test.after(async () => {
  await pool.end();
  await servicePool.end().catch(() => {});
  const a = new pg.Pool({ connectionString: base + "postgres" });
  await a.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await a.end();
});

const at = (amount, rule) => evaluateMinimumOrderValue(amount, rule);

// ── shipped default ────────────────────────────────────────────────────────

test("the rule ships disabled, so no existing order is affected", async () => {
  const rule = await getMinimumOrderValue();
  assert.equal(rule.enabled, false);
  assert.equal(rule.amount, 0);
  assert.equal(at(1, rule).satisfied, true, "a 1-rupee order is fine while disabled");
});

// ── test cases 1-3: minimum 5,000 ──────────────────────────────────────────

test("with a 5,000 minimum: 4,999 blocked, 5,000 allowed, 5,001 allowed", async () => {
  await put({ amount: 5000, enabled: true });
  const rule = await getMinimumOrderValue();
  assert.equal(rule.amount, 5000);
  assert.equal(rule.enabled, true);

  assert.equal(at(4999, rule).satisfied, false, "one rupee short is blocked");
  assert.equal(at(5000, rule).satisfied, true, "exactly the minimum is allowed");
  assert.equal(at(5001, rule).satisfied, true, "above is allowed");
});

test("the shortfall and message are calculated, not hard-coded", async () => {
  await put({ amount: 5000, enabled: true });
  const rule = await getMinimumOrderValue();

  const short = at(4500, rule);
  assert.equal(short.remaining, 500);
  assert.match(short.message, /5,000/);
  assert.match(short.message, /500 more/);

  const nearly = at(4999, rule);
  assert.equal(nearly.remaining, 1);
  assert.match(nearly.message, /₹1 more/);

  const met = at(5000, rule);
  assert.equal(met.remaining, 0);
  assert.equal(met.message, "Minimum order requirement met.");
});

test("an empty cart gets its own message rather than a negative shortfall", async () => {
  await put({ amount: 10000, enabled: true });
  const empty = at(0, await getMinimumOrderValue());
  assert.equal(empty.satisfied, false);
  assert.equal(empty.remaining, 10000);
  assert.ok(!/-\s*₹/.test(empty.message), "no negative amount in the message");
});

// ── test cases 4-7: change the setting to 10,000 ───────────────────────────

test("raising the minimum to 10,000 blocks carts that used to pass", async () => {
  await put({ amount: 5000, enabled: true });
  assert.equal(at(5000, await getMinimumOrderValue()).satisfied, true, "passes at 5,000");

  await put({ amount: 10000, enabled: true });
  const rule = await getMinimumOrderValue();
  assert.equal(rule.amount, 10000);

  assert.equal(at(5000, rule).satisfied, false, "test case 4");
  assert.equal(at(9999, rule).satisfied, false, "test case 5");
  assert.equal(at(10000, rule).satisfied, true, "test case 6");
  assert.equal(at(15000, rule).satisfied, true, "test case 7");
  assert.equal(at(9999, rule).message.includes("₹1 more"), true);
});

test("a fresh read sees the new value immediately (test cases 10-11)", async () => {
  await put({ amount: 5000, enabled: true });
  assert.equal((await getMinimumOrderValue()).amount, 5000);
  await put({ amount: 25000, enabled: true });
  assert.equal((await getMinimumOrderValue()).amount, 25000, "no caching between reads");
});

// ── test case 8: disabled ──────────────────────────────────────────────────

test("disabling removes the restriction entirely", async () => {
  await put({ amount: 10000, enabled: true });
  await put({ amount: 10000, enabled: false });
  const rule = await getMinimumOrderValue();
  assert.equal(rule.enabled, false);
  assert.equal(at(1, rule).satisfied, true, "test case 8: any amount passes");
  assert.equal(at(0, rule).message, "", "no message shown when there is no rule");
});

test("enabled with a zero amount imposes nothing", async () => {
  await put({ amount: 0, enabled: true });
  const rule = await getMinimumOrderValue();
  assert.equal(rule.enabled, false, "a zero minimum is treated as no rule");
  assert.equal(at(1, rule).satisfied, true);
});

// ── validation ─────────────────────────────────────────────────────────────

test("negative, non-numeric and over-precise amounts are rejected", () => {
  assert.throws(() => parseAmount(-1), OrderSettingsError);
  assert.throws(() => parseAmount("abc"), OrderSettingsError);
  assert.throws(() => parseAmount(Infinity), OrderSettingsError);
  assert.throws(() => parseAmount(10.999), /two decimal places/);
  assert.equal(parseAmount("5,000"), 5000, "commas typed by an admin are fine");
  assert.equal(parseAmount(0), 0);
  assert.equal(parseAmount(""), 0);
});

test("a rejected amount leaves the stored value untouched", async () => {
  await put({ amount: 7500, enabled: true });
  const res = await put({ amount: -100, enabled: true });
  assert.equal(res.status, 422);
  const rule = await getMinimumOrderValue();
  assert.equal(rule.amount, 7500, "still 7,500 after a bad save");
});

// ── test case 11: history ──────────────────────────────────────────────────

test("every change is recorded with old and new values", async () => {
  await put({ amount: 5000, enabled: true });
  await put({ amount: 10000, enabled: false });

  const history = await historyRoute.GET({
    headers: new Headers(), url: "http://x/api/settings/order/history",
  });
  assert.equal(history.status, 200);
  const { history: rows } = await history.json();
  const latest = rows[0];
  assert.equal(Number(latest.previous_amount), 5000);
  assert.equal(Number(latest.new_amount), 10000);
  assert.equal(latest.previous_enabled, true);
  assert.equal(latest.new_enabled, false);

  const total = (await pool.query("SELECT count(*)::int AS n FROM min_order_value_history")).rows[0].n;
  assert.ok(total >= 2, "earlier history is appended to, never replaced");
});

// ── permissions ────────────────────────────────────────────────────────────

test("an anonymous request cannot read or change the rule", async () => {
  const saved = globalThis.__requestAuth.token;
  globalThis.__requestAuth.token = null;
  assert.equal((await settingsRoute.GET()).status, 401);
  assert.equal((await put({ amount: 1, enabled: true })).status, 401);
  globalThis.__requestAuth.token = saved;
});

test("the read route reports the rule the cart needs", async () => {
  await put({ amount: 6000, enabled: true });
  const res = await settingsRoute.GET();
  assert.equal(res.status, 200);
  const { minimumOrderValue } = await res.json();
  assert.equal(minimumOrderValue.amount, 6000);
  assert.equal(minimumOrderValue.enabled, true);
  assert.match(minimumOrderValue.display, /6,000/);
});