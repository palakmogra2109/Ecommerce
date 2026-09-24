import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { requireBranchAccess } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function PATCH(request, { params }) {
  try {
    const { uuid } = await params;
    const body = await request.json();
    const { sellingPrice, compareAtPrice, stockQuantity, isAvailable, lowStockThreshold } = body;

    const branchUuid = body.branchId || request.headers.get("x-branch-id") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const result = await pool.query(
      `UPDATE branch_products SET sellingprice = $1, compareatprice = $2, stockquantity = $3, isavailable = $4, lowstockthreshold = $5, updatedat = now() WHERE uuid = $6 AND branchid = $7 RETURNING *`,
      [Number(sellingPrice) || 0, compareAtPrice ? Number(compareAtPrice) : null, Number(stockQuantity) || 0, isAvailable !== false, Number(lowStockThreshold) || 5, uuid, access.branchId]
    );

    if (result.rows.length === 0) {
      return Response.json({ success: false, message: "Branch product not found" }, { status: 404, headers: corsHeaders() });
    }

    const row = result.rows[0];
    return Response.json({
      success: true,
      message: "Product updated",
      product: {
        uuid: row.uuid,
        sellingPrice: Number(row.sellingprice) || 0,
        compareAtPrice: row.compareatprice ? Number(row.compareatprice) : null,
        stockQuantity: Number(row.stockquantity) || 0,
        isAvailable: row.isavailable,
        lowStockThreshold: Number(row.lowstockthreshold) || 5,
      },
    }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Store product update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
