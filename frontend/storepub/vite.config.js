import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { apiProxy, REPO_ROOT } from "../../shared/viteProxy.mjs";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Point envDir at the repo root so Vite watches the .env that holds
  // BACKEND_URL and restarts on change — without this, editing BACKEND_URL
  // would need a manual restart on every port change.
  envDir: REPO_ROOT,
  server: {
    port: 5174,
    strictPort: true,
    // Target comes from BACKEND_URL in the repo-root .env — see
    // shared/viteProxy.mjs.
    proxy: apiProxy(loadEnv(mode, REPO_ROOT, "")),
  },
}));