import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { createToken } from "@/lib/auth";
import { getUserAccess, getUserBranches } from "@/lib/authorization";
import { USER_STATUS } from "@shared/constants";
import {
  MAX_OTP_ATTEMPTS,
  isOtpExpired,
  mobileVariants,
  normalizeMobile,
  verifyOtpHash,
} from "@/lib/otp";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Verifies a login OTP and signs the shopper in. The response mirrors
// /api/auth/login (token + user with roles/permissions/modules/branches,
// plus mobile) so the storefront treats both sessions identically.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const identifier = normalizeMobile(body?.mobile);
    const code = String(body?.otp ?? "").trim();

    if (!identifier) {
      return Response.json(
        { success: false, message: "Mobile number is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!/^\d{6}$/.test(code)) {
      return Response.json(
        { success: false, message: "Enter the 6-digit code" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const codeResult = await pool.query(
      `SELECT id, code_hash, attempts, expires_at FROM otp_codes
       WHERE identifier = $1 AND purpose = 'login' AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [identifier]
    );
    const row = codeResult.rows[0];

    if (!row) {
      return Response.json(
        { success: false, message: "No active code. Request a new one." },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (isOtpExpired(row) || row.attempts >= MAX_OTP_ATTEMPTS) {
      await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [row.id]);
      return Response.json(
        {
          success: false,
          message:
            row.attempts >= MAX_OTP_ATTEMPTS
              ? "Too many wrong attempts. Request a new code."
              : "This code has expired. Request a new one.",
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!verifyOtpHash(code, row.code_hash)) {
      await pool.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      return Response.json(
        { success: false, message: "Incorrect code. Try again." },
        { status: 400, headers: corsHeaders() }
      );
    }

    await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [row.id]);

    const userResult = await pool.query(
      `SELECT id, uuid, name, email, mobile, status, created_at FROM users
       WHERE mobile = ANY($1) AND status = $2`,
      [mobileVariants(identifier), USER_STATUS.ACTIVE]
    );
    const user = userResult.rows[0];

    if (!user) {
      return Response.json(
        { success: false, message: "Account not found. Request a new code." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const token = await createToken(user);
    const [access, branches] = await Promise.all([
      getUserAccess(user.id),
      getUserBranches(user.id),
    ]);

    return Response.json(
      {
        success: true,
        message: "Logged in successfully",
        token,
        user: {
          uuid: user.uuid,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          created_at: user.created_at,
          roles: access.roles,
          permissions: access.permissions,
          modules: access.modules,
          branches,
        },
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Verify OTP error:", error);
    return Response.json(
      { success: false, message: "Could not verify OTP. Please try again." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
