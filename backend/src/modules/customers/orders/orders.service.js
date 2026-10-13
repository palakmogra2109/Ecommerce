import pool from '../../../../lib/db.js';

export const getCustomerOrders = async (userId, statusFilter) => {
  let query = 'SELECT id, order_number, total, status, created_at, shipped_at FROM orders WHERE user_id = $1';
  const values = [userId];
  let paramCount = 2;

  if (statusFilter) {
    query += ` AND status = $${paramCount}`;
    values.push(statusFilter);
    paramCount++;
  }

  query += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(query, values);
  return rows;
};

export const getOrderById = async (orderId) => {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  return rows[0];
};
