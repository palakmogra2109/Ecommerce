import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { Role, ROLE_STATUSES } from "@/lib/models/role";
import { authorize } from "@/lib/authorization";
import { ROLE_SLUGS } from "@shared/constants";
import { isValidUuid } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request) {
  try {
    const auth = await authorize();

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { ids, status } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json(
        {
          success: false,
          message: "At least one role id is required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    if (!ROLE_STATUSES.includes(status)) {
      return Response.json(
        {
          success: false,
          message: "Invalid status",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    // Frontend sends role uuids; resolve them to internal ids first
    // (same pattern as the users bulk-status route).
    const internalIds = [];

    for (const id of ids) {
      if (!isValidUuid(String(id))) {
        continue;
      }

      const internal = await Role.getInternalByUuid(String(id));

      if (internal) {
        internalIds.push(internal.id);
      }
    }

    if (internalIds.length === 0) {
      return Response.json(
        {
          success: false,
          message: "No valid role ids provided",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const result = await pool.query(
      `
      UPDATE roles
      SET status = $1, updated_at = now()
      WHERE id = ANY($2::bigint[])
        AND slug != $3
      `,
      [status, internalIds, ROLE_SLUGS.SUPER_ADMIN]
    );

    return Response.json(
      {
        success: true,
        message: `${result.rowCount} role(s) updated to ${status}`,
        updated: result.rowCount,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Bulk role status error:", error);

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