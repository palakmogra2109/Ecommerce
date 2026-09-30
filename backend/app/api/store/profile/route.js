import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { validateMobile } from "@/lib/phone";
import { canonicalMobile, mobileVariants, normalizeMobile } from "@/lib/otp";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function serialize(user) {
  return {
    uuid: user.uuid,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
  };
}

// Self-service shopper profile. Email is immutable here — with one
// exception: OTP auto-created accounts carry a `<digits>@mobile.local`
// placeholder, and registration is only complete once they swap it for a
// real, unique address. The swap migrates the customers linkage (and the
// account's own order emails) in the same transaction so nothing orphans.
export async function GET() {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const result = await pool.query(
      `SELECT uuid, name, email, mobile FROM users WHERE id = $1`,
      [auth.user.id]
    );
    if (result.rows.length === 0) {
      return Response.json(
        { success: false, message: "Account not found" },
        { status: 404, headers: corsHeaders() }
      );
    }
    return Response.json(
      { success: true, user: serialize(result.rows[0]) },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store profile error:", error);
    return Response.json(
      { success: false, message: "Could not load profile." },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function PATCH(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const fields = [];
    const values = [];

    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) {
        return Response.json(
          { success: false, message: "Name cannot be empty.", errors: { name: "Enter your name." } },
          { status: 400, headers: corsHeaders() }
        );
      }
      fields.push(`name = $${values.length + 1}`);
      values.push(name.slice(0, 100));
    }

    if (body.mobile !== undefined) {
      const digits = normalizeMobile(body.mobile);
      // An empty string clears the number; anything else must validate.
      if (digits) {
        const valid = validateMobile(body.mobile);
        if (!valid.ok) {
          return Response.json(
            { success: false, message: valid.message, errors: { mobile: valid.message } },
            { status: 400, headers: corsHeaders() }
          );
        }
        const clash = await pool.query(
          `SELECT id FROM users WHERE id <> $1 AND mobile = ANY($2) LIMIT 1`,
          [auth.user.id, mobileVariants(digits)]
        );
        if (clash.rows.length > 0) {
          return Response.json(
            {
              success: false,
              message: "This mobile number is already linked to another account.",
              errors: { mobile: "This mobile number is already linked to another account." },
            },
            { status: 409, headers: corsHeaders() }
          );
        }
      }
      fields.push(`mobile = $${values.length + 1}`);
      values.push(canonicalMobile(body.mobile) || null);
    }

    let emailMigration = null;
    if (body.email !== undefined) {
      const current = await pool.query(`SELECT email FROM users WHERE id = $1`, [auth.user.id]);
      const currentEmail = (current.rows[0]?.email || "").toLowerCase().trim();
      if (!currentEmail.endsWith("@mobile.local")) {
        return Response.json(
          { success: false, message: "Email cannot be changed.", errors: { email: "Email cannot be changed." } },
          { status: 403, headers: corsHeaders() }
        );
      }
      const next = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
        return Response.json(
          { success: false, message: "Enter a valid email address.", errors: { email: "Enter a valid email address." } },
          { status: 400, headers: corsHeaders() }
        );
      }
      if (next.endsWith("@mobile.local")) {
        return Response.json(
          { success: false, message: "Enter your real email address.", errors: { email: "Enter your real email address." } },
          { status: 400, headers: corsHeaders() }
        );
      }
      const clash = await pool.query(
        `SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1`,
        [next, auth.user.id]
      );
      if (clash.rows.length > 0) {
        return Response.json(
          {
            success: false,
            message: "An account with this email already exists.",
            errors: { email: "An account with this email already exists." },
          },
          { status: 409, headers: corsHeaders() }
        );
      }
      fields.push(`email = $${values.length + 1}`);
      values.push(next);
      emailMigration = { from: currentEmail, to: next };
    }

    if (fields.length === 0) {
      return Response.json(
        { success: false, message: "Nothing to update." },
        { status: 400, headers: corsHeaders() }
      );
    }

    values.push(auth.user.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE users SET ${fields.join(", ")}, updated_at = now()
         WHERE id = $${values.length}
         RETURNING uuid, name, email, mobile`,
        values
      );
      if (emailMigration) {
        // Keep the address book and the account's own order history keyed
        // to the new address; otherwise both would orphan on the placeholder.
        await client.query(`UPDATE customers SET email = $1, updated_at = now() WHERE email = $2`, [
          emailMigration.to,
          emailMigration.from,
        ]);
        await client.query(`UPDATE orders SET customer_email = $1 WHERE customer_email = $2`, [
          emailMigration.to,
          emailMigration.from,
        ]);
      }
      await client.query("COMMIT");
      return Response.json(
        { success: true, message: "Profile updated.", user: serialize(result.rows[0]) },
        { status: 200, headers: corsHeaders() }
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Update store profile error:", error);
    return Response.json(
      { success: false, message: "Could not update profile." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
