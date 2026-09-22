import pool from "./lib/db.js";

// Exactly mirrors the store products route at runtime (byte-verified on disk):
// PRODUCT_COLUMNS lists p.price/discount_price/stock/images/featured/categories/brands
// and the query filters WHERE p.status = 'ACTIVE' only (ACTIVE-only storefront).
const PRODUCT_COLUMNS = `
  p.uuid, p.name, p.slug, p.sku, p.short_description, p.price,
  p.discount_price, p.stock, p.images, p.featured,
  p.status,
  c.name AS category_name, c.slug AS category_slug,
  b.name AS brand_name
`;

const page = 1;
const limit = 12;
const offset = (page - 1) * limit1;
const params = [];
const where = ["p.status = 'ACTIVE'"];
const whereSql = `WHERE ${where.join(" AND ")}`;

try {
  const count = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSql}`,
    params
  );

  const result = await pool.query(
    `SELECT DISTINCT ${PRODUCT_COLUMNS}
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     ${whereSql}
     ORDER BY p.featured DESC, p.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  console.log(
    "STORE_QUERY_OK count=" +
      count.rows[0]?.count +
      " rows=" +
      result.rows.length
  );
} catch (e) {
  console.log(
    "REAL_500_CAUSE: " +
      (e.message || String(e)).split("\n")[0]
  );
  if (e.position) console.log("  sql position:", e.position);
  if (e.detail) console.log("  detail:", (e.detail || "").split("\n")[0]);
} finally {
  await pool.end();
}
