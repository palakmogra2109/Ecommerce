import pg from "pg";
import { loadEnv } from "./env.mjs";

export function createPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set - call loadEnv() first");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  pool.on("error", (e) => console.error(`pool  idle-client error: ${e.message}`));
  return pool;
}

// Owns the pool for the duration of one standalone task (generator, ad-hoc
// script). Long-lived harnesses should create one pool at module scope and let
// the process exit close it, rather than calling pool.end() mid-run.
export async function withPool(fn) {
  await loadEnv();
  const pool = createPool();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}
