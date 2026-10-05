import { corsHeaders } from "@/lib/cors";
import { Geo } from "@/lib/models/geo";
import { authorize } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const states = await Geo.listStates({
      countryUuid: searchParams.get("country") || null,
      search: searchParams.get("search") || "",
      limit: parseInt(searchParams.get("limit") || "600", 10),
    });
    return Response.json({ success: true, states }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Geo states error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
