import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Product } from "@/lib/models/product";
import { authorize } from "@/lib/authorization";
import {
  KEY_PERMISSIONS,
  PRODUCT_STATUSES,
  INVENTORY_MODES,
  slugify,
} from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    if (searchParams.get("all") === "1") {
      const products = await Product.all({
        status: searchParams.get("status") ?? "",
        search: searchParams.get("search") ?? "",
      });

      return Response.json(
        { success: true, products },
        { status: 200, headers: corsHeaders() }
      );
    }

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const categoryUuid = searchParams.get("category") ?? "";
    const brandUuid = searchParams.get("brand") ?? "";
    const featured = searchParams.get("featured") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: products, pagination } = await Product.list({
      search,
      status,
      categoryUuid,
      brandUuid,
      featured,
      page,
      limit,
    });

    return Response.json(
      { success: true, products, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List products error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const {
      name,
      slug,
      sku,
      shortDescription,
      description,
      price,
      discountPrice,
      stock,
      lowStockThreshold,
      brandUuid,
      categoryUuid,
      images,
      attributes,
      variants,
      featured,
      status,
      inventoryMode,
      pricingAttributeUuid,
      expiryDate,
      metaTitle,
      metaDescription,
      metaKeywords,
    } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        { success: false, message: "Name is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (price === undefined || price === null || price === "") {
      return Response.json(
        { success: false, message: "Price is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (inventoryMode !== undefined && !INVENTORY_MODES.includes(inventoryMode)) {
      return Response.json(
        { success: false, message: "Invalid inventory mode" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!isValidDate(expiryDate)) {
      return Response.json(
        { success: false, message: "Invalid expiry date" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const finalSlug = slugify(slug || name);

    const existing = await Product.findBySlug(finalSlug);

    if (existing) {
      return Response.json(
        { success: false, message: "A product with this slug already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }

    const finalStatus =
      status && PRODUCT_STATUSES.includes(status) ? status : "DRAFT";

    const product = await Product.create({
      name,
      slug: finalSlug,
      sku,
      shortDescription,
      description,
      price,
      discountPrice,
      stock,
      lowStockThreshold,
      brandUuid,
      categoryUuid,
      images,
      attributes,
      variants,
      featured,
      status: finalStatus,
      inventoryMode: inventoryMode || "SINGLE",
      pricingAttributeUuid: pricingAttributeUuid || null,
      expiryDate: expiryDate || null,
      metaTitle,
      metaDescription,
      metaKeywords,
    });

    return Response.json(
      { success: true, message: "Product created successfully", product },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create product error:", error);

    if (String(error?.code) === "23505") {
      return Response.json(
        { success: false, message: "A product with this slug already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// Accepts an empty/null value or a YYYY-MM-DD string.
function isValidDate(value) {
  if (value === undefined || value === null || value === "") {
    return true;
  }

  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}