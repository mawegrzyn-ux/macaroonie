// src/services/stockForecastSvc.js
//
// The forecast and the suggested order at a venue (inventory phase 9a,
// migrations 319 and 320; docs/INVENTORY.md 9). The rules are
// shared/forecast.js; this file reads what they need, in the caller's
// transaction:
//
//   - usage history: the trading days the usage job worked out in the last
//     FORECAST_WEEKS weeks before today (stock_usage_marks) and what sales
//     took off each item on them (stock_usage_days), and today's so far;
//   - covers: the venue's bookings (the bookings area's, read only, never
//     cancelled ones) for the window and the same weekdays before it, by
//     their trading day (the till's day start, 04:00 when none is set), with
//     when each was made, so booked so far is compared with what had been
//     booked as far ahead before (bookedCovers());
//   - on hand (the stock area's loadStockOnHand()) and on order: placed
//     purchase orders not yet received at the venue (to send or sent) whose
//     delivery day is before the delivery after next, an order's own left out;
//   - the group's buffer (stock_settings.buffer_pct).
//
//   loadBuffer(tx, tenantId)                                   the buffer %
//   loadHistory(tx, tenantId, venueId, itemIds, today)         { marked, usage, usedToday }
//   loadCovers(tx, tenantId, venueId, days, { timezone, day_starts_at, now })   Map day -> { booked, usual }
//   onOrderBefore(tx, tenantId, venueId, itemIds, before, { exceptOrderId })   Map item -> base
//   venuePars(tx, tenantId, venueId, itemIds)                  Map item -> the highest par on the venue's active lists
//   suggestFor(tx, tenantId, { venue, supplier, items, deliveryDate, orderId, now })
//   supplierItems(tx, tenantId, venue, supplierId, { today })  what a supplier sells the venue that it orders or sales use
//
// Days are trading days; a forecast never reads the clock itself: `now` is
// passed in (a test pins it), and today is venueToday() at that moment.

import { venueToday } from './stockUsageSvc.js'
import { loadStockOnHand } from './stockSvc.js'
import { resolveQuotes } from './purchasingSvc.js'
import {
  historyDays, windowDays, bookedCovers, coversFactor, forecastUsage, suggestedOrder, deliveryAfter, bufferPct, FORECAST_WEEKS,
} from '../../../shared/forecast.js'
import { addDays, packLabel } from '../../../shared/procurement.js'

const round4 = n => Math.round(Number(n) * 10000) / 10000

/** The group's buffer on top of the forecast, in % (10 when nothing is saved). */
export async function loadBuffer(tx, tenantId) {
  const [s] = await tx`SELECT buffer_pct::float8 AS buffer_pct FROM stock_settings WHERE tenant_id = ${tenantId}`
  return bufferPct(s?.buffer_pct ?? null)
}

/**
 * What sales took off the items over the weeks the forecast looks back over:
 * marked = the days the usage job worked out then (a day with none of an item
 * taken off is that item's 0), usage = Map item -> { day: qty }, and today's
 * so far (Map item -> qty: up to the job's last run).
 */
export async function loadHistory(tx, tenantId, venueId, itemIds, today) {
  const days = historyDays(today)
  const from = days[0], to = days[days.length - 1]
  if (!itemIds.length) return { marked: [], usage: new Map(), usedToday: new Map() }
  const [marks, rows, now] = await Promise.all([
    tx`SELECT day::text AS day FROM stock_usage_marks
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND day BETWEEN ${from}::date AND ${to}::date`,
    tx`SELECT item_id, day::text AS day, qty_base::float8 AS qty FROM stock_usage_days
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND item_id = ANY(${itemIds}::uuid[])
          AND day BETWEEN ${from}::date AND ${to}::date`,
    tx`SELECT item_id, qty_base::float8 AS qty FROM stock_usage_days
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND item_id = ANY(${itemIds}::uuid[]) AND day = ${today}::date`,
  ])
  const usage = new Map()
  for (const r of rows) {
    if (!usage.has(r.item_id)) usage.set(r.item_id, {})
    usage.get(r.item_id)[r.day] = r.qty
  }
  return { marked: marks.map(m => m.day), usage, usedToday: new Map(now.map(r => [r.item_id, r.qty])) }
}

/**
 * Covers booked for each day and the usual by the same point (bookedCovers()),
 * from the venue's bookings that aren't cancelled, by trading day: a booking
 * at 01:00 is the trading day before's.
 */
export async function loadCovers(tx, tenantId, venueId, days, { timezone, day_starts_at, now }) {
  if (!days.length) return new Map()
  const first = addDays(days[0], -7 * FORECAST_WEEKS), last = days[days.length - 1]
  const tz = timezone || 'Europe/London'
  const rows = await tx`
    SELECT ((b.starts_at AT TIME ZONE ${tz}) - ${day_starts_at}::time::interval)::date::text AS day, b.covers, b.created_at
      FROM bookings b
     WHERE b.tenant_id = ${tenantId} AND b.venue_id = ${venueId} AND b.status <> 'cancelled'
       AND b.starts_at >= ((${first}::date + ${day_starts_at}::time)::timestamp AT TIME ZONE ${tz})
       AND b.starts_at <  ((${last}::date + 1 + ${day_starts_at}::time)::timestamp AT TIME ZONE ${tz})`
  return bookedCovers(rows, { days, now })
}

/**
 * What placed orders bring the items before a day: purchase orders to send
 * or sent at the venue (not received) whose delivery day is before `before`
 * (late ones count: they are still coming), in each item's base unit, lines
 * of another unit left out (as on hand reads deliveries), a restaurant
 * order's own purchase orders left out.
 */
export async function onOrderBefore(tx, tenantId, venueId, itemIds, before, { exceptOrderId = null } = {}) {
  if (!itemIds.length) return new Map()
  const rows = await tx`
    SELECT pl.item_id, sum(pl.qty * pl.pack_base_qty)::float8 AS qty
      FROM purchase_order_lines pl
      JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
      JOIN inv_items i ON i.id = pl.item_id AND i.tenant_id = pl.tenant_id
     WHERE pl.tenant_id = ${tenantId} AND po.venue_id = ${venueId} AND po.status IN ('to_send', 'sent') AND NOT po.no_order
       AND pl.item_id = ANY(${itemIds}::uuid[]) AND pl.qty > 0 AND pl.pack_base_qty > 0 AND pl.base_unit = i.base_unit
       AND po.delivery_date < ${before}::date
       AND po.supply_order_id IS DISTINCT FROM ${exceptOrderId}
     GROUP BY pl.item_id`
  return new Map(rows.map(r => [r.item_id, round4(r.qty)]))
}

/** Each item's par at the venue: the highest on the venue's active order lists (as the Stock page reads it). */
export async function venuePars(tx, tenantId, venueId, itemIds) {
  if (!itemIds.length) return new Map()
  const rows = await tx`
    SELECT li.item_id, max(p.par_base)::float8 AS par
      FROM order_list_pars p
      JOIN order_list_items li ON li.id = p.list_item_id AND li.tenant_id = p.tenant_id
      JOIN order_lists l ON l.id = li.list_id AND l.tenant_id = li.tenant_id AND l.is_active
     WHERE p.tenant_id = ${tenantId} AND p.venue_id = ${venueId} AND p.par_base IS NOT NULL AND li.item_id = ANY(${itemIds}::uuid[])
     GROUP BY li.item_id`
  return new Map(rows.map(r => [r.item_id, r.par]))
}

/**
 * The suggested order for a supplier at a venue (suggestedOrder() per item):
 * supplier = loadSuppliersForVenue()'s row for the venue (its delivery days
 * and next delivery there); items = [{ item_id, name, base_unit, quote
 * (the price it is ordered on, of this supplier), par_base }]. The order
 * arrives on `deliveryDate` (the supplier's next delivery when not given)
 * and has to last until the delivery after it. orderId: a restaurant order
 * whose own purchase orders aren't on order for it.
 * -> { supplier_id, supplier_name, today, next_delivery, after, window: { from, to, days },
 *      buffer_pct, covers: [{ day, pct, words }], lines: [...] }
 */
export async function suggestFor(tx, tenantId, { venue, supplier, items, deliveryDate = null, orderId = null, now = new Date() }) {
  const { today, timezone, day_starts_at } = await venueToday(tx, tenantId, venue.id, now)
  const next = deliveryDate || supplier.next_delivery
  const after = deliveryAfter(supplier, next)
  const days = windowDays(today, after)
  const ids = items.map(i => i.item_id)
  const [history, covers, hand, onOrder, buffer] = await Promise.all([
    loadHistory(tx, tenantId, venue.id, ids, today),
    loadCovers(tx, tenantId, venue.id, days, { timezone, day_starts_at, now }),
    ids.length ? loadStockOnHand(tx, tenantId, { venueIds: [venue.id], itemIds: ids }) : [],
    onOrderBefore(tx, tenantId, venue.id, ids, after, { exceptOrderId: orderId }),
    loadBuffer(tx, tenantId),
  ])
  const handOf = new Map(hand.map(h => [h.item_id, h.on_hand]))
  const lines = items.map(it => {
    const forecast = forecastUsage({
      history: { marked: history.marked, usage: history.usage.get(it.item_id) || {} },
      days: days.map(d => ({ day: d, covers: covers.get(d) || null, used: d === today ? history.usedToday.get(it.item_id) ?? 0 : null })),
      unit: it.base_unit, todayDay: today,
    })
    const stock = { on_hand: handOf.get(it.item_id) ?? null, on_order: onOrder.get(it.item_id) || 0 }
    const s = suggestedOrder({ forecast, par_base: it.par_base ?? null, stock, quote: it.quote, buffer_pct: buffer, unit: it.base_unit, after })
    return {
      item_id: it.item_id, name: it.name, base_unit: it.base_unit, par_base: it.par_base ?? null,
      quote_id: it.quote?.id ?? null, pack_label: it.quote ? it.quote.pack_label || packLabel(it.quote) : null,
      ...s,
      days: forecast.days.map(d => ({ day: d.day, usual: d.usual, how: d.how, covers_pct: d.covers_pct, qty: d.qty, used: d.used, rest: d.rest })),
    }
  })
  return {
    supplier_id: supplier.id, supplier_name: supplier.name, today, next_delivery: next, after,
    window: { from: today, to: after, days }, buffer_pct: buffer,
    covers: days.map(d => {
      const f = coversFactor(covers.get(d) || {})
      return { day: d, pct: f.pct, words: f.words }
    }),
    lines,
  }
}

/**
 * What a supplier sells the venue that the venue orders or sales use: items
 * whose usual price at the venue (chooseQuote()) is this supplier's and that
 * are on one of the venue's active order lists, or that sales used in the
 * weeks the forecast looks back over. -> [{ item_id, name, base_unit, quote, par_base }]
 */
export async function supplierItems(tx, tenantId, venue, supplierId, { today }) {
  const from = historyDays(today)[0]
  const rows = await tx`
    SELECT DISTINCT i.id AS item_id, i.name, i.base_unit
      FROM inv_items i
      JOIN inv_quotes q ON q.item_id = i.id AND q.tenant_id = i.tenant_id AND q.supplier_id = ${supplierId} AND q.is_active
     WHERE i.tenant_id = ${tenantId} AND i.is_active
       AND (EXISTS (SELECT 1 FROM order_list_items li
                      JOIN order_lists l ON l.id = li.list_id AND l.tenant_id = li.tenant_id AND l.is_active
                      JOIN order_list_venues lv ON lv.list_id = l.id AND lv.tenant_id = l.tenant_id AND lv.venue_id = ${venue.id}
                     WHERE li.item_id = i.id AND li.tenant_id = i.tenant_id)
            OR EXISTS (SELECT 1 FROM stock_usage_days u
                        WHERE u.tenant_id = i.tenant_id AND u.venue_id = ${venue.id} AND u.item_id = i.id AND u.day >= ${from}::date))`
  if (!rows.length) return []
  const ids = rows.map(r => r.item_id)
  const [{ picks }, pars] = await Promise.all([resolveQuotes(tx, tenantId, venue.id, ids), venuePars(tx, tenantId, venue.id, ids)])
  return rows
    .map(r => ({ ...r, quote: picks.get(r.item_id)?.quote || null, par_base: pars.get(r.item_id) ?? null }))
    .filter(r => r.quote?.supplier_id === supplierId)
    .sort((a, b) => a.name.localeCompare(b.name))
}
