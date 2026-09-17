import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Role } from "@/lib/models/role";
import { UserRole } from "@/lib/models/userRole";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.USERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const internal = await Role.getInternalByUuid(id);

    if (!internal) {
      return Response.json(
        { success: false, message: "Role not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const roleId = internal.id;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: users, pagination } = await UserRole.listByRole(
      roleId,
      { search, page, limit }
    );

    return Response.json(
      {
        success: true,
        role: { id: internal.id, name: internal.name, slug: internal.slug },
        users,
        pagination,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List role users error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
