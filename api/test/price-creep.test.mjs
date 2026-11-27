// Price creep (inventory phase 7b, migration 315, 27 Nov 2026): a supplier
// price change (a price edited, a supplier's price list by code, an
// inventory import, an invoice's prices applied) works out only the dishes
// whose recipes use the changed items (through prep recipes, and the meal
// deals holding them), records those that crossed their cost target or limit
// as cost alerts naming the dish and why (what moved, by how much), keeps
// cost_target_states by the sweep's own function so the rule trigger
// dish_over_target fires once whichever of the hook and the hourly sweep
// notices first; a dry run records nothing; Today's dishes over target card
// carries the alerts and opens them; marking them seen (seen_by); Pepper's
// why_cost_changed from the price history; the report starter; another
// group's ids refused; Costing view, Costing manage and purchasing prices.
// Review fixes: a "choose a main" deal named by the dish at its dearest picks
// (the alert and why_cost_changed), two price changes at once never clearing
// a crossing (the lock before the prices are read), the summary without
// supplier prices, Today's card key kept when the alerts are marked seen.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const { as, ok, sql, getApp, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { withTenant } = await import('../src/config/db.js')
const { priceCreep } = await import('../src/services/priceCreepSvc.js')
const { sweepCostTargets } = await import('../src/services/stockFoodCostSvc.js')

let ids, owner, operator, viewer, bOwner, soho, leeds, bVenue, sup
let chicken, butter, saffron, menu, platter, soup, toast, rice, deal, rule
const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return this } }
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
const alertsOf = (dishId, venueId = null) => sql`
  SELECT venue_id, name, old_cost_pct::float8 AS old_cost_pct, new_cost_pct::float8 AS new_cost_pct, old_band, new_band,
         threshold_pct::float8 AS threshold_pct, source, cause, causes, po_id, changed_by, seen_by, seen_at
    FROM cost_alerts WHERE tenant_id = ${ids.a} AND dish_id = ${dishId} ${venueId ? sql`AND venue_id = ${venueId}` : sql``}
   ORDER BY at, venue_id`
const firings = (ruleId, dishId = null) => sql`
  SELECT status, event_key FROM pepper_rule_firings WHERE rule_id = ${ruleId} ${dishId ? sql`AND event_key LIKE ${'%' + dishId + '%'}` : sql``} ORDER BY fired_at, id`
const stateOf = (dishId, venueId) => sql`
  SELECT band, cost_pct::float8 AS cost_pct, since FROM cost_target_states WHERE tenant_id = ${ids.a} AND venue_id = ${venueId} AND dish_id = ${dishId}`
async function waitFor(fn, what) {
  for (let i = 0; i < 100; i++) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Waited too long for ' + what)
}
async function asRole(permissions, fn) {
  const [role] = await sql`INSERT INTO tenant_roles (tenant_id, key, label, permissions, is_builtin)
    VALUES (${ids.a}, ${'pc_' + randomUUID().slice(0, 8)}, 'Price creep', ${sql.json(permissions)}, false) RETURNING id`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  try {
    return await fn()
  } finally {
    await sql`UPDATE users SET custom_role_id = NULL WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  }
}
async function pepper(sub, name, input) {
  const { makeContext } = await import('../src/ai/context.js')
  const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  return { tool, out: await tool.run(ctx, parseInput(tool, input)) }
}
const csv = rows => Buffer.from(rows.join('\n') + '\n').toString('base64')
const IMPORT_HEAD = 'Item,Category,Base unit,Storage,Item code,Supplier,Supplier code,Product name,Pack,Pack count,Pack size,Pack unit,Price,VAT %,Minimum order,Order in steps of,Barcode'

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-pc', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-pc', timezone: 'Europe/London', currency: 'GBP' }))).id
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-pc', timezone: 'Europe/London' }))).id
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
  await ok(owner.put('/api/menu-margins/settings', { target_pct: 30, limit_pct: 35, sections: [] }))
  sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  const item = async (name, price, code, pack = { pack_qty: 1, pack_unit: 'kg' }) => {
    const i = await ok(owner.post('/api/inventory/items', { name, base_unit: 'g' }))
    const q = (await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: sup.id, supplier_code: code, pack_name: 'Bag', pack_count: 1, ...pack, price }))).quotes[0]
    return { ...i, quote: q }
  }
  // Chicken £6 a kg, butter £8 a kg, rice £2 a kg, saffron £5 a gram (a 1 g tin).
  chicken = await item('Chicken thighs', 6, 'CHX-1')
  butter = await item('Butter', 8, 'BUT-1')
  rice = await item('Basmati rice', 2, 'RICE-1')
  saffron = await item('Saffron', 5, 'SAF-1', { pack_qty: 1, pack_unit: 'g' })
  const recipe = body => ok(owner.post('/api/recipes', { kind: 'dish', status: 'live', ...body }))
  // The platter: 500 g chicken (£3.00 against £10 net: 30%, on target). The soup: 250 ml of a stock made from
  // 500 g chicken a litre (£0.75 against £5: 15%). Toast: 20 g butter (£0.16 against £3.33). Saffron rice:
  // 0.1 g saffron and 100 g rice (£0.70 against £4.17).
  const platterR = await recipe({ name: 'Chicken platter', lines: [{ item_id: chicken.id, qty: 500, unit: 'g' }] })
  const stock = await recipe({ name: 'Chicken stock', kind: 'prep', yield_qty: 1, yield_unit: 'l', lines: [{ item_id: chicken.id, qty: 500, unit: 'g' }] })
  const soupR = await recipe({ name: 'Chicken soup', lines: [{ sub_recipe_id: stock.id, qty: 250, unit: 'ml' }] })
  const toastR = await recipe({ name: 'Butter toast', lines: [{ item_id: butter.id, qty: 20, unit: 'g' }] })
  const riceR = await recipe({ name: 'Saffron rice', lines: [{ item_id: saffron.id, qty: 0.1, unit: 'g' }, { item_id: rice.id, qty: 100, unit: 'g' }] })
  const m = await ok(owner.post('/api/menus', { name: 'Grill', slug: 'grill-pc' }))
  const full = await ok(owner.get('/api/menus/' + m.id))
  const dishRow = (name, price_pence) => ({ name, price_pence, is_orderable: true, variant_groups: [], variants: [] })
  await ok(owner.patch('/api/menus/' + m.id, { ...full, sections: [
    { title: 'Mains', items: [dishRow('Chicken platter', 1200), dishRow('Chicken soup', 600), dishRow('Butter toast', 400), dishRow('Saffron rice', 500)] },
  ] }))
  menu = await ok(owner.get('/api/menus/' + m.id))
  const dish = name => menu.sections[0].items.find(i => i.name === name).id
  platter = dish('Chicken platter'); soup = dish('Chicken soup'); toast = dish('Butter toast')
  const saffronRice = dish('Saffron rice')
  // A meal deal holding the platter: £20 (net £16.67), so the platter's £3 is 18%.
  const withDeal = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.patch('/api/menus/' + m.id, { ...withDeal, sections: [...withDeal.sections, { title: 'Deals', items: [{
    name: 'Platter deal', kind: 'combo', price_pence: 2000, is_orderable: true, variant_groups: [], variants: [],
    combo: { mode: 'manual', steps: [{ id: randomUUID(), name: 'Main', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: platter, price_pence: 0 }] }] },
  }] }] }))
  menu = await ok(owner.get('/api/menus/' + m.id))
  deal = menu.sections.find(s => s.title === 'Deals').items[0].id
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  for (const [d, r] of [[platter, platterR], [soup, soupR], [toast, toastR], [saffronRice, riceR]]) {
    await ok(owner.put(`/api/recipe-links/dishes/${d}/cell`, { recipe_id: r.id }))
  }
  saffron.dish = saffronRice
  // The rule: tell the owner when a dish at Soho goes over its cost target.
  rule = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Dishes over target at Soho', trigger: 'dish_over_target', conditions: {}, venue_id: soho, per_day: 20,
    action_tool: 'send_notice', action_input: { to: 'owner', title: '{dish} at {cost_pct}%' },
  } }))
  // The sweep has looked once: nothing over yet.
  const first = await sweepCostTargets(await getApp(), quiet, { tenantIds: [ids.a] })
  assert.equal(first.crossed, 0, JSON.stringify(first))
})
test.after(async () => { await closeApp() })

test('a quote edited: the platter crossed its target at both venues, named with what moved; the soup and toast did not', async () => {
  await ok(owner.patch('/api/inventory/quotes/' + chicken.quote.id, { price: 6.72 }))
  const rows = await alertsOf(platter)
  assert.deepEqual(rows.map(r => r.venue_id).sort(), [soho, leeds].sort(), 'a company price: every venue')
  const r = rows.find(x => x.venue_id === soho)
  assert.equal(r.old_cost_pct, 30)
  assert.equal(r.new_cost_pct, 33.6)
  assert.equal(r.old_band, 'good')
  assert.equal(r.new_band, 'watch')
  assert.equal(r.threshold_pct, 30, 'it crossed its target')
  assert.equal(r.source, 'manual')
  assert.equal(r.cause, 'Chicken thighs up 12%')
  assert.equal(r.changed_by, A.owner + '@test.local')
  assert.equal(r.causes[0].name, 'Chicken thighs')
  assert.ok(Math.abs(r.causes[0].effect - 0.36) < 1e-6, '+36p a serving')
  // The soup (16.8%), the toast and the deal (20.2%) didn't cross: no alerts.
  for (const d of [soup, toast, deal]) assert.equal((await alertsOf(d)).length, 0)
  // Kept by the sweep's own function, and the rule told once (after the answer went out).
  assert.equal((await stateOf(platter, soho))[0].band, 'watch')
  await waitFor(async () => (await firings(rule.id, platter)).length === 1, 'the rule')
  // The hourly sweep then finds nothing new: still once.
  const sweep = await sweepCostTargets(await getApp(), quiet, { tenantIds: [ids.a] })
  assert.equal(sweep.crossed, 0)
  await new Promise(r => setTimeout(r, 100))
  assert.deepEqual((await firings(rule.id, platter)).map(f => f.status), ['done'])
  // The price history keeps the pack with the price (migration 315).
  const hist = await ok(owner.get(`/api/inventory/quotes/${chicken.quote.id}/history`))
  assert.equal(hist[0].price, 6.72)
  assert.equal(hist[0].pack_base_qty, 1000)
})

test('only the dishes whose recipes use the changed items are worked out', async () => {
  const run = quoteIds => withTenant(ids.a, tx => priceCreep(tx, ids.a, { quoteIds, source: 'manual' }))
  const viaButter = await run([butter.quote.id])
  assert.deepEqual(viaButter.worked, [toast])
  const viaChicken = await run([chicken.quote.id])
  assert.deepEqual(viaChicken.worked.sort(), [platter, soup, deal].sort(), 'the soup through its stock, the deal holding the platter')
  assert.deepEqual(viaChicken.alerts, [], 'nothing changed in this transaction: no alert')
  assert.deepEqual((await run([])).worked, [])
})

test('a supplier price list by code: the platter crossed its limit, the rule told again', async () => {
  const dry = await ok(owner.post('/api/inventory/price-update', { supplier_id: sup.id, rows: [{ code: 'CHX-1', price: 7.2 }], dry_run: true }))
  assert.equal(dry.changes.length, 1)
  assert.equal((await alertsOf(platter)).length, 2, 'a dry run records nothing')
  await ok(owner.post('/api/inventory/price-update', { supplier_id: sup.id, rows: [{ code: 'CHX-1', price: 7.2 }] }))
  const r = (await alertsOf(platter, soho)).at(-1)
  assert.deepEqual([r.old_cost_pct, r.new_cost_pct, r.old_band, r.new_band, r.threshold_pct, r.source], [33.6, 36, 'watch', 'over', 35, 'price_update'])
  assert.equal(r.cause, 'Chicken thighs up 7.1%')
  await waitFor(async () => (await firings(rule.id, platter)).length === 2, 'the second crossing')
})

test('an inventory import: the toast crossed its limit; a dry run records nothing', async () => {
  const file = csv([IMPORT_HEAD, 'Butter,,g,,,Brakes,BUT-1,,Bag,1,1,kg,70,0,,,'])
  await ok(owner.post('/api/inventory/import', { file, dry_run: true }))
  assert.equal((await alertsOf(toast)).length, 0, 'rolled back, and no alert')
  await ok(owner.post('/api/inventory/import', { file }))
  const rows = await alertsOf(toast)
  assert.equal(rows.length, 2)
  assert.deepEqual([rows[0].source, rows[0].new_band, rows[0].cause], ['import', 'over', 'Butter up 775%'])
  await waitFor(async () => (await firings(rule.id, toast)).length === 1, 'the toast at Soho')
})

test('an invoice\'s prices applied at one venue: the soup crossed its target there only', async () => {
  const po = await ok(owner.post(`/api/purchasing/venues/${soho}/deliveries`, {
    supplier_id: sup.id, lines: [{ item_id: chicken.id, quote_id: chicken.quote.id, received_qty: 2, invoice_price: 13 }],
    check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
  const row = po.price_list.find(p => p.item_name === 'Chicken thighs')
  assert.ok(row, JSON.stringify(po.price_list))
  await ok(owner.post(`/api/purchasing/pos/${po.id}/price-list`, { changes: [{ line_id: row.line_id, action: 'venue' }] }))
  const rows = await alertsOf(soup)
  assert.deepEqual(rows.map(r => r.venue_id), [soho], 'Soho\'s own price: Soho only')
  // 500 g at £13 a kg makes a litre: 250 ml is £1.625 against £5 net.
  assert.deepEqual([rows[0].old_cost_pct, rows[0].new_cost_pct, rows[0].threshold_pct, rows[0].source, rows[0].po_id], [18, 32.5, 30, 'invoice', po.id])
  assert.match(rows[0].cause, /^Chicken thighs up 80.6%/)
  // The deal holding the platter: £6.50 against £16.67 net, over its limit at Soho (it was 21.6%).
  const d = await alertsOf(deal)
  assert.deepEqual(d.map(r => [r.venue_id, r.old_cost_pct, r.new_band]), [[soho, 21.6, 'over']])
})

test('the rule fires once whichever notices first: the sweep before the hook', async () => {
  // Saffron dearer outside any price route (no hook): the hourly sweep is first to see the saffron rice over its limit.
  await sql`UPDATE inv_quotes SET price = 30 WHERE id = ${saffron.quote.id}`
  await sql`INSERT INTO inv_price_history (tenant_id, quote_id, venue_id, price, pack_base_qty, changed_by, source)
            VALUES (${ids.a}, ${saffron.quote.id}, NULL, 30, 1, 'test', 'manual')`
  const sweep = await sweepCostTargets(await getApp(), quiet, { tenantIds: [ids.a] })
  assert.ok(sweep.crossed >= 1, JSON.stringify(sweep))
  assert.deepEqual((await firings(rule.id, saffron.dish)).map(f => f.status), ['done'])
  // Then a price edited through the route: the hook finds it kept (over already), so no alert and no second run.
  await ok(owner.patch('/api/inventory/quotes/' + saffron.quote.id, { price: 31 }))
  assert.equal((await stateOf(saffron.dish, soho))[0].cost_pct > 70, true)
  await new Promise(r => setTimeout(r, 200))
  assert.equal((await firings(rule.id, saffron.dish)).length, 1)
  assert.equal((await alertsOf(saffron.dish)).length, 0, 'it crossed outside a price change: no cost alert')
})

test('Today: the dishes over target card carries the alerts and opens them; marking them seen', async () => {
  const feed = await ok(owner.get(`/api/ops/today?venue_id=${soho}`))
  const task = feed.tasks.find(t => t.kind === 'dishes_over_target')
  assert.ok(task, JSON.stringify(feed.tasks.map(t => t.kind)))
  assert.equal(feed.tasks.filter(t => t.area === 'costing').length, 1, 'one card, not a second')
  const sum = await ok(owner.get(`/api/cost-alerts/summary?venue_id=${soho}`))
  assert.equal(sum.count, 5, JSON.stringify(sum))
  assert.equal(sum.dishes, 4, 'the platter twice, the toast, the soup and the deal')
  assert.match(sum.words, /^4 dishes crossed their cost target or limit since \d+ \w{3}: Chicken thighs up /)
  assert.ok(task.detail.endsWith(sum.words), task.detail)
  assert.equal(task.action.path, '/menu-margins?venue=' + soho + '&alerts=1')
  assert.ok(task.key.endsWith(':' + sum.newest_id), 'a new crossing brings the card back')
  assert.equal(sum.latest_id, sum.newest_id, 'all unseen: the newest is the latest')
  // Without Costing manage it can't be marked seen; with it, seen by that person for everyone.
  assert.equal((await operator.post('/api/cost-alerts/seen', { venue_id: soho })).status, 403)
  const seen = await ok(owner.post('/api/cost-alerts/seen', { venue_id: soho }))
  assert.equal(seen.seen, 5)
  assert.equal((await ok(owner.get(`/api/cost-alerts/summary?venue_id=${soho}`))).count, 0)
  const list = await ok(owner.get(`/api/cost-alerts?venue_id=${soho}`))
  assert.ok(list.alerts.every(a => a.seen_by === A.owner + '@test.local' && a.seen_at))
  assert.equal((await ok(owner.get(`/api/cost-alerts/summary?venue_id=${leeds}`))).count, 3, 'Leeds\'s (the platter twice, the toast) still to see')
  const after = (await ok(owner.get(`/api/ops/today?venue_id=${soho}`))).tasks.find(t => t.kind === 'dishes_over_target')
  assert.equal(after.action.path, '/menu-margins?venue=' + soho)
  assert.doesNotMatch(after.detail, /crossed/)
  assert.equal(after.key, task.key, 'marking them seen keeps the card\'s key: done or skipped stays so')
  // One alert by id.
  const leedsList = await ok(owner.get(`/api/cost-alerts?venue_id=${leeds}&unseen=1`))
  assert.equal((await ok(owner.post('/api/cost-alerts/seen', { ids: [leedsList.alerts[0].id] }))).seen, 1)
})

test('why_cost_changed: the platter\'s cost now against a day, from the price history', async () => {
  // The first chicken price (£6) a fortnight ago; the changes since are today's.
  await sql`UPDATE inv_quotes SET created_at = now() - interval '14 days' WHERE id = ${chicken.quote.id}`
  await sql`UPDATE inv_price_history SET changed_at = now() - interval '14 days' WHERE quote_id = ${chicken.quote.id} AND price = 6`
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const r = await ok(owner.get(`/api/cost-alerts/why?dish_id=${platter}&venue_id=${leeds}&since=${since}`))
  assert.equal(r.cost_then, 3)
  assert.equal(r.cost_now, 3.6)
  assert.equal(r.change_pct, 20)
  assert.equal(r.cost_pct_then, 30)
  assert.equal(r.cost_pct_now, 36)
  assert.deepEqual(r.items.map(m => [m.name, m.pct]), [['Chicken thighs', 20]])
  assert.equal(r.items[0].quote_after.supplier, 'Brakes', 'the owner sees purchasing prices')
  assert.equal(r.alerts.length, 2, 'Leeds\'s two crossings')
  // At Soho, its own invoice price: £6 to £13.
  const s = await ok(owner.get(`/api/cost-alerts/why?dish_id=${soup}&venue_id=${soho}&since=${since}`))
  assert.ok(Math.abs(s.change - 0.875) < 1e-6, String(s.change))
  // Pepper: names, never ids; the moves in words.
  const { tool, out } = await pepper(A.owner, 'why_cost_changed', { dish: 'chicken platter', venue: 'Leeds', since })
  assert.equal(tool.class, 'read')
  assert.equal(out.cost_then, '£3.00 a serving')
  assert.equal(out.cost_now, '£3.60 a serving')
  assert.match(out.moved[0], /^Chicken thighs: £6\.00 a kg to £7\.20 a kg \(up 20%\), \+£0\.60 a serving \(Brakes/)
  assert.equal(out.price_creep_alerts.length, 2)
  assert.doesNotMatch(JSON.stringify(out), UUID, 'no ids in what Pepper is given')
  // A day after today is refused; a dish not on a live menu is not found.
  assert.equal((await owner.get(`/api/cost-alerts/why?dish_id=${platter}&since=2999-01-01`)).status, 422)
  assert.equal((await owner.get(`/api/cost-alerts/why?dish_id=${randomUUID()}`)).status, 404)
})

test('the report: Dishes that crossed the cost limit', async () => {
  const r = await ok(owner.post('/api/reports/starter:dishes_crossed_cost_limit/run', {}), 'starter')
  const text = JSON.stringify(r)
  assert.match(text, /Chicken platter/)
  assert.match(text, /Butter toast/)
  assert.match(text, /Chicken thighs up 12%/)
  assert.equal((await operator.post('/api/reports/starter:dishes_crossed_cost_limit/run', {})).status, 403, 'Costing view')
})

test('another group\'s ids are refused, and its alerts never reach this group', async () => {
  const [a] = await sql`SELECT id FROM cost_alerts WHERE tenant_id = ${ids.a} AND seen_at IS NULL LIMIT 1`
  assert.ok([403, 404].includes((await bOwner.get(`/api/cost-alerts?venue_id=${soho}`)).status))
  assert.ok([403, 404].includes((await bOwner.get(`/api/cost-alerts/summary?venue_id=${soho}`)).status))
  assert.equal((await bOwner.post('/api/cost-alerts/seen', { ids: [a.id] })).status, 404)
  assert.ok([403, 404].includes((await bOwner.post('/api/cost-alerts/seen', { venue_id: soho })).status))
  const [still] = await sql`SELECT seen_at FROM cost_alerts WHERE id = ${a.id}`
  assert.equal(still.seen_at, null, 'their seen never marks ours')
  assert.equal((await bOwner.get(`/api/cost-alerts/why?dish_id=${platter}`)).status, 404)
  assert.ok([403, 404].includes((await owner.get(`/api/cost-alerts/why?dish_id=${platter}&venue_id=${bVenue}`)).status))
  const theirs = await ok(bOwner.get('/api/cost-alerts'))
  assert.deepEqual(theirs.alerts, [])
})

test('permissions: Costing view reads, Costing manage marks seen, supplier prices need purchasing prices', async () => {
  await asRole({ costing: 'none', recipes: 'view' }, async () => {
    assert.equal((await viewer.get('/api/cost-alerts')).status, 403)
    assert.equal((await viewer.get(`/api/cost-alerts/why?dish_id=${platter}`)).status, 403)
  })
  await asRole({ costing: 'view', purchasing_setup: 'none' }, async () => {
    const r = await ok(viewer.get(`/api/cost-alerts?venue_id=${leeds}`))
    assert.ok(r.alerts.length > 0)
    assert.equal(r.sees_prices, false)
    assert.ok(r.alerts.every(a => a.causes.every(c => c.quote_before === null && c.quote_after === null)), 'no supplier price')
    // Nor in the summary over them (its top item is a cause).
    assert.equal(r.summary.top.name, 'Chicken thighs')
    assert.equal(r.summary.top.quote_before, undefined)
    assert.equal(r.summary.top.quote_after, undefined)
    assert.doesNotMatch(JSON.stringify(r.summary), /Brakes/, 'no supplier in the summary')
    assert.equal((await viewer.post('/api/cost-alerts/seen', {})).status, 403)
  })
  await asRole({ costing: 'view', purchasing_setup: 'view' }, async () => {
    const r = await ok(viewer.get(`/api/cost-alerts?venue_id=${leeds}`))
    assert.equal(r.alerts[0].causes[0].quote_after.supplier, 'Brakes')
  })
})

test('a "choose a main" deal: two price changes at once keep its crossing, named by the dish at its dearest picks', async () => {
  // Toast is the step's first choice, the platter its dearest. £15 (£12.50 net): at Leeds the platter's £3.60 is
  // 28.8% (on target), the toast's £1.40 (butter £70 a kg) 11.2%.
  const full = await ok(owner.get('/api/menus/' + menu.id))
  const sections = full.sections.map(s => (s.title !== 'Deals' ? s : { ...s, items: [...s.items, {
    name: 'Choose a main', kind: 'combo', price_pence: 1500, is_orderable: true, variant_groups: [], variants: [],
    combo: { mode: 'manual', steps: [{ id: randomUUID(), name: 'Main', min: 1, max: 1, options: [
      { id: randomUUID(), type: 'item', item_id: toast, price_pence: 0 }, { id: randomUUID(), type: 'item', item_id: platter, price_pence: 0 },
    ] }] },
  }] }))
  await ok(owner.patch('/api/menus/' + menu.id, { ...full, sections }))
  const choose = (await ok(owner.get('/api/menus/' + menu.id))).sections.find(s => s.title === 'Deals').items.find(i => i.name === 'Choose a main').id
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  assert.equal((await stateOf(choose, leeds)).length, 0, 'on target at Leeds')

  // Two price changes at once: chicken £7.20 to £8 takes the deal over its target (32%) and keeps it so; butter
  // £70 to £60 starts while the first still holds the lock, and must cost the deal at the new chicken price, not
  // clear the crossing the first one kept.
  const change = (tx, quoteId, price) => tx`
    WITH q AS (UPDATE inv_quotes SET price = ${price} WHERE id = ${quoteId} RETURNING id, pack_base_qty)
    INSERT INTO inv_price_history (tenant_id, quote_id, venue_id, price, pack_base_qty, changed_by, source)
    SELECT ${ids.a}, q.id, NULL, ${price}, q.pack_base_qty, 'test', 'manual' FROM q`
  let release
  const gate = new Promise(r => { release = r })
  let holding = false
  const first = withTenant(ids.a, async tx => {
    await change(tx, chicken.quote.id, 8)
    const r = await priceCreep(tx, ids.a, { quoteIds: [chicken.quote.id], source: 'manual', by: 'first' })
    holding = true
    await gate
    return r
  })
  let second
  try {
    await waitFor(async () => holding, 'the first change to hold the lock')
    second = withTenant(ids.a, async tx => {
      await change(tx, butter.quote.id, 60)
      return priceCreep(tx, ids.a, { quoteIds: [butter.quote.id], source: 'manual', by: 'second' })
    })
    await waitFor(async () => (await sql`
      SELECT count(*)::int AS n FROM pg_locks
       WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`)[0].n > 0,
    'the second change to wait for the lock')
  } finally {
    release()
  }
  const [r1, r2] = await Promise.all([first, second])
  assert.ok(r1.alerts.some(a => a.dish_id === choose && a.venue_id === leeds), JSON.stringify(r1.alerts.map(a => a.name)))
  assert.ok(r2.worked.includes(choose), 'the deal holds the toast')
  assert.equal((await stateOf(choose, leeds))[0]?.band, 'watch', 'the second change kept the crossing')
  const sweep = await sweepCostTargets(await getApp(), quiet, { tenantIds: [ids.a] })
  assert.equal(sweep.crossed, 0, 'so the sweep finds nothing new: it fires once')

  // The alert names what moved in the platter (the picks it crossed at), not the toast it would take first.
  const [alert] = await alertsOf(choose, leeds)
  assert.deepEqual([alert.old_cost_pct, alert.new_cost_pct, alert.threshold_pct, alert.cause], [28.8, 32, 30, 'Chicken thighs up 11.1%'])
  assert.equal(alert.causes[0].name, 'Chicken thighs')

  // why_cost_changed: its cost, what moved and its cost % all at the platter. A week ago chicken was £6 and the
  // butter had no price yet (its price is today's), so the toast couldn't be costed then.
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const w = await ok(owner.get(`/api/cost-alerts/why?dish_id=${choose}&venue_id=${leeds}&since=${since}`))
  assert.deepEqual([w.cost_then, w.cost_now, w.cost_pct_then, w.cost_pct_now], [3, 4, 24, 32])
  assert.deepEqual(w.picks_then, ['Chicken platter'])
  assert.deepEqual(w.picks_now, ['Chicken platter'])
  assert.deepEqual(w.items.map(m => [m.name, m.pct]), [['Chicken thighs', 33.3]])
  const { out } = await pepper(A.owner, 'why_cost_changed', { dish: 'choose a main', venue: 'Leeds', since })
  assert.equal(out.deal_picks, 'Costed at the picks with its highest cost %: Chicken platter')
  assert.match(out.moved[0], /^Chicken thighs: £6\.00 a kg to £8\.00 a kg \(up 33\.3%\)/)
  assert.doesNotMatch(JSON.stringify(out), UUID)
})
