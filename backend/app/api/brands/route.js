import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Brand } from "@/lib/models/brand";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, BRAND_STATUSES } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANDS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    if (searchParams.get("all") === "1") {
      const brands = await Brand.all({
        status: searchParams.get("status") ?? "",
      });

      return Response.json(
        { success: true, brands },
        { status: 200, headers: corsHeaders() }
      );
    }

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: brands, pagination } = await Brand.list({
      search,
      status,
      page,
      limit,
    });

    return Response.json(
      { success: true, brands, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List brands error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.BRANDS_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, slug, description, logo, status } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        { success: false, message: "Name is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const finalSlug = Brand.slugify(slug || name);

    const existing = await Brand.findBySlug(finalSlug);

    if (existing) {
      return Response.json(
        { success: false, message: "A brand with this slug already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }

    const brand = await Brand.create({
      name,
      slug: finalSlug,
      description,
      logo,
      status: status && BRAND_STATUSES.includes(status) ? status : "ACTIVE",
    });

    return Response.json(
      { success: true, message: "Brand created successfully", brand },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create brand error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}