// Figures from other subjects in one report (shared/reports/also.js and the
// `also` part of the definition in shared/reports/spec.js), on a small
// catalogue: how a row of the report's own subject is found in another
// subject, and which of the report's filters apply to it too.
//
// That the engine lines the rows up and every figure matches its subject
// run alone is checked against the real catalogue in api/test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseReport, reportProblems, valueSubject, LIMITS } from '../reports/spec.js'
import { matchRow, matchRows, sharedFilters, translateFilter, heldFilters, routesTo, grainOf, WEEKLY_BUCKETS } from '../reports/also.js'
import { drillSpec, countedBy } from '../reports/drill.js'

const f = (key, label, type, more = {}) => [key, { key, label, type, ...more }]
const fields = list => Object.fromEntries(list)
const link = (key, label, to, more = {}) => [key, { key, label, to, ...more }]
const day = (label = 'Day', more = {}) => f('date', label, 'date', more)

// Sales lines belong to checks; a check has a server and a venue, a payment
// its check and whoever took it. Hours on the rota are weekly, per person
// (people aren't till staff); the weather is daily per venue. Menus have no
// day and no venue.
const CAT = {
  subjects: {
    venue: { key: 'venue', label: 'Venues', fields: fields([f('name', 'Name', 'text'), f('town', 'Town', 'text')]), measures: {}, links: {} },
    staff: { key: 'staff', label: 'Till staff', fields: fields([f('name', 'Name', 'text')]), measures: {}, links: fields([link('venue', 'Venue', 'venue')]) },
    people: { key: 'people', label: 'Staff', fields: fields([f('name', 'Name', 'text')]), measures: {}, links: fields([link('venue', 'Venue', 'venue')]) },
    sections: { key: 'sections', label: 'Menu sections', fields: fields([f('name', 'Name', 'text')]), measures: {}, links: {} },
    checks: {
      key: 'checks', label: 'Checks',
      fields: fields([day('Trading day'), f('number', 'Check', 'text'), f('opened_at', 'Opened', 'moment'), f('status', 'Status', 'choice')]),
      measures: {},
      links: fields([link('venue', 'Venue', 'venue'), link('server', 'Server', 'staff'), link('opened_by', 'Opened by', 'staff')]),
    },
    lines: {
      key: 'lines', label: 'Dishes sold',
      fields: fields([day('Trading day'), f('name', 'Dish', 'text'), f('qty', 'Quantity', 'number')]),
      measures: {},
      links: fields([link('venue', 'Venue', 'venue'), link('check', 'Check', 'checks'), link('section', 'Section', 'sections')]),
    },
    payments: {
      key: 'payments', label: 'Payments',
      fields: fields([day('Trading day'), f('tender', 'Tender', 'choice')]),
      measures: {},
      links: fields([link('venue', 'Venue', 'venue'), link('taken_by', 'Taken by', 'staff'), link('check', 'Check', 'checks')]),
    },
    hours: {
      key: 'hours', label: 'Hours on the rota',
      fields: fields([day('Week starting', { grain: 'week' }), f('hours', 'Hours', 'number')]),
      measures: {},
      links: fields([link('venue', 'Venue', 'venue'), link('person', 'Person', 'people')]),
    },
    weather: {
      key: 'weather', label: 'Weather',
      fields: fields([day(), f('max', 'Highest', 'number')]),
      measures: {},
      links: fields([link('venue', 'Venue', 'venue')]),
    },
    pay: {
      key: 'pay', label: 'Pay by week',
      fields: fields([day('Week starting', { grain: 'week' })]),
      measures: {},
      links: fields([link('venue', 'Venue', 'venue')]),
    },
    menus: { key: 'menus', label: 'Menus', fields: fields([f('name', 'Name', 'text')]), measures: {}, links: fields([link('section', 'Section', 'sections', { many: true })]) },
    company: { key: 'company', label: 'Company costs', fields: fields([day(), f('amount', 'Amount', 'money')]), measures: {}, links: {} },
  },
}

const row = (field, bucket) => ({ field, ...(bucket ? { bucket } : {}) })
const ok = (field, bucket) => ({ ok: true, field, ...(bucket ? { bucket } : {}) })

test('the same subject lines up by the same field, whatever it is', () => {
  assert.deepEqual(matchRow(CAT, 'lines', row('name'), 'lines'), ok('name'))
  assert.deepEqual(matchRow(CAT, 'lines', row('date', 'weekday'), 'lines'), ok('date', 'weekday'))
  assert.deepEqual(matchRow(CAT, 'lines', row('check.server.name'), 'lines'), ok('check.server.name'))
  // "By day" is no grouping at all.
  assert.deepEqual(matchRow(CAT, 'lines', row('date', 'day'), 'lines'), ok('date'))
})

test('the report\'s day lines up with the other subject\'s own day, grouped the same way', () => {
  for (const b of [null, 'week', 'month', 'quarter', 'year', 'weekday']) {
    assert.deepEqual(matchRow(CAT, 'lines', row('date', b), 'weather'), ok('date', b), String(b))
  }
  const none = matchRow(CAT, 'lines', row('date', 'week'), 'menus')
  assert.equal(none.ok, false)
  assert.equal(none.why, 'Menus has no day of its own, so it can\'t be lined up by week.')
})

test('a weekly subject lines up with days only by week or longer', () => {
  assert.equal(grainOf(CAT.subjects.hours), 'week')
  assert.equal(grainOf(CAT.subjects.lines), 'day')
  // Days beside weeks: weeks or longer only.
  for (const b of WEEKLY_BUCKETS) assert.deepEqual(matchRow(CAT, 'lines', row('date', b), 'hours'), ok('date', b), b)
  for (const b of [null, 'weekday']) {
    const r = matchRow(CAT, 'lines', row('date', b), 'hours')
    assert.equal(r.ok, false, String(b))
  }
  assert.equal(matchRow(CAT, 'lines', row('date'), 'hours').why,
    'Hours on the rota has a row for each week, so it lines up by week, month, quarter or year, not by trading day.')
  assert.equal(matchRow(CAT, 'lines', row('date', 'weekday'), 'hours').why,
    'Hours on the rota has a row for each week, so it lines up by week, month, quarter or year, not by day of the week.')
  // Weeks beside days: each week (its Monday) takes the other's days by week.
  assert.deepEqual(matchRow(CAT, 'hours', row('date'), 'lines'), ok('date', 'week'))
  assert.deepEqual(matchRow(CAT, 'hours', row('date', 'week'), 'lines'), ok('date', 'week'))
  assert.deepEqual(matchRow(CAT, 'hours', row('date', 'month'), 'lines'), ok('date', 'month'))
  assert.equal(matchRow(CAT, 'hours', row('date', 'weekday'), 'lines').why,
    'Hours on the rota has a row for each week, so it can\'t be lined up with dishes sold by day of the week.')
  // Weeks beside weeks: as they are.
  assert.deepEqual(matchRow(CAT, 'hours', row('date'), 'pay'), ok('date'))
  assert.deepEqual(matchRow(CAT, 'hours', row('date', 'quarter'), 'pay'), ok('date', 'quarter'))
})

test('a thing both lead to lines up by the same field of it, through the other\'s own links', () => {
  // The venue, by the other subject's venue link.
  assert.deepEqual(matchRow(CAT, 'lines', row('venue.name'), 'weather'), ok('venue.name'))
  assert.deepEqual(matchRow(CAT, 'lines', row('venue.town'), 'hours'), ok('venue.town'))
  // Two links on, the same way when the other subject has it.
  assert.deepEqual(matchRow(CAT, 'lines', row('check.venue.name'), 'weather'), ok('venue.name'))
  // The other subject is the thing itself.
  assert.deepEqual(matchRow(CAT, 'lines', row('venue.name'), 'venue'), ok('name'))
  assert.deepEqual(matchRow(CAT, 'lines', row('check.number'), 'checks'), ok('number'))
  // A check's server: the payment's check's server, not whoever took the payment.
  assert.deepEqual(matchRow(CAT, 'lines', row('check.server.name'), 'payments'), ok('check.server.name'))
  assert.deepEqual(matchRow(CAT, 'checks', row('server.name'), 'payments'), ok('check.server.name'))
  // Who took a payment: the check's opener and server are both till staff;
  // with no link of the same name, the shortest and first.
  assert.deepEqual(matchRow(CAT, 'payments', row('taken_by.name'), 'checks'), ok('server.name'))
  // A field of a linked thing keeps its grouping.
  assert.deepEqual(matchRow(CAT, 'lines', row('check.opened_at', 'hour'), 'payments'), ok('check.opened_at', 'hour'))
})

test('rows that can\'t be lined up say why', () => {
  const own = matchRow(CAT, 'lines', row('name'), 'weather')
  assert.equal(own.why, 'Weather can\'t be lined up by dish: it belongs to dishes sold only.')
  const unlinked = matchRow(CAT, 'lines', row('section.name'), 'weather')
  assert.equal(unlinked.why, 'Weather isn\'t linked to menu sections, so it can\'t be lined up by section name.')
  // Rota people aren't till staff.
  assert.equal(matchRow(CAT, 'lines', row('check.server.name'), 'hours').ok, false)
  // A list of rows is never walked (menus have sections, but several).
  assert.equal(matchRow(CAT, 'lines', row('section.name'), 'menus').ok, false)
  assert.equal(matchRow(CAT, 'lines', row('nothing'), 'weather').ok, false)
  assert.equal(matchRow(CAT, 'lines', row('venue.name'), 'nowhere').why, 'There is nothing to report on called "nowhere"')
  assert.equal(matchRow(CAT, 'nowhere', row('name'), 'lines').ok, false)
})

test('the ways from one subject to another, shortest first, never through a list', () => {
  assert.deepEqual(routesTo(CAT, 'payments', 'staff'), [['taken_by'], ['check', 'server'], ['check', 'opened_by']])
  assert.deepEqual(routesTo(CAT, 'payments', 'staff', 1), [['taken_by']])
  assert.deepEqual(routesTo(CAT, 'menus', 'sections'), [])
  assert.deepEqual(routesTo(CAT, 'weather', 'checks'), [])
})

test('every row of a report is lined up, or each one that isn\'t is listed', () => {
  const spec = normaliseReport({ subject: 'lines', rows: ['date:week', 'venue.name'], values: [{ measure: 'net_sales' }] })
  assert.deepEqual(matchRows(CAT, spec, 'hours'), { ok: true, rows: [{ field: 'date', bucket: 'week' }, { field: 'venue.name' }] })
  const byDish = normaliseReport({ subject: 'lines', rows: ['date', 'name'], values: [{ measure: 'net_sales' }] })
  const r = matchRows(CAT, byDish, 'hours')
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing.map(x => x.row.field), ['date', 'name'])
  // A total with no rows lines up with any subject.
  assert.deepEqual(matchRows(CAT, normaliseReport({ subject: 'lines', values: [{ measure: 'net_sales' }] }), 'menus'), { ok: true, rows: [] })
})

test('the period and the venues apply to the other subject too; other filters stay put', () => {
  const spec = normaliseReport({
    subject: 'lines',
    params: [{ key: 'period', type: 'period' }, { key: 'venues', type: 'venues' }],
    rows: ['date:week'],
    values: [{ measure: 'net_sales' }],
    filters: [
      { field: 'date', op: 'in_period', param: 'period' },
      { field: 'venue', op: 'in', param: 'venues' },
      { field: 'venue.town', op: 'is', value: 'Ware' },
      { field: 'section.name', op: 'is', value: 'Drinks' },
      { any: [{ field: 'date', op: 'after', value: '2026-10-01' }] },
      { field: 'date', bucket: 'weekday', op: 'in', value: [5, 6] },
      { field: 'date', bucket: 'month', op: 'is', value: '2026-10-01' },
    ],
  })
  const period = spec.filters[0]
  const venues = spec.filters[1]
  const town = spec.filters[2]
  const weekdays = spec.filters[5]
  const month = spec.filters[6]
  const left = (filter, why) => ({ filter, why })
  // A daily subject with a venue takes every filter on the day or the venue.
  assert.deepEqual(sharedFilters(CAT, spec, 'weather'), { filters: [period, venues, town, weekdays, month], left: [] })
  // A weekly one: the period and whole months, not "Fridays and Saturdays".
  assert.deepEqual(sharedFilters(CAT, spec, 'hours'), {
    filters: [period, venues, town, month],
    left: [left(weekdays, 'Hours on the rota has a row for each week, so the filter on day of the week doesn\'t apply to it.')],
  })
  // No venue: the venue filters can't apply. No day either: nothing does.
  assert.deepEqual(sharedFilters(CAT, spec, 'company'), {
    filters: [period, weekdays, month],
    left: [
      left(venues, 'Company costs has no venue, so the filter on venue doesn\'t apply to it.'),
      left(town, 'Company costs has no venue, so the filter on venue town doesn\'t apply to it.'),
    ],
  })
  const menus = sharedFilters(CAT, spec, 'menus')
  assert.deepEqual(menus.filters, [])
  assert.deepEqual(menus.left.map(l => l.filter), [period, venues, town, weekdays, month])
  assert.equal(menus.left[0].why, 'Menus has no day of its own, so the filter on trading day doesn\'t apply to it.')
  assert.equal(menus.left[1].why, 'Menus has no venue, so the filter on venue doesn\'t apply to it.')
  // The same subject is no different: lunch beside dinner keeps its own section.
  assert.deepEqual(sharedFilters(CAT, spec, 'lines').filters, [period, venues, town, weekdays, month])
  assert.deepEqual(sharedFilters(CAT, spec, 'nowhere'), { filters: [], left: [] })
  // From a weekly report to a daily subject, the report's day is a week: the
  // daily rows of the weeks it picks, whatever the filter says of the day.
  const weekly = normaliseReport({
    subject: 'hours', rows: ['date'], values: [{ agg: 'sum', field: 'hours' }],
    params: [{ key: 'period', type: 'period' }],
    filters: [
      { field: 'date', op: 'in_period', param: 'period' },
      { field: 'date', op: 'is', value: '2026-10-05' },
      { field: 'date', bucket: 'month', op: 'is', value: '2026-10-01' },
      { field: 'date', bucket: 'weekday', op: 'is', value: 1 },
    ],
  })
  const [wp, wd, wm, ww] = weekly.filters
  assert.deepEqual(sharedFilters(CAT, weekly, 'lines'), {
    filters: [{ ...wp, bucket: 'week' }, { ...wd, bucket: 'week' }, wm],
    left: [left(ww, 'Hours on the rota has a row for each week, so the filter on day of the week doesn\'t apply to dishes sold.')],
  })
  // Weekly to weekly takes them as they are.
  assert.deepEqual(sharedFilters(CAT, weekly, 'pay').filters, weekly.filters)
})

test('one filter at a time, as another subject takes it', () => {
  const t = (main, other, filter) => translateFilter(CAT, main, other, filter)
  // Not on the day or the venue: it stays with the report's own subject.
  assert.equal(t('lines', 'weather', { field: 'name', op: 'is', value: 'Pad Thai' }).ok, false)
  assert.equal(t('lines', 'weather', { any: [{ field: 'date', op: 'is', value: '2026-10-01' }] }).ok, false)
  // A period with no grouping goes as it is, either way round.
  const period = { field: 'date', op: 'in_period', param: 'period' }
  assert.deepEqual(t('lines', 'hours', period), { ok: true, filter: period })
  assert.deepEqual(t('hours', 'lines', period), { ok: true, filter: { ...period, bucket: 'week' } })
  // A day by itself has no weekly row.
  const one = { field: 'date', op: 'is', value: '2026-10-07' }
  assert.deepEqual(t('lines', 'hours', one), { ok: false, why: 'Hours on the rota has a row for each week, so the filter on trading day doesn\'t apply to it.' })
  // By week from a weekly report stays by week.
  const wk = { field: 'date', bucket: 'week', op: 'in', value: ['2026-10-05'] }
  assert.deepEqual(t('hours', 'lines', wk), { ok: true, filter: wk })
  // A venue goes to anything with the same venue.
  assert.deepEqual(t('lines', 'staff', { field: 'venue', op: 'in', param: 'venues' }).ok, true)
  // Unknown subjects take nothing.
  assert.equal(t('lines', 'nowhere', period).ok, false)
})

test('a definition keeps its other subjects, keys and their own filters', () => {
  const s = normaliseReport({
    subject: 'till.lines',
    params: [{ key: 'period', type: 'period' }],
    rows: ['date:week'],
    values: [
      { measure: 'net_sales' },
      { measure: 'hours_total', from: 's2', label: 'Hours' },
      { measure: 'max_temp', from: 'weather' },
      { measure: 'x', from: 'nope' },
      { calc: 'net_sales / hours_total', from: 's2', format: 'money' },
      { agg: 'sum', field: 'hours', from: 's2' },
    ],
    also: [
      { subject: 'rota.staff_weeks', key: 's2', label: 'Rota', filters: [{ field: 'role.name', op: 'is', value: 'Kitchen' }, { field: 'date', op: 'in_period', param: 'period' }, { field: 'x', op: 'in_period', param: 'nope' }] },
      { subject: 'local.weather', key: 'weather' },
      { subject: 'NOT A PATH' },
      { subject: 'a' }, { subject: 'b' }, { subject: 'c' },
    ],
  })
  assert.equal(s.also.length, LIMITS.also)
  assert.deepEqual(s.also[0], {
    key: 's2', subject: 'rota.staff_weeks', label: 'Rota',
    filters: [{ field: 'role.name', op: 'is', value: 'Kitchen' }, { field: 'date', op: 'in_period', param: 'period' }],
  })
  assert.deepEqual(s.also[1], { key: 'weather', subject: 'local.weather', filters: [] })
  assert.deepEqual(s.also[2], { key: 's3', subject: 'a', filters: [] })
  // A value naming a subject the report doesn't have goes; a calculation belongs to none.
  assert.deepEqual(s.values.map(v => [v.key, v.from || null]), [
    ['net_sales', null], ['hours_total', 's2'], ['max_temp', 'weather'], ['calc_1', null], ['sum_hours', 's2'],
  ])
  assert.equal(valueSubject(s, s.values[0]), 'till.lines')
  assert.equal(valueSubject(s, s.values[1]), 'rota.staff_weeks')
  assert.equal(valueSubject(s, s.values[3]), 'till.lines')
  // Doing it again changes nothing.
  assert.deepEqual(normaliseReport(s), s)
  assert.deepEqual(normaliseReport(JSON.parse(JSON.stringify(s))), s)
  // The rota has a day filter of its own (its days follow the report's
  // period); the third has no figure.
  assert.deepEqual(reportProblems(s), [
    'Rota: its days follow the report\'s period. Take its own filter on the day out',
    'Another subject of the report: add a figure from it, or take it out',
  ])
  // A day filter inside a group of filters counts too; one on another field doesn't.
  const grouped = { ...s, also: [{ ...s.also[0], filters: [{ any: [{ field: 'role.name', op: 'is', value: 'Bar' }, { field: 'date', op: 'is', value: '2026-10-05' }] }] }, s.also[1]] }
  assert.deepEqual(reportProblems(grouped), ['Rota: its days follow the report\'s period. Take its own filter on the day out'])
  const fine = { ...s, also: [{ ...s.also[0], filters: [{ field: 'role.name', op: 'is', value: 'Bar' }] }, s.also[1]] }
  assert.deepEqual(reportProblems(fine), [])
})

test('keys given are kept; the rest are numbered around them', () => {
  const s = normaliseReport({ subject: 'x', values: [{ measure: 'a' }], also: [{ subject: 'p' }, { subject: 'q', key: 's2' }, { subject: 'r', key: 's2' }] })
  assert.deepEqual(s.also.map(a => a.key), ['s3', 's2', 's4'])
  const bad = normaliseReport({ subject: 'x', values: [{ measure: 'a' }], also: [{ subject: 'p', key: 'Has Spaces' }, { subject: 'q', key: '9' }] })
  assert.deepEqual(bad.also.map(a => a.key), ['s2', 's3'])
})

test('only a summary has other subjects; a list or a matrix drops them and their figures', () => {
  const base = { subject: 'x', rows: ['date'], values: [{ measure: 'a' }, { measure: 'b', from: 's2' }], also: [{ subject: 'y', key: 's2' }] }
  const list = normaliseReport({ ...base, kind: 'list' })
  assert.deepEqual([list.also, list.values], [[], []])
  const matrix = normaliseReport({ ...base, kind: 'matrix', columns: ['venue.name'] })
  assert.equal(matrix.kind, 'matrix')
  assert.deepEqual(matrix.also, [])
  assert.deepEqual(matrix.values.map(v => v.key), ['a'])
  const summary = normaliseReport(base)
  assert.equal(summary.also.length, 1)
  assert.deepEqual(reportProblems(summary), [])
  // A figure from another subject can be sorted by, charted and ranked by, as any value.
  const sorted = normaliseReport({ ...base, sort: [{ by: 'b', dir: 'desc' }], view: { kind: 'bar', y: ['a', 'b'], line: 'b' }, limit: { top: 5 } })
  assert.deepEqual(sorted.sort, [{ by: 'b', dir: 'desc' }])
  assert.deepEqual(sorted.view.y, ['a', 'b'])
  assert.equal(sorted.view.line, 'b')
  // A calculation reading a figure that went is a problem, as any unknown value is.
  const gone = normaliseReport({ ...base, also: [], values: [...base.values, { calc: 'a / b' }] })
  assert.equal(reportProblems(gone).length, 1)
  assert.match(reportProblems(gone)[0], /"b"/)
})

test('a definition without other subjects comes out with none', () => {
  const s = normaliseReport({ subject: 'x', values: [{ measure: 'a' }] })
  assert.deepEqual(s.also, [])
  for (const junk of [null, 'x', 7, { subject: 7 }, [{ subject: '' }]]) assert.deepEqual(normaliseReport({ subject: 'x', values: [{ measure: 'a' }], also: junk }).also, [])
})

test('a drilled row\'s groupings, as another subject finds them', () => {
  const held = [
    { field: 'check.server.name', op: 'is', value: 'Ali' },
    { field: 'date', bucket: 'week', op: 'is', value: '2026-10-05' },
    { field: 'venue.name', op: 'is', value: 'Ware' },
  ]
  // The day and the venue stay with the report's filters (sharedFilters()
  // takes them over); the server is the payment's check's server.
  assert.deepEqual(heldFilters(CAT, 'lines', 'payments', held), { ok: true, filters: [{ field: 'check.server.name', op: 'is', value: 'Ali' }] })
  // An empty grouping stays empty; a bucket the other subject doesn't need goes.
  assert.deepEqual(heldFilters(CAT, 'lines', 'checks', [{ field: 'check.server.name', op: 'empty' }]), { ok: true, filters: [{ field: 'server.name', op: 'empty' }] })
  assert.deepEqual(heldFilters(CAT, 'lines', 'lines', [{ field: 'date', bucket: 'weekday', op: 'is', value: 5 }]), { ok: true, filters: [] })
  assert.deepEqual(heldFilters(CAT, 'lines', 'lines', [{ field: 'name', op: 'is', value: 'Pad Thai' }]), { ok: true, filters: [{ field: 'name', op: 'is', value: 'Pad Thai' }] })
  // A grouping the other subject can't line up by: its figures can't be shown for the row.
  const no = heldFilters(CAT, 'lines', 'weather', held)
  assert.equal(no.ok, false)
  assert.match(no.why, /Weather isn't linked to till staff/)
  assert.deepEqual(heldFilters(CAT, 'lines', 'weather', []), { ok: true, filters: [] })
})

// Dishes sold beside the rota's hours and the weather, by venue, opening
// up by server, then section.
const MIXED = normaliseReport({
  subject: 'lines',
  params: [{ key: 'period', type: 'period' }, { key: 'venues', type: 'venues' }],
  rows: [{ field: 'venue.name' }],
  values: [
    { key: 'sales', measure: 'net_sales' },
    { key: 'hours', measure: 'hours_total', from: 's2' },
    { key: 'hot', measure: 'max_temp', from: 'sky' },
    { key: 'per_hour', calc: 'sales / hours' },
    { key: 'double', calc: 'hours * 2' },
  ],
  filters: [{ field: 'date', op: 'in_period', param: 'period' }, { field: 'venue', op: 'in', param: 'venues' }],
  also: [
    { key: 's2', subject: 'hours', label: 'Rota', filters: [{ field: 'person.name', op: 'is_not', value: 'Agency' }] },
    { key: 'sky', subject: 'weather' },
  ],
  drill: { down: [{ field: 'check.server.name' }, { field: 'section.name' }] },
})
const COLUMNS = { lines: ['name', 'qty'], hours: ['person.name', 'hours'], weather: ['date', 'max'] }
const opts = { catalogue: CAT, listColumns: subject => COLUMNS[subject] || [] }

test('breaking a row down keeps the other subjects held to it, and drops one that can\'t be lined up', () => {
  // By venue to by server: the venue is the report's own filter, which the
  // other subjects take too; both stay with their own filters.
  const one = drillSpec(MIXED, { at: [{ field: 'venue.name', value: 'Ware' }], to: { field: 'check.server.name' } }, opts)
  assert.ok(one.spec, one.problem)
  assert.deepEqual(one.spec.also, MIXED.also)
  assert.deepEqual(one.spec.values.map(v => v.key), ['sales', 'hours', 'hot', 'per_hour', 'double'])
  assert.deepEqual(one.spec.filters.at(-1), { field: 'venue.name', op: 'is', value: 'Ware' })
  assert.deepEqual(one.spec.drill.down, [{ field: 'section.name' }])

  // Then Ali, by section: neither the rota nor the weather knows a till
  // server, so they go, with their figures and the calculations reading them.
  const two = drillSpec(one.spec, { at: [{ field: 'check.server.name', value: 'Ali' }], to: { field: 'section.name' } }, opts)
  assert.ok(two.spec, two.problem)
  assert.deepEqual(two.spec.also, [])
  assert.deepEqual(two.spec.values.map(v => v.key), ['sales'])
  assert.deepEqual(reportProblems(two.spec), [])

  // A row held to something the rota can line up by: its own filter grows.
  const sameSubject = normaliseReport({ ...MIXED, also: [{ key: 's2', subject: 'lines', label: 'Last orders', filters: [{ field: 'qty', op: 'gt', value: 1 }] }], values: [{ key: 'sales', measure: 'net_sales' }, { key: 'more', measure: 'net_sales', from: 's2' }] })
  const held = drillSpec(sameSubject, { at: [{ field: 'venue.name', value: 'Ware' }, { field: 'check.server.name', value: 'Ali' }], to: { field: 'section.name' } }, opts)
  assert.ok(held.spec, held.problem)
  assert.deepEqual(held.spec.also[0].filters, [{ field: 'qty', op: 'gt', value: 1 }, { field: 'check.server.name', op: 'is', value: 'Ali' }])

  // Without the catalogue the subjects can't be held to a row: they go.
  const blind = drillSpec(MIXED, { at: [{ field: 'venue.name', value: 'Ware' }], to: { field: 'check.server.name' } })
  assert.deepEqual(blind.spec.also, [])
  assert.deepEqual(blind.spec.values.map(v => v.key), ['sales'])
  // With nothing held they stay as they are.
  assert.deepEqual(drillSpec(MIXED, { at: [], to: { field: 'check.server.name' } }).spec.also, MIXED.also)
})

test('the rows behind another subject\'s figure are that subject\'s rows', () => {
  const at = [{ field: 'venue.name', value: 'Ware' }]
  const hours = drillSpec(MIXED, { at, to: 'rows', value: 'hours' }, opts)
  assert.ok(hours.spec, hours.problem)
  assert.equal(hours.spec.kind, 'list')
  assert.equal(hours.spec.subject, 'hours')
  assert.deepEqual(hours.spec.rows, [{ field: 'person.name' }, { field: 'hours' }])
  // The report's period and venues (the rota is weekly: the period as whole
  // weeks starting in it), the row's venue, the rota's own filter, and only
  // the rows its figure counts.
  assert.deepEqual(hours.spec.filters, [
    { field: 'date', op: 'in_period', param: 'period' },
    { field: 'venue', op: 'in', param: 'venues' },
    { field: 'venue.name', op: 'is', value: 'Ware' },
    { field: 'person.name', op: 'is_not', value: 'Agency' },
    { counted: ['hours_total'] },
  ])
  // A calculation reading only the rota's figures lists the rota's rows.
  assert.equal(drillSpec(MIXED, { at, to: 'rows', value: 'double' }, opts).spec.subject, 'hours')
  // One reading the report's own figures and the rota's lists the report's
  // own rows, counted by its own figures only; so does a tap on the row.
  for (const value of ['per_hour', undefined]) {
    const own = drillSpec(MIXED, { at, to: 'rows', ...(value ? { value } : {}) }, opts)
    assert.equal(own.spec.subject, 'lines')
    assert.deepEqual(own.spec.filters.at(-1), { counted: ['net_sales'] })
  }
  // Every row of a subject whose figure has no rule of its own.
  assert.equal(countedBy(MIXED, 'hot', { from: 'sky' }).join(), 'max_temp')
  assert.equal(countedBy({ ...MIXED, values: [{ key: 'n', agg: 'count', from: 'sky' }] }, 'n', { from: 'sky' }), null)
  // The weather can't be held to a server: its rows can't be listed for one.
  const ali = drillSpec(normaliseReport({ ...MIXED, rows: [{ field: 'check.server.name' }] }), { at: [{ field: 'check.server.name', value: 'Ali' }], to: 'rows', value: 'hot' }, opts)
  assert.match(ali.problem, /can't be listed for this row/)
})
