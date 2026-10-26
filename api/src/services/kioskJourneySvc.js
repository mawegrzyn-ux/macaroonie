// src/services/kioskJourneySvc.js
//
// Kiosk journeys (migration 208, shared/kioskJourney.js): the visits a kiosk
// recorded (pos/src/kiosk/journey.js) are checked here, summed up and kept
// in kiosk_sessions; the report reads them (routes/kioskAnalytics.js).
//
//   cleanVisit(raw)                       a visit as a kiosk sent it, checked and trimmed,
//                                         or { error } (never stored then)
//   saveVisits(device, visits)            store a kiosk's visits: { accepted, saved, refused }
//   cleanUpJourneys(log)                  hourly: playbacks after 90 days, rows after 400
//
// A visit's id is the kiosk's own ULID, so a visit sent twice (the reply was
// lost) is stored once. Nothing is taken on trust beyond its shape: the
// device, venue and tenant come from the kiosk's pairing, a design or
// revenue stream id is kept only when it is the tenant's, and the summary is
// worked out here from the events.

import { withTenant, systemSql } from '../config/db.js'
import { JOURNEY_EVENT_KINDS, END_REASONS, summariseJourney, journeyLength } from '../../../shared/kioskJourney.js'

export const MAX_VISITS = 10
export const MAX_EVENTS = 8000
const MAX_MS = 6 * 3600 * 1000          // a visit longer than six hours is cut there
const MAX_PATCH_CHARS = 64_000
const MAX_VISIT_CHARS = 3_000_000
const MAX_NAMES = 600
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KINDS = new Set(JOURNEY_EVENT_KINDS)
const ENDS = new Set(END_REASONS)

const int = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)))
const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null)
const plain = v => v && typeof v === 'object' && !Array.isArray(v)

function cleanEvent(e, last) {
  if (!plain(e) || !KINDS.has(e.k)) return null
  // In time order: an event earlier than the one before it takes its time.
  const t = Math.max(last, int(e.t, 0, MAX_MS))
  switch (e.k) {
    case 'v': {
      const p = plain(e.p) ? e.p : {}
      const d = Array.isArray(e.d) ? e.d.filter(k => typeof k === 'string' && k.length <= 80).slice(0, 60) : []
      if (Object.keys(p).some(k => k.length > 80)) return null
      if (JSON.stringify(p).length > MAX_PATCH_CHARS) return null
      return d.length ? { t, k: 'v', p, d } : { t, k: 'v', p }
    }
    case 'tap': {
      const hit = [0, 1, 2].includes(e.hit) ? e.hit : 1
      return { t, k: 'tap', x: int(e.x, 0, 20000), y: int(e.y, 0, 20000), el: str(e.el, 80), id: str(e.id, 60), ref: str(e.ref, 60), hit }
    }
    case 'swipe':
      return { t, k: 'swipe', x: int(e.x, 0, 20000), y: int(e.y, 0, 20000), x2: int(e.x2, 0, 20000), y2: int(e.y2, 0, 20000), ms: int(e.ms, 0, 60000), el: str(e.el, 80), id: str(e.id, 60) }
    case 'scroll':
      if (typeof e.s !== 'string' || !/^\d+(\/\d+){0,40}$/.test(e.s)) return null
      return { t, k: 'scroll', s: e.s, y: int(e.y, 0, 1e6), x: int(e.x, 0, 1e6) }
    case 'vp': {
      const w = int(e.w, 1, 20000)
      const h = int(e.h, 1, 20000)
      // The kiosk's box in the window ([x, y, w, h]): bars when the screen isn't the design's shape.
      const b = Array.isArray(e.b) && e.b.length === 4 && e.b.every(n => Number.isFinite(Number(n)))
        ? [int(e.b[0], 0, w), int(e.b[1], 0, h), int(e.b[2], 1, w), int(e.b[3], 1, h)] : null
      return b ? { t, k: 'vp', w, h, b } : { t, k: 'vp', w, h }
    }
    case 'end':
      return { t, k: 'end', why: ENDS.has(e.why) ? e.why : 'interrupted' }
    default:
      return null
  }
}

function cleanNames(raw) {
  const out = {}
  if (!plain(raw)) return out
  for (const [k, v] of Object.entries(raw).slice(0, MAX_NAMES)) {
    if (typeof k === 'string' && k.length <= 80 && typeof v === 'string' && v) out[k] = v.slice(0, 120)
  }
  return out
}

/** A visit checked and trimmed, or { id, error }. */
export function cleanVisit(raw, now = Date.now()) {
  if (!plain(raw)) return { id: null, error: 'Not a visit' }
  const id = typeof raw.id === 'string' && ULID.test(raw.id) ? raw.id : null
  if (!id) return { id: null, error: 'A visit needs its id' }
  const started = new Date(raw.started_at)
  if (Number.isNaN(started.getTime())) return { id, error: 'No start time' }
  if (started.getTime() < now - 31 * 86_400_000 || started.getTime() > now + 86_400_000) return { id, error: 'Started too long ago (or in the future)' }
  if (!Array.isArray(raw.events) || !raw.events.length) return { id, error: 'No events' }
  if (JSON.stringify(raw.events).length > MAX_VISIT_CHARS) return { id, error: 'Too big' }
  const events = []
  let last = 0
  for (const e of raw.events.slice(0, MAX_EVENTS)) {
    const c = cleanEvent(e, last)
    if (!c) continue
    events.push(c)
    last = c.t
  }
  if (!events.some(e => e.k === 'v')) return { id, error: 'Nothing the kiosk showed' }
  const vp = events.find(e => e.k === 'vp')
  return {
    id,
    started_at: started.toISOString(),
    ended_at: new Date(started.getTime() + journeyLength(events)).toISOString(),
    design_id: typeof raw.design_id === 'string' && UUID.test(raw.design_id) ? raw.design_id : null,
    stream_id: typeof raw.stream_id === 'string' && UUID.test(raw.stream_id) ? raw.stream_id : null,
    config_version: str(raw.config_version, 80),
    app_version: str(raw.app_version, 40),
    truncated: !!raw.truncated || raw.events.length > MAX_EVENTS,
    names: cleanNames(raw.names),
    viewport: vp ? { w: vp.w, h: vp.h } : null,
    events,
  }
}

/**
 * Store a kiosk's visits (POST /pos-api/kiosk/journeys). accepted lists
 * every visit the kiosk can forget: stored now, stored before, or refused
 * for good (sending it again would be refused again).
 */
export async function saveVisits(device, rawVisits) {
  const visits = rawVisits.map(v => cleanVisit(v))
  const refused = visits.filter(v => v.error).map(v => ({ id: v.id, error: v.error }))
  const good = visits.filter(v => !v.error)
  let saved = 0
  if (good.length) {
    await withTenant(device.tenant_id, async tx => {
      const designIds = [...new Set(good.map(v => v.design_id).filter(Boolean))]
      const streamIds = [...new Set(good.map(v => v.stream_id).filter(Boolean))]
      const [designs, streams] = await Promise.all([
        designIds.length ? tx`SELECT id FROM kiosk_designs WHERE tenant_id = ${device.tenant_id} AND id = ANY(${designIds}::uuid[])` : [],
        streamIds.length ? tx`SELECT id FROM pos_revenue_streams WHERE tenant_id = ${device.tenant_id} AND venue_id = ${device.venue_id} AND id = ANY(${streamIds}::uuid[])` : [],
      ])
      const okDesign = new Set(designs.map(r => r.id))
      const okStream = new Set(streams.map(r => r.id))
      for (const v of good) {
        const s = summariseJourney(v.events, { names: v.names })
        const rows = await tx`
          INSERT INTO kiosk_sessions (
            tenant_id, id, venue_id, device_id, design_id, revenue_stream_id, started_at, ended_at, duration_ms,
            outcome, furthest, last_screen, order_no, check_id, total_pence, basket_value_pence, items_added,
            taps, dead_taps, lang, event_count, truncated, summary, names, viewport, config_version, app_version, events)
          VALUES (
            ${device.tenant_id}, ${v.id}, ${device.venue_id}, ${device.id},
            ${okDesign.has(v.design_id) ? v.design_id : null}, ${okStream.has(v.stream_id) ? v.stream_id : null},
            ${v.started_at}, ${v.ended_at}, ${s.duration_ms},
            ${s.outcome}, ${s.furthest}, ${s.last_screen}, ${s.order ? String(s.order.order_no ?? s.order.provisional ?? '').slice(0, 40) || null : null},
            ${s.order?.check_id ? String(s.order.check_id).slice(0, 60) : null}, ${s.order?.total ?? null},
            ${int(s.basket_value, 0, 1e9)}, ${s.items_added}, ${s.taps}, ${s.dead_taps}, ${s.lang ? String(s.lang).slice(0, 10) : null},
            ${v.events.length}, ${v.truncated}, ${tx.json(s)}, ${tx.json(v.names)}, ${v.viewport ? tx.json(v.viewport) : null},
            ${v.config_version}, ${v.app_version}, ${tx.json(v.events)})
          ON CONFLICT (tenant_id, id) DO NOTHING
          RETURNING id`
        saved += rows.length
      }
    })
  }
  return { accepted: visits.map(v => v.id).filter(Boolean), saved, refused }
}

/** Hourly (jobs/queues.js): playbacks go after 90 days, the visits after 400. */
export async function cleanUpJourneys(log) {
  try {
    const cleared = await systemSql`
      UPDATE kiosk_sessions SET events = NULL, events_cleared_at = now()
       WHERE events IS NOT NULL AND started_at < now() - interval '90 days'
      RETURNING id`
    const removed = await systemSql`DELETE FROM kiosk_sessions WHERE started_at < now() - interval '400 days' RETURNING id`
    return { cleared: cleared.length, removed: removed.length }
  } catch (err) {
    log?.warn({ err }, 'Kiosk journey clean-up failed')
    return { cleared: 0, removed: 0 }
  }
}
