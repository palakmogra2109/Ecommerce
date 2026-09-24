import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { Branch } from "@/lib/models/branch";
import { User } from "@/lib/models/user";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Unlinks a store user from this branch.
export async function DELETE(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_UPDATE);
    if (!auth.ok) return auth.response;

    const { id, userUuid } = await params;
    if (!isValidUuid(id) || !isValidUuid(userUuid)) return invalidUuidResponse();

    const branch = await Branch.getInternalByUuid(id);
    if (!branch) {
      return Response.json(
        { success: false, message: "Branch not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const user = await User.getInternalByUuid(userUuid);
    if (!user) {
      return Response.json(
        { success: false, message: "User not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const result = await pool.query(
      `DELETE FROM branch_users WHERE branchid = $1 AND userid = $2 RETURNING id`,
      [branch.id, user.id]
    );

    if (result.rows.length === 0) {
      return Response.json(
        { success: false, message: "User is not linked to this branch" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Store user unlinked from branch" },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Branch users remove error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}