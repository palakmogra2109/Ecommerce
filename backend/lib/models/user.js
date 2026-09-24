import pool from "../db";
import { paginate } from "../pagination";
import { USER_STATUS as _USER_STATUS } from "@shared/constants";

const TABLE = "users";

export const USER_STATUS = _USER_STATUS;

export const USER_STATUSES = Object.values(USER_STATUS);

// Columns exposed outside the API. Never includes the password hash or
// the internal integer id.
const PUBLIC_COLUMNS =
  "uuid, name, email, mobile, avatar, status, created_at, updated_at";

// Internal columns used for authorization and joins. The integer id is
// never sent to the client.
const INTERNAL_COLUMNS =
  "id, uuid, name, email, mobile, avatar, parent_id, status, created_at, updated_at";

export const User = {
  TABLE,

  async create({ name, email, password, mobile = null, avatar = null, status = "ACTIVE", parentId = null }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, email, password, mobile, avatar, status, parent_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        (name ?? "").trim(),
        email.toLowerCase().trim(),
        password,
        mobile ?? null,
        avatar ?? null,
        status,
        parentId ?? null,
      ]
    );

    return result.rows[0];
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

  // Internal lookup by integer id. Only for authorization on the
  // integer userId held in the JWT. Not exposed to any client.
  async getInternalById(id) {
    const result = await pool.query(
      `
      SELECT ${INTERNAL_COLUMNS}
      FROM ${TABLE}
      WHERE id = $1
      `,
      [id]
    );

    return result.rows[0] || null;
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `
      SELECT ${PUBLIC_COLUMNS}
      FROM ${TABLE}
      WHERE uuid = $1
      `,
      [uuid]
    );

    return result.rows[0] || null;
  },

  // Includes password hash + integer id. Only for internal auth use.
  async findByEmailWithPassword(email) {
    const result = await pool.query(
      `
      SELECT ${INTERNAL_COLUMNS}, password
      FROM ${TABLE}
      WHERE email = $1
      `,
      [email.toLowerCase().trim()]
    );

    return result.rows[0] || null;
  },

  async list({ search = "", status = "", page = 1, limit = 20, excludeUuids = [], includeStoreRole = false } = {}) {
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

    const excluded = excludeUuids.filter((u) => typeof u === "string");

    if (excluded.length > 0) {
      params.push(excluded);
      conditions.push(`uuid <> ALL($${params.length})`);
    }

    conditions.push(
      `NOT EXISTS (
        SELECT 1 FROM user_has_roles uhr_excl
        JOIN roles r_excl ON r_excl.id = uhr_excl.role_id
        WHERE uhr_excl.user_id = ${TABLE}.id
          AND r_excl.slug = 'super_admin'
      )`
    );

    // Store-role accounts are owned by the Branches module. By default the
    // general Users module hides them; branch management opts in explicitly.
    if (!includeStoreRole) {
      conditions.push(
        `NOT EXISTS (
          SELECT 1 FROM user_has_roles uhr_store
          JOIN roles r_store ON r_store.id = uhr_store.role_id
          WHERE uhr_store.user_id = ${TABLE}.id
            AND r_store.slug = 'store'
        )`
      );
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

  async getInternalByUuid(uuid) {
    const result = await pool.query(
      `
      SELECT ${INTERNAL_COLUMNS}
      FROM ${TABLE}
      WHERE uuid = $1
      `,
      [uuid]
    );

    return result.rows[0] || null;
  },

  async findByUuidWithPassword(uuid) {
    const result = await pool.query(
      `
      SELECT ${INTERNAL_COLUMNS}, password
      FROM ${TABLE}
      WHERE uuid = $1
      `,
      [uuid]
    );

    return result.rows[0] || null;
  },

  async update(uuid, { name, status, mobile, avatar } = {}) {
    const current = await this.findByUuid(uuid);

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
      WHERE uuid = $5
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name !== undefined ? name : current.name,
        status !== undefined ? status : current.status,
        mobile !== undefined ? mobile : current.mobile,
        avatar !== undefined ? avatar : current.avatar,
        uuid,
      ]
    );

    return result.rows[0] || null;
  },

  async updatePassword(uuid, password) {
    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET password = $1,
          updated_at = now()
      WHERE uuid = $2
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [password, uuid]
    );

    return result.rows[0] || null;
  },

  async remove(uuid) {
    const result = await pool.query(
      `
      DELETE FROM ${TABLE}
      WHERE uuid = $1
      RETURNING uuid
      `,
      [uuid]
    );

    return result.rows[0] || null;
  },
};
