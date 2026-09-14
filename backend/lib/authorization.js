import { cookies } from "next/headers";
import { verifyToken } from "./auth";
import { corsHeaders } from "./cors";
import { User } from "./models/user";
import { UserRole } from "./models/userRole";
import { UserPermission } from "./models/userPermission";
import { Module } from "./models/module";
import { USER_STATUS } from "@shared/constants";

// 401 response with message
function unauthorized(message) {
  return {
    ok: false,
    response: Response.json(
      { success: false, message },
      { status: 401, headers: corsHeaders() }
    ),
  };
}

// Reads the request cookie, verifies the JWT and returns the user.
// Returns { ok:false, response } if not authenticated.
export async function authenticate() {
  try {
    const cookieStore = await cookies();

    const token = cookieStore.get("token")?.value;

    if (!token) {
      return unauthorized("Not authenticated");
    }

    const payload = await verifyToken(token);

    const user = await User.findById(payload.userId);

    if (!user || user.status !== USER_STATUS.ACTIVE) {
      return unauthorized("Account is inactive");
    }

    return {
      ok: true,
      user,
    };
  } catch {
    return unauthorized("Invalid or expired token");
  }
}

// Resolves the user's effective permission slugs from their roles.
export async function getUserPermissionSlugs(userId) {
  return await UserRole.listPermissionSlugsByUser(userId);
}

// Resolves the user's role slugs.
export async function getUserRoleSlugs(userId) {
  return await UserRole.listRoleSlugsByUser(userId);
}

// Bundles everything the sidebar needs for a user:
// role slugs, permission slugs (role + per-user) and accessible modules.
export async function getUserAccess(userId) {
  const [roles, permissions, userPermissions, modules] =
    await Promise.all([
      UserRole.listRoleSlugsByUser(userId),
      UserRole.listPermissionSlugsByUser(userId),
      UserPermission.listPermissionSlugsByUser(userId),
      Module.listByUser(userId),
    ]);

  return {
    roles,
    permissions: [...new Set([...permissions, ...userPermissions])],
    modules,
  };
}

// Requires a single permission.
// Permissions are currently not enforced: any logged-in user
// (including super admin) can perform any action.
export async function authorize() {
  return authenticate();
}

// Requires any of the given permissions.
// Same as authorize: only authentication is enforced for now.
export async function authorizeAny() {
  return authenticate();
}