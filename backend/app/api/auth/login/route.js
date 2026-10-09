import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { createToken } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { getUserAccess, getUserBranches } from "@/lib/authorization";
import {
  checkLoginAllowed,
  clearLoginFailures,
  loginKeys,
  recordLoginFailure,
} from "@/lib/loginThrottle";

export const runtime = "nodejs";

// Failed sign-in attempts, in this process. Keyed by BOTH the submitted account
// and the client address, so the policy and the reasoning live in
// lib/loginThrottle.js.
//
// The Map is per process, so N instances give N x the budget — noted rather than
// solved, because the honest fix is a shared store (Redis, or a login_attempts
// table) and that is a larger change than this route should make on its own.
const failedLogins = new Map();

// The token cookie is marked Secure whenever the request actually arrived over
// TLS. Hard-coding it would stop local http://localhost:3000 from keeping a
// session at all, which is how this flag usually breaks a dev environment.
function cookieSecure(request) {
  const forwarded = request.headers.get("x-forwarded-proto");
  const proto = (forwarded || "").split(",")[0].trim();
  if (proto) return proto === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request) {
  try {
    // Read before throttling, because one of the two buckets is the submitted
    // account and that cannot be known without the body. This is the only part
    // of the request that now happens earlier: the throttle check below still
    // runs before bcrypt and before any database work, so a locked-out client
    // still costs the attacker nothing.
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Malformed JSON. Carried on as an empty body so the IP bucket still
      // applies; the missing-field check below then answers 400 rather than
      // letting this fall through to the generic 500.
    }

    const { email, password } = body;
    const normalizedEmail = email ? String(email).toLowerCase().trim() : "";

    // Throttled before any credential work. A successful login clears both
    // budgets, so someone who fumbles their own password twice is not punished
    // for it afterwards.
    const keys = loginKeys(request, normalizedEmail);
    const allowed = checkLoginAllowed(failedLogins, keys);

    if (allowed.ok === false) {
      return Response.json(
        {
          success: false,
          message: "Too many sign-in attempts. Please wait before trying again.",
        },
        {
          status: 429,
          headers: {
            ...corsHeaders(),
            "Retry-After": String(allowed.retryAfterSec),
          },
        }
      );
    }

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

    const result = await pool.query(
      `
      SELECT id, uuid, name, email, password, status, created_at
      FROM users
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      // Counted as a failed attempt like any other, and answered with the exact
      // same message as a wrong password so this cannot be used to discover
      // which email addresses exist.
      recordLoginFailure(failedLogins, keys);
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
      recordLoginFailure(failedLogins, keys);
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

    // Only an ACTIVE account may hold a session. Checked here, after the
    // password has already matched, for two reasons:
    //
    //  - Ordering. Answering "this account is deactivated" before verifying the
    //    password would confirm the address exists to anyone who guessed it.
    //    Reaching this line means the credentials were already correct, so the
    //    message tells the owner something useful and reveals nothing to an
    //    attacker.
    //  - It is not a failed guess. Someone deactivated by mistake or by an
    //    over-eager admin should not burn their own attempt budget, and the
    //    correct password clears it below.
    if (user.status !== "ACTIVE") {
      return Response.json(
        {
          success: false,
          message: "This account is not active. Please contact support.",
        },
        {
          status: 403,
          headers: corsHeaders(),
        }
      );
    }

    // A correct password is not a guess, so the budgets are returned — both of
    // them, or a user who recovers would stay locked for the rest of the IP
    // bucket's life.
    clearLoginFailures(failedLogins, keys);

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
        // Sent only over TLS. Without it the token crosses plain HTTP and can be
        // read off the wire. Conditional so local http development still gets a
        // session.
        ...(cookieSecure(request) ? ["Secure"] : []),
      ].join("; "),
    };

    return Response.json(
      {
        success: true,
        message: "Login successful",
        token,
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