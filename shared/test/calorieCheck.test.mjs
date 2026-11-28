// Suggested calories as a check on the declared figure (shared/calorieCheck.js,
// inventory phase 8b, 27 Nov 2026): an item's energy (per 100 g, per 100 ml,
// or per one for an item kept in each; unknown is a gap), one serving on the
// cost engine's own walk with the usable quantity (a trimmed item's usable
// part, never what is bought; a nested prep recipe's share of its batch after
// its cooking loss; the link's portions), the scopes a dish is sold at (the
// highest is the suggestion), the difference against the declaration within
// the tolerance, "at least" while anything is unknown, and what a stored
// check does next (a dismissal holds while the figure stays within the
// tolerance of what was dismissed). And the walk changed nothing else:
// usageOf()'s items and cost are as before. Phase 8b's allergen side: a
// change's dishes (dishesToCheck(): items and recipes up to dishes, the
// options whose rules bring them in), its words, and a substitute delivered.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  energyOf, energyProblem, energyWords, dishEnergy, recipeEnergy, calorieCheck, withinTolerance, calorieFingerprint, nextCalorieCheck,
  calorieWords, calorieMoved, CALORIE_TOLERANCE,
} from '../calorieCheck.js'
import {
  dishesToCheck, optionsUsing, changeWords, changeMarks, substituteKnown, scopeSuggestion, dishScopes, dishCheck, evidenceWords,
  unknownSubstitutes, hasReview, fingerprint, checkFingerprint, dismissalHolds, nextCheck,
} from '../allergenCheck.js'
import { dishesUsing } from '../priceCreep.js'
import { usageOf, dishMap } from '../costing.js'

const SOHO = 'v-soho', LEEDS = 'v-leeds'
const names = { venues: { [SOHO]: 'Soho', [LEEDS]: 'Leeds' }, streams: {}, types: {} }
const item = (id, name, base_unit = 'g', extra = {}) => ({ id, name, base_unit, yield_pct: 100, units: [], ...extra })
const recipe = (id, name, kind, lines, extra = {}) => ({
  id, name, kind, portions: 1, yield_qty: kind === 'prep' ? 1 : null, yield_unit: kind === 'prep' ? 'kg' : null, loss_pct: 0,
  status: 'live', source: null, variant_of: null, lines: lines.map((l, i) => ({ id: id + '-' + i, sort_order: i, yield_pct: null, ...l })), ...extra,
})
const dishRow = (id, name, extra = {}) => ({ id, name, price_pence: 1200, kind: null, tax: null, variants: [], variant_groups: [], dietary: [], allergen_levels: {}, calories: null, ...extra })
const link = (id, dish, recipeId, scope = {}) => ({ id, dish_id: dish, recipe_id: recipeId, portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null, ...scope })
const quote = (id, itemId, extra = {}) => ({
  id, item_id: itemId, supplier_name: 'Brakes', product_name: null, supplier_code: null, pack_name: 'Pack', pack_count: 1, pack_qty: 1000,
  pack_unit: 'g', pack_base_qty: 1000, price: 5, venue_prices: {}, is_active: true,
  allergens_contains: [], allergens_may_contain: [], allergens_checked_at: '2026-11-20T10:00:00Z', ...extra,
})

// Onions trimmed to 80% (150 kcal per 100 g... of the part used), rice, oil, a butter sauce that loses half its
// weight cooking, an egg counted in each.
function ctxOf({ items: more = {}, links = null, dishes = null, recipes: rs = null } = {}) {
  const items = new Map([
    ['onion', item('onion', 'Onion', 'g', { yield_pct: 80, kcal_per_100g: 40 })],
    ['rice', item('rice', 'Rice', 'g', { kcal_per_100g: 130 })],
    ['oil', item('oil', 'Oil', 'ml', { kcal_per_100g: 820 })],
    ['butter', item('butter', 'Butter', 'g', { kcal_per_100g: 740 })],
    ['egg', item('egg', 'Egg', 'each', { kcal_each: 70 })],
    ['salt', item('salt', 'Salt', 'g', { kcal_per_100g: 0 })],
    ...Object.entries(more),
  ])
  const recipes = rs || new Map([
    // 1 kg of sauce made from 1 kg of butter and 1 l of stock-free water (none), losing 50% cooking: 7,400 kcal over 500 g.
    ['sauce', recipe('sauce', 'Butter sauce', 'prep', [{ item_id: 'butter', qty: 1000, unit: 'g' }], { loss_pct: 50 })],
    // A prep inside a prep: 400 g of the sauce + 600 g rice make 1 kg of glaze (no loss).
    ['glaze', recipe('glaze', 'Rice glaze', 'prep', [{ sub_recipe_id: 'sauce', qty: 400, unit: 'g' }, { item_id: 'rice', qty: 600, unit: 'g' }])],
    // Two portions: 200 g onion (used, after trimming), 300 g rice, 20 ml oil, 2 eggs, 100 g of the glaze.
    ['dish', recipe('dish', 'Fried rice', 'dish', [
      { item_id: 'onion', qty: 200, unit: 'g' }, { item_id: 'rice', qty: 300, unit: 'g' }, { item_id: 'oil', qty: 20, unit: 'ml' },
      { item_id: 'egg', qty: 2, unit: 'each' }, { sub_recipe_id: 'glaze', qty: 100, unit: 'g' },
    ], { portions: 2 })],
    ['big', recipe('big', 'Fried rice large', 'dish', [{ item_id: 'rice', qty: 500, unit: 'g' }, { item_id: 'oil', qty: 20, unit: 'ml' }])],
  ])
  const menu = { id: 'm1', name: 'Dinner', sections: [{ id: 's1', title: 'Rice', items: dishes || [dishRow('d-rice', 'Fried rice', { calories: 600 })] }] }
  return {
    items, recipes, links: links || [link('l1', 'd-rice', 'dish')], rules: [], options: new Map(), names,
    dishes: dishMap([menu]), quotes: new Map(), preferred: new Map(), receipts: {}, venueId: null, basis: 'standard',
  }
}

// One serving of Fried rice: (200 g onion x 0.4 + 300 x 1.3 + 20 x 8.2 + 2 x 70 + 100 g glaze) / 2.
// The glaze: 400 g sauce (7,400 kcal / 500 g made = 14.8 a gram: 5,920) + 600 x 1.3 (780) = 6,700 per kg; 100 g = 670.
// (80 + 390 + 164 + 140 + 670) / 2 = 722.
const SERVING = 722

test('an item\'s energy: per 100 g, per 100 ml, per one; the other kind is not its energy; unknown is no figure', () => {
  assert.deepEqual(energyOf(item('r', 'Rice', 'g', { kcal_per_100g: 130 })), { known: true, per_base: 1.3, per: '100 g', figure: 130 })
  assert.equal(energyOf(item('o', 'Oil', 'ml', { kcal_per_100g: 820 })).per, '100 ml')
  assert.deepEqual(energyOf(item('e', 'Egg', 'each', { kcal_each: 70 })), { known: true, per_base: 70, per: 'each', figure: 70 })
  assert.equal(energyOf(item('e', 'Egg', 'each', { kcal_per_100g: 150 })).known, false)
  assert.equal(energyOf(item('x', 'Tamarind', 'g')).known, false)
  assert.equal(energyOf(item('s', 'Salt', 'g', { kcal_per_100g: 0 })).known, true, 'nothing is a figure, not unknown')
  assert.equal(energyWords(item('r', 'Rice', 'g', { kcal_per_100g: 130 })), '130 kcal per 100 g')
  assert.equal(energyWords(item('e', 'Egg', 'each', { kcal_each: 70 })), '70 kcal each')
  assert.equal(energyWords(item('x', 'Tamarind', 'g')), 'Energy not known')
  assert.match(energyProblem({ name: 'Egg', base_unit: 'each' }, { kcal_per_100g: 150 }), /counted in each/)
  assert.match(energyProblem({ name: 'Oil', base_unit: 'ml' }, { kcal_each: 9 }), /per 100 ml/)
  assert.match(energyProblem({ name: 'Rice', base_unit: 'g' }, { kcal_per_100g: 1200 }), /between 0 and 900/)
  assert.equal(energyProblem({ name: 'Rice', base_unit: 'g' }, { kcal_per_100g: 130 }), null)
})

test('one serving through a nested prep recipe: the usable quantity, the batch after its loss, the portions', () => {
  const ctx = ctxOf()
  const e = dishEnergy('d-rice', { venue_id: SOHO }, ctx)
  assert.equal(e.complete, true, JSON.stringify(e.gaps))
  assert.equal(e.kcal, SERVING)
  assert.equal(e.recipe.name, 'Fried rice')
  // The onion is the part used (100 g a serving, not the 125 g bought).
  const onion = e.lines.find(l => l.item === 'Onion')
  assert.equal(onion.qty_base, 100)
  assert.equal(onion.kcal, 40)
  // The butter, through the glaze and the sauce inside it: 100 g of glaze a dish holds 40 g of sauce, 80 g of butter.
  const butter = e.lines.find(l => l.item === 'Butter')
  assert.equal(butter.qty_base, 40)
  assert.deepEqual(butter.via, ['Fried rice', 'Rice glaze', 'Butter sauce'])
  // A link of two portions doubles it.
  const two = dishEnergy('d-rice', { venue_id: SOHO }, ctxOf({ links: [{ ...link('l1', 'd-rice', 'dish'), portions: 2 }] }))
  assert.equal(two.kcal, SERVING * 2)
  // The recipe editor's own figure: a portion.
  const own = recipeEnergy(ctx.recipes.get('dish'), ctx)
  assert.equal(own.kcal, SERVING)
  assert.equal(own.per, 'a portion')
  const glaze = recipeEnergy(ctx.recipes.get('glaze'), ctx)
  assert.equal(glaze.kcal, 6700)
  assert.equal(glaze.per, 'a kg')
  // A prep made in grams or millilitres is said per 100 of them: a gram's figure in whole kcal would be wrong.
  const inG = recipeEnergy({ ...ctx.recipes.get('glaze'), yield_qty: 1000, yield_unit: 'g' }, ctx)
  assert.equal(inG.per, 'per 100 g')
  assert.equal(inG.qty, 100)
  assert.equal(inG.kcal, 670, '6.7 kcal a gram')
  const butterSauce = recipeEnergy({ ...ctx.recipes.get('sauce'), yield_qty: 1000, yield_unit: 'g', loss_pct: 0, lines: [{ id: 'b', sort_order: 0, item_id: 'butter', qty: 200, unit: 'g', yield_pct: null }] }, ctx)
  assert.equal(butterSauce.kcal, 148, '1.48 kcal a gram is 148 per 100 g, not 1')
  const stock = recipeEnergy({ ...ctx.recipes.get('sauce'), yield_qty: 1000, yield_unit: 'ml', loss_pct: 0, lines: [{ id: 'o', sort_order: 0, item_id: 'oil', qty: 50, unit: 'ml', yield_pct: null }] }, ctx)
  assert.equal(stock.per, 'per 100 ml')
  assert.equal(stock.kcal, 41, '0.41 kcal a millilitre')
})

test('the walk with the quantity changes nothing else: usage and cost are as before', () => {
  const ctx = ctxOf()
  const plain = usageOf({ dish_id: 'd-rice', qty: 1 }, { venue_id: SOHO }, ctx)
  const heard = []
  const traced = usageOf({ dish_id: 'd-rice', qty: 1 }, { venue_id: SOHO }, ctxOf(), { trace: { item: e => heard.push(e) } })
  assert.deepEqual(traced.items, plain.items)
  assert.equal(traced.cost, plain.cost)
  // What is bought of the onion is still its bought quantity (125 g), what goes in 100 g.
  assert.equal(plain.items.find(i => i.item_id === 'onion').qty_base, 125)
  assert.equal(heard.find(e => e.item_id === 'onion').qty, 100)
})

test('unknown is never a pass: an item with no energy, a unit with no size, no recipe, a draft Pepper read in', () => {
  const noFigure = ctxOf({ items: { egg: item('egg', 'Egg', 'each') } })
  const e = dishEnergy('d-rice', { venue_id: SOHO }, noFigure)
  assert.equal(e.complete, false)
  assert.equal(e.kcal, null)
  assert.equal(e.known_kcal, SERVING - 70)
  assert.ok(e.gaps.some(g => g.reason === 'no_energy' && g.item === 'Egg'))
  const noSize = ctxOf({ recipes: new Map([['dish', recipe('dish', 'Fried rice', 'dish', [{ item_id: 'rice', qty: 1, unit: 'cup' }])]]) })
  const s = dishEnergy('d-rice', { venue_id: SOHO }, noSize)
  assert.equal(s.complete, false)
  assert.ok(s.gaps.some(g => g.reason === 'no_unit'), JSON.stringify(s.gaps))
  const none = dishEnergy('d-rice', { venue_id: SOHO }, ctxOf({ links: [] }))
  assert.equal(none.recipe, null)
  assert.ok(none.gaps.some(g => g.reason === 'no_recipe'))
  const draft = ctxOf({ recipes: new Map([['dish', recipe('dish', 'Fried rice', 'dish', [{ item_id: 'rice', qty: 300, unit: 'g' }], { status: 'draft', source: 'reader' })]]) })
  assert.ok(dishEnergy('d-rice', { venue_id: SOHO }, draft).gaps.some(g => g.reason === 'draft'))
})

test('the check: the highest scope is the suggestion; within the tolerance agrees; none declared; at least while unknown', () => {
  const ctx = ctxOf({ links: [link('l1', 'd-rice', 'dish'), link('l2', 'd-rice', 'big', { venue_id: LEEDS })] })
  const dish = ctx.dishes.get('d-rice')
  const scopes = dishScopes(dish, ctx, [SOHO, LEEDS])
  const results = scopes.map(s => dishEnergy('d-rice', s, ctx))
  // Leeds' large one: 500 x 1.3 + 20 x 8.2 = 814.
  const agree = calorieCheck(dish, results, 800, names)
  assert.equal(agree.suggested, 814)
  assert.equal(agree.min, SERVING)
  assert.equal(agree.max, 814)
  assert.equal(agree.difference, null, '800 is within 10% of 814')
  assert.equal(agree.spread, true, 'the venues differ by more than the tolerance')
  assert.deepEqual(agree.groups.map(g => g.where.join(', ')).sort(), ['Leeds', 'Soho'])
  const differs = calorieCheck(dish, results, 600, names)
  assert.equal(differs.difference.kind, 'differs')
  assert.equal(differs.difference.text, 'The recipe comes to 814 kcal; the dish declares 600 kcal')
  const missing = calorieCheck(dish, results, null, names)
  assert.equal(missing.difference.kind, 'missing')
  assert.match(calorieWords(missing.difference), /declares no calories/)
  // Unknown: no suggestion; a declaration already below what is known is said, one above it is not.
  const unknown = ctxOf({ items: { egg: item('egg', 'Egg', 'each') } })
  const r2 = [dishEnergy('d-rice', { venue_id: SOHO }, unknown)]
  const under = calorieCheck(unknown.dishes.get('d-rice'), r2, 400, names)
  assert.equal(under.complete, false)
  assert.equal(under.suggested, null)
  assert.equal(under.difference.kind, 'under')
  assert.equal(under.difference.lower, SERVING - 70)
  assert.equal(calorieCheck(unknown.dishes.get('d-rice'), r2, 700, names).difference, null, 'not all known: never a pass, never a difference above it')
  assert.equal(calorieCheck(unknown.dishes.get('d-rice'), r2, null, names).difference, null, 'nothing to suggest while unknown')
  assert.equal(withinTolerance(95, 100), true)
  assert.equal(withinTolerance(89, 100), false)
  assert.equal(withinTolerance(52, 60), true, 'at least 10 kcal of room')
  assert.deepEqual(CALORIE_TOLERANCE, { pct: 10, kcal: 10 })
})

test('what a stored check does next: a dismissal holds within the tolerance of the figure dismissed', () => {
  const ctx = ctxOf()
  const dish = ctx.dishes.get('d-rice')
  const r = [dishEnergy('d-rice', { venue_id: SOHO }, ctx)]
  const check = calorieCheck(dish, r, 600, names)
  assert.equal(calorieFingerprint(check), 'differs:600:' + SERVING + ':' + SERVING)
  assert.deepEqual(nextCalorieCheck(null, check), { op: 'insert', status: 'open', reopened: false })
  assert.deepEqual(nextCalorieCheck({ status: 'open' }, check), { op: 'update', status: 'open', reopened: false })
  const dismissed = { status: 'dismissed', kind: 'differs', declared_kcal: 600, decided_kcal: 730 }
  assert.equal(nextCalorieCheck(dismissed, check).status, 'dismissed', '722 is within 10% of 730')
  assert.equal(nextCalorieCheck({ ...dismissed, decided_kcal: 900 }, check).reopened, true, 'the recipe moved past the tolerance')
  assert.equal(nextCalorieCheck({ ...dismissed, declared_kcal: 650 }, check).reopened, true, 'the declared figure changed')
  // Agrees now: an open row goes, an accepted one stays as the record; accepted with a difference again opens.
  const agrees = calorieCheck(dish, r, SERVING, names)
  assert.deepEqual(nextCalorieCheck({ status: 'open' }, agrees), { op: 'delete', status: null, reopened: false })
  assert.deepEqual(nextCalorieCheck({ status: 'accepted' }, agrees), { op: 'update', status: 'accepted', reopened: false })
  assert.equal(nextCalorieCheck({ status: 'accepted', kind: 'differs', declared_kcal: 600, decided_kcal: SERVING }, check).reopened, true)
  // An open check is marked by a change only when its difference moved past the tolerance.
  assert.equal(calorieMoved('differs:600:' + SERVING + ':' + SERVING, check), false)
  assert.equal(calorieMoved('differs:600:700:700', check), false, '722 is within 10% of 700')
  assert.equal(calorieMoved('differs:600:500:500', check), true)
  assert.equal(calorieMoved('differs:650:' + SERVING + ':' + SERVING, check), true, 'another declared figure')
  assert.equal(calorieMoved('', check), true)
})

test('the dishes a change can alter: items and recipes up through prep recipes, options whose rules bring them in', () => {
  const ctx = ctxOf({
    dishes: [
      dishRow('d-rice', 'Fried rice', { variant_groups: [{ group_id: 'g', name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ option_id: 'o-egg', label: 'Add egg', price_pence: 100 }] }] }),
      dishRow('d-plain', 'Plain rice', { variant_groups: [{ group_id: 'g', name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ option_id: 'o-egg', label: 'Add egg', price_pence: 100 }] }] }),
      dishRow('d-soup', 'Soup'),
    ],
    links: [link('l1', 'd-rice', 'dish'), link('l2', 'd-plain', 'big')],
  })
  ctx.rules = [{ id: 'r1', option_id: 'o-egg', dish_id: null, action: 'add', item_id: 'egg', qty: 1, unit: 'each' }]
  // Butter is only inside the sauce inside the glaze inside Fried rice.
  assert.deepEqual([...dishesToCheck({ itemIds: ['butter'] }, ctx)], ['d-rice'])
  assert.deepEqual([...dishesUsing(['butter'], ctx.recipes, ctx.links).recipeIds].sort(), ['dish', 'glaze', 'sauce'])
  // A changed recipe walks up the same way.
  assert.deepEqual([...dishesToCheck({ recipeIds: ['sauce'] }, ctx)], ['d-rice'])
  // The egg is in Fried rice's recipe and added by an option both dishes offer.
  assert.deepEqual([...dishesToCheck({ itemIds: ['egg'] }, ctx)].sort(), ['d-plain', 'd-rice'])
  assert.deepEqual([...optionsUsing(['egg'], [], ctx.rules).optionIds], ['o-egg'])
  // An option's own rule changed: the dishes offering it; a dish named: that dish; one on no menu: none.
  assert.deepEqual([...dishesToCheck({ optionIds: ['o-egg'] }, ctx)].sort(), ['d-plain', 'd-rice'])
  assert.deepEqual([...dishesToCheck({ dishIds: ['d-soup', 'gone'] }, ctx)], ['d-soup'])
  assert.equal(dishesToCheck({ itemIds: ['salt'] }, ctx).size, 0)
  assert.equal(changeWords({ kind: 'preferred', items: ['Oyster sauce'], venues: ['Leeds'] }), 'Oyster sauce: the usual supplier switched at Leeds')
  assert.equal(changeWords({ kind: 'recipe', recipes: ['Pad thai sauce'] }), 'Pad thai sauce changed')
  assert.equal(changeWords({ kind: 'quote_allergens', items: ['Soy sauce'], supplier: 'Brakes' }), 'Soy sauce: a product\'s allergens saved (Brakes)')
  assert.equal(changeWords({ kind: 'link', dishes: ['A', 'B', 'C'] }), 'Which recipe A, B and 1 more uses changed')
  assert.equal(changeWords({ kind: 'supplier', supplier: 'Bidfood', on: false }), 'Bidfood switched off')
  assert.equal(changeWords({ kind: 'supplier', supplier: 'Bidfood', on: false, deleted: true }), 'Bidfood deleted, with its prices')
  // Which check a change marks: only the one it can move (options and supplier products aren't in the calories).
  assert.deepEqual(changeMarks('quote_allergens'), { allergens: true, calories: false })
  assert.deepEqual(changeMarks('substitute'), { allergens: true, calories: false })
  assert.deepEqual(changeMarks('option_rule'), { allergens: true, calories: false })
  assert.deepEqual(changeMarks('item'), { allergens: false, calories: true })
  assert.deepEqual(changeMarks('recipe'), { allergens: true, calories: true })
  assert.deepEqual(changeMarks('link'), { allergens: true, calories: true })
  assert.deepEqual(changeMarks(null), { allergens: true, calories: true }, 'a kind not known marks both')
})

test('a substitute delivered counts at its venue: known by the invoice\'s code, else unknown', () => {
  assert.equal(substituteKnown({ invoice_code: 'K12', quote: { supplier_code: 'k12' } }), true)
  assert.equal(substituteKnown({ invoice_code: 'K12', quote: { supplier_code: 'L99' } }), false, 'the line still points at what was ordered')
  assert.equal(substituteKnown({ invoice_name: 'Kikkoman soy', quote: { product_name: 'Kikkoman soy' } }), true)
  assert.equal(substituteKnown({ quote: { supplier_code: 'L99' } }), false, 'no invoice read: what came is not known')
  const ctx = ctxOf()
  ctx.quotes = new Map([['rice', [quote('q-rice', 'rice')]], ['onion', [quote('q-onion', 'onion')]], ['oil', [quote('q-oil', 'oil')]],
    ['egg', [quote('q-egg', 'egg', { allergens_contains: ['eggs'] })]], ['butter', [quote('q-butter', 'butter', { allergens_contains: ['milk'] })]]])
  const dish = ctx.dishes.get('d-rice')
  const base = dishCheck(dish, dishScopes(dish, ctx, [SOHO, LEEDS]).map(s => scopeSuggestion('d-rice', s, ctx)), {}, names)
  assert.equal(base.complete, true)
  assert.deepEqual(Object.keys(base.suggested).sort(), ['eggs', 'milk'])
  // Leeds was sent another rice (its code on the invoice is a product on the list, with gluten); Soho a rice nobody recorded.
  ctx.substitutes = new Map([
    ['rice|' + LEEDS, [{ known: true, quote: quote('q-rice-sub', 'rice', { supplier_name: 'Bidfood', product_name: 'Rice mix', allergens_contains: ['gluten'] }), supplier: 'Bidfood', product: 'Rice mix', day: '2026-11-25' }]],
    ['rice|' + SOHO, [{ known: false, quote: null, supplier: 'Brakes', product: 'Wild rice', day: '2026-11-26' }]],
  ])
  const results = dishScopes(dish, ctx, [SOHO, LEEDS]).map(s => scopeSuggestion('d-rice', s, ctx))
  const leeds = results.find(r => r.scope.venue_id === LEEDS)
  assert.equal(leeds.levels.gluten, 'contains')
  assert.match(evidenceWords(leeds.evidence.gluten[0]), /Rice \(Bidfood: Rice mix, a substitute delivered 25 Nov\)/)
  const soho = results.find(r => r.scope.venue_id === SOHO)
  assert.equal(soho.complete, false)
  assert.match(soho.gaps.find(g => g.reason === 'substitute').text, /A substitute for Rice was delivered at Soho on 26 Nov \(Brakes: Wild rice\): its allergens aren't known/)
  const check = dishCheck(dish, results, { eggs: 'contains', milk: 'contains' }, names)
  assert.deepEqual(check.differences.map(d => d.allergen), ['gluten'])
  assert.equal(check.complete, false)
})

test('a substitute whose allergens aren\'t known is something to look at: it opens the check, even an accepted one', () => {
  const ctx = ctxOf()
  ctx.quotes = new Map([['rice', [quote('q-rice', 'rice')]], ['onion', [quote('q-onion', 'onion')]], ['oil', [quote('q-oil', 'oil')]],
    ['egg', [quote('q-egg', 'egg', { allergens_contains: ['eggs'] })]], ['butter', [quote('q-butter', 'butter', { allergens_contains: ['milk'] })]]])
  const dish = ctx.dishes.get('d-rice')
  const declared = { eggs: 'contains', milk: 'contains' }
  const checkOf = () => dishCheck(dish, dishScopes(dish, ctx, [SOHO, LEEDS]).map(s => scopeSuggestion('d-rice', s, ctx)), declared, names)
  const agrees = checkOf()
  assert.equal(hasReview(agrees), false)
  assert.equal(checkFingerprint(agrees), '', 'nothing to look at')
  // Soho was sent a rice nobody recorded: nothing differs among what is known, but it is not a pass.
  ctx.substitutes = new Map([['rice|' + SOHO, [{ known: false, quote: null, supplier: 'Brakes', product: 'Wild rice', day: '2026-11-26' }]]])
  const sub = checkOf()
  assert.deepEqual(sub.differences, [])
  assert.equal(unknownSubstitutes(sub).length, 1, JSON.stringify(sub.gaps))
  assert.deepEqual(unknownSubstitutes(sub)[0].where, ['Soho'])
  assert.equal(hasReview(sub), true)
  const fp = checkFingerprint(sub)
  assert.match(fp, /^sub:rice@v-soho@2026-11-26$/)
  assert.deepEqual(nextCheck(null, sub), { op: 'insert', status: 'open', reopened: false }, 'a dish that agreed opens')
  assert.deepEqual(nextCheck({ status: 'accepted', fingerprint: '' }, sub), { op: 'update', status: 'open', reopened: true }, 'an accepted check opens again')
  assert.deepEqual(nextCheck({ status: 'dismissed', fingerprint: '' }, sub), { op: 'update', status: 'open', reopened: true }, 'so does a dismissed one')
  assert.deepEqual(nextCheck({ status: 'dismissed', fingerprint: fp }, sub), { op: 'update', status: 'dismissed', reopened: false }, 'dismissed with it: holds')
  // Another delivery of something unrecorded (another day): a new thing to look at.
  ctx.substitutes = new Map([['rice|' + SOHO, [{ known: false, quote: null, supplier: 'Brakes', product: 'Wild rice', day: '2026-11-28' }]]])
  assert.deepEqual(nextCheck({ status: 'dismissed', fingerprint: fp }, checkOf()), { op: 'update', status: 'open', reopened: true })
  // On the price list now, its allergens not put in yet: still something to look at (another key: the product).
  ctx.substitutes = new Map([['rice|' + SOHO, [{ known: true, quote: quote('q-wild', 'rice', { product_name: 'Wild rice', allergens_checked_at: null }), supplier: 'Brakes', product: 'Wild rice', day: '2026-11-26' }]]])
  const listed = checkOf()
  assert.equal(unknownSubstitutes(listed)[0].reason, 'unknown')
  assert.equal(hasReview(listed), true)
  assert.notEqual(checkFingerprint(listed), fp)
  // Its allergens put in, with gluten: a difference now, and no substitute left to look at.
  ctx.substitutes = new Map([['rice|' + SOHO, [{ known: true, quote: quote('q-wild', 'rice', { product_name: 'Wild rice', allergens_contains: ['gluten'] }), supplier: 'Brakes', product: 'Wild rice', day: '2026-11-26' }]]])
  const known = checkOf()
  assert.deepEqual(known.differences.map(d => d.allergen), ['gluten'])
  assert.deepEqual(unknownSubstitutes(known), [])
  assert.equal(checkFingerprint(known), fingerprint(known.differences), 'with no substitute, the differences\' own fingerprint')
  // A dismissal of a difference and a substitute holds once the substitute stops counting; not when the differences change.
  const was = fingerprint(known.differences, unknownSubstitutes(sub))
  assert.equal(dismissalHolds(was, fingerprint(known.differences)), true)
  assert.equal(dismissalHolds(was, fingerprint([])), false)
  assert.equal(dismissalHolds(fingerprint(known.differences), was), false, 'a substitute that wasn\'t there')
  ctx.substitutes = new Map()
  assert.deepEqual(nextCheck({ status: 'open', fingerprint: fp }, checkOf()), { op: 'delete', status: null, reopened: false }, 'gone: nothing to look at')
})
