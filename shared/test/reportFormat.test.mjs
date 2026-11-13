import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatMoney, formatNumber, formatPercent, formatDuration, formatDate, formatMoment,
  formatValue, plainValue, plainHeading, safeText, csvCell, changeOf,
  DATE_BUCKETS, MOMENT_BUCKETS, BUCKET_LABELS, VALUE_TYPES, NUMERIC_TYPES,
} from '../reports/format.js'

test('money, numbers and percentages', () => {
  assert.equal(formatMoney(1234.5), '£1,234.50')
  assert.equal(formatMoney(-12.3), '-£12.30')
  // A rounding crumb isn't "-£0.00".
  assert.equal(formatMoney(-0.001), '£0.00')
  assert.equal(formatMoney(10, 'EUR'), '€10.00')
  assert.equal(formatMoney(10, 'nope'), '£10.00')
  assert.equal(formatMoney(null), '')
  assert.equal(formatMoney(NaN), '')
  assert.equal(formatNumber(1234), '1,234')
  assert.equal(formatNumber(2.345), '2.35')
  assert.equal(formatNumber(12.345), '12.3')
  assert.equal(formatNumber(12.345, 0), '12')
  assert.equal(formatNumber('12'), '')
  assert.equal(formatPercent(0.153), '15.3%')
  assert.equal(formatPercent(1), '100.0%')
  assert.equal(formatPercent(0.153, 0), '15%')
  assert.equal(formatPercent(undefined), '')
})

test('durations in the unit that fits', () => {
  assert.equal(formatDuration(45), '45 s')
  assert.equal(formatDuration(12 * 60), '12 min')
  assert.equal(formatDuration(65 * 60), '1 h 05 min')
  assert.equal(formatDuration(2 * 3600), '2 h')
  assert.equal(formatDuration(51 * 3600), '2 d 3 h')
  assert.equal(formatDuration(-90), '-2 min')
  assert.equal(formatDuration(null), '')
})

test('days by how they were grouped', () => {
  assert.equal(formatDate('2026-11-12'), 'Thu 12 Nov 2026')
  assert.equal(formatDate('2026-11-09', 'week'), 'w/c 9 Nov 2026')
  assert.equal(formatDate('2026-11-01', 'month'), 'Nov 2026')
  assert.equal(formatDate('2026-10-01', 'quarter'), 'Q4 2026')
  assert.equal(formatDate('2026-01-01', 'year'), '2026')
  assert.equal(formatDate(1, 'weekday'), 'Monday')
  assert.equal(formatDate(7, 'weekday'), 'Sunday')
  assert.equal(formatDate(9, 'hour'), '09:00')
  assert.equal(formatDate(''), '')
  assert.equal(formatDate('soon'), 'soon')
  assert.equal(formatMoment('2026-11-12T14:05:33'), '12 Nov 2026 14:05')
  assert.equal(formatMoment('2026-11-12'), '12 Nov 2026')
  for (const b of MOMENT_BUCKETS) assert.ok(BUCKET_LABELS[b], b + ' has a label')
  assert.ok(!DATE_BUCKETS.includes('hour') && MOMENT_BUCKETS.includes('hour'))
  for (const t of NUMERIC_TYPES) assert.ok(VALUE_TYPES.includes(t))
})

test('a cell as words, by its column', () => {
  assert.equal(formatValue(12.5, { type: 'money' }), '£12.50')
  assert.equal(formatValue(12.5, { type: 'money' }, { currency: 'EUR' }), '€12.50')
  assert.equal(formatValue(0.25, { type: 'percent' }), '25.0%')
  assert.equal(formatValue(0.25, { type: 'number', format: 'percent', decimals: 0 }), '25%')
  assert.equal(formatValue(3, { type: 'number' }), '3')
  assert.equal(formatValue(600, { type: 'duration' }), '10 min')
  assert.equal(formatValue('2026-11-09', { type: 'date', bucket: 'week' }), 'w/c 9 Nov 2026')
  assert.equal(formatValue('2026-11-12T14:05:00', { type: 'moment' }), '12 Nov 2026 14:05')
  assert.equal(formatValue(14, { type: 'moment', bucket: 'hour' }), '14:00')
  assert.equal(formatValue('14:05:00', { type: 'time' }), '14:05')
  assert.equal(formatValue(true, { type: 'yesno' }), 'Yes')
  assert.equal(formatValue(false, { type: 'yesno' }), 'No')
  assert.equal(formatValue('card_external', { type: 'choice', labels: { card_external: 'Card' } }), 'Card')
  assert.equal(formatValue('other', { type: 'choice', labels: {} }), 'other')
  // An empty cell says what the column says it means, else nothing.
  assert.equal(formatValue(null, { type: 'text', empty: 'No section' }), 'No section')
  assert.equal(formatValue(null, { type: 'money' }), '')
})

test('a cell for a file keeps numbers as numbers', () => {
  assert.equal(plainValue(12.345, { type: 'money' }), 12.35)
  assert.equal(plainValue(0.1534, { type: 'percent' }), 15.34)
  assert.equal(plainValue('7', { type: 'number' }), 7)
  assert.equal(plainValue('2026-11-12', { type: 'date' }), '2026-11-12')
  assert.equal(plainValue('2026-11-12T14:05:00', { type: 'moment' }), '2026-11-12 14:05:00')
  assert.equal(plainValue('2026-11-01', { type: 'date', bucket: 'month' }), 'Nov 2026')
  assert.equal(plainValue(3, { type: 'date', bucket: 'weekday' }), 'Wednesday')
  assert.equal(plainValue(true, { type: 'yesno' }), 'Yes')
  assert.equal(plainValue('cash', { type: 'choice', labels: { cash: 'Cash' } }), 'Cash')
  assert.equal(plainValue(null, { type: 'text', empty: 'No section' }), 'No section')
  // An empty number stays empty: "No section" in a money column would break a sum.
  assert.equal(plainValue(null, { type: 'money', empty: 'None' }), '')
  assert.equal(plainHeading({ label: 'Net sales', type: 'money' }, { currency: 'GBP' }), 'Net sales (GBP)')
  assert.equal(plainHeading({ label: 'Share', type: 'percent' }), 'Share (%)')
  assert.equal(plainHeading({ label: 'Wait', type: 'duration' }), 'Wait (seconds)')
  assert.equal(plainHeading({ label: 'Net sales', type: 'money', group: 'Mon' }), 'Mon: Net sales')
  assert.equal(plainHeading({ label: 'Dish', type: 'text' }), 'Dish')
})

test('text that looks like a formula is made safe', () => {
  assert.equal(safeText('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(safeText('+44 7700'), "'+44 7700")
  assert.equal(safeText('-5'), "'-5")
  assert.equal(safeText('@home'), "'@home")
  assert.equal(safeText('Pad Thai'), 'Pad Thai')
  assert.equal(safeText(null), '')
  assert.equal(csvCell(12.5), '12.5')
  assert.equal(csvCell(-5), '-5')
  assert.equal(csvCell(Infinity), '')
  assert.equal(csvCell('Fish, chips'), '"Fish, chips"')
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""')
  assert.equal(csvCell('two\nlines'), '"two\nlines"')
  assert.equal(csvCell('=1+1'), "'=1+1")
  assert.equal(csvCell(null), '')
})

test('change against the period before', () => {
  assert.equal(changeOf(120, 100), 0.2)
  assert.equal(changeOf(80, 100), -0.2)
  assert.equal(changeOf(-50, -100), 0.5)
  assert.equal(changeOf(10, 0), null)
  assert.equal(changeOf(10, null), null)
  assert.equal(changeOf(null, 10), null)
})
