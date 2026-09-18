import { corsHeaders } from "@/lib/cors";
import { Review } from "@/lib/models/review";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.REVIEWS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const review = await Review.findByUuid(id);

    if (!review) {
      return Response.json(
        { success: false, message: "Review not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, review },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get review error:", error);

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
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") ?? "";

    let perm;

    if (action === "moderate") {
      perm = KEY_PERMISSIONS.REVIEWS_MODERATE;
    } else {
      perm = KEY_PERMISSIONS.REVIEWS_UPDATE;
    }

    const auth = await authorize(perm);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    if (action === "moderate") {
      const current = await Review.getInternalByUuid(id);

      if (!current) {
        return Response.json(
          { success: false, message: "Review not found" },
          { status: 404, headers: corsHeaders() }
        );
      }

      const allowed = { APPROVED: "APPROVED", REJECTED: "REJECTED" };

      if (!allowed[body.status]) {
        return Response.json(
          { success: false, message: "Invalid moderation status" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const review = await Review.update(id, {
        status: allowed[body.status],
        adminResponse: body.note,
      });

      return Response.json(
        { success: true, message: "Review updated successfully", review },
        { status: 200, headers: corsHeaders() }
      );
    }

    const review = await Review.update(id, {
      rating: body.rating,
      title: body.title,
      comment: body.comment,
      status: body.status,
    });

    if (!review) {
      return Response.json(
        { success: false, message: "Review not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Review updated successfully", review },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update review error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.REVIEWS_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const review = await Review.findByUuid(id);

    if (!review) {
      return Response.json(
        { success: false, message: "Review not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    await Review.remove(id);

    return Response.json(
      { success: true, message: "Review deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete review error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}