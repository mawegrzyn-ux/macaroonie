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
  laterOrders, recentBumps, itemState, ageTone, clockSince, kitchenEventProblem, onlineOrderId, gloriaFoodOrderId, isOrderId,
  itemRoute, routeOrder, flowProblems, flowWarnings, readyOrders, boardState, itemWhere, START,
  resolveBalances, stationLoad, orderStatus, statusOf, STATUS_LOOKS, STATUS_ANIMS, linkRank, isExcept,
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

// A link set to All except these (exclude, migration 204).
const except = (from, to, ...targets) => ({ ...link(from, to, ...targets), exclude: true })

test('flow: a link set to Except takes every dish its filter doesn\'t name', () => {
  const cfg = flow => ({ ...common, stations: byId(Object.values(kit)), flow })
  const burgerT = { item_id: BURGER, section_id: BURGERS, order_type_id: EAT }
  const colaT = { item_id: COLA, section_id: DRINKS, order_type_id: EAT }
  const one = cfg([except(null, P1, ['section', DRINKS]), link(P1, E1)])
  assert.deepEqual(itemRoute(burgerT, one), { [P1]: [START], [E1]: [P1] })
  assert.deepEqual(itemRoute(colaT, one), {}, 'drinks are left out')
  // Any entry leaves a dish out: drinks, and every delivery order.
  const two = cfg([except(null, P1, ['section', DRINKS], ['order_type', DEL])])
  assert.deepEqual(itemRoute({ ...burgerT, order_type_id: DEL }, two), {})
  assert.deepEqual(Object.keys(itemRoute(burgerT, two)), [P1])
  // The same entries without Except: only drinks and deliveries.
  assert.deepEqual(Object.keys(itemRoute(colaT, cfg([link(null, P1, ['section', DRINKS], ['order_type', DEL])]))), [P1])
  assert.deepEqual(itemRoute(burgerT, cfg([link(null, P1, ['section', DRINKS], ['order_type', DEL])])), {})

  // A link whose filter names the dish takes it first: wings go to Prep 3 only.
  const named = cfg([except(null, P1, ['section', DRINKS]), link(null, P3, ['section', WINGSEC])])
  assert.deepEqual(Object.keys(itemRoute({ item_id: WINGS, section_id: WINGSEC }, named)), [P3])
  assert.deepEqual(Object.keys(itemRoute(burgerT, named)), [P1])
  // An Except link comes before a link for every dish, which takes what it leaves out.
  const rest = cfg([except(null, P1, ['section', DRINKS]), link(null, P2)])
  assert.deepEqual(Object.keys(itemRoute(burgerT, rest)), [P1])
  assert.deepEqual(Object.keys(itemRoute(colaT, rest)), [P2])
  // Two Except links rank the same: a dish neither leaves out takes both.
  const pair = cfg([except(null, P1, ['section', DRINKS]), except(null, P2, ['section', SIDES])])
  assert.deepEqual(Object.keys(itemRoute(burgerT, pair)).sort(), [P1, P2].sort())
  assert.deepEqual(Object.keys(itemRoute({ item_id: FRIES, section_id: SIDES }, pair)), [P1])
  assert.deepEqual(Object.keys(itemRoute(colaT, pair)), [P2])

  // Ranks: a filter naming the dish < Except < every dish; Except with nothing listed is every dish.
  const exceptLink = except(null, P1, ['section', DRINKS])
  assert.ok(linkRank(link(null, P1, ['order_type', EAT]), burgerT) < linkRank(exceptLink, burgerT))
  assert.ok(linkRank(exceptLink, burgerT) < linkRank(link(null, P1), burgerT))
  assert.equal(linkRank(exceptLink, colaT), Infinity)
  assert.equal(linkRank({ targets: [], exclude: true }, colaT), linkRank(link(null, P1), colaT))
  assert.equal(isExcept({ targets: [], exclude: true }), false)
  assert.equal(isExcept(exceptLink), true)

  // Links out of a Splitter can't be Except either; nor can Except leave out every dish.
  const list = Object.values(kit)
  assert.deepEqual(flowProblems(list, [except(null, P1, ['section', DRINKS]), link(P1, E1)]), [])
  assert.match(flowProblems(list, [{ ...link(null, P1), targets: [{ kind: 'default' }], exclude: true }]).join(), /can't leave out every dish/)
  const box = { id: uuid(), name: 'Wing box', kind: 'balance' }
  assert.match(flowProblems([...list, box], [link(null, box.id), except(box.id, P1, ['section', DRINKS]), link(box.id, P2)]).join(), /remove their filters/)
})

test('a till order through an Except link: the cola never reaches the grill', () => {
  const cfg = { ...common, stations: byId(Object.values(simple)), flow: [except(null, GRILL, ['section', DRINKS]), link(null, BAR, ['section', DRINKS]), link(GRILL, PASS), link(BAR, PASS)] }
  const t = till(cfg)
  const c = openTable(t)
  addAndSend(t, c, [burger(), lineOf('Cola', COLA, DRINKS)])
  assert.deepEqual(t.tickets(simple.GRILL)[0].items.map(i => i.name), ['Burger'])
  assert.deepEqual(t.tickets(simple.BAR)[0].items.map(i => i.name), ['Cola'])
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
  const tile = boardNumbers(t.orders, at()).preparing[0]
  assert.equal(tile.tent, '14', 'a board number carries the tent')
  assert.equal(tile.type_name, t.orders[id].type_name)
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

test('GloriaFood orders: their own id and source, a table, dishes without menu ids go by the default links', () => {
  const t = till(withExpo)
  const gid = uuid()
  const kid = gloriaFoodOrderId(gid)
  assert.ok(isOrderId(kid))
  ok(t.kitchen(kev('kitchen.order_in', { order: {
    id: kid, order_id: gid, number: '776113', guest: 'Ann', table: '7', type: EAT, type_name: 'Eat in',
    items: [{ id: '0', item_id: null, section_id: null, name: 'Pad Thai', qty: 1, options: [{ label: 'Chicken' }] }],
  } })))
  const o = t.orders[kid]
  assert.equal(o.source, 'gloriafood')
  assert.equal(o.table, '7')
  assert.equal(o.order_id, gid)
  assert.equal(stationTickets(t.orders, simple.GRILL, at(), withExpo).length, 1, 'no dish id: the default links')
  ok(t.kitchen(kev('kitchen.bumped', { order_id: kid, station_id: simple.GRILL.id })))
  ok(t.kitchen(kev('kitchen.order_status', { order_id: kid, status: 'cancelled' })))
  assert.equal(t.orders[kid].status, 'cancelled')
  // A till check id can't pose as a server-made order.
  assert.match(kitchenEventProblem(kev('kitchen.order_in', { order: { id: uuid(), order_id: gid, number: '1', items: [{ id: '0', name: 'X', qty: 1 }] } })), /order\.id/)
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

test('combos: each station shows the combo name with its own picks; a typed-in pick goes with the combo', () => {
  const t = till(noExpo)
  const c = openTable(t)
  // The combo sits in Drinks, so a typed-in choice (no dish) goes to the bar with it.
  const meal = lineOf('Burger meal', MEAL, DRINKS, {
    combo: [
      { step: 'Main', item_id: BURGER, section_id: FOOD, name: 'Burger', modifiers: [{ label: 'Cheese', price: 100, depth: 0 }], upcharge: 0 },
      { step: 'Side', item_id: FRIES, section_id: SIDES, name: 'Fries', modifiers: [], upcharge: 0 },
      { step: 'Drink', item_id: COLA, section_id: DRINKS, name: 'Cola', modifiers: [], upcharge: 0 },
      { step: 'Toy', item_id: null, section_id: null, name: 'Surprise toy', kitchen_name: 'TOY', modifiers: [], upcharge: 0, custom: true },
    ],
  })
  addAndSend(t, c, [meal])
  const names = st => t.tickets(st).flatMap(tk => tk.items.map(i => [i.name, i.parts.map(p => p.name)]))
  assert.deepEqual(names(simple.GRILL), [['Burger meal', ['Burger']]])
  assert.deepEqual(names(simple.FRYER), [['Burger meal', ['Fries']]])
  assert.deepEqual(names(simple.BAR), [['Burger meal', ['Cola', 'TOY']]])
  assert.equal(t.tickets(simple.GRILL)[0].items[0].parts[0].mods[0].text, 'Cheese')
})

test('combos from online orders: picks go to their own stations', () => {
  const t = till(noExpo)
  const orderId = uuid()
  ok(t.kitchen(kev('kitchen.order_in', { order: {
    id: onlineOrderId(orderId), order_id: orderId, number: 'W7', guest: 'Sam', type: COL, type_name: 'Collection',
    promised_at: null, fire_at: null, note: null, allergy: null,
    items: [{ id: uuid(), item_id: MEAL, section_id: DRINKS, name: 'Burger meal', qty: 1, options: [], parts: [
      { name: 'Burger', item_id: BURGER, section_id: FOOD, options: [{ label: 'Bacon', mode: 'extra' }] },
      { name: 'Fries', item_id: FRIES, section_id: SIDES, options: [] },
      { name: 'Ketchup pot', item_id: null, section_id: null, options: [] },
    ] }],
  } })))
  const parts = st => t.tickets(st).flatMap(tk => tk.items.flatMap(i => i.parts.map(p => p.name)))
  assert.deepEqual(parts(simple.GRILL), ['Burger'])
  assert.deepEqual(parts(simple.FRYER), ['Fries'])
  assert.deepEqual(parts(simple.BAR), ['Ketchup pot'])
  assert.equal(t.tickets(simple.GRILL)[0].items[0].parts[0].mods[0].text, 'Bacon')
  // A bad part is refused.
  const bad = kitchenEventProblem(kev('kitchen.order_in', { order: {
    id: onlineOrderId(uuid()), order_id: uuid(), number: '1', items: [{ id: 'x', name: 'Meal', qty: 1, parts: [{ name: '' }] }],
  } }))
  assert.match(bad, /parts/)
})

// ── Splitters (migration 183) ──────────────────────────────
// Wings go through a Splitter shared by two wingmen; everything else on
// the ticket goes to the fryer. Pieces: "10 Wings" counts 10, "8 Wings" 8,
// Boneless (the dish) 6 each.
const W1 = uuid(), W2 = uuid(), FRY2 = uuid(), PASS2 = uuid(), BOX = uuid(), ORB2 = uuid()
const wingKit = {
  W1: { id: W1, name: 'Wingman 1', kind: 'prep', settings: {} },
  W2: { id: W2, name: 'Wingman 2', kind: 'prep', settings: {} },
  FRY2: { id: FRY2, name: 'Fryer', kind: 'prep', settings: {} },
  PASS2: { id: PASS2, name: 'Pass', kind: 'expo', settings: {} },
  BOX: { id: BOX, name: 'Wings', kind: 'balance', settings: { pieces: [
    { kind: 'option', label: '10 Wings', qty: 10 }, { kind: 'option', label: '8 Wings', qty: 8 }, { kind: 'dish', id: BONELESS, qty: 6 },
  ] } },
}
const wingFlow = [
  link(null, BOX, ['section', WINGSEC]), link(null, FRY2),
  link(BOX, W1), link(BOX, W2), link(W1, PASS2), link(W2, PASS2), link(FRY2, PASS2),
]
const wingLine = (n, extra = {}) => lineOf('Wings', WINGS, WINGSEC, { modifiers: [{ label: n + ' Wings', base: true, price: 0 }], ...extra })

/** A till whose kitchen config carries the open orders and the box's last pick, as the sequencer gives it. */
function balancedTill(box = {}) {
  const last = {}
  const kit = { ...wingKit, BOX: { ...wingKit.BOX, settings: { ...wingKit.BOX.settings, ...box } } }
  const base = { ...common, stations: byId(Object.values(kit)), flow: wingFlow }
  const t = till(base)
  Object.defineProperty(t, 'cfg', { get() { return { ...base, balance: { open: t.orders, last, picks: last } } } })
  return t
}
const wayOf = (k, checkId, lineId) => Object.keys(k[checkId].items.find(i => i.id === lineId).route).sort()

test('balance: a box\'s way keeps both stations until it is decided', () => {
  const cfg = { ...common, stations: byId(Object.values(wingKit)), flow: wingFlow }
  const full = itemRoute({ item_id: WINGS, section_id: WINGSEC }, cfg)
  assert.deepEqual(Object.keys(full).sort(), [BOX, W1, W2, PASS2].sort(), 'Check a dish shows both wingmen')
  const one = resolveBalances(full, cfg, () => W2)
  assert.deepEqual(one, { [W2]: [START], [PASS2]: [W2] }, 'the box drops out, the other wingman too')
  assert.deepEqual(Object.keys(itemRoute({ item_id: FRIES, section_id: SIDES }, cfg)).sort(), [FRY2, PASS2].sort(), 'other dishes don\'t go near it')
  assert.deepEqual(resolveBalances(full, cfg, () => null), {}, 'nothing to share with: nowhere')
})

test('balance: each ticket goes to the wingman with the fewest pieces to cook, taking turns on a tie', () => {
  const t = balancedTill()
  const c1 = openTable(t)
  const w10 = wingLine(10), f1 = fries()
  let k = addAndSend(t, c1, [w10, f1])
  assert.deepEqual(wayOf(k, c1, w10.id), [W1, PASS2].sort(), 'both empty: the first')
  assert.deepEqual(wayOf(k, c1, f1.id), [FRY2, PASS2].sort(), 'the fries go to the fryer')
  assert.equal(t.cfg.balance.last[BOX], W1, 'the pick is kept')

  const c2 = openTable(t)
  const w8 = wingLine(8)
  k = addAndSend(t, c2, [w8])
  assert.deepEqual(wayOf(k, c2, w8.id), [W2, PASS2].sort(), '10 pieces at Wingman 1: Wingman 2')

  const c3 = openTable(t)
  const a = wingLine(10), b = lineOf('Boneless', BONELESS, WINGSEC)
  k = addAndSend(t, c3, [a, b])
  assert.deepEqual(wayOf(k, c3, a.id), [W2, PASS2].sort(), '8 is fewer than 10')
  assert.deepEqual(wayOf(k, c3, b.id), [W2, PASS2].sort(), 'a ticket\'s wings stay together')
  assert.equal(stationLoad(t.orders, W2, wingKit.BOX.settings.pieces, t.cfg, at()), 8 + 10 + 6)

  ok(t.bump(c1, wingKit.W1))
  assert.equal(stationLoad(t.orders, W1, wingKit.BOX.settings.pieces, t.cfg, at()), 0, 'bumped: nothing left at Wingman 1')
  const c4 = openTable(t)
  const w6 = wingLine(6)
  k = addAndSend(t, c4, [w6])
  assert.deepEqual(wayOf(k, c4, w6.id), [W1, PASS2].sort(), 'Wingman 1 is free now')
  assert.equal(stationLoad(t.orders, W1, wingKit.BOX.settings.pieces, t.cfg, at()), 1, 'a dish no piece names counts its quantity')

  // Both clear: take turns after the last pick (Wingman 1).
  ok(t.bump(c4, wingKit.W1))
  ok(t.bump(c2, wingKit.W2))
  ok(t.bump(c3, wingKit.W2))
  const c5 = openTable(t)
  const w5 = wingLine(10)
  k = addAndSend(t, c5, [w5])
  assert.deepEqual(wayOf(k, c5, w5.id), [W2, PASS2].sort(), 'a tie goes to the next one')
  assert.equal(t.tickets(wingKit.W1).filter(x => x.order.id === c5).length, 0, 'not on the other wingman\'s screen')
  assert.equal(t.tickets(wingKit.W2).filter(x => x.order.id === c5).length, 1)
})

test('balance: a held course is decided when it is fired; online orders as they come in', () => {
  const t = balancedTill()
  const c1 = openTable(t)
  const busy = wingLine(10)
  addAndSend(t, c1, [busy])          // Wingman 1 has 10
  const c2 = openTable(t)
  const later = wingLine(8, { course_id: MAINS })
  let k = addAndSend(t, c2, [later], [MAINS])
  assert.ok(k[c2].items[0].route[BOX], 'held: still shared')
  ok(t.bump(c1, wingKit.W1))         // Wingman 1 clears before the course is fired
  const c3 = openTable(t)
  const w = wingLine(8)
  addAndSend(t, c3, [w])             // goes to Wingman 2 (turns), 8 there now
  k = t.send(ev('course.fired', { course_id: MAINS }, { check_id: c2 }))
  assert.deepEqual(Object.keys(k[c2].items[0].route).sort(), [W1, PASS2].sort(), 'fired: the wingman free now')

  const r = ok(t.kitchen(kev('kitchen.order_in', { order: {
    id: onlineOrderId(uuid()), order_id: uuid(), number: '41', type: OUT,
    items: [{ id: 'a', item_id: WINGS, section_id: WINGSEC, name: 'Wings', qty: 1, options: [{ label: '10 Wings', mode: 'base' }] },
      { id: 'b', item_id: FRIES, section_id: SIDES, name: 'Fries', qty: 1 }],
  } })))
  const o = Object.values(r.orders)[0]
  assert.equal(Object.keys(o.items[0].route).length, 2, 'an online order is decided as it comes in')
  assert.ok(!o.items[0].route[BOX])
  assert.ok(o.items[1].route[FRY2])
})

test('balance: a big ticket stays on one station unless the box shares big tickets', () => {
  // Keep together (the default): 28 pieces all on one wingman.
  const t = balancedTill()
  const c1 = openTable(t)
  const a = wingLine(10), b = wingLine(10), c = wingLine(8)
  let k = addAndSend(t, c1, [a, b, c])
  assert.deepEqual([a, b, c].map(l => wayOf(k, c1, l.id)), [[W1, PASS2].sort(), [W1, PASS2].sort(), [W1, PASS2].sort()], 'one ticket, one wingman')

  // Share above 20: 20 pieces stay together, 26 are shared, biggest first,
  // each to the wingman with fewer pieces counting what this ticket put there.
  const s = balancedTill({ split_above: 20 })
  const d1 = openTable(s)
  const x = wingLine(10), y = wingLine(10)
  k = addAndSend(s, d1, [x, y])
  assert.deepEqual([x, y].map(l => wayOf(k, d1, l.id)), [[W1, PASS2].sort(), [W1, PASS2].sort()], '20 is not more than 20: together')
  const d2 = openTable(s)
  const p = wingLine(10), q = wingLine(10), r = lineOf('Boneless', BONELESS, WINGSEC), f = fries()
  k = addAndSend(s, d2, [r, p, q, f])
  assert.deepEqual(wayOf(k, d2, p.id), [W2, PASS2].sort(), 'first 10 to the empty wingman')
  assert.deepEqual(wayOf(k, d2, q.id), [W2, PASS2].sort(), 'next 10: 10 there is still fewer than 20')
  assert.deepEqual(wayOf(k, d2, r.id), [W1, PASS2].sort(), 'the 6 boneless: level at 20, so the next in turn')
  assert.deepEqual(wayOf(k, d2, f.id), [FRY2, PASS2].sort(), 'the fries still go to the fryer')
  assert.equal(s.cfg.balance.last[BOX], W1, 'the last pick is kept')
  assert.equal(stationLoad(s.orders, W1, wingKit.BOX.settings.pieces, s.cfg, at()), 26)
  assert.equal(stationLoad(s.orders, W2, wingKit.BOX.settings.pieces, s.cfg, at()), 20)
  assert.equal(s.tickets(wingKit.W1).filter(tk => tk.order.id === d2).length, 1, 'the ticket shows on both wingmen')
  assert.equal(s.tickets(wingKit.W2).filter(tk => tk.order.id === d2).length, 1)

  // One line is never split, however big.
  const u = balancedTill({ split_above: 10 })
  const e1 = openTable(u)
  const big = wingLine(10, { qty: 3 })
  k = addAndSend(u, e1, [big])
  assert.deepEqual(wayOf(k, e1, big.id), [W1, PASS2].sort(), '3 x 10 wings stay on one wingman')

  // Level: ties take turns as the ticket is shared.
  const e2 = openTable(u)
  const m = wingLine(10), n = wingLine(8), o = wingLine(6)
  ok(u.bump(e1, wingKit.W1))
  k = addAndSend(u, e2, [o, n, m])
  assert.deepEqual(wayOf(k, e2, m.id), [W2, PASS2].sort(), 'both empty: the one after the last pick')
  assert.deepEqual(wayOf(k, e2, n.id), [W1, PASS2].sort())
  assert.deepEqual(wayOf(k, e2, o.id), [W1, PASS2].sort(), '8 at Wingman 1 is fewer than 10')
})

test('balance: a shared big ticket splits a meal deal by its parts, and online orders too', () => {
  const t = balancedTill({ split_above: 10 })
  const c = openTable(t)
  const meal = lineOf('Wing feast', MEAL, WINGSEC, {
    combo: [
      { step: 'Wings', item_id: WINGS, section_id: WINGSEC, name: 'Wings', modifiers: [{ label: '10 Wings', base: true, price: 0 }], upcharge: 0 },
      { step: 'More wings', item_id: WINGS, section_id: WINGSEC, name: 'Wings', modifiers: [{ label: '8 Wings', base: true, price: 0 }], upcharge: 0 },
      { step: 'Side', item_id: FRIES, section_id: SIDES, name: 'Fries', modifiers: [], upcharge: 0 },
    ],
  })
  const k = addAndSend(t, c, [meal])
  const item = k[c].items[0]
  assert.deepEqual(Object.keys(item.parts[0].route).sort(), [W1, PASS2].sort(), 'the 10 to one wingman')
  assert.deepEqual(Object.keys(item.parts[1].route).sort(), [W2, PASS2].sort(), 'the 8 to the other')
  assert.deepEqual(Object.keys(item.parts[2].route).sort(), [FRY2, PASS2].sort())
  assert.deepEqual(Object.keys(item.route).sort(), [W1, W2, FRY2, PASS2].sort(), 'the dish goes everywhere its parts go')
  assert.deepEqual(t.tickets(wingKit.W1).flatMap(tk => tk.items.flatMap(i => i.parts.map(pt => pt.mods[0].text))), ['10 Wings'])
  assert.deepEqual(t.tickets(wingKit.W2).flatMap(tk => tk.items.flatMap(i => i.parts.map(pt => pt.mods[0].text))), ['8 Wings'])

  const r = ok(t.kitchen(kev('kitchen.order_in', { order: {
    id: onlineOrderId(uuid()), order_id: uuid(), number: '42', type: OUT,
    items: [{ id: 'a', item_id: WINGS, section_id: WINGSEC, name: 'Wings', qty: 1, options: [{ label: '10 Wings', mode: 'base' }] },
      { id: 'b', item_id: WINGS, section_id: WINGSEC, name: 'Wings', qty: 1, options: [{ label: '8 Wings', mode: 'base' }] }],
  } })))
  const o = Object.values(r.orders)[0]
  // Wingman 1 has 10, Wingman 2 has 8: the 10 goes to Wingman 2 (18), then the 8 to Wingman 1 (18).
  assert.ok(o.items[0].route[W2] && !o.items[0].route[W1])
  assert.ok(o.items[1].route[W1] && !o.items[1].route[W2])
})

test('balance: flow checks and nothing to bump', () => {
  const st = Object.values(wingKit)
  assert.deepEqual(flowProblems(st, wingFlow), [])
  assert.match(flowProblems([...st, { id: ORB2, name: 'ORB', kind: 'board' }], [...wingFlow, link(BOX, ORB2)])[0], /link it to prep stations/)
  assert.match(flowProblems(st, [...wingFlow.filter(l => l.from !== BOX || l.to !== W2), link(BOX, W2, ['item', WINGS])])[0], /remove their filters/)
  assert.ok(flowWarnings(st, wingFlow.filter(l => !(l.from === BOX && l.to === W2))).some(w => /only one station to share with/.test(w)))
  const t = balancedTill()
  const c1 = openTable(t)
  addAndSend(t, c1, [wingLine(10)])
  const r = t.kitchen(kev('kitchen.bumped', { order_id: c1, station_id: BOX }))
  assert.equal(r.ok, false)
  assert.match(r.error, /Splitter has nothing to bump/)
  assert.deepEqual(stationTickets(t.orders, wingKit.BOX, at(), t.cfg), [])
})

// ── Sleepers (migration 200) ───────────────────────────────────

const SLEEP = uuid()
const sleepKit = {
  ...simple,
  SLEEP: { id: SLEEP, name: 'Delivery wait', kind: 'sleeper', settings: { delay_mins: 10 } },
}
// Delivery dishes wait 10 minutes before the grill; everything else goes straight there.
const sleepFlow = [link(null, GRILL), link(null, SLEEP, ['order_type', DEL]), link(SLEEP, GRILL), link(GRILL, PASS)]
const sleepCfg = () => ({ ...common, stations: byId(Object.values(sleepKit)), flow: sleepFlow })

test('sleeper: holds delivery dishes for its time, then they reach the grill by themselves', () => {
  const t = till(sleepCfg())
  const del = openTable(t, { order_type_id: DEL })
  const eat = openTable(t)
  const db = burger(), eb = burger()
  addAndSend(t, del, [db])
  const sentAt = at()
  addAndSend(t, eat, [eb])
  assert.deepEqual(Object.keys(t.orders[del].items[0].route).sort(), [SLEEP, GRILL, PASS].sort())
  assert.deepEqual(t.orders[del].items[0].route[GRILL], [SLEEP])
  // The grill sees only the eat in order; the delivery one sleeps.
  assert.deepEqual(t.tickets(simple.GRILL).map(tk => tk.order.id), [eat])
  assert.equal(itemState(t.orders[del].items[0], sleepKit.SLEEP, at(), t.cfg), 'sleeping')
  assert.deepEqual(itemWhere(t.orders[del].items[0], t.cfg, at()), [SLEEP])
  const wake = new Date(Date.parse(sentAt) + 10 * 60_000).toISOString()
  // The pass shows it coming, asleep until its time, with its clock from then.
  const pass = t.tickets(simple.PASS).find(tk => tk.order.id === del)
  assert.equal(pass.sleeping_until, wake)
  assert.deepEqual(pass.items[0].sleeps, [{ station_id: SLEEP, until: wake }])
  assert.deepEqual(pass.items[0].where, [])
  assert.equal(pass.since, wake)
  // The grill can't bump it yet.
  const early = t.bump(del, simple.GRILL)
  assert.equal(early.ok, false)
  assert.match(early.error, /Still at Delivery wait/)
  // The Sleeper itself has nothing to bump and no screen.
  assert.match(t.kitchen(kev('kitchen.bumped', { order_id: del, station_id: SLEEP })).error, /Sleeper passes dishes on by itself/)
  assert.deepEqual(stationTickets(t.orders, sleepKit.SLEEP, at(), t.cfg), [])

  clock = Date.parse(wake) + 30_000
  const grill = t.tickets(simple.GRILL).find(tk => tk.order.id === del)
  assert.ok(grill, 'awake: on the grill')
  assert.equal(grill.items[0].state, 'active')
  assert.equal(grill.since, wake, 'its grill timer starts when it woke')
  assert.equal(t.tickets(simple.PASS).find(tk => tk.order.id === del).sleeping_until, null)
  ok(t.bump(del, simple.GRILL))
  ok(t.bump(del, simple.PASS))
  assert.equal(t.orders[del].status, 'ready')
})

test('sleeper: the pass can wake it; a remade dish does not wait again', () => {
  const t = till(sleepCfg())
  const c = openTable(t, { order_type_id: DEL })
  const b = burger()
  addAndSend(t, c, [b])
  // The pass shows dishes before they arrive, so its bump finishes everything, the wait too.
  ok(t.bump(c, simple.PASS))
  assert.equal(t.orders[c].status, 'ready')
  assert.ok(t.orders[c].items[0].done[SLEEP])

  const u = till(sleepCfg())
  const d = openTable(u, { order_type_id: DEL })
  const b2 = burger()
  addAndSend(u, d, [b2])
  clock += 11 * 60_000
  ok(u.bump(d, simple.GRILL))
  ok(u.bump(d, simple.PASS))
  ok(u.kitchen(kev('kitchen.remake', { order_id: d, station_id: PASS, item_id: b2.id, reason: 'Dropped' })))
  const again = u.tickets(simple.GRILL).find(tk => tk.order.id === d)
  assert.ok(again && again.items[0].state === 'active', 'back on the grill at once')
  assert.ok(u.orders[d].items[0].slept[SLEEP])
})

test('sleeper: a delay of 0 passes straight through; flow warnings', () => {
  const cfg = sleepCfg()
  cfg.stations = { ...cfg.stations, [SLEEP]: { ...sleepKit.SLEEP, settings: { delay_mins: 0 } } }
  const t = till(cfg)
  const c = openTable(t, { order_type_id: DEL })
  addAndSend(t, c, [burger()])
  assert.ok(t.tickets(simple.GRILL).some(tk => tk.order.id === c))
  const st = Object.values(sleepKit)
  assert.deepEqual(flowProblems(st, sleepFlow), [])
  assert.ok(flowWarnings(st, sleepFlow.filter(l => l.from !== SLEEP)).some(w => /Delivery wait holds dishes but sends them nowhere/.test(w)))
  // Filters out of a Sleeper are fine (unlike a Splitter's).
  assert.deepEqual(flowProblems(st, [...sleepFlow.filter(l => l.from !== SLEEP), link(SLEEP, GRILL, ['item', BURGER])]), [])
})

test('sleeper: an online order set ready from outside wakes it', () => {
  const t = till(sleepCfg())
  const id = onlineOrderId(uuid())
  ok(t.kitchen(kev('kitchen.order_in', { order: {
    id, order_id: uuid(), number: '7', type: DEL,
    items: [{ id: 'a', item_id: BURGER, section_id: BURGERS, name: 'Burger', qty: 1 }],
  } })))
  assert.equal(itemState(t.orders[id].items[0], sleepKit.SLEEP, at(), t.cfg), 'sleeping')
  ok(t.kitchen(kev('kitchen.order_status', { order_id: id, status: 'ready' })))
  assert.ok(t.orders[id].items[0].done[SLEEP], 'the wait counts as over')
  assert.equal(itemState(t.orders[id].items[0], simple.GRILL, at(), t.cfg), 'done')
})

// ── Setters (migration 203) ────────────────────────────────────

const SET_IN = uuid(), SET_BAG = uuid(), BOARD1 = uuid()
const setKit = {
  ...simple,
  IN: { id: SET_IN, name: 'In the kitchen', kind: 'setter', settings: { status_look: 'light', status_colour: '#FF0000', status_lamp: 1, status_anim: 'pulse' } },
  BAG: { id: SET_BAG, name: 'Bagging', kind: 'setter', settings: { status_look: 'flag', status_text: 'Nearly there', status_anim: 'nope' } },
  ORB1: { id: BOARD1, name: 'ORB', kind: 'board', settings: {} },
}
// Orders in > In the kitchen > Grill > Bagging > Pass > ORB.
const setFlow = [link(null, SET_IN), link(SET_IN, GRILL), link(GRILL, SET_BAG), link(SET_BAG, PASS), link(PASS, BOARD1)]
const setCfg = () => ({ ...common, stations: byId(Object.values(setKit)), flow: setFlow })

test('setter: passes dishes straight on and sets the order status as they pass', () => {
  const t = till(setCfg())
  const c = openCounter(t, 61)
  addAndSend(t, c, [burger()])
  // Straight through the first Setter: the grill has it at once.
  assert.ok(t.tickets(simple.GRILL).some(tk => tk.order.id === c))
  assert.deepEqual(stationTickets(t.orders, setKit.IN, at(), t.cfg), [])
  assert.match(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: SET_IN })).error, /Setter only sets the order's status/)
  let st = orderStatus(t.orders[c], t.cfg, at())
  assert.equal(st.name, 'In the kitchen')
  assert.deepEqual([st.text, st.look, st.colour, st.anim, st.lamp], ['In the kitchen', 'light', '#ff0000', 'pulse', 1])
  let board = boardNumbers(t.orders, at(), { boardId: BOARD1, cfg: t.cfg })
  assert.deepEqual(board.preparing.map(x => [x.number, x.status?.name]), [['61', 'In the kitchen']])
  clock += 60_000
  ok(t.bump(c, simple.GRILL))
  st = orderStatus(t.orders[c], t.cfg, at())
  assert.equal(st.name, 'Bagging', 'the later Setter wins')
  assert.deepEqual([st.text, st.look, st.anim], ['Nearly there', 'flag', 'none'], 'words override the name; unknown animation is still')
  board = boardNumbers(t.orders, at(), { boardId: BOARD1, cfg: t.cfg })
  assert.equal(board.preparing[0].status.text, 'Nearly there')
  clock += 60_000
  ok(t.bump(c, simple.PASS))
  board = boardNumbers(t.orders, at(), { boardId: BOARD1, cfg: t.cfg })
  assert.deepEqual(board.ready.map(x => [x.number, x.status?.name]), [['61', 'Bagging']], 'ready tiles keep the last status')
  // Without cfg (or Setters) there is no status.
  assert.equal(boardNumbers(t.orders, at(), { boardId: BOARD1 }).ready[0]?.status, undefined)
})

test('setter: status needs a fired dish; looks and animations listed; a Setter at the end of a way', () => {
  assert.deepEqual(STATUS_LOOKS.map(x => x.key), ['text', 'flag', 'border', 'light', 'square', 'circle'])
  assert.ok(STATUS_ANIMS.some(x => x.key === 'pulse') && STATUS_ANIMS.some(x => x.key === 'turn'))
  assert.deepEqual(statusOf({ id: 'x', name: 'Ready soon', settings: { status_colour: 'red', status_lamp: 7 } }),
    { id: 'x', name: 'Ready soon', text: 'Ready soon', look: 'text', colour: '#f59e0b', anim: 'none', lamp: 2 })
  // The pass ends at a Setter: the order is ready when the pass bumps (a Setter isn't waited on).
  const cfg = { ...common, stations: byId(Object.values(setKit)), flow: [link(null, GRILL), link(GRILL, PASS), link(PASS, SET_BAG)] }
  const t = till(cfg)
  const c = openTable(t)
  addAndSend(t, c, [burger()])
  assert.equal(orderStatus(t.orders[c], t.cfg, at()), null)
  ok(t.bump(c, simple.GRILL))
  ok(t.bump(c, simple.PASS))
  assert.equal(t.orders[c].status, 'ready')
  assert.equal(orderStatus(t.orders[c], t.cfg, at()).name, 'Bagging')
  assert.deepEqual(flowProblems(Object.values(setKit), setFlow), [])
})
