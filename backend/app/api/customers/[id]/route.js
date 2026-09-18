import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { Customer } from "@/lib/models/customer";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, CUSTOMER_STATUSES } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.CUSTOMERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const internal = await Customer.getInternalByUuid(id);

    if (!internal) {
      return Response.json(
        { success: false, message: "Customer not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const customer = await Customer.findByUuid(id);

    const orderResult = await pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(total), 0)::numeric AS total_spent,
              COALESCE(SUM(total) FILTER (WHERE status NOT IN ('CANCELLED', 'REFUNDED')), 0)::numeric AS total_spent_valid,
              COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0)::int AS cancelled_count
       FROM orders
       WHERE customer_id = $1`,
      [internal.id]
    );

    const stats = orderResult.rows[0] || {};

    const recentOrders = await pool.query(
      `SELECT uuid, order_number, total, status, payment_status, created_at
       FROM orders
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [internal.id]
    );

    return Response.json(
      {
        success: true,
        customer: {
          ...customer,
          stats: {
            orderCount: parseInt(stats.count || "0", 10),
            totalSpent: Number(stats.total_spent || 0),
            totalSpentValid: Number(stats.total_spent_valid || 0),
            cancelledCount: parseInt(stats.cancelled_count || "0", 10),
          },
          recentOrders: recentOrders.rows,
        },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get customer error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.CUSTOMERS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    const customer = await Customer.update(id, {
      name: body.name,
      email: body.email,
      mobile: body.mobile,
      address: body.address,
      status: body.status,
    });

    if (!customer) {
      return Response.json(
        { success: false, message: "Customer not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Customer updated successfully", customer },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update customer error:", error);

    if (String(error?.code) === "23505") {
      return Response.json(
        { success: false, message: "A customer with this email already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }

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
    const auth = await authorize(KEY_PERMISSIONS.CUSTOMERS_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const customer = await Customer.findByUuid(id);

    if (!customer) {
      return Response.json(
        { success: false, message: "Customer not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    await Customer.remove(id);

    return Response.json(
      { success: true, message: "Customer deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete customer error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}