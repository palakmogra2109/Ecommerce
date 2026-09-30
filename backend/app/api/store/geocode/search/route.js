import { corsHeaders } from "@/lib/cors";
import { searchLocations } from "@/lib/geocode";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url, process.env.APP_URL || "http://localhost:3000");
    const results = await searchLocations(searchParams.get("q") || "");
    return Response.json({ success: true, results }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Geocode search error:", error);
    return Response.json(
      { success: false, message: "Location search is temporarily unavailable." },
      { status: 502, headers: corsHeaders() }
    );
  }
}
