import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET() {
  try {
    const cookieStore = await cookies();

    const token = cookieStore.get("token")?.value;

    if (!token) {
      return Response.json(
        {
          success: false,
          message: "Not authenticated",
        },
        {
          status: 401,
          headers: corsHeaders(),
        }
      );
    }

    const payload = await verifyToken(token);

    const result = await pool.query(
      `
      SELECT id, name, email, created_at
      FROM users
      WHERE id = $1
      `,
      [payload.userId]
    );

    if (result.rows.length === 0) {
      return Response.json(
        {
          success: false,
          message: "User not found",
        },
        {
          status: 401,
          headers: corsHeaders(),
        }
      );
    }

    return Response.json(
      {
        success: true,
        user: result.rows[0],
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Auth error:", error);

    return Response.json(
      {
        success: false,
        message: "Invalid or expired token",
      },
      {
        status: 401,
        headers: corsHeaders(),
      }
    );
  }
}