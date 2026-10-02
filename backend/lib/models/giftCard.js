import { createHash, randomBytes } from "node:crypto";
import pool from "../db";
import { paginate } from "../pagination";
import { maskCode, normalizeGiftCode } from "../giftCardRules";

const TABLE = "gift_cards";

// Unambiguous alphabet (no 0/O, 1/I/L): `GIFT-8K4P-92XM` style codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// code_hash is selected for lookup/masking only; maskRow strips it before the
// row reaches any API response.
const PUBLIC_COLUMNS =
  "uuid, code, code_hash, code_last4, initial_amount, balance, currency, source," +
  " customer_id, recipient_email, status, usage_limit, min_order_amount," +
  " max_redemption_amount, selling_price, denomination_uuid, image_url, label," +
  " applicable_branches, applicable_brands, applicable_categories," +
  " applicable_products," +
  " activated_at, expires_at, created_at, updated_at";

const INTERNAL_COLUMNS = "id, " + PUBLIC_COLUMNS;

export const GiftCard = {
  TABLE,

  normalizeCode(value) {
    return normalizeGiftCode(value);
  },

  hashCode(normalized) {
    return createHash("sha256").update(normalized).digest("hex");
  },

  generateCode() {
    const bytes = randomBytes(8);
    let tail = "";
    for (let i = 0; i < 8; i++) {
      tail += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return `GIFT-${tail.slice(0, 4)}-${tail.slice(4)}`;
  },

  maskRow(row) {
    if (!row) return row;
    // Full codes live only in issue responses and delivery email; everywhere
    // else the last4 identifies a card. maskCode also drops code_hash.
    return {
      ...maskCode(row),
      initial_amount: Number(row.initial_amount) || 0,
      balance: Number(row.balance) || 0,
      min_order_amount: Number(row.min_order_amount) || 0,
      max_redemption_amount:
        row.max_redemption_amount != null ? Number(row.max_redemption_amount) : null,
    };
  },

  // Every card a shopper could spend: assigned to their account, or issued to
  // their email, and not still a draft. Returns raw rows (id included) so the
  // caller can allocate; masking happens on the way out.
  async spendableForCustomer({ email, customerId = null }) {
    const params = [];
    const owns = [];
    if (email) {
      params.push(email);
      owns.push(`LOWER(COALESCE(recipient_email, '')) = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      owns.push(`customer_id = $${params.length}`);
    }
    if (owns.length === 0) return [];

    const result = await pool.query(
      `SELECT ${INTERNAL_COLUMNS} FROM ${TABLE}
       WHERE (${owns.join(" OR ")}) AND status <> 'DRAFT'
       ORDER BY id`,
      params
    );
    return result.rows;
  },

  // How many times each of these cards has already been redeemed, so a card
  // that hit its usage limit is not offered again.
  async usageCounts(cardIds) {
    const ids = (cardIds || []).filter(Boolean);
    if (ids.length === 0) return {};
    const result = await pool.query(
      `SELECT gift_card_id, COUNT(*)::int AS count
       FROM gift_card_transactions
       WHERE type = 'REDEEM' AND gift_card_id = ANY($1::bigint[])
       GROUP BY gift_card_id`,
      [ids]
    );
    return Object.fromEntries(result.rows.map((r) => [Number(r.gift_card_id), r.count]));
  },

  // JSONB columns accept either an array or a comma-separated string, because
  // the admin form posts a string of ids while the bulk importer posts arrays.
  asJsonArray(value) {
    if (Array.isArray(value)) return value.filter((v) => v !== null && v !== "");
    if (typeof value === "string") {
      return value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
    }
    return [];
  },

  async create({
    code = null,
    amount = 0,
    currency = "INR",
    source = "FIXED",
    customerId = null,
    recipientEmail = null,
    expiresAt = null,
    status = "ACTIVE",
    usageLimit = null,
    minOrderAmount = 0,
    maxRedemptionAmount = null,
    // What the buyer paid. Null for admin-issued cards, which cost nothing.
    sellingPrice = null,
    denominationUuid = null,
    imageUrl = null,
    label = "Gift Card",
    applicableCategories = [],
    applicableBrands = [],
    applicableProducts = [],
    createdBy = null,
    // Store-issued cards book an ISSUE row. A customer purchase books
    // PURCHASED instead, so one payment never also looks like an issuance.
    ledgerType = "ISSUE",
  } = {}) {
    const value = Number(amount) || 0;
    if (!(value > 0)) throw new Error("Gift card amount must be greater than zero");

    for (let attempt = 0; attempt < 5; attempt++) {
      const fullCode = code ? this.normalizeCode(code) : this.generateCode();
      if (!fullCode) throw new Error("A gift card code is required");
      try {
        const result = await pool.query(
          `
          INSERT INTO ${TABLE}
            (code, code_hash, code_last4, initial_amount, balance, currency, source,
             customer_id, recipient_email, status, usage_limit, min_order_amount,
             max_redemption_amount, selling_price, denomination_uuid, image_url, label,
             applicable_categories, applicable_brands, applicable_products,
             expires_at, created_by)
          VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          RETURNING ${INTERNAL_COLUMNS}
          `,
          [
            code ? fullCode : null,
            this.hashCode(fullCode),
            fullCode.replace(/[^A-Za-z0-9]/g, "").slice(-4),
            value,
            currency || "INR",
            source,
            customerId,
            recipientEmail ? String(recipientEmail).toLowerCase().trim() : null,
            status,
            usageLimit != null ? Number(usageLimit) : null,
            Number(minOrderAmount) || 0,
            maxRedemptionAmount != null ? Number(maxRedemptionAmount) : null,
            sellingPrice != null ? Number(sellingPrice) : null,
            denominationUuid,
            imageUrl || null,
            String(label || "Gift Card").trim().slice(0, 60),
            JSON.stringify(this.asJsonArray(applicableCategories)),
            JSON.stringify(this.asJsonArray(applicableBrands)),
            JSON.stringify(this.asJsonArray(applicableProducts)),
            expiresAt || null,
            createdBy,
          ]
        );
        const row = result.rows[0];
        await pool.query(
          `INSERT INTO gift_card_transactions (gift_card_id, type, amount, balance_before, balance_after, reason)
           VALUES ($1, $2, $3, 0, $3, $4)`,
          [row.id, ledgerType, value, ledgerType === "PURCHASED" ? "Customer purchase" : "Card issued"]
        );
        // The full code is returned exactly once, here.
        return { ...this.maskRow(row), code: fullCode };
      } catch (error) {
        // Random collision (or a taken manual code): retry with a fresh one
        // only when we generated it; a colliding manual code is the
        // caller's 409.
        if (String(error?.code) !== "23505" || code) throw error;
      }
    }
    throw new Error("Could not generate a unique gift card code");
  },

  // Bulk issue: N uniquely-coded cards sharing one configuration. Returns
  // full codes once each — the caller is responsible for exporting them,
  // since they are unrecoverable afterwards.
  async bulkCreate({ count = 1, ...config } = {}) {
    const n = Math.min(500, Math.max(1, parseInt(count, 10) || 1));
    const cards = [];
    for (let i = 0; i < n; i++) {
      cards.push(await this.create({ ...config, code: null }));
    }
    return cards;
  },

  async findByUuid(uuid, { masked = true } = {}) {
    const result = await pool.query(
      `SELECT ${INTERNAL_COLUMNS} FROM ${TABLE} WHERE uuid = $1`,
      [uuid]
    );
    const row = this.withDerivedStatus(result.rows[0] || null);
    return masked ? this.maskRow(row) : row;
  },

  async findByCode(code, { masked = true } = {}) {
    const normalized = this.normalizeCode(code);
    if (!normalized) return null;
    // Secure rows match by hash; pre-hash legacy rows still match plaintext.
    const hashed = await pool.query(
      `SELECT ${INTERNAL_COLUMNS} FROM ${TABLE} WHERE code_hash = $1`,
      [this.hashCode(normalized)]
    );
    const row =
      hashed.rows[0] ||
      (
        await pool.query(`SELECT ${INTERNAL_COLUMNS} FROM ${TABLE} WHERE code = $1`, [
          normalized,
        ])
      ).rows[0] ||
      null;
    return masked ? this.maskRow(row) : row;
  },

  async listForCustomer({ email, customerId = null }) {
    const params = [];
    const owns = [];
    if (email) {
      params.push(email);
      owns.push(`LOWER(COALESCE(recipient_email, '')) = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      owns.push(`customer_id = $${params.length}`);
    }
    if (owns.length === 0) return [];

    // DRAFT cards are not yet issued to anyone, so they never appear here.
    const result = await pool.query(
      `SELECT ${INTERNAL_COLUMNS} FROM ${TABLE}
       WHERE (${owns.join(" OR ")}) AND status <> 'DRAFT'
       ORDER BY created_at DESC`,
      params
    );
    return result.rows.map((r) => this.maskRow(this.withDerivedStatus(r)));
  },

  // EXPIRED is a view, not a stored value: a card past its expiry date reads
  // as expired without a write, so listing stays correct without a sweeper.
  withDerivedStatus(row) {
    if (!row) return row;
    const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
    const terminal = row.status === "CANCELLED" || row.status === "REDEEMED";
    if (expired && row.balance > 0 && !terminal) return { ...row, status: "EXPIRED" };
    return row;
  },

  async list({ search = "", status = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      const term = search.trim();
      params.push(`%${term}%`);
      const like = `$${params.length}`;
      const parts = [
        // Legacy pre-hash rows still hold a readable code.
        `code ILIKE ${like}`,
        `code_last4 ILIKE ${like}`,
        `COALESCE(recipient_email, '') ILIKE ${like}`,
      ];
      // Hashed rows have a NULL code column, so a LIKE can never find them.
      // Hashing the search term and comparing to code_hash is what makes
      // "find this card by its code" work for every card ever issued.
      if (/^[A-Za-z0-9\s-]{4,}$/.test(term)) {
        params.push(this.hashCode(this.normalizeCode(term)));
        parts.push(`code_hash = $${params.length}`);
      }
      conditions.push(`(${parts.join(" OR ")})`);
    }

    if (status === "EXPIRED") {
      conditions.push(`expires_at IS NOT NULL AND expires_at < now() AND balance > 0 AND status NOT IN ('CANCELLED', 'REDEEMED')`);
    } else if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const out = await paginate(
      {
        baseSql: `SELECT ${INTERNAL_COLUMNS} FROM ${TABLE} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM ${TABLE} ${where}`,
        params,
        orderBy: "ORDER BY created_at DESC, id DESC",
      },
      { page, limit, offset: (page - 1) * limit }
    );
    return {
      ...out,
      rows: out.rows.map((r) => this.maskRow(this.withDerivedStatus(r))),
    };
  },

  async update(uuid, updates = {}) {
    const fields = [];
    const values = [];
    const set = (column, value) => {
      fields.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };
    // For SQL expressions. Never interpolate user input here: callers pass
    // literals only.
    const setRaw = (column, expression) => {
      fields.push(`${column} = ${expression}`);
    };

    // Balances move only through redeem/adjust below, never by direct edit:
    // editing a balance would orphan the transaction ledger.
    if (updates.status !== undefined) {
      set("status", updates.status);
      // First activation stamps the moment the card became usable.
      if (updates.status === "ACTIVE") {
        setRaw("activated_at", "COALESCE(activated_at, now())");
      }
    }
    if (updates.recipientEmail !== undefined) {
      set("recipient_email", updates.recipientEmail ? String(updates.recipientEmail).toLowerCase().trim() : null);
    }
    if (updates.expiresAt !== undefined) set("expires_at", updates.expiresAt || null);
    if (updates.usageLimit !== undefined) {
      set("usage_limit", updates.usageLimit != null ? Number(updates.usageLimit) : null);
    }
    if (updates.minOrderAmount !== undefined) set("min_order_amount", Number(updates.minOrderAmount) || 0);
    if (updates.maxRedemptionAmount !== undefined) {
      set("max_redemption_amount", updates.maxRedemptionAmount != null ? Number(updates.maxRedemptionAmount) : null);
    }
    if (updates.imageUrl !== undefined) set("image_url", updates.imageUrl || null);
    if (updates.label !== undefined) {
      set("label", String(updates.label || "Gift Card").trim().slice(0, 60));
    }
    if (updates.applicableCategories !== undefined) {
      set("applicable_categories", JSON.stringify(this.asJsonArray(updates.applicableCategories)));
    }
    if (updates.applicableBrands !== undefined) {
      set("applicable_brands", JSON.stringify(this.asJsonArray(updates.applicableBrands)));
    }
    if (updates.applicableProducts !== undefined) {
      set("applicable_products", JSON.stringify(this.asJsonArray(updates.applicableProducts)));
    }

    if (updates.code !== undefined && updates.code) {
      const fullCode = this.normalizeCode(updates.code);
      set("code", null);
      set("code_hash", this.hashCode(fullCode));
      set("code_last4", fullCode.replace(/[^A-Za-z0-9]/g, "").slice(-4));
    }

    if (fields.length === 0) return this.findByUuid(uuid);

    values.push(uuid);
    const result = await pool.query(
      `UPDATE ${TABLE} SET ${fields.join(", ")}, updated_at = now()
       WHERE uuid = $${values.length}
       RETURNING ${INTERNAL_COLUMNS}`,
      values
    );
    const row = result.rows[0] || null;
    // A code change returns the new full code once, like creation.
    if (row && updates.code) return { ...this.maskRow(row), code: this.normalizeCode(updates.code) };
    return this.maskRow(row);
  },

  // Admin top-up / correction with a reasoned ledger row. Amount may be
  // negative but never drives the balance below zero.
  async adjust(uuid, amount, { reason = null, performedBy = null } = {}, client = null) {
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
      const before = Number(row.balance) || 0;
      const after = before + value;
      if (after < 0) throw new Error("Adjustment would drive the balance below zero");
      await runner.query(`UPDATE ${TABLE} SET balance = $1, updated_at = now() WHERE id = $2`, [after, row.id]);
      await runner.query(
        `INSERT INTO gift_card_transactions
           (gift_card_id, type, amount, balance_before, balance_after, performed_by, reason)
         VALUES ($1, 'ADJUSTMENT', $2, $3, $4, $5, $6)`,
        [row.id, value, before, after, performedBy, reason]
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
      `SELECT t.uuid, t.type, t.amount, t.balance_before, t.balance_after,
              t.performed_by, t.reason, t.created_at, o.order_number
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
      balance_before: Number(r.balance_before) || 0,
      balance_after: Number(r.balance_after) || 0,
    }));
  },

  async stats() {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS issued,
              COALESCE(SUM(initial_amount), 0) AS issued_value,
              COALESCE(SUM(balance), 0) AS outstanding,
              COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
              COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
              COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              COUNT(*) FILTER (WHERE status = 'REDEEMED')::int AS redeemed,
              COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < now())::int AS expired
       FROM ${TABLE}`
    );
    const t = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS redeemed_value,
              COUNT(*) FILTER (WHERE type = 'REDEEM')::int AS redemptions
       FROM gift_card_transactions WHERE type = 'REDEEM'`
    );
    return {
      issued: r.rows[0].issued,
      issuedValue: Number(r.rows[0].issued_value) || 0,
      outstanding: Number(r.rows[0].outstanding) || 0,
      active: r.rows[0].active,
      suspended: r.rows[0].suspended,
      cancelled: r.rows[0].cancelled,
      redeemed: r.rows[0].redeemed,
      expired: r.rows[0].expired,
      redeemedValue: Number(t.rows[0].redeemed_value) || 0,
      redemptions: t.rows[0].redemptions,
    };
  },

  async remove(uuid) {
    const result = await pool.query(
      `DELETE FROM ${TABLE} WHERE uuid = $1 RETURNING uuid`,
      [uuid]
    );
    return result.rows[0] || null;
  },
};
