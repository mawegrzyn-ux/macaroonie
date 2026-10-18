// The online sales transactions report (GET /api/orders/transactions[.csv]):
// every online order of a venue, Macaroonie's own online ordering and
// GloriaFood side by side, each with its tender, totals by tender and by
// source. Own orders are made in the database and paid / refunded through the
// admin routes; GloriaFood orders arrive through the push webhook (plus one
// imported row), on the trading day the venue's GloriaFood link sets.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { zonedToUtc } from '../src/services/orderSvc.js'

const TZ = 'Europe/London'
const D1 = '2026-09-07'   // the report's first day
const D2 = '2026-09-08'
const D3 = '2026-09-09'   // the report's last day
const OUTSIDE = '2026-09-10'

let ids, owner, V, token, own = {}

async function push(orders) {
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/webhooks/gloriafood/' + token,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ count: orders.length, orders }),
  })
  assert.equal(res.statusCode, 200, res.body)
}

const at = (date, hm) => zonedToUtc(date, hm, TZ).toISOString()

function gfOrder(id, over = {}) {
  return {
    id, restaurant_id: 7777, restaurant_name: 'Report Test', status: 'accepted', type: 'pickup', source: 'website',
    payment: 'ONLINE', currency: 'GBP', total_price: 20, sub_total_price: 20,
    accepted_at: at(D2, '12:00'), fulfill_at: at(D2, '12:30'), updated_at: at(D2, '12:00'), for_later: false,
    client_first_name: 'Guest', client_last_name: 'Person',
    items: [{ type: 'item', name: 'Pad Thai', quantity: 2, total_item_price: 20, options: [] }],
    ...over,
  }
}

async function ownOrder(date, n, { total, tip = 0, method = 'pay_at_venue', status = 'placed' }) {
  const [o] = await sql`
    INSERT INTO orders (tenant_id, venue_id, service_date, order_number, promised_at, placed_at, guest_name, guest_email,
                        subtotal_pence, tip_pence, total_pence, vat_pence, payment_method, status)
    VALUES (${ids.a}, ${V}, ${date}, ${n}, ${at(date, '18:30')}, ${at(date, '18:00')}, 'Zed Guest', 'zed@example.test',
            ${total - tip}, ${tip}, ${total}, ${Math.round(total / 6)}, ${method}, ${status})
    RETURNING id`
  return o.id
}

const report = (q, who = owner) => who.get(`/api/orders/transactions?venue_id=${V}&from=${D1}&to=${D3}${q || ''}`)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  // GloriaFood: push, trading day from 04:00 by fulfil time.
  await ok(owner.put(`/api/gloriafood/venues/${V}/link`, { method: 'push', day_basis: 'fulfill', day_starts_at: '04:00', show_on_board: true }))
  const { push_url } = await ok(owner.get(`/api/gloriafood/venues/${V}/push-url`))
  token = push_url.split('/').pop()

  // Own orders: paid in cash at the counter, by card at the counter (then
  // part refunded), a test card payment, one not marked paid, a cancelled
  // one, one still unpaid online (never listed), one outside the range.
  own.cash = await ownOrder(D1, 101, { total: 1500, tip: 100 })
  await ok(owner.post(`/api/orders/${own.cash}/mark-paid`, { method: 'cash' }))
  own.card = await ownOrder(D2, 102, { total: 2400 })
  await ok(owner.post(`/api/orders/${own.card}/mark-paid`, { method: 'card_terminal' }))
  await ok(owner.post(`/api/orders/${own.card}/refund`, { amount_pence: 400, reason: 'Missing drink' }))
  own.demo = await ownOrder(D3, 103, { total: 1000, method: 'demo', status: 'completed' })
  await sql`INSERT INTO order_payments (order_id, tenant_id, gateway, gateway_ref, amount_pence, status)
            VALUES (${own.demo}, ${ids.a}, 'demo', 'demo_1', 1000, 'succeeded')`
  await sql`UPDATE orders SET payment_status = 'paid', paid_pence = 1000 WHERE id = ${own.demo}`
  own.unpaid = await ownOrder(D3, 104, { total: 800 })
  own.cancelled = await ownOrder(D2, 105, { total: 900, status: 'cancelled' })
  own.pending = await ownOrder(D2, 106, { total: 700, method: 'demo', status: 'pending_payment' })
  own.outside = await ownOrder(OUTSIDE, 107, { total: 5000 })

  // GloriaFood: online, cash, card, card by phone with a split, cancelled,
  // a GloriaFood test order, one at 02:00 on D2 (D1's trading day), one at
  // 05:00 on D3 + 1 day (outside).
  await push([
    gfOrder(9001, { payment: 'ONLINE', total_price: 20, card_type: 'Visa' }),
    gfOrder(9002, { payment: 'CASH', total_price: 12.5, fulfill_at: at(D3, '19:00') }),
    gfOrder(9003, { payment: 'CARD', total_price: 30, type: 'delivery',
      items: [{ type: 'item', name: 'Green Curry', quantity: 2, total_item_price: 27.5, options: [] },
              { type: 'delivery_fee', name: 'Delivery', quantity: 1, total_item_price: 2.5 }] }),
    gfOrder(9004, { payment: 'CARD_PHONE', used_payment_methods: ['CARD_PHONE', 'CASH'], total_price: 16 }),
    gfOrder(9005, { status: 'canceled', payment: 'ONLINE', total_price: 40 }),
    gfOrder(9006, { source: 'admin', payment: 'CASH', total_price: 9 }),
    gfOrder(9007, { payment: 'CASH', total_price: 5, fulfill_at: at(D2, '02:00'), accepted_at: at(D2, '01:30') }),
    gfOrder(9008, { payment: 'CASH', total_price: 50, fulfill_at: at(OUTSIDE, '05:00') }),
  ])
  // An order imported from GloriaFood's export, payment as the export words it.
  await sql`
    INSERT INTO gloriafood_orders (tenant_id, venue_id, gf_order_id, status, source, order_type, payment, total_pence,
                                   accepted_at, fulfill_at, received_via, payload, board_status)
    VALUES (${ids.a}, ${V}, 8001, 'accepted', 'website', 'pickup', 'Card (G-Pay / via Browser)', 1100,
            ${at(D1, '13:00')}, ${at(D1, '13:20')}, 'import', ${sql.json({ imported: { file: 'export.csv', line: 2 } })}, 'completed')`
})
after(closeApp)

test('every online order in the range, with its tender, newest first', async () => {
  const r = await ok(report())
  const byNum = Object.fromEntries(r.rows.map(x => [x.source + ':' + x.number, x]))
  const keys = Object.keys(byNum).sort()
  assert.deepEqual(keys, [
    'gloriafood:8001', 'gloriafood:9001', 'gloriafood:9002', 'gloriafood:9003', 'gloriafood:9004',
    'gloriafood:9005', 'gloriafood:9006', 'gloriafood:9007',
    'web:101', 'web:102', 'web:103', 'web:104', 'web:105',
  ], 'unpaid-online and outside-the-range orders are left out')

  assert.equal(byNum['web:101'].tender, 'cash')
  assert.equal(byNum['web:101'].tender_label, 'Cash')
  assert.equal(byNum['web:102'].tender, 'card_counter')
  assert.equal(byNum['web:102'].refunded_pence, 400)
  assert.equal(byNum['web:102'].net_pence, 2000)
  assert.equal(byNum['web:103'].tender, 'test')
  assert.equal(byNum['web:104'].tender, 'unpaid')
  assert.equal(byNum['web:104'].tender_detail, 'Pay at the counter')
  assert.equal(byNum['web:105'].counted, false)
  assert.equal(byNum['web:105'].note, 'Cancelled')
  assert.equal(byNum['web:105'].net_pence, 0)

  assert.equal(byNum['gloriafood:9001'].tender, 'online')
  assert.equal(byNum['gloriafood:9001'].tender_label, 'Paid online')
  assert.match(byNum['gloriafood:9001'].tender_detail, /Visa/)
  assert.equal(byNum['gloriafood:9002'].tender, 'cash')
  assert.equal(byNum['gloriafood:9002'].date, D3)
  assert.equal(byNum['gloriafood:9003'].tender, 'card_counter')
  assert.equal(byNum['gloriafood:9003'].fees_pence, 250)
  assert.equal(byNum['gloriafood:9004'].tender, 'card_phone')
  assert.match(byNum['gloriafood:9004'].tender_detail, /Split: Card by phone \+ Cash/)
  assert.equal(byNum['gloriafood:9005'].counted, false)
  assert.equal(byNum['gloriafood:9005'].status_label, 'Cancelled')
  assert.equal(byNum['gloriafood:9006'].counted, false)
  assert.equal(byNum['gloriafood:9006'].note, 'GloriaFood test order')
  assert.equal(byNum['gloriafood:9007'].date, D1, '02:00 belongs to the trading day before (day starts 04:00)')
  assert.equal(byNum['gloriafood:8001'].tender, 'other:Card (G-Pay / via Browser)')
  assert.equal(byNum['gloriafood:8001'].tender_label, 'Card (G-Pay / via Browser)')
  assert.match(byNum['gloriafood:8001'].tender_detail, /Imported/)

  // Newest day first.
  const dates = r.rows.map(x => x.date)
  assert.deepEqual(dates, [...dates].sort().reverse())
  // Money only: no guest details anywhere in the report.
  assert.doesNotMatch(JSON.stringify(r), /Zed Guest|zed@example|Guest Person/)
})

test('totals by tender and by source add up, not counted orders left out', async () => {
  const r = await ok(report())
  // Counted: own 1500 + 2400 + 1000 + 800; GloriaFood 2000 + 1250 + 3000 + 1600 + 500 + 1100.
  assert.equal(r.totals.orders, 10)
  assert.equal(r.totals.not_counted, 3)
  assert.equal(r.totals.sales_pence, 5700 + 9450)
  assert.equal(r.totals.refunded_pence, 400)
  assert.equal(r.totals.net_pence, 5700 + 9450 - 400)
  const t = Object.fromEntries(r.by_tender.map(x => [x.key, x]))
  assert.equal(t.cash.net_pence, 1500 + 1250 + 500)
  assert.equal(t.cash.web.orders, 1)
  assert.equal(t.cash.gloriafood.orders, 2)
  assert.equal(t.card_counter.net_pence, 2000 + 3000)
  assert.equal(t.online.net_pence, 2000)
  assert.equal(t.card_phone.net_pence, 1600)
  assert.equal(t.test.net_pence, 1000)
  assert.equal(t.unpaid.net_pence, 800)
  assert.equal(r.by_tender.reduce((s, x) => s + x.net_pence, 0), r.totals.net_pence)
  const s = Object.fromEntries(r.by_source.map(x => [x.key, x]))
  assert.equal(s.web.net_pence, 5700 - 400)
  assert.equal(s.gloriafood.net_pence, 9450)
  assert.deepEqual(r.sources.map(x => x.key).sort(), ['gloriafood', 'web'])
})

test('filters: source, tender, counted only; pickers still list the whole range', async () => {
  const gf = await ok(report('&source=gloriafood'))
  assert.ok(gf.rows.every(x => x.source === 'gloriafood'))
  assert.equal(gf.totals.net_pence, 9450)
  assert.equal(gf.tenders.length, (await ok(report())).tenders.length)
  const cash = await ok(report('&tender=cash'))
  assert.ok(cash.rows.every(x => x.tender === 'cash'))
  assert.equal(cash.totals.net_pence, 3250)
  const counted = await ok(report('&counted=1'))
  assert.ok(counted.rows.every(x => x.counted))
  assert.equal(counted.totals.not_counted, 0)
  const other = await ok(report('&tender=' + encodeURIComponent('other:Card (G-Pay / via Browser)')))
  assert.deepEqual(other.rows.map(x => x.number), ['8001'])
})

test('CSV: the same rows, money in pounds, no guest details, formula-safe text', async () => {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: `/api/orders/transactions.csv?venue_id=${V}&from=${D1}&to=${D3}`,
    headers: { authorization: 'Bearer test:' + A.owner, 'x-tenant-id': ids.a },
  })
  assert.equal(res.statusCode, 200, res.body)
  assert.match(res.headers['content-type'], /text\/csv/)
  assert.match(res.headers['content-disposition'], new RegExp(`online-sales-.*-${D1}-to-${D3}\\.csv`))
  const lines = res.body.trim().split('\r\n')
  assert.equal(lines[0], 'Date,Time,Ready for,Source,Order,Type,Status,Counted,Tender,Tender detail,Total,Tips,Discounts,Delivery and fees,VAT / tax,Refunded,Net')
  assert.equal(lines.length, 1 + 13)
  const card = lines.find(l => l.includes(',102,'))
  assert.match(card, /Online ordering,102,Collection,Placed,yes,Card at the counter,Card \(terminal\),24\.00,0\.00,0\.00,0\.00,4\.00,4\.00,20\.00$/)
  const split = lines.find(l => l.includes(',9004,'))
  assert.match(split, /Card by phone,Split: Card by phone \+ Cash,16\.00/)
  assert.doesNotMatch(res.body, /Zed Guest|zed@example|Guest Person/)
})

test('refusals: bad ranges, another tenant, no Online orders access', async () => {
  const bad = await owner.get(`/api/orders/transactions?venue_id=${V}&from=${D3}&to=${D1}`)
  assert.equal(bad.status, 400)
  const long = await owner.get(`/api/orders/transactions?venue_id=${V}&from=2025-01-01&to=2026-12-31`)
  assert.equal(long.status, 400)
  const other = await as(B.owner, ids.b).get(`/api/orders/transactions?venue_id=${V}&from=${D1}&to=${D3}`)
  assert.equal(other.status, 404)
  const otherCsv = await as(B.owner, ids.b).get(`/api/orders/transactions.csv?venue_id=${V}&from=${D1}&to=${D3}`)
  assert.equal(otherCsv.status, 404)
  // Viewers see it (Online orders view) ...
  await ok(report('', as(A.viewer, ids.a)))
  // ... until their role has no Online orders access.
  const roles = await ok(owner.get('/api/access/roles'))
  const viewer = (roles.roles || roles).find(r => r.key === 'viewer')
  await ok(owner.patch('/api/access/roles/' + viewer.id, { permissions: { ...(viewer.permissions || {}), web_orders: 'none' } }))
  const refused = await report('', as(A.viewer, ids.a))
  assert.equal(refused.status, 403)
})
