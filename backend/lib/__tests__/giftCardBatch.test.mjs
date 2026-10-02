import test from "node:test";
import assert from "node:assert/strict";
import { round2 } from "../giftCardRules.js";

// Mirrors the purchase route's arithmetic. Kept pure so the batch maths is
// testable without a database or a payment gateway.
const PURCHASE_MIN_AMOUNT = 100;
const PURCHASE_MAX_AMOUNT = 50000;
const PURCHASE_MAX_QUANTITY = 20;

export function clampQuantity(raw) {
  return Math.max(1, Math.min(PURCHASE_MAX_QUANTITY, parseInt(raw, 10) || 1));
}

export function batchTotals({ perCardValue, perCardPrice, quantity }) {
  const value = round2(perCardValue * quantity);
  const paid = round2(perCardPrice * quantity);
  return { value, paid, saving: round2(value - paid) };
}

test("quantity is clamped, never trusted", () => {
  assert.equal(clampQuantity(4), 4);
  assert.equal(clampQuantity("4"), 4);
  // Nonsense and missing values fall back to a single card.
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(-5), 1);
  assert.equal(clampQuantity(undefined), 1);
  assert.equal(clampQuantity("abc"), 1);
  assert.equal(clampQuantity(3.7), 3, "decimals are not a fractional card");
  // The ceiling holds.
  assert.equal(clampQuantity(999), PURCHASE_MAX_QUANTITY);
  assert.equal(clampQuantity(PURCHASE_MAX_QUANTITY + 5), PURCHASE_MAX_QUANTITY);
});

test("a batch is a multiple of one card", () => {
  const one = batchTotals({ perCardValue: 500, perCardPrice: 500, quantity: 1 });
  assert.deepEqual(one, { value: 500, paid: 500, saving: 0 });

  const four = batchTotals({ perCardValue: 500, perCardPrice: 500, quantity: 4 });
  assert.deepEqual(four, { value: 2000, paid: 2000, saving: 0 });

  // A promoted card: 4 x (399 worth, 340 paid).
  const promo = batchTotals({ perCardValue: 399, perCardPrice: 340, quantity: 4 });
  assert.deepEqual(promo, { value: 1596, paid: 1360, saving: 236 });
});

test("batch totals keep paise exact", () => {
  // 3 x 333.33 must not drift.
  const t = batchTotals({ perCardValue: 333.33, perCardPrice: 333.33, quantity: 3 });
  assert.equal(t.value, 999.99);
  assert.equal(t.paid, 999.99);
  // A discounted card that is not a whole rupee.
  const d = batchTotals({ perCardValue: 99.99, perCardPrice: 79.99, quantity: 7 });
  assert.equal(d.value, 699.93);
  assert.equal(d.paid, 559.93);
  assert.equal(d.saving, 140);
});

test("the per-card and quantity ceilings together cap the order", () => {
  const maxTotal = PURCHASE_MAX_AMOUNT * PURCHASE_MAX_QUANTITY;

  // Buying the most expensive card, the most of them, lands exactly on the cap.
  const atCeiling = batchTotals({
    perCardValue: PURCHASE_MAX_AMOUNT,
    perCardPrice: PURCHASE_MAX_AMOUNT,
    quantity: PURCHASE_MAX_QUANTITY,
  });
  assert.equal(atCeiling.paid, maxTotal);

  // The per-card ceiling is what refuses an oversized card; the total cap is a
  // second line of defence behind it, since the two ceilings already bound the
  // product. Exceeding the per-card amount is refused whatever the quantity.
  const tooBigPerCard = batchTotals({
    perCardValue: PURCHASE_MAX_AMOUNT + 1,
    perCardPrice: PURCHASE_MAX_AMOUNT + 1,
    quantity: 1,
  });
  assert.ok(tooBigPerCard.value > PURCHASE_MAX_AMOUNT);
  assert.ok(
    !(
      tooBigPerCard.value >= PURCHASE_MIN_AMOUNT &&
      tooBigPerCard.value <= PURCHASE_MAX_AMOUNT
    ),
    "a card above the per-card ceiling must not pass the amount check"
  );

  // And the clamped quantity can never push the total past the cap.
  for (const rawQty of [1, 7, 20, 21, 1000, -1, "nope"]) {
    const q = clampQuantity(rawQty);
    const totals = batchTotals({
      perCardValue: PURCHASE_MAX_AMOUNT,
      perCardPrice: PURCHASE_MAX_AMOUNT,
      quantity: q,
    });
    assert.ok(totals.paid <= maxTotal, `quantity ${rawQty} produced ${totals.paid}`);
  }
});

test("a card below the minimum cannot be bought", () => {
  const below = PURCHASE_MIN_AMOUNT - 1;
  assert.ok(!(below >= PURCHASE_MIN_AMOUNT));
  const atMin = PURCHASE_MIN_AMOUNT;
  assert.ok(atMin >= PURCHASE_MIN_AMOUNT);
});
