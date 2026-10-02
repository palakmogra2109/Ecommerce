import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { GiftCard } from "@/lib/models/giftCard";
import { Wallet } from "@/lib/models/wallet";
import { normalizeScope, scopeSummary } from "@/lib/giftCardApplicability";
import { round2, scopeLabel, walletTotal } from "@/lib/giftCardRules";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// The customer's gift balance as one figure, with everything behind it listed
// so the number is explainable. Codes stay masked: the full code exists only
// in the issue response and the recipient's email.
//
// Two systems hold gift money and both are real:
//
//   * LEGACY `gift_cards` rows — a card with a balance, spent through
//     GiftCard.spendableForCustomer and the checkout quote.
//   * v2 `customer_wallets` + `customer_wallet_buckets` — what a claim of a
//     v2 code opens, one bucket per code.
//
// The headline `balance` is the SUM of the two rather than one figure per
// system, because the shopper did not choose which system gave them money and
// has no reason to care: both are spent automatically at checkout, both are
// theirs, and splitting the number would ask them to add two balances in their
// head to learn the answer the panel can already give. The sources are still
// reported separately (`legacyBalance`, `v2Balance`, `cards`, `buckets`) so
// the UI can break the total down, and a shopper can see WHICH card is
// restricted — which is exactly the thing a single figure hides.
export async function GET() {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const email = (auth.user.email || "").toLowerCase().trim();
    const customerId = auth.user.customerId ?? null;

    const raw = await GiftCard.spendableForCustomer({ email, customerId });
    const usageCounts = await GiftCard.usageCounts(raw.map((c) => c.id));

    // Names are resolved here so the shopper reads "Nila Organics" rather
    // than a bare id, and the card's art can be captioned properly.
    const names = await scopeNames();

    const cards = raw.map((card) => {
      const derived = GiftCard.withDerivedStatus(card);
      const spent = Math.max(0, (Number(derived.initial_amount) || 0) - (Number(derived.balance) || 0));
      return {
        ...GiftCard.maskRow(derived),
        spent,
        // A card the shopper cannot currently spend (expired, suspended, no
        // balance, out of uses) is shown but kept out of the total.
        spendable: isSpendable(derived, usageCounts[card.id] || 0),
        usesRemaining:
          derived.usage_limit != null
            ? Math.max(0, Number(derived.usage_limit) - (usageCounts[card.id] || 0))
            : null,
        scope: scopeLabel(derived, names),
      };
    });

    // Only cards that can actually be spent right now count toward the legacy
    // half of the figure.
    const legacyBalance = walletTotal(raw, { usageCounts });

    // Both of these are reads. balanceFor and bucketsFor answer 0 and [] for a
    // customer with no wallet and CREATE nothing, which is what makes a guest
    // (no customerId) and a brand-new customer the same non-error case rather
    // than a reason to fail: this is a GET, and a page view must never be the
    // thing that opens a wallet.
    const v2Balance = customerId ? await Wallet.balanceFor(customerId) : 0;
    const rawBuckets = customerId ? await Wallet.bucketsFor(customerId) : [];
    const buckets = rawBuckets.map(toBucketView);

    return Response.json(
      {
        success: true,
        // Both systems, because the shopper should not have to care which one
        // paid them. Rounded once, at the end, so the two halves cannot leave a
        // fraction of a paisa between them and the total.
        balance: round2(legacyBalance + v2Balance),
        // The two halves, so the UI can break the headline down instead of
        // asking the shopper to subtract one figure from another.
        legacyBalance,
        v2Balance,
        cardCount: cards.filter((c) => c.spendable).length,
        cards,
        // `buckets` and `walletBuckets` are the same array under two names: one
        // reads as the wallet's own list, the other as the card-for-card twin
        // of `cards` above. Same objects, not a copy — two copies of one list is
        // one list that can disagree with the other.
        buckets,
        walletBuckets: buckets,
        redeemedCount: buckets.filter((b) => b.balance > 0).length,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store wallet error:", error);
    return Response.json(
      { success: false, message: "Could not load your balance." },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// One spendable bucket in the shape the panel lists it in.
//
// `scopeLabel` is the whole reason this mapping exists: a bucket frozen to a
// category is not interchangeable with an unrestricted one, and "₹500" on its
// own would be a lie the shopper only discovers at checkout. It comes from
// scopeSummary, which is normalizeScope plus a caption — the same pair
// claimGiftCard.previewClaim uses, so a code and the bucket it opens are worded
// identically.
//
// The label is taken from the RAW applicability and the folded object is only
// for the `scope` field, because chaining them — scopeSummary(normalizeScope(x))
// — is a fail-open. normalizeScope deliberately does not trust a `malformed`
// flag it is handed and recomputes it, and recomputing from an already-folded
// object sees only the three known keys, so the flag resets to false and an
// unreadable restriction is captioned "All products". The raw column is the
// only place the unknown row still exists to be found.
function toBucketView(bucket) {
  const scope = normalizeScope(bucket.applicability);
  return {
    id: bucket.id,
    // remaining, not initial_value: the headline is what the shopper can spend.
    balance: round2(bucket.remaining),
    // mapBucket does not surface the column, and every bucket in the schema
    // defaults to INR, so the fallback is the honest one rather than null.
    currency: bucket.currency || "INR",
    scopeLabel: scopeSummary(bucket.applicability),
    scope,
    // A NULL expires_at means the value never ages out, and stays null rather
    // than being invented into a date.
    expiresAt: bucket.expiresAt ?? null,
  };
}

function isSpendable(card, usageCount) {
  return (
    card.status === "ACTIVE" &&
    !(card.expires_at && new Date(card.expires_at).getTime() < Date.now()) &&
    Number(card.balance) > 0 &&
    (card.usage_limit == null || usageCount < Number(card.usage_limit))
  );
}

// Brand and category names for the scope captions. One query each, and an empty
// map is a fine fallback: the scope still reads as a slug or an id.
async function scopeNames() {
  const [brands, categories] = await Promise.all([
    pool.query("SELECT id, name FROM brands"),
    pool.query("SELECT slug, name FROM categories"),
  ]);
  return {
    brandNames: Object.fromEntries(brands.rows.map((b) => [b.id, b.name])),
    categoryNames: Object.fromEntries(categories.rows.map((c) => [c.slug, c.name])),
  };
}