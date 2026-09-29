const COLUMN_QUERY = `SELECT column_name AS name, data_type AS "dataType"
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`;

export async function listColumns(pool, table) {
  const { rows } = await pool.query(COLUMN_QUERY, [table]);
  return rows;
}

export async function assertColumn(pool, table, name) {
  const cols = await listColumns(pool, table);
  if (cols.length === 0) {
    throw new Error(`no such table: ${table} (no columns visible in information_schema)`);
  }
  if (!cols.some((c) => c.name === name)) {
    throw new Error(`missing column ${table}.${name}; have: ${cols.map((c) => c.name).join(", ")}`);
  }
  return cols;
}
