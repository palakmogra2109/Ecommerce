import { corsHeaders } from "@/lib/cors";
import { Product } from "@/lib/models/product";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid } from "@/lib/uuid";

export const runtime = "nodejs";

const MAX_ITEMS = 500;

function toNumber(value) {
  const num = Number(value);

  return Number.isFinite(num) ? num : null;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json(
        { success: false, message: "No products to update" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (items.length > MAX_ITEMS) {
      return Response.json(
        {
          success: false,
          message: `You can update at most ${MAX_ITEMS} products at once`,
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    const clean = [];

    for (const item of items) {
      if (!item || typeof item !== "object" || !isValidUuid(String(item.uuid))) {
        continue;
      }

      const entry = { uuid: String(item.uuid) };

      if (item.price !== undefined) {
        const price = toNumber(item.price);

        if (price === null || price < 0) {
          return Response.json(
            { success: false, message: "Price must be a positive number" },
            { status: 400, headers: corsHeaders() }
          );
        }

        entry.price = price;
      }

      if (item.discountPrice !== undefined) {
        if (item.discountPrice === null || item.discountPrice === "") {
          entry.discountPrice = null;
        } else {
          const discountPrice = toNumber(item.discountPrice);

          if (discountPrice === null || discountPrice < 0) {
            return Response.json(
              {
                success: false,
                message: "Discount price must be a positive number",
              },
              { status: 400, headers: corsHeaders() }
            );
          }

          entry.discountPrice = discountPrice;
        }
      }

      if (item.stock !== undefined) {
        const stock = toNumber(item.stock);

        if (stock === null || stock < 0) {
          return Response.json(
            { success: false, message: "Stock must be a positive number" },
            { status: 400, headers: corsHeaders() }
          );
        }

        entry.stock = Math.floor(stock);
      }

      if (item.lowStockThreshold !== undefined) {
        const threshold = toNumber(item.lowStockThreshold);

        if (threshold === null || threshold < 0) {
          return Response.json(
            {
              success: false,
              message: "Low stock threshold must be a positive number",
            },
            { status: 400, headers: corsHeaders() }
          );
        }

        entry.lowStockThreshold = Math.floor(threshold);
      }

      if (item.variants !== undefined) {
        if (!Array.isArray(item.variants)) {
          return Response.json(
            { success: false, message: "Variants must be an array" },
            { status: 400, headers: corsHeaders() }
          );
        }

        entry.variants = item.variants;
      }

      clean.push(entry);
    }

    if (clean.length === 0) {
      return Response.json(
        { success: false, message: "No valid products to update" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const { updated } = await Product.bulkUpdateInventory(clean);

    return Response.json(
      {
        success: true,
        message: `${updated} product(s) updated`,
        updated,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Bulk product inventory error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}
