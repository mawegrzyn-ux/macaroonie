// src/services/platformSite/demoBuilds.js
//
// The kiosk designer demo on /try/kiosk: two builds made by the deploy's
// `npm run build` in admin/ and pos/ (their vite.demo.config.js), served on
// the apex under /site/ (which nginx already hands to the API,
// scripts/ensure-nginx-site-assets.sh):
//
//   /site/demo/kiosk-designer/<file>   admin/dist-demo/  the office's kiosk
//                                      designer with the demo's data
//   /site/demo/kiosk-app/<file>        pos/dist-demo/    the kiosk app in
//                                      demo mode, the designer's preview
//
// Only the files each build made are served: the folder is listed once per
// process (or again when a name isn't on the list, after a deploy built it
// anew) and a request is looked up by its exact path, never joined to a
// folder, so nothing outside the builds is reachable. Hashed files under
// assets/ are cached for a year; the pages and anything else must be checked
// again each time. Both builds make only pages, scripts, styles and pictures.
// The designer's pictures-sw.js may control all of /site/demo/ (the
// visitor's own pictures, /site/demo/my/..., answered in the browser).

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

const BUILDS = {
  'kiosk-designer': path.join(ROOT, 'admin/dist-demo'),
  'kiosk-app': path.join(ROOT, 'pos/dist-demo'),
}

/** The page each build opens at (its entry). */
export const DEMO_PAGES = {
  designer: '/site/demo/kiosk-designer/demo-kiosk.html',
  kiosk: '/site/demo/kiosk-app/demo-kiosk.html',
}

const TYPES = {
  html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2', json: 'application/json',
}
const PREFIX = '/site/demo/'
const ZIP = new Set(['html', 'js', 'css', 'svg', 'json'])

let roots = BUILDS
const lists = new Map()   // build -> { at, files: Map(rel -> { file, ext }) }
const bodies = new Map()  // file -> { body, gzip }

/** Tests point the builds at folders of their own. */
export function setDemoRoots(next) {
  roots = next || BUILDS
  lists.clear()
  bodies.clear()
}

function walk(dir, base = '') {
  const out = []
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const rel = base ? base + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel))
    else if (e.isFile()) out.push(rel)
  }
  return out
}

// A name not on the list makes the folder be listed again, at most this often.
const RELIST_MS = 10_000

function listOf(build, fresh = false) {
  if (!roots[build]) return null
  const known = lists.get(build)
  if (!known || (fresh && Date.now() - known.at > RELIST_MS)) {
    const files = new Map()
    for (const rel of walk(roots[build])) {
      const ext = rel.split('.').pop().toLowerCase()
      if (TYPES[ext]) files.set(rel, { file: path.join(roots[build], rel), ext })
    }
    lists.set(build, { at: Date.now(), files })
  }
  return lists.get(build).files
}

// Hashed files never change: read once. A page is read each time (a build
// writes it anew, naming new hashed files).
function load(file, zip, keep) {
  let entry = keep ? bodies.get(file) : null
  if (!entry) {
    try { entry = { body: fs.readFileSync(file), gzip: null } } catch { return null }
    if (keep) bodies.set(file, entry)
  }
  if (zip && !entry.gzip) entry.gzip = zlib.gzipSync(entry.body)
  return entry
}

/**
 * Answers GET /site/demo/... on the apex. Returns false when the path isn't
 * under /site/demo/ (the caller goes on), true when it answered (the file or
 * a 404).
 */
export function serveDemo(urlPath, acceptEncoding, reply) {
  if (!urlPath.startsWith(PREFIX)) return false
  const rest = urlPath.slice(PREFIX.length)
  const slash = rest.indexOf('/')
  const build = slash > 0 ? rest.slice(0, slash) : null
  const rel = slash > 0 ? rest.slice(slash + 1) : ''
  let hit = build ? listOf(build)?.get(rel) : null
  // A deploy builds the folders anew (new hashed names): look once more.
  if (!hit && build && rel && !rel.includes('..')) hit = listOf(build, true)?.get(rel) || null
  if (!hit) {
    reply.code(404).type('text/plain').send('Not found')
    return true
  }
  const zip = ZIP.has(hit.ext) && /\bgzip\b/.test(acceptEncoding || '')
  const entry = load(hit.file, zip, rel.startsWith('assets/'))
  if (!entry) {
    reply.code(404).type('text/plain').send('Not found')
    return true
  }
  reply.header('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate')
  reply.header('X-Content-Type-Options', 'nosniff')
  // The designer demo's picture worker answers for the kiosk's folder too
  // (admin/public-demo/pictures-sw.js): allowed the whole of /site/demo/.
  if (build === 'kiosk-designer' && rel === 'pictures-sw.js') reply.header('Service-Worker-Allowed', PREFIX)
  reply.header('Vary', 'Accept-Encoding')
  if (zip) reply.header('Content-Encoding', 'gzip')
  reply.type(TYPES[hit.ext]).send(zip ? entry.gzip : entry.body)
  return true
}
