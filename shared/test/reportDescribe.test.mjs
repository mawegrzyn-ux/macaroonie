// A report in one sentence (shared/reports/describe.js), as the smart
// builder says it under What this shows: worked out from the definition, so
// the words always match what runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeReport, andList, venuesWords } from '../reports/describe.js'
import { startReport, addFilter, setParamDefault, setLimit, setCompare, setView, setKind, addAlso, addValue, updateAlso } from '../reports/build.js'
import { normaliseReport } from '../reports/spec.js'

const f = (key, label, type, more = {}) => [key, { key, label, type, ...more }]
const fields = list => Object.fromEntries(list)
const CAT = {
  subjects: {
    lines: {
      key: 'lines', label: 'Dishes sold', one: 'dish sold', name: 'name', base: true, dated: true, venue: true,
      fields: fields([f('date', 'Trading day', 'date'), f('name', 'Dish', 'text'), f('qty', 'Quantity', 'number', { adds: true })]),
      measures: fields([
        f('net_sales', 'Net sales', 'money', { agg: 'sum', across: true }),
        f('qty_sold', 'Quantity sold', 'number', { agg: 'sum', across: true }),
      ]),
      links: {}, list: ['date', 'name', 'qty'],
    },
    payments: {
      key: 'payments', label: 'Payments', one: 'payment', base: true, dated: true, venue: true,
      fields: fields([f('date', 'Trading day', 'date'), f('tender', 'Tender', 'choice', { labels: { cash: 'Cash', card: 'Card' } }), f('amount', 'Amount', 'money')]),
      measures: fields([f('taken', 'Taken', 'money', { agg: 'sum', across: true })]),
      links: {}, list: ['date', 'tender', 'amount'],
    },
  },
}
const WARE = '11111111-1111-4111-8111-111111111111'
const HERTFORD = '22222222-2222-4222-8222-222222222222'
const venues = [{ id: WARE, name: 'Ware' }, { id: HERTFORD, name: 'Hertford' }]

// Net sales and quantity sold by dish, the top 20, last month at Ware, as bars.
function dishes() {
  let s = normaliseReport({ ...startReport(CAT, 'lines'), rows: [{ field: 'name' }], values: [{ measure: 'net_sales' }, { measure: 'qty_sold' }] })
  s = setLimit(s, { which: 'top', n: 20, by: 'net_sales', rest: 'Every other dish' })
  s = setParamDefault(s, 'period', { relative: 'last_month' })
  s = setParamDefault(s, 'venues', [WARE])
  return setView(s, { kind: 'bar' })
}

test('a summary: its values, groupings, top few, period, venues and chart', () => {
  assert.equal(describeReport(CAT, dishes(), { venues }),
    'Net sales and quantity sold by dish, the top 20 by net sales with the rest together as "Every other dish", for last month at Ware, drawn as bars.')
  assert.equal(describeReport(CAT, dishes(), { venues, periodText: 'Last month (Oct 2026)' }),
    'Net sales and quantity sold by dish, the top 20 by net sales with the rest together as "Every other dish", for last month (Oct 2026) at Ware, drawn as bars.',
    'the period as the run worked it out')
  const october = setCompare(setParamDefault(dishes(), 'period', { from: '2026-10-01', to: '2026-10-31' }), 'last_year')
  assert.equal(describeReport(CAT, october, { venues }),
    'Net sales and quantity sold by dish, the top 20 by net sales with the rest together as "Every other dish", for Oct 2026 at Ware, compared with the same dates last year, drawn as bars.',
    'a period of dates keeps its capital')
  const plain = normaliseReport({ ...startReport(CAT, 'lines'), rows: [], values: [] })
  assert.equal(describeReport(CAT, plain, { venues }), 'How many dishes sold in total, for last week at every venue.')
})

test('a list: its columns and filters', () => {
  let s = setKind(startReport(CAT, 'payments'), 'list', CAT)
  s = addFilter(s, { field: 'tender', op: 'is', value: 'cash' })
  s = setParamDefault(s, 'period', { relative: 'yesterday' })
  assert.equal(describeReport(CAT, s, { venues }), 'A list of payments, showing trading day, tender and amount, where tender is Cash, for yesterday at every venue.')
})

test('filters asked each time say so', () => {
  const asked = addFilter(dishes(), { field: 'name', op: 'is', value: 'Pad Thai' }, { ask: true, label: 'Dish' })
  assert.match(describeReport(CAT, asked, { venues }), /, where dish is Pad Thai \(chosen each time\), for last month/)
  const open = addFilter(dishes(), { field: 'name', op: 'is', value: null }, { ask: true, label: 'Dish' })
  assert.match(describeReport(CAT, open, { venues }), /, where dish chosen each time, for last month/)
})

test('venues and lists in words', () => {
  assert.equal(venuesWords('all', venues), 'at every venue')
  assert.equal(venuesWords([WARE, HERTFORD], venues), 'at Ware and Hertford')
  assert.equal(venuesWords([WARE, '33333333-3333-4333-8333-333333333333'], venues), 'at 2 venues', 'a venue not known: how many')
  assert.equal(andList(['a']), 'a')
  assert.equal(andList(['a', '', 'b']), 'a and b')
  assert.equal(andList(['a', 'b', 'c']), 'a, b and c')
  assert.equal(andList(['a', 'b', 'c', 'd', 'e', 'f'], 4), 'a, b, c, d and 2 more')
})

test('a report about something unknown says nothing', () => {
  assert.equal(describeReport(CAT, { subject: 'stock' }), '')
  assert.equal(describeReport(null, dishes()), '')
})

test('figures from another subject are named from it, with its own filters said', () => {
  let s = startReport(CAT, 'lines')
  s = addAlso(s, 'payments')
  s = addValue(s, { measure: 'taken', from: 's2' })
  s = updateAlso(s, 's2', { filters: [{ field: 'tender', op: 'is', value: 'card' }] })
  s = setParamDefault(s, 'period', { relative: 'last_month' })
  assert.equal(describeReport(CAT, s), 'Net sales and taken by trading day, payments only where tender is Card, for last month at every venue.')
  // Its own name, when it has one.
  assert.equal(describeReport(CAT, updateAlso(s, 's2', { label: 'Card takings' })), 'Net sales and taken by trading day, card takings only where tender is Card, for last month at every venue.')
})
