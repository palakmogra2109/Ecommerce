import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Banner } from "@/lib/models/banner";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, BANNER_STATUSES, BANNER_POSITIONS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BANNERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const position = searchParams.get("position") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: banners, pagination } = await Banner.list({
      search,
      status,
      position,
      page,
      limit,
    });

    return Response.json(
      { success: true, banners, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List banners error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.BANNERS_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { title, subtitle, image, link, position, sortOrder, status } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return Response.json(
        { success: false, message: "Title is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!image || typeof image !== "string" || !image.trim()) {
      return Response.json(
        { success: false, message: "Banner image is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const positions = Object.values(BANNER_POSITIONS);
    const finalPosition = position ?? "hero";

    if (!positions.includes(finalPosition)) {
      return Response.json(
        { success: false, message: "Invalid banner position" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const banner = await Banner.create({
      title,
      subtitle,
      image,
      link: link ?? null,
      position: finalPosition,
      sortOrder: sortOrder === undefined ? 1 : parseInt(sortOrder, 10) || 1,
      status: status && BANNER_STATUSES.includes(status) ? status : "ACTIVE",
    });

    return Response.json(
      { success: true, message: "Banner created successfully", banner },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create banner error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}