import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "attributes";

const PUBLIC_COLUMNS = "uuid, name, slug, status, created_at, updated_at";

const INTERNAL_COLUMNS = "id, uuid, name, slug, status, created_at, updated_at";

export const AttributeType = {
  TABLE,

  slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  },

  async create({ name, slug, status = "ACTIVE" }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, slug, status)
      VALUES ($1, $2, $3)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [(name ?? "").trim(), this.slugify(slug || name), status]
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

  async findBySlug(slug) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} WHERE slug = $1`,
      [this.slugify(slug)]
    );

    return result.rows[0] || null;
  },

  async all({ status = "" } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} ${where} ORDER BY name ASC`,
      params
    );

    return result.rows;
  },

  async list({ search = "", status = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(name ILIKE $${params.length} OR slug ILIKE $${params.length})`
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

    return paginate(
      {
        baseSql: `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM ${TABLE} ${where}`,
        params,
        orderBy: "ORDER BY name ASC",
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

    if (updates.name !== undefined) {
      set("name", (updates.name ?? "").trim());
    }

    if (updates.slug !== undefined) {
      set("slug", this.slugify(updates.slug || current.name));
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