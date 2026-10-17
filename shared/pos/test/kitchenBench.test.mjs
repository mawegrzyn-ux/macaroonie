// The kitchen test bench's pretend kitchen (shared/pos/kitchenBench.js):
// test orders in, screens' taps back through the shared kitchen rules, flows
// switched on the bench, held courses, online orders, combos, clearing.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { createBench, benchScreens, randomComboParts } from '../kitchenBench.js'
import { stationTickets, routeOrder } from '../kitchen.js'

const uuid = () => globalThis.crypto.randomUUID()

// A seeded random number generator, so made-up orders repeat.
function seeded(seed = 7) {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
}

const GRILL = uuid(), FRYER = uuid(), PASS = uuid(), BOARD = uuid()
const MAINS_SEC = uuid(), SIDES_SEC = uuid(), STARTERS = uuid(), MAINS = uuid()
const BURGER = uuid(), FRIES = uuid(), WINGS = uuid(), MEAL = uuid()
const EAT = uuid(), OUT = uuid()
const TABLE5 = uuid()
const MAIN_FLOW = uuid(), FAST_FLOW = uuid()
const link = (from, to, targets = []) => ({ id: uuid(), from, to, targets })

const STEP_MAIN = uuid(), STEP_SIDE = uuid(), OPT_BURGER = uuid(), OPT_SIDES = uuid()

function benchData() {
  return {
    venue: { id: uuid(), name: 'Ware', timezone: 'Europe/London' },
    settings: { day_starts_at: '04:00' },
    stations: [
      { id: GRILL, name: 'Grill', kind: 'prep', settings: {} },
      { id: FRYER, name: 'Fryer', kind: 'prep', settings: {} },
      { id: PASS, name: 'Pass', kind: 'expo', settings: {} },
      { id: BOARD, name: 'Collection board', kind: 'board', settings: {} },
    ],
    courses: [{ id: STARTERS, name: 'Starters', sort_order: 1 }, { id: MAINS, name: 'Mains', sort_order: 2 }],
    order_types: [{ id: EAT, name: 'Eat in' }, { id: OUT, name: 'Take out' }],
    flows: [
      {
        id: MAIN_FLOW, name: 'Main flow', station_ids: [GRILL, FRYER, PASS, BOARD],
        links: [
          link(null, GRILL),
          link(null, FRYER, [{ kind: 'section', id: SIDES_SEC }]),
          link(GRILL, PASS), link(FRYER, PASS), link(PASS, BOARD),
        ],
      },
      { id: FAST_FLOW, name: 'Quiet night', station_ids: [GRILL], links: [link(null, GRILL)] },
    ],
    active_flow_id: MAIN_FLOW,
    screens: [
      { id: uuid(), name: 'Grill screen', short_code: 'K1', settings: { station_ids: [GRILL] } },
      { id: uuid(), name: 'Pass screen', short_code: 'K2', settings: { station_ids: [PASS], can_switch_flow: false } },
    ],
    tables: [{ id: TABLE5, label: '5' }],
    streams: [],
    menus: [{ id: uuid(), name: 'Food', sections: [{ id: MAINS_SEC, title: 'Mains', item_ids: [BURGER, WINGS, MEAL] }, { id: SIDES_SEC, title: 'Sides', item_ids: [FRIES] }] }],
    items: {
      [BURGER]: { id: BURGER, name: 'Burger', kitchen_name: null, section_id: MAINS_SEC, course_id: MAINS, kind: 'dish', combo: null },
      [WINGS]: { id: WINGS, name: 'Wings', kitchen_name: null, section_id: MAINS_SEC, course_id: STARTERS, kind: 'dish', combo: null },
      [FRIES]: { id: FRIES, name: 'Fries', kitchen_name: 'FRIES', section_id: SIDES_SEC, course_id: null, kind: 'dish', combo: null },
      [MEAL]: {
        id: MEAL, name: 'Burger meal', kitchen_name: null, section_id: MAINS_SEC, course_id: null, kind: 'combo',
        combo: {
          steps: [
            { id: STEP_MAIN, name: 'Burger', min: 1, max: 1, options: [{ id: OPT_BURGER, type: 'item', item_id: BURGER, price_pence: 0 }] },
            { id: STEP_SIDE, name: 'Side', min: 1, max: 1, options: [{ id: OPT_SIDES, type: 'section', section_id: SIDES_SEC, price_pence: 0 }] },
          ],
        },
      },
    },
    section_items: { [MAINS_SEC]: [BURGER, WINGS, MEAL], [SIDES_SEC]: [FRIES] },
  }
}

function clock(start = Date.parse('2026-10-17T12:00:00Z')) {
  let t = start
  const now = () => new Date(t).toISOString()
  now.add = s => { t += s * 1000 }
  return now
}

const tap = (screen, type, payload) => ({ id: ulid(), device_id: screen.id, staff_id: null, type, payload, client_at: new Date().toISOString() })

test('a till order goes through the flow and the screens\' taps move it on', () => {
  const data = benchData()
  const now = clock()
  const b = createBench(data, { now })
  const [grillScreen] = benchScreens(data)
  const sent = b.sendOrder({ source: 'till', order_type_id: EAT, table_id: TABLE5, lines: [{ item_id: BURGER, qty: 1 }, { item_id: FRIES, qty: 2 }] })
  assert.equal(sent.ok, true)
  const o = b.orders()[sent.id]
  assert.equal(o.table, '5')
  assert.equal(o.type_name, 'Eat in')
  const burger = o.items.find(i => i.name === 'Burger')
  const fries = o.items.find(i => i.name === 'FRIES')
  assert.deepEqual(routeOrder(burger.route), [GRILL, PASS, BOARD])
  assert.deepEqual(routeOrder(fries.route), [FRYER, PASS, BOARD])

  const first = b.sync(0)
  assert.equal(first.reset, true)
  assert.equal(first.orders.length, 1)

  now.add(60)
  const r = b.submit(grillScreen, [tap(grillScreen, 'kitchen.bumped', { order_id: sent.id, station_id: GRILL })])
  assert.equal(r.results[0].ok, true)
  assert.equal(r.kitchen.length, 1)
  const cfg = b.cfg()
  const pass = cfg.stations[PASS]
  const ticket = stationTickets(b.orders(), pass, now(), cfg)[0]
  assert.ok(ticket, 'the pass shows the order')
  // Only what changed since the last sync comes back.
  assert.equal(b.sync(first.seq).orders.length, 1)
  assert.equal(b.sync(b.sync(0).seq).orders.length, 0)
  assert.equal(b.state.log[0].screen, 'Grill screen')
})

test('a refused tap, the same tap twice, and server-only events', () => {
  const data = benchData()
  const b = createBench(data, { now: clock() })
  const [grill, passScreen] = benchScreens(data)
  const sent = b.sendOrder({ source: 'till', lines: [{ item_id: BURGER, qty: 1 }] })
  const early = b.submit(passScreen, [tap(passScreen, 'kitchen.recalled', { order_id: sent.id, station_id: PASS })])
  assert.equal(early.results[0].ok, false)
  assert.equal(b.state.log[0].ok, false)
  const e = tap(grill, 'kitchen.bumped', { order_id: sent.id, station_id: GRILL })
  assert.equal(b.submit(grill, [e]).results[0].ok, true)
  const again = b.submit(grill, [e]).results[0]
  assert.equal(again.ok, false)
  assert.equal(again.code, 'duplicate')
  const sneaky = b.submit(grill, [tap(grill, 'kitchen.order_status', { order_id: sent.id, status: 'ready' })]).results[0]
  assert.equal(sneaky.code, 'invalid')
})

test('switching the flow changes where new orders go, not orders already sent', () => {
  const data = benchData()
  const now = clock()
  const b = createBench(data, { now })
  const screens = benchScreens(data)
  const before = b.sendOrder({ source: 'till', lines: [{ item_id: FRIES, qty: 1 }] })
  assert.throws(() => b.switchFlow(FAST_FLOW, 'Pass screen', screens[1]), /can't switch/)
  const sw = b.switchFlow(FAST_FLOW, 'Grill screen', screens[0])
  assert.equal(sw.changed, true)
  assert.equal(sw.switched_by, 'Grill screen')
  const cfgNow = b.screenConfig(screens[0])
  assert.equal(cfgNow.active_flow_id, FAST_FLOW)
  assert.equal(cfgNow.flow.length, 1)
  assert.notEqual(cfgNow.version, createBench(data, { now }).screenConfig(screens[0]).version)
  const after = b.sendOrder({ source: 'till', lines: [{ item_id: FRIES, qty: 1 }] })
  assert.deepEqual(routeOrder(b.orders()[before.id].items[0].route), [FRYER, PASS, BOARD])
  assert.deepEqual(routeOrder(b.orders()[after.id].items[0].route), [GRILL])
  assert.equal(b.switchFlow(FAST_FLOW, 'Grill screen').changed, false)
  assert.throws(() => b.switchFlow(uuid(), 'x'), /not found/)
})

test('held courses wait until fired; voiding a dish; online orders', () => {
  const data = benchData()
  const now = clock()
  const b = createBench(data, { now })
  const sent = b.sendOrder({ source: 'till', table_id: TABLE5, hold_courses: true, lines: [{ item_id: WINGS, qty: 1 }, { item_id: BURGER, qty: 1 }] })
  const o = b.orders()[sent.id]
  const burger = o.items.find(i => i.name === 'Burger')
  const wings = o.items.find(i => i.name === 'Wings')
  assert.equal(burger.fired_at, null)
  assert.ok(wings.fired_at)
  assert.equal(b.fireCourse(sent.id, MAINS).ok, true)
  assert.ok(b.orders()[sent.id].items.find(i => i.name === 'Burger').fired_at)
  assert.equal(b.voidItem(sent.id, wings.id).ok, true)
  assert.ok(b.orders()[sent.id].items.find(i => i.id === wings.id).voided_at)

  const web = b.sendOrder({ source: 'online', order_type_id: OUT, lines: [{ item_id: BURGER, qty: 1 }] })
  assert.equal(web.ok, true)
  assert.equal(web.number, 'W1')
  assert.equal(b.orders()[web.id].source, 'online')
  assert.equal(b.fireCourse(web.id, MAINS).ok, false)
})

test('a combo\'s picks go to their own stations', () => {
  const data = benchData()
  const rng = seeded(3)
  const parts = randomComboParts(data.items[MEAL], { itemsById: data.items, sectionItems: data.section_items }, rng)
  assert.deepEqual(parts.map(p => p.item_id), [BURGER, FRIES])
  const b = createBench(data, { now: clock(), rng })
  const sent = b.sendOrder({ source: 'till', lines: [{ item_id: MEAL, qty: 1 }] })
  const meal = b.orders()[sent.id].items[0]
  assert.equal(meal.parts.length, 2)
  assert.ok(meal.route[GRILL] && meal.route[FRYER] && meal.route[PASS])
})

test('made-up orders, clearing, and a venue with no stations', () => {
  const data = benchData()
  const b = createBench(data, { now: clock(), rng: seeded(11) })
  for (let i = 0; i < 20; i++) assert.equal(b.sendOrder(b.randomSpec()).ok, true)
  assert.equal(Object.keys(b.orders()).length, 20)
  const seq = b.sync(0).seq
  b.clear()
  const after = b.sync(seq)
  assert.equal(after.reset, true)
  assert.equal(after.orders.length, 0)
  assert.equal(b.sendOrder({ source: 'till', lines: [] }).ok, false)

  const empty = createBench({ ...data, stations: [], flows: [], screens: [] }, { now: clock() })
  assert.equal(empty.sendOrder({ source: 'till', lines: [{ item_id: BURGER, qty: 1 }] }).ok, false)
  assert.deepEqual(benchScreens({ ...data, screens: [] }).map(s => s.name), ['Grill', 'Fryer', 'Pass'])
  assert.deepEqual(benchScreens(data, 'stations').map(s => s.settings.station_ids[0]), [GRILL, FRYER, PASS])
})
