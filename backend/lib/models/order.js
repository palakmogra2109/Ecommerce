import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "orders";

const PUBLIC_COLUMNS =
  "uuid, order_number, customer_name, customer_email, customer_mobile," +
  " shipping_address, subtotal, discount, total, coupon_code, payment_method," +
  " payment_status, status, created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, order_number, customer_id, customer_name, customer_email," +
  " customer_mobile, shipping_address, subtotal, discount, total, coupon_id," +
  " coupon_code, payment_method, payment_status, status, created_at, updated_at";

const BASE_SELECT = `
  SELECT o.uuid, o.order_number, o.customer_name, o.customer_email,
         o.customer_mobile, o.shipping_address, o.subtotal, o.discount,
         o.total, o.coupon_code, o.payment_method, o.payment_status, o.status,
         o.created_at, o.updated_at,
         c.uuid AS customer_uuid
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
`;

export const Order = {
  TABLE,

  // Generates the next unique order number (ORD-0001001).
  async nextOrderNumber() {
    const result = await pool.query(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM orders`
    );

    const nextId = parseInt(result.rows[0]?.next_id || "1", 10);

    return `ORD-${String(nextId).padStart(7, "0")}`;
  },

  async create(data = {}) {
    const {
      customerId = null,
      customerName = "",
      customerEmail = "",
      customerMobile = null,
      shippingAddress = {},
      subtotal = 0,
      discount = 0,
      total = 0,
      couponId = null,
      couponCode = null,
      paymentMethod = "cod",
      paymentStatus = "PENDING",
    } = data;

    const orderNumber = await this.nextOrderNumber();

    const result = await pool.query(
      `
      INSERT INTO ${TABLE}
        (order_number, customer_id, customer_name, customer_email,
         customer_mobile, shipping_address, subtotal, discount, total,
         coupon_id, coupon_code, payment_method, payment_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING uuid
      `,
      [
        orderNumber,
        customerId,
        (customerName ?? "").trim(),
        (customerEmail ?? "").trim(),
        customerMobile ?? null,
        JSON.stringify(
          shippingAddress && typeof shippingAddress === "object"
            ? shippingAddress
            : {}
        ),
        Number(subtotal) || 0,
        Number(discount) || 0,
        Number(total) || 0,
        couponId,
        couponCode || null,
        paymentMethod,
        paymentStatus,
      ]
    );

    return this.findByUuid(result.rows[0].uuid);
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `${BASE_SELECT} WHERE o.uuid = $1`,
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

  async getDetailByUuid(uuid) {
    const order = await this.findByUuid(uuid);

    if (!order) {
      return null;
    }

    const itemsResult = await pool.query(
      `SELECT product_uuid, product_name, sku, variant, price, quantity, subtotal
       FROM order_items WHERE order_id = (SELECT id FROM orders WHERE uuid = $1)
       ORDER BY id ASC`,
      [uuid]
    );

    return {
      ...order,
      items: itemsResult.rows,
    };
  },

  async list({ search = "", status = "", paymentStatus = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(o.order_number ILIKE $${params.length} OR o.customer_name ILIKE $${params.length} OR o.customer_email ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }

    if (paymentStatus) {
      params.push(paymentStatus);
      conditions.push(`o.payment_status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    return paginate(
      {
        baseSql: `${BASE_SELECT} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM orders o ${where}`,
        params,
        orderBy: "ORDER BY o.created_at DESC, o.id DESC",
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

    if (updates.status !== undefined) {
      set("status", updates.status);
    }

    if (updates.paymentStatus !== undefined) {
      set("payment_status", updates.paymentStatus);
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