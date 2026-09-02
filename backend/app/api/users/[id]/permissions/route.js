import { corsHeaders } from "@/lib/cors";
import { User } from "@/lib/models/user";
import { Permission } from "@/lib/models/permission";
import { UserPermission } from "@/lib/models/userPermission";
import { authorize } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(_request, { params }) {
  try {
    const auth = await authorize();

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const user = await User.findById(id);

    if (!user) {
      return Response.json(
        {
          success: false,
          message: "User not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    const [permissions, selected] = await Promise.all([
      Permission.list(),
      UserPermission.listPermissionIdsByUser(id),
    ]);

    return Response.json(
      {
        success: true,
        permissions,
        selected,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Get user permissions error:", error);

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
    const auth = await authorize();

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const user = await User.findById(id);

    if (!user) {
      return Response.json(
        {
          success: false,
          message: "User not found",
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

    await UserPermission.sync(id, validIds);

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
    console.error("Update user permissions error:", error);

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