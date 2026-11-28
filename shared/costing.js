// shared/costing.js
//
// The cost engine (docs/INVENTORY.md 5.2, 5.3, 5.5; inventory phase 1, 27 Nov
// 2026): what an inventory item costs at a venue, what a recipe costs from
// its lines, why, and the margin on a price. Plain ESM, no database: the API
// loads the rows once (loadCosting() in api/src/services/costingSvc.js) and
// the Recipes page, reports and Pepper all call these functions (rule 12).
//
// Money: costs are in pounds (purchasing keeps them so, to 4 places per
// pack); sales are in integer pence (the till). The two meet only in
// margin() below.
//
//   toBase(qty, unit, item)       a quantity in a unit as the item's base unit
//                                 (g, ml or each): a standard unit of the same
//                                 kind (kg for g), else one of the item's own
//                                 units (1 slice = 20 g). { base, problem }:
//                                 a unit that doesn't fit is refused by name
//   itemCost(item, venueId, data, basis)
//                                 the cost per base unit: standard (the price
//                                 chooseQuote() picks at the venue), last (the
//                                 latest price paid there) or average (the
//                                 weighted average paid over AVERAGE_DAYS),
//                                 and the usable cost after the item's yield
//   recipeCost(recipe, ctx)       { cost, per_unit, unit, lines, gaps, coverage }:
//                                 each line's cost, prep recipes inside costed
//                                 by their own yield and loss, and what could
//                                 not be costed with how to fix it
//   explain(recipe, ctx)          the steps of that cost as rows to show
//   nestingProblem(id, lines, recipes)   a recipe inside itself, or nested
//                                 deeper than MAX_DEPTH levels, refused on save
//   margin({ gross_pence, vat_rate, cost })   net, gross profit and cost %
//
// Phase 2 (docs/INVENTORY.md 5.4, 5.5, 8.2; migration 302): what is sold.
//
//   recipeFor(dishId, scope, links)   which recipe a menu dish uses at a
//                                 venue, revenue stream and order type: the
//                                 link matching most closely, scored as
//                                 taxFor() scores (stream 4, order type 2,
//                                 venue 1), with why in words
//   ruleFor(dishId, option, rules)    an option's rule: the dish's own
//                                 exception, else the option's
//   dishCost(dishId, { options, picks }, scope, ctx)
//                                 the dish's cost: its recipe times the
//                                 link's portions, each option's rule, a
//                                 meal deal's picked dishes (or its range
//                                 when the picks aren't known), gaps with
//                                 how to fix each
//   optionDefault(option)         what an option with no rule does: a gap
//                                 or nothing, and the words for it
//   menuMargins(menu, scope, ctx, { rates, settings })
//                                 every dish of a menu with its price, net
//                                 of VAT, cost, GP and cost %, banded; a
//                                 meal deal's range by dealRange(), each end
//                                 over what its own picks sell for
//   bandedPct(row) / bandedPicks(row)
//                                 the cost % a margin row is banded at (a
//                                 deal's highest) and the deal's picks that
//                                 give it
//   costBand() / thresholdsFor()  the target and limit cost % colours
//
// ctx / data: { items, recipes, quotes, preferred, receipts, since, venueId,
// basis } (objects or Maps keyed by id). items[id] = { id, name, base_unit,
// yield_pct, recipe_unit, units: [{ name, base_qty }] }; recipes[id] = a
// recipe with its lines; quotes[itemId] = the item's active quotes (with
// venue_prices); preferred[itemId] = { default, venues }; receipts[itemId] =
// [{ venue_id, at, packs, pack_base_qty, price, base_unit }] (price paid per
// pack; a receipt whose base_unit isn't the item's is left out: its pack size
// is in another unit).

import { UNITS, chooseQuote, quotePrice, packLabel, fmtNum, perUnitLabel } from './procurement.js'
import { vatIncluded, itemChoices, variantRules, fromPrice, priceVaries, basePrice } from './orderPricing.js'
import { RULE_WEIGHTS, taxFor } from './tax.js'
import { isCombo, comboOf, stepChoices, menuCtx, comboFromPrice } from './combos.js'
import { nameScore, normName, AUTO_MATCH } from './itemMatch.js'
import { itemType } from './catalogue.js'
import { ASSISTANT_NAME } from './assistant.js'
import { coverageShare } from './itemMapping.js'

export const MAX_DEPTH = 5
export const AVERAGE_DAYS = 90
export const BASES = [
  { key: 'standard', label: 'Standard', hint: 'The price each venue orders on today (its supplier choice, else the group\'s, else the cheapest).' },
  { key: 'last', label: 'Last paid', hint: 'The latest price paid at the venue: the invoice\'s price, else the price ordered at.' },
  { key: 'average', label: 'Average paid', hint: 'The average paid at the venue over the last ' + AVERAGE_DAYS + ' days, by quantity received.' },
]
export const BASIS_KEYS = BASES.map(b => b.key)
export const KINDS = [
  { key: 'dish', label: 'Dish', hint: 'What a guest is served: costed per portion.' },
  { key: 'prep', label: 'Prep', hint: 'A batch made in the kitchen (a sauce, a marinade): costed per unit it makes, and used inside other recipes.' },
]
export const COVERAGE = {
  full: 'Fully costed',
  partial: 'Partly costed',
  none: 'Not costed',
}
// What a prep recipe can be made in: the standard units, and a portion.
export const YIELD_UNITS = [...Object.keys(UNITS), 'portion']
export const UNIT_NAME_MAX = 30

const num = v => (v == null || v === '' ? 0 : Number(v))
const lower = s => String(s ?? '').trim().toLowerCase()
const round6 = n => Math.round(Number(n) * 1e6) / 1e6
const get = (coll, id) => (coll == null || id == null ? undefined : coll instanceof Map ? coll.get(id) : coll[id])
const values = coll => (coll == null ? [] : coll instanceof Map ? [...coll.values()] : Object.values(coll))

/** Money in pounds for the explanation: £0.26, £12.50; below a penny to 4 places. */
export function pounds(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return ''
  const v = Number(n)
  return (v < 0 ? '-£' : '£') + (Math.abs(v) > 0 && Math.abs(v) < 0.01 ? Math.abs(v).toFixed(4) : Math.abs(v).toFixed(2))
}

/** "30 g", "1.5 slice" */
const qtyText = (qty, unit) => fmtNum(qty) + ' ' + (UNITS[unit]?.label ?? unit)

/** A unit as a cost is read per: "litre" for l, else its label ("kg", "portion", "slice"). */
export const unitWord = u => (u === 'l' ? 'litre' : UNITS[u]?.label ?? u ?? '')
/** "a portion", "a litre", "each". */
export const perWord = u => (u === 'each' ? 'each' : 'a ' + unitWord(u))

// ── Units ─────────────────────────────────────────────────────

/** The units a recipe line can give this item in: the standard ones of its kind, then its own. */
export function unitChoices(item) {
  const kind = UNITS[item?.base_unit]?.kind
  const std = Object.keys(UNITS).filter(k => UNITS[k].kind === kind)
  const own = (item?.units || []).map(u => u.name).filter(n => !std.includes(lower(n)))
  return [...std, ...own]
}

/** Why a name can't be one of an item's own units, or null. */
export function unitNameProblem(name, item, { except = null } = {}) {
  const n = String(name ?? '').trim()
  if (!n) return 'Give the unit a name'
  if (n.length > UNIT_NAME_MAX) return 'A unit\'s name is at most ' + UNIT_NAME_MAX + ' characters'
  const kind = UNITS[item?.base_unit]?.kind
  const std = UNITS[lower(n)]
  if (std && std.kind === kind) return (item?.name || 'This item') + ' already knows ' + std.label + ': it is a standard unit'
  if ((item?.units || []).some(u => lower(u.name) === lower(n) && u.id !== except)) return (item?.name || 'This item') + ' already has a unit called ' + n
  return null
}

/**
 * A quantity in a unit as the item's base unit. A standard unit of the same
 * kind converts by its factor (2 kg = 2000 g); otherwise the item's own unit
 * of that name (1 slice = 20 g; "each" for an item kept in grams). Anything
 * else is refused by name: "Cheddar has no size for a slice".
 */
export function toBase(qty, unit, item) {
  const q = Number(qty)
  const name = item?.name || 'This item'
  if (!Number.isFinite(q) || q < 0) return { base: null, problem: 'The quantity isn\'t a number' }
  const b = UNITS[item?.base_unit]
  if (!b) return { base: null, problem: name + ' has no unit it is measured in' }
  const u = UNITS[lower(unit)]
  if (u && u.kind === b.kind) return { base: round6(q * u.factor / b.factor), problem: null }
  const own = (item?.units || []).find(x => lower(x.name) === lower(unit))
  if (own && num(own.base_qty) > 0) return { base: round6(q * num(own.base_qty)), problem: null, own }
  const article = /^[aeiou]/i.test(String(unit || '').trim()) ? 'an ' : 'a '
  return { base: null, problem: name + ' has no size for ' + article + (String(unit || '').trim() || 'blank unit') }
}

/** The usable share of an item: a line's own yield, else the item's, else 100%. */
export function yieldOf(item, line = null) {
  const y = line?.yield_pct != null && line.yield_pct !== '' ? num(line.yield_pct) : item?.yield_pct != null && item.yield_pct !== '' ? num(item.yield_pct) : 100
  return y > 0 && y <= 100 ? y : 100
}

/** What has to be bought for a usable quantity: base / (yield % / 100). 1.20 at 80% = 1.50. */
export const asBought = (usable, yieldPct) => round6(num(usable) / (num(yieldPct || 100) / 100))

// ── The cost of an item ───────────────────────────────────────

/**
 * What an item costs per base unit at a venue (null venue = the group's
 * price), on a basis: { basis, per_base, usable_per_base, yield_pct, how,
 * quote_id, supplier_name, pack_label, pack_price, pack_base_qty, at,
 * received, problem }. problem: 'no_price' (standard: no supplier price),
 * 'no_receipts' (last, average: nothing received there in the item's base
 * unit) or 'no_recent' (average: nothing received there in the last
 * AVERAGE_DAYS days, only before).
 */
export function itemCost(item, venueId, data = {}, basis = 'standard') {
  const y = yieldOf(item)
  const out = (per, extra) => ({
    basis, per_base: per == null ? null : round6(per), usable_per_base: per == null ? null : round6(per / (y / 100)),
    yield_pct: y, how: null, quote_id: null, supplier_name: null, pack_label: null, pack_price: null, pack_base_qty: null,
    at: null, received: 0, problem: per == null ? (basis === 'standard' ? 'no_price' : 'no_receipts') : null, ...extra,
  })
  if (!item) return out(null)
  if (basis === 'last' || basis === 'average') {
    // A pack size in another unit (booked in before the item's base unit changed) is no price per base unit.
    const all = (get(data.receipts, item.id) || []).filter(r => num(r.packs) > 0 && num(r.pack_base_qty) > 0
      && (r.base_unit == null || r.base_unit === item.base_unit))
    const here = venueId != null ? all.filter(r => r.venue_id === venueId) : all
    if (!here.length) return out(null)
    const time = r => new Date(r.at).getTime()
    if (basis === 'last') {
      const last = here.reduce((a, r) => (time(r) > time(a) ? r : a))
      return out(num(last.price) / num(last.pack_base_qty), {
        how: 'last', at: last.at, pack_price: num(last.price), pack_base_qty: num(last.pack_base_qty), received: 1,
        supplier_name: last.supplier_name ?? null, pack_label: last.pack_label ?? null,
      })
    }
    const since = data.since ? new Date(data.since).getTime() : null
    const recent = since == null ? here : here.filter(r => time(r) >= since)
    if (!recent.length) return out(null, { problem: 'no_recent' })
    const paid = recent.reduce((s, r) => s + num(r.price) * num(r.packs), 0)
    const qty = recent.reduce((s, r) => s + num(r.packs) * num(r.pack_base_qty), 0)
    return out(qty > 0 ? paid / qty : null, { how: 'average', received: recent.length })
  }
  const pick = chooseQuote(get(data.quotes, item.id) || [], venueId ?? null, get(data.preferred, item.id) || {})
  if (!pick || !(num(pick.quote.pack_base_qty) > 0)) return out(null)
  const q = pick.quote
  const price = quotePrice(q, venueId ?? null)
  return out(price / num(q.pack_base_qty), {
    how: pick.how, quote_id: q.id, supplier_name: q.supplier_name ?? null, pack_label: packLabel(q),
    pack_price: price, pack_base_qty: num(q.pack_base_qty),
  })
}

// ── Recipes ───────────────────────────────────────────────────

/** The unit a recipe is costed per: its yield unit for a prep recipe, a portion for a dish. */
export const recipeUnit = r => (r?.kind === 'prep' ? (r.yield_unit || null) : 'portion')

/** How many of its unit a recipe makes: a prep's yield less its loss, a dish's portions. */
export function recipeMakes(r) {
  if (!r) return null
  if (r.kind === 'prep') {
    const y = num(r.yield_qty)
    if (!(y > 0) || !r.yield_unit) return null
    return round6(y * (1 - Math.min(num(r.loss_pct), 99.99) / 100))
  }
  const p = num(r.portions || 1)
  return p > 0 ? p : 1
}

/** A sub-recipe line's quantity in the sub-recipe's own unit: { qty, problem }. */
export function inRecipeUnit(qty, unit, sub) {
  const su = recipeUnit(sub)
  const q = Number(qty)
  if (!Number.isFinite(q) || q < 0) return { qty: null, problem: 'The quantity isn\'t a number' }
  if (!su) return { qty: null, problem: (sub?.name || 'That recipe') + ' doesn\'t say what it makes' }
  const a = UNITS[lower(unit)], b = UNITS[lower(su)]
  if (a && b && a.kind === b.kind) return { qty: round6(q * a.factor / b.factor), problem: null }
  if (lower(unit) === lower(su)) return { qty: q, problem: null }
  return { qty: null, problem: (sub?.name || 'That recipe') + ' is made in ' + (UNITS[su]?.label ?? su) + ': ' + (String(unit || '').trim() || 'a blank unit') + ' doesn\'t fit' }
}

/** The units a line can use a prep recipe in. */
export function recipeUnitChoices(sub) {
  const su = recipeUnit(sub)
  if (!su) return []
  const b = UNITS[su]
  return b ? Object.keys(UNITS).filter(k => UNITS[k].kind === b.kind) : [su]
}

const FIX = {
  no_price: n => 'Add a supplier price for ' + n + ' on the Inventory page.',
  no_receipts: n => 'Nothing of ' + n + ' has been booked in here yet: cost it at the standard price, or book a delivery in.',
  no_recent: n => 'Nothing of ' + n + ' has been booked in here in the last ' + AVERAGE_DAYS + ' days: cost it on last paid or the standard price, or book a delivery in.',
  no_unit: (n, unit, item) => 'Give ' + n + ' a size for ' + unit + ' (its units on the Inventory page), or use ' + (unitChoices(item).join(', ') || 'its own unit') + '.',
  sub_unit: (n, unit, sub) => 'Use ' + n + ' in ' + (recipeUnitChoices(sub).join(', ') || 'what it is made in') + '.',
  missing: () => 'Take the line out, or pick what it should be.',
  empty: n => 'Add what goes into ' + n + '.',
  no_yield: n => 'Say how much ' + n + ' makes.',
  sub_partial: n => 'Open ' + n + ' and fix its gaps.',
  cycle: n => 'Take ' + n + ' out: a recipe can\'t be inside itself.',
  too_deep: () => 'Recipes nest up to ' + MAX_DEPTH + ' levels: use fewer prep recipes inside each other.',
  draft: n => 'Open ' + n + ', check what ' + DRAFT_BY + ' wrote, and make it live.',
}

// Why an item has no cost on the basis asked, in words.
const NO_COST = {
  no_price: (n, venueId) => n + ' has no supplier price' + (venueId ? ' here' : ''),
  no_receipts: n => 'Nothing of ' + n + ' has been booked in here yet',
  no_recent: n => 'Nothing of ' + n + ' has been booked in here in the last ' + AVERAGE_DAYS + ' days',
}

// Who writes the drafts that wait for a person's check (recipes.source, migration 304).
const DRAFT_BY = ASSISTANT_NAME
export const SOURCES = { reader: 'Read in by Pepper', pepper: 'Made by Pepper' }

/**
 * A recipe Pepper wrote that nobody has made live yet (phase 3, migration
 * 304): read in from a file or text (source 'reader') or made in the chat
 * ('pepper'), still a draft. Costed, with the gap "not checked yet", so it
 * and every dish linked to it show as partly costed until a person checks
 * it. A draft a person made (a variation, a copy) is costed as it is.
 */
export const needsCheck = r => !!r && r.status === 'draft' && !!r.source

/**
 * Whether a line Pepper read becomes a line of its draft (phase 3): matched
 * (by Pepper's ref, a code, a sure name or a person's pick) with a quantity,
 * not left out by the person, and, when it names a recipe of the same
 * reading, that one is a prep recipe being made too (made: that recipe, or
 * null). Anything else goes into the draft's notes in the words read. The
 * review's draftsBody() (admin RecipeReader.jsx) and Pepper's
 * draftsFromReading() (ai/tools/recipes.js) both call it.
 */
export function readLineKept(line, made = null) {
  if (!line || line.out || !(num(line.qty) > 0)) return false
  const m = line.match || {}
  if (m.state !== 'matched') return false
  if (m.kind === 'new') return made?.kind === 'prep'
  return m.kind === 'item' || m.kind === 'recipe'
}

function gap(line, index, reason, text, fix) {
  return { line: index, line_id: line?.id ?? null, reason, text, fix }
}

/**
 * The cost of a recipe at ctx.venueId on ctx.basis ('standard' when not
 * given): { cost (all its lines), per_unit (per portion, or per unit a prep
 * makes), unit, makes, lines: [{ ...line, kind, name, base_qty, base_unit,
 * bought_qty, yield_pct, per_base, cost, partial, problem, source }], gaps,
 * coverage: 'full' | 'partial' | 'none', complete }. A line that can't be
 * costed is left out of the cost and listed in gaps, so a partial cost is
 * marked as such, never a confident wrong number.
 */
export function recipeCost(recipe, ctx = {}, state = null) {
  const st = state || { stack: [], memo: ctx._memo || (ctx._memo = new Map()) }
  const basis = ctx.basis || 'standard'
  const venueId = ctx.venueId ?? null
  // Remembered for the request's other recipes (a prep inside many dishes),
  // by venue and basis: a ctx may be asked about another venue later. Only
  // the ctx's own recipe is remembered, and only for that same object: an
  // edited copy with the same id (a draft) is costed afresh.
  const memoKey = recipe?.id && get(ctx.recipes, recipe.id) === recipe ? recipe.id + '|' + (venueId ?? '') + '|' + basis : null
  const hit = memoKey && !st.stack.length ? st.memo.get(memoKey) : null
  if (hit && hit.recipe === recipe) return hit.out
  const gaps = []
  const lines = (recipe?.lines || []).slice().sort((a, b) => num(a.sort_order) - num(b.sort_order)).map((l, i) => {
    const row = {
      ...l, index: i, kind: l.sub_recipe_id ? 'recipe' : 'item', name: null, base_qty: null, base_unit: null,
      bought_qty: null, yield_pct: null, per_base: null, cost: null, partial: false, problem: null, source: null,
    }
    if (l.item_id) {
      const item = get(ctx.items, l.item_id)
      if (!item) {
        row.problem = 'missing'
        gaps.push(gap(l, i, 'missing', 'This line\'s inventory item is gone', FIX.missing()))
        return row
      }
      row.name = item.name
      row.base_unit = item.base_unit
      const conv = toBase(l.qty, l.unit, item)
      if (conv.problem) {
        row.problem = 'no_unit'
        gaps.push(gap(l, i, 'no_unit', conv.problem, FIX.no_unit(item.name, String(l.unit || '').trim() || 'that unit', item)))
        return row
      }
      row.base_qty = conv.base
      row.yield_pct = yieldOf(item, l)
      row.bought_qty = asBought(conv.base, row.yield_pct)
      const c = itemCost(item, venueId, ctx, basis)
      row.source = c
      if (c.per_base == null) {
        row.problem = c.problem
        gaps.push(gap(l, i, c.problem, NO_COST[c.problem](item.name, venueId), FIX[c.problem](item.name)))
        return row
      }
      row.per_base = c.per_base
      row.cost = round6(row.bought_qty * c.per_base)
      return row
    }
    const sub = get(ctx.recipes, l.sub_recipe_id)
    if (!sub) {
      row.problem = 'missing'
      gaps.push(gap(l, i, 'missing', 'This line\'s recipe is gone', FIX.missing()))
      return row
    }
    row.name = sub.name
    if (sub.id === recipe?.id || st.stack.includes(sub.id)) {
      row.problem = 'cycle'
      gaps.push(gap(l, i, 'cycle', sub.name + ' is inside itself', FIX.cycle(sub.name)))
      return row
    }
    if (st.stack.length + 1 >= MAX_DEPTH) {
      row.problem = 'too_deep'
      gaps.push(gap(l, i, 'too_deep', sub.name + ' is nested more than ' + MAX_DEPTH + ' levels down', FIX.too_deep()))
      return row
    }
    const conv = inRecipeUnit(l.qty, l.unit, sub)
    if (conv.problem) {
      row.problem = conv.problem.includes('doesn\'t say') ? 'no_yield' : 'no_unit'
      gaps.push(gap(l, i, row.problem, conv.problem, row.problem === 'no_yield' ? FIX.no_yield(sub.name) : FIX.sub_unit(sub.name, l.unit, sub)))
      return row
    }
    const inner = recipeCost(sub, ctx, { stack: [...st.stack, recipe?.id].filter(Boolean), memo: st.memo })
    row.base_qty = conv.qty
    row.base_unit = recipeUnit(sub)
    row.yield_pct = l.yield_pct != null && l.yield_pct !== '' ? yieldOf(null, l) : 100
    row.bought_qty = asBought(conv.qty, row.yield_pct)
    row.source = { basis, recipe_id: sub.id, per_unit: inner.per_unit, unit: inner.unit, coverage: inner.coverage, gaps: inner.gaps.length }
    if (inner.per_unit == null) {
      const why = !(sub.lines || []).length ? 'empty' : recipeMakes(sub) == null ? 'no_yield' : 'sub_partial'
      row.problem = why
      gaps.push(gap(l, i, why, why === 'empty' ? sub.name + ' has nothing in it' : why === 'no_yield'
        ? sub.name + ' doesn\'t say how much it makes' : sub.name + ' can\'t be costed yet', FIX[why](sub.name)))
      return row
    }
    row.per_base = inner.per_unit
    row.cost = round6(row.bought_qty * inner.per_unit)
    if (inner.gaps.length) {
      row.partial = true
      gaps.push(gap(l, i, 'sub_partial', sub.name + ' is only partly costed', FIX.sub_partial(sub.name)))
    }
    return row
  })
  const costed = lines.filter(l => l.cost != null)
  const cost = round6(costed.reduce((s, l) => s + l.cost, 0))
  const makes = recipeMakes(recipe)
  const unit = recipeUnit(recipe)
  if (!lines.length) gaps.push(gap(null, null, 'empty', (recipe?.name || 'This recipe') + ' has nothing in it', FIX.empty(recipe?.name || 'it')))
  if (recipe?.kind === 'prep' && makes == null) gaps.push(gap(null, null, 'no_yield', (recipe?.name || 'This recipe') + ' doesn\'t say how much it makes', FIX.no_yield(recipe?.name || 'it')))
  // A draft Pepper wrote (read in, or made in the chat; phase 3) is costed, but never as if it were finished.
  if (needsCheck(recipe)) gaps.push(gap(null, null, 'draft', (recipe?.name || 'This recipe') + ' is a draft ' + DRAFT_BY + ' ' + (recipe.source === 'reader' ? 'read in' : 'wrote') + ', not checked yet', FIX.draft(recipe?.name || 'it')))
  const per = costed.length && makes ? round6(cost / makes) : null
  const coverage = !costed.length || per == null ? 'none' : gaps.length ? 'partial' : 'full'
  const out = { recipe_id: recipe?.id ?? null, basis, venue_id: venueId, cost: costed.length ? cost : null, per_unit: per, unit, makes, lines, gaps, coverage, complete: coverage === 'full' }
  if (memoKey && !st.stack.length) st.memo.set(memoKey, { recipe, out })
  return out
}

/** A cost per base unit in the unit prices are read in: "£8.50 a kg", "£0.30 each". */
function perText(perBase, baseUnit) {
  if (perBase == null) return ''
  if (baseUnit === 'g' || baseUnit === 'ml') return pounds(perBase * 1000) + ' ' + perWord(perUnitLabel(baseUnit))
  return pounds(perBase) + ' ' + perWord(baseUnit)
}
/** The same for others: price creep's moves (inventory phase 7b), Pepper's why_cost_changed and the alerts list. */
export const perBaseText = perText

const HOW = {
  venue: 'the venue\'s supplier choice', default: 'the group\'s supplier choice', cheapest: 'the cheapest supplier',
  last: 'the last price paid', average: 'the average paid',
}

/**
 * The steps of a recipe's cost as rows a page or Pepper can show:
 * [{ kind: 'line' | 'gap' | 'total' | 'per_unit', label, steps: [text], amount }]
 * and the same as text. prices: false leaves the supplier, pack and pack
 * price out (people without purchasing prices see the cost, not the quote).
 */
export function explain(recipe, ctx = {}, { prices = true, result = null } = {}) {
  const r = result || recipeCost(recipe, ctx)
  const rows = []
  for (const l of r.lines) {
    const label = l.name || (l.kind === 'recipe' ? 'A recipe' : 'An item')
    if (l.cost == null) {
      const g = r.gaps.find(x => x.line === l.index)
      rows.push({ kind: 'gap', label, steps: [qtyText(l.qty, l.unit) + ': not costed. ' + (g ? g.text + '. ' + g.fix : '')], amount: null })
      continue
    }
    const steps = []
    if (l.kind === 'item') {
      const unitLabel = UNITS[l.base_unit]?.label ?? l.base_unit
      if (lower(l.unit) !== lower(l.base_unit)) steps.push(qtyText(l.qty, l.unit) + ' is ' + fmtNum(l.base_qty) + ' ' + unitLabel)
      if (l.yield_pct < 100) steps.push('usable ' + fmtNum(l.yield_pct, 2) + '%: ' + fmtNum(l.base_qty) + ' ' + unitLabel + ' ÷ ' + fmtNum(l.yield_pct / 100, 4) + ' = ' + fmtNum(l.bought_qty) + ' ' + unitLabel + ' bought')
      const s = l.source || {}
      const from = prices && s.how && (s.how === 'venue' || s.how === 'default' || s.how === 'cheapest')
        ? ' (' + [s.supplier_name, s.pack_label, s.pack_price != null ? pounds(s.pack_price) + ' a pack' : null].filter(Boolean).join(', ') + ', ' + HOW[s.how] + ')'
        : s.how ? ' (' + HOW[s.how] + ')' : ''
      steps.push(fmtNum(l.bought_qty) + ' ' + unitLabel + ' at ' + perText(l.per_base, l.base_unit) + from + ' = ' + pounds(l.cost))
    } else {
      const u = UNITS[l.base_unit]?.label ?? l.base_unit
      if (lower(l.unit) !== lower(l.base_unit)) steps.push(qtyText(l.qty, l.unit) + ' is ' + fmtNum(l.base_qty) + ' ' + u)
      if (l.yield_pct < 100) steps.push('usable ' + fmtNum(l.yield_pct, 2) + '%: ' + fmtNum(l.bought_qty) + ' ' + u + ' made')
      steps.push(fmtNum(l.bought_qty) + ' ' + u + ' at ' + pounds(l.per_base) + ' ' + perWord(l.base_unit) + ' (its own recipe' + (l.partial ? ', partly costed' : '') + ') = ' + pounds(l.cost))
    }
    rows.push({ kind: 'line', label, steps, amount: l.cost })
  }
  for (const g of r.gaps.filter(x => x.line == null)) rows.push({ kind: 'gap', label: recipe?.name || 'This recipe', steps: [g.text + '. ' + g.fix], amount: null })
  if (r.cost != null) {
    rows.push({ kind: 'total', label: 'Total', steps: [r.lines.filter(l => l.cost != null).length + ' of ' + r.lines.length + ' lines costed' + (r.coverage === 'full' ? '' : ' (partly costed)')], amount: r.cost })
  }
  if (r.per_unit != null) {
    const steps = recipe?.kind === 'prep'
      ? [pounds(r.cost) + ' ÷ ' + fmtNum(r.makes) + ' ' + (UNITS[r.unit]?.label ?? r.unit)
        + (num(recipe.loss_pct) > 0 ? ' (' + fmtNum(recipe.yield_qty) + ' less ' + fmtNum(recipe.loss_pct, 2) + '% lost in cooking)' : '')]
      : [pounds(r.cost) + ' ÷ ' + fmtNum(r.makes) + (num(r.makes) === 1 ? ' portion' : ' portions')]
    rows.push({ kind: 'per_unit', label: recipe?.kind === 'prep' ? 'Per ' + unitWord(r.unit) : 'Per portion', steps, amount: r.per_unit })
  }
  const text = rows.map(x => x.label + ': ' + x.steps.join('; ') + (x.amount != null && x.kind !== 'line' ? ' = ' + pounds(x.amount) : '')).join('\n')
  return { rows, text, coverage: r.coverage }
}

// ── Nesting ───────────────────────────────────────────────────

/**
 * Whether saving a recipe with these lines would put a recipe inside itself
 * or nest recipes deeper than MAX_DEPTH levels (a dish is level 1, a prep
 * inside it level 2, ...): null, or { code: 'recipe_cycle' | 'recipe_depth',
 * path: [names], message }. recipes holds every recipe with its lines (this
 * one's as stored, or absent for a new one).
 */
export function nestingProblem(recipeId, lines, recipes, name = null) {
  const id = recipeId || '__new__'
  const graph = new Map()
  for (const r of values(recipes)) graph.set(r.id, { name: r.name, subs: (r.lines || []).map(l => l.sub_recipe_id).filter(Boolean) })
  graph.set(id, { name: name || get(recipes, recipeId)?.name || 'This recipe', subs: (lines || []).map(l => l.sub_recipe_id).filter(Boolean) })
  const nameOf = x => graph.get(x)?.name || 'a recipe'
  // A cycle through this recipe: a path from it back to it.
  const seen = new Set()
  const walk = (at, path) => {
    for (const s of graph.get(at)?.subs || []) {
      if (s === id) return [...path, s]
      if (seen.has(s)) continue
      seen.add(s)
      const hit = walk(s, [...path, s])
      if (hit) return hit
    }
    return null
  }
  const cycle = walk(id, [id])
  if (cycle) {
    const names = cycle.map(nameOf)
    return { code: 'recipe_cycle', path: names, message: nameOf(id) + ' can\'t go inside itself: ' + names.join(' > ') + '.' }
  }
  // Depth: the longest chain down from each recipe, and up into this one.
  const down = new Map()
  const depth = (x, guard = new Set()) => {
    if (down.has(x)) return down.get(x)
    if (guard.has(x)) return { n: 1, path: [x] }
    guard.add(x)
    let best = { n: 1, path: [x] }
    for (const s of graph.get(x)?.subs || []) {
      const d = depth(s, guard)
      if (d.n + 1 > best.n) best = { n: d.n + 1, path: [x, ...d.path] }
    }
    guard.delete(x)
    down.set(x, best)
    return best
  }
  const parents = new Map()
  for (const [x, g] of graph) for (const s of g.subs) { if (!parents.has(s)) parents.set(s, []); parents.get(s).push(x) }
  const up = (x, guard = new Set()) => {
    if (guard.has(x)) return []
    guard.add(x)
    let best = []
    for (const p of parents.get(x) || []) { const u = up(p, guard); if (u.length + 1 > best.length) best = [...u, p] }
    guard.delete(x)
    return best
  }
  const chain = [...up(id), ...depth(id).path]
  if (chain.length > MAX_DEPTH) {
    const names = chain.map(nameOf)
    return { code: 'recipe_depth', path: names, message: 'Recipes nest up to ' + MAX_DEPTH + ' levels: ' + names.join(' > ') + ' is ' + chain.length + '.' }
  }
  return null
}

// ── Margin ────────────────────────────────────────────────────

/**
 * A price against a cost: gross_pence (VAT included, integer pence, as the
 * till keeps it), vat_rate (%), cost (pounds, as purchasing keeps it).
 * { gross_pence, vat_pence, net_pence, cost_pence, gp_pence, cost_pct, gp_pct }:
 * net = gross - vatIncluded(gross, rate); GP = net - cost; cost % = cost / net.
 * The cost is rounded to the penny once and GP is what is left of net, so
 * cost + GP = net to the penny; GP % is 100 less cost % (to one place), so
 * the two make 100. Percentages are null for a price of nothing; the cost
 * is null when unknown.
 */
export function margin({ gross_pence, vat_rate = 0, cost = null } = {}) {
  const gross = Math.round(num(gross_pence))
  const vat = vatIncluded(gross, num(vat_rate))
  const net = gross - vat
  if (cost == null || !Number.isFinite(Number(cost))) {
    return { gross_pence: gross, vat_pence: vat, net_pence: net, cost_pence: null, gp_pence: null, cost_pct: null, gp_pct: null }
  }
  const costPence = Number(cost) * 100
  const cost_pct = net > 0 ? Math.round(costPence / net * 1000) / 10 : null
  const costRounded = Math.round(costPence)
  return {
    gross_pence: gross, vat_pence: vat, net_pence: net,
    cost_pence: costRounded, gp_pence: net - costRounded,
    cost_pct, gp_pct: cost_pct == null ? null : Math.round((100 - cost_pct) * 10) / 10,
  }
}

/**
 * A cost in pounds as a share of net sales in pence, in percent to two
 * places (inventory phase 6a: actual and theoretical food cost %, an item's
 * unexplained loss as points of the venue's food sales; shared/variance.js
 * calls it, so pence meet pounds only here). Null for no sales or no cost.
 */
export function costShare(costPounds, netPence) {
  const net = num(netPence)
  if (costPounds == null || !Number.isFinite(Number(costPounds)) || !(net > 0)) return null
  return Math.round(Number(costPounds) * 100 / net * 10000) / 100
}

// ── Links: which recipe a dish uses where (phase 2) ───────────
//
// A link (recipe_links, migration 302): { dish_id, recipe_id, portions,
// venue_id, revenue_stream_id, order_type_id }; each scope left empty means
// any. A link with a revenue stream stores that stream's venue too (a stream
// is one venue's). A sale's scope: { venue_id, revenue_stream_id,
// order_type_id }, as taxFor() takes it.

/** The id an empty scope is kept as in the links' unique index (one link per dish and scope). */
export const ZERO_ID = '00000000-0000-0000-0000-000000000000'
export const SCOPE_KEYS = ['venue_id', 'revenue_stream_id', 'order_type_id']

/**
 * How closely a link fits, as taxFor() scores a tax rule (shared/tax.js
 * RULE_WEIGHTS: a stream 4, an order type 2, a venue 1), so a dish's recipe
 * and its VAT never disagree about which setting is the closer one. A stream
 * link's venue adds nothing: like a tax rule naming a stream, the stream
 * already says where. Stream with order type 6 > stream 4 > venue with order
 * type 3 > order type 2 > venue 1 > every venue 0.
 */
export function linkScore(link) {
  let s = 0
  if (link?.revenue_stream_id) s += RULE_WEIGHTS.streams
  else if (link?.venue_id) s += RULE_WEIGHTS.venues
  if (link?.order_type_id) s += RULE_WEIGHTS.types
  return s
}

/** A link applies to a sale only when every scope it sets is the sale's. */
export function linkMatches(link, scope = {}) {
  if (link.revenue_stream_id && link.revenue_stream_id !== (scope.revenue_stream_id ?? null)) return false
  if (link.order_type_id && link.order_type_id !== (scope.order_type_id ?? null)) return false
  if (link.venue_id && link.venue_id !== (scope.venue_id ?? null)) return false
  return true
}

/** Two scopes are the same cell: the same venue, stream and order type (empty = any). */
export const sameScope = (a = {}, b = {}) => SCOPE_KEYS.every(k => (a[k] || null) === (b[k] || null))

/**
 * A scope in words, for "why this recipe": "every venue", "Soho", "Take out
 * at every venue", "Take out at Soho", "Bar (Soho)", "Take out at Bar
 * (Soho)". names: { venues, streams, types } id -> name.
 */
export function scopeText(scope = {}, names = {}) {
  const nameIn = (key, id, none) => (id ? names[key]?.[id] || none : null)
  const type = nameIn('types', scope.order_type_id, 'an order type')
  const venue = nameIn('venues', scope.venue_id, 'a venue')
  const stream = nameIn('streams', scope.revenue_stream_id, 'a revenue stream')
  const place = stream ? stream + (venue ? ' (' + venue + ')' : '') : venue || 'every venue'
  return type ? type + ' at ' + place : place
}

/**
 * The recipe a dish uses in a scope: { link, why, score } or null when no
 * link applies. The link matching most closely wins (linkScore()); one link
 * per dish and scope (the table's unique index) means there is never a tie.
 */
export function recipeFor(dishId, scope = {}, links = [], { names = {} } = {}) {
  let best = null
  for (const l of links || []) {
    if (l.dish_id !== dishId || !linkMatches(l, scope)) continue
    const score = linkScore(l)
    if (!best || score > best.score) best = { link: l, score }
  }
  return best ? { ...best, why: scopeText(best.link, names) } : null
}

// ── Option rules (decision D3) ────────────────────────────────
//
// A rule (recipe_option_rules, migration 302): an option of the library
// (option_id), or a dish's own one-off option (dish_id + option_label, the
// label sales name it by: 'v:<label>'); dish_id with option_id is an
// exception for that one dish. What it does to whichever recipe the dish
// uses there:
//   add      item_id or sub_recipe_id, qty, unit (extra cheese: 30 g cheddar)
//   remove   item_id: the recipe's lines of it come out (no onion)
//   swap     item_id for swap_item_id, the same quantity or qty + unit (oat milk)
//   scale    factor: the recipe's lines times it (large: 1.5)
//   recipe   recipe_id: a dish recipe of its own, qty portions (a side of fries)
//   nothing  (well done)
// With no rule the option's group says (variation_type): an addition adds
// nothing until it has a rule (a gap), a side is a gap until its recipe is
// linked by a rule, a modification changes nothing; a group with no type
// changes nothing, unless the option costs extra (then it is a gap).
//
// The till's prefixes (shared/pos/pricing.js PREFIXES) act on the option's
// own lines: the recipe's lines of the option's item when the recipe has
// them (No onion takes the onion out), else what the option adds. No takes
// them out, Light halves them, Extra doubles them, On the side changes
// nothing. An option with no rule finds its lines in the recipe by name.

export const RULE_ACTIONS = [
  { key: 'add', label: 'Adds', hint: 'Something added to the recipe: extra cheese adds 30 g of cheddar.' },
  { key: 'remove', label: 'Takes out', hint: 'An item comes out of the recipe: no onion.' },
  { key: 'swap', label: 'Swaps', hint: 'One item for another, the same quantity or a stated one: oat milk for milk.' },
  { key: 'scale', label: 'Scales', hint: 'The whole recipe times a factor: large is 1.5.' },
  { key: 'recipe', label: 'Is a recipe', hint: 'A recipe of its own added to the dish: a side of fries.' },
  { key: 'nothing', label: 'Changes nothing', hint: 'Nothing in the recipe changes: well done.' },
]
export const RULE_ACTION_KEYS = RULE_ACTIONS.map(a => a.key)
/** What a prefix does to the option's own lines (the till's prefix keys). */
export const PREFIX_FACTORS = { no: 0, light: 0.5, extra: 2, side: 1 }
export const PREFIX_WORDS = { no: 'No', light: 'Light', extra: 'Extra', side: 'On the side' }
/** What an option with no rule does, by its group's variation_type (extra: no type, but it costs extra). */
export const OPTION_DEFAULTS = {
  addition: 'Adds to the recipe: nothing is added until it has a rule',
  side: 'A side: its own recipe, once a rule links it',
  modification: 'Changes nothing until it has a rule',
  none: 'Changes nothing until it has a rule (its group has no type)',
  extra: 'Costs extra, so it adds something: nothing is added until it has a rule (its group has no type)',
}
const OPTION_ID_PREFIX = 'v:'

/** A dish's own one-off option as sales name it ('v:<label>'), or null for a library option id. */
export const ownOptionLabel = id => (typeof id === 'string' && id.startsWith(OPTION_ID_PREFIX) ? id.slice(OPTION_ID_PREFIX.length) : null)

/**
 * What an option with no rule does (decision D3), the one rule dishCost(),
 * the Options tab and a dish's matrix all show: { state: 'gap' | 'default',
 * type, text }. An addition or a side is a gap until a rule says what it
 * adds; an option of a group with no type that costs extra is a gap too; a
 * modification, any other option of a group with no type and a dish's own
 * option change nothing. option: { variation_type, price_mode, price_pence }
 * (the library's), or { own: true } for a dish's own option.
 */
export function optionDefault(option = {}) {
  const type = option?.own ? 'modification' : option?.variation_type || null
  if (type === 'addition' || type === 'side') return { state: 'gap', type, text: OPTION_DEFAULTS[type] }
  if (!type && option?.price_mode === 'extra' && num(option?.price_pence) > 0) return { state: 'gap', type: 'extra', text: OPTION_DEFAULTS.extra }
  return { state: 'default', type: type || 'none', text: OPTION_DEFAULTS[type] || OPTION_DEFAULTS.none }
}

/**
 * The rule for an option on a dish: { rule, from: 'dish' | 'option' } or
 * null. option: { id } (a library option id, or 'v:<label>' for the dish's
 * own option). The dish's exception beats the option's own rule.
 */
export function ruleFor(dishId, option, rules = []) {
  const own = ownOptionLabel(option?.id)
  if (own != null) {
    const r = (rules || []).find(x => !x.option_id && x.dish_id === dishId && lower(x.option_label) === lower(own))
    return r ? { rule: r, from: 'dish' } : null
  }
  const mine = (rules || []).filter(x => x.option_id && x.option_id === option?.id)
  const r = mine.find(x => x.dish_id && x.dish_id === dishId) || mine.find(x => !x.dish_id)
  return r ? { rule: r, from: r.dish_id ? 'dish' : 'option' } : null
}

/** What a rule does, in words: "Adds 30 g Cheddar", "Scales the recipe x 1.5". ctx: items and recipes by id. */
export function ruleText(rule, ctx = {}) {
  if (!rule) return ''
  const item = id => get(ctx.items, id)?.name || 'an item'
  const recipe = id => get(ctx.recipes, id)?.name || 'a recipe'
  const amount = rule.qty != null && rule.qty !== '' && rule.unit ? qtyText(rule.qty, rule.unit) + ' ' : ''
  switch (rule.action) {
    case 'add': return 'Adds ' + amount + (rule.sub_recipe_id ? recipe(rule.sub_recipe_id) : item(rule.item_id))
    case 'remove': return 'Takes ' + item(rule.item_id) + ' out'
    case 'swap': return 'Swaps ' + item(rule.item_id) + ' for ' + amount + item(rule.swap_item_id)
    case 'scale': return 'Scales the recipe x ' + fmtNum(rule.factor, 3)
    case 'recipe': return 'Is ' + (num(rule.qty || 1) !== 1 ? fmtNum(rule.qty) + ' x ' : '') + recipe(rule.recipe_id)
    default: return 'Changes nothing'
  }
}

/** Why a rule can't be saved as it is, or null (the API checks the ids are the group's). */
export function ruleProblem(rule) {
  const r = rule || {}
  if (!RULE_ACTION_KEYS.includes(r.action)) return 'Pick what the option does'
  if (!r.option_id && !(r.dish_id && String(r.option_label || '').trim())) return 'A rule is for an option, or for one dish\'s own option'
  const hasQty = r.qty != null && r.qty !== ''
  const qtyOk = Number(r.qty) > 0 && String(r.unit || '').trim()
  if (r.action === 'add') {
    if (!!r.item_id === !!r.sub_recipe_id) return 'Pick the item or prep recipe it adds'
    if (!qtyOk) return 'Say how much it adds and in what unit'
  }
  if (r.action === 'remove' && !r.item_id) return 'Pick the item it takes out'
  if (r.action === 'swap') {
    if (!r.item_id || !r.swap_item_id) return 'Pick the item it swaps and what for'
    if (r.item_id === r.swap_item_id) return 'An item can\'t be swapped for itself'
    if (hasQty !== !!String(r.unit || '').trim()) return 'Give the swap a quantity and a unit, or neither (the same quantity)'
    if (hasQty && !(Number(r.qty) > 0)) return 'A quantity is more than 0'
  }
  if (r.action === 'scale' && !(Number(r.factor) > 0 && Number(r.factor) <= 20)) return 'A scale is more than 0 and at most 20 (large: 1.5)'
  if (r.action === 'recipe') {
    if (!r.recipe_id) return 'Pick the recipe it is'
    if (hasQty && !(Number(r.qty) > 0)) return 'Portions are more than 0'
  }
  return null
}

// ── What a dish costs ─────────────────────────────────────────
//
// ctx: loadCosting()'s (recipes, items, prices at ctx.venueId on ctx.basis)
// with what is sold: links (recipe_links rows), rules (recipe_option_rules
// rows), options (Map option id -> { id, label, group_id, group_name,
// variation_type, price_mode, price_pence }), dishes (Map dish id -> the
// menu dish with item_type, variants, combo: dishMap()), names ({ venues,
// streams, types } id -> name), goods (Map barcode -> inventory item, for
// the goods offer) and combo ({ itemsById, sectionItems }: a meal deal's
// dishes, menuCtx()). Loaded once per request (services/dishCostSvc.js).

/** The dishes of some menus (loadMenuFull() shape): Map id -> dish with its resolved type, section and menu. */
export function dishMap(menus, into = null) {
  const out = new Map(into instanceof Map ? into : Object.entries(into || {}))
  for (const m of menus || []) {
    for (const s of m?.sections || []) {
      for (const i of s.items || []) {
        out.set(i.id, { ...i, item_type: itemType(i, s, m), section_id: s.id, section: s.title ?? null, menu_id: m.id, menu: m.name ?? null })
      }
    }
  }
  return out
}

const prefixOf = p => (p && Object.prototype.hasOwnProperty.call(PREFIX_FACTORS, p) ? p : null)
const optionWords = (prefix, label) => (prefix ? PREFIX_WORDS[prefix] + ' ' + String(label || '').toLowerCase() : String(label || ''))

/** One line costed on its own (an option's line): recipeCost() of a one-line recipe, never remembered. */
function oneLine(line, ctx, label) {
  return recipeCost({ id: null, kind: 'dish', portions: 1, name: label, lines: [{ id: 'option', sort_order: 0, yield_pct: null, ...line }] }, ctx)
}

const dishGap = (reason, text, fix, extra = {}) => ({ reason, text, fix, ...extra })

/** The option a pick names: the library's, or the dish's own by label. */
function optionOf(sel, dish, ctx) {
  const own = ownOptionLabel(sel.option_id)
  if (own != null) {
    const v = (dish.variants || []).find(x => lower(x.label) === lower(own))
    return { id: sel.option_id, label: v?.label ?? own, own: true, found: !!v, variation_type: null, price_mode: 'base', price_pence: v?.price_pence ?? null }
  }
  const o = get(ctx.options, sel.option_id)
  return o ? { ...o, own: false, found: true } : { id: sel.option_id, label: sel.label || 'An option', own: false, found: false }
}

/** The recipe's lines (as served) that are the option's: by the rule's items, else by the option's name. */
function ownLinesOf(work, rule, opt) {
  const recipeLines = work.filter(w => w.from === 'recipe' && w.mult > 0)
  if (rule) {
    const ids = ['add', 'remove', 'swap'].includes(rule.action) ? [rule.item_id, rule.sub_recipe_id].filter(Boolean) : []
    return { lines: recipeLines.filter(w => ids.includes(w.item_id) || ids.includes(w.sub_recipe_id)), by: 'rule' }
  }
  return { lines: recipeLines.filter(w => namesOption(opt.label, w.name)), by: 'name' }
}

// An option names a recipe line's item when every word of it is a word of
// the item's name (Onion: Red onion; Tomatoes: Tomato), or the names match
// (nameScore() at AUTO_MATCH).
const stem = w => (w.length > 3 && w.endsWith('es') ? w.slice(0, -2) : w.length > 2 && w.endsWith('s') ? w.slice(0, -1) : w)
function namesOption(label, itemName) {
  if (!label || !itemName) return false
  const want = normName(label).split(' ').filter(Boolean).map(stem)
  const have = new Set(normName(itemName).split(' ').filter(Boolean).map(stem))
  return (want.length > 0 && want.every(w => have.has(w))) || nameScore(label, itemName) >= AUTO_MATCH
}

const workCost = work => work.reduce((s, w) => (w.cost == null ? s : s + w.cost * w.mult), 0)
// An option's one line as bought (oneLine()'s), for usage: { bought, problem }.
const boughtOf = c => {
  const l = c.lines[0]
  return { bought: l?.bought_qty ?? null, problem: l?.bought_qty == null ? (l?.problem || 'missing') : null }
}

/**
 * One option applied to the dish's lines as served (work: [{ from: 'recipe'
 * | 'option', item_id, sub_recipe_id, name, qty, unit, cost, mult }]);
 * returns its step for the explanation and pushes any gaps.
 */
function applyOption(work, sel, dish, ctx, gaps) {
  const opt = optionOf(sel, dish, ctx)
  const prefix = prefixOf(sel.prefix)
  const times = Math.max(1, Math.trunc(num(sel.qty || 1)))
  const label = (times > 1 ? times + ' x ' : '') + optionWords(prefix, opt.label)
  const before = workCost(work)
  const done = (text, extra = {}) => ({ kind: 'option', label, option_id: opt.id, prefix, text, amount: round6(workCost(work) - before), rule: null, ...extra })
  if (!opt.found) {
    gaps.push(dishGap('option_gone', label + ' is no longer an option of ' + (dish.name || 'the dish'), 'Pick the options again, or take it off.', { option_id: opt.id }))
    return done('not found')
  }
  const hit = ruleFor(dish.id, opt, ctx.rules)
  const rule = hit?.rule || null
  const words = rule ? ruleText(rule, ctx) : null
  const pf = prefix ? PREFIX_FACTORS[prefix] : 1
  const fix = 'Give ' + opt.label + ' a rule on the Recipes page, Options tab.'
  const own = ownLinesOf(work, rule, opt)
  // A prefix (No, Light, Extra) on lines the recipe has: those lines change, nothing is added.
  if (prefix && prefix !== 'side' && own.lines.length && (!rule || rule.action === 'add' || rule.action === 'remove')) {
    for (const w of own.lines) w.mult *= pf
    return done(own.lines.map(w => w.name).join(', ') + (pf === 0 ? ' taken out' : ' x ' + fmtNum(pf)) + (own.by === 'name' ? ' (found by its name)' : ''), { rule: words })
  }
  if (!rule) {
    if (prefix && prefix !== 'side') {
      gaps.push(dishGap('no_rule', label + ': nothing in the recipe is called ' + opt.label, fix + ' Say which item it is.', { option_id: opt.id }))
      return done('no rule')
    }
    const d = optionDefault(opt)
    if (d.state === 'gap') {
      gaps.push(dishGap('no_rule', d.type === 'side' ? opt.label + ' is a side with no recipe linked' : opt.label + ' adds to the dish, but has no rule saying what', fix, { option_id: opt.id }))
      return done('no rule')
    }
    return done(d.text)
  }
  const fromRule = { rule: words, from: hit.from }
  if (prefix === 'no' && rule.action !== 'remove') return done('nothing: ' + words.toLowerCase() + ', but No', fromRule)
  switch (rule.action) {
    case 'scale': {
      const k = num(rule.factor) > 0 ? num(rule.factor) : 1
      for (const w of work) if (w.from === 'recipe') w.mult *= k
      return done('the recipe x ' + fmtNum(k, 3), fromRule)
    }
    case 'remove': {
      if (!own.lines.length) return done('no ' + (get(ctx.items, rule.item_id)?.name || 'such item') + ' in the recipe to take out', fromRule)
      const m = prefix === 'light' ? 0.5 : prefix === 'extra' ? 2 : 0
      for (const w of own.lines) w.mult *= m
      return done(own.lines.map(w => w.name).join(', ') + (m === 0 ? ' taken out' : ' x ' + fmtNum(m)), fromRule)
    }
    case 'swap': {
      const to = get(ctx.items, rule.swap_item_id)
      if (!own.lines.length) return done('no ' + (get(ctx.items, rule.item_id)?.name || 'such item') + ' in the recipe to swap', fromRule)
      const stated = rule.qty != null && rule.qty !== ''
      for (const w of own.lines) {
        const qty = stated ? num(rule.qty) : w.qty * w.mult
        const unit = stated ? rule.unit : w.unit
        const c = oneLine({ item_id: rule.swap_item_id, qty, unit }, ctx, label)
        for (const g of c.gaps) gaps.push(dishGap(g.reason, label + ': ' + g.text, g.fix, { option_id: opt.id }))
        work.push({ from: 'recipe', item_id: rule.swap_item_id, sub_recipe_id: null, name: to?.name || null, qty, unit, cost: c.cost, mult: pf, yield_pct: c.lines[0]?.yield_pct ?? null, ...boughtOf(c) })
        w.mult = 0
      }
      return done((own.lines[0].name || 'it') + ' for ' + (to?.name || 'another item') + (pf !== 1 ? ' x ' + fmtNum(pf) : ''), fromRule)
    }
    case 'add': {
      const qty = num(rule.qty) * times * pf
      const c = oneLine({ item_id: rule.item_id || null, sub_recipe_id: rule.sub_recipe_id || null, qty, unit: rule.unit }, ctx, label)
      for (const g of c.gaps) gaps.push(dishGap(g.reason, label + ': ' + g.text, g.fix, { option_id: opt.id }))
      const thing = rule.sub_recipe_id ? get(ctx.recipes, rule.sub_recipe_id) : get(ctx.items, rule.item_id)
      work.push({ from: 'option', item_id: rule.item_id || null, sub_recipe_id: rule.sub_recipe_id || null, name: thing?.name || null, qty, unit: rule.unit, cost: c.cost, mult: 1, yield_pct: c.lines[0]?.yield_pct ?? null, ...boughtOf(c) })
      return done('adds ' + qtyText(qty, rule.unit) + ' ' + (thing?.name || 'of something that is gone'), fromRule)
    }
    case 'recipe': {
      const side = get(ctx.recipes, rule.recipe_id)
      const portions = num(rule.qty || 1) * times * pf
      if (!side) {
        gaps.push(dishGap('missing', label + ': its recipe is gone', fix, { option_id: opt.id }))
        return done('its recipe is gone', fromRule)
      }
      // A portion is a dish recipe's: a prep recipe's unit is a litre or a kilo of the batch.
      if (side.kind !== 'dish') {
        gaps.push(dishGap('not_dish', label + ': ' + side.name + ' is a prep recipe, so it has no portion', 'Make the rule another dish recipe, or Adds ' + side.name + ' with how much.', { option_id: opt.id, recipe_id: side.id }))
        return done(side.name + ' is a prep recipe: nothing added', fromRule)
      }
      const rc = recipeCost(side, ctx)
      if (rc.per_unit == null) gaps.push(dishGap('option_recipe', label + ': ' + side.name + ' can\'t be costed yet', 'Open ' + side.name + ' and fix its gaps.', { option_id: opt.id, recipe_id: side.id }))
      else if (rc.gaps.length) gaps.push(dishGap('option_recipe', label + ': ' + side.name + ' is only partly costed', 'Open ' + side.name + ' and fix its gaps.', { option_id: opt.id, recipe_id: side.id }))
      work.push({ from: 'option', item_id: null, sub_recipe_id: null, recipe_id: side.id, name: side.name, qty: portions, unit: 'portion', cost: rc.per_unit == null ? null : rc.per_unit * portions, mult: 1, bought: portions, problem: null })
      return done(fmtNum(portions) + ' x ' + side.name, fromRule)
    }
    default:
      return done('changes nothing', fromRule)
  }
}

/**
 * A picked dish's options as dishCost() takes them: its own list
 * ([{ option_id, prefix, qty }]), a till line's combo part's modifiers
 * ([{ option_id, prefix }], shared/pos/pricing.js), or a basket's choices
 * ({ groupKey: [optionId, ...] }, an id once per pick; shared/orderPricing.js).
 */
function pickOptions(p) {
  if (Array.isArray(p.options)) return p.options
  if (Array.isArray(p.modifiers)) return p.modifiers.filter(m => m && m.option_id).map(m => ({ option_id: m.option_id, prefix: m.prefix || null }))
  if (p.choices && typeof p.choices === 'object') return Object.values(p.choices).flat().filter(Boolean).map(id => ({ option_id: String(id) }))
  return []
}

/**
 * Meal deal picks as a flat list [{ dish_id, options }]: from a list
 * ([{ dish_id, options }], or a till line's combo parts [{ item_id,
 * modifiers }]), or a basket's / the till's selection { stepId: [{ item_id,
 * choices }] }. A typed-in choice (no dish) is left out.
 */
export function flatPicks(picks) {
  if (Array.isArray(picks)) return picks.filter(p => p && (p.dish_id || p.item_id)).map(p => ({ dish_id: p.dish_id || p.item_id, options: pickOptions(p) }))
  if (picks && typeof picks === 'object') return Object.values(picks).flat().filter(p => p && p.item_id).map(p => ({ dish_id: p.item_id, options: pickOptions(p) }))
  return []
}

const coverageOf = (cost, gaps) => (cost == null ? 'none' : gaps.length ? 'partial' : 'full')

// The menus' dishes as the combo rules read them (shared/combos.js stepChoices()).
function comboCtx(ctx) {
  if (ctx.combo) return ctx.combo
  const dishes = ctx.dishes instanceof Map ? Object.fromEntries(ctx.dishes) : (ctx.dishes || {})
  return { itemsById: dishes, sectionItems: {} }
}

/**
 * A meal deal's typical picks (phase 5, docs/INVENTORY.md 5.4 and 7): each
 * step's dishes guests pick most (ctx.pickMix: { dealId: { stepId: { dishId:
 * qty } } }, from sales; pickMix() builds it), else the step's first choices
 * in menu order, as many as the step asks for (its min, the same dish again
 * in a step that repeats). A step shown only after another's pick, or one a
 * guest may skip, adds none. [{ dish_id, options: [], step_id }]. What a
 * mapped deal from another till takes off stock, and the deal's typical cost.
 */
export function typicalPicks(dish, ctx = {}) {
  const combo = comboOf(dish)
  if (!combo) return []
  const mctx = comboCtx(ctx)
  const mix = get(ctx.pickMix, dish.id) || {}
  const out = []
  for (const step of combo.steps || []) {
    const n = step.when ? 0 : Math.max(0, Math.trunc(num(step.min)))
    if (!n) continue
    const choices = stepChoices(step, { ...mctx, soldOut: null, selfId: dish.id }).filter(c => c.item_id)
    if (!choices.length) continue
    const sold = mix[step.id] || {}
    const ranked = choices.map((c, i) => ({ c, i, q: num(sold[c.item_id]) })).sort((a, b) => b.q - a.q || a.i - b.i).map(x => x.c)
    const picked = step.repeat ? Array(n).fill(ranked[0]) : ranked.slice(0, n)
    for (const c of picked) out.push({ dish_id: c.item_id, options: [], step_id: step.id })
  }
  return out
}

/** ctx.pickMix from sold picks: rows [{ deal_id, step_id, dish_id, qty }] -> { dealId: { stepId: { dishId: qty } } }. */
export function pickMix(rows = []) {
  const out = {}
  for (const r of rows || []) {
    if (!r?.deal_id || !r.step_id || !r.dish_id) continue
    const step = ((out[r.deal_id] ||= {})[r.step_id] ||= {})
    step[r.dish_id] = (step[r.dish_id] || 0) + num(r.qty || 1)
  }
  return out
}

/**
 * Options kept by their words (an online order's: [{ group, label, qty? }],
 * "2 x Cheese" for two) as the dish's options now: each matched by its label
 * within the dish's group of that name, else anywhere in the dish when only
 * one option has that label. { options: [{ option_id, qty }], unmatched:
 * [{ group, label }] }. A renamed or removed option can't be matched.
 */
export function matchOptions(dish, labelled = []) {
  const choices = dish ? itemChoices(dish, {}) : []
  const options = []
  const unmatched = []
  for (const o of labelled || []) {
    if (!o || !String(o.label || '').trim()) continue
    const m = /^(\d+)\s*x\s+(.+)$/i.exec(String(o.label).trim())
    const label = lower(m ? m[2] : o.label)
    const qty = num(o.qty) > 0 ? num(o.qty) : m ? Number(m[1]) : 1
    const groups = o.group ? choices.filter(c => lower(c.name) === lower(o.group)) : []
    const hits = (groups.length ? groups : choices).flatMap(c => c.options.filter(x => lower(x.label) === label))
    if (hits.length === 1 || (hits.length > 1 && groups.length)) options.push({ option_id: hits[0].id, qty })
    else unmatched.push({ group: o.group ?? null, label: o.label })
  }
  return { options, unmatched }
}

// ── Usage: what a sale takes off stock (phase 5) ─────────────────

// A dish's own gaps that leave what it takes off unknown (the rest, a price
// missing, change only its cost). A recipe's are read from recipeCost().
const USAGE_DISH_GAPS = new Set(['no_recipe', 'not_dish', 'no_rule', 'option_gone', 'no_picks', 'custom_choice'])
const LINE_QTY_PROBLEMS = new Set(['missing', 'no_unit', 'cycle', 'too_deep', 'no_yield'])
const RECIPE_QTY_GAPS = new Set(['empty', 'no_yield', 'draft'])

// The usable share of a line bought at its yield (phase 8b's trace quantity): 1 with none.
const eatOf = y => (y == null || y === '' || !(Number(y) > 0) ? 1 : Number(y) / 100)

/** A recipe's gaps that change what it takes off: its own (nothing in it, no yield, not checked) and lines with no quantity. */
function qtyGapsOf(rc, recipe, note) {
  for (const g of rc.gaps) {
    if (g.line == null) {
      if (RECIPE_QTY_GAPS.has(g.reason)) note({ reason: g.reason, text: g.text, fix: g.fix, recipe_id: recipe.id })
    } else if (rc.lines[g.line]?.bought_qty == null) {
      note({ reason: g.reason, text: recipe.name + ': ' + g.text, fix: g.fix, recipe_id: recipe.id })
    }
  }
}

/**
 * A batch of a recipe broken into items, on recipeCost()'s own lines (the
 * one walk: each line as bought after its yield, a prep recipe inside by its
 * yield less its loss). qty in what the recipe makes (its yield unit, or
 * portions). add(itemId, qty), note(gap).
 * tr (the allergen roll-up, inventory phase 8a, shared/allergenCheck.js):
 * { trace: { item(entry), recipe(recipe, via) }, via, from } also hears of
 * every item line and recipe on the way, its quantity known or not (an
 * ingredient is in the dish even with no size for its unit); qty null walks
 * for the trace only, adding and noting nothing. Without tr the walk is
 * exactly as it was.
 * Phase 8b (calories, shared/calorieCheck.js): each traced item line also
 * carries qty, what goes into the dish of it (the line's usable quantity in
 * the item's base unit, before its yield is bought: the trimmed onion, not
 * the one with its skin), its share of the batch, or null when not known;
 * tr.eat is the usable share of the batch above (a prep recipe's line yield).
 * Never a fourth walk: the cost, usage, allergens and calories all hear this one.
 */
function batchItems(recipe, qty, ctx, add, note, stack = [], tr = null) {
  const rc = recipeCost(recipe, ctx)
  const counting = qty != null
  if (counting) qtyGapsOf(rc, recipe, note)
  if (tr?.trace.recipe) tr.trace.recipe(recipe, tr.via)
  const f = counting && rc.makes > 0 ? num(qty) / rc.makes : null
  if (f == null && !tr) return
  for (const l of rc.lines) {
    if (l.kind === 'item') {
      if (tr && l.item_id) {
        tr.trace.item({ item_id: l.item_id, via: tr.via, from: tr.from || 'recipe', qty: f != null && l.base_qty != null ? l.base_qty * f * (tr.eat ?? 1) : null })
      }
      if (l.bought_qty != null && f != null) add(l.item_id, l.bought_qty * f)
      continue
    }
    const sub = get(ctx.recipes, l.sub_recipe_id)
    if (!sub) continue
    const subQty = l.bought_qty != null && f != null ? l.bought_qty * f : null
    if (subQty == null && !tr) continue
    if (sub.id === recipe.id || stack.includes(sub.id)) {
      if (subQty != null) note({ reason: 'cycle', text: sub.name + ' is inside itself', fix: FIX.cycle(sub.name), recipe_id: recipe.id })
      continue
    }
    if (stack.length + 1 >= MAX_DEPTH) {
      if (subQty != null) note({ reason: 'too_deep', text: sub.name + ' is nested more than ' + MAX_DEPTH + ' levels down', fix: FIX.too_deep(), recipe_id: recipe.id })
      continue
    }
    batchItems(sub, subQty, ctx, add, note, [...stack, recipe.id], tr && { ...tr, via: [...tr.via, sub.name], eat: (tr.eat ?? 1) * eatOf(l.yield_pct) })
  }
}
const NOOP = () => {}

const round4 = n => Math.round(Number(n) * 10000) / 10000
function usageAcc() {
  const acc = new Map()
  const uncosted = []
  return {
    add: (id, q) => { if (id && Number.isFinite(q) && q !== 0) acc.set(id, (acc.get(id) || 0) + q) },
    note: g => { if (g && g.text && !uncosted.some(x => x.text === g.text)) uncosted.push(g) },
    items: () => [...acc.entries()].map(([item_id, q]) => ({ item_id, qty_base: round4(q) })).filter(i => i.qty_base !== 0),
    uncosted,
  }
}

/**
 * A batch of a prep recipe (2 l of sauce) as items bought: { items:
 * [{ item_id, qty_base }], uncosted: [{ reason, text, fix }] }. qty in what
 * the recipe makes. The waste of a batch (itemsOf() in shared/stockItems.js).
 * trace (phase 8a): as batchItems()'s, for a recipe's own allergens (qty
 * null: the walk only).
 */
export function recipeUsage(recipe, qty, ctx = {}, { trace = null } = {}) {
  const a = usageAcc()
  if (recipe) batchItems(recipe, qty, ctx, a.add, a.note, [], trace ? { trace, via: [recipe.name] } : null)
  return { items: a.items(), uncosted: a.uncosted }
}

// Options kept by their words (an online order's) as ids; the ones not matched are gaps.
function idOptions(dish, options, note) {
  const list = (options || []).filter(Boolean)
  const labelled = list.filter(o => !o.option_id && o.label)
  if (!labelled.length) return list
  const m = matchOptions(dish, labelled)
  for (const u of m.unmatched) {
    note({
      reason: 'option_label', text: (dish?.name || 'A dish') + ': "' + u.label + '"' + (u.group ? ' (' + u.group + ')' : '') + ' is not one of its options now',
      fix: 'An online order keeps its options by name: one renamed or taken off the menu since can\'t be matched, so what it adds is left out. Name it as it was, or leave it.',
    })
  }
  return [...list.filter(o => o.option_id), ...m.options]
}

/**
 * What one sold dish takes off stock (docs/INVENTORY.md 7; phase 5), by the
 * same walk as its cost: dishCost() at the sale's scope (the recipe
 * recipeFor() picks for its venue, revenue stream and order type, times the
 * link's portions, each option's rule and prefix, a meal deal's picks), each
 * line as bought (its yield), prep recipes inside by their yield and loss
 * (recipeCost()'s lines).
 * sold: { dish_id, qty, options (ids: [{ option_id, prefix, qty }], a till
 * line's modifiers; or words: [{ group, label }], an online order's), picks
 * (a deal's: a till line's combo, a list, an online order's parts with their
 * options' words), typical (a deal with no picks takes its typical picks,
 * typicalPicks(); default true, false for waste logged by hand) }. scope: {
 * venue_id, revenue_stream_id, order_type_id }. ctx: the dish costing ctx.
 * Returns { dish_id, name, kind, qty, items: [{ item_id, qty_base }] (each
 * item once, 4 decimals), uncosted: [{ reason, text, fix }] (what left its
 * quantities unknown: no recipe, an option with no rule or not matched, a
 * unit with no size; and a draft Pepper wrote, still counted: it is the best
 * recipe known), recipe ({ id, name, status } or null; a deal's first
 * part's), cost (dishCost()'s at ctx's prices and basis, times qty: the sum
 * of each item's qty x its cost per base unit), coverage, typical (true when
 * a deal's picks were its typical ones), picks }. A dish with no recipe
 * takes nothing off; a service needs none.
 * trace (the allergen roll-up, inventory phase 8a, shared/allergenCheck.js):
 * { item({ item_id, via, from }), recipe(recipe, via) } hears of every item
 * line on the same walk (via: the recipes above it, the dish's first; from:
 * 'option' for what an option's rule adds) and every recipe walked, whether
 * the line's quantity is known or not. Without it nothing changes.
 * Phase 8b: each item entry also has qty (what goes into the sale of it:
 * the usable base quantity, its yield taken back off what is bought; null
 * when not known), for the calories (shared/calorieCheck.js).
 */
export function usageOf(sold = {}, scope = {}, ctx = {}, { trace = null } = {}) {
  const a = usageAcc()
  const n = sold.qty == null || sold.qty === '' ? 1 : num(sold.qty)
  const top = {
    dish_id: sold.dish_id ?? null, name: get(ctx.dishes, sold.dish_id)?.name || 'A dish that is gone', kind: 'dish',
    qty: n, items: [], uncosted: a.uncosted, recipe: null, cost: null, coverage: 'none', typical: false, picks: null,
  }
  let costed = 0
  let anyCost = false
  let allFull = true
  const one = (dishId, times, options, picks, depth) => {
    const dish = get(ctx.dishes, dishId)
    if (dish && isCombo(dish)) {
      // A meal deal: its picks' dishes, each with its own options (by their words for an online order's parts).
      if (!depth) top.kind = 'deal'
      let parts = picks != null ? flatPicks(Array.isArray(picks) ? picks.filter(Boolean).map(p => (Array.isArray(p.options) && p.options.some(o => o && !o.option_id && o.label)
        ? { ...p, options: idOptions(get(ctx.dishes, p.dish_id || p.item_id), p.options, a.note) } : p)) : picks) : []
      if (!parts.length && picks == null && sold.typical !== false) {
        parts = typicalPicks(dish, ctx)
        if (parts.length && !depth) top.typical = true
      }
      if (!depth) top.picks = parts.map(p => ({ dish_id: p.dish_id, options: p.options || [] }))
      if (!parts.length) {
        a.note({ reason: 'no_picks', text: 'No dishes are known for ' + dish.name, fix: 'Give the meal deal\'s steps their dishes on the menu.', dish_id: dishId })
        allFull = false
        return
      }
      for (const p of parts) one(p.dish_id, times, p.options, null, depth + 1)
      return
    }
    const dc = dishCost(dishId, { options: idOptions(dish, options, a.note) }, scope, ctx)
    if (!depth) top.kind = dc.kind
    if (dc.kind === 'service') return
    if (dc.recipe && !top.recipe) top.recipe = { id: dc.recipe.id, name: dc.recipe.name, status: dc.recipe.status ?? null }
    if (dc.cost != null) { costed += dc.cost * times; anyCost = true }
    if (dc.coverage !== 'full') allFull = false
    for (const g of dc.gaps) {
      if (USAGE_DISH_GAPS.has(g.reason) || (g.reason === 'missing' && (!dc.recipe || g.option_id)) || (g.option_id && LINE_QTY_PROBLEMS.has(g.reason))) {
        a.note({ reason: g.reason, text: g.text, fix: g.fix, ...(g.option_id ? { option_id: g.option_id } : {}), dish_id: dishId })
      }
    }
    if (!dc.recipe || dc.recipe.kind !== 'dish') return
    const recipe = get(ctx.recipes, dc.recipe.id)
    if (recipe) qtyGapsOf(recipeCost(recipe, ctx), recipe, a.note)
    if (recipe && trace?.recipe) trace.recipe(recipe, [recipe.name])
    for (const l of dc.lines) {
      // The trace hears of every line, its quantity known or not; an option's own line has no recipe above it.
      const via = l.from === 'option' ? [] : [dc.recipe.name]
      if (l.item_id) {
        if (trace) trace.item({ item_id: l.item_id, via, from: l.from, qty: l.bought != null ? l.bought * times * eatOf(l.yield_pct) : null })
        if (l.bought != null) a.add(l.item_id, l.bought * times)
        continue
      }
      const sub = get(ctx.recipes, l.sub_recipe_id || l.recipe_id)
      if (!sub) continue
      const tr = trace ? { trace, via: [...via, sub.name], from: l.from, eat: eatOf(l.yield_pct) } : null
      if (l.bought != null) batchItems(sub, l.bought * times, ctx, a.add, a.note, [dc.recipe.id], tr)
      else if (tr) batchItems(sub, null, ctx, NOOP, NOOP, [dc.recipe.id], tr)
    }
  }
  one(sold.dish_id, n, sold.options, sold.picks ?? null, 0)
  top.items = a.items()
  top.cost = anyCost ? round6(costed) : null
  top.coverage = top.kind === 'service' ? 'not_needed' : !anyCost ? 'none' : allFull && !a.uncosted.length ? 'full' : 'partial'
  return top
}

/** A meal deal: the sum of the dishes picked, or the range over its choices when the picks aren't known. */
function dealCost(dish, selection, scope, ctx, out) {
  out.kind = 'deal'
  const picks = selection.picks != null ? flatPicks(selection.picks) : null
  if (picks) {
    let total = 0
    let costed = 0
    for (const p of picks) {
      const c = dishCost(p.dish_id, { options: p.options }, scope, ctx)
      out.parts.push({ dish_id: p.dish_id, name: c.name, cost: c.cost, coverage: c.coverage, why: c.why, recipe: c.recipe })
      for (const g of c.gaps) out.gaps.push({ ...g, text: c.name + ': ' + g.text, dish_id: p.dish_id })
      if (c.cost != null) { total += c.cost; costed++ }
      out.steps.push({ kind: 'part', label: c.name, text: c.recipe ? c.recipe.name + ', for ' + c.why : 'no recipe', amount: c.cost })
    }
    if (!picks.length) out.gaps.push(dishGap('no_picks', 'No dishes were picked in ' + dish.name, 'Pick its dishes.'))
    out.cost = costed ? round6(total) : null
    out.min = out.max = out.cost
    out.coverage = coverageOf(out.cost, out.gaps)
    return out
  }
  // The picks aren't known (a margins page): the least and the most it can cost.
  const combo = comboOf(dish)
  const mctx = comboCtx(ctx)
  let lo = 0, hi = 0, any = false
  for (const step of combo?.steps || []) {
    const choices = stepChoices(step, { ...mctx, soldOut: null, selfId: dish.id })
    const costs = []
    for (const c of choices) {
      if (!c.item_id) {
        out.gaps.push(dishGap('custom_choice', step.name + ': ' + (c.label || 'a typed-in choice') + ' is no dish, so it has no recipe', 'Make it a dish on the menu to cost it.'))
        continue
      }
      const d = dishCost(c.item_id, {}, scope, ctx)
      if (d.cost == null) {
        if (d.coverage !== 'not_needed') out.gaps.push(dishGap('part_uncosted', step.name + ': ' + d.name + ' can\'t be costed', d.gaps[0]?.fix || 'Link it to its recipe.', { dish_id: c.item_id }))
        continue
      }
      if (d.gaps.length) out.gaps.push(dishGap('part_partial', step.name + ': ' + d.name + ' is only partly costed', d.gaps[0]?.fix || 'Fix its gaps.', { dish_id: c.item_id }))
      // What the guest pays on top for this choice in the deal (0 = included).
      costs.push({ dish_id: c.item_id, name: d.name, cost: d.cost, upcharge_pence: Math.max(0, Math.round(num(c.price_pence))) })
    }
    costs.sort((a, b) => a.cost - b.cost)
    const take = (n, dearest) => {
      if (!costs.length || n <= 0) return 0
      const list = dearest ? [...costs].reverse() : costs
      return step.repeat ? list[0].cost * n : list.slice(0, n).reduce((s, x) => s + x.cost, 0)
    }
    // A step shown only after another's pick, or one a guest may skip, adds nothing to the least.
    const pickMin = step.when ? 0 : step.min
    const stepLo = take(pickMin, false)
    const stepHi = take(step.max, true)
    if (costs.length) any = true
    lo += stepLo
    hi += stepHi
    // costs, pick_min, pick_max, repeat: what dealRange() needs to pair each pick's cost with its extra charge.
    out.parts.push({
      step: step.name, min: round6(stepLo), max: round6(stepHi), choices: choices.length, costed: costs.length,
      pick_min: pickMin, pick_max: step.max, repeat: !!step.repeat, costs,
    })
    const counted = costs.length + ' of ' + choices.length + ' choices costed'
    // plain: the step without money, for people without Costing view.
    out.steps.push({
      kind: 'part', label: step.name, amount: null,
      text: costs.length ? pounds(stepLo) + ' to ' + pounds(stepHi) + ' (' + counted + ')' : 'no choice costed',
      plain: costs.length ? counted : 'no choice costed',
    })
  }
  out.min = any ? round6(lo) : null
  out.max = any ? round6(hi) : null
  // The typical cost (phase 5): the dishes guests pick most (ctx.pickMix, from sales), else each step's first.
  const tp = typicalPicks(dish, ctx)
  out.typical = tp.length ? dishCost(dish.id, { picks: tp }, scope, ctx).cost : null
  out.typical_picks = tp
  out.cost = null
  out.coverage = coverageOf(out.max, out.gaps)
  return out
}

/**
 * What a dish costs at a scope: { dish_id, name, kind: 'dish' | 'deal' |
 * 'goods' | 'service', recipe: { id, name, kind, variant_of, status } |
 * null, why, link_id, portions, cost, min, max (a deal without its picks),
 * typical (a deal without its picks: the cost of its typical picks,
 * typicalPicks(), with typical_picks), recipe_per_portion, lines (as served, with
 * the options applied), steps: [{ kind, label, text, plain?, amount }]
 * (plain: the text without money, where text has some), gaps: [{ reason,
 * text, fix }], coverage: 'full' | 'partial' | 'none' | 'not_needed' (a
 * service), parts (a deal), goods_item (a goods dish with no recipe whose
 * barcode is an inventory item's: { id, name }) }. A link to a prep recipe
 * (one made prep after it was linked) is a gap, never a portion of the batch.
 * selection: { options: [{ option_id, prefix, qty }], picks } (picks: a
 * deal's dishes, [{ dish_id, options }], a till line's combo parts [{ item_id,
 * modifiers }], or a basket's selection.combo { stepId: [{ item_id, choices }] }).
 * Costs are at ctx.venueId's prices on ctx.basis: load the ctx for the
 * scope's venue.
 */
export function dishCost(dishId, selection = {}, scope = {}, ctx = {}) {
  const dish = get(ctx.dishes, dishId)
  const out = {
    dish_id: dishId, name: dish?.name || 'A dish that is gone', kind: 'dish', recipe: null, why: null, link_id: null, portions: null,
    cost: null, min: null, max: null, typical: null, recipe_per_portion: null, lines: [], steps: [], gaps: [], coverage: 'none', parts: [], goods_item: null,
  }
  if (!dish) {
    out.gaps.push(dishGap('missing', 'This dish is on no menu', 'Take it off, or put it back on a menu.'))
    return out
  }
  if (isCombo(dish)) return dealCost(dish, selection || {}, scope, ctx, out)
  const type = dish.item_type || 'food'
  if (type === 'service') {
    out.kind = 'service'
    out.coverage = 'not_needed'
    out.steps.push({ kind: 'note', label: dish.name, text: 'a service: no recipe, no stock', amount: null })
    return out
  }
  if (type === 'goods') out.kind = 'goods'
  const pick = recipeFor(dish.id, scope, ctx.links, { names: ctx.names })
  if (!pick) {
    const goods = type === 'goods' && dish.barcode ? get(ctx.goods, dish.barcode) : null
    if (goods) out.goods_item = { id: goods.id, name: goods.name }
    out.gaps.push(dishGap('no_recipe', dish.name + ' has no recipe linked',
      goods ? 'Link it to ' + goods.name + ' (the stock item with the same barcode) on the Recipes page, Dishes tab.'
        : 'Link it to its recipe on the Recipes page, Dishes tab.'))
    out.steps.push({ kind: 'gap', label: dish.name, text: 'no recipe linked', amount: null })
    return out
  }
  out.why = pick.why
  out.link_id = pick.link.id ?? null
  const portions = num(pick.link.portions) > 0 ? num(pick.link.portions) : 1
  out.portions = portions
  const recipe = get(ctx.recipes, pick.link.recipe_id)
  if (!recipe) {
    out.gaps.push(dishGap('missing', 'Its recipe is gone', 'Link it to a recipe again.'))
    return out
  }
  out.recipe = { id: recipe.id, name: recipe.name, kind: recipe.kind, variant_of: recipe.variant_of ?? null, status: recipe.status ?? null }
  // A dish is portions of a dish recipe. A prep recipe's unit is a litre or a
  // kilo of the batch, not a serving: one linked as a dish (made prep since)
  // can't be costed per portion.
  if (recipe.kind !== 'dish') {
    out.gaps.push(dishGap('not_dish', recipe.name + ' is a prep recipe, so it has no portion: a dish links to a dish recipe',
      'Link ' + dish.name + ' to a dish recipe on the Recipes page, Dishes tab (a prep recipe goes inside one).', { recipe_id: recipe.id }))
    out.steps.push({ kind: 'gap', label: recipe.name, text: 'a prep recipe, not a dish recipe', amount: null })
    return out
  }
  const rc = recipeCost(recipe, ctx)
  out.recipe_per_portion = rc.per_unit
  const f = portions / (recipeMakes(recipe) || 1)
  // The dish's lines as served: each recipe line's share of one serving.
  // yield_pct: the yield the line is bought at (its own, else its item's; 100 for a prep recipe
  // with none), for what a dish takes off stock (itemsOf() in shared/stock.js).
  // bought: the line as bought (recipeCost()'s bought_qty: the item's base unit after its yield, or a
  // prep recipe's own unit), what usage from sales takes off (usageOf()); null with the line's problem.
  const work = rc.lines.map(l => ({
    from: 'recipe', item_id: l.item_id || null, sub_recipe_id: l.sub_recipe_id || null, name: l.name,
    qty: num(l.qty) * f, unit: l.unit, cost: l.cost == null ? null : l.cost * f, mult: 1, yield_pct: l.yield_pct ?? null,
    bought: l.bought_qty == null ? null : l.bought_qty * f, problem: l.bought_qty == null ? l.problem : null,
  }))
  for (const g of rc.gaps) out.gaps.push(dishGap(g.reason, recipe.name + ': ' + g.text, g.fix, { recipe_id: recipe.id }))
  const partly = rc.coverage === 'partial' ? ' (partly costed)' : ''
  out.steps.push({
    kind: 'recipe', label: recipe.name,
    text: (rc.per_unit != null ? pounds(rc.per_unit) + ' a portion' + (portions !== 1 ? ' x ' + fmtNum(portions) : '') : 'not costed') + ', for ' + pick.why + partly,
    // plain: the step without money, for people without Costing view.
    plain: (portions !== 1 ? fmtNum(portions) + ' portions, ' : '') + 'for ' + pick.why + partly,
    amount: rc.per_unit == null ? null : round6(rc.per_unit * portions),
  })
  for (const sel of (selection?.options || []).filter(Boolean)) out.steps.push(applyOption(work, sel, dish, ctx, out.gaps))
  const anyCost = work.some(w => w.cost != null)
  out.cost = anyCost ? round6(workCost(work)) : null
  out.coverage = coverageOf(out.cost, out.gaps)
  out.lines = work.filter(w => w.mult > 0).map(w => ({
    from: w.from, item_id: w.item_id, sub_recipe_id: w.sub_recipe_id, recipe_id: w.recipe_id ?? null, name: w.name,
    qty: round6(w.qty * w.mult), unit: w.unit, cost: w.cost == null ? null : round6(w.cost * w.mult), yield_pct: w.yield_pct ?? null,
    bought: w.bought == null ? null : round6(w.bought * w.mult), problem: w.problem ?? null,
  }))
  if (out.cost != null) out.steps.push({ kind: 'total', label: 'Cost', text: out.coverage === 'full' ? 'fully costed' : 'partly costed: ' + out.gaps.length + (out.gaps.length === 1 ? ' gap' : ' gaps'), amount: out.cost })
  return out
}

// ── Margins and thresholds ────────────────────────────────────

export const DEFAULT_TARGET_PCT = 30
export const DEFAULT_LIMIT_PCT = 35
export const BANDS = {
  good: { label: 'On target', hint: 'At or below the target cost %.' },
  watch: { label: 'Over target', hint: 'Above the target, at or below the limit.' },
  over: { label: 'Over the limit', hint: 'Above the limit cost %.' },
}

/**
 * The target and limit cost % for a menu section: its own override, else the
 * group's (costing_settings), else 30 and 35. { target_pct, limit_pct, from }.
 */
export function thresholdsFor(settings, sectionId = null) {
  const own = sectionId ? (settings?.sections || []).find(s => s.section_id === sectionId) : null
  if (own) return { target_pct: num(own.target_pct), limit_pct: num(own.limit_pct), from: 'section' }
  if (settings && settings.target_pct != null) return { target_pct: num(settings.target_pct), limit_pct: num(settings.limit_pct), from: 'group' }
  return { target_pct: DEFAULT_TARGET_PCT, limit_pct: DEFAULT_LIMIT_PCT, from: 'default' }
}

/** A cost % against thresholds: 'good', 'watch', 'over', or null with no cost %. */
export function costBand(costPct, t = {}) {
  if (costPct == null || !Number.isFinite(Number(costPct))) return null
  const target = t.target_pct ?? DEFAULT_TARGET_PCT
  const limit = t.limit_pct ?? DEFAULT_LIMIT_PCT
  return Number(costPct) <= target ? 'good' : Number(costPct) <= limit ? 'watch' : 'over'
}

/** Why thresholds can't be saved, or null: 0 < target <= limit < 100. */
export function thresholdProblem(t) {
  const a = Number(t?.target_pct), b = Number(t?.limit_pct)
  if (!(a > 0 && a < 100) || !(b > 0 && b < 100)) return 'A cost % is more than 0 and less than 100'
  if (a > b) return 'The target can\'t be above the limit'
  return null
}

export const DISH_KINDS = { dish: 'Dish', deal: 'Meal deal', goods: 'Goods', service: 'Service' }

// ── A meal deal's range (phase 2 review) ──────────────────────
//
// A choice can cost the guest extra in a deal (a premium main +£4) and an
// optional step adds to the bill when picked (a dessert +£3). The cost % of
// some picks is their cost over what the guest pays for them: the deal's own
// price and those picks' extra charges. The figures below are each over the
// picks that give it, never the dearest picks' cost over the cheapest price.

/** For each step the picks that make sum(score) largest: pick_min of them, then more while one adds (repeat: the best one n times). */
function bestPicks(parts, score) {
  const out = []
  for (const p of parts || []) {
    const list = [...(p.costs || [])].sort((a, b) => score(b) - score(a))
    for (let i = 0; i < num(p.pick_max) && list.length; i++) {
      const c = p.repeat ? list[0] : list[i]
      if (!c || (i >= num(p.pick_min) && !(score(c) > 1e-9))) break
      out.push(c)
    }
  }
  return out
}

const pickTotals = (picks, basePence) => ({
  cost: round6(picks.reduce((s, c) => s + c.cost, 0)),
  gross: Math.round(num(basePence) + picks.reduce((s, c) => s + num(c.upcharge_pence), 0)),
  picks: picks.map(c => c.name),
  ids: picks.map(c => c.dish_id),
})

/**
 * The picks with the highest (most) or lowest cost over what they sell for,
 * by Dinkelbach's method: each round takes the picks that do best at the
 * last round's ratio, until no picks do better. Exact over the steps' picks.
 */
function ratioPicks(parts, basePence, most) {
  const sign = most ? 1 : -1
  let t = pickTotals(bestPicks(parts, c => sign * c.cost), basePence)
  for (let i = 0; i < 50 && t.gross > 0; i++) {
    const ratio = t.cost * 100 / t.gross
    const next = pickTotals(bestPicks(parts, c => sign * (c.cost * 100 - ratio * num(c.upcharge_pence))), basePence)
    if (!(sign * (next.cost * 100 - ratio * next.gross) > 1e-9)) break
    t = next
  }
  return t
}

/**
 * A meal deal's margin range from dishCost()'s parts (the range: no picks):
 * the lowest and highest cost %, and the least and most gross profit, each at
 * the picks that give it with what the guest pays for them. basePence: the
 * deal's price before any pick's extra charge. { pct_low, pct_high, gp_low,
 * gp_high }: margin() at those picks, each with `picks` (the dishes' names)
 * and `pick_ids` (their dish ids, a dish once per pick).
 */
export function dealRange(parts, basePence, vatRate = 0) {
  const at = t => ({ ...margin({ gross_pence: t.gross, vat_rate: vatRate, cost: t.cost }), cost: t.cost, picks: t.picks, pick_ids: t.ids })
  // Gross profit is the net (the price less its VAT: 100 / (100 + VAT) of it) less the cost.
  const k = 100 / (100 + num(vatRate))
  return {
    pct_low: at(ratioPicks(parts, basePence, false)),
    pct_high: at(ratioPicks(parts, basePence, true)),
    gp_low: at(pickTotals(bestPicks(parts, c => c.cost * 100 - k * num(c.upcharge_pence)), basePence)),
    gp_high: at(pickTotals(bestPicks(parts, c => k * num(c.upcharge_pence) - c.cost * 100), basePence)),
  }
}

/**
 * A meal deal at its typical picks (inventory phase 7a: scenarios and the
 * weighted figures at the real mix): the dishes guests pick most (ctx.pickMix
 * from sales, else each step's first: typicalPicks()), their cost
 * (dishCost().typical) and what those picks add to the bill (each choice's
 * extra charge in the deal), so the cost is paired with what the guest pays
 * for it (the rule dealRange() keeps). { cost, charge_pence, picks: [names] },
 * cost null when the picks can't be costed. mctx: the menu's combo ctx.
 */
export function dealTypical(item, scope, ctx, mctx = null) {
  const m = mctx || comboCtx(ctx)
  const dc = dishCost(item.id, {}, scope, ctx)
  const combo = comboOf(item)
  let charge = 0
  const names = []
  for (const p of dc.typical_picks || []) {
    const step = (combo?.steps || []).find(st => st.id === p.step_id)
    const choice = step ? stepChoices(step, { ...m, soldOut: null, selfId: item.id }).find(c => c.item_id === p.dish_id) : null
    charge += Math.max(0, Math.round(num(choice?.price_pence)))
    names.push(choice?.label || get(ctx.dishes, p.dish_id)?.name || 'a dish')
  }
  return { cost: dc.typical ?? null, charge_pence: charge, picks: names, gaps: dc.gaps }
}

/**
 * One dish's margin at a scope: its price there (the menu's price, as the
 * till and online price it: fromPrice(); a dish has one price on a menu, and
 * only its VAT changes with the venue, stream and order type), the VAT in it
 * (taxFor()), its cost (dishCost()) and margin(); a meal deal with the range
 * of its cost; each priced option with its own margin.
 */
export function dishMargin(item, section, menu, scope, ctx, { rates = [], settings = null, rules = null, mctx = null, withOptions = true } = {}) {
  const m = mctx || menuCtx(menu)
  const choices = itemChoices(item, rules || variantRules(menu))
  const price = fromPrice(item, choices, m)
  const tax = taxFor([item.tax, section?.tax, menu?.tax], scope, rates)
  const dc = dishCost(item.id, {}, scope, ctx)
  const t = thresholdsFor(settings, section?.id ?? null)
  const row = {
    dish_id: item.id, name: item.name, section_id: section?.id ?? null, section: section?.title ?? null,
    kind: dc.kind, kind_label: DISH_KINDS[dc.kind] || 'Dish', price_pence: price, price_varies: priceVaries(item, choices, m),
    vat_rate: tax.vat_rate, tax_name: tax.name, tax_from: tax.from,
    recipe: dc.recipe, why: dc.why, portions: dc.portions, coverage: dc.coverage, gaps: dc.gaps, goods_item: dc.goods_item,
    steps: dc.steps, thresholds: t, options: [],
  }
  if (dc.kind === 'deal') {
    // The price shown is the cheapest (fromPrice()); each end of the range is
    // over what its own picks sell for: the deal's price before extra
    // charges, plus those picks' charges. Banded at its highest cost %.
    const from = margin({ gross_pence: price ?? 0, vat_rate: tax.vat_rate })
    const base = Math.max(0, (price ?? 0) - comboFromPrice(item, 0, m).pence)
    const r = dc.min == null ? null : dealRange(dc.parts, base, tax.vat_rate)
    Object.assign(row, {
      net_pence: from.net_pence, vat_pence: from.vat_pence, cost: null, cost_pence: null, cost_min: dc.min, cost_max: dc.max,
      gp_pence: null, gp_min_pence: r?.gp_low.gp_pence ?? null, gp_max_pence: r?.gp_high.gp_pence ?? null, cost_pct: null, gp_pct: null,
      cost_pct_min: r?.pct_low.cost_pct ?? null, cost_pct_max: r?.pct_high.cost_pct ?? null, band: costBand(r?.pct_high.cost_pct, t),
      range: r ? {
        cost_pct_min_picks: r.pct_low.picks, cost_pct_max_picks: r.pct_high.picks,
        cost_pct_min_pick_ids: r.pct_low.pick_ids, cost_pct_max_pick_ids: r.pct_high.pick_ids,
      } : null, parts: dc.parts,
    })
    return row
  }
  const mg = price == null ? null : margin({ gross_pence: price, vat_rate: tax.vat_rate, cost: dc.cost })
  Object.assign(row, {
    net_pence: mg?.net_pence ?? null, vat_pence: mg?.vat_pence ?? null, cost: dc.cost,
    cost_pence: mg?.cost_pence ?? (dc.cost == null ? null : Math.round(dc.cost * 100)),
    gp_pence: mg?.gp_pence ?? null, cost_pct: mg?.cost_pct ?? null, gp_pct: mg?.gp_pct ?? null,
    band: dc.coverage === 'not_needed' ? null : costBand(mg?.cost_pct, t),
  })
  // Priced options: an extra's own margin (its price against what it adds); a
  // base option's price is the dish's price with it.
  if (dc.kind !== 'service' && withOptions) {
    for (const c of choices) {
      for (const o of c.options) {
        const p = c.mode === 'extra' ? num(o.price_pence) : (basePrice(o) ?? null)
        if (!(p > 0)) continue
        const withIt = dishCost(item.id, { options: [{ option_id: o.id }] }, scope, ctx)
        const own = withIt.gaps.filter(g => g.option_id === o.id)
        const cost = c.mode === 'extra'
          ? (withIt.cost != null && dc.cost != null && !own.length ? round6(withIt.cost - dc.cost) : null)
          : withIt.cost
        const om = margin({ gross_pence: p, vat_rate: tax.vat_rate, cost })
        row.options.push({
          key: c.key + ':' + o.id, group: c.name, option_id: o.id, label: o.label, mode: c.mode, price_pence: p,
          cost, cost_pence: om.cost_pence, net_pence: om.net_pence, gp_pence: om.gp_pence, cost_pct: om.cost_pct,
          band: costBand(om.cost_pct, t), gaps: own, step: withIt.steps.find(s => s.option_id === o.id)?.text ?? null,
        })
      }
    }
  }
  return row
}

/**
 * The cost % a dishMargin() row is banded and judged at: a dish's own, a meal
 * deal's highest (cost_pct_max, at the picks that give it). What overTarget()
 * (shared/foodCost.js), price creep and why_cost_changed compare.
 */
export const bandedPct = row => (row?.kind === 'deal' ? row.cost_pct_max : row?.cost_pct) ?? null

/**
 * The picks a meal deal's dishMargin() row is banded at (its highest cost %:
 * range.cost_pct_max_pick_ids), as usageOf() and dishCost() take them:
 * [{ dish_id, options: [] }]. null for a dish, or a deal none of whose
 * choices can be costed (usageOf() then takes its typical picks).
 */
export function bandedPicks(row) {
  const ids = row?.kind === 'deal' ? row.range?.cost_pct_max_pick_ids : null
  return ids?.length ? ids.map(id => ({ dish_id: id, options: [] })) : null
}

/**
 * Every dish of a menu with its margin at a scope: what the Menu margins
 * page, the dish margins report and Pepper read. The menu's dishes join
 * ctx.dishes, and are what its meal deals choose from. only: a Set of dish
 * ids to work out, the rest skipped (price creep, inventory phase 7b: only
 * the dishes whose recipes use a changed item).
 */
export function menuMargins(menu, scope, ctx, { rates = [], settings = null, withOptions = true, only = null } = {}) {
  const mctx = menuCtx(menu)
  const here = { ...ctx, dishes: dishMap([menu], ctx.dishes), combo: mctx }
  const rules = variantRules(menu)
  const rows = []
  for (const s of menu?.sections || []) {
    for (const i of s.items || []) {
      if (only && !only.has(i.id)) continue
      rows.push(dishMargin(i, s, menu, scope, here, { rates, settings, rules, mctx, withOptions }))
    }
  }
  return rows
}

/** The price, VAT and margin steps of a dishMargin() row, to show after dishCost()'s: [{ label, text, amount_pence }]. */
export function marginSteps(row) {
  const money = p => (p == null ? '' : pounds(p / 100))
  if (row.price_pence == null) return [{ label: 'Price', text: 'no price on the menu', amount_pence: null }]
  const out = [
    { label: 'Price', text: (row.price_varies ? 'from ' : '') + money(row.price_pence) + ', VAT included', amount_pence: row.price_pence },
    {
      label: 'VAT', amount_pence: row.vat_pence,
      text: fmtNum(row.vat_rate, 2) + '%' + (row.tax_name ? ' (' + row.tax_name + (row.tax_from === 'default' ? ', the default rate' : ', the ' + row.tax_from + '\'s setting') + ')' : '')
        + ': ' + money(row.price_pence) + ' x ' + fmtNum(row.vat_rate, 2) + ' / ' + fmtNum(100 + Number(row.vat_rate || 0), 2),
    },
    { label: 'Net', text: money(row.price_pence) + ' less ' + money(row.vat_pence) + ' VAT', amount_pence: row.net_pence },
  ]
  if (row.kind === 'deal') {
    if (row.cost_min != null) out.push({ label: 'Cost', text: pounds(row.cost_min) + ' to ' + pounds(row.cost_max) + ', by what is picked', amount_pence: null })
    if (row.cost_pct_min != null) {
      const at = names => (names?.length ? ' (' + names.join(', ') + ')' : '')
      out.push({
        label: 'Cost %', amount_pence: null,
        text: fmtNum(row.cost_pct_min, 1) + '%' + at(row.range?.cost_pct_min_picks) + ' to ' + fmtNum(row.cost_pct_max, 1) + '%' + at(row.range?.cost_pct_max_picks)
          + ', each over what its picks sell for, extra charges included',
      })
    }
    return out
  }
  if (row.cost == null) return [...out, { label: 'Cost', text: row.coverage === 'not_needed' ? 'none: a service' : 'not costed', amount_pence: null }]
  out.push({ label: 'Cost', text: pounds(row.cost) + (row.coverage === 'partial' ? ' (partly costed)' : ''), amount_pence: row.cost_pence })
  out.push({ label: 'GP', text: money(row.net_pence) + ' less ' + money(row.cost_pence), amount_pence: row.gp_pence })
  if (row.cost_pct != null) {
    const t = row.thresholds || {}
    out.push({
      label: 'Cost %', amount_pence: null,
      text: money(row.cost_pence) + ' / ' + money(row.net_pence) + ' = ' + fmtNum(row.cost_pct, 1) + '%: ' + (BANDS[row.band]?.label || '').toLowerCase()
        + ' (target ' + fmtNum(t.target_pct, 1) + '%, limit ' + fmtNum(t.limit_pct, 1) + '%)',
    })
  }
  return out
}

// ── Coverage by sales (phase 3) ───────────────────────────────
//
// How much of what was sold can be costed (docs/INVENTORY.md 5.6, principle
// 7: effort follows value): each dish sold, at the venue, revenue stream and
// order type it was sold at, is costed when dishCost() there has no gaps and
// none of the options it offers needs a rule; its sales value counts as
// costed, else as not costed with how to fix it. The share is the item
// mapping's rule (coverageShare() in shared/itemMapping.js): what is decided
// over what isn't left out, to one place. Left out of both sides: services
// (they need no recipe) and dishes on no menu any more (nothing to fix).
// Options are judged by what the dish offers, not by what was picked with each
// sale (a till line's options are only in its check's state, an online
// order's are labels): an option that adds something with no rule leaves
// every sale that has it partly costed. A line of our own till, kiosk or
// online orders with no dish (an open item typed in on the till) is left out
// too: it has no recipe and nothing on the Recipes page can give it one. Only
// another till's line with no dish is not costed, to be mapped to one.

export const COVERAGE_DAYS = 30
export const SALE_CHANNELS = { till: 'Till', kiosk: 'Kiosk', online: 'Online orders', imported: 'Other tills' }
export const SOLD_STATES = { costed: 'Costed', uncosted: 'Not costed', left_out: 'Left out' }
export const FIX_KINDS = {
  link: 'Link a recipe', recipe: 'Finish the recipe', option: 'Add an option rule', deal: 'Cost the meal deal\'s dishes', map: 'Map it to a menu dish',
}
export const LEFT_OUT_WHY = { gone: 'no longer on a menu', service: 'a service: no recipe needed', open: 'not a menu dish (an open item typed in on the till): nothing to cost' }

// A meal deal's gaps that no recipe fixes: a typed-in choice (no dish), no dishes picked.
const DEAL_GAPS = new Set(['custom_choice', 'no_picks'])

/**
 * Each option a dish offers and how it stands with no picks known: [{
 * option_id (a library option's id, 'v:<label>' for its own), label, own,
 * group (the group's name, null for its own), group_id, mode, price_pence,
 * option (the library's row, null for its own or one gone), hit (ruleFor():
 * { rule, from } or null), state: 'rule' | 'gap' | 'default', default_text
 * }]. The one rule for the matrix (dishOptions() in routes/recipeLinks.js)
 * and coverage (optionGaps()): with no rule, optionDefault() of the library
 * option, else of what the menu offers (its group's price mode and price).
 */
export function offeredOptions(dish, ctx = {}) {
  if (!dish) return []
  const out = []
  for (const c of itemChoices(dish, {})) {
    for (const o of c.options) {
      const own = c.key === 'variants'
      const lib = own ? null : get(ctx.options, o.id) || null
      const hit = ruleFor(dish.id, { id: o.id }, ctx.rules)
      const d = hit ? null : optionDefault(own ? { own: true } : lib || { price_mode: c.mode, price_pence: o.price_pence })
      out.push({
        option_id: o.id, label: o.label, own, group: own ? null : c.name, group_id: own ? null : c.key, mode: c.mode,
        price_pence: o.price_pence ?? null, option: lib, hit, state: hit ? 'rule' : d.state, default_text: d ? d.text : null,
      })
    }
  }
  return out
}

/** The options a dish offers that need a rule before a sale with them can be costed: [{ option_id, label, group, text }]. */
export function optionGaps(dish, ctx = {}) {
  if (!dish || isCombo(dish)) return []
  return offeredOptions(dish, ctx).filter(o => o.state === 'gap').map(o => ({ option_id: o.option_id, label: o.label, group: o.group, text: o.default_text }))
}

/**
 * Whether one sold dish (at its scope) is costed: { state: 'costed' |
 * 'uncosted' | 'left_out', reason, fixes: [{ kind, text, recipe_id?,
 * option_id?, dish_id? }], why, recipe }. sold: { channel, dish_id (null:
 * another till's line not mapped to a dish, or on our own till, kiosk or
 * online an open item, which is left out), venue_id, revenue_stream_id,
 * order_type_id, mapping ('kept', 'bucket', 'unmapped' for another till's
 * line) }. ctx: the dish costing ctx at the sale's venue.
 */
export function soldState(sold, ctx = {}) {
  if (!sold?.dish_id) {
    // Only another till's line is mapped to a dish (the Item mapping page maps nothing else).
    if (sold?.channel !== 'imported') return { state: 'left_out', reason: 'open', why: null, recipe: null, fixes: [] }
    const how = sold?.mapping === 'kept' ? 'It is kept as sold: map it' : sold?.mapping === 'bucket' ? 'It is counted under a section: map it' : 'Map it'
    return { state: 'uncosted', reason: 'map', why: null, recipe: null, fixes: [{ kind: 'map', text: how + ' to a menu dish on the Item mapping page, then link the dish to its recipe.' }] }
  }
  const dish = get(ctx.dishes, sold.dish_id)
  if (!dish) return { state: 'left_out', reason: 'gone', why: null, recipe: null, fixes: [] }
  const scope = { venue_id: sold.venue_id ?? null, revenue_stream_id: sold.revenue_stream_id ?? null, order_type_id: sold.order_type_id ?? null }
  const dc = dishCost(sold.dish_id, {}, scope, ctx)
  if (dc.coverage === 'not_needed') return { state: 'left_out', reason: 'service', why: null, recipe: null, fixes: [] }
  const fixes = []
  const add = f => { if (!fixes.some(x => x.kind === f.kind && x.text === f.text)) fixes.push(f) }
  for (const g of dc.gaps) {
    if (g.reason === 'no_recipe' || g.reason === 'not_dish' || (g.reason === 'missing' && !g.recipe_id)) add({ kind: 'link', text: g.fix })
    // A meal deal's own gaps (a dish in it, a typed-in choice, no picks) are fixed on the deal's dishes, never in a recipe.
    else if (g.dish_id || DEAL_GAPS.has(g.reason)) add({ kind: 'deal', dish_id: g.dish_id ?? null, text: g.text + '. ' + g.fix })
    else if (g.option_id) add({ kind: 'option', option_id: g.option_id, text: g.text + '. ' + g.fix })
    else add({ kind: 'recipe', recipe_id: g.recipe_id ?? null, text: g.text + '. ' + g.fix })
  }
  for (const o of optionGaps(dish, ctx)) {
    add({ kind: 'option', option_id: o.option_id, text: (o.group ? o.group + ': ' : '') + o.label + ' needs a rule (' + o.text.charAt(0).toLowerCase() + o.text.slice(1) + '). Give it one on the Recipes page, Options tab.' })
  }
  // Nothing in it could be costed, with no gap to say why (a meal deal none of whose choices is found).
  if (!fixes.length && dc.coverage !== 'full') {
    add(dc.kind === 'deal'
      ? { kind: 'deal', text: 'None of its choices can be costed yet. Link the dishes it offers to their recipes.' }
      : { kind: 'recipe', recipe_id: dc.recipe?.id ?? null, text: 'It can\'t be costed yet. Open its recipe and fix its gaps.' })
  }
  const recipe = dc.recipe ? { id: dc.recipe.id, name: dc.recipe.name, status: dc.recipe.status } : null
  if (!fixes.length) return { state: 'costed', reason: null, why: dc.why, recipe, fixes }
  return { state: 'uncosted', reason: fixes[0].kind, why: dc.why, recipe, fixes }
}

const emptySums = () => ({ total_pence: 0, costed_pence: 0, uncosted_pence: 0, left_out_pence: 0, qty: 0 })
/** The share costed, in percent to one place: the item mapping's coverage rule. */
export const costedShare = s => coverageShare({ total: s?.total_pence, mapped: s?.costed_pence, ignored: s?.left_out_pence })

/**
 * Coverage of some sales: { ...sums, percent, channels: { till: sums }, venues:
 * { venueId: sums }, dishes: [uncosted dish: { dish_id, name, menu,
 * sales_pence, qty, venue_ids, channels, fixes, where, recipe, mapping }]
 * (most sold first), left_out: [{ dish_id, name, reason, why, sales_pence }] }.
 * sums: { total_pence, costed_pence, uncosted_pence, left_out_pence, qty,
 * percent }. rows: what was sold, [{ channel, dish_id, name, venue_id,
 * revenue_stream_id, order_type_id, mapping, qty, sales_pence }] (pence, VAT
 * included, after discounts). ctxFor(venueId): the dish costing ctx at that
 * venue. Each dish and scope is judged once. judged: rows' states, when asked.
 */
export function salesCoverage(rows, ctxFor, { judged = null } = {}) {
  const all = emptySums()
  const channels = {}
  const venues = {}
  const dishes = new Map()
  const leftOut = new Map()
  const seen = new Map()
  const into = (s, state, pence, qty) => {
    s.total_pence += pence
    s.qty += qty
    s[state + '_pence'] += pence
  }
  for (const r of rows || []) {
    const pence = Math.round(num(r.sales_pence))
    const qty = num(r.qty)
    // A line with no dish by its name: another till's (to map) apart from our own open items (left out).
    const dishKey = r.dish_id || (r.channel === 'imported' ? 'name:' : 'open:') + lower(r.name)
    const key = [dishKey, r.venue_id, r.revenue_stream_id, r.order_type_id, r.dish_id ? '' : r.mapping].join('|')
    let st = seen.get(key)
    if (!st) {
      const ctx = ctxFor(r.venue_id ?? null)
      st = soldState(r, ctx)
      st.where = r.dish_id ? scopeText({ venue_id: r.venue_id, revenue_stream_id: r.revenue_stream_id, order_type_id: r.order_type_id }, ctx.names || {}) : null
      st.dish = r.dish_id ? get(ctx.dishes, r.dish_id) : null
      seen.set(key, st)
    }
    if (judged) judged.push({ row: r, state: st })
    into(all, st.state, pence, qty)
    into(channels[r.channel] ||= emptySums(), st.state, pence, qty)
    into(venues[r.venue_id] ||= emptySums(), st.state, pence, qty)
    if (st.state === 'left_out') {
      const l = leftOut.get(dishKey) || leftOut.set(dishKey, { dish_id: r.dish_id ?? null, name: st.dish?.name || r.name || 'A dish', reason: st.reason, why: LEFT_OUT_WHY[st.reason], sales_pence: 0 }).get(dishKey)
      l.sales_pence += pence
      continue
    }
    if (st.state !== 'uncosted') continue
    const d = dishes.get(dishKey) || dishes.set(dishKey, {
      dish_id: r.dish_id ?? null, name: st.dish?.name || r.name || 'A dish', menu: st.dish?.menu ?? null, sales_pence: 0, qty: 0,
      venue_ids: [], channels: [], fixes: [], where: [], recipe: st.recipe, mapping: st.reason === 'map' ? (r.mapping || 'unmapped') : null,
    }).get(dishKey)
    d.sales_pence += pence
    d.qty += qty
    if (!d.venue_ids.includes(r.venue_id)) d.venue_ids.push(r.venue_id)
    if (!d.channels.includes(r.channel)) d.channels.push(r.channel)
    if (st.where && !d.where.includes(st.where)) d.where.push(st.where)
    for (const f of st.fixes) if (!d.fixes.some(x => x.kind === f.kind && x.text === f.text)) d.fixes.push(f)
  }
  const done = s => ({ ...s, qty: round6(s.qty), percent: costedShare(s) })
  return {
    ...done(all),
    channels: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, done(v)])),
    venues: Object.fromEntries(Object.entries(venues).map(([k, v]) => [k, done(v)])),
    dishes: [...dishes.values()].map(d => ({ ...d, qty: round6(d.qty) })).sort((a, b) => b.sales_pence - a.sales_pence || a.name.localeCompare(b.name)),
    left_out: [...leftOut.values()].sort((a, b) => b.sales_pence - a.sales_pence),
  }
}

// ── Margins from what sold (phase 5) ─────────────────────────────

/**
 * Dish margins from what sold (inventory phase 5, dish_cost_days: Menu
 * margins' Sold tab, the report subject, Pepper): rows [{ dish_id, name,
 * section_id, section, qty, sales_pence, net_pence (VAT out), cost (the
 * theoretical cost, pounds; null when nothing could be costed),
 * uncosted_qty, typical_qty, left_out }] summed by dish and by section,
 * each with margin() on its net (pence meet pounds only here): { dishes:
 * [{ dish_id, name, section_id, section, qty, sales_pence, net_pence,
 * cost_pence, gp_pence, cost_pct, gp_pct, band, uncosted_qty, typical_qty }]
 * (most sold by net first), sections: [the same per section], total }. A
 * dish whose sold units were partly uncosted has its cost from the units
 * that were; band (against settings' targets, the section's own) only when
 * every unit was costed. Left out rows (open items, services) are not dishes.
 */
export function soldMargins(rows = [], settings = null) {
  const sums = () => ({ qty: 0, sales_pence: 0, net_pence: 0, cost: 0, costed: false, uncosted_qty: 0, typical_qty: 0 })
  const into = (s, r) => {
    s.qty += num(r.qty)
    s.sales_pence += Math.round(num(r.sales_pence))
    s.net_pence += Math.round(num(r.net_pence))
    if (r.cost != null) { s.cost += num(r.cost); s.costed = true }
    s.uncosted_qty += num(r.uncosted_qty)
    s.typical_qty += num(r.typical_qty)
  }
  const done = (s, sectionId = null) => {
    const m = margin({ gross_pence: s.net_pence, vat_rate: 0, cost: s.costed ? round6(s.cost) : null })
    const full = s.costed && !(s.uncosted_qty > 0)
    return {
      qty: round6(s.qty), sales_pence: s.sales_pence, net_pence: s.net_pence,
      cost_pence: m.cost_pence, gp_pence: m.gp_pence, cost_pct: m.cost_pct, gp_pct: m.gp_pct,
      band: full ? costBand(m.cost_pct, thresholdsFor(settings, sectionId)) : null,
      uncosted_qty: round6(s.uncosted_qty), typical_qty: round6(s.typical_qty),
    }
  }
  const dishes = new Map()
  const sections = new Map()
  const total = sums()
  for (const r of rows || []) {
    if (r.left_out) continue
    const key = r.dish_id || 'name:' + lower(r.name)
    const d = dishes.get(key) || dishes.set(key, { dish_id: r.dish_id ?? null, name: r.name, section_id: r.section_id ?? null, section: r.section ?? null, s: sums() }).get(key)
    into(d.s, r)
    const sk = r.section_id || 'none'
    const sec = sections.get(sk) || sections.set(sk, { section_id: r.section_id ?? null, section: r.section ?? null, s: sums() }).get(sk)
    into(sec.s, r)
    into(total, r)
  }
  return {
    dishes: [...dishes.values()].map(d => ({ dish_id: d.dish_id, name: d.name, section_id: d.section_id, section: d.section, ...done(d.s, d.section_id) }))
      .sort((a, b) => b.net_pence - a.net_pence || a.name.localeCompare(b.name)),
    sections: [...sections.values()].map(x => ({ section_id: x.section_id, section: x.section, ...done(x.s, x.section_id) }))
      .sort((a, b) => b.net_pence - a.net_pence),
    total: done(total),
  }
}
