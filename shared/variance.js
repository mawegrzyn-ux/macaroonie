// shared/variance.js
//
// Variance: actual usage against theoretical (inventory phase 6a, migration
// 312; docs/INVENTORY.md 8.1, decision D9), plain ESM for the API, the
// admin, reports and Pepper. One rule (CLAUDE.md rule 12): the Stock page's
// Variance tab, the report subjects, Today and Pepper's variance_summary and
// explain_variance all call these functions.
//
// For an item at a venue between two counts (a period runs between two
// approved full counts; a key-item count gives the same figures for its
// items between two counts of them):
//
//   actual       = opening + received + transfers in - transfers out - returns - closing
//   theoretical  = what usage from sales took off in the period (each
//                  trading day's move at its last sale, as on hand places it),
//                  plus late sales of a closed period that landed in this one
//   waste        = logged waste and the till's voids marked wasted
//   variance     = actual - theoretical         (in units and in pounds)
//   explained    = waste - adjusted              (an adjustment carries a reason,
//                  so it explains its part: one that took stock off explains
//                  loss, one that found stock explains a gain)
//   unexplained  = variance - explained
//
// When the closing count finds exactly what the ledger expected, the
// unexplained part is nothing: unexplained is what the counts found against
// what the documents said, summed over the counts in the period. Transfers
// out include what was lost in transit (it left the venue, and the transfer
// says so); returns are 0 until returns to suppliers are built (phase 9).
// Pounds are at one price per item for the period (the average paid at the
// venue over the 90 days before its end, else the last paid, else the
// standard price: the price usage from sales costs at), so variance in
// pounds is variance in units times that price, and the figures add up.
//
//   VARIANCE_DEFAULTS, varianceSettings(row), settingsProblem(body)
//   itemVariance({ moves, from, to, price, late })       one item between two moments
//   keyIntervals({ moves, from, to, price })              an item between each pair of its counts
//   itemFlag(row, settings)                               flagged by the item rule
//   periodVariance({ items, net_food_pence, settings })   every item, the totals, food cost, the band
//   isFoodSale(row)                                       a dish_cost_days row counted in net food sales
//   explainVariance(facts)                                the evidence for an item, each with its fix
//   EVIDENCE_KINDS, PERIOD_STATUSES, periodWords(period)
//
// Quantities are in each item's base unit (g, ml or each); moves are
// loadStockMoves()'s ({ kind, qty_base signed, at, late? }).

import { stockOnHand, runningBalance, MOVE_KINDS } from './stock.js'
import { costShare } from './costing.js'

export const VARIANCE_DEFAULTS = { band_pct: 1, item_pct: 3, item_pounds: 50 }
export const PERIOD_STATUSES = { open: 'Open', closed: 'Closed' }

const num = v => (v == null || v === '' ? 0 : Number(v))
const round4 = n => (n == null ? null : Math.round(Number(n) * 10000) / 10000)
const round2 = n => (n == null ? null : Math.round(Number(n) * 100) / 100)
const time = at => (at == null ? null : new Date(at).getTime())
const priced = (q, price) => (q == null || price == null ? null : round2(Number(q) * Number(price)))

/** The group's band from stock_settings' columns (defaults where none). */
export function varianceSettings(row = null) {
  const pick = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))
  return {
    band_pct: pick(row?.variance_band_pct ?? row?.band_pct, VARIANCE_DEFAULTS.band_pct),
    item_pct: pick(row?.variance_item_pct ?? row?.item_pct, VARIANCE_DEFAULTS.item_pct),
    item_pounds: pick(row?.variance_item_pounds ?? row?.item_pounds, VARIANCE_DEFAULTS.item_pounds),
  }
}

/** Why a band can't be saved, or null: { band_pct 0..100, item_pct 0..1000, item_pounds >= 0 }. */
export function settingsProblem(b) {
  const bad = (v, max) => v == null || !Number.isFinite(Number(v)) || Number(v) < 0 || (max != null && Number(v) > max)
  if (bad(b?.band_pct, 100)) return 'The venue band is points of food sales, from 0 to 100'
  if (bad(b?.item_pct, 1000)) return 'The item rule\'s percentage is from 0 to 1000'
  if (bad(b?.item_pounds, null)) return 'The item rule\'s pounds can\'t be below 0'
  return null
}

/**
 * One item at one venue between two moments (from: the opening count's;
 * to: the closing count's, or now for the period running since the latest
 * full count). moves: every move of the item at the venue up to `to` (the
 * opening figure is on hand at `from` by stockOnHand(), so earlier counts
 * matter). The closing figure is the item's last count after `from` and up
 * to `to`; with none (not counted since) actual, variance and unexplained
 * are null and the other figures run to `to`. Moves at the very moment of a
 * count are inside it (on hand's rule): the window is (from, closing].
 * price: pounds per base unit (null: no pounds). late: late sales of a
 * closed period that landed here (base units), added to theoretical.
 */
export function itemVariance({ moves = [], from, to = null, price = null, late = 0 } = {}) {
  const fromT = time(from)
  const toT = to == null ? Infinity : time(to)
  const list = (moves || []).filter(m => time(m.at) <= toT)
  const before = list.filter(m => time(m.at) <= fromT)
  const open = stockOnHand({ moves: list, at: from })
  // Never in stock before: nothing was there. Moves but no count: not known.
  const opening = open.on_hand != null ? open.on_hand : before.length ? null : 0
  let closingMove = null
  for (const m of list) {
    const t = time(m.at)
    if (MOVE_KINDS[m.kind]?.sets && t > fromT && (!closingMove || t >= time(closingMove.at))) closingMove = m
  }
  const endT = closingMove ? time(closingMove.at) : toT
  const inside = list.filter(m => {
    const t = time(m.at)
    return t > fromT && t <= endT && !MOVE_KINDS[m.kind]?.sets
  })
  const sum = kinds => round4(inside.filter(m => kinds.includes(m.kind) && !m.late).reduce((s, m) => s + num(m.qty_base), 0))
  const received = sum(['delivery'])
  const transfers_in = sum(['transfer_in'])
  const transfers_out = round4(-sum(['transfer_out', 'lost_in_transit']))
  const lost_in_transit = round4(-sum(['lost_in_transit']))
  const waste = round4(-sum(['waste']))
  const adjusted = sum(['adjustment'])
  const lateQty = round4(num(late))
  const theoretical = round4(-sum(['usage']) + lateQty)
  const returns = 0
  const closing = closingMove ? round4(num(closingMove.qty_base)) : null
  const actual = opening == null || closing == null ? null : round4(opening + received + transfers_in - transfers_out - returns - closing)
  const variance = actual == null ? null : round4(actual - theoretical)
  const explained = round4(waste - adjusted)
  const unexplained = variance == null ? null : round4(variance - explained)
  const p = price == null || !Number.isFinite(Number(price)) ? null : Number(price)
  return {
    opening, received, transfers_in, transfers_out, lost_in_transit, returns, closing,
    closing_at: closingMove?.at ?? null, counted: !!closingMove, opening_known: opening != null,
    actual, theoretical, late: lateQty, waste, adjusted, explained, variance, unexplained,
    price: p,
    actual_value: priced(actual, p), theoretical_value: priced(theoretical, p), waste_value: priced(waste, p),
    adjusted_value: priced(adjusted, p), explained_value: priced(explained, p),
    variance_value: priced(variance, p), unexplained_value: priced(unexplained, p),
    // Unexplained as a share of what sales took (null with no sales: any loss is all of it).
    unexplained_pct: unexplained == null || !(theoretical > 0) ? null : round2(unexplained / theoretical * 100),
    // The lowest the ledger went in the window (below zero: a missed delivery or a recipe too light).
    lowest: lowestOf(list, fromT, endT),
  }
}

/** The lowest balance the ledger reached between two moments, and when: { qty, at } or null. */
function lowestOf(moves, fromT, endT) {
  let low = null
  for (const m of runningBalance(moves)) {
    const t = time(m.at)
    if (t <= fromT || t > endT || m.balance == null) continue
    if (!low || m.balance < low.qty) low = { qty: m.balance, at: m.at }
  }
  return low
}

/**
 * An item's figures between each pair of its counts from `from` to `to`
 * (key-item counts, full counts): daily when the item is counted daily.
 * -> [{ from, to, ...itemVariance() }], oldest first. late is left out (it
 * belongs to a period, not to a pair of counts).
 */
export function keyIntervals({ moves = [], from = null, to = null, price = null } = {}) {
  const fromT = from == null ? -Infinity : time(from)
  const toT = to == null ? Infinity : time(to)
  const counts = (moves || []).filter(m => MOVE_KINDS[m.kind]?.sets && time(m.at) >= fromT && time(m.at) <= toT)
    .sort((a, b) => time(a.at) - time(b.at))
  const out = []
  for (let i = 1; i < counts.length; i++) {
    if (time(counts[i].at) <= time(counts[i - 1].at)) continue
    const r = itemVariance({ moves: (moves || []).filter(m => time(m.at) <= time(counts[i].at)), from: counts[i - 1].at, to: counts[i].at, price })
    out.push({ from: counts[i - 1].at, to: counts[i].at, ...r })
  }
  return out
}

/**
 * Whether an item is flagged by the group's item rule: its unexplained loss
 * (or gain) is over item_pounds, and over item_pct of what sales took of it
 * (any amount, when sales took none). No price: not flagged (the rule is in
 * pounds), and said. -> { flagged, why }
 */
export function itemFlag(row, settings = VARIANCE_DEFAULTS) {
  const s = varianceSettings(settings)
  if (!row || row.unexplained == null) return { flagged: false, why: row && !row.counted ? 'not_counted' : null }
  if (row.unexplained_value == null) return { flagged: false, why: 'no_price' }
  const pounds = Math.abs(row.unexplained_value)
  const pct = row.theoretical > 0 ? Math.abs(row.unexplained) / row.theoretical * 100 : Infinity
  return pounds > s.item_pounds && pct > s.item_pct ? { flagged: true, why: row.unexplained > 0 ? 'loss' : 'gain' } : { flagged: false, why: null }
}

/**
 * Every item of a period, the totals, the food cost and the band.
 * items: [{ item_id, name, base_unit, ...itemVariance() }]; net_food_pence:
 * the period's net food sales (pence, VAT out; null when not known or not to
 * be shown); settings: the group's band. Items with nothing in the period
 * (no stock either end, no moves) are left out. Rows are ranked by pounds of
 * unexplained loss (the biggest loss first, gains last), then by quantity.
 * -> { rows: [{ ...row, flagged, flag_why, share_pct }], totals, food_cost, band, flagged }
 */
export function periodVariance({ items = [], net_food_pence = null, settings = VARIANCE_DEFAULTS } = {}) {
  const s = varianceSettings(settings)
  const net = net_food_pence == null ? null : num(net_food_pence)
  const quiet = r => !num(r.opening) && !num(r.closing) && !num(r.received) && !num(r.transfers_in) && !num(r.transfers_out)
    && !num(r.theoretical) && !num(r.waste) && !num(r.adjusted)
  const rows = (items || []).filter(r => !quiet(r)).map(r => {
    const f = itemFlag(r, s)
    return { ...r, flagged: f.flagged, flag_why: f.why, share_pct: net == null ? null : costShare(r.unexplained_value, net) }
  }).sort((a, b) => (num(b.unexplained_value) - num(a.unexplained_value)) || (num(b.unexplained) - num(a.unexplained))
    || String(a.name || '').localeCompare(String(b.name || '')))
  const add = key => round2(rows.reduce((t, r) => t + num(r[key]), 0))
  const valued = rows.filter(r => r.price != null)
  const counted = rows.filter(r => r.actual != null)
  const totals = {
    items: rows.length, counted: counted.length, not_counted: rows.length - counted.length,
    valued: valued.length, unvalued: rows.length - valued.length,
    actual_value: add('actual_value'), theoretical_value: add('theoretical_value'), waste_value: add('waste_value'),
    adjusted_value: add('adjusted_value'), explained_value: add('explained_value'),
    variance_value: add('variance_value'), unexplained_value: add('unexplained_value'),
    // The part of the unexplained figure that was loss (items over), and gain (items under).
    loss_value: round2(rows.reduce((t, r) => t + Math.max(0, num(r.unexplained_value)), 0)),
    gain_value: round2(rows.reduce((t, r) => t + Math.min(0, num(r.unexplained_value)), 0)),
    late_items: rows.filter(r => num(r.late)).length,
  }
  // Food cost: actual over the items counted at both ends; theoretical over every item sales used.
  const actualCost = round2(counted.reduce((t, r) => t + num(r.actual_value), 0))
  const food_cost = {
    net_food_pence: net,
    actual_value: actualCost,
    theoretical_value: totals.theoretical_value,
    actual_pct: net == null ? null : costShare(actualCost, net),
    theoretical_pct: net == null ? null : costShare(totals.theoretical_value, net),
  }
  food_cost.gap_pts = food_cost.actual_pct == null || food_cost.theoretical_pct == null ? null : round2(food_cost.actual_pct - food_cost.theoretical_pct)
  const bandPct = net == null ? null : costShare(totals.unexplained_value, net)
  const band = { band_pct: s.band_pct, unexplained_pct: bandPct, over: bandPct != null && Math.abs(bandPct) > s.band_pct }
  return { rows, totals, food_cost, band, flagged: rows.filter(r => r.flagged).length, settings: s }
}

/**
 * Whether a sold dish's row (dish_cost_days) counts in net food sales: food
 * and drink (itemType() 'food'), and a line with no menu dish (an open item,
 * GloriaFood's by name), never retail goods or a service. The catalogue's
 * type can't tell food from drink, so "food cost" here is food and drink,
 * as the counts and usage cover both.
 */
export function isFoodSale(row) {
  if (!row) return false
  if (row.left_out === 'service') return false
  return row.item_type !== 'goods' && row.item_type !== 'service'
}

// ── Explaining an item's variance ───────────────────────────────────────

/** The kinds of evidence, in the order they are listed, with the words of their fix. */
export const EVIDENCE_KINDS = {
  not_counted: { label: 'Not counted at the end', fix: 'Count it (a key-item count is enough) to see its variance.', page: '/stock?tab=counts' },
  opening_unknown: { label: 'No opening figure', fix: 'It had stock moves before the period but no count: count it so the next period has an opening figure.', page: '/stock?tab=counts' },
  uncosted_dishes: { label: 'Sold without a recipe', fix: 'Link the dishes to their recipes (or fix what their recipe is missing) on the Recipes page, so their sales take it off.', page: '/recipes?tab=dishes' },
  no_price: { label: 'No price', fix: 'Add a supplier price, or book a delivery in, so its variance has pounds.', page: '/inventory' },
  corrected_deliveries: { label: 'Deliveries changed after the count', fix: 'Check each delivery against its invoice and what was on the shelf at the count.', page: '/purchasing' },
  negative: { label: 'On hand went below zero', fix: 'A delivery not booked in, or a recipe taking too much off: look at its history.', page: '/stock' },
  unit_changed: { label: 'A unit changed', fix: 'Check its units and yield on the Inventory page: counts and recipes in the old size read differently.', page: '/inventory' },
  old_unit_deliveries: { label: 'Deliveries in an old unit', fix: 'Deliveries booked in before its base unit changed are left out of stock: put it right with an adjustment.', page: '/stock?tab=adjustments' },
  waste: { label: 'Waste logged', fix: 'Waste is explained loss; see what it was on the Waste tab.', page: '/stock?tab=waste' },
  adjusted: { label: 'Adjustments', fix: 'Adjustments explain their part: check their reasons on the Adjustments tab.', page: '/stock?tab=adjustments' },
  in_transit: { label: 'Transfers not received', fix: 'A transfer sent and not received yet has left the sender: receive it at the other venue.', page: '/stock?tab=transfers' },
  lost_in_transit: { label: 'Lost in transit', fix: 'What didn\'t arrive is on the transfer; it isn\'t in this variance.', page: '/stock?tab=transfers' },
  late_sales: { label: 'Late sales from a closed period', fix: 'Sales that reached a closed period late count here: they make this period look better, the closed one worse.', page: '/stock?tab=usage' },
  remakes: { label: 'Remakes', fix: 'The kitchen logs remakes by dish name, so they aren\'t taken off as usage yet (a known gap): they show as loss.', page: null },
}

const fmt = (n, unit) => {
  const v = round4(n)
  if (v == null) return ''
  const words = { g: 'g', ml: 'ml', each: 'each' }
  if (unit === 'g' && Math.abs(v) >= 1000) return round2(v / 1000) + ' kg'
  if (unit === 'ml' && Math.abs(v) >= 1000) return round2(v / 1000) + ' l'
  return v + ' ' + (words[unit] || unit || '')
}
const money = n => (n == null ? '' : (n < 0 ? '-£' : '£') + Math.abs(Number(n)).toFixed(2))
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const dayText = at => {
  try {
    return new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  } catch {
    return String(at).slice(0, 10)
  }
}

/**
 * The evidence for an item's variance in a period, most telling first, each
 * { kind, label, text, fix, page } (page: where it is put right, no ids:
 * the Stock page adds its own; Pepper gives it as it is). facts (gathered
 * by the API, services/stockVarianceSvc.js):
 *   item { name, base_unit }, row (itemVariance()'s), sees_values,
 *   uncosted [{ name, qty, why }]   dishes sold in the period without a full
 *                                   recipe whose name or recipe names the item
 *   corrected [{ label, received_at, changed_at }]   deliveries of it booked in
 *                                   the period and changed after the closing count
 *   unit_changes [{ name, at }]     its own units added or changed in the period
 *   old_unit_deliveries n           deliveries in an old base unit (left out of stock)
 *   waste { entries, voids }        the waste entries and till voids behind row.waste
 *   in_transit [{ label, qty_base, direction }]   transfers of it sent, not received
 *   remakes n                       remakes of dishes whose recipe uses it
 * A gap that applies to every item (remakes) is listed only when there were
 * some; the rest only when they bear on this item.
 */
export function explainVariance(facts = {}) {
  const { item = {}, row = {}, sees_values: sv = false } = facts
  const unit = item.base_unit
  const out = []
  const add = (kind, text) => {
    const k = EVIDENCE_KINDS[kind]
    out.push({ kind, label: k.label, text, fix: k.fix, page: k.page })
  }
  if (row.counted === false) add('not_counted', (item.name || 'It') + ' hasn\'t been counted since the period began, so its actual usage isn\'t known.')
  if (row.opening_known === false) add('opening_unknown', (item.name || 'It') + ' wasn\'t counted at the opening count, so actual usage starts from nothing known.')
  const unc = facts.uncosted || []
  if (unc.length) {
    const names = unc.slice(0, 5).map(d => d.name + ' (' + Math.round(num(d.qty)) + ' sold' + (d.why ? ': ' + d.why : '') + ')')
    add('uncosted_dishes', plural(unc.length, 'dish', 'dishes') + ' sold in the period without a full recipe may use ' + (item.name || 'it') + ': ' + names.join('; ') + (unc.length > 5 ? '; and ' + (unc.length - 5) + ' more' : '') + '. What they used isn\'t in theoretical usage, so it shows as loss.')
  }
  if (row.price == null && row.unexplained != null) add('no_price', (item.name || 'It') + ' has no price at the venue, so its variance has no pounds and it can\'t be flagged.')
  const cor = facts.corrected || []
  if (cor.length) add('corrected_deliveries', plural(cor.length, 'delivery', 'deliveries') + ' of ' + (item.name || 'it') + ' booked in the period changed after the count: ' + cor.slice(0, 4).map(c => c.label + ' (booked in ' + dayText(c.received_at) + ', changed ' + dayText(c.changed_at) + ')').join('; ') + '.')
  if (row.lowest && row.lowest.qty < 0) add('negative', 'On hand went down to ' + fmt(row.lowest.qty, unit) + ' on ' + dayText(row.lowest.at) + ': more was taken off than the documents say was there.')
  const units = facts.unit_changes || []
  if (units.length) add('unit_changed', 'Its units changed in the period: ' + units.slice(0, 4).map(u => u.name + ' on ' + dayText(u.at)).join('; ') + '.')
  if (num(facts.old_unit_deliveries) > 0) add('old_unit_deliveries', plural(num(facts.old_unit_deliveries), 'delivery', 'deliveries') + ' booked in under its old base unit ' + (num(facts.old_unit_deliveries) === 1 ? 'is' : 'are') + ' left out of stock, so what arrived then is missing from received.')
  if (num(row.waste) !== 0) {
    const w = facts.waste || {}
    const parts = [num(w.entries) ? plural(num(w.entries), 'entry', 'entries') : null, num(w.voids) ? plural(num(w.voids), 'till void') + ' marked wasted' : null].filter(Boolean)
    add('waste', fmt(row.waste, unit) + (sv && row.waste_value != null ? ' (' + money(row.waste_value) + ')' : '') + ' was logged as waste' + (parts.length ? ' (' + parts.join(', ') + ')' : '') + ': explained, so it is taken out of the unexplained figure.')
  }
  if (num(row.adjusted) !== 0) add('adjusted', 'Adjustments ' + (row.adjusted > 0 ? 'added ' : 'took off ') + fmt(Math.abs(row.adjusted), unit) + ': explained by their reasons.')
  const transit = facts.in_transit || []
  if (transit.length) add('in_transit', transit.slice(0, 4).map(t => t.label + ' (' + fmt(t.qty_base, unit) + (t.direction === 'in' ? ', on its way here' : ', sent from here') + ')').join('; ') + ' not received yet.')
  if (num(row.lost_in_transit) > 0) add('lost_in_transit', fmt(row.lost_in_transit, unit) + ' sent from here didn\'t arrive at the other venue.')
  if (num(row.late) !== 0) add('late_sales', fmt(row.late, unit) + ' of theoretical usage came from sales that reached a closed period late.')
  if (num(facts.remakes) > 0) add('remakes', plural(num(facts.remakes), 'remake') + ' of dishes that use ' + (item.name || 'it') + ' were logged in the period, and remakes aren\'t usage yet.')
  return out
}

/** "1 Nov to 8 Nov" (and "open", "closed") for a period's moments. */
export function periodWords(p) {
  if (!p) return ''
  const d = at => (at ? dayText(at) : 'now')
  return d(p.from_at) + ' to ' + d(p.to_at)
}
