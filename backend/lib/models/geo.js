import pool from "../db.js";

// Read-only reference data for country / state / city pickers.
//
// The tables were already seeded (250 countries, ~5.3k states, ~153k cities) and
// are keyed by uuid, so nothing is duplicated here. Cities are the reason this is
// a model and not three inline selects: a single country can hold tens of
// thousands of rows, so every city query is scoped by country or state and
// capped. Nothing in this module ever returns the whole cities table.

const COUNTRY_COLUMNS = "id, uuid, name, iso2, iso3, dialcode, flag, status";
const STATE_COLUMNS = "id, uuid, name, statecode, countryid, status";
const CITY_COLUMNS = "id, uuid, name, countryid, stateid, status";

// Hard ceiling regardless of what the caller asks for, so a crafted limit cannot
// turn this into a full-table dump.
const MAX_CITIES = 500;
const DEFAULT_CITIES = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Geo {
  static isUuid(value) {
    return typeof value === "string" && UUID_RE.test(value);
  }

  /** All countries, alphabetically. Small enough to send whole (250 rows). */
  static async listCountries() {
    const result = await pool.query(
      `SELECT ${COUNTRY_COLUMNS} FROM countries WHERE status = 'ACTIVE' ORDER BY name ASC`
    );
    return result.rows;
  }

  /**
   * States for one country. Falls back to every state when no country is given,
   * which is only sane for a filtered picker, so the route requires a country in
   * practice; this default keeps the function usable for a search box.
   */
  static async listStates({ countryUuid = null, search = "", limit = 600 } = {}) {
    const params = [];
    let clause = "WHERE status = 'ACTIVE'";
    if (this.isUuid(countryUuid)) {
      params.push(countryUuid);
      clause += ` AND countryid = $${params.length}`;
    }
    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      clause += ` AND name ILIKE $${params.length}`;
    }
    params.push(Math.min(limit, MAX_CITIES));
    const result = await pool.query(
      `SELECT ${STATE_COLUMNS} FROM states ${clause} ORDER BY name ASC LIMIT $${params.length}`,
      params
    );
    return result.rows;
  }

  /**
   * Cities, always scoped. A search term is required to search across a whole
   * country, and a state is preferred, so the query stays indexed.
   */
  static async listCities({ stateUuid = null, countryUuid = null, search = "", limit = DEFAULT_CITIES, overfetch = false } = {}) {
    const params = [];
    const where = ["status = 'ACTIVE'"];

    if (this.isUuid(stateUuid)) {
      params.push(stateUuid);
      where.push(`stateid = $${params.length}`);
    } else if (this.isUuid(countryUuid)) {
      params.push(countryUuid);
      where.push(`countryid = $${params.length}`);
    } else if (!search.trim()) {
      // An unscoped, unfiltered city list would be 150k rows. Refuse rather than
      // silently truncate the world.
      return [];
    }

    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(`name ILIKE $${params.length}`);
    }
    const effective = Math.min(Math.max(1, limit), MAX_CITIES);
    // `overfetch` asks for one row beyond the page so the caller can tell a full
    // page from an exhausted list, instead of guessing from the row count.
    params.push(overfetch ? effective + 1 : effective);

    const result = await pool.query(
      `SELECT ${CITY_COLUMNS} FROM cities WHERE ${where.join(" AND ")}
        ORDER BY name ASC LIMIT $${params.length}`,
      params
    );
    if (!overfetch) return result.rows;

    const rows = result.rows;
    return { rows: rows.slice(0, effective), truncated: rows.length > effective };
  }

  /**
   * Resolves a stored country value to a row. Accepts a uuid, an ISO2/ISO3 code,
   * or a name, because `suppliers.country` predates this picker and already
   * holds values like 'IN'.
   */
  static async findCountry(value) {
    if (!value) return null;
    const term = String(value).trim();
    if (!term) return null;
    // Case-insensitive: `suppliers.country` is free text written by people, and
    // 'in' should resolve the same as the stored 'IN'.
    const result = await pool.query(
      `SELECT ${COUNTRY_COLUMNS} FROM countries
        WHERE status = 'ACTIVE'
          AND (upper(name) = upper($1) OR upper(iso2) = upper($1)
               OR upper(iso3) = upper($1) OR uuid::text = lower($1))
        LIMIT 1`,
      [term]
    );
    if (result.rows[0]) return result.rows[0];

    const loose = await pool.query(
      `SELECT ${COUNTRY_COLUMNS} FROM countries
        WHERE status = 'ACTIVE' AND name ILIKE $1 ORDER BY name ASC LIMIT 1`,
      [term]
    );
    return loose.rows[0] || null;
  }
}
