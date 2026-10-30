// Loyalty on till checks (shared/loyalty.js + shared/pos/checks.js,
// migration 211): putting a member on a check, spending a reward the server
// reserved, a kiosk's loyalty events, and the sequencer using a redemption
// once and refusing without a store that has them.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent, eventProblem } from '../checks.js'
import { checkTotals } from '../pricing.js'
import { createSequencer } from '../sequencer.js'
import { loyaltyNeed, loyaltyProblem } from '../../loyalty.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid()
const ANNA = uuid(), KIOSK = uuid()
const MEMBER = uuid(), OTHER = uuid()
const LATTE = uuid()
const staffById = {
  [ANNA]: { id: ANNA, name: 'Anna', permissions: { discount_max_pct: 0 } },
  [KIOSK]: { id: KIOSK, name: 'Kiosk', kiosk: true, permissions: {} },
}
const ev = (type, payload, extra = {}) => ({ id: ulid(), venue_id: VENUE, type, payload, staff_id: ANNA, client_at: new Date().toISOString(), ...extra })
const latte = () => ({ id: ulid(), item_id: LATTE, name: 'Latte', qty: 2, unit_price: 350, modifiers: [], vat_rate: 20 })
const cake = () => ({ id: ulid(), item_id: uuid(), name: 'Cake', qty: 1, unit_price: 1300, modifiers: [], vat_rate: 20 })

function openCheck(staff = ANNA) {
  const id = ulid()
  let checks = {}
  for (const e of [ev('check.opened', { mode: 'counter' }), ev('line.added', { line: latte() }), ev('line.added', { line: cake() })]) {
    const r = applyEvent(checks, { ...e, check_id: id, staff_id: staff }, { staffById })
    assert.ok(r.ok, r.error)
    checks = { ...checks, ...r.checks }
  }
  return { id, checks }
}
const member = (id = MEMBER) => ({ id, no: '000001239', name: 'Sam' })
const rewardDiscount = (redemptionId, extra = {}) => ({ id: ulid(), scope: 'check', type: 'amount', value: 500, name: '£5 off', loyalty_redemption_id: redemptionId, ...extra })

test('shape: a member on the check, a reward discount', () => {
  assert.equal(eventProblem(ev('check.member_set', { member: member() }, { check_id: ulid() })), null)
  assert.equal(eventProblem(ev('check.member_set', { member: null }, { check_id: ulid() })), null)
  assert.match(eventProblem(ev('check.member_set', { member: { id: 'x' } }, { check_id: ulid() })), /member/)
  assert.match(eventProblem(ev('check.member_set', {}, { check_id: ulid() })), /member/)
  const d = x => eventProblem(ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'amount', value: 100, ...x } }, { check_id: ulid() }))
  assert.equal(d({ loyalty_redemption_id: uuid() }), null)
  assert.match(d({ loyalty_redemption_id: 'nope' }), /loyalty_redemption_id/)
  assert.match(d({ loyalty_redemption_id: uuid(), comp: true }), /loyalty_redemption_id/, 'a reward is never a comp')
})

test('a member goes on a check, open or closed; a reward needs the member and no discount permission', () => {
  const { id, checks } = openCheck()
  const noMember = applyEvent(checks, ev('discount.applied', { discount: rewardDiscount(uuid()) }, { check_id: id }), { staffById })
  assert.equal(noMember.code, 'loyalty')
  const plain = applyEvent(checks, ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'amount', value: 500, name: 'x' } }, { check_id: id }), { staffById })
  assert.equal(plain.code, 'permission', 'Anna can\'t give a discount of her own')
  let r = applyEvent(checks, ev('check.member_set', { member: member() }, { check_id: id }), { staffById })
  assert.ok(r.ok, r.error)
  assert.equal(r.checks[id].loyalty.member_id, MEMBER)
  assert.equal(r.checks[id].loyalty.name, 'Sam')
  const red = uuid()
  r = applyEvent(r.checks, ev('discount.applied', { discount: rewardDiscount(red) }, { check_id: id }), { staffById })
  assert.ok(r.ok, r.error)
  assert.equal(r.checks[id].discounts[0].loyalty_redemption_id, red)
  assert.equal(checkTotals(r.checks[id]).discount, 500)
  const twice = applyEvent(r.checks, ev('discount.applied', { discount: rewardDiscount(red) }, { check_id: id }), { staffById })
  assert.equal(twice.code, 'duplicate')
  const off = applyEvent(r.checks, ev('check.member_set', { member: null }, { check_id: id }), { staffById })
  assert.equal(off.code, 'loyalty', 'the reward goes first')
  const swap = applyEvent(r.checks, ev('check.member_set', { member: member(OTHER) }, { check_id: id }), { staffById })
  assert.equal(swap.code, 'loyalty')
  const same = applyEvent(r.checks, ev('check.member_set', { member: member() }, { check_id: id }), { staffById })
  assert.ok(same.ok, 'putting the same member on again is fine')

  // Closed: the member can still go on (a card shown after paying).
  const { id: id2, checks: c2 } = openCheck()
  let s = applyEvent(c2, ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 2000 } }, { check_id: id2 }), { staffById })
  s = applyEvent({ ...c2, ...s.checks }, ev('check.closed', {}, { check_id: id2 }), { staffById })
  assert.ok(s.ok, s.error)
  const late = applyEvent(s.checks, ev('check.member_set', { member: member() }, { check_id: id2 }), { staffById })
  assert.ok(late.ok, late.error)
  assert.equal(late.checks[id2].status, 'closed')
})

test('a kiosk may put a member on its order and spend a reward, nothing else of discounts', () => {
  const { id, checks } = openCheck(KIOSK)
  let r = applyEvent(checks, ev('check.member_set', { member: member() }, { check_id: id, staff_id: KIOSK }), { staffById })
  assert.ok(r.ok, r.error)
  const ok = applyEvent(r.checks, ev('discount.applied', { discount: rewardDiscount(uuid()) }, { check_id: id, staff_id: KIOSK }), { staffById })
  assert.ok(ok.ok, ok.error)
  const own = applyEvent(r.checks, ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 50, name: 'x' } }, { check_id: id, staff_id: KIOSK }), { staffById })
  assert.equal(own.code, 'kiosk')
})

test('loyaltyNeed / loyaltyProblem: the redemption must allow exactly this discount, once', () => {
  const { id, checks: c0 } = openCheck()
  const checks = applyEvent(c0, ev('check.member_set', { member: member() }, { check_id: id }), { staffById }).checks
  const red = uuid()
  const e = ev('discount.applied', { discount: rewardDiscount(red) }, { check_id: id })
  const need = loyaltyNeed(e, checks)
  assert.equal(need.id, red)
  assert.equal(need.member_id, MEMBER)
  const row = { id: red, venue_id: VENUE, member_id: MEMBER, status: 'reserved', check_id: null, used_event_id: null, discount: { scope: 'check', type: 'amount', value: 500 } }
  assert.equal(loyaltyProblem(e, need, row), null)
  assert.match(loyaltyProblem(e, need, null), /wasn't found/)
  assert.match(loyaltyProblem(e, need, { ...row, member_id: OTHER }), /another member/)
  assert.match(loyaltyProblem(e, need, { ...row, venue_id: uuid() }), /another venue/)
  assert.match(loyaltyProblem(e, need, { ...row, status: 'released' }), /put back/)
  assert.match(loyaltyProblem(e, need, { ...row, status: 'used', used_event_id: ulid() }), /already been used/)
  assert.equal(loyaltyProblem(e, need, { ...row, status: 'used', used_event_id: e.id }), null, 'the same event again')
  assert.match(loyaltyProblem(e, need, { ...row, check_id: ulid() }), /another check/)
  assert.match(loyaltyProblem(e, need, { ...row, discount: { scope: 'check', type: 'amount', value: 400 } }), /at most £4.00/)
  assert.match(loyaltyProblem(e, need, { ...row, discount: { scope: 'check', type: 'percent', value: 10 } }), /doesn't match/)
  const pct = ev('discount.applied', { discount: rewardDiscount(red, { type: 'percent', value: 10 }) }, { check_id: id })
  assert.equal(loyaltyProblem(pct, loyaltyNeed(pct, checks), { ...row, discount: { scope: 'check', type: 'percent', value: 10 } }), null)
  assert.match(loyaltyProblem(pct, loyaltyNeed(pct, checks), { ...row, discount: { scope: 'check', type: 'percent', value: 15 } }), /doesn't match/)

  // A free dish: the discount's line must be one the reward covers, at most its price.
  const latteLine = checks[id].lines.find(l => l.item_id === LATTE)
  const cakeLine = checks[id].lines.find(l => l.item_id !== LATTE)
  const freeRow = { ...row, discount: { scope: 'line', type: 'amount', item_ids: [LATTE], section_ids: [], value: null } }
  const free = v => ev('discount.applied', { discount: rewardDiscount(red, { scope: 'line', line_ids: [v.line], value: v.value }) }, { check_id: id })
  const f1 = free({ line: latteLine.id, value: 350 })
  assert.equal(loyaltyProblem(f1, loyaltyNeed(f1, checks), freeRow), null)
  const f2 = free({ line: latteLine.id, value: 351 })
  assert.match(loyaltyProblem(f2, loyaltyNeed(f2, checks), freeRow), /more than the dish costs/)
  const f3 = free({ line: cakeLine.id, value: 300 })
  assert.match(loyaltyProblem(f3, loyaltyNeed(f3, checks), freeRow), /isn't for this dish/)
  assert.match(loyaltyProblem(f1, loyaltyNeed(f1, checks), { ...freeRow, discount: { ...freeRow.discount, value: 200 } }), /at most £2.00/)
  assert.equal(loyaltyNeed(ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'amount', value: 1 } }, { check_id: id }), checks), null)
})

test('the sequencer uses a redemption once, and refuses without a store that has them', async () => {
  const redemptions = new Map()
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
    loadLoyaltyRedemption: id => redemptions.get(id) || null,
    useLoyaltyRedemption: (id, e) => { used.push(id); redemptions.set(id, { ...redemptions.get(id), status: 'used', used_event_id: e.id, check_id: e.check_id }) },
  }
  const s = createSequencer(store)
  const id = ulid()
  for (const e of [ev('check.opened', { mode: 'counter' }), ev('line.added', { line: latte() }), ev('check.member_set', { member: member() })]) {
    const r = await s.submit({ ...e, check_id: id })
    assert.ok(r.ok, r.error)
  }
  const red = uuid()
  redemptions.set(red, { id: red, venue_id: VENUE, member_id: MEMBER, status: 'reserved', check_id: null, used_event_id: null, discount: { scope: 'check', type: 'amount', value: 300 } })
  const first = await s.submit(ev('discount.applied', { discount: rewardDiscount(red, { value: 300 }) }, { check_id: id }))
  assert.ok(first.ok, first.error)
  assert.deepEqual(used, [red])
  const other = ulid()
  for (const e of [ev('check.opened', { mode: 'counter' }), ev('line.added', { line: latte() }), ev('check.member_set', { member: member() })]) {
    assert.ok((await s.submit({ ...e, check_id: other })).ok)
  }
  const again = await s.submit(ev('discount.applied', { discount: rewardDiscount(red, { value: 300 }) }, { check_id: other }))
  assert.equal(again.ok, false)
  assert.equal(again.code, 'loyalty')
  const red2 = uuid()
  redemptions.set(red2, { id: red2, venue_id: VENUE, member_id: MEMBER, status: 'reserved', discount: { scope: 'check', type: 'amount', value: 200 } })
  const tooMuch = await s.submit(ev('discount.applied', { discount: rewardDiscount(red2, { value: 300 }) }, { check_id: other }))
  assert.match(tooMuch.error, /at most £2.00/)
  assert.deepEqual(used, [red], 'refused redemptions stay unused')

  const hub = createSequencer({ ...store, loadLoyaltyRedemption: undefined, useLoyaltyRedemption: undefined })
  const offline = await hub.submit(ev('discount.applied', { discount: rewardDiscount(red2, { value: 200 }) }, { check_id: other }))
  assert.equal(offline.ok, false)
  assert.match(offline.error, /need the internet/)
})
