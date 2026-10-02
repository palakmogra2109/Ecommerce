// The customer wallet: one row per customer, a set of buckets inside it, and an
// append-only ledger that audits itself.
//
// There is deliberately no stored balance. A total column is a second source of
// truth for a fact the ledger already holds, and it drifts the first time a
// transaction and its balance update disagree — with nothing in the database
// noticing. So the balance is the SUM of the live buckets, and the overdraft
// guard lives on the ledger's own balance_after, which Postgres can enforce.
//
// Money is handled in rupees and settled through round2 at every step, the same
// way giftCardReservation does it. A bucket's own remainder and the wallet total
// are therefore always whole paise, and repeated subtraction cannot leak float
// dust into an amount charged.
import pool from "../db.js";
import { round2 } from "../giftCardRules.js";

const WALLET_TABLE = "customer_wallets";
const BUCKET_TABLE = "customer_wallet_buckets";
const LEDGER_TABLE = "customer_reward_transactions";

// Mirrors the CHECK on customer_reward_transactions.type. EXPIRY is a debit
// (value that aged away) and ADJUSTMENT is the only type allowed either sign,
// because a correction has no direction of its own.
export const LEDGER_TYPE = Object.freeze({
  CREDIT: "CREDIT",
  DEBIT: "DEBIT",
  REFUND: "REFUND",
  EXPIRY: "EXPIRY",
  ADJUSTMENT: "ADJUSTMENT",
});

// Types whose amount must be strictly greater than zero.
const INFLOW_TYPES = Object.freeze([LEDGER_TYPE.CREDIT, LEDGER_TYPE.REFUND]);

// Types whose amount must be strictly less than zero: a magnitude written with
// a minus sign, so the sign is carried by the number and not inferred from the
// type at every read site.
const OUTFLOW_TYPES = Object.freeze([LEDGER_TYPE.DEBIT, LEDGER_TYPE.EXPIRY]);

// A bucket is restricted when its frozen applicability is a non-empty array. The
// jsonb_typeof guard keeps the ordering from raising on a malformed value: an
// object shape (the { brands, categories, productIds } form isEligible reads)
// is compared directly, and anything unrecognised sorts last rather than
// pretending to be unrestricted.
const RESTRICTED_FIRST = `
  CASE
    WHEN applicability IS NULL THEN 1
    WHEN jsonb_typeof(applicability) = 'array'
      THEN CASE WHEN jsonb_array_length(applicability) = 0 THEN 1 ELSE 0 END
    WHEN jsonb_typeof(applicability) = 'object'
      THEN CASE WHEN applicability = '{}'::jsonb THEN 1 ELSE 0 END
    ELSE 1
  END`;

// The only buckets a customer may spend: live, holding something, not past its
// own expiry. A NULL expires_at never expires.
const SPENDABLE_BUCKET = `is_active AND remaining > 0
       AND (expires_at IS NULL OR expires_at > now())`;

/**
 * Normalises one ledger row, so a signed amount can never be written with the
 * wrong direction.
 *
 * The database stores a *signed delta* rather than a magnitude (see
 * customer_reward_transactions.amount): DEBIT is negative, REFUND is positive.
 * Magnitudes alone would force every reader to infer the sign from `type`, and
 * every type added later would carry its sign by convention instead of by
 * check. This is where that convention becomes enforceable — a CREDIT with a
 * negative amount and a DEBIT with a positive one are both bugs that would
 * otherwise show up much later as a wallet total that does not reconcile.
 *
 * Zero is refused for every direction-specific type: a row that moves nothing
 * is noise in an append-only ledger, and its balance_after would restate a
 * balance without saying why.
 *
 * Returns the column payload for the INSERT, minus wallet_id, which only the
 * caller knows. `metadata` comes back as a JSON string, ready for a jsonb
 * parameter. Nothing here touches the database.
 */
export function ledgerRow({
  type,
  amount,
  balanceAfter,
  bucketId = null,
  codeId = null,
  orderUuid = null,
  reference = null,
  description = null,
  metadata = null,
  // The snake_case aliases are accepted so a row read back off the ledger can be
  // re-validated by calling this again — which is exactly what insertLedger
  // does, and without them the second pass would see no balance at all.
  balance_after: balanceAfterAlias = undefined,
  bucket_id: bucketIdAlias = undefined,
  code_id: codeIdAlias = undefined,
  order_uuid: orderUuidAlias = undefined,
} = {}) {
  if (balanceAfter == null && balanceAfterAlias != null) balanceAfter = balanceAfterAlias;
  if (bucketId == null && bucketIdAlias != null) bucketId = bucketIdAlias;
  if (codeId == null && codeIdAlias != null) codeId = codeIdAlias;
  if (orderUuid == null && orderUuidAlias != null) orderUuid = orderUuidAlias;

  const signed = round2(amount);

  if (INFLOW_TYPES.includes(type)) {
    if (!(signed > 0)) {
      throw new Error(`A ${type} row needs a positive amount, got ${signed}`);
    }
  } else if (OUTFLOW_TYPES.includes(type)) {
    if (!(signed < 0)) {
      throw new Error(`A ${type} row needs a negative amount, got ${signed}`);
    }
  } else if (type === LEDGER_TYPE.ADJUSTMENT) {
    // A correction may go either way, but "adjust by nothing" is never a thing.
    if (signed === 0) throw new Error("An ADJUSTMENT row cannot move zero");
  } else {
    throw new Error(`Unknown wallet ledger type ${String(type)}`);
  }

  // balance_after is the WALLET TOTAL once this row has applied, not this
  // row's bucket remainder and not the wallet total before it. That is what lets
  // a balance be read straight off any single ledger row, and it is the single
  // most likely place for a subtle bug: a bucket-scoped value here makes the
  // ledger's running column a discontinuity on every row after the first.
  //
  // Checked for finiteness before rounding, because round2 turns NaN into 0 —
  // which would file a CREDIT under a balance_after of 0 and let the ledger
  // assert the customer's money vanished.
  if (!Number.isFinite(Number(balanceAfter))) {
    throw new Error(`A ledger row needs a finite balance_after, got ${String(balanceAfter)}`);
  }
  const after = round2(balanceAfter);
  if (after < 0) throw new Error(`A ledger row cannot leave the balance at ${after}`);

  return {
    type,
    amount: signed,
    balance_after: after,
    bucket_id: bucketId ?? null,
    code_id: codeId ?? null,
    order_uuid: orderUuid ?? null,
    reference: reference ?? null,
    description: description ?? null,
    // An already-encoded JSON string is passed through, so re-validating a row
    // that came off the ledger does not double-encode it into "\"{}\"".
    metadata:
      typeof metadata === "string" ? metadata : JSON.stringify(metadata || {}),
  };
}

// A bucket row in the shape callers work with. `applicability` arrives from
// jsonb already parsed; anything that is not an array is reported as the empty
// array, which reads as "unrestricted" — the same forgiving default
// giftCardApplicability uses, because a missing scope is not a scope of
// nothing.
function mapBucket(row) {
  return {
    id: row.id,
    codeId: row.code_id ?? null,
    remaining: round2(row.remaining),
    initialValue: round2(row.initial_value),
    applicability: Array.isArray(row.applicability) ? row.applicability : [],
    expiresAt: row.expires_at ?? null,
  };
}

const BUCKET_COLUMNS =
  "id, code_id, currency, initial_value, remaining, applicability, expires_at";

const LEDGER_COLUMNS =
  "id, uuid, wallet_id, type, amount, balance_after, bucket_id, code_id," +
  " order_uuid, reference, description, metadata, created_at";

// Allocations arrive from allocate() as [{ bucketId, amount }]. Merged by bucket
// so a repeated id cannot produce two competing updates to one row, and so the
// ledger gets exactly one row per bucket however the caller grouped it.
function normalizeAllocations(allocations) {
  const merged = new Map();
  for (const line of Array.isArray(allocations) ? allocations : []) {
    const bucketId = line?.bucketId ?? line?.bucket_id ?? null;
    if (bucketId == null) throw new Error("A wallet allocation needs a bucket id");
    const amount = round2(line?.amount);
    if (!(amount > 0)) {
      throw new Error(`A wallet allocation of ${amount} moves nothing`);
    }
    const key = String(bucketId);
    merged.set(key, round2((merged.get(key) || 0) + amount));
  }
  return [...merged.entries()]
    .map(([key, amount]) => ({ bucketId: key, amount }))
    .sort((a, b) => Number(a.bucketId) - Number(b.bucketId));
}

export const Wallet = {
  WALLET_TABLE,
  BUCKET_TABLE,
  LEDGER_TABLE,

  /**
   * The customer's wallet, created on first use.
   *
   * ON CONFLICT DO UPDATE rather than DO NOTHING because a plain
   * ON CONFLICT DO NOTHING RETURNING returns no row when the wallet already
   * existed, which would report "no wallet" for a customer who plainly has one.
   * Re-stamping updated_at is the cost of that, and it is the honest signal:
   * this call did just touch the row.
   *
   * Safe to call concurrently: the loser of the race waits on the unique index
   * and then takes the conflict branch, so two parallel first-time requests
   * cannot both believe they created the wallet.
   */
  async ensureForCustomer(customerId, { client } = {}) {
    const db = client || pool;
    if (!customerId) throw new Error("A wallet requires a customer");

    try {
      const result = await db.query(
        `INSERT INTO ${WALLET_TABLE} (customer_id) VALUES ($1)
         ON CONFLICT (customer_id) DO UPDATE SET updated_at = now()
         RETURNING id, uuid, customer_id, currency, created_at, updated_at`,
        [customerId]
      );
      return result.rows[0] || null;
    } catch (error) {
      // The unique index on customer_id is the backstop, not the strategy, and
      // a driver-level "duplicate key value violates unique constraint" is not
      // something a caller asking "does this customer have a wallet" should
      // ever see. Anything else is a real fault and is re-thrown untouched.
      if (String(error?.code) !== "23505") throw error;
      const found = await this.findByCustomer(customerId, { client });
      if (!found) throw error;
      return found;
    }
  },

  async findByCustomer(customerId, { client } = {}) {
    const db = client || pool;
    if (!customerId) return null;
    const result = await db.query(
      `SELECT id, uuid, customer_id, currency, created_at, updated_at
       FROM ${WALLET_TABLE} WHERE customer_id = $1`,
      [customerId]
    );
    return result.rows[0] || null;
  },

  /**
   * The buckets a customer may spend right now, restricted ones first.
   *
   * Restricted-first is the whole reason this is not a plain ORDER BY id: money
   * from a brand- or category-restricted card can only pay for what that card
   * allowed, so if the unrestricted pot is drained first, restricted value sits
   * behind it with a shelf life it will not survive. Within a group the
   * earliest expiry goes first (scarce value is spent before it ages out), and
   * NULLS LAST because a bucket that never expires is the one to keep in
   * reserve. id breaks every tie, so the order is stable across calls.
   */
  async bucketsFor(customerId, { client } = {}) {
    const db = client || pool;
    const wallet = await this.findByCustomer(customerId, { client });
    if (!wallet) return [];

    const result = await db.query(
      `SELECT ${BUCKET_COLUMNS}
       FROM ${BUCKET_TABLE}
       WHERE wallet_id = $1 AND ${SPENDABLE_BUCKET}
       ORDER BY ${RESTRICTED_FIRST} ASC, expires_at ASC NULLS LAST, id ASC`,
      [wallet.id]
    );
    return result.rows.map(mapBucket);
  },

  // The balance is the SUM, never a stored column. Summed with the same
  // spendability rule as bucketsFor, so the number and the list can never
  // disagree about which buckets exist.
  async balanceFor(customerId, { client } = {}) {
    const db = client || pool;
    const wallet = await this.findByCustomer(customerId, { client });
    if (!wallet) return 0;
    return this.totalForWalletId(db, wallet.id);
  },

  async totalForWalletId(db, walletId) {
    const result = await db.query(
      `SELECT COALESCE(SUM(remaining), 0) AS total
       FROM ${BUCKET_TABLE}
       WHERE wallet_id = $1 AND ${SPENDABLE_BUCKET}`,
      [walletId]
    );
    return round2(result.rows[0]?.total);
  },

  /**
   * Moves value INTO a bucket, in the caller's transaction.
   *
   * This is deliberately an in-transaction helper and opens no transaction of
   * its own. A claim credits a wallet and stamps a code in one atomic step, and
   * a helper that quietly committed would publish the wallet half of that step
   * while the code half rolled back — which is not a bug anyone would find by
   * reading the call site. A missing `client` is therefore a thrown error, not
   * a fallback to the pool.
   *
   * The caller must already hold a FOR UPDATE lock on the bucket row. Two
   * concurrent claims of the same code would otherwise both read the same
   * `before` and both write it, and the second credit would silently vanish.
   * (The unique index on (code_id) WHERE is_active is the backstop; it is not a
   * substitute for the lock, because it fires after the value is already gone.)
   *
   * `amount` defaults to the bucket's own initial_value, which is the common
   * case: the claim created the bucket with remaining = 0 and this activates it.
   * `initial_value` is the bucket's ceiling and is never rewritten here — it is
   * what caps a refund, so raising it to fit a credit would quietly remove the
   * only thing that bounds a later restoration.
   */
  async creditInTx(
    client,
    { customerId, bucket, codeId = null, reference = null, description = null, metadata = null, amount = null } = {}
  ) {
    if (!client) throw new Error("creditInTx must run inside the caller's transaction");
    const bucketId = bucket?.id ?? null;
    if (!bucketId) throw new Error("A wallet credit needs a bucket to credit into");

    const wallet = await this.findByCustomer(customerId, { client });
    if (!wallet) throw new Error("This customer has no wallet to credit");

    // Read under the caller's lock rather than trusting a figure from the
    // caller, so `after` is derived from what is actually in the row.
    const current = await client.query(
      `SELECT ${BUCKET_COLUMNS} FROM ${BUCKET_TABLE} WHERE id = $1`,
      [bucketId]
    );
    const row = current.rows[0];
    if (!row) throw new Error(`Wallet bucket ${bucketId} does not exist`);

    const wanted = round2(amount != null ? amount : row.initial_value);
    if (!(wanted > 0)) throw new Error(`A wallet credit of ${wanted} moves nothing`);

    const before = round2(row.remaining);
    const ceiling = round2(row.initial_value);
    const after = round2(before + wanted);
    if (after > ceiling) {
      // Left to the CHECK this would surface as a bare constraint violation,
      // mid-transaction, with nothing in it saying which bucket overflowed.
      throw new Error(
        `Crediting ${wanted} into a bucket holding ${before} would exceed its value of ${ceiling}`
      );
    }

    const updated = await client.query(
      `UPDATE ${BUCKET_TABLE} SET remaining = $1, updated_at = now()
       WHERE id = $2 RETURNING ${BUCKET_COLUMNS}`,
      [after, bucketId]
    );

    // Re-read rather than add to a remembered figure: the write above is already
    // inside this transaction, so the sum is the wallet total *after* this row,
    // and it stays right even when the bucket that was credited is one the total
    // does not count (inactive or past its own expiry).
    const balanceAfter = round2(await this.totalForWalletId(client, wallet.id));
    await this.insertLedger(
      client,
      wallet.id,
      ledgerRow({
        type: LEDGER_TYPE.CREDIT,
        amount: wanted,
        balanceAfter,
        bucketId,
        codeId: codeId ?? row.code_id ?? null,
        reference,
        description,
        metadata,
      })
    );

    return mapBucket(updated.rows[0]);
  },

  /**
   * Takes value out of one or more buckets, in the caller's transaction.
   *
   * `allocations` is what allocate() produced: [{ bucketId, amount }].
   *
   * Every bucket is locked FOR UPDATE in ascending id order, and that ordering
   * is the point. Two concurrent checkouts drawing on the same two buckets in
   * opposite order would each hold the lock the other needs and deadlock; with
   * a total order on the locks, the second transaction simply waits. Postgres
   * takes row locks after the sort (LockRows sits above Sort in the plan), so
   * `ORDER BY id FOR UPDATE` is what makes the wait safe.
   *
   * Every allocation is checked against the locked remainder before anything is
   * written, so a refused debit leaves every bucket and the ledger exactly as
   * they were rather than half applied.
   */
  async debitInTx(client, { customerId, allocations = [], orderUuid = null, reference = null } = {}) {
    if (!client) throw new Error("debitInTx must run inside the caller's transaction");
    const wallet = await this.findByCustomer(customerId, { client });
    if (!wallet) throw new Error("This customer has no wallet to debit");

    const lines = normalizeAllocations(allocations);
    // Nothing to take is not an error, and it must not write a zero row.
    if (lines.length === 0) return this.totalForWalletId(client, wallet.id);

    const locked = await client.query(
      `SELECT id, remaining, expires_at
       FROM ${BUCKET_TABLE}
       WHERE id = ANY($1::bigint[]) AND wallet_id = $2
       ORDER BY id
       FOR UPDATE`,
      [lines.map((line) => line.bucketId), wallet.id]
    );

    const rows = new Map(locked.rows.map((row) => [String(row.id), row]));
    // Validate the whole set first: no partial write, no orphan DEBIT rows.
    for (const line of lines) {
      const row = rows.get(line.bucketId);
      if (!row) {
        throw new Error(`Wallet bucket ${line.bucketId} is not part of this wallet`);
      }
      // Spending must not slip past a bucket's own expiry just because the
      // quote was taken a moment earlier; the value ages out either way.
      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
        throw new Error(`The gift card behind this balance expired on ${new Date(row.expires_at).toISOString()}`);
      }
      const available = round2(row.remaining);
      if (line.amount > available) {
        throw new Error(`A balance of ${available} cannot cover ${line.amount}`);
      }
    }

    let total = await this.totalForWalletId(client, wallet.id);
    for (const line of lines) {
      const row = rows.get(line.bucketId);
      const remaining = round2(round2(row.remaining) - line.amount);
      await client.query(
        `UPDATE ${BUCKET_TABLE} SET remaining = $1, updated_at = now() WHERE id = $2`,
        [remaining, line.bucketId]
      );

      // The running wallet total, read back after each write rather than
      // accumulated by hand. It is what balance_after records — not the bucket's
      // new remainder, and not the total before this row — and re-reading is
      // what keeps it true for every row of a multi-bucket debit instead of
      // only the last.
      const balanceAfter = round2(await this.totalForWalletId(client, wallet.id));
      await this.insertLedger(
        client,
        wallet.id,
        ledgerRow({
          type: LEDGER_TYPE.DEBIT,
          amount: -line.amount,
          balanceAfter,
          bucketId: line.bucketId,
          orderUuid,
          reference,
        })
      );
      total = balanceAfter;
    }

    return round2(total);
  },

  /**
   * Puts value back into the buckets a debit came out of, in the caller's
   * transaction.
   *
   * Refunding to the wallet total rather than to the original buckets would
   * move a brand-restricted card's money into unrestricted spending, which is
   * exactly the scope the claim froze. So each bucket is restored individually.
   *
   * The amount is capped at what is still unrefunded for that bucket: the
   * already-booked debits minus the refunds already recorded against them. A
   * retried refund (a webhook delivered twice, a support agent clicking again)
   * therefore books zero and creates no value, which matters because a wallet
   * balance nobody can explain is worse than a failed refund.
   *
   * Locks are taken in ascending id order, as in debitInTx, and the booked
   * totals are read only after those locks are held — otherwise two concurrent
   * refunds of the same debit would each see the full amount as refundable.
   */
  async refundInTx(client, { customerId, allocations = [], orderUuid = null, reference = null } = {}) {
    if (!client) throw new Error("refundInTx must run inside the caller's transaction");
    const wallet = await this.findByCustomer(customerId, { client });
    if (!wallet) throw new Error("This customer has no wallet to refund");

    const lines = normalizeAllocations(allocations);
    if (lines.length === 0) return 0;

    // The locks come first and the ledger is read under them, so the outstanding
    // figures below are the same ones every competing refund is serialised
    // behind.
    const locked = await client.query(
      `SELECT ${BUCKET_COLUMNS} FROM ${BUCKET_TABLE}
       WHERE id = ANY($1::bigint[]) AND wallet_id = $2
       ORDER BY id FOR UPDATE`,
      [lines.map((line) => line.bucketId), wallet.id]
    );

    // Debits are negative and refunds positive, so the two aggregate to "still
    // outstanding". Scoped to this order when one was given; without one it is
    // every debit against these buckets, which is the only definition left.
    const booked = await client.query(
      `SELECT bucket_id,
              COALESCE(SUM(-amount) FILTER (WHERE type = 'DEBIT'), 0) AS debited,
              COALESCE(SUM(amount) FILTER (WHERE type = 'REFUND'), 0) AS refunded
       FROM ${LEDGER_TABLE}
       WHERE wallet_id = $1
         AND bucket_id = ANY($2::bigint[])
         AND type IN ('DEBIT', 'REFUND')
         AND ($3::uuid IS NULL OR order_uuid = $3::uuid)
       GROUP BY bucket_id`,
      [wallet.id, lines.map((line) => line.bucketId), orderUuid]
    );
    const outstanding = new Map(
      booked.rows.map((row) => [
        String(row.bucket_id),
        round2(round2(row.debited) - round2(row.refunded)),
      ])
    );

    const rows = new Map(locked.rows.map((row) => [String(row.id), row]));
    let restored = 0;

    for (const line of lines) {
      const row = rows.get(line.bucketId);
      if (!row) throw new Error(`Wallet bucket ${line.bucketId} is not part of this wallet`);

      const refundable = outstanding.get(line.bucketId) ?? 0;
      const amount = round2(Math.min(line.amount, Math.max(0, refundable)));
      // Already fully refunded: record nothing. A second refund of the same
      // allocations lands here and returns zero.
      if (!(amount > 0)) continue;

      // A bucket cannot be pushed past its own ceiling; that is the last line
      // of defence if a debit was itself booked against a smaller initial_value.
      const remaining = round2(Math.min(round2(row.initial_value), round2(row.remaining) + amount));
      await client.query(
        `UPDATE ${BUCKET_TABLE} SET remaining = $1, updated_at = now() WHERE id = $2`,
        [remaining, line.bucketId]
      );

      // The wallet total once this row applied — see debitInTx.
      const balanceAfter = round2(await this.totalForWalletId(client, wallet.id));
      restored = round2(restored + amount);
      await this.insertLedger(
        client,
        wallet.id,
        ledgerRow({
          type: LEDGER_TYPE.REFUND,
          amount,
          balanceAfter,
          bucketId: line.bucketId,
          orderUuid,
          reference,
        })
      );
    }

    return restored;
  },

  // One ledger insert, with the sign convention re-checked and the constraint
  // backstops translated. The re-check is not paranoia: insertLedger is a
  // public method on the model, so a caller could hand it a payload that never
  // went through ledgerRow. Running the same normaliser here means the rule
  // holds at the point the money moves, not merely at the point it is usually
  // prepared.
  //
  // The CHECKs are the database's last word, not the plan, so the error a caller
  // sees has to name the problem — and note that a rejected statement has
  // already aborted the caller's transaction, so this message explains the
  // rollback rather than inviting a retry inside it.
  async insertLedger(db, walletId, row) {
    // ledgerRow throws on a sign that contradicts the type, and re-normalises
    // every amount to whole paise on the way in.
    const safe = ledgerRow(row);
    try {
      const result = await db.query(
        `INSERT INTO ${LEDGER_TABLE}
           (wallet_id, type, amount, balance_after, bucket_id, code_id,
            order_uuid, reference, description, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${LEDGER_COLUMNS}`,
        [
          walletId,
          safe.type,
          safe.amount,
          safe.balance_after,
          safe.bucket_id,
          safe.code_id,
          safe.order_uuid,
          safe.reference,
          safe.description,
          safe.metadata,
        ]
      );
      const written = result.rows[0];
      return {
        ...written,
        amount: round2(written.amount),
        balance_after: round2(written.balance_after),
      };
    } catch (error) {
      if (String(error?.code) === "23514") {
        throw new Error(
          `The wallet ledger refused a ${safe.type} row (${safe.amount}, balance after ${safe.balance_after}); the transaction has been aborted`
        );
      }
      if (String(error?.code) === "23503") {
        throw new Error(
          "The wallet ledger row refers to something that does not exist; the transaction has been aborted"
        );
      }
      throw error;
    }
  },

  // A customer's ledger, newest first. `balance_after` on the newest row is the
  // audited balance, and comparing it with balanceFor() is how a drift shows up
  // rather than being argued about.
  async ledgerFor(customerId, { client, limit = 100 } = {}) {
    const db = client || pool;
    const wallet = await this.findByCustomer(customerId, { client });
    if (!wallet) return [];
    const result = await db.query(
      `SELECT ${LEDGER_COLUMNS}
       FROM ${LEDGER_TABLE}
       WHERE wallet_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [wallet.id, limit]
    );
    return result.rows.map((row) => ({
      ...row,
      amount: round2(row.amount),
      balance_after: round2(row.balance_after),
    }));
  },
};