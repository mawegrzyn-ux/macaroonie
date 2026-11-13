// The smart builder's question answers as changes (shared/reports/choices.js):
// a venue or a name swapped for the ones picked, on the report as it is, so
// answers to two questions add up whichever comes first.
//
// That the server's choices are these changes, and that a changed report
// runs, is checked in api/test/reports-smart.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyChange } from '../reports/choices.js'
import { startReport, addFilter, setParamDefault } from '../reports/build.js'
import { normaliseReport, LIMITS } from '../reports/spec.js'

const f = (key, label, type, more = {}) => [key, { key, label, type, ...more }]
const fields = list => Object.fromEntries(list)
const CAT = {
  subjects: {
    lines: {
      key: 'lines', label: 'Dishes sold', one: 'dish sold', name: 'name', base: true, dated: true, venue: true,
      fields: fields([f('date', 'Trading day', 'date'), f('name', 'Dish', 'text'), f('qty', 'Quantity', 'number', { adds: true })]),
      measures: fields([f('net_sales', 'Net sales', 'money', { agg: 'sum', across: true })]),
      links: {}, list: ['date', 'name', 'qty'],
    },
  },
}

const WARE = '11111111-1111-4111-8111-111111111111'
const HERTFORD = '22222222-2222-4222-8222-222222222222'
const HITCHIN = '33333333-3333-4333-8333-333333333333'

const venuesOf = s => s.params.find(p => p.type === 'venues').default
// Dishes sold at Ware, one dish named loosely: filters 0 and 1 are the period and venues.
const base = () => addFilter(setParamDefault(startReport(CAT, 'lines'), 'venues', [WARE]), { field: 'name', op: 'is', value: 'zqx' })

test('a venue swapped for the ones picked, in its place', () => {
  const s = setParamDefault(base(), 'venues', [WARE, HITCHIN])
  assert.deepEqual(venuesOf(applyChange(s, { venues: { from: WARE, to: [HERTFORD] } })), [HERTFORD, HITCHIN])
  assert.deepEqual(venuesOf(applyChange(s, { venues: { from: WARE, to: [HERTFORD, WARE] } })), [HERTFORD, WARE, HITCHIN], 'All of them')
  assert.deepEqual(venuesOf(applyChange(s, { venues: { from: WARE, to: [HITCHIN] } })), [HITCHIN], 'each venue once')
})

test('a name in a filter swapped for the ones picked', () => {
  const s = base()
  assert.deepEqual(applyChange(s, { filter: { index: 2, from: 'zqx', to: ['Zqx Pad Thai'] } }).filters[2],
    { field: 'name', op: 'is', value: 'Zqx Pad Thai' })
  assert.deepEqual(applyChange(s, { filter: { index: 2, from: 'zqx', to: ['Zqx Pad Thai', 'Zqx Green Curry'] } }).filters[2],
    { field: 'name', op: 'in', value: ['Zqx Pad Thai', 'Zqx Green Curry'] }, 'two or more: is one of')
  const leftOut = addFilter(s, { field: 'name', op: 'is_not', value: 'zqx' })
  assert.deepEqual(applyChange(leftOut, { filter: { index: 3, from: 'zqx', to: ['a', 'b'] } }).filters[3],
    { field: 'name', op: 'not_in', value: ['a', 'b'] }, 'one leaving names out leaves them all out')
  const among = addFilter(startReport(CAT, 'lines'), { field: 'name', op: 'in', value: ['zqx', 'Water'] })
  assert.deepEqual(applyChange(among, { filter: { index: 2, from: 'zqx', to: ['Zqx Pad Thai'] } }).filters[2],
    { field: 'name', op: 'in', value: ['Zqx Pad Thai', 'Water'] }, 'the other names stay where they are')
  const many = Array.from({ length: LIMITS.in_values + 5 }, (_, i) => 'Dish ' + i)
  assert.equal(applyChange(s, { filter: { index: 2, from: 'zqx', to: many } }).filters[2].value.length, LIMITS.in_values)
})

test('a filter that asks each time: its starting value changes, the question stays', () => {
  const s = addFilter(setParamDefault(startReport(CAT, 'lines'), 'venues', [WARE]), { field: 'name', op: 'is', value: 'zqx' }, { ask: true, label: 'Dish' })
  const out = applyChange(s, { filter: { index: 2, from: 'zqx', to: ['Zqx Pad Thai'] } })
  assert.deepEqual(out.filters[2], { field: 'name', op: 'is', param: 'name' })
  assert.deepEqual(out.params.find(p => p.key === 'name'), { key: 'name', type: 'value', label: 'Dish', default: 'Zqx Pad Thai' })
})

test('answers to two questions add up, whichever comes first', () => {
  const venue = { venues: { from: WARE, to: [HERTFORD] } }
  const dish = { filter: { index: 2, from: 'zqx', to: ['Zqx Pad Thai'] } }
  const a = applyChange(applyChange(base(), venue), dish)
  const b = applyChange(applyChange(base(), dish), venue)
  assert.deepEqual(a, b)
  assert.deepEqual(venuesOf(a), [HERTFORD])
  assert.deepEqual(a.filters[2], { field: 'name', op: 'is', value: 'Zqx Pad Thai' })
  assert.deepEqual(a, normaliseReport(a), 'a whole checked definition')
})

test('a change that doesn\'t fit leaves the report as it is', () => {
  const s = base()
  for (const change of [
    null, {}, 'venues', { venues: { from: HITCHIN, to: [HERTFORD] } }, { venues: { from: WARE, to: [] } },
    { venues: { from: WARE, to: ['', 7] } },
    { filter: { index: 9, from: 'zqx', to: ['a'] } }, { filter: { index: 2, from: 'nope', to: ['a'] } },
    { filter: { index: '2', from: 'zqx', to: ['a'] } }, { filter: { index: 2, from: 'zqx', to: [] } },
    { filter: { index: 0, from: 'zqx', to: ['a'] } },
  ]) assert.equal(applyChange(s, change), s, JSON.stringify(change))
  const all = startReport(CAT, 'lines')
  assert.equal(applyChange(all, { venues: { from: WARE, to: [HERTFORD] } }), all, 'every venue: nothing to swap')
  assert.equal(applyChange(null, { venues: { from: WARE, to: [HERTFORD] } }), null)
})
