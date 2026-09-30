import pool from "../db";
import { paginate } from "../pagination";
import { normalizeAddressBook } from "../addressBook";

const TABLE = "customers";

const PUBLIC_COLUMNS =
  "uuid, name, email, mobile, address, status, created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, name, email, mobile, address, status, created_at, updated_at";

export const Customer = {
  TABLE,

  async create({ name, email, mobile = null, address = {}, status = "ACTIVE" }) {
    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, email, mobile, address, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        (name ?? "").trim(),
        email.toLowerCase().trim(),
        mobile ?? null,
        JSON.stringify(address && typeof address === "object" ? address : {}),
        status,
      ]
    );

    return result.rows[0] || null;
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

  async findByEmail(email) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    return result.rows[0] || null;
  },

  async getAddressBookByEmail(email) {
    const normalizedEmail = (email ?? "").toLowerCase().trim();
    if (!normalizedEmail) return [];
    const result = await pool.query(
      `SELECT addresses FROM ${TABLE} WHERE email = $1`,
      [normalizedEmail]
    );
    return normalizeAddressBook(result.rows[0]?.addresses);
  },

  async mutateAddressBookByEmail(email, mutate, identity = {}) {
    const normalizedEmail = (email ?? "").toLowerCase().trim();
    if (!normalizedEmail) throw new Error("A customer email is required");
    if (typeof mutate !== "function") throw new Error("An address-book mutation is required");
    const name = (identity.name ?? "").trim() || normalizedEmail;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let row = (
        await client.query(
          `SELECT id, mobile, addresses FROM ${TABLE} WHERE email = $1 FOR UPDATE`,
          [normalizedEmail]
        )
      ).rows[0];
      if (!row) {
        try {
          row = (
            await client.query(
              `INSERT INTO ${TABLE} (name, email, mobile, address, addresses, status)
               VALUES ($1, $2, NULL, '{}', '[]', 'ACTIVE')
               RETURNING id, mobile, addresses`,
              [name, normalizedEmail]
            )
          ).rows[0];
        } catch (error) {
          if (error?.code !== "23505") throw error;
          row = (
            await client.query(
              `SELECT id, mobile, addresses FROM ${TABLE} WHERE email = $1 FOR UPDATE`,
              [normalizedEmail]
            )
          ).rows[0];
        }
      }
      const mutation = await mutate(normalizeAddressBook(row?.addresses), { mobile: row?.mobile ?? null });
      if (!mutation || mutation.error || !Array.isArray(mutation.addresses)) {
        await client.query("ROLLBACK");
        return mutation && mutation.error ? mutation : { error: "Could not save this address." };
      }
      const saved = (
        await client.query(
          `UPDATE ${TABLE}
           SET addresses = $1::jsonb, updated_at = now()
           WHERE id = $2
           RETURNING addresses`,
          [JSON.stringify(normalizeAddressBook(mutation.addresses)), row.id]
        )
      ).rows[0];
      await client.query("COMMIT");
      return { ...mutation, addresses: normalizeAddressBook(saved?.addresses) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async list({ search = "", status = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(name ILIKE $${params.length} OR email ILIKE $${params.length} OR COALESCE(mobile, '') ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    return paginate(
      {
        baseSql: `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM ${TABLE} ${where}`,
        params,
        orderBy: "ORDER BY created_at DESC, id DESC",
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

    if (updates.name !== undefined) {
      set("name", (updates.name ?? "").trim());
    }

    if (updates.email !== undefined) {
      set("email", (updates.email ?? "").toLowerCase().trim());
    }

    if (updates.mobile !== undefined) {
      set("mobile", updates.mobile ?? null);
    }

    if (updates.address !== undefined) {
      set(
        "address",
        JSON.stringify(
          updates.address && typeof updates.address === "object"
            ? updates.address
            : {}
        )
      );
    }

    if (updates.status !== undefined) {
      set("status", updates.status);
    }

    values.push(uuid);

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET ${fields.join(", ")}, updated_at = now()
      WHERE uuid = $${values.length}
      RETURNING ${PUBLIC_COLUMNS}
      `,
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
};