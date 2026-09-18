import { corsHeaders } from "@/lib/cors";
import { Order } from "@/lib/models/order";
import { authorize } from "@/lib/authorization";
import {
  KEY_PERMISSIONS,
  ORDER_STATUSES,
  ORDER_FLOW,
  ORDER_STATUS,
  PAYMENT_STATUSES,
} from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// Orders a list of statuses so the active one can be highlighted in
// the status timeline.
export function statusesForView(currentStatus) {
  if (!ORDER_FLOW.includes(currentStatus)) {
    return [currentStatus];
  }

  return ORDER_FLOW;
}

export async function GET(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ORDERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const order = await Order.getDetailByUuid(id);

    if (!order) {
      return Response.json(
        { success: false, message: "Order not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      {
        success: true,
        order,
        orderFlow: statusesForView(order.status),
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get order error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ORDERS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    const current = await Order.getInternalByUuid(id);

    if (!current) {
      return Response.json(
        { success: false, message: "Order not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const updates = {};

    if (body.status !== undefined) {
      if (!ORDER_STATUSES.includes(body.status)) {
        return Response.json(
          { success: false, message: "Invalid order status" },
          { status: 400, headers: corsHeaders() }
        );
      }

      // A cancelled or refunded order is a terminal state.
      if (
        [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED].includes(current.status)
      ) {
        return Response.json(
          { success: false, message: "This order can no longer be changed" },
          { status: 400, headers: corsHeaders() }
        );
      }

      updates.status = body.status;
    }

    if (body.paymentStatus !== undefined) {
      if (!PAYMENT_STATUSES.includes(body.paymentStatus)) {
        return Response.json(
          { success: false, message: "Invalid payment status" },
          { status: 400, headers: corsHeaders() }
        );
      }

      updates.paymentStatus = body.paymentStatus;
    }

    const order = await Order.update(id, updates);

    if (!order) {
      return Response.json(
        { success: false, message: "Order not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Order updated successfully", order },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update order error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// Dedicated cancel endpoint enforcing the orders.cancel permission.
export async function POST(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ORDERS_CANCEL);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const current = await Order.getInternalByUuid(id);

    if (!current) {
      return Response.json(
        { success: false, message: "Order not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    if (
      [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED, ORDER_STATUS.DELIVERED].includes(
        current.status
      )
    ) {
      return Response.json(
        { success: false, message: "This order cannot be cancelled" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const order = await Order.update(id, { status: ORDER_STATUS.CANCELLED });

    return Response.json(
      { success: true, message: "Order cancelled successfully", order },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Cancel order error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function DELETE(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ORDERS_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const order = await Order.findByUuid(id);

    if (!order) {
      return Response.json(
        { success: false, message: "Order not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    await Order.remove(id);

    return Response.json(
      { success: true, message: "Order deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete order error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}