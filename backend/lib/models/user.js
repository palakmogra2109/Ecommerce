import pool from "../db";

const TABLE = "users";

export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
};

export const USER_STATUSES = Object.values(USER_STATUS);

// Columns exposed outside the API. Never includes the password hash.
const PUBLIC_COLUMNS =
  "id, name, email, status, created_at, updated_at";

export const User = {
  TABLE,

  async create({ name, email, password, status = "ACTIVE" }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, email, password, status)
      VALUES ($1, $2, $3, $4)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        (name ?? "").trim(),
        email.toLowerCase().trim(),
        password,
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

  async list({ search = "", status = null } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(name ILIKE $${params.length} OR email ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await pool.query(
      `
      SELECT ${PUBLIC_COLUMNS}
      FROM ${TABLE}
      ${where}
      ORDER BY created_at DESC, id DESC
      `,
      params
    );

    return result.rows;
  },

  async update(id, { name, status } = {}) {
    const current = await this.findById(id);

    if (!current) {
      return null;
    }

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET name = $1,
          status = $2,
          updated_at = now()
      WHERE id = $3
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name !== undefined ? name.trim() : current.name,
        status !== undefined ? status : current.status,
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