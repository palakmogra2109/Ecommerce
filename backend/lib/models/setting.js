import pool from "../db";
import { DEFAULT_THEME_COLOR } from "@shared/constants";

const TABLE = "settings";
const ID = 1;

// Single global settings row. If the row is missing (e.g. schema not
// applied yet) it is created on first read with the defaults.
export const Setting = {
  async get() {
    let result = await pool.query(
      `
      SELECT id, theme_color, dark_mode, updated_at
      FROM ${TABLE}
      WHERE id = $1
      `,
      [ID]
    );

    let row = result.rows[0] || null;

    if (!row) {
      result = await pool.query(
        `
        INSERT INTO ${TABLE} (id, theme_color, dark_mode)
        VALUES ($1, $2, $3)
        RETURNING id, theme_color, dark_mode, updated_at
        `,
        [ID, DEFAULT_THEME_COLOR, false]
      );

      row = result.rows[0] || null;
    }

    return row;
  },

  async update({ theme_color, dark_mode } = {}) {
    const current = (await this.get()) || {};

    const nextColor =
      theme_color && /^#[0-9a-fA-F]{6}$/.test(theme_color)
        ? theme_color
        : current.theme_color || DEFAULT_THEME_COLOR;
    const nextDark =
      typeof dark_mode === "boolean" ? dark_mode : Boolean(current.dark_mode);

    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (id, theme_color, dark_mode, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (id) DO UPDATE
      SET theme_color = EXCLUDED.theme_color,
          dark_mode = EXCLUDED.dark_mode,
          updated_at = now()
      RETURNING id, theme_color, dark_mode, updated_at
      `,
      [ID, nextColor, nextDark]
    );

    return result.rows[0] || null;
  },
};