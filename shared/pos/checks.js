// shared/pos/checks.js
//
// The check rules. Every change on the till is an event; applyEvent() turns
// events into check state. ONE implementation used by:
//   - the till: applies its own events at once (local first) and refuses
//     what the rules refuse before anything is sent
//   - the sequencer (shared/pos/sequencer.js), run by the cloud now and by
//     the venue hub later: re-checks each event against the current state,
//     numbers it and stores it; an event that no longer applies (made
//     offline, the check changed elsewhere) is refused and listed as a
//     conflict for a manager
//   - replay: a check's state is its events applied in order
//
// An event: { id, venue_id, device_id, staff_id, approved_by, check_id, type,
//             payload, client_at, assigned }
//   id          ULID made on the device (shared/pos/ids.js)
//   approved_by staff id of the person who typed their PIN to allow it
//   assigned    filled in by the sequencer: { day_id }, plus on check.opened the
//               device's code (number_code). The check and order numbers come
//               from the device itself (payload number, order_no; numbers.js)
//
// Pure: no I/O, no clock (times come from the event: client_at).

import { isId } from './ids.js'
import { permissionProblem, managerProblem, MANAGER_ALWAYS } from './permissions.js'
import { checkTotals, isActiveLine, lineGross } from './pricing.js'
import { CHECK_NO_MAX, ORDER_NO_MAX, numberText } from './numbers.js'
import { chargeProblem, onCheck, switchCharges, CHECK_CHARGES_MAX } from './charges.js'
import { discountList, presetMismatch } from './discounts.js'

export const CHECK_EVENTS = [
  'check.opened', 'check.covers_set', 'check.table_moved', 'check.server_changed',
  'check.stream_set', 'check.order_type_set', 'check.tent_set',
  'check.renamed', 'check.note_set', 'check.member_set',
  'line.added', 'line.changed', 'line.deleted', 'lines.sent', 'course.fired', 'line.voided',
  'discount.applied', 'discount.removed', 'promotions.set',
  'charge.added', 'charge.removed', 'charge.restored',
  'lines.moved', 'check.merged', 'bill.printed',
  'payment.added', 'payment.voided', 'check.closed', 'check.reopened', 'refund.added',
]
export const VENUE_EVENTS = ['drawer.opened', 'day.closed']
export const EVENT_TYPES = [...CHECK_EVENTS, ...VENUE_EVENTS]

export const TENDERS = [
  { key: 'cash',          label: 'Cash' },
  { key: 'card_external', label: 'Card' },
  // Taken on a card machine through its provider (migration 193): the
  // payment names its attempt (card_payment_id), checked by the sequencer.
  { key: 'card_integrated', label: 'Card machine' },
  { key: 'voucher',       label: 'Voucher' },
  { key: 'account',       label: 'On account' },
  { key: 'other',         label: 'Other' },
]
export const TENDER_KEYS = TENDERS.map(t => t.key)

export const CHECK_MODES = ['table', 'tab', 'counter']

// Self-order kiosks (shared/kiosk.js, docs/POS.md section 10). A kiosk is in
// staffById under its device id as { kiosk: true }, with no permissions. It
// opens counter orders and works on its own orders only: dishes from the
// menu at their menu price, the offers that apply, sending to the kitchen,
// one card payment and closing. Staff on a till can do anything else to a
// kiosk order (take payment at the counter, add, void, discount ...).
// A kiosk may also put the guest's loyalty card on its order and spend a
// reward the server reserved (shared/loyalty.js), nothing else of discounts.
export const KIOSK_EVENTS = ['check.opened', 'line.added', 'promotions.set', 'lines.sent', 'payment.added', 'check.closed',
  'check.member_set', 'discount.applied']

function kioskProblem(checks, e) {
  if (!KIOSK_EVENTS.includes(e.type)) return 'A kiosk can\'t do this'
  if (e.approved_by) return 'A kiosk can\'t be approved for anything'
  // Only the kiosk itself sends its events (the API names the device).
  if (e.device_id && e.device_id !== e.staff_id) return 'Only the kiosk itself can do this'
  const p = e.payload || {}
  if (e.type === 'check.opened') {
    // No charges on kiosk orders yet (shared/pos/charges.js).
    if (p.mode !== 'counter' || p.table_id || p.from_check_id || (p.charges && p.charges.length) || (p.server_id && p.server_id !== e.staff_id)) {
      return 'A kiosk only opens counter orders'
    }
    return null
  }
  const c = checks[e.check_id]
  if (c && c.opened_by !== e.staff_id) return 'A kiosk only changes its own orders'
  if (e.type === 'check.closed' && p.cancel_reason != null) return 'A kiosk can\'t cancel orders'
  if (e.type === 'line.added' && (!p.line?.item_id || p.line.price_override || p.line.open_item)) return 'A kiosk only adds dishes from the menu'
  if (e.type === 'discount.applied' && !p.discount?.loyalty_redemption_id) return 'A kiosk only takes off loyalty rewards'
  if (e.type === 'payment.added') {
    const x = p.payment || {}
    if (!['card_external', 'card_integrated'].includes(x.tender) || (x.tip || 0) > 0 || x.tendered != null) return 'A kiosk only takes card payments'
  }
  return null
}

// ── Shape checks ───────────────────────────────────────────────

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isRef = v => isUuid(v) || isId(v)
const isPence = v => Number.isInteger(v) && v >= 0 && v <= 100_000_000
const isText = (v, max = 300) => typeof v === 'string' && v.length <= max
const optText = (v, max) => v == null || isText(v, max)
const isQty = v => Number.isInteger(v) && v >= 1 && v <= 999

function lineProblem(l) {
  if (!l || typeof l !== 'object') return 'line missing'
  if (!isId(l.id)) return 'line.id'
  if (l.item_id != null && !isUuid(l.item_id)) return 'line.item_id'
  if (!isText(l.name, 200) || !l.name) return 'line.name'
  if (!isQty(l.qty)) return 'line.qty'
  if (!isPence(l.unit_price)) return 'line.unit_price'
  if (l.modifiers != null && !Array.isArray(l.modifiers)) return 'line.modifiers'
  if (l.combo != null && !Array.isArray(l.combo)) return 'line.combo'
  for (const m of l.modifiers || []) if (!isText(m.label, 120) || !Number.isInteger(m.price)) return 'line.modifier'
  for (const c of l.combo || []) if (!isText(c.name, 200) || !Number.isInteger(c.upcharge ?? 0)) return 'line.combo item'
  if (l.seat != null && !(Number.isInteger(l.seat) && l.seat >= 0 && l.seat <= 99)) return 'line.seat'
  if (l.course_id != null && !isUuid(l.course_id)) return 'line.course_id'
  if (!optText(l.note, 300)) return 'line.note'
  if (l.allergies != null && !(Array.isArray(l.allergies) && l.allergies.every(a => isText(a, 60)))) return 'line.allergies'
  if (typeof l.vat_rate !== 'number' || l.vat_rate < 0 || l.vat_rate > 100) return 'line.vat_rate'
  if (l.revenue_stream_id != null && !isUuid(l.revenue_stream_id)) return 'line.revenue_stream_id'
  if (l.tax_rate_id != null && !isUuid(l.tax_rate_id)) return 'line.tax_rate_id'
  return null
}

// New rates for lines when the order type or stream changes: { [lineId]: { vat_rate, tax_rate_id } }.
function ratesProblem(lines) {
  if (lines == null) return null
  if (typeof lines !== 'object' || Array.isArray(lines)) return 'lines'
  for (const [k, v] of Object.entries(lines)) {
    if (!isId(k) || !v || typeof v !== 'object') return 'lines'
    if (typeof v.vat_rate !== 'number' || v.vat_rate < 0 || v.vat_rate > 100) return 'lines.vat_rate'
    if (v.tax_rate_id != null && !isUuid(v.tax_rate_id)) return 'lines.tax_rate_id'
  }
  return null
}

// A check's charges as an event carries them (check.opened, check.order_type_set).
function chargesProblem(list) {
  if (list == null) return null
  if (!Array.isArray(list) || list.length > CHECK_CHARGES_MAX) return 'charges'
  const ids = new Set()
  for (const x of list) {
    const why = chargeProblem(x)
    if (why) return why
    if (ids.has(x.id)) return 'charges: the same charge twice'
    ids.add(x.id)
  }
  return null
}

/** What is wrong with an event's shape, or null. Doesn't look at state. */
export function eventProblem(e) {
  if (!e || typeof e !== 'object') return 'Not an event'
  if (!isId(e.id)) return 'Bad event id'
  if (!EVENT_TYPES.includes(e.type)) return 'Unknown event type'
  if (!isUuid(e.staff_id)) return 'Missing staff member'
  if (e.approved_by != null && !isUuid(e.approved_by)) return 'Bad approver'
  if (CHECK_EVENTS.includes(e.type) && !isId(e.check_id)) return 'Missing check'
  const p = e.payload || {}
  const bad = what => 'Bad ' + e.type + ': ' + what
  switch (e.type) {
    case 'check.opened':
      if (!CHECK_MODES.includes(p.mode)) return bad('mode')
      if (p.table_id != null && !isUuid(p.table_id)) return bad('table_id')
      if (!optText(p.tab_name, 80)) return bad('tab_name')
      if (p.covers != null && !(Number.isInteger(p.covers) && p.covers >= 0 && p.covers <= 500)) return bad('covers')
      if (p.revenue_stream_id != null && !isUuid(p.revenue_stream_id)) return bad('revenue_stream_id')
      if (p.order_type_id != null && !isUuid(p.order_type_id)) return bad('order_type_id')
      if (!optText(p.tent, 20)) return bad('tent')
      if (p.server_id != null && !isUuid(p.server_id)) return bad('server_id')
      // The device's own numbers (numbers.js).
      if (p.number != null && !(Number.isInteger(p.number) && p.number >= 1 && p.number <= CHECK_NO_MAX)) return bad('number')
      if (p.order_no != null && !(Number.isInteger(p.order_no) && p.order_no >= 1 && p.order_no <= ORDER_NO_MAX)) return bad('order_no')
      if (!optText(p.number_code, 12)) return bad('number_code')
      {
        const why = chargesProblem(p.charges)
        return why ? bad(why) : null
      }
    case 'check.covers_set':
      return Number.isInteger(p.covers) && p.covers >= 0 && p.covers <= 500 ? null : bad('covers')
    case 'check.table_moved':
      if (p.table_id != null && !isUuid(p.table_id)) return bad('table_id')
      return optText(p.tab_name, 80) ? null : bad('tab_name')
    case 'check.server_changed':
      return isUuid(p.server_id) ? null : bad('server_id')
    case 'check.stream_set': {
      if (!isUuid(p.revenue_stream_id)) return bad('revenue_stream_id')
      const r = ratesProblem(p.lines)
      return r ? bad(r) : null
    }
    case 'check.order_type_set': {
      if (!isUuid(p.order_type_id)) return bad('order_type_id')
      if (p.tab_name !== undefined && !optText(p.tab_name, 80)) return bad('tab_name')
      if (p.tent !== undefined && !optText(p.tent, 20)) return bad('tent')
      const r = ratesProblem(p.lines) || chargesProblem(p.charges)
      return r ? bad(r) : null
    }
    case 'check.tent_set':
      return optText(p.tent, 20) ? null : bad('tent')
    case 'check.renamed':
      return optText(p.tab_name, 80) ? null : bad('tab_name')
    case 'check.note_set':
      return optText(p.note, 500) ? null : bad('note')
    case 'check.member_set': {
      // The loyalty member on the check (shared/loyalty.js), or null to take them off.
      const m = p.member
      if (m === null) return null
      if (!m || typeof m !== 'object' || !isUuid(m.id)) return bad('member.id')
      if (!optText(m.no, 20) || !optText(m.name, 120)) return bad('member')
      return null
    }
    case 'line.added': {
      const why = lineProblem(p.line)
      return why ? bad(why) : null
    }
    case 'line.changed':
      if (!isId(p.line_id)) return bad('line_id')
      if (p.qty != null && !isQty(p.qty)) return bad('qty')
      if (p.unit_price != null && !isPence(p.unit_price)) return bad('unit_price')
      if (p.seat !== undefined && p.seat !== null && !(Number.isInteger(p.seat) && p.seat >= 0 && p.seat <= 99)) return bad('seat')
      if (p.course_id != null && !isUuid(p.course_id)) return bad('course_id')
      if (p.note !== undefined && !optText(p.note, 300)) return bad('note')
      if (p.modifiers != null && !Array.isArray(p.modifiers)) return bad('modifiers')
      return null
    case 'line.deleted':
      if (!isId(p.line_id)) return bad('line_id')
      if (p.cancel != null && typeof p.cancel !== 'boolean') return bad('cancel')
      // Made into a combo (the till's Make it a combo): the line that replaced it.
      return p.replaced_by == null || (isId(p.replaced_by) && p.replaced_by !== p.line_id) ? null : bad('replaced_by')
    case 'lines.sent':
      if (!isId(p.send_id)) return bad('send_id')
      if (!Array.isArray(p.line_ids) || !p.line_ids.length || !p.line_ids.every(isId)) return bad('line_ids')
      if (p.held_course_ids != null && !(Array.isArray(p.held_course_ids) && p.held_course_ids.every(isUuid))) return bad('held_course_ids')
      return null
    case 'course.fired':
      return isUuid(p.course_id) ? null : bad('course_id')
    case 'line.voided':
      if (!isId(p.line_id)) return bad('line_id')
      if (p.cancel != null && typeof p.cancel !== 'boolean') return bad('cancel')
      if (p.qty != null && !isQty(p.qty)) return bad('qty')
      if (p.qty != null && !isId(p.new_line_id)) return bad('new_line_id')
      if (!isText(p.reason, 200) || !p.reason.trim()) return bad('reason')
      return null
    case 'discount.applied': {
      const d = p.discount || {}
      if (!isId(d.id)) return bad('discount.id')
      if (!['line', 'check'].includes(d.scope)) return bad('discount.scope')
      if (d.scope === 'line' && !(Array.isArray(d.line_ids) && d.line_ids.length && d.line_ids.every(isId))) return bad('discount.line_ids')
      if (!d.comp && !['percent', 'amount'].includes(d.type)) return bad('discount.type')
      if (!d.comp && d.type === 'percent' && !(typeof d.value === 'number' && d.value > 0 && d.value <= 100)) return bad('discount.value')
      if (!d.comp && d.type === 'amount' && !(isPence(d.value) && d.value > 0)) return bad('discount.value')
      if (!isText(d.name || '', 80)) return bad('discount.name')
      if (!isText(d.reason || '', 200)) return bad('discount.reason')
      if (d.loyalty_redemption_id != null && (!isUuid(d.loyalty_redemption_id) || d.comp)) return bad('discount.loyalty_redemption_id')
      // One of the discounts set up in Store tech (shared/pos/discounts.js).
      if (d.preset_id != null && (!isUuid(d.preset_id) || d.comp || d.loyalty_redemption_id != null)) return bad('discount.preset_id')
      if (d.comp && !(d.reason || '').trim()) return bad('a comp needs a reason')
      return null
    }
    case 'discount.removed':
      return isId(p.discount_id) ? null : bad('discount_id')
    case 'promotions.set':
      if (!Array.isArray(p.promotions)) return bad('promotions')
      for (const x of p.promotions) {
        if (!isUuid(x.promotion_id) || !isText(x.name || '', 120)) return bad('promotion')
        // An automatic combo (shared/combos.js) found among the check's dishes.
        if (x.kind != null && x.kind !== 'combo') return bad('promotion kind')
        if (x.count != null && !(Number.isInteger(x.count) && x.count >= 1 && x.count <= 99)) return bad('promotion count')
        if (typeof x.lines !== 'object' || Object.entries(x.lines || {}).some(([k, v]) => !isId(k) || !isPence(v))) return bad('promotion lines')
      }
      return null
    // Charges (shared/pos/charges.js).
    case 'charge.added': {
      const why = chargeProblem(p.charge)
      return why ? bad(why) : null
    }
    case 'charge.removed':
      if (!isRef(p.charge_id)) return bad('charge_id')
      return isText(p.reason, 200) && p.reason.trim() ? null : bad('reason')
    case 'charge.restored':
      return isRef(p.charge_id) ? null : bad('charge_id')
    case 'lines.moved':
      if (!isId(p.to_check_id) || p.to_check_id === e.check_id) return bad('to_check_id')
      return Array.isArray(p.line_ids) && p.line_ids.length && p.line_ids.every(isId) ? null : bad('line_ids')
    case 'check.merged':
      return isId(p.into_check_id) && p.into_check_id !== e.check_id ? null : bad('into_check_id')
    case 'bill.printed':
      return null
    case 'payment.added': {
      const x = p.payment || {}
      if (!isId(x.id)) return bad('payment.id')
      if (!TENDER_KEYS.includes(x.tender)) return bad('payment.tender')
      if (!isPence(x.amount) || x.amount <= 0) return bad('payment.amount')
      if (x.tip != null && !isPence(x.tip)) return bad('payment.tip')
      if (x.tendered != null && !isPence(x.tendered)) return bad('payment.tendered')
      if (!optText(x.ref, 120) || !optText(x.label, 80)) return bad('payment.ref')
      if ((x.tender === 'card_integrated') !== (x.card_payment_id != null)) return bad('payment.card_payment_id')
      if (x.card_payment_id != null && !isUuid(x.card_payment_id)) return bad('payment.card_payment_id')
      return null
    }
    case 'payment.voided':
      if (!isId(p.payment_id)) return bad('payment_id')
      if (p.card_refund_id != null && !isUuid(p.card_refund_id)) return bad('card_refund_id')
      return isText(p.reason, 200) && p.reason.trim() ? null : bad('reason')
    case 'check.closed':
      if (p.print_receipt != null && typeof p.print_receipt !== 'boolean') return bad('print_receipt')
      // Cancel order: the whole order called off, with why.
      if (p.cancel_reason != null && !(isText(p.cancel_reason, 200) && p.cancel_reason.trim())) return bad('cancel_reason')
      return null
    case 'check.reopened':
      return isText(p.reason, 200) && p.reason.trim() ? null : bad('reason')
    case 'refund.added': {
      const r = p.refund || {}
      if (!isId(r.id)) return bad('refund.id')
      if (!TENDER_KEYS.includes(r.tender)) return bad('refund.tender')
      if (!isPence(r.amount) || r.amount <= 0) return bad('refund.amount')
      if (r.line_ids != null && !(Array.isArray(r.line_ids) && r.line_ids.every(isId))) return bad('refund.line_ids')
      if ((r.tender === 'card_integrated') !== (r.card_refund_id != null)) return bad('refund.card_refund_id')
      if (r.card_refund_id != null && !isUuid(r.card_refund_id)) return bad('refund.card_refund_id')
      return isText(r.reason, 200) && r.reason.trim() ? null : bad('refund.reason')
    }
    case 'drawer.opened':
      return isText(p.reason || '', 200) ? null : bad('reason')
    case 'day.closed':
      if (p.declared_cash != null && !isPence(p.declared_cash)) return bad('declared_cash')
      return optText(p.notes, 500) ? null : bad('notes')
    default:
      return null
  }
}

/** Ids of the checks an event reads or changes. */
export function checksTouched(e) {
  const ids = []
  if (e.check_id) ids.push(e.check_id)
  const p = e.payload || {}
  if (e.type === 'lines.moved' && p.to_check_id) ids.push(p.to_check_id)
  if (e.type === 'check.merged' && p.into_check_id) ids.push(p.into_check_id)
  return [...new Set(ids)]
}

// ── Applying events ────────────────────────────────────────────

const fail = (error, code = 'refused') => ({ ok: false, error, code })
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)))

function newCheck(e) {
  const p = e.payload || {}
  return {
    id: e.check_id,
    venue_id: e.venue_id ?? null,
    // The device numbered it (numbers.js); the sequencer stamps the device's code.
    number: p.number ?? null,
    number_code: e.assigned?.number_code ?? p.number_code ?? null,
    order_no: p.order_no ?? null,
    day_id: e.assigned?.day_id ?? null,
    mode: p.mode,
    table_id: p.table_id ?? null,
    tab_name: p.tab_name ?? null,
    covers: p.covers ?? null,
    server_id: p.server_id || e.staff_id,
    revenue_stream_id: p.revenue_stream_id ?? null,
    order_type_id: p.order_type_id ?? null,
    tent: p.tent || null,
    status: 'open',
    opened_at: e.client_at ?? null,
    opened_by: e.staff_id,
    opened_device_id: e.device_id ?? null,
    closed_at: null,
    closed_by: null,
    note: null,
    lines: [],
    courses: {},
    sends: [],
    discounts: [],
    promotions: [],
    loyalty: null,
    // The order type's charges (shared/pos/charges.js), as the till worked them out.
    charges: (p.charges || []).map(x => onCheck(x)),
    payments: [],
    refunds: [],
    bills: 0,
    billed: false,
    reopened: 0,
    split_from: p.from_check_id || null,
    merged_into: null,
    cancelled: null,
    events: 0,
    updated_at: e.client_at ?? null,
  }
}

const OPEN_ONLY = new Set([
  'check.covers_set', 'check.table_moved', 'check.server_changed', 'check.stream_set',
  'check.order_type_set', 'check.tent_set', 'check.renamed',
  'line.added', 'line.changed', 'line.deleted', 'lines.sent', 'course.fired', 'line.voided',
  'discount.applied', 'discount.removed', 'promotions.set',
  'charge.added', 'charge.removed', 'charge.restored',
  'lines.moved', 'check.merged', 'payment.added', 'payment.voided', 'check.closed',
])

/**
 * Apply one check event.
 *   checks  { [id]: check } with every check in checksTouched(event) that exists
 *   ctx     { staffById, settings } (shared/pos/permissions.js shapes; settings
 *           = the venue's till settings: its approvals switches and its list
 *           of discounts, settings.discounts, shared/pos/discounts.js)
 * Returns { ok: true, checks: { [id]: check } } with only the checks it
 * changed (new objects; the input is never changed), or { ok: false, error, code }.
 */
export function applyEvent(checks, e, ctx = {}) {
  const shape = eventProblem(e)
  if (shape) return fail(shape, 'invalid')
  if (!CHECK_EVENTS.includes(e.type)) return fail('Not a check event', 'invalid')
  const staffById = ctx.staffById || {}
  if (!staffById[e.staff_id]) return fail('Unknown staff member', 'staff')
  if (staffById[e.staff_id].kiosk) {
    const why = kioskProblem(checks, e)
    if (why) return fail(why, 'kiosk')
  }
  const p = e.payload || {}
  const need = (key, amount) => {
    const why = permissionProblem(staffById, e, key, amount)
    return why ? fail(why, 'permission') : null
  }
  // The venue's "needs a manager" switches (settings.approvals, permissions.js).
  const needManager = action => {
    const why = managerProblem(staffById, e, action, ctx.settings || null)
    return why ? fail(why, 'manager') : null
  }

  if (e.type === 'check.opened') {
    if (checks[e.check_id]) return fail('This check already exists', 'duplicate')
    return done({ [e.check_id]: newCheck(e) }, e)
  }

  const current = checks[e.check_id]
  if (!current) return fail('Check not found', 'missing')
  if (current.status === 'merged') return fail('This check was merged into another one', 'closed')
  if (OPEN_ONLY.has(e.type) && current.status !== 'open') return fail('This check is closed', 'closed')
  const c = clone(current)
  const findLine = id => c.lines.find(l => l.id === id)
  // New tax for lines (order type or stream changed). Paid-for lines keep
  // their rate only if the till sent none for them.
  const rerate = rates => {
    for (const [lineId, r] of Object.entries(rates || {})) {
      const l = findLine(lineId)
      if (!l || l.status === 'voided') continue
      l.vat_rate = r.vat_rate
      l.tax_rate_id = r.tax_rate_id ?? null
    }
  }

  switch (e.type) {
    case 'check.covers_set':
      c.covers = p.covers
      break

    case 'check.table_moved':
      c.table_id = p.table_id ?? null
      if (p.tab_name !== undefined) c.tab_name = p.tab_name
      if (c.table_id) c.mode = c.mode === 'counter' ? 'counter' : 'table'
      else if (c.mode === 'table') c.mode = 'tab'
      break

    case 'check.server_changed': {
      if (c.server_id !== e.staff_id) { const no = need('take_over'); if (no) return no }
      if (!staffById[p.server_id]) return fail('Unknown staff member', 'staff')
      c.server_id = p.server_id
      break
    }

    case 'check.stream_set':
      c.revenue_stream_id = p.revenue_stream_id
      for (const l of c.lines) if (l.status !== 'voided') l.revenue_stream_id = p.revenue_stream_id
      rerate(p.lines)
      break

    case 'check.order_type_set':
      c.order_type_id = p.order_type_id
      if (p.tab_name !== undefined) c.tab_name = p.tab_name || null
      if (p.tent !== undefined) c.tent = p.tent || null
      rerate(p.lines)
      // The new type's charges; one taken off stays off (also after a round
      // trip through another type), typed-in ones stay.
      if (p.charges !== undefined) {
        const next = switchCharges(c.charges || [], p.charges || [], c.charges_off)
        c.charges = next.charges
        if (Object.keys(next.off).length) c.charges_off = next.off
        else delete c.charges_off
      }
      c.billed = false
      break

    case 'check.tent_set':
      c.tent = p.tent || null
      break

    case 'check.renamed':
      c.tab_name = p.tab_name ?? null
      break

    case 'check.note_set':
      c.note = p.note ?? null
      break

    case 'check.member_set': {
      // Open or closed: a guest who shows their card after paying still earns.
      if (current.status === 'void') return fail('This check was voided', 'closed')
      const m = p.member
      if (!m && c.discounts.some(d => d.loyalty_redemption_id)) return fail('Take the reward off the check first', 'loyalty')
      if (m && c.loyalty?.member_id && c.loyalty.member_id !== m.id && c.discounts.some(d => d.loyalty_redemption_id)) {
        return fail('Take the reward off the check first', 'loyalty')
      }
      c.loyalty = m ? { member_id: m.id, no: m.no || null, name: (m.name || '').trim() || null, by: e.staff_id, at: e.client_at ?? null } : null
      break
    }

    case 'line.added': {
      if (findLine(p.line.id)) return fail('This item is already on the check', 'duplicate')
      if (p.line.price_override) { const no = need('price_override'); if (no) return no }
      c.lines.push({
        id: p.line.id, item_id: p.line.item_id ?? null, section_id: p.line.section_id ?? null,
        name: p.line.name, kitchen_name: p.line.kitchen_name || null,
        qty: p.line.qty, unit_price: p.line.unit_price,
        modifiers: p.line.modifiers || [], combo: p.line.combo || null,
        seat: p.line.seat ?? null, course_id: p.line.course_id ?? null,
        note: p.line.note || null, allergies: p.line.allergies || [],
        vat_rate: p.line.vat_rate, tax_rate_id: p.line.tax_rate_id ?? null,
        revenue_stream_id: p.line.revenue_stream_id ?? c.revenue_stream_id,
        price_override: !!p.line.price_override, open_item: !!p.line.open_item,
        status: 'new', held: false, send_id: null, sent_at: null,
        added_by: e.staff_id, added_at: e.client_at ?? null, voided: null,
      })
      c.billed = false
      break
    }

    case 'line.changed': {
      const l = findLine(p.line_id)
      if (!l) return fail('Item not found on this check', 'missing')
      if (l.status === 'voided') return fail('This item was voided', 'voided')
      const sentOnly = ['seat']
      const keys = Object.keys(p).filter(k => k !== 'line_id')
      if (l.status !== 'new' && keys.some(k => !sentOnly.includes(k))) {
        return fail('This item was sent to the kitchen: void it instead of changing it', 'sent')
      }
      if (p.price_override || (p.unit_price != null && p.unit_price !== l.unit_price && !p.modifiers)) {
        const no = need('price_override'); if (no) return no
        l.price_override = true
      }
      if (p.qty != null && p.qty < l.qty) { const no = needManager('delete_unsent'); if (no) return no }
      if (p.qty != null) l.qty = p.qty
      if (p.unit_price != null) l.unit_price = p.unit_price
      if (p.modifiers != null) l.modifiers = p.modifiers
      if (p.combo !== undefined) l.combo = p.combo
      if (p.seat !== undefined) l.seat = p.seat
      if (p.course_id !== undefined) l.course_id = p.course_id
      if (p.note !== undefined) l.note = p.note || null
      if (p.allergies !== undefined) l.allergies = p.allergies || []
      c.billed = false
      break
    }

    case 'line.deleted': {
      const l = findLine(p.line_id)
      if (!l) return fail('Item not found on this check', 'missing')
      if (l.status !== 'new') return fail('This item was sent to the kitchen: void it instead', 'sent')
      // Swapped for the combo that replaced it: nothing is taken off the order.
      const swapped = p.replaced_by && c.lines.some(x => x.id === p.replaced_by && x.status === 'new')
      if (!swapped) { const no = needManager('delete_unsent'); if (no) return no }
      // Taken off by Cancel order: what the order was worth when cancelled.
      if (p.cancel) c.cancelling = (c.cancelling || 0) + lineGross(l)
      c.lines = c.lines.filter(x => x.id !== p.line_id)
      c.discounts = c.discounts
        .map(d => (d.scope === 'line' ? { ...d, line_ids: d.line_ids.filter(id => id !== p.line_id) } : d))
        .filter(d => d.scope !== 'line' || d.line_ids.length)
      c.billed = false
      break
    }

    case 'lines.sent': {
      const held = new Set(p.held_course_ids || [])
      let sent = 0
      for (const id of p.line_ids) {
        const l = findLine(id)
        if (!l) return fail('Item not found on this check', 'missing')
        if (l.status !== 'new') continue
        l.status = 'sent'
        l.send_id = p.send_id
        l.sent_at = e.client_at ?? null
        l.held = !!(l.course_id && held.has(l.course_id) && !c.courses[l.course_id]?.fired_at)
        sent++
      }
      if (!sent) return fail('Nothing new to send', 'nothing')
      for (const id of held) {
        if (!c.courses[id]?.fired_at) c.courses[id] = { ...(c.courses[id] || {}), held: true, fired_at: null }
      }
      c.sends.push({ id: p.send_id, at: e.client_at ?? null, by: e.staff_id, line_ids: p.line_ids, held_course_ids: [...held] })
      break
    }

    case 'course.fired': {
      const lines = c.lines.filter(l => l.course_id === p.course_id && l.status === 'sent' && l.held)
      if (!lines.length) return fail('Nothing is waiting in this course', 'nothing')
      for (const l of lines) l.held = false
      c.courses[p.course_id] = { held: false, fired_at: e.client_at ?? null, fired_by: e.staff_id }
      break
    }

    case 'line.voided': {
      const l = findLine(p.line_id)
      if (!l) return fail('Item not found on this check', 'missing')
      if (l.status === 'voided') return fail('This item was already voided', 'voided')
      if (l.status === 'new') return fail('This item hasn\'t been sent: delete it instead', 'not_sent')
      const no = need('void') || needManager('void_sent'); if (no) return no
      const voided = { at: e.client_at ?? null, day_id: e.assigned?.day_id ?? null, by: e.staff_id, approved_by: e.approved_by || null, reason: p.reason.trim(), waste: p.waste !== false }
      if (p.qty != null && p.qty < l.qty) {
        if (findLine(p.new_line_id)) return fail('This item is already on the check', 'duplicate')
        l.qty -= p.qty
        const part = { ...clone(l), id: p.new_line_id, qty: p.qty, status: 'voided', voided }
        c.lines.splice(c.lines.indexOf(l) + 1, 0, part)
        if (p.cancel) c.cancelling = (c.cancelling || 0) + lineGross(part)
      } else {
        if (p.cancel) c.cancelling = (c.cancelling || 0) + lineGross(l)
        l.status = 'voided'
        l.voided = voided
      }
      c.billed = false
      break
    }

    case 'discount.applied': {
      const d = p.discount
      if (c.discounts.some(x => x.id === d.id)) return fail('This discount is already on the check', 'duplicate')
      if (d.scope === 'line') {
        for (const id of d.line_ids) {
          const l = findLine(id)
          if (!l) return fail('Item not found on this check', 'missing')
          if (l.status === 'voided') return fail('This item was voided', 'voided')
        }
      }
      if (d.loyalty_redemption_id) {
        // A reward the member spends: the sequencer checks the reservation
        // (shared/loyalty.js loyaltyProblem); no discount permission needed.
        if (!c.loyalty?.member_id) return fail('Add the member to the check first', 'loyalty')
        if (c.discounts.some(x => x.loyalty_redemption_id === d.loyalty_redemption_id)) return fail('This reward is already on the check', 'duplicate')
      } else if (d.preset_id) {
        // One of the discounts set up in Store tech (shared/pos/discounts.js):
        // its own type, value and scope; a manager only when it says so.
        const preset = discountList(ctx.settings).find(x => x.id === d.preset_id)
        if (!preset) return fail('This discount isn\'t on the till\'s list any more', 'preset')
        const why = presetMismatch(preset, d)
        if (why) return fail(why, 'preset')
        if (preset.needs_manager) { const no = needManager(MANAGER_ALWAYS); if (no) return no }
      } else if (d.comp) {
        const no = need('comp'); if (no) return no
      } else {
        let pct = d.type === 'percent' ? d.value : 100
        if (d.type === 'amount') {
          const t = checkTotals(c)
          const base = d.scope === 'line'
            ? t.lines.filter(x => d.line_ids.includes(x.id)).reduce((s, x) => s + x.net, 0)
            : t.net
          if (base <= 0) return fail('Nothing left to discount', 'nothing')
          pct = Math.min(100, Math.ceil(d.value * 100 / base))
        }
        const no = need('discount', pct); if (no) return no
        // The venue's switch: a discount typed in needs a manager every time.
        const sw = needManager('custom_discount'); if (sw) return sw
      }
      c.discounts.push({
        id: d.id, scope: d.scope, line_ids: d.scope === 'line' ? d.line_ids : [],
        type: d.comp ? 'percent' : d.type, value: d.comp ? 100 : d.value, comp: !!d.comp,
        name: (d.name || (d.comp ? 'Comp' : 'Discount')).trim(), reason: (d.reason || '').trim() || null,
        ...(d.loyalty_redemption_id ? { loyalty_redemption_id: d.loyalty_redemption_id } : {}),
        ...(d.preset_id ? { preset_id: d.preset_id } : {}),
        by: e.staff_id, approved_by: e.approved_by || null, at: e.client_at ?? null, day_id: e.assigned?.day_id ?? null,
      })
      c.billed = false
      break
    }

    case 'discount.removed': {
      if (!c.discounts.some(d => d.id === p.discount_id)) return fail('Discount not found', 'missing')
      c.discounts = c.discounts.filter(d => d.id !== p.discount_id)
      c.billed = false
      break
    }

    case 'promotions.set':
      c.promotions = p.promotions.map(x => ({ promotion_id: x.promotion_id, name: x.name, ...(x.kind === 'combo' ? { kind: 'combo', count: x.count || 1 } : {}), lines: x.lines }))
      break

    case 'charge.added': {
      // A charge typed on the till: always one staff may take off again.
      const list = c.charges || []
      if (list.some(x => x.id === p.charge.id)) return fail('This charge is on the check already', 'duplicate')
      if (list.length >= CHECK_CHARGES_MAX) return fail('This check has as many charges as it can take', 'charges')
      c.charges = [...list, onCheck({ ...p.charge, optional: true, min_covers: 0 }, {
        added: true, added_by: e.staff_id, added_at: e.client_at ?? null,
      })]
      c.billed = false
      break
    }

    case 'charge.removed': {
      const x = (c.charges || []).find(y => y.id === p.charge_id)
      if (!x) return fail('Charge not found', 'missing')
      if (x.removed) return fail('This charge is off the check already', 'duplicate')
      // Optional ones by anyone (unless the venue's switch says a manager);
      // ones that aren't optional by a manager every time.
      const no = needManager(x.optional ? 'remove_charge' : MANAGER_ALWAYS)
      if (no) return no
      c.charges = c.charges.map(y => y.id !== x.id ? y : {
        ...y, removed: true, reason: p.reason.trim(), removed_by: e.staff_id,
        approved_by: e.approved_by || null, removed_at: e.client_at ?? null,
      })
      c.billed = false
      break
    }

    case 'charge.restored': {
      const x = (c.charges || []).find(y => y.id === p.charge_id)
      if (!x) return fail('Charge not found', 'missing')
      if (!x.removed) return fail('This charge is on the check', 'duplicate')
      c.charges = c.charges.map(y => y.id !== x.id ? y : {
        ...y, removed: false, reason: null, removed_by: null, approved_by: null, removed_at: null,
      })
      c.billed = false
      break
    }

    case 'lines.moved': {
      const target = checks[p.to_check_id]
      if (!target) return fail('The other check wasn\'t found', 'missing')
      if (target.status !== 'open') return fail('The other check is closed', 'closed')
      const no = need('transfer'); if (no) return no
      const ids = new Set(p.line_ids)
      const moving = c.lines.filter(l => ids.has(l.id))
      if (moving.length !== ids.size) return fail('Item not found on this check', 'missing')
      const t = clone(target)
      if (moving.some(l => t.lines.some(x => x.id === l.id))) return fail('Already on the other check', 'duplicate')
      c.lines = c.lines.filter(l => !ids.has(l.id))
      t.lines.push(...moving.map(l => ({ ...l, moved_from: c.id })))
      // Line discounts go with their lines.
      const keep = [], carry = []
      for (const d of c.discounts) {
        if (d.scope !== 'line') { keep.push(d); continue }
        const stay = d.line_ids.filter(id => !ids.has(id))
        const go = d.line_ids.filter(id => ids.has(id))
        if (stay.length) keep.push({ ...d, line_ids: stay })
        if (go.length) carry.push({ ...d, id: stay.length ? d.id.slice(0, 20) + go[0].slice(-6) : d.id, line_ids: go })
      }
      c.discounts = keep
      t.discounts = [...t.discounts.filter(d => !carry.some(x => x.id === d.id)), ...carry]
      // Courses carry their fired / held state.
      for (const l of moving) if (l.course_id && c.courses[l.course_id] && !t.courses[l.course_id]) t.courses[l.course_id] = c.courses[l.course_id]
      c.promotions = []
      t.promotions = []
      c.billed = false
      t.billed = false
      t.events = (t.events || 0) + 1
      t.updated_at = e.client_at ?? t.updated_at
      return done({ [c.id]: c, [t.id]: t }, e)
    }

    case 'check.merged': {
      const target = checks[p.into_check_id]
      if (!target) return fail('The other check wasn\'t found', 'missing')
      if (target.status !== 'open') return fail('The other check is closed', 'closed')
      if (c.payments.some(x => !x.voided)) return fail('This check has payments: move its items instead', 'paid')
      const no = need('transfer'); if (no) return no
      const t = clone(target)
      t.lines.push(...c.lines.map(l => ({ ...l, moved_from: c.id })))
      t.discounts.push(...c.discounts.filter(d => d.scope === 'line'))
      for (const [id, s] of Object.entries(c.courses)) if (!t.courses[id]) t.courses[id] = s
      t.covers = (Number(t.covers) || 0) + (Number(c.covers) || 0) || t.covers
      t.promotions = []
      t.billed = false
      t.events = (t.events || 0) + 1
      t.updated_at = e.client_at ?? t.updated_at
      c.lines = []
      c.discounts = []
      c.promotions = []
      c.status = 'merged'
      c.merged_into = t.id
      c.closed_at = e.client_at ?? null
      c.closed_by = e.staff_id
      return done({ [c.id]: c, [t.id]: t }, e)
    }

    case 'bill.printed':
      c.bills = (c.bills || 0) + 1
      if (c.status === 'open') c.billed = true
      break

    case 'payment.added': {
      const x = p.payment
      if (c.payments.some(y => y.id === x.id)) return fail('This payment is already on the check', 'duplicate')
      const t = checkTotals(c)
      if (t.balance <= 0) return fail('Nothing left to pay', 'paid')
      if (x.amount > t.balance) return fail('That is more than is left to pay (' + (t.balance / 100).toFixed(2) + ')', 'overpaid')
      if (x.tendered != null && x.tendered < x.amount) return fail('Less cash given than the amount', 'invalid')
      c.payments.push({
        id: x.id, tender: x.tender, label: x.label || null, amount: x.amount, tip: x.tip || 0,
        tendered: x.tendered ?? null, change: x.tendered != null ? x.tendered - x.amount : 0,
        ref: x.ref || null, seat: x.seat ?? null, card_payment_id: x.card_payment_id || null,
        by: e.staff_id, at: e.client_at ?? null, day_id: e.assigned?.day_id ?? null, voided: false,
      })
      break
    }

    case 'payment.voided': {
      const x = c.payments.find(y => y.id === p.payment_id)
      if (!x) return fail('Payment not found', 'missing')
      if (x.voided) return fail('This payment was already taken off', 'voided')
      // A card machine payment comes off only once its money is back on the card.
      if (x.tender === 'card_integrated' && !p.card_refund_id) return fail('Refund it to the card first', 'card_refund')
      const no = need('void'); if (no) return no
      x.voided = true
      if (p.card_refund_id) x.card_refund_id = p.card_refund_id
      x.void_reason = p.reason.trim()
      x.voided_by = e.staff_id
      x.voided_at = e.client_at ?? null
      break
    }

    case 'check.closed': {
      if (p.cancel_reason != null) {
        // Cancel order: the till voids what was sent and takes the rest off
        // first (in the same batch), so nothing is left on it to pay for.
        if (c.lines.some(isActiveLine)) return fail('Take the items off the order first', 'items')
        if (c.payments.some(x => !x.voided)) return fail('Take the payments off first', 'paid')
        const no = needManager('cancel_order'); if (no) return no
        c.status = 'void'
        c.cancelled = { reason: p.cancel_reason.trim(), value: c.cancelling || 0, by: e.staff_id, approved_by: e.approved_by || null, at: e.client_at ?? null, day_id: e.assigned?.day_id ?? null }
        delete c.cancelling
        c.closed_at = e.client_at ?? null
        c.closed_by = e.staff_id
        c.billed = false
        c.final = summary(c)
        break
      }
      const t = checkTotals(c)
      const empty = !c.lines.some(isActiveLine) && !c.payments.some(x => !x.voided)
      if (!empty && t.balance !== 0) {
        return fail(t.balance > 0 ? 'There is still ' + (t.balance / 100).toFixed(2) + ' to pay' : 'More was paid than the total: take a payment off first', 'balance')
      }
      c.status = empty && !c.lines.length ? 'void' : 'closed'
      c.closed_at = e.client_at ?? null
      c.closed_by = e.staff_id
      c.billed = false
      c.final = summary(c)
      break
    }

    case 'check.reopened': {
      if (current.status === 'open') return fail('This check is already open', 'open')
      const no = need('reopen'); if (no) return no
      c.status = 'open'
      c.closed_at = null
      c.closed_by = null
      c.reopened = (c.reopened || 0) + 1
      c.final = null
      c.cancelled = null
      delete c.cancelling
      break
    }

    case 'refund.added': {
      if (current.status !== 'closed') return fail('Refunds are made on a closed check', 'open')
      const no = need('refund') || needManager('refund'); if (no) return no
      const r = p.refund
      if (c.refunds.some(y => y.id === r.id)) return fail('This refund is already on the check', 'duplicate')
      const t = checkTotals(c)
      if (r.amount > t.paid - t.refunded) return fail('That is more than was paid', 'invalid')
      c.refunds.push({
        id: r.id, tender: r.tender, amount: r.amount, reason: r.reason.trim(), line_ids: r.line_ids || [],
        card_refund_id: r.card_refund_id || null,
        by: e.staff_id, approved_by: e.approved_by || null, at: e.client_at ?? null, day_id: e.assigned?.day_id ?? null,
      })
      c.final = summary(c)
      break
    }

    default:
      return fail('Not handled: ' + e.type, 'invalid')
  }
  return done({ [c.id]: c }, e)
}

function done(changed, e) {
  for (const c of Object.values(changed)) {
    if (c.id === e.check_id) {
      c.events = (c.events || 0) + 1
      c.updated_at = e.client_at ?? c.updated_at
      c.last_event_id = e.id
    }
  }
  return { ok: true, checks: changed }
}

/** The figures stored with a closed check (reports read these). */
export function summary(c) {
  const t = checkTotals(c)
  return {
    subtotal: t.subtotal, discount: t.discount, service_charge: t.service_charge, total: t.total,
    vat: t.vat_total, paid: t.paid, tips: t.tips, refunded: t.refunded, items: t.items,
  }
}

/** Apply a list of events in order; refused ones are returned, the rest applied. */
export function replay(checks, events, ctx) {
  let state = { ...checks }
  const refused = []
  for (const e of events) {
    const r = applyEvent(state, e, ctx)
    if (r.ok) state = { ...state, ...r.checks }
    else refused.push({ event: e, error: r.error, code: r.code })
  }
  return { checks: state, refused }
}

// ── For the till ───────────────────────────────────────────────

/** Lines added but not sent yet. */
export const unsentLines = c => (c?.lines || []).filter(l => l.status === 'new')

/** Courses on a check with items waiting to be fired. */
export function heldCourses(c) {
  const ids = new Set((c?.lines || []).filter(l => l.status === 'sent' && l.held && l.course_id).map(l => l.course_id))
  return [...ids]
}

/** Display number: a counter order's number (#112), else the check's (T2-47). */
export function checkLabel(c) {
  if (!c) return ''
  if (c.order_no != null) return '#' + c.order_no
  return numberText(c) || '…'
}

export { lineGross }
