// shared/forecast.js (inventory phase 9a, docs/INVENTORY.md 9): the forecast
// from the same weekdays over four weeks, scaled by covers booked against the
// usual by the same point; the fallback to an average day and to the par;
// the suggested order to the delivery after next with the buffer, on hand
// and on order taken off, rounded to packs, the minimum and the steps. Every
// date is pinned: 1 Dec 2026 is a Tuesday.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  historyDays, deliveryAfter, windowDays, bookedCovers, coversFactor, weekdayUsage, hasHistory, forecastDay, forecastUsage,
  suggestedOrder, bufferPct, bufferProblem, quantityWords, BUFFER_PCT_DEFAULT, FORECAST_WEEKS, SUGGEST_BASES,
} from '../forecast.js'
import { addDays, weekdayOf, fitQty } from '../procurement.js'

const TODAY = '2026-12-01'
const marked = historyDays(TODAY)
// Chicken in grams: Tuesdays 6 kg and 6.4 kg in turn, Wednesdays 4.1 kg, every other day 3 kg.
const usage = Object.fromEntries(marked.map((d, i) => {
  const wd = weekdayOf(d)
  return [d, wd === 2 ? (i % 14 < 7 ? 6000 : 6400) : wd === 3 ? 4100 : 3000]
}))
const chicken = { marked, usage }
const caseOf5 = { id: 'q1', pack_name: 'Case', pack_count: 1, pack_qty: 5, pack_unit: 'kg', pack_base_qty: 5000, min_qty: 0, order_multiple: 0 }

test('the forecast looks back over four weeks of trading days before today', () => {
  assert.equal(FORECAST_WEEKS, 4)
  assert.equal(marked.length, 28)
  assert.equal(marked[0], '2026-11-03')
  assert.equal(marked[27], '2026-11-30')
  assert.ok(!marked.includes(TODAY), 'today is not history: it is still being traded')
  assert.equal(weekdayOf(TODAY), 2, '1 Dec 2026 is a Tuesday')
})

test('an item uses on a weekday the average of the same weekdays worked out', () => {
  const tue = weekdayUsage(chicken, 2)
  assert.deepEqual(tue, { qty: 6200, days: 4, how: 'weekday' })
  assert.equal(weekdayUsage(chicken, 3).qty, 4100)
  // A day worked out with nothing taken off the item counts as none.
  const someTuesdaysNone = { marked, usage: { ...usage, '2026-11-10': 0, '2026-11-17': 0 } }
  assert.equal(weekdayUsage(someTuesdaysNone, 2).qty, 3100, '(6000 + 0 + 0 + 6400) / 4')
  // A weekday never worked out takes the average of the days that were.
  const mondaysOnly = { marked: marked.filter(d => weekdayOf(d) === 1), usage }
  const w = weekdayUsage(mondaysOnly, 2)
  assert.equal(w.how, 'average_day')
  assert.equal(w.qty, 3000)
  assert.equal(weekdayUsage({ marked: [], usage: {} }, 2), null, 'nothing worked out: no figure at all')
})

test('covers booked scale the day: more, fewer, as usual, held between half and twice, none for few bookings', () => {
  const more = coversFactor({ booked: 47.2, usual: 40 })
  assert.equal(more.pct, 18)
  assert.equal(more.factor, 1.18)
  assert.equal(more.words, '18% more covers booked')
  assert.equal(coversFactor({ booked: 34, usual: 40 }).words, '15% fewer covers booked')
  assert.equal(coversFactor({ booked: 40, usual: 40 }).words, 'as many covers booked as usual')
  const low = coversFactor({ booked: 10, usual: 40 })
  assert.equal(low.factor, 0.5)
  assert.ok(low.held)
  assert.match(low.words, /75% fewer covers booked \(counted as half the usual at least\)/)
  assert.equal(coversFactor({ booked: 200, usual: 40 }).factor, 2)
  // A venue that takes few bookings, or none, isn't scaled.
  assert.deepEqual(coversFactor({ booked: 12, usual: 2 }), { factor: 1, pct: null, scaled: false, held: false, words: null })
  assert.equal(coversFactor({ booked: 0, usual: null }).factor, 1)
  assert.equal(coversFactor().factor, 1)
})

test('covers are compared by the same point: booked so far against what had been booked as far ahead', () => {
  const now = '2026-12-01T12:00:00Z'
  const b = (day, covers, created) => ({ day, covers, created_at: created })
  const bookings = [
    // Tuesday 8 Dec, a week off: 47 covers booked so far.
    b('2026-12-08', 40, '2026-11-25T10:00:00Z'), b('2026-12-08', 7, '2026-12-01T09:00:00Z'),
    // The four Tuesdays before it: what had been booked a week before each.
    b('2026-12-01', 30, '2026-11-20T10:00:00Z'), b('2026-12-01', 25, '2026-11-30T10:00:00Z'),   // the second came later
    b('2026-11-24', 44, '2026-11-10T10:00:00Z'),
    b('2026-11-17', 42, '2026-11-01T10:00:00Z'), b('2026-11-17', 8, '2026-11-16T10:00:00Z'),    // the 8 came later
    b('2026-11-10', 44, '2026-11-02T10:00:00Z'),
  ]
  const c = bookedCovers(bookings, { days: ['2026-12-08', '2026-12-09'], now })
  assert.deepEqual(c.get('2026-12-08'), { booked: 47, usual: 40 }, '(30 + 44 + 42 + 44) / 4')
  assert.equal(coversFactor(c.get('2026-12-08')).words, '18% more covers booked')
  assert.deepEqual(c.get('2026-12-09'), { booked: 0, usual: null }, 'no Wednesdays were booked: nothing to compare')
})

test("one day's forecast: the weekday's use, scaled, and today's rest after what sales took off so far", () => {
  const d = forecastDay({ history: chicken, day: '2026-12-08', covers: { booked: 47.2, usual: 40 }, unit: 'g' })
  assert.equal(d.qty, 7316, '6.2 kg x 1.18')
  assert.equal(d.rest, 7316)
  assert.equal(d.summary, 'Tuesdays use 6.2 kg; 18% more covers booked')
  assert.equal(d.words, 'Tue 8 Dec: Tuesdays use 6.2 kg; 18% more covers booked: 7.3 kg')
  const today = forecastDay({ history: chicken, day: TODAY, used: 4000, unit: 'g', today: true })
  assert.equal(today.qty, 6200)
  assert.equal(today.rest, 2200)
  assert.equal(today.words, 'Today (Tue 1 Dec): Tuesdays use 6.2 kg: 6.2 kg, 4 kg used so far, 2.2 kg left')
  assert.equal(forecastDay({ history: chicken, day: TODAY, used: 9000, unit: 'g' }).rest, 0, 'more used than forecast: none left, never below')
})

test('the forecast over a window adds the days up; an item sales never used has no history', () => {
  const days = windowDays(TODAY, '2026-12-04')
  assert.deepEqual(days, ['2026-12-01', '2026-12-02', '2026-12-03'])
  const f = forecastUsage({ history: chicken, unit: 'g', todayDay: TODAY, days: days.map(d => ({ day: d, used: d === TODAY ? 1200 : null })) })
  assert.ok(f.has_history)
  assert.equal(f.total, 5000 + 4100 + 3000, "today's 6.2 kg less 1.2 kg used, then Wednesday's and Thursday's")
  assert.equal(f.days.length, 3)
  assert.equal(f.summary, 'Wednesdays use 4.1 kg', 'the summary names the first whole day')
  const none = forecastUsage({ history: { marked, usage: {} }, days: [{ day: TODAY }], unit: 'g' })
  assert.equal(none.has_history, false)
  assert.equal(none.total, null)
  assert.ok(!hasHistory({ marked: [], usage: { [TODAY]: 5 } }), 'a day the job never worked out is no history')
})

test('the suggested order: forecast and buffer, less on hand and on order, in whole packs to the minimum and steps', () => {
  const forecast = forecastUsage({ history: chicken, unit: 'g', days: [{ day: '2026-12-08' }, { day: '2026-12-09' }, { day: '2026-12-10' }] })
  assert.equal(forecast.total, 6200 + 4100 + 3000)
  const s = suggestedOrder({ forecast, stock: { on_hand: 5000, on_order: 2000 }, quote: caseOf5, buffer_pct: 10, unit: 'g', after: '2026-12-11' })
  assert.equal(s.basis, 'forecast')
  assert.equal(s.buffer_base, 1330)
  assert.equal(s.target_base, 14630)
  assert.equal(s.need_base, 7630)
  assert.equal(s.qty, 2, '7.63 kg is 1.53 cases: 2')
  assert.equal(s.suggested_base, 10000)
  assert.equal(s.raised, null)
  assert.match(s.summary, /^13.3 kg forecast to Fri 11 Dec \(Tuesdays use 6.2 kg\): 7.6 kg needed, 2 x Case · 5 kg$/)
  assert.ok(s.words.some(w => w === 'Plus a 10% buffer: 1.3 kg, 14.6 kg in all.'))
  assert.ok(s.words.some(w => w === 'On order 2 kg, arriving before then.'))
  // Up to the minimum, and in steps: the same rounding as Fill to par (fitQty()).
  const min = suggestedOrder({ forecast, stock: { on_hand: 5000, on_order: 2000 }, quote: { ...caseOf5, min_qty: 3 }, unit: 'g' })
  assert.equal(min.qty, 3)
  assert.deepEqual(min.raised, { kind: 'min', value: 3 })
  assert.ok(min.words.at(-1).endsWith(', the minimum of 3.'))
  const steps = suggestedOrder({ forecast, stock: { on_hand: 5000, on_order: 2000 }, quote: { ...caseOf5, order_multiple: 4 }, unit: 'g' })
  assert.equal(steps.qty, 4)
  assert.deepEqual(steps.raised, { kind: 'step', value: 4 })
  assert.equal(steps.qty, fitQty(2, { ...caseOf5, order_multiple: 4 }))
  // Enough on hand and on order: nothing.
  const enough = suggestedOrder({ forecast, stock: { on_hand: 20000, on_order: 0 }, quote: caseOf5, unit: 'g' })
  assert.equal(enough.qty, 0)
  assert.match(enough.summary, /on hand and on order cover it$/)
  // Never counted: nothing on hand is taken off, and it says so.
  const uncounted = suggestedOrder({ forecast, stock: { on_hand: null, on_order: 0 }, quote: caseOf5, buffer_pct: 0, unit: 'g' })
  assert.equal(uncounted.qty, 3, '13.3 kg with no buffer: 3 cases')
  assert.ok(uncounted.words.includes('Never counted here: nothing on hand is taken off.'))
  // Below zero on hand (a missed delivery) counts as none, as up to par does.
  assert.equal(suggestedOrder({ forecast, stock: { on_hand: -3000 }, quote: caseOf5, buffer_pct: 0, unit: 'g' }).qty, 3)
})

test('no sales history falls back to the par; no par either: nothing is suggested', () => {
  const forecast = forecastUsage({ history: { marked, usage: {} }, days: [{ day: TODAY }], unit: 'g' })
  const par = suggestedOrder({ forecast, par_base: 12000, stock: { on_hand: 3000, on_order: 0 }, quote: caseOf5, unit: 'g' })
  assert.equal(par.basis, 'par')
  assert.equal(par.target_base, 12000)
  assert.equal(par.buffer_base, 0, 'the par is the target: no buffer on top')
  assert.equal(par.qty, 2, '9 kg short of par: 2 cases')
  assert.match(par.summary, /^Up to par 12 kg \(no sales use in 4 weeks\): 9 kg needed, 2 x Case · 5 kg$/)
  const none = suggestedOrder({ forecast, par_base: null, stock: { on_hand: 3000 }, quote: caseOf5, unit: 'g' })
  assert.equal(none.basis, 'none')
  assert.equal(none.qty, null)
  assert.ok(SUGGEST_BASES[none.basis])
})

test('the delivery after next is the supplier\'s next delivery day after it; any day when it lists none', () => {
  // Delivers Tuesdays and Fridays: after Friday 4 Dec comes Tuesday 8 Dec.
  assert.equal(deliveryAfter({ delivery_days: [2, 5] }, '2026-12-04'), '2026-12-08')
  assert.equal(deliveryAfter({ delivery_days: [2, 5] }, '2026-12-08'), '2026-12-11')
  assert.equal(deliveryAfter({ delivery_days: [] }, '2026-12-04'), '2026-12-05')
  assert.equal(deliveryAfter({}, null), null)
  assert.deepEqual(windowDays(TODAY, TODAY), [TODAY], 'at least today')
  assert.equal(windowDays(TODAY, addDays(TODAY, 300)).length, 62, 'held to two months')
})

test('the buffer, and quantities in words', () => {
  assert.equal(BUFFER_PCT_DEFAULT, 10)
  assert.equal(bufferPct(null), 10)
  assert.equal(bufferPct(0), 0)
  assert.equal(bufferPct(25), 25)
  assert.equal(bufferPct(500), 10)
  assert.equal(bufferProblem(15), null)
  assert.match(bufferProblem(-1), /0 to 200/)
  assert.match(bufferProblem('x'), /percentage/)
  assert.equal(quantityWords(6234, 'g'), '6.2 kg')
  assert.equal(quantityWords(350, 'g'), '350 g')
  assert.equal(quantityWords(1500, 'ml'), '1.5 l')
  assert.equal(quantityWords(2.25, 'each'), '2.3 each')
})
