import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { Branch } from "@/lib/models/branch";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const branch = await Branch.findByUuid(id);
    if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });

    const { search = "", status = "", page = 1, limit = 20 } = Object.fromEntries(new URL(request.url).searchParams);
    const result = await BranchProduct.getByBranch(id, { search, status, page, limit });
    return Response.json({ success: true, products: result.rows, pagination: result.pagination }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch products error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCH_INVENTORY_UPDATE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const body = await request.json();
    const { productUuid, sellingPrice, compareAtPrice, costPrice, stockQuantity, lowStockThreshold, isAvailable, status } = body;

    const branchProduct = await BranchProduct.create({
      branchId: id,
      productUuid,
      sellingPrice,
      compareAtPrice,
      costPrice,
      stockQuantity: stockQuantity ?? 0,
      lowStockThreshold: lowStockThreshold ?? 5,
      isAvailable: isAvailable ?? true,
      status: status ?? "ACTIVE",
    });

    return Response.json({ success: true, branchProduct }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch product update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
