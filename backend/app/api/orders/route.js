import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Order } from "@/lib/models/order";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ORDERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const paymentStatus = searchParams.get("paymentStatus") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: orders, pagination } = await Order.list({
      search,
      status,
      paymentStatus,
      page,
      limit,
    });

    return Response.json(
      { success: true, orders, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List orders error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}