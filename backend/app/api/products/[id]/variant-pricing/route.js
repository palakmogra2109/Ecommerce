import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { Product } from "@/lib/models/product";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();
    const { variants } = body;

    if (!Array.isArray(variants)) {
      return Response.json(
        { success: false, message: "Variants must be an array" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const current = await Product.getInternalByUuid(id);

    if (!current) {
      return Response.json(
        { success: false, message: "Product not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const existingVariants = Array.isArray(current.variants)
      ? current.variants
      : [];

    const updatedVariants = existingVariants.map((variant) => {
      const update = variants.find(
        (v) => v.sku === variant.sku || v.name === variant.name
      );

      if (update) {
        return {
          ...variant,
          price: update.price !== undefined ? Number(update.price) : variant.price,
          stock: update.stock !== undefined ? Number(update.stock) : variant.stock,
          discount_price: update.discountPrice !== undefined ? Number(update.discountPrice) : variant.discount_price,
        };
      }

      return variant;
    });

    const result = await pool.query(
      `UPDATE products SET variants = $1, updated_at = now() WHERE uuid = $2 RETURNING uuid`,
      [JSON.stringify(updatedVariants), id]
    );

    if (result.rows.length === 0) {
      return Response.json(
        { success: false, message: "Product not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const updatedProduct = await Product.findByUuid(id);

    return Response.json(
      { success: true, product: updatedProduct, message: "Variant pricing updated" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update variant pricing error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
