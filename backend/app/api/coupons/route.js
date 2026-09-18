import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Coupon } from "@/lib/models/coupon";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, COUPON_TYPES, COUPON_STATUSES } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.COUPONS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const type = searchParams.get("type") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: coupons, pagination } = await Coupon.list({
      search,
      status,
      type,
      page,
      limit,
    });

    return Response.json(
      { success: true, coupons, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List coupons error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.COUPONS_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const {
      code,
      type,
      value,
      minOrderAmount,
      maxDiscountAmount,
      startsAt,
      endsAt,
      usageLimit,
      perCustomerLimit,
      description,
      status,
    } = body;

    if (!code || typeof code !== "string" || !code.trim()) {
      return Response.json(
        { success: false, message: "Coupon code is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const couponType = COUPON_TYPES.includes(type) ? type : "PERCENTAGE";

    if (value === undefined || value === null || value === "") {
      return Response.json(
        { success: false, message: "Discount value is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const existing = await Coupon.findByCode(code);

    if (existing) {
      return Response.json(
        { success: false, message: "This coupon code already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }

    const coupon = await Coupon.create({
      code,
      type: couponType,
      value,
      minOrderAmount,
      maxDiscountAmount,
      startsAt,
      endsAt,
      usageLimit,
      perCustomerLimit,
      description,
      status: status && COUPON_STATUSES.includes(status) ? status : "ACTIVE",
    });

    return Response.json(
      { success: true, message: "Coupon created successfully", coupon },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create coupon error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}