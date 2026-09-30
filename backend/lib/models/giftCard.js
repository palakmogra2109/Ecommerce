import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "gift_cards";

const PUBLIC_COLUMNS =
  "uuid, code, initial_amount, balance, recipient_email, status," +
  " expires_at, created_at, updated_at";

const INTERNAL_COLUMNS = "id, " + PUBLIC_COLUMNS;

export const GiftCard = {
  TABLE,

  normalizeCode(value) {
    return String(value || "").trim().replace(/\s+/g, "-").toUpperCase();
  },

  async create({ code, amount = 0, recipientEmail = null, expiresAt = null, status = "ACTIVE" } = {}) {
    const normalizedCode = this.normalizeCode(code);
    if (!normalizedCode) throw new Error("A gift card code is required");
    const value = Number(amount) || 0;
    if (!(value > 0)) throw new Error("Gift card amount must be greater than zero");

    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (code, initial_amount, balance, recipient_email, status, expires_at)
      VALUES ($1, $2, $2, $3, $4, $5)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        normalizedCode,
        value,
        recipientEmail ? String(recipientEmail).toLowerCase().trim() : null,
        status,
        expiresAt || null,
      ]
    );

    const card = result.rows[0];
    await pool.query(
      `INSERT INTO gift_card_transactions (gift_card_id, type, amount, balance_after)
       VALUES ((SELECT id FROM ${TABLE} WHERE uuid = $1), 'ISSUE', $2, $2)`,
      [card.uuid, value]
    );

    return { ...card, initial_amount: Number(card.initial_amount), balance: Number(card.balance) };
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} WHERE uuid = $1`,
      [uuid]
    );
    return result.rows[0] || null;
  },

  async findByCode(code) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} WHERE code = $1`,
      [this.normalizeCode(code)]
    );
    return result.rows[0] || null;
  },

  async list({ search = "", status = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(code ILIKE $${params.length} OR COALESCE(recipient_email, '') ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return paginate(
      {
        baseSql: `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM ${TABLE} ${where}`,
        params,
        orderBy: "ORDER BY created_at DESC, id DESC",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async update(uuid, updates = {}) {
    const fields = [];
    const values = [];
    const set = (column, value) => {
      fields.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };

    if (updates.code !== undefined) set("code", this.normalizeCode(updates.code));
    if (updates.recipientEmail !== undefined) {
      set("recipient_email", updates.recipientEmail ? String(updates.recipientEmail).toLowerCase().trim() : null);
    }
    if (updates.status !== undefined) set("status", updates.status);
    if (updates.expiresAt !== undefined) set("expires_at", updates.expiresAt || null);

    // Balances move only through redeem/adjust below, never by direct edit:
    // editing a balance would orphan the transaction ledger.

    if (fields.length === 0) return this.findByUuid(uuid);

    values.push(uuid);
    const result = await pool.query(
      `UPDATE ${TABLE} SET ${fields.join(", ")}, updated_at = now()
       WHERE uuid = $${values.length}
       RETURNING ${PUBLIC_COLUMNS}`,
      values
    );
    return result.rows[0] || null;
  },

  // Admin top-up / correction with a ledger row. Amount may be negative but
  // never drives the balance below zero.
  async adjust(uuid, amount, client = null) {
    const db = client || pool;
    const value = Number(amount) || 0;
    if (value === 0) throw new Error("Adjustment amount cannot be zero");
    const owned = client ? null : await db.connect();
    const runner = owned || db;
    try {
      if (owned) await runner.query("BEGIN");
      const locked = await runner.query(
        `SELECT id, balance FROM ${TABLE} WHERE uuid = $1 FOR UPDATE`,
        [uuid]
      );
      const row = locked.rows[0];
      if (!row) {
        if (owned) await runner.query("ROLLBACK");
        return null;
      }
      const balance = Number(row.balance) + value;
      if (balance < 0) throw new Error("Adjustment would drive the balance below zero");
      await runner.query(`UPDATE ${TABLE} SET balance = $1, updated_at = now() WHERE id = $2`, [balance, row.id]);
      await runner.query(
        `INSERT INTO gift_card_transactions (gift_card_id, type, amount, balance_after)
         VALUES ($1, 'ISSUE', $2, $3)`,
        [row.id, value, balance]
      );
      if (owned) await runner.query("COMMIT");
      return this.findByUuid(uuid);
    } catch (error) {
      if (owned) await runner.query("ROLLBACK");
      throw error;
    } finally {
      if (owned) runner.release();
    }
  },

  async transactions(uuid) {
    const result = await pool.query(
      `SELECT t.uuid, t.type, t.amount, t.balance_after, t.created_at,
              o.order_number
       FROM gift_card_transactions t
       LEFT JOIN orders o ON o.id = t.order_id
       WHERE t.gift_card_id = (SELECT id FROM ${TABLE} WHERE uuid = $1)
       ORDER BY t.created_at DESC
       LIMIT 100`,
      [uuid]
    );
    return result.rows.map((r) => ({
      ...r,
      amount: Number(r.amount) || 0,
      balance_after: Number(r.balance_after) || 0,
    }));
  },

  async remove(uuid) {
    const result = await pool.query(
      `DELETE FROM ${TABLE} WHERE uuid = $1 RETURNING uuid`,
      [uuid]
    );
    return result.rows[0] || null;
  },
};
