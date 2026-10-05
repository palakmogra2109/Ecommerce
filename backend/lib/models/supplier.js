import pool from "../db.js";
import { round2 } from "../giftCardRules.js";

// Suppliers are the counterpart to customers: the people the business buys
// from. Purchase invoices reference them, so a supplier is retired rather than
// deleted, and PurchaseInvoice.create refuses an inactive one outright.
//
// The column list below is the table as migration 021 built it. gstin holds the
// supplier's tax registration, which is usually a GSTIN but may be another
// country's VAT or EIN number; there is deliberately no tax_treatment column,
// because a supplier's GST treatment is a business decision that needs to be
// configured rather than typed in freehand. If credit limits are wanted later,
// they belong in a migration and in the approval rules, not smuggled in here.

const TABLE = "suppliers";
const COLUMNS = `
  id, uuid, name, contact_name, email, phone, address, city, state, postal_code,
  country, gstin, payment_terms_days, is_active, notes, created_by, created_at, updated_at
`;

export class Supplier {
  /**
   * Validates and normalises a supplier payload. Split from the writes so create
   * and update cannot drift apart.
   */
  static normalize(body, { partial = false } = {}) {
    const out = {};
    const has = (key) => body[key] !== undefined && body[key] !== null;

    if (!partial || has("name")) {
      const name = String(body.name ?? "").trim();
      if (!partial && !name) throw new Error("Supplier name is required");
      if (name) out.name = name;
    }
    if (has("contact_name")) out.contact_name = String(body.contact_name).trim() || null;

    if (has("email")) {
      const email = String(body.email).trim().toLowerCase();
      // Reject rather than store: this address goes out on supplier statements.
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("That does not look like an email address");
      }
      out.email = email || null;
    }
    if (has("phone")) out.phone = String(body.phone).trim() || null;
    if (has("address")) out.address = String(body.address).trim() || null;
    if (has("city")) out.city = String(body.city).trim() || null;
    if (has("state")) out.state = String(body.state).trim() || null;
    if (has("postal_code")) out.postal_code = String(body.postal_code).trim() || null;
    if (has("country")) out.country = String(body.country).trim() || "IN";

    if (has("gstin")) {
      // Letters and digits only, stored upper-case and unspaced so a lookup is
      // a single equality test.
      //
      // Deliberately NOT the rigid 15-character GSTIN layout. Suppliers are not
      // all Indian: an overseas or SEZ supplier's registration can be a VAT or
      // EIN number of a different shape, and refusing to record it blocks the
      // purchase invoice that needs it. The column is therefore "supplier tax
      // registration", and GSTIN is simply the common case.
      const taxId = String(body.gstin).trim().toUpperCase().replace(/\s+/g, "");
      if (taxId && !/^[A-Z0-9]{1,32}$/.test(taxId)) {
        throw new Error("A tax registration can only contain letters and numbers");
      }
      out.gstin = taxId || null;
    }

    if (has("payment_terms_days")) {
      const days = parseInt(body.payment_terms_days, 10);
      if (Number.isNaN(days) || days < 0 || days > 365) {
        throw new Error("Payment terms must be between 0 and 365 days");
      }
      out.payment_terms_days = days;
    }
    if (has("notes")) out.notes = String(body.notes).trim() || null;
    if (has("is_active")) out.is_active = Boolean(body.is_active);
    return out;
  }

  static async list({ search = "", status = "", page = 1, limit = 20 } = {}) {
    const where = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length}
                   OR phone ILIKE $${params.length} OR gstin ILIKE $${params.length})`);
    }
    if (status === "active") where.push("is_active = TRUE");
    if (status === "inactive") where.push("is_active = FALSE");

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await pool.query(`SELECT count(*)::int AS total FROM ${TABLE} ${clause}`, params);
    params.push(limit, (page - 1) * limit);
    const rows = await pool.query(
      `SELECT ${COLUMNS} FROM ${TABLE} ${clause}
        ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = count.rows[0].total;
    return {
      rows: rows.rows,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * Accepts a public uuid or an internal numeric id. The API addresses suppliers
   * by uuid, matching every other route in this app; the bigint key is what the
   * purchase invoices actually reference.
   */
  static async resolveId(ref) {
    if (ref === undefined || ref === null || ref === "") return null;
    if (/^\d+$/.test(String(ref))) {
      const hit = await pool.query(`SELECT id FROM ${TABLE} WHERE id = $1`, [Number(ref)]);
      return hit.rows[0]?.id ?? null;
    }
    const hit = await pool.query(`SELECT id FROM ${TABLE} WHERE uuid = $1`, [ref]);
    return hit.rows[0]?.id ?? null;
  }

  static async findById(id) {
    const key = await this.resolveId(id);
    if (!key) return null;
    const result = await pool.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE id = $1`, [key]);
    return result.rows[0] || null;
  }

  static async create(body) {
    const data = this.normalize(body);
    const keys = Object.keys(data);
    const result = await pool.query(
      `INSERT INTO ${TABLE} (${keys.join(", ")})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING ${COLUMNS}`,
      keys.map((k) => data[k])
    );
    return result.rows[0];
  }

  static async update(id, body) {
    const key = await this.resolveId(id);
    if (!key) return null;
    const data = this.normalize(body, { partial: true });
    const keys = Object.keys(data);
    if (!keys.length) return this.findById(key);
    const result = await pool.query(
      `UPDATE ${TABLE} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now()
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [key, ...keys.map((k) => data[k])]
    );
    return result.rows[0] || null;
  }

  /**
   * Retires a supplier rather than deleting them: purchase invoices reference
   * them, and an audit trail that vanishes with a row is no audit trail.
   * Invoices still in flight are the one case that must not be retired.
   */
  static async archive(id) {
    const key = await this.resolveId(id);
    if (!key) return null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const open = await client.query(
        `SELECT count(*)::int AS n FROM purchase_invoices
          WHERE supplier_id = $1 AND status NOT IN ('RECEIVED', 'CANCELLED')`,
        [key]
      );
      if (open.rows[0].n > 0) {
        throw new Error(
          `This supplier has ${open.rows[0].n} invoice(s) still open. Receive or cancel them first.`
        );
      }
      const result = await client.query(
        `UPDATE ${TABLE} SET is_active = FALSE, updated_at = now()
          WHERE id = $1 RETURNING ${COLUMNS}`,
        [key]
      );
      await client.query("COMMIT");
      return result.rows[0] || null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  static async restore(id) {
    const key = await this.resolveId(id);
    if (!key) return null;
    const result = await pool.query(
      `UPDATE ${TABLE} SET is_active = TRUE, updated_at = now()
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [key]
    );
    return result.rows[0] || null;
  }

  /** Outstanding balance: everything invoiced, less everything paid. */
  static async balance(id) {
    const key = await this.resolveId(id);
    if (!key) return { invoiced: 0, paid: 0, outstanding: 0 };
    const result = await pool.query(
      `SELECT COALESCE(SUM(i.total_amount),0) AS invoiced,
              COALESCE((SELECT SUM(p.amount) FROM purchase_invoice_payments p
                          JOIN purchase_invoices i2 ON i2.id = p.purchase_invoice_id
                         WHERE i2.supplier_id = $1),0) AS paid
         FROM purchase_invoices i WHERE i.supplier_id = $1 AND i.status <> 'CANCELLED'`,
      [key]
    );
    const { invoiced, paid } = result.rows[0];
    return {
      invoiced: round2(invoiced),
      paid: round2(paid),
      outstanding: round2(invoiced - paid),
    };
  }
}