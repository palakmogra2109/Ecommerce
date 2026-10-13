import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "attributes";

// parent_id is exposed as parent_uuid/parent_name rather than the numeric id,
// matching categories: the wire carries the uuid and the model resolves it.
// The numeric id is exposed too, because the Attribute Values screens show it
// so the parent link is visible rather than implied.
//
// parent_id IS NULL      -> a top-level attribute ("Colour")
// parent_id IS NOT NULL  -> a value of that attribute ("Black")
const PUBLIC_COLUMNS = `
  a.uuid, a.name, a.slug, a.status, a.parent_id, a.child_count,
  a.created_at, a.updated_at,
  p.uuid AS parent_uuid, p.name AS parent_name`;

const INTERNAL_COLUMNS = `
  a.id, a.uuid, a.name, a.slug, a.status, a.parent_id, a.created_at, a.updated_at,
  p.uuid AS parent_uuid`;

// One LEFT JOIN serves every read, so "which attribute does this belong to" is
// never a second query.
const SINGLE_SELECT = `
  SELECT ${PUBLIC_COLUMNS}
  FROM attributes a
  LEFT JOIN attributes p ON p.id = a.parent_id
`;

export const AttributeType = {
  TABLE,

  slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  },

  async create({ name, slug, status = "ACTIVE", parentUuid = null }) {
    let parentId = null;

    if (parentUuid) {
      const parent = await pool.query(
        "SELECT id FROM attributes WHERE uuid = $1",
        [parentUuid]
      );
      parentId = parent.rows[0]?.id ?? null;
    }

    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, slug, status, parent_id)
      VALUES ($1, $2, $3, $4)
      RETURNING uuid
      `,
      [(name ?? "").trim(), this.slugify(slug || name), status, parentId]
    );

    return this.findByUuid(result.rows[0].uuid);
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `${SINGLE_SELECT} WHERE a.uuid = $1`,
      [uuid]
    );

    return result.rows[0] || null;
  },

  async getInternalByUuid(uuid) {
    const result = await pool.query(
      `SELECT ${INTERNAL_COLUMNS} FROM attributes a
       LEFT JOIN attributes p ON p.id = a.parent_id
       WHERE a.uuid = $1`,
      [uuid]
    );

    return result.rows[0] || null;
  },

  async findBySlug(slug) {
    const result = await pool.query(
      `${SINGLE_SELECT} WHERE a.slug = $1 AND a.parent_id IS NULL`,
      [this.slugify(slug)]
    );

    return result.rows[0] || null;
  },

  // Uniqueness is per parent: "Black" is legal under both Colour and Size, but
  // not twice under Colour. At the top level there is no parent, so the slug
  // must be unique among the top-level rows.
  async findByParentAndSlug(parentUuid, slug) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM attributes a
       LEFT JOIN attributes p ON p.id = a.parent_id
       WHERE a.parent_id = (SELECT id FROM attributes WHERE uuid = $1)
         AND a.slug = $2`,
      [parentUuid, this.slugify(slug)]
    );

    return result.rows[0] || null;
  },

  async all({ status = "", type = "", parentUuid = "" } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }

    if (type === "parent") {
      conditions.push(`a.parent_id IS NULL`);
    } else if (type === "value") {
      conditions.push(`a.parent_id IS NOT NULL`);
    }

    if (parentUuid) {
      params.push(parentUuid);
      conditions.push(
        `a.parent_id = (SELECT id FROM attributes WHERE uuid = $${params.length})`
      );
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `${SINGLE_SELECT} ${where} ORDER BY a.name ASC`,
      params
    );

    return result.rows;
  },

  async list({
    search = "",
    status = "",
    // type=parent -> top-level attributes only; type=value -> values only.
    // Omitting it returns everything, which is what a lookup wants.
    type = "",
    parentUuid = "",
    page = 1,
    limit = 20,
  } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(a.name ILIKE $${params.length} OR a.slug ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }

    if (type === "parent") {
      conditions.push(`a.parent_id IS NULL`);
    } else if (type === "value") {
      conditions.push(`a.parent_id IS NOT NULL`);
    }

    if (parentUuid) {
      params.push(parentUuid);
      conditions.push(
        `a.parent_id = (SELECT id FROM attributes WHERE uuid = $${params.length})`
      );
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return paginate(
      {
        baseSql: `${SINGLE_SELECT} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM attributes a ${where}`,
        params,
        orderBy: "ORDER BY p.name ASC, a.name ASC",
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

    if (updates.slug !== undefined) {
      set("slug", this.slugify(updates.slug || current.name));
    }

    if (updates.status !== undefined) {
      set("status", updates.status);
    }

    // null means "make this a top-level attribute again", which is how a value
    // is promoted back out of its parent.
    if (updates.parentUuid !== undefined) {
      let parentId = null;

      if (updates.parentUuid) {
        const parent = await pool.query(
          "SELECT id FROM attributes WHERE uuid = $1",
          [updates.parentUuid]
        );
        parentId = parent.rows[0]?.id ?? null;
      }

      set("parent_id", parentId);
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

  async bulkStatus(uuids = [], status = "ACTIVE") {
    if (!Array.isArray(uuids) || uuids.length === 0) {
      return 0;
    }

    const result = await pool.query(
      `
      UPDATE ${TABLE}
      SET status = $1, updated_at = now()
      WHERE uuid = ANY($2::uuid[])
      `,
      [status, uuids]
    );

    return result.rowCount;
  },
};