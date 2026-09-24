import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { requireBranchAccess } from "@/lib/authorization";
import { ORDER_FLOW } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const { uuid } = await params;
    const branchUuid = request.headers.get("x-branch-id") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const orderResult = await pool.query(
      `SELECT o.id, o.uuid, o.order_number, o.customer_name, o.customer_email, o.customer_mobile,
              o.shipping_address, o.subtotal, o.discount, o.total, o.payment_method,
              o.payment_status, o.status, o.created_at, o.updated_at
       FROM orders o
       WHERE o.uuid = $1 AND o.branchid = $2`,
      [uuid, access.branchId]
    );

    if (orderResult.rows.length === 0) {
      return Response.json({ success: false, message: "Order not found for this store" }, { status: 404, headers: corsHeaders() });
    }

    const order = orderResult.rows[0];

    const itemsResult = await pool.query(
      `SELECT uuid, product_name, sku, variant, price, quantity, subtotal
       FROM order_items WHERE order_id = $1
       ORDER BY id ASC`,
      [order.id]
    );

    return Response.json({
      success: true,
      order: {
        uuid: order.uuid,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        customerMobile: order.customer_mobile,
        shippingAddress: order.shipping_address,
        subtotal: Number(order.subtotal) || 0,
        discount: Number(order.discount) || 0,
        total: Number(order.total) || 0,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        status: order.status,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        items: itemsResult.rows.map((i) => ({
          uuid: i.uuid,
          productName: i.product_name,
          sku: i.sku,
          variant: i.variant,
          price: Number(i.price) || 0,
          quantity: i.quantity,
          subtotal: Number(i.subtotal) || 0,
        })),
      },
    }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Store order detail error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { uuid } = await params;
    const body = await request.json();
    const { status: newStatus } = body;

    const branchUuid = body.branchId || request.headers.get("x-branch-id") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    if (!newStatus) {
      return Response.json({ success: false, message: "status is required" }, { status: 400, headers: corsHeaders() });
    }

    const orderResult = await pool.query(
      `SELECT o.uuid, o.status, o.branchid FROM orders o WHERE o.uuid = $1 AND o.branchid = $2`,
      [uuid, access.branchId]
    );

    if (orderResult.rows.length === 0) {
      return Response.json({ success: false, message: "Order not found for this branch" }, { status: 404, headers: corsHeaders() });
    }

    const order = orderResult.rows[0];
    const currentIndex = ORDER_FLOW.indexOf(order.status);
    const newIndex = ORDER_FLOW.indexOf(newStatus);

    if (newIndex === -1) {
      return Response.json({ success: false, message: `Invalid status: ${newStatus}` }, { status: 400, headers: corsHeaders() });
    }
    if (newIndex <= currentIndex && order.status !== newStatus) {
      return Response.json({ success: false, message: `Cannot move from ${order.status} to ${newStatus}` }, { status: 400, headers: corsHeaders() });
    }

    const result = await pool.query(
      `UPDATE orders SET status = $1, updated_at = now() WHERE uuid = $2 RETURNING uuid, status, order_number, customer_name, total, created_at, updated_at`,
      [newStatus, uuid]
    );

    if (result.rows.length === 0) {
      return Response.json({ success: false, message: "Failed to update order" }, { status: 500, headers: corsHeaders() });
    }

    const row = result.rows[0];
    return Response.json({
      success: true,
      message: `Order moved to ${newStatus}`,
      order: { uuid: row.uuid, status: row.status, orderNumber: row.order_number, customerName: row.customer_name, total: Number(row.total), createdAt: row.created_at, updatedAt: row.updated_at },
    }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Store order update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
