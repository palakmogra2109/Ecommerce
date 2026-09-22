import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Product/media images live under the backend's public/media and are
      // returned by the API as root-relative paths (/media/...). The admin
      // app also mounts the public customer storefront (Storefront.jsx), so
      // forward /media the same way /api is forwarded.
      '/media': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})