import pool from "../db.js";
import { paginate } from "../pagination.js";

const TABLE = "branch_products";

// branch_products is a folded table: the unquoted camelCase DDL was lowercased
// by Postgres, so the real columns are `branchid`, `stockquantity` and so on
// (sql/inventory.md). Selecting them unquoted yields the folded spelling, so
// every column is aliased back to camelCase on the way out.
//
// The `bp.` qualifier keeps the list usable in the joined list queries, where
// `id`, `uuid` and `status` also exist on products. The write statements alias
// the target table as `bp` for the same reason, which lets one list serve both
// the SELECTs and the RETURNING clauses.
export const BP_COLUMNS =
  `bp.id AS "id", bp.uuid AS "uuid", bp.branchid AS "branchId", bp.productid AS "productId", ` +
  `bp.productuuid AS "productUuid", bp.variantid AS "variantId", bp.sellingprice AS "sellingPrice", ` +
  `bp.compareatprice AS "compareAtPrice", bp.costprice AS "costPrice", bp.stockquantity AS "stockQuantity", ` +
  `bp.reservedquantity AS "reservedQuantity", bp.availablequantity AS "availableQuantity", ` +
  `bp.lowstockthreshold AS "lowStockThreshold", bp.isavailable AS "isAvailable", ` +
  `bp.status AS "status", bp.createdat AS "createdAt", bp.updatedat AS "updatedAt"`;

export const BranchProduct = {
  TABLE,

  async getByBranchProduct(branchId, productId) {
    const result = await pool.query(
      `SELECT ${BP_COLUMNS} FROM ${TABLE} bp WHERE bp.branchid = $1 AND bp.productid = $2`,
      [branchId, productId]
    );
    return result.rows[0] || null;
  },

  async getByBranchAndProductUuid(branchId, productUuid) {
    const result = await pool.query(
      `SELECT ${BP_COLUMNS} FROM ${TABLE} bp WHERE bp.branchid = $1 AND bp.productuuid = $2`,
      [branchId, productUuid]
    );
    return result.rows[0] || null;
  },

  async getByBranch(branchId, { search = "", page = 1, limit = 20 } = {}) {
    const conditions = ["bp.branchid = $1"];
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
      SELECT ${BP_COLUMNS}, p.name AS "productName", p.slug AS "productSlug", p.images AS "productImages",
             p.price AS "globalPrice", p.discount_price AS "globalDiscountPrice",
             p.inventory_mode AS "globalInventoryMode"
      FROM ${TABLE} bp
      JOIN products p ON p.id = bp.productid
      WHERE ${where}
      ORDER BY bp.createdat DESC
    `;

    return paginate(
      {
        baseSql: sql,
        countSql: `SELECT COUNT(*)::int FROM ${TABLE} bp JOIN products p ON p.id = bp.productid WHERE ${where}`,
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
      conditions.push(`bp.branchid IN (${placeholders})`);
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
      SELECT ${BP_COLUMNS}, p.name AS "productName", p.slug AS "productSlug", p.images AS "productImages",
             p.price AS "globalPrice", p.discount_price AS "globalDiscountPrice"
      FROM ${TABLE} bp
      JOIN products p ON p.id = bp.productid
      WHERE ${where}
      ORDER BY bp.createdat DESC
    `;

    return paginate(
      {
        baseSql: sql,
        countSql: `SELECT COUNT(*)::int FROM ${TABLE} bp JOIN products p ON p.id = bp.productid WHERE ${where}`,
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
      INSERT INTO ${TABLE} AS bp
        (branchid, productid, productuuid, variantid, sellingprice,
         compareatprice, costprice, stockquantity, lowstockthreshold,
         isavailable, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (branchid, productid)
      DO UPDATE SET
        sellingprice = EXCLUDED.sellingprice,
        compareatprice = EXCLUDED.compareatprice,
        costprice = EXCLUDED.costprice,
        stockquantity = EXCLUDED.stockquantity,
        lowstockthreshold = EXCLUDED.lowstockthreshold,
        isavailable = EXCLUDED.isavailable,
        status = EXCLUDED.status,
        updatedat = now()
      RETURNING ${BP_COLUMNS}
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

    if (updates.sellingPrice !== undefined) set("sellingprice", updates.sellingPrice != null ? Number(updates.sellingPrice) : null);
    if (updates.compareAtPrice !== undefined) set("compareatprice", updates.compareAtPrice != null ? Number(updates.compareAtPrice) : null);
    if (updates.costPrice !== undefined) set("costprice", updates.costPrice != null ? Number(updates.costPrice) : null);
    if (updates.stockQuantity !== undefined) set("stockquantity", Math.max(0, parseInt(updates.stockQuantity, 10) || 0));
    if (updates.lowStockThreshold !== undefined) set("lowstockthreshold", Math.max(0, parseInt(updates.lowStockThreshold, 10) || 0));
    if (updates.isAvailable !== undefined) set("isavailable", updates.isAvailable);
    if (updates.status !== undefined) set("status", updates.status);

    values.push(uuid);

    const result = await pool.query(
      `UPDATE ${TABLE} AS bp SET ${fields.join(", ")}, updatedat = now() WHERE uuid = $${values.length} RETURNING ${BP_COLUMNS}`,
      values
    );
    return result.rows[0] || null;
  },

  async updateStock(uuid, stockChange, reason = "", transactionType = "ADJUSTMENT") {
    const branchProduct = await pool.query(
      `SELECT ${BP_COLUMNS} FROM ${TABLE} bp WHERE bp.uuid = $1`,
      [uuid]
    );
    if (!branchProduct.rows[0]) return null;

    const bp = branchProduct.rows[0];
    const previousStock = bp.stockQuantity;
    const newStock = Math.max(0, previousStock + stockChange);
    const actualChange = newStock - previousStock;

    const result = await pool.query(
      `UPDATE ${TABLE} AS bp SET stockquantity = $1, updatedat = now() WHERE uuid = $2 RETURNING ${BP_COLUMNS}`,
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
