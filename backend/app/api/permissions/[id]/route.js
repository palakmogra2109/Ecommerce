import { corsHeaders } from "@/lib/cors";
import { Permission } from "@/lib/models/permission";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(_request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PERMISSIONS_VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const permission = await Permission.findByUuid(id);

    if (!permission) {
      return Response.json(
        {
          success: false,
          message: "Permission not found",
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
        permission,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Get permission error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.PERMISSIONS_UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const body = await request.json();

    const { name, module: moduleName, description } = body;

    const permission = await Permission.findByUuid(id);

    if (!permission) {
      return Response.json(
        {
          success: false,
          message: "Permission not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    const updated = await Permission.update(id, {
      name,
      module: moduleName,
      description,
    });

    return Response.json(
      {
        success: true,
        message: "Permission updated successfully",
        permission: updated,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Update permission error:", error);

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
    const auth = await authorize(KEY_PERMISSIONS.PERMISSIONS_DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const permission = await Permission.findByUuid(id);

    if (!permission) {
      return Response.json(
        {
          success: false,
          message: "Permission not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    await Permission.remove(id);

    return Response.json(
      {
        success: true,
        message: "Permission deleted successfully",
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Delete permission error:", error);

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