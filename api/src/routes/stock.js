// src/routes/stock.js
//
// Stock on hand and each item's ledger (migration 287; inventory phase 4a,
// migrations 305 to 307), mounted at /api/stock by src/areas/stock.js. On
// hand is the last approved count plus every delivery and adjustment since
// (loadStockOnHand() in services/stockSvc.js, the rule stockOnHand() in
// shared/stock.js), less what sales took off (usage from sales, phase 5:
// each trading day's use per item, worked out every few minutes; today's up
// to the last run, which every answer says: salesTakenOff(), salesNote()).
// Counts are routes/stockCounts.js; areas, key lists, settings and
// adjustments routes/stockSetup.js.
//
//   GET  /meta                      the person's stock levels and the group's settings
//   GET  /venues/:venueId           every active item at the venue with its
//                                   stock on hand, last count, received,
//                                   adjusted, wasted and moved between venues
//                                   since (phase 4b), the units it is counted
//                                   in, its areas, its par there (the highest
//                                   on the venue's active order lists), low
//                                   (stockLow()), its supplier products'
//                                   barcodes (a scan finds it) and, with
//                                   Costing view, its value at the average paid
//   GET  /venues/:venueId/items/:itemId/moves?from=&to=
//                                   the item's ledger at the venue: every move
//                                   (runningBalance()) with its change and the
//                                   balance after it; from / to are days at
//                                   the venue (YYYY-MM-DD); values with Costing
//                                   view, a delivery's (the price paid to a named
//                                   supplier) with purchasing prices as well
//
// Stock View reads (no values: a value tells what was paid, so it needs
// Costing view as well; a delivery's price per base unit and line total are a
// supplier's price, so they also need purchasing prices, seesPurchasingPrices()
// on Purchasing setup, as on the purchasing pages and in recipes' explanation).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { permissionAtLeast } from '../config/modules.js'
import { stockLow, PRICES_MODULE, seesPurchasingPrices } from '../../../shared/procurement.js'
import { runningBalance, stockOnHand, MOVE_KINDS } from '../../../shared/stock.js'
import {
  loadStockOnHand, loadStockMoves, loadCountItems, loadStockSettings, itemCostsAt, SALES_COUNTED, salesTakenOff, salesNote,
  stockPerson, who,
} from '../services/stockSvc.js'

const canView = requirePermission('stock', 'view')
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_MOVES = 500

// The person who does it, as the stock documents keep them: stockPerson() and who() live in
// services/stockSvc.js (purchasing's Suggest keeps its suggested_by the same way).
export { stockPerson, who }

/**
 * Whether the person may act at a venue (inventory phase 4b: a transfer is
 * sent at one venue and received at another). The app holds people to
 * venues in two ways: a venue must be the group's (requireOwnVenue() on a
 * URL, refuseOtherTenantsVenues on a body: no group's person reaches another
 * group's venue), and a shared device belongs to one venue
 * (shared_devices.venue_id), so whoever is switched in on it acts there and
 * nowhere else. There is no list of venues per person: within the group,
 * module levels apply at every venue (docs/claude/outstanding/stock.md).
 * -> null, or why not.
 */
export function venueProblem(req, venueId) {
  const device = req.sharedDevice
  if (device?.venue_id && device.venue_id !== venueId) {
    return 'This shared device is ' + (device.venue_name || 'another venue') + '\'s: do this on a device at the venue, or signed in as yourself'
  }
  return null
}

/**
 * The person's stock levels: count (Use), approve and set up (Manage),
 * values (Costing view) and, on top, a delivery's price from its supplier
 * (purchasing prices too: `sees_prices`), and sales in pounds beside costs
 * (till reports view too: `sees_sales`, phase 6a's food cost).
 */
export async function stockAccess(req) {
  const lv = await permissionLevels(req, ['stock', 'costing', PRICES_MODULE, 'pos_reports'])
  const values = permissionAtLeast(lv.costing, 'view')
  return {
    level: lv.stock || 'none',
    can_count: permissionAtLeast(lv.stock, 'use'),
    can_manage: permissionAtLeast(lv.stock, 'manage'),
    sees_values: values,
    sees_prices: values && seesPurchasingPrices(lv[PRICES_MODULE]),
    // Phase 6a: sales in pounds (net food sales, food cost %) need till reports view as well (the Sold tab's rule).
    sees_sales: values && permissionAtLeast(lv.pos_reports, 'view'),
  }
}

/** A venue's day as the moment it starts there, or the moment the next one starts (`end`). */
export async function dayStart(tx, tenantId, venueId, day, end = false) {
  const [r] = await tx`
    SELECT ((${day}::date + ${end ? 1 : 0}::int)::timestamp AT TIME ZONE COALESCE(v.timezone, 'Europe/London')) AS at
      FROM venues v WHERE v.id = ${venueId} AND v.tenant_id = ${tenantId}`
  return r?.at ?? null
}

export default async function stockRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  app.get('/meta', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    const settings = await withTenant(req.tenantId, tx => loadStockSettings(tx, req.tenantId))
    return { ...access, can_approve: access.can_manage, settings, me: await who(req), sales_counted: SALES_COUNTED }
  })

  app.get('/venues/:venueId', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const rows = await loadStockOnHand(tx, req.tenantId, { venueIds: [venueId], allItems: true })
      const ids = rows.map(r => r.item_id)
      const [items, cats, pars, areas, values, taken, [venue]] = await Promise.all([
        loadCountItems(tx, req.tenantId, ids),
        tx`SELECT i.id, c.name AS category_name FROM inv_items i JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = i.tenant_id
            WHERE i.tenant_id = ${req.tenantId} AND i.id = ANY(${ids}::uuid[])`,
        tx`SELECT li.item_id, max(p.par_base)::float8 AS par
             FROM order_list_pars p
             JOIN order_list_items li ON li.id = p.list_item_id AND li.tenant_id = p.tenant_id
             JOIN order_lists l ON l.id = li.list_id AND l.tenant_id = li.tenant_id AND l.is_active
            WHERE p.tenant_id = ${req.tenantId} AND p.venue_id = ${venueId} AND p.par_base IS NOT NULL
            GROUP BY li.item_id`,
        tx`SELECT ai.item_id, array_agg(a.name ORDER BY a.sort_order, lower(a.name)) AS names
             FROM stock_area_items ai JOIN stock_areas a ON a.id = ai.area_id AND a.tenant_id = ai.tenant_id
            WHERE ai.tenant_id = ${req.tenantId} AND a.venue_id = ${venueId}
            GROUP BY ai.item_id`,
        access.sees_values ? itemCostsAt(tx, req.tenantId, venueId, ids) : null,
        salesTakenOff(tx, req.tenantId, [venueId]),
        tx`SELECT timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${req.tenantId}`,
      ])
      const sales = taken[venueId] || null
      const catOf = new Map(cats.map(c => [c.id, c.category_name]))
      const parOf = new Map(pars.map(p => [p.item_id, p.par]))
      const areasOf = new Map(areas.map(a => [a.item_id, a.names]))
      const list = rows.filter(r => items.has(r.item_id)).map(r => {
        const i = items.get(r.item_id)
        const par = parOf.get(i.id) ?? null
        const per = values?.get(i.id) ?? null
        return {
          item_id: i.id, name: i.name, code: i.code, barcode: i.barcode, quote_barcodes: i.quote_barcodes,
          base_unit: i.base_unit, storage: i.storage, category_name: catOf.get(i.id) ?? null,
          units: i.count_units, default_unit: i.default_unit, areas: areasOf.get(i.id) || [],
          on_hand: r.on_hand, counted: r.counted, counted_at: r.counted_at,
          received_since: r.received_since, adjusted_since: r.adjusted_since, used_since: r.used_since,
          wasted_since: r.wasted_since, transferred_since: r.transferred_since,
          sales_counted: r.sales_counted, par_base: par, low: stockLow(r.on_hand, par),
          ...(access.sees_values ? { cost_per_base: per, value: per != null && r.on_hand != null ? Math.round(r.on_hand * per * 100) / 100 : null } : {}),
        }
      }).sort((a, b) => (a.category_name || '~').localeCompare(b.category_name || '~') || a.name.localeCompare(b.name))
      return {
        sales_counted: SALES_COUNTED, sales_up_to: sales?.up_to ?? null, note: salesNote(sales, venue?.timezone || undefined),
        sees_values: access.sees_values,
        ...(access.sees_values ? { total_value: Math.round(list.reduce((s, i) => s + (i.value || 0), 0) * 100) / 100 } : {}),
        items: list,
      }
    })
  })

  app.get('/venues/:venueId/items/:itemId/moves', { preHandler: canView }, async req => {
    const q = z.object({ from: Day.optional(), to: Day.optional() }).parse(req.query || {})
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const { venueId, itemId } = req.params
      const [item] = await tx`SELECT id, name, base_unit, code FROM inv_items WHERE id = ${itemId} AND tenant_id = ${req.tenantId}`
      if (!item) throw httpError(404, 'Inventory item not found')
      const to = q.to ? new Date(new Date(await dayStart(tx, req.tenantId, venueId, q.to, true)).getTime() - 1) : null
      const from = q.from ? await dayStart(tx, req.tenantId, venueId, q.from) : null
      // The balance runs from the first move, so every move up to `to` is read; the rows shown start at `from`.
      const moves = await loadStockMoves(tx, req.tenantId, { venueIds: [venueId], itemIds: [itemId], to, costs: access.sees_values })
      const ledger = runningBalance(moves)
      const [taken, [venue]] = await Promise.all([
        salesTakenOff(tx, req.tenantId, [venueId]),
        tx`SELECT timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${req.tenantId}`,
      ])
      const shown = (from ? ledger.filter(m => new Date(m.at) >= new Date(from)) : ledger)
      // A delivery is valued at what its supplier charged: shown only with purchasing prices as well.
      const priced = m => m.kind !== 'delivery' || access.sees_prices
      const rows = shown.slice(-MAX_MOVES).reverse().map(m => ({
        at: m.at, kind: m.kind, kind_label: MOVE_KINDS[m.kind]?.label ?? m.kind,
        qty_base: m.qty_base, change: m.change, balance: m.balance, sets: !!MOVE_KINDS[m.kind]?.sets,
        source: m.source, by: m.by, ...(m.kind === 'usage' ? { channels: m.channels } : {}),
        ...(access.sees_values ? {
          cost_per_base: priced(m) ? m.cost_per_base : null,
          value: !priced(m) || m.change == null || m.cost_per_base == null ? null : Math.round(m.change * m.cost_per_base * 100) / 100,
        } : {}),
      }))
      return {
        item: { id: item.id, name: item.name, base_unit: item.base_unit, code: item.code },
        on_hand: stockOnHand({ moves }),
        sees_values: access.sees_values, sees_prices: access.sees_prices,
        sales_up_to: taken[venueId]?.up_to ?? null, note: salesNote(taken[venueId], venue?.timezone || undefined),
        moves: rows, ...(shown.length > MAX_MOVES ? { showing: MAX_MOVES, of: shown.length } : {}),
      }
    })
  })
}
