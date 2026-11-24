// shared/externalSales.js: pence from other tills' decimals, personal data
// taken out, stable hashing input, late syncs and history progress; the
// stored day figures, whether a day has synced (phase 4) and coverage.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toPence, toQty, stripPersonal, stableJson, syncLate, historyProgress, LATE_AFTER_MINUTES, allocateNet,
  dayCovered, dayFiguresFromStored, SALE_SOURCES,
} from '../externalSales.js'
import { coverageShare } from '../itemMapping.js'

test('allocateNet: parts add up exactly, the remainder on the main part, refunds too', () => {
  assert.deepEqual(allocateNet(1000, [300, 50, 50]), [750, 125, 125])
  assert.deepEqual(allocateNet(-1000, [300, 70, 50]), [-1000 + 166 + 119, -166, -119])
  assert.deepEqual(allocateNet(666, [0, 0]), [666, 0])
  assert.deepEqual(allocateNet(0, [100, 100]), [0, 0])
  assert.deepEqual(allocateNet(500, []), [])
  assert.deepEqual(allocateNet(7, [1, 1, 1]), [3, 2, 2])
  for (const [net, w] of [[999, [7, 3, 11]], [-1, [5, 5]], [12345, [1250, 250, 0, 75]]]) {
    assert.equal(allocateNet(net, w).reduce((s, x) => s + x, 0), net)
  }
})

test('toPence reads the digits: no float drift, half away from zero', () => {
  const cases = [
    [12.5, 1250], ['12.50', 1250], [0, 0], [null, 0], ['', 0], [undefined, 0],
    [1.005, 101], [1.004, 100], [-1.005, -101], [0.1 + 0.2, 30], [19.99, 1999],
    [4.35, 435], [1.15, 115], [8.675, 868], ['-3.1', -310], ['3', 300], ['.5', 50],
    [1e-7, 0], [123456.78, 12345678], ['abc', 0], [NaN, 0], [Infinity, 0], ['-0.00', 0],
  ]
  for (const [v, want] of cases) assert.equal(toPence(v), want, String(v))
  // The float way gets some of these wrong; the digits never do.
  assert.notEqual(Math.round(1.005 * 100), toPence(1.005))
})

test('toQty keeps three decimals', () => {
  assert.equal(toQty('1.2345'), 1.235)
  assert.equal(toQty(2), 2)
  assert.equal(toQty('x'), 0)
})

test('stripPersonal takes customer details out at any depth, and named top-level keys', () => {
  const r = {
    receipt_number: '1-1001', customer_id: 'c-9', order: 'Jo Bloggs', note: 'call 07700 900123',
    customer: { name: 'Jo', email: 'jo@example.com' },
    line_items: [{ item_name: 'Flat white', line_note: 'extra hot', email: 'x@y.z' }],
    payments: [{ name: 'Card', payment_details: { cardholder_name: 'JO BLOGGS', card_company: 'VISA' } }],
  }
  const s = stripPersonal(r, ['order', 'note'])
  assert.equal(s.customer_id, 'c-9', 'the id stays')
  assert.equal(s.customer, undefined)
  assert.equal(s.order, undefined)
  assert.equal(s.note, undefined)
  assert.equal(s.line_items[0].email, undefined)
  assert.equal(s.line_items[0].line_note, 'extra hot')
  assert.equal(s.payments[0].payment_details.cardholder_name, undefined)
  assert.equal(s.payments[0].payment_details.card_company, 'VISA')
  assert.equal(r.customer.email, 'jo@example.com', 'the original is untouched')
  assert.doesNotMatch(JSON.stringify(s), /Bloggs|example\.com|07700/)
})

test('stableJson sorts keys, keeps array order', () => {
  assert.equal(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}')
  assert.equal(stableJson({ a: 1, b: 2 }), stableJson({ b: 2, a: 1 }))
})

test('syncLate and historyProgress', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')
  const ago = m => new Date(now - m * 60_000).toISOString()
  assert.equal(syncLate({ status: 'active', last_sync_ok_at: ago(10) }, now), false)
  assert.equal(syncLate({ status: 'active', last_sync_ok_at: ago(LATE_AFTER_MINUTES + 1) }, now), true)
  assert.equal(syncLate({ status: 'paused', last_sync_ok_at: ago(500) }, now), false)
  assert.equal(syncLate({ status: 'active', last_sync_ok_at: null, created_at: ago(5) }, now), false)
  const h = { history_from: '2025-10-24T00:00:00Z', history_to: '2026-11-24T00:00:00Z' }
  assert.equal(historyProgress(null), 0)
  assert.equal(historyProgress({ ...h, history_next_from: h.history_from }), 0)
  assert.ok(Math.abs(historyProgress({ ...h, history_next_from: '2026-05-10T00:00:00Z' }) - 0.5) < 0.02)
  assert.equal(historyProgress({ ...h, history_done_at: '2026-11-24T00:10:00Z' }), 1)
})

test('dayCovered: the catch-up past the day\'s end, and the history past the day when it falls in it', () => {
  const day = { start: '2026-11-20T04:00:00Z', end: '2026-11-21T04:00:00Z' }
  const linked = { history_from: '2025-10-24T00:00:00Z', history_to: '2026-11-24T00:00:00Z', history_next_from: '2026-11-24T00:00:00Z', history_done_at: '2026-11-24T00:05:00Z' }
  assert.equal(dayCovered({ ...linked, synced_to: '2026-11-21T05:00:00Z' }, day), true)
  assert.equal(dayCovered({ ...linked, synced_to: '2026-11-21T03:59:00Z' }, day), false, 'the catch-up hasn\'t reached the day\'s end')
  assert.equal(dayCovered({ ...linked, synced_to: null }, day), false, 'never synced')
  const importing = { ...linked, history_done_at: null, history_next_from: '2026-06-01T00:00:00Z', synced_to: '2026-11-24T10:00:00Z' }
  assert.equal(dayCovered(importing, day), false, 'the history import hasn\'t reached it')
  assert.equal(dayCovered(importing, { start: '2026-05-01T03:00:00Z', end: '2026-05-02T03:00:00Z' }), true, 'it has passed this one')
  const afterLink = { start: '2026-11-24T04:00:00Z', end: '2026-11-25T04:00:00Z' }
  assert.equal(dayCovered(importing, afterLink), false, 'after the link but not synced past its end')
  assert.equal(dayCovered({ ...importing, synced_to: '2026-11-25T05:00:00Z' }, afterLink), true, 'after the link: the catch-up has it')
  assert.equal(dayCovered(importing, { start: '2025-01-01T00:00:00Z', end: '2025-01-02T00:00:00Z' }), true, 'older than the history reaches')
})

test('dayFiguresFromStored: cancelled left out, refunds against the day as positives, item lines only', () => {
  const sale = { kind: 'sale', discount_pence: 50, tax_pence: 100, tip_pence: 100, charge_pence: 20, total_pence: 950,
    lines: [{ line_kind: 'item', item_ref: 'a', name: 'A', gross_pence: 1000, net_pence: 950 }, { line_kind: 'modifier', item_ref: null, name: 'M', gross_pence: 100, net_pence: 100 }],
    payments: [{ payment_type_ref: 'card', name: 'Card', amount_pence: 1050 }] }
  const refund = { kind: 'refund', discount_pence: -25, tax_pence: -50, tip_pence: 0, charge_pence: 0, total_pence: -475,
    lines: [{ line_kind: 'item', item_ref: 'a', name: 'A', gross_pence: -500, net_pence: -475 }],
    payments: [{ payment_type_ref: 'card', name: 'Card', amount_pence: -475 }] }
  const d = dayFiguresFromStored([sale, refund, { ...sale, cancelled: true }], { a: 'hot' })
  assert.equal(d.sales, 1)
  assert.equal(d.refund_receipts, 1)
  assert.equal(d.gross_sales, 1000, 'the modifier is in its item\'s money')
  assert.equal(d.refunds, 500)
  assert.equal(d.discounts, 25)
  assert.equal(d.net_sales, 1000 - 500 - 25)
  assert.equal(d.total_collected, 475)
  assert.equal(d.items.a.amount, 475)
  assert.equal(d.categories.hot, 475)
  assert.equal(d.payment_types.card.amount, 575)
  assert.equal(SALE_SOURCES.macaroonie, 'Macaroonie')
  assert.equal(SALE_SOURCES.loyverse, 'Loyverse')
})

test('coverageShare: decided over everything but ignored', () => {
  assert.equal(coverageShare({ total: 1000, mapped: 500, kept: 100, bucket: 100, ignored: 300, unmapped: 0 }), 100)
  assert.equal(coverageShare({ total: 1000, mapped: 300, kept: 0, bucket: 0, ignored: 0, unmapped: 700 }), 30)
  assert.equal(coverageShare({ total: 200, ignored: 200 }), null)
})
