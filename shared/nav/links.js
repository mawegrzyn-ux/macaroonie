// shared/nav/links.js: addresses that open a page at a venue, a day or a
// week, and a tab (docs/PEPPER_FIRST.md 4.6, 22 Nov 2026).
//
// A page's record in shared/nav/<area>.js says what its address accepts
// (`accepts`: some of LINK_KEYS, and `tabs`: the tab keys when it takes a
// tab). pageLink() builds such an address keeping only what the page accepts
// and only values in a good shape; the admin's useDeepLink()
// (admin/src/lib/deepLink.js) reads them back on the page through
// linkValues(), the same rules, then takes them out of the address.
//
//   pageLink('/rota', { venue: '<uuid>', week: '2026-11-23' })
//     -> '/rota?venue=<uuid>&week=2026-11-23'
//   pageLink('/rota', { date: '2026-11-25', tab: 'pay' })   -> '/rota'
//
// The shapes only: whether the venue is one the person can see is the
// page's check (its own venue list), and the API's on every request.

import { NAV_PAGES } from './index.js'

/** What an address may say, in the order it is written. */
export const LINK_KEYS = ['venue', 'date', 'week', 'tab']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A venue id: a uuid. */
export const isUuid = s => typeof s === 'string' && UUID.test(s)

/** A real day written YYYY-MM-DD (not 2026-02-30). */
export function isDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** A week: the day it starts, a Monday. */
export const isMonday = s => isDay(s) && new Date(s + 'T12:00:00Z').getUTCDay() === 1

const ACCEPTS = new Map(NAV_PAGES.filter(p => p.accepts?.length)
  .map(p => [p.path, { keys: p.accepts.slice(), tabs: (p.tabs || []).slice() }]))

/** What a page's address accepts: { keys, tabs } (both empty for most pages). */
export function pageAccepts(path) {
  const a = ACCEPTS.get(path)
  return a ? { keys: a.keys.slice(), tabs: a.tabs.slice() } : { keys: [], tabs: [] }
}

const CHECK = {
  venue: v => isUuid(v),
  date: v => isDay(v),
  week: v => isMonday(v),
}

/**
 * The values a page takes from `values` (a plain object, or URLSearchParams):
 * only the keys it accepts, only in a good shape, a tab only when it is one of
 * the page's. {} when nothing is left.
 */
export function linkValues(path, values) {
  const { keys, tabs } = pageAccepts(path)
  const get = k => {
    const v = typeof values?.get === 'function' ? values.get(k) : values?.[k]
    return v == null ? '' : String(v).trim()
  }
  const out = {}
  for (const k of keys) {
    const v = get(k)
    if (!v) continue
    if (k === 'tab' ? tabs.includes(v) : CHECK[k](v)) out[k] = k === 'venue' ? v.toLowerCase() : v
  }
  return out
}

/** A page's address with what it accepts: '/rota?venue=..&week=..', or just the path. */
export function pageLink(path, values = {}) {
  const clean = linkValues(path, values)
  const q = new URLSearchParams()
  for (const k of LINK_KEYS) if (clean[k]) q.set(k, clean[k])
  const s = q.toString()
  return s ? path + '?' + s : path
}
