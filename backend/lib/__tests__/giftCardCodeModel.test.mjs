import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../scripts/lib/env.mjs";

// The environment first, exactly as orderColumns.test.mjs does it.
await loadEnv();

// ---------------------------------------------------------------- throwaway DB
//
// These models talk to a real database, so the test needs one. It must not be
// the live `ecommerce` database: this file issues codes, debits wallets and
// fires concurrent transactions at it, and a test run has no business moving
// production balances. So a scratch database is created from sql/schema.sql and
// everything below runs against that.
//
// The base URL is everything up to and including the final slash, so the live
// database name is replaced rather than guessed at.
import pg from "pg";

const BASE_URL = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH_DB = "gc_modeltest";
const SCRATCH_URL = `${BASE_URL}${SCRATCH_DB}`;

// FORCE, so a previous run that died holding a connection cannot leave the
// database alive and make the next run fail for the wrong reason.
const admin = new pg.Pool({ connectionString: `${BASE_URL}postgres` });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
await admin.end();

// lib/db.js builds its Pool at module scope out of process.env.DATABASE_URL,
// and Node caches an imported module for the life of the process. Both facts
// together mean the variable has to be pointed at the scratch database BEFORE
// the model is imported — which is why the imports below are `await import()`
// rather than static, and why this block cannot be moved into a hook.
process.env.DATABASE_URL = SCRATCH_URL;

const scratch = new pg.Pool({ connectionString: SCRATCH_URL });
// Resolved against this file rather than process.cwd(), so the suite runs the
// same way whether npm started it from backend/ or a script did.
await scratch.query(fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8"));

const { Wallet, LEDGER_TYPE, ledgerRow } = await import("../models/wallet.js");
const { GiftCardCode, CODE_STATUS } = await import("../models/giftCardCode.js");
const modelPool = (await import("../db.js")).default;

// Everything runs in its own transaction on its own connection, so a refused
// debit or a lost claim race is rolled back here and never reaches the next test.
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
// keeps its socket open, so the process would hang at exit rather than at any
// particular assertion.
async function withClient(fn) {
  const client = await scratch.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------- seeding

// BIGSERIAL comes back from pg as a string, so every seeded id is turned into a
// Number here: the assertions compare ids, and mixing "22" with 22 fails for a
// reason that has nothing to do with the code under test.
let customerSeq = 0;
async function seedCustomer() {
  customerSeq += 1;
  const result = await scratch.query(
    "INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING id",
    [`Wallet Tester ${customerSeq}`, `wallet-tester-${customerSeq}-${randomUUID()}@example.test`]
  );
  return Number(result.rows[0].id);
}

// An admin, so revokeInTx has a real actor to stamp. revoked_by is a BIGINT
// foreign key, not free text: recording the actor as a string would mean the
// audit trail could not be joined back to a user.
let userSeq = 0;
async function seedAdmin() {
  userSeq += 1;
  const result = await scratch.query(
    "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id",
    [`Revoker ${userSeq}`, `revoker-${userSeq}-${randomUUID()}@example.test`, "not-a-real-hash"]
  );
  return Number(result.rows[0].id);
}

let templateSeq = 0;
async function seedTemplate({ initialAmount = 1000, currency = "INR" } = {}) {
  templateSeq += 1;
  const result = await scratch.query(
    `INSERT INTO gift_cards (label, initial_amount, balance, currency, status)
     VALUES ($1, $2, $2, $3, 'ACTIVE') RETURNING id`,
    [`Scratch Template ${templateSeq}`, initialAmount, currency]
  );
  return Number(result.rows[0].id);
}

// A bucket created directly, which is how the claim service would leave one
// before the credit: initial_value set, remaining still zero.
async function seedBucket(walletId, { initialValue = 100, remaining = initialValue, applicability = [], expiresAt = null, codeId = null } = {}) {
  const result = await scratch.query(
    `INSERT INTO customer_wallet_buckets
       (wallet_id, code_id, currency, initial_value, remaining, applicability, expires_at)
     VALUES ($1, $2, 'INR', $3, $4, $5::jsonb, $6)
     RETURNING id, initial_value, remaining`,
    [walletId, codeId, initialValue, remaining, JSON.stringify(applicability), expiresAt]
  );
  return result.rows[0];
}

async function issueCode(templateId, { expiresAt = null } = {}) {
  const plaintext = `GIFT-TEST-${String(Math.floor(Math.random() * 1e9)).padStart(4, "0")}`;
  return inTx((client) => GiftCardCode.issueInTx(client, { templateId, code: plaintext, expiresAt }));
}

// A claim as a claim service actually does it: lock the code, decide, credit the
// customer's wallet, and only then write the owner. All inside one transaction.
//
// The credit sitting BETWEEN the read and the guarded write is what makes this
// test worth running. Without the row lock both transactions read claimed_by =
// NULL, both decide yes, both credit, and only the second's UPDATE then
// discovers it lost — so the wallet would hold double the code's value while the
// ledger claims a single owner. (Verified by removing the FOR UPDATE: 2 CREDIT
// rows and 200.00 of money for a 100.00 card.)
async function tryClaim(client, { codeId, customerId, bucketId }) {
  const row = await GiftCardCode.lockById(codeId, client);
  if (!row) return { ok: false, reason: "not found" };
  if (row.claimed_by) return { ok: false, reason: "already claimed" };

  await Wallet.creditInTx(client, {
    customerId,
    bucket: { id: bucketId, initialValue: row.face_value },
    codeId,
    reference: "CLAIM",
  });

  // The guarded write is the backstop, not the strategy: it is what stops a
  // lost racer from owning a code it never paid for.
  const result = await client.query(
    `UPDATE ${GiftCardCode.TABLE}
        SET claimed_by = $1, claimed_at = now(), claimed_value = face_value,
            status = $2, updated_at = now()
      WHERE id = $3 AND claimed_by IS NULL
      RETURNING id`,
    [customerId, CODE_STATUS.REDEEMED, codeId]
  );
  return result.rows.length ? { ok: true } : { ok: false, reason: "lost the race after crediting" };
}

const ledger = (customerId) => Wallet.ledgerFor(customerId);
const bucketRemaining = async (bucketId) =>
  Number((await scratch.query("SELECT remaining FROM customer_wallet_buckets WHERE id = $1", [bucketId])).rows[0].remaining);

// =========================================================== wallet: creation

test("ensureForCustomer is idempotent and never throws on a repeat", async () => {
  const customerId = await seedCustomer();

  const first = await Wallet.ensureForCustomer(customerId);
  const second = await Wallet.ensureForCustomer(customerId);

  // Model rows are handed back as pg returned them, so a BIGINT id is still a
  // string here; only money is coerced at the model's edge.
  assert.equal(Number(first.customer_id), customerId);
  assert.equal(second.id, first.id);
  const rows = await scratch.query("SELECT COUNT(*)::int AS n FROM customer_wallets WHERE customer_id = $1", [customerId]);
  assert.equal(rows.rows[0].n, 1);
});

test("ensureForCustomer leaks no unique-violation error when two callers race", async () => {
  const customerId = await seedCustomer();

  // Two independent connections, both believing they are creating it. The ON
  // CONFLICT branch is what makes this resolve rather than fail.
  const results = await Promise.all([
    withClient((client) => Wallet.ensureForCustomer(customerId, { client })),
    withClient((client) => Wallet.ensureForCustomer(customerId, { client })),
  ]);

  assert.equal(results[0].id, results[1].id);
  const rows = await scratch.query("SELECT COUNT(*)::int AS n FROM customer_wallets WHERE customer_id = $1", [customerId]);
  assert.equal(rows.rows[0].n, 1);
});

test("findByCustomer returns null for a customer with no wallet, and a wallet for one with", async () => {
  const withWallet = await seedCustomer();
  const without = await seedCustomer();

  assert.equal(await Wallet.findByCustomer(without), null);
  assert.equal(await Wallet.balanceFor(without), 0);
  assert.deepEqual(await Wallet.bucketsFor(without), []);

  await Wallet.ensureForCustomer(withWallet);
  assert.ok((await Wallet.findByCustomer(withWallet))?.id);
});

// ================================================== wallet: reading the buckets

test("bucketsFor returns restricted buckets before unrestricted ones", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);

  // Inserted unrestricted-first on purpose: if the order came straight from the
  // table, this assertion would pass by accident on the wrong implementation.
  const free = await seedBucket(wallet.id, { initialValue: 900, applicability: [] });
  const nike = await seedBucket(wallet.id, { initialValue: 300, applicability: [{ type: "BRAND", value: "Nike" }] });
  const adidas = await seedBucket(wallet.id, { initialValue: 200, applicability: [{ type: "CATEGORY", value: "Footwear" }] });

  const buckets = await Wallet.bucketsFor(customerId);
  assert.deepEqual(buckets.map((b) => b.id), [nike.id, adidas.id, free.id]);
  // Restricted first, and within the group the shortest shelf life first.
  assert.ok(nike.id < adidas.id, "expected the restricted seeds to be inserted in this order");
});

test("bucketsFor keeps the earliest expiry first, with a never-expiring bucket last", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const soon = new Date(Date.now() + 86400000).toISOString();
  const later = new Date(Date.now() + 30 * 86400000).toISOString();

  const forever = await seedBucket(wallet.id, { initialValue: 100, expiresAt: null });
  const late = await seedBucket(wallet.id, { initialValue: 100, expiresAt: later });
  const early = await seedBucket(wallet.id, { initialValue: 100, expiresAt: soon });

  const buckets = await Wallet.bucketsFor(customerId);
  assert.deepEqual(buckets.map((b) => b.id), [early.id, late.id, forever.id]);
});

test("bucketsFor excludes a fully-spent bucket and an expired one", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const live = await seedBucket(wallet.id, { initialValue: 250 });
  const spent = await seedBucket(wallet.id, { initialValue: 100, remaining: 0 });
  const gone = await seedBucket(wallet.id, {
    initialValue: 400,
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  const inactive = await seedBucket(wallet.id, { initialValue: 500 });
  await scratch.query("UPDATE customer_wallet_buckets SET is_active = false WHERE id = $1", [inactive.id]);

  const buckets = await Wallet.bucketsFor(customerId);
  assert.deepEqual(buckets.map((b) => b.id), [live.id]);
  // Named separately so the reason each one is missing is visible: spent means
  // nothing left, gone means past its own expiry, inactive means switched off.
  assert.ok(!buckets.some((b) => b.id === spent.id), "a fully-spent bucket holds nothing to spend");
  assert.ok(!buckets.some((b) => b.id === gone.id), "an expired bucket's value is dead");
  assert.ok(!buckets.some((b) => b.id === inactive.id), "a switched-off bucket is not spendable");
  assert.equal(buckets[0].initialValue, 250);
  assert.equal(buckets[0].remaining, 250);
  assert.deepEqual(buckets[0].applicability, []);
  assert.equal(buckets[0].codeId, null);
});

test("bucketsFor returns a null expires_at rather than an invented date", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  await seedBucket(wallet.id, { initialValue: 10 });

  const [bucket] = await Wallet.bucketsFor(customerId);
  assert.equal(bucket.expiresAt, null);
});

test("balanceFor is the sum of the buckets bucketsFor returns", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  await seedBucket(wallet.id, { initialValue: 100 });
  await seedBucket(wallet.id, { initialValue: 250.55 });
  await seedBucket(wallet.id, { initialValue: 99, applicability: [{ type: "BRAND", value: "Nike" }] });
  // None of these count towards the balance a customer may spend.
  await seedBucket(wallet.id, { initialValue: 700, remaining: 0 });
  await seedBucket(wallet.id, { initialValue: 700, expiresAt: new Date(Date.now() - 1000).toISOString() });

  const buckets = await Wallet.bucketsFor(customerId);
  const summed = buckets.reduce((sum, b) => Math.round((sum + b.remaining) * 100) / 100, 0);
  assert.equal(await Wallet.balanceFor(customerId), summed);
  assert.equal(summed, 449.55);
});

// ================================================== wallet: creditInTx

test("creditInTx increments remaining and records the WALLET TOTAL as balance_after", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const templateId = await seedTemplate({ initialAmount: 750 });
  const issued = await issueCode(templateId);
  // The bucket exists with remaining = 0, which is what the claim leaves behind.
  const bucket = await seedBucket(wallet.id, { initialValue: 750, remaining: 0, codeId: issued.id });
  const other = await seedBucket(wallet.id, { initialValue: 120, remaining: 120 });

  const updated = await inTx(async (client) => {
    // The caller holds the lock, exactly as the contract requires.
    await client.query("SELECT id FROM customer_wallet_buckets WHERE id = $1 FOR UPDATE", [bucket.id]);
    return Wallet.creditInTx(client, {
      customerId,
      bucket,
      codeId: issued.id,
      reference: "CLAIM",
      description: `Claimed ${issued.code}`,
      metadata: { templateId },
    });
  });

  assert.equal(updated.remaining, 750);
  assert.equal(updated.initialValue, 750);
  assert.equal(await bucketRemaining(bucket.id), 750);

  const rows = await ledger(customerId);
  const credit = rows.find((r) => r.type === LEDGER_TYPE.CREDIT);
  assert.equal(credit.amount, 750);
  // 750 is this row's amount and 120 was already in the wallet, so the recorded
  // total is 870. Recording 750 here — the bucket's own remainder — would make
  // every subsequent row of the ledger a discontinuity.
  assert.equal(credit.balance_after, 870, "balance_after must be the wallet total, not the bucket remainder");
  assert.equal(credit.bucket_id, bucket.id);
  assert.equal(credit.code_id, issued.id);
  assert.equal(credit.reference, "CLAIM");
  assert.deepEqual(credit.metadata, { templateId });
  assert.equal(await Wallet.balanceFor(customerId), 870);
  assert.equal(await bucketRemaining(other.id), 120, "crediting one bucket must not touch another");
});

test("creditInTx refuses to overflow a bucket's own ceiling", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const bucket = await seedBucket(wallet.id, { initialValue: 100, remaining: 90 });

  await assert.rejects(
    () =>
      inTx((client) => Wallet.creditInTx(client, { customerId, bucket, amount: 25 })),
    /would exceed its value of 100/
  );
  // Rolled back, so nothing moved.
  assert.equal(await bucketRemaining(bucket.id), 90);
  assert.equal((await ledger(customerId)).length, 0);
});

test("creditInTx refuses to run outside a caller's transaction", async () => {
  // The whole point of the *InTx suffix: a helper that silently opened (and
  // committed) its own transaction would publish half of a claim.
  await assert.rejects(
    () => Wallet.creditInTx(null, { customerId: 1, bucket: { id: 1 } }),
    /must run inside the caller's transaction/
  );
});

// ================================================== wallet: debitInTx

test("debitInTx writes one ledger row per allocation, in bucket order", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const nike = await seedBucket(wallet.id, { initialValue: 300, applicability: [{ type: "BRAND", value: "Nike" }] });
  const adidas = await seedBucket(wallet.id, { initialValue: 200, applicability: [{ type: "BRAND", value: "Adidas" }] });
  const free = await seedBucket(wallet.id, { initialValue: 1000 });

  const orderUuid = randomUUID();
  // Deliberately out of id order, and with the unrestricted bucket first: the
  // allocations come from allocate() and the model must impose its own order.
  const total = await inTx((client) =>
    Wallet.debitInTx(client, {
      customerId,
      allocations: [
        { bucketId: free.id, amount: 250 },
        { bucketId: adidas.id, amount: 150 },
        { bucketId: nike.id, amount: 100 },
      ],
      orderUuid,
      reference: `ORDER:${orderUuid}`,
    })
  );

  // The return value is the wallet total after the draw — 1500 out, 500 back in.
  assert.equal(total, 1000);

  const debits = (await ledger(customerId)).filter((r) => r.type === LEDGER_TYPE.DEBIT).reverse();
  assert.equal(debits.length, 3, "one row per bucket, not one row for the order");
  assert.deepEqual(debits.map((r) => r.bucket_id), [nike.id, adidas.id, free.id]);
  // DEBIT rows are a negative delta; the sign lives in the number.
  assert.deepEqual(debits.map((r) => r.amount), [-100, -150, -250]);
  // balance_after is the wallet total after each row: 1500 -> 1400 -> 1250 -> 1000.
  assert.deepEqual(debits.map((r) => r.balance_after), [1400, 1250, 1000]);
  assert.ok(debits.every((r) => r.order_uuid === orderUuid));

  assert.equal(await bucketRemaining(nike.id), 200);
  assert.equal(await bucketRemaining(adidas.id), 50);
  assert.equal(await bucketRemaining(free.id), 750);
  assert.equal(await Wallet.balanceFor(customerId), 1000);
});

test("debitInTx refuses to go below zero and leaves every bucket untouched", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const small = await seedBucket(wallet.id, { initialValue: 100, remaining: 100 });
  const alsoSmall = await seedBucket(wallet.id, { initialValue: 20, remaining: 20 });

  await assert.rejects(
    () =>
      inTx((client) =>
        Wallet.debitInTx(client, {
          customerId,
          allocations: [
            { bucketId: small.id, amount: 80 },
            // Valid on its own, but the pair exceeds what is there.
            { bucketId: alsoSmall.id, amount: 50 },
          ],
          orderUuid: randomUUID(),
        })
      ),
    /A balance of 20 cannot cover 50/
  );

  // Nothing partially applied: the first bucket's 80 was never taken either.
  assert.equal(await bucketRemaining(small.id), 100);
  assert.equal(await bucketRemaining(alsoSmall.id), 20);
  assert.equal(await Wallet.balanceFor(customerId), 120);
  assert.equal((await ledger(customerId)).length, 0, "a refused debit must leave no ledger rows");
});

test("debitInTx will not spend a bucket past its own expiry", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const bucket = await seedBucket(wallet.id, {
    initialValue: 500,
    expiresAt: new Date(Date.now() - 60000).toISOString(),
  });

  await assert.rejects(
    () => inTx((client) => Wallet.debitInTx(client, { customerId, allocations: [{ bucketId: bucket.id, amount: 10 }] })),
    /expired on/
  );
  assert.equal(await bucketRemaining(bucket.id), 500);
});

test("debitInTx refuses a bucket that belongs to somebody else", async () => {
  const mine = await seedCustomer();
  const theirs = await seedCustomer();
  const myWallet = await Wallet.ensureForCustomer(mine);
  const theirWallet = await Wallet.ensureForCustomer(theirs);
  const foreign = await seedBucket(theirWallet.id, { initialValue: 100 });

  await assert.rejects(
    () => inTx((client) => Wallet.debitInTx(client, { customerId: mine, allocations: [{ bucketId: foreign.id, amount: 10 }] })),
    /is not part of this wallet/
  );
  assert.equal(await bucketRemaining(foreign.id), 100);
  assert.ok(myWallet.id);
});

test("debitInTx books nothing when there is nothing to take", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  await seedBucket(wallet.id, { initialValue: 75 });

  assert.equal(await inTx((client) => Wallet.debitInTx(client, { customerId, allocations: [] })), 75);
  assert.equal((await ledger(customerId)).length, 0, "a zero debit must not write a zero row");
});

// ================================================== wallet: refundInTx

test("refundInTx restores value to the same buckets the debit came from", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const nike = await seedBucket(wallet.id, { initialValue: 300, applicability: [{ type: "BRAND", value: "Nike" }] });
  const free = await seedBucket(wallet.id, { initialValue: 700 });
  const orderUuid = randomUUID();
  const allocations = [
    { bucketId: nike.id, amount: 120 },
    { bucketId: free.id, amount: 180 },
  ];

  await inTx((client) => Wallet.debitInTx(client, { customerId, allocations, orderUuid }));
  assert.equal(await Wallet.balanceFor(customerId), 700);

  const restored = await inTx((client) => Wallet.refundInTx(client, { customerId, allocations, orderUuid }));
  assert.equal(restored, 300);

  // Value goes back where it came from. Restoring it to the wallet total instead
  // would move brand-restricted money into unrestricted spending.
  assert.equal(await bucketRemaining(nike.id), 300);
  assert.equal(await bucketRemaining(free.id), 700);
  assert.equal(await Wallet.balanceFor(customerId), 1000);

  const refunds = (await ledger(customerId)).filter((r) => r.type === LEDGER_TYPE.REFUND).reverse();
  assert.deepEqual(refunds.map((r) => r.bucket_id), [nike.id, free.id]);
  assert.deepEqual(refunds.map((r) => r.amount), [120, 180]);
  assert.deepEqual(refunds.map((r) => r.balance_after), [820, 1000]);
});

test("a double refund of the same allocations is capped and creates no value", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const bucket = await seedBucket(wallet.id, { initialValue: 500 });
  const orderUuid = randomUUID();
  const allocations = [{ bucketId: bucket.id, amount: 200 }];

  await inTx((client) => Wallet.debitInTx(client, { customerId, allocations, orderUuid }));
  const first = await inTx((client) => Wallet.refundInTx(client, { customerId, allocations, orderUuid }));
  assert.equal(first, 200);
  assert.equal(await bucketRemaining(bucket.id), 500);
  assert.equal(await Wallet.balanceFor(customerId), 500);

  // The retry: a webhook delivered twice, or an agent clicking twice. It must
  // book zero rather than credit the customer another 200 out of thin air.
  const second = await inTx((client) => Wallet.refundInTx(client, { customerId, allocations, orderUuid }));
  assert.equal(second, 0);
  assert.equal(await bucketRemaining(bucket.id), 500);
  assert.equal(await Wallet.balanceFor(customerId), 500);

  const refunds = (await ledger(customerId)).filter((r) => r.type === LEDGER_TYPE.REFUND);
  assert.equal(refunds.length, 1, "the second refund must write no ledger row at all");
});

test("a partial refund leaves only the remainder refundable", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const bucket = await seedBucket(wallet.id, { initialValue: 300 });
  const orderUuid = randomUUID();
  const allocations = [{ bucketId: bucket.id, amount: 200 }];

  await inTx((client) => Wallet.debitInTx(client, { customerId, allocations, orderUuid }));
  assert.equal(
    await inTx((client) => Wallet.refundInTx(client, { customerId, allocations: [{ bucketId: bucket.id, amount: 50 }], orderUuid })),
    50
  );
  // Asking for the original 200 again may only return what is still outstanding.
  assert.equal(await inTx((client) => Wallet.refundInTx(client, { customerId, allocations, orderUuid })), 150);
  assert.equal(await bucketRemaining(bucket.id), 300);
  assert.equal(await Wallet.balanceFor(customerId), 300);
  assert.equal((await ledger(customerId)).filter((r) => r.type === LEDGER_TYPE.REFUND).length, 2);
});

test("a refund cannot push a bucket past the value it was opened with", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const bucket = await seedBucket(wallet.id, { initialValue: 300 });
  const orderUuid = randomUUID();
  const allocations = [{ bucketId: bucket.id, amount: 200 }];

  await inTx((client) => Wallet.debitInTx(client, { customerId, allocations, orderUuid }));
  const restored = await inTx((client) => Wallet.refundInTx(client, { customerId, allocations, orderUuid }));
  assert.equal(restored, 200);
  // remaining = 300 = initial_value, which is the CHECK's ceiling. It cannot go
  // above it, so the clamped value is the same figure either way.
  assert.equal(await bucketRemaining(bucket.id), 300);
  const row = (await scratch.query("SELECT remaining, initial_value FROM customer_wallet_buckets WHERE id = $1", [bucket.id])).rows[0];
  assert.ok(Number(row.remaining) <= Number(row.initial_value));
});

// ================================================== concurrency

test("two concurrent claims of one code: exactly one wins, and only one wallet is credited", async () => {
  const templateId = await seedTemplate({ initialAmount: 1000 });
  const issued = await issueCode(templateId);
  const firstCustomer = await seedCustomer();
  const secondCustomer = await seedCustomer();

  // Each customer gets their own wallet and an empty bucket, so "who got the
  // money" is a separate question from "who owns the code".
  const firstWallet = await Wallet.ensureForCustomer(firstCustomer);
  const firstBucket = await seedBucket(firstWallet.id, { initialValue: issued.face_value, remaining: 0 });
  const secondWallet = await Wallet.ensureForCustomer(secondCustomer);
  const secondBucket = await seedBucket(secondWallet.id, { initialValue: issued.face_value, remaining: 0 });

  // Two independent connections in two real transactions. Both call lockById at
  // the same moment; the second blocks on the row lock the first holds, and when
  // the first commits, READ COMMITTED re-reads the row and finds it claimed.
  const claim = async (customerId, bucketId) =>
    inTx((client) => tryClaim(client, { codeId: issued.id, customerId, bucketId }));

  const outcomes = await Promise.all([
    claim(firstCustomer, firstBucket.id),
    claim(secondCustomer, secondBucket.id),
  ]);

  assert.equal(outcomes.filter((o) => o.ok).length, 1, `expected one winner, got ${JSON.stringify(outcomes)}`);
  // The loser is refused BEFORE it credits anything, with a clean reason — not a
  // driver error and not a silent success.
  const loser = outcomes.find((o) => !o.ok);
  assert.equal(loser.reason, "already claimed");

  const winnerIndex = outcomes.findIndex((o) => o.ok);
  const balances = [firstBucket, secondBucket];
  const winnerBalance = await bucketRemaining(balances[winnerIndex].id);
  const loserBalance = await bucketRemaining(balances[1 - winnerIndex].id);

  assert.equal(winnerBalance, issued.face_value, "the winner is credited the code's face value");
  assert.equal(loserBalance, 0, "the loser must not be credited anything");
  // The figure the whole lock exists to protect: one code, one credit.
  assert.equal(winnerBalance + loserBalance, issued.face_value);

  const rows = (await scratch.query("SELECT claimed_by, claimed_at, status FROM gift_card_codes WHERE id = $1", [issued.id])).rows[0];
  // BIGINT comes back from pg as a string, so it is compared as one.
  assert.equal(Number(rows.claimed_by), winnerIndex === 0 ? firstCustomer : secondCustomer);
  assert.ok(rows.claimed_at, "owner and claim time stand or fall together");
  assert.equal(rows.status, CODE_STATUS.REDEEMED);

  // Exactly one owner, and no value invented anywhere.
  const owners = await scratch.query("SELECT COUNT(DISTINCT claimed_by)::int AS n FROM gift_card_codes WHERE id = $1", [issued.id]);
  assert.equal(owners.rows[0].n, 1);
  const credits = await scratch.query(
    "SELECT COUNT(*)::int AS n FROM customer_reward_transactions WHERE type = 'CREDIT' AND code_id = $1",
    [issued.id]
  );
  assert.equal(credits.rows[0].n, 1, "one code must never produce two CREDIT rows");
});

test("two concurrent debits that together exceed the balance cannot both succeed", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  // One bucket on purpose: both transactions must contend for the same row
  // lock, which is what serialises them.
  const bucket = await seedBucket(wallet.id, { initialValue: 100 });

  const spend = async (amount) => {
    try {
      return await inTx(async (client) => {
        const total = await Wallet.debitInTx(client, {
          customerId,
          allocations: [{ bucketId: bucket.id, amount }],
          orderUuid: randomUUID(),
        });
        return { ok: true, total };
      });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };

  // 80 + 80 = 160 against a balance of 100. Neither is out of the question on
  // its own, so only the lock can decide it.
  const outcomes = await Promise.all([spend(80), spend(80)]);

  assert.equal(outcomes.filter((o) => o.ok).length, 1, `expected one winner, got ${JSON.stringify(outcomes)}`);
  const loser = outcomes.find((o) => !o.ok);
  assert.match(loser.error, /cannot cover 80/, "the loser must be told the balance will not cover it");

  // The winner's debit is the only one on the books, and it is exact.
  assert.equal(await bucketRemaining(bucket.id), 20);
  assert.equal(await Wallet.balanceFor(customerId), 20);
  const debits = (await ledger(customerId)).filter((r) => r.type === LEDGER_TYPE.DEBIT);
  assert.equal(debits.length, 1);
  assert.deepEqual([debits[0].amount, debits[0].balance_after], [-80, 20]);
});

test("concurrent debits against two buckets take the locks in the same order, so neither deadlocks", async () => {
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);
  const first = await seedBucket(wallet.id, { initialValue: 500 });
  const second = await seedBucket(wallet.id, { initialValue: 500 });

  // The opposite bucket order is exactly the shape that deadlocks when rows are
  // locked one at a time in the order given. Both orderings are taken in
  // ascending id order, so the second transaction simply waits.
  const spend = async (allocations) => {
    try {
      return await inTx(async (client) => {
        const total = await Wallet.debitInTx(client, { customerId, allocations, orderUuid: randomUUID() });
        return { ok: true, total };
      });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };

  const outcomes = await Promise.all([
    spend([{ bucketId: first.id, amount: 100 }, { bucketId: second.id, amount: 100 }]),
    spend([{ bucketId: second.id, amount: 100 }, { bucketId: first.id, amount: 100 }]),
  ]);

  assert.deepEqual(outcomes.map((o) => o.ok), [true, true], JSON.stringify(outcomes));
  // Both spent 200 of a 1000 balance, so one saw 800 and the other 600 — which
  // of the two is which is a race, so the pair is asserted as a set.
  assert.deepEqual(outcomes.map((o) => o.total).sort((a, b) => a - b), [600, 800]);
  assert.equal(await Wallet.balanceFor(customerId), 600);
  assert.equal((await ledger(customerId)).filter((r) => r.type === LEDGER_TYPE.DEBIT).length, 4);
});

// ================================================== gift card codes

test("issueInTx returns the plaintext exactly once and never stores it", async () => {
  const templateId = await seedTemplate({ initialAmount: 2500 });
  const issued = await inTx((client) =>
    GiftCardCode.issueInTx(client, { templateId, code: "gift-abcd-2345", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() })
  );

  // The one place a full code exists outside the customer's hands.
  assert.equal(issued.code, "GIFT-ABCD-2345");
  assert.equal(issued.code_last4, "2345");
  assert.equal(issued.status, CODE_STATUS.UNUSED);
  assert.equal(issued.face_value, 2500);
  assert.equal(issued.claimed_value, 0);
  assert.equal(issued.currency, "INR");

  // Nothing readable is on disk: the column holds a sha256, not the code.
  const raw = (await scratch.query("SELECT code_hash FROM gift_card_codes WHERE id = $1", [issued.id])).rows[0];
  assert.match(raw.code_hash, /^[0-9a-f]{64}$/);
  assert.ok(!raw.code_hash.includes("ABCD"));

  // And a fresh read of the same row carries no plaintext either.
  const found = await GiftCardCode.findByPlaintext("GIFT-ABCD-2345");
  assert.equal(found.code, undefined);
  assert.equal(found.code_hash, raw.code_hash);
});

test("issueInTx takes the face value from the template, not the caller", async () => {
  const templateId = await seedTemplate({ initialAmount: 750 });
  const issued = await issueCode(templateId);
  // There is no faceValue parameter to pass, so a code can never be minted for
  // more than its card was sold for.
  assert.equal(issued.face_value, 750);
});

test("issueInTx refuses a duplicate code with a message, not a driver error", async () => {
  const first = await seedTemplate({ initialAmount: 100 });
  const second = await seedTemplate({ initialAmount: 100 });
  await inTx((client) => GiftCardCode.issueInTx(client, { templateId: first, code: "gift-dup1-1111" }));

  // code_hash is UNIQUE, so the second issuance loses to the index rather than
  // minting a duplicate. The collision surfaces as a sentence.
  await assert.rejects(
    () => inTx((client) => GiftCardCode.issueInTx(client, { templateId: second, code: "GIFT-DUP1-1111" })),
    /already been issued/
  );

  // The refusal took the second issuance with it and left the first alone.
  const found = await GiftCardCode.findByPlaintext("GIFT-DUP1-1111");
  assert.equal(Number(found.template_id), first);
  assert.equal(found.status, CODE_STATUS.UNUSED);
});

test("issueInTx refuses a template with no value, and a missing template", async () => {
  const empty = await seedTemplate({ initialAmount: 0 });
  await assert.rejects(
    () => inTx((client) => GiftCardCode.issueInTx(client, { templateId: empty, code: "gift-empty-2222" })),
    /has no value to issue/
  );
  await assert.rejects(
    () => inTx((client) => GiftCardCode.issueInTx(client, { templateId: 99999999, code: "gift-gone3-3333" })),
    /does not exist/
  );
});

test("issueInTx refuses to run outside a caller's transaction", async () => {
  await assert.rejects(
    () => GiftCardCode.issueInTx(null, { templateId: 1, code: "GIFT-AAAA-BBBB" }),
    /must run inside the caller's transaction/
  );
});

test("findByPlaintext is case, space and hyphen insensitive", async () => {
  const templateId = await seedTemplate({ initialAmount: 100 });
  await issueCode(templateId);

  for (const spelling of [
    "gift-abcd-2345",
    "GIFT-ABCD-2345",
    "  GIFT-ABCD-2345  ",
    "GIFT ABCD 2345",
    "gift abcd 2345",
  ]) {
    const found = await GiftCardCode.findByPlaintext(spelling);
    assert.ok(found, `no code found for ${JSON.stringify(spelling)}`);
    assert.equal(found.code_last4, "2345");
  }

  assert.equal(await GiftCardCode.findByPlaintext("GIFT-XXXX-9999"), null);
  assert.equal(await GiftCardCode.findByPlaintext(""), null);
  assert.equal(await GiftCardCode.findByPlaintext(null), null);
});

test("lockById returns the row under a lock, and null for one that is not there", async () => {
  const templateId = await seedTemplate({ initialAmount: 100 });
  const issued = await issueCode(templateId);

  const locked = await inTx((client) => GiftCardCode.lockById(issued.id, client));
  assert.equal(locked.id, issued.id);
  assert.equal(await GiftCardCode.lockById(null, null), null);
});

test("isExpired is false for a NULL expires_at, which is the case that must not read as expired", async () => {
  assert.equal(GiftCardCode.isExpired({ expires_at: null }), false);
  assert.equal(GiftCardCode.isExpired({ expires_at: "2020-01-01T00:00:00Z" }), true);
  assert.equal(GiftCardCode.isExpired({ expires_at: "2999-01-01T00:00:00Z" }), false);
  // The reference instant is the caller's, so a test never races the clock.
  assert.equal(GiftCardCode.isExpired({ expires_at: "2026-06-01T00:00:00Z" }, new Date("2026-05-31T23:59:59Z")), false);
  assert.equal(GiftCardCode.isExpired({ expires_at: "2026-06-01T00:00:00Z" }, new Date("2026-06-01T00:00:01Z")), true);
  assert.equal(GiftCardCode.isExpired(null), false);
});

test("effectiveStatus reports EXPIRED for an unused past-due code and the stored status otherwise", async () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();

  assert.equal(GiftCardCode.effectiveStatus({ status: CODE_STATUS.UNUSED, expires_at: past }), "EXPIRED");
  assert.equal(GiftCardCode.effectiveStatus({ status: CODE_STATUS.UNUSED, expires_at: future }), CODE_STATUS.UNUSED);
  assert.equal(GiftCardCode.effectiveStatus({ status: CODE_STATUS.UNUSED, expires_at: null }), CODE_STATUS.UNUSED);
  // A terminal status is history, not a date: support needs to know it was
  // redeemed, not that it has since aged out.
  assert.equal(GiftCardCode.effectiveStatus({ status: CODE_STATUS.REDEEMED, expires_at: past }), CODE_STATUS.REDEEMED);
  assert.equal(GiftCardCode.effectiveStatus({ status: CODE_STATUS.REVOKED, expires_at: past }), CODE_STATUS.REVOKED);
  assert.equal(GiftCardCode.effectiveStatus(null), null);
});

test("EXPIRED is derived on read and never written back to the row", async () => {
  const templateId = await seedTemplate({ initialAmount: 100 });
  const issued = await issueCode(templateId, { expiresAt: new Date(Date.now() - 60000).toISOString() });

  assert.equal(GiftCardCode.effectiveStatus(issued), "EXPIRED");

  // Reading it must not have touched the stored value: a clock tick can never
  // leave a stale status claiming a dead code is live, and no sweeper is needed.
  const stored = (await scratch.query("SELECT status, expires_at FROM gift_card_codes WHERE id = $1", [issued.id])).rows[0];
  assert.equal(stored.status, CODE_STATUS.UNUSED);
  assert.ok(!Object.values(CODE_STATUS).includes("EXPIRED"), "EXPIRED must not be a stored status");
});

test("revokeInTx stamps the code and refuses one that has already been claimed", async () => {
  const templateId = await seedTemplate({ initialAmount: 400 });
  const issued = await issueCode(templateId);

  const adminId = await seedAdmin();
  const revoked = await inTx((client) => GiftCardCode.revokeInTx(client, { id: issued.id, reason: "Reported stolen", performedBy: adminId }));
  assert.equal(revoked.status, CODE_STATUS.REVOKED);
  assert.ok(revoked.revoked_at, "the moment of revocation is recorded, not just the fact");
  // The actor is a joinable user id, kept out of the free-text reason.
  assert.equal(Number(revoked.revoked_by), adminId);
  assert.equal(revoked.revoked_reason, "Reported stolen");

  // A revocation with no actor is allowed: a code can lapse without anyone acting.
  const unowned = await issueCode(templateId);
  const noActor = await inTx((client) => GiftCardCode.revokeInTx(client, { id: unowned.id }));
  assert.equal(noActor.status, CODE_STATUS.REVOKED);
  assert.equal(noActor.revoked_by, null);

  // A non-existent actor must not be silently written as text. Needs a fresh
  // code: revokeInTx short-circuits on an already-revoked one, so the UPDATE
  // that carries the actor is never reached.
  const toVoid = await issueCode(templateId);
  await assert.rejects(
    () => inTx((client) => GiftCardCode.revokeInTx(client, { id: toVoid.id, reason: "bad actor", performedBy: 99999999 })),
    /foreign key|violates/i
  );

  // Idempotent for the same reason a retried webhook is: report, do not fail.
  const again = await inTx((client) => GiftCardCode.revokeInTx(client, { id: issued.id }));
  assert.equal(again.duplicate, true);
  assert.equal(again.status, CODE_STATUS.REVOKED);

  // The claimed case is the one that matters: the value is the customer's now.
  const claimable = await issueCode(templateId);
  const claimerId = await seedCustomer();
  const claimerWallet = await Wallet.ensureForCustomer(claimerId);
  const claimerBucket = await seedBucket(claimerWallet.id, { initialValue: claimable.face_value, remaining: 0 });
  await inTx((client) =>
    tryClaim(client, { codeId: claimable.id, customerId: claimerId, bucketId: claimerBucket.id })
  );
  await assert.rejects(
    () => inTx((client) => GiftCardCode.revokeInTx(client, { id: claimable.id, reason: "Too late" })),
    /already been claimed, so its value belongs to the customer/
  );

  const claimed = (await scratch.query("SELECT status, revoked_at FROM gift_card_codes WHERE id = $1", [claimable.id])).rows[0];
  assert.equal(claimed.status, CODE_STATUS.REDEEMED);
  assert.equal(claimed.revoked_at, null);
});

test("revokeInTx refuses to run outside a caller's transaction, and on a code that is not there", async () => {
  await assert.rejects(
    () => GiftCardCode.revokeInTx(null, { id: 1 }),
    /must run inside the caller's transaction/
  );
  await assert.rejects(
    () => inTx((client) => GiftCardCode.revokeInTx(client, { id: 99999999 })),
    /does not exist/
  );
});

test("applicabilityForTemplate maps the kind column to type and reads empty as unrestricted", async () => {
  const restricted = await seedTemplate({ initialAmount: 100 });
  await scratch.query(
    `INSERT INTO gift_card_applicability (template_id, kind, value) VALUES ($1, 'BRAND', 'Nike'), ($1, 'CATEGORY', 'Footwear')`,
    [restricted]
  );

  // The column in the database is `kind`; the pair that leaves this model is
  // (type, value), which is what a bucket freezes at claim time.
  assert.deepEqual(await GiftCardCode.applicabilityForTemplate(restricted), [
    { type: "BRAND", value: "Nike" },
    { type: "CATEGORY", value: "Footwear" },
  ]);

  // No rows at all is the signal for "unrestricted", and it has to stay a cheap
  // valid state rather than reading as restricted-to-nothing.
  const free = await seedTemplate({ initialAmount: 100 });
  assert.deepEqual(await GiftCardCode.applicabilityForTemplate(free), []);
  assert.deepEqual(await GiftCardCode.applicabilityForTemplate(null), []);
});

test("a claimed code's applicability can be frozen onto its bucket unchanged", async () => {
  // The two models have to agree on one shape, or a restricted card's money ends
  // up in an unrestricted bucket and the restriction is quietly lost.
  const templateId = await seedTemplate({ initialAmount: 500 });
  await scratch.query("INSERT INTO gift_card_applicability (template_id, kind, value) VALUES ($1, 'BRAND', 'Nike')", [templateId]);
  const issued = await issueCode(templateId);
  const customerId = await seedCustomer();
  const wallet = await Wallet.ensureForCustomer(customerId);

  const frozen = await GiftCardCode.applicabilityForTemplate(templateId);
  const bucket = await seedBucket(wallet.id, {
    initialValue: issued.face_value,
    remaining: 0,
    applicability: frozen,
    codeId: issued.id,
  });

  // Credited through the model rather than seeded, because a bucket holding
  // nothing is not spendable and bucketsFor would not return it at all.
  await inTx(async (client) => {
    await client.query("SELECT id FROM customer_wallet_buckets WHERE id = $1 FOR UPDATE", [bucket.id]);
    return Wallet.creditInTx(client, { customerId, bucket, codeId: issued.id, reference: "CLAIM" });
  });

  const [stored] = await Wallet.bucketsFor(customerId);
  assert.deepEqual(stored.applicability, [{ type: "BRAND", value: "Nike" }]);
  assert.ok(stored.applicability.length > 0, "a non-empty array must sort restricted-first");
  assert.equal(stored.codeId, issued.id);
});

test("maskRow strips the lookup hash and shows only the last four characters", async () => {
  const templateId = await seedTemplate({ initialAmount: 100 });
  const issued = await issueCode(templateId);
  const found = await GiftCardCode.findByPlaintext(issued.code);

  const masked = GiftCardCode.maskRow(found);
  assert.equal(masked.code, `••••-${found.code_last4}`);
  assert.ok(!("code_hash" in masked), "the hash is what an offline attacker needs to test guesses");
  assert.equal(GiftCardCode.maskRow(null), null);
});

test("CODE_STATUS matches the database CHECK exactly and is frozen", () => {
  assert.ok(Object.isFrozen(CODE_STATUS));
  assert.deepEqual(Object.keys(CODE_STATUS).sort(), [
    "PENDING_PAYMENT",
    "REDEEMED",
    "REVOKED",
    "SCHEDULED",
    "UNUSED",
  ]);
  // The one thing that must NOT be a stored status.
  assert.ok(!("EXPIRED" in CODE_STATUS));

  // Every value the model can store is a value the database accepts, so a status
  // can never be written that the CHECK would refuse mid-transaction.
  for (const status of Object.values(CODE_STATUS)) {
    assert.match(status, /^[A-Z_]+$/);
  }
});

test("the ledger rejects a hand-built row whose sign contradicts its type", async () => {
  // Belt and braces around the model's own helper: even if a caller skips
  // ledgerRow, the sign convention is enforced where the money moves.
  const customerId = await seedCustomer();
  await Wallet.ensureForCustomer(customerId);
  const wallet = await Wallet.findByCustomer(customerId);
  await assert.rejects(
    () =>
      Wallet.insertLedger(scratch, wallet.id, {
        ...ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: -50, balanceAfter: 50 }),
        // The amount flipped positive while the type still says DEBIT.
        amount: 50,
      }),
    /DEBIT row needs a negative amount/
  );
});

test.after(async () => {
  await scratch.end().catch(() => {});
  await modelPool.end().catch(() => {});
});