// The report builder's staff and rota subjects (docs/REPORTS.md 20, phase 3b)
// against the Rota page's own figures for the same weeks: three weeks at a
// venue with every part the rota maths reads, and a second venue with one
// person (support/rotaWeek.mjs), held to the pay route the Rota page's pay
// and tips tables read (GET /api/rota/venues/:venueId/weeks/:week/pay).
//
//   rota.staff_weeks, rota.weeks, rota.pot_weeks, rota.tip_shares, rota.days
//                       rows worked out in code for each run (reports/work/rota.js)
//   rota.entries ... staff.people
//                       what was typed on the rota and the Staff page
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillRotaWeeks, addDays } from './support/rotaWeek.mjs'
import { runner, rowsOf, measures, refused } from './support/reports.mjs'
import { STARTERS } from '../src/reports/starters/index.js'
import { computeRotaDays } from '../src/services/rotaCalc.js'

let ids, owner, V, W, seed, run
let w1, w2, w3
const page = {}      // the pay route's answer for each Ware week
let hertford         // ... and for Hertford's first week

const inPeriod = (from, to = addDays(from, 6)) => ({ field: 'date', op: 'in_period', value: { from, to } })
const atVenue = v => ({ field: 'venue', op: 'in', value: [v] })
const cols = list => list.map(f => ({ field: f }))
const byKey = (list, key) => Object.fromEntries(list.map(x => [x[key], x]))
const starterSpec = key => STARTERS.find(s => s.key === key).spec
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const sumOf = (list, f) => round2(list.reduce((s, x) => s + Number(f(x) || 0), 0))

// A figure from a report against the page's: numbers to the penny, the rest as given.
function same(got, want, what) {
  if (typeof want === 'number') {
    assert.equal(typeof got, 'number', what + ' is a number (' + JSON.stringify(got) + ')')
    assert.ok(Math.abs(got - want) < 0.005, what + ': ' + got + ', the page says ' + want)
  } else assert.equal(got, want ?? null, what)
}

// The report's fields of a person's week and what the pay route's row says.
const ROTA_FIELDS = {
  role: r => r.role_name, entry_count: r => r.entry_count, days_worked: r => r.days_worked, paid_days: r => r.paid_days,
  hours: r => r.hours, paid_hours: r => r.paid_hours,
  sick_hours: r => r.absence_hours?.sick || 0, pto_hours: r => r.absence_hours?.pto || 0,
  uto_hours: r => r.absence_hours?.uto || 0, abs_hours: r => r.absence_hours?.abs || 0,
}
const PAY_FIELDS = {
  pay_type: r => r.pay_type, pay_basis: r => (r.pay_type === 'hourly' ? null : r.pay_basis),
  ...Object.fromEntries(['computed_pay', 'pay_override', 'base_pay', 'extra_pay', 'deductions', 'advance', 'advance_repay',
    'carried_owed', 'pay', 'pay_shortfall', 'pay_method', 'bank_pay', 'cash_pay'].map(k => [k, r => r[k]])),
}
const TIP_FIELDS = Object.fromEntries(['base_points', 'points_adjustment', 'points_nudge', 'points', 'tip_share_from_pots',
  'tip_adjustment', 'tip_unallocated', 'tip_share', 'tip_cash', 'tip_bank'].map(k => [k, r => r[k]]))
const WAGE_FIELDS = ['on_wage_list', 'wage', 'wage_bank', 'wage_cash', 'wage_unpaid']

// Anything in a person's week that makes it a row.
const busy = r => r.entry_count > 0 || r.pay_override != null || (r.adjustments || []).length > 0
  || ['hours', 'pay', 'computed_pay', 'carried_owed', 'points', 'tip_share', 'tip_cash', 'tip_bank', 'tip_unallocated'].some(k => Number(r[k] || 0) !== 0)

const personWeeks = async (venue, week, fields) => byKey(rowsOf(await run({
  kind: 'list', subject: 'rota.staff_weeks', rows: cols(['name', ...fields]),
  filters: [inPeriod(week), atVenue(venue)], sort: [{ by: 'name', dir: 'asc' }],
})), 'name')

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))).id
  W = (await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'hertford', timezone: 'Europe/London' }))).id
  seed = await fillRotaWeeks(owner, V, W)
  ;[w1, w2, w3] = seed.weeks
  // Hal, switched off after week 1, is on week 2's wage list with nothing on its rota.
  await ok(owner.put(`/api/venues/${V}/cash-recon/wages/${w2}`, { entries: [{ staff_id: seed.staff.hal.id, name: 'Hal', total: 30 }] }), 'Hal on week 2\'s wage list')
  for (const w of seed.weeks) page[w] = await ok(owner.get(`/api/rota/venues/${V}/weeks/${w}/pay`))
  hertford = await ok(owner.get(`/api/rota/venues/${W}/weeks/${w1}/pay`))
  run = runner(ids.a)
})
after(closeApp)

test('each person\'s week is the Rota page\'s own row: hours, pay, points and tips', async () => {
  const NAMES = {
    [w1]: ['Ana', 'Ben', 'Cal', 'Dee', 'Gus', 'Hal'],
    // Hal from the wage list; Gus taken off the week; Dee and Ivy had nothing.
    [w2]: ['Ana', 'Ben', 'Cal', 'Eve', 'Fay', 'Hal'],
    // Cal passes the bar pot on to Ivy; Ivy's share of it is all she has.
    [w3]: ['Ana', 'Ben', 'Cal', 'Ivy'],
  }
  for (const w of [w1, w2, w3]) {
    const pg = page[w]
    const rota = await personWeeks(V, w, [...Object.keys(ROTA_FIELDS), ...Object.keys(PAY_FIELDS)])
    const tips = await personWeeks(V, w, [...Object.keys(TIP_FIELDS), ...WAGE_FIELDS])
    assert.deepEqual(Object.keys(rota), NAMES[w], 'who has a week ' + w)
    assert.deepEqual(Object.keys(tips), NAMES[w])
    for (const r of pg.rows) {
      if (busy(r)) assert.ok(rota[r.name], r.name + ' has something in the week of ' + w + ' and is a row')
      if (!rota[r.name]) continue
      for (const [k, f] of Object.entries({ ...ROTA_FIELDS, ...PAY_FIELDS })) same(rota[r.name][k], f(r), w + ' ' + r.name + ' ' + k)
      for (const [k, f] of Object.entries(TIP_FIELDS)) same(tips[r.name][k], f(r), w + ' ' + r.name + ' ' + k)
    }
  }

  // The figures that make the seed what it is, from the page's own rows.
  const ana = byKey(page[w1].rows, 'name').Ana
  assert.deepEqual([ana.hours, ana.paid_hours, ana.pay], [15.5, 21.5, 292])
  const w1rows = await personWeeks(V, w1, ['hours', 'pay', 'pay_override', 'cash_pay', 'bank_pay'])
  assert.deepEqual([w1rows.Ana.hours, w1rows.Ana.pay, w1rows.Ana.bank_pay], [15.5, 292, 292])
  assert.deepEqual([w1rows.Ben.pay, w1rows.Ben.bank_pay, w1rows.Ben.cash_pay], [350, 100, 250])
  assert.equal(w1rows.Cal.pay_override, 200)
  assert.equal(w1rows.Gus.hours, 4, 'Gus worked week 1 before he was taken off week 2')
  assert.equal((await personWeeks(V, w2, ['carried_owed'])).Ana.carried_owed, 50, 'week 1\'s wage left part paid')

  // Hertford: Zed's one lunch.
  const zed = await personWeeks(W, w1, ['hours', 'pay', 'paid_days'])
  assert.deepEqual(Object.keys(zed), ['Zed'])
  const zedPage = byKey(hertford.rows, 'name').Zed
  assert.deepEqual([zed.Zed.hours, zed.Zed.pay, zed.Zed.paid_days], [zedPage.hours, zedPage.pay, zedPage.paid_days])
  assert.deepEqual([zed.Zed.hours, zed.Zed.pay], [4, 40])
})

test('the week\'s wage list beside each person\'s week', async () => {
  const w1rows = await personWeeks(V, w1, WAGE_FIELDS)
  assert.deepEqual(w1rows.Ana, { name: 'Ana', on_wage_list: true, wage: 200, wage_bank: 0, wage_cash: 150, wage_unpaid: 50 })
  assert.deepEqual(w1rows.Cal, { name: 'Cal', on_wage_list: true, wage: 100, wage_bank: 0, wage_cash: 0, wage_unpaid: 100 })
  assert.deepEqual(w1rows.Ben, { name: 'Ben', on_wage_list: false, wage: null, wage_bank: null, wage_cash: null, wage_unpaid: null })

  // Hal: on week 2's wage list, nothing on the rota (switched off after week 1).
  assert.ok(!page[w2].rows.some(r => r.name === 'Hal'), 'the Rota page has no row for him')
  const [hal] = rowsOf(await run({
    kind: 'list', subject: 'rota.staff_weeks',
    rows: cols(['name', 'role', 'entry_count', 'hours', 'pay', 'pay_type', 'tip_share', ...WAGE_FIELDS]),
    filters: [inPeriod(w2), atVenue(V), { field: 'name', op: 'is', value: 'Hal' }],
  }))
  assert.deepEqual(hal, {
    name: 'Hal', role: null, entry_count: 0, hours: 0, pay: 0, pay_type: null, tip_share: 0,
    on_wage_list: true, wage: 30, wage_bank: 0, wage_cash: 0, wage_unpaid: 30,
  })

  // Added up: the rota's pay beside the wage list.
  const [sum] = rowsOf(await run({ subject: 'rota.staff_weeks', values: measures(['on_wage_list_count', 'wage_total', 'wage_unpaid_total', 'pay_total']), filters: [inPeriod(w1), atVenue(V)] }))
  assert.deepEqual(sum, { on_wage_list_count: 2, wage_total: 300, wage_unpaid_total: 150, pay_total: page[w1].totals.pay })
})

test('each venue\'s week is the Rota page\'s totals', async () => {
  const HOURS = ['people', 'entry_count', 'hours', 'paid_hours', 'sick_hours', 'pto_hours', 'uto_hours', 'abs_hours', 'pay', 'pay_bank', 'pay_cash', 'pay_shortfall']
  const TIPS = ['points', 'tips_gross', 'surcharges', 'tips_in', 'tips_shared', 'kept_by_house', 'tips_added', 'tips_taken_out',
    'tips_carried_in', 'tips_unallocated', 'points_unallocated', 'tips_unallocated_points', 'tips_carry_out', 'tips_cash', 'tips_bank', 'tips_handed_on', 'tip_settled_in']
  const list = async fields => byKey(rowsOf(await run({
    kind: 'list', subject: 'rota.weeks', rows: cols(['date', ...fields]),
    filters: [inPeriod(w1, addDays(w3, 6)), atVenue(V)], sort: [{ by: 'date', dir: 'asc' }],
  })), 'date')
  const hours = await list(HOURS)
  const tips = await list(TIPS)
  assert.deepEqual(Object.keys(hours), [w1, w2, w3])
  for (const w of [w1, w2, w3]) {
    const pg = page[w], t = pg.totals
    const off = k => sumOf(pg.rows, r => r.absence_hours?.[k])
    const want = {
      people: pg.rows.filter(r => r.entry_count > 0).length, entry_count: sumOf(pg.rows, r => r.entry_count),
      hours: t.hours, paid_hours: t.paid_hours, sick_hours: off('sick'), pto_hours: off('pto'), uto_hours: off('uto'), abs_hours: off('abs'),
      pay: t.pay, pay_bank: t.pay_bank, pay_cash: t.pay_cash, pay_shortfall: sumOf(pg.rows, r => r.pay_shortfall),
    }
    for (const k of HOURS) same(hours[w][k], want[k], w + ' ' + k)
    for (const k of TIPS) same(tips[w][k], k === 'tip_settled_in' ? pg.tip_settled_in : t[k], w + ' ' + k)
  }
  // The seed's weeks as the Rota page has them.
  assert.deepEqual([w1, w2, w3].map(w => hours[w].pay), [1023, 643.5, 348])
  assert.deepEqual([tips[w1].tips_carry_out, tips[w2].tips_carried_in, tips[w3].tips_carried_in], [4.43, 4.43, 3.93])

  // Both venues added up: each week's hours and pay.
  const sum = byKey(rowsOf(await run({ subject: 'rota.weeks', rows: ['date'], values: measures(['weeks', 'hours_total', 'pay_total']), filters: [inPeriod(w1, addDays(w3, 6))], sort: [{ by: 'date', dir: 'asc' }] })), 'date')
  assert.deepEqual(sum[w1], { date: w1, weeks: 2, hours_total: round2(page[w1].totals.hours + hertford.totals.hours), pay_total: round2(page[w1].totals.pay + hertford.totals.pay) })
  assert.deepEqual(sum[w3], { date: w3, weeks: 1, hours_total: page[w3].totals.hours, pay_total: page[w3].totals.pay })
})

test('each tip pot\'s week and each person\'s share of it', async () => {
  const POT = ['sources', 'lines', 'gross', 'surcharge', 'total', 'distributed', 'unallocated', 'kept_by_house', 'difference', 'payout_method', 'payout_to', 'distribution']
  const pots = rowsOf(await run({
    kind: 'list', subject: 'rota.pot_weeks', rows: cols(['date', 'name', ...POT]),
    filters: [inPeriod(w1, addDays(w3, 6)), atVenue(V)], sort: [{ by: 'date', dir: 'asc' }, { by: 'name', dir: 'asc' }],
  }))
  assert.deepEqual(pots.map(p => p.date + ' ' + p.name), [
    w1 + ' Bar tips', w1 + ' Floor tips', w1 + ' House',
    w2 + ' Bar tips', w2 + ' Floor tips',
    w3 + ' Bar tips',
  ], 'a pot\'s week is a row when it holds money')
  const mine = Object.fromEntries(pots.map(p => [p.date + '|' + p.name, p]))
  for (const w of [w1, w2, w3]) {
    for (const pot of page[w].pots) {
      const r = mine[w + '|' + pot.name]
      if (!r) continue
      const want = { ...pot, sources: pot.sources_total, lines: sumOf(pot.lines || [], l => l.value) }
      for (const k of POT) same(r[k], want[k], w + ' ' + pot.name + ' ' + k)
    }
  }
  assert.deepEqual([mine[w1 + '|Floor tips'].gross, mine[w1 + '|Floor tips'].surcharge, mine[w1 + '|Floor tips'].total], [126.72, 3.17, 123.55])

  // Each person's share of each pot: the page's own pot shares.
  const shares = rowsOf(await run({ kind: 'list', subject: 'rota.tip_shares', rows: cols(['date', 'person.name', 'pot.name', 'share']), filters: [inPeriod(w1, addDays(w3, 6)), atVenue(V)] }))
  const got = shares.map(s => [s.date, s['person.name'], s['pot.name'], round2(s.share)].join('|')).sort()
  const want = []
  for (const w of [w1, w2, w3]) {
    const potName = Object.fromEntries(page[w].pots.map(p => [p.id, p.name]))
    for (const r of page[w].rows) {
      for (const [potId, share] of Object.entries(r.pot_shares || {})) if (Number(share)) want.push([w, r.name, potName[potId], round2(share)].join('|'))
    }
  }
  assert.deepEqual(got, want.sort())
  assert.ok(got.includes(w3 + '|Ivy|Bar tips|12'))
})

test('each person\'s day on the rota adds up to their week', async () => {
  const days = rowsOf(await run({
    kind: 'list', subject: 'rota.days',
    rows: cols(['date', 'person.name', 'week_start', 'entry_count', 'kind', 'worked', 'paid', 'hours', 'paid_hours', 'sick_hours', 'pto_hours', 'uto_hours', 'abs_hours', 'time_off_hours']),
    filters: [inPeriod(w1, addDays(w3, 6)), atVenue(V)], sort: [{ by: 'date', dir: 'asc' }, { by: 'person.name', dir: 'asc' }],
  }))
  // Ana's week 1: a lunch, a period past a shift, sick, paid time off, and a
  // late shift past midnight that counts on its own day.
  const ana = days.filter(d => d['person.name'] === 'Ana' && d.week_start === w1)
  assert.deepEqual(ana.map(d => [d.date, d.kind, d.hours, d.paid_hours, d.time_off_hours]), [
    [w1, 'on', 4, 4, 0],
    [addDays(w1, 1), 'on', 7.5, 7.5, 0],
    [addDays(w1, 2), 'sick', 0, 0, 4],
    [addDays(w1, 3), 'pto', 0, 6, 6],
    [addDays(w1, 5), 'on', 4, 4, 0],
  ])
  // Dee's Monday: two shifts, one day.
  const dee = days.find(d => d['person.name'] === 'Dee' && d.date === w1)
  assert.deepEqual([dee.entry_count, dee.hours], [2, 10])

  const weeks = new Map()
  for (const d of days) {
    const key = d.week_start + '|' + d['person.name']
    const x = weeks.get(key) || { entry_count: 0, days_worked: 0, paid_days: 0, hours: 0, paid_hours: 0, sick: 0, pto: 0, uto: 0, abs: 0 }
    x.entry_count += d.entry_count
    x.days_worked += d.worked ? 1 : 0
    x.paid_days += d.paid ? 1 : 0
    x.hours += d.hours
    x.paid_hours += d.paid_hours
    for (const k of ['sick', 'pto', 'uto', 'abs']) x[k] += d[k + '_hours']
    weeks.set(key, x)
  }
  let compared = 0
  for (const w of [w1, w2, w3]) {
    for (const r of page[w].rows.filter(r => r.entry_count > 0)) {
      const x = weeks.get(w + '|' + r.name)
      assert.ok(x, r.name + ' has days in the week of ' + w)
      for (const k of ['entry_count', 'days_worked', 'paid_days']) assert.equal(x[k], r[k], w + ' ' + r.name + ' ' + k)
      same(round2(x.hours), r.hours, w + ' ' + r.name + ' hours')
      same(round2(x.paid_hours), r.paid_hours, w + ' ' + r.name + ' paid hours')
      for (const k of ['sick', 'pto', 'uto', 'abs']) same(round2(x[k]), r.absence_hours?.[k] || 0, w + ' ' + r.name + ' ' + k)
      compared++
    }
  }
  assert.equal(compared, weeks.size, 'every person-week with days is a person-week with entries')
})

test('a day on the rota counts its minutes as the week does', () => {
  const shifts = [
    { id: 'lunch', start_time: '11:00', end_time: '15:00', points: 1 },
    { id: 'late', start_time: '22:00', end_time: '02:00', points: 1 },
  ]
  const e = (date, x) => ({ staff_id: 'p', work_date: date, status: 'on', ...x })
  const days = computeRotaDays({
    shifts,
    entries: [
      e('2026-09-07', { shift_id: 'lunch' }),
      e('2026-09-07', { start_time: '15:00', end_time: '16:30' }),             // 90 minutes outside every shift
      e('2026-09-08', { shift_id: 'late' }),                                    // past midnight, on its own day
      e('2026-09-09', { shift_id: 'lunch', status: 'sick' }),
      e('2026-09-09', { start_time: '17:00', end_time: '18:00', status: 'pto' }),
      e('2026-09-10', { shift_id: 'gone' }),                                    // its shift deleted: a day worked, no minutes
      e('2026-09-11', { start_time: '12:00', end_time: '13:00', status: 'abs' }),
      e('2026-09-11', { start_time: '13:00', end_time: '15:00', status: 'uto' }),
    ],
  })
  const by = Object.fromEntries(days.map(d => [d.date, d]))
  assert.deepEqual(by['2026-09-07'], { staff_id: 'p', date: '2026-09-07', entries: 2, minutes: { on: 330, pto: 0, sick: 0, uto: 0, abs: 0 }, worked: true, paid: true, kind: 'on' })
  assert.equal(by['2026-09-08'].minutes.on, 240)
  assert.deepEqual([by['2026-09-09'].kind, by['2026-09-09'].worked, by['2026-09-09'].paid, by['2026-09-09'].minutes.sick, by['2026-09-09'].minutes.pto], ['sick', false, true, 240, 60])
  assert.deepEqual([by['2026-09-10'].worked, by['2026-09-10'].minutes.on, by['2026-09-10'].kind], [true, 0, 'on'])
  assert.deepEqual([by['2026-09-11'].kind, by['2026-09-11'].paid], ['uto', false], 'the time off with the most minutes')
})

test('what was typed: rota entries, pay adjustments, tip moves, staff, time off', async () => {
  const f = [inPeriod(w1, addDays(w3, 6)), atVenue(V)]
  // Entries: every one typed on the Ware rota, shifts worked counted by status.
  const entries = byKey(rowsOf(await run({ subject: 'rota.entries', rows: ['person.name'], values: measures(['entries', 'shifts_worked']), filters: f })), 'person.name')
  for (const name of ['Ana', 'Ben', 'Cal', 'Dee']) {
    const typed = [w1, w2, w3].reduce((s, w) => s + (byKey(page[w].rows, 'name')[name]?.entry_count || 0), 0)
    assert.equal(entries[name].entries, typed, name + '\'s entries')
  }
  assert.deepEqual([entries.Ana.entries, entries.Ana.shifts_worked], [8, 6], 'Ana: eight entries, two of them time off')
  const lateShift = rowsOf(await run({ kind: 'list', subject: 'rota.entries', rows: cols(['date', 'person.name', 'shift.name', 'starts', 'ends', 'status']), filters: [...f, { field: 'shift.name', op: 'is', value: 'Late' }] }))
  assert.deepEqual(lateShift, [{ date: addDays(w1, 5), 'person.name': 'Ana', 'shift.name': 'Late', starts: '22:00', ends: '02:00', status: 'on' }])
  const period = rowsOf(await run({ kind: 'list', subject: 'rota.entries', rows: cols(['date', 'starts', 'ends']), filters: [...f, { field: 'person.name', op: 'is', value: 'Ana' }, { field: 'date', op: 'in_period', value: { from: addDays(w1, 1), to: addDays(w1, 1) } }] }))
  assert.deepEqual(period, [{ date: addDays(w1, 1), starts: '16:00', ends: '23:30' }])

  // Pay adjustments: the advance in week 1 and its repayment in week 2.
  const adj = rowsOf(await run({ kind: 'list', subject: 'rota.pay_adjustments', rows: cols(['date', 'person.name', 'kind', 'amount']), filters: f, sort: [{ by: 'date', dir: 'asc' }, { by: 'person.name', dir: 'asc' }] }))
  assert.deepEqual(adj.map(a => [a.date, a['person.name'], a.kind, a.amount]), [
    [w1, 'Ana', 'extra', 10], [w1, 'Ben', 'advance', 50], [w1, 'Dee', 'deduction', 5],
    [w2, 'Ben', 'advance_repay', 50], [w2, 'Fay', 'extra', 7.5],
  ])
  const [net] = rowsOf(await run({ subject: 'rota.pay_adjustments', values: measures(['adjustments', 'extra_total', 'deductions_total', 'advances_total', 'repaid_total', 'net_total']), filters: f }))
  assert.deepEqual(net, { adjustments: 5, extra_total: 17.5, deductions_total: 5, advances_total: 50, repaid_total: 50, net_total: 12.5 })

  // Tip moves: a line per person a move reached.
  const moves = rowsOf(await run({ kind: 'list', subject: 'rota.tip_moves', rows: cols(['date', 'kind', 'action', 'moved_from.name', 'person.name', 'points', 'tips', 'note']), filters: f, sort: [{ by: 'date', dir: 'asc' }, { by: 'person.name', dir: 'asc' }] }))
  assert.deepEqual(moves.map(m => [m.date, m.kind, m.action, m['moved_from.name'], m['person.name'], m.points, m.tips]), [
    [w1, 'money', 'add', null, 'Ben', null, 5],
    [w1, 'money', 'remove', null, 'Cal', null, -2],
    [w1, 'points', 'move', 'Ana', 'Dee', 0.5, null],
    [w2, 'money', 'move', 'Ben', 'Fay', null, 1],
  ])

  // Staff: who is on the Staff page, who left, and their roles.
  const people = byKey(rowsOf(await run({ kind: 'list', subject: 'staff.people', rows: cols(['name', 'venue.name', 'role.name', 'pay_type', 'pay_basis', 'rate', 'pay_method', 'active', 'left_on']), filters: [atVenue(V)] })), 'name')
  assert.deepEqual(Object.keys(people).sort(), ['Ana', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy'])
  assert.deepEqual(people.Ana, { name: 'Ana', 'venue.name': 'Ware', 'role.name': 'Chef', pay_type: 'hourly', pay_basis: null, rate: 12, pay_method: 'bank', active: true, left_on: null })
  assert.deepEqual([people.Cal.pay_basis, people.Ben.pay_method, people.Hal.active, people.Eve.left_on], ['day', 'split', false, addDays(w2, 2)])
  const [counts] = rowsOf(await run({ subject: 'staff.people', values: measures(['people', 'active_people', 'leavers']), filters: [atVenue(V)] }))
  assert.deepEqual(counts, { people: 9, active_people: 8, leavers: 1 })
  // Time off: Fay's week 1 holiday.
  const off = rowsOf(await run({ kind: 'list', subject: 'staff.time_off', rows: cols(['date', 'to_date', 'days', 'person.name', 'note']) }))
  assert.deepEqual(off, [{ date: w1, to_date: addDays(w1, 6), days: 7, 'person.name': 'Fay', note: 'Holiday' }])
  // Rota setup: shifts and tip pots, each pot with the service charges feeding it.
  const shifts = rowsOf(await run({ kind: 'list', subject: 'rota.shifts', rows: cols(['name', 'starts', 'ends', 'points']) }))
  assert.deepEqual(shifts.map(s => [s.name, s.starts, s.ends, s.points]), [['Lunch', '11:00', '15:00', 1], ['Dinner', '17:00', '23:00', 2], ['Late', '22:00', '02:00', 1]])
  const fed = byKey(rowsOf(await run({ subject: 'cash.sc_sources', rows: ['pot.name'], values: measures(['sources']) })), 'pot.name')
  assert.deepEqual(Object.keys(fed).sort(), ['Bar tips', 'Floor tips', 'House'])
})

test('the staff and rota starters on the weeks', async () => {
  const week1 = { period: { from: w1, to: addDays(w1, 6) } }
  const all = { period: { from: w1, to: addDays(w3, 6) } }

  // Hours and pay by person, both venues.
  const people = byKey(rowsOf(await run(starterSpec('rota_hours_pay_by_person'), week1)), 'name')
  const rows1 = [...page[w1].rows, ...hertford.rows].filter(busy)
  assert.deepEqual(Object.keys(people).sort(), rows1.map(r => r.name).sort())
  for (const r of rows1) {
    same(people[r.name].hours_total, r.hours, r.name + ' hours')
    same(people[r.name].pay_total, r.pay, r.name + ' pay')
    same(people[r.name].tip_share_total, r.tip_share, r.name + ' tips')
  }

  // Pay by week, both venues.
  const weeks = byKey(rowsOf(await run(starterSpec('rota_pay_by_week'), all)), 'date')
  same(weeks[w1].pay_total, round2(page[w1].totals.pay + hertford.totals.pay), 'week 1 pay')
  same(weeks[w1].pay_bank_total, round2(page[w1].totals.pay_bank + hertford.totals.pay_bank), 'week 1 by bank')
  same(weeks[w2].pay_cash_total, page[w2].totals.pay_cash, 'week 2 in cash')

  // Hours by day: Monday of week 1 at both venues (Ana, Ben, Cal, Dee, Zed).
  const daily = byKey(rowsOf(await run(starterSpec('rota_hours_by_day'), week1)), 'date')
  assert.deepEqual([daily[w1].hours_total, daily[w1].days_worked], [28, 5])

  // Time off by person, most first.
  const off = rowsOf(await run(starterSpec('rota_time_off_by_person'), all))
  assert.deepEqual(off.map(r => [r['person.name'], r.sick_days, r.pto_days, r.uto_days, r.abs_days, r.time_off_hours_total]), [
    ['Ana', 1, 1, 0, 0, 10], ['Ben', 0, 1, 1, 0, 8], ['Cal', 0, 0, 0, 1, 6],
  ])

  // Tips by person and pot: a column per pot.
  const grid = await run(starterSpec('rota_tips_by_person_pot'), week1)
  const col = pot => grid.columns.findIndex(c => c.key.startsWith('share_total|') && c.group === pot)
  const potName = Object.fromEntries(page[w1].pots.map(p => [p.id, p.name]))
  for (const r of page[w1].rows) {
    for (const [potId, share] of Object.entries(r.pot_shares || {})) {
      if (!Number(share)) continue
      const row = grid.rows.find(x => x.cells[0] === r.name)
      assert.ok(row && col(potName[potId]) >= 0, r.name + ' ' + potName[potId])
      same(row.cells[col(potName[potId])], round2(share), r.name + '\'s ' + potName[potId])
    }
  }

  // Tip pots by week.
  const pots = byKey(rowsOf(await run(starterSpec('rota_tip_pots_by_week'), all)), 'date')
  same(pots[w1].gross_total, sumOf(page[w1].pots, p => p.gross), 'week 1 into the pots')
  same(pots[w1].distributed_total, sumOf(page[w1].pots, p => p.distributed), 'week 1 shared')

  // Rota pay against the wage list.
  const [wages] = rowsOf(await run(starterSpec('rota_pay_against_wages'), week1))
  const pay = round2(page[w1].totals.pay + hertford.totals.pay)
  assert.deepEqual([wages.wage_total, wages.wage_unpaid_total, wages.pay_total, round2(wages.wage_less_pay)], [300, 150, pay, round2(300 - pay)])
})

test('each part needs its own module, and another group sees none of it', async () => {
  const ROTA = { rota: 'view' }
  // Hours without Rota pay: the pay is left out, said.
  const res = await run({ subject: 'rota.staff_weeks', rows: ['name'], values: measures(['hours_total', 'pay_total', 'tip_share_total']), filters: [inPeriod(w1), atVenue(V)] }, undefined, { levels: ROTA })
  assert.deepEqual(res.columns.filter(c => c.role === 'value').map(c => c.key), ['hours_total'])
  assert.deepEqual(res.meta.notes, ['Pay is left out: your role can\'t see it', 'Tips is left out: your role can\'t see it'])
  assert.equal(byKey(rowsOf(res), 'name').Ana.hours_total, 15.5)
  // A list column the role can't see is left out; grouping by one is refused.
  const list = await run({ kind: 'list', subject: 'rota.staff_weeks', rows: cols(['name', 'hours', 'pay', 'wage']), filters: [inPeriod(w1), atVenue(V)] }, undefined, { levels: ROTA })
  assert.deepEqual(list.columns.map(c => c.key), ['name', 'hours'])
  assert.equal((await refused(run({ subject: 'rota.staff_weeks', rows: ['pay_method'], values: measures(['hours_total']) }, undefined, { levels: ROTA }))).status, 403)
  assert.equal((await refused(run({ subject: 'rota.staff_weeks', rows: ['person.rate'], values: measures(['hours_total']) }, undefined, { levels: ROTA }))).status, 403, 'a rate is the Staff page\'s')
  // A person's name through the link needs nothing more.
  assert.ok(rowsOf(await run({ subject: 'rota.staff_weeks', rows: ['person.name'], values: measures(['hours_total']), filters: [inPeriod(w1)] }, undefined, { levels: ROTA })).length > 0)
  // Tips, the Staff page and the setup each have their own module.
  assert.equal((await refused(run({ subject: 'rota.tip_shares', values: measures(['share_total']) }, undefined, { levels: ROTA }))).status, 403)
  assert.equal((await refused(run({ subject: 'staff.people', values: measures(['people']) }, undefined, { levels: ROTA }))).status, 403)
  assert.equal(rowsOf(await run({ subject: 'rota.tip_shares', values: measures(['share_total']), filters: [inPeriod(w1), atVenue(V)] }, undefined, { levels: { rota_tips: 'view' } }))[0].share_total,
    round2(page[w1].rows.reduce((s, r) => s + Object.values(r.pot_shares || {}).reduce((a, b) => a + Number(b || 0), 0), 0)))

  // Another group: nothing.
  const theirs = runner(ids.b)
  for (const subject of ['rota.staff_weeks', 'rota.weeks', 'rota.pot_weeks', 'rota.tip_shares', 'rota.days']) {
    const [row] = rowsOf(await theirs({ subject, values: [{ agg: 'count' }] }))
    assert.equal(Object.values(row)[0], 0, subject)
  }
  assert.equal(rowsOf(await theirs({ subject: 'staff.people', values: measures(['people']) }))[0].people, 0)
})
