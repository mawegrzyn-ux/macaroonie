// vite.demo.config.js — the kiosk in demo mode for macaroonie.com/try/kiosk
// (src/kiosk/demo/main.jsx): the kiosk designer demo's preview. A build of
// its own, run after the till app's by `npm run build`: its own folder
// (dist-demo/, served by the API at /site/demo/kiosk-app/,
// api/src/services/platformSite/demoBuilds.js) and no service worker.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: '/site/demo/kiosk-app/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { 'demo-kiosk': path.resolve(__dirname, 'demo-kiosk.html') } },
  },
  server: { port: 5181, fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, '../shared')] } },
})
