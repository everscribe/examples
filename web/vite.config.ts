import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build output lands inside the Go module so main.go can //go:embed it.
// Dev mode still works via the proxy below — `npm run dev` serves on
// 5173 and forwards /api/* to the Go server on 8080.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
