import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { buildInvoicePdf } from "@/lib/invoice";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// GET /api/store/orders/track/invoice?order_number=...&email=...
// Customer-facing bill download. Requires BOTH order number and the email
// used at checkout so nobody can enumerate other customers' invoices.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url, "http://localhost:3000");
    const orderNumber = (searchParams.get("order_number") || "").trim().toUpperCase();
    const email = (searchParams.get("email") || "").trim().toLowerCase();

    if (!orderNumber || !email) {
      return Response.json(
        { success: false, message: "Order number and email are required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const orderResult = await pool.query(
      `SELECT o.id, o.uuid, o.order_number, o.customer_name, o.customer_email,
              o.customer_mobile, o.shipping_address, o.subtotal, o.discount,
              o.total, o.payment_method, o.payment_status, o.status,
              o.estimated_delivery_at, o.created_at,
              b.name AS branch_name
       FROM orders o
       LEFT JOIN branches b ON b.id = o.branchid
       WHERE o.order_number = $1 AND LOWER(o.customer_email) = $2`,
      [orderNumber, email]
    );

    if (orderResult.rows.length === 0) {
      return Response.json(
        { success: false, message: "No order matches that order number and email" },
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
    console.error("Customer invoice error:", error);
    return Response.json(
      { success: false, message: "Failed to generate invoice" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
