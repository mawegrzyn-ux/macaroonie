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
// MOVE_SOURCES is the list of where moves come from. Phase 4b adds waste and
// transfers (out and in) as two more entries; loadStockMoves() and every
// caller stay as they are. Usage from sales is phase 5 (SALES_COUNTED).
//
//   MOVE_SOURCES, SALES_COUNTED, NO_SALES_NOTE
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

import { stockOnHand, countUnits, defaultCountUnit } from '../../../shared/stock.js'
import { poNumberLabel } from '../../../shared/procurement.js'
import { itemCost, AVERAGE_DAYS } from '../../../shared/costing.js'
import { loadCostItems } from './costingSvc.js'

export const SALES_COUNTED = false
export const NO_SALES_NOTE = 'Sales aren\'t taken off yet: usage from sales comes with inventory phase 5, so on hand is the last approved count plus deliveries and adjustments since.'

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

/** Adjustments: signed, with their reason. */
async function adjustmentMoves(tx, tenantId, cut) {
  const rows = await tx`
    SELECT a.venue_id, a.item_id, a.adjusted_at AS at, a.qty_base::float8 AS qty_base, a.id AS source_id, a.reason, a.adjusted_by AS by
      FROM stock_adjustments a
     WHERE a.tenant_id = ${tenantId} ${cutOf(tx, cut, 'a.venue_id', 'a.item_id', 'a.adjusted_at')}`
  return rows.map(r => ({
    venue_id: r.venue_id, item_id: r.item_id, at: r.at, kind: 'adjustment', qty_base: r.qty_base, cost_per_base: null,
    source: { type: 'adjustment', id: r.source_id, label: r.reason }, by: r.by,
  }))
}

// Phase 4b adds { kind: 'waste', load } and { kind: 'transfer_out' | 'transfer_in', load } here.
export const MOVE_SOURCES = [
  { kind: 'delivery', load: deliveryMoves },
  { kind: 'count', load: countMoves },
  { kind: 'adjustment', load: adjustmentMoves },
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

/** What each move cost at its time: the delivery's own price, else the average paid (else the last paid) before it. */
async function fillCosts(tx, tenantId, moves) {
  const need = moves.filter(m => m.cost_per_base == null)
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

/** The average paid at a venue over the AVERAGE_DAYS before `at`, else the last price paid before it, else null. */
function costAt(item, venueId, receipts, at) {
  if (!item) return null
  const t = new Date(at).getTime()
  const before = receipts.filter(r => new Date(r.at).getTime() <= t)
  if (!before.length) return null
  const data = { receipts: { [item.id]: before }, since: new Date(t - AVERAGE_DAYS * DAY).toISOString() }
  const avg = itemCost(item, venueId, data, 'average')
  if (avg.per_base != null) return avg.per_base
  return itemCost(item, venueId, data, 'last').per_base
}

/**
 * A way to ask what an item cost at a venue at a moment, with what was
 * received read once: (venueId, itemId, at) -> pounds per base unit or null
 * (costAt()). For many moments at once (a report's count lines).
 */
export async function costLookup(tx, tenantId, venueIds, itemIds, to = null) {
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
  return (venueId, itemId, at) => costAt(items.get(itemId), venueId, byKey.get(venueId + '|' + itemId) || [], at ?? new Date())
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
  const [s] = await tx`SELECT second_person_approves, blind_count FROM stock_settings WHERE tenant_id = ${tenantId}`
  return { second_person_approves: !!s?.second_person_approves, blind_count: !!s?.blind_count }
}

export async function loadVenueSettings(tx, tenantId, venueId) {
  const [s] = await tx`SELECT count_weekday, count_kind, key_list_id FROM stock_venue_settings WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
  return { venue_id: venueId, count_weekday: s?.count_weekday ?? null, count_kind: s?.count_kind ?? 'full', key_list_id: s?.key_list_id ?? null }
}

/**
 * The items a count covers, in sheet order: each of the venue's areas with
 * its items (shelf order), then `other` (covered, in no area). A full count
 * covers the active items in the venue's areas and every active item with a
 * move at the venue (counted or delivered there before); a key-item count
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
