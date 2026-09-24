import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { requireBranchAccess } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const branchUuid = request.headers.get("x-branch-id") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;
    const branchId = access.branchId;

    const branchResult = await pool.query(
      `SELECT uuid, name, code, city, address, phone, status, createdat AS created_at, updatedat AS updated_at FROM branches WHERE id = $1`,
      [branchId]
    );
    if (branchResult.rows.length === 0) {
      return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });
    }
    const branch = branchResult.rows[0];

    const ordersResult = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0) AS revenue,
              COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
              COUNT(*) FILTER (WHERE status = 'CONFIRMED') AS confirmed,
              COUNT(*) FILTER (WHERE status IN ('PROCESSING','PACKED','SHIPPED','OUT_FOR_DELIVERY')) AS processing,
              COUNT(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
              COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
               FROM orders WHERE branchid = $1`,
      [branchId]
    );
    const stats = ordersResult.rows[0];

    const lowStockResult = await pool.query(
      `SELECT bp.uuid, p.name, p.sku, bp.stockquantity, bp.lowstockthreshold, p.images
        FROM branch_products bp
        JOIN products p ON p.id = bp.productid
        WHERE bp.branchid = $1
         AND bp.stockquantity <= bp.lowstockthreshold
       ORDER BY bp.stockquantity ASC
       LIMIT 10`,
      [branchId]
    );

    return Response.json({
      success: true,
      branch: { ...branch, totalOrders: parseInt(stats.count, 10), revenue: Number(stats.revenue) || 0, pending: parseInt(stats.pending, 10), confirmed: parseInt(stats.confirmed, 10), processing: parseInt(stats.processing, 10), delivered: parseInt(stats.delivered, 10), cancelled: parseInt(stats.cancelled, 10) },
      lowStock: lowStockResult.rows.map((r) => ({ uuid: r.uuid, name: r.name, sku: r.sku, stockQuantity: Number(r.stockquantity), lowStockThreshold: Number(r.lowstockthreshold), images: r.images ? [r.images[0]] : [] })),
    }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Store dashboard error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
