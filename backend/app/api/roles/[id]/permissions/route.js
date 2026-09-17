import { corsHeaders } from "@/lib/cors";
import { Role } from "@/lib/models/role";
import { Permission } from "@/lib/models/permission";
import { RolePermission } from "@/lib/models/rolePermission";
import { authorize, authorizeAny } from "@/lib/authorization";
import { KEY_PERMISSIONS, ROLE_SLUGS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function rolePermissionsError() {
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

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const roleInternal = await Role.getInternalByUuid(id);

    if (!roleInternal) {
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

    const [{ rows: permissions }, selectedIds] = await Promise.all([
      Permission.list({ limit: 100 }),
      RolePermission.listPermissionIdsByRole(roleInternal.id),
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

    return rolePermissionsError();
  }
}

export async function PUT(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.ROLES_ASSIGN_PERMISSIONS);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const roleInternal = await Role.getInternalByUuid(id);

    if (!roleInternal) {
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

    if (roleInternal.slug === ROLE_SLUGS.SUPER_ADMIN) {
      return Response.json(
        {
          success: false,
          message: "Super admin permissions cannot be changed",
        },
        {
          status: 403,
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

    const validUuids = [];
    const validIds = [];
    const knownSlugs = new Set();
    const selectedModules = new Set();

    for (const permissionUuid of permissionIds) {
      if (!isValidUuid(String(permissionUuid))) {
        continue;
      }

      const internal =
        await Permission.getInternalByUuid(permissionUuid);

      if (internal) {
        validUuids.push(permissionUuid);
        validIds.push(internal.id);
        knownSlugs.add(internal.slug);
        selectedModules.add(internal.module);
      }
    }

    // Selecting any permission implies its `<module>.view` permission:
    // auto-add it so a role can never hold create/update/delete
    // without view. (`permissions.view` is intentionally excluded —
    // it is not assignable.)
    for (const moduleName of selectedModules) {
      const viewSlug = `${moduleName}.view`;

      if (viewSlug === "permissions.view") {
        continue;
      }

      if (knownSlugs.has(viewSlug)) {
        continue;
      }

      const view = await Permission.findBySlug(viewSlug);

      if (view) {
        const viewInternal =
          await Permission.getInternalByUuid(view.uuid);

        if (viewInternal) {
          validUuids.push(viewInternal.uuid);
          validIds.push(viewInternal.id);
          knownSlugs.add(viewSlug);
        }
      }
    }

    await RolePermission.sync(roleInternal.id, validIds);

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
    console.error("Update role permissions error:", error);

    return rolePermissionsError();
  }
}
