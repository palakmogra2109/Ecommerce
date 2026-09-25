import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { ORDER_STATUSES, ORDER_FLOW } from "@shared/constants";

export const runtime = "nodejs";

export const OPTIONS = () =>
  new Response(null, { status: 204, headers: corsHeaders() });

export function statusesForView(currentStatus) {
  if (!ORDER_FLOW.includes(currentStatus)) return [currentStatus];
  return ORDER_FLOW;
}

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

    const result = await pool.query(
      `
      SELECT o.id, o.uuid, o.order_number, o.customer_name, o.customer_email,
             o.customer_mobile, o.shipping_address, o.subtotal, o.discount,
             o.total, o.coupon_code, o.payment_method, o.payment_status, o.status,
             o.estimated_delivery_at, o.created_at, o.updated_at,
             b.name AS store_name
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branchid
      WHERE o.order_number = $1 AND LOWER(o.customer_email) = $2
      ORDER BY o.created_at DESC
      `,
      [orderNumber, email]
    );

    const order = result.rows[0] || null;

    if (!order) {
      return Response.json(
        { success: false, message: "No order matches that order number and email" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const itemsResult = await pool.query(
      `
      SELECT oi.product_uuid, oi.product_name, oi.sku, oi.variant, oi.price,
             oi.quantity, oi.subtotal
      FROM order_items oi
      WHERE oi.order_id = $1
      ORDER BY oi.id ASC
      `,
      [order.id]
    );

    // Full status audit trail: WHEN the order entered each status.
    const history = await pool.query(
      `SELECT status, note, changed_by AS "changedBy", created_at AS "createdAt"
       FROM order_status_history
       WHERE order_id = $1
       ORDER BY created_at ASC, id ASC`,
      [order.id]
    );

    // The most recent status timestamp in the forward flow (or the cancel
    // entry) drives the "last updated" chip in the tracking UI.
    const lastEvent = history.rows[history.rows.length - 1] || null;

    return Response.json(
      {
        success: true,
        order: {
          ...order,
          subtotal: Number(order.subtotal) || 0,
          discount: Number(order.discount) || 0,
          total: Number(order.total) || 0,
          estimatedDeliveryAt: order.estimated_delivery_at,
          storeName: order.store_name || null,
          items: itemsResult.rows.map((it) => ({
            ...it,
            price: Number(it.price) || 0,
            subtotal: Number(it.subtotal) || 0,
          })),
        },
        statusHistory: history.rows,
        lastStatusAt: lastEvent?.createdAt || null,
        timeline: statusesForView(order.status),
        trackable: ["PLACED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY"].includes(order.status),
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store tracking error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
