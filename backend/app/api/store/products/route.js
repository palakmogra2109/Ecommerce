import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";

export const runtime = "nodejs";

export const OPTIONS = () =>
  new Response(null, { status: 204, headers: corsHeaders() });

const PRODUCT_COLUMNS = `
  p.uuid, p.name, p.slug, p.sku, p.short_description, p.price,
  p.discount_price, p.stock, p.images, p.featured,
  c.name AS category_name, c.slug AS category_slug,
  b.name AS brand_name
`;

// Public storefront catalog: only ACTIVE products, never exposes admin
// cost columns, and always applies any active discount price.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url,
      process.env.APP_URL || "http://localhost:3000");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(24, Math.max(1, parseInt(searchParams.get("limit") || "12", 10)));
    const search = (searchParams.get("search") || "").trim();
    const category = (searchParams.get("category") || "").trim();

    const where = ["p.status = 'ACTIVE'"];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.name ILIKE $${params.length} OR p.short_description ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }

    if (category) {
      params.push(`%${category}%`);
      where.push(`(c.slug ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }

    const offset = (page - 1) * limit;
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const count = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${whereSql}`,
      params
    );

    const result = await pool.query(
      `SELECT ${PRODUCT_COLUMNS}
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        ${whereSql}
        ORDER BY p.featured DESC, p.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return Response.json(
      {
        success: true,
        products: result.rows.map((p) => ({
          ...p,
          price: Number(p.price) || 0,
          discount_price: p.discount_price !== null ? Number(p.discount_price) : null,
          stock: Number(p.stock) || 0,
          images: p.images || [],
        })),
        pagination: {
          page,
          limit,
          total: count.rows[0]?.count || 0,
          pages: Math.max(1, Math.ceil((count.rows[0]?.count || 0) / limit)),
        },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store products error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
