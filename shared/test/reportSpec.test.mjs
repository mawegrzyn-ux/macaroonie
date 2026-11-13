import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseReport, reportProblems, resolveParams, newReport, rowId, rankKey, periodParams,
  cleanPath, cleanVenues, LIMITS, SPEC_VERSION, FILTER_OPS, OP_LABELS, OPS_BY_TYPE, AGGS, AGG_LABELS,
  VIEW_KINDS, VIEW_LABELS, REPORT_KINDS, KIND_LABELS,
} from '../reports/spec.js'
import { cleanDrill, drillSpec, countedBy } from '../reports/drill.js'
import { resolvePath, pathLabel, bucketsFor, bucketType, fieldChoices } from '../reports/paths.js'
import { VALUE_TYPES } from '../reports/format.js'

const V1 = '11111111-1111-4111-8111-111111111111'
const V2 = '22222222-2222-4222-8222-222222222222'

const byDish = () => ({
  subject: 'till.lines',
  params: [
    { key: 'period', type: 'period', default: { relative: 'last_week' } },
    { key: 'venues', type: 'venues', default: 'all' },
  ],
  rows: [{ field: 'section.name' }, { field: 'name' }],
  values: [{ measure: 'qty_sold' }, { measure: 'net_sales' }, { calc: 'net_sales / total(net_sales)', label: 'Share', format: 'percent' }],
  filters: [
    { field: 'date', op: 'in_period', param: 'period' },
    { field: 'venue', op: 'in', param: 'venues' },
  ],
  sort: [{ by: 'net_sales', dir: 'desc' }],
  totals: { grand: true, subtotals: ['section.name'] },
})

test('labels exist for everything a person picks from', () => {
  for (const k of REPORT_KINDS) assert.ok(KIND_LABELS[k])
  for (const k of AGGS) assert.ok(AGG_LABELS[k])
  for (const k of VIEW_KINDS) assert.ok(VIEW_LABELS[k])
  for (const k of FILTER_OPS) assert.ok(OP_LABELS[k])
  for (const [type, ops] of Object.entries(OPS_BY_TYPE)) {
    assert.ok(VALUE_TYPES.includes(type), type)
    for (const op of ops) assert.ok(FILTER_OPS.includes(op), type + ' ' + op)
  }
  for (const t of VALUE_TYPES) assert.ok(OPS_BY_TYPE[t], t + ' can be filtered')
})

test('a definition comes out in the one known shape', () => {
  const s = normaliseReport(byDish())
  assert.equal(s.version, SPEC_VERSION)
  assert.equal(s.kind, 'summary')
  assert.equal(s.subject, 'till.lines')
  assert.deepEqual(s.rows, [{ field: 'section.name' }, { field: 'name' }])
  assert.deepEqual(s.values.map(v => v.key), ['qty_sold', 'net_sales', 'calc_1'])
  assert.equal(s.values[2].format, 'percent')
  assert.deepEqual(s.sort, [{ by: 'net_sales', dir: 'desc' }])
  assert.deepEqual(s.totals, { grand: true, subtotals: ['section.name'] })
  assert.deepEqual(s.columns, [])
  assert.equal(s.limit, null)
  assert.equal(s.compare, null)
  assert.equal(s.drill, null)
  assert.deepEqual(s.view, { kind: 'table' })
  assert.deepEqual(reportProblems(s), [])
  // Doing it again changes nothing.
  assert.deepEqual(normaliseReport(s), s)
  assert.deepEqual(normaliseReport(JSON.parse(JSON.stringify(s))), s)
})

test('rubbish comes out empty, never thrown', () => {
  for (const junk of [null, undefined, 'x', 42, [], { rows: 'x', values: { a: 1 }, filters: 7, sort: 'up', params: null }]) {
    const s = normaliseReport(junk)
    assert.equal(s.kind, 'list')
    assert.equal(s.subject, '')
    assert.deepEqual([s.rows, s.columns, s.values, s.filters, s.sort, s.params], [[], [], [], [], [], []])
    assert.ok(reportProblems(s).length >= 1)
  }
  assert.equal(cleanPath('check.server.name'), 'check.server.name')
  assert.equal(cleanPath(' Name '), 'name')
  assert.equal(cleanPath('a.b.c.d.e'), 'a.b.c.d.e')
  assert.equal(cleanPath('a.b.c.d.e.f'), null, 'four links at most')
  for (const bad of ['', 'a..b', '.a', 'a.', '1a', 'a b', 'a;drop', 'a-b', "a'b", 'a"b', 'a)', null, 5]) assert.equal(cleanPath(bad), null, String(bad))
})

test('the kind follows the parts, and parts that make no sense with it go', () => {
  // Columns make a matrix; values without columns a summary; neither a list.
  assert.equal(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], columns: [{ field: 'b' }], values: [{ measure: 'm' }] }).kind, 'matrix')
  assert.equal(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], values: [{ measure: 'm' }] }).kind, 'summary')
  assert.equal(normaliseReport({ subject: 'x', rows: [{ field: 'a' }] }).kind, 'list')
  // A matrix without columns is a summary; a list has no values.
  assert.equal(normaliseReport({ kind: 'matrix', subject: 'x', rows: [{ field: 'a' }], values: [{ measure: 'm' }] }).kind, 'summary')
  const list = normaliseReport({ kind: 'list', subject: 'x', rows: [{ field: 'a', bucket: 'week' }, 'b'], values: [{ measure: 'm' }], columns: [{ field: 'c' }], limit: { top: 5 }, compare: { with: 'last_year' }, view: { kind: 'bar' } })
  assert.deepEqual(list.rows, [{ field: 'a' }, { field: 'b' }], 'a list shows fields as they are')
  assert.deepEqual([list.values, list.columns, list.limit, list.compare], [[], [], null, null])
  assert.equal(list.view.kind, 'table')
  // A matrix's column can't also be a row.
  const m = normaliseReport({ subject: 'x', rows: [{ field: 'a' }], columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }, { field: 'd' }], values: [{ measure: 'm' }] })
  assert.deepEqual(m.columns, [{ field: 'b' }], 'two columns at most, none repeating a row')
  assert.equal(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], columns: [{ field: 'a' }], values: [{ measure: 'm' }] }).kind, 'summary')
  // Comparing is for summaries.
  assert.equal(m.compare, null)
  assert.deepEqual(normaliseReport({ ...byDish(), compare: { with: 'last_year' } }).compare, { with: 'last_year' })
  assert.equal(normaliseReport({ ...byDish(), compare: { with: 'next_year' } }).compare, null)
})

test('rows, buckets and their names', () => {
  const s = normaliseReport({
    subject: 'till.checks',
    rows: ['date:week', { field: 'opened_at', bucket: 'hour', label: 'Hour' }, { field: 'date', bucket: 'week' }, { field: 'date', bucket: 'fortnight' }, { field: 'DATE' }, { field: 'no way' }],
    values: [{ agg: 'count' }],
  })
  assert.deepEqual(s.rows, [{ field: 'date', bucket: 'week' }, { field: 'opened_at', bucket: 'hour', label: 'Hour' }, { field: 'date' }])
  assert.deepEqual(s.rows.map(rowId), ['date:week', 'opened_at:hour', 'date'])
  assert.equal(normaliseReport({ subject: 'x', rows: Array.from({ length: 20 }, (_, i) => ({ field: 'f' + i })), values: [{ agg: 'count' }] }).rows.length, LIMITS.rows)
  assert.equal(normaliseReport({ subject: 'x', rows: Array.from({ length: 50 }, (_, i) => ({ field: 'f' + i })) }).rows.length, LIMITS.list_columns)
  assert.equal(normaliseReport({ subject: 'x', rows: [{ field: 'a', label: 'x'.repeat(200) }] }).rows[0].label.length, LIMITS.label)
})

test('values get keys that never clash', () => {
  const s = normaliseReport({
    subject: 'x',
    values: [
      { measure: 'net_sales' }, { measure: 'net_sales', label: 'Again' }, { measure: 'lines.qty' },
      { agg: 'sum', field: 'covers' }, { agg: 'count' }, { agg: 'count_distinct', field: 'check.id' },
      { agg: 'sum', of: 'gross - discount' }, { agg: 'count', of: 'gross' }, { agg: 'median', field: 'covers' },
      { calc: 'net_sales / count' }, { calc: '   ' }, { key: 'mine', calc: '1 + 1', decimals: 2, hidden: true, format: 'money' },
      { key: 'net_sales', measure: 'checks' }, { key: 'Bad Key!', measure: 'covers' }, { measure: 'no way' }, 'net_sales', null,
    ],
  })
  assert.deepEqual(s.values.map(v => v.key), [
    'net_sales', 'net_sales_2', 'lines.qty', 'sum_covers', 'count', 'count_distinct_check_id', 'sum_1', 'calc_2', 'mine', 'net_sales_3', 'covers',
  ])
  assert.equal(new Set(s.values.map(v => v.key)).size, s.values.length)
  assert.deepEqual(s.values[8], { key: 'mine', calc: '1 + 1', format: 'money', decimals: 2, hidden: true })
  assert.deepEqual(s.values[6], { key: 'sum_1', agg: 'sum', of: 'gross - discount' })
  assert.equal(normaliseReport({ subject: 'x', values: Array.from({ length: 40 }, () => ({ agg: 'count' })) }).values.length, LIMITS.values)
  assert.equal(normaliseReport({ subject: 'x', values: [{ measure: 'm', decimals: 9 }, { measure: 'n', format: 'html' }] }).values.every(v => !('decimals' in v) && !('format' in v)), true)
})

test('filters keep what can be asked and drop the rest', () => {
  const s = normaliseReport({
    subject: 'x',
    params: [{ key: 'period', type: 'period' }, { key: 'who', type: 'value', label: 'Server' }],
    rows: [{ field: 'a' }],
    filters: [
      { field: 'date', op: 'in_period', param: 'period' },
      { field: 'date', op: 'in_period', value: { relative: 'last_month' } },
      { field: 'date', op: 'in_period', value: 'last month' },
      { field: 'server.name', op: 'is', param: 'who' },
      { field: 'server.name', op: 'is', param: 'nobody' },
      { field: 'status', op: 'in', value: ['closed', 'closed', '', null, 'void'] },
      { field: 'status', op: 'in', value: [] },
      { field: 'total', op: 'between', value: [10, 20] },
      { field: 'total', op: 'between', value: [10] },
      { field: 'total', op: 'gt', value: 5 },
      { field: 'total', op: 'gt', value: {} },
      { field: 'tab_name', op: 'empty', value: 'ignored' },
      { field: 'opened_at', bucket: 'hour', op: 'gte', value: 17 },
      { field: 'name', op: 'contains', value: 'x'.repeat(500) },
      { field: 'name', op: 'sounds_like', value: 'x' },
      { field: 'bad field', op: 'is', value: 'x' },
      { any: [{ field: 'a', op: 'is', value: 1 }, { all: [{ field: 'b', op: 'is', value: 2 }, { field: 'c', op: 'nope', value: 3 }] }, { any: [] }] },
      { has: 'lines', where: [{ field: 'item.name', op: 'is', value: 'Pad Thai' }] },
      { has: 'payments', not: true },
      { has: 'not a link' },
      'junk',
    ],
  })
  assert.deepEqual(s.filters, [
    { field: 'date', op: 'in_period', param: 'period' },
    { field: 'date', op: 'in_period', value: { relative: 'last_month' } },
    { field: 'server.name', op: 'is', param: 'who' },
    { field: 'status', op: 'in', value: ['closed', 'void'] },
    { field: 'total', op: 'between', value: [10, 20] },
    { field: 'total', op: 'gt', value: 5 },
    { field: 'tab_name', op: 'empty' },
    { field: 'opened_at', bucket: 'hour', op: 'gte', value: 17 },
    { field: 'name', op: 'contains', value: 'x'.repeat(LIMITS.text) },
    { any: [{ field: 'a', op: 'is', value: 1 }, { all: [{ field: 'b', op: 'is', value: 2 }] }] },
    { has: 'lines', where: [{ field: 'item.name', op: 'is', value: 'Pad Thai' }] },
    { has: 'payments', where: [], not: true },
  ])
  // Nesting stops at three levels.
  const deep = normaliseReport({ subject: 'x', rows: [{ field: 'a' }], filters: [{ any: [{ all: [{ any: [{ all: [{ field: 'a', op: 'is', value: 1 }] }] }] }] }] })
  assert.deepEqual(deep.filters, [])
  assert.equal(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], filters: Array.from({ length: 60 }, () => ({ field: 'a', op: 'is', value: 1 })) }).filters.length, LIMITS.filters)
})

test('parameters, their defaults and what a run uses', () => {
  const s = normaliseReport({
    subject: 'x', rows: [{ field: 'a' }],
    params: [
      { key: 'period', type: 'period', default: { relative: 'nope' } },
      { key: 'venues', type: 'venues', default: [V1, 'not-an-id', V1] },
      { key: 'period', type: 'period' },
      { key: 'who', type: 'value', label: 'Server', default: '' },
      { key: 'kinds', type: 'value', default: ['a', '', null, 'b'] },
      { key: 'Bad Key', type: 'value' }, { key: 'x', type: 'colour' }, null,
    ],
  })
  assert.deepEqual(s.params, [
    { key: 'period', type: 'period', default: { relative: 'last_week' } },
    { key: 'venues', type: 'venues', default: [V1] },
    { key: 'who', type: 'value', label: 'Server', default: null },
    { key: 'kinds', type: 'value', default: ['a', 'b'] },
  ])
  assert.deepEqual(periodParams(s), ['period'])
  assert.deepEqual(resolveParams(s, null), { period: { relative: 'last_week' }, venues: [V1], who: null, kinds: ['a', 'b'] })
  assert.deepEqual(
    resolveParams(s, { period: { from: '2026-11-08', to: '2026-11-02' }, venues: 'all', who: 'Sam', kinds: 'a', extra: 1 }),
    { period: { from: '2026-11-02', to: '2026-11-08' }, venues: 'all', who: 'Sam', kinds: 'a' },
  )
  // What can't be read falls back to the default (a period), or to every venue.
  assert.deepEqual(resolveParams(s, { period: 'yesterday', venues: ['zzz'] }), { period: { relative: 'last_week' }, venues: 'all', who: null, kinds: ['a', 'b'] })
  assert.deepEqual(cleanVenues([V2.toUpperCase(), V1]), [V2, V1])
  assert.equal(cleanVenues('everything'), 'all')
  assert.equal(normaliseReport({ subject: 'x', params: Array.from({ length: 30 }, (_, i) => ({ key: 'p' + i, type: 'value' })) }).params.length, LIMITS.params)
})

test('sorting, top N, totals and the chart', () => {
  const s = normaliseReport({
    ...byDish(),
    sort: [{ by: 'net_sales', dir: 'desc' }, { by: 'name' }, { by: 'net_sales' }, { by: 'unknown' }, { by: 'Section.Name', dir: 'sideways' }],
    limit: { top: 10.4, rest_as: 'Everything else' },
    view: { kind: 'bar', x: 'name', y: ['net_sales', 'nope', 'net_sales'], stacked: true, sideways: 'yes', table_below: false, line: 'qty_sold' },
  })
  assert.deepEqual(s.sort, [{ by: 'net_sales', dir: 'desc' }, { by: 'name', dir: 'asc' }, { by: 'section.name', dir: 'asc' }])
  assert.deepEqual(s.limit, { top: 10, rest_as: 'Everything else' })
  // The rows shown wouldn't add up to a subtotal, so a top N has none.
  assert.deepEqual(s.totals, { grand: true, subtotals: [] })
  assert.deepEqual(s.view, { kind: 'bar', x: 'name', y: ['net_sales'], stacked: true, line: 'qty_sold', table_below: false })
  assert.equal(rankKey(s), 'net_sales')
  assert.equal(rankKey(normaliseReport({ ...byDish(), sort: [{ by: 'name' }] })), 'qty_sold')
  assert.deepEqual(normaliseReport({ ...byDish(), limit: { bottom: 9999 } }).limit, { bottom: LIMITS.top })
  assert.equal(normaliseReport({ ...byDish(), limit: { top: 0 } }).limit, null)
  assert.equal(normaliseReport({ ...byDish(), rows: [], limit: { top: 5 } }).limit, null, 'nothing to rank without rows')
  // The innermost grouping has no subtotal; unknown ones go; no totals unless asked.
  assert.deepEqual(normaliseReport({ ...byDish(), totals: { grand: false, subtotals: ['name', 'section.name', 'venue.name', 'section.name'] } }).totals, { grand: false, subtotals: ['section.name'] })
  assert.deepEqual(normaliseReport({ ...byDish(), totals: undefined }).totals, { grand: true, subtotals: [] })
  // A list sorts by any of its fields.
  assert.deepEqual(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], sort: [{ by: 'opened_at', dir: 'desc' }, { by: 'not a field' }] }).sort, [{ by: 'opened_at', dir: 'desc' }])
})

test('what stops a report from running, in words', () => {
  assert.deepEqual(reportProblems(normaliseReport({})), ['Choose what the report is about', 'Add at least one column to the list'])
  assert.deepEqual(reportProblems(normaliseReport({ subject: 'x', kind: 'summary' })), ['Add a value to add up, or something to group by'])
  assert.deepEqual(reportProblems(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], columns: [{ field: 'b' }], values: [{ measure: 'm', hidden: true }] })), ['A matrix needs a value in its cells', 'A top or bottom N needs a value to rank by'].slice(0, 1))
  const calc = (text, extra = []) => reportProblems(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], values: [{ measure: 'net' }, ...extra, { calc: text, label: 'Share' }] }))
  assert.deepEqual(calc('net / total(net)'), [])
  assert.match(calc('net / covers')[0], /^Share: "covers" isn't one of this report's values/)
  assert.match(calc('net +')[0], /^Share: The calculation stops too soon/)
  assert.match(calc('sqrt(net)')[0], /^Share: sqrt\(\) can't be used/)
  // A calculation reads plain values, not itself or another calculation.
  assert.match(calc('calc_1 + 1')[0], /isn't one of this report's values/)
  assert.match(calc('first * 2', [{ key: 'first', calc: 'net * 2' }])[0], /can't use another calculation \("first"\)/)
  const sum = text => reportProblems(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], values: [{ agg: 'sum', of: text, label: 'Margin' }] }))
  assert.deepEqual(sum('gross - discount'), [])
  assert.match(sum('total(gross)')[0], /^Margin: total\(\) can't be used inside a sum/)
  assert.match(sum('gross -')[0], /^Margin: The calculation stops too soon/)
  assert.deepEqual(reportProblems(normaliseReport({ subject: 'x', rows: [{ field: 'a' }], values: [{ measure: 'm', hidden: true }], limit: { top: 5 } })), ['A top or bottom N needs a value to rank by'])
})

test('a new report asks for a period and venues where the subject has them', () => {
  const s = newReport('till.checks')
  assert.equal(s.subject, 'till.checks')
  assert.deepEqual(s.params.map(p => p.key), ['period', 'venues'])
  assert.deepEqual(s.filters, [{ field: 'date', op: 'in_period', param: 'period' }, { field: 'venue', op: 'in', param: 'venues' }])
  const plain = newReport('menu.dishes', { dated: false, venue: false })
  assert.deepEqual([plain.params, plain.filters], [[], []])
})

// A small catalogue in the shape both sides walk.
const CATALOGUE = {
  subjects: {
    'till.lines': {
      key: 'till.lines', label: 'Dishes sold', name: 'name',
      fields: { name: { key: 'name', label: 'Dish', type: 'text' }, qty: { key: 'qty', label: 'Quantity', type: 'number' }, date: { key: 'date', label: 'Trading day', type: 'date' }, sent_at: { key: 'sent_at', label: 'Sent', type: 'moment' } },
      measures: { net_sales: { key: 'net_sales', label: 'Net sales', type: 'money' } },
      links: { check: { key: 'check', label: 'Check', to: 'till.checks' }, section: { key: 'section', label: 'Section', to: 'menu.sections' } },
    },
    'till.checks': {
      key: 'till.checks', label: 'Checks',
      fields: { number: { key: 'number', label: 'Number', title: 'Check number', type: 'number' }, covers: { key: 'covers', label: 'Guests', type: 'number' } },
      measures: { checks: { key: 'checks', label: 'Checks', type: 'number' } },
      links: { server: { key: 'server', label: 'Server', to: 'staff.people' }, lines: { key: 'lines', label: 'Dishes', to: 'till.lines', many: true } },
    },
    'staff.people': { key: 'staff.people', label: 'People', name: 'name', fields: { name: { key: 'name', label: 'Name', type: 'text' }, server_since: { key: 'server_since', label: 'Server since', type: 'date' } }, measures: {}, links: {} },
    'menu.sections': { key: 'menu.sections', label: 'Sections', name: 'name', fields: { name: { key: 'name', label: 'Name', type: 'text' } }, measures: {}, links: {} },
    'bookings.deposits': { key: 'bookings.deposits', label: 'Deposits', fields: { date: { key: 'date', label: 'Day paid', type: 'date' } }, measures: {}, links: { booking: { key: 'booking', label: 'Booking', to: 'bookings.bookings' } } },
    'bookings.bookings': { key: 'bookings.bookings', label: 'Bookings', fields: { date: { key: 'date', label: 'Day', type: 'date' } }, measures: {}, links: {} },
  },
}

test('a path is walked through the catalogue\'s links', () => {
  const r = resolvePath(CATALOGUE, 'till.lines', 'check.server.name')
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'field')
  assert.equal(r.subject.key, 'staff.people')
  assert.deepEqual(r.hops.map(h => h.key), ['check', 'server'])
  assert.equal(r.many, false)
  assert.equal(resolvePath(CATALOGUE, 'till.lines', 'net_sales').kind, 'measure')
  assert.equal(resolvePath(CATALOGUE, 'till.lines', 'check').kind, 'link')
  const many = resolvePath(CATALOGUE, 'till.checks', 'lines.net_sales')
  assert.equal(many.kind, 'measure')
  assert.equal(many.many, true)
  assert.equal(resolvePath(CATALOGUE, 'till.checks', 'lines').many, true)
  assert.match(resolvePath(CATALOGUE, 'till.lines', 'waiter.name').why, /Dishes sold has no link called "waiter"/)
  assert.match(resolvePath(CATALOGUE, 'till.lines', 'check.tip').why, /Checks has nothing called "tip"/)
  assert.match(resolvePath(CATALOGUE, 'nope', 'name').why, /nothing to report on called "nope"/)
  assert.match(resolvePath(CATALOGUE, 'till.lines', 'a.b.c.d.e.f').why, /too many links/)
  assert.equal(resolvePath(CATALOGUE, 'till.lines', '').ok, false)
})

test('a column is named after what it is', () => {
  const label = (path, bucket) => pathLabel(CATALOGUE, 'till.lines', path, bucket)
  assert.equal(label('name'), 'Dish')
  assert.equal(label('section.name'), 'Section', 'a linked thing\'s own name is just the link')
  assert.equal(label('check.server.name'), 'Server')
  assert.equal(label('check.covers'), 'Check guests')
  assert.equal(label('check.number'), 'Check number')
  assert.equal(label('check.server.server_since'), 'Server since', 'not "Server server since"')
  assert.equal(label('check'), 'Check')
  assert.equal(label('net_sales'), 'Net sales')
  assert.equal(label('date'), 'Trading day')
  assert.equal(label('date', 'week'), 'Week')
  assert.equal(label('date', 'day'), 'Trading day')
  // A day that says which day it is keeps its words when grouped.
  const paid = bucket => pathLabel(CATALOGUE, 'bookings.deposits', 'date', bucket)
  assert.deepEqual([paid(), paid('day'), paid('week'), paid('month'), paid('weekday')], ['Day paid', 'Day paid', 'Week paid', 'Month paid', 'Day of the week paid'])
  // Another subject's day, reached through a link, says whose it is and how it is grouped.
  const theirs = bucket => pathLabel(CATALOGUE, 'bookings.deposits', 'booking.date', bucket)
  assert.deepEqual([theirs(), theirs('week')], ['Booking day', 'Booking day (week)'])
  assert.equal(label('sent_at', 'hour'), 'Sent (hour)')
  assert.equal(label('missing.thing'), 'missing.thing')
  assert.equal(pathLabel(CATALOGUE, 'till.checks', 'number'), 'Check number')
  assert.deepEqual(bucketsFor('date'), ['day', 'week', 'month', 'quarter', 'year', 'weekday'])
  assert.ok(bucketsFor('moment').includes('hour'))
  assert.deepEqual(bucketsFor('text'), [])
  assert.equal(bucketType('date', 'weekday'), 'number')
  assert.equal(bucketType('moment', 'hour'), 'number')
  assert.equal(bucketType('moment', 'week'), 'date')
  assert.equal(bucketType('date', 'hour'), 'date', 'a day has no hour')
  assert.equal(bucketType('text', 'week'), 'text')
})

test('the fields a person can pick stop at "many" links and never loop', () => {
  const paths = fieldChoices(CATALOGUE, 'till.lines').map(c => c.path)
  assert.deepEqual(paths, ['name', 'qty', 'date', 'sent_at', 'check.number', 'check.covers', 'check.server.name', 'check.server.server_since', 'section.name'])
  // From a check, its lines aren't walked (each would repeat the check).
  assert.deepEqual(fieldChoices(CATALOGUE, 'till.checks').map(c => c.path), ['number', 'covers', 'server.name', 'server.server_since'])
  assert.deepEqual(fieldChoices(CATALOGUE, 'till.lines', { depth: 0 }).map(c => c.path), ['name', 'qty', 'date', 'sent_at'])
  assert.equal(fieldChoices(CATALOGUE, 'till.lines').find(c => c.path === 'check.server.name').group, 'Check › Server')
})

test('drilling makes another definition from the report\'s own', () => {
  const spec = normaliseReport({ ...byDish(), drill: { down: [{ field: 'check.server.name' }, { field: 'date', bucket: 'day' }], rows: ['check.number', 'name', 'qty'] } })
  const rows = drillSpec(spec, { at: [{ field: 'section.name', value: 'Mains' }, { field: 'name', value: 'Pad Thai' }], to: 'rows' })
  assert.equal(rows.spec.kind, 'list')
  assert.equal(rows.spec.subject, 'till.lines')
  assert.deepEqual(rows.spec.rows.map(r => r.field), ['check.number', 'name', 'qty'])
  // The report's own filters, then "this row", then "only what its figures count".
  assert.deepEqual(rows.spec.filters.slice(0, 2), spec.filters, 'the report\'s own filters stay')
  assert.deepEqual(rows.spec.filters.slice(2), [
    { field: 'section.name', op: 'is', value: 'Mains' }, { field: 'name', op: 'is', value: 'Pad Thai' },
    { counted: ['qty_sold', 'net_sales'] },
  ])
  assert.deepEqual(rows.spec.params, spec.params)
  // A tap on one figure lists the rows that figure counts.
  const one = drillSpec(spec, { at: [{ field: 'name', value: 'Pad Thai' }], to: 'rows', value: 'qty_sold' })
  assert.deepEqual(one.spec.filters.slice(-1), [{ counted: ['qty_sold'] }])
  // A value the report hasn't got is no value: the row as a whole.
  assert.deepEqual(drillSpec(spec, { at: [], to: 'rows', value: 'nothing' }).spec.filters.slice(-1), [{ counted: ['qty_sold', 'net_sales'] }])

  // An empty group is "is empty"; the same grouping twice counts once.
  const empty = drillSpec(spec, { at: [{ field: 'section.name', value: null }, { field: 'section.name', value: 'x' }], to: 'rows' })
  assert.deepEqual(empty.spec.filters.slice(-2, -1), [{ field: 'section.name', op: 'empty' }])
  assert.equal(empty.spec.filters.length, spec.filters.length + 2)

  // Broken down by a field the report offers.
  const down = drillSpec(spec, { at: [{ field: 'section.name', value: 'Mains' }], to: { field: 'check.server.name' } })
  assert.equal(down.spec.kind, 'summary')
  assert.deepEqual(down.spec.rows, [{ field: 'check.server.name' }])
  assert.deepEqual(down.spec.values, spec.values)
  assert.deepEqual(down.spec.sort, [{ by: 'net_sales', dir: 'desc' }])
  assert.deepEqual(down.spec.drill.down, [{ field: 'date', bucket: 'day' }], 'the next level keeps what is left')
  assert.deepEqual(down.spec.drill.rows, ['check.number', 'name', 'qty'], 'and the report\'s own columns for its rows')
  assert.deepEqual(drillSpec(down.spec, { at: [{ field: 'check.server.name', value: 'Sam' }], to: 'rows' }).spec.rows.map(r => r.field), ['check.number', 'name', 'qty'])
  // And from there by day, holding the server too.
  const day = drillSpec(down.spec, { at: [{ field: 'check.server.name', value: 'Sam' }], to: { field: 'date', bucket: 'day' } })
  assert.deepEqual(day.spec.rows, [{ field: 'date', bucket: 'day' }])
  assert.deepEqual(day.spec.filters.slice(-2), [{ field: 'section.name', op: 'is', value: 'Mains' }, { field: 'check.server.name', op: 'is', value: 'Sam' }])

  // A breakdown is ordered by the report's figures, never by where its rows were:
  // a report in day order, broken down by day, starts from the usual order.
  const inDayOrder = normaliseReport({ subject: 'till.lines', rows: [{ field: 'date' }], values: [{ measure: 'net_sales' }], sort: [{ by: 'date', dir: 'desc' }], drill: { down: [{ field: 'date' }, { field: 'name' }] } })
  assert.deepEqual(inDayOrder.sort, [{ by: 'date', dir: 'desc' }])
  assert.deepEqual(drillSpec(inDayOrder, { at: [], to: { field: 'date' } }).spec.sort, [])

  // A bucket's value is held with its bucket.
  const byWeek = normaliseReport({ subject: 'till.checks', rows: [{ field: 'date', bucket: 'week' }], values: [{ measure: 'checks' }] })
  assert.deepEqual(drillSpec(byWeek, { at: [{ field: 'date', bucket: 'week', value: '2026-11-02' }], to: 'rows' }, { listColumns: ['number', 'total'] }).spec.filters,
    [{ field: 'date', bucket: 'week', op: 'is', value: '2026-11-02' }, { counted: ['checks'] }])

  // What a report doesn't offer is refused, in words.
  assert.match(drillSpec(spec, { at: [{ field: 'check.tab_name', value: 'x' }], to: 'rows' }).problem, /isn't grouped by "check.tab_name"/)
  assert.match(drillSpec(spec, { at: [], to: { field: 'venue.name' } }).problem, /can't be broken down by "venue.name"/)
  assert.match(drillSpec(byWeek, { at: [], to: 'rows' }).problem, /no rows to show/)
  assert.match(drillSpec(rows.spec, { at: [], to: 'rows' }).problem, /already its own rows/)
  assert.match(drillSpec(spec, { at: [], to: 'sideways' }).problem, /isn't something this report can open/)
  assert.equal(cleanDrill(null), null)
  assert.deepEqual(cleanDrill({ at: [{ field: 'a', value: '' }, { field: 'b', value: Infinity }, { field: 'c', value: true }, { value: 1 }], to: 'rows' }),
    { at: [{ field: 'a', value: null }, { field: 'b', value: null }, { field: 'c', value: true }], to: 'rows' })
  // Which figure was tapped is kept for rows only, and only as a value's key.
  assert.deepEqual(cleanDrill({ at: [], to: 'rows', value: 'net_sales' }), { at: [], to: 'rows', value: 'net_sales' })
  assert.deepEqual(cleanDrill({ at: [], to: 'rows', value: 'Net sales; DROP' }), { at: [], to: 'rows' })
  assert.deepEqual(cleanDrill({ at: [], to: { field: 'name' }, value: 'net_sales' }), { at: [], to: { field: 'name' } })
})

test('the rows behind a figure are the ones the figure counts', () => {
  const spec = normaliseReport({
    subject: 'till.lines', rows: [{ field: 'name' }],
    values: [
      { measure: 'qty_sold' }, { measure: 'net_sales', hidden: true }, { measure: 'gross_sales', hidden: true },
      { calc: 'net_sales / qty_sold', label: 'Each' }, { agg: 'sum', field: 'qty', label: 'Every one' },
    ],
  })
  const key = label => spec.values.find(v => v.label === label).key
  // One figure: its own measure; a calculation: the figures it reads, hidden or not.
  assert.deepEqual(countedBy(spec, 'qty_sold'), ['qty_sold'])
  assert.deepEqual(countedBy(spec, key('Each')), ['net_sales', 'qty_sold'])
  // A plain total of a field counts every row: nothing is left out.
  assert.equal(countedBy(spec, key('Every one')), null)
  // The row as a whole: every figure it shows (a hidden one only through what reads it). One that counts everything decides.
  assert.equal(countedBy(spec), null)
  const shown = normaliseReport({ ...spec, values: spec.values.filter(v => v.label !== 'Every one') })
  assert.deepEqual(countedBy(shown), ['qty_sold', 'net_sales'])
  // A calculation that can't be read adds nothing (such a report doesn't run); a report with no figures counts everything.
  assert.deepEqual(countedBy({ values: [{ key: 'a', calc: '((' }, { key: 'b', measure: 'net_sales' }] }), ['net_sales'])
  assert.equal(countedBy({ values: [] }), null)

  // The definition keeps the filter, tidied: paths only, each once.
  const kept = normaliseReport({ subject: 'till.lines', rows: [{ field: 'name' }], filters: [{ counted: ['Net_Sales', 'net_sales', 'no good!', 7] }, { counted: [] }] })
  assert.deepEqual(kept.filters, [{ counted: ['net_sales'] }])
})

test('what a report\'s rows open in the app: themselves, a link or two away, or nothing', () => {
  const open = o => normaliseReport({ subject: 'till.lines', kind: 'list', rows: ['name'], drill: { open: o } }).drill
  assert.deepEqual(open('self'), { down: [], rows: [], open: 'self' })
  assert.deepEqual(open('none'), { down: [], rows: [], open: 'none' })
  assert.deepEqual(open('check'), { down: [], rows: [], open: 'check' })
  assert.deepEqual(open(' Check.Day '), { down: [], rows: [], open: 'check.day' }, 'a path, tidied')
  for (const bad of ['check.day.venue', 'check..day', '', '   ', 3, null, {}, ['check']]) assert.equal(open(bad), null, JSON.stringify(bad))
  assert.equal(normaliseReport({ subject: 'till.lines', kind: 'list', rows: ['name'] }).drill, null, 'said nothing: the rows open what they usually do')

  // A summary keeps it for the rows behind its rows, at every level down.
  const spec = normaliseReport({ ...byDish(), drill: { down: [{ field: 'check.server.name' }], open: 'check' } })
  assert.equal(spec.drill.open, 'check')
  assert.deepEqual(reportProblems(spec), [])
  const listColumns = ['name', 'qty']
  const rows = drillSpec(spec, { at: [{ field: 'name', value: 'Pad Thai' }], to: 'rows' }, { listColumns })
  assert.equal(rows.spec.kind, 'list')
  assert.equal(rows.spec.drill.open, 'check', 'the rows behind a row open what the report says')
  const down = drillSpec(spec, { at: [{ field: 'name', value: 'Pad Thai' }], to: { field: 'check.server.name' } })
  assert.equal(down.spec.drill.open, 'check', 'a level down keeps it')
  const deeper = drillSpec(down.spec, { at: [{ field: 'check.server.name', value: 'Sam' }], to: 'rows' }, { listColumns })
  assert.equal(deeper.spec.drill.open, 'check')
  const none = drillSpec(normaliseReport({ ...byDish(), drill: { open: 'none' } }), { at: [], to: 'rows' }, { listColumns })
  assert.equal(none.spec.drill.open, 'none', 'nothing stays nothing')
  const plain = drillSpec(normaliseReport(byDish()), { at: [], to: 'rows' }, { listColumns })
  assert.equal(plain.spec.drill, null, 'a report that says nothing lists rows that open what they usually do')
})
