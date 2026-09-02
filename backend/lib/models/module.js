import pool from "../db";

const TABLE = "modules";

export const Module = {
  TABLE,

  async create({ name, slug }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, slug)
      VALUES ($1, $2)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id, name, slug, status, created_at
      `,
      [name.trim(), slug.trim()]
    );

    return result.rows[0] || null;
  },

  async findById(id) {
    const result = await pool.query(
      `
      SELECT id, name, slug, status, created_at
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
      SELECT id, name, slug, status, created_at
      FROM ${TABLE}
      WHERE slug = $1
      `,
      [slug.trim()]
    );

    return result.rows[0] || null;
  },

  async list() {
    const result = await pool.query(
      `
      SELECT id, name, slug, status, created_at
      FROM ${TABLE}
      ORDER BY name ASC
      `
    );

    return result.rows;
  },

  // Modules the given user's roles can access via module_has_roles.
  async listByUser(userId) {
    const result = await pool.query(
      `
      SELECT DISTINCT m.id,
             m.name,
             m.slug,
             m.status
      FROM ${TABLE} m
      JOIN module_has_roles mhr ON mhr.module_id = m.id
      JOIN user_has_roles uhr ON uhr.role_id = mhr.role_id
      WHERE uhr.user_id = $1
      ORDER BY m.name ASC
      `,
      [userId]
    );

    return result.rows;
  },
};