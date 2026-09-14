import { corsHeaders } from "@/lib/cors";
import { Setting } from "@/lib/models/setting";
import { authorize } from "@/lib/authorization";
import {
  SETTINGS_PERMISSIONS,
  DEFAULT_THEME_COLOR,
} from "@shared/constants";

export const runtime = "nodejs";

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET() {
  try {
    const auth = await authorize(SETTINGS_PERMISSIONS.VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const settings = await Setting.get();

    return Response.json(
      {
        success: true,
        settings: {
          theme_color: settings?.theme_color || DEFAULT_THEME_COLOR,
          dark_mode: Boolean(settings?.dark_mode),
        },
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Get settings error:", error);

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

export async function PUT(request) {
  try {
    const auth = await authorize(SETTINGS_PERMISSIONS.UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json().catch(() => ({}));

    const { theme_color, dark_mode } = body;

    if (theme_color !== undefined && !HEX_PATTERN.test(theme_color)) {
      return Response.json(
        {
          success: false,
          message: "Theme color must be a valid hex color like #3b82f6",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    if (dark_mode !== undefined && typeof dark_mode !== "boolean") {
      return Response.json(
        {
          success: false,
          message: "Dark mode must be a boolean",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const settings = await Setting.update({
      theme_color,
      dark_mode,
    });

    return Response.json(
      {
        success: true,
        message: "Settings updated successfully",
        settings: {
          theme_color: settings.theme_color,
          dark_mode: Boolean(settings.dark_mode),
        },
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Update settings error:", error);

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