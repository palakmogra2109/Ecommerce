import pool from "../db.js";
import { paginate } from "../pagination.js";

const TABLE = "branch_stock_transfers";
const ITEMS_TABLE = "branch_transfer_items";

// Both transfer tables are folded: the unquoted camelCase DDL was lowercased by
// Postgres, so the real columns are `transfernumber`, `sourcebranchid` and so on
// (sql/inventory.md). Selecting them unquoted yields the folded spelling, so
// every column is aliased back to camelCase on the way out. There is no `note` or
// `completedat` column on either table - do not add one without a migration.
export const TRANSFER_COLUMNS =
  `id AS "id", uuid AS "uuid", transfernumber AS "transferNumber", ` +
  `sourcebranchid AS "sourceBranchId", destinationbranchid AS "destinationBranchId", ` +
  `status AS "status", requestbyid AS "requestById", approvedbyid AS "approvedById", ` +
  `receivedbyid AS "receivedById", reason AS "reason", ` +
  `createdat AS "createdAt", updatedat AS "updatedAt"`;

export const TRANSFER_ITEM_COLUMNS =
  `id AS "id", uuid AS "uuid", transferid AS "transferId", productid AS "productId", ` +
  `productuuid AS "productUuid", variantid AS "variantId", quantity AS "quantity", ` +
  `previousstocksource AS "previousStockSource", previousstockdest AS "previousStockDest", ` +
  `createdat AS "createdAt"`;

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
        (transfernumber, sourcebranchid, destinationbranchid,
         status, requestbyid, reason)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${TRANSFER_COLUMNS}
      `,
      [transferNumber, sourceBranchId, destinationBranchId, "REQUESTED", requestById, reason || null]
    );

    const transfer = result.rows[0];

    for (const item of items) {
      await pool.query(
        `
        INSERT INTO ${ITEMS_TABLE}
          (transferid, productid, productuuid, variantid, quantity)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [transfer.id, item.productId ?? null, item.productUuid ?? null, item.variantId ?? null, item.quantity]
      );
    }

    return transfer;
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `SELECT ${TRANSFER_COLUMNS} FROM ${TABLE} WHERE uuid = $1`,
      [uuid]
    );
    return result.rows[0] || null;
  },

  async getById(id) {
    const result = await pool.query(
      `SELECT ${TRANSFER_COLUMNS} FROM ${TABLE} WHERE id = $1`,
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
        `(sourcebranchid = (SELECT id FROM branches WHERE uuid = $${params.length}) OR destinationbranchid = (SELECT id FROM branches WHERE uuid = $${params.length}))`
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return paginate(
      {
        baseSql: `SELECT ${TRANSFER_COLUMNS} FROM ${TABLE} ${where} ORDER BY createdat DESC`,
        countSql: `SELECT COUNT(*)::int FROM ${TABLE} ${where}`,
        params,
        orderBy: "",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async updateStatus(uuid, status, approvedById = null, receivedById = null) {
    // The placeholders are numbered from `values.length` as each optional column
    // is added, so an omitted argument no longer shifts the `uuid` bind. The
    // `!= null` test (rather than truthiness) keeps a legitimate 0 id settable.
    const fields = ["status = $1"];
    const values = [status];

    if (approvedById != null) {
      values.push(approvedById);
      fields.push(`approvedbyid = $${values.length}`);
    }
    if (receivedById != null) {
      values.push(receivedById);
      fields.push(`receivedbyid = $${values.length}`);
    }

    values.push(uuid);

    const result = await pool.query(
      `UPDATE ${TABLE} SET ${fields.join(", ")}, updatedat = now() WHERE uuid = $${values.length} RETURNING ${TRANSFER_COLUMNS}`,
      values
    );
    return result.rows[0] || null;
  },

  async getItems(transferId) {
    const result = await pool.query(
      `SELECT ${TRANSFER_ITEM_COLUMNS} FROM ${ITEMS_TABLE} WHERE transferid = $1 ORDER BY createdat ASC`,
      [transferId]
    );
    return result.rows;
  },

  async getByProduct(transferId, productId) {
    const result = await pool.query(
      `SELECT ${TRANSFER_ITEM_COLUMNS} FROM ${ITEMS_TABLE} WHERE transferid = $1 AND productid = $2`,
      [transferId, productId]
    );
    return result.rows[0] || null;
  },
};
