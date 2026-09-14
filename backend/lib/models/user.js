import pool from "../db";
import { paginate } from "../pagination";
import { USER_STATUS as _USER_STATUS } from "@shared/constants";

const TABLE = "users";

export const USER_STATUS = _USER_STATUS;

export const USER_STATUSES = Object.values(USER_STATUS);

// Columns exposed outside the API. Never includes the password hash.
const PUBLIC_COLUMNS =
  "id, name, email, mobile, avatar, status, created_at, updated_at";

export const User = {
  TABLE,

  async create({
    name,
    email,
    password,
    mobile = null,
    avatar = null,
    status = "ACTIVE",
  }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, email, password, mobile, avatar, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        (name ?? "").trim(),
        email.toLowerCase().trim(),
        password,
        mobile ?? null,
        avatar ?? null,
        status,
      ]
    );

    return result.rows[0];
  },

  async findById(id) {
    const result = await pool.query(
      `
      SELECT ${PUBLIC_COLUMNS}
      FROM ${TABLE}
      WHERE id = $1
      `,
      [id]
    );

    return result.rows[0] || null;
  },

  async findByEmail(email) {
    const result = await pool.query(
      `
      SELECT ${PUBLIC_COLUMNS}
      FROM ${TABLE}
      WHERE email = $1
      `,
      [email.toLowerCase().trim()]
    );

    return result.rows[0] || null;
  },

  // Includes password hash. Only for internal auth use.
  async findByEmailWithPassword(email) {
    const result = await pool.query(
      `
      SELECT ${PUBLIC_COLUMNS}, password
      FROM ${TABLE}
      WHERE email = $1
      `,
      [email.toLowerCase().trim()]
    );

    return result.rows[0] || null;
  },

  async list({
    search = "",
    status = null,
    page = 1,
    limit = 20,
    excludeIds = [],
  } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(name ILIKE $${params.length} OR email ILIKE $${params.length} OR COALESCE(mobile, '') ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const excluded = excludeIds.map(Number).filter((id) => Number.isInteger(id));

    if (excluded.length > 0) {
      params.push(excluded);
      conditions.push(`id <> ALL($${params.length})`);
    }

    // Super admin accounts are invisible to everyone else — never list
    // them and never count them in pagination totals.
    conditions.push(
      `NOT EXISTS (
        SELECT 1 FROM user_has_roles uhr_excl
        JOIN roles r_excl ON r_excl.id = uhr_excl.role_id
        WHERE uhr_excl.user_id = ${TABLE}.id
          AND r_excl.slug = 'super_admin'
      )`
    );

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

  async update(id, { name, status, mobile, avatar } = {}) {
    const current = await this.findById(id);

    if (!current) {
      return null;
    }

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET name = $1,
          status = $2,
          mobile = $3,
          avatar = $4,
          updated_at = now()
      WHERE id = $5
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name !== undefined ? name.trim() : current.name,
        status !== undefined ? status : current.status,
        mobile !== undefined ? mobile : current.mobile,
        avatar !== undefined ? avatar : current.avatar,
        id,
      ]
    );

    return result.rows[0] || null;
  },

  async updatePassword(id, password) {
    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET password = $1,
          updated_at = now()
      WHERE id = $2
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [password, id]
    );

    return result.rows[0] || null;
  },

  async remove(id) {
    const result = await pool.query(
      `
      DELETE FROM ${TABLE}
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    return result.rows[0] || null;
  },
};