// src/services/stockSvc.js
//
// Stock read from its documents (inventory phase 4a, migrations 305 to 307;
// docs/INVENTORY.md 6.1): every delivery, approved count and adjustment of
// an item at a venue is a move, and on hand is the item's last approved
// count plus every move after it, by the one rule stockOnHand() in
// shared/stock.js. Nothing stores a stock level. Read by the Stock page
// (routes/stock.js, routes/stockCounts.js), the report subjects (reports/
// work/stock.js), Pepper's stock tools (through the routes) and Today.
//
// A move: { venue_id, item_id, at, kind, qty_base, cost_per_base, source:
// { type, id, label }, by }. qty_base is in the item's base unit; a count's
// is what was counted (it sets the quantity), every other's is signed.
// cost_per_base is pounds per base unit at the time: the price paid for a
// delivery (the invoice's, else the price ordered at), the average paid at
// the venue over the AVERAGE_DAYS before the move for the rest (the last
// price paid before it when nothing was received in that window), through
// itemCost() in shared/costing.js. Costs are only worked out when asked for
// (`costs: true`); values need Costing view, which the routes check.
//
// MOVE_SOURCES is the list of where moves come from. Phase 4b (migration
// 308) added waste: each logged entry's items taken off at its moment, and
// each till void marked wasted (pos_check_lines.void_waste, generated test
// sales left out: D10) broken into items through the recipe its dish uses
// there, read from the till (loadWastedVoids()), never copied as waste, its
// breakdown kept the first time it is read (migration 310; D9);
// and transfers between venues (migration 309): each line's moves by
// transferLineMoves() in shared/stock.js (out of the sender when sent, what
// didn't arrive lost in transit, in at the receiver when received, back at
// the sender when cancelled), valued at the sender's average when sent.
// Phase 5 (migration 311) added usage from sales: each item's use on each of
// the venue's trading days (stock_usage_days, worked out by the job
// jobs/stock-usage.js through services/stockUsageSvc.js), one move per item
// per day at the day's last sale, with how much came from each channel.
// Phase 6a (migration 312) added late sales on a closed day (stock_usage_late:
// what reached a day of a closed period after it was closed), at the day's
// last sale, marked `late` (variance counts it in the period it landed in).
//
//   MOVE_SOURCES, SALES_COUNTED, salesTakenOff(tx, tenantId, venueIds) (up to when
//   sales are taken off at each venue: the last run), salesNote(state, timezone)
//   loadStockMoves(tx, tenantId, { venueIds, itemIds, from, to, kinds, costs, exceptCountId })
//   loadStockOnHand(tx, tenantId, { venueIds, itemIds, allItems, at, exceptCountId })
//     -> [{ venue_id, item_id, ...stockOnHand() }]: every active item at each
//        venue with allItems, else only items with a move there
//   itemCostsAt(tx, tenantId, venueId, itemIds, at) -> Map(item_id -> pounds per base unit
//        at that moment; now when at is left out: the stock value)
//   costLookup(tx, tenantId, venueIds, itemIds, to) -> (venueId, itemId, at) -> pounds per base unit
//   loadCountItems(tx, tenantId, itemIds) -> Map(item_id -> item with `units`
//        (countUnits(): standard, its own, its packs) and `default_unit`)
//   loadStockSettings(tx, tenantId), loadVenueSettings(tx, tenantId, venueId)
//   countScope(tx, tenantId, count) -> the items a count covers, by area
//   Waste (phase 4b): ensureWasteReasons(tx, tenantId) (the starting list, once
//   a group), loadWasteReasons(tx, tenantId), venueDay(tx, tenantId, venueId, at)
//   (the venue's trading day at a moment: the till's day start, else 04:00),
//   wasteCtx(tx, tenantId) (the cost engine's ctx for breaking dishes and
//   batches into items), loadWastedVoids(tx, tenantId, { venueIds, from, to,
//   days, ctx, stale, since }) (the till's voids marked wasted, with their
//   items: kept in stock_void_waste the first time, migration 310),
//   sweepVoidWaste(log) (jobs/stock-voids.js: keeps new voids' items within minutes)
//   stockPerson(req), who(req): the person a stock document (or purchasing's suggested_by)
//   is kept under: the PIN person on a shared device, else the account (routes/stock.js re-exports them)

import { systemSql, withSystem, withTenant } from '../config/db.js'
import { stockOnHand, countUnits, defaultCountUnit, voidReason, transferLineMoves, WASTE_REASON_SEEDS } from '../../../shared/stock.js'
import { itemsOf } from '../../../shared/stockItems.js'
import { varianceSettings } from '../../../shared/variance.js'
import { bufferPct } from '../../../shared/forecast.js'
import { poNumberLabel } from '../../../shared/procurement.js'
import { itemCost, AVERAGE_DAYS } from '../../../shared/costing.js'
import { businessDate } from '../../../shared/pos/reports.js'
import { loadCostItems } from './costingSvc.js'
import { coverageCtx } from './recipeCoverageSvc.js'

export const SALES_COUNTED = true
// A venue's trading day starts at its till's day start, else at 04:00 (the till's own default).
export const DAY_STARTS_AT = '04:00'

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

const DAY = 86400000
const ts = v => (v == null ? null : v instanceof Date ? v : new Date(v))
const cutOf = (tx, { venueIds, itemIds, from, to }, venueCol, itemCol, atCol) => tx`
  ${venueIds ? tx`AND ${tx(venueCol)} = ANY(${venueIds}::uuid[])` : tx``}
  ${itemIds ? tx`AND ${tx(itemCol)} = ANY(${itemIds}::uuid[])` : tx``}
  ${from ? tx`AND ${tx(atCol)} >= ${ts(from)}` : tx``}
  ${to ? tx`AND ${tx(atCol)} <= ${ts(to)}` : tx``}`

const COUNT_LABEL = { full: 'Full count', key: 'Key items count' }

// ── Where moves come from ─────────────────────────────────────────────

/** Deliveries booked in at the venue: received packs x the line's own pack size (never today's quote's). */
async function deliveryMoves(tx, tenantId, cut) {
  const rows = await tx`
    SELECT po.venue_id, pl.item_id, po.received_at AS at, (pl.received_qty * pl.pack_base_qty)::float8 AS qty_base,
           pl.received_qty::float8 AS packs, pl.pack_base_qty::float8 AS pack_base_qty,
           COALESCE(pl.invoice_price, pl.price)::float8 AS price,
           po.id AS source_id, po.number, s.name AS supplier_name, po.received_by AS by
      FROM purchase_order_lines pl
      JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
      JOIN inv_items i ON i.id = pl.item_id AND i.tenant_id = pl.tenant_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
     WHERE pl.tenant_id = ${tenantId} AND pl.received_qty > 0 AND pl.pack_base_qty > 0
       AND po.received_at IS NOT NULL AND po.status <> 'cancelled' AND pl.base_unit = i.base_unit
       ${cutOf(tx, cut, 'po.venue_id', 'pl.item_id', 'po.received_at')}`
  return rows.map(r => ({
    venue_id: r.venue_id, item_id: r.item_id, at: r.at, kind: 'delivery', qty_base: r.qty_base,
    cost_per_base: r.price / r.pack_base_qty, packs: r.packs, pack_base_qty: r.pack_base_qty, price: r.price,
    source: { type: 'delivery', id: r.source_id, label: poNumberLabel(r.number) + (r.supplier_name ? ' from ' + r.supplier_name : '') },
    by: r.by,
  }))
}

/** Approved counts: what was counted of each item (its areas added). */
async function countMoves(tx, tenantId, cut) {
  const rows = await tx`
    SELECT c.venue_id, l.item_id, c.counted_at AS at, sum(l.qty_base)::float8 AS qty_base,
           c.id AS source_id, c.kind, c.key_list_name, c.approved_by AS by
      FROM stock_count_lines l
      JOIN stock_counts c ON c.id = l.count_id AND c.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} AND c.status = 'approved'
       ${cut.exceptCountId ? tx`AND c.id <> ${cut.exceptCountId}` : tx``}
       ${cutOf(tx, cut, 'c.venue_id', 'l.item_id', 'c.counted_at')}
     GROUP BY c.id, c.venue_id, l.item_id, c.counted_at, c.kind, c.key_list_name, c.approved_by`
  return rows.map(r => ({
    venue_id: r.venue_id, item_id: r.item_id, at: r.at, kind: 'count', qty_base: r.qty_base, cost_per_base: null,
    source: { type: 'count', id: r.source_id, label: r.key_list_name ? 'Key items count: ' + r.key_list_name : COUNT_LABEL[r.kind] || 'Count' },
    by: r.by,
  }))
}

/** Adjustments: signed, with their reason; a reversal (dated with what it reverses) after the original. */
async function adjustmentMoves(tx, tenantId, cut) {
  const rows = await tx`
    SELECT a.venue_id, a.item_id, a.adjusted_at AS at, a.qty_base::float8 AS qty_base, a.id AS source_id, a.reason, a.adjusted_by AS by
      FROM stock_adjustments a
     WHERE a.tenant_id = ${tenantId} ${cutOf(tx, cut, 'a.venue_id', 'a.item_id', 'a.adjusted_at')}
     ORDER BY a.adjusted_at, a.created_at`
  return rows.map(r => ({
    venue_id: r.venue_id, item_id: r.item_id, at: r.at, kind: 'adjustment', qty_base: r.qty_base, cost_per_base: null,
    source: { type: 'adjustment', id: r.source_id, label: r.reason }, by: r.by,
  }))
}

/**
 * Logged waste (migration 308): each item of each entry not undone, taken off
 * at the entry's moment, at the cost it was logged with (the average paid
 * then; null leaves it to fillCosts()). A reversing entry's items are below
 * zero, so it puts them back, dated with the entry it reverses.
 */
async function wasteMoves(tx, tenantId, cut) {
  const rows = await tx`
    SELECT w.venue_id, wi.item_id, w.wasted_at AS at, (-wi.qty_base)::float8 AS qty_base, wi.cost_per_base::float8 AS cost_per_base,
           w.id AS source_id, w.name, w.reason, w.reverses_id, w.wasted_by AS by
      FROM stock_waste_items wi
      JOIN stock_waste w ON w.id = wi.waste_id AND w.tenant_id = wi.tenant_id
     WHERE wi.tenant_id = ${tenantId} AND w.undone_at IS NULL
       ${cutOf(tx, cut, 'w.venue_id', 'wi.item_id', 'w.wasted_at')}
     ORDER BY w.wasted_at, w.created_at`
  return rows.map(r => ({
    venue_id: r.venue_id, item_id: r.item_id, at: r.at, kind: 'waste', qty_base: r.qty_base, cost_per_base: r.cost_per_base,
    source: { type: 'waste', id: r.source_id, label: (r.reverses_id ? 'Reversed: ' : '') + r.name + ' (' + r.reason + ')' }, by: r.by,
  }))
}

/** Till voids marked wasted: each broken into items by its dish's recipe there, kept the first time it is read. */
async function voidWasteMoves(tx, tenantId, cut) {
  const voids = await loadWastedVoids(tx, tenantId, { venueIds: cut.venueIds, from: cut.from, to: cut.to })
  const want = cut.itemIds ? new Set(cut.itemIds) : null
  const out = []
  for (const v of voids) {
    for (const i of v.items) {
      if (want && !want.has(i.item_id)) continue
      out.push({
        venue_id: v.venue_id, item_id: i.item_id, at: v.at, kind: 'waste', qty_base: -i.qty_base, cost_per_base: i.cost_per_base ?? null,
        source: { type: 'till_void', id: v.id, label: 'Till void: ' + v.name + ' (' + v.reason + ')' }, by: v.by,
      })
    }
  }
  return out
}

/**
 * Transfers between venues (migration 309): every line of a transfer that
 * touches these venues, as its moves at either end (transferLineMoves()),
 * kept where the venue and the moment are asked for. Each move carries the
 * line's cost: the sender's average when it was sent.
 */
async function transferMoves(tx, tenantId, cut) {
  const rows = await tx`
    SELECT t.id, t.number, t.from_venue_id, t.to_venue_id, t.status, t.sent_at, t.received_at, t.cancelled_at,
           t.sent_by, t.received_by, t.cancelled_by, fv.name AS from_name, tv.name AS to_name,
           l.item_id, l.qty_base::float8 AS qty_base, l.received_base::float8 AS received_base, l.cost_per_base::float8 AS cost_per_base
      FROM stock_transfer_lines l
      JOIN stock_transfers t ON t.id = l.transfer_id AND t.tenant_id = l.tenant_id
      JOIN venues fv ON fv.id = t.from_venue_id AND fv.tenant_id = t.tenant_id
      JOIN venues tv ON tv.id = t.to_venue_id AND tv.tenant_id = t.tenant_id
     WHERE l.tenant_id = ${tenantId}
       ${cut.venueIds ? tx`AND (t.from_venue_id = ANY(${cut.venueIds}::uuid[]) OR t.to_venue_id = ANY(${cut.venueIds}::uuid[]))` : tx``}
       ${cut.itemIds ? tx`AND l.item_id = ANY(${cut.itemIds}::uuid[])` : tx``}
       ${cut.to ? tx`AND t.sent_at <= ${ts(cut.to)}` : tx``}
     ORDER BY t.sent_at, t.number, l.sort_order`
  const venues = cut.venueIds ? new Set(cut.venueIds) : null
  const from = cut.from ? ts(cut.from).getTime() : null
  const to = cut.to ? ts(cut.to).getTime() : null
  // A line's cost is the sender's when it was sent, at both ends: never filled from the receiver's own
  // average (fillCosts()) when the sender had none, so both venues show the same pounds, or none.
  return rows.flatMap(r => transferLineMoves(r, r)).filter(m => {
    const t = ts(m.at).getTime()
    return (!venues || venues.has(m.venue_id)) && (from == null || t >= from) && (to == null || t <= to)
  }).map(m => ({ ...m, cost_fixed: true }))
}

const dayWords = d => {
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'))
  } catch {
    return d
  }
}

/**
 * Usage from sales (phase 5, migration 311): what each trading day's sales
 * took off, one move per item per day at the day's last sale (so a count
 * after closing has the day inside it, one before opening has it after),
 * with how much came from each channel and its cost then (kept with it: the
 * average paid, else the last paid, else the standard price). A refund given
 * back (a setting) is a day's total below zero.
 */
async function usageMoves(tx, tenantId, cut) {
  const rows = await tx`
    SELECT u.venue_id, u.item_id, u.at, (-u.qty_base)::float8 AS qty_base, u.cost_per_base::float8 AS cost_per_base,
           u.day::text AS day, u.channels
      FROM stock_usage_days u
     WHERE u.tenant_id = ${tenantId} ${cutOf(tx, cut, 'u.venue_id', 'u.item_id', 'u.at')}
     ORDER BY u.at`
  return rows.map(r => ({
    venue_id: r.venue_id, item_id: r.item_id, at: r.at, kind: 'usage', qty_base: r.qty_base, cost_per_base: r.cost_per_base,
    cost_fixed: r.cost_per_base != null, day: r.day, channels: r.channels || {},
    source: { type: 'usage', id: r.day, label: 'Sales on ' + dayWords(r.day) }, by: null,
  }))
}

/**
 * Up to when sales are taken off at these venues: { venueId: { up_to (the
 * last run's moment: today's part day counts up to then), last_sale_at,
 * days, uncosted_lines } } from the job's marks of the last two weeks.
 */
export async function salesTakenOff(tx, tenantId, venueIds) {
  if (!venueIds?.length) return {}
  // Up to the last run: a run that found no sales changed works nothing out again but has still read them
  // (stock_usage_venues.last_run_at, when it didn't fail), so it is the later of that and the last day worked out.
  const rows = await tx`
    SELECT m.venue_id,
           GREATEST(max(m.computed_at), max(CASE WHEN u.last_error IS NULL THEN u.last_run_at END)) AS up_to,
           max(m.last_sale_at) AS last_sale_at, count(*)::int AS days, sum(m.uncosted_lines)::int AS uncosted_lines
      FROM stock_usage_marks m
      LEFT JOIN stock_usage_venues u ON u.venue_id = m.venue_id AND u.tenant_id = m.tenant_id
     WHERE m.tenant_id = ${tenantId} AND m.venue_id = ANY(${venueIds}::uuid[]) AND m.day >= current_date - 15
     GROUP BY m.venue_id`
  return Object.fromEntries(rows.map(r => [r.venue_id, { up_to: r.up_to, last_sale_at: r.last_sale_at, days: r.days, uncosted_lines: r.uncosted_lines }]))
}

/** The words on hand carries about sales: up to the last run, or not worked out yet. */
export function salesNote(state, timezone = 'Europe/London') {
  if (!state?.up_to) return 'Sales are taken off as usage from sales is worked out, every few minutes: nothing has been worked out here yet, so on hand doesn\'t take sales off yet.'
  let when
  try {
    when = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false, day: 'numeric', month: 'short' }).format(new Date(state.up_to))
  } catch {
    when = new Date(state.up_to).toISOString().slice(0, 16).replace('T', ' ')
  }
  return 'Sales are taken off up to the last run at ' + when + ' (usage from sales is worked out every few minutes; a dish with no recipe takes nothing off).'
}

/**
 * Late sales on a closed day (phase 6a, migration 312): what reached a day
 * inside a closed period after it was closed, kept apart (stock_usage_late)
 * and never written into the day itself. On the ledger each sits at the
 * day's last sale (inside the closed period, before its closing count, so
 * on hand after that count is as it was); `late` tells variance to count it
 * in the period it landed in, not by its moment.
 */
async function lateUsageMoves(tx, tenantId, cut) {
  const rows = await tx`
    SELECT l.venue_id, li.item_id, l.at, (-li.qty_base)::float8 AS qty_base, li.cost_per_base::float8 AS cost_per_base,
           l.day::text AS day, l.id AS source_id
      FROM stock_usage_late_items li
      JOIN stock_usage_late l ON l.id = li.late_id AND l.tenant_id = li.tenant_id
     WHERE li.tenant_id = ${tenantId} ${cutOf(tx, cut, 'l.venue_id', 'li.item_id', 'l.at')}
     ORDER BY l.at, l.found_at`
  return rows.map(r => ({
    venue_id: r.venue_id, item_id: r.item_id, at: r.at, kind: 'usage', qty_base: r.qty_base, cost_per_base: r.cost_per_base,
    cost_fixed: r.cost_per_base != null, day: r.day, channels: {}, late: true,
    source: { type: 'late_usage', id: r.source_id, label: 'Late sales on ' + dayWords(r.day) + ' (counted in a later period)' }, by: null,
  }))
}

// Where moves come from. Phase 4b added waste (logged, and the till's voids marked wasted) and transfers.
export const MOVE_SOURCES = [
  { kind: 'delivery', load: deliveryMoves },
  { kind: 'count', load: countMoves },
  { kind: 'adjustment', load: adjustmentMoves },
  { kind: 'waste', load: wasteMoves },
  { kind: 'waste', load: voidWasteMoves },
  { kind: 'transfer', load: transferMoves },
  // Phase 5: usage from sales, one move per item per trading day.
  { kind: 'usage', load: usageMoves },
  // Phase 6a: late sales on a closed day, at the day's last sale.
  { kind: 'usage', load: lateUsageMoves },
]

/**
 * Every move of these items at these venues between from and to (timestamps,
 * both inclusive; null = no limit), in time order. kinds narrows the
 * sources; costs: true fills cost_per_base and value (signed pounds; a
 * count's value is left to the caller, which knows its change).
 */
export async function loadStockMoves(tx, tenantId, { venueIds = null, itemIds = null, from = null, to = null, kinds = null, costs = false, exceptCountId = null } = {}) {
  if ((venueIds && !venueIds.length) || (itemIds && !itemIds.length)) return []
  const cut = { venueIds, itemIds, from, to, exceptCountId }
  const lists = await Promise.all(MOVE_SOURCES.filter(s => !kinds || kinds.includes(s.kind)).map(s => s.load(tx, tenantId, cut)))
  const moves = lists.flat().sort((a, b) => new Date(a.at) - new Date(b.at))
  if (costs) await fillCosts(tx, tenantId, moves)
  return moves
}

/**
 * What each move cost at its time: the delivery's own price, else the average paid (else the last paid)
 * before it. A move whose cost is its document's (cost_fixed: a transfer line's) keeps it, even none.
 */
async function fillCosts(tx, tenantId, moves) {
  const need = moves.filter(m => m.cost_per_base == null && !m.cost_fixed)
  if (need.length) {
    const itemIds = [...new Set(need.map(m => m.item_id))]
    const venueIds = [...new Set(need.map(m => m.venue_id))]
    const times = need.map(m => new Date(m.at).getTime())
    const latest = new Date(Math.max(...times))
    const [items, receipts] = await Promise.all([
      loadCostItems(tx, tenantId, itemIds),
      deliveryMoves(tx, tenantId, { venueIds, itemIds, to: latest }),
    ])
    const byKey = new Map()
    for (const r of receipts) {
      const k = r.venue_id + '|' + r.item_id
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(r)
    }
    for (const m of need) m.cost_per_base = costAt(items.get(m.item_id), m.venue_id, byKey.get(m.venue_id + '|' + m.item_id) || [], m.at)
  }
  for (const m of moves) {
    m.value = m.kind === 'count' || m.cost_per_base == null ? null : Math.round(m.qty_base * m.cost_per_base * 100) / 100
  }
}

/** The average paid at a venue over the AVERAGE_DAYS before `at`, else the last price paid before it: { per_base, how } or null. */
function paidAt(item, venueId, receipts, at) {
  if (!item) return null
  const t = new Date(at).getTime()
  const before = receipts.filter(r => new Date(r.at).getTime() <= t)
  if (!before.length) return null
  const data = { receipts: { [item.id]: before }, since: new Date(t - AVERAGE_DAYS * DAY).toISOString() }
  const avg = itemCost(item, venueId, data, 'average')
  if (avg.per_base != null) return { per_base: avg.per_base, how: 'average' }
  const last = itemCost(item, venueId, data, 'last').per_base
  return last == null ? null : { per_base: last, how: 'last' }
}
const costAt = (item, venueId, receipts, at) => paidAt(item, venueId, receipts, at)?.per_base ?? null

/**
 * A way to ask what an item cost at a venue at a moment, with what was
 * received read once: (venueId, itemId, at) -> pounds per base unit or null
 * (costAt()). For many moments at once (a report's count lines). how: true
 * answers { per_base, how: 'average' | 'last' } or null instead.
 */
export async function costLookup(tx, tenantId, venueIds, itemIds, to = null, { how = false } = {}) {
  if (!itemIds.length || !venueIds.length) return () => null
  const [items, receipts] = await Promise.all([
    loadCostItems(tx, tenantId, itemIds),
    deliveryMoves(tx, tenantId, { venueIds, itemIds, to }),
  ])
  const byKey = new Map()
  for (const r of receipts) {
    const k = r.venue_id + '|' + r.item_id
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(r)
  }
  const paid = (venueId, itemId, at) => paidAt(items.get(itemId), venueId, byKey.get(venueId + '|' + itemId) || [], at ?? new Date())
  return how ? paid : (venueId, itemId, at) => paid(venueId, itemId, at)?.per_base ?? null
}

/** What each item cost at the venue at a moment (now: the stock value), pounds per base unit, by costAt(). */
export async function itemCostsAt(tx, tenantId, venueId, itemIds, at = null) {
  const out = new Map()
  if (!itemIds.length) return out
  const costOf = await costLookup(tx, tenantId, [venueId], itemIds, at)
  for (const id of itemIds) out.set(id, costOf(venueId, id, at))
  return out
}

// ── On hand ───────────────────────────────────────────────────────────

/** Each item at each venue by stockOnHand(), as it stands now (or at `at`). */
export async function loadStockOnHand(tx, tenantId, { venueIds = null, itemIds = null, allItems = false, at = null, exceptCountId = null } = {}) {
  const moves = await loadStockMoves(tx, tenantId, { venueIds, itemIds, to: at, exceptCountId })
  const key = (v, i) => v + '|' + i
  const byPair = new Map()
  for (const m of moves) {
    const k = key(m.venue_id, m.item_id)
    if (!byPair.has(k)) byPair.set(k, [])
    byPair.get(k).push(m)
  }
  if (allItems) {
    const venues = venueIds || (await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId}`).map(v => v.id)
    const active = await tx`SELECT id FROM inv_items WHERE tenant_id = ${tenantId} AND is_active ${itemIds ? tx`AND id = ANY(${itemIds}::uuid[])` : tx``}`
    for (const v of venues) for (const i of active) if (!byPair.has(key(v, i.id))) byPair.set(key(v, i.id), [])
  }
  return [...byPair.entries()].map(([k, list]) => {
    const [venue_id, item_id] = k.split('|')
    return { venue_id, item_id, ...stockOnHand({ moves: list, at }) }
  })
}

// ── Counting ──────────────────────────────────────────────────────────

/** Items with the units each can be counted in: standard, its own and its supplier prices' packs. */
export async function loadCountItems(tx, tenantId, itemIds) {
  const items = await loadCostItems(tx, tenantId, itemIds)
  if (!items.size) return items
  const ids = [...items.keys()]
  const [packs, extra] = await Promise.all([
    tx`SELECT id, item_id, pack_name, pack_count::float8 AS pack_count, pack_qty::float8 AS pack_qty, pack_unit, pack_base_qty::float8 AS pack_base_qty
         FROM inv_quotes WHERE tenant_id = ${tenantId} AND item_id = ANY(${ids}::uuid[]) AND is_active ORDER BY created_at`,
    tx`SELECT i.id, i.barcode,
              ARRAY(SELECT q.barcode FROM inv_quotes q WHERE q.item_id = i.id AND q.tenant_id = i.tenant_id AND q.barcode IS NOT NULL) AS quote_barcodes
         FROM inv_items i WHERE i.tenant_id = ${tenantId} AND i.id = ANY(${ids}::uuid[])`,
  ])
  const extraOf = new Map(extra.map(e => [e.id, e]))
  for (const item of items.values()) {
    const choices = countUnits(item, packs.filter(p => p.item_id === item.id))
    item.count_units = choices
    item.default_unit = defaultCountUnit(item, choices)
    item.barcode = extraOf.get(item.id)?.barcode ?? null
    item.quote_barcodes = extraOf.get(item.id)?.quote_barcodes ?? []
  }
  return items
}

export async function loadStockSettings(tx, tenantId) {
  const [s] = await tx`
    SELECT second_person_approves, blind_count, refunds_return_stock,
           variance_band_pct::float8 AS variance_band_pct, variance_item_pct::float8 AS variance_item_pct, variance_item_pounds::float8 AS variance_item_pounds,
           buffer_pct::float8 AS buffer_pct
      FROM stock_settings WHERE tenant_id = ${tenantId}`
  return {
    second_person_approves: !!s?.second_person_approves, blind_count: !!s?.blind_count, refunds_return_stock: !!s?.refunds_return_stock,
    // Phase 6a (migration 312): the variance band (saved on its own: PUT /api/stock/variance-settings).
    variance: varianceSettings(s || null),
    // Phase 9a (migration 319): the suggested order's buffer (saved on its own: PUT /api/stock/forecast-settings).
    buffer_pct: bufferPct(s?.buffer_pct ?? null),
  }
}

export async function loadVenueSettings(tx, tenantId, venueId) {
  const [s] = await tx`SELECT count_weekday, count_kind, key_list_id, par_mode FROM stock_venue_settings WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
  return { venue_id: venueId, count_weekday: s?.count_weekday ?? null, count_kind: s?.count_kind ?? 'full', key_list_id: s?.key_list_id ?? null, par_mode: s?.par_mode ?? null }
}

/**
 * The items a count covers, in sheet order: each of the venue's areas with
 * its items (shelf order), then `other` (covered, in no area). A full count
 * covers the active items in the venue's areas and every active item with a
 * move at the venue (counted, delivered, adjusted or received by transfer
 * there before); a key-item count
 * its list's items. Items counted outside that (found on a shelf) are lines
 * all the same.
 */
export async function countScope(tx, tenantId, count) {
  const areas = await tx`
    SELECT a.id, a.name, a.sort_order,
           COALESCE(array_agg(ai.item_id ORDER BY ai.sort_order, ai.id) FILTER (WHERE ai.item_id IS NOT NULL AND i.is_active), '{}') AS item_ids
      FROM stock_areas a
      LEFT JOIN stock_area_items ai ON ai.area_id = a.id AND ai.tenant_id = a.tenant_id
      LEFT JOIN inv_items i ON i.id = ai.item_id AND i.tenant_id = ai.tenant_id
     WHERE a.tenant_id = ${tenantId} AND a.venue_id = ${count.venue_id}
     GROUP BY a.id ORDER BY a.sort_order, lower(a.name)`
  let covered
  if (count.kind === 'key') {
    covered = count.key_list_id ? (await tx`
      SELECT li.item_id FROM stock_key_list_items li JOIN inv_items i ON i.id = li.item_id AND i.tenant_id = li.tenant_id AND i.is_active
       WHERE li.tenant_id = ${tenantId} AND li.list_id = ${count.key_list_id} ORDER BY li.sort_order, li.id`).map(r => r.item_id) : []
  } else {
    const seen = await tx`
      SELECT DISTINCT x.item_id FROM (
        SELECT l.item_id FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id AND c.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${tenantId} AND c.venue_id = ${count.venue_id} AND c.status = 'approved'
        UNION
        SELECT pl.item_id FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
         WHERE pl.tenant_id = ${tenantId} AND po.venue_id = ${count.venue_id} AND pl.item_id IS NOT NULL AND pl.received_qty > 0 AND po.received_at IS NOT NULL
        UNION
        SELECT a.item_id FROM stock_adjustments a WHERE a.tenant_id = ${tenantId} AND a.venue_id = ${count.venue_id}
        UNION
        SELECT l.item_id FROM stock_transfer_lines l JOIN stock_transfers t ON t.id = l.transfer_id AND t.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${tenantId} AND t.to_venue_id = ${count.venue_id} AND t.status = 'received' AND l.received_base > 0
        UNION
        SELECT u.item_id FROM stock_usage_days u WHERE u.tenant_id = ${tenantId} AND u.venue_id = ${count.venue_id}
      ) x JOIN inv_items i ON i.id = x.item_id AND i.tenant_id = ${tenantId} AND i.is_active`
    covered = [...new Set([...areas.flatMap(a => a.item_ids), ...seen.map(r => r.item_id)])]
  }
  const inScope = new Set(covered)
  const inArea = new Set()
  const sheet = areas.map(a => {
    const ids = count.kind === 'key' ? a.item_ids.filter(id => inScope.has(id)) : a.item_ids
    ids.forEach(id => inArea.add(id))
    return { id: a.id, name: a.name, item_ids: ids }
  })
  return { areas: sheet, other: covered.filter(id => !inArea.has(id)), item_ids: covered }
}

// ── Waste (phase 4b, migration 308) ───────────────────────────────────

/** The group's starting reasons, once (a flag on stock_settings, so deleting them all doesn't bring them back). */
export async function ensureWasteReasons(tx, tenantId) {
  const [s] = await tx`SELECT waste_reasons_seeded FROM stock_settings WHERE tenant_id = ${tenantId}`
  if (s?.waste_reasons_seeded) return
  const rows = WASTE_REASON_SEEDS.map((r, i) => ({ tenant_id: tenantId, name: r.name, kind: r.kind, sort_order: i }))
  await tx`INSERT INTO waste_reasons ${tx(rows, 'tenant_id', 'name', 'kind', 'sort_order')} ON CONFLICT DO NOTHING`
  await tx`
    INSERT INTO stock_settings (tenant_id, waste_reasons_seeded) VALUES (${tenantId}, true)
    ON CONFLICT (tenant_id) DO UPDATE SET waste_reasons_seeded = true`
}

/** The group's waste reasons in their order, each with how many entries use it. */
export async function loadWasteReasons(tx, tenantId) {
  await ensureWasteReasons(tx, tenantId)
  return tx`
    SELECT r.id, r.name, r.kind, r.sort_order, r.is_active,
           (SELECT count(*)::int FROM stock_waste w WHERE w.reason_id = r.id AND w.tenant_id = r.tenant_id) AS used
      FROM waste_reasons r WHERE r.tenant_id = ${tenantId}
     ORDER BY r.sort_order, lower(r.name)`
}

/** The venue's trading day (YYYY-MM-DD) at a moment: its till's day start, else DAY_STARTS_AT, in its time zone. */
export async function venueDay(tx, tenantId, venueId, at = new Date()) {
  const [v] = await tx`
    SELECT v.timezone, ps.day_starts_at FROM venues v
      LEFT JOIN pos_settings ps ON ps.venue_id = v.id AND ps.tenant_id = v.tenant_id
     WHERE v.id = ${venueId} AND v.tenant_id = ${tenantId}`
  return businessDate(at, v?.timezone || 'Europe/London', v?.day_starts_at || DAY_STARTS_AT)
}

/**
 * The cost engine's ctx for breaking dishes and batches into items: every
 * recipe, link, option rule and option, and every dish on a menu (the
 * draft's definition over what is live: a till sells from the live release,
 * which keeps the draft's ids). Prices aren't needed: what an item cost is
 * the average paid at the venue (costAt()), never the recipe's standard.
 */
export async function wasteCtx(tx, tenantId) {
  const { ctx } = await coverageCtx(tx, tenantId)
  return { ...ctx, _memo: new Map() }
}

/**
 * The till's voids marked wasted (pos_check_lines.void_waste: the dish had
 * been made), generated test sales left out (decision D10): each with its
 * venue, moment (the void's, else the line's send), trading day (its till
 * day's, else the venue's at that moment: the till's day start), dish, qty,
 * reason (voidReason(): the group's reason of that name, else the void's
 * words as preparation), who voided it (the till's staff), its check, and
 * its items with what each cost at the void's moment, and what couldn't be
 * broken in (gaps). Read only: the till is their record.
 *
 * The items are kept (stock_void_waste, migration 310) the first time a void
 * is read, so a dish that later leaves every menu, or a recipe or link
 * changed, leaves past waste as it was (D9: closed periods never change).
 * A void is broken in (itemsOf() through the recipe its dish uses at its
 * venue, revenue stream and order type, its options and a meal deal's picks
 * from the check's own record) when nothing is kept for it, when its own
 * record changed since (another moment or quantity), or while its till day
 * is open (D9: open days are recomputed); a dish on no menu now keeps what
 * was kept, and isn't kept when nothing was (it would say nothing). Keeping
 * is skipped where the transaction can't write as it reads (a report run's
 * repeatable read, a read-only one): what is read is the same.
 * from / to: moments; days: { from, to } trading days (YYYY-MM-DD);
 * stale: only voids with nothing kept, or whose record changed (the sweep);
 * since: only voids from that moment on.
 */
export async function loadWastedVoids(tx, tenantId, { venueIds = null, from = null, to = null, days = null, ctx = null, reasons = null, stale = false, since = null } = {}) {
  if (venueIds && !venueIds.length) return []
  const rows = await tx`
    SELECT x.* FROM (
      SELECT l.id, l.check_id, c.venue_id, c.number, c.number_code, l.item_id AS dish_id, l.name, l.qty::float8 AS qty,
             l.void_reason, COALESCE(l.voided_at, l.sent_at, c.opened_at) AS at, l.gross::int AS gross,
             COALESCE(d.business_date, ((COALESCE(l.voided_at, l.sent_at, c.opened_at) - (COALESCE(ps.day_starts_at, ${DAY_STARTS_AT}) || ':00')::interval)
                                         AT TIME ZONE COALESCE(v.timezone, 'Europe/London'))::date) AS day,
             (d.id IS NOT NULL AND d.closed_at IS NULL) AS day_open,
             COALESCE(l.revenue_stream_id, c.revenue_stream_id) AS revenue_stream_id, c.order_type_id, s.name AS by,
             k.line_id IS NOT NULL AS kept, k.at AS kept_at, k.qty::float8 AS kept_qty, k.recipe_id AS kept_recipe_id,
             k.recipe_name AS kept_recipe_name, k.gaps AS kept_gaps
        FROM pos_check_lines l
        JOIN pos_checks c ON c.id = l.check_id AND c.tenant_id = l.tenant_id
        JOIN venues v ON v.id = c.venue_id AND v.tenant_id = c.tenant_id
        LEFT JOIN pos_settings ps ON ps.venue_id = v.id AND ps.tenant_id = v.tenant_id
        LEFT JOIN pos_days d ON d.id = l.void_day_id AND d.tenant_id = l.tenant_id
        LEFT JOIN cash_staff s ON s.id = l.voided_by AND s.tenant_id = l.tenant_id
        LEFT JOIN stock_void_waste k ON k.tenant_id = l.tenant_id AND k.line_id = l.id
       WHERE l.tenant_id = ${tenantId} AND l.status = 'voided' AND l.void_waste AND NOT c.is_generated
         ${venueIds ? tx`AND c.venue_id = ANY(${venueIds}::uuid[])` : tx``}
    ) x
     WHERE true
       ${from ? tx`AND x.at >= ${ts(from)}` : tx``}
       ${to ? tx`AND x.at <= ${ts(to)}` : tx``}
       ${since ? tx`AND x.at >= ${ts(since)}` : tx``}
       ${days?.from ? tx`AND x.day >= ${days.from}::date` : tx``}
       ${days?.to ? tx`AND x.day <= ${days.to}::date` : tx``}
       ${stale ? tx`AND (NOT x.kept OR date_trunc('milliseconds', x.kept_at) <> date_trunc('milliseconds', x.at) OR x.kept_qty <> x.qty)` : tx``}
     ORDER BY x.at, x.id`
  if (!rows.length) return []
  const fresh = rows.filter(r => !sameRecord(r) || r.day_open)
  const keptIds = rows.filter(r => r.kept).map(r => r.id)
  const dishLines = fresh.filter(r => r.dish_id).map(r => r.id)
  const [keptItems, why, lines] = await Promise.all([
    keptIds.length ? tx`
      SELECT line_id, item_id, qty_base::float8 AS qty_base, cost_per_base::float8 AS cost_per_base
        FROM stock_void_waste_items WHERE tenant_id = ${tenantId} AND line_id = ANY(${keptIds}::text[])
       ORDER BY line_id, item_id` : [],
    reasons || tx`SELECT id, name, kind FROM waste_reasons WHERE tenant_id = ${tenantId}`,
    // The check's own record of each line broken in now: its options and a meal deal's picks.
    dishLines.length ? tx`
      SELECT l.id, (SELECT j FROM jsonb_array_elements(c.state->'lines') j WHERE j->>'id' = l.id LIMIT 1) AS line
        FROM pos_check_lines l JOIN pos_checks c ON c.id = l.check_id AND c.tenant_id = l.tenant_id
       WHERE l.tenant_id = ${tenantId} AND l.id = ANY(${dishLines}::text[])` : [],
  ])
  const keptOf = new Map()
  for (const i of keptItems) {
    if (!keptOf.has(i.line_id)) keptOf.set(i.line_id, [])
    keptOf.get(i.line_id).push({ item_id: i.item_id, qty_base: i.qty_base, cost_per_base: i.cost_per_base })
  }
  const kept = r => ({
    items: keptOf.get(r.id) || [], gaps: r.kept_gaps || [],
    recipe: r.kept_recipe_name ? { id: r.kept_recipe_id, name: r.kept_recipe_name } : null,
  })

  // Broken in now: by the recipe now, with each item's cost at the void's moment.
  const made = new Map()
  if (fresh.length) {
    const engine = dishLines.length ? await (ctx || wasteCtx(tx, tenantId)) : null
    const lineOf = new Map(lines.map(l => [l.id, l.line || {}]))
    const parts = new Map()
    for (const r of fresh) {
      if (!r.dish_id) {
        parts.set(r.id, { items: [], gaps: [r.name + ' was typed in on the till (no dish), so it has no recipe'], recipe: null, known: true })
        continue
      }
      const line = lineOf.get(r.id) || {}
      const known = !!(engine.dishes?.get ? engine.dishes.get(r.dish_id) : engine.dishes?.[r.dish_id])
      parts.set(r.id, {
        ...itemsOf({
          dish_id: r.dish_id, qty: r.qty, options: line.modifiers || [], picks: line.combo ?? null,
          scope: { venue_id: r.venue_id, revenue_stream_id: r.revenue_stream_id, order_type_id: r.order_type_id },
        }, engine),
        known,
      })
    }
    const itemIds = [...new Set([...parts.values()].flatMap(p => p.items.map(i => i.item_id)))]
    const latest = new Date(Math.max(...fresh.map(r => ts(r.at).getTime())))
    const costOf = itemIds.length ? await costLookup(tx, tenantId, [...new Set(fresh.map(r => r.venue_id))], itemIds, latest) : () => null
    for (const r of fresh) {
      const p = parts.get(r.id)
      // A dish on no menu now says nothing about the void: what was kept stands (nothing, when nothing was).
      if (!p.known && r.kept) continue
      made.set(r.id, {
        items: p.items.map(i => ({ item_id: i.item_id, qty_base: i.qty_base, cost_per_base: costOf(r.venue_id, i.item_id, r.at) })),
        gaps: p.gaps, recipe: p.recipe, keep: p.known,
      })
    }
    await keepVoidWaste(tx, tenantId, rows.filter(r => made.get(r.id)?.keep && !sameBreakdown(r, kept(r), made.get(r.id))), made)
  }

  return rows.map(r => {
    const rr = voidReason(r.void_reason, why)
    const parts = made.get(r.id) || kept(r)
    return {
      id: r.id, kind: 'till_void', check_id: r.check_id, check_number: r.number_code || (r.number != null ? String(r.number) : null),
      venue_id: r.venue_id, at: r.at, day: dayOf(r.day), dish_id: r.dish_id, name: r.name, qty: r.qty, unit: 'each',
      reason_id: rr.reason_id, reason: rr.reason, reason_kind: rr.kind, by: r.by || null, gross_pence: r.gross,
      revenue_stream_id: r.revenue_stream_id, order_type_id: r.order_type_id,
      items: parts.items, gaps: parts.gaps, recipe: parts.recipe,
    }
  })
}

const dayOf = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))

/** Whether what is kept for a void was broken in for its record as it is (the same moment, to the millisecond a Date holds, and quantity). */
const sameRecord = r => r.kept && ts(r.kept_at).getTime() === ts(r.at).getTime() && Number(r.kept_qty) === Number(r.qty)

/** Whether a void's breakdown now is what is kept for it already (its record, items, costs, gaps and recipe). */
function sameBreakdown(r, kept, made) {
  if (!sameRecord(r)) return false
  const key = p => JSON.stringify([
    [...p.items].sort((a, b) => String(a.item_id).localeCompare(String(b.item_id)))
      .map(i => [i.item_id, Math.round(Number(i.qty_base) * 10000), i.cost_per_base == null ? null : Math.round(Number(i.cost_per_base) * 1e8)]),
    p.gaps || [], p.recipe?.id ?? null, p.recipe?.name ?? null,
  ])
  return key(kept) === key(made)
}

/**
 * Keep the breakdown of these voids (stock_void_waste and its items),
 * replacing what was kept for them. Only where the transaction reads each
 * statement afresh and can write (read committed, not read only), under the
 * group's lock so two reads keeping the same void one after the other both
 * land; in a savepoint, so a read never fails for want of keeping.
 */
async function keepVoidWaste(tx, tenantId, rows, made) {
  if (!rows.length) return
  const [mode] = await tx`SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro`
  if (mode.iso !== 'read committed' || mode.ro === 'on') return
  try {
    await tx.savepoint(async sp => {
      await sp`SELECT pg_advisory_xact_lock(hashtext(${'stock_void_waste:' + tenantId}))`
      const ids = rows.map(r => r.id)
      await sp`DELETE FROM stock_void_waste WHERE tenant_id = ${tenantId} AND line_id = ANY(${ids}::text[])`
      await sp`INSERT INTO stock_void_waste ${sp(rows.map(r => {
        const m = made.get(r.id)
        return {
          tenant_id: tenantId, line_id: r.id, check_id: r.check_id, venue_id: r.venue_id, at: ts(r.at), qty: r.qty,
          recipe_id: m.recipe?.id ?? null, recipe_name: m.recipe?.name ?? null, gaps: sp.json(m.gaps || []),
        }
      }), 'tenant_id', 'line_id', 'check_id', 'venue_id', 'at', 'qty', 'recipe_id', 'recipe_name', 'gaps')}`
      const items = rows.flatMap(r => made.get(r.id).items.filter(i => Number(i.qty_base) !== 0).map(i => ({
        tenant_id: tenantId, line_id: r.id, item_id: i.item_id, qty_base: i.qty_base, cost_per_base: i.cost_per_base ?? null,
      })))
      if (items.length) await sp`INSERT INTO stock_void_waste_items ${sp(items, 'tenant_id', 'line_id', 'item_id', 'qty_base', 'cost_per_base')}`
    })
  } catch {
    // Kept on a later read, or by the sweep.
  }
}

/**
 * The sweep (jobs/stock-voids.js, every few minutes): each group's voids
 * marked wasted in the last SWEEP_DAYS with nothing kept for them yet (or
 * whose record changed) are broken in and kept, so what a void took off is
 * kept within minutes of it, whoever reads stock and whenever. System mode,
 * each group in its own transaction, every query filtered by that group.
 */
export const SWEEP_DAYS = 14
export async function sweepVoidWaste(log = null) {
  const since = new Date(Date.now() - SWEEP_DAYS * DAY)
  const groups = await systemSql`
    SELECT DISTINCT l.tenant_id FROM pos_check_lines l
      JOIN pos_checks c ON c.id = l.check_id AND c.tenant_id = l.tenant_id
      LEFT JOIN stock_void_waste k ON k.tenant_id = l.tenant_id AND k.line_id = l.id
     WHERE l.status = 'voided' AND l.void_waste AND NOT c.is_generated
       AND COALESCE(l.voided_at, l.sent_at, c.opened_at) >= ${since}
       AND (k.line_id IS NULL OR k.qty <> l.qty
            OR date_trunc('milliseconds', k.at) <> date_trunc('milliseconds', COALESCE(l.voided_at, l.sent_at, c.opened_at)))`
  const total = { groups: 0, voids: 0 }
  for (const { tenant_id: tenantId } of groups) {
    try {
      const n = await withSystem(async tx => (await loadWastedVoids(tx, tenantId, { stale: true, since })).length)
      total.groups++
      total.voids += n
    } catch (err) {
      log?.warn?.({ err: err?.message, tenantId }, 'Till voids sweep failed for a group')
    }
  }
  return total
}
