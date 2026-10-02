import pool from "../db";
import { round2 } from "../giftCardRules";

const TABLE = "gift_card_reservations";

export const RESERVATION_STATUS = Object.freeze({
  RESERVED: "RESERVED",
  CONSUMED: "CONSUMED",
  RELEASED: "RELEASED",
  EXPIRED: "EXPIRED",
});

const DEFAULT_TTL_MINUTES = 15;

// Value currently held by live reservations on a card. Expired holds do not
// count, so a crashed checkout cannot freeze a balance forever.
export async function reservedAmount(db, giftCardId) {
  const runner = db || pool;
  const result = await runner.query(
    `SELECT COALESCE(SUM(amount), 0) AS held
     FROM ${TABLE}
     WHERE gift_card_id = $1 AND status = 'RESERVED' AND expires_at > now()`,
    [giftCardId]
  );
  return Number(result.rows[0]?.held) || 0;
}

// Balance a card can still actually spend right now.
export async function availableBalance(db, giftCardId) {
  const runner = db || pool;
  const result = await runner.query(
    `SELECT balance FROM gift_cards WHERE id = $1`,
    [giftCardId]
  );
  if (!result.rows[0]) return 0;
  const balance = Number(result.rows[0].balance) || 0;
  return round2(Math.max(0, balance - (await reservedAmount(runner, giftCardId))));
}

export const GiftCardReservation = {
  TABLE,

  // Caller must already hold a FOR UPDATE lock on the gift card row (or be
  // inside the order transaction that does), otherwise two concurrent
  // reservations could each pass the balance check and over-commit.
  async create({ giftCardId, orderUuid = null, amount, ttlMinutes = DEFAULT_TTL_MINUTES, metadata = {} } = {}) {
    const value = round2(amount);
    if (!(value > 0)) throw new Error("Reservation amount must be greater than zero");
    if (!giftCardId) throw new Error("Reservation requires a gift card");

    const result = await pool.query(
      `INSERT INTO ${TABLE} (gift_card_id, order_uuid, amount, status, expires_at, metadata)
       VALUES ($1, $2, $3, 'RESERVED', now() + ($4 || ' minutes')::interval, $5)
       RETURNING uuid, gift_card_id, order_uuid, amount, status, expires_at, created_at`,
      [giftCardId, orderUuid, value, String(ttlMinutes || DEFAULT_TTL_MINUTES), JSON.stringify(metadata || {})]
    );
    return { ...result.rows[0], amount: Number(result.rows[0].amount) };
  },

  // Re-reading a reservation is how a checkout resume looks up its own hold.
  async findByUuid(uuid) {
    const result = await pool.query(
      `SELECT uuid, gift_card_id, order_uuid, amount, status, expires_at, created_at, updated_at
       FROM ${TABLE} WHERE uuid = $1`,
      [uuid]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { ...row, amount: Number(row.amount) };
  },

  // Turns a hold into spent value. Idempotent: an already-consumed
  // reservation returns its row instead of erroring, so a retried payment
  // webhook cannot double-consume.
  async confirm(uuid) {
    const result = await pool.query(
      `UPDATE ${TABLE}
       SET status = 'CONSUMED', updated_at = now()
       WHERE uuid = $1 AND status = 'RESERVED'
       RETURNING uuid, gift_card_id, order_uuid, amount, status`,
      [uuid]
    );
    if (result.rows[0]) {
      return { ...result.rows[0], amount: Number(result.rows[0].amount) };
    }
    const existing = await this.findByUuid(uuid);
    if (existing && existing.status === RESERVATION_STATUS.CONSUMED) {
      return { ...existing, duplicate: true };
    }
    return null;
  },

  // Payment failed, timed out, or the order was cancelled: the hold goes back
  // to the card. Idempotent for the same reason as confirm().
  async release(uuid, { status = RESERVATION_STATUS.RELEASED, reason = null } = {}) {
    const terminal = status === RESERVATION_STATUS.RELEASED ? "RELEASED" : "EXPIRED";
    const result = await pool.query(
      `UPDATE ${TABLE}
       SET status = $2, metadata = metadata || $3::jsonb, updated_at = now()
       WHERE uuid = $1 AND status = 'RESERVED'
       RETURNING uuid, gift_card_id, order_uuid, amount, status`,
      [uuid, terminal, JSON.stringify(reason ? { releaseReason: reason } : {})]
    );
    if (result.rows[0]) {
      return { ...result.rows[0], amount: Number(result.rows[0].amount) };
    }
    const existing = await this.findByUuid(uuid);
    if (existing && existing.status !== RESERVATION_STATUS.RESERVED) {
      return { ...existing, duplicate: true };
    }
    return null;
  },

  // Sweeper for abandoned checkouts. Safe to call repeatedly.
  async releaseExpired() {
    const result = await pool.query(
      `UPDATE ${TABLE}
       SET status = 'EXPIRED', updated_at = now()
       WHERE status = 'RESERVED' AND expires_at <= now()
       RETURNING uuid, gift_card_id, amount`
    );
    return result.rows;
  },

  // Releases every live hold for an order (payment never completed).
  async releaseForOrder(orderUuid, { reason = "Order cancelled" } = {}) {
    const result = await pool.query(
      `UPDATE ${TABLE}
       SET status = 'RELEASED', metadata = metadata || $2::jsonb, updated_at = now()
       WHERE order_uuid = $1 AND status = 'RESERVED'
       RETURNING uuid, gift_card_id, amount, status`,
      [orderUuid, JSON.stringify({ releaseReason: reason })]
    );
    return result.rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  },

  async listForOrder(orderUuid) {
    const result = await pool.query(
      `SELECT uuid, gift_card_id, amount, status, expires_at, created_at
       FROM ${TABLE} WHERE order_uuid = $1 ORDER BY created_at`,
      [orderUuid]
    );
    return result.rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  },
};
