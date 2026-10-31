// src/routes/menuTimes.js
//
// Menu times (migration 230, shared/menuTimes.js), mounted at /api/menu-times:
// one table per venue of when each menu is on, for the website (online
// ordering), the self-order kiosks and the tills. Reads need Menus view,
// saves Menus manage.
//
//   GET /venues/:venueId   { venue, menus, rows, ordering, streams, devices, warnings }
//                          rows: one per menu the venue can use (shared ones and its
//                          own), with the usual cells filled in; web.use 'off' when
//                          the menu isn't online (ordering_settings.menu_ids)
//   PUT /venues/:venueId   { rows: [{ menu_id, times, web, kiosk, till }] } the rows
//                          sent (others left alone); problems 422; a row that says
//                          nothing beyond the usual is removed. The web cells write
//                          which menus are online (menu_ids: kept in their order,
//                          new ones added after). Tills and kiosks are told.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { broadcast }  from '../config/ws.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { localParts } from '../services/orderSvc.js'
import { loadMenuTimes } from '../services/menuTimesSvc.js'
import { MenuSchedule } from './orders.js'
import {
  cleanRow, cleanCell, isDefaultRow, menuTimesProblems, menuTimesWarnings,
} from '../../../shared/menuTimes.js'

const UUID = z.string().uuid()
// The most menus online at once (Ordering setup's limit before migration 230).
const MAX_ONLINE = 20

const Cell = z.object({
  use:   z.enum(['off', 'menu', 'always', 'own']),
  times: MenuSchedule.nullable().optional(),
})
const RowBody = z.object({
  menu_id: UUID,
  times:   MenuSchedule.nullable().optional(),
  web:     Cell.optional(),
  kiosk:   Cell.optional(),
  till:    Cell.optional(),
})
const SaveBody = z.object({ rows: z.array(RowBody).max(200) })

const by = req => req.user?.email || req.user?.sub || null

async function ownVenue(tx, tenantId, venueId) {
  if (!UUID.safeParse(venueId).success) throw httpError(404, 'Venue not found')
  const [v] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

/** The menus a venue can use: the company's shared ones and its own. */
async function venueMenus(tx, tenantId, venueId) {
  const menus = await tx`
    SELECT m.id, m.name, m.venue_id, m.is_published,
           EXISTS (SELECT 1 FROM menu_releases r
                    WHERE r.menu_id = m.id AND r.tenant_id = m.tenant_id
                      AND r.cancelled_at IS NULL AND r.goes_live_at <= now()) AS live
      FROM menus m
     WHERE m.tenant_id = ${tenantId} AND (m.venue_id IS NULL OR m.venue_id = ${venueId})
     ORDER BY m.sort_order, m.name`
  return menus
}

/** Everything the page shows for a venue. */
async function view(tx, tenantId, venue) {
  const [menus, stored, [ordering], streams, devices] = await Promise.all([
    venueMenus(tx, tenantId, venue.id),
    loadMenuTimes(tx, tenantId, venue.id),
    tx`SELECT is_enabled, menu_ids FROM ordering_settings WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id}`,
    tx`SELECT id, name, menu_ids FROM pos_revenue_streams
        WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id} AND is_active ORDER BY sort_order, name`,
    tx`SELECT kind, count(*)::int AS n FROM pos_devices
        WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id} AND revoked_at IS NULL AND kind IN ('terminal', 'kiosk')
        GROUP BY kind`,
  ])
  const online = new Set(ordering?.menu_ids || [])
  const rows = menus.map(m => {
    const r = cleanRow({ menu_id: m.id, ...(stored[m.id] || {}) })
    if (!online.has(m.id)) r.web = { ...r.web, use: 'off' }
    return { ...r, updated_at: stored[m.id]?.updated_at || null, updated_by: stored[m.id]?.updated_by || null }
  })
  const names = Object.fromEntries(menus.map(m => [m.id, m.name]))
  const today = localParts(new Date(), venue.timezone || 'Europe/London').date
  return {
    venue: { id: venue.id, name: venue.name, timezone: venue.timezone || 'Europe/London' },
    menus: menus.map(m => ({ id: m.id, name: m.name, own: !!m.venue_id, is_published: m.is_published, live: m.live })),
    rows,
    ordering: { exists: !!ordering, is_enabled: !!ordering?.is_enabled },
    streams: streams.map(s => ({ id: s.id, name: s.name, menu_ids: s.menu_ids || [] })),
    devices: Object.fromEntries(devices.map(d => [d.kind === 'terminal' ? 'till' : 'kiosk', d.n])),
    warnings: menuTimesWarnings(rows, names, today),
  }
}

export default async function menuTimesRoutes(app) {
  app.addHook('preHandler', requireAuth)
  const canView = requirePermission('menus', 'view')
  const canManage = requirePermission('menus', 'manage')

  app.get('/venues/:venueId', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const venue = await ownVenue(tx, req.tenantId, req.params.venueId)
    return view(tx, req.tenantId, venue)
  }))

  app.put('/venues/:venueId', { preHandler: canManage }, async req => {
    const b = SaveBody.parse(req.body)
    const out = await withTenant(req.tenantId, async tx => {
      const venue = await ownVenue(tx, req.tenantId, req.params.venueId)
      const menus = await venueMenus(tx, req.tenantId, venue.id)
      const listed = new Map(menus.map(m => [m.id, m]))
      const seen = new Set()
      const rows = []
      for (const raw of b.rows) {
        if (!listed.has(raw.menu_id)) throw httpError(422, 'A menu wasn\'t found at this venue')
        if (seen.has(raw.menu_id)) throw httpError(400, 'A menu is in the list twice')
        seen.add(raw.menu_id)
        rows.push(cleanRow(raw))
      }
      const names = Object.fromEntries(menus.map(m => [m.id, m.name]))
      const problems = menuTimesProblems(rows, names)
      if (problems.length) throw httpError(422, problems[0].message, { code: 'menu_times', problems })

      // Which menus are online: the ones already there that stay on, in their
      // order (ids this venue can't use any more dropped), then the new ones.
      const [ordering] = await tx`SELECT menu_ids FROM ordering_settings WHERE tenant_id = ${req.tenantId} AND venue_id = ${venue.id}`
      const current = (ordering?.menu_ids || []).filter(id => listed.has(id))
      const webOf = new Map(rows.map(r => [r.menu_id, r.web.use]))
      const stays = current.filter(id => !webOf.has(id) || webOf.get(id) !== 'off')
      const added = rows.filter(r => r.web.use !== 'off' && !stays.includes(r.menu_id)).map(r => r.menu_id)
      const onlineIds = [...stays, ...added]
      if (onlineIds.length > MAX_ONLINE) throw httpError(422, `At most ${MAX_ONLINE} menus can be online at a venue`)

      const stored = await loadMenuTimes(tx, req.tenantId, venue.id)
      for (const r of rows) {
        // A website cell is never stored off (menu_ids says that): switched
        // off, it keeps what it said before, for when it goes back online.
        const web = r.web.use === 'off' ? cleanCell(stored[r.menu_id]?.web) : r.web
        const keepWeb = web.use === 'off' ? { use: 'menu', times: null } : web
        if (isDefaultRow({ ...r, web: keepWeb })) {
          await tx`DELETE FROM menu_times WHERE tenant_id = ${req.tenantId} AND venue_id = ${venue.id} AND menu_id = ${r.menu_id}`
          continue
        }
        await tx`
          INSERT INTO menu_times (tenant_id, venue_id, menu_id, times, web, kiosk, till, updated_at, updated_by)
          VALUES (${req.tenantId}, ${venue.id}, ${r.menu_id}, ${r.times ? tx.json(r.times) : null},
                  ${tx.json(keepWeb)}, ${tx.json(r.kiosk)}, ${tx.json(r.till)}, now(), ${by(req)})
          ON CONFLICT (venue_id, menu_id) DO UPDATE SET
            times = EXCLUDED.times, web = EXCLUDED.web, kiosk = EXCLUDED.kiosk, till = EXCLUDED.till,
            updated_at = now(), updated_by = EXCLUDED.updated_by`
      }

      const before = (ordering?.menu_ids || []).join(',')
      if (onlineIds.join(',') !== before) {
        await tx`
          INSERT INTO ordering_settings (venue_id, tenant_id, menu_ids)
          VALUES (${venue.id}, ${req.tenantId}, ${onlineIds}::uuid[])
          ON CONFLICT (venue_id) DO UPDATE SET menu_ids = EXCLUDED.menu_ids, updated_at = now()`
      }
      return view(tx, req.tenantId, venue)
    })
    // Tills and kiosks download their config again (their menus' times are in it).
    broadcast('pos:' + req.params.venueId, { type: 'pos.config' })
    return out
  })
}


