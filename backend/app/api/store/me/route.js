import { corsHeaders } from "@/lib/cors";
import pool from "@/lib/db";
import { authenticate, requireBranchAccess } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Maps a raw branch row into the API shape.
function serializeBranch(row) {
  if (!row) return null;

  return {
    uuid: row.uuid,
    name: row.name,
    code: row.code,
    email: row.email,
    phone: row.phone,
    address: row.address,
    addressLine1: row.addressline1,
    addressLine2: row.addressline2,
    city: row.city,
    state: row.state,
    country: row.country,
    postalCode: row.postalcode,
    openingTime: row.openingtime,
    closingTime: row.closingtime,
    timezone: row.timezone,
    deliveryEnabled: row.deliveryenabled,
    pickupEnabled: row.pickupenabled,
    deliveryRadius: row.deliveryradius != null ? Number(row.deliveryradius) : null,
    description: row.description,
    logo: row.logo,
    onboardingCompleted: Boolean(row.onboarding_completed),
    created_at: row.createdat,
    updated_at: row.updatedat,
  };
}

export async function GET(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const branchUuid = request.headers.get("x-branch-id") || "";

    if (!branchUuid) {
      return Response.json({ success: false, message: "Select a store first" }, { status: 400, headers: corsHeaders() });
    }

    const userResult = await pool.query(
      `SELECT uuid, name, email, mobile, avatar FROM users WHERE id = $1`,
      [auth.user.id]
    );
    const user = userResult.rows[0];

    const branchResult = await pool.query(
      `SELECT * FROM branches WHERE uuid = $1 AND status = 'ACTIVE'`,
      [branchUuid]
    );

    if (branchResult.rows.length === 0) {
      return Response.json({ success: false, message: "Store not found" }, { status: 404, headers: corsHeaders() });
    }

    return Response.json({
      success: true,
      user: {
        uuid: user.uuid,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        avatar: user.avatar,
      },
      branch: serializeBranch(branchResult.rows[0]),
    }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Store me error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const branchUuid = body.branchId || request.headers.get("x-branch-id") || "";

    const access = await requireBranchAccess(branchUuid);
    if (!access.ok) return access.response;

    // ---------- User profile ----------
    const userFields = [];
    const userValues = [];
    const setUser = (col, val) => {
      userFields.push(`${col} = $${userValues.length + 1}`);
      userValues.push(val);
    };

    if (body.name !== undefined) setUser("name", (body.name ?? "").trim());
    if (body.mobile !== undefined) setUser("mobile", body.mobile || null);

    if (userFields.length > 0) {
      userValues.push(auth.user.id);
      await pool.query(
        `UPDATE users SET ${userFields.join(", ")}, updated_at = now() WHERE id = $${userValues.length}`,
        userValues
      );
    }

    // ---------- Branch profile ----------
    const branchFields = [];
    const branchValues = [];
    const setBranch = (col, val) => {
      branchFields.push(`${col} = $${branchValues.length + 1}`);
      branchValues.push(val);
    };

    if (body.name !== undefined) setBranch("name", (body.name ?? "").trim());
    if (body.email !== undefined) setBranch("email", body.email || null);
    if (body.phone !== undefined) setBranch("phone", body.phone || null);
    if (body.address !== undefined) setBranch("address", body.address || null);
    if (body.addressLine1 !== undefined) setBranch("addressLine1", body.addressLine1 || null);
    if (body.addressLine2 !== undefined) setBranch("addressLine2", body.addressLine2 || null);
    if (body.city !== undefined) setBranch("city", body.city || null);
    if (body.state !== undefined) setBranch("state", body.state || null);
    if (body.country !== undefined) setBranch("country", body.country || null);
    if (body.postalCode !== undefined) setBranch("postalCode", body.postalCode || null);
    if (body.openingTime !== undefined) setBranch("openingTime", body.openingTime || null);
    if (body.closingTime !== undefined) setBranch("closingTime", body.closingTime || null);
    if (body.timezone !== undefined) setBranch("timezone", body.timezone || "Asia/Kolkata");
    if (body.deliveryEnabled !== undefined) setBranch("deliveryEnabled", Boolean(body.deliveryEnabled));
    if (body.pickupEnabled !== undefined) setBranch("pickupEnabled", Boolean(body.pickupEnabled));
    if (body.deliveryRadius !== undefined) setBranch("deliveryRadius", body.deliveryRadius != null ? Number(body.deliveryRadius) : null);
    if (body.description !== undefined) setBranch("description", body.description || null);
    if (body.logo !== undefined) setBranch("logo", body.logo || null);
    if (body.onboardingCompleted !== undefined) setBranch("onboarding_completed", Boolean(body.onboardingCompleted));

    if (branchFields.length > 0) {
      branchValues.push(access.branch.uuid);
      await pool.query(
        `UPDATE branches SET ${branchFields.join(", ")}, updatedat = now() WHERE uuid = $${branchValues.length}`,
        branchValues
      );
    }

    const userResult = await pool.query(
      `SELECT uuid, name, email, mobile, avatar FROM users WHERE id = $1`,
      [auth.user.id]
    );
    const branchResult = await pool.query(
      `SELECT * FROM branches WHERE uuid = $1`,
      [access.branch.uuid]
    );
    const user = userResult.rows[0];
    const branch = serializeBranch(branchResult.rows[0]);

    return Response.json({
      success: true,
      message: "Store profile updated",
      user: {
        uuid: user.uuid,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        avatar: user.avatar,
      },
      branch,
    }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Store me update error:", error);
    return Response.json({ success: false, message: "Internal server error", debug: String(error && error.message) }, { status: 500, headers: corsHeaders() });
  }
}