// Purchasing rules in shared/procurement.js that stop orders changing by
// surprise (1 Nov 2026): minimums and steps (qtyProblem, splitProblem),
// keeping the amount when the pack changes (convertQty), and which
// delivery days a supplier can still make (orderDeadline, deadlineText,
// deliveryDayProblem), checked against nextDeliveryDate() so the two
// never disagree. Step 2 (migration 233): a venue's own days' notice and
// delivery details (supplierForVenue), the slot in words (slotText), Copy
// for checkout (checkoutText), and when an order to send is late
// (deadlinePassed). Step 3: the supplier's quick order (quickOrder,
// quickOrderCsv). Step 4: a supplier's basket read from text or a sheet
// and compared with an order (basketFromText, basketFromSheet,
// mergeBasket, basketDiff), and a supplier price out of stock until a
// date (outOfStock, outOfStockText, migration 234).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  qtyProblem, fitQty, splitProblem, convertQty, nextDeliveryDate, orderDeadline, deadlineText, deliveryDayProblem,
  dayText, nowAt, addDays, supplierForVenue, slotText, checkoutText, deadlinePassed, quickOrder, quickOrderCsv,
  basketFromText, basketFromSheet, mergeBasket, basketDiff, outOfStock, outOfStockText,
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

test('quickOrder: CODE:QTY per code, the same code once, lines without a code apart', () => {
  const q = quickOrder([
    { code: 'MEA161', name: 'Chicken thigh', qty: 20 },
    { code: ' POR106 ', name: 'Pork belly', qty: 7 },
    { code: 'mea161', name: 'Chicken thigh (2nd line)', qty: 2.5 },
    { code: '', name: 'Napkins', qty: 3 },
    { code: null, name: 'Gloves', qty: 1 },
    { code: 'ZERO1', name: 'Taken off', qty: 0 },
    { code: 'NEG1', name: 'Odd', qty: -2 },
    { code: 'NAN1', name: 'Odd too', qty: 'x' },
  ])
  assert.equal(q.text, 'MEA161:22.5,POR106:7', 'merged without regard to case, first spelling kept, trimmed')
  assert.deepEqual(q.coded.map(l => [l.code, l.name, l.qty]), [['MEA161', 'Chicken thigh', 22.5], ['POR106', 'Pork belly', 7]])
  assert.deepEqual(q.noCode, [{ name: 'Napkins', qty: 3 }, { name: 'Gloves', qty: 1 }])
  assert.equal(quickOrder([{ code: 'A1', qty: 1 }, { code: 'B2', qty: 2 }], { sep: '\n' }).text, 'A1:1\nB2:2')
  assert.equal(quickOrder([]).text, '')
  assert.equal(quickOrder(null).text, '')
  // Several small additions stay exact.
  assert.equal(quickOrder([{ code: 'R', qty: 0.1 }, { code: 'R', qty: 0.2 }]).text, 'R:0.3')
})

test('quickOrderCsv: a heading, one row per code, safe for spreadsheets', () => {
  const csv = quickOrderCsv([
    { code: 'MEA161', name: 'Chicken thigh, boneless', qty: 20 },
    { code: 'POR106', name: 'The "best" belly', qty: 7 },
    { code: '=HYPERLINK(1)', name: '@SUM(A1)', qty: 1 },
    { code: '', name: 'Napkins', qty: 3 },
    { code: 'mea161', name: 'again', qty: 1 },
  ])
  assert.equal(csv, 'code,name,qty\r\n' +
    'MEA161,"Chicken thigh, boneless",21\r\n' +
    'POR106,"The ""best"" belly",7\r\n' +
    "'=HYPERLINK(1),'@SUM(A1),1\r\n")
  assert.equal(quickOrderCsv([]), 'code,name,qty\r\n', 'just the heading when no line has a code')
})

test('basketFromText reads the quick order and the usual ways of writing a code and a quantity', () => {
  const read = t => basketFromText(t).rows.map(r => (r.error ? ['!', r.code ?? null] : [r.code, r.qty]))
  assert.deepEqual(read('MEA161:20,POR106:7'), [['MEA161', 20], ['POR106', 7]], 'our own quick order')
  assert.deepEqual(read('MEA161:20;POR106:7'), [['MEA161', 20], ['POR106', 7]])
  assert.deepEqual(read('MEA161:20\nPOR106:7.5\n\n'), [['MEA161', 20], ['POR106', 7.5]], 'one a line, blank lines skipped')
  assert.deepEqual(read('BF-RICE, 3'), [['BF-RICE', 3]], 'a CSV line without headings')
  assert.deepEqual(read('MEA161\t4'), [['MEA161', 4]], 'pasted from a spreadsheet')
  assert.deepEqual(read('MEA161 x 20'), [['MEA161', 20]])
  assert.deepEqual(read('MEA161 x20'), [['MEA161', 20]])
  assert.deepEqual(read('MEA161 = 2.5'), [['MEA161', 2.5]])
  assert.deepEqual(read('20 x MEA161'), [['MEA161', 20]], 'the quantity first, with an x')
  assert.deepEqual(read('20x MEA161'), [['MEA161', 20]])
  assert.deepEqual(read('BOX 20'), [['BOX', 20]], 'an X inside a code is not a times sign')
  assert.deepEqual(read('BF 1234 20'), [['BF 1234', 20]], 'a code with a space, the quantity last')
  assert.deepEqual(read('4 x XYZ 9'), [['XYZ 9', 4]], 'N x before a code with a number in it')
  assert.deepEqual(read('12345 6'), [['12345', 6]], 'a number code then a quantity')
  assert.deepEqual(read('"Q1";5'), [['Q1', 5]], 'quotes round a code')
  // Two numbers either side of an x, and lines with no quantity, are refused, never guessed.
  assert.deepEqual(read('12345 x 6\n6 x 12345\n2X4'), [['!', null], ['!', null], ['!', null]])
  const bad = basketFromText('MEA161\nPOR106:7')
  assert.deepEqual(bad.rows[0], { row: 1, code: 'MEA161', error: "Couldn't read a code and a quantity", text: 'MEA161' })
  assert.deepEqual(bad.rows[1], { row: 2, code: 'POR106', qty: 7 }, 'row is the line number')
  assert.equal(basketFromText('12345 x 6').rows[0].text, '12345 x 6', 'what was written comes back with the reason')
  assert.deepEqual(basketFromText('').rows, [])
  assert.deepEqual(basketFromText(null).rows, [])
})

test('basketFromText and basketFromSheet: CSV with headings, in any order, quoted, with a name', () => {
  const text = 'Description,Qty,Product code,Price\n"Chicken thigh, boneless",20,MEA161,45.00\nPork belly,7,POR106,30\n,,,\nRice,x,RICE1,9\nNapkins,3,,1'
  const { rows } = basketFromText(text)
  assert.deepEqual(rows[0], { row: 2, code: 'MEA161', qty: 20, name: 'Chicken thigh, boneless' })
  assert.deepEqual(rows[1], { row: 3, code: 'POR106', qty: 7, name: 'Pork belly' })
  assert.equal(rows.length, 4, 'the empty row is skipped')
  assert.equal(rows[2].row, 5)
  assert.equal(rows[2].error, 'Quantity missing or not a number')
  assert.equal(rows[2].code, 'RICE1')
  assert.equal(rows[3].error, 'No code')
  // Semicolons and tabs as the separator.
  assert.deepEqual(basketFromText('Code;Quantity\nA1;2').rows, [{ row: 2, code: 'A1', qty: 2 }])
  assert.deepEqual(basketFromText('SKU\tUnits\nA1\t2').rows, [{ row: 2, code: 'A1', qty: 2 }])
  // Three columns or more without headings: a code then a quantity, else said once.
  assert.deepEqual(basketFromText('A1\t2\tRice\nB2\t3\tOil').rows, [{ row: 1, code: 'A1', qty: 2 }, { row: 2, code: 'B2', qty: 3 }])
  assert.match(basketFromText('A1,Rice,2\nB2,Oil,3').error, /No code and quantity columns/)
  assert.match(basketFromText('Supplier,Total\nBrakes,2').error, /No code and quantity columns/, 'headings for something else')
  assert.deepEqual(basketFromText('A1,2\nB2,3').rows.map(r => r.code), ['A1', 'B2'], 'a code and a quantity a line is not headings')
  assert.equal(basketFromText('A1:2,B2:3,C3:4').rows.length, 3, 'code:qty pairs are never read as columns')
  // A sheet without headings: a code then a quantity.
  assert.deepEqual(basketFromSheet([['A1', 2], ['B2', '3.5'], ['', '']]).rows,
    [{ row: 1, code: 'A1', qty: 2 }, { row: 2, code: 'B2', qty: 3.5 }])
  // Headings that name neither column: another layout, said once.
  assert.match(basketFromSheet([['Supplier', 'Total'], ['X', 2]]).error, /No code and quantity columns/)
  assert.match(basketFromSheet([['Code', 'Price'], ['X', 2]]).error, /No code and quantity columns/)
  assert.match(basketFromSheet([['Description', 2], ['MEA161', 3]]).error, /No code and quantity columns/,
    'a first row naming a column is headings, even with a number beside it')
  // Leading empty rows are skipped before the headings.
  assert.deepEqual(basketFromSheet([[], ['', ''], ['Code', 'Qty'], ['A1', 1]]).rows, [{ row: 4, code: 'A1', qty: 1 }])
  assert.deepEqual(basketFromSheet([]).rows, [])
})

test('mergeBasket adds up a code that comes twice and keeps the errors apart', () => {
  const m = mergeBasket([
    { row: 1, code: 'MEA161', qty: 20 },
    { row: 2, code: 'mea161 ', qty: 2.5 },
    { row: 3, code: 'POR106', qty: 0 },
    { row: 4, code: 'X', error: 'nope' },
  ].map(r => (r.code && !r.error ? { ...r, code: r.code.trim() } : r)))
  assert.deepEqual(m.lines, [
    { code: 'MEA161', qty: 22.5, rows: [1, 2], name: null },
    { code: 'POR106', qty: 0, rows: [3], name: null },
  ])
  assert.deepEqual(m.errors, [{ row: 4, code: 'X', error: 'nope' }])
  assert.deepEqual(mergeBasket([{ row: 1, code: 'R', qty: 0.1 }, { row: 2, code: 'R', qty: 0.2 }]).lines[0].qty, 0.3)
})

test('basketDiff: added, changed, taken off, unknown, switched off, on two products', () => {
  const S = 'sup-1', OTHER = 'sup-2'
  const pack = { pack_name: 'Case', pack_count: 1, pack_qty: 5, pack_unit: 'kg' }
  const quotes = [
    { id: 'q1', item_id: 'i1', item_name: 'Chicken thigh', supplier_code: 'MEA161', live: true, ...pack },
    { id: 'q2', item_id: 'i2', item_name: 'Pork belly', supplier_code: 'POR106', live: true, ...pack, min_qty: 2 },
    { id: 'q3', item_id: 'i3', item_name: 'Rice', supplier_code: 'RICE1', live: true, ...pack, order_multiple: 2 },
    { id: 'q4', item_id: 'i4', item_name: 'Old oil', supplier_code: 'OIL9', live: false, ...pack },
    { id: 'q5', item_id: 'i5', item_name: 'Salt', supplier_code: 'DUP1', live: true, ...pack },
    { id: 'q6', item_id: 'i6', item_name: 'Sea salt', supplier_code: 'dup1', live: true, ...pack },
    { id: 'q7', item_id: 'i7', item_name: 'Flour', supplier_code: 'FLR1', live: true, ...pack },
    { id: 'q8', item_id: 'i8', item_name: 'Sugar', supplier_code: 'SUG1', live: true, ...pack },
    { id: 'q9', item_id: 'i1', item_name: 'Chicken thigh', supplier_code: 'MEA162', live: true, ...pack, pack_qty: 10 },
    { id: 'q10', item_id: 'i10', item_name: 'Eggs', supplier_code: 'EGG1', live: true, ...pack },
  ]
  const ours = id => ({ ...quotes.find(q => q.id === id), supplier_id: S, supplier_name: 'Bidfood' })
  const lines = [
    { item_id: 'i2', item_name: 'Pork belly', qty: 1, quote: ours('q2') },             // qty changes
    { item_id: 'i7', item_name: 'Flour', qty: 4, quote: ours('q7') },                  // the same
    { item_id: 'i8', item_name: 'Sugar', qty: 3, quote: ours('q8') },                  // not in the basket: taken off
    { item_id: 'i3', item_name: 'Rice', qty: 2, quote: { id: 'qx', supplier_id: OTHER, supplier_name: 'Brakes', supplier_code: 'BR-R', ...pack } },
    { item_id: 'i9', item_name: 'Butter', qty: 1, quote: { id: 'qy', supplier_id: OTHER, supplier_name: 'Brakes', supplier_code: 'BUT', ...pack } },
    { item_id: 'i10', item_name: 'Eggs', qty: 6, quote: ours('q10') },                 // 0 in the basket: taken off
    { item_id: 'i11', item_name: 'Cups', qty: 0, quote: ours('q8') },                  // no quantity: ignored
  ]
  const basket = mergeBasket([
    { row: 1, code: 'MEA161', qty: 20 }, { row: 2, code: 'por106', qty: 1.5 }, { row: 3, code: 'RICE1', qty: 3 },
    { row: 4, code: 'OIL9', qty: 1 }, { row: 5, code: 'DUP1', qty: 1 }, { row: 6, code: 'NEW1', qty: 4, name: 'Mystery' },
    { row: 7, code: 'FLR1', qty: 4 }, { row: 8, code: 'MEA162', qty: 1 }, { row: 9, code: 'EGG1', qty: 0 },
  ]).lines
  const d = basketDiff({ basket, quotes, lines, supplierId: S })
  assert.deepEqual(d.added.map(a => [a.code, a.item_id, a.quote_id, a.qty, a.qty_problem ?? null]), [['MEA161', 'i1', 'q1', 20, null]])
  assert.equal(d.added[0].pack, 'Case \u00b7 5 kg')
  assert.deepEqual(d.changed.map(c => [c.code, c.item_id, c.from_qty, c.qty, c.basket_qty ?? null, c.qty_problem ?? null, c.from?.supplier_name ?? null]), [
    ['POR106', 'i2', 1, 2, 1.5, 'Minimum 2', null],     // the supplier's spelling; up to the minimum, as placing does
    ['RICE1', 'i3', 2, 4, 3, 'In steps of 2', 'Brakes'], // moves from another supplier's price, in steps of 2
  ])
  assert.deepEqual(d.changed[1].from, { supplier_name: 'Brakes', code: 'BR-R', pack: 'Case \u00b7 5 kg' })
  assert.deepEqual(d.removed.map(r => [r.item_id, r.qty]), [['i10', 6], ['i8', 3]], 'taken off by a 0, then missing from the basket')
  assert.equal(d.unchanged, 1)
  assert.ok(!('basket_qty' in d.added[0]), 'a quantity that fits says nothing more')
  // A basket quantity that rounds up to what the line has already is no change.
  const same = basketDiff({ basket: mergeBasket([{ row: 1, code: 'POR106', qty: 1.2 }]).lines, quotes, supplierId: S,
    lines: [{ item_id: 'i2', item_name: 'Pork belly', qty: 2, quote: ours('q2') }] })
  assert.equal(same.unchanged, 1)
  assert.equal(same.changed.length, 0)
  assert.deepEqual(d.unknown, [{ rows: [6], code: 'NEW1', qty: 4, name: 'Mystery' }])
  assert.deepEqual(d.switched_off, [{ rows: [4], code: 'OIL9', item_name: 'Old oil' }])
  assert.deepEqual(d.ambiguous, [{ rows: [5], code: 'DUP1', items: ['Salt', 'Sea salt'] }])
  assert.equal(d.errors.length, 1, 'a second code for the same item')
  assert.match(d.errors[0].error, /MEA161 is Chicken thigh too/)
  assert.deepEqual(d.errors[0].rows, [8])
  // Butter is another supplier's: never taken off by this basket.
  assert.ok(!d.removed.some(r => r.item_id === 'i9'))
  // Keeping lines the basket doesn't have.
  const keep = basketDiff({ basket, quotes, lines, supplierId: S, removeMissing: false })
  assert.deepEqual(keep.removed.map(r => r.item_id), ['i10'], 'only what the basket sets to 0')
  // A line on a switched-off price of this supplier: the basket's code moves it to the live price.
  const gone = basketDiff({
    basket: mergeBasket([{ row: 1, code: 'MEA161', qty: 2 }]).lines, quotes, supplierId: S,
    lines: [{ item_id: 'i1', item_name: 'Chicken thigh', qty: 5, quote: { ...ours('q1'), id: 'q-old', supplier_code: 'MEA161' } }],
  })
  assert.deepEqual(gone.changed.map(c => [c.quote_id, c.from_qty, c.qty]), [['q1', 5, 2]])
  // An empty basket takes every line of this supplier off, and only those.
  const empty = basketDiff({ basket: [], quotes, lines, supplierId: S })
  assert.deepEqual(empty.removed.map(r => r.item_id).sort(), ['i10', 'i2', 'i7', 'i8'])
})

test('outOfStock: the date is the first day it can be delivered again', () => {
  const q = { out_of_stock_until: '2026-11-10', out_of_stock_note: 'Depot fire' }
  assert.deepEqual(outOfStock(q, '2026-11-09'), { until: '2026-11-10', note: 'Depot fire' })
  assert.equal(outOfStock(q, '2026-11-10'), null, 'back on the day itself')
  assert.equal(outOfStock(q, '2026-11-20'), null)
  assert.equal(outOfStock(q, null), null, 'no day to judge')
  assert.equal(outOfStock({}, '2026-11-01'), null, 'nothing set')
  assert.equal(outOfStock(null, '2026-11-01'), null)
  assert.deepEqual(outOfStock({ out_of_stock_until: '2026-11-10' }, '2026-11-01'), { until: '2026-11-10', note: null })
  // A timestamp-shaped value (a date column read without ::text) still compares by its day.
  assert.deepEqual(outOfStock({ out_of_stock_until: '2026-11-10T00:00:00.000Z' }, '2026-11-09T12:00'), { until: '2026-11-10', note: null })
  assert.equal(outOfStockText(q, '2026-11-03', 'Brakes'), 'Out of stock at Brakes until Tue 10 Nov')
  assert.equal(outOfStockText(q, '2026-11-03'), 'Out of stock until Tue 10 Nov')
  assert.equal(outOfStockText(q, '2026-11-10', 'Brakes'), null)
})
