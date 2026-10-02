// The WRITE side of lib/giftCardApplicability.js.
//
// giftCardApplicability is deliberately pure — it decides what a scope permits and
// never touches the database. This module is the other half: it turns what an
// admin typed into rows gift_card_applicability can hold, and refuses anything it
// cannot verify. It exists as a lib module rather than inline in the templates
// route for one reason: the route imports next/headers, so plain Node — which is
// what the test suite is — cannot load it, and this is the part worth testing.
//
// THE DIALECT IS THE WHOLE POINT. A stored `Nila Organics`, a stored `spices` and
// a stored product uuid are not labels: they are the exact values the spend path
// asks about. A wallet line item is built in app/api/orders/store/route.js as
// `{ brand: line.brand_name, category: line.category_slug, productId: line.product_uuid }`,
// and normalizeScope matches brands and categories case-insensitively while
// comparing product ids as trimmed strings. So:
//
//   * BRAND    is matched against brands.name — the column, not the slug, because
//              that is what a product line item carries.
//   * CATEGORY is matched against categories.slug — the slug, not the name.
//   * PRODUCT  is matched against products.uuid.
//
// Getting any of those wrong does not error at checkout. It makes a restricted
// card's money match nothing, so the customer pays for a gift card that cannot buy
// the thing it was scoped for and nothing says why.
//
// Every value is therefore VERIFIED against the table it names and then stored in
// that table's own spelling. A typo fails at creation, where somebody is looking,
// rather than silently at spend time, where nobody is.
import { normalizeScope, scopeSummary } from "./giftCardApplicability.js";

const APPLICABILITY_TABLE = "gift_card_applicability";

export const SCOPE_KINDS = Object.freeze(["BRAND", "CATEGORY", "PRODUCT"]);

// How each kind is named in a message about it.
export const KIND_LABEL = Object.freeze({
  BRAND: "brand",
  CATEGORY: "category",
  PRODUCT: "product",
});

// The same uuid shape lib/uuid.js recognises, inlined so this module stays
// importable by plain Node (lib/uuid.js builds Responses and imports cors
// extensionlessly).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Folds either scope shape into [{kind, value}], deduplicated and trimmed.
 *
 * The two shapes are the row form the database stores and the
 * {brands, categories, productIds} form an admin form posts, and both are folded
 * by the same normalizeScope the claim and the spend path use — so this module
 * cannot introduce a third dialect of its own. An unreadable scope is REFUSED
 * rather than written, which is normalizeScope's own fail-closed rule arriving
 * here: a restriction nobody can interpret must not be stored as though it were
 * no restriction at all.
 *
 * Deduplicated because the table carries UNIQUE (template_id, kind, value): an
 * admin form that lists the same brand twice should save once, not fail.
 */
export function scopeRowsFrom(raw) {
  if (raw == null) return { rows: [], error: null };
  if (!Array.isArray(raw) && typeof raw !== "object") {
    return { rows: null, error: "Spend restrictions must be a list or an object." };
  }

  const scope = normalizeScope(raw);
  if (scope.malformed) {
    return {
      rows: null,
      error: "Spend restrictions could not be read. Use {kind, value} rows, or brands/categories/productIds.",
    };
  }

  const rows = [];
  for (const [key, kind] of [
    ["brands", "BRAND"],
    ["categories", "CATEGORY"],
    ["productIds", "PRODUCT"],
  ]) {
    for (const value of scope[key]) rows.push({ kind, value: String(value).trim() });
  }

  // Keyed on the lowercased value, because a case-different duplicate is still a
  // duplicate as far as the spend path is concerned — and would otherwise be a
  // duplicate INSERT violation instead of a save.
  const seen = new Set();
  return {
    rows: rows.filter((row) => {
      const key = `${row.kind}:${row.value.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    error: null,
  };
}

/**
 * Resolves one (kind, value) against the table it names, returning the value AS
 * THAT TABLE STORES IT.
 *
 * Two reasons this is a lookup and not a format check: it catches a typo before
 * the row exists, and it stores the catalogue's spelling rather than the one that
 * was typed, so a restriction cannot quietly stop matching because somebody
 * entered "NILA ORGANICS".
 *
 * The three queries are written out rather than assembled from a table of column
 * names: they do not share a shape (a uuid is compared as uuid, a name
 * case-insensitively), and a generated query string is harder to read here than
 * three honest ones.
 */
export async function resolveScopeValue(client, kind, value) {
  if (!KIND_LABEL[kind]) return { ok: false, reason: "unknown_kind" };
  // A value that is not uuid-shaped cannot match a product however it is spelled,
  // so it is refused here rather than handed to Postgres as a string it will not
  // cast.
  if (kind === "PRODUCT" && !UUID_RE.test(String(value))) return { ok: false, reason: "not_found" };

  const lookup = {
    BRAND: `SELECT name AS value FROM brands WHERE lower(name) = lower($1) LIMIT 1`,
    CATEGORY: `SELECT slug AS value FROM categories WHERE lower(slug) = lower($1) LIMIT 1`,
    PRODUCT: `SELECT uuid::text AS value FROM products WHERE uuid = $1::uuid LIMIT 1`,
  }[kind];

  const result = await client.query(lookup, [value]);
  const row = result.rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  return { ok: true, value: String(row.value) };
}

/**
 * Resolves a whole scope against the database.
 *
 * Returns { resolved, error }. `error` names the first row that could not be
 * verified — { kind, value, reason } — so the caller can refuse the create with a
 * message that says WHICH value was wrong. Nothing is written by this function;
 * it must run inside the caller's transaction so the check and the insert cannot
 * be separated by a rename.
 */
export async function resolveScopeRows(client, rows) {
  const resolved = [];
  for (const row of rows || []) {
    const found = await resolveScopeValue(client, row.kind, row.value);
    if (!found.ok) return { resolved: null, error: { kind: row.kind, value: row.value, reason: found.reason } };
    resolved.push({ kind: row.kind, value: found.value });
  }
  return { resolved, error: null };
}

/** Writes the resolved rows for one template. In the caller's transaction. */
export async function writeScopeRows(client, templateId, rows) {
  for (const row of rows || []) {
    await client.query(
      `INSERT INTO ${APPLICABILITY_TABLE} (template_id, kind, value) VALUES ($1, $2, $3)`,
      [Number(templateId), row.kind, row.value]
    );
  }
  return (rows || []).length;
}

/** A one-line description of a stored scope, for an admin confirmation. */
export function describeScope(rows) {
  return scopeSummary(rows || []);
}