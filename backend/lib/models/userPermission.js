import pool from "../db";

const TABLE = "user_has_permissions";

export const UserPermission = {
  TABLE,

  // Replace a user's direct permissions with the given ids.
  async sync(userId, permissionIds) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM ${TABLE} WHERE user_id = $1`,
        [userId]
      );

      for (const permissionId of permissionIds) {
        await client.query(
          `
          INSERT INTO ${TABLE} (user_id, permission_id)
          VALUES ($1, $2)
          ON CONFLICT (user_id, permission_id) DO NOTHING
          `,
          [userId, permissionId]
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

  async listPermissionIdsByUser(userId) {
    const result = await pool.query(
      `
      SELECT p.uuid
      FROM ${TABLE} uhp
      JOIN permissions p ON p.id = uhp.permission_id
      WHERE uhp.user_id = $1
      `,
      [userId]
    );

    return result.rows.map((row) => row.uuid);
  },

  async listPermissionSlugsByUser(userId) {
    const result = await pool.query(
      `
      SELECT p.slug
      FROM ${TABLE} uhp
      JOIN permissions p ON p.id = uhp.permission_id
      WHERE uhp.user_id = $1
      `,
      [userId]
    );

    return result.rows.map((row) => row.slug);
  },
};