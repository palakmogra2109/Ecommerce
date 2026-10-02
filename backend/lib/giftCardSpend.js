// Spending the v2 wallet at checkout.
//
// The customer panel already shows ONE balance — the legacy gift_cards plus the
// buckets a redeemed code opens — and only the legacy half of it could be spent
// at checkout. A customer who redeemed a code therefore saw money they were not
// allowed to use. This module is the seam that closes that, and it exists as one
// file because the interesting failure here is not a bug in either route: it is
// the quote and the charge disagreeing, with nothing reporting it.
//
// THE SHAPE BRIDGE. The allocator is pure and wants buckets shaped
// `{ id, amount, scope }`; Wallet.bucketsFor returns
// `{ id, codeId, remaining, initialValue, applicability, expiresAt }`. The two
// do not agree on names, and `remaining → amount` / `applicability → scope` is
// translated in exactly one function below, used by the quote preview AND by the
// order transaction. A second copy of that translation is how a quoted price and
// a charged price drift apart, and the failure is silent in the worst way: pass
// `remaining` where `amount` is wanted and every bucket arrives worth nothing, so
// the wallet pays ₹0, `covered` is 0, and no error anywhere says a word about it.
import { allocate } from "./giftCardBuckets.js";
import { isUnrestricted, normalizeScope, round2, scopeSummary } from "./giftCardApplicability.js";
import { Wallet } from "./models/wallet.js";

// A bucket id as the allocator and the wallet's own allocation normaliser want
// it: a number. BIGSERIAL comes back from pg as a string, and an id that is
// "12" in one place and 12 in another makes every comparison a guess.
function bucketId(value) {
  if (value == null || value === "") return null;
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

/**
 * Wallet buckets → allocator buckets. The only translation between the two
 * shapes in the codebase.
 *
 * `scope` is the raw `applicability` column passed through normalizeScope, with
 * one deliberate exception. normalizeScope does not trust a `malformed` flag it
 * is handed — it recomputes it — and recomputing from an already-folded object
 * sees only the three known keys, so a malformed scope folded once and folded
 * again comes back UNRESTRICTED. That is a fail-open on a value the whole
 * applicability layer is built to fail closed on, so a scope that does not
 * normalise cleanly is handed on in its raw form: the allocator folds it exactly
 * once and the refusal survives. A clean scope is idempotent under folding, so
 * this costs nothing in the normal case.
 */
export function toAllocatorBuckets(buckets) {
  const list = Array.isArray(buckets) ? buckets : [];
  return list.map((bucket) => {
    const raw = bucket?.applicability ?? null;
    const folded = normalizeScope(raw);
    return {
      id: bucketId(bucket?.id),
      amount: round2(bucket?.remaining),
      scope: folded.malformed ? raw : folded,
    };
  });
}

/**
 * What spending this wallet against this basket would do. Pure — no DB, no
 * clock, no randomness — because the quote has to be able to answer this before
 * anything exists to answer it about, and the order transaction has to be able
 * to answer it identically afterwards.
 *
 * `lineItems` is what bounds a restricted bucket. An array (including an empty
 * one) is the real basket, so a restricted card can only be spent against the
 * lines its own scope permits; absent means the caller had no basket to give,
 * which allocate treats as unbounded capacity. That asymmetry is the caller's
 * decision, not this function's.
 *
 * `breakdown` exists because "covered: 300" is an answer a shopper cannot act
 * on. WHICH balance funded WHAT is the question a restricted wallet raises —
 * why did my spices card pay for the rice — so every bucket is listed, the ones
 * that paid say by how much, and the ones that did not say why.
 */
export function planWalletSpend({ buckets = [], lineItems = null, amount = 0 } = {}) {
  const list = Array.isArray(buckets) ? buckets : [];
  const result = allocate({ buckets: toAllocatorBuckets(list), amount, lineItems });

  // Keyed by string because allocate hands back whatever id it was given, and
  // a Map keyed loosely is a lookup that can quietly miss.
  const paid = new Map(result.allocations.map((line) => [String(line.bucketId), line.amount]));
  const cartKnown = Array.isArray(lineItems);

  const breakdown = toAllocatorBuckets(list).map((planned, index) => {
    const bucket = list[index] || {};
    const spent = round2(paid.get(String(planned.id)) ?? 0);
    const balance = round2(bucket.remaining);
    // From the RAW applicability, never from the folded copy, for the same
    // reason the wallet panel does it that way: scopeSummary(normalizeScope(x))
    // is a fail-open and captions an unreadable restriction as "All products".
    const scope = bucket.applicability ?? null;
    const restricted = !isUnrestricted(scope);
    return {
      bucketId: planned.id,
      codeId: bucket.codeId ?? null,
      label: `Gift balance ${planned.id}`,
      scopeLabel: scopeSummary(scope),
      restricted,
      amount: spent,
      balanceBefore: balance,
      balanceAfter: round2(balance - spent),
      applied: spent > 0,
      reason: spent > 0 ? null : skipReason({ restricted, cartKnown, covered: result.covered }),
    };
  });

  return {
    allocations: result.allocations,
    covered: result.covered,
    shortfall: result.shortfall,
    fullyCovered: result.fullyCovered,
    breakdown,
  };
}

// Why a bucket that holds money paid nothing. Restricted value is the case worth
// naming: the shopper funded the order with one card and wonders where the other
// went, and "it could not pay for anything in this basket" is the answer.
function skipReason({ restricted, cartKnown, covered }) {
  if (restricted && cartKnown) {
    return "Nothing in this order is within this balance's scope.";
  }
  if (covered > 0) return "An earlier balance already covered this order.";
  return "This balance could not be used on this order.";
}

/**
 * The authoritative spend, inside the caller's transaction.
 *
 * Loads the buckets, plans the SAME spend planWalletSpend would plan for a
 * preview, and debits it. Owns no commit: the order transaction does, so an
 * order that cannot be placed leaves the wallet exactly as it was. Refuses a
 * missing `client` rather than falling back to the pool — a helper that quietly
 * opened its own transaction would publish half an order.
 *
 * The buckets are locked BEFORE the plan is taken, in one ascending-id
 * statement. That ordering is the point and matches debitInTx's own: two
 * checkouts drawing on the same buckets take the same lock order, so the second
 * waits instead of deadlocking. Because the plan is taken under the lock, the
 * loser of a race re-reads the reduced remainder and plans a SMALLER spend
 * rather than discovering at the debit that the money is gone — and debitInTx
 * still refuses anything that does not fit, because a plan is a plan and the
 * balance can move between it and the write.
 */
export async function spendGiftCardBalanceInTx(
  client,
  { customerId, lineItems = null, amount = 0, orderUuid = null, reference = null } = {}
) {
  if (!client) throw new Error("spendGiftCardBalanceInTx must run inside the caller's transaction");

  // No customer, no wallet, no spend: a guest checkout is an ordinary case and
  // not an error. The plan is still returned so a caller has one shape to read.
  if (!customerId) return planWalletSpend({ buckets: [], lineItems, amount });

  const wallet = await Wallet.findByCustomer(customerId, { client });
  if (!wallet) return planWalletSpend({ buckets: [], lineItems, amount });

  // Every bucket of this wallet, not just the spendable ones. Re-stating the
  // "spendable" predicate here would give the definition of a spendable bucket
  // two homes, and the lock has to cover every row a later read could use —
  // holding all of them costs a little concurrency and buys the guarantee that
  // the read below cannot change underfoot.
  await client.query(
    `SELECT id FROM ${Wallet.BUCKET_TABLE} WHERE wallet_id = $1 ORDER BY id FOR UPDATE`,
    [wallet.id]
  );

  const buckets = await Wallet.bucketsFor(customerId, { client });
  const plan = planWalletSpend({ buckets, lineItems, amount });
  if (!(plan.covered > 0)) {
    return { ...plan, balanceAfter: round2(await Wallet.totalForWalletId(client, wallet.id)) };
  }

  const balanceAfter = await Wallet.debitInTx(client, {
    customerId,
    allocations: plan.allocations,
    orderUuid,
    reference,
  });
  return { ...plan, balanceAfter };
}

/**
 * Which buckets paid for an order, read back off the ledger.
 *
 * The order route persists nothing extra for this: every debit already writes one
 * ledger row per bucket carrying bucket_id, the signed amount and the order uuid,
 * so the allocation list a refund needs IS the debit history, and re-deriving it
 * here means there is no second copy of the fact that can drift from the first.
 * (It is also why no column was added to `orders` for this batch — see the
 * report.)
 */
export async function walletAllocationsForOrder(db, orderUuid) {
  if (!orderUuid) return [];
  const result = await db.query(
    `SELECT bucket_id, COALESCE(SUM(-amount), 0) AS amount
       FROM ${Wallet.LEDGER_TABLE}
      WHERE type = 'DEBIT' AND order_uuid = $1::uuid AND bucket_id IS NOT NULL
      GROUP BY bucket_id
      ORDER BY bucket_id`,
    [orderUuid]
  );
  return result.rows.map((row) => ({ bucketId: bucketId(row.bucket_id), amount: round2(row.amount) }));
}

/**
 * Which wallet an order's money came out of, and therefore whose wallet it goes
 * back to.
 *
 * Read off the debit rows rather than off the order, because the debit is the
 * evidence: it names the wallet, and the ledger cascades away with it, so an
 * order whose wallet no longer exists simply has nothing to refund rather than
 * a wallet to invent.
 */
export async function walletOwnerForOrder(db, orderUuid) {
  if (!orderUuid) return null;
  const result = await db.query(
    `SELECT w.customer_id
       FROM ${Wallet.LEDGER_TABLE} l
       JOIN ${Wallet.WALLET_TABLE} w ON w.id = l.wallet_id
      WHERE l.type = 'DEBIT' AND l.order_uuid = $1::uuid
      LIMIT 1`,
    [orderUuid]
  );
  const row = result.rows[0];
  return row ? Number(row.customer_id) : null;
}

/**
 * Returns an order's wallet spend to the buckets it came out of.
 *
 * Refunding to the wallet total instead would move a brand-restricted card's
 * money into unrestricted spending, which is the one thing the scope frozen at
 * claim time exists to prevent. refundInTx restores bucket by bucket and caps
 * each at what is still unrefunded, so a retried refund books zero and creates
 * no value.
 *
 * In the caller's transaction, for the same reason as the spend: a bucket
 * restored without its REFUND row (or the reverse) is money that appears out of
 * nowhere. An order that never spent from a wallet restores nothing — which is
 * the ordinary case for every order placed before this existed.
 */
export async function refundWalletSpendInTx(client, { orderUuid, reference = null } = {}) {
  if (!client) throw new Error("refundWalletSpendInTx must run inside the caller's transaction");

  const allocations = await walletAllocationsForOrder(client, orderUuid);
  if (allocations.length === 0) return 0;

  const customerId = await walletOwnerForOrder(client, orderUuid);
  if (!customerId) return 0;

  return Wallet.refundInTx(client, { customerId, allocations, orderUuid, reference });
}
