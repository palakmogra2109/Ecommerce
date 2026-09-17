import { corsHeaders } from "@/lib/cors";
import { User } from "@/lib/models/user";
import { Permission } from "@/lib/models/permission";
import { UserPermission } from "@/lib/models/userPermission";
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

function notFound(message) {
  return Response.json(
    {
      success: false,
      message,
    },
    {
      status: 404,
      headers: corsHeaders(),
    }
  );
}

export async function GET(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.USERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const user = await User.findByUuid(id);

    if (!user) {
      return notFound("User not found");
    }

    const internal = await User.getInternalByUuid(id);

    if (!internal) {
      return notFound("User not found");
    }

    const [{ rows: permissions }, selected] = await Promise.all([
      Permission.list({ limit: 200 }),
      UserPermission.listPermissionIdsByUser(internal.id),
    ]);

    return Response.json(
      {
        success: true,
        user,
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
    const auth = await authorize(KEY_PERMISSIONS.USERS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const user = await User.findByUuid(id);

    if (!user) {
      return notFound("User not found");
    }

    const internal = await User.getInternalByUuid(id);

    if (!internal) {
      return notFound("User not found");
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

    const validUuids = [];
    const validIds = [];

    for (const permissionUuid of permissionIds) {
      if (!isValidUuid(String(permissionUuid))) {
        continue;
      }

      const internalPerm =
        await Permission.getInternalByUuid(permissionUuid);

      if (internalPerm) {
        validUuids.push(permissionUuid);
        validIds.push(internalPerm.id);
      }
    }

    await UserPermission.sync(internal.id, validIds);

    return Response.json(
      {
        success: true,
        message: "Permissions updated successfully",
        selected: validUuids,
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
