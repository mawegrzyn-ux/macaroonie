// src/services/platformSite/assets.js
//
// The platform site's own files (CSS, JS, screenshots), kept in
// api/platform-site/ and served on the apex at /site/<file>. nginx hands
// /site/ to the API (scripts/ensure-nginx-site-assets.sh): without that, the
// apex's static-file location would look for .css, .js and .png in the admin's
// build and answer 404.
//
// Pages link to assetUrl('site.css'), which adds ?v=<a hash of the file>, so
// those addresses can be cached for a year; an address without the hash (an
// old page, someone typing it) is cached for an hour.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ASSET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../platform-site')

const TYPES = {
  css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8',
  webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml',
}
const NAME = /^\/site\/((?:[a-z0-9-]+\/)?[a-z0-9-]+\.(css|js|webp|png|jpg|svg))$/

// Static files, the same in every process: read once each.
const cache = new Map()

function load(rel) {
  if (cache.has(rel)) return cache.get(rel)
  let entry = null
  try {
    const body = fs.readFileSync(path.join(ASSET_DIR, rel))
    entry = { body, hash: crypto.createHash('sha1').update(body).digest('hex').slice(0, 10) }
  } catch { entry = null }
  cache.set(rel, entry)
  return entry
}

/** '/site/<rel>?v=<hash>' for a page to link to. */
export function assetUrl(rel) {
  const entry = load(rel)
  return '/site/' + rel + (entry ? '?v=' + entry.hash : '')
}

/**
 * Answers GET /site/... on the apex. Returns false when the path isn't under
 * /site/ (the caller goes on), true when it answered (the file or a 404).
 */
export function serveAsset(path, query, reply) {
  if (!path.startsWith('/site/')) return false
  const m = NAME.exec(path)
  const entry = m ? load(m[1]) : null
  if (!entry) {
    reply.code(404).type('text/plain').send('Not found')
    return true
  }
  const versioned = /(^|&)v=/.test(query || '')
  reply.header('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
  reply.header('ETag', '"' + entry.hash + '"')
  reply.type(TYPES[m[2]]).send(entry.body)
  return true
}
