import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import util from "node:util";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../scripts/lib/env.mjs";

// The environment first, exactly as giftCardCodeModel.test.mjs does it.
await loadEnv();

import pg from "pg";

// ---------------------------------------------------------------- throwaway DB
//
// The claim service turns a typed-in string into customer money, so the tests
// for it cannot be mocks: a mocked lock proves nothing about whether two
// transactions serialise, and a mocked wallet proves nothing about whether
// balance_after is the wallet total. Every test below runs against a real
// database — created fresh from sql/schema.sql, and never the live `ecommerce`
// one, which this file would otherwise be free to credit a hundred buckets on.
//
// The database is LEFT BEHIND at the end of the run (the same choice
// giftCardCodeModel.test.mjs makes) rather than dropped in a finally, so a
// failed run can be inspected with psql against `gc_claimtest`. The next run
// drops it first, with FORCE, so a run that died holding a connection cannot
// make the next one fail for the wrong reason.
const BASE_URL = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH_DB = "gc_claimtest";
const SCRATCH_URL = `${BASE_URL}${SCRATCH_DB}`;

const admin = new pg.Pool({ connectionString: `${BASE_URL}postgres` });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
await admin.end();

// lib/db.js builds its Pool at module scope out of process.env.DATABASE_URL and
// Node caches an imported module for the life of the process, so the variable
// has to be repointed at the scratch database BEFORE the model is imported —
// which is why these are `await import()` and why the block above cannot move
// into a hook.
process.env.DATABASE_URL = SCRATCH_URL;

const scratch = new pg.Pool({ connectionString: SCRATCH_URL });
// Resolved against this file rather than process.cwd(), so the suite runs the
// same way whether npm started it from backend/ or a script did.
await scratch.query(fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8"));

const { ClaimError, claimEligibility, claimGiftCard, previewClaim } = await import("../services/claimGiftCard.js");
const { Wallet, LEDGER_TYPE } = await import("../models/wallet.js");
const { GiftCardCode, CODE_STATUS } = await import("../models/giftCardCode.js");
const { normalizeScope } = await import("../giftCardApplicability.js");
const { round2 } = await import("../giftCardRules.js");
const modelPool = (await import("../db.js")).default;

// ------------------------------------------------------------------- plumbing

async function inTx(fn) {
  return withClient(async (client) => {
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

// One connection, always released. A client checked out and never returned
// keeps its socket open and the process hangs at exit rather than at any
// particular assertion.
async function withClient(fn) {
  const client = await scratch.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// A pre-existing wallet bucket, created directly. Used to give a customer a
// balance that is NOT what the claim is worth, so "the wallet total" and "the
// claimed amount" are two different numbers and balance_after cannot be the one
// that happens to be right by accident.
async function seedBucket(customerId, { initialValue = 100, remaining = initialValue, applicability = [] } = {}) {
  const wallet = await Wallet.ensureForCustomer(customerId);
  const result = await scratch.query(
    `INSERT INTO customer_wallet_buckets
       (wallet_id, currency, initial_value, remaining, applicability)
     VALUES ($1, 'INR', $2, $3, $4::jsonb) RETURNING id`,
    [wallet.id, initialValue, remaining, JSON.stringify(applicability)]
  );
  return Number(result.rows[0].id);
}

// ------------------------------------------------------------------- seeding

let customerSeq = 0;
async function seedCustomer() {
  customerSeq += 1;
  const result = await scratch.query(
    "INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING id",
    [`Claim Tester ${customerSeq}`, `claim-tester-${customerSeq}-${randomUUID()}@example.test`]
  );
  return Number(result.rows[0].id);
}

let templateSeq = 0;
async function seedTemplate({ initialAmount = 1000, currency = "INR" } = {}) {
  templateSeq += 1;
  const result = await scratch.query(
    `INSERT INTO gift_cards (label, initial_amount, balance, currency, status)
     VALUES ($1, $2, $2, $3, 'ACTIVE') RETURNING id`,
    [`Claim Template ${templateSeq}`, initialAmount, currency]
  );
  return Number(result.rows[0].id);
}

// A template's spend scope, as gift_card_applicability stores it: one row per
// (template, kind, value), which is the shape applicabilityForTemplate reads
// back as [{ type, value }].
async function setScope(templateId, rows) {
  for (const row of rows) {
    await scratch.query(
      "INSERT INTO gift_card_applicability (template_id, kind, value) VALUES ($1, $2, $3)",
      [templateId, row.kind, row.value]
    );
  }
}

let codeSeq = 0;
// issueInTx is the only thing that mints a code in production, so the tests mint
// theirs the same way. The plaintext comes back once, exactly as it does to the
// delivery step, and is never stored.
async function issueCode(templateId, { expiresAt = null } = {}) {
  codeSeq += 1;
  const plaintext = `gift-claim-${String(codeSeq).padStart(4, "0")}-${randomUUID().slice(0, 4)}`;
  const row = await inTx((client) => GiftCardCode.issueInTx(client, { templateId, code: plaintext, expiresAt }));
  return { ...row, plaintext };
}

// Direct status writes. issueInTx always mints UNUSED, so the other four states
// have to be arranged deliberately — through the scratch database rather than
// by loosening anything in the model.
async function forceStatus(codeId, status) {
  await scratch.query("UPDATE gift_card_codes SET status = $1, updated_at = now() WHERE id = $2", [status, codeId]);
}

async function revokeCode(codeId, reason = "Reported stolen") {
  await inTx((client) => GiftCardCode.revokeInTx(client, { id: codeId, reason }));
}

// ---------------------------------------------------------------- assertions

const codeRow = async (codeId) =>
  (await scratch.query(
    "SELECT status, claimed_by, claimed_at, claimed_value, expires_at FROM gift_card_codes WHERE id = $1",
    [codeId]
  )).rows[0];

const bucketsForCode = async (codeId) =>
  (await scratch.query(
    "SELECT id, wallet_id, initial_value, remaining, applicability, expires_at FROM customer_wallet_buckets WHERE code_id = $1",
    [codeId]
  )).rows;

const creditsForCode = async (codeId) =>
  (await scratch.query(
    `SELECT id, wallet_id, type, amount, balance_after, bucket_id, reference, metadata
     FROM customer_reward_transactions WHERE code_id = $1 ORDER BY id`,
    [codeId]
  )).rows;

const ledgerCount = async (customerId) =>
  (await scratch.query(
    `SELECT COUNT(*)::int AS n FROM customer_reward_transactions t
     JOIN customer_wallets w ON w.id = t.wallet_id WHERE w.customer_id = $1`,
    [customerId]
  )).rows[0].n;

// The outcome of an attempted claim, as a value rather than a throw, so a test
// can assert on the refusal and on what it left behind in the same breath.
async function attempt(code, customerId, options = {}) {
  try {
    return { ok: true, result: await claimGiftCard({ code, customerId, ...options }) };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof ClaimError ? error.code : "UNEXPECTED",
      message: error.message,
      error,
    };
  }
}

const DECLINE = (outcome) => {
  assert.equal(outcome.ok, false, `expected a refusal, got ${JSON.stringify(outcome.result)}`);
  return outcome.code;
};

// =========================================================== the happy path

test("a fresh code claims its full face value and credits exactly one bucket", async () => {
  const templateId = await seedTemplate({ initialAmount: 1000 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();

  const claimed = await claimGiftCard({ code: issued.plaintext, customerId });

  assert.equal(claimed.ok, true);
  assert.equal(claimed.claimedValue, 1000, "the whole face value, not a residual");
  assert.equal(claimed.currency, "INR");
  assert.equal(claimed.balanceAfter, 1000, "and the wallet now holds it");
  assert.ok(claimed.bucketId, "the bucket the value landed in is reported back");

  const buckets = await bucketsForCode(issued.id);
  assert.equal(buckets.length, 1);
  assert.equal(Number(buckets[0].initial_value), 1000);
  assert.equal(Number(buckets[0].remaining), 1000);
  assert.equal(Number(buckets[0].id), Number(claimed.bucketId));

  const stored = await codeRow(issued.id);
  assert.equal(stored.status, CODE_STATUS.REDEEMED);
  assert.equal(Number(stored.claimed_by), customerId);
  assert.equal(Number(stored.claimed_value), 1000);
  assert.ok(stored.claimed_at, "owner and claim time stand or fall together");
});

test("the claim is worth the face value even when the wallet already held money", async () => {
  // A claim is all-or-nothing, so the customer's existing balance must not
  // change what the code is worth. If the implementation credited "what was
  // missing" or "the residual", a 1000 card into a 300 wallet would produce a
  // bucket of 700 or 300 rather than 1000.
  const templateId = await seedTemplate({ initialAmount: 1000 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();
  await seedBucket(customerId, { initialValue: 300, remaining: 300 });

  const claimed = await claimGiftCard({ code: issued.plaintext, customerId });

  assert.equal(claimed.claimedValue, 1000);
  assert.equal(claimed.balanceAfter, 1300, "the wallet total is the old balance plus the full face value");

  const buckets = await bucketsForCode(issued.id);
  assert.equal(buckets.length, 1);
  assert.equal(Number(buckets[0].remaining), 1000, "the bucket holds the whole card, not the remainder");
});

test("the bucket carries the code's own expiry, so the value ages out with the card", async () => {
  const templateId = await seedTemplate({ initialAmount: 500 });
  const expiresAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const issued = await issueCode(templateId, { expiresAt });
  const customerId = await seedCustomer();

  await claimGiftCard({ code: issued.plaintext, customerId });

  const [bucket] = await bucketsForCode(issued.id);
  assert.equal(new Date(bucket.expires_at).toISOString(), new Date(expiresAt).toISOString());
});

test("the ledger CREDIT row records the wallet total as balance_after", async () => {
  // balance_after is the running WALLET TOTAL, not this row's amount and not the
  // bucket's remainder. Three different numbers, and only one of them is right.
  const templateId = await seedTemplate({ initialAmount: 250 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();
  await seedBucket(customerId, { initialValue: 300, remaining: 300 });
  await seedBucket(customerId, { initialValue: 40, remaining: 40 });

  await claimGiftCard({ code: issued.plaintext, customerId });

  const credits = await creditsForCode(issued.id);
  assert.equal(credits.length, 1);
  const credit = credits[0];
  assert.equal(credit.type, LEDGER_TYPE.CREDIT);
  assert.equal(Number(credit.amount), 250, "the amount is the face value");
  assert.equal(Number(credit.balance_after), 590, "340 already held + 250");
  assert.equal(credit.reference, "CLAIM");
  // The face value is not the wallet total, so this assertion is what makes the
  // previous one mean anything.
  assert.notEqual(Number(credit.balance_after), Number(credit.amount));
  assert.equal(await Wallet.balanceFor(customerId), 590);
});

test("the submitted code is matched whatever case or separators it was typed in", async () => {
  // Codes are printed in groups of four and read aloud, so normalizeCode folds
  // case and treats spaces as the separators they stand in for. That folding is
  // the whole reason one code is one row, and the claim goes through it.
  const templateId = await seedTemplate({ initialAmount: 100 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();

  const typed = issued.plaintext.replace(/-/g, " ").toUpperCase();
  assert.notEqual(typed, issued.code, "the typed form really is spelled differently");
  const claimed = await claimGiftCard({ code: `  ${typed}\t`, customerId });

  assert.equal(claimed.claimedValue, 100);
  assert.equal((await bucketsForCode(issued.id)).length, 1);
});

// ============================================================ frozen scope

test("the bucket freezes the template's applicability onto the claim", async () => {
  const templateId = await seedTemplate({ initialAmount: 2000 });
  await setScope(templateId, [
    { kind: "BRAND", value: "Nila Organics" },
    { kind: "CATEGORY", value: "spices" },
  ]);
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();

  await claimGiftCard({ code: issued.plaintext, customerId });

  const [bucket] = await bucketsForCode(issued.id);
  // The canonical form is the same [{ type, value }] pair the database stores
  // and the only shape the wallet model reads back (mapBucket drops anything
  // that is not an array).
  assert.deepEqual(bucket.applicability, [
    { type: "BRAND", value: "Nila Organics" },
    { type: "CATEGORY", value: "spices" },
  ]);
  // Round-tripping it through the pure reader must agree, or the frozen value
  // would be in a shape the checkout allocator cannot honour.
  const scope = normalizeScope(bucket.applicability);
  assert.equal(scope.malformed, false);
  assert.deepEqual(scope.brands, ["Nila Organics"]);
  assert.deepEqual(scope.categories, ["spices"]);
});

test("a code from a template with no applicability leaves the bucket unrestricted", async () => {
  // The absence of rows is the whole signal for UNRESTRICTED, and it has to
  // survive the trip through normalizeScope as an empty list — not as null, and
  // not as a scope the checkout reader would fail closed on.
  const templateId = await seedTemplate({ initialAmount: 400 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();

  await claimGiftCard({ code: issued.plaintext, customerId });

  const [bucket] = await bucketsForCode(issued.id);
  assert.deepEqual(bucket.applicability, []);
  assert.equal(normalizeScope(bucket.applicability).malformed, false);
  assert.deepEqual(normalizeScope(bucket.applicability), {
    brands: [],
    categories: [],
    productIds: [],
    malformed: false,
  });
});

test("a scope edited on the template after a claim does not rewrite the claimed bucket", async () => {
  // The claim freezes the terms the money was accepted under. An admin widening
  // a template's scope afterwards must not turn money already redeemed into
  // unrestricted spending, and narrowing it must not strand value either.
  const templateId = await seedTemplate({ initialAmount: 600 });
  await setScope(templateId, [{ kind: "BRAND", value: "Nila Organics" }]);
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();

  await claimGiftCard({ code: issued.plaintext, customerId });
  const [bucket] = await bucketsForCode(issued.id);
  assert.deepEqual(bucket.applicability, [{ type: "BRAND", value: "Nila Organics" }]);

  // The admin form re-saves a template's whole scope, so the rows are replaced
  // rather than appended to.
  await scratch.query("DELETE FROM gift_card_applicability WHERE template_id = $1", [templateId]);
  await setScope(templateId, [{ kind: "CATEGORY", value: "spices" }]);

  const reread = await scratch.query(
    "SELECT applicability FROM customer_wallet_buckets WHERE id = $1",
    [bucket.id]
  );
  assert.deepEqual(reread.rows[0].applicability, [{ type: "BRAND", value: "Nila Organics" }]);

  // And a second claim on the same template picks up the new scope, which is the
  // point of freezing per claim rather than per template.
  const later = await issueCode(templateId);
  await claimGiftCard({ code: later.plaintext, customerId });
  const [laterBucket] = await bucketsForCode(later.id);
  assert.deepEqual(laterBucket.applicability, [{ type: "CATEGORY", value: "spices" }]);
});

test("an unreadable template scope fails closed and credits nothing", async () => {
  // normalizeScope reports `malformed` for a scope it cannot read, and every
  // consumer treats that as "restricted to nothing". A claim must therefore not
  // freeze it as an empty list, which would silently WIDEN a restriction nobody
  // could read. The gift_card_applicability CHECK makes this unreachable in
  // production, so the CHECK is dropped for this one test — the point is the
  // service's behaviour if the shape ever changes.
  const constraint = (
    await scratch.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'gift_card_applicability'::regclass
         AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%'`
    )
  ).rows[0]?.conname;
  assert.ok(constraint, "the kind CHECK must exist to be dropped");

  const templateId = await seedTemplate({ initialAmount: 700 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();

  await scratch.query(`ALTER TABLE gift_card_applicability DROP CONSTRAINT ${constraint}`);
  try {
    await scratch.query(
      "INSERT INTO gift_card_applicability (template_id, kind, value) VALUES ($1, 'COLOUR', 'red')",
      [templateId]
    );

    const outcome = await attempt(issued.plaintext, customerId);
    assert.equal(DECLINE(outcome), "SCOPE_UNREADABLE");
    assert.deepEqual(await bucketsForCode(issued.id), [], "no bucket, so no value anywhere");
    assert.equal(await Wallet.balanceFor(customerId), 0);
    assert.equal((await codeRow(issued.id)).status, CODE_STATUS.UNUSED, "the code is untouched and still claimable");
  } finally {
    // The offending row goes before the constraint, or re-adding the CHECK
    // would fail on the very row this test exists to create.
    await scratch.query("DELETE FROM gift_card_applicability WHERE template_id = $1", [templateId]);
    await scratch.query(
      `ALTER TABLE gift_card_applicability ADD CONSTRAINT ${constraint} CHECK (kind IN ('BRAND', 'CATEGORY', 'PRODUCT'))`
    );
  }
});

// ============================================================== claiming twice

test("claiming the same code twice is refused and moves no further money", async () => {
  const templateId = await seedTemplate({ initialAmount: 1000 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();

  await claimGiftCard({ code: issued.plaintext, customerId });
  const afterFirst = await Wallet.balanceFor(customerId);
  const ledgerAfterFirst = await ledgerCount(customerId);

  const second = await attempt(issued.plaintext, customerId);
  assert.equal(DECLINE(second), "ALREADY_CLAIMED");

  assert.equal((await bucketsForCode(issued.id)).length, 1, "still one bucket");
  assert.equal((await creditsForCode(issued.id)).length, 1, "still one CREDIT row");
  assert.equal(await Wallet.balanceFor(customerId), afterFirst, "the wallet total is unchanged");
  assert.equal(await ledgerCount(customerId), ledgerAfterFirst, "and the ledger did not grow");
});

test("a code already claimed by another customer is refused for the second customer", async () => {
  const templateId = await seedTemplate({ initialAmount: 300 });
  const issued = await issueCode(templateId);
  const owner = await seedCustomer();
  const stranger = await seedCustomer();

  await claimGiftCard({ code: issued.plaintext, customerId: owner });
  const ownerBalance = await Wallet.balanceFor(owner);

  const outcome = await attempt(issued.plaintext, stranger);
  assert.equal(DECLINE(outcome), "ALREADY_CLAIMED");
  // "Already claimed" must not become a way to take someone's card: the second
  // customer gets nothing at all, and the first keeps everything.
  assert.equal(await Wallet.balanceFor(stranger), 0);
  assert.equal(await Wallet.balanceFor(owner), ownerBalance);
  assert.equal((await bucketsForCode(issued.id)).length, 1);
  assert.equal(Number((await codeRow(issued.id)).claimed_by), owner);
});

test("two real concurrent claims of one code: exactly one wins", async () => {
  const templateId = await seedTemplate({ initialAmount: 750 });
  const issued = await issueCode(templateId);
  const first = await seedCustomer();
  const second = await seedCustomer();

  // A third connection holds the code row's lock, so neither claimant can finish
  // before the other has asked for it. Without this the two promises could
  // happen to serialise by luck and the test would prove nothing about the lock.
  const blocker = await scratch.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM gift_card_codes WHERE id = $1 FOR UPDATE", [issued.id]);

  // Two independent connections, two real transactions, each naming itself so
  // pg_stat_activity can be watched for both of them piling up on the lock. The
  // client has to be threaded all the way through to claimGiftCard: a racer that
  // quietly fell back to the shared pool would not be the connection the blocker
  // is holding up, and the test would pass without ever racing anything.
  const race = async (customerId, label) => {
    const client = await scratch.connect();
    try {
      await client.query(`SET application_name = '${label}'`);
      return await attempt(issued.plaintext, customerId, { client });
    } finally {
      client.release();
    }
  };
  const pending = Promise.all([race(first, "claim-race-a"), race(second, "claim-race-b")]);

  const waiting = await waitForLockWaiters(["claim-race-a", "claim-race-b"]);
  await blocker.query("COMMIT");
  blocker.release();

  const outcomes = await pending;

  assert.equal(waiting.size, 2, `both claims must be queued on the row lock, saw ${[...waiting].join(", ")}`);
  assert.equal(outcomes.filter((o) => o.ok).length, 1, `expected one winner, got ${JSON.stringify(outcomes)}`);
  const loser = outcomes.find((o) => !o.ok);
  assert.equal(loser.code, "ALREADY_CLAIMED", "the loser is refused with a reason, not a driver error");

  // One code, one bucket, one CREDIT row, and exactly one face value of money.
  assert.equal((await bucketsForCode(issued.id)).length, 1);
  const credits = await creditsForCode(issued.id);
  assert.equal(credits.length, 1, "one code must never produce two CREDIT rows");

  const winner = outcomes.findIndex((o) => o.ok);
  const winnerId = winner === 0 ? first : second;
  const loserId = winner === 0 ? second : first;
  assert.equal(outcomes[winner].result.claimedValue, 750);
  assert.equal(await Wallet.balanceFor(winnerId), 750);
  assert.equal(await Wallet.balanceFor(loserId), 0);
  assert.equal((await Wallet.balanceFor(winnerId)) + (await Wallet.balanceFor(loserId)), 750);

  assert.equal(Number((await codeRow(issued.id)).claimed_by), winnerId);
  assert.equal(Number((await codeRow(issued.id)).claimed_value), 750);
});

// Waits until every named connection is parked on a lock, so "simultaneously"
// means it. Returns the names actually observed waiting, so a timeout can be
// reported instead of hanging the suite.
async function waitForLockWaiters(names, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const waiting = new Set();
  while (Date.now() < deadline) {
    const rows = (
      await scratch.query(
        `SELECT application_name FROM pg_stat_activity
         WHERE application_name = ANY($1::text[]) AND wait_event_type = 'Lock'`,
        [names]
      )
    ).rows;
    for (const row of rows) waiting.add(row.application_name);
    if (waiting.size === names.length) return waiting;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return waiting;
}

// ================================================================ refusals

test("a revoked code never credits a wallet, though its face value is still set", async () => {
  // Revocation is the whole reason face_value is not treated as spendable: the
  // number stays on the row for the audit trail and the value must not move.
  const templateId = await seedTemplate({ initialAmount: 5000 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();
  await revokeCode(issued.id);

  const outcome = await attempt(issued.plaintext, customerId);
  assert.equal(DECLINE(outcome), "REVOKED");

  const stillPriced = await scratch.query("SELECT face_value FROM gift_card_codes WHERE id = $1", [issued.id]);
  assert.equal(Number(stillPriced.rows[0].face_value), 5000, "revocation does not erase the value; it stops it moving");

  const stored = await codeRow(issued.id);
  assert.equal(Number(stored.claimed_value), 0, "nothing was recorded as claimed");
  assert.equal(stored.claimed_by, null);
  assert.deepEqual(await bucketsForCode(issued.id), []);
  assert.deepEqual(await creditsForCode(issued.id), []);
  assert.equal(await Wallet.balanceFor(customerId), 0);
  // Not even a wallet: the claim must have been refused before it created one.
  const wallets = await scratch.query("SELECT COUNT(*)::int AS n FROM customer_wallets WHERE customer_id = $1", [customerId]);
  assert.equal(wallets.rows[0].n, 0, "a refused claim must not leave an empty wallet behind");
});

test("an expired code is refused on its date, and the stored status is still UNUSED", async () => {
  // EXPIRED is derived from expires_at, never written. A sweeper that stamps a
  // status has a window between runs where a dead code still claims to be live,
  // and this assertion is what keeps that window from opening.
  const templateId = await seedTemplate({ initialAmount: 100 });
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  const issued = await issueCode(templateId, { expiresAt: expiredAt });
  const customerId = await seedCustomer();

  const outcome = await attempt(issued.plaintext, customerId);
  assert.equal(DECLINE(outcome), "EXPIRED");

  const stored = await codeRow(issued.id);
  assert.equal(stored.status, CODE_STATUS.UNUSED, "expiry is derived, never persisted");
  assert.equal(stored.claimed_by, null);
  assert.deepEqual(await bucketsForCode(issued.id), []);
  assert.equal(await Wallet.balanceFor(customerId), 0);
});

test("a code that is not yet paid for is refused, and one not yet delivered too", async () => {
  const templateId = await seedTemplate({ initialAmount: 100 });

  const unpaid = await issueCode(templateId);
  await forceStatus(unpaid.id, CODE_STATUS.PENDING_PAYMENT);
  const unpaidOwner = await seedCustomer();
  assert.equal(DECLINE(await attempt(unpaid.plaintext, unpaidOwner)), "NOT_PAID");

  const scheduled = await issueCode(templateId);
  await forceStatus(scheduled.id, CODE_STATUS.SCHEDULED);
  const scheduledOwner = await seedCustomer();
  assert.equal(DECLINE(await attempt(scheduled.plaintext, scheduledOwner)), "NOT_YET_DELIVERED");

  assert.deepEqual(await bucketsForCode(unpaid.id), []);
  assert.deepEqual(await bucketsForCode(scheduled.id), []);
  assert.equal(await Wallet.balanceFor(unpaidOwner), 0);
  assert.equal(await Wallet.balanceFor(scheduledOwner), 0);
});

test("a code that matches nothing is refused as NOT_FOUND", async () => {
  const customerId = await seedCustomer();

  // One word about the code and nothing else: a lookup that said "right length,
// wrong characters" would hand an attacker a cheaper search.
  const outcome = await attempt("GIFT-0000-0000", customerId);
  assert.equal(DECLINE(outcome), "NOT_FOUND");
  assert.equal(outcome.message, "We could not find a gift card for that code.");

  assert.equal(DECLINE(await attempt("", customerId)), "NOT_FOUND");
  assert.equal(DECLINE(await attempt("   ", customerId)), "NOT_FOUND");
  assert.equal(DECLINE(await attempt(undefined, customerId)), "NOT_FOUND");
  assert.equal(await Wallet.balanceFor(customerId), 0);
});

test("a claim without a customer is refused rather than credited to nobody", async () => {
  const templateId = await seedTemplate({ initialAmount: 100 });
  const issued = await issueCode(templateId);

  const outcome = await attempt(issued.plaintext, null);
  assert.equal(DECLINE(outcome), "NO_CUSTOMER");
  assert.deepEqual(await bucketsForCode(issued.id), []);
});

// ========================================================= the shared predicate

test("claimEligibility is the single predicate, and previewClaim never disagrees with the claim", async () => {
  const templateId = await seedTemplate({ initialAmount: 900 });
  const customerId = await seedCustomer();

  // Each case is a real code in a real state, and each is checked three ways:
  // the preview's own answer, the predicate applied to the same row, and what a
  // real claim actually did. The three can only agree if the preview and the
  // claim genuinely share one decision function.
  const cases = [];
  const valid = await issueCode(templateId);
  cases.push({ label: "valid", code: valid.plaintext, expect: null });

  const claimed = await issueCode(templateId);
  await claimGiftCard({ code: claimed.plaintext, customerId });
  cases.push({ label: "already claimed", code: claimed.plaintext, expect: "ALREADY_CLAIMED" });

  const revoked = await issueCode(templateId);
  await revokeCode(revoked.id);
  cases.push({ label: "revoked", code: revoked.plaintext, expect: "REVOKED" });

  const expired = await issueCode(templateId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  cases.push({ label: "expired", code: expired.plaintext, expect: "EXPIRED" });

  const unpaid = await issueCode(templateId);
  await forceStatus(unpaid.id, CODE_STATUS.PENDING_PAYMENT);
  cases.push({ label: "not paid", code: unpaid.plaintext, expect: "NOT_PAID" });

  const scheduled = await issueCode(templateId);
  await forceStatus(scheduled.id, CODE_STATUS.SCHEDULED);
  cases.push({ label: "not delivered", code: scheduled.plaintext, expect: "NOT_YET_DELIVERED" });

  cases.push({ label: "unknown", code: "GIFT-XXXX-XXXX", expect: "NOT_FOUND" });

  for (const item of cases) {
    const preview = await previewClaim({ code: item.code });
    const row = item.label === "unknown" ? null : await GiftCardCode.findByPlaintext(item.code);
    const direct = claimEligibility(row);

    assert.equal(preview.claimable, item.expect === null, `${item.label}: preview claimable`);
    assert.equal(preview.reason, item.expect, `${item.label}: preview reason`);
    assert.equal(direct.ok, item.expect === null, `${item.label}: predicate ok`);
    assert.equal(direct.ok ? null : direct.code, item.expect, `${item.label}: predicate reason`);

    // The claim itself, on a customer who has never seen these codes, so a
    // previously-claimed case is refused for ownership rather than for being
    // the same customer twice.
    const outcome = await attempt(item.code, await seedCustomer());
    assert.equal(outcome.ok, item.expect === null, `${item.label}: the claim agrees`);
    assert.equal(outcome.ok ? null : outcome.code, item.expect, `${item.label}: the claim's reason`);

    if (item.expect === null) {
      assert.equal(preview.faceValue, 900, `${item.label}: preview reports the face value`);
      assert.equal(preview.currency, "INR");
    }
  }
});

test("previewClaim reports the face value and writes nothing", async () => {
  const templateId = await seedTemplate({ initialAmount: 1000 });
  await setScope(templateId, [{ kind: "CATEGORY", value: "spices" }]);
  const issued = await issueCode(templateId, {
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });

  // Every count and every timestamp before and after, because "read-only" is a
  // property of the writes, not of the absence of an obvious statement.
  const snapshot = async () => ({
    codes: await scratch.query("SELECT id, status, claimed_by, claimed_value, updated_at FROM gift_card_codes ORDER BY id"),
    wallets: await scratch.query("SELECT id, created_at, updated_at FROM customer_wallets ORDER BY id"),
    buckets: await scratch.query("SELECT id, remaining, updated_at FROM customer_wallet_buckets ORDER BY id"),
    ledger: await scratch.query("SELECT id FROM customer_reward_transactions ORDER BY id"),
  });
  const before = await snapshot();

  const preview = await previewClaim({ code: issued.plaintext });

  assert.equal(preview.claimable, true);
  assert.equal(preview.faceValue, 1000, "so the UI can say what the card is worth before committing");
  assert.equal(preview.currency, "INR");
  assert.equal(preview.status, CODE_STATUS.UNUSED);
  assert.ok(preview.expiresAt, "and when it dies");

  const after = await snapshot();
  assert.deepEqual(after.codes.rows, before.codes.rows, "no code row was touched, updated_at included");
  assert.deepEqual(after.wallets.rows, before.wallets.rows, "no wallet was created");
  assert.deepEqual(after.buckets.rows, before.buckets.rows);
  assert.deepEqual(after.ledger.rows, before.ledger.rows);

  // And the claim it previewed still works, so the preview was not a promise
  // about a code that had already gone.
  const customerId = await seedCustomer();
  const claimed = await claimGiftCard({ code: issued.plaintext, customerId });
  assert.equal(claimed.claimedValue, 1000);
});

test("previewClaim says NOT_FOUND for a code that does not exist", async () => {
  const preview = await previewClaim({ code: "GIFT-ZZZZ-ZZZZ" });
  assert.equal(preview.claimable, false);
  assert.equal(preview.reason, "NOT_FOUND");
  assert.equal(preview.faceValue, null);
  assert.equal(preview.status, null);
});

// ================================================================ no leaks

test("no plaintext code reaches a log line, an error message or a preview result", async () => {
  const templateId = await seedTemplate({ initialAmount: 120 });
  const issued = await issueCode(templateId);
  const revoked = await issueCode(templateId);
  await revokeCode(revoked.id);
  const customerId = await seedCustomer();

  // How the capture works: process.stdout.write and process.stderr.write are
  // every console.* method ultimately calls, so replacing those two catches
  // anything this process emits — including a stack trace. Each write is teed
  // (recorded AND forwarded) so the TAP output of the surrounding run is not
  // swallowed and lost.
  const captured = [];
  const tee = (original) => (chunk, ...rest) => {
    captured.push(util.format(chunk));
    return original(chunk, ...rest);
  };
  const realStdout = process.stdout.write.bind(process.stdout);
  const realStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = tee(realStdout);
  process.stderr.write = tee(realStderr);

  // A self-check first: without it, an empty buffer would make every assertion
  // below pass for the wrong reason.
  const marker = `capture-self-check-${randomUUID()}`;
  console.error(marker);

  try {
    assert.ok(
      captured.some((line) => line.includes(marker)),
      "the capture must observe its own marker, or it is not capturing"
    );
    captured.length = 0;

    const claimed = await claimGiftCard({ code: issued.plaintext, customerId });
    const revokedOutcome = await attempt(revoked.plaintext, customerId);
    const missing = await attempt("GIFT-0000-0000", customerId);
    const preview = await previewClaim({ code: issued.plaintext });

    // Something must actually have been captured during the window, or this is
    // still a vacuous pass. The claim itself is silent by design, so the
    // refusals are logged here to give the buffer content.
    console.error("claim-outcome", claimed.claimedValue, claimed.currency, DECLINE(missing));
    assert.equal(DECLINE(revokedOutcome), "REVOKED");

    const transcript = captured.join("\n");
    for (const secret of [issued.plaintext, revoked.plaintext]) {
      assert.equal(transcript.includes(secret), false, `plaintext leaked into output: ${secret}`);
      assert.equal(transcript.includes(secret.toUpperCase()), false, "plaintext leaked in another case");
      assert.equal(transcript.includes(secret.replace(/-/g, "")), false, "plaintext leaked without separators");
      // The last four characters are the only part that may ever be shown.
      assert.equal(transcript.includes(issued.code_hash), false, "even the hash is not something to log");
    }
    assert.equal(transcript.includes("GIFT-0000-0000"), false, "a submitted-but-unknown code is not echoed either");

    // The error objects themselves, not just what was printed of them.
    for (const outcome of [revokedOutcome, missing]) {
      assert.equal(outcome.error instanceof ClaimError, true, "refusals are ClaimError, so the route can map them");
      assert.equal(outcome.error.message.includes(issued.plaintext), false);
      assert.equal(String(outcome.error.stack).includes(issued.plaintext), false);
    }
    assert.equal(JSON.stringify(preview).includes(issued.plaintext), false);
  } finally {
    process.stdout.write = realStdout;
    process.stderr.write = realStderr;
  }

  // The claim itself happened, so the leak test is not passing because nothing
  // ran.
  assert.equal((await bucketsForCode(issued.id)).length, 1);
});

// ================================================================== errors

test("ClaimError carries a stable code and is recognisable without importing the class", async () => {
  const templateId = await seedTemplate({ initialAmount: 100 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();
  await revokeCode(issued.id);

  const error = await attempt(issued.plaintext, customerId).then((o) => o.error);
  assert.equal(error.name, "ClaimError");
  assert.equal(error.code, "REVOKED");
  assert.ok(error instanceof Error);
  assert.match(error.message, /revoked/i);
  // The reason travels as a field, not by matching prose — the message is for a
  // human and the endpoint must not have to parse it.
  assert.equal(typeof error.code, "string");
  assert.match(error.code, /^[A-Z_]+$/);
});

test("every money figure the claim reports is whole paise", async () => {
  const templateId = await seedTemplate({ initialAmount: 999.99 });
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();

  const claimed = await claimGiftCard({ code: issued.plaintext, customerId });
  assert.equal(claimed.claimedValue, round2(999.99));
  assert.equal(claimed.claimedValue, 999.99);
  assert.equal(claimed.balanceAfter, 999.99);
  const credit = (await creditsForCode(issued.id))[0];
  assert.equal(Number(credit.amount), 999.99);
  assert.equal(Number(credit.balance_after), 999.99);
});

test.after(async () => {
  await scratch.end().catch(() => {});
  await modelPool.end().catch(() => {});
});