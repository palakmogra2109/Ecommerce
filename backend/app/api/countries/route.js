import { corsHeaders } from "@/lib/cors";
import { PHONE_COUNTRIES } from "@/lib/phone";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET() {
  try {
    return Response.json(
      {
        success: true,
        countries: PHONE_COUNTRIES,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    console.error("List countries error:", error);

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
