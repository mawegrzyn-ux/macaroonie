// Booking deposits (migration 220, services/depositSvc.js): a guest holds
// a table in the reservations widget, pays the venue's deposit with
// Stripe's form on the group's own Stripe account, and the booking is made
// only once Stripe says it is paid (the widget's confirm reads it back from
// Stripe; the Connect webhook does the same for a closed tab). A paid hold
// that can't be booked is refunded. Staff refund from the booking; a guest
// who cancels early enough gets it back by itself. Against a stand-in Stripe.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B, PLATFORM } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { startFakeStripe, PLATFORM_KEY } from './support/fake-stripe-connect.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { signPayload } from '../src/services/stripeConnect.js'
import { depositFor, refundRule, DEPOSIT_HOLD_SECS } from '../src/services/depositSvc.js'
import { env } from '../src/config/env.js'

let ids, owner, fake, W, WB, account
const WEBHOOK = 'whsec_test_deposits_1'
const day = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

async function call(method, url, { body, headers = {}, raw } = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body, headers: res.headers }
}
const hook = (event, secret = WEBHOOK) => {
  const raw = JSON.stringify(event)
  return call('POST', '/webhooks/payments/stripe', { raw, headers: { 'stripe-signature': signPayload(raw, secret) } })
}
const succeeded = (pi, acct = account) => ({
  id: 'evt_' + pi.id, type: 'payment_intent.succeeded', account: acct,
  data: { object: { ...pi, status: 'succeeded' } },
})

// A free slot n days ahead (for `covers`), its table, and a hold on it.
let used = 0
async function freeSlot(venue = W, covers = 2, n = 3) {
  const s = await call('GET', `/widget-api/venues/${venue}/slots?date=${day(n)}&covers=${covers}`)
  assert.equal(s.status, 200, s.body)
  const free = s.json.filter(x => x.available && x.table_id)
  assert.ok(free.length > used, 'a free slot on ' + day(n))
  return { date: day(n), ...free[used++] }
}
async function hold(guest = {}, { venue = W, covers = 2, n = 3 } = {}) {
  const slot = await freeSlot(venue, covers, n)
  const r = await call('POST', `/widget-api/venues/${venue}/holds`, { body: {
    starts_at: slot.date + 'T' + slot.slot_time + ':00', covers, table_id: slot.table_id,
    guest_name: 'Dee Posit', guest_email: 'dee@zqx.test', guest_notes: 'Window seat', ...guest,
  } })
  return r
}

before(async () => {
  fake = await startFakeStripe()
  env.STRIPE_API_URL = fake.base
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const fb = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  W = filled.ids.venue
  WB = fb.ids.venue
  await ok(as(PLATFORM, null).put('/api/platform/stripe', { secret: PLATFORM_KEY, publishable: 'pk_test_pub_5678', webhook: WEBHOOK }))
})
after(async () => { await closeApp(); await fake?.close() })

test('the deposit rule: fixed or per guest; refunded until N hours before', () => {
  assert.equal(depositFor({ requires_deposit: true, deposit_type: 'fixed', deposit_amount: '10.00' }, 6), 1000)
  assert.equal(depositFor({ requires_deposit: true, deposit_type: 'per_cover', deposit_amount: '5.00' }, 4), 2000)
  assert.equal(depositFor({ requires_deposit: false, deposit_type: 'fixed', deposit_amount: '10.00' }, 2), 0)
  assert.equal(depositFor(null, 2), 0)
  const start = new Date(Date.now() + 48 * 3600_000)
  assert.equal(refundRule({ refund_hours_before: null }, start).refundable, false, 'none = kept')
  assert.equal(refundRule({ refund_hours_before: 24 }, start).refundable, true)
  assert.equal(refundRule({ refund_hours_before: 72 }, start).refundable, false, 'too late')
})

test('a deposit venue: guests can\'t book until the group\'s Stripe account takes payments', async () => {
  await ok(owner.post(`/api/venues/${W}/deposit-rules`, { requires_deposit: true, deposit_type: 'per_cover', deposit_amount: 5, currency: 'GBP', refund_hours_before: 24 }))
  const v = await call('GET', `/widget-api/venues/${W}`)
  assert.deepEqual(v.json.deposit, { required: true, online: false, type: 'per_cover', amount_pence: 500, currency: 'GBP', refund_hours_before: 24 })
  const page = await call('GET', `/reservations/${W}`)
  assert.equal(page.status, 200)
  assert.match(page.body, /"deposit":\{"required":true,"online":false/, 'the widget page knows')
  const h = await hold()
  assert.equal(h.status, 422, h.body)
  assert.match(h.json.error, /can't take deposits online/)

  // Connect and finish Stripe's sign-up.
  const link = await ok(owner.post('/api/stripe/connect', { return_url: 'https://office.macaroonie.com/orders/settings' }))
  account = link.url.split('/').at(-1)
  fake.enable(account)
  await ok(owner.post('/api/stripe/refresh', {}))
  const v2 = await call('GET', `/widget-api/venues/${W}`)
  assert.equal(v2.json.deposit.online, true)
  const noEmail = await hold({ guest_email: null })
  assert.equal(noEmail.status, 422, 'an email for the receipt')
  assert.match(noEmail.json.error, /email/)
})

test('pay the deposit: a PaymentIntent on the group\'s account; booked only once Stripe says it is paid', async () => {
  const h = await hold()
  assert.equal(h.status, 201, h.body)
  const free = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/confirm`, { body: {} })
  assert.equal(free.status, 422, 'no free booking at a deposit venue')
  assert.match(free.json.error, /deposit/)

  const d = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit`, { body: { guest_notes: 'Birthday' } })
  assert.equal(d.status, 200, d.body)
  assert.equal(d.json.amount_pence, 1000, '2 guests x £5')
  assert.equal(d.json.account, account)
  assert.equal(d.json.publishable_key, 'pk_test_pub_5678')
  assert.equal(d.json.refund_hours_before, 24)
  assert.match(d.json.client_secret, /_secret_/)
  const pi = fake.st.pis[d.json.payment_intent]
  assert.equal(pi.account, account, 'on the group\'s account')
  assert.equal(pi.amount, 1000)
  assert.equal(pi.allow_redirects, 'never', 'the widget never leaves the page')
  assert.equal(pi.application_fee_amount, null, 'no platform fee on deposits')
  assert.deepEqual(pi.metadata, { kind: 'deposit', hold_id: h.json.id, tenant_id: ids.a, venue_id: W })
  assert.equal(pi.receipt_email, 'dee@zqx.test')
  const [row] = await sql`SELECT * FROM booking_holds WHERE id = ${h.json.id}`
  assert.equal(row.stripe_pi_id, pi.id)
  assert.equal(row.deposit_pence, 1000)
  assert.equal(row.guest_notes, 'Birthday')
  assert.ok(new Date(row.expires_at).getTime() > Date.now() + (DEPOSIT_HOLD_SECS - 60) * 1000, 'held long enough to pay')

  // Asked again (a reload): the same payment.
  const again = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit`, { body: {} })
  assert.equal(again.json.payment_intent, pi.id)

  const confirm = () => call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit/confirm`, { body: { payment_intent: pi.id } })
  assert.equal((await confirm()).status, 202, 'not paid yet: still being checked')
  fake.decline(pi.id)
  const declined = await confirm()
  assert.equal(declined.status, 402)
  assert.match(declined.json.error, /declined/)
  pi.last_payment_error = null
  fake.succeed(pi.id)
  const booked = await confirm()
  assert.equal(booked.status, 201, booked.body)
  assert.equal(booked.json.deposit_pence, 1000)
  assert.ok(booked.json.manage_token)
  const [b] = await sql`SELECT * FROM bookings WHERE id = ${booked.json.id}`
  assert.equal(b.guest_notes, 'Birthday')
  assert.equal(b.covers, 2)
  const [p] = await sql`SELECT * FROM payments WHERE booking_id = ${b.id}`
  assert.equal(p.stripe_pi_id, pi.id)
  assert.equal(Number(p.amount), 10)
  assert.equal(p.status, 'succeeded')
  assert.equal(p.stripe_account, account)
  assert.equal(p.refund_hours_before, 24, 'the rule when paid')
  assert.equal((await sql`SELECT 1 FROM booking_holds WHERE id = ${h.json.id}`).length, 0, 'hold gone')

  // Asked again, and Stripe's webhook for the same payment: still one booking.
  assert.equal((await confirm()).json.id, b.id)
  assert.equal((await hook(succeeded(pi))).status, 200)
  assert.equal((await sql`SELECT count(*)::int AS n FROM payments WHERE stripe_pi_id = ${pi.id}`)[0].n, 1)
  assert.equal((await sql`SELECT count(*)::int AS n FROM bookings WHERE tenant_id = ${ids.a} AND guest_notes = 'Birthday'`)[0].n, 1)
  assert.equal(fake.st.refunds.filter(r => r.payment_intent === pi.id).length, 0, 'the second notice doesn\'t refund it')

  // The staff list shows the deposit.
  const list = await ok(owner.get(`/api/bookings?venue_id=${W}&date=${b.starts_at.toISOString().slice(0, 10)}`))
  const mine = list.find(x => x.id === b.id)
  assert.equal(mine.payment_status, 'succeeded')
  assert.equal(mine.payment_currency, 'GBP')
  assert.equal(Number(mine.payment_refunded), 0)
})

test('the guest closed the tab: the webhook books it, the widget\'s confirm then finds it', async () => {
  const h = await hold({ guest_name: 'Tab Closer' })
  const d = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit`, { body: {} })
  const pi = fake.st.pis[d.json.payment_intent]
  fake.succeed(pi.id)
  assert.equal((await hook(succeeded(pi), 'whsec_wrong')).status, 400, 'a bad signature')
  assert.equal((await sql`SELECT 1 FROM payments WHERE stripe_pi_id = ${pi.id}`).length, 0)
  assert.equal((await hook(succeeded(pi))).status, 200)
  const [p] = await sql`SELECT booking_id FROM payments WHERE stripe_pi_id = ${pi.id}`
  assert.ok(p, 'booked from the webhook')
  const [b] = await sql`SELECT guest_name FROM bookings WHERE id = ${p.booking_id}`
  assert.equal(b.guest_name, 'Tab Closer')
  const c = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit/confirm`, { body: { payment_intent: pi.id } })
  assert.equal(c.status, 201)
  assert.equal(c.json.id, p.booking_id)
})

test('paid after the hold ran out: booked when the table is free, refunded when it has gone', async () => {
  // Ran out, table still free: the guest has paid, so it is booked.
  const late = await hold({ guest_name: 'Late Payer' })
  const d1 = await call('POST', `/widget-api/venues/${W}/holds/${late.json.id}/deposit`, { body: {} })
  await sql`UPDATE booking_holds SET expires_at = now() - interval '1 minute' WHERE id = ${late.json.id}`
  fake.succeed(d1.json.payment_intent)
  const ok1 = await call('POST', `/widget-api/venues/${W}/holds/${late.json.id}/deposit/confirm`, { body: { payment_intent: d1.json.payment_intent } })
  assert.equal(ok1.status, 201, ok1.body)

  // The hold swept away before the money came: refunded in full, once.
  const gone = await hold({ guest_name: 'Too Late' })
  const d2 = await call('POST', `/widget-api/venues/${W}/holds/${gone.json.id}/deposit`, { body: {} })
  await sql`DELETE FROM booking_holds WHERE id = ${gone.json.id}`
  fake.succeed(d2.json.payment_intent)
  const r = await call('POST', `/widget-api/venues/${W}/holds/${gone.json.id}/deposit/confirm`, { body: { payment_intent: d2.json.payment_intent } })
  assert.equal(r.status, 409, r.body)
  assert.equal(r.json.refunded, true)
  assert.match(r.json.error, /refunded/)
  const refunds = fake.st.refunds.filter(x => x.payment_intent === d2.json.payment_intent)
  assert.equal(refunds.length, 1)
  assert.equal(refunds[0].amount, 1000, 'all of it')
  assert.equal(refunds[0].account, account)
  await hook(succeeded(fake.st.pis[d2.json.payment_intent]))
  assert.equal(fake.st.refunds.filter(x => x.payment_intent === d2.json.payment_intent).length, 1, 'the webhook doesn\'t refund twice')
  assert.equal((await sql`SELECT 1 FROM bookings WHERE tenant_id = ${ids.a} AND guest_name = 'Too Late'`).length, 0)
})

test('the guest gives up: the hold goes and its payment is cancelled', async () => {
  const h = await hold({ guest_name: 'Changed Mind' })
  const d = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit`, { body: {} })
  assert.equal((await call('DELETE', `/widget-api/venues/${W}/holds/${h.json.id}`)).status, 200)
  for (let i = 0; i < 20 && fake.st.pis[d.json.payment_intent].status !== 'canceled'; i++) await new Promise(r => setTimeout(r, 25))
  assert.equal(fake.st.pis[d.json.payment_intent].status, 'canceled')
  const again = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit`, { body: {} })
  assert.equal(again.status, 404)
})

test('staff refunds: owner or admin, part or all, never more than was paid', async () => {
  const [p] = await sql`SELECT p.* FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.guest_notes = 'Birthday'`
  assert.equal((await as(A.operator, ids.a).post(`/api/payments/${p.id}/refund`, {})).status, 403, 'an operator')
  assert.equal((await as(B.owner, ids.b).post(`/api/payments/${p.id}/refund`, {})).status, 404, 'another group')
  const part = await ok(owner.post(`/api/payments/${p.id}/refund`, { amount_pence: 300 }))
  assert.equal(part.status, 'partially_refunded')
  assert.equal(part.refunded_pence, 300)
  const r1 = fake.st.refunds.at(-1)
  assert.equal(r1.amount, 300)
  assert.equal(r1.account, account, 'refunded on the account it was paid to')
  const over = await owner.post(`/api/payments/${p.id}/refund`, { amount_pence: 800 })
  assert.equal(over.status, 422)
  assert.match(over.json.error, /up to £7\.00/)
  const rest = await ok(owner.post(`/api/payments/${p.id}/refund`, {}))
  assert.equal(rest.status, 'refunded')
  assert.equal(rest.refunded_pence, 1000)
  assert.equal(fake.st.refunds.at(-1).amount, 700)
  assert.equal((await owner.post(`/api/payments/${p.id}/refund`, {})).status, 422, 'nothing left')
  const [after] = await sql`SELECT refund_ids FROM payments WHERE id = ${p.id}`
  assert.equal(after.refund_ids.length, 2)
})

test('the guest cancels on the manage page: refunded in time, kept when the rule says so', async () => {
  const book = async (name) => {
    const h = await hold({ guest_name: name })
    const d = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit`, { body: {} })
    fake.succeed(d.json.payment_intent)
    const c = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit/confirm`, { body: { payment_intent: d.json.payment_intent } })
    assert.equal(c.status, 201, c.body)
    return { ...c.json, pi: d.json.payment_intent }
  }
  const early = await book('Early Cancel')
  const page = await call('GET', '/manage/' + early.manage_token)
  assert.match(page.body, /data-testid="manage-deposit"/)
  assert.match(page.body, /£10\.00 paid/)
  assert.match(page.body, /Refunded if you cancel before/)
  const c1 = await call('POST', `/manage/${early.manage_token}/cancel`)
  assert.equal(c1.status, 302)
  assert.match(c1.headers.location, /flash=cancelled&deposit=refunded/)
  assert.equal(fake.st.refunds.filter(r => r.payment_intent === early.pi).length, 1)
  const [p1] = await sql`SELECT status FROM payments WHERE stripe_pi_id = ${early.pi}`
  assert.equal(p1.status, 'refunded')
  const after = await call('GET', '/manage/' + early.manage_token + '?flash=cancelled&deposit=refunded')
  assert.match(after.body, /on its way back to your card/)

  // Non-refundable from now on; a booking paid under the old rule keeps it.
  await ok(owner.post(`/api/venues/${W}/deposit-rules`, { requires_deposit: true, deposit_type: 'fixed', deposit_amount: 15, currency: 'GBP', refund_hours_before: null }))
  const kept = await book('Kept Deposit')
  const page2 = await call('GET', '/manage/' + kept.manage_token)
  assert.match(page2.body, /£15\.00 paid/, 'fixed £15')
  assert.match(page2.body, /Not refunded if you cancel/)
  const c2 = await call('POST', `/manage/${kept.manage_token}/cancel`)
  assert.match(c2.headers.location, /deposit=kept/)
  assert.equal(fake.st.refunds.filter(r => r.payment_intent === kept.pi).length, 0)
})

test('other groups and other venues can\'t reach a deposit', async () => {
  const h = await hold({ guest_name: 'Cross Check' })
  const d = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit`, { body: {} })
  fake.succeed(d.json.payment_intent)
  // Through the other group's venue: not found, nothing booked.
  assert.equal((await call('POST', `/widget-api/venues/${WB}/holds/${h.json.id}/deposit`, { body: {} })).status, 404)
  const viaB = await call('POST', `/widget-api/venues/${WB}/holds/${h.json.id}/deposit/confirm`, { body: { payment_intent: d.json.payment_intent } })
  assert.equal(viaB.status, 404, viaB.body)
  assert.equal((await sql`SELECT 1 FROM payments WHERE stripe_pi_id = ${d.json.payment_intent}`).length, 0)
  // Another hold's payment on this hold: not found.
  const other = await hold({ guest_name: 'Other Hold' })
  const wrong = await call('POST', `/widget-api/venues/${W}/holds/${other.json.id}/deposit/confirm`, { body: { payment_intent: d.json.payment_intent } })
  assert.equal(wrong.status, 404)
  assert.equal((await call('POST', `/widget-api/venues/${W}/holds/${other.json.id}/deposit/confirm`, { body: { payment_intent: 'nope' } })).status, 400)
  // A webhook claiming another group: ignored.
  const forged = { ...fake.st.pis[d.json.payment_intent], metadata: { ...fake.st.pis[d.json.payment_intent].metadata, tenant_id: ids.b } }
  assert.equal((await hook(succeeded(forged))).status, 200)
  assert.equal((await sql`SELECT 1 FROM payments WHERE stripe_pi_id = ${d.json.payment_intent}`).length, 0, 'not booked for the other group')
  assert.equal(fake.st.refunds.filter(r => r.payment_intent === d.json.payment_intent).length, 0, 'and not refunded')
  // The right one books it.
  const right = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit/confirm`, { body: { payment_intent: d.json.payment_intent } })
  assert.equal(right.status, 201, right.body)
})

test('staff book at a deposit venue without a deposit (the host stand has no card form)', async () => {
  const slot = await freeSlot(W, 2, 4)
  const h = await ok(owner.post('/api/bookings/holds', {
    venue_id: W, table_id: slot.table_id, starts_at: new Date(slot.date + 'T' + slot.slot_time + ':00Z').toISOString(), covers: 2,
    guest_name: 'Phone Booking', guest_email: 'phone@zqx.test',
  }))
  const b = await owner.post('/api/bookings', { hold_id: h.id, guest_name: 'Phone Booking', guest_email: 'phone@zqx.test' })
  assert.equal(b.status, 201, b.body)
  assert.equal((await sql`SELECT 1 FROM payments WHERE booking_id = ${b.json.id}`).length, 0)
})

test('a venue without a deposit books free as before', async () => {
  await ok(owner.post(`/api/venues/${W}/deposit-rules`, { requires_deposit: false, currency: 'GBP' }))
  const v = await call('GET', `/widget-api/venues/${W}`)
  assert.equal(v.json.deposit.required, false)
  const h = await hold({ guest_name: 'Free Guest' })
  assert.equal(h.status, 201, h.body)
  assert.equal((await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/deposit`, { body: {} })).status, 422, 'no deposit to pay')
  const c = await call('POST', `/widget-api/venues/${W}/holds/${h.json.id}/confirm`, { body: { guest_notes: 'Quiet table', guest_email: 'free@zqx.test' } })
  assert.equal(c.status, 201, c.body)
  const [b] = await sql`SELECT guest_notes, guest_email FROM bookings WHERE id = ${c.json.id}`
  assert.equal(b.guest_notes, 'Quiet table')
  assert.equal(b.guest_email, 'free@zqx.test')
})
