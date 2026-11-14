// The report builder's H&S days (docs/REPORTS.md 20, phase 3b) against the
// Overview's H&S status tiles for the same days (GET /api/dashboard-tiles/hs-status):
// each venue's day, its colour, and the checks due, done, missed and left
// unresolved, kind by kind. The days are worked out in code for each run
// (reports/work/safety.js) by computeHsStatus(), the tiles' own rule.
//
// The fixtures set up one venue (Ware: a fridge with a morning check, a hot
// hold station with a lunch check, a cooking session and a daily checklist)
// and a second with nothing set up (Hertford); the H&S test data filled
// 12-14 Oct 2026 at Ware. The tests change a few of those days.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { runner, rowsOf, measures, refused } from './support/reports.mjs'
import { STARTERS } from '../src/reports/starters/index.js'
import { CATALOGUE } from '../src/reports/catalogue/index.js'
import { hsSpans, MAX_DAYS } from '../src/reports/work/safety.js'
import { deriveStatus } from '../src/services/hsStatus.js'
import { todayIn, addDays } from '../../shared/reports/period.js'

let ids, owner, V, V2, VB, run, runB
let names            // venue id -> name, tenant A's

const HS = { from: '2026-10-12', to: '2026-10-19' }
const inPeriod = (from, to = from) => ({ field: 'date', op: 'in_period', value: { from, to } })
const starterSpec = key => STARTERS.find(s => s.key === key).spec
const SUBJECT = CATALOGUE.subjects['safety.days']

// Every field of a day the tests compare (30 at most in a list).
const FIELDS = [
  'date', 'venue.name', 'status', 'fs_status', 'closed', 'due', 'done', 'missed', 'unresolved',
  'checklists_due', 'checklists_done', 'checklists_missed',
  'fridge_due', 'fridge_done', 'fridge_missed', 'fridge_unresolved',
  'hold_due', 'hold_done', 'hold_missed', 'hold_unresolved',
  'cooking_due', 'cooking_done', 'cooking_missed', 'cooking_unresolved',
  'deliveries', 'deliveries_unresolved', 'fs_due', 'fs_done', 'fs_missed',
]

// What the Overview's answer says of a venue's day, in the report's words.
function fromPage(v) {
  const cat = key => v.categories.find(c => c.key === key) || { expected: 0, completed: 0, unresolved: 0 }
  const f = cat('equipment'), h = cat('hold'), c = cat('cooking'), dl = cat('delivery')
  const required = v.checklists.filter(x => !x.not_required)
  const short = (due, done) => Math.max(due - done, 0)
  const fsDue = f.expected + h.expected + c.expected
  const fsDone = f.completed + h.completed + c.completed
  return {
    status: v.status, closed: v.closed,
    // Food safety by the tiles' own colours: its checks due and done, and anything unresolved.
    fs_status: v.closed && fsDue === 0 && v.unresolved === 0 ? 'closed' : deriveStatus(fsDue, fsDone, v.unresolved),
    due: v.expected, done: v.completed, missed: short(v.expected, v.completed), unresolved: v.unresolved,
    checklists_due: required.length, checklists_done: required.filter(x => x.completed).length,
    checklists_missed: required.filter(x => !x.completed).length,
    fridge_due: f.expected, fridge_done: f.completed, fridge_missed: short(f.expected, f.completed), fridge_unresolved: f.unresolved,
    hold_due: h.expected, hold_done: h.completed, hold_missed: short(h.expected, h.completed), hold_unresolved: h.unresolved,
    cooking_due: c.expected, cooking_done: c.completed, cooking_missed: short(c.expected, c.completed), cooking_unresolved: c.unresolved,
    deliveries: dl.expected, deliveries_unresolved: dl.unresolved,
    fs_due: fsDue, fs_done: fsDone, fs_missed: short(fsDue, fsDone),
  }
}

const page = (from, to = from) => ok(owner.get(`/api/dashboard-tiles/hs-status?from=${from}&to=${to}&today=${to}`))
const list = async (from, to = from, go = run, levels) => rowsOf(await go({ subject: 'safety.days', kind: 'list', rows: FIELDS, filters: [inPeriod(from, to)] }, undefined, levels ? { levels } : undefined))
const keyOf = (date, name) => date + '|' + name

/** Each venue-day of the report held to the Overview's for the same days. */
async function sameAsPage(from, to = from) {
  const tiles = await page(from, to)
  const rows = await list(from, to)
  const byDay = new Map(rows.map(r => [keyOf(r.date, r['venue.name']), r]))
  let n = 0
  for (const d of tiles.days) {
    for (const v of d.venues) {
      n++
      const r = byDay.get(keyOf(d.date, v.venue_name))
      assert.ok(r, 'a row for ' + d.date + ' at ' + v.venue_name)
      for (const [k, want] of Object.entries(fromPage(v))) assert.equal(r[k], want, d.date + ' ' + v.venue_name + ' ' + k)
      // Nothing is ever more than done: a check done is one due now.
      for (const kind of ['', 'fridge_', 'hold_', 'cooking_', 'fs_', 'checklists_']) {
        assert.ok(r[kind + 'done'] <= r[kind + 'due'], d.date + ' ' + v.venue_name + ' ' + kind + 'done <= due')
      }
    }
  }
  assert.equal(rows.length, n, 'one row a venue a day')
  return { tiles, rows, byDay }
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const other = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  V2 = filled.ids.venue2
  VB = other.ids.venue
  run = runner(ids.a)
  runB = runner(ids.b)
  names = new Map((await sql`SELECT id::text AS id, name FROM venues WHERE tenant_id = ${ids.a}`).map(v => [v.id, v.name]))
})
after(closeApp)

test('each venue\'s H&S day is the Overview\'s own, kind by kind', async () => {
  // A fridge reading out of range on the Tuesday with nothing done about it,
  // and the Wednesday's hold check never made.
  const [reading] = await sql`SELECT id FROM fs_temp_logs WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND log_date = '2026-10-13' LIMIT 1`
  assert.ok(reading, 'the Tuesday\'s fridge reading')
  await sql`UPDATE fs_temp_logs SET is_within_range = false, corrective_action = NULL WHERE id = ${reading.id}`
  const gone = await sql`DELETE FROM fs_hold_checks WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND check_date = '2026-10-14' RETURNING id`
  assert.equal(gone.length, 1, 'the Wednesday\'s hold check')

  const { byDay } = await sameAsPage(HS.from, HS.to)
  const ware = date => byDay.get(keyOf(date, names.get(V)))
  const hertford = date => byDay.get(keyOf(date, names.get(V2)))
  // As known: the Tuesday needs action for the fridge, the Wednesday missed
  // its hold check, and nothing was done after the test data's three days.
  assert.deepEqual([ware('2026-10-13').fridge_unresolved, ware('2026-10-13').status, ware('2026-10-13').fs_status], [1, 'red', 'red'])
  assert.deepEqual([ware('2026-10-14').hold_due, ware('2026-10-14').hold_done, ware('2026-10-14').hold_missed], [1, 0, 1])
  for (let d = '2026-10-15'; d <= HS.to; d = addDays(d, 1)) {
    assert.equal(ware(d).done, 0, d + ' nothing done')
    assert.ok(ware(d).due > 0, d + ' checks due')
    assert.equal(ware(d).status, 'red', d)
  }
  // Hertford has nothing set up: nothing due, every day grey.
  for (let d = HS.from; d <= HS.to; d = addDays(d, 1)) assert.deepEqual([hertford(d).due, hertford(d).status, hertford(d).fs_status], [0, 'grey', 'grey'], d)
})

test('the days add up, and days still to come are never rows', async () => {
  const tiles = await page(HS.from, HS.to)
  const days = new Map()
  for (const d of tiles.days) for (const v of d.venues) {
    if (!days.has(v.venue_name)) days.set(v.venue_name, [])
    days.get(v.venue_name).push(fromPage(v))
  }
  const counts = {
    days: () => true, days_judged: x => ['green', 'amber', 'red'].includes(x.status), days_clear: x => x.status === 'green',
    days_attention: x => x.status === 'amber', days_action: x => x.status === 'red', days_closed: x => x.closed,
    days_missed: x => x.missed > 0, days_unresolved: x => x.unresolved > 0,
    days_fs_judged: x => ['green', 'amber', 'red'].includes(x.fs_status), days_fs_clear: x => x.fs_status === 'green',
    days_fs_action: x => x.fs_status === 'red', days_fs_missed: x => x.fs_missed > 0,
  }
  const totals = {
    due_total: 'due', done_total: 'done', missed_total: 'missed', unresolved_total: 'unresolved',
    checklists_due_total: 'checklists_due', checklists_done_total: 'checklists_done', checklists_missed_total: 'checklists_missed',
    fridge_due_total: 'fridge_due', fridge_done_total: 'fridge_done', fridge_missed_total: 'fridge_missed', fridge_unresolved_total: 'fridge_unresolved',
    hold_due_total: 'hold_due', hold_done_total: 'hold_done', hold_missed_total: 'hold_missed', hold_unresolved_total: 'hold_unresolved',
    cooking_due_total: 'cooking_due', cooking_done_total: 'cooking_done', cooking_missed_total: 'cooking_missed', cooking_unresolved_total: 'cooking_unresolved',
    deliveries_total: 'deliveries', deliveries_unresolved_total: 'deliveries_unresolved',
    fs_due_total: 'fs_due', fs_done_total: 'fs_done', fs_missed_total: 'fs_missed',
  }
  const shares = { clear_rate: ['days_clear', 'days_judged'], fs_clear_rate: ['days_fs_clear', 'days_fs_judged'], done_rate: ['done_total', 'due_total'], checklists_done_rate: ['checklists_done_total', 'checklists_due_total'], fs_done_rate: ['fs_done_total', 'fs_due_total'] }
  // 54 figures at most: in parts (20 values a report).
  const keys = [...Object.keys(counts), ...Object.keys(totals), ...Object.keys(shares)]
  assert.equal(keys.length, Object.keys(SUBJECT.measures).length, 'every figure is checked')
  const got = new Map()
  for (let i = 0; i < keys.length; i += 20) {
    const res = await run({ subject: 'safety.days', rows: ['venue.name'], values: measures(keys.slice(i, i + 20)), filters: [inPeriod(HS.from, HS.to)] })
    for (const r of rowsOf(res)) got.set(r['venue.name'], { ...got.get(r['venue.name']), ...r })
  }
  assert.equal(got.size, 2, 'both venues')
  for (const [name, list] of days) {
    const r = got.get(name)
    const want = {}
    for (const [k, f] of Object.entries(counts)) want[k] = list.filter(f).length
    for (const [k, f] of Object.entries(totals)) want[k] = list.reduce((s, x) => s + x[f], 0)
    for (const [k, w] of Object.entries(want)) assert.equal(r[k], w, name + ' ' + k)
    for (const [k, [num, den]] of Object.entries(shares)) {
      if (!want[den]) assert.equal(r[k], null, name + ' ' + k + ': nothing to share out')
      // Shares come back to six places.
      else assert.ok(Math.abs(r[k] - want[num] / want[den]) < 1e-6, name + ' ' + k + ': ' + r[k])
    }
  }

  // A period running past today: today is the last row, and nothing is "upcoming".
  const today = todayIn('Europe/London')
  const ahead = rowsOf(await run({ subject: 'safety.days', kind: 'list', rows: ['date', 'venue.name', 'status'], filters: [inPeriod(addDays(today, -1), addDays(today, 6))] }))
  assert.deepEqual([...new Set(ahead.map(r => r.date))].sort(), [addDays(today, -1), today])
  assert.equal(ahead.length, 4, 'two venues, two days')
  assert.ok(ahead.every(r => r.status !== 'upcoming'))
  // A period wholly to come has no rows at all.
  assert.equal((await list(addDays(today, 1), addDays(today, 7))).length, 0)
})

test('a report over every day starts at the first check anyone logged', async () => {
  const res = await run({ subject: 'safety.days', kind: 'list', rows: ['date', 'venue.name'] })
  const rows = rowsOf(res)
  const [first] = await sql`
    SELECT LEAST(
      (SELECT min(log_date) FROM fs_temp_logs WHERE tenant_id = ${ids.a}),
      (SELECT min(check_date) FROM fs_hold_checks WHERE tenant_id = ${ids.a}),
      (SELECT min(check_date) FROM fs_cooking_checks WHERE tenant_id = ${ids.a}),
      (SELECT min(delivery_date) FROM fs_delivery_checks WHERE tenant_id = ${ids.a}),
      (SELECT min(period_start) FROM checklist_instances WHERE tenant_id = ${ids.a}))::text AS day`
  const today = todayIn('Europe/London')
  const dates = rows.map(r => r.date).sort()
  assert.equal(dates[0], first.day, 'from the first day anything was logged')
  assert.equal(dates[dates.length - 1], today, 'to today')
  let span = 0
  for (let d = first.day; d <= today; d = addDays(d, 1)) span++
  assert.equal(rows.length, span * 2, 'every day at both venues')
})

test('the venues asked for, and only the group\'s own', async () => {
  const spec = starterSpec('safety_food_safety_by_venue')
  const given = venues => ({ period: { from: HS.from, to: HS.to }, venues })
  const one = rowsOf(await run(spec, given([V])))
  assert.deepEqual(one.map(r => r['venue.name']), [names.get(V)])
  const both = rowsOf(await run(spec, given([V, V2])))
  assert.deepEqual(both.map(r => r['venue.name']).sort(), [names.get(V), names.get(V2)].sort())

  // The other group: its own venues only, and none of A's even when named.
  const theirs = await list(HS.from, HS.to, runB)
  assert.ok(theirs.length > 0, 'the other group has days')
  assert.ok(theirs.every(r => ![...names.values()].includes(r['venue.name'])), 'none of A\'s venues')
  assert.equal(rowsOf(await runB(spec, given([V]))).length, 0, 'A\'s venue named by B')
  const [mine] = rowsOf(await runB(spec, given([VB])))
  assert.ok(mine, 'B\'s own venue')
})

test('a closed day expects no daily checks, but a reading out of range still counts', async () => {
  // H&S follows opening days, and Ware closes for a refit on the Friday.
  await ok(owner.patch('/api/hs-settings', { follow_opening_days: true }))
  await ok(owner.post(`/api/venues/${V}/schedule/exceptions`, { name: 'Refit', date_from: '2026-10-16', date_to: '2026-10-17', is_closed: true }))
  // A fridge reading out of range on the Saturday, while closed.
  const [walkIn] = await sql`SELECT id FROM fs_equipment WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND is_active ORDER BY created_at LIMIT 1`
  const [morning] = await sql`SELECT id FROM fs_capture_times WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND is_active ORDER BY created_at LIMIT 1`
  await ok(owner.post('/api/food-safety/temp-logs', { venue_id: V, equipment_id: walkIn.id, capture_time_id: morning.id, log_date: '2026-10-17', temperature_c: 12 }))

  const { byDay } = await sameAsPage('2026-10-15', '2026-10-18')
  const ware = date => byDay.get(keyOf(date, names.get(V)))
  // The Friday: closed, nothing due, nothing unresolved.
  assert.deepEqual(
    [ware('2026-10-16').closed, ware('2026-10-16').status, ware('2026-10-16').fs_status, ware('2026-10-16').due, ware('2026-10-16').checklists_due],
    [true, 'closed', 'closed', 0, 0])
  // The Saturday: closed, but the reading out of range needs action; it isn't a check done.
  assert.deepEqual(
    [ware('2026-10-17').closed, ware('2026-10-17').status, ware('2026-10-17').fs_status, ware('2026-10-17').fridge_unresolved, ware('2026-10-17').fridge_done],
    [true, 'red', 'red', 1, 0])
  // Open either side.
  assert.deepEqual([ware('2026-10-15').closed, ware('2026-10-18').closed], [false, false])
  const [sum] = rowsOf(await run({ subject: 'safety.days', values: measures(['days', 'days_closed', 'days_unresolved']), filters: [inPeriod('2026-10-16', '2026-10-17'), { field: 'venue', op: 'in', value: [V] }] }))
  assert.deepEqual([sum.days, sum.days_closed, sum.days_unresolved], [2, 2, 1])
})

test('a fridge, check time or hold station taken out no longer counts as done', async () => {
  const day = '2026-10-12'
  const [walkIn] = await sql`SELECT id FROM fs_equipment WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND is_active ORDER BY created_at LIMIT 1`
  const [morning] = await sql`SELECT id FROM fs_capture_times WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND is_active ORDER BY created_at LIMIT 1`
  const [lunch] = await sql`SELECT id FROM fs_hold_capture_times WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND is_active ORDER BY created_at LIMIT 1`
  const wareOn = async () => (await sameAsPage(day)).byDay.get(keyOf(day, names.get(V)))
  const kinds = r => [r.fridge_due, r.fridge_done, r.hold_due, r.hold_done]
  assert.deepEqual(kinds(await wareOn()), [1, 1, 1, 1], 'the test data\'s day: one of each, done')

  // A second fridge and an evening check, all logged that day: four due, four done.
  const bar = await ok(owner.post('/api/food-safety/equipment', { venue_id: V, name: 'Bar fridge', equipment_type: 'fridge', min_temp_c: 0, max_temp_c: 5 }))
  const evening = await ok(owner.post('/api/food-safety/capture-times', { venue_id: V, label: 'Evening', time_of_day: '18:00' }))
  for (const [eq, ct] of [[bar.id, morning.id], [bar.id, evening.id], [walkIn.id, evening.id]]) {
    await ok(owner.post('/api/food-safety/temp-logs', { venue_id: V, equipment_id: eq, capture_time_id: ct, log_date: day, temperature_c: 3 }))
  }
  // A second hold station, logged at lunch: two due, two done.
  const pass2 = await ok(owner.post('/api/food-safety/hold-stations', { venue_id: V, name: 'Pass 2', hold_type: 'hot_hold', min_temp_c: 63 }))
  await ok(owner.post('/api/food-safety/holds', { venue_id: V, station_id: pass2.id, capture_time_id: lunch.id, check_date: day, temperature_c: 70 }))
  assert.deepEqual(kinds(await wareOn()), [4, 4, 2, 2])

  // Taken out: the bar fridge (two due, two done: the walk-in's), then the
  // evening check (one and one), then the second station.
  await ok(owner.delete(`/api/food-safety/equipment/${bar.id}`))
  assert.deepEqual(kinds(await wareOn()), [2, 2, 2, 2])
  await ok(owner.delete(`/api/food-safety/capture-times/${evening.id}`))
  await ok(owner.delete(`/api/food-safety/hold-stations/${pass2.id}`))
  const after = await wareOn()
  assert.deepEqual(kinds(after), [1, 1, 1, 1], 'readings of what was taken out aren\'t checks done')
  assert.equal(after.missed, 0)
})

test('checklist parts need Checklists; a role without them can\'t group or filter by them', async () => {
  const FS = { food_safety: 'view' }
  const label = k => SUBJECT.measures[k].label
  const res = await run({ subject: 'safety.days', rows: ['date'], values: measures(['due_total', 'unresolved_total', 'fs_missed_total', 'clear_rate', 'fs_clear_rate']), filters: [inPeriod(HS.from, HS.to)] }, undefined, { levels: FS })
  assert.deepEqual(res.columns.filter(c => c.role === 'value').map(c => c.key), ['unresolved_total', 'fs_missed_total', 'fs_clear_rate'])
  assert.deepEqual(res.meta.notes, [
    label('due_total') + ' is left out: your role can\'t see it',
    label('clear_rate') + ' is left out: your role can\'t see it',
  ])
  // A list leaves the H&S status out with a note; grouping, filtering or
  // sorting by it would tell what it holds.
  const lst = await run({ subject: 'safety.days', kind: 'list', rows: ['date', 'venue.name', 'status', 'fs_status'], filters: [inPeriod(HS.from, HS.to)] }, undefined, { levels: FS })
  assert.deepEqual(lst.columns.map(c => c.key), ['date', 'venue.name', 'fs_status'])
  for (const spec of [
    { subject: 'safety.days', rows: ['status'], values: measures(['days']) },
    { subject: 'safety.days', values: measures(['days']), filters: [{ field: 'status', op: 'in', value: ['red'] }] },
    { subject: 'safety.days', kind: 'list', rows: ['date', 'fs_status'], sort: [{ by: 'missed', dir: 'desc' }] },
  ]) assert.equal((await refused(run(spec, undefined, { levels: FS }))).status, 403, JSON.stringify(spec))
  // Without Food safety logs the days can't be reported on at all.
  assert.equal((await refused(run({ subject: 'safety.days', values: measures(['days']) }, undefined, { levels: { checklists: 'view' } }))).status, 403)
  // With both, every part.
  const all = await run({ subject: 'safety.days', rows: ['status'], values: measures(['days', 'due_total']), filters: [inPeriod(HS.from, HS.to)] }, undefined, { levels: { ...FS, checklists: 'view' } })
  assert.ok(rowsOf(all).length > 0)
})

test('the runs of days worked out: joined, cut at today, three years at most', () => {
  const last = '2026-11-14'
  assert.deepEqual(hsSpans(null, null, last), [], 'nothing logged, every day')
  assert.deepEqual(hsSpans(null, '2026-10-12', last), [{ from: '2026-10-12', to: last }])
  const asked = [{ from: '2026-10-08', to: '2026-10-10' }, { from: '2026-10-01', to: '2026-10-07' }]
  assert.deepEqual(hsSpans(asked, null, last), [{ from: '2026-10-01', to: '2026-10-10' }], 'next to each other: one run')
  assert.deepEqual(asked, [{ from: '2026-10-08', to: '2026-10-10' }, { from: '2026-10-01', to: '2026-10-07' }], 'what was asked stays as it was')
  assert.deepEqual(hsSpans([{ from: '2026-10-05', to: '2026-10-20' }, { from: '2026-10-01', to: '2026-10-07' }], null, last), [{ from: '2026-10-01', to: '2026-10-20' }], 'overlapping')
  assert.deepEqual(hsSpans([{ from: '2026-01-01', to: '2026-01-07' }, { from: '2026-02-01', to: '2026-02-07' }], null, last),
    [{ from: '2026-01-01', to: '2026-01-07' }, { from: '2026-02-01', to: '2026-02-07' }], 'apart')
  assert.deepEqual(hsSpans([{ from: '2026-11-10', to: '2026-11-30' }], null, last), [{ from: '2026-11-10', to: last }], 'cut at today')
  assert.deepEqual(hsSpans([{ from: '2026-12-01', to: '2026-12-07' }], null, last), [], 'all to come')
  const [long] = hsSpans([{ from: '2020-01-01', to: last }], null, last)
  assert.equal(long.from, addDays(last, -(MAX_DAYS - 1)), 'the most recent days')
  let n = 0
  for (let d = long.from; d <= long.to; d = addDays(d, 1)) n++
  assert.equal(n, MAX_DAYS)
})

test('the H&S day starters: status by day, food safety by venue, the days needing action', async () => {
  const given = { period: { from: HS.from, to: HS.to } }
  const tiles = await page(HS.from, HS.to)
  const byDay = rowsOf(await run(starterSpec('safety_hs_status_by_day'), given))
  assert.deepEqual(byDay.map(r => r.date), tiles.days.map(d => d.date), 'a row a day, in order')
  for (const d of tiles.days) {
    const r = byDay.find(x => x.date === d.date)
    assert.deepEqual([r.due_total, r.done_total, r.unresolved_total, r.days_action],
      [d.expected, d.completed, d.unresolved, d.venues.filter(v => v.status === 'red').length], d.date)
  }
  const needing = rowsOf(await run(starterSpec('safety_days_needing_action'), given))
  const want = []
  for (const d of tiles.days) for (const v of d.venues) if (fromPage(v).fs_status === 'red') want.push(keyOf(d.date, v.venue_name))
  assert.ok(want.length > 0)
  assert.deepEqual(needing.map(r => keyOf(r.date, r['venue.name'])).sort(), want.sort())
})
