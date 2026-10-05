import { corsHeaders } from "@/lib/cors";
import { Geo } from "@/lib/models/geo";
import { authorize } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Reference data for address pickers. Every signed-in user may read it: it is
// public geography, not business data, and gating it would only mean broken
// dropdowns for whoever lacked the grant. authorize() with no slug still
// requires a valid session.
export async function GET() {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const countries = await Geo.listCountries();
    return Response.json({ success: true, countries }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Geo countries error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
