// src/routes/stockFoodCost.js
//
// Food cost beyond one stock period (inventory phase 6b; docs/INVENTORY.md
// 8.1, 8.2, 10.3), mounted at /api/stock by src/areas/stock.js. Every figure
// is shared/foodCost.js's (over shared/variance.js and shared/costing.js),
// worked out by services/stockFoodCostSvc.js. Read only.
//
//   GET /venues/:venueId/food-cost/week?start=YYYY-MM-DD   Cash Recon's week line and the
//       food cost widget: theoretical food cost % from the week's sales, actual only for the
//       stock period that covers the week (else the latest closed one, named with its
//       dates), in words; the recent closed periods. Costing view and till reports view
//       (sales in pounds and a share of them), 403 `sales` without the second
//   GET /venues/:venueId/margins-by-menu?start=   sold margins by menu over the week (the
//       widget): units and theoretical cost with Costing view; net sales, GP and cost %
//       with till reports view as well
//   GET /venues/:venueId/cost-targets             the venue's dishes over their cost target now,
//       at their worst order type (Today's task): Costing view
//   GET /overview                                 each venue's stock in a line (the Overview
//       tile): Stock view; food cost with Costing view and till reports view
//   GET /venues/:venueId/setup-gaps               Home's stock and costing set-up gaps at the venue
//       (no storage areas, best sellers with no recipe, items in recipes with no price; the Today
//       feed reads it as the person, services/opsToday.js): only the gaps whose module the person
//       manages (Stock, Recipes, Purchasing setup), so needs no one module; none for the rest

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { permissionAtLeast } from '../config/modules.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { weekFigures, weekStart, localDay, menuMarginsWeek, venueOverTarget, stockOverview, setupGaps, GAP_MODULES } from '../services/stockFoodCostSvc.js'
import { stockAccess } from './stock.js'

const canCost = requirePermission('costing', 'view')
const canView = requirePermission('stock', 'view')
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const WeekQuery = z.object({ start: Day.optional() })
const DAY = 86400000
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
// What margin by menu leaves out without till reports view: the sales and what is worked out from them.
export const SALES_FIELDS = ['sales_pence', 'net_pence', 'gp_pence', 'cost_pct', 'gp_pct', 'band']

/** The week asked for (its Monday), else this week at the venue. */
async function weekOf(tx, tenantId, venueId, start) {
  if (start) return weekStart(start)
  const [v] = await tx`SELECT timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  return weekStart(localDay(v?.timezone))
}

export default async function stockFoodCostRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  app.get('/venues/:venueId/food-cost/week', { preHandler: canCost }, async req => {
    const q = WeekQuery.parse(req.query || {})
    const access = await stockAccess(req)
    if (!access.sees_sales) throw httpError(403, 'Food cost % is a share of sales: it needs Till reports view as well as Costing view', { code: 'sales' })
    return withTenant(req.tenantId, async tx => {
      const start = await weekOf(tx, req.tenantId, req.params.venueId, q.start)
      return weekFigures(tx, req.tenantId, req.params.venueId, start)
    })
  })

  app.get('/venues/:venueId/margins-by-menu', { preHandler: canCost }, async req => {
    const q = WeekQuery.parse(req.query || {})
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const start = await weekOf(tx, req.tenantId, req.params.venueId, q.start)
      const menus = await menuMarginsWeek(tx, req.tenantId, req.params.venueId, start, addDays(start, 6))
      const shown = m => (access.sees_sales ? m : Object.fromEntries(Object.entries(m).filter(([k]) => !SALES_FIELDS.includes(k))))
      return { venue_id: req.params.venueId, week_start: start, week_end: addDays(start, 6), sees_sales: access.sees_sales, menus: menus.map(shown) }
    })
  })

  app.get('/venues/:venueId/cost-targets', { preHandler: canCost }, async req => withTenant(req.tenantId, async tx => {
    const r = await venueOverTarget(tx, req.tenantId, req.params.venueId)
    return { venue_id: req.params.venueId, dishes: r.dishes, menus: r.menus, target_pct: r.settings?.target_pct ?? null, limit_pct: r.settings?.limit_pct ?? null }
  }))

  app.get('/venues/:venueId/setup-gaps', async req => {
    const levels = await permissionLevels(req, GAP_MODULES)
    const modules = GAP_MODULES.filter(m => permissionAtLeast(levels[m], 'manage'))
    const gaps = modules.length ? await withTenant(req.tenantId, tx => setupGaps(tx, req.tenantId, req.params.venueId, { modules })) : []
    return { venue_id: req.params.venueId, gaps }
  })

  app.get('/overview', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    return withTenant(req.tenantId, tx => stockOverview(tx, req.tenantId, access))
  })
}
