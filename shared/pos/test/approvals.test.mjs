// The venue's "needs a manager every time" switches (pos_settings.approvals,
// migration 224) and Cancel order, in the shared check rules: the till and
// the sequencer both refuse what these refuse.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent, replay } from '../checks.js'
import { managerProblem, normaliseApprovals, MANAGER_ACTION_KEYS } from '../permissions.js'
import { dayFigures } from '../reports.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid()
const SERVER = uuid(), SUPER = uuid(), MANAGER = uuid(), SHIFT_LEAD = uuid()
const staffById = {
  // Can't void or refund.
  [SERVER]:     { id: SERVER, name: 'Anna', permissions: { discount_max_pct: 0, transfer: true } },
  // Can void, but can't approve for others.
  [SHIFT_LEAD]: { id: SHIFT_LEAD, name: 'Dev', permissions: { void: true } },
  // Approves; voids, no refunds.
  [SUPER]:      { id: SUPER, name: 'Ben', permissions: { void: true, manager: true } },
  // Approves everything.
  [MANAGER]:    { id: MANAGER, name: 'Cara', permissions: { void: true, refund: true, manager: true, reopen: true } },
}
const ALL_ON = { approvals: { delete_unsent: true, void_sent: true, cancel_order: true, refund: true } }
const ALL_OFF = { approvals: {} }

let clock = Date.parse('2026-10-31T18:00:00Z')
function ev(type, payload, { check_id = null, staff_id = SERVER, approved_by = null } = {}) {
  clock += 1000
  return { id: ulid(clock), venue_id: VENUE, device_id: 'T1', staff_id, approved_by, check_id, type, payload, client_at: new Date(clock).toISOString(), assigned: { day_id: 'day-1' } }
}
const line = (name, price, extra = {}) => ({ id: ulid(), item_id: uuid(), section_id: null, name, qty: 1, unit_price: price, modifiers: [], combo: null, vat_rate: 20, ...extra })

/** A check with a sent Burger and an unsent Cola (and more lines as asked). */
function setup(settings, { by = SERVER } = {}) {
  const id = ulid()
  const burger = line('Burger', 1000)
  const cola = line('Cola', 300, { qty: 2 })
  const events = [
    ev('check.opened', { mode: 'table', covers: 2 }, { check_id: id, staff_id: by }),
    ev('line.added', { line: burger }, { check_id: id, staff_id: by }),
    ev('lines.sent', { send_id: ulid(), line_ids: [burger.id] }, { check_id: id, staff_id: by }),
    ev('line.added', { line: cola }, { check_id: id, staff_id: by }),
  ]
  const r = replay({}, events, { staffById, settings })
  assert.equal(r.refused.length, 0, JSON.stringify(r.refused))
  return { id, checks: r.checks, burger, cola }
}
const apply = (checks, e, settings) => applyEvent(checks, e, { staffById, settings })

test('the switches: shape, defaults, who may approve', () => {
  assert.deepEqual(MANAGER_ACTION_KEYS, ['delete_unsent', 'void_sent', 'cancel_order', 'refund'])
  assert.deepEqual(normaliseApprovals(), { delete_unsent: false, void_sent: false, cancel_order: false, refund: false })
  assert.deepEqual(normaliseApprovals({ refund: 1, junk: true }), { delete_unsent: false, void_sent: false, cancel_order: false, refund: true })
  const e = (staff_id, approved_by = null) => ({ staff_id, approved_by })
  // Off: never a problem here (the role's own permission is checked elsewhere).
  assert.equal(managerProblem(staffById, e(SERVER), 'void_sent', ALL_OFF), null)
  assert.equal(managerProblem(staffById, e(SERVER), 'void_sent', null), null)
  // On: a manager with the action's permission, themselves or as approver.
  assert.equal(managerProblem(staffById, e(SUPER), 'void_sent', ALL_ON), null)
  assert.equal(managerProblem(staffById, e(SERVER, SUPER), 'void_sent', ALL_ON), null)
  assert.equal(managerProblem(staffById, e(SHIFT_LEAD), 'void_sent', ALL_ON), 'Needs a manager')
  assert.equal(managerProblem(staffById, e(SERVER, SHIFT_LEAD), 'void_sent', ALL_ON), 'The approver isn\'t allowed to do this')
  // Refunds need the refund permission too: Ben approves but can't refund.
  assert.equal(managerProblem(staffById, e(SERVER, SUPER), 'refund', ALL_ON), 'The approver isn\'t allowed to do this')
  assert.equal(managerProblem(staffById, e(SERVER, MANAGER), 'refund', ALL_ON), null)
  // No permission of its own: any manager.
  assert.equal(managerProblem(staffById, e(SERVER, SUPER), 'delete_unsent', ALL_ON), null)
  assert.equal(managerProblem(staffById, e(SERVER), 'cancel_order', ALL_ON), 'Needs a manager')
})

test('taking off unsent items: free while off, a manager once switched on', () => {
  const { id, checks, cola } = setup(ALL_ON)
  // Off: anyone deletes or lowers the quantity.
  assert.ok(apply(checks, ev('line.deleted', { line_id: cola.id }, { check_id: id }), ALL_OFF).ok)
  assert.ok(apply(checks, ev('line.changed', { line_id: cola.id, qty: 1 }, { check_id: id }), ALL_OFF).ok)
  // On: refused without a manager, both ways of taking items off.
  const del = apply(checks, ev('line.deleted', { line_id: cola.id }, { check_id: id }), ALL_ON)
  assert.equal(del.ok, false)
  assert.equal(del.code, 'manager')
  assert.equal(apply(checks, ev('line.changed', { line_id: cola.id, qty: 1 }, { check_id: id }), ALL_ON).code, 'manager')
  // Raising the quantity or moving it to a seat needs nobody.
  assert.ok(apply(checks, ev('line.changed', { line_id: cola.id, qty: 3 }, { check_id: id }), ALL_ON).ok)
  assert.ok(apply(checks, ev('line.changed', { line_id: cola.id, seat: 2 }, { check_id: id }), ALL_ON).ok)
  // With a manager's PIN it goes.
  const ok = apply(checks, ev('line.deleted', { line_id: cola.id }, { check_id: id, approved_by: SUPER }), ALL_ON)
  assert.ok(ok.ok)
  assert.equal(ok.checks[id].lines.length, 1)
  assert.ok(apply(checks, ev('line.changed', { line_id: cola.id, qty: 1 }, { check_id: id, approved_by: SUPER }), ALL_ON).ok)
  // A manager doing it themselves needs nobody else.
  const own = setup(ALL_ON, { by: SUPER })
  assert.ok(apply(own.checks, ev('line.deleted', { line_id: own.cola.id }, { check_id: own.id, staff_id: SUPER }), ALL_ON).ok)
})

test('Make it a combo swaps the dish without a manager', () => {
  const { id, checks, cola } = setup(ALL_ON)
  const meal = line('Burger meal', 1200)
  const added = apply(checks, ev('line.added', { line: meal }, { check_id: id }), ALL_ON)
  assert.ok(added.ok)
  const now = { ...checks, ...added.checks }
  // replaced_by names the combo line, now on the check: a swap, not a removal.
  const swap = apply(now, ev('line.deleted', { line_id: cola.id, replaced_by: meal.id }, { check_id: id }), ALL_ON)
  assert.ok(swap.ok, swap.error)
  // A replaced_by that isn't on the check is a removal like any other.
  assert.equal(apply(now, ev('line.deleted', { line_id: cola.id, replaced_by: ulid() }, { check_id: id }), ALL_ON).code, 'manager')
  // Nor can a line replace itself.
  assert.equal(apply(now, ev('line.deleted', { line_id: cola.id, replaced_by: cola.id }, { check_id: id }), ALL_ON).code, 'invalid')
})

test('voiding sent items: the role decides while off, a manager when on', () => {
  const { id, checks, burger } = setup(ALL_ON)
  const voidBy = (staff_id, approved_by = null) => ev('line.voided', { line_id: burger.id, reason: 'Wrong item' }, { check_id: id, staff_id, approved_by })
  // Off: Dev's role can void, Anna's can't.
  assert.ok(apply(checks, voidBy(SHIFT_LEAD), ALL_OFF).ok)
  assert.equal(apply(checks, voidBy(SERVER), ALL_OFF).code, 'permission')
  // On: Dev can void but isn't a manager, so he needs one now.
  assert.equal(apply(checks, voidBy(SHIFT_LEAD), ALL_ON).code, 'manager')
  assert.ok(apply(checks, voidBy(SHIFT_LEAD, SUPER), ALL_ON).ok)
  assert.ok(apply(checks, voidBy(SUPER), ALL_ON).ok)
  // Only that switch: voids are free of it when just the others are on.
  assert.ok(apply(checks, voidBy(SHIFT_LEAD), { approvals: { delete_unsent: true, cancel_order: true, refund: true } }).ok)
})

test('Cancel order: every item off first, payments off first, a reason, and the switch', () => {
  const { id, checks, burger, cola } = setup(ALL_OFF)
  const cancel = (opts = {}) => ev('check.closed', { cancel_reason: 'Guest left' }, { check_id: id, ...opts })
  // Items still on: refused.
  assert.equal(apply(checks, cancel(), ALL_OFF).code, 'items')
  // Chips voided earlier for another reason: not part of what the cancel takes off.
  const chips = line('Chips', 400)
  const before = replay(checks, [
    ev('line.added', { line: chips }, { check_id: id }),
    ev('lines.sent', { send_id: ulid(), line_ids: [chips.id] }, { check_id: id }),
    ev('line.voided', { line_id: chips.id, reason: 'Wrong item' }, { check_id: id, staff_id: SUPER }),
  ], { staffById, settings: ALL_OFF })
  assert.equal(before.refused.length, 0, JSON.stringify(before.refused))
  // The cancel flag must be true or false.
  assert.equal(apply(before.checks, ev('line.deleted', { line_id: cola.id, cancel: 'yes' }, { check_id: id }), ALL_OFF).code, 'invalid')
  assert.equal(apply(before.checks, ev('line.voided', { line_id: burger.id, reason: 'x', cancel: 1 }, { check_id: id, staff_id: SUPER }), ALL_OFF).code, 'invalid')
  // The till's batch: void what was sent, delete the rest, then cancel.
  const batch = [
    ev('line.voided', { line_id: burger.id, reason: 'Guest left', waste: true, cancel: true }, { check_id: id, staff_id: SUPER }),
    ev('line.deleted', { line_id: cola.id, cancel: true }, { check_id: id, staff_id: SUPER }),
    ev('check.closed', { cancel_reason: '  Guest left ' }, { check_id: id, staff_id: SUPER }),
  ]
  const r = replay(before.checks, batch, { staffById, settings: ALL_OFF })
  assert.equal(r.refused.length, 0, JSON.stringify(r.refused))
  const c = r.checks[id]
  assert.equal(c.status, 'void')
  assert.equal(c.cancelled.reason, 'Guest left')
  assert.equal(c.cancelled.by, SUPER)
  // Worth what it took off: the burger (sent) and the two colas (not sent), not the chips.
  assert.equal(c.cancelled.value, 1000 + 600)
  assert.equal(c.cancelling, undefined)
  assert.equal(c.final.total, 0)
  // The day's report lists it, the burger and chips as voids, no sales.
  const f = dayFigures([c], 'day-1')
  assert.equal(f.cancelled.count, 1)
  assert.equal(f.cancelled.lines[0].reason, 'Guest left')
  assert.equal(f.cancelled.lines[0].value, 1600)
  assert.equal(f.voids.count, 2)
  // A check cancelled before the value was kept: every line left on it.
  const old = { ...c, cancelled: { ...c.cancelled, value: undefined } }
  assert.equal(dayFigures([old], 'day-1').cancelled.lines[0].value, 1400)
  assert.equal(f.counts.void, 1)
  assert.equal(f.sales.total, 0)
  // A reason is needed; a blank one is refused before anything else.
  assert.equal(apply(checks, ev('check.closed', { cancel_reason: '  ' }, { check_id: id }), ALL_OFF).code, 'invalid')
  // Reopening clears the cancel.
  const back = apply(r.checks, ev('check.reopened', { reason: 'Mistake' }, { check_id: id, staff_id: MANAGER }), ALL_OFF)
  assert.ok(back.ok)
  assert.equal(back.checks[id].cancelled, null)
})

test('Cancel order with a payment on it is refused until the payment comes off', () => {
  const { id, checks, burger, cola } = setup(ALL_OFF)
  const pay = ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 500, tendered: 500 } }, { check_id: id })
  const paid = replay(checks, [pay], { staffById, settings: ALL_OFF }).checks
  const clear = replay(paid, [
    ev('line.voided', { line_id: burger.id, reason: 'Guest left' }, { check_id: id, staff_id: SUPER }),
    ev('line.deleted', { line_id: cola.id }, { check_id: id, staff_id: SUPER }),
  ], { staffById, settings: ALL_OFF }).checks
  const refused = apply(clear, ev('check.closed', { cancel_reason: 'Guest left' }, { check_id: id, staff_id: SUPER }), ALL_OFF)
  assert.equal(refused.code, 'paid')
})

test('Cancel order needs a manager when its switch is on, and a kiosk never cancels', () => {
  const { id, checks, burger, cola } = setup(ALL_ON)
  const prep = replay(checks, [
    ev('line.voided', { line_id: burger.id, reason: 'Guest left' }, { check_id: id, staff_id: SUPER }),
    ev('line.deleted', { line_id: cola.id }, { check_id: id, staff_id: SUPER }),
  ], { staffById, settings: ALL_ON })
  assert.equal(prep.refused.length, 0, JSON.stringify(prep.refused))
  assert.equal(apply(prep.checks, ev('check.closed', { cancel_reason: 'Guest left' }, { check_id: id, staff_id: SHIFT_LEAD }), ALL_ON).code, 'manager')
  assert.ok(apply(prep.checks, ev('check.closed', { cancel_reason: 'Guest left' }, { check_id: id, staff_id: SHIFT_LEAD, approved_by: SUPER }), ALL_ON).ok)
  // A kiosk's own order: the kiosk can't cancel it.
  const KIOSK = uuid()
  const people = { ...staffById, [KIOSK]: { id: KIOSK, name: 'Kiosk 1', kiosk: true, permissions: {} } }
  const kid = ulid()
  const opened = applyEvent({}, { ...ev('check.opened', { mode: 'counter' }, { check_id: kid, staff_id: KIOSK }), device_id: KIOSK }, { staffById: people })
  assert.ok(opened.ok, opened.error)
  const k = applyEvent(opened.checks, { ...ev('check.closed', { cancel_reason: 'Guest left' }, { check_id: kid, staff_id: KIOSK }), device_id: KIOSK }, { staffById: people })
  assert.equal(k.code, 'kiosk')
})

test('refunds: the role while off, a manager with the refund permission when on', () => {
  const { id, checks, burger, cola } = setup(ALL_OFF)
  // Pay and close: a burger sent, the cola still to send goes too.
  const closed = replay(checks, [
    ev('lines.sent', { send_id: ulid(), line_ids: [cola.id] }, { check_id: id }),
    ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 1600, tendered: 2000 } }, { check_id: id }),
    ev('check.closed', { print_receipt: false }, { check_id: id }),
  ], { staffById, settings: ALL_OFF })
  assert.equal(closed.refused.length, 0, JSON.stringify(closed.refused))
  assert.equal(closed.checks[id].status, 'closed')
  const refund = (staff_id, approved_by = null) => ev('refund.added', { refund: { id: ulid(), tender: 'cash', amount: 300, reason: 'Cola was flat' } }, { check_id: id, staff_id, approved_by })
  assert.ok(apply(closed.checks, refund(MANAGER), ALL_OFF).ok)
  assert.equal(apply(closed.checks, refund(SERVER, SUPER), ALL_OFF).code, 'permission')
  // On: a refund by someone whose role refunds but who can't approve is refused.
  const people = { ...staffById, [SERVER]: { ...staffById[SERVER], permissions: { refund: true } } }
  assert.ok(applyEvent(closed.checks, refund(SERVER), { staffById: people, settings: ALL_OFF }).ok)
  assert.equal(applyEvent(closed.checks, refund(SERVER), { staffById: people, settings: ALL_ON }).code, 'manager')
  assert.ok(applyEvent(closed.checks, refund(SERVER, MANAGER), { staffById: people, settings: ALL_ON }).ok)
  // print_receipt must be true or false.
  assert.equal(apply(checks, ev('check.closed', { print_receipt: 'yes' }, { check_id: id }), ALL_OFF).code, 'invalid')
})
