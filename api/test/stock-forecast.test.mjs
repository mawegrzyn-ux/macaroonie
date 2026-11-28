// The forecast and the suggested order (inventory phase 9a, migrations 319
// and 320, 27 Nov 2026; docs/INVENTORY.md 9): a supplier's suggestion at a
// venue (the stock route Pepper reads) and the order form's Suggest (kept
// on each line beside what is then ordered). The forecast is the same
// weekday over four weeks of usage from sales, scaled by covers booked
// against the usual by the same point; an item sales never used falls back
// to its par; the suggestion is the forecast to the delivery after next plus
// the buffer, less on hand and on order (only what arrives before then), in
// packs up to the price's minimum. Also: the buffer setting, what was
// suggested against what was ordered in the report, Pepper's
// suggested_order (names, never ids), permissions (Stock view for anything
// that reads on hand), and other groups' orders, suppliers, items and
// venues refused.
//
// Nothing here depends on the day of the week or the hour: the history is
// written relative to the trading day the API says it is (the till's day
// start, 04:00 here), and every expected figure is worked out from the days
// the route says its window holds.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { weekdayOf, addDays, fitQty } = await import('../../shared/procurement.js')
const { historyDays, coversFactor } = await import('../../shared/forecast.js')

let ids, owner, viewer, bOwner, soho, bVenue, brakes, fresh, bSupplier, chicken, rice, oil, lemons, bItem, list, today
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
// Chicken in grams: 10 kg x (the weekday + 1) on each day worked out, so each weekday has its own figure.
const usual = day => 10000 * (weekdayOf(day) + 1)
const USED_TODAY = 2000
const near = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 0.01, (msg || '') + ': ' + a + ' is not ' + b)

async function item(name, base_unit, supplier, pack, extra = {}) {
  const i = await ok(owner.post('/api/inventory/items', { name, base_unit }))
  const q = (await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: supplier.id, pack_name: pack.name, pack_count: 1, pack_qty: pack.qty, pack_unit: pack.unit, price: 10, ...extra }))).quotes[0]
  return { ...i, quote: q }
}

/** A placed purchase order for chicken from Brakes, arriving on `day`. */
async function placed(day, qty) {
  const o = await ok(owner.post('/api/purchasing/orders', { venue_id: soho }))
  await ok(owner.put(`/api/purchasing/orders/${o.id}/lines`, { lines: [{ item_id: chicken.id, qty, quote_id: chicken.quote.id }] }))
  await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, { suppliers: { [brakes.id]: { delivery_date: day } } }), 'placed for ' + day)
}

async function pepper(sub, name, input) {
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
  return { tool, out: await tool.run(ctx, parseInput(tool, input)) }
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-forecast', timezone: 'Europe/London', currency: 'GBP' }))).id
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-forecast', timezone: 'Europe/London' }))).id
  // Brakes delivers any day with a day's notice and no cutoff; Fresh Co sells the lemons.
  brakes = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print', lead_days: 1, delivery_days: [] }))
  fresh = await ok(owner.post('/api/suppliers', { name: 'Fresh Co', send_method: 'print', lead_days: 1, delivery_days: [] }))
  bSupplier = await ok(bOwner.post('/api/suppliers', { name: 'Their supplier', send_method: 'print' }))
  bItem = await ok(bOwner.post('/api/inventory/items', { name: 'Their flour', base_unit: 'g' }))
  chicken = await item('Chicken thighs', 'g', brakes, { name: 'Case', qty: 5, unit: 'kg' })
  rice = await item('Jasmine rice', 'g', brakes, { name: 'Bag', qty: 5, unit: 'kg' }, { min_qty: 4 })
  oil = await item('Rapeseed oil', 'ml', brakes, { name: 'Tin', qty: 5, unit: 'l' })
  lemons = await item('Lemons', 'each', fresh, { name: 'Box', qty: 50, unit: 'each' })
  list = await ok(owner.post('/api/purchasing/lists', { name: 'Kitchen', venue_ids: [soho], item_ids: [chicken.id, rice.id, oil.id, lemons.id] }))
  await ok(owner.put(`/api/purchasing/lists/${list.id}/pars`, { pars: [
    { item_id: chicken.id, venue_id: soho, par_base: 20000 }, { item_id: rice.id, venue_id: soho, par_base: 12000 },
  ] }))
  // The trading day as the API has it, then four weeks of usage from sales before it (each day worked
  // out: its mark) and what sales took off today so far.
  today = (await ok(owner.get(`/api/stock/venues/${soho}/usage`))).today
  for (const d of historyDays(today)) {
    await sql`INSERT INTO stock_usage_marks (tenant_id, venue_id, day, fingerprint, lines) VALUES (${ids.a}, ${soho}, ${d}::date, '{}', 1)`
    await sql`INSERT INTO stock_usage_days (tenant_id, venue_id, day, item_id, qty_base, at)
              VALUES (${ids.a}, ${soho}, ${d}::date, ${chicken.id}, ${usual(d)}, ${d + 'T12:00:00Z'})`
  }
  // Counted 5 kg now, then today's sales took 2 kg off: 3 kg on hand.
  await ok(owner.post(`/api/stock/venues/${soho}/counts`, { lines: [{ item_id: chicken.id, qty: 5, unit: 'kg' }], note: 'spot check' }))
  await sql`INSERT INTO stock_usage_days (tenant_id, venue_id, day, item_id, qty_base, at)
            VALUES (${ids.a}, ${soho}, ${today}::date, ${chicken.id}, ${USED_TODAY}, now() + interval '1 second')`
})
test.after(async () => { await closeApp() })

/** What the chicken line should be for a suggestion: the window's days, today's rest, the buffer, on hand and on order. */
function expectChicken(s, { onOrder = 0, buffer = 10, factor = {} } = {}) {
  const total = s.window.days.reduce((n, d) => {
    const qty = usual(d) * (factor[d] ?? 1)
    return n + (d === today ? Math.max(0, qty - USED_TODAY) : qty)
  }, 0)
  const target = total * (1 + buffer / 100)
  const need = target - 3000 - onOrder
  return { total, need, packs: need > 0 ? fitQty(Math.ceil(need / 5000 - 1e-9), chicken.quote) : 0 }
}

test('a supplier\'s suggestion at a venue: the forecast to the delivery after next, the buffer, on hand and on order', async () => {
  const s = await ok(owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`))
  assert.equal(s.today, today)
  assert.equal(s.buffer_pct, 10, 'the buffer is 10% unless the group says otherwise')
  assert.equal(s.after, addDays(s.next_delivery, 1), 'Brakes delivers any day: the delivery after next is the day after the next')
  assert.equal(s.window.days[0], today)
  assert.equal(s.window.days.at(-1), addDays(s.after, -1), 'the window runs up to the day before the delivery after next')
  assert.deepEqual(s.lines.map(l => l.name).sort(), ['Chicken thighs', 'Jasmine rice', 'Rapeseed oil'], 'Brakes\' items on the venue\'s lists; the lemons are Fresh Co\'s')
  const c = s.lines.find(l => l.item_id === chicken.id)
  const want = expectChicken(s)
  assert.equal(c.basis, 'forecast')
  near(c.forecast_base, want.total, 'each weekday\'s usual, today less what sales took so far')
  assert.equal(c.on_hand, 3000)
  assert.equal(c.on_order, 0)
  assert.equal(c.qty, want.packs)
  assert.equal(c.suggested_base, want.packs * 5000)
  const todayRow = c.days.find(d => d.day === today)
  assert.deepEqual([todayRow.used, todayRow.rest], [USED_TODAY, Math.max(0, usual(today) - USED_TODAY)])
  assert.ok(c.words.some(w => w.startsWith('Forecast ')), 'the working in words')
  assert.match(c.summary, /forecast to .+\(\w+days use [\d.]+ kg\)/)
  // No sales use in four weeks: up to par, raised to the bag's minimum of 4.
  const r = s.lines.find(l => l.item_id === rice.id)
  assert.equal(r.basis, 'par')
  assert.equal(r.on_hand, null, 'never counted here')
  assert.equal(r.qty, 4, '12 kg is 3 bags of 5 kg, the minimum is 4')
  assert.deepEqual(r.raised, { kind: 'min', value: 4 })
  // No history and no par: nothing suggested.
  const o = s.lines.find(l => l.item_id === oil.id)
  assert.deepEqual([o.basis, o.qty], ['none', null])
  assert.ok(!JSON.stringify(s).includes('price'), 'no prices in a suggestion')
})

test('on order counts only what arrives before the delivery after next; the buffer is the group\'s', async () => {
  const before = await ok(owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`))
  await placed(before.next_delivery, 1)
  await placed(before.after, 3)
  const s = await ok(owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`))
  const c = s.lines.find(l => l.item_id === chicken.id)
  assert.equal(c.on_order, 5000, 'the case arriving on the next delivery; the three on the delivery after next don\'t count')
  assert.equal(c.qty, expectChicken(s, { onOrder: 5000 }).packs)
  // The buffer: Stock manage saves it on its own; Stock view reads it.
  assert.equal((await viewer.put('/api/stock/forecast-settings', { buffer_pct: 25 })).status, 403)
  assert.equal((await owner.put('/api/stock/forecast-settings', { buffer_pct: 500 })).status, 400)
  assert.deepEqual(await ok(owner.put('/api/stock/forecast-settings', { buffer_pct: 25 })), { buffer_pct: 25 })
  assert.equal((await ok(viewer.get('/api/stock/forecast-settings'))).buffer_pct, 25)
  assert.equal((await ok(owner.get('/api/stock/meta'))).settings.buffer_pct, 25)
  const s25 = await ok(owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`))
  assert.equal(s25.buffer_pct, 25)
  assert.equal(s25.lines.find(l => l.item_id === chicken.id).qty, expectChicken(s25, { onOrder: 5000, buffer: 25 }).packs)
  await ok(owner.put('/api/stock/forecast-settings', { buffer_pct: 10 }))
  // A later delivery day: the window runs to the delivery after it.
  const later = addDays(s.next_delivery, 3)
  const sl = await ok(owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}&delivery_date=${later}`))
  assert.deepEqual([sl.next_delivery, sl.after], [later, addDays(later, 1)])
  assert.equal(sl.lines.find(l => l.item_id === chicken.id).on_order, 5000 + 15000, 'everything placed arrives before then')
  assert.equal((await owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}&delivery_date=${addDays(today, -1)}`)).status, 422)
})

test('covers booked scale a day by what was booked as far ahead on the same weekdays before', async () => {
  const s0 = await ok(owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`))
  const day = s0.window.days.find(d => d !== today) || s0.window.days[0]
  const [table] = await sql`INSERT INTO tables (venue_id, tenant_id, label, max_covers) VALUES (${soho}, ${ids.a}, 'T1', 80) RETURNING id`
  const book = (d, covers, createdAt, n) => sql`
    INSERT INTO bookings (venue_id, table_id, tenant_id, starts_at, ends_at, covers, guest_name, guest_email, status, created_at)
    VALUES (${soho}, ${table.id}, ${ids.a}, ${d + 'T12:0' + n + ':00Z'}, ${d + 'T13:0' + n + ':00Z'}, ${covers}, 'Guest', 'guest@test.local', 'confirmed', ${createdAt})`
  const daysAgo = n => new Date(Date.now() - n * 86400000)
  // 60 covers booked for the day now; 40 had been booked as far ahead on each of the four weekdays before it.
  await book(day, 60, daysAgo(1), 1)
  for (let k = 1; k <= 4; k++) {
    await book(addDays(day, -7 * k), 40, daysAgo(7 * k + 20), 1)
    // Booked later than that point before: the day ended busier, but it doesn't count.
    await book(addDays(day, -7 * k), 30, daysAgo(7 * k - 1), 2)
  }
  // A cancelled booking never counts.
  await sql`INSERT INTO bookings (venue_id, table_id, tenant_id, starts_at, ends_at, covers, guest_name, guest_email, status, created_at)
            VALUES (${soho}, ${table.id}, ${ids.a}, ${day + 'T12:05:00Z'}, ${day + 'T13:05:00Z'}, 50, 'Gone', 'gone@test.local', 'cancelled', ${daysAgo(2)})`
  const s = await ok(owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`))
  const f = coversFactor({ booked: 60, usual: 40 })
  assert.equal(f.factor, 1.5)
  const cover = s.covers.find(c => c.day === day)
  assert.deepEqual([cover.pct, cover.words], [50, '50% more covers booked'])
  const c = s.lines.find(l => l.item_id === chicken.id)
  const row = c.days.find(d => d.day === day)
  near(row.qty, usual(day) * 1.5, 'the weekday\'s usual scaled by covers')
  assert.equal(row.covers_pct, 50)
  assert.ok(c.words.some(w => w.includes('50% more covers booked')))
  assert.equal(c.qty, expectChicken(s, { onOrder: 5000, factor: { [day]: 1.5 } }).packs)
  assert.ok(!JSON.stringify(s.covers).match(/\b60\b|\b40\b/), 'covers are a share, never the bookings themselves')
  await sql`DELETE FROM bookings WHERE venue_id = ${soho}`
})

let order
test('the order form\'s Suggest: one supplier\'s lines, kept on each line beside what is then ordered', async () => {
  order = await ok(owner.post('/api/purchasing/orders', { venue_id: soho, list_id: list.id }))
  const r = await ok(owner.post(`/api/purchasing/orders/${order.id}/suggest`, { supplier_id: brakes.id }))
  assert.equal(r.order_id, order.id)
  const c = r.lines.find(l => l.item_id === chicken.id)
  assert.equal(c.qty, expectChicken(r, { onOrder: 5000 }).packs, 'the same figure as the stock route')
  assert.equal(c.current_qty, 0)
  assert.equal(c.kept, true)
  assert.equal(r.lines.find(l => l.item_id === oil.id).kept, false, 'nothing suggested, nothing kept')
  assert.ok(!r.lines.some(l => l.item_id === lemons.id), 'Fresh Co\'s lemons are another supplier\'s Suggest')
  // Kept on the line, its quantity untouched until the person says OK (or types over it).
  const form = await ok(owner.get(`/api/purchasing/orders/${order.id}`))
  const fc = form.items.find(i => i.item_id === chicken.id)
  assert.equal(fc.qty, 0)
  assert.deepEqual([fc.suggestion.qty, fc.suggestion.basis, fc.suggestion.after], [c.qty, 'forecast', r.after])
  assert.match(fc.suggestion.summary, /needed/)
  assert.equal(form.items.find(i => i.item_id === oil.id).suggestion, undefined)
  const [row] = await sql`SELECT * FROM supply_order_lines WHERE order_id = ${order.id} AND item_id = ${chicken.id}`
  assert.equal(Number(row.suggested_qty), c.qty)
  assert.equal(row.suggestion_quote_id, chicken.quote.id)
  assert.equal(row.quote_id, null, 'a line Suggest made isn\'t pinned to a price: only a quantity is')
  assert.equal(row.window_from.toISOString().slice(0, 10), today)
  assert.equal(row.suggested_by, A.owner + '@test.local')
  // One line only (the row's own Suggest), and Suggest again replaces what was kept.
  const one = await ok(owner.post(`/api/purchasing/orders/${order.id}/suggest`, { supplier_id: brakes.id, item_ids: [rice.id] }))
  assert.deepEqual(one.lines.map(l => l.item_id), [rice.id])
  assert.equal((await owner.post(`/api/purchasing/orders/${order.id}/suggest`, { supplier_id: brakes.id, item_ids: [lemons.id] })).status, 422, 'not Brakes\' line')
  // The person orders one case more than suggested and the rice as suggested; then it is placed.
  await ok(owner.put(`/api/purchasing/orders/${order.id}/lines`, { lines: [{ item_id: chicken.id, qty: c.qty + 1, quote_id: chicken.quote.id }, { item_id: rice.id, qty: 4, quote_id: rice.quote.id }] }))
  await ok(owner.post(`/api/purchasing/orders/${order.id}/submit`, { suppliers: { [brakes.id]: { delivery_date: r.next_delivery, existing: 'separate' } } }))
  const kept = await sql`SELECT item_id, qty::float8 AS qty, suggested_qty::float8 AS suggested FROM supply_order_lines WHERE order_id = ${order.id} AND suggested_at IS NOT NULL ORDER BY item_id`
  assert.deepEqual(Object.fromEntries(kept.map(k => [k.item_id, [k.suggested, k.qty]])), { [chicken.id]: [c.qty, c.qty + 1], [rice.id]: [4, 4] })
  // A placed order can't be suggested for any more.
  assert.equal((await owner.post(`/api/purchasing/orders/${order.id}/suggest`, { supplier_id: brakes.id })).status, 409)
})

test('permissions: Suggest needs the right to change the order and Stock view; the stock route Stock view and ordering view', async () => {
  const draft = await ok(owner.post('/api/purchasing/orders', { venue_id: soho, list_id: list.id }))
  assert.equal((await viewer.post(`/api/purchasing/orders/${draft.id}/suggest`, { supplier_id: brakes.id })).status, 403, 'a viewer can\'t change orders')
  const role = await ok(owner.post('/api/access/roles', { key: 'fcbuyer', label: 'Buyer', permissions: { purchasing: 'manage', stock: 'none' } }))
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, 'fc-buyer@test.local', 'viewer', 'a-fc-buyer', ${role.id})`
  const buyer = as('a-fc-buyer', ids.a)
  const no = await buyer.post(`/api/purchasing/orders/${draft.id}/suggest`, { supplier_id: brakes.id })
  assert.equal(no.status, 403)
  assert.match(no.json.error, /Stock view/)
  await ok(owner.post(`/api/purchasing/orders/${draft.id}/suggest`, { supplier_id: brakes.id }))
  const seen = await ok(buyer.get(`/api/purchasing/orders/${draft.id}`))
  assert.ok(seen.items.every(i => i.suggestion === undefined), 'a suggestion tells what is on hand: not without Stock view')
  assert.equal((await buyer.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`)).status, 403)
  const stockOnly = await ok(owner.post('/api/access/roles', { key: 'fcstock', label: 'Stock only', permissions: { stock: 'view', purchasing: 'none', purchasing_setup: 'none', purchasing_approve: 'none' } }))
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, 'fc-stock@test.local', 'viewer', 'a-fc-stock', ${stockOnly.id})`
  assert.equal((await as('a-fc-stock', ids.a).get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`)).status, 403, 'ordering view too')
  await ok(viewer.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`))
})

test('the report: suggested against ordered, and once its dates have passed, what was really used against the forecast', async () => {
  const period = { params: [{ key: 'period', type: 'period', default: { relative: 'last_n_days', n: 60 } }], filters: [{ field: 'date', op: 'in_period', param: 'period' }] }
  const rows = async () => {
    const r = await ok(owner.post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.suggestions', rows: ['item_name', 'supplier', 'basis', 'suggested', 'ordered', 'order_status', 'as_suggested', 'forecast', 'actual'], ...period }, fresh: true }))
    const keys = r.columns.map(c => c.key)
    return r.rows.map(row => Object.fromEntries(keys.map((k, i) => [k, Array.isArray(row) ? row[i] : (row.cells ? row.cells[i] : row[k])])))
  }
  const placedRows = (await rows()).filter(x => x.order_status === 'Placed' || x.order_status === 'submitted')
  const chickenRow = placedRows.find(x => x.item_name === 'Chicken thighs')
  const riceRow = placedRows.find(x => x.item_name === 'Jasmine rice')
  assert.ok(chickenRow && riceRow, 'both placed lines: ' + JSON.stringify(placedRows))
  assert.equal(Number(chickenRow.ordered), Number(chickenRow.suggested) + 1, 'one case more than suggested')
  assert.ok([false, 'No', 'no'].includes(chickenRow.as_suggested))
  assert.ok([true, 'Yes', 'yes'].includes(riceRow.as_suggested))
  assert.equal(chickenRow.supplier, 'Brakes')
  assert.equal(chickenRow.actual ?? null, null, 'its dates haven\'t passed: nothing to judge the forecast by yet')
  // The chicken's suggestion moved back to two days that have been worked out: what sales took over them is its actual.
  const d1 = addDays(today, -10)
  await sql`UPDATE supply_order_lines SET window_from = ${d1}::date, window_to = ${addDays(d1, 2)}::date, forecast_base = ${usual(d1)},
              suggestion = jsonb_set(suggestion, '{days,0,used}', '0'::jsonb)
             WHERE order_id = ${order.id} AND item_id = ${chicken.id}`
  const moved = (await rows()).find(x => x.item_name === 'Chicken thighs' && x.forecast != null && Number(x.forecast) === usual(d1))
  near(Number(moved.actual), usual(d1) + usual(addDays(d1, 1)), 'what sales took over the two days')
  const sum = await ok(owner.post('/api/reports/preview', { spec: { subject: 'stock.suggestions', rows: ['supplier'], values: [{ measure: 'placed' }, { measure: 'placed_as_suggested' }, { measure: 'as_suggested_share' }, { measure: 'forecast_ratio' }], ...period }, fresh: true }))
  assert.ok(sum.rows.length >= 1)
  await ok(owner.post('/api/reports/starter:stock_suggested_orders_how_good/run', {}), 'the starter')
  // Stock view is the subject's module: a role without it can't report on suggestions.
  const noStock = await as('a-fc-buyer', ids.a).post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.suggestions', rows: ['item_name'], ...period } })
  assert.ok(noStock.status >= 400, 'needs Stock view: ' + noStock.status)
})

test('another group\'s orders, suppliers, items and venues are refused', async () => {
  const draft = await ok(owner.post('/api/purchasing/orders', { venue_id: soho, list_id: list.id }))
  const theirs = await ok(bOwner.post('/api/purchasing/orders', { venue_id: bVenue }))
  assert.equal((await bOwner.post(`/api/purchasing/orders/${draft.id}/suggest`, { supplier_id: bSupplier.id })).status, 404, 'A\'s order')
  assert.equal((await bOwner.post(`/api/purchasing/orders/${theirs.id}/suggest`, { supplier_id: brakes.id })).status, 404, 'A\'s supplier on B\'s order')
  assert.equal((await owner.post(`/api/purchasing/orders/${draft.id}/suggest`, { supplier_id: brakes.id, item_ids: [bItem.id] })).status, 404, 'B\'s item as a line')
  assert.equal((await owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${bSupplier.id}`)).status, 404, 'B\'s supplier')
  const away = await bOwner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${bSupplier.id}`)
  assert.ok([403, 404].includes(away.status), 'A\'s venue: ' + away.status)
  const [kept] = await sql`SELECT count(*)::int AS n FROM supply_order_lines WHERE tenant_id = ${ids.b} AND suggested_at IS NOT NULL`
  assert.equal(kept.n, 0, 'nothing kept for B')
})

test('Pepper\'s suggested_order: the supplier\'s suggestion with the working, by names, never ids', async () => {
  const { tool, out } = await pepper(A.owner, 'suggested_order', { venue: 'Soho', supplier: 'brakes' })
  assert.equal(tool.class, 'read')
  assert.equal(out.supplier, 'Brakes')
  assert.equal(out.venue, 'Soho')
  const c = out.lines.find(l => l.item === 'Chicken thighs')
  const route = (await ok(owner.get(`/api/stock/venues/${soho}/suggested-order?supplier_id=${brakes.id}`))).lines.find(l => l.item_id === chicken.id)
  assert.equal(c.suggest, route.qty ? route.qty + ' x ' + route.pack_label : 'nothing: on hand and on order cover it', 'the route\'s figure')
  assert.equal(c.why, route.summary)
  assert.equal(out.lines.find(l => l.item === 'Jasmine rice').basis, 'Up to par')
  assert.ok(out.not_suggested.some(n => n.item === 'Rapeseed oil'))
  assert.ok(!UUID.test(JSON.stringify(out)), 'no ids for the model')
  const buyer = await pepper('a-fc-buyer', 'suggested_order', { venue: 'Soho', supplier: 'Brakes' }).catch(e => e)
  assert.match(String(buyer.message || buyer), /stock/i, 'Stock view needed')
})
