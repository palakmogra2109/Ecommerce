import pool from "../db";
import { paginate } from "../pagination";
import { ROLE_STATUS as _ROLE_STATUS } from "@shared/constants";

const TABLE = "roles";

export const ROLE_STATUS = _ROLE_STATUS;

export const ROLE_STATUSES = Object.values(ROLE_STATUS);

const PUBLIC_COLUMNS =
  "id, name, slug, description, status, created_at, updated_at";

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const Role = {
  TABLE,
  slugify,

  async create({ name, slug, description = "", status = "ACTIVE" }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, slug, description, status)
      VALUES ($1, $2, $3, $4)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name.trim(),
        slugify(slug || name),
        description ?? "",
        status,
      ]
    );

    return result.rows[0] || null;
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

  async findBySlug(slug) {
    const result = await pool.query(
      `
      SELECT ${PUBLIC_COLUMNS}
      FROM ${TABLE}
      WHERE slug = $1
      `,
      [slugify(slug)]
    );

    return result.rows[0] || null;
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

    const where = conditions.length
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

  async update(id, { name, slug, description, status } = {}) {
    const current = await this.findById(id);

    if (!current) {
      return null;
    }

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET name = $1,
          slug = $2,
          description = $3,
          status = $4,
          updated_at = now()
      WHERE id = $5
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name !== undefined ? name.trim() : current.name,
        slug !== undefined ? slugify(slug) : current.slug,
        description !== undefined ? description : current.description,
        status !== undefined ? status : current.status,
        id,
      ]
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