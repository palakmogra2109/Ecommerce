import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { apiProxy, REPO_ROOT } from '../shared/viteProxy.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  // Point envDir at the repo root so Vite watches the .env that holds
  // BACKEND_URL and restarts on change — without this, editing BACKEND_URL
  // would need a manual restart on every port change.
  envDir: REPO_ROOT,
  server: {
    // Target comes from BACKEND_URL in the repo-root .env — see
    // shared/viteProxy.mjs. Both /api and /media are forwarded: product images
    // live under the backend's public/media and come back from the API as
    // root-relative paths, and this app also mounts the public customer
    // storefront (Storefront.jsx).
    proxy: apiProxy(loadEnv(mode, REPO_ROOT, '')),
  },
}))