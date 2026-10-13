import { corsHeaders } from "@/lib/cors";
import { AttributeType } from "@/lib/models/attribute";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, ATTRIBUTE_STATUSES } from "@shared/constants";
import { isValidUuid } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ATTRIBUTES_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();
    const { ids, status } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json(
        { success: false, message: "Select at least one value" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!status || !ATTRIBUTE_STATUSES.includes(status)) {
      return Response.json(
        { success: false, message: "Invalid status" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Invalid uuids are skipped rather than aborting the batch, so one bad id
    // cannot leave the operator with no idea whether anything happened.
    const valid = ids.map(String).filter((id) => isValidUuid(id));

    if (valid.length === 0) {
      return Response.json(
        { success: false, message: "No valid values selected" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const updated = await AttributeType.bulkStatus(valid, status);

    return Response.json(
      {
        success: true,
        message: `${updated} value(s) ${status === "ACTIVE" ? "activated" : "deactivated"}`,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Bulk status attribute values error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
