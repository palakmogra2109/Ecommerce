import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { Permission } from "@/lib/models/permission";
import { Module } from "@/lib/models/module";
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
    const auth = await authorize("permissions.view");

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const moduleName = searchParams.get("module") ?? "";
    const search = searchParams.get("search") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const [{ rows: permissions, pagination }, modules] =
      await Promise.all([
        Permission.list({ module: moduleName, search, page, limit }),
        Module.list(),
      ]);

    return Response.json(
      {
        success: true,
        permissions,
        modules,
        pagination,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("List permissions error:", error);

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
    const auth = await authorize("permissions.create");

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, slug, module, description } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        {
          success: false,
          message: "Name is required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    if (!module || typeof module !== "string" || !module.trim()) {
      return Response.json(
        {
          success: false,
          message: "Module is required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const existingPermission = await Permission.findBySlug(
      slug || name
    );

    if (existingPermission) {
      return Response.json(
        {
          success: false,
          message: "Permission already exists",
        },
        {
          status: 409,
          headers: corsHeaders(),
        }
      );
    }

    const permission = await Permission.create({
      name,
      slug,
      module,
      description,
    });

    return Response.json(
      {
        success: true,
        message: "Permission created successfully",
        permission,
      },
      {
        status: 201,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Create permission error:", error);

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