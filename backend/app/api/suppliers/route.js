import { corsHeaders } from "@/lib/cors";
import { Supplier } from "@/lib/models/supplier";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const result = await Supplier.list({
      search: searchParams.get("search") || "",
      status: searchParams.get("status") || "",
      page: Math.max(1, parseInt(searchParams.get("page") || "1", 10)),
      limit: Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10))),
    });
    return Response.json(
      { success: true, suppliers: result.rows, pagination: result.pagination },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Suppliers list error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_CREATE);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const supplier = await Supplier.create(body);
    return Response.json({ success: true, supplier }, { status: 201, headers: corsHeaders() });
  } catch (error) {
    // normalize() throws plain Errors carrying a message written for a person
    // reading the form, so those go back verbatim. Anything else is a bug and
    // must not leak a stack trace to the client.
    if (error instanceof Error && !error.code) {
      return Response.json(
        { success: false, message: error.message },
        { status: 422, headers: corsHeaders() }
      );
    }
    console.error("Supplier create error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}