import pool from '../../../../lib/db.js';

export const getStoreProducts = async (filters = {}) => {
  const { category, brand, search, status = 'ACTIVE' } = filters;
  let query = 'SELECT id, name, sku, price, status, images FROM products WHERE status = $1';
  const values = [status];
  let paramCount = 2;

  if (category) {
    query += ` AND attributes @> $${paramCount}::jsonb`;
    values.push(`{"Category": "${category}"}`);
    paramCount++;
  }
  if (search) {
    query += ` AND (name ILIKE $${paramCount} OR sku ILIKE $${paramCount})`;
    values.push(`%${search}%`);
    paramCount++;
  }

  const { rows } = await pool.query(query, values);
  return rows;
};

export const getProductBySku = async (sku) => {
  const { rows } = await pool.query('SELECT * FROM products WHERE sku = $1', [sku]);
  return rows[0];
};
