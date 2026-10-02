import test from "node:test";
import assert from "node:assert/strict";
import {
  eligibleTotal,
  isEligible,
  isUnrestricted,
  linePaise,
  normalizeScope,
  round2,
  scopeSummary,
  toPaise,
} from "../giftCardApplicability.js";

// Line items are written the way the checkout route builds them.
const item = (unitPrice, quantity, extra = {}) => ({ unitPrice, quantity, ...extra });

test("an unrestricted scope summarizes as All products and sums every line", () => {
  assert.equal(scopeSummary({}), "All products");
  assert.equal(eligibleTotal({}, [item(100, 2), item("50.50", 1)]), 250.5);
  assert.equal(eligibleTotal(undefined, [item(10, 1)]), 10);
});

test("an empty or absent line item list is worth zero", () => {
  assert.equal(eligibleTotal({}, []), 0);
  assert.equal(eligibleTotal({}, null), 0);
  assert.equal(eligibleTotal({}, undefined), 0);
  assert.equal(eligibleTotal({ brands: ["Nike"] }, []), 0);
});

test("a brand-only scope counts matching brands and excludes the rest", () => {
  const lines = [
    item(100, 2, { brand: "Nike", category: "Apparel" }),
    item(60, 1, { brand: "Adidas", category: "Apparel" }),
  ];
  assert.equal(eligibleTotal({ brands: ["Nike"] }, lines), 200);
  assert.equal(eligibleTotal({ brands: ["Nike", "Adidas"] }, lines), 260);
  assert.equal(eligibleTotal({ brands: ["Puma"] }, lines), 0);
});

test("a category-only scope counts matching categories and excludes the rest", () => {
  const lines = [
    item(199.99, 1, { brand: "Nike", category: "Footwear" }),
    item(40, 2, { brand: "Adidas", category: "Apparel" }),
  ];
  assert.equal(eligibleTotal({ categories: ["Footwear"] }, lines), 199.99);
  assert.equal(eligibleTotal({ categories: ["Apparel"] }, lines), 80);
  assert.equal(eligibleTotal({ categories: ["Electronics"] }, lines), 0);
});

test("a productIds-only scope counts only the listed products", () => {
  const lines = [
    item(100, 1, { productId: "p-1", brand: "Nike", category: "Apparel" }),
    item(250, 1, { productId: "p-2", brand: "Adidas", category: "Apparel" }),
  ];
  assert.equal(eligibleTotal({ productIds: ["p-1"] }, lines), 100);
  assert.equal(eligibleTotal({ productIds: ["p-1", "p-2"] }, lines), 350);
  assert.equal(eligibleTotal({ productIds: ["p-3"] }, lines), 0);
});

test("restrictions are ANDed, not ORed", () => {
  // Nike item in Electronics: the brand passes, the category does not.
  const lines = [
    item(500, 1, { brand: "Nike", category: "Electronics" }),
    item(200, 1, { brand: "Nike", category: "Apparel" }),
    // Adidas item in Apparel: the category passes, the brand does not.
    item(100, 1, { brand: "Adidas", category: "Apparel" }),
  ];
  assert.equal(eligibleTotal({ brands: ["Nike"], categories: ["Apparel"] }, lines), 200);
  // Either restriction alone would have paid both lines.
  assert.equal(eligibleTotal({ brands: ["Nike"] }, lines), 700);
  assert.equal(eligibleTotal({ categories: ["Apparel"] }, lines), 300);
  // A brand+category card pays nothing when the cart is all one side of the
  // pair, which is the union an OR would have produced.
  assert.equal(eligibleTotal({ brands: ["Adidas"], categories: ["Electronics"] }, lines), 0);
  assert.equal(isEligible({ brands: ["Nike"], categories: ["Apparel"] }, lines[0]), false);
  assert.equal(isEligible({ brands: ["Nike"], categories: ["Apparel"] }, lines[1]), true);
  assert.equal(isEligible({ brands: ["Nike"], categories: ["Apparel"] }, lines[2]), false);
  // Adding productIds narrows the intersection further rather than widening it:
  // the unnamed Nike apparel line drops out and only the p-2 line remains.
  assert.equal(eligibleTotal({ brands: ["Nike"], categories: ["Apparel"], productIds: ["p-9"] }, lines), 0);
  assert.equal(
    eligibleTotal({ brands: ["Nike"], categories: ["Apparel"], productIds: ["p-2"] }, [
      ...lines,
      item(200, 1, { brand: "Nike", category: "Apparel", productId: "p-2" }),
    ]),
    200
  );
});

test("brand and category matching ignores case and surrounding whitespace", () => {
  const lines = [item(75, 2, { brand: "  nIkE  ", category: "apparel " })];
  assert.equal(eligibleTotal({ brands: [" NIKE "] }, lines), 150);
  assert.equal(eligibleTotal({ brands: ["Nike"], categories: [" APPAREL"] }, lines), 150);
  assert.equal(eligibleTotal({ brands: ["nike"], categories: ["ApPaReL"] }, lines), 150);
  assert.equal(eligibleTotal({ brands: ["adidas"] }, lines), 0);
  assert.equal(eligibleTotal({ categories: ["electronics"] }, lines), 0);
});

test("product ids match as trimmed strings", () => {
  const lines = [item(10, 1, { productId: "  sku-42 " })];
  assert.equal(eligibleTotal({ productIds: ["sku-42"] }, lines), 10);
  assert.equal(eligibleTotal({ productIds: ["  sku-42  "] }, lines), 10);
  // The spec trims ids but does not fold their case, unlike brands/categories.
  assert.equal(eligibleTotal({ productIds: ["SKU-42"] }, lines), 0);
});

test("scopeSummary renders each restriction behind its label in a fixed order", () => {
  assert.equal(scopeSummary({ brands: ["Nike"] }), "Brand: Nike");
  assert.equal(scopeSummary({ categories: ["Apparel", "Footwear"] }), "Category: Apparel, Footwear");
  assert.equal(scopeSummary({ brands: ["Nike", "Adidas"] }), "Brand: Nike, Adidas");
  assert.equal(scopeSummary({ brands: ["Nike"], categories: ["Apparel"] }), "Brand: Nike, Category: Apparel");
  assert.equal(
    scopeSummary({ productIds: ["p-1", "p-2", "p-3"], brands: ["Nike"], categories: ["Apparel"] }),
    "Brand: Nike, Category: Apparel, Product: 3 items"
  );
});

test("scopeSummary counts products instead of listing them, singular for one", () => {
  assert.equal(scopeSummary({ productIds: ["p-1", "p-2", "p-3"] }), "Product: 3 items");
  assert.equal(scopeSummary({ productIds: ["p-1"] }), "Product: 1 item");
});

test("a present-but-empty scope is unrestricted", () => {
  assert.equal(scopeSummary(null), "All products");
  assert.equal(scopeSummary({ brands: [], categories: [], productIds: [] }), "All products");
  assert.equal(scopeSummary({ brands: [null, "  "], categories: undefined }), "All products");
  assert.equal(scopeSummary({ categories: [] }), "All products");
  assert.equal(scopeSummary([]), "All products");
  assert.equal(isUnrestricted({ brands: [null] }), true);
  assert.equal(isUnrestricted({ brands: ["Nike"] }), false);
});

// A scope we cannot interpret must never widen what a card's money may buy.
// Reading it as "no restriction" would let a spices-only card pay for a rice
// order, which is the exact bypass the design forbids, so it fails closed.
test("an unreadable scope is restricted, not unrestricted", () => {
  for (const bad of ["not-a-scope", { nonsense: true }, [{ type: "MYSTERY", value: "x" }], 42]) {
    assert.equal(isUnrestricted(bad), false);
    assert.equal(isEligible(bad, { unitPrice: 100, quantity: 1 }), false);
    assert.equal(eligibleTotal(bad, [{ unitPrice: 100, quantity: 1 }]), 0);
    assert.equal(scopeSummary(bad), "Unrecognised restriction");
  }
});

// The database stores scope as rows ({ type, value }) while the pure functions
// speak in { brands, categories, productIds }. Both must mean the same thing,
// or a restricted card's money becomes spendable on anything.
test("row-shaped and object-shaped scopes agree", () => {
  const rice = { unitPrice: 100, quantity: 1, brand: "RiceCo", category: "rice", productId: "R1" };
  const spice = { unitPrice: 100, quantity: 1, brand: "SpiceCo", category: "spices", productId: "S1" };
  const pairs = [
    [[{ type: "CATEGORY", value: "spices" }], { categories: ["spices"] }],
    [[{ type: "BRAND", value: "SpiceCo" }], { brands: ["SpiceCo"] }],
    [[{ type: "PRODUCT", value: "S1" }], { productIds: ["S1"] }],
    // Mixed restrictions, and the kind alias the DB column actually uses.
    [[{ kind: "BRAND", value: "SpiceCo" }, { type: "CATEGORY", value: "spices" }], { brands: ["SpiceCo"], categories: ["spices"] }],
  ];
  for (const [rows, object] of pairs) {
    assert.equal(isUnrestricted(rows), isUnrestricted(object));
    assert.equal(isEligible(rows, spice), isEligible(object, spice));
    assert.equal(isEligible(rows, rice), isEligible(object, rice));
    assert.equal(eligibleTotal(rows, [rice, spice]), eligibleTotal(object, [rice, spice]));
    assert.equal(scopeSummary(rows), scopeSummary(object));
  }
  // A row whose kind we do not know must not be silently dropped into "unrestricted".
  assert.equal(isUnrestricted([{ type: "MYSTERY", value: "x" }]), false);
  // Blank values are dropped, so a row of empties is genuinely no restriction.
  assert.equal(isUnrestricted([{ type: "CATEGORY", value: "  " }]), true);
});

test("scopeSummary keeps the stored casing of the values it shows", () => {
  assert.equal(scopeSummary({ brands: [" NIKE ", "Adidas"], categories: ["apparel"] }), "Brand: NIKE, Adidas, Category: apparel");
});

test("unitPrice arriving as a NUMERIC string is coerced", () => {
  const lines = [item("199.99", 2, { brand: "Nike" }), item("50", "1", { brand: "Nike" })];
  assert.equal(eligibleTotal({ brands: ["Nike"] }, lines), 449.98);
  assert.equal(eligibleTotal({}, [item("1000.00", 1)]), 1000);
  // A quantity that survived as a string from NUMERIC works the same way.
  assert.equal(eligibleTotal({}, [item(12.5, "3")]), 37.5);
});

test("non-finite money and quantities count as zero rather than poisoning the total", () => {
  assert.equal(eligibleTotal({}, [item("abc", 1)]), 0);
  assert.equal(eligibleTotal({}, [item(100, "many")]), 0);
  assert.equal(eligibleTotal({}, [item(null, 1)]), 0);
  assert.equal(eligibleTotal({}, [item(100, undefined)]), 0);
  assert.equal(eligibleTotal({}, [item(NaN, 2), item(10, 1)]), 10);
  assert.equal(eligibleTotal({}, [item(Infinity, 1)]), 0);
  assert.equal(linePaise({ unitPrice: "abc", quantity: 2 }), 0);
});

test("paise rounding survives the drift a naive float sum would keep", () => {
  const lines = [item(0.1, 1), item(0.2, 1), item(33.335, 1)];
  // Naive: 0.1 + 0.2 + 33.335 = 33.635 and the last step decides the answer.
  assert.equal(eligibleTotal({}, lines), 33.64);
  assert.equal(linePaise({ unitPrice: 33.335, quantity: 1 }), 3334);
  // 1.005 is stored below the boundary, so *100 gives 100.49999999999999.
  assert.equal(eligibleTotal({}, [item(1.005, 1)]), 1.01);
  assert.equal(eligibleTotal({}, [item(2.675, 1)]), 2.68);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(33.635), 33.64);
  // Many small lines that would accumulate error still land on whole paise.
  assert.equal(eligibleTotal({}, Array.from({ length: 10 }, () => item(0.1, 1))), 1);
  assert.equal(toPaise("33.335"), 3334);
});

test("each line settles to whole paise before it joins the total", () => {
  // Resolved ambiguity: rounding happens per line, so two half-paise lines are
  // worth a paisa between them rather than a half-paisa that rounds once.
  assert.equal(eligibleTotal({}, [item(0.005, 1), item(0.005, 1)]), 0.02);
  assert.equal(linePaise({ unitPrice: 0.005, quantity: 1 }), 1);
  assert.equal(linePaise({ unitPrice: 19.99, quantity: 3 }), 5997);
});

test("round2 is half away from zero, rejects non-finite input and never yields -0", () => {
  assert.equal(round2(0.005), 0.01);
  assert.equal(round2(-0.005), -0.01);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(1.499), 1.5);
  assert.equal(round2(1.4999), 1.5);
  assert.equal(round2("abc"), 0);
  assert.equal(round2(NaN), 0);
  assert.equal(round2(Infinity), 0);
  // assert/strict compares with Object.is, under which -0 !== 0.
  assert.equal(round2(-0.001), 0);
  assert.equal(round2(-0), 0);
});

test("isEligible answers per line so callers can report why a card will not apply", () => {
  const nikeShoe = item(100, 1, { brand: "Nike", category: "Footwear", productId: "p-1" });
  assert.equal(isEligible({}, nikeShoe), true);
  assert.equal(isEligible({ brands: ["Nike"] }, nikeShoe), true);
  assert.equal(isEligible({ brands: ["Nike"], categories: ["Footwear"] }, nikeShoe), true);
  assert.equal(isEligible({ brands: ["Adidas"] }, nikeShoe), false);
  assert.equal(isEligible({ brands: ["Nike"], categories: ["Apparel"] }, nikeShoe), false);
  assert.equal(isEligible({ productIds: ["p-2"] }, nikeShoe), false);
  // A missing line item only passes when there is nothing to fail.
  assert.equal(isEligible({}, null), true);
  assert.equal(isEligible({ brands: ["Nike"] }, null), false);
});
// normalizeScope's own output is fed back into it: a claim freezes a normalised
// scope onto the bucket, and the allocator reads that scope again at checkout.
// The round trip has to survive, or unrestricted gift money becomes unspendable.
test("a normalised scope survives being fed back in", () => {
  for (const input of [[], {}, null, [{ type: "CATEGORY", value: "spices" }], { brands: ["Nike"] }]) {
    const once = normalizeScope(input);
    const twice = normalizeScope(once);
    assert.deepEqual(
      { brands: twice.brands, categories: twice.categories, productIds: twice.productIds, malformed: twice.malformed },
      { brands: once.brands, categories: once.categories, productIds: once.productIds, malformed: once.malformed }
    );
    assert.equal(twice.malformed, false, "the first result must not read as unrecognised on re-entry");
  }
  // Specifically: an unrestricted card's money must stay spendable.
  assert.equal(isUnrestricted(normalizeScope([])), true);
  assert.equal(isUnrestricted(normalizeScope({})), true);
  assert.equal(isUnrestricted(normalizeScope([{ type: "CATEGORY", value: "spices" }])), false);
  // Genuinely unrecognised input still fails closed.
  assert.equal(isUnrestricted({ nonsense: 1 }), false);
});
