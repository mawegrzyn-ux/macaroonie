// shared/externalSales.js: pence from other tills' decimals, personal data
// taken out, stable hashing input, late syncs and history progress.
import test from 'node:test'
import assert from 'node:assert/strict'
import { toPence, toQty, stripPersonal, stableJson, syncLate, historyProgress, LATE_AFTER_MINUTES, allocateNet } from '../externalSales.js'

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
