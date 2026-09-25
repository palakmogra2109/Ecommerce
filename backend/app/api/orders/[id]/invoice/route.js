import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { Order } from "@/lib/models/order";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { KEY_PERMISSIONS } from "@shared/constants";
import { buildInvoicePdf } from "@/lib/invoice";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// GET /api/orders/:id/invoice — admin/staff download the order bill PDF.
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

    const pdf = await buildInvoicePdf(order);

    return new Response(pdf, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${order.order_number}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Invoice download error:", error);
    return Response.json(
      { success: false, message: "Failed to generate invoice" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
