// Price creep (shared/priceCreep.js, inventory phase 7b, migration 315): the
// supplier prices at a moment from the price history (packs, venue prices,
// prices made since left out), the index from items to recipes (through
// prep recipes, a loop walked once) to dishes and the deals that hold them,
// which items moved and what that did to a serving (the sum of the moves is
// the change in cost), the crossings by the sweep's own rule, and the words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pricesAt, dishesUsing, dealsHolding, itemMoves, dishMoves, priceCrossings, causeWords, moveWords, alertSummary, dayWords, CREEP_SOURCE_KEYS,
} from '../priceCreep.js'
import { menuMargins, dishMap, dishCost } from '../costing.js'
import { overTarget, targetCrossings } from '../foodCost.js'

const close = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 1e-6, (msg || '') + ': ' + a + ' is not ' + b)
const V = 'v1', W = 'v2'
const DAY1 = '2026-11-01T09:00:00Z', DAY2 = '2026-11-10T09:00:00Z', DAY3 = '2026-11-20T09:00:00Z'

const item = (id, name, base_unit = 'g') => ({ id, name, base_unit, yield_pct: 100, units: [] })
const items = new Map([['chicken', item('chicken', 'Chicken thighs')], ['rice', item('rice', 'Basmati rice')], ['butter', item('butter', 'Butter')]])
// Chicken £6 a kg now (was £5 at DAY1, £5.50 from DAY2: a 1 kg bag), rice £2 a kg, butter £8 a kg.
const quote = (id, itemId, price, pack, extra = {}) => ({
  id, item_id: itemId, supplier_name: 'Brakes', pack_name: 'Bag', pack_count: 1, pack_qty: pack, pack_unit: 'g', pack_base_qty: pack,
  price, venue_prices: {}, is_active: true, created_at: DAY1, ...extra,
})
const quotes = new Map([
  ['chicken', [quote('q-chicken', 'chicken', 6, 1000, { venue_prices: { [W]: 7 } })]],
  ['rice', [quote('q-rice', 'rice', 2, 1000)]],
  ['butter', [quote('q-butter', 'butter', 8, 1000)]],
])
const history = [
  { quote_id: 'q-chicken', venue_id: null, price: 5, pack_base_qty: 1000, changed_at: DAY1 },
  { quote_id: 'q-chicken', venue_id: null, price: 5.5, pack_base_qty: 1000, changed_at: DAY2 },
  { quote_id: 'q-chicken', venue_id: null, price: 6, pack_base_qty: 1000, changed_at: DAY3 },
  { quote_id: 'q-chicken', venue_id: W, price: 7, pack_base_qty: 1000, changed_at: DAY3 },
  { quote_id: 'q-rice', venue_id: null, price: 2, pack_base_qty: 500, changed_at: DAY1 },
  { quote_id: 'q-rice', venue_id: null, price: 2, pack_base_qty: 1000, changed_at: DAY2 },
]

const recipe = (id, name, lines, extra = {}) => ({ id, name, kind: 'dish', portions: 1, status: 'live', variant_of: null, lines: lines.map((l, i) => ({ id: id + '-' + i, sort_order: i, yield_pct: null, ...l })), ...extra })
const recipes = new Map([
  // A prep: a litre of chicken stock from 500 g chicken.
  ['stock', recipe('stock', 'Chicken stock', [{ item_id: 'chicken', qty: 500, unit: 'g' }], { kind: 'prep', yield_qty: 1, yield_unit: 'l', loss_pct: 0 })],
  // The soup: 250 ml of stock. The platter: 500 g chicken. The bowl: 200 g chicken, 100 g rice. Toast: butter only.
  ['soup', recipe('soup', 'Chicken soup', [{ sub_recipe_id: 'stock', qty: 250, unit: 'ml' }])],
  ['platter', recipe('platter', 'Chicken platter', [{ item_id: 'chicken', qty: 500, unit: 'g' }])],
  ['bowl', recipe('bowl', 'Chicken bowl', [{ item_id: 'chicken', qty: 200, unit: 'g' }, { item_id: 'rice', qty: 100, unit: 'g' }])],
  ['toast', recipe('toast', 'Butter toast', [{ item_id: 'butter', qty: 20, unit: 'g' }])],
  // Two prep recipes inside each other (a loop the save refuses; the index must still end).
  ['loop-a', recipe('loop-a', 'Loop A', [{ sub_recipe_id: 'loop-b', qty: 1, unit: 'l' }], { kind: 'prep', yield_qty: 1, yield_unit: 'l' })],
  ['loop-b', recipe('loop-b', 'Loop B', [{ sub_recipe_id: 'loop-a', qty: 1, unit: 'l' }, { item_id: 'butter', qty: 1, unit: 'g' }], { kind: 'prep', yield_qty: 1, yield_unit: 'l' })],
])
const links = [
  { id: 'l1', dish_id: 'd-soup', recipe_id: 'soup', portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null },
  { id: 'l2', dish_id: 'd-platter', recipe_id: 'platter', portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null },
  { id: 'l3', dish_id: 'd-bowl', recipe_id: 'bowl', portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null },
  { id: 'l4', dish_id: 'd-toast', recipe_id: 'toast', portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null },
]
const dish = (id, name, price) => ({ id, name, price_pence: price, kind: null, tax: null, variants: [], variant_groups: [] })
const menu = {
  id: 'm1', name: 'Bowls', item_type: null, tax: { rate: 'standard', rules: [] },
  sections: [
    { id: 's1', title: 'Mains', tax: null, items: [dish('d-soup', 'Chicken soup', 600), dish('d-platter', 'Chicken platter', 1200), dish('d-bowl', 'Chicken bowl', 1200), dish('d-toast', 'Butter toast', 400)] },
    { id: 's2', title: 'Deals', tax: null, items: [
      { id: 'd-deal', name: 'Platter deal', kind: 'combo', price_pence: 1500, tax: null, variants: [], variant_groups: [], combo: { mode: 'manual', steps: [
        { id: 'st', name: 'Main', min: 1, max: 1, options: [{ id: 'c1', type: 'item', item_id: 'd-platter' }] },
      ] } },
      { id: 'd-toast-deal', name: 'Toast deal', kind: 'combo', price_pence: 500, tax: null, variants: [], variant_groups: [], combo: { mode: 'manual', steps: [
        { id: 'st2', name: 'Main', min: 1, max: 1, options: [{ id: 'c2', type: 'item', item_id: 'd-toast' }] },
      ] } },
    ] },
  ],
}
const rates = [{ id: 'standard', name: 'Standard', rate: 20, values: {}, is_default: true, is_active: true }]
const settings = { target_pct: 30, limit_pct: 35, sections: [] }
const ctx = (q = quotes, extra = {}) => ({ items, quotes: q, preferred: new Map(), receipts: {}, recipes, venueId: V, basis: 'standard', links, rules: [], options: new Map(), names: {}, dishes: dishMap([menu]), goods: new Map(), _memo: new Map(), ...extra })
const tag = (rows, t = { id: null, name: null }) => rows.map(r => ({ ...r, menu_id: menu.id, menu: menu.name, order_type_id: t.id, order_type: t.name }))

test('pricesAt: each price and pack as the history had it, venue prices too, prices made since left out', () => {
  const at = t => pricesAt(quotes, history, t).quotes
  // Before the second change: £5 a 1 kg bag; rice was a 500 g bag then.
  const d1 = at('2026-11-05T00:00:00Z')
  assert.equal(d1.get('chicken')[0].price, 5)
  assert.equal(d1.get('rice')[0].pack_base_qty, 500, 'the pack it had then (migration 315)')
  assert.deepEqual(d1.get('chicken')[0].venue_prices, {}, 'the venue had no price of its own before its first row')
  // At the moment of a change, at or before it; strictly before it for the hook.
  assert.equal(at(DAY2).get('chicken')[0].price, 5.5)
  assert.equal(pricesAt(quotes, history, DAY2, { strict: true }).quotes.get('chicken')[0].price, 5)
  // Now: as kept.
  const now = at('2026-11-27T00:00:00Z')
  assert.equal(now.get('chicken')[0].price, 6)
  assert.equal(now.get('chicken')[0].venue_prices[W], 7)
  // A price made after the moment didn't exist then.
  const late = new Map([['butter', [quote('q-new', 'butter', 9, 1000, { created_at: DAY3 })]]])
  assert.deepEqual(pricesAt(late, [], DAY2).quotes.get('butter'), [])
  // A row that removed a venue's price: none then.
  const removed = [...history, { quote_id: 'q-chicken', venue_id: W, price: null, pack_base_qty: 1000, changed_at: '2026-11-25T00:00:00Z' }]
  assert.equal(pricesAt(quotes, removed, '2026-11-26T00:00:00Z').quotes.get('chicken')[0].venue_prices[W], undefined)
  // No company row back then but some since: not known, kept as now and named.
  const unknown = pricesAt(new Map([['butter', [quote('q-butter', 'butter', 8, 1000)]]]), [{ quote_id: 'q-butter', venue_id: null, price: 8, pack_base_qty: 1000, changed_at: DAY3 }], DAY2)
  assert.deepEqual(unknown.unknown, ['q-butter'])
  assert.equal(unknown.quotes.get('butter')[0].price, 8)
  // The quotes given are never changed.
  assert.equal(quotes.get('chicken')[0].price, 6)
  assert.equal(quotes.get('chicken')[0].venue_prices[W], 7)
})

test('dishesUsing: the index from items to recipes, up through prep recipes, to the dishes linked', () => {
  const chicken = dishesUsing(['chicken'], recipes, links)
  assert.deepEqual([...chicken.dishIds].sort(), ['d-bowl', 'd-platter', 'd-soup'], 'the soup through its stock')
  assert.ok(chicken.recipeIds.has('stock') && chicken.recipeIds.has('soup'))
  assert.ok(!chicken.dishIds.has('d-toast'), 'toast uses no chicken')
  assert.deepEqual([...dishesUsing(['rice'], recipes, links).dishIds], ['d-bowl'])
  // A loop of prep recipes is walked once.
  const butter = dishesUsing(['butter'], recipes, links)
  assert.ok(butter.recipeIds.has('loop-a') && butter.recipeIds.has('loop-b'))
  assert.deepEqual([...butter.dishIds], ['d-toast'])
  assert.equal(dishesUsing([], recipes, links).dishIds.size, 0)
  // The deals whose steps can hold one of them.
  assert.deepEqual([...dealsHolding([menu], chicken.dishIds)], ['d-deal'])
  assert.deepEqual([...dealsHolding([menu], new Set(['d-toast']))], ['d-toast-deal'])
  assert.equal(dealsHolding([menu], new Set()).size, 0)
})

test('itemMoves and dishMoves: what moved per base unit, and what it did to a serving adds up to the change', () => {
  const before = ctx(pricesAt(quotes, history, '2026-11-05T00:00:00Z').quotes)
  const after = ctx()
  const moves = itemMoves([{ item_id: 'chicken', qty_base: 500 }, { item_id: 'rice', qty_base: 100 }], before, after, V)
  // Rice was £2 a 500 g bag then and is £2 a kilo bag now: its pack moved, so its cost per gram halved.
  assert.deepEqual(moves.map(x => [x.name, x.pct]), [['Chicken thighs', 20], ['Basmati rice', -50]], 'biggest effect on a serving first')
  close(moves[1].effect, -0.2)
  close(moves[0].before, 0.005)
  close(moves[0].after, 0.006)
  assert.equal(moves[0].pct, 20)
  close(moves[0].effect, 0.5, '500 g at 0.1p more a gram')
  // At the venue with its own price: £7 now against £5 then.
  assert.equal(itemMoves([{ item_id: 'chicken', qty_base: 500 }], before, after, W)[0].pct, 40)
  // A dish: the change in cost is the sum of its items' effects (one walk, usageOf()).
  const bowl = dishMoves('d-bowl', { venue_id: V }, before, after)
  close(bowl.cost_before, 1.4, '200 g at £5 a kg and 100 g at £4 a kg')
  close(bowl.cost_after, 1.4, '200 g at £6 a kg and 100 g at £2 a kg')
  close(bowl.change, bowl.items.reduce((s, m) => s + m.effect, 0), 'the change is the moves')
  // Through a prep recipe: 250 ml of a litre made from 500 g: 125 g of chicken a serving.
  const soup = dishMoves('d-soup', { venue_id: V }, before, after)
  close(soup.items[0].qty_base, 125)
  close(soup.change, 0.125)
  // Nothing moved: no moves, no change.
  const toast = dishMoves('d-toast', { venue_id: V }, before, after)
  assert.deepEqual(toast.items, [])
  close(toast.change, 0)
  // A price where there was none: "now priced", no %.
  const none = new Map([...quotes, ['butter', []]])
  const priced = itemMoves([{ item_id: 'butter', qty_base: 20 }], ctx(none), after, V)
  assert.equal(priced[0].before, null)
  assert.equal(moveWords(priced[0]), 'Butter now priced')
})

test('priceCrossings: newly over the target, or from over the target to over the limit, by the sweep\'s own rule', () => {
  const at = q => tag(menuMargins(menu, { venue_id: V, order_type_id: null }, ctx(q), { rates, settings, withOptions: false, only: new Set(['d-platter', 'd-bowl', 'd-soup', 'd-deal']) }))
  // The platter: 500 g chicken against £10 net. At £5.50 a kg £2.75 (27.5%), at £6 £3.00 (30%: on target), at £6.72 £3.36 (33.6%).
  const q = price => new Map([...quotes, ['chicken', [quote('q-chicken', 'chicken', price, 1000)]]])
  const b = at(q(6))
  const a = at(q(6.72))
  assert.ok(!b.some(r => r.dish_id === 'd-toast'), 'only the dishes asked for are worked out')
  const crossed = priceCrossings(b, a)
  const platter = crossed.find(c => c.dish_id === 'd-platter')
  assert.ok(platter, JSON.stringify(crossed))
  assert.equal(platter.old_cost_pct, 30)
  assert.equal(platter.old_band, 'good')
  assert.equal(platter.new_cost_pct, 33.6)
  assert.equal(platter.new_band, 'watch')
  assert.equal(platter.threshold_pct, 30, 'it crossed its target')
  // The deal holds the platter: £3.36 over £12.50 net is 26.9%, still under its target. The bowl stays under too.
  assert.ok(!crossed.some(c => c.dish_id === 'd-bowl' || c.dish_id === 'd-deal'), JSON.stringify(crossed))
  // The same rule as targetCrossings() with the before side as what was kept.
  const viaSweep = targetCrossings(overTarget(b).map(d => ({ dish_id: d.dish_id, band: d.band, cost_pct: d.cost_pct })), overTarget(a)).crossed.map(d => d.dish_id)
  assert.deepEqual(crossed.map(c => c.dish_id), viaSweep)
  // On to the limit: from watch to over is a crossing (of the limit); a rise within the band is none.
  const limit = priceCrossings(a, at(q(7.5)))
  assert.equal(limit.find(c => c.dish_id === 'd-platter').threshold_pct, 35)
  assert.equal(limit.find(c => c.dish_id === 'd-platter').old_band, 'watch')
  // From £7.50 to £7.80: the platter (37.5% to 39%) was over the limit already, no new crossing; the deal
  // holding it goes from 30% (on target) to 31.2%, over its target: a crossing of its own.
  const deal = priceCrossings(at(q(7.5)), at(q(7.8)))
  assert.deepEqual(deal.map(c => [c.dish_id, c.old_cost_pct, c.new_cost_pct, c.threshold_pct]), [['d-deal', 30, 31.2, 30]])
  // Cheaper: nothing crossed.
  assert.deepEqual(priceCrossings(a, b), [])
})

test('causeWords and alertSummary: what moved, no money; how many crossed what since when', () => {
  const m = (name, pct, effect = 0.1, extra = {}) => ({ item_id: name, name, pct, before: 1, after: 1 + pct / 100, effect, ...extra })
  assert.equal(causeWords([m('Chicken thighs', 12), m('Butter', -3)]), 'Chicken thighs up 12%, Butter down 3%')
  assert.equal(causeWords([m('A', 1), m('B', 2), m('C', 3), m('D', 4)]), 'A up 1%, B up 2% and 2 more items')
  assert.equal(causeWords([]), 'A supplier price changed')
  assert.ok(!/£/.test(causeWords([m('Chicken thighs', 12)])), 'no money in the words')
  const alert = (dish, venue, day, threshold = 35, band = 'over', causes = [m('Chicken thighs', 12)]) => ({ dish_id: dish, venue_id: venue, day, threshold_pct: threshold, new_band: band, causes })
  const s = alertSummary([alert('a', V, '2026-12-03'), alert('b', V, '2026-12-01'), alert('c', V, '2026-12-02'), alert('d', V, '2026-12-02', 35, 'over', [m('Butter', 5)])])
  assert.equal(s.words, '4 dishes crossed 35% since 1 Dec: Chicken thighs up 12%')
  assert.equal(s.since, '2026-12-01')
  assert.equal(s.dishes, 4)
  assert.equal(alertSummary([alert('a', V, '2026-12-01'), alert('a', W, '2026-12-01')]).words, '1 dish crossed 35% at 2 venues since 1 Dec: Chicken thighs up 12%')
  assert.equal(alertSummary([alert('a', V, '2026-12-01', 30, 'watch'), alert('b', V, '2026-12-01', 35)]).words, '2 dishes crossed their cost target or limit since 1 Dec: Chicken thighs up 12%')
  assert.equal(alertSummary([]).words, '')
  // The top item's move over them all: £6 a kg before the first, £7.20 after the last is up 20% since then.
  const step = (day, before, after) => ({ ...alert('p' + day, V, day), at: day + 'T10:00:00Z', causes: [m('Chicken thighs', Math.round((after - before) / before * 1000) / 10, 0.1, { before, after })] })
  assert.equal(alertSummary([step('2026-12-05', 6.72, 7.2), step('2026-12-01', 6, 6.72)]).words, '2 dishes crossed 35% since 1 Dec: Chicken thighs up 20%')
  assert.equal(dayWords('2026-01-09'), '9 Jan')
  assert.deepEqual(CREEP_SOURCE_KEYS, ['manual', 'import', 'price_update', 'invoice'])
  // A dish costed by the same engine the page uses: the platter at today's prices.
  close(dishCost('d-platter', {}, { venue_id: V }, ctx()).cost, 3)
})
