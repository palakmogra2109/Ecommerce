import { corsHeaders } from "@/lib/cors";
import { AttributeType } from "@/lib/models/attribute";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, ATTRIBUTE_STATUSES } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.ATTRIBUTES_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const attribute = await AttributeType.findByUuid(id);

    if (!attribute) {
      return Response.json(
        { success: false, message: "Attribute not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, attribute },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get attribute error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.ATTRIBUTES_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    const attribute = await AttributeType.update(id, {
      name: body.name,
      slug: body.slug,
      status: body.status,
    });

    if (!attribute) {
      return Response.json(
        { success: false, message: "Attribute not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Attribute updated successfully", attribute },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update attribute error:", error);

    if (String(error?.code) === "23505") {
      return Response.json(
        { success: false, message: "An attribute with this slug already exists" },
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
    const auth = await authorize(KEY_PERMISSIONS.ATTRIBUTES_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const attribute = await AttributeType.findByUuid(id);

    if (!attribute) {
      return Response.json(
        { success: false, message: "Attribute not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    await AttributeType.remove(id);

    return Response.json(
      { success: true, message: "Attribute deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete attribute error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}