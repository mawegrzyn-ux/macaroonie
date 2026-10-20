// Card machines (migration 193): provider accounts and card machines in Till
// setup; a till or kiosk starts a payment on its card machine through the
// server (/pos-api/card/payments) and the payment reaches the check only as
// payment.added naming the approved attempt (shared/pos/cards.js), once and
// for the right amount; refunds and taking a payment off go back to the
// card first. Against stand-in Stripe Terminal, SumUp and Dojo servers
// (support/fake-card-providers.mjs) and the built-in test machine; refusals
// for viewers, staff without permission and another tenant.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { startFakeCardProviders } from './support/fake-card-providers.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { env } from '../src/config/env.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, W, theirs, fake, till, kiosk, staffId, bossId, dish, eatIn
let stripeAcct, sumupAcct, dojoAcct, stripeReader, sumupReader, dojoReader, testReader
let bTill

async function device(d, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      authorization: `Device ${d.device_id}.${d.secret}`,
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}

const ev = (d, type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: staffId, ...extra })
async function send(d, events) {
  const r = await device(d, 'POST', '/pos-api/events', { events })
  assert.equal(r.status, 200, r.body)
  return r.json.results
}

/** An open check with one £12.00 line (sent), on the till. */
async function openCheck() {
  const check = ulid()
  const line = { id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 1200, modifiers: [], vat_rate: 20 }
  const res = await send(till, [
    ev(till, 'check.opened', { mode: 'counter', order_type_id: eatIn }, { check_id: check }),
    ev(till, 'line.added', { line }, { check_id: check }),
  ])
  assert.ok(res.every(r => r.ok), JSON.stringify(res))
  return check
}

async function waitFor(d, id, want, tries = 10) {
  let last
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, 1300))
    last = await device(d, 'GET', '/pos-api/card/payments/' + id)
    if (last.json?.status === want) return last.json
  }
  assert.fail('waited for ' + want + ', got ' + JSON.stringify(last?.json))
}

before(async () => {
  fake = await startFakeCardProviders()
  env.STRIPE_API_URL = fake.base
  env.SUMUP_API_URL = fake.base
  env.DOJO_API_URL = fake.base
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  theirs = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  W = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[0], section_id: menu.sections[0].id }
  eatIn = (await sql`SELECT id FROM order_types WHERE tenant_id = ${ids.a} AND name = 'Eat in' LIMIT 1`)[0].id
  // A till person (role without refund or void) and a manager.
  const role = await ok(owner.post('/api/pos/roles', { name: 'Zqx Server', permissions: {} }))
  const boss = await ok(owner.post('/api/pos/roles', { name: 'Zqx Manager', permissions: { refund: true, void: true, manager: true } }))
  staffId = filled.ids.staff
  bossId = filled.ids.staff2
  await ok(owner.put(`/api/pos/venues/${W}/staff/${staffId}/pos`, { pos_role_id: role.id, pin: '2580' }))
  await ok(owner.put(`/api/pos/venues/${W}/staff/${bossId}/pos`, { pos_role_id: boss.id, pin: '1397' }))
  till = await linkDevice(owner, W, { kind: 'terminal', name: 'Zqx Till 1' })
  kiosk = await linkDevice(owner, W, { kind: 'kiosk', name: 'Zqx Kiosk 1' })
  bTill = await linkDevice(as(B.owner, ids.b), theirs.ids.venue, { kind: 'terminal', name: 'Yyc Till' })
})
after(async () => { await closeApp(); await fake?.close() })

test('accounts: the key is checked with the provider, sealed, never shown; only owners and admins add one', async () => {
  const bad = await owner.post('/api/pos/card-accounts', { provider: 'stripe', name: 'Stripe', secret: 'sk_test_wrong123' })
  assert.equal(bad.status, 422)
  assert.match(bad.json.error, /refused the key/)
  const notStripe = await owner.post('/api/pos/card-accounts', { provider: 'stripe', name: 'Stripe', secret: 'pk_test_123456789' })
  assert.equal(notStripe.status, 422, 'a publishable key is refused before calling Stripe')

  stripeAcct = await ok(owner.post('/api/pos/card-accounts', { provider: 'stripe', name: 'Zqx Stripe', secret: 'sk_test_good_123456789' }))
  assert.equal(stripeAcct.mode, 'test')
  assert.deepEqual(stripeAcct.settings.locations, [{ id: 'tml_1', name: 'Ware' }])
  assert.equal(stripeAcct.hint, '…6789')
  sumupAcct = await ok(owner.post('/api/pos/card-accounts', { provider: 'sumup', name: 'Zqx SumUp', secret: 'sup_sk_good_abcdefgh' }))
  assert.equal(sumupAcct.settings.merchant_code, 'MXYZ', 'merchant learned from the key')
  const wrongMerchant = await owner.post('/api/pos/card-accounts', { provider: 'sumup', name: 'x', secret: 'sup_sk_good_abcdefgh', settings: { merchant_code: 'OTHER' } })
  assert.equal(wrongMerchant.status, 422)
  dojoAcct = await ok(owner.post('/api/pos/card-accounts', { provider: 'dojo', name: 'Zqx Dojo', secret: 'sk_sandbox_good' }))
  assert.equal(dojoAcct.mode, 'test')

  const list = await ok(owner.get('/api/pos/card-accounts'))
  assert.equal(list.accounts.length, 3)
  assert.ok(!JSON.stringify(list).includes('sk_test_good'), 'no key in the list')
  const [row] = await sql`SELECT secret FROM pos_card_accounts WHERE id = ${stripeAcct.id}`
  assert.match(row.secret, /^v1:/, 'sealed at rest')

  assert.equal((await as(A.operator, ids.a).post('/api/pos/card-accounts', { provider: 'dojo', name: 'x', secret: 'sk_sandbox_good' })).status, 403, 'operator (no Till setup)')
  assert.equal((await as(A.viewer, ids.a).get('/api/pos/card-accounts')).status, 403, 'viewer (no Till setup)')
  const renamed = await ok(as(A.admin, ids.a).patch('/api/pos/card-accounts/' + dojoAcct.id, { name: 'Zqx Dojo account' }))
  assert.equal(renamed.name, 'Zqx Dojo account', 'an admin manages accounts')
  assert.equal(renamed.hint, dojoAcct.hint, 'a rename keeps the key')
  const b = as(B.owner, ids.b)
  assert.equal((await b.get('/api/pos/card-accounts')).json.accounts.length, 0, 'other tenant sees none')
  assert.equal((await b.patch('/api/pos/card-accounts/' + stripeAcct.id, { name: 'mine' })).status, 404)
  assert.equal((await b.get('/api/pos/card-accounts/' + stripeAcct.id + '/readers')).status, 404)
})

test('card machines: from the provider\'s list, by the code a machine shows, or the test machine; a till or kiosk picks one', async () => {
  const list = await ok(owner.get(`/api/pos/card-accounts/${stripeAcct.id}/readers`))
  assert.equal(list[0].ref, 'tmr_1')
  assert.equal(list[0].added_at, null)
  stripeReader = await ok(owner.post(`/api/pos/venues/${W}/card-readers`, { account_id: stripeAcct.id, provider_reader_id: 'tmr_1', name: 'Counter' }))
  assert.equal((await owner.post(`/api/pos/venues/${W}/card-readers`, { account_id: stripeAcct.id, provider_reader_id: 'tmr_1', name: 'Again' })).status, 409)
  assert.equal((await ok(owner.get(`/api/pos/card-accounts/${stripeAcct.id}/readers`)))[0].added_at.venue_id, W)
  const badCode = await owner.post(`/api/pos/venues/${W}/card-readers`, { account_id: sumupAcct.id, code: 'NOPE11', name: 'Solo' })
  assert.equal(badCode.status, 422)
  assert.match(badCode.json.error, /pairing code/i)
  sumupReader = await ok(owner.post(`/api/pos/venues/${W}/card-readers`, { account_id: sumupAcct.id, code: 'pair42', name: 'Solo 1' }))
  assert.equal(sumupReader.model, 'solo')
  const dojoList = await ok(owner.get(`/api/pos/card-accounts/${dojoAcct.id}/readers`))
  assert.equal(dojoList[0].ref, 'term_1')
  dojoReader = await ok(owner.post(`/api/pos/venues/${W}/card-readers`, { account_id: dojoAcct.id, provider_reader_id: 'term_1', name: 'Dojo 1' }))
  assert.equal((await owner.post(`/api/pos/venues/${W}/card-readers`, { account_id: dojoAcct.id, code: 'X1234', name: 'x' })).status, 422, 'Dojo pairs from the list only')
  testReader = await ok(owner.post(`/api/pos/venues/${W}/card-readers`, { provider: 'test', name: 'Test machine' }))

  // Another tenant can't add with A's account, or point its till at A's machine.
  const b = as(B.owner, ids.b)
  assert.equal((await b.post(`/api/pos/venues/${theirs.ids.venue}/card-readers`, { account_id: stripeAcct.id, provider_reader_id: 'tmr_1', name: 'x' })).status, 404)
  assert.equal((await b.patch('/api/pos/devices/' + bTill.id, { settings: { card_reader: stripeReader.id } })).status, 422)
  // A machine at another venue can't be picked.
  const other = await ok(owner.post(`/api/pos/venues/${(await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND id <> ${W} LIMIT 1`)[0].id}/card-readers`, { provider: 'test', name: 'Elsewhere' }))
  assert.equal((await owner.patch('/api/pos/devices/' + till.id, { settings: { card_reader: other.id } })).status, 422)

  await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', card_reader: stripeReader.id } }))
  await ok(owner.patch('/api/pos/devices/' + kiosk.id, { settings: { card_reader: testReader.id } }))
  const venueList = await ok(owner.get(`/api/pos/venues/${W}/card-readers`))
  assert.deepEqual(venueList.find(r => r.id === stripeReader.id).devices.map(d => d.name), ['Zqx Till 1'])
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.equal(cfg.json.card_machine.id, stripeReader.id)
  assert.equal(cfg.json.card_machine.can_simulate, true, 'Stripe test mode: a test card can be presented')
  const kcfg = await device(kiosk, 'GET', '/pos-api/config')
  assert.equal(kcfg.json.card_machine.provider, 'test')
})

test('a till sale on Stripe: approved, then on the check once, for the right amount', async () => {
  const check = await openCheck()
  const pay = ulid()
  const tooMuch = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: pay, amount: 1300, staff_id: staffId })
  assert.equal(tooMuch.status, 409, 'more than is left')
  const start = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: pay, amount: 1000, tip: 100, staff_id: staffId })
  assert.equal(start.status, 200, start.body)
  assert.equal(start.json.status, 'pending')
  const pi = fake.stripe.pis[Object.keys(fake.stripe.pis).at(-1)]
  assert.equal(pi.amount, 1100, 'charged amount + tip')
  assert.equal(pi.payment_method_types[0], 'card_present')
  assert.equal(fake.stripe.readers.tmr_1.action.status, 'in_progress')
  const busy = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: ulid(), amount: 100, staff_id: staffId })
  assert.equal(busy.status, 409)
  assert.equal(busy.json.payment_id, start.json.id, 'busy names the payment it waits on')

  // A payment naming the attempt before it is approved is refused.
  const early = await send(till, [ev(till, 'payment.added', { payment: { id: pay, tender: 'card_integrated', amount: 1000, tip: 100, card_payment_id: start.json.id } }, { check_id: check })])
  assert.equal(early[0].ok, false)
  assert.match(early[0].error, /didn't approve/)

  const sim = await device(till, 'POST', `/pos-api/card/payments/${start.json.id}/test`, { result: 'approve' })
  assert.equal(sim.json.status, 'approved')
  assert.equal(sim.json.card_text, 'Visa •••• 4242')

  const wrongAmount = await send(till, [ev(till, 'payment.added', { payment: { id: ulid(), tender: 'card_integrated', amount: 1100, card_payment_id: start.json.id } }, { check_id: check })])
  assert.equal(wrongAmount[0].ok, false)
  const noAttempt = await send(till, [ev(till, 'payment.added', { payment: { id: ulid(), tender: 'card_integrated', amount: 1000 } }, { check_id: check })])
  assert.equal(noAttempt[0].ok, false, 'a card machine payment must name its attempt')
  const good = await send(till, [ev(till, 'payment.added', { payment: { id: pay, tender: 'card_integrated', amount: 1000, tip: 100, ref: sim.json.card_text, card_payment_id: start.json.id } }, { check_id: check })])
  assert.equal(good[0].ok, true, good[0].error)
  const again = await send(till, [ev(till, 'payment.added', { payment: { id: ulid(), tender: 'card_integrated', amount: 200, card_payment_id: start.json.id } }, { check_id: check })])
  assert.equal(again[0].ok, false)
  const [row] = await sql`SELECT used_event_id, check_id FROM pos_card_payments WHERE id = ${start.json.id}`
  assert.equal(row.used_event_id, good[0].id)

  // The rest by a declined card, then cash.
  const pay2 = ulid()
  const second = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: pay2, amount: 200, staff_id: staffId })
  assert.equal(second.status, 200, second.body)
  const declined = await device(till, 'POST', `/pos-api/card/payments/${second.json.id}/test`, { result: 'decline' })
  assert.equal(declined.json.status, 'declined')
  assert.match(declined.json.message, /declined/i)
  const fromDeclined = await send(till, [ev(till, 'payment.added', { payment: { id: pay2, tender: 'card_integrated', amount: 200, card_payment_id: second.json.id } }, { check_id: check })])
  assert.equal(fromDeclined[0].ok, false)
  const closed = await send(till, [
    ev(till, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: 200, tendered: 200 } }, { check_id: check }),
    ev(till, 'check.closed', {}, { check_id: check }),
  ])
  assert.ok(closed.every(r => r.ok), JSON.stringify(closed))

  // Refund to the card: needs the refund permission (or a manager), then refund.added names it.
  const noPerm = await device(till, 'POST', '/pos-api/card/refunds', { sale_id: start.json.id, check_id: check, refund_id: ulid(), amount: 500, staff_id: staffId })
  assert.equal(noPerm.status, 403)
  const refundId = ulid()
  const refund = await device(till, 'POST', '/pos-api/card/refunds', { sale_id: start.json.id, check_id: check, refund_id: refundId, amount: 500, staff_id: staffId, approved_by: bossId })
  assert.equal(refund.status, 200, refund.body)
  assert.equal(refund.json.status, 'approved')
  assert.equal(fake.stripe.refunds.at(-1).amount, 500)
  assert.equal(fake.stripe.refunds.at(-1).payment_intent, pi.id)
  const tooBig = await device(till, 'POST', '/pos-api/card/refunds', { sale_id: start.json.id, check_id: check, refund_id: ulid(), amount: 700, staff_id: bossId })
  assert.equal(tooBig.status, 422, 'only £6.00 left of the card payment')
  const recorded = await send(till, [ev(till, 'refund.added', { refund: { id: refundId, tender: 'card_integrated', amount: 500, reason: 'Cold food', card_refund_id: refund.json.id } }, { check_id: check, staff_id: bossId })])
  assert.equal(recorded[0].ok, true, recorded[0].error)
  const twice = await send(till, [ev(till, 'refund.added', { refund: { id: ulid(), tender: 'card_integrated', amount: 500, reason: 'Again', card_refund_id: refund.json.id } }, { check_id: check, staff_id: bossId })])
  assert.equal(twice[0].ok, false, 'one refund recorded once')
})

test('taking a card payment off an open check refunds the card first', async () => {
  const check = await openCheck()
  const pay = ulid()
  const start = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: pay, amount: 1200, staff_id: staffId })
  await device(till, 'POST', `/pos-api/card/payments/${start.json.id}/test`, { result: 'approve' })
  const added = await send(till, [ev(till, 'payment.added', { payment: { id: pay, tender: 'card_integrated', amount: 1200, card_payment_id: start.json.id } }, { check_id: check })])
  assert.ok(added[0].ok, added[0].error)
  const plain = await send(till, [ev(till, 'payment.voided', { payment_id: pay, reason: 'Wrong amount' }, { check_id: check, staff_id: bossId })])
  assert.equal(plain[0].ok, false)
  assert.match(plain[0].error, /Refund it to the card first/)
  const back = await device(till, 'POST', '/pos-api/card/refunds', { sale_id: start.json.id, check_id: check, refund_id: ulid(), amount: 1200, staff_id: bossId, purpose: 'void' })
  assert.equal(back.json.status, 'approved')
  const part = await device(till, 'POST', '/pos-api/card/refunds', { sale_id: start.json.id, check_id: check, refund_id: ulid(), amount: 1, staff_id: bossId, purpose: 'void' })
  assert.equal(part.status, 422, 'nothing left to refund')
  const off = await send(till, [ev(till, 'payment.voided', { payment_id: pay, reason: 'Wrong amount', card_refund_id: back.json.id }, { check_id: check, staff_id: bossId })])
  assert.ok(off[0].ok, off[0].error)
})

test('cancel on the till; SumUp and Dojo sales; the minute sweep', async () => {
  // Cancel a Stripe payment: the reader's action and the intent go.
  let check = await openCheck()
  const s = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: ulid(), amount: 1200, staff_id: staffId })
  const cancelled = await device(till, 'POST', `/pos-api/card/payments/${s.json.id}/cancel`)
  assert.equal(cancelled.json.status, 'cancelled', JSON.stringify(cancelled.json))
  assert.equal(fake.stripe.readers.tmr_1.action, null)

  // SumUp: the Solo takes the card, the transaction gives card and id for refunds.
  await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', card_reader: sumupReader.id } }))
  const su = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: ulid(), amount: 1200, staff_id: staffId })
  assert.equal(su.json.status, 'pending', su.body)
  const co = Object.values(fake.sumup.checkouts).at(-1)
  assert.deepEqual(co.total_amount, { currency: 'GBP', minor_unit: 2, value: 1200 })
  fake.sumupFinish(co.checkout_id, 'successful')
  const done = await waitFor(till, su.json.id, 'approved')
  assert.equal(done.card_text, 'Visa •••• 0005')
  const paid = await send(till, [ev(till, 'payment.added', { payment: { id: su.json.payment_id, tender: 'card_integrated', amount: 1200, card_payment_id: su.json.id } }, { check_id: check })])
  assert.ok(paid[0].ok, paid[0].error)
  await send(till, [ev(till, 'check.closed', {}, { check_id: check })])
  const sr = await device(till, 'POST', '/pos-api/card/refunds', { sale_id: su.json.id, check_id: check, refund_id: ulid(), amount: 1200, staff_id: bossId })
  assert.equal(sr.json.status, 'approved')
  assert.deepEqual(fake.sumup.refunds.at(-1), { id: 'tx_' + co.checkout_id, body: {} }, 'a full refund sends no amount')

  // Dojo with a signature check.
  await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', card_reader: dojoReader.id } }))
  check = await openCheck()
  const dj = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: ulid(), amount: 1200, staff_id: staffId })
  assert.equal(dj.json.status, 'pending', dj.body)
  const sess = Object.values(fake.dojo.sessions).at(-1)
  assert.equal(sess.terminalId, 'term_1')
  assert.equal(sess.details.sessionType, 'Sale')
  assert.equal(fake.dojo.pis[sess.details.sale.paymentIntentId].amount.value, 1200)
  const dojoCall = fake.calls.find(c => c.path === '/terminal-sessions')
  assert.equal(dojoCall.headers.version, '2024-02-05')
  fake.dojoSet(sess.terminalSessionId, 'SignatureVerificationRequired')
  await waitFor(till, dj.json.id, 'signature')
  const signed = await device(till, 'POST', `/pos-api/card/payments/${dj.json.id}/signature`, { accepted: true })
  assert.equal(signed.status, 200, signed.body)
  const dDone = await waitFor(till, dj.json.id, 'approved')
  assert.equal(dDone.card_text, 'Mastercard •••• 4444')

  // A Dojo payment left waiting: the sweep asks once more.
  check = await openCheck()
  const left = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: ulid(), amount: 1200, staff_id: staffId })
  fake.dojoSet(Object.values(fake.dojo.sessions).at(-1).terminalSessionId, 'Declined')
  await sql`UPDATE pos_card_payments SET checked_at = now() - interval '5 minutes' WHERE id = ${left.json.id}`
  const { sweepPending } = await import('../src/services/cardSvc.js')
  assert.ok(await sweepPending() >= 1)
  assert.equal((await sql`SELECT status FROM pos_card_payments WHERE id = ${left.json.id}`)[0].status, 'declined')
})

test('a kiosk pays before its order exists; the order then names the payment', async () => {
  const payId = ulid()
  const start = await device(kiosk, 'POST', '/pos-api/card/payments', { payment_id: payId, amount: 1200 })
  assert.equal(start.status, 200, start.body)
  assert.equal((await device(kiosk, 'POST', '/pos-api/card/payments', { payment_id: ulid(), amount: 1200, tip: 100 })).status, 422, 'no tips')
  const ok1 = await device(kiosk, 'POST', `/pos-api/card/payments/${start.json.id}/test`, { result: 'approve' })
  assert.equal(ok1.json.status, 'approved')
  assert.equal(ok1.json.card_text, 'Test card')
  assert.equal((await device(kiosk, 'POST', '/pos-api/card/refunds', { sale_id: start.json.id, check_id: ulid(), refund_id: ulid(), amount: 1, staff_id: staffId })).status, 403, 'a kiosk can\'t refund')
  assert.equal((await device(kiosk, 'GET', '/pos-api/card/payments?check_id=' + ulid())).status, 403, 'a kiosk can\'t list')

  const check = ulid()
  const line = { id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 1200, modifiers: [], vat_rate: 20 }
  const k = (type, payload) => ({ id: ulid(), check_id: check, type, payload, client_at: new Date().toISOString() })
  const res = await send(kiosk, [
    k('check.opened', { mode: 'counter', order_type_id: eatIn }),
    k('line.added', { line }),
    k('payment.added', { payment: { id: payId, tender: 'card_integrated', amount: 1200, ref: 'Test card', card_payment_id: start.json.id } }),
    k('check.closed', {}),
  ])
  assert.ok(res.every(r => r.ok), JSON.stringify(res))
  const [row] = await sql`SELECT check_id, used_event_id FROM pos_card_payments WHERE id = ${start.json.id}`
  assert.equal(row.check_id, check, 'the attempt now knows its check')
  // The kiosk can't see the till's payments.
  const tillOne = (await sql`SELECT id FROM pos_card_payments WHERE device_id = ${till.id} LIMIT 1`)[0]
  assert.equal((await device(kiosk, 'GET', '/pos-api/card/payments/' + tillOne.id)).status, 404)
})

test('another tenant: can\'t read, cancel or use A\'s card payments', async () => {
  const mine = (await sql`SELECT id FROM pos_card_payments WHERE tenant_id = ${ids.a} AND kind = 'sale' LIMIT 1`)[0].id
  assert.equal((await device(bTill, 'GET', '/pos-api/card/payments/' + mine)).status, 404)
  assert.equal((await device(bTill, 'POST', `/pos-api/card/payments/${mine}/cancel`)).status, 404)
  assert.equal((await device(bTill, 'POST', '/pos-api/card/payments', { check_id: ulid(), payment_id: ulid(), amount: 100 })).status, 422, 'no card machine')
  const b = as(B.owner, ids.b)
  assert.equal((await b.get(`/api/pos/venues/${W}/card-payments`)).status, 404)
  assert.equal((await b.delete('/api/pos/card-readers/' + stripeReader.id)).status, 404)
})

test('Till setup: payments list, removing a machine and an account', async () => {
  // An approved payment no check shows is flagged.
  const check = await openCheck()
  await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', card_reader: testReader.id } }))
  const lost = await device(till, 'POST', '/pos-api/card/payments', { check_id: check, payment_id: ulid(), amount: 1200, staff_id: staffId })
  await device(till, 'POST', `/pos-api/card/payments/${lost.json.id}/test`, { result: 'approve' })
  const problems = await ok(owner.get(`/api/pos/venues/${W}/card-payments?status=problems`))
  assert.ok(problems.some(p => p.id === lost.json.id && p.not_on_check), 'money taken that no check shows')
  assert.equal((await as(A.viewer, ids.a).get(`/api/pos/venues/${W}/card-payments`)).status, 403)
  const all = await ok(as(A.operator, ids.a).get(`/api/pos/venues/${W}/card-payments`), 'Till reports view sees card payments')
  assert.ok(all.length >= 8)
  assert.ok(all.some(p => p.kind === 'refund'))

  // Removing the machine a kiosk uses puts the kiosk back to none.
  await ok(owner.delete('/api/pos/card-readers/' + testReader.id))
  const [k] = await sql`SELECT settings->>'card_reader' AS r FROM pos_devices WHERE id = ${kiosk.id}`
  assert.equal(k.r, 'none')
  const kcfg = await device(kiosk, 'GET', '/pos-api/config')
  assert.equal(kcfg.json.card_machine, null)
  // Removing an account forgets its key and removes its machines; past payments stay.
  await ok(owner.delete('/api/pos/card-accounts/' + stripeAcct.id))
  const [a] = await sql`SELECT secret, removed_at FROM pos_card_accounts WHERE id = ${stripeAcct.id}`
  assert.equal(a.secret, null)
  assert.ok(a.removed_at)
  assert.equal((await sql`SELECT count(*)::int AS n FROM pos_card_readers WHERE account_id = ${stripeAcct.id} AND removed_at IS NULL`)[0].n, 0)
  assert.ok((await sql`SELECT count(*)::int AS n FROM pos_card_payments WHERE account_id = ${stripeAcct.id}`)[0].n > 0)
})
