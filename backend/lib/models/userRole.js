import pool from "../db";

const TABLE = "user_has_roles";

export const UserRole = {
  TABLE,

  // Assign a role to a user. Safe to call multiple times.
  async insert(userId, roleId) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (user_id, role_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, role_id) DO NOTHING
      RETURNING user_id, role_id, created_at
      `,
      [userId, roleId]
    );

    return result.rows[0] || null;
  },

  async remove(userId, roleId) {
    const result = await pool.query(
      `
      DELETE FROM ${TABLE}
      WHERE user_id = $1 AND role_id = $2
      RETURNING user_id
      `,
      [userId, roleId]
    );

    return result.rows[0] || null;
  },

  // Assign one role to a user (single-role model used by the UI).
  async assign(userId, roleId) {
    return await this.insert(userId, roleId);
  },

  // Replace the user's roles with the given one.
  async replaceRole(userId, roleId) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM ${TABLE} WHERE user_id = $1`,
        [userId]
      );

      await client.query(
        `
        INSERT INTO ${TABLE} (user_id, role_id)
        VALUES ($1, $2)
        `,
        [userId, roleId]
      );

      await client.query("COMMIT");

      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async listByUser(userId) {
    const result = await pool.query(
      `
      SELECT r.id,
             r.name,
             r.slug,
             r.description,
             r.status
      FROM ${TABLE} uhr
      JOIN roles r ON r.id = uhr.role_id
      WHERE uhr.user_id = $1
      ORDER BY r.name ASC
      `,
      [userId]
    );

    return result.rows;
  },

  async listByRole(roleId) {
    const result = await pool.query(
      `
      SELECT u.id,
             u.name,
             u.email,
             u.status
      FROM ${TABLE} uhr
      JOIN users u ON u.id = uhr.user_id
      WHERE uhr.role_id = $1
      ORDER BY u.name ASC
      `,
      [roleId]
    );

    return result.rows;
  },

  // Collapse a user's roles into the set of permission slugs
  // they are allowed to use.
  async listPermissionSlugsByUser(userId) {
    const result = await pool.query(
      `
      SELECT DISTINCT p.slug
      FROM ${TABLE} uhr
      JOIN role_has_permissions rhp ON rhp.role_id = uhr.role_id
      JOIN permissions p ON p.id = rhp.permission_id
      WHERE uhr.user_id = $1 AND uhr.role_id IN (
        SELECT r.id FROM roles r WHERE r.status = 'ACTIVE'
      )
      `,
      [userId]
    );

    return result.rows.map((row) => row.slug);
  },

  // Role slugs a user has.
  async listRoleSlugsByUser(userId) {
    const result = await pool.query(
      `
      SELECT r.slug
      FROM ${TABLE} uhr
      JOIN roles r ON r.id = uhr.role_id
      WHERE uhr.user_id = $1 AND r.status = 'ACTIVE'
      `,
      [userId]
    );

    return result.rows.map((row) => row.slug);
  },

  // True when the user carries the super admin role.
  async isSuperAdmin(userId) {
    const result = await pool.query(
      `
      SELECT 1
      FROM ${TABLE} uhr
      JOIN roles r ON r.id = uhr.role_id
      WHERE uhr.user_id = $1 AND r.slug = 'super_admin'
      LIMIT 1
      `,
      [userId]
    );

    return result.rows.length > 0;
  },
};