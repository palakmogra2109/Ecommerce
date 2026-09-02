import { cookies } from "next/headers";
import { verifyToken } from "./auth";
import { corsHeaders } from "./cors";
import { User } from "./models/user";
import { UserRole } from "./models/userRole";

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

function forbidden(message) {
  return {
    ok: false,
    response: Response.json(
      { success: false, message },
      { status: 403, headers: corsHeaders() }
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

    if (!user || user.status !== "ACTIVE") {
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

// Requires a single permission.
export async function authorize(permissionSlug) {
  const auth = await authenticate();

  if (!auth.ok) {
    return auth;
  }

  const slugs = await getUserPermissionSlugs(auth.user.id);

  if (!slugs.includes(permissionSlug)) {
    return forbidden("You do not have permission to perform this action");
  }

  return { ok: true, user: auth.user };
}

// Requires any of the given permissions.
export async function authorizeAny(permissionSlugs) {
  const auth = await authenticate();

  if (!auth.ok) {
    return auth;
  }

  const slugs = await getUserPermissionSlugs(auth.user.id);

  if (!permissionSlugs.some((slug) => slugs.includes(slug))) {
    return forbidden("You do not have permission to perform this action");
  }

  return { ok: true, user: auth.user };
}