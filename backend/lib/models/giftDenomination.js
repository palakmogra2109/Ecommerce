import pool from "../db";
import { round2 } from "../giftCardRules";

const TABLE = "gift_denominations";

function row(r) {
  if (!r) return r;
  const faceValue = Number(r.face_value) || 0;
  // A null selling price means "no promotion": the buyer pays face value.
  const sellingPrice = r.selling_price == null ? faceValue : Number(r.selling_price);
  const discount = round2(faceValue - sellingPrice);
  return {
    uuid: r.uuid,
    label: r.label,
    face_value: faceValue,
    selling_price: sellingPrice,
    discounted: discount > 0,
    // Whole percent, so the badge never shows 0% OFF on a real discount.
    discount_percent: discount > 0 ? Math.round((discount / faceValue) * 100) : 0,
    valid_for_days: r.valid_for_days,
    is_active: r.is_active,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const GiftDenomination = {
  TABLE,

  async list({ activeOnly = false } = {}) {
    const result = await pool.query(
      `SELECT * FROM ${TABLE}
       ${activeOnly ? "WHERE is_active" : ""}
       ORDER BY sort_order ASC, face_value ASC`
    );
    return result.rows.map(row);
  },

  async findByUuid(uuid) {
    const result = await pool.query(`SELECT * FROM ${TABLE} WHERE uuid = $1`, [uuid]);
    return row(result.rows[0] || null);
  },

  async create({
    label,
    faceValue,
    sellingPrice = null,
    validForDays = null,
    isActive = true,
    sortOrder = 0,
  } = {}) {
    const face = Number(faceValue) || 0;
    if (!(face > 0)) throw new Error("Face value must be greater than zero");

    // Stored as NULL rather than equal to face value, so "no discount" stays
    // distinguishable from "a discount that happens to be zero".
    const price =
      sellingPrice == null || sellingPrice === "" || Number(sellingPrice) >= face
        ? null
        : Number(sellingPrice);

    const result = await pool.query(
      `INSERT INTO ${TABLE} (label, face_value, selling_price, valid_for_days, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        String(label || "Gift Card").trim().slice(0, 80),
        face,
        price,
        validForDays == null || validForDays === "" ? null : Number(validForDays),
        Boolean(isActive),
        Number(sortOrder) || 0,
      ]
    );
    return row(result.rows[0]);
  },

  async update(uuid, updates = {}) {
    const fields = [];
    const values = [];
    const set = (column, value) => {
      fields.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };

    if (updates.label !== undefined) set("label", String(updates.label).trim().slice(0, 80));
    if (updates.faceValue !== undefined) {
      const face = Number(updates.faceValue) || 0;
      if (!(face > 0)) throw new Error("Face value must be greater than zero");
      set("face_value", face);
    }
    if (updates.sellingPrice !== undefined) {
      // A price at or above face value means "no promotion".
      set("selling_price", updates.sellingPrice == null || updates.sellingPrice === "" ? null : Number(updates.sellingPrice));
    }
    if (updates.validForDays !== undefined) {
      set("valid_for_days", updates.validForDays == null || updates.validForDays === "" ? null : Number(updates.validForDays));
    }
    if (updates.isActive !== undefined) set("is_active", Boolean(updates.isActive));
    if (updates.sortOrder !== undefined) set("sort_order", Number(updates.sortOrder) || 0);

    if (fields.length === 0) return this.findByUuid(uuid);

    values.push(uuid);
    const result = await pool.query(
      `UPDATE ${TABLE} SET ${fields.join(", ")}, updated_at = now()
       WHERE uuid = $${values.length}
       RETURNING *`,
      values
    );
    return row(result.rows[0] || null);
  },

  async remove(uuid) {
    const result = await pool.query(`DELETE FROM ${TABLE} WHERE uuid = $1 RETURNING uuid`, [uuid]);
    return result.rows[0] || null;
  },
};
