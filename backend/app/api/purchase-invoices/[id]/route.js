import { corsHeaders } from "@/lib/cors";
import { PurchaseInvoice, statusForError } from "@/lib/services/purchaseInvoice";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PURCHASE_INVOICES_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const invoice = await PurchaseInvoice.findById(id);
    if (!invoice) {
      return Response.json({ success: false, message: "Purchase invoice not found" }, { status: 404, headers: corsHeaders() });
    }
    return Response.json({ success: true, invoice }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Purchase invoice read error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PURCHASE_INVOICES_CANCEL);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    // No default reason. Substituting one here would mean an operator who gave
    // no reason still produced a "reason" on the audit trail; the service
    // refuses with NO_REASON and the caller is told to supply one.
    const body = await request.json().catch(() => ({}));
    const invoice = await PurchaseInvoice.cancel({
      invoiceId: id,
      reason: body.reason,
      cancelledBy: auth.user?.id ?? null,
    });
    return Response.json({ success: true, invoice }, { headers: corsHeaders() });
  } catch (error) {
    const status = statusForError(error);
    if (status === 500) console.error("Purchase invoice cancel error:", error);
    return Response.json(
      { success: false, message: error.message || "Internal server error", code: error.code },
      { status, headers: corsHeaders() }
    );
  }
}
