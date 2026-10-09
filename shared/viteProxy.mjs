// Single source of truth for the backend URL used by the Vite dev servers.
//
// All three apps (frontend, frontend/storepanel, frontend/storepub) forward
// their /api and /media requests to the same Next.js backend. That target used
// to be hardcoded in each vite.config.js, and when the backend moved to :3000
// the stale :3001 went unnoticed until every page's login returned 502 —
// Vite answers 502 whenever the proxy target refuses the connection.
//
// Resolve it from BACKEND_URL in the repo-root .env instead, so there is one
// place to change and one obvious name to grep for.
//
// Deliberately dependency-free: the caller does the `loadEnv` and hands the
// result in, because this file sits outside every app's node_modules and so
// cannot resolve `vite` itself. That also keeps it testable with plain Node.
//
// .mjs because the repo-root package.json has no "type": "module", and Vite's
// native config loader rejects ESM syntax in a file it reads as CommonJS.

import { fileURLToPath, URL } from "node:url";
import { resolve as resolvePath } from "node:path";

export const BACKEND_URL_KEY = "BACKEND_URL";

export const DEFAULT_BACKEND_URL = "http://localhost:3000";

// resolvePath normalises away the trailing slash that new URL("..") leaves
// behind, which would otherwise print as ".../Ecommerce//.env" in warnings.
export const REPO_ROOT = resolvePath(fileURLToPath(new URL("..", import.meta.url)));

export function resolveBackendUrl(env) {
  const configured = (env?.[BACKEND_URL_KEY] || "").trim();

  if (!configured) {
    // Warn rather than fail: a missing .env should not stop the dev server,
    // but it must never come back as a silent mystery 502 either.
    console.warn(
      `[vite] ${BACKEND_URL_KEY} is not set — falling back to ${DEFAULT_BACKEND_URL}.\n` +
        `[vite] Set it in ${REPO_ROOT}/.env to point the dev proxy at your backend.`,
    );
    return DEFAULT_BACKEND_URL;
  }

  // A trailing slash would make http-proxy build "//api/..." paths.
  return configured.replace(/\/+$/, "");
}

// The proxy map shared by every app. /media is forwarded alongside /api
// because the API returns product images as root-relative /media/... paths,
// and the admin app also mounts the public customer storefront.
export function apiProxy(env) {
  const target = resolveBackendUrl(env);

  return {
    "/api": { target, changeOrigin: true },
    "/media": { target, changeOrigin: true },
  };
}