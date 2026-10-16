// Kitchen screen (KDS) tests: kitchen orders made from till events, the
// kitchen flow (prep stations passing dishes on, expos, runners and order
// ready boards), bump / recall / remake / priority / collected, online orders,
// what each station shows, on-order counts, speed figures, and the sequencer
// storing it all (in-memory store, as the hub's will be).
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent } from '../checks.js'
import { createSequencer } from '../sequencer.js'
import {
  kitchenForCheckEvent, applyKitchenEvent, stationTickets, onOrderCounts, stationStats, boardNumbers,
  laterOrders, recentBumps, itemState, ageTone, clockSince, kitchenEventProblem, onlineOrderId,
  itemRoute, routeOrder, flowProblems, flowWarnings, readyOrders, boardState, itemWhere, START,
} from '../kitchen.js'

const uuid = () => globalThis.crypto.randomUUID()

const VENUE = uuid()
const ANNA = uuid()
const staffById = { [ANNA]: { id: ANNA, name: 'Anna', permissions: { void: true, transfer: true, discount_max_pct: 0 } } }
const FOOD = uuid(), DRINKS = uuid(), SIDES = uuid(), BURGERS = uuid(), WINGSEC = uuid()
const STARTERS = uuid(), MAINS = uuid()
const RC_REST = uuid(), RC_TAKEAWAY = uuid()
const EAT = uuid(), OUT = uuid(), DEL = uuid(), COL = uuid()
const TABLE5 = uuid()
const WINGS = uuid(), BONELESS = uuid(), FRIES = uuid(), COLA = uuid(), MEAL = uuid(), BURGER = uuid()
const LEMON = uuid()

const link = (from, to, ...targets) => ({ id: uuid(), from, to, targets: targets.map(([kind, id]) => ({ kind, id })) })
const byId = list => Object.fromEntries(list.map(s => [s.id, s]))
const common = {
  enabled: true,
  courses: { [STARTERS]: { name: 'Starters', sort_order: 1 }, [MAINS]: { name: 'Mains', sort_order: 2 } },
  tables: { [TABLE5]: { label: '5' } },
  staff: { [ANNA]: { name: 'Anna' } },
  order_types: { [EAT]: { name: 'Eat in' }, [OUT]: { name: 'Take out' }, [DEL]: { name: 'Delivery' }, [COL]: { name: 'Collection' } },
}

// A simple kitchen: grill, fryer and bar, with or without a pass.
const GRILL = uuid(), FRYER = uuid(), BAR = uuid(), PASS = uuid()
const simple = {
  GRILL: { id: GRILL, name: 'Grill', kind: 'prep', settings: { target_mins: 5, late_mins: 10 } },
  FRYER: { id: FRYER, name: 'Fryer', kind: 'prep', settings: {} },
  BAR: { id: BAR, name: 'Bar', kind: 'prep', settings: {} },
  PASS: { id: PASS, name: 'Pass', kind: 'expo', settings: {} },
}
const startLinks = [link(null, GRILL), link(null, BAR, ['section', DRINKS]), link(null, FRYER, ['section', SIDES])]
const withExpo = {
  ...common,
  stations: byId(Object.values(simple)),
  flow: [...startLinks, link(GRILL, PASS), link(FRYER, PASS), link(BAR, PASS)],
}
const noExpo = { ...common, stations: byId([simple.GRILL, simple.FRYER, simple.BAR]), flow: startLinks }

// The flow from the brief: Prep 1 and Prep 2 bump to Expo 1, Prep 3 to Expo 2,
// ORB 1 shows orders once both expos are done. Burgers go Prep 1 (bun) >
// Prep 2 (protein) > Expo 1; fries go Prep 1 > Expo 1.
const P1 = uuid(), P2 = uuid(), P3 = uuid(), E1 = uuid(), E2 = uuid(), ORB = uuid(), RUN = uuid()
const kit = {
  P1: { id: P1, name: 'Prep 1', kind: 'prep', settings: {} },
  P2: { id: P2, name: 'Prep 2', kind: 'prep', settings: {} },
  P3: { id: P3, name: 'Prep 3', kind: 'prep', settings: {} },
  E1: { id: E1, name: 'Expo 1', kind: 'expo', settings: {} },
  E2: { id: E2, name: 'Expo 2', kind: 'expo', settings: {} },
  ORB: { id: ORB, name: 'ORB 1', kind: 'board', settings: {} },
  RUN: { id: RUN, name: 'Runner', kind: 'runner', settings: {} },
}
const flowBase = [
  link(null, P1, ['section', BURGERS], ['section', SIDES]),
  link(null, P3, ['section', WINGSEC]),
  link(P1, P2, ['section', BURGERS]),
  link(P1, E1),
  link(P2, E1),
  link(P3, E2),
  link(E2, ORB),
]
const kitchen = extra => ({ ...common, stations: byId(Object.values(kit)), flow: [...flowBase, ...extra] })
const brief = kitchen([link(E1, ORB)])

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
const burger = () => lineOf('Burger', BURGER, BURGERS)
const fries = () => lineOf('Fries', FRIES, SIDES)
const wings = () => lineOf('Wings', WINGS, WINGSEC)

/** Run check events through the check rules and the kitchen, like the sequencer does. */
function till(cfg) {
  let checks = {}
  let orders = {}
  return {
    cfg,
    get checks() { return checks },
    get orders() { return orders },
    send(e) {
      const before = checks
      const r = ok(applyEvent(checks, e, { staffById }))
      checks = { ...checks, ...r.checks }
      const k = kitchenForCheckEvent(e, before, r.checks, orders, this.cfg)
      orders = { ...orders, ...k }
      return k
    },
    kitchen(e) {
      const r = applyKitchenEvent(orders, e, this.cfg)
      if (r.ok) orders = { ...orders, ...r.orders }
      return r
    },
    tickets(station) { return stationTickets(orders, station, at(), this.cfg) },
    bump(orderId, station) { return this.kitchen(kev('kitchen.bumped', { order_id: orderId, station_id: station.id })) },
  }
}

function openTable(t, extra = {}) {
  const id = ulid()
  t.send({ ...ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC_REST, order_type_id: EAT, ...extra }, { check_id: id }), assigned: { number: 12 } })
  return id
}
function openCounter(t, orderNo = 57) {
  const id = ulid()
  t.send({ ...ev('check.opened', { mode: 'counter', revenue_stream_id: RC_TAKEAWAY, order_type_id: OUT, tent: '14' }, { check_id: id }), assigned: { number: 3, order_no: orderNo } })
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

test('flow: each dish takes the most specific links from each station', () => {
  assert.deepEqual(itemRoute({ item_id: BURGER, section_id: BURGERS }, brief),
    { [P1]: [START], [P2]: [P1], [E1]: [P2], [ORB]: [E1] })
  assert.deepEqual(itemRoute({ item_id: FRIES, section_id: SIDES }, brief),
    { [P1]: [START], [E1]: [P1], [ORB]: [E1] })
  assert.deepEqual(itemRoute({ item_id: WINGS, section_id: WINGSEC }, brief),
    { [P3]: [START], [E2]: [P3], [ORB]: [E2] })
  assert.deepEqual(itemRoute({ item_id: COLA, section_id: DRINKS }, brief), {}, 'no link takes drinks: not a kitchen dish')
  assert.deepEqual(routeOrder(itemRoute({ section_id: BURGERS }, brief)), [P1, P2, E1, ORB])
  // A dish link beats a section link: this burger skips Prep 2.
  const plain = kitchen([link(E1, ORB), link(P1, E1, ['item', BURGER])])
  assert.deepEqual(Object.keys(itemRoute({ item_id: BURGER, section_id: BURGERS }, plain)).sort(), [P1, E1, ORB].sort())
  // Order type: eat in to the runner, everything else to the board.
  const byType = kitchen([link(E1, RUN, ['order_type', EAT]), link(E1, ORB)])
  assert.ok(itemRoute({ section_id: SIDES, order_type_id: EAT }, byType)[RUN])
  assert.equal(itemRoute({ section_id: SIDES, order_type_id: EAT }, byType)[ORB], undefined)
  assert.ok(itemRoute({ section_id: SIDES, order_type_id: OUT }, byType)[ORB])
  // Links with the same filter both apply: expo to the board and the runner at once.
  const both = kitchen([link(E1, ORB), link(E1, RUN)])
  const r = itemRoute({ section_id: SIDES }, both)
  assert.deepEqual([r[ORB], r[RUN]], [[E1], [E1]])
})

test('flow problems block saving; warnings point out loose ends', () => {
  const list = Object.values(kit)
  const flowOnly = flowBase.concat(link(E1, ORB))
  assert.deepEqual(flowProblems(list, flowOnly), [])
  assert.match(flowProblems(list, [link(P1, P1)]).join(), /links to itself/)
  assert.match(flowProblems(list, [link(ORB, E1)]).join(), /order ready board/)
  assert.match(flowProblems(list, [link(P1, E1), link(P1, E1)]).join(), /twice/)
  assert.match(flowProblems(list, [link(P1, P2), link(P2, E1), link(E1, P1)]).join(), /Prep 1 > Prep 2 > Expo 1 > Prep 1 goes round in a circle/)
  assert.match(flowProblems(list, [link(P1, uuid())]).join(), /isn't there/)
  const w = flowWarnings(list, [link(P1, E1)])
  assert.ok(w.some(x => /Nothing comes in/.test(x)))
  assert.ok(w.includes('Prep 3 isn\'t on the way of any dish.'))
  assert.ok(!flowWarnings(list, flowOnly.concat(link(E1, RUN))).length)
})

test('the brief: preps pass dishes on, two expos, ORB 1 ready once both expos are done', () => {
  const t = till(brief)
  const c = openCounter(t, 41)
  const b = burger(), f = fries(), w = wings(), cola = lineOf('Cola', COLA, DRINKS)
  addAndSend(t, c, [b, f, w, cola])
  const o = t.orders[c]
  assert.equal(o.type, OUT)
  assert.equal(o.type_name, 'Take out')
  assert.equal(o.tent, '14')

  // Prep 1 makes the bun and the fries; Prep 2 has nothing yet.
  const p1 = t.tickets(kit.P1)
  assert.deepEqual(p1[0].items.map(i => [i.name, i.state, i.next]), [['Burger', 'active', [P2]], ['Fries', 'active', [E1]]])
  assert.equal(t.tickets(kit.P2).length, 0)
  assert.equal(t.tickets(kit.P3)[0].items[0].name, 'Wings')
  // Expo 1 sees the order coming (dishes still at Prep 1), and that the wings go to Expo 2.
  const e1 = t.tickets(kit.E1)[0]
  assert.deepEqual(e1.items.map(i => [i.name, i.state, i.where]), [['Burger', 'upcoming', [P1]], ['Fries', 'upcoming', [P1]]])
  assert.deepEqual(e1.elsewhere, [{ station_id: E2, count: 1 }])
  assert.deepEqual(t.tickets(kit.E2)[0].elsewhere, [{ station_id: E1, count: 2 }])
  assert.deepEqual(boardNumbers(t.orders, at(), { boardId: ORB, cfg: brief }).preparing.map(x => x.number), ['41'])

  // Prep 2 can't bump a burger that hasn't left Prep 1.
  const early = t.bump(c, kit.P2)
  assert.equal(early.code, 'upcoming')
  assert.match(early.error, /Still at Prep 1/)

  ok(t.bump(c, kit.P1))
  const p2 = t.tickets(kit.P2)[0].items
  assert.deepEqual(p2.map(i => [i.name, i.state, i.from, i.next]), [['Burger', 'active', [P1], [E1]]])
  assert.deepEqual(t.tickets(kit.E1)[0].items.map(i => [i.name, i.state]), [['Burger', 'upcoming'], ['Fries', 'active']])
  assert.deepEqual(itemWhere(t.orders[c].items[0], brief, at()), [P2])

  ok(t.bump(c, kit.P2))
  assert.deepEqual(t.tickets(kit.E1)[0].items.map(i => i.state), ['active', 'active'])
  ok(t.bump(c, kit.E1))
  assert.equal(t.orders[c].status, 'active', 'the wings are still to come')
  assert.equal(boardState(t.orders[c], ORB, brief, at()).state, 'preparing')
  ok(t.bump(c, kit.P3))
  ok(t.bump(c, kit.E2))
  assert.equal(t.orders[c].status, 'ready')
  assert.deepEqual(boardNumbers(t.orders, at(), { boardId: ORB, cfg: brief }).ready.map(x => x.number), ['41'])
  assert.equal(t.tickets(kit.E1).length, 0)
  assert.deepEqual(readyOrders(t.orders, kit.E1, at()).map(x => x.id), [c])
  ok(t.kitchen(kev('kitchen.collected', { order_id: c })))
  assert.equal(t.orders[c].status, 'collected')
  assert.equal(boardNumbers(t.orders, at(), { boardId: ORB, cfg: brief }).ready.length, 0)
})

test('the expo can bump dishes still at the preps (finishing them there); recall puts them back', () => {
  const t = till(brief)
  const c = openCounter(t, 42)
  const b = burger()
  addAndSend(t, c, [b])
  const r = ok(t.bump(c, kit.E1))
  assert.equal(r.log[0].items, 1)
  assert.equal(t.tickets(kit.P1).length, 0)
  assert.equal(t.orders[c].status, 'ready')
  const set = t.orders[c].bumps[0].set.map(([, n]) => n).sort()
  assert.deepEqual(set, [P1, P2, E1].sort())
  ok(t.kitchen(kev('kitchen.recalled', { order_id: c, station_id: E1 })))
  assert.equal(t.orders[c].status, 'active')
  assert.equal(t.tickets(kit.P1)[0].items[0].state, 'active')

  // A dish done by hand at the expo does the same.
  ok(t.kitchen(kev('kitchen.item_done', { order_id: c, station_id: E1, item_id: b.id, done: true })))
  assert.equal(t.orders[c].status, 'ready')

  // A prep station never finishes dishes for an earlier one, even when it shows them.
  const shows = { ...brief, stations: { ...brief.stations, [P2]: { ...kit.P2, settings: { show_upcoming: true } } } }
  const t2 = till(shows)
  const c2 = openCounter(t2, 43)
  const b2 = burger()
  addAndSend(t2, c2, [b2])
  assert.equal(t2.tickets(shows.stations[P2])[0].items[0].state, 'upcoming')
  assert.equal(t2.bump(c2, shows.stations[P2]).code, 'upcoming')
  assert.equal(t2.kitchen(kev('kitchen.item_done', { order_id: c2, station_id: P2, item_id: b2.id, done: true })).code, 'upcoming')
})

test('bringing back or undoing a dish another station has already done is refused', () => {
  const t = till(brief)
  const c = openCounter(t, 44)
  const b = burger()
  addAndSend(t, c, [b])
  ok(t.bump(c, kit.P1))
  ok(t.bump(c, kit.P2))
  const undo = t.kitchen(kev('kitchen.item_done', { order_id: c, station_id: P1, item_id: b.id, done: false }))
  assert.equal(undo.code, 'moved_on')
  const back = t.kitchen(kev('kitchen.recalled', { order_id: c, station_id: P1 }))
  assert.equal(back.code, 'moved_on')
  assert.match(back.error, /Prep 2/)
  ok(t.kitchen(kev('kitchen.recalled', { order_id: c, station_id: P2 })))
  assert.equal(t.tickets(kit.P2)[0].items[0].state, 'active')
  // Fries and burger bumped together at Prep 1, then the burger moves on: only the fries come back.
  const c2 = openCounter(t, 45)
  const b2 = burger(), f2 = fries()
  addAndSend(t, c2, [b2, f2])
  ok(t.bump(c2, kit.P1))
  ok(t.bump(c2, kit.P2))
  ok(t.kitchen(kev('kitchen.recalled', { order_id: c2, station_id: P1 })))
  assert.deepEqual(t.tickets(kit.P1).find(x => x.order.id === c2).items.filter(i => i.state === 'active').map(i => i.name), ['Fries'])
})

test('remake: from a prep station it goes back there; from the expo it starts again', () => {
  const t = till(brief)
  const c = openCounter(t, 46)
  const b = burger()
  addAndSend(t, c, [b])
  ok(t.bump(c, kit.P1))
  ok(t.bump(c, kit.P2))
  ok(t.bump(c, kit.E1))
  assert.equal(t.orders[c].status, 'ready')
  clock += 60_000
  const rm = ok(t.kitchen(kev('kitchen.remake', { order_id: c, station_id: P2, item_id: b.id, reason: 'Underdone' })))
  assert.equal(rm.log[0].kind, 'remake')
  assert.equal(t.orders[c].status, 'active')
  assert.equal(t.tickets(kit.P1).length, 0, 'the bun stays done')
  const p2 = t.tickets(kit.P2)[0]
  assert.equal(p2.items[0].state, 'active')
  assert.equal(p2.since, at(), 'its timer starts again')
  assert.equal(t.tickets(kit.E1)[0].items[0].state, 'upcoming')
  ok(t.kitchen(kev('kitchen.remake', { order_id: c, station_id: E1, item_id: b.id, reason: 'Dropped' })))
  assert.equal(t.tickets(kit.P1)[0].items[0].state, 'active')
  assert.equal(t.orders[c].items[0].remakes, 2)
})

test('runner: beside the board, between the expo and the board, or for eat in only', () => {
  // Expo 1 to ORB 1 and the runner at once: ready on the board, gone once the runner takes it.
  const both = kitchen([link(E1, ORB), link(E1, RUN)])
  let t = till(both)
  let c = openTable(t)
  addAndSend(t, c, [fries()])
  assert.equal(t.tickets(kit.RUN).length, 0, 'the runner sees orders once the expo is done')
  ok(t.bump(c, kit.P1))
  ok(t.bump(c, kit.E1))
  assert.equal(t.orders[c].status, 'ready')
  assert.equal(t.tickets(kit.RUN)[0].items[0].state, 'active')
  assert.deepEqual(readyOrders(t.orders, kit.RUN, at()).map(x => x.id), [c])
  ok(t.bump(c, kit.RUN))
  assert.equal(t.orders[c].status, 'collected', 'the runner handed it over')

  // Expo 1 > runner > ORB 1: ready once the runner brings it to the counter.
  const chain = kitchen([link(E1, RUN), link(RUN, ORB)])
  t = till(chain)
  c = openCounter(t, 47)
  addAndSend(t, c, [fries()])
  ok(t.bump(c, kit.P1))
  ok(t.bump(c, kit.E1))
  assert.equal(t.orders[c].status, 'active')
  assert.equal(boardState(t.orders[c], ORB, chain, at()).state, 'preparing')
  ok(t.bump(c, kit.RUN))
  assert.equal(t.orders[c].status, 'ready')
  assert.deepEqual(boardNumbers(t.orders, at(), { boardId: ORB, cfg: chain }).ready.map(x => x.number), ['47'])
  ok(t.kitchen(kev('kitchen.collected', { order_id: c })))

  // By order type: eat in to the runner, takeaway to the board.
  const byType = kitchen([link(E1, RUN, ['order_type', EAT]), link(E1, ORB)])
  t = till(byType)
  const table = openTable(t)
  const counter = openCounter(t, 48)
  addAndSend(t, table, [fries()])
  addAndSend(t, counter, [fries()])
  for (const id of [table, counter]) { ok(t.bump(id, kit.P1)); ok(t.bump(id, kit.E1)) }
  assert.deepEqual(t.tickets(kit.RUN).map(x => x.order.id), [table])
  assert.deepEqual(boardNumbers(t.orders, at(), { boardId: ORB, cfg: byType }).ready.map(x => x.number), ['48'])
  ok(t.bump(table, kit.RUN))
  assert.equal(t.orders[table].status, 'collected')
  assert.equal(t.orders[counter].status, 'ready')
})

test('a station taken out of the flow is passed straight through', () => {
  const t = till(brief)
  const c = openCounter(t, 49)
  addAndSend(t, c, [burger()])
  const { [P2]: _gone, ...rest } = brief.stations
  t.cfg = { ...brief, stations: rest, flow: brief.flow.filter(l => l.from !== P2 && l.to !== P2) }
  ok(t.bump(c, kit.P1))
  assert.equal(t.tickets(kit.E1)[0].items[0].state, 'active')
})

test('voids show at the stations that have seen the dish', () => {
  const t = till(brief)
  const c = openCounter(t, 50)
  const b = burger(), f = fries(), w = wings()
  addAndSend(t, c, [b, f, w])
  t.send(ev('line.voided', { line_id: f.id, reason: 'Changed order' }, { check_id: c }))
  t.send(ev('line.voided', { line_id: b.id, reason: 'Changed order' }, { check_id: c }))
  assert.equal(t.tickets(kit.P1)[0].voids, 2)
  assert.equal(t.tickets(kit.E1)[0].voids, 2, 'the expo shows dishes before they arrive')
  assert.equal(t.tickets(kit.P2).length, 0, 'Prep 2 never had the burger')
  ok(t.bump(c, kit.P1))
  assert.equal(t.tickets(kit.P1).length, 0)
})

test('sending dishes makes a kitchen order: meal deal parts split by station, held course waits', () => {
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
  assert.equal(o.type, EAT)
  assert.equal(o.items.length, 3)
  const item = id => o.items.find(i => i.id === id)
  assert.deepEqual(Object.keys(item(deal.id).route).sort(), [GRILL, FRYER, PASS].sort())
  assert.deepEqual(item(deal.id).route[PASS].sort(), [GRILL, FRYER].sort())
  assert.deepEqual(Object.keys(item(cola.id).route).sort(), [BAR, PASS].sort())
  assert.equal(itemState(item(steak.id), simple.GRILL, at(), withExpo), 'held')

  // The grill sees the deal (wings part only) and the held mains.
  const grill = t.tickets(simple.GRILL)
  assert.equal(grill.length, 1)
  const gDeal = grill[0].items.find(i => i.id === deal.id)
  assert.deepEqual(gDeal.parts.map(p => p.name), ['8pc Wings'])
  assert.equal(gDeal.parts[0].mods[0].kind, 'base')
  assert.equal(grill[0].held, 1)
  // The fryer sees the fries part, with "No Salt" as a removal.
  const fryer = t.tickets(simple.FRYER)
  assert.deepEqual(fryer[0].items[0].parts.map(p => p.name), ['Fries'])
  assert.equal(fryer[0].items[0].parts[0].mods[0].kind, 'remove')
  // The pass sees everything, the deal with both parts.
  const pass = t.tickets(simple.PASS)[0]
  assert.equal(pass.items.length, 3)
  assert.equal(pass.items.find(i => i.id === deal.id).parts.length, 2)
})

test('bump at each station, the pass marks it ready, recall brings it back', () => {
  const t = till(withExpo)
  const c = openTable(t)
  const w = lineOf('Wings', WINGS, FOOD)
  const cola = lineOf('Cola', COLA, DRINKS)
  addAndSend(t, c, [w, cola])
  clock += 4 * 60_000
  const g = ok(t.bump(c, simple.GRILL))
  assert.equal(g.log.length, 1)
  assert.equal(g.log[0].kind, 'bump')
  assert.ok(g.log[0].seconds >= 240)
  assert.equal(t.tickets(simple.GRILL).length, 0)
  assert.equal(t.tickets(simple.BAR).length, 1)
  assert.equal(t.orders[c].status, 'active')
  assert.equal(t.bump(c, simple.GRILL).code, 'nothing')
  // The pass has the wings, the cola is still at the bar.
  const pass = t.tickets(simple.PASS)[0]
  assert.equal(pass.items.find(i => i.id === w.id).state, 'active')
  assert.equal(pass.items.find(i => i.id === cola.id).state, 'upcoming')
  ok(t.bump(c, simple.PASS))
  assert.equal(t.orders[c].status, 'ready')
  assert.equal(t.tickets(simple.BAR).length, 0)
  assert.equal(t.tickets(simple.PASS).length, 0)
  // Recall at the pass: active again, the cola back on the bar.
  ok(t.kitchen(kev('kitchen.recalled', { order_id: c, station_id: PASS })))
  assert.equal(t.orders[c].status, 'active')
  assert.equal(t.tickets(simple.BAR).length, 1)
  assert.equal(recentBumps(t.orders, simple.GRILL, at()).length, 1)
})

test('without a pass the order is ready once every station is done; dishes done one by one count as the bump', () => {
  const t = till(noExpo)
  const c = openTable(t)
  const w = lineOf('Wings', WINGS, FOOD)
  const f = lineOf('Fries', FRIES, SIDES)
  addAndSend(t, c, [w, f])
  ok(t.bump(c, simple.GRILL))
  assert.equal(t.orders[c].status, 'active')
  const r = ok(t.kitchen(kev('kitchen.item_done', { order_id: c, station_id: FRYER, item_id: f.id, done: true })))
  assert.equal(r.log.length, 1, 'last dish done counts as a bump')
  assert.equal(t.orders[c].status, 'ready')
  ok(t.kitchen(kev('kitchen.item_done', { order_id: c, station_id: FRYER, item_id: f.id, done: false })))
  assert.equal(t.orders[c].status, 'active')
})

test('firing a held course, adding dishes later, voids and partial voids', () => {
  const t = till(noExpo)
  const c = openTable(t)
  const starter = lineOf('Wings', WINGS, FOOD, { course_id: STARTERS })
  const main = lineOf('Boneless', BONELESS, FOOD, { course_id: MAINS, qty: 3 })
  addAndSend(t, c, [starter, main], [MAINS])
  ok(t.bump(c, simple.GRILL))
  assert.equal(t.orders[c].status, 'active', 'the mains are still to come')
  t.send(ev('course.fired', { course_id: MAINS }, { check_id: c }))
  assert.equal(t.orders[c].status, 'active')
  assert.equal(t.tickets(simple.GRILL)[0].items.filter(i => i.state === 'active').length, 1)

  // Two of the three mains voided: the ticket shows 1 to make and the void.
  const newId = ulid()
  t.send(ev('line.voided', { line_id: main.id, qty: 2, new_line_id: newId, reason: 'Changed order' }, { check_id: c }))
  const o = t.orders[c]
  assert.equal(o.items.find(i => i.id === main.id).qty, 1)
  assert.ok(o.items.find(i => i.id === newId).voided_at)
  assert.equal(t.tickets(simple.GRILL)[0].voids, 1)
  const f = lineOf('Fries', FRIES, SIDES)
  addAndSend(t, c, [f])
  assert.equal(t.orders[c].items.find(i => i.id === f.id).added, true)
  ok(t.bump(c, simple.GRILL))
  assert.equal(t.tickets(simple.GRILL).length, 0)
})

test('everything voided cancels the kitchen order', () => {
  const t = till(withExpo)
  const c = openTable(t)
  const w = lineOf('Wings', WINGS, FOOD)
  addAndSend(t, c, [w])
  t.send(ev('line.voided', { line_id: w.id, reason: 'Wrong table' }, { check_id: c }))
  assert.equal(t.orders[c].status, 'cancelled')
})

test('remake puts a dish back, priority, collected, the all-orders board', () => {
  const t = till(withExpo)
  const id = openCounter(t, 57)
  const w = lineOf('Wings', WINGS, FOOD)
  addAndSend(t, id, [w])
  assert.equal(t.orders[id].number, '57')
  assert.equal(t.orders[id].board, true)
  assert.equal(t.orders[id].type, OUT)
  assert.deepEqual(boardNumbers(t.orders, at()).preparing.map(x => x.number), ['57'])
  ok(t.kitchen(kev('kitchen.priority', { order_id: id, on: true })))
  ok(t.bump(id, simple.GRILL))
  ok(t.bump(id, simple.PASS))
  assert.deepEqual(boardNumbers(t.orders, at()).ready.map(x => x.number), ['57'])
  const rm = ok(t.kitchen(kev('kitchen.remake', { order_id: id, station_id: PASS, item_id: w.id, reason: 'Dropped' })))
  assert.equal(rm.log[0].kind, 'remake')
  assert.equal(t.orders[id].status, 'active')
  assert.equal(t.tickets(simple.GRILL).length, 1)
  ok(t.bump(id, simple.GRILL))
  ok(t.bump(id, simple.PASS))
  ok(t.kitchen(kev('kitchen.collected', { order_id: id })))
  assert.equal(t.orders[id].status, 'collected')
  assert.equal(boardNumbers(t.orders, at()).ready.length, 0)
  assert.equal(t.kitchen(kev('kitchen.collected', { order_id: id })).code, 'not_ready')
  assert.equal(t.bump(id, { id: ORB, kind: 'board' }).code, 'station', 'not a station of this kitchen')
})

test('a board has nothing to bump', () => {
  const t = till(brief)
  const c = openCounter(t, 58)
  addAndSend(t, c, [fries()])
  const r = t.bump(c, kit.ORB)
  assert.equal(r.code, 'station')
  assert.match(r.error, /nothing to bump/)
  assert.deepEqual(stationTickets(t.orders, kit.ORB, at(), brief), [])
})

test('online orders: in the kitchen at once, or held until their time; the orders board can cancel', () => {
  const t = till(withExpo)
  const orderId = uuid()
  const now = Date.parse(at())
  const mk = (oid, fire) => kev('kitchen.order_in', { order: {
    id: onlineOrderId(oid), order_id: oid, number: 'W12', guest: 'Sam', type: COL, type_name: 'Collection',
    promised_at: new Date(now + 3600_000).toISOString(), fire_at: fire, note: null, allergy: 'Peanuts',
    items: [{ id: uuid(), item_id: WINGS, section_id: FOOD, name: 'Wings', qty: 2, options: [{ label: 'Lemon Pepper', mode: 'base' }] },
            { id: uuid(), item_id: COLA, section_id: DRINKS, name: 'Cola', qty: 1, options: [] }],
  } })
  ok(t.kitchen(mk(orderId, null)))
  const oid = onlineOrderId(orderId)
  assert.equal(t.orders[oid].source, 'online')
  assert.equal(t.tickets(simple.GRILL).length, 1)
  assert.equal(t.kitchen(mk(orderId, null)).code, 'duplicate')

  const later = uuid()
  const fireAt = new Date(now + 40 * 60_000).toISOString()
  ok(t.kitchen(mk(later, fireAt)))
  assert.equal(t.tickets(simple.GRILL).length, 1, 'the later one waits')
  assert.equal(laterOrders(t.orders, at()).length, 1)
  const then = new Date(now + 41 * 60_000).toISOString()
  assert.equal(stationTickets(t.orders, simple.GRILL, then, withExpo).length, 2, 'and shows once its time comes')

  ok(t.kitchen(kev('kitchen.order_status', { order_id: oid, status: 'ready' })))
  assert.equal(t.orders[oid].status, 'ready')
  assert.equal(t.tickets(simple.BAR).length, 0, 'ready from the orders board finishes every station')
  ok(t.kitchen(kev('kitchen.order_status', { order_id: onlineOrderId(later), status: 'cancelled' })))
  assert.equal(t.orders[onlineOrderId(later)].status, 'cancelled')
  assert.equal(stationTickets(t.orders, simple.GRILL, then, withExpo).length, 0)
})

test('online orders follow the flow by order type', () => {
  const byType = kitchen([link(E1, RUN, ['order_type', EAT]), link(E1, ORB)])
  const t = till(byType)
  const oid = uuid()
  ok(t.kitchen(kev('kitchen.order_in', { order: {
    id: onlineOrderId(oid), order_id: oid, number: 'W13', guest: 'Jo', type: DEL, type_name: 'Delivery',
    items: [{ id: uuid(), item_id: BURGER, section_id: BURGERS, name: 'Burger', qty: 1, options: [] }],
  } })))
  const item = t.orders[onlineOrderId(oid)].items[0]
  assert.deepEqual(routeOrder(item.route), [P1, P2, E1, ORB])
})

test('on-order counts: per dish, or summary groups adding up pieces; the expo counts what is coming', () => {
  const t = till(noExpo)
  const c = openTable(t)
  addAndSend(t, c, [
    lineOf('8pc Boneless', BONELESS, FOOD, { qty: 2 }),
    lineOf('Wings', WINGS, FOOD, { modifiers: [{ label: '6 Lemon Pepper Wings', base: true, price: 0 }] }),
  ])
  const plain = onOrderCounts(t.orders, simple.GRILL, at(), noExpo)
  assert.deepEqual(plain.map(x => [x.name, x.count]), [['8pc Boneless', 2], ['Wings', 1]])
  const grouped = { ...simple.GRILL, settings: { summary_groups: [
    { id: 'b', name: 'Boneless', members: [{ kind: 'dish', id: BONELESS, label: '8pc Boneless', qty: 8 }] },
    { id: 'w', name: 'Wings', members: [{ kind: 'option', label: '6 Lemon Pepper Wings', qty: 6 }] },
    { id: 't', name: 'Tenders', members: [] },
  ] } }
  assert.deepEqual(onOrderCounts(t.orders, grouped, at(), noExpo).map(x => [x.name, x.count]), [['Boneless', 16], ['Wings', 6], ['Tenders', 0]])

  const t2 = till(brief)
  const c2 = openCounter(t2, 60)
  addAndSend(t2, c2, [burger(), fries()])
  assert.deepEqual(onOrderCounts(t2.orders, kit.E1, at(), brief).map(x => [x.name, x.count]), [['Burger', 1], ['Fries', 1]])
  assert.deepEqual(onOrderCounts(t2.orders, kit.P2, at(), brief).map(x => x.name), ['Burger'])
})

test('speed figures and ticket colours; prep timers start when the dish arrives', () => {
  const t = till(noExpo)
  for (const mins of [2, 6]) {
    const c = openTable(t)
    addAndSend(t, c, [lineOf('Wings', WINGS, FOOD)])
    clock += mins * 60_000
    ok(t.bump(c, simple.GRILL))
  }
  const s = stationStats(t.orders, simple.GRILL)
  assert.equal(s.done, 2)
  assert.equal(s.on_time_pct, 50, 'target 5 minutes: one of two on time')
  const since = new Date(clock - 7 * 60_000).toISOString()
  assert.equal(ageTone(since, at(), simple.GRILL), 'warn')
  assert.equal(ageTone(new Date(clock - 11 * 60_000).toISOString(), at(), simple.GRILL), 'late')
  assert.equal(clockSince(new Date(clock - 65_000).toISOString(), at()), '1:05')

  const t2 = till(brief)
  const c2 = openCounter(t2, 61)
  addAndSend(t2, c2, [burger()])
  clock += 5 * 60_000
  ok(t2.bump(c2, kit.P1))
  clock += 2 * 60_000
  const r = ok(t2.bump(c2, kit.P2))
  assert.ok(r.log[0].seconds >= 120 && r.log[0].seconds < 180, 'Prep 2 counts from when the bun reached it')
  const e = ok(t2.bump(c2, kit.E1))
  assert.ok(e.log[0].seconds >= 420, 'the expo counts from when the order came in')
})

test('moving dishes and merging checks moves them in the kitchen', () => {
  const t = till(noExpo)
  const a = openTable(t)
  const b = openTable(t)
  const w = lineOf('Wings', WINGS, FOOD)
  const f = lineOf('Fries', FRIES, SIDES)
  addAndSend(t, a, [w, f])
  t.send(ev('lines.moved', { to_check_id: b, line_ids: [f.id] }, { check_id: a }))
  assert.deepEqual(t.orders[a].items.map(i => i.id), [w.id])
  assert.deepEqual(t.orders[b].items.map(i => i.id), [f.id])
  t.send(ev('check.merged', { into_check_id: b }, { check_id: a }))
  assert.equal(t.orders[a].status, 'merged')
  assert.equal(t.orders[b].items.length, 2)
})

function memoryStore(kitchenCfg) {
  const s = { events: new Map(), rejections: new Map(), checks: new Map(), orders: new Map(), log: [], state: { last_seq: 0, next_check_no: 1, next_order_no: 1, day: null }, days: [] }
  let queue = Promise.resolve()
  return {
    data: s,
    run: (_v, fn) => (queue = queue.then(fn, fn)),
    findEvent: id => s.events.get(id) || null,
    findRejection: id => s.rejections.get(id) || null,
    context: () => ({ staffById, print: { routes: [] }, settings: {}, timezone: 'Europe/London', kitchen: kitchenCfg }),
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
  const missing = await seq.submit(kev('kitchen.bumped', { order_id: ulid(), station_id: GRILL }))
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
