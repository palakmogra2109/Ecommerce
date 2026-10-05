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
    const { rows: cities, truncated } = await Geo.listCities({
      stateUuid: searchParams.get("state") || null,
      countryUuid: searchParams.get("country") || null,
      search: searchParams.get("search") || "",
      limit: parseInt(searchParams.get("limit") || "50", 10),
      // One row past the page, so `truncated` is a fact rather than a guess from
      // a hardcoded row count.
      overfetch: true,
    });
    // `truncated` tells the picker to offer a search box rather than presenting a
    // partial list as though it were complete.
    return Response.json(
      { success: true, cities, total: cities.length, truncated },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Geo cities error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
