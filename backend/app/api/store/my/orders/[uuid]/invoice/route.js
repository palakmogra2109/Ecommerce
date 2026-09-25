import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { requireBranchAccess } from "@/lib/authorization";
import { buildInvoicePdf } from "@/lib/invoice";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// GET /api/store/my/orders/:uuid/invoice — store downloads the bill PDF
// for an order belonging to its own branch.
export async function GET(request, { params }) {
  try {
    const { uuid } = await params;
    const branchUuid =
      request.headers.get("x-branch-id") ||
      new URL(request.url, "http://localhost:3000").searchParams.get("branchId") ||
      "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const orderResult = await pool.query(
      `SELECT o.id, o.uuid, o.order_number, o.customer_name, o.customer_email,
              o.customer_mobile, o.shipping_address, o.subtotal, o.discount,
              o.total, o.payment_method, o.payment_status, o.status,
              o.estimated_delivery_at, o.created_at,
              b.name AS branch_name
       FROM orders o
       LEFT JOIN branches b ON b.id = o.branchid
       WHERE o.uuid = $1 AND o.branchid = $2`,
      [uuid, access.branchId]
    );

    if (orderResult.rows.length === 0) {
      return Response.json(
        { success: false, message: "Order not found for this store" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const orderRow = orderResult.rows[0];

    const itemsResult = await pool.query(
      `SELECT product_name, sku, variant, price, quantity, subtotal
       FROM order_items WHERE order_id = $1 ORDER BY id ASC`,
      [orderRow.id]
    );

    const pdf = await buildInvoicePdf({
      ...orderRow,
      items: itemsResult.rows,
    });

    return new Response(pdf, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${orderRow.order_number}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Store invoice error:", error);
    return Response.json(
      { success: false, message: "Failed to generate invoice" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
