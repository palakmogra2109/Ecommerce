import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv } from "./lib/env.mjs";

await loadEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on("error", (e) => console.error(`pool  idle-client error: ${e.message}`));
const MIGRATIONS_DIR = path.join(process.cwd(), "sql", "migrations");

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
    : [];
  if (files.length === 0) console.log(`none  no .sql files in ${MIGRATIONS_DIR}`);
  for (const file of files) {
    const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (rows.length) { console.log(`skip  ${file}`); continue; }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`apply ${file}`);
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }
} finally {
  await pool.end();
}
