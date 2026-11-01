// Purchasing rules in shared/procurement.js that stop orders changing by
// surprise (1 Nov 2026): minimums and steps (qtyProblem, splitProblem),
// keeping the amount when the pack changes (convertQty), and which
// delivery days a supplier can still make (orderDeadline, deadlineText,
// deliveryDayProblem), checked against nextDeliveryDate() so the two
// never disagree. Step 2 (migration 233): a venue's own days' notice and
// delivery details (supplierForVenue), the slot in words (slotText), Copy
// for checkout (checkoutText), and when an order to send is late
// (deadlinePassed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  qtyProblem, fitQty, splitProblem, convertQty, nextDeliveryDate, orderDeadline, deadlineText, deliveryDayProblem,
  dayText, nowAt, addDays, supplierForVenue, slotText, checkoutText, deadlinePassed,
} from '../procurement.js'

test('qtyProblem keeps its words', () => {
  assert.equal(qtyProblem(10, { min_qty: 20 }), 'Minimum 20')
  assert.equal(qtyProblem(5, { order_multiple: 2 }), 'In steps of 2')
  assert.equal(qtyProblem(20, { min_qty: 20, order_multiple: 5 }), null)
  assert.equal(qtyProblem(0, { min_qty: 20 }), null, 'nothing ordered is never a problem')
  assert.equal(qtyProblem(1.5, { order_multiple: 0.5 }), null)
})

test('splitProblem: both parts of a line must stay orderable', () => {
  const beef = { min_qty: 20 }
  assert.equal(splitProblem(20, 10, beef), '10 left and 10 moved would both be below the minimum of 20')
  assert.equal(splitProblem(40, 20, beef), null)
  assert.equal(splitProblem(30, 20, beef), '10 left would be below the minimum of 20')
  assert.equal(splitProblem(30, 10, beef), '10 moved would be below the minimum of 20')
  assert.equal(splitProblem(20, 20, beef), null, 'moving all of it')
  assert.equal(splitProblem(20, 0, beef), null, 'moving none')
  const pork = { order_multiple: 7 }
  assert.equal(splitProblem(14, 7, pork), null)
  assert.equal(splitProblem(14, 5, pork), "9 left and 5 moved wouldn't be in steps of 7")
  assert.equal(splitProblem(21, 7, { min_qty: 10, order_multiple: 7 }), '7 moved would be below the minimum of 10')
  assert.equal(splitProblem(3, 1, {}), null, 'no minimum or steps')
})

test('splitProblem says which part breaks which rule', () => {
  const q = { min_qty: 10, order_multiple: 2 }
  // 11 left: odd (steps of 2); 3 moved: below 10.
  assert.equal(splitProblem(14, 3, q), "11 left wouldn't be in steps of 2 and 3 moved would be below the minimum of 10")
})

test('convertQty keeps the amount across a pack change', () => {
  const bag5 = { pack_base_qty: 5000 }, bag10 = { pack_base_qty: 10000 }, bag3 = { pack_base_qty: 3000 }
  assert.equal(convertQty(3, bag5, bag10), 2, '15 kg is 2 x 10 kg (at least as much)')
  assert.equal(convertQty(4, bag5, bag10), 2, '20 kg is exactly 2 x 10 kg')
  assert.equal(convertQty(2, bag10, bag5), 4)
  assert.equal(convertQty(3, bag5, bag3), 5, '15 kg is 5 x 3 kg')
  assert.equal(convertQty(3, bag5, { pack_base_qty: 5000, min_qty: 4 }), 4, 'same pack: the count, fitted to the minimum')
  assert.equal(convertQty(3, bag5, { pack_base_qty: 10000, order_multiple: 3 }), 3, 'then the new steps')
  assert.equal(convertQty(1, bag5, { pack_base_qty: 10000, order_multiple: 0.5 }), 0.5, 'half packs where the price allows them')
  assert.equal(convertQty(0, bag5, bag10), 0)
  assert.equal(convertQty(3, {}, bag10), 3, 'an unknown pack keeps the count')
})

const NOW = { date: '2026-11-02', time: '10:00' } // a Monday

test('orderDeadline and deadlineText: lead days before, by the cutoff', () => {
  const jj = { delivery_days: [2, 4], cutoff_time: '18:00:00', lead_days: 1 }
  assert.deepEqual(orderDeadline(jj, '2026-11-03'), { date: '2026-11-02', time: '18:00' })
  assert.equal(deadlineText(jj, '2026-11-03', NOW), 'order by 18:00 today')
  assert.equal(deadlineText(jj, '2026-11-05', NOW), 'order by Wed 4 Nov 18:00')
  assert.equal(deadlineText(jj, '2026-11-04', { date: '2026-11-02' }), 'order by 18:00 tomorrow')
  assert.equal(deadlineText({ lead_days: 2 }, '2026-11-05', NOW), 'order by the end of tomorrow')
  assert.equal(deadlineText({ lead_days: 3 }, '2026-11-07', NOW), 'order by the end of Wed 4 Nov')
  assert.equal(deadlineText({ lead_days: 0 }, '2026-11-02', NOW), 'order by the end of today')
  assert.equal(deadlineText(jj, '2026-11-03'), 'order by Mon 2 Nov 18:00', 'no now: the date')
  assert.equal(dayText('2026-11-04'), 'Wed 4 Nov')
})

test('deliveryDayProblem: past, not a delivery day, too late', () => {
  const jj = { delivery_days: [2, 4], cutoff_time: '18:00', lead_days: 1 }
  assert.deepEqual(deliveryDayProblem(jj, '2026-11-01', NOW, 'JJ'), { code: 'past', message: 'Sun 1 Nov is in the past' })
  assert.deepEqual(deliveryDayProblem(jj, '2026-11-04', NOW, 'JJ'),
    { code: 'not_delivery_day', message: 'JJ doesn\'t deliver on Wednesdays (they deliver Tue, Thu)' })
  assert.equal(deliveryDayProblem(jj, '2026-11-03', NOW, 'JJ'), null, 'before today\'s cutoff')
  assert.deepEqual(deliveryDayProblem(jj, '2026-11-03', { date: '2026-11-02', time: '18:00' }, 'JJ'),
    { code: 'late', message: 'Too late for Tue 3 Nov: JJ\'s cutoff for it was 18:00 today' }, 'at the cutoff it has passed')
  assert.deepEqual(deliveryDayProblem(jj, '2026-11-03', { date: '2026-11-03', time: '07:00' }, 'JJ'),
    { code: 'late', message: 'Too late for Tue 3 Nov: JJ\'s cutoff for it was 18:00 yesterday' })
  assert.deepEqual(deliveryDayProblem({ lead_days: 1 }, '2026-11-02', NOW, 'JJ'),
    { code: 'late', message: 'Too late for Mon 2 Nov: it had to be ordered by the end of yesterday' })
  assert.equal(deliveryDayProblem({ lead_days: 0 }, '2026-11-02', { date: '2026-11-02', time: '23:59' }), null, 'same day, no cutoff')
  assert.equal(deliveryDayProblem({}, '2026-11-09', NOW), null, 'any day when none are listed')
  assert.equal(deliveryDayProblem(jj, null, NOW), null)
})

// The days deliveryDayProblem() accepts are exactly those nextDeliveryDate()
// can reach: its answer is the first one from today without a problem.
test('deliveryDayProblem agrees with nextDeliveryDate', () => {
  const settings = [
    { delivery_days: [2, 4], cutoff_time: '18:00', lead_days: 1 },
    { delivery_days: [], cutoff_time: '11:30', lead_days: 2 },
    { delivery_days: [1, 3, 5], cutoff_time: null, lead_days: 0 },
    { delivery_days: [6], cutoff_time: '09:00', lead_days: 3 },
    { delivery_days: [0, 1, 2, 3, 4, 5, 6], cutoff_time: '23:00', lead_days: 1 },
  ]
  const times = ['00:00', '08:59', '09:00', '11:29', '11:30', '17:59', '18:00', '22:59', '23:00', '23:59']
  for (const s of settings) {
    for (let d = 0; d < 7; d++) {
      for (const time of times) {
        const now = { date: addDays('2026-11-02', d), time }
        const next = nextDeliveryDate(s, now)
        assert.equal(deliveryDayProblem(s, next, now), null, `next delivery ${next} is fine at ${now.date} ${time}`)
        for (let x = now.date; x < next; x = addDays(x, 1)) {
          assert.notEqual(deliveryDayProblem(s, x, now), null, `${x} is before the next delivery ${next}`)
        }
      }
    }
  }
})

test('nowAt reads the venue\'s clock', () => {
  const at = new Date('2026-11-02T23:30:00Z')
  assert.deepEqual(nowAt('Europe/London', at), { date: '2026-11-02', time: '23:30' })
  assert.deepEqual(nowAt('Europe/Warsaw', at), { date: '2026-11-03', time: '00:30' })
  assert.equal(fitQty(10, { min_qty: 20 }), 20)
})

test('supplierForVenue: the venue\'s own notice and delivery details', () => {
  const supplier = { delivery_days: [1, 3], cutoff_time: '18:00', lead_days: 2, account_ref: 'MAIN' }
  const plain = supplierForVenue(supplier, null)
  assert.equal(plain.lead_days, 2)
  assert.equal(plain.delivery_phone, null)
  assert.equal(plain.driver_instructions, null)
  assert.equal(plain.slot_from, null)
  const own = supplierForVenue(supplier, {
    lead_days: 0, delivery_phone: '07700 900123', driver_instructions: 'Back door',
    slot_from: '07:00:00', slot_to: '10:30:00', account_ref: 'WARE',
  })
  assert.equal(own.lead_days, 0, 'a venue\'s 0 days is kept, not the supplier\'s 2')
  assert.equal(own.account_ref, 'WARE')
  assert.equal(own.delivery_phone, '07700 900123')
  assert.equal(own.driver_instructions, 'Back door')
  assert.equal(own.slot_from, '07:00', 'times read as HH:MM')
  assert.equal(own.slot_to, '10:30')
  assert.equal(supplierForVenue(supplier, { lead_days: null }).lead_days, 2, 'no notice of its own: the supplier\'s')
  // The venue's notice moves the first day it can have.
  const now = { date: '2026-11-02', time: '09:00' } // a Monday
  assert.equal(nextDeliveryDate(supplierForVenue({ lead_days: 1 }, null), now), '2026-11-03')
  assert.equal(nextDeliveryDate(supplierForVenue({ lead_days: 1 }, { lead_days: 3 }), now), '2026-11-05')
})

test('slotText says the slot in words', () => {
  assert.equal(slotText({ slot_from: '07:00:00', slot_to: '10:00:00' }), '07:00-10:00')
  assert.equal(slotText({ slot_from: '07:00' }), 'from 07:00')
  assert.equal(slotText({ slot_to: '10:00' }), 'by 10:00')
  assert.equal(slotText({}), null)
  assert.equal(slotText(), null)
})

test('checkoutText: one line each, the note before the instructions, the venue\'s phone as a fallback', () => {
  const venue = { name: 'Ware', address_line1: '12 Mill Lane', city: 'Ware', postcode: 'SG12 9AA', phone: '01920 000111' }
  const po = {
    number: 12, delivery_date: '2026-11-03', account_ref: 'JJ-555', delivery_phone: '07700 900123',
    driver_instructions: 'Back door', notes: null, slot_from: '07:00', slot_to: '10:00',
  }
  assert.equal(checkoutText(po, venue), [
    'Account: JJ-555',
    'Deliver to: Ware, 12 Mill Lane, Ware, SG12 9AA',
    'Delivery: Tue 3 Nov, 07:00-10:00',
    'Phone: 07700 900123',
    'Instructions: Back door',
    'Our order: PO-00012',
  ].join('\n'))
  const plain = checkoutText({ ...po, notes: 'Ring first', delivery_phone: null, slot_from: null, slot_to: null, account_ref: null }, venue)
  assert.match(plain, /^Deliver to: /, 'no account: the line is left out')
  assert.match(plain, /Delivery: Tue 3 Nov\n/, 'no slot: just the day')
  assert.match(plain, /Phone: 01920 000111/, 'no delivery phone: the venue\'s own')
  assert.match(plain, /Instructions: Ring first/, 'the order\'s note wins')
  assert.equal(checkoutText({ number: 1 }, {}), 'Our order: PO-00001', 'nothing else known: just our number')
})

test('deadlinePassed: from the cutoff minute on the deadline day; the whole day without a cutoff', () => {
  const s = { cutoff_time: '18:00', lead_days: 1 }
  assert.equal(deadlinePassed(s, '2026-11-03', { date: '2026-11-02', time: '17:59' }), false)
  assert.equal(deadlinePassed(s, '2026-11-03', { date: '2026-11-02', time: '18:00' }), true, 'the cutoff minute itself has passed')
  assert.equal(deadlinePassed(s, '2026-11-03', { date: '2026-11-03', time: '06:00' }), true, 'the day after the deadline')
  assert.equal(deadlinePassed(s, '2026-11-05', { date: '2026-11-02', time: '23:00' }), false, 'a later day is fine')
  const noCutoff = { cutoff_time: null, lead_days: 1 }
  assert.equal(deadlinePassed(noCutoff, '2026-11-03', { date: '2026-11-02', time: '23:59' }), false, 'all of the deadline day')
  assert.equal(deadlinePassed(noCutoff, '2026-11-03', { date: '2026-11-03', time: '00:00' }), true)
  assert.equal(deadlinePassed(s, null, { date: '2026-11-02', time: '12:00' }), false, 'no day: nothing to be late for')
  // The same rule as the late problem.
  for (const time of ['00:00', '17:59', '18:00', '23:59']) {
    const now = { date: '2026-11-02', time }
    assert.equal(deliveryDayProblem(s, '2026-11-03', now)?.code === 'late', deadlinePassed(s, '2026-11-03', now), time)
  }
})
