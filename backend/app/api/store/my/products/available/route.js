import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { requireBranchAccess } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// GET /api/store/my/products/available?branchId=...&search=...
// Lists the admin catalogue (ACTIVE products only) that the store has NOT
// added yet, so the store can pick one by name from a dropdown and set its
// own price + stock.
export async function GET(request) {
  try {
    const { searchParams } = new URL(
      request.url,
      process.env.APP_URL || "http://localhost:3000"
    );
    const search = (searchParams.get("search") || "").trim();
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10))
    );

    const branchUuid =
      searchParams.get("branchId") || request.headers.get("x-branch-id") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const params = [access.branchId];
    let searchClause = "";
    if (search) {
      params.push(`%${search}%`);
      searchClause = `AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`;
    }

    const result = await pool.query(
      `
      SELECT p.uuid, p.name, p.sku, p.price, p.discount_price, p.images,
             c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM branch_products bp
          WHERE bp.productid = p.id AND bp.branchid = $1
        )
        ${searchClause}
      ORDER BY p.name ASC
      LIMIT $${params.length + 1}
      `,
      [...params, limit]
    );

    return Response.json(
      {
        success: true,
        products: result.rows.map((r) => ({
          uuid: r.uuid,
          name: r.name,
          sku: r.sku,
          category: r.category_name || null,
          image: Array.isArray(r.images) ? r.images[0] || null : null,
          adminPrice: Number(r.price) || 0,
          adminDiscountPrice:
            r.discount_price != null ? Number(r.discount_price) : null,
        })),
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Available products error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
