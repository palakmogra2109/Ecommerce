import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { requireBranchAccess } from "@/lib/authorization";
import { authenticate } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// POST /api/store/my/products/add
// Store picks an admin-created (ACTIVE) product by uuid from a dropdown and
// adds it to its catalogue with its OWN selling price and opening stock.
// The opening stock is recorded as a PURCHASE transaction so the store can
// always see when stock was received and how much.
export async function POST(request) {
  let client;
  try {
    const body = await request.json();
    const productUuid = (body.productUuid || "").trim();
    const sellingPrice = Number(body.sellingPrice);
    const compareAtPrice =
      body.compareAtPrice === "" || body.compareAtPrice == null
        ? null
        : Number(body.compareAtPrice);
    const stockQuantity = Math.max(0, parseInt(body.stockQuantity, 10) || 0);
    const lowStockThreshold = Math.max(
      0,
      parseInt(body.lowStockThreshold, 10) || 5
    );

    const branchUuid =
      body.branchId || request.headers.get("x-branch-id") || "";
    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    if (!productUuid) {
      return Response.json(
        { success: false, message: "Please select a product" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
      return Response.json(
        { success: false, message: "Selling price must be greater than 0" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Fetch the product. Only admin-created ACTIVE products can be added.
    const productResult = await pool.query(
      `SELECT id, uuid, name, sku, price, discount_price, status
       FROM products WHERE uuid = $1`,
      [productUuid]
    );

    const product = productResult.rows[0];

    if (!product) {
      return Response.json(
        { success: false, message: "Product not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    if (product.status !== "ACTIVE") {
      return Response.json(
        {
          success: false,
          message: "Only active admin products can be added to the store",
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Reject duplicates — the dropdown already excludes them, but the store
    // panel may be open on two devices; guard the DB too.
    const dup = await pool.query(
      `SELECT 1 FROM branch_products WHERE branchid = $1 AND productid = $2`,
      [access.branchId, product.id]
    );
    if (dup.rows.length > 0) {
      return Response.json(
        { success: false, message: `"${product.name}" is already in your store` },
        { status: 409, headers: corsHeaders() }
      );
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // Create the store catalogue entry with the store's own price + stock.
    const inserted = await client.query(
      `INSERT INTO branch_products
         (branchid, productid, productuuid, sellingprice, compareatprice,
          stockquantity, lowstockthreshold, isavailable, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'ACTIVE')
       RETURNING uuid, stockquantity`,
      [
        access.branchId,
        product.id,
        product.uuid,
        sellingPrice,
        compareAtPrice,
        stockQuantity,
        lowStockThreshold,
      ]
    );

    const branchProduct = inserted.rows[0];

    // Stock ledger entry: the store received this stock now (PURCHASE).
    // previousStock is 0 because the product is new to this store.
    if (stockQuantity > 0) {
      await client.query(
        `INSERT INTO branch_inventory_transactions
           (branchId, productId, productUuid, transactionType, quantity,
            previousStock, newStock, referenceType, reason, createdBy)
         VALUES ($1, $2, $3, 'PURCHASE', $4, 0, $4, 'STORE_ADD', $5, $6)`,
        [
          access.branchId,
          product.id,
          product.uuid,
          stockQuantity,
          `Added to store with opening stock ${stockQuantity}`,
          access.user?.id ?? null,
        ]
      );
    }

    await client.query("COMMIT");
    client.release();

    return Response.json(
      {
        success: true,
        message: `"${product.name}" added to your store`,
        product: {
          uuid: branchProduct.uuid,
          productUuid: product.uuid,
          name: product.name,
          sku: product.sku,
          sellingPrice,
          compareAtPrice,
          stockQuantity,
          lowStockThreshold,
        },
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
        client.release();
      } catch (_) {}
    }
    console.error("Store add product error:", error);
    return Response.json(
      { success: false, message: "Failed to add product. Please try again." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
