import pool from '../../../../lib/db.js';

export const getCustomerProfile = async (userId) => {
  const { rows } = await pool.query('SELECT id, name, email, phone, address, created_at FROM users WHERE id = $1', [userId]);
  return rows[0];
};

export const updateCustomerProfile = async (userId, profileData) => {
  const { rows } = await pool.query(
    `UPDATE users SET name = $1, phone = $2, address = $3, updated_at = NOW() WHERE id = $4 RETURNING id, name, email, phone, address`,
    [profileData.name, profileData.phone, profileData.address, userId]
  );
  return rows[0];
};
