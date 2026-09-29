import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import pool from "@/lib/db";
import { Branch } from "@/lib/models/branch";
import { BranchProduct } from "@/lib/models/branchProduct";

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

    const { search = "", page = 1, limit = 20 } = Object.fromEntries(new URL(request.url).searchParams);
    // getByBranch filters on the numeric branchid column - pass branch.id,
    // not the uuid from the URL. The fake `status` filter is gone: getByBranch
    // never accepted one, so it was silently dropped on the way in.
    const result = await BranchProduct.getByBranch(branch.id, { search, page, limit });
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

    const branch = await Branch.findByUuid(id);
    if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });

    const body = await request.json();
    const { productUuid, sellingPrice, compareAtPrice, costPrice, stockQuantity, lowStockThreshold, isAvailable, status } = body;

    // branch_products carries both a bigint productid and a productuuid, but the
    // unique index - and the getByBranch join - are on the bigint pair. The
    // clients only send the uuid, so resolve it here instead of writing a row
    // the ON CONFLICT clause can never match.
    let productId = body.productId ?? null;
    if (productId == null && productUuid) {
      const product = await pool.query("SELECT id FROM products WHERE uuid = $1", [productUuid]);
      if (product.rows.length === 0) {
        return Response.json({ success: false, message: "Product not found" }, { status: 404, headers: corsHeaders() });
      }
      productId = product.rows[0].id;
    }

    const branchProduct = await BranchProduct.create({
      branchId: branch.id,
      productId,
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
