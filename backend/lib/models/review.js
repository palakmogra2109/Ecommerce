import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "reviews";

const PUBLIC_COLUMNS =
  "uuid, rating, title, comment, images, status, admin_response, created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, product_id, customer_id, rating, title, comment, images, status, admin_response, created_at, updated_at";

const BASE_SELECT = `
  SELECT r.uuid, r.rating, r.title, r.comment, r.images, r.status,
         r.admin_response, r.created_at, r.updated_at,
         r.customer_name,
         p.uuid AS product_uuid, p.name AS product_name, p.slug AS product_slug
  FROM reviews r
  LEFT JOIN products p ON p.id = r.product_id
`;

// Kept here so the review model can resolve uuids without pulling in
// extra imports.
async function resolveId(table, uuid) {
  if (!uuid) {
    return null;
  }

  const result = await pool.query(
    `SELECT id FROM ${table} WHERE uuid = $1`,
    [uuid]
  );

  return result.rows[0]?.id ?? null;
}

export const Review = {
  TABLE,

  async create(data = {}) {
    const {
      productUuid,
      customerUuid = null,
      customerName = "",
      rating,
      title = "",
      comment = "",
      images = [],
      status = "PENDING",
      adminResponse = null,
    } = data;

    const productId = await resolveId("products", productUuid);
    const customerId = await resolveId("customers", customerUuid);

    if (!productId) {
      return null;
    }

    const result = await pool.query(
      `
      INSERT INTO ${TABLE}
        (product_id, customer_id, customer_name, rating, title, comment,
         images, status, admin_response)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        productId,
        customerId,
        (customerName ?? "").trim(),
        Math.min(5, Math.max(1, parseInt(rating, 10))) || 1,
        title ?? "",
        comment ?? "",
        JSON.stringify(Array.isArray(images) ? images : []),
        status,
        adminResponse,
      ]
    );

    return result.rows[0] || null;
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `${BASE_SELECT} WHERE r.uuid = $1`,
      [uuid]
    );

    return result.rows[0] || null;
  },

  async getInternalByUuid(uuid) {
    const result = await pool.query(
      `SELECT ${INTERNAL_COLUMNS} FROM ${TABLE} WHERE uuid = $1`,
      [uuid]
    );

    return result.rows[0] || null;
  },

  async list({ search = "", rating = "", status = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(r.comment ILIKE $${params.length} OR r.title ILIKE $${params.length} OR r.customer_name ILIKE $${params.length})`
      );
    }

    if (rating) {
      params.push(parseInt(rating, 10));
      conditions.push(`r.rating = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    return paginate(
      {
        baseSql: `${BASE_SELECT} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM reviews r ${where}`,
        params,
        orderBy: "ORDER BY r.created_at DESC, r.id DESC",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async update(uuid, updates = {}) {
    const current = await this.getInternalByUuid(uuid);

    if (!current) {
      return null;
    }

    const fields = [];
    const values = [];

    const set = (column, value) => {
      fields.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };

    if (updates.rating !== undefined) {
      set(
        "rating",
        Math.min(5, Math.max(1, parseInt(updates.rating, 10))) || 1
      );
    }

    if (updates.title !== undefined) {
      set("title", updates.title ?? "");
    }

    if (updates.comment !== undefined) {
      set("comment", updates.comment ?? "");
    }

    if (updates.images !== undefined) {
      set(
        "images",
        JSON.stringify(Array.isArray(updates.images) ? updates.images : [])
      );
    }

    if (updates.status !== undefined) {
      set("status", updates.status);
    }

    if (updates.adminResponse !== undefined) {
      set("admin_response", updates.adminResponse ?? null);
    }

    values.push(uuid);

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET ${fields.join(", ")}, updated_at = now()
      WHERE uuid = $${values.length}
      RETURNING uuid
      `,
      values
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.findByUuid(uuid);
  },

  async remove(uuid) {
    const result = await pool.query(
      `DELETE FROM ${TABLE} WHERE uuid = $1 RETURNING uuid`,
      [uuid]
    );

    return result.rows[0] || null;
  },
};