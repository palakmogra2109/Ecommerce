import { corsHeaders } from "@/lib/cors";
import { reverseGeocode } from "@/lib/geocode";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url, process.env.APP_URL || "http://localhost:3000");
    const result = await reverseGeocode({
      lat: Number(searchParams.get("lat")),
      lng: Number(searchParams.get("lng")),
    });
    return Response.json({ success: true, result }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Reverse geocode error:", error);
    return Response.json(
      { success: false, message: "Location search is temporarily unavailable." },
      { status: 502, headers: corsHeaders() }
    );
  }
}
