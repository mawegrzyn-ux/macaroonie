// shared/priceCreep.js
//
// Price creep (inventory phase 7b; docs/INVENTORY.md 8.2, 10.4), plain ESM
// for the API, the admin and the tests. One rule (CLAUDE.md rule 12): the
// price change hook (api/src/services/priceCreepSvc.js), the Menu margins
// page's banner, Today, the report subject Cost alerts and Pepper's
// why_cost_changed all call these functions, on top of the cost engine
// (shared/costing.js: itemCost(), usageOf(), menuMargins()) and the crossing
// rule the hourly cost targets sweep keeps (shared/foodCost.js: overTarget(),
// targetCrossings()), so a dish crosses by one rule whichever notices it.
//
//   pricesAt(quotes, history, at, { strict })   the supplier prices as they were at a moment, from
//                                               the price history (inv_price_history): each price
//                                               and pack, each venue's own price, the prices that
//                                               didn't exist yet left out
//   dishesUsing(itemIds, recipes, links)        the index from items to recipes (up through the prep
//                                               recipes they sit in) to the dishes linked to them
//   dealsHolding(menus, dishIds)                the meal deals whose steps can hold one of those dishes
//   itemMoves(items, before, after, venueId)    which items' cost per base unit moved, and by how much
//   dishMoves(dishId, scope, before, after, { picksBefore, picksAfter })
//                                               a dish's cost then and now, with each item it uses that
//                                               moved and what that did to one serving (pounds); a meal
//                                               deal at the picks it is judged at (bandedPicks())
//   priceCrossings(beforeRows, afterRows)       the dishes a price change took over their cost target
//                                               or limit (dishMargin() rows before and after), with
//                                               their cost % before and after, and a deal's picks then
//   crossingMoves(moves)                        the moves behind a crossing: the rises first
//   causeWords(moves)                           "Chicken thighs up 12%, Butter up 5%" (no money)
//   alertSummary(alerts)                        the banner's and Today's words: "4 dishes crossed 35%
//                                               since 1 Dec: Chicken thighs up 12%"
//
// Money: costs in pounds (as purchasing keeps them); a cost % is
// dishMargin()'s (costShare() is where pounds meet pence).

import { itemCost, usageOf, bandedPct, bandedPicks } from './costing.js'
import { overTarget, targetCrossings } from './foodCost.js'
import { comboItemIds, menuCtx, isCombo } from './combos.js'

const num = v => (v == null || v === '' ? 0 : Number(v))
const round1 = n => Math.round(Number(n) * 10) / 10
const round2 = n => (n == null ? null : Math.round(Number(n) * 100) / 100)
const round6 = n => (n == null ? null : Math.round(Number(n) * 1e6) / 1e6)
const get = (coll, id) => (coll == null || id == null ? undefined : coll instanceof Map ? coll.get(id) : coll[id])
const entries = coll => (coll == null ? [] : coll instanceof Map ? [...coll.entries()] : Object.entries(coll))
const time = t => (t instanceof Date ? t.getTime() : new Date(t).getTime())
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)

/** Where a price change came from, in words. */
export const CREEP_SOURCES = {
  manual: 'A supplier price typed in or edited',
  import: 'An inventory import',
  price_update: 'A supplier price list',
  invoice: 'An invoice\'s prices applied',
}
export const CREEP_SOURCE_KEYS = Object.keys(CREEP_SOURCES)
/** The threshold a band is over. */
export const CROSSED = { watch: 'its cost target', over: 'its cost limit' }
// How many items a cause names before "and N more".
export const CAUSE_ITEMS = 2

/**
 * The supplier prices as they were at a moment, from the price history
 * (inv_price_history rows: { quote_id, venue_id, price, pack_base_qty,
 * changed_at }). quotes: Map (or object) item_id -> the item's quotes as
 * loadItemQuotes() reads them (price, pack_base_qty, venue_prices, created_at).
 * strict: before the moment only (the hook: "before this change", whose rows
 * carry the change's own moment); else at or before it.
 *   - a quote made after the moment didn't exist: left out;
 *   - its price is the latest company row then; with none then but some since,
 *     it isn't known (kept as it is now, and named in `unknown`);
 *   - its pack is that row's pack when the row has one (kept from migration 315
 *     on), else the pack it has now;
 *   - each venue's own price is the latest row for that venue then (a row with
 *     no price removed it); none then but one since: there was none.
 * -> { quotes: Map item_id -> quotes (copies), unknown: [quote ids] }
 */
export function pricesAt(quotes, history = [], at, { strict = false } = {}) {
  const T = time(at)
  const then = t => (strict ? time(t) < T : time(t) <= T)
  const byQuote = new Map()
  for (const h of history || []) {
    if (!byQuote.has(h.quote_id)) byQuote.set(h.quote_id, [])
    byQuote.get(h.quote_id).push(h)
  }
  for (const rows of byQuote.values()) rows.sort((a, b) => time(a.changed_at) - time(b.changed_at))
  const out = new Map()
  const unknown = []
  for (const [itemId, list] of entries(quotes)) {
    const kept = []
    for (const q of list || []) {
      if (q.created_at != null && !then(q.created_at)) continue
      const rows = byQuote.get(q.id) || []
      const company = rows.filter(r => r.venue_id == null)
      const last = company.filter(r => then(r.changed_at)).at(-1)
      const copy = { ...q, venue_prices: { ...(q.venue_prices || {}) } }
      if (last) {
        if (last.price != null) copy.price = num(last.price)
        if (last.pack_base_qty != null && num(last.pack_base_qty) > 0) copy.pack_base_qty = num(last.pack_base_qty)
      } else if (company.length) {
        unknown.push(q.id)
      }
      const venues = new Set([...Object.keys(copy.venue_prices), ...rows.filter(r => r.venue_id != null).map(r => r.venue_id)])
      for (const v of venues) {
        const vr = rows.filter(r => r.venue_id === v)
        if (!vr.length) continue
        const vl = vr.filter(r => then(r.changed_at)).at(-1)
        if (vl && vl.price != null) copy.venue_prices[v] = num(vl.price)
        else delete copy.venue_prices[v]
      }
      kept.push(copy)
    }
    out.set(itemId, kept)
  }
  return { quotes: out, unknown }
}

/**
 * The index from items to dishes: the recipes whose lines use any of the
 * items, the recipes those sit in as prep recipes (and up, to any depth; a
 * loop is walked once), and the dishes linked to any of them (recipe_links,
 * at any venue, stream or order type). recipes: Map id -> recipe with lines;
 * links: recipe_links rows. -> { recipeIds: Set, dishIds: Set }
 */
export function dishesUsing(itemIds = [], recipes = new Map(), links = []) {
  const items = new Set((itemIds || []).filter(Boolean))
  const usedIn = new Map()   // sub recipe id -> recipes holding it
  const reached = new Set()
  for (const [, r] of entries(recipes)) {
    for (const l of r.lines || []) {
      if (l.item_id && items.has(l.item_id)) reached.add(r.id)
      if (l.sub_recipe_id) {
        if (!usedIn.has(l.sub_recipe_id)) usedIn.set(l.sub_recipe_id, new Set())
        usedIn.get(l.sub_recipe_id).add(r.id)
      }
    }
  }
  const todo = [...reached]
  while (todo.length) {
    const id = todo.pop()
    for (const up of usedIn.get(id) || []) {
      if (reached.has(up)) continue
      reached.add(up)
      todo.push(up)
    }
  }
  const dishIds = new Set((links || []).filter(l => reached.has(l.recipe_id)).map(l => l.dish_id))
  return { recipeIds: reached, dishIds }
}

/** The meal deals on these menus whose steps can hold one of the dishes (comboItemIds()). -> Set of deal ids */
export function dealsHolding(menus = [], dishIds = new Set()) {
  const out = new Set()
  if (!dishIds.size) return out
  for (const m of menus || []) {
    const mctx = menuCtx(m)
    for (const s of m.sections || []) {
      for (const i of s.items || []) {
        if (isCombo(i) && comboItemIds(i, mctx).some(id => dishIds.has(id))) out.add(i.id)
      }
    }
  }
  return out
}

/**
 * Which of these items' cost per base unit (standard: the price chooseQuote()
 * picks at the venue) differs between two costing ctxs. items: [{ item_id,
 * qty_base? }] (qty_base: what one serving takes, as bought). -> [{ item_id,
 * name, base_unit, qty_base, before, after, pct, effect, quote_before,
 * quote_after }] (before / after per base unit, pounds; pct the change in %,
 * null from or to no price; effect what it does to one serving), biggest
 * effect first.
 */
export function itemMoves(items = [], before = {}, after = {}, venueId = null) {
  const out = []
  for (const it of items || []) {
    const item = get(after.items, it.item_id) || get(before.items, it.item_id)
    if (!item) continue
    const b = itemCost(item, venueId, before, 'standard')
    const a = itemCost(item, venueId, after, 'standard')
    if (b.per_base == null && a.per_base == null) continue
    if (b.per_base != null && a.per_base != null && Math.abs(a.per_base - b.per_base) < 1e-9) continue
    const qty = it.qty_base == null ? null : num(it.qty_base)
    out.push({
      item_id: item.id, name: item.name, base_unit: item.base_unit, qty_base: qty,
      before: b.per_base, after: a.per_base,
      pct: b.per_base > 0 && a.per_base != null ? round1((a.per_base - b.per_base) / b.per_base * 100) : null,
      effect: qty != null && a.per_base != null && b.per_base != null ? round6(qty * (a.per_base - b.per_base)) : null,
      quote_before: b.quote_id ? { supplier: b.supplier_name, pack: b.pack_label, price: b.pack_price } : null,
      quote_after: a.quote_id ? { supplier: a.supplier_name, pack: a.pack_label, price: a.pack_price } : null,
    })
  }
  return out.sort((x, y) => Math.abs(y.effect ?? 0) - Math.abs(x.effect ?? 0) || Math.abs(y.pct ?? 0) - Math.abs(x.pct ?? 0)
    || String(x.name).localeCompare(String(y.name)))
}

/**
 * A dish's cost under two sets of prices (a ctx at a date, and now), on the
 * same recipe (recipes keep no history): usageOf() gives what one serving
 * takes of each item, and itemMoves() what moved. A meal deal is taken at the
 * picks given for each side, the ones its cost % is judged at then and now
 * (bandedPicks() of its dishMargin() rows: its highest cost %), so its cost
 * and what moved match the cost % that crossed; with none given (or none
 * costed), at its typical picks. When the picks differ between the sides, the
 * change is the cost of the picks now less that of the picks then, and an
 * item either side uses is compared.
 * -> { cost_before, cost_after, change, items: itemMoves(), uncosted, picks_before, picks_after }
 */
export function dishMoves(dishId, scope = {}, before = {}, after = {}, { picksBefore = null, picksAfter = null } = {}) {
  const ub = usageOf({ dish_id: dishId, qty: 1, picks: picksBefore ?? null }, scope, before)
  const ua = usageOf({ dish_id: dishId, qty: 1, picks: picksAfter ?? null }, scope, after)
  const qty = new Map(ua.items.map(i => [i.item_id, i.qty_base]))
  for (const i of ub.items) if (!qty.has(i.item_id)) qty.set(i.item_id, i.qty_base)
  const items = itemMoves([...qty].map(([item_id, qty_base]) => ({ item_id, qty_base })), before, after, scope.venue_id ?? after.venueId ?? null)
  return {
    cost_before: ub.cost, cost_after: ua.cost,
    change: ub.cost != null && ua.cost != null ? round6(ua.cost - ub.cost) : null,
    items, uncosted: ua.uncosted, picks_before: ub.picks, picks_after: ua.picks,
  }
}

/**
 * The dishes a price change took over their cost target or limit, from
 * dishMargin() rows before and after (each with menu_id, menu, order_type_id,
 * order_type): overTarget() of each side (a dish at its worst order type, a
 * meal deal at its highest cost %), then targetCrossings() with the before
 * side as what was kept, the rule the hourly sweep fires by: newly over the
 * target, or from over the target to over the limit. The cost % before is the
 * same dish's at the same menu and order type (null when it had none). A meal
 * deal is judged at its highest cost % (bandedPct()), so it carries the picks
 * that give it on each side (bandedPicks(): picks_before, picks_after; null
 * for a dish), for dishMoves() to name what moved in them.
 * -> [{ dish_id, name, menu_id, menu, section, order_type_id, order_type,
 *       old_cost_pct, old_band, new_cost_pct, new_band, threshold_pct, target_pct, limit_pct,
 *       picks_before, picks_after }]
 */
export function priceCrossings(beforeRows = [], afterRows = []) {
  const was = overTarget(beforeRows)
  const now = overTarget(afterRows)
  const { crossed } = targetCrossings(was.map(d => ({ dish_id: d.dish_id, band: d.band, cost_pct: d.cost_pct })), now)
  const same = d => r => r.dish_id === d.dish_id && (r.menu_id ?? null) === (d.menu_id ?? null) && (r.order_type_id ?? null) === (d.order_type_id ?? null)
  return crossed.map(d => {
    const b = (beforeRows || []).find(same(d))
    const a = (afterRows || []).find(same(d))
    const old = bandedPct(b)
    return {
      dish_id: d.dish_id, name: d.name, menu_id: d.menu_id, menu: d.menu, section: d.section,
      order_type_id: d.order_type_id, order_type: d.order_type,
      old_cost_pct: old == null ? null : round2(old), old_band: old == null ? null : (b.band || 'good'),
      new_cost_pct: d.cost_pct, new_band: d.band,
      threshold_pct: d.band === 'over' ? d.limit_pct : d.target_pct, target_pct: d.target_pct, limit_pct: d.limit_pct,
      picks_before: bandedPicks(b), picks_after: bandedPicks(a),
    }
  })
}

// A move that adds to a serving's cost: dearer, or priced where it had no price (its quantity unknown: by its %).
const rises = m => (m.effect != null ? m.effect > 0 : m.before == null ? m.after != null : m.pct != null && m.pct > 0)

/**
 * The moves behind a crossing (a cost % that went up), as a cost alert names
 * them: the ones that added to a serving first, each group as itemMoves()
 * sorts it (the biggest effect first), so a price that fell in the same price
 * list is never named as the cause of a rise.
 */
export function crossingMoves(moves = []) {
  return [...(moves || []).filter(Boolean)].sort((a, b) => Number(rises(b)) - Number(rises(a)))
}

/** One item's move in words, no money: "Chicken thighs up 12%", "Butter down 3%", "Saffron now priced". */
export function moveWords(m) {
  if (m.before == null) return m.name + ' now priced'
  if (m.after == null) return m.name + ' has no price now'
  if (m.pct == null) return m.name + ' changed'
  return m.name + (m.pct >= 0 ? ' up ' : ' down ') + String(Math.abs(m.pct)) + '%'
}

/** What moved, in words with no money: the biggest CAUSE_ITEMS moves, then "and N more". */
export function causeWords(moves = [], { max = CAUSE_ITEMS } = {}) {
  const list = (moves || []).filter(Boolean)
  if (!list.length) return 'A supplier price changed'
  const shown = list.slice(0, max).map(moveWords)
  return shown.join(', ') + (list.length > max ? ' and ' + plural(list.length - max, 'more item') : '')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A day (YYYY-MM-DD) as "1 Dec". */
export function dayWords(day) {
  const d = String(day || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  return Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1]
}

/**
 * The words over some cost alerts (the Menu margins banner, Today): how many
 * dishes crossed what since when, and the move behind most of them.
 * alerts: cost_alerts rows ({ dish_id, venue_id, threshold_pct, new_band,
 * day, at, causes }). -> { count, dishes, venues, threshold_pct (when every
 * alert crossed the same %, else null), since (the first day), top (the item
 * most alerts name first: { item_id, name, base_unit, venue_id, before,
 * after, pct }, its move at the venue of the last of them, from before the
 * first there to after the last; never a supplier's name, pack or price),
 * words }
 */
export function alertSummary(alerts = []) {
  const list = (alerts || []).filter(Boolean)
  if (!list.length) return { count: 0, dishes: 0, venues: 0, threshold_pct: null, since: null, top: null, words: '' }
  const dishes = new Set(list.map(a => a.dish_id)).size
  const venues = new Set(list.map(a => a.venue_id)).size
  const pcts = new Set(list.map(a => (a.threshold_pct == null ? null : Number(a.threshold_pct))))
  const threshold = pcts.size === 1 ? [...pcts][0] : null
  const since = list.map(a => String(a.day).slice(0, 10)).sort()[0]
  // The item behind most alerts (each alert's biggest move), and how far it moved over them: from its cost
  // before the first of them to its cost after the last, so "since 1 Dec" reads as the whole rise since then.
  // Both ends at one venue (the last alert's): a venue can have prices of its own.
  const when = a => (a.at ? time(a.at) : time(String(a.day).slice(0, 10) + 'T12:00:00Z'))
  const tally = new Map()
  for (const a of [...list].sort((x, y) => when(x) - when(y))) {
    for (const m of (Array.isArray(a.causes) ? a.causes : []).slice(0, 1)) {
      const k = m.item_id || m.name
      const t = tally.get(k) || { n: 0, first: new Map(), last: m, venue: null }
      t.n++
      if (!t.first.has(a.venue_id ?? null)) t.first.set(a.venue_id ?? null, m)
      t.last = m
      t.venue = a.venue_id ?? null
      tally.set(k, t)
    }
  }
  const best = [...tally.values()].sort((a, b) => b.n - a.n || Math.abs(b.last.pct ?? 0) - Math.abs(a.last.pct ?? 0))[0] ?? null
  const first = best ? best.first.get(best.venue) || best.last : null
  const top = best ? {
    item_id: best.last.item_id ?? null, name: best.last.name, base_unit: best.last.base_unit ?? null, venue_id: best.venue,
    before: first.before ?? null, after: best.last.after ?? null,
    pct: first.before > 0 && best.last.after != null ? round1((best.last.after - first.before) / first.before * 100) : best.last.pct ?? null,
  } : null
  const crossed = threshold != null ? 'crossed ' + String(round2(threshold)) + '%'
    : list.every(a => a.new_band === 'over') ? 'crossed their cost limit' : list.every(a => a.new_band === 'watch') ? 'crossed their cost target' : 'crossed their cost target or limit'
  const words = plural(dishes, 'dish', 'dishes') + ' ' + crossed + (venues > 1 ? ' at ' + venues + ' venues' : '') +
    ' since ' + dayWords(since) + (top ? ': ' + moveWords(top) : '')
  return { count: list.length, dishes, venues, threshold_pct: threshold, since, top, words }
}
