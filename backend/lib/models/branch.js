import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "branches";

const PUBLIC_COLUMNS =
  "id, uuid, name, code, phone, email, address, addressLine1, addressLine2, " +
  "city, state, country, postalCode, latitude, longitude, openingTime, closingTime, " +
  "timezone, status, deliveryEnabled, pickupEnabled, deliveryRadius, " +
  "createdAt, updatedAt";

const INTERNAL_COLUMNS =
  "id, uuid, name, code, phone, email, address, addressLine1, addressLine2, " +
  "city, state, country, postalCode, latitude, longitude, openingTime, closingTime, " +
  "timezone, status, deliveryEnabled, pickupEnabled, deliveryRadius, " +
  "createdAt, updatedAt";

export const Branch = {
  TABLE,

  async create(data = {}) {
    const {
      name,
      code,
      phone,
      email,
      address,
      addressLine1,
      addressLine2,
      city,
      state,
      country,
      postalCode,
      latitude,
      longitude,
      openingTime,
      closingTime,
      timezone,
      status = "ACTIVE",
      deliveryEnabled = true,
      pickupEnabled = true,
      deliveryRadius,
    } = data;

    const result = await pool.query(
      `
      INSERT INTO ${TABLE}
        (name, code, phone, email, address, addressLine1, addressLine2,
         city, state, country, postalCode, latitude, longitude,
         openingTime, closingTime, timezone, status, deliveryEnabled,
         pickupEnabled, deliveryRadius)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        (name ?? "").trim(),
        (code ?? "").trim().toUpperCase(),
        phone ?? null,
        email ?? null,
        address ?? null,
        addressLine1 ?? null,
        addressLine2 ?? null,
        city ?? null,
        state ?? null,
        country ?? "India",
        postalCode ?? null,
        latitude != null ? Number(latitude) : null,
        longitude != null ? Number(longitude) : null,
        openingTime != null ? String(openingTime) : null,
        closingTime != null ? String(closingTime) : null,
        timezone || "Asia/Kolkata",
        status,
        deliveryEnabled,
        pickupEnabled,
        deliveryRadius != null ? Number(deliveryRadius) : null,
      ]
    );

    return result.rows[0];
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} WHERE uuid = $1`,
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

  async findByCode(code) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} WHERE code = $1`,
      [(code ?? "").trim().toUpperCase()]
    );
    return result.rows[0] || null;
  },

  async list({ search = "", status = "", city = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(name ILIKE $${params.length} OR code ILIKE $${params.length} OR city ILIKE $${params.length} OR postalCode ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (city) {
      params.push(`%${city.trim()}%`);
      conditions.push(`city ILIKE $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return paginate(
      {
        baseSql: `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM ${TABLE} ${where}`,
        params,
        orderBy: "ORDER BY name ASC",
      },
      { page, limit, offset: (page - 1) * limit }
    );
  },

  async update(uuid, updates = {}) {
    const current = await this.getInternalByUuid(uuid);
    if (!current) return null;

    const fields = [];
    const values = [];
    const set = (col, val) => {
      fields.push(`${col} = $${values.length + 1}`);
      values.push(val);
    };

    if (updates.name !== undefined) set("name", (updates.name ?? "").trim());
    if (updates.code !== undefined) set("code", (updates.code ?? "").trim().toUpperCase());
    if (updates.phone !== undefined) set("phone", updates.phone ?? null);
    if (updates.email !== undefined) set("email", updates.email ?? null);
    if (updates.address !== undefined) set("address", updates.address ?? null);
    if (updates.addressLine1 !== undefined) set("addressLine1", updates.addressLine1 ?? null);
    if (updates.addressLine2 !== undefined) set("addressLine2", updates.addressLine2 ?? null);
    if (updates.city !== undefined) set("city", updates.city ?? null);
    if (updates.state !== undefined) set("state", updates.state ?? null);
    if (updates.country !== undefined) set("country", updates.country ?? null);
    if (updates.postalCode !== undefined) set("postalCode", updates.postalCode ?? null);
    if (updates.latitude !== undefined) set("latitude", updates.latitude != null ? Number(updates.latitude) : null);
    if (updates.longitude !== undefined) set("longitude", updates.longitude != null ? Number(updates.longitude) : null);
    if (updates.openingTime !== undefined) set("openingTime", updates.openingTime != null ? String(updates.openingTime) : null);
    if (updates.closingTime !== undefined) set("closingTime", updates.closingTime != null ? String(updates.closingTime) : null);
    if (updates.timezone !== undefined) set("timezone", updates.timezone || "Asia/Kolkata");
    if (updates.status !== undefined) set("status", updates.status);
    if (updates.deliveryEnabled !== undefined) set("deliveryEnabled", updates.deliveryEnabled);
    if (updates.pickupEnabled !== undefined) set("pickupEnabled", updates.pickupEnabled);
    if (updates.deliveryRadius !== undefined) set("deliveryRadius", updates.deliveryRadius != null ? Number(updates.deliveryRadius) : null);

    values.push(uuid);

    const result = await pool.query(
      `UPDATE ${TABLE} SET ${fields.join(", ")}, updated_at = now() WHERE uuid = $${values.length} RETURNING ${PUBLIC_COLUMNS}`,
      values
    );
    return result.rows[0] || null;
  },

  async remove(uuid) {
    const result = await pool.query(
      `DELETE FROM ${TABLE} WHERE uuid = $1 RETURNING uuid`,
      [uuid]
    );
    return result.rows[0] || null;
  },

  async getWithStats(uuid) {
    const branch = await this.findByUuid(uuid);
    if (!branch) return null;

    const productCountResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM branch_products WHERE branchId = (SELECT id FROM branches WHERE uuid = $1)`,
      [uuid]
    );

    const lowStockResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM branch_products WHERE branchId = (SELECT id FROM branches WHERE uuid = $1) AND stockQuantity <= lowStockThreshold AND isAvailable = TRUE`,
      [uuid]
    );

    const outOfStockResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM branch_products WHERE branchId = (SELECT id FROM branches WHERE uuid = $1) AND stockQuantity <= 0 AND isAvailable = TRUE`,
      [uuid]
    );

    const totalOrdersResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM orders WHERE branchId = (SELECT id FROM branches WHERE uuid = $1)`,
      [uuid]
    );

    return {
      ...branch,
      productCount: parseInt(productCountResult.rows[0].count, 10),
      lowStockCount: parseInt(lowStockResult.rows[0].count, 10),
      outOfStockCount: parseInt(outOfStockResult.rows[0].count, 10),
      totalOrders: parseInt(totalOrdersResult.rows[0].count, 10),
    };
  },

  async getById(id) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },
};
