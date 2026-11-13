import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RELATIVE_PERIODS, PERIOD_LABELS, MAX_PERIOD_DAYS, MAX_N_DAYS,
  isYmd, addDays, addMonths, daysBetween, mondayOf, todayIn,
  normalisePeriod, resolvePeriod, comparePeriod, rangeText, periodName, periodText,
} from '../reports/period.js'

// Thursday 12 November 2026.
const TODAY = '2026-11-12'
const range = (p, today = TODAY) => { const r = resolvePeriod(p, today); return r && [r.from, r.to] }

test('days and months add up like a calendar', () => {
  assert.equal(isYmd('2026-02-29'), false)
  assert.equal(isYmd('2028-02-29'), true)
  assert.equal(isYmd('2026-2-9'), false)
  assert.equal(isYmd(20261112), false)
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2028-02-29', -12), '2027-02-28')
  assert.equal(addMonths('2026-11-12', -12), '2025-11-12')
  assert.equal(daysBetween('2026-11-02', '2026-11-08'), 6)
  assert.equal(mondayOf('2026-11-12'), '2026-11-09')
  assert.equal(mondayOf('2026-11-09'), '2026-11-09')
  assert.equal(mondayOf('2026-11-15'), '2026-11-09')
})

test('today is the day at the venue, not the server', () => {
  const late = new Date('2026-11-12T23:30:00Z')
  assert.equal(todayIn('Europe/London', late), '2026-11-12')
  assert.equal(todayIn('Asia/Bangkok', late), '2026-11-13')
  assert.equal(todayIn('America/New_York', new Date('2026-11-12T03:00:00Z')), '2026-11-11')
  // A zone that doesn't exist falls back rather than throwing.
  assert.equal(todayIn('Nowhere/Land', late), '2026-11-12')
})

test('every relative period has a label and resolves', () => {
  for (const key of RELATIVE_PERIODS) {
    assert.ok(PERIOD_LABELS[key], key + ' has a label')
    const r = resolvePeriod(key.endsWith('_n_days') ? { relative: key, n: 7 } : { relative: key }, TODAY)
    assert.ok(r && isYmd(r.from) && isYmd(r.to) && r.from <= r.to, key + ' resolves to a range')
    assert.ok(r.step.n >= 1, key + ' has a step')
  }
})

test('relative periods mean the dates people expect', () => {
  assert.deepEqual(range({ relative: 'today' }), ['2026-11-12', '2026-11-12'])
  assert.deepEqual(range({ relative: 'yesterday' }), ['2026-11-11', '2026-11-11'])
  assert.deepEqual(range({ relative: 'this_week' }), ['2026-11-09', '2026-11-15'])
  assert.deepEqual(range({ relative: 'last_week' }), ['2026-11-02', '2026-11-08'])
  assert.deepEqual(range({ relative: 'next_week' }), ['2026-11-16', '2026-11-22'])
  assert.deepEqual(range({ relative: 'week_to_date' }), ['2026-11-09', '2026-11-12'])
  assert.deepEqual(range({ relative: 'this_month' }), ['2026-11-01', '2026-11-30'])
  assert.deepEqual(range({ relative: 'last_month' }), ['2026-10-01', '2026-10-31'])
  assert.deepEqual(range({ relative: 'month_to_date' }), ['2026-11-01', '2026-11-12'])
  assert.deepEqual(range({ relative: 'this_quarter' }), ['2026-10-01', '2026-12-31'])
  assert.deepEqual(range({ relative: 'last_quarter' }), ['2026-07-01', '2026-09-30'])
  assert.deepEqual(range({ relative: 'this_year' }), ['2026-01-01', '2026-12-31'])
  assert.deepEqual(range({ relative: 'last_year' }), ['2025-01-01', '2025-12-31'])
  assert.deepEqual(range({ relative: 'year_to_date' }), ['2026-01-01', '2026-11-12'])
  // The last N days end yesterday (whole days only); the next N start today.
  assert.deepEqual(range({ relative: 'last_n_days', n: 7 }), ['2026-11-05', '2026-11-11'])
  assert.deepEqual(range({ relative: 'next_n_days', n: 7 }), ['2026-11-12', '2026-11-18'])
  // January: last month and last quarter cross the year.
  assert.deepEqual(range({ relative: 'last_month' }, '2027-01-10'), ['2026-12-01', '2026-12-31'])
  assert.deepEqual(range({ relative: 'last_quarter' }, '2027-01-10'), ['2026-10-01', '2026-12-31'])
  // A Monday is the start of its own week.
  assert.deepEqual(range({ relative: 'last_week' }, '2026-11-09'), ['2026-11-02', '2026-11-08'])
})

test('a period is tidied or refused', () => {
  assert.equal(normalisePeriod(null), null)
  assert.equal(normalisePeriod({ relative: 'next_decade' }), null)
  assert.equal(normalisePeriod({ relative: 'last_n_days' }), null)
  assert.equal(normalisePeriod({ relative: 'last_n_days', n: 0 }), null)
  assert.deepEqual(normalisePeriod({ relative: 'last_n_days', n: 99999 }), { relative: 'last_n_days', n: MAX_N_DAYS })
  assert.deepEqual(normalisePeriod({ relative: 'last_week', n: 3, junk: 1 }), { relative: 'last_week' })
  // The wrong way round is put right.
  assert.deepEqual(normalisePeriod({ from: '2026-11-08', to: '2026-11-02' }), { from: '2026-11-02', to: '2026-11-08' })
  assert.equal(normalisePeriod({ from: '2026-11-31', to: '2026-12-01' }), null)
  // Too long a range keeps its end.
  const long = normalisePeriod({ from: '2000-01-01', to: '2026-11-12' })
  assert.equal(long.to, '2026-11-12')
  assert.equal(daysBetween(long.from, long.to), MAX_PERIOD_DAYS)
  assert.equal(resolvePeriod({ relative: 'last_week' }, 'today'), null)
})

test('the period before, and the same dates last year', () => {
  const week = resolvePeriod({ relative: 'last_week' }, TODAY)
  assert.deepEqual(comparePeriod(week, 'previous_period'), { from: '2026-10-26', to: '2026-11-01', shift: { unit: 'day', n: 7 } })
  assert.deepEqual(comparePeriod(week, 'last_year'), { from: '2025-11-02', to: '2025-11-08', shift: { unit: 'month', n: 12 } })

  // A whole month against the month before, whatever their lengths.
  const march = resolvePeriod({ from: '2026-03-01', to: '2026-03-31' }, TODAY)
  assert.equal(march.whole, true)
  assert.deepEqual(comparePeriod(march, 'previous_period'), { from: '2026-02-01', to: '2026-02-28', shift: { unit: 'month', n: 1 } })
  const lastMonth = resolvePeriod({ relative: 'last_month' }, TODAY)
  assert.deepEqual(comparePeriod(lastMonth, 'previous_period'), { from: '2026-09-01', to: '2026-09-30', shift: { unit: 'month', n: 1 } })
  assert.deepEqual(comparePeriod(lastMonth, 'last_year'), { from: '2025-10-01', to: '2025-10-31', shift: { unit: 'month', n: 12 } })

  // The month so far against the same days of the month before.
  const mtd = resolvePeriod({ relative: 'month_to_date' }, TODAY)
  assert.deepEqual(comparePeriod(mtd, 'previous_period'), { from: '2026-10-01', to: '2026-10-12', shift: { unit: 'month', n: 1 } })

  // Any other range steps back by its own length.
  const ten = resolvePeriod({ from: '2026-11-03', to: '2026-11-12' }, TODAY)
  assert.deepEqual(comparePeriod(ten, 'previous_period'), { from: '2026-10-24', to: '2026-11-02', shift: { unit: 'day', n: 10 } })
  const last30 = resolvePeriod({ relative: 'last_n_days', n: 30 }, TODAY)
  assert.deepEqual(comparePeriod(last30, 'previous_period'), { from: '2026-09-13', to: '2026-10-12', shift: { unit: 'day', n: 30 } })

  // A leap day last year is 28 February.
  const leap = resolvePeriod({ from: '2028-02-29', to: '2028-02-29' }, '2028-03-01')
  assert.deepEqual(comparePeriod(leap, 'last_year'), { from: '2027-02-28', to: '2027-02-28', shift: { unit: 'month', n: 12 } })
  assert.equal(comparePeriod(week, 'next_year'), null)
  assert.equal(comparePeriod(null, 'last_year'), null)
})

test('periods read as words', () => {
  assert.equal(rangeText('2026-11-02', '2026-11-08'), '2 to 8 Nov 2026')
  assert.equal(rangeText('2026-10-28', '2026-11-03'), '28 Oct to 3 Nov 2026')
  assert.equal(rangeText('2025-12-29', '2026-01-04'), '29 Dec 2025 to 4 Jan 2026')
  assert.equal(rangeText('2026-11-08', '2026-11-08'), '8 Nov 2026')
  assert.equal(rangeText('2026-10-01', '2026-10-31'), 'Oct 2026')
  assert.equal(rangeText('2026-01-01', '2026-12-31'), '2026')
  assert.equal(rangeText('2026-10-01', '2026-12-31'), '1 Oct to 31 Dec 2026')
  assert.equal(rangeText('nope', '2026-12-31'), '')
  assert.equal(periodName({ relative: 'last_week' }), 'Last week')
  assert.equal(periodName({ relative: 'last_n_days', n: 30 }), 'Last 30 days')
  assert.equal(periodName({ relative: 'last_n_days', n: 1 }), 'Yesterday')
  assert.equal(periodName({ from: '2026-11-02', to: '2026-11-08' }), '2 to 8 Nov 2026')
  assert.equal(periodText({ relative: 'last_week' }, TODAY), 'Last week (2 to 8 Nov 2026)')
  assert.equal(periodText({ relative: 'last_month' }, TODAY), 'Last month (Oct 2026)')
  assert.equal(periodText({ from: '2026-11-02', to: '2026-11-08' }, TODAY), '2 to 8 Nov 2026')
  assert.equal(periodText({ relative: 'nope' }, TODAY), '')
})
