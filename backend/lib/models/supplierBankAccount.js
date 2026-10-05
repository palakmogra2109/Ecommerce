import pool from "../db.js";

// Supplier bank accounts.
//
// account_number is treated as a secret: it is masked before it leaves this
// module, so a listing or a log line can never leak it. `fullAccountNumber` is
// the only way to see it in full, and only a single named account, because that
// is what a payment run needs and nothing else does.

const TABLE = "supplier_bank_accounts";
const COLUMNS = `
  id, uuid, supplier_id, account_name, bank_name, account_number, ifsc,
  swift_code, branch, account_type, is_primary, is_active, notes,
  created_by, created_at, updated_at
`;

/** Keeps only the last four characters: `1234567890` becomes `••••7890`. */
export function maskAccountNumber(value) {
  const digits = String(value || "");
  if (!digits) return "";
  const tail = digits.slice(-4);
  return `${"•".repeat(Math.max(0, digits.length - 4))}${tail}`;
}

export class SupplierBankAccount {
  /** Validates and normalises a payload. Returns values, never masked. */
  static normalize(body, { partial = false } = {}) {
    const out = {};
    const has = (key) => body[key] !== undefined && body[key] !== null;

    if (!partial || has("account_name")) {
      const accountName = String(body.account_name ?? "").trim();
      if (!partial && !accountName) throw new Error("Whose account is it? Enter a name");
      if (accountName) out.account_name = accountName;
    }
    if (!partial || has("bank_name")) {
      const bankName = String(body.bank_name ?? "").trim();
      if (!partial && !bankName) throw new Error("Enter the bank name");
      if (bankName) out.bank_name = bankName;
    }
    if (!partial || has("account_number")) {
      // Digits only. Spaces and dashes are stripped first, because people copy
      // account numbers in that form and a rejected paste is never the answer.
      const accountNumber = String(body.account_number ?? "").replace(/[\s-]/g, "");
      if (!partial && !accountNumber) throw new Error("Enter the account number");
      if (accountNumber && !/^[0-9]{6,20}$/.test(accountNumber)) {
        throw new Error("An account number is 6 to 20 digits");
      }
      if (accountNumber) out.account_number = accountNumber;
    }
    if (has("ifsc")) {
      const ifsc = String(body.ifsc).trim().toUpperCase().replace(/\s+/g, "");
      if (ifsc && !/^[A-Z0-9]{1,11}$/.test(ifsc)) {
        throw new Error("An IFSC or bank code is letters and numbers, up to 11 characters");
      }
      out.ifsc = ifsc || null;
    }
    if (has("swift_code")) {
      const swift = String(body.swift_code).trim().toUpperCase().replace(/\s+/g, "");
      if (swift && !/^[A-Z0-9]{8,11}$/.test(swift)) {
        throw new Error("A SWIFT/BIC code is 8 to 11 letters or digits");
      }
      out.swift_code = swift || null;
    }
    if (has("branch")) out.branch = String(body.branch).trim() || null;
    if (has("account_type")) {
      const type = String(body.account_type).trim().toUpperCase();
      if (type && !["SAVINGS", "CURRENT"].includes(type)) {
        throw new Error("Account type must be SAVINGS or CURRENT");
      }
      out.account_type = type || "CURRENT";
    }
    if (has("notes")) out.notes = String(body.notes).trim() || null;
    return out;
  }

  /** A row with the account number masked, which is what listings return. */
  static mask(row) {
    if (!row) return row;
    const { account_number, ...rest } = row;
    return { ...rest, account_number_masked: maskAccountNumber(account_number) };
  }

  static async list(supplierId) {
    const rows = await pool.query(
      `SELECT ${COLUMNS} FROM ${TABLE}
        WHERE supplier_id = $1
        ORDER BY is_primary DESC, created_at DESC`,
      [supplierId]
    );
    return rows.rows.map((row) => this.mask(row));
  }

  /**
   * The one place the full account number is returned. Deliberately takes a
   * single account rather than adding an `unmask` flag to list(), so a bulk read
   * cannot leak a whole supplier set by accident.
   */
  static async fullAccountNumber(uuid) {
    const rows = await pool.query(
      `SELECT account_number FROM ${TABLE} WHERE uuid = $1`, [uuid]
    );
    return rows.rows[0]?.account_number || null;
  }

  static async findByUuid(uuid) {
    const rows = await pool.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE uuid = $1`, [uuid]);
    return rows.rows[0] ? this.mask(rows.rows[0]) : null;
  }

  static async create(supplierId, body, createdBy = null) {
    const data = this.normalize(body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // The first account for a supplier is primary by default: someone adding
      // their only bank details means that is the one to pay. Decided before the
      // column list is built, or the flag never reaches the INSERT.
      const existing = await client.query(
        `SELECT count(*)::int AS n FROM ${TABLE} WHERE supplier_id = $1`, [supplierId]
      );
      if (existing.rows[0].n === 0) data.is_primary = true;
      const keys = Object.keys(data);

      const result = await client.query(
        `INSERT INTO ${TABLE} (supplier_id, created_by, ${keys.join(", ")})
         VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(", ")})
         RETURNING ${COLUMNS}`,
        [supplierId, createdBy, ...keys.map((k) => data[k])]
      );
      await client.query("COMMIT");
      return this.mask(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  static async update(uuid, body) {
    const data = this.normalize(body, { partial: true });
    const keys = Object.keys(data);
    if (!keys.length) return this.findByUuid(uuid);
    const result = await pool.query(
      `UPDATE ${TABLE} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now()
        WHERE uuid = $1 RETURNING ${COLUMNS}`,
      [uuid, ...keys.map((k) => data[k])]
    );
    return result.rows[0] ? this.mask(result.rows[0]) : null;
  }

  /**
   * Demotes whatever is currently primary, then promotes this one. Both halves
   * are in one transaction because the partial unique index forbids two
   * primaries at once, so doing them separately always collides.
   */
  static async setPrimary(uuid) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `SELECT id, supplier_id FROM ${TABLE} WHERE uuid = $1 FOR UPDATE`, [uuid]
      );
      if (!target.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE ${TABLE} SET is_primary = FALSE, updated_at = now()
          WHERE supplier_id = $1 AND is_primary`,
        [target.rows[0].supplier_id]
      );
      const promoted = await client.query(
        `UPDATE ${TABLE} SET is_primary = TRUE, updated_at = now()
          WHERE id = $1 RETURNING ${COLUMNS}`,
        [target.rows[0].id]
      );
      await client.query("COMMIT");
      return this.mask(promoted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retires rather than deletes, like suppliers themselves. The one case that
   * must not be left open: retiring the sole primary of a supplier that has no
   * other active account would leave them with nothing to pay.
   */
  static async archive(uuid) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query(
        `SELECT id, supplier_id, is_primary FROM ${TABLE} WHERE uuid = $1 FOR UPDATE`, [uuid]
      );
      const account = row.rows[0];
      if (!account) {
        await client.query("ROLLBACK");
        return null;
      }
      if (account.is_primary) {
        const others = await client.query(
          `SELECT count(*)::int AS n FROM ${TABLE}
            WHERE supplier_id = $1 AND id <> $2 AND is_active`,
          [account.supplier_id, account.id]
        );
        if (others.rows[0].n === 0) {
          await client.query("ROLLBACK");
          throw new Error(
            "This is the only active account. Add another and make it primary first."
          );
        }
      }
      const result = await client.query(
        `UPDATE ${TABLE} SET is_active = FALSE, is_primary = FALSE, updated_at = now()
          WHERE id = $1 RETURNING ${COLUMNS}`,
        [account.id]
      );
      await client.query("COMMIT");
      return this.mask(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}