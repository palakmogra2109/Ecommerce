import { corsHeaders } from "@/lib/cors";
import { productUsage, ProductInUseError } from "@/lib/productUsage";
import { Product } from "@/lib/models/product";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, PRODUCT_STATUSES, INVENTORY_MODES, slugify } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const product = await Product.findByUuid(id);

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
        }))
      : [];

    return Response.json(
      { success: true, product: { ...product, variants } },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get product error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
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

    // A product that has been ordered, stocked in a store or received against a
    // purchase invoice is history. Editing its details or flipping it between
    // ACTIVE and DRAFT would rewrite what those records appear to mean, so both
    // are refused with the reason.
    const usage = await productUsage(id);
    if (usage.isUsed) {
      throw new ProductInUseError(usage);
    }

    if (
      body.inventoryMode !== undefined &&
      !INVENTORY_MODES.includes(body.inventoryMode)
    ) {
      return Response.json(
        { success: false, message: "Invalid inventory mode" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!isValidDate(body.expiryDate)) {
      return Response.json(
        { success: false, message: "Invalid expiry date" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const updates = {
      name: body.name,
      slug: body.slug,
      sku: body.sku,
      shortDescription: body.shortDescription,
      description: body.description,
      price: body.price,
      discountPrice: body.discountPrice,
      stock: body.stock,
      lowStockThreshold: body.lowStockThreshold,
      brandUuid: body.brandUuid,
      categoryUuid: body.categoryUuid,
      images: body.images,
      attributes: body.attributes,
      variants: body.variants,
      featured: body.featured,
      status: body.status,
      inventoryMode: body.inventoryMode,
      pricingAttributeUuid: body.pricingAttributeUuid,
      expiryDate: body.expiryDate,
      metaTitle: body.metaTitle,
      metaDescription: body.metaDescription,
      metaKeywords: body.metaKeywords,
    };

    // Only pass through keys that were actually sent so partial PATCH
    // updates (e.g. a simple status toggle) cannot wipe other fields.
    const product = await Product.update(id, updates);

    if (!product) {
      return Response.json(
        { success: false, message: "Product not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Product updated successfully", product },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update product error:", error);

    if (error instanceof ProductInUseError) {
      return Response.json(
        { success: false, message: error.message, code: error.code, usage: error.usage },
        { status: 409, headers: corsHeaders() }
      );
    }

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

export async function DELETE(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const product = await Product.findByUuid(id);

    if (!product) {
      return Response.json(
        { success: false, message: "Product not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    // Refuse before removing anything. A product that other tables already point
    // at is history, and deleting it would silently rewrite those records.
    const usage = await productUsage(id);
    if (usage.isUsed) {
      throw new ProductInUseError(usage);
    }

    await Product.remove(id);

    return Response.json(
      { success: true, message: "Product deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete product error:", error);

    if (error instanceof ProductInUseError) {
      return Response.json(
        { success: false, message: error.message, code: error.code, usage: error.usage },
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