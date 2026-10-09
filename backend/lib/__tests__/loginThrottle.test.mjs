import test from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_LOCKOUT_MS,
  LOGIN_WINDOW_MS,
  MAX_ACCOUNT_FAILURES,
  MAX_IP_FAILURES,
  accountKey,
  checkLoginAllowed,
  clearLoginFailures,
  loginKeys,
  recordLoginFailure,
} from "../loginThrottle.js";

/** Minimal Request stand-in for the header clientKey() reads. */
const req = (ip) => ({ headers: { get: (n) => (n === "x-forwarded-for" ? ip : null) } });

test("LOGIN_LOCKOUT_MS is the two minutes the login page counts down", () => {
  assert.equal(LOGIN_LOCKOUT_MS, 2 * 60 * 1000);
});

test("the account budget is five attempts", () => {
  // Pinned because it is the control that actually bounds online guessing, and
  // because the login suite's own throttle cases assume it. Changing it here
  // should be a decision, not a drift.
  assert.equal(MAX_ACCOUNT_FAILURES, 5);
});

test("the account key normalises case and surrounding space", () => {
  // Without this, A@B.com / a@b.com / " a@b.com " would each get their own
  // budget and the per-account limit would be trivially bypassed by typing the
  // same address with different capitalisation.
  const canonical = accountKey("  Person@Example.COM ");
  assert.equal(accountKey("person@example.com"), canonical);
  assert.equal(accountKey("PERSON@EXAMPLE.COM"), canonical);
  assert.notEqual(accountKey("other@example.com"), canonical);
});

test("the account and IP keys are distinct namespaces", () => {
  const keys = loginKeys(req("203.0.113.9"), "person@example.com");
  assert.equal(keys.account, "acct:person@example.com");
  assert.equal(keys.ip, "ip:203.0.113.9");
  assert.notEqual(keys.account, keys.ip);
});

test("an empty email still yields an IP key and no account key", () => {
  const keys = loginKeys(req("203.0.113.9"), "");
  assert.equal(keys.account, null);
  assert.equal(keys.ip, "ip:203.0.113.9");
});

test("a clean login is allowed", () => {
  const log = new Map();
  assert.deepEqual(checkLoginAllowed(log, loginKeys(req("203.0.113.9"), "a@b.com")), {
    ok: true,
  });
});

test("failures lock the ACCOUNT out, and report the two minutes", () => {
  const log = new Map();
  const now = 1_000_000;
  const keys = loginKeys(req("203.0.113.9"), "person@example.com");

  for (let i = 0; i < MAX_ACCOUNT_FAILURES - 1; i++) {
    recordLoginFailure(log, keys, now);
  }
  assert.equal(checkLoginAllowed(log, keys, now).ok, true, "allowed below the account limit");

  recordLoginFailure(log, keys, now);
  const blocked = checkLoginAllowed(log, keys, now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.scope, "account");
  assert.equal(blocked.retryAfterSec, Math.ceil(LOGIN_LOCKOUT_MS / 1000));
});

test("one account being locked out leaves every other account alone", () => {
  // The bug this replaces: the old limiter keyed on IP only, so twenty failures
  // from anyone behind a shared NAT locked out everyone behind it.
  const log = new Map();
  const now = 1_000_000;
  const shared = req("203.0.113.9");

  const victim = loginKeys(shared, "victim@example.com");
  for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) {
    recordLoginFailure(log, victim, now);
  }
  assert.equal(checkLoginAllowed(log, victim, now).ok, false, "the victim is locked out");

  const bystander = loginKeys(shared, "bystander@example.com");
  assert.equal(
    checkLoginAllowed(log, bystander, now).ok,
    true,
    "a different account on the same IP is unaffected"
  );
});

test("the IP bucket is much looser than the account bucket", () => {
  assert.ok(MAX_IP_FAILURES > MAX_ACCOUNT_FAILURES);

  const log = new Map();
  const now = 1_000_000;
  const shared = req("203.0.113.9");

  // One failure each, for more distinct accounts than the IP budget allows, so
  // no single account comes near its own limit and the address is the only thing
  // that trips. Derived from MAX_IP_FAILURES rather than from the account limit:
  // coupling the spray size to MAX_ACCOUNT_FAILURES made this test silently
  // stop reaching the IP bucket when that number dropped from 10 to 5.
  for (let n = 0; n <= MAX_IP_FAILURES; n++) {
    recordLoginFailure(log, loginKeys(shared, `spray${n}@example.com`), now);
  }

  const fresh = loginKeys(shared, "someone-new@example.com");
  assert.equal(
    checkLoginAllowed(log, fresh, now).scope,
    "ip",
    "the IP bucket is what stops one host spraying many accounts"
  );
});

test("the lockout lifts on its own and the window then resets", () => {
  const log = new Map();
  const now = 1_000_000;
  const keys = loginKeys(req("203.0.113.9"), "person@example.com");

  for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) {
    recordLoginFailure(log, keys, now);
  }
  assert.equal(checkLoginAllowed(log, keys, now).ok, false);

  const afterLockout = now + LOGIN_LOCKOUT_MS + 1;
  assert.equal(checkLoginAllowed(log, keys, afterLockout).ok, true, "lockout lifted");

  const afterWindow = now + LOGIN_WINDOW_MS + 1;
  recordLoginFailure(log, keys, afterWindow);
  assert.equal(
    checkLoginAllowed(log, keys, afterWindow).ok,
    true,
    "the window reset, so one failure is not a fresh lockout"
  );
});

test("a successful login clears BOTH budgets", () => {
  const log = new Map();
  const now = 1_000_000;
  const keys = loginKeys(req("203.0.113.9"), "person@example.com");

  for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) {
    recordLoginFailure(log, keys, now);
  }
  clearLoginFailures(log, keys);

  assert.equal(log.get("acct:person@example.com"), undefined, "account budget returned");
  assert.equal(log.get("ip:203.0.113.9"), undefined, "IP budget returned");
  assert.deepEqual(checkLoginAllowed(log, keys, now), { ok: true });
});

test("an unidentifiable client is still throttled per account", () => {
  // The old route skipped throttling entirely when the client could not be
  // identified, because every such request shared the literal key "unknown" and
  // throttling it would lock out every visitor. The per-account bucket removes
  // that dilemma, so "unknown" is no longer a free pass.
  const log = new Map();
  const now = 1_000_000;
  const keys = loginKeys(req(null), "person@example.com");

  assert.equal(keys.ip, null, "no IP bucket when the client cannot be identified");

  for (let i = 0; i < MAX_ACCOUNT_FAILURES; i++) {
    recordLoginFailure(log, keys, now);
  }
  const blocked = checkLoginAllowed(log, keys, now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.scope, "account");
});

test("no bucket at all means no lockout rather than a crash", () => {
  const log = new Map();
  const keys = loginKeys(req(null), "");
  assert.deepEqual(keys, { account: null, ip: null });
  assert.deepEqual(checkLoginAllowed(log, keys, 1_000_000), { ok: true });
  recordLoginFailure(log, keys, 1_000_000);
  clearLoginFailures(log, keys);
  assert.equal(log.size, 0);
});