// src/routes/costAlerts.js
//
// Cost alerts (inventory phase 7b, migration 315; docs/INVENTORY.md 8.2),
// mounted at /api/cost-alerts, for the Menu margins page's banner, Today and
// Pepper's why_cost_changed. An alert is a dish at a venue that a supplier
// price change took over its cost target or limit (recorded by the price
// change hook, services/priceCreepSvc.js, in the purchasing routes).
//
//   GET  /           ?venue_id &since (a day) &unseen (1) &dish_id &limit   the alerts, newest
//                    first, with alertSummary()'s words over them (worked out from the alerts as
//                    the person may see them)
//   GET  /summary    ?venue_id   the alerts nobody has marked seen yet: how many dishes crossed
//                    what since when and the move behind most ("4 dishes crossed 35% since 1 Dec:
//                    Chicken thighs up 12%"), the newest's id, and the newest alert's id seen or
//                    not (latest_id: Today's card key, which marking them seen leaves as it was)
//   POST /seen       { ids } or { venue_id } (every unseen alert there) or {} (every unseen
//                    alert)   marked seen by the person, for everyone (Costing manage)
//   GET  /why        ?dish_id &venue_id &order_type_id &since (a day; 30 days back when left
//                    out)   a live dish's cost now against its cost at the start of that day:
//                    which items moved and by how much (whyCostChanged(), the price history)
//
// Reading needs Costing view (a cost % and how an item's cost moved tell what
// suppliers charge); a supplier's name, pack and pack price in a cause need
// purchasing prices too (stripped otherwise). Marking seen is Costing manage.
// Ids are the group's (rule 4): the venue (refuseOtherTenantsVenues and the
// route's own check), the dish (on a live menu), the order type, the alerts.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { loadCostAlerts, whyCostChanged } from '../services/priceCreepSvc.js'
import { alertSummary } from '../../../shared/priceCreep.js'
import { seesPurchasingPrices, PRICES_MODULE } from '../../../shared/procurement.js'

const uuid = z.string().uuid()
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const ListQuery = z.object({
  venue_id: uuid.optional(), since: Day.optional(), unseen: z.enum(['1', 'true', '0', 'false']).optional(),
  dish_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(500).optional(),
})
const SummaryQuery = z.object({ venue_id: uuid.optional() })
export const SeenBody = z.object({ ids: z.array(uuid).min(1).max(500).optional(), venue_id: uuid.optional() }).strict()
const WhyQuery = z.object({ dish_id: uuid, venue_id: uuid.optional(), order_type_id: uuid.optional(), since: Day.optional() })
// How far back why_cost_changed looks when no day is given.
export const WHY_DAYS = 30

const canView = requirePermission('costing', 'view')
const canManage = requirePermission('costing', 'manage')
const who = req => req.user?.email ?? req.user?.sub ?? null

async function seesPrices(req) {
  const lv = await permissionLevels(req, [PRICES_MODULE])
  return seesPurchasingPrices(lv[PRICES_MODULE])
}

/** A cause without the supplier's price (its name, pack and pack price) for people who don't see purchasing prices. */
const causeView = (c, prices) => (prices ? c : { ...c, quote_before: null, quote_after: null })
const alertView = (a, prices) => ({ ...a, causes: (Array.isArray(a.causes) ? a.causes : []).map(c => causeView(c, prices)) })

async function checkVenue(tx, tenantId, venueId) {
  if (!venueId) return
  const [v] = await tx`SELECT id FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
}

export default async function costAlertRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', { preHandler: canView }, async req => {
    const q = ListQuery.parse(req.query || {})
    const prices = await seesPrices(req)
    return withTenant(req.tenantId, async tx => {
      await checkVenue(tx, req.tenantId, q.venue_id)
      const rows = await loadCostAlerts(tx, req.tenantId, {
        venueId: q.venue_id ?? null, since: q.since ?? null, unseen: q.unseen === '1' || q.unseen === 'true', dishId: q.dish_id ?? null, limit: q.limit ?? 200,
      })
      // The summary from the alerts as shown: its top item is a cause, which carries the supplier's price.
      const shown = rows.map(a => alertView(a, prices))
      return { alerts: shown, summary: alertSummary(shown), sees_prices: prices }
    })
  })

  app.get('/summary', { preHandler: canView }, async req => {
    const q = SummaryQuery.parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      await checkVenue(tx, req.tenantId, q.venue_id)
      const [rows, [latest]] = await Promise.all([
        loadCostAlerts(tx, req.tenantId, { venueId: q.venue_id ?? null, unseen: true, limit: 500 }),
        loadCostAlerts(tx, req.tenantId, { venueId: q.venue_id ?? null, limit: 1 }),
      ])
      const s = alertSummary(rows)
      return {
        venue_id: q.venue_id ?? null, count: s.count, dishes: s.dishes, venues: s.venues, threshold_pct: s.threshold_pct, since: s.since,
        top: s.top ? { name: s.top.name, pct: s.top.pct } : null, words: s.words,
        newest_id: rows[0]?.id ?? null, newest_at: rows[0]?.at ?? null, latest_id: latest?.id ?? null,
      }
    })
  })

  app.post('/seen', { preHandler: canManage }, async req => {
    const b = SeenBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      await checkVenue(tx, req.tenantId, b.venue_id)
      if (b.ids) {
        const found = await tx`SELECT id FROM cost_alerts WHERE tenant_id = ${req.tenantId} AND id = ANY(${b.ids}::uuid[])`
        if (found.length !== new Set(b.ids).size) throw httpError(404, 'Cost alert not found')
      }
      const rows = await tx`
        UPDATE cost_alerts SET seen_by = ${who(req)}, seen_at = now()
         WHERE tenant_id = ${req.tenantId} AND seen_at IS NULL
           ${b.ids ? tx`AND id = ANY(${b.ids}::uuid[])` : tx``}
           ${b.venue_id ? tx`AND venue_id = ${b.venue_id}` : tx``}
        RETURNING id`
      return { seen: rows.length }
    })
  })

  app.get('/why', { preHandler: canView }, async req => {
    const q = WhyQuery.parse(req.query || {})
    const prices = await seesPrices(req)
    return withTenant(req.tenantId, async tx => {
      const [d] = await tx`SELECT (current_date - ${WHY_DAYS}::int)::text AS since, current_date::text AS today`
      const since = q.since || d.since
      if (since > d.today) throw httpError(422, 'Pick a day up to today', { code: 'since' })
      const r = await whyCostChanged(tx, req.tenantId, { dishId: q.dish_id, venueId: q.venue_id ?? null, orderTypeId: q.order_type_id ?? null, since })
      return { ...r, items: r.items.map(m => causeView(m, prices)), alerts: r.alerts.map(a => alertView(a, prices)), sees_prices: prices }
    })
  })
}
