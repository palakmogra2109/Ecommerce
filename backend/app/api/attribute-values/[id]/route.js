import { corsHeaders } from "@/lib/cors";
import { AttributeType } from "@/lib/models/attribute";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, ATTRIBUTE_STATUSES } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

// A value is an attribute row with a parent_id, so this reads and writes the
// attributes table. See app/api/attribute-values/route.js for why it keeps its
// own path rather than being folded into /api/attributes.
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

    const value = await AttributeType.findByUuid(id);

    if (!value) {
      return Response.json(
        { success: false, message: "Attribute value not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, value },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get attribute value error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
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
    const current = await AttributeType.getInternalByUuid(id);

    if (!current) {
      return Response.json(
        { success: false, message: "Attribute value not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    if (body.status !== undefined && !ATTRIBUTE_STATUSES.includes(body.status)) {
      return Response.json(
        { success: false, message: "Invalid status" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Moving a value to another attribute, or renaming it in place, has to
    // re-check uniqueness against the NEW parent — "Black" may already exist
    // under the attribute it is being moved to.
    if (
      body.name !== undefined ||
      body.slug !== undefined ||
      body.parentUuid !== undefined
    ) {
      const targetParentUuid =
        body.parentUuid !== undefined ? body.parentUuid : current.parent_uuid;

      if (!targetParentUuid) {
        return Response.json(
          {
            success: false,
            message: "Select the attribute this value belongs to",
          },
          { status: 400, headers: corsHeaders() }
        );
      }

      const parent = await AttributeType.findByUuid(targetParentUuid);

      if (!parent) {
        return Response.json(
          { success: false, message: "Attribute not found" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const clash = await AttributeType.findByParentAndSlug(
        targetParentUuid,
        AttributeType.slugify(body.slug || body.name || current.name)
      );

      // The row's own current slug is not a clash with itself.
      if (clash && clash.uuid !== current.uuid) {
        return Response.json(
          {
            success: false,
            message: `"${body.name || current.name}" already exists under ${parent.name}`,
          },
          { status: 409, headers: corsHeaders() }
        );
      }
    }

    const value = await AttributeType.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.parentUuid !== undefined ? { parentUuid: body.parentUuid } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });

    return Response.json(
      { success: true, message: "Attribute value updated successfully", value },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update attribute value error:", error);

    if (String(error?.code) === "23505") {
      return Response.json(
        { success: false, message: "This value already exists under that attribute" },
        { status: 409, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: false, message: "Internal server error" },
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

    const removed = await AttributeType.remove(id);

    if (!removed) {
      return Response.json(
        { success: false, message: "Attribute value not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Attribute value deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete attribute value error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
