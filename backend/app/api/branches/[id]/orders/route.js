import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { Branch } from "@/lib/models/branch";
import { Order } from "@/lib/models/order";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCH_ORDERS_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const branch = await Branch.findByUuid(id);
    if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });

    const { search = "", status = "", page = 1, limit = 20 } = Object.fromEntries(new URL(request.url).searchParams);
    const result = await Order.list({ search, status, branchId: id, page, limit });
    return Response.json({ success: true, orders: result.rows, pagination: result.pagination }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch orders error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCH_ORDERS_UPDATE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const branch = await Branch.findByUuid(id);
    if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });

    const body = await request.json();
    const { status: newStatus, orderNumber, orderUuid } = body;

    if (!newStatus) {
      return Response.json({ success: false, message: "status is required" }, { status: 400, headers: corsHeaders() });
    }

    // The path segment is the *branch* uuid, so it can never identify the order.
    // Take the order from the body instead - by order_number, or by the order
    // uuid the order list hands the client, and updateByNumber then re-checks
    // that the order really belongs to this branch.
    let targetNumber = orderNumber;
    if (!targetNumber && orderUuid) {
      const order = await pool.query("SELECT order_number FROM orders WHERE uuid = $1", [orderUuid]);
      if (order.rows.length === 0) {
        return Response.json({ success: false, message: "Order not found" }, { status: 404, headers: corsHeaders() });
      }
      targetNumber = order.rows[0].order_number;
    }

    if (!targetNumber) {
      return Response.json({ success: false, message: "orderNumber or orderUuid is required" }, { status: 400, headers: corsHeaders() });
    }

    const result = await Order.updateByNumber(targetNumber, { status: newStatus, branchId: branch.id });
    if (!result) {
      return Response.json({ success: false, message: "Order not found" }, { status: 404, headers: corsHeaders() });
    }

    return Response.json({ success: true, message: `Order moved to ${newStatus}`, order: result }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch order update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
