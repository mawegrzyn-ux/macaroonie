// What is sold, costed (shared/costing.js, inventory phase 2, 27 Nov 2026):
// which recipe a dish uses where (recipeFor(), scored as taxFor() scores a
// tax rule), option rules (add, remove, swap, scale, a recipe of its own,
// nothing) and the till's prefixes, the defaults when an option has no rule,
// a meal deal's picks and its range, goods and services, and a menu's
// margins net of VAT with the thresholds' bands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  recipeFor, linkScore, linkMatches, scopeText, sameScope, ruleFor, ruleText, ruleProblem, dishCost, dishMap,
  menuMargins, marginSteps, costBand, thresholdsFor, thresholdProblem, PREFIX_FACTORS, recipeCost, optionDefault, pickMix,
} from '../costing.js'
import { RULE_WEIGHTS, taxFor } from '../tax.js'
import { PREFIXES } from '../pos/pricing.js'
import { menuCtx } from '../combos.js'

const close = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 1e-6, (msg || '') + ': ' + a + ' is not ' + b)

// ── recipeFor ────────────────────────────────────────────────────

const SOHO = 'v-soho', LEEDS = 'v-leeds', BAR = 's-bar', TERRACE = 's-terrace', TAKE = 't-take', EAT = 't-eat'
const names = {
  venues: { [SOHO]: 'Soho', [LEEDS]: 'Leeds' },
  streams: { [BAR]: 'Bar', [TERRACE]: 'Terrace' },
  types: { [TAKE]: 'Take out', [EAT]: 'Eat in' },
}
const D = 'dish-1'
const link = (id, scope, recipe = id) => ({ id, dish_id: D, recipe_id: 'r-' + recipe, portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null, ...scope })
const every = link('every', {})
const soho = link('soho', { venue_id: SOHO })
const take = link('take', { order_type_id: TAKE })
const sohoTake = link('soho-take', { venue_id: SOHO, order_type_id: TAKE })
const bar = link('bar', { venue_id: SOHO, revenue_stream_id: BAR })
const barTake = link('bar-take', { venue_id: SOHO, revenue_stream_id: BAR, order_type_id: TAKE })
const ALL = [every, soho, take, sohoTake, bar, barTake]
const pick = (scope, links = ALL) => recipeFor(D, scope, links, { names })?.link.id ?? null

test('recipeFor scores as taxFor does: stream 4, order type 2, venue 1', () => {
  assert.deepEqual(RULE_WEIGHTS, { streams: 4, types: 2, venues: 1 }, 'the weights are the tax rules\' own')
  assert.deepEqual(ALL.map(linkScore), [0, 1, 2, 3, 4, 6])
  // The most specific link that matches wins.
  assert.equal(pick({ venue_id: SOHO, revenue_stream_id: BAR, order_type_id: TAKE }), 'bar-take', 'a stream with an order type beats the stream alone')
  assert.equal(pick({ venue_id: SOHO, revenue_stream_id: BAR, order_type_id: EAT }), 'bar', 'a stream link beats a venue and order type link')
  assert.equal(pick({ venue_id: SOHO, revenue_stream_id: BAR, order_type_id: TAKE }, [every, soho, take, sohoTake, bar]), 'bar', 'the stream beats Soho take out (4 > 3)')
  assert.equal(pick({ venue_id: SOHO, revenue_stream_id: TERRACE, order_type_id: TAKE }), 'soho-take', 'another stream: the venue and order type')
  assert.equal(pick({ venue_id: SOHO, revenue_stream_id: TERRACE, order_type_id: EAT }), 'soho', 'the venue alone')
  assert.equal(pick({ venue_id: LEEDS, order_type_id: TAKE }), 'take', 'an order type beats every venue')
  assert.equal(pick({ venue_id: LEEDS, order_type_id: TAKE }, [every, soho, take]), 'take', 'an order type (2) beats a venue (1) where both could match')
  assert.equal(pick({ venue_id: SOHO, order_type_id: TAKE }, [every, soho, take]), 'take')
  assert.equal(pick({ venue_id: LEEDS, order_type_id: EAT }), 'every', 'nothing closer: every venue')
  assert.equal(pick({ venue_id: LEEDS }, [soho]), null, 'no link applies')
  assert.equal(recipeFor('another', { venue_id: SOHO }, ALL), null, 'another dish\'s links never apply')
  // It agrees with taxFor: the same scopes as tax rules pick the same one.
  const rule = (l, rate) => ({ rate, venues: l.revenue_stream_id ? [] : l.venue_id ? [l.venue_id] : [], streams: l.revenue_stream_id ? [l.revenue_stream_id] : [], types: l.order_type_id ? [l.order_type_id] : [] })
  const rates = ALL.map((l, i) => ({ id: l.id, name: l.id, rate: i, values: {}, is_active: true, is_default: i === 0 }))
  const tax = { rate: 'every', rules: ALL.slice(1).map(l => rule(l, l.id)) }
  for (const s of [
    { venue_id: SOHO, revenue_stream_id: BAR, order_type_id: TAKE }, { venue_id: SOHO, revenue_stream_id: BAR, order_type_id: EAT },
    { venue_id: SOHO, revenue_stream_id: TERRACE, order_type_id: TAKE }, { venue_id: SOHO, order_type_id: EAT },
    { venue_id: LEEDS, order_type_id: TAKE }, { venue_id: LEEDS, order_type_id: EAT },
  ]) assert.equal(pick(s), taxFor([tax], s, rates).tax_rate_id, 'recipe and tax agree for ' + JSON.stringify(s))
})

test('a link applies only when every scope it sets matches, and says why in words', () => {
  assert.equal(linkMatches(sohoTake, { venue_id: SOHO }), false, 'Soho take out needs take out')
  assert.equal(linkMatches(bar, { venue_id: SOHO }), false, 'a stream link needs that stream')
  assert.equal(linkMatches(every, {}), true)
  assert.equal(recipeFor(D, { venue_id: SOHO, order_type_id: TAKE }, ALL, { names }).why, 'Take out at Soho')
  assert.equal(scopeText(every, names), 'every venue')
  assert.equal(scopeText(take, names), 'Take out at every venue')
  assert.equal(scopeText(soho, names), 'Soho')
  assert.equal(scopeText(bar, names), 'Bar (Soho)')
  assert.equal(scopeText(barTake, names), 'Take out at Bar (Soho)')
  assert.equal(scopeText({ venue_id: 'gone' }, names), 'a venue')
  assert.ok(sameScope({ venue_id: SOHO, order_type_id: null }, { venue_id: SOHO }))
  assert.ok(!sameScope(soho, sohoTake))
})

// ── dishCost ─────────────────────────────────────────────────────

const V = 'v1'
const item = (id, name, base_unit = 'g', extra = {}) => ({ id, name, base_unit, yield_pct: 100, units: [], ...extra })
const quote = (itemId, packBase, price) => [{ id: 'q-' + itemId, item_id: itemId, supplier_name: 'Brakes', pack_name: 'Pack', pack_count: 1, pack_qty: packBase, pack_unit: 'g', pack_base_qty: packBase, price, venue_prices: {}, is_active: true }]
const items = {
  beef: item('beef', 'Beef patty', 'each'), bun: item('bun', 'Brioche bun', 'each'), cheddar: item('cheddar', 'Cheddar', 'g', { units: [{ name: 'slice', base_qty: 20 }] }),
  onion: item('onion', 'Red onion'), milk: item('milk', 'Milk', 'ml'), oat: item('oat', 'Oat milk', 'ml'), potato: item('potato', 'Potato'),
  bacon: item('bacon', 'Bacon', 'each'), coke: item('coke', 'Coke can', 'each', { barcode: '5000112637922' }),
}
const quotes = {
  beef: quote('beef', 10, 15), bun: quote('bun', 24, 7.2), cheddar: quote('cheddar', 1000, 8), onion: quote('onion', 1000, 2),
  milk: quote('milk', 1000, 1), oat: quote('oat', 1000, 2), potato: quote('potato', 1000, 1), coke: quote('coke', 24, 12),
}
const recipe = (id, name, lines, extra = {}) => ({ id, name, kind: 'dish', portions: 1, status: 'live', variant_of: null, lines: lines.map((l, i) => ({ id: id + '-' + i, sort_order: i, yield_pct: null, ...l })), ...extra })
const recipes = new Map([
  // Beef £1.50, bun £0.30, 2 slices cheddar (40 g) £0.32, onion 20 g £0.04, milk 100 ml £0.10: £2.26
  ['burger', recipe('burger', 'Burger', [{ item_id: 'beef', qty: 1, unit: 'each' }, { item_id: 'bun', qty: 1, unit: 'each' }, { item_id: 'cheddar', qty: 2, unit: 'slice' }, { item_id: 'onion', qty: 20, unit: 'g' }, { item_id: 'milk', qty: 100, unit: 'ml' }])],
  // The takeaway version: no milk wash, a sturdier bun twice: £1.50 + £0.60 + £0.32 + £0.04 = £2.46
  ['burger-to-go', recipe('burger-to-go', 'Burger to go', [{ item_id: 'beef', qty: 1, unit: 'each' }, { item_id: 'bun', qty: 2, unit: 'each' }, { item_id: 'cheddar', qty: 2, unit: 'slice' }, { item_id: 'onion', qty: 20, unit: 'g' }], { variant_of: 'burger' })],
  // Two portions of fries: 400 g potato £0.40, so £0.20 a portion.
  ['fries', recipe('fries', 'Fries', [{ item_id: 'potato', qty: 400, unit: 'g' }], { portions: 2 })],
  ['coke', recipe('coke', 'Coke can', [{ item_id: 'coke', qty: 1, unit: 'each' }])],
])
const options = new Map([
  ['o-cheese', { id: 'o-cheese', label: 'Cheese', group_id: 'g-extras', group_name: 'Extras', variation_type: 'addition', price_mode: 'extra', price_pence: 80 }],
  ['o-bacon', { id: 'o-bacon', label: 'Bacon', group_id: 'g-extras', group_name: 'Extras', variation_type: 'addition', price_mode: 'extra', price_pence: 120 }],
  ['o-onion', { id: 'o-onion', label: 'Onion', group_id: 'g-top', group_name: 'Toppings', variation_type: null, price_mode: 'extra', price_pence: 0 }],
  ['o-oat', { id: 'o-oat', label: 'Oat milk', group_id: 'g-milk', group_name: 'Milk', variation_type: 'modification', price_mode: 'extra', price_pence: 40 }],
  ['o-large', { id: 'o-large', label: 'Large', group_id: 'g-size', group_name: 'Size', variation_type: 'modification', price_mode: 'base', price_pence: 1500 }],
  ['o-fries', { id: 'o-fries', label: 'Fries', group_id: 'g-side', group_name: 'Sides', variation_type: 'side', price_mode: 'extra', price_pence: 250 }],
  ['o-slaw', { id: 'o-slaw', label: 'Slaw', group_id: 'g-side', group_name: 'Sides', variation_type: 'side', price_mode: 'extra', price_pence: 200 }],
  ['o-welldone', { id: 'o-welldone', label: 'Well done', group_id: 'g-cook', group_name: 'Cooking', variation_type: 'modification', price_mode: 'extra', price_pence: 0 }],
  ['o-pickles', { id: 'o-pickles', label: 'Pickles', group_id: 'g-top', group_name: 'Toppings', variation_type: null, price_mode: 'extra', price_pence: 0 }],
])
const rule = (option_id, action, extra = {}) => ({ id: 'rule-' + option_id + (extra.dish_id || ''), option_id, dish_id: null, option_label: null, action, item_id: null, sub_recipe_id: null, swap_item_id: null, qty: null, unit: null, factor: null, recipe_id: null, ...extra })
const rules = [
  rule('o-cheese', 'add', { item_id: 'cheddar', qty: 30, unit: 'g' }),
  rule('o-oat', 'swap', { item_id: 'milk', swap_item_id: 'oat' }),
  rule('o-large', 'scale', { factor: 1.5 }),
  rule('o-fries', 'recipe', { recipe_id: 'fries' }),
  rule('o-welldone', 'nothing'),
  // The double burger's own: its cheese is two slices more.
  rule('o-cheese', 'add', { item_id: 'cheddar', qty: 2, unit: 'slice', dish_id: 'double' }),
  rule(null, 'remove', { dish_id: 'burger-dish', option_label: 'No milk wash', item_id: 'milk' }),
]
const menu = {
  id: 'm1', name: 'Lunch', item_type: null, tax: { rate: 'standard', rules: [{ venues: [], streams: [], types: [TAKE], rate: 'zero' }] },
  sections: [
    { id: 'sec-mains', title: 'Mains', tax: null, items: [
      { id: 'burger-dish', name: 'Burger', price_pence: 1200, kind: null, tax: null, variants: [{ label: 'No milk wash', price_pence: 0 }],
        variant_groups: [
          { group_id: 'g-extras', name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 3, options: [{ option_id: 'o-cheese', label: 'Cheese', price_pence: 80 }, { option_id: 'o-bacon', label: 'Bacon', price_pence: 120 }] },
          { group_id: 'g-side', name: 'Sides', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ option_id: 'o-fries', label: 'Fries', price_pence: 250 }] },
        ] },
      { id: 'double', name: 'Double burger', price_pence: 1500, kind: null, tax: null, variants: [], variant_groups: [] },
      { id: 'salad', name: 'Salad', price_pence: 900, kind: null, tax: null, variants: [], variant_groups: [] },
      { id: 'massage', name: 'Hand massage', price_pence: 2000, kind: null, item_type: 'service', tax: null, variants: [], variant_groups: [] },
    ] },
    { id: 'sec-drinks', title: 'Drinks', tax: null, items: [
      { id: 'coke-dish', name: 'Coke', price_pence: 250, kind: null, item_type: 'goods', barcode: '5000112637922', tax: null, variants: [], variant_groups: [] },
      { id: 'water', name: 'Water', price_pence: 150, kind: null, item_type: 'goods', barcode: '5012345678900', tax: null, variants: [], variant_groups: [] },
    ] },
    { id: 'sec-deals', title: 'Deals', tax: null, items: [
      { id: 'deal', name: 'Lunch deal', kind: 'combo', price_pence: 1500, tax: null, variants: [], variant_groups: [], combo: { mode: 'manual', steps: [
        { id: 'st-main', name: 'Main', min: 1, max: 1, options: [{ id: 'c1', type: 'item', item_id: 'burger-dish' }, { id: 'c2', type: 'item', item_id: 'salad' }, { id: 'c3', type: 'item', item_id: 'double' }] },
        { id: 'st-drink', name: 'Drink', min: 1, max: 1, options: [{ id: 'c4', type: 'section', section_id: 'sec-drinks' }] },
      ] } },
    ] },
  ],
}
const links = [
  { id: 'l1', dish_id: 'burger-dish', recipe_id: 'burger', portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null },
  { id: 'l2', dish_id: 'burger-dish', recipe_id: 'burger-to-go', portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: TAKE },
  { id: 'l3', dish_id: 'double', recipe_id: 'burger', portions: 2, venue_id: null, revenue_stream_id: null, order_type_id: null },
  { id: 'l4', dish_id: 'coke-dish', recipe_id: 'coke', portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null },
]
const rates = [{ id: 'standard', name: 'Standard', rate: 20, values: {}, is_default: true, is_active: true }, { id: 'zero', name: 'Zero', rate: 0, values: {}, is_default: false, is_active: true }]
const ctx = (extra = {}) => ({
  items, quotes, preferred: {}, recipes, venueId: V, basis: 'standard', links, rules, options, names,
  dishes: dishMap([menu]), goods: new Map([['5000112637922', items.coke]]), ...extra,
})
const EATING = { venue_id: V, order_type_id: EAT }

test('a dish costs its recipe times the link\'s portions, the closest link picking the variation', () => {
  const c = dishCost('burger-dish', {}, EATING, ctx())
  close(c.cost, 2.26, 'the burger')
  assert.equal(c.recipe.name, 'Burger')
  assert.equal(c.why, 'every venue')
  assert.equal(c.coverage, 'full')
  const away = dishCost('burger-dish', {}, { venue_id: V, order_type_id: TAKE }, ctx())
  close(away.cost, 2.46, 'the takeaway version')
  assert.equal(away.recipe.name, 'Burger to go')
  assert.equal(away.why, 'Take out at every venue')
  const dbl = dishCost('double', {}, EATING, ctx())
  close(dbl.cost, 4.52, 'two portions of the burger')
  assert.equal(dbl.portions, 2)
  assert.match(dbl.steps[0].text, /£2\.26 a portion x 2, for every venue/)
  // A recipe that makes two portions costs half of its lines a portion.
  close(recipeCost(recipes.get('fries'), ctx()).per_unit, 0.2)
})

test('option rules: add, remove, swap, scale, a recipe of its own, nothing, and the dish\'s own exception', () => {
  const c = sel => dishCost('burger-dish', { options: sel }, EATING, ctx())
  close(c([{ option_id: 'o-cheese' }]).cost, 2.26 + 0.24, 'adds 30 g cheddar (£0.24)')
  close(c([{ option_id: 'o-cheese', qty: 2 }]).cost, 2.26 + 0.48, 'picked twice adds it twice')
  close(c([{ option_id: 'o-oat' }]).cost, 2.26 - 0.1 + 0.2, 'oat milk for milk, the same 100 ml')
  close(c([{ option_id: 'o-large' }]).cost, 2.26 * 1.5, 'large scales the recipe')
  close(c([{ option_id: 'o-large' }, { option_id: 'o-cheese' }]).cost, 2.26 * 1.5 + 0.24, 'the scale is the recipe\'s, not what options add')
  close(c([{ option_id: 'o-fries' }]).cost, 2.26 + 0.2, 'a side is a portion of its own recipe')
  close(c([{ option_id: 'o-welldone' }]).cost, 2.26, 'nothing')
  const own = c([{ option_id: 'v:No milk wash' }])
  close(own.cost, 2.16, 'the dish\'s own option takes the milk out')
  assert.match(own.steps[1].text, /Milk taken out/)
  // The double burger's exception: two slices (40 g, £0.32) instead of 30 g.
  close(dishCost('double', { options: [{ option_id: 'o-cheese' }] }, EATING, ctx()).cost, 4.52 + 0.32)
  assert.equal(ruleFor('double', { id: 'o-cheese' }, rules).from, 'dish')
  assert.equal(ruleFor('burger-dish', { id: 'o-cheese' }, rules).from, 'option')
  assert.equal(ruleFor('burger-dish', { id: 'v:no MILK wash' }, rules).rule.action, 'remove', 'own options by label, any case')
  // Rules act on whichever recipe the link picked: the takeaway version has no milk to swap.
  const away = dishCost('burger-dish', { options: [{ option_id: 'o-oat' }] }, { venue_id: V, order_type_id: TAKE }, ctx())
  close(away.cost, 2.46)
  assert.match(away.steps[1].text, /no Milk in the recipe to swap/)
  assert.equal(ruleText(rules[0], ctx()), 'Adds 30 g Cheddar')
  assert.equal(ruleText(rules[1], ctx()), 'Swaps Milk for Oat milk')
  assert.equal(ruleText(rules[2], ctx()), 'Scales the recipe x 1.5')
})

test('prefixes act on the option\'s own lines: No takes them out, Light halves, Extra doubles, On the side changes nothing', () => {
  assert.deepEqual(PREFIXES.map(p => p.key).sort(), Object.keys(PREFIX_FACTORS).sort(), 'the till\'s prefixes')
  const c = sel => dishCost('burger-dish', { options: sel }, EATING, ctx()).cost
  // Cheese is in the burger (40 g, £0.32): the prefix acts on those lines.
  close(c([{ option_id: 'o-cheese', prefix: 'no' }]), 2.26 - 0.32, 'no cheese')
  close(c([{ option_id: 'o-cheese', prefix: 'light' }]), 2.26 - 0.16, 'light cheese')
  close(c([{ option_id: 'o-cheese', prefix: 'extra' }]), 2.26 + 0.32, 'extra cheese doubles it')
  close(c([{ option_id: 'o-cheese', prefix: 'side' }]), 2.26 + 0.24, 'on the side: as picked')
  // Onion has no rule: its lines are found in the recipe by name (Red onion, £0.04).
  const noOnion = dishCost('burger-dish', { options: [{ option_id: 'o-onion', prefix: 'no' }] }, EATING, ctx())
  close(noOnion.cost, 2.22)
  assert.match(noOnion.steps[1].text, /Red onion taken out \(found by its name\)/)
  assert.equal(noOnion.coverage, 'full')
  // Nothing called Pickles in the recipe: a gap that says how to fix it.
  const noPickles = dishCost('burger-dish', { options: [{ option_id: 'o-pickles', prefix: 'no' }] }, EATING, ctx())
  assert.equal(noPickles.coverage, 'partial')
  assert.match(noPickles.gaps[0].text, /No pickles: nothing in the recipe is called Pickles/)
  assert.match(noPickles.gaps[0].fix, /Options tab/)
  // A side with No: nothing added.
  close(c([{ option_id: 'o-fries', prefix: 'no' }]), 2.26)
  close(c([{ option_id: 'o-fries', prefix: 'extra' }]), 2.26 + 0.4, 'two portions of fries')
})

test('an option with no rule follows its group: an addition and a side are gaps, a modification changes nothing', () => {
  const bacon = dishCost('burger-dish', { options: [{ option_id: 'o-bacon' }] }, EATING, ctx())
  close(bacon.cost, 2.26, 'nothing is added until it has a rule')
  assert.equal(bacon.coverage, 'partial')
  assert.match(bacon.gaps[0].text, /Bacon adds to the dish, but has no rule/)
  const slaw = dishCost('burger-dish', { options: [{ option_id: 'o-slaw' }] }, EATING, ctx())
  assert.match(slaw.gaps[0].text, /Slaw is a side with no recipe linked/)
  const plain = dishCost('burger-dish', { options: [{ option_id: 'o-pickles' }] }, EATING, ctx())
  assert.equal(plain.coverage, 'full', 'a group with no type and no charge: nothing, no gap')
  const gone = dishCost('burger-dish', { options: [{ option_id: 'o-unknown' }] }, EATING, ctx())
  assert.equal(gone.gaps[0].reason, 'option_gone')
})

test('rules are checked before they are saved', () => {
  assert.equal(ruleProblem({ option_id: 'o', action: 'add', item_id: 'x' }), 'Say how much it adds and in what unit')
  assert.equal(ruleProblem({ option_id: 'o', action: 'add', item_id: 'x', sub_recipe_id: 'y', qty: 1, unit: 'g' }), 'Pick the item or prep recipe it adds')
  assert.equal(ruleProblem({ option_id: 'o', action: 'swap', item_id: 'x', swap_item_id: 'x' }), 'An item can\'t be swapped for itself')
  assert.equal(ruleProblem({ option_id: 'o', action: 'swap', item_id: 'x', swap_item_id: 'y', qty: 50 }), 'Give the swap a quantity and a unit, or neither (the same quantity)')
  assert.equal(ruleProblem({ option_id: 'o', action: 'scale', factor: 0 }), 'A scale is more than 0 and at most 20 (large: 1.5)')
  assert.equal(ruleProblem({ action: 'nothing' }), 'A rule is for an option, or for one dish\'s own option')
  assert.equal(ruleProblem({ dish_id: 'd', option_label: 'Extra hot', action: 'nothing' }), null)
  assert.equal(ruleProblem({ option_id: 'o', action: 'recipe', recipe_id: 'r', qty: 2 }), null)
})

test('a dish with no recipe is a gap that says how to fix it; a goods dish offers its stock item; a service is no gap', () => {
  const salad = dishCost('salad', {}, EATING, ctx())
  assert.equal(salad.cost, null)
  assert.equal(salad.coverage, 'none')
  assert.equal(salad.gaps[0].reason, 'no_recipe')
  assert.match(salad.gaps[0].fix, /Dishes tab/)
  const coke = dishCost('coke-dish', {}, EATING, ctx())
  close(coke.cost, 0.5, 'a goods dish linked to its one-line recipe')
  assert.equal(coke.kind, 'goods')
  const unlinked = dishCost('coke-dish', {}, EATING, ctx({ links: [] }))
  assert.deepEqual(unlinked.goods_item, { id: 'coke', name: 'Coke can' })
  assert.match(unlinked.gaps[0].fix, /Link it to Coke can \(the stock item with the same barcode\)/)
  const water = dishCost('water', {}, EATING, ctx())
  assert.equal(water.goods_item, null, 'no stock item has its barcode')
  const massage = dishCost('massage', {}, EATING, ctx())
  assert.equal(massage.kind, 'service')
  assert.equal(massage.coverage, 'not_needed')
  assert.deepEqual(massage.gaps, [])
  // A recipe's own gaps come through, with the recipe named.
  const partial = dishCost('salad', {}, EATING, ctx({
    links: [{ id: 'ls', dish_id: 'salad', recipe_id: 'leaves', portions: 1 }],
    recipes: new Map([...recipes, ['leaves', recipe('leaves', 'Leaves', [{ item_id: 'onion', qty: 50, unit: 'g' }, { item_id: 'saffron', qty: 1, unit: 'g' }])]]),
  }))
  assert.equal(partial.coverage, 'partial')
  assert.match(partial.gaps[0].text, /^Leaves: /)
})

test('a meal deal is the sum of its picks, or the range over its choices', () => {
  const c = ctx({ combo: undefined })
  const picked = dishCost('deal', { picks: [{ dish_id: 'burger-dish', options: [{ option_id: 'o-cheese' }] }, { dish_id: 'coke-dish' }] }, EATING, c)
  close(picked.cost, 2.26 + 0.24 + 0.5, 'the burger with cheese and a coke')
  assert.equal(picked.kind, 'deal')
  // The till's picks ({ stepId: [{ item_id }] }) work too.
  close(dishCost('deal', { picks: { 'st-main': [{ option_id: 'c3', item_id: 'double' }], 'st-drink': [{ option_id: 'c4', item_id: 'coke-dish' }] } }, EATING, c).cost, 4.52 + 0.5)
  const range = menuMargins(menu, EATING, ctx(), { rates }).find(r => r.dish_id === 'deal')
  // Mains: burger 2.26 or double 4.52 (the salad has no recipe); drinks: coke 0.50 (water has none).
  close(range.cost_min, 2.26 + 0.5, 'the cheapest picks')
  close(range.cost_max, 4.52 + 0.5, 'the dearest picks')
  assert.equal(range.coverage, 'partial', 'choices with no recipe make the range partial')
  assert.ok(range.gaps.some(g => /Salad can't be costed/.test(g.text)))
  assert.equal(range.cost, null)
  close(range.cost_pct_min, Math.round(276 / 1250 * 1000) / 10, 'cost % at the cheapest picks: £2.76 of £12.50 net')
  close(range.cost_pct_max, Math.round(502 / 1250 * 1000) / 10)
  assert.equal(range.band, 'over', 'banded at the highest cost %')
  // Typical (phase 5): each step's first choice before there are sales,
  // then the dishes guests pick most.
  const deal = dishCost('deal', {}, EATING, ctx({ combo: menuCtx(menu) }))
  close(deal.typical, 2.26 + 0.5, 'the burger and a coke: the first choice of each step')
  assert.deepEqual(deal.typical_picks.map(p => p.dish_id), ['burger-dish', 'coke-dish'])
  const mix = pickMix([
    { deal_id: 'deal', step_id: 'st-main', dish_id: 'double', qty: 5 }, { deal_id: 'deal', step_id: 'st-main', dish_id: 'burger-dish', qty: 2 },
    { deal_id: 'deal', step_id: 'st-drink', dish_id: 'coke-dish', qty: 3 },
  ])
  close(dishCost('deal', {}, EATING, ctx({ combo: menuCtx(menu), pickMix: mix })).typical, 4.52 + 0.5, 'the double and a coke, picked most')
})

test('menu margins: the menu\'s price net of VAT by order type, cost, GP and cost % with bands and option margins', () => {
  const rows = menuMargins(menu, EATING, ctx(), { rates, settings: null })
  const burger = rows.find(r => r.dish_id === 'burger-dish')
  // £12.00 with 20% VAT: £2.00 VAT, £10.00 net; cost £2.26, GP £7.74, 22.6%.
  assert.equal(burger.vat_rate, 20)
  assert.equal(burger.net_pence, 1000)
  assert.equal(burger.cost_pence, 226)
  assert.equal(burger.gp_pence, 774)
  assert.equal(burger.cost_pct, 22.6)
  assert.equal(burger.band, 'good')
  assert.equal(burger.thresholds.from, 'default')
  // Extra cheese sells at 80p (66.7p net at 20%) and costs 24p.
  const cheese = burger.options.find(o => o.option_id === 'o-cheese')
  assert.equal(cheese.net_pence, 67)
  assert.equal(cheese.cost_pence, 24)
  assert.equal(cheese.gp_pence, 43)
  const bacon = burger.options.find(o => o.option_id === 'o-bacon')
  assert.equal(bacon.cost, null, 'an option with no rule has no margin of its own')
  assert.match(bacon.gaps[0].text, /no rule/)
  // Take out is zero rated on this menu: the net is the whole price, and the takeaway version is costed.
  const away = menuMargins(menu, { venue_id: V, order_type_id: TAKE }, ctx(), { rates }).find(r => r.dish_id === 'burger-dish')
  assert.equal(away.vat_rate, 0)
  assert.equal(away.net_pence, 1200)
  assert.equal(away.cost_pence, 246)
  assert.equal(away.recipe.name, 'Burger to go')
  // Uncosted dishes and services are rows too, never hidden.
  const salad = rows.find(r => r.dish_id === 'salad')
  assert.equal(salad.cost, null)
  assert.equal(salad.band, null)
  assert.equal(salad.coverage, 'none')
  assert.equal(rows.find(r => r.dish_id === 'massage').coverage, 'not_needed')
  // Thresholds: the group's, and a section's own.
  const strict = menuMargins(menu, EATING, ctx(), { rates, settings: { target_pct: 20, limit_pct: 22, sections: [{ section_id: 'sec-drinks', target_pct: 15, limit_pct: 25 }] } })
  assert.equal(strict.find(r => r.dish_id === 'burger-dish').band, 'over')
  const coke = strict.find(r => r.dish_id === 'coke-dish')
  assert.equal(coke.thresholds.from, 'section')
  assert.equal(coke.cost_pct, 24, '50p of £2.08 net')
  assert.equal(coke.band, 'watch')
  const steps = marginSteps(burger).map(s => s.label + ': ' + s.text)
  assert.deepEqual(steps.slice(0, 3), ['Price: £12.00, VAT included', 'VAT: 20% (Standard, the menu\'s setting): £12.00 x 20 / 120', 'Net: £12.00 less £2.00 VAT'])
  assert.match(steps.at(-1), /£2\.26 \/ £10\.00 = 22\.6%: on target \(target 30%, limit 35%\)/)
})

test('bands and thresholds', () => {
  assert.equal(costBand(30, { target_pct: 30, limit_pct: 35 }), 'good', 'at the target is on target')
  assert.equal(costBand(35, { target_pct: 30, limit_pct: 35 }), 'watch')
  assert.equal(costBand(35.1, { target_pct: 30, limit_pct: 35 }), 'over')
  assert.equal(costBand(null), null)
  assert.deepEqual(thresholdsFor(null), { target_pct: 30, limit_pct: 35, from: 'default' })
  assert.deepEqual(thresholdsFor({ target_pct: 28, limit_pct: 33, sections: [] }, 's'), { target_pct: 28, limit_pct: 33, from: 'group' })
  assert.equal(thresholdProblem({ target_pct: 40, limit_pct: 35 }), 'The target can\'t be above the limit')
  assert.equal(thresholdProblem({ target_pct: 0, limit_pct: 35 }), 'A cost % is more than 0 and less than 100')
  assert.equal(thresholdProblem({ target_pct: 30, limit_pct: 30 }), null)
})

// ── Review fixes (phase 2) ───────────────────────────────────────

test('a dish linked to a recipe that is now prep is a gap, never one unit of the batch as a portion', () => {
  // 4 l of milk at £1 a litre makes 2 l: £2 a litre, which is no portion.
  const base = { id: 'base', name: 'Milk base', kind: 'prep', portions: null, yield_qty: 2, yield_unit: 'l', loss_pct: 0, status: 'live', variant_of: null, lines: [{ id: 'b0', sort_order: 0, yield_pct: null, item_id: 'milk', qty: 4, unit: 'l' }] }
  const here = ctx({
    recipes: new Map([...recipes, ['base', base]]),
    links: [...links, { id: 'ls', dish_id: 'salad', recipe_id: 'base', portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null }],
  })
  const c = dishCost('salad', {}, EATING, here)
  assert.equal(c.cost, null)
  assert.equal(c.coverage, 'none')
  assert.equal(c.gaps[0].reason, 'not_dish')
  assert.match(c.gaps[0].text, /Milk base is a prep recipe/)
  assert.ok(!c.steps.some(s => /a portion/.test(s.text)), 'no portion of the batch')
  const row = menuMargins(menu, EATING, here, { rates }).find(r => r.dish_id === 'salad')
  assert.equal(row.cost_pct, null)
  assert.equal(row.band, null)
  // An option that "is a recipe" now prep: a gap, nothing added.
  const side = dishCost('burger-dish', { options: [{ option_id: 'o-fries' }] }, EATING, { ...here, rules: [rule('o-fries', 'recipe', { recipe_id: 'base' })] })
  close(side.cost, 2.26, 'nothing added for the prep recipe')
  assert.equal(side.coverage, 'partial')
  assert.ok(side.gaps.some(g => g.reason === 'not_dish' && g.option_id === 'o-fries'))
})

test('a meal deal\'s cost % range pairs each end\'s picks with what they sell for, extra charges included', () => {
  // A £10 deal: a burger (£3.00), or a premium burger (£6.00) at +£4; an optional brownie (£0.80) at +£3.
  const dealMenu = {
    id: 'm-deal', name: 'Deals', item_type: null, tax: { rate: 'standard', rules: [] },
    sections: [
      { id: 'dm-mains', title: 'Mains', tax: null, items: [
        { id: 'dm-main', name: 'Burger', price_pence: 900, kind: null, tax: null, variants: [], variant_groups: [] },
        { id: 'dm-prem', name: 'Premium burger', price_pence: 1400, kind: null, tax: null, variants: [], variant_groups: [] },
      ] },
      { id: 'dm-desserts', title: 'Desserts', tax: null, items: [{ id: 'dm-brownie', name: 'Brownie', price_pence: 400, kind: null, tax: null, variants: [], variant_groups: [] }] },
      { id: 'dm-deals', title: 'Deals', tax: null, items: [
        { id: 'dm-deal', name: 'Big deal', kind: 'combo', price_pence: 1000, tax: null, variants: [], variant_groups: [], combo: { mode: 'manual', steps: [
          { id: 'ds-main', name: 'Main', min: 1, max: 1, options: [{ id: 'dc1', type: 'item', item_id: 'dm-main', price_pence: 0 }, { id: 'dc2', type: 'item', item_id: 'dm-prem', price_pence: 400 }] },
          { id: 'ds-sweet', name: 'Dessert', min: 0, max: 1, options: [{ id: 'dc3', type: 'item', item_id: 'dm-brownie', price_pence: 300 }] },
        ] } },
      ] },
    ],
  }
  const here = ctx({
    recipes: new Map([...recipes,
      ['r-main', recipe('r-main', 'Burger', [{ item_id: 'beef', qty: 2, unit: 'each' }])],
      ['r-prem', recipe('r-prem', 'Premium burger', [{ item_id: 'beef', qty: 4, unit: 'each' }])],
      ['r-brownie', recipe('r-brownie', 'Brownie', [{ item_id: 'cheddar', qty: 100, unit: 'g' }])]]),
    links: [
      { id: 'dl1', dish_id: 'dm-main', recipe_id: 'r-main', portions: 1 }, { id: 'dl2', dish_id: 'dm-prem', recipe_id: 'r-prem', portions: 1 },
      { id: 'dl3', dish_id: 'dm-brownie', recipe_id: 'r-brownie', portions: 1 },
    ],
  })
  const row = menuMargins(dealMenu, EATING, here, { rates }).find(r => r.dish_id === 'dm-deal')
  assert.equal(row.price_pence, 1000, 'the price shown is the cheapest')
  close(row.cost_min, 3, 'the least the food costs')
  close(row.cost_max, 6.8, 'the most')
  // Burger alone £3.00 of £8.33 net 36.0%; with the brownie £3.80 of £10.83 35.1%;
  // premium £6.00 of £11.67 51.4%; premium and brownie £6.80 of £14.17 48.0%.
  assert.equal(row.cost_pct_min, 35.1)
  assert.equal(row.cost_pct_max, 51.4, 'not £6.80 over the £10 price (81.6%)')
  assert.deepEqual(row.range.cost_pct_max_picks, ['Premium burger'])
  assert.deepEqual(row.range.cost_pct_min_picks, ['Burger', 'Brownie'])
  // GP: least £5.33 (the burger alone), most £7.37 (premium and brownie).
  assert.equal(row.gp_min_pence, 833 - 300)
  assert.equal(row.gp_max_pence, 1417 - 680)
  assert.equal(row.band, 'over')
  const loose = menuMargins(dealMenu, EATING, here, { rates, settings: { target_pct: 50, limit_pct: 55, sections: [] } }).find(r => r.dish_id === 'dm-deal')
  assert.equal(loose.band, 'watch', 'banded at the highest cost %, 51.4%')
  assert.match(marginSteps(row).at(-1).text, /^35\.1% \(Burger, Brownie\) to 51\.4% \(Premium burger\)/)
  // With no extra charges the range is the old one: the cheapest and dearest picks over the price.
  const plain = menuMargins(menu, EATING, ctx(), { rates }).find(r => r.dish_id === 'deal')
  assert.equal(plain.cost_pct_max, Math.round(502 / 1250 * 1000) / 10)
})

test('one rule for an option with no rule: optionDefault() agrees with dishCost()', () => {
  const all = new Map([...options, ['o-sauce', { id: 'o-sauce', label: 'Hot sauce', group_id: 'g-top', group_name: 'Toppings', variation_type: null, price_mode: 'extra', price_pence: 50 }]])
  for (const o of all.values()) {
    const c = dishCost('salad', { options: [{ option_id: o.id }] }, EATING, ctx({ options: all, rules: [], links: [...links, { id: 'ls', dish_id: 'salad', recipe_id: 'fries', portions: 1 }] }))
    const gap = c.gaps.some(g => g.reason === 'no_rule' && g.option_id === o.id)
    assert.equal(optionDefault(o).state === 'gap', gap, o.label)
    if (!gap) assert.equal(c.steps.find(s => s.option_id === o.id).text, optionDefault(o).text, o.label + '\'s words')
  }
  assert.deepEqual([optionDefault(all.get('o-sauce')).state, optionDefault(all.get('o-sauce')).type], ['gap', 'extra'], 'a priced extra with no type')
  assert.match(optionDefault(all.get('o-sauce')).text, /Costs extra/)
  assert.equal(optionDefault(all.get('o-pickles')).state, 'default', 'no type, no charge')
  assert.deepEqual(optionDefault({ own: true }), { state: 'default', type: 'modification', text: 'Changes nothing until it has a rule' })
})

test('meal deal picks from the till and from a basket keep their options', () => {
  const c = ctx({ combo: undefined })
  // A till line's combo parts: [{ item_id, modifiers: [{ option_id, prefix }] }].
  const till = dishCost('deal', { picks: [{ item_id: 'burger-dish', modifiers: [{ option_id: 'o-cheese', prefix: null }] }, { item_id: 'coke-dish', modifiers: [] }] }, EATING, c)
  close(till.cost, 2.26 + 0.24 + 0.5, 'the cheese on the till\'s burger')
  const noOnion = dishCost('deal', { picks: [{ item_id: 'burger-dish', modifiers: [{ option_id: 'o-onion', prefix: 'no' }] }] }, EATING, c)
  close(noOnion.cost, 2.22, 'a prefix comes through')
  // A basket's selection.combo: { stepId: [{ option_id, item_id, choices: { groupKey: [optionId, ...] } }] }.
  const basket = dishCost('deal', { picks: { 'st-main': [{ option_id: 'c1', item_id: 'burger-dish', choices: { 'g-extras': ['o-cheese', 'o-cheese'] } }], 'st-drink': [{ option_id: 'c4', item_id: 'coke-dish', choices: {} }] } }, EATING, c)
  close(basket.cost, 2.26 + 0.48 + 0.5, 'cheese picked twice')
})

test('steps carry their words without money for people without Costing view', () => {
  const double = dishCost('double', {}, EATING, ctx())
  const step = double.steps.find(s => s.kind === 'recipe')
  assert.match(step.text, /£/)
  assert.equal(step.plain, '2 portions, for every venue')
  const deal = dishCost('deal', {}, EATING, ctx({ combo: menuCtx(menu) }))
  const parts = deal.steps.filter(s => s.kind === 'part')
  assert.ok(parts.some(s => /£/.test(s.text)), 'the mains step has its range in pounds')
  assert.ok(parts.every(s => typeof s.plain === 'string' && !/£/.test(s.plain)))
  for (const s of [...double.steps, ...deal.steps]) assert.doesNotMatch(s.plain ?? s.text, /£/, s.kind)
})
