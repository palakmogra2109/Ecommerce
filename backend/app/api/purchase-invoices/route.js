import { corsHeaders } from "@/lib/cors";
import { PurchaseInvoice, statusForError } from "@/lib/services/purchaseInvoice";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PURCHASE_INVOICES_VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const result = await PurchaseInvoice.list({
      supplierId: searchParams.get("supplierId") || "",
      status: searchParams.get("status") || "",
      paymentStatus: searchParams.get("paymentStatus") || "",
      search: searchParams.get("search") || "",
      page: Math.max(1, parseInt(searchParams.get("page") || "1", 10)),
      limit: Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10))),
    });
    return Response.json(
      { success: true, invoices: result.rows, pagination: result.pagination },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Purchase invoices list error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PURCHASE_INVOICES_CREATE);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    // Every figure is recomputed inside the service; anything the client sent
    // for totals is ignored rather than trusted.
    const invoice = await PurchaseInvoice.create({ ...body, createdBy: auth.user?.id ?? null });
    return Response.json({ success: true, invoice }, { status: 201, headers: corsHeaders() });
  } catch (error) {
    const status = statusForError(error);
    if (status === 500) console.error("Purchase invoice create error:", error);
    return Response.json(
      { success: false, message: error.message || "Internal server error", code: error.code },
      { status, headers: corsHeaders() }
    );
  }
}