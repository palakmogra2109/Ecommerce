// Money math shared by the quote endpoint and the order-placement route so
// the preview a shopper sees and the charge they get can never disagree.
//
// Coupon type spellings mirror shared/constants.js COUPON_TYPE as literals:
// this module runs under plain node --test too, where the "@shared" alias
// does not resolve (same reason lib/models/coupon.js avoids the import).
import { cardContribution, normalizeGiftCode, unusableReason } from "./giftCardRules.js";

const COUPON_FIXED = "FIXED";

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Pure: discount for an already-validated coupon on a subtotal.
export function computeCouponDiscount(coupon, subtotal) {
  const base = Math.max(0, Number(subtotal) || 0);
  if (!coupon || base <= 0) return 0;
  let discount = 0;
  if (coupon.type === COUPON_FIXED) {
    discount = Math.min(Number(coupon.value) || 0, base);
  } else {
    discount = (base * (Number(coupon.value) || 0)) / 100;
    const cap = Number(coupon.max_discount_amount);
    if (cap > 0) discount = Math.min(discount, cap);
  }
  return round2(Math.max(0, Math.min(discount, base)));
}

export function normalizeCouponCode(code) {
  return String(code || "").trim().replace(/\s+/g, "-").toUpperCase();
}

// Full validation against the live rows. `db` is pool or a transaction
// client; the placement route passes its client so the checks and the
// writes share one snapshot. Returns { coupon, discount } or { error }.
export async function validateCoupon(db, { code, subtotal, customerEmail }) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return { error: "Enter a coupon code." };

  const found = await db.query(
    `SELECT id, uuid, code, type, value, min_order_amount, max_discount_amount,
            starts_at, ends_at, usage_limit, per_customer_limit, used_count, status
     FROM coupons WHERE code = $1`,
    [normalized]
  );
  const coupon = found.rows[0];
  if (!coupon || coupon.status !== "ACTIVE") {
    return { error: "This coupon is not valid." };
  }

  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
    return { error: "This coupon is not active yet." };
  }
  if (coupon.ends_at && new Date(coupon.ends_at).getTime() < now) {
    return { error: "This coupon has expired." };
  }

  const base = Math.max(0, Number(subtotal) || 0);
  if (base < (Number(coupon.min_order_amount) || 0)) {
    return { error: `Needs a minimum order of ₹${Number(coupon.min_order_amount)}.` };
  }
  if (coupon.usage_limit != null && Number(coupon.used_count) >= Number(coupon.usage_limit)) {
    return { error: "This coupon has reached its usage limit." };
  }

  const email = String(customerEmail || "").trim().toLowerCase();
  if (email && coupon.per_customer_limit != null) {
    const used = await db.query(
      `SELECT COUNT(*)::int AS count FROM orders
       WHERE coupon_code = $1 AND LOWER(customer_email) = $2`,
      [coupon.code, email]
    );
    if ((used.rows[0]?.count || 0) >= Number(coupon.per_customer_limit)) {
      return { error: "You have already used this coupon." };
    }
  }

  return { coupon, discount: computeCouponDiscount(coupon, base) };
}

// Gift cards pay down whatever remains after the coupon, within the card's
// own rules (expiry, suspension, usage cap, customer binding, minimum order,
// maximum redemption, branch/product/category applicability). Never exceeds
// the remainder and never touches locked rows here — the placement route
// re-checks under FOR UPDATE before moving money.
//
// Context beyond code/remainder is optional: rules that cannot be judged
// (unknown branch, unknown buyer) are skipped, never failed. Returns
// { giftCard, applied, eligible } or { error }.
// Manual-code path. The wallet's auto-apply does not use this: it allocates
// across every card at once (allocateAcrossCards) instead of one code.
//
// Branch/product/category restrictions were removed, so this now judges only
// status, expiry, balance, ownership and the minimum order.
// Returns { giftCard, applied } or { error }.
export async function validateGiftCard(
  db,
  { code, remainder, customerEmail = "", customerId = null } = {}
) {
  const normalized = normalizeGiftCode(code);
  if (!normalized) return { error: "Enter a gift card code." };

  const { GiftCard } = await import("./models/giftCard.js");
  const card = await GiftCard.findByCode(normalized, { masked: false });
  if (!card) {
    // Distinct from a rule failure: a wrong code counts toward the guess budget.
    return { error: "This gift card is not valid.", notFound: true };
  }

  if (card.customer_id != null && customerId != null && Number(card.customer_id) !== Number(customerId)) {
    return { error: "This gift card belongs to another account." };
  }
  if (!card.customer_id && customerEmail) {
    const mine = await db.query(
      `SELECT 1 FROM gift_cards WHERE id = $1 AND (recipient_email IS NULL OR LOWER(recipient_email) = $2)`,
      [card.id, String(customerEmail).toLowerCase().trim()]
    );
    if (mine.rows.length === 0) {
      return { error: "This gift card was issued to someone else." };
    }
  }

  const reason = unusableReason(card);
  if (reason) {
    // A suspended card still counts toward the guess budget: someone probing
    // for live balances gets the same answer either way.
    return { error: reason, suspended: card.status === "SUSPENDED" };
  }

  const rest = Math.max(0, round2(remainder));
  if (rest <= 0) {
    return { error: "There is nothing left for the gift card to cover." };
  }
  const applied = cardContribution(card, rest);
  if (applied <= 0) {
    return { error: "This gift card cannot be applied to this order." };
  }
  return { giftCard: card, applied };
}
