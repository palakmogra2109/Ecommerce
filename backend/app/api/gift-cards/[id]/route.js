import { corsHeaders } from "@/lib/cors";
import { GiftCard } from "@/lib/models/giftCard";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, GIFT_CARD_STATUSES } from "@shared/constants";
import { isValidUuid, invalidUuidResponse } from "@/lib/uuid";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const giftCard = await GiftCard.findByUuid(id);
    if (!giftCard) {
      return Response.json(
        { success: false, message: "Gift card not found" },
        { status: 404, headers: corsHeaders() }
      );
    }
    const transactions = await GiftCard.transactions(id);
    return Response.json(
      { success: true, giftCard, transactions },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get gift card error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
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

    if (body.status !== undefined && !GIFT_CARD_STATUSES.includes(body.status)) {
      return Response.json(
        { success: false, message: "Invalid status" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Balance top-ups go through the ledgered adjust path, never direct edit.
    let giftCard = await GiftCard.update(id, {
      code: body.code,
      recipientEmail: body.recipientEmail,
      status: body.status,
      expiresAt: body.expiresAt,
    });

    if (!giftCard) {
      return Response.json(
        { success: false, message: "Gift card not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    if (body.adjustAmount !== undefined && Number(body.adjustAmount) !== 0) {
      try {
        giftCard = await GiftCard.adjust(id, Number(body.adjustAmount));
      } catch (error) {
        return Response.json(
          { success: false, message: error?.message || "Could not adjust balance" },
          { status: 400, headers: corsHeaders() }
        );
      }
    }

    return Response.json(
      { success: true, message: "Gift card updated successfully", giftCard },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Update gift card error:", error);
    if (String(error?.code) === "23505") {
      return Response.json(
        { success: false, message: "A gift card with this code already exists" },
        { status: 409, headers: corsHeaders() }
      );
    }
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_DELETE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isValidUuid(id)) return invalidUuidResponse();

    const removed = await GiftCard.remove(id);
    if (!removed) {
      return Response.json(
        { success: false, message: "Gift card not found" },
        { status: 404, headers: corsHeaders() }
      );
    }
    return Response.json(
      { success: true, message: "Gift card deleted successfully" },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Delete gift card error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
