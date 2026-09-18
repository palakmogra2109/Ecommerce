import pool from "../db";
import { paginate } from "../pagination";

const TABLE = "categories";

const PUBLIC_COLUMNS =
  "uuid, name, slug, description, image, status, sort_order, meta_title, meta_description, created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, name, slug, description, image, parent_id, status, sort_order, meta_title, meta_description, created_at, updated_at";

const SINGLE_SELECT = `
  SELECT c.uuid, c.name, c.slug, c.description, c.image, c.status,
         c.sort_order, c.meta_title, c.meta_description,
         c.created_at, c.updated_at,
         p.uuid AS parent_uuid, p.name AS parent_name,
         (SELECT COUNT(*)::int FROM products pr WHERE pr.category_id = c.id) AS product_count,
         (SELECT COUNT(*)::int FROM categories ch WHERE ch.parent_id = c.id) AS child_count
  FROM categories c
  LEFT JOIN categories p ON p.id = c.parent_id
`;

export const Category = {
  TABLE,

  slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  },

  async create({
    name,
    slug,
    description = "",
    image = null,
    parentUuid = null,
    status = "ACTIVE",
    sortOrder = 0,
    metaTitle = "",
    metaDescription = "",
  }) {
    let parentId = null;

    if (parentUuid) {
      const parent = await pool.query(
        `SELECT id FROM categories WHERE uuid = $1`,
        [parentUuid]
      );
      parentId = parent.rows[0]?.id ?? null;
    }

    const result = await pool.query(
      `
      INSERT INTO ${TABLE} (name, slug, description, image, parent_id, status, sort_order, meta_title, meta_description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        (name ?? "").trim(),
        this.slugify(slug || name),
        description ?? "",
        image ?? null,
        parentId,
        status,
        Number(sortOrder) || 0,
        metaTitle ?? "",
        metaDescription ?? "",
      ]
    );

    return this.findByUuid(result.rows[0].uuid);
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `${SINGLE_SELECT} WHERE c.uuid = $1`,
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

  async findBySlug(slug) {
    const result = await pool.query(
      `${SINGLE_SELECT} WHERE c.slug = $1`,
      [this.slugify(slug)]
    );

    return result.rows[0] || null;
  },

  // Flat list of every category (used by form dropdowns and the tree
  // builder). Ordered by sort_order then name for a stable tree.
  async all({ status = "" } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await pool.query(
      `${SINGLE_SELECT} ${where} ORDER BY c.sort_order ASC, c.name ASC`,
      params
    );

    return result.rows;
  },

  async list({ search = "", status = "", parentUuid = "", type = "", page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(c.name ILIKE $${params.length} OR c.slug ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }

    // type=parent → top-level only; type=sub → child categories only.
    if (type === "parent") {
      conditions.push(`c.parent_id IS NULL`);
    } else if (type === "sub") {
      conditions.push(`c.parent_id IS NOT NULL`);
    }

    if (parentUuid) {
      params.push(parentUuid);
      conditions.push(
        `c.parent_id = (SELECT id FROM categories WHERE uuid = $${params.length})`
      );
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    return paginate(
      {
        baseSql: `${SINGLE_SELECT} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM categories c ${where}`,
        params,
        orderBy: "ORDER BY c.sort_order ASC, c.name ASC",
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

    if (updates.description !== undefined) {
      set("description", updates.description ?? "");
    }

    if (updates.image !== undefined) {
      set("image", updates.image ?? null);
    }

    if (updates.status !== undefined) {
      set("status", updates.status);
    }

    if (updates.sortOrder !== undefined) {
      set("sort_order", Number(updates.sortOrder) || 0);
    }

    if (updates.metaTitle !== undefined) {
      set("meta_title", updates.metaTitle ?? "");
    }

    if (updates.metaDescription !== undefined) {
      set("meta_description", updates.metaDescription ?? "");
    }

    if (updates.parentUuid !== undefined) {
      let parentId = null;

      if (updates.parentUuid) {
        const parent = await pool.query(
          `SELECT id FROM categories WHERE uuid = $1`,
          [updates.parentUuid]
        );
        parentId = parent.rows[0]?.id ?? null;
      }

      // Prevents a category from being its own ancestor.
      if (parentId && (await descendsFrom(parentId, current.id))) {
        parentId = current.parent_id;
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
};

// True when `candidateId` is an ancestor of `selfId`, used to stop
// moving a category underneath one of its own children.
async function descendsFrom(candidateId, selfId) {
  let current = selfId;

  while (current) {
    const result = await pool.query(
      `SELECT parent_id FROM categories WHERE id = $1`,
      [current]
    );

    const parentId = result.rows[0]?.parent_id ?? null;

    if (parentId === candidateId) {
      return true;
    }

    current = parentId;
  }

  return false;
}