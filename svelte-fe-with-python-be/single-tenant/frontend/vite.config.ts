import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// `npm run build` writes to web/dist (Vite's default), which the Go
// binary at this example's root picks up via //go:embed all:web/dist.
//
// Dev mode (`npm run dev`) serves on 5173 and proxies /api/*
// to the Go server on 9000.
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:9000',
    },
  },
})
