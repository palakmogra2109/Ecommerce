import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Category } from "@/lib/models/category";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, CATEGORY_STATUSES } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.CATEGORIES_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    // ?all=1 returns the complete flat list (no pagination) for
    // dropdowns and tree builders.
    if (searchParams.get("all") === "1") {
      const categories = await Category.all({
        status: searchParams.get("status") ?? "",
      });

      return Response.json(
        { success: true, categories },
        { status: 200, headers: corsHeaders() }
      );
    }

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const parentUuid = searchParams.get("parent") ?? "";
    const type = searchParams.get("type") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: categories, pagination } = await Category.list({
      search,
      status,
      parentUuid,
      type,
      page,
      limit,
    });

    return Response.json(
      { success: true, categories, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List categories error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.CATEGORIES_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, slug, description, image, parentUuid, status, sortOrder, metaTitle, metaDescription } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        { success: false, message: "Name is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const finalSlug = Category.slugify(slug || name);

    const existing = await Category.findBySlug(finalSlug);

    if (existing) {
      return Response.json(
        { success: false, message: "A category with this slug already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }

    let parent = null;

    if (parentUuid) {
      parent = await Category.findByUuid(parentUuid);

      if (!parent) {
        return Response.json(
          { success: false, message: "Parent category not found" },
          { status: 400, headers: corsHeaders() }
        );
      }
    }

    const category = await Category.create({
      name,
      slug: finalSlug,
      description,
      image,
      parentUuid: parent?.uuid ?? null,
      status: status && CATEGORY_STATUSES.includes(status) ? status : "ACTIVE",
      sortOrder,
      metaTitle,
      metaDescription,
    });

    return Response.json(
      { success: true, message: "Category created successfully", category },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create category error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}