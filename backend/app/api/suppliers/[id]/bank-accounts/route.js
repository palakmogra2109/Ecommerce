import { corsHeaders } from "@/lib/cors";
import { SupplierBankAccount } from "@/lib/models/supplierBankAccount";
import { Supplier } from "@/lib/models/supplier";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Account numbers come back masked. Revealing one needs its own grant and its
// own endpoint, so a listing cannot leak a whole supplier set.
export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_BANK_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return Response.json({ success: false, message: "Supplier not found" }, { status: 404, headers: corsHeaders() });
    }
    const accounts = await SupplierBankAccount.list(supplier.id);
    return Response.json({ success: true, accounts }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Supplier bank accounts list error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_BANK_MANAGE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return Response.json({ success: false, message: "Supplier not found" }, { status: 404, headers: corsHeaders() });
    }

    const body = await request.json();
    const account = await SupplierBankAccount.create(supplier.id, body, auth.user?.id ?? null);
    return Response.json({ success: true, account }, { status: 201, headers: corsHeaders() });
  } catch (error) {
    // normalize() and archive() write messages meant for the person filling the
    // form, and one of them is a refusal the user needs to read, so they are not
    // flattened into a 500.
    if (error instanceof Error && !error.code) {
      return Response.json({ success: false, message: error.message }, { status: 422, headers: corsHeaders() });
    }
    console.error("Supplier bank account create error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
