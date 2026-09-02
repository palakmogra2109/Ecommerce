import pool from "../db";

const TABLE = "module_has_roles";

export const ModuleRole = {
  TABLE,

  // Assign a role to a module. Safe to call multiple times
  // (upsert via ON CONFLICT DO NOTHING).
  async insert(moduleId, roleId) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (module_id, role_id)
      VALUES ($1, $2)
      ON CONFLICT (module_id, role_id) DO NOTHING
      RETURNING module_id, role_id, created_at
      `,
      [moduleId, roleId]
    );

    return result.rows[0] || null;
  },

  async remove(moduleId, roleId) {
    const result = await pool.query(
      `
      DELETE FROM ${TABLE}
      WHERE module_id = $1 AND role_id = $2
      RETURNING module_id
      `,
      [moduleId, roleId]
    );

    return result.rows[0] || null;
  },

  async listByModule(moduleId) {
    const result = await pool.query(
      `
      SELECT r.id,
             r.name,
             r.slug,
             r.description,
             r.status
      FROM ${TABLE} mhr
      JOIN roles r ON r.id = mhr.role_id
      WHERE mhr.module_id = $1
      ORDER BY r.name ASC
      `,
      [moduleId]
    );

    return result.rows;
  },

  async listByRole(roleId) {
    const result = await pool.query(
      `
      SELECT m.id,
             m.name,
             m.slug,
             m.status
      FROM ${TABLE} mhr
      JOIN modules m ON m.id = mhr.module_id
      WHERE mhr.role_id = $1
      ORDER BY m.name ASC
      `,
      [roleId]
    );

    return result.rows;
  },
};