// src/routes/kioskAnalytics.js
//
// Kiosk analytics (migration 208, /api/pos/kiosk-analytics): guests' visits
// to a venue's self-order kiosks, recorded on the kiosks
// (pos/src/kiosk/journey.js) and summed up on arrival
// (services/kioskJourneySvc.js). Till reports view (pos_reports). Every query
// filters tenant_id itself.
//
//   GET /venues/:venueId?from=&to=&device_id=&design_id=
//        the report for the days (venue time): aggregateJourneys() of the
//        visits (shared/kioskJourney.js), the venue's kiosks and designs
//   GET /venues/:venueId/sessions?from=&to=&device_id=&design_id=&outcome=&limit=&offset=
//        the visits, newest first (no events)
//   GET /sessions/:id
//        one visit: its events, names and summary, and a link that plays it
//        back on the kiosk mock-up (a kiosk preview link with &replay=1, the
//        visit's design at its venue), or why it can't be (cleared after 90
//        days, the design deleted)

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { aggregateJourneys, OUTCOMES } from '../../../shared/kioskJourney.js'
import { ownVenue } from '../services/posSvc.js'
import { previewToken } from '../services/kioskSvc.js'
import { deviceOrigin } from '../services/platformHost.js'

const canReports = requirePermission('pos_reports', 'view')
const UUID = z.string().uuid()
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const ULID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
const MAX_DAYS = 92
const MAX_ROWS = 20000

const Range = z.object({
  from: DATE,
  to: DATE,
  device_id: UUID.optional(),
  design_id: UUID.optional(),
})

async function rangeOf(tx, req, extra = {}) {
  const venueId = UUID.parse(req.params.venueId)
  const q = Range.extend(extra).parse(req.query)
  if (q.to < q.from) throw httpError(422, 'The end date is before the start date')
  const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 + 1
  if (days > MAX_DAYS) throw httpError(422, 'Pick at most ' + MAX_DAYS + ' days')
  const venue = await ownVenue(tx, req.tenantId, venueId)
  const tz = venue.timezone || 'Europe/London'
  const where = tx`s.tenant_id = ${req.tenantId} AND s.venue_id = ${venueId}
    AND s.started_at >= (${q.from}::date)::timestamp AT TIME ZONE ${tz}
    AND s.started_at < ((${q.to}::date) + 1)::timestamp AT TIME ZONE ${tz}
    ${q.device_id ? tx`AND s.device_id = ${q.device_id}` : tx``}
    ${q.design_id ? tx`AND s.design_id = ${q.design_id}` : tx``}`
  return { venueId, venue, tz, q, where }
}

function sessionView(r) {
  return {
    id: r.id, venue_id: r.venue_id, device_id: r.device_id, device_name: r.device_name ?? null, design_id: r.design_id,
    design_name: r.design_name ?? null, revenue_stream_id: r.revenue_stream_id,
    started_at: r.started_at, ended_at: r.ended_at, duration_ms: r.duration_ms, outcome: r.outcome,
    furthest: r.furthest, last_screen: r.last_screen, order_no: r.order_no, check_id: r.check_id,
    total_pence: r.total_pence, basket_value_pence: r.basket_value_pence, items_added: r.items_added,
    taps: r.taps, dead_taps: r.dead_taps, lang: r.lang, event_count: r.event_count, truncated: r.truncated,
    has_events: r.has_events ?? r.events != null, events_cleared_at: r.events_cleared_at,
  }
}

export default async function kioskAnalyticsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/venues/:venueId', { preHandler: canReports }, async req => {
    return withTenant(req.tenantId, async tx => {
      const { venueId, tz, q, where } = await rangeOf(tx, req)
      const [rows, devices, designs] = await Promise.all([
        tx`
          SELECT s.summary, s.outcome, s.duration_ms, s.total_pence, s.basket_value_pence, s.device_id, s.names,
                 extract(hour FROM s.started_at AT TIME ZONE ${tz})::int AS hour
            FROM kiosk_sessions s
           WHERE ${where}
           ORDER BY s.started_at DESC
           LIMIT ${MAX_ROWS + 1}`,
        tx`
          SELECT d.id, d.name, d.short_code, d.revoked_at
            FROM pos_devices d
           WHERE d.tenant_id = ${req.tenantId} AND d.venue_id = ${venueId} AND d.kind = 'kiosk'
             AND (d.revoked_at IS NULL OR EXISTS (SELECT 1 FROM kiosk_sessions s WHERE s.tenant_id = d.tenant_id AND s.device_id = d.id))
           ORDER BY d.name`,
        tx`SELECT id, name FROM kiosk_designs WHERE tenant_id = ${req.tenantId} ORDER BY name`,
      ])
      const truncated = rows.length > MAX_ROWS
      const overview = aggregateJourneys(truncated ? rows.slice(0, MAX_ROWS) : rows)
      return { from: q.from, to: q.to, timezone: tz, truncated, devices, designs, overview }
    })
  })

  app.get('/venues/:venueId/sessions', { preHandler: canReports }, async req => {
    return withTenant(req.tenantId, async tx => {
      const extra = {
        outcome: z.enum(OUTCOMES).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      }
      const { q, where } = await rangeOf(tx, req, extra)
      const filter = q.outcome ? tx`AND s.outcome = ${q.outcome}` : tx``
      // The total from the same statement as the page, so the two always
      // agree while visits are arriving.
      const rows = await tx`
          SELECT count(*) OVER () AS full_count,
                 s.id, s.venue_id, s.device_id, d.name AS device_name, s.design_id, k.name AS design_name, s.revenue_stream_id,
                 s.started_at, s.ended_at, s.duration_ms, s.outcome, s.furthest, s.last_screen, s.order_no, s.check_id,
                 s.total_pence, s.basket_value_pence, s.items_added, s.taps, s.dead_taps, s.lang, s.event_count, s.truncated,
                 (s.events IS NOT NULL) AS has_events, s.events_cleared_at
            FROM kiosk_sessions s
            LEFT JOIN pos_devices d ON d.id = s.device_id AND d.tenant_id = s.tenant_id
            LEFT JOIN kiosk_designs k ON k.id = s.design_id AND k.tenant_id = s.tenant_id
           WHERE ${where} ${filter}
           ORDER BY s.started_at DESC
           LIMIT ${q.limit} OFFSET ${q.offset}`
      const total = rows.length ? Number(rows[0].full_count)
        : q.offset ? (await tx`SELECT count(*)::int AS n FROM kiosk_sessions s WHERE ${where} ${filter}`)[0].n : 0
      return { sessions: rows.map(sessionView), total, limit: q.limit, offset: q.offset }
    })
  })

  app.get('/sessions/:id', { preHandler: canReports }, async req => {
    const id = ULID.parse(req.params.id)
    const r = await withTenant(req.tenantId, async tx => {
      const [row] = await tx`
        SELECT s.*, d.name AS device_name, d.settings AS device_settings, k.name AS design_name, k.updated_at AS design_updated_at,
               v.name AS venue_name, v.timezone
          FROM kiosk_sessions s
          JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
          LEFT JOIN pos_devices d ON d.id = s.device_id AND d.tenant_id = s.tenant_id
          LEFT JOIN kiosk_designs k ON k.id = s.design_id AND k.tenant_id = s.tenant_id
         WHERE s.tenant_id = ${req.tenantId} AND s.id = ${id}`
      if (!row) throw httpError(404, 'Visit not found')
      // Played back with the visit's design; one deleted since: the kiosk's
      // design now, else none (a playback needs a design to draw).
      let designId = row.design_name ? row.design_id : null
      let designName = row.design_name
      if (!designId && row.device_settings?.design_id) {
        const [k] = await tx`SELECT id, name FROM kiosk_designs WHERE tenant_id = ${req.tenantId} AND id = ${row.device_settings.design_id}`
        if (k) { designId = k.id; designName = k.name }
      }
      return { row, designId, designName }
    })
    const { row, designId, designName } = r
    const notes = []
    let replay = null
    if (!row.events) notes.push('This visit is older than 90 days: its summary is kept, the playback isn\'t.')
    else if (!designId) notes.push('The design this kiosk used has been deleted, so the visit can\'t be played back.')
    else {
      if (designId !== row.design_id) notes.push('The visit\'s own design has been deleted: it plays back with ' + designName + '.')
      else if (row.design_updated_at && new Date(row.design_updated_at) > new Date(row.started_at)) notes.push('The design has changed since this visit: it plays back with the design as it is now.')
      notes.push('Dishes and prices show as the menu is now.')
      const token = await previewToken({ tenantId: req.tenantId, venueId: row.venue_id, designId, streamId: row.revenue_stream_id || null, menu: 'live' })
      replay = { url: deviceOrigin('kiosk') + '/?kiosk_preview=' + encodeURIComponent(token) + '&replay=1', design_id: designId, design_name: designName }
    }
    return {
      session: { ...sessionView(row), device_name: row.device_name, design_name: row.design_name, venue_name: row.venue_name, timezone: row.timezone },
      summary: row.summary,
      names: row.names || {},
      viewport: row.viewport,
      events: row.events || [],
      replay,
      notes,
    }
  })
}
