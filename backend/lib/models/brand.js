import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "brands";

const PUBLIC_COLUMNS =
  "uuid, name, slug, description, logo, status, created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, name, slug, description, logo, status, created_at, updated_at";

export const Brand = {
  TABLE,

  slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  },

  selectWithCount(alias) {
    const a = alias || "b";

    return `
      SELECT ${a}.uuid, ${a}.name, ${a}.slug, ${a}.description, ${a}.logo, ${a}.status,
             ${a}.created_at, ${a}.updated_at,
             (SELECT COUNT(*)::int FROM products pr WHERE pr.brand_id = ${a}.id) AS product_count
      FROM ${TABLE} ${a}
    `;
  },

  async create({ name, slug, description = "", logo = null, status = "ACTIVE" }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, slug, description, logo, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        (name ?? "").trim(),
        this.slugify(slug || name),
        description ?? "",
        logo ?? null,
        status,
      ]
    );

    return result.rows[0] || null;
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `SELECT b.uuid, b.name, b.slug, b.description, b.logo, b.status,
              b.created_at, b.updated_at,
              (SELECT COUNT(*)::int FROM products pr WHERE pr.brand_id = b.id) AS product_count
       FROM ${TABLE} b WHERE b.uuid = $1`,
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
      `SELECT b.uuid, b.name, b.slug, b.description, b.logo, b.status,
              b.created_at, b.updated_at,
              (SELECT COUNT(*)::int FROM products pr WHERE pr.brand_id = b.id) AS product_count
       FROM ${TABLE} b WHERE b.slug = $1`,
      [this.slugify(slug)]
    );

    return result.rows[0] || null;
  },

  async all({ status = "" } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`b.status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await pool.query(
      `SELECT b.uuid, b.name, b.slug, b.description, b.logo, b.status,
              b.created_at, b.updated_at,
              (SELECT COUNT(*)::int FROM products pr WHERE pr.brand_id = b.id) AS product_count
       FROM ${TABLE} b ${where} ORDER BY b.name ASC`,
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
        `(b.name ILIKE $${params.length} OR b.slug ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`b.status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    return paginate(
      {
        baseSql: `${this.selectWithCount("b")} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM ${TABLE} b ${where}`,
        params,
        orderBy: "ORDER BY b.name ASC",
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

    if (updates.description !== undefined) {
      set("description", updates.description ?? "");
    }

    if (updates.logo !== undefined) {
      set("logo", updates.logo ?? null);
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