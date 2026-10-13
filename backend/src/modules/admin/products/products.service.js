import pool from '../../../../lib/db.js';

export const getAllProducts = async () => {
  const { rows } = await pool.query('SELECT id, name, sku, status, created_at FROM products ORDER BY created_at DESC');
  return rows;
};

export const createProduct = async (productData) => {
  const { name, sku, attributes, variants, images } = productData;
  const { rows } = await pool.query(
    `INSERT INTO products (name, sku, attributes, variants, images, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW())
     RETURNING id, name, sku, status`,
    [name, sku, JSON.stringify(attributes), JSON.stringify(variants), JSON.stringify(images)]
  );
  return rows[0];
};

export const getProductById = async (id) => {
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
  return rows[0];
};

export const updateProduct = async (id, updates) => {
  const setClauses = [];
  const values = [];
  let paramCount = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramCount}`);
    values.push(updates.name);
    paramCount++;
  }
  if (updates.sku !== undefined) {
    setClauses.push(`sku = $${paramCount}`);
    values.push(updates.sku);
    paramCount++;
  }
  // ... handle attributes, variants, images similarly

  if (setClauses.length === 0) return null;

  values.push(id);
  const query = `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${paramCount} RETURNING *`;
  const { rows } = await pool.query(query, values);
  return rows[0];
};

export const deleteProduct = async (id) => {
  const { rows } = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id, name', [id]);
  return rows[0];
};
