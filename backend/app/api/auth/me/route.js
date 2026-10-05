import { cookies, headers } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { getUserAccess, getUserBranches } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET() {
  try {
    const [headerStore, cookieStore] = await Promise.all([
      headers(),
      cookies(),
    ]);

    const authorization = headerStore.get("authorization");
    const bearerToken = authorization
      ?.replace(/^Bearer\s+/i, "")
      ?.trim();

    const token = bearerToken || cookieStore.get("token")?.value;

    if (!token) {
      return Response.json(
        {
          success: false,
          message: "Not authenticated",
        },
        {
          status: 401,
          headers: corsHeaders(),
        }
      );
    }

    const payload = await verifyToken(token);

    const result = await pool.query(
      `
      SELECT id, uuid, name, email, status, created_at
      FROM users
      WHERE id = $1
      `,
      [payload.userId]
    );

    if (result.rows.length === 0) {
      return Response.json(
        {
          success: false,
          message: "User not found",
        },
        {
          status: 401,
          headers: corsHeaders(),
        }
      );
    }

    const user = result.rows[0];

    // A token that was valid when it was issued is not a licence that outlives
    // the account. This is the endpoint the panel calls to RESTORE a session on
    // every page load, so without this check a user deactivated mid-session
    // simply reloads and stays signed in until the token's own 7 days run out.
    // Every other protected route already refuses via authenticate(); this one
    // verified the token itself and had forgotten the status.
    if (user.status !== "ACTIVE") {
      return Response.json(
        {
          success: false,
          message: "Account is inactive",
        },
        {
          status: 401,
          headers: corsHeaders(),
        }
      );
    }

    const [access, branches] = await Promise.all([
      getUserAccess(user.id),
      getUserBranches(user.id),
    ]);

    return Response.json(
      {
        success: true,
        user: {
          uuid: user.uuid,
          name: user.name,
          email: user.email,
          created_at: user.created_at,
          roles: access.roles,
          permissions: access.permissions,
          modules: access.modules,
          branches,
        },
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Auth error:", error);

    return Response.json(
      {
        success: false,
        message: "Invalid or expired token",
      },
      {
        status: 401,
        headers: corsHeaders(),
      }
    );
  }
}