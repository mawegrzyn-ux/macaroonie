import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normaliseTiming, timingProblem, runsOn, nextRunAt, isLate, timingText,
  normaliseDelivery, deliveryProblem, deliveryText,
  normaliseCondition, conditionProblem, conditionMet, conditionText,
  normaliseRecipients, recipientsProblem, isEmail, periodProblem, MAX_RECIPIENTS,
} from '../reports/schedule.js'
import { newReport } from '../reports/spec.js'

const next = (timing, after, tz) => {
  const at = nextRunAt(timing, new Date(after), tz)
  return at && at.toISOString()
}

test('a timing comes back in one known shape', () => {
  assert.deepEqual(normaliseTiming(null), { every: 'day', time: '08:00' })
  assert.deepEqual(normaliseTiming({ every: 'day', time: '25:00' }), { every: 'day', time: '08:00' })
  assert.deepEqual(normaliseTiming({ every: 'week', days: [5, 1, 5, 9, '3'], time: '07:30' }), { every: 'week', days: [1, 3, 5], time: '07:30' })
  // Every day of the week is every day.
  assert.deepEqual(normaliseTiming({ every: 'week', days: [1, 2, 3, 4, 5, 6, 7], time: '06:00' }), { every: 'day', time: '06:00' })
  assert.deepEqual(normaliseTiming({ every: 'month', on: { day: 31 } }), { every: 'month', on: { day: 31 }, time: '08:00' })
  assert.deepEqual(normaliseTiming({ every: 'month', on: { day: 'last' } }), { every: 'month', on: { day: 'last' }, time: '08:00' })
  assert.deepEqual(normaliseTiming({ every: 'month', on: { day: 40 } }), { every: 'month', on: { day: 1 }, time: '08:00' })
  assert.deepEqual(normaliseTiming({ every: 'month', on: { week: 'last', weekday: 5 } }), { every: 'month', on: { week: 'last', weekday: 5 }, time: '08:00' })
  assert.deepEqual(normaliseTiming({ every: 'month', on: { week: 'fifth', weekday: 9 } }), { every: 'month', on: { week: 'first', weekday: 1 }, time: '08:00' })
  assert.deepEqual(normaliseTiming({ every: 'hourly' }), { every: 'day', time: '08:00' })
})

test('what is wrong with a timing is said as a sentence', () => {
  assert.equal(timingProblem({ every: 'day', time: '08:00' }), null)
  assert.match(timingProblem({ every: 'hourly' }), /every day, chosen days or every month/)
  assert.match(timingProblem({ every: 'day', time: '8am' }), /HH:MM/)
  assert.match(timingProblem({ every: 'week', days: [] }), /at least one day/)
  assert.match(timingProblem({ every: 'week', days: [0, 8] }), /at least one day/)
  assert.equal(timingProblem({ every: 'week', days: [2] }), null)
  assert.match(timingProblem({ every: 'month', on: { day: 0 } }), /1 to 31/)
  assert.equal(timingProblem({ every: 'month', on: { day: 'last' } }), null)
  assert.match(timingProblem({ every: 'month', on: { week: 'fifth', weekday: 1 } }), /which week/)
  assert.match(timingProblem({ every: 'month', on: { week: 'first' } }), /which week/)
})

test('which days a timing runs on', () => {
  const weekdays = { every: 'week', days: [1, 2, 3, 4, 5] }
  assert.equal(runsOn(weekdays, '2026-11-13'), true) // a Friday
  assert.equal(runsOn(weekdays, '2026-11-14'), false) // a Saturday
  // A day the month lacks runs on its last day.
  const the31st = { every: 'month', on: { day: 31 } }
  assert.equal(runsOn(the31st, '2027-02-28'), true)
  assert.equal(runsOn(the31st, '2028-02-28'), false)
  assert.equal(runsOn(the31st, '2028-02-29'), true)
  assert.equal(runsOn(the31st, '2026-04-30'), true)
  assert.equal(runsOn(the31st, '2026-05-30'), false)
  assert.equal(runsOn(the31st, '2026-05-31'), true)
  const last = { every: 'month', on: { day: 'last' } }
  assert.equal(runsOn(last, '2026-11-30'), true)
  assert.equal(runsOn(last, '2026-11-29'), false)
  // Nov 2026: Mondays 2, 9, 16, 23, 30; Fridays 6, 13, 20, 27.
  const firstMonday = { every: 'month', on: { week: 'first', weekday: 1 } }
  assert.equal(runsOn(firstMonday, '2026-11-02'), true)
  assert.equal(runsOn(firstMonday, '2026-11-09'), false)
  const fourthMonday = { every: 'month', on: { week: 'fourth', weekday: 1 } }
  assert.equal(runsOn(fourthMonday, '2026-11-23'), true)
  assert.equal(runsOn(fourthMonday, '2026-11-30'), false)
  const lastMonday = { every: 'month', on: { week: 'last', weekday: 1 } }
  assert.equal(runsOn(lastMonday, '2026-11-30'), true)
  assert.equal(runsOn(lastMonday, '2026-11-23'), false)
  const lastFriday = { every: 'month', on: { week: 'last', weekday: 5 } }
  assert.equal(runsOn(lastFriday, '2026-11-27'), true)
  assert.equal(runsOn(lastFriday, '2026-11-20'), false)
})

test('the next run is the first time strictly after, at the venue', () => {
  const daily = { every: 'day', time: '08:00' }
  assert.equal(next(daily, '2026-11-15T07:00:00Z'), '2026-11-15T08:00:00.000Z')
  // Strictly after: a run at 08:00 doesn't find itself again.
  assert.equal(next(daily, '2026-11-15T08:00:00Z'), '2026-11-16T08:00:00.000Z')
  // In British Summer Time 08:00 is 07:00 UTC.
  assert.equal(next(daily, '2026-06-01T05:00:00Z'), '2026-06-01T07:00:00.000Z')
  // Another time zone.
  assert.equal(next({ every: 'day', time: '09:00' }, '2026-11-15T12:00:00Z', 'America/New_York'), '2026-11-15T14:00:00.000Z')
  // A time zone that doesn't exist is London's.
  assert.equal(next({ every: 'day', time: '09:00' }, '2026-11-15T12:00:00Z', 'Not/AZone'), '2026-11-16T09:00:00.000Z')
  // Mondays and Fridays, asked on a Saturday.
  assert.equal(next({ every: 'week', days: [1, 5], time: '07:30' }, '2026-11-14T10:00:00Z'), '2026-11-16T07:30:00.000Z')
  // The 31st in February, in a leap year and not.
  assert.equal(next({ every: 'month', on: { day: 31 }, time: '08:00' }, '2027-02-01T00:00:00Z'), '2027-02-28T08:00:00.000Z')
  assert.equal(next({ every: 'month', on: { day: 31 }, time: '08:00' }, '2028-02-01T00:00:00Z'), '2028-02-29T08:00:00.000Z')
  // The last Friday, and the first Monday of the month after.
  assert.equal(next({ every: 'month', on: { week: 'last', weekday: 5 }, time: '08:00' }, '2026-11-01T00:00:00Z'), '2026-11-27T08:00:00.000Z')
  assert.equal(next({ every: 'month', on: { week: 'first', weekday: 1 }, time: '08:00' }, '2026-11-15T00:00:00Z'), '2026-12-07T08:00:00.000Z')
  // No days picked never runs.
  assert.equal(nextRunAt({ every: 'week', days: [], time: '08:00' }, new Date('2026-11-15T00:00:00Z')), null)
  assert.equal(nextRunAt({ every: 'day' }, new Date('nonsense')), null)
})

test('the clock changes: a skipped time runs an hour later, a doubled time once', () => {
  const night = { every: 'day', time: '01:30' }
  // 29 Mar 2026: 01:00 to 02:00 doesn't happen in London, so 01:30 is 02:30 BST.
  assert.equal(next(night, '2026-03-29T00:00:00Z'), '2026-03-29T01:30:00.000Z')
  // 25 Oct 2026: 01:00 to 02:00 happens twice; it runs at the second.
  const first = next(night, '2026-10-24T23:00:00Z')
  assert.equal(first, '2026-10-25T01:30:00.000Z')
  assert.equal(next(night, first), '2026-10-26T01:30:00.000Z')
  // Days on either side keep their own offsets.
  assert.equal(next({ every: 'day', time: '08:00' }, '2026-03-28T12:00:00Z'), '2026-03-29T07:00:00.000Z')
  assert.equal(next({ every: 'day', time: '08:00' }, '2026-10-24T12:00:00Z'), '2026-10-25T08:00:00.000Z')
})

test('a run missed by more than six hours is late', () => {
  const due = new Date('2026-11-15T08:00:00Z')
  assert.equal(isLate(due, new Date('2026-11-15T13:59:00Z')), false)
  assert.equal(isLate(due, new Date('2026-11-15T14:00:00Z')), false)
  assert.equal(isLate(due, new Date('2026-11-15T14:01:00Z')), true)
  assert.equal(isLate('2026-11-15T08:00:00Z', new Date('2026-11-16T08:00:00Z')), true)
})

test('a timing in words', () => {
  assert.equal(timingText({ every: 'day', time: '08:00' }), 'Every day at 08:00')
  assert.equal(timingText({ every: 'week', days: [1, 2, 3, 4, 5], time: '07:00' }), 'Weekdays at 07:00')
  assert.equal(timingText({ every: 'week', days: [6, 7], time: '10:00' }), 'Weekends at 10:00')
  assert.equal(timingText({ every: 'week', days: [1] }), 'Every Monday at 08:00')
  assert.equal(timingText({ every: 'week', days: [1, 5] }), 'Mondays and Fridays at 08:00')
  assert.equal(timingText({ every: 'week', days: [1, 3, 5] }), 'Mondays, Wednesdays and Fridays at 08:00')
  assert.equal(timingText({ every: 'week', days: [] }), 'No days picked')
  assert.equal(timingText({ every: 'month', on: { day: 1 } }), 'On the 1st of every month at 08:00')
  assert.equal(timingText({ every: 'month', on: { day: 22 } }), 'On the 22nd of every month at 08:00')
  assert.equal(timingText({ every: 'month', on: { day: 11 } }), 'On the 11th of every month at 08:00')
  assert.equal(timingText({ every: 'month', on: { day: 23 } }), 'On the 23rd of every month at 08:00')
  assert.equal(timingText({ every: 'month', on: { day: 'last' }, time: '23:00' }), 'On the last day of every month at 23:00')
  assert.equal(timingText({ every: 'month', on: { week: 'last', weekday: 5 }, time: '18:00' }), 'On the last Friday of every month at 18:00')
  assert.equal(timingText({ every: 'month', on: { week: 'first', weekday: 1 } }), 'On the first Monday of every month at 08:00')
})

test('how a report is sent', () => {
  assert.deepEqual(normaliseDelivery(null), { in_message: true, attach: 'none', keep_file: false })
  assert.deepEqual(normaliseDelivery({ in_message: false, attach: 'csv', keep_file: true }), { in_message: false, attach: 'csv', keep_file: true })
  // A file is kept only when there is one.
  assert.deepEqual(normaliseDelivery({ attach: 'pdf', keep_file: true }), { in_message: true, attach: 'none', keep_file: false })
  assert.equal(deliveryProblem({ in_message: true }), null)
  assert.equal(deliveryProblem({ in_message: false, attach: 'xlsx' }), null)
  assert.match(deliveryProblem({ in_message: false, attach: 'none' }), /in the email, attach a file, or both/)
  assert.equal(deliveryText({ in_message: true }), 'The report in the email')
  assert.equal(deliveryText({ in_message: false, attach: 'csv' }), 'A CSV file attached')
  assert.equal(deliveryText({ in_message: true, attach: 'xlsx', keep_file: true }), 'The report in the email and an Excel file attached, kept in Past runs')
})

// A summary by venue of net sales (money) and voids (a count), with totals.
const byVenue = (rows, totals) => ({
  kind: 'summary',
  columns: [
    { key: 'r1', label: 'Venue', type: 'text', role: 'row' },
    { key: 'v1', label: 'Net sales', type: 'money', role: 'value' },
    { key: 'v2', label: 'Voids', type: 'number', role: 'value' },
  ],
  rows: rows.map(([name, a, b]) => ({ cells: [name, a, b], kind: 'row', level: 0, k: [name] })),
  totals: totals ? { cells: [null, ...totals] } : null,
  meta: { currency: 'GBP' },
})

test('a condition comes back in one known shape, and its problems are said', () => {
  assert.deepEqual(normaliseCondition(null), { when: 'always' })
  assert.deepEqual(normaliseCondition({ when: 'rows', value: 'v1' }), { when: 'rows' })
  assert.deepEqual(normaliseCondition({ when: 'figure', value: 'v1', op: 'nope', than: '5' }), { when: 'figure', value: 'v1', op: 'over', than: null, scope: 'any' })
  assert.deepEqual(normaliseCondition({ when: 'figure', value: 'v1', op: 'under', than: 0.1 + 0.2, scope: 'total' }), { when: 'figure', value: 'v1', op: 'under', than: 0.3, scope: 'total' })
  const values = [{ key: 'v1', label: 'Net sales', type: 'money' }]
  assert.equal(conditionProblem({ when: 'rows' }, 'list', []), null)
  assert.match(conditionProblem({ when: 'figure', value: 'v1', than: 5 }, 'list', values), /Only a summary/)
  assert.match(conditionProblem({ when: 'figure', value: 'v1', than: 5 }, 'matrix', values), /Only a summary/)
  assert.match(conditionProblem({ when: 'figure', value: 'v9', than: 5 }, 'summary', values), /figures to watch/)
  assert.match(conditionProblem({ when: 'figure', value: 'v1' }, 'summary', values), /figure to compare with/)
  assert.match(conditionProblem({ when: 'figure', value: 'v1', op: 'outside', than: -5 }, 'summary', values), /0 or more/)
  assert.equal(conditionProblem({ when: 'figure', value: 'v1', op: 'outside', than: 5 }, 'summary', values), null)
})

test('whether a run meets its condition', () => {
  const rows = byVenue([['Ware', 1200, 0], ['Hertford', 640, 3]], [1840, 3])
  assert.deepEqual(conditionMet({ when: 'always' }, byVenue([], null)), { met: true, why: null })
  assert.equal(conditionMet({ when: 'rows' }, rows).met, true)
  assert.deepEqual(conditionMet({ when: 'rows' }, byVenue([], null)), { met: false, why: 'There was nothing to report' })
  // A list counts its rows.
  assert.equal(conditionMet({ when: 'rows' }, { kind: 'list', columns: [], rows: [] }).met, false)
  assert.equal(conditionMet({ when: 'rows' }, { kind: 'list', columns: [], rows: [{ cells: [], kind: 'row', k: [] }] }).met, true)
  // A summary with no groupings always has its one row: all zero is nothing.
  const one = cells => ({ kind: 'summary', columns: [{ key: 'v1', label: 'Voids', type: 'number', role: 'value' }], rows: [{ cells, kind: 'row', level: 0, k: [] }], totals: null })
  assert.equal(conditionMet({ when: 'rows' }, one([0])).met, false)
  assert.equal(conditionMet({ when: 'rows' }, one([null])).met, false)
  assert.equal(conditionMet({ when: 'rows' }, one([2])).met, true)
  // Rows only the period before had don't count.
  const compared = {
    kind: 'summary',
    columns: [
      { key: 'r1', label: 'Day', type: 'date', role: 'row' },
      { key: 'v1', label: 'Voids', type: 'number', role: 'value' },
      { key: 'v1__prev', label: 'Before', type: 'number', role: 'compare', of: 'v1' },
      { key: 'v1__chg', label: 'Change', type: 'percent', role: 'change', of: 'v1' },
    ],
    rows: [{ cells: ['2026-11-09', null, 4, -1], kind: 'row', level: 0, k: ['2026-11-09'] }],
    totals: { cells: [null, 0, 4, -1] },
  }
  assert.equal(conditionMet({ when: 'rows' }, compared).met, false)

  // A figure in total.
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'over', than: 1500, scope: 'total' }, rows).met, true)
  assert.deepEqual(conditionMet({ when: 'figure', value: 'v1', op: 'over', than: 2000, scope: 'total' }, rows),
    { met: false, why: 'Net sales was £1,840.00 in total' })
  // The total of a summary with no groupings is its one row.
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'at_least', than: 2, scope: 'total' }, one([2])).met, true)
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'at_least', than: 3, scope: 'total' }, one([2])).met, false)
  // A figure on any row.
  assert.equal(conditionMet({ when: 'figure', value: 'v2', op: 'at_least', than: 3, scope: 'any' }, rows).met, true)
  assert.deepEqual(conditionMet({ when: 'figure', value: 'v2', op: 'over', than: 3, scope: 'any' }, rows),
    { met: false, why: 'No row\'s Voids was over 3' })
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'under', than: 700 }, rows).met, true)
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'at_most', than: 640 }, rows).met, true)
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'at_most', than: 639 }, rows).met, false)
  // Either way: a variance of -60 is more than 50 either way.
  const variance = byVenue([['Ware', -60, 0], ['Hertford', 10, 0]], [-50, 0])
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'outside', than: 50 }, variance).met, true)
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'outside', than: 60 }, variance).met, false)
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'outside', than: 50, scope: 'total' }, variance).met, false)
  // Subtotals and everything else aren't rows of their own.
  const rest = byVenue([['Ware', 100, 0]], [900, 0])
  rest.rows.push({ cells: ['Every other venue', 800, 9], kind: 'rest', level: 0, k: [] })
  rest.rows.push({ cells: [null, 900, 9], kind: 'subtotal', level: 0, k: [] })
  assert.equal(conditionMet({ when: 'figure', value: 'v2', op: 'over', than: 5 }, rest).met, false)
  // A figure the report no longer has.
  assert.deepEqual(conditionMet({ when: 'figure', value: 'v9', op: 'over', than: 1 }, rows),
    { met: false, why: 'The figure it watches isn\'t in the report any more' })
  // An empty cell never passes.
  assert.equal(conditionMet({ when: 'figure', value: 'v1', op: 'under', than: 5 }, byVenue([['Ware', null, 0]], null)).met, false)
})

test('a condition in words', () => {
  assert.equal(conditionText({ when: 'always' }), 'Every time')
  assert.equal(conditionText({ when: 'rows' }), 'Only when there are rows')
  assert.equal(conditionText({ when: 'figure', value: 'v1', op: 'over', than: 1000, scope: 'total' }, { label: 'Net sales', type: 'money' }, 'GBP'),
    'Only when Net sales is over £1,000.00 in total')
  assert.equal(conditionText({ when: 'figure', value: 'v1', op: 'outside', than: 50 }, { label: 'Variance', type: 'money' }, 'GBP'),
    'Only when Variance is more than £50.00 either way on any row')
  assert.equal(conditionText({ when: 'figure', value: 'v1', op: 'at_least', than: 0.3 }, { label: 'Labour share', type: 'percent' }),
    'Only when Labour share is at least 30.0% on any row')
  assert.equal(conditionText({ when: 'figure', value: 'v1', op: 'under' }, { label: 'Covers', type: 'number' }),
    'Only when Covers is under ... on any row')
})

test('who a report is sent to', () => {
  const id = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7'
  assert.deepEqual(normaliseRecipients([
    { user_id: id.toUpperCase() }, { user_id: id }, { email: ' Ana@Example.COM ' }, { email: 'ana@example.com' },
    { email: 'not an address' }, { user_id: 'nope' }, null, 'text',
  ]), [{ user_id: id }, { email: 'ana@example.com' }])
  const many = Array.from({ length: 60 }, (_, i) => ({ email: 'p' + i + '@example.com' }))
  assert.equal(normaliseRecipients(many).length, MAX_RECIPIENTS)
  assert.equal(recipientsProblem([{ email: 'ana@example.com' }]), null)
  assert.equal(recipientsProblem([{ user_id: id }]), null)
  assert.match(recipientsProblem([]), /at least one person/)
  assert.match(recipientsProblem([{ email: 'ana@' }]), /isn't an email address/)
  assert.match(recipientsProblem([{ user_id: 'x' }]), /Pick each person/)
  assert.match(recipientsProblem(many), /50 people at most/)
  assert.equal(isEmail('a.b+c@example.co.uk'), true)
  assert.equal(isEmail('a@b'), false)
  assert.equal(isEmail('a b@example.com'), false)
  assert.equal(isEmail('<a@example.com>'), false)
})

test('a schedule needs a period that moves with the date', () => {
  const spec = newReport('till.checks')
  assert.equal(periodProblem(spec, {}), null)
  assert.equal(periodProblem(spec, { period: { relative: 'yesterday' } }), null)
  assert.match(periodProblem(spec, { period: { from: '2026-11-01', to: '2026-11-07' } }, '2026-11-15'),
    /^The period is fixed \(1 to 7 Nov 2026\), so every email would show the same days/)
  // A report whose own period is fixed needs a moving one chosen for it.
  const fixed = { ...spec, params: spec.params.map(p => (p.type === 'period' ? { ...p, default: { from: '2026-10-01', to: '2026-10-31' } } : p)) }
  assert.match(periodProblem(fixed, {}, '2026-11-15'), /fixed \(Oct 2026\)/)
  assert.equal(periodProblem(fixed, { period: { relative: 'last_month' } }), null)
  // A report with no period at all has nothing to move.
  const undated = newReport('menu.dishes', { dated: false })
  assert.equal(periodProblem(undated, {}), null)
})
