// src/routes/screenSite.js
//
// Serves the menu screens' player (screen/, plain files, no build) on
// screens.{root} (services/platformHost.js). The *.{root} wildcard server
// block already sends that host to the API, so screens need no server setup.
//
// A global onRequest hook (fastify-plugin), screens host only:
//   /screen-api, /ws, /uploads   pass through to their routes
//   http:// (X-Forwarded-Proto)   redirected to https:// (service workers and
//                                 the screen wake lock need it)
//   /lib/<path>.js                the shared files the player imports, from
//                                 shared/ (screenSvc.js PLAYER_LIBS: worked out
//                                 from the imports, so pos/charges.js comes along)
//   /sw.js                        the service worker, with the player version
//                                 written in so every deploy refreshes its cache,
//                                 and the same list of shared files to keep
//   a file in screen/             that file (index.html with the player version)
//   anything else (GET)           index.html
//   ?board_live=                  the player in live mode (the live kitchen view's
//                                 order ready boards): may be framed by *.{root}

import fp from 'fastify-plugin'
import fs from 'node:fs'
import path from 'node:path'
import { platformHostKind } from '../services/platformHost.js'
import { PLAYER_DIR, SHARED_DIR, PLAYER_LIBS, playerVersion } from '../services/screenSvc.js'
import { env } from '../config/env.js'

const PASS_PREFIXES = ['/screen-api', '/ws', '/uploads/', '/api/']

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}

function fileFor(dir, urlPath) {
  let p
  try { p = decodeURIComponent(urlPath) } catch { return null }
  const full = path.resolve(dir, '.' + p)
  if (!full.startsWith(dir + path.sep)) return null
  try {
    const st = fs.statSync(full)
    return st.isFile() ? full : null
  } catch { return null }
}

async function screenSite(app) {
  app.addHook('onRequest', async (req, reply) => {
    if (platformHostKind(req.hostname || req.headers.host) !== 'screens') return
    if (req.method !== 'GET' && req.method !== 'HEAD') return
    const urlPath = req.url.split('?')[0]
    if (PASS_PREFIXES.some(p => urlPath === p.replace(/\/$/, '') || urlPath.startsWith(p))) return
    if (req.headers['x-forwarded-proto'] === 'http') {
      reply.code(301).header('location', 'https://' + (req.hostname || req.headers.host) + req.url).send()
      return reply
    }
    reply.header('X-Content-Type-Options', 'nosniff')

    if (urlPath.startsWith('/lib/')) {
      const name = urlPath.slice(5)
      if (!PLAYER_LIBS.includes(name)) { reply.code(404).type('text/plain').send('Not found'); return reply }
      reply.header('Cache-Control', 'no-cache')
      reply.type(MIME['.js']).send(fs.createReadStream(path.join(SHARED_DIR, name)))
      return reply
    }
    if (urlPath === '/sw.js') {
      const src = fs.readFileSync(path.join(PLAYER_DIR, 'sw.js'), 'utf8')
        .replace('__PLAYER_VERSION__', playerVersion())
        .replace('__PLAYER_LIBS__', PLAYER_LIBS.join(','))
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate')
      reply.type(MIME['.js']).send(src)
      return reply
    }

    const file = (urlPath !== '/' && fileFor(PLAYER_DIR, urlPath)) || fileFor(PLAYER_DIR, '/index.html')
    if (!file) { reply.code(503).type('text/plain').send('The screen player is missing (screen/).'); return reply }
    const ext = path.extname(file)
    if (ext === '.html') {
      // The page knows its own player version, to reload when a config names a newer one.
      reply.header('Cache-Control', 'no-cache')
      // The live kitchen view (kitchen.<root>, pos/src/kitchen/Live.jsx) shows
      // order ready boards in frames: the player in live mode may be framed by
      // the platform's own hosts (helmet's SAMEORIGIN would refuse it).
      if (/[?&]board_live=/.test(req.url)) {
        reply.raw.removeHeader('x-frame-options')
        reply.removeHeader('x-frame-options')
        const root = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
        reply.header('Content-Security-Policy', `frame-ancestors 'self' ${env.PUBLIC_SITE_SCHEME}://${root} ${env.PUBLIC_SITE_SCHEME}://*.${root}`)
      }
      reply.type(MIME['.html']).send(fs.readFileSync(file, 'utf8').replace('__PLAYER_VERSION__', playerVersion()))
      return reply
    }
    reply.header('Cache-Control', ext === '.html' || ext === '.webmanifest' || ext === '.js' ? 'no-cache' : 'public, max-age=86400')
    reply.type(MIME[ext] || 'application/octet-stream').send(fs.createReadStream(file))
    return reply
  })
}

export default fp(screenSite, { name: 'screen-site' })
