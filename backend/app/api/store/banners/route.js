import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";

export const runtime = "nodejs";

export const OPTIONS = () =>
  new Response(null, { status: 204, headers: corsHeaders() });

// Public storefront banners: only ACTIVE banners that fall within their
// scheduled window right now. Banners without a start/end date are always
// eligible, so a seller can leave the window empty for "run forever".
export async function GET(request) {
  try {
    const { searchParams } = new URL(
      request.url,
      process.env.APP_URL || "http://localhost:3000"
    );
    const position = (searchParams.get("position") || "").trim();

    const where = ["b.status = 'ACTIVE'"];
    const params = [];

    if (position) {
      params.push(position);
      where.push(`b.position = $${params.length}`);
    }

    const whereSql = `WHERE ${where.join(" AND ")} AND (
      (b.starts_at IS NULL OR b.starts_at <= now()) AND
      (b.ends_at   IS NULL OR b.ends_at   >= now())
    )`;

    const result = await pool.query(
      `SELECT b.uuid, b.title, b.subtitle, b.image, b.link,
              b.position, b.sort_order,
              b.starts_at, b.ends_at
       FROM banners b
       ${whereSql}
       ORDER BY b.position = 'hero' DESC, b.sort_order ASC, b.created_at DESC`,
      params
    );

    return Response.json(
      {
        success: true,
        banners: result.rows,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store banners error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
