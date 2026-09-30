import test from "node:test";
import assert from "node:assert/strict";
import { computeCouponDiscount, normalizeCouponCode, round2 } from "../checkoutDiscounts.js";

test("percentage discounts honor the max cap", () => {
  assert.equal(computeCouponDiscount({ type: "PERCENTAGE", value: 20, max_discount_amount: 50 }, 500), 50);
  assert.equal(computeCouponDiscount({ type: "PERCENTAGE", value: 10, max_discount_amount: 0 }, 500), 50);
});

test("fixed discounts never exceed the subtotal", () => {
  assert.equal(computeCouponDiscount({ type: "FIXED", value: 200 }, 150), 150);
  assert.equal(computeCouponDiscount({ type: "FIXED", value: 200 }, 500), 200);
});

test("discounts are rounded to paise and never negative", () => {
  assert.equal(computeCouponDiscount({ type: "PERCENTAGE", value: 10 }, 99.99), 10);
  assert.equal(computeCouponDiscount({ type: "PERCENTAGE", value: 10 }, 0), 0);
  assert.equal(round2(10.005), 10.01);
});

test("codes normalize to uppercase dash form", () => {
  assert.equal(normalizeCouponCode("  diwali 20 "), "DIWALI-20");
});
