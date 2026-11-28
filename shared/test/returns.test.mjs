// shared/returns.js (inventory phase 9b, migration 321): returns to the
// supplier and their credit notes, and the return move on the stock ledger
// (shared/stock.js) that variance's returns term reads (shared/variance.js).
// Dates are pinned: nothing here depends on the clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  returnNumberLabel, returnedOf, returnableLines, returnPrefill, returnLinesProblem, returnedAtProblem, returnTotals,
  returnActions, creditOwed, creditOverdue, daysWaiting, creditDifference, returnWords, paidPrice, paidVatRate,
  RETURN_REASONS, RETURN_STATUSES, CREDIT_OVERDUE_DAYS, RETURN_BACK_DAYS,
} from '../returns.js'
import { stockOnHand, MOVE_KINDS } from '../stock.js'
import { itemVariance, explainVariance, periodVariance } from '../variance.js'

const DAY = 86400000
const NOW = new Date('2026-11-27T15:00:00Z')
const ago = days => new Date(NOW.getTime() - days * DAY).toISOString()

const LINES = [
  { id: 'L1', item_id: 'chicken', item_name: 'Chicken thighs', received_qty: 3, receive_status: 'damaged', receive_note: 'crushed box', price: 20, vat_rate: 0, pack_label: 'Case of 5 kg' },
  { id: 'L2', item_id: 'cups', item_name: 'Cups', received_qty: 4, receive_status: 'ok', price: 3, invoice_price: 2.8, vat_rate: 20, invoice_vat_rate: 20, pack_label: 'Sleeve of 50' },
  { id: 'L3', item_id: 'cream', item_name: 'Cream', received_qty: 0, receive_status: 'missing', price: 4.5, vat_rate: 0 },
  { id: 'L4', item_id: null, item_name: 'Gone item', received_qty: 2, price: 1, vat_rate: 0 },
  { id: 'L5', item_id: 'bread', item_name: 'Bread', received_qty: 2, receive_status: 'substituted', receive_note: 'rolls came', price: 2, vat_rate: 0 },
]

test('numbers, reasons and statuses', () => {
  assert.equal(returnNumberLabel(12), 'RT-00012')
  assert.deepEqual(Object.keys(RETURN_REASONS), ['damaged', 'wrong_item', 'short_dated', 'quality', 'other'])
  assert.deepEqual(Object.keys(RETURN_STATUSES), ['open', 'sent', 'credited', 'refused', 'cancelled'])
  assert.equal(CREDIT_OVERDUE_DAYS, 14)
  assert.equal(RETURN_BACK_DAYS, 14)
  assert.equal(paidPrice(LINES[1]), 2.8, 'the invoice\'s price when one was read')
  assert.equal(paidPrice(LINES[0]), 20, 'else the price ordered at')
  assert.equal(paidVatRate(LINES[1]), 20)
})

test('what can go back: what arrived, less what returns not cancelled already take', () => {
  const back = returnedOf([
    { po_line_id: 'L1', qty: 1, status: 'sent' },
    { po_line_id: 'L1', qty: 0.5, status: 'credited' },
    { po_line_id: 'L2', qty: 4, status: 'cancelled' },
  ])
  assert.equal(back.get('L1'), 1.5)
  assert.equal(back.has('L2'), false, 'a cancelled return takes nothing back')
  const rows = returnableLines(LINES, back)
  assert.deepEqual(rows.map(r => r.id), ['L1', 'L2', 'L5'], 'nothing arrived of L3; L4 is no inventory item any more')
  assert.deepEqual(rows.map(r => [r.returned_qty, r.left]), [[1.5, 1.5], [0, 4], [0, 2]])
})

test('a damaged line goes back filled in; a substituted one as the wrong item; others are not suggested', () => {
  const rows = returnableLines(LINES, new Map([['L1', 1]]))
  assert.deepEqual(returnPrefill(rows[0]), { po_line_id: 'L1', qty: 2, reason: 'damaged', note: 'crushed box' })
  assert.equal(returnPrefill(rows[1]), null)
  assert.deepEqual(returnPrefill(rows[2]), { po_line_id: 'L5', qty: 2, reason: 'wrong_item', note: 'rolls came' })
  assert.equal(returnPrefill({ ...rows[0], left: 0 }), null, 'nothing left to send back')
})

test('the lines of a return: on the delivery once, packs above 0 and no more than is left, a reason, a note for Other', () => {
  const rows = returnableLines(LINES, new Map([['L1', 2]]))
  assert.equal(returnLinesProblem([], rows), 'Pick at least one line to return')
  assert.equal(returnLinesProblem([{ po_line_id: 'L1', qty: 1, reason: 'damaged' }], rows), null)
  assert.match(returnLinesProblem([{ po_line_id: 'L1', qty: 2, reason: 'damaged' }], rows), /Only 1 of Chicken thighs can go back \(3 arrived, 2 already going back\)/)
  assert.match(returnLinesProblem([{ po_line_id: 'L3', qty: 1, reason: 'damaged' }], rows), /isn't on this delivery/)
  assert.match(returnLinesProblem([{ po_line_id: 'other-tenants-line', qty: 1, reason: 'damaged' }], rows), /isn't on this delivery/)
  assert.match(returnLinesProblem([{ po_line_id: 'L2', qty: 1, reason: 'damaged' }, { po_line_id: 'L2', qty: 1, reason: 'quality' }], rows), /twice/)
  assert.match(returnLinesProblem([{ po_line_id: 'L2', qty: 0, reason: 'damaged' }], rows), /how many/)
  assert.match(returnLinesProblem([{ po_line_id: 'L2', qty: 1, reason: 'lost' }], rows), /Pick why/)
  assert.match(returnLinesProblem([{ po_line_id: 'L2', qty: 1, reason: 'other' }], rows), /Other needs a note/)
  assert.equal(returnLinesProblem([{ po_line_id: 'L2', qty: 1, reason: 'other', note: 'wrong size' }], rows), null)
  const all = returnableLines(LINES, new Map([['L1', 3]]))
  assert.match(returnLinesProblem([{ po_line_id: 'L1', qty: 1, reason: 'damaged' }], all), /All of Chicken thighs is already going back/)
})

test('when the goods went back: not in the future, up to 14 days back, never before the delivery was booked in', () => {
  const received = ago(3)
  assert.equal(returnedAtProblem(NOW, { now: NOW, receivedAt: received }), null)
  assert.equal(returnedAtProblem(received, { now: NOW, receivedAt: received }), null, 'with the delivery itself')
  assert.equal(returnedAtProblem(new Date(NOW.getTime() + 4 * 60000), { now: NOW }), null, 'a few minutes of clock difference')
  assert.match(returnedAtProblem(new Date(NOW.getTime() + 10 * 60000), { now: NOW }), /future/)
  assert.match(returnedAtProblem(ago(15), { now: NOW }), /14 days back/)
  assert.match(returnedAtProblem(ago(4), { now: NOW, receivedAt: received }), /before the delivery was booked in/)
  assert.match(returnedAtProblem('not a time', { now: NOW }), /doesn't exist/)
})

test('the credit expected: packs x the price paid, VAT on each line, as purchase orders add up', () => {
  assert.deepEqual(returnTotals([{ qty: 2, price: 20, vat_rate: 0 }, { qty: 3, price: 2.8, vat_rate: 20 }]), { net: 48.4, vat: 1.68, total: 50.08 })
  assert.deepEqual(returnTotals([]), { net: 0, vat: 0, total: 0 })
})

test('what may be done: start and cancel an open one with Use; send, credit and refuse with approval', () => {
  const use = { canStart: true, canApprove: false }
  const approve = { canStart: true, canApprove: true }
  assert.deepEqual(returnActions({ status: 'open' }, use), { can_email: false, can_mark_sent: false, can_credit: false, can_refuse: false, can_cancel: true })
  assert.deepEqual(returnActions({ status: 'sent' }, use).can_cancel, false, 'a sent one is an approver\'s to cancel')
  assert.deepEqual(returnActions({ status: 'open' }, approve), { can_email: true, can_mark_sent: true, can_credit: true, can_refuse: true, can_cancel: true })
  assert.deepEqual(returnActions({ status: 'sent' }, approve), { can_email: true, can_mark_sent: false, can_credit: true, can_refuse: true, can_cancel: true })
  assert.deepEqual(returnActions({ status: 'credited' }, approve), { can_email: false, can_mark_sent: false, can_credit: true, can_refuse: false, can_cancel: false })
  assert.deepEqual(returnActions({ status: 'refused' }, approve), { can_email: false, can_mark_sent: false, can_credit: true, can_refuse: false, can_cancel: false })
  assert.deepEqual(returnActions({ status: 'cancelled' }, approve), { can_email: false, can_mark_sent: false, can_credit: false, can_refuse: false, can_cancel: false })
  assert.equal(Object.values(returnActions({ status: 'open' }, { canStart: false, canApprove: false })).some(Boolean), false, 'View does nothing')
})

test('a credit owed is overdue 14 days after the goods went back (the clock pinned)', () => {
  const r = { status: 'sent', returned_at: ago(14) }
  assert.equal(creditOwed(r), true)
  assert.equal(creditOverdue(r, NOW), true, 'on the 14th day')
  assert.equal(creditOverdue({ ...r, returned_at: ago(13.9) }, NOW), false)
  assert.equal(creditOverdue({ ...r, status: 'open' }, NOW), true, 'never sent is owed too')
  assert.equal(creditOverdue({ ...r, status: 'credited' }, NOW), false)
  assert.equal(creditOverdue({ ...r, status: 'refused' }, NOW), false)
  assert.equal(creditOverdue({ ...r, status: 'cancelled' }, NOW), false)
  assert.equal(creditOverdue(r, NOW, 30), false, 'a longer wait asked for')
  assert.equal(daysWaiting(r, NOW), 14)
  assert.equal(creditDifference({ credit_amount: 39.5, credit_expected: 40 }), -0.5)
  assert.equal(creditDifference({ credit_amount: null, credit_expected: 40 }), null)
  const words = returnWords({ number: 3, supplier_name: 'Brakes', status: 'sent', returned_at: ago(15), sent_at: ago(15), line_count: 2, credit_expected: 24.5 }, { prices: true, now: NOW })
  assert.match(words, /^RT-00003 to Brakes: 2 lines, returned .+, sent .+, £24\.50 expected, waiting 15 days$/)
  assert.doesNotMatch(returnWords({ number: 3, status: 'open', credit_expected: 24.5, returned_at: ago(1) }, { prices: false, now: NOW }), /£/, 'no money without prices')
})

// ── The ledger and variance ──────────────────────────────────────────

const T = h => new Date(Date.UTC(2026, 10, 20, h)).toISOString()

test('a return is a move that takes stock off, valued at what was paid (a paid kind, like a delivery)', () => {
  assert.equal(MOVE_KINDS.return.label, 'Returned to the supplier')
  assert.equal(MOVE_KINDS.return.paid, true)
  assert.equal(MOVE_KINDS.delivery.paid, true)
  assert.equal(!!MOVE_KINDS.waste.paid, false)
  const moves = [
    { kind: 'count', qty_base: 5000, at: T(8) },
    { kind: 'delivery', qty_base: 15000, at: T(9) },
    { kind: 'return', qty_base: -10000, at: T(10) },
    { kind: 'usage', qty_base: -2000, at: T(22) },
  ]
  const s = stockOnHand({ moves })
  assert.equal(s.on_hand, 8000)
  assert.equal(s.returned_since, -10000)
  assert.equal(s.received_since, 15000)
  assert.equal(stockOnHand({ moves, at: T(9) }).returned_since, 0, 'before it went back')
})

test('variance: the returns term is the return moves, so actual leaves them out and a matching count leaves nothing unexplained', () => {
  const moves = [
    { kind: 'count', qty_base: 5000, at: T(8) },
    { kind: 'delivery', qty_base: 15000, at: T(9) },
    { kind: 'return', qty_base: -10000, at: T(10) },
    { kind: 'waste', qty_base: -500, at: T(12) },
    { kind: 'usage', qty_base: -2000, at: T(22) },
    // The closing count finds what the ledger expected: 5 + 15 - 10 - 0.5 - 2 = 7.5 kg.
    { kind: 'count', qty_base: 7500, at: T(23) },
  ]
  const r = itemVariance({ moves, from: T(8), to: T(23), price: 0.004 })
  assert.equal(r.returns, 10000)
  assert.equal(r.returns_value, 40)
  assert.equal(r.actual, 2500, 'opening 5 kg + 15 kg received - 10 kg returned - 7.5 kg closing')
  assert.equal(r.theoretical, 2000)
  assert.equal(r.variance, 500)
  assert.equal(r.explained, 500, 'the waste')
  assert.equal(r.unexplained, 0, 'the count found what the documents said')
  // Without the returns term the 10 kg would be unexplained loss.
  const left = r.opening + r.received + r.transfers_in - r.transfers_out - r.returns - r.closing
  assert.equal(left, r.actual)
  // A return outside the window is no part of it.
  const before = itemVariance({ moves, from: T(11), to: T(23) })
  assert.equal(before.returns, 0)
  // An item whose only move in the period is a return isn't quiet.
  const quiet = periodVariance({ items: [{ item_id: 'x', name: 'X', ...itemVariance({ moves: [{ kind: 'return', qty_base: -100, at: T(10) }], from: T(8), to: T(23) }) }] })
  assert.equal(quiet.rows.length, 1)
  // The evidence says it went back, not lost.
  const ev = explainVariance({ item: { name: 'Chicken', base_unit: 'g' }, row: r, returns: 1 })
  const ret = ev.find(e => e.kind === 'returned')
  assert.ok(ret, 'listed')
  assert.match(ret.text, /^10 kg went back to the supplier \(1 return\): it is taken out of actual usage/)
  assert.equal(ret.page, '/purchasing?tab=returns')
})
