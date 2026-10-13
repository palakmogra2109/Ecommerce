import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { AttributeType } from "@/lib/models/attribute";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, ATTRIBUTE_STATUSES } from "@shared/constants";

// Attribute values are not a separate entity. A value is an attribute row whose
// parent_id points at another attribute ("Black" -> Colour), so this endpoint is
// a filtered view over the same table the /attributes endpoint uses:
//
//   GET  /api/attribute-values            -> rows with a parent
//   GET  /api/attribute-values?all=1      -> same, unpaged, for dropdowns
//   POST /api/attribute-values            -> create a row WITH a parent
//
// It keeps its own path because the sidebar and the product form both address
// values separately from attributes, and reusing the one route would mean every
// caller had to remember to pass ?type=value.
//
// Permissions are the ATTRIBUTES_* ones because it is the same data.
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
      const { rows } = await AttributeType.list({
        status: searchParams.get("status") ?? "",
        type: "value",
        parentUuid: searchParams.get("parent") ?? "",
        limit: 500,
      });

      return Response.json(
        { success: true, values: rows },
        { status: 200, headers: corsHeaders() }
      );
    }

    const { rows: values, pagination } = await AttributeType.list({
      search: searchParams.get("search") ?? "",
      status: searchParams.get("status") ?? "",
      type: "value",
      parentUuid: searchParams.get("parent") ?? "",
      ...parsePagination(searchParams),
    });

    return Response.json(
      { success: true, values, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List attribute values error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
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
    const { name, slug, parentUuid, status } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        { success: false, message: "Value name is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // A value with no parent is just an attribute, which is what the Attributes
    // screen creates. Posting one here without a parent is almost always a
    // mis-filled form, so it is refused rather than silently creating one.
    if (!parentUuid) {
      return Response.json(
        {
          success: false,
          message: "Select the attribute this value belongs to",
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    const parent = await AttributeType.findByUuid(parentUuid);

    if (!parent) {
      return Response.json(
        { success: false, message: "Attribute not found" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const clash = await AttributeType.findByParentAndSlug(
      parentUuid,
      AttributeType.slugify(slug || name)
    );

    if (clash) {
      return Response.json(
        { success: false, message: `"${name}" already exists under ${parent.name}` },
        { status: 409, headers: corsHeaders() }
      );
    }

    const value = await AttributeType.create({
      name,
      slug,
      parentUuid: parent.uuid,
      status: status && ATTRIBUTE_STATUSES.includes(status) ? status : "ACTIVE",
    });

    return Response.json(
      { success: true, message: "Attribute value created successfully", value },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create attribute value error:", error);

    // The per-parent unique index, reached when two writes race past the check.
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
