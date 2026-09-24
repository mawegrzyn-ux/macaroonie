// src/routes/dashboardTiles.js
//
// The Overview page's tile layout (migration 093): one implicit layout per
// tenant — unlike hs_dashboards there's no multiple-named-dashboards
// concept, Overview is tenant-wide, not per-venue. Layout control
// (col_span/height_px/sort_order) mirrors hs_dashboard_widgets; per-role
// visibility (hidden_role_ids) mirrors nav_items. Mounted at
// /api/dashboard-tiles in app.js. Gated by the existing `dashboard`
// module — no new module needed.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { periodStartFor, mondayOf, monthStartOf } from '../utils/checklistPeriod.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Every tile type the Overview page knows how to render, so the "Add
// tile" picker only ever offers real, known tiles — same idea as the nav
// designer's ROUTE_CATALOG.
export const TILE_CATALOG = [
  { tile_type: 'quick_access',      label: 'Quick access shortcuts', icon: 'LayoutGrid',    default_col_span: 4, default_height_px: 200 },
  { tile_type: 'stats_today',       label: "Today's stats",          icon: 'BarChart3',      default_col_span: 4, default_height_px: 180 },
  { tile_type: 'upcoming_bookings', label: 'Upcoming bookings',      icon: 'CalendarClock',  default_col_span: 2, default_height_px: 420 },
  { tile_type: 'venues_status',     label: 'Venues status',          icon: 'Building2',      default_col_span: 2, default_height_px: 280 },
  { tile_type: 'hs_today_status',   label: 'H&S checks today',       icon: 'ShieldCheck',    default_col_span: 2, default_height_px: 240 },
  { tile_type: 'hs_week_status',    label: "Week's H&S status",      icon: 'CalendarCheck',  default_col_span: 2, default_height_px: 240 },
]
const TILE_TYPES = TILE_CATALOG.map(t => t.tile_type)

const TileBody = z.object({
  tile_type:  z.enum(TILE_TYPES),
  col_span:   z.number().int().min(1).max(4).optional(),
  height_px:  z.number().int().min(120).max(1200).optional(),
})
const TilePatch = z.object({
  title_override:  z.string().max(100).nullable().optional(),
  hidden_role_ids: z.array(z.string().uuid()).optional(),
  col_span:        z.number().int().min(1).max(4).optional(),
  height_px:       z.number().int().min(120).max(1200).optional(),
})

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dateRange(from, to) {
  const dates = []
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)
  return dates
}

function deriveStatus(expected, completed, unresolved) {
  if (unresolved > 0) return 'red'
  if (expected === 0) return 'grey'
  if (completed >= expected) return 'green'
  if (completed > 0) return 'amber'
  return 'red'
}

// Combined Checklists + Food safety status per venue per day, for the
// hs_today_status / hs_week_status tiles. "Expected" is standing
// configuration (active checklist templates, equipment x capture times,
// hold stations x capture times, cooking sessions' required counts) —
// it doesn't vary by date, so future dates always compute a real
// expected/completed pair; the caller overrides status to 'upcoming' for
// any date after `today`.
async function computeHsStatus(tx, tenantId, from, to, today) {
  const venues = await tx`SELECT id, name FROM venues WHERE tenant_id = ${tenantId} AND is_active = true ORDER BY name`

  const templates = await tx`
    SELECT id, venue_id, name, frequency FROM checklist_templates
     WHERE tenant_id = ${tenantId} AND is_active = true
  `
  const minPeriodStart = [mondayOf(from), monthStartOf(from), from].sort()[0]
  const instances = await tx`
    SELECT template_id, period_start::text AS period_start, status FROM checklist_instances
     WHERE tenant_id = ${tenantId} AND period_start >= ${minPeriodStart} AND period_start <= ${to}
  `
  const instanceMap = new Map(instances.map(i => [`${i.template_id}|${i.period_start}`, i.status]))

  const equipment    = await tx`SELECT id, venue_id FROM fs_equipment WHERE tenant_id = ${tenantId} AND is_active = true`
  const captureTimes = await tx`SELECT id, venue_id FROM fs_capture_times WHERE tenant_id = ${tenantId} AND is_active = true`
  const tempLogs      = await tx`
    SELECT venue_id, log_date::text AS log_date, equipment_id, capture_time_id, is_within_range, corrective_action
      FROM fs_temp_logs WHERE tenant_id = ${tenantId} AND log_date BETWEEN ${from} AND ${to}
  `

  const holdStations     = await tx`SELECT id, venue_id FROM fs_hold_stations WHERE tenant_id = ${tenantId} AND is_active = true`
  const holdCaptureTimes = await tx`SELECT id, venue_id FROM fs_hold_capture_times WHERE tenant_id = ${tenantId} AND is_active = true`
  const holdChecks        = await tx`
    SELECT venue_id, check_date::text AS check_date, station_id, capture_time_id, is_within_range, corrective_action
      FROM fs_hold_checks WHERE tenant_id = ${tenantId} AND check_date BETWEEN ${from} AND ${to}
  `

  const cookingSessions = await tx`SELECT id, venue_id, required_items_count FROM fs_cooking_sessions WHERE tenant_id = ${tenantId} AND is_active = true`
  const cookingChecks    = await tx`
    SELECT venue_id, check_date::text AS check_date, session_id, is_within_range, corrective_action
      FROM fs_cooking_checks WHERE tenant_id = ${tenantId} AND check_date BETWEEN ${from} AND ${to}
  `

  const byVenue = (rows) => {
    const m = new Map()
    for (const r of rows) {
      if (!m.has(r.venue_id)) m.set(r.venue_id, [])
      m.get(r.venue_id).push(r)
    }
    return m
  }
  const templatesByVenue    = byVenue(templates)
  const equipmentByVenue    = byVenue(equipment)
  const captureTimesByVenue = byVenue(captureTimes)
  const holdStationsByVenue = byVenue(holdStations)
  const holdCaptureByVenue  = byVenue(holdCaptureTimes)
  const sessionsByVenue     = byVenue(cookingSessions)

  const days = dateRange(from, to).map(date => {
    const isUpcoming = date > today
    const venueResults = venues.map(v => {
      const vTemplates = templatesByVenue.get(v.id) ?? []
      const checklistExpected = vTemplates.length
      const checklistBreakdown = vTemplates.map(t => ({
        id: t.id,
        name: t.name,
        frequency: t.frequency,
        completed: instanceMap.get(`${t.id}|${periodStartFor(t.frequency, date)}`) === 'completed',
      }))
      const checklistCompleted = checklistBreakdown.filter(c => c.completed).length

      const vEquip = equipmentByVenue.get(v.id) ?? []
      const vCaptures = captureTimesByVenue.get(v.id) ?? []
      const equipExpected = vEquip.length * vCaptures.length
      const dayTempLogs = tempLogs.filter(l => l.venue_id === v.id && l.log_date === date)
      const equipCompleted = new Set(
        dayTempLogs.filter(l => l.capture_time_id).map(l => `${l.equipment_id}|${l.capture_time_id}`)
      ).size
      const equipUnresolved = dayTempLogs.filter(l => l.is_within_range === false && !l.corrective_action).length

      const vStations = holdStationsByVenue.get(v.id) ?? []
      const vHoldCaptures = holdCaptureByVenue.get(v.id) ?? []
      const holdExpected = vStations.length * vHoldCaptures.length
      const dayHoldChecks = holdChecks.filter(h => h.venue_id === v.id && h.check_date === date)
      const holdCompleted = new Set(
        dayHoldChecks.filter(h => h.capture_time_id).map(h => `${h.station_id}|${h.capture_time_id}`)
      ).size
      const holdUnresolved = dayHoldChecks.filter(h => h.is_within_range === false && !h.corrective_action).length

      const vSessions = sessionsByVenue.get(v.id) ?? []
      const cookingExpected = vSessions.reduce((s, sess) => s + sess.required_items_count, 0)
      const dayCookingChecks = cookingChecks.filter(c => c.venue_id === v.id && c.check_date === date)
      const cookingCompleted = vSessions.reduce((sum, sess) => {
        const count = dayCookingChecks.filter(c => c.session_id === sess.id).length
        return sum + Math.min(count, sess.required_items_count)
      }, 0)
      const cookingUnresolved = dayCookingChecks.filter(c => c.is_within_range === false && !c.corrective_action).length

      const expected  = checklistExpected + equipExpected + holdExpected + cookingExpected
      const completed = checklistCompleted + equipCompleted + holdCompleted + cookingCompleted
      const unresolved = equipUnresolved + holdUnresolved + cookingUnresolved
      const status = isUpcoming ? 'upcoming' : deriveStatus(expected, completed, unresolved)

      // Per-check-type breakdown for the hs_today_status tile's expanded
      // view — checklists individually (they only have a done/not-done
      // state, no "unresolved" concept), the other three check types as
      // one aggregate line each (their own individual readings are too
      // granular for a small tile — see Equipment/Holds/Cooking pages for
      // that level of detail).
      const categories = [
        equipExpected > 0 && {
          key: 'equipment', label: 'Fridge/freezer checks',
          expected: equipExpected, completed: equipCompleted, unresolved: equipUnresolved,
          status: isUpcoming ? 'upcoming' : deriveStatus(equipExpected, equipCompleted, equipUnresolved),
        },
        holdExpected > 0 && {
          key: 'hold', label: 'Hot/cold hold checks',
          expected: holdExpected, completed: holdCompleted, unresolved: holdUnresolved,
          status: isUpcoming ? 'upcoming' : deriveStatus(holdExpected, holdCompleted, holdUnresolved),
        },
        cookingExpected > 0 && {
          key: 'cooking', label: 'Cooking checks',
          expected: cookingExpected, completed: cookingCompleted, unresolved: cookingUnresolved,
          status: isUpcoming ? 'upcoming' : deriveStatus(cookingExpected, cookingCompleted, cookingUnresolved),
        },
      ].filter(Boolean)

      return {
        venue_id: v.id, venue_name: v.name, status, expected, completed, unresolved,
        checklists: checklistBreakdown, categories,
      }
    })

    const expected   = venueResults.reduce((s, v) => s + v.expected, 0)
    const completed  = venueResults.reduce((s, v) => s + v.completed, 0)
    const unresolved = venueResults.reduce((s, v) => s + v.unresolved, 0)
    const status = isUpcoming ? 'upcoming' : deriveStatus(expected, completed, unresolved)

    return { date, status, expected, completed, unresolved, venues: venueResults }
  })

  return { venues, days }
}

export default async function dashboardTilesRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/catalog', { preHandler: requirePermission('dashboard', 'view') }, async () => TILE_CATALOG)

  app.get('/', { preHandler: requirePermission('dashboard', 'manage') }, async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT * FROM dashboard_tiles WHERE tenant_id = ${req.tenantId} ORDER BY sort_order
    `)
  })

  app.post('/', { preHandler: requirePermission('dashboard', 'manage') }, async (req) => {
    const body = TileBody.parse(req.body)
    const meta = TILE_CATALOG.find(t => t.tile_type === body.tile_type)

    return withTenant(req.tenantId, async tx => {
      const [existing] = await tx`
        SELECT id FROM dashboard_tiles WHERE tenant_id = ${req.tenantId} AND tile_type = ${body.tile_type}
      `
      if (existing) throw httpError(422, 'That tile is already on the Overview page')

      const [{ max_sort }] = await tx`
        SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM dashboard_tiles WHERE tenant_id = ${req.tenantId}
      `
      const [row] = await tx`
        INSERT INTO dashboard_tiles (tenant_id, tile_type, col_span, height_px, sort_order)
        VALUES (${req.tenantId}, ${body.tile_type},
                ${body.col_span ?? meta.default_col_span}, ${body.height_px ?? meta.default_height_px},
                ${max_sort + 1})
        RETURNING *
      `
      return row
    })
  })

  // Must be registered before /:id.
  app.patch('/reorder', { preHandler: requirePermission('dashboard', 'manage') }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      const owned = await tx`SELECT id FROM dashboard_tiles WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${req.tenantId}`
      if (owned.length !== ids.length) throw httpError(404, 'One or more tiles not found')
      for (let i = 0; i < ids.length; i++) {
        await tx`UPDATE dashboard_tiles SET sort_order = ${i}, updated_at = now() WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  app.patch('/:id', { preHandler: requirePermission('dashboard', 'manage') }, async (req) => {
    const body = TilePatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE dashboard_tiles
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Tile not found')
    return row
  })

  app.delete('/:id', { preHandler: requirePermission('dashboard', 'manage') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM dashboard_tiles WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id
    `)
    if (!row) throw httpError(404, 'Tile not found')
    return { ok: true }
  })

  app.get('/hs-status', { preHandler: requirePermission('dashboard', 'view') }, async (req) => {
    const { from, to, today } = z.object({
      from:  z.string().regex(DATE_RE),
      to:    z.string().regex(DATE_RE),
      today: z.string().regex(DATE_RE).optional(),
    }).parse(req.query)
    if (from > to) throw httpError(400, 'from must be <= to')

    const effectiveToday = today ?? new Date().toISOString().slice(0, 10)
    return withTenant(req.tenantId, tx => computeHsStatus(tx, req.tenantId, from, to, effectiveToday))
  })
}
