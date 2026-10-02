import { corsHeaders } from "@/lib/cors";
import { GiftCard } from "@/lib/models/giftCard";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Issues N uniquely-coded cards under one configuration. Full codes are
// returned exactly once here — hash-stored codes are unrecoverable
// afterwards, so the caller must export them now.
export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_CREATE);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const count = Math.min(500, Math.max(1, parseInt(body.count, 10) || 0));
    if (!count) {
      return Response.json(
        { success: false, message: "Count must be between 1 and 500." },
        { status: 400, headers: corsHeaders() }
      );
    }
    if (!(Number(body.amount) > 0)) {
      return Response.json(
        { success: false, message: "Amount must be greater than zero." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const cards = await GiftCard.bulkCreate({
      count,
      amount: Number(body.amount),
      recipientEmail: body.recipientEmail || null,
      expiresAt: body.expiresAt || null,
      status: "ACTIVE",
      source: "BULK",
      usageLimit: body.usageLimit != null && body.usageLimit !== "" ? Number(body.usageLimit) : null,
      minOrderAmount: body.minOrderAmount != null ? Number(body.minOrderAmount) : 0,
      maxRedemptionAmount: body.maxRedemptionAmount != null && body.maxRedemptionAmount !== "" ? Number(body.maxRedemptionAmount) : null,
      createdBy: auth.user.id,
    });

    return Response.json(
      {
        success: true,
        message: `${cards.length} gift cards issued. Export the codes now — they cannot be shown again.`,
        giftCards: cards,
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Bulk issue gift cards error:", error);
    return Response.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
