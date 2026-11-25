// src/services/platformSite/sharedModules.js
//
// The pages on /try run the real rules in the browser (rule 12: no second
// implementation): the kitchen walkthrough replays its story on the kitchen
// test bench (shared/pos/kitchenBench.js, kitchen.js, kitchenPrint.js,
// ticketHtml.js, kitchenTimers.js, kitchenColours.js), the kiosk sandbox
// draws with shared/kiosk.js. Those files are
// plain ESM with no Node-only imports, so they are served as they are, at
//
//   /site/shared/<version>/<path under shared/>
//
// Only the files the ENTRIES import (and what those import, followed through
// their static `import ... from './x.js'` lines) are served: the list is made
// once from the entries, and a request is looked up in it by its exact path,
// never joined to a folder. <version> is a hash of every file on the list, so
// the address changes whenever one does: the files are cached for a year,
// and a module never meets an older copy of one it imports. An old version's
// address answers 404 (its page is fetched again first: pages are
// must-revalidate). Each file is gzipped once when the browser takes gzip.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const SHARED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../shared')

/** The modules the pages import (paths under shared/). */
export const ENTRIES = ['pos/kitchenBench.js', 'pos/kitchenPrint.js', 'pos/ticketHtml.js', 'pos/kitchenTimers.js', 'pos/kitchenColours.js', 'kiosk.js']

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"`;]*?\sfrom\s+['"](\.{1,2}\/[^'"]+\.js)['"]/g
const PREFIX = '/site/shared/'

let built = null

function build() {
  const files = new Map()
  const queue = [...ENTRIES]
  while (queue.length) {
    const rel = queue.shift()
    if (files.has(rel)) continue
    const body = fs.readFileSync(path.join(SHARED_DIR, rel))
    const deps = []
    files.set(rel, { body, deps, gzip: null })
    for (const m of body.toString('utf8').matchAll(IMPORT)) {
      const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]))
      // Only files inside shared/ (a module reaching out of it isn't served).
      if (next.startsWith('../')) continue
      deps.push(next)
      if (!files.has(next)) queue.push(next)
    }
  }
  const hash = crypto.createHash('sha1')
  for (const rel of [...files.keys()].sort()) hash.update(rel).update(files.get(rel).body)
  return { files, version: hash.digest('hex').slice(0, 12) }
}

function list() {
  if (!built) built = build()
  return built
}

/** The address of a shared module for a page: '/site/shared/<version>/<rel>'. */
export function sharedUrl(rel) {
  return PREFIX + list().version + '/' + rel
}

/** The base the sandboxes' scripts import from ('/site/shared/<version>/'). */
export function sharedBase() {
  return PREFIX + list().version + '/'
}

/** Every file served (paths under shared/). */
export function sharedFiles() {
  return [...list().files.keys()]
}

/**
 * The addresses of some entries and everything they import, for a page's
 * modulepreload links (the browser fetches them side by side instead of one
 * import after another).
 */
export function sharedPreloads(entries = []) {
  const { files } = list()
  const out = new Set()
  const queue = [...entries]
  while (queue.length) {
    const rel = queue.shift()
    if (out.has(rel) || !files.has(rel)) continue
    out.add(rel)
    queue.push(...files.get(rel).deps)
  }
  return [...out].map(sharedUrl)
}

/**
 * Answers GET /site/shared/... on the apex. Returns false when the path isn't
 * under it (the caller goes on), true when it answered (the file or a 404).
 */
export function serveShared(urlPath, acceptEncoding, reply) {
  if (!urlPath.startsWith(PREFIX)) return false
  const { files, version } = list()
  const rest = urlPath.slice(PREFIX.length)
  const entry = rest.startsWith(version + '/') ? files.get(rest.slice(version.length + 1)) : null
  if (!entry) {
    reply.code(404).type('text/plain').send('Not found')
    return true
  }
  reply.header('Cache-Control', 'public, max-age=31536000, immutable')
  reply.header('Vary', 'Accept-Encoding')
  reply.type('application/javascript; charset=utf-8')
  if (/\bgzip\b/.test(acceptEncoding || '')) {
    if (!entry.gzip) entry.gzip = zlib.gzipSync(entry.body, { level: 9 })
    reply.header('Content-Encoding', 'gzip')
    reply.send(entry.gzip)
  } else {
    reply.send(entry.body)
  }
  return true
}
