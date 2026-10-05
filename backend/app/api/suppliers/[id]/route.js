import { corsHeaders } from "@/lib/cors";
import { Supplier } from "@/lib/models/supplier";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return Response.json({ success: false, message: "Supplier not found" }, { status: 404, headers: corsHeaders() });
    }
    const balance = await Supplier.balance(id);
    return Response.json({ success: true, supplier, balance }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Supplier read error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_UPDATE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const body = await request.json();
    const supplier = await Supplier.update(id, body);
    if (!supplier) {
      return Response.json({ success: false, message: "Supplier not found" }, { status: 404, headers: corsHeaders() });
    }
    return Response.json({ success: true, supplier }, { headers: corsHeaders() });
  } catch (error) {
    if (error instanceof Error && !error.code) {
      return Response.json({ success: false, message: error.message }, { status: 422, headers: corsHeaders() });
    }
    console.error("Supplier update error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

/**
 * DELETE retires rather than deletes. Purchase invoices reference suppliers, and
 * an audit trail that disappears with the row is no audit trail. A restore is
 * available as PUT.
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_DELETE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const supplier = await Supplier.archive(id);
    if (!supplier) {
      return Response.json({ success: false, message: "Supplier not found" }, { status: 404, headers: corsHeaders() });
    }
    return Response.json({ success: true, supplier, message: "Supplier retired" }, { headers: corsHeaders() });
  } catch (error) {
    // archive() refuses while invoices are in flight, and that message is the
    // whole point of the call, so it reaches the caller rather than a 500.
    if (error instanceof Error && !error.code) {
      return Response.json({ success: false, message: error.message }, { status: 422, headers: corsHeaders() });
    }
    console.error("Supplier retire error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PUT(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.SUPPLIERS_UPDATE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const supplier = await Supplier.restore(id);
    if (!supplier) {
      return Response.json({ success: false, message: "Supplier not found" }, { status: 404, headers: corsHeaders() });
    }
    return Response.json({ success: true, supplier }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Supplier restore error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}