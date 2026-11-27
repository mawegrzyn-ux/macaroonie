// src/routes/stock.js
//
// Stock on hand and each item's ledger (migration 287; inventory phase 4a,
// migrations 305 to 307), mounted at /api/stock by src/areas/stock.js. On
// hand is the last approved count plus every delivery and adjustment since
// (loadStockOnHand() in services/stockSvc.js, the rule stockOnHand() in
// shared/stock.js); sales aren't taken off until usage from sales (phase 5).
// Counts are routes/stockCounts.js; areas, key lists, settings and
// adjustments routes/stockSetup.js.
//
//   GET  /meta                      the person's stock levels and the group's settings
//   GET  /venues/:venueId           every active item at the venue with its
//                                   stock on hand, last count, received and
//                                   adjusted since, the units it is counted
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
  loadStockOnHand, loadStockMoves, loadCountItems, loadStockSettings, itemCostsAt, SALES_COUNTED, NO_SALES_NOTE,
} from '../services/stockSvc.js'

const canView = requirePermission('stock', 'view')
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_MOVES = 500

/**
 * The person who does it, as the stock documents keep them (counted_by,
 * submitted_by, approved_by, adjusted_by, an area's done by): the person,
 * never only the account (core's rule for shared devices). On a shared
 * device that is the office PIN person switched in, kept by their own
 * sign-in email (users.email), so what they do there and from their own
 * login reads the same and the second person rule compares like with like;
 * else the signed-in account's email (its sub when the token has none).
 * { by, ids }: `by` is what is written, `ids` every form this person's name
 * takes in what was written before (email and sub), for approvalProblem().
 * Read once a request.
 */
export async function stockPerson(req) {
  if (req.stockPerson) return req.stockPerson
  let by
  let ids
  if (req.acting) {
    const [u] = req.acting.userId
      ? await withTenant(req.tenantId, tx => tx`SELECT email FROM users WHERE id = ${req.acting.userId} AND tenant_id = ${req.tenantId} LIMIT 1`)
      : []
    by = u?.email || req.acting.sub || req.acting.name || null
    ids = [u?.email, req.acting.sub, by]
  } else {
    by = req.user?.email ?? req.user?.sub ?? null
    ids = [req.user?.email, req.user?.sub]
  }
  req.stockPerson = { by, ids: [...new Set(ids.filter(Boolean))] }
  return req.stockPerson
}

/** Who did it, as the stock documents keep it (stockPerson()'s `by`). */
export const who = async req => (await stockPerson(req)).by

/**
 * The person's stock levels: count (Use), approve and set up (Manage),
 * values (Costing view) and, on top, a delivery's price from its supplier
 * (purchasing prices too: `sees_prices`).
 */
export async function stockAccess(req) {
  const lv = await permissionLevels(req, ['stock', 'costing', PRICES_MODULE])
  const values = permissionAtLeast(lv.costing, 'view')
  return {
    level: lv.stock || 'none',
    can_count: permissionAtLeast(lv.stock, 'use'),
    can_manage: permissionAtLeast(lv.stock, 'manage'),
    sees_values: values,
    sees_prices: values && seesPurchasingPrices(lv[PRICES_MODULE]),
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
    return { ...access, can_approve: access.can_manage, settings, me: await who(req), sales_counted: SALES_COUNTED, note: NO_SALES_NOTE }
  })

  app.get('/venues/:venueId', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const rows = await loadStockOnHand(tx, req.tenantId, { venueIds: [venueId], allItems: true })
      const ids = rows.map(r => r.item_id)
      const [items, cats, pars, areas, values] = await Promise.all([
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
      ])
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
          sales_counted: r.sales_counted, par_base: par, low: stockLow(r.on_hand, par),
          ...(access.sees_values ? { cost_per_base: per, value: per != null && r.on_hand != null ? Math.round(r.on_hand * per * 100) / 100 : null } : {}),
        }
      }).sort((a, b) => (a.category_name || '~').localeCompare(b.category_name || '~') || a.name.localeCompare(b.name))
      return {
        sales_counted: SALES_COUNTED, note: NO_SALES_NOTE, sees_values: access.sees_values,
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
      const shown = (from ? ledger.filter(m => new Date(m.at) >= new Date(from)) : ledger)
      // A delivery is valued at what its supplier charged: shown only with purchasing prices as well.
      const priced = m => m.kind !== 'delivery' || access.sees_prices
      const rows = shown.slice(-MAX_MOVES).reverse().map(m => ({
        at: m.at, kind: m.kind, kind_label: MOVE_KINDS[m.kind]?.label ?? m.kind,
        qty_base: m.qty_base, change: m.change, balance: m.balance, sets: !!MOVE_KINDS[m.kind]?.sets,
        source: m.source, by: m.by,
        ...(access.sees_values ? {
          cost_per_base: priced(m) ? m.cost_per_base : null,
          value: !priced(m) || m.change == null || m.cost_per_base == null ? null : Math.round(m.change * m.cost_per_base * 100) / 100,
        } : {}),
      }))
      return {
        item: { id: item.id, name: item.name, base_unit: item.base_unit, code: item.code },
        on_hand: stockOnHand({ moves }),
        sees_values: access.sees_values, sees_prices: access.sees_prices, note: NO_SALES_NOTE,
        moves: rows, ...(shown.length > MAX_MOVES ? { showing: MAX_MOVES, of: shown.length } : {}),
      }
    })
  })
}
