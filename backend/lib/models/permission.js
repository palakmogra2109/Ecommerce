import pool from "../db";

const TABLE = "permissions";

const PUBLIC_COLUMNS =
  "id, name, slug, module, description, created_at";

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const Permission = {
  TABLE,
  slugify,

  async create({
    name,
    slug,
    module,
    description = "",
  }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, slug, module, description)
      VALUES ($1, $2, $3, $4)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name.trim(),
        slugify(slug || name),
        (module ?? "").trim(),
        description ?? "",
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

  async list({ module = "", search = "" } = {}) {
    const conditions = [];
    const params = [];

    if (module) {
      params.push(module.trim());
      conditions.push(`module = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(name ILIKE $${params.length} OR slug ILIKE $${params.length})`
      );
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
      ORDER BY module ASC, name ASC
      `,
      params
    );

    return result.rows;
  },

  async update(id, { name, module, description } = {}) {
    const current = await this.findById(id);

    if (!current) {
      return null;
    }

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET name = $1,
          module = $2,
          description = $3
      WHERE id = $4
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        name !== undefined ? name.trim() : current.name,
        module !== undefined ? module : current.module,
        description !== undefined ? description : current.description,
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