import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Role, ROLE_STATUSES } from "@/lib/models/role";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ROLES_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: roles, pagination } = await Role.list({
      search,
      status,
      page,
      limit,
    });

    return Response.json(
      {
        success: true,
        roles,
        pagination,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("List roles error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      {
        status: 500,
        headers: corsHeaders(),
      }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ROLES_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, slug, description, status } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        {
          success: false,
          message: "Name is required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const roleStatus =
      status && ROLE_STATUSES.includes(status)
        ? status
        : "ACTIVE";

    const existingRole = await Role.findBySlug(slug || name);

    if (existingRole) {
      return Response.json(
        {
          success: false,
          message: "Role already exists",
        },
        {
          status: 409,
          headers: corsHeaders(),
        }
      );
    }

    const role = await Role.create({
      name,
      slug,
      description,
      status: roleStatus,
    });

    return Response.json(
      {
        success: true,
        message: "Role created successfully",
        role,
      },
      {
        status: 201,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Create role error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      {
        status: 500,
        headers: corsHeaders(),
      }
    );
  }
}