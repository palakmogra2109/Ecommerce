import { corsHeaders } from "@/lib/cors";
import { Coupon } from "@/lib/models/coupon";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, COUPON_TYPES, COUPON_STATUSES } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.COUPONS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const coupon = await Coupon.findByUuid(id);

    if (!coupon) {
      return Response.json(
        { success: false, message: "Coupon not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, coupon },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get coupon error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.COUPONS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    const coupon = await Coupon.update(id, {
      code: body.code,
      type: body.type,
      value: body.value,
      minOrderAmount: body.minOrderAmount,
      maxDiscountAmount: body.maxDiscountAmount,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      usageLimit: body.usageLimit,
      perCustomerLimit: body.perCustomerLimit,
      description: body.description,
      status: body.status,
    });

    if (!coupon) {
      return Response.json(
        { success: false, message: "Coupon not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Coupon updated successfully", coupon },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update coupon error:", error);

    if (String(error?.code) === "23505") {
      return Response.json(
        { success: false, message: "This coupon code already exists" },
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
    const auth = await authorize(KEY_PERMISSIONS.COUPONS_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const coupon = await Coupon.findByUuid(id);

    if (!coupon) {
      return Response.json(
        { success: false, message: "Coupon not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    await Coupon.remove(id);

    return Response.json(
      { success: true, message: "Coupon deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete coupon error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}