// Explicit .js extensions: Next resolves extensionless specifiers through its
// own bundler, but plain Node ESM does not, so this module could not be loaded
// from scripts/ or lib/__tests__/ without them.
import pool from "../db.js";
import { paginate } from "../pagination.js";

const TABLE = "orders";

const PUBLIC_COLUMNS =
  "uuid, order_number, customer_name, customer_email, customer_mobile," +
  " shipping_address, subtotal, discount, total, coupon_code, payment_method," +
  " payment_status, status, branchid, branch_uuid, created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, order_number, customer_id, customer_name, customer_email," +
  " customer_mobile, shipping_address, subtotal, discount, total, coupon_id," +
  " coupon_code, payment_method, payment_status, status, branchid," +
  " created_at, updated_at";

const BASE_SELECT = `
  SELECT o.uuid, o.order_number, o.customer_name, o.customer_email,
         o.customer_mobile, o.shipping_address, o.subtotal, o.discount,
         o.total, o.coupon_code, o.payment_method, o.payment_status, o.status,
         o.gift_card_id, o.gift_amount,
         o.branchid, o.created_at, o.updated_at,
         c.uuid AS customer_uuid,
         b.uuid AS branch_uuid, b.name AS branch_name, b.code AS branch_code
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  LEFT JOIN branches b ON b.id = o.branchid
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

  async create(data = {}, client = null) {
    const {
      // Optional. The database mints one by default, and every existing caller
      // still gets that; the checkout passes its own so that the wallet debit
      // taken a moment earlier can already name the order it paid for. Minting
      // it at the call site is the only way that works without inserting the order
      // twice or writing the uuid after the fact.
      uuid = null,
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
      giftCardId = null,
      giftAmount = 0,
      paymentMethod = "cod",
      paymentStatus = "PENDING",
      branchId = null,
      estimatedDeliveryAt = null,
    } = data;

    const orderNumber = await this.nextOrderNumber();

    const result = await (client || pool).query(
      `
      INSERT INTO ${TABLE}
        (order_number, customer_id, customer_name, customer_email,
         customer_mobile, shipping_address, subtotal, discount, total,
         coupon_id, coupon_code, gift_card_id, gift_amount,
         payment_method, payment_status, branchid,
         estimated_delivery_at, uuid)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
              COALESCE($18::uuid, gen_random_uuid()))
      RETURNING uuid, order_number
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
        giftCardId,
        Number(giftAmount) || 0,
        paymentMethod,
        paymentStatus,
        branchId,
        estimatedDeliveryAt,
        uuid || null,
      ]
    );

    // Return the inserted identifiers directly. Re-reading through
    // findByUuid uses the shared pool, which cannot see this row until the
    // caller's transaction commits — so it always came back null here and
    // every checkout crashed on order.uuid.
    return result.rows[0];
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

  async list({ search = "", status = "", paymentStatus = "", branchId = "", page = 1, limit = 20 } = {}) {
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

    if (branchId) {
      params.push(branchId);
      conditions.push(
        `o.branchid = (SELECT id FROM branches WHERE uuid = $${params.length})`
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return paginate(
      {
        baseSql: `${BASE_SELECT} ${where}`,
        countSql: `SELECT COUNT(*)::int FROM orders o ${where}`,
        params,
        orderBy: "ORDER BY o.created_at DESC, o.id DESC",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  // Appends a row to order_status_history. Safe to call inside or outside
  // a transaction (pass an open client as `client` when in one).
  async recordStatus(orderInternalId, status, note = "", changedBy = "system", client = null) {
    await (client || pool).query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [orderInternalId, status, note, changedBy]
    );
  },

  // Returns the full status timeline (oldest first) for an order.
  async statusHistory(orderInternalId) {
    const result = await pool.query(
      `SELECT status, note, changed_by AS "changedBy", created_at AS "createdAt"
       FROM order_status_history
       WHERE order_id = $1
       ORDER BY created_at ASC, id ASC`,
      [orderInternalId]
    );

    return result.rows;
  },

  async update(uuid, updates = {}) {
    const current = await this.getInternalByUuid(uuid);

    if (!current) {
      return null;
    }

    const statusChanged =
      updates.status !== undefined && updates.status !== current.status;

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

    if (updates.branchId !== undefined) {
      set("branchid", updates.branchId);
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

    // Audit trail: persist every status transition with a timestamp.
    if (statusChanged) {
      await this.recordStatus(current.id, updates.status);
    }

    return this.findByUuid(uuid);
  },

  // Updates an order addressed by its human order_number, scoped to one branch.
  // branchid is a bigint, so the caller has to pass the numeric branch id; the
  // `AND branchid = $3` is what stops a branch panel from moving an order that
  // belongs to somebody else. Returns the same public row shape as update(), or
  // null when the order is not in that branch.
  async updateByNumber(orderNumber, { status, branchId } = {}) {
    if (!orderNumber || branchId == null) {
      return null;
    }

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET status = $1, updated_at = now()
      WHERE order_number = $2 AND branchid = $3
      RETURNING id, uuid, order_number, status, branchid
      `,
      [status, orderNumber, branchId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Audit trail: same contract as update() above.
    await this.recordStatus(row.id, status, "", "system");

    return this.findByUuid(row.uuid);
  },

  async remove(uuid) {
    const result = await pool.query(
      `DELETE FROM ${TABLE} WHERE uuid = $1 RETURNING uuid`,
      [uuid]
    );

    return result.rows[0] || null;
  },
};