import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { BranchStockTransfer } from "@/lib/models/branchStockTransfer";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_VIEW);
    if (!auth.ok) return auth.response;

    const { transferId } = await params;
    if (!isValidUuid(transferId)) return invalidUuidResponse();

    const transfer = await BranchStockTransfer.findByUuid(transferId);
    if (!transfer) return Response.json({ success: false, message: "Transfer not found" }, { status: 404, headers: corsHeaders() });
    return Response.json({ success: true, transfer }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch transfer get error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_UPDATE);
    if (!auth.ok) return auth.response;

    const { transferId } = await params;
    if (!isValidUuid(transferId)) return invalidUuidResponse();

    const body = await request.json();
    const { status, approvedById, receivedById } = body;

    const transfer = await BranchStockTransfer.updateStatus(transferId, status, approvedById, receivedById);
    if (!transfer) return Response.json({ success: false, message: "Transfer not found" }, { status: 404, headers: corsHeaders() });
    return Response.json({ success: true, transfer }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch transfer update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
