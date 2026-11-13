// Online sales for tests.
//
// sellOnline(): three fixed days of them at one venue. The group's own
// online orders are made in the database with their dishes, then paid and
// refunded through the admin routes; GloriaFood orders arrive through the
// push webhook (plus one row as an import leaves it), on the trading day the
// venue's GloriaFood link sets (from 04:00, by the fulfil time).
//
// placeOrders(): real orders placed through the ordering page's own API, for
// the first collection time tomorrow, with whatever the group's promotions,
// order flows and charges put on them.
import assert from 'node:assert/strict'
import { as, getApp, sql, ok } from './app.mjs'
import { zonedToUtc } from '../../src/services/orderSvc.js'

export const TZ = 'Europe/London'
export const D1 = '2026-09-07'   // a Monday: the first day
export const D2 = '2026-09-08'
export const D3 = '2026-09-09'   // the last day
export const OUTSIDE = '2026-09-10'

/** A time of day at the venue as an ISO moment. */
export const at = (date, hm) => zonedToUtc(date, hm, TZ).toISOString()

// The dishes on the group's own orders: [name, quantity, price each].
const DISHES = {
  101: [['Pad Thai', 1, 900], ['Spring Rolls', 1, 500]],
  102: [['Pad Thai', 2, 900], ['Green Curry', 1, 600]],
  103: [['Spring Rolls', 2, 500]],
  104: [['Tom Yum', 1, 800]],
  105: [['Pad Thai', 1, 900]],
  106: [['Tom Yum', 1, 700]],
  107: [['Banquet', 5, 1000]],
}

export function gfOrder(id, over = {}) {
  return {
    id, restaurant_id: 7777, restaurant_name: 'Report Test', status: 'accepted', type: 'pickup', source: 'website',
    payment: 'ONLINE', currency: 'GBP', total_price: 20, sub_total_price: 20,
    accepted_at: at(D2, '12:00'), fulfill_at: at(D2, '12:30'), updated_at: at(D2, '12:00'), for_later: false,
    client_first_name: 'Guest', client_last_name: 'Person',
    items: [{ type: 'item', name: 'Pad Thai', quantity: 2, total_item_price: 20, options: [] }],
    ...over,
  }
}

/**
 * The three days. Own orders (by order number):
 *   101  D1  £15.00 with a £1 tip, paid in cash at the counter
 *   102  D2  £24.00, paid by card at the counter, £4 refunded
 *   103  D3  £10.00, a test card payment; accepted after 4 minutes, ready
 *            16 minutes later, collected 11 minutes after that
 *   104  D3  £8.00, not marked paid
 *   105  D2  £9.00, cancelled
 *   106  D2  £7.00, still unpaid online (never listed)
 *   107  the day after the range, £50.00
 * GloriaFood (by its order id): 9001 online £20, 9002 cash £12.50 on D3,
 * 9003 card £30 delivered with a £2.50 fee, 9004 card by phone £16 (split),
 * 9005 cancelled, 9006 a GloriaFood test order, 9007 cash £5 at 02:00 on D2
 * (D1's trading day), 9008 outside the range, 8001 imported on D1 (£11).
 * Returns { own: { cash, card, demo, unpaid, cancelled, pending, outside }, token }.
 */
export async function sellOnline({ owner, tenantId, venueId }) {
  const V = venueId
  await ok(owner.put(`/api/gloriafood/venues/${V}/link`, { method: 'push', day_basis: 'fulfill', day_starts_at: '04:00', show_on_board: true }))
  const { push_url } = await ok(owner.get(`/api/gloriafood/venues/${V}/push-url`))
  const token = push_url.split('/').pop()

  async function ownOrder(date, n, { total, tip = 0, method = 'pay_at_venue', status = 'placed', times = {} }) {
    const [o] = await sql`
      INSERT INTO orders (tenant_id, venue_id, service_date, order_number, promised_at, placed_at, guest_name, guest_email,
                          subtotal_pence, tip_pence, total_pence, vat_pence, payment_method, status,
                          accepted_at, ready_at, completed_at)
      VALUES (${tenantId}, ${V}, ${date}, ${n}, ${at(date, '18:30')}, ${at(date, '18:00')}, 'Zed Guest', 'zed@example.test',
              ${total - tip}, ${tip}, ${total}, ${Math.round(total / 6)}, ${method}, ${status},
              ${times.accepted ? at(date, times.accepted) : null}, ${times.ready ? at(date, times.ready) : null},
              ${times.completed ? at(date, times.completed) : null})
      RETURNING id`
    let i = 0
    for (const [name, qty, each] of DISHES[n]) {
      await sql`
        INSERT INTO order_items (order_id, tenant_id, name, qty, unit_price_pence, line_total_pence, vat_rate, vat_pence, sort_order)
        VALUES (${o.id}, ${tenantId}, ${name}, ${qty}, ${each}, ${qty * each}, 20, ${Math.round(qty * each / 6)}, ${i++})`
    }
    return o.id
  }

  const own = {}
  own.cash = await ownOrder(D1, 101, { total: 1500, tip: 100 })
  await ok(owner.post(`/api/orders/${own.cash}/mark-paid`, { method: 'cash' }))
  own.card = await ownOrder(D2, 102, { total: 2400 })
  await ok(owner.post(`/api/orders/${own.card}/mark-paid`, { method: 'card_terminal' }))
  await ok(owner.post(`/api/orders/${own.card}/refund`, { amount_pence: 400, reason: 'Missing drink' }))
  own.demo = await ownOrder(D3, 103, { total: 1000, method: 'demo', status: 'completed', times: { accepted: '18:04', ready: '18:20', completed: '18:31' } })
  await sql`INSERT INTO order_payments (order_id, tenant_id, gateway, gateway_ref, amount_pence, status)
            VALUES (${own.demo}, ${tenantId}, 'demo', 'demo_1', 1000, 'succeeded')`
  await sql`UPDATE orders SET payment_status = 'paid', paid_pence = 1000 WHERE id = ${own.demo}`
  own.unpaid = await ownOrder(D3, 104, { total: 800 })
  own.cancelled = await ownOrder(D2, 105, { total: 900, status: 'cancelled' })
  own.pending = await ownOrder(D2, 106, { total: 700, method: 'demo', status: 'pending_payment' })
  own.outside = await ownOrder(OUTSIDE, 107, { total: 5000 })

  const app = await getApp()
  const orders = [
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
  ]
  const res = await app.inject({
    method: 'POST', url: '/webhooks/gloriafood/' + token,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ count: orders.length, orders }),
  })
  assert.equal(res.statusCode, 200, res.body)
  // An order imported from GloriaFood's export, payment as the export words it.
  await sql`
    INSERT INTO gloriafood_orders (tenant_id, venue_id, gf_order_id, status, source, order_type, payment, total_pence,
                                   accepted_at, fulfill_at, received_via, payload, board_status)
    VALUES (${tenantId}, ${V}, 8001, 'accepted', 'website', 'pickup', 'Card (G-Pay / via Browser)', 1100,
            ${at(D1, '13:00')}, ${at(D1, '13:20')}, 'import', ${sql.json({ imported: { file: 'export.csv', line: 2 } })}, 'completed')`

  return { own, token }
}

/**
 * `n` real orders placed as a guest through the ordering page's API, each
 * `qty` of the first dish that can be ordered without sold-out trouble, to
 * collect at the first time tomorrow, paid at the counter. Returns
 * [{ id, token, number, date }] in the order placed (`date`: their day).
 */
export async function placeOrders({ venueId, n = 1, qty = [1] }) {
  const guest = as(null, null)
  const page = await ok(guest.get(`/order-api/venues/${venueId}`))
  const dishes = page.menus.flatMap(m => m.sections.flatMap(x => x.items)).filter(i => i.price_pence > 0 && !i.sold_out && i.kind !== 'combo')
  assert.ok(dishes.length, 'a dish to order')
  const picksOf = item => Object.fromEntries((item.choices || []).filter(c => c.min > 0).map(c => [c.key, c.options.slice(0, c.min).map(o => o.id)]))
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
  const when = (await ok(guest.get(`/order-api/venues/${venueId}/slots?date=${tomorrow}`))).slots.find(x => x.available)?.at
  assert.ok(when, 'a collection time tomorrow')
  const out = []
  for (let i = 0; i < n; i++) {
    // A different dish each time where the menu has them, so dish reports have more than one row.
    const item = dishes[i % dishes.length]
    const placed = await guest.post(`/order-api/venues/${venueId}/orders`, {
      lines: [{ item_id: item.id, qty: qty[i % qty.length], choices: picksOf(item) }], when, data_consent: true, payment_method: 'pay_at_venue',
      customer: { name: 'Zed Guest ' + (i + 1), email: `zed${i + 1}@example.test`, phone: '0770090055' + i },
    })
    assert.equal(placed.status, 201, placed.body)
    const [o] = await sql`SELECT id, order_number, service_date::text AS date FROM orders WHERE public_token = ${placed.json.token}`
    out.push({ id: o.id, token: placed.json.token, number: o.order_number, date: o.date, dish: item.name })
  }
  return out
}
