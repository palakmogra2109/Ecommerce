import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { round2, validateCoupon, validateGiftCard } from "@/lib/checkoutDiscounts";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Price preview for checkout: validates the coupon and gift card codes
// against the shopper's own subtotal and returns the exact discount math
// the placement route will apply. Nothing is persisted or locked here —
// placement re-validates inside its transaction, so a quote can never
// become a stale promise.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const subtotal = Math.max(0, round2(body.subtotal));
    const customerEmail = String(body.customerEmail || "").trim().toLowerCase();

    let discount = 0;
    let coupon = null;
    let couponError = "";
    if (String(body.couponCode || "").trim()) {
      const checked = await validateCoupon(pool, {
        code: body.couponCode,
        subtotal,
        customerEmail,
      });
      if (checked.error) {
        couponError = checked.error;
      } else {
        coupon = { code: checked.coupon.code, type: checked.coupon.type, value: Number(checked.coupon.value) };
        discount = checked.discount;
      }
    }

    const remainder = round2(subtotal - discount);
    let giftAmount = 0;
    let giftCard = null;
    let giftError = "";
    if (String(body.giftCardCode || "").trim()) {
      const checked = await validateGiftCard(pool, { code: body.giftCardCode, remainder });
      if (checked.error) {
        giftError = checked.error;
      } else {
        giftCard = { code: checked.giftCard.code, balance: Number(checked.giftCard.balance) };
        giftAmount = round2(checked.applied);
      }
    }

    return Response.json(
      {
        success: true,
        subtotal,
        discount: round2(discount),
        giftAmount,
        total: round2(Math.max(0, remainder - giftAmount)),
        coupon,
        giftCard,
        couponError,
        giftError,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Checkout quote error:", error);
    return Response.json(
      { success: false, message: "Could not price this order." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
