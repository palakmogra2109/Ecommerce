import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateAcrossCards,
  cardContribution,
  compareForSpending,
  effectiveStatus,
  isCardUsable,
  isExpired,
  maskCode,
  normalizeGiftCode,
  round2,
  walletTotal,
  scopeLabel,
  isCardUnrestricted,
  unusableReason,
} from "../giftCardRules.js";

const now = Date.parse("2026-06-01T00:00:00.000Z");

function card(overrides = {}) {
  return {
    id: 1,
    code_hash: "abc",
    code_last4: "92XM",
    initial_amount: "1000",
    balance: "1000",
    max_redemption_amount: null,
    usage_limit: null,
    applicable_branches: [],
    applicable_brands: [],
    applicable_products: [],
    applicable_categories: [],
    status: "ACTIVE",
    recipient_email: null,
    expires_at: null,
    ...overrides,
  };
}

test("codes normalize to uppercase dash form", () => {
  assert.equal(normalizeGiftCode("  gift 8k4p 92xm "), "GIFT-8K4P-92XM");
});

test("hashed rows expose only the last four characters", () => {
  assert.equal(maskCode({ code_hash: "h", code_last4: "92XM" }).code, "••••-92XM");
  // Legacy pre-hash rows still have a readable code.
  assert.equal(maskCode({ code: "LEGACY-1", code_hash: null }).code, "LEGACY-1");
});

test("the lookup hash is never part of a masked row", () => {
  // Leaking the hash would let an attacker confirm guesses offline.
  const masked = maskCode({ code_hash: "secret-hash", code_last4: "92XM", balance: "10" });
  assert.equal("code_hash" in masked, false);
  assert.equal(JSON.stringify(masked).includes("secret-hash"), false);
});

test("expiry is derived from expires_at, not stored", () => {
  const past = card({ expires_at: "2026-05-31T00:00:00.000Z" });
  assert.equal(isExpired(past, now), true);
  assert.equal(effectiveStatus(past, now), "EXPIRED");
  // A fully used or cancelled card keeps its terminal status.
  assert.equal(effectiveStatus({ ...past, status: "REDEEMED" }, now), "REDEEMED");
  assert.equal(effectiveStatus({ ...past, status: "CANCELLED" }, now), "CANCELLED");
  // A zero-balance card is not worth showing as expired.
  assert.equal(effectiveStatus({ ...past, balance: "0" }, now), "ACTIVE");
  assert.equal(effectiveStatus(card({ expires_at: "2026-07-01T00:00:00.000Z" }), now), "ACTIVE");
});

test("a card is usable only when sellable, funded and within its usage limit", () => {
  assert.equal(isCardUsable(card(), { now }), true);
  for (const status of ["DRAFT", "SUSPENDED", "CANCELLED", "REDEEMED"]) {
    assert.equal(isCardUsable(card({ status }), { now }), false, status);
  }
  assert.equal(isCardUsable(card({ balance: "0" }), { now }), false);
  assert.equal(isCardUsable(card({ usage_limit: 1 }), { now, usageCount: 1 }), false);
  assert.equal(isCardUsable(card({ usage_limit: 2 }), { now, usageCount: 1 }), true);
  assert.equal(isCardUsable(card({ expires_at: "2026-05-01T00:00:00.000Z" }), { now }), false);
  assert.equal(isCardUsable(null, { now }), false);
});

test("cards are spent earliest-expiry first, then smallest balance", () => {
  const soon = card({ id: 1, balance: "900", expires_at: "2026-06-10T00:00:00.000Z" });
  const later = card({ id: 2, balance: "800", expires_at: "2026-09-01T00:00:00.000Z" });
  const never = card({ id: 3, balance: "800", expires_at: null });
  // The expiring card wins even though it holds more.
  assert.equal([later, never, soon].sort(compareForSpending)[0].id, 1);
  // Same expiry: the smaller balance is cleared first.
  assert.equal([card({ id: 9, balance: "500" }), card({ id: 8, balance: "700" })]
    .sort(compareForSpending)[0].id, 9);
  // Full ordering is deterministic.
  assert.equal([later, soon, never].sort(compareForSpending).map((c) => c.id).join(","), "1,2,3");
});

test("a card contributes at most its balance and per-use cap", () => {
  assert.equal(cardContribution(card({ balance: "400" }), 900), 400);
  assert.equal(cardContribution(card({ max_redemption_amount: "300" }), 900), 300);
  assert.equal(cardContribution(card(), 250), 250);
  assert.equal(cardContribution(card(), 0), 0);
  assert.equal(cardContribution(card(), -50), 0);
  assert.equal(cardContribution(card({ balance: "0" }), 500), 0);
});

test("a single card can cover the whole order", () => {
  const { total, lines } = allocateAcrossCards([card({ id: 1, balance: "2000" })], {
    remaining: 1200,
  });
  assert.equal(total, 1200);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, 1200);
});

test("the balance spills across several cards until the order is covered", () => {
  // Shopper has 800 total on a 1200 cart: 800 off, 400 still payable.
  const cards = [
    card({ id: 1, balance: "500" }),
    card({ id: 2, balance: "300" }),
  ];
  const { total, lines } = allocateAcrossCards(cards, { remaining: 1200 });
  assert.equal(total, 800);
  // Same expiry, so the smaller balance (300) is cleared first.
  assert.deepEqual(lines.map((l) => l.amount), [300, 500]);
  assert.deepEqual(lines.map((l) => l.card.id), [2, 1]);
});

test("a card is never over-drawn and rounding stays in paise", () => {
  const cards = [card({ id: 1, balance: "333.33" }), card({ id: 2, balance: "333.33" })];
  const { total, lines } = allocateAcrossCards(cards, { remaining: 1000 });
  assert.equal(total, 666.66);
  assert.deepEqual(lines.map((l) => l.amount), [333.33, 333.33]);

  const odd = allocateAcrossCards([card({ id: 1, balance: "10.005" })], { remaining: 10 });
  assert.equal(odd.total, 10);
});

test("scope limits a card to specific products", () => {
  const scoped = card({ applicable_products: [11] });
  assert.equal(
    unusableReason(scoped, { items: [{ productId: 12 }] }),
    "This gift card is not valid for the items in your cart."
  );
  assert.equal(unusableReason(scoped, { items: [{ productId: 11 }] }), null);
  // No basket supplied means scope cannot be judged, so it is not failed.
  assert.equal(unusableReason(scoped, { items: null }), null);
  assert.equal(isCardUnrestricted(scoped), false);
});

test("scope limits a card to specific brands and categories", () => {
  const branded = card({ applicable_brands: [4] });
  assert.equal(
    unusableReason(branded, { items: [{ productId: 11, brandId: 2 }] }),
    "This gift card is limited to other brands."
  );
  assert.equal(unusableReason(branded, { items: [{ productId: 11, brandId: 4 }] }), null);

  const categorised = card({ applicable_categories: ["spices-masalas"] });
  assert.equal(
    unusableReason(categorised, { items: [{ productId: 11, categoryId: "oils-ghee" }] }),
    "This gift card is limited to other categories."
  );
  assert.equal(
    unusableReason(categorised, { items: [{ productId: 11, categoryId: "spices-masalas" }] }),
    null
  );
  // Either kind of match satisfies an OR-ed basket.
  assert.equal(isCardUnrestricted(card()), true);
});

test("scope matches whether a line offers a slug or a numeric id", () => {
  // The bug this guards: a card stores category SLUGS while a server-built
  // line carries the numeric id. Comparing only one form silently rejected
  // every scoped card, so both are now collected and either can match.
  const bySlug = card({ applicable_categories: ["spices-masalas"] });
  assert.equal(
    unusableReason(bySlug, { items: [{ category_id: 4, category_slug: "spices-masalas" }] }),
    null
  );
  // A slug-scoped card cannot be matched by a line that carries only the
  // numeric id: nothing in the line says which category 4 is. Failing closed
  // is right here, which is why real lines must send the slug too.
  assert.equal(
    unusableReason(bySlug, { items: [{ category_id: 4 }] }),
    "This gift card is limited to other categories."
  );

  const byId = card({ applicable_categories: [4] });
  assert.equal(unusableReason(byId, { items: [{ category_id: 4 }] }), null);
  assert.equal(
    unusableReason(byId, { items: [{ category_slug: "spices-masalas", category_id: 4 }] }),
    null
  );

  // A line that is genuinely out of scope is still rejected.
  assert.equal(
    unusableReason(bySlug, { items: [{ category_id: 2, category_slug: "grains-pulses" }] }),
    "This gift card is limited to other categories."
  );
});

test("product scope matches a uuid or a numeric product id", () => {
  const byUuid = card({ applicable_products: ["abc-123"] });
  assert.equal(unusableReason(byUuid, { items: [{ product_uuid: "abc-123" }] }), null);
  assert.equal(unusableReason(byUuid, { items: [{ product_id: 7 }] }), "This gift card is not valid for the items in your cart.");

  const byId = card({ applicable_products: [7] });
  assert.equal(unusableReason(byId, { items: [{ product_id: 7 }] }), null);
  assert.equal(unusableReason(byId, { items: [{ product_uuid: "abc-123" }] }), "This gift card is not valid for the items in your cart.");
});

test("any in-scope line satisfies the card, so a mixed cart still works", () => {
  // Categories are matched by slug, products by uuid.
  const scoped = card({ applicable_categories: ["oils-ghee"] });
  const basket = [
    { productId: "p1", categoryId: "grains-pulses" },
    { productId: "p2", categoryId: "oils-ghee" },
  ];
  assert.equal(unusableReason(scoped, { items: basket }), null);
});

test("scope is worded in shopper terms", () => {
  assert.equal(scopeLabel(card()), "Any product");
  assert.equal(scopeLabel(card({ applicable_brands: [3] })), "Brand #3");
  assert.equal(
    scopeLabel(card({ applicable_brands: [3] }), { brandNames: { 3: "Nila Organics" } }),
    "Nila Organics"
  );
  assert.equal(scopeLabel(card({ applicable_categories: ["oils-ghee"] })), "oils-ghee");
  assert.equal(scopeLabel(card({ applicable_products: [1, 2] })), "2 selected items");
  assert.equal(
    scopeLabel(card({ applicable_brands: [1], applicable_products: [1, 2] })),
    "Brand #1 · 2 selected items"
  );
});

test("unusable cards are skipped, not applied", () => {
  const cards = [
    card({ id: 1, balance: "0" }),
    card({ id: 2, status: "SUSPENDED", balance: "500" }),
    card({ id: 3, balance: "400" }),
  ];
  const { total, lines, skipped } = allocateAcrossCards(cards, {
    remaining: 1000,
    usable: (c) => isCardUsable(c, { now }),
  });
  assert.equal(total, 400);
  assert.deepEqual(lines.map((l) => l.card.id), [3]);
  assert.deepEqual(skipped.map((c) => c.id), [1, 2]);
});

test("an exhausted card does not block a later usable one", () => {
  const cards = [
    card({ id: 1, balance: "500", usage_limit: 1 }),
    card({ id: 2, balance: "500" }),
  ];
  const { total, lines } = allocateAcrossCards(cards, {
    remaining: 800,
    usable: (c) => isCardUsable(c, { now, usageCount: c.id === 1 ? 1 : 0 }),
  });
  assert.equal(total, 500);
  assert.deepEqual(lines.map((l) => l.card.id), [2]);
});

test("the wallet total sums only usable cards", () => {
  const cards = [
    card({ id: 1, balance: "1500" }),
    card({ id: 2, balance: "1000" }),
    card({ id: 3, balance: "900", status: "SUSPENDED" }),
    card({ id: 4, balance: "700", expires_at: "2026-05-01T00:00:00.000Z" }),
    card({ id: 5, balance: "0" }),
  ];
  assert.equal(walletTotal(cards, { now }), 2500);
  // A spent usage limit drops the card out of the total. Card 1 has no limit,
  // so only a limited card is affected.
  assert.equal(walletTotal(cards, { now }), 2500);
  const limited = [card({ id: 1, balance: "1500", usage_limit: 1 }), card({ id: 2, balance: "1000" })];
  assert.equal(walletTotal(limited, { now, usageCounts: { 1: 1 } }), 1000);
  assert.equal(walletTotal([], { now }), 0);
  assert.equal(round2(walletTotal([card({ balance: "0.1" }), card({ balance: "0.2" })], { now })), 0.3);
});
