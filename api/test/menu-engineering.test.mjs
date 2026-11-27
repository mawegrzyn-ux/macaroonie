// Menu engineering, cost scenarios and Push prices through the API
// (inventory phase 7a, migration 314, 27 Nov 2026): a worked section's
// Kasavana and Smith classes from what sold (units not costed left out of
// GP, a meal deal one dish of its own section, a venue's sales only when one
// is named); a scenario's weighted cost % and GP at the real mix, its whole
// save, copy and delete; Push prices writing the menu's DRAFT with every
// other field surviving the whole-tree save, the price at its scope (the
// dish's one price on the menu, a dish's own sizes, extras left alone, VAT
// by order type), refused without Menus manage, never publishing; another
// group's menu, venue, order type, stream, scenario, section and dish
// refused; Costing view to look, Manage to save, till reports for sales;
// Pepper's menu_engineering and save_scenario (names, never ids); the report
// subjects Menu engineering and Cost scenarios and the starter. Review fixes:
// an automatic deal found among dishes rung up one by one counts as those
// dishes (through the usage job), a section with no costed unit has no
// average (never £0.00), save_scenario's replace keeping what wasn't named,
// and the report work beside a weekly subject over the period as asked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { menuSaveBody } = await import('../../shared/menuSave.js')
const { withSystem } = await import('../src/config/db.js')
const usage = await import('../src/services/stockUsageSvc.js')

const VIEWER = 'a-costview', MANAGER = 'a-costmgr'
let ids, owner, bOwner, costView, costManager
let soho, leeds, bar, eatIn, takeOut, standard, zero, bVenue, bType, bBar, bMenu, bDish
let menu, sohoMenu, burger, pizza, fries, coke, deal, extras, size, small, large, sohoBurger
let yesterday, twoDaysAgo, scenario, burgerR, cokeR, dinner, threeDaysAgo

async function makeMenu(who, name, sections, extra = {}) {
  const m = await ok(who.post('/api/menus', { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 6) }))
  const full = await ok(who.get('/api/menus/' + m.id))
  await ok(who.patch('/api/menus/' + m.id, { ...full, ...extra, sections }), 'menu ' + name)
  return ok(who.get('/api/menus/' + m.id))
}
const dishIn = (m, name) => m.sections.flatMap(s => s.items).find(i => i.name === name)
const sectionOf = (m, title) => m.sections.find(s => s.title === title)

/** A day of usage from sales, as the usage job writes it (dish_cost_days). */
async function sold(tenantId, venueId, day, dish, sectionId, qty, net, cost, extra = {}) {
  await sql`
    INSERT INTO dish_cost_days (tenant_id, venue_id, day, channel, dish_id, name, section_id, section, revenue_stream_id, order_type_id,
                                qty, sales_pence, net_pence, cost, uncosted_qty, typical_qty, left_out, item_type)
    VALUES (${tenantId}, ${venueId}, ${day}::date, 'till', ${dish.id}, ${dish.name}, ${sectionId}, ${extra.section || null},
            ${extra.stream ?? null}, ${extra.type ?? null}, ${qty}, ${Math.round(net * 1.2)}, ${net}, ${cost}, ${extra.uncosted ?? 0}, 0, null, 'food')`
}

async function asRole(sub, key, permissions) {
  const role = await ok(owner.post('/api/access/roles', { key, label: key, permissions }), 'role ' + key)
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, ${sub + '@test.local'}, 'operator', ${sub}, ${role.id})`
  return as(sub, ids.a)
}

const CHANGES = () => [
  { what: 'price', applies: 'all', section_id: null, dish_id: null, how: 'percent', value: 10, round_to: 10, round: 'up' },
  { what: 'cost', applies: 'dish', section_id: null, dish_id: burger.id, how: 'amount', value: 0.2, round_to: null, round: null },
  { what: 'price', applies: 'dish', section_id: null, dish_id: coke.id, how: 'set', value: 3, round_to: null, round: null },
]
const body = (extra = {}) => ({
  name: 'Ten percent', menu_id: menu.id, venue_id: soho, revenue_stream_id: null, order_type_id: eatIn, mix_days: 7, changes: CHANGES(), notes: null, ...extra,
})

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  bOwner = as(B.owner, ids.b)
  await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  // Costing view without till reports; Costing manage with Menus view only (no pushing).
  costView = await asRole(VIEWER, 'costview', { costing: 'view', pos_reports: 'none', menus: 'view' })
  costManager = await asRole(MANAGER, 'costmgr', { costing: 'manage', pos_reports: 'view', menus: 'view' })
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-me', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-me', timezone: 'Europe/London', currency: 'GBP' }))).id
  const tax = await ok(owner.get('/api/tax-rates'))
  eatIn = tax.order_types.find(t => t.name === 'Eat in').id
  takeOut = tax.order_types.find(t => t.name === 'Take out').id
  standard = tax.rates.find(r => r.name === 'Standard').id
  zero = tax.rates.find(r => r.name === 'Zero').id
  // Beef patty £1.50 each, a bun £0.30, potato £1 a kg, a can of coke £0.50.
  const sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  const item = async (name, base_unit, pack, price) => {
    const i = await ok(owner.post('/api/inventory/items', { name, base_unit }))
    await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: sup.id, pack_name: 'Pack', ...pack, price }))
    return i
  }
  const beef = await item('Beef patty', 'each', { pack_qty: 10, pack_unit: 'each' }, 15)
  const bun = await item('Bun', 'each', { pack_qty: 24, pack_unit: 'each' }, 7.2)
  const potato = await item('Potato', 'g', { pack_qty: 1, pack_unit: 'kg' }, 1)
  const can = await item('Coke can', 'each', { pack_qty: 24, pack_unit: 'each' }, 12)
  burgerR = await ok(owner.post('/api/recipes', { name: 'Burger', kind: 'dish', status: 'live', lines: [{ item_id: beef.id, qty: 1, unit: 'each' }, { item_id: bun.id, qty: 1, unit: 'each' }] }))
  const friesR = await ok(owner.post('/api/recipes', { name: 'Fries', kind: 'dish', status: 'live', lines: [{ item_id: potato.id, qty: 200, unit: 'g' }] }))
  cokeR = await ok(owner.post('/api/recipes', { name: 'Coke', kind: 'dish', status: 'live', lines: [{ item_id: can.id, qty: 1, unit: 'each' }] }))
  extras = await ok(owner.post('/api/menus/variant-groups', { name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 2, options: [{ label: 'Cheese', price_pence: 80 }] }))
  size = await ok(owner.post('/api/menus/variant-groups', { name: 'Size', price_mode: 'base', min_select: 1, max_select: 1, options: [{ label: 'Small', price_pence: 900 }, { label: 'Large', price_pence: 1200 }] }))
  small = size.options.find(o => o.label === 'Small')
  large = size.options.find(o => o.label === 'Large')
  // The group's lunch menu, standard VAT with take out zero rated; dishes carry fields a push must keep.
  menu = await makeMenu(owner, 'Lunch', [
    { title: 'Mains', subtitle: 'From the grill', items: [
      { name: 'Burger', price_pence: 1200, description: 'Beef in a bun', calories: 640, sku: 'BUR-1', is_featured: true, is_orderable: true, variant_groups: [{ group_id: extras.id, overrides: [] }], variants: [] },
      // Priced by its sizes, its large at a price of its own; no recipe.
      { name: 'Pizza', price_pence: null, is_orderable: true, notes: 'Wood oven', variant_groups: [{ group_id: size.id, overrides: [{ option_id: large.id, price_pence: 1300 }] }], variants: [] },
      { name: 'Fries', price_pence: 400, is_orderable: true, kitchen_name: 'FRY', variant_groups: [], variants: [] },
    ] },
    { title: 'Drinks', items: [{ name: 'Coke', price_pence: 250, is_orderable: true, variant_groups: [], variants: [] }] },
  ], { tagline: 'Lunch all day', tax: { rate: standard, rules: [{ venues: [], streams: [], types: [takeOut], rate: zero }] } })
  burger = dishIn(menu, 'Burger')
  pizza = dishIn(menu, 'Pizza')
  fries = dishIn(menu, 'Fries')
  coke = dishIn(menu, 'Coke')
  // A meal deal: a burger and a coke, the coke 50p more in it.
  const b = menuSaveBody(menu)
  b.sections.push({ title: 'Deals', items: [{
    name: 'Lunch deal', kind: 'combo', price_pence: 1500, is_orderable: true, variant_groups: [], variants: [],
    combo: { mode: 'manual', steps: [
      { id: randomUUID(), name: 'Main', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: burger.id, price_pence: 0 }] },
      { id: randomUUID(), name: 'Drink', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: coke.id, price_pence: 50 }] },
    ] },
  }] })
  await ok(owner.patch('/api/menus/' + menu.id, b), 'meal deal')
  menu = await ok(owner.get('/api/menus/' + menu.id))
  deal = dishIn(menu, 'Lunch deal')
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}), 'publish')
  for (const [d, r] of [[burger, burgerR], [fries, friesR], [coke, cokeR]]) await ok(owner.put(`/api/recipe-links/dishes/${d.id}/cell`, { recipe_id: r.id }))
  // Soho's own menu, sold by its bar: a burger at £10.
  sohoMenu = await makeMenu(owner, 'Soho bar', [{ title: 'Bar food', items: [{ name: 'Bar burger', price_pence: 1000, is_orderable: true, variant_groups: [], variants: [] }] }],
    { venue_id: soho, tax: { rate: standard, rules: [{ venues: [], streams: [], types: [takeOut], rate: zero }] } })
  sohoBurger = dishIn(sohoMenu, 'Bar burger')
  await ok(owner.put(`/api/recipe-links/dishes/${sohoBurger.id}/cell`, { recipe_id: burgerR.id }))
  bar = (await ok(owner.post(`/api/pos/venues/${soho}/revenue-streams`, { name: 'Bar', menu_ids: [sohoMenu.id] }))).id

  // What sold (as usage from sales keeps it), the last two days at Soho, eating in.
  const [d] = await sql`SELECT (current_date - 1)::text AS y, (current_date - 2)::text AS t`
  yesterday = d.y
  twoDaysAgo = d.t
  const mains = sectionOf(menu, 'Mains').id
  const at = { type: eatIn }
  await sold(ids.a, soho, yesterday, burger, mains, 60, 60000, 108, at)
  await sold(ids.a, soho, twoDaysAgo, burger, mains, 40, 40000, 72, at)
  await sold(ids.a, soho, yesterday, fries, mains, 80, 26640, 16, at)
  // Pizza has no recipe: its 30 units sold weren't costed.
  await sold(ids.a, soho, yesterday, pizza, mains, 30, 30000, null, { ...at, uncosted: 30 })
  await sold(ids.a, soho, yesterday, coke, sectionOf(menu, 'Drinks').id, 50, 10400, 25, at)
  // 20 deals took £12.92 net each; the burger and coke picked in them cost £2.30 a deal.
  await sold(ids.a, soho, yesterday, deal, sectionOf(menu, 'Deals').id, 20, 25840, 46, at)
  // Taken away at the bar, and at Leeds: in the venue's and every venue's engineering, never in an eat-in scenario.
  await sold(ids.a, soho, yesterday, burger, mains, 10, 12000, 18, { type: takeOut, stream: bar })
  await sold(ids.a, leeds, yesterday, burger, mains, 5, 5000, 9, at)

  // The other group's own.
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere-me', timezone: 'Europe/London', currency: 'GBP' }))).id
  bBar = (await ok(bOwner.post(`/api/pos/venues/${bVenue}/revenue-streams`, { name: 'Their bar' }))).id
  bType = (await ok(bOwner.get('/api/order-types')))[0].id
  bMenu = await makeMenu(bOwner, 'Their menu', [{ title: 'Theirs', items: [{ name: 'Their dish', price_pence: 500, is_orderable: true, variant_groups: [], variants: [] }] }])
  bDish = bMenu.sections[0].items[0]
  await sold(ids.b, bVenue, yesterday, bDish, bMenu.sections[0].id, 999, 99900, 10)
})
test.after(async () => { await claude.close(); await closeApp() })

// ── Engineering ──────────────────────────────────────────────

test('engineering: the worked section\'s classes from what sold at a venue', async () => {
  const e = await ok(owner.get(`/api/menu-margins/engineering?venue_id=${soho}&menu_id=${menu.id}&from=${twoDaysAgo}&to=${yesterday}`))
  assert.equal(e.sees_sales, true)
  const mains = e.sections.find(s => s.section === 'Mains')
  assert.equal(mains.menu, 'Lunch')
  // Burger 110 (100 eaten in, 10 taken away), fries 80, pizza 30: 220 units, three dishes, popular from 23.33%.
  assert.equal(mains.units, 220)
  assert.equal(mains.dish_count, 3)
  assert.equal(mains.popular_pct, 23.33)
  const by = Object.fromEntries(mains.dishes.map(x => [x.name, x]))
  // GP: burger (100000 + 12000 net) - (180 + 18) x 100 = 92,200p over 110 = 838.18 a unit; fries 26640 - 1600 = 25,040 over 80 = 313.
  assert.equal(by.Burger.gp_pence, 92200)
  assert.equal(by.Burger.gp_per_unit_pence, 838.18)
  assert.equal(by.Fries.gp_per_unit_pence, 313)
  // The section's average is over the 190 costed units: 117,240 / 190 = 617.05.
  assert.equal(mains.avg_gp_per_unit_pence, 617.05)
  assert.equal(by.Burger.class, 'star')
  assert.equal(by.Fries.class, 'plough_horse')
  // Pizza sold (30 of 220: 13.6%, not popular), but none of it could be costed: no class, and its units are out of GP.
  assert.equal(by.Pizza.class, null)
  assert.equal(by.Pizza.popular, false)
  assert.equal(by.Pizza.uncosted_units, 30)
  assert.equal(mains.uncosted_units, 30)
  // The deal is one dish of its own section; its burgers add nothing to Mains.
  const deals = e.sections.find(s => s.section === 'Deals')
  assert.equal(deals.dishes[0].kind, 'deal')
  assert.equal(deals.dishes[0].class, 'star', 'the only deal in its section')
  assert.ok(e.classes.star.suggestion)
})

test('engineering: every venue, the default days, a menu\'s sections only, another group\'s never', async () => {
  const all = await ok(owner.get(`/api/menu-margins/engineering?from=${twoDaysAgo}&to=${yesterday}`))
  const burgerAll = all.sections.flatMap(s => s.dishes).find(d => d.name === 'Burger')
  assert.equal(burgerAll.units, 115, 'Leeds\' five too')
  assert.ok(!all.sections.some(s => s.dishes.some(d => d.name === 'Their dish')), 'never another group\'s sales')
  const dflt = await ok(owner.get('/api/menu-margins/engineering'))
  assert.equal(dflt.to, yesterday, 'the last 28 days up to yesterday')
  const other = await ok(owner.get(`/api/menu-margins/engineering?menu_id=${sohoMenu.id}&from=${twoDaysAgo}&to=${yesterday}`))
  assert.deepEqual(other.sections, [], 'nothing of the Soho menu sold')
  assert.equal((await owner.get(`/api/menu-margins/engineering?menu_id=${bMenu.id}`)).status, 404)
  assert.equal((await owner.get(`/api/menu-margins/engineering?venue_id=${bVenue}`)).status, 404)
  assert.equal((await owner.get(`/api/menu-margins/engineering?from=${yesterday}&to=${twoDaysAgo}`)).status, 422)
})

test('engineering: Costing view without till reports sees units and shares, no GP or classes; no Costing, nothing', async () => {
  const e = await ok(costView.get(`/api/menu-margins/engineering?venue_id=${soho}&from=${twoDaysAgo}&to=${yesterday}`))
  assert.equal(e.sees_sales, false)
  const mains = e.sections.find(s => s.section === 'Mains')
  const b = mains.dishes.find(d => d.name === 'Burger')
  assert.equal(b.units, 110)
  assert.equal(b.popular, true)
  for (const k of ['gp_pence', 'gp_per_unit_pence', 'net_pence', 'cost_pct', 'class', 'profitable']) assert.equal(k in b, false, k)
  assert.equal('avg_gp_per_unit_pence' in mains, false)
  const operator = as(A.operator, ids.a)
  assert.equal((await operator.get('/api/menu-margins/engineering')).status, 403, 'operators have no Costing by default')
})

/** A closed till check at a venue on a day, as the till keeps it: lines [{ item_id, name, qty, gross, discount, net, vat, combo }], promotions. */
async function tillCheck(venueId, day, lines, { promotions = [] } = {}) {
  const [d] = await sql`
    INSERT INTO pos_days (tenant_id, venue_id, business_date, opened_at, closed_at)
    VALUES (${ids.a}, ${venueId}, ${day}::date, now() - interval '3 hours', now()) RETURNING id`
  const id = 'c-' + randomUUID()
  const withIds = lines.map(l => ({ ...l, id: l.id || 'l-' + randomUUID() }))
  const state = {
    id, lines: withIds.map(l => ({ id: l.id, item_id: l.item_id, name: l.name, qty: l.qty, modifiers: [], combo: l.combo || null })),
    promotions: promotions.map(p => ({ ...p, lines: Object.fromEntries(Object.entries(p.lines).map(([i, pence]) => [withIds[Number(i)].id, pence])) })),
  }
  await sql`
    INSERT INTO pos_checks (id, tenant_id, venue_id, day_id, mode, status, opened_at, closed_at, subtotal, total, state, last_seq, is_generated, order_type_id)
    VALUES (${id}, ${ids.a}, ${venueId}, ${d.id}, 'counter', 'closed', now() - interval '1 hour', now(), 0, 0, ${sql.json(state)}, 1, false, ${eatIn})`
  for (const l of withIds) {
    await sql`
      INSERT INTO pos_check_lines (id, tenant_id, venue_id, check_id, day_id, item_id, name, qty, gross, discount, net, vat, status)
      VALUES (${l.id}, ${ids.a}, ${venueId}, ${id}, ${d.id}, ${l.item_id}, ${l.name}, ${l.qty}, ${l.gross}, ${l.discount || 0}, ${l.net}, ${l.vat}, 'sent')`
  }
}

test('engineering: an automatic deal found among dishes rung up one by one counts as those dishes; a section with no costed unit has no average (7a review)', async () => {
  // A dinner menu: a steak (the burger's recipe, £1.80) and a lemonade (the coke's, £0.50), a stew with no recipe,
  // and the automatic Steak meal (a steak and a lemonade for £17, £2 less than the two).
  dinner = await makeMenu(owner, 'Dinner', [
    { title: 'Mains', items: [{ name: 'Steak', price_pence: 1600, is_orderable: true, variant_groups: [], variants: [] }] },
    { title: 'Drinks', items: [{ name: 'Lemonade', price_pence: 300, is_orderable: true, variant_groups: [], variants: [] }] },
    { title: 'Specials', items: [{ name: 'Stew', price_pence: 900, is_orderable: true, variant_groups: [], variants: [] }] },
  ], { tax: { rate: standard, rules: [] } })
  const steak = dishIn(dinner, 'Steak'), lemonade = dishIn(dinner, 'Lemonade'), stew = dishIn(dinner, 'Stew')
  const main = randomUUID(), drink = randomUUID()
  const b = menuSaveBody(dinner)
  b.sections.push({ title: 'Deals', items: [{
    name: 'Steak meal', kind: 'combo', price_pence: 1700, is_orderable: true, variant_groups: [], variants: [],
    combo: { mode: 'auto', steps: [
      { id: main, name: 'Main', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: steak.id, price_pence: 0 }] },
      { id: drink, name: 'Drink', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: lemonade.id, price_pence: 0 }] },
    ] },
  }] })
  await ok(owner.patch('/api/menus/' + dinner.id, b), 'the automatic deal')
  dinner = await ok(owner.get('/api/menus/' + dinner.id))
  const meal = dishIn(dinner, 'Steak meal')
  assert.equal(meal.combo.mode, 'auto')
  await ok(owner.post(`/api/menus/${dinner.id}/publish`, {}), 'publish dinner')
  for (const [d, r] of [[steak, burgerR], [lemonade, cokeR]]) await ok(owner.put(`/api/recipe-links/dishes/${d.id}/cell`, { recipe_id: r.id }))
  const [d3] = await sql`SELECT (current_date - 3)::text AS d`
  threeDaysAgo = d3.d
  // At Leeds three days ago: a steak and a lemonade rung up one by one, in which the till found the Steak meal
  // (a promotion of kind combo over the two lines, £1.60 and 40p off them); a steak on its own; a Steak meal
  // from its own button; two stews.
  await tillCheck(leeds, threeDaysAgo, [
    { item_id: steak.id, name: 'Steak', qty: 1, gross: 1600, discount: 160, net: 1440, vat: 240 },
    { item_id: lemonade.id, name: 'Lemonade', qty: 1, gross: 300, discount: 40, net: 260, vat: 43 },
  ], { promotions: [{ promotion_id: meal.id, name: 'Steak meal', kind: 'combo', count: 1, lines: { 0: 160, 1: 40 } }] })
  await tillCheck(leeds, threeDaysAgo, [{ item_id: steak.id, name: 'Steak', qty: 1, gross: 1600, net: 1600, vat: 267 }])
  await tillCheck(leeds, threeDaysAgo, [{
    item_id: meal.id, name: 'Steak meal', qty: 1, gross: 1700, net: 1700, vat: 283,
    combo: [{ step_id: main, item_id: steak.id, modifiers: [] }, { step_id: drink, item_id: lemonade.id, modifiers: [] }],
  }])
  await tillCheck(leeds, threeDaysAgo, [{ item_id: stew.id, name: 'Stew', qty: 2, gross: 1800, net: 1800, vat: 300 }])
  // Usage from sales for that day at Leeds only (the rows above it are written by hand).
  await withSystem(tx => usage.runVenueUsage(tx, ids.a, leeds, { days: [threeDaysAgo], force: true }))

  const e = await ok(owner.get(`/api/menu-margins/engineering?venue_id=${leeds}&menu_id=${dinner.id}&from=${threeDaysAgo}&to=${threeDaysAgo}`))
  const sec = Object.fromEntries(e.sections.map(s => [s.section, s]))
  // Both steaks in Mains, the one in the automatic deal at what it took after the saving: (1440 - 240) + (1600 - 267) net.
  assert.equal(sec.Mains.units, 2)
  const s = sec.Mains.dishes[0]
  assert.equal(s.name, 'Steak')
  assert.equal(s.net_pence, 1200 + 1333)
  assert.equal(s.gp_pence, 2533 - 360)
  assert.equal(sec.Drinks.units, 1, 'the lemonade rung up on its own; the one picked in the Steak meal from its button adds nothing')
  // The deal has units only for the one rung up from its own button.
  assert.equal(sec.Deals.units, 1)
  assert.equal(sec.Deals.dishes[0].kind, 'deal')
  assert.deepEqual(e.auto_deals, [{ name: 'Steak meal', menu: 'Dinner' }])
  // Specials: two stews sold, none could be costed: no average, never £0.00.
  assert.equal(sec.Specials.units, 2)
  assert.equal(sec.Specials.avg_gp_per_unit_pence, null)
  assert.equal(sec.Specials.dishes[0].class, null)

  // Pepper says the same: the automatic deal and its words; the uncosted section's average is a gap.
  const r = await call(owner, 'menu_engineering', { venue: 'Leeds', menu: 'Dinner', days: 7 })
  assert.equal(r.error, false, r.result)
  const out = JSON.parse(r.result)
  const sp = out.sections.find(x => x.section === 'Specials')
  assert.match(sp.average_gp_per_unit, /^not costed/)
  assert.doesNotMatch(r.result, /£0\.00/)
  assert.deepEqual(sp.not_costed, ['Stew'])
  assert.deepEqual(out.automatic_deals, ['Steak meal'])
  assert.match(out.automatic_deals_note, /discount over those dishes/)
  assert.equal(out.sections.find(x => x.section === 'Mains').average_gp_per_unit, '£10.87')
})

// ── Scenarios ────────────────────────────────────────────────

test('a scenario\'s weighted cost % and GP at the real mix, before and after', async () => {
  scenario = await ok(owner.post('/api/cost-scenarios', body()), 'save')
  const v = await ok(owner.get('/api/cost-scenarios/' + scenario.id))
  assert.equal(v.scenario.name, 'Ten percent')
  assert.equal(v.mix.to, yesterday)
  assert.equal(v.mix.days, 7)
  const t = v.figures.total
  // Eaten in at Soho: burger 100, fries 80, coke 50, deal 20 (the bar's take away and Leeds left out); pizza 30, not costed.
  assert.equal(t.units, 280)
  assert.equal(t.left_out_units, 30)
  // Before: net 100 x £10.00 + 80 x £3.33 + 50 x £2.08 + 20 x £12.92 = £1,628.80; cost £267.00; 16.4%.
  assert.equal(t.before.net_pence, 162880)
  assert.equal(t.before.cost_pence, 26700)
  assert.equal(t.before.gp_pence, 136180)
  assert.equal(t.before.cost_pct, 16.4)
  // After: prices up 10% to the next 10p (the coke set to £3.00), the burger's cost up 20p (in the deal too).
  assert.equal(t.after.net_pence, 180200)
  assert.equal(t.after.cost_pence, 29100)
  assert.equal(t.after.gp_pence, 151100)
  assert.equal(t.after.cost_pct, 16.1)
  assert.deepEqual(t.change, { gp_pence: 14920, cost_pct_pts: -0.3 })
  const deal_ = v.figures.dishes.find(d => d.name === 'Lunch deal')
  assert.deepEqual(deal_.typical_picks, ['Burger', 'Coke'])
  assert.equal(deal_.after.cost, 2.5)
  assert.deepEqual(v.words, ['Prices of every dish up 10% (rounded up to 10p)', 'Costs of Burger up £0.20', 'Prices of Coke set to £3.00'])
  // The bar's take away is its own mix, zero rated: the burger's whole price is net.
  const away = await ok(owner.post('/api/cost-scenarios/preview', body({ revenue_stream_id: bar, order_type_id: takeOut })))
  const b = away.figures.dishes.find(d => d.name === 'Burger')
  assert.equal(b.units, 10)
  assert.equal(b.vat_rate, 0)
  assert.equal(b.after.net_pence, 1320)
})

test('a scenario saved whole, copied and deleted; View looks, Manage saves; sales need till reports', async () => {
  // The whole save: a field left out is refused (rule 13).
  const { notes, ...partial } = body()
  assert.equal((await owner.put('/api/cost-scenarios/' + scenario.id, partial)).status, 400)
  const saved = await ok(owner.put('/api/cost-scenarios/' + scenario.id, body({ name: 'Ten percent, Soho', notes: 'For spring' })))
  assert.equal(saved.name, 'Ten percent, Soho')
  assert.equal(saved.changes.length, 3)
  const list = await ok(owner.get('/api/cost-scenarios'))
  assert.equal(list.scenarios[0].menu, 'Lunch')
  assert.equal(list.scenarios[0].changes, 3)
  const copy = await ok(owner.post(`/api/cost-scenarios/${scenario.id}/copy`, {}))
  assert.equal(copy.name, 'Ten percent, Soho (copy)')
  assert.deepEqual(copy.changes, saved.changes)
  // Costing view: looks (with no sales in pounds at the mix), saves nothing.
  const looked = await ok(costView.get('/api/cost-scenarios/' + scenario.id))
  assert.equal(looked.sees_sales, false)
  assert.equal('net_pence' in looked.figures.total.before, false)
  assert.equal('gp_pence' in looked.figures.total.after, false)
  assert.equal(looked.figures.total.before.cost_pct, 16.4, 'the weighted cost % shows')
  assert.equal((await costView.post('/api/cost-scenarios', body())).status, 403)
  assert.equal((await costView.put('/api/cost-scenarios/' + scenario.id, body())).status, 403)
  assert.equal((await costView.delete('/api/cost-scenarios/' + copy.id)).status, 403)
  assert.equal((await costView.post(`/api/cost-scenarios/${copy.id}/copy`, {})).status, 403)
  assert.equal((await as(A.operator, ids.a).get('/api/cost-scenarios')).status, 403)
  // A change must say what it does.
  assert.equal((await owner.post('/api/cost-scenarios', body({ changes: [{ ...CHANGES()[0], value: 900 }] }))).status, 422)
  assert.equal((await owner.post('/api/cost-scenarios', body({ changes: [{ ...CHANGES()[1], dish_id: null }] }))).status, 422)
  assert.equal((await owner.post('/api/cost-scenarios', body({ revenue_stream_id: bar, venue_id: leeds }))).status, 422, 'Soho\'s bar at Leeds')
  assert.equal((await owner.delete('/api/cost-scenarios/' + copy.id)).status, 200)
  assert.equal((await owner.get('/api/cost-scenarios/' + copy.id)).status, 404)
})

test('another group\'s menu, venue, stream, order type, section, dish and scenario are refused', async () => {
  const no = async (b, what) => {
    const r = await owner.post('/api/cost-scenarios', b)
    assert.equal(r.status, 404, what + ' (' + r.status + ')')
  }
  await no(body({ menu_id: bMenu.id }), 'their menu')
  await no(body({ venue_id: bVenue }), 'their venue')
  await no(body({ revenue_stream_id: bBar }), 'their stream')
  await no(body({ order_type_id: bType }), 'their order type')
  await no(body({ changes: [{ ...CHANGES()[0], applies: 'section', section_id: bMenu.sections[0].id }] }), 'their section')
  await no(body({ changes: [{ ...CHANGES()[1], dish_id: bDish.id }] }), 'their dish')
  await no(body({ changes: [{ ...CHANGES()[1], dish_id: sohoBurger.id }] }), 'a dish of another menu of ours')
  assert.equal((await owner.post('/api/cost-scenarios/preview', body({ menu_id: bMenu.id }))).status, 404)
  for (const [m, url, b] of [
    ['get', '/api/cost-scenarios/' + scenario.id], ['put', '/api/cost-scenarios/' + scenario.id, body()],
    ['delete', '/api/cost-scenarios/' + scenario.id], ['post', `/api/cost-scenarios/${scenario.id}/copy`, {}],
    ['post', `/api/cost-scenarios/${scenario.id}/push/preview`, {}], ['post', `/api/cost-scenarios/${scenario.id}/push`, { stamp: 'x' }],
  ]) {
    const r = await bOwner[m](url, b)
    assert.equal(r.status, 404, m + ' ' + url + ' by the other group (' + r.status + ')')
  }
  assert.deepEqual((await ok(bOwner.get('/api/cost-scenarios'))).scenarios, [])
})

// ── Push prices ──────────────────────────────────────────────

test('push prices: a preview of every price, refused without Menus manage, written into the draft whole, never published', async () => {
  const before = await ok(owner.get('/api/menus/' + menu.id))
  const [releases] = await sql`SELECT count(*)::int AS n FROM menu_releases WHERE menu_id = ${menu.id}`
  assert.equal((await costManager.post(`/api/cost-scenarios/${scenario.id}/push/preview`, {})).status, 403, 'Costing manage alone can\'t push')
  assert.equal((await costView.post(`/api/cost-scenarios/${scenario.id}/push/preview`, {})).status, 403)
  const p = await ok(owner.post(`/api/cost-scenarios/${scenario.id}/push/preview`, {}))
  assert.deepEqual(p.prices.map(x => [x.dish, x.label, x.from_pence, x.to_pence]), [
    ['Burger', null, 1200, 1320], ['Pizza', 'Small', 900, 990], ['Pizza', 'Large', 1300, 1430], ['Fries', null, 400, 440], ['Coke', null, 250, 300], ['Lunch deal', null, 1500, 1650],
  ])
  assert.deepEqual(p.sold_at, { venue: null, streams: [] }, 'a group menu: every venue')
  assert.equal(p.unpublished, 0)
  assert.equal(p.publish_page, '/menus?edit=' + menu.id)
  assert.equal((await costManager.post(`/api/cost-scenarios/${scenario.id}/push`, { stamp: p.stamp })).status, 403)
  assert.equal((await owner.post(`/api/cost-scenarios/${scenario.id}/push`, { stamp: 'not-it' })).status, 409, 'only what the preview showed')
  const done = await ok(owner.post(`/api/cost-scenarios/${scenario.id}/push`, { stamp: p.stamp }))
  assert.equal(done.pushed, 6)
  // The draft has the new prices: the dish's own, the pizza's sizes as its own, the extra cheese as it was.
  const after = await ok(owner.get('/api/menus/' + menu.id))
  assert.equal(dishIn(after, 'Burger').price_pence, 1320)
  assert.equal(dishIn(after, 'Coke').price_pence, 300)
  assert.equal(dishIn(after, 'Lunch deal').price_pence, 1650)
  const sizes = dishIn(after, 'Pizza').variant_groups[0].options
  assert.deepEqual(sizes.map(o => [o.label, o.price_pence, o.overridden]), [['Small', 990, true], ['Large', 1430, true]])
  const cheese = dishIn(after, 'Burger').variant_groups[0].options[0]
  assert.deepEqual([cheese.price_pence, cheese.overridden], [80, false])
  const lib = await ok(owner.get('/api/menus/variant-groups'))
  assert.equal((lib.groups || lib).find(g => g.id === size.id).options.find(o => o.id === small.id).price_pence, 900, 'the option group itself is not changed')
  // Every other field survived the whole-tree save.
  const strip = m => JSON.stringify(menuSaveBody(m), (k, v) => (k === 'price_pence' || k === 'overrides' ? undefined : v))
  assert.equal(strip(after), strip(before))
  assert.equal(dishIn(after, 'Burger').description, 'Beef in a bun')
  assert.equal(dishIn(after, 'Burger').sku, 'BUR-1')
  assert.equal(after.tagline, 'Lunch all day')
  assert.equal(dishIn(after, 'Lunch deal').combo.steps.length, 2)
  // Never published: the same releases, the live menu at the old prices.
  const [still] = await sql`SELECT count(*)::int AS n FROM menu_releases WHERE menu_id = ${menu.id}`
  assert.equal(still.n, releases.n)
  const live = await ok(owner.get(`/api/menus/${menu.id}?version=live`))
  assert.equal(dishIn(live, 'Burger').price_pence, 1200)
  const s = await ok(owner.get('/api/cost-scenarios/' + scenario.id))
  assert.ok(s.scenario.pushed_at)
  // The draft now holds changes that aren't live; pushing again changes the prices again from the new ones.
  const again = await ok(owner.post(`/api/cost-scenarios/${scenario.id}/push/preview`, {}))
  assert.ok(again.unpublished > 0)
  assert.equal(again.prices.find(x => x.dish === 'Burger').from_pence, 1320)
})

test('push prices at a venue menu and its stream: the dish\'s one price, wherever the menu is sold', async () => {
  const s = await ok(owner.post('/api/cost-scenarios', {
    name: 'Bar burger up', menu_id: sohoMenu.id, venue_id: soho, revenue_stream_id: bar, order_type_id: takeOut, mix_days: 7, notes: null,
    changes: [{ what: 'price', applies: 'dish', section_id: null, dish_id: sohoBurger.id, how: 'amount', value: 0.5, round_to: 1, round: 'nearest' }],
  }))
  const p = await ok(owner.post(`/api/cost-scenarios/${s.id}/push/preview`, {}))
  assert.deepEqual(p.sold_at, { venue: 'Soho', streams: ['Bar (Soho)'] })
  assert.deepEqual(p.prices.map(x => [x.dish, x.from_pence, x.to_pence]), [['Bar burger', 1000, 1050]])
  await ok(owner.post(`/api/cost-scenarios/${s.id}/push`, { stamp: p.stamp }))
  const m = await ok(owner.get('/api/menus/' + sohoMenu.id))
  assert.equal(dishIn(m, 'Bar burger').price_pence, 1050)
  // Nothing left to push: refused, said why.
  const none = await ok(owner.post('/api/cost-scenarios', { ...body(), name: 'Costs only', changes: [CHANGES()[1]] }))
  const np = await ok(owner.post(`/api/cost-scenarios/${none.id}/push/preview`, {}))
  assert.deepEqual(np.prices, [])
  assert.equal((await owner.post(`/api/cost-scenarios/${none.id}/push`, { stamp: np.stamp })).status, 422)
})

// ── Pepper ───────────────────────────────────────────────────

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
const text = t => [{ type: 'text', text: t }]
/** One tool call through the chat: { card, result, error }. */
async function call(who, tool, input) {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_e' + Math.random().toString(36).slice(2, 10), name: tool, input }] }),
    () => ({ stop_reason: 'end_turn', content: text('Done.') }),
  )
  const r = await ok(who.post('/api/ai/chat', { message: 'go' }))
  const card = r.items.find(i => i.type === 'action' && i.status === 'pending')
  const sent = claude.requests.at(-1).body.messages.flatMap(m => (Array.isArray(m.content) ? m.content : [])).filter(b => b.type === 'tool_result').at(-1)
  return { card, result: sent?.content?.[0]?.text ?? '', error: !!sent?.is_error }
}

test('Pepper: menu_engineering names a section\'s classes, never ids', async () => {
  const r = await call(owner, 'menu_engineering', { venue: 'Soho', menu: 'Lunch', section: 'Mains', days: 7 })
  assert.equal(r.error, false, r.result)
  const out = JSON.parse(r.result)
  assert.equal(out.sections.length, 1)
  const mains = out.sections[0]
  assert.deepEqual(mains.stars, ['Burger'])
  assert.deepEqual(mains.plough_horses, ['Fries'])
  assert.deepEqual(mains.not_costed, ['Pizza'])
  assert.equal(mains.average_gp_per_unit, '£6.17')
  assert.match(out.what_to_do.dogs, /taking it off/)
  assert.doesNotMatch(r.result, UUID, 'names, never ids')
})

test('Pepper: save_scenario shows the figures at the mix on its card and saves on Confirm; replace changes the same one', async () => {
  const input = {
    name: 'Pepper spring', menu: 'Lunch', venue: 'Soho', order_type: 'Eat in', days: 7,
    changes: [{ what: 'price', section: 'Mains', how: 'percent', value: 5, round_to: 10, round: 'nearest' }, { what: 'cost', dish: 'Fries', how: 'amount', value: 0.05 }],
  }
  const r = await call(owner, 'save_scenario', input)
  assert.ok(r.card, r.result)
  assert.match(r.card.title, /Save the scenario Pepper spring on Lunch/)
  assert.ok(r.card.lines.includes('Prices of Mains up 5% (rounded to 10p)'), JSON.stringify(r.card.lines))
  assert.ok(r.card.lines.includes('Costs of Fries up £0.05'))
  assert.ok(r.card.lines.some(l => /^Cost % at what sold \(.+\): \d+\.\d% to \d+\.\d%$/.test(l)), JSON.stringify(r.card.lines))
  assert.doesNotMatch(r.card.title + JSON.stringify(r.card.lines), UUID)
  const [before] = await sql`SELECT count(*)::int AS n FROM cost_scenarios WHERE tenant_id = ${ids.a} AND name = 'Pepper spring'`
  assert.equal(before.n, 0, 'nothing is saved before Confirm')
  await ok(owner.post(`/api/ai/actions/${r.card.id}/confirm`, {}))
  const rows = await sql`SELECT name, venue_id, order_type_id, mix_days, changes FROM cost_scenarios WHERE tenant_id = ${ids.a} AND name = 'Pepper spring'`
  assert.equal(rows.length, 1)
  assert.equal(rows[0].venue_id, soho)
  assert.equal(rows[0].order_type_id, eatIn)
  assert.equal(rows[0].changes[0].section_id, sectionOf(menu, 'Mains').id)
  assert.equal(rows[0].changes[1].dish_id, fries.id)
  const [act] = await sql`SELECT tool, ok, result FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = 'save_scenario' ORDER BY created_at DESC LIMIT 1`
  assert.equal(act.ok, true)
  assert.doesNotMatch(JSON.stringify(act.result), UUID)
  // Again with replace: the same scenario changes, no second one.
  const again = await call(owner, 'save_scenario', { ...input, replace: true, changes: [input.changes[0]] })
  assert.match(again.card.title, /^Change the scenario Pepper spring/)
  await ok(owner.post(`/api/ai/actions/${again.card.id}/confirm`, {}))
  const after = await sql`SELECT changes FROM cost_scenarios WHERE tenant_id = ${ids.a} AND name = 'Pepper spring'`
  assert.equal(after.length, 1)
  assert.equal(after[0].changes.length, 1)
  // A dish that isn't on the menu is said, never guessed.
  const wrong = await call(owner, 'save_scenario', { ...input, changes: [{ what: 'price', dish: 'Unicorn pie', how: 'percent', value: 5 }] })
  assert.ok(wrong.error || /Unicorn pie/.test(wrong.result), wrong.result)
  assert.equal(wrong.card, undefined, 'no card for it')
})

test('Pepper: changing a saved scenario starts from it, keeping its notes, days, venue and order type unless named (7a review, rule 13)', async () => {
  const saved = await ok(owner.post('/api/cost-scenarios', body({ name: 'Spring', notes: 'For spring', mix_days: 56 })))
  const read = async () => (await sql`
    SELECT name, venue_id, revenue_stream_id, order_type_id, mix_days, notes, changes FROM cost_scenarios WHERE id = ${saved.id}`)[0]
  // Only the prices named: everything else stays as it was saved.
  const r = await call(owner, 'save_scenario', { name: 'Spring', menu: 'Lunch', replace: true, changes: [{ what: 'price', section: 'Mains', how: 'percent', value: 6 }] })
  assert.ok(r.card, r.result)
  assert.match(r.card.title, /^Change the scenario Spring on Lunch\?$/)
  assert.equal(r.card.lines[0], 'Eat in at Soho, the menu\'s draft')
  assert.ok(r.card.lines.includes('Its 3 changes replaced by this one'), JSON.stringify(r.card.lines))
  assert.ok(!r.card.lines.some(l => /^(Where|The mix|Notes):/.test(l)), 'nothing else changes: ' + JSON.stringify(r.card.lines))
  assert.ok(r.card.lines.some(l => /^Cost % at what sold \(.+\)/.test(l)))
  await ok(owner.post(`/api/ai/actions/${r.card.id}/confirm`, {}))
  let row = await read()
  assert.deepEqual([row.name, row.venue_id, row.revenue_stream_id, row.order_type_id, row.mix_days, row.notes], ['Spring', soho, null, eatIn, 56, 'For spring'])
  assert.equal(row.changes.length, 1)
  assert.equal(row.changes[0].section_id, sectionOf(menu, 'Mains').id)
  // What is named changes, and the card says so; the saved name stays as it was written.
  const again = await call(owner, 'save_scenario', {
    name: 'spring', menu: 'Lunch', replace: true, venue: 'Leeds', days: 14, notes: 'Leeds too', changes: [{ what: 'cost', dish: 'Fries', how: 'amount', value: 0.05 }],
  })
  assert.ok(again.card, again.result)
  for (const l of ['Where: Eat in at Soho to Eat in at Leeds', 'The mix: the last 56 days to the last 14 days', 'Notes: For spring to Leeds too', 'Its 1 change replaced by this one']) {
    assert.ok(again.card.lines.includes(l), l + ' in ' + JSON.stringify(again.card.lines))
  }
  await ok(owner.post(`/api/ai/actions/${again.card.id}/confirm`, {}))
  row = await read()
  assert.deepEqual([row.name, row.venue_id, row.order_type_id, row.mix_days, row.notes], ['Spring', leeds, eatIn, 14, 'Leeds too'])
  // A scenario at Soho's bar moved to Leeds leaves the bar behind (it is Soho's), and says so.
  const atBar = await ok(owner.post('/api/cost-scenarios', body({ name: 'Bar spring', revenue_stream_id: bar, order_type_id: takeOut })))
  const moved = await call(owner, 'save_scenario', { name: 'Bar spring', menu: 'Lunch', replace: true, venue: 'Leeds', changes: [{ what: 'price', how: 'percent', value: 1 }] })
  assert.ok(moved.card.lines.includes('Where: Take out at Bar (Soho) to Take out at Leeds'), JSON.stringify(moved.card.lines))
  await ok(owner.post(`/api/ai/actions/${moved.card.id}/confirm`, {}))
  const [b2] = await sql`SELECT venue_id, revenue_stream_id, order_type_id, mix_days FROM cost_scenarios WHERE id = ${atBar.id}`
  assert.deepEqual([b2.venue_id, b2.revenue_stream_id, b2.order_type_id, b2.mix_days], [leeds, null, takeOut, 7])
  for (const id of [saved.id, atBar.id]) await ok(owner.delete('/api/cost-scenarios/' + id))
})

// ── Reports ──────────────────────────────────────────────────

test('reports: Menu engineering and Cost scenarios, the starter, and sales kept from Costing view alone', async () => {
  const period = { params: [{ key: 'period', type: 'period', default: { relative: 'last_n_days', n: 7 } }], filters: [{ field: 'date', op: 'in_period', param: 'period' }] }
  const e = await ok(owner.post('/api/reports/preview', { spec: { kind: 'list', subject: 'recipes.engineering', rows: ['section', 'dish', 'class', 'units', 'gp_per_unit'], ...period } }))
  const flat = JSON.stringify(e.rows)
  assert.ok(flat.includes('"plough_horse"'), flat.slice(0, 600))
  assert.ok(flat.includes('Burger'))
  assert.ok(!flat.includes('Their dish'), 'never another group\'s')
  const sc = await ok(owner.post('/api/reports/preview', { spec: { kind: 'list', subject: 'recipes.scenarios', rows: ['name', 'menu', 'changes', 'pushed'] } }))
  assert.ok(JSON.stringify(sc.rows).includes('Ten percent, Soho'))
  await ok(owner.post('/api/reports/starter:menu_engineering_month/run', {}), 'starter')
  const noSales = await costView.post('/api/reports/preview', { spec: { kind: 'list', subject: 'recipes.engineering', rows: ['dish', 'class'], ...period } })
  assert.ok(noSales.status >= 400 || !/plough_horse/.test(JSON.stringify(noSales.body)), 'the class needs till reports view')
  const operator = as(A.operator, ids.a)
  assert.ok((await operator.post('/api/reports/preview', { spec: { kind: 'list', subject: 'recipes.scenarios', rows: ['name'] } })).status >= 400, 'Costing view to report on scenarios')
})

test('reports: Menu engineering beside a weekly subject is worked out over the period as asked, dated inside it (7a review)', async () => {
  const { runner, rowsOf } = await import('./support/reports.mjs')
  // Two whole weeks to the Sunday after yesterday: a weekly main subject widens the daily ranges by six days.
  const [w] = await sql`SELECT (date_trunc('week', current_date - 1)::date - 7)::text AS from, (date_trunc('week', current_date - 1)::date + 6)::text AS to`
  const res = await runner(ids.a)({
    subject: 'rota.staff_weeks', rows: [{ field: 'date', bucket: 'week' }],
    filters: [{ field: 'date', op: 'in_period', value: { from: w.from, to: w.to } }],
    also: [{ key: 'eng', subject: 'recipes.engineering' }],
    values: [{ key: 'pay', measure: 'pay_total' }, { key: 'units', measure: 'units_sold', from: 'eng' }],
  })
  const rows = rowsOf(res)
  const units = rows.reduce((s, r) => s + Number(r.units || 0), 0)
  // The same as the Engineering tab over those days, every venue: none dropped, none from days after them.
  const e = await ok(owner.get(`/api/menu-margins/engineering?from=${w.from}&to=${w.to}`))
  assert.ok(e.total.units > 0)
  assert.equal(units, e.total.units, JSON.stringify({ rows, notes: res.meta?.notes }))
  // One snapshot, in the period's last week (dated at the period's last day).
  assert.deepEqual(rows.filter(r => Number(r.units) > 0).map(r => r['date:week']), [new Date(Date.parse(w.to) - 6 * 86400000).toISOString().slice(0, 10)])
})
