import { corsHeaders } from "@/lib/cors";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST() {
  return Response.json(
    {
      success: true,
      message: "Logout successful",
    },
    {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Set-Cookie":
          "token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax",
      },
    }
  );
}