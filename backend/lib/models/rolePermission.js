import pool from "../db";

const TABLE = "role_has_permissions";

export const RolePermission = {
  TABLE,

  async insert(roleId, permissionId) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (role_id, permission_id)
      VALUES ($1, $2)
      ON CONFLICT (role_id, permission_id) DO NOTHING
      RETURNING role_id, permission_id, created_at
      `,
      [roleId, permissionId]
    );

    return result.rows[0] || null;
  },

  async remove(roleId, permissionId) {
    const result = await pool.query(
      `
      DELETE FROM ${TABLE}
      WHERE role_id = $1 AND permission_id = $2
      RETURNING role_id
      `,
      [roleId, permissionId]
    );

    return result.rows[0] || null;
  },

  // Replace a role's permissions with the given permission ids.
  async sync(roleId, permissionIds) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM ${TABLE} WHERE role_id = $1`,
        [roleId]
      );

      for (const permissionId of permissionIds) {
        await client.query(
          `
          INSERT INTO ${TABLE} (role_id, permission_id)
          VALUES ($1, $2)
          ON CONFLICT (role_id, permission_id) DO NOTHING
          `,
          [roleId, permissionId]
        );
      }

      await client.query("COMMIT");

      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async listByRole(roleId) {
    const result = await pool.query(
      `
      SELECT p.id,
             p.name,
             p.slug,
             p.module,
             p.description
      FROM ${TABLE} rhp
      JOIN permissions p ON p.id = rhp.permission_id
      WHERE rhp.role_id = $1
      ORDER BY p.module ASC, p.name ASC
      `,
      [roleId]
    );

    return result.rows;
  },

  async listPermissionIdsByRole(roleId) {
    const result = await pool.query(
      `
      SELECT permission_id
      FROM ${TABLE}
      WHERE role_id = $1
      `,
      [roleId]
    );

    return result.rows.map((row) => row.permission_id);
  },

  async listByPermission(permissionId) {
    const result = await pool.query(
      `
      SELECT r.id,
             r.name,
             r.slug,
             r.status
      FROM ${TABLE} rhp
      JOIN roles r ON r.id = rhp.role_id
      WHERE rhp.permission_id = $1
      ORDER BY r.name ASC
      `,
      [permissionId]
    );

    return result.rows;
  },
};