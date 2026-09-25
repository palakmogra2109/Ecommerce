import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { requireBranchAccess } from "@/lib/authorization";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// GET /api/store/my/products/:uuid/stock-history
// Stock ledger for one product at this store: WHEN stock was received /
// deducted / adjusted, how much, and why. Powers the "Stock History"
// panel in the store products tab so the store can always see when it
// got stock.
export async function GET(request, { params }) {
  try {
    const { uuid } = await params;

    if (!isValidUuid(uuid)) {
      return invalidUuidResponse();
    }

    const branchUuid =
      request.headers.get("x-branch-id") ||
      new URL(request.url, "http://localhost:3000").searchParams.get("branchId") ||
      "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    const result = await pool.query(
      `
      SELECT t.transactiontype, t.quantity, t.previousstock, t.newstock,
             t.reason, t.referencetype, t.createdat
      FROM branch_inventory_transactions t
      JOIN branch_products bp ON bp.branchid = t.branchid
         AND bp.productid = t.productid
      WHERE bp.uuid = $1 AND t.branchid = $2
      ORDER BY t.createdat DESC, t.id DESC
      LIMIT 50
      `,
      [uuid, access.branchId]
    );

    return Response.json(
      {
        success: true,
        transactions: result.rows.map((t) => ({
          transactionType: t.transactiontype,
          quantity: Number(t.quantity) || 0,
          previousStock: Number(t.previousstock) || 0,
          newStock: Number(t.newstock) || 0,
          reason: t.reason || "",
          referenceType: t.referencetype || null,
          createdAt: t.createdat,
        })),
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Stock history error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
