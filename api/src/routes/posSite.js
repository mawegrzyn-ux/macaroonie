// src/routes/posSite.js
//
// Serves the till app (pos/, built to pos/dist) on pos.{root}
// (services/platformHost.js). The *.{root} wildcard server block already
// sends that host to the API, so the till needs no server setup of its own.
//
// A global onRequest hook (fastify-plugin), pos host only:
//   /pos-api, /ws, /uploads   pass through to their routes
//   a file in pos/dist        that file (hashed assets cached for a year;
//                             index.html, sw.js and the manifest never cached)
//   anything else (GET)       index.html (the app has its own screens)

import fp from 'fastify-plugin'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { platformHostKind } from '../services/platformHost.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', '..', '..', 'pos', 'dist')

const PASS_PREFIXES = ['/pos-api', '/ws', '/uploads/', '/api/']

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
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
    if (platformHostKind(req.hostname || req.headers.host) !== 'pos') return
    if (req.method !== 'GET' && req.method !== 'HEAD') return
    const urlPath = req.url.split('?')[0]
    if (PASS_PREFIXES.some(p => urlPath === p.replace(/\/$/, '') || urlPath.startsWith(p))) return

    const file = (urlPath !== '/' && fileFor(urlPath)) || fileFor('/index.html')
    if (!file) {
      reply.code(503).type('text/plain').send('The till app has not been built yet (pos/dist).')
      return reply
    }
    const rel = '/' + path.relative(DIST, file).split(path.sep).join('/')
    const ext = path.extname(file)
    reply.header('Cache-Control', NO_CACHE.has(rel) || ext === '.html' || /^\/workbox-/.test(rel)
      ? 'no-cache, no-store, must-revalidate'
      : rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.type(MIME[ext] || 'application/octet-stream').send(fs.createReadStream(file))
    return reply
  })
}

export default fp(posSite, { name: 'pos-site' })
