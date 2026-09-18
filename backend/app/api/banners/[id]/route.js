import { corsHeaders } from "@/lib/cors";
import { Banner } from "@/lib/models/banner";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, BANNER_POSITIONS } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.BANNERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const banner = await Banner.findByUuid(id);

    if (!banner) {
      return Response.json(
        { success: false, message: "Banner not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, banner },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get banner error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.BANNERS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    if (body.position !== undefined) {
      const positions = Object.values(BANNER_POSITIONS);

      if (!positions.includes(body.position)) {
        return Response.json(
          { success: false, message: "Invalid banner position" },
          { status: 400, headers: corsHeaders() }
        );
      }
    }

    const banner = await Banner.update(id, {
      title: body.title,
      subtitle: body.subtitle,
      image: body.image,
      link: body.link,
      position: body.position,
      sortOrder: body.sortOrder,
      status: body.status,
    });

    if (!banner) {
      return Response.json(
        { success: false, message: "Banner not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Banner updated successfully", banner },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update banner error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.BANNERS_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const banner = await Banner.findByUuid(id);

    if (!banner) {
      return Response.json(
        { success: false, message: "Banner not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    await Banner.remove(id);

    return Response.json(
      { success: true, message: "Banner deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete banner error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}