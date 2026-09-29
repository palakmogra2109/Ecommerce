import { pathToFileURL } from "node:url";
import { loadEnv } from "./lib/env.mjs";

await loadEnv();

const scenarios = [];
export function verifyPhase1({ name, run }) { scenarios.push({ name, run }); }
export async function report() {
  let failed = 0;
  for (const { name, run } of scenarios) {
    try { await run(); console.log(`PASS  ${name}`); }
    catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
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
if (import.meta.url === pathToFileURL(process.argv[1]).href) await report();
