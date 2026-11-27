// Usage from sales (inventory phase 5, docs/INVENTORY.md 7): what one sold
// dish takes off stock, usageOf() in shared/costing.js, on the same walk as
// its cost (dishCost()'s lines as bought, prep recipes by recipeCost()'s
// lines): a plain dish, options that add, remove, swap and scale, a meal
// deal with its picks and without (its typical picks), a nested prep recipe,
// a dish with no recipe, the variation matrix by order type, revenue stream
// and venue, an online order's options by their words, a draft Pepper read
// in, and cost = the sum of each item's quantity x its cost.
import test from 'node:test'
import assert from 'node:assert/strict'
import { usageOf, recipeUsage, dishCost, itemCost, matchOptions, typicalPicks, pickMix } from '../costing.js'
import { itemsOf } from '../stockItems.js'

const close = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 1e-4, (msg || '') + ': ' + a + ' is not ' + b)
const V = 'v-leeds', SOHO = 'v-soho', BAR = 's-bar', TAKE = 't-take', EAT = 't-eat'

const item = (id, name, base_unit = 'g', extra = {}) => ({ id, name, base_unit, yield_pct: 100, units: [], ...extra })
const quote = (itemId, packBase, price) => [{ id: 'q-' + itemId, item_id: itemId, supplier_name: 'Brakes', pack_name: 'Pack', pack_count: 1, pack_qty: packBase, pack_unit: 'g', pack_base_qty: packBase, price, venue_prices: {}, is_active: true }]
const recipe = (id, name, lines, extra = {}) => ({
  id, name, kind: 'dish', portions: 1, status: 'live', variant_of: null,
  lines: lines.map((l, i) => ({ id: id + '-' + i, sort_order: i, yield_pct: null, ...l })), ...extra,
})

function ctxOf(extra = {}) {
  const items = new Map([
    ['beef', item('beef', 'Beef patty', 'each')],
    ['bun', item('bun', 'Brioche bun', 'each')],
    ['onion', item('onion', 'Red onion', 'g', { yield_pct: 80 })],
    ['cheese', item('cheese', 'Cheddar', 'g', { units: [{ name: 'slice', base_qty: 20 }] })],
    ['potato', item('potato', 'Potatoes', 'g', { yield_pct: 75 })],
    ['milk', item('milk', 'Milk', 'ml')],
    ['oat', item('oat', 'Oat milk', 'ml')],
    ['coffee', item('coffee', 'Coffee beans', 'g')],
    ['wrap', item('wrap', 'Tortilla', 'each')],
  ])
  const quotes = {
    beef: quote('beef', 10, 15), bun: quote('bun', 24, 7.2), onion: quote('onion', 1000, 2), cheese: quote('cheese', 1000, 8),
    potato: quote('potato', 1000, 1), milk: quote('milk', 1000, 1), oat: quote('oat', 1000, 2), coffee: quote('coffee', 1000, 20), wrap: quote('wrap', 12, 3),
  }
  // A relish: 800 g of onion makes 1 kg, less 20% cooked off: 0.8 kg.
  const relish = recipe('relish', 'Onion relish', [{ item_id: 'onion', qty: 800, unit: 'g' }], { kind: 'prep', portions: null, yield_qty: 1, yield_unit: 'kg', loss_pct: 20 })
  const burger = recipe('burger', 'Burger', [
    { item_id: 'beef', qty: 1, unit: 'each' }, { item_id: 'bun', qty: 1, unit: 'each' },
    { item_id: 'onion', qty: 20, unit: 'g' }, { sub_recipe_id: 'relish', qty: 40, unit: 'g' },
  ])
  const toGo = recipe('burger-to-go', 'Burger to go', [{ item_id: 'beef', qty: 1, unit: 'each' }, { item_id: 'bun', qty: 2, unit: 'each' }], { variant_of: 'burger' })
  const soho = recipe('burger-soho', 'Soho burger', [{ item_id: 'beef', qty: 2, unit: 'each' }, { item_id: 'bun', qty: 1, unit: 'each' }], { variant_of: 'burger' })
  const bar = recipe('burger-bar', 'Bar burger', [{ item_id: 'beef', qty: 1, unit: 'each' }], { variant_of: 'burger' })
  const fries = recipe('fries', 'Fries', [{ item_id: 'potato', qty: 300, unit: 'g' }], { portions: 2 })
  const latte = recipe('latte', 'Latte', [{ item_id: 'milk', qty: 200, unit: 'ml' }, { item_id: 'coffee', qty: 18, unit: 'g' }])
  const wrap = recipe('wrap', 'Wrap', [{ item_id: 'wrap', qty: 1, unit: 'each' }, { item_id: 'cheese', qty: 2, unit: 'slice' }])
  const read = recipe('read', 'Wings read in', [{ item_id: 'beef', qty: 2, unit: 'each' }], { status: 'draft', source: 'reader' })
  const recipes = new Map([relish, burger, toGo, soho, bar, fries, latte, wrap, read].map(r => [r.id, r]))
  const link = (id, dish_id, recipe_id, scope = {}) => ({ id, dish_id, recipe_id, portions: 1, venue_id: null, revenue_stream_id: null, order_type_id: null, ...scope })
  const links = [
    link('l1', 'd-burger', 'burger'), link('l2', 'd-burger', 'burger-to-go', { order_type_id: TAKE }),
    link('l3', 'd-burger', 'burger-soho', { venue_id: SOHO }), link('l4', 'd-burger', 'burger-bar', { revenue_stream_id: BAR, venue_id: SOHO }),
    link('l5', 'd-fries', 'fries'), link('l6', 'd-latte', 'latte'), link('l7', 'd-wrap', 'wrap'), link('l8', 'd-wings', 'read'),
  ]
  const options = new Map([
    ['o-cheese', { id: 'o-cheese', label: 'Cheese', variation_type: 'addition', price_mode: 'extra', price_pence: 80 }],
    ['o-onion', { id: 'o-onion', label: 'Onion', variation_type: 'modification', price_mode: 'extra', price_pence: 0 }],
    ['o-oat', { id: 'o-oat', label: 'Oat milk', variation_type: 'modification', price_mode: 'extra', price_pence: 40 }],
    ['o-large', { id: 'o-large', label: 'Large', variation_type: 'modification', price_mode: 'base', price_pence: 400 }],
  ])
  const rule = (option_id, action, x = {}) => ({ id: 'r-' + option_id, option_id, dish_id: null, option_label: null, action, item_id: null, sub_recipe_id: null, swap_item_id: null, qty: null, unit: null, factor: null, recipe_id: null, ...x })
  const rules = [
    rule('o-cheese', 'add', { item_id: 'cheese', qty: 1, unit: 'slice' }),
    rule('o-onion', 'remove', { item_id: 'onion' }),
    rule('o-oat', 'swap', { item_id: 'milk', swap_item_id: 'oat' }),
    rule('o-large', 'scale', { factor: 1.5 }),
  ]
  const groups = [
    { group_id: 'g-extras', name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 3, options: [{ option_id: 'o-cheese', label: 'Cheese', price_pence: 80 }] },
    { group_id: 'g-off', name: 'Take off', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ option_id: 'o-onion', label: 'Onion', price_pence: 0 }] },
  ]
  const dish = (id, name, x = {}) => [id, { id, name, item_type: 'food', variants: [], variant_groups: [], ...x }]
  const step = (id, name, ids) => ({ id, name, min: 1, max: 1, options: ids.map((d, i) => ({ id: id + '-c' + i, type: 'item', item_id: d })) })
  const dishes = new Map([
    dish('d-burger', 'Burger', { variant_groups: groups }),
    dish('d-fries', 'Fries'),
    dish('d-latte', 'Latte', { variant_groups: [{ group_id: 'g-milk', name: 'Milk', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ option_id: 'o-oat', label: 'Oat milk', price_pence: 40 }] }] }),
    dish('d-wrap', 'Wrap'),
    dish('d-wings', 'Wings'),
    dish('d-soup', 'Soup'),
    dish('d-corkage', 'Corkage', { item_type: 'service' }),
    dish('d-deal', 'Burger meal', { kind: 'combo', combo: { mode: 'manual', steps: [step('st-main', 'Main', ['d-burger', 'd-wrap']), step('st-side', 'Side', ['d-fries'])] } }),
  ])
  return { items, quotes, preferred: {}, recipes, links, options, rules, dishes, names: {}, venueId: V, basis: 'standard', ...extra }
}
const qtys = u => Object.fromEntries(u.items.map(i => [i.item_id, i.qty_base]))
const EATING = { venue_id: V, order_type_id: EAT }
// The cost of what was taken off, at the standard price per base unit: the agreement with dishCost().
const costOfItems = (u, ctx) => u.items.reduce((s, i) => s + i.qty_base * itemCost(ctx.items.get(i.item_id), V, ctx, 'standard').per_base, 0)

test('a plain dish: its recipe as bought, a prep recipe inside by its yield and loss', () => {
  const ctx = ctxOf()
  const u = usageOf({ dish_id: 'd-burger', qty: 2 }, EATING, ctx)
  // Onion: 20 g at 80% is 25 g bought; 40 g of relish is 0.05 of a batch (0.8 kg), 1000 g of onion bought: 50 g.
  assert.deepEqual(qtys(u), { beef: 2, bun: 2, onion: 150 })
  assert.deepEqual(u.uncosted, [])
  assert.equal(u.recipe.name, 'Burger')
  assert.equal(u.coverage, 'full')
  close(u.cost, costOfItems(u, ctx), 'cost = items x their cost')
  close(u.cost, dishCost('d-burger', {}, EATING, ctx).cost * 2, 'and twice the dish\'s own cost')
  assert.deepEqual(qtys(recipeUsage(ctx.recipes.get('relish'), 0.4, ctx)), { onion: 500 }, 'half a batch of relish')
})

test('options: add, remove, swap and scale, as the cost walk applies them', () => {
  const ctx = ctxOf()
  const cheese = usageOf({ dish_id: 'd-burger', qty: 1, options: [{ option_id: 'o-cheese' }] }, EATING, ctx)
  assert.deepEqual(qtys(cheese), { beef: 1, bun: 1, onion: 75, cheese: 20 })
  const noOnion = usageOf({ dish_id: 'd-burger', qty: 1, options: [{ option_id: 'o-onion', prefix: 'no' }] }, EATING, ctx)
  assert.deepEqual(qtys(noOnion), { beef: 1, bun: 1, onion: 50 }, 'the onion line comes out; the relish stays')
  const oat = usageOf({ dish_id: 'd-latte', qty: 1, options: [{ option_id: 'o-oat' }] }, EATING, ctx)
  assert.deepEqual(qtys(oat), { oat: 200, coffee: 18 })
  const large = usageOf({ dish_id: 'd-latte', qty: 1, options: [{ option_id: 'o-large' }] }, EATING, ctx)
  assert.deepEqual(qtys(large), { milk: 300, coffee: 27 })
  // The till's modifiers carry one entry per pick: two cheeses are two slices.
  const two = usageOf({ dish_id: 'd-burger', qty: 3, options: [{ option_id: 'o-cheese' }, { option_id: 'o-cheese' }] }, EATING, ctx)
  assert.equal(qtys(two).cheese, 120)
  for (const u of [cheese, noOnion, oat, large, two]) close(u.cost, costOfItems(u, ctx), 'cost agrees for ' + u.name)
})

test('a meal deal: the dishes picked with their own options; without picks, its typical picks', () => {
  const ctx = ctxOf()
  const picked = usageOf({ dish_id: 'd-deal', qty: 1, picks: [{ step_id: 'st-main', item_id: 'd-burger', modifiers: [{ option_id: 'o-cheese' }] }, { step_id: 'st-side', item_id: 'd-fries', modifiers: [] }] }, EATING, ctx)
  // Fries: 300 g for two portions at 75%: 200 g bought each.
  assert.deepEqual(qtys(picked), { beef: 1, bun: 1, onion: 75, cheese: 20, potato: 200 })
  assert.equal(picked.kind, 'deal')
  assert.equal(picked.typical, false)
  close(picked.cost, costOfItems(picked, ctx))
  // No picks known (another till's mapped deal): each step's first choice before there are sales.
  const first = usageOf({ dish_id: 'd-deal', qty: 2 }, EATING, ctx)
  assert.equal(first.typical, true)
  assert.deepEqual(qtys(first), { beef: 2, bun: 2, onion: 150, potato: 400 })
  // Once there are sales, the dish picked most in each step.
  const mix = pickMix([{ deal_id: 'd-deal', step_id: 'st-main', dish_id: 'd-wrap', qty: 9 }, { deal_id: 'd-deal', step_id: 'st-main', dish_id: 'd-burger', qty: 4 }])
  assert.deepEqual(typicalPicks(ctx.dishes.get('d-deal'), { ...ctx, pickMix: mix }).map(p => p.dish_id), ['d-wrap', 'd-fries'])
  assert.deepEqual(qtys(usageOf({ dish_id: 'd-deal', qty: 1 }, EATING, { ...ctx, pickMix: mix })), { wrap: 1, cheese: 40, potato: 200 })
  // Waste logged by hand has no typical picks: the deal is a gap.
  assert.match(itemsOf({ dish_id: 'd-deal', qty: 1 }, ctx).gaps[0], /log the dishes/)
  // A till deal whose picks are known but empty takes nothing and says so.
  assert.equal(usageOf({ dish_id: 'd-deal', qty: 1, picks: [] }, EATING, ctx).uncosted[0].reason, 'no_picks')
})

test('a dish with no recipe takes nothing off and is uncosted; a service needs none', () => {
  const ctx = ctxOf()
  const soup = usageOf({ dish_id: 'd-soup', qty: 4 }, EATING, ctx)
  assert.deepEqual(soup.items, [])
  assert.equal(soup.uncosted[0].reason, 'no_recipe')
  assert.match(soup.uncosted[0].fix, /Dishes tab/)
  assert.equal(soup.coverage, 'none')
  const gone = usageOf({ dish_id: 'd-gone', qty: 1 }, EATING, ctx)
  assert.deepEqual(gone.items, [])
  assert.match(gone.uncosted[0].text, /no menu/)
  const corkage = usageOf({ dish_id: 'd-corkage', qty: 1 }, EATING, ctx)
  assert.deepEqual([corkage.items, corkage.uncosted, corkage.coverage], [[], [], 'not_needed'])
})

test('the matrix: the takeaway version for a takeaway sale, the venue\'s own at that venue, a stream\'s on that stream', () => {
  const ctx = ctxOf()
  assert.deepEqual(qtys(usageOf({ dish_id: 'd-burger' }, { venue_id: V, order_type_id: TAKE }, ctx)), { beef: 1, bun: 2 })
  const soho = usageOf({ dish_id: 'd-burger' }, { venue_id: SOHO, order_type_id: EAT }, ctx)
  assert.equal(soho.recipe.name, 'Soho burger')
  assert.deepEqual(qtys(soho), { beef: 2, bun: 1 })
  assert.equal(usageOf({ dish_id: 'd-burger' }, { venue_id: SOHO, revenue_stream_id: BAR }, ctx).recipe.name, 'Bar burger', 'a stream beats a venue, as tax rules score')
  assert.equal(usageOf({ dish_id: 'd-burger' }, { venue_id: SOHO, revenue_stream_id: BAR, order_type_id: TAKE }, ctx).recipe.name, 'Bar burger', 'stream 4 beats order type 2')
  assert.equal(usageOf({ dish_id: 'd-burger' }, EATING, ctx).recipe.name, 'Burger', 'elsewhere, the dish\'s own recipe')
})

test('an online order\'s options by their words, matched within the dish\'s groups; one not matched is uncosted', () => {
  const ctx = ctxOf()
  assert.deepEqual(matchOptions(ctx.dishes.get('d-burger'), [{ group: 'Extras', label: '2 x Cheese' }, { group: 'Sauces', label: 'Onion' }]).options,
    [{ option_id: 'o-cheese', qty: 2 }, { option_id: 'o-onion', qty: 1 }], 'a group renamed: the label alone, when only one option has it')
  const u = usageOf({ dish_id: 'd-burger', qty: 1, options: [{ group: 'Extras', label: '2 x Cheese', price_pence: 160, mode: 'extra' }, { group: 'Extras', label: 'Truffle' }] }, EATING, ctx)
  assert.equal(qtys(u).cheese, 40)
  assert.equal(u.uncosted.length, 1)
  assert.equal(u.uncosted[0].reason, 'option_label')
  assert.match(u.uncosted[0].text, /"Truffle" \(Extras\) is not one of its options now/)
  // A deal's parts from an online order carry their options by words too.
  const deal = usageOf({ dish_id: 'd-deal', qty: 1, picks: [{ step_id: 'st-main', item_id: 'd-burger', options: [{ group: 'Extras', label: 'Cheese' }] }, { step_id: 'st-side', item_id: 'd-fries', options: [] }] }, EATING, ctx)
  assert.deepEqual(qtys(deal), { beef: 1, bun: 1, onion: 75, cheese: 20, potato: 200 })
})

test('a draft Pepper read in still takes its items off, marked as not checked', () => {
  const u = usageOf({ dish_id: 'd-wings', qty: 3 }, EATING, ctxOf())
  assert.deepEqual(qtys(u), { beef: 6 })
  assert.equal(u.uncosted[0].reason, 'draft')
  assert.equal(u.coverage, 'partial')
})

test('a unit with no size is a gap: what can be taken off is', () => {
  const ctx = ctxOf()
  ctx.recipes.get('wrap').lines[1].unit = 'tbsp'
  const u = usageOf({ dish_id: 'd-wrap', qty: 1 }, EATING, ctx)
  assert.deepEqual(qtys(u), { wrap: 1 })
  assert.match(u.uncosted[0].text, /Wrap: Cheddar has no size for a tbsp/)
})
