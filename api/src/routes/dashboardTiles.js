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
import { computeHsStatus } from '../services/hsStatus.js'

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
  { tile_type: 'allergen_lookup',   label: 'Allergen lookup',        icon: 'Grid3x3',        default_col_span: 2, default_height_px: 480 },
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
