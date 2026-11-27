// Inventory phase 3 (shared/costing.js, 27 Nov 2026): drafts Pepper wrote are
// costed but never as if finished (needsCheck(), the "not checked yet" gap,
// on the recipe and on every dish linked to it), and coverage by sales: a
// dish sold at its scope is costed when dishCost() there has no gaps and its
// options have rules (soldState()); the share is the item mapping's rule
// (coverageShare()), services and dishes on no menu left out of both sides
// (salesCoverage()).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  recipeCost, dishCost, dishMap, needsCheck, soldState, salesCoverage, costedShare, optionGaps, explain, COVERAGE_DAYS,
} from '../costing.js'
import { coverageShare } from '../itemMapping.js'

const close = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 1e-6, (msg || '') + ': ' + a + ' is not ' + b)

const V = 'v1', V2 = 'v2', TAKE = 't-take'
const item = (id, name, base_unit = 'g') => ({ id, name, base_unit, yield_pct: 100, units: [] })
const quote = (itemId, packBase, price) => [{ id: 'q-' + itemId, item_id: itemId, supplier_name: 'Brakes', pack_name: 'Pack', pack_count: 1, pack_qty: packBase, pack_unit: 'g', pack_base_qty: packBase, price, venue_prices: {}, is_active: true }]
const items = { beef: item('beef', 'Beef patty', 'each'), bun: item('bun', 'Brioche bun', 'each'), mayo: item('mayo', 'Mayonnaise', 'ml'), cheddar: item('cheddar', 'Cheddar') }
const quotes = { beef: quote('beef', 10, 15), bun: quote('bun', 24, 7.2), mayo: quote('mayo', 1000, 4), cheddar: quote('cheddar', 1000, 8) }
const recipe = (id, name, lines, extra = {}) => ({
  id, name, kind: 'dish', portions: 1, status: 'live', source: null, variant_of: null,
  lines: lines.map((l, i) => ({ id: id + '-' + i, sort_order: i, yield_pct: null, ...l })), ...extra,
})
const recipes = new Map([
  // £1.50 + £0.30 = £1.80, fully costed.
  ['burger', recipe('burger', 'Burger', [{ item_id: 'beef', qty: 1, unit: 'each' }, { item_id: 'bun', qty: 1, unit: 'each' }])],
  // Read in by Pepper, not checked: costed (£1.80 + 20 ml mayo £0.08), with the draft gap.
  ['read', recipe('read', 'Read burger', [{ item_id: 'beef', qty: 1, unit: 'each' }, { item_id: 'bun', qty: 1, unit: 'each' }, { item_id: 'mayo', qty: 20, unit: 'ml' }], { status: 'draft', source: 'reader' })],
  // A variation a person made: a draft with no source, costed as it is.
  ['copy', recipe('copy', 'Burger (variation)', [{ item_id: 'beef', qty: 1, unit: 'each' }], { status: 'draft', variant_of: 'burger' })],
  // Made by Pepper in the chat and then made live: checked.
  ['made', recipe('made', 'Made burger', [{ item_id: 'beef', qty: 1, unit: 'each' }], { source: 'pepper' })],
  // A dish with a line nobody priced (no quote for it).
  ['salad', recipe('salad', 'Salad', [{ item_id: 'lettuce', qty: 50, unit: 'g' }])],
])
const options = new Map([
  ['o-cheese', { id: 'o-cheese', label: 'Cheese', group_id: 'g-extras', group_name: 'Extras', variation_type: 'addition', price_mode: 'extra', price_pence: 80 }],
  ['o-well', { id: 'o-well', label: 'Well done', group_id: 'g-cook', group_name: 'Cooking', variation_type: 'modification', price_mode: 'extra', price_pence: 0 }],
])
const dish = (id, name, extra = {}) => ({ id, name, price_pence: 1000, kind: null, tax: null, variants: [], variant_groups: [], ...extra })
const menu = {
  id: 'm1', name: 'Lunch', sections: [{ id: 's1', title: 'Mains', items: [
    dish('d-burger', 'Burger'),
    dish('d-cheesy', 'Cheeseburger', { variant_groups: [
      { group_id: 'g-extras', name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 2, options: [{ option_id: 'o-cheese', label: 'Cheese', price_pence: 80 }] },
      { group_id: 'g-cook', name: 'Cooking', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ option_id: 'o-well', label: 'Well done', price_pence: 0 }] },
    ] }),
    dish('d-read', 'Read burger'),
    dish('d-copy', 'Variation burger'),
    dish('d-salad', 'Salad'),
    dish('d-none', 'Soup of the day'),
    dish('d-service', 'Corkage', { item_type: 'service' }),
  ] }],
}
const link = (dish_id, recipe_id, extra = {}) => ({ id: 'l-' + dish_id + (extra.order_type_id || ''), dish_id, recipe_id, portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null, ...extra })
const links = [
  link('d-burger', 'burger'), link('d-cheesy', 'burger'), link('d-read', 'read'), link('d-copy', 'copy'), link('d-salad', 'salad'),
  // Takeaway burgers use the read-in draft.
  link('d-burger', 'read', { order_type_id: TAKE }),
]
const ctx = (extra = {}) => ({
  items: { ...items, lettuce: item('lettuce', 'Lettuce') }, quotes, preferred: {}, recipes, venueId: V, basis: 'standard', links, rules: [], options,
  names: { venues: { [V]: 'Soho', [V2]: 'Leeds' }, streams: {}, types: { [TAKE]: 'Take out' } }, dishes: dishMap([menu]), ...extra,
})

test('a draft Pepper wrote is costed, with the gap "not checked yet"; a person\'s draft and a checked one are not held back', () => {
  assert.equal(needsCheck(recipes.get('read')), true)
  assert.equal(needsCheck(recipes.get('copy')), false, 'a variation a person made starts as a draft with no source')
  assert.equal(needsCheck(recipes.get('made')), false, 'made live: checked')
  assert.equal(needsCheck({ status: 'draft', source: 'pepper' }), true)
  const read = recipeCost(recipes.get('read'), ctx())
  close(read.per_unit, 1.88, 'still costed')
  assert.equal(read.coverage, 'partial', 'but never as if it were finished')
  const g = read.gaps.find(x => x.reason === 'draft')
  assert.match(g.text, /Read burger is a draft Pepper read in, not checked yet/)
  assert.match(g.fix, /make it live/)
  assert.ok(explain(recipes.get('read'), ctx()).rows.some(r => r.kind === 'gap' && /not checked yet/.test(r.steps[0])), 'the explanation says so')
  assert.equal(recipeCost(recipes.get('copy'), ctx()).coverage, 'full')
  assert.equal(recipeCost(recipes.get('made'), ctx()).coverage, 'full')
  // Live: the gap goes.
  const live = { ...recipes.get('read'), status: 'live' }
  assert.equal(recipeCost(live, ctx({ recipes: new Map([...recipes, ['read', live]]) })).coverage, 'full')
  // A dish linked to it carries the gap, at the scope that uses it.
  const eat = dishCost('d-burger', {}, { venue_id: V }, ctx())
  assert.equal(eat.coverage, 'full')
  const away = dishCost('d-burger', {}, { venue_id: V, order_type_id: TAKE }, ctx())
  close(away.cost, 1.88)
  assert.equal(away.coverage, 'partial')
  assert.ok(away.gaps.some(x => x.reason === 'draft' && x.recipe_id === 'read'))
  // A prep recipe Pepper read, inside a checked dish: the dish is partly costed too.
  const sauce = recipe('sauce', 'Burger sauce', [{ item_id: 'mayo', qty: 1000, unit: 'ml' }], { kind: 'prep', yield_qty: 1, yield_unit: 'l', portions: null, loss_pct: 0, status: 'draft', source: 'reader' })
  const withSauce = recipe('ws', 'Burger with sauce', [{ item_id: 'beef', qty: 1, unit: 'each' }, { sub_recipe_id: 'sauce', qty: 20, unit: 'ml' }])
  const c2 = ctx({ recipes: new Map([...recipes, ['sauce', sauce], ['ws', withSauce]]) })
  const ws = recipeCost(withSauce, c2)
  assert.equal(ws.coverage, 'partial')
  assert.ok(ws.gaps.some(x => x.reason === 'sub_partial' && /Burger sauce/.test(x.text)))
})

test('soldState: costed, or how to fix it (link, recipe, option rule, map); services and gone dishes left out', () => {
  const s = (dish_id, extra = {}) => soldState({ dish_id, venue_id: V, revenue_stream_id: null, order_type_id: null, ...extra }, ctx())
  assert.equal(s('d-burger').state, 'costed')
  assert.equal(s('d-burger').why, 'every venue')
  const none = s('d-none')
  assert.equal(none.state, 'uncosted')
  assert.equal(none.reason, 'link')
  assert.match(none.fixes[0].text, /Link it to its recipe/)
  const salad = s('d-salad')
  assert.equal(salad.reason, 'recipe')
  assert.equal(salad.fixes[0].recipe_id, 'salad')
  assert.match(salad.fixes[0].text, /Lettuce has no supplier price/)
  // An option that adds something with no rule leaves the dish not costed; a modification doesn't.
  const cheesy = s('d-cheesy')
  assert.equal(cheesy.state, 'uncosted')
  assert.deepEqual(cheesy.fixes.map(f => [f.kind, f.option_id]), [['option', 'o-cheese']])
  assert.match(cheesy.fixes[0].text, /Extras: Cheese needs a rule/)
  assert.deepEqual(optionGaps(ctx().dishes.get('d-cheesy'), ctx()).map(o => o.option_id), ['o-cheese'])
  const ruled = soldState({ dish_id: 'd-cheesy', venue_id: V }, ctx({ rules: [{ id: 'r1', option_id: 'o-cheese', dish_id: null, option_label: null, action: 'add', item_id: 'cheddar', qty: 30, unit: 'g' }] }))
  assert.equal(ruled.state, 'costed', 'given a rule, it is costed')
  // The read-in draft: costed in money, but not counted as costed until checked.
  assert.equal(s('d-read').state, 'uncosted')
  assert.equal(s('d-read').fixes[0].recipe_id, 'read')
  assert.equal(s('d-copy').state, 'costed', 'a person\'s draft counts')
  assert.equal(s('d-burger', { order_type_id: TAKE }).state, 'uncosted', 'takeaway uses the draft')
  assert.deepEqual([s('d-service').state, s('d-service').reason], ['left_out', 'service'])
  assert.deepEqual([s('gone').state, s('gone').reason], ['left_out', 'gone'])
  const unmapped = soldState({ dish_id: null, name: 'Loyverse burger', mapping: 'unmapped' }, ctx())
  assert.deepEqual([unmapped.state, unmapped.reason], ['uncosted', 'map'])
  assert.match(unmapped.fixes[0].text, /Item mapping page/)
  assert.match(soldState({ dish_id: null, mapping: 'kept' }, ctx()).fixes[0].text, /kept as sold/)
})

test('salesCoverage: the share of what sold, by channel and venue, the uncosted dishes most sold first', () => {
  const row = (channel, dish_id, sales_pence, qty, extra = {}) => ({ channel, dish_id, name: extra.name || dish_id, venue_id: V, revenue_stream_id: null, order_type_id: null, mapping: null, qty, sales_pence, ...extra })
  const rows = [
    row('till', 'd-burger', 6000, 6),
    row('kiosk', 'd-burger', 2000, 2),
    row('online', 'd-burger', 1000, 1, { order_type_id: TAKE }),
    row('till', 'd-salad', 900, 1),
    row('till', 'd-none', 3000, 3),
    row('till', 'd-service', 500, 1),
    row('till', 'gone', 700, 1, { name: 'Old special' }),
    row('imported', null, 400, 2, { name: 'Loyverse latte', mapping: 'unmapped', venue_id: V2 }),
  ]
  const asked = []
  const c = salesCoverage(rows, v => { asked.push(v); return { ...ctx(), venueId: v } })
  assert.equal(c.total_pence, 14500)
  assert.equal(c.costed_pence, 8000)
  assert.equal(c.left_out_pence, 1200, 'the service and the dish on no menu')
  assert.equal(c.uncosted_pence, 5300)
  // 8000 of 13300 not left out: the item mapping's rule, to one place.
  assert.equal(c.percent, 60.2)
  assert.equal(c.percent, coverageShare({ total: 14500, mapped: 8000, ignored: 1200 }))
  assert.equal(costedShare({ total_pence: 0 }), null, 'nothing sold: no share')
  assert.equal(c.channels.till.percent, Math.round(6000 / (6000 + 900 + 3000) * 1000) / 10)
  assert.equal(c.channels.online.percent, 0, 'the takeaway burger uses the draft')
  assert.equal(c.channels.imported.percent, 0)
  assert.equal(c.venues[V2].total_pence, 400)
  // Most sold first, each with how to fix it and where it was sold.
  assert.deepEqual(c.dishes.map(d => d.name), ['Soup of the day', 'Burger', 'Salad', 'Loyverse latte'])
  const burger = c.dishes.find(d => d.dish_id === 'd-burger')
  assert.equal(burger.sales_pence, 1000)
  assert.deepEqual(burger.where, ['Take out at Soho'])
  assert.deepEqual(burger.channels, ['online'])
  assert.equal(c.dishes.find(d => d.name === 'Loyverse latte').mapping, 'unmapped')
  assert.deepEqual(c.left_out.map(l => [l.name, l.reason]), [['Old special', 'gone'], ['Corkage', 'service']])
  // Each dish and scope judged once, the ctx asked per venue.
  assert.ok(asked.every(v => v === V || v === V2))
  const judged = []
  salesCoverage(rows, v => ({ ...ctx(), venueId: v }), { judged })
  assert.equal(judged.length, rows.length)
  assert.equal(judged[0].state.state, 'costed')
  assert.equal(COVERAGE_DAYS, 30)
  // Nothing sold.
  const empty = salesCoverage([], () => ctx())
  assert.deepEqual([empty.total_pence, empty.percent, empty.dishes.length], [0, null, 0])
})
