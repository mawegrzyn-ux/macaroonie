// POS core tests: pricing, the check rules, print routing, the sequencer
// (with an in-memory store, as the hub's SQLite store will be) and reports.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid, isId } from '../ids.js'
import { priceItem, checkTotals, spread, lineGross, promoLines, posChoices } from '../pricing.js'
import { optionPriceText, fromPrice, priceVaries, isPriced } from '../../orderPricing.js'
import { applyEvent, replay, checkLabel } from '../checks.js'
import { jobsForEvent, receiptHere } from '../printing.js'
import { createSequencer } from '../sequencer.js'
import { dayFigures, businessDate } from '../reports.js'
import { toText } from '../tickets.js'

const uuid = () => globalThis.crypto.randomUUID()

// ── Fixture ─────────────────────────────────────────────────────
const VENUE = uuid()
const SERVER = uuid(), SUPER = uuid(), MANAGER = uuid()
const staffById = {
  [SERVER]:  { id: SERVER,  name: 'Anna', permissions: { discount_max_pct: 0, transfer: true } },
  [SUPER]:   { id: SUPER,   name: 'Ben',  permissions: { void: true, comp: true, discount_max_pct: 25, manager: true, transfer: true, reopen: true, take_over: true } },
  [MANAGER]: { id: MANAGER, name: 'Cara', permissions: { void: true, refund: true, comp: true, discount_max_pct: 100, manager: true, close_day: true, reopen: true, open_drawer: true, transfer: true } },
}
const STARTERS = uuid(), MAINS = uuid(), DRINKS_SECTION = uuid(), FOOD_SECTION = uuid()
const KITCHEN = uuid(), BAR = uuid(), RECEIPT = uuid()
const RC_REST = uuid(), RC_TAKEAWAY = uuid()
const TABLE5 = uuid()
const PROTEIN = uuid(), TOPPINGS = uuid(), COOKING = uuid()
const CHICKEN = uuid(), PRAWN = uuid(), EGG = uuid(), ONION = uuid(), RARE = uuid(), WELL = uuid()
const groupsById = {
  [PROTEIN]:  { id: PROTEIN, name: 'Protein', price_mode: 'base', min_select: 1, max_select: 1, options: [{ id: CHICKEN, label: 'Chicken', price_pence: 1250 }, { id: PRAWN, label: 'Prawns', price_pence: 1395, child_group_id: null }] },
  [TOPPINGS]: { id: TOPPINGS, name: 'Toppings', price_mode: 'extra', min_select: 0, max_select: 2, pos_prefixes: true, options: [{ id: EGG, label: 'Egg', price_pence: 100 }, { id: ONION, label: 'Onion', price_pence: 50 }] },
  [COOKING]:  { id: COOKING, name: 'Cooking', price_mode: 'base', min_select: 1, max_select: 1, options: [{ id: RARE, label: 'Rare', price_pence: 0 }, { id: WELL, label: 'Well done', price_pence: 0 }] },
}
const PAD_THAI = { id: uuid(), name: 'Pad Thai', section_id: FOOD_SECTION, price_pence: null,
  variant_groups: [
    { group_id: PROTEIN, name: 'Protein', price_mode: 'base', min_select: 1, max_select: 1, options: [{ option_id: CHICKEN, label: 'Chicken', price_pence: 1250 }, { option_id: PRAWN, label: 'Prawns', price_pence: 1395 }] },
    { group_id: TOPPINGS, name: 'Toppings', price_mode: 'extra', min_select: 0, max_select: 2, options: [{ option_id: EGG, label: 'Egg', price_pence: 100 }, { option_id: ONION, label: 'Onion', price_pence: 50 }] },
  ] }
// Steak: choosing it opens the Cooking group (nested).
const STEAK_GROUP = uuid(), STEAK_OPT = uuid()
groupsById[STEAK_GROUP] = { id: STEAK_GROUP, name: 'Add', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ id: STEAK_OPT, label: 'Steak', price_pence: 500, child_group_id: COOKING }] }
const SALAD = { id: uuid(), name: 'Salad', section_id: FOOD_SECTION, price_pence: 800, variant_groups: [
  { group_id: STEAK_GROUP, name: 'Add', price_mode: 'extra', min_select: 0, max_select: 1, options: [{ option_id: STEAK_OPT, label: 'Steak', price_pence: 500 }] },
] }
const COLA = { id: uuid(), name: 'Cola', section_id: DRINKS_SECTION, price_pence: 300, variant_groups: [] }
const BURGER = { id: uuid(), name: 'Burger', section_id: FOOD_SECTION, price_pence: 1000, variant_groups: [] }
const MAIN_OPT = uuid(), COLA_OPT = uuid()
const DEAL = { id: uuid(), name: 'Burger meal', kind: 'combo', section_id: FOOD_SECTION, price_pence: 1200, variant_groups: [],
  combo: { mode: 'manual', steps: [
    { id: uuid(), name: 'Main', min: 1, max: 1, auto: false, options: [{ id: MAIN_OPT, type: 'item', item_id: BURGER.id, price_pence: 0 }] },
    { id: uuid(), name: 'Drink', min: 1, max: 1, auto: false, options: [{ id: COLA_OPT, type: 'item', item_id: COLA.id, price_pence: 50 }] },
  ] } }
const mealPicks = (main, drink) => ({ combo: { [main.id]: [{ option_id: MAIN_OPT, item_id: BURGER.id }], [drink.id]: [{ option_id: COLA_OPT, item_id: COLA.id }] } })
const itemsById = Object.fromEntries([PAD_THAI, SALAD, COLA, BURGER, DEAL].map(i => [i.id, i]))

const print = {
  printers: { [KITCHEN]: { id: KITCHEN, name: 'Kitchen' }, [BAR]: { id: BAR, name: 'Bar' }, [RECEIPT]: { id: RECEIPT, name: 'Till' } },
  tables: { [TABLE5]: { label: '5' } },
  staff: Object.fromEntries(Object.values(staffById).map(s => [s.id, { name: s.name }])),
  courses: { [STARTERS]: { name: 'Starters', sort_order: 1 }, [MAINS]: { name: 'Mains', sort_order: 2 } },
  settings: { vat_number: 'GB 123', receipt_footer: 'Thanks' },
  venue: { name: 'One Thai' },
  devices: {},
}

let clock = Date.parse('2026-10-11T18:00:00Z')
function ev(type, payload, { check_id = null, staff_id = SERVER, approved_by = null, device_id = 'T1' } = {}) {
  clock += 1000
  return { id: ulid(clock), venue_id: VENUE, device_id, staff_id, approved_by, check_id, type, payload, client_at: new Date(clock).toISOString() }
}
function line(item, selection = {}, extra = {}) {
  const priced = priceItem(item, selection, { itemsById, groupsById })
  assert.ok(priced.ok, priced.error)
  return {
    id: ulid(), item_id: item.id, section_id: item.section_id, name: item.name, qty: 1,
    unit_price: priced.unit_price, modifiers: priced.modifiers, combo: priced.combo, vat_rate: 20, ...extra,
  }
}

// ── Pricing ─────────────────────────────────────────────────────

test('ids: ULIDs, ordered', () => {
  const a = ulid(1000), b = ulid(1000), c = ulid(2000)
  assert.ok(isId(a) && isId(b) && isId(c))
  assert.ok(a < b && b < c)
})

test('spread: whole pence that add up', () => {
  assert.deepEqual(spread(100, [1, 1, 1]), [34, 33, 33])
  assert.equal(spread(1000, [300, 700, 0]).reduce((s, x) => s + x, 0), 1000)
  assert.deepEqual(spread(50, [0, 0]), [0, 0])
})

test('priceItem: base option sets the price, extras add, No is free, nested groups', () => {
  const r = priceItem(PAD_THAI, { choices: { [PROTEIN]: [PRAWN], [TOPPINGS]: [{ id: EGG, prefix: 'extra' }, { id: ONION, prefix: 'no' }] } }, { itemsById, groupsById })
  assert.ok(r.ok)
  assert.equal(r.unit_price, 1395)
  assert.equal(lineGross({ ...r, qty: 2 }), (1395 + 100) * 2)
  assert.equal(r.modifiers.find(m => m.option_id === ONION).price, 0)
  assert.equal(priceItem(PAD_THAI, { choices: {} }, { itemsById, groupsById }).error, 'Choose protein')
  // "No" doesn't count toward the limit of 2.
  assert.ok(priceItem(PAD_THAI, { choices: { [PROTEIN]: [CHICKEN], [TOPPINGS]: [{ id: EGG }, { id: ONION }] } }, { itemsById, groupsById }).ok)

  const steak = priceItem(SALAD, { choices: { [STEAK_GROUP]: [{ id: STEAK_OPT, children: { [COOKING]: [RARE] } }] } }, { itemsById, groupsById })
  assert.ok(steak.ok, steak.error)
  assert.equal(lineGross({ ...steak, qty: 1 }), 1300)
  assert.deepEqual(steak.modifiers.map(m => [m.label, m.depth]), [['Steak', 0], ['Rare', 1]])
  assert.match(priceItem(SALAD, { choices: { [STEAK_GROUP]: [STEAK_OPT] } }, { itemsById, groupsById }).error, /cooking/)
})

test('posChoices: a kiosk dish follows its menu\'s option settings (Hide unpriced, Hide £0); the till shows every option', () => {
  const NOODLES = uuid(), RICE = uuid(), SAUCE = uuid()
  const dish = { id: uuid(), name: 'Curry', section_id: FOOD_SECTION, price_pence: 900,
    variants: [{ label: 'Small', price_pence: 0 }, { label: 'Large', price_pence: 200 }],
    variant_groups: [{ group_id: PROTEIN, name: 'Base', price_mode: 'base', min_select: 1, max_select: 1,
      options: [{ option_id: NOODLES, label: 'Noodles', price_pence: 0 }, { option_id: RICE, label: 'Rice', price_pence: null }, { option_id: SAUCE, label: 'Sauce pot', price_pence: 50 }] }] }
  const money = p => '£' + (p / 100).toFixed(2)
  const labels = choices => choices.map(c => c.options.map(o => o.label))
  // The till: everything. A base option at £0 is the dish's own price, so it shows no price.
  const till = posChoices(dish, groupsById)
  assert.deepEqual(labels(till), [['Small', 'Large'], ['Noodles', 'Rice', 'Sauce pot']])
  assert.equal(optionPriceText(till[1], till[1].options[0], money), '')
  // Hide £0 options: kept, without a price.
  const zero = posChoices({ ...dish, variant_rules: { hideZeroPrice: true } }, groupsById)
  assert.deepEqual(labels(zero), labels(till))
  assert.equal(optionPriceText(zero[1], zero[1].options[0], money), '')
  assert.equal(optionPriceText(zero[1], zero[1].options[2], money), '£0.50')
  // Hide unpriced options: left out, so they can't be picked either.
  const unpriced = { ...dish, variant_rules: { hideUnpriced: true } }
  assert.deepEqual(labels(posChoices(unpriced, groupsById)), [['Large'], ['Sauce pot']])
  assert.match(priceItem(unpriced, { choices: { variants: ['v:Small'] } }, { groupsById }).error || '', /no longer available|Choose/)
})

test('priceItem: base options at £0 or empty keep the dish price (a flavour group must not make it free)', () => {
  const A1 = uuid(), A2 = uuid(), FLAV = uuid()
  const groups = { [FLAV]: { id: FLAV, name: 'Flavour', price_mode: 'base', min_select: 1, max_select: 2, allow_repeat: true,
    options: [{ option_id: A1, label: 'Atomic', price_pence: 0 }, { option_id: A2, label: 'Mango', price_pence: null }] } }
  const wings = { id: uuid(), name: '12 Wings', section_id: FOOD_SECTION, price_pence: 1299,
    variant_groups: [{ group_id: FLAV, name: 'Flavour', price_mode: 'base', min_select: 1, max_select: 2, allow_repeat: true,
      options: [{ option_id: A1, label: 'Atomic', price_pence: 0 }, { option_id: A2, label: 'Mango', price_pence: null }] }] }
  const r = priceItem(wings, { choices: { [FLAV]: [A1, A2] } }, { groupsById: groups })
  assert.ok(r.ok, r.error)
  assert.equal(lineGross({ ...r, qty: 1 }), 1299)
  assert.equal(fromPrice(wings, posChoices(wings, groups)), 1299)
  assert.equal(priceVaries(wings, posChoices(wings, groups)), false, 'no "from"')
  // A priced base option still sets the price.
  const sized = { ...wings, variant_groups: [{ ...wings.variant_groups[0], options: [{ option_id: A1, label: 'Small', price_pence: 0 }, { option_id: A2, label: 'Large', price_pence: 1599 }] }] }
  assert.equal(priceItem(sized, { choices: { [FLAV]: [A2] } }, { groupsById: groups }).unit_price, 1599)
  assert.equal(priceItem(sized, { choices: { [FLAV]: [A1] } }, { groupsById: groups }).unit_price, 1299)
  assert.equal(fromPrice(sized, posChoices(sized, groups)), 1299)
  assert.equal(priceVaries(sized, posChoices(sized, groups)), true)
  // No dish price and only £0 base options: no price at all (left off the kiosk).
  assert.equal(isPriced({ ...wings, price_pence: null }, posChoices({ ...wings, price_pence: null }, groups)), false)
  assert.equal(priceItem({ ...wings, price_pence: null }, { choices: { [FLAV]: [A1] } }, { groupsById: groups }).ok, false)
})

test('priceItem: meal deal with upcharge', () => {
  const [main, drink] = DEAL.combo.steps
  const r = priceItem(DEAL, mealPicks(main, drink), { itemsById, groupsById })
  assert.ok(r.ok, r.error)
  assert.equal(lineGross({ ...r, qty: 1 }), 1250)
  assert.match(priceItem(DEAL, { combo: { [main.id]: [{ option_id: MAIN_OPT, item_id: BURGER.id }] } }, { itemsById, groupsById }).error, /drink/)
})

// ── Check rules ─────────────────────────────────────────────────

const SERVICE_12 = { id: '0b6f2d1e-4c1a-4a54-9e57-3a0c7f6e2b11', name: 'Service charge', kind: 'percent', value: 12.5, optional: true, min_covers: 0, vat_rate: 0, tax_rate_id: null }
function open(extra = {}) {
  const id = ulid()
  const r = applyEvent({}, ev('check.opened', { mode: 'table', table_id: TABLE5, covers: 2, revenue_stream_id: RC_REST, charges: [SERVICE_12], ...extra }, { check_id: id }), { staffById })
  assert.ok(r.ok, r.error)
  return r.checks[id]
}
function apply(check, type, payload, opts = {}) {
  const r = applyEvent({ [check.id]: check, ...(opts.others || {}) }, ev(type, payload, { check_id: check.id, ...opts }), { staffById })
  return r
}
const ok = r => { assert.ok(r.ok, r.error); return r }

test('totals: discounts, comps, service charge, VAT', () => {
  let c = open()
  const a = line(PAD_THAI, { choices: { [PROTEIN]: [CHICKEN] } })           // 1250
  const b = line(COLA, {}, { qty: 2, vat_rate: 20 })                          // 600
  c = ok(apply(c, 'line.added', { line: a })).checks[c.id]
  c = ok(apply(c, 'line.added', { line: b })).checks[c.id]
  let t = checkTotals(c)
  assert.equal(t.subtotal, 1850)
  assert.equal(t.service_charge, Math.round(1850 * 0.125))
  // Comp the colas (supervisor), then 10% off the check.
  assert.equal(apply(c, 'discount.applied', { discount: { id: ulid(), scope: 'line', line_ids: [b.id], comp: true, reason: 'Spilt' } }).code, 'permission')
  c = ok(apply(c, 'discount.applied', { discount: { id: ulid(), scope: 'line', line_ids: [b.id], comp: true, reason: 'Spilt' } }, { approved_by: SUPER })).checks[c.id]
  c = ok(apply(c, 'discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 10, name: 'Regular' } }, { staff_id: SUPER })).checks[c.id]
  t = checkTotals(c)
  assert.equal(t.discount, 600 + 125)
  assert.equal(t.net, 1125)
  assert.equal(t.service_charge, Math.round(1125 * 0.125))
  assert.equal(t.total, 1125 + 141)
  assert.equal(t.vat_total, Math.round(1125 * 20 / 120))
  // A supervisor may give up to 25%; 30% needs the manager.
  assert.equal(apply(c, 'discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 30 } }, { staff_id: SUPER }).code, 'permission')
  // An amount discount counts as the % of what is left: £5 of £11.25 = 45%.
  assert.equal(apply(c, 'discount.applied', { discount: { id: ulid(), scope: 'check', type: 'amount', value: 500 } }, { staff_id: SUPER }).code, 'permission')
  ok(apply(c, 'discount.applied', { discount: { id: ulid(), scope: 'check', type: 'amount', value: 200 } }, { staff_id: SUPER }))
})

test('send, hold and fire courses; delete before send, void after', () => {
  let c = open()
  const s = line(SALAD, {}, { course_id: STARTERS })
  const m = line(PAD_THAI, { choices: { [PROTEIN]: [CHICKEN] } }, { course_id: MAINS })
  const d = line(COLA, {}, { course_id: null })
  for (const l of [s, m, d]) c = ok(apply(c, 'line.added', { line: l })).checks[c.id]
  const x = line(COLA)
  c = ok(apply(c, 'line.added', { line: x })).checks[c.id]
  c = ok(apply(c, 'line.deleted', { line_id: x.id })).checks[c.id]
  assert.equal(c.lines.length, 3)

  c = ok(apply(c, 'lines.sent', { send_id: ulid(), line_ids: [s.id, m.id, d.id], held_course_ids: [MAINS] })).checks[c.id]
  assert.deepEqual(c.lines.map(l => [l.status, l.held]), [['sent', false], ['sent', true], ['sent', false]])
  assert.equal(apply(c, 'line.deleted', { line_id: s.id }).code, 'sent')
  assert.equal(apply(c, 'line.changed', { line_id: s.id, qty: 2 }).code, 'sent')
  ok(apply(c, 'line.changed', { line_id: s.id, seat: 2 }))
  c = ok(apply(c, 'course.fired', { course_id: MAINS })).checks[c.id]
  assert.equal(c.lines[1].held, false)
  assert.equal(apply(c, 'course.fired', { course_id: MAINS }).code, 'nothing')

  // Void: the server needs a manager; partial void splits the line.
  c = ok(apply(c, 'line.changed', { line_id: d.id, seat: 1 })).checks[c.id]
  assert.equal(apply(c, 'line.voided', { line_id: m.id, reason: 'Wrong' }).error, 'Needs a manager')
  assert.equal(apply(c, 'line.voided', { line_id: m.id, reason: 'Wrong' }, { approved_by: SERVER }).code, 'permission')
  c = ok(apply(c, 'line.voided', { line_id: m.id, reason: 'Wrong dish', waste: true }, { approved_by: SUPER })).checks[c.id]
  assert.equal(c.lines[1].status, 'voided')
  assert.equal(c.lines[1].voided.approved_by, SUPER)
  assert.equal(checkTotals(c).subtotal, 800 + 300)
})

test('payments: no overpaying, cash change, close only when paid, reopen and refund need rights', () => {
  let c = open({ charges: [] })
  const a = line(PAD_THAI, { choices: { [PROTEIN]: [CHICKEN] } })
  c = ok(apply(c, 'line.added', { line: a })).checks[c.id]
  assert.equal(apply(c, 'payment.added', { payment: { id: ulid(), tender: 'card_external', amount: 2000 } }).code, 'overpaid')
  c = ok(apply(c, 'payment.added', { payment: { id: ulid(), tender: 'card_external', amount: 500, tip: 100 } })).checks[c.id]
  assert.equal(apply(c, 'check.closed', {}).code, 'balance')
  c = ok(apply(c, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: 750, tendered: 1000 } })).checks[c.id]
  assert.equal(c.payments[1].change, 250)
  c = ok(apply(c, 'check.closed', {})).checks[c.id]
  assert.equal(c.status, 'closed')
  assert.deepEqual([c.final.total, c.final.paid, c.final.tips], [1250, 1250, 100])
  assert.equal(apply(c, 'line.added', { line: line(COLA) }).code, 'closed')
  assert.equal(apply(c, 'check.reopened', { reason: 'Forgot drink' }).code, 'permission')
  assert.equal(apply(c, 'refund.added', { refund: { id: ulid(), tender: 'cash', amount: 300, reason: 'Cold' } }, { approved_by: SUPER }).code, 'permission')
  c = ok(apply(c, 'refund.added', { refund: { id: ulid(), tender: 'cash', amount: 300, reason: 'Cold' } }, { approved_by: MANAGER })).checks[c.id]
  assert.equal(c.final.refunded, 300)
  assert.equal(apply(c, 'refund.added', { refund: { id: ulid(), tender: 'cash', amount: 1000, reason: 'x' } }, { staff_id: MANAGER }).code, 'invalid')
  c = ok(apply(c, 'check.reopened', { reason: 'Forgot drink' }, { staff_id: SUPER })).checks[c.id]
  assert.equal(c.status, 'open')
})

test('move items, merge checks, empty check closes as void', () => {
  let a = open(), b = open({ table_id: null, mode: 'tab', tab_name: 'Smith' })
  const x = line(PAD_THAI, { choices: { [PROTEIN]: [CHICKEN] } }), y = line(COLA)
  a = ok(apply(a, 'line.added', { line: x })).checks[a.id]
  a = ok(apply(a, 'line.added', { line: y })).checks[a.id]
  a = ok(apply(a, 'discount.applied', { discount: { id: ulid(), scope: 'line', line_ids: [x.id, y.id], comp: true, reason: 'Birthday' } }, { staff_id: SUPER })).checks[a.id]
  const moved = ok(apply(a, 'lines.moved', { to_check_id: b.id, line_ids: [y.id] }, { others: { [b.id]: b } })).checks
  a = moved[a.id]; b = moved[b.id]
  assert.deepEqual(a.lines.map(l => l.id), [x.id])
  assert.deepEqual(b.lines.map(l => l.id), [y.id])
  // The comp went with the drink and stayed on the dish.
  assert.equal(checkTotals(a).net, 0)
  assert.equal(checkTotals(b).net, 0)
  assert.notEqual(a.discounts[0].id, b.discounts[0].id)

  const merged = ok(apply(b, 'check.merged', { into_check_id: a.id }, { others: { [a.id]: a } })).checks
  assert.equal(merged[b.id].status, 'merged')
  assert.equal(merged[a.id].lines.length, 2)
  assert.equal(merged[a.id].covers, 4)

  let e = open()
  e = ok(apply(e, 'check.closed', {})).checks[e.id]
  assert.equal(e.status, 'void')
})

test('promotions set by the till come off before check discounts', () => {
  let c = open({ charges: [] })
  const a = line(BURGER), b = line(COLA)
  c = ok(apply(c, 'line.added', { line: a })).checks[c.id]
  c = ok(apply(c, 'line.added', { line: b })).checks[c.id]
  assert.deepEqual(promoLines(c).map(l => l.line_total_pence), [1000, 300])
  c = ok(apply(c, 'promotions.set', { promotions: [{ promotion_id: uuid(), name: 'Free drink', lines: { [b.id]: 300 } }] })).checks[c.id]
  c = ok(apply(c, 'discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 10 } }, { staff_id: SUPER })).checks[c.id]
  const t = checkTotals(c)
  assert.equal(t.promotions, 300)
  assert.equal(t.net, 900)
})

// ── Printing ────────────────────────────────────────────────────

test('jobs: bills and receipts go to the till\'s receipt printer, unless it is plugged into the till itself', () => {
  let c = open()
  c = ok(apply(c, 'line.added', { line: line(COLA) })).checks[c.id]
  const bill = ev('bill.printed', {}, { check_id: c.id })
  const r = ok(applyEvent({ [c.id]: c }, bill, { staffById }))
  // Through the queue: a network printer (the hub) or one on another device.
  const queued = { ...print, devices: { T1: { receipt_printer_id: RECEIPT } } }
  const jobs = jobsForEvent(bill, { [c.id]: c }, r.checks, queued)
  assert.deepEqual(jobs.map(j => [j.printer_id, j.kind]), [[RECEIPT, 'bill']])
  assert.match(toText(jobs[0].ops), /1 Cola +£3\.00/)
  assert.equal(receiptHere(queued, 'T1'), false)
  const other = { ...queued, printers: { ...print.printers, [RECEIPT]: { id: RECEIPT, name: 'Till', connection: 'device', device_id: 'T2' } } }
  assert.equal(jobsForEvent(bill, { [c.id]: c }, r.checks, other).length, 1)
  // Plugged into this till: it prints there and then, no job.
  const here = { ...queued, printers: { ...print.printers, [RECEIPT]: { id: RECEIPT, name: 'Till', connection: 'device', device_id: 'T1' } } }
  assert.deepEqual(jobsForEvent(bill, { [c.id]: c }, r.checks, here), [])
  assert.equal(receiptHere(here, 'T1'), true)
  // No receipt printer: the till prints in its browser.
  assert.deepEqual(jobsForEvent(bill, { [c.id]: c }, r.checks, print), [])
  assert.equal(receiptHere(print, 'T1'), true)
  // Kitchen tickets never come from here any more (kitchen printers are in the flow).
  const send = ev('lines.sent', { send_id: ulid(), line_ids: r.checks[c.id].lines.map(l => l.id) }, { check_id: c.id })
  const sent = ok(applyEvent(r.checks, send, { staffById }))
  assert.deepEqual(jobsForEvent(send, r.checks, sent.checks, queued), [])
})

// ── Sequencer ───────────────────────────────────────────────────

function memoryStore({ timezone = 'Europe/London', settings = {} } = {}) {
  const s = {
    events: new Map(), rejections: new Map(), checks: new Map(), jobs: [], days: [],
    state: { last_seq: 0, numbers: {}, day: null },
  }
  let queue = Promise.resolve()
  return {
    data: s,
    run: (_venue, fn) => (queue = queue.then(fn, fn)),
    findEvent: id => s.events.get(id) || null,
    findRejection: id => s.rejections.get(id) || null,
    context: () => ({
      staffById, print: { ...print, devices: { T1: { receipt_printer_id: RECEIPT } } }, timezone, settings,
      devices: { T1: { short_code: 'T1', kind: 'terminal' }, T2: { short_code: 'T2', kind: 'terminal' } },
    }),
    venueState: () => ({ ...s.state }),
    openDay: ({ business_date }) => {
      const day = { id: uuid(), business_date, number: s.days.length + 1 }
      s.days.push(day)
      s.state.day = day
      return day
    },
    loadChecks: ids => Object.fromEntries(ids.filter(id => s.checks.has(id)).map(id => [id, s.checks.get(id)])),
    openCheckCount: dayId => [...s.checks.values()].filter(c => c.status === 'open' && c.day_id === dayId).length,
    saveEvent: e => { s.events.set(e.id, e) },
    saveChecks: changed => { for (const [id, c] of Object.entries(changed)) s.checks.set(id, c) },
    saveJobs: jobs => { s.jobs.push(...jobs) },
    saveRejection: (e, error, code) => { s.rejections.set(e.id, { error, code, event: e }) },
    saveVenueState: v => { Object.assign(s.state, v) },
    closeDay: day => { day.closed = true; s.state.day = null },
  }
}

test('sequencer: numbers events and checks, duplicates get the same answer, offline conflict is refused and kept', async () => {
  const store = memoryStore({ settings: { day_starts_at: '04:00' } })
  const seq = createSequencer(store)
  const checkId = ulid()
  const opened = ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC_REST, number: 1 }, { check_id: checkId })
  const r1 = await seq.submit(opened, { now: new Date('2026-10-11T18:00:00Z') })
  assert.equal(r1.seq, 1)
  assert.equal(r1.checks[checkId].number, 1)
  assert.equal(r1.event.assigned.number_code, 'T1', 'the sequencer stamps the device\'s code')
  assert.equal(checkLabel(r1.checks[checkId]), 'T1-1')
  const again = await seq.submit(opened)
  assert.equal(again.duplicate, true)
  assert.equal(again.seq, 1)
  assert.equal(store.data.days[0].business_date, '2026-10-11')

  const l = line(COLA)
  await seq.submit(ev('line.added', { line: l }, { check_id: checkId }))
  const sent = await seq.submit(ev('lines.sent', { send_id: ulid(), line_ids: [l.id] }, { check_id: checkId }))
  assert.equal(sent.jobs.length, 0, 'kitchen tickets come from the kitchen flow (kitchenPrint.test.mjs)')

  // Terminal 1 takes the payment and closes; terminal 2, offline, took
  // another payment for the same check.
  const p1 = ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 300, tendered: 500 } }, { check_id: checkId, device_id: 'T1' })
  const offline = ev('payment.added', { payment: { id: ulid(), tender: 'card_external', amount: 300 } }, { check_id: checkId, device_id: 'T2' })
  const pr = await seq.submit(p1)
  assert.ok(pr.jobs.some(j => j.kind === 'drawer'))
  await seq.submit(ev('check.closed', {}, { check_id: checkId }))
  const late = await seq.submit(offline)
  assert.equal(late.ok, false)
  assert.equal(late.code, 'closed')
  assert.equal(store.data.rejections.get(offline.id).code, 'closed')
  const lateAgain = await seq.submit(offline)
  assert.equal(lateAgain.duplicate, true)
  assert.equal(store.data.state.last_seq, 5)
})

test('sequencer: each device numbers its own checks and orders; the day close needs closed checks', async () => {
  const store = memoryStore()
  const seq = createSequencer(store)
  const a = ulid(), b = ulid(), x = ulid()
  // Two tills give out numbers at the same time and never the same one:
  // each has its code and its own range of order numbers.
  const ra = await seq.submit(ev('check.opened', { mode: 'counter', revenue_stream_id: RC_TAKEAWAY, number: 4, order_no: 12 }, { check_id: a }))
  const rx = await seq.submit(ev('check.opened', { mode: 'counter', revenue_stream_id: RC_TAKEAWAY, number: 4, order_no: 112 }, { check_id: x, device_id: 'T2' }))
  const rb = await seq.submit(ev('check.opened', { mode: 'counter', revenue_stream_id: RC_TAKEAWAY, number: 5, order_no: 13 }, { check_id: b }))
  assert.deepEqual([ra.checks[a].order_no, rb.checks[b].order_no, rx.checks[x].order_no], [12, 13, 112])
  assert.deepEqual([ra.checks[a].number_code, rx.checks[x].number_code], ['T1', 'T2'])
  assert.equal(checkLabel(rb.checks[b]), '#13')
  const date = store.data.days[0].business_date
  assert.deepEqual(store.data.state.numbers, { T1: { date, check: 5, order: 13 }, T2: { date, check: 4, order: 112 } })
  // A bad number is refused like any bad event.
  assert.equal((await seq.submit(ev('check.opened', { mode: 'counter', number: 0 }, { check_id: ulid() }))).code, 'invalid')
  assert.equal((await seq.submit(ev('check.opened', { mode: 'counter', number: 2, order_no: 99999 }, { check_id: ulid() }))).code, 'invalid')

  const z = await seq.submit(ev('day.closed', { declared_cash: 0 }, { staff_id: MANAGER }))
  assert.equal(z.code, 'open_checks')
  assert.equal(z.error, '3 checks are still open: close them first')
  assert.equal((await seq.submit(ev('day.closed', {}, { staff_id: SERVER }))).code, 'permission')
  for (const id of [a, b, x]) await seq.submit(ev('check.closed', {}, { check_id: id }))
  const z2 = await seq.submit(ev('day.closed', { declared_cash: 0 }, { staff_id: MANAGER }))
  assert.ok(z2.ok, z2.error)
  const c = ulid()
  const rc = await seq.submit(ev('check.opened', { mode: 'counter', number: 6, order_no: 14 }, { check_id: c }))
  assert.equal(rc.checks[c].order_no, 14)
  assert.equal(store.data.days.length, 2)
  assert.notEqual(rc.checks[c].day_id, ra.checks[a].day_id)
})

// ── Reports ─────────────────────────────────────────────────────

test('dayFigures: sales, tenders, VAT, voids, refunds on the day they happen', async () => {
  const store = memoryStore()
  const seq = createSequencer(store)
  const id = ulid()
  await seq.submit(ev('check.opened', { mode: 'table', table_id: TABLE5, covers: 2, revenue_stream_id: RC_REST, charges: [{ ...SERVICE_12, value: 10 }] }, { check_id: id }))
  const a = line(PAD_THAI, { choices: { [PROTEIN]: [CHICKEN] } }, { revenue_stream_id: RC_REST })
  const b = line(COLA, {}, { qty: 2, revenue_stream_id: RC_REST })
  await seq.submit(ev('line.added', { line: a }, { check_id: id }))
  await seq.submit(ev('line.added', { line: b }, { check_id: id }))
  await seq.submit(ev('lines.sent', { send_id: ulid(), line_ids: [a.id, b.id] }, { check_id: id }))
  await seq.submit(ev('line.voided', { line_id: b.id, qty: 1, new_line_id: ulid(), reason: 'Spilt' }, { check_id: id, staff_id: SUPER }))
  // 1250 + 300 = 1550, +10% = 155 -> 1705
  await seq.submit(ev('payment.added', { payment: { id: ulid(), tender: 'card_external', amount: 1000, tip: 150 } }, { check_id: id }))
  await seq.submit(ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 705, tendered: 1000 } }, { check_id: id }))
  const closed = await seq.submit(ev('check.closed', {}, { check_id: id }))
  assert.ok(closed.ok, closed.error)
  const day1 = store.data.days[0].id
  const f = dayFigures([...store.data.checks.values()], day1)
  assert.equal(f.counts.closed, 1)
  assert.equal(f.covers, 2)
  assert.equal(f.sales.gross, 1550)
  assert.equal(f.sales.service_charge, 155)
  assert.equal(f.sales.total, 1705)
  assert.equal(f.voids.count, 1)
  assert.equal(f.voids.value, 300)
  assert.equal(f.tips, 150)
  assert.equal(f.cash_expected, 705)
  assert.equal(f.takings, 1705 + 150)
  assert.equal(f.revenue_streams[0].net, 1550)
  assert.equal(f.vat[0].rate, 20)

  await seq.submit(ev('day.closed', {}, { staff_id: MANAGER }))
  // Refund the next day: counts on day 2, not day 1.
  await seq.submit(ev('refund.added', { refund: { id: ulid(), tender: 'cash', amount: 200, reason: 'Cold' } }, { check_id: id, staff_id: MANAGER }))
  const day2 = store.data.days[1].id
  const all = [...store.data.checks.values()]
  assert.equal(dayFigures(all, day1).refunds.amount, 0)
  const f2 = dayFigures(all, day2)
  assert.equal(f2.refunds.amount, 200)
  assert.equal(f2.cash_expected, -200)
  assert.equal(f2.sales.total, 0)
})

test('businessDate: before the day starts counts as yesterday', () => {
  assert.equal(businessDate('2026-10-12T02:30:00Z', 'Europe/London', '04:00'), '2026-10-11')
  assert.equal(businessDate('2026-10-12T04:30:00Z', 'Europe/London', '04:00'), '2026-10-12')
  assert.equal(businessDate('2026-06-30T23:30:00Z', 'Europe/London', '00:00'), '2026-07-01')
})

test('replay: refused events are listed, the rest applied', () => {
  const id = ulid()
  const events = [
    ev('check.opened', { mode: 'tab', tab_name: 'Bar 1' }, { check_id: id }),
    ev('line.added', { line: line(COLA) }, { check_id: id }),
    ev('check.closed', {}, { check_id: id }),
  ]
  const r = replay({}, events, { staffById })
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].code, 'balance')
  assert.equal(r.checks[id].lines.length, 1)
})

// ── Order types, revenue streams and tax (migration 170) ────────

test('order type, stream and tent on a check; changing the type re-rates its lines', async () => {
  const { posTax } = await import('../pricing.js')
  const EAT = uuid(), OUT = uuid(), STD = uuid(), ZERO = uuid()
  const config = {
    venue: { id: VENUE },
    tax_rates: [{ id: STD, name: 'Standard', rate: 20, is_default: true, values: {} }, { id: ZERO, name: 'Zero', rate: 0, values: {} }],
  }
  const sandwich = { id: uuid(), tax: [null, { rate: STD, rules: [{ types: [OUT], rate: ZERO }] }, null] }
  let c = open({ order_type_id: EAT, tent: '7' })
  assert.equal(c.order_type_id, EAT)
  assert.equal(c.tent, '7')
  const t = posTax(sandwich, c, config)
  assert.deepEqual(t, { vat_rate: 20, tax_rate_id: STD })
  c = ok(apply(c, 'line.added', { line: { ...line(COLA), vat_rate: t.vat_rate, tax_rate_id: t.tax_rate_id } })).checks[c.id]
  const lineId = c.lines[0].id
  assert.equal(c.lines[0].tax_rate_id, STD)

  const takeOut = posTax(sandwich, { ...c, order_type_id: OUT }, config)
  assert.deepEqual(takeOut, { vat_rate: 0, tax_rate_id: ZERO })
  c = ok(apply(c, 'check.order_type_set', { order_type_id: OUT, tab_name: 'Sam', tent: null, lines: { [lineId]: takeOut } })).checks[c.id]
  assert.equal(c.order_type_id, OUT)
  assert.equal(c.tab_name, 'Sam')
  assert.equal(c.tent, null)
  assert.equal(c.lines[0].vat_rate, 0)
  assert.equal(checkTotals(c).vat_total, 0)

  c = ok(apply(c, 'check.tent_set', { tent: '12' })).checks[c.id]
  assert.equal(c.tent, '12')
  const other = uuid()
  c = ok(apply(c, 'check.stream_set', { revenue_stream_id: other, lines: {} })).checks[c.id]
  assert.equal(c.revenue_stream_id, other)
  assert.equal(c.lines[0].revenue_stream_id, other)

  assert.match(apply(c, 'check.order_type_set', { order_type_id: 'eat_in' }).error, /order_type_id/)
  assert.match(apply(c, 'check.tent_set', { tent: 'x'.repeat(30) }).error, /tent/)
  assert.match(apply(c, 'check.order_type_set', { order_type_id: EAT, lines: { [lineId]: 20 } }).error, /lines/)
  // An item not on the menu takes the default rate.
  assert.deepEqual(posTax(null, c, config), { vat_rate: 20, tax_rate_id: STD })
})

test('day figures by revenue stream and by order type', () => {
  const EAT = uuid(), OUT = uuid()
  const day = uuid()
  const mk = (type, stream) => {
    let c = open({ order_type_id: type, revenue_stream_id: stream, charges: [] })
    c = ok(apply(c, 'line.added', { line: line(COLA) })).checks[c.id]
    c.day_id = day
    c = ok(apply(c, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: 300 } })).checks[c.id]
    return ok(apply(c, 'check.closed', {})).checks[c.id]
  }
  const f = dayFigures([mk(EAT, RC_REST), mk(OUT, RC_TAKEAWAY), mk(OUT, RC_TAKEAWAY)], day)
  assert.deepEqual(f.order_types.map(x => [x.id, x.checks, x.net]).sort((a, b) => a[1] - b[1]), [[EAT, 1, 300], [OUT, 2, 600]])
  assert.deepEqual(f.revenue_streams.map(x => x.net).sort(), [300, 600])
})
