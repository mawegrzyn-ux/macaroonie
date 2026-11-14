// Figures from other subjects in one report (docs/REPORTS.md 7.1, phase
// 3c): till sales beside the hours and pay on the rota, a rota week beside
// its days. Each other subject is grouped by what the report's rows show in
// a statement of its own and lined up by its keys, so:
//
//   - each subject's figures are exactly what that subject gives run alone
//     with the same grouping and the same period and venues
//   - a row either subject has is a row (the other's figures 0 there)
//   - totals, a period beside the one before and "everything else" add up
//     each subject on its own: nothing is counted twice
//   - a part the role can't see, or one that can't be lined up with the
//     rows, is left out with a note (refused when a report is saved)
//
// The data: the fixtures' venue sells two till days moved into its rota
// week (Monday 19 October, Jo's lunch), and Ware and Hertford get three rota
// weeks from 7 September (support/rotaWeek.mjs).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { fillRotaWeeks } from './support/rotaWeek.mjs'
import { runner, rowsOf, totalsRow, refused, LEVELS } from './support/reports.mjs'
import { compileReport } from '../src/reports/compile.js'
import { normaliseReport, resolveParams } from '../../shared/reports/spec.js'

let ids, owner, run
let V0, V, W, here, seed

const period = (from, to) => ({ field: 'date', op: 'in_period', value: { from, to } })
const atVenue = (...venues) => ({ field: 'venue', op: 'in', value: venues })
const personIs = name => ({ field: 'person.name', op: 'is', value: name })
// Whole weeks (Monday 7 September to Sunday 25 October): every rota week and both till days.
const SPAN = period('2026-09-07', '2026-10-25')
const byKey = (list, key) => Object.fromEntries(list.map(x => [x[key], x]))
const num = v => (v == null ? 0 : Number(v))
const without = (...keys) => Object.fromEntries(Object.entries(LEVELS).filter(([k]) => !keys.includes(k)))

function near(got, want, what) {
  assert.equal(typeof got, 'number', what + ' is a number (' + JSON.stringify(got) + ')')
  assert.ok(Math.abs(got - want) < 0.005, what + ': ' + got + ', expected ' + want)
}

const SALES = [{ key: 'sales', measure: 'net_sales' }, { key: 'checks', measure: 'checks' }]
const LABOUR = [{ key: 'pay', measure: 'pay_total', from: 'rota' }, { key: 'hours', measure: 'hours_total', from: 'rota' }]
const PER_HOUR = { key: 'per_hour', calc: 'sales / hours', label: 'Sales per hour' }
// Till sales by `rows`, the rota's pay and hours beside them, and sales per hour.
const salesAndLabour = (rows, filters, extra = {}) => ({
  subject: 'till.checks', rows, filters,
  also: [{ key: 'rota', subject: 'rota.staff_weeks' }],
  values: [...SALES, ...LABOUR, PER_HOUR],
  ...extra,
})
// A subject run on its own: the same values without their `from`.
const own = list => list.map(({ from: _f, ...v }) => v)
const alone = (subject, rows, values, filters) => run({ subject, rows, values: own(values), filters })
const notesOf = res => res.meta.notes || []

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  const filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [])
  const sold = await sellTwoDays({ owner, tenantId: ids.a, filled })
  V0 = filled.ids.venue
  // The two till days into the fixtures' rota week: Monday (Jo's lunch) and Wednesday.
  await sql`UPDATE pos_days SET business_date = '2026-10-19'::date WHERE id = ${sold.day1}`
  await sql`UPDATE pos_days SET business_date = '2026-10-21'::date WHERE id = ${sold.day2}`
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))).id
  W = (await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'hertford', timezone: 'Europe/London' }))).id
  seed = await fillRotaWeeks(owner, V, W)
  ;[{ name: here }] = await sql`SELECT name FROM venues WHERE id = ${V0}`
  run = runner(ids.a)
})
after(closeApp)

test('sales beside the rota by venue: every venue either has, each figure as its own subject gives it', async () => {
  const res = await run(salesAndLabour(['venue.name'], [SPAN]))
  assert.deepEqual(res.columns.map(c => c.key), ['venue.name', 'sales', 'checks', 'pay', 'hours', 'per_hour'])
  assert.deepEqual(notesOf(res).filter(n => /left out|week/.test(n)), [], 'nothing left out')

  const till = byKey(rowsOf(await alone('till.checks', ['venue.name'], SALES, [SPAN])), 'venue.name')
  const rota = byKey(rowsOf(await alone('rota.staff_weeks', ['venue.name'], LABOUR, [SPAN])), 'venue.name')
  const rows = byKey(rowsOf(res), 'venue.name')
  assert.deepEqual(Object.keys(rows).sort(), [...new Set([...Object.keys(till), ...Object.keys(rota)])].sort(), 'a row for every venue either subject has')
  assert.deepEqual(Object.keys(rows).sort(), ['Hertford', 'Ware', here].sort())
  for (const [name, r] of Object.entries(rows)) {
    near(r.sales, num(till[name]?.sales), name + ': sales')
    near(r.checks, num(till[name]?.checks), name + ': checks')
    near(r.pay, num(rota[name]?.pay), name + ': pay')
    near(r.hours, num(rota[name]?.hours), name + ': hours')
    if (r.hours) near(r.per_hour, r.sales / r.hours, name + ': sales per hour')
  }
  near(rows[here].sales, 78.8, 'the two till days at the fixtures\' venue')
  near(rows[here].hours, 4, 'Jo\'s lunch')
  near(rows.Hertford.hours, 4, 'Zed\'s lunch')
  near(rows.Ware.sales, 0, 'nothing sold at Ware')
  assert.ok(rows.Ware.pay > 0, 'three weeks of pay at Ware')

  // Totals: each subject's own, never one added to the other.
  const tot = totalsRow(res)
  for (const k of ['sales', 'checks', 'pay', 'hours']) {
    near(tot[k], Object.values(rows).reduce((s, r) => s + r[k], 0), 'the total of ' + k)
  }
  near(tot.per_hour, tot.sales / tot.hours, 'sales per hour over everything')
})

test('by day and by week: each subject on its own days, a weekly one by week only', async () => {
  // Days: till sales beside the people on each day's rota.
  const week = period('2026-10-19', '2026-10-25')
  const DAYS = [{ key: 'hours', measure: 'hours_total', from: 'days' }, { key: 'people', measure: 'people', from: 'days' }]
  const res = await run({
    subject: 'till.checks', rows: ['date'], filters: [week, atVenue(V0)],
    also: [{ key: 'days', subject: 'rota.days' }],
    values: [...SALES, ...DAYS],
  })
  const rows = byKey(rowsOf(res), 'date')
  assert.deepEqual(Object.keys(rows).sort(), ['2026-10-19', '2026-10-21'])
  const till = byKey(rowsOf(await alone('till.checks', ['date'], SALES, [week, atVenue(V0)])), 'date')
  const days = byKey(rowsOf(await alone('rota.days', ['date'], DAYS, [week, atVenue(V0)])), 'date')
  assert.deepEqual(Object.keys(days), ['2026-10-19'], 'Jo\'s lunch on the Monday')
  for (const [d, r] of Object.entries(rows)) {
    near(r.sales, num(till[d]?.sales), d + ': sales')
    near(r.hours, num(days[d]?.hours), d + ': hours')
    near(r.people, num(days[d]?.people), d + ': people')
  }
  near(rows['2026-10-21'].hours, 0, 'nobody on the rota on the Wednesday')
  assert.ok(rows['2026-10-21'].sales > 0, 'but there were sales')

  // Weeks: till sales by week beside the rota's weeks.
  const wk = { field: 'date', bucket: 'week' }
  const byWeek = await run(salesAndLabour([wk], [SPAN]))
  const weeks = byKey(rowsOf(byWeek), 'date:week')
  const tillWeeks = byKey(rowsOf(await alone('till.checks', [wk], SALES, [SPAN])), 'date:week')
  const rotaWeeks = byKey(rowsOf(await alone('rota.staff_weeks', [wk], LABOUR, [SPAN])), 'date:week')
  assert.deepEqual(Object.keys(weeks).sort(), [...new Set([...Object.keys(tillWeeks), ...Object.keys(rotaWeeks)])].sort())
  assert.deepEqual(Object.keys(weeks).sort(), ['2026-09-07', '2026-09-14', '2026-09-21', '2026-10-19'])
  for (const [w, r] of Object.entries(weeks)) {
    near(r.sales, num(tillWeeks[w]?.sales), 'week of ' + w + ': sales')
    near(r.pay, num(rotaWeeks[w]?.pay), 'week of ' + w + ': pay')
    near(r.hours, num(rotaWeeks[w]?.hours), 'week of ' + w + ': hours')
  }
  assert.ok(weeks['2026-10-19'].sales > 0 && weeks['2026-10-19'].hours > 0, 'the fixtures\' week has both')

  // A weekly subject can't be lined up by day: left out, with why.
  const daily = await run(salesAndLabour(['date'], [SPAN]))
  assert.deepEqual(daily.columns.map(c => c.key), ['date', 'sales', 'checks'])
  assert.ok(notesOf(daily).some(n => /^Rota weeks by person has a row for each week, so it lines up by week, month, quarter or year, not by .+\. Its figures are left out\.$/.test(n)), notesOf(daily).join(' | '))
})

test('the period before: each subject over its own earlier rows, rows only the earlier period has included', async () => {
  const res = await run(salesAndLabour(['venue.name'], [period('2026-09-14', '2026-09-20')], { compare: { with: 'previous_period' } }))
  const keys = res.columns.map(c => c.key)
  for (const k of ['sales__prev', 'pay', 'pay__prev', 'pay__chg', 'hours__prev']) assert.ok(keys.includes(k), k + ' in ' + keys.join(','))
  assert.deepEqual(res.meta.compare.from, '2026-09-07')

  const now = byKey(rowsOf(await alone('rota.staff_weeks', ['venue.name'], LABOUR, [period('2026-09-14', '2026-09-20')])), 'venue.name')
  const was = byKey(rowsOf(await alone('rota.staff_weeks', ['venue.name'], LABOUR, [period('2026-09-07', '2026-09-13')])), 'venue.name')
  const rows = byKey(rowsOf(res), 'venue.name')
  assert.deepEqual(Object.keys(rows).sort(), ['Hertford', 'Ware'], 'Hertford only had a week before')
  near(rows.Ware.pay, now.Ware.pay, 'Ware now')
  near(rows.Ware.pay__prev, was.Ware.pay, 'Ware the week before')
  near(rows.Ware.hours__prev, was.Ware.hours, 'Ware\'s hours the week before')
  near(rows.Hertford.pay, 0, 'Hertford now')
  near(rows.Hertford.pay__prev, was.Hertford.pay, 'Hertford the week before')
  near(rows.Hertford.hours__prev, 4, 'Zed\'s lunch the week before')
  near(rows.Ware.sales, 0, 'no sales in September')
  const tot = totalsRow(res)
  near(tot.pay__prev, was.Ware.pay + was.Hertford.pay, 'the week before in total')
})

test('the top venue by pay, and everything else added up subject by subject', async () => {
  const full = Object.values(byKey(rowsOf(await run(salesAndLabour(['venue.name'], [SPAN]))), 'venue.name'))
  const top = [...full].sort((a, b) => b.pay - a.pay)[0]
  const res = await run(salesAndLabour(['venue.name'], [SPAN], { sort: [{ by: 'pay', dir: 'desc' }], limit: { top: 1, rest_as: 'Every other venue' } }))
  const shown = rowsOf(res)
  assert.deepEqual(shown.map(r => r['venue.name']), [top['venue.name']])
  const [rest] = rowsOf(res, 'rest')
  assert.equal(rest['venue.name'], 'Every other venue')
  const others = full.filter(r => r['venue.name'] !== top['venue.name'])
  for (const k of ['sales', 'checks', 'pay', 'hours']) {
    near(rest[k], others.reduce((s, r) => s + r[k], 0), 'everything else: ' + k)
  }
  near(rest.per_hour, rest.sales / rest.hours, 'everything else: sales per hour')
})

test('a role that can\'t see the other subject, or one of its figures: left out with a note', async () => {
  const spec = salesAndLabour(['venue.name'], [SPAN])
  const noRota = await run(spec, {}, { levels: without('rota') })
  assert.deepEqual(noRota.columns.map(c => c.key), ['venue.name', 'sales', 'checks'])
  assert.ok(notesOf(noRota).includes('Figures from rota weeks by person are left out: your role can\'t see them'), notesOf(noRota).join(' | '))
  assert.ok(notesOf(noRota).includes('Sales per hour is left out: your role can\'t see what it is worked out from'), notesOf(noRota).join(' | '))
  assert.deepEqual(rowsOf(noRota).map(r => r['venue.name']), [here], 'only the till\'s rows')

  const full = byKey(rowsOf(await run(spec)), 'venue.name')
  const noPay = await run(spec, {}, { levels: without('rota_pay') })
  assert.deepEqual(noPay.columns.map(c => c.key), ['venue.name', 'sales', 'checks', 'hours', 'per_hour'])
  assert.ok(notesOf(noPay).includes('Pay is left out: your role can\'t see it'), notesOf(noPay).join(' | '))
  for (const r of rowsOf(noPay)) {
    near(r.hours, full[r['venue.name']].hours, r['venue.name'] + ': hours without pay')
    assert.ok(!('pay' in r))
  }

  // Nothing but the rota's figures, for a role without the rota: nothing to show.
  const onlyRota = { ...spec, values: LABOUR }
  assert.equal((await refused(run(onlyRota, {}, { levels: without('rota') }))).status, 403)
  // ... and a definition being saved is refused rather than cut down.
  const env = s => ({ tenantId: ids.a, levels: without('rota'), params: resolveParams(s, {}), today: '2026-11-14', tz: 'Europe/London' })
  const clean = normaliseReport(spec)
  const strict = await refused((async () => compileReport(clean, env(clean), { strictParts: true }))())
  assert.equal(strict.status, 403)
})

test('rows the other subject can\'t be lined up by: left out with why; refused when saved', async () => {
  // A check's server is someone who took orders on the till, not a person on the rota.
  const spec = salesAndLabour(['server.name'], [SPAN])
  const UNMATCHED = /^Rota weeks by person isn't linked to .+, so it can't be lined up by .+\. Its figures are left out\.$/
  const res = await run(spec)
  assert.deepEqual(res.columns.map(c => c.key), ['server.name', 'sales', 'checks'])
  assert.ok(notesOf(res).some(n => UNMATCHED.test(n)), notesOf(res).join(' | '))
  assert.ok(notesOf(res).includes('Sales per hour is left out: what it is worked out from is left out'), notesOf(res).join(' | '))
  const till = byKey(rowsOf(await alone('till.checks', ['server.name'], SALES, [SPAN])), 'server.name')
  assert.deepEqual(Object.keys(byKey(rowsOf(res), 'server.name')).sort(), Object.keys(till).sort())

  // Only the rota's figures: refused with the reason.
  const r = await refused(run({ ...spec, values: LABOUR }))
  assert.equal(r.status, 422)
  assert.match(r.problems[0], UNMATCHED)

  // Saving keeps nothing half-working.
  const saved = await owner.post('/api/reports', { name: 'Sales by server beside the rota', spec })
  assert.equal(saved.status, 422, saved.body)
  assert.ok(saved.json.problems.some(p => UNMATCHED.test(p)), saved.body)
  const clean = normaliseReport(spec)
  const strict = await refused((async () => compileReport(clean, {
    tenantId: ids.a, levels: LEVELS, params: resolveParams(clean, {}), today: '2026-11-14', tz: 'Europe/London',
  }, { strictParts: true }))())
  assert.equal(strict.status, 422)

  // A part's own filter on its day: its days follow the report's period.
  const ownDay = await owner.post('/api/reports/preview', {
    spec: { ...salesAndLabour(['venue.name'], [SPAN]), also: [{ key: 'rota', subject: 'rota.staff_weeks', filters: [period('2026-09-07', '2026-09-13')] }] },
  })
  assert.equal(ownDay.status, 422, ownDay.body)
})

test('a weekly subject beside a period of part weeks: said, and counted by the week its Monday is in', async () => {
  const part = period('2026-09-08', '2026-10-25')
  const res = await run(salesAndLabour(['venue.name'], [part]))
  assert.ok(notesOf(res).some(n => n.includes('has a row for each week, counted in the period when its Monday is')), notesOf(res).join(' | '))
  const rota = byKey(rowsOf(await alone('rota.staff_weeks', ['venue.name'], LABOUR, [part])), 'venue.name')
  const rows = byKey(rowsOf(res), 'venue.name')
  for (const [name, r] of Object.entries(rows)) near(r.pay, num(rota[name]?.pay), name + ': pay in a period of part weeks')
  assert.ok(!rows.Hertford, 'Zed\'s week starts on the 7th, before the period')
})

test('a daily subject beside a weekly report reads the whole of each week, past the period\'s last day', async () => {
  const sep = period('2026-09-07', '2026-09-21')
  const res = await run({
    subject: 'rota.weeks', rows: ['date'], filters: [sep, atVenue(V)],
    also: [{ key: 'days', subject: 'rota.days' }],
    values: [{ key: 'hours', measure: 'hours_total' }, { key: 'day_hours', measure: 'hours_total', from: 'days' }],
  })
  const rows = byKey(rowsOf(res), 'date')
  assert.deepEqual(Object.keys(rows).sort(), ['2026-09-07', '2026-09-14', '2026-09-21'])
  const daysOf = async (from, to) => rowsOf(await alone('rota.days', ['venue.name'], [{ key: 'hours', measure: 'hours_total' }], [period(from, to), atVenue(V)]))[0]?.hours
  const lastWeek = await daysOf('2026-09-21', '2026-09-27')
  near(rows['2026-09-21'].day_hours, lastWeek, 'the days of the week starting on the period\'s last day')
  assert.ok(lastWeek > await daysOf('2026-09-21', '2026-09-21'), 'more than the period\'s last day alone (Ben\'s Tuesday)')
  near(rows['2026-09-07'].day_hours, await daysOf('2026-09-07', '2026-09-13'), 'the first week\'s days')
  near(rows['2026-09-14'].day_hours, await daysOf('2026-09-14', '2026-09-20'), 'the second week\'s days')
  for (const [w, r] of Object.entries(rows)) near(r.day_hours, r.hours, 'week of ' + w + ': the days add up to the week')
})

test('opening a row up: the other subject held to the row, and the rows behind each subject\'s figures', async () => {
  const sep = period('2026-09-07', '2026-09-27')
  const spec = {
    subject: 'rota.staff_weeks', rows: ['person.name'], filters: [sep, atVenue(V)],
    also: [{ key: 'days', subject: 'rota.days' }],
    values: [
      { key: 'pay', measure: 'pay_total' },
      { key: 'worked', measure: 'days_worked', from: 'days' },
      { key: 'hours', measure: 'hours_total', from: 'days' },
    ],
    drill: { down: [{ field: 'date' }] },
  }
  const base = await run(spec)
  assert.equal(base.meta.drill.per_figure, true, 'pay and the days\' figures count different rows')
  const preview = async drill => ok(owner.post('/api/reports/preview', { spec, drill, fresh: true }), 'preview')
  const ana = [{ field: 'person.name', value: 'Ana' }]

  // Ana by week: her days beside her weeks.
  const byWeek = await preview([{ at: ana, to: { field: 'date' } }])
  const weeks = byKey(rowsOf(byWeek), 'date')
  const days = byKey(rowsOf(await alone('rota.days', [{ field: 'date', bucket: 'week' }], spec.values.filter(v => v.from),
    [sep, atVenue(V), personIs('Ana')])), 'date:week')
  assert.deepEqual(Object.keys(weeks).sort(), ['2026-09-07', '2026-09-14', '2026-09-21'])
  for (const [w, r] of Object.entries(weeks)) {
    near(r.worked, num(days[w]?.worked), 'Ana, week of ' + w + ': days worked')
    near(r.hours, num(days[w]?.hours), 'Ana, week of ' + w + ': hours')
  }

  // The rows behind a figure: the days behind the hours, the weeks behind the pay.
  const count = async (subject, filters) => rowsOf(await run({ subject, rows: ['venue.name'], values: [{ key: 'n', agg: 'count' }], filters }))[0]?.n
  const dayRows = await preview([{ at: ana, to: 'rows', value: 'hours' }])
  assert.equal(dayRows.kind, 'list')
  assert.equal(dayRows.subject, 'rota.days')
  assert.equal(dayRows.rows.length, await count('rota.days', [sep, atVenue(V), personIs('Ana')]))
  const weekRows = await preview([{ at: ana, to: 'rows', value: 'pay' }])
  assert.equal(weekRows.subject, 'rota.staff_weeks')
  assert.equal(weekRows.rows.length, await count('rota.staff_weeks', [sep, atVenue(V), personIs('Ana')]))

  // A row the other subject can't be held to: its figures go, said once, then quietly.
  const tillSpec = { ...salesAndLabour(['venue.name'], [SPAN]), drill: { down: ['server.name', 'date'] } }
  const tillPreview = async drill => ok(owner.post('/api/reports/preview', { spec: tillSpec, drill, fresh: true }), 'till preview')
  const first = { at: [{ field: 'venue.name', value: here }], to: { field: 'server.name' } }
  const servers = await tillPreview([first])
  assert.deepEqual(servers.columns.map(c => c.key), ['server.name', 'sales', 'checks'])
  assert.ok(notesOf(servers).some(n => /isn't linked to .+ Its figures are left out\.$/.test(n)), notesOf(servers).join(' | '))
  const someone = rowsOf(servers)[0]['server.name']
  const theirDays = await tillPreview([first, { at: [{ field: 'server.name', value: someone }], to: { field: 'date' } }])
  assert.deepEqual(theirDays.columns.map(c => c.key), ['date', 'sales', 'checks'])
  assert.deepEqual(notesOf(theirDays).filter(n => /rota|left out/i.test(n)), [])
})
