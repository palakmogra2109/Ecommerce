import { corsHeaders } from "@/lib/cors";
import {
  Role,
  ROLE_STATUSES,
} from "@/lib/models/role";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, ROLE_SLUGS } from "@shared/constants";
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
    const auth = await authorize(KEY_PERMISSIONS.ROLES_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const role = await Role.findByUuid(id);

    if (!role) {
      return Response.json(
        {
          success: false,
          message: "Role not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    return Response.json(
      {
        success: true,
        role,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Get role error:", error);

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

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ROLES_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    const { name, slug, description, status } = body;

    const role = await Role.findByUuid(id);

    if (!role) {
      return Response.json(
        {
          success: false,
          message: "Role not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    if (role.slug === ROLE_SLUGS.SUPER_ADMIN) {
      return Response.json(
        {
          success: false,
          message: "Super admin role cannot be modified",
        },
        {
          status: 403,
          headers: corsHeaders(),
        }
      );
    }

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return Response.json(
        {
          success: false,
          message: "Name cannot be empty",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const newStatus =
      status !== undefined
        ? ROLE_STATUSES.includes(status)
          ? status
          : role.status
        : role.status;

    const updated = await Role.update(id, {
      name,
      slug,
      description,
      status: newStatus,
    });

    return Response.json(
      {
        success: true,
        message: "Role updated successfully",
        role: updated,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Update role error:", error);

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

export async function DELETE(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ROLES_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const role = await Role.findByUuid(id);

    if (!role) {
      return Response.json(
        {
          success: false,
          message: "Role not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    if (role.slug === ROLE_SLUGS.SUPER_ADMIN) {
      return Response.json(
        {
          success: false,
          message: "Super admin role cannot be deleted",
        },
        {
          status: 403,
          headers: corsHeaders(),
        }
      );
    }

    await Role.remove(id);

    return Response.json(
      {
        success: true,
        message: "Role deleted successfully",
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Delete role error:", error);

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