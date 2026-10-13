import pool from "./db.js";

// Why a product can no longer be changed freely.
//
// Once a product appears in a real order, a store's stock, a purchase invoice or
// any stock movement, editing or removing it rewrites history that other tables
// already point at. Rather than scatter a rule across routes, every write path
// asks this one place.
//
// The rule is deliberately about REFERENTIAL USE, not about having stock: a
// product that has simply sold out is still perfectly editable. What matters is
// whether something else has already recorded it.

// ON DELETE RESTRICT on the batch table would block the delete anyway; querying
// it here lets the API explain which usage is in the way instead of surfacing a
// constraint error.
const SOURCES = [
  { key: "orders", sql: "SELECT count(*)::int AS n FROM order_items WHERE product_id = $1", label: "customer order" },
  { key: "branchStock", sql: "SELECT count(*)::int AS n FROM branch_products WHERE productid = $1", label: "store listing" },
  { key: "purchaseInvoices", sql: "SELECT count(*)::int AS n FROM purchase_invoice_items WHERE product_id = $1", label: "purchase invoice" },
  { key: "stockLedger", sql: "SELECT count(*)::int AS n FROM stock_ledger WHERE product_id = $1", label: "stock movement" },
  { key: "batches", sql: "SELECT count(*)::int AS n FROM product_batches WHERE product_id = $1", label: "batch" },
];

/**
 * Everything referencing this product, by id or uuid.
 * Returns { isUsed, reasons: [{ key, label, count }], total }.
 */
export async function productUsage(ref) {
  const found = await pool.query(
    "SELECT id FROM products WHERE id::text = $1 OR uuid::text = $1",
    [String(ref)]
  );
  const product = found.rows[0];
  if (!product) return { productId: null, isUsed: false, reasons: [], total: 0 };

  const results = await Promise.all(
    SOURCES.map(async (source) => {
      // A missing table must not take the whole check down; a product is never
      // "used" by something that cannot be counted.
      try {
        const rows = await pool.query(source.sql, [product.id]);
        return { ...source, count: rows.rows[0].n };
      } catch {
        return { ...source, count: 0 };
      }
    })
  );

  const reasons = results.filter((r) => r.count > 0).map(({ key, label, count }) => ({ key, label, count }));
  return { productId: product.id, isUsed: reasons.length > 0, reasons, total: reasons.reduce((s, r) => s + r.count, 0) };
}

/** A sentence naming what is blocking, so the message is specific not generic. */
export function usageMessage(usage) {
  const parts = usage.reasons.map((r) => `${r.count} ${r.label}${r.count === 1 ? "" : "s"}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return (
    `This product is already used in ${list}, so it cannot be changed or removed. ` +
    `Archive it instead to hide it from the catalogue while keeping its history.`
  );
}

export class ProductInUseError extends Error {
  constructor(usage) {
    // A caller may supply its own sentence (the per-variant refusals do, naming
    // one variant and one action). Otherwise build the product-level sentence.
    super(usage?.message || usageMessage(usage));
    this.code = usage?.code || "PRODUCT_IN_USE";
    this.usage = usage;
  }
}

// ── Variant-level history ───────────────────────────────────────────────────
//
// The product-level check above is too blunt for editing: a product with 30
// variants where ONE has been received would otherwise freeze all 30. So the
// per-variant rule is separate and much narrower — a variant that other records
// point at cannot be removed or renumbered, but a product that has history can
// still be edited and can still gain new variants.
//
// WHY EVERY SOURCE MATCHES ON uuid OR sku OR name
//
// The columns below are all TEXT, and they are not consistent about what they
// hold. For one real product: purchase_invoice_items.variant_uuid held the
// variant's uuid, while stock_ledger.variant_uuid and product_batches.variant_uuid
// held its SKU, under the same column name. A storefront order carries the
// variant's NAME. Matching on a single identifier would therefore report a
// received variant as untouched — the exact opposite of what this check is for.
//
// Every source is wrapped in try/catch for the same reason as above: a missing
// table must not make a variant look unused and unlock it.
// `productColumn` is not uniform: branch_products calls it productid while the
// rest call it product_id. Getting that wrong is a 500, not a silent miss.
const VARIANT_SOURCES = [
  { key: "orders", table: "order_items", productColumn: "product_id", column: "variant", label: "customer order" },
  { key: "branchStock", table: "branch_products", productColumn: "productid", column: "variantid", label: "store listing" },
  { key: "purchaseInvoices", table: "purchase_invoice_items", productColumn: "product_id", column: "variant_uuid", label: "purchase invoice" },
  { key: "stockLedger", table: "stock_ledger", productColumn: "product_id", column: "variant_uuid", label: "stock movement" },
  { key: "batches", table: "product_batches", productColumn: "product_id", column: "variant_uuid", label: "batch" },
];

/** The identifiers a variant can be referenced by, in match order. */
function variantKeys(variant) {
  return [variant?.uuid, variant?.sku, variant?.name].filter(
    (v) => typeof v === "string" && v.trim() !== ""
  );
}

/**
 * Which of this product's variants have history, and why.
 *
 * `productRef` may be the numeric id OR the uuid, resolved the same way
 * productUsage does — the write paths only ever hold the uuid, and the child
 * tables all key on the numeric product_id.
 *
 * Returns [{ uuid, sku, name, reasons: [{ key, label, count }], total }].
 * Variants with no history are simply absent from the result.
 */
export async function variantUsage(productRef, variants = []) {
  const list = Array.isArray(variants) ? variants : [];

  if (list.length === 0) {
    return [];
  }

  const found = await pool.query(
    "SELECT id FROM products WHERE id::text = $1 OR uuid::text = $1",
    [String(productRef)]
  );
  const productId = found.rows[0]?.id;

  if (!productId) {
    return [];
  }

  const findings = await Promise.all(
    list.map(async (variant) => {
      const keys = variantKeys(variant);

      if (keys.length === 0) {
        return null;
      }

      const reasons = [];

      for (const source of VARIANT_SOURCES) {
        // One array parameter, not a chain of ORs. An OR chain of bare
        // parameters made node-postgres infer the 2nd+ placeholders as boolean
        // and the query failed, so every variant came back looking unused — the
        // exact opposite of what this check is for. `= ANY($2::text[])` also
        // drops out cleanly when a variant carries fewer identifiers, instead of
        // needing a NULL-safe expression per identifier.
        const sql =
          `SELECT count(*)::int AS n FROM ${source.table} ` +
          `WHERE ${source.productColumn} = $1 AND ${source.column} = ANY($2::text[])`;

        try {
          const rows = await pool.query(sql, [productId, keys]);
          const count = rows.rows[0]?.n ?? 0;

          if (count > 0) {
            reasons.push({ key: source.key, label: source.label, count });
          }
        } catch {
          // Table missing or renamed — never let that read as "unused".
        }
      }

      if (reasons.length === 0) {
        return null;
      }

      return {
        uuid: variant.uuid ?? null,
        sku: variant.sku ?? null,
        name: variant.name ?? variant.sku ?? variant.uuid ?? null,
        reasons,
        total: reasons.reduce((sum, r) => sum + r.count, 0),
      };
    })
  );

  return findings.filter(Boolean);
}

/** A sentence naming one variant and what is blocking it. */
export function variantUsageMessage(finding, action) {
  const parts = finding.reasons.map(
    (r) => `${r.count} ${r.label}${r.count === 1 ? "" : "s"}`
  );
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
      : parts[0];
  const what = finding.name || finding.sku || "this variant";

  return `Cannot ${action} "${what}" — it is already used in ${list}. ` +
    `Variants with history can be kept and added to, but not removed or renumbered.`;
}
