import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const ENV_FILE = path.join(ROOT, ".env.local");

export async function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const text = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!(key in process.env)) process.env[key] = value.trim();
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not found in .env.local");
  }
}
