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
    const status = searchParams.get("status") || "";

    const branchUuid = request.headers.get("x-branch-id") || searchParams.get("branchId") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const params = [];
    const conditions = ["o.branchid = $1"];
    params.push(access.branchId);

    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(o.order_number ILIKE $${params.length} OR o.customer_name ILIKE $${params.length})`);
    }

    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM orders o WHERE ${conditions.join(" AND ")}`,
      params
    );

    const result = await pool.query(`
      SELECT o.uuid, o.order_number, o.customer_name, o.customer_email, o.customer_mobile,
             o.shipping_address, o.subtotal, o.total, o.payment_method, o.payment_status,
             o.status, o.created_at, o.updated_at,
             (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      WHERE ${conditions.join(" AND ")}
      ORDER BY o.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    return Response.json({
      success: true,
      orders: result.rows.map((r) => ({
        ...r,
        total: Number(r.total) || 0,
        subtotal: Number(r.subtotal) || 0,
        itemCount: parseInt(r.item_count, 10) || 0,
      })),
      pagination: { page, limit, total: countResult.rows[0].count, pages: Math.max(1, Math.ceil(countResult.rows[0].count / limit)) },
    }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Store orders error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
