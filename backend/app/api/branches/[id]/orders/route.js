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

    const body = await request.json();
    const { status: newStatus } = body;

    if (!newStatus) {
      return Response.json({ success: false, message: "status is required" }, { status: 400, headers: corsHeaders() });
    }

    const result = await Order.update(id, { status: newStatus });
    if (!result) {
      return Response.json({ success: false, message: "Order not found" }, { status: 404, headers: corsHeaders() });
    }

    return Response.json({ success: true, message: `Order moved to ${newStatus}`, order: result }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch order update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
