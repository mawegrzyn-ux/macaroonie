// A stand-in for Square's API v2 (sales import phase 5, migration 294; as
// fake-loyverse.mjs stands in for Loyverse). One server answers for both
// Square environments: paths under /sandbox are the sandbox (each call
// records which). Serves the merchant, locations, the catalogue
// (SearchCatalogObjects, paged; BatchRetrieve), orders (SearchOrders by
// location, state, created or updated time, sorted, paged by cursor),
// webhook subscriptions (with a signature key) and OAuth (ObtainToken for a
// code or a refresh token, revoke). Controls:
//   fake.orders          the orders it holds (change one to make it "updated")
//   fake.limitNext(n)    answer the next n requests with 429
//   fake.calls           every request [{ env, method, path, body, auth }]
//   fake.subscriptions   webhook subscriptions made
//   fake.revoked         access tokens revoked
// Orders are made by makeOrders(now): a variation with a modifier, a
// discount, included VAT, a tip and a service charge, a cash sale, a return
// of part of the first, a cancelled order, one at another location, and
// three old ones for the history; customer details that must never be stored.
import http from 'node:http'

export const TOKEN = 'sq-fake-token-2718'
export const MERCHANT = 'M-ZQX'
export const OAUTH_MERCHANT = 'M-OAUTH'
export const SIGNATURE_KEY = 'sq-signature-key-abcdef'
export const APP_ID = 'sandbox-sq0idb-zqxtest'
export const APP_SECRET = 'sandbox-sq0csb-zqxsecret'
export const PAGE = 2
export const CATALOG_PAGE = 3

const iso = ms => new Date(ms).toISOString()
const gbp = amount => ({ amount, currency: 'GBP' })

export const LOCATIONS = [
  { id: 'L1', name: 'Zqx High St', status: 'ACTIVE', currency: 'GBP', timezone: 'Europe/London',
    business_email: 'owner@example.com', phone_number: '07700 900999', address: { address_line_1: '1 High St' } },
  { id: 'L2', name: 'Zqx Station', status: 'ACTIVE', currency: 'GBP', timezone: 'Europe/London' },
  { id: 'L3', name: 'Closed one', status: 'INACTIVE', currency: 'GBP', timezone: 'Europe/London' },
]

const T0 = '2026-01-10T10:00:00Z'
const variation = (id, itemId, name, amount, sku = null) => ({
  type: 'ITEM_VARIATION', id, updated_at: T0, is_deleted: false,
  item_variation_data: { item_id: itemId, name, sku, pricing_type: 'FIXED_PRICING', price_money: gbp(amount),
    location_overrides: [{ location_id: 'L1', price_money: gbp(amount + 10) }] },
})
export const CATALOG = [
  { type: 'CATEGORY', id: 'cat-coffee', updated_at: T0, category_data: { name: 'Coffee' } },
  { type: 'ITEM', id: 'it-latte', updated_at: T0, item_data: {
    name: 'Latte', category_id: 'cat-coffee', tax_ids: ['tax-vat'], product_type: 'FOOD_AND_BEV',
    modifier_list_info: [{ modifier_list_id: 'ml-milk', enabled: true }],
    variations: [variation('var-latte-reg', 'it-latte', 'Regular', 300, 'LAT-R'), variation('var-latte-lrg', 'it-latte', 'Large', 350, 'LAT-L')],
  } },
  { type: 'ITEM', id: 'it-bagel', updated_at: T0, item_data: {
    name: 'Bagel', category_id: 'cat-food', variations: [variation('var-bagel', 'it-bagel', 'Regular', 250, 'BAG')],
  } },
  { type: 'MODIFIER_LIST', id: 'ml-milk', updated_at: T0, modifier_list_data: { name: 'Milk', modifiers: [
    { type: 'MODIFIER', id: 'mod-oat', updated_at: T0, modifier_data: { name: 'Oat milk', price_money: gbp(40), modifier_list_id: 'ml-milk' } },
    { type: 'MODIFIER', id: 'mod-soy', updated_at: T0, modifier_data: { name: 'Soy milk', price_money: gbp(45), modifier_list_id: 'ml-milk' } },
  ] } },
  { type: 'TAX', id: 'tax-vat', updated_at: T0, tax_data: { name: 'VAT', inclusion_type: 'INCLUSIVE', percentage: '20' } },
  { type: 'DISCOUNT', id: 'disc-staff', updated_at: T0, discount_data: { name: 'Staff', discount_type: 'FIXED_PERCENTAGE', percentage: '10' } },
]

/** The orders, relative to `now` (ms). */
export function makeOrders(now) {
  const h = 3600_000
  const at = ago => iso(now - ago)
  const base = (id, loc, ago, extra = {}) => ({
    id, location_id: loc, state: 'COMPLETED', version: 1, source: { name: 'Square Point of Sale' },
    created_at: at(ago), updated_at: at(ago), closed_at: at(ago),
    line_items: [], taxes: [], discounts: [], service_charges: [], tenders: [], fulfillments: [],
    total_money: gbp(0), total_tax_money: gbp(0), total_discount_money: gbp(0), total_tip_money: gbp(0), total_service_charge_money: gbp(0),
    ...extra,
  })
  return [
    // Two large lattes with oat milk, 10% staff discount, VAT included, a 50p
    // service charge, a £1 tip, a customer and a pickup for a named person.
    base('ORD-1', 'L1', 30 * h, {
      reference_id: 'R-1001', customer_id: 'cust-9', ticket_name: 'Jo Bloggs',
      metadata: { phone: '07700 900123' },
      fulfillments: [{ uid: 'f1', type: 'PICKUP', state: 'COMPLETED', pickup_details: {
        recipient: { display_name: 'Jo Bloggs', email_address: 'jo@example.com', phone_number: '07700 900123' }, note: 'Jo at the door' } }],
      taxes: [{ uid: 'tx1', catalog_object_id: 'tax-vat', name: 'VAT', type: 'INCLUSIVE', percentage: '20', scope: 'LINE_ITEM', applied_money: gbp(117) }],
      discounts: [{ uid: 'd1', catalog_object_id: 'disc-staff', name: 'Staff', type: 'FIXED_PERCENTAGE', percentage: '10', scope: 'LINE_ITEM', applied_money: gbp(78) }],
      service_charges: [{ uid: 's1', name: 'Service', amount_money: gbp(50), applied_money: gbp(50), total_money: gbp(50), total_tax_money: gbp(0), calculation_phase: 'SUBTOTAL_PHASE' }],
      line_items: [{
        uid: 'li1', name: 'Latte', quantity: '2', catalog_object_id: 'var-latte-lrg', variation_name: 'Large', item_type: 'ITEM',
        note: 'extra hot', base_price_money: gbp(350), variation_total_price_money: gbp(700), gross_sales_money: gbp(780),
        total_discount_money: gbp(78), total_tax_money: gbp(117), total_money: gbp(702),
        modifiers: [{ uid: 'm1', catalog_object_id: 'mod-oat', name: 'Oat milk', quantity: '1', base_price_money: gbp(40), total_price_money: gbp(80) }],
        applied_taxes: [{ uid: 'at1', tax_uid: 'tx1', applied_money: gbp(117) }],
        applied_discounts: [{ uid: 'ad1', discount_uid: 'd1', applied_money: gbp(78) }],
      }],
      total_money: gbp(752), total_tax_money: gbp(117), total_discount_money: gbp(78), total_tip_money: gbp(100), total_service_charge_money: gbp(50),
      tenders: [{ id: 'tn1', type: 'CARD', created_at: at(30 * h), note: 'Jo Bloggs paid', amount_money: gbp(852), tip_money: gbp(100), customer_id: 'cust-9',
        card_details: { status: 'CAPTURED', entry_method: 'CONTACTLESS', card: { card_brand: 'VISA', last_4: '4242', fingerprint: 'fp-1', cardholder_name: 'J BLOGGS', exp_month: 4 } } }],
    }),
    // A bagel for cash: odd pence, nothing converted.
    base('ORD-2', 'L1', 29 * h, {
      line_items: [{ uid: 'li2', name: 'Bagel', quantity: '1', catalog_object_id: 'var-bagel', variation_name: 'Regular', item_type: 'ITEM',
        base_price_money: gbp(1999), gross_sales_money: gbp(1999), total_discount_money: gbp(0), total_tax_money: gbp(333), total_money: gbp(1999) }],
      total_money: gbp(1999), total_tax_money: gbp(333),
      tenders: [{ id: 'tn2', type: 'CASH', created_at: at(29 * h), amount_money: gbp(1999), cash_details: { buyer_tendered_money: gbp(2000), change_back_money: gbp(1) } }],
    }),
    // A return of one of ORD-1's lattes.
    base('ORD-3', 'L1', 28 * h, {
      returns: [{ uid: 'r1', source_order_id: 'ORD-1', return_line_items: [{
        uid: 'rl1', source_line_item_uid: 'li1', name: 'Latte', quantity: '1', catalog_object_id: 'var-latte-lrg', variation_name: 'Large',
        base_price_money: gbp(350), gross_return_money: gbp(390), total_discount_money: gbp(39), total_tax_money: gbp(58), total_money: gbp(351),
        return_modifiers: [{ uid: 'rm1', catalog_object_id: 'mod-oat', name: 'Oat milk', quantity: '1', base_price_money: gbp(40), total_price_money: gbp(40) }],
      }] }],
      return_amounts: { total_money: gbp(351), tax_money: gbp(58), discount_money: gbp(39), tip_money: gbp(0), service_charge_money: gbp(0) },
      refunds: [{ id: 'rf1', tender_id: 'tn1', amount_money: gbp(351), status: 'COMPLETED', created_at: at(28 * h) }],
    }),
    // Cancelled before it was paid.
    base('ORD-4', 'L1', 27 * h, {
      state: 'CANCELED', closed_at: null,
      line_items: [{ uid: 'li4', name: 'Bagel', quantity: '1', catalog_object_id: 'var-bagel', variation_name: 'Regular',
        base_price_money: gbp(250), gross_sales_money: gbp(250), total_discount_money: gbp(0), total_tax_money: gbp(0), total_money: gbp(250) }],
      total_money: gbp(250),
    }),
    // Another location, linked to no venue.
    base('ORD-5', 'L2', 26 * h, {
      line_items: [{ uid: 'li5', name: 'Bagel', quantity: '1', catalog_object_id: 'var-bagel', variation_name: 'Regular',
        base_price_money: gbp(250), gross_sales_money: gbp(250), total_discount_money: gbp(0), total_tax_money: gbp(0), total_money: gbp(250) }],
      total_money: gbp(250), tenders: [{ id: 'tn5', type: 'CASH', amount_money: gbp(250) }],
    }),
    // Still open: never read.
    base('ORD-6', 'L1', 25 * h, { state: 'OPEN', closed_at: null, total_money: gbp(500) }),
    // History: three regular lattes over a month ago.
    ...[40, 41, 42].map((d, i) => base('ORD-H' + i, 'L1', d * 24 * h, {
      line_items: [{ uid: 'lh' + i, name: 'Latte', quantity: '1', catalog_object_id: 'var-latte-reg', variation_name: 'Regular',
        base_price_money: gbp(300), gross_sales_money: gbp(300), total_discount_money: gbp(0), total_tax_money: gbp(50), total_money: gbp(300) }],
      total_money: gbp(300), total_tax_money: gbp(50),
      tenders: [{ id: 'tnh' + i, type: 'CARD', amount_money: gbp(300), card_details: { card: { card_brand: 'MASTERCARD', last_4: '1111' } } }],
    })),
  ]
}

export async function startFakeSquare({ now = Date.now() } = {}) {
  const fake = {
    orders: makeOrders(now), catalog: JSON.parse(JSON.stringify(CATALOG)), calls: [], subscriptions: [], revoked: [],
    tokens: new Map([[TOKEN, MERCHANT]]), refresh: new Map(), limited: 0, nextSub: 1, nextToken: 1,
    limitNext(n) { this.limited = n },
  }
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body == null ? '' : JSON.stringify(body)) }

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const u = new URL(req.url, 'http://x')
      let path = u.pathname
      let env = 'production'
      if (path.startsWith('/sandbox/')) { env = 'sandbox'; path = path.slice('/sandbox'.length) }
      let body = null
      try { body = raw ? JSON.parse(raw) : null } catch { return send(res, 400, { errors: [{ code: 'BAD_REQUEST' }] }) }
      const auth = req.headers.authorization || ''
      fake.calls.push({ env, method: req.method, path, body, auth, version: req.headers['square-version'] })
      if (fake.limited > 0) { fake.limited--; res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' }); return res.end('{}') }

      // OAuth (no bearer token).
      if (path === '/oauth2/token' && req.method === 'POST') {
        if (body?.client_id !== APP_ID || body?.client_secret !== APP_SECRET) return send(res, 401, { errors: [{ code: 'UNAUTHORIZED' }] })
        const make = () => {
          const access = 'sq-oauth-access-' + fake.nextToken++
          const refresh = 'sq-oauth-refresh-' + fake.nextToken
          fake.tokens.set(access, OAUTH_MERCHANT)
          fake.refresh.set(refresh, OAUTH_MERCHANT)
          return { access_token: access, token_type: 'bearer', expires_at: iso(Date.now() + 30 * 86400_000), merchant_id: OAUTH_MERCHANT, refresh_token: refresh }
        }
        if (body.grant_type === 'authorization_code') return body.code === 'good-code' ? send(res, 200, make()) : send(res, 401, { errors: [{ code: 'INVALID_CODE' }] })
        if (body.grant_type === 'refresh_token') return fake.refresh.has(body.refresh_token) ? send(res, 200, make()) : send(res, 401, { errors: [{ code: 'INVALID_REFRESH' }] })
        return send(res, 400, { errors: [{ code: 'BAD_GRANT' }] })
      }
      if (path === '/oauth2/revoke' && req.method === 'POST') {
        if (auth !== 'Client ' + APP_SECRET) return send(res, 401, { errors: [{ code: 'UNAUTHORIZED' }] })
        fake.revoked.push(body?.access_token)
        fake.tokens.delete(body?.access_token)
        return send(res, 200, { success: true })
      }

      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
      const merchant = fake.tokens.get(token)
      if (!merchant) return send(res, 401, { errors: [{ category: 'AUTHENTICATION_ERROR', code: 'UNAUTHORIZED' }] })

      if (path === '/v2/merchants/me') {
        return send(res, 200, { merchant: { id: merchant, business_name: merchant === MERCHANT ? 'Zqx Coffee Ltd' : 'Zqx OAuth Cafe', country: 'GB', currency: 'GBP' } })
      }
      if (path === '/v2/locations') return send(res, 200, { locations: LOCATIONS })

      if (path === '/v2/catalog/search' && req.method === 'POST') {
        const types = new Set(body?.object_types || [])
        const since = body?.begin_time ? Date.parse(body.begin_time) : null
        let list = fake.catalog.filter(o => types.has(o.type) && (body?.include_deleted_objects || !o.is_deleted)
          && (since == null || Date.parse(o.updated_at) >= since))
        const start = Number(body?.cursor || 0)
        const page = list.slice(start, start + CATALOG_PAGE)
        const next = start + CATALOG_PAGE < list.length ? String(start + CATALOG_PAGE) : undefined
        return send(res, 200, { objects: page, ...(next ? { cursor: next } : {}) })
      }
      if (path === '/v2/catalog/batch-retrieve' && req.method === 'POST') {
        const ids = new Set(body?.object_ids || [])
        return send(res, 200, { objects: fake.catalog.filter(o => ids.has(o.id)) })
      }

      if (path === '/v2/orders/search' && req.method === 'POST') {
        const locs = body?.location_ids || []
        if (!locs.length || locs.length > 10) return send(res, 400, { errors: [{ code: 'INVALID_VALUE', detail: 'location_ids' }] })
        const filter = body?.query?.filter || {}
        const states = new Set(filter.state_filter?.states || [])
        const [[field, range] = []] = Object.entries(filter.date_time_filter || {})
        const sortField = body?.query?.sort?.sort_field
        if (field && sortField && sortField.toLowerCase() !== field) return send(res, 400, { errors: [{ code: 'INVALID_SORT' }] })
        let list = fake.orders.filter(o => locs.includes(o.location_id) && (!states.size || states.has(o.state)))
        if (field) {
          list = list.filter(o => (!range.start_at || Date.parse(o[field]) >= Date.parse(range.start_at))
            && (!range.end_at || Date.parse(o[field]) < Date.parse(range.end_at)))
          list.sort((a, b) => Date.parse(a[field]) - Date.parse(b[field]) || a.id.localeCompare(b.id))
        }
        const start = Number(body?.cursor || 0)
        const page = list.slice(start, start + PAGE)
        const next = start + PAGE < list.length ? String(start + PAGE) : undefined
        return send(res, 200, { orders: page, ...(next ? { cursor: next } : {}) })
      }

      if (path === '/v2/webhooks/subscriptions' && req.method === 'POST') {
        if (merchant !== MERCHANT) return send(res, 403, { errors: [{ code: 'FORBIDDEN', detail: 'Use the application\'s personal access token' }] })
        const s = { id: 'sub-' + fake.nextSub++, ...body.subscription, signature_key: SIGNATURE_KEY + '-' + (fake.nextSub - 1) }
        fake.subscriptions.push(s)
        return send(res, 200, { subscription: s })
      }
      const del = /^\/v2\/webhooks\/subscriptions\/(.+)$/.exec(path)
      if (del && req.method === 'DELETE') {
        const i = fake.subscriptions.findIndex(s => s.id === decodeURIComponent(del[1]))
        if (i < 0) return send(res, 404, { errors: [{ code: 'NOT_FOUND' }] })
        fake.subscriptions.splice(i, 1)
        return send(res, 200, {})
      }
      return send(res, 404, { errors: [{ code: 'NOT_FOUND' }] })
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  fake.url = 'http://127.0.0.1:' + server.address().port
  fake.close = () => new Promise(r => server.close(r))
  return fake
}
