import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { User } from "@/lib/models/user";
import { Role } from "@/lib/models/role";
import { UserRole } from "@/lib/models/userRole";
import { KEY_PERMISSIONS, ROLE_SLUGS, USER_STATUS } from "@shared/constants";
import { authorize } from "@/lib/authorization";
import { validateMobile } from "@/lib/phone";
import { isValidUuid } from "@/lib/uuid";
import {
  generatePassword,
  sendCredentialsEmail,
} from "@/lib/mail";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.USERS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: users, pagination } = await User.list({
      search,
      status: status || null,
      page,
      limit,
      excludeUuids: [auth.user?.uuid],
    });

    const userUuids = users.map((u) => u.uuid);

    const roleResult = userUuids.length
      ? await pool.query(
          `SELECT u.uuid, r.uuid AS role_uuid, r.name, r.slug
           FROM user_has_roles uhr
           JOIN users u ON u.id = uhr.user_id
           JOIN roles r ON r.id = uhr.role_id
           WHERE u.uuid = ANY($1)`,
          [userUuids]
        )
      : { rows: [] };

    const roleMap = {};
    for (const row of roleResult.rows) {
      if (!roleMap[row.uuid]) {
        roleMap[row.uuid] = {
          uuid: row.role_uuid,
          name: row.name,
          slug: row.slug,
        };
      }
    }

    // Resolve the parent account (the admin this user was created under)
    // for the user hierarchy.
    const parentResult = userUuids.length
      ? await pool.query(
          `SELECT u.uuid, p.uuid AS parent_uuid, p.name AS parent_name
           FROM users u
           LEFT JOIN users p ON p.id = u.parent_id
           WHERE u.uuid = ANY($1)`,
          [userUuids]
        )
      : { rows: [] };

    const parentMap = {};
    for (const row of parentResult.rows) {
      parentMap[row.uuid] = row.parent_uuid
        ? { uuid: row.parent_uuid, name: row.parent_name }
        : null;
    }

    const enriched = users.map((u) => ({
      ...u,
      role: roleMap[u.uuid] || null,
      parent: parentMap[u.uuid] ?? null,
    }));

    return Response.json(
      {
        success: true,
        users: enriched,
        pagination,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("List users error:", error);

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

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.USERS_CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, email, mobile, avatar, roleId } = body;

    // Validate required fields
    const errors = {};

    if (
      !name ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      errors.name = "Name is required";
    }

    if (
      !email ||
      typeof email !== "string" ||
      !email.trim()
    ) {
      errors.email = "Email is required";
    }

    if (
      !mobile ||
      typeof mobile !== "string" ||
      !mobile.trim()
    ) {
      errors.mobile = "Mobile number is required";
    }

    if (!roleId) {
      errors.roleId = "Role is required";
    }

    if (Object.keys(errors).length > 0) {
      return Response.json(
        {
          success: false,
          message: Object.values(errors)[0],
          errors,
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    // Validate mobile: must be a valid number in its country with 8-10
    // national digits, stored in E.164 format (+<dial><number>).
    const phone = validateMobile(mobile);

    if (!phone.ok) {
      return Response.json(
        {
          success: false,
          message: phone.message,
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return Response.json(
        {
          success: false,
          message: "Invalid email format",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const userStatus = USER_STATUS.ACTIVE;

    const existingUser = await User.findByEmail(
      normalizedEmail
    );

    if (existingUser) {
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

    // Validate roleId (public uuid)
    if (roleId && typeof roleId !== "string" || (roleId && !isValidUuid(roleId))) {
      return Response.json(
        {
          success: false,
          message: "Invalid role",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const role = await Role.getInternalByUuid(roleId);

    if (!role) {
      return Response.json(
        {
          success: false,
          message: "Role not found",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    // Super admin accounts are system-owned and cannot be created
    // through the admin panel.
    if (role.slug === ROLE_SLUGS.SUPER_ADMIN) {
      return Response.json(
        {
          success: false,
          message: "This role cannot be assigned",
        },
        {
          status: 403,
          headers: corsHeaders(),
        }
      );
    }

    // Generate random password
    const plainPassword = generatePassword(12);

    const hashedPassword = await bcrypt.hash(plainPassword, 12);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      mobile: mobile.trim(),
      avatar: avatar ?? null,
      status: userStatus,
      // Admin-created accounts are sub-users of the creating admin so the
      // whole user hierarchy can be traced through users.parent_id.
      parentId: auth.user.id,
    });

    // Assign role
    const createdInternal = await User.getInternalByUuid(user.uuid);

    await UserRole.assign(createdInternal.id, role.id);

    // Send credentials email (best effort)
    const mailResult = await sendCredentialsEmail(
      normalizedEmail,
      name.trim(),
      normalizedEmail,
      plainPassword
    );

    return Response.json(
      {
        success: true,
        message: mailResult.success
          ? "User created successfully. Login credentials sent via email."
          : "User created successfully. Email could not be sent — credentials logged to server console.",
        user,
      },
      {
        status: 201,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Create user error:", error);

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
