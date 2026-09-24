import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "branch_stock_transfers";

let transferCounter = 0;
function generateTransferNumber() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const seq = String((transferCounter = ((transferCounter % 9999) + 1)).toString()).padStart(4, "0");
  return `ST-${dateStr}-${seq}`;
}

export const BranchStockTransfer = {
  TABLE,

  async create(data = {}) {
    const {
      sourceBranchId,
      destinationBranchId,
      reason,
      requestById,
      items = [],
    } = data;

    const transferNumber = generateTransferNumber();

    const result = await pool.query(
      `
      INSERT INTO ${TABLE}
        (transferNumber, sourceBranchId, destinationBranchId,
         status, requestById, reason)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [transferNumber, sourceBranchId, destinationBranchId, "REQUESTED", requestById, reason || null]
    );

    const transfer = result.rows[0];

    for (const item of items) {
      await pool.query(
        `
        INSERT INTO branch_transfer_items
          (transferId, productId, productUuid, variantId, quantity)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [transfer.id, item.productId ?? null, item.productUuid ?? null, item.variantId ?? null, item.quantity]
      );
    }

    return transfer;
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `SELECT * FROM ${TABLE} WHERE uuid = $1`,
      [uuid]
    );
    return result.rows[0] || null;
  },

  async getById(id) {
    const result = await pool.query(
      `SELECT * FROM ${TABLE} WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async list({ status = "", page = 1, limit = 20, branchId = "" } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (branchId) {
      params.push(branchId);
      conditions.push(
        `(sourceBranchId = (SELECT id FROM branches WHERE uuid = $${params.length}) OR destinationBranchId = (SELECT id FROM branches WHERE uuid = $${params.length}))`
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return paginate(
      {
        baseSql: `SELECT * FROM ${TABLE} ${where} ORDER BY createdAt DESC`,
        countSql: `SELECT COUNT(*)::int FROM ${TABLE} ${where}`,
        params,
        orderBy: "",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async updateStatus(uuid, status, approvedById = null, receivedById = null) {
    const result = await pool.query(
      `UPDATE ${TABLE} SET status = $1, updatedAt = now()${approvedById ? ", approvedById = $2" : ""}${receivedById ? ", receivedById = $3" : ""} WHERE uuid = $4 RETURNING *`,
      [status, approvedById, receivedById, uuid]
    );
    return result.rows[0] || null;
  },

  async getItems(transferId) {
    const result = await pool.query(
      `SELECT * FROM branch_transfer_items WHERE transferId = $1 ORDER BY createdAt ASC`,
      [transferId]
    );
    return result.rows;
  },

  async getByProduct(transferId, productId) {
    const result = await pool.query(
      `SELECT * FROM branch_transfer_items WHERE transferId = $1 AND productId = $2`,
      [transferId, productId]
    );
    return result.rows[0] || null;
  },
};
