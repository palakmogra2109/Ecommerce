import { cookies } from "next/headers";
import { verifyToken } from "./auth";
import { corsHeaders } from "./cors";
import pool from "./db";
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

    // Internal lookup by the integer id carried in the JWT. The integer
    // id is never sent to any client; it only exists inside the session.
    const user = await User.getInternalById(payload.userId);

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

// Branches the user belongs to (via branch_users), surfaced in the
// auth/user payloads so the store panel knows which store to manage.
export async function getUserBranches(userId) {
  const result = await pool.query(
    `SELECT b.uuid, b.name, b.code, b.city, b.phone, b.email, b.status,
            COALESCE(b.onboarding_completed, FALSE) AS onboarding_completed
     FROM branch_users bu
     JOIN branches b ON b.id = bu.branchId
     WHERE bu.userId = $1 AND b.status = 'ACTIVE'
     ORDER BY b.name ASC`,
    [userId]
  );
  return result.rows.map((r) => ({
    uuid: r.uuid,
    name: r.name,
    code: r.code,
    city: r.city,
    phone: r.phone,
    email: r.email,
    status: r.status,
    onboardingCompleted: Boolean(r.onboarding_completed),
  }));
}

// Authenticates the request and verifies the given branch uuid belongs
// to the current user. Returns { ok:true, user, branchId, branch } on
// success or { ok:false, response } when access is denied.
export async function requireBranchAccess(branchUuid) {
  const auth = await authenticate();

  if (!auth.ok) {
    return auth;
  }

  if (!branchUuid || typeof branchUuid !== "string") {
    return {
      ok: false,
      response: Response.json(
        { success: false, message: "branchId is required" },
        { status: 400, headers: corsHeaders() }
      ),
    };
  }

  const result = await pool.query(
    `SELECT b.id, b.uuid, b.name, b.code
     FROM branch_users bu
     JOIN branches b ON b.id = bu.branchId
     WHERE bu.userId = $1 AND b.uuid = $2 AND b.status = 'ACTIVE'`,
    [auth.user.id, branchUuid]
  );

  if (result.rows.length === 0) {
    return {
      ok: false,
      response: Response.json(
        { success: false, message: "Store not found for this account" },
        { status: 403, headers: corsHeaders() }
      ),
    };
  }

  return {
    ok: true,
    user: auth.user,
    branchId: result.rows[0].id,
    branch: result.rows[0],
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