// Kitchen screen (KDS) tests: kitchen orders made from till events, bump /
// recall / remake / priority / collected, the pass (expo), online orders,
// what each station shows, on-order counts, speed figures, and the
// sequencer storing it all (in-memory store, as the hub's will be).
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent } from '../checks.js'
import { createSequencer } from '../sequencer.js'
import {
  kitchenForCheckEvent, applyKitchenEvent, stationTickets, onOrderCounts, stationStats, boardNumbers,
  laterOrders, recentBumps, itemState, ageTone, clockSince, kitchenEventProblem, onlineOrderId,
} from '../kitchen.js'

const uuid = () => globalThis.crypto.randomUUID()

const VENUE = uuid()
const ANNA = uuid()
const staffById = { [ANNA]: { id: ANNA, name: 'Anna', permissions: { void: true, transfer: true, discount_max_pct: 0 } } }
const FOOD = uuid(), DRINKS = uuid(), SIDES = uuid()
const STARTERS = uuid(), MAINS = uuid()
const RC_REST = uuid(), RC_TAKEAWAY = uuid()
const TABLE5 = uuid()
const GRILL = uuid(), FRYER = uuid(), BAR = uuid(), PASS = uuid()
const WINGS = uuid(), BONELESS = uuid(), FRIES = uuid(), COLA = uuid(), MEAL = uuid()
const LEMON = uuid()

const stations = {
  [GRILL]: { id: GRILL, name: 'Grill', kind: 'prep', settings: { target_mins: 5, late_mins: 10 } },
  [FRYER]: { id: FRYER, name: 'Fryer', kind: 'prep', settings: {} },
  [BAR]:   { id: BAR, name: 'Bar', kind: 'prep', settings: {} },
  [PASS]:  { id: PASS, name: 'Pass', kind: 'expo', settings: {} },
}
const routes = [
  { station_id: GRILL, target_kind: 'default', target_id: null },
  { station_id: BAR, target_kind: 'section', target_id: DRINKS },
  { station_id: FRYER, target_kind: 'section', target_id: SIDES },
]
const base = {
  enabled: true, stations, routes,
  courses: { [STARTERS]: { name: 'Starters', sort_order: 1 }, [MAINS]: { name: 'Mains', sort_order: 2 } },
  tables: { [TABLE5]: { label: '5' } },
  staff: { [ANNA]: { name: 'Anna' } },
  revenue_centres: { [RC_REST]: { name: 'Restaurant', vat_mode: 'eat_in' }, [RC_TAKEAWAY]: { name: 'Takeaway', vat_mode: 'takeaway' } },
}
const withExpo = { ...base, expo: true }
const noExpo = { ...base, expo: false, stations: Object.fromEntries(Object.entries(stations).filter(([id]) => id !== PASS)) }

let clock = Date.parse('2026-10-16T12:00:00Z')
const at = () => new Date(clock).toISOString()
function ev(type, payload, { check_id = null, staff_id = ANNA, device = 'T1' } = {}) {
  clock += 1000
  const t = new Date(clock).toISOString()
  return { id: ulid(clock), venue_id: VENUE, device_id: device, staff_id, check_id, type, payload, client_at: t, received_at: t }
}
const kev = (type, payload) => ev(type, payload, { staff_id: null, device: 'K1' })
const ok = r => { assert.ok(r.ok, r.error); return r }

function lineOf(name, item_id, section_id, extra = {}) {
  return { id: ulid(), item_id, section_id, name, qty: 1, unit_price: 500, modifiers: [], vat_rate: 20, ...extra }
}

/** Run check events through the check rules and the kitchen, like the sequencer does. */
function till(cfg) {
  let checks = {}
  let orders = {}
  return {
    get checks() { return checks },
    get orders() { return orders },
    send(e) {
      const before = checks
      const r = ok(applyEvent(checks, e, { staffById }))
      checks = { ...checks, ...r.checks }
      const k = kitchenForCheckEvent(e, before, r.checks, orders, cfg)
      orders = { ...orders, ...k }
      return k
    },
    kitchen(e) {
      const r = applyKitchenEvent(orders, e, cfg)
      if (r.ok) orders = { ...orders, ...r.orders }
      return r
    },
  }
}

function openTable(t, extra = {}) {
  const id = ulid()
  t.send({ ...ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_centre_id: RC_REST, ...extra }, { check_id: id }), assigned: { number: 12 } })
  return id
}
function addAndSend(t, checkId, lines, held = []) {
  for (const l of lines) t.send(ev('line.added', { line: l }, { check_id: checkId }))
  return t.send(ev('lines.sent', { send_id: ulid(), line_ids: lines.map(l => l.id), held_course_ids: held }, { check_id: checkId }))
}

test('event shapes: kitchen events need no staff, server-only shapes are checked', () => {
  assert.equal(kitchenEventProblem(kev('kitchen.bumped', { order_id: ulid(), station_id: GRILL })), null)
  assert.match(kitchenEventProblem(kev('kitchen.bumped', { order_id: 'nope', station_id: GRILL })), /order_id/)
  assert.match(kitchenEventProblem(kev('kitchen.item_done', { order_id: ulid(), station_id: GRILL, item_id: 'x' })), /done/)
  assert.match(kitchenEventProblem(kev('kitchen.order_in', { order: { id: 'web-x', items: [] } })), /order/)
})

test('sending dishes makes a kitchen order: routing per station, meal deal parts split, held course waits', () => {
  const t = till(withExpo)
  const c = openTable(t)
  const deal = lineOf('Wing meal', MEAL, FOOD, {
    combo: [
      { item_id: WINGS, section_id: FOOD, name: '8pc Wings', modifiers: [{ label: 'Lemon Pepper', option_id: LEMON, base: true, price: 0 }] },
      { item_id: FRIES, section_id: SIDES, name: 'Fries', modifiers: [{ label: 'Salt', prefix: 'no', price: 0 }] },
    ],
  })
  const cola = lineOf('Cola', COLA, DRINKS)
  const steak = lineOf('Boneless', BONELESS, FOOD, { course_id: MAINS, note: 'extra crispy', allergies: ['Celery'] })
  const k = addAndSend(t, c, [deal, cola, steak], [MAINS])
  const o = k[c]
  assert.equal(o.source, 'till')
  assert.equal(o.table, '5')
  assert.equal(o.number, '12')
  assert.equal(o.type, 'eat_in')
  assert.equal(o.items.length, 3)
  const item = id => o.items.find(i => i.id === id)
  assert.deepEqual(item(deal.id).stations.sort(), [GRILL, FRYER].sort())
  assert.deepEqual(item(cola.id).stations, [BAR])
  assert.equal(itemState(item(steak.id), stations[GRILL], at()), 'held')

  // The grill sees the deal (wings part only) and the held mains.
  const grill = stationTickets(t.orders, stations[GRILL], at())
  assert.equal(grill.length, 1)
  const gDeal = grill[0].items.find(i => i.id === deal.id)
  assert.deepEqual(gDeal.parts.map(p => p.name), ['8pc Wings'])
  assert.equal(gDeal.parts[0].mods[0].kind, 'base')
  assert.equal(grill[0].held, 1)
  // The fryer sees the fries part, with "No Salt" as a removal.
  const fryer = stationTickets(t.orders, stations[FRYER], at())
  assert.deepEqual(fryer[0].items[0].parts.map(p => p.name), ['Fries'])
  assert.equal(fryer[0].items[0].parts[0].mods[0].kind, 'remove')
  // The pass sees everything.
  assert.equal(stationTickets(t.orders, stations[PASS], at())[0].items.length, 3)
})

test('bump at each station, the pass marks it ready, recall brings it back', () => {
  const t = till(withExpo)
  const c = openTable(t)
  const wings = lineOf('Wings', WINGS, FOOD)
  const cola = lineOf('Cola', COLA, DRINKS)
  addAndSend(t, c, [wings, cola])
  clock += 4 * 60_000
  const g = ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: GRILL })))
  assert.equal(g.log.length, 1)
  assert.equal(g.log[0].kind, 'bump')
  assert.ok(g.log[0].seconds >= 240)
  assert.equal(stationTickets(t.orders, stations[GRILL], at()).length, 0)
  assert.equal(stationTickets(t.orders, stations[BAR], at()).length, 1)
  assert.equal(t.orders[c].status, 'active')
  // Nothing left to bump at the grill.
  assert.equal(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: GRILL })).code, 'nothing')
  // The pass sees the wings done, the cola not.
  const pass = stationTickets(t.orders, stations[PASS], at())[0]
  assert.equal(pass.items.find(i => i.id === wings.id).state, 'done')
  assert.equal(pass.items.find(i => i.id === cola.id).state, 'active')
  ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: PASS })))
  assert.equal(t.orders[c].status, 'ready')
  assert.equal(stationTickets(t.orders, stations[BAR], at()).length, 0)
  assert.equal(stationTickets(t.orders, stations[PASS], at()).length, 0)
  // Recall at the pass: active again, the bar's cola back on the bar.
  ok(t.kitchen(kev('kitchen.recalled', { order_id: c, station_id: PASS })))
  assert.equal(t.orders[c].status, 'active')
  assert.equal(stationTickets(t.orders, stations[BAR], at()).length, 1)
  assert.equal(recentBumps(t.orders, stations[GRILL], at()).length, 1)
})

test('without a pass the order is ready once every station is done; dishes done one by one count as the bump', () => {
  const t = till(noExpo)
  const c = openTable(t)
  const wings = lineOf('Wings', WINGS, FOOD)
  const fries = lineOf('Fries', FRIES, SIDES)
  addAndSend(t, c, [wings, fries])
  ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: GRILL })))
  assert.equal(t.orders[c].status, 'active')
  const r = ok(t.kitchen(kev('kitchen.item_done', { order_id: c, station_id: FRYER, item_id: fries.id, done: true })))
  assert.equal(r.log.length, 1, 'last dish done counts as a bump')
  assert.equal(t.orders[c].status, 'ready')
  // Undo the fries: back in progress.
  ok(t.kitchen(kev('kitchen.item_done', { order_id: c, station_id: FRYER, item_id: fries.id, done: false })))
  assert.equal(t.orders[c].status, 'active')
})

test('firing a held course, adding dishes later, voids and partial voids', () => {
  const t = till(noExpo)
  const c = openTable(t)
  const starter = lineOf('Wings', WINGS, FOOD, { course_id: STARTERS })
  const main = lineOf('Boneless', BONELESS, FOOD, { course_id: MAINS, qty: 3 })
  addAndSend(t, c, [starter, main], [MAINS])
  ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: GRILL })))
  assert.equal(t.orders[c].status, 'ready', 'only the starters were fired')
  t.send(ev('course.fired', { course_id: MAINS }, { check_id: c }))
  assert.equal(t.orders[c].status, 'active')
  const grill = stationTickets(t.orders, stations[GRILL], at())
  assert.equal(grill[0].items.filter(i => i.state === 'active').length, 1)

  // Two of the three mains voided: the ticket shows 1 to make and the void.
  const newId = ulid()
  t.send(ev('line.voided', { line_id: main.id, qty: 2, new_line_id: newId, reason: 'Changed order' }, { check_id: c }))
  const o = t.orders[c]
  assert.equal(o.items.find(i => i.id === main.id).qty, 1)
  assert.ok(o.items.find(i => i.id === newId).voided_at)
  const after = stationTickets(t.orders, stations[GRILL], at())[0]
  assert.equal(after.voids, 1)
  // A dish sent later shows as added.
  const fries = lineOf('Fries', FRIES, SIDES)
  addAndSend(t, c, [fries])
  assert.equal(t.orders[c].items.find(i => i.id === fries.id).added, true)
  // Bumping the grill also clears the void notice there.
  ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: GRILL })))
  assert.equal(stationTickets(t.orders, stations[GRILL], at()).length, 0)
})

test('everything voided cancels the kitchen order', () => {
  const t = till(withExpo)
  const c = openTable(t)
  const wings = lineOf('Wings', WINGS, FOOD)
  addAndSend(t, c, [wings])
  t.send(ev('line.voided', { line_id: wings.id, reason: 'Wrong table' }, { check_id: c }))
  assert.equal(t.orders[c].status, 'cancelled')
})

test('remake puts a dish back, priority, collected', () => {
  const t = till(withExpo)
  const id = ulid()
  t.send({ ...ev('check.opened', { mode: 'counter', revenue_centre_id: RC_TAKEAWAY }, { check_id: id }), assigned: { number: 3, order_no: 57 } })
  const wings = lineOf('Wings', WINGS, FOOD)
  addAndSend(t, id, [wings])
  assert.equal(t.orders[id].number, '57')
  assert.equal(t.orders[id].board, true)
  assert.equal(t.orders[id].type, 'takeaway')
  assert.deepEqual(boardNumbers(t.orders, at()).preparing.map(x => x.number), ['57'])
  ok(t.kitchen(kev('kitchen.priority', { order_id: id, on: true })))
  ok(t.kitchen(kev('kitchen.bumped', { order_id: id, station_id: GRILL })))
  ok(t.kitchen(kev('kitchen.bumped', { order_id: id, station_id: PASS })))
  assert.deepEqual(boardNumbers(t.orders, at()).ready.map(x => x.number), ['57'])
  const rm = ok(t.kitchen(kev('kitchen.remake', { order_id: id, station_id: PASS, item_id: wings.id, reason: 'Dropped' })))
  assert.equal(rm.log[0].kind, 'remake')
  assert.equal(t.orders[id].status, 'active')
  assert.equal(stationTickets(t.orders, stations[GRILL], at()).length, 1)
  ok(t.kitchen(kev('kitchen.bumped', { order_id: id, station_id: GRILL })))
  ok(t.kitchen(kev('kitchen.bumped', { order_id: id, station_id: PASS })))
  ok(t.kitchen(kev('kitchen.collected', { order_id: id })))
  assert.equal(t.orders[id].status, 'collected')
  assert.equal(boardNumbers(t.orders, at()).ready.length, 0)
  // Ready numbers leave the board after clearMins too.
  assert.equal(t.kitchen(kev('kitchen.collected', { order_id: id })).code, 'not_ready')
})

test('online orders: in the kitchen at once, or held until their time; the orders board can cancel', () => {
  const t = till(withExpo)
  const orderId = uuid()
  const now = Date.parse(at())
  const mk = (oid, fire) => kev('kitchen.order_in', { order: {
    id: onlineOrderId(oid), order_id: oid, number: 'W12', guest: 'Sam', type: 'collection',
    promised_at: new Date(now + 3600_000).toISOString(), fire_at: fire, note: null, allergy: 'Peanuts',
    items: [{ id: uuid(), item_id: WINGS, section_id: FOOD, name: 'Wings', qty: 2, options: [{ label: 'Lemon Pepper', mode: 'base' }] },
            { id: uuid(), item_id: COLA, section_id: DRINKS, name: 'Cola', qty: 1, options: [] }],
  } })
  ok(t.kitchen(mk(orderId, null)))
  const oid = onlineOrderId(orderId)
  assert.equal(t.orders[oid].source, 'online')
  assert.equal(stationTickets(t.orders, stations[GRILL], at()).length, 1)
  assert.equal(t.kitchen(mk(orderId, null)).code, 'duplicate')

  const later = uuid()
  const fireAt = new Date(now + 40 * 60_000).toISOString()
  ok(t.kitchen(mk(later, fireAt)))
  assert.equal(stationTickets(t.orders, stations[GRILL], at()).length, 1, 'the later one waits')
  assert.equal(laterOrders(t.orders, at()).length, 1)
  const then = new Date(now + 41 * 60_000).toISOString()
  assert.equal(stationTickets(t.orders, stations[GRILL], then).length, 2, 'and shows once its time comes')

  ok(t.kitchen(kev('kitchen.order_status', { order_id: oid, status: 'cancelled' })))
  assert.equal(t.orders[oid].status, 'cancelled')
  assert.equal(stationTickets(t.orders, stations[GRILL], at()).length, 0)
})

test('on-order counts: per dish, or summary groups adding up pieces', () => {
  const t = till(noExpo)
  const c = openTable(t)
  addAndSend(t, c, [
    lineOf('8pc Boneless', BONELESS, FOOD, { qty: 2 }),
    lineOf('Wings', WINGS, FOOD, { modifiers: [{ label: '6 Lemon Pepper Wings', base: true, price: 0 }] }),
  ])
  const plain = onOrderCounts(t.orders, stations[GRILL], at())
  assert.deepEqual(plain.map(x => [x.name, x.count]), [['8pc Boneless', 2], ['Wings', 1]])
  const grouped = { ...stations[GRILL], settings: { summary_groups: [
    { id: 'b', name: 'Boneless', members: [{ kind: 'dish', id: BONELESS, label: '8pc Boneless', qty: 8 }] },
    { id: 'w', name: 'Wings', members: [{ kind: 'option', label: '6 Lemon Pepper Wings', qty: 6 }] },
    { id: 't', name: 'Tenders', members: [] },
  ] } }
  assert.deepEqual(onOrderCounts(t.orders, grouped, at()).map(x => [x.name, x.count]), [['Boneless', 16], ['Wings', 6], ['Tenders', 0]])
})

test('speed figures and ticket colours', () => {
  const t = till(noExpo)
  for (const mins of [2, 6]) {
    const c = openTable(t)
    addAndSend(t, c, [lineOf('Wings', WINGS, FOOD)])
    clock += mins * 60_000
    ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: GRILL })))
  }
  const s = stationStats(t.orders, stations[GRILL])
  assert.equal(s.done, 2)
  assert.equal(s.on_time_pct, 50, 'target 5 minutes: one of two on time')
  const since = new Date(clock - 7 * 60_000).toISOString()
  assert.equal(ageTone(since, at(), stations[GRILL]), 'warn')
  assert.equal(ageTone(new Date(clock - 11 * 60_000).toISOString(), at(), stations[GRILL]), 'late')
  assert.equal(clockSince(new Date(clock - 65_000).toISOString(), at()), '1:05')
})

test('moving dishes and merging checks moves them in the kitchen', () => {
  const t = till(noExpo)
  const a = openTable(t)
  const b = openTable(t)
  const wings = lineOf('Wings', WINGS, FOOD)
  const fries = lineOf('Fries', FRIES, SIDES)
  addAndSend(t, a, [wings, fries])
  t.send(ev('lines.moved', { to_check_id: b, line_ids: [fries.id] }, { check_id: a }))
  assert.deepEqual(t.orders[a].items.map(i => i.id), [wings.id])
  assert.deepEqual(t.orders[b].items.map(i => i.id), [fries.id])
  t.send(ev('check.merged', { into_check_id: b }, { check_id: a }))
  assert.equal(t.orders[a].status, 'merged')
  assert.equal(t.orders[b].items.length, 2)
})

function memoryStore(kitchen) {
  const s = { events: new Map(), rejections: new Map(), checks: new Map(), orders: new Map(), log: [], state: { last_seq: 0, next_check_no: 1, next_order_no: 1, day: null }, days: [] }
  let queue = Promise.resolve()
  return {
    data: s,
    run: (_v, fn) => (queue = queue.then(fn, fn)),
    findEvent: id => s.events.get(id) || null,
    findRejection: id => s.rejections.get(id) || null,
    context: () => ({ staffById, print: { routes: [] }, settings: {}, timezone: 'Europe/London', kitchen }),
    venueState: () => ({ ...s.state }),
    openDay: ({ business_date }) => { const d = { id: uuid(), business_date }; s.days.push(d); s.state.day = d; return d },
    loadChecks: ids => Object.fromEntries(ids.filter(id => s.checks.has(id)).map(id => [id, s.checks.get(id)])),
    openCheckCount: () => 0,
    saveEvent: e => { s.events.set(e.id, e) },
    saveChecks: changed => { for (const [id, c] of Object.entries(changed)) s.checks.set(id, c) },
    saveJobs: () => {},
    saveRejection: (e, error, code) => { s.rejections.set(e.id, { error, code }) },
    saveVenueState: v => { Object.assign(s.state, v) },
    closeDay: () => {},
    loadKitchenOrders: ids => Object.fromEntries(ids.filter(id => s.orders.has(id)).map(id => [id, s.orders.get(id)])),
    saveKitchenOrders: changed => { for (const [id, o] of Object.entries(changed)) s.orders.set(id, o) },
    saveKitchenLog: rows => { s.log.push(...rows) },
  }
}

test('sequencer: till events build the kitchen, kitchen events need no staff or trading day, refused when no stations', async () => {
  const store = memoryStore(withExpo)
  const seq = createSequencer(store)
  const bump = kev('kitchen.bumped', { order_id: ulid(), station_id: GRILL })
  const missing = await seq.submit(bump)
  assert.equal(missing.code, 'missing')
  assert.equal(store.data.days.length, 0, 'a kitchen event doesn\'t open a trading day')

  const c = ulid()
  await seq.submit(ev('check.opened', { mode: 'table', table_id: TABLE5 }, { check_id: c }))
  const l = lineOf('Wings', WINGS, FOOD)
  await seq.submit(ev('line.added', { line: l }, { check_id: c }))
  const sent = await seq.submit(ev('lines.sent', { send_id: ulid(), line_ids: [l.id] }, { check_id: c }))
  assert.ok(sent.kitchen[c])
  assert.equal(store.data.orders.get(c).items.length, 1)
  const b = await seq.submit(kev('kitchen.bumped', { order_id: c, station_id: GRILL }))
  assert.ok(b.ok, b.error)
  assert.equal(store.data.log.length, 1)
  const again = await seq.submit(kev('kitchen.bumped', { order_id: c, station_id: GRILL }))
  assert.equal(again.code, 'nothing')

  const off = createSequencer(memoryStore({ ...withExpo, enabled: false }))
  const r = await off.submit(kev('kitchen.bumped', { order_id: c, station_id: GRILL }))
  assert.equal(r.code, 'kitchen_off')
})
