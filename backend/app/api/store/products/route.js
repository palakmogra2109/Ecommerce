import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { buildBranchScope } from "@/lib/storeCatalogScope";

export const runtime = "nodejs";

export const OPTIONS = () =>
  new Response(null, { status: 204, headers: corsHeaders() });

// Public storefront catalog: only ACTIVE products, never exposes admin
// cost columns. Supports branchId or lat/lng for branch-aware results.
export async function GET(request) {
  try {
    // branch_products is reached through a LATERAL that can yield at most one row
    // per product. A plain join fanned one product out into one row per branch
    // listing, which duplicated it in the page *and* in the count; the
    // availability filter also has to live inside the join, because a listing
    // that is unavailable or inactive must not reach the storefront at all.
    //
    // LATERAL also keeps the `branches` alias inside the subquery, which is what
    // removed the `branches b` / `brands b` collision (42712) that 500'd the
    // route.
    const branchJoin = (filter) => `LEFT JOIN LATERAL (
       SELECT * FROM branch_products bp
       WHERE bp.productid = p.id
         AND bp.isavailable = TRUE
         AND bp.status = 'ACTIVE'
         ${filter}
       ORDER BY bp.branchid ASC
       LIMIT 1
     ) bp ON TRUE`;

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

    // Everything pushed before the branch scope is bound in both the scoped and
    // the unfiltered statement; the branch scope's own parameters are only bound
    // in the scoped one. Captured so the fallback can bind exactly the prefix
    // whose placeholders actually exist in its SQL.
    const baseParamCount = params.length;

    const scope = buildBranchScope({ branchId, pincode, lat, lng, params });
    const { conditions: branchConditions, scoped } = scope;

    const offset = (page - 1) * limit;

    // `branchFilter` is the LATERAL's inner predicate; `isScoped` decides whether
    // the outer `bp.id IS NOT NULL` applies. They are two separate switches on
    // purpose: the fallback below needs the inner filter dropped AND the outer
    // scope dropped, so deriving one from the other is what previously left the
    // fallback silently scoped.
    //
    // The page and the count are built from the same scope, so they can never
    // disagree.
    async function runCatalog(branchFilter, isScoped) {
      const scopeClause = isScoped ? " AND bp.id IS NOT NULL" : "";
      const where = `WHERE ${productConditions.join(" AND ")}${scopeClause}`;
      const countWhere = `WHERE ${countConditions.join(" AND ")}${scopeClause}`;
      const join = branchJoin(branchFilter);
      // `params` only have placeholders in this statement when a branch filter is
      // present. Binding them unconditionally is 08P01 ("bind message supplies N
      // parameters, but prepared statement requires 0") and is what made the
      // fallback below unreachable.
      const bound = isScoped ? params : params.slice(0, baseParamCount);

      const count = await pool.query(
        `SELECT COUNT(*)::int AS count FROM products p LEFT JOIN categories c ON c.id = p.category_id ${join} ${countWhere}`,
        bound,
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
       LIMIT $${bound.length + 1} OFFSET $${bound.length + 2}`;

      const rows = await pool.query(productSql, [...bound, limit, offset]);
      return { rows: rows.rows, total: count.rows[0]?.count || 0 };
    }

    // A pincode or a lat/lng pair narrows the catalog to the branches that serve
    // the shopper. If that resolution blows up, the storefront still gets a page
    // of products rather than a 500: fall back to the genuinely unfiltered
    // catalog (no branch condition and no bp.id IS NOT NULL), which is what the
    // shopper would have seen with no location at all.
    let catalog;
    try {
      catalog = await runCatalog(scoped ? ` AND ${branchConditions.join(" AND ")}` : "", scoped);
    } catch (error) {
      if (!scoped) throw error;
      console.error("Store products location filter failed, serving the unfiltered catalog:", error);
      catalog = await runCatalog("", false);
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
