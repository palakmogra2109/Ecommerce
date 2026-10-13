import { corsHeaders } from "@/lib/cors";
import {
  productUsage,
  ProductInUseError,
  variantUsage,
  variantUsageMessage,
} from "@/lib/productUsage";
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

    // Which variants the edit form must not let the operator remove or renumber.
    // Sent with the product so the form can grey out exactly those rows instead
    // of locking the whole product — the same reason PATCH checks per variant.
    const lockedVariants = await variantUsage(id, variants);

    return Response.json(
      { success: true, product: { ...product, variants }, lockedVariants },
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

    // ── Per-variant history, not a blanket lock ──────────────────────────────
    //
    // This used to refuse the WHOLE update whenever the product had any usage
    // at all. With 30 variants and history on one of them, that froze all 30 —
    // the operator could not even add a new colour. The rule is now narrow:
    //
    //   adding a variant        -> always allowed
    //   removing a variant      -> refused only if that variant has history
    //   price / stock           -> refused only if that variant has history
    //   everything else         -> allowed
    //
    // Product-level history still blocks DELETE, which is unchanged.
    const stored = await Product.getInternalByUuid(id);
    const currentVariants = Array.isArray(stored?.variants) ? stored.variants : [];

    if (stored && body.variants !== undefined && Array.isArray(body.variants)) {
      const usage = await variantUsage(id, currentVariants);

      if (usage.length > 0) {
        // A variant survives if it is still submitted under any identifier it
        // is known by — the form round-trips uuid, but older rows may carry only
        // a sku or a name, so all three are accepted as "the same variant".
        const matchesFinding = (candidate, finding) => {
          const keys = [candidate?.uuid, candidate?.sku, candidate?.name].filter(
            (v) => typeof v === "string" && v.trim() !== ""
          );

          return keys.some(
            (key) =>
              key === finding.uuid || key === finding.sku || key === finding.name
          );
        };

        for (const finding of usage) {
          const next = body.variants.find((candidate) =>
            matchesFinding(candidate, finding)
          );

          if (!next) {
            throw new ProductInUseError({
              isUsed: true,
              reasons: [],
              total: finding.total,
              code: "VARIANT_IN_USE",
              message: variantUsageMessage(finding, "remove"),
            });
          }

          // Numbers that a purchase receipt already set.
          const previous = currentVariants.find((variant) =>
            matchesFinding(variant, finding)
          );

          const priceChanged =
            previous && Number(next.price ?? 0) !== Number(previous.price ?? 0);
          const stockChanged =
            previous && parseInt(next.stock, 10) !== parseInt(previous.stock, 10);

          if (priceChanged || stockChanged) {
            throw new ProductInUseError({
              isUsed: true,
              reasons: [],
              total: finding.total,
              code: "VARIANT_IN_USE",
              message: variantUsageMessage(
                finding,
                priceChanged ? "change the price of" : "change the stock of"
              ),
            });
          }
        }
      }
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