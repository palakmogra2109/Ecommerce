import pool from "../db";

const TABLE = "branch_products";

export const BranchProduct = {
  TABLE,

  async getByBranchProduct(branchId, productId) {
    const result = await pool.query(
      `SELECT * FROM ${TABLE} WHERE branchId = $1 AND productId = $2`,
      [branchId, productId]
    );
    return result.rows[0] || null;
  },

  async getByBranchAndProductUuid(branchId, productUuid) {
    const result = await pool.query(
      `SELECT * FROM ${TABLE} WHERE branchId = $1 AND productUuid = $2`,
      [branchId, productUuid]
    );
    return result.rows[0] || null;
  },

  async getByBranch(branchId, { search = "", page = 1, limit = 20 } = {}) {
    const conditions = ["bp.branchId = $1"];
    const params = [branchId];

    if (search) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      conditions.push(
        `(p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`
      );
    }

    const where = conditions.join(" AND ");

    const sql = `
      SELECT bp.*, p.name AS productName, p.slug AS productSlug, p.images AS productImages,
             p.price AS globalPrice, p.discount_price AS globalDiscountPrice,
             p.inventory_mode AS globalInventoryMode
      FROM ${TABLE} bp
      JOIN products p ON p.id = bp.productId
      WHERE ${where}
      ORDER BY bp.createdAt DESC
    `;

    return paginate(
      {
        baseSql: sql,
        countSql: `SELECT COUNT(*)::int FROM ${TABLE} bp JOIN products p ON p.id = bp.productId WHERE ${where}`,
        params,
        orderBy: "",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async listForBranches(branchIds, { search = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (branchIds.length > 0) {
      const placeholders = branchIds.map((_, i) => `$${i + 1}`).join(", ");
      params.push(...branchIds);
      conditions.push(`bp.branchId IN (${placeholders})`);
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      conditions.push(
        `(p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`
      );
    }

    const where = conditions.join(" AND ");

    const sql = `
      SELECT bp.*, p.name AS productName, p.slug AS productSlug, p.images AS productImages,
             p.price AS globalPrice, p.discount_price AS globalDiscountPrice
      FROM ${TABLE} bp
      JOIN products p ON p.id = bp.productId
      WHERE ${where}
      ORDER BY bp.createdAt DESC
    `;

    return paginate(
      {
        baseSql: sql,
        countSql: `SELECT COUNT(*)::int FROM ${TABLE} bp JOIN products p ON p.id = bp.productId WHERE ${where}`,
        params,
        orderBy: "",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async create(data = {}) {
    const {
      branchId,
      productId,
      productUuid,
      variantId,
      sellingPrice,
      compareAtPrice,
      costPrice,
      stockQuantity = 0,
      lowStockThreshold = 5,
      isAvailable = true,
      status = "ACTIVE",
    } = data;

    const result = await pool.query(
      `
      INSERT INTO ${TABLE}
        (branchId, productId, productUuid, variantId, sellingPrice,
         compareAtPrice, costPrice, stockQuantity, lowStockThreshold,
         isAvailable, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (branchId, productId)
      DO UPDATE SET
        sellingPrice = EXCLUDED.sellingPrice,
        compareAtPrice = EXCLUDED.compareAtPrice,
        costPrice = EXCLUDED.costPrice,
        stockQuantity = EXCLUDED.stockQuantity,
        lowStockThreshold = EXCLUDED.lowStockThreshold,
        isAvailable = EXCLUDED.isAvailable,
        status = EXCLUDED.status,
        updatedAt = now()
      RETURNING *
      `,
      [
        branchId,
        productId ?? null,
        productUuid ?? null,
        variantId ?? null,
        sellingPrice != null ? Number(sellingPrice) : null,
        compareAtPrice != null ? Number(compareAtPrice) : null,
        costPrice != null ? Number(costPrice) : null,
        Math.max(0, parseInt(stockQuantity, 10) || 0),
        Math.max(0, parseInt(lowStockThreshold, 10) || 0),
        isAvailable,
        status,
      ]
    );

    return result.rows[0];
  },

  async update(uuid, updates = {}) {
    const fields = [];
    const values = [];
    const set = (col, val) => {
      fields.push(`${col} = $${values.length + 1}`);
      values.push(val);
    };

    if (updates.sellingPrice !== undefined) set("sellingPrice", updates.sellingPrice != null ? Number(updates.sellingPrice) : null);
    if (updates.compareAtPrice !== undefined) set("compareAtPrice", updates.compareAtPrice != null ? Number(updates.compareAtPrice) : null);
    if (updates.costPrice !== undefined) set("costPrice", updates.costPrice != null ? Number(updates.costPrice) : null);
    if (updates.stockQuantity !== undefined) set("stockQuantity", Math.max(0, parseInt(updates.stockQuantity, 10) || 0));
    if (updates.lowStockThreshold !== undefined) set("lowStockThreshold", Math.max(0, parseInt(updates.lowStockThreshold, 10) || 0));
    if (updates.isAvailable !== undefined) set("isAvailable", updates.isAvailable);
    if (updates.status !== undefined) set("status", updates.status);

    values.push(uuid);

    const result = await pool.query(
      `UPDATE ${TABLE} SET ${fields.join(", ")}, updatedAt = now() WHERE uuid = $${values.length} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  },

  async updateStock(uuid, stockChange, reason = "", transactionType = "ADJUSTMENT") {
    const branchProduct = await pool.query(
      `SELECT * FROM ${TABLE} WHERE uuid = $1`,
      [uuid]
    );
    if (!branchProduct.rows[0]) return null;

    const bp = branchProduct.rows[0];
    const previousStock = bp.stockQuantity;
    const newStock = Math.max(0, previousStock + stockChange);
    const actualChange = newStock - previousStock;

    const result = await pool.query(
      `UPDATE ${TABLE} SET stockQuantity = $1, updatedAt = now() WHERE uuid = $2 RETURNING *`,
      [newStock, uuid]
    );

    return {
      branchProduct: result.rows[0],
      previousStock,
      newStock,
      actualChange,
    };
  },
};
