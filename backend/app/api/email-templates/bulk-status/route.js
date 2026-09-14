import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { EMAIL_TEMPLATE_STATUSES } from "@/lib/models/emailTemplate";
import { authorize } from "@/lib/authorization";
import { EMAIL_TEMPLATE_PERMISSIONS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request) {
  try {
    const auth = await authorize(EMAIL_TEMPLATE_PERMISSIONS.UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { ids, status } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json(
        {
          success: false,
          message: "At least one template id is required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    if (!EMAIL_TEMPLATE_STATUSES.includes(status)) {
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

    const result = await pool.query(
      `
      UPDATE email_templates
      SET status = $1, updated_at = now()
      WHERE id = ANY($2::bigint[])
      `,
      [status, ids.map(Number)]
    );

    return Response.json(
      {
        success: true,
        message: `${result.rowCount} template(s) updated to ${status}`,
        updated: result.rowCount,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Bulk email template status error:", error);

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