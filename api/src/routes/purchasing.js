// src/routes/purchasing.js
//
// Ordering from suppliers (migration 153), mounted at /api/purchasing:
//
//   lists   order lists (any mix of suppliers) with a par per venue —
//           purchasing_setup.
//   orders  a venue filling in a list (draft, saved as it's typed), then
//           submitted: split into one purchase order per supplier, each with
//           its delivery date — purchasing. People without Purchasing
//           approval send it for approval instead (status requested,
//           migration 180): a second person changes it, places it, splits
//           it into a second order for another day, or sends it back.
//   pos     purchase orders: send (email through the venue's provider, or
//           print / Excel / PDF and mark sent), edit before sending, cancel,
//           split into a second order for another day, receive (quantities,
//           shortages, temperatures), which writes the H&S delivery check.
//           Changing what is ordered (quantities, cancel, split) needs
//           Purchasing approval. Receiving can apply an invoice Pepper read
//           (migration 197, routes/documentRead.js): invoice prices on the
//           lines, lines added for what arrived but wasn't ordered; then
//           POST /pos/:id/price-list updates the supplier prices from it
//           (Purchasing setup manage).
//   basket  a supplier's basket (their website's basket or quick order,
//           pasted or as a file) compared with an order and applied to it
//           (POST /orders/:id/reconcile): matched by the supplier's codes.
//   stock   a supplier price out of stock until a date (PUT
//           /quotes/:id/stock, migration 234): anyone who orders, approves
//           or keeps the catalogue may record what the supplier said.
//           Orders and purchase orders for a day before it say so; nothing
//           moves to another price by itself.
//
// Restaurant staff see prices only with purchasing_setup view. Every query
// filters tenant_id itself.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireAnyPermission, permissionLevel, permissionLevels } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { readSheet, fileText } from '../services/sheetRead.js'
import {
  fitQty, packsToPar, packLabel, quotePrice, orderTotals, receiveStatusFor, deliveryTempOk, poNumberLabel, fmtNum,
  DELIVERY_TEMP_MAX, RECEIVE_STATUSES, deliveryDateChoices, packBaseQty, UNITS, splitProblem, deliveryDayProblem,
  basketFromText, basketFromSheet, mergeBasket, basketDiff, BASKET_MAX_ROWS, nowAt, addDays,
} from '../../../shared/procurement.js'
import {
  resolveQuotes, loadItemQuotes, loadQuotesById, quoteView, loadVenue, venueNow, loadSuppliersForVenue, createPurchaseOrder,
  loadPo, loadPoLines, poFile, emailPo, nextPoNumber,
  invoiceView, codeTaken, codeTakenError,
} from '../services/purchasingSvc.js'

const uuid = z.string().uuid()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const qtyNum = z.number().min(0).max(100000)
const optText = (max = 2000) => z.string().trim().max(max).nullable().optional()
  .transform(v => (v === undefined ? undefined : v || null))

const canSetupView   = requirePermission('purchasing_setup', 'view')
const canSetup       = requirePermission('purchasing_setup', 'manage')
const canRead        = requireAnyPermission(['purchasing', 'purchasing_setup', 'purchasing_approve'], 'view')
const canOrder       = requirePermission('purchasing', 'manage')
const canApprove     = requirePermission('purchasing_approve', 'manage')
const canOrderOrApprove = requireAnyPermission(['purchasing', 'purchasing_approve'], 'manage')
const canMarkStock   = requireAnyPermission(['purchasing', 'purchasing_approve', 'purchasing_setup'], 'manage')

const MONEY_FIELDS = ['subtotal', 'vat', 'delivery_charge', 'total']

async function showPrices(req) {
  return (await permissionLevel(req, 'purchasing_setup')) !== 'none'
}

const by = req => req.user?.email ?? null

/** What the caller may do with orders: fill them in, approve them, see prices. */
async function accessOf(req) {
  const lv = await permissionLevels(req, ['purchasing', 'purchasing_approve', 'purchasing_setup'])
  return {
    order: lv.purchasing === 'manage',
    approve: lv.purchasing_approve === 'manage',
    prices: lv.purchasing_setup !== 'none',
    email: by(req),
  }
}

const NOT_APPROVER = 'Only someone with Purchasing approval can do that. Send the order for approval instead.'

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
  if (order.status === 'requested') throw httpError(409, 'This order is waiting for approval')
  if (order.status !== 'draft') throw httpError(409, 'This order has already been sent to suppliers')
}

/**
 * Who may change an order's lines and notes, or delete it: a draft anyone
 * who orders, a request waiting for approval only an approver.
 */
function assertEditable(order, who) {
  if (order.status === 'draft') {
    if (!who.order) throw httpError(403, 'You can see orders but not fill them in')
    return
  }
  if (order.status === 'requested') {
    if (!who.approve) throw httpError(403, 'This order is waiting for approval: only someone with Purchasing approval can change it')
    return
  }
  throw httpError(409, 'This order has already been sent to suppliers')
}

/** What the caller may do with this order (the screens show only these). */
function orderActions(order, who) {
  const draft = order.status === 'draft'
  const requested = order.status === 'requested'
  return {
    can_edit:     (draft && who.order) || (requested && who.approve),
    can_request:  draft && who.order && !who.approve,
    can_place:    (draft && who.order && who.approve) || (requested && who.approve),
    can_return:   requested && who.approve,
    can_split:    requested && who.approve,
    can_withdraw: requested && (who.approve || (who.order && !!who.email && order.requested_by === who.email)),
    can_delete:   (draft && who.order) || (requested && who.approve),
  }
}

async function ownPo(tx, tenantId, id, { lock = false } = {}) {
  const [po] = lock
    ? await tx`SELECT * FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : await tx`SELECT * FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!po) throw httpError(404, 'Purchase order not found')
  return po
}

/**
 * Refuses a delivery day the supplier can't make (deliveryDayProblem(), the
 * rule the screens show): a past day always; a day they don't deliver, or
 * whose order deadline has passed, unless the person says it was agreed
 * with the supplier (`agreed`). s: loadSuppliersForVenue()'s supplier.
 */
function checkDeliveryDay(s, date, now, agreed) {
  const p = deliveryDayProblem(s, date, now, s.name)
  if (!p || (p.code !== 'past' && agreed)) return
  throw httpError(422, p.code === 'past' ? p.message : `${p.message}. Pick another day, or say it was agreed with ${s.name}.`,
    { code: 'delivery_day', problem: p.code, supplier_id: s.id, delivery_date: date })
}

/** Moving part of a line to another order must leave both parts orderable (splitProblem()). */
function checkSplitQty(name, total, moved, quote) {
  const p = splitProblem(total, moved, quote)
  if (p) throw httpError(422, `${name}: ${p}. Move all of it, none of it, or another amount.`, { code: 'split_qty' })
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

// A supplier price out of stock until a date (migration 234); until null =
// back in stock (clears the note and who marked it too).
const StockBody = z.object({
  until: date.nullable(),
  note:  optText(500),
})

// How far ahead an out of stock date may be.
const STOCK_DAYS_MAX = 366

const ReconcileBody = z.object({
  supplier_id:    uuid,
  text:           z.string().max(200_000).optional(),
  file:           z.string().max(4_000_000).optional(),
  rows:           z.array(z.object({ code: z.string().trim().min(1).max(100), qty: qtyNum })).max(BASKET_MAX_ROWS).optional(),
  remove_missing: z.boolean().optional(),
  dry_run:        z.boolean().optional(),
})

/**
 * An order's lines with a quantity, each with the price it is on (the one
 * it is pinned to whatever its state, else the venue's usual one), as
 * basketDiff() takes them.
 */
async function orderBasketLines(tx, tenantId, order) {
  const rows = await tx`
    SELECT sl.item_id, sl.quote_id, sl.qty::float8 AS qty, i.name AS item_name
      FROM supply_order_lines sl JOIN inv_items i ON i.id = sl.item_id AND i.tenant_id = ${tenantId}
     WHERE sl.order_id = ${order.id} AND sl.tenant_id = ${tenantId} AND sl.qty > 0
  `
  const pinned = await loadQuotesById(tx, tenantId, [...new Set(rows.map(r => r.quote_id).filter(Boolean))])
  const loose = rows.filter(r => !r.quote_id || !pinned.has(r.quote_id)).map(r => r.item_id)
  const { picks } = loose.length ? await resolveQuotes(tx, tenantId, order.venue_id, loose) : { picks: new Map() }
  return rows.map(r => ({
    item_id: r.item_id, item_name: r.item_name, qty: r.qty,
    quote: pinned.get(r.quote_id) || picks.get(r.item_id)?.quote || null,
  }))
}

/**
 * Everything the order form needs: list items + extra lines, quotes,
 * suppliers, the request (who asked, for which days, what they asked for)
 * and what the caller may do with it (`who` from accessOf()).
 */
async function loadOrder(tx, tenantId, order, who) {
  const prices = who.prices
  const venue = await loadVenue(tx, tenantId, order.venue_id)
  const listed = order.list_id ? await listItems(tx, tenantId, order.list_id) : []
  const lines = await tx`
    SELECT item_id, quote_id, qty::float8 AS qty FROM supply_order_lines
     WHERE order_id = ${order.id} AND tenant_id = ${tenantId}
  `
  const lineBy = new Map(lines.map(l => [l.item_id, l]))
  const now = venueNow(venue)
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
  // Prices lines are pinned to that are no longer offered (switched off,
  // or their supplier is): such a line says so instead of moving.
  const goneIds = lines.filter(l => l.qty > 0 && l.quote_id && !(quotes.get(l.item_id) || []).some(q => q.id === l.quote_id)).map(l => l.quote_id)
  const goneBy = await loadQuotesById(tx, tenantId, [...new Set(goneIds)])
  const last = ids.length ? await tx`
    SELECT DISTINCT ON (l.item_id) l.item_id, l.qty::float8 AS qty, l.pack_label, po.delivery_date::text AS delivery_date
      FROM purchase_order_lines l
      JOIN purchase_orders po ON po.id = l.po_id AND po.tenant_id = ${tenantId}
     WHERE l.tenant_id = ${tenantId} AND po.venue_id = ${venue.id} AND po.status <> 'cancelled'
       AND l.item_id = ANY(${ids}::uuid[]) AND l.qty > 0
     ORDER BY l.item_id, po.created_at DESC
  ` : []
  const lastBy = new Map(last.map(l => [l.item_id, l]))
  const supplierIds = [...new Set([...quotes.values()].flat().map(q => q.supplier_id))]
  const suppliers = supplierIds.length ? await loadSuppliersForVenue(tx, tenantId, venue, supplierIds) : {}
  const [list] = order.list_id ? await tx`SELECT name FROM order_lists WHERE id = ${order.list_id} AND tenant_id = ${tenantId}` : []
  // Purchase orders still open at the venue from these suppliers, so placing
  // can ask first when one is already going for the same day.
  const openPos = supplierIds.length && order.status !== 'submitted' ? await tx`
    SELECT id, number, status, supplier_id, delivery_date::text AS delivery_date FROM purchase_orders
     WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id} AND supplier_id = ANY(${supplierIds}::uuid[])
       AND status IN ('to_send', 'sent') AND delivery_date >= ${now.date}::date
     ORDER BY delivery_date, number
  ` : []

  const asked = order.requested_lines || null
  const items = rows.map(r => {
    const line = lineBy.get(r.item_id)
    const all = quotes.get(r.item_id) || []
    const pick = picks.get(r.item_id)
    const qty = line?.qty ?? 0
    // A line with a quantity stays on the price it was filled in on.
    const pinned = line?.quote_id ? all.find(q => q.id === line.quote_id) || null : null
    const goneQuote = qty > 0 && line?.quote_id && !pinned ? goneBy.get(line.quote_id) || null : null
    const chosen = goneQuote ? null : pinned || pick?.quote || null
    const gone = goneQuote
      ? { why: goneQuote.supplier_active === false ? 'supplier_off' : 'price_off', quote: quoteView(goneQuote, venue.id, prices) }
      : qty > 0 && r.is_active === false ? { why: 'item_off' } : null
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
      qty,
      ...(gone ? { gone } : {}),
      ...(asked ? { requested_qty: Number(asked[r.item_id]?.qty ?? 0) } : {}),
      last: lastBy.get(r.item_id) || null,
    }
  })
  return {
    id: order.id, venue_id: venue.id, venue_name: venue.name, list_id: order.list_id, list_name: list?.name ?? null,
    status: order.status, notes: order.notes, created_by: order.created_by, created_at: order.created_at,
    updated_at: order.updated_at, submitted_at: order.submitted_at, submitted_by: order.submitted_by,
    requested_by: order.requested_by, requested_at: order.requested_at,
    supplier_options: order.supplier_options || {},
    returned_by: order.returned_by, returned_at: order.returned_at, return_note: order.return_note,
    split_from: order.split_from,
    show_prices: prices, today: now.date, timezone: venue.timezone || 'Europe/London',
    ...orderActions(order, who),
    suppliers: Object.fromEntries(Object.entries(suppliers).map(([id, s]) => [id, supplierView(s, prices)])),
    open_pos: openPos,
    items,
  }
}

/**
 * An order's lines with a quantity, each with the quote it will be ordered
 * on (the one the line is pinned to, else the venue's usual one), grouped
 * by supplier: { lines, groups: Map supplier_id -> lines }. Refuses an
 * empty order, lines no supplier sells, lines whose pinned price is no
 * longer offered (never quietly another price) and items switched off.
 */
async function orderLines(tx, tenantId, order, venue) {
  const rows = await tx`
    SELECT sl.item_id, sl.quote_id, sl.qty::float8 AS qty, i.name, i.base_unit, i.storage, i.is_active, c.name AS category_name
      FROM supply_order_lines sl
      JOIN inv_items i ON i.id = sl.item_id AND i.tenant_id = ${tenantId}
      LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${tenantId}
      LEFT JOIN order_list_items li ON li.list_id = ${order.list_id} AND li.item_id = sl.item_id AND li.tenant_id = ${tenantId}
     WHERE sl.order_id = ${order.id} AND sl.tenant_id = ${tenantId} AND sl.qty > 0
     ORDER BY COALESCE(c.sort_order, 9999), COALESCE(li.sort_order, 9999), lower(i.name)
  `
  if (!rows.length) throw httpError(422, 'Nothing to order yet: enter a quantity first')
  const { picks, quotes } = await resolveQuotes(tx, tenantId, venue.id, rows.map(l => l.item_id))
  const lines = []
  const groups = new Map()
  const missing = [], gone = [], off = []
  for (const l of rows) {
    if (!l.is_active) { off.push(l.name); continue }
    const q = l.quote_id
      ? (quotes.get(l.item_id) || []).find(x => x.id === l.quote_id)
      : picks.get(l.item_id)?.quote
    if (!q) { (l.quote_id ? gone : missing).push(l.name); continue }
    const line = {
      item_id: l.item_id, name: l.name, qty: l.qty, quote: q,
      item: { id: l.item_id, name: l.name, category_name: l.category_name, storage: l.storage, base_unit: l.base_unit },
    }
    lines.push(line)
    if (!groups.has(q.supplier_id)) groups.set(q.supplier_id, [])
    groups.get(q.supplier_id).push(line)
  }
  const problems = [
    gone.length && `The price picked for ${gone.join(', ')} is no longer offered: pick another (tap the pack) or take ${gone.length === 1 ? 'it' : 'them'} off`,
    off.length && `${off.join(', ')} ${off.length === 1 ? 'is' : 'are'} switched off in the inventory: take ${off.length === 1 ? 'it' : 'them'} off the order`,
    missing.length && `No active supplier for: ${missing.join(', ')}`,
  ].filter(Boolean)
  if (problems.length) {
    throw httpError(422, problems.join('. '), { code: 'order_lines', gone_items: gone, off_items: off, missing_items: missing })
  }
  return { lines, groups }
}

/**
 * Email new or changed purchase orders to suppliers that take orders by
 * email, after the transaction that made them has committed (a failed email
 * never loses an order). [{ id, supplier, subtotal }] -> results per PO.
 */
async function emailNew(req, pos, prices) {
  const results = []
  for (const p of pos) {
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
  return results
}

// ── Purchase orders ─────────────────────────────────────────────

async function poList(tx, tenantId, f) {
  return tx`
    SELECT po.id, po.number, po.venue_id, v.name AS venue_name, v.timezone AS venue_timezone, po.supplier_id, s.name AS supplier_name,
           s.send_method, (s.email IS NOT NULL AND s.email <> '') AS has_email, s.phone AS supplier_phone,
           po.status, po.delivery_date::text AS delivery_date, po.created_at, po.created_by,
           po.subtotal::float8 AS subtotal, po.vat::float8 AS vat, po.delivery_charge::float8 AS delivery_charge,
           po.total::float8 AS total, po.sent_at, po.sent_via, po.sent_to, po.send_error, po.received_at, po.received_by,
           po.supply_order_id, po.requested_by, po.amended_at, po.split_from, po.supplier_ref, s.ref_required,
           -- The supplier's ordering settings at this venue: when an order for its day had to go.
           COALESCE(sv.cutoff_time, s.cutoff_time)::text AS cutoff_time, COALESCE(sv.lead_days, s.lead_days) AS lead_days,
           COALESCE(sv.delivery_days, s.delivery_days) AS delivery_days,
           (SELECT p2.number FROM purchase_orders p2 WHERE p2.id = po.split_from AND p2.tenant_id = ${tenantId}) AS split_from_number,
           (SELECT count(*)::int FROM purchase_order_lines l WHERE l.po_id = po.id AND l.tenant_id = ${tenantId}) AS line_count,
           dc.id AS delivery_check_id, dc.accepted AS delivery_accepted
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = ${tenantId}
      JOIN venues v ON v.id = po.venue_id AND v.tenant_id = ${tenantId}
      LEFT JOIN supplier_venues sv ON sv.supplier_id = po.supplier_id AND sv.venue_id = po.venue_id AND sv.tenant_id = ${tenantId}
      LEFT JOIN fs_delivery_checks dc ON dc.purchase_order_id = po.id AND dc.tenant_id = ${tenantId}
     WHERE po.tenant_id = ${tenantId}
       ${f.venueId ? tx`AND po.venue_id = ${f.venueId}` : tx``}
       ${f.supplierId ? tx`AND po.supplier_id = ${f.supplierId}` : tx``}
       ${f.statuses?.length ? tx`AND po.status = ANY(${f.statuses})` : tx``}
       ${f.from ? tx`AND po.delivery_date >= ${f.from}::date` : tx``}
       ${f.to ? tx`AND po.delivery_date <= ${f.to}::date` : tx``}
       ${f.supplyOrderId ? tx`AND (po.supply_order_id = ${f.supplyOrderId} OR po.id = ANY(
           SELECT unnest(o.added_to_po_ids) FROM supply_orders o WHERE o.id = ${f.supplyOrderId} AND o.tenant_id = ${tenantId}))` : tx``}
       ${f.ids ? tx`AND po.id = ANY(${f.ids}::uuid[])` : tx``}
       ${f.q ? tx`AND (lower(po.supplier_ref) LIKE ${'%' + f.q.toLowerCase() + '%'} OR po.number::text = ${f.q.replace(/^po-?0*/i, '')}
           OR EXISTS (SELECT 1 FROM purchase_order_lines l2 WHERE l2.po_id = po.id AND l2.tenant_id = ${tenantId}
                       AND lower(l2.supplier_code) = ${f.q.toLowerCase()}))` : tx``}
     ${f.asc ? tx`ORDER BY po.delivery_date, po.number` : tx`ORDER BY po.delivery_date DESC, po.number DESC`}
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
    const { price, invoice_price, ...rest } = l
    return rest
  }
  // The supplier's delivery days at this venue, for moving or splitting it.
  const venue = await loadVenue(tx, tenantId, po.venue_id)
  const s = (await loadSuppliersForVenue(tx, tenantId, venue, [po.supplier_id]))[po.supplier_id]
  const splits = await tx`
    SELECT id, number, delivery_date::text AS delivery_date, status FROM purchase_orders
     WHERE tenant_id = ${tenantId} AND (id = ${po.split_from ?? null} OR split_from = ${id})
     ORDER BY number
  `
  return {
    ...hideMoney(po, prices),
    show_prices: prices,
    today: venueNow(venue).date,
    timezone: venue.timezone || 'Europe/London',
    // Where it goes, for the supplier's own checkout (checkoutText()).
    deliver_to: {
      name: venue.name, address_line1: venue.address_line1 ?? null, address_line2: venue.address_line2 ?? null,
      city: venue.city ?? null, postcode: venue.postcode ?? null, phone: venue.phone ?? null,
    },
    delivery_days: s?.delivery_days ?? [],
    cutoff_time: s?.cutoff_time ?? null,
    lead_days: s?.lead_days ?? 1,
    next_delivery: s?.next_delivery ?? null,
    delivery_choices: s ? deliveryDateChoices(s, 8) : [],
    split_from_po: splits.find(x => x.id === po.split_from) || null,
    split_into: splits.filter(x => x.id !== po.split_from),
    lines: lines.map(strip),
    delivery_check: check || null,
    invoices: (await tx`
      SELECT *, invoice_date::text AS invoice_date FROM purchase_invoices
       WHERE po_id = ${id} AND tenant_id = ${tenantId} AND applied_at IS NOT NULL
       ORDER BY applied_at
    `).map(r => { const { lines: _l, ...head } = invoiceView(r, prices); return head }),
    price_list: prices ? await priceListRows(tx, tenantId, po, lines) : [],
  }
}

/**
 * What an applied invoice says that the price list doesn't (prices only):
 * one row per received line with an invoice price.
 *   kind 'price'   the line's supplier price differs from the invoice's
 *   kind 'new'     arrived without a supplier price (added on receipt)
 *   kind 'product' a substitute: the supplier sent another product (its
 *                  code or name differs from the ordered price's)
 * Rows the price list already agrees with aren't listed.
 */
async function priceListRows(tx, tenantId, po, lines) {
  const withInvoice = lines.filter(l => l.invoice_price != null && Number(l.received_qty) > 0 && l.item_id)
  if (!withInvoice.length) return []
  const ids = [...new Set(withInvoice.map(l => l.quote_id).filter(Boolean))]
  const quotes = ids.length ? await tx`
    SELECT q.id, q.price::float8 AS price, q.supplier_code, q.product_name, q.is_active,
           q.pack_name, q.pack_count::float8 AS pack_count, q.pack_qty::float8 AS pack_qty, q.pack_unit,
           (SELECT vp.price::float8 FROM inv_quote_venue_prices vp
             WHERE vp.quote_id = q.id AND vp.venue_id = ${po.venue_id} AND vp.tenant_id = ${tenantId}) AS venue_price
      FROM inv_quotes q WHERE q.id = ANY(${ids}::uuid[]) AND q.tenant_id = ${tenantId}
  ` : []
  const qBy = new Map(quotes.map(q => [q.id, q]))
  const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
  const out = []
  for (const l of withInvoice) {
    const q = l.quote_id ? qBy.get(l.quote_id) : null
    const invPrice = Number(l.invoice_price)
    const base = {
      line_id: l.id, item_id: l.item_id, item_name: l.item_name, invoice_price: invPrice,
      invoice_name: l.invoice_name, invoice_code: l.invoice_code, invoice_pack: l.invoice_pack,
      vat_rate: l.invoice_vat_rate ?? Number(l.vat_rate), pack_label: l.pack_label, pack_spec: l.pack_spec || null,
    }
    if (!q) {
      out.push({ ...base, kind: 'new', quote: null })
      continue
    }
    const otherProduct = l.receive_status === 'substituted' && (
      (l.invoice_code && q.supplier_code && !same(l.invoice_code, q.supplier_code)) ||
      (!l.invoice_code && l.invoice_name && !same(l.invoice_name, q.product_name) && !same(l.invoice_name, l.item_name)))
    const current = q.venue_price ?? q.price
    if (!otherProduct && Math.abs(current - invPrice) < 0.005) continue
    out.push({
      ...base,
      kind: otherProduct ? 'product' : 'price',
      quote: {
        id: q.id, price: q.price, venue_price: q.venue_price, product_name: q.product_name, supplier_code: q.supplier_code,
        pack_label: l.pack_label, pack: { name: q.pack_name, count: q.pack_count, qty: q.pack_qty, unit: q.pack_unit },
      },
    })
  }
  return out
}

/**
 * The open purchase order (to send or sent) the venue already has from the
 * supplier for that day, preferring one not yet sent. Takes a lock per venue
 * and supplier first, so two people placing at once can't both miss it.
 */
async function openPoFor(tx, tenantId, venueId, supplierId, day) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'po-day:' + venueId + ':' + supplierId}, 0))`
  const [po] = await tx`
    SELECT id, number, status, notes, delivery_date::text AS delivery_date FROM purchase_orders
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND supplier_id = ${supplierId}
       AND delivery_date = ${day}::date AND status IN ('to_send', 'sent')
     ORDER BY (status = 'to_send') DESC, number
     LIMIT 1
  `
  return po || null
}

/**
 * Adds a placed order's lines for one supplier to a purchase order not yet
 * sent (the duplicate guard's "add to it"): a product already on it tops its
 * line up to the minimum and steps, the rest become new lines copying the
 * pack, price and VAT as of now, as createPurchaseOrder() does. The order's
 * note is added to the PO's when it says something the PO's doesn't.
 * lines: [{ item, quote, qty }].
 */
async function addToPo(tx, tenantId, po, venue, lines, note) {
  const onOrder = new Map((await tx`
    SELECT id, quote_id, qty::float8 AS qty FROM purchase_order_lines
     WHERE po_id = ${po.id} AND tenant_id = ${tenantId} AND quote_id IS NOT NULL AND NOT added_on_receipt
  `).map(l => [l.quote_id, l]))
  const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM purchase_order_lines WHERE po_id = ${po.id} AND tenant_id = ${tenantId}`
  let sort = Number(n)
  for (const l of lines) {
    const q = l.quote
    const have = onOrder.get(q.id)
    if (have) {
      have.qty = fitQty(have.qty + l.qty, q)
      await tx`UPDATE purchase_order_lines SET qty = ${have.qty} WHERE id = ${have.id} AND tenant_id = ${tenantId}`
      continue
    }
    const [added] = await tx`
      INSERT INTO purchase_order_lines ${tx({
        tenant_id: tenantId, po_id: po.id, item_id: l.item.id, quote_id: q.id, item_name: l.item.name,
        category_name: l.item.category_name ?? null, storage: l.item.storage || 'ambient', base_unit: l.item.base_unit,
        supplier_code: q.supplier_code ?? null, product_name: q.product_name ?? null,
        pack_label: packLabel(q), pack_base_qty: Number(q.pack_base_qty),
        price: quotePrice(q, venue.id), vat_rate: Number(q.vat_rate ?? 0), qty: fitQty(l.qty, q), sort_order: sort++,
      })}
      RETURNING id, quote_id, qty::float8 AS qty
    `
    onOrder.set(q.id, added)
  }
  const text = (note || '').trim()
  if (text && !(po.notes || '').includes(text)) {
    await tx`
      UPDATE purchase_orders SET notes = ${po.notes ? po.notes + '\n' + text : text}, updated_at = now()
       WHERE id = ${po.id} AND tenant_id = ${tenantId}
    `
  }
  await recalcPo(tx, tenantId, po.id)
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

// agreed: the person says the supplier agreed to a day they don't deliver,
// or one past its order deadline (checkDeliveryDay()).
// existing: what to do when the venue already has an open purchase order
// from that supplier for the same day (409 po_exists): add these lines to
// it (only while it hasn't been sent), or place a separate order anyway.
const SubmitBody = z.object({
  suppliers: z.record(uuid, z.object({
    delivery_date: date.optional(),
    notes:         optText(2000),
    agreed:        z.boolean().optional(),
    existing:      z.enum(['add', 'separate']).optional(),
  })).optional(),
})

// How far back an order marked sent by hand may say it went.
const SENT_AT_DAYS = 14
const MarkSentBody = z.object({
  via:          z.enum(['email', 'print', 'excel', 'pdf', 'phone', 'website', 'other']),
  supplier_ref: optText(100),
  sent_at:      z.string().datetime({ offset: true }).optional(),
})
const RequestBody = z.object({
  suppliers: z.record(uuid, z.object({ delivery_date: date.nullable().optional(), notes: optText(2000) })).optional(),
  note:      optText(2000),
})

const SplitOrderBody = z.object({
  lines:     z.array(z.object({ item_id: uuid, qty: qtyNum.positive() })).min(1).max(2000),
  suppliers: z.record(uuid, z.object({ delivery_date: date, notes: optText(2000), agreed: z.boolean().optional() })),
})

const SplitPoBody = z.object({
  lines:         z.array(z.object({ id: uuid, qty: qtyNum.positive() })).min(1).max(2000),
  delivery_date: date,
  notes:         optText(2000),
  agreed:        z.boolean().optional(),
})

const invoiceIdx = z.number().int().min(0).max(1000)
const invoicePrice = z.number().min(0).max(10000000).nullable()
const PackSpec = z.object({
  name:  z.string().trim().max(60).optional(),
  count: z.number().positive().max(100000).optional(),
  qty:   z.number().positive().max(10000000),
  unit:  z.enum(Object.keys(UNITS)),
})

const PriceListBody = z.object({
  changes: z.array(z.object({
    line_id:       uuid,
    action:        z.enum(['company', 'venue', 'add']),
    // add: the new supplier price's details (else from the invoice line).
    pack:          PackSpec.nullable().optional(),
    product_name:  optText(200),
    supplier_code: optText(100),
    vat_rate:      z.number().min(0).max(100).optional(),
    usual:         z.enum(['venue', 'company']).nullable().optional(),
  })).min(1).max(500),
})

const PoLinesBody = z.object({
  lines: z.array(z.object({ id: uuid, qty: qtyNum })).max(2000).optional(),
  add:   z.array(z.object({ quote_id: uuid, qty: qtyNum.positive() })).max(500).optional(),
})

const ReceiveBody = z.object({
  received_date: date.optional(),
  notes:         optText(2000),
  invoice_id:    uuid.nullable().optional(),
  lines: z.array(z.object({
    id:            uuid,
    received_qty:  qtyNum,
    status:        z.enum(RECEIVE_STATUSES.map(s => s.key)).optional(),
    note:          optText(500),
    invoice_idx:   invoiceIdx.nullable().optional(),
    invoice_price: invoicePrice.optional(),
  })).max(2000),
  // Arrived but not ordered: an inventory item with one of this supplier's
  // prices (quote_id), or with its pack as invoiced (no price list entry yet).
  add: z.array(z.object({
    item_id:       uuid,
    quote_id:      uuid.nullable().optional(),
    pack:          PackSpec.nullable().optional(),
    received_qty:  qtyNum.positive(),
    status:        z.enum(RECEIVE_STATUSES.map(s => s.key)).optional(),
    note:          optText(500),
    invoice_idx:   invoiceIdx.nullable().optional(),
    invoice_price: invoicePrice.optional(),
  })).max(200).optional(),
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
  // Items to add to an order (items someone sells); with ?all=1 also items
  // without a supplier price (booking in what arrived but wasn't ordered);
  // with ?supplier_id= only items that supplier sells (adding to one of its
  // purchase orders).
  app.get('/venues/:venueId/catalog', { preHandler: canRead }, async req => {
    const search = String(req.query.search || '').trim().slice(0, 100)
    const supplierId = req.query.supplier_id ? uuid.parse(req.query.supplier_id) : null
    const all = req.query.all === '1' && !supplierId
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const venue = await loadVenue(tx, req.tenantId, req.params.venueId)
      // The search finds names, our item code (from its start) and the
      // suppliers' product codes and names; an exact code comes first
      // (never NULL: DESC would put NULLs before it).
      const like = '%' + search + '%'
      const items = await tx`
        SELECT i.id, i.name, i.code, i.base_unit, i.storage, c.name AS category_name,
               ${search ? tx`(COALESCE(lower(i.code) = lower(${search}), false) OR EXISTS (
                 SELECT 1 FROM inv_quotes q2 WHERE q2.item_id = i.id AND q2.tenant_id = ${req.tenantId} AND q2.is_active
                    AND lower(q2.supplier_code) = lower(${search})
                    ${supplierId ? tx`AND q2.supplier_id = ${supplierId}` : tx``}))` : tx`false`} AS exact
          FROM inv_items i LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${req.tenantId}
         WHERE i.tenant_id = ${req.tenantId} AND i.is_active
           ${search ? tx`AND (i.name ILIKE ${like} OR i.code ILIKE ${search + '%'} OR EXISTS (
               SELECT 1 FROM inv_quotes q3 WHERE q3.item_id = i.id AND q3.tenant_id = ${req.tenantId} AND q3.is_active
                  AND (q3.supplier_code ILIKE ${like} OR q3.product_name ILIKE ${like})
                  ${supplierId ? tx`AND q3.supplier_id = ${supplierId}` : tx``}))` : tx``}
           ${all ? tx`` : tx`AND EXISTS (SELECT 1 FROM inv_quotes q JOIN suppliers s ON s.id = q.supplier_id AND s.tenant_id = ${req.tenantId}
                        WHERE q.item_id = i.id AND q.tenant_id = ${req.tenantId} AND q.is_active AND s.is_active
                          ${supplierId ? tx`AND q.supplier_id = ${supplierId}` : tx``})`}
         ORDER BY exact DESC, lower(i.name)
         LIMIT 40
      `
      const { picks, quotes } = await resolveQuotes(tx, req.tenantId, venue.id, items.map(i => i.id))
      const code = search.toLowerCase()
      return items.map(({ exact, ...i }) => {
        const qs = quotes.get(i.id) || []
        // A supplier's code typed in names that product: callers add it on
        // that price rather than the item's usual one.
        const named = exact && qs.find(q => (q.supplier_code || '').toLowerCase() === code && (!supplierId || q.supplier_id === supplierId))
        return {
          ...i,
          quote: quoteView(picks.get(i.id)?.quote, venue.id, prices),
          quotes: qs.map(q => quoteView(q, venue.id, prices)),
          ...(named ? { matched_quote_id: named.id } : {}),
        }
      })
    })
  })

  // Suppliers someone can order from (switched on, with a live price), for
  // picking whose basket is brought in: codes = their live prices with a
  // product code. Suppliers aren't secret: their names are on every order.
  app.get('/venues/:venueId/suppliers', { preHandler: canRead }, async req => withTenant(req.tenantId, async tx => {
    await loadVenue(tx, req.tenantId, req.params.venueId)
    return tx`
      SELECT s.id, s.name,
             count(q.id) FILTER (WHERE btrim(COALESCE(q.supplier_code, '')) <> '')::int AS codes
        FROM suppliers s
        JOIN inv_quotes q ON q.supplier_id = s.id AND q.tenant_id = ${req.tenantId} AND q.is_active
        JOIN inv_items i ON i.id = q.item_id AND i.tenant_id = ${req.tenantId} AND i.is_active
       WHERE s.tenant_id = ${req.tenantId} AND s.is_active
       GROUP BY s.id, s.name
       ORDER BY lower(s.name)
    `
  }))

  // ── Restaurant orders ──
  app.get('/orders', { preHandler: canRead }, async req => {
    const venueId = req.query.venue_id || null
    const status = ['submitted', 'requested'].includes(req.query.status) ? req.query.status : req.query.status === 'all' ? null : 'draft'
    return withTenant(req.tenantId, tx => tx`
      SELECT o.id, o.venue_id, v.name AS venue_name, o.list_id, l.name AS list_name, o.status, o.notes,
             o.created_by, o.created_at, o.updated_at, o.submitted_at, o.submitted_by,
             o.requested_by, o.requested_at, o.supplier_options, o.returned_by, o.returned_at, o.return_note, o.split_from,
             (SELECT count(*)::int FROM supply_order_lines sl WHERE sl.order_id = o.id AND sl.tenant_id = ${req.tenantId} AND sl.qty > 0) AS line_count,
             (SELECT count(*)::int FROM purchase_orders po WHERE po.supply_order_id = o.id AND po.tenant_id = ${req.tenantId})
               + cardinality(o.added_to_po_ids) AS po_count
        FROM supply_orders o
        JOIN venues v ON v.id = o.venue_id AND v.tenant_id = ${req.tenantId}
        LEFT JOIN order_lists l ON l.id = o.list_id AND l.tenant_id = ${req.tenantId}
       WHERE o.tenant_id = ${req.tenantId}
         ${venueId ? tx`AND o.venue_id = ${venueId}` : tx``}
         ${status ? tx`AND o.status = ${status}` : tx``}
       ORDER BY ${status === 'requested' ? tx`o.requested_at` : tx`o.updated_at DESC`}
       LIMIT 100
    `)
  })

  // Start an order for a venue from a list (or none, to add items by hand).
  // A draft already open for the same venue and list is reused.
  app.post('/orders', { preHandler: canOrder }, async req => {
    const b = z.object({ venue_id: uuid, list_id: uuid.nullable().optional() }).parse(req.body || {})
    const who = await accessOf(req)
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
      return loadOrder(tx, req.tenantId, o, who)
    })
  })

  app.get('/orders/:id', { preHandler: canRead }, async req => {
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id)
      const out = await loadOrder(tx, req.tenantId, o, who)
      if (o.status === 'submitted') {
        out.purchase_orders = (await poList(tx, req.tenantId, { supplyOrderId: o.id })).map(p => hideMoney(p, who.prices))
      }
      return out
    })
  })

  app.patch('/orders/:id', { preHandler: canOrderOrApprove }, async req => {
    const b = z.object({ notes: optText(2000) }).parse(req.body || {})
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id)
      assertEditable(o, who)
      await tx`UPDATE supply_orders SET notes = ${b.notes ?? null}, updated_at = now() WHERE id = ${o.id} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  // Saves the given lines (autosave sends only what changed). qty 0 keeps
  // the line so a picked supplier is remembered. A line with a quantity is
  // pinned to a price: the one given, else the one it already has, else the
  // venue's usual one now, so a later change of usual supplier or a price
  // switched off never moves it by itself (loadOrder() shows it instead).
  // A request waiting for approval is changed only by an approver.
  app.put('/orders/:id/lines', { preHandler: canOrderOrApprove }, async req => {
    const { lines } = LinesBody.parse(req.body || {})
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: true })
      assertEditable(o, who)
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
      const stored = new Map((await tx`
        SELECT item_id, quote_id FROM supply_order_lines
         WHERE order_id = ${o.id} AND tenant_id = ${req.tenantId} AND item_id = ANY(${itemIds}::uuid[])
      `).map(r => [r.item_id, r.quote_id]))
      const unpinned = lines.filter(l => l.qty > 0 && !(l.quote_id !== undefined ? l.quote_id : stored.get(l.item_id)))
      const { picks } = unpinned.length
        ? await resolveQuotes(tx, req.tenantId, o.venue_id, [...new Set(unpinned.map(l => l.item_id))])
        : { picks: new Map() }
      for (const l of lines) {
        let quoteId = l.quote_id
        if (unpinned.includes(l)) quoteId = picks.get(l.item_id)?.quote?.id ?? quoteId
        await tx`
          INSERT INTO supply_order_lines (order_id, item_id, tenant_id, quote_id, qty)
          VALUES (${o.id}, ${l.item_id}, ${req.tenantId}, ${quoteId ?? null}, ${l.qty})
          ON CONFLICT (order_id, item_id) DO UPDATE
            SET qty = EXCLUDED.qty,
                quote_id = CASE WHEN ${quoteId === undefined} THEN supply_order_lines.quote_id ELSE EXCLUDED.quote_id END
        `
      }
      const [u] = await tx`UPDATE supply_orders SET updated_at = now() WHERE id = ${o.id} AND tenant_id = ${req.tenantId} RETURNING updated_at`
      return { ok: true, updated_at: u.updated_at }
    })
  })

  // Take extra (not on the list) lines off the order.
  app.delete('/orders/:id/lines/:itemId', { preHandler: canOrderOrApprove }, async req => {
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id)
      assertEditable(o, who)
      await tx`DELETE FROM supply_order_lines WHERE order_id = ${o.id} AND item_id = ${req.params.itemId} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  // A supplier's basket brought into the order: pasted text (CODE:QTY,
  // one a line, or a CSV), a CSV or Excel file (base64) or rows (Pepper).
  // Codes are matched to the supplier's live prices (one code, one product)
  // and the order changed to match: lines added, quantities changed (also
  // moved onto this supplier's price from another), and with
  // remove_missing (the default) this supplier's lines the basket doesn't
  // have taken off. Quantities go up to the price's minimum and steps, as
  // placing does. Codes not found, switched off or on two products are
  // listed and left out. dry_run says what would change.
  app.post('/orders/:id/reconcile', { preHandler: canOrderOrApprove, bodyLimit: 6 * 1024 * 1024 }, async req => {
    const b = ReconcileBody.parse(req.body || {})
    const given = [b.file, b.text, b.rows].filter(v => v != null).length
    if (given !== 1) throw httpError(400, 'Send the basket as a file, pasted lines or rows')
    // A CSV or text file is read like pasted text; an Excel file as a sheet.
    const fromFile = b.file != null ? fileText(b.file) : null
    const read = b.file != null ? (fromFile != null ? basketFromText(fromFile) : basketFromSheet(readSheet(b.file)))
      : b.text != null ? basketFromText(b.text)
      : { rows: b.rows.map((r, i) => ({ row: i + 1, code: r.code, qty: r.qty })) }
    if (read.error) throw httpError(422, read.error)
    if (!read.rows.length) throw httpError(422, 'No codes found in the basket')
    if (read.rows.length > BASKET_MAX_ROWS) throw httpError(422, `Bring in up to ${BASKET_MAX_ROWS} lines at a time`)
    const who = await accessOf(req)
    const apply = !b.dry_run
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: apply })
      assertEditable(o, who)
      const [supplier] = await tx`SELECT id, name, is_active FROM suppliers WHERE id = ${b.supplier_id} AND tenant_id = ${req.tenantId}`
      if (!supplier) throw httpError(404, 'Supplier not found')
      if (!supplier.is_active) throw httpError(422, `${supplier.name} is switched off in Suppliers`)
      const quotes = await tx`
        SELECT q.id, q.item_id, q.supplier_code, q.product_name, q.pack_name, q.pack_count::float8 AS pack_count,
               q.pack_qty::float8 AS pack_qty, q.pack_unit, q.min_qty::float8 AS min_qty,
               q.order_multiple::float8 AS order_multiple, (q.is_active AND i.is_active) AS live, i.name AS item_name
          FROM inv_quotes q JOIN inv_items i ON i.id = q.item_id AND i.tenant_id = ${req.tenantId}
         WHERE q.tenant_id = ${req.tenantId} AND q.supplier_id = ${supplier.id} AND btrim(COALESCE(q.supplier_code, '')) <> ''
         ORDER BY lower(i.name), q.id
      `
      const lines = await orderBasketLines(tx, req.tenantId, o)
      const basket = mergeBasket(read.rows)
      const diff = basketDiff({ basket: basket.lines, quotes, lines, supplierId: supplier.id, removeMissing: b.remove_missing !== false })
      const out = {
        supplier: { id: supplier.id, name: supplier.name }, rows: read.rows.length, remove_missing: b.remove_missing !== false,
        ...diff, errors: [...basket.errors, ...diff.errors], dry_run: !apply,
      }
      if (!apply) return out
      for (const l of [...diff.added, ...diff.changed]) {
        await tx`
          INSERT INTO supply_order_lines (order_id, item_id, tenant_id, quote_id, qty)
          VALUES (${o.id}, ${l.item_id}, ${req.tenantId}, ${l.quote_id}, ${l.qty})
          ON CONFLICT (order_id, item_id) DO UPDATE SET qty = EXCLUDED.qty, quote_id = EXCLUDED.quote_id
        `
      }
      for (const l of diff.removed) {
        await tx`UPDATE supply_order_lines SET qty = 0 WHERE order_id = ${o.id} AND item_id = ${l.item_id} AND tenant_id = ${req.tenantId}`
      }
      const [u] = await tx`UPDATE supply_orders SET updated_at = now() WHERE id = ${o.id} AND tenant_id = ${req.tenantId} RETURNING *`
      return { ...out, order: await loadOrder(tx, req.tenantId, u, who) }
    })
  })

  // A draft by anyone who orders; a request waiting for approval (declined)
  // by an approver.
  app.delete('/orders/:id', { preHandler: canOrderOrApprove }, async req => {
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id)
      assertEditable(o, who)
      await tx`DELETE FROM supply_orders WHERE id = ${o.id} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  // Send a draft for approval, with the delivery day wanted from each
  // supplier and a note for the approver. What was asked for is kept, so
  // the approver's changes show against it.
  app.post('/orders/:id/request', { preHandler: canOrder }, async req => {
    const b = RequestBody.parse(req.body || {})
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: true })
      draftOnly(o)
      const venue = await loadVenue(tx, req.tenantId, o.venue_id)
      const { lines, groups } = await orderLines(tx, req.tenantId, o, venue)
      const today = venueNow(venue).date
      const options = {}
      for (const sid of groups.keys()) {
        const opt = b.suppliers?.[sid] || {}
        if (opt.delivery_date && opt.delivery_date < today) throw httpError(422, 'A delivery date is in the past')
        // The notes key only when one was sent: a note left out takes the
        // venue's driver instructions when placed, one cleared stays empty.
        const entry = {}
        if (opt.delivery_date) entry.delivery_date = opt.delivery_date
        if (opt.notes !== undefined) entry.notes = opt.notes
        if (Object.keys(entry).length) options[sid] = entry
      }
      const asked = Object.fromEntries(lines.map(l => [l.item_id, { qty: l.qty, quote_id: l.quote.id }]))
      const [u] = await tx`
        UPDATE supply_orders
           SET status = 'requested', requested_by = ${by(req)}, requested_at = now(), requested_lines = ${tx.json(asked)},
               supplier_options = ${tx.json(options)},
               notes = ${b.note === undefined ? o.notes : b.note}, return_note = NULL, updated_at = now()
         WHERE id = ${o.id} AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      return loadOrder(tx, req.tenantId, u, who)
    })
  })

  // An approver sends a request back to be changed: a draft again, with a
  // note saying why.
  app.post('/orders/:id/return', { preHandler: canApprove }, async req => {
    const { note } = z.object({ note: z.string().trim().min(1, 'Say why it is going back').max(2000) }).parse(req.body || {})
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: true })
      if (o.status !== 'requested') throw httpError(409, 'Only an order waiting for approval can be sent back')
      const [u] = await tx`
        UPDATE supply_orders
           SET status = 'draft', returned_by = ${by(req)}, returned_at = now(), return_note = ${note}, updated_at = now()
         WHERE id = ${o.id} AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      return loadOrder(tx, req.tenantId, u, who)
    })
  })

  // The person who asked (or an approver) takes a request back to change it.
  app.post('/orders/:id/withdraw', { preHandler: canOrderOrApprove }, async req => {
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: true })
      if (o.status !== 'requested') throw httpError(409, 'This order is not waiting for approval')
      if (!orderActions(o, who).can_withdraw) throw httpError(403, 'Only the person who asked, or an approver, can take this request back')
      const [u] = await tx`
        UPDATE supply_orders SET status = 'draft', return_note = NULL, updated_at = now()
         WHERE id = ${o.id} AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      return loadOrder(tx, req.tenantId, u, who)
    })
  })

  // An approver splits a request into two for different days: the moved
  // quantities become a second request (same list, same person asking) with
  // its own delivery day per supplier. Each is then placed on its own.
  app.post('/orders/:id/split', { preHandler: canApprove }, async req => {
    const b = SplitOrderBody.parse(req.body || {})
    const who = await accessOf(req)
    return withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: true })
      if (o.status !== 'requested') throw httpError(409, 'Only an order waiting for approval can be split here. A placed order is split from its purchase order.')
      const venue = await loadVenue(tx, req.tenantId, o.venue_id)
      const { lines } = await orderLines(tx, req.tenantId, o, venue)
      const lineBy = new Map(lines.map(l => [l.item_id, l]))
      const moves = new Map()
      for (const m of b.lines) {
        const l = lineBy.get(m.item_id)
        if (!l) throw httpError(422, 'That item is not on this order')
        const total = (moves.get(m.item_id) || 0) + m.qty
        if (total > l.qty + 1e-9) throw httpError(422, `Only ${fmtNum(l.qty)} of ${l.name} can move`)
        moves.set(m.item_id, total)
      }
      if (lines.every(l => (moves.get(l.item_id) || 0) >= l.qty - 1e-9)) {
        throw httpError(422, 'That moves the whole order: change its delivery days instead')
      }
      for (const [itemId, qty] of moves) {
        const l = lineBy.get(itemId)
        checkSplitQty(l.name, l.qty, qty, l.quote)
      }
      const movedSuppliers = [...new Set(lines.filter(l => moves.has(l.item_id)).map(l => l.quote.supplier_id))]
      const suppliers = await loadSuppliersForVenue(tx, req.tenantId, venue, movedSuppliers)
      const now = venueNow(venue)
      const options = {}
      for (const sid of movedSuppliers) {
        const s = suppliers[sid]
        const date = b.suppliers?.[sid]?.delivery_date
        if (!date) throw httpError(422, `Pick a delivery day for the second order from ${s.name}`)
        checkDeliveryDay(s, date, now, b.suppliers[sid].agreed)
        const first = o.supplier_options?.[sid]?.delivery_date || s.next_delivery
        if (date === first) throw httpError(422, `The second order from ${s.name} must be for another day than this one`)
        options[sid] = { delivery_date: date }
        const firstOpt = o.supplier_options?.[sid] || {}
        if (b.suppliers[sid].notes !== undefined) options[sid].notes = b.suppliers[sid].notes
        else if (Object.prototype.hasOwnProperty.call(firstOpt, 'notes')) options[sid].notes = firstOpt.notes
      }
      const asked = o.requested_lines || {}
      const newAsked = {}
      const leftAsked = { ...asked }
      for (const [itemId, qty] of moves) {
        const was = Number(asked[itemId]?.qty ?? 0)
        newAsked[itemId] = { qty: Math.min(qty, was), quote_id: lineBy.get(itemId).quote.id }
        if (asked[itemId]) leftAsked[itemId] = { ...asked[itemId], qty: Math.max(0, was - qty) }
      }
      const [n] = await tx`
        INSERT INTO supply_orders (tenant_id, venue_id, list_id, status, notes, created_by, requested_by, requested_at,
                                   requested_lines, supplier_options, split_from)
        VALUES (${req.tenantId}, ${o.venue_id}, ${o.list_id}, 'requested', ${o.notes}, ${o.created_by}, ${o.requested_by},
                ${o.requested_at}, ${tx.json(newAsked)}, ${tx.json(options)}, ${o.id})
        RETURNING id
      `
      for (const [itemId, qty] of moves) {
        const l = lineBy.get(itemId)
        await tx`
          INSERT INTO supply_order_lines (order_id, item_id, tenant_id, quote_id, qty)
          VALUES (${n.id}, ${itemId}, ${req.tenantId}, ${l.quote.id}, ${qty})
        `
        await tx`
          UPDATE supply_order_lines SET qty = GREATEST(qty - ${qty}, 0)
           WHERE order_id = ${o.id} AND item_id = ${itemId} AND tenant_id = ${req.tenantId}
        `
      }
      const [u] = await tx`
        UPDATE supply_orders SET requested_lines = ${o.requested_lines ? tx.json(leftAsked) : null}, updated_at = now()
         WHERE id = ${o.id} AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      return { order: await loadOrder(tx, req.tenantId, u, who), new_order_id: n.id }
    })
  })

  // Place the order: one purchase order per supplier, each for the day the
  // request asked for (or the supplier's next delivery day) unless one is
  // given here. Quantities are rounded up to the supplier's minimum and
  // steps. A note never written takes the venue's driver instructions for
  // that supplier. When the venue already has an open purchase order from a
  // supplier for that day, nothing is placed (409 po_exists, every such
  // supplier listed) until the caller says, per supplier, whether to add the
  // lines to it (not once sent) or place a separate order. Suppliers that
  // take orders by email are emailed straight after (an order added to is
  // emailed whole); the rest wait in "To send". Needs Purchasing approval.
  app.post('/orders/:id/submit', { preHandler: canApprove }, async req => {
    const b = SubmitBody.parse(req.body || {})
    const who = await accessOf(req)
    const prices = who.prices
    const created = await withTenant(req.tenantId, async tx => {
      const o = await ownOrder(tx, req.tenantId, req.params.id, { lock: true })
      if (o.status === 'submitted') throw httpError(409, 'This order has already been sent to suppliers')
      if (o.status === 'draft' && !who.order) throw httpError(403, 'You can see orders but not fill them in')
      const venue = await loadVenue(tx, req.tenantId, o.venue_id)
      const { groups } = await orderLines(tx, req.tenantId, o, venue)
      const suppliers = await loadSuppliersForVenue(tx, req.tenantId, venue, [...groups.keys()])
      const now = venueNow(venue)
      const asked = o.status === 'requested' ? o.supplier_options || {} : {}
      const pos = [], added = [], conflicts = []
      for (const [sid, group] of groups) {
        const s = suppliers[sid]
        const sent = b.suppliers?.[sid] || {}
        const opt = { ...(asked[sid] || {}), ...Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== undefined)) }
        const deliveryDate = opt.delivery_date || s.next_delivery
        // The day asked for may have gone past its cutoff since: the approver
        // agrees it with the supplier or picks another.
        checkDeliveryDay(s, deliveryDate, now, sent.agreed)
        const notes = Object.prototype.hasOwnProperty.call(opt, 'notes') ? opt.notes : s.driver_instructions ?? null
        const lines = group.map(l => ({ item: l.item, quote: l.quote, qty: fitQty(l.qty, l.quote) }))
        const open = await openPoFor(tx, req.tenantId, venue.id, sid, deliveryDate)
        if (open && !sent.existing) {
          conflicts.push({ supplier_id: sid, po_id: open.id, po_number: open.number, po_status: open.status, delivery_date: deliveryDate })
          continue
        }
        if (open && sent.existing === 'add') {
          if (open.status !== 'to_send') {
            throw httpError(422, `${poNumberLabel(open.number)} has already gone to ${s.name}: place a separate order instead`,
              { code: 'po_sent', supplier_id: sid, po_id: open.id })
          }
          await addToPo(tx, req.tenantId, open, venue, lines, notes)
          const [after] = await tx`SELECT subtotal::float8 AS subtotal FROM purchase_orders WHERE id = ${open.id} AND tenant_id = ${req.tenantId}`
          pos.push({ id: open.id, supplier: s, subtotal: after.subtotal })
          added.push(open.id)
          continue
        }
        const po = await createPurchaseOrder(tx, req.tenantId, {
          venue, supplier: s, deliveryDate, notes, lines,
          supplyOrderId: o.id, createdBy: by(req), requestedBy: o.status === 'requested' ? o.requested_by : null,
        })
        pos.push({ id: po.id, supplier: s, subtotal: Number(po.subtotal) })
      }
      if (conflicts.length) {
        const said = conflicts.map(c => `${suppliers[c.supplier_id].name} already has ${poNumberLabel(c.po_number)} for that day (${c.po_status === 'to_send' ? 'not sent yet' : 'sent'})`)
        throw httpError(409, `${said.join('. ')}. Add to it, or place a separate order.`, { code: 'po_exists', conflicts })
      }
      await tx`
        UPDATE supply_orders SET status = 'submitted', submitted_at = now(), submitted_by = ${by(req)},
               added_to_po_ids = ${added}::uuid[], updated_at = now()
         WHERE id = ${o.id} AND tenant_id = ${req.tenantId}
      `
      return { orderId: o.id, pos, added }
    })
    const results = await emailNew(req, created.pos, prices)
    const pos = await withTenant(req.tenantId, tx => poList(tx, req.tenantId, { supplyOrderId: created.orderId }))
    return {
      order_id: created.orderId, results, added_to: created.added,
      purchase_orders: pos.map(p => hideMoney(p, prices)),
    }
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
      // A supplier's order reference, our PO number (PO-00012 or 12) or a
      // supplier's product code on one of its lines.
      q: String(q.q || '').trim().slice(0, 100) || null,
      // Soonest delivery first (Today's orders to send), else latest first.
      asc: q.order === 'asc',
      limit: Math.min(Number(q.limit) || 200, 500),
    }))
    return rows.map(r => hideMoney(r, prices))
  })

  app.get('/pos/:id', { preHandler: canRead }, async req => {
    const prices = await showPrices(req)
    return withTenant(req.tenantId, tx => poDetail(tx, req.tenantId, req.params.id, prices))
  })

  // A new delivery day is checked like placing (checkDeliveryDay(): agreed
  // for a day the supplier doesn't deliver or one past its cutoff). The day
  // and notes change only before it arrives; the supplier's order reference
  // can be added or corrected any time but once cancelled.
  app.patch('/pos/:id', { preHandler: canOrderOrApprove }, async req => {
    const { agreed, ...b } = z.object({
      delivery_date: date.optional(), notes: optText(2000), supplier_ref: optText(100), agreed: z.boolean().optional(),
    }).parse(req.body || {})
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (po.status === 'cancelled') throw httpError(409, 'This order has been cancelled')
      if ((b.delivery_date !== undefined || b.notes !== undefined) && !['to_send', 'sent'].includes(po.status)) {
        throw httpError(409, 'This order can no longer be changed')
      }
      if (b.delivery_date) {
        const [{ day }] = await tx`SELECT delivery_date::text AS day FROM purchase_orders WHERE id = ${po.id} AND tenant_id = ${req.tenantId}`
        if (b.delivery_date !== day) {
          const venue = await loadVenue(tx, req.tenantId, po.venue_id)
          const s = (await loadSuppliersForVenue(tx, req.tenantId, venue, [po.supplier_id]))[po.supplier_id]
          checkDeliveryDay(s, b.delivery_date, venueNow(venue), agreed)
        } else delete b.delivery_date
      }
      const fields = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined))
      if (Object.keys(fields).length) {
        await tx`UPDATE purchase_orders SET ${tx(fields)}, updated_at = now() WHERE id = ${po.id} AND tenant_id = ${req.tenantId}`
      }
      return poDetail(tx, req.tenantId, po.id, prices)
    })
  })

  // Change quantities (0 removes the line) or add products from the same
  // supplier (add: its active prices at today's price for the venue), while
  // the order hasn't gone to the supplier. Quantities are rounded up to the
  // supplier's minimum and steps (a changed line: the price's own today,
  // while it is for the same pack). A product already on the order tops its
  // line up rather than making a second line. Needs approval.
  app.put('/pos/:id/lines', { preHandler: canApprove }, async req => {
    const b = PoLinesBody.parse(req.body || {})
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (po.status !== 'to_send') throw httpError(409, 'Only an order not yet sent can be changed. Cancel it and order again.')
      const venue = await loadVenue(tx, req.tenantId, po.venue_id)
      const current = new Map((await loadPoLines(tx, req.tenantId, po.id)).map(l => [l.id, l]))
      for (const l of b.lines || []) {
        const row = current.get(l.id)
        if (!row) throw httpError(404, 'Line not found')
        if (l.qty <= 0) await tx`DELETE FROM purchase_order_lines WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
        else if (Math.abs(l.qty - row.qty) > 1e-9) {
          await tx`UPDATE purchase_order_lines SET qty = ${fitQty(l.qty, row)} WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
        }
      }
      if (b.add?.length) {
        const ids = [...new Set(b.add.map(a => a.quote_id))]
        const itemIds = (await tx`SELECT DISTINCT item_id FROM inv_quotes WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${req.tenantId}`).map(r => r.item_id)
        const quotes = [...(await loadItemQuotes(tx, req.tenantId, itemIds)).values()].flat()
        const items = new Map((await tx`
          SELECT i.id, i.name, i.storage, i.base_unit, i.is_active, c.name AS category_name
            FROM inv_items i LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${req.tenantId}
           WHERE i.id = ANY(${itemIds}::uuid[]) AND i.tenant_id = ${req.tenantId}
        `).map(i => [i.id, i]))
        const onOrder = new Map((await tx`
          SELECT id, quote_id, qty::float8 AS qty FROM purchase_order_lines
           WHERE po_id = ${po.id} AND tenant_id = ${req.tenantId} AND quote_id IS NOT NULL AND NOT added_on_receipt
        `).map(l => [l.quote_id, l]))
        const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM purchase_order_lines WHERE po_id = ${po.id} AND tenant_id = ${req.tenantId}`
        let sort = Number(n)
        for (const a of b.add) {
          const q = quotes.find(x => x.id === a.quote_id)
          if (!q || q.supplier_id !== po.supplier_id) throw httpError(422, 'That product is not from this supplier')
          const item = items.get(q.item_id)
          if (!item.is_active) throw httpError(422, `${item.name} is switched off in the inventory`)
          const line = onOrder.get(q.id)
          if (line) {
            line.qty = fitQty(line.qty + a.qty, q)
            await tx`UPDATE purchase_order_lines SET qty = ${line.qty} WHERE id = ${line.id} AND tenant_id = ${req.tenantId}`
            continue
          }
          const [added] = await tx`
            INSERT INTO purchase_order_lines ${tx({
              tenant_id: req.tenantId, po_id: po.id, item_id: item.id, quote_id: q.id, item_name: item.name,
              category_name: item.category_name ?? null, storage: item.storage, base_unit: item.base_unit,
              supplier_code: q.supplier_code ?? null, product_name: q.product_name ?? null,
              pack_label: packLabel(q), pack_base_qty: q.pack_base_qty,
              price: quotePrice(q, venue.id), vat_rate: q.vat_rate, qty: fitQty(a.qty, q), sort_order: sort++,
            })}
            RETURNING id, quote_id, qty::float8 AS qty
          `
          onOrder.set(q.id, added)
        }
      }
      const [{ c }] = await tx`SELECT count(*)::int AS c FROM purchase_order_lines WHERE po_id = ${po.id} AND tenant_id = ${req.tenantId}`
      if (!c) throw httpError(422, 'An order needs at least one line. Cancel it instead.')
      await recalcPo(tx, req.tenantId, po.id)
      return poDetail(tx, req.tenantId, po.id, prices)
    })
  })

  app.post('/pos/:id/send', { preHandler: canOrderOrApprove }, async req => {
    const prices = await showPrices(req)
    await withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id)
      if (!['to_send', 'sent'].includes(po.status)) throw httpError(409, 'This order can no longer be sent')
    })
    await emailPo(req.tenantId, req.params.id, by(req))
    return withTenant(req.tenantId, tx => poDetail(tx, req.tenantId, req.params.id, prices))
  })

  // Marked as sent by hand (printed, phoned, put in on their website): with
  // the supplier's own order reference (required for suppliers set to need
  // it) and, when it went earlier, the time it went (the last 14 days, not
  // before the order was made).
  app.post('/pos/:id/mark-sent', { preHandler: canOrderOrApprove }, async req => {
    const b = MarkSentBody.parse(req.body || {})
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (po.status !== 'to_send') throw httpError(409, 'This order is not waiting to be sent')
      const [s] = await tx`SELECT name, ref_required FROM suppliers WHERE id = ${po.supplier_id} AND tenant_id = ${req.tenantId}`
      if (s.ref_required && !b.supplier_ref) {
        throw httpError(422, `${s.name} needs their order reference: type in the reference from their confirmation`, { code: 'supplier_ref' })
      }
      let sentAt = null
      if (b.sent_at) {
        sentAt = new Date(b.sent_at)
        const now = Date.now()
        if (sentAt.getTime() > now + 5 * 60_000) throw httpError(422, 'The time it went can\'t be in the future', { code: 'sent_at' })
        if (sentAt.getTime() < now - SENT_AT_DAYS * 86_400_000) {
          throw httpError(422, `The time it went must be in the last ${SENT_AT_DAYS} days`, { code: 'sent_at' })
        }
        // To the minute: a time picked as 10:00 counts for an order made at 10:00:30.
        const made = new Date(po.created_at)
        made.setSeconds(0, 0)
        if (sentAt < made) throw httpError(422, 'The time it went can\'t be before the order was made', { code: 'sent_at' })
      }
      await tx`
        UPDATE purchase_orders
           SET status = 'sent', sent_at = COALESCE(${sentAt ? sentAt.toISOString() : null}::timestamptz, now()),
               sent_by = ${by(req)}, sent_via = ${b.via},
               supplier_ref = COALESCE(${b.supplier_ref ?? null}, supplier_ref), send_error = NULL, updated_at = now()
         WHERE id = ${po.id} AND tenant_id = ${req.tenantId}
      `
      return poDetail(tx, req.tenantId, po.id, prices)
    })
  })

  // The PO as a file: pdf, xlsx, or html (for printing). It is the
  // document the supplier gets, so it always carries the prices. csv is
  // the supplier's quick order: code, name, qty (no prices).
  app.get('/pos/:id/file', { preHandler: canRead }, async (req, reply) => {
    const format = ['pdf', 'xlsx', 'html', 'csv'].includes(req.query.format) ? req.query.format : 'pdf'
    await withTenant(req.tenantId, tx => ownPo(tx, req.tenantId, req.params.id))
    const f = await poFile(req.tenantId, req.params.id, format)
    reply.header('Content-Type', f.contentType)
    reply.header('Content-Disposition', `${format === 'html' ? 'inline' : 'attachment'}; filename="${f.filename}"`)
    return reply.send(f.content)
  })

  app.post('/pos/:id/cancel', { preHandler: canApprove }, async req => {
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

  // Split a purchase order into two for different days: the moved
  // quantities become a second order to the same supplier (same prices,
  // notes and delivery charge) for another delivery day. An order already
  // with the supplier goes back to To send as amended, and when the supplier
  // takes orders by email both are emailed straight away.
  app.post('/pos/:id/split', { preHandler: canApprove }, async req => {
    const b = SplitPoBody.parse(req.body || {})
    const prices = await showPrices(req)
    const made = await withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (!['to_send', 'sent'].includes(po.status)) throw httpError(409, 'Only an order that hasn\'t arrived can be split')
      const venue = await loadVenue(tx, req.tenantId, po.venue_id)
      const [{ day }] = await tx`SELECT delivery_date::text AS day FROM purchase_orders WHERE id = ${po.id} AND tenant_id = ${req.tenantId}`
      if (b.delivery_date === day) throw httpError(422, 'The second order must be for another day than this one')
      const sup = (await loadSuppliersForVenue(tx, req.tenantId, venue, [po.supplier_id]))[po.supplier_id]
      checkDeliveryDay(sup, b.delivery_date, venueNow(venue), b.agreed)
      const lines = await loadPoLines(tx, req.tenantId, po.id)
      const lineBy = new Map(lines.map(l => [l.id, l]))
      const moves = new Map()
      for (const m of b.lines) {
        const l = lineBy.get(m.id)
        if (!l) throw httpError(404, 'Line not found')
        const total = (moves.get(m.id) || 0) + m.qty
        if (total > l.qty + 1e-9) throw httpError(422, `Only ${fmtNum(l.qty)} of ${l.item_name} can move`)
        moves.set(m.id, total)
      }
      if (lines.every(l => (moves.get(l.id) || 0) >= l.qty - 1e-9)) {
        throw httpError(422, 'That moves the whole order: change its delivery day instead')
      }
      for (const [id, qty] of moves) {
        const l = lineBy.get(id)
        checkSplitQty(l.item_name, l.qty, qty, l)
      }
      const number = await nextPoNumber(tx, req.tenantId)
      const [n] = await tx`
        INSERT INTO purchase_orders (tenant_id, number, supply_order_id, venue_id, supplier_id, status, delivery_date, notes,
                                     delivery_charge, created_by, requested_by, split_from)
        VALUES (${req.tenantId}, ${number}, ${po.supply_order_id}, ${po.venue_id}, ${po.supplier_id}, 'to_send', ${b.delivery_date},
                ${b.notes === undefined ? po.notes : b.notes}, ${po.delivery_charge}, ${by(req)}, ${po.requested_by}, ${po.id})
        RETURNING id
      `
      for (const l of lines) {
        const qty = moves.get(l.id)
        if (!qty) continue
        await tx`
          INSERT INTO purchase_order_lines ${tx({
            tenant_id: req.tenantId, po_id: n.id, item_id: l.item_id, quote_id: l.quote_id, item_name: l.item_name,
            category_name: l.category_name, storage: l.storage, base_unit: l.base_unit, supplier_code: l.supplier_code,
            product_name: l.product_name, pack_label: l.pack_label, pack_base_qty: l.pack_base_qty, price: l.price, vat_rate: l.vat_rate, qty,
            sort_order: l.sort_order,
          })}
        `
        if (qty >= l.qty - 1e-9) await tx`DELETE FROM purchase_order_lines WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
        else await tx`UPDATE purchase_order_lines SET qty = ${Math.round((l.qty - qty) * 1000) / 1000} WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
      }
      await recalcPo(tx, req.tenantId, po.id)
      await recalcPo(tx, req.tenantId, n.id)
      const wasSent = po.status === 'sent'
      if (wasSent) {
        await tx`
          UPDATE purchase_orders SET status = 'to_send', amended_at = now(), amended_by = ${by(req)}, send_error = NULL, updated_at = now()
           WHERE id = ${po.id} AND tenant_id = ${req.tenantId}
        `
      }
      const supplier = (await loadSuppliersForVenue(tx, req.tenantId, venue, [po.supplier_id]))[po.supplier_id]
      const totals = await tx`SELECT id, subtotal::float8 AS subtotal FROM purchase_orders WHERE id IN (${po.id}, ${n.id}) AND tenant_id = ${req.tenantId}`
      const sub = new Map(totals.map(t => [t.id, t.subtotal]))
      return { poId: po.id, newId: n.id, wasSent, supplier, sub }
    })
    // Only an order the supplier already had is emailed again by itself.
    const results = made.wasSent
      ? await emailNew(req, [made.poId, made.newId].map(id => ({ id, supplier: made.supplier, subtotal: made.sub.get(id) })), prices)
      : []
    return withTenant(req.tenantId, async tx => ({
      po: await poDetail(tx, req.tenantId, made.poId, prices),
      new_po: await poDetail(tx, req.tenantId, made.newId, prices),
      was_sent: made.wasSent,
      results,
    }))
  })

  // Book a delivery in: what arrived per line, the checks and probe
  // temperatures. Writes (or updates) the venue's H&S delivery check for this
  // order. Can be done again to correct it. With an invoice Pepper read
  // (invoice_id), each line takes what the invoice said for it
  // (invoice_idx: product, code, pack, price per pack ex VAT; people who see
  // prices may correct the price), and `add` puts in lines for what arrived
  // but wasn't ordered (ordered 0). An added line booked in again with 0
  // received is taken off. The ordered prices and the order's totals never
  // change; the price list changes only through /price-list.
  app.post('/pos/:id/receive', { preHandler: canOrderOrApprove }, async req => {
    const b = ReceiveBody.parse(req.body)
    const prices = await showPrices(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (!['to_send', 'sent', 'received'].includes(po.status)) throw httpError(409, 'A cancelled order cannot be received')
      const venue = await loadVenue(tx, req.tenantId, po.venue_id)
      const [supplier] = await tx`SELECT name FROM suppliers WHERE id = ${po.supplier_id} AND tenant_id = ${req.tenantId}`
      let invoice = null
      if (b.invoice_id) {
        ;[invoice] = await tx`SELECT id, lines FROM purchase_invoices WHERE id = ${b.invoice_id} AND po_id = ${po.id} AND tenant_id = ${req.tenantId}`
        if (!invoice) throw httpError(404, 'Invoice not found for this order')
      }
      const invLine = idx => {
        if (idx == null) return null
        if (!invoice) throw httpError(422, 'Read the invoice first')
        const l = (invoice.lines || [])[idx]
        if (!l) throw httpError(422, 'That invoice line doesn\'t exist')
        return l
      }
      // What the invoice said for a line: { invoice_* } columns to write, or {} to leave them.
      const invoiceFields = (given, fallbackPrice) => {
        if (!given || given.invoice_idx === undefined) {
          return prices && given?.invoice_price !== undefined ? { invoice_price: given.invoice_price } : {}
        }
        if (given.invoice_idx === null) {
          return { invoice_id: null, invoice_name: null, invoice_code: null, invoice_pack: null, invoice_price: null, invoice_vat_rate: null }
        }
        const il = invLine(given.invoice_idx)
        const read = il.price_pack ?? fallbackPrice ?? null
        return {
          invoice_id: invoice.id, invoice_name: il.description, invoice_code: il.code ?? null, invoice_pack: il.pack_text ?? null,
          invoice_price: prices && given.invoice_price !== undefined ? given.invoice_price : read,
          invoice_vat_rate: il.vat_rate ?? null,
          // The pack as invoiced, for adding it to the price list later.
          ...(il.pack ? { pack_spec: tx.json({ name: 'pack', ...il.pack }) } : {}),
        }
      }

      const lines = await loadPoLines(tx, req.tenantId, po.id)
      const given = new Map(b.lines.map(l => [l.id, l]))
      for (const id of given.keys()) if (!lines.some(l => l.id === id)) throw httpError(404, 'Line not found')

      // Lines for what arrived but wasn't ordered.
      const added = []
      if (b.add?.length) {
        const itemIds = [...new Set(b.add.map(a => a.item_id))]
        const items = await tx`
          SELECT i.id, i.name, i.storage, i.base_unit, c.name AS category_name
            FROM inv_items i LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = ${req.tenantId}
           WHERE i.id = ANY(${itemIds}::uuid[]) AND i.tenant_id = ${req.tenantId}
        `
        const itemBy = new Map(items.map(i => [i.id, i]))
        const quoteIds = [...new Set(b.add.map(a => a.quote_id).filter(Boolean))]
        const { quotes } = await resolveQuotes(tx, req.tenantId, venue.id, itemIds)
        const allQuotes = [...quotes.values()].flat()
        const [{ n }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM purchase_order_lines WHERE po_id = ${po.id} AND tenant_id = ${req.tenantId}`
        let sort = Number(n)
        for (const a of b.add) {
          const item = itemBy.get(a.item_id)
          if (!item) throw httpError(404, 'Item not found')
          const il = a.invoice_idx != null ? invLine(a.invoice_idx) : null
          let row
          if (a.quote_id) {
            const q = allQuotes.find(x => x.id === a.quote_id)
            if (!q || !quoteIds.includes(q.id) || q.item_id !== item.id) throw httpError(404, 'Supplier price not found for ' + item.name)
            if (q.supplier_id !== po.supplier_id) throw httpError(422, 'That product is not from this supplier')
            row = {
              quote_id: q.id, supplier_code: q.supplier_code ?? null, product_name: q.product_name ?? null,
              pack_label: packLabel(q), pack_base_qty: q.pack_base_qty, price: quotePrice(q, venue.id), vat_rate: q.vat_rate,
              pack_spec: null,
            }
          } else {
            const spec = a.pack || (il?.pack ? { name: 'pack', ...il.pack } : null)
            if (!spec) throw httpError(422, 'Say how ' + item.name + ' came packed')
            const p = { pack_name: spec.name || 'pack', pack_count: spec.count ?? 1, pack_qty: spec.qty, pack_unit: spec.unit }
            const pbq = packBaseQty(p, item.base_unit)
            if (!pbq) throw httpError(422, `A ${spec.unit} pack doesn't fit ${item.name}, which is counted in ${item.base_unit === 'each' ? 'each' : item.base_unit}`)
            row = {
              quote_id: null, supplier_code: il?.code ?? null, product_name: il?.description ?? null,
              pack_label: packLabel(p), pack_base_qty: pbq, price: il?.price_pack ?? 0, vat_rate: il?.vat_rate ?? 0,
              pack_spec: tx.json({ name: p.pack_name, count: p.pack_count, qty: p.pack_qty, unit: p.pack_unit }),
            }
          }
          const [ins] = await tx`
            INSERT INTO purchase_order_lines ${tx({
              tenant_id: req.tenantId, po_id: po.id, item_id: item.id, item_name: item.name,
              category_name: item.category_name ?? null, storage: item.storage, base_unit: item.base_unit,
              ...invoiceFields(a, row.price), ...row, qty: 0, added_on_receipt: true, sort_order: sort++,
            })}
            RETURNING id
          `
          added.push({ id: ins.id, given: a })
        }
      }

      const c = b.check
      const all = await loadPoLines(tx, req.tenantId, po.id)
      const addedBy = new Map(added.map(x => [x.id, x.given]))
      const received = all.map(l => {
        const g = given.get(l.id) || addedBy.get(l.id)
        const qty = g ? g.received_qty : (l.added_on_receipt ? Number(l.received_qty ?? 0) : Number(l.qty))
        return { ...l, received_qty: qty, receive_status: g?.status || receiveStatusFor(l.qty, qty), receive_note: g?.note ?? null, g }
      })
      // An added line with nothing received is taken off again.
      const dropped = received.filter(l => l.added_on_receipt && !(l.received_qty > 0))
      for (const l of dropped) await tx`DELETE FROM purchase_order_lines WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
      const kept = received.filter(l => !dropped.includes(l))
      const arrived = kept.filter(l => l.received_qty > 0)
      const hasChilled = arrived.some(l => l.storage === 'chilled')
      const hasFrozen = arrived.some(l => l.storage === 'frozen')
      if (hasChilled && c.chilled_temp_c == null) throw httpError(422, 'Enter the temperature of the chilled goods')
      if (hasFrozen && c.frozen_temp_c == null) throw httpError(422, 'Enter the temperature of the frozen goods')
      const chilled = hasChilled ? c.chilled_temp_c : null
      const frozen = hasFrozen ? c.frozen_temp_c : null
      const tempOk = deliveryTempOk('chilled', chilled) && deliveryTempOk('frozen', frozen)

      for (const l of kept) {
        const inv = addedBy.has(l.id) ? {} : invoiceFields(given.get(l.id), Number(l.price))
        await tx`
          UPDATE purchase_order_lines SET ${tx({ received_qty: l.received_qty, receive_status: l.receive_status, receive_note: l.receive_note, ...inv })}
           WHERE id = ${l.id} AND tenant_id = ${req.tenantId}
        `
      }
      await tx`
        UPDATE purchase_orders
           SET status = 'received', received_at = COALESCE(received_at, now()), received_by = ${by(req)},
               receive_notes = ${b.notes ?? null}, updated_at = now()
         WHERE id = ${po.id} AND tenant_id = ${req.tenantId}
      `
      if (invoice) {
        await tx`
          UPDATE purchase_invoices SET applied_at = now(), applied_by = ${by(req)}
           WHERE id = ${invoice.id} AND tenant_id = ${req.tenantId}
        `
      }

      const ordered = kept.filter(l => !l.added_on_receipt)
      const items = arrived.map(l => ({
        name: l.item_name, qty: l.received_qty, unit: l.pack_label, category: l.category_name ?? null,
        ordered: Number(l.qty), status: l.receive_status, ...(l.added_on_receipt ? { added: true } : {}),
        ...(l.storage === 'chilled' ? { temp_c: chilled } : l.storage === 'frozen' ? { temp_c: frozen } : {}),
      }))
      const problems = ordered.filter(l => l.receive_status !== 'ok')
      const extra = kept.filter(l => l.added_on_receipt)
      const summary = [
        `${poNumberLabel(po.number)}: ${ordered.filter(l => l.received_qty > 0).length} of ${ordered.length} line${ordered.length === 1 ? '' : 's'} delivered`,
        ...problems.map(l => `${l.item_name}: ${RECEIVE_STATUSES.find(s => s.key === l.receive_status)?.label ?? l.receive_status}${l.receive_note ? ` (${l.receive_note})` : ''}`),
        ...extra.map(l => `Not ordered, arrived: ${fmtNum(l.received_qty)} × ${l.item_name}${l.receive_note ? ` (${l.receive_note})` : ''}`),
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

  // Update the supplier price list from a received order's invoice prices
  // (the rows poDetail's price_list offers): company: the supplier price
  // takes the invoice price; venue: this venue's own price does; add: a new
  // supplier price for the line's item (a new product, or the substitute the
  // supplier sent), with the invoice's product name, code, pack and price.
  // usual makes the new price the one ordered at this venue / everywhere.
  // Price history records each change as from the invoice.
  app.post('/pos/:id/price-list', { preHandler: canSetup }, async req => {
    const b = PriceListBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      const lines = await loadPoLines(tx, req.tenantId, po.id)
      const lineBy = new Map(lines.map(l => [l.id, l]))
      const who = by(req)
      const history = (quoteId, venueId, price) => tx`
        INSERT INTO inv_price_history (tenant_id, quote_id, venue_id, price, changed_by, source, po_id)
        VALUES (${req.tenantId}, ${quoteId}, ${venueId}, ${price}, ${who}, 'invoice', ${po.id})
      `
      for (const ch of b.changes) {
        const l = lineBy.get(ch.line_id)
        if (!l) throw httpError(404, 'Line not found')
        if (l.invoice_price == null) throw httpError(422, `${l.item_name} has no invoice price`)
        const price = Number(l.invoice_price)
        if (ch.action === 'company' || ch.action === 'venue') {
          if (!l.quote_id) throw httpError(422, `${l.item_name} has no supplier price to update: add it instead`)
          const [q] = await tx`SELECT id FROM inv_quotes WHERE id = ${l.quote_id} AND tenant_id = ${req.tenantId}`
          if (!q) throw httpError(404, 'Supplier price not found')
          if (ch.action === 'company') {
            await tx`UPDATE inv_quotes SET price = ${price}, updated_at = now() WHERE id = ${q.id} AND tenant_id = ${req.tenantId}`
            await history(q.id, null, price)
          } else {
            await tx`
              INSERT INTO inv_quote_venue_prices (quote_id, venue_id, tenant_id, price)
              VALUES (${q.id}, ${po.venue_id}, ${req.tenantId}, ${price})
              ON CONFLICT (quote_id, venue_id) DO UPDATE SET price = EXCLUDED.price
            `
            await history(q.id, po.venue_id, price)
          }
          continue
        }
        // add
        if (!l.item_id) throw httpError(422, `${l.item_name} isn't linked to an inventory item`)
        const [item] = await tx`SELECT id, name, base_unit, is_active FROM inv_items WHERE id = ${l.item_id} AND tenant_id = ${req.tenantId}`
        if (!item) throw httpError(404, 'Item not found')
        let spec = ch.pack || l.pack_spec
        if (!spec && l.quote_id) {
          const [oq] = await tx`
            SELECT pack_name AS name, pack_count::float8 AS count, pack_qty::float8 AS qty, pack_unit AS unit
              FROM inv_quotes WHERE id = ${l.quote_id} AND tenant_id = ${req.tenantId}
          `
          spec = oq || null
        }
        if (!spec) throw httpError(422, `Say how ${item.name} comes packed`)
        const p = { pack_name: spec.name || 'pack', pack_count: spec.count ?? 1, pack_qty: spec.qty, pack_unit: spec.unit }
        const pbq = packBaseQty(p, item.base_unit)
        if (!pbq) throw httpError(422, `A ${spec.unit} pack doesn't fit ${item.name}, which is counted in ${item.base_unit === 'each' ? 'each' : item.base_unit}`)
        const code = ch.supplier_code !== undefined ? ch.supplier_code : (l.invoice_code ?? null)
        const productName = ch.product_name !== undefined ? ch.product_name : (l.invoice_name ?? null)
        const [dupe] = await tx`
          SELECT id FROM inv_quotes
           WHERE tenant_id = ${req.tenantId} AND item_id = ${item.id} AND supplier_id = ${po.supplier_id}
             AND ${code ? tx`lower(supplier_code) = lower(${code})` : tx`supplier_code IS NULL AND lower(COALESCE(product_name, '')) = lower(${productName || ''}) AND abs(pack_base_qty - ${pbq}) < 0.0001`}
        `
        if (dupe) throw httpError(409, `${item.name} already has this price from the supplier: update it instead`)
        // The code mustn't be another live price's at the supplier.
        if (code && item.is_active) {
          const taken = await codeTaken(tx, req.tenantId, po.supplier_id, code)
          if (taken) throw codeTakenError(taken)
        }
        const [q] = await tx`
          INSERT INTO inv_quotes ${tx({
            tenant_id: req.tenantId, item_id: item.id, supplier_id: po.supplier_id, supplier_code: code, product_name: productName,
            ...p, pack_base_qty: pbq, price, vat_rate: ch.vat_rate ?? l.invoice_vat_rate ?? Number(l.vat_rate) ?? 0,
          })}
          RETURNING id
        `
        await history(q.id, null, price)
        // The line now points at what actually came (a substitute's own price).
        await tx`UPDATE purchase_order_lines SET quote_id = ${q.id} WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
        if (ch.usual) {
          const venueId = ch.usual === 'venue' ? po.venue_id : null
          await tx`DELETE FROM inv_preferred WHERE item_id = ${item.id} AND tenant_id = ${req.tenantId} AND venue_id IS NOT DISTINCT FROM ${venueId}`
          await tx`INSERT INTO inv_preferred (tenant_id, item_id, venue_id, quote_id) VALUES (${req.tenantId}, ${item.id}, ${venueId}, ${q.id})`
        }
      }
      return poDetail(tx, req.tenantId, po.id, true)
    })
  })

  // ── Out of stock (migration 234) ──
  // What the supplier said about a price: out of stock until a date (the
  // first day it can be delivered again), or back in stock (until null).
  // Company-wide, like the price itself; who and when are kept. Nothing on
  // any order moves to another price because of it.
  app.put('/quotes/:id/stock', { preHandler: canMarkStock }, async req => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const body = StockBody.parse(req.body)
    const until = body.until
    if (until) {
      const today = nowAt('Europe/London').date
      if (addDays(until, 0) !== until) throw httpError(400, 'That date doesn\'t exist')
      if (until <= today) {
        throw httpError(422, 'Pick the first day it can be delivered again: a day after today', { code: 'stock_until' })
      }
      if (until > addDays(today, STOCK_DAYS_MAX)) {
        throw httpError(422, 'Pick a day within a year. If nobody knows, pick a day to check again', { code: 'stock_until' })
      }
    }
    return withTenant(req.tenantId, async tx => {
      const [q] = await tx`
        UPDATE inv_quotes SET
          out_of_stock_until = ${until},
          out_of_stock_note  = ${until ? body.note ?? null : null},
          out_of_stock_by    = ${until ? by(req) : null},
          out_of_stock_at    = CASE WHEN ${!!until} THEN now() END
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
        RETURNING id, item_id, supplier_id, out_of_stock_until::text AS out_of_stock_until, out_of_stock_note,
                  out_of_stock_by, out_of_stock_at
      `
      if (!q) throw httpError(404, 'Price not found')
      return q
    })
  })

  // Limits shown next to the temperature boxes.
  app.get('/meta', { preHandler: canRead }, async req => {
    const lv = await permissionLevels(req, ['purchasing', 'purchasing_setup', 'purchasing_approve'])
    return {
      show_prices: lv.purchasing_setup !== 'none',
      can_order: lv.purchasing === 'manage',
      can_approve: lv.purchasing_approve === 'manage',
      can_setup: lv.purchasing_setup === 'manage',
      can_mark_stock: lv.purchasing === 'manage' || lv.purchasing_approve === 'manage' || lv.purchasing_setup === 'manage',
      delivery_temp_max: DELIVERY_TEMP_MAX,
    }
  })
}
