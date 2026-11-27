// shared/stockItems.js
//
// What a wasted thing is in inventory items (inventory phase 4b, migration
// 308; docs/INVENTORY.md 6.3, decision D5): an item as it is, a prep batch
// through its recipe, a menu dish through the recipe the variation matrix
// picks for its scope, with its options and a meal deal's picks. Since phase
// 5 the walk is the cost engine's usage: usageOf() and recipeUsage() in
// shared/costing.js, on dishCost()'s and recipeCost()'s own lines (one walk:
// the cost, the waste and the usage from sales come from the same lines).
// Read by the waste routes (logging, and a till void marked wasted) and the
// tests.
//
// A file of its own because shared/stock.js can't import the cost engine:
// costing.js imports procurement.js, which re-exports stock.js, and uses its
// bindings as it loads.
//
//   itemsOf(what, ctx) -> { items: [{ item_id, qty_base }], gaps: [text], recipe }

import { usageOf, recipeUsage, inRecipeUnit, flatPicks } from './costing.js'
import { isCombo } from './combos.js'

const num = v => (v == null || v === '' ? 0 : Number(v))
const getOf = (coll, id) => (coll == null || id == null ? undefined : coll instanceof Map ? coll.get(id) : coll[id])

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
 * batch's) }. A gap is never a refusal: what could be broken in is. A meal
 * deal logged with no picks is a gap (its typical picks are for sales only).
 */
export function itemsOf(what, ctx = {}) {
  if (what?.item_id) {
    const q = Math.round(num(what.qty_base) * 10000) / 10000
    return { items: q ? [{ item_id: what.item_id, qty_base: q }] : [], gaps: [], recipe: null }
  }
  if (what?.recipe_id) {
    const r = getOf(ctx.recipes, what.recipe_id)
    if (!r) return { items: [], gaps: ['This recipe is gone'], recipe: null }
    const recipe = { id: r.id, name: r.name }
    const conv = r.kind === 'prep' ? inRecipeUnit(what.qty, what.unit, r) : { qty: num(what.qty), problem: null }
    if (conv.problem) return { items: [], gaps: [conv.problem], recipe }
    const u = recipeUsage(r, conv.qty, ctx)
    return { items: u.items, gaps: u.uncosted.map(g => g.text), recipe }
  }
  if (what?.dish_id) {
    const dish = getOf(ctx.dishes, what.dish_id)
    if (dish && isCombo(dish) && !flatPicks(what.picks ?? []).length) {
      return { items: [], gaps: [dish.name + ' is a meal deal: log the dishes that were in it'], recipe: null }
    }
    const u = usageOf({ dish_id: what.dish_id, qty: what.qty || 1, options: what.options || [], picks: what.picks ?? null, typical: false }, what.scope || {}, ctx)
    return { items: u.items, gaps: u.uncosted.map(g => g.text), recipe: u.recipe ? { id: u.recipe.id, name: u.recipe.name } : null }
  }
  return { items: [], gaps: [], recipe: null }
}
