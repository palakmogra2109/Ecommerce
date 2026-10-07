import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { registerInterest, isRegistered } from "@/lib/notifications/backInStock.js";

export const runtime = "nodejs";

// "Notify me" for an out-of-stock product.
//
// Requires a session, so nobody can harvest addresses by posting to this
// endpoint. A shopper with no customer row yet is matched by email, which is how
// an account-less guest still gets told.

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const { uuid } = await params;
    const email = request.headers.get("x-customer-email");
    const registered = email ? await isRegistered({ productUuid: uuid, email }) : false;
    return Response.json({ success: true, registered }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Notify-me status error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const { uuid } = await params;
    const body = await request.json();
    const result = await registerInterest({
      productUuid: uuid,
      email: body.email,
      name: body.name || null,
    });

    return Response.json(
      { success: true, ...result, message: "We will let you know when it is back in stock." },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    if (error instanceof Error && error.code) {
      const status = error.code === "NOT_FOUND" ? 404 : 422;
      return Response.json({ success: false, message: error.message }, { status, headers: corsHeaders() });
    }
    console.error("Notify-me error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
