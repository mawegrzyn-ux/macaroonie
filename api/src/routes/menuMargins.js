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
//   GET  /sold        ?venue_id &from &to (days, up to SOLD_MAX_DAYS; the last 7 up to
//                     yesterday when left out)   what sold, by dish and section: units,
//                     sales, net, theoretical cost, GP and cost % (soldMargins() over
//                     dish_cost_days, inventory phase 5: usage from sales)
//   GET  /engineering ?venue_id &from &to (days, up to SOLD_MAX_DAYS; the last 28 up to
//                     yesterday when left out) &menu_id (that menu's sections only)
//                     menu engineering from what sold (inventory phase 7a): each
//                     section's dishes as stars, plough-horses, puzzles and dogs by
//                     Kasavana and Smith (engineer() in shared/engineering.js over
//                     dish_cost_days), with GP per unit, total GP and cost %
//   GET  /settings    the target and limit cost %, with sections' own
//   PUT  /settings    { target_pct, limit_pct, sections: [{ section_id,
//                     target_pct, limit_pct }] } the whole of it (rule 13)
//
// Reading needs Costing view (a cost tells what suppliers charge); the
// targets need Costing manage. The Sold tab's sales, net, GP, cost % and band
// need till reports view as well (pos_reports: sales are the till's figures). Ids are the group's (rule 4): the menu, the
// venue, the stream (its venue's), the order type, the sections.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { permissionAtLeast } from '../config/modules.js'
import { httpError } from '../middleware/error.js'
import { loadMenuVersion } from '../services/menuReleases.js'
import { loadDishCosting, loadScopes, loadCostingSettings } from '../services/dishCostSvc.js'
import { loadTaxRates } from '../services/taxSvc.js'
import { menuMargins, thresholdProblem, scopeText, soldMargins } from '../../../shared/costing.js'
import { resolveItemTypes } from '../../../shared/catalogue.js'
import { engineer, withoutSales, CLASSES } from '../../../shared/engineering.js'

const uuid = z.string().uuid()
const Query = z.object({
  menu_id: uuid.optional(), venue_id: uuid.optional(), revenue_stream_id: uuid.optional(), order_type_id: uuid.optional(),
  version: z.enum(['live', 'draft']).optional(),
})
// The Sold tab (inventory phase 5): what sold at a venue (or every venue) on some days, from usage from sales.
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const SoldQuery = z.object({ venue_id: uuid.optional(), from: Day.optional(), to: Day.optional() })
export const SOLD_MAX_DAYS = 93
// Menu engineering (inventory phase 7a): the same days, a menu's sections only when one is named.
const EngineeringQuery = SoldQuery.extend({ menu_id: uuid.optional() })
export const ENGINEERING_DAYS = 28
// What the Sold tab leaves out without till reports view: the sales and what is worked out from them.
export const SALES_FIELDS = ['sales_pence', 'net_pence', 'gp_pence', 'cost_pct', 'gp_pct', 'band']
const Pct = z.number().gt(0).lt(100)
export const SettingsBody = z.object({
  target_pct: Pct,
  limit_pct:  Pct,
  sections:   z.array(z.object({ section_id: uuid, target_pct: Pct, limit_pct: Pct }).strict()).max(500),
}).strict()

const canView = requirePermission('costing', 'view')

/** The days a Sold or Engineering read covers: the query's, else the last `days` up to yesterday; refused past SOLD_MAX_DAYS. */
export async function soldDays(tx, q, days = 7) {
  const [range] = await tx`SELECT (current_date - ${days}::int)::text AS from, (current_date - 1)::text AS to`
  const from = q.from || range.from
  const to = q.to || range.to
  if (from > to) throw httpError(422, 'The first day is after the last', { code: 'range' })
  if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > SOLD_MAX_DAYS) throw httpError(422, 'Show up to ' + SOLD_MAX_DAYS + ' days at a time', { code: 'range' })
  return { from, to }
}

/**
 * Menu engineering over dish_cost_days (inventory phase 7a): the rows summed
 * by dish, section and whether every unit was costed, the dishes' kinds (a
 * meal deal) and their sections' menus, then engineer(). Shared by the route,
 * the report work and Pepper (through the route). { sections (each with
 * menu_id and menu), total, left_out, worked_out_at }; with sales: false,
 * withoutSales() of it.
 */
export async function engineeringFor(tx, tenantId, { venueIds = null, from, to, menuId = null, sales = true } = {}) {
  const rows = await tx`
    SELECT d.dish_id, d.name, d.section_id, d.section, d.left_out, (d.cost IS NOT NULL AND d.uncosted_qty = 0) AS costed,
           sum(d.qty)::float8 AS qty, sum(d.net_pence)::bigint AS net_pence, sum(d.cost)::float8 AS cost,
           sum(d.typical_qty)::float8 AS typical_qty
      FROM dish_cost_days d
     WHERE d.tenant_id = ${tenantId} AND d.day BETWEEN ${from}::date AND ${to}::date
       ${venueIds ? tx`AND d.venue_id = ANY(${venueIds}::uuid[])` : tx``}
     GROUP BY d.dish_id, d.name, d.section_id, d.section, d.left_out, 6`
  const sectionIds = [...new Set(rows.map(r => r.section_id).filter(Boolean))]
  const dishIds = [...new Set(rows.map(r => r.dish_id).filter(Boolean))]
  const [sections, dishes, [run]] = await Promise.all([
    sectionIds.length ? tx`
      SELECT s.id, s.title, m.id AS menu_id, m.name AS menu FROM menu_sections s JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id
       WHERE s.tenant_id = ${tenantId} AND s.id = ANY(${sectionIds}::uuid[])` : [],
    dishIds.length ? tx`SELECT id, kind FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${dishIds}::uuid[])` : [],
    tx`SELECT max(computed_at) AS at FROM stock_usage_marks WHERE tenant_id = ${tenantId} ${venueIds ? tx`AND venue_id = ANY(${venueIds}::uuid[])` : tx``}`,
  ])
  const secOf = new Map(sections.map(s => [s.id, s]))
  const kindOf = new Map(dishes.map(d => [d.id, d.kind === 'combo' ? 'deal' : 'dish']))
  // A menu named: its sections only (the draft's; a release keeps the draft's ids).
  const kept = menuId ? rows.filter(r => r.section_id && secOf.get(r.section_id)?.menu_id === menuId) : rows
  const result = engineer(kept.map(r => ({
    dish_id: r.dish_id, name: r.name, section_id: r.section_id, section: secOf.get(r.section_id)?.title ?? r.section,
    kind: r.dish_id ? (kindOf.get(r.dish_id) ?? null) : null, left_out: r.left_out,
    qty: r.qty, net_pence: Number(r.net_pence), typical_qty: r.typical_qty,
    // A row with any unit not costed is left out of GP (all its units), never priced at nil.
    cost: r.costed ? r.cost : null, uncosted_qty: r.costed ? 0 : r.qty,
  })))
  for (const s of result.sections) {
    const m = secOf.get(s.section_id)
    s.menu_id = m?.menu_id ?? null
    s.menu = m?.menu ?? null
  }
  const out = { ...result, worked_out_at: run?.at ?? null }
  return sales ? out : withoutSales(out)
}
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

  // What sold, with its theoretical cost (inventory phase 5): dish_cost_days summed by soldMargins().
  app.get('/sold', { preHandler: canView }, async req => {
    const q = SoldQuery.parse(req.query || {})
    // Sales are the till's figures: in pounds (and so GP, cost % and the band against the targets) only with till
    // reports view, as Recipes' coverage and the report subject Dish sales; Costing view alone sees units and costs.
    const lv = await permissionLevels(req, ['pos_reports'])
    const sales = permissionAtLeast(lv.pos_reports, 'view')
    return withTenant(req.tenantId, async tx => {
      if (q.venue_id) {
        const [v] = await tx`SELECT id FROM venues WHERE id = ${q.venue_id} AND tenant_id = ${req.tenantId}`
        if (!v) throw httpError(404, 'Venue not found')
      }
      const { from, to } = await soldDays(tx, q, 7)
      const [rows, settings, [run]] = await Promise.all([
        tx`
          SELECT d.dish_id, d.name, d.section_id, d.section, d.left_out, sum(d.qty)::float8 AS qty, sum(d.sales_pence)::bigint AS sales_pence,
                 sum(d.net_pence)::bigint AS net_pence, sum(d.cost)::float8 AS cost, sum(d.uncosted_qty)::float8 AS uncosted_qty,
                 sum(d.typical_qty)::float8 AS typical_qty
            FROM dish_cost_days d
           WHERE d.tenant_id = ${req.tenantId} AND d.day BETWEEN ${from}::date AND ${to}::date
             ${q.venue_id ? tx`AND d.venue_id = ${q.venue_id}` : tx``}
           GROUP BY d.dish_id, d.name, d.section_id, d.section, d.left_out`,
        loadCostingSettings(tx, req.tenantId),
        tx`SELECT max(computed_at) AS at FROM stock_usage_marks WHERE tenant_id = ${req.tenantId} ${q.venue_id ? tx`AND venue_id = ${q.venue_id}` : tx``}`,
      ])
      const sold = soldMargins(rows.map(r => ({ ...r, sales_pence: Number(r.sales_pence), net_pence: Number(r.net_pence) })), settings)
      const shown = row => (sales ? row : Object.fromEntries(Object.entries(row).filter(([k]) => !SALES_FIELDS.includes(k))))
      return {
        venue_id: q.venue_id || null, from, to, max_days: SOLD_MAX_DAYS, worked_out_at: run?.at ?? null, sees_sales: sales,
        dishes: sold.dishes.map(shown), sections: sold.sections.map(shown), total: shown(sold.total),
      }
    })
  })

  // Menu engineering (inventory phase 7a): each section's dishes by Kasavana and Smith, from what sold.
  app.get('/engineering', { preHandler: canView }, async req => {
    const q = EngineeringQuery.parse(req.query || {})
    // GP, net, cost % and the classes (worked out from GP) are the till's sales: till reports view too, as the Sold tab.
    const lv = await permissionLevels(req, ['pos_reports'])
    const sales = permissionAtLeast(lv.pos_reports, 'view')
    return withTenant(req.tenantId, async tx => {
      if (q.venue_id) {
        const [v] = await tx`SELECT id FROM venues WHERE id = ${q.venue_id} AND tenant_id = ${req.tenantId}`
        if (!v) throw httpError(404, 'Venue not found')
      }
      if (q.menu_id) {
        const [m] = await tx`SELECT id FROM menus WHERE id = ${q.menu_id} AND tenant_id = ${req.tenantId}`
        if (!m) throw httpError(404, 'Menu not found')
      }
      const { from, to } = await soldDays(tx, q, ENGINEERING_DAYS)
      const e = await engineeringFor(tx, req.tenantId, { venueIds: q.venue_id ? [q.venue_id] : null, from, to, menuId: q.menu_id || null, sales })
      return {
        venue_id: q.venue_id || null, menu_id: q.menu_id || null, from, to, max_days: SOLD_MAX_DAYS, sees_sales: sales,
        classes: CLASSES, ...e,
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
