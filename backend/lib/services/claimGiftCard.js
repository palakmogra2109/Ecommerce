// Turning a typed-in code into wallet money.
//
// This is the one transaction in the project where a string a stranger typed
// becomes a balance, so the shape of it is defensive on purpose:
//
//   * The code is looked up BY HASH, in exactly one query, and the plaintext is
//     never passed to the database, never logged and never put in an error. The
//     only thing that leaves this module on a refusal is a stable code string.
//   * The decision is taken on a row held FOR UPDATE, inside the same
//     transaction that credits the wallet and stamps the owner. Two customers
//     pressing the same button at the same instant are not merely unlikely to
//     double-spend: the second transaction blocks on the row, re-reads it after
//     the first commits, and sees a claim that is now there.
//   * The claim credits the FULL face value or it does not happen. A code is
//     all-or-nothing, so there is no partial figure anywhere in this file and
//     no path that writes a claimed_value other than face_value.
//   * The bucket's spend scope is frozen here, at claim time. Terms a customer
//     already redeemed cannot be rewritten by an admin editing the template
//     afterwards, in either direction.
//
// EXPIRED is never written. It is derived from expires_at by the model's
// effectiveStatus, so a clock tick cannot leave a stale stored value claiming a
// dead code is still good, and no sweeper has to run for expiry to be true.
import pool from "../db.js";
import { GiftCardCode, CODE_STATUS, DERIVED_EXPIRED } from "../models/giftCardCode.js";
import { Wallet } from "../models/wallet.js";
import { hashCode, normalizeCode } from "../giftCardCodeGen.js";
import { normalizeScope, scopeSummary } from "../giftCardApplicability.js";
import { round2 } from "../giftCardRules.js";

const BUCKET_TABLE = "customer_wallet_buckets";

// The stable reasons. These strings are the contract between this service and
// the endpoint that maps them to HTTP statuses, so they are matched on, never
// parsed out of a message. Adding a case here means adding a row to that map.
const CLAIM_REASON = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  REVOKED: "REVOKED",
  NOT_PAID: "NOT_PAID",
  NOT_YET_DELIVERED: "NOT_YET_DELIVERED",
  ALREADY_CLAIMED: "ALREADY_CLAIMED",
  EXPIRED: "EXPIRED",
  SCOPE_UNREADABLE: "SCOPE_UNREADABLE",
  NO_CUSTOMER: "NO_CUSTOMER",
});

// A shopper-facing sentence per reason. NOT_FOUND says only that nothing was
// found: a message that revealed "that code exists but is revoked" would turn
// this endpoint into an oracle for testing guessed codes, and one that said
// anything about the shape of the input would tell an attacker which part to
// change.
const CLAIM_MESSAGE = Object.freeze({
  NOT_FOUND: "We could not find a gift card for that code.",
  REVOKED: "This gift card has been revoked and cannot be added to your wallet.",
  NOT_PAID: "This gift card is still awaiting payment.",
  NOT_YET_DELIVERED: "This gift card has not been sent out yet.",
  ALREADY_CLAIMED: "This gift card has already been added to a wallet.",
  EXPIRED: "This gift card has expired.",
  SCOPE_UNREADABLE: "This gift card's spend restrictions could not be read, so nothing was added. Please contact support.",
  NO_CUSTOMER: "Your account does not have a wallet yet.",
});

/**
 * A refusal with a machine-readable reason.
 *
 * `code` is the whole contract. The endpoint maps it to a status and shows
 * `message`; it must never show a stack or an underlying driver error, because
 * those describe the inside of a money-moving transaction.
 */
export class ClaimError extends Error {
  constructor(code, message) {
    super(message || CLAIM_MESSAGE[code] || "This gift card could not be added to your wallet.");
    this.name = "ClaimError";
    this.code = code;
  }
}

const refuse = (code) => ({ ok: false, code, message: CLAIM_MESSAGE[code] });

/**
 * Whether a code may be claimed — the ONE decision, shared by the claim and the
 * preview so the two can never tell a customer two different things.
 *
 * The order matters and is the order the spec asks for, because more than one of
 * these can be true at once and the customer is owed the most useful answer:
 * a redeemed code that has since expired is ALREADY_CLAIMED (its history matters
 * more than its date), and a revoked code is REVOKED whatever its expiry says.
 * effectiveStatus only relabels an UNUSED code past its own expiry, which is
 * why EXPIRED can never shadow another reason.
 *
 * A row is either spendable or it is not: there is no partial verdict and no
 * amount, because the amount is always the face value.
 */
export function claimEligibility(row, { now = new Date() } = {}) {
  if (!row) return refuse(CLAIM_REASON.NOT_FOUND);

  const status = GiftCardCode.effectiveStatus(row, now);
  if (status === CODE_STATUS.REVOKED) return refuse(CLAIM_REASON.REVOKED);
  if (status === CODE_STATUS.PENDING_PAYMENT) return refuse(CLAIM_REASON.NOT_PAID);
  if (status === CODE_STATUS.SCHEDULED) return refuse(CLAIM_REASON.NOT_YET_DELIVERED);
  if (status === CODE_STATUS.REDEEMED) return refuse(CLAIM_REASON.ALREADY_CLAIMED);
  if (status === DERIVED_EXPIRED) return refuse(CLAIM_REASON.EXPIRED);

  // A claim without REDEEMED is a claim written outside this service. The
  // database CHECK ties claimed_by and claimed_at together but not either of
  // them to the status, so this is checked rather than assumed — the value is
  // spoken for either way, and crediting it a second time is the one mistake
  // this module exists to prevent.
  if (row.claimed_by || row.claimed_at) return refuse(CLAIM_REASON.ALREADY_CLAIMED);
  if (status !== CODE_STATUS.UNUSED) return refuse(CLAIM_REASON.ALREADY_CLAIMED);

  return {
    ok: true,
    claimedValue: round2(row.face_value),
    currency: row.currency || "INR",
  };
}

// The single place a plaintext becomes something safe to query. Returns the id
// and nothing else: the claim then re-reads the whole row under FOR UPDATE,
// which is the read that decides, and this one exists only to find it.
//
// Both entry points go through a hash-only lookup, so there is exactly one
// query shape in this file that could ever touch a code and it asks for a hash.
async function findCodeId(db, code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const result = await db.query(
    `SELECT id FROM ${GiftCardCode.TABLE} WHERE code_hash = $1`,
    [hashCode(normalized)]
  );
  return result.rows[0]?.id ?? null;
}

// The bucket stores the same [{ type, value }] pairs the applicability table
// holds, in that order, deduped and trimmed. An array is the shape the wallet
// model reads back (mapBucket drops anything that is not an array) and the
// shape its restricted-first ordering inspects, so an empty array genuinely
// reads as UNRESTRICTED there and not as a restriction that cannot be honoured.
//
// Returns null for a scope that normalizeScope could not read. That is the
// fail-closed path: storing it as an empty list would WIDEN a restriction
// nobody can interpret, so the claim is refused instead and no value moves.
function canonicalScope(scope) {
  const normalized = normalizeScope(scope);
  if (normalized.malformed) return null;
  const rows = [];
  for (const [key, type] of [
    ["brands", "BRAND"],
    ["categories", "CATEGORY"],
    ["productIds", "PRODUCT"],
  ]) {
    const seen = new Set();
    for (const value of normalized[key]) {
      const trimmed = String(value).trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      rows.push({ type, value: trimmed });
    }
  }
  return rows;
}

// Opens the bucket the value will sit in. remaining starts at zero and
// creditInTx is what fills it, which is the arrangement creditInTx documents:
// one write moves the money, so there is no window in which the bucket holds
// value that no ledger row accounts for.
async function openBucket(client, { wallet, code, applicability }) {
  const result = await client.query(
    `INSERT INTO ${BUCKET_TABLE}
       (wallet_id, code_id, currency, initial_value, remaining, applicability, expires_at)
     VALUES ($1, $2, $3, $4, 0, $5::jsonb, $6)
     RETURNING id`,
    [
      wallet.id,
      code.id,
      code.currency || wallet.currency || "INR",
      code.face_value,
      JSON.stringify(applicability),
      // The value ages out with the card that paid for it. A NULL expires_at
      // means the card never expires, and neither does the bucket.
      code.expires_at ?? null,
    ]
  );
  return result.rows[0];
}

/**
 * The whole claim, in the caller's transaction.
 *
 * Exported because several real callers need the claim to be part of a larger
 * transaction rather than a transaction of its own: issuing a code and claiming
 * it, or claiming a code as part of an order that must not exist if the claim
 * fails. Those callers already hold a transaction and must not have a nested
 * BEGIN underneath them.
 *
 * Split out from claimGiftCard so the BEGIN/COMMIT/ROLLBACK/release scaffolding
 * exists in exactly one place, whichever connection the transaction runs on.
 *
 * Throws ClaimError; returns the same shape claimGiftCard does. It performs no
 * commit of its own, so a caller that uses it directly owns the outcome.
 */
export async function claimInTx(client, { code, customerId, now = new Date() }) {
  if (!customerId) throw new ClaimError(CLAIM_REASON.NO_CUSTOMER);

  const codeId = await findCodeId(client, code);
  if (!codeId) throw new ClaimError(CLAIM_REASON.NOT_FOUND);

  // The locked read is the decision. Under READ COMMITTED a transaction that
  // blocked on this row re-reads it when the lock is granted, so the loser of a
  // race sees the winner's claim rather than the claimed_by = NULL it read
  // before it blocked.
  const row = await GiftCardCode.lockById(codeId, client);
  if (!row) throw new ClaimError(CLAIM_REASON.NOT_FOUND);

  const verdict = claimEligibility(row, { now });
  if (!verdict.ok) throw new ClaimError(verdict.code, verdict.message);

  // A code is all-or-nothing: what the customer receives is the face value, and
  // anything else would mean the card was silently worth less than it says.
  const claimedValue = verdict.claimedValue;

  const scope = canonicalScope(await GiftCardCode.applicabilityForTemplate(row.template_id, { client }));
  if (!scope) throw new ClaimError(CLAIM_REASON.SCOPE_UNREADABLE);

  const wallet = await Wallet.ensureForCustomer(customerId, { client });
  const bucket = await openBucket(client, { wallet, code: row, applicability: scope });

  // creditInTx moves the money and appends the CREDIT row in one place, so
  // balance_after is read back off the wallet rather than computed here — which
  // is what keeps it the running total instead of this row's own amount.
  await Wallet.creditInTx(client, {
    customerId,
    bucket,
    codeId: row.id,
    reference: "CLAIM",
    description: "Gift card claimed",
    metadata: { codeId: row.id, templateId: row.template_id, codeLast4: row.code_last4 },
    amount: claimedValue,
  });

  const stamped = await client.query(
    `UPDATE ${GiftCardCode.TABLE}
        SET status = $1, claimed_by = $2, claimed_at = now(), claimed_value = $3, updated_at = now()
      WHERE id = $4 AND claimed_by IS NULL
      RETURNING id`,
    [CODE_STATUS.REDEEMED, customerId, claimedValue, row.id]
  );
  // The guarded write is the backstop, not the strategy — the lock above is what
  // makes a race impossible. It is here so that anything which reaches this line
  // without holding the lock cannot hand a second copy of the value to a wallet
  // on its way out.
  if (!stamped.rows.length) {
    throw new ClaimError(CLAIM_REASON.ALREADY_CLAIMED);
  }

  return {
    ok: true,
    claimedValue,
    currency: verdict.currency,
    balanceAfter: round2(await Wallet.totalForWalletId(client, wallet.id)),
    bucketId: Number(bucket.id),
  };
}

/**
 * Claims a code into a customer's wallet. All of it, or none of it.
 *
 * Takes a client from the pool unless one is passed, and always opens its own
 * transaction on it. The caller may pass the connection it holds, but it must be
 * one that is not already inside a transaction: the BEGIN and COMMIT happen
 * here, and a claim that published a bucket without stamping the code — or the
 * reverse — would be worth less than the card.
 *
 * Returns { ok: true, claimedValue, currency, balanceAfter, bucketId }, the
 * value the customer actually received so the UI can confirm it, and throws a
 * ClaimError carrying a stable `code` for everything else.
 */
export async function claimGiftCard({ code, customerId, client } = {}) {
  const owned = client ? null : await pool.connect();
  const runner = owned || client;
  try {
    await runner.query("BEGIN");
    const claimed = await claimInTx(runner, { code, customerId });
    await runner.query("COMMIT");
    return claimed;
  } catch (error) {
    // Safe to call on an aborted connection: a failed statement has already
    // poisoned this transaction, so the rollback is best-effort by necessity.
    await runner.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    // Only a connection this call checked out is this call's to hand back.
    if (owned) owned.release();
  }
}

/**
 * What a code is worth, read-only. This is what lets the UI say "this card is
 * worth ₹1,000" before the customer commits, and it writes nothing at all: no
 * lock, no bucket, no wallet, no ledger row, and no timestamp touched.
 *
 * It answers from claimEligibility, the same function the claim answers from,
 * so the preview cannot promise something the claim will then refuse. It
 * returns a verdict rather than throwing, because "no, this one is used up" is
 * an answer the caller wants to display, not an exception.
 *
 * `scopeLabel` is part of the answer rather than something the endpoint looks
 * up, for two reasons. The shopper needs it to understand what the money is
 * FOR before they commit ("spices only" is a different offer from "any
 * product"), and it is read here through the same normalizeScope →
 * scopeSummary pair the wallet route captions buckets with, so a card and the
 * bucket it will open can never be captioned two different ways.
 *
 * It is resolved only for a code that is actually claimable. A refusal has
 * already told the customer the code exists and what is wrong with it; adding
 * its template's scope to that answer would hand out one more fact about a code
 * they cannot use, and the claim never reaches the applicability table on that
 * path either.
 */
export async function previewClaim({ code, client } = {}) {
  const db = client || pool;
  const row = await GiftCardCode.findByPlaintext(code, { client: db });
  const verdict = claimEligibility(row);

  // From the raw applicability rows, not scopeSummary(normalizeScope(rows)):
  // normalizeScope does not trust a malformed flag it is handed, and an
  // already-folded object carries only the three known keys, so folding first
  // would reset the flag and caption an unreadable restriction as "All
  // products". One normalisation, off the raw column, is the fail-closed one.
  const scopeLabel = verdict.ok
    ? scopeSummary(await GiftCardCode.applicabilityForTemplate(row.template_id, { client: db }))
    : null;

  const common = {
    status: row?.status ?? null,
    effectiveStatus: row ? GiftCardCode.effectiveStatus(row) : null,
    expiresAt: row?.expires_at ?? null,
    reason: verdict.ok ? null : verdict.code,
    message: verdict.ok
      ? "This gift card can be added to your wallet."
      : verdict.message,
    faceValue: verdict.ok ? verdict.claimedValue : null,
    currency: verdict.ok ? verdict.currency : null,
    scopeLabel,
  };

  return { ...common, claimable: verdict.ok === true };
}