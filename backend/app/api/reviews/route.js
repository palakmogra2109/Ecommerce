import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Review } from "@/lib/models/review";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, REVIEW_STATUSES } from "@shared/constants";
import { isValidUuid } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.REVIEWS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const rating = searchParams.get("rating") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: reviews, pagination } = await Review.list({
      search,
      status,
      rating,
      page,
      limit,
    });

    return Response.json(
      { success: true, reviews, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List reviews error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.REVIEWS_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { productUuid, customerUuid, rating, title, comment } = body;

    if (!isValidUuid(String(productUuid ?? ""))) {
      return Response.json(
        { success: false, message: "A valid product is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!rating || Number(rating) < 1 || Number(rating) > 5) {
      return Response.json(
        { success: false, message: "Rating must be between 1 and 5" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const review = await Review.create({
      productUuid,
      customerUuid: isValidUuid(String(customerUuid ?? "")) ? customerUuid : null,
      rating: Number(rating),
      title,
      comment,
      status: "PENDING",
    });

    return Response.json(
      { success: true, message: "Review submitted successfully", review },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create review error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}