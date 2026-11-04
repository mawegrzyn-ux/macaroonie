// A meal deal's parts ticked off one by one on the kitchen screens
// (kitchen.item_done / kitchen.item_checked with parts): prep stations mark
// the parts they make, the pass and runners tick off every part; the last
// part ticked is the whole dish.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent } from '../checks.js'
import {
  kitchenForCheckEvent, applyKitchenEvent, stationTickets, kitchenEventProblem, partRows, stationPartIndexes,
} from '../kitchen.js'

const uuid = () => globalThis.crypto.randomUUID()

const VENUE = uuid()
const ANNA = uuid()
const staffById = { [ANNA]: { id: ANNA, name: 'Anna', permissions: { void: true, transfer: true, discount_max_pct: 0 } } }
const DRINKS = uuid(), SIDES = uuid(), BURGERS = uuid()
const RC = uuid(), EAT = uuid(), TABLE5 = uuid()
const BURGER = uuid(), FRIES = uuid(), RINGS = uuid(), COLA = uuid(), MEAL = uuid()

const GRILL = uuid(), FRYER = uuid(), BAR = uuid(), PASS = uuid()
const link = (from, to, ...targets) => ({ id: uuid(), from, to, targets: targets.map(([kind, id]) => ({ kind, id })) })
const stations = (pass = {}) => ({
  [GRILL]: { id: GRILL, name: 'Grill', kind: 'prep', settings: {} },
  [FRYER]: { id: FRYER, name: 'Fryer', kind: 'prep', settings: {} },
  [BAR]: { id: BAR, name: 'Bar', kind: 'prep', settings: {} },
  [PASS]: { id: PASS, name: 'Pass', kind: 'expo', settings: pass },
})
const kitchenCfg = (pass = {}) => ({
  enabled: true, courses: {}, tables: { [TABLE5]: { label: '5' } }, staff: { [ANNA]: { name: 'Anna' } },
  order_types: { [EAT]: { name: 'Eat in' } },
  stations: stations(pass),
  flow: [
    link(null, GRILL), link(null, BAR, ['section', DRINKS]), link(null, FRYER, ['section', SIDES]),
    link(GRILL, PASS), link(FRYER, PASS), link(BAR, PASS),
  ],
})

let clock = Date.parse('2026-11-04T12:00:00Z')
function ev(type, payload, { check_id = null, staff_id = ANNA, device = 'T1' } = {}) {
  clock += 1000
  const t = new Date(clock).toISOString()
  return { id: ulid(clock), venue_id: VENUE, device_id: device, staff_id, check_id, type, payload, client_at: t, received_at: t }
}
const kev = (type, payload) => ev(type, payload, { staff_id: null, device: 'K1' })
const ok = r => { assert.ok(r.ok, r.error); return r }
const now = () => new Date(clock).toISOString()

function till(cfg) {
  let checks = {}
  let orders = {}
  return {
    cfg,
    get orders() { return orders },
    send(e) {
      const before = checks
      const r = ok(applyEvent(checks, e, { staffById }))
      checks = { ...checks, ...r.checks }
      orders = { ...orders, ...kitchenForCheckEvent(e, before, r.checks, orders, this.cfg) }
    },
    kitchen(e) {
      const r = applyKitchenEvent(orders, e, this.cfg)
      if (r.ok) orders = { ...orders, ...r.orders }
      return r
    },
    tickets(stationId) { return stationTickets(orders, this.cfg.stations[stationId], now(), this.cfg) },
  }
}

// Burger meal: the burger (grill), fries and onion rings (fryer), a cola (bar),
// two ketchup pots (typed in: they go with the meal, which sits in Sides).
function mealLine() {
  return {
    id: ulid(), item_id: MEAL, section_id: SIDES, name: 'Burger meal', qty: 1, unit_price: 900, modifiers: [], vat_rate: 20,
    combo: [
      { step: 'Main', item_id: BURGER, section_id: BURGERS, name: 'Burger', modifiers: [{ label: 'Cheese', price: 0, depth: 0 }], upcharge: 0 },
      { step: 'Side', item_id: FRIES, section_id: SIDES, name: 'Fries', modifiers: [], upcharge: 0 },
      { step: 'Side', item_id: RINGS, section_id: SIDES, name: 'Onion rings', modifiers: [], upcharge: 0 },
      { step: 'Drink', item_id: COLA, section_id: DRINKS, name: 'Cola', modifiers: [], upcharge: 0 },
      { step: 'Dip', item_id: null, section_id: null, name: 'Ketchup pot', modifiers: [], upcharge: 0, custom: true },
      { step: 'Dip', item_id: null, section_id: null, name: 'Ketchup pot', modifiers: [], upcharge: 0, custom: true },
    ],
  }
}
const BURGER_I = 0, FRIES_I = 1, RINGS_I = 2, COLA_I = 3, KETCHUP = [4, 5]

function sendMeal(t, extra = []) {
  const c = ulid()
  t.send(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, order_type_id: EAT, number: 12 }, { check_id: c }))
  const meal = mealLine()
  for (const l of [meal, ...extra]) t.send(ev('line.added', { line: l }, { check_id: c }))
  t.send(ev('lines.sent', { send_id: ulid(), line_ids: [meal, ...extra].map(l => l.id), held_course_ids: [] }, { check_id: c }))
  return { c, meal }
}
const done = (t, c, meal, station, parts, isDone = true) =>
  t.kitchen(kev('kitchen.item_done', { order_id: c, station_id: station, item_id: meal.id, done: isDone, ...(parts ? { parts } : {}) }))
const tick = (t, c, meal, parts, checked = true, station = PASS) =>
  t.kitchen(kev('kitchen.item_checked', { order_id: c, station_id: station, item_id: meal.id, checked, ...(parts ? { parts } : {}) }))
const itemAt = (t, station) => t.tickets(station)[0]?.items[0]
const ticked = (t, station) => (itemAt(t, station)?.parts || []).filter(p => p.ticked).map(p => p.name)

test('event shapes: parts are a list of places in the dish\'s parts', () => {
  const p = { order_id: ulid(), station_id: FRYER, item_id: ulid(), done: true }
  assert.equal(kitchenEventProblem(kev('kitchen.item_done', p)), null)
  assert.equal(kitchenEventProblem(kev('kitchen.item_done', { ...p, parts: [0, 3] })), null)
  for (const parts of [[], [-1], ['1'], [1.5], [60], Array.from({ length: 61 }, (_, i) => i % 60), 'all', { 0: true }]) {
    assert.match(kitchenEventProblem(kev('kitchen.item_done', { ...p, parts })), /parts/, JSON.stringify(parts))
    assert.match(kitchenEventProblem(kev('kitchen.item_checked', { ...p, checked: true, done: undefined, parts })), /parts/)
  }
})

test('a station shows the parts it makes, each with its place in the dish', () => {
  const t = till(kitchenCfg())
  const { c } = sendMeal(t)
  const fryer = itemAt(t, FRYER)
  assert.deepEqual(fryer.parts.map(p => [p.name, p.index, p.ticked]), [['Fries', FRIES_I, false], ['Onion rings', RINGS_I, false], ['Ketchup pot', 4, false], ['Ketchup pot', 5, false]])
  assert.deepEqual(stationPartIndexes(t.orders[c].items[0], t.cfg.stations[GRILL]), [BURGER_I])
  assert.deepEqual(stationPartIndexes(t.orders[c].items[0], t.cfg.stations[PASS]), [0, 1, 2, 3, 4, 5])
  // The same part twice is one row, ticked off together.
  assert.deepEqual(partRows(fryer.parts).map(r => [r.part.name, r.count, r.indexes]), [['Fries', 1, [FRIES_I]], ['Onion rings', 1, [RINGS_I]], ['Ketchup pot', 2, KETCHUP]])
})

test('prep: parts done one by one; the last one is the dish done (and the bump)', () => {
  const t = till(kitchenCfg())
  const { c, meal } = sendMeal(t)
  ok(done(t, c, meal, FRYER, [FRIES_I]))
  assert.deepEqual(ticked(t, FRYER), ['Fries'])
  assert.equal(t.orders[c].items[0].done[FRYER], undefined, 'one part: the meal stays at the fryer')
  assert.equal(itemAt(t, FRYER).parts_ticked, 1)
  assert.equal(itemAt(t, FRYER).state, 'active')
  // Again, a part made elsewhere, a part the dish hasn't got, one not done yet.
  assert.equal(done(t, c, meal, FRYER, [FRIES_I]).code, 'nothing')
  const away = done(t, c, meal, FRYER, [BURGER_I])
  assert.equal(away.code, 'parts')
  assert.match(away.error, /Burger isn't made at Fryer/)
  assert.equal(done(t, c, meal, FRYER, [20]).code, 'parts')
  assert.equal(done(t, c, meal, FRYER, [RINGS_I], false).code, 'nothing')
  const friesAt = t.orders[c].items[0].part_ticks[FRYER][FRIES_I]
  assert.ok(friesAt)
  // One pot of two: the row isn't ticked until both are.
  ok(done(t, c, meal, FRYER, [4]))
  assert.deepEqual(partRows(itemAt(t, FRYER).parts).map(r => [r.part.name, r.ticked]), [['Fries', true], ['Onion rings', false], ['Ketchup pot', false]])
  ok(done(t, c, meal, FRYER, [4], false))
  // A row of two: both pots at once.
  ok(done(t, c, meal, FRYER, KETCHUP))
  assert.deepEqual(ticked(t, FRYER), ['Fries', 'Ketchup pot', 'Ketchup pot'])
  assert.deepEqual(partRows(itemAt(t, FRYER).parts).map(r => r.ticked), [true, false, true])
  // Each part keeps when it was first ticked.
  assert.equal(t.orders[c].items[0].part_ticks[FRYER][FRIES_I], friesAt)
  assert.ok(t.orders[c].items[0].part_ticks[FRYER][4] > friesAt)
  // The last part: the meal is done here, the ticket goes, it counts as the bump.
  const r = ok(done(t, c, meal, FRYER, [RINGS_I]))
  assert.ok(t.orders[c].items[0].done[FRYER])
  assert.equal(t.orders[c].items[0].part_ticks, undefined, 'part ticks are kept only until the dish is done')
  assert.equal(t.tickets(FRYER).length, 0)
  assert.deepEqual(r.log.map(x => x.kind), ['bump'])
  assert.equal(t.orders[c].bumps.at(-1).by_items, true)
  // The grill makes one part: that part is the dish.
  ok(done(t, c, meal, GRILL, [BURGER_I]))
  assert.ok(t.orders[c].items[0].done[GRILL])
})

test('prep: one part undone on a dish done there; the whole dish undone; the dish moved on', () => {
  const t = till(kitchenCfg({ show_upcoming: false }))
  const { c, meal } = sendMeal(t)
  ok(done(t, c, meal, FRYER))
  assert.deepEqual(ticked(t, FRYER), [], 'done: the ticket has gone')
  // The fries weren't right after all: the meal comes back with the rest still done.
  const r = ok(done(t, c, meal, FRYER, [FRIES_I], false))
  assert.equal(t.orders[c].items[0].done[FRYER], undefined)
  assert.deepEqual(ticked(t, FRYER), ['Onion rings', 'Ketchup pot', 'Ketchup pot'])
  assert.deepEqual(r.log.map(x => x.kind), ['recall'], 'its bump no longer counts')
  // A part not done can't be undone; the whole dish undone takes its parts with it.
  assert.equal(done(t, c, meal, FRYER, [FRIES_I], false).code, 'nothing')
  ok(done(t, c, meal, FRYER, null, false))
  assert.deepEqual(ticked(t, FRYER), [])
  assert.equal(done(t, c, meal, FRYER, null, false).code, 'nothing')
  // The whole dish done at once, with parts already ticked: all of it.
  ok(done(t, c, meal, FRYER, [RINGS_I]))
  ok(done(t, c, meal, FRYER))
  assert.ok(t.orders[c].items[0].done[FRYER])
  // Done everywhere and READY at the pass: a part can't be undone at the fryer any more.
  ok(done(t, c, meal, GRILL))
  ok(done(t, c, meal, BAR))
  ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: PASS })))
  assert.equal(done(t, c, meal, FRYER, [FRIES_I], false).code, 'moved_on')
  // At the pass, item_done doesn't take parts (the pass ticks parts off).
  assert.equal(done(t, c, meal, PASS, [FRIES_I]).code, 'station')
})

test('prep: a BUMP with parts half ticked; Prev brings them back as they were; a remake clears them', () => {
  const t = till(kitchenCfg())
  const { c, meal } = sendMeal(t)
  ok(done(t, c, meal, FRYER, [FRIES_I]))
  ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: FRYER })))
  assert.equal(t.tickets(FRYER).length, 0)
  ok(t.kitchen(kev('kitchen.recalled', { order_id: c, station_id: FRYER })))
  assert.deepEqual(ticked(t, FRYER), ['Fries'])
  ok(done(t, c, meal, FRYER, [RINGS_I]))
  ok(t.kitchen(kev('kitchen.remake', { order_id: c, station_id: FRYER, item_id: meal.id, reason: 'Dropped' })))
  assert.deepEqual(ticked(t, FRYER), [])
  assert.equal(t.orders[c].items[0].part_ticks, undefined)
})

test('pass: parts ticked off one by one; the last one ticks the dish off', () => {
  const t = till(kitchenCfg())
  const { c, meal } = sendMeal(t)
  for (const s of [GRILL, FRYER, BAR]) ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: s })))
  let tk = t.tickets(PASS)[0]
  assert.deepEqual(tk.items[0].parts.map(p => p.index), [0, 1, 2, 3, 4, 5])
  ok(tick(t, c, meal, [BURGER_I]))
  ok(tick(t, c, meal, [COLA_I, FRIES_I]))
  tk = t.tickets(PASS)[0]
  assert.deepEqual(tk.items[0].parts.filter(p => p.ticked).map(p => p.name), ['Burger', 'Fries', 'Cola'])
  assert.equal(tk.items[0].ticked, false, 'some parts: the meal isn\'t ticked off')
  assert.equal(tk.ticked, 0)
  assert.equal(tk.all_ticked, false)
  assert.equal(tick(t, c, meal, [BURGER_I]).code, 'nothing')
  assert.equal(tick(t, c, meal, [9]).code, 'parts')
  // Untick one that is ticked, and one that isn't.
  ok(tick(t, c, meal, [COLA_I], false))
  assert.equal(tick(t, c, meal, [COLA_I], false).code, 'nothing')
  ok(tick(t, c, meal, [COLA_I, RINGS_I]))
  // The last parts: the meal is ticked off, the ticket CHECKED, still waiting for READY.
  ok(tick(t, c, meal, KETCHUP))
  tk = t.tickets(PASS)[0]
  assert.equal(tk.items[0].ticked, true)
  assert.equal(tk.all_ticked, true)
  assert.equal(tk.items[0].parts.every(p => p.ticked), true)
  assert.equal(t.orders[c].items[0].part_ticks, undefined)
  assert.equal(t.orders[c].status, 'active')
  assert.equal(tick(t, c, meal, [FRIES_I]).code, 'nothing', 'the whole meal is ticked off already')
  // One part unticked on a meal ticked off: the meal isn't, its other parts still are.
  ok(tick(t, c, meal, [FRIES_I], false))
  tk = t.tickets(PASS)[0]
  assert.equal(tk.items[0].ticked, false)
  assert.equal(tk.all_ticked, false)
  assert.deepEqual(tk.items[0].parts.filter(p => !p.ticked).map(p => p.name), ['Fries'])
  // The whole meal unticked: no parts ticked.
  ok(tick(t, c, meal, null, false))
  assert.deepEqual(t.tickets(PASS)[0].items[0].parts.filter(p => p.ticked), [])
  // Prep stations mark parts done; the pass's item_checked is the pass's only.
  assert.equal(tick(t, c, meal, [FRIES_I], true, FRYER).code, 'station')
  // Some parts ticked off, then the meal sent back from the pass to be made again: they go.
  ok(tick(t, c, meal, [BURGER_I, COLA_I]))
  ok(t.kitchen(kev('kitchen.remake', { order_id: c, station_id: PASS, item_id: meal.id, reason: 'Wrong burger' })))
  assert.equal(t.orders[c].items[0].part_ticks, undefined)
})

test('pass: with bump when every dish is ticked, the last part bumps the ticket', () => {
  const t = till(kitchenCfg({ bump_when_checked: true }))
  const { c, meal } = sendMeal(t)
  for (const s of [GRILL, FRYER, BAR]) ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: s })))
  ok(tick(t, c, meal, [0, 1, 2, 3]))
  assert.equal(t.orders[c].status, 'active')
  const r = ok(tick(t, c, meal, KETCHUP))
  assert.deepEqual(r.log.map(x => x.kind), ['bump'])
  assert.equal(t.orders[c].status, 'ready')
  assert.equal(t.tickets(PASS).length, 0)
  // Prev: back with the meal ticked off, so every part shows ticked.
  ok(t.kitchen(kev('kitchen.recalled', { order_id: c, station_id: PASS })))
  assert.equal(t.tickets(PASS)[0].items[0].parts.every(p => p.ticked), true)
})

test('pass: parts ticked on a meal still on its way; sent back to the fryer, the pass\'s part ticks go', () => {
  const t = till(kitchenCfg())
  const { c, meal } = sendMeal(t)
  ok(t.kitchen(kev('kitchen.bumped', { order_id: c, station_id: GRILL })))
  // Still at the fryer and the bar: parts can be ticked off at a pass that shows them.
  assert.equal(itemAt(t, PASS).state, 'upcoming')
  ok(tick(t, c, meal, [BURGER_I]))
  assert.equal(t.orders[c].items[0].done[FRYER], undefined, 'a part ticked off finishes nothing before the pass')
  assert.deepEqual(ticked(t, PASS), ['Burger'])
  // The fryer done, then undone: the meal goes back to the fryer and the pass's ticks go.
  ok(done(t, c, meal, FRYER))
  ok(done(t, c, meal, FRYER, null, false))
  assert.deepEqual(ticked(t, PASS), [])
  // Every part ticked off at the pass while upcoming: the meal is in front of the pass,
  // so it is done at the stations still waiting for it.
  ok(tick(t, c, meal, [0, 1, 2, 3, 4, 5]))
  assert.ok(t.orders[c].items[0].done[FRYER])
  assert.ok(t.orders[c].items[0].done[BAR])
  // A remake from the pass starts it all again.
  ok(t.kitchen(kev('kitchen.remake', { order_id: c, station_id: PASS, item_id: meal.id, reason: 'Cold' })))
  assert.deepEqual(ticked(t, PASS), [])
  assert.equal(t.orders[c].items[0].checked, undefined)
  // A pass that doesn't show dishes on their way can't tick their parts.
  const hidden = till(kitchenCfg({ show_upcoming: false }))
  const h = sendMeal(hidden)
  assert.equal(tick(hidden, h.c, h.meal, [BURGER_I]).code, 'upcoming')
})

test('a dish that isn\'t a meal deal has no parts to tick', () => {
  const t = till(kitchenCfg())
  const fries = { id: ulid(), item_id: FRIES, section_id: SIDES, name: 'Fries', qty: 1, unit_price: 300, modifiers: [], vat_rate: 20 }
  const { c } = sendMeal(t, [fries])
  const r = done(t, c, fries, FRYER, [0])
  assert.equal(r.code, 'parts')
  assert.equal(partRows(null).length, 0)
  const plain = t.tickets(FRYER)[0].items.find(i => i.name === 'Fries')
  assert.equal(plain.parts, null)
  assert.equal(plain.parts_ticked, 0)
})
