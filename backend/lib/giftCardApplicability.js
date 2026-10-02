// Pure gift-card applicability: which line items a card's scope permits, and
// what those line items are worth. Deliberately free of DB access so the same
// answer can be produced by a quote endpoint, by the order transaction, and by
// a unit test.
//
// Money here is integer paise. `unitPrice` arrives as a Postgres NUMERIC string
// ("199.99"), so every monetary input is coerced with Number() and any
// non-finite value is treated as 0 rather than poisoning a total with NaN.

// Values only need to settle two decimals, so a nudge far below one paisa is
// enough to lift a value that *is* a half-paisa boundary back onto it.
const PAISE_NUDGE = 1e-8;

/**
 * Rounds to two decimals, half away from zero.
 *
 * JS `toFixed` already rounds half away from zero for positive values, but
 * scaling by 100 first is what breaks: 1.005 is stored as
 * 1.00499999999999989, so `Math.round(1.005 * 100)` is 100, not 101, and
 * `(1.005).toFixed(2)` is "1.00". Rounding in integer paise with a sub-paise
 * nudge first keeps the half-up behaviour the spec asks for; everything
 * downstream (sums, splits) is done in paise too, so no float drift accumulates.
 *
 * Negative zero is normalized to 0 because `Object.is(-0, 0)` is false and the
 * strict assertions downstream compare with it.
 */
export function round2(value) {
  const paise = toPaise(value);
  return paise === 0 ? 0 : paise / 100;
}

/** Integer paise for a rupee amount, half away from zero. 0 for anything non-finite. */
export function toPaise(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const paise = Math.round(Math.abs(n) * 100 + PAISE_NUDGE);
  return n < 0 ? -paise : paise;
}

// JSONB scope columns arrive as parsed arrays; entries are trimmed, and blank
// entries are dropped so `{ brands: [null, "  "] }` cannot accidentally read as a
// brand restriction.
const textList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => (entry == null ? "" : String(entry).trim()))
    .filter((entry) => entry !== "");

// Brand and category matching is case-insensitive; product ids are trimmed
// strings compared as-is.
const fold = (value) => String(value == null ? "" : value).trim().toLowerCase();
const keyList = (value) => textList(value).map(fold);

// The two shapes a scope legitimately arrives in.
//
//   object: { brands: [...], categories: [...], productIds: [...] }
//   rows:   [{ type: 'CATEGORY', value: 'spices' }]  <- gift_card_applicability
//
// The row form is what the database stores and what the templates' scope
// columns produce, so it has to be understood here rather than at every call
// site. Getting this wrong is not cosmetic: an unrecognised non-empty scope used
// to read as *unrestricted*, which would let money from a spices-only card pay
// for a rice order. A scope we cannot interpret therefore fails CLOSED, below.
const SCOPE_KINDS = Object.freeze({
  BRAND: "brands",
  CATEGORY: "categories",
  PRODUCT: "productIds",
});

/**
 * Folds either scope shape into one canonical object.
 *
 * `malformed` is true when the input was non-empty but held nothing this can
 * read as a restriction. Every consumer treats that as "restricted to nothing",
 * so an unreadable scope can never widen what a card's money may buy.
 */
export function normalizeScope(scope) {
  const empty = { brands: [], categories: [], productIds: [] };
  if (scope == null) return { ...empty, malformed: false };

  if (Array.isArray(scope)) {
    const out = { brands: [], categories: [], productIds: [] };
    let sawUnknown = false;
    for (const entry of scope) {
      const kind = SCOPE_KINDS[String(entry?.type ?? entry?.kind ?? "").trim().toUpperCase()];
      const value = String(entry?.value ?? "").trim();
      if (!kind) {
        // A row we cannot classify is a restriction we cannot honour.
        if (value !== "" || entry != null) sawUnknown = true;
        continue;
      }
      if (value !== "") out[kind].push(value);
    }
    const empty2 = !out.brands.length && !out.categories.length && !out.productIds.length;
    return { ...out, malformed: sawUnknown && empty2 };
  }

  if (typeof scope !== "object") return { ...empty, malformed: true };

  const out = {
    brands: textList(scope.brands),
    categories: textList(scope.categories),
    productIds: textList(scope.productIds),
  };
  // Only keys we do not recognise make the scope unreadable. `{ categories: [] }`
  // is a present-but-empty restriction, which means no restriction; it is
  // `{ nonsense: true }` that we cannot honour.
  //
  // `malformed` is in the recognised set on purpose: normalizeScope returns it,
  // and its own output is routinely fed straight back in (a claim freezes a
  // normalised scope onto the bucket, and the allocator reads it again later).
  // Treating that as an unknown key made every normalised empty scope read as
  // restricted, so unrestricted gift money could not be spent at all. The value
  // is always recomputed here rather than trusted from the input.
  const recognised = new Set(["brands", "categories", "productIds", "malformed"]);
  const unknownKeys = Object.keys(scope).filter((key) => !recognised.has(key));
  const empty2 = !out.brands.length && !out.categories.length && !out.productIds.length;
  return { ...out, malformed: empty2 && unknownKeys.length > 0 };
}

/** True when the scope restricts nothing: a card any basket may spend. */
export function isUnrestricted(scope) {
  const s = normalizeScope(scope);
  if (s.malformed) return false;
  return !s.brands.length && !s.categories.length && !s.productIds.length;
}

/**
 * Short human description of a scope, for admin UI and email copy.
 * Unrestricted reads "All products"; otherwise the present restrictions in
 * Brand, Category, Product order, each behind its label.
 */
export function scopeSummary(scope) {
  const s = normalizeScope(scope);
  if (s.malformed) return "Unrecognised restriction";
  const brands = s.brands;
  const categories = s.categories;
  const products = s.productIds;
  if (!brands.length && !categories.length && !products.length) return "All products";

  const parts = [];
  if (brands.length) parts.push(`Brand: ${brands.join(", ")}`);
  if (categories.length) parts.push(`Category: ${categories.join(", ")}`);
  // A product list can be long, so it is counted rather than enumerated.
  if (products.length) parts.push(`Product: ${products.length} ${products.length === 1 ? "item" : "items"}`);
  return parts.join(", ");
}

/**
 * Whether one line item may be paid for by this scope. Every present
 * restriction has to pass (AND): a brand+category card only pays for the
 * intersection, never for the union.
 */
export function isEligible(scope, lineItem) {
  const s = normalizeScope(scope);
  const brands = keyList(s.brands);
  const categories = keyList(s.categories);
  const products = textList(s.productIds);
  // Fail closed: a scope we cannot read must never authorise a purchase.
  if (s.malformed) return false;
  if (!brands.length && !categories.length && !products.length) return true;
  if (!lineItem || typeof lineItem !== "object") return false;

  if (products.length) {
    const productId = String(lineItem.productId == null ? "" : lineItem.productId).trim();
    if (!products.includes(productId)) return false;
  }
  if (brands.length && !brands.includes(fold(lineItem.brand))) return false;
  if (categories.length && !categories.includes(fold(lineItem.category))) return false;
  return true;
}

/** Integer paise a single line item is worth (unitPrice × quantity). */
export function linePaise(lineItem) {
  const item = lineItem && typeof lineItem === "object" ? lineItem : {};
  const price = Number(item.unitPrice);
  const quantity = Number(item.quantity);
  const unit = Number.isFinite(price) ? price : 0;
  const count = Number.isFinite(quantity) ? quantity : 0;
  return toPaise(unit * count);
}

/**
 * Paise-safe subtotal of the line items the scope permits. Each line is
 * rounded to whole paise before it joins the total, so a basket can never
 * carry a fraction of a paisa into an order total.
 * An absent or empty line item list is worth 0.
 */
export function eligibleTotal(scope, lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  let paise = 0;
  for (const item of items) {
    if (!isEligible(scope, item)) continue;
    paise += linePaise(item);
  }
  return round2(paise / 100);
}