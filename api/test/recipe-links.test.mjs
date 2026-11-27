// Recipe links, option rules and menu margins through the API (inventory
// phase 2, migrations 302 and 303): links at every scope and which one a
// sale uses (as taxFor() would pick), a stream fixing its venue, another
// group's dish, recipe, venue, stream, order type, option and item refused,
// bulk and goods links, option rules that add, remove, swap and scale, a
// duplicated menu keeping its links, the nightly sweep, margins on
// VAT-inclusive prices by order type with a meal deal's range, the targets,
// and costs kept from people without Costing view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { menuSaveBody } = await import('../src/routes/menus.js')
const { sweepRecipeLinks } = await import('../src/services/dishCostSvc.js')

const COOK = 'a-cook2'
let ids, owner, viewer, cook, bOwner
let soho, leeds, bar, bBar, eatIn, takeOut, bType, standard, zero
let beef, bun, cheddar, milk, oat, onion, coke
let burger, burgerToGo, burgerSoho, burgerBar, burgerBarTake, fries
let menu, dish, dishDouble, dishSalad, dishCoke, deal, extras, cheese, bacon, oatOpt, large, sizeGroup
let bMenu, bDish, bRecipe, bVenue, bItem

const close = (a, b, msg) => assert.ok(a != null && Math.abs(Number(a) - Number(b)) < 1e-6, (msg || '') + ': ' + a + ' is not ' + b)
const cellOf = (m, row, col) => m.cells[row + '|' + col]
const optionsQ = list => '&options=' + encodeURIComponent(JSON.stringify(list))

async function makeMenu(who, name, sections, tax = null) {
  const m = await ok(who.post('/api/menus', { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 6) }))
  const full = await ok(who.get('/api/menus/' + m.id))
  await ok(who.patch('/api/menus/' + m.id, { ...full, ...(tax ? { tax } : {}), sections }), 'menu ' + name)
  return ok(who.get('/api/menus/' + m.id))
}
const dishIn = (m, name) => m.sections.flatMap(s => s.items).find(i => i.name === name)

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  // A cook changes recipes and links and sees no costs.
  const cookRole = await ok(owner.post('/api/access/roles', { key: 'cook2', label: 'Cook', permissions: { recipes: 'manage', costing: 'none' } }), 'cook role')
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, ${COOK + '@test.local'}, 'operator', ${COOK}, ${cookRole.id})`
  cook = as(COOK, ids.a)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-rl', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-rl', timezone: 'Europe/London', currency: 'GBP' }))).id
  const tax = await ok(owner.get('/api/tax-rates'))
  eatIn = tax.order_types.find(t => t.name === 'Eat in').id
  takeOut = tax.order_types.find(t => t.name === 'Take out').id
  standard = tax.rates.find(r => r.name === 'Standard').id
  zero = tax.rates.find(r => r.name === 'Zero').id
  bar = (await ok(owner.post(`/api/pos/venues/${soho}/revenue-streams`, { name: 'Bar' }))).id
  // Prices: beef patty £1.50 each, bun £0.30, cheddar £8 a kg, milk £1 a litre, oat milk £2 a litre, onion £2 a kg.
  const sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  const item = async (name, base_unit, pack, price, extra = {}) => {
    const i = await ok(owner.post('/api/inventory/items', { name, base_unit, ...extra }))
    await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: sup.id, pack_name: 'Pack', ...pack, price }))
    return i
  }
  beef = await item('Beef patty', 'each', { pack_qty: 10, pack_unit: 'each' }, 15)
  bun = await item('Brioche bun', 'each', { pack_qty: 24, pack_unit: 'each' }, 7.2)
  cheddar = await item('Cheddar', 'g', { pack_qty: 1, pack_unit: 'kg' }, 8)
  milk = await item('Milk', 'ml', { pack_qty: 1, pack_unit: 'l' }, 1)
  oat = await item('Oat milk', 'ml', { pack_qty: 1, pack_unit: 'l' }, 2)
  onion = await item('Red onion', 'g', { pack_qty: 1, pack_unit: 'kg' }, 2)
  coke = await item('Coke can', 'each', { pack_qty: 24, pack_unit: 'each' }, 12, { barcode: '5000112637922' })
  const lines = [{ item_id: beef.id, qty: 1, unit: 'each' }, { item_id: bun.id, qty: 1, unit: 'each' }, { item_id: cheddar.id, qty: 40, unit: 'g' }, { item_id: milk.id, qty: 100, unit: 'ml' }]
  // £1.50 + £0.30 + £0.32 + £0.10 = £2.22
  burger = await ok(owner.post('/api/recipes', { name: 'Burger', kind: 'dish', portions: 1, status: 'live', lines }))
  // To go: two buns, no milk: £2.42. Soho's: onion on top (+£0.04): £2.26. The bar's: 15 g of cheese: £2.02. Bar to go, two buns and no milk: £2.22.
  burgerToGo = await ok(owner.post(`/api/recipes/${burger.id}/copy`, { name: 'Burger to go', variant: true }))
  await ok(owner.put('/api/recipes/' + burgerToGo.id, { ...saveBody(burgerToGo), lines: [lines[0], { ...lines[1], qty: 2 }, lines[2]] }))
  burgerSoho = await ok(owner.post('/api/recipes', { name: 'Burger Soho', kind: 'dish', portions: 1, variant_of: burger.id, lines: [...lines, { item_id: onion.id, qty: 20, unit: 'g' }] }))
  burgerBar = await ok(owner.post('/api/recipes', { name: 'Burger bar', kind: 'dish', portions: 1, variant_of: burger.id, lines: [lines[0], lines[1], { ...lines[2], qty: 15 }, lines[3]] }))
  burgerBarTake = await ok(owner.post('/api/recipes', { name: 'Burger bar to go', kind: 'dish', portions: 1, variant_of: burger.id, lines: [lines[0], { ...lines[1], qty: 2 }, { ...lines[2], qty: 15 }] }))
  fries = await ok(owner.post('/api/recipes', { name: 'Fries', kind: 'dish', portions: 1, lines: [{ item_id: onion.id, qty: 100, unit: 'g' }] }))
  // Option groups: extras (cheese, bacon) and a milk swap, with sizes.
  extras = await ok(owner.post('/api/menus/variant-groups', { name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 3, pos_prefixes: true, variation_type: 'addition', options: [{ label: 'Cheese', price_pence: 80 }, { label: 'Bacon', price_pence: 120 }, { label: 'Oat milk', price_pence: 40 }] }))
  cheese = extras.options.find(o => o.label === 'Cheese')
  bacon = extras.options.find(o => o.label === 'Bacon')
  oatOpt = extras.options.find(o => o.label === 'Oat milk')
  sizeGroup = await ok(owner.post('/api/menus/variant-groups', { name: 'Size', price_mode: 'extra', min_select: 0, max_select: 1, variation_type: 'modification', options: [{ label: 'Large', price_pence: 300 }] }))
  large = sizeGroup.options[0]
  // The menu: take out is zero rated, everything else standard (20%).
  menu = await makeMenu(owner, 'Lunch', [
    { title: 'Mains', items: [
      { name: 'Burger', price_pence: 1200, is_orderable: true, variant_groups: [{ group_id: extras.id, overrides: [] }, { group_id: sizeGroup.id, overrides: [] }], variants: [] },
      { name: 'Double', price_pence: 1500, is_orderable: true, variant_groups: [], variants: [] },
      { name: 'Salad', price_pence: 900, is_orderable: true, variant_groups: [], variants: [] },
    ] },
    { title: 'Drinks', items: [{ name: 'Coke', price_pence: 250, is_orderable: true, item_type: 'goods', barcode: '5000112637922', variant_groups: [], variants: [] }] },
  ], { rate: standard, rules: [{ venues: [], streams: [], types: [takeOut], rate: zero }] })
  dish = dishIn(menu, 'Burger').id
  dishDouble = dishIn(menu, 'Double').id
  dishSalad = dishIn(menu, 'Salad').id
  dishCoke = dishIn(menu, 'Coke').id
  // A meal deal: a main (burger or double), then a drink (the drinks section).
  const body = menuSaveBody(menu)
  body.sections.push({ title: 'Deals', items: [{
    name: 'Lunch deal', kind: 'combo', price_pence: 1500, is_orderable: true, variant_groups: [], variants: [],
    combo: { mode: 'manual', steps: [
      { id: randomUUID(), name: 'Main', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: dish }, { id: randomUUID(), type: 'item', item_id: dishDouble }] },
      { id: randomUUID(), name: 'Drink', min: 1, max: 1, options: [{ id: randomUUID(), type: 'section', section_id: menu.sections[1].id }] },
    ] },
  }] })
  await ok(owner.patch('/api/menus/' + menu.id, body), 'meal deal')
  menu = await ok(owner.get('/api/menus/' + menu.id))
  deal = dishIn(menu, 'Lunch deal').id
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}), 'publish')
  // The other group's own.
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere-rl', timezone: 'Europe/London', currency: 'GBP' }))).id
  bBar = (await ok(bOwner.post(`/api/pos/venues/${bVenue}/revenue-streams`, { name: 'Their bar' }))).id
  bType = (await ok(bOwner.get('/api/order-types')))[0].id
  bItem = await ok(bOwner.post('/api/inventory/items', { name: 'Their cheese', base_unit: 'g' }))
  bRecipe = await ok(bOwner.post('/api/recipes', { name: 'Their burger', kind: 'dish', lines: [{ item_id: bItem.id, qty: 10, unit: 'g' }] }))
  bMenu = await makeMenu(bOwner, 'Their menu', [{ title: 'Mains', items: [{ name: 'Their dish', price_pence: 500, is_orderable: true, variant_groups: [], variants: [] }] }])
  bDish = bMenu.sections[0].items[0].id
})
test.after(async () => { await closeApp() })

/** A recipe as PUT wants it: every field. */
function saveBody(r) {
  return {
    name: r.name, kind: r.kind, category: r.category, code: r.code, status: r.status, yield_qty: r.yield_qty, yield_unit: r.yield_unit,
    portions: r.portions, loss_pct: r.loss_pct, method: r.method, photo_url: r.photo_url, shelf_life_hours: r.shelf_life_hours,
    variant_of: r.variant_of, notes: r.notes, is_active: r.is_active,
    lines: r.lines.map(l => ({ item_id: l.item_id, sub_recipe_id: l.sub_recipe_id, qty: l.qty, unit: l.unit, yield_pct: l.yield_pct, note: l.note })),
  }
}
const cell = (body) => owner.put(`/api/recipe-links/dishes/${dish}/cell`, body)
const costAt = (scope, extra = '') => ok(owner.get(`/api/recipe-links/dishes/${dish}/cost?` + new URLSearchParams(scope).toString() + extra))

test('links at every scope, and the closest one is used, as taxFor picks a tax rule', async () => {
  await ok(cell({ recipe_id: burger.id }), 'every venue')
  await ok(cell({ order_type_id: takeOut, recipe_id: burgerToGo.id }), 'take out everywhere')
  await ok(cell({ venue_id: soho, recipe_id: burgerSoho.id }), 'Soho')
  await ok(cell({ revenue_stream_id: bar, recipe_id: burgerBar.id }), 'the bar (its venue filled in)')
  await ok(cell({ revenue_stream_id: bar, order_type_id: takeOut, recipe_id: burgerBarTake.id, portions: 1 }), 'the bar, take out')
  // Setting a cell again changes it, never makes a second link.
  const again = await ok(cell({ venue_id: soho, recipe_id: burgerSoho.id, portions: 1 }))
  assert.equal(again.made, false)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM recipe_links WHERE dish_id = ${dish}`
  assert.equal(n, 5)
  const [barLink] = await sql`SELECT venue_id FROM recipe_links WHERE revenue_stream_id = ${bar} AND order_type_id IS NULL`
  assert.equal(barLink.venue_id, soho, 'a stream link stores its venue')

  const expect = [
    [{ venue_id: leeds, order_type_id: eatIn }, 'Burger', 'every venue', 2.22],
    [{ venue_id: leeds, order_type_id: takeOut }, 'Burger to go', 'Take out at every venue', 2.42],
    [{ venue_id: soho, order_type_id: eatIn }, 'Burger Soho', 'Soho', 2.26],
    // Take out (2) beats Soho (1).
    [{ venue_id: soho, order_type_id: takeOut }, 'Burger to go', 'Take out at every venue', 2.42],
    // The stream (4) beats take out and Soho; the stream with take out (6) beats the stream alone.
    [{ venue_id: soho, revenue_stream_id: bar, order_type_id: eatIn }, 'Burger bar', 'Bar (Soho)', 2.02],
    [{ venue_id: soho, revenue_stream_id: bar, order_type_id: takeOut }, 'Burger bar to go', 'Take out at Bar (Soho)', 2.22],
  ]
  for (const [scope, name, why, cost] of expect) {
    const c = await costAt(scope)
    assert.equal(c.recipe.name, name, JSON.stringify(scope))
    assert.equal(c.why, why)
    close(c.cost, cost, name)
  }

  // The matrix: set cells solid, the rest inherited from the cell named.
  const m = await ok(owner.get('/api/recipe-links/dishes/' + dish))
  assert.deepEqual(m.rows.map(r => r.name), ['Every venue', 'Soho', 'Bar', 'Leeds'])
  assert.deepEqual(m.cols.map(c => c.name).slice(0, 3), ['Any order type', 'Eat in', 'Take out'])
  const every = cellOf(m, 'all', 'any')
  assert.equal(every.recipe.name, 'Burger')
  assert.ok(every.set && !every.inherited)
  const leedsTake = cellOf(m, 'v:' + leeds, 't:' + takeOut)
  assert.equal(leedsTake.recipe.name, 'Burger to go')
  assert.equal(leedsTake.inherited, true)
  assert.equal(leedsTake.from, 'all|t:' + takeOut)
  assert.equal(leedsTake.from_name, 'Every venue, take out')
  close(leedsTake.cost, 2.42)
  // Its margin there: take out is zero rated, so £12.00 is all net.
  assert.equal(leedsTake.margin.net_pence, 1200)
  assert.equal(leedsTake.margin.gp_pence, 1200 - 242)
  const barEat = cellOf(m, 's:' + bar, 't:' + eatIn)
  assert.equal(barEat.recipe.name, 'Burger bar')
  assert.equal(barEat.from, 's:' + bar + '|any')
  assert.equal(barEat.margin.net_pence, 1000, '20% VAT eating in')
  assert.equal(m.links.length, 5)
  assert.ok(m.links.some(l => l.where === 'Take out at Bar (Soho)'))
  // The recipe's own dishes: the editor's Used on menus card.
  const used = await ok(owner.get('/api/recipe-links/recipes/' + burgerToGo.id))
  assert.deepEqual(used.links.map(l => [l.dish_name, l.where, l.menu]), [['Burger', 'Take out at every venue', 'Lunch']])
  // A cell cleared falls back to the next closest.
  const soloLink = m.links.find(l => l.venue_id === soho && !l.revenue_stream_id && !l.order_type_id)
  await ok(owner.delete('/api/recipe-links/links/' + soloLink.id))
  assert.equal((await costAt({ venue_id: soho, order_type_id: eatIn })).recipe.name, 'Burger')
  await ok(cell({ venue_id: soho, recipe_id: burgerSoho.id }))
})

test('a stream fixes its venue, a prep recipe is refused, and another group\'s ids are not found', async () => {
  const wrong = await cell({ venue_id: leeds, revenue_stream_id: bar, recipe_id: burger.id })
  assert.equal(wrong.status, 422)
  assert.equal(wrong.json.code, 'stream_venue')
  const prep = await ok(owner.post('/api/recipes', { name: 'Sauce', kind: 'prep', yield_qty: 1, yield_unit: 'l', lines: [{ item_id: milk.id, qty: 1, unit: 'l' }] }))
  assert.equal((await cell({ recipe_id: prep.id })).json.code, 'not_dish')
  // Another group's dish, recipe, venue, stream and order type.
  assert.equal((await owner.put(`/api/recipe-links/dishes/${bDish}/cell`, { recipe_id: burger.id })).status, 404, 'their dish')
  assert.equal((await cell({ recipe_id: bRecipe.id })).status, 404, 'their recipe')
  assert.equal((await cell({ venue_id: bVenue, recipe_id: burger.id })).status, 404, 'their venue')
  assert.equal((await cell({ revenue_stream_id: bBar, recipe_id: burger.id })).status, 404, 'their stream')
  assert.equal((await cell({ order_type_id: bType, recipe_id: burger.id })).status, 404, 'their order type')
  assert.equal((await owner.get('/api/recipe-links/dishes/' + bDish)).status, 404)
  assert.equal((await owner.post('/api/recipe-links/bulk', { links: [{ dish_id: bDish, recipe_id: burger.id }] })).status, 404)
  assert.equal((await owner.post('/api/recipe-links/bulk', { links: [{ dish_id: dishDouble, recipe_id: bRecipe.id }] })).status, 404)
  // Their links can't be cleared, nor ours by them.
  const [ours] = await sql`SELECT id FROM recipe_links WHERE dish_id = ${dish} LIMIT 1`
  assert.equal((await bOwner.delete('/api/recipe-links/links/' + ours.id)).status, 404)
  assert.equal((await bOwner.get(`/api/recipe-links/dishes/${dish}/cost`)).status, 404)
  // Changing links is Recipes manage.
  assert.equal((await viewer.put(`/api/recipe-links/dishes/${dish}/cell`, { recipe_id: burger.id })).status, 403)
})

test('the Dishes tab: defaults, overrides, matches by code then name, and goods linked to their stock item', async () => {
  await ok(owner.patch('/api/recipes/' + fries.id + '/active', { is_active: true }))
  const list = await ok(owner.get('/api/recipe-links/dishes'))
  const row = name => list.dishes.find(d => d.name === name)
  assert.equal(row('Burger').default.recipe_name, 'Burger')
  assert.equal(row('Burger').overrides, 4)
  assert.equal(row('Burger').coverage, 'full')
  assert.equal(row('Double').coverage, 'unlinked')
  assert.equal(row('Double').suggestion, null, 'no recipe is called Double')
  assert.equal(row('Lunch deal').coverage, 'deal')
  // A goods dish whose barcode is a stock item's is offered it.
  assert.deepEqual(row('Coke').goods_item, { id: coke.id, name: 'Coke can' })
  const made = await ok(owner.post('/api/recipe-links/goods', { dishes: [{ dish_id: dishCoke, item_id: coke.id }] }))
  assert.equal(made.made, 1)
  close((await ok(owner.get(`/api/recipe-links/dishes/${dishCoke}/cost?venue_id=${leeds}`))).cost, 0.5, 'a can at £12 for 24')
  assert.equal((await ok(owner.post('/api/recipe-links/goods', { dishes: [{ dish_id: dishCoke, item_id: coke.id }] }))).made, 0, 'linked already')
  assert.equal((await owner.post('/api/recipe-links/goods', { dishes: [{ dish_id: dishCoke, item_id: bItem.id }] })).status, 404, 'their item')
  // A recipe with the dish's name is suggested; the bulk link keeps a default already there.
  const double = await ok(owner.post('/api/recipes', { name: 'Double burger', kind: 'dish', portions: 1, lines: [{ item_id: beef.id, qty: 2, unit: 'each' }] }))
  const again = await ok(owner.get('/api/recipe-links/dishes'))
  assert.equal(again.dishes.find(d => d.name === 'Double').suggestion?.recipe_id, double.id)
  const bulk = await ok(owner.post('/api/recipe-links/bulk', { links: [{ dish_id: dishDouble, recipe_id: double.id, portions: 1 }, { dish_id: dish, recipe_id: double.id }] }))
  assert.deepEqual(bulk, { linked: 1, kept: 1 })
  assert.equal((await costAt({ venue_id: leeds, order_type_id: eatIn })).recipe.name, 'Burger', 'the burger kept its own')
})

test('option rules add, remove, swap and scale whichever recipe the matrix picked', async () => {
  const rule = body => owner.put('/api/recipe-options/rules', {
    option_id: null, dish_id: null, option_label: null, item_id: null, sub_recipe_id: null, swap_item_id: null,
    qty: null, unit: null, factor: null, recipe_id: null, note: null, ...body,
  })
  await ok(rule({ option_id: cheese.id, action: 'add', item_id: cheddar.id, qty: 30, unit: 'G' }), 'cheese adds 30 g')
  await ok(rule({ option_id: oatOpt.id, action: 'swap', item_id: milk.id, swap_item_id: oat.id }), 'oat milk for milk')
  await ok(rule({ option_id: large.id, action: 'scale', factor: 1.5 }), 'large')
  // The Burger's own exception: Bacon is a side of fries there.
  await ok(rule({ option_id: bacon.id, dish_id: dish, action: 'recipe', recipe_id: fries.id }))
  const leedsEat = { venue_id: leeds, order_type_id: eatIn }
  close((await costAt(leedsEat, optionsQ([{ option_id: cheese.id }]))).cost, 2.22 + 0.24, 'add')
  close((await costAt(leedsEat, optionsQ([{ option_id: oatOpt.id }]))).cost, 2.22 - 0.1 + 0.2, 'swap')
  close((await costAt(leedsEat, optionsQ([{ option_id: large.id }]))).cost, 2.22 * 1.5, 'scale')
  close((await costAt(leedsEat, optionsQ([{ option_id: bacon.id }]))).cost, 2.22 + 0.2, 'a recipe of its own: 100 g onion')
  // Remove through the till's prefix: No cheese takes the recipe's cheddar out.
  close((await costAt(leedsEat, optionsQ([{ option_id: cheese.id, prefix: 'no' }]))).cost, 2.22 - 0.32, 'no cheese')
  // The takeaway version has no milk: the swap changes nothing there.
  const away = await costAt({ venue_id: leeds, order_type_id: takeOut }, optionsQ([{ option_id: oatOpt.id }]))
  close(away.cost, 2.42)
  assert.match(away.options[0].text, /no Milk in the recipe to swap/)
  // An explicit remove rule for a dish's own option (by its label).
  await ok(rule({ dish_id: dish, option_label: 'No milk', action: 'remove', item_id: milk.id }))
  const lib = await ok(owner.get('/api/recipe-options'))
  const extrasGroup = lib.groups.find(g => g.name === 'Extras')
  assert.equal(extrasGroup.options.find(o => o.label === 'Cheese').rule.text, 'Adds 30 g Cheddar')
  assert.equal(extrasGroup.options.find(o => o.label === 'Bacon').state, 'gap', 'an addition with no rule of its own')
  assert.equal(extrasGroup.options.find(o => o.label === 'Bacon').exceptions, 1)
  const one = await ok(owner.get('/api/recipe-options/options/' + bacon.id))
  assert.equal(one.exceptions[0].dish_name, 'Burger')
  assert.equal(one.dishes.find(d => d.name === 'Burger').rule_from, 'dish')
  // Refused: a rule that doesn't say enough, another group's option, item, dish or recipe; and a viewer.
  assert.equal((await rule({ option_id: cheese.id, action: 'add', item_id: cheddar.id })).json.code, 'rule')
  assert.equal((await rule({ option_id: randomUUID(), action: 'nothing' })).status, 404)
  assert.equal((await rule({ option_id: cheese.id, action: 'remove', item_id: bItem.id })).status, 404, 'their item')
  assert.equal((await rule({ option_id: cheese.id, dish_id: bDish, action: 'nothing' })).status, 404, 'their dish')
  assert.equal((await rule({ option_id: cheese.id, action: 'recipe', recipe_id: bRecipe.id })).status, 404, 'their recipe')
  assert.equal((await viewer.put('/api/recipe-options/rules', { option_id: cheese.id, dish_id: null, option_label: null, action: 'nothing', item_id: null, sub_recipe_id: null, swap_item_id: null, qty: null, unit: null, factor: null, recipe_id: null, note: null })).status, 403)
  const [{ id: bacRule }] = await sql`SELECT id FROM recipe_option_rules WHERE option_id = ${bacon.id} AND dish_id = ${dish}`
  assert.equal((await bOwner.delete('/api/recipe-options/rules/' + bacRule)).status, 404)
  assert.equal((await bOwner.get('/api/recipe-options/options/' + bacon.id)).status, 404)
  // A save is the whole rule (rule 13): one field left out is refused.
  assert.equal((await owner.put('/api/recipe-options/rules', { option_id: cheese.id, action: 'nothing' })).status, 400)
})

test('menu margins: net of VAT by order type, uncosted dishes listed, a meal deal\'s range, and the targets', async () => {
  const q = scope => ok(owner.get('/api/menu-margins?' + new URLSearchParams({ menu_id: menu.id, ...scope }).toString()))
  const eat = await q({ venue_id: leeds, order_type_id: eatIn })
  assert.equal(eat.menu.version, 'live')
  const burgerRow = eat.rows.find(r => r.name === 'Burger')
  // £12.00 with 20% VAT in it: £10.00 net; £2.22 cost: £7.78 GP, 22.2%.
  assert.equal(burgerRow.net_pence, 1000)
  assert.equal(burgerRow.cost_pence, 222)
  assert.equal(burgerRow.gp_pence, 778)
  assert.equal(burgerRow.cost_pct, 22.2)
  assert.equal(burgerRow.band, 'good')
  // Extra cheese at 80p (67p net) costs 24p.
  const cheeseRow = burgerRow.options.find(o => o.label === 'Cheese')
  assert.deepEqual([cheeseRow.net_pence, cheeseRow.cost_pence, cheeseRow.gp_pence], [67, 24, 43])
  const away = await q({ venue_id: leeds, order_type_id: takeOut })
  assert.equal(away.rows.find(r => r.name === 'Burger').net_pence, 1200, 'take out is zero rated')
  assert.equal(away.rows.find(r => r.name === 'Burger').recipe.name, 'Burger to go')
  // The salad has no recipe: listed, with how to fix it.
  assert.deepEqual(eat.uncosted.map(u => u.name), ['Salad'])
  assert.match(eat.uncosted[0].fix, /Dishes tab/)
  // The deal: a burger (£2.22) or the double (£3.00), and a coke (£0.50).
  const dealRow = eat.rows.find(r => r.name === 'Lunch deal')
  close(dealRow.cost_min, 2.72)
  close(dealRow.cost_max, 3.5)
  assert.equal(dealRow.cost, null)
  // Targets: a section of its own, saved whole; Costing manage only.
  const drinks = menu.sections.find(s => s.title === 'Drinks')
  assert.equal((await viewer.put('/api/menu-margins/settings', { target_pct: 25, limit_pct: 30, sections: [] })).status, 403)
  assert.equal((await owner.put('/api/menu-margins/settings', { target_pct: 31, limit_pct: 30, sections: [] })).json.code, 'thresholds')
  assert.equal((await owner.put('/api/menu-margins/settings', { target_pct: 20, limit_pct: 22, sections: [{ section_id: bMenu.sections[0].id, target_pct: 10, limit_pct: 20 }] })).status, 404, 'their section')
  const saved = await ok(owner.put('/api/menu-margins/settings', { target_pct: 20, limit_pct: 22, sections: [{ section_id: drinks.id, target_pct: 30, limit_pct: 40 }] }))
  assert.equal(saved.target_pct, 20)
  const strict = await q({ venue_id: leeds, order_type_id: eatIn })
  assert.equal(strict.rows.find(r => r.name === 'Burger').band, 'over')
  const cokeRow = strict.rows.find(r => r.name === 'Coke')
  assert.equal(cokeRow.thresholds.from, 'section')
  assert.equal(cokeRow.cost_pct, 24)
  assert.equal(cokeRow.band, 'good')
  // The draft, and another group's menu.
  assert.equal((await q({ venue_id: leeds, version: 'draft' })).menu.version, 'draft')
  assert.equal((await owner.get('/api/menu-margins?menu_id=' + bMenu.id)).status, 404)
  assert.equal((await owner.get(`/api/menu-margins?menu_id=${menu.id}&venue_id=${leeds}&revenue_stream_id=${bar}`)).json.code, 'stream_venue')
})

test('costs are kept from people without Costing view', async () => {
  const m = await ok(cook.get('/api/recipe-links/dishes/' + dish))
  const every = cellOf(m, 'all', 'any')
  assert.equal(every.recipe.name, 'Burger')
  assert.ok(!('cost' in every) && !('margin' in every))
  assert.equal(m.can.costs, false)
  const c = await ok(cook.get(`/api/recipe-links/dishes/${dish}/cost?venue_id=${leeds}`))
  assert.equal(c.recipe.name, 'Burger')
  for (const k of ['"cost":', '"margin":', '"recipe_explanation":', '"min":', '"lines":']) assert.ok(!JSON.stringify(c).includes(k), k)
  assert.ok(c.steps.every(s => s.amount === undefined))
  assert.equal((await cook.get('/api/menu-margins?menu_id=' + menu.id)).status, 403)
  // A cook can still link (Recipes manage).
  await ok(cook.put(`/api/recipe-links/dishes/${dishSalad}/cell`, { recipe_id: burger.id, portions: 2 }))
})

test('duplicating a menu copies its dishes\' links and rules to the new dishes', async () => {
  const copy = await ok(owner.post(`/api/menus/${menu.id}/duplicate`, {}))
  const full = await ok(owner.get('/api/menus/' + copy.id))
  const newBurger = dishIn(full, 'Burger').id
  assert.notEqual(newBurger, dish)
  const links = await sql`SELECT recipe_id, venue_id, revenue_stream_id, order_type_id FROM recipe_links WHERE dish_id = ${newBurger} ORDER BY recipe_id`
  const olds = await sql`SELECT recipe_id, venue_id, revenue_stream_id, order_type_id FROM recipe_links WHERE dish_id = ${dish} ORDER BY recipe_id`
  assert.deepEqual(links, olds)
  const rules = await sql`SELECT option_id, option_label, action FROM recipe_option_rules WHERE dish_id = ${newBurger} ORDER BY action`
  assert.deepEqual(rules.map(r => r.action), ['recipe', 'remove'])
  // The copy's section keeps the Drinks target.
  const [{ sections }] = await sql`SELECT sections FROM costing_settings WHERE tenant_id = ${ids.a}`
  assert.equal(sections.length, 2)
})

test('the nightly sweep marks links whose dish is on no menu, deletes them after 30 days, and clears a dish that is back', async () => {
  // The salad leaves the draft but is still live: not missing.
  const now = await ok(owner.get('/api/menus/' + menu.id))
  const body = menuSaveBody(now)
  const withoutSalad = { ...body, sections: body.sections.map(s => ({ ...s, items: s.items.filter(i => i.id !== dishSalad) })) }
  await ok(owner.patch('/api/menus/' + menu.id, withoutSalad))
  await sweepRecipeLinks()
  let [l] = await sql`SELECT missing_since FROM recipe_links WHERE dish_id = ${dishSalad}`
  assert.equal(l.missing_since, null, 'still live')
  // Published without it: missing, listed as no longer on a menu.
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  await sweepRecipeLinks()
  ;[l] = await sql`SELECT missing_since FROM recipe_links WHERE dish_id = ${dishSalad}`
  assert.ok(l.missing_since)
  const list = await ok(owner.get('/api/recipe-links/dishes'))
  assert.ok(list.missing.some(x => x.dish_id === dishSalad && x.missing_since))
  // Back on the menu: cleared.
  await ok(owner.patch('/api/menus/' + menu.id, body))
  await sweepRecipeLinks()
  ;[l] = await sql`SELECT missing_since FROM recipe_links WHERE dish_id = ${dishSalad}`
  assert.equal(l.missing_since, null, 'back on a menu')
  // Gone for good: after 30 days missing it is deleted, and another group's links are left alone.
  const ghost = randomUUID()
  await sql`INSERT INTO recipe_links (tenant_id, dish_id, recipe_id, missing_since) VALUES (${ids.a}, ${ghost}, ${burger.id}, now() - interval '31 days')`
  const [their] = await sql`INSERT INTO recipe_links (tenant_id, dish_id, recipe_id) VALUES (${ids.b}, ${bDish}, ${bRecipe.id}) RETURNING id`
  const r = await sweepRecipeLinks()
  assert.ok(r.deleted >= 1)
  assert.equal((await sql`SELECT 1 FROM recipe_links WHERE dish_id = ${ghost}`).length, 0)
  const [still] = await sql`SELECT missing_since FROM recipe_links WHERE id = ${their.id}`
  assert.equal(still.missing_since, null, 'their dish is on their menu')
})

test('Pepper\'s dish_cost and menu_margins: names never ids, costs only with Costing view', async () => {
  const { getApp } = await import('./support/app.mjs')
  const { makeContext } = await import('../src/ai/context.js')
  const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
  const app = await getApp()
  const quiet = { info() {}, warn() {}, error() {}, debug() {} }
  const call = async (sub, name, input) => {
    const ctx = makeContext({
      app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
      auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
    })
    const t = audienceTools('staff').find(x => x.name === name)
    return t.run(ctx, parseInput(t, input))
  }
  const one = await call(A.owner, 'dish_cost', { dish: 'Burger', menu: 'Lunch', venue: 'Soho', stream: 'Bar', order_type: 'take out' })
  assert.equal(one.recipe, 'Burger bar to go')
  assert.match(one.why, /Take out at Bar \(Soho\)/)
  assert.equal(one.cost, '£2.22')
  assert.equal(one.net_of_vat, '£12.00 (0% VAT)')
  assert.ok(one.steps.some(s => /^Cost %/.test(s)))
  const cheesy = await call(A.owner, 'dish_cost', { dish: 'Burger', menu: 'Lunch', venue: 'Leeds', order_type: 'Eat in', options: [{ option: 'cheese' }] })
  assert.equal(cheesy.cost, '£2.46')
  assert.ok(cheesy.options.some(o => /Cheese: adds 30 g Cheddar/.test(o)))
  const menuView = await call(A.owner, 'menu_margins', { menu: 'Lunch', venue: 'Leeds', order_type: 'Eat in' })
  assert.ok(menuView.dishes.length > 2)
  // A meal deal is placed by its dearest picks ("21.8% to 28.0%").
  const pcts = menuView.dishes.map(d => parseFloat(String(d.cost_pct).split(' to ').pop()))
  assert.deepEqual(pcts, [...pcts].sort((a, b) => b - a), 'worst first')
  assert.doesNotMatch(JSON.stringify(one) + JSON.stringify(cheesy) + JSON.stringify(menuView), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/, 'no uuid in what the model reads')
  // A cook reads which recipe, not its money; menu margins are Costing view.
  const cooks = await call(COOK, 'dish_cost', { dish: 'Burger', menu: 'Lunch', venue: 'Leeds', order_type: 'Take out' })
  assert.equal(cooks.recipe, 'Burger to go')
  assert.match(cooks.note, /Costing view/)
  assert.doesNotMatch(JSON.stringify(cooks), /£/)
  await assert.rejects(call(COOK, 'menu_margins', { menu: 'Lunch' }), /permission/i)
})

test('migration 303 puts Menu margins after Recipes in saved menus, once', async () => {
  const fs = await import('node:fs')
  const sqlText = fs.readFileSync(new URL('../../migrations/303_recipes_margins_menu.sql', import.meta.url), 'utf8')
  const [{ n: before }] = await sql`SELECT count(*)::int AS n FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/menu-margins'`
  assert.equal(before, 1, 'a new group\'s menu has it')
  await sql`DELETE FROM nav_items WHERE route = '/menu-margins'`
  await sql.unsafe(sqlText)
  await sql.unsafe(sqlText)
  const rows = await sql`
    SELECT n.route, n.sort_order, n.parent_id FROM nav_items n WHERE n.tenant_id = ${ids.a} AND n.route IN ('/recipes', '/menu-margins') ORDER BY n.sort_order`
  assert.deepEqual(rows.map(r => r.route), ['/recipes', '/menu-margins'])
  assert.equal(rows[1].sort_order, rows[0].sort_order + 1)
  assert.equal(rows[1].parent_id, rows[0].parent_id)
})

test('the report subjects: recipe links in words, dish margins as the page works them out, and the starters', async () => {
  const links = await ok(owner.post('/api/reports/preview', { spec: { subject: 'recipes.links', kind: 'list', rows: ['dish', 'menu', 'recipe.name', 'applies_to', 'portions'] } }))
  assert.ok(links.rows.some(r => r.cells[0] === 'Burger' && r.cells[1] === 'Lunch' && r.cells[2] === 'Burger bar to go' && r.cells[3] === 'Take out at Bar (Soho)'))
  assert.ok(links.rows.some(r => r.cells[2] === 'Burger' && r.cells[3] === 'every venue'))
  const rep = await ok(owner.post('/api/reports/preview', { spec: { subject: 'recipes.margins', kind: 'list', rows: ['dish', 'menu', 'venue.name', 'order_type', 'net', 'cost', 'gp', 'cost_pct', 'band', 'recipe'] } }))
  const row = (dish, venue, type) => rep.rows.find(r => r.cells[0] === dish && r.cells[1] === 'Lunch' && r.cells[2] === venue && r.cells[3] === type)?.cells
  const page = await ok(owner.get(`/api/menu-margins?menu_id=${menu.id}&venue_id=${leeds}&order_type_id=${takeOut}`))
  const p = page.rows.find(r => r.name === 'Burger')
  const r = row('Burger', 'Leeds', 'Take out')
  close(r[4], p.net_pence / 100, 'net, in pounds')
  close(r[5], p.cost, 'cost')
  close(r[6], p.gp_pence / 100, 'GP')
  close(r[7], p.cost_pct / 100, 'cost %, as a fraction')
  assert.equal(r[9], 'Burger to go')
  // The starters run, for Costing view.
  const over = await ok(owner.post('/api/reports/starter:dishes_over_target/run', {}))
  assert.ok(over.rows.length > 0, 'the targets are 20% and 22%: the burger is over')
  const none = await ok(owner.post('/api/reports/starter:dishes_no_recipe/run', {}))
  assert.ok(none.rows.every(x => !/Lunch deal/.test(JSON.stringify(x.cells))), 'a meal deal needs no recipe')
  // Without Costing view: no dish margins.
  assert.equal((await viewer.post('/api/reports/starter:dishes_over_target/run', {})).status, 403)
})
