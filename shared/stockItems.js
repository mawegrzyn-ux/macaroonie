// shared/stockItems.js
//
// What a wasted thing is in inventory items (inventory phase 4b, migration
// 308; docs/INVENTORY.md 6.3, decision D5): an item as it is, a prep batch
// through its recipe, a menu dish through the recipe the variation matrix
// picks for its scope (recipeFor()), with its options and a meal deal's
// picks, walked by dishCost() in shared/costing.js (one walk: the cost and
// the items come from the same lines). Read by the waste routes (logging,
// and a till void marked wasted, read each time) and the tests; phase 5's
// usage from sales takes the same walk.
//
// A file of its own because shared/stock.js can't import the cost engine:
// costing.js imports procurement.js, which re-exports stock.js, and uses its
// bindings as it loads.
//
//   itemsOf(what, ctx) -> { items: [{ item_id, qty_base }], gaps: [text], recipe }

import { dishCost, flatPicks, recipeMakes, inRecipeUnit, toBase, yieldOf, asBought, needsCheck, MAX_DEPTH } from './costing.js'

const num = v => (v == null || v === '' ? 0 : Number(v))
const round4 = n => Math.round(Number(n) * 10000) / 10000

const getOf = (coll, id) => (coll == null || id == null ? undefined : coll instanceof Map ? coll.get(id) : coll[id])
// A dish's own gaps that leave its items unknown (the rest, a price missing, change only its cost).
const DISH_QTY_GAPS = new Set(['no_recipe', 'not_dish', 'draft', 'empty', 'no_rule', 'option_gone', 'no_picks', 'custom_choice'])

/**
 * What a wasted thing is in inventory items, as bought (a line's yield
 * divides: 100 g of onion at 88% is 113.6 g bought). what is one of
 *   { item_id, qty_base }                    an item, in its base unit
 *   { recipe_id, qty, unit }                 a prep batch: qty in a unit of
 *                                            what the recipe makes (2 l of sauce)
 *   { dish_id, qty, options, picks, scope }  qty dishes, each with its options
 *                                            ([{ option_id, prefix }], a till
 *                                            line's modifiers) and a meal deal's
 *                                            picks (a till line's combo), at
 *                                            scope { venue_id, revenue_stream_id,
 *                                            order_type_id }: the recipe the
 *                                            matrix picks there (recipeFor())
 * ctx: the cost engine's ctx for dishes (items, recipes, links, rules,
 * options, dishes). Returns { items: [{ item_id, qty_base }] (each item once,
 * 4 decimals), gaps: [text], recipe: { id, name } | null (a dish's or a
 * batch's) }. A gap is never a refusal: what could be broken in is.
 */
export function itemsOf(what, ctx = {}) {
  const acc = new Map()
  const gaps = []
  const gap = t => { if (t && !gaps.includes(t)) gaps.push(t) }
  const add = (id, q) => { if (Number.isFinite(q) && q !== 0) acc.set(id, (acc.get(id) || 0) + q) }
  let recipe = null

  const walk = (r, q, stack) => {
    if (needsCheck(r)) gap(r.name + ' is a draft read in or written by Pepper, not checked yet: its quantities may be wrong')
    const makes = recipeMakes(r)
    if (!(makes > 0)) return gap(r.name + ' doesn\'t say how much it makes, so it can\'t be broken into items')
    const lines = (r.lines || []).slice().sort((a, b) => num(a.sort_order) - num(b.sort_order))
    if (!lines.length) return gap(r.name + ' has nothing in it')
    const f = q / makes
    for (const l of lines) {
      if (l.item_id) {
        const item = getOf(ctx.items, l.item_id)
        if (!item) { gap(r.name + ': a line\'s inventory item is gone'); continue }
        const conv = toBase(l.qty, l.unit, item)
        if (conv.problem) { gap(r.name + ': ' + conv.problem); continue }
        add(item.id, asBought(conv.base, yieldOf(item, l)) * f)
        continue
      }
      const sub = getOf(ctx.recipes, l.sub_recipe_id)
      if (!sub) { gap(r.name + ': a line\'s recipe is gone'); continue }
      if (sub.id === r.id || stack.includes(sub.id)) { gap(sub.name + ' is inside itself'); continue }
      if (stack.length + 1 >= MAX_DEPTH) { gap(sub.name + ' is nested more than ' + MAX_DEPTH + ' levels down'); continue }
      const conv = inRecipeUnit(l.qty, l.unit, sub)
      if (conv.problem) { gap(r.name + ': ' + conv.problem); continue }
      const y = l.yield_pct != null && l.yield_pct !== '' ? yieldOf(null, l) : 100
      walk(sub, asBought(conv.qty, y) * f, [...stack, r.id])
    }
  }

  const dish = (dishId, n, options, picks, scope) => {
    const dc = dishCost(dishId, { options: options || [], ...(picks != null ? { picks } : {}) }, scope || {}, ctx)
    if (dc.kind === 'service') return
    if (dc.kind === 'deal') {
      const parts = picks != null ? flatPicks(picks) : []
      if (!parts.length) return gap(dc.name + ' is a meal deal: log the dishes that were in it')
      for (const p of parts) dish(p.dish_id, n, p.options, null, scope)
      return
    }
    if (dc.recipe && !recipe) recipe = { id: dc.recipe.id, name: dc.recipe.name }
    for (const g of dc.gaps) if (DISH_QTY_GAPS.has(g.reason) || (g.reason === 'missing' && !dc.recipe)) gap(g.text)
    if (!dc.recipe || dc.recipe.kind !== 'dish') return
    for (const l of dc.lines) {
      if (l.item_id) {
        const item = getOf(ctx.items, l.item_id)
        if (!item) { gap(dc.name + ': a line\'s inventory item is gone'); continue }
        const conv = toBase(l.qty, l.unit, item)
        if (conv.problem) { gap(dc.name + ': ' + conv.problem); continue }
        add(item.id, asBought(conv.base, l.yield_pct ?? yieldOf(item)) * n)
      } else if (l.sub_recipe_id) {
        const sub = getOf(ctx.recipes, l.sub_recipe_id)
        if (!sub) { gap(dc.name + ': a line\'s recipe is gone'); continue }
        const conv = inRecipeUnit(l.qty, l.unit, sub)
        if (conv.problem) { gap(dc.name + ': ' + conv.problem); continue }
        walk(sub, asBought(conv.qty, l.yield_pct ?? 100) * n, [dc.recipe.id])
      } else if (l.recipe_id) {
        // An option that is a recipe of its own (a side of fries): its portions.
        const side = getOf(ctx.recipes, l.recipe_id)
        if (side) walk(side, num(l.qty) * n, [dc.recipe.id])
      }
    }
  }

  if (what?.item_id) {
    add(what.item_id, num(what.qty_base))
  } else if (what?.recipe_id) {
    const r = getOf(ctx.recipes, what.recipe_id)
    if (!r) gap('This recipe is gone')
    else {
      recipe = { id: r.id, name: r.name }
      const conv = r.kind === 'prep' ? inRecipeUnit(what.qty, what.unit, r) : { qty: num(what.qty), problem: null }
      if (conv.problem) gap(conv.problem)
      else walk(r, conv.qty, [])
    }
  } else if (what?.dish_id) {
    dish(what.dish_id, num(what.qty || 1), what.options, what.picks, what.scope)
  }
  const items = [...acc.entries()].map(([item_id, q]) => ({ item_id, qty_base: round4(q) })).filter(i => i.qty_base !== 0)
  return { items, gaps, recipe }
}
