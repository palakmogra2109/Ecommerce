import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";

export const runtime = "nodejs";

export const OPTIONS = () =>
  new Response(null, { status: 204, headers: corsHeaders() });

// Public storefront catalog: only ACTIVE products, never exposes admin
// cost columns. Supports branchId or lat/lng for branch-aware results.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url,
      process.env.APP_URL || "http://localhost:3000");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(24, Math.max(1, parseInt(searchParams.get("limit") || "12", 10)));
    const search = (searchParams.get("search") || "").trim();
    const category = (searchParams.get("category") || "").trim();
    const branchId = searchParams.get("branchId") || "";
    const pincode = searchParams.get("pincode") || "";
    const lat = parseFloat(searchParams.get("lat") || "0");
    const lng = parseFloat(searchParams.get("lng") || "0");

    const productConditions = ["p.status = 'ACTIVE'"];
    const countConditions = ["p.status = 'ACTIVE'"];
    const params = [];
    let joinClauses = "";

    if (search) {
      params.push(`%${search}%`);
      productConditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
      countConditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }

    if (category) {
      params.push(`%${category}%`);
      productConditions.push(`(c.slug ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
      countConditions.push(`(c.slug ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }

    if (branchId) {
      params.push(branchId);
      productConditions.push(`bp.branchid = (SELECT id FROM branches WHERE uuid = $${params.length})`);
      productConditions.push(`bp.isavailable = TRUE`);
      countConditions.push(`bp.branchid = (SELECT id FROM branches WHERE uuid = $${params.length})`);
      countConditions.push(`bp.isavailable = TRUE`);
    }

    if (pincode) {
      params.push(`${pincode}%`);
      params.push(`${pincode}%`);
      const branchJoinPin = `INNER JOIN branches b ON (b.postalCode LIKE $${params.length - 1} OR b.postalCode = $${params.length}) AND b.status = 'ACTIVE' AND b.deliveryEnabled = TRUE`;
      joinClauses += ` ${branchJoinPin}`;
      if (!branchId) {
        productConditions.push(`bp.branchid = b.id`);
        productConditions.push(`bp.isavailable = TRUE`);
        countConditions.push(`bp.branchid = b.id`);
        countConditions.push(`bp.isavailable = TRUE`);
      }
    }

    if (lat !== 0 && lng !== 0) {
      const earthRadius = 6371;
      const maxLat = 50 / 111.32;
      const maxLng = 50 / (111.32 * Math.cos(lat * Math.PI / 180));
      params.push(lat, lng, maxLat, maxLng);
      const locJoin = `INNER JOIN branches b ON b.latitude BETWEEN $${params.length - 3} - $${params.length - 2} AND $${params.length - 3} + $${params.length - 2} AND b.longitude BETWEEN $${params.length - 1} - $${params.length} AND $${params.length - 1} + $${params.length} AND b.status = 'ACTIVE' AND b.deliveryEnabled = TRUE`;
      joinClauses += ` ${locJoin}`;
      if (!branchId) {
        productConditions.push(`bp.branchid = b.id`);
        productConditions.push(`bp.isavailable = TRUE`);
        countConditions.push(`bp.branchid = b.id`);
        countConditions.push(`bp.isavailable = TRUE`);
      }
    }

    const productWhere = `WHERE ${productConditions.join(" AND ")}`;
    const countWhere = `WHERE ${countConditions.join(" AND ")}`;

    const offset = (page - 1) * limit;

const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM products p LEFT JOIN categories c ON c.id = p.category_id ${joinClauses} LEFT JOIN branch_products bp ON bp.productId = p.id ${countWhere}`,
      params
    );

    const productSql = `SELECT p.uuid, p.name, p.slug, p.sku, p.short_description, p.description,
       p.price, p.discount_price, p.stock, p.images, p.variants, p.featured, p.inventory_mode,
       p.pricing_attribute_uuid, p.low_stock_threshold,
       c.name AS category_name, c.slug AS category_slug,
       b.name AS brand_name, b.uuid AS brand_uuid,
       bp.uuid AS branchProductUuid, bp.sellingprice AS branchPrice, bp.compareatprice AS branchComparePrice,
       bp.stockquantity AS branchStock, bp.isavailable AS branchIsAvailable, bp.status AS branchStatus,
       bp.lowstockthreshold AS branchLowStockThreshold
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       ${joinClauses}
       LEFT JOIN branch_products bp ON bp.productId = p.id
       ${productWhere}
       ORDER BY p.featured DESC, p.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const result = await pool.query(productSql, [...params, limit, offset]);

    return Response.json(
      {
        success: true,
        products: result.rows.map((p) => {
          const variants = Array.isArray(p.variants)
            ? p.variants.map((v) => ({
                ...v,
                price: Number(v.price) || 0,
                stock: Number(v.stock) || 0,
                discount_price: v.discount_price ?? v.discountPrice ?? null,
                discountPrice: v.discountPrice ?? v.discount_price ?? null,
              }))
            : [];
          const branchPrice = p.branchPrice ?? p.price;
          const branchDiscount = p.branchComparePrice;
          return {
            ...p,
            price: Number(p.price) || 0,
            discount_price: p.discount_price !== null ? Number(p.discount_price) : null,
            discountPrice: p.discount_price !== null ? Number(p.discount_price) : null,
            stock: Number(p.stock) || 0,
            images: p.images || [],
            variants,
            branch: p.branchProductUuid
              ? {
                  uuid: p.branchProductUuid,
                  branchPrice: Number(p.branchPrice) || 0,
                  compareAtPrice: p.branchComparePrice ? Number(p.branchComparePrice) : null,
                  stock: p.branchStock ?? 0,
                  isAvailable: p.branchIsAvailable ?? false,
                  status: p.branchStatus,
                  lowStockThreshold: p.branchLowStockThreshold ?? 5,
                }
              : null,
            effectivePrice: p.branchPrice ? Number(p.branchPrice) : null,
            effectiveCompareAtPrice: p.branchComparePrice ? Number(p.branchComparePrice) : null,
          };
        }),
        pagination: {
          page,
          limit,
          total: count.rows[0]?.count || 0,
          pages: Math.max(1, Math.ceil((count.rows[0]?.count || 0) / limit)),
        },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store products error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
