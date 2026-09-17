import { corsHeaders } from "@/lib/cors";
import {
  EmailTemplate,
  EMAIL_TEMPLATE_STATUSES,
} from "@/lib/models/emailTemplate";
import { authorize } from "@/lib/authorization";
import { EMAIL_TEMPLATE_PERMISSIONS } from "@shared/constants";
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
    const auth = await authorize(EMAIL_TEMPLATE_PERMISSIONS.VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const template = await EmailTemplate.findByUuid(id);

    if (!template) {
      return Response.json(
        {
          success: false,
          message: "Email template not found",
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
        template,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Get email template error:", error);

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
    const auth = await authorize(EMAIL_TEMPLATE_PERMISSIONS.UPDATE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const template = await EmailTemplate.findByUuid(id);

    if (!template) {
      return Response.json(
        {
          success: false,
          message: "Email template not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    const body = await request.json();

    const { name, slug, subject, bodyHtml, bodyText, variables, status } =
      body;

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

    if (
      subject !== undefined &&
      (!subject.trim() || typeof subject !== "string")
    ) {
      return Response.json(
        {
          success: false,
          message: "Subject cannot be empty",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    if (
      bodyHtml !== undefined &&
      (!bodyHtml.trim() || typeof bodyHtml !== "string")
    ) {
      return Response.json(
        {
          success: false,
          message: "HTML body cannot be empty",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const newStatus =
      status !== undefined
        ? EMAIL_TEMPLATE_STATUSES.includes(status)
          ? status
          : template.status
        : template.status;

    const updated = await EmailTemplate.update(id, {
      name,
      slug,
      subject,
      bodyHtml,
      bodyText,
      variables,
      status: newStatus,
    });

    return Response.json(
      {
        success: true,
        message: "Email template updated successfully",
        template: updated,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Update email template error:", error);

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
    const auth = await authorize(EMAIL_TEMPLATE_PERMISSIONS.DELETE);

    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await params;

    if (!isValidUuid(id)) {
      return invalidUuidResponse();
    }

    const template = await EmailTemplate.findByUuid(id);

    if (!template) {
      return Response.json(
        {
          success: false,
          message: "Email template not found",
        },
        {
          status: 404,
          headers: corsHeaders(),
        }
      );
    }

    await EmailTemplate.remove(id);

    return Response.json(
      {
        success: true,
        message: "Email template deleted successfully",
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Delete email template error:", error);

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