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
//   /hub on pos.{root}         the page with the venue hub's installer (/pos-api/hub/setup)
//   /android                  the Macaroonie Android app's APK (services/androidAppSvc.js,
//                             migration 213), or a page saying there isn't one yet
//   /receipt/<token>          a guest's receipt from a kiosk (the route below, migration 209)
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
import { receiptPage } from '../services/receiptSvc.js'
import { androidApp, APK_MIME } from '../services/androidAppSvc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', '..', '..', 'pos', 'dist')

const PASS_PREFIXES = ['/pos-api', '/ws', '/uploads/', '/api/', '/receipt/']

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

function notePage(title, text) {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + '</title>'
    + '<p style="font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;line-height:1.5">' + text + '</p>'
}

/**
 * The Android app's download: the copy kept on this server (local storage)
 * is sent as macaroonie.apk; a copy in S3 storage is a redirect to it.
 */
async function sendAndroidApp(reply) {
  const app = await androidApp()
  reply.header('Cache-Control', 'no-cache, no-store, must-revalidate')
  if (!app) {
    reply.code(404).type('text/html; charset=utf-8')
      .send(notePage('Macaroonie Android app', 'The Macaroonie Android app isn\'t available here yet. Ask your Macaroonie contact for it, or use this address in the browser.'))
    return reply
  }
  if (!app.url.startsWith('/uploads/')) {
    reply.code(302).header('location', app.url).send()
    return reply
  }
  const file = path.resolve(env.UPLOAD_DIR, app.url.slice('/uploads/'.length))
  let size = 0
  try {
    if (!file.startsWith(path.resolve(env.UPLOAD_DIR) + path.sep)) throw new Error('outside')
    size = fs.statSync(file).size
  } catch {
    reply.code(404).type('text/html; charset=utf-8')
      .send(notePage('Macaroonie Android app', 'The app\'s file is missing on the server. Ask your Macaroonie contact to add it again on the Platform page.'))
    return reply
  }
  reply.header('Content-Disposition', 'attachment; filename="macaroonie.apk"')
  reply.header('Content-Length', size)
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.type(APK_MIME).send(fs.createReadStream(file))
  return reply
}

async function posSite(app) {
  // A guest's receipt (services/receiptSvc.js): the link is the key. Only on
  // the device addresses; never cached or indexed, and the page sends no referrer.
  app.get('/receipt/:token', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const host = platformHostKind(req.hostname || req.headers.host)
    if (!APP_HOSTS.has(host)) return reply.code(404).send({ error: 'Not found' })
    const html = await receiptPage(req.params.token)
    reply.header('Cache-Control', 'no-store')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    if (!html) {
      return reply.code(404).type('text/html; charset=utf-8')
        .send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Receipt</title>'
          + '<p style="font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px">This receipt link doesn\'t work: it may be older than a year, or not all of it was copied.</p>')
    }
    return reply.type('text/html; charset=utf-8').send(html)
  })

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

    // A short address to type on a mini PC: the page with the hub's installer.
    if (host === 'pos' && (urlPath === '/hub' || urlPath === '/hub/')) {
      reply.code(302).header('location', '/pos-api/hub/setup').send()
      return reply
    }

    // The Android app, the same file on every device address.
    if (urlPath === '/android' || urlPath === '/android/') return sendAndroidApp(reply)

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
    // A kiosk design's live preview is shown inside the admin (Store tech >
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
