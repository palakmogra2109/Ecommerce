import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import pool from "@/lib/db";

export const runtime = "nodejs";

// Who changed the minimum, and when. Append-only: nothing here is ever updated
// or deleted, so the record of a change cannot itself be edited.
export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SETTINGS_VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const history = await pool.query(
      `SELECT id, uuid, previous_amount, new_amount, previous_enabled, new_enabled,
              changed_by, changed_by_email, note, created_at
         FROM min_order_value_history
        ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    return Response.json({ success: true, history: history.rows }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Minimum order value history error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
