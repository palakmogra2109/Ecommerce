import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./lib/env.mjs";

await loadEnv();

const SCENARIO_TIMEOUT_MS = 60_000;

const scenarios = [];
export function verifyPhase1({ name, run }) { scenarios.push({ name, run }); }

function withTimeout(run) {
  const running = Promise.resolve().then(() => run());
  running.catch(() => {});
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS}ms`)),
      SCENARIO_TIMEOUT_MS,
    );
  });
  return Promise.race([running, expiry]).finally(() => clearTimeout(timer));
}

export async function report() {
  let failed = 0;
  for (const { name, run } of scenarios) {
    try { await withTimeout(run); console.log(`PASS  ${name}`); }
    catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e?.message ?? e)}`); }
  }
  console.log(`\n${scenarios.length - failed}/${scenarios.length} passed`);
  if (scenarios.length === 0) console.log("no scenarios registered - nothing was verified");
  process.exit(failed || scenarios.length === 0 ? 1 : 0);
}

// ==== SCENARIOS ====
// Later tasks append `verifyPhase1({ name, run })` registrations below this
// marker. Never edit or remove anything under the RUNNER heading below — new
// registrations must be inserted between this comment and the RUNNER comment.

// ==== RUNNER ====
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await report();
