// Card machine payments on checks (shared/pos/cards.js, migration 193): the
// shape rules, taking a card machine payment off only once refunded, the
// kiosk's card payments, which attempt an event needs, what is wrong with an
// attempt, and the sequencer using a store's attempts once.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent, eventProblem } from '../checks.js'
import { cardNeed, cardProblem } from '../cards.js'
import { createSequencer } from '../sequencer.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid()
const ANNA = uuid(), CARA = uuid(), KIOSK = uuid()
const staffById = {
  [ANNA]: { id: ANNA, name: 'Anna', permissions: { discount_max_pct: 0 } },
  [CARA]: { id: CARA, name: 'Cara', permissions: { void: true, refund: true, manager: true, discount_max_pct: 100 } },
  [KIOSK]: { id: KIOSK, name: 'Kiosk', kiosk: true, permissions: {} },
}
const ev = (type, payload, extra = {}) => ({ id: ulid(), venue_id: VENUE, type, payload, staff_id: ANNA, client_at: new Date().toISOString(), ...extra })
const line = () => ({ id: ulid(), item_id: uuid(), name: 'Pad Thai', qty: 1, unit_price: 1200, modifiers: [], vat_rate: 20 })

function openCheck(staff = ANNA) {
  const id = ulid()
  let r = applyEvent({}, ev('check.opened', { mode: 'counter' }, { check_id: id, staff_id: staff }), { staffById })
  assert.ok(r.ok, r.error)
  r = applyEvent(r.checks, ev('line.added', { line: line() }, { check_id: id, staff_id: staff }), { staffById })
  assert.ok(r.ok, r.error)
  return r.checks
}

test('shape: a card machine payment names its attempt; nothing else may', () => {
  const pay = (p, extra) => eventProblem(ev('payment.added', { payment: { id: ulid(), amount: 500, ...p } }, { check_id: ulid(), ...extra }))
  assert.match(pay({ tender: 'card_integrated' }), /card_payment_id/)
  assert.equal(pay({ tender: 'card_integrated', card_payment_id: uuid() }), null)
  assert.match(pay({ tender: 'card_integrated', card_payment_id: 'abc' }), /card_payment_id/)
  assert.match(pay({ tender: 'card_external', card_payment_id: uuid() }), /card_payment_id/, 'a hand-recorded card can\'t claim an attempt')
  const refund = r => eventProblem(ev('refund.added', { refund: { id: ulid(), amount: 100, reason: 'x', ...r } }, { check_id: ulid() }))
  assert.match(refund({ tender: 'card_integrated' }), /card_refund_id/)
  assert.equal(refund({ tender: 'card_integrated', card_refund_id: uuid() }), null)
  assert.match(eventProblem(ev('payment.voided', { payment_id: ulid(), reason: 'x', card_refund_id: 'nope' }, { check_id: ulid() })), /card_refund_id/)
})

test('a card machine payment comes off a check only with its refund', () => {
  const checks = openCheck()
  const id = Object.keys(checks)[0]
  const payId = ulid()
  let r = applyEvent(checks, ev('payment.added', { payment: { id: payId, tender: 'card_integrated', amount: 1000, tip: 100, card_payment_id: uuid() } }, { check_id: id }), { staffById })
  assert.ok(r.ok, r.error)
  assert.ok(r.checks[id].payments[0].card_payment_id, 'kept on the payment')
  const off = applyEvent(r.checks, ev('payment.voided', { payment_id: payId, reason: 'Wrong' }, { check_id: id, staff_id: CARA }), { staffById })
  assert.equal(off.ok, false)
  assert.equal(off.code, 'card_refund')
  const refund = uuid()
  const ok = applyEvent(r.checks, ev('payment.voided', { payment_id: payId, reason: 'Wrong', card_refund_id: refund }, { check_id: id, staff_id: CARA }), { staffById })
  assert.ok(ok.ok, ok.error)
  assert.equal(ok.checks[id].payments[0].card_refund_id, refund)
})

test('a kiosk may pay by card machine, with no tip', () => {
  const checks = openCheck(KIOSK)
  const id = Object.keys(checks)[0]
  const add = p => applyEvent(checks, ev('payment.added', { payment: { id: ulid(), amount: 1200, ...p } }, { check_id: id, staff_id: KIOSK }), { staffById })
  assert.ok(add({ tender: 'card_integrated', card_payment_id: uuid() }).ok)
  assert.equal(add({ tender: 'card_integrated', card_payment_id: uuid(), tip: 100 }).ok, false)
  assert.equal(add({ tender: 'cash' }).ok, false)
})

test('cardNeed / cardProblem: which attempt, and what is wrong with it', () => {
  const checks = openCheck()
  const id = Object.keys(checks)[0]
  const sale = uuid()
  const payId = ulid()
  const e = ev('payment.added', { payment: { id: payId, tender: 'card_integrated', amount: 1000, tip: 100, card_payment_id: sale } }, { check_id: id })
  const need = cardNeed(e, checks)
  assert.deepEqual(need, { id: sale, kind: 'sale', amount: 1000, tip: 100, payment_id: payId })
  const row = { id: sale, kind: 'sale', venue_id: VENUE, status: 'approved', amount: 1000, tip: 100, check_id: id, payment_id: payId, used_event_id: null }
  assert.equal(cardProblem(e, need, row), null)
  assert.match(cardProblem(e, need, null), /no record/)
  assert.match(cardProblem(e, need, { ...row, status: 'pending' }), /didn't approve/)
  assert.match(cardProblem(e, need, { ...row, status: 'declined' }), /didn't approve/)
  assert.match(cardProblem(e, need, { ...row, amount: 900 }), /took £10.00, not £11.00/)
  assert.match(cardProblem(e, need, { ...row, used_event_id: ulid() }), /already on a check/)
  assert.equal(cardProblem(e, need, { ...row, used_event_id: e.id }), null, 'the same event again is fine')
  assert.match(cardProblem(e, need, { ...row, check_id: ulid() }), /another check/)
  assert.equal(cardProblem(e, need, { ...row, check_id: null }), null, 'a kiosk\'s attempt has no check yet')
  assert.match(cardProblem(e, need, { ...row, venue_id: uuid() }), /another venue/)
  assert.match(cardProblem(e, need, { ...row, payment_id: ulid() }), /another payment/)
  assert.match(cardProblem(e, need, { ...row, kind: 'refund' }), /no record/)
  assert.equal(cardNeed(ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 100 } }, { check_id: id }), checks), null)

  // Refunds and taking off: the refund must be of a card payment on this check.
  const paid = applyEvent(checks, e, { staffById }).checks
  const refundId = uuid()
  const r = ev('refund.added', { refund: { id: ulid(), tender: 'card_integrated', amount: 500, reason: 'x', card_refund_id: refundId } }, { check_id: id })
  const rNeed = cardNeed(r, paid)
  assert.deepEqual(rNeed.sales, [sale])
  const refundRow = { id: refundId, kind: 'refund', venue_id: VENUE, sale_id: sale, status: 'approved', amount: 500, check_id: id, used_event_id: null }
  assert.equal(cardProblem(r, rNeed, refundRow), null)
  assert.match(cardProblem(r, rNeed, { ...refundRow, sale_id: uuid() }), /isn't on this check/)
  assert.match(cardProblem(r, rNeed, { ...refundRow, amount: 400 }), /£4.00, not £5.00/)
  assert.match(cardProblem(r, rNeed, { ...refundRow, status: 'failed' }), /didn't go through/)
  const v = ev('payment.voided', { payment_id: payId, reason: 'x', card_refund_id: refundId }, { check_id: id })
  assert.deepEqual(cardNeed(v, paid), { id: refundId, kind: 'refund', amount: 1100, sales: [sale], whole: true }, 'the whole payment, tip included')
})

test('the sequencer uses an attempt once, and refuses without a store that has them', async () => {
  const attempts = new Map()
  const events = new Map()
  const checks = {}
  let seq = 0
  const used = []
  const store = {
    run: (_v, fn) => fn(),
    findEvent: id => events.get(id) || null,
    findRejection: () => null,
    context: () => ({ staffById, print: {}, timezone: 'Europe/London', settings: {} }),
    venueState: () => ({ last_seq: seq, numbers: {}, day: { id: 'D1', business_date: '2026-10-20' } }),
    openDay: () => ({ id: 'D1', business_date: '2026-10-20' }),
    loadChecks: ids => Object.fromEntries(ids.filter(i => checks[i]).map(i => [i, checks[i]])),
    openCheckCount: () => 0,
    saveEvent: e => { events.set(e.id, e) },
    saveChecks: c => Object.assign(checks, c),
    saveJobs: () => {},
    saveRejection: () => {},
    saveVenueState: v => { seq = v.last_seq },
    closeDay: () => {},
    loadCardPayment: id => attempts.get(id) || null,
    useCardPayment: (id, e) => { used.push(id); attempts.set(id, { ...attempts.get(id), used_event_id: e.id, check_id: e.check_id }) },
  }
  const s = createSequencer(store)
  const id = ulid()
  for (const e of [ev('check.opened', { mode: 'counter' }, { check_id: id }), ev('line.added', { line: line() }, { check_id: id })]) {
    assert.ok((await s.submit(e)).ok)
  }
  const sale = uuid()
  const payId = ulid()
  attempts.set(sale, { id: sale, kind: 'sale', venue_id: VENUE, status: 'approved', amount: 1200, tip: 0, check_id: null, payment_id: payId })
  const first = await s.submit(ev('payment.added', { payment: { id: payId, tender: 'card_integrated', amount: 1200, card_payment_id: sale } }, { check_id: id }))
  assert.ok(first.ok, first.error)
  assert.deepEqual(used, [sale])
  const second = await s.submit(ev('payment.added', { payment: { id: payId, tender: 'card_integrated', amount: 1200, card_payment_id: sale } }, { check_id: id }))
  assert.equal(second.ok, false, 'a new event naming a used attempt')

  // Another check can't take the same card payment, nor a payment for a different amount.
  const other = ulid()
  for (const e of [ev('check.opened', { mode: 'counter' }, { check_id: other }), ev('line.added', { line: line() }, { check_id: other })]) {
    assert.ok((await s.submit(e)).ok)
  }
  const again = await s.submit(ev('payment.added', { payment: { id: payId, tender: 'card_integrated', amount: 1200, card_payment_id: sale } }, { check_id: other }))
  assert.equal(again.ok, false)
  assert.equal(again.code, 'card')
  assert.match(again.error, /already on a check/)
  const sale2 = uuid()
  const pay2 = ulid()
  attempts.set(sale2, { id: sale2, kind: 'sale', venue_id: VENUE, status: 'approved', amount: 900, tip: 0, check_id: null, payment_id: pay2 })
  const wrong = await s.submit(ev('payment.added', { payment: { id: pay2, tender: 'card_integrated', amount: 1200, card_payment_id: sale2 } }, { check_id: other }))
  assert.equal(wrong.ok, false)
  assert.match(wrong.error, /took £9.00, not £12.00/)
  assert.deepEqual(used, [sale], 'refused attempts stay unused')

  const hub = createSequencer({ ...store, loadCardPayment: undefined, useCardPayment: undefined })
  const id2 = ulid()
  await hub.submit(ev('check.opened', { mode: 'counter' }, { check_id: id2 }))
  await hub.submit(ev('line.added', { line: line() }, { check_id: id2 }))
  const offline = await hub.submit(ev('payment.added', { payment: { id: ulid(), tender: 'card_integrated', amount: 1200, card_payment_id: uuid() } }, { check_id: id2 }))
  assert.equal(offline.ok, false)
  assert.match(offline.error, /need the internet/)
})
