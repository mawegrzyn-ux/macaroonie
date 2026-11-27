// src/routes/menuMargins.js
//
// Menu margins (inventory phase 2; docs/INVENTORY.md 8.2), mounted at
// /api/menu-margins, for the Menu margins page and Pepper's menu_margins.
// Every dish of a menu at a venue, an optional revenue stream of it and an
// order type: its price there (the menu's: a dish has one price, and only its
// VAT changes with where and how it is sold), net of VAT (taxFor()), its cost
// (dishCost(): the recipe the links pick there, times its portions), GP and
// cost %, banded against the group's targets; priced options with their own
// margin, meal deals with the range their picks give. Worked out by
// menuMargins() in shared/costing.js on every read: nothing is stored.
//
//   GET  /            ?menu_id &venue_id &revenue_stream_id &order_type_id
//                     &version (live, the default: what is sold; draft: the
//                     menu as it is being edited)   the choices, and with a
//                     menu its rows, uncosted dishes first in `uncosted`
//   GET  /settings    the target and limit cost %, with sections' own
//   PUT  /settings    { target_pct, limit_pct, sections: [{ section_id,
//                     target_pct, limit_pct }] } the whole of it (rule 13)
//
// Reading needs Costing view (a cost tells what suppliers charge); the
// targets need Costing manage. Ids are the group's (rule 4): the menu, the
// venue, the stream (its venue's), the order type, the sections.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { loadMenuVersion } from '../services/menuReleases.js'
import { loadDishCosting, loadScopes, loadCostingSettings } from '../services/dishCostSvc.js'
import { loadTaxRates } from '../services/taxSvc.js'
import { menuMargins, thresholdProblem, scopeText } from '../../../shared/costing.js'
import { resolveItemTypes } from '../../../shared/catalogue.js'

const uuid = z.string().uuid()
const Query = z.object({
  menu_id: uuid.optional(), venue_id: uuid.optional(), revenue_stream_id: uuid.optional(), order_type_id: uuid.optional(),
  version: z.enum(['live', 'draft']).optional(),
})
const Pct = z.number().gt(0).lt(100)
export const SettingsBody = z.object({
  target_pct: Pct,
  limit_pct:  Pct,
  sections:   z.array(z.object({ section_id: uuid, target_pct: Pct, limit_pct: Pct }).strict()).max(500),
}).strict()

const canView = requirePermission('costing', 'view')
const canManage = requirePermission('costing', 'manage')
const who = req => req.user?.email ?? req.user?.sub ?? null

/** The choices the page offers: menus, venues with their streams, order types. */
async function choices(tx, tenantId, scopes) {
  const menus = await tx`
    SELECT m.id, m.name, m.venue_id, EXISTS (SELECT 1 FROM menu_releases r WHERE r.menu_id = m.id AND r.tenant_id = m.tenant_id AND r.cancelled_at IS NULL AND r.goes_live_at <= now()) AS live
      FROM menus m WHERE m.tenant_id = ${tenantId} ORDER BY m.sort_order, m.name`
  return {
    menus,
    venues: scopes.venues.filter(v => v.is_active).map(v => ({
      id: v.id, name: v.name,
      streams: scopes.streams.filter(s => s.venue_id === v.id && s.is_active).map(s => ({ id: s.id, name: s.name })),
    })),
    order_types: scopes.types.filter(t => t.is_active).map(t => ({ id: t.id, name: t.name })),
  }
}

export default async function menuMarginRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', { preHandler: canView }, async req => {
    const q = Query.parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const scopes = await loadScopes(tx, req.tenantId)
      const offered = await choices(tx, req.tenantId, scopes)
      const settings = await loadCostingSettings(tx, req.tenantId)
      const out = { choices: offered, settings }
      if (!q.menu_id) return out
      if (!offered.menus.some(m => m.id === q.menu_id)) throw httpError(404, 'Menu not found')
      const venue = q.venue_id ? scopes.venues.find(v => v.id === q.venue_id) : null
      if (q.venue_id && !venue) throw httpError(404, 'Venue not found')
      const stream = q.revenue_stream_id ? scopes.streams.find(s => s.id === q.revenue_stream_id) : null
      if (q.revenue_stream_id && !stream) throw httpError(404, 'Revenue stream not found')
      if (stream && venue && stream.venue_id !== venue.id) throw httpError(422, stream.name + ' is another venue\'s revenue stream', { code: 'stream_venue' })
      if (q.order_type_id && !scopes.types.some(t => t.id === q.order_type_id)) throw httpError(404, 'Order type not found')
      const version = q.version || 'live'
      const loaded = await loadMenuVersion(tx, q.menu_id, req.tenantId, { version })
      if (!loaded) {
        return { ...out, menu: { id: q.menu_id, version, missing: true }, rows: [], uncosted: [], message: 'This menu has nothing live yet: publish it, or look at the draft.' }
      }
      const menu = resolveItemTypes(loaded)
      const scope = { venue_id: stream?.venue_id || venue?.id || null, revenue_stream_id: stream?.id || null, order_type_id: q.order_type_id || null }
      const [ctx, rates] = await Promise.all([loadDishCosting(tx, req.tenantId, scope.venue_id, { menus: [] }), loadTaxRates(tx, req.tenantId)])
      const rows = menuMargins(menu, scope, ctx, { rates, settings })
      const uncosted = rows.filter(r => r.coverage === 'none').map(r => ({ dish_id: r.dish_id, name: r.name, section: r.section, kind: r.kind, fix: r.gaps[0]?.fix ?? null, text: r.gaps[0]?.text ?? null, goods_item: r.goods_item }))
      return {
        ...out,
        menu: { id: menu.id, name: menu.name, version, venue_id: menu.venue_id ?? null, release_goes_live_at: menu.release_goes_live_at ?? null },
        scope, where: scopeText(scope, ctx.names),
        sections: (menu.sections || []).map(s => ({ id: s.id, title: s.title })),
        rows, uncosted,
        counts: {
          dishes: rows.length, costed: rows.filter(r => r.coverage === 'full').length, partial: rows.filter(r => r.coverage === 'partial').length,
          uncosted: uncosted.length, over: rows.filter(r => r.band === 'over').length, watch: rows.filter(r => r.band === 'watch').length,
        },
      }
    })
  })

  app.get('/settings', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const settings = await loadCostingSettings(tx, req.tenantId)
    const ids = settings.sections.map(s => s.section_id)
    const names = ids.length ? await tx`
      SELECT s.id, s.title, m.name AS menu FROM menu_sections s JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id
       WHERE s.tenant_id = ${req.tenantId} AND s.id = ANY(${ids}::uuid[])` : []
    return { ...settings, sections: settings.sections.map(s => ({ ...s, ...(names.find(n => n.id === s.section_id) ? { title: names.find(n => n.id === s.section_id).title, menu: names.find(n => n.id === s.section_id).menu } : { title: null, menu: null }) })) }
  }))

  app.put('/settings', { preHandler: canManage }, async req => {
    const b = SettingsBody.parse(req.body || {})
    const problem = thresholdProblem(b) || b.sections.map(thresholdProblem).find(Boolean)
    if (problem) throw httpError(422, problem, { code: 'thresholds' })
    const ids = [...new Set(b.sections.map(s => s.section_id))]
    if (ids.length !== b.sections.length) throw httpError(422, 'A section is listed twice', { code: 'thresholds' })
    return withTenant(req.tenantId, async tx => {
      if (ids.length) {
        const found = await tx`SELECT id FROM menu_sections WHERE tenant_id = ${req.tenantId} AND id = ANY(${ids}::uuid[])`
        if (found.length !== ids.length) throw httpError(404, 'Menu section not found')
      }
      await tx`
        INSERT INTO costing_settings (tenant_id, target_pct, limit_pct, sections, updated_by, updated_at)
        VALUES (${req.tenantId}, ${b.target_pct}, ${b.limit_pct}, ${tx.json(b.sections)}, ${who(req)}, now())
        ON CONFLICT (tenant_id) DO UPDATE SET target_pct = EXCLUDED.target_pct, limit_pct = EXCLUDED.limit_pct,
          sections = EXCLUDED.sections, updated_by = EXCLUDED.updated_by, updated_at = now()`
      return loadCostingSettings(tx, req.tenantId)
    })
  })
}
