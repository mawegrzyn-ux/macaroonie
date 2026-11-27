// Usage from sales (inventory phase 5, migration 311, 27 Nov 2026): the job
// (services/stockUsageSvc.js) works out each venue's trading day from the
// till and kiosks (options and meal deal picks from the check's record, a
// void marked wasted left out: it is waste already; test till sales left
// out), online orders (options by their words, the order type from Ordering
// setup's fulfilment) and another till's receipts through the item mapping
// (a mapped meal deal by its typical picks); the matrix choosing the
// takeaway recipe for a takeaway check and a venue's own version there; on
// hand taking sales off (one ledger move per item per day, the channel
// split); late sales worked out again, a day nothing changed left alone, a
// recipe saved marking the days; the closed-day hook asked; the usage route
// and its uncosted dishes; Recompute (Manage, at most 31 days, never
// another group's venue); two processes claiming one run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { menuSaveBody } = await import('../src/routes/menus.js')
const usage = await import('../src/services/stockUsageSvc.js')

let ids, owner, operator, viewer, bOwner, soho, leeds, bVenue, eatIn, takeOut
let beef, bun, cheddar, potato, burgerR, toGoR, leedsR, chipsR, cheese, menu, burger, chips, soup, deal, mainStep, sideStep
let today, conn
const dishIn = (m, name) => m.sections.flatMap(s => s.items).find(i => i.name === name)
const near = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 1e-3, (msg || '') + ': ' + a + ' is not ' + b)

async function makeMenu(who, name, sections) {
  const m = await ok(who.post('/api/menus', { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 6) }))
  const full = await ok(who.get('/api/menus/' + m.id))
  await ok(who.patch('/api/menus/' + m.id, { ...full, sections }), 'menu ' + name)
  return ok(who.get('/api/menus/' + m.id))
}

/** A closed till check today at a venue: lines [{ item_id, name, qty, modifiers, combo, status, waste }]. */
async function tillCheck(venueId, lines, { orderType = null, generated = false, day = today } = {}) {
  const [d] = await sql`
    INSERT INTO pos_days (tenant_id, venue_id, business_date, opened_at, closed_at, is_generated)
    VALUES (${ids.a}, ${venueId}, ${day}::date, now() - interval '3 hours', now(), ${generated}) RETURNING id`
  const id = 'c-' + randomUUID()
  const withIds = lines.map(l => ({ ...l, id: 'l-' + randomUUID() }))
  const state = { id, lines: withIds.map(l => ({ id: l.id, item_id: l.item_id, name: l.name, qty: l.qty, modifiers: l.modifiers || [], combo: l.combo || null })) }
  await sql`
    INSERT INTO pos_checks (id, tenant_id, venue_id, day_id, mode, status, opened_at, closed_at, subtotal, total, state, last_seq, is_generated, order_type_id)
    VALUES (${id}, ${ids.a}, ${venueId}, ${d.id}, 'counter', 'closed', now() - interval '1 hour', now(), 0, 0, ${sql.json(state)}, 1, ${generated}, ${orderType})`
  for (const l of withIds) {
    await sql`
      INSERT INTO pos_check_lines (id, tenant_id, venue_id, check_id, day_id, item_id, name, qty, gross, net, vat, status, void_waste, voided_at, void_day_id, void_reason)
      VALUES (${l.id}, ${ids.a}, ${venueId}, ${id}, ${d.id}, ${l.item_id}, ${l.name}, ${l.qty}, 1200, 1200, 200, ${l.status || 'sent'},
              ${l.status === 'voided' ? (l.waste ?? true) : null}, ${l.status === 'voided' ? new Date() : null}, ${l.status === 'voided' ? d.id : null},
              ${l.status === 'voided' ? 'Dropped' : null})`
  }
  return id
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-use', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-use', timezone: 'Europe/London', currency: 'GBP' }))).id
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-use', timezone: 'Europe/London' }))).id
  const tax = await ok(owner.get('/api/tax-rates'))
  eatIn = tax.order_types.find(t => t.name === 'Eat in').id
  takeOut = tax.order_types.find(t => t.name === 'Take out').id
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
  const sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  const item = async (name, base_unit, pack, price, extra = {}) => {
    const i = await ok(owner.post('/api/inventory/items', { name, base_unit, ...extra }))
    const q = (await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: sup.id, pack_name: 'Pack', pack_count: 1, ...pack, price }))).quotes[0]
    return { ...i, quote: q }
  }
  // Beef patties £1.50 each, buns £0.30, cheddar £8 a kg (a slice is 20 g), potatoes £1 a kg at 75%.
  beef = await item('Beef patty', 'each', { pack_qty: 10, pack_unit: 'each' }, 15)
  bun = await item('Brioche bun', 'each', { pack_qty: 24, pack_unit: 'each' }, 7.2)
  cheddar = await item('Cheddar', 'g', { pack_qty: 1, pack_unit: 'kg' }, 8)
  await ok(owner.post(`/api/inventory/items/${cheddar.id}/units`, { name: 'slice', base_qty: 20 }))
  potato = await item('Potatoes', 'g', { pack_qty: 1, pack_unit: 'kg' }, 1, { yield_pct: 75 })
  await ok(owner.post(`/api/purchasing/venues/${soho}/deliveries`, {
    supplier_id: sup.id, lines: [{ item_id: beef.id, quote_id: beef.quote.id, received_qty: 10 }, { item_id: bun.id, quote_id: bun.quote.id, received_qty: 5 }],
    check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
  burgerR = await ok(owner.post('/api/recipes', { name: 'Burger', kind: 'dish', status: 'live', lines: [{ item_id: beef.id, qty: 1, unit: 'each' }, { item_id: bun.id, qty: 1, unit: 'each' }] }))
  toGoR = await ok(owner.post('/api/recipes', { name: 'Burger to go', kind: 'dish', status: 'live', variant_of: burgerR.id, lines: [{ item_id: beef.id, qty: 1, unit: 'each' }, { item_id: bun.id, qty: 2, unit: 'each' }] }))
  leedsR = await ok(owner.post('/api/recipes', { name: 'Leeds burger', kind: 'dish', status: 'live', variant_of: burgerR.id, lines: [{ item_id: beef.id, qty: 2, unit: 'each' }, { item_id: bun.id, qty: 1, unit: 'each' }] }))
  chipsR = await ok(owner.post('/api/recipes', { name: 'Chips', kind: 'dish', status: 'live', lines: [{ item_id: potato.id, qty: 150, unit: 'g' }] }))
  const extras = await ok(owner.post('/api/menus/variant-groups', { name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 3, variation_type: 'addition', options: [{ label: 'Cheese', price_pence: 80 }] }))
  cheese = extras.options[0]
  menu = await makeMenu(owner, 'Lunch', [{ title: 'Mains', items: [
    { name: 'Burger', price_pence: 1200, is_orderable: true, variant_groups: [{ group_id: extras.id, overrides: [] }], variants: [] },
    { name: 'Chips', price_pence: 300, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Soup', price_pence: 600, is_orderable: true, variant_groups: [], variants: [] },
  ] }])
  burger = dishIn(menu, 'Burger').id
  chips = dishIn(menu, 'Chips').id
  soup = dishIn(menu, 'Soup').id
  mainStep = randomUUID()
  sideStep = randomUUID()
  const body = menuSaveBody(menu)
  body.sections.push({ title: 'Deals', items: [{
    name: 'Burger meal', kind: 'combo', price_pence: 1500, is_orderable: true, variant_groups: [], variants: [],
    combo: { mode: 'manual', steps: [
      { id: mainStep, name: 'Main', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: burger }] },
      { id: sideStep, name: 'Side', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: chips }] },
    ] },
  }] })
  await ok(owner.patch('/api/menus/' + menu.id, body), 'meal deal')
  menu = await ok(owner.get('/api/menus/' + menu.id))
  deal = dishIn(menu, 'Burger meal').id
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  // The matrix: the burger everywhere, its takeaway version for take out, Leeds' own at Leeds.
  await ok(owner.put(`/api/recipe-links/dishes/${burger}/cell`, { recipe_id: burgerR.id }))
  await ok(owner.put(`/api/recipe-links/dishes/${burger}/cell`, { recipe_id: toGoR.id, order_type_id: takeOut }))
  await ok(owner.put(`/api/recipe-links/dishes/${burger}/cell`, { recipe_id: leedsR.id, venue_id: leeds }))
  await ok(owner.put(`/api/recipe-links/dishes/${chips}/cell`, { recipe_id: chipsR.id }))
  await ok(owner.put('/api/recipe-options/rules', {
    option_id: cheese.id, dish_id: null, option_label: null, action: 'add', item_id: cheddar.id, sub_recipe_id: null, swap_item_id: null,
    qty: 1, unit: 'slice', factor: null, recipe_id: null, note: null,
  }))
  // A count three days ago at Soho: 100 patties, 100 buns, 5 kg of cheddar, 10 kg of potatoes.
  await ok(owner.post(`/api/stock/venues/${soho}/counts`, {
    lines: [{ item_id: beef.id, qty: 100, unit: 'each' }, { item_id: bun.id, qty: 100, unit: 'each' }, { item_id: cheddar.id, qty: 5, unit: 'kg' }, { item_id: potato.id, qty: 10, unit: 'kg' }],
    counted_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  }))
  ;({ today } = await usage.venueToday(sql, ids.a, soho))
  // Online orders at Soho collect as take out (Ordering setup's type for collection).
  await sql`INSERT INTO ordering_settings (venue_id, tenant_id, order_type_ids) VALUES (${soho}, ${ids.a}, ${sql.json({ collection: takeOut })})`
  const [c] = await sql`INSERT INTO pos_connections (tenant_id, name, access_token, token_hint) VALUES (${ids.a}, 'Loyverse', 'sealed-stand-in', 'abcd') RETURNING id`
  conn = c.id
})
test.after(async () => { await closeApp() })

const qty = (rows, itemId) => rows.find(r => r.item_id === itemId)?.qty_base ?? 0

/** A Pepper tool as the staff chat runs it, as `sub`: its card (describe) and, with run, its answer. */
async function pepper(sub, name, input, { run = true } = {}) {
  const { getApp } = await import('./support/app.mjs')
  const { makeContext } = await import('../src/ai/context.js')
  const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
  const app = await getApp()
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return this } }
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  const parsed = parseInput(tool, input)
  const card = tool.describe ? await tool.describe(ctx, parsed) : null
  return { tool, card, out: run ? await tool.run(ctx, parsed) : null }
}

test('the day\'s sales from every channel, broken in by the matrix, options and picks', async () => {
  // Soho, eat in: two burgers with cheese, a meal deal (burger and chips), a burger voided and wasted, a soup with no recipe.
  await tillCheck(soho, [
    { item_id: burger, name: 'Burger', qty: 2, modifiers: [{ group_id: 'g', option_id: cheese.id, prefix: null, depth: 0 }] },
    { item_id: deal, name: 'Burger meal', qty: 1, combo: [{ step_id: mainStep, item_id: burger, modifiers: [] }, { step_id: sideStep, item_id: chips, modifiers: [] }] },
    { item_id: burger, name: 'Burger', qty: 1, status: 'voided', waste: true },
    { item_id: soup, name: 'Soup', qty: 1 },
  ], { orderType: eatIn })
  // Take out: the takeaway version (two buns).
  await tillCheck(soho, [{ item_id: burger, name: 'Burger', qty: 1 }], { orderType: takeOut })
  // A test till sale (Test data page) is left out.
  await tillCheck(soho, [{ item_id: burger, name: 'Burger', qty: 5 }], { orderType: eatIn, generated: true })
  // Online, collected (no order type on the order: Ordering setup's for collection, take out), with cheese by its words.
  const [o] = await sql`
    INSERT INTO orders (tenant_id, venue_id, service_date, order_number, status, fulfilment, promised_at, guest_name, subtotal_pence, total_pence, payment_method, placed_at)
    VALUES (${ids.a}, ${soho}, ${today}::date, 1, 'completed', 'collection', now(), 'Guest', 1280, 1280, 'demo', now()) RETURNING id`
  await sql`
    INSERT INTO order_items (order_id, tenant_id, menu_item_id, name, options, qty, unit_price_pence, line_total_pence, vat_rate)
    VALUES (${o.id}, ${ids.a}, ${burger}, 'Burger', ${sql.json([{ group: 'Extras', label: 'Cheese', price_pence: 80, mode: 'extra' }])}, 1, 1280, 1280, 20)`
  // Leeds: a burger on the till (Leeds' own: two patties), and another till's receipt mapped by the item mapping.
  await tillCheck(leeds, [{ item_id: burger, name: 'Burger', qty: 1 }], { orderType: eatIn })
  const [e] = await sql`
    INSERT INTO ext_checks (tenant_id, connection_id, venue_id, external_id, kind, business_date, closed_at)
    VALUES (${ids.a}, ${conn}, ${leeds}, ${'r-' + randomUUID()}, 'sale', ${today}::date, now()) RETURNING id`
  const line = async (no, name, net, parts) => {
    const [l] = await sql`
      INSERT INTO ext_check_lines (tenant_id, check_id, line_no, line_kind, name, qty, net_pence, gross_pence, tax_pence, map_state)
      VALUES (${ids.a}, ${e.id}, ${no}, 'item', ${name}, 1, ${net}, ${net}, ${Math.round(net / 6)}, 'mapped') RETURNING id`
    for (const [i, p] of parts.entries()) {
      await sql`INSERT INTO ext_line_parts (tenant_id, check_id, line_id, part_no, role, item_id, option_id, combo_id, qty, net_pence)
                VALUES (${ids.a}, ${e.id}, ${l.id}, ${i}, ${p.role}, ${p.item_id ?? null}, ${p.option_id ?? null}, ${p.combo_id ?? null}, 1, ${p.net})`
    }
  }
  await line(0, 'LV Burger + cheese', 1280, [{ role: 'main', item_id: burger, net: 1200 }, { role: 'option', option_id: cheese.id, net: 80 }])
  await line(1, 'LV Meal', 1500, [{ role: 'main', combo_id: deal, net: 1500 }])

  const r = await usage.sweepStockUsage(null, { again: 0 })
  assert.equal(r.failed, 0)
  assert.ok(r.ran.includes(soho) && r.ran.includes(leeds), 'both venues worked out')
  const days = await sql`SELECT venue_id, item_id, qty_base::float8 AS qty_base, channels, cost_per_base::float8 AS cost_per_base, cost_how FROM stock_usage_days WHERE tenant_id = ${ids.a} AND day = ${today}::date`
  const at = v => days.filter(d => d.venue_id === v)
  // Soho: patties 2 + 1 (deal) + 1 (to go) + 1 (online, to go) = 5; buns 2 + 1 + 2 + 2 = 7; cheddar 3 slices; chips 150 g at 75%.
  assert.equal(qty(at(soho), beef.id), 5, 'the void (wasted already) and the test sale are left out')
  assert.equal(qty(at(soho), bun.id), 7, 'take out and the collected order use the takeaway version')
  assert.equal(qty(at(soho), cheddar.id), 60)
  assert.equal(qty(at(soho), potato.id), 200)
  assert.deepEqual(at(soho).find(d => d.item_id === beef.id).channels, { till: 4, online: 1 })
  near(at(soho).find(d => d.item_id === beef.id).cost_per_base, 1.5, 'patties at the average paid')
  assert.equal(at(soho).find(d => d.item_id === beef.id).cost_how, 'average')
  assert.equal(at(soho).find(d => d.item_id === cheddar.id).cost_how, 'standard', 'nothing paid here: the standard price')
  // Leeds: its own burger (two patties) on the till and from the other till, and the mapped meal deal's typical picks.
  assert.equal(qty(at(leeds), beef.id), 6)
  assert.equal(qty(at(leeds), bun.id), 3)
  assert.equal(qty(at(leeds), cheddar.id), 20, 'the mapped option')
  assert.equal(qty(at(leeds), potato.id), 200, 'the deal\'s chips')
  assert.deepEqual(at(leeds).find(d => d.item_id === beef.id).channels, { till: 2, imported: 4 })
  // The dishes sold: units, net, theoretical cost; the soup uncosted with why.
  const dishes = await sql`SELECT * FROM dish_cost_days WHERE tenant_id = ${ids.a} AND day = ${today}::date AND venue_id = ${soho}`
  const soupRow = dishes.find(d => d.dish_id === soup)
  assert.equal(Number(soupRow.uncosted_qty), 1)
  assert.equal(soupRow.gaps[0].reason, 'no_recipe')
  const eat = dishes.find(d => d.dish_id === burger && d.order_type_id === eatIn && d.channel === 'till')
  assert.equal(Number(eat.qty), 2)
  assert.equal(Number(eat.net_pence), 1000, 'net of VAT')
  near(Number(eat.cost), 2 * (1.5 + 0.3 + 0.16), 'two burgers with cheese')
  assert.equal(eat.recipe_name, 'Burger')
  const leedsDeal = await sql`SELECT * FROM dish_cost_days WHERE tenant_id = ${ids.a} AND venue_id = ${leeds} AND dish_id = ${deal}`
  assert.equal(Number(leedsDeal[0].typical_qty), 1, 'the mapped deal at its typical picks')
  assert.ok(!dishes.some(d => Number(d.qty) === 5), 'no row for the test sale')
})

test('on hand takes sales off, one ledger move per item per day with the channel split; the usage route', async () => {
  const oh = await ok(owner.get('/api/stock/venues/' + soho))
  const b = oh.items.find(i => i.item_id === beef.id)
  // 100 counted (three days ago), 100 delivered since, 5 sold, 1 voided and wasted.
  assert.deepEqual([b.on_hand, b.received_since, b.used_since, b.wasted_since], [194, 100, -5, -1])
  assert.ok(oh.sales_up_to, 'up to the last run')
  assert.match(oh.note, /taken off up to the last run at/)
  const ledger = await ok(owner.get(`/api/stock/venues/${soho}/items/${beef.id}/moves`))
  const sale = ledger.moves.find(m => m.kind === 'usage')
  assert.equal(sale.change, -5)
  assert.deepEqual(sale.channels, { till: 4, online: 1 })
  assert.match(sale.source.label, /^Sales on /)
  const u = await ok(owner.get(`/api/stock/venues/${soho}/usage?from=${today}&to=${today}`))
  assert.equal(u.items.find(i => i.item_id === beef.id).qty_base, 5)
  near(u.items.find(i => i.item_id === beef.id).value, 7.5, 'with Costing view')
  const soupRow = u.uncosted.find(d => d.dish_id === soup)
  assert.equal(soupRow.uncosted_qty, 1)
  assert.match(soupRow.gaps[0].fix, /Dishes tab/)
  assert.equal(u.can_recompute, true)
  // Stock view without Costing view: quantities, no values.
  const role = await ok(owner.post('/api/access/roles', { key: 'usestock', label: 'Stock reader', permissions: { stock: 'view', costing: 'none' } }))
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, 'use-reader@test.local', 'viewer', 'a-use-reader', ${role.id})`
  const reader = as('a-use-reader', ids.a)
  const ru = await ok(reader.get(`/api/stock/venues/${soho}/usage?from=${today}&to=${today}`))
  assert.equal(ru.items.find(i => i.item_id === beef.id).value, undefined)
  assert.equal(ru.can_recompute, false)
})

test('late sales are worked out again; a day nothing changed is left alone', async () => {
  const still = await usage.sweepStockUsage(null, { again: 0 })
  assert.equal(still.days, 0, 'no sales changed: nothing worked out again')
  // A burger rung up late (the hub synced it later).
  await tillCheck(soho, [{ item_id: burger, name: 'Burger', qty: 1 }], { orderType: eatIn })
  const again = await usage.sweepStockUsage(null, { again: 0 })
  assert.equal(again.days, 1, 'only today at Soho')
  const [row] = await sql`SELECT qty_base::float8 AS q FROM stock_usage_days WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND day = ${today}::date AND item_id = ${beef.id}`
  assert.equal(row.q, 6)
})

test('a recipe saved marks the open days; the run works them out with the new recipe', async () => {
  const full = await ok(owner.get('/api/recipes/' + chipsR.id))
  await ok(owner.put('/api/recipes/' + chipsR.id, {
    name: full.name, kind: full.kind, category: full.category, code: full.code, status: full.status, yield_qty: full.yield_qty, yield_unit: full.yield_unit,
    portions: full.portions, loss_pct: full.loss_pct, method: full.method, photo_url: full.photo_url, shelf_life_hours: full.shelf_life_hours,
    variant_of: full.variant_of, notes: full.notes, is_active: full.is_active,
    lines: [{ item_id: potato.id, sub_recipe_id: null, qty: 300, unit: 'g', yield_pct: null, note: null }],
  }))
  const marked = await sql`SELECT venue_id, dirty_from::text AS dirty_from FROM stock_usage_venues WHERE tenant_id = ${ids.a} AND dirty_from IS NOT NULL`
  assert.ok(marked.some(m => m.venue_id === soho) && marked.some(m => m.venue_id === leeds), 'every venue of the group')
  const r = await usage.sweepStockUsage(null)
  assert.ok(r.days >= 2, 'a marked venue is run at once, every open day')
  const [row] = await sql`SELECT qty_base::float8 AS q FROM stock_usage_days WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND day = ${today}::date AND item_id = ${potato.id}`
  assert.equal(row.q, 400, '300 g at 75%')
  const left = await sql`SELECT count(*)::int AS n FROM stock_usage_venues WHERE tenant_id = ${ids.a} AND dirty_from IS NOT NULL`
  assert.equal(left[0].n, 0, 'the mark is cleared by the run that saw it')
})

test('a closed day is never worked out again: the hook is asked for every day', async () => {
  const asked = []
  const keep = usage.usageHooks.isDayClosed
  usage.usageHooks.isDayClosed = (venueId, day) => { asked.push([venueId, day]); return day === today }
  try {
    await sql`UPDATE stock_usage_days SET qty_base = 999 WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND day = ${today}::date AND item_id = ${beef.id}`
    await ok(owner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today, to: today }))
    assert.ok(asked.some(([v, d]) => v === soho && d === today), 'asked for the venue and the day')
    const [row] = await sql`SELECT qty_base::float8 AS q FROM stock_usage_days WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND day = ${today}::date AND item_id = ${beef.id}`
    assert.equal(row.q, 999, 'a closed day keeps what it had')
  } finally {
    usage.usageHooks.isDayClosed = keep
  }
  const back = await ok(owner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today, to: today }))
  assert.equal(back.days, 1)
  const [row] = await sql`SELECT qty_base::float8 AS q FROM stock_usage_days WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND day = ${today}::date AND item_id = ${beef.id}`
  assert.equal(row.q, 6, 'open again: worked out from the sales')
})

test('Recompute: Manage, up to 31 days, none after today, never another group\'s venue', async () => {
  assert.equal((await operator.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today, to: today })).status, 403, 'Use is not enough')
  assert.equal((await viewer.get(`/api/stock/venues/${soho}/usage`)).status, 200)
  const far = new Date(Date.parse(today) - 40 * 86400000).toISOString().slice(0, 10)
  assert.equal((await owner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: far, to: today })).status, 422)
  const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10)
  assert.equal((await owner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today, to: tomorrow })).status, 422)
  assert.equal((await owner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today })).status, 400, 'both days')
  // Another group's venue, either way round.
  assert.equal((await bOwner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today, to: today })).status, 404)
  assert.equal((await bOwner.get(`/api/stock/venues/${soho}/usage`)).status, 404)
  assert.equal((await owner.post(`/api/stock/venues/${bVenue}/usage/recompute`, { from: today, to: today })).status, 404)
  // While the job holds the venue, a Recompute waits.
  await sql`UPDATE stock_usage_venues SET running_until = now() + interval '5 minutes' WHERE venue_id = ${soho}`
  assert.equal((await owner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today, to: today })).status, 409)
  await sql`UPDATE stock_usage_venues SET running_until = NULL WHERE venue_id = ${soho}`
})

test('two processes sweeping at once claim each venue once', async () => {
  await sql`UPDATE stock_usage_venues SET last_run_at = NULL, running_until = NULL WHERE tenant_id = ${ids.a}`
  // Each as the job runs it: a venue looked at in the last few minutes isn't claimed again, one held isn't either.
  const [a, b] = await Promise.all([usage.sweepStockUsage(null), usage.sweepStockUsage(null)])
  const both = [...a.ran, ...b.ran]
  assert.equal(new Set(both).size, both.length, 'no venue claimed twice')
  for (const v of [soho, leeds]) assert.ok(both.includes(v), 'every venue claimed by one of them')
  const left = await sql`SELECT count(*)::int AS n FROM stock_usage_venues WHERE tenant_id = ${ids.a} AND running_until IS NOT NULL`
  assert.equal(left[0].n, 0, 'every lease let go')
})

test('order up to par: the par less what is on hand and already on order; the venue\'s mode; the form shows the stock', async () => {
  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Burger bits', venue_ids: [soho], item_ids: [beef.id, bun.id] }))
  await ok(owner.put('/api/purchasing/lists/' + list.id + '/pars', { pars: [
    { item_id: beef.id, venue_id: soho, par_base: 300 }, { item_id: bun.id, venue_id: soho, par_base: 240 },
  ] }))
  // An order placed and not received yet: 3 boxes of 10 patties on order.
  const first = await ok(owner.post('/api/purchasing/orders', { venue_id: soho, list_id: list.id }))
  await ok(owner.put(`/api/purchasing/orders/${first.id}/lines`, { lines: [{ item_id: beef.id, qty: 3 }] }))
  await ok(owner.post(`/api/purchasing/orders/${first.id}/submit`, {}), 'placed')
  const draft = await ok(owner.post('/api/purchasing/orders', { venue_id: soho, list_id: list.id }))
  const form = await ok(owner.get('/api/purchasing/orders/' + draft.id))
  assert.equal(form.par_mode, 'up_to', 'counted at Soho: up to par')
  const b = form.items.find(i => i.item_id === beef.id)
  const oh = (await ok(owner.get('/api/stock/venues/' + soho))).items.find(i => i.item_id === beef.id).on_hand
  assert.deepEqual([b.stock.on_hand, b.stock.on_order], [oh, 30], 'on hand from the stock rule, on order from the placed order')
  assert.equal(b.stock.used_7d, 6, 'sales used 6 patties this week')
  assert.equal(b.par_packs, Math.ceil((300 - oh - 30) / 10), 'boxes of 10 up to par')
  // The venue orders the par as it is.
  await ok(owner.put(`/api/stock/venues/${soho}/settings`, { count_weekday: null, count_kind: 'full', key_list_id: null, par_mode: 'order' }))
  const asIs = await ok(owner.get('/api/purchasing/orders/' + draft.id))
  assert.equal(asIs.par_mode, 'order')
  assert.equal(asIs.items.find(i => i.item_id === beef.id).par_packs, 30)
  await ok(owner.put(`/api/stock/venues/${soho}/settings`, { count_weekday: null, count_kind: 'full', key_list_id: null, par_mode: null }))
  // Pepper fills to par the same way.
  const { card } = await pepper(A.owner, 'update_order', { venue_id: soho, list: 'Burger bits', fill_to_par: true }, { run: false })
  assert.match(JSON.stringify(card), /Beef patty/)
  assert.match(JSON.stringify(card), new RegExp('Beef patty: ' + Math.ceil((300 - oh - 30) / 10) + ' '), 'the card fills the patties up to par')
})

test('the Sold tab: what sold at a venue with its theoretical cost, by dish and section', async () => {
  const sold = await ok(owner.get(`/api/menu-margins/sold?venue_id=${soho}&from=${today}&to=${today}`))
  const b = sold.dishes.find(d => d.dish_id === burger)
  assert.equal(b.qty, 5, 'the burgers sold at Soho today on the till (eat in and take out) and online; the deal\'s is the deal\'s')
  assert.ok(b.cost_pence > 0 && b.gp_pence != null)
  const s = sold.dishes.find(d => d.dish_id === soup)
  assert.equal(s.uncosted_qty, 1)
  assert.equal(s.band, null, 'not coloured while a unit is uncosted')
  assert.equal(sold.total.net_pence, sold.sections.reduce((n, x) => n + x.net_pence, 0))
  assert.equal((await bOwner.get(`/api/menu-margins/sold?venue_id=${soho}`)).status, 404, 'another group\'s venue')
  assert.equal((await owner.get(`/api/menu-margins/sold?from=${today}&to=2027-12-31`)).status, 422, 'too many days')
})

test('Pepper: usage_summary for an item by channel and a dish with why; names, never ids', async () => {
  const item = await pepper(A.owner, 'usage_summary', { venue: 'Soho', item: 'Beef patty', days: 2 })
  assert.equal(item.tool.class, 'read')
  assert.equal(item.out.used, '6 each')
  assert.deepEqual(item.out.by_channel, { till: '5 each', 'online orders': '1 each' })
  const dish = await pepper(A.owner, 'usage_summary', { venue: 'Soho', dish: 'Soup', days: 2 })
  assert.equal(dish.out.not_costed, 1)
  assert.match(dish.out.why[0], /no recipe/)
  const all = await pepper(A.owner, 'usage_summary', { venue: 'Leeds' })
  assert.ok(all.out.used_most.length > 0)
  for (const o of [item.out, dish.out, all.out]) assert.doesNotMatch(JSON.stringify(o), /[0-9a-f]{8}-[0-9a-f]{4}-/, 'no ids')
  const st = await pepper(A.owner, 'stock_on_hand', { venue: 'Soho', items: ['Beef patty'] })
  assert.match(st.out.note, /Sales are taken off up to the last run/)
  assert.equal(st.out.items[0].sold_since, '-6 each')
})

test('the report subjects: usage by day and channel, dish sales with theoretical cost; the starters', async () => {
  const run = spec => ok(owner.post('/api/reports/preview', { spec }))
  const period = { params: [{ key: 'period', type: 'period', default: { relative: 'this_year' } }], filters: [{ field: 'date', op: 'in_period', param: 'period' }] }
  const u = await run({ kind: 'list', subject: 'stock.usage', rows: ['venue.name', 'item_name', 'used', 'till', 'online', 'imported', 'value'], ...period })
  const sohoBeef = u.rows.find(r => r.cells[0] === 'Soho' && r.cells[1] === 'Beef patty')
  assert.deepEqual(sohoBeef.cells.slice(2, 6), [6, 5, 1, 0])
  const d = await run({ subject: 'stock.dish_sales', rows: ['dish'], values: [{ measure: 'units_sold' }, { measure: 'theoretical_cost' }, { measure: 'uncosted' }], ...period })
  assert.ok(d.rows.some(r => r.cells[0] === 'Soup'))
  // The starters end yesterday (a report's last days): a soup sold yesterday, worked out by the job.
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
  await tillCheck(soho, [{ item_id: soup, name: 'Soup', qty: 2 }, { item_id: chips, name: 'Chips', qty: 1 }], { orderType: eatIn, day: yesterday })
  await usage.sweepStockUsage(null, { again: 0 })
  const week = await ok(owner.post('/api/reports/starter:stock_theoretical_food_cost_week/run', {}))
  assert.ok(week.rows.length >= 1, 'this week has sales')
  const unc = await ok(owner.post('/api/reports/starter:uncosted_dishes_by_sales/run', {}))
  assert.ok(unc.rows.some(r => r.cells.includes('Soup')), 'the soup sold with no recipe')
})
