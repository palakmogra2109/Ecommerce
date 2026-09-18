import { corsHeaders } from "@/lib/cors";
import { Brand } from "@/lib/models/brand";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, BRAND_STATUSES } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.BRANDS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { ids, status } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json(
        { success: false, message: "Select at least one brand" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!status || !BRAND_STATUSES.includes(status)) {
      return Response.json(
        { success: false, message: "Invalid status" },
        { status: 400, headers: corsHeaders() }
      );
    }

    let updated = 0;

    for (const id of ids) {
      if (!isValidUuid(String(id))) {
        continue;
      }

      const result = await Brand.update(String(id), { status });

      if (result) {
        updated += 1;
      }
    }

    return Response.json(
      {
        success: true,
        message: `${updated} brand(s) updated to ${status}`,
        updated,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Bulk brand status error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}