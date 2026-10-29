// Stripe Connect (migration 215): the platform's keys on the Platform page;
// a group connects its own Stripe account (Ordering setup); online orders
// paid with Card (Stripe) on that account with the platform fee, read back
// from Stripe (never the browser), settled by signed webhooks and refunded
// with the fee; Stripe card machines through the connected account (no key
// of their own), with a Terminal location made from the venue's address.
// Against a stand-in Stripe (support/fake-stripe-connect.mjs); refusals for
// roles, another tenant and bad webhooks.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B, PLATFORM } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { startFakeStripe, PLATFORM_KEY } from './support/fake-stripe-connect.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { signPayload, forgetPlatformKeys } from '../src/services/stripeConnect.js'
import { env } from '../src/config/env.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, fake, W, filled, account, token, order, payment
const WEBHOOK = 'whsec_test_connect_123'

async function call(method, url, { body, headers = {}, raw } = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
const device = (d, method, url, body) => call(method, url, { body, headers: { authorization: `Device ${d.device_id}.${d.secret}` } })
const hook = (event, secret = WEBHOOK) => {
  const raw = JSON.stringify(event)
  return call('POST', '/webhooks/payments/stripe', { raw, headers: { 'stripe-signature': signPayload(raw, secret) } })
}

async function placeStripeOrder() {
  const date = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
  const slots = await call('GET', `/order-api/venues/${W}/slots?date=${date}`)
  const at = (slots.json?.slots || []).find(s => s.available)?.at
  assert.ok(at, 'a slot tomorrow')
  const menu = await call('GET', `/order-api/venues/${W}`)
  const plain = menu.json.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(it => !it.sold_out && it.kind !== 'combo')
  const choices = Object.fromEntries((plain.choices || []).filter(c => c.min > 0).map(c => [c.key, c.options.slice(0, c.min).map(o => o.id)]))
  const placed = await call('POST', `/order-api/venues/${W}/orders`, { body: {
    lines: [{ item_id: plain.id, qty: 2, choices }], when: at, data_consent: true, payment_method: 'stripe',
    customer: { name: 'Pat Card', email: 'pat@zqx.test', phone: '07700900111' },
  } })
  assert.equal(placed.status, 201, placed.body)
  const [o] = await sql`SELECT * FROM orders WHERE public_token = ${placed.json.token}`
  return { placed: placed.json, order: o }
}

before(async () => {
  fake = await startFakeStripe()
  env.STRIPE_API_URL = fake.base
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  W = filled.ids.venue
  await ok(owner.patch('/api/website/tenant-site', { is_published: true }))
})
after(async () => { await closeApp(); await fake?.close() })

test('platform keys: checked with Stripe, never sent back, same mode; platform admins only', async () => {
  const pa = as(PLATFORM, null)
  const start = await ok(pa.get('/api/platform/stripe'))
  assert.equal(start.keys.secret.source, 'env', 'STRIPE_SECRET_KEY from the .env')
  assert.equal(start.ready, false, 'no publishable key yet')
  assert.match(start.webhook_url, /\/webhooks\/payments\/stripe$/)
  const bad = await pa.put('/api/platform/stripe', { secret: 'sk_test_wrong_key_999' })
  assert.equal(bad.status, 422)
  assert.match(bad.json.error, /refused/)
  assert.equal((await pa.put('/api/platform/stripe', { publishable: 'pk_live_abc123', secret: PLATFORM_KEY })).status, 422, 'test secret, live publishable')
  assert.equal((await pa.put('/api/platform/stripe', { webhook: 'nope' })).status, 400)
  const saved = await ok(pa.put('/api/platform/stripe', { secret: PLATFORM_KEY, publishable: 'pk_test_pub_5678', webhook: WEBHOOK }))
  assert.equal(saved.ready, true)
  assert.equal(saved.mode, 'test')
  assert.equal(saved.keys.secret.source, 'platform')
  assert.equal(saved.keys.secret.hint, '1234')
  assert.ok(!JSON.stringify(saved).includes(PLATFORM_KEY) && !JSON.stringify(saved).includes(WEBHOOK), 'no key in the reply')
  const [row] = await sql`SELECT value FROM platform_secrets WHERE name = 'stripe_secret_key'`
  assert.match(row.value, /^v1:/, 'sealed at rest')
  assert.equal((await owner.get('/api/platform/stripe')).status, 403, 'a tenant owner')
  assert.equal((await owner.put('/api/platform/stripe', { secret: PLATFORM_KEY })).status, 403)
})

test('a group connects its Stripe account; it can take payments once Stripe says so; the site registers for Apple Pay', async () => {
  const s0 = await ok(owner.get('/api/stripe'))
  assert.equal(s0.connected, false)
  assert.equal(s0.platform_ready, true)
  assert.equal((await owner.post('/api/stripe/connect', { return_url: 'https://evil.example/orders/settings' })).status, 400, 'back to our admin only')
  assert.equal((await as(A.operator, ids.a).post('/api/stripe/connect', { return_url: 'https://office.macaroonie.com/orders/settings' })).status, 403, 'an operator')
  const link = await ok(owner.post('/api/stripe/connect', { return_url: 'https://office.macaroonie.com/orders/settings?x=1' }))
  assert.match(link.url, /^https:\/\/connect\.stripe\.test\/setup\/acct_/)
  account = link.url.split('/').at(-1)
  const made = fake.st.accounts[account]
  assert.equal(made.type, 'standard')
  assert.equal(made.metadata.tenant_id, ids.a)
  const sent = fake.st.links.at(-1)
  assert.equal(sent.return_url, 'https://office.macaroonie.com/orders/settings?x=1&stripe=return')
  assert.equal(sent.refresh_url, 'https://office.macaroonie.com/orders/settings?x=1&stripe=refresh')
  // Asked again: the same account, a new link.
  await ok(owner.post('/api/stripe/connect', { return_url: 'https://office.macaroonie.com/orders/settings' }))
  assert.equal(Object.keys(fake.st.accounts).length, 1)

  const pending = await ok(owner.post('/api/stripe/refresh', {}))
  assert.equal(pending.connected, true)
  assert.equal(pending.ready, false)
  assert.equal((await call('GET', `/order-api/venues/${W}`)).json.ordering.payment_methods.some(m => m.key === 'stripe'), false)

  fake.enable(account)
  const ready = await ok(owner.post('/api/stripe/refresh', {}))
  assert.equal(ready.ready, true)
  assert.equal(ready.account_name, 'Zqx Thai Ltd')
  assert.deepEqual(ready.domains.map(d => [d.domain, d.ok]), [['zqx-site.' + env.PUBLIC_ROOT_DOMAIN, true]])
  assert.equal(fake.st.domains[0].account, account, 'registered on the group\'s account')
  assert.equal((await as(A.viewer, ids.a).post('/api/stripe/connect', { return_url: 'https://office.macaroonie.com/x' })).status, 403)
  const other = await ok(as(B.owner, ids.b).get('/api/stripe'))
  assert.equal(other.connected, false, 'another group sees its own (none)')
})

test('an online order paid by card on the group\'s account, with the platform fee; the browser is never trusted', async () => {
  await ok(as(PLATFORM, null).patch('/api/platform/tenants/' + ids.a, { ordering_fee_percent: 2 }))
  const settings = (await ok(owner.get(`/api/orders/settings/${W}`))).settings
  await ok(owner.put(`/api/orders/settings/${W}`, { ...settings, payment_methods: ['stripe', 'pay_at_venue'] }))
  const menu = await call('GET', `/order-api/venues/${W}`)
  assert.deepEqual(menu.json.ordering.payment_methods.map(m => m.key), ['stripe', 'pay_at_venue'])

  const r = await placeStripeOrder()
  order = r.order
  token = r.placed.token
  payment = r.placed.payment
  assert.equal(payment.type, 'stripe')
  assert.equal(payment.publishable_key, 'pk_test_pub_5678')
  assert.equal(payment.account, account)
  const pi = fake.lastPi()
  assert.equal(payment.client_secret, pi.client_secret)
  assert.equal(pi.account, account, 'a direct charge on the group\'s account')
  assert.equal(pi.amount, order.total_pence)
  assert.equal(pi.currency, 'gbp')
  assert.equal(pi.automatic, true)
  assert.equal(order.platform_fee_pence > 0, true)
  assert.equal(pi.application_fee_amount, order.platform_fee_pence, 'the platform fee')
  assert.equal(pi.metadata.order_id, order.id)
  assert.equal(order.status, 'pending_payment')

  // The page says "done" before the card went through: still pending.
  const early = await call('POST', `/order-api/orders/${token}/payments/${payment.payment_id}/confirm`, { body: { outcome: 'succeed' } })
  assert.equal(early.status, 200, early.body)
  assert.equal(early.json.status, 'pending_payment', 'Stripe says not paid')
  fake.decline(pi.id)
  const declined = await call('POST', `/order-api/orders/${token}/payments/${payment.payment_id}/confirm`, { body: {} })
  assert.equal(declined.json.payment_status, 'failed')
  // Tried again with another card: paid.
  fake.st.pis[pi.id].last_payment_error = null
  fake.succeed(pi.id)
  const paid = await call('POST', `/order-api/orders/${token}/payments/${payment.payment_id}/confirm`, { body: {} })
  assert.equal(paid.json.payment_status, 'paid')
  assert.equal(paid.json.status, 'placed')
  const [p] = await sql`SELECT * FROM order_payments WHERE id = ${payment.payment_id}`
  assert.equal(p.gateway_ref, pi.id)
  assert.equal(p.raw.account, account)
})

test('webhooks: signed ones settle a payment the page never reported; bad ones are refused; account.updated', async () => {
  const { placed, order: o } = await placeStripeOrder()
  const pi = fake.lastPi()
  fake.succeed(pi.id)
  const event = { id: 'evt_1', type: 'payment_intent.succeeded', account, data: { object: fake.st.pis[pi.id] } }
  assert.equal((await hook(event, 'whsec_wrong')).status, 400, 'wrong signing secret')
  const raw = JSON.stringify(event)
  const stale = signPayload(raw, WEBHOOK, Math.floor(Date.now() / 1000) - 3600)
  assert.equal((await call('POST', '/webhooks/payments/stripe', { raw, headers: { 'stripe-signature': stale } })).status, 400, 'too old')
  assert.equal((await call('POST', '/webhooks/payments/stripe', { raw, headers: {} })).status, 400, 'no signature')
  const res = await hook(event)
  assert.equal(res.status, 200, res.body)
  const [after1] = await sql`SELECT status, payment_status FROM orders WHERE id = ${o.id}`
  assert.deepEqual([after1.status, after1.payment_status], ['placed', 'paid'])
  assert.equal((await hook(event)).status, 200, 'the same event again changes nothing')
  const [again] = await sql`SELECT paid_pence, total_pence FROM orders WHERE id = ${o.id}`
  assert.equal(again.paid_pence, again.total_pence, 'paid once')
  // A card machine payment (no order) and an unknown one are accepted and ignored.
  assert.equal((await hook({ id: 'evt_2', type: 'payment_intent.succeeded', account, data: { object: { object: 'payment_intent', id: 'pi_x', metadata: { macaroonie_payment: 'x' } } } })).status, 200)
  // Stripe stops the group's charges: checkout drops Card (Stripe).
  await hook({ id: 'evt_3', type: 'account.updated', account, data: { object: { ...fake.st.accounts[account], charges_enabled: false } } })
  assert.equal((await call('GET', `/order-api/venues/${W}`)).json.ordering.payment_methods.some(m => m.key === 'stripe'), false)
  await hook({ id: 'evt_4', type: 'account.updated', account, data: { object: fake.st.accounts[account] } })
  assert.equal((await call('GET', `/order-api/venues/${W}`)).json.ordering.payment_methods.some(m => m.key === 'stripe'), true)
  assert.ok(placed.token)
})

test('refunds go back through Stripe on the group\'s account, with the fee', async () => {
  const part = await ok(owner.post(`/api/orders/${order.id}/refund`, { amount_pence: 100, reason: 'Missing dip' }))
  assert.equal(part.order?.refunded_pence ?? part.refunded_pence, 100)
  const r = fake.st.refunds.at(-1)
  assert.equal(r.account, account)
  assert.equal(r.amount, 100)
  assert.equal(r.refund_application_fee, true)
  assert.equal((await as(B.owner, ids.b).post(`/api/orders/${order.id}/refund`, { amount_pence: 100 })).status, 404, 'another tenant')
})

test('card machines on the connected Stripe account: no key, a location from the venue\'s address, a sale', async () => {
  const acct = await ok(owner.post('/api/pos/card-accounts', { provider: 'stripe', name: 'Our Stripe', connect: true }))
  assert.equal(acct.connect, true)
  assert.equal(acct.hint, null)
  assert.equal(acct.mode, 'test')
  assert.equal((await owner.post('/api/pos/card-accounts', { provider: 'stripe', name: 'Again', connect: true })).status, 409)
  assert.equal((await owner.post('/api/pos/card-accounts', { provider: 'sumup', name: 'x', connect: true })).status, 400)
  assert.equal((await owner.patch('/api/pos/card-accounts/' + acct.id, { secret: 'sk_test_other_key_123' })).status, 422, 'no key of its own')
  assert.equal((await as(B.owner, ids.b).post('/api/pos/card-accounts', { provider: 'stripe', name: 'x', connect: true })).status, 422, 'a group with no Stripe account')

  const noAddress = await owner.post(`/api/pos/card-accounts/${acct.id}/locations`, { venue_id: W })
  assert.equal(noAddress.status, 422)
  assert.match(noAddress.json.error, /address/)
  await ok(owner.patch(`/api/website/config?venue_id=${W}`, { address_line1: '1 High St', city: 'Ware', postcode: 'SG12 9AA' }))
  const loc = await ok(owner.post(`/api/pos/card-accounts/${acct.id}/locations`, { venue_id: W }))
  assert.equal(fake.st.locations[loc.location.id].account, account)
  assert.equal(fake.st.locations[loc.location.id].address.postal_code, 'SG12 9AA')
  assert.deepEqual(loc.account.settings.locations.map(l => l.id), [loc.location.id])
  assert.equal(loc.account.connect, true, 'still connect mode')
  assert.equal((await as(B.owner, ids.b).post(`/api/pos/card-accounts/${acct.id}/locations`, { venue_id: W })).status, 404)

  const reader = await ok(owner.post(`/api/pos/venues/${W}/card-readers`, { account_id: acct.id, code: 'simulated-wpe', name: 'Counter', location: loc.location.id }))
  assert.equal(fake.st.readers[reader.provider_reader_id].account, account)

  // A sale on it from a till.
  const till = await linkDevice(owner, W, { kind: 'terminal', name: 'Zqx Till S' })
  await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', card_reader: reader.id } }))
  const staffId = filled.ids.staff
  const role = await ok(owner.post('/api/pos/roles', { name: 'Zqx Card', permissions: {} }))
  await ok(owner.put(`/api/pos/venues/${W}/staff/${staffId}/pos`, { pos_role_id: role.id, pin: '4826' }))
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  const dish = { ...menu.sections[0].items[0], section_id: menu.sections[0].id }
  const [eatIn] = await sql`SELECT id FROM order_types WHERE tenant_id = ${ids.a} AND name = 'Eat in' LIMIT 1`
  const check = ulid()
  const ev = (type, payload) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: staffId, check_id: check })
  const line = { id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 1200, modifiers: [], vat_rate: 20 }
  const sent = await device(till, 'POST', '/pos-api/events', { events: [ev('check.opened', { mode: 'counter', order_type_id: eatIn.id }), ev('line.added', { line })] })
  assert.ok(sent.json.results.every(x => x.ok), JSON.stringify(sent.json))
  const start = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: ulid(), amount: 1200, staff_id: staffId })
  assert.equal(start.status, 200, start.body)
  const pi = fake.lastPi()
  assert.equal(pi.account, account, 'the sale is on the group\'s account')
  assert.equal(pi.application_fee_amount, null, 'no platform fee on card machine sales')
  assert.equal(pi.payment_method_types[0], 'card_present')
  const sim = await device(till, 'POST', `/pos-api/card/payments/${start.json.id}/test`, { result: 'approve' })
  assert.equal(sim.json.status, 'approved', JSON.stringify(sim.json))
  const usedPlatformKey = fake.calls.filter(c => c.path.startsWith('/v1/terminal')).every(c => c.auth === 'Bearer ' + PLATFORM_KEY && c.account === account)
  assert.equal(usedPlatformKey, true)
})

test('unlinking: Card (Stripe) leaves checkout and the card machines stop', async () => {
  assert.equal((await as(A.operator, ids.a).delete('/api/stripe')).status, 403)
  const v = await ok(owner.delete('/api/stripe'))
  assert.equal(v.connected, false)
  assert.equal((await call('GET', `/order-api/venues/${W}`)).json.ordering.payment_methods.some(m => m.key === 'stripe'), false)
  const accts = (await ok(owner.get('/api/pos/card-accounts'))).accounts
  const check = await owner.post(`/api/pos/card-accounts/${accts.find(a => a.connect).id}/check`, {})
  assert.equal(check.status, 422)
  assert.match(check.json.error, /isn't connected/)
  // The platform's keys removed: nothing can connect.
  await ok(as(PLATFORM, null).put('/api/platform/stripe', { publishable: null }))
  forgetPlatformKeys()
  const s = await ok(owner.get('/api/stripe'))
  assert.equal(s.platform_ready, false)
  assert.equal((await owner.post('/api/stripe/connect', { return_url: 'https://office.macaroonie.com/orders/settings' })).status, 503)
})
