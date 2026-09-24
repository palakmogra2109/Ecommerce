 import { corsHeaders } from "@/lib/cors";
import { Branch } from "@/lib/models/branch";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const city = searchParams.get("city") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    const result = await Branch.list({ search, status, city, page, limit });
    return Response.json({ success: true, branches: result.rows, pagination: result.pagination }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branches list error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_CREATE);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const branch = await Branch.create(body);
    return Response.json({ success: true, branch }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Branch create error:", error);
    return Response.json({ success: false, message: error.message || "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request) {
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

export async function DELETE(request) {
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
