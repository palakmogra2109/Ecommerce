import { corsHeaders } from "@/lib/cors";
import { Category } from "@/lib/models/category";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, CATEGORY_STATUSES } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.CATEGORIES_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { ids, status } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json(
        { success: false, message: "Select at least one category" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!status || !CATEGORY_STATUSES.includes(status)) {
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

      const result = await Category.update(String(id), { status });

      if (result) {
        updated += 1;
      }
    }

    return Response.json(
      {
        success: true,
        message: `${updated} category(ies) updated to ${status}`,
        updated,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Bulk category status error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}