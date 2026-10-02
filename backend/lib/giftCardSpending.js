import { allocateAcrossCards, isCardUsable, round2 } from "./giftCardRules.js";

/**
 * Locks the candidate gift cards and decides how much each one contributes to
 * the order being placed.
 *
 * The caller must already be inside the order transaction; everything here
 * runs on that transaction's client so a rollback undoes the locks too.
 *
 * Two correctness points that are easy to get wrong:
 *
 *  1. Locks are taken with one statement in ascending id order. Locking cards
 *     one at a time, or in whatever order the allocation happens to visit
 *     them, deadlocks two shoppers who each hold two cards in the opposite
 *     order. Ascending id is a global order both transactions agree on.
 *
 *  2. Status, expiry and usage are re-read *after* the lock, not from the
 *     caller's pre-lock snapshot. A card can be suspended or spent by another
 *     transaction between the quote and here.
 *
 * Returns { total, lines } where each line is
 * { cardId, codeLast4, amount, balanceBefore, balanceAfter }.
 */
export async function lockAndAllocate(client, { cards = [], remaining = 0, items = null } = {}) {
  const ids = (cards || []).map((c) => c.id).filter((v) => v != null);
  if (ids.length === 0) return { total: 0, lines: [] };

  // Ascending id: the lock order every transaction must agree on.
  const orderedIds = [...new Set(ids)].sort((a, b) => Number(a) - Number(b));

  const locked = await client.query(
    `SELECT id, code_last4, code, balance, status, usage_limit,
            max_redemption_amount, expires_at, recipient_email,
            applicable_brands, applicable_categories, applicable_products
     FROM gift_cards
     WHERE id = ANY($1::bigint[])
     ORDER BY id
     FOR UPDATE`,
    [orderedIds]
  );

  // Usage is counted under the same lock, so a card that a concurrent
  // transaction just spent against its last use is seen as spent here.
  const usage = await client.query(
    `SELECT gift_card_id, COUNT(*)::int AS count
     FROM gift_card_transactions
     WHERE type = 'REDEEM' AND gift_card_id = ANY($1::bigint[])
     GROUP BY gift_card_id`,
    [orderedIds]
  );
  const usageCounts = Object.fromEntries(usage.rows.map((r) => [Number(r.gift_card_id), r.count]));

  const now = Date.now();
  const live = locked.rows.map((r) => ({
    ...r,
    balance: Number(r.balance) || 0,
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
  }));

  const { total, lines } = allocateAcrossCards(live, {
    remaining,
    // items lets scope rules (brand / category / product) be judged against
    // the real basket rather than assumed away.
    usable: (card) =>
      isCardUsable(card, { now, usageCount: usageCounts[card.id] || 0, items }),
  });

  // Trim to the cards that actually contribute, in the order they will be
  // written, and carry the before/after balance for the ledger.
  const out = [];
  let running = new Map();
  for (const { card, amount } of lines) {
    const before = Number(running.get(card.id) ?? card.balance);
    const after = round2(before - amount);
    running.set(card.id, after);
    out.push({
      cardId: card.id,
      amount,
      balanceBefore: before,
      balanceAfter: after,
      expiresAt: card.expires_at,
    });
  }

  return { total, lines: out };
}

// Applies the allocation. One UPDATE per card, each guarded by the balance it
// was computed from. We already hold the lock so that guard cannot fail in
// practice, but if it ever did, writing a ledger row for a card we never
// debited would corrupt the books — so it throws and the order rolls back.
export async function applyAllocation(client, lines, { performedBy = null, recipientEmail = null } = {}) {
  for (const line of lines) {
    const updated = await client.query(
      `UPDATE gift_cards
       SET balance = $1::numeric,
           status = CASE WHEN $1::numeric <= 0 THEN 'REDEEMED' ELSE status END,
           recipient_email = COALESCE(recipient_email, $2),
           updated_at = now()
       WHERE id = $3 AND balance = $4::numeric`,
      [line.balanceAfter, recipientEmail, line.cardId, line.balanceBefore]
    );

    if (updated.rowCount !== 1) {
      throw new Error(`Gift card ${line.cardId} changed while it was locked`);
    }

    const inserted = await client.query(
      `INSERT INTO gift_card_transactions
         (gift_card_id, type, amount, balance_before, balance_after, performed_by, reason)
       VALUES ($1, 'REDEEM', $2, $3, $4, $5, 'Checkout redemption')
       RETURNING id`,
      [line.cardId, line.amount, line.balanceBefore, line.balanceAfter, performedBy]
    );
    line.transactionId = inserted.rows[0].id;
  }

  return lines;
}
