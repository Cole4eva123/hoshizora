import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves the site from /<repo>/, the app (`tauri dev`/`tauri build` set TAURI_ENV_PLATFORM) from /
  base: process.env.TAURI_ENV_PLATFORM ? '/' : '/hoshizora/',
  // keep the Rust build's output on screen under `tauri dev`
  clearScreen: false,
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    // not the Rust side, whose build output runs to tens of thousands of files
    watch: { ignored: ['**/src-tauri/**'] },
    // Douban sends no CORS headers, so the browser reaches it through the dev server
    proxy: {
      '/douban': { target: 'https://movie.douban.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/douban/, '') },
    },
  },
})
