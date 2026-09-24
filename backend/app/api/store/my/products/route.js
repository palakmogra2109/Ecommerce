import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { requireBranchAccess } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url, process.env.APP_URL || "http://localhost:3000");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const search = (searchParams.get("search") || "").trim();

    const branchUuid = searchParams.get("branchId") || request.headers.get("x-branch-id") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const params = [];
    let conditions = ["bp.branchid = $1"];
    params.push(access.branchId);

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }

    const offset = (page - 1) * limit;

    const result = await pool.query(`
      SELECT bp.uuid AS branchProductUuid, bp.sellingprice, bp.compareatprice, bp.stockquantity,
             bp.isavailable, bp.lowstockthreshold,
             p.uuid AS productUuid, p.name, p.slug, p.sku, p.price, p.discount_price,
             p.images, p.stock AS globalStock, p.inventory_mode,
             p.variants,
             c.name AS category_name
      FROM branch_products bp
      JOIN products p ON p.id = bp.productid
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.name ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    const countResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM branch_products bp
      JOIN products p ON p.id = bp.productid
      WHERE ${conditions.join(" AND ")}
    `, params);

    const rows = result.rows.map((r) => ({
      ...r,
      sellingPrice: Number(r.sellingprice) || 0,
      compareAtPrice: r.compareatprice ? Number(r.compareatprice) : null,
      stockQuantity: Number(r.stockquantity) || 0,
      isAvailable: r.isavailable,
      lowStockThreshold: Number(r.lowstockthreshold) || 5,
      variants: Array.isArray(r.variants) ? r.variants.map((v) => ({
        ...v,
        price: Number(v.price) || 0,
        stock: Number(v.stock) || 0,
        discount_price: v.discount_price ?? v.discountPrice ?? null,
        discountPrice: v.discountPrice ?? v.discount_price ?? null,
      })) : [],
      productDiscount: r.discount_price ?? r.discountPrice ?? null,
    }));

    return Response.json({
      success: true,
      products: rows,
      pagination: { page, limit, total: countResult.rows[0].count, pages: Math.max(1, Math.ceil(countResult.rows[0].count / limit)) },
    }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Store my products error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
