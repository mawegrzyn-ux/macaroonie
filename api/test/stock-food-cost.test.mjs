// Food cost beyond one stock period (inventory phase 6b, migration 313, 27
// Nov 2026): Cash Recon's week line (theoretical from the week's sales,
// actual only from a stock period: the one covering the week, else the latest
// closed one, named; never one made up for the week), the dashboard widgets'
// figures against the shared rules (food cost, waste by reason, top variance
// items, margin by menu) and the Overview's stock tile; Today's dishes over
// their cost target and Home's set-up gaps (on Home for whoever manages each
// gap's module); the three rule triggers (a dish over its cost target, with a
// % of its own as the dish passes it; a period closed over the band; waste
// logged over a value), each firing once and not again for the same event, with costs left
// out of a notice for people who can't see them; make_rule offering them;
// another group's ids refused; Costing view, till reports view and Stock view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, sql, getApp, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const usage = await import('../src/services/stockUsageSvc.js')
const { sweepCostTargets } = await import('../src/services/stockFoodCostSvc.js')
const { fireRules } = await import('../src/ai/ruleRunner.js')
const { pushSenders } = await import('../src/services/notices.js')
const { makeContext } = await import('../src/ai/context.js')
const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
const { ANSWER_SCHEMA } = await import('../src/services/rules.js')
const { setupRule } = await import('../src/services/suggestions.js')
const { daysFoodCost, marginsByMenu, overTarget } = await import('../../shared/foodCost.js')
const { MONEY_HIDDEN } = await import('../../shared/rules.js')
const { costShare } = await import('../../shared/costing.js')

let ids, owner, operator, viewer, bOwner, soho, leeds, bVenue
let chicken, rice, menu, bowl, wrap, platter, today, monday, p1, wasteRule, varianceRule, net
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const sent = []
const PUSH_KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' }
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const mondayOf = d => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7))
const firings = ruleId => sql`SELECT status, event_key, result FROM pepper_rule_firings WHERE rule_id = ${ruleId} ORDER BY fired_at, id`
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
    VALUES (${ids.a}, ${'fc_' + randomUUID().slice(0, 8)}, 'Food cost', ${sql.json(permissions)}, false) RETURNING id`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  try {
    return await fn()
  } finally {
    await sql`UPDATE users SET custom_role_id = NULL WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  }
}

async function makeMenu(who, name, sections) {
  const m = await ok(who.post('/api/menus', { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 6) }))
  const full = await ok(who.get('/api/menus/' + m.id))
  await ok(who.patch('/api/menus/' + m.id, { ...full, sections }), 'menu ' + name)
  return ok(who.get('/api/menus/' + m.id))
}

/** A closed till check today at a venue: lines [{ item_id, name, qty, net }]. */
async function tillCheck(venueId, lines) {
  const [d] = await sql`
    INSERT INTO pos_days (tenant_id, venue_id, business_date, opened_at, closed_at, is_generated)
    VALUES (${ids.a}, ${venueId}, ${today}::date, now() - interval '3 hours', now(), false) RETURNING id`
  const id = 'c-' + randomUUID()
  const withIds = lines.map(l => ({ ...l, id: 'l-' + randomUUID() }))
  const state = { id, lines: withIds.map(l => ({ id: l.id, item_id: l.item_id, name: l.name, qty: l.qty, modifiers: [], combo: null })) }
  await sql`
    INSERT INTO pos_checks (id, tenant_id, venue_id, day_id, mode, status, opened_at, closed_at, subtotal, total, state, last_seq, is_generated)
    VALUES (${id}, ${ids.a}, ${venueId}, ${d.id}, 'counter', 'closed', now() - interval '1 hour', now(), 0, 0, ${sql.json(state)}, 1, false)`
  for (const l of withIds) {
    await sql`
      INSERT INTO pos_check_lines (id, tenant_id, venue_id, check_id, day_id, item_id, name, qty, gross, net, vat, status)
      VALUES (${l.id}, ${ids.a}, ${venueId}, ${id}, ${d.id}, ${l.item_id}, ${l.name}, ${l.qty}, ${Math.round(l.net * 1.2)}, ${l.net}, ${Math.round(l.net * 0.2)}, 'sent')`
  }
}

async function fullCount(venueId, lines, { at = null } = {}) {
  const c = await ok(owner.post(`/api/stock/venues/${venueId}/counts`, { kind: 'full', ...(at ? { counted_at: at } : {}) }))
  for (const l of lines) await ok(owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: l.item.id, area_id: null, entries: [{ qty: l.qty, unit: l.unit }] }))
  await ok(owner.post(`/api/stock/counts/${c.id}/submit`, { all_zero: true }))
  return ok(owner.post(`/api/stock/counts/${c.id}/approve`, {}))
}

/** The week's sold rows as the week line reads them (dish_cost_days), for the shared rule. */
const weekRows = (venueId, start) => sql`
  SELECT day::text AS day, item_type, left_out, net_pence::float8 AS net_pence, cost::float8 AS cost, qty::float8 AS qty, uncosted_qty::float8 AS uncosted_qty
    FROM dish_cost_days WHERE tenant_id = ${ids.a} AND venue_id = ${venueId} AND day BETWEEN ${start}::date AND ${addDays(start, 6)}::date`

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-fc', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-fc', timezone: 'Europe/London', currency: 'GBP' }))).id
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-fc', timezone: 'Europe/London' }))).id
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
  const sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  const item = async (name, price) => {
    const i = await ok(owner.post('/api/inventory/items', { name, base_unit: 'g' }))
    if (price == null) return i
    const q = (await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: sup.id, pack_name: 'Bag', pack_count: 1, pack_qty: 1, pack_unit: 'kg', price }))).quotes[0]
    return { ...i, quote: q }
  }
  // Chicken £6 a kg, rice £2 a kg. A bowl is 200 g chicken and 100 g rice (£1.40 against £12: well under
  // target); a platter is 500 g of chicken (£3.00 against £5: over the limit). The wrap has no recipe.
  chicken = await item('Chicken thighs', 6)
  rice = await item('Basmati rice', 2)
  const paprika = await item('Smoked paprika', null)
  const bowlR = await ok(owner.post('/api/recipes', { name: 'Chicken bowl', kind: 'dish', status: 'live', lines: [{ item_id: chicken.id, qty: 200, unit: 'g' }, { item_id: rice.id, qty: 100, unit: 'g' }] }))
  const platterR = await ok(owner.post('/api/recipes', { name: 'Chicken platter', kind: 'dish', status: 'live', lines: [{ item_id: chicken.id, qty: 500, unit: 'g' }] }))
  // A prep recipe using an item with no price: Home's "items in recipes with no price".
  await ok(owner.post('/api/recipes', { name: 'Spice mix', kind: 'prep', status: 'live', yield_qty: 100, yield_unit: 'g', lines: [{ item_id: paprika.id, qty: 100, unit: 'g' }] }))
  menu = await makeMenu(owner, 'Bowls', [{ title: 'Bowls', items: [
    { name: 'Chicken bowl', price_pence: 1200, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Chicken wrap', price_pence: 900, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Chicken platter', price_pence: 500, is_orderable: true, variant_groups: [], variants: [] },
  ] }])
  const dish = name => menu.sections[0].items.find(i => i.name === name).id
  bowl = dish('Chicken bowl')
  wrap = dish('Chicken wrap')
  platter = dish('Chicken platter')
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  await ok(owner.put(`/api/recipe-links/dishes/${bowl}/cell`, { recipe_id: bowlR.id }))
  await ok(owner.put(`/api/recipe-links/dishes/${platter}/cell`, { recipe_id: platterR.id }))
  ;({ today } = await usage.venueToday(sql, ids.a, soho))
  monday = mondayOf(today)
  await ok(owner.put('/api/stock/variance-settings', { band_pct: 1, item_pct: 3, item_pounds: 2 }))
  // Push notices go to a list here.
  const to = token => (typeof token === 'string' ? token : JSON.stringify(token))
  pushSenders.web = async (token, payload) => { sent.push({ ...payload, device: to(token) }); return { ok: true } }
  pushSenders.app = async (token, payload) => { sent.push({ ...payload, device: to(token) }); return { ok: true } }
  await ok(owner.post('/api/notices/devices', { kind: 'web', token: { endpoint: 'https://push.example.invalid/fc-owner', keys: PUSH_KEYS } }))
  await ok(operator.post('/api/notices/devices', { kind: 'web', token: { endpoint: 'https://push.example.invalid/fc-operator', keys: PUSH_KEYS } }))

  // The opening full count three days ago, a delivery, 400 g thrown away, the till's sales, worked out.
  await fullCount(soho, [{ item: chicken, qty: 5, unit: 'kg' }, { item: rice, qty: 3, unit: 'kg' }], { at: new Date(Date.now() - 3 * 86400000).toISOString() })
  await ok(owner.post(`/api/purchasing/venues/${soho}/deliveries`, {
    supplier_id: sup.id, lines: [{ item_id: chicken.id, quote_id: chicken.quote.id, received_qty: 10 }],
    check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
  const reasons = await ok(owner.get('/api/stock/waste-reasons'))
  await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: chicken.id, qty: 400, unit: 'g', reason_id: reasons[0].id }))
  await tillCheck(soho, [
    { item_id: bowl, name: 'Chicken bowl', qty: 10, net: 10000 },
    { item_id: wrap, name: 'Chicken wrap', qty: 3, net: 2400 },
    { item_id: platter, name: 'Chicken platter', qty: 2, net: 834 },
  ])
  await ok(owner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today, to: today }), 'recompute')
  // The variance rule, before the period it is about is closed.
  varianceRule = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Variance over the band', trigger: 'variance_over_band', conditions: {},
    action_tool: 'send_notice', action_input: { to: 'owner', title: 'Variance at {venue}: {flagged} flagged', text: '{period}: £{unexplained} unexplained, worst {top_item}' },
  } }))
})
test.after(async () => { await closeApp(); await claude.close?.() })

test('the week line before any period: theoretical from the week\'s sales, by the shared rule; no actual', async () => {
  const w = await ok(owner.get(`/api/stock/venues/${soho}/food-cost/week?start=${monday}`))
  assert.equal(w.week_start, monday)
  assert.equal(w.week_end, addDays(monday, 6))
  // 10 bowls at £1.40 and 2 platters at £3.00 = £20 of theoretical cost; the wraps have no recipe.
  const rows = await weekRows(soho, monday)
  assert.deepEqual(w.theoretical, daysFoodCost(rows), 'the shared rule over the same rows')
  net = rows.reduce((n, r) => n + r.net_pence, 0)
  assert.ok(net > 0)
  assert.equal(w.theoretical.net_food_pence, net)
  assert.equal(w.theoretical.theoretical_value, 20)
  assert.equal(w.theoretical.theoretical_pct, costShare(20, net))
  assert.equal(w.theoretical.uncosted_units, 3)
  assert.equal(w.actual, null, 'no actual without a period: never one made up for the week')
  assert.match(w.lines[0], new RegExp('Theoretical food cost ' + costShare(20, net) + '% of £[0-9,.]+ net food sales \\(3 units sold without a full recipe'))
  assert.match(w.lines[1], /needs a full stock count at both ends/)
  // Any day of the week gives its Monday; no start is this week at the venue.
  assert.equal((await ok(owner.get(`/api/stock/venues/${soho}/food-cost/week?start=${addDays(monday, 3)}`))).week_start, monday)
  assert.equal((await ok(owner.get(`/api/stock/venues/${soho}/food-cost/week`))).week_start, monday)
  assert.equal((await owner.get(`/api/stock/venues/${soho}/food-cost/week?start=27-11-2026`)).status, 400)
})

test('a period closed: the line names it as the latest closed period, with the Variance tab\'s figures; the variance rule fires once', async () => {
  // Closing count: 11 kg of chicken (actual 4 kg: 1 kg more than sales and 400 g more than waste), 1.9 kg of rice.
  const closing = await fullCount(soho, [{ item: chicken, qty: 11, unit: 'kg' }, { item: rice, qty: 1.9, unit: 'kg' }])
  p1 = closing.periods_made[0]
  assert.ok(p1, 'a period')
  const open = await ok(owner.get(`/api/stock/venues/${soho}/food-cost/week?start=${monday}`))
  assert.equal(open.actual, null, 'an open period that doesn\'t cover the whole week gives no actual, and none is closed')
  await ok(owner.post(`/api/stock/periods/${p1}/close`, {}))
  const v = await ok(owner.get(`/api/stock/venues/${soho}/variance?period=${p1}`))
  assert.equal(v.food_cost.complete, true)
  const w = await ok(owner.get(`/api/stock/venues/${soho}/food-cost/week?start=${monday}`))
  assert.equal(w.actual.covers, false)
  assert.equal(w.actual.period.id, p1)
  assert.equal(w.actual.pct, v.food_cost.actual_pct, 'the Variance tab\'s actual (shared/variance.js), frozen')
  assert.equal(w.actual.theoretical_pct, v.food_cost.theoretical_pct)
  assert.equal(w.actual.gap_pts, v.food_cost.gap_pts)
  assert.match(w.lines[1], new RegExp('No stock period covers this week.*The latest closed period, ' + w.actual.period.words + ', had actual'))
  assert.deepEqual(w.recent.map(p => p.id), [p1])
  // The period is over the band: the rule ran once, and the same event again never runs twice.
  const [f] = await waitFor(async () => { const r = await firings(varianceRule.id); return r.length && r[0].status !== 'running' ? r : null }, 'the variance rule')
  assert.equal(f.status, 'done', JSON.stringify(f.result))
  const note = sent.find(n => n.title.startsWith('Variance at Soho'))
  assert.ok(note, JSON.stringify(sent.map(n => n.title)))
  assert.match(note.title, /Variance at Soho: \d+ flagged/)
  assert.match(note.body, /unexplained, worst Chicken thighs/)
  const [p] = await sql`SELECT closed_at, figures FROM stock_periods WHERE id = ${p1}`
  assert.equal(f.event_key, 'variance_over_band:' + p1 + ':' + new Date(p.closed_at).getTime())
  const { varianceEvent } = await import('../../shared/foodCost.js')
  const again = await fireRules(await getApp(), ids.a, varianceEvent({ id: p1, venue_id: soho, from_at: v.period.from_at, to_at: v.period.to_at, closed_at: p.closed_at }, p.figures, 'Soho'), quiet)
  assert.deepEqual(again, [{ rule: varianceRule.id, status: 'already' }])
})

test('a stored period covering the whole week: its figure, said to be the period\'s, not the week\'s', async () => {
  // At Leeds: two full counts in October and the closed period between them, with its figures frozen.
  const count = at => sql`INSERT INTO stock_counts (tenant_id, venue_id, kind, status, counted_at, approved_at) VALUES (${ids.a}, ${leeds}, 'full', 'approved', ${at}, ${at}) RETURNING id`
  const [[c1], [c2]] = [await count('2026-10-04T23:00:00Z'), await count('2026-11-01T23:30:00Z')]
  const figures = { rows: [], totals: {}, flagged: 0, band: { band_pct: 1, unexplained_pct: 0.4, over: false },
    food_cost: { net_food_pence: 4200000, complete: true, uncounted_used: 0, actual_value: 13020, theoretical_value: 12180, actual_pct: 31, theoretical_pct: 29, gap_pts: 2 } }
  await sql`INSERT INTO stock_periods (tenant_id, venue_id, opening_count_id, closing_count_id, from_at, to_at, status, days_from, days_to, figures, closed_by, closed_at)
    VALUES (${ids.a}, ${leeds}, ${c1.id}, ${c2.id}, '2026-10-04T23:00:00Z', '2026-11-01T23:30:00Z', 'closed', '2026-10-05', '2026-11-01', ${sql.json(figures)}, 'owner', now())`
  // That week's sales, as usage from sales keeps them (food, retail goods, a dish with no recipe).
  for (const r of [['2026-10-12', 'food', 50000, 140], ['2026-10-13', 'food', 30000, 90], ['2026-10-13', 'goods', 9000, 5], ['2026-10-14', 'food', 2000, null]]) {
    await sql`INSERT INTO dish_cost_days (tenant_id, venue_id, day, channel, name, qty, net_pence, cost, uncosted_qty, item_type)
      VALUES (${ids.a}, ${leeds}, ${r[0]}::date, 'till', 'Sold', 10, ${r[2]}, ${r[3]}, ${r[3] == null ? 10 : 0}, ${r[1]})`
  }
  const w = await ok(owner.get(`/api/stock/venues/${leeds}/food-cost/week?start=2026-10-12`))
  assert.deepEqual(w.theoretical, daysFoodCost(await weekRows(leeds, '2026-10-12')))
  assert.equal(w.theoretical.net_food_pence, 82000, 'retail goods aren\'t food sales')
  assert.equal(w.theoretical.theoretical_pct, 28.05)
  assert.equal(w.actual.covers, true)
  assert.equal(w.actual.pct, 31)
  assert.match(w.lines[1], /Actual 31% against theoretical 29% for the stock period .*, which covers this week: .*the period's figure, not the week's/)
  // The week after the period ended isn't covered: the latest closed period, named.
  const after = await ok(owner.get(`/api/stock/venues/${leeds}/food-cost/week?start=2026-11-02`))
  assert.equal(after.actual.covers, false)
  assert.match(after.lines[1], /The latest closed period, .* had actual 31%/)
})

test('widgets: food cost, waste this week by reason, top variance items and margin by menu, each the shared rule\'s figures', async () => {
  const dash = await ok(owner.post('/api/custom-dashboards/dashboards', { venue_id: soho, name: 'Food cost' }))
  for (const type of ['stock_food_cost', 'stock_waste_week', 'stock_variance_items', 'stock_menu_margins']) {
    await ok(owner.post(`/api/custom-dashboards/dashboards/${dash.id}/widgets`, { widget_type: type }), type)
  }
  assert.equal((await ok(owner.get(`/api/custom-dashboards/dashboards/${dash.id}/widgets`))).length, 4)
  // Waste by reason: the 400 g logged at the average paid (£6 a kg).
  const waste = await ok(owner.get(`/api/stock/venues/${soho}/waste/summary?from=${monday}&to=${addDays(monday, 6)}&by=reason`))
  const [{ value }] = await sql`SELECT COALESCE(sum(value), 0)::float8 AS value FROM stock_waste WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND undone_at IS NULL AND day BETWEEN ${monday}::date AND ${addDays(monday, 6)}::date`
  assert.equal(waste.value, value)
  assert.equal(waste.rows[0].value, 2.4)
  // Top variance items: the newest stored period, the Variance tab's rows in the same order.
  const latest = await ok(owner.get(`/api/stock/venues/${soho}/variance?period=latest`))
  assert.equal(latest.period.id, p1)
  assert.deepEqual(latest.rows.map(r => [r.item_id, r.unexplained_value]), (await ok(owner.get(`/api/stock/venues/${soho}/variance?period=${p1}`))).rows.map(r => [r.item_id, r.unexplained_value]))
  assert.equal(latest.rows[0].name, 'Chicken thighs')
  assert.equal((await owner.get(`/api/stock/venues/${leeds}/variance?period=latest`)).status, 200)
  const none = await owner.post('/api/venues', { name: 'Empty', slug: 'empty-fc', timezone: 'Europe/London' })
  assert.equal((await owner.get(`/api/stock/venues/${none.body?.id || JSON.parse(none.body).id}/variance?period=latest`)).status, 404)
  // Margin by menu: soldMargins() per menu over the week's dish rows.
  const mm = await ok(owner.get(`/api/stock/venues/${soho}/margins-by-menu?start=${monday}`))
  const rows = await sql`
    SELECT d.dish_id, d.name, d.section_id, d.section, d.left_out, m.id AS menu_id, m.name AS menu, sum(d.qty)::float8 AS qty, sum(d.sales_pence)::float8 AS sales_pence,
           sum(d.net_pence)::float8 AS net_pence, sum(d.cost)::float8 AS cost, sum(d.uncosted_qty)::float8 AS uncosted_qty, sum(d.typical_qty)::float8 AS typical_qty
      FROM dish_cost_days d LEFT JOIN menu_sections s ON s.id = d.section_id AND s.tenant_id = d.tenant_id LEFT JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id
     WHERE d.tenant_id = ${ids.a} AND d.venue_id = ${soho} AND d.day BETWEEN ${monday}::date AND ${addDays(monday, 6)}::date
     GROUP BY d.dish_id, d.name, d.section_id, d.section, d.left_out, m.id, m.name`
  const settings = await ok(owner.get('/api/menu-margins/settings'))
  assert.deepEqual(mm.menus, marginsByMenu(rows, settings))
  assert.equal(mm.menus[0].menu, 'Bowls')
  assert.equal(mm.menus[0].net_pence, net)
  assert.equal(mm.menus[0].cost_pence, 2000)
  assert.equal(mm.sees_sales, true)
  // Food cost: the same answer as Cash Recon's week line.
  const fc = await ok(owner.get(`/api/stock/venues/${soho}/food-cost/week?start=${monday}`))
  assert.equal(fc.theoretical.theoretical_pct, costShare(20, net))
})

test('the Overview\'s stock tile: each venue in a line, food cost with Costing and till reports view', async () => {
  const catalog = await ok(owner.get('/api/dashboard-tiles/catalog'))
  assert.ok(catalog.some(t => t.tile_type === 'stock_status'))
  await ok(owner.post('/api/dashboard-tiles', { tile_type: 'stock_status' }))
  const o = await ok(owner.get('/api/stock/overview'))
  const s = o.venues.find(v => v.venue === 'Soho')
  assert.ok(s.last_full_count_at)
  assert.equal(s.theoretical_pct, costShare(20, net), 'this week\'s, as the week line gives it')
  assert.equal(s.actual.covers, false)
  assert.ok(s.unreviewed >= 1, 'the closed period\'s flagged items wait for a review')
  assert.match(s.words, /flagged items? to review/)
  assert.ok(!o.venues.some(v => v.venue === 'Away'), 'only the group\'s venues')
  const seen = await ok(viewer.get('/api/stock/overview'))
  assert.equal(seen.sees_sales, false)
  assert.ok(!('theoretical_pct' in seen.venues.find(v => v.venue === 'Soho')), 'Stock view: no food cost')
  // The tile is the stock module's: someone without Stock view isn't sent it.
  await asRole({ dashboard: 'view' }, async () => {
    const me = await ok(viewer.get('/api/me'))
    assert.ok(!(me.dashboard_tiles || []).some(t => t.tile_type === 'stock_status'))
    assert.equal((await viewer.get('/api/stock/overview')).status, 403)
  })
})

test('Today: the dishes over their cost target (the Menu margins figure, at the worst order type); Home\'s set-up gaps', async () => {
  const targets = await ok(owner.get(`/api/stock/venues/${soho}/cost-targets`))
  assert.deepEqual(targets.dishes.map(d => [d.name, d.band]), [['Chicken platter', 'over']])
  // The same figure as Menu margins at the order type where it is worst (rule 12).
  const types = await sql`SELECT id FROM order_types WHERE tenant_id = ${ids.a} AND is_active`
  let worst = null
  for (const t of types.length ? types : [{ id: null }]) {
    const m = await ok(owner.get(`/api/menu-margins?menu_id=${menu.id}&venue_id=${soho}${t.id ? '&order_type_id=' + t.id : ''}`))
    const r = m.rows.find(x => x.dish_id === platter)
    if (r && (worst == null || r.cost_pct > worst)) worst = r.cost_pct
  }
  assert.equal(targets.dishes[0].cost_pct, worst)
  const feed = await ok(owner.get(`/api/ops/today?venue_id=${soho}`))
  const task = feed.tasks.find(t => t.kind === 'dishes_over_target')
  assert.ok(task, JSON.stringify(feed.tasks.map(t => t.kind)))
  assert.equal(task.title, '1 dish over the cost target')
  assert.match(task.detail, /Chicken platter \d+(\.\d+)?% · 1 over the limit/)
  assert.equal(task.area, 'costing')
  assert.equal(task.action.path, '/menu-margins?venue=' + soho)
  assert.equal(task.can_act, true)
  // Without Costing view it isn't there, and the feed says the area was left out.
  const op = await ok(operator.get(`/api/ops/today?venue_id=${soho}`))
  assert.ok(!op.tasks.some(t => t.kind === 'dishes_over_target'))
  assert.ok((op.not_included || []).includes('costing'))
  // Home's gaps: no storage areas, best sellers with no recipe (the wrap), an item in a recipe with no price.
  const keys = (feed.gaps || []).map(g => g.key)
  assert.ok(keys.includes('no_stock_areas:' + soho), keys.join(', '))
  assert.ok(keys.includes('top_sellers_no_recipe:' + soho), keys.join(', '))
  assert.ok(keys.includes('items_no_price'), keys.join(', '))
  assert.match(feed.gaps.find(g => g.key.startsWith('top_sellers')).reason, /Chicken wrap/)
  // Each offered only to whoever manages its module (Home's suggestions): the operator manages none of them.
  assert.equal(setupRule({ gaps: feed.gaps, levels: { stock: 'use', recipes: 'view', purchasing_setup: 'none' } }).length, 0)
  assert.equal(setupRule({ gaps: feed.gaps, levels: { stock: 'manage', recipes: 'manage', purchasing_setup: 'manage' } }).length, 3)
  // A gap's path is a menu page, its tab apart (Home matches the page against the person's menu).
  assert.deepEqual(feed.gaps.filter(g => g.module !== 'food_safety').map(g => [g.module, g.path, g.tab || null]).sort(),
    [['purchasing_setup', '/inventory', null], ['recipes', '/recipes', null], ['stock', '/stock', 'settings']])
  // Home shows them (review fixes: the levels Home filters by hold Recipes and Purchasing setup, and the
  // paths are the menu's), to someone who manages the three, with links that open the page at the venue
  // (Inventory sits under Purchasing in the menu, so Purchasing view is needed to reach it at all).
  const stockKeys = ['setup:items_no_price', 'setup:no_stock_areas:' + soho, 'setup:top_sellers_no_recipe:' + soho]
  await asRole({ stock: 'manage', recipes: 'manage', purchasing_setup: 'manage', purchasing: 'view' }, async () => {
    const home = await ok(viewer.get(`/api/ops/today?venue_id=${soho}`))
    const mine = home.suggestions.filter(x => x.rule === 'setup')
    assert.deepEqual(mine.map(x => x.key).sort(), stockKeys, JSON.stringify(home.suggestions))
    assert.equal(mine.find(x => x.key.startsWith('setup:no_stock_areas')).link, `/stock?venue=${soho}&tab=settings`)
    assert.equal(mine.find(x => x.key.startsWith('setup:top_sellers')).link, '/recipes')
    assert.equal(mine.find(x => x.key === 'setup:items_no_price').link, '/inventory')
  })
  // Someone who manages Recipes and has no Stock view still gets theirs; only theirs reach the feed.
  await asRole({ recipes: 'manage' }, async () => {
    const home = await ok(viewer.get(`/api/ops/today?venue_id=${soho}`))
    assert.deepEqual((home.gaps || []).map(g => g.key), ['top_sellers_no_recipe:' + soho])
    assert.ok(home.suggestions.some(x => x.key === 'setup:top_sellers_no_recipe:' + soho), JSON.stringify(home.suggestions))
  })
  // Stock view and use without managing Recipes: the best sellers' names never reach them.
  const opGaps = (await ok(operator.get(`/api/ops/today?venue_id=${soho}`))).gaps || []
  assert.ok(!opGaps.some(g => ['stock', 'recipes', 'purchasing_setup'].includes(g.module)), JSON.stringify(opGaps))
  assert.ok(!JSON.stringify(opGaps).includes('Chicken wrap'))
  assert.deepEqual((await ok(operator.get(`/api/stock/venues/${soho}/setup-gaps`))).gaps, [])
  // "No price" as the cost engine prices: a switched-off supplier price is none (rice's, for a moment).
  assert.match((await ok(owner.get(`/api/stock/venues/${soho}/setup-gaps`))).gaps.find(g => g.key === 'items_no_price').reason, /^1 inventory item used/)
  await ok(owner.patch('/api/inventory/quotes/' + rice.quote.id, { is_active: false }))
  try {
    assert.match((await ok(owner.get(`/api/stock/venues/${soho}/setup-gaps`))).gaps.find(g => g.key === 'items_no_price').reason, /^2 inventory items used/)
  } finally {
    await ok(owner.patch('/api/inventory/quotes/' + rice.quote.id, { is_active: true }))
  }
  // An area made: that gap goes.
  await ok(owner.post(`/api/stock/venues/${soho}/areas`, { name: 'Walk-in' }))
  assert.ok(!((await ok(owner.get(`/api/ops/today?venue_id=${soho}`))).gaps || []).some(g => g.key === 'no_stock_areas:' + soho))
})

test('the rule trigger "a dish goes over its cost target": once per crossing, the cost % left out for people without Costing view', async () => {
  const rule = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Dishes over the limit', trigger: 'dish_over_target', conditions: { limit: true }, venue_id: soho,
    action_tool: 'send_notice', action_input: { to: 'operator', title: '{dish} at {cost_pct}% on {menu}', text: 'Target {target_pct}% at {venue}' },
  } }))
  const app = await getApp()
  sent.length = 0
  const first = await sweepCostTargets(app, quiet, { tenantIds: [ids.a] })
  assert.equal(first.failed, 0)
  assert.ok(first.crossed >= 1)
  const runs = await firings(rule.id)
  assert.deepEqual(runs.map(r => r.status), ['done'], JSON.stringify(runs))
  const [state] = await sql`SELECT band, name, since, cost_pct::float8 AS cost_pct FROM cost_target_states WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND dish_id = ${platter}`
  assert.equal(state.band, 'over')
  // The operator can't see costs: the % is left out of what reaches their phone (a target isn't a cost).
  const toOperator = sent.filter(n => n.device.includes('fc-operator'))
  assert.equal(toOperator.length, 1)
  assert.equal(toOperator[0].title, 'Chicken platter at ' + MONEY_HIDDEN + ' on Bowls')
  assert.ok(!JSON.stringify(toOperator[0]).includes(String(state.cost_pct)), 'no cost % for someone without Costing view')
  assert.match(toOperator[0].body, /Target 30% at Soho/)
  // The same look again: no new crossing, no second run.
  const second = await sweepCostTargets(app, quiet, { tenantIds: [ids.a] })
  assert.equal(second.crossed, 0)
  assert.equal((await firings(rule.id)).length, 1)
  // Back under (targets raised), then over again: a new event, a second run.
  const was = await ok(owner.get('/api/menu-margins/settings'))
  await ok(owner.put('/api/menu-margins/settings', { target_pct: 80, limit_pct: 90, sections: [] }))
  await sweepCostTargets(app, quiet, { tenantIds: [ids.a] })
  assert.equal((await sql`SELECT count(*)::int AS n FROM cost_target_states WHERE tenant_id = ${ids.a} AND venue_id = ${soho}`)[0].n, 0, 'back under: forgotten')
  await ok(owner.put('/api/menu-margins/settings', { target_pct: was.target_pct, limit_pct: was.limit_pct, sections: was.sections.map(s => ({ section_id: s.section_id, target_pct: s.target_pct, limit_pct: s.limit_pct })) }))
  await sweepCostTargets(app, quiet, { tenantIds: [ids.a] })
  assert.deepEqual((await firings(rule.id)).map(r => r.status), ['done', 'done'])
  // A person without Costing view can't make it (it would tell them costs).
  await asRole({ ai_assistant: 'manage', stock: 'view' }, async () => {
    const res = await viewer.post('/api/ai/rules', { rule: { name: 'x', trigger: 'dish_over_target', conditions: {}, action_tool: 'send_notice', action_input: { to: 'owner', title: '{dish} is over' } } })
    assert.equal(res.status, 403)
    assert.match(res.body, /trigger_access/)
  })
  await ok(owner.delete('/api/ai/rules/' + rule.id))
})

test('a rule with a cost % of its own tells as a dish passes it, a rise in the same band included, and only once', async () => {
  const app = await getApp()
  const sweep = () => sweepCostTargets(app, quiet, { tenantIds: [ids.a] })
  const platterNow = async () => (await sql`
    SELECT band, cost_pct::float8 AS cost_pct FROM cost_target_states WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND dish_id = ${platter}`)[0] || null
  const was = await ok(owner.get('/api/menu-margins/settings'))
  const targets = (target_pct, limit_pct) => ok(owner.put('/api/menu-margins/settings', { target_pct, limit_pct, sections: [] }))
  const chickenAt = price => ok(owner.patch('/api/inventory/quotes/' + chicken.quote.id, { price }))
  // The platter's cost % with chicken at £6 a kg, as the last sweep kept it; the rule's % a little above it,
  // the target under it and the limit well above, so dearer chicken moves it within its band first.
  const p0 = (await platterNow())?.cost_pct
  assert.ok(p0 > 0, 'the platter is kept as over')
  const over = Math.round(p0 * 1.05)
  await targets(98, 99)
  await sweep()
  assert.equal(await platterNow(), null, 'everything back under: forgotten')
  const pct = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Platter past its %', trigger: 'dish_over_target', conditions: { over, dish: 'platter' }, venue_id: soho,
    action_tool: 'send_notice', action_input: { to: 'owner', title: '{dish} at {cost_pct}%' },
  } }))
  const atLimit = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Platter over the limit and its %', trigger: 'dish_over_target', conditions: { over, limit: true, dish: 'platter' }, venue_id: soho,
    action_tool: 'send_notice', action_input: { to: 'owner', title: '{dish} is {band_words}' },
  } }))
  try {
    await targets(Math.floor(p0 * 0.8), Math.ceil(p0 * 1.3))
    await sweep()
    assert.deepEqual(await platterNow(), { band: 'watch', cost_pct: p0 })
    assert.equal((await firings(pct.id)).length, 0, 'over the target at ' + p0 + '%, not over ' + over + '% yet')
    // Chicken dearer: the platter rises in its band past the rule's %, which tells (the finding: it never did).
    // Since inventory phase 7b the price change itself notices it first: price creep's hook keeps
    // cost_target_states by the sweep's own function (keepCrossings()) and fires the rule once the change
    // is answered, so the sweep after it finds nothing new and the rule is told once.
    await chickenAt(6.6)
    const runs = await waitFor(async () => { const r = await firings(pct.id); return r.length && r.every(x => x.status !== 'running') ? r : null }, 'the rise')
    const p1 = await platterNow()
    assert.equal(p1.band, 'watch')
    assert.ok(p1.cost_pct > over, p1.cost_pct + ' over ' + over)
    assert.deepEqual(runs.map(r => r.status), ['done'], JSON.stringify(runs))
    assert.match(runs[0].event_key, /:rose:/)
    const rose = await sweep()
    assert.equal(rose.rose, 0, 'the hook told first: nothing new for the sweep ' + JSON.stringify(rose))
    // The same look again, then dearer still in the same band: past its % already, so not again.
    await sweep()
    await chickenAt(7.2)
    await sweep()
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await firings(pct.id)).length, 1)
    assert.equal((await firings(atLimit.id)).length, 0, 'not over the limit yet')
    // Over the limit: a crossing. The limit rule holds now and didn't at the last look; the % rule passed its % before.
    await chickenAt(8.4)
    await waitFor(async () => (await firings(atLimit.id)).some(r => r.status === 'done'), 'the limit')
    await sweep()
    assert.equal((await platterNow()).band, 'over')
    assert.equal((await firings(pct.id)).length, 1)
    assert.deepEqual((await firings(atLimit.id)).map(r => r.status), ['done'])
  } finally {
    await chickenAt(6)
    await ok(owner.put('/api/menu-margins/settings', { target_pct: was.target_pct, limit_pct: was.limit_pct, sections: was.sections.map(x => ({ section_id: x.section_id, target_pct: x.target_pct, limit_pct: x.limit_pct })) }))
    await sweep()
    await ok(owner.delete('/api/ai/rules/' + pct.id))
    await ok(owner.delete('/api/ai/rules/' + atLimit.id))
  }
})

test('the rule trigger "waste is logged": over the value only, once per entry; an amount never in an H&S action', async () => {
  wasteRule = await ok(owner.post('/api/ai/rules', { rule: {
    name: 'Big waste', trigger: 'waste_logged', conditions: { over: 5 },
    action_tool: 'send_notice', action_input: { to: 'owner', title: 'Waste £{value}: {what}', text: '{quantity}, {reason}, by {by}' },
  } }))
  const reasons = await ok(owner.get('/api/stock/waste-reasons'))
  sent.length = 0
  await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: chicken.id, qty: 100, unit: 'g', reason_id: reasons[0].id }))
  const big = await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: chicken.id, qty: 1, unit: 'kg', reason_id: reasons[0].id }))
  const [f] = await waitFor(async () => { const r = await firings(wasteRule.id); return r.length && r[0].status !== 'running' ? r : null }, 'the waste rule')
  assert.equal(f.status, 'done', JSON.stringify(f.result))
  assert.equal(f.event_key, 'waste_logged:' + big.id)
  await new Promise(r => setTimeout(r, 300))
  assert.equal((await firings(wasteRule.id)).length, 1, '£0.60 is not over £5')
  const note = sent.find(n => n.title.startsWith('Waste £'))
  assert.equal(note.title, 'Waste £6.00: Chicken thighs')
  assert.match(note.body, /1 kg, /)
  // The same entry again (another process, a retry) never runs twice.
  const again = await fireRules(await getApp(), ids.a, { trigger: 'waste_logged', key: big.id, day: today, venue_id: soho, venue: 'Soho', what: 'Chicken thighs', value: '6.00', value_num: 6 }, quiet)
  assert.deepEqual(again, [{ rule: wasteRule.id, status: 'already' }])
  // An amount in an H&S action is refused (everyone with the action log would read it); without one it is fine.
  const hs = { name: 'Waste action', trigger: 'waste_logged', conditions: {}, action_tool: 'add_hs_action', action_input: { task: 'Check {what}: £{value}' } }
  const refused = await owner.post('/api/ai/rules', { rule: hs })
  assert.equal(refused.status, 422)
  assert.match(refused.body, /can't carry \{value\}/)
  await ok(owner.post('/api/ai/rules', { rule: { ...hs, action_input: { task: 'Why was {what} wasted? ({reason})' } } }))
  // A money condition needs Costing view; the trigger itself Stock view.
  await asRole({ ai_assistant: 'manage', stock: 'view', hs_action_log: 'manage' }, async () => {
    const r = await viewer.post('/api/ai/rules', { rule: { ...hs, conditions: { over: 20 }, action_input: { task: 'Why was {what} wasted?' } } })
    assert.equal(r.status, 403, r.body)
    assert.match(r.body, /Costing view/)
    await ok(viewer.post('/api/ai/rules', { rule: { ...hs, name: 'Any waste', action_input: { task: 'Why was {what} wasted?' } } }))
  })
})

test('make_rule offers the new triggers: the model is told of them and the card reads them', async () => {
  const conditions = Object.fromEntries(Object.keys(ANSWER_SCHEMA.properties.conditions.properties).map(k => [k, '']))
  const input = Object.fromEntries(Object.keys(ANSWER_SCHEMA.properties.action_input.properties).map(k => [k, '']))
  for (const k of ['limit', 'dish', 'menu', 'venue_band', 'pounds_over', 'flagged_at_least', 'reason', 'what']) assert.ok(k in conditions, k)
  for (const k of ['dish_over_target', 'variance_over_band', 'waste_logged']) assert.ok(ANSWER_SCHEMA.properties.trigger.enum.includes(k), k)
  claude.script.push(() => ({ stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({
    understood: true, why_not: '', name: 'Big waste at any venue', trigger: 'waste_logged', venue: '', per_day: '', action: 'send_notice',
    conditions: { ...conditions, over: '50' }, action_input: { ...input, to: 'owner', title: 'Waste of {what} worth £{value}' },
  }) }] }))
  const app = await getApp()
  const ctx = makeContext({ app, channel: 'staff_chat', tenantId: ids.a, log: quiet, auth: { authorization: 'Bearer test:' + A.owner }, principal: { sub: A.owner, email: A.owner + '@test.local' }, actor: 'owner' })
  const t = audienceTools('staff').find(x => x.name === 'make_rule')
  const card = await t.describe(ctx, parseInput(t, { sentence: 'tell the owner when waste over £50 is logged' }))
  const system = JSON.stringify(claude.requests.at(-1).body.system)
  for (const k of ['dish_over_target', 'variance_over_band', 'waste_logged']) assert.ok(system.includes(k), k + ' in what the model is told')
  assert.deepEqual(card.lines.slice(0, 2), ['When waste is logged at any venue', 'If worth over (£) 50'])
  assert.equal(card.pin.rule.conditions.over, 50)
  // A percentage written with its sign is still the figure (review fixes: it was dropped, widening the rule).
  claude.script.push(() => ({ stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({
    understood: true, why_not: '', name: 'Dishes over 35%', trigger: 'dish_over_target', venue: '', per_day: '', action: 'send_notice',
    conditions: { ...conditions, over: '35%' }, action_input: { ...input, to: 'owner', title: '{dish} is over 35%' },
  }) }] }))
  const pctCard = await t.describe(ctx, parseInput(t, { sentence: 'tell the owner when a dish goes over 35%' }))
  assert.equal(pctCard.pin.rule.conditions.over, 35)
  assert.deepEqual(pctCard.lines.slice(0, 2), ['When a dish goes over its cost target at any venue', 'If cost % over 35'])
  // The chat model is told of the new triggers before any sentence reaches the reader.
  assert.match(t.description, /a dish goes over its cost target/)
  assert.match(t.description, /waste is logged/)
  const { promptLines } = await import('../src/ai/tools/rules.js')
  assert.match(promptLines.join(' '), /cost target/)
})

test('another group\'s venues are refused, and its ids never reach this group\'s figures', async () => {
  for (const path of ['food-cost/week', 'margins-by-menu', 'cost-targets', 'setup-gaps']) {
    assert.ok([403, 404].includes((await bOwner.get(`/api/stock/venues/${soho}/${path}`)).status), 'their ' + path)
    assert.ok([403, 404].includes((await owner.get(`/api/stock/venues/${bVenue}/${path}`)).status), 'our ' + path + ' at their venue')
  }
  assert.ok([403, 404].includes((await bOwner.get(`/api/stock/venues/${soho}/variance?period=latest`)).status))
  const theirs = await ok(bOwner.get('/api/stock/overview'))
  assert.deepEqual(theirs.venues.map(v => v.venue), ['Away'])
  const dash = await ok(owner.post('/api/custom-dashboards/dashboards', { venue_id: soho, name: 'Ours' }))
  assert.ok([403, 404].includes((await bOwner.post(`/api/custom-dashboards/dashboards/${dash.id}/widgets`, { widget_type: 'stock_food_cost' })).status))
  // Another group's sweep never touches this group's states.
  await sweepCostTargets(await getApp(), quiet, { tenantIds: [ids.b] })
  assert.equal((await sql`SELECT count(*)::int AS n FROM cost_target_states WHERE tenant_id = ${ids.b}`)[0].n, 0)
})

test('permissions: food cost needs Costing and till reports view, margins Costing view, the widgets their modules', async () => {
  for (const path of ['food-cost/week', 'margins-by-menu', 'cost-targets']) {
    assert.equal((await operator.get(`/api/stock/venues/${soho}/${path}`)).status, 403, 'operator, ' + path)
    assert.equal((await viewer.get(`/api/stock/venues/${soho}/${path}`)).status, 403, 'viewer, ' + path)
  }
  await asRole({ costing: 'view', stock: 'view', custom_dashboard: 'manage' }, async () => {
    const r = await viewer.get(`/api/stock/venues/${soho}/food-cost/week?start=${monday}`)
    assert.equal(r.status, 403)
    assert.match(r.body, /"sales"/)
    const mm = await ok(viewer.get(`/api/stock/venues/${soho}/margins-by-menu?start=${monday}`))
    assert.equal(mm.sees_sales, false)
    for (const k of ['net_pence', 'gp_pence', 'cost_pct', 'sales_pence']) assert.ok(!(k in mm.menus[0]), k + ' needs till reports view')
    assert.equal(mm.menus[0].cost_pence, 2000, 'theoretical cost with Costing view')
    assert.equal((await ok(viewer.get(`/api/stock/venues/${soho}/cost-targets`))).dishes.length, 1)
  })
  await asRole({ stock: 'view', custom_dashboard: 'manage' }, async () => {
    const dash = await ok(viewer.post('/api/custom-dashboards/dashboards', { venue_id: soho, name: 'Stock only' }))
    await ok(viewer.post(`/api/custom-dashboards/dashboards/${dash.id}/widgets`, { widget_type: 'stock_waste_week' }))
    assert.equal((await viewer.post(`/api/custom-dashboards/dashboards/${dash.id}/widgets`, { widget_type: 'stock_food_cost' })).status, 403, 'Costing view')
    assert.equal((await viewer.post(`/api/custom-dashboards/dashboards/${dash.id}/widgets`, { widget_type: 'stock_menu_margins' })).status, 403)
    const w = await ok(viewer.get(`/api/stock/venues/${soho}/waste/summary?from=${monday}&to=${addDays(monday, 6)}&by=reason`))
    assert.equal(w.sees_values, false)
    assert.ok(!('value' in w.rows[0]), 'values need Costing view')
    const v = await ok(viewer.get(`/api/stock/venues/${soho}/variance?period=latest`))
    assert.ok(!('unexplained_value' in v.rows[0]))
  })
  assert.ok(overTarget([]).length === 0)
})
