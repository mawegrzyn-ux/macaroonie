// src/services/stockVarianceSvc.js
//
// Stock periods and variance (inventory phase 6a, migration 312;
// docs/INVENTORY.md 8.1, decision D9). A period runs between two approved
// full counts at a venue (stock_periods): made when a full count is
// approved, the previous approved full count opening it (periodsForCount()).
// The period running since the venue's latest approved full count isn't
// stored: it is "current", to now. The figures are shared/variance.js's,
// over the ledger loadStockMoves() reads (services/stockSvc.js), priced at
// one price per item for the period: the average paid at the venue over the
// 90 days before its end, else the last paid, else the standard price (what
// usage from sales costs at).
//
// Closing a period freezes its figures (stock_periods.figures) and the
// trading days it holds (days_from to days_to: each day whose last sale is
// inside it, and the days wholly inside it): usage from sales never works a
// closed day out again (closedRanges() feeds usageHooks.isDayClosed() in
// services/stockUsageSvc.js), and a sale reaching one late is kept apart in
// stock_usage_late, landing in the next open period (landingPeriod()).
//
//   PERIOD_COLS, loadPeriod(tx, tenantId, id), venuePeriods(tx, tenantId, venueId)
//   currentPeriod(tx, tenantId, venueId)          since the latest approved full count
//   periodsForCount(tx, tenantId, count)          a full count approved: its periods
//   closedRanges(tx, tenantId, venueId)           the closed periods' trading days
//   landingPeriod(tx, tenantId, venueId, day)     where a late sale on a closed day lands
//   periodDays(tx, tenantId, period)              the trading days a period holds
//   periodFigures(tx, tenantId, period, { itemIds, settings, now })   live: periodVariance() and more
//   foodSales(tx, tenantId, period)               net food sales (pence) with late sales landed
//   itemFacts(tx, tenantId, period, item, row)    the facts explainVariance() words
//   keyFigures(tx, tenantId, venueId, { from, to })   key items between their counts
//   loadReviews(tx, tenantId, periodIds)          the reviewed flags
//   toReview(tx, tenantId, venueId, { days })     closed periods with flagged items not reviewed (Today)

import { itemVariance, periodVariance, keyIntervals, isFoodSale, varianceSettings } from '../../../shared/variance.js'
import { itemCost } from '../../../shared/costing.js'
import { businessDate } from '../../../shared/pos/reports.js'
import { poNumberLabel } from '../../../shared/procurement.js'
import { loadStockMoves, costLookup, DAY_STARTS_AT } from './stockSvc.js'
import { loadCosting } from './costingSvc.js'

export const PERIOD_COLS = 'id, venue_id, opening_count_id, closing_count_id, from_at, to_at, status, days_from::text AS days_from, days_to::text AS days_to, figures, closed_by, closed_at, reopened_by, reopened_at, reopen_note, history, created_at, updated_at'

const DAY = 86400000
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
const round4 = n => Math.round(Number(n) * 10000) / 10000

/** A period of the group (rule 4), or null. lock: FOR UPDATE. */
export async function loadPeriod(tx, tenantId, id, { lock = false } = {}) {
  const rows = lock
    ? await tx`SELECT ${tx.unsafe(PERIOD_COLS)} FROM stock_periods WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : await tx`SELECT ${tx.unsafe(PERIOD_COLS)} FROM stock_periods WHERE id = ${id} AND tenant_id = ${tenantId}`
  return rows[0] || null
}

/** A venue's stored periods, newest first, each with its closing count's kind and who approved it. */
export async function venuePeriods(tx, tenantId, venueId, { limit = 60 } = {}) {
  return tx`
    SELECT ${tx.unsafe(PERIOD_COLS)} FROM stock_periods
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
     ORDER BY to_at DESC LIMIT ${limit}`
}

/** The period running since the venue's latest approved full count (to now), or null when it has none. */
export async function currentPeriod(tx, tenantId, venueId) {
  const [c] = await tx`
    SELECT id, counted_at FROM stock_counts
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND status = 'approved' AND kind = 'full'
     ORDER BY counted_at DESC, created_at DESC LIMIT 1`
  return c ? { id: null, current: true, venue_id: venueId, opening_count_id: c.id, closing_count_id: null, from_at: c.counted_at, to_at: null, status: 'open' } : null
}

/**
 * A full count was approved: the periods it makes. The previous approved
 * full count at the venue opens one to it, and when an approved full count
 * already follows it (a count dated back) it opens one to that too; an open
 * period it falls inside is split in two. Inside a closed period it makes
 * none: the closed figures stand (said in `note`). Late sales that landed in
 * the period running since the latest full count land in the new one.
 * -> { periods: [rows], note }
 */
export async function periodsForCount(tx, tenantId, count) {
  if (count.kind !== 'full') return { periods: [], note: null }
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'stock_periods:' + count.venue_id}))`
  const [prev] = await tx`
    SELECT id, counted_at FROM stock_counts
     WHERE tenant_id = ${tenantId} AND venue_id = ${count.venue_id} AND status = 'approved' AND kind = 'full'
       AND id <> ${count.id} AND counted_at < ${count.counted_at}
     ORDER BY counted_at DESC, created_at DESC LIMIT 1`
  const [next] = await tx`
    SELECT id, counted_at FROM stock_counts
     WHERE tenant_id = ${tenantId} AND venue_id = ${count.venue_id} AND status = 'approved' AND kind = 'full'
       AND id <> ${count.id} AND counted_at > ${count.counted_at}
     ORDER BY counted_at, created_at LIMIT 1`
  const [around] = await tx`
    SELECT id, status FROM stock_periods
     WHERE tenant_id = ${tenantId} AND venue_id = ${count.venue_id} AND from_at < ${count.counted_at} AND to_at > ${count.counted_at}
     LIMIT 1`
  if (around?.status === 'closed') {
    return { periods: [], note: 'This count is inside a closed period, so it makes no period of its own: the closed period\'s figures stand.' }
  }
  const made = []
  const make = async (open, close) => {
    const [p] = await tx`
      INSERT INTO stock_periods (tenant_id, venue_id, opening_count_id, closing_count_id, from_at, to_at)
      VALUES (${tenantId}, ${count.venue_id}, ${open.id}, ${close.id}, ${open.counted_at}, ${close.counted_at})
      ON CONFLICT (tenant_id, venue_id, closing_count_id) DO NOTHING
      RETURNING ${tx.unsafe(PERIOD_COLS)}`
    if (p) made.push(p)
    return p
  }
  const first = prev ? await make(prev, count) : null
  if (around) {
    // An open period split in two: what landed late in it lands in its first part.
    if (first) await tx`UPDATE stock_usage_late SET period_id = ${first.id} WHERE tenant_id = ${tenantId} AND period_id = ${around.id}`
    await tx`DELETE FROM stock_periods WHERE id = ${around.id} AND tenant_id = ${tenantId}`
  }
  if (next) await make(count, next)
  if (first && !next) {
    // The period running since the latest full count is now this one: what landed late in it is its.
    await tx`UPDATE stock_usage_late SET period_id = ${first.id} WHERE tenant_id = ${tenantId} AND venue_id = ${count.venue_id} AND period_id IS NULL AND closed_period_id IS NOT NULL`
  }
  return { periods: made, note: null }
}

/** The closed periods' trading days at a venue: [{ id, days_from, days_to }] (usage from sales leaves them alone). */
export async function closedRanges(tx, tenantId, venueId) {
  return tx`
    SELECT id, days_from::text AS days_from, days_to::text AS days_to, to_at FROM stock_periods
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND status = 'closed' AND days_from IS NOT NULL
     ORDER BY days_from`
}

/** Whether a trading day is inside one of these closed ranges (closedRanges()): the cheap check the usage job makes per day. */
export const dayInRanges = (day, ranges) => (ranges || []).some(r => r.days_from && day >= r.days_from && day <= r.days_to)

/**
 * Where a late sale on a closed day lands: the first stored period after the
 * closed one that holds the day that isn't closed (its id), else the period
 * running since the latest full count (null). -> { closed_period_id, period_id }
 */
export async function landingPeriod(tx, tenantId, venueId, day) {
  const [closed] = await tx`
    SELECT id, to_at FROM stock_periods
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND status = 'closed' AND days_from <= ${day}::date AND days_to >= ${day}::date
     ORDER BY to_at DESC LIMIT 1`
  if (!closed) return { closed_period_id: null, period_id: null }
  const [open] = await tx`
    SELECT id FROM stock_periods
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND status = 'open' AND from_at >= ${closed.to_at}
     ORDER BY from_at LIMIT 1`
  return { closed_period_id: closed.id, period_id: open?.id ?? null }
}

/**
 * The trading days a period holds (YYYY-MM-DD): each day whose last sale is
 * inside it (usage from sales places a day's move there, as on hand does),
 * and the days wholly inside it (no sales). -> { from, to } or nulls.
 */
export async function periodDays(tx, tenantId, period) {
  const [v] = await tx`
    SELECT v.timezone, ps.day_starts_at FROM venues v
      LEFT JOIN pos_settings ps ON ps.venue_id = v.id AND ps.tenant_id = v.tenant_id
     WHERE v.id = ${period.venue_id} AND v.tenant_id = ${tenantId}`
  const tz = v?.timezone || 'Europe/London'
  const start = v?.day_starts_at || DAY_STARTS_AT
  const [m] = await tx`
    SELECT min(day)::text AS first, max(day)::text AS last FROM stock_usage_marks
     WHERE tenant_id = ${tenantId} AND venue_id = ${period.venue_id}
       AND last_sale_at > ${period.from_at} AND last_sale_at <= ${period.to_at}`
  const inner = { from: addDays(businessDate(new Date(period.from_at), tz, start), 1), to: addDays(businessDate(new Date(period.to_at), tz, start), -1) }
  const from = [m?.first, inner.from <= inner.to ? inner.from : null].filter(Boolean).sort()[0] || null
  const to = [m?.last, inner.from <= inner.to ? inner.to : null].filter(Boolean).sort().at(-1) || null
  return { from, to }
}

/** Late sales that landed in a period (a stored one's id, or the current one: null), per item and in sales. */
async function landed(tx, tenantId, period) {
  const where = period.id
    ? tx`l.period_id = ${period.id}`
    : tx`l.period_id IS NULL AND l.venue_id = ${period.venue_id} AND l.closed_period_id IS NOT NULL`
  const [items, sales] = await Promise.all([
    tx`SELECT li.item_id, sum(li.qty_base)::float8 AS qty FROM stock_usage_late l
         JOIN stock_usage_late_items li ON li.late_id = l.id AND li.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId} AND ${where} GROUP BY li.item_id`,
    tx`SELECT COALESCE(sum(l.net_food_pence), 0)::float8 AS food, COALESCE(sum(l.net_pence), 0)::float8 AS net, count(*)::int AS batches
         FROM stock_usage_late l WHERE l.tenant_id = ${tenantId} AND ${where}`,
  ])
  return { items: new Map(items.map(r => [r.item_id, r.qty])), food: sales[0]?.food || 0, net: sales[0]?.net || 0, batches: sales[0]?.batches || 0 }
}

/**
 * Net sales of the trading days whose last sale is inside the period (as
 * their usage is placed), food (isFoodSale()) and all, in pence, with late
 * sales that landed in it. -> { net_food_pence, net_pence, late_food_pence }
 */
export async function foodSales(tx, tenantId, period, { now = new Date() } = {}) {
  const to = period.to_at || now
  const rows = await tx`
    SELECT d.item_type, d.left_out, sum(d.net_pence)::float8 AS net
      FROM dish_cost_days d
      JOIN stock_usage_marks m ON m.tenant_id = d.tenant_id AND m.venue_id = d.venue_id AND m.day = d.day
     WHERE d.tenant_id = ${tenantId} AND d.venue_id = ${period.venue_id}
       AND m.last_sale_at > ${period.from_at} AND m.last_sale_at <= ${to}
     GROUP BY d.item_type, d.left_out`
  const late = await landed(tx, tenantId, period)
  const food = rows.filter(isFoodSale).reduce((s, r) => s + r.net, 0)
  const all = rows.reduce((s, r) => s + r.net, 0)
  return { net_food_pence: Math.round(food + late.food), net_pence: Math.round(all + late.net), late_food_pence: Math.round(late.food) }
}

/**
 * One price per item for the period: the average paid at the venue over the
 * 90 days before its end, else the last paid, else the standard price
 * (chooseQuote()'s). -> Map(item_id -> { per_base, how } | null)
 */
async function pricesAt(tx, tenantId, venueId, itemIds, at) {
  const out = new Map()
  if (!itemIds.length) return out
  const paid = await costLookup(tx, tenantId, [venueId], itemIds, at, { how: true })
  const missing = []
  for (const id of itemIds) {
    const p = paid(venueId, id, at)
    if (p) out.set(id, p)
    else missing.push(id)
  }
  if (missing.length) {
    const ctx = await loadCosting(tx, tenantId, venueId, { basis: 'standard', recipes: new Map(), itemIds: missing })
    for (const id of missing) {
      const item = ctx.items.get(id)
      const s = item ? itemCost(item, venueId, ctx, 'standard').per_base : null
      out.set(id, s == null ? null : { per_base: s, how: 'standard' })
    }
  }
  return out
}

/**
 * A period's figures worked out now (a stored period, or the current one to
 * now): every item at the venue with a move in it or stock at either end,
 * by periodVariance() over itemVariance() per item. itemIds narrows the
 * items (one item for By venue); sales: false skips net food sales.
 * -> { period, rows: [{ item_id, name, base_unit, category, how, ...figures }],
 *      totals, food_cost, band, flagged, settings, sales: { net_food_pence, net_pence, late_food_pence }, worked_at }
 */
export async function periodFigures(tx, tenantId, period, { itemIds = null, settings = null, now = new Date(), sales = true } = {}) {
  const to = period.to_at || now
  const [moves, late, set, money] = await Promise.all([
    loadStockMoves(tx, tenantId, { venueIds: [period.venue_id], itemIds, to }),
    landed(tx, tenantId, period),
    settings ? varianceSettings(settings) : loadBand(tx, tenantId),
    sales ? foodSales(tx, tenantId, period, { now }) : null,
  ])
  const byItem = new Map()
  for (const m of moves) {
    if (!byItem.has(m.item_id)) byItem.set(m.item_id, [])
    byItem.get(m.item_id).push(m)
  }
  for (const id of late.items.keys()) if (!byItem.has(id) && (!itemIds || itemIds.includes(id))) byItem.set(id, [])
  const ids = [...byItem.keys()]
  const [items, prices] = await Promise.all([
    ids.length ? tx`
      SELECT i.id, i.name, i.base_unit, i.is_active, c.name AS category FROM inv_items i
        LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = i.tenant_id
       WHERE i.tenant_id = ${tenantId} AND i.id = ANY(${ids}::uuid[])` : [],
    pricesAt(tx, tenantId, period.venue_id, ids, to),
  ])
  const itemOf = new Map(items.map(i => [i.id, i]))
  const rows = ids.filter(id => itemOf.has(id)).map(id => {
    const i = itemOf.get(id)
    const p = prices.get(id)
    const r = itemVariance({ moves: byItem.get(id), from: period.from_at, to: period.to_at || null, price: p?.per_base ?? null, late: late.items.get(id) || 0 })
    return { item_id: id, name: i.name, base_unit: i.base_unit, category: i.category ?? null, active: i.is_active, how: p?.how ?? null, ...r }
  })
  const view = periodVariance({ items: rows, net_food_pence: money ? money.net_food_pence : null, settings: set })
  return { period, ...view, sales: money, worked_at: new Date().toISOString() }
}

/** The group's variance band (stock_settings), defaults where none. */
export async function loadBand(tx, tenantId) {
  const [s] = await tx`SELECT variance_band_pct::float8 AS band_pct, variance_item_pct::float8 AS item_pct, variance_item_pounds::float8 AS item_pounds FROM stock_settings WHERE tenant_id = ${tenantId}`
  return varianceSettings(s || null)
}

const words = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(w => w.replace(/(es|s)$/, ''))
const GENERIC = new Set(['fresh', 'frozen', 'large', 'small', 'whole', 'sliced', 'diced', 'chopped', 'organic', 'free', 'range', 'mixed', 'sauce', 'pack', 'portion', 'boneles'])

/**
 * The facts explainVariance() words for one item in a period: uncosted dishes
 * that may use it (dish_cost_days with what was missing, whose name, recipe or
 * gaps name the item), deliveries of it booked in the period and changed after
 * the closing count, its own units added or changed, deliveries in an old base
 * unit, its waste entries and till voids, transfers sent not received, and
 * remakes of dishes whose recipe uses it.
 */
export async function itemFacts(tx, tenantId, period, item, row, { now = new Date() } = {}) {
  const to = period.to_at || now
  const v = period.venue_id
  const mine = words(item.name).filter(w => !GENERIC.has(w))
  const [dishes, recipes, corrected, units, oldUnits, waste, voids, transit] = await Promise.all([
    tx`SELECT d.dish_id, d.name, d.recipe_name, sum(d.qty)::float8 AS qty, sum(d.uncosted_qty)::float8 AS uncosted,
              (array_agg(d.gaps))[1] AS gaps
         FROM dish_cost_days d
         JOIN stock_usage_marks m ON m.tenant_id = d.tenant_id AND m.venue_id = d.venue_id AND m.day = d.day
        WHERE d.tenant_id = ${tenantId} AND d.venue_id = ${v} AND m.last_sale_at > ${period.from_at} AND m.last_sale_at <= ${to}
          AND (d.uncosted_qty > 0) AND d.left_out IS NULL
        GROUP BY d.dish_id, d.name, d.recipe_name`,
    // Recipes using the item, directly or in a prep recipe inside (two levels are plenty for a name match).
    tx`SELECT DISTINCT r.id, r.name FROM recipes r
         JOIN recipe_lines l ON l.recipe_id = r.id AND l.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${tenantId} AND (l.item_id = ${item.id} OR l.sub_recipe_id IN (
              SELECT l2.recipe_id FROM recipe_lines l2 WHERE l2.tenant_id = ${tenantId} AND l2.item_id = ${item.id}))`,
    tx`SELECT DISTINCT po.id, po.number, s.name AS supplier, po.received_at, po.updated_at
         FROM purchase_order_lines pl
         JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
         LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
        WHERE pl.tenant_id = ${tenantId} AND po.venue_id = ${v} AND pl.item_id = ${item.id} AND po.received_at IS NOT NULL
          AND po.received_at > ${period.from_at} AND po.received_at <= ${to}
          AND po.updated_at > ${period.to_at ? tx`GREATEST(${period.to_at}::timestamptz, po.received_at + interval '10 minutes')` : tx`po.received_at + interval '10 minutes'`}
        ORDER BY po.received_at`,
    tx`SELECT name, GREATEST(created_at, updated_at) AS at FROM inv_item_units
        WHERE tenant_id = ${tenantId} AND item_id = ${item.id} AND GREATEST(created_at, updated_at) > ${period.from_at} AND GREATEST(created_at, updated_at) <= ${to}`,
    tx`SELECT count(DISTINCT po.id)::int AS n
         FROM purchase_order_lines pl
         JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
         JOIN inv_items i ON i.id = pl.item_id AND i.tenant_id = pl.tenant_id
        WHERE pl.tenant_id = ${tenantId} AND po.venue_id = ${v} AND pl.item_id = ${item.id} AND pl.received_qty > 0
          AND po.received_at > ${period.from_at} AND po.received_at <= ${to} AND pl.base_unit IS DISTINCT FROM i.base_unit`,
    tx`SELECT count(DISTINCT w.id)::int AS n FROM stock_waste w
         JOIN stock_waste_items wi ON wi.waste_id = w.id AND wi.tenant_id = w.tenant_id
        WHERE w.tenant_id = ${tenantId} AND w.venue_id = ${v} AND wi.item_id = ${item.id} AND w.undone_at IS NULL
          AND w.wasted_at > ${period.from_at} AND w.wasted_at <= ${to}`,
    tx`SELECT count(*)::int AS n FROM stock_void_waste k
         JOIN stock_void_waste_items ki ON ki.line_id = k.line_id AND ki.tenant_id = k.tenant_id
        WHERE k.tenant_id = ${tenantId} AND k.venue_id = ${v} AND ki.item_id = ${item.id} AND k.at > ${period.from_at} AND k.at <= ${to}`,
    tx`SELECT t.number, t.from_venue_id, t.to_venue_id, fv.name AS from_name, tv.name AS to_name, l.qty_base::float8 AS qty_base
         FROM stock_transfer_lines l
         JOIN stock_transfers t ON t.id = l.transfer_id AND t.tenant_id = l.tenant_id
         JOIN venues fv ON fv.id = t.from_venue_id AND fv.tenant_id = t.tenant_id
         JOIN venues tv ON tv.id = t.to_venue_id AND tv.tenant_id = t.tenant_id
        WHERE l.tenant_id = ${tenantId} AND l.item_id = ${item.id} AND t.status = 'sent'
          AND (t.from_venue_id = ${v} OR t.to_venue_id = ${v}) AND t.sent_at <= ${to}`,
  ])
  const recipeNames = new Set(recipes.map(r => r.name.toLowerCase()))
  const namesIt = d => {
    const text = [d.name, d.recipe_name].filter(Boolean).join(' ')
    const got = new Set(words(text))
    if (mine.some(w => got.has(w))) return true
    if (d.recipe_name && recipeNames.has(d.recipe_name.toLowerCase())) return true
    return (Array.isArray(d.gaps) ? d.gaps : []).some(g => String(g.text || '').toLowerCase().includes(String(item.name).toLowerCase()))
  }
  const uncosted = dishes.filter(namesIt).sort((a, b) => b.uncosted - a.uncosted).map(d => ({
    name: d.name, qty: d.uncosted, why: (Array.isArray(d.gaps) ? d.gaps : [])[0]?.text || null,
  }))
  // Remakes of dishes whose recipe uses the item (the kitchen logs them by dish name).
  const dishNames = recipes.length ? await tx`
    SELECT DISTINCT lower(d.name) AS name FROM dish_cost_days d
     WHERE d.tenant_id = ${tenantId} AND d.venue_id = ${v} AND d.recipe_id = ANY(${recipes.map(r => r.id)}::uuid[])` : []
  const [remakes] = dishNames.length ? await tx`
    SELECT count(*)::int AS n FROM kds_log
     WHERE tenant_id = ${tenantId} AND venue_id = ${v} AND kind = 'remake' AND at > ${period.from_at} AND at <= ${to}
       AND lower(item_name) = ANY(${dishNames.map(d => d.name)}::text[])` : [{ n: 0 }]
  return {
    item: { name: item.name, base_unit: item.base_unit }, row,
    uncosted,
    corrected: corrected.map(c => ({ label: poNumberLabel(c.number) + (c.supplier ? ' from ' + c.supplier : ''), received_at: c.received_at, changed_at: c.updated_at })),
    unit_changes: units.map(u => ({ name: u.name, at: u.at })),
    old_unit_deliveries: oldUnits[0]?.n || 0,
    waste: { entries: waste[0]?.n || 0, voids: voids[0]?.n || 0 },
    in_transit: transit.map(t => ({
      label: 'Transfer ' + t.number + (t.from_venue_id === v ? ' to ' + t.to_name : ' from ' + t.from_name),
      qty_base: t.qty_base, direction: t.from_venue_id === v ? 'out' : 'in',
    })),
    remakes: remakes?.n || 0,
  }
}

/**
 * Key items between their counts: every item counted by an approved key
 * count at the venue from `from` to `to` (moments), with its figures
 * between each pair of its counts (keyIntervals(), full counts included as
 * ends). -> [{ item_id, name, base_unit, intervals: [...] }]
 */
export async function keyFigures(tx, tenantId, venueId, { from, to = new Date() } = {}) {
  const keyed = await tx`
    SELECT DISTINCT l.item_id FROM stock_count_lines l
      JOIN stock_counts c ON c.id = l.count_id AND c.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} AND c.venue_id = ${venueId} AND c.status = 'approved' AND c.kind = 'key'
       AND c.counted_at >= ${from} AND c.counted_at <= ${to}`
  const ids = keyed.map(r => r.item_id)
  if (!ids.length) return []
  const [moves, items, prices] = await Promise.all([
    loadStockMoves(tx, tenantId, { venueIds: [venueId], itemIds: ids, to }),
    tx`SELECT id, name, base_unit FROM inv_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])`,
    pricesAt(tx, tenantId, venueId, ids, to),
  ])
  const byItem = new Map(ids.map(id => [id, []]))
  for (const m of moves) byItem.get(m.item_id)?.push(m)
  return items.map(i => ({
    item_id: i.id, name: i.name, base_unit: i.base_unit,
    intervals: keyIntervals({ moves: byItem.get(i.id), from, to, price: prices.get(i.id)?.per_base ?? null }),
  })).filter(i => i.intervals.length).sort((a, b) => a.name.localeCompare(b.name))
}

/** The reviewed flags of these periods: Map(period_id -> Map(item_id -> { by, at, note })). */
export async function loadReviews(tx, tenantId, periodIds) {
  const out = new Map()
  if (!periodIds.length) return out
  const rows = await tx`
    SELECT period_id, item_id, reviewed_by, reviewed_at, note FROM stock_variance_reviews
     WHERE tenant_id = ${tenantId} AND period_id = ANY(${periodIds}::uuid[])`
  for (const r of rows) {
    if (!out.has(r.period_id)) out.set(r.period_id, new Map())
    out.get(r.period_id).set(r.item_id, { by: r.reviewed_by, at: r.reviewed_at, note: r.note })
  }
  return out
}

/**
 * Closed periods at a venue (closed in the last `days`) with flagged items
 * not reviewed yet (Today's "variance to review").
 * -> [{ id, from_at, to_at, closed_at, flagged, unreviewed }]
 */
export async function toReview(tx, tenantId, venueId, { days = 60 } = {}) {
  const rows = await tx`
    SELECT p.id, p.from_at, p.to_at, p.closed_at,
           ARRAY(SELECT r->>'item_id' FROM jsonb_array_elements(COALESCE(p.figures->'rows', '[]'::jsonb)) r WHERE (r->>'flagged')::boolean) AS flagged
      FROM stock_periods p
     WHERE p.tenant_id = ${tenantId} AND p.venue_id = ${venueId} AND p.status = 'closed'
       AND p.closed_at >= now() - make_interval(days => ${days})
     ORDER BY p.to_at DESC`
  const reviews = await loadReviews(tx, tenantId, rows.map(r => r.id))
  return rows.map(r => {
    const seen = reviews.get(r.id) || new Map()
    const left = (r.flagged || []).filter(id => !seen.has(id))
    return { id: r.id, from_at: r.from_at, to_at: r.to_at, closed_at: r.closed_at, flagged: (r.flagged || []).length, unreviewed: left.length }
  }).filter(r => r.unreviewed > 0)
}

export { round4 }
