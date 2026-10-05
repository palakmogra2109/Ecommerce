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
    const auth = await authorize(KEY_PERMISSIONS.PURCHASE_INVOICES_PAY);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const body = await request.json();
    const result = await PurchaseInvoice.recordPayment({
      invoiceId: id,
      amount: body.amount,
      method: body.method || "BANK",
      reference: body.reference || null,
      notes: body.notes || null,
      paidAt: body.paidAt || null,
      createdBy: auth.user?.id ?? null,
    });
    return Response.json(
      { success: true, payment: result.payment, outstanding: result.outstanding, invoice: result.invoice },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    const status = statusForError(error);
    if (status === 500) console.error("Purchase payment error:", error);
    return Response.json(
      { success: false, message: error.message || "Internal server error", code: error.code },
      { status, headers: corsHeaders() }
    );
  }
}
