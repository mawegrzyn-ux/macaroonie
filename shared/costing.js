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
// ctx / data: { items, recipes, quotes, preferred, receipts, since, venueId,
// basis } (objects or Maps keyed by id). items[id] = { id, name, base_unit,
// yield_pct, recipe_unit, units: [{ name, base_qty }] }; recipes[id] = a
// recipe with its lines; quotes[itemId] = the item's active quotes (with
// venue_prices); preferred[itemId] = { default, venues }; receipts[itemId] =
// [{ venue_id, at, packs, pack_base_qty, price }] (price paid per pack).

import { UNITS, chooseQuote, quotePrice, packLabel, fmtNum, perUnitLabel } from './procurement.js'
import { vatIncluded } from './orderPricing.js'

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
  if (n == null || !Number.isFinite(Number(n))) return ''
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
 * received, problem }. problem: 'no_price' (standard: no supplier price) or
 * 'no_receipts' (last, average: nothing received there).
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
    const all = (get(data.receipts, item.id) || []).filter(r => num(r.packs) > 0 && num(r.pack_base_qty) > 0)
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
    if (!recent.length) return out(null)
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
  no_unit: (n, unit, item) => 'Give ' + n + ' a size for ' + unit + ' (its units on the Inventory page), or use ' + (unitChoices(item).join(', ') || 'its own unit') + '.',
  sub_unit: (n, unit, sub) => 'Use ' + n + ' in ' + (recipeUnitChoices(sub).join(', ') || 'what it is made in') + '.',
  missing: () => 'Take the line out, or pick what it should be.',
  empty: n => 'Add what goes into ' + n + '.',
  no_yield: n => 'Say how much ' + n + ' makes.',
  sub_partial: n => 'Open ' + n + ' and fix its gaps.',
  cycle: n => 'Take ' + n + ' out: a recipe can\'t be inside itself.',
  too_deep: () => 'Recipes nest up to ' + MAX_DEPTH + ' levels: use fewer prep recipes inside each other.',
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
  // by venue and basis: a ctx may be asked about another venue later.
  const memoKey = recipe?.id ? recipe.id + '|' + (venueId ?? '') + '|' + basis : null
  if (memoKey && !st.stack.length && st.memo.has(memoKey)) return st.memo.get(memoKey)
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
        gaps.push(gap(l, i, c.problem, c.problem === 'no_price'
          ? item.name + ' has no supplier price' + (venueId ? ' here' : '')
          : 'Nothing of ' + item.name + ' has been booked in here yet', FIX[c.problem](item.name)))
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
  const per = costed.length && makes ? round6(cost / makes) : null
  const coverage = !costed.length || per == null ? 'none' : gaps.length ? 'partial' : 'full'
  const out = { recipe_id: recipe?.id ?? null, basis, venue_id: venueId, cost: costed.length ? cost : null, per_unit: per, unit, makes, lines, gaps, coverage, complete: coverage === 'full' }
  if (memoKey && !st.stack.length) st.memo.set(memoKey, out)
  return out
}

/** A cost per base unit in the unit prices are read in: "£8.50 a kg", "£0.30 each". */
function perText(perBase, baseUnit) {
  if (perBase == null) return ''
  if (baseUnit === 'g' || baseUnit === 'ml') return pounds(perBase * 1000) + ' ' + perWord(perUnitLabel(baseUnit))
  return pounds(perBase) + ' ' + perWord(baseUnit)
}

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
 * Percentages are null for a price of nothing; the cost is null when unknown.
 */
export function margin({ gross_pence, vat_rate = 0, cost = null } = {}) {
  const gross = Math.round(num(gross_pence))
  const vat = vatIncluded(gross, num(vat_rate))
  const net = gross - vat
  if (cost == null || !Number.isFinite(Number(cost))) {
    return { gross_pence: gross, vat_pence: vat, net_pence: net, cost_pence: null, gp_pence: null, cost_pct: null, gp_pct: null }
  }
  const costPence = Number(cost) * 100
  const pct = v => (net > 0 ? Math.round(v / net * 1000) / 10 : null)
  return {
    gross_pence: gross, vat_pence: vat, net_pence: net,
    cost_pence: Math.round(costPence), gp_pence: Math.round(net - costPence),
    cost_pct: pct(costPence), gp_pct: pct(net - costPence),
  }
}
