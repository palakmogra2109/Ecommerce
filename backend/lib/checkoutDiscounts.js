// Money math shared by the quote endpoint and the order-placement route so
// the preview a shopper sees and the charge they get can never disagree.
//
// Coupon type spellings mirror shared/constants.js COUPON_TYPE as literals:
// this module runs under plain node --test too, where the "@shared" alias
// does not resolve (same reason lib/models/coupon.js avoids the import).
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

// Gift cards pay down whatever remains after the coupon. Never exceeds the
// remainder and never touches locked rows here — the placement route
// re-checks under FOR UPDATE before moving money.
export async function validateGiftCard(db, { code, remainder }) {
  const normalized = String(code || "").trim().replace(/\s+/g, "-").toUpperCase();
  if (!normalized) return { error: "Enter a gift card code." };

  const found = await db.query(
    `SELECT id, uuid, code, balance, status, expires_at FROM gift_cards WHERE code = $1`,
    [normalized]
  );
  const card = found.rows[0];
  if (!card || card.status !== "ACTIVE") {
    return { error: "This gift card is not valid." };
  }
  if (card.expires_at && new Date(card.expires_at).getTime() < Date.now()) {
    return { error: "This gift card has expired." };
  }

  const balance = Number(card.balance) || 0;
  if (balance <= 0) {
    return { error: "This gift card has no balance left." };
  }
  const rest = Math.max(0, round2(remainder));
  if (rest <= 0) {
    return { error: "There is nothing left for the gift card to cover." };
  }
  return { giftCard: card, applied: Math.min(balance, rest) };
}
