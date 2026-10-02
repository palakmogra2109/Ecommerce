import { corsHeaders } from "@/lib/cors";
import { GiftCard } from "@/lib/models/giftCard";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, GIFT_CARD_STATUSES, GIFT_CARD_STATUS, GIFT_CARD_TX_TYPE } from "@shared/constants";
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

    if (
      body.recipientEmail !== undefined &&
      body.recipientEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.recipientEmail).trim())
    ) {
      return Response.json(
        { success: false, message: "Recipient email is not valid" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Balance top-ups go through the ledgered adjust path, never direct edit.
    let giftCard = await GiftCard.update(id, {
      code: body.code,
      recipientEmail: body.recipientEmail,
      status: body.status,
      expiresAt: body.expiresAt,
      usageLimit: body.usageLimit,
      minOrderAmount: body.minOrderAmount,
      maxRedemptionAmount: body.maxRedemptionAmount,
      imageUrl: body.imageUrl,
      label: body.label,
      applicableCategories: body.applicableCategories,
      applicableBrands: body.applicableBrands,
      applicableProducts: body.applicableProducts,
    });

    if (!giftCard) {
      return Response.json(
        { success: false, message: "Gift card not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    if (body.adjustAmount !== undefined && Number(body.adjustAmount) !== 0) {
      try {
        giftCard = await GiftCard.adjust(id, Number(body.adjustAmount), {
          reason: body.adjustReason || "Manual adjustment",
          performedBy: auth.user?.email ?? null,
        });
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

    // A card that has ledger history (issued, adjusted, redeemed) is cancelled
    // rather than deleted: the audit trail and any order that references it
    // must survive. Only a pristine DRAFT card is physically removed.
    const cancelled = await GiftCard.update(id, { status: GIFT_CARD_STATUS.CANCELLED });
    if (!cancelled) {
      return Response.json(
        { success: false, message: "Gift card not found" },
        { status: 404, headers: corsHeaders() }
      );
    }

    const transactions = await GiftCard.transactions(id);
    const pristine =
      cancelled.status === GIFT_CARD_STATUS.DRAFT &&
      transactions.length === 1 &&
      transactions[0].type === GIFT_CARD_TX_TYPE.ISSUE;

    if (pristine) {
      await GiftCard.remove(id);
      return Response.json(
        { success: true, message: "Gift card deleted successfully", giftCard: null },
        { status: 200, headers: corsHeaders() }
      );
    }

    return Response.json(
      {
        success: true,
        message: "Gift card cancelled successfully. Its ledger history was kept.",
        giftCard: cancelled,
      },
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
