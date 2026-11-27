// The cost engine (shared/costing.js, inventory phase 1, 27 Nov 2026):
// units refused by name, the yield divide (edible portion cost = as bought /
// yield), the three bases of an item's cost, recipes with nested prep costed
// by their own yield and loss, gaps instead of a confident wrong number, a
// recipe inside itself and nesting too deep refused, the explanation, and the
// margin on a VAT-inclusive price at two rates.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toBase, unitChoices, unitNameProblem, yieldOf, asBought, itemCost, recipeCost, explain, nestingProblem, margin,
  inRecipeUnit, recipeMakes, recipeUnitChoices, pounds, MAX_DEPTH,
} from '../costing.js'

const V1 = 'v1', V2 = 'v2'
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ': ' + a + ' is not ' + b)

const cheddar = { id: 'ch', name: 'Cheddar', base_unit: 'g', yield_pct: 100, units: [{ id: 'u1', name: 'slice', base_qty: 20 }] }
const onion = { id: 'on', name: 'Onion', base_unit: 'g', yield_pct: 80, units: [] }
const milk = { id: 'mi', name: 'Milk', base_unit: 'ml', yield_pct: 100, units: [] }
const bun = { id: 'bu', name: 'Bun', base_unit: 'each', yield_pct: 100, units: [] }
const saffron = { id: 'sa', name: 'Saffron', base_unit: 'g', yield_pct: 100, units: [] }

// Quotes: cheddar 6 x 2 kg at £102 (£8.50 a kg), £108 at V2; onion 25 kg at £30 (£1.20 a kg).
const quotes = {
  ch: [{ id: 'q-ch', item_id: 'ch', supplier_name: 'Brakes', pack_name: 'Case', pack_count: 6, pack_qty: 2, pack_unit: 'kg', pack_base_qty: 12000, price: 102, venue_prices: { [V2]: 108 }, is_active: true }],
  on: [
    { id: 'q-on', item_id: 'on', supplier_name: 'Veg Co', pack_name: 'Sack', pack_count: 1, pack_qty: 25, pack_unit: 'kg', pack_base_qty: 25000, price: 30, venue_prices: {}, is_active: true },
    { id: 'q-on2', item_id: 'on', supplier_name: 'Dear Veg', pack_name: 'Bag', pack_count: 1, pack_qty: 5, pack_unit: 'kg', pack_base_qty: 5000, price: 10, venue_prices: {}, is_active: true },
  ],
  mi: [{ id: 'q-mi', item_id: 'mi', supplier_name: 'Dairy', pack_name: 'Bottle', pack_count: 1, pack_qty: 2, pack_unit: 'l', pack_base_qty: 2000, price: 1.6, venue_prices: {}, is_active: true }],
  bu: [{ id: 'q-bu', item_id: 'bu', supplier_name: 'Bakery', pack_name: 'Tray', pack_count: 1, pack_qty: 24, pack_unit: 'each', pack_base_qty: 24, price: 7.2, venue_prices: {}, is_active: true }],
}
const items = { ch: cheddar, on: onion, mi: milk, bu: bun, sa: saffron }

test('toBase: standard units of the same kind, the item\'s own units, and a unit that doesn\'t fit refused by name', () => {
  assert.deepEqual(toBase(2, 'kg', cheddar), { base: 2000, problem: null })
  assert.equal(toBase(75, 'cl', milk).base, 750)
  assert.equal(toBase(2, 'slice', cheddar).base, 40, 'an own unit')
  assert.equal(toBase(2, 'Slice', cheddar).base, 40, 'case does not matter')
  assert.equal(toBase(1, 'each', { ...cheddar, units: [{ name: 'each', base_qty: 150 }] }).base, 150, 'each for an item kept in grams')
  assert.deepEqual(toBase(1, 'tbsp', cheddar), { base: null, problem: 'Cheddar has no size for a tbsp' })
  assert.equal(toBase(1, 'ml', cheddar).problem, 'Cheddar has no size for a ml', 'mass and volume never convert')
  assert.equal(toBase(1, 'egg', bun).problem, 'Bun has no size for an egg')
  assert.deepEqual(unitChoices(cheddar), ['g', 'kg', 'slice'])
  assert.equal(unitNameProblem('kg', cheddar), 'Cheddar already knows kg: it is a standard unit')
  assert.equal(unitNameProblem('SLICE', cheddar), 'Cheddar already has a unit called SLICE')
  assert.equal(unitNameProblem('slice', cheddar, { except: 'u1' }), null, 'renaming a unit to itself')
  assert.equal(unitNameProblem('each', cheddar), null, 'each is no standard unit of grams')
})

test('the yield divide: what has to be bought for what is used (1.20 at 80% = 1.50), never x (1 + waste)', () => {
  close(asBought(1.2, 80), 1.5)
  close(asBought(100, 100), 100)
  assert.equal(yieldOf(onion), 80)
  assert.equal(yieldOf(onion, { yield_pct: 50 }), 50, 'a line\'s own yield beats the item\'s')
  assert.equal(yieldOf(null), 100)
  const c = itemCost(onion, V1, { quotes }, 'standard')
  close(c.per_base, 30 / 25000, 'the cheapest per gram')
  close(c.usable_per_base * 1000, 1.5, '£1.20 a kg bought is £1.50 a usable kg')
})

test('itemCost: standard follows chooseQuote at the venue\'s price; last and average follow what was paid there', () => {
  const s1 = itemCost(cheddar, V1, { quotes }, 'standard')
  close(s1.per_base * 1000, 8.5, 'V1 pays the company price')
  assert.equal(s1.how, 'cheapest')
  assert.equal(s1.supplier_name, 'Brakes')
  close(itemCost(cheddar, V2, { quotes }, 'standard').per_base * 1000, 9, 'V2 pays its own price')
  // A venue's own supplier choice beats the cheapest.
  const pref = { on: { default: null, venues: { [V1]: 'q-on2' } } }
  const chosen = itemCost(onion, V1, { quotes, preferred: pref }, 'standard')
  assert.equal(chosen.how, 'venue')
  close(chosen.per_base * 1000, 2)
  assert.equal(itemCost(saffron, V1, { quotes }, 'standard').problem, 'no_price')

  const receipts = {
    ch: [
      { venue_id: V1, at: '2026-11-01T10:00:00Z', packs: 1, pack_base_qty: 12000, price: 96 },
      { venue_id: V1, at: '2026-11-20T10:00:00Z', packs: 3, pack_base_qty: 12000, price: 120 },
      { venue_id: V2, at: '2026-11-25T10:00:00Z', packs: 1, pack_base_qty: 12000, price: 60 },
      { venue_id: V1, at: '2026-05-01T10:00:00Z', packs: 10, pack_base_qty: 12000, price: 12 },
    ],
  }
  const data = { quotes, receipts, since: '2026-08-29T00:00:00Z' }
  const last = itemCost(cheddar, V1, data, 'last')
  close(last.per_base * 1000, 10, 'the latest at V1: £120 for 12 kg')
  assert.equal(last.how, 'last')
  // Weighted by quantity, inside the window only: (96 + 3 x 120) / 48 kg.
  close(itemCost(cheddar, V1, data, 'average').per_base * 1000, (96 + 360) / 48, 'the average paid')
  close(itemCost(cheddar, V2, data, 'average').per_base * 1000, 5, 'another venue pays its own')
  assert.equal(itemCost(onion, V1, data, 'last').problem, 'no_receipts')
})

// A prep recipe (a cheese sauce): 2 l of milk and 400 g cheddar make 2 l,
// a quarter lost in cooking. A dish: two slices of cheddar, 100 g of sauce
// ... in ml, a bun, an onion with its 80% yield; 2 portions.
const sauce = {
  id: 'sauce', name: 'Cheese sauce', kind: 'prep', yield_qty: 2, yield_unit: 'l', loss_pct: 25,
  lines: [
    { id: 's1', sort_order: 0, item_id: 'mi', qty: 2, unit: 'l' },
    { id: 's2', sort_order: 1, item_id: 'ch', qty: 400, unit: 'g' },
  ],
}
const burger = {
  id: 'burger', name: 'Cheeseburger', kind: 'dish', portions: 2,
  lines: [
    { id: 'b1', sort_order: 0, item_id: 'ch', qty: 2, unit: 'slice' },
    { id: 'b2', sort_order: 1, sub_recipe_id: 'sauce', qty: 100, unit: 'ml' },
    { id: 'b3', sort_order: 2, item_id: 'bu', qty: 2, unit: 'each' },
    { id: 'b4', sort_order: 3, item_id: 'on', qty: 60, unit: 'g' },
  ],
}
const recipes = { sauce, burger }

test('recipeCost: lines, nested prep by its own yield and loss, per portion; and a second venue\'s prices', () => {
  const ctx = { items, recipes, quotes, venueId: V1 }
  const s = recipeCost(sauce, ctx)
  // Milk 2000 ml at £0.0008 = £1.60; cheddar 400 g at £0.0085 = £3.40; £5 makes 1.5 l.
  close(s.cost, 5)
  assert.equal(recipeMakes(sauce), 1.5)
  close(s.per_unit, 5 / 1.5, 'per litre')
  assert.equal(s.unit, 'l')
  assert.equal(s.coverage, 'full')
  const b = recipeCost(burger, ctx)
  close(b.lines[0].cost, 40 * 0.0085, 'two slices are 40 g')
  close(b.lines[1].cost, 0.1 * 5 / 1.5, '100 ml of sauce in its own litres')
  close(b.lines[2].cost, 0.6)
  close(b.lines[3].cost, 75 * 30 / 25000, '60 g usable is 75 g bought')
  const total = 0.34 + 0.1 * 5 / 1.5 + 0.6 + 0.09
  close(b.cost, total)
  close(b.per_unit, total / 2, 'per portion')
  assert.equal(b.unit, 'portion')
  assert.deepEqual(b.gaps, [])
  assert.equal(b.complete, true)
  // At V2 cheddar is £9 a kg: the slices and the sauce both go up.
  const b2 = recipeCost(burger, { items, recipes, quotes, venueId: V2 })
  assert.ok(b2.cost > b.cost, 'the second venue pays more')
  close(b2.lines[0].cost, 40 * 0.009)
  assert.deepEqual(recipeUnitChoices(sauce), ['ml', 'cl', 'l'])
  assert.equal(inRecipeUnit(1, 'kg', sauce).problem, 'Cheese sauce is made in l: kg doesn\'t fit')
})

test('gaps: a unit with no size, a missing price, an empty or unsized prep, each with how to fix it; the rest still costed', () => {
  const broken = {
    id: 'x', name: 'Broken', kind: 'dish', portions: 1,
    lines: [
      { id: 'x1', sort_order: 0, item_id: 'ch', qty: 1, unit: 'tbsp' },
      { id: 'x2', sort_order: 1, item_id: 'sa', qty: 1, unit: 'g' },
      { id: 'x3', sort_order: 2, item_id: 'bu', qty: 1, unit: 'each' },
      { id: 'x4', sort_order: 3, sub_recipe_id: 'empty', qty: 1, unit: 'l' },
      { id: 'x5', sort_order: 4, sub_recipe_id: 'nosize', qty: 1, unit: 'l' },
    ],
  }
  const more = { ...recipes, empty: { id: 'empty', name: 'Stock', kind: 'prep', yield_qty: 1, yield_unit: 'l', lines: [] },
    nosize: { id: 'nosize', name: 'Gravy', kind: 'prep', yield_qty: null, yield_unit: null, lines: [{ id: 'n1', item_id: 'mi', qty: 1, unit: 'l' }] } }
  const r = recipeCost(broken, { items, recipes: more, quotes, venueId: V1 })
  assert.deepEqual(r.gaps.map(g => [g.line, g.reason]), [[0, 'no_unit'], [1, 'no_price'], [3, 'empty'], [4, 'no_yield']])
  assert.equal(r.gaps[0].text, 'Cheddar has no size for a tbsp')
  assert.match(r.gaps[0].fix, /Give Cheddar a size for tbsp .*g, kg, slice/)
  assert.match(r.gaps[1].fix, /supplier price for Saffron/)
  close(r.cost, 0.3, 'the bun is still costed')
  assert.equal(r.coverage, 'partial')
  assert.equal(r.complete, false)
  const none = recipeCost({ id: 'n', name: 'Nothing', kind: 'prep', yield_qty: 1, yield_unit: 'kg', lines: [{ item_id: 'sa', qty: 1, unit: 'g' }] }, { items, quotes })
  assert.equal(none.coverage, 'none')
  assert.equal(none.cost, null)
  const empty = recipeCost({ id: 'e', name: 'Empty', kind: 'dish', lines: [] }, { items })
  assert.equal(empty.gaps[0].reason, 'empty')
  // A dish holding a partly costed prep is partly costed too.
  const outer = { id: 'o', name: 'Outer', kind: 'dish', lines: [{ id: 'o1', sub_recipe_id: 'inner', qty: 1, unit: 'kg' }] }
  const inner = { id: 'inner', name: 'Inner', kind: 'prep', yield_qty: 1, yield_unit: 'kg', lines: [{ item_id: 'bu', qty: 1, unit: 'each' }, { item_id: 'sa', qty: 1, unit: 'g' }] }
  const o = recipeCost(outer, { items, quotes, recipes: { outer, inner } })
  close(o.cost, 0.3)
  assert.equal(o.lines[0].partial, true)
  assert.equal(o.gaps[0].reason, 'sub_partial')
  assert.equal(o.coverage, 'partial')
})

test('a recipe inside itself and nesting beyond five levels are refused on save; the engine never loops', () => {
  const a = { id: 'a', name: 'A', lines: [{ sub_recipe_id: 'b' }] }
  const b = { id: 'b', name: 'B', lines: [{ sub_recipe_id: 'c' }] }
  const c = { id: 'c', name: 'C', lines: [] }
  const all = { a, b, c }
  assert.equal(nestingProblem('c', [{ sub_recipe_id: 'c' }], all).code, 'recipe_cycle', 'directly')
  const cyc = nestingProblem('c', [{ sub_recipe_id: 'a' }], all)
  assert.equal(cyc.code, 'recipe_cycle')
  assert.equal(cyc.message, 'C can\'t go inside itself: C > A > B > C.')
  assert.equal(nestingProblem('c', [{ item_id: 'x' }], all), null)
  assert.equal(nestingProblem(null, [{ sub_recipe_id: 'a' }], all, 'New'), null, 'a new recipe holding A is four levels')
  // Five levels deep is the most: d > a > b > c > e.
  const e = { id: 'e', name: 'E', lines: [] }
  const deep = { a, b, c: { ...c, lines: [{ sub_recipe_id: 'e' }] }, e }
  assert.equal(nestingProblem('d', [{ sub_recipe_id: 'a' }], deep, 'D'), null)
  const six = nestingProblem('e', [{ sub_recipe_id: 'f' }], { ...deep, d: { id: 'd', name: 'D', lines: [{ sub_recipe_id: 'a' }] }, f: { id: 'f', name: 'F', lines: [] } })
  assert.equal(six.code, 'recipe_depth')
  assert.equal(six.message, 'Recipes nest up to ' + MAX_DEPTH + ' levels: D > A > B > C > E > F is 6.')
  // Rows that slipped in anyway are a gap, not a hang.
  const loop1 = { id: 'l1', name: 'Loop', kind: 'prep', yield_qty: 1, yield_unit: 'kg', lines: [{ id: 'z', sub_recipe_id: 'l2', qty: 1, unit: 'kg' }] }
  const loop2 = { id: 'l2', name: 'Loop two', kind: 'prep', yield_qty: 1, yield_unit: 'kg', lines: [{ id: 'y', sub_recipe_id: 'l1', qty: 1, unit: 'kg' }] }
  const r = recipeCost(loop1, { items, recipes: { l1: loop1, l2: loop2 } })
  assert.equal(r.coverage, 'none')
  assert.equal(r.gaps[0].reason, 'sub_partial', 'the loop inside is no cost, so the line is a gap')
  assert.equal(recipeCost(loop2, { items, recipes: { l1: loop1, l2: loop2 } }, { stack: ['l1'], memo: new Map() }).gaps[0].reason, 'cycle')
})

test('explain: each line\'s steps, the yield shown, the total and the per portion; the quote left out without prices', () => {
  const ctx = { items, recipes, quotes, venueId: V1 }
  const ex = explain(burger, ctx)
  const [slices, sauceRow, , onionRow] = ex.rows
  assert.deepEqual(slices.steps, ['2 slice is 40 g', '40 g at £8.50 a kg (Brakes, Case · 6 × 2 kg, £102.00 a pack, the cheapest supplier) = £0.34'])
  assert.match(sauceRow.steps.at(-1), /at £3.33 a l \(its own recipe\)/)
  assert.deepEqual(onionRow.steps, ['usable 80%: 60 g ÷ 0.8 = 75 g bought', '75 g at £1.20 a kg (Veg Co, Sack · 25 kg, £30.00 a pack, the cheapest supplier) = £0.09'])
  assert.equal(ex.rows.at(-2).kind, 'total')
  assert.equal(ex.rows.at(-1).label, 'Per portion')
  assert.match(ex.rows.at(-1).steps[0], /÷ 2 portions/)
  const hidden = explain(burger, ctx, { prices: false })
  assert.doesNotMatch(hidden.text, /Brakes|£102/)
  assert.match(hidden.text, /£8\.50 a kg/, 'the cost is still there')
  const prep = explain(sauce, ctx)
  assert.match(prep.rows.at(-1).steps[0], /£5\.00 ÷ 1\.5 l \(2 less 25% lost in cooking\)/)
  assert.equal(pounds(0.004), '£0.0040')
})

test('margin: net of VAT included, gross profit and cost %, at 20% and 0%; pence and pounds meet only here', () => {
  assert.deepEqual(margin({ gross_pence: 1200, vat_rate: 20, cost: 3 }), {
    gross_pence: 1200, vat_pence: 200, net_pence: 1000, cost_pence: 300, gp_pence: 700, cost_pct: 30, gp_pct: 70,
  })
  const zero = margin({ gross_pence: 1200, vat_rate: 0, cost: 3 })
  assert.equal(zero.net_pence, 1200)
  assert.equal(zero.cost_pct, 25)
  assert.equal(margin({ gross_pence: 1000, vat_rate: 20, cost: null }).gp_pence, null, 'an unknown cost is no margin')
  assert.equal(margin({ gross_pence: 0, vat_rate: 20, cost: 1 }).cost_pct, null)
})
