import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves the site from /<repo>/
  base: '/mp2/',
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
