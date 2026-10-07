import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import {
  getMinimumOrderValue, setMinimumOrderValue, OrderSettingsError, formatMoney,
} from "@/lib/orderSettings";
import pool from "@/lib/db";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Read is open to any signed-in user because the cart needs it to show progress
// and block checkout. It exposes no more than the rule itself. Writing is gated
// on the same permission as every other settings change.
export async function GET() {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const rule = await getMinimumOrderValue();
    return Response.json(
      { success: true, minimumOrderValue: { ...rule, display: formatMoney(rule.amount) } },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Read minimum order value error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PUT(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SETTINGS_UPDATE);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const rule = await setMinimumOrderValue(body, auth.user?.id ?? null);

    // Keep the actor's email on the history row so the trail still reads sensibly
    // if the user row is ever removed.
    await pool.query(
      `UPDATE min_order_value_history SET changed_by_email = $1
        WHERE id = (SELECT max(id) FROM min_order_value_history)`,
      [auth.user?.email ?? null]
    );

    return Response.json(
      { success: true, minimumOrderValue: { ...rule, display: formatMoney(rule.amount) } },
      { headers: corsHeaders() }
    );
  } catch (error) {
    // A validation failure carries a message written for the admin filling the
    // form, so it is passed through rather than flattened into a 500.
    if (error instanceof OrderSettingsError) {
      return Response.json({ success: false, message: error.message }, { status: 422, headers: corsHeaders() });
    }
    console.error("Update minimum order value error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
