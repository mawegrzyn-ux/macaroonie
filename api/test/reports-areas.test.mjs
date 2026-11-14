// The report builder's figures for the areas phase 3 added (docs/REPORTS.md
// 20) against the app's own pages for the same rows:
//
//   kitchen     the Kitchen report (Till reports, GET .../kitchen-report)
//   kiosks      Kiosk analytics' overview (GET /api/pos/kiosk-analytics/venues/:id)
//   loyalty     each member's points and history (GET /api/loyalty/members/:id)
//   purchasing  the purchase orders list (GET /api/purchasing/pos)
//   food safety the Overview's H&S status tiles (GET /api/dashboard-tiles/hs-status)
//
// The kitchen log and the out-of-range readings are written here by SQL (no
// route makes a bump at a chosen time); kiosk visits come in through the
// kiosk's own route; loyalty, purchasing and food safety start from the
// fixtures (and the H&S test data they make) with a few changes on top.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, getApp, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { runner, rowsOf, totalsRow, p, measures, refused, LEVELS } from './support/reports.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { STARTERS } from '../src/reports/starters/index.js'
import { CATALOGUE, listColumns } from '../src/reports/catalogue/index.js'
import { currencyPath } from '../src/reports/run.js'
import { drillSpec } from '../../shared/reports/drill.js'
import { ulid } from '../../shared/pos/ids.js'

// View on every module the catalogue asks for, these areas' too.
const ALL = LEVELS

let ids, owner, V, VB, run

const period = (from, to = from) => ({ field: 'date', op: 'in_period', value: { from, to } })
const here = () => ({ field: 'venue', op: 'in', value: [V] })
const go = (spec, levels = ALL) => run(spec, undefined, { levels })
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
const byKey = (list, key) => Object.fromEntries(list.map(x => [x[key], x]))

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const other = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  VB = other.ids.venue
  run = runner(ids.a)
})
after(closeApp)

// ── Kitchen ────────────────────────────────────────────────────────────

// A Tuesday in September (the venue is an hour ahead of UTC).
const TUE = '2026-09-15'

test('kitchen tickets and remakes are the Kitchen report\'s own, station by station', async () => {
  const [wok] = await sql`SELECT id, name FROM kds_stations WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND kind = 'prep' AND name LIKE '%Wok'`
  assert.ok(wok, 'the fixtures\' wok')
  // The wok's own times: on time within 5 minutes, late after 10.
  await sql`UPDATE kds_stations SET settings = settings || '{"target_mins": 5, "late_mins": 10}'::jsonb WHERE id = ${wok.id}`
  const bump = (station, name, at, seconds, items, extra = {}) => sql`
    INSERT INTO kds_log (tenant_id, venue_id, kind, kitchen_order_id, event_id, station_id, station_name, station_kind,
                         at, seconds, items, order_source, order_type, order_number, recalled_at)
    VALUES (${extra.tenant ?? ids.a}, ${extra.venue ?? V}, 'bump', ${'K-' + at}, ${ulid()}, ${station}, ${name}, 'prep',
            ${at}, ${seconds}, ${items}, 'till', 'Eat in', ${extra.number ?? '12'}, ${extra.recalled ?? null})`
  const remake = (station, name, at, dish, reason) => sql`
    INSERT INTO kds_log (tenant_id, venue_id, kind, kitchen_order_id, event_id, station_id, station_name, station_kind,
                         at, item_name, reason, order_source, order_number)
    VALUES (${ids.a}, ${V}, 'remake', ${'K-' + at}, ${ulid()}, ${station}, ${name}, 'prep', ${at}, ${dish}, ${reason}, 'till', '12')`
  // The wok: on time, in between, late, one brought back, and one at 00:30
  // on the Tuesday at the venue (23:30 on the Monday by UTC).
  await bump(wok.id, wok.name, TUE + 'T11:00:00Z', 200, 2)
  await bump(wok.id, wok.name, TUE + 'T12:00:00Z', 450, 3)
  await bump(wok.id, wok.name, TUE + 'T17:00:00Z', 700, 1)
  await bump(wok.id, wok.name, TUE + 'T18:00:00Z', 900, 5, { recalled: TUE + 'T18:02:00Z' })
  await bump(wok.id, wok.name, addDays(TUE, -1) + 'T23:30:00Z', 290, 1)
  // 00:30 on the Wednesday at the venue: not the Tuesday's.
  await bump(wok.id, wok.name, TUE + 'T23:30:00Z', 100, 1)
  // A station deleted since: its rows keep the name it had (8 and 12 minutes).
  await bump(null, 'Old grill', TUE + 'T13:00:00Z', 500, 1)
  await bump(null, 'Old grill', TUE + 'T14:00:00Z', 800, 2)
  // The other group's kitchen, the same day.
  await bump(null, 'Their wok', TUE + 'T12:00:00Z', 60, 9, { tenant: ids.b, venue: VB })
  await remake(wok.id, wok.name, TUE + 'T12:05:00Z', 'Pad Thai', 'Too salty')
  await remake(wok.id, wok.name, TUE + 'T17:05:00Z', 'Wings', 'Dropped')
  await remake(null, 'Old grill', TUE + 'T13:05:00Z', 'Burger', 'Undercooked')

  const page = await ok(owner.get(`/api/pos/venues/${V}/kitchen-report?from=${TUE}&to=${TUE}`))
  const res = await go({
    subject: 'kitchen.tickets', rows: ['station_name'],
    values: measures(['tickets', 'dishes_total', 'average_time', 'longest', 'on_time_count', 'late_count', 'on_time_rate', 'recalled_count']),
    filters: [period(TUE), here()],
  })
  const mine = byKey(rowsOf(res), 'station_name')
  assert.deepEqual(Object.keys(mine).sort(), page.stations.map(s => s.name).sort(), 'the same stations')
  for (const s of page.stations) {
    const m = mine[s.name]
    assert.deepEqual([m.tickets, m.dishes_total, Math.round(m.average_time), m.longest, m.on_time_count, m.late_count],
      [s.tickets, s.items, s.avg_secs, s.max_secs, s.on_time, s.late], s.name)
  }
  // As known: the wok's four tickets (290, 200, 450, 700 seconds), the grill's two.
  assert.deepEqual([mine[wok.name].tickets, mine[wok.name].average_time, mine[wok.name].on_time_count, mine[wok.name].late_count], [4, 410, 2, 1])
  assert.equal(mine[wok.name].on_time_rate, 0.5)
  assert.equal(mine[wok.name].recalled_count, 1, 'the bump brought back is counted apart')
  // The old grill keeps the usual 8 and 12 minutes: 500 seconds is neither.
  assert.deepEqual([mine['Old grill'].on_time_count, mine['Old grill'].late_count], [0, 1])
  assert.equal(totalsRow(res).tickets, 6)

  // Remakes by station, and each one as the page lists it.
  const remakes = await go({ subject: 'kitchen.remakes', rows: ['station_name'], values: measures(['remakes']), filters: [period(TUE), here()] })
  const pageCounts = {}
  for (const r of page.remakes) pageCounts[r.station] = (pageCounts[r.station] || 0) + 1
  assert.deepEqual(Object.fromEntries(rowsOf(remakes).map(x => [x.station_name, x.remakes])), pageCounts)
  const list = await go({ subject: 'kitchen.remakes', kind: 'list', rows: ['dish', 'reason', 'station_name'], filters: [period(TUE), here()], sort: [{ by: 'remade_at', dir: 'desc' }] })
  assert.deepEqual(rowsOf(list).map(x => [x.dish, x.reason, x.station_name]), page.remakes.map(r => [r.item_name, r.reason, r.station]))

  // A station looked up through its link, with its target minutes.
  const stations = await go({ subject: 'kitchen.tickets', rows: ['station.name', 'station.target_mins'], values: measures(['tickets']), filters: [period(TUE), here()] })
  const wokRow = rowsOf(stations).find(x => x['station.name'] === wok.name)
  assert.deepEqual([wokRow['station.target_mins'], wokRow.tickets], [5, 4])

  // Without Till reports there is no kitchen.
  const none = await refused(go({ subject: 'kitchen.tickets', values: measures(['tickets']), filters: [period(TUE)] }, { ...ALL, pos_reports: 'none' }))
  assert.equal(none.status, 403)
})

// ── Kiosks ─────────────────────────────────────────────────────────────

const DISH = '11111111-1111-4111-8111-111111111111'
const START = { screen: 'start', section: null, orderType: null, lang: 'en', reach: false, prefs: { avoid: [], diet: [] }, basket: [], builder: null, details: { name: 0, tent: 0 }, value: 0, result: null }

/** A visit as a kiosk records it: ordered, gave up at the order page, or left from the menu without opening a dish. */
function visit(kind, { minutesAgo, total = 1700, orderNo = 17, design }) {
  const started = new Date(Date.now() - minutesAgo * 60_000)
  const basket = [{ key: 'A', item_id: DISH, qty: 1, selection: {} }]
  const events = [{ t: 0, k: 'vp', w: 1080, h: 1920 }, { t: 0, k: 'v', p: START }, { t: 100, k: 'v', p: { screen: 'menu', section: 'home' } }]
  if (kind === 'bounced') {
    events.push({ t: 5000, k: 'v', p: { ...START } }, { t: 5000, k: 'end', why: 'guest' })
  } else {
    events.push(
      { t: 2000, k: 'v', p: { builder: { item_id: DISH, key: null, qty: 1, selection: {} } } },
      { t: 4000, k: 'v', p: { builder: null, basket, value: total } },
      { t: 6000, k: 'v', p: { screen: 'basket' } },
    )
    if (kind === 'ordered') {
      events.push(
        { t: 9000, k: 'v', p: { screen: 'done', result: { order_no: orderNo, provisional: null, pending: false, total, check: null } } },
        { t: 12000, k: 'v', p: { ...START } }, { t: 12000, k: 'end', why: 'done' },
      )
    } else {
      events.push({ t: 70000, k: 'v', p: { 'ui:idle': 20 } }, { t: 90000, k: 'v', p: { ...START }, d: ['ui:idle'] }, { t: 90000, k: 'end', why: 'timeout' })
    }
  }
  return {
    id: ulid(), started_at: started.toISOString(), ended_at: new Date(started.getTime() + 1).toISOString(),
    design_id: design, stream_id: null, config_version: 'v1', app_version: '1.0.0', names: { [DISH]: 'Wings' }, events,
  }
}

test('kiosk visits are Kiosk analytics\' own: orders, sales, baskets left and where guests gave up', async () => {
  const design = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Report look', settings: {} }))
  const kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Report kiosk', settings: { design_id: design.id } })
  const visits = [
    visit('ordered', { minutesAgo: 90, total: 1700, orderNo: 17, design: design.id }),
    visit('ordered', { minutesAgo: 80, total: 2500, orderNo: 18, design: design.id }),
    visit('gave_up', { minutesAgo: 70, total: 900, design: design.id }),
    visit('bounced', { minutesAgo: 60, design: design.id }),
  ]
  const app = await getApp()
  const sent = await app.inject({
    method: 'POST', url: '/pos-api/kiosk/journeys',
    headers: { authorization: `Device ${kiosk.device_id}.${kiosk.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, 'content-type': 'application/json' },
    payload: JSON.stringify({ sessions: visits }),
  })
  assert.equal(sent.statusCode, 200, sent.body)
  assert.equal(sent.json().saved, 4)

  // Two days either side of now, at the venue: every visit is inside.
  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -2), to = addDays(today, 1)
  const { overview: o } = await ok(owner.get(`/api/pos/kiosk-analytics/venues/${V}?from=${from}&to=${to}`))
  const res = await go({
    subject: 'kiosks.visits',
    values: measures(['visits', 'orders', 'conversion', 'sales', 'average_order', 'gave_up', 'left_in_baskets', 'bounced']),
    filters: [period(from, to), here()],
  })
  const [m] = rowsOf(res)
  assert.deepEqual([m.visits, m.orders, m.gave_up, m.bounced], [o.sessions, o.ordered, o.abandoned, o.bounced])
  assert.equal(m.conversion, Number(o.conversion.toFixed(6)))
  assert.deepEqual([p(m.sales), p(m.average_order), p(m.left_in_baskets)], [o.revenue, Math.round(o.avg_order), o.abandoned_value])
  // As known: four visits, two orders of £17 and £25, £9 left in a basket, one left from the menu.
  assert.deepEqual([m.visits, m.orders, p(m.sales), p(m.left_in_baskets), m.bounced], [4, 2, 4200, 900, 1])

  // Where guests gave up: the overview's screens and counts.
  const where = await go({ subject: 'kiosks.visits', rows: ['last_screen'], values: measures(['gave_up']), filters: [period(from, to), here()] })
  const gaveUp = Object.fromEntries(rowsOf(where).filter(x => x.gave_up > 0).map(x => [x.last_screen, x.gave_up]))
  assert.deepEqual(gaveUp, Object.fromEntries(o.gave_up.map(g => [g.screen, g.count])))

  // How each ended, against the overview's outcomes.
  const ends = await go({ subject: 'kiosks.visits', rows: ['outcome'], values: measures(['visits']), filters: [period(from, to), here()] })
  const outcomes = Object.fromEntries(Object.entries(o.outcomes).filter(([, n]) => n > 0))
  assert.deepEqual(Object.fromEntries(rowsOf(ends).map(x => [x.outcome, x.visits])), outcomes)
  assert.deepEqual(outcomes, { ordered: 2, started_again: 1, timed_out: 1 })
  assert.ok(o.gave_up.length >= 1, 'somewhere to give up')

  // The kiosk and its design by name, through their links (the design needs
  // no Store tech: a lookup through a link isn't a report on designs).
  const named = await go({ subject: 'kiosks.visits', rows: ['kiosk.name', 'design.name'], values: measures(['visits', 'orders']), filters: [period(from, to), here()] },
    { ...ALL, pos_setup: 'none' })
  assert.deepEqual(rowsOf(named).map(x => [x['kiosk.name'], x['design.name'], x.visits, x.orders]), [['Report kiosk', 'Report look', 4, 2]])
  // But a report on designs themselves needs it.
  const designs = await refused(go({ subject: 'kiosks.designs', values: measures(['designs']) }, { ...ALL, pos_setup: 'none' }))
  assert.equal(designs.status, 403)
})

// ── Loyalty ────────────────────────────────────────────────────────────

test('a loyalty member\'s points are what their history adds up to, as the member page shows them', async () => {
  // The fixtures' member (300 points and a reward given), one with points
  // taken back, and one whose membership is closed.
  const join = name => ok(owner.post('/api/loyalty/members', { name, email: name.toLowerCase().replace(/ /g, '.') + '@example.test', agreed: true }), 'join ' + name)
  const m2 = await join('Rita Points')
  await ok(owner.post(`/api/loyalty/members/${m2.id}/adjust`, { points: 120, note: 'Opening balance' }))
  await ok(owner.post(`/api/loyalty/members/${m2.id}/adjust`, { points: -50, note: 'Taken back' }))
  const m3 = await join('Sam Closed')
  await ok(owner.post(`/api/loyalty/members/${m3.id}/adjust`, { points: 40, note: 'Opening balance' }))
  await ok(owner.patch(`/api/loyalty/members/${m3.id}`, { status: 'closed' }))

  const list = (await ok(owner.get('/api/loyalty/members?limit=100&status=all'))).members
  assert.ok(list.length >= 3, 'the fixtures\' member and two more')
  const pages = {}
  for (const m of list) pages[m.member_no] = await ok(owner.get(`/api/loyalty/members/${m.id}`))

  // The history, member by member, against the member page's own list.
  const history = await go({
    subject: 'loyalty.ledger', rows: ['member.member_no'],
    values: measures(['net', 'earned', 'welcome', 'adjusted', 'spent', 'changes']),
  })
  const byMember = byKey(rowsOf(history), 'member.member_no')
  for (const [no, pg] of Object.entries(pages)) {
    const sum = kind => pg.ledger.filter(l => !kind || l.kind === kind).reduce((s, l) => s + l.points, 0)
    const mine = byMember[no]
    if (!pg.ledger.length) { assert.equal(mine, undefined, no + ': no history, no row'); continue }
    assert.deepEqual([mine.net, mine.earned ?? 0, mine.welcome ?? 0, mine.adjusted, mine.changes],
      [sum(), sum('earn'), sum('welcome'), sum('adjust'), pg.ledger.length], no)
    assert.equal(mine.net, pg.member.points, no + ': the history adds up to the points held')
  }
  const rita = pages[m2.member_no]
  assert.deepEqual([byMember[m2.member_no].net, byMember[m2.member_no].adjusted, rita.member.points], [70, 70, 70])

  // The members themselves: points now, and who counts as a member.
  const members = await go({ subject: 'loyalty.members', kind: 'list', rows: ['member_no', 'status', 'points'] })
  assert.equal(rowsOf(members).length, list.length)
  for (const row of rowsOf(members)) {
    const pg = pages[row.member_no]
    assert.deepEqual([row.status, row.points], [pg.member.status, pg.member.points], row.member_no)
  }
  const sums = await go({ subject: 'loyalty.members', values: measures(['members', 'joined', 'points_balance']) })
  const active = Object.values(pages).filter(x => x.member.status === 'active')
  const [s] = rowsOf(sums)
  assert.deepEqual([s.members, s.joined, s.points_balance], [active.length, list.length, active.reduce((t, x) => t + x.member.points, 0)])
  assert.ok(s.joined > s.members, 'the closed membership joined, but isn\'t a member now')

  // Rewards given, against the member pages' lists.
  const given = await go({ subject: 'loyalty.member_rewards', values: measures(['given', 'not_used']) })
  const held = Object.values(pages).flatMap(pg => pg.rewards)
  assert.ok(held.length >= 1, 'the fixtures gave a reward')
  assert.deepEqual([rowsOf(given)[0].given, rowsOf(given)[0].not_used], [held.length, held.filter(r => r.status === 'available').length])

  // Members' names are personal, and need Loyalty members.
  const named = await go({ subject: 'loyalty.members', kind: 'list', rows: ['member_no', 'name'] })
  assert.equal(named.columns.find(c => c.key === 'name').pii, true)
  const none = await refused(go({ subject: 'loyalty.members', values: measures(['members']) }, { ...ALL, loyalty_members: 'none' }))
  assert.equal(none.status, 403)
})

// ── Purchasing ─────────────────────────────────────────────────────────

const poNumber = n => 'PO-' + String(n).padStart(5, '0')

test('supplier orders are the purchase order list\'s own, and their lines add up to them', async () => {
  const page = await ok(owner.get(`/api/purchasing/pos?venue_id=${V}&limit=500`))
  assert.ok(page.length >= 3, 'the fixtures placed, split and booked in orders')
  const res = await go({
    subject: 'purchasing.orders', kind: 'list',
    rows: ['number', 'status', 'date', 'no_order', 'goods_value', 'vat_value', 'delivery_value', 'total_value'],
    filters: [here()],
  })
  const mine = byKey(rowsOf(res), 'number')
  assert.equal(Object.keys(mine).length, page.length, 'every order, cancelled ones too')
  for (const po of page) {
    const m = mine[poNumber(po.number)]
    assert.ok(m, poNumber(po.number))
    assert.deepEqual([m.status, m.date, p(m.goods_value), p(m.vat_value), p(m.delivery_value), p(m.total_value)],
      [po.status, po.delivery_date, p(po.subtotal), p(po.vat), p(po.delivery_charge), p(po.total)], poNumber(po.number))
  }

  // The totals leave cancelled orders out.
  const live = page.filter(po => po.status !== 'cancelled')
  const sums = await go({ subject: 'purchasing.orders', values: measures(['orders', 'spend', 'goods', 'vat', 'delivery_charges', 'without_order']), filters: [here()] })
  const [s] = rowsOf(sums)
  const add = key => live.reduce((t, po) => t + p(po[key]), 0)
  assert.deepEqual([s.orders, p(s.spend), p(s.goods), p(s.vat), p(s.delivery_charges)], [live.length, add('total'), add('subtotal'), add('vat'), add('delivery_charge')])
  assert.ok(s.without_order >= 1, 'the fixtures booked a delivery in without an order')

  // Each order's lines add up to its goods and VAT (lineAmounts() in shared/procurement.js).
  const lines = await go({ subject: 'purchasing.order_lines', rows: ['order.number'], values: measures(['lines', 'goods', 'vat']), filters: [here()] })
  assert.ok(rowsOf(lines).length >= 3, 'orders with lines')
  for (const row of rowsOf(lines)) {
    const po = page.find(x => poNumber(x.number) === row['order.number'])
    assert.deepEqual([p(row.goods), p(row.vat)], [p(po.subtotal), p(po.vat)], row['order.number'])
  }

  // Prices are for people who see purchasing prices; counts aren't.
  const counted = await go({ subject: 'purchasing.orders', values: measures(['orders']), filters: [here()] }, { ...ALL, purchasing_setup: 'none' })
  assert.equal(rowsOf(counted)[0].orders, live.length)
  const spend = await refused(go({ subject: 'purchasing.orders', values: measures(['spend']), filters: [here()] }, { ...ALL, purchasing_setup: 'none' }))
  assert.equal(spend.status, 403)
  // A list without prices leaves the money columns out, with a note.
  const plain = await go({ subject: 'purchasing.orders', kind: 'list', rows: ['number', 'total_value'], filters: [here()] }, { ...ALL, purchasing_setup: 'none' })
  assert.deepEqual(plain.columns.map(c => c.key), ['number'])
})

// ── Food safety ────────────────────────────────────────────────────────

// The H&S test data the fixtures made (one reading of each kind a day, all
// in range), and the delivery checks of the orders they booked in.
const HS = { from: '2026-10-12', to: '2026-10-19' }

test('readings out of range with nothing done, and checklists done, are the Overview\'s own, day by day', async () => {
  const day = '2026-10-13', before = '2026-10-12'
  const one = async (table, column, date) => {
    const [row] = await sql`SELECT id FROM ${sql(table)} WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND ${sql(column)} = ${date} ORDER BY recorded_at LIMIT 1`
    assert.ok(row, table + ' on ' + date)
    return row.id
  }
  // A fridge reading out of range with nothing done, and one the day before
  // put right; a hold reading whose action was left empty; a cooking check
  // put right; a delivery turned away with nothing done.
  await sql`UPDATE fs_temp_logs SET is_within_range = false, corrective_action = NULL WHERE id = ${await one('fs_temp_logs', 'log_date', day)}`
  await sql`UPDATE fs_temp_logs SET is_within_range = false, corrective_action = 'Moved the stock' WHERE id = ${await one('fs_temp_logs', 'log_date', before)}`
  await sql`UPDATE fs_hold_checks SET is_within_range = false, corrective_action = '' WHERE id = ${await one('fs_hold_checks', 'check_date', day)}`
  await sql`UPDATE fs_cooking_checks SET is_within_range = false, corrective_action = 'Cooked longer' WHERE id = ${await one('fs_cooking_checks', 'check_date', day)}`
  const [delivery] = await sql`SELECT id, delivery_date::text AS date FROM fs_delivery_checks WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND delivery_date BETWEEN ${HS.from} AND ${HS.to} ORDER BY delivery_date LIMIT 1`
  assert.ok(delivery, 'a delivery checked in the range')
  await sql`UPDATE fs_delivery_checks SET accepted = false, corrective_action = NULL WHERE id = ${delivery.id}`

  const page = await ok(owner.get(`/api/dashboard-tiles/hs-status?from=${HS.from}&to=${HS.to}&today=${HS.to}`))
  const figure = async (subject, measure) => {
    const res = await go({ subject, rows: ['date'], values: measures([measure]), filters: [period(HS.from, HS.to), here()] })
    return Object.fromEntries(rowsOf(res).map(x => [x.date, x[measure]]))
  }
  const fridges = await figure('safety.fridge_checks', 'unresolved_count')
  const holds = await figure('safety.hold_checks', 'unresolved_count')
  const cooking = await figure('safety.cooking_checks', 'unresolved_count')
  const deliveries = await figure('safety.delivery_checks', 'unresolved_count')
  const unresolvedOf = (v, key) => v.categories.find(c => c.key === key)?.unresolved ?? 0
  let unresolved = 0
  for (const d of page.days) {
    const v = d.venues.find(x => x.venue_id === V)
    assert.deepEqual(
      [fridges[d.date] ?? 0, holds[d.date] ?? 0, cooking[d.date] ?? 0, deliveries[d.date] ?? 0],
      [unresolvedOf(v, 'equipment'), unresolvedOf(v, 'hold'), unresolvedOf(v, 'cooking'), unresolvedOf(v, 'delivery')],
      d.date)
    unresolved += v.unresolved
  }
  // As known: the fridge and the hold reading on the Tuesday (an empty action
  // counts as none) and the delivery turned away; what was put right isn't.
  assert.deepEqual([fridges[day], fridges[before] ?? 0, holds[day], cooking[day] ?? 0, deliveries[delivery.date]], [1, 0, 1, 0, 1])
  assert.equal(unresolved, 3)
  const out = await go({ subject: 'safety.fridge_checks', values: measures(['out_of_range', 'unresolved_count']), filters: [period(before, day), here()] })
  assert.deepEqual([rowsOf(out)[0].out_of_range, rowsOf(out)[0].unresolved_count], [2, 1], 'put right isn\'t unresolved')

  // Checklists done: each daily checklist, day by day.
  const done = await go({ subject: 'safety.checklists', rows: ['date', 'name'], values: measures(['done']), filters: [period(HS.from, HS.to), here()] })
  const doneBy = Object.fromEntries(rowsOf(done).map(x => [x.date + '|' + x.name, x.done]))
  let daily = 0
  for (const d of page.days) {
    const v = d.venues.find(x => x.venue_id === V)
    for (const c of v.checklists.filter(c => c.frequency === 'daily')) {
      daily++
      assert.equal((doneBy[d.date + '|' + c.name] ?? 0) > 0, c.completed, d.date + ' ' + c.name)
    }
  }
  assert.ok(daily >= 1, 'there are daily checklists to compare')

  // Each kind of check has its own module.
  const fridgeOnly = { ...ALL, checklists: 'none', hs_action_log: 'none' }
  await go({ subject: 'safety.fridge_checks', values: measures(['readings']), filters: [period(day), here()] }, fridgeOnly)
  const noChecklists = await refused(go({ subject: 'safety.checklists', values: measures(['done']), filters: [period(day), here()] }, fridgeOnly))
  assert.equal(noChecklists.status, 403)
})

// ── Starters, for the roles that can open them ────────────────────────

test('every starter runs for a role with only its own area, its rows and breakdowns too', async () => {
  // The starter list offers a starter to anyone with its subject's module
  // (runsFor), so that is all a role may have here: a figure needing another
  // module (purchasing money needs Purchasing setup) is left out with a note,
  // never a refusal.
  const given = s => (s.spec.params.some(x => x.type === 'period') ? { period: { from: '2025-11-01', to: '2026-12-31' } } : {})
  for (const s of STARTERS) {
    const levels = { [CATALOGUE.subjects[s.spec.subject].module]: 'view' }
    const res = await run(s.spec, given(s), { levels })
    assert.equal(res.kind, s.spec.kind, s.key)
    if (s.spec.kind === 'list') continue
    const steps = [{ at: [], to: 'rows' }, ...(s.spec.drill?.down || []).map(d => ({ at: [], to: d }))]
    for (const step of steps) {
      const next = drillSpec(s.spec, step, { listColumns: listColumns(s.spec.subject, levels), also: [currencyPath(s.spec.subject)] })
      assert.equal(next.problem, undefined, s.key + ' ' + JSON.stringify(step.to) + ': ' + next.problem)
      await run(next.spec, given(s), { levels })
    }
  }

  // Spend by supplier without Purchasing setup: the orders, without the money
  // or the share of it, each said; the chart has nothing of its own to draw.
  const spend = STARTERS.find(x => x.key === 'purchasing_spend_by_supplier')
  const counts = await run(spend.spec, given(spend), { levels: { purchasing: 'view' } })
  assert.deepEqual(counts.columns.filter(c => c.role === 'value').map(c => c.key), ['orders'])
  assert.deepEqual(counts.meta.notes, [
    'Goods is left out: your role can\'t see it',
    'VAT is left out: your role can\'t see it',
    'Delivery charges is left out: your role can\'t see it',
    'Spend is left out: your role can\'t see it',
    'Share of spend is left out: your role can\'t see what it is worked out from',
  ])
})
