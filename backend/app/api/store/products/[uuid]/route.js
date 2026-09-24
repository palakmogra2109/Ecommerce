import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export const OPTIONS = () =>
  new Response(null, { status: 204, headers: corsHeaders() });

export async function GET(request, { params }) {
  try {
    const { uuid } = await params;

    if (!isValidUuid(uuid)) {
      return invalidUuidResponse();
    }

    const { searchParams } = new URL(request.url,
      process.env.APP_URL || "http://localhost:3000");
    const branchId = searchParams.get("branchId") || "";
    const lat = parseFloat(searchParams.get("lat") || "0");
    const lng = parseFloat(searchParams.get("lng") || "0");

    const result = await pool.query(
      `SELECT p.uuid, p.name, p.slug, p.sku, p.short_description, p.description,
              p.price, p.discount_price, p.stock, p.images, p.attributes,
              p.variants, p.featured, p.status, p.inventory_mode, p.pricing_attribute_uuid,
              p.low_stock_threshold,
          b.uuid AS brand_uuid, b.name AS brand_name,
          c.uuid AS category_uuid, c.name AS category_name, c.slug AS category_slug,
          COALESCE(
            (SELECT AVG(rating)::numeric(3,2) FROM reviews r
              WHERE r.product_id = p.id AND r.status = 'APPROVED'),
            0
          ) AS rating,
          (SELECT COUNT(*)::int FROM reviews r
            WHERE r.product_id = p.id AND r.status = 'APPROVED'
          ) AS review_count
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.uuid = $1
          AND p.status = 'ACTIVE'`,
      [uuid]
    );

    const product = result.rows[0];

    if (!product) {
      return Response.json(
        { success: false, message: "Product not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const variants = Array.isArray(product.variants)
      ? product.variants.map((v) => ({
          ...v,
          price: Number(v.price) || 0,
          stock: Number(v.stock) || 0,
          discount_price: v.discount_price ?? v.discountPrice ?? null,
          discountPrice: v.discountPrice ?? v.discount_price ?? null,
        }))
      : [];

    let branchProduct = null;

    if (branchId) {
      const branchResult = await pool.query(
        `SELECT bp.*, b.name AS branchName, b.code AS branchCode, b.city
         FROM branch_products bp
         JOIN branches b ON b.id = bp.branchId
         WHERE bp.productUuid = $1 AND bp.branchId = (SELECT id FROM branches WHERE uuid = $2) AND bp.isAvailable = TRUE`,
        [uuid, branchId]
      );
      if (branchResult.rows[0]) {
        branchProduct = {
          ...branchResult.rows[0],
          branchName: branchResult.rows[0].branchName,
          branchCode: branchResult.rows[0].branchCode,
          branchCity: branchResult.rows[0].city,
          branchPrice: Number(branchResult.rows[0].sellingPrice || product.price),
          branchCompareAtPrice: branchResult.rows[0].compareAtPrice
            ? Number(branchResult.rows[0].compareAtPrice)
            : null,
          branchStock: branchResult.rows[0].stockQuantity,
          branchIsAvailable: branchResult.rows[0].isAvailable,
          branchStatus: branchResult.rows[0].status,
        };
      }
    }

    let effectivePrice = Number(product.price) || 0;
    let effectiveCompareAtPrice = product.discount_price
      ? Number(product.discount_price)
      : null;

    if (branchProduct) {
      effectivePrice = Number(branchProduct.branchPrice) || 0;
      effectiveCompareAtPrice = branchProduct.branchCompareAtPrice;
    }

    return Response.json(
      {
        success: true,
        product: {
          ...product,
          price: Number(product.price) || 0,
          discount_price: product.discount_price !== null ? Number(product.discount_price) : null,
          discountPrice: product.discount_price !== null ? Number(product.discount_price) : null,
          stock: Number(product.stock) || 0,
          rating: Number(product.rating) || 0,
          images: Array.isArray(product.images) && product.images.length ? product.images : [],
          variants,
          branch: branchProduct,
          effectivePrice,
          effectiveCompareAtPrice,
        },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store product detail error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
