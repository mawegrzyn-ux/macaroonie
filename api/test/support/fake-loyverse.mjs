// A stand-in for Loyverse's API v1.0 (sales import, migrations 288 to 290;
// as local-info.test.mjs stands in for Open-Meteo). Serves the merchant,
// stores, items with variants, modifiers with options, the short lists, and
// receipts filtered by store and by created or updated time, paged by cursor
// (PAGE receipts a page, so a small set still has several pages); webhooks
// can be registered and removed. Controls:
//   fake.receipts        the receipts it holds (change one to make it "updated")
//   fake.limitNext(n)    answer the next n requests with 429
//   fake.calls           every request [{ method, path, query }]
//   fake.webhooks        registered webhooks
// Receipts are made by makeReceipts(now): variants, modifiers, a refund, a
// cancellation (later), discounts, added and included tax, a tip, a
// late-synced receipt, one at another store, and customer details that must
// never be stored.
import http from 'node:http'

export const TOKEN = 'lv-fake-token-3141'
export const PAGE = 3

const iso = ms => new Date(ms).toISOString()

export const ITEMS = [
  {
    id: 'it-coffee', item_name: 'Flat white', category_id: 'cat-hot', option1_name: 'Size', option2_name: 'Milk',
    modifier_ids: ['mod-extras'], tax_ids: ['tax-vat'], updated_at: '2026-01-10T10:00:00Z',
    variants: [
      { variant_id: 'var-reg-dairy', item_id: 'it-coffee', sku: 'FW-R-D', option1_value: 'Regular', option2_value: 'Dairy', default_price: 2.9, stores: [{ store_id: 'st1', price: 2.9, available_for_sale: true }] },
      { variant_id: 'var-lrg-oat', item_id: 'it-coffee', sku: 'FW-L-O', option1_value: 'Large', option2_value: 'Oat', default_price: 3.2, stores: [{ store_id: 'st1', price: 3.2, available_for_sale: true }] },
    ],
  },
  {
    id: 'it-croissant', item_name: 'Croissant', category_id: 'cat-bake', tax_ids: ['tax-added'], updated_at: '2026-01-10T10:00:00Z',
    variants: [{ variant_id: 'var-croissant', item_id: 'it-croissant', sku: 'CRS', default_price: 2.5, stores: [] }],
  },
]

export const MODIFIERS = [
  { id: 'mod-extras', name: 'Extras', updated_at: '2026-01-10T10:00:00Z', modifier_options: [
    { id: 'opt-shot', name: 'Extra shot', price: 0.5, position: 1 },
    { id: 'opt-syrup', name: 'Vanilla syrup', price: 0.4, position: 2 },
  ] },
]

/** The receipts, relative to `now` (ms). */
export function makeReceipts(now) {
  const h = 3600_000
  const at = ago => iso(now - ago)
  const base = (n, store, ago, extra = {}) => ({
    receipt_number: n, receipt_type: 'SALE', refund_for: null, order: null, note: null, source: 'point of sale',
    created_at: at(ago), updated_at: at(ago), receipt_date: at(ago), cancelled_at: null,
    store_id: store, pos_device_id: 'dev-1', employee_id: 'emp-1', customer_id: null, dining_option: 'Eat in',
    total_discounts: [], total_taxes: [], tip: 0, surcharge: 0, payments: [], line_items: [], ...extra,
  })
  return [
    // Two large oat flat whites with an extra shot, 10% off, VAT included, a tip, a customer.
    base('1-1001', 'st1', 30 * h, {
      customer_id: 'cust-77', order: 'Jo Bloggs', note: 'Jo rang on 07700 900123',
      customer_name: 'Jo Bloggs', customer_email: 'jo@example.com', customer_phone: '07700 900123',
      total_money: 6.66, total_tax: 1.11, total_discount: 0.74, tip: 1, surcharge: 0,
      total_discounts: [{ id: 'disc-10', type: 'FIXED_PERCENT', name: 'Staff 10%', percentage: 10, money_amount: 0.74 }],
      total_taxes: [{ id: 'tax-vat', type: 'INCLUDED', name: 'VAT', rate: 20, money_amount: 1.11 }],
      payments: [{ payment_type_id: 'pt-card', name: 'Card', type: 'CARD', money_amount: 7.66, paid_at: at(30 * h),
        payment_details: { authorization_code: 'A1', card_company: 'VISA', card_number: '4242', cardholder_name: 'J BLOGGS' } }],
      line_items: [{
        id: 'li-1', item_id: 'it-coffee', variant_id: 'var-lrg-oat', item_name: 'Flat white', variant_name: 'Large / Oat', sku: 'FW-L-O',
        quantity: 2, price: 3.2, gross_total_money: 7.4, total_money: 6.66, total_discount: 0.74, cost: 0.6, cost_total: 1.2,
        line_note: 'extra hot',
        line_taxes: [{ id: 'tax-vat', type: 'INCLUDED', name: 'VAT', rate: 20, money_amount: 1.11 }],
        line_discounts: [{ id: 'disc-10', type: 'FIXED_PERCENT', name: 'Staff 10%', percentage: 10, money_amount: 0.74 }],
        line_modifiers: [{ id: 'lm-1', modifier_option_id: 'opt-shot', name: 'Extras', option: 'Extra shot', price: 0.5, money_amount: 1 }],
      }],
    }),
    // A croissant with tax added on top and a surcharge.
    base('1-1002', 'st1', 29 * h, {
      total_money: 2.83, total_tax: 0.13, total_discount: 0, surcharge: 0.2,
      total_taxes: [{ id: 'tax-added', type: 'ADDED', name: 'Sales tax', rate: 5, money_amount: 0.13 }],
      payments: [{ payment_type_id: 'pt-cash', name: 'Cash', type: 'CASH', money_amount: 2.83, paid_at: at(29 * h) }],
      line_items: [{
        id: 'li-2', item_id: 'it-croissant', variant_id: 'var-croissant', item_name: 'Croissant', variant_name: null, sku: 'CRS',
        quantity: 1, price: 2.5, gross_total_money: 2.5, total_money: 2.5, total_discount: 0,
        line_taxes: [{ id: 'tax-added', type: 'ADDED', name: 'Sales tax', rate: 5, money_amount: 0.13 }], line_discounts: [], line_modifiers: [],
      }],
    }),
    // A refund of one of 1-1001's coffees.
    base('1-1003', 'st1', 28 * h, {
      receipt_type: 'REFUND', refund_for: '1-1001', total_money: 3.33, total_tax: 0.56, total_discount: 0.37,
      payments: [{ payment_type_id: 'pt-card', name: 'Card', type: 'CARD', money_amount: 3.33, paid_at: at(28 * h) }],
      line_items: [{
        id: 'li-3', item_id: 'it-coffee', variant_id: 'var-lrg-oat', item_name: 'Flat white', variant_name: 'Large / Oat', sku: 'FW-L-O',
        quantity: 1, price: 3.2, gross_total_money: 3.7, total_money: 3.33, total_discount: 0.37,
        line_taxes: [], line_discounts: [], line_modifiers: [{ id: 'lm-3', modifier_option_id: 'opt-shot', name: 'Extras', option: 'Extra shot', price: 0.5, money_amount: 0.5 }],
      }],
    }),
    // A plain sale (cancelled later by the test).
    base('1-1004', 'st1', 27 * h, {
      total_money: 2.9, total_tax: 0.48, total_discount: 0,
      payments: [{ payment_type_id: 'pt-cash', name: 'Cash', type: 'CASH', money_amount: 2.9, paid_at: at(27 * h) }],
      line_items: [{ id: 'li-4', item_id: 'it-coffee', variant_id: 'var-reg-dairy', item_name: 'Flat white', variant_name: 'Regular / Dairy',
        quantity: 1, price: 2.9, gross_total_money: 2.9, total_money: 2.9, total_discount: 0, line_taxes: [], line_discounts: [], line_modifiers: [] }],
    }),
    // Made offline three days ago, reached Loyverse an hour ago.
    base('1-1005', 'st1', 1 * h, {
      receipt_date: at(72 * h),
      total_money: 2.5, total_tax: 0, total_discount: 0,
      payments: [{ payment_type_id: 'pt-cash', name: 'Cash', type: 'CASH', money_amount: 2.5, paid_at: at(72 * h) }],
      line_items: [{ id: 'li-5', item_id: 'it-croissant', variant_id: 'var-croissant', item_name: 'Croissant', quantity: 1, price: 2.5,
        gross_total_money: 2.5, total_money: 2.5, total_discount: 0, line_taxes: [], line_discounts: [], line_modifiers: [] }],
    }),
    // Another store, not linked to a venue: kept raw only.
    base('2-2001', 'st2', 26 * h, {
      total_money: 9.99, total_tax: 0, total_discount: 0,
      payments: [{ payment_type_id: 'pt-cash', name: 'Cash', type: 'CASH', money_amount: 9.99 }],
      line_items: [{ id: 'li-6', item_id: 'it-croissant', item_name: 'Croissant', quantity: 4, price: 2.5, gross_total_money: 9.99, total_money: 9.99, line_modifiers: [] }],
    }),
    // A month ago: only the history import finds it.
    base('1-0900', 'st1', 40 * 24 * h, {
      total_money: 3.2, total_tax: 0.53, total_discount: 0,
      payments: [{ payment_type_id: 'pt-card', name: 'Card', type: 'CARD', money_amount: 3.2 }],
      line_items: [{ id: 'li-7', item_id: 'it-coffee', variant_id: 'var-lrg-oat', item_name: 'Flat white', variant_name: 'Large / Oat', quantity: 1, price: 3.2,
        gross_total_money: 3.2, total_money: 3.2, total_discount: 0, line_taxes: [], line_discounts: [], line_modifiers: [] }],
    }),
  ]
}

export async function startFakeLoyverse({ now = Date.now(), token = TOKEN } = {}) {
  const fake = { receipts: makeReceipts(now), calls: [], webhooks: [], limited: 0, made: 0 }
  fake.limitNext = n => { fake.limited = n }
  const list = (key, rows, q) => {
    const start = Number(q.get('cursor') || 0)
    const size = key === 'receipts' ? PAGE : 250
    const page = rows.slice(start, start + size)
    return { [key]: page, cursor: start + size < rows.length ? String(start + size) : null }
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    fake.calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams) })
    res.setHeader('content-type', 'application/json')
    const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'Bearer ' + token) return send(401, { errors: [{ code: 'UNAUTHORIZED' }] })
    if (fake.limited > 0) { fake.limited--; res.setHeader('retry-after', '0'); return send(429, { errors: [{ code: 'RATE_LIMITED' }] }) }
    const q = u.searchParams
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const p = u.pathname
      if (p === '/merchant') return send(200, { id: 'm-1', business_name: 'Zqx Coffee', currency: { code: 'GBP' } })
      if (p === '/stores') return send(200, list('stores', [{ id: 'st1', name: 'Ware' }, { id: 'st2', name: 'Hertford' }], q))
      if (p === '/items') {
        const min = q.get('updated_at_min')
        return send(200, list('items', ITEMS.filter(i => !min || i.updated_at >= min), q))
      }
      if (p === '/modifiers') return send(200, list('modifiers', MODIFIERS, q))
      if (p === '/categories') return send(200, list('categories', [{ id: 'cat-hot', name: 'Hot drinks' }, { id: 'cat-bake', name: 'Bakery' }], q))
      if (p === '/taxes') return send(200, list('taxes', [{ id: 'tax-vat', name: 'VAT', type: 'INCLUDED', rate: 20 }, { id: 'tax-added', name: 'Sales tax', type: 'ADDED', rate: 5 }], q))
      if (p === '/discounts') return send(200, list('discounts', [{ id: 'disc-10', name: 'Staff 10%', type: 'FIXED_PERCENT', discount_percent: 10 }], q))
      if (p === '/payment_types') return send(200, list('payment_types', [{ id: 'pt-card', name: 'Card', type: 'CARD' }, { id: 'pt-cash', name: 'Cash', type: 'CASH' }], q))
      if (p === '/employees') return send(200, list('employees', [{ id: 'emp-1', name: 'Sam', email: 'sam@example.com', phone_number: '07700 900456', stores: ['st1'] }], q))
      if (p === '/pos_devices') return send(200, list('pos_devices', [{ id: 'dev-1', name: 'Till 1', store_id: 'st1' }], q))
      if (p === '/dining_options') return send(404, { errors: [{ code: 'NOT_FOUND' }] })
      if (p === '/receipts') {
        const store = q.get('store_id')
        const inRange = (v, lo, hi) => (!lo || v >= lo) && (!hi || v <= hi)
        const rows = fake.receipts
          .filter(r => !store || r.store_id === store)
          .filter(r => inRange(r.created_at, q.get('created_at_min'), q.get('created_at_max')))
          .filter(r => inRange(r.updated_at, q.get('updated_at_min'), q.get('updated_at_max')))
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
        return send(200, list('receipts', rows, q))
      }
      if (p === '/webhooks' && req.method === 'POST') {
        const b = JSON.parse(body || '{}')
        const w = { id: 'wh-' + (++fake.made), ...b }
        fake.webhooks.push(w)
        return send(200, w)
      }
      if (p.startsWith('/webhooks/') && req.method === 'DELETE') {
        fake.webhooks = fake.webhooks.filter(w => w.id !== p.slice('/webhooks/'.length))
        res.statusCode = 204
        return res.end()
      }
      return send(404, { errors: [{ code: 'NOT_FOUND' }] })
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  server.unref()
  fake.url = 'http://127.0.0.1:' + server.address().port
  fake.close = () => new Promise(r => server.close(r))
  return fake
}

let shared = null
/** One stand-in per test process, for the fixtures. */
export function sharedFakeLoyverse() {
  shared ||= startFakeLoyverse()
  return shared
}
