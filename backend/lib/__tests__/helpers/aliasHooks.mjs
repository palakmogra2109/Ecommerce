import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// The app resolves `@/*` to backend/ and `@shared/*` to ../shared/ through
// tsconfig paths, which the Next build honours but bare `node --test` does not.
// Route tests import the handlers directly, so the same mapping is registered
// here instead of being copied into every test. Mirrors backend/tsconfig.json:
// "@/*": ["./*"], "@shared/*": ["../shared/*"]

const BACKEND = path.resolve(import.meta.dirname, "../../..");
const SHARED = path.resolve(BACKEND, "../shared");

/** Appends .js when the specifier names a directory's index or omits it. */
function resolveFile(target) {
  const candidates = [target, `${target}.js`, path.join(target, "index.js")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return target;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // next/headers only resolves inside a Next server; the route tests supply
    // the same values through the stub.
    if (specifier === "next/headers") {
      return {
        url: pathToFileURL(path.join(import.meta.dirname, "nextHeadersStub.mjs")).href,
        shortCircuit: true,
      };
    }
    // The app's own relative imports are extensionless (`./auth`), which the
    // Next bundler resolves but bare node ESM will not. Same shim, same reason.
    if (/^\.\.?\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith("file:")) {
      const base = path.dirname(fileURLToPath(context.parentURL));
      const resolved = resolveFile(path.resolve(base, specifier));
      if (resolved !== path.resolve(base, specifier)) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }
    if (specifier.startsWith("@shared/")) {
      return {
        url: pathToFileURL(resolveFile(path.join(SHARED, specifier.slice("@shared/".length)))).href,
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/")) {
      return {
        url: pathToFileURL(resolveFile(path.join(BACKEND, specifier.slice(2)))).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});