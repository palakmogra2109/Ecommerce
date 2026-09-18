import { corsHeaders } from "@/lib/cors";
import { Category } from "@/lib/models/category";
import { Product } from "@/lib/models/product";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, CATEGORY_STATUSES } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.CATEGORIES_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const category = await Category.findByUuid(id);

    if (!category) {
      return Response.json(
        { success: false, message: "Category not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, category },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get category error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.CATEGORIES_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    const category = await Category.update(id, {
      name: body.name,
      slug: body.slug,
      description: body.description,
      image: body.image,
      status: body.status,
      sortOrder: body.sortOrder,
      metaTitle: body.metaTitle,
      metaDescription: body.metaDescription,
      parentUuid: body.parentUuid,
    });

    if (!category) {
      return Response.json(
        { success: false, message: "Category not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Category updated successfully", category },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update category error:", error);

    if (String(error?.code) === "23505") {
      return Response.json(
        { success: false, message: "A category with this slug already exists" },
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
    const auth = await authorize(KEY_PERMISSIONS.CATEGORIES_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const category = await Category.getInternalByUuid(id);

    if (!category) {
      return Response.json(
        { success: false, message: "Category not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const productCount = await Product.countByCategory(category.id);

    const remaining = await Category.update(id, { parentUuid: null });

    if (productCount > 0) {
      return Response.json(
        {
          success: false,
          message: `This category has ${productCount} product(s). Reassign or remove them first.`,
          remaining,
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    await Category.remove(id);

    return Response.json(
      { success: true, message: "Category deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete category error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}