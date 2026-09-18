import { corsHeaders } from "@/lib/cors";
import { Brand } from "@/lib/models/brand";
import { Product } from "@/lib/models/product";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, BRAND_STATUSES } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.BRANDS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const brand = await Brand.findByUuid(id);

    if (!brand) {
      return Response.json(
        { success: false, message: "Brand not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, brand },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get brand error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.BRANDS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    const brand = await Brand.update(id, {
      name: body.name,
      slug: body.slug,
      description: body.description,
      logo: body.logo,
      status: body.status,
    });

    if (!brand) {
      return Response.json(
        { success: false, message: "Brand not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Brand updated successfully", brand },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update brand error:", error);

    if (String(error?.code) === "23505") {
      return Response.json(
        { success: false, message: "A brand with this slug already exists" },
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
    const auth = await authorize(KEY_PERMISSIONS.BRANDS_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const brand = await Brand.getInternalByUuid(id);

    if (!brand) {
      return Response.json(
        { success: false, message: "Brand not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const productCount = await Product.countByBrand(brand.id);

    if (productCount > 0) {
      return Response.json(
        {
          success: false,
          message: `This brand has ${productCount} product(s). Reassign or remove them first.`,
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    await Brand.remove(id);

    return Response.json(
      { success: true, message: "Brand deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete brand error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}