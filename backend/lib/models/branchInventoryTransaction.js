import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "branch_inventory_transactions";

// DB columns are lowercase (branchid, productid, ...). SELECT aliases them to
// camelCase so existing UI (BranchInventory.jsx) keeps working untouched.
const COLS = `branchid AS "branchId", productid AS "productId", productuuid AS "productUuid",
  variantid AS "variantId", transactiontype AS "transactionType", quantity,
  previousstock AS "previousStock", newstock AS "newStock",
  referencetype AS "referenceType", referenceid AS "referenceId",
  reason, createdby AS "createdBy", createdat AS "createdAt", uuid`;

export const BranchInventoryTransaction = {
  TABLE,

  async create(data = {}) {
    const {
      branchId,
      productId,
      productUuid,
      variantId,
      transactionType,
      quantity,
      previousStock,
      newStock,
      referenceType,
      referenceId,
      reason,
      createdBy,
    } = data;

    const result = await pool.query(
      `
      INSERT INTO ${TABLE}
        (branchid, productid, productuuid, variantid, transactiontype,
         quantity, previousstock, newstock, referencetype, referenceid,
         reason, createdby)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING ${COLS}
      `,
      [
        branchId,
        productId ?? null,
        productUuid ?? null,
        variantId ?? null,
        transactionType,
        quantity,
        previousStock ?? 0,
        newStock ?? 0,
        referenceType ?? null,
        referenceId ?? null,
        reason ?? null,
        createdBy ?? null,
      ]
    );

    return result.rows[0];
  },

  async getByBranch(branchId, { page = 1, limit = 50, type = "" } = {}) {
    const conditions = [`branchid = $1`];
    const params = [branchId];

    if (type) {
      params.push(type);
      conditions.push(`transactiontype = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    return paginate(
      {
        baseSql: `SELECT ${COLS} FROM ${TABLE} WHERE ${where} ORDER BY createdat DESC`,
        countSql: `SELECT COUNT(*)::int FROM ${TABLE} WHERE ${where}`,
        params,
        orderBy: "",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async getByReference(referenceType, referenceId) {
    const result = await pool.query(
      `SELECT ${COLS} FROM ${TABLE} WHERE referencetype = $1 AND referenceid = $2 ORDER BY createdat ASC`,
      [referenceType, referenceId]
    );
    return result.rows;
  },
};
