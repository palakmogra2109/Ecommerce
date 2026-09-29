import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";
import { Branch } from "@/lib/models/branch";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const branch = await Branch.getWithStats(id);
    if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });
    return Response.json({ success: true, branch }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch get error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_UPDATE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const body = await request.json();
    const branch = await Branch.update(id, body);
    if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });
    return Response.json({ success: true, branch }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_DELETE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const branch = await Branch.remove(id);
    if (!branch) return Response.json({ success: false, message: "Branch not found" }, { status: 404, headers: corsHeaders() });
    return Response.json({ success: true, message: "Branch deleted" }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch delete error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
