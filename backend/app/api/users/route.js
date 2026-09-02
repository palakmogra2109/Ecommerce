import bcrypt from "bcryptjs";
import { corsHeaders } from "@/lib/cors";
import { User, USER_STATUSES } from "@/lib/models/user";
import { Role } from "@/lib/models/role";
import { UserRole } from "@/lib/models/userRole";
import { authorize } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize("users.view");

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";

    const users = await User.list({
      search,
      status: status || null,
    });

    return Response.json(
      {
        success: true,
        users,
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
    const auth = await authorize("users.create");

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, email, password, status, mobile, avatar, roleId } =
      body;

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
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

    const userStatus =
      status && USER_STATUSES.includes(status)
        ? status
        : "ACTIVE";

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

    if (
      roleId &&
      typeof roleId !== "number" &&
      typeof roleId !== "string"
    ) {
      return Response.json(
        {
          success: false,
          message: "roleId must be a number",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: name ?? "",
      email: normalizedEmail,
      password: hashedPassword,
      mobile: mobile ?? null,
      avatar: avatar ?? null,
      status: userStatus,
    });

    if (roleId) {
      const role = await Role.findById(roleId);

      if (role) {
        await UserRole.assign(user.id, role.id);
      }
    }

    return Response.json(
      {
        success: true,
        message: "User created successfully",
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