import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// The shopper's own order history. Scoped to the logged-in account's email —
// the same key checkout stamps onto customer_email — so one shopper can
// never list another's orders. Plain authenticate(): shoppers hold no
// branch roles, so requireBranchAccess would 401 them.
export async function GET(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url, process.env.APP_URL || "http://localhost:3000");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const offset = (page - 1) * limit;
    const email = (auth.user.email || "").toLowerCase().trim();

    if (!email) {
      return Response.json(
        { success: false, message: "Account email is missing." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM orders o WHERE LOWER(o.customer_email) = $1`,
      [email]
    );
    const total = countResult.rows[0]?.count || 0;

    const result = await pool.query(
      `SELECT o.uuid, o.order_number, o.customer_name, o.customer_email,
              o.total, o.payment_method, o.payment_status, o.status,
              o.created_at, o.estimated_delivery_at AS "estimatedDeliveryAt",
              b.name AS "storeName",
              (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS "itemCount"
       FROM orders o
       LEFT JOIN branches b ON b.id = o.branchid
       WHERE LOWER(o.customer_email) = $1
       ORDER BY o.created_at DESC
       LIMIT $2 OFFSET $3`,
      [email, limit, offset]
    );

    return Response.json(
      {
        success: true,
        orders: result.rows.map((r) => ({ ...r, total: Number(r.total) || 0 })),
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store my-orders error:", error);
    return Response.json(
      { success: false, message: "Could not load your orders." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
