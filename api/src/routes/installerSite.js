// src/routes/installerSite.js
//
// Serves the admin build (admin/dist) on installer.{root}, where the admin
// opens as the installer app (/install, admin/src/pages/installer): a phone
// app for linking the tills, kitchen screens, kiosks and menu screens at a
// venue (migration 184). The *.{root} wildcard server block already sends
// this host to the API, so it needs no server setup of its own; Auth0 must
// allow the address (Allowed Callback URLs, Logout URLs, Web Origins).
//
// A global onRequest hook (fastify-plugin), this host only:
//   /api, /ws, /uploads       pass through to their routes
//   http:// (X-Forwarded-Proto) redirected to https:// (sign-in needs it)
//   /manifest.webmanifest     the installer's own (name, icons, start /install),
//                             so it installs as its own app
//   a file in admin/dist      that file (hashed assets cached for a year;
//                             index.html, sw.js and the manifest never cached)
//   anything else (GET)       index.html (the app has its own pages)

import fp from 'fastify-plugin'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { platformHostKind } from '../services/platformHost.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', '..', '..', 'admin', 'dist')

const PASS_PREFIXES = ['/api/', '/ws', '/uploads/']

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

const NO_CACHE = new Set(['/index.html', '/sw.js', '/registerSW.js', '/manifest.webmanifest', '/installer.webmanifest'])

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

async function installerSite(app) {
  app.addHook('onRequest', async (req, reply) => {
    if (platformHostKind(req.hostname || req.headers.host) !== 'installer') return
    if (req.method !== 'GET' && req.method !== 'HEAD') return
    const urlPath = req.url.split('?')[0]
    if (PASS_PREFIXES.some(p => urlPath === p.replace(/\/$/, '') || urlPath.startsWith(p))) return
    if (req.headers['x-forwarded-proto'] === 'http') {
      reply.code(301).header('location', 'https://' + (req.hostname || req.headers.host) + req.url).send()
      return reply
    }
    // The build's manifest is the admin's; this address installs as the installer.
    const wanted = urlPath === '/manifest.webmanifest' ? '/installer.webmanifest' : urlPath
    const file = (wanted !== '/' && fileFor(wanted)) || fileFor('/index.html')
    if (!file) {
      reply.code(503).type('text/plain').send('The admin app has not been built yet (admin/dist).')
      return reply
    }
    const rel = '/' + path.relative(DIST, file).split(path.sep).join('/')
    const ext = path.extname(file)
    reply.header('Cache-Control', NO_CACHE.has(rel) || ext === '.html' || /^\/workbox-/.test(rel)
      ? 'no-cache, no-store, must-revalidate'
      : rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
    reply.header('X-Content-Type-Options', 'nosniff')
    if (ext === '.html') reply.header('X-Frame-Options', 'SAMEORIGIN')
    reply.type(MIME[ext] || 'application/octet-stream').send(fs.createReadStream(file))
    return reply
  })
}

export default fp(installerSite, { name: 'installer-site' })
