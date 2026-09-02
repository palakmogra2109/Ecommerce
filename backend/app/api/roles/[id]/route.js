import { corsHeaders } from "@/lib/cors";
import {
  Role,
  ROLE_STATUSES,
} from "@/lib/models/role";
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
    const auth = await authorize("roles.view");

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const role = await Role.findById(id);

    if (!role) {
      return Response.json(
        {
          success: false,
          message: "Role not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    return Response.json(
      {
        success: true,
        role,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Get role error:", error);

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
    const auth = await authorize("roles.update");

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const body = await request.json();

    const { name, slug, description, status } = body;

    const role = await Role.findById(id);

    if (!role) {
      return Response.json(
        {
          success: false,
          message: "Role not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    if (name !== undefined && (!name.trim() || typeof name !== "string")) {
      return Response.json(
        {
          success: false,
          message: "Name cannot be empty",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const newStatus =
      status !== undefined
        ? ROLE_STATUSES.includes(status)
          ? status
          : role.status
        : role.status;

    const updated = await Role.update(id, {
      name,
      slug,
      description,
      status: newStatus,
    });

    return Response.json(
      {
        success: true,
        message: "Role updated successfully",
        role: updated,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Update role error:", error);

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
    const auth = await authorize("roles.delete");

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    const role = await Role.findById(id);

    if (!role) {
      return Response.json(
        {
          success: false,
          message: "Role not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    await Role.remove(id);

    return Response.json(
      {
        success: true,
        message: "Role deleted successfully",
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Delete role error:", error);

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