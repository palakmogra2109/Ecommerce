import pool from "../db.js";
import { paginate } from "../pagination.js";

const TABLE = "products";

const PUBLIC_COLUMNS =
  "uuid, name, slug, sku, short_description, description, price, discount_price," +
  " stock, low_stock_threshold, images, attributes, variants, featured, status," +
  " inventory_mode, pricing_attribute_uuid, expiry_date," +
  " meta_title, meta_description, meta_keywords, created_at, updated_at";

const INTERNAL_COLUMNS =
  "id, uuid, name, slug, sku, brand_id, category_id, price, discount_price," +
  " stock, status, inventory_mode, created_at, updated_at";

const BASE_SELECT = `
  SELECT p.uuid, p.name, p.slug, p.sku, p.short_description, p.description,
         p.price, p.discount_price, p.stock, p.low_stock_threshold,
         p.images, p.attributes, p.variants, p.featured, p.status,
         p.inventory_mode, p.pricing_attribute_uuid,
         to_char(p.expiry_date, 'YYYY-MM-DD') AS expiry_date,
         p.meta_title, p.meta_description, p.meta_keywords,
         p.created_at, p.updated_at,
         b.uuid AS brand_uuid, b.name AS brand_name,
         c.uuid AS category_uuid, c.name AS category_name,
         c.slug AS category_slug
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN categories c ON c.id = p.category_id
`;

export const Product = {
  TABLE,

  slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  },

  async create(data = {}) {
    const {
      name,
      slug,
      sku = "",
      shortDescription = "",
      description = "",
      // price and stock are deliberately NOT taken from the request. Both are
      // owned by the purchasing flow: receiving a purchase invoice increments
      // stock and sets price. Ignoring them here means a crafted request cannot
      // set them behind the product form's back.
      discountPrice = null,
      lowStockThreshold = 5,
      brandUuid = null,
      categoryUuid = null,
      images = [],
      attributes = [],
      variants = [],
      featured = false,
      status = "DRAFT",
      inventoryMode = "SINGLE",
      pricingAttributeUuid = null,
      expiryDate = null,
      metaTitle = "",
      metaDescription = "",
      metaKeywords = "",
    } = data;

    const brandId = await resolveId("brands", brandUuid);
    const categoryId = await resolveId("categories", categoryUuid);

    const result = await pool.query(
      `
      INSERT INTO ${TABLE}
        (name, slug, sku, short_description, description, price, discount_price,
         stock, low_stock_threshold, brand_id, category_id, images, attributes,
         variants, featured, status, inventory_mode, pricing_attribute_uuid,
         expiry_date, meta_title, meta_description, meta_keywords)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING ${PUBLIC_COLUMNS}
      `,
      [
        (name ?? "").trim(),
        this.slugify(slug || name),
        (sku ?? "").trim(),
        shortDescription ?? "",
        description ?? "",
        // A new product starts with nothing to sell and nothing in stock. Both
        // are set by receiving a purchase invoice.
        0,
        discountPrice == null || discountPrice === "" ? null : Number(discountPrice),
        0,
        Math.max(0, parseInt(lowStockThreshold, 10) || 0),
        brandId,
        categoryId,
        JSON.stringify(Array.isArray(images) ? images : []),
        JSON.stringify(Array.isArray(attributes) ? attributes : []),
        JSON.stringify(Array.isArray(variants) ? variants : []),
        Boolean(featured),
        status,
        inventoryMode,
        pricingAttributeUuid || null,
        expiryDate || null,
        metaTitle ?? "",
        metaDescription ?? "",
        metaKeywords ?? "",
      ]
    );

    return this.findByUuid(result.rows[0].uuid);
  },

  async findByUuid(uuid) {
    const result = await pool.query(
      `${BASE_SELECT} WHERE p.uuid = $1`,
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
      `${BASE_SELECT} WHERE p.slug = $1`,
      [this.slugify(slug)]
    );

    return result.rows[0] || null;
  },

  async all({ status = "", search = "" } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`p.status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`
      );
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await pool.query(
      `${BASE_SELECT} ${where} ORDER BY p.name ASC`,
      params
    );

    return result.rows;
  },

  async list({
    search = "",
    status = "",
    categoryUuid = "",
    brandUuid = "",
    featured = "",
    page = 1,
    limit = 20,
  } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(
        `(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.slug ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      conditions.push(`p.status = $${params.length}`);
    }

    if (categoryUuid) {
      params.push(categoryUuid);
      conditions.push(
        `p.category_id = (SELECT id FROM categories WHERE uuid = $${params.length})`
      );
    }

    if (brandUuid) {
      params.push(brandUuid);
      conditions.push(
        `p.brand_id = (SELECT id FROM brands WHERE uuid = $${params.length})`
      );
    }

    if (featured === "true") {
      conditions.push(`p.featured = TRUE`);
    } else if (featured === "false") {
      conditions.push(`p.featured = FALSE`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    return paginate(
      {
        baseSql: `${BASE_SELECT} ${where}`,
        countSql: `SELECT COUNT(*)::int AS count FROM products p ${where}`,
        params,
        orderBy: "ORDER BY p.created_at DESC, p.id DESC",
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

    if (updates.sku !== undefined) {
      set("sku", (updates.sku ?? "").trim());
    }

    if (updates.shortDescription !== undefined) {
      set("short_description", updates.shortDescription ?? "");
    }

    if (updates.description !== undefined) {
      set("description", updates.description ?? "");
    }

    // price and stock are ignored here on purpose. They belong to the purchasing
    // flow: receiving a purchase invoice line is what sets them. Kept as an
    // explicit skip rather than a silent one, so it is obvious this was decided.

    if (updates.discountPrice !== undefined) {
      set(
        "discount_price",
        updates.discountPrice == null || updates.discountPrice === ""
          ? null
          : Number(updates.discountPrice)
      );
    }

    // stock, like price, is owned by the purchase receipt path.

    if (updates.lowStockThreshold !== undefined) {
      set(
        "low_stock_threshold",
        Math.max(0, parseInt(updates.lowStockThreshold, 10) || 0)
      );
    }

    if (updates.brandUuid !== undefined) {
      set("brand_id", await resolveId("brands", updates.brandUuid));
    }

    if (updates.categoryUuid !== undefined) {
      set(
        "category_id",
        await resolveId("categories", updates.categoryUuid)
      );
    }

    if (updates.images !== undefined) {
      set("images", JSON.stringify(Array.isArray(updates.images) ? updates.images : []));
    }

    if (updates.attributes !== undefined) {
      set("attributes", JSON.stringify(Array.isArray(updates.attributes) ? updates.attributes : []));
    }

    if (updates.variants !== undefined) {
      set("variants", JSON.stringify(Array.isArray(updates.variants) ? updates.variants : []));
    }

    if (updates.featured !== undefined) {
      set("featured", Boolean(updates.featured));
    }

    if (updates.status !== undefined) {
      set("status", updates.status);
    }

    if (updates.inventoryMode !== undefined) {
      set("inventory_mode", updates.inventoryMode || "SINGLE");
    }

    if (updates.pricingAttributeUuid !== undefined) {
      set("pricing_attribute_uuid", updates.pricingAttributeUuid || null);
    }

    if (updates.expiryDate !== undefined) {
      set(
        "expiry_date",
        updates.expiryDate == null || updates.expiryDate === ""
          ? null
          : updates.expiryDate
      );
    }

    if (updates.metaTitle !== undefined) {
      set("meta_title", updates.metaTitle ?? "");
    }

    if (updates.metaDescription !== undefined) {
      set("meta_description", updates.metaDescription ?? "");
    }

    if (updates.metaKeywords !== undefined) {
      set("meta_keywords", updates.metaKeywords ?? "");
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

  async bulkUpdateInventory(items = []) {
    let updated = 0;
    const uuids = [];

    for (const item of items) {
      if (!item || typeof item !== "object" || !item.uuid) {
        continue;
      }

      const updates = {};

      if (item.price !== undefined) {
        updates.price = item.price;
      }

      if (item.discountPrice !== undefined) {
        updates.discountPrice = item.discountPrice;
      }

      if (item.stock !== undefined) {
        // Variant stock also comes from purchasing, not from this update path.
        updates.stock = item.stock;
      }

      if (item.lowStockThreshold !== undefined) {
        updates.lowStockThreshold = item.lowStockThreshold;
      }

      if (item.variants !== undefined) {
        updates.variants = item.variants;
      }

      if (Object.keys(updates).length === 0) {
        continue;
      }

      const result = await this.update(item.uuid, updates);

      if (result) {
        updated += 1;
        uuids.push(result.uuid);
      }
    }

    return { updated, uuids };
  },

  async remove(uuid) {
    const result = await pool.query(
      `DELETE FROM ${TABLE} WHERE uuid = $1 RETURNING uuid`,
      [uuid]
    );

    return result.rows[0] || null;
  },

  async countByCategory(categoryId) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM products WHERE category_id = $1`,
      [categoryId]
    );

    return parseInt(result.rows[0]?.count || "0", 10);
  },

  async countByBrand(brandId) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM products WHERE brand_id = $1`,
      [brandId]
    );

    return parseInt(result.rows[0]?.count || "0", 10);
  },
};

// Resolves a public uuid to its internal id for a given table.
async function resolveId(table, uuid) {
  if (!uuid) {
    return null;
  }

  const result = await pool.query(
    `SELECT id FROM ${table} WHERE uuid = $1`,
    [uuid]
  );

  return result.rows[0]?.id ?? null;
}