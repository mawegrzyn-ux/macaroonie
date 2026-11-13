// Test till sales on the Test data page (docs/REPORTS.md phase 1c, migration
// 245): past trading days made through the till's own check rules
// (api/src/services/tillSalesGen.js) and stored as the sequencer stores
// checks (api/src/services/tillTestDataSvc.js). Checked here:
//   - the pure rules: seeded random numbers, how many orders a day, the
//     venue's clock, random picks for a dish's choices;
//   - a day made from the fixture venue's real till config: every order
//     through the rules, paid up, every moment inside its trading day (also
//     a day that starts in the middle of service), numbered by its till, the
//     meal deal sold with its part's options, a floor area's own revenue
//     stream on its tables, the day's figures (those of its checks), the same
//     day again from the same seed;
//   - a venue with a kiosk and a counter till and a switch that needs a
//     manager: kiosk orders (some paid at the counter by staff), order
//     numbers from each device's range, approvals from a manager;
//   - the routes: dry run, a real trading day left alone, closed days left
//     out, what is stored (breakdowns, projections) and read back by Till
//     reports and the report builder, kept away from tills and Cash Recon,
//     nobody taking orders after their last working day,
//     made again without doubling, Clear, refusals.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { as, ok, getApp, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { runner, rowsOf, p, measures } from './support/reports.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { withTenant } from '../src/config/db.js'
import { tillConfig, loadTillStaff, backfillCheckProjections } from '../src/services/posSvc.js'
import { localParts } from '../src/services/orderSvc.js'
import { generateDay, dayCount, zonedMs, seededRandom, nextDate, randomPicks } from '../src/services/tillSalesGen.js'
import { checkTotals, isActiveLine } from '../../shared/pos/pricing.js'
import { ulid } from '../../shared/pos/ids.js'
import { dayFigures, CHECK_BREAKDOWNS_V, businessDate } from '../../shared/pos/reports.js'

let ids, filled, owner, V, run, counter
// Dates before the venue's trading day open now (the generator's "today":
// after midnight it is still yesterday's until the day starts), so the tests
// read the same at any hour. Set in before().
let today
const ago = n => nextDate(today, -n)

async function device(d, method, url, payload) {
  const app = await getApp()
  const res = await app.inject({
    method, url, payload,
    headers: { authorization: `Device ${d.device_id}.${d.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}

const loadVenue = () => withTenant(ids.a, async tx => ({
  config: await tillConfig(tx, ids.a, V),
  staff: await loadTillStaff(tx, ids.a, V),
}))

// The trading day's first and last moment, as the generator works them out.
function tradingDay(config, date) {
  const tz = config.venue?.timezone || 'Europe/London'
  const [h, m] = String(config.settings?.day_starts_at || '00:00').split(':').map(Number)
  const mins = h * 60 + (m || 0)
  return [zonedMs(date, mins, tz), zonedMs(nextDate(date), mins, tz) - 60_000]
}

// Every moment a check keeps: opened and closed, each line added, sent and
// voided, each send, discount, charge taken off, payment and refund.
function timesOf(x, out = []) {
  if (Array.isArray(x)) for (const v of x) timesOf(v, out)
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if ((k === 'at' || k.endsWith('_at')) && typeof v === 'string') out.push(v)
      else timesOf(v, out)
    }
  }
  return out
}

before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  run = runner(ids.a)
  const { config } = await loadVenue()
  today = businessDate(new Date(), config.venue?.timezone || 'Europe/London', config.settings?.day_starts_at)
})
after(closeApp)

test('the pure rules: seeded numbers, orders a day, the venue\'s clock, random picks', () => {
  // The same seed gives the same numbers, in [0, 1); another seed others.
  const a = seededRandom('x'); const b = seededRandom('x'); const c = seededRandom('y')
  const xs = Array.from({ length: 200 }, () => a())
  assert.deepEqual(xs, Array.from({ length: 200 }, () => b()))
  assert.ok(xs.every(x => x >= 0 && x < 1))
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => c()))

  // Orders a day: the same answer for the same day and seed; none for 0.
  assert.equal(dayCount(120, '2026-10-09', 's'), dayCount(120, '2026-10-09', 's'))
  assert.equal(dayCount(0, '2026-10-09'), 0)
  // Over a year the days average about what was asked; Saturdays are busier than Mondays.
  let total = 0; const sat = []; const mon = []
  for (let d = '2025-01-01'; d <= '2025-12-31'; d = nextDate(d)) {
    const n = dayCount(100, d, 'year')
    total += n
    const dow = new Date(d + 'T12:00:00Z').getUTCDay()
    if (dow === 6) sat.push(n)
    if (dow === 1) mon.push(n)
  }
  const mean = total / 365
  assert.ok(mean > 95 && mean < 105, 'a year averages about 100 a day, not ' + mean)
  const avg = list => list.reduce((s, x) => s + x, 0) / list.length
  assert.ok(avg(sat) > avg(mon) * 1.6, 'Saturdays ' + avg(sat) + ', Mondays ' + avg(mon))
  // And a little chance: the season alone moves a Saturday by a couple of orders a week.
  assert.ok(sat.some((n, i) => i > 0 && Math.abs(n - sat[i - 1]) > 5), 'a little chance from one Saturday to the next')

  // The venue's clock: London is UTC in winter and an hour ahead in summer.
  assert.equal(zonedMs('2026-01-15', 12 * 60, 'Europe/London'), Date.UTC(2026, 0, 15, 12))
  assert.equal(zonedMs('2026-07-01', 12 * 60, 'Europe/London'), Date.UTC(2026, 6, 1, 11))
  assert.equal(zonedMs('2026-01-15', 12 * 60, 'America/New_York'), Date.UTC(2026, 0, 15, 17))
  assert.equal(zonedMs('2026-10-25', 4 * 60, 'Europe/London'), Date.UTC(2026, 9, 25, 4), 'the morning the clocks go back')
  // West of UTC the first guess lands on the other side of the change.
  assert.equal(zonedMs('2026-03-08', 4 * 60, 'America/New_York'), Date.UTC(2026, 2, 8, 8), 'the morning the clocks go forward in New York')
  assert.equal(nextDate('2026-12-31'), '2027-01-01')
  assert.equal(nextDate('2028-02-28'), '2028-02-29')
  assert.equal(nextDate('2027-01-01', -1), '2026-12-31')

  // Random picks: at least each group's minimum, never more than its most,
  // no repeats unless the group takes them, nothing for a group the deal picks itself.
  const choices = [
    { key: 'size', min: 1, max: 1, options: [{ id: 's' }, { id: 'l' }] },
    { key: 'extras', min: 0, max: 2, options: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] },
    { key: 'dips', min: 2, max: 3, repeat: true, options: [{ id: 'd1' }] },
    { key: 'deal', min: 1, max: 1, fixed: ['f'], options: [{ id: 'f' }] },
  ]
  const r = seededRandom('picks')
  const seen = { extras: 0 }
  for (let i = 0; i < 300; i++) {
    const out = randomPicks(choices, {}, r)
    assert.equal(out.size.length, 1)
    assert.ok(['s', 'l'].includes(out.size[0].id))
    const ex = out.extras || []
    assert.ok(ex.length <= 2)
    assert.equal(new Set(ex.map(x => x.id)).size, ex.length, 'no repeats')
    if (ex.length) seen.extras++
    assert.ok(out.dips.length >= 2 && out.dips.length <= 3 && out.dips.every(x => x.id === 'd1'))
    assert.equal(out.deal, undefined)
  }
  assert.ok(seen.extras > 30 && seen.extras < 270, 'an optional group is picked now and then')
})

test('a day from the venue\'s own till config: through the rules, paid up, numbered, inside its trading day', async () => {
  const { config, staff } = await loadVenue()
  const date = ago(12)
  const dayId = crypto.randomUUID()
  const out = generateDay({ config, date, dayId, staff, count: 300, seed: 'one' })
  assert.deepEqual(out.refused, [], 'nothing refused by the till\'s rules')
  assert.equal(out.skipped, 0)
  assert.equal(out.checks.length, 300)

  const [start, end] = tradingDay(config, date)
  const till = config.devices.find(d => d.kind === 'terminal')
  assert.ok(till, 'the venue has a till')
  const numbers = new Set()
  for (const c of out.checks) {
    assert.ok(['closed', 'void'].includes(c.status), c.status)
    assert.equal(c.day_id, dayId)
    assert.equal(checkTotals(c).balance, 0, 'paid up')
    for (const at of timesOf(c)) {
      const ms = Date.parse(at)
      assert.ok(ms >= start && ms <= end, at + ' is inside the trading day ' + date)
    }
    assert.ok(Date.parse(c.closed_at) >= Date.parse(c.opened_at))
    // Every check from the venue's own till, numbered by it.
    assert.equal(c.opened_device_id, till.id)
    assert.equal(c.number_code, till.short_code)
    numbers.add(c.number_code + '-' + c.number)
  }
  assert.equal(numbers.size, out.checks.length, 'every check number once')

  // A trading day that starts in the middle of service (12:30): the tables
  // still eating when it ends have their last moments held at its end, never
  // after it, where the next day's first orders are.
  const midday = { ...config, settings: { ...config.settings, day_starts_at: '12:30' } }
  const late = generateDay({ config: midday, date, dayId, staff, count: 3000, seed: 'midday' })
  assert.deepEqual(late.refused, [], 'nothing refused by the till\'s rules')
  const [from, to] = tradingDay(midday, date)
  const moments = late.checks.flatMap(c => timesOf(c)).map(at => Date.parse(at))
  assert.ok(moments.some(ms => ms === to), 'some tables still there at the end of the day')
  for (const ms of moments) assert.ok(ms >= from && ms <= to, new Date(ms).toISOString() + ' is inside the trading day starting at 12:30')
  // The till numbers its checks in the order it opens them, from 1.
  const inOrder = [...out.checks].sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at))
  assert.deepEqual(inOrder.map(c => c.number), inOrder.map((_, i) => i + 1))
  // A party sits at a table big enough for it.
  for (const c of out.checks.filter(x => x.table_id)) {
    const t = config.tables.find(x => x.id === c.table_id)
    assert.ok(t && (t.max_covers == null || (c.covers || 0) <= t.max_covers), c.covers + ' at ' + t?.max_covers)
  }
  // A table holds one party at a time: the next opens after the last has paid.
  const byTable = {}
  for (const c of out.checks.filter(x => x.table_id)) (byTable[c.table_id] ||= []).push(c)
  assert.ok(Object.keys(byTable).length > 0)
  for (const list of Object.values(byTable)) {
    list.sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at))
    for (let i = 1; i < list.length; i++) {
      assert.ok(Date.parse(list[i].opened_at) >= Date.parse(list[i - 1].closed_at), 'table ' + list[i].table_id + ': ' + list[i - 1].closed_at + ' then ' + list[i].opened_at)
    }
  }

  // The stream wants guests and no courses (the fixture's Bar).
  const stream = config.revenue_streams.find(s => s.id === out.checks[0].revenue_stream_id)
  assert.ok(stream)
  if (stream.covers === 'must') assert.ok(out.checks.filter(c => c.mode !== 'counter').every(c => c.covers > 0))
  if (stream.courses === false) assert.ok(out.checks.every(c => c.lines.every(l => !l.course_id)))
  // Every dish with a course of its own: on its lines only where the stream uses courses.
  const course = crypto.randomUUID()
  const coursed = on => ({
    ...config,
    revenue_streams: config.revenue_streams.map(s => ({ ...s, courses: on })),
    items: Object.fromEntries(Object.entries(config.items).map(([k, it]) => [k, { ...it, course_id: course }])),
  })
  const noCourses = generateDay({ config: coursed(false), date, dayId, staff, count: 60, seed: 'one' })
  assert.ok(noCourses.checks.every(c => c.lines.every(l => !l.course_id)), 'no course on a stream without courses')
  const withCourses = generateDay({ config: coursed(true), date, dayId, staff, count: 60, seed: 'one' })
  assert.ok(withCourses.checks.some(c => c.lines.some(l => l.course_id === course)), 'the dish\'s course on a stream with courses')

  // The meal deal sold, each with its picked dish and that dish's size (the deal asks the copy of its group).
  const deal = Object.values(config.items).find(i => i.kind === 'combo')
  assert.ok(deal, 'the fixtures have a meal deal')
  const deals = out.checks.flatMap(c => c.lines.filter(l => l.item_id === deal.id))
  assert.ok(deals.length > 0, 'the meal deal sold')
  for (const l of deals) {
    assert.ok(l.combo?.length, 'with its parts')
    const pad = l.combo.find(x => x.item_id)
    assert.ok(pad?.modifiers?.length > 0, 'the part\'s size is picked')
  }
  // Something of everything a day has: guests at tables, cash and card, tips.
  const pays = out.checks.flatMap(c => c.payments || [])
  assert.ok(pays.some(x => x.tender === 'cash') && pays.some(x => x.tender === 'card_external'))
  assert.ok(pays.some(x => x.tip > 0))
  assert.ok(out.checks.some(c => c.mode === 'table' && c.table_id))
  // A table in a floor area with a revenue stream of its own sells in that
  // stream; the till's other checks (tables elsewhere, tabs) stay in the till's.
  const tillStream = out.checks.find(c => c.table_id).revenue_stream_id
  const patio = { ...config.revenue_streams.find(s => s.id === tillStream), id: crypto.randomUUID(), name: 'Zqt Patio' }
  const area = crypto.randomUUID()
  const inArea = new Set(config.tables.filter(t => t.id).filter((_, i) => i % 2 === 0).map(t => t.id))
  const split = generateDay({
    config: {
      ...config,
      revenue_streams: [...config.revenue_streams, patio],
      floor_areas: [...(config.floor_areas || []), { id: area, name: 'Zqt Patio', revenue_stream_id: patio.id }],
      tables: config.tables.map(t => (inArea.has(t.id) ? { ...t, floor_area_id: area } : t)),
    },
    date, dayId, staff, count: 300, seed: 'one',
  })
  assert.deepEqual(split.refused, [])
  const atTables = split.checks.filter(c => c.table_id)
  assert.ok(atTables.some(c => inArea.has(c.table_id)) && atTables.some(c => !inArea.has(c.table_id)), 'tables in the area and out of it')
  for (const c of split.checks) assert.equal(c.revenue_stream_id, inArea.has(c.table_id) ? patio.id : tillStream, c.table_id || c.mode)

  // The day's figures are the figures of its checks; the day is closed after them.
  assert.deepEqual(out.day.figures, dayFigures(out.checks, dayId))
  const last = Math.max(...out.checks.flatMap(c => [c.closed_at, ...(c.refunds || []).map(x => x.at)]).map(x => Date.parse(x)))
  assert.ok(Date.parse(out.day.closed_at) > last && Date.parse(out.day.closed_at) <= end)
  assert.ok(Date.parse(out.day.opened_at) <= Math.min(...out.checks.map(c => Date.parse(c.opened_at))))
  assert.ok(out.day.declared_cash >= 0)

  // The same day and seed again: the same sales; another seed, others.
  const again = generateDay({ config, date, dayId, staff, count: 300, seed: 'one' })
  assert.deepEqual(again.day.figures.sales, out.day.figures.sales)
  assert.deepEqual(again.day.figures.counts, out.day.figures.counts)
  const other = generateDay({ config, date, dayId, staff, count: 300, seed: 'two' })
  assert.notDeepEqual(other.day.figures.sales, out.day.figures.sales)
})

test('a venue with a kiosk and a counter till, and voids that need a manager', async () => {
  // A manager who can approve voids, and the switch that asks for one every time.
  const boss = await ok(owner.post('/api/pos/roles', { name: 'Zqt Manager', permissions: { void: true, refund: true, comp: true, manager: true, close_day: true } }))
  const lead = await ok(owner.post('/api/pos/roles', { name: 'Zqt Lead', permissions: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${filled.ids.staff2}/pos`, { pos_role_id: boss.id, pin: '4826' }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${filled.ids.staff}/pos`, { pos_role_id: lead.id, pin: '7351' }))
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { approvals: { void_sent: true } }))
  const kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Zqt Kiosk' })
  counter = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqt Counter', settings: { mode: 'counter' } })

  const { config, staff } = await loadVenue()
  const dayId = crypto.randomUUID()
  const out = generateDay({ config, date: ago(11), dayId, staff, count: 700, seed: 'kiosk' })
  assert.deepEqual(out.refused, [], 'nothing refused by the till\'s rules')
  assert.equal(out.checks.length, 700)
  assert.ok(out.checks.every(c => checkTotals(c).balance === 0))

  const k = config.devices.find(d => d.id === kiosk.id)
  const ct = config.devices.find(d => d.id === counter.id)
  const fromKiosk = out.checks.filter(c => c.opened_device_id === kiosk.id)
  assert.ok(fromKiosk.length > 100, 'about a third from the kiosk: ' + fromKiosk.length)
  for (const c of fromKiosk) {
    assert.equal(c.mode, 'counter')
    assert.equal(c.opened_by, kiosk.id, 'a kiosk order names the kiosk as its server')
    assert.ok(c.order_no >= k.settings.order_numbers.from && c.order_no <= k.settings.order_numbers.to, 'order number from the kiosk\'s range')
    assert.ok(!(c.charges || []).length, 'no charges on a kiosk order')
  }
  // Some paid at the counter, by someone on the staff.
  const staffIds = new Set(staff.map(s => s.id))
  const atCounter = fromKiosk.filter(c => c.payments.some(x => staffIds.has(x.by)))
  assert.ok(atCounter.length > 0, 'some kiosk orders paid at the counter')
  assert.ok(atCounter.length < fromKiosk.length / 2)
  // The counter till's orders take its range.
  const fromCounter = out.checks.filter(c => c.opened_device_id === counter.id)
  assert.ok(fromCounter.length > 0)
  for (const c of fromCounter) {
    assert.equal(c.mode, 'counter')
    assert.ok(c.order_no >= ct.settings.order_numbers.from && c.order_no <= ct.settings.order_numbers.to)
  }
  // The counter takes other order types now and then; the venue's charges
  // matrix gives the fixtures' Drive thru charges, so those orders carry them
  // (and only those: the matrix has nothing for the other types).
  const rules = (config.settings.charges || []).flatMap(x => x.where.map(w => w.stream + '|' + w.type))
  const charged = fromCounter.filter(c => (c.charges || []).length)
  assert.ok(rules.length > 0, 'the fixtures put charges in the matrix')
  assert.ok(charged.length > 0, 'some counter orders carry their stream and order type\'s charges')
  for (const c of charged) {
    assert.ok(rules.includes(c.revenue_stream_id + '|' + c.order_type_id), 'charges only where the matrix has them')
    // (Nothing counts on an order called off, or one whose every dish was voided.)
    if (!c.cancelled && c.lines.some(isActiveLine)) assert.ok(checkTotals(c).charges.some(x => x.amount > 0), 'a charge counts on the bill')
  }
  assert.ok(fromCounter.filter(c => !(c.charges || []).length).every(c => !rules.includes(c.revenue_stream_id + '|' + c.order_type_id)), 'no order the matrix charges goes without')
  // Each device numbers its own checks.
  const codes = new Set(out.checks.map(c => c.number_code + '-' + c.number))
  assert.equal(codes.size, out.checks.length)

  // Voids by the lead were approved by the manager; the manager's own need nobody.
  // (A void made by Cancel order carries no mark of its own on the line: leave
  // cancelled orders out to see the voids made by hand.)
  const voids = out.checks.filter(c => !c.cancelled).flatMap(c => c.lines.filter(l => l.voided).map(l => l.voided))
  for (const v of voids) {
    if (v.by === filled.ids.staff) assert.equal(v.approved_by, filled.ids.staff2, 'the lead\'s void approved by the manager')
    if (v.by === filled.ids.staff2) assert.equal(v.approved_by, null, 'a manager voids without anyone else')
  }
  assert.ok(out.day.closed_by === filled.ids.staff2, 'the day closed by the one who can close it')

  // Put the venue back as it was for the next tests.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { approvals: { void_sent: false } }))
})

test('a venue with no till yet: two stand-ins, one at the counter and one at tables; a busy day has a little of everything', async () => {
  const { config, staff } = await loadVenue()
  const DAY_PROMO = { id: crypto.randomUUID(), name: 'Zqt one day', kind: 'basket', discount_type: 'percent', discount_value: 10, apply_mode: 'auto', schedule: { from: ago(13), until: ago(13) } }
  const bare = { ...config, promotions: [DAY_PROMO], devices: (config.devices || []).filter(d => d.kind !== 'terminal' && d.kind !== 'kiosk') }
  // A busy day, so the rare things happen whatever the venue's (random) id
  // does to the seed: a refund is 1 in 250 orders.
  const out = generateDay({ config: bare, date: ago(13), dayId: crypto.randomUUID(), staff, count: 3000, seed: 'bare' })
  assert.deepEqual(out.refused, [], 'nothing refused by the till\'s rules')
  assert.equal(out.checks.length, 3000)
  assert.deepEqual([...new Set(out.checks.map(c => c.number_code))].sort(), ['T1', 'T2'])
  const t1 = out.checks.filter(c => c.number_code === 'T1')
  const t2 = out.checks.filter(c => c.number_code === 'T2')
  assert.ok(t1.length > 40 && t2.length > 40, 'both take orders: ' + t1.length + ' and ' + t2.length)
  assert.ok(t1.every(c => c.mode === 'counter' && c.order_no > 0), 'T1 is a counter till with order numbers')
  assert.ok(t2.every(c => c.mode !== 'counter' && c.order_no == null), 'T2 serves tables')
  assert.ok(t2.some(c => c.table_id))
  assert.ok(out.checks.every(c => c.opened_device_id == null), 'a stand-in is no device of the venue\'s')
  assert.equal(new Set(out.checks.map(c => c.number_code + '-' + c.number)).size, 3000, 'every check number once')
  assert.ok(out.checks.every(c => checkTotals(c).balance === 0))

  // A little of everything: voids (the lead's approved by the manager, whose
  // roles the test before gave them), cancelled orders, comps, discounts, refunds.
  const voids = out.checks.filter(c => !c.cancelled).flatMap(c => c.lines.filter(l => l.voided).map(l => l.voided))
  assert.ok(voids.some(v => v.by === filled.ids.staff), 'a void by the lead')
  for (const v of voids) if (v.by === filled.ids.staff) assert.equal(v.approved_by, filled.ids.staff2, 'the lead\'s void approved by the manager')
  assert.ok(out.checks.some(c => c.cancelled), 'an order cancelled')
  assert.ok(out.checks.some(c => c.discounts.some(d => d.comp)), 'a comp')
  assert.ok(out.checks.some(c => c.discounts.some(d => !d.comp)), 'a discount')
  assert.ok(out.checks.some(c => c.refunds.length), 'a refund')
  assert.ok(out.checks.some(c => c.payments.filter(x => !x.voided).length > 1), 'a bill split between guests')
  assert.ok(out.checks.some(c => c.payments.some(x => x.tendered > x.amount)), 'cash with change')
  // Promotions as they were on the day: one that ran on that day only is on
  // the day's orders, and on none two days before (the day before's late
  // tables pay after midnight, on its date, and rightly get it).
  const promoted = out.checks.filter(c => (c.promotions || []).some(x => x.promotion_id === DAY_PROMO.id))
  assert.ok(promoted.length > 2000, 'the day\'s promotion on its orders: ' + promoted.length)
  assert.ok(promoted.every(c => checkTotals(c).balance === 0))
  const before = generateDay({ config: bare, date: ago(15), dayId: crypto.randomUUID(), staff, count: 200, seed: 'bare' })
  assert.deepEqual(before.refused, [])
  assert.ok(before.checks.every(c => !(c.promotions || []).length), 'not on a day it didn\'t run')
})

// Day figures list tenders, staff and the rest in the order the checks come
// in, and the real close reads its checks in no set order either: compare
// them sorted.
const sorted = v => Array.isArray(v)
  ? v.map(sorted).map(x => [JSON.stringify(x), x]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(x => x[1])
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v

const GEN = `/test-data/till/generate`
const CLEAR = `/test-data/till/clear`

test('the routes: a dry run, a real day left alone, a closed day left out; what is stored and where it shows', async () => {
  const from = ago(9)
  const to = ago(3)
  const base = `/api/venues/${V}`
  // A real trading day on one of the dates, and the venue closed on another.
  const realDate = ago(5)
  const [realDay] = await sql`
    INSERT INTO pos_days (tenant_id, venue_id, business_date, z_number, opened_at, closed_at, figures)
    VALUES (${ids.a}, ${V}, ${realDate}, 7, now() - interval '5 days', now() - interval '5 days' + interval '9 hours', ${sql.json({ sales: { total: 1 } })})
    RETURNING id`
  await ok(owner.post(`${base}/schedule/exceptions`, { name: 'Zqt Closed', date_from: ago(7), date_to: ago(7), is_closed: true }))
  // A till promotion that ran on one of the days only (over by now).
  const dayPromo = await ok(owner.post('/api/promotions', {
    name: 'Zqt till day', kind: 'basket', discount_type: 'percent', discount_value: 10, apply_mode: 'auto',
    channels: ['pos'], schedule: { from: ago(4), until: ago(4), times: [] },
  }))
  const fill = [ago(9), ago(8), ago(6), ago(4), ago(3)]

  // The dry run says what it would make and makes nothing.
  const dry = await ok(owner.post(base + GEN, { date_from: from, date_to: to, per_day: 40, dry_run: true }))
  assert.equal(dry.dry_run, true)
  assert.equal(dry.days, 5)
  assert.equal(dry.closed_days, 1)
  assert.deepEqual(dry.real_days, [realDate])
  assert.equal(dry.orders, fill.reduce((s, d) => s + dayCount(40, d, '|' + V), 0))
  assert.deepEqual(dry.replaced, { days: 0, checks: 0 })
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_days WHERE venue_id = ${V} AND is_generated`)[0].n, 0)

  // Jo's last working day is in the middle of the range.
  const leaver = filled.ids.staff
  const leftOn = ago(6)
  await ok(owner.put(`/api/rota/venues/${V}/staff/${leaver}/leaving`, { left_on: leftOn }))

  // The real run makes what the dry run said.
  const made = await ok(owner.post(base + GEN, { date_from: from, date_to: to, per_day: 40 }))
  assert.equal(made.dry_run, false)
  assert.equal(made.days, 5)
  assert.equal(made.orders, dry.orders)
  assert.equal(made.left_out, 0)
  assert.equal(made.refused_count, 0, JSON.stringify(made.refused))

  const days = await sql`
    SELECT id, business_date::text AS business_date, z_number, closed_at, figures, is_generated FROM pos_days
     WHERE venue_id = ${V} AND is_generated ORDER BY business_date`
  assert.deepEqual(days.map(d => d.business_date), fill)
  const checks = await sql`
    SELECT id, day_id, state, is_generated, proj_v, last_seq, total, number_code FROM pos_checks WHERE venue_id = ${V}`
  assert.equal(checks.length, made.orders)
  assert.ok(checks.every(c => c.is_generated && c.proj_v === CHECK_BREAKDOWNS_V && Number(c.last_seq) === 0))
  // Jo takes orders up to their last day and none after it (two people share the tills).
  const dateOf = new Map(days.map(d => [d.id, d.business_date]))
  const jos = checks.filter(c => c.state.server_id === leaver || c.state.opened_by === leaver).map(c => dateOf.get(c.day_id))
  assert.ok(jos.some(d => d <= leftOn), 'Jo took orders before leaving')
  assert.deepEqual(jos.filter(d => d > leftOn), [], 'and none after their last day')
  await ok(owner.put(`/api/rota/venues/${V}/staff/${leaver}/leaving`, { left_on: null }))
  // Each day's stored figures are those of its stored checks.
  for (const d of days) {
    assert.equal(d.z_number, null)
    assert.ok(d.closed_at)
    const own = checks.filter(c => c.day_id === d.id).map(c => c.state)
    assert.ok(own.length > 0)
    assert.deepEqual(sorted(d.figures), sorted(dayFigures(own, d.id)), d.business_date)
  }
  // Promotions as they were on each day: the one-day promotion is on that
  // day's orders and no other day's (bills paid after midnight are on the
  // next date, so the day before's late tables don't get it either).
  const promoted = d => checks.filter(c => c.day_id === d.id && (c.state.promotions || []).some(x => x.promotion_id === dayPromo.id)).length
  for (const d of days) {
    if (d.business_date === ago(4)) assert.ok(promoted(d) > 0, 'the promotion on its day')
    else assert.equal(promoted(d), 0, d.business_date)
  }
  // The lines, payments and VAT rows are there, as the sequencer writes them.
  const states = checks.map(c => c.state)
  const [lines] = await sql`SELECT count(*)::int AS n FROM pos_check_lines WHERE venue_id = ${V}`
  assert.equal(lines.n, states.reduce((s, c) => s + c.lines.length, 0))
  const [paid] = await sql`SELECT COALESCE(sum(amount), 0)::int AS n FROM pos_payments WHERE venue_id = ${V} AND kind = 'payment' AND NOT voided`
  assert.equal(paid.n, states.reduce((s, c) => s + (c.payments || []).filter(x => !x.voided).reduce((t, x) => t + x.amount, 0), 0))
  const [vat] = await sql`SELECT count(*)::int AS n FROM pos_check_vat WHERE venue_id = ${V}`
  assert.ok(vat.n > 0)
  // Nothing left for the start-up fill-in to do.
  assert.equal(await backfillCheckProjections({ info() {}, warn() {} }), 0)
  // The real day is as it was.
  const [real] = await sql`SELECT z_number, figures, is_generated FROM pos_days WHERE id = ${realDay.id}`
  assert.deepEqual([real.z_number, real.figures, real.is_generated], [7, { sales: { total: 1 } }, false])

  // The report builder reads them as it reads real sales.
  const sum = key => days.reduce((s, d) => s + key(d.figures), 0)
  const res = await run({ subject: 'till.checks', values: measures(['checks', 'guests', 'net_sales', 'total_sales']) })
  const [r] = rowsOf(res)
  assert.equal(r.checks, sum(f => f.counts.closed))
  assert.equal(r.guests, sum(f => f.covers))
  assert.equal(p(r.net_sales), sum(f => f.sales.net))
  assert.equal(p(r.total_sales), sum(f => f.sales.total))
  const byDay = await run({ subject: 'till.checks', rows: ['date'], values: measures(['net_sales']) })
  const rows = rowsOf(byDay)
  assert.equal(rows.length, 5)
  for (const d of days) {
    const row = rows.find(x => Object.values(x).includes(d.business_date))
    assert.ok(row, 'a row for ' + d.business_date)
    assert.equal(p(row.net_sales), d.figures.sales.net, d.business_date)
  }

  // Till reports lists them as test days; a test day never goes into Cash Recon.
  const list = await ok(owner.get(`/api/pos/venues/${V}/days`))
  assert.equal(list.filter(d => d.is_generated).length, 5)
  assert.ok(list.find(d => d.id === realDay.id && d.is_generated === false && d.z_number === 7))
  const one = await ok(owner.get(`/api/pos/venues/${V}/days/${days[0].id}`))
  assert.equal(one.is_generated, true)
  assert.equal(one.live, false)
  assert.deepEqual(one.figures, days[0].figures)
  const recon = await owner.post(`/api/pos/venues/${V}/days/${days[0].id}/fill-recon`, {})
  assert.equal(recon.status, 422)
  assert.equal(recon.json.code, 'test_day')
  assert.equal((await sql`SELECT count(*)::int AS n FROM cash_daily_reports WHERE venue_id = ${V} AND report_date = ${days[0].business_date}`)[0].n, 0)
  const [after] = await sql`SELECT recon_filled_at, recon_error FROM pos_days WHERE id = ${days[0].id}`
  assert.deepEqual([after.recon_filled_at, after.recon_error], [null, null])

  // Tills never see them: not in their lists of checks and days, not by id, not in a sync.
  const devChecks = await device(counter, 'GET', '/pos-api/checks?status=closed&limit=200')
  assert.equal(devChecks.status, 200)
  assert.equal(devChecks.json.length, 0)
  const byId = await device(counter, 'GET', '/pos-api/checks/' + checks[0].id)
  assert.equal(byId.status, 404)
  const devDays = await device(counter, 'GET', '/pos-api/days')
  assert.deepEqual(devDays.json.map(d => d.id), [realDay.id])
  const sync = await device(counter, 'GET', '/pos-api/sync?since=0&source=cloud')
  assert.equal(sync.status, 200)
  assert.equal(sync.json.checks.length, 0)
  // Nor can a till act on one: an event naming a test check is refused as a
  // check it doesn't know, and the check stays as it was.
  const reopen = { id: ulid(), venue_id: V, device_id: counter.device_id, staff_id: filled.ids.staff2, check_id: checks[0].id, type: 'check.reopened', payload: { reason: 'Zqt test' }, client_at: new Date().toISOString() }
  const ev = await device(counter, 'POST', '/pos-api/events', { events: [reopen] })
  assert.equal(ev.status, 200, ev.body)
  assert.equal(ev.json.results[0].ok, false)
  assert.equal(ev.json.results[0].code, 'missing', JSON.stringify(ev.json.results[0]))
  const [still] = await sql`SELECT state->>'status' AS status, last_seq FROM pos_checks WHERE id = ${checks[0].id}`
  assert.deepEqual([still.status, Number(still.last_seq)], [checks[0].state.status, 0])

  // Made again: the days are replaced, never doubled.
  const again = await ok(owner.post(base + GEN, { date_from: from, date_to: to, per_day: 40 }))
  assert.deepEqual(again.replaced, { days: 5, checks: made.orders })
  assert.equal(again.orders, made.orders, 'the same days and seed make the same number of orders')
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_checks WHERE venue_id = ${V}`)[0].n, again.orders)
  const twice = await sql`SELECT business_date FROM pos_days WHERE venue_id = ${V} GROUP BY business_date HAVING count(*) > 1`
  assert.equal(twice.length, 0)
  // With the closed day too, and a seed of its own.
  const withClosed = await ok(owner.post(base + GEN, { date_from: from, date_to: to, per_day: 40, skip_closed: false, seed: 'Busy week' }))
  assert.equal(withClosed.days, 6)
  assert.equal(withClosed.closed_days, 0)
  assert.ok((await sql`SELECT 1 FROM pos_days WHERE venue_id = ${V} AND business_date = ${ago(7)} AND is_generated`).length)
})

test('Clear removes only the test days, after a dry run and a confirm', async () => {
  const base = `/api/venues/${V}`
  const from = ago(9)
  const to = ago(3)
  const [before] = await sql`SELECT count(*)::int AS days FROM pos_days WHERE venue_id = ${V} AND is_generated`
  assert.ok(before.days > 0)
  // The real trading days: the one made above, and today's, opened by the
  // till's event in the test before (any till event opens the day).
  const real = await sql`SELECT id, business_date::text AS d FROM pos_days WHERE venue_id = ${V} AND NOT is_generated ORDER BY id`
  assert.ok(real.some(r => r.d === ago(5)))
  // Without confirm, nothing goes.
  const noConfirm = await owner.post(base + CLEAR, { date_from: from, date_to: to })
  assert.equal(noConfirm.status, 422)
  const dry = await ok(owner.post(base + CLEAR, { date_from: from, date_to: to, dry_run: true }))
  assert.equal(dry.dry_run, true)
  assert.equal(dry.days, before.days)
  const [n] = await sql`SELECT count(*)::int AS n FROM pos_checks WHERE venue_id = ${V} AND is_generated`
  assert.equal(dry.checks, n.n)
  // Part of the range first, then the rest.
  const part = await ok(owner.post(base + CLEAR, { date_from: from, date_to: ago(8), confirm: true }))
  assert.equal(part.days, 2)
  const gone = await ok(owner.post(base + CLEAR, { all: true, confirm: true }))
  assert.equal(gone.days, before.days - 2)
  assert.equal(part.checks + gone.checks, n.n)
  for (const table of ['pos_checks', 'pos_check_lines', 'pos_payments', 'pos_check_vat', 'pos_check_discounts', 'pos_check_charges']) {
    assert.equal((await sql`SELECT count(*)::int AS n FROM ${sql(table)} WHERE venue_id = ${V}`)[0].n, 0, table)
  }
  // The real trading days stay, and only they.
  const left = await sql`SELECT id, business_date::text AS d FROM pos_days WHERE venue_id = ${V} ORDER BY id`
  assert.deepEqual([...left], [...real])
  // Nothing to clear says so.
  const none = await ok(owner.post(base + CLEAR, { all: true, dry_run: true }))
  assert.deepEqual([none.days, none.checks], [0, 0])
  assert.equal((await owner.post(base + CLEAR, { dry_run: true })).status, 422, 'no range and not all')
  assert.equal((await owner.post(base + CLEAR, { date_from: to, date_to: from, confirm: true })).status, 422)
})

test('refusals: the range, too many orders, a venue without staff, roles and other groups', async () => {
  const base = `/api/venues/${V}`
  const refused = async (body, status, code) => {
    const r = await owner.post(base + GEN, body)
    assert.equal(r.status, status, JSON.stringify(body) + ' ' + JSON.stringify(r.json))
    if (code) assert.equal(r.json.code, code, JSON.stringify(r.json))
    return r
  }
  await refused({ date_from: ago(2), date_to: today, per_day: 10 }, 422, 'range')
  await refused({ date_from: ago(2), date_to: nextDate(today, 5), per_day: 10 }, 422, 'range')
  await refused({ date_from: ago(3), date_to: ago(5), per_day: 10 }, 422, 'range')
  await refused({ date_from: ago(40), date_to: ago(9), per_day: 10 }, 422, 'range')
  await refused({ date_from: ago(1200), date_to: ago(1195), per_day: 10 }, 422, 'range')
  // "Today" is the trading day open now, not the calendar day: with the day
  // starting at 23:59, until then a till still opens yesterday's date, so
  // that date can't be filled; the day before it can.
  const { config } = await loadVenue()
  const tz = config.venue?.timezone || 'Europe/London'
  const usual = config.settings?.day_starts_at || '04:00'
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { day_starts_at: '23:59' }))
  try {
    const open = businessDate(new Date(), tz, '23:59')
    await refused({ date_from: nextDate(open, -2), date_to: open, per_day: 10, dry_run: true }, 422, 'range')
    await ok(owner.post(base + GEN, { date_from: nextDate(open, -2), date_to: nextDate(open, -1), per_day: 10, dry_run: true }))
    // Except in the minute after 23:59, that is the calendar's yesterday.
    const calendar = localParts(new Date(), tz).date
    if (open !== calendar) assert.equal(open, nextDate(calendar, -1))
  } finally {
    await ok(owner.patch(`/api/pos/venues/${V}/settings`, { day_starts_at: usual }))
  }
  await refused({ date_from: ago(31), date_to: ago(1), per_day: 1000 }, 422, 'too_many')
  await refused({ date_from: ago(5), date_to: ago(3), per_day: 0 }, 400)
  await refused({ date_from: ago(5), date_to: ago(3), per_day: 1001 }, 400)
  await refused({ date_from: '5 days ago', date_to: ago(3), per_day: 10 }, 400)
  await refused({ date_from: ago(5), date_to: ago(3), per_day: 10, seed: 'x'.repeat(41) }, 400)
  // A venue with nobody to take the orders.
  const r = await owner.post(`/api/venues/${filled.ids.venue2}` + GEN, { date_from: ago(5), date_to: ago(3), per_day: 10 })
  assert.equal(r.status, 422)
  assert.ok(['no_staff', 'no_dishes'].includes(r.json.code), JSON.stringify(r.json))
  // Only Test data manage; another group's venue is not found.
  for (const who of [A.admin]) {
    const res = await as(who, ids.a).post(base + GEN, { date_from: ago(5), date_to: ago(4), per_day: 3, dry_run: true })
    assert.equal(res.status, 200, who)
  }
  for (const who of [A.operator, A.viewer]) {
    assert.equal((await as(who, ids.a).post(base + GEN, { date_from: ago(5), date_to: ago(4), per_day: 3, dry_run: true })).status, 403, who)
    assert.equal((await as(who, ids.a).post(base + CLEAR, { all: true, dry_run: true })).status, 403, who)
  }
  const theirs = as(B.owner, ids.b)
  assert.equal((await theirs.post(base + GEN, { date_from: ago(5), date_to: ago(4), per_day: 3 })).status, 404)
  assert.equal((await theirs.post(base + CLEAR, { all: true, confirm: true })).status, 404)
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_checks WHERE venue_id = ${V}`)[0].n, 0, 'nothing made by a refused request')
})
