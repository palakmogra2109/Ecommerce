import pool from "../db";

const TABLE = "branch_inventory_transactions";

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
        (branchId, productId, productUuid, variantId, transactionType,
         quantity, previousStock, newStock, referenceType, referenceId,
         reason, createdBy)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
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
    const conditions = ["branchId = $1"];
    const params = [branchId];

    if (type) {
      params.push(type);
      conditions.push(`transactionType = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    return paginate(
      {
        baseSql: `SELECT * FROM ${TABLE} WHERE ${where} ORDER BY createdAt DESC`,
        countSql: `SELECT COUNT(*)::int FROM ${TABLE} WHERE ${where}`,
        params,
        orderBy: "",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async getByReference(referenceType, referenceId) {
    const result = await pool.query(
      `SELECT * FROM ${TABLE} WHERE referenceType = $1 AND referenceId = $2 ORDER BY createdAt ASC`,
      [referenceType, referenceId]
    );
    return result.rows;
  },
};
