// src/routes/purchasing.js
//
// Ordering from suppliers (migration 153), mounted at /api/purchasing:
//
//   lists   order lists (any mix of suppliers) with a par per venue —
//           purchasing_setup.
//   orders  a venue filling in a list (draft, saved as it's typed), then
//           submitted: split into one purchase order per supplier, each with
//           its delivery date — purchasing.
//   pos     purchase orders: send (email through the venue's provider, or
//           print / Excel / PDF and mark sent), edit before sending, cancel,
//           receive (quantities, shortages, temperatures), which writes the
//           H&S delivery check — purchasing.
//
// Restaurant staff see prices only with purchasing_setup view. Every query
// filters tenant_id itself.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireAnyPermission, permissionLevel } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import {
  fitQty, packsToPar, packLabel, quotePrice, orderTotals, receiveStatusFor, deliveryTempOk, poNumberLabel,
  DELIVERY_TEMP_MAX, RECEIVE_STATUSES,
} from '../../../shared/procurement.js'
import {
  resolveQuotes, quoteView, loadVenue, venueNow, loadSuppliersForVenue, createPurchaseOrder,
  loadPo, loadPoLines, poFile, emailPo,
} from '../services/purchasingSvc.js'

const uuid = z.string().uuid()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const qtyNum = z.number().min(0).max(100000)
const optText = (max = 2000) => z.string().trim().max(max).nullable().optional()
  .transform(v => (v === undefined ? undefined : v || null))

const canSetupView   = requirePermission('purchasing_setup', 'view')
const canSetup       = requirePermission('purchasing_setup', 'manage')
const canRead        = requireAnyPermission(['purchasing', 'purchasing_setup'], 'view')
const canOrder       = requirePermission('purchasing', 'manage')

const MONEY_FIELDS = ['subtotal', 'vat', 'delivery_charge', 'total']

async function showPrices(req) {
  return (await permissionLevel(req, 'purchasing_setup')) !== 'none'
}

const by = req => req.user?.email ?? null

async function checkVenues(tx, tenantId, ids) {
  if (!ids?.length) return
  const rows = await tx`SELECT id FROM venues WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${tenantId}`
  if (rows.length !== new Set(ids).size) throw httpError(404, 'Venue not found')
}

async function checkItems(tx, tenantId, ids) {
  if (!ids?.length) return
  const rows = await tx`SELECT id FROM inv_items WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${tenantId}`
  if (rows.length !== new Set(ids).size) throw httpError(404, 'Item not found')
}

async function ownList(tx, tenantId, id) {
  const [l] = await tx`SELECT * FROM order_lists WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!l) throw httpError(404, 'Order list not found')
  return l
}

async function ownOrder(tx, tenantId, id, { lock = false } = {}) {
  const [o] = lock
    ? await tx`SELECT * FROM supply_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : await tx`SELECT * FROM supply_orders WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!o) throw httpError(404, 'Order not found')
  return o
}

function draftOnly(order) {
  if (order.status !== 'draft') throw httpError(409, 'This order has already been sent to suppliers')
}

async function ownPo(tx, tenantId, id, { lock = false } = {}) {
  const [po] = lock
    ? await tx`SELECT * FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : await tx`SELECT * FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!po) throw httpError(404, 'Purchase order not found')
  return po
}

function hideMoney(row, prices) {
  if (prices) return row
  const out = { ...row }
  for (const k of MONEY_FIELDS) delete out[k]
  return out
}

function supplierView(s, prices) {
  if (!s) return null
  const { min_order, delivery_charge, ...rest } = s
  return prices ? s : rest
}

// ── Order lists ─────────────────────────────────────────────────

async function listItems(tx, tenantId, listId) {
  return tx`
    SELECT li.id AS list_item_id, li.item_id, li.sort_order, i.name, i.base_unit, i.storage, i.is_active, i.code,
           i.category_id, c.name AS category_name, c.sort_order AS category_sort,
           COALESCE((SELECT jsonb_object_agg(p.venue_id::text, p.par_base::float8)
                       FROM order_list_pars p WHERE p.list_item_id = li.id AND p.tenant_id = ${tenantId}), '{}'::jsonb) AS pars
      FROM order_list_items li
      JOIN inv_items i ON i.id = li.item_id AND i.tenant_id = ${tenantId}
      LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${tenantId}
     WHERE li.list_id = ${listId} AND li.tenant_id = ${tenantId}
     ORDER BY li.sort_order, lower(i.name)
  `
}

async function loadList(tx, tenantId, id) {
  const list = await ownList(tx, tenantId, id)
  const venues = await tx`SELECT venue_id FROM order_list_venues WHERE list_id = ${id} AND tenant_id = ${tenantId}`
  const items = await listItems(tx, tenantId, id)
  const { picks } = await resolveQuotes(tx, tenantId, null, items.map(i => i.item_id))
  return {
    ...list,
    venue_ids: venues.map(v => v.venue_id),
    items: items.map(i => ({ ...i, quote: quoteView(picks.get(i.item_id)?.quote, null, true) })),
  }
}

// ── Restaurant orders ───────────────────────────────────────────

/** Everything the order form needs: list items + extra lines, quotes, suppliers. */
async function loadOrder(tx, tenantId, order, prices) {
  const venue = await loadVenue(tx, tenantId, order.venue_id)
  const listed = order.list_id ? await listItems(tx, tenantId, order.list_id) : []
  const lines = await tx`
    SELECT item_id, quote_id, qty::float8 AS qty FROM supply_order_lines
     WHERE order_id = ${order.id} AND tenant_id = ${tenantId}
  `
  const lineBy = new Map(lines.map(l => [l.item_id, l]))
  const listedIds = new Set(listed.map(i => i.item_id))
  const extraIds = lines.map(l => l.item_id).filter(id => !listedIds.has(id))
  const extra = extraIds.length ? await tx`
    SELECT i.id AS item_id, i.name, i.base_unit, i.storage, i.is_active, i.code, c.name AS category_name,
           c.sort_order AS category_sort
      FROM inv_items i LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${tenantId}
     WHERE i.id = ANY(${extraIds}::uuid[]) AND i.tenant_id = ${tenantId}
  ` : []
  const rows = [
    ...listed.filter(i => i.is_active || lineBy.has(i.item_id)).map(i => ({ ...i, on_list: true })),
    ...extra.map(i => ({ ...i, on_list: false, pars: {} })),
  ]
  const ids = rows.map(r => r.item_id)
  const { picks, quotes } = await resolveQuotes(tx, tenantId, venue.id, ids)
  const last = ids.length ? await tx`
    SELECT DISTINCT ON (l.item_id) l.item_id, l.qty::float8 AS qty, l.pack_label, po.delivery_date::text AS delivery_date
      FROM purchase_order_lines l
      JOIN purchase_orders po ON po.id = l.po_id AND po.tenant_id = ${tenantId}
     WHERE l.tenant_id = ${tenantId} AND po.venue_id = ${venue.id} AND po.status <> 'cancelled'
       AND l.item_id = ANY(${ids}::uuid[])
     ORDER BY l.item_id, po.created_at DESC
  ` : []
  const lastBy = new Map(last.map(l => [l.item_id, l]))
  const supplierIds = [...new Set([...quotes.values()].flat().map(q => q.supplier_id))]
  const suppliers = supplierIds.length ? await loadSuppliersForVenue(tx, tenantId, venue, supplierIds) : {}
  const [list] = order.list_id ? await tx`SELECT name FROM order_lists WHERE id = ${order.list_id} AND tenant_id = ${tenantId}` : []

  const items = rows.map(r => {
    const line = lineBy.get(r.item_id)
    const all = quotes.get(r.item_id) || []
    const pick = picks.get(r.item_id)
    const chosen = (line?.quote_id && all.find(q => q.id === line.quote_id)) || pick?.quote || null
    const par = r.pars?.[venue.id] ?? null
    return {
      item_id: r.item_id, name: r.name, code: r.code, base_unit: r.base_unit, storage: r.storage,
      category_name: r.category_name ?? null, category_sort: r.category_sort ?? 9999,
      on_list: r.on_list, is_active: r.is_active, list_sort: r.sort_order ?? 9999,
      par_base: par,
      par_packs: chosen && par != null ? packsToPar(par, chosen) : null,
      quote: quoteView(chosen, venue.id, prices),
      default_quote_id: pick?.quote?.id ?? null,
      quotes: all.map(q => quoteView(q, venue.id, prices)),
      qty: line?.qty ?? 0,
      last: lastBy.get(r.item_id) || null,
    }
  })
  return {
    id: order.id, venue_id: venue.id, venue_name: venue.name, list_id: order.list_id, list_name: list?.name ?? null,
    status: order.status, notes: order.notes, created_by: order.created_by, created_at: order.created_at,
    updated_at: order.updated_at, submitted_at: order.submitted_at, submitted_by: order.submitted_by,
    show_prices: prices, today: venueNow(venue).date,
    suppliers: Object.fromEntries(Object.entries(suppliers).map(([id, s]) => [id, supplierView(s, prices)])),
    items,
  }
}

// ── Purchase orders ─────────────────────────────────────────────

async function poList(tx, tenantId, f) {
  return tx`
    SELECT po.id, po.number, po.venue_id, v.name AS venue_name, po.supplier_id, s.name AS supplier_name,
           s.send_method, (s.email IS NOT NULL AND s.email <> '') AS has_email, s.phone AS supplier_phone,
           po.status, po.delivery_date::text AS delivery_date, po.created_at, po.created_by,
           po.subtotal::float8 AS subtotal, po.vat::float8 AS vat, po.delivery_charge::float8 AS delivery_charge,
           po.total::float8 AS total, po.sent_at, po.sent_via, po.sent_to, po.send_error, po.received_at, po.received_by,
           po.supply_order_id,
           (SELECT count(*)::int FROM purchase_order_lines l WHERE l.po_id = po.id AND l.tenant_id = ${tenantId}) AS line_count,
           dc.id AS delivery_check_id, dc.accepted AS delivery_accepted
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = ${tenantId}
      JOIN venues v ON v.id = po.venue_id AND v.tenant_id = ${tenantId}
      LEFT JOIN fs_delivery_checks dc ON dc.purchase_order_id = po.id AND dc.tenant_id = ${tenantId}
     WHERE po.tenant_id = ${tenantId}
       ${f.venueId ? tx`AND po.venue_id = ${f.venueId}` : tx``}
       ${f.supplierId ? tx`AND po.supplier_id = ${f.supplierId}` : tx``}
       ${f.statuses?.length ? tx`AND po.status = ANY(${f.statuses})` : tx``}
       ${f.from ? tx`AND po.delivery_date >= ${f.from}::date` : tx``}
       ${f.to ? tx`AND po.delivery_date <= ${f.to}::date` : tx``}
       ${f.supplyOrderId ? tx`AND po.supply_order_id = ${f.supplyOrderId}` : tx``}
     ORDER BY po.delivery_date DESC, po.number DESC
     LIMIT ${f.limit || 200}
  `
}

async function poDetail(tx, tenantId, id, prices) {
  const po = await loadPo(tx, tenantId, id)
  const lines = await loadPoLines(tx, tenantId, id)
  const [check] = await tx`
    SELECT id, delivery_date::text AS delivery_date, packaging_ok, damage_ok, quality_ok, temp_ok,
           product_temp_c::float8 AS product_temp_c, items, accepted, corrective_action, notes, recorded_by, recorded_at
      FROM fs_delivery_checks WHERE purchase_order_id = ${id} AND tenant_id = ${tenantId}
  `
  const strip = l => {
    if (prices) return l
    const { price, ...rest } = l
    return rest
  }
  return {
    ...hideMoney(po, prices),
    show_prices: prices,
    lines: lines.map(strip),
    delivery_check: check || null,
  }
}

async function recalcPo(tx, tenantId, poId) {
  const lines = await loadPoLines(tx, tenantId, poId)
  const [po] = await tx`SELECT delivery_charge::float8 AS delivery_charge FROM purchase_orders WHERE id = ${poId} AND tenant_id = ${tenantId}`
  const t = orderTotals(lines, po.delivery_charge)
  await tx`
    UPDATE purchase_orders SET subtotal = ${t.subtotal}, vat = ${t.vat}, total = ${t.total}, updated_at = now()
     WHERE id = ${poId} AND tenant_id = ${tenantId}
  `
}

// ── Schemas ─────────────────────────────────────────────────────

const ListBody = z.object({
  name:      z.string().trim().min(1).max(200),
  notes:     optText(2000),
  is_active: z.boolean().optional(),
  venue_ids: z.array(uuid).max(500).optional(),
  item_ids:  z.array(uuid).max(2000).optional(),
})

const ParsBody = z.object({
  pars: z.array(z.object({ item_id: uuid, venue_id: uuid, par_base: z.number().min(0).max(100000000).nullable() })).max(20000),
})

const LinesBody = z.object({
  lines: z.array(z.object({ item_id: uuid, quote_id: uuid.nullable().optional(), qty: qtyNum })).max(2000),
})

const SubmitBody = z.object({
  suppliers: z.record(z.object({ delivery_date: date.optional(), notes: optText(2000) })).optional(),
})

const PoLinesBody = z.object({
  lines: z.array(z.object({ id: uuid, qty: qtyNum })).max(2000).optional(),
  add:   z.array(z.object({ quote_id: uuid, qty: qtyNum.positive() })).max(500).optional(),
})

const ReceiveBody = z.object({
  received_date: date.optional(),
  notes:         optText(2000),
  lines: z.array(z.object({
    id:           uuid,
    received_qty: qtyNum,
    status:       z.enum(RECEIVE_STATUSES.map(s => s.key)).optional(),
    note:         optText(500),
  })).max(2000),
  check: z.object({
    packaging_ok:      z.boolean(),
    damage_ok:         z.boolean(),
    quality_ok:        z.boolean(),
    chilled_temp_c:    z.number().min(-40).max(40).nullable().optional(),
    frozen_temp_c:     z.number().min(-40).max(40).nullable().optional(),
    accepted:          z.boolean(),
    corrective_action: optText(2000),
  }),
})

// ── Plugin ──────────────────────────────────────────────────────

export default async function purchasingRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Order lists ──
  app.get('/lists', { preHandler: canRead }, async req => {
    const venueId = req.query.venue_id || null
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT l.id, l.name, l.notes, l.is_active, l.sort_order, l.updated_at,
             COALESCE(array_agg(lv.venue_id) FILTER (WHERE lv.venue_id IS NOT NULL), '{}') AS venue_ids,
             (SELECT count(*)::int FROM order_list_items li WHERE li.list_id = l.id AND li.tenant_id = ${req.tenantId}) AS item_count
        FROM order_lists l
        LEFT JOIN order_list_venues lv ON lv.list_id = l.id AND lv.tenant_id = ${req.tenantId}
       WHERE l.tenant_id = ${req.tenantId}
       GROUP BY l.id
       ORDER BY l.sort_order, lower(l.name)
    `)
    return venueId ? rows.filter(l => l.is_active && l.venue_ids.includes(venueId)) : rows
  })

  app.get('/lists/:id', { preHandler: canSetupView }, async req =>
    withTenant(req.tenantId, tx => loadList(tx, req.tenantId, req.params.id)))

  app.post('/lists', { preHandler: canSetup }, async req => {
    const b = ListBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      await checkVenues(tx, req.tenantId, b.venue_ids)
      await checkItems(tx, req.tenantId, b.item_ids)
      const [m] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM order_lists WHERE tenant_id = ${req.tenantId}`
      const [l] = await tx`
        INSERT INTO order_lists (tenant_id, name, notes, is_active, sort_order)
        VALUES (${req.tenantId}, ${b.name}, ${b.notes ?? null}, ${b.is_active ?? true}, ${m.n}) RETURNING id
      `
      if (b.venue_ids?.length) {
        await tx`INSERT INTO order_list_venues ${tx([...new Set(b.venue_ids)].map(v => ({ list_id: l.id, venue_id: v, tenant_id: req.tenantId })))}`
      }
      if (b.item_ids?.length) {
        await tx`INSERT INTO order_list_items ${tx([...new Set(b.item_ids)].map((id, i) => ({ list_id: l.id, item_id: id, tenant_id: req.tenantId, sort_order: i })))}`
      }
      return loadList(tx, req.tenantId, l.id)
    })
  })

  app.patch('/lists/reorder', { preHandler: canSetup }, async req => {
    const { ids } = z.object({ ids: z.array(uuid).max(1000) }).parse(req.body || {})
    await withTenant(req.tenantId, async tx => {
      for (let i = 0; i < ids.length; i++) {
        await tx`UPDATE order_lists SET sort_order = ${i} WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  app.patch('/lists/:id', { preHandler: canSetup }, async req => {
    const b = ListBody.partial().omit({ venue_ids: true, item_ids: true }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const l = await ownList(tx, req.tenantId, req.params.id)
      const fields = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined))
      if (Object.keys(fields).length) {
        await tx`UPDATE order_lists SET ${tx(fields)}, updated_at = now() WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
      }
      return loadList(tx, req.tenantId, l.id)
    })
  })

  app.delete('/lists/:id', { preHandler: canSetup }, async req => withTenant(req.tenantId, async tx => {
    const l = await ownList(tx, req.tenantId, req.params.id)
    await tx`DELETE FROM order_lists WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
    return { ok: true }
  }))

  app.post('/lists/:id/duplicate', { preHandler: canSetup }, async req => withTenant(req.tenantId, async tx => {
    const src = await ownList(tx, req.tenantId, req.params.id)
    const [m] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM order_lists WHERE tenant_id = ${req.tenantId}`
    const [l] = await tx`
      INSERT INTO order_lists (tenant_id, name, notes, is_active, sort_order)
      VALUES (${req.tenantId}, ${(src.name + ' (copy)').slice(0, 200)}, ${src.notes}, ${src.is_active}, ${m.n}) RETURNING id
    `
    await tx`
      INSERT INTO order_list_venues (list_id, venue_id, tenant_id)
      SELECT ${l.id}, venue_id, tenant_id FROM order_list_venues WHERE list_id = ${src.id} AND tenant_id = ${req.tenantId}
    `
    const items = await tx`SELECT id, item_id, sort_order FROM order_list_items WHERE list_id = ${src.id} AND tenant_id = ${req.tenantId}`
    for (const it of items) {
      const [n] = await tx`
        INSERT INTO order_list_items (tenant_id, list_id, item_id, sort_order)
        VALUES (${req.tenantId}, ${l.id}, ${it.item_id}, ${it.sort_order}) RETURNING id
      `
      await tx`
        INSERT INTO order_list_pars (list_item_id, venue_id, tenant_id, par_base)
        SELECT ${n.id}, venue_id, tenant_id, par_base FROM order_list_pars WHERE list_item_id = ${it.id} AND tenant_id = ${req.tenantId}
      `
    }
    return loadList(tx, req.tenantId, l.id)
  }))

  app.put('/lists/:id/venues', { preHandler: canSetup }, async req => {
    const { venue_ids } = z.object({ venue_ids: z.array(uuid).max(500) }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const l = await ownList(tx, req.tenantId, req.params.id)
      await checkVenues(tx, req.tenantId, venue_ids)
      await tx`DELETE FROM order_list_venues WHERE list_id = ${l.id} AND tenant_id = ${req.tenantId}`
      if (venue_ids.length) {
        await tx`INSERT INTO order_list_venues ${tx([...new Set(venue_ids)].map(v => ({ list_id: l.id, venue_id: v, tenant_id: req.tenantId })))}`
      }
      return loadList(tx, req.tenantId, l.id)
    })
  })

  // The list's items in order. Items left out are removed (with their pars);
  // items kept keep their pars.
  app.put('/lists/:id/items', { preHandler: canSetup }, async req => {
    const { item_ids } = z.object({ item_ids: z.array(uuid).max(2000) }).parse(req.body || {})
    const ids = [...new Set(item_ids)]
    return withTenant(req.tenantId, async tx => {
      const l = await ownList(tx, req.tenantId, req.params.id)
      await checkItems(tx, req.tenantId, ids)
      await tx`
        DELETE FROM order_list_items WHERE list_id = ${l.id} AND tenant_id = ${req.tenantId}
           AND NOT (item_id = ANY(${ids}::uuid[]))
      `
      for (let i = 0; i < ids.length; i++) {
        await tx`
          INSERT INTO order_list_items (tenant_id, list_id, item_id, sort_order)
          VALUES (${req.tenantId}, ${l.id}, ${ids[i]}, ${i})
          ON CONFLICT (list_id, item_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
        `
      }
      await tx`UPDATE order_lists SET updated_at = now() WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
      return loadList(tx, req.tenantId, l.id)
    })
  })

  // Pars in the item's base unit; null removes a venue's par.
  app.put('/lists/:id/pars', { preHandler: canSetup }, async req => {
    const { pars } = ParsBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const l = await ownList(tx, req.tenantId, req.params.id)
      await checkVenues(tx, req.tenantId, [...new Set(pars.map(p => p.venue_id))])
      const rows = await tx`SELECT id, item_id FROM order_list_items WHERE list_id = ${l.id} AND tenant_id = ${req.tenantId}`
      const liBy = new Map(rows.map(r => [r.item_id, r.id]))
      for (const p of pars) {
        const li = liBy.get(p.item_id)
        if (!li) throw httpError(422, 'That item is not on this list')
        if (p.par_base == null) {
          await tx`DELETE FROM order_list_pars WHERE list_item_id = ${li} AND venue_id = ${p.venue_id} AND tenant_id = ${req.tenantId}`
        } else {
          await tx`
            INSERT INTO order_list_pars (list_item_id, venue_id, tenant_id, par_base)
            VALUES (${li}, ${p.venue_id}, ${req.tenantId}, ${p.par_base})
            ON CONFLICT (list_item_id, venue_id) DO UPDATE SET par_base = EXCLUDED.par_base
          `
        }
      }
      return loadList(tx, req.tenantId, l.id)
    })
  })

  // ── Catalogue search for the order form (items not on the list) ──
  app.get('/venues/:venueId/catalog', { preHandler: canRead }, async req => {
    const search = String(req.query.search || '').trim().slice(0, 100)
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const venue = await loadVenue(tx, req.tenantId, req.params.venueId)
      const items = await tx`
        SELECT i.id, i.name, i.code, i.base_unit, i.storage, c.name AS category_name
          FROM inv_items i LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${req.tenantId}
         WHERE i.tenant_id = ${req.tenantId} AND i.is_active
           ${search ? tx`AND (i.name ILIKE ${'%' + search + '%'} OR i.code ILIKE ${search + '%'})` : tx``}
           AND EXISTS (SELECT 1 FROM inv_quotes q JOIN suppliers s ON s.id = q.supplier_id AND s.tenant_id = ${req.tenantId}
                        WHERE q.item_id = i.id AND q.tenant_id = ${req.tenantId} AND q.is_active AND s.is_active)
         ORDER BY lower(i.name)
         LIMIT 40
      `
      const { picks, quotes } = await resolveQuotes(tx, req.tenantId, venue.id, items.map(i => i.id))
      return items.map(i => ({
        ...i,
        quote: quoteView(picks.get(i.id)?.quote, venue.id, prices),
        quotes: (quotes.get(i.id) || []).map(q => quoteView(q, venue.id, prices)),
      }))
    })
  })

  // ── Restaurant orders ──
  app.get('/orders', { preHandler: canRead }, async req => {
    const venueId = req.query.venue_id || null
    const status = req.query.status === 'submitted' ? 'submitted' : req.query.status === 'all' ? null : 'draft'
    return withTenant(req.tenantId, tx => tx`
      SELECT o.id, o.venue_id, v.name AS venue_name, o.list_id, l.name AS list_name, o.status, o.notes,
             o.created_by, o.created_at, o.updated_at, o.submitted_at, o.submitted_by,
             (SELECT count(*)::int FROM supply_order_lines sl WHERE sl.order_id = o.id AND sl.tenant_id = ${req.tenantId} AND sl.qty > 0) AS line_count,
             (SELECT count(*)::int FROM purchase_orders po WHERE po.supply_order_id = o.id AND po.tenant_id = ${req.tenantId}) AS po_count
        FROM supply_orders o
        JOIN venues v ON v.id = o.venue_id AND v.tenant_id = ${req.tenantId}
        LEFT JOIN order_lists l ON l.id = o.list_id AND l.tenant_id = ${req.tenantId}
       WHERE o.tenant_id = ${req.tenantId}
         ${venueId ? tx`AND o.venue_id = ${venueId}` : tx``}
         ${status ? tx`AND o.status = ${status}` : tx``}
       ORDER BY o.updated_at DESC
       LIMIT 100
    `)
  })

  // Start an order for a venue from a list (or none, to add items by hand).
  // A draft already open for the same venue and list is reused.
  app.post('/orders', { preHandler: canOrder }, async req => {
    const b = z.object({ venue_id: uuid, list_id: uuid.nullable().optional() }).parse(req.body || {})
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      await loadVenue(tx, req.tenantId, b.venue_id)
      if (b.list_id) {
        await ownList(tx, req.tenantId, b.list_id)
        const [onVenue] = await tx`
          SELECT 1 FROM order_list_venues WHERE list_id = ${b.list_id} AND venue_id = ${b.venue_id} AND tenant_id = ${req.tenantId}
        `
        if (!onVenue) throw httpError(422, 'That order list is not set up for this venue')
      }
      let [o] = await tx`
        SELECT * FROM supply_orders
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${b.venue_id} AND status = 'draft'
           AND list_id IS NOT DISTINCT FROM ${b.list_id ?? null}
         ORDER BY updated_at DESC LIMIT 1
      `
      if (!o) {
        ;[o] = await tx`
          INSERT INTO supply_orders (tenant_id, venue_id, list_id, created_by)
          VALUES (${req.tenantId}, ${b.venue_id}, ${b.list_id ?? null}, ${by(req)}) RETURNING *
        `
      }
      return loadOrder(tx, req.tenantId, o, prices)
    })
  })

  app.get('/orders/:id', { preHandler: canRead }, async req => {
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id)
      const out = await loadOrder(tx, req.tenantId, o, prices)
      if (o.status === 'submitted') {
        out.purchase_orders = (await poList(tx, req.tenantId, { supplyOrderId: o.id })).map(p => hideMoney(p, prices))
      }
      return out
    })
  })

  app.patch('/orders/:id', { preHandler: canOrder }, async req => {
    const b = z.object({ notes: optText(2000) }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id)
      draftOnly(o)
      await tx`UPDATE supply_orders SET notes = ${b.notes ?? null}, updated_at = now() WHERE id = ${o.id} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  // Saves the given lines (autosave sends only what changed). qty 0 keeps
  // the line so a picked supplier is remembered.
  app.put('/orders/:id/lines', { preHandler: canOrder }, async req => {
    const { lines } = LinesBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: true })
      draftOnly(o)
      const itemIds = [...new Set(lines.map(l => l.item_id))]
      await checkItems(tx, req.tenantId, itemIds)
      const quoteIds = [...new Set(lines.map(l => l.quote_id).filter(Boolean))]
      if (quoteIds.length) {
        const qs = await tx`SELECT id, item_id FROM inv_quotes WHERE id = ANY(${quoteIds}::uuid[]) AND tenant_id = ${req.tenantId}`
        const qItem = new Map(qs.map(q => [q.id, q.item_id]))
        for (const l of lines) {
          if (l.quote_id && qItem.get(l.quote_id) !== l.item_id) throw httpError(404, 'Quote not found for this item')
        }
      }
      for (const l of lines) {
        await tx`
          INSERT INTO supply_order_lines (order_id, item_id, tenant_id, quote_id, qty)
          VALUES (${o.id}, ${l.item_id}, ${req.tenantId}, ${l.quote_id ?? null}, ${l.qty})
          ON CONFLICT (order_id, item_id) DO UPDATE
            SET qty = EXCLUDED.qty,
                quote_id = CASE WHEN ${l.quote_id === undefined} THEN supply_order_lines.quote_id ELSE EXCLUDED.quote_id END
        `
      }
      const [u] = await tx`UPDATE supply_orders SET updated_at = now() WHERE id = ${o.id} AND tenant_id = ${req.tenantId} RETURNING updated_at`
      return { ok: true, updated_at: u.updated_at }
    })
  })

  // Take extra (not on the list) lines off the order.
  app.delete('/orders/:id/lines/:itemId', { preHandler: canOrder }, async req => withTenant(req.tenantId, async tx => {
    const o = await ownOrder(tx, req.tenantId, req.params.id)
    draftOnly(o)
    await tx`DELETE FROM supply_order_lines WHERE order_id = ${o.id} AND item_id = ${req.params.itemId} AND tenant_id = ${req.tenantId}`
    return { ok: true }
  }))

  app.delete('/orders/:id', { preHandler: canOrder }, async req => withTenant(req.tenantId, async tx => {
    const o = await ownOrder(tx, req.tenantId, req.params.id)
    draftOnly(o)
    await tx`DELETE FROM supply_orders WHERE id = ${o.id} AND tenant_id = ${req.tenantId}`
    return { ok: true }
  }))

  // Split the order into one purchase order per supplier, each for its
  // supplier's next delivery date unless one is given. Quantities are rounded
  // up to the supplier's minimum and steps. Suppliers that take orders by
  // email are emailed straight after; the rest wait in "To send".
  app.post('/orders/:id/submit', { preHandler: canOrder }, async req => {
    const b = SubmitBody.parse(req.body || {})
    const prices = await showPrices(req)
    const created = await withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: true })
      draftOnly(o)
      const venue = await loadVenue(tx, req.tenantId, o.venue_id)
      const lines = await tx`
        SELECT sl.item_id, sl.quote_id, sl.qty::float8 AS qty, i.name, i.base_unit, i.storage, c.name AS category_name
          FROM supply_order_lines sl
          JOIN inv_items i ON i.id = sl.item_id AND i.tenant_id = ${req.tenantId}
          LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${req.tenantId}
          LEFT JOIN order_list_items li ON li.list_id = ${o.list_id} AND li.item_id = sl.item_id AND li.tenant_id = ${req.tenantId}
         WHERE sl.order_id = ${o.id} AND sl.tenant_id = ${req.tenantId} AND sl.qty > 0
         ORDER BY COALESCE(c.sort_order, 9999), COALESCE(li.sort_order, 9999), lower(i.name)
      `
      if (!lines.length) throw httpError(422, 'Nothing to order yet: enter a quantity first')
      const { picks, quotes } = await resolveQuotes(tx, req.tenantId, venue.id, lines.map(l => l.item_id))
      const groups = new Map()
      const missing = []
      for (const l of lines) {
        const q = (l.quote_id && (quotes.get(l.item_id) || []).find(x => x.id === l.quote_id)) || picks.get(l.item_id)?.quote
        if (!q) { missing.push(l.name); continue }
        if (!groups.has(q.supplier_id)) groups.set(q.supplier_id, [])
        groups.get(q.supplier_id).push({
          item: { id: l.item_id, name: l.name, category_name: l.category_name, storage: l.storage, base_unit: l.base_unit },
          quote: q, qty: fitQty(l.qty, q),
        })
      }
      if (missing.length) throw httpError(422, `No active supplier for: ${missing.join(', ')}`)
      const suppliers = await loadSuppliersForVenue(tx, req.tenantId, venue, [...groups.keys()])
      const today = venueNow(venue).date
      const pos = []
      for (const [sid, group] of groups) {
        const s = suppliers[sid]
        const opt = b.suppliers?.[sid] || {}
        const deliveryDate = opt.delivery_date || s.next_delivery
        if (deliveryDate < today) throw httpError(422, `The delivery date for ${s.name} is in the past`)
        const po = await createPurchaseOrder(tx, req.tenantId, {
          venue, supplier: s, deliveryDate, notes: opt.notes ?? null, lines: group,
          supplyOrderId: o.id, createdBy: by(req),
        })
        pos.push({ id: po.id, supplier: s, subtotal: Number(po.subtotal) })
      }
      await tx`
        UPDATE supply_orders SET status = 'submitted', submitted_at = now(), submitted_by = ${by(req)}, updated_at = now()
         WHERE id = ${o.id} AND tenant_id = ${req.tenantId}
      `
      return { orderId: o.id, pos }
    })

    // Email after the orders are saved, so a failed email never loses them.
    const results = []
    for (const p of created.pos) {
      const r = { id: p.id, supplier_name: p.supplier.name, send_method: p.supplier.send_method, emailed: false, error: null }
      if (p.supplier.min_order && p.subtotal < p.supplier.min_order) r.below_minimum = true
      if (p.supplier.send_method === 'email') {
        if (!p.supplier.email) r.error = `${p.supplier.name} has no order email address`
        else {
          try { await emailPo(req.tenantId, p.id, by(req)); r.emailed = true }
          catch (err) { r.error = err.message }
        }
      }
      results.push(prices ? r : { ...r, below_minimum: undefined })
    }
    const pos = await withTenant(req.tenantId, tx => poList(tx, req.tenantId, { supplyOrderId: created.orderId }))
    return { order_id: created.orderId, results, purchase_orders: pos.map(p => hideMoney(p, prices)) }
  })

  // ── Purchase orders ──
  app.get('/pos', { preHandler: canRead }, async req => {
    const q = req.query || {}
    const statuses = String(q.status || '').split(',').filter(s => ['to_send', 'sent', 'received', 'cancelled'].includes(s))
    const prices = await showPrices(req)
    const rows = await withTenant(req.tenantId, tx => poList(tx, req.tenantId, {
      venueId: q.venue_id || null, supplierId: q.supplier_id || null, statuses,
      from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : null,
      to: /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : null,
      limit: Math.min(Number(q.limit) || 200, 500),
    }))
    return rows.map(r => hideMoney(r, prices))
  })

  app.get('/pos/:id', { preHandler: canRead }, async req => {
    const prices = await showPrices(req)
    return withTenant(req.tenantId, tx => poDetail(tx, req.tenantId, req.params.id, prices))
  })

  app.patch('/pos/:id', { preHandler: canOrder }, async req => {
    const b = z.object({ delivery_date: date.optional(), notes: optText(2000) }).parse(req.body || {})
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (!['to_send', 'sent'].includes(po.status)) throw httpError(409, 'This order can no longer be changed')
      const fields = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined))
      if (Object.keys(fields).length) {
        await tx`UPDATE purchase_orders SET ${tx(fields)}, updated_at = now() WHERE id = ${po.id} AND tenant_id = ${req.tenantId}`
      }
      return poDetail(tx, req.tenantId, po.id, prices)
    })
  })

  // Change quantities (0 removes the line) or add lines from the same
  // supplier, while the order hasn't gone to the supplier.
  app.put('/pos/:id/lines', { preHandler: canOrder }, async req => {
    const b = PoLinesBody.parse(req.body || {})
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (po.status !== 'to_send') throw httpError(409, 'Only an order not yet sent can be changed. Cancel it and order again.')
      const venue = await loadVenue(tx, req.tenantId, po.venue_id)
      for (const l of b.lines || []) {
        const [row] = await tx`SELECT id FROM purchase_order_lines WHERE id = ${l.id} AND po_id = ${po.id} AND tenant_id = ${req.tenantId}`
        if (!row) throw httpError(404, 'Line not found')
        if (l.qty <= 0) await tx`DELETE FROM purchase_order_lines WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
        else await tx`UPDATE purchase_order_lines SET qty = ${l.qty} WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
      }
      if (b.add?.length) {
        const ids = b.add.map(a => a.quote_id)
        const { quotes } = await resolveQuotes(tx, req.tenantId, venue.id,
          (await tx`SELECT DISTINCT item_id FROM inv_quotes WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${req.tenantId}`).map(r => r.item_id))
        const all = [...quotes.values()].flat()
        const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM purchase_order_lines WHERE po_id = ${po.id} AND tenant_id = ${req.tenantId}`
        let sort = Number(n)
        for (const a of b.add) {
          const q = all.find(x => x.id === a.quote_id)
          if (!q || q.supplier_id !== po.supplier_id) throw httpError(422, 'That product is not from this supplier')
          const [item] = await tx`
            SELECT i.id, i.name, i.storage, i.base_unit, c.name AS category_name
              FROM inv_items i LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${req.tenantId}
             WHERE i.id = ${q.item_id} AND i.tenant_id = ${req.tenantId}
          `
          await tx`
            INSERT INTO purchase_order_lines ${tx({
              tenant_id: req.tenantId, po_id: po.id, item_id: item.id, quote_id: q.id, item_name: item.name,
              category_name: item.category_name ?? null, storage: item.storage, base_unit: item.base_unit,
              supplier_code: q.supplier_code ?? null, pack_label: packLabel(q), pack_base_qty: q.pack_base_qty,
              price: quotePrice(q, venue.id), vat_rate: q.vat_rate, qty: fitQty(a.qty, q), sort_order: sort++,
            })}
          `
        }
      }
      const [{ c }] = await tx`SELECT count(*)::int AS c FROM purchase_order_lines WHERE po_id = ${po.id} AND tenant_id = ${req.tenantId}`
      if (!c) throw httpError(422, 'An order needs at least one line. Cancel it instead.')
      await recalcPo(tx, req.tenantId, po.id)
      return poDetail(tx, req.tenantId, po.id, prices)
    })
  })

  app.post('/pos/:id/send', { preHandler: canOrder }, async req => {
    const prices = await showPrices(req)
    await withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id)
      if (!['to_send', 'sent'].includes(po.status)) throw httpError(409, 'This order can no longer be sent')
    })
    await emailPo(req.tenantId, req.params.id, by(req))
    return withTenant(req.tenantId, tx => poDetail(tx, req.tenantId, req.params.id, prices))
  })

  app.post('/pos/:id/mark-sent', { preHandler: canOrder }, async req => {
    const { via } = z.object({ via: z.enum(['email', 'print', 'excel', 'pdf', 'phone', 'other']) }).parse(req.body || {})
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (po.status !== 'to_send') throw httpError(409, 'This order is not waiting to be sent')
      await tx`
        UPDATE purchase_orders SET status = 'sent', sent_at = now(), sent_by = ${by(req)}, sent_via = ${via},
               send_error = NULL, updated_at = now()
         WHERE id = ${po.id} AND tenant_id = ${req.tenantId}
      `
      return poDetail(tx, req.tenantId, po.id, prices)
    })
  })

  // The PO as a file: pdf, xlsx, or html (for printing). It is the
  // document the supplier gets, so it always carries the prices.
  app.get('/pos/:id/file', { preHandler: canRead }, async (req, reply) => {
    const format = ['pdf', 'xlsx', 'html'].includes(req.query.format) ? req.query.format : 'pdf'
    await withTenant(req.tenantId, tx => ownPo(tx, req.tenantId, req.params.id))
    const f = await poFile(req.tenantId, req.params.id, format)
    reply.header('Content-Type', f.contentType)
    reply.header('Content-Disposition', `${format === 'html' ? 'inline' : 'attachment'}; filename="${f.filename}"`)
    return reply.send(f.content)
  })

  app.post('/pos/:id/cancel', { preHandler: canOrder }, async req => {
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (!['to_send', 'sent'].includes(po.status)) throw httpError(409, 'A received or cancelled order cannot be cancelled')
      await tx`
        UPDATE purchase_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${by(req)}, updated_at = now()
         WHERE id = ${po.id} AND tenant_id = ${req.tenantId}
      `
      return poDetail(tx, req.tenantId, po.id, prices)
    })
  })

  // Book a delivery in: what arrived per line, the checks and probe
  // temperatures. Writes (or updates) the venue's H&S delivery check for this
  // order. Can be done again to correct it.
  app.post('/pos/:id/receive', { preHandler: canOrder }, async req => {
    const b = ReceiveBody.parse(req.body || {})
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (!['to_send', 'sent', 'received'].includes(po.status)) throw httpError(409, 'A cancelled order cannot be received')
      const venue = await loadVenue(tx, req.tenantId, po.venue_id)
      const [supplier] = await tx`SELECT name FROM suppliers WHERE id = ${po.supplier_id} AND tenant_id = ${req.tenantId}`
      const lines = await loadPoLines(tx, req.tenantId, po.id)
      const given = new Map(b.lines.map(l => [l.id, l]))
      for (const id of given.keys()) if (!lines.some(l => l.id === id)) throw httpError(404, 'Line not found')

      const c = b.check
      const received = lines.map(l => {
        const g = given.get(l.id)
        const qty = g ? g.received_qty : Number(l.qty)
        return { ...l, received_qty: qty, receive_status: g?.status || receiveStatusFor(l.qty, qty), receive_note: g?.note ?? null }
      })
      const arrived = received.filter(l => l.received_qty > 0)
      const hasChilled = arrived.some(l => l.storage === 'chilled')
      const hasFrozen = arrived.some(l => l.storage === 'frozen')
      if (hasChilled && c.chilled_temp_c == null) throw httpError(422, 'Enter the temperature of the chilled goods')
      if (hasFrozen && c.frozen_temp_c == null) throw httpError(422, 'Enter the temperature of the frozen goods')
      const chilled = hasChilled ? c.chilled_temp_c : null
      const frozen = hasFrozen ? c.frozen_temp_c : null
      const tempOk = deliveryTempOk('chilled', chilled) && deliveryTempOk('frozen', frozen)

      for (const l of received) {
        await tx`
          UPDATE purchase_order_lines SET received_qty = ${l.received_qty}, receive_status = ${l.receive_status},
                 receive_note = ${l.receive_note}
           WHERE id = ${l.id} AND tenant_id = ${req.tenantId}
        `
      }
      await tx`
        UPDATE purchase_orders
           SET status = 'received', received_at = COALESCE(received_at, now()), received_by = ${by(req)},
               receive_notes = ${b.notes ?? null}, updated_at = now()
         WHERE id = ${po.id} AND tenant_id = ${req.tenantId}
      `

      const items = arrived.map(l => ({
        name: l.item_name, qty: l.received_qty, unit: l.pack_label, category: l.category_name ?? null,
        ordered: Number(l.qty), status: l.receive_status,
        ...(l.storage === 'chilled' ? { temp_c: chilled } : l.storage === 'frozen' ? { temp_c: frozen } : {}),
      }))
      const problems = received.filter(l => l.receive_status !== 'ok')
      const summary = [
        `${poNumberLabel(po.number)}: ${arrived.length} of ${lines.length} line${lines.length === 1 ? '' : 's'} delivered`,
        ...problems.map(l => `${l.item_name}: ${RECEIVE_STATUSES.find(s => s.key === l.receive_status)?.label ?? l.receive_status}${l.receive_note ? ` (${l.receive_note})` : ''}`),
        b.notes || null,
      ].filter(Boolean).join('\n')
      const check = {
        delivery_date: b.received_date || venueNow(venue).date,
        vendor_name: supplier.name,
        packaging_ok: c.packaging_ok, damage_ok: c.damage_ok, quality_ok: c.quality_ok, temp_ok: tempOk,
        product_temp_c: chilled ?? frozen ?? null,
        items: tx.json(items),
        accepted: c.accepted,
        corrective_action: c.corrective_action ?? null,
        notes: summary.slice(0, 2000),
        recorded_by: by(req),
      }
      const [existing] = await tx`SELECT id FROM fs_delivery_checks WHERE purchase_order_id = ${po.id} AND tenant_id = ${req.tenantId}`
      if (existing) {
        await tx`UPDATE fs_delivery_checks SET ${tx(check)}, recorded_at = now() WHERE id = ${existing.id} AND tenant_id = ${req.tenantId}`
      } else {
        await tx`INSERT INTO fs_delivery_checks ${tx({ ...check, tenant_id: req.tenantId, venue_id: po.venue_id, purchase_order_id: po.id })}`
      }
      return poDetail(tx, req.tenantId, po.id, prices)
    })
  })

  // Limits shown next to the temperature boxes.
  app.get('/meta', { preHandler: canRead }, async req => ({
    show_prices: await showPrices(req),
    can_order: (await permissionLevel(req, 'purchasing')) === 'manage',
    can_setup: (await permissionLevel(req, 'purchasing_setup')) === 'manage',
    delivery_temp_max: DELIVERY_TEMP_MAX,
  }))
}
