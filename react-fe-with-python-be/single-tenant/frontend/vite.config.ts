import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run build` writes to web/dist (Vite's default), which the Go
// binary at this example's root picks up via //go:embed all:web/dist.
//
// Dev mode (`npm run dev`) serves on 5173 and proxies /api/*
// to the Go server on 9000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:9000',
    },
  },
})
