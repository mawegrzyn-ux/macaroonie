// vite.config.js — the till app (docs/POS.md), served on pos.{root}.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['till-icon.svg', 'till-apple-touch-icon.png'],
      manifest: {
        name: 'Macaroonie Till',
        short_name: 'Till',
        description: 'Macaroonie till: table and counter service',
        theme_color: '#1f2a44',
        background_color: '#eef1f6',
        display: 'fullscreen',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/till-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/till-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/till-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The whole app is cached so the till opens with the internet down.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // A kiosk design preview (shown inside the admin) comes from the
        // server, which lets the admin frame it (api/src/routes/posSite.js).
        navigateFallbackDenylist: [/^\/pos-api/, /^\/ws/, /^\/uploads/, /[?&]kiosk_preview=/],
        runtimeCaching: [
          { urlPattern: /\/pos-api\//, handler: 'NetworkOnly' },
          // Kiosks: dish photos and the design's fonts stay on the device, so
          // the menu shows at once and still shows when the internet drops.
          {
            // Same-origin only (uploads under /uploads/): an opaque cross-origin
            // response takes megabytes of the device's storage quota each.
            urlPattern: ({ request, url }) => request.destination === 'image' && url.origin === self.location.origin,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'kiosk-images', expiration: { maxEntries: 600, maxAgeSeconds: 30 * 24 * 3600 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'kiosk-fonts', expiration: { maxEntries: 40, maxAgeSeconds: 365 * 24 * 3600 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5180,
    fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, '../shared')] },
    proxy: {
      '/pos-api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
