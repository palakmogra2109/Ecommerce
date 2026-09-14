import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import {
  EmailTemplate,
  EMAIL_TEMPLATE_STATUSES,
} from "@/lib/models/emailTemplate";
import { authorize } from "@/lib/authorization";
import { EMAIL_TEMPLATE_PERMISSIONS, STATUS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET(request) {
  try {
    const auth = await authorize(EMAIL_TEMPLATE_PERMISSIONS.VIEW);

    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: templates, pagination } =
      await EmailTemplate.list({
        search,
        status,
        page,
        limit,
      });

    return Response.json(
      {
        success: true,
        templates,
        pagination,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("List email templates error:", error);

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
    const auth = await authorize(EMAIL_TEMPLATE_PERMISSIONS.CREATE);

    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();

    const { name, slug, subject, bodyHtml, bodyText, variables, status } =
      body;

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

    if (!subject || typeof subject !== "string" || !subject.trim()) {
      return Response.json(
        {
          success: false,
          message: "Subject is required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    if (!bodyHtml || typeof bodyHtml !== "string" || !bodyHtml.trim()) {
      return Response.json(
        {
          success: false,
          message: "HTML body is required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const templateStatus =
      status && EMAIL_TEMPLATE_STATUSES.includes(status)
        ? status
        : STATUS.ACTIVE;

    const existing = await EmailTemplate.findBySlug(slug || name);

    if (existing) {
      return Response.json(
        {
          success: false,
          message: "Email template slug already exists",
        },
        {
          status: 409,
          headers: corsHeaders(),
        }
      );
    }

    const template = await EmailTemplate.create({
      name,
      slug,
      subject,
      bodyHtml,
      bodyText,
      variables,
      status: templateStatus,
    });

    return Response.json(
      {
        success: true,
        message: "Email template created successfully",
        template,
      },
      {
        status: 201,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Create email template error:", error);

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