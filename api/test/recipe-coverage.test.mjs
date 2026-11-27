// Coverage by sales through the API (inventory phase 3): the share of the
// last 30 days' sales that can be costed, from till checks (closed, lines
// not voided, test till sales left out), kiosk checks, online orders and
// another till's mapped and unmapped lines, judged by salesCoverage() in
// shared/costing.js; the uncosted dishes by sales value with how to fix each;
// pounds only with till reports view (as the report subject gives them);
// our own open items (no dish) left out, never sent to the Item mapping;
// another group's sales and venue never; and the report subject Recipe
// coverage with its starter.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')

const COOK = 'a-cov-cook'
let ids, owner, cook, bOwner, soho, leeds, bVenue, menu, takeOut
let burger, salad, soup, fries, beef
const dishIn = (m, name) => m.sections.flatMap(s => s.items).find(i => i.name === name)

/** A trading day at a venue n days ago, closed: its id. */
async function day(tenantId, venueId, n, { generated = false } = {}) {
  const [d] = await sql`
    INSERT INTO pos_days (tenant_id, venue_id, business_date, opened_at, closed_at, is_generated)
    VALUES (${tenantId}, ${venueId}, current_date - ${n}::int, now() - make_interval(days => ${n}), now() - make_interval(days => ${n}) + interval '10 hours', ${generated})
    RETURNING id`
  return d.id
}
/** A closed check with lines [{ item_id, name, qty, net, status? }]. */
async function check(tenantId, venueId, dayId, lines, { generated = false, status = 'closed', server = null, orderType = null } = {}) {
  const id = 'c-' + randomUUID()
  const total = lines.reduce((s, l) => s + l.net, 0)
  await sql`
    INSERT INTO pos_checks (id, tenant_id, venue_id, day_id, mode, status, opened_at, closed_at, subtotal, total, state, last_seq, is_generated, server_id, order_type_id)
    VALUES (${id}, ${tenantId}, ${venueId}, ${dayId}, 'counter', ${status}, now(), now(), ${total}, ${total}, ${sql.json({ lines: [] })}, 1, ${generated}, ${server}, ${orderType})`
  for (const l of lines) {
    await sql`
      INSERT INTO pos_check_lines (id, tenant_id, venue_id, check_id, day_id, item_id, name, qty, gross, net, status)
      VALUES (${'l-' + randomUUID()}, ${tenantId}, ${venueId}, ${id}, ${dayId}, ${l.item_id}, ${l.name}, ${l.qty}, ${l.net}, ${l.net}, ${l.status || 'sent'})`
  }
  return id
}
/** An online order n days ago with items [{ menu_item_id, name, qty, total }]. */
async function order(tenantId, venueId, n, items, { status = 'completed', orderType = null } = {}) {
  const total = items.reduce((s, i) => s + i.total, 0)
  const [{ max }] = await sql`SELECT COALESCE(max(order_number), 0)::int AS max FROM orders WHERE venue_id = ${venueId}`
  const [o] = await sql`
    INSERT INTO orders (tenant_id, venue_id, service_date, order_number, status, promised_at, guest_name, subtotal_pence, total_pence, payment_method, order_type_id)
    VALUES (${tenantId}, ${venueId}, current_date - ${n}::int, ${max + 1}, ${status}, now(), 'Guest', ${total}, ${total}, 'demo', ${orderType})
    RETURNING id`
  for (const i of items) {
    await sql`
      INSERT INTO order_items (order_id, tenant_id, menu_item_id, name, qty, unit_price_pence, line_total_pence)
      VALUES (${o.id}, ${tenantId}, ${i.menu_item_id}, ${i.name}, ${i.qty}, ${Math.round(i.total / i.qty)}, ${i.total})`
  }
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  bOwner = as(B.owner, ids.b)
  // A cook reads recipes, with no costs and no till reports.
  const role = await ok(owner.post('/api/access/roles', { key: 'covcook', label: 'Cook', permissions: { recipes: 'view', costing: 'none', pos_reports: 'none' } }))
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, ${COOK + '@test.local'}, 'operator', ${COOK}, ${role.id})`
  cook = as(COOK, ids.a)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-cov', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-cov', timezone: 'Europe/London', currency: 'GBP' }))).id
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Theirs', slug: 'theirs-cov', timezone: 'Europe/London', currency: 'GBP' }))).id
  takeOut = (await ok(owner.get('/api/tax-rates'))).order_types.find(t => t.name === 'Take out').id
  const sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  beef = await ok(owner.post('/api/inventory/items', { name: 'Beef patty', base_unit: 'each' }))
  await ok(owner.post(`/api/inventory/items/${beef.id}/quotes`, { supplier_id: sup.id, pack_name: 'Box', pack_qty: 10, pack_unit: 'each', price: 15 }))
  const lettuce = await ok(owner.post('/api/inventory/items', { name: 'Lettuce', base_unit: 'g' }))
  const r = await ok(owner.post('/api/recipes', { name: 'Burger', kind: 'dish', status: 'live', lines: [{ item_id: beef.id, qty: 1, unit: 'each' }] }))
  // A salad whose lettuce has no supplier price: partly costed... in fact not costed at all.
  const rs = await ok(owner.post('/api/recipes', { name: 'Salad', kind: 'dish', status: 'live', lines: [{ item_id: lettuce.id, qty: 80, unit: 'g' }] }))
  const m = await ok(owner.post('/api/menus', { name: 'Lunch', slug: 'lunch-cov' }))
  const full = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.patch('/api/menus/' + m.id, { ...full, sections: [{ title: 'Mains', items: [
    { name: 'Burger', price_pence: 1000, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Salad', price_pence: 800, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Soup', price_pence: 600, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Fries', price_pence: 300, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Corkage', price_pence: 500, is_orderable: true, item_type: 'service', variant_groups: [], variants: [] },
  ] }] }))
  menu = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.post(`/api/menus/${m.id}/publish`, {}))
  burger = dishIn(menu, 'Burger').id
  salad = dishIn(menu, 'Salad').id
  soup = dishIn(menu, 'Soup').id
  fries = dishIn(menu, 'Fries').id
  await ok(owner.put(`/api/recipe-links/dishes/${burger}/cell`, { recipe_id: r.id }))
  await ok(owner.put(`/api/recipe-links/dishes/${salad}/cell`, { recipe_id: rs.id }))
  // Takeaway fries are costed by a draft Pepper read in (not checked yet).
  const [draft] = await sql`
    INSERT INTO recipes (tenant_id, name, kind, status, source, portions) VALUES (${ids.a}, 'Fries read in', 'dish', 'draft', 'reader', 1) RETURNING id`
  await sql`INSERT INTO recipe_lines (tenant_id, recipe_id, sort_order, item_id, qty, unit) VALUES (${ids.a}, ${draft.id}, 0, ${beef.id}, 1, 'each')`
  await ok(owner.put(`/api/recipe-links/dishes/${fries}/cell`, { recipe_id: draft.id, order_type_id: takeOut }))

  // Sales. Soho's till yesterday: burgers £60, a voided burger, salad £16, soup £30, corkage £5.
  const d1 = await day(ids.a, soho, 1)
  const corkage = dishIn(menu, 'Corkage').id
  await check(ids.a, soho, d1, [
    { item_id: burger, name: 'Burger', qty: 6, net: 6000 }, { item_id: burger, name: 'Burger', qty: 1, net: 1000, status: 'voided' },
    { item_id: salad, name: 'Salad', qty: 2, net: 1600 }, { item_id: soup, name: 'Soup', qty: 5, net: 3000 }, { item_id: corkage, name: 'Corkage', qty: 1, net: 500 },
  ])
  // An open check isn't a sale yet; a check 40 days ago is outside the window.
  await check(ids.a, soho, d1, [{ item_id: soup, name: 'Soup', qty: 9, net: 9000 }], { status: 'open' })
  await check(ids.a, soho, await day(ids.a, soho, 40), [{ item_id: soup, name: 'Soup', qty: 9, net: 9000 }])
  // Test till sales are left out (decision D10).
  await check(ids.a, soho, await day(ids.a, soho, 3, { generated: true }), [{ item_id: soup, name: 'Soup', qty: 50, net: 50000 }], { generated: true })
  // A kiosk at Leeds sold burgers.
  const [kiosk] = await sql`INSERT INTO pos_devices (tenant_id, venue_id, kind, name, short_code) VALUES (${ids.a}, ${leeds}, 'kiosk', 'Kiosk 1', 'K1') RETURNING id`
  await check(ids.a, leeds, await day(ids.a, leeds, 2), [{ item_id: burger, name: 'Burger', qty: 2, net: 2000 }], { server: kiosk.id })
  // Online at Soho: takeaway fries (the draft) £12; a cancelled order isn't counted.
  await order(ids.a, soho, 2, [{ menu_item_id: fries, name: 'Fries', qty: 4, total: 1200 }], { orderType: takeOut })
  await order(ids.a, soho, 2, [{ menu_item_id: burger, name: 'Burger', qty: 9, total: 9000 }], { status: 'cancelled' })
  // The other group's sales never show.
  await check(ids.b, bVenue, await day(ids.b, bVenue, 1), [{ item_id: randomUUID(), name: 'Their soup', qty: 3, net: 99900 }])
})
test.after(async () => { await closeApp() })

test('coverage: the share of the last 30 days\' sales that can be costed, by channel and venue, the uncosted by value', async () => {
  const c = await ok(owner.get('/api/recipes/coverage'))
  assert.equal(c.days, 30)
  assert.equal(c.sold, true)
  // Costed: burgers £60 (Soho till) + £20 (Leeds kiosk). Not: salad £16, soup £30, fries £12 (a draft). Left out: corkage £5.
  assert.equal(c.total_pence, 6000 + 1600 + 3000 + 500 + 2000 + 1200)
  assert.equal(c.costed_pence, 8000)
  assert.equal(c.left_out_pence, 500)
  assert.equal(c.uncosted_pence, 1600 + 3000 + 1200)
  assert.equal(c.percent, Math.round(8000 / 13800 * 1000) / 10)
  assert.deepEqual(Object.keys(c.channels).sort(), ['kiosk', 'online', 'till'])
  assert.equal(c.channels.kiosk.percent, 100)
  assert.equal(c.channels.online.percent, 0, 'the takeaway fries use a draft nobody checked')
  assert.deepEqual(c.venues.map(v => v.name), ['Leeds', 'Soho'])
  // Most sold first, each with how to fix it.
  assert.deepEqual(c.dishes.map(d => [d.name, d.sales_pence]), [['Soup', 3000], ['Salad', 1600], ['Fries', 1200]])
  const [soupRow, saladRow, friesRow] = c.dishes
  assert.equal(soupRow.fixes[0].kind, 'link')
  assert.equal(saladRow.fixes[0].kind, 'recipe')
  assert.match(saladRow.fixes[0].text, /Lettuce has no supplier price/)
  assert.ok(friesRow.fixes.some(f => f.kind === 'recipe' && /not checked yet/.test(f.text)))
  assert.deepEqual(friesRow.where, ['Take out at Soho'])
  assert.deepEqual(c.left_out.map(l => l.name), ['Corkage'])
  assert.ok(!JSON.stringify(c).includes('Their soup'), 'another group\'s sales never count')
  // At one venue.
  const leedsOnly = await ok(owner.get('/api/recipes/coverage?venue_id=' + leeds))
  assert.equal(leedsOnly.percent, 100)
  assert.equal(leedsOnly.dishes.length, 0)
  // A shorter window: yesterday's till only... and the kiosk two days ago is out.
  const one = await ok(owner.get('/api/recipes/coverage?days=1'))
  assert.equal(one.total_pence, 6000 + 1600 + 3000 + 500)
})

test('fixing a gap moves the share: linking the soup costs it', async () => {
  const r = await ok(owner.post('/api/recipes', { name: 'Soup', kind: 'dish', status: 'live', lines: [{ item_id: beef.id, qty: 1, unit: 'each' }] }))
  await ok(owner.put(`/api/recipe-links/dishes/${soup}/cell`, { recipe_id: r.id }))
  const c = await ok(owner.get('/api/recipes/coverage'))
  assert.equal(c.costed_pence, 8000 + 3000)
  assert.ok(!c.dishes.some(d => d.name === 'Soup'))
  const [{ id }] = await sql`SELECT id FROM recipe_links WHERE dish_id = ${soup}`
  await ok(owner.delete('/api/recipe-links/links/' + id))
})

test('pounds only with till reports view, as in the report; another group\'s venue is not found', async () => {
  const c = await ok(cook.get('/api/recipes/coverage'))
  assert.equal(c.can.money, false)
  assert.equal(c.total_pence, undefined)
  assert.ok(c.percent > 0)
  assert.ok(c.dishes.every(d => d.sales_pence === undefined && d.share_pct > 0), 'the share of sales instead')
  assert.doesNotMatch(JSON.stringify(c), /"(total_pence|costed_pence|sales_pence)":/)
  // Costing view sees costs, not the till's sales: no pounds, as the report subject Recipe coverage gives none.
  const person = async (key, permissions) => {
    const role = await ok(owner.post('/api/access/roles', { key, label: key, permissions: { recipes: 'view', ...permissions } }))
    await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, ${'a-' + key + '@test.local'}, 'operator', ${'a-' + key}, ${role.id})`
    return as('a-' + key, ids.a)
  }
  const coster = await person('covcost', { costing: 'view', pos_reports: 'none' })
  const costs = await ok(coster.get('/api/recipes/coverage'))
  assert.equal(costs.can.money, false)
  assert.doesNotMatch(JSON.stringify(costs), /"(total_pence|costed_pence|sales_pence)":/)
  const tillReader = await person('covtill', { costing: 'none', pos_reports: 'view' })
  const till = await ok(tillReader.get('/api/recipes/coverage'))
  assert.equal(till.can.money, true)
  assert.equal(till.total_pence, (await ok(owner.get('/api/recipes/coverage'))).total_pence)
  assert.equal((await owner.get('/api/recipes/coverage?venue_id=' + bVenue)).status, 404)
})

test('another till\'s sales: mapped lines as our dish, unmapped ones by name; ignored lines are no sale', async () => {
  const [conn] = await sql`
    INSERT INTO pos_connections (tenant_id, name, access_token, token_hint) VALUES (${ids.a}, 'Loyverse', 'sealed-stand-in', 'abcd') RETURNING id`
  const [e] = await sql`
    INSERT INTO ext_checks (tenant_id, connection_id, venue_id, external_id, kind, business_date, closed_at)
    VALUES (${ids.a}, ${conn.id}, ${leeds}, ${'r-' + randomUUID()}, 'sale', current_date - 1, now()) RETURNING id`
  const lines = [{ name: 'LV Burger', net: 1000, state: 'mapped', dish: burger }, { name: 'LV Latte', net: 300, state: 'unmapped' }, { name: 'Gift card', net: 2000, state: 'ignored' }]
  for (const [i, l] of lines.entries()) {
    const [row] = await sql`
      INSERT INTO ext_check_lines (tenant_id, check_id, line_no, line_kind, name, qty, net_pence, gross_pence, map_state)
      VALUES (${ids.a}, ${e.id}, ${i}, 'item', ${l.name}, 1, ${l.net}, ${l.net}, ${l.state}) RETURNING id`
    if (l.dish) await sql`INSERT INTO ext_line_parts (tenant_id, check_id, line_id, part_no, role, item_id, qty, net_pence) VALUES (${ids.a}, ${e.id}, ${row.id}, 0, 'main', ${l.dish}, 1, ${l.net})`
  }
  const c = await ok(owner.get('/api/recipes/coverage?venue_id=' + leeds))
  assert.equal(c.channels.imported.total_pence, 1300, 'the gift card (ignored) is no sale')
  assert.equal(c.channels.imported.costed_pence, 1000, 'the mapped burger is our burger')
  const latte = c.dishes.find(d => d.name === 'LV Latte')
  assert.equal(latte.mapping, 'unmapped')
  assert.equal(latte.fixes[0].kind, 'map')
})

test('our own open items and online lines with no dish are left out, never sent to the Item mapping', async () => {
  const before = await ok(owner.get('/api/recipes/coverage?venue_id=' + soho))
  // An open item rung up on Soho's till yesterday (addOpenItem(): item_id null), and an online line with no dish.
  await check(ids.a, soho, await day(ids.a, soho, 1), [{ item_id: null, name: 'Item not on menu', qty: 1, net: 450 }])
  await order(ids.a, soho, 1, [{ menu_item_id: null, name: 'Gift wrap', qty: 1, total: 150 }])
  const c = await ok(owner.get('/api/recipes/coverage?venue_id=' + soho))
  assert.equal(c.total_pence, before.total_pence + 600)
  assert.equal(c.left_out_pence, before.left_out_pence + 600, 'left out of both sides')
  assert.equal(c.percent, before.percent, 'the share doesn\'t move')
  assert.ok(!c.dishes.some(d => d.name === 'Item not on menu' || d.name === 'Gift wrap'), 'nothing to fix')
  assert.ok(!c.dishes.some(d => d.fixes.some(f => f.kind === 'map')), 'no Item mapping fix for our own till')
  const open = c.left_out.find(l => l.name === 'Item not on menu')
  assert.deepEqual([open.reason, open.sales_pence], ['open', 450])
  assert.match(open.why, /open item/)
  assert.equal(c.left_out.find(l => l.name === 'Gift wrap').reason, 'open')
})

test('the report subject Recipe coverage and the starter Uncosted dishes by sales', async () => {
  const rep = await ok(owner.post('/api/reports/preview', { spec: { subject: 'recipes.coverage', kind: 'list', rows: ['dish', 'venue.name', 'channel', 'sales', 'qty', 'costed', 'why'] }, period: { relative: 'last_n_days', n: 30 } }))
  const row = (dish, venue) => rep.rows.find(r => r.cells[0] === dish && r.cells[1] === venue)?.cells
  assert.ok(row('Burger', 'Soho'))
  assert.equal(row('Salad', 'Soho')[5], false)
  assert.match(String(row('Salad', 'Soho')[6]), /Lettuce has no supplier price/)
  assert.ok(!rep.rows.some(r => r.cells[0] === 'Soup' && Number(r.cells[4]) === 50), 'test till sales left out')
  assert.match(String(row('Item not on menu', 'Soho')[6]), /open item/, 'an open item is left out, with why')
  assert.equal(row('Item not on menu', 'Soho')[5], false)
  const starter = await ok(owner.post('/api/reports/starter:uncosted_dishes_by_sales/run', {}))
  assert.ok(starter.rows.length >= 2)
  assert.ok(starter.rows.every(r => !/Burger/.test(r.cells[0]) || /Fries/.test(r.cells[0])), 'costed dishes are not in it')
  // Without till reports view, no pounds in the report.
  const cookRep = await cook.post('/api/reports/preview', { spec: { subject: 'recipes.coverage', kind: 'list', rows: ['dish', 'sales'] } })
  assert.notEqual(cookRep.status, 200, 'the sales field needs till reports view')
})
