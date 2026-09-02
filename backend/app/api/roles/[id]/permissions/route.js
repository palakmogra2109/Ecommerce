import { corsHeaders } from "@/lib/cors";
import { Role } from "@/lib/models/role";
import { Permission } from "@/lib/models/permission";
import { RolePermission } from "@/lib/models/rolePermission";
import { authorizeAny } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(_request, { params }) {
  try {
    const auth = await authorizeAny([
      "roles.view",
      "roles.assign_permissions",
    ]);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const role = await Role.findById(id);

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

    const [permissions, selectedIds] = await Promise.all([
      Permission.list(),
      RolePermission.listPermissionIdsByRole(id),
    ]);

    return Response.json(
      {
        success: true,
        permissions,
        selected: selectedIds,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Get role permissions error:", error);

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

export async function PUT(request, { params }) {
  try {
    const auth = await authorize("roles.assign_permissions");

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const role = await Role.findById(id);

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

    const body = await request.json();

    const permissionIds = body.permissions;

    if (!Array.isArray(permissionIds)) {
      return Response.json(
        {
          success: false,
          message: "permissions must be an array",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const validIds = [];

    for (const permissionId of permissionIds) {
      const permission = await Permission.findById(permissionId);

      if (permission) {
        validIds.push(permissionId);
      }
    }

    await RolePermission.sync(id, validIds);

    return Response.json(
      {
        success: true,
        message: "Permissions updated successfully",
        selected: validIds,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Update role permissions error:", error);

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