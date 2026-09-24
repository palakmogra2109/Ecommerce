import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { Branch } from "@/lib/models/branch";
import { BranchProduct } from "@/lib/models/branchProduct";
import { BranchInventoryTransaction } from "@/lib/models/branchInventoryTransaction";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCH_INVENTORY_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const branch = await Branch.findByUuid(id);
    if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });

    const { page = 1, limit = 50, type = "" } = Object.fromEntries(new URL(request.url).searchParams);
    const result = await BranchInventoryTransaction.getByBranch(id, { page, limit, type });
    return Response.json({ success: true, transactions: result.rows, pagination: result.pagination }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch inventory transactions error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
