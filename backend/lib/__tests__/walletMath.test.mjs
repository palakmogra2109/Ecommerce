import test from "node:test";
import assert from "node:assert/strict";

// Pure ledger arithmetic. No database, and none is even opened: importing
// wallet.js builds lib/db.js's Pool, but a pg Pool connects lazily, so nothing
// here can reach a server even with DATABASE_URL unset — which is exactly why
// this file needs no throwaway database and cannot touch the live one.
const { LEDGER_TYPE, ledgerRow } = await import("../models/wallet.js");
// The same rounding wallet.js uses, so the paise reconciliation below asserts
// the model's behaviour rather than a second opinion about it.
const { round2 } = await import("../giftCardRules.js");

test("the ledger types are frozen, so no caller can widen the vocabulary", () => {
  assert.ok(Object.isFrozen(LEDGER_TYPE));
  assert.deepEqual(Object.keys(LEDGER_TYPE).sort(), [
    "ADJUSTMENT",
    "CREDIT",
    "DEBIT",
    "EXPIRY",
    "REFUND",
  ]);
});

test("an inflow is written with a positive amount and an outflow with a negative one", () => {
  assert.equal(ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 100, balanceAfter: 100 }).amount, 100);
  assert.equal(ledgerRow({ type: LEDGER_TYPE.REFUND, amount: 100, balanceAfter: 100 }).amount, 100);
  assert.equal(ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: -100, balanceAfter: 0 }).amount, -100);
  // EXPIRY is value that aged away, so it debits like a DEBIT.
  assert.equal(ledgerRow({ type: LEDGER_TYPE.EXPIRY, amount: -25, balanceAfter: 0 }).amount, -25);
});

test("ADJUSTMENT is the only type that may go either way", () => {
  assert.equal(ledgerRow({ type: LEDGER_TYPE.ADJUSTMENT, amount: 40, balanceAfter: 40 }).amount, 40);
  assert.equal(ledgerRow({ type: LEDGER_TYPE.ADJUSTMENT, amount: -40, balanceAfter: 0 }).amount, -40);
});

test("a CREDIT with a negative amount is refused", () => {
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: -100, balanceAfter: 0 }),
    /CREDIT row needs a positive amount, got -100/
  );
});

test("a DEBIT with a positive amount is refused", () => {
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: 100, balanceAfter: 100 }),
    /DEBIT row needs a negative amount, got 100/
  );
});

test("a REFUND with a negative amount is refused, not quietly flipped", () => {
  // Taking the absolute value would be the tempting "fix"; it would also let a
  // sign bug anywhere upstream spend a wallet instead of restoring one.
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.REFUND, amount: -100, balanceAfter: 100 }),
    /REFUND row needs a positive amount, got -100/
  );
});

test("a zero amount is refused for every direction-specific type", () => {
  // A row that moves nothing restates a balance without saying why, which is
  // exactly the kind of noise an append-only ledger cannot later explain away.
  for (const type of [LEDGER_TYPE.CREDIT, LEDGER_TYPE.REFUND, LEDGER_TYPE.DEBIT, LEDGER_TYPE.EXPIRY]) {
    assert.throws(
      () => ledgerRow({ type, amount: 0, balanceAfter: 0 }),
      new RegExp(`${type} row needs`),
      `${type} accepted a zero amount`
    );
  }
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.ADJUSTMENT, amount: 0, balanceAfter: 0 }),
    /ADJUSTMENT row cannot move zero/
  );
});

test("a sub-paisa amount rounds to zero and is then refused, rather than written as -0", () => {
  // -0.001 settles to -0, which would sail past a naive `< 0` check and leave a
  // DEBIT row whose amount is neither positive nor negative in any useful sense.
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: -0.001, balanceAfter: 0 }),
    /DEBIT row needs a negative amount/
  );
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 0.001, balanceAfter: 0 }),
    /CREDIT row needs a positive amount/
  );
});

test("an unknown type is refused rather than stored", () => {
  assert.throws(
    () => ledgerRow({ type: "TOPUP", amount: 100, balanceAfter: 100 }),
    /Unknown wallet ledger type TOPUP/
  );
});

test("amounts settle to two decimals", () => {
  const row = ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: "1234.567", balanceAfter: 10 });
  assert.equal(row.amount, 1234.57);
  // NUMERIC arrives from pg as a string, so the string form has to work too.
  assert.equal(ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: "199.99", balanceAfter: 10 }).amount, 199.99);
  assert.equal(ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: "-19.994", balanceAfter: 10 }).amount, -19.99);
});

test("float input settles on whole paise instead of leaking binary dust", () => {
  // 0.1 + 0.2 is 0.30000000000000004. Left unrounded it is a rupee and four
  // hundred million billionths of a rupee, and repeated subtraction of such
  // figures is how a wallet total ends in ...9999.
  assert.equal(ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 0.1 + 0.2, balanceAfter: 0 }).amount, 0.3);
  assert.equal(ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 10.1 + 20.2 + 30.3, balanceAfter: 0 }).amount, 60.6);

  // The same dust arriving through balance_after, which is the column every
  // reconciliation reads.
  assert.equal(
    ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 0.1 + 0.2, balanceAfter: 100.1 + 0.2 }).balance_after,
    100.3
  );

  // And a split that would drift: a rupee thousand drawn down in thirds. Walked
  // as floats the running total would end at ...9999 or ...0001; stored as
  // whole paise it lands on exactly 0, which is the only figure a reconciliation
  // can agree with.
  const rows = [
    ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 1000, balanceAfter: 1000 }),
    ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: -333.33, balanceAfter: 1000 - 333.33 }),
    ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: -333.33, balanceAfter: 1000 - 333.33 - 333.33 }),
    ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: -333.34, balanceAfter: 1000 - 333.33 - 333.33 - 333.34 }),
  ];
  assert.deepEqual(rows.map((r) => r.balance_after), [1000, 666.67, 333.34, 0]);
  // Every row reconciles against the one before it — but only once each figure
  // is settled to paise first. `1000 + -333.33` is 666.6699999999999 as a raw
  // float, so comparing the raw sum would fail on a ledger that is in fact
  // perfectly consistent. The stored values are the contract; the float
  // arithmetic is not.
  for (let i = 1; i < rows.length; i++) {
    assert.equal(round2(rows[i - 1].balance_after + rows[i].amount), rows[i].balance_after);
  }
});

test("balance_after is the wallet total, so it is rounded and never negative", () => {
  assert.equal(ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: -100, balanceAfter: 900.005 }).balance_after, 900.01);
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.DEBIT, amount: -100, balanceAfter: -0.01 }),
    /cannot leave the balance at -0.01/
  );
});

test("a row comes back as the column payload, with metadata already encoded", () => {
  const row = ledgerRow({
    type: LEDGER_TYPE.CREDIT,
    amount: 500,
    balanceAfter: 500,
    bucketId: 7,
    codeId: 3,
    orderUuid: "11111111-1111-4111-8111-111111111111",
    reference: "CLAIM",
    description: "Claimed GIFT-ABCD-EFGH",
    metadata: { source: "checkout" },
  });
  assert.deepEqual(row, {
    type: "CREDIT",
    amount: 500,
    balance_after: 500,
    bucket_id: 7,
    code_id: 3,
    order_uuid: "11111111-1111-4111-8111-111111111111",
    reference: "CLAIM",
    description: "Claimed GIFT-ABCD-EFGH",
    metadata: '{"source":"checkout"}',
  });
  // wallet_id is absent on purpose: only the caller knows whose wallet this is.
  assert.ok(!("wallet_id" in row));
});

test("omitted optional columns become NULL, and absent metadata becomes an empty object", () => {
  const row = ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 10, balanceAfter: 10 });
  assert.equal(row.bucket_id, null);
  assert.equal(row.code_id, null);
  assert.equal(row.order_uuid, null);
  assert.equal(row.reference, null);
  assert.equal(row.description, null);
  assert.equal(row.metadata, "{}");
});

test("a missing amount is zero and is therefore refused, never NaN", () => {
  // A NaN reaching the column would poison the ledger for good; the sign check
  // catches it first, because NaN fails every comparison.
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: undefined, balanceAfter: 10 }),
    /CREDIT row needs a positive amount, got 0/
  );
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: "not-a-number", balanceAfter: 10 }),
    /CREDIT row needs a positive amount/
  );
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 100, balanceAfter: "not-a-number" }),
    /needs a finite balance_after/
  );
  // round2 would turn a NaN balance_after into 0, filing a CREDIT as though the
  // customer's money had vanished, so it is refused instead.
  assert.throws(
    () => ledgerRow({ type: LEDGER_TYPE.CREDIT, amount: 100, balanceAfter: undefined }),
    /needs a finite balance_after/
  );
});