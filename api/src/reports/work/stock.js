// src/reports/work/stock.js
//
// Stock worked out in code for a report run (migration 287; inventory phase
// 4a, migrations 305 to 307), merged into WORKS in work/index.js. Every
// figure comes from the Stock page's own rules (services/stockSvc.js,
// shared/stock.js): on hand is the last approved count plus what moved
// since, sales taken off as usage from sales (phase 5, stock_usage_days).
//
//   stock_on_hand     one row per item per venue with a move there: now (not
//                     by period); value at what the item cost there lately
//   stock_moves       one row per move (delivery, approved count, adjustment)
//                     on a day at the venue, with the change and the balance
//                     after it (runningBalance()); value at the cost then,
//                     except a delivery's, which is `paid` (its supplier's
//                     price: the catalogue asks for purchasing prices too)
//   stock_count_lines one row per item of a submitted or approved count:
//                     counted (its areas added), expected at the count's
//                     moment (stockOnHand() without the count itself), the
//                     difference and its value (countReview()'s rule); latest:
//                     from the venue's latest approved count, in any period
//   stock_waste       (phase 4b) one row per item of each waste entry not
//                     undone and of each till void marked wasted (broken into
//                     items by loadWastedVoids(), which keeps them the first
//                     time: migration 310; test sales left out), on its
//                     trading day; an entry with no items is one row
//   stock_transfer_lines  (phase 4b) one row per transfer line at each end:
//                     out at the sender on the day sent, in at the receiver on
//                     the day received (sent, while in transit); lost in transit
//                     by lostInTransit()
//
// A report's venues narrow the rows; its period picks the days (moves and
// count lines). Values are filled for everyone; the catalogue's `needs:
// 'costing'` leaves them out for a role without Costing view.

import { loadStockOnHand, loadStockMoves, costLookup, loadWastedVoids } from '../../services/stockSvc.js'
import { runningBalance, stockOnHand, countReview, lostInTransit } from '../../../../shared/stock.js'

// The tables each work reads (the catalogue's from.tables). On hand and the ledger read waste
// (the till's voids marked wasted too) and transfers since phase 4b.
export const WASTE_TABLES = ['stock_waste', 'stock_waste_items', 'waste_reasons', 'pos_check_lines', 'pos_checks', 'stock_void_waste', 'stock_void_waste_items']
export const TRANSFER_TABLES = ['stock_transfers', 'stock_transfer_lines']
export const STOCK_TABLES = ['stock_counts', 'stock_count_lines', 'stock_adjustments', ...WASTE_TABLES, ...TRANSFER_TABLES]
export const MOVE_TABLES = [...STOCK_TABLES, 'purchase_order_lines', 'purchase_orders']
export const COUNT_LINE_TABLES = [...STOCK_TABLES, 'stock_areas']

const DAY = 86400000
const dayIn = (at, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
const inRanges = (day, ranges) => !ranges?.length || ranges.some(r => (!r.from || day >= r.from) && (!r.to || day <= r.to))
const lastDay = ranges => (ranges?.length && ranges.every(r => r.to) ? ranges.map(r => r.to).sort().at(-1) : null)
// The end of the period's last day anywhere (a day ends by 14:00 UTC the next day in every time zone).
const endOf = day => (day ? new Date(new Date(day + 'T00:00:00Z').getTime() + DAY + 14 * 3600000) : null)

async function itemsAndZones(tx, tenantId, itemIds) {
  const [items, venues] = await Promise.all([
    itemIds.length ? tx`
      SELECT i.id, i.name, i.base_unit, c.name AS category FROM inv_items i
        LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = i.tenant_id
       WHERE i.tenant_id = ${tenantId} AND i.id = ANY(${itemIds}::uuid[])` : [],
    tx`SELECT id, timezone FROM venues WHERE tenant_id = ${tenantId}`,
  ])
  return { itemOf: new Map(items.map(i => [i.id, i])), tzOf: new Map(venues.map(v => [v.id, v.timezone])) }
}

const r2 = n => (n == null ? null : Math.round(n * 100) / 100)

export const STOCK_WORKS = {
  stock_on_hand: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['item_id', 'uuid'],
      ['item_name', 'text'], ['base_unit', 'text'], ['category', 'text'],
      ['on_hand', 'numeric'], ['counted', 'numeric'], ['counted_at', 'timestamptz'],
      ['received_since', 'numeric'], ['adjusted_since', 'numeric'], ['never_counted', 'boolean'], ['value', 'numeric'],
    ],
    async fill(tx, { tenantId, venueIds }) {
      const rows = await loadStockOnHand(tx, tenantId, { venueIds })
      if (!rows.length) return []
      const itemIds = [...new Set(rows.map(r => r.item_id))]
      const { itemOf } = await itemsAndZones(tx, tenantId, itemIds)
      const costOf = await costLookup(tx, tenantId, [...new Set(rows.map(r => r.venue_id))], itemIds)
      return rows.filter(r => itemOf.has(r.item_id)).map(r => {
        const i = itemOf.get(r.item_id)
        const per = r.on_hand == null ? null : costOf(r.venue_id, r.item_id, null)
        return {
          tenant_id: tenantId, id: r.venue_id + '|' + r.item_id, venue_id: r.venue_id, item_id: r.item_id,
          item_name: i.name, base_unit: i.base_unit, category: i.category,
          on_hand: r.on_hand, counted: r.counted, counted_at: r.counted_at, received_since: r.received_since,
          adjusted_since: r.adjusted_since, never_counted: r.counted == null,
          value: per == null ? null : r2(r.on_hand * per),
        }
      })
    },
  },

  stock_moves: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['item_id', 'uuid'], ['item_name', 'text'], ['base_unit', 'text'],
      ['at', 'timestamptz'], ['date', 'date'], ['kind', 'text'], ['change', 'numeric'], ['counted', 'numeric'],
      ['balance', 'numeric'], ['source', 'text'], ['by', 'text'], ['value', 'numeric'], ['paid', 'numeric'],
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      // Every move up to the period's end: the balance runs from the first one.
      const moves = await loadStockMoves(tx, tenantId, { venueIds, to: endOf(lastDay(ranges)), costs: true })
      if (!moves.length) return []
      const { itemOf, tzOf } = await itemsAndZones(tx, tenantId, [...new Set(moves.map(m => m.item_id))])
      const byPair = new Map()
      for (const m of moves) {
        const k = m.venue_id + '|' + m.item_id
        if (!byPair.has(k)) byPair.set(k, [])
        byPair.get(k).push(m)
      }
      const out = []
      for (const list of byPair.values()) {
        for (const [n, m] of runningBalance(list).entries()) {
          const day = dayIn(m.at, tzOf.get(m.venue_id))
          if (!inRanges(day, ranges) || !itemOf.has(m.item_id)) continue
          const i = itemOf.get(m.item_id)
          const money = m.change == null || m.cost_per_base == null ? null : r2(m.change * m.cost_per_base)
          out.push({
            tenant_id: tenantId, id: [m.venue_id, m.item_id, m.source.type, m.source.id, n].join('|'),
            venue_id: m.venue_id, item_id: m.item_id, item_name: i.name, base_unit: i.base_unit,
            at: m.at, date: day, kind: m.kind, change: m.change, counted: m.kind === 'count' ? m.qty_base : null,
            balance: m.balance, source: m.source.label, by: m.by,
            value: m.kind === 'delivery' ? null : money,
            paid: m.kind === 'delivery' ? money : null,
          })
        }
      }
      return out
    },
  },

  stock_count_lines: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['count_id', 'uuid'], ['venue_id', 'uuid'], ['item_id', 'uuid'],
      ['item_name', 'text'], ['base_unit', 'text'], ['date', 'date'], ['counted_at', 'timestamptz'],
      ['kind', 'text'], ['status', 'text'], ['counted', 'numeric'], ['expected', 'numeric'],
      ['difference', 'numeric'], ['value', 'numeric'], ['areas', 'text'], ['counted_by', 'text'], ['confirmed_zero', 'boolean'],
      ['off', 'boolean'], ['latest', 'boolean'],
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      const counts = await tx`
        SELECT c.id, c.venue_id, c.kind, c.status, c.counted_at
          FROM stock_counts c
         WHERE c.tenant_id = ${tenantId} AND c.status IN ('submitted', 'approved')
           ${venueIds ? tx`AND c.venue_id = ANY(${venueIds}::uuid[])` : tx``}`
      const { tzOf } = await itemsAndZones(tx, tenantId, [])
      // Each venue's latest approved count, in any period (the starter "Last count's differences").
      const latestOf = new Map()
      for (const c of counts) {
        if (c.status !== 'approved') continue
        const was = latestOf.get(c.venue_id)
        if (!was || new Date(c.counted_at) > new Date(was.counted_at)) latestOf.set(c.venue_id, c)
      }
      const kept = counts.map(c => ({ ...c, day: dayIn(c.counted_at, tzOf.get(c.venue_id)) })).filter(c => inRanges(c.day, ranges))
      if (!kept.length) return []
      const lines = await tx`
        SELECT l.count_id, l.item_id, sum(l.qty_base)::float8 AS qty_base, bool_and(l.confirmed_zero) AS confirmed_zero,
               string_agg(DISTINCT a.name, ', ') AS areas, string_agg(DISTINCT l.counted_by, ', ') AS counted_by
          FROM stock_count_lines l
          LEFT JOIN stock_areas a ON a.id = l.area_id AND a.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${tenantId} AND l.count_id = ANY(${kept.map(c => c.id)}::uuid[])
         GROUP BY l.count_id, l.item_id`
      if (!lines.length) return []
      const itemIds = [...new Set(lines.map(l => l.item_id))]
      const venues = [...new Set(kept.map(c => c.venue_id))]
      const latest = new Date(Math.max(...kept.map(c => new Date(c.counted_at).getTime())))
      const [moves, costOf, { itemOf }] = await Promise.all([
        loadStockMoves(tx, tenantId, { venueIds: venues, itemIds, to: latest }),
        costLookup(tx, tenantId, venues, itemIds, latest),
        itemsAndZones(tx, tenantId, itemIds),
      ])
      const byPair = new Map()
      for (const m of moves) {
        const k = m.venue_id + '|' + m.item_id
        if (!byPair.has(k)) byPair.set(k, [])
        byPair.get(k).push(m)
      }
      const countOf = new Map(kept.map(c => [c.id, c]))
      return lines.filter(l => itemOf.has(l.item_id)).map(l => {
        const c = countOf.get(l.count_id)
        const own = (byPair.get(c.venue_id + '|' + l.item_id) || []).filter(m => !(m.kind === 'count' && m.source.id === c.id))
        const expected = stockOnHand({ moves: own, at: c.counted_at }).on_hand
        const per = costOf(c.venue_id, l.item_id, c.counted_at)
        const [row] = countReview([l], { expected: { [l.item_id]: expected }, cost: { [l.item_id]: per } }).rows
        const i = itemOf.get(l.item_id)
        return {
          tenant_id: tenantId, id: c.id + '|' + l.item_id, count_id: c.id, venue_id: c.venue_id, item_id: l.item_id,
          item_name: i.name, base_unit: i.base_unit, date: c.day, counted_at: c.counted_at, kind: c.kind, status: c.status,
          counted: row.counted, expected: row.expected, difference: row.diff, value: row.value,
          areas: l.areas, counted_by: l.counted_by, confirmed_zero: !!l.confirmed_zero,
          off: !!row.diff, latest: latestOf.get(c.venue_id)?.id === c.id,
        }
      })
    },
  },

  // Phase 4b: waste, a row per item of each entry (logged, not undone; and each till void marked
  // wasted, broken into items through its dish's recipe, test sales left out); an entry that
  // couldn't be broken into items is one row with no item, so it still counts.
  stock_waste: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['entry_id', 'text'], ['venue_id', 'uuid'], ['at', 'timestamptz'], ['date', 'date'],
      ['source', 'text'], ['what', 'text'], ['name', 'text'], ['dish_id', 'uuid'], ['entry_qty', 'numeric'], ['entry_unit', 'text'],
      ['item_id', 'uuid'], ['item_name', 'text'], ['base_unit', 'text'], ['qty', 'numeric'],
      ['reason', 'text'], ['kind', 'text'], ['by', 'text'], ['value', 'numeric'], ['gaps', 'text'], ['reverses', 'boolean'], ['check_id', 'text'],
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      const days = ranges?.length && ranges.every(r => r.from && r.to)
        ? { from: ranges.map(r => r.from).sort()[0], to: ranges.map(r => r.to).sort().at(-1) } : null
      const [logged, voids] = await Promise.all([
        tx`
          SELECT w.id, w.venue_id, w.wasted_at AS at, w.day::text AS day, w.what, w.name, w.dish_id, w.qty::float8 AS qty, w.unit,
                 w.reason, w.reason_kind, w.wasted_by AS by, w.gaps, (w.reverses_id IS NOT NULL) AS reverses,
                 wi.item_id, wi.qty_base::float8 AS item_qty, wi.cost_per_base::float8 AS cost_per_base
            FROM stock_waste w
            LEFT JOIN stock_waste_items wi ON wi.waste_id = w.id AND wi.tenant_id = w.tenant_id
           WHERE w.tenant_id = ${tenantId} AND w.undone_at IS NULL
             ${venueIds ? tx`AND w.venue_id = ANY(${venueIds}::uuid[])` : tx``}
             ${days ? tx`AND w.day BETWEEN ${days.from}::date AND ${days.to}::date` : tx``}`,
        loadWastedVoids(tx, tenantId, { venueIds, days }),
      ])
      const itemIds = [...new Set([...logged.map(r => r.item_id), ...voids.flatMap(v => v.items.map(i => i.item_id))].filter(Boolean))]
      const { itemOf } = await itemsAndZones(tx, tenantId, itemIds)
      const out = []
      for (const r of logged) {
        if (!inRanges(r.day, ranges)) continue
        const i = r.item_id ? itemOf.get(r.item_id) : null
        out.push({
          tenant_id: tenantId, id: r.id + '|' + (r.item_id || '-'), entry_id: r.id, venue_id: r.venue_id, at: r.at, date: r.day,
          source: 'logged', what: r.what, name: r.name, dish_id: r.dish_id, entry_qty: r.qty, entry_unit: r.unit,
          item_id: r.item_id, item_name: i?.name ?? null, base_unit: i?.base_unit ?? null, qty: r.item_qty,
          reason: r.reason, kind: r.reason_kind, by: r.by,
          value: r.item_qty == null || r.cost_per_base == null ? null : r2(r.item_qty * r.cost_per_base),
          gaps: (r.gaps || []).join(' ') || null, reverses: r.reverses, check_id: null,
        })
      }
      for (const v of voids) {
        if (!inRanges(v.day, ranges)) continue
        const base = {
          tenant_id: tenantId, entry_id: v.id, venue_id: v.venue_id, at: v.at, date: v.day, source: 'till_void', what: 'dish',
          name: v.name, dish_id: v.dish_id, entry_qty: v.qty, entry_unit: 'each', reason: v.reason, kind: v.reason_kind, by: v.by,
          gaps: v.gaps.join(' ') || null, reverses: false, check_id: v.check_id,
        }
        if (!v.items.length) out.push({ ...base, id: v.id + '|-', item_id: null, item_name: null, base_unit: null, qty: null, value: null })
        for (const it of v.items) {
          const i = itemOf.get(it.item_id)
          // Its cost at the void's moment, kept with its items (loadWastedVoids()).
          const per = it.cost_per_base ?? null
          out.push({ ...base, id: v.id + '|' + it.item_id, item_id: it.item_id, item_name: i?.name ?? null, base_unit: i?.base_unit ?? null, qty: it.qty_base, value: per == null ? null : r2(it.qty_base * per) })
        }
      }
      return out
    },
  },

  // Phase 4b: transfers, a row per line at each end: sent from the sending venue (out) and
  // received at the other (in), with what was sent, what arrived and what was lost in transit
  // (lostInTransit()), valued at the sender's average when it was sent.
  stock_transfer_lines: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['transfer_id', 'uuid'], ['number', 'int'], ['venue_id', 'uuid'], ['other_venue_id', 'uuid'],
      ['direction', 'text'], ['status', 'text'], ['date', 'date'], ['sent_at', 'timestamptz'], ['received_at', 'timestamptz'],
      ['item_id', 'uuid'], ['item_name', 'text'], ['base_unit', 'text'], ['sent', 'numeric'], ['received', 'numeric'], ['lost', 'numeric'],
      ['value', 'numeric'], ['received_value', 'numeric'], ['lost_value', 'numeric'], ['sent_by', 'text'], ['received_by', 'text'], ['note', 'text'],
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      const rows = await tx`
        SELECT l.id, l.transfer_id, t.number, t.from_venue_id, t.to_venue_id, t.status, t.sent_at, t.received_at, t.cancelled_at,
               t.sent_by, t.received_by, t.note, l.item_id, i.name AS item_name, i.base_unit,
               l.qty_base::float8 AS sent, l.received_base::float8 AS received, l.cost_per_base::float8 AS cost_per_base
          FROM stock_transfer_lines l
          JOIN stock_transfers t ON t.id = l.transfer_id AND t.tenant_id = l.tenant_id
          JOIN inv_items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${tenantId}
           ${venueIds ? tx`AND (t.from_venue_id = ANY(${venueIds}::uuid[]) OR t.to_venue_id = ANY(${venueIds}::uuid[]))` : tx``}`
      if (!rows.length) return []
      const { tzOf } = await itemsAndZones(tx, tenantId, [])
      const want = venueIds ? new Set(venueIds) : null
      const out = []
      for (const r of rows) {
        const lost = r.status === 'received' ? lostInTransit(r.sent, r.received) : null
        const money = q => (q == null || r.cost_per_base == null ? null : r2(q * r.cost_per_base))
        const shared = {
          tenant_id: tenantId, transfer_id: r.transfer_id, number: r.number, status: r.status, sent_at: r.sent_at, received_at: r.received_at,
          item_id: r.item_id, item_name: r.item_name, base_unit: r.base_unit, sent: r.sent, received: r.received, lost,
          value: money(r.sent), received_value: money(r.received), lost_value: money(lost), sent_by: r.sent_by, received_by: r.received_by, note: r.note,
        }
        const sides = [
          { direction: 'out', venue_id: r.from_venue_id, other_venue_id: r.to_venue_id, at: r.sent_at },
          { direction: 'in', venue_id: r.to_venue_id, other_venue_id: r.from_venue_id, at: r.received_at || r.sent_at },
        ]
        for (const s of sides) {
          if (want && !want.has(s.venue_id)) continue
          const day = dayIn(s.at, tzOf.get(s.venue_id))
          if (!inRanges(day, ranges)) continue
          out.push({ ...shared, id: r.id + '|' + s.direction, direction: s.direction, venue_id: s.venue_id, other_venue_id: s.other_venue_id, date: day })
        }
      }
      return out
    },
  },
}
