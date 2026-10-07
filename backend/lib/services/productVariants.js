import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Variant identity and combination logic.
//
// products.variants (JSONB) is the single source of truth for variants, exactly
// as it is today. This module only ADDS identity to each entry and derives the
// cartesian product of a product's attributes. It never rewrites price, stock,
// sku or any other key it did not create.
//
// A variant entry looks like:
//   { uuid, sku, barcode, name, price, stock, discountPrice, status,
//     attributes: { "Pack Size": "2KG" } }
// Older rows predate uuid/status/barcode; ensureIdentity() fills those in
// without touching the keys that are already there.
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE = "ACTIVE";
const INACTIVE = "INACTIVE";

export function isVariantActive(variant) {
  if (!variant) return false;
  return (variant.status || ACTIVE) === ACTIVE;
}

/** Attribute groups for a product, merged by name and de-duplicated by value. */
export function attributeGroups(attributes) {
  const list = Array.isArray(attributes) ? attributes : [];
  const byName = new Map();

  for (const attr of list) {
    const name = attr?.name;
    if (!name) continue;

    // Accept both shapes: { name, values: [...] } (form) and { name, value }
    // (stored). Products in this database currently use the latter.
    const raw = Array.isArray(attr.values)
      ? attr.values
      : attr.value != null && attr.value !== ""
        ? [attr.value]
        : [];

    const values = byName.get(name) || [];
    for (const value of raw) {
      const trimmed = String(value).trim();
      if (trimmed && !values.includes(trimmed)) values.push(trimmed);
    }
    if (values.length > 0) byName.set(name, values);
  }

  return [...byName.entries()].map(([name, values]) => ({ name, values }));
}

/** How many combinations the current attributes produce. */
export function combinationCount(attributes) {
  const groups = attributeGroups(attributes);
  if (groups.length === 0) return 0;
  return groups.reduce((acc, group) => acc * group.values.length, 1);
}

/** Cartesian product of the attribute groups. */
export function generateCombinations(attributes) {
  const groups = attributeGroups(attributes);

  if (groups.length === 0) return [];

  return groups.reduce(
    (acc, group) =>
      acc.flatMap((combo) =>
        group.values.map((value) => [...combo, { name: group.name, value }])
      ),
    [[]]
  );
}

/** Stable key for a combination, used for matching and duplicate detection. */
export function combinationKey(attributes) {
  const entries = Object.entries(attributes || {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return entries.map(([name, value]) => `${name}:${value}`).join("|");
}

/**
 * Slug used to build readable SKUs. Deliberately generic — the application
 * already owns SKU formatting, so this only fills a gap when a SKU is absent.
 */
function slugPart(value, max = 3) {
  return String(value)
    .replace(/[^a-z0-9]+/gi, "")
    .slice(0, max)
    .toUpperCase() || "VAR";
}

export function buildSku(baseSku, productName, attributes) {
  const base = String(baseSku || productName || "SKU").trim();
  const basePart = base.replace(/\s+/g, "-").toUpperCase();
  const suffix = Object.entries(attributes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => slugPart(value))
    .join("-");
  return `${basePart}-${suffix}`;
}

/**
 * Fill in identity on every variant that lacks it. Keys that already exist are
 * left exactly as they are, so price/stock/sku history is never rewritten.
 */
export function ensureIdentity(variants) {
  const list = Array.isArray(variants) ? variants : [];

  return list.map((variant) => {
    if (!variant || typeof variant !== "object") return variant;

    const next = { ...variant };

    if (!next.uuid) next.uuid = randomUUID();
    if (!next.status) next.status = ACTIVE;
    if (next.barcode === undefined) next.barcode = null;

    return next;
  });
}

/**
 * Merge generated combinations into the existing variants.
 *
 * Existing variants are never dropped. When a combination disappears because an
 * attribute value was removed, the variant is marked INACTIVE instead — so any
 * inventory, purchase or sales history attached to it stays intact and readable
 * (see rule: never delete a variant that has been used).
 */
export function mergeVariants(existing, attributes, { sku, name } = {}) {
  const current = ensureIdentity(existing);
  const combos = generateCombinations(attributes);
  const byKey = new Map();

  for (const variant of current) {
    const key = combinationKey(variant.attributes);
    if (key) byKey.set(key, variant);
  }

  const merged = [];

  for (const combo of combos) {
    const attributesMap = Object.fromEntries(
      combo.map((item) => [item.name, item.value])
    );
    const key = combinationKey(attributesMap);
    const match = byKey.get(key);

    if (match) {
      // Re-activate a previously retired variant rather than creating a second
      // row for the same combination.
      merged.push({ ...match, status: ACTIVE, attributes: attributesMap });
      byKey.delete(key);
      continue;
    }

    merged.push({
      uuid: randomUUID(),
      sku: buildSku(sku, name, attributesMap),
      barcode: null,
      name: combo.map((item) => item.value).join(" / "),
      price: null,
      stock: 0,
      discountPrice: null,
      status: ACTIVE,
      attributes: attributesMap,
    });
  }

  // Anything left in byKey is no longer described by the attributes. Keep it,
  // retired, so history survives.
  for (const orphan of byKey.values()) {
    merged.push({ ...orphan, status: INACTIVE });
  }

  return merged;
}

/**
 * Reject duplicate combinations and duplicate SKUs within one product.
 * Returns { ok, errors } rather than throwing so callers can map to a 422.
 */
export function validateVariants(variants) {
  const errors = [];
  const list = Array.isArray(variants) ? variants : [];
  const seenCombos = new Map();
  const seenSkus = new Map();

  list.forEach((variant, index) => {
    const label = variant?.name || variant?.sku || `row ${index + 1}`;
    const key = combinationKey(variant?.attributes);

    if (key) {
      if (seenCombos.has(key)) {
        errors.push(`Duplicate combination for "${variant.name || key}"`);
      } else {
        seenCombos.set(key, index);
      }
    }

    const sku = variant?.sku ? String(variant.sku).trim() : "";
    if (sku) {
      const norm = sku.toUpperCase();
      if (seenSkus.has(norm)) {
        errors.push(`Duplicate SKU "${sku}" on "${label}"`);
      } else {
        seenSkus.set(norm, index);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Find a variant on a product and confirm it is usable for trading.
 * Used by purchase invoices and the cart so the backend never trusts a
 * client-supplied variant id.
 */
export function resolveVariant(product, variantUuid, { requireActive = true } = {}) {
  if (!product) return { ok: false, error: "Product not found" };

  const variants = ensureIdentity(product.variants);

  if (variantUuid === null || variantUuid === undefined || variantUuid === "") {
    // Product-level line: valid, but only when the product has no variants to
    // choose from.
    return {
      ok: true,
      variant: null,
      productLevel: true,
      error: variants.length
        ? "This product has variants; a variant must be selected"
        : null,
    };
  }

  const variant = variants.find((v) => v.uuid === String(variantUuid));

  if (!variant) {
    return { ok: false, error: "Variant does not belong to this product" };
  }

  if (requireActive && !isVariantActive(variant)) {
    return { ok: false, error: `Variant "${variant.name || variant.sku}" is inactive` };
  }

  return { ok: true, variant, productLevel: false, error: null };
}

/** Active variants only, for pickers. */
export function activeVariants(product) {
  return ensureIdentity(product?.variants).filter(isVariantActive);
}