import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Customer } from "@/lib/models/customer";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, CUSTOMER_STATUSES } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.CUSTOMERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: customers, pagination } = await Customer.list({
      search,
      status,
      page,
      limit,
    });

    return Response.json(
      { success: true, customers, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List customers error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.CUSTOMERS_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, email, mobile, address, status } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        { success: false, message: "Name is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return Response.json(
        { success: false, message: "A valid email is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const existing = await Customer.findByEmail(email);

    if (existing) {
      return Response.json(
        { success: false, message: "A customer with this email already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }

    const customer = await Customer.create({
      name,
      email,
      mobile,
      address: address && typeof address === "object" ? address : {},
      status: status && CUSTOMER_STATUSES.includes(status) ? status : "ACTIVE",
    });

    return Response.json(
      { success: true, message: "Customer created successfully", customer },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create customer error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}