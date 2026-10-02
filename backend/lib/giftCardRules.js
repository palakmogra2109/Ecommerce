// Pure gift-card rules, kept free of DB access so they can be unit tested and
// reused by both the quote endpoint and the authoritative order transaction.
import { round2 as round2Paise } from "./giftCardApplicability.js";

export const SELLABLE_STATUS = "ACTIVE";
export const TERMINAL_STATUSES = ["CANCELLED", "REDEEMED"];

// JSONB columns arrive as parsed arrays; a missing or malformed value means
// "no restriction" rather than "restricted to nothing".
const list = (value) => (Array.isArray(value) ? value : []);

// One rounding function for the whole codebase. This used to be
// `Math.round(n * 100) / 100`, which rounds in floating point: 1.005 is stored
// as 1.00499999999999989, so it came back as 1 and silently lost a paisa. The
// paise-based version nudges below the boundary and settles half away from zero,
// so it agrees with giftCardApplicability at every value. Two implementations of
// money rounding is a trap for whoever adds the next money path, so there is now
// one, and this re-export keeps the existing import sites working.
export function round2(value) {
  return round2Paise(value);
}


export function normalizeGiftCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .toUpperCase();
}

// Reduces a card row to what a non-owner may see: the code becomes a masked
// stub and the lookup hash is dropped entirely, so nothing returned by an API
// can be used to confirm code guesses offline.
export function maskCode(row) {
  if (!row) return row;
  const { code_hash: codeHash, ...rest } = row;
  return {
    ...rest,
    code: codeHash ? `••••-${row.code_last4 || "••••"}` : row.code,
    code_last4: row.code_last4 || null,
  };
}

export function isExpired(card, now = Date.now()) {
  if (!card?.expires_at) return false;
  return new Date(card.expires_at).getTime() < now;
}

// Effective status shown to users: EXPIRED is derived, never persisted.
export function effectiveStatus(card, now = Date.now()) {
  if (!card) return null;
  if (
    isExpired(card, now) &&
    Number(card.balance) > 0 &&
    !TERMINAL_STATUSES.includes(card.status)
  ) {
    return "EXPIRED";
  }
  return card.status;
}

// Why a card cannot be spent right now, in shopper-safe words, or null when
// it can. This is the single source for both the pass/fail check and the
// message, so the quote and the order route can never word it differently.
export function unusableReason(card, { now = Date.now(), usageCount = 0, items = null } = {}) {
  if (!card) return "This gift card could not be found.";

  const status = effectiveStatus(card, now);
  if (status === "EXPIRED") return "This gift card has expired.";
  if (status === "CANCELLED") return "This gift card has been cancelled.";
  if (status === "SUSPENDED") return "This gift card is currently suspended.";
  if (status === "DRAFT") return "This gift card has not been activated yet.";
  if (status !== SELLABLE_STATUS) return "This gift card cannot be used right now.";

  if (Number(card.balance) <= 0) return "This gift card has no balance left.";

  if (card.usage_limit != null && usageCount >= Number(card.usage_limit)) {
    return "This gift card has reached its usage limit.";
  }

  // Scope only applies when the caller supplied the basket. A quote without
  // item context cannot judge it, so it is skipped rather than failed.
  const basket = Array.isArray(items) ? items : null;
  if (basket) {
    // A card's scope and a basket line do not always speak the same dialect.
    // Scope is stored as slugs (spices-masalas) while a server-built line also
    // carries the numeric id (4); products are stored as uuids but a line may
    // only have the numeric id. So every form a line offers is collected, and a
    // match counts if any of them lines up.
    const pick = (...keys) => {
      const out = [];
      for (const line of basket) {
        for (const k of keys) {
          if (line[k] != null) out.push(String(line[k]));
        }
      }
      return out;
    };

    const productIds = pick("productId", "product_uuid", "product_id");
    const brandIds = pick("brandId", "brand_id", "brand_slug");
    const categoryIds = pick("categoryId", "category_id", "category_slug");

    const wanted = list(card.applicable_products);
    if (wanted.length > 0 && !wanted.some((p) => productIds.includes(String(p)))) {
      return "This gift card is not valid for the items in your cart.";
    }

    const wantedBrands = list(card.applicable_brands);
    if (wantedBrands.length > 0 && !wantedBrands.some((b) => brandIds.includes(String(b)))) {
      return "This gift card is limited to other brands.";
    }

    const wantedCategories = list(card.applicable_categories);
    if (
      wantedCategories.length > 0 &&
      !wantedCategories.some((c) => categoryIds.includes(String(c)))
    ) {
      return "This gift card is limited to other categories.";
    }
  }

  return null;
}

// A card can pay only if it is sellable, funded, within its usage limit, and
// actually applicable to what is in the basket.
export function isCardUsable(card, { now = Date.now(), usageCount = 0, items = null } = {}) {
  return unusableReason(card, { now, usageCount, items }) === null;
}

// True when nothing limits where this card can be spent.
export function isCardUnrestricted(card) {
  if (!card) return true;
  return ["applicable_branches", "applicable_brands", "applicable_categories", "applicable_products"].every(
    (key) => list(card[key]).length === 0
  );
}

// Human wording for a card's scope, so a shopper can see why a card applied
// rather than watching it silently skip.
export function scopeLabel(card, { brandNames = {}, categoryNames = {} } = {}) {
  if (!card) return "Any product";
  const parts = [];

  const brands = list(card.applicable_brands);
  if (brands.length) {
    parts.push(brands.map((b) => brandNames[b] || `Brand #${b}`).join(", "));
  }
  const categories = list(card.applicable_categories);
  if (categories.length) {
    // Matched by slug, so the slug is already the human-readable form.
    parts.push(categories.map((c) => categoryNames[c] || String(c)).join(", "));
  }
  const products = list(card.applicable_products);
  if (products.length) {
    parts.push(`${products.length} selected ${products.length === 1 ? "item" : "items"}`);
  }

  if (parts.length === 0) return "Any product";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, 2).join(" · ")}${parts.length > 2 ? " · …" : ""}`;
}

// A card is spent in a particular order when it is the one most likely to
// become worthless soonest: the earliest expiry first, then the smallest
// balance so odd amounts get cleared. Ties fall back to id for a stable order.
export function compareForSpending(a, b) {
  const aExp = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
  const bExp = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
  if (aExp !== bExp) return aExp - bExp;

  const aBal = Number(a.balance) || 0;
  const bBal = Number(b.balance) || 0;
  if (aBal !== bBal) return aBal - bBal;

  return Number(a.id || 0) - Number(b.id || 0);
}

// How much one card may contribute to an order, respecting its balance and
// any per-use cap.
export function cardContribution(card, remaining) {
  const left = Math.max(0, Number(remaining) || 0);
  if (left === 0) return 0;

  let amount = Math.min(left, Number(card?.balance) || 0);
  const perUse = card?.max_redemption_amount != null ? Number(card.max_redemption_amount) : null;
  if (perUse != null) amount = Math.min(amount, perUse);

  return round2(Math.max(0, amount));
}

// Walks the cards in spending order and fills the order until the cards run
// out. `usable` decides which cards qualify, so the caller can pass a card
// that fails a customer-specific rule without this function knowing why.
//
// Returns { total, lines: [{ card, amount }], skipped }.
export function allocateAcrossCards(cards, { remaining = 0, usable = () => true } = {}) {
  const target = round2(remaining);
  let left = target;
  const lines = [];
  const skipped = [];

  const ordered = [...(cards || [])].sort(compareForSpending);

  for (const card of ordered) {
    if (!usable(card)) {
      skipped.push(card);
      continue;
    }
    if (left <= 0) {
      // Nothing left to cover, so the rest of the wallet is simply unused.
      continue;
    }
    const amount = cardContribution(card, left);
    if (amount > 0) {
      lines.push({ card, amount });
      left = round2(left - amount);
    }
  }

  // Rounded at the end: repeatedly subtracting paise amounts leaves float
  // dust (1000 - 333.33 - 333.33 = 333.34000000000005) that must not leak
  // into the amount charged.
  return { total: round2(target - left), lines, skipped };
}

// One combined figure for the wallet header.
export function walletTotal(cards, { now = Date.now(), usageCounts = {} } = {}) {
  return round2(
    (cards || [])
      .filter((card) => isCardUsable(card, { now, usageCount: usageCounts[card.id] || 0 }))
      .reduce((sum, card) => sum + (Number(card.balance) || 0), 0)
  );
}
