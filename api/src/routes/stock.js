// src/routes/stock.js
//
// Stock on hand and stock counts (Pepper-first step 8B3, migration 287),
// mounted at /api/stock. On hand is the last count plus what was received
// since (services/stockSvc.js, the rule stockOnHand() in shared/procurement.js);
// sales aren't taken off until dishes are linked to the items they use.
//
//   GET  /venues/:venueId           every active item at the venue with its
//                                   stock on hand, last count and received since,
//                                   its par there (the highest on the venue's
//                                   active order lists), low (stockLow(), step 9b) and
//                                   its supplier products' barcodes (a scan finds it)
//   GET  /venues/:venueId/counts    the venue's last 20 counts
//   GET  /counts/:id                one count with its lines
//   POST /venues/:venueId/counts    { lines: [{ item_id, qty, unit? }], note?, counted_at? }
//                                   a count: each quantity in a unit that fits
//                                   the item (kg for an item counted in g),
//                                   stored in the item's base unit
//
// Reading needs View on any purchasing module (no prices here); counting
// needs Manage on Purchasing (what receiving needs) or Purchasing setup.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireAnyPermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { countToBase, stockLow, UNITS } from '../../../shared/procurement.js'
import { loadStockOnHand, SALES_COUNTED, NO_RECIPES_NOTE } from '../services/stockSvc.js'

const canRead = requireAnyPermission(['purchasing', 'purchasing_setup', 'purchasing_approve'], 'view')
const canCount = requireAnyPermission(['purchasing', 'purchasing_setup'], 'manage')
const MAX_LINES = 1000
// A count may say it was taken a little earlier (the sheet filled in after closing), never later.
const BACK_DAYS = 14

export const CountBody = z.object({
  lines: z.array(z.object({
    item_id: z.string().uuid(),
    qty: z.number().min(0).max(100000000),
    unit: z.enum(Object.keys(UNITS)).optional(),
  })).min(1).max(MAX_LINES),
  note: z.string().trim().max(500).nullable().optional(),
  counted_at: z.string().datetime({ offset: true }).optional(),
})

export default async function stockRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  app.get('/venues/:venueId', { preHandler: canRead }, async req => withTenant(req.tenantId, async tx => {
    const rows = await loadStockOnHand(tx, req.tenantId, { venueIds: [req.params.venueId], allItems: true })
    const items = await tx`
      SELECT i.id, i.name, i.code, i.barcode, i.base_unit, i.storage, c.name AS category_name,
             ARRAY(SELECT q.barcode FROM inv_quotes q WHERE q.item_id = i.id AND q.tenant_id = i.tenant_id AND q.barcode IS NOT NULL) AS quote_barcodes
        FROM inv_items i LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = i.tenant_id
       WHERE i.tenant_id = ${req.tenantId} AND i.id = ANY(${rows.map(r => r.item_id)}::uuid[])`
    const byId = new Map(items.map(i => [i.id, i]))
    const pars = await tx`
      SELECT li.item_id, max(p.par_base)::float8 AS par
        FROM order_list_pars p
        JOIN order_list_items li ON li.id = p.list_item_id AND li.tenant_id = p.tenant_id
        JOIN order_lists l ON l.id = li.list_id AND l.tenant_id = li.tenant_id AND l.is_active
       WHERE p.tenant_id = ${req.tenantId} AND p.venue_id = ${req.params.venueId} AND p.par_base IS NOT NULL
       GROUP BY li.item_id`
    const parOf = new Map(pars.map(p => [p.item_id, p.par]))
    return {
      sales_counted: SALES_COUNTED,
      note: NO_RECIPES_NOTE,
      items: rows.filter(r => byId.has(r.item_id)).map(r => {
        const i = byId.get(r.item_id)
        const par = parOf.get(i.id) ?? null
        return {
          item_id: i.id, name: i.name, code: i.code, barcode: i.barcode, quote_barcodes: i.quote_barcodes,
          base_unit: i.base_unit, storage: i.storage, category_name: i.category_name,
          ...r, venue_id: undefined, par_base: par, low: stockLow(r.on_hand, par),
        }
      }).sort((a, b) => (a.category_name || '~').localeCompare(b.category_name || '~') || a.name.localeCompare(b.name)),
    }
  }))

  app.get('/venues/:venueId/counts', { preHandler: canRead }, async req => withTenant(req.tenantId, tx => tx`
    SELECT c.id, c.counted_at, c.counted_by, c.note,
           (SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id = c.id AND l.tenant_id = ${req.tenantId}) AS lines
      FROM stock_counts c
     WHERE c.tenant_id = ${req.tenantId} AND c.venue_id = ${req.params.venueId}
     ORDER BY c.counted_at DESC, c.created_at DESC LIMIT 20`))

  app.get('/counts/:id', { preHandler: canRead }, async req => withTenant(req.tenantId, async tx => {
    const [c] = await tx`SELECT id, venue_id, counted_at, counted_by, note FROM stock_counts WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
    if (!c) throw httpError(404, 'Count not found')
    c.lines = await tx`
      SELECT l.item_id, i.name, i.base_unit, l.qty_base::float8 AS qty_base
        FROM stock_count_lines l JOIN inv_items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id
       WHERE l.count_id = ${c.id} AND l.tenant_id = ${req.tenantId} ORDER BY lower(i.name)`
    return c
  }))

  app.post('/venues/:venueId/counts', { preHandler: canCount }, async (req, reply) => {
    const b = CountBody.parse(req.body || {})
    const at = b.counted_at ? new Date(b.counted_at) : new Date()
    if (at.getTime() > Date.now() + 5 * 60_000 || at.getTime() < Date.now() - BACK_DAYS * 86400_000) {
      throw httpError(422, 'A count is for now or up to ' + BACK_DAYS + ' days back', { code: 'counted_at' })
    }
    const ids = [...new Set(b.lines.map(l => l.item_id))]
    if (ids.length !== b.lines.length) throw httpError(422, 'An item is in the count twice')
    const row = await withTenant(req.tenantId, async tx => {
      // Every item is this group's (rule 4), and each quantity fits how the item is counted.
      const items = await tx`SELECT id, name, base_unit FROM inv_items WHERE tenant_id = ${req.tenantId} AND id = ANY(${ids}::uuid[])`
      if (items.length !== ids.length) throw httpError(404, 'Inventory item not found')
      const byId = new Map(items.map(i => [i.id, i]))
      const lines = b.lines.map(l => {
        const i = byId.get(l.item_id)
        const qty = countToBase(l.qty, l.unit || i.base_unit, i.base_unit)
        if (qty == null) throw httpError(422, i.name + ' is counted in ' + UNITS[i.base_unit].label + ': ' + (l.unit || '') + ' doesn\'t fit', { code: 'unit' })
        return { item_id: i.id, qty_base: qty }
      })
      const [c] = await tx`
        INSERT INTO stock_counts (tenant_id, venue_id, counted_at, counted_by, note)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${at}, ${req.user?.email ?? req.user?.sub ?? null}, ${b.note || null})
        RETURNING id, counted_at`
      await tx`INSERT INTO stock_count_lines ${tx(lines.map(l => ({ ...l, tenant_id: req.tenantId, count_id: c.id })), 'tenant_id', 'count_id', 'item_id', 'qty_base')}`
      return { id: c.id, counted_at: c.counted_at, lines: lines.length }
    })
    return reply.code(201).send(row)
  })
}
