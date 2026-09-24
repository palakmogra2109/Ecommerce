import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { createToken } from "@/lib/auth";
import { getUserAccess, getUserBranches } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, email, password, branchName, branchCode, city, address, phone } = body;

    if (!name || !email || !password) {
      return Response.json({ success: false, message: "Name, email and password are required" }, { status: 400, headers: corsHeaders() });
    }
    if (!branchName) {
      return Response.json({ success: false, message: "Branch name is required" }, { status: 400, headers: corsHeaders() });
    }
    if (password.length < 6) {
      return Response.json({ success: false, message: "Password must be at least 6 characters" }, { status: 400, headers: corsHeaders() });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rows.length > 0) {
      return Response.json({ success: false, message: "Email already registered" }, { status: 409, headers: corsHeaders() });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userResult = await pool.query(
      `INSERT INTO users (name, email, password, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id, uuid, name, email`,
      [name.trim(), normalizedEmail, hashedPassword]
    );
    const user = userResult.rows[0];

    const branchResult = await pool.query(
      `INSERT INTO branches (name, code, city, address, phone, email, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE') RETURNING *`,
      [
        branchName.trim(),
        branchCode || branchName.trim().substring(0, 6).toUpperCase(),
        city || "",
        address || "",
        phone || "",
        normalizedEmail,
      ]
    );
    const branch = branchResult.rows[0];

    await pool.query(
      `INSERT INTO branch_users (branchId, userId, role) VALUES ($1, $2, 'BRANCH_MANAGER')`,
      [branch.id, user.id]
    );

    // Grant the manager role when one exists, so the account has a role.
    await pool.query(
      `INSERT INTO user_has_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE slug IN ('branch_manager', 'manager', 'staff')
       ORDER BY CASE slug WHEN 'branch_manager' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END
       LIMIT 1
       ON CONFLICT DO NOTHING`,
      [user.id]
    );

    const tokenValue = await createToken(user);

    const [access, branches] = await Promise.all([
      getUserAccess(user.id),
      getUserBranches(user.id),
    ]);

    const headers = {
      ...corsHeaders(),
      "Set-Cookie": [
        `token=${tokenValue}`,
        "HttpOnly",
        "Path=/",
        "Max-Age=604800",
        "SameSite=Lax",
      ].join("; "),
    };

    return Response.json(
      {
        success: true,
        message: "Store registered successfully",
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
        branch: { uuid: branch.uuid, name: branch.name, code: branch.code, city: branch.city },
        token: tokenValue,
      },
      { status: 201, headers }
    );
  } catch (error) {
    console.error("Store registration error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}