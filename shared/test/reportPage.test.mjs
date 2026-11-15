import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PAGE_LIMITS, cleanRef, isPage, normalisePage, pageProblems, newPage, pageRefs, blockGiven, shownResult, printShow, pageWords,
} from '../reports/page.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const V = '33333333-3333-4333-8333-333333333333'

test('a report\'s reference is a saved report\'s id or a starter\'s key, nothing else', () => {
  assert.equal(cleanRef(A), A)
  assert.equal(cleanRef(A.toUpperCase()), A)
  assert.equal(cleanRef('starter:till_sales_by_day'), 'starter:till_sales_by_day')
  for (const no of ['starter:', 'starter:Bad Key', 'page', 'starter:' + 'x'.repeat(61), A + '/run', '', null, 7, {}, [A]]) {
    assert.equal(cleanRef(no), null, String(no))
  }
})

test('a page comes back in one known shape from anything', () => {
  for (const junk of [null, undefined, 3, 'page', [], {}]) {
    assert.deepEqual(normalisePage(junk), { version: 1, kind: 'page', blocks: [], period: null, venues: null })
  }
  assert.equal(isPage({ kind: 'page' }), true)
  for (const no of [{ kind: 'summary' }, {}, null, 'page', [{ kind: 'page' }]]) assert.equal(isPage(no), false)
  const p = normalisePage({
    kind: 'page',
    blocks: [
      { type: 'break' },                                        // never first
      { type: 'text', title: '  This   week ', text: ' one\r\n\r\n\r\n\r\ntwo\t three ' },
      { type: 'text', title: ' ', text: '' },                   // nothing in it
      { id: 'top', type: 'report', ref: A.toUpperCase(), show: 'chart', title: ' Sales ' },
      { type: 'break' }, { type: 'break' },                     // never two in a row
      { id: 'top', type: 'report', ref: 'starter:bookings_by_source', show: 'sideways' },   // an id used twice
      { type: 'report', ref: 'not a report' },
      { type: 'video', src: 'x' },
      { id: 'BAD ID', type: 'report', ref: B },
      { type: 'break' },                                        // never last
    ],
    period: { relative: 'last_week', extra: 1 },
    venues: [V.toUpperCase(), 'nope', V],
  })
  assert.deepEqual(p.blocks, [
    { id: 'b1', type: 'text', title: 'This week', text: 'one\n\ntwo three' },
    { id: 'top', type: 'report', ref: A, show: 'chart', title: 'Sales' },
    { id: 'b2', type: 'break' },
    { id: 'b3', type: 'report', ref: 'starter:bookings_by_source', show: 'both', title: '' },
    { id: 'b4', type: 'report', ref: B, show: 'both', title: '' },
  ])
  assert.deepEqual(p.period, { relative: 'last_week' })
  assert.deepEqual(p.venues, [V])
  // The same the second time round: ids stay with their blocks.
  assert.deepEqual(normalisePage(p), p)
  // An id it hands out never takes one a later block came with.
  const q = normalisePage({ blocks: [{ type: 'report', ref: A }, { id: 'b1', type: 'report', ref: B }] })
  assert.deepEqual(q.blocks.map(b => b.id), ['b2', 'b1'])
})

test('a page\'s period and venues are its own, or each report\'s', () => {
  assert.equal(normalisePage({ period: null }).period, null)
  assert.equal(normalisePage({ period: { relative: 'someday' } }).period, null)
  assert.deepEqual(normalisePage({ period: { from: '2026-10-25', to: '2026-10-19' } }).period, { from: '2026-10-19', to: '2026-10-25' })
  assert.equal(normalisePage({}).venues, null)
  assert.equal(normalisePage({ venues: null }).venues, null)
  assert.equal(normalisePage({ venues: 'all' }).venues, 'all')
  assert.equal(normalisePage({ venues: [] }).venues, 'all')
  assert.equal(normalisePage({ venues: 'ware' }).venues, 'all')
})

test('a page holds so many blocks and reports, and words of so many letters', () => {
  const many = normalisePage({ blocks: Array.from({ length: 40 }, () => ({ type: 'report', ref: A })) })
  assert.equal(many.blocks.length, PAGE_LIMITS.reports)
  const notes = normalisePage({ blocks: Array.from({ length: 60 }, (_, i) => ({ type: 'text', text: 'note ' + i })) })
  assert.equal(notes.blocks.length, PAGE_LIMITS.blocks)
  const long = normalisePage({ blocks: [{ type: 'text', title: 't'.repeat(500), text: 'x'.repeat(5000) }, { type: 'report', ref: A, title: 'r'.repeat(500) }] })
  assert.equal(long.blocks[0].title.length, PAGE_LIMITS.title)
  assert.equal(long.blocks[0].text.length, PAGE_LIMITS.text)
  assert.equal(long.blocks[1].title.length, PAGE_LIMITS.title)
})

test('a page needs a report on it, and a new one starts with last week at every venue', () => {
  assert.deepEqual(pageProblems(normalisePage({ blocks: [{ type: 'text', text: 'only words' }] })), ['Add at least one report to the page'])
  assert.deepEqual(pageProblems(normalisePage({ blocks: [{ type: 'report', ref: A }] })), [])
  const fresh = newPage()
  assert.deepEqual(fresh, { version: 1, kind: 'page', blocks: [], period: { relative: 'last_week' }, venues: 'all' })
  assert.equal(isPage(fresh), true)
  assert.equal(pageProblems(fresh).length, 1)
})

test('the reports a page names, once each in the order they come', () => {
  const p = normalisePage({ blocks: [
    { type: 'report', ref: B }, { type: 'text', text: 'x' }, { type: 'report', ref: A }, { type: 'report', ref: B },
    { type: 'report', ref: 'starter:bookings_by_source' },
  ] })
  assert.deepEqual(pageRefs(p), [B, A, 'starter:bookings_by_source'])
  assert.deepEqual(pageRefs(normalisePage({})), [])
})

test('a page\'s period and venues go on a report\'s own choices of that kind', () => {
  const spec = { params: [
    { key: 'when', type: 'period' }, { key: 'where', type: 'venues' }, { key: 'again', type: 'period' }, { key: 'dish', type: 'text' },
  ] }
  const week = { relative: 'last_week' }
  assert.deepEqual(blockGiven(spec, { period: week, venues: [V] }), { when: week, where: [V] })
  assert.deepEqual(blockGiven(spec, { period: week, venues: 'all' }), { when: week, where: 'all' })
  // The page leaves one to the report: nothing is given for it.
  assert.deepEqual(blockGiven(spec, { period: null, venues: [V] }), { where: [V] })
  assert.deepEqual(blockGiven(spec, { period: week, venues: null }), { when: week })
  assert.deepEqual(blockGiven(spec, {}), {})
  assert.deepEqual(blockGiven(spec), {})
  // A report with no such choice runs as it is.
  assert.deepEqual(blockGiven({ params: [{ key: 'dish', type: 'text' }] }, { period: week, venues: [V] }), {})
  assert.deepEqual(blockGiven({}, { period: week, venues: [V] }), {})
  assert.deepEqual(blockGiven(null, { period: week }), {})
})

test('what a block shows of its report, on screen and on paper', () => {
  const result = { rows: [1], spec: { kind: 'summary', view: { kind: 'bar', y: ['v1'], table_below: false } } }
  assert.deepEqual(shownResult(result, 'both').spec.view, { kind: 'bar', y: ['v1'], table_below: true })
  assert.deepEqual(shownResult(result, 'chart').spec.view, { kind: 'bar', y: ['v1'], table_below: false })
  assert.deepEqual(shownResult(result, 'table').spec.view, { kind: 'table', y: ['v1'], table_below: false })
  // The result it was given isn't changed, and the rest of it comes along.
  assert.deepEqual(result.spec.view, { kind: 'bar', y: ['v1'], table_below: false })
  assert.equal(shownResult(result, 'table').rows, result.rows)
  // Nothing to choose between: handed back as it came.
  const list = { rows: [], spec: { kind: 'list' } }
  assert.equal(shownResult(list, 'chart'), list)
  assert.equal(shownResult(null, 'chart'), null)
  assert.deepEqual(printShow('both'), { table: true })
  assert.deepEqual(printShow('chart'), { table: false })
  assert.deepEqual(printShow('table'), { chart: false })
  assert.deepEqual(printShow('anything else'), { table: true })
})

test('a page said in a line', () => {
  assert.equal(pageWords({ blocks: [{ type: 'report', ref: A }] }), 'A page of 1 report')
  assert.equal(pageWords({ blocks: [{ type: 'report', ref: A }, { type: 'report', ref: B }, { type: 'text', text: 'x' }, { type: 'break' }, { type: 'report', ref: A }] }),
    'A page of 3 reports and 1 note')
  assert.equal(pageWords({ blocks: [{ type: 'report', ref: A }, { type: 'text', text: 'x' }, { type: 'text', title: 'y' }] }), 'A page of 1 report and 2 notes')
  assert.equal(pageWords(null), 'A page of 0 reports')
})
