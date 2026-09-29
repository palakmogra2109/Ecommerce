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
    // A branch or a location narrows the catalog. It is expressed as EXISTS
    // predicates rather than an INNER JOIN branches: the join multiplied one
    // product into one row per matching branch, and it collided with the
    // `brands b` alias already in the select list (42712 "table name b specified
    // more than once"), which is what 500'd the route.
    const branchConditions = [];

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
      branchConditions.push(`bp.branchid = (SELECT id FROM branches WHERE uuid = $${params.length})`);
    }

    if (pincode) {
      params.push(`${pincode}%`);
      params.push(`${pincode}`);
      branchConditions.push(
        `EXISTS (SELECT 1 FROM branches nb WHERE (nb.postalcode LIKE $${params.length - 1} OR nb.postalcode = $${params.length}) AND nb.status = 'ACTIVE' AND nb.deliveryenabled = TRUE AND nb.id = bp.branchid)`
      );
    }

    if (lat !== 0 && lng !== 0) {
      const maxLat = 50 / 111.32;
      const maxLng = 50 / (111.32 * Math.cos(lat * Math.PI / 180));
      params.push(lat, lng, maxLat, maxLng);
      // The ::numeric casts matter: node-postgres sends a JS number as an
      // untyped parameter, so `$1 - $3` on its own is "unknown - unknown" and
      // Postgres rejects it with 42725 (operator is not unique).
      branchConditions.push(
        `EXISTS (SELECT 1 FROM branches nb WHERE nb.latitude BETWEEN $${params.length - 3}::numeric - $${params.length - 2}::numeric AND $${params.length - 3}::numeric + $${params.length - 2}::numeric AND nb.longitude BETWEEN $${params.length - 1}::numeric - $${params.length}::numeric AND $${params.length - 1}::numeric + $${params.length}::numeric AND nb.status = 'ACTIVE' AND nb.deliveryenabled = TRUE AND nb.id = bp.branchid)`
      );
    }

    // branch_products is reached through a LATERAL that can yield at most one
    // row per product. A plain join fanned one product out into one row per
    // branch listing, which duplicated it in the page *and* in the count; the
    // availability filter also has to live inside the join, because a listing
    // that is unavailable or inactive must not reach the storefront at all.
    //
    // LATERAL also keeps the branches alias inside the subquery, which is what
    // removed the `branches b` / `brands b` collision (42712) that 500'd the
    // route; a scalar EXISTS on an unconstrained join could not do that, since
    // the row multiplication happens in the FROM clause, not the WHERE clause.
    //
    // `bp.id IS NOT NULL` is only added when a branch was actually asked for,
    // so the plain catalog keeps listing every ACTIVE product.
    const branchJoin = (filter) => `LEFT JOIN LATERAL (
       SELECT * FROM branch_products bp
       WHERE bp.productid = p.id
         AND bp.isavailable = TRUE
         AND bp.status = 'ACTIVE'
         ${filter}
       ORDER BY bp.branchid ASC
       LIMIT 1
     ) bp ON TRUE`;
    const scoped = branchConditions.length > 0;
    // The branch conditions live inside the LATERAL - that is what picks which
    // listing a product resolves to. `bp.id IS NOT NULL` is what turns the LEFT
    // JOIN into a branch-scoped catalog: a product with no listing at the
    // requested branch comes back with bp NULL and is dropped. Without a branch
    // filter it is omitted, so the plain catalog still lists every ACTIVE
    // product.
    const scope = scoped ? " AND bp.id IS NOT NULL" : "";

    const offset = (page - 1) * limit;

    // The page and the count are built from the same scope, so they can never
    // disagree.
    async function runCatalog(filter) {
      const where = `WHERE ${productConditions.join(" AND ")}${scope}`;
      const countWhere = `WHERE ${countConditions.join(" AND ")}${scope}`;
      const join = branchJoin(filter);

      const count = await pool.query(
        `SELECT COUNT(*)::int AS count FROM products p LEFT JOIN categories c ON c.id = p.category_id ${join} ${countWhere}`,
        params
      );

      const productSql = `SELECT p.uuid, p.name, p.slug, p.sku, p.short_description, p.description,
       p.price, p.discount_price, p.stock, p.images, p.variants, p.featured, p.inventory_mode,
       p.pricing_attribute_uuid, p.low_stock_threshold,
       c.name AS category_name, c.slug AS category_slug,
       b.name AS brand_name, b.uuid AS brand_uuid,
       bp.uuid AS "branchProductUuid", bp.sellingprice AS "branchPrice", bp.compareatprice AS "branchComparePrice",
       bp.stockquantity AS "branchStock", bp.isavailable AS "branchIsAvailable", bp.status AS "branchStatus",
       bp.lowstockthreshold AS "branchLowStockThreshold"
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       ${join}
       ${where}
       ORDER BY p.featured DESC, p.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

      const rows = await pool.query(productSql, [...params, limit, offset]);
      return { rows: rows.rows, total: count.rows[0]?.count || 0 };
    }

    // A pincode or a lat/lng pair narrows the catalog to the branches that serve
    // the shopper. If that resolution blows up, the storefront still gets a page
    // of products rather than a 500: fall back to the no-location catalog.
    let catalog;
    try {
      catalog = await runCatalog(scoped ? ` AND ${branchConditions.join(" AND ")}` : "");
    } catch (error) {
      if (!scoped) throw error;
      console.error("Store products location filter failed, serving the no-location catalog:", error);
      catalog = await runCatalog("");
    }
    const total = catalog.total;

    return Response.json(
      {
        success: true,
        products: catalog.rows.map((p) => {
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
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
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
