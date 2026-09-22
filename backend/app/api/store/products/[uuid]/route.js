import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { Product } from "@/lib/models/product";
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

    const result = await pool.query(
      `SELECT p.uuid, p.name, p.slug, p.sku, p.short_description, p.description,
              p.price, p.discount_price, p.stock, p.images, p.attributes,
              p.variants, p.featured, p.status, p.shipping_meta,
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
         AND EXISTS (SELECT 1 FROM products pp WHERE pp.uuid = p.uuid AND pp.status = 'ACTIVE')`,
      [uuid]
    );

    const product = result.rows[0];

    if (!product) {
      return Response.json(
        { success: false, message: "Product not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      {
        success: true,
        product: {
          ...product,
          price: Number(product.price) || 0,
          discount_price:
            product.discount_price !== null ? Number(product.discount_price) : null,
          stock: Number(product.stock) || 0,
          rating: Number(product.rating) || 0,
          images:
            Array.isArray(product.images) && product.images.length
              ? product.images
              : [],
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
