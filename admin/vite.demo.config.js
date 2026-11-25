// vite.demo.config.js — the kiosk designer demo on macaroonie.com/try/kiosk
// (src/demo/kiosk/main.jsx). A build of its own, run after the office's by
// `npm run build`: its own folder (dist-demo/, served by the API at
// /site/demo/kiosk-designer/, api/src/services/platformSite/demoBuilds.js),
// no service worker, and none of it in the office's bundle or precache.
//
// The designer's own pages and components are built as they are; only
// src/lib/api.js is swapped for src/demo/kiosk/demoApi.js, which answers the
// designer's routes in the browser (nothing is sent to the API).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from './tailwind.config.js'

const API_MODULE = path.resolve(__dirname, 'src/lib/api.js')
const DEMO_API = path.resolve(__dirname, 'src/demo/kiosk/demoApi.js')

/** Every import of src/lib/api.js gets the demo's stand-in. */
function demoApi() {
  return {
    name: 'kiosk-demo-api',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer === DEMO_API) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && resolved.id.split('?')[0] === API_MODULE ? DEMO_API : null
    },
  }
}

export default defineConfig({
  base: '/site/demo/kiosk-designer/',
  // pictures-sw.js: the worker that shows the visitor's own pictures (src/demo/kiosk/demoPictures.js).
  publicDir: 'public-demo',
  plugins: [demoApi(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  css: {
    // The office's Tailwind setup, reading the demo's files too (the
    // office's own config leaves src/demo out).
    postcss: {
      plugins: [tailwindcss({ ...tailwindConfig, content: ['./demo-kiosk.html', './src/**/*.{js,jsx}'] }), autoprefixer()],
    },
  },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    // The built-in pictures stay files: a design keeps their short address.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { 'demo-kiosk': path.resolve(__dirname, 'demo-kiosk.html') } },
  },
  server: { port: 5174, fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, '../shared')] } },
})
