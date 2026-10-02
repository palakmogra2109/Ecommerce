import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { round2, validateCoupon, validateGiftCard } from "@/lib/checkoutDiscounts";
import {
  allocateAcrossCards,
  isCardUsable,
  normalizeGiftCode,
  unusableReason,
} from "@/lib/giftCardRules";
import { GiftCard } from "@/lib/models/giftCard";
import { Wallet } from "@/lib/models/wallet";
import { linePaise } from "@/lib/giftCardApplicability";
import { planWalletSpend } from "@/lib/giftCardSpend";
import {
  checkGuessAllowed,
  clearFailedGuesses,
  clientKey,
  recordFailedGuess,
} from "@/lib/giftCardGuards";

export const runtime = "nodejs";

// Per-process map of client -> failed code guesses. See lib/giftCardGuards.js.
const guessLog = new Map();

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// The shopper's own customer row, resolved rather than believed.
//
// The legacy wallet path above takes `customerId` off the request body, which is
// harmless for a card that is then matched against the same email. The v2 wallet
// is not matched against anything: a bare id is all it takes to read somebody
// else's balance off this endpoint. So the id is only used when the row it names
// is the row this email belongs to, and an unknown email resolves to nobody —
// which costs nothing, because an email with no customer row has no wallet.
async function resolveCustomer(db, { customerEmail, customerId }) {
  if (customerId != null && customerEmail) {
    const found = await db.query(
      `SELECT id FROM customers WHERE id = $1 AND lower(email) = $2`,
      [customerId, customerEmail]
    );
    if (found.rows[0]) return Number(found.rows[0].id);
  }
  if (!customerEmail) return null;
  const found = await db.query(`SELECT id FROM customers WHERE lower(email) = $1`, [customerEmail]);
  return found.rows[0] ? Number(found.rows[0].id) : null;
}

// Cart lines as the allocator's scope checks read them.
//
// A quote is a preview of untrusted input, so these identifiers come from the
// client and a restricted card will simply fail closed against lines that do not
// carry the brand/category it wants — which is the right direction for a figure
// the order transaction re-derives anyway. The aliases are the same ones the
// legacy rules accept (`product_uuid`/`product_id`, `brand_slug`, and so on),
// because a storefront that sends one form and not another should not be the
// reason a card stops applying.
//
// Absent rather than empty on purpose: an empty basket would tell the allocator
// this order is worth nothing, and a quote without item context is not that.
// Which includes the common case — the storefront sends items without prices,
// because the order route is what prices a line. Lines that are worth nothing
// would cap every bucket at ₹0, restricted or not, and the quote would say "your
// balance does not apply" about a balance it never actually looked at. So an
// unpriced basket is treated as no basket, and the caller's own subtotal is the
// only cart there is.
function quoteLineItems(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lines = items.map((item) => ({
    unitPrice: item?.unitPrice ?? item?.price ?? 0,
    quantity: item?.quantity ?? 1,
    brand: item?.brand_name ?? item?.brand ?? item?.brand_slug ?? null,
    category: item?.category_slug ?? item?.category ?? item?.category_name ?? null,
    productId: item?.product_uuid ?? item?.productId ?? item?.product_id ?? null,
  }));
  return lines.some((line) => linePaise(line) > 0) ? lines : null;
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
    let giftCards = [];
    let giftError = "";

    // Wallet path: the shopper's own cards are spent for them, so there is no
    // code to guess and nothing to rate limit.
    if (body.useGiftCard && !String(body.giftCardCode || "").trim()) {
      const raw = await GiftCard.spendableForCustomer({
        email: customerEmail,
        customerId: body.customerId ?? null,
      });
      const usageCounts = await GiftCard.usageCounts(raw.map((c) => c.id));
      const basket = Array.isArray(body.items) ? body.items : [];
      const { total, lines, skipped } = allocateAcrossCards(raw, {
        remaining: remainder,
        usable: (card) =>
          isCardUsable(card, { usageCount: usageCounts[card.id] || 0, items: basket }),
      });
      giftAmount = total;
      if (skipped.length > 0 && lines.length === 0) {
        giftError = unusableReason(skipped[0], { items: basket }) || "";
      } else if (skipped.length > 0) {
        giftError = `${skipped.length} of your cards do not apply to this cart.`;
      }
      giftCards = lines.map((l) => ({
        code: GiftCard.maskRow(l.card).code,
        amount: l.amount,
        balance: Number(l.card.balance) || 0,
      }));
    }

    if (String(body.giftCardCode || "").trim()) {
      // Throttle only the code path, so a shopper browsing quotes is never
      // rate limited for unrelated reasons.
      const key = clientKey(request);
      const allowed = checkGuessAllowed(guessLog, key);
      if (!allowed.ok) {
        return Response.json(
          {
            success: false,
            message: "Too many gift card attempts. Please wait before trying again.",
          },
          {
            status: 429,
            headers: { ...corsHeaders(), "Retry-After": String(allowed.retryAfterSec) },
          }
        );
      }

      const checked = await validateGiftCard(pool, {
        code: body.giftCardCode,
        remainder,
        customerEmail,
      });
      if (checked.error) {
        giftError = checked.error;
        // A wrong/unusable code counts against the guess budget; a valid one
        // clears it so a real shopper is never punished.
        if (checked.notFound || checked.suspended) {
          recordFailedGuess(guessLog, key);
        } else {
          clearFailedGuesses(guessLog, key);
        }
      } else {
        clearFailedGuesses(guessLog, key);
        // Echo the code the shopper just submitted. The stored column is NULL
        // for hash-backed cards, and the shopper already knows this value, so
        // returning it leaks nothing new.
        giftCard = {
          code: normalizeGiftCode(body.giftCardCode),
          balance: Number(checked.giftCard.balance),
        };
        giftAmount = round2(checked.applied);
      }
    }

    // The v2 wallet: the buckets a redeemed code opened, spent after the coupon
    // and the legacy cards, in the same order the order transaction spends them.
    // Read-only — bucketsFor and balanceFor are SELECTs that create nothing, so
    // no wallet row, no bucket, no ledger row and no timestamp is touched here,
    // and previewing a code can never spend one.
    //
    // Gated on useGiftCard exactly as the legacy wallet path above is: the panel's
    // "use my gift balance" is the shopper's decision, and spending money they did
    // not ask to spend would be a worse surprise than the one this closes.
    let walletSpend = null;
    if (body.useGiftCard) {
      const customerId = await resolveCustomer(pool, { customerEmail, customerId: body.customerId ?? null });
      if (customerId) {
        const buckets = await Wallet.bucketsFor(customerId);
        walletSpend = planWalletSpend({
          buckets,
          lineItems: quoteLineItems(body.items),
          amount: round2(remainder - giftAmount),
        });
      }
    }

    return Response.json(
      {
        success: true,
        subtotal,
        discount: round2(discount),
        giftAmount,
        // Additive: the fields above keep their old names, meanings and values,
        // and `total` now also has the wallet's contribution removed from it.
        walletSpend,
        total: round2(
          Math.max(0, remainder - giftAmount - round2(walletSpend?.covered || 0))
        ),
        coupon,
        giftCard,
        // The wallet may have spent several cards on one order.
        giftCards,
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
