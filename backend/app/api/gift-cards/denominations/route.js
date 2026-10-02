import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { GiftDenomination } from "@/lib/models/giftDenomination";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_VIEW);
    if (!auth.ok) return auth.response;

    return Response.json(
      { success: true, denominations: await GiftDenomination.list() },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List denominations error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_CREATE);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const denomination = await GiftDenomination.create({
      label: body.label,
      faceValue: body.faceValue,
      sellingPrice: body.sellingPrice,
      validForDays: body.validForDays,
      isActive: body.isActive !== false,
      sortOrder: body.sortOrder,
    });

    return Response.json(
      { success: true, message: "Denomination created", denomination },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create denomination error:", error);
    return Response.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 400, headers: corsHeaders() }
    );
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_UPDATE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const body = await request.json();
    const denomination = await GiftDenomination.update(id, {
      label: body.label,
      faceValue: body.faceValue,
      sellingPrice: body.sellingPrice,
      validForDays: body.validForDays,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    });

    if (!denomination) {
      return Response.json(
        { success: false, message: "Denomination not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Denomination updated", denomination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update denomination error:", error);
    return Response.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 400, headers: corsHeaders() }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_DELETE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const removed = await GiftDenomination.remove(id);
    if (!removed) {
      return Response.json(
        { success: false, message: "Denomination not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    return Response.json(
      { success: true, message: "Denomination deleted" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete denomination error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
