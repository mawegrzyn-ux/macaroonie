// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Macaroonie',
        short_name: 'Macaroonie',
        description: 'Restaurant table booking management',
        theme_color: '#630812',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'landscape',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            // Never cache API or webhook calls — auth-protected and always dynamic
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
          {
            // Auth0 endpoints — network only
            urlPattern: /auth0\.com/,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        // Keep SW disabled in dev to avoid intercepting the Vite proxy
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api':      'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
    },
  },
})
