import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "coupons";

const PUBLIC_COLUMNS =
  "uuid, code, type, value, min_order_amount, max_discount_amount, starts_at," +
  " ends_at, usage_limit, per_customer_limit, used_count, description, status," +
  " created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, code, type, value, min_order_amount, max_discount_amount, starts_at," +
  " ends_at, usage_limit, per_customer_limit, used_count, description, status, created_at, updated_at";

export const Coupon = {
  TABLE,

  normalizeCode(value) {
    return String(value || "").trim().replace(/\s+/g, "-").toUpperCase();
  },

  async create(data = {}) {
    const {
      code,
      type = "PERCENTAGE",
      value = 0,
      minOrderAmount = 0,
      maxDiscountAmount = null,
      startsAt = null,
      endsAt = null,
      usageLimit = null,
      perCustomerLimit = 1,
      description = "",
      status = "ACTIVE",
    } = data;

    const result = await pool.query(
      `
      INSERT INTO ${TABLE}
        (code, type, value, min_order_amount, max_discount_amount, starts_at,
         ends_at, usage_limit, per_customer_limit, description, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        this.normalizeCode(code),
        type,
        Number(value) || 0,
        Number(minOrderAmount) || 0,
        maxDiscountAmount == null || maxDiscountAmount === ""
          ? null
          : Number(maxDiscountAmount),
        startsAt || null,
        endsAt || null,
        usageLimit == null || usageLimit === "" ? null : parseInt(usageLimit, 10),
        Math.max(1, parseInt(perCustomerLimit, 10) || 1),
        description ?? "",
        status,
      ]
    );

    return result.rows[0] || null;
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} WHERE uuid = $1`,
      [uuid]
    );

    return result.rows[0] || null;
  },

  async getInternalByUuid(uuid) {
    const result = await pool.query(
      `SELECT ${INTERNAL_COLUMNS} FROM ${TABLE} WHERE uuid = $1`,
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

  async list({ search = "", status = "", type = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(code ILIKE $${params.length} OR description ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

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
    const current = await this.getInternalByUuid(uuid);

    if (!current) {
      return null;
    }

    const fields = [];
    const values = [];

    const set = (column, value) => {
      fields.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };

    if (updates.code !== undefined) {
      set("code", this.normalizeCode(updates.code));
    }

    if (updates.type !== undefined) {
      set("type", updates.type);
    }

    if (updates.value !== undefined) {
      set("value", Number(updates.value) || 0);
    }

    if (updates.minOrderAmount !== undefined) {
      set("min_order_amount", Number(updates.minOrderAmount) || 0);
    }

    if (updates.maxDiscountAmount !== undefined) {
      set(
        "max_discount_amount",
        updates.maxDiscountAmount == null || updates.maxDiscountAmount === ""
          ? null
          : Number(updates.maxDiscountAmount)
      );
    }

    if (updates.startsAt !== undefined) {
      set("starts_at", updates.startsAt || null);
    }

    if (updates.endsAt !== undefined) {
      set("ends_at", updates.endsAt || null);
    }

    if (updates.usageLimit !== undefined) {
      set(
        "usage_limit",
        updates.usageLimit == null || updates.usageLimit === ""
          ? null
          : parseInt(updates.usageLimit, 10)
      );
    }

    if (updates.perCustomerLimit !== undefined) {
      set("per_customer_limit", Math.max(1, parseInt(updates.perCustomerLimit, 10) || 1));
    }

    if (updates.description !== undefined) {
      set("description", updates.description ?? "");
    }

    if (updates.status !== undefined) {
      set("status", updates.status);
    }

    values.push(uuid);

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET ${fields.join(", ")}, updated_at = now()
      WHERE uuid = $${values.length}
      RETURNING ${PUBLIC_COLUMNS}
      `,
      values
    );

    return result.rows[0] || null;
  },

  async remove(uuid) {
    const result = await pool.query(
      `DELETE FROM ${TABLE} WHERE uuid = $1 RETURNING uuid`,
      [uuid]
    );

    return result.rows[0] || null;
  },
};