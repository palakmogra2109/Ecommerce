import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "banners";

const PUBLIC_COLUMNS =
  "uuid, title, subtitle, image, link, position, sort_order, status, created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, title, subtitle, image, link, position, sort_order, status, created_at, updated_at";

export const Banner = {
  TABLE,

  async create(data = {}) {
    const {
      title = "",
      subtitle = "",
      image = null,
      link = "",
      position = "hero",
      sortOrder = 0,
      status = "ACTIVE",
    } = data;

    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (title, subtitle, image, link, position, sort_order, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        title ?? "",
        subtitle ?? "",
        image ?? null,
        link ?? "",
        position,
        Number(sortOrder) || 0,
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
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} ${where} ORDER BY sort_order ASC, created_at DESC`,
      params
    );

    return result.rows;
  },

  async list({ search = "", status = "", position = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(title ILIKE $${params.length} OR subtitle ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (position) {
      params.push(position);
      conditions.push(`position = $${params.length}`);
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
        orderBy: "ORDER BY sort_order ASC, created_at DESC",
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

    if (updates.title !== undefined) {
      set("title", updates.title ?? "");
    }

    if (updates.subtitle !== undefined) {
      set("subtitle", updates.subtitle ?? "");
    }

    if (updates.image !== undefined) {
      set("image", updates.image ?? null);
    }

    if (updates.link !== undefined) {
      set("link", updates.link ?? "");
    }

    if (updates.position !== undefined) {
      set("position", updates.position);
    }

    if (updates.sortOrder !== undefined) {
      set("sort_order", Number(updates.sortOrder) || 0);
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