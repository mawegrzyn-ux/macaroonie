// src/services/usageRecord.js
//
// The usage record (migration 270, Pepper-first step 0a): which pages people
// open in the admin and what they type in the menu search, written from the
// small batches admin/src/lib/usage.js sends to POST /api/usage/events
// (routes/usage.js), and cleared after KEEP_DAYS.
//
// What is kept is the least that answers "which pages are used" and "how
// often is the bar handed to Pepper": a page's path, never its query string,
// with ids in the address turned into :id; a search's last words, its number
// of the menu's own matches, whether it went to Pepper and what was opened.
// Who opened a page is kept so the person can see their own record; the
// group-wide report subjects carry no person (decision 8 of the strategy).

import { withTenant, systemSql } from '../config/db.js'

export const KEEP_DAYS = 90
export const MAX_EVENTS = 50
export const PATH_MAX = 200
export const QUERY_MAX = 200
// How far back a batch may date an event: a tab left open overnight still
// sends its last pages, a wrong clock can't write the record's past.
const OLDEST_MS = 24 * 3600_000
const AHEAD_MS = 5 * 60_000

const UUID_PART = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMBER_PART = /^\d+$/
// A long run of letters and digits with a digit in it reads as a key or token.
const KEY_PART = /^(?=.*\d)[A-Za-z0-9_-]{20,}$/

/**
 * A page's address as it is kept: the path only (no query string or hash),
 * each part that is an id (a uuid, a number, a long key) as :id, at most
 * PATH_MAX characters. null for anything that isn't a path in the app.
 */
export function usagePath(raw) {
  if (typeof raw !== 'string') return null
  let p = raw.trim().split(/[?#]/)[0]
  if (!p.startsWith('/') || p.startsWith('//')) return null
  try { p = decodeURI(p) } catch { /* keep it as sent */ }
  const parts = p.split('/').map(s => (UUID_PART.test(s) || NUMBER_PART.test(s) || KEY_PART.test(s) ? ':id' : s))
  let out = parts.join('/').replace(/\/{2,}/g, '/')
  if (out.length > 1) out = out.replace(/\/$/, '')
  // Letters, digits and the few marks addresses here use; anything else goes.
  out = out.replace(/[^\p{L}\p{N}/_:.~-]/gu, '')
  return out ? out.slice(0, PATH_MAX) : null
}

const clip = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')

/** One event as a row, or null when it says nothing worth keeping. */
export function usageRow(e, now = Date.now()) {
  if (!e || typeof e !== 'object') return null
  let at = typeof e.at === 'string' ? Date.parse(e.at) : NaN
  if (!Number.isFinite(at) || at > now + AHEAD_MS || at < now - OLDEST_MS) at = now
  if (e.kind === 'page') {
    const path = usagePath(e.path)
    return path ? { kind: 'page', at: new Date(at), path, query: null, results: null, pepper: false, picked: null } : null
  }
  if (e.kind === 'search') {
    const query = clip(e.query, QUERY_MAX)
    if (!query) return null
    const picked = ['menu', 'report', 'pepper'].includes(e.picked) ? e.picked : null
    const results = Number.isInteger(e.results) && e.results >= 0 ? Math.min(e.results, 10_000) : null
    return {
      kind: 'search', at: new Date(at), query, results,
      pepper: e.pepper === true || picked === 'pepper',
      picked, path: picked ? usagePath(e.path) : null,
    }
  }
  return null
}

/** Keep a batch of events for one person. Returns how many were kept. */
export async function recordUsage(tenantId, userSub, events, now = Date.now()) {
  const rows = (Array.isArray(events) ? events : []).slice(0, MAX_EVENTS).map(e => usageRow(e, now)).filter(Boolean)
  if (!rows.length || !tenantId || !userSub) return 0
  await withTenant(tenantId, tx => tx`
    INSERT INTO usage_events ${tx(rows.map(r => ({ ...r, tenant_id: tenantId, user_sub: userSub })),
      'tenant_id', 'user_sub', 'kind', 'at', 'path', 'query', 'results', 'pepper', 'picked')}
  `)
  return rows.length
}

/** The hourly clean-up (jobs/ai-cleanup.js): rows older than KEEP_DAYS go, and dismissed suggestions past their time. */
export async function cleanUpUsage() {
  const gone = await systemSql`
    DELETE FROM usage_events WHERE at < now() - make_interval(days => ${KEEP_DAYS}) RETURNING id
  `
  // Home's dismissed suggestions (migration 282) once their time is up.
  const hides = await systemSql`
    DELETE FROM home_suggestion_hides WHERE hidden_until IS NOT NULL AND hidden_until < now() RETURNING key
  `
  return { removed: gone.length, hides: hides.length }
}
