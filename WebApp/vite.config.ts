import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// The dashboard talks only to the local server (npm run server). In development
// Vite forwards those calls so the page and the API share one origin.
const api = process.env.API_URL ?? 'http://127.0.0.1:4000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': api,
      '/images': api,
    },
  },
})
