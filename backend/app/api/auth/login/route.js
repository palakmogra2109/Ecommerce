import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { createToken } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { getUserAccess, getUserBranches } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request) {
  try {
    const body = await request.json();

    const { email, password } = body;

    if (!email || !password) {
      return Response.json(
        {
          success: false,
          message: "Email and password are required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    const result = await pool.query(
      `
      SELECT id, uuid, name, email, password, created_at
      FROM users
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return Response.json(
        {
          success: false,
          message: "Invalid email or password",
        },
        {
          status: 401,
          headers: corsHeaders(),
        }
      );
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return Response.json(
        {
          success: false,
          message: "Invalid email or password",
        },
        {
          status: 401,
          headers: corsHeaders(),
        }
      );
    }

    const token = await createToken(user);

    const [access, branches] = await Promise.all([
      getUserAccess(user.id),
      getUserBranches(user.id),
    ]);

    const headers = {
      ...corsHeaders(),

      "Set-Cookie": [
        `token=${token}`,
        "HttpOnly",
        "Path=/",
        "Max-Age=604800",
        "SameSite=Lax",
      ].join("; "),
    };

    return Response.json(
      {
        success: true,
        message: "Login successful",
        user: {
          uuid: user.uuid,
          name: user.name,
          email: user.email,
          created_at: user.created_at,
          roles: access.roles,
          permissions: access.permissions,
          modules: access.modules,
          branches,
        },
      },
      {
        status: 200,
        headers,
      }
    );
  } catch (error) {
    console.error("Login error:", error);

    return Response.json(
      {
        success: false,
        message: "Internal server error",
      },
      {
        status: 500,
        headers: corsHeaders(),
      }
    );
  }
}