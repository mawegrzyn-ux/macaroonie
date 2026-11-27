// Recipes and the cost engine through the API (inventory phase 1, migrations
// 298 to 301): an item's own units and yield, recipes with nested prep saved
// whole, a recipe inside itself refused, the cost at two venues paying
// different prices (and on what was paid there), costs kept from people
// without Costing view, and another group's items and recipes refused.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')

const COOK = 'a-cook'
const BUYER = 'a-buyer'
let ids, owner, operator, viewer, cook, buyer, bOwner, V1, V2, sup, cheddar, milk, bun, saffron, bItem, bRecipe

const close = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 1e-6, (msg || '') + ': ' + a + ' is not ' + b)

/** A recipe as PUT wants it: every field, from what GET returned. */
const saveBody = (r, change = {}) => ({
  name: r.name, kind: r.kind, category: r.category, code: r.code, status: r.status, yield_qty: r.yield_qty,
  yield_unit: r.yield_unit, portions: r.portions, loss_pct: r.loss_pct, method: r.method, photo_url: r.photo_url,
  shelf_life_hours: r.shelf_life_hours, variant_of: r.variant_of, notes: r.notes, is_active: r.is_active,
  lines: r.lines.map(l => ({ item_id: l.item_id, sub_recipe_id: l.sub_recipe_id, qty: l.qty, unit: l.unit, yield_pct: l.yield_pct, note: l.note })),
  ...change,
})

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  // A cook edits recipes and sees no costs; a buyer sees costs (and supplier prices) but can't edit recipes.
  const cookRole = await ok(owner.post('/api/access/roles', { key: 'cook', label: 'Cook', permissions: { recipes: 'manage', costing: 'none', reports: 'use' } }), 'cook role')
  const buyerRole = await ok(owner.post('/api/access/roles', { key: 'buyer', label: 'Buyer', permissions: { recipes: 'view', costing: 'view', purchasing_setup: 'view' } }), 'buyer role')
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
            VALUES (${ids.a}, ${COOK + '@test.local'}, 'operator', ${COOK}, ${cookRole.id}),
                   (${ids.a}, ${BUYER + '@test.local'}, 'operator', ${BUYER}, ${buyerRole.id})`
  cook = as(COOK, ids.a)
  buyer = as(BUYER, ids.a)
  V1 = (await ok(owner.post('/api/venues', { name: 'Kingsway', slug: 'kingsway-rc', timezone: 'Europe/London', currency: 'GBP' }))).id
  V2 = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-rc', timezone: 'Europe/London', currency: 'GBP' }))).id
  sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  cheddar = await ok(owner.post('/api/inventory/items', { name: 'Cheddar', base_unit: 'g' }))
  // 6 x 2 kg at £102 a case: £8.50 a kg; Leeds pays £108 (£9 a kg).
  const q = (await ok(owner.post(`/api/inventory/items/${cheddar.id}/quotes`, { supplier_id: sup.id, pack_name: 'Case', pack_count: 6, pack_qty: 2, pack_unit: 'kg', price: 102 }))).quotes[0]
  await ok(owner.put(`/api/inventory/quotes/${q.id}/venue-prices`, { prices: [{ venue_id: V2, price: 108 }] }))
  milk = await ok(owner.post('/api/inventory/items', { name: 'Milk', base_unit: 'ml' }))
  await ok(owner.post(`/api/inventory/items/${milk.id}/quotes`, { supplier_id: sup.id, pack_name: 'Bottle', pack_qty: 2, pack_unit: 'l', price: 1.6 }))
  bun = await ok(owner.post('/api/inventory/items', { name: 'Brioche bun', base_unit: 'each' }))
  await ok(owner.post(`/api/inventory/items/${bun.id}/quotes`, { supplier_id: sup.id, pack_name: 'Tray', pack_qty: 24, pack_unit: 'each', price: 7.2 }))
  saffron = await ok(owner.post('/api/inventory/items', { name: 'Saffron', base_unit: 'g' }))
  bItem = await ok(bOwner.post('/api/inventory/items', { name: 'Other cheese', base_unit: 'g' }))
  bRecipe = await ok(bOwner.post('/api/recipes', { name: 'Other sauce', kind: 'prep', yield_qty: 1, yield_unit: 'l', lines: [{ item_id: bItem.id, qty: 100, unit: 'g' }] }))
})
test.after(async () => { await closeApp() })

test('an item\'s yield and own units: added, renamed into its recipe lines, refused when they clash or are used', async () => {
  const withYield = await ok(owner.patch('/api/inventory/items/' + cheddar.id, { yield_pct: 95 }))
  assert.equal(withYield.yield_pct, 95)
  assert.equal((await owner.patch('/api/inventory/items/' + cheddar.id, { yield_pct: 0 })).status, 400, 'yield is 1 to 100')
  const withSlice = await ok(owner.post(`/api/inventory/items/${cheddar.id}/units`, { name: 'slce', base_qty: 20 }))
  assert.deepEqual(withSlice.units.map(u => [u.name, u.base_qty]), [['slce', 20]])
  const kg = await owner.post(`/api/inventory/items/${cheddar.id}/units`, { name: 'KG', base_qty: 1000 })
  assert.equal(kg.status, 422)
  assert.match(kg.json.error, /already knows kg/)
  assert.equal((await owner.post(`/api/inventory/items/${cheddar.id}/units`, { name: 'SLCE', base_qty: 5 })).status, 422, 'one name per item')
  // The usual units must be ones it knows.
  assert.equal((await owner.patch('/api/inventory/items/' + cheddar.id, { recipe_unit: 'tbsp' })).json.code, 'unit_unknown')
  assert.equal((await ok(owner.patch('/api/inventory/items/' + cheddar.id, { recipe_unit: 'SLCE' }))).recipe_unit, 'slce')
  // A recipe gives it in slce; renaming the unit follows into the line and the usual unit.
  const r = await ok(owner.post('/api/recipes', { name: 'Toastie', lines: [{ item_id: cheddar.id, qty: 2, unit: 'slce' }] }))
  const unitId = withSlice.units[0].id
  const renamed = await ok(owner.patch('/api/inventory/units/' + unitId, { name: 'slice' }))
  assert.equal(renamed.recipe_unit, 'slice')
  assert.equal((await ok(owner.get('/api/recipes/' + r.id))).lines[0].unit, 'slice')
  // Used by a recipe: it can't be deleted, nor the item's base unit changed; deleting the item switches it off.
  const del = await owner.delete('/api/inventory/units/' + unitId)
  assert.equal(del.status, 409)
  assert.equal(del.json.code, 'unit_in_use')
  assert.deepEqual(del.json.recipes, ['Toastie'])
  assert.equal((await owner.patch('/api/inventory/items/' + cheddar.id, { base_unit: 'each' })).status, 422)
  const spare = await ok(owner.post('/api/inventory/items', { name: 'Spare cheese', base_unit: 'g' }))
  await ok(owner.post('/api/recipes', { name: 'Spare toastie', lines: [{ item_id: spare.id, qty: 10, unit: 'g' }] }))
  assert.deepEqual(await ok(owner.delete('/api/inventory/items/' + spare.id)), { archived: true })
  // Purchasing setup manage is needed to change units; another group's unit is not found.
  assert.equal((await operator.post(`/api/inventory/items/${cheddar.id}/units`, { name: 'wedge', base_qty: 200 })).status, 403)
  assert.equal((await bOwner.patch('/api/inventory/units/' + unitId, { name: 'x' })).status, 404)
  assert.equal((await bOwner.delete('/api/inventory/units/' + unitId)).status, 404)
  await ok(owner.patch('/api/inventory/items/' + cheddar.id, { yield_pct: 100 }))
})

let sauce, burger
test('recipes are made and saved whole: a prep with its yield and loss inside a dish, lines replaced', async () => {
  sauce = await ok(owner.post('/api/recipes', {
    name: 'Cheese sauce', kind: 'prep', category: 'Sauces', yield_qty: 2, yield_unit: 'L', loss_pct: 25,
    lines: [{ item_id: milk.id, qty: 2, unit: 'l' }, { item_id: cheddar.id, qty: 400, unit: 'g' }],
  }))
  assert.equal(sauce.yield_unit, 'l')
  assert.equal(sauce.coverage, 'full')
  burger = await ok(owner.post('/api/recipes', {
    name: 'Cheeseburger', kind: 'dish', portions: 2, method: 'Toast the bun.', status: 'live',
    lines: [
      { item_id: cheddar.id, qty: 2, unit: 'Slice' },
      { sub_recipe_id: sauce.id, qty: 100, unit: 'ml' },
      { item_id: bun.id, qty: 2, unit: 'each', yield_pct: 50, note: 'One burns' },
    ],
  }))
  assert.deepEqual(burger.lines.map(l => [l.kind, l.name, l.unit]), [['item', 'Cheddar', 'slice'], ['recipe', 'Cheese sauce', 'ml'], ['item', 'Brioche bun', 'each']])
  assert.equal(burger.lines[2].yield_pct, 50)
  assert.equal(burger.lines[2].note, 'One burns')
  assert.deepEqual(sauce.lines.length, 2)
  assert.deepEqual((await ok(owner.get('/api/recipes/' + sauce.id))).used_in.map(r => r.name), ['Cheeseburger'])
  // PUT replaces every field and the lines: the bun's line comes off, its order is kept.
  const full = await ok(owner.get('/api/recipes/' + burger.id))
  const saved = await ok(owner.put('/api/recipes/' + burger.id, saveBody(full, { lines: saveBody(full).lines.slice(0, 2).reverse() })))
  assert.deepEqual(saved.lines.map(l => l.name), ['Cheese sauce', 'Cheddar'])
  assert.equal(saved.method, 'Toast the bun.', 'fields sent back stay')
  // A save must send every field (rule 13): one left out is refused, not cleared.
  const { method, ...noMethod } = saveBody(saved)
  assert.equal((await owner.put('/api/recipes/' + burger.id, noMethod)).status, 400)
  await ok(owner.put('/api/recipes/' + burger.id, saveBody(full)))
  // A line is an item or a prep recipe, never both or neither; a dish never goes inside another.
  assert.equal((await owner.post('/api/recipes', { name: 'Bad', lines: [{ item_id: milk.id, sub_recipe_id: sauce.id, qty: 1, unit: 'l' }] })).status, 400)
  const dishInside = await owner.post('/api/recipes', { name: 'Bad', lines: [{ sub_recipe_id: burger.id, qty: 1, unit: 'portion' }] })
  assert.equal(dishInside.json.code, 'not_prep')
  assert.equal((await owner.post('/api/recipes', { name: 'Bad', photo_url: 'javascript:alert(1)' })).status, 400, 'a photo is a picture from the media library')
})

test('a recipe inside itself, directly or through others, is refused with the path', async () => {
  const inner = await ok(owner.post('/api/recipes', { name: 'Roux', kind: 'prep', yield_qty: 1, yield_unit: 'kg', lines: [{ item_id: milk.id, qty: 100, unit: 'ml' }] }))
  const s = await ok(owner.get('/api/recipes/' + sauce.id))
  await ok(owner.put('/api/recipes/' + sauce.id, saveBody(s, { lines: [...saveBody(s).lines, { sub_recipe_id: inner.id, qty: 50, unit: 'g' }] })))
  // Roux > Cheese sauce > Roux.
  const r = await ok(owner.get('/api/recipes/' + inner.id))
  const loop = await owner.put('/api/recipes/' + inner.id, saveBody(r, { lines: [...saveBody(r).lines, { sub_recipe_id: sauce.id, qty: 1, unit: 'l' }] }))
  assert.equal(loop.status, 422)
  assert.equal(loop.json.code, 'recipe_cycle')
  assert.equal(loop.json.error, 'Roux can\'t go inside itself: Roux > Cheese sauce > Roux.')
  const self = await owner.put('/api/recipes/' + inner.id, saveBody(r, { lines: [{ sub_recipe_id: inner.id, qty: 1, unit: 'kg' }] }))
  assert.equal(self.json.code, 'recipe_cycle')
  // Taken out again for the cost tests.
  await ok(owner.put('/api/recipes/' + sauce.id, saveBody(s)))
})

test('the cost at two venues paying different prices, per portion, with the explanation', async () => {
  // Sauce: 2 l milk £1.60 + 400 g cheddar £3.40 = £5.00, making 1.5 l after the loss.
  const s1 = await ok(owner.get(`/api/recipes/${sauce.id}?venue_id=${V1}`))
  close(s1.cost, 5)
  close(s1.per_unit, 5 / 1.5, 'per litre')
  const b1 = await ok(owner.get(`/api/recipes/${burger.id}?venue_id=${V1}`))
  // Two slices (40 g at £8.50 a kg) £0.34, 100 ml of sauce, two buns at half yield (four bought, £1.20).
  close(b1.lines[0].cost, 0.34)
  close(b1.lines[1].cost, 0.1 * 5 / 1.5)
  close(b1.lines[2].cost, 1.2)
  const total1 = 0.34 + 0.1 * 5 / 1.5 + 1.2
  close(b1.cost, total1)
  close(b1.per_unit, total1 / 2)
  assert.equal(b1.unit, 'portion')
  assert.equal(b1.coverage, 'full')
  assert.equal(b1.venue.name, 'Kingsway')
  assert.match(b1.explanation.text, /40 g at £8\.50 a kg \(Brakes, Case · 6 × 2 kg, £102\.00 a pack/)
  assert.match(b1.explanation.text, /Per portion/)
  // Leeds pays £9 a kg for cheddar: the slices and the sauce both cost more.
  const b2 = await ok(owner.get(`/api/recipes/${burger.id}?venue_id=${V2}`))
  close(b2.lines[0].cost, 0.36)
  assert.ok(b2.cost > b1.cost)
  const list = await ok(owner.get(`/api/recipes?venue_id=${V2}&kind=dish`))
  const row = list.recipes.find(r => r.id === burger.id)
  close(row.per_unit, b2.per_unit, 'the list and the recipe agree')
  assert.ok(list.recipes.every(r => r.kind === 'dish'))
  // Nothing received at Kingsway yet: on last paid it is not costed; the standard price is beside it.
  assert.equal(b1.bases.last.coverage, 'none')
  close(b1.bases.standard.per_unit, b1.per_unit)
})

test('gaps: an item with no price and a unit with no size are listed with how to fix them; the rest is costed', async () => {
  const r = await ok(owner.post('/api/recipes', { name: 'Paella', lines: [
    { item_id: saffron.id, qty: 1, unit: 'g' }, { item_id: milk.id, qty: 2, unit: 'cup' }, { item_id: bun.id, qty: 1, unit: 'each' },
  ] }))
  const got = await ok(owner.get(`/api/recipes/${r.id}?venue_id=${V1}`))
  assert.equal(got.coverage, 'partial')
  assert.deepEqual(got.gaps.map(g => g.reason), ['no_price', 'no_unit'])
  assert.equal(got.gaps[1].text, 'Milk has no size for a cup')
  close(got.cost, 0.3)
  const list = await ok(owner.get(`/api/recipes?venue_id=${V1}`))
  assert.equal(list.recipes.find(x => x.id === r.id).coverage, 'partial')
  assert.ok(list.counts.partial >= 1)
})

test('last paid and average paid follow what was received at the venue', async () => {
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
  const [q] = (await ok(owner.get('/api/inventory/items/' + cheddar.id))).quotes
  // A delivery at Kingsway without an order: one case at the list price, the invoice said £120.
  const po = await ok(owner.post(`/api/purchasing/venues/${V1}/deliveries`, {
    supplier_id: sup.id, lines: [{ item_id: cheddar.id, quote_id: q.id, received_qty: 1 }],
    check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
  await sql`UPDATE purchase_order_lines SET invoice_price = 120 WHERE po_id = ${po.id ?? po.po?.id}`
  const last = await ok(owner.get(`/api/recipes/${sauce.id}?venue_id=${V1}&basis=last`))
  // Cheddar at £10 a kg now; milk never received there.
  assert.equal(last.basis, 'last')
  close(last.lines[1].cost, 4)
  assert.equal(last.lines[0].problem, 'no_receipts')
  assert.equal(last.coverage, 'partial')
  assert.equal((await ok(owner.get(`/api/recipes/${sauce.id}?venue_id=${V2}&basis=average`))).coverage, 'none', 'Leeds received nothing')
})

test('costs are kept from people without Costing view; supplier prices only for those who see them', async () => {
  // A cook edits recipes and sees no money.
  const c = await ok(cook.get(`/api/recipes/${burger.id}?venue_id=${V1}`))
  assert.equal(c.costs_shown, false)
  assert.equal(c.cost, undefined)
  assert.equal(c.explanation, undefined)
  assert.ok(c.lines.every(l => l.cost === undefined && l.per_base === undefined))
  assert.equal(c.coverage, 'full', 'what is costed is no money')
  assert.doesNotMatch(JSON.stringify(c), /8\.5|102/)
  const cl = await ok(cook.get(`/api/recipes?venue_id=${V1}`))
  assert.ok(cl.recipes.every(r => r.cost === undefined && r.per_unit === undefined))
  assert.equal(cl.can.costs, false)
  const made = await ok(cook.post('/api/recipes', { name: 'Cook\'s toast', lines: [{ item_id: bun.id, qty: 1, unit: 'each' }] }))
  assert.equal(made.cost, undefined)
  // The pickers carry names and units, no prices.
  const pickers = await ok(cook.get('/api/recipes/pickers'))
  assert.ok(pickers.items.some(i => i.name === 'Cheddar' && i.unit_choices.includes('slice')))
  assert.doesNotMatch(JSON.stringify(pickers), /price/)
  // A buyer sees costs and the supplier prices, and can't change recipes.
  const b = await ok(buyer.get(`/api/recipes/${burger.id}?venue_id=${V1}`))
  assert.ok(b.cost > 0)
  assert.match(b.explanation.text, /Brakes/)
  assert.equal((await buyer.post('/api/recipes', { name: 'No' })).status, 403)
  // An operator reads recipes without costs by default; a viewer has no recipes at all.
  const op = await ok(operator.get(`/api/recipes/${burger.id}`))
  assert.equal(op.cost, undefined)
  assert.equal((await operator.put('/api/recipes/' + burger.id, saveBody(op))).status, 403)
  assert.equal((await viewer.get('/api/recipes')).status, 403)
})

test('copies and variations; switched off; delete refused while used inside another recipe', async () => {
  const copy = await ok(owner.post(`/api/recipes/${burger.id}/copy`, {}))
  assert.equal(copy.name, 'Cheeseburger (copy)')
  assert.equal(copy.status, 'draft')
  assert.equal(copy.lines.length, 3)
  const takeaway = await ok(owner.post(`/api/recipes/${burger.id}/copy`, { name: 'Cheeseburger to take away', variant: true }))
  assert.equal(takeaway.variant_of, burger.id)
  assert.deepEqual((await ok(owner.get('/api/recipes/' + burger.id))).variations.map(v => v.name), ['Cheeseburger to take away'])
  // A variation of a variation goes on the group's own recipe.
  const again = await ok(owner.post(`/api/recipes/${takeaway.id}/copy`, { variant: true }))
  assert.equal(again.variant_of, burger.id)
  const bad = await owner.put('/api/recipes/' + copy.id, saveBody(copy, { variant_of: takeaway.id }))
  assert.equal(bad.json.code, 'variant_of')
  // Switched off it leaves the list unless asked for.
  await ok(owner.patch(`/api/recipes/${copy.id}/active`, { is_active: false }))
  assert.ok(!(await ok(owner.get('/api/recipes'))).recipes.some(r => r.id === copy.id))
  assert.ok((await ok(owner.get('/api/recipes?active=off'))).recipes.some(r => r.id === copy.id))
  // The sauce is inside the burgers: not deleted.
  const del = await owner.delete('/api/recipes/' + sauce.id)
  assert.equal(del.status, 409)
  assert.equal(del.json.code, 'in_use')
  assert.deepEqual((await ok(owner.delete('/api/recipes/' + copy.id))), { deleted: true })
  assert.equal((await owner.get('/api/recipes/' + copy.id)).status, 404)
})

test('the report\'s recipe costs are the page\'s, and need Costing view', async () => {
  const rep = await ok(owner.post('/api/reports/preview', { spec: { subject: 'recipes.costs', kind: 'list', rows: ['name', 'venue.name', 'unit_cost', 'coverage', 'gaps'] } }))
  const row = (name, venue) => rep.rows.find(x => x.cells[0] === name && x.cells[1] === venue)?.cells
  for (const [venueId, venueName] of [[V1, 'Kingsway'], [V2, 'Leeds']]) {
    const page = await ok(owner.get(`/api/recipes/${burger.id}?venue_id=${venueId}`))
    close(row('Cheeseburger', venueName)[2], page.per_unit, venueName + ': the report and the page agree')
    assert.equal(row('Cheeseburger', venueName)[3], 'full')
  }
  assert.equal(row('Paella', 'Kingsway')[4], 2, 'its two gaps')
  // A cook (Recipes, no Costing) can report on recipes and their lines, not on their costs.
  const lines = await ok(cook.post('/api/reports/preview', { spec: { subject: 'recipes.lines', kind: 'list', rows: ['recipe.name', 'what', 'qty', 'unit'] } }))
  assert.ok(lines.rows.some(x => x.cells[0] === 'Cheeseburger' && x.cells[1] === 'Cheese sauce'))
  assert.equal((await cook.post('/api/reports/preview', { spec: { subject: 'recipes.costs', kind: 'list', rows: ['name'] } })).status, 403)
})

test('Pepper\'s recipe tools read through the page\'s routes: costs only with Costing view', async () => {
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
  const found = await call(A.owner, 'find_recipes', { words: 'cheese', venue: 'Leeds' })
  for (const n of ['Cheese sauce', 'Cheeseburger']) assert.ok(found.recipes.some(r => r.name === n), n)
  assert.ok(found.recipes.every(r => /cheese/i.test(r.name)))
  const b2 = await ok(owner.get(`/api/recipes/${burger.id}?venue_id=${V2}`))
  assert.equal(found.recipes.find(r => r.name === 'Cheeseburger').cost, '£' + Number(b2.per_unit).toFixed(2) + ' a portion')
  const one = await call(A.owner, 'recipe', { recipe: 'cheeseburger', venue: 'Kingsway' })
  assert.match(one.explanation, /Per portion/)
  assert.match(one.explanation, /Brakes/)
  assert.equal(one.costed, 'Fully costed')
  assert.deepEqual(one.lines.map(l => l.what), ['Cheddar', 'Cheese sauce', 'Brioche bun'])
  // A cook reads the recipe, not its money; the gaps still say what to fix.
  const cooks = await call(COOK, 'recipe', { recipe: 'Paella' })
  assert.equal(cooks.explanation, undefined)
  assert.equal(cooks.cost, undefined)
  assert.match(cooks.note, /Costing view/)
  assert.ok(cooks.gaps.some(g => /Milk has no size for a cup/.test(g)))
  assert.doesNotMatch(JSON.stringify(await call(COOK, 'find_recipes', {})), /£/)
  await assert.rejects(call(A.viewer, 'find_recipes', {}), /recipes/i)
})

test('migration 299 gives custom roles their levels, and 301 puts Recipes after Purchasing in saved menus, once', async () => {
  const fs = await import('node:fs')
  const read = f => fs.readFileSync(new URL('../../migrations/' + f, import.meta.url), 'utf8')
  // Custom roles from before the modules: recipes View; costing View only where they see supplier prices.
  const seer = await ok(owner.post('/api/access/roles', { key: 'old-buyer', label: 'Old buyer', permissions: { purchasing_setup: 'view' } }))
  const host = await ok(owner.post('/api/access/roles', { key: 'old-host', label: 'Old host', permissions: { bookings: 'manage' } }))
  await sql`UPDATE tenant_roles SET permissions = permissions - 'recipes' - 'costing' WHERE id = ANY(${[seer.id, host.id]}::uuid[])`
  await sql.unsafe(read('299_recipes_modules.sql'))
  const perms = Object.fromEntries((await sql`SELECT key, permissions FROM tenant_roles WHERE id = ANY(${[seer.id, host.id]}::uuid[])`).map(r => [r.key, r.permissions]))
  assert.deepEqual([perms['old-buyer'].recipes, perms['old-buyer'].costing], ['view', 'view'])
  assert.deepEqual([perms['old-host'].recipes, perms['old-host'].costing], ['view', 'none'])
  // The menu: taken out, put back straight after Purchasing, and a second run adds nothing.
  await sql`DELETE FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/recipes'`
  await sql.unsafe(read('301_recipes_menu.sql'))
  await sql.unsafe(read('301_recipes_menu.sql'))
  const rows = await sql`SELECT route, parent_id, sort_order, module FROM nav_items WHERE tenant_id = ${ids.a} AND route IN ('/purchasing', '/recipes')`
  const purchasing = rows.find(r => r.route === '/purchasing'), recipes = rows.filter(r => r.route === '/recipes')
  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].parent_id, purchasing.parent_id)
  assert.equal(recipes[0].sort_order, purchasing.sort_order + 1)
  assert.equal(recipes[0].module, 'recipes')
  const [clash] = await sql`
    SELECT count(*)::int AS n FROM nav_items WHERE tenant_id = ${ids.a} AND parent_id IS NOT DISTINCT FROM ${purchasing.parent_id}
     GROUP BY sort_order HAVING count(*) > 1 LIMIT 1`
  assert.equal(clash, undefined, 'no two links share a place')
})

test('another group\'s items, recipes and venues are refused', async () => {
  const theirItem = await owner.post('/api/recipes', { name: 'Steal', lines: [{ item_id: bItem.id, qty: 1, unit: 'g' }] })
  assert.equal(theirItem.status, 404)
  const theirRecipe = await owner.post('/api/recipes', { name: 'Steal', lines: [{ sub_recipe_id: bRecipe.id, qty: 1, unit: 'l' }] })
  assert.equal(theirRecipe.status, 404)
  assert.equal((await owner.post('/api/recipes', { name: 'Steal', variant_of: bRecipe.id })).status, 404)
  assert.equal((await owner.get('/api/recipes/' + bRecipe.id)).status, 404)
  assert.equal((await owner.put('/api/recipes/' + bRecipe.id, saveBody({ ...bRecipe, lines: [] }))).status, 404)
  assert.equal((await owner.post(`/api/recipes/${bRecipe.id}/copy`, {})).status, 404)
  assert.equal((await owner.patch(`/api/recipes/${bRecipe.id}/active`, { is_active: false })).status, 404)
  assert.equal((await owner.delete('/api/recipes/' + bRecipe.id)).status, 404)
  const [bv] = await sql`INSERT INTO venues (tenant_id, name, slug, timezone) VALUES (${ids.b}, 'Theirs', 'theirs-rc', 'Europe/London') RETURNING id`
  assert.equal((await owner.get(`/api/recipes/${burger.id}?venue_id=${bv.id}`)).status, 404)
  assert.equal((await owner.get(`/api/recipes?venue_id=${bv.id}`)).status, 404)
  // B sees none of A's recipes, and A's are untouched.
  assert.ok(!(await ok(bOwner.get('/api/recipes'))).recipes.some(r => r.name === 'Cheeseburger'))
  assert.equal((await ok(bOwner.get('/api/recipes/pickers'))).items.some(i => i.name === 'Cheddar'), false)
  const [still] = await sql`SELECT count(*)::int AS n FROM recipes WHERE tenant_id = ${ids.b}`
  assert.equal(still.n, 1)
})
