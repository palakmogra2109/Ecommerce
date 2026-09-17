import pool from "../db";
import { paginate } from "../pagination";
import { STATUS as _STATUS } from "@shared/constants";

const TABLE = "email_templates";

export const EMAIL_TEMPLATE_STATUS = _STATUS;

export const EMAIL_TEMPLATE_STATUSES = Object.values(_STATUS);

// Columns exposed outside the API.
const PUBLIC_COLUMNS =
  "uuid, name, slug, subject, body_html, body_text, variables, status, created_at, updated_at";

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const EmailTemplate = {
  TABLE,
  slugify,

  async create({ name, slug, subject, bodyHtml, bodyText, variables = [], status = "ACTIVE" }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, slug, subject, body_html, body_text, variables, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name.trim(),
        slugify(slug || name),
        subject ?? "",
        bodyHtml ?? "",
        bodyText ?? "",
        JSON.stringify(variables || []),
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

  async findActiveBySlug(slug) {
    const result = await pool.query(
      `
      SELECT ${PUBLIC_COLUMNS}
      FROM ${TABLE}
      WHERE slug = $1 AND status = 'ACTIVE'
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
        `(name ILIKE $${params.length} OR slug ILIKE $${params.length} OR subject ILIKE $${params.length})`
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

  async update(uuid, { name, slug, subject, bodyHtml, bodyText, variables, status } = {}) {
    const current = await this.findByUuid(uuid);

    if (!current) {
      return null;
    }

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET name = $1,
          slug = $2,
          subject = $3,
          body_html = $4,
          body_text = $5,
          variables = $6,
          status = $7,
          updated_at = now()
      WHERE uuid = $8
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name !== undefined ? name.trim() : current.name,
        slug !== undefined ? slugify(slug) : current.slug,
        subject !== undefined ? subject : current.subject,
        bodyHtml !== undefined ? bodyHtml : current.body_html,
        bodyText !== undefined ? bodyText : current.body_text,
        variables !== undefined
          ? JSON.stringify(variables || [])
          : JSON.stringify(current.variables || []),
        status !== undefined ? status : current.status,
        uuid,
      ]
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

  async getInternalByUuid(uuid) {
    const result = await pool.query(
      `
      SELECT id, uuid
      FROM ${TABLE}
      WHERE uuid = $1
      `,
      [uuid]
    );

    return result.rows[0] || null;
  },
};