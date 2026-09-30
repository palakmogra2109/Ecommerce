import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { validateMobile } from "@/lib/phone";
import {
  OTP_TTL_MS,
  canonicalMobile,
  canRequestOtp,
  deliverOtp,
  generateOtp,
  hashOtp,
  mobileVariants,
  normalizeMobile,
  recordOtpRequest,
} from "@/lib/otp";

export const runtime = "nodejs";

// Per-process request throttle (single-instance deployment).
const requestLog = new Map();

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Issues a login OTP for a mobile number, creating an OTP-only account on
// first use (approved behavior). The users.email column is NOT NULL, so the
// auto-created row gets a clearly synthetic `<digits>@mobile.local` address;
// users.password gets an unusable random hash, so these accounts can only
// ever sign in through OTP until a password flow is added for them.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mobile = body?.mobile;

    if (!mobile || typeof mobile !== "string" || !mobile.trim()) {
      return Response.json(
        { success: false, message: "Mobile number is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const valid = validateMobile(mobile.trim());
    if (!valid.ok) {
      return Response.json(
        { success: false, message: valid.message || "Enter a valid mobile number" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const identifier = normalizeMobile(mobile);
    const allowed = canRequestOtp(requestLog, identifier);
    if (!allowed.ok) {
      return Response.json(
        { success: false, message: `Too many requests. Try again in ${allowed.retryAfterSec}s.` },
        { status: 429, headers: corsHeaders() }
      );
    }

    const variants = mobileVariants(mobile);
    const existing = await pool.query(
      `SELECT id, uuid, name, email, mobile, status, created_at FROM users WHERE mobile = ANY($1)`,
      [variants]
    );
    let user = existing.rows[0] || null;

    if (user && user.status !== "ACTIVE") {
      return Response.json(
        { success: false, message: "Account is inactive" },
        { status: 403, headers: corsHeaders() }
      );
    }

    if (!user) {
      const email = `${identifier}@mobile.local`;
      const password = await bcrypt.hash(randomBytes(32).toString("hex"), 8);
      const name = `Shopper ${identifier.slice(-4)}`;
      try {
        const created = await pool.query(
          `INSERT INTO users (name, email, password, mobile, status)
           VALUES ($1, $2, $3, $4, 'ACTIVE')
           RETURNING id, uuid, name, email, mobile, status, created_at`,
          [name, email, password, canonicalMobile(mobile)]
        );
        user = created.rows[0];
      } catch (error) {
        // A manually-created row already owns this email: reuse it rather
        // than failing the login.
        if (error?.code !== "23505") throw error;
        const retry = await pool.query(
          `SELECT id, uuid, name, email, mobile, status, created_at FROM users WHERE email = $1`,
          [email]
        );
        user = retry.rows[0] || null;
        if (!user || user.status !== "ACTIVE") {
          return Response.json(
            { success: false, message: user ? "Account is inactive" : "Could not create account" },
            { status: user ? 403 : 500, headers: corsHeaders() }
          );
        }
      }
    }

    recordOtpRequest(requestLog, identifier);

    // Only the newest code stays valid: issuing a new one retires the old.
    await pool.query(
      `UPDATE otp_codes SET consumed_at = now() WHERE identifier = $1 AND consumed_at IS NULL`,
      [identifier]
    );
    const code = generateOtp();
    await pool.query(
      `INSERT INTO otp_codes (identifier, code_hash, purpose, expires_at)
       VALUES ($1, $2, 'login', $3)`,
      [identifier, hashOtp(code), new Date(Date.now() + OTP_TTL_MS)]
    );

    const sent = await deliverOtp(identifier, code);
    return Response.json(
      {
        success: true,
        message: "OTP sent to your mobile number",
        ...(sent.demoOtp ? { demoOtp: sent.demoOtp } : {}),
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Request OTP error:", error);
    return Response.json(
      { success: false, message: "Could not send OTP. Please try again." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
