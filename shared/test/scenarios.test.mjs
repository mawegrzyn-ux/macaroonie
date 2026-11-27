// Cost scenarios (inventory phase 7a, shared/scenarios.js): a price changed
// by a percentage with rounding, by a figure, set; a cost changed; where a
// price lives on a dish (its own, its options that set its price as its own
// prices, extras left alone); the weighted cost % and GP at the real mix
// before and after on a worked menu, a meal deal following its picks, a dish
// with no cost left out of both sides; and Push prices' copy of the menu.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  changedPrice, changedCost, changeProblem, changeApplies, changeWords, applyPrices, scenarioFigures, pushPrices, priceStamp, scenarioCsvRows, scenarioCsv,
} from '../scenarios.js'
import { dishMap } from '../costing.js'
import { menuSaveBody } from '../menuSave.js'

test('a price after a change: a percentage rounded up, near or down, a figure, set, never below nothing', () => {
  assert.equal(changedPrice(1250, { how: 'percent', value: 10 }), 1375)
  assert.equal(changedPrice(1250, { how: 'percent', value: 10, round_to: 10, round: 'up' }), 1380)
  assert.equal(changedPrice(1250, { how: 'percent', value: 10, round_to: 10, round: 'down' }), 1370)
  assert.equal(changedPrice(1250, { how: 'percent', value: 10, round_to: 50 }), 1400)
  assert.equal(changedPrice(1250, { how: 'amount', value: 0.5 }), 1300)
  assert.equal(changedPrice(1250, { how: 'amount', value: -20 }), 0)
  assert.equal(changedPrice(1250, { how: 'set', value: 12.95 }), 1295)
  assert.equal(changedPrice(null, { how: 'percent', value: 10 }), null)
  // 4.4 x 1.1 is 4.840000000000001 in floating point: the rule rounds that away before rounding up.
  assert.equal(changedPrice(440, { how: 'percent', value: 10, round_to: 1, round: 'up' }), 484)
})

test('a cost after a change, and what a change must say', () => {
  assert.equal(changedCost(2, { how: 'percent', value: 10 }), 2.2)
  assert.equal(changedCost(2, { how: 'amount', value: -0.25 }), 1.75)
  assert.equal(changedCost(null, { how: 'percent', value: 10 }), null)
  assert.equal(changedCost(null, { how: 'set', value: 3.2 }), 3.2, 'a set cost gives an uncosted dish one')
  assert.equal(changeProblem({ what: 'price', applies: 'all', how: 'percent', value: 5 }), null)
  assert.match(changeProblem({ what: 'price', applies: 'dish', how: 'percent', value: 5 }), /Pick the dish/)
  assert.match(changeProblem({ what: 'price', applies: 'all', how: 'percent', value: 900 }), /percentage/)
  assert.match(changeProblem({ what: 'cost', applies: 'all', how: 'set', value: -1 }), /set from/)
  assert.match(changeProblem({ what: 'price', applies: 'all', how: 'percent', value: 5, round_to: 3 }), /Round to/)
  assert.equal(changeApplies({ applies: 'section', section_id: 's1' }, { dish_id: 'd', section_id: 's1' }), true)
  assert.equal(changeApplies({ applies: 'dish', dish_id: 'x' }, { dish_id: 'd', section_id: 's1' }), false)
  assert.equal(changeWords({ what: 'price', applies: 'section', section_id: 's1', how: 'percent', value: 5, round_to: 10, round: 'up' }, { sections: { s1: 'Mains' } }),
    'Prices of Mains up 5% (rounded up to 10p)')
  assert.equal(changeWords({ what: 'cost', applies: 'dish', dish_id: 'd', how: 'set', value: 3.2 }, { dishes: { d: 'Burger' } }), 'Costs of Burger set to £3.20')
})

// ── A worked menu ────────────────────────────────────────────────

const V = 'v1', EAT = 't-eat'
const item = (id, name, base_unit, extra = {}) => ({ id, name, base_unit, yield_pct: 100, units: [], ...extra })
const quote = (itemId, packBase, price) => [{ id: 'q-' + itemId, item_id: itemId, supplier_name: 'Brakes', pack_name: 'Pack', pack_count: 1, pack_qty: packBase, pack_unit: 'g', pack_base_qty: packBase, price, venue_prices: {}, is_active: true }]
const items = { beef: item('beef', 'Beef patty', 'each'), bun: item('bun', 'Bun', 'each'), potato: item('potato', 'Potato', 'g'), coke: item('coke', 'Coke can', 'each') }
const quotes = { beef: quote('beef', 10, 15), bun: quote('bun', 24, 7.2), potato: quote('potato', 1000, 1), coke: quote('coke', 24, 12) }
const recipe = (id, name, lines) => ({ id, name, kind: 'dish', portions: 1, status: 'live', variant_of: null, lines: lines.map((l, i) => ({ id: id + '-' + i, sort_order: i, yield_pct: null, ...l })) })
const recipes = new Map([
  // Beef £1.50 and a bun £0.30: £1.80.
  ['r-burger', recipe('r-burger', 'Burger', [{ item_id: 'beef', qty: 1, unit: 'each' }, { item_id: 'bun', qty: 1, unit: 'each' }])],
  // 200 g of potato: £0.20.
  ['r-fries', recipe('r-fries', 'Fries', [{ item_id: 'potato', qty: 200, unit: 'g' }])],
  ['r-coke', recipe('r-coke', 'Coke', [{ item_id: 'coke', qty: 1, unit: 'each' }])],
])
const link = (dish_id, recipe_id) => ({ id: 'l-' + dish_id, dish_id, recipe_id, portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null })
const links = [link('burger', 'r-burger'), link('fries', 'r-fries'), link('coke', 'r-coke')]
const rates = [{ id: 'standard', name: 'Standard', rate: 20, values: {}, is_default: true, is_active: true }]
// As the draft loads it (loadMenuFull()): an option group's options with the group's price and this dish's.
const menu = {
  id: 'm1', name: 'Lunch', tax: { rate: 'standard', rules: [] }, item_type: null,
  sections: [
    { id: 'sec-mains', title: 'Mains', tax: null, items: [
      { id: 'burger', name: 'Burger', price_pence: 1200, kind: 'dish', tax: null, variants: [], variant_groups: [
        { group_id: 'g-extras', name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 2, options: [{ option_id: 'o-cheese', label: 'Cheese', price_pence: 80, default_pence: 80, overridden: false }] },
      ] },
      // Priced by its sizes; no recipe, so it has no cost.
      { id: 'pizza', name: 'Pizza', price_pence: null, kind: 'dish', tax: null, variants: [], variant_groups: [
        { group_id: 'g-size', name: 'Size', price_mode: 'base', min_select: 1, max_select: 1, options: [
          { option_id: 'o-small', label: 'Small', price_pence: 900, default_pence: 900, overridden: false },
          { option_id: 'o-large', label: 'Large', price_pence: 1300, default_pence: 1200, overridden: true },
        ] },
      ] },
      { id: 'fries', name: 'Fries', price_pence: 400, kind: 'dish', tax: null, variants: [], variant_groups: [] },
    ] },
    { id: 'sec-drinks', title: 'Drinks', tax: null, items: [
      { id: 'coke', name: 'Coke', price_pence: 250, kind: 'dish', tax: null, variants: [], variant_groups: [] },
    ] },
    { id: 'sec-deals', title: 'Deals', tax: null, items: [
      // £15.00, and the coke in it is 50p more.
      { id: 'deal', name: 'Lunch deal', kind: 'combo', price_pence: 1500, tax: null, variants: [], variant_groups: [], combo: { mode: 'manual', steps: [
        { id: 'st-main', name: 'Main', min: 1, max: 1, options: [{ id: 'c1', type: 'item', item_id: 'burger', price_pence: 0 }] },
        { id: 'st-drink', name: 'Drink', min: 1, max: 1, options: [{ id: 'c2', type: 'item', item_id: 'coke', price_pence: 50 }] },
      ] } },
    ] },
  ],
}
const ctx = { items, quotes, preferred: {}, recipes, venueId: V, basis: 'standard', links, rules: [], options: new Map(), names: {}, dishes: dishMap([menu]), goods: new Map() }
const SCOPE = { venue_id: V, revenue_stream_id: null, order_type_id: EAT }
const UNITS = { burger: 100, fries: 80, pizza: 30, coke: 50, deal: 20 }
const CHANGES = [
  { what: 'price', applies: 'all', how: 'percent', value: 10, round_to: 10, round: 'up' },
  { what: 'cost', applies: 'dish', dish_id: 'burger', how: 'amount', value: 0.2 },
  { what: 'price', applies: 'dish', dish_id: 'coke', how: 'set', value: 3 },
]

test('where a price lives: the dish\'s own, its sizes as its own prices, extras left alone; set refused on a dish priced by its options', () => {
  const pizza = menu.sections[0].items[1]
  const r = applyPrices(pizza, 'sec-mains', [CHANGES[0]])
  assert.deepEqual(r.prices.map(p => [p.kind, p.label, p.from_pence, p.to_pence]), [['option', 'Small', 900, 990], ['option', 'Large', 1300, 1430]])
  const sizes = r.item.variant_groups[0].options
  assert.equal(sizes[0].overridden, true, 'Small now has the dish\'s own price')
  assert.equal(pizza.variant_groups[0].options[0].price_pence, 900, 'the menu given is not changed')
  const burger = applyPrices(menu.sections[0].items[0], 'sec-mains', [CHANGES[0]])
  assert.deepEqual(burger.prices.map(p => [p.kind, p.from_pence, p.to_pence]), [['dish', 1200, 1320]], 'the extra cheese keeps its price')
  const set = applyPrices(pizza, 'sec-mains', [{ what: 'price', applies: 'dish', dish_id: 'pizza', how: 'set', value: 10 }])
  assert.equal(set.prices.length, 0)
  assert.match(set.skipped[0], /priced by its options/)
  // Back to the group's price: no dish price of its own is kept.
  const back = applyPrices(pizza, 'sec-mains', [{ what: 'price', applies: 'dish', dish_id: 'pizza', how: 'amount', value: -1 }])
  assert.equal(back.item.variant_groups[0].options[1].price_pence, 1200)
  assert.equal(back.item.variant_groups[0].options[1].overridden, false)
})

test('the worked menu at the real mix, before and after', () => {
  const fig = scenarioFigures(menu, SCOPE, ctx, { rates, changes: CHANGES, units: UNITS })
  const by = Object.fromEntries(fig.dishes.map(d => [d.dish_id, d]))
  // Before. Burger £12.00: £10.00 net, costs £1.80, GP £8.20, 18%.
  assert.deepEqual([by.burger.before.net_pence, by.burger.before.cost_pence, by.burger.before.gp_pence, by.burger.before.cost_pct], [1000, 180, 820, 18])
  // Fries £4.00: £3.33 net; coke £2.50: £2.08 net.
  assert.equal(by.fries.before.net_pence, 333)
  assert.equal(by.coke.before.net_pence, 208)
  // The deal at its typical picks (the burger and a coke): £15.00 and the coke's 50p, £12.92 net; £1.80 + £0.50 = £2.30.
  assert.equal(by.deal.before.price_pence, 1550)
  assert.equal(by.deal.before.net_pence, 1292)
  assert.equal(by.deal.before.cost, 2.3)
  assert.deepEqual(by.deal.typical_picks, ['Burger', 'Coke'])
  // After. Prices up 10% rounded up to 10p: the burger £13.20, fries £4.40; the coke set to £3.00; the deal £16.50 and 50p.
  assert.equal(by.burger.after.price_pence, 1320)
  assert.equal(by.burger.after.cost, 2, 'its cost up 20p')
  assert.equal(by.fries.after.price_pence, 440)
  assert.equal(by.coke.after.price_pence, 300)
  assert.equal(by.deal.after.price_pence, 1700)
  assert.equal(by.deal.after.cost, 2.5, 'the burger in it costs 20p more too, once')
  // Pizza has no cost: left out of both sides, with its 30 units named.
  assert.equal(by.pizza.in_totals, false)
  assert.equal(by.pizza.price_changed, true)
  assert.deepEqual(fig.left_out, [{ dish_id: 'pizza', name: 'Pizza', units: 30, why: 'not costed' }])
  // At the mix. Before: net 100 x 1000 + 80 x 333 + 50 x 208 + 20 x 1292 = 162,880p; cost 100 x 1.80 + 80 x 0.20 + 50 x 0.50 + 20 x 2.30 = £267.00.
  const t = fig.total
  assert.equal(t.units, 280)
  assert.equal(t.left_out_units, 30)
  assert.equal(t.before.units, 250)
  assert.equal(t.before.net_pence, 162880)
  assert.equal(t.before.cost_pence, 26700)
  assert.equal(t.before.gp_pence, 136180)
  assert.equal(t.before.cost_pct, 16.4)
  // After: net 100 x 1100 + 80 x 367 + 50 x 250 + 20 x 1417 = 180,200p; cost 200 + 16 + 25 + 50 = £291.00.
  assert.equal(t.after.net_pence, 180200)
  assert.equal(t.after.cost_pence, 29100)
  assert.equal(t.after.gp_pence, 151100)
  assert.equal(t.after.cost_pct, 16.1)
  assert.deepEqual(t.change, { gp_pence: 14920, cost_pct_pts: -0.3 })
  // Per section: Mains holds the burger and fries (the pizza left out).
  const mains = fig.sections.find(s => s.section_id === 'sec-mains')
  assert.equal(mains.before.net_pence, 100 * 1000 + 80 * 333)
  assert.equal(mains.left_out_units, 30)
  // The CSV has a row a dish and the totals.
  const csv = scenarioCsvRows(fig)
  assert.equal(csv[0][0], 'Section')
  assert.equal(csv.length, 1 + fig.dishes.length + 2)
  assert.equal(scenarioCsvRows(fig, { sales: false }).at(-1)[5], '', 'net at the mix left out without sales')
})

test('a cost change for a meal deal itself is said to reach it through its picks; nothing changes, nothing moves', () => {
  const fig = scenarioFigures(menu, SCOPE, ctx, { rates, changes: [{ what: 'cost', applies: 'dish', dish_id: 'deal', how: 'amount', value: 1 }], units: UNITS })
  const deal = fig.dishes.find(d => d.dish_id === 'deal')
  assert.equal(deal.after.cost, deal.before.cost)
  assert.match(deal.skipped[0], /meal deal/)
  const none = scenarioFigures(menu, SCOPE, ctx, { rates, changes: [], units: UNITS })
  assert.deepEqual(none.total.change, { gp_pence: 0, cost_pct_pts: 0 })
})

test('a cost change for a meal deal\'s own section changes nothing on the deal, and says so (7a review)', () => {
  const fig = scenarioFigures(menu, SCOPE, ctx, { rates, changes: [{ what: 'cost', applies: 'section', section_id: 'sec-deals', how: 'percent', value: 10 }], units: UNITS })
  const deal = fig.dishes.find(d => d.dish_id === 'deal')
  assert.equal(deal.after.cost, deal.before.cost, 'its picks sit in Mains and Drinks')
  assert.equal(deal.skipped.length, 1)
  assert.match(deal.skipped[0], /^Lunch deal is a meal deal: .+ a cost change for Deals reaches it only through those dishes$/)
  // A change for another section reaches it through its picks, with nothing said.
  const mains = scenarioFigures(menu, SCOPE, ctx, { rates, changes: [{ what: 'cost', applies: 'section', section_id: 'sec-mains', how: 'amount', value: 0.2 }], units: UNITS })
  const d2 = mains.dishes.find(d => d.dish_id === 'deal')
  assert.equal(d2.after.cost, 2.5, 'the burger picked in it, 20p more')
  assert.deepEqual(d2.skipped, [])
})

test('Export CSV: a dish or section named like a formula never runs as one; numbers stay numbers (7a review)', () => {
  const odd = JSON.parse(JSON.stringify(menu))
  odd.sections[0].title = '+Specials'
  odd.sections[0].items[2].name = '=HYPERLINK("http://example.com","Fries")'
  odd.sections[1].items[0].name = '@Coke'
  const fig = scenarioFigures(odd, SCOPE, { ...ctx, dishes: dishMap([odd]) }, { rates, changes: [{ what: 'price', applies: 'all', how: 'amount', value: -20 }], units: UNITS })
  const text = scenarioCsv(fig)
  const lines = text.split('\r\n')
  assert.equal(lines.at(-1), '', 'ends with a line break')
  const fries = lines.find(l => l.includes('HYPERLINK'))
  assert.ok(fries.startsWith('\'+Specials,"\'=HYPERLINK(""http://example.com"",""Fries"")",'), fries)
  assert.ok(lines.some(l => l.startsWith('Drinks,\'@Coke,')), text)
  // A negative GP after every price drops to nothing is a number, not text made harmless.
  const burger = lines.find(l => l.startsWith('\'+Specials,Burger,'))
  assert.match(burger, /,-\d+\.\d\d,/, burger)
  assert.doesNotMatch(burger, /'-/)
})

test('Push prices: a copy of the menu with the new prices, saved whole with every other field kept', () => {
  const full = { ...menu, slug: 'lunch', venue_id: null, callouts: [], is_published: true }
  const before = JSON.stringify(full)
  const p = pushPrices(full, CHANGES)
  assert.equal(JSON.stringify(full), before, 'the loaded menu is not changed')
  assert.deepEqual(p.prices.map(x => [x.dish, x.label, x.from_pence, x.to_pence]), [
    ['Burger', null, 1200, 1320], ['Pizza', 'Small', 900, 990], ['Pizza', 'Large', 1300, 1430], ['Fries', null, 400, 440], ['Coke', null, 250, 300], ['Lunch deal', null, 1500, 1650],
  ])
  const body = menuSaveBody(p.full)
  const was = menuSaveBody(full)
  const pizza = body.sections[0].items[1]
  assert.deepEqual(pizza.variant_groups[0].overrides, [{ option_id: 'o-small', price_pence: 990 }, { option_id: 'o-large', price_pence: 1430 }])
  // Everything but the prices is as it was.
  const strip = b => JSON.stringify(b, (k, v) => (k === 'price_pence' || k === 'overrides' ? undefined : v))
  assert.equal(strip(body), strip(was))
  assert.equal(body.sections[0].items[0].variant_groups[0].overrides.length, 0, 'the extra keeps the group\'s price')
  assert.equal(priceStamp(p.prices), priceStamp(pushPrices(full, CHANGES).prices))
  assert.notEqual(priceStamp(p.prices), priceStamp(pushPrices(full, CHANGES.slice(0, 1)).prices))
})
