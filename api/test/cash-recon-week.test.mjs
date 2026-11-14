// Cash Recon's day and week figures come from the one rule in
// shared/cashRecon.js, on the server through services/cashReconSvc.js: the
// week route (GET /cash-recon/week/:week_start, read by the week cards, the
// phone's Cash Up and Pepper's cash_week) and the loaders the report
// builder's Cash days and Cash weeks use give the figures worked out by
// hand for a week with every part the rule reads (support/cashWeek.mjs).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillCashWeek, CASH_MONDAY, addDays } from './support/cashWeek.mjs'
import { withTenant } from '../src/config/db.js'
import { loadCashDays, loadCashWeeks, mondayOf } from '../src/services/cashReconSvc.js'

let ids, owner, V, W, week

const FIGURES = ['income', 'income_left_out', 'takings', 'cash_takings', 'service_charges', 'sc_adjustment',
  'expenses', 'card_expenses', 'wages_paid', 'expected', 'counted', 'variance']

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))).id
  W = (await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'hertford', timezone: 'Europe/London' }))).id
  week = await fillCashWeek(owner, V)
  // A day at the other venue, and a day in the week after, which no figure
  // of this week may count.
  const other = await ok(owner.post(`/api/venues/${W}/cash-recon/config/income-sources`, { name: 'Food' }))
  await ok(owner.put(`/api/venues/${W}/cash-recon/daily/${CASH_MONDAY}`, { income: [{ source_id: other.id, gross_amount: 9999 }] }))
  await ok(owner.put(`/api/venues/${V}/cash-recon/daily/${addDays(CASH_MONDAY, 7)}`, {
    income: [{ source_id: week.src.food.id, gross_amount: 7777 }],
  }))
})
after(closeApp)

test('the week route: each day by the rule, wages paid on no reported day once in the week', async () => {
  const res = await ok(owner.get(`/api/venues/${V}/cash-recon/week/${CASH_MONDAY}`))
  assert.equal(res.days.length, 7)
  for (const d of res.days) {
    const want = week.days[d.date]
    if (!want) {
      assert.deepEqual(d, { date: d.date, status: null }, d.date + ' has no report')
      continue
    }
    assert.equal(d.status, want.status, d.date)
    assert.equal(d.total_income, want.income, d.date + ' income')
    assert.equal(d.total_takings, want.takings, d.date + ' takings')
    assert.equal(d.total_expenses, want.expenses, d.date + ' cash expenses')
    assert.equal(d.wages_cash, want.wages_paid, d.date + ' wages paid')
    assert.equal(d.variance, want.variance, d.date + ' variance')
  }
  assert.deepEqual(res.wages, { total_wages: 300, total_cash_wages: 120, unassigned_cash_wages: 60 })
  // What the week cards, the phone's Cash Up and Pepper add up: the days'
  // variances and the wages on no counted day.
  const total = res.days.reduce((s, d) => s + (d.variance ?? 0), 0) + res.wages.unassigned_cash_wages
  assert.equal(Math.round(total * 100) / 100, week.week.variance)
})

test('a week with no reports and no wage list: empty days, no wages', async () => {
  const res = await ok(owner.get(`/api/venues/${V}/cash-recon/week/2026-11-02`))
  assert.ok(res.days.every(d => d.status === null))
  assert.deepEqual(res.wages, { total_wages: 0, total_cash_wages: 0, unassigned_cash_wages: 0 })
})

test('loadCashDays: every figure of every reported day, only the venues and days asked for', async () => {
  const days = await withTenant(ids.a, tx => loadCashDays(tx, ids.a, { venueIds: [V], ranges: [{ from: CASH_MONDAY, to: addDays(CASH_MONDAY, 6) }] }))
  assert.deepEqual(days.map(d => d.date), Object.keys(week.days).sort())
  for (const d of days) {
    const want = week.days[d.date]
    for (const k of FIGURES) assert.equal(d[k], want[k], d.date + ' ' + k)
    assert.equal(d.status, want.status)
    assert.equal(d.week_start, CASH_MONDAY)
    assert.equal(d.venue_id, V)
    assert.ok(d.report_id)
  }
  const fri = days.find(d => d.status === 'submitted')
  assert.equal(fri.submitted_by, A.owner)
  assert.ok(fri.submitted_at)

  // Every venue, every day: both venues' Mondays and the next week's.
  const all = await withTenant(ids.a, tx => loadCashDays(tx, ids.a))
  assert.equal(all.length, 6)
  assert.equal(all.filter(d => d.venue_id === W).length, 1)
  assert.equal(all.find(d => d.venue_id === W).income, 9999)
  // Two ranges, one of them backwards (ignored).
  const two = await withTenant(ids.a, tx => loadCashDays(tx, ids.a, { venueIds: [V], ranges: [
    { from: week.dates.mon, to: week.dates.mon }, { from: week.dates.fri, to: week.dates.wed },
    { from: addDays(CASH_MONDAY, 7), to: addDays(CASH_MONDAY, 7) },
  ] }))
  assert.deepEqual(two.map(d => d.date), [week.dates.mon, addDays(CASH_MONDAY, 7)])
  // Another group sees none of them.
  const other = await withTenant(ids.b, tx => loadCashDays(tx, ids.b))
  assert.deepEqual(other, [])
  // No venues asked for: nothing.
  assert.deepEqual(await withTenant(ids.a, tx => loadCashDays(tx, ids.a, { venueIds: [] })), [])
})

test('loadCashWeeks: the week by the rule, its wage list, and only weeks starting in the ranges', async () => {
  const [w, ...rest] = await withTenant(ids.a, tx => loadCashWeeks(tx, ids.a, { venueIds: [V], ranges: [{ from: CASH_MONDAY, to: addDays(CASH_MONDAY, 6) }] }))
  assert.equal(rest.length, 0)
  assert.equal(w.id, V + ':' + CASH_MONDAY)
  assert.equal(w.week_start, CASH_MONDAY)
  assert.equal(w.wage_list, true)
  for (const [k, v] of Object.entries(week.week)) assert.equal(w[k], v, k)

  // A range from Tuesday: the week starting that Monday isn't in it (its
  // Monday isn't), the next one is (its Monday is).
  const fromTue = await withTenant(ids.a, tx => loadCashWeeks(tx, ids.a, { venueIds: [V], ranges: [{ from: addDays(CASH_MONDAY, 1), to: addDays(CASH_MONDAY, 7) }] }))
  assert.deepEqual(fromTue.map(x => x.week_start), [addDays(CASH_MONDAY, 7)])
  assert.equal(fromTue[0].income, 7777)
  assert.equal(fromTue[0].wage_list, false)
  assert.equal(fromTue[0].wages, 0)

  // Every week of both venues.
  const all = await withTenant(ids.a, tx => loadCashWeeks(tx, ids.a))
  assert.deepEqual(all.map(x => x.venue_id + ' ' + x.week_start).sort(), [
    V + ' ' + CASH_MONDAY, V + ' ' + addDays(CASH_MONDAY, 7), W + ' ' + CASH_MONDAY,
  ].sort())
})

test('mondayOf', () => {
  assert.equal(mondayOf('2026-10-19'), '2026-10-19')
  assert.equal(mondayOf('2026-10-25'), '2026-10-19')
  assert.equal(mondayOf('2026-10-26'), '2026-10-26')
  assert.equal(mondayOf('2026-11-01'), '2026-10-26')
})

test('another group reads none of it through the route', async () => {
  const b = as(B.owner, ids.b)
  const r = await b.get(`/api/venues/${V}/cash-recon/week/${CASH_MONDAY}`)
  assert.equal(r.status, 404)
})
