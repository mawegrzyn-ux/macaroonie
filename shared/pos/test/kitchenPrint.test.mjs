// Kitchen printers in the kitchen flow (shared/pos/kitchenPrint.js, migration
// 191): what prints where and when (sent, held course as HOLD then FIRE, a
// printer after a screen printing when the screen bumps, voids, meal deal
// parts split between printers), orders for later printing when their time
// comes (kitchen.print_due through the sequencer), the venue's ticket design,
// and the flow checks for printer boxes.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent } from '../checks.js'
import { createSequencer } from '../sequencer.js'
import { kitchenForCheckEvent, applyKitchenEvent, flowProblems, onlineOrderId, nodeState } from '../kitchen.js'
import { kitchenPrintJobs, printsDue, hasPrinters } from '../kitchenPrint.js'
import { toText } from '../tickets.js'
import { defaultLayout } from '../ticketLayout.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid()
const ANNA = uuid()
const staffById = { [ANNA]: { id: ANNA, name: 'Anna', permissions: { void: true } } }
const FOOD = uuid(), DRINKS = uuid()
const STARTERS = uuid(), MAINS = uuid()
const TABLE5 = uuid()
const SALAD = uuid(), PAD_THAI = uuid(), COLA = uuid(), MEAL = uuid(), BURGER = uuid()

const link = (from, to, ...targets) => ({ id: uuid(), from, to, targets: targets.map(([kind, id]) => ({ kind, id })) })
const byId = list => Object.fromEntries(list.map(s => [s.id, s]))

// The grill has a screen and a printer side by side; drinks print at the
// bar; once the pass bumps a dish the runner's printer prints it.
const GRILL = uuid(), PASS = uuid(), KP = uuid(), BP = uuid(), RP = uuid()
const stations = {
  GRILL: { id: GRILL, name: 'Grill', kind: 'prep', settings: {} },
  PASS: { id: PASS, name: 'Pass', kind: 'expo', settings: {} },
  KP: { id: KP, name: 'Kitchen printer', kind: 'printer', settings: { printer_id: 'pK' } },
  BP: { id: BP, name: 'Bar printer', kind: 'printer', settings: { printer_id: 'pB' } },
  RP: { id: RP, name: 'Runner printer', kind: 'printer', settings: { printer_id: 'pR' } },
}
const cfg = {
  enabled: true,
  courses: { [STARTERS]: { name: 'Starters', sort_order: 1 }, [MAINS]: { name: 'Mains', sort_order: 2 } },
  tables: { [TABLE5]: { label: '5' } },
  staff: { [ANNA]: { name: 'Anna' } },
  order_types: {},
  stations: byId(Object.values(stations)),
  flow: [
    link(null, KP, ['section', FOOD]),
    link(null, GRILL, ['section', FOOD]),
    link(null, BP, ['section', DRINKS]),
    link(GRILL, PASS),
    link(PASS, RP),
  ],
}

let clock = Date.parse('2026-10-19T12:00:00Z')
const at = () => new Date(clock).toISOString()
function ev(type, payload, { check_id = null, staff_id = ANNA, device = 'T1' } = {}) {
  clock += 1000
  const t = new Date(clock).toISOString()
  return { id: ulid(clock), venue_id: VENUE, device_id: device, staff_id, check_id, type, payload, client_at: t, received_at: t }
}
const kev = (type, payload) => ev(type, payload, { staff_id: null, device: 'K1' })
const ok = r => { assert.ok(r.ok, r.error); return r }
const lineOf = (name, item_id, section_id, extra = {}) => ({ id: ulid(), item_id, section_id, name, qty: 1, unit_price: 500, modifiers: [], vat_rate: 20, ...extra })

function till(kcfg = cfg) {
  let checks = {}
  let orders = {}
  const printed = []
  const run = changed => {
    const r = kitchenPrintJobs(changed, kcfg, at())
    printed.push(...r.jobs)
    return r.jobs
  }
  return {
    get orders() { return orders },
    printed,
    send(e) {
      const before = checks
      const r = ok(applyEvent(checks, e, { staffById }))
      checks = { ...checks, ...r.checks }
      const k = kitchenForCheckEvent(e, before, r.checks, orders, kcfg)
      orders = { ...orders, ...k }
      return run(k)
    },
    kitchen(e) {
      const r = ok(applyKitchenEvent(orders, e, kcfg))
      orders = { ...orders, ...r.orders }
      return run(r.orders)
    },
  }
}
function openTable(t) {
  const id = ulid()
  t.send({ ...ev('check.opened', { mode: 'table', table_id: TABLE5 }, { check_id: id }), assigned: { number: 12 } })
  return id
}
function addAndSend(t, checkId, lines, held = []) {
  for (const l of lines) t.send(ev('line.added', { line: l }, { check_id: checkId }))
  return t.send(ev('lines.sent', { send_id: ulid(), line_ids: lines.map(l => l.id), held_course_ids: held }, { check_id: checkId }))
}
const textOf = (jobs, printer, kind = 'kitchen') => toText(jobs.find(j => j.printer_id === printer && j.kind === kind)?.ops || [])

test('sent dishes print once at the printers on their way; held courses as HOLD then FIRE; meal deal parts split', () => {
  const t = till()
  const c = openTable(t)
  const salad = lineOf('Salad', SALAD, FOOD, { course_id: STARTERS, allergies: ['Peanuts'], note: 'No dressing' })
  const padThai = lineOf('Pad Thai', PAD_THAI, FOOD, { course_id: MAINS, modifiers: [{ label: 'Onion', prefix: 'no', price: 0 }] })
  const cola = lineOf('Cola', COLA, DRINKS)
  const meal = lineOf('Burger meal', MEAL, FOOD, { combo: [
    { step: 'Main', item_id: BURGER, section_id: FOOD, name: 'Burger', modifiers: [], upcharge: 0 },
    { step: 'Drink', item_id: COLA, section_id: DRINKS, name: 'Cola', modifiers: [], upcharge: 0 },
  ] })
  const jobs = addAndSend(t, c, [salad, padThai, cola, meal], [MAINS])
  assert.deepEqual(jobs.map(j => [j.printer_id, j.kind]).sort(), [['pB', 'kitchen'], ['pK', 'kitchen']])
  const kitchen = textOf(jobs, 'pK')
  assert.match(kitchen, /KITCHEN PRINTER/i)
  assert.match(kitchen, /T A B L E {3}5/)
  assert.match(kitchen, /STARTERS/)
  assert.match(kitchen, /MAINS {2}- HOLD/)
  assert.match(kitchen, /1 x Pad Thai/)
  assert.match(kitchen, /- No Onion/)
  assert.match(kitchen, /ALLERGY: PEANUTS/)
  assert.match(kitchen, /> Burger/)
  assert.doesNotMatch(kitchen, /Cola/)
  const bar = textOf(jobs, 'pB')
  assert.match(bar, /1 x Cola/)
  assert.match(bar, /> Cola/, 'the meal deal\'s drink prints at the bar')
  assert.doesNotMatch(bar, /Burger\b(?! meal)/)
  const job = jobs.find(j => j.printer_id === 'pK')
  assert.equal(job.station_id, KP)
  assert.equal(job.kitchen_order_id, c)
  assert.equal(job.check_id, c)

  // Nothing new: nothing prints again.
  assert.deepEqual(kitchenPrintJobs(t.orders, cfg, at()).jobs, [])
  // Dishes that only reach printers are done there; the grill still has its own.
  const o = t.orders[c]
  assert.equal(nodeState(o.items.find(i => i.id === cola.id), BP, cfg, at()), 'done')

  // Fire the mains: a FIRE ticket at the kitchen printer, nothing at the bar.
  const fired = t.send(ev('course.fired', { course_id: MAINS }, { check_id: c }))
  assert.deepEqual(fired.map(j => [j.printer_id, j.kind]), [['pK', 'fire']])
  assert.match(textOf(fired, 'pK', 'fire'), /FIRE MAINS/)
  assert.match(textOf(fired, 'pK', 'fire'), /Pad Thai/)
  assert.doesNotMatch(textOf(fired, 'pK', 'fire'), /Salad/)

  // Void the salad: a VOID ticket where it printed.
  const voided = t.send(ev('line.voided', { line_id: salad.id, reason: 'Changed mind' }, { check_id: c }))
  assert.deepEqual(voided.map(j => [j.printer_id, j.kind]), [['pK', 'void']])
  assert.match(textOf(voided, 'pK', 'void'), /V O I D/)
  assert.match(textOf(voided, 'pK', 'void'), /Salad/)
  assert.deepEqual(t.send(ev('line.voided', { line_id: cola.id, reason: 'Spilt' }, { check_id: c })).map(j => j.printer_id), ['pB'])
})

test('a printer after a kitchen screen prints when the dish reaches it (the pass bumps)', () => {
  const t = till()
  const c = openTable(t)
  const salad = lineOf('Salad', SALAD, FOOD)
  addAndSend(t, c, [salad])
  assert.equal(t.printed.filter(j => j.printer_id === 'pR').length, 0)
  assert.deepEqual(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: GRILL })), [])
  const atPass = t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: PASS }))
  assert.deepEqual(atPass.map(j => [j.printer_id, j.kind]), [['pR', 'kitchen']])
  assert.match(toText(atPass[0].ops), /Salad/)
  assert.doesNotMatch(toText(atPass[0].ops), /HOLD|FIRE/)
})

test('orders for later print when their time comes; the venue\'s ticket design is used', async () => {
  const layout = defaultLayout('kitchen')
  layout.blocks.push({ id: 'k9', type: 'text', opts: { text: 'CHECK ALLERGIES' } })
  const kcfg = { ...cfg, ticket_layout: layout }
  const orders = new Map()
  const saved = { jobs: [], events: [] }
  const store = {
    run: (_v, fn) => fn(),
    findEvent: () => null, findRejection: () => null,
    context: () => ({ staffById, print: {}, settings: {}, timezone: 'Europe/London', kitchen: kcfg }),
    venueState: () => ({ last_seq: saved.events.length, next_check_no: 1, next_order_no: 1, day: null }),
    saveEvent: e => { saved.events.push(e) },
    saveRejection: () => {},
    saveVenueState: () => {},
    saveJobs: jobs => { saved.jobs.push(...jobs) },
    loadKitchenOrders: ids => Object.fromEntries(ids.filter(id => orders.has(id)).map(id => [id, structuredClone(orders.get(id))])),
    loadOpenKitchenOrders: () => Object.fromEntries([...orders].map(([id, o]) => [id, structuredClone(o)])),
    saveKitchenOrders: changed => { for (const [id, o] of Object.entries(changed)) orders.set(id, structuredClone(o)) },
    saveKitchenLog: () => {},
  }
  const seq = createSequencer(store)
  const orderId = uuid()
  const now = new Date('2026-10-19T12:00:00Z')
  const fireAt = '2026-10-19T12:30:00Z'
  const r = ok(await seq.submit(kev('kitchen.order_in', { order: {
    id: onlineOrderId(orderId), order_id: orderId, number: 'W7', guest: 'Sam', type: null, type_name: 'Collection',
    promised_at: '2026-10-19T12:45:00Z', fire_at: fireAt, note: null, allergy: null,
    items: [{ id: uuid(), item_id: SALAD, section_id: FOOD, name: 'Salad', qty: 2, options: [] }],
  } }), { now }))
  assert.equal(r.jobs.length, 0, 'not yet: its time hasn\'t come')
  assert.equal(printsDue(Object.fromEntries(orders), kcfg, now.toISOString()), false)

  const later = new Date('2026-10-19T12:31:00Z')
  assert.equal(printsDue(Object.fromEntries(orders), kcfg, later.toISOString()), true)
  const early = await seq.submit(kev('kitchen.print_due', {}), { now })
  assert.equal(early.nothing, true)
  const events = saved.events.length
  const due = ok(await seq.submit(kev('kitchen.print_due', {}), { now: later }))
  assert.equal(saved.events.length, events + 1)
  assert.deepEqual(due.jobs.map(j => [j.printer_id, j.kind]), [['pK', 'kitchen']])
  const text = toText(due.jobs[0].ops)
  assert.match(text, /O N L I N E {3}W 7/)
  assert.match(text, /2 x Salad/)
  assert.match(text, /CHECK ALLERGIES/)
  assert.equal(saved.jobs.length, 1)
  // Once printed, the sweep has nothing more.
  const again = await seq.submit(kev('kitchen.print_due', {}), { now: new Date('2026-10-19T12:32:00Z') })
  assert.equal(again.nothing, true)
})

test('flow checks: printers take links in and out; a Splitter can\'t share with a printer; no printer, no printing', () => {
  const box = { id: uuid(), name: 'Wings balance', kind: 'balance', settings: {} }
  const list = [...Object.values(stations), box]
  assert.deepEqual(flowProblems(list, [link(null, KP), link(KP, PASS)]), [])
  assert.match(flowProblems(list, [link(null, box.id), link(box.id, KP)]).join(' '), /link it to prep stations/)
  assert.equal(hasPrinters(cfg), true)
  assert.equal(hasPrinters({ stations: { x: { kind: 'printer', settings: {} } } }), false, 'a printer box with no printer picked prints nothing')
})

test('a Sleeper before a printer: the ticket prints once the wait is over (the minute sweep)', () => {
  const SLEEP = uuid()
  const kcfg = {
    ...cfg,
    stations: byId([...Object.values(stations), { id: SLEEP, name: 'Hold 5', kind: 'sleeper', settings: { delay_mins: 5 } }]),
    flow: [link(null, SLEEP, ['section', FOOD]), link(SLEEP, KP)],
  }
  const t = till(kcfg)
  const c = openTable(t)
  const jobs = addAndSend(t, c, [lineOf('Salad', SALAD, FOOD)])
  assert.deepEqual(jobs, [], 'nothing yet: the Sleeper holds it')
  assert.equal(printsDue(t.orders, kcfg, at()), false)
  const wake = new Date(clock + 5 * 60_000 + 1000).toISOString()
  assert.equal(printsDue(t.orders, kcfg, wake), true)
  const due = kitchenPrintJobs(structuredClone(t.orders), kcfg, wake)
  assert.deepEqual(due.jobs.map(j => [j.printer_id, j.kind]), [['pK', 'kitchen']])
})
