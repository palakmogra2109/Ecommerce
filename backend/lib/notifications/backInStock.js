import pool from "../db.js";
import NotificationService from "../notifications.js";

// "Notify me when it's back" — the only module-specific piece.
//
// It registers an interest, and when stock returns it asks the ONE
// NotificationService to tell everyone who asked. No template text, no recipient
// lookup and no delivery logic lives here.
//
// Out of stock is derived from stock <= 0, because the products table has no
// OUT_OF_STOCK status: a product is ACTIVE with a stock figure, and the existing
// storefront already treats stock === 0 as out of stock.

export function isOutOfStock(product) {
  return Number(product.stock) <= 0;
}

export async function registerInterest({ productUuid, email, name = null }) {
  const address = String(email || "").trim().toLowerCase();
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    const error = new Error("Enter a valid email address");
    error.code = "INVALID_EMAIL";
    throw error;
  }

  const product = await pool.query(
    "SELECT id, uuid, name, stock FROM products WHERE uuid = $1",
    [productUuid]
  );
  if (!product.rows[0]) {
    const error = new Error("Product not found");
    error.code = "NOT_FOUND";
    throw error;
  }

  const customer = await pool.query(
    "SELECT id FROM customers WHERE lower(email) = $1", [address]
  );

  // ON CONFLICT on (product_id, email) so asking twice updates the row rather
  // than creating a second subscription.
  const saved = await pool.query(
    `INSERT INTO product_stock_notifications (product_id, customer_id, email, name)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (product_id, email) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, product_stock_notifications.name),
           is_active = TRUE,
           updated_at = now()
     RETURNING id, product_id, customer_id, email, requested_at, notified_at`,
    [product.rows[0].id, customer.rows[0]?.id ?? null, address, name]
  );

  return {
    registered: true,
    product: {
      uuid: product.rows[0].uuid,
      name: product.rows[0].name,
      outOfStock: isOutOfStock(product.rows[0]),
    },
    interest: saved.rows[0],
  };
}

export async function isRegistered({ productUuid, email }) {
  const address = String(email || "").trim().toLowerCase();
  const result = await pool.query(
    `SELECT 1 FROM product_stock_notifications s
       JOIN products p ON p.id = s.product_id
      WHERE p.uuid = $1 AND s.email = $2 AND s.is_active AND s.notified_at IS NULL`,
    [productUuid, address]
  );
  return result.rows.length > 0;
}

/**
 * Fires PRODUCT_BACK_IN_STOCK for everyone waiting on this product.
 *
 * Call this after a receipt has raised stock above zero. Returns immediately if
 * nobody is waiting, and never throws: a failed notification must not undo the
 * receipt that triggered it.
 */
export async function notifyBackInStock({ productUuid, client = null }) {
  const db = client || pool;
  const product = await db.query(
    // stock_receipts has no product_id column, so the warehouse is named via
    // its own product->warehouse path rather than through a receipt lookup.
    `SELECT p.id, p.uuid, p.name, p.sku, p.stock, p.price,
            COALESCE(w.name, 'Central Warehouse') AS branch_name
       FROM products p
       LEFT JOIN LATERAL (
              SELECT w2.name FROM stock_ledger sl
                JOIN warehouses w2 ON w2.id = sl.warehouse_id
               WHERE sl.product_id = p.id AND sl.warehouse_id IS NOT NULL
               ORDER BY sl.id DESC LIMIT 1
            ) w ON TRUE
      WHERE p.uuid = $1`,
    [productUuid]
  );
  if (!product.rows[0]) return { ok: false, reason: "NOT_FOUND" };
  const item = product.rows[0];

  // The trigger is the arrival of stock, so it fires only once the product is
  // AVAILABLE. (This was inverted at first: it skipped while stock was on the
  // shelf, which is precisely the case people are waiting for.)
  if (isOutOfStock(item)) {
    return { ok: true, reason: "OUT_OF_STOCK", notified: 0 };
  }

  // Everyone still waiting. notified_at IS NULL keeps this a one-shot per
  // subscription, so a later restock notifies only new interest.
  const waiting = await db.query(
    `SELECT email FROM product_stock_notifications
      WHERE product_id = $1 AND is_active AND notified_at IS NULL`,
    [item.id]
  );
  if (!waiting.rows.length) return { ok: true, reason: "NO_INTEREST", notified: 0 };

  const result = await NotificationService.send({
    event: "PRODUCT_BACK_IN_STOCK",
    recipients: waiting.rows.map((row) => ({ type: "EMAIL", id: row.email })),
    data: {
      product_name: item.name,
      product_uuid: item.uuid,
      sku: item.sku,
      branch_name: item.branch_name,
      price: item.price,
    },
    entityType: "product",
    entityId: String(item.id),
    // Keyed on the subscription row rather than the event, so each shopper is
    // notified once per restock.
    dedupeKey: `back_in_stock:${item.id}:${waiting.rows.map((r) => r.email).sort().join(",")}`,
  });

  await db.query(
    `UPDATE product_stock_notifications SET notified_at = now(), is_active = FALSE, updated_at = now()
      WHERE product_id = $1 AND notified_at IS NULL`,
    [item.id]
  );

  return { ok: result.ok, notified: result.created, reason: "SENT" };
}

/** Products a shopper asked about that are still out of stock. */
export async function listInterest({ email, limit = 50 }) {
  const address = String(email || "").trim().toLowerCase();
  const result = await pool.query(
    `SELECT p.uuid, p.name, p.sku, p.stock, p.price, s.requested_at
       FROM product_stock_notifications s
       JOIN products p ON p.id = s.product_id
      WHERE s.email = $1 AND s.is_active AND s.notified_at IS NULL
      ORDER BY s.requested_at DESC LIMIT $2`,
    [address, Math.min(200, Math.max(1, limit))]
  );
  return result.rows;
}