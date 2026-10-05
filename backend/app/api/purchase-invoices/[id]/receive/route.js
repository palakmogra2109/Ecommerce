import { corsHeaders } from "@/lib/cors";
import { PurchaseInvoice, statusForError } from "@/lib/services/purchaseInvoice";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request, { params }) {
  try {
    // Receiving moves stock and needs its own grant, not merely the right to
    // book an invoice: counting the goods is a different job from ordering them.
    const auth = await authorize(KEY_PERMISSIONS.PURCHASE_INVOICES_RECEIVE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const body = await request.json();
    const result = await PurchaseInvoice.receiveStock({
      invoiceId: id,
      lines: body.lines || [],
      notes: body.notes || null,
      performedBy: auth.user?.id ?? null,
    });
    return Response.json(
      { success: true, receipt: result.receipt, status: result.status, invoice: result.invoice },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    const status = statusForError(error);
    if (status === 500) console.error("Receive stock error:", error);
    return Response.json(
      { success: false, message: error.message || "Internal server error", code: error.code },
      { status, headers: corsHeaders() }
    );
  }
}
