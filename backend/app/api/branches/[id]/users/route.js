import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, USER_STATUS } from "@shared/constants";
import { Branch } from "@/lib/models/branch";
import { User } from "@/lib/models/user";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Branch store users: users with the store role linked to this branch,
// plus every store-role user not yet linked (candidates for the picker).
export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const branch = await Branch.getInternalByUuid(id);
    if (!branch) {
      return Response.json(
        { success: false, message: "Branch not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const [members, candidates] = await Promise.all([
      pool.query(
        `SELECT u.uuid, u.name, u.email, u.mobile, u.status,
                bu.role AS branch_role, bu.createdat AS linked_at
         FROM branch_users bu
         JOIN users u ON u.id = bu.userid
         WHERE bu.branchid = $1
         ORDER BY u.name ASC`,
        [branch.id]
      ),
      pool.query(
        `SELECT u.uuid, u.name, u.email
         FROM users u
         WHERE EXISTS (
           SELECT 1 FROM user_has_roles uhr
           JOIN roles r ON r.id = uhr.role_id
           WHERE uhr.user_id = u.id AND r.slug = 'store'
         )
         AND u.status = $1
         AND NOT EXISTS (
           SELECT 1 FROM branch_users bu2
           WHERE bu2.userid = u.id AND bu2.branchid = $2
         )
         ORDER BY u.name ASC`,
        [USER_STATUS.ACTIVE, branch.id]
      ),
    ]);

    return Response.json(
      {
        success: true,
        users: members.rows,
        candidates: candidates.rows,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Branch users get error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// Links an existing store-role user to this branch.
export async function POST(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_UPDATE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const branch = await Branch.getInternalByUuid(id);
    if (!branch) {
      return Response.json(
        { success: false, message: "Branch not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const body = await request.json();
    const { userUuid } = body || {};

    if (!userUuid || typeof userUuid !== "string" || !isValidUuid(userUuid)) {
      return Response.json(
        { success: false, message: "A valid userUuid is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const user = await User.getInternalByUuid(userUuid);
    if (!user) {
      return Response.json(
        { success: false, message: "User not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const hasStoreRole = await pool.query(
      `SELECT 1 FROM user_has_roles uhr
       JOIN roles r ON r.id = uhr.role_id
       WHERE uhr.user_id = $1 AND r.slug = 'store'`,
      [user.id]
    );

    if (hasStoreRole.rows.length === 0) {
      return Response.json(
        { success: false, message: "Only store users can be linked to a branch" },
        { status: 403, headers: corsHeaders() }
      );
    }

    const existing = await pool.query(
      `SELECT 1 FROM branch_users WHERE branchid = $1 AND userid = $2`,
      [branch.id, user.id]
    );

    if (existing.rows.length > 0) {
      return Response.json(
        { success: false, message: "User is already linked to this branch" },
        { status: 409, headers: corsHeaders() }
      );
    }

    await pool.query(
      `INSERT INTO branch_users (branchid, userid, role)
       VALUES ($1, $2, 'BRANCH_MANAGER')`,
      [branch.id, user.id]
    );

    return Response.json(
      { success: true, message: "Store user linked to branch" },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Branch users add error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}