// The report engine on real till data (docs/REPORTS.md 7): sorting,
// subtotals, a top N with everything else, matrices, calculations,
// comparisons, date groupings, lists, filters, parameters, drill-downs,
// what a role can't see, and the guards around a run.
//
// The sales are the two trading days of support/tillDays.mjs. Closed checks:
//
//   A  eat in    the server    net 19.80   total 21.78
//   B  take out  the manager   net 20.00   total 20.00
//   C  eat in    the server    net 24.00   total 24.00
//   F  take out  the server    net  0.00   total  0.00   (comped)
//   G  eat in    the server    net 15.00   total 16.50   (day 2)
//
// with D called off (void) and E still open. Dishes sold on them:
//   d1  4 for 46.80    d2  6 for 24.00    d3  1 for 8.00
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { runner, rowsOf, totalsRow, measures, refused, LEVELS } from './support/reports.mjs'
import { runReport, streamList, forgetReportResults, currencyPath } from '../src/reports/run.js'
import { CATALOGUE, listColumns } from '../src/reports/catalogue/index.js'
import { env } from '../src/config/env.js'
import { normaliseReport } from '../../shared/reports/spec.js'
import { drillSpec } from '../../shared/reports/drill.js'
import { addDays, todayIn } from '../../shared/reports/period.js'

let ids, run, runB, t, d1, d2, d3, lead, boss, c, hertford
const cells = res => res.rows.map(r => r.cells)
const kinds = res => res.rows.map(r => r.kind)
const CLOSED = { field: 'status', op: 'is', value: 'closed' }
const lines = () => ({ subject: 'till.lines', rows: ['name'], values: measures(['qty_sold', 'net_sales']) })
// The checks a list of checks holds, as their letters in the scenario.
const letters = res => res.rows.map(r => Object.keys(c).find(k => c[k] === r.id)).join('')
const checksWhere = async filters => [...letters(await run({ subject: 'till.checks', kind: 'list', rows: ['number'], filters }))].sort().join('')

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  t = await sellTwoDays({ owner: as(A.owner, ids.a), tenantId: ids.a, filled })
  ;({ lead, boss } = t)
  d1 = t.d1.name; d2 = t.d2.name; d3 = t.d3.name
  c = t.checks
  run = runner(ids.a)
  runB = runner(ids.b)
  ;[hertford] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND id <> ${t.V} ORDER BY created_at LIMIT 1`
})
after(closeApp)

test('rows come in the order asked for: by a figure, by name, and a list by a field it doesn\'t show', async () => {
  const byNet = await run({ ...lines(), sort: [{ by: 'net_sales', dir: 'desc' }] })
  assert.deepEqual(cells(byNet), [[d1, 4, 46.8], [d2, 6, 24], [d3, 1, 8]])
  assert.deepEqual(byNet.totals.cells, [null, 11, 78.8])
  assert.deepEqual(byNet.columns.map(x => [x.key, x.label, x.type, x.role]), [
    ['name', 'Dish', 'text', 'row'], ['qty_sold', 'Quantity sold', 'number', 'value'], ['net_sales', 'Net sales', 'money', 'value'],
  ])
  assert.equal(byNet.meta.row_count, 3)
  assert.equal(byNet.meta.currency, 'GBP')

  const names = [d1, d2, d3].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(cells(await run(lines())).map(r => r[0]), names, 'no order asked for: by the grouping')
  assert.deepEqual(cells(await run({ ...lines(), sort: [{ by: 'name', dir: 'desc' }] })).map(r => r[0]), [...names].reverse())

  // Guests, most first (none last), then the check's number.
  const list = await run({ subject: 'till.checks', kind: 'list', rows: ['number', 'order_type.name'], sort: [{ by: 'covers', dir: 'desc' }, { by: 'number', dir: 'asc' }] })
  assert.equal(letters(list), 'cgaebfd')
  assert.deepEqual(list.columns.map(x => x.key), ['number', 'order_type.name'])
})

test('subtotals keep each group together, and groups follow the order of their own subtotal', async () => {
  const spec = {
    subject: 'till.checks', rows: ['order_type.name', 'server.name'], values: measures(['checks', 'net_sales']),
    filters: [CLOSED], totals: { subtotals: ['order_type.name'] },
  }
  const res = await run(spec)
  assert.deepEqual(cells(res), [
    ['Eat in', lead, 3, 58.8],
    ['Eat in', null, 3, 58.8],
    ['Take out', lead, 1, 0],
    ['Take out', boss, 1, 20],
    ['Take out', null, 2, 20],
  ])
  assert.deepEqual(kinds(res), ['row', 'subtotal', 'row', 'row', 'subtotal'])
  assert.deepEqual(res.rows.map(r => r.level), [2, 1, 2, 2, 1])
  assert.deepEqual(res.rows[1].k, ['Eat in'])
  assert.deepEqual(res.totals.cells, [null, null, 5, 78.8])

  const asc = await run({ ...spec, sort: [{ by: 'net_sales', dir: 'asc' }] })
  assert.deepEqual(cells(asc), [
    ['Take out', lead, 1, 0],
    ['Take out', boss, 1, 20],
    ['Take out', null, 2, 20],
    ['Eat in', lead, 3, 58.8],
    ['Eat in', null, 3, 58.8],
  ])
})

test('a top or bottom N, with everything else on one row when asked for', async () => {
  const top = await run({ ...lines(), sort: [{ by: 'net_sales', dir: 'desc' }], limit: { top: 1, rest_as: 'Other dishes' } })
  assert.deepEqual(cells(top), [[d1, 4, 46.8], ['Other dishes', 7, 32]])
  assert.deepEqual(kinds(top), ['row', 'rest'])
  assert.deepEqual(top.totals.cells, [null, 11, 78.8], 'the total is still of every dish')
  assert.deepEqual(top.meta.notes, ['The top 1 of 3 are shown'])
  assert.equal(top.meta.row_count, 3)

  const bottom = await run({ ...lines(), sort: [{ by: 'qty_sold', dir: 'asc' }], limit: { bottom: 2, rest_as: 'The rest' } })
  assert.deepEqual(cells(bottom), [[d3, 1, 8], [d1, 4, 46.8], ['The rest', 6, 24]])
  assert.deepEqual(bottom.meta.notes, ['The bottom 2 of 3 are shown'])

  // No name for the rest: no such row. Ranked by the first figure.
  const plain = await run({ ...lines(), limit: { bottom: 1 } })
  assert.deepEqual(cells(plain), [[d3, 1, 8]])

  // Two groupings: the N is of the rows, the rest adds up what is left.
  const two = await run({
    subject: 'till.checks', rows: ['order_type.name', 'tab_name'], values: measures(['checks', 'net_sales']),
    sort: [{ by: 'net_sales', dir: 'desc' }], limit: { top: 2, rest_as: 'Others' },
  })
  assert.deepEqual(cells(two), [['Eat in', null, 3, 58.8], ['Take out', 'Zrp Sam', 1, 20], ['Others', null, 1, 0]])

  // N or fewer rows: all of them, nothing said.
  const all = await run({ ...lines(), limit: { top: 3, rest_as: 'Other dishes' } })
  assert.equal(all.rows.length, 3)
  assert.deepEqual(all.meta.notes, [])
})

test('a matrix: a cell for each row and column, with row totals, column totals and the grand total', async () => {
  const res = await run({ subject: 'till.lines', rows: ['name'], columns: ['check.order_type.name'], values: measures(['qty_sold']) })
  assert.equal(res.kind, 'matrix')
  assert.deepEqual(res.columns.map(x => [x.key, x.group ?? null, x.label, x.role]), [
    ['name', null, 'Dish', 'row'],
    ['qty_sold|0', 'Eat in', 'Quantity sold', 'value'],
    ['qty_sold|1', 'Take out', 'Quantity sold', 'value'],
    ['qty_sold|total', 'Total', 'Quantity sold', 'total'],
  ])
  const byDish = Object.fromEntries(cells(res).map(r => [r[0], r.slice(1)]))
  assert.deepEqual(byDish, { [d1]: [3, 1, 4], [d2]: [5, 1, 6], [d3]: [null, 1, 1] }, 'a dish never sold that way has an empty cell')
  assert.deepEqual(res.totals.cells, [null, 8, 3, 11])
  assert.deepEqual(res.columns.map(x => x.adds ?? null), [null, true, true, true], 'a quantity adds up, under each heading and in the row total')
  // What the columns across the top are, in words (each column carries only its own value): a chart's label says it.
  assert.deepEqual(res.meta.across, ['Order type'])
  assert.equal((await run({ subject: 'till.lines', rows: ['name'], values: measures(['qty_sold']) })).meta.across, null, 'a summary has nothing across the top')
  // Two fields across the top, in their order; a time says how it is grouped.
  const byHour = await run({ subject: 'till.lines', rows: ['name'], columns: [{ field: 'check.opened_at', bucket: 'hour' }, 'check.order_type.name'], values: measures(['qty_sold']) })
  assert.deepEqual(byHour.meta.across, ['Check opened (hour)', 'Order type'])

  const two = await run({
    subject: 'till.lines', rows: ['name'], columns: ['check.order_type.name'], values: measures(['qty_sold', 'net_sales']),
    limit: { top: 1, rest_as: 'The rest' },
  })
  assert.deepEqual(two.columns.map(x => x.key), ['name', 'qty_sold|0', 'net_sales|0', 'qty_sold|1', 'net_sales|1', 'qty_sold|total', 'net_sales|total'])
  assert.deepEqual(cells(two), [[d2, 5, 24, 1, 0, 6, 24], ['The rest', 3, 34.8, 2, 20, 5, 54.8]])
  assert.deepEqual(two.totals.cells, [null, 8, 58.8, 3, 20, 11, 78.8])
})

test('calculations: a share of the total, a running total, a rank, an if; hidden values still feed them', async () => {
  const res = await run({
    ...lines(),
    values: [
      { measure: 'net_sales' },
      { key: 'share', calc: 'net_sales / total(net_sales)', format: 'percent', label: 'Share' },
      { key: 'so_far', calc: 'running(net_sales)', format: 'money', label: 'So far' },
      { key: 'place', calc: 'rank(net_sales)', label: 'Place' },
      { key: 'big', calc: 'if(net_sales > 20, 1, 0)', label: 'Over 20' },
    ],
    sort: [{ by: 'net_sales', dir: 'desc' }],
  })
  assert.deepEqual(cells(res), [
    [d1, 46.8, 0.593909, 46.8, 1, 1],
    [d2, 24, 0.304569, 70.8, 2, 1],
    [d3, 8, 0.101523, 78.8, 3, 0],
  ])
  assert.deepEqual(res.totals.cells, [null, 78.8, 1, null, null, 1], 'a running total and a rank mean nothing on the total row')
  assert.deepEqual(res.columns.slice(1).map(x => [x.label, x.type]), [['Net sales', 'money'], ['Share', 'percent'], ['So far', 'money'], ['Place', 'number'], ['Over 20', 'number']])
  // Only a plain total or count says its rows add up to its total: a chart may stack those, or cut them into parts of a whole.
  assert.deepEqual(res.columns.map(x => x.adds ?? null), [null, true, null, null, null, null], 'a calculation never adds up, whatever it is made of')

  const hidden = await run({
    ...lines(),
    values: [{ measure: 'qty_sold', hidden: true }, { measure: 'net_sales' }, { key: 'each', calc: 'net_sales / qty_sold', format: 'money', label: 'Each' }],
    sort: [{ by: 'each', dir: 'desc' }],
  })
  assert.deepEqual(hidden.columns.map(x => x.key), ['name', 'net_sales', 'each'])
  assert.deepEqual(cells(hidden), [[d1, 46.8, 11.7], [d3, 8, 8], [d2, 24, 4]])
  assert.deepEqual(hidden.totals.cells, [null, 78.8, 7.163636], 'the total row works the calculation out again from the totals')

  // No groupings: the figures on one row, no totals row.
  const one = await run({ subject: 'till.checks', values: [{ measure: 'net_sales' }, { measure: 'checks' }, { key: 'avg', calc: 'round(net_sales / checks, 2)', format: 'money', label: 'Average' }] })
  assert.deepEqual(cells(one), [[78.8, 5, 15.76]])
  assert.equal(one.totals, null)
  assert.equal(one.meta.row_count, 1)
})

test('ways of adding a field up: average, how many, how many different, largest, a sum worked out row by row', async () => {
  const res = await run({
    subject: 'till.checks', filters: [CLOSED],
    values: [
      { agg: 'avg', field: 'covers' },
      { agg: 'count_distinct', field: 'server' },
      { agg: 'count_distinct', field: 'server.name' },
      { agg: 'max', field: 'total' },
      { agg: 'min', field: 'total' },
      { agg: 'count' },
      { agg: 'count', field: 'tab_name' },
      { key: 'charges', agg: 'sum', of: 'total - net', label: 'Charges again' },
    ],
  })
  assert.deepEqual(cells(res), [[2.2, 2, 2, 24, 0, 5, 2, 3.48]])
  assert.deepEqual(res.columns.map(x => [x.key, x.label, x.type]), [
    ['avg_covers', 'Average guests', 'number'],
    ['count_distinct_server', 'Server (how many different)', 'number'],
    ['count_distinct_server_name', 'Server (how many different)', 'number'],
    ['max_total', 'Largest total', 'money'],
    ['min_total', 'Smallest total', 'money'],
    ['count', 'Checks', 'number'],
    ['count_tab_name', 'Name on the order (how many)', 'number'],
    ['charges', 'Charges again', 'money'],
  ])
  assert.deepEqual(res.columns.map(x => [x.key, !!x.adds]), [
    ['avg_covers', false], ['count_distinct_server', false], ['count_distinct_server_name', false], ['max_total', false], ['min_total', false],
    ['count', true], ['count_tab_name', true], ['charges', true],
  ], 'an average, a "how many different", a largest and a smallest don\'t add up; a count and a sum do')

  // A rate (one figure over another) doesn't either, beside the two figures it is made of. Nor does a figure
  // counted through a check's own rows stop adding up: it is added up for each check first, then across them.
  const rate = await run({ subject: 'till.checks', rows: ['order_type.name'], filters: [CLOSED], values: [{ measure: 'total_sales' }, { measure: 'checks' }, { measure: 'average_check' }, { agg: 'count', field: 'lines.name' }] })
  assert.deepEqual(rate.columns.map(x => [x.key, !!x.adds]), [['order_type.name', false], ['total_sales', true], ['checks', true], ['average_check', false], ['count_lines_name', true]])
})

test('figures of the rows a check has (its dishes, its payments) are added up for each check first, never doubled', async () => {
  const res = await run({
    subject: 'till.checks', rows: ['number'], filters: [CLOSED],
    values: [{ measure: 'lines.qty_sold' }, { measure: 'payments.taken' }, { measure: 'payments.payments' }, { measure: 'total_sales' }, { agg: 'sum', field: 'lines.qty' }],
  })
  const numbers = await run({ subject: 'till.checks', kind: 'list', rows: ['number'] })
  const numberOf = Object.fromEntries(numbers.rows.map(r => [r.id, r.cells[0]]))
  const byCheck = Object.fromEntries(cells(res).map(r => [r[0], r.slice(1)]))
  assert.deepEqual(byCheck, {
    [numberOf[c.a]]: [3, 21.78, 1, 21.78, 3],
    [numberOf[c.b]]: [2, 20, 1, 20, 2],
    // Two dishes sold and one voided (three lines), paid in two parts.
    [numberOf[c.c]]: [2, 24, 2, 24, 3],
    [numberOf[c.f]]: [1, 0, 0, 0, 1],
    [numberOf[c.g]]: [3, 16.5, 1, 16.5, 3],
  })
  assert.deepEqual(res.totals.cells, [null, 11, 82.28, 5, 82.28, 12])
  assert.deepEqual(res.columns.slice(1).map(x => x.label), ['Quantity sold (dishes sold)', 'Taken (payments)', 'Payments (payments)', 'Total', 'Total dishes sold quantity'])

  // The other way (a dish's check): how many different, the smallest and the largest only.
  const up = await run({
    subject: 'till.lines', rows: ['name'],
    values: [{ agg: 'count_distinct', field: 'check' }, { agg: 'max', field: 'check.total' }, { measure: 'checks' }],
  })
  assert.deepEqual(Object.fromEntries(cells(up).map(r => [r[0], r.slice(1)])), { [d1]: [4, 24, 3], [d2]: [5, 24, 3], [d3]: [1, 20, 1] })
  assert.deepEqual(up.totals.cells, [null, 7, 24, 5], 'how many different is counted again at the total, not added up')

  for (const [value, says] of [
    [{ measure: 'check.total_sales' }, 'Total (check) can\'t be added up from Dishes sold: each check would be counted once for every dish sold. Start the report from Checks'],
    [{ agg: 'sum', field: 'check.total' }, 'Total check total can\'t be worked out from Dishes sold: each check would be counted once for every dish sold. Start the report from Checks'],
  ]) {
    assert.deepEqual(await refused(run({ subject: 'till.lines', rows: ['name'], values: [value] })), { status: 422, problems: [says] })
  }
  assert.deepEqual(await refused(run({ subject: 'till.checks', rows: ['mode'], values: [{ agg: 'avg', field: 'lines.qty' }] })),
    { status: 422, problems: ['Average dishes sold quantity can\'t be worked out from Checks. Start the report from Dishes sold'] })
})

test('days are grouped by day, week, month, quarter, year, weekday; moments by their day or hour at the venue', async () => {
  const day = t.date
  const weekday = ((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1
  const month = Number(day.slice(5, 7))
  const first = n => day.slice(0, 5) + String(n).padStart(2, '0') + '-01'
  const by = async ref => {
    const res = await run({ subject: 'till.checks', rows: [ref], values: measures(['checks']) })
    return { col: res.columns[0], rows: cells(res) }
  }
  assert.deepEqual((await by('date')).rows, [[day, 5]])
  assert.deepEqual((await by('date:week')).rows, [[addDays(day, 1 - weekday), 5]])
  assert.deepEqual((await by('date:month')).rows, [[first(month), 5]])
  assert.deepEqual((await by('date:quarter')).rows, [[first(month - ((month - 1) % 3)), 5]])
  assert.deepEqual((await by('date:year')).rows, [[first(1), 5]])
  assert.deepEqual((await by('date:weekday')).rows, [[weekday, 5]])

  const week = await by('date:week')
  assert.deepEqual([week.col.key, week.col.label, week.col.type, week.col.bucket], ['date:week', 'Week', 'date', 'week'])
  const wd = await by('date:weekday')
  assert.deepEqual([wd.col.label, wd.col.bucket], ['Day of the week', 'weekday'])

  // A moment with no grouping named is grouped by its day; by the hour it is a number.
  const opened = await by('opened_at')
  assert.equal(opened.col.label, 'Opened')
  assert.equal(opened.rows.reduce((n, r) => n + r[1], 0), 5)
  assert.ok(opened.rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r[0])), JSON.stringify(opened.rows))
  assert.ok(opened.rows.some(r => r[0] === todayIn('Europe/London')), 'the day at the venue')
  const hours = await by('opened_at:hour')
  assert.equal(hours.col.label, 'Opened (hour)')
  assert.equal(hours.rows.reduce((n, r) => n + r[1], 0), 5)
  assert.ok(hours.rows.every(r => Number.isInteger(r[0]) && r[0] >= 0 && r[0] <= 23), JSON.stringify(hours.rows))
})

test('a list: the first rows only when there are more, with how many there are and the sums of every row', async () => {
  const spec = {
    subject: 'till.checks', kind: 'list',
    rows: ['number', 'server.name', 'covers', 'total', 'status', 'opened_at', 'date', 'time_open'],
    sort: [{ by: 'total', dir: 'desc' }],
  }
  const res = await run(spec, {}, { cap: 3 })
  assert.equal(res.kind, 'list')
  assert.equal(letters(res), 'cab')
  assert.deepEqual(cells(res).map(r => r.slice(1, 5)), [[lead, 4, 24, 'closed'], [lead, 2, 21.78, 'closed'], [boss, 1, 20, 'closed']])
  assert.equal(res.meta.row_count, 7)
  assert.equal(res.meta.truncated, true)
  assert.equal(res.totals.count, 7)
  assert.deepEqual(res.totals.cells, [null, null, 13, 95.48, null, null, null, null], 'guests and totals of all seven checks; a time open isn\'t added up')
  assert.deepEqual(res.columns.map(x => x.type), ['text', 'text', 'number', 'money', 'choice', 'moment', 'date', 'duration'])
  assert.equal(res.columns[4].labels.closed, 'Closed')
  assert.match(res.rows[0].cells[5], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, 'a moment at the venue\'s own time')
  assert.equal(res.rows[0].cells[6], t.date)

  const all = await run(spec)
  assert.equal(all.rows.length, 7)
  assert.equal(all.meta.truncated, false)
  assert.equal(letters(all).slice(0, 5), 'cabge')

  // Payments and refunds side by side: their amounts aren't added together.
  const paid = await run({ subject: 'till.payments', kind: 'list', rows: ['kind', 'tender', 'amount'] })
  assert.equal(paid.rows.length, 6, 'five payments and a refund')
  assert.deepEqual(paid.totals, { count: 6, cells: [null, null, null] })
})

test('filters: words, numbers, days, choices, links, empty values, any of, and rows that have (or lack) a row of another kind', async () => {
  const weekday = ((new Date(t.date + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1
  for (const [what, filters, expected] of [
    ['contains, whatever the case', [{ field: 'tab_name', op: 'contains', value: 'sam' }], 'b'],
    ['doesn\'t contain (rows with nothing there too)', [{ field: 'tab_name', op: 'not_contains', value: 'Sam' }], 'acdefg'],
    ['starts with', [{ field: 'tab_name', op: 'starts_with', value: 'Zrp B' }], 'f'],
    ['between', [{ field: 'total', op: 'between', value: [20, 22] }], 'ab'],
    ['at least', [{ field: 'covers', op: 'gte', value: 3 }], 'cg'],
    ['a number is', [{ field: 'covers', op: 'is', value: 2 }], 'ae'],
    ['a number is one of', [{ field: 'covers', op: 'in', value: [1, 4] }], 'bcf'],
    ['a choice is one of', [{ field: 'mode', op: 'in', value: ['tab', 'counter'] }], 'bdf'],
    ['a choice is not', [{ field: 'mode', op: 'is_not', value: 'table' }], 'bdf'],
    ['empty', [{ field: 'tab_name', op: 'empty' }], 'acdeg'],
    ['not empty', [{ field: 'tab_name', op: 'not_empty' }], 'bf'],
    ['a link is', [{ field: 'server', op: 'is', value: t.bossId }], 'be'],
    ['a link is one of', [{ field: 'server', op: 'in', value: [t.bossId, t.leadId] }], 'abcdefg'],
    ['a field of a linked row', [{ field: 'day.closed', op: 'is', value: false }], 'eg'],
    ['a day is', [{ field: 'date', op: 'is', value: t.date }], 'abcdefg'],
    ['before a day', [{ field: 'date', op: 'before', value: t.date }], ''],
    ['in a period', [{ field: 'date', op: 'in_period', value: { from: addDays(t.date, -1), to: t.date } }], 'abcdefg'],
    ['in a named period', [{ field: 'date', op: 'in_period', value: { relative: 'last_year' } }], ''],
    ['the weekday of a day', [{ field: 'date:weekday', op: 'is', value: weekday }], 'abcdefg'],
    ['the weekday of a day (another)', [{ field: 'date:weekday', op: 'is', value: (weekday % 7) + 1 }], ''],
    ['a moment after a day', [{ field: 'opened_at', op: 'after', value: addDays(t.date, -2) }], 'abcdefg'],
    ['has a dish', [{ has: 'lines', where: [{ field: 'name', op: 'is', value: d3 }] }], 'b'],
    ['has no such dish', [{ has: 'lines', where: [{ field: 'name', op: 'is', value: d3 }], not: true }], 'acdefg'],
    ['has a payment in cash', [{ has: 'payments', where: [{ field: 'tender', op: 'is', value: 'cash' }, { field: 'kind', op: 'is', value: 'payment' }] }], 'bcg'],
    ['any of', [{ any: [{ field: 'mode', op: 'is', value: 'counter' }, { field: 'covers', op: 'gte', value: 4 }] }], 'cd'],
    ['every filter holds', [{ field: 'mode', op: 'is', value: 'table' }, CLOSED, { any: [{ field: 'covers', op: 'lte', value: 2 }, { field: 'total', op: 'gt', value: 23 }] }], 'ac'],
  ]) {
    assert.equal(await checksWhere(filters), expected, what)
  }

  for (const [filters, says] of [
    [[{ field: 'covers', op: 'contains', value: '2' }], 'Guests can\'t be filtered with "contains"'],
    [[{ field: 'server', op: 'is', value: 'nope' }], 'Server: that isn\'t one of the choices'],
    [[{ field: 'nope', op: 'is', value: 1 }], 'Checks has nothing called "nope"'],
  ]) {
    assert.deepEqual(await refused(run({ subject: 'till.checks', kind: 'list', rows: ['number'], filters })), { status: 422, problems: [says] })
  }
})

test('what a definition can\'t do is said in a sentence, before anything runs', async () => {
  for (const [spec, says] of [
    [{ values: [{ agg: 'count' }] }, 'Choose what the report is about'],
    [{ subject: 'till.nothing', values: [{ agg: 'count' }] }, 'There is nothing to report on called "till.nothing"'],
    [{ subject: 'till.checks', rows: ['nope'], values: measures(['checks']) }, 'Checks has nothing called "nope"'],
    [{ subject: 'till.checks', rows: ['server'], values: measures(['checks']) }, 'Server can\'t be grouped by: group by one of its fields (its name)'],
    [{ subject: 'till.checks', rows: ['lines.name'], values: measures(['checks']) },
      'Dishes sold can\'t be used there: one check can have several. Add them up as a value, or start the report from Dishes sold'],
    [{ subject: 'till.checks', kind: 'list', rows: ['number', 'net_sales'] }, 'Net sales is a figure: a list shows fields. Make it a summary to add things up'],
    [{ subject: 'till.checks', kind: 'list', rows: [] }, 'Add at least one column to the list'],
    [{ subject: 'till.checks', rows: ['mode'], values: measures(['checks']), compare: { with: 'previous_period' } },
      'Comparing needs a period: add "Trading day is in ..." to the report\'s filters'],
    [{ subject: 'till.lines', rows: ['name'], values: [{ measure: 'qty_sold' }, { key: 'x', calc: 'qty_sold / nothing', label: 'Each' }] }, 'Each: "nothing" isn\'t one of this report\'s values'],
    [{ subject: 'till.checks', rows: ['mode'], values: [{ key: 'x', agg: 'sum', of: 'total - tab_name', label: 'Odd' }] }, 'Odd: "tab_name" isn\'t one of Checks\' own number fields'],
    [{ subject: 'till.checks', rows: ['mode'], values: [{ agg: 'sum', field: 'tab_name' }] }, 'Name on the order isn\'t a number: it can be counted, not added up'],
  ]) {
    assert.deepEqual(await refused(run(spec)), { status: 422, problems: [says] }, JSON.stringify(spec))
  }
  const bad = await refused(run({ subject: 'till.lines', rows: ['name'], values: [{ measure: 'qty_sold' }, { key: 'x', calc: 'qty_sold +', label: 'Half' }] }))
  assert.equal(bad.status, 422)
  assert.match(bad.problems[0], /^Half: /)
})

test('what a role can\'t see: no report on a subject, columns left out with a note, no grouping, filter or order by it', async () => {
  const without = key => ({ levels: { ...LEVELS, [key]: 'none' } })

  assert.deepEqual(await refused(run({ subject: 'till.checks', values: measures(['checks']) }, {}, without('pos_reports'))),
    { status: 403, problems: ['Your role can\'t report on Checks'] })
  assert.deepEqual(await refused(run({ subject: 'till.checks', values: measures(['checks']) }, {}, { levels: {} })),
    { status: 403, problems: ['Your role can\'t report on Checks'] })

  // Looking a name up through a link needs nothing more: a dish's section on a check line.
  const names = await run({ subject: 'till.lines', rows: ['section.name'], values: measures(['qty_sold']) }, {}, without('menus'))
  assert.equal(names.rows.reduce((n, r) => n + r.cells[1], 0), 11)
  // Counting another subject's rows needs that subject.
  assert.deepEqual(await refused(run({ subject: 'menu.sections', rows: ['name'], values: [{ agg: 'count' }] }, {}, without('menus'))),
    { status: 403, problems: ['Your role can\'t report on Menu sections'] })

  // A link that needs its own permission: a booking's customer record.
  const noCustomers = without('customers')
  const list = await run({ subject: 'bookings.bookings', kind: 'list', rows: ['date', 'guest_name', 'customer.name', 'customer.email'] }, {}, noCustomers)
  assert.deepEqual(list.columns.map(x => x.key), ['date', 'guest_name'])
  assert.equal(list.columns[1].pii, true, 'personal data is marked')
  assert.deepEqual(list.meta.notes, ['Customer is left out: your role can\'t see it', 'Customer email is left out: your role can\'t see it'])
  assert.ok(list.rows.length > 0)

  const summary = await run({ subject: 'bookings.bookings', rows: ['status'], values: [{ measure: 'bookings' }, { agg: 'count_distinct', field: 'customer', label: 'Guests seen' }] }, {}, noCustomers)
  assert.deepEqual(summary.columns.map(x => x.key), ['status', 'bookings'])
  assert.deepEqual(summary.meta.notes, ['Guests seen is left out: your role can\'t see it'])

  for (const [spec, says] of [
    [{ subject: 'bookings.bookings', rows: ['customer.name'], values: measures(['bookings']) }, 'This report groups by Customer, which your role can\'t see'],
    [{ subject: 'bookings.bookings', kind: 'list', rows: ['date'], filters: [{ field: 'customer.name', op: 'contains', value: 'a' }] }, 'This report filters by Customer, which your role can\'t see'],
    [{ subject: 'bookings.bookings', kind: 'list', rows: ['date'], sort: [{ by: 'customer.name', dir: 'asc' }] }, 'This report is sorted by Customer, which your role can\'t see'],
    [{ subject: 'bookings.bookings', kind: 'list', rows: ['customer.name'] }, 'None of this list\'s columns can be shown to your role'],
    [{ subject: 'bookings.bookings', values: [{ agg: 'count_distinct', field: 'customer' }] }, 'None of this report\'s figures can be shown to your role'],
  ]) {
    assert.deepEqual(await refused(run(spec, {}, noCustomers)), { status: 403, problems: [says] }, JSON.stringify(spec))
  }
  // With the permission, the same reports run.
  const full = await run({ subject: 'bookings.bookings', kind: 'list', rows: ['date', 'customer.name'] })
  assert.deepEqual(full.columns.map(x => [x.key, x.label, !!x.pii]), [['date', 'Day', false], ['customer.name', 'Customer', true]])
})

test('a run takes the report\'s choices: venues and a period, or their defaults', async () => {
  const spec = {
    subject: 'till.checks',
    params: [{ key: 'venues', type: 'venues' }, { key: 'period', type: 'period', default: { relative: 'this_week' } }],
    rows: ['venue.name'], values: measures(['checks']),
    filters: [{ field: 'venue', op: 'in', param: 'venues' }, { field: 'date', op: 'in_period', param: 'period' }],
  }
  const weekday = ((new Date(t.date + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1
  const monday = addDays(t.date, 1 - weekday)

  const usual = await run(spec)
  assert.equal(usual.rows.length, 1, 'every venue: the one with sales')
  assert.deepEqual(usual.rows[0].cells[1], 5)
  assert.equal(usual.meta.period.from, monday)
  assert.equal(usual.meta.period.to, addDays(monday, 6))
  assert.match(usual.meta.period.text, /^This week \(/)

  assert.deepEqual(cells(await run(spec, { venues: [t.V] })).map(r => r[1]), [5])
  const other = await run(spec, { venues: [hertford.id] })
  assert.deepEqual(cells(other), [])
  assert.deepEqual(other.totals.cells, [null, 0])
  // Ids that aren't ids are dropped (every venue again); another group's venue finds nothing.
  assert.deepEqual(cells(await run(spec, { venues: ['nope'] })).map(r => r[1]), [5])
  const [theirs] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.b} LIMIT 1`
  assert.deepEqual(cells(await run(spec, { venues: [theirs.id] })), [])

  const lastWeek = await run(spec, { period: { relative: 'last_week' } })
  assert.deepEqual(cells(lastWeek), [])
  assert.equal(lastWeek.meta.period.to, addDays(monday, -1))
  const range = await run(spec, { period: { from: t.date, to: t.date } })
  assert.deepEqual(cells(range).map(r => r[1]), [5])
  // A period that isn't one: the report's own.
  assert.equal((await run(spec, { period: { from: 'yesterday' } })).meta.period.from, monday)

  const least = { subject: 'till.checks', kind: 'list', params: [{ key: 'least', type: 'value', default: 20 }], rows: ['number', 'total'], filters: [{ field: 'total', op: 'gte', param: 'least' }] }
  assert.equal([...letters(await run(least))].sort().join(''), 'abc')
  assert.equal([...letters(await run(least, { least: 21 }))].sort().join(''), 'ac')
})

test('till sales sit on their trading day: after midnight they are still on the day before', async () => {
  // As the till has them between midnight and the venue's "Trading day starts
  // at": the trading day is yesterday's date, the calendar day is today's.
  const yesterday = addDays(t.date, -1)
  await sql`UPDATE pos_days SET business_date = ${yesterday}::date WHERE venue_id = ${t.V}`
  try {
    const spec = named => ({
      subject: 'till.checks',
      params: [{ key: 'period', type: 'period', default: { relative: named } }],
      rows: ['date'], values: measures(['checks', 'net_sales']),
      filters: [{ field: 'date', op: 'in_period', param: 'period' }],
    })
    // "Today" is the calendar day at the venue: nothing is on it yet.
    const today = await run(spec('today'))
    assert.deepEqual([today.meta.today, today.meta.period.from, today.meta.period.to], [t.date, t.date, t.date])
    assert.deepEqual(cells(today), [])
    assert.deepEqual(today.totals.cells, [null, 0, 0])
    // Tonight's sales are under yesterday, with the rest of that trading day.
    const before = await run(spec('yesterday'))
    assert.deepEqual(cells(before), [[yesterday, 5, 78.8]])
  } finally {
    await sql`UPDATE pos_days SET business_date = ${t.date}::date WHERE venue_id = ${t.V}`
  }
})

test('a drill-down: the rows behind a figure, or the same figures by another grouping', async () => {
  const base = normaliseReport({
    subject: 'till.checks', rows: ['order_type.name'], values: measures(['checks', 'net_sales']),
    filters: [CLOSED], drill: { down: ['server.name', 'date'] },
  })
  const at = [{ field: 'order_type.name', value: 'Take out' }]

  const rows = drillSpec(base, { at, to: 'rows' }, { listColumns: listColumns('till.checks', LEVELS) })
  assert.equal(rows.problem, undefined)
  const list = await run(rows.spec)
  assert.equal(list.kind, 'list')
  assert.equal([...letters(list)].sort().join(''), 'bf', 'the two closed take-out checks')
  assert.deepEqual(list.columns.map(x => x.key), listColumns('till.checks', LEVELS))

  const down = drillSpec(base, { at, to: { field: 'server.name' } })
  assert.equal(down.problem, undefined)
  const res = await run(down.spec)
  assert.deepEqual(cells(res), [[lead, 1, 0], [boss, 1, 20]])
  assert.deepEqual(res.totals.cells, [null, 2, 20])

  // Only the groupings the report allows.
  assert.ok(drillSpec(base, { at, to: { field: 'tab_name' } }).problem)
  // A row with nothing in its grouping is drilled into as "is empty".
  const byTab = normaliseReport({ subject: 'till.checks', rows: ['tab_name'], values: measures(['checks']), filters: [CLOSED] })
  const none = drillSpec(byTab, { at: [{ field: 'tab_name', value: null }], to: 'rows' }, { listColumns: ['number'] })
  assert.equal([...letters(await run(none.spec))].sort().join(''), 'acg')
})

test('a result says what its rows can be opened into, for the person asking', async () => {
  const spec = {
    subject: 'till.checks', rows: ['order_type.name'], values: measures(['checks', 'net_sales']), filters: [CLOSED],
    drill: { down: ['server.name', { field: 'date', bucket: 'week' }, 'order_type.name', 'tab_name', { field: 'opened_at', bucket: 'hour' }] },
  }
  // The levels the report names, as they would head a column, less the one it is grouped by already.
  assert.deepEqual((await run(spec)).meta.drill, {
    down: [
      { field: 'server.name', label: 'Server' }, { field: 'date', bucket: 'week', label: 'Week' },
      { field: 'tab_name', label: 'Name on the order' }, { field: 'opened_at', bucket: 'hour', label: 'Opened (hour)' },
    ],
    rows: true, of: 'Checks',
  })
  // Across the top counts as grouped by too.
  assert.deepEqual((await run({ ...spec, columns: ['server.name'] })).meta.drill.down.map(d => d.field), ['date', 'tab_name', 'opened_at'])
  // A report that names nothing still lists its rows; a list is its own rows.
  assert.deepEqual((await run({ subject: 'till.checks', rows: ['date'], values: measures(['checks']) })).meta.drill, { down: [], rows: true, of: 'Checks' })
  assert.equal((await run({ subject: 'till.checks', kind: 'list', rows: ['number'] })).meta.drill, null)

  // Only what this person may see: a level through a link their role can't follow isn't offered...
  const online = { subject: 'online.orders', rows: ['date'], values: measures(['orders']), drill: { down: ['customer.name', 'fulfilment'] } }
  const noCustomers = { levels: { web_orders: 'view' } }
  assert.deepEqual((await run(online)).meta.drill.down.map(d => [d.field, d.label]), [['customer.name', 'Customer'], ['fulfilment', 'Type']])
  assert.deepEqual((await run(online, undefined, noCustomers)).meta.drill, { down: [{ field: 'fulfilment', label: 'Type' }], rows: true, of: 'Online orders' })
  // ...and rows whose columns are all hidden from them aren't either. With nothing left, there is nothing to tap.
  const named = { ...online, drill: { down: ['fulfilment'], rows: ['customer.name'] } }
  assert.deepEqual((await run(named)).meta.drill, { down: [{ field: 'fulfilment', label: 'Type' }], rows: true, of: 'Online orders' })
  assert.deepEqual((await run(named, undefined, noCustomers)).meta.drill, { down: [{ field: 'fulfilment', label: 'Type' }], rows: false, of: 'Online orders' })
  assert.equal((await run({ ...online, drill: { rows: ['customer.name'] } }, undefined, noCustomers)).meta.drill, null)

  // Which figure was tapped only matters where the figures count different rows.
  const perFigure = async values => (await run({ subject: 'till.checks', rows: ['date'], values })).meta.drill.per_figure === true
  assert.equal(await perFigure(measures(['checks', 'open_checks'])), true, 'closed checks beside open ones')
  assert.equal(await perFigure(measures(['checks', 'net_sales', 'average_check'])), false, 'all on closed checks, a ratio of two of them included')
  assert.equal(await perFigure([{ measure: 'checks' }, { agg: 'count' }]), true, 'a count of every row beside a figure with a rule')
  assert.equal(await perFigure([{ agg: 'count' }]), false)
  assert.equal(await perFigure([{ measure: 'checks' }, { measure: 'open_checks', hidden: true }]), false, 'a figure that isn\'t shown can\'t be tapped')
  assert.equal(await perFigure([{ measure: 'checks' }, { measure: 'open_checks', hidden: true }, { key: 'both', calc: 'checks + open_checks', label: 'Both' }]), true, 'a calculation counts what its parts count')
  assert.equal(await perFigure(measures(['checks', 'lines.qty_sold'])), true, 'a figure added up through a list of other rows leaves none of ours out')
})

test('the rows behind a figure are the ones that figure counts, so the list adds up to it', async () => {
  const at = [{ field: 'date', value: t.date }]
  const behind = async (spec, drill, listColumns = ['number']) => {
    const d = drillSpec(normaliseReport(spec), drill, { listColumns })
    assert.equal(d.problem, undefined)
    const res = await run(d.spec)
    return { res, letters: [...letters(res)].sort().join(''), counted: d.spec.filters.filter(f => f.counted), notes: res.meta.notes }
  }
  // Closed checks beside the ones still open: a tap on the row lists both kinds, never the one called off (D).
  const two = { subject: 'till.checks', rows: ['date'], values: measures(['checks', 'open_checks']) }
  const any = await behind(two, { at, to: 'rows' })
  assert.equal(any.letters, 'abcefg')
  assert.deepEqual(any.counted, [{ counted: ['checks', 'open_checks'] }])
  assert.deepEqual(any.notes, ['Only the checks that count towards Checks and Checks still open are listed'])
  assert.equal(any.res.totals.count, 6)
  // A tap on a figure lists that figure's: as many rows as the figure says.
  const closed = await behind(two, { at, to: 'rows', value: 'checks' })
  assert.equal(closed.letters, 'abcfg')
  assert.equal(closed.res.totals.count, 5)
  assert.deepEqual(closed.notes, ['Only the checks that count towards Checks are listed'])
  const open = await behind(two, { at, to: 'rows', value: 'open_checks' })
  assert.equal(open.letters, 'e')
  assert.deepEqual(open.notes, ['Only the checks that count towards Checks still open are listed'])
  assert.equal((await behind(two, { at, to: 'rows', value: 'nothing' })).letters, 'abcefg', 'a figure the report doesn\'t have: the row')

  // A count of every row counts every row: nothing is left out, and nothing is said.
  const beside = { subject: 'till.checks', rows: ['date'], values: [{ measure: 'checks' }, { agg: 'count' }] }
  const all = await behind(beside, { at, to: 'rows' })
  assert.equal(all.letters, 'abcdefg')
  assert.deepEqual([all.counted, all.notes], [[], []])
  assert.equal((await behind(beside, { at, to: 'rows', value: 'checks' })).letters, 'abcfg')
  assert.equal((await behind(beside, { at, to: 'rows', value: normaliseReport(beside).values[1].key })).letters, 'abcdefg')

  // A figure that isn't shown counts only through the calculation that reads it.
  const calc = { subject: 'till.checks', rows: ['date'], values: [{ measure: 'checks' }, { measure: 'open_checks', hidden: true }, { key: 'both', calc: 'checks + open_checks', label: 'Both' }] }
  assert.equal((await behind(calc, { at, to: 'rows', value: 'checks' })).letters, 'abcfg')
  assert.equal((await behind(calc, { at, to: 'rows', value: 'both' })).letters, 'abcefg')
  assert.equal((await behind(calc, { at, to: 'rows' })).letters, 'abcefg')
  // A ratio counts what both of its parts count.
  const ratio = await behind({ subject: 'till.checks', rows: ['date'], values: measures(['average_check']) }, { at, to: 'rows' })
  assert.equal(ratio.letters, 'abcfg')
  assert.deepEqual(ratio.notes, ['Only the checks that count towards Average check are listed'])
  // A figure added up through a list of other rows is about those rows: every check is listed.
  const through = { subject: 'till.checks', rows: ['date'], values: measures(['checks', 'lines.qty_sold']) }
  assert.equal((await behind(through, { at, to: 'rows' })).letters, 'abcdefg')
  assert.equal((await behind(through, { at, to: 'rows', value: 'checks' })).letters, 'abcfg')
  assert.equal((await behind(through, { at, to: 'rows', value: 'lines.qty_sold' })).letters, 'abcdefg')

  // Dishes: the lines behind a dish add up to its figures; the one on the open check and the voided ones aren't among them.
  const dishes = { subject: 'till.lines', rows: ['name'], values: measures(['qty_sold', 'net_sales']) }
  for (const [name, qty, net, every] of [[d1, 4, 46.8, 4], [d2, 6, 24, 5]]) {
    const d = drillSpec(normaliseReport(dishes), { at: [{ field: 'name', value: name }], to: 'rows' }, { listColumns: ['check.number', 'qty', 'net'] })
    const list = await run(d.spec)
    assert.deepEqual(list.totals, { count: 3, cells: [null, qty, net] }, name)
    assert.deepEqual(list.meta.notes, ['Only the dishes sold that count towards Quantity sold and Net sales are listed'])
    const unfiltered = await run(normaliseReport({ ...d.spec, filters: d.spec.filters.filter(f => !f.counted) }))
    assert.equal(unfiltered.rows.length, every, name + ': without the rule there are more')
  }

  // Payments, refunds and takings by tender: cash took three payments and gave one refund.
  const tenders = { subject: 'till.payments', rows: ['tender'], values: measures(['payments', 'refunds', 'takings']) }
  assert.deepEqual(cells(await run(tenders)).find(r => r[0] === 'cash'), ['cash', 3, 1, 44.5])
  const cash = [{ field: 'tender', value: 'cash' }]
  const kindsOf = async value => cells((await behind(tenders, { at: cash, to: 'rows', ...(value ? { value } : {}) }, ['kind', 'amount'])).res).map(r => r[0]).sort()
  assert.deepEqual(await kindsOf('payments'), ['payment', 'payment', 'payment'])
  assert.deepEqual(await kindsOf('refunds'), ['refund'])
  assert.deepEqual(await kindsOf('takings'), ['payment', 'payment', 'payment', 'refund'], 'takings has no rule of its own')
  assert.deepEqual(await kindsOf(null), ['payment', 'payment', 'payment', 'refund'])

  // The page says which rows are listed: up to three figures by name, more as "the figures".
  const said = async list => (await behind({ subject: 'till.checks', rows: ['date'], values: measures(list) }, { at, to: 'rows' })).notes
  assert.deepEqual(await said(['checks', 'guests', 'net_sales']), ['Only the checks that count towards Checks, Guests and Net sales are listed'])
  assert.deepEqual(await said(['checks', 'guests', 'net_sales', 'discounts']), ['Only the checks that count towards the figures are listed'])

  // A figure the person's role can't see takes no part in which rows they are shown. No figure of the
  // catalogue is kept from a role today, so one is for the length of this check.
  const refunds = CATALOGUE.subjects['till.payments'].measures.refunds
  refunds.needs = 'cash_recon'
  try {
    const both = { subject: 'till.payments', rows: ['tender'], values: measures(['payments', 'refunds']) }
    const seen = await run(both)
    assert.deepEqual(seen.columns.map(x => x.key), ['tender', 'payments'])
    assert.deepEqual(seen.meta.notes, ['Refunds is left out: your role can\'t see it'])
    const theirs = await behind(both, { at: cash, to: 'rows' }, ['kind', 'amount'])
    assert.deepEqual(cells(theirs.res).map(r => r[0]), ['payment', 'payment', 'payment'])
    assert.deepEqual(theirs.notes, ['Only the till payments that count towards Payments are listed'])
    // With the area, both figures count again.
    const list = drillSpec(normaliseReport(both), { at: cash, to: 'rows' }, { listColumns: ['kind', 'amount'] }).spec
    const withIt = await run(list, undefined, { levels: { ...LEVELS, cash_recon: 'view' } })
    assert.deepEqual(cells(withIt).map(r => r[0]).sort(), ['payment', 'payment', 'payment', 'refund'])
    assert.deepEqual(withIt.meta.notes, ['Only the till payments that count towards Payments and Refunds are listed'])
  } finally {
    delete refunds.needs
  }

  // The filter in a definition of its own: any kind of report, only figures of the subject.
  assert.equal([...letters(await run({ subject: 'till.checks', kind: 'list', rows: ['number'], filters: [{ counted: ['open_checks'] }] }))].join(''), 'e')
  assert.deepEqual(cells(await run({ subject: 'till.checks', values: [{ agg: 'count' }], filters: [{ counted: ['checks'] }] })), [[5]])
  assert.deepEqual(await refused(run({ subject: 'till.checks', kind: 'list', rows: ['number'], filters: [{ counted: ['status'] }] })),
    { status: 422, problems: ['"status" isn\'t one of Checks\' figures'] })
})

test('a result is kept for a minute for the same person, definition and choices; fresh asks again', async () => {
  const ctx = { tenantId: ids.a, userKey: 'u-cache', levels: LEVELS }
  forgetReportResults()
  const first = await runReport(ctx, lines())
  const again = await runReport(ctx, lines())
  assert.equal(first.meta.cached_at, null)
  assert.ok(again.meta.cached_at, 'the second ask is the kept result')
  assert.deepEqual(again.rows, first.rows)
  assert.equal((await runReport({ ...ctx, userKey: 'someone-else' }, lines())).meta.cached_at, null, 'another person asks the database')
  assert.equal((await runReport({ ...ctx, levels: { ...LEVELS, menus: 'none' } }, lines())).meta.cached_at, null, 'and so does another set of permissions')
  assert.equal((await runReport(ctx, { ...lines(), sort: [{ by: 'net_sales', dir: 'desc' }] })).meta.cached_at, null, 'and another definition')
  assert.equal((await runReport(ctx, lines(), {}, { fresh: true })).meta.cached_at, null)
  forgetReportResults()
  assert.equal((await runReport(ctx, lines())).meta.cached_at, null)
})

test('another group sees none of it, and can\'t reach it by naming this group\'s ids', async () => {
  const theirs = await runB({ subject: 'till.checks', rows: ['mode'], values: measures(['checks', 'net_sales']) })
  assert.deepEqual(cells(theirs), [])
  assert.deepEqual(theirs.totals.cells, [null, 0, 0])
  assert.equal((await runB({ subject: 'till.lines', kind: 'list', rows: ['name', 'qty'] })).meta.row_count, 0)
  assert.equal((await runB({ subject: 'till.checks', kind: 'list', rows: ['number'], filters: [{ field: 'server', op: 'is', value: t.bossId }] })).meta.row_count, 0)
  assert.equal((await runB({ subject: 'till.checks', kind: 'list', rows: ['number'], filters: [{ field: 'venue', op: 'is', value: t.V }] })).meta.row_count, 0)
  // Their own fixtures are theirs alone.
  const ours = await run({ subject: 'venue', kind: 'list', rows: ['name'] })
  const others = await runB({ subject: 'venue', kind: 'list', rows: ['name'] })
  assert.ok(ours.rows.length > 0 && others.rows.length > 0)
  assert.ok(ours.rows.every(r => r.cells[0].startsWith('Zqx')), JSON.stringify(cells(ours)))
  assert.ok(others.rows.every(r => r.cells[0].startsWith('Yyc')), JSON.stringify(cells(others)))
})

test('the guards: the planner\'s estimate before a statement runs, and two reports at a time for a group', async () => {
  const was = env.REPORT_MAX_COST
  try {
    env.REPORT_MAX_COST = 0.001
    const heavy = { status: 422, problems: ['This report would read too much at once. Narrow the period or add a filter'] }
    assert.deepEqual(await refused(run(lines())), heavy)
    assert.deepEqual(await refused(run({ subject: 'till.checks', kind: 'list', rows: ['number'] })), heavy)
    assert.deepEqual(await refused(run(lines(), {}, { mode: 'export' })), heavy)
    assert.deepEqual(await refused(streamList({ tenantId: ids.a, userKey: 'u', levels: LEVELS }, { subject: 'till.checks', kind: 'list', rows: ['number'] }, {}, {})), heavy)
  } finally { env.REPORT_MAX_COST = was }

  // Both of the group's places held by other runs: this one waits, then says so.
  let release
  const held = new Promise(resolve => { release = resolve })
  const holders = [1, 2].map(slot => sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${'rpt:' + ids.a}), ${slot}::int)`
    await held
  }))
  try {
    await new Promise(resolve => setTimeout(resolve, 300))
    const started = Date.now()
    assert.deepEqual(await refused(run(lines())), { status: 429, problems: ['Two reports are already running for your group. Try again in a moment'] })
    assert.ok(Date.now() - started >= 4500, 'it waited for a place first')
    // Another group isn't held up.
    assert.equal((await runB(lines())).rows.length, 0)
  } finally {
    release()
    await Promise.all(holders)
  }
  assert.equal((await run(lines())).rows.length, 3)
})

test('a list goes out row by row for a file, with its columns first', async () => {
  const got = { start: null, rows: [] }
  const spec = { subject: 'till.lines', kind: 'list', rows: ['name', 'qty', 'net', 'check.number', 'status'], sort: [{ by: 'net', dir: 'desc' }, { by: 'name', dir: 'asc' }] }
  const out = await streamList({ tenantId: ids.a, userKey: 'u', levels: LEVELS }, spec, {}, {
    start: x => { got.start = x },
    rows: batch => { got.rows.push(...batch) },
  })
  assert.deepEqual(out, { rows: 10, truncated: false })
  assert.deepEqual(got.start.columns.map(x => [x.key, x.type]), [['name', 'text'], ['qty', 'number'], ['net', 'money'], ['check.number', 'text'], ['status', 'choice']])
  assert.equal(got.start.meta.currency, 'GBP')
  assert.equal(got.rows.length, 10)
  assert.deepEqual(got.rows[0].slice(0, 3), [d1, 2, 24])
  assert.ok(got.rows.every(r => typeof r[1] === 'number' && typeof r[2] === 'number'))
  const screen = await run(spec)
  assert.deepEqual(got.rows, cells(screen), 'the same rows in the same order as on screen')

  assert.deepEqual(await refused(streamList({ tenantId: ids.a, userKey: 'u', levels: LEVELS }, lines(), {}, {})),
    { status: 422, problems: ['Only a list can be sent row by row'] })
  assert.deepEqual(await refused(streamList({ tenantId: ids.a, userKey: 'u', levels: { ...LEVELS, pos_reports: 'none' } }, spec, {}, {})),
    { status: 403, problems: ['Your role can\'t report on Dishes sold'] })
})

test('venues in two currencies: money is shown for each currency on its own, never added together', async () => {
  await sql`UPDATE venues SET currency = 'EUR' WHERE id = ${hertford.id}`
  try {
    const note = 'Your venues use more than one currency, so money is shown for each currency on its own'
    const res = await run({
      subject: 'till.checks', rows: ['order_type.name', 'server.name'], values: measures(['checks', 'net_sales']),
      filters: [CLOSED], totals: { subtotals: ['order_type.name'] },
    })
    assert.deepEqual(res.columns.slice(0, 3).map(x => [x.key, x.label]), [['venue.currency', 'Currency'], ['order_type.name', 'Order type'], ['server.name', 'Server']])
    assert.deepEqual(cells(res), [
      ['GBP', 'Eat in', lead, 3, 58.8],
      ['GBP', 'Eat in', null, 3, 58.8],
      ['GBP', 'Take out', lead, 1, 0],
      ['GBP', 'Take out', boss, 1, 20],
      ['GBP', 'Take out', null, 2, 20],
      ['GBP', null, null, 5, 78.8],
    ])
    assert.equal(res.totals, null, 'no grand total')
    assert.deepEqual(res.meta.notes, [note])
    assert.equal(res.meta.currency, null)
    assert.equal(res.meta.currency_column, 'venue.currency')

    // Nothing in money: as it was.
    const counts = await run({ subject: 'till.checks', rows: ['order_type.name'], values: measures(['checks']), filters: [CLOSED] })
    assert.deepEqual(cells(counts), [['Eat in', 3], ['Take out', 2]])
    assert.deepEqual(counts.totals.cells, [null, 5])
    assert.equal(counts.meta.currency_column, null)

    const list = await run({ subject: 'till.checks', kind: 'list', rows: ['number', 'total'] })
    assert.deepEqual(list.columns.map(x => x.key), ['number', 'total', 'venue.currency'])
    assert.ok(list.rows.every(r => r.cells[2] === 'GBP'))
    assert.deepEqual(list.totals.cells, [null, null, null], 'no sum of a money column')
    assert.equal(list.totals.count, 7)

    const one = await run({ subject: 'till.checks', values: measures(['net_sales', 'checks']) })
    assert.deepEqual(cells(one), [['GBP', 78.8, 5]])

    const top = await run({ ...lines(), sort: [{ by: 'net_sales', dir: 'desc' }], limit: { top: 1, rest_as: 'Other dishes' } })
    assert.deepEqual(cells(top), [['GBP', d1, 4, 46.8]], 'no "everything else" across currencies')

    // Only venues of one currency chosen: as usual.
    const chosen = await run({
      subject: 'till.checks', params: [{ key: 'venues', type: 'venues' }], rows: ['order_type.name'], values: measures(['net_sales']),
      filters: [{ field: 'venue', op: 'in', param: 'venues' }, CLOSED],
    }, { venues: [t.V] })
    assert.deepEqual(chosen.totals.cells, [null, 78.8])
    assert.equal(chosen.meta.currency, 'GBP')

    // A row of a result the engine grouped by currency says so when it is opened: the routes let the
    // currency through beside the report's own groupings (it isn't one of them).
    assert.deepEqual([currencyPath('till.checks'), currencyPath('venue'), currencyPath('till.takers'), currencyPath('nothing')], ['venue.currency', 'currency', 'venue.currency', null])
    // Rows that belong to no one venue (a dish on the menu, a customer) say no currency: they run as they are.
    assert.deepEqual([currencyPath('menu.dishes'), currencyPath('guests.customers')], [null, null])
    const dishes = await run({ subject: 'menu.dishes', kind: 'list', rows: ['name', 'price'] })
    assert.deepEqual(dishes.columns.map(x => x.key), ['name', 'price'])
    assert.ok(dishes.rows.length > 0)
    assert.equal(dishes.meta.currency_column, null)
    const byType = normaliseReport({ subject: 'till.checks', rows: ['order_type.name'], values: measures(['checks', 'net_sales']), filters: [CLOSED], drill: { down: ['server.name'] } })
    const summary = await run(byType)
    assert.deepEqual(summary.rows.map(r => r.k), [['GBP', 'Eat in'], ['GBP', 'Take out'], ['GBP']])
    assert.deepEqual(summary.meta.drill, { down: [{ field: 'server.name', label: 'Server' }], rows: true, of: 'Checks' })
    const step = { at: [{ field: 'venue.currency', value: 'GBP' }, { field: 'order_type.name', value: 'Take out' }], to: 'rows' }
    assert.match(drillSpec(byType, step, { listColumns: ['number'] }).problem, /isn't grouped by "venue\.currency"/)
    const also = { listColumns: ['number'], also: [currencyPath('till.checks')] }
    assert.equal([...letters(await run(drillSpec(byType, step, also).spec))].sort().join(''), 'bf')
    const down = drillSpec(byType, { ...step, to: { field: 'server.name' } }, also)
    assert.deepEqual(down.spec.filters.slice(-2), [{ field: 'venue.currency', op: 'is', value: 'GBP' }, { field: 'order_type.name', op: 'is', value: 'Take out' }])
    assert.deepEqual(cells(await run(down.spec)), [['GBP', lead, 1, 0], ['GBP', boss, 1, 20], ['GBP', null, 2, 20]])
    assert.equal((await run(drillSpec(byType, { at: [{ field: 'venue.currency', value: 'EUR' }], to: 'rows' }, also).spec)).rows.length, 0, 'nothing was sold in euros')
  } finally {
    await sql`UPDATE venues SET currency = 'GBP' WHERE id = ${hertford.id}`
  }
})

test('one period beside the one before it: each figure now, before and the change', async () => {
  // Day 1 becomes yesterday, so "today" has day 2's sales and the day before has day 1's.
  const yesterday = addDays(t.date, -1)
  await sql`UPDATE pos_days SET business_date = ${yesterday}::date WHERE id = ${t.day1}`
  try {
    const spec = {
      subject: 'till.checks',
      params: [{ key: 'period', type: 'period', default: { from: t.date, to: t.date } }],
      rows: ['order_type.name'], values: measures(['net_sales', 'checks']),
      filters: [{ field: 'date', op: 'in_period', param: 'period' }],
      compare: { with: 'previous_period' },
    }
    const res = await run(spec)
    assert.deepEqual(res.columns.map(x => [x.key, x.group ?? null, x.label, x.role]), [
      ['order_type.name', null, 'Order type', 'row'],
      ['net_sales', null, 'Net sales', 'value'],
      ['net_sales__prev', 'Net sales', 'Before', 'compare'],
      ['net_sales__chg', 'Net sales', 'Change', 'change'],
      ['checks', null, 'Checks', 'value'],
      ['checks__prev', 'Checks', 'Before', 'compare'],
      ['checks__chg', 'Checks', 'Change', 'change'],
    ])
    assert.deepEqual(res.columns.map(x => !!x.adds), [false, true, true, false, true, true, false], 'a figure and the same figure before both add up; the change between them doesn\'t')
    assert.deepEqual(cells(res), [
      ['Eat in', 15, 43.8, -0.657534, 1, 2, -0.5],
      // Nothing today: the row is there for what was sold before.
      ['Take out', 0, 20, -1, 0, 2, -1],
    ])
    assert.deepEqual(res.totals.cells, [null, 15, 63.8, -0.76489, 1, 4, -0.75])
    assert.deepEqual(res.meta.compare, { with: 'previous_period', from: yesterday, to: yesterday, text: res.meta.compare.text })
    assert.deepEqual([res.meta.period.from, res.meta.period.to], [t.date, t.date])

    // By day: the day before lands on the report's own day.
    const byDay = await run({ ...spec, rows: ['date'] })
    assert.deepEqual(cells(byDay), [[t.date, 15, 63.8, -0.76489, 1, 4, -0.75]])

    // Nothing to compare with: no change to give.
    const first = await run(spec, { period: { from: yesterday, to: yesterday } })
    assert.deepEqual(cells(first), [['Eat in', 43.8, 0, null, 2, 0, null], ['Take out', 20, 0, null, 2, 0, null]])
    const lastYear = await run({ ...spec, compare: { with: 'last_year' } })
    assert.equal(lastYear.meta.compare.from, String(Number(t.date.slice(0, 4)) - 1) + t.date.slice(4))
    assert.deepEqual(cells(lastYear), [['Eat in', 15, 0, null, 1, 0, null]])

    // A calculation can read the period before itself; it gets no columns of its own for it.
    const calc = await run({
      ...spec,
      values: [{ measure: 'net_sales' }, { key: 'up', calc: 'change(net_sales)', format: 'percent', label: 'Up or down' }, { key: 'was', calc: 'previous(net_sales)', format: 'money', label: 'Was' },
        { measure: 'checks', hidden: true }, { key: 'each', calc: 'net_sales / checks', format: 'money', label: 'A check' }],
    })
    assert.deepEqual(calc.columns.map(x => x.key), ['order_type.name', 'net_sales', 'net_sales__prev', 'net_sales__chg', 'up', 'was', 'each', 'each__prev', 'each__chg'])
    assert.deepEqual(cells(calc), [
      ['Eat in', 15, 43.8, -0.657534, -0.657534, 43.8, 15, 21.9, -0.315068],
      ['Take out', 0, 20, -1, -1, 20, null, 10, null],
    ])

    // A top N: the rest row is compared too.
    const top = await run({ ...spec, rows: ['server.name'], values: measures(['net_sales']), sort: [{ by: 'net_sales', dir: 'desc' }], limit: { top: 1, rest_as: 'Everyone else' } })
    assert.deepEqual(cells(top), [[lead, 15, 43.8, -0.657534], ['Everyone else', 0, 20, -1]])

    // Opened up: broken down further the comparison stays; the rows behind a row are this period's only.
    const base = normaliseReport({ ...spec, drill: { down: ['server.name'] } })
    const eatIn = [{ field: 'order_type.name', value: 'Eat in' }]
    const byServer = await run(drillSpec(base, { at: eatIn, to: { field: 'server.name' } }).spec)
    // The manager's one eat-in check is still open: a row, with nothing counted.
    assert.deepEqual(cells(byServer), [[lead, 15, 43.8, -0.657534, 1, 2, -0.5], [boss, 0, 0, null, 0, 0, null]])
    assert.deepEqual([byServer.meta.compare.from, byServer.meta.compare.to], [yesterday, yesterday])
    const todays = await run(drillSpec(base, { at: eatIn, to: 'rows' }, { listColumns: ['number'] }).spec)
    assert.equal(letters(todays), 'g')
    assert.equal(todays.meta.compare ?? null, null)
    // Take out sold nothing today: its row is there for the day before, and has no rows of this period behind it.
    const none = await run(drillSpec(base, { at: [{ field: 'order_type.name', value: 'Take out' }], to: 'rows' }, { listColumns: ['number'] }).spec)
    assert.equal(none.rows.length, 0)
  } finally {
    await sql`UPDATE pos_days SET business_date = ${t.date}::date WHERE id = ${t.day1}`
  }
})
