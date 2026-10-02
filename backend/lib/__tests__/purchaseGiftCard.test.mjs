import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import util from "node:util";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../scripts/lib/env.mjs";

// The environment first, exactly as giftCardCodeModel.test.mjs and
// claimGiftCard.test.mjs do it.
await loadEnv();

import pg from "pg";

// ---------------------------------------------------------------- throwaway DB
//
// A purchase mints codes, takes payments and revokes value, so none of it can be
// mocked: a mocked transaction proves nothing about whether a code can escape
// against a rolled-back purchase, which is the whole thing under test below.
// Every test therefore runs against a real database — created fresh from
// sql/schema.sql, and never the live `ecommerce` one, which this file would
// otherwise be free to fill with gift cards nobody paid for.
//
// The database is LEFT BEHIND at the end of the run (the same choice
// giftCardCodeModel.test.mjs and claimGiftCard.test.mjs make) rather than
// dropped in a finally, so a failed run can be inspected with psql against
// `gc_purchasetest`. The next run drops it first, with FORCE, so a run that died
// holding a connection cannot make the next one fail for the wrong reason.
const BASE_URL = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH_DB = "gc_purchasetest";
const SCRATCH_URL = `${BASE_URL}${SCRATCH_DB}`;

const admin = new pg.Pool({ connectionString: `${BASE_URL}postgres` });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
await admin.end();

// lib/db.js builds its Pool at module scope out of process.env.DATABASE_URL and
// Node caches an imported module for the life of the process, so the variable has
// to be repointed at the scratch database BEFORE the service is imported — which
// is why these are `await import()` and why the block above cannot move into a
// hook.
process.env.DATABASE_URL = SCRATCH_URL;

const scratch = new pg.Pool({ connectionString: SCRATCH_URL });
// Resolved against this file rather than process.cwd(), so the suite runs the
// same way whether npm started it from backend/ or a script did.
await scratch.query(fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8"));

const { MAX_QUANTITY, PurchaseError, listPurchasesForCustomer, purchaseGiftCard, refundPurchase } =
  await import("../services/purchaseGiftCard.js");
const { claimGiftCard } = await import("../services/claimGiftCard.js");
const { CODE_STATUS, GiftCardCode } = await import("../models/giftCardCode.js");
const { generateCode, hashCode } = await import("../giftCardCodeGen.js");
const { SandboxProvider } = await import("../payment/sandbox.js");

// ------------------------------------------------------------------- seeding

let customerSeq = 0;
async function seedCustomer() {
  customerSeq += 1;
  const result = await scratch.query(
    "INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING id",
    [`Buyer ${customerSeq}`, `buyer-${customerSeq}-${randomUUID()}@example.test`]
  );
  return Number(result.rows[0].id);
}

let templateSeq = 0;
// A sellable template, in the shape the templates route creates: face_value and
// initial_amount equal, because initial_amount is the column
// GiftCardCode.issueInTx reads when it stamps a code, and a template whose two
// value columns disagree is refused (TEMPLATE_VALUE_MISMATCH).
async function seedTemplate({
  faceValue = 1000,
  initialAmount = null,
  sellingPrice = null,
  status = "ACTIVE",
  isActive = true,
  validityDays = null,
  maxQuantityPerOrder = null,
  startsAt = null,
  endsAt = null,
  currency = "INR",
} = {}) {
  templateSeq += 1;
  const initial = initialAmount == null ? faceValue : initialAmount;
  const result = await scratch.query(
    `INSERT INTO gift_cards
       (label, description, initial_amount, balance, currency, status, is_active,
        face_value, selling_price, validity_days, max_quantity_per_order, starts_at, ends_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, uuid, face_value, initial_amount, selling_price, currency`,
    [
      `Purchase Template ${templateSeq}`,
      "",
      initial,
      currency,
      status,
      isActive,
      faceValue,
      sellingPrice,
      validityDays,
      maxQuantityPerOrder,
      startsAt,
      endsAt,
    ]
  );
  return result.rows[0];
}

// ---------------------------------------------------------------- assertions

const purchasesForTemplate = async (templateId) =>
  (
    await scratch.query(
      `SELECT id, uuid, quantity, unit_face_value, unit_selling_price, total_amount, currency,
              payment_provider, payment_intent_id, payment_reference, payment_status, status,
              purchaser_id, recipient_email, recipient_name, gift_message
         FROM gift_card_purchases WHERE template_id = $1 ORDER BY id`,
      [templateId]
    )
  ).rows;

const codesForPurchase = async (purchaseId) =>
  (
    await scratch.query(
      `SELECT id, uuid, template_id, purchase_id, code_hash, code_last4, status, currency,
              face_value, claimed_value, claimed_by, claimed_at, expires_at,
              revoked_at, revoked_reason
         FROM gift_card_codes WHERE purchase_id = $1 ORDER BY id`,
      [purchaseId]
    )
  ).rows;

const codesForTemplate = async (templateId) =>
  (
    await scratch.query(
      "SELECT id, purchase_id, code_hash, code_last4, status, face_value FROM gift_card_codes WHERE template_id = $1 ORDER BY id",
      [templateId]
    )
  ).rows;

const deliveriesForPurchase = async (purchaseId) =>
  (
    await scratch.query(
      `SELECT id, code_id, purchase_id, channel, recipient_email, recipient_name, scheduled_for,
              status, attempt_count, sent_at
         FROM gift_card_deliveries WHERE purchase_id = $1 ORDER BY id`,
      [purchaseId]
    )
  ).rows;

const walletBucketsForCode = async (codeId) =>
  (
    await scratch.query(
      "SELECT id, remaining FROM customer_wallet_buckets WHERE code_id = $1",
      [codeId]
    )
  ).rows;

// A purchase attempt as a value rather than a throw, so a test can assert on the
// refusal AND on what it left behind in the same breath. `code` is UNEXPECTED for
// anything that is not a PurchaseError, which is what catches a raw driver error
// escaping as if it were a business refusal.
async function attempt(options) {
  try {
    return { ok: true, result: await purchaseGiftCard(options) };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof PurchaseError ? error.code : `UNEXPECTED:${error?.name}`,
      message: error?.message,
      error,
    };
  }
}

async function attemptRefund(options) {
  try {
    return { ok: true, result: await refundPurchase(options) };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof PurchaseError ? error.code : `UNEXPECTED:${error?.name}`,
      message: error?.message,
      error,
    };
  }
}

const DECLINE = (outcome) => {
  assert.equal(outcome.ok, false, `expected a refusal, got ${JSON.stringify(outcome.result)}`);
  return outcome.code;
};

// A gateway that declines everything, using the sandbox's own failEvery hook
// rather than a stubbed confirm — the same lever paymentProvider.test.mjs uses.
const DECLINING_GATEWAY = () => new SandboxProvider({ failEvery: 1 });

const EMAIL = "friend@example.test";

// ============================================================ a plain purchase

test("a purchase issues exactly `quantity` codes, all UNUSED, with unique hashes", async () => {
  const template = await seedTemplate({ faceValue: 500 });
  const customerId = await seedCustomer();

  const result = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 3,
    purchaserId: customerId,
    recipientEmail: EMAIL,
    recipientName: "Friend",
    giftMessage: "Happy birthday",
  });

  assert.equal(result.codes.length, 3);
  for (const code of result.codes) {
    // A real, typeable code — the customer is going to have to read this aloud.
    assert.match(code.code, /^GIFT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  }

  const rows = await codesForPurchase(result.purchase.id);
  assert.equal(rows.length, 3);
  // Issued means paid for, so nothing may come back UNUSED-but-unowned-by-a-purchase.
  assert.deepEqual(rows.map((row) => row.status), [CODE_STATUS.UNUSED, CODE_STATUS.UNUSED, CODE_STATUS.UNUSED]);
  for (const row of rows) {
    assert.equal(Number(row.purchase_id), result.purchase.id);
    assert.equal(row.claimed_by, null);
    assert.equal(row.claimed_at, null);
  }

  // The UNIQUE index on code_hash is the real guarantee that two issuances cannot
  // mint the same card; three distinct hashes is the observable form of it.
  assert.equal(new Set(rows.map((row) => row.code_hash)).size, 3);
  // And each hash is the hash OF the plaintext handed to the buyer, which is what
  // makes the claim service able to find this code again.
  for (const code of result.codes) {
    assert.equal(hashCode(code.code), rows.find((row) => row.code_last4 === code.codeLast4).code_hash);
  }

  // The plaintext is not in the database in any form.
  for (const code of result.codes) {
    assert.equal(JSON.stringify(rows).includes(code.code), false);
    assert.equal(JSON.stringify(result.purchase).includes(code.code), false);
  }

  const purchase = (await purchasesForTemplate(template.id))[0];
  assert.equal(purchase.payment_status, "PAID");
  assert.equal(purchase.status, "ISSUED");
  assert.equal(Number(purchase.quantity), 3);
  assert.equal(Number(purchase.purchaser_id), customerId);
  assert.equal(purchase.recipient_email, EMAIL);
  assert.equal(purchase.recipient_name, "Friend");
  assert.equal(purchase.gift_message, "Happy birthday");
  assert.equal(purchase.payment_provider, "sandbox");
  assert.match(purchase.payment_intent_id, /^sbx_/);
  assert.match(purchase.payment_reference, /^sbx_ref_/);
});

test("the codes carry the template's face value and the purchase total is right", async () => {
  // A promoted card: face 250.50, sold at 200.25.
  const template = await seedTemplate({ faceValue: 250.5, sellingPrice: 200.25, validityDays: 365 });
  const customerId = await seedCustomer();

  const result = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 4,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  // Priced in paise, not floats: 200.25 × 4 is 801.00 and not 800.9999999999999.
  assert.equal(result.totalAmount, 801);
  assert.equal(result.purchase.unit_face_value, 250.5);
  assert.equal(result.purchase.unit_selling_price, 200.25);
  assert.equal(result.purchase.total_amount, 801);
  assert.equal(result.currency, "INR");

  const rows = await codesForPurchase(result.purchase.id);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    // What the customer gets is the FACE value, not what they paid: a promotion
    // makes the card worth more than the price, never less.
    assert.equal(Number(row.face_value), 250.5);
    assert.equal(row.currency, "INR");
    assert.equal(Number(row.claimed_value), 0);
    // validity_days becomes the code's own expiry, copied at issue time.
    assert.ok(row.expires_at, "a template with validity_days issues codes that expire");
  }

  const purchase = (await purchasesForTemplate(template.id))[0];
  assert.equal(Number(purchase.total_amount), 801);
});

test("a template with no selling price charges the face value", async () => {
  const template = await seedTemplate({ faceValue: 750 });
  const customerId = await seedCustomer();

  const result = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 2,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  assert.equal(result.totalAmount, 1500);
  // NULL keeps its documented meaning: this template has no separate price.
  assert.equal(result.purchase.unit_selling_price, null);
  assert.equal(result.purchase.unit_face_value, 750);
});

test("a template may be addressed by uuid as well as by id", async () => {
  const template = await seedTemplate({ faceValue: 100 });
  const customerId = await seedCustomer();

  const result = await purchaseGiftCard({
    templateId: template.uuid,
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  assert.equal(result.codes.length, 1);
  assert.equal(Number((await purchasesForTemplate(template.id))[0].id), result.purchase.id);
});

// ================================================================ the payment

test("a declined payment issues zero codes and leaves the purchase FAILED", async () => {
  const template = await seedTemplate({ faceValue: 900 });
  const customerId = await seedCustomer();

  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 2,
    purchaserId: customerId,
    recipientEmail: EMAIL,
    provider: DECLINING_GATEWAY(),
  });

  assert.equal(DECLINE(outcome), "PAYMENT_DECLINED");

  // Not one code. This is the assertion the whole flow exists for.
  assert.equal((await codesForTemplate(template.id)).length, 0);

  // The attempt is still recorded, with the intent the gateway gave it, so the
  // buyer gets a receipt-shaped "no" and support can see what happened.
  const purchases = await purchasesForTemplate(template.id);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].payment_status, "FAILED");
  assert.equal(purchases[0].status, "CANCELLED");
  assert.match(purchases[0].payment_intent_id, /^sbx_/);
  assert.equal(purchases[0].payment_reference, null);
  assert.equal((await deliveriesForPurchase(Number(purchases[0].id))).length, 0);
});

test("a payment that settles for the wrong amount issues nothing either", async () => {
  const template = await seedTemplate({ faceValue: 400 });
  const customerId = await seedCustomer();

  // A gateway that echoes back a different figure. The sandbox echoes what it was
  // asked for, so this is the check that the caller reconciles rather than trusts.
  const gateway = new SandboxProvider();
  const originalConfirm = gateway.confirm.bind(gateway);
  gateway.confirm = async (intentId, options) => {
    const confirmation = await originalConfirm(intentId, options);
    return { ...confirmation, amount: Number(confirmation.amount) + 1 };
  };

  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
    provider: gateway,
  });

  assert.equal(DECLINE(outcome), "PAYMENT_MISMATCH");
  assert.equal((await codesForTemplate(template.id)).length, 0);
  assert.equal((await purchasesForTemplate(template.id))[0].payment_status, "FAILED");
});

test("an unregistered payment provider is refused rather than defaulted", async () => {
  const template = await seedTemplate({ faceValue: 100 });
  const customerId = await seedCustomer();

  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
    providerName: "stripe_not_installed",
  });

  assert.equal(DECLINE(outcome), "UNKNOWN_PAYMENT_PROVIDER");
  assert.equal((await purchasesForTemplate(template.id)).length, 0);
});

// ========================================================== template refusals

test("a template that is not ACTIVE is refused", async () => {
  const template = await seedTemplate({ faceValue: 100, status: "DRAFT" });
  const customerId = await seedCustomer();

  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  assert.equal(DECLINE(outcome), "TEMPLATE_NOT_SELLABLE");
  assert.equal((await purchasesForTemplate(template.id)).length, 0);
  assert.equal((await codesForTemplate(template.id)).length, 0);
});

test("a template whose sell gate is off is refused even though status is ACTIVE", async () => {
  const template = await seedTemplate({ faceValue: 100, isActive: false });
  const customerId = await seedCustomer();

  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  assert.equal(DECLINE(outcome), "TEMPLATE_NOT_SELLABLE");
  assert.equal((await codesForTemplate(template.id)).length, 0);
});

test("an ARCHIVED template is refused", async () => {
  // The shape migration 017 leaves behind: an issued card retired in place. It is
  // not a card anybody may still buy, whatever the sell gate says.
  const template = await seedTemplate({ faceValue: 100, status: "ARCHIVED" });
  const customerId = await seedCustomer();

  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  assert.equal(DECLINE(outcome), "TEMPLATE_ARCHIVED");
  assert.equal((await codesForTemplate(template.id)).length, 0);
});

test("a template with no face value is refused", async () => {
  // Every legacy row in the live database looks like this: is_active = true, a
  // value in initial_amount, and no face_value at all. Without this check the
  // storefront would sell them.
  const template = await seedTemplate({ faceValue: null, initialAmount: 44 });
  const customerId = await seedCustomer();

  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  assert.equal(DECLINE(outcome), "TEMPLATE_NO_VALUE");
  assert.equal((await purchasesForTemplate(template.id)).length, 0);
});

test("a template whose two value columns disagree is refused", async () => {
  // issueInTx stamps the code's face value from initial_amount, so a template
  // that quotes one number and carries another would sell a promise.
  const template = await seedTemplate({ faceValue: 500, initialAmount: 50 });
  const customerId = await seedCustomer();

  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  assert.equal(DECLINE(outcome), "TEMPLATE_VALUE_MISMATCH");
  assert.equal((await purchasesForTemplate(template.id)).length, 0);
});

test("a template outside its sell window is refused, and so is one that does not exist", async () => {
  const ended = await seedTemplate({
    faceValue: 100,
    startsAt: "2020-01-01T00:00:00Z",
    endsAt: "2021-01-01T00:00:00Z",
  });
  const notYet = await seedTemplate({ faceValue: 100, startsAt: "2999-01-01T00:00:00Z" });
  const customerId = await seedCustomer();

  const refused = await attempt({
    templateId: Number(ended.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });
  assert.equal(DECLINE(refused), "TEMPLATE_NOT_ON_SALE");

  const early = await attempt({
    templateId: Number(notYet.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });
  assert.equal(DECLINE(early), "TEMPLATE_NOT_ON_SALE");

  const missing = await attempt({ templateId: 999999, quantity: 1, purchaserId: customerId, recipientEmail: EMAIL });
  assert.equal(DECLINE(missing), "TEMPLATE_NOT_FOUND");

  // Garbage is a 404, not a Postgres cast error.
  const garbage = await attempt({ templateId: "not-an-id", quantity: 1, purchaserId: customerId, recipientEmail: EMAIL });
  assert.equal(DECLINE(garbage), "TEMPLATE_NOT_FOUND");
});

// =========================================================== quantity guards

test("quantity 0, quantity 21 and a non-integer are all refused rather than coerced", async () => {
  const template = await seedTemplate({ faceValue: 100 });
  const customerId = await seedCustomer();
  const buy = (quantity) =>
    attempt({ templateId: Number(template.id), quantity, purchaserId: customerId, recipientEmail: EMAIL });

  // Coercing 0 up to 1 and 21 down to 20 is how a shopper is billed for the wrong
  // number of cards, so both are refused.
  assert.equal(DECLINE(await buy(0)), "QUANTITY_LIMIT");
  assert.equal(DECLINE(await buy(-3)), "QUANTITY_LIMIT");
  assert.equal(DECLINE(await buy(MAX_QUANTITY + 1)), "QUANTITY_LIMIT");

  // A fractional count is not rounded, floored or silently read as 1.
  for (const bad of [1.5, 0.5, "2.5", "two", null, undefined, true, [], {}]) {
    assert.equal(DECLINE(await buy(bad)), "INVALID_QUANTITY", `quantity ${JSON.stringify(bad)} must be refused`);
  }

  assert.equal((await purchasesForTemplate(template.id)).length, 0);
  assert.equal((await codesForTemplate(template.id)).length, 0);
});

test("the boundaries themselves are allowed, and a template may be stricter than the store", async () => {
  const template = await seedTemplate({ faceValue: 10 });
  const capped = await seedTemplate({ faceValue: 10, maxQuantityPerOrder: 2 });
  const customerId = await seedCustomer();

  const one = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });
  assert.equal(one.codes.length, 1);

  const many = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: MAX_QUANTITY,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });
  assert.equal(many.codes.length, MAX_QUANTITY);

  const overCap = await attempt({
    templateId: Number(capped.id),
    quantity: 3,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });
  assert.equal(DECLINE(overCap), "QUANTITY_LIMIT");
});

// ================================================================ deliveries

test("a purchase with no recipient email records SKIPPED deliveries and never a PENDING row", async () => {
  // An account holder's codes live in their own history, so no address is needed
  // — but SMS has no provider, and a PENDING row here would be picked up by the
  // delivery worker and retried forever with nothing to send it to.
  const template = await seedTemplate({ faceValue: 300 });
  const customerId = await seedCustomer();

  const result = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 2,
    purchaserId: customerId,
  });

  const deliveries = await deliveriesForPurchase(result.purchase.id);
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries.map((row) => row.status), ["SKIPPED", "SKIPPED"]);
  assert.equal(deliveries.filter((row) => row.status === "PENDING").length, 0);
  assert.deepEqual(deliveries.map((row) => row.channel), ["EMAIL", "EMAIL"]);
  assert.equal(deliveries[0].scheduled_for, null);
  assert.equal(deliveries[0].attempt_count, 0);
  // One delivery per code, so the partial unique index on (code_id) WHERE PENDING
  // cannot have been violated and no code is queued twice.
  assert.equal(new Set(deliveries.map((row) => Number(row.code_id))).size, 2);
  assert.deepEqual(
    deliveries.map((row) => Number(row.code_id)).sort(),
    result.codes.map((code) => code.id).sort()
  );
});

test("a purchase with a recipient email queues one PENDING delivery per code", async () => {
  const template = await seedTemplate({ faceValue: 300 });
  const customerId = await seedCustomer();

  const result = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 3,
    purchaserId: customerId,
    recipientEmail: EMAIL,
    recipientName: "Friend",
  });

  const deliveries = await deliveriesForPurchase(result.purchase.id);
  assert.equal(deliveries.length, 3);
  assert.deepEqual(deliveries.map((row) => row.status), ["PENDING", "PENDING", "PENDING"]);
  assert.equal(new Set(deliveries.map((row) => Number(row.code_id))).size, 3);
  for (const row of deliveries) {
    assert.equal(row.recipient_email, EMAIL);
    assert.equal(row.recipient_name, "Friend");
  }
});

test("a guest must say where the card is going, and a bad address is refused", async () => {
  const template = await seedTemplate({ faceValue: 200 });

  const noAddress = await attempt({ templateId: Number(template.id), quantity: 1, recipientEmail: "  " });
  assert.equal(DECLINE(noAddress), "RECIPIENT_REQUIRED");

  const badAddress = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    recipientEmail: "not-an-email",
  });
  assert.equal(DECLINE(badAddress), "RECIPIENT_INVALID");

  // The one guest purchase that works: purchaser_id NULL, the card addressed.
  const guest = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 1,
    recipientEmail: "Someone@Example.Test",
  });
  assert.equal(guest.purchase.purchaser_id, null);
  assert.equal(guest.codes.length, 1);
  // Stored lowercased, so the worker's address comparison has one spelling.
  assert.equal(guest.purchase.recipient_email, "someone@example.test");
  assert.equal((await deliveriesForPurchase(guest.purchase.id))[0].status, "PENDING");
});

// ============================================================== concurrency

test("two concurrent purchases of one template both succeed, with no colliding hash", async () => {
  // Each call checks out its own connection and opens its own transaction, so
  // these really do run at once — the thing that would break if issuance took a
  // lock on the template or if the totals were shared state.
  const template = await seedTemplate({ faceValue: 100 });
  const [aliceId, bobId] = [await seedCustomer(), await seedCustomer()];

  const [alice, bob] = await Promise.all([
    purchaseGiftCard({
      templateId: Number(template.id),
      quantity: 2,
      purchaserId: aliceId,
      recipientEmail: "alice@example.test",
    }),
    purchaseGiftCard({
      templateId: Number(template.id),
      quantity: 5,
      purchaserId: bobId,
      recipientEmail: "bob@example.test",
    }),
  ]);

  assert.equal(alice.codes.length, 2);
  assert.equal(bob.codes.length, 5);

  // Two purchases, not one row updated twice.
  assert.notEqual(alice.purchase.id, bob.purchase.id);
  const purchases = await purchasesForTemplate(template.id);
  assert.equal(purchases.length, 2);

  // Totals are independent: each purchase priced its own quantity.
  assert.equal(alice.totalAmount, 200);
  assert.equal(bob.totalAmount, 500);
  const byId = new Map(purchases.map((row) => [Number(row.id), Number(row.total_amount)]));
  assert.equal(byId.get(alice.purchase.id), 200);
  assert.equal(byId.get(bob.purchase.id), 500);

  // Seven codes, seven hashes: the unique index did its job under a race.
  const codes = await codesForTemplate(template.id);
  assert.equal(codes.length, 7);
  assert.equal(new Set(codes.map((row) => row.code_hash)).size, 7);
  assert.equal(new Set(codes.map((row) => Number(row.purchase_id))).size, 2);
  assert.equal((await deliveriesForPurchase(alice.purchase.id)).length, 2);
  assert.equal((await deliveriesForPurchase(bob.purchase.id)).length, 5);
});

// ============================================================ all or nothing

test("a failure between the purchase row and the code rows leaves no codes", async () => {
  const template = await seedTemplate({ faceValue: 100 });
  const customerId = await seedCustomer();

  // Three real codes are inserted inside the transaction and then it blows up, so
  // the rollback has something to take back. The purchase row was committed
  // before the gateway was called, so it is still there — and it must not claim to
  // have issued anything.
  const outcome = await attempt({
    templateId: Number(template.id),
    quantity: 3,
    purchaserId: customerId,
    recipientEmail: EMAIL,
    issueCodesInTx: async (client, { templateId: id, purchaseId, quantity }) => {
      const issued = [];
      for (let i = 0; i < quantity; i++) {
        issued.push(
          await GiftCardCode.issueInTx(client, { templateId: id, purchaseId, code: generateCode() })
        );
      }
      throw new Error("forced failure between the purchase row and the code rows");
    },
  });

  assert.equal(DECLINE(outcome), "ISSUANCE_FAILED");

  // The three codes that existed inside the transaction are gone.
  assert.equal((await codesForTemplate(template.id)).length, 0);

  const purchases = await purchasesForTemplate(template.id);
  assert.equal(purchases.length, 1);
  // The money IS in — the gateway confirmed it — so payment_status stays PAID and
  // only fulfilment is cancelled. A FAILED payment here would be a lie, and would
  // stop refundPurchase from returning the money.
  assert.equal(purchases[0].payment_status, "PAID");
  assert.equal(purchases[0].status, "CANCELLED");
  // And no delivery is queued for a code that does not exist.
  assert.equal((await deliveriesForPurchase(Number(purchases[0].id))).length, 0);

  // The recovery path: because the row is still PAID, refundPurchase can return
  // the money without a human editing the table.
  const refund = await refundPurchase({ purchaseId: Number(purchases[0].id), reason: "Issuance failed" });
  assert.equal(refund.revokedCount, 0);
  assert.equal(refund.purchase.payment_status, "REFUNDED");
  assert.equal(refund.gatewayRefund.attempted, true);
});

// ================================================================== refunds

test("refundPurchase revokes the unclaimed codes and marks the purchase REFUNDED", async () => {
  const template = await seedTemplate({ faceValue: 150 });
  const customerId = await seedCustomer();
  const bought = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 3,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  const refund = await refundPurchase({
    purchaseId: bought.purchase.uuid,
    reason: "Customer changed their mind",
  });

  assert.equal(refund.revokedCount, 3);
  assert.equal(refund.purchase.status, "REFUNDED");
  assert.equal(refund.purchase.payment_status, "REFUNDED");

  const rows = await codesForPurchase(bought.purchase.id);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.status, CODE_STATUS.REVOKED);
    assert.ok(row.revoked_at, "a revocation is timestamped");
    assert.match(row.revoked_reason, /Customer changed their mind/);
    // Voided, not given away: no wallet was opened and no credit was booked.
    assert.equal(row.claimed_by, null);
  }
  assert.equal((await walletBucketsForCode(rows[0].id)).length, 0);

  // The gateway is asked after the codes are dead, so a failure there leaves
  // money owed rather than money returned for a card that stayed spendable.
  assert.equal(refund.gatewayRefund.attempted, true);
  assert.equal(refund.gatewayRefund.status, "REFUNDED");

  // And a second refund is refused rather than revoking twice.
  const again = await attemptRefund({ purchaseId: bought.purchase.id });
  assert.equal(DECLINE(again), "REFUND_ALREADY_DONE");
});

test("refundPurchase refuses a purchase holding a CLAIMED code", async () => {
  // This is the bug gift_card_codes' claimed_by CHECK exists to prevent. Once a
  // code is claimed its value is in a customer's wallet: revoking the code would
  // leave that money unaccounted for AND unspendable, and the only correct
  // reversal runs through the wallet ledger.
  const template = await seedTemplate({ faceValue: 250 });
  const [buyerId, claimantId] = [await seedCustomer(), await seedCustomer()];
  const bought = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 2,
    purchaserId: buyerId,
    recipientEmail: EMAIL,
  });

  const claimed = await claimGiftCard({ code: bought.codes[0].code, customerId: claimantId });
  assert.equal(claimed.claimedValue, 250);

  const outcome = await attemptRefund({ purchaseId: bought.purchase.id, reason: "Changed their mind" });
  assert.equal(DECLINE(outcome), "REFUND_CODE_CLAIMED");

  // Nothing moved: the claimed code is still the customer's, and the UNclaimed one
  // was NOT revoked either — the refund is all-or-nothing.
  const rows = await codesForPurchase(bought.purchase.id);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const claimedRow = byId.get(bought.codes[0].id);
  const untouchedRow = byId.get(bought.codes[1].id);
  assert.equal(claimedRow.status, CODE_STATUS.REDEEMED);
  assert.equal(Number(claimedRow.claimed_by), claimantId);
  assert.equal(claimedRow.revoked_at, null);
  assert.equal(untouchedRow.status, CODE_STATUS.UNUSED);
  assert.equal(untouchedRow.revoked_at, null);

  // The customer's money is exactly where it was.
  const buckets = await walletBucketsForCode(bought.codes[0].id);
  assert.equal(buckets.length, 1);
  assert.equal(Number(buckets[0].remaining), 250);

  const purchase = (await purchasesForTemplate(template.id))[0];
  assert.equal(purchase.status, "ISSUED");
  assert.equal(purchase.payment_status, "PAID");
});

test("a purchase that was never paid for cannot be refunded", async () => {
  const template = await seedTemplate({ faceValue: 100 });
  const customerId = await seedCustomer();

  const declined = await attempt({
    templateId: Number(template.id),
    quantity: 1,
    purchaserId: customerId,
    recipientEmail: EMAIL,
    provider: DECLINING_GATEWAY(),
  });
  assert.equal(DECLINE(declined), "PAYMENT_DECLINED");

  const failedPurchase = (await purchasesForTemplate(template.id))[0];
  const outcome = await attemptRefund({ purchaseId: Number(failedPurchase.id) });
  assert.equal(DECLINE(outcome), "REFUND_NOT_PAID");

  // And the codes for a purchase nobody can identify are refused rather than
  // guessed at.
  const missing = await attemptRefund({ purchaseId: 999999 });
  assert.equal(DECLINE(missing), "REFUND_NOT_FOUND");
  const garbage = await attemptRefund({ purchaseId: "neither-an-id-nor-a-uuid" });
  assert.equal(DECLINE(garbage), "REFUND_NOT_FOUND");
});

// ================================================================== history

test("listPurchasesForCustomer shows last4 only, and never a plaintext", async () => {
  const template = await seedTemplate({ faceValue: 100 });
  const [customerId, otherId] = [await seedCustomer(), await seedCustomer()];

  const bought = await purchaseGiftCard({
    templateId: Number(template.id),
    quantity: 2,
    purchaserId: customerId,
    recipientEmail: EMAIL,
  });

  const listed = await listPurchasesForCustomer(customerId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, bought.purchase.id);
  assert.equal(listed[0].totalAmount, 200);
  assert.equal(listed[0].codes.length, 2);
  assert.deepEqual(
    listed[0].codes.map((code) => code.codeLast4).sort(),
    bought.codes.map((code) => code.codeLast4).sort()
  );

  // The projection has no `code` field to leak, and none of the plaintext appears
  // anywhere in it.
  assert.equal(JSON.stringify(listed).includes("GIFT-"), false);
  for (const code of bought.codes) {
    assert.equal(JSON.stringify(listed).includes(code.code), false);
  }

  // Another customer's history is not in it, and a guest has none.
  assert.equal((await listPurchasesForCustomer(otherId)).length, 0);
  assert.equal((await listPurchasesForCustomer(null)).length, 0);
});

// ================================================================== no leaks

test("the plaintext code never reaches stdout or stderr during a purchase", async () => {
  const template = await seedTemplate({ faceValue: 640 });
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

  let bought;
  try {
    assert.ok(
      captured.some((line) => line.includes(marker)),
      "the capture must observe its own marker, or it is not capturing"
    );
    captured.length = 0;

    bought = await purchaseGiftCard({
      templateId: Number(template.id),
      quantity: 2,
      purchaserId: customerId,
      recipientEmail: EMAIL,
    });

    // The unhappy paths too: a decline and a refusal are exactly where a careless
    // service logs the whole request object.
    const declined = await attempt({
      templateId: Number(template.id),
      quantity: 1,
      purchaserId: customerId,
      recipientEmail: EMAIL,
      provider: DECLINING_GATEWAY(),
    });
    const refused = await attempt({ templateId: 999999, quantity: 1, purchaserId: customerId, recipientEmail: EMAIL });

    // The purchase itself is silent by design, so something is written inside the
    // window to give the buffer content and prove the capture still works.
    console.error("purchase-outcome", bought.codes.length, declined.code, refused.code);
    assert.equal(declined.code, "PAYMENT_DECLINED");
    assert.equal(refused.code, "TEMPLATE_NOT_FOUND");

    const transcript = captured.join("\n");
    for (const code of bought.codes) {
      assert.equal(transcript.includes(code.code), false, `plaintext leaked into output: ${code.code}`);
      assert.equal(transcript.includes(code.code.toUpperCase()), false, "plaintext leaked in another case");
      assert.equal(transcript.includes(code.code.replace(/-/g, "")), false, "plaintext leaked without separators");
      // Not even the hash: it is what an offline attacker tests candidates with.
      assert.equal(transcript.includes(hashCode(code.code)), false, "the hash is not something to log either");
    }

    // The refusal objects themselves, not just what was printed of them.
    for (const outcome of [declined, refused]) {
      assert.equal(outcome.error instanceof PurchaseError, true, "refusals are PurchaseError, so the route can map them");
      assert.equal(outcome.error.name, "PurchaseError");
      assert.match(outcome.error.code, /^[A-Z_]+$/);
      for (const code of bought.codes) {
        assert.equal(outcome.error.message.includes(code.code), false);
        assert.equal(String(outcome.error.stack).includes(code.code), false);
      }
    }
  } finally {
    process.stdout.write = realStdout;
    process.stderr.write = realStderr;
  }

  // The purchase really happened, so this is not passing because nothing ran.
  assert.equal((await codesForPurchase(bought.purchase.id)).length, 2);
});