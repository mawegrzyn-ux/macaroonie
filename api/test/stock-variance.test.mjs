// Stock periods and variance (inventory phase 6a, migration 312, 27 Nov
// 2026): a period made when a full count is approved (the previous full
// count opening it), between two counts with a delivery, waste (a till
// void marked wasted among it), transfers in and out and usage from sales,
// giving the expected actual, theoretical, variance and unexplained; the
// item rule and the venue band; food cost actual and theoretical; key items
// between their counts; explain_variance's evidence; closing freezes the
// figures and closes the days, a late sale on a closed day lands in the next
// period, marked, and reopening needs a note (refused while a later period
// is closed) and works the days out again; the reviewed flag and Today's
// variance to review; ids of another group or venue refused (venue, period,
// count, item); Stock view, Use and Manage, Costing view for pounds and till
// reports view for sales.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const usage = await import('../src/services/stockUsageSvc.js')

let ids, owner, operator, viewer, bOwner, soho, leeds, bVenue, bItem
let chicken, rice, bowl, wrap, today, p1, p2
const near = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 1e-3, (msg || '') + ': ' + a + ' is not ' + b)
const rowOf = (v, item) => v.rows.find(r => r.item_id === item.id)

async function makeMenu(who, name, sections) {
  const m = await ok(who.post('/api/menus', { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 6) }))
  const full = await ok(who.get('/api/menus/' + m.id))
  await ok(who.patch('/api/menus/' + m.id, { ...full, sections }), 'menu ' + name)
  return ok(who.get('/api/menus/' + m.id))
}

/** A closed till check today at a venue: lines [{ item_id, name, qty, status, net }]. */
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
      INSERT INTO pos_check_lines (id, tenant_id, venue_id, check_id, day_id, item_id, name, qty, gross, net, vat, status, void_waste, voided_at, void_day_id, void_reason)
      VALUES (${l.id}, ${ids.a}, ${venueId}, ${id}, ${d.id}, ${l.item_id}, ${l.name}, ${l.qty}, ${l.net * 1.2}, ${l.net}, ${l.net * 0.2}, ${l.status || 'sent'},
              ${l.status === 'voided' ? true : null}, ${l.status === 'voided' ? new Date() : null}, ${l.status === 'voided' ? d.id : null},
              ${l.status === 'voided' ? 'Dropped' : null})`
  }
  return id
}

/** A full count at a venue (counted, submitted, approved by the owner). */
async function fullCount(venueId, lines, { at = null } = {}) {
  const c = await ok(owner.post(`/api/stock/venues/${venueId}/counts`, { kind: 'full', ...(at ? { counted_at: at } : {}) }))
  for (const l of lines) await ok(owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: l.item.id, area_id: null, entries: [{ qty: l.qty, unit: l.unit }] }))
  await ok(owner.post(`/api/stock/counts/${c.id}/submit`, { all_zero: true }))
  return ok(owner.post(`/api/stock/counts/${c.id}/approve`, {}))
}

const recompute = () => ok(owner.post(`/api/stock/venues/${soho}/usage/recompute`, { from: today, to: today }), 'recompute')

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-var', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-var', timezone: 'Europe/London', currency: 'GBP' }))).id
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-var', timezone: 'Europe/London' }))).id
  bItem = await ok(bOwner.post('/api/inventory/items', { name: 'Their chicken', base_unit: 'g' }))
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
  const sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  const item = async (name, price) => {
    const i = await ok(owner.post('/api/inventory/items', { name, base_unit: 'g' }))
    const q = (await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: sup.id, pack_name: 'Bag', pack_count: 1, pack_qty: 1, pack_unit: 'kg', price }))).quotes[0]
    return { ...i, quote: q }
  }
  // Chicken thighs £6 a kg, rice £2 a kg; a chicken bowl is 200 g of chicken and 100 g of rice.
  chicken = await item('Chicken thighs', 6)
  rice = await item('Basmati rice', 2)
  const bowlR = await ok(owner.post('/api/recipes', { name: 'Chicken bowl', kind: 'dish', status: 'live', lines: [{ item_id: chicken.id, qty: 200, unit: 'g' }, { item_id: rice.id, qty: 100, unit: 'g' }] }))
  const menu = await makeMenu(owner, 'Bowls', [{ title: 'Bowls', items: [
    { name: 'Chicken bowl', price_pence: 1200, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Chicken wrap', price_pence: 900, is_orderable: true, variant_groups: [], variants: [] },
  ] }])
  bowl = menu.sections[0].items.find(i => i.name === 'Chicken bowl').id
  wrap = menu.sections[0].items.find(i => i.name === 'Chicken wrap').id
  await ok(owner.post(`/api/menus/${menu.id}/publish`, {}))
  await ok(owner.put(`/api/recipe-links/dishes/${bowl}/cell`, { recipe_id: bowlR.id }))
  ;({ today } = await usage.venueToday(sql, ids.a, soho))
  // Flag what is over £5 (and 3%) so this small kitchen shows a flag.
  await ok(owner.put('/api/stock/variance-settings', { band_pct: 1, item_pct: 3, item_pounds: 5 }))

  // The opening full count three days ago: 5 kg of chicken, 3 kg of rice. No period yet (nothing opens it).
  const opening = await fullCount(soho, [{ item: chicken, qty: 5, unit: 'kg' }, { item: rice, qty: 3, unit: 'kg' }], { at: new Date(Date.now() - 3 * 86400000).toISOString() })
  assert.deepEqual(opening.periods_made, [], 'the first full count opens, it closes nothing')
  // 10 kg of chicken delivered; 1 kg in from Leeds, 0.5 kg sent to Leeds (still on its way); 400 g thrown away.
  await ok(owner.post(`/api/purchasing/venues/${soho}/deliveries`, {
    supplier_id: sup.id, lines: [{ item_id: chicken.id, quote_id: chicken.quote.id, received_qty: 10 }],
    check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
  const inbound = await ok(owner.post(`/api/stock/venues/${leeds}/transfers`, { to_venue_id: soho, item_id: chicken.id, qty: 1, unit: 'kg' }))
  await ok(owner.post(`/api/stock/transfers/${inbound.id}/receive`, { lines: [{ line_id: inbound.lines[0].id, qty: 1, unit: 'kg' }] }))
  await ok(owner.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: chicken.id, qty: 500, unit: 'g' }))
  const reasons = await ok(owner.get('/api/stock/waste-reasons'))
  await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: chicken.id, qty: 400, unit: 'g', reason_id: reasons[0].id }))
  // The till: 10 chicken bowls sold, one voided as wasted, 3 wraps (no recipe: they take nothing off).
  await tillCheck(soho, [
    { item_id: bowl, name: 'Chicken bowl', qty: 10, net: 10000 },
    { item_id: bowl, name: 'Chicken bowl', qty: 1, net: 1000, status: 'voided' },
    { item_id: wrap, name: 'Chicken wrap', qty: 3, net: 2400 },
  ])
  await recompute()
  // A key-item count of the chicken in between: 12.5 kg (the ledger says 12.9 kg).
  await ok(owner.post(`/api/stock/venues/${soho}/counts`, { lines: [{ item_id: chicken.id, qty: 12.5, unit: 'kg' }] }))
})
test.after(async () => { await closeApp() })

test('approving the closing full count makes the period; actual, theoretical, waste, variance and unexplained', async () => {
  const closing = await fullCount(soho, [{ item: chicken, qty: 12, unit: 'kg' }, { item: rice, qty: 1.9, unit: 'kg' }])
  assert.equal(closing.periods_made.length, 1)
  p1 = closing.periods_made[0]
  const list = await ok(owner.get(`/api/stock/venues/${soho}/periods`))
  assert.equal(list.periods.length, 1)
  assert.equal(list.periods[0].status, 'open')
  assert.ok(list.current && list.current.opening_count_id === closing.id, 'the current period runs from the closing count')
  const v = await ok(owner.get(`/api/stock/venues/${soho}/variance?period=${p1}`))
  assert.equal(v.frozen, false)
  const c = rowOf(v, chicken)
  // opening 5 kg + 10 kg delivered + 1 kg in - 0.5 kg out - 12 kg counted = 3.5 kg used.
  assert.deepEqual([c.opening, c.received, c.transfers_in, c.transfers_out, c.closing], [5000, 10000, 1000, 500, 12000])
  assert.equal(c.actual, 3500)
  assert.equal(c.theoretical, 2000, '10 bowls at 200 g')
  assert.equal(c.waste, 600, '400 g logged and the voided bowl\'s 200 g')
  assert.equal(c.variance, 1500)
  assert.equal(c.unexplained, 900, 'the counts found 900 g less than the documents')
  near(c.price, 0.006, 'priced at the average paid')
  assert.equal(c.unexplained_value, 5.4)
  assert.equal(c.flagged, true, 'over £5 and over 3%')
  const r = rowOf(v, rice)
  assert.deepEqual([r.actual, r.theoretical, r.waste, r.unexplained], [1100, 1000, 100, 0])
  near(r.price, 0.002, 'no delivery at Soho: the standard price')
  assert.equal(r.flagged, false)
  assert.equal(v.rows[0].item_id, chicken.id, 'ranked by pounds of unexplained loss')
  // Food cost: net food sales are the day's sold dishes' net (the bowls and the wraps; the void isn't sold).
  const [day] = await sql`SELECT sum(net_pence)::int AS net FROM dish_cost_days WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND day = ${today}::date`
  assert.equal(v.food_cost.net_food_pence, day.net)
  assert.ok(day.net > 0)
  const net = day.net / 100
  assert.equal(v.food_cost.actual_value, 21 + 2.2)
  near(v.food_cost.actual_pct, Math.round(23.2 / net * 10000) / 100, 'actual food cost %')
  near(v.food_cost.theoretical_pct, Math.round((12 + 2) / net * 10000) / 100, 'theoretical food cost %')
  near(c.share_pct, Math.round(5.4 / net * 10000) / 100, 'its share of food sales')
  assert.equal(v.band.over, true, '£5.40 of about £100 is over 1 point')
})

test('key items between their counts: the figures for each pair of counts add up to the period\'s', async () => {
  const one = await ok(owner.get(`/api/stock/venues/${soho}/variance/items/${chicken.id}?period=${p1}`))
  assert.equal(one.intervals.length, 2, 'opening to the key count, the key count to the closing count')
  assert.deepEqual(one.intervals.map(i => i.unexplained), [400, 500])
  assert.equal(one.intervals.reduce((s, i) => s + i.unexplained, 0), one.row.unexplained)
  const key = await ok(owner.get(`/api/stock/venues/${soho}/variance/key`))
  const k = key.items.find(i => i.item_id === chicken.id)
  assert.ok(k && k.intervals.length >= 1, 'the key-counted item between its counts')
  assert.equal(k.intervals.at(-1).unexplained, 500)
})

test('explain_variance: the evidence for the flagged item, each with its fix', async () => {
  const one = await ok(owner.get(`/api/stock/venues/${soho}/variance/items/${chicken.id}?period=${p1}`))
  const kinds = one.evidence.map(e => e.kind)
  assert.ok(kinds.includes('uncosted_dishes'), 'the wraps were sold without a recipe: ' + kinds)
  assert.match(one.evidence.find(e => e.kind === 'uncosted_dishes').text, /Chicken wrap \(3 sold/)
  assert.ok(kinds.includes('waste'))
  assert.ok(kinds.includes('in_transit'), 'the 500 g on its way to Leeds')
  assert.match(one.evidence.find(e => e.kind === 'in_transit').text, /to Leeds/)
  for (const e of one.evidence) assert.ok(e.fix, e.kind + ' has a fix')
  const rice_ = await ok(owner.get(`/api/stock/venues/${soho}/variance/items/${rice.id}?period=${p1}`))
  assert.ok(!rice_.evidence.some(e => e.kind === 'in_transit'), 'only what bears on the item')
})

test('pounds need Costing view, sales need till reports view too; closing needs Manage', async () => {
  const seen = await ok(viewer.get(`/api/stock/venues/${soho}/variance?period=${p1}`))
  const c = rowOf(seen, chicken)
  assert.equal(c.unexplained, 900, 'Stock view sees quantities')
  assert.equal(c.flagged, true)
  for (const k of ['unexplained_value', 'price', 'actual_value', 'share_pct']) assert.ok(!(k in c), k + ' is left out')
  assert.equal(seen.food_cost, null)
  assert.equal((await viewer.post(`/api/stock/periods/${p1}/close`, {})).status, 403)
  assert.equal((await operator.post(`/api/stock/periods/${p1}/close`, {})).status, 403, 'Use is not enough')
  assert.equal((await operator.put('/api/stock/variance-settings', { band_pct: 1, item_pct: 3, item_pounds: 5 })).status, 403)
  assert.equal((await owner.put('/api/stock/variance-settings', { band_pct: 1, item_pct: 3 })).status, 400, 'every field')
  const [role] = await sql`INSERT INTO tenant_roles (tenant_id, key, label, permissions, is_builtin)
    VALUES (${ids.a}, 'costs_no_till', 'Costs, no till reports', ${sql.json({ stock: 'view', costing: 'view' })}, false) RETURNING id`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  try {
    const costs = await ok(viewer.get(`/api/stock/venues/${soho}/variance?period=${p1}`))
    assert.equal(rowOf(costs, chicken).unexplained_value, 5.4, 'Costing view: pounds')
    assert.ok(!('share_pct' in rowOf(costs, chicken)), 'no share of sales without till reports view')
    assert.equal(costs.food_cost, null, 'no food cost % without till reports view')
  } finally {
    await sql`UPDATE users SET custom_role_id = NULL WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  }
})

test('closing freezes the figures and closes the days; Today asks for a review until it is done', async () => {
  const closed = await ok(owner.post(`/api/stock/periods/${p1}/close`, {}))
  assert.equal(closed.period.status, 'closed')
  assert.equal(closed.period.days_to, today, 'today\'s sales are inside it')
  assert.equal((await owner.post(`/api/stock/periods/${p1}/close`, {})).status, 409, 'once')
  // A change to the documents after closing leaves the figures as they were (like a Z).
  await sql`UPDATE stock_usage_days SET qty_base = qty_base WHERE tenant_id = ${ids.a}`
  const v = await ok(owner.get(`/api/stock/venues/${soho}/variance?period=${p1}`))
  assert.equal(v.frozen, true)
  assert.equal(rowOf(v, chicken).unexplained, 900)
  assert.equal(v.can_reopen, true)
  // Today: the flagged chicken to review, for Stock manage only.
  const feed = await ok(owner.get(`/api/ops/today?venue_id=${soho}`))
  const task = feed.tasks.find(t => t.kind === 'stock_variance_to_review')
  assert.ok(task, 'variance to review: ' + feed.tasks.map(t => t.kind))
  assert.match(task.detail, /1 flagged item/)
  assert.equal(task.action.path, '/stock?tab=variance&venue=' + soho + '&period=' + p1)
  assert.ok(!(await ok(operator.get(`/api/ops/today?venue_id=${soho}`))).tasks.some(t => t.kind === 'stock_variance_to_review'), 'Use can\'t review')
  assert.equal((await operator.post(`/api/stock/periods/${p1}/items/${chicken.id}/review`, { reviewed: true })).status, 403)
  const done = await ok(owner.post(`/api/stock/periods/${p1}/items/${chicken.id}/review`, { reviewed: true, note: 'The wraps use chicken: recipe to come' }))
  assert.equal(done.reviewed.note, 'The wraps use chicken: recipe to come')
  assert.ok(!(await ok(owner.get(`/api/ops/today?venue_id=${soho}`))).tasks.some(t => t.kind === 'stock_variance_to_review'), 'reviewed: off Today')
  const seen = rowOf(await ok(owner.get(`/api/stock/venues/${soho}/variance?period=${p1}`)), chicken).reviewed
  assert.ok(seen?.by && seen.note, 'the row says who reviewed it')
})

test('a late sale on a closed day is kept apart and lands in the next period, marked; on hand stays as counted', async () => {
  const before = (await ok(owner.get(`/api/stock/venues/${soho}`))).items.find(i => i.item_id === chicken.id).on_hand
  assert.equal(before, 12000)
  // Five more bowls reach today's till late (a hub that synced after the count).
  await tillCheck(soho, [{ item_id: bowl, name: 'Chicken bowl', qty: 5, net: 5000 }])
  const asked = []
  const keep = usage.usageHooks.isDayClosed
  usage.usageHooks.isDayClosed = (venueId, day, ranges) => { asked.push(day); return keep(venueId, day, ranges) }
  try {
    await recompute()
  } finally {
    usage.usageHooks.isDayClosed = keep
  }
  assert.ok(asked.includes(today), 'the hook is asked, with the closed ranges')
  const [kept] = await sql`SELECT qty_base::float8 AS q FROM stock_usage_days WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND day = ${today}::date AND item_id = ${chicken.id}`
  assert.equal(kept.q, 2000, 'the closed day keeps what it had')
  const late = await sql`SELECT l.period_id, l.net_pence::int AS net, li.qty_base::float8 AS q FROM stock_usage_late l
    JOIN stock_usage_late_items li ON li.late_id = l.id WHERE l.tenant_id = ${ids.a} AND li.item_id = ${chicken.id}`
  assert.equal(late.length, 1)
  assert.equal(late[0].q, 1000, 'five bowls of chicken')
  assert.equal(late[0].period_id, null, 'into the period running since the latest full count')
  // Nothing new: nothing kept twice.
  await recompute()
  assert.equal((await sql`SELECT count(*)::int AS n FROM stock_usage_late WHERE tenant_id = ${ids.a}`)[0].n, 1)
  assert.equal(rowOf(await ok(owner.get(`/api/stock/venues/${soho}/variance?period=${p1}`)), chicken).theoretical, 2000, 'the closed figures stand')
  const cur = await ok(owner.get(`/api/stock/venues/${soho}/variance?period=current`))
  assert.equal(rowOf(cur, chicken).late, 1000, 'marked')
  assert.equal(rowOf(cur, chicken).theoretical, 1000)
  const [lateNet] = await sql`SELECT net_food_pence::int AS n FROM stock_usage_late WHERE tenant_id = ${ids.a}`
  assert.ok(lateNet.n > 0, 'the late sales add to net food sales')
  assert.equal(cur.late_food_pence, lateNet.n)
  const after = (await ok(owner.get(`/api/stock/venues/${soho}`))).items.find(i => i.item_id === chicken.id).on_hand
  assert.equal(after, 12000, 'on the ledger at the day\'s last sale, before the closing count')
  const h = await ok(owner.get(`/api/stock/venues/${soho}/items/${chicken.id}/moves`))
  assert.ok(h.moves.some(m => m.source?.type === 'late_usage'), 'the late sales are on the ledger')
  // The next full count makes the period they landed in.
  const next = await fullCount(soho, [{ item: chicken, qty: 12, unit: 'kg' }, { item: rice, qty: 1.9, unit: 'kg' }])
  p2 = next.periods_made[0]
  const [moved] = await sql`SELECT period_id FROM stock_usage_late WHERE tenant_id = ${ids.a}`
  assert.equal(moved.period_id, p2)
  const v2 = await ok(owner.get(`/api/stock/venues/${soho}/variance?period=${p2}`))
  const c2 = rowOf(v2, chicken)
  assert.deepEqual([c2.late, c2.theoretical, c2.actual, c2.unexplained], [1000, 1000, 0, -1000], 'late sales from a closed period read as a gain here')
  const ev = await ok(owner.get(`/api/stock/venues/${soho}/variance/items/${chicken.id}?period=${p2}`))
  assert.ok(ev.evidence.some(e => e.kind === 'late_sales'))
})

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

test('Pepper: variance_summary and explain_variance read the same figures, names never ids', async () => {
  const sum = await pepper(A.owner, 'variance_summary', { venue: 'Soho', period: 'last_closed' })
  assert.equal(sum.tool.class, 'read')
  assert.equal(sum.out.closed, true)
  assert.equal(sum.out.flagged[0].item, 'Chicken thighs')
  assert.equal(sum.out.flagged[0].unexplained, '+900 g')
  assert.equal(sum.out.flagged[0].value, '£5.40')
  assert.match(sum.out.food_cost.actual, /%$/)
  const why = await pepper(A.owner, 'explain_variance', { venue: 'Soho', item: 'chicken', period: 'last_closed' })
  assert.equal(why.tool.class, 'read')
  assert.equal(why.out.figures.unexplained, '+900 g')
  assert.ok(why.out.evidence.some(e => e.what === 'Sold without a recipe'), JSON.stringify(why.out.evidence))
  const seen = await pepper(A.viewer, 'variance_summary', { venue: 'Soho', period: 'last_closed' })
  assert.match(String(seen.out.food_cost), /Costing view/, 'no food cost % without Costing view')
  assert.ok(!('value' in seen.out.flagged[0]), 'no pounds')
  for (const o of [sum.out, why.out, seen.out]) assert.doesNotMatch(JSON.stringify(o), /[0-9a-f]{8}-[0-9a-f]{4}-/, 'no ids')
})

test('the report subjects: variance by period, food cost by period, periods; the starters run', async () => {
  const period = { params: [{ key: 'period', type: 'period', default: { relative: 'this_year' } }], filters: [{ field: 'date', op: 'in_period', param: 'period' }] }
  const v = await ok(owner.post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.variance', rows: ['item_name', 'unexplained', 'unexplained_value', 'flagged', 'reviewed'], ...period } }))
  const chick = v.rows.filter(r => r.cells[0] === 'Chicken thighs' || r.cells[0]?.text === 'Chicken thighs' || JSON.stringify(r).includes('Chicken thighs'))
  assert.ok(chick.length >= 1, JSON.stringify(v.rows).slice(0, 400))
  assert.ok(JSON.stringify(chick[0]).includes('900'), 'the frozen 900 g')
  const fc = await ok(owner.post('/api/reports/preview', { spec: { subject: 'stock.food_cost', rows: [{ field: 'date', bucket: 'week' }], values: [{ measure: 'actual_food_cost_pct' }, { measure: 'theoretical_food_cost_pct' }], ...period } }))
  assert.ok(fc.rows.length >= 1)
  const ps = await ok(owner.post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.periods', rows: ['status', 'closed_by', 'flagged_items'], ...period } }))
  assert.ok(ps.rows.length >= 2, 'both periods')
  for (const key of ['stock_variance_by_item', 'stock_food_cost_actual_theoretical_week']) {
    await ok(owner.post(`/api/reports/starter:${key}/run`, {}), key)
  }
  const noCost = await viewer.post('/api/reports/preview', { spec: { subject: 'stock.variance', rows: ['item_name'], values: [{ measure: 'unexplained_total' }], ...period } })
  assert.ok(noCost.status >= 400 || /left out/i.test(String(noCost.body)), 'pounds need Costing view')
})

test('reopening needs Manage and a note, is refused while a later period is closed, and works the days out again', async () => {
  await ok(owner.post(`/api/stock/periods/${p2}/close`, {}))
  assert.equal((await owner.post(`/api/stock/periods/${p1}/reopen`, {})).status, 400, 'a note')
  assert.equal((await operator.post(`/api/stock/periods/${p1}/reopen`, { note: 'Wrong count' })).status, 403)
  const refused = await owner.post(`/api/stock/periods/${p1}/reopen`, { note: 'A delivery was missed' })
  assert.equal(refused.status, 409)
  assert.match(refused.body, /later_closed/)
  await ok(owner.post(`/api/stock/periods/${p2}/reopen`, { note: 'Reopened to fix the first' }))
  const open = await ok(owner.post(`/api/stock/periods/${p1}/reopen`, { note: 'A delivery was missed' }))
  assert.equal(open.period.status, 'open')
  assert.equal(open.period.reopen_note, 'A delivery was missed')
  assert.deepEqual(open.period.history.map(h => h.action), ['closed', 'reopened'])
  assert.equal((await sql`SELECT count(*)::int AS n FROM stock_usage_late WHERE tenant_id = ${ids.a}`)[0].n, 0, 'its late sales come home')
  const [day] = await sql`SELECT qty_base::float8 AS q FROM stock_usage_days WHERE tenant_id = ${ids.a} AND venue_id = ${soho} AND day = ${today}::date AND item_id = ${chicken.id}`
  assert.equal(day.q, 3000, 'the day worked out again with its late sales')
})

test('By venue: the item at every venue of the group', async () => {
  const by = await ok(owner.get(`/api/stock/variance/by-venue?item=${chicken.id}&which=latest`))
  assert.deepEqual(by.venues.map(v => v.venue).sort(), ['Leeds', 'Soho'])
  assert.equal(by.venues[0].venue, 'Soho', 'the venue with a period first')
  assert.equal(by.venues.find(v => v.venue === 'Leeds').period, null, 'no full count at Leeds')
  assert.equal((await viewer.get(`/api/stock/variance/by-venue?item=${chicken.id}`)).status, 200)
})

test('another group\'s venue, period, count and item are refused, and another venue\'s period', async () => {
  assert.ok([403, 404].includes((await bOwner.get(`/api/stock/venues/${soho}/variance`)).status), 'their venue')
  assert.equal((await bOwner.get(`/api/stock/venues/${bVenue}/variance?period=${p1}`)).status, 404, 'our period at their venue')
  assert.equal((await bOwner.post(`/api/stock/periods/${p1}/close`, {})).status, 404)
  assert.equal((await bOwner.post(`/api/stock/periods/${p1}/reopen`, { note: 'Not yours' })).status, 404)
  assert.equal((await bOwner.post(`/api/stock/periods/${p1}/items/${chicken.id}/review`, { reviewed: true })).status, 404)
  assert.equal((await bOwner.get(`/api/stock/variance/by-venue?item=${chicken.id}`)).status, 404, 'our item')
  assert.equal((await owner.post(`/api/stock/periods/${p1}/items/${bItem.id}/review`, { reviewed: true })).status, 404, 'their item')
  assert.equal((await owner.get(`/api/stock/venues/${soho}/variance/items/${bItem.id}`)).status, 404, 'their item')
  assert.equal((await owner.get(`/api/stock/venues/${leeds}/variance?period=${p1}`)).status, 404, 'Soho\'s period at Leeds')
  const [count] = await sql`SELECT closing_count_id FROM stock_periods WHERE id = ${p1}`
  assert.equal((await bOwner.post(`/api/stock/counts/${count.closing_count_id}/approve`, {})).status, 404, 'our count')
  assert.equal((await owner.get(`/api/stock/venues/${soho}/variance?period=not-an-id`)).status, 400)
})
