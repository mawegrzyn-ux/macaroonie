// shared/scenarios.js
//
// Cost scenarios (inventory phase 7a, docs/INVENTORY.md 8.2; 27 Nov 2026,
// migration 314): what if prices or costs changed? A scenario is a menu at a
// venue (and revenue stream) and order type, with changes in order: a price
// or a cost changed by a figure or a percentage, or set, for one dish, a
// section or every dish. Plain ESM, no database: the Menu margins page's
// Scenarios tab (through /api/cost-scenarios), Pepper's save_scenario and
// Push prices all call these functions (rule 12).
//
//   changedPrice(pence, change)    a price after one change, rounded to the
//                                  change's round_to pence (up, nearest or
//                                  down); never below nothing. The one rule
//                                  for changing a menu price by a figure or a
//                                  percentage (Pepper's change_prices too)
//   changedCost(pounds, change)    a cost after one change, to 6 places
//   changeProblem(change)          why a change can't be kept, or null
//   applyPrices(item, sectionId, changes)
//                                  a menu dish with its new prices: where each
//                                  price lives on it (the dish's own price,
//                                  the prices of its options that set the
//                                  dish's price, as this dish's own; extras
//                                  keep theirs), the list of what changed and
//                                  what couldn't be
//   scenarioFigures(menu, scope, ctx, { rates, settings, changes, units })
//                                  every dish before and after (price, net of
//                                  VAT, cost, GP, cost %), and the weighted
//                                  figures at the real mix (units sold) per
//                                  section and in all
//   pushPrices(full, changes)      a loaded menu (loadMenuFull()) with the new
//                                  prices, and every price that changes: the
//                                  caller saves it whole through
//                                  menuSaveBody() (shared/menuSave.js)
//
// Where a price lives: a dish has one price on a menu, at every venue,
// revenue stream and order type (only its VAT changes with them, taxFor());
// a menu is a venue's or the group's, and a revenue stream sells some menus.
// So a new price is the dish's on that menu, wherever the menu is sold. A
// dish whose price comes from its options (Small £5, Large £7) has those
// options' prices changed as its own (menu_item_variant_prices), never the
// option group's. A meal deal's own price changes; what its picks add stays.
//
// The weighted figures compare the same dishes on both sides: a dish with no
// cost before or after is left out of both, with its units, never counted at
// nothing. A meal deal is costed at its typical picks (dealTypical() in
// shared/costing.js) and priced at what those picks sell for. Pence meet
// pounds only in margin() (shared/costing.js).

import { margin, dishMargin, dealTypical, typicalPicks, costBand, thresholdsFor, dishMap, pounds } from './costing.js'
import { itemChoices, variantRules, fromPrice, basePrice } from './orderPricing.js'
import { menuCtx, comboFromPrice, isCombo } from './combos.js'

export const CHANGE_WHAT = { price: 'Price', cost: 'Cost' }
export const CHANGE_APPLIES = { all: 'Every dish', section: 'A section', dish: 'A dish' }
export const CHANGE_HOW = { percent: 'By a percentage', amount: 'By a figure', set: 'Set to' }
export const ROUND_TO = [1, 5, 10, 50, 100]
export const ROUND_MODES = ['up', 'nearest', 'down']
export const MAX_CHANGES = 50
export const MIX_DAYS = 28
export const MIX_DAY_CHOICES = [7, 14, 28, 56, 91]
// The bounds a change's value keeps to (a percentage; a figure in pounds; a price or cost set, in pounds).
export const LIMITS = { percent: [-90, 500], amount: [-1000, 1000], set: [0, 10000] }

const num = v => (v == null || v === '' ? 0 : Number(v))
const round6 = n => Math.round(Number(n) * 1e6) / 1e6
const clone = o => JSON.parse(JSON.stringify(o))

/** A price in pence after one change (see the top). Null stays null. */
export function changedPrice(pence, { how, value, round_to = 1, round = 'nearest' } = {}) {
  if (pence == null) return null
  const v = num(value)
  let raw
  if (how === 'percent') raw = Number(pence) * (1 + v / 100)
  else if (how === 'amount') raw = Number(pence) + v * 100
  else if (how === 'set') raw = v * 100
  else return Number(pence)
  raw = Math.round(raw * 10000) / 10000
  const step = ROUND_TO.includes(Number(round_to)) ? Number(round_to) : 1
  const f = round === 'up' ? Math.ceil : round === 'down' ? Math.floor : Math.round
  return Math.max(0, f(raw / step) * step)
}

/** A cost in pounds after one change; null stays null unless the change sets it. */
export function changedCost(cost, { how, value } = {}) {
  const v = num(value)
  if (how === 'set') return round6(Math.max(0, v))
  if (cost == null) return null
  if (how === 'percent') return round6(Math.max(0, Number(cost) * (1 + v / 100)))
  if (how === 'amount') return round6(Math.max(0, Number(cost) + v))
  return Number(cost)
}

/** Why a change can't be kept, or null. */
export function changeProblem(c) {
  if (!c || typeof c !== 'object') return 'A change is missing'
  if (!CHANGE_WHAT[c.what]) return 'Say whether a change is to prices or costs'
  if (!CHANGE_APPLIES[c.applies]) return 'Say what a change is for: every dish, a section or a dish'
  if (c.applies === 'section' && !c.section_id) return 'Pick the section a change is for'
  if (c.applies === 'dish' && !c.dish_id) return 'Pick the dish a change is for'
  if (!CHANGE_HOW[c.how]) return 'Say how a change works: by a percentage, by a figure or set'
  const v = Number(c.value)
  if (c.value == null || c.value === '' || !Number.isFinite(v)) return 'A change needs a figure'
  const [lo, hi] = LIMITS[c.how]
  if (v < lo || v > hi) {
    return c.how === 'percent' ? 'A percentage is from ' + lo + '% to ' + hi + '%'
      : c.how === 'amount' ? 'A figure is from -£' + -lo + ' to £' + hi : 'A price or cost is set from £0 to £' + hi
  }
  if (c.round_to != null && !ROUND_TO.includes(Number(c.round_to))) return 'Round to 1p, 5p, 10p, 50p or £1'
  if (c.round != null && !ROUND_MODES.includes(c.round)) return 'Round up, to the nearest or down'
  return null
}

/** Does a change apply to this dish (its id and its section's)? */
export function changeApplies(c, { dish_id, section_id } = {}) {
  if (c.applies === 'all') return true
  if (c.applies === 'section') return !!section_id && c.section_id === section_id
  if (c.applies === 'dish') return !!dish_id && c.dish_id === dish_id
  return false
}

const penceWords = p => (p == null ? '' : (p < 0 ? '-£' : '£') + (Math.abs(p) / 100).toFixed(2))

/** A change in words: "Prices up 5% (rounded up to 10p): Mains". names: { sections: { id: title }, dishes: { id: name } }. */
export function changeWords(c, names = {}) {
  const what = c.what === 'price' ? 'Price' : 'Cost'
  const of = c.applies === 'all' ? 'every dish'
    : c.applies === 'section' ? (names.sections?.[c.section_id] || 'a section no longer on the menu')
      : (names.dishes?.[c.dish_id] || 'a dish no longer on the menu')
  const v = Number(c.value)
  const how = c.how === 'percent' ? (v >= 0 ? 'up ' : 'down ') + Math.abs(v) + '%'
    : c.how === 'amount' ? (v >= 0 ? 'up ' : 'down ') + penceWords(Math.round(Math.abs(v) * 100))
      : 'set to ' + (c.what === 'cost' ? pounds(v) : penceWords(Math.round(v * 100)))
  const step = Number(c.round_to || 1)
  const rounded = c.what === 'price' && c.how !== 'set' && step > 1
    ? ' (rounded ' + (c.round === 'up' ? 'up ' : c.round === 'down' ? 'down ' : '') + 'to ' + (step >= 100 ? '£' + step / 100 : step + 'p') + ')' : ''
  return what + 's of ' + of + ' ' + how + rounded
}

// A dish's options that set its price (base, with a price of their own): the till charges the option's price.
function baseOptions(item) {
  const out = []
  for (const g of item.variant_groups || []) {
    if (g.price_mode === 'extra') continue
    for (const o of g.options || []) if (basePrice(o) != null) out.push({ g, o })
  }
  return out
}
const pricedVariants = item => (item.variants || []).filter(v => num(v.price_pence) > 0)

/**
 * A menu dish (or meal deal) with its new prices (see the top). item: as
 * loadMenuFull() or a draft version gives it. { item (a copy), prices:
 * [{ kind: 'dish' | 'option' | 'variant', option_id, group, label,
 * from_pence, to_pence }], skipped: [words] }. Only the price changes that
 * apply to it count; each applies on the prices the one before left.
 */
export function applyPrices(item, sectionId, changes = []) {
  const mine = (changes || []).filter(c => c.what === 'price' && changeApplies(c, { dish_id: item.id, section_id: sectionId }))
  if (!mine.length) return { item, prices: [], skipped: [] }
  const out = clone(item)
  const skipped = []
  const byOptions = baseOptions(out).length > 0 || pricedVariants(out).length > 0
  for (const c of mine) {
    if (c.how === 'set' && byOptions) {
      // One figure can't be every option's price: Small and Large set to £6 would both be £6.
      skipped.push(item.name + ' is priced by its options, so it can\'t be set to one price: change it by a figure or a percentage')
      continue
    }
    if (out.price_pence == null && !byOptions) {
      skipped.push(item.name + ' has no price of its own to change')
      continue
    }
    if (out.price_pence != null) out.price_pence = changedPrice(out.price_pence, c)
    if (c.how === 'set') continue
    for (const { o } of baseOptions(out)) {
      o.price_pence = changedPrice(o.price_pence, c)
      // The dish's own price for the option; none when it is the group's price again.
      o.overridden = o.default_pence === undefined || o.price_pence !== o.default_pence
    }
    for (const v of pricedVariants(out)) v.price_pence = changedPrice(v.price_pence, c)
  }
  const prices = []
  if (item.price_pence !== out.price_pence) prices.push({ kind: 'dish', option_id: null, group: null, label: null, from_pence: item.price_pence ?? null, to_pence: out.price_pence ?? null })
  ;(item.variant_groups || []).forEach((g, gi) => (g.options || []).forEach((o, oi) => {
    const to = out.variant_groups[gi].options[oi].price_pence
    if (to !== o.price_pence) prices.push({ kind: 'option', option_id: o.option_id ?? o.id, group: g.display_name || g.name || null, label: o.label, from_pence: o.price_pence, to_pence: to })
  }))
  ;(item.variants || []).forEach((v, vi) => {
    const to = out.variants[vi].price_pence
    if (to !== v.price_pence) prices.push({ kind: 'variant', option_id: null, group: null, label: v.label, from_pence: v.price_pence, to_pence: to })
  })
  return { item: out, prices, skipped: [...new Set(skipped)] }
}

// The price a dish's margin uses: the menu's from price; for a meal deal, its own price (before picks' charges) plus its typical picks' charges.
function priceOf(item, rules, mctx, charge) {
  const choices = itemChoices(item, rules)
  const from = fromPrice(item, choices, mctx)
  if (from == null) return null
  if (!isCombo(item)) return from
  return Math.max(0, from - comboFromPrice(item, 0, mctx).pence) + charge
}

const sideSums = () => ({ net: 0, cost: 0, units: 0 })
const sideOut = s => {
  if (!(s.units > 0)) return { units: 0, net_pence: null, cost_pence: null, gp_pence: null, cost_pct: null, gp_pct: null }
  const m = margin({ gross_pence: Math.round(s.net), vat_rate: 0, cost: round6(s.cost) })
  return { units: round6(s.units), net_pence: m.net_pence, cost_pence: m.cost_pence, gp_pence: m.gp_pence, cost_pct: m.cost_pct, gp_pct: m.gp_pct }
}
const delta = (b, a) => ({
  gp_pence: a.gp_pence != null && b.gp_pence != null ? a.gp_pence - b.gp_pence : null,
  cost_pct_pts: a.cost_pct != null && b.cost_pct != null ? Math.round((a.cost_pct - b.cost_pct) * 10) / 10 : null,
})

/**
 * The scenario's figures (see the top). menu: a draft or live version (the
 * Scenarios tab uses the draft: what Push prices changes); scope: { venue_id,
 * revenue_stream_id, order_type_id }; ctx: loadDishCosting()'s at the venue,
 * with pickMix for the deals' typical picks; units: { dishId: units sold }
 * (a Map or an object). { dishes: [{ dish_id, name, section_id, section,
 * kind, units, vat_rate, coverage, before, after (each { price_pence,
 * net_pence, cost, cost_pence, gp_pence, cost_pct, band }), price_changed,
 * cost_changed, prices, skipped, typical_picks, in_totals, why_out }],
 * sections: [{ section_id, section, before, after, change, units,
 * left_out_units }], total: the same, left_out: [{ dish_id, name, units,
 * why }] }.
 */
export function scenarioFigures(menu, scope, ctx, { rates = [], settings = null, changes = [], units = {} } = {}) {
  const mctx = menuCtx(menu)
  const here = { ...ctx, dishes: dishMap([menu], ctx.dishes), combo: mctx }
  const rules = variantRules(menu)
  const unitsOf = id => num(units instanceof Map ? units.get(id) : units?.[id])
  const costChanges = (changes || []).filter(c => c.what === 'cost')
  // First every dish's price and cost, before and after; a meal deal's cost after follows its picks'.
  const work = []
  const costs = new Map() // a dish's id -> { before, after }
  for (const s of menu?.sections || []) {
    for (const i of s.items || []) {
      const row = dishMargin(i, s, menu, scope, here, { rates, settings, rules, mctx, withOptions: false })
      const deal = row.kind === 'deal' ? dealTypical(i, scope, here, mctx) : null
      const charge = deal?.charge_pence ?? 0
      const priceBefore = priceOf(i, rules, mctx, charge)
      const ap = applyPrices(i, s.id, changes)
      const priceAfter = ap.prices.length ? priceOf(ap.item, rules, mctx, charge) : priceBefore
      const skipped = [...ap.skipped]
      let costBefore = row.cost
      let costAfter = costBefore
      if (deal) {
        costBefore = deal.cost
        costAfter = costBefore
        if (costChanges.some(c => c.applies === 'dish' && c.dish_id === i.id)) {
          skipped.push(i.name + ' is a meal deal: its cost is the dishes picked in it, so change their costs instead')
        }
      } else {
        for (const c of costChanges) if (changeApplies(c, { dish_id: i.id, section_id: s.id })) costAfter = changedCost(costAfter, c)
        costs.set(i.id, { before: costBefore, after: costAfter })
      }
      work.push({ i, s, row, deal, priceBefore, priceAfter, ap, skipped, costBefore, costAfter })
    }
  }
  // A deal's cost after: its typical picks' costs as the scenario changes them, so a change for every
  // dish (or a picked dish's own) reaches the deal once, through its picks, never on top of them.
  for (const w of work) {
    if (!w.deal || w.costBefore == null) continue
    let after = w.costBefore
    for (const p of typicalPicks(w.i, here)) {
      const c = costs.get(p.dish_id)
      if (!c) continue
      if (c.after == null) { after = null; break }
      if (c.before != null) after += c.after - c.before
    }
    w.costAfter = after == null ? null : round6(after)
  }

  const dishes = []
  const sections = []
  const total = { b: sideSums(), a: sideSums(), units: 0, left_out_units: 0 }
  const leftOut = []
  const bySection = new Map()
  for (const w of work) {
    const { i, s, row, deal, priceBefore, priceAfter, ap, costBefore, costAfter } = w
    const sec = bySection.get(s.id) || bySection.set(s.id, { b: sideSums(), a: sideSums(), units: 0, left_out_units: 0 }).get(s.id)
    {
      const t = thresholdsFor(settings, s.id)
      const side = (price, cost) => {
        const m = margin({ gross_pence: price ?? 0, vat_rate: row.vat_rate, cost })
        return {
          price_pence: price, net_pence: price == null ? null : m.net_pence, cost, cost_pence: m.cost_pence,
          gp_pence: price == null ? null : m.gp_pence, cost_pct: price == null ? null : m.cost_pct,
          band: row.kind === 'service' || price == null ? null : costBand(m.cost_pct, t),
        }
      }
      const before = side(priceBefore, costBefore)
      const after = side(priceAfter, costAfter)
      const u = unitsOf(i.id)
      const counted = row.kind !== 'service' && before.cost != null && after.cost != null && priceBefore != null && priceAfter != null
      const whyOut = row.kind === 'service' ? 'a service: no cost' : priceBefore == null ? 'no price'
        : before.cost == null || after.cost == null ? (row.kind === 'deal' ? 'its meal deal picks can\'t be costed' : 'not costed') : null
      dishes.push({
        dish_id: i.id, name: i.name, section_id: s.id, section: s.title ?? null, kind: row.kind, units: round6(u),
        vat_rate: row.vat_rate, coverage: row.coverage, before, after,
        price_changed: priceAfter !== priceBefore, cost_changed: costAfter !== costBefore,
        prices: ap.prices, skipped: [...new Set(w.skipped)], typical_picks: deal?.picks ?? null,
        in_totals: counted, why_out: counted ? null : whyOut,
      })
      if (!(u > 0)) continue
      sec.units += u
      total.units += u
      if (!counted) {
        sec.left_out_units += u
        total.left_out_units += u
        if (row.kind !== 'service') leftOut.push({ dish_id: i.id, name: i.name, units: round6(u), why: whyOut })
        continue
      }
      for (const [k, side2] of [['b', before], ['a', after]]) {
        for (const into of [sec, total]) {
          into[k].net += u * side2.net_pence
          into[k].cost += u * side2.cost
          into[k].units += u
        }
      }
    }
  }
  for (const s of menu?.sections || []) {
    const sec = bySection.get(s.id) || { b: sideSums(), a: sideSums(), units: 0, left_out_units: 0 }
    const b = sideOut(sec.b), a = sideOut(sec.a)
    sections.push({ section_id: s.id, section: s.title ?? null, units: round6(sec.units), left_out_units: round6(sec.left_out_units), before: b, after: a, change: delta(b, a) })
  }
  const b = sideOut(total.b), a = sideOut(total.a)
  return {
    dishes, sections,
    total: { units: round6(total.units), left_out_units: round6(total.left_out_units), before: b, after: a, change: delta(b, a) },
    left_out: leftOut,
  }
}

/**
 * A loaded menu (loadMenuFull(), GET /api/menus/:id) with the scenario's new
 * prices, and every price that changes, for Push prices' preview and its
 * save: { full (a copy, for menuSaveBody()), prices: [{ dish_id, dish,
 * section_id, section, kind, option_id, group, label, from_pence, to_pence }],
 * skipped: [words] }. Nothing else on the menu changes.
 */
export function pushPrices(full, changes = []) {
  const out = clone(full)
  const prices = []
  const skipped = []
  ;(out.sections || []).forEach((s, si) => {
    ;(s.items || []).forEach((it, ii) => {
      const ap = applyPrices(full.sections[si].items[ii], s.id, changes)
      skipped.push(...ap.skipped)
      if (!ap.prices.length) return
      s.items[ii] = ap.item
      for (const p of ap.prices) prices.push({ dish_id: it.id, dish: it.name, section_id: s.id, section: s.title ?? null, ...p })
    })
  })
  return { full: out, prices, skipped: [...new Set(skipped)] }
}

/** A short fingerprint of a list of price changes: Push prices saves only what its preview showed. */
export function priceStamp(prices = []) {
  const text = JSON.stringify(prices.map(p => [p.dish_id, p.kind, p.option_id || p.label || '', p.from_pence, p.to_pence]))
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36) + '-' + prices.length
}

/** The CSV rows of a scenario's figures (the Scenarios tab's Export CSV): [header, ...rows]. */
export function scenarioCsvRows(fig, { sales = true } = {}) {
  const money = p => (p == null ? '' : (p / 100).toFixed(2))
  const cost = c => (c == null ? '' : Number(c).toFixed(2))
  const head = ['Section', 'Dish', 'Units', 'Price before', 'Price after', 'Net before', 'Net after', 'Cost before', 'Cost after',
    'GP before', 'GP after', 'Cost % before', 'Cost % after', 'In the totals']
  const rows = [head]
  for (const d of fig.dishes || []) {
    rows.push([d.section || '', d.name, d.units, money(d.before.price_pence), money(d.after.price_pence), money(d.before.net_pence), money(d.after.net_pence),
      cost(d.before.cost), cost(d.after.cost), money(d.before.gp_pence), money(d.after.gp_pence), d.before.cost_pct ?? '', d.after.cost_pct ?? '',
      d.in_totals ? 'yes' : (d.why_out || 'no')])
  }
  const t = fig.total
  if (t) {
    rows.push([])
    rows.push(['At the mix', '', t.units, '', '', sales ? money(t.before.net_pence) : '', sales ? money(t.after.net_pence) : '', money(t.before.cost_pence), money(t.after.cost_pence),
      sales ? money(t.before.gp_pence) : '', sales ? money(t.after.gp_pence) : '', t.before.cost_pct ?? '', t.after.cost_pct ?? '', ''])
  }
  return rows
}
