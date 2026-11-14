// The report builder's Cash Recon subjects (docs/REPORTS.md 20, phase 3b)
// against the Cash Recon page's own figures for the same week: a week with
// every part the variance rule reads, worked out by hand
// (support/cashWeek.mjs), and the week route the week cards, the phone's Cash
// Up and Pepper read (GET /cash-recon/week/:week_start).
//
//   cash.days, cash.weeks   rows worked out in code for each run (reports/work/)
//   cash.income ... wages   what was typed, with figures that say what counts
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillCashWeek, CASH_MONDAY, addDays } from './support/cashWeek.mjs'
import { runner, rowsOf, totalsRow, measures, refused } from './support/reports.mjs'
import { STARTERS } from '../src/reports/starters/index.js'

const FIGURES = ['income', 'income_left_out', 'takings', 'cash_takings', 'service_charges', 'sc_adjustment',
  'expenses', 'card_expenses', 'wages_paid', 'expected', 'counted', 'variance']
const SUNDAY = addDays(CASH_MONDAY, 6)
const NEXT = addDays(CASH_MONDAY, 7)
const CASH = { cash_recon: 'view' }

let ids, owner, V, W, week, run

const inPeriod = (from, to = from) => ({ field: 'date', op: 'in_period', value: { from, to } })
const atVenue = v => ({ field: 'venue', op: 'in', value: [v] })
const cols = list => list.map(f => ({ field: f }))
const byKey = (list, key) => Object.fromEntries(list.map(x => [x[key], x]))
const starterSpec = key => STARTERS.find(s => s.key === key).spec

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))).id
  W = (await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'hertford', timezone: 'Europe/London' }))).id
  week = await fillCashWeek(owner, V)
  // Hertford: a Monday with income and nothing taken, and a wage list with
  // a cash wage paid on no day and some still to pay.
  const food = await ok(owner.post(`/api/venues/${W}/cash-recon/config/income-sources`, { name: 'Food' }))
  await ok(owner.put(`/api/venues/${W}/cash-recon/daily/${CASH_MONDAY}`, { income: [{ source_id: food.id, gross_amount: 9999 }] }))
  await ok(owner.put(`/api/venues/${W}/cash-recon/wages/${CASH_MONDAY}`, { entries: [{ name: 'Eve', total: 100, bank_amount: 30, cash_amount: 50 }] }))
  // Ware, the week after.
  await ok(owner.put(`/api/venues/${V}/cash-recon/daily/${NEXT}`, { income: [{ source_id: week.src.food.id, gross_amount: 7777 }] }))
  run = runner(ids.a)
})
after(closeApp)

test('a Cash day is the Cash Recon page\'s own figures, day by day', async () => {
  const res = await run({
    kind: 'list', subject: 'cash.days',
    rows: cols(['date', 'venue.name', 'status', 'submitted_by', 'week_start', 'balance', ...FIGURES]),
    filters: [inPeriod(CASH_MONDAY, SUNDAY), atVenue(V)],
    sort: [{ by: 'date', dir: 'asc' }],
  })
  const rows = rowsOf(res)
  assert.deepEqual(rows.map(r => r.date), Object.keys(week.days).sort(), 'the reported days, Thursday has none')
  for (const r of rows) {
    const want = week.days[r.date]
    for (const k of FIGURES) assert.equal(r[k], want[k], r.date + ' ' + k)
    assert.equal(r.status, want.status, r.date)
    assert.equal(r.week_start, CASH_MONDAY)
    assert.equal(r['venue.name'], 'Ware')
    assert.equal(r.balance, want.variance < 0 ? 'short' : want.variance > 0 ? 'over' : 'balanced')
  }
  assert.equal(byKey(rows, 'date')[week.dates.fri].submitted_by, A.owner)

  // The week route the week cards read gives each day the same.
  const page = await ok(owner.get(`/api/venues/${V}/cash-recon/week/${CASH_MONDAY}`))
  const mine = byKey(rows, 'date')
  for (const d of page.days.filter(x => x.status)) {
    assert.equal(mine[d.date].income, d.total_income, d.date + ' income')
    assert.equal(mine[d.date].takings, d.total_takings, d.date + ' takings')
    assert.equal(mine[d.date].expenses, d.total_expenses, d.date + ' expenses')
    assert.equal(mine[d.date].wages_paid, d.wages_cash, d.date + ' wages paid')
    assert.equal(mine[d.date].variance, d.variance, d.date + ' variance')
  }

  // Added up: Wednesday short by 10, Monday and Friday over.
  const sum = await run({
    subject: 'cash.days', rows: ['date'],
    values: measures(['days', 'days_submitted', 'days_short', 'days_over', 'income_total', 'takings_total', 'expenses_total', 'card_expenses_total', 'wages_paid_total', 'variance_total', 'shortfall', 'surplus']),
    filters: [inPeriod(CASH_MONDAY, SUNDAY), atVenue(V)],
    sort: [{ by: 'date', dir: 'asc' }],
  })
  assert.deepEqual(rowsOf(sum).map(r => [r.date, r.variance_total]), Object.entries(week.days).sort().map(([d, x]) => [d, x.variance]))
  assert.deepEqual(totalsRow(sum), {
    date: null, days: 4, days_submitted: 1, days_short: 1, days_over: 2,
    income_total: 2100.3, takings_total: 2055.2, expenses_total: 17.5, card_expenses_total: 8, wages_paid_total: 60,
    variance_total: 42.4, shortfall: -10, surplus: 52.4,
  })
})

test('a Cash week is its days added up, with cash wages paid on no reported day counted once in the week', async () => {
  const fields = ['date', 'venue.name', 'days', 'days_submitted', ...FIGURES, 'cash_wages', 'wages_off_days', 'wages', 'bank_wages', 'wage_list']
  const res = await run({ kind: 'list', subject: 'cash.weeks', rows: cols(fields), filters: [inPeriod(CASH_MONDAY, SUNDAY), atVenue(V)] })
  const [w, ...rest] = rowsOf(res)
  assert.equal(rest.length, 0)
  assert.equal(w.date, CASH_MONDAY)
  for (const [k, v] of Object.entries(week.week)) assert.equal(w[k], v, k)
  assert.equal(w.wage_list, true)

  // The week cards add the days' variances and the wages on no counted day.
  const page = await ok(owner.get(`/api/venues/${V}/cash-recon/week/${CASH_MONDAY}`))
  const cards = page.days.reduce((s, d) => s + (d.variance ?? 0), 0) + page.wages.unassigned_cash_wages
  assert.equal(Math.round(cards * 100) / 100, w.variance)
  assert.notEqual(w.variance, 42.4, 'not just the days added up: 60 of cash wages were paid on no reported day')

  // A period from the Tuesday holds the next week (its Monday is in it), not this one.
  const fromTue = rowsOf(await run({ kind: 'list', subject: 'cash.weeks', rows: cols(['date', 'income']), filters: [inPeriod(addDays(CASH_MONDAY, 1), NEXT), atVenue(V)] }))
  assert.deepEqual(fromTue, [{ date: NEXT, income: 7777 }])

  // Hertford's week: short by its whole income, and a cash wage on no day.
  const [h] = rowsOf(await run({ kind: 'list', subject: 'cash.weeks', rows: cols(fields), filters: [inPeriod(CASH_MONDAY, SUNDAY), atVenue(W)] }))
  assert.equal(h.days, 1)
  assert.equal(h.cash_wages, 50)
  assert.equal(h.wages_off_days, 50)
  assert.equal(h.wages, 100)
  assert.equal(h.bank_wages, 30)
  assert.equal(h.variance, -9949)
})

test('the typed entries add up to the days\' figures, counting only what counts', async () => {
  const f = [inPeriod(CASH_MONDAY, SUNDAY), atVenue(V)]
  const byDay = async (subject, ms) => byKey(rowsOf(await run({ subject, rows: ['date'], values: measures(ms), filters: f })), 'date')
  const income = await byDay('cash.income', ['income_counted', 'gross_total'])
  const takings = await byDay('cash.takings', ['takings_counted', 'cash_takings', 'amount_total'])
  const sc = await byDay('cash.service_charges', ['counted', 'adjustment_total', 'amount_total'])
  const spent = await byDay('cash.expenses', ['cash_spend', 'card_spend', 'vat_total'])
  for (const [date, want] of Object.entries(week.days)) {
    assert.equal(income[date]?.income_counted ?? 0, want.income, date + ' income')
    assert.equal(takings[date]?.takings_counted ?? 0, want.takings, date + ' takings')
    assert.equal(takings[date]?.cash_takings ?? 0, want.cash_takings, date + ' cash takings')
    assert.equal(sc[date]?.counted ?? 0, want.service_charges, date + ' service charges')
    assert.equal(sc[date]?.adjustment_total ?? 0, want.sc_adjustment, date + ' adjustment')
    assert.equal(spent[date]?.cash_spend ?? 0, want.expenses, date + ' cash expenses')
    assert.equal(spent[date]?.card_spend ?? 0, want.card_expenses, date + ' card expenses')
  }
  // What was typed, counted or not: the old till and the old cash tin were switched off later.
  const mon = week.dates.mon
  assert.equal(income[mon].gross_total, 2249.3)
  assert.equal(takings[mon].amount_total, 1237.2)
  assert.equal(sc[mon].amount_total, 1075)
  assert.equal(spent[mon].vat_total, 2.08)

  // By income source, and by whether it counts.
  const sources = byKey(rowsOf(await run({ subject: 'cash.income', rows: ['source.name', 'counts'], values: measures(['gross_total']), filters: f })), 'source.name')
  assert.deepEqual(Object.fromEntries(Object.entries(sources).map(([k, r]) => [k, [r.counts, r.gross_total]])), {
    Food: [true, 1900.1], Drinks: [true, 200.2], 'Vouchers sold': [false, 50], 'Old till': [false, 999],
  })
  // A day's report through its link: the submitted Friday.
  const [fri] = rowsOf(await run({ subject: 'cash.takings', rows: ['report.status'], values: measures(['amount_total']), filters: [...f, { field: 'report.status', op: 'is', value: 'submitted' }] }))
  assert.deepEqual(fri, { 'report.status': 'submitted', amount_total: 110 })
})

test('wage lists: what is due in cash after the bank, and what is still to pay', async () => {
  const f = [inPeriod(CASH_MONDAY, SUNDAY)]
  const res = await run({ subject: 'cash.wages', rows: ['venue.name'], values: measures(['people', 'wages_total', 'bank_total', 'cash_total', 'unpaid_total']), filters: f })
  assert.deepEqual(byKey(rowsOf(res), 'venue.name'), {
    Ware: { 'venue.name': 'Ware', people: 4, wages_total: 300, bank_total: 180, cash_total: 120, unpaid_total: 0 },
    // Eve: 100 less 30 by bank is 70 due in cash, 50 of it paid.
    Hertford: { 'venue.name': 'Hertford', people: 1, wages_total: 100, bank_total: 30, cash_total: 50, unpaid_total: 20 },
  })
  const eve = rowsOf(await run({ kind: 'list', subject: 'cash.wages', rows: cols(['name', 'wage', 'bank', 'cash', 'unpaid', 'paid_on', 'list.notes']), filters: [...f, atVenue(W)] }))
  assert.deepEqual(eve, [{ name: 'Eve', wage: 100, bank: 30, cash: 50, unpaid: 20, paid_on: null, 'list.notes': null }])
})

test('a period beside the one before, venues asked for, and every day', async () => {
  const spec = {
    subject: 'cash.days',
    params: [{ key: 'period', type: 'period', default: { from: NEXT, to: addDays(NEXT, 6) } }, { key: 'venues', type: 'venues', default: 'all' }],
    rows: ['venue.name'], values: measures(['days', 'income_total', 'variance_total']),
    filters: [{ field: 'date', op: 'in_period', param: 'period' }, { field: 'venue', op: 'in', param: 'venues' }],
    compare: { with: 'previous_period' },
  }
  // The week after, beside this week: Ware's next Monday, and both venues' days before.
  const res = byKey(rowsOf(await run(spec)), 'venue.name')
  assert.deepEqual([res.Ware.days, res.Ware.days__prev, res.Ware.income_total, res.Ware.income_total__prev, res.Ware.variance_total__prev], [1, 4, 7777, 2100.3, 42.4])
  assert.deepEqual([res.Hertford.days, res.Hertford.days__prev, res.Hertford.variance_total__prev], [0, 1, -9999])

  // Only Hertford asked for: only its rows are worked out and shown.
  const only = rowsOf(await run(spec, { venues: [W] }))
  assert.deepEqual(only.map(r => r['venue.name']), ['Hertford'])

  // No period: every reported day of every venue.
  const every = rowsOf(await run({ kind: 'list', subject: 'cash.days', rows: cols(['date', 'venue.name']), sort: [{ by: 'date', dir: 'asc' }] }))
  assert.equal(every.length, 6)
  assert.deepEqual(every.filter(r => r['venue.name'] === 'Hertford').map(r => r.date), [CASH_MONDAY])
})

test('the cash starters on the week', async () => {
  const given = { period: { from: CASH_MONDAY, to: SUNDAY } }
  const weeks = byKey(rowsOf(await run(starterSpec('cash_variance_by_venue'), given)), 'venue.name')
  assert.deepEqual([weeks.Ware.days, weeks.Ware.days_short, weeks.Ware.shortfall, weeks.Ware.variance_total], [4, 1, -10, 42.4])
  assert.deepEqual([weeks.Hertford.days, weeks.Hertford.days_short, weeks.Hertford.variance_total], [1, 1, -9999])

  const short = rowsOf(await run(starterSpec('cash_days_short'), given))
  assert.deepEqual(short.map(r => [r.date, r['venue.name'], r.variance]), [[CASH_MONDAY, 'Hertford', -9999], [week.dates.wed, 'Ware', -10]])

  const wk = byKey(rowsOf(await run(starterSpec('cash_variance_by_week'), given)), 'date')
  assert.equal(wk[CASH_MONDAY].variance_total, -9846.6, 'both venues\' weeks: 102.40 and -9,949')
  assert.equal(wk[CASH_MONDAY].cash_wages_total, 170)

  const channels = byKey(rowsOf(await run(starterSpec('cash_takings_by_channel'), given)), 'channel.name')
  assert.deepEqual(Object.keys(channels).sort(), ['Card', 'Cash', 'Float'], 'the old cash tin is switched off')
  assert.equal(channels.Card.takings_counted, 1345.15)
  assert.equal(channels.Card.cash_takings, 0)
  assert.equal(channels.Float.cash_takings, 10)
})

test('Cash Recon needs its own module, a file streams the worked rows, and another group sees none of it', async () => {
  const spec = { subject: 'cash.days', values: measures(['days']) }
  assert.equal((await refused(run(spec, undefined, { levels: { pos_reports: 'view' } }))).status, 403)
  assert.equal(rowsOf(await run(spec, undefined, { levels: CASH }))[0].days, 6)
  assert.equal(rowsOf(await runner(ids.b)(spec, undefined, { levels: CASH }))[0].days, 0)

  const csv = await owner.post('/api/reports/export', { format: 'csv', spec: { kind: 'list', subject: 'cash.days', rows: cols(['date', 'variance']), filters: [atVenue(V)], sort: [{ by: 'date', dir: 'asc' }] } })
  assert.equal(csv.status, 200, csv.body)
  const lines = csv.body.slice(1).trim().split(/\r?\n/)
  assert.equal(lines.length, 1 + 5)
  assert.match(lines[1], new RegExp('^' + CASH_MONDAY + ',42\\.4'))

  const b = as(B.owner, ids.b)
  const theirs = await b.post('/api/reports/export', { format: 'csv', spec: { kind: 'list', subject: 'cash.days', rows: cols(['date', 'variance']) } })
  assert.equal(theirs.status, 200)
  assert.equal(theirs.body.slice(1).trim().split(/\r?\n/).length, 1, 'only the headings')
})
