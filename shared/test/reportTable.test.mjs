import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rightAligned, cellText, tableHeadings, rowText, totalText, listCount, tableModel } from '../reports/table.js'
import { formatValue, changeText } from '../reports/format.js'

// Results in the engine's shapes (api/src/reports/shape.js).
const dateCol = { key: 'date', field: 'date', label: 'Day', type: 'date', role: 'row' }
const sectionCol = { key: 'section.name', field: 'section.name', label: 'Section', type: 'text', role: 'row' }
const coversCol = { key: 'covers', field: 'covers', label: 'Party size', type: 'number', decimals: 0, role: 'row' }
const money = (key, label, extra = {}) => ({ key, label, type: 'money', role: 'value', adds: true, ...extra })
const count = (key, label, extra = {}) => ({ key, label, type: 'number', decimals: 0, role: 'value', adds: true, ...extra })
const meta = (extra = {}) => ({ currency: 'GBP', notes: [], ...extra })

test('numbers sit on the right; a grouping that is a number stays with the groupings', () => {
  assert.equal(rightAligned(money('net', 'Net sales'), 'summary'), true)
  assert.equal(rightAligned(count('n', 'Checks'), 'matrix'), true)
  assert.equal(rightAligned({ key: 'p', label: 'Rate', type: 'percent', role: 'value' }, 'summary'), true)
  assert.equal(rightAligned({ key: 'd', label: 'Time', type: 'duration', role: 'value' }, 'summary'), true)
  assert.equal(rightAligned(dateCol, 'summary'), false)
  assert.equal(rightAligned(sectionCol, 'list'), false)
  // A party of 4 is a grouping in a summary and a number in a list.
  assert.equal(rightAligned(coversCol, 'summary'), false)
  assert.equal(rightAligned(coversCol, 'matrix'), false)
  assert.equal(rightAligned({ ...coversCol, role: undefined }, 'list'), true)
  assert.equal(rightAligned(coversCol, 'list'), true)
  // A column says how it reads with `format` when that isn't its type.
  assert.equal(rightAligned({ key: 'x', label: 'X', type: 'text', format: 'money', role: 'value' }, 'summary'), true)
})

test('a cell says what the page says: the shared formats, and a change with its sign', () => {
  assert.equal(cellText(1210.5, money('net', 'Net sales'), 'GBP'), '£1,210.50')
  assert.equal(cellText(1210.5, money('net', 'Net sales'), 'EUR'), formatValue(1210.5, { type: 'money' }, { currency: 'EUR' }))
  assert.equal(cellText(41, count('n', 'Checks')), '41')
  assert.equal(cellText('2026-10-19', dateCol), formatValue('2026-10-19', dateCol, {}))
  assert.equal(cellText(null, money('net', 'Net sales')), '')
  const chg = { key: 'net__chg', label: 'Change', type: 'percent', decimals: 1, role: 'change' }
  assert.equal(cellText(0.124, chg), '+12.4%')
  assert.equal(cellText(-0.05, chg), '−5.0%')
  assert.equal(cellText(0, chg), '0.0%')
  assert.equal(cellText(null, chg), '')
  assert.equal(cellText(0.124, chg), changeText(0.124))
  // The same figure as a value is a plain percentage.
  assert.equal(cellText(0.124, { ...chg, role: 'value' }), '12.4%')
})

test('headings: one row, or the columns across the top with the values under them', () => {
  // A summary: one row, in order.
  const plain = tableHeadings([dateCol, money('net', 'Net sales'), count('n', 'Checks')])
  assert.equal(plain.rows.length, 1)
  assert.deepEqual(plain.rows[0].map(h => [h.i, h.label, h.span, h.depth]), [[0, 'Day', 1, 1], [1, 'Net sales', 1, 1], [2, 'Checks', 1, 1]])
  assert.equal(plain.rows[0][1].col.key, 'net')

  // A table across with one value: the column values are the headings.
  const one = tableHeadings([
    dateCol,
    count('g|0', 'Guests', { group: '12:00' }), count('g|1', 'Guests', { group: '18:00' }),
    count('g|t', 'Guests', { group: 'Total', role: 'total' }),
  ])
  assert.equal(one.rows.length, 1)
  assert.deepEqual(one.rows[0].map(h => h.label), ['Day', '12:00', '18:00', 'Total'])
  assert.ok(one.rows[0].every(h => !h.banner))

  // With two values: a banner over each column's values, the grouping two rows deep.
  const two = tableHeadings([
    dateCol,
    count('g|0', 'Guests', { group: '12:00' }), count('b|0', 'Bookings', { group: '12:00' }),
    count('g|1', 'Guests', { group: '18:00' }), count('b|1', 'Bookings', { group: '18:00' }),
    count('g|t', 'Guests', { group: 'Total', role: 'total' }), count('b|t', 'Bookings', { group: 'Total', role: 'total' }),
  ])
  assert.equal(two.rows.length, 2)
  assert.deepEqual(two.rows[0].map(h => [h.label, h.span, h.depth, !!h.banner]), [['Day', 1, 2, false], ['12:00', 2, 1, true], ['18:00', 2, 1, true], ['Total', 2, 1, true]])
  assert.deepEqual(two.rows[1].map(h => [h.i, h.label]), [[1, 'Guests'], [2, 'Bookings'], [3, 'Guests'], [4, 'Bookings'], [5, 'Guests'], [6, 'Bookings']])
  // Every column is under exactly one heading cell of the last row it has.
  const covered = two.rows[0].reduce((n, h) => n + h.span, 0)
  assert.equal(covered, 7)

  // A value beside the period before (the engine's shape: the value, then
  // Before and Change named after it): one row, each under its own words.
  const cmp = tableHeadings([
    dateCol, money('net', 'Net sales'),
    { ...money('net__prev', 'Before'), group: 'Net sales', role: 'compare', of: 'net' },
    { key: 'net__chg', label: 'Change', group: 'Net sales', type: 'percent', role: 'change', of: 'net' },
  ])
  assert.equal(cmp.rows.length, 1)
  assert.deepEqual(cmp.rows[0].map(h => h.label), ['Day', 'Net sales', 'Before', 'Change'])

  assert.deepEqual(tableHeadings([]).rows, [[]])
})

const summary = () => ({
  kind: 'summary',
  columns: [dateCol, sectionCol, money('net', 'Net sales'), count('n', 'Sold')],
  rows: [
    { kind: 'row', level: 2, k: ['2026-10-19', 'Mains'], cells: ['2026-10-19', 'Mains', 800, 60] },
    { kind: 'row', level: 2, k: ['2026-10-19', null], cells: ['2026-10-19', null, 12.5, 1] },
    { kind: 'subtotal', level: 1, k: ['2026-10-19'], cells: ['2026-10-19', null, 812.5, 61] },
    { kind: 'rest', level: 0, k: [], cells: ['Every other day', null, 300, 20] },
  ],
  totals: { cells: [null, null, 1112.5, 81] },
  meta: meta(),
})

test('what a row shows: a subtotal says so, everything else is its own words', () => {
  const r = summary()
  assert.equal(rowText(r, r.rows[0], 0), formatValue('2026-10-19', dateCol, {}))
  assert.equal(rowText(r, r.rows[0], 1), 'Mains')
  assert.equal(rowText(r, r.rows[0], 2), '£800.00')
  assert.equal(rowText(r, r.rows[0], 3), '60')
  // A subtotal: the grouping it is for, then Subtotal where the next one would be.
  assert.equal(rowText(r, r.rows[2], 0), formatValue('2026-10-19', dateCol, {}))
  assert.equal(rowText(r, r.rows[2], 1), 'Subtotal')
  assert.equal(rowText(r, r.rows[2], 2), '£812.50')
  // A subtotal of everything at level 0 says so in the first column.
  assert.equal(rowText(r, { kind: 'subtotal', level: 0, k: [], cells: [null, null, 5, 1] }, 0), 'Subtotal')
  // "Every other day" is words in a date column: never run through the date format.
  assert.equal(rowText(r, r.rows[3], 0), 'Every other day')
  assert.equal(rowText(r, r.rows[3], 1), '')
  assert.equal(rowText(r, r.rows[3], 2), '£300.00')
  assert.equal(rowText(r, { kind: 'rest', level: 0, k: [], cells: [null, null, 1, 1] }, 0), '')
  // The group's currency reaches the cells.
  assert.equal(rowText({ ...r, meta: meta({ currency: 'EUR' }) }, r.rows[0], 2), formatValue(800, { type: 'money' }, { currency: 'EUR' }))
})

test('the Total row: Total and each figure for a summary, how many rows and the sums for a list', () => {
  const r = summary()
  assert.deepEqual([0, 1, 2, 3].map(i => totalText(r, i)), ['Total', '', '£1,112.50', '81'])
  assert.equal(listCount(r), null)
  assert.equal(totalText({ ...r, totals: null }, 2), '')

  // No grouping: nothing says Total, the figures are still there.
  const flat = { kind: 'summary', columns: [money('net', 'Net sales'), count('n', 'Sold')], rows: [{ kind: 'row', level: 0, k: [], cells: [5, 1] }], totals: { cells: [5, 1] }, meta: meta() }
  assert.deepEqual([0, 1].map(i => totalText(flat, i)), ['£5.00', '1'])

  // A list: the count in the first cell, a sum only where the column adds up.
  const list = {
    kind: 'list',
    columns: [{ key: 'opened_at', label: 'Opened', type: 'moment' }, { key: 'server', label: 'Server', type: 'text' }, { key: 'total', label: 'Total', type: 'money', adds: true }, { key: 'covers', label: 'Guests', type: 'number', decimals: 0 }],
    rows: [{ kind: 'row', level: 0, cells: ['2026-10-19T18:15:00', 'Ali', 42.5, 2] }, { kind: 'row', level: 0, cells: ['2026-10-19T19:00:00', 'Sam', 20, 4] }],
    totals: { cells: [null, null, 62.5, null], count: 1234 },
    meta: meta({ row_count: 2 }),
  }
  assert.equal(listCount(list), 1234)
  assert.deepEqual([0, 1, 2, 3].map(i => totalText(list, i)), ['1,234 rows', '', '£62.50', ''])
  assert.equal(totalText({ ...list, totals: { cells: [null, null, 5, null], count: 1 } }, 0), '1 row')
  // No count from the engine: what the result says it holds, then the rows on the page.
  assert.equal(listCount({ ...list, totals: { cells: [null, null, 5, null] } }), 2)
  assert.equal(listCount({ kind: 'list', columns: [], rows: [{}, {}, {}], totals: null, meta: {} }), 3)
  // A list whose first column adds up shows its sum there, not the count.
  const sums = { kind: 'list', columns: [{ key: 'total', label: 'Total', type: 'money', adds: true }], rows: [{ kind: 'row', cells: [5] }], totals: { cells: [5], count: 1 }, meta: meta() }
  assert.equal(totalText(sums, 0), '£5.00')
})

test('the whole table as words, in the order shown', () => {
  const r = summary()
  const m = tableModel(r)
  assert.deepEqual(m.align, ['left', 'left', 'right', 'right'])
  assert.equal(m.first_is_row, true)
  assert.equal(m.groupings, 2)
  assert.equal(m.count, null)
  assert.equal(m.head.length, 1)
  assert.deepEqual(m.head[0].map(h => h.label), ['Day', 'Section', 'Net sales', 'Sold'])
  assert.equal(m.rows.length, 4)
  assert.deepEqual(m.rows.map(x => x.kind), ['row', 'row', 'subtotal', 'rest'])
  assert.deepEqual(m.rows.map(x => x.level), [2, 2, 1, 0])
  assert.deepEqual(m.rows[2].cells, [formatValue('2026-10-19', dateCol, {}), 'Subtotal', '£812.50', '61'])
  assert.deepEqual(m.rows[3].cells, ['Every other day', '', '£300.00', '20'])
  assert.deepEqual(m.total, ['Total', '', '£1,112.50', '81'])
  // Every row has a cell for every column.
  for (const x of m.rows) assert.equal(x.cells.length, r.columns.length)

  // Nothing found: no Total row either (the page says there is nothing).
  const empty = tableModel({ ...r, rows: [] })
  assert.deepEqual(empty.rows, [])
  assert.equal(empty.total, null)
  // No totals asked for.
  assert.equal(tableModel({ ...r, totals: null }).total, null)

  // A list: every column as it comes, numbers on the right, the count kept.
  const list = tableModel({
    kind: 'list',
    columns: [{ key: 'name', label: 'Guest', type: 'text' }, { key: 'covers', label: 'Guests', type: 'number', decimals: 0 }],
    rows: [{ kind: 'row', cells: ['Ali', 4] }],
    totals: { cells: [null, null], count: 1 },
    meta: {},
  })
  assert.deepEqual(list.align, ['left', 'right'])
  assert.equal(list.first_is_row, false)
  assert.equal(list.groupings, 0)
  assert.equal(list.count, 1)
  assert.deepEqual(list.total, ['1 row', ''])

  // Nothing at all.
  const none = tableModel(null)
  assert.deepEqual(none, { head: [[]], align: [], rows: [], total: null, first_is_row: false, groupings: 0, count: null })
})

test('everything else and the Total row keep their own words, whatever the column', () => {
  // By party size, a number: the row for everything else is its words, never run through the number format.
  const bySize = {
    kind: 'summary', columns: [coversCol, count('n', 'Bookings')],
    rows: [{ kind: 'row', level: 1, k: [2], cells: [2, 10] }, { kind: 'rest', level: 0, k: [], cells: ['Every other party size', 4] }],
    totals: { cells: [null, 14] }, meta: meta(),
  }
  assert.equal(rowText(bySize, bySize.rows[0], 0), '2')
  assert.equal(rowText(bySize, bySize.rows[1], 0), 'Every other party size')
  assert.equal(rowText(bySize, bySize.rows[1], 1), '4')
  // A grouping with its own word for nothing: its rows say it, the Total row under it stays blank.
  const r = summary()
  r.columns[1] = { ...sectionCol, empty: 'No section' }
  assert.equal(rowText(r, r.rows[1], 1), 'No section')
  assert.deepEqual([0, 1, 2, 3].map(i => totalText(r, i)), ['Total', '', '£1,112.50', '81'])
})
