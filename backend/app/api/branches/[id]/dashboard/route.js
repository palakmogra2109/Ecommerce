import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { Branch } from "@/lib/models/branch";
import { BranchProduct } from "@/lib/models/branchProduct";
import { Order } from "@/lib/models/order";

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

    const today = new Date().toISOString();

    const [stats, lowStock, outOfStock, todayOrders] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS totalProducts,
                COALESCE(SUM(bp.stockQuantity), 0)::int AS totalStock,
                COALESCE(SUM(CASE WHEN bp.stockQuantity <= bp.lowStockThreshold THEN 1 ELSE 0 END), 0)::int AS lowStockCount,
                COALESCE(SUM(CASE WHEN bp.stockQuantity <= 0 THEN 1 ELSE 0 END), 0)::int AS outOfStockCount,
                COALESCE(SUM(bp.sellingPrice), 0)::numeric AS totalValue
         FROM branch_products bp WHERE bp.branchId = (SELECT id FROM branches WHERE uuid = $1)`,
        [id]
      ),
      pool.query(
        `SELECT bp.uuid, bp.productUuid, p.name, bp.stockQuantity, bp.lowStockThreshold, bp.sellingPrice, bp.isAvailable
         FROM branch_products bp
         JOIN products p ON p.id = bp.productId
         WHERE bp.branchId = (SELECT id FROM branches WHERE uuid = $1)
           AND bp.stockQuantity <= bp.lowStockThreshold AND bp.isAvailable = TRUE
         ORDER BY bp.stockQuantity ASC LIMIT 10`,
        [id]
      ),
      pool.query(
        `SELECT bp.uuid, bp.productUuid, p.name, bp.stockQuantity, p.price
         FROM branch_products bp
         JOIN products p ON p.id = bp.productId
         WHERE bp.branchId = (SELECT id FROM branches WHERE uuid = $1) AND bp.stockQuantity <= 0 AND bp.isAvailable = TRUE
         ORDER BY p.name ASC LIMIT 10`,
        [id]
      ),
      pool.query(
        `SELECT o.uuid, o.order_number, o.status, o.total, o.created_at
         FROM orders o WHERE o.branchId = (SELECT id FROM branches WHERE uuid = $1)
         AND DATE(o.created_at) = DATE($2) ORDER BY o.created_at DESC LIMIT 10`,
        [id, today]
      ),
    ]);

    const s = stats.rows[0];
    const result = {
      branch,
      stats: {
        totalProducts: parseInt(s.totalProducts, 10),
        totalStock: parseInt(s.totalStock, 10),
        lowStockCount: parseInt(s.lowStockCount, 10),
        outOfStockCount: parseInt(s.outOfStockCount, 10),
        totalValue: parseFloat(s.totalValue),
      },
      lowStock: lowStock.rows,
      outOfStock: outOfStock.rows,
      todayOrders: todayOrders.rows,
    };

    return Response.json({ success: true, dashboard: result }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch dashboard error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
