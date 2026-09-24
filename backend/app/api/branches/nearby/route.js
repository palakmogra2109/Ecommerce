import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { Branch } from "@/lib/models/branch";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get("lat") || "0");
    const lng = parseFloat(searchParams.get("lng") || "0");
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const radius = parseFloat(searchParams.get("radius") || "50");

    if (lat === 0 && lng === 0) {
      return Response.json({ success: true, branches: [], message: "Provide lat and lng query parameters" }, { headers: corsHeaders() });
    }

    const earthRadius = 6371;
    const maxLat = radius / 111.32;
    const maxLng = radius / (111.32 * Math.cos(lat * Math.PI / 180));

    const result = await pool.query(
      `
      SELECT b.*,
        (
          6371 * acos(
            least(greatest(
              cos(radians($1)) * cos(radians(b.latitude)) * cos(radians(b.longitude) - radians($2)) +
              sin(radians($1)) * sin(radians(b.latitude)),
            -1), 1)
          )
        ) AS distance_km
      FROM branches b
      WHERE b.status = 'ACTIVE'
        AND b.latitude IS NOT NULL
        AND b.longitude IS NOT NULL
        AND b.latitude BETWEEN $1 - $3 AND $1 + $3
        AND b.longitude BETWEEN $2 - $4 AND $2 + $4
        AND b.deliveryEnabled = TRUE
      HAVING (
        6371 * acos(
          least(greatest(
            cos(radians($1)) * cos(radians(b.latitude)) * cos(radians(b.longitude) - radians($2)) +
            sin(radians($1)) * sin(radians(b.latitude)),
          -1), 1)
        )
      ) <= $5
      ORDER BY distance_km ASC
      LIMIT $6
      `,
      [lat, lng, maxLat, maxLng, radius, limit]
    );

    const branches = result.rows.map((b) => ({
      ...b,
      distance_km: parseFloat(b.distance_km),
    }));

    return Response.json({ success: true, branches }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Nearby branches error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
