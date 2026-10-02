import test from "node:test";
import assert from "node:assert/strict";
import { allocate } from "../giftCardBuckets.js";
import { normalizeScope, isUnrestricted } from "../giftCardApplicability.js";

const item = (unitPrice, quantity, extra = {}) => ({ unitPrice, quantity, ...extra });

// Two baskets used repeatedly: a ₹600 all-Nike cart, and a mixed one whose
// eligible/ineligible split matters.
const nikeCart = () => [
  item(250, 1, { brand: "Nike", category: "Apparel" }),
  item(250, 1, { brand: "Nike", category: "Footwear" }),
];
const mixedCart = () => [
  item(300, 1, { brand: "Nike", category: "Apparel" }),
  item(200, 1, { brand: "Adidas", category: "Apparel" }),
];
const NIKE = { brands: ["Nike"] };
const ALL = {};

test("a single unrestricted bucket partially covers and reports the shortfall", () => {
  const res = allocate({ buckets: [{ id: "b1", amount: 300, scope: ALL }], amount: 500, lineItems: nikeCart() });
  assert.deepEqual(res.allocations, [{ bucketId: "b1", amount: 300 }]);
  assert.equal(res.covered, 300);
  assert.equal(res.shortfall, 200);
  assert.equal(res.fullyCovered, false);
  assert.equal(res.truncatedByMaxBuckets, false);
});

test("a single unrestricted bucket that exactly covers reports fullyCovered", () => {
  const res = allocate({ buckets: [{ id: "b1", amount: 500, scope: ALL }], amount: 500, lineItems: nikeCart() });
  assert.deepEqual(res.allocations, [{ bucketId: "b1", amount: 500 }]);
  assert.equal(res.covered, 500);
  assert.equal(res.shortfall, 0);
  assert.equal(res.fullyCovered, true);
});

test("coverage never exceeds the requested amount even when the bucket is worth more", () => {
  const res = allocate({ buckets: [{ id: "b1", amount: 5000, scope: ALL }], amount: 250, lineItems: nikeCart() });
  assert.deepEqual(res.allocations, [{ bucketId: "b1", amount: 250 }]);
  assert.equal(res.covered, 250);
  assert.equal(res.shortfall, 0);
  assert.equal(res.fullyCovered, true);
});

test("a restricted bucket with nothing eligible in the cart is skipped entirely", () => {
  const res = allocate({
    buckets: [{ id: "nike", amount: 500, scope: NIKE }],
    amount: 400,
    lineItems: [item(400, 1, { brand: "Adidas", category: "Apparel" })],
  });
  assert.deepEqual(res.allocations, []);
  assert.equal(res.covered, 0);
  assert.equal(res.shortfall, 400);
  assert.equal(res.fullyCovered, false);
});

test("a restricted bucket is capped by the cart's eligible total, not by its own balance", () => {
  const res = allocate({ buckets: [{ id: "nike", amount: 900, scope: NIKE }], amount: 500, lineItems: mixedCart() });
  // Only the ₹300 Nike line is payable; the ₹200 Adidas line is left alone.
  assert.deepEqual(res.allocations, [{ bucketId: "nike", amount: 300 }]);
  assert.equal(res.covered, 300);
  assert.equal(res.shortfall, 200);
});

test("an unrestricted bucket comes first and covers only up to the requested amount", () => {
  const res = allocate({
    buckets: [
      { id: "free", amount: 1000, scope: ALL },
      { id: "nike", amount: 500, scope: NIKE },
    ],
    amount: 600,
    lineItems: [item(300, 1, { brand: "Nike" }), item(400, 1, { brand: "Adidas" })],
  });
  // The unrestricted card is worth more than was asked for, so it takes it all
  // and the walk stops before the Nike card is even considered.
  assert.deepEqual(res.allocations, [{ bucketId: "free", amount: 600 }]);
  assert.equal(res.covered, 600);
  assert.equal(res.fullyCovered, true);
});

test("a restricted bucket spends eligible capacity and leaves the rest of the cart to a later bucket", () => {
  const res = allocate({
    buckets: [
      { id: "nike", amount: 1000, scope: NIKE },
      { id: "free", amount: 1000, scope: ALL },
    ],
    amount: 600,
    lineItems: mixedCart(),
  });
  assert.deepEqual(res.allocations, [
    { bucketId: "nike", amount: 300 },
    { bucketId: "free", amount: 200 },
  ]);
  assert.equal(res.covered, 500);
  assert.equal(res.shortfall, 100);
  assert.equal(res.fullyCovered, false);
});

test("a second restricted bucket sees the eligible capacity the first one took", () => {
  const res = allocate({
    buckets: [
      { id: "nike-1", amount: 400, scope: NIKE },
      { id: "nike-2", amount: 400, scope: NIKE },
    ],
    amount: 600,
    lineItems: nikeCart(),
  });
  // The cart only holds ₹500 of Nike, so the second card adds the last ₹100 —
  // it cannot re-spend the ₹400 already allocated, and cannot reach past the
  // eligible subtotal to claim the whole remaining ₹200.
  assert.deepEqual(res.allocations, [
    { bucketId: "nike-1", amount: 400 },
    { bucketId: "nike-2", amount: 100 },
  ]);
  assert.equal(res.covered, 500);
  assert.equal(res.shortfall, 100);
});

test("a restricted bucket with nothing left to spend is skipped rather than allocated zero", () => {
  const res = allocate({
    buckets: [
      { id: "nike-1", amount: 600, scope: NIKE },
      { id: "nike-2", amount: 600, scope: NIKE },
    ],
    amount: 600,
    lineItems: nikeCart(),
  });
  assert.deepEqual(res.allocations, [{ bucketId: "nike-1", amount: 500 }]);
  assert.equal(res.shortfall, 100);
});

test("a restricted bucket pays only for its own lines, in cart order, even when another card follows", () => {
  // The Adidas line comes first on purpose: a restricted card may not reach
  // across the basket to fund it, or the Adidas card below is left with nothing.
  const res = allocate({
    buckets: [
      { id: "nike", amount: 500, scope: NIKE },
      { id: "adidas", amount: 500, scope: { brands: ["Adidas"] } },
    ],
    amount: 700,
    lineItems: [
      item(300, 1, { brand: "Adidas", category: "Apparel" }),
      item(400, 1, { brand: "Nike", category: "Apparel" }),
    ],
  });
  assert.deepEqual(res.allocations, [
    { bucketId: "nike", amount: 400 },
    { bucketId: "adidas", amount: 300 },
  ]);
  assert.equal(res.covered, 700);
  assert.equal(res.shortfall, 0);
  assert.equal(res.fullyCovered, true);
});

test("buckets are walked in the order they are given", () => {
  const res = allocate({
    buckets: [
      { id: "c", amount: 100, scope: ALL },
      { id: "a", amount: 100, scope: ALL },
      { id: "b", amount: 100, scope: ALL },
    ],
    amount: 250,
    lineItems: nikeCart(),
  });
  assert.deepEqual(res.allocations, [
    { bucketId: "c", amount: 100 },
    { bucketId: "a", amount: 100 },
    { bucketId: "b", amount: 50 },
  ]);
  assert.equal(res.covered, 250);
});

test("maxBuckets truncation is flagged while a shortfall remains", () => {
  const res = allocate({
    buckets: [
      { id: "one", amount: 300, scope: ALL },
      { id: "two", amount: 300, scope: ALL },
    ],
    amount: 500,
    lineItems: nikeCart(),
    maxBuckets: 1,
  });
  assert.deepEqual(res.allocations, [{ bucketId: "one", amount: 300 }]);
  assert.equal(res.shortfall, 200);
  assert.equal(res.fullyCovered, false);
  assert.equal(res.truncatedByMaxBuckets, true);
});

test("maxBuckets that lands exactly on the requested amount does not flag truncation", () => {
  const res = allocate({
    buckets: [
      { id: "one", amount: 300, scope: ALL },
      { id: "two", amount: 300, scope: ALL },
    ],
    amount: 300,
    lineItems: nikeCart(),
    maxBuckets: 1,
  });
  assert.equal(res.covered, 300);
  assert.equal(res.shortfall, 0);
  assert.equal(res.fullyCovered, true);
  assert.equal(res.truncatedByMaxBuckets, false);
});

test("a skipped bucket does not consume one of the caller's maxBuckets slots", () => {
  const res = allocate({
    buckets: [
      { id: "nike", amount: 900, scope: NIKE },
      { id: "free", amount: 900, scope: ALL },
    ],
    amount: 400,
    lineItems: [item(400, 1, { brand: "Adidas", category: "Apparel" })],
    maxBuckets: 1,
  });
  // The Nike card cannot pay anything here, so the one allowed card is the
  // unrestricted one and the whole amount is still covered.
  assert.deepEqual(res.allocations, [{ bucketId: "free", amount: 400 }]);
  assert.equal(res.fullyCovered, true);
  assert.equal(res.truncatedByMaxBuckets, false);
});

test("maxBuckets of zero allocates nothing and reports the whole amount missing", () => {
  const res = allocate({ buckets: [{ id: "one", amount: 600, scope: ALL }], amount: 600, lineItems: nikeCart(), maxBuckets: 0 });
  assert.deepEqual(res.allocations, []);
  assert.equal(res.covered, 0);
  assert.equal(res.shortfall, 600);
  assert.equal(res.fullyCovered, false);
  assert.equal(res.truncatedByMaxBuckets, true);
});

test("an amount of zero allocates nothing and is already fully covered", () => {
  const res = allocate({ buckets: [{ id: "one", amount: 600, scope: ALL }], amount: 0, lineItems: nikeCart() });
  assert.deepEqual(res.allocations, []);
  assert.equal(res.covered, 0);
  assert.equal(res.shortfall, 0);
  assert.equal(res.fullyCovered, true);
  assert.equal(res.truncatedByMaxBuckets, false);
});

test("a negative amount clamps to zero instead of paying out", () => {
  const res = allocate({ buckets: [{ id: "one", amount: 600, scope: ALL }], amount: -250, lineItems: nikeCart() });
  assert.deepEqual(res.allocations, []);
  assert.equal(res.covered, 0);
  assert.equal(res.shortfall, 0);
  assert.equal(res.fullyCovered, true);
});

test("no buckets at all reports the full shortfall", () => {
  const res = allocate({ buckets: [], amount: 400, lineItems: nikeCart() });
  assert.deepEqual(res.allocations, []);
  assert.equal(res.shortfall, 400);
  assert.equal(res.fullyCovered, false);
  assert.equal(res.truncatedByMaxBuckets, false);
  // Absent buckets are tolerated the same way as an empty list.
  assert.equal(allocate({ amount: 400, lineItems: nikeCart() }).shortfall, 400);
});

test("a negative or empty bucket balance contributes nothing and is skipped", () => {
  const res = allocate({
    buckets: [
      { id: "spent", amount: -50, scope: ALL },
      { id: "empty", amount: 0, scope: ALL },
      { id: "live", amount: 200, scope: ALL },
    ],
    amount: 300,
    lineItems: nikeCart(),
  });
  assert.deepEqual(res.allocations, [{ bucketId: "live", amount: 200 }]);
  assert.equal(res.shortfall, 100);
});

test("coverage never exceeds what the cart is worth when more is requested than it holds", () => {
  const res = allocate({
    buckets: [
      { id: "nike", amount: 900, scope: NIKE },
      { id: "free", amount: 900, scope: ALL },
    ],
    amount: 900,
    lineItems: mixedCart(),
  });
  assert.deepEqual(res.allocations, [
    { bucketId: "nike", amount: 300 },
    { bucketId: "free", amount: 200 },
  ]);
  assert.equal(res.covered, 500);
  assert.equal(res.shortfall, 400);
});

test("an empty cart is worth nothing to allocate against", () => {
  const res = allocate({ buckets: [{ id: "free", amount: 900, scope: ALL }], amount: 300, lineItems: [] });
  assert.deepEqual(res.allocations, []);
  assert.equal(res.covered, 0);
  assert.equal(res.shortfall, 300);
});

test("without line items only the requested amount limits the draw", () => {
  // Resolved ambiguity: a missing cart is "capacity unknown", not "capacity 0",
  // so a restricted card is capped by its own eligible total (0 here) while an
  // unrestricted one still covers what was asked for.
  const res = allocate({ buckets: [{ id: "free", amount: 900, scope: ALL }], amount: 300 });
  assert.deepEqual(res.allocations, [{ bucketId: "free", amount: 300 }]);
  assert.equal(res.fullyCovered, true);
  const restricted = allocate({ buckets: [{ id: "nike", amount: 900, scope: NIKE }], amount: 300 });
  assert.deepEqual(restricted.allocations, []);
  assert.equal(restricted.shortfall, 300);
});

test("a split that would drift under floats settles on whole paise", () => {
  const res = allocate({
    buckets: [
      { id: "one", amount: "1.005", scope: ALL },
      { id: "two", amount: 10, scope: ALL },
    ],
    amount: 11.005,
    lineItems: [item(11.005, 1)],
  });
  assert.deepEqual(res.allocations, [
    { bucketId: "one", amount: 1.01 },
    { bucketId: "two", amount: 10 },
  ]);
  assert.equal(res.covered, 11.01);
  assert.equal(res.shortfall, 0);
  assert.equal(res.fullyCovered, true);
});

test("a restricted split is also settled in paise", () => {
  const res = allocate({
    buckets: [
      { id: "nike-1", amount: 100.004, scope: NIKE },
      { id: "nike-2", amount: 100, scope: NIKE },
    ],
    amount: 200.004,
    lineItems: [item(200.005, 1, { brand: "Nike" }), item(500, 1, { brand: "Adidas" })],
  });
  assert.deepEqual(res.allocations, [
    { bucketId: "nike-1", amount: 100 },
    { bucketId: "nike-2", amount: 100 },
  ]);
  assert.equal(res.covered, 200);
  assert.equal(res.shortfall, 0);
});

test("bucket ids are passed through untouched and a missing id becomes null", () => {
  const res = allocate({
    buckets: [
      { id: "e3f0-uuid", amount: 100, scope: ALL },
      { amount: 100, scope: ALL },
    ],
    amount: 150,
    lineItems: nikeCart(),
  });
  assert.deepEqual(res.allocations, [
    { bucketId: "e3f0-uuid", amount: 100 },
    { bucketId: null, amount: 50 },
  ]);
});

test("a bucket with no scope is treated as unrestricted", () => {
  const res = allocate({
    buckets: [{ id: "one", amount: 300 }],
    amount: 400,
    lineItems: [item(300, 1, { brand: "Adidas" }), item(100, 1, { brand: "Nike" })],
  });
  assert.deepEqual(res.allocations, [{ bucketId: "one", amount: 300 }]);
  assert.equal(res.shortfall, 100);
});
// The bug this pins: a claim freezes `normalizeScope(...)` onto the bucket, and
// that normalised object is handed back to allocate() at checkout. normalizeScope
// tags its output with `malformed`, and reading that tag back as an unknown key
// made every unrestricted bucket look restricted, so ordinary gift money covered
// nothing. Scopes here go through normalizeScope exactly as they do in production.
test("a bucket whose scope came from normalizeScope still spends", () => {
  const mixed = [
    { unitPrice: 500, quantity: 1, brand: "RiceCo", category: "rice", productId: "R1" },
    { unitPrice: 300, quantity: 1, brand: "SpiceCo", category: "spices", productId: "S1" },
  ];
  const free = normalizeScope([]);              // an unrestricted card
  const spices = normalizeScope([{ type: "CATEGORY", value: "spices" }]);

  assert.equal(isUnrestricted(free), true, "an unrestricted card must read as unrestricted");

  // Unrestricted money alone covers the whole basket.
  const alone = allocate({ buckets: [{ id: 1, amount: 1000, scope: free }], amount: 800, lineItems: mixed });
  assert.equal(alone.covered, 800);
  assert.equal(alone.fullyCovered, true);

  // Restricted money pays its own slice, unrestricted money covers the rest.
  const both = allocate({
    buckets: [
      { id: 1, amount: 1000, scope: spices },
      { id: 2, amount: 1000, scope: free },
    ],
    amount: 800,
    lineItems: mixed,
  });
  assert.equal(both.covered, 800);
  assert.equal(both.fullyCovered, true);
  assert.deepEqual(
    both.allocations.map((a) => a.bucketId).sort(),
    [1, 2],
    "both buckets are used: restricted for spices, unrestricted for the rice"
  );

  // And the guarantee still holds after the round trip: restricted money alone
  // cannot buy an ineligible basket.
  const riceOnly = [{ unitPrice: 500, quantity: 1, brand: "RiceCo", category: "rice", productId: "R1" }];
  const refused = allocate({ buckets: [{ id: 1, amount: 1000, scope: spices }], amount: 500, lineItems: riceOnly });
  assert.equal(refused.allocations.length, 0, "spices money must not pay for rice");
  assert.equal(refused.covered, 0);
});
