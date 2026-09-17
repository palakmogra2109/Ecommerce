import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request) {
  try {
    // Parse JSON
    const body = await request.json();

    const { name, email, password } = body;

    // Validate types
    if (
      (name !== undefined && name !== null && typeof name !== "string") ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return Response.json(
        {
          success: false,
          message: "Name, email and password must be strings",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    // Remove unnecessary spaces
    const cleanName = (name && name.trim()) || "";
    const normalizedEmail = email.toLowerCase().trim();

    // Validate required fields
    if (!normalizedEmail || !password) {
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

    // Validate password
    if (password.length < 6) {
      return Response.json(
        {
          success: false,
          message: "Password must be at least 6 characters",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    // Check existing user
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      return Response.json(
        {
          success: false,
          message: "Email is already registered",
        },
        {
          status: 409,
          headers: corsHeaders(),
        }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const result = await pool.query(
      `
      INSERT INTO users (name, email, password)
      VALUES ($1, $2, $3)
      RETURNING uuid, name, email, created_at
      `,
      [cleanName, normalizedEmail, hashedPassword]
    );

    const user = result.rows[0];

    return Response.json(
      {
        success: true,
        message: "Registration successful",
        user,
      },
      {
        status: 201,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Register error:", error);

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