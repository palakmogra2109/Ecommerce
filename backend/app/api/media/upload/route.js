import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import path from "path";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
]);

const MEDIA_DIR = path.join(process.cwd(), "public", "media");

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request) {
  try {
    const auth = await authorize();

    if (!auth.ok) {
      return auth.response;
    }

    const formData = await request.formData();

    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return Response.json(
        {
          success: false,
          message: "A file is required",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const originalName = file.name || "file";
    const extension = originalName.split(".").pop().toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return Response.json(
        {
          success: false,
          message: "Only png, jpg, jpeg, gif, webp, svg are allowed",
        },
        {
          status: 400,
          headers: corsHeaders(),
        }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const fileName = `${randomUUID()}.${extension}`;

    await writeFile(path.join(MEDIA_DIR, fileName), buffer);

    return Response.json(
      {
        success: true,
        message: "File uploaded successfully",
        url: `/media/${fileName}`,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("Upload error:", error);

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