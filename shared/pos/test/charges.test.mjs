// Charges per order type and discounts from the Store tech list (migration
// 225; shared/pos/charges.js, discounts.js) in the shared check rules: the
// till, the cloud's sequencer and the venue hub all work them out alike.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent, replay } from '../checks.js'
import { checkTotals } from '../pricing.js'
import { dayFigures } from '../reports.js'
import { billOps } from '../printing.js'
import { toText } from '../tickets.js'
import {
  chargeProblem, chargesForType, switchCharges, chargeAmount, chargeLabel, chargeSummary, cleanTypeCharge, typeCharges,
} from '../charges.js'
import { normaliseDiscount, discountList, presetMismatch } from '../discounts.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid(), OTHER_VENUE = uuid()
const SERVER = uuid(), SUPER = uuid(), LEAD = uuid()
const staffById = {
  // No discounts of their own, can't approve.
  [SERVER]: { id: SERVER, name: 'Anna', permissions: { discount_max_pct: 0 } },
  // Up to 25% off, can't approve.
  [LEAD]:   { id: LEAD, name: 'Dev', permissions: { discount_max_pct: 25 } },
  // Approves, up to 25% off.
  [SUPER]:  { id: SUPER, name: 'Ben', permissions: { discount_max_pct: 25, manager: true, comp: true } },
}

const VAT20 = { id: uuid(), name: 'Standard', rate: 20, values: { [OTHER_VENUE]: 5 }, is_default: true, is_active: true }
const SERVICE = { id: uuid(), name: 'Service charge', kind: 'percent', value: 12.5, optional: true, min_covers: 0, tax_rate_id: null }
const PARTY = { id: uuid(), name: 'Large party', kind: 'percent', value: 2.5, optional: false, min_covers: 6, tax_rate_id: null }
const BAG = { id: uuid(), name: 'Packaging', kind: 'amount', value: 50, optional: false, min_covers: 0, tax_rate_id: VAT20.id }
const EAT_IN = { id: uuid(), name: 'Eat in', charges: [SERVICE, PARTY] }
const TAKE_OUT = { id: uuid(), name: 'Take out', charges: [BAG] }

let clock = Date.parse('2026-10-31T18:00:00Z')
function ev(type, payload, { check_id = null, staff_id = SERVER, approved_by = null } = {}) {
  clock += 1000
  return { id: ulid(clock), venue_id: VENUE, device_id: 'T1', staff_id, approved_by, check_id, type, payload, client_at: new Date(clock).toISOString(), assigned: { day_id: 'day-1' } }
}
const line = (name, price, extra = {}) => ({ id: ulid(), item_id: uuid(), section_id: null, name, qty: 1, unit_price: price, modifiers: [], combo: null, vat_rate: 20, ...extra })

function setup({ type = EAT_IN, covers = 2, settings = null, lines = [line('Burger', 1000), line('Cola', 300, { qty: 2 })] } = {}) {
  const id = ulid()
  const events = [
    ev('check.opened', { mode: 'table', covers, order_type_id: type.id, charges: chargesForType(type, VENUE, [VAT20]) }, { check_id: id }),
    ...lines.map(l => ev('line.added', { line: l }, { check_id: id })),
  ]
  const r = replay({}, events, { staffById, settings })
  assert.equal(r.refused.length, 0, JSON.stringify(r.refused))
  return { id, checks: r.checks, check: r.checks[id] }
}
const apply = (checks, e, settings = null) => applyEvent(checks, e, { staffById, settings })
const ok = r => { assert.ok(r.ok, r.error); return r }

test('an order type\'s charges: shape, cleaning and the tax rate\'s % at the venue', () => {
  assert.equal(chargeProblem(SERVICE), null)
  assert.equal(chargeProblem({ ...SERVICE, id: 'nope' }), 'charge.id')
  assert.equal(chargeProblem({ ...SERVICE, name: '  ' }), 'charge.name')
  assert.equal(chargeProblem({ ...SERVICE, kind: 'pct' }), 'charge.kind')
  assert.equal(chargeProblem({ ...SERVICE, value: 0 }), 'charge.value')
  assert.equal(chargeProblem({ ...SERVICE, value: 51 }), 'charge.value')
  assert.equal(chargeProblem({ ...BAG, value: 12.5 }), 'charge.value')
  assert.equal(chargeProblem({ ...BAG, value: 100_001 }), 'charge.value')
  assert.equal(chargeProblem({ ...SERVICE, min_covers: 101 }), 'charge.min_covers')
  assert.equal(chargeProblem({ ...SERVICE, optional: 'yes' }), 'charge.optional')
  assert.equal(chargeProblem({ ...SERVICE, tax_rate_id: 'x' }), 'charge.tax_rate_id')
  assert.deepEqual(cleanTypeCharge({ ...SERVICE, name: ' Service ', value: 12.499, min_covers: 3.6, junk: 1 }),
    { id: SERVICE.id, name: 'Service', kind: 'percent', value: 12.5, optional: true, min_covers: 4, tax_rate_id: null })
  // A broken stored charge is left out, not passed on.
  assert.equal(typeCharges({ charges: [SERVICE, { id: 'x' }] }).length, 1)
  // The tax rate's % where the till is; none = no VAT.
  assert.equal(chargesForType(TAKE_OUT, VENUE, [VAT20])[0].vat_rate, 20)
  assert.equal(chargesForType(TAKE_OUT, OTHER_VENUE, [VAT20])[0].vat_rate, 5)
  assert.equal(chargesForType(EAT_IN, VENUE, [VAT20])[0].vat_rate, 0)
  // A rate the till doesn't know any more: no VAT rather than a guess.
  assert.deepEqual(chargesForType(TAKE_OUT, VENUE, []).map(x => [x.tax_rate_id, x.vat_rate]), [[null, 0]])
  assert.equal(chargeLabel(SERVICE), 'Service charge 12.5%')
  assert.equal(chargeLabel(BAG), 'Packaging')
  assert.equal(chargeSummary(PARTY), 'Large party 2.5%, from 6 guests')
  assert.equal(chargeSummary(SERVICE), 'Service charge 12.5%, optional')
  assert.equal(chargeAmount(BAG, 0, false), 0)
  assert.equal(chargeAmount(BAG, 0, true), 50)
  assert.equal(chargeAmount(SERVICE, -100), 0)
})

test('totals: a percent of the check after discounts, an amount, a party charge from N guests', () => {
  const { id, checks } = setup()
  let t = checkTotals(checks[id])
  assert.equal(t.net, 1600)
  assert.deepEqual(t.charges.map(x => [x.name, x.amount, x.waiting]), [['Service charge', 200, false], ['Large party', 0, true]])
  assert.equal(t.service_charge, 200)
  assert.equal(t.total, 1800)
  // 10% off the check comes off before the charge.
  const lead = { ...checks }
  const d = ok(apply(lead, ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 10, name: 'Regular' } }, { check_id: id, staff_id: LEAD })))
  t = checkTotals(d.checks[id])
  assert.equal(t.net, 1440)
  assert.equal(t.service_charge, 180)
  // Six guests: the party charge starts by itself.
  const six = ok(apply(checks, ev('check.covers_set', { covers: 6 }, { check_id: id })))
  t = checkTotals(six.checks[id])
  assert.deepEqual(t.charges.map(x => x.amount), [200, 40])
  assert.equal(t.total, 1600 + 240)
  // Take out: a 50p bag at 20% VAT, only once something is on the check.
  const empty = setup({ type: TAKE_OUT, lines: [] })
  assert.equal(checkTotals(empty.check).total, 0)
  const bag = setup({ type: TAKE_OUT })
  t = checkTotals(bag.check)
  assert.equal(t.service_charge, 50)
  assert.equal(t.total, 1650)
  assert.equal(t.vat.find(v => v.rate === 20).gross, 1650)
})

test('taking charges off: optional ones by anyone, others by a manager; putting them back', () => {
  const { id, checks } = setup({ covers: 8 })
  const off = (charge_id, opts = {}, settings = null) => apply(checks, ev('charge.removed', { charge_id, reason: 'Guest asked' }, { check_id: id, ...opts }), settings)
  // Optional: anyone.
  const r = ok(off(SERVICE.id))
  const x = r.checks[id].charges.find(c => c.id === SERVICE.id)
  assert.equal(x.removed, true)
  assert.equal(x.reason, 'Guest asked')
  assert.equal(x.removed_by, SERVER)
  let t = checkTotals(r.checks[id])
  assert.equal(t.service_charge, 40)
  assert.equal(t.charges[0].would_be, 200)
  // The venue's switch: optional ones need a manager too.
  const sw = { approvals: { remove_charge: true } }
  assert.equal(off(SERVICE.id, {}, sw).code, 'manager')
  assert.equal(off(SERVICE.id, { approved_by: LEAD }, sw).code, 'manager')
  ok(off(SERVICE.id, { approved_by: SUPER }, sw))
  ok(off(SERVICE.id, { staff_id: SUPER }, sw))
  // Not optional: a manager every time, switch or not.
  assert.equal(off(PARTY.id).code, 'manager')
  const party = ok(off(PARTY.id, { approved_by: SUPER }))
  assert.equal(party.checks[id].charges[1].approved_by, SUPER)
  // A reason is needed; a charge not on the check isn't found; twice is refused.
  assert.equal(apply(checks, ev('charge.removed', { charge_id: SERVICE.id, reason: ' ' }, { check_id: id })).code, 'invalid')
  assert.equal(off(uuid()).code, 'missing')
  assert.equal(apply(r.checks, ev('charge.removed', { charge_id: SERVICE.id, reason: 'Again' }, { check_id: id })).code, 'duplicate')
  // Back on: anyone; not when it is on.
  const back = ok(apply(r.checks, ev('charge.restored', { charge_id: SERVICE.id }, { check_id: id })))
  t = checkTotals(back.checks[id])
  assert.equal(t.service_charge, 240)
  assert.equal(back.checks[id].charges[0].reason, null)
  assert.equal(apply(checks, ev('charge.restored', { charge_id: SERVICE.id }, { check_id: id })).code, 'duplicate')
})

test('a charge typed on the till: always optional, never twice', () => {
  const { id, checks } = setup({ type: TAKE_OUT })
  const tip = { id: ulid(), name: 'Service charge', kind: 'percent', value: 10, optional: false, min_covers: 5 }
  const r = ok(apply(checks, ev('charge.added', { charge: tip }, { check_id: id })))
  const added = r.checks[id].charges.find(c => c.id === tip.id)
  assert.deepEqual([added.added, added.optional, added.min_covers, added.added_by], [true, true, 0, SERVER])
  assert.equal(checkTotals(r.checks[id]).service_charge, 50 + 160)
  assert.equal(apply(r.checks, ev('charge.added', { charge: tip }, { check_id: id })).code, 'duplicate')
  assert.equal(apply(checks, ev('charge.added', { charge: { ...tip, value: 80 } }, { check_id: id })).code, 'invalid')
  // Taken off again by anyone.
  ok(apply(r.checks, ev('charge.removed', { charge_id: tip.id, reason: 'Mistake' }, { check_id: id })))
})

test('changing the order type: the new type\'s charges, one taken off stays off, typed ones stay', () => {
  const { id, checks } = setup({ covers: 8 })
  let r = ok(apply(checks, ev('charge.removed', { charge_id: SERVICE.id, reason: 'Guest asked' }, { check_id: id })))
  const typed = { id: ulid(), name: 'Corkage', kind: 'amount', value: 500 }
  r = ok(apply(r.checks, ev('charge.added', { charge: typed }, { check_id: id })))
  // To take out: the bag, plus corkage; the service charge taken off is remembered.
  const toOut = ok(apply(r.checks, ev('check.order_type_set', { order_type_id: TAKE_OUT.id, charges: chargesForType(TAKE_OUT, VENUE, [VAT20]) }, { check_id: id })))
  assert.deepEqual(toOut.checks[id].charges.map(c => c.name), ['Packaging', 'Corkage'])
  assert.equal(toOut.checks[id].charges_off[SERVICE.id].reason, 'Guest asked')
  // And back to eat in: the service charge is still off, with its reason; the
  // party charge is on (it was never taken off); typed ones stay.
  const back = ok(apply(toOut.checks, ev('check.order_type_set', { order_type_id: EAT_IN.id, charges: chargesForType(EAT_IN, VENUE, [VAT20]) }, { check_id: id })))
  const charges = back.checks[id].charges
  assert.deepEqual(charges.map(c => [c.name, !!c.removed]), [['Service charge', true], ['Large party', false], ['Corkage', false]])
  assert.equal(charges[0].reason, 'Guest asked')
  assert.equal(back.checks[id].charges_off, undefined, 'back on the check: nothing left to remember')
  // Put back, then the same round trip: it stays on.
  const restored = ok(apply(back.checks, ev('charge.restored', { charge_id: SERVICE.id }, { check_id: id })))
  const out2 = ok(apply(restored.checks, ev('check.order_type_set', { order_type_id: TAKE_OUT.id, charges: chargesForType(TAKE_OUT, VENUE, [VAT20]) }, { check_id: id })))
  assert.equal(out2.checks[id].charges_off, undefined)
  const back2 = ok(apply(out2.checks, ev('check.order_type_set', { order_type_id: EAT_IN.id, charges: chargesForType(EAT_IN, VENUE, [VAT20]) }, { check_id: id })))
  assert.deepEqual(back2.checks[id].charges.map(c => [c.name, !!c.removed]), [['Service charge', false], ['Large party', false], ['Corkage', false]])
  // A manager took the party charge off at 8 covers: it stays off through a round trip too.
  const party = ok(apply(back2.checks, ev('charge.removed', { charge_id: PARTY.id, reason: 'Agreed' }, { check_id: id, approved_by: SUPER })))
  const out3 = ok(apply(party.checks, ev('check.order_type_set', { order_type_id: TAKE_OUT.id, charges: chargesForType(TAKE_OUT, VENUE, [VAT20]) }, { check_id: id })))
  const back3 = ok(apply(out3.checks, ev('check.order_type_set', { order_type_id: EAT_IN.id, charges: chargesForType(EAT_IN, VENUE, [VAT20]) }, { check_id: id })))
  const p3 = back3.checks[id].charges.find(c => c.id === PARTY.id)
  assert.deepEqual([p3.removed, p3.reason, p3.approved_by], [true, 'Agreed', SUPER])
  // A change to a type that has the charge too keeps it off.
  const kept = switchCharges(r.checks[id].charges, chargesForType(EAT_IN, VENUE, [VAT20])).charges
  assert.deepEqual(kept.map(c => [c.name, !!c.removed]), [['Service charge', true], ['Large party', false], ['Corkage', false]])
  // An event without charges leaves them as they are.
  const same = ok(apply(r.checks, ev('check.order_type_set', { order_type_id: TAKE_OUT.id }, { check_id: id })))
  assert.equal(same.checks[id].charges.length, 3)
  // Two charges with one id is refused.
  assert.equal(apply(r.checks, ev('check.order_type_set', { order_type_id: TAKE_OUT.id, charges: [BAG, BAG] }, { check_id: id })).code, 'invalid')
})

test('kiosks: no charges on their orders', () => {
  const KIOSK = uuid()
  const people = { ...staffById, [KIOSK]: { id: KIOSK, name: 'Kiosk 1', kiosk: true, permissions: {} } }
  const id = ulid()
  // Only the kiosk itself sends its events (its device id is its staff id).
  const opened = e => applyEvent({}, { ...e, device_id: KIOSK }, { staffById: people })
  assert.equal(opened(ev('check.opened', { mode: 'counter', charges: chargesForType(TAKE_OUT, VENUE, [VAT20]) }, { check_id: id, staff_id: KIOSK })).code, 'kiosk')
  assert.ok(opened(ev('check.opened', { mode: 'counter', charges: [] }, { check_id: id, staff_id: KIOSK })).ok)
})

test('the day\'s figures and the bill: each charge by name, what was taken off', () => {
  const a = setup({ covers: 8 })
  const b = setup()
  let checks = { ...a.checks, ...b.checks }
  checks = { ...checks, ...ok(apply(checks, ev('charge.removed', { charge_id: SERVICE.id, reason: 'Guest asked' }, { check_id: b.id }))).checks }
  for (const id of [a.id, b.id]) {
    const total = checkTotals(checks[id]).total
    checks = { ...checks, ...ok(apply(checks, ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: total } }, { check_id: id }))).checks }
    checks = { ...checks, ...ok(apply(checks, ev('check.closed', {}, { check_id: id }))).checks }
  }
  const f = dayFigures(Object.values(checks), 'day-1')
  assert.deepEqual(f.charges, [
    { name: 'Service charge', count: 1, amount: 200, removed: 1, removed_value: 200 },
    { name: 'Large party', count: 1, amount: 40, removed: 0, removed_value: 0 },
  ])
  assert.equal(f.sales.service_charge, 240)
  assert.equal(f.sales.total, 1600 * 2 + 240)
  // The bill lists each charge that counts.
  const text = toText(billOps(checks[a.id], { settings: {}, venue: { name: 'Ware' }, layouts: {} }))
  assert.match(text, /Service charge 12\.5%\s+£2\.00/)
  assert.match(text, /Large party 2\.5%\s+£0\.40/)
  assert.doesNotMatch(toText(billOps(checks[b.id], { settings: {}, venue: { name: 'Ware' }, layouts: {} })), /Service charge/)
})

test('discounts from the list: as set up, a manager only when they say so', () => {
  const STAFF_MEAL = { id: uuid(), name: 'Staff meal', kind: 'percent', value: 50, scope: 'check', needs_manager: false }
  const FIVER = { id: uuid(), name: '£5 off', kind: 'amount', value: 500, scope: 'any', needs_manager: true }
  const NHS = { id: uuid(), name: 'NHS', kind: 'percent', value: 10, scope: 'line', needs_manager: false }
  const settings = { discounts: [STAFF_MEAL, FIVER, NHS, { id: 'broken' }] }
  assert.equal(discountList(settings).length, 3)
  assert.equal(normaliseDiscount({ ...STAFF_MEAL, value: 120 }), null)
  assert.equal(normaliseDiscount({ ...FIVER, value: 4.5 }), null)
  assert.deepEqual(normaliseDiscount({ ...NHS, scope: 'odd' }).scope, 'any')
  const { id, checks, check } = setup({ settings })
  const put = (preset, d = {}, opts = {}, s = settings) => apply(checks, ev('discount.applied', {
    discount: { id: ulid(), scope: preset.scope === 'line' ? 'line' : 'check', type: preset.kind, value: preset.value, name: preset.name, preset_id: preset.id, ...(preset.scope === 'line' ? { line_ids: [check.lines[0].id] } : {}), ...d },
  }, { check_id: id, ...opts }), s)
  // No manager flag: Anna (no discounts of her own) may use it.
  const meal = ok(put(STAFF_MEAL))
  const on = meal.checks[id].discounts[0]
  assert.deepEqual([on.preset_id, on.name, on.value], [STAFF_MEAL.id, 'Staff meal', 50])
  assert.equal(checkTotals(meal.checks[id]).net, 800)
  // Its own value and scope only.
  assert.equal(put(STAFF_MEAL, { value: 60 }).code, 'preset')
  assert.equal(put(STAFF_MEAL, { type: 'amount', value: 50 }).code, 'preset')
  assert.equal(put(STAFF_MEAL, { scope: 'line', line_ids: [check.lines[0].id] }).code, 'preset')
  assert.equal(put(NHS, { scope: 'check', line_ids: undefined }).code, 'preset')
  ok(put(NHS))
  // Not on the list (removed in Store tech, or another group's).
  assert.equal(put({ ...STAFF_MEAL, id: uuid() }).code, 'preset')
  assert.equal(put(STAFF_MEAL, {}, {}, { discounts: [] }).code, 'preset')
  // Marked: a manager every time, even for Dev who could type £5 off himself.
  assert.equal(put(FIVER).code, 'manager')
  assert.equal(put(FIVER, {}, { staff_id: LEAD }).code, 'manager')
  assert.equal(put(FIVER, {}, { approved_by: LEAD }).code, 'manager')
  ok(put(FIVER, {}, { approved_by: SUPER }))
  ok(put(FIVER, {}, { staff_id: SUPER }))
  // The shape: a preset discount can't be a comp or a loyalty reward.
  assert.equal(put(STAFF_MEAL, { comp: true, reason: 'x' }).code, 'invalid')
  assert.equal(presetMismatch(normaliseDiscount(STAFF_MEAL), { scope: 'check', type: 'percent', value: 50 }), null)
})

test('discounts typed in: the role\'s limit, and the venue\'s switch for a manager every time', () => {
  const { id, checks } = setup()
  const typed = (value, opts = {}, settings = null) => apply(checks, ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value, name: 'Regular' } }, { check_id: id, ...opts }), settings)
  // Off: Dev may give up to 25%.
  ok(typed(10, { staff_id: LEAD }))
  assert.equal(typed(30, { staff_id: LEAD }).code, 'permission')
  // On: a manager every time, within the approver's own limit.
  const sw = { approvals: { custom_discount: true } }
  assert.equal(typed(10, { staff_id: LEAD }, sw).code, 'manager')
  ok(typed(10, { staff_id: LEAD, approved_by: SUPER }, sw))
  ok(typed(10, { staff_id: SUPER }, sw))
  assert.equal(typed(30, { staff_id: LEAD, approved_by: SUPER }, sw).code, 'permission')
  // Comps and loyalty rewards aren't typed-in discounts.
  ok(apply(checks, ev('discount.applied', { discount: { id: ulid(), scope: 'check', comp: true, reason: 'Birthday' } }, { check_id: id, staff_id: SUPER }), sw))
})
