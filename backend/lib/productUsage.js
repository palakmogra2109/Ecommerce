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
    super(usageMessage(usage));
    this.code = "PRODUCT_IN_USE";
    this.usage = usage;
  }
}