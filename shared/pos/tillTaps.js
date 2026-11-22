// shared/pos/tillTaps.js
//
// Taps on a till layout's buttons (22 Nov 2026, OUTSTANDING 44.8): the till
// counts each tap on a zone's button (a category, a menu, a dish, one of the
// designer's own buttons) per day, person, layout and button, and sends the
// counts every minute (pos/src/lib/taps.js, POST /pos-api/till-taps). They
// are kept TAPS_KEEP_DAYS days (pos_till_taps, migration 266) and shown as a
// heat map on the layout in the designer and in the report builder (Till
// buttons tapped). Only counts: never what was on the order, never the time
// of a tap. The one set of rules for the till, the API and the designer.

export const TAPS_KEEP_DAYS = 90
// Zones whose buttons are counted. The order's own buttons (Send, Pay ...)
// are till events already; a dish's choices change with every dish.
export const TAP_ZONES = ['categories', 'menus', 'items', 'category', 'buttons', 'popup']
// At most this many rows in one upload; the till keeps the rest for the next.
export const TAP_BATCH_MAX = 500
export const TAP_COUNT_MAX = 100000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const text = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/**
 * The button a cell of a till zone is, as the designer keys it: the till
 * keys a category 's:<section id>' and a menu 'm:<menu id>'; dishes and the
 * designer's buttons by their own id; the Menu times button 'times'.
 */
export function tapCell(key) {
  const k = String(key ?? '')
  return /^[sm]:/.test(k) ? k.slice(2) : k
}

/** A tap's place in the till's queue: one count per day, person, layout, zone and button. */
export const tapKey = t => [t.day, t.staff_id || '', t.layout_id, t.zone_id, t.cell].join('|')

/**
 * Add a tap (or counts sent back) to a queue { [tapKey]: { day, staff_id,
 * layout_id, zone_id, zone_type, cell, label, n } }; returns a new queue.
 */
export function addTaps(queue, rows) {
  const out = { ...(queue || {}) }
  for (const r of rows || []) {
    const k = tapKey(r)
    const had = out[k]
    out[k] = { ...r, n: (had?.n || 0) + (r.n || 1), label: r.label || had?.label || '' }
  }
  return out
}

/** Take counts that were sent off a queue (what was tapped meanwhile stays). */
export function takeTaps(queue, sent) {
  const out = { ...(queue || {}) }
  for (const r of sent || []) {
    const k = tapKey(r)
    if (!out[k]) continue
    const left = out[k].n - r.n
    if (left > 0) out[k] = { ...out[k], n: left }
    else delete out[k]
  }
  return out
}

/**
 * An upload's rows as the API keeps them; rows that aren't right are left
 * out (an old till, a layout since changed), never the whole upload.
 */
export function cleanTaps(list) {
  const out = []
  for (const r of Array.isArray(list) ? list.slice(0, TAP_BATCH_MAX) : []) {
    if (!r || typeof r !== 'object') continue
    if (!DAY.test(r.day || '') || !UUID.test(r.layout_id || '')) continue
    if (r.staff_id != null && !UUID.test(r.staff_id)) continue
    if (!TAP_ZONES.includes(r.zone_type)) continue
    const zone = text(r.zone_id, 40)
    const cell = text(tapCell(r.cell), 80)
    const n = Math.round(Number(r.n))
    if (!zone || !cell || !Number.isFinite(n) || n < 1) continue
    out.push({
      day: r.day, staff_id: r.staff_id || null, layout_id: r.layout_id.toLowerCase(), zone_id: zone, zone_type: r.zone_type,
      cell, label: text(r.label, 80) || null, n: Math.min(TAP_COUNT_MAX, n),
    })
  }
  return out
}

/**
 * The heat map's figures: { zones: { [zone id]: { [cell]: taps } }, max,
 * total } from rows [{ zone_id, cell, taps }].
 */
export function heatOf(rows) {
  const zones = {}
  let max = 0
  let total = 0
  for (const r of rows || []) {
    const n = Number(r.taps) || 0
    if (!n) continue
    const z = (zones[r.zone_id] ||= {})
    z[r.cell] = (z[r.cell] || 0) + n
    max = Math.max(max, z[r.cell])
    total += n
  }
  return { zones, max, total }
}

/** How hot a button is, 0 (never tapped) to 1 (the most tapped). */
export const heatShare = (n, max) => (max > 0 && n > 0 ? Math.max(0.08, Math.min(1, n / max)) : 0)

/** A heat map colour: pale yellow to deep red as the share grows; none for 0. */
export function heatColour(share) {
  if (!share) return null
  // Hue 55 (yellow) down to 0 (red), lighter for fewer taps.
  const hue = Math.round(55 - 55 * share)
  const light = Math.round(82 - 37 * share)
  return 'hsl(' + hue + ' 95% ' + light + '%)'
}

/** Words on a heat colour: white on the hot end, dark on the pale end. */
export const heatInk = share => (share > 0.55 ? '#ffffff' : '#111827')
