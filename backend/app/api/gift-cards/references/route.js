import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Everything the gift card scope picker needs, in one request: brands,
 * categories, and products already tagged with their brand and category.
 *
 * Sent together so the admin form can filter the product list by brand without
 * a second round trip, and so a stale dropdown can never show a product that
 * has since been re-branded.
 */
export async function GET() {
  try {
    // These tables gate visibility with a `status` column, not `is_active`.
    // Only live rows are offered: a DRAFT product must not be pickable, or an
    // admin could scope a card to something the storefront never sells.
    const [brands, categories, products] = await Promise.all([
      pool.query(
        `SELECT id, name, slug FROM brands WHERE status = 'ACTIVE' ORDER BY name`
      ),
      pool.query(
        `SELECT id, name, slug FROM categories WHERE status = 'ACTIVE' ORDER BY name`
      ),
      pool.query(
        `SELECT id, uuid, name, slug, brand_id, category_id
         FROM products
         WHERE status = 'ACTIVE'
         ORDER BY name`
      ),
    ]);

    return Response.json(
      {
        success: true,
        brands: brands.rows,
        categories: categories.rows,
        products: products.rows.map((p) => ({
          id: p.id,
          uuid: p.uuid,
          name: p.name,
          brand_id: p.brand_id,
          category_id: p.category_id,
        })),
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Gift card references error:", error);
    return Response.json(
      { success: false, message: "Could not load brands, categories and products." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
