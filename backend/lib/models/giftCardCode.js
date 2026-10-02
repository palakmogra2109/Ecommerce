// An issued gift-card code: the thing a shopper actually holds.
//
// Codes are matched by sha256 hash, never by plaintext, so a database dump
// cannot be replayed at checkout and a support agent reading a table cannot
// spend a customer's card. The plaintext is therefore never stored and never
// returned by a lookup — issueInTx hands it back exactly once, deliberately,
// for the delivery step.
//
// EXPIRED is not a status. It is derived from expires_at at read time, so a
// clock tick can never leave a stale stored value claiming a dead code is still
// good, and no sweeper has to run for expiry to be true. That is why
// CODE_STATUS has five values while the system speaks of six.
import pool from "../db.js";
import { codeLast4, hashCode, normalizeCode } from "../giftCardCodeGen.js";

const TABLE = "gift_card_codes";
const TEMPLATE_TABLE = "gift_cards";
const APPLICABILITY_TABLE = "gift_card_applicability";

// Mirrors the CHECK on gift_card_codes.status exactly. EXPIRED is deliberately
// absent: it is derived from expires_at (see effectiveStatus), never stored.
export const CODE_STATUS = Object.freeze({
  PENDING_PAYMENT: "PENDING_PAYMENT",
  UNUSED: "UNUSED",
  REDEEMED: "REDEEMED",
  REVOKED: "REVOKED",
  SCHEDULED: "SCHEDULED",
});

// The derived status, which is deliberately not in CODE_STATUS because no row
// ever stores it.
export const DERIVED_EXPIRED = "EXPIRED";

const COLUMNS =
  "id, uuid, template_id, purchase_id, code_hash, code_last4, status, currency," +
  " face_value, claimed_value, claimed_by, claimed_at, expires_at, revoked_at," +
  " revoked_reason, revoked_by, created_at, updated_at";

// A code is spendable exactly when it is UNUSED and inside its own validity.
// Anything past that is dead money: redeemed, revoked, scheduled for a future
// send, or not yet paid for.
const SPENDABLE_STATUS = CODE_STATUS.UNUSED;

// money columns come back from pg as NUMERIC strings, so every one of them is
// turned into a Number at the edge rather than at each read site.
function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    face_value: Number(row.face_value) || 0,
    claimed_value: Number(row.claimed_value) || 0,
  };
}

export const GiftCardCode = {
  TABLE,
  CODE_STATUS,

  /**
   * Mints one code from a paid template, in the caller's transaction.
   *
   * No transaction of its own, for the same reason creditInTx opens none: the
   * issuance, its purchase row and its wallet credit are one atomic step, and a
   * helper that quietly committed would publish a code for an order that then
   * rolled back. A missing `client` is a thrown error, not a fallback.
   *
   * The face value comes from the template rather than the caller, so a code can
   * never be issued for more than its card was sold for, and the CHECK on
   * claimed_value <= face_value stays meaningful instead of being an accident.
   *
   * Returns the row with the plaintext attached under `code`, once. Nothing else
   * in this module ever produces a plaintext, so this is the single place where
   * a full code exists outside the customer's hands — the caller must put it in
   * front of them and drop it.
   */
  async issueInTx(client, { templateId, purchaseId = null, code, expiresAt = null } = {}) {
    if (!client) throw new Error("issueInTx must run inside the caller's transaction");
    if (!templateId) throw new Error("Issuing a code requires a template");
    const normalized = normalizeCode(code);
    if (!normalized) throw new Error("Issuing a code requires a plaintext code");

    const template = await client.query(
      `SELECT id, currency, initial_amount, expires_at, validity_days
       FROM ${TEMPLATE_TABLE} WHERE id = $1`,
      [templateId]
    );
    const card = template.rows[0];
    if (!card) throw new Error(`Gift card template ${templateId} does not exist`);

    const faceValue = Number(card.initial_amount) || 0;
    if (!(faceValue > 0)) {
      throw new Error(`Gift card template ${templateId} has no value to issue`);
    }

    // An explicit expiry wins; otherwise the template's own, and failing that
    // validity_days counted from now. Never a default "never expires": a gift
    // card with no end date is a liability nobody can write off.
    let expiry = expiresAt || card.expires_at || null;
    if (!expiry && card.validity_days != null) {
      expiry = new Date(Date.now() + Number(card.validity_days) * 86400000);
    }

    try {
      const result = await client.query(
        `INSERT INTO ${TABLE}
           (template_id, purchase_id, code_hash, code_last4, status, currency,
            face_value, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${COLUMNS}`,
        [
          templateId,
          purchaseId,
          hashCode(normalized),
          codeLast4(normalized),
          // Issued means paid for. PENDING_PAYMENT is for a code minted before
          // the payment lands; SCHEDULED is for one a sender chose to release
          // on a date.
          CODE_STATUS.UNUSED,
          card.currency || "INR",
          faceValue,
          expiry,
        ]
      );
      const row = mapRow(result.rows[0]);
      // The plaintext goes out exactly here, and nowhere else. It is deliberately
      // absent from RETURNING so no other reader of this row can ever see it.
      return { ...row, code: normalized };
    } catch (error) {
      // The unique index on code_hash is the backstop against a collision between
      // two concurrent issuances, and a caller that generated this code needs to
      // hear "already issued", not "duplicate key value violates unique
      // constraint". Anything else is a real fault.
      if (String(error?.code) === "23505") {
        throw new Error("That gift card code has already been issued");
      }
      if (String(error?.code) === "23514") {
        throw new Error(`The gift card code was refused by a database constraint; the transaction has been aborted`);
      }
      throw error;
    }
  },

  // Lookup by the code the shopper typed. hashCode() normalises first, so
  // case, surrounding whitespace and spaces-for-hyphens all find the same row —
  // which is the whole reason codes are printed in groups of four.
  async findByPlaintext(code, { client } = {}) {
    const db = client || pool;
    const normalized = normalizeCode(code);
    if (!normalized) return null;
    const result = await db.query(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE code_hash = $1`,
      [hashCode(normalized)]
    );
    return mapRow(result.rows[0]);
  },

  async findByUuid(uuid, { client } = {}) {
    const db = client || pool;
    const result = await db.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE uuid = $1`, [uuid]);
    return mapRow(result.rows[0]);
  },

  /**
   * The claim service's entry point: read a code and hold it while deciding
   * whether it may be claimed.
   *
   * The FOR UPDATE is the whole point. Two customers redeeming the same code at
   * the same moment would both read claimed_by = NULL, both decide yes, and the
   * second write would either double-credit a wallet or be lost to the first
   * one; with the lock, the second transaction reads the row again after the
   * first commits and sees the claim that is now there.
   *
   * A `client` is optional only so this can be read outside a transaction. Under
   * autocommit the lock is released the instant the statement finishes, so a
   * caller that intends to write must pass its transaction client.
   */
  async lockById(id, client = null) {
    const db = client || pool;
    if (!id) return null;
    const result = await db.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE id = $1 FOR UPDATE`, [id]);
    return mapRow(result.rows[0]);
  },

  // A NULL expires_at never expires, which is the one case a "missing date"
  // must not be read as "expired".
  isExpired(row, now = new Date()) {
    if (!row?.expires_at) return false;
    const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
    return new Date(row.expires_at).getTime() < (Number.isFinite(at) ? at : Date.now());
  },

  // What a code is worth right now: its stored status, except that an UNUSED
  // code past its own expiry reads as EXPIRED.
  //
  // Derived and deliberately NOT written back. Writing it would need a sweeper,
  // and every second between the sweeper's runs would be a second in which a
  // dead code still claims to be live; the read-time rule has no window at all.
  // The only reason a REDEEMED or REVOKED code is not re-labelled EXPIRED is
  // that its real history matters more to a support agent than its date.
  effectiveStatus(row, now = new Date()) {
    if (!row) return null;
    if (row.status === SPENDABLE_STATUS && this.isExpired(row, now)) return DERIVED_EXPIRED;
    return row.status;
  },

  /**
   * Kills a code, in the caller's transaction.
   *
   * Refuses a code that has already been claimed. The value is no longer the
   * store's to take: it sits in the customer's wallet, and gift_card_codes' own
   * CHECK (status <> 'REVOKED' OR claimed_by IS NULL) exists for the same
   * reason. Letting this through would either fail as a bare constraint error
   * mid-transaction or — worse, without that CHECK — leave a REVOKED code whose
   * value is still spendable.
   *
   * `performedBy` is a user id and is stored in gift_card_codes.revoked_by, added
   * by migration 019. It was previously folded into the reason text, which lost
   * the difference between who acted and why. NULL is allowed: a code can also
   * lapse on its own. The ledger row the caller books alongside this remains the
   * machine-readable audit trail.
   */
  async revokeInTx(client, { id, reason = null, performedBy = null } = {}) {
    if (!client) throw new Error("revokeInTx must run inside the caller's transaction");
    if (!id) throw new Error("Revoking a code requires its id");

    const row = await this.lockById(id, client);
    if (!row) throw new Error(`Gift card code ${id} does not exist`);

    if (row.claimed_by) {
      throw new Error(
        "This gift card has already been claimed, so its value belongs to the customer and cannot be revoked"
      );
    }
    if (row.status === CODE_STATUS.REVOKED) {
      // Idempotent for the same reason GiftCardReservation.confirm() is: a
      // retried admin action reports the state instead of failing.
      return { ...row, duplicate: true };
    }
    if (this.effectiveStatus(row) === DERIVED_EXPIRED) {
      // Not an error — it is already dead — but the reason must say so, or the
      // audit reads as though an expiry was a revocation.
      reason = reason || "Already expired";
    }

    const result = await client.query(
      `UPDATE ${TABLE}
       SET status = $1, revoked_at = now(), revoked_reason = $2, revoked_by = $3, updated_at = now()
       WHERE id = $4
       RETURNING ${COLUMNS}`,
      [CODE_STATUS.REVOKED, reason || "Revoked", performedBy || null, id]
    );
    return mapRow(result.rows[0]);
  },

  /**
   * What a template's money may be spent on, as [{ type, value }].
   *
   * gift_card_applicability stores one row per (template, kind, value) rather
   * than a JSON blob, so restrictions are indexable and answerable in reverse.
   * The column is `kind`, and it is renamed to `type` on the way out: inside
   * the database the pair is (template, kind, value) and outside it is a
   * portable (type, value) pair, which is what a bucket freezes at claim time.
   *
   * An empty array means UNRESTRICTED, not restricted-to-nothing — the absence
   * of rows is the whole signal, and it has to stay a cheap valid state.
   *
   * Note this is the row-per-restriction form. Folding it into the
   * `{ brands, categories, productIds }` object that giftCardApplicability's
   * isEligible/isUnrestricted read is the caller's step, because only the caller
   * knows which line items are on the table.
   */
  async applicabilityForTemplate(templateId, { client } = {}) {
    const db = client || pool;
    if (!templateId) return [];
    const result = await db.query(
      `SELECT kind, value FROM ${APPLICABILITY_TABLE}
       WHERE template_id = $1 ORDER BY kind, value`,
      [templateId]
    );
    return result.rows.map((row) => ({ type: row.kind, value: row.value }));
  },

  // Every code issued from one template, newest first. Admin screens and the
  // purchase detail page both need this, and neither should be able to reach the
  // plaintext.
  async listForTemplate(templateId, { client, limit = 100 } = {}) {
    const db = client || pool;
    if (!templateId) return [];
    const result = await db.query(
      `SELECT ${COLUMNS} FROM ${TABLE}
       WHERE template_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [templateId, limit]
    );
    return result.rows.map(mapRow);
  },

  async listForPurchase(purchaseId, { client } = {}) {
    const db = client || pool;
    if (!purchaseId) return [];
    const result = await db.query(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE purchase_id = $1 ORDER BY id`,
      [purchaseId]
    );
    return result.rows.map(mapRow);
  },

  // Never returns `code`, `codeHash` or anything else that could confirm a
  // guess. The codes table has no plaintext to leak, so masking is about the
  // hash: it is what an offline attacker needs to test candidates cheaply.
  maskRow(row) {
    if (!row) return row;
    const { code_hash: codeHash, ...rest } = row;
    return {
      ...rest,
      // Same rule as giftCardRules.maskCode: the hash's presence is what says a
      // full code exists, and without one there is nothing to hide.
      code: codeHash ? `••••-${row.code_last4 || "••••"}` : null,
      code_last4: row.code_last4 || null,
    };
  },
};