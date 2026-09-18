import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { AttributeType } from "@/lib/models/attribute";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, ATTRIBUTE_STATUSES } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ATTRIBUTES_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    if (searchParams.get("all") === "1") {
      const attributes = await AttributeType.all({
        status: searchParams.get("status") ?? "",
      });

      return Response.json(
        { success: true, attributes },
        { status: 200, headers: corsHeaders() }
      );
    }

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: attributes, pagination } = await AttributeType.list({
      search,
      status,
      page,
      limit,
    });

    return Response.json(
      { success: true, attributes, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List attributes error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.ATTRIBUTES_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, slug, status } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        { success: false, message: "Name is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const finalSlug = AttributeType.slugify(slug || name);

    const existing = await AttributeType.findBySlug(finalSlug);

    if (existing) {
      return Response.json(
        { success: false, message: "An attribute with this slug already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }

    const attribute = await AttributeType.create({
      name,
      slug: finalSlug,
      status: status && ATTRIBUTE_STATUSES.includes(status) ? status : "ACTIVE",
    });

    return Response.json(
      { success: true, message: "Attribute created successfully", attribute },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create attribute error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}