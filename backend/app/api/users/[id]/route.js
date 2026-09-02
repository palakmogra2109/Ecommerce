import bcrypt from "bcryptjs";
import { corsHeaders } from "@/lib/cors";
import {
  User,
  USER_STATUSES,
} from "@/lib/models/user";
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

export async function GET(_request, { params }) {
  try {
    const auth = await authorize("users.view");

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const user = await User.findById(id);

    if (!user) {
      return Response.json(
        {
          success: false,
          message: "User not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    const roles = await UserRole.listByUser(id);

    return Response.json(
      {
        success: true,
        user: {
          ...user,
          role: roles[0] || null,
        },
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Get user error:", error);

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

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize("users.update");

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const body = await request.json();

    const { name, status, password, mobile, avatar, roleId } = body;

    const user = await User.findById(id);

    if (!user) {
      return Response.json(
        {
          success: false,
          message: "User not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    if (roleId) {
      const role = await Role.findById(roleId);

      if (role) {
        await UserRole.replaceRole(id, role.id);
      } else {
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
    }

    const newStatus =
      status !== undefined
        ? USER_STATUSES.includes(status)
          ? status
          : user.status
        : user.status;

    let updated = null;

    if (password !== undefined) {
      if (typeof password !== "string" || password.length < 6) {
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

      const hashedPassword = await bcrypt.hash(password, 12);

      updated = await User.updatePassword(id, hashedPassword);
    }

    if (name !== undefined || status !== undefined || mobile !== undefined || avatar !== undefined) {
      updated = await User.update(id, {
        name: name !== undefined ? name : user.name,
        status: newStatus,
        mobile: mobile !== undefined ? mobile : user.mobile,
        avatar: avatar !== undefined ? avatar : user.avatar,
      });
    }

    if (!updated) {
      updated = user;
    }

    return Response.json(
      {
        success: true,
        message: "User updated successfully",
        user: updated,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Update user error:", error);

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

export async function DELETE(_request, { params }) {
  try {
    const auth = await authorize("users.delete");

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const user = await User.findById(id);

    if (!user) {
      return Response.json(
        {
          success: false,
          message: "User not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    await User.remove(id);

    return Response.json(
      {
        success: true,
        message: "User deleted successfully",
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Delete user error:", error);

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