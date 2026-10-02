import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { createToken } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { getUserAccess, getUserBranches } from "@/lib/authorization";
import {
  checkGuessAllowed,
  clearFailedGuesses,
  clientKey,
  recordFailedGuess,
} from "@/lib/giftCardGuards";

export const runtime = "nodejs";

// Failed sign-in attempts, per client, in this process.
//
// The same limiter the gift-card code lookup uses, reused rather than
// reimplemented: without it this endpoint accepted unlimited password guesses
// against a known email address. The Map is per process, so N instances give
// N x the budget — noted rather than solved, because the honest fix is a shared
// store (Redis, or a login_attempts table) and that is a larger change than
// this route should make on its own.
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
    // Throttled before any credential work, so a locked-out client costs the
    // attacker time even when every guess is a miss. A successful login clears
    // the count, so someone who fumbles their own password twice is not punished
    // for it afterwards.
    const key = clientKey(request);
    const allowed = checkGuessAllowed(failedLogins, key);
    if (!allowed.ok) {
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
      // Counted as a failed attempt like any other, and answered with the exact
      // same message as a wrong password so this cannot be used to discover
      // which email addresses exist.
      recordFailedGuess(failedLogins, key);
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
      recordFailedGuess(failedLogins, key);
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

    // A correct password is not a guess, so the budget is returned.
    clearFailedGuesses(failedLogins, key);

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