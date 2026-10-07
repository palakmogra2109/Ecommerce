import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/aliasHooks.mjs";
import {
  attributeGroups,
  combinationCount,
  generateCombinations,
  mergeVariants,
  validateVariants,
  resolveVariant,
  ensureIdentity,
  activeVariants,
  buildSku,
} from "../services/productVariants.js";

const RAJMA_ATTRS = [
  { name: "Color", values: ["White", "Maroon", "Black"] },
  { name: "Pack Size", values: ["500g", "2KG", "10KG"] },
];

test("Rajma: 3 colours x 3 pack sizes generates exactly 9 unique variants", () => {
  const combos = generateCombinations(RAJMA_ATTRS);

  assert.equal(combos.length, 9);
  assert.equal(combinationCount(RAJMA_ATTRS), 9);

  const keys = new Set(
    combos.map((c) => c.map((i) => `${i.name}:${i.value}`).join("|"))
  );
  assert.equal(keys.size, 9, "every combination must be unique");

  const names = combos.map((c) => c.map((i) => i.value).join(" / "));
  assert.ok(names.includes("White / 500g"));
  assert.ok(names.includes("Black / 10KG"));
  assert.ok(names.includes("Maroon / 2KG"));
});

test("stored attribute shape {name,value} is accepted, not just {name,values}", () => {
  const groups = attributeGroups([
    { name: "Weight", value: "5kg", attribute_uuid: "x" },
    { name: "Weight", value: "1 kg", attribute_uuid: "x" },
  ]);

  assert.equal(groups.length, 1, "same attribute name merges into one group");
  assert.deepEqual(groups[0].values, ["5kg", "1 kg"]);
  assert.equal(combinationCount([{ name: "Weight", value: "5kg" }]), 1);
});

test("every generated variant gets a uuid, ACTIVE status and a distinct SKU", () => {
  const merged = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });

  assert.equal(merged.length, 9);
  for (const v of merged) {
    assert.match(v.uuid, /^[0-9a-f-]{36}$/i);
    assert.equal(v.status, "ACTIVE");
    assert.match(v.sku, /^RAJMA-/);
  }
  assert.equal(new Set(merged.map((v) => v.uuid)).size, 9);
  assert.equal(new Set(merged.map((v) => v.sku)).size, 9, "SKUs must not collide");
});

test("merging is idempotent: re-running does not duplicate variants", () => {
  const first = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });
  const second = mergeVariants(first, RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });

  assert.equal(second.length, 9);
  assert.deepEqual(
    first.map((v) => v.uuid).sort(),
    second.map((v) => v.uuid).sort(),
    "same variants, same identities"
  );
});

test("removing an attribute value retires the variant instead of deleting it", () => {
  const first = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });
  const withStock = first.map((v, i) => ({ ...v, stock: i === 0 ? 100 : 0 }));

  // Admin removes "Black" from the Color attribute.
  const reduced = RAJMA_ATTRS.map((a) =>
    a.name === "Color"
      ? { name: "Color", values: ["White", "Maroon"] }
      : a
  );
  const after = mergeVariants(withStock, reduced, { sku: "RAJMA", name: "Rajma" });

  const black = after.filter((v) => v.attributes.Color === "Black");

  assert.equal(black.length, 3, "the 3 Black variants are retained, not deleted");
  for (const v of black) assert.equal(v.status, "INACTIVE");

  const white500 = after.find(
    (v) => v.attributes.Color === "White" && v.attributes["Pack Size"] === "500g"
  );
  assert.equal(white500.status, "ACTIVE");
  assert.equal(white500.stock, 100, "existing stock is never reset by a re-merge");
});

test("re-adding a removed value reactivates the same variant rather than duplicating", () => {
  const full = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });
  const withoutBlack = RAJMA_ATTRS.map((a) =>
    a.name === "Color" ? { name: "Color", values: ["White"] } : a
  );
  const retired = mergeVariants(full, withoutBlack, { sku: "RAJMA", name: "Rajma" });
  const restored = mergeVariants(retired, RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });

  assert.equal(restored.length, 9, "still exactly 9, no duplicates created");
  assert.equal(restored.filter((v) => v.status === "ACTIVE").length, 9);
});

test("duplicate combinations are rejected", () => {
  const merged = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });
  const withDup = [...merged, { ...merged[0] }];

  const result = validateVariants(withDup);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Duplicate combination/i.test(e)));
});

test("duplicate SKUs are rejected", () => {
  const merged = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });
  const clash = [...merged];
  clash[1] = { ...clash[1], sku: clash[0].sku };

  const result = validateVariants(clash);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Duplicate SKU/i.test(e)));
});

test("resolveVariant refuses a variant that belongs to another product", () => {
  const merged = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });
  const rajma = { id: 1, variants: merged };
  const other = { id: 2, variants: mergeVariants([], [{ name: "Color", values: ["Red"] }]) };

  const r = resolveVariant(rajma, other.variants[0].uuid);

  assert.equal(r.ok, false);
  assert.match(r.error, /does not belong/i);
});

test("resolveVariant refuses an inactive variant for trading", () => {
  const merged = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });
  const target = merged[0].uuid;
  const product = { id: 1, variants: merged.map((v, i) => (i === 0 ? { ...v, status: "INACTIVE" } : v)) };

  const r = resolveVariant(product, target);

  assert.equal(r.ok, false);
  assert.match(r.error, /inactive/i);
  assert.equal(resolveVariant(product, target, { requireActive: false }).ok, true);
});

test("a product with variants requires a variant to be chosen", () => {
  const merged = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });

  const r = resolveVariant({ id: 1, variants: merged }, null);

  assert.equal(r.ok, true);
  assert.equal(r.productLevel, true);
  assert.match(r.error, /variant must be selected/i);
});

test("a product with no variants still allows a product-level line", () => {
  const r = resolveVariant({ id: 3, variants: [] }, null);

  assert.equal(r.ok, true);
  assert.equal(r.productLevel, true);
  assert.equal(r.error, null);
});

test("ensureIdentity preserves existing price, stock and sku", () => {
  const existing = [{ sku: "KEEP-1", name: "5kg", price: 900, stock: 4000, attributes: { Weight: "5kg" } }];

  const [out] = ensureIdentity(existing);

  assert.equal(out.sku, "KEEP-1");
  assert.equal(out.price, 900);
  assert.equal(out.stock, 4000);
  assert.equal(out.status, "ACTIVE");
  assert.ok(out.uuid);
});

test("activeVariants hides retired ones from pickers", () => {
  const merged = mergeVariants([], RAJMA_ATTRS, { sku: "RAJMA", name: "Rajma" });
  const mixed = merged.map((v, i) => (i % 2 === 0 ? { ...v, status: "INACTIVE" } : v));

  assert.equal(activeVariants({ variants: mixed }).length, 4);
});

test("buildSku is readable and stable", () => {
  assert.equal(
    buildSku("RAJMA", "Rajma", { Color: "Maroon", "Pack Size": "2KG" }),
    "RAJMA-MAR-2KG"
  );
});