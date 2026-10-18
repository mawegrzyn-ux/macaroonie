// src/routes/posSite.js
//
// Serves the till app (pos/, built to pos/dist) on pos.{root}, and the same
// build on kitchen.{root} (kitchen screens) and kiosk.{root} (self-order
// kiosks) (services/platformHost.js); the app opens the till, kitchen or
// kiosk app from the address (pos/src/lib/appHost.js). kds.{root} forwards to
// kitchen.{root}. The *.{root} wildcard server block already sends these
// hosts to the API, so they need no server setup of their own.
//
// A global onRequest hook (fastify-plugin), these hosts only:
//   /pos-api, /ws, /uploads   pass through to their routes
//   http:// (X-Forwarded-Proto) redirected to https:// (the PIN check needs it)
//   /manifest.webmanifest     the build's manifest named for the host (Till,
//                             Kitchen, Kiosk), so each installs as its own app
//   a file in pos/dist        that file (hashed assets cached for a year;
//                             index.html, sw.js and the manifest never cached)
//   anything else (GET)       index.html (the app has its own screens)

import fp from 'fastify-plugin'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { platformHostKind, KITCHEN_SUBDOMAIN } from '../services/platformHost.js'
import { env } from '../config/env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', '..', '..', 'pos', 'dist')

const PASS_PREFIXES = ['/pos-api', '/ws', '/uploads/', '/api/']

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}

const APP_HOSTS = new Set(['pos', 'kitchen', 'kiosk'])

// The install name of each host's app (the build's own manifest is the till's).
const APP_NAMES = {
  kitchen: { name: 'Macaroonie Kitchen', short_name: 'Kitchen', description: 'Macaroonie kitchen screen' },
  kiosk: { name: 'Macaroonie Kiosk', short_name: 'Kiosk', description: 'Macaroonie self-order kiosk' },
}

let manifestCache = null
function manifestFor(host) {
  if (!manifestCache) {
    try { manifestCache = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8')) } catch { return null }
  }
  return { ...manifestCache, ...(APP_NAMES[host] || {}) }
}

const NO_CACHE = new Set(['/index.html', '/sw.js', '/registerSW.js', '/manifest.webmanifest'])

function fileFor(urlPath) {
  let p
  try { p = decodeURIComponent(urlPath) } catch { return null }
  const full = path.resolve(DIST, '.' + p)
  if (!full.startsWith(DIST + path.sep)) return null
  try {
    const st = fs.statSync(full)
    return st.isFile() ? full : null
  } catch { return null }
}

async function posSite(app) {
  app.addHook('onRequest', async (req, reply) => {
    const host = platformHostKind(req.hostname || req.headers.host)
    if (!APP_HOSTS.has(host) && host !== 'kds') return
    if (req.method !== 'GET' && req.method !== 'HEAD') return
    const urlPath = req.url.split('?')[0]
    if (PASS_PREFIXES.some(p => urlPath === p.replace(/\/$/, '') || urlPath.startsWith(p))) return
    if (host === 'kds') {
      const to = String(req.hostname || req.headers.host).replace(/^kds\./i, KITCHEN_SUBDOMAIN + '.')
      reply.code(301).header('location', 'https://' + to + req.url).send()
      return reply
    }
    // The till signs people in with WebCrypto, which browsers only offer on
    // https://, so a page opened over http:// (behind nginx) goes to https://.
    if (req.headers['x-forwarded-proto'] === 'http') {
      reply.code(301).header('location', 'https://' + (req.hostname || req.headers.host) + req.url).send()
      return reply
    }

    if (urlPath === '/manifest.webmanifest' && host !== 'pos') {
      const m = manifestFor(host)
      if (m) {
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate')
        reply.type(MIME['.webmanifest']).send(JSON.stringify(m))
        return reply
      }
    }

    const file = (urlPath !== '/' && fileFor(urlPath)) || fileFor('/index.html')
    if (!file) {
      reply.code(503).type('text/plain').send('The device app has not been built yet (pos/dist).')
      return reply
    }
    const rel = '/' + path.relative(DIST, file).split(path.sep).join('/')
    const ext = path.extname(file)
    // A kiosk design's live preview is shown inside the admin (Till setup >
    // Kiosks), so that page may be framed by the platform's own hosts. The
    // app's service worker leaves these pages to the network (pos/vite.config.js).
    if (ext === '.html' && /[?&]kiosk_preview=/.test(req.url)) {
      reply.raw.removeHeader('x-frame-options')
      reply.removeHeader('x-frame-options')
      const root = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
      reply.header('Content-Security-Policy', `frame-ancestors 'self' ${env.PUBLIC_SITE_SCHEME}://${root} ${env.PUBLIC_SITE_SCHEME}://*.${root}`)
    }
    reply.header('Cache-Control', NO_CACHE.has(rel) || ext === '.html' || /^\/workbox-/.test(rel)
      ? 'no-cache, no-store, must-revalidate'
      : rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.type(MIME[ext] || 'application/octet-stream').send(fs.createReadStream(file))
    return reply
  })
}

export default fp(posSite, { name: 'pos-site' })
