import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "branch_users";

export const BranchUser = {
  TABLE,

  async create(data = {}) {
    const { branchId, userId, role = "BRANCH_MANAGER" } = data;

    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (branchId, userId, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (branchId, userId) DO NOTHING
      RETURNING *
      `,
      [branchId, userId, role]
    );

    return result.rows[0] || null;
  },

  async assign(userId, branchId, role = "BRANCH_MANAGER") {
    return this.create({ branchId, userId, role });
  },

  async remove(userId, branchId) {
    const result = await pool.query(
      `DELETE FROM ${TABLE} WHERE userId = $1 AND branchId = $2 RETURNING *`,
      [userId, branchId]
    );
    return result.rows[0] || null;
  },

  async listByBranch(branchId) {
    const result = await pool.query(
      `
      SELECT bu.*, u.name, u.email, u.mobile, u.avatar, u.status
      FROM ${TABLE} bu
      JOIN users u ON u.id = bu.userId
      WHERE bu.branchId = $1
      ORDER BY u.name ASC
      `,
      [branchId]
    );
    return result.rows;
  },

  async listByUser(userId) {
    const result = await pool.query(
      `
      SELECT bu.*, b.name AS branchName, b.code AS branchCode, b.city
      FROM ${TABLE} bu
      JOIN branches b ON b.id = bu.branchId
      WHERE bu.userId = $1
      ORDER BY b.name ASC
      `,
      [userId]
    );
    return result.rows;
  },

  async getBranchIds(userId) {
    const result = await pool.query(
      `SELECT branchId FROM ${TABLE} WHERE userId = $1`,
      [userId]
    );
    return result.rows.map((r) => r.branchId);
  },

  async isBranchManager(userId) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ${TABLE} WHERE userId = $1`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10) > 0;
  },
};
