import { corsHeaders } from "@/lib/cors";
import { SupplierBankAccount } from "@/lib/models/supplierBankAccount";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

const badUuid = () => invalidUuidResponse();

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_BANK_MANAGE);
    if (!auth.ok) return auth.response;

    const { uuid } = await params;
    if (!isValidUuid(uuid)) return badUuid();

    const body = await request.json();
    // is_primary is set through its own action, because demoting the old primary
    // and promoting the new one has to happen in one transaction.
    const { is_primary: _ignored, ...rest } = body;
    const account = await SupplierBankAccount.update(uuid, rest);
    if (!account) {
      return Response.json({ success: false, message: "Account not found" }, { status: 404, headers: corsHeaders() });
    }
    return Response.json({ success: true, account }, { headers: corsHeaders() });
  } catch (error) {
    if (error instanceof Error && !error.code) {
      return Response.json({ success: false, message: error.message }, { status: 422, headers: corsHeaders() });
    }
    console.error("Supplier bank account update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

/** Set by POST ?action=primary, so the primary flag cannot arrive as loose JSON. */
export async function POST(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_BANK_MANAGE);
    if (!auth.ok) return auth.response;

    const { uuid } = await params;
    if (!isValidUuid(uuid)) return badUuid();

    const { searchParams } = new URL(request.url);
    if (searchParams.get("action") !== "primary") {
      return Response.json({ success: false, message: "Unsupported action" }, { status: 400, headers: corsHeaders() });
    }
    const account = await SupplierBankAccount.setPrimary(uuid);
    if (!account) {
      return Response.json({ success: false, message: "Account not found" }, { status: 404, headers: corsHeaders() });
    }
    return Response.json({ success: true, account }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Supplier bank account set primary error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_BANK_MANAGE);
    if (!auth.ok) return auth.response;

    const { uuid } = await params;
    if (!isValidUuid(uuid)) return badUuid();

    const account = await SupplierBankAccount.archive(uuid);
    if (!account) {
      return Response.json({ success: false, message: "Account not found" }, { status: 404, headers: corsHeaders() });
    }
    return Response.json({ success: true, account, message: "Account retired" }, { headers: corsHeaders() });
  } catch (error) {
    if (error instanceof Error && !error.code) {
      return Response.json({ success: false, message: error.message }, { status: 422, headers: corsHeaders() });
    }
    console.error("Supplier bank account retire error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
