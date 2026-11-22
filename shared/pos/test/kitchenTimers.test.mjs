// Kitchen flow timers (OUTSTANDING 44.9): tidying what the designer sends,
// what blocks saving, a shared flow's timers at a location, and the spans
// and figures worked out from real kitchen orders (till events run through
// the check rules and the kitchen, as the sequencer does).
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent } from '../checks.js'
import { kitchenForCheckEvent, applyKitchenEvent, START } from '../kitchen.js'
import {
  normaliseTimers, timerProblems, resolveTimers, timerSpan, timerResults, summarise, timerLabel, MAX_TIMERS, canEndTimer,
} from '../kitchenTimers.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid()
const ANNA = uuid()
const staffById = { [ANNA]: { id: ANNA, name: 'Anna', permissions: { void: true } } }
const BURGERS = uuid(), SIDES = uuid(), BURGER = uuid(), FRIES = uuid(), TABLE5 = uuid(), EAT = uuid(), RC = uuid()
const GRILL = uuid(), FRYER = uuid(), PASS = uuid(), BOARD = uuid()
const stations = {
  [GRILL]: { id: GRILL, name: 'Grill', kind: 'prep', settings: {} },
  [FRYER]: { id: FRYER, name: 'Fryer', kind: 'prep', settings: {} },
  [PASS]: { id: PASS, name: 'Pass', kind: 'expo', settings: {} },
  [BOARD]: { id: BOARD, name: 'Board', kind: 'board', settings: {} },
}
const link = (from, to, ...targets) => ({ id: uuid(), from, to, targets: targets.map(([kind, id]) => ({ kind, id })) })
const cfg = {
  enabled: true, stations, courses: {}, tables: { [TABLE5]: { label: '5' } }, staff: { [ANNA]: { name: 'Anna' } },
  order_types: { [EAT]: { name: 'Eat in' } }, revenue_streams: { [RC]: { name: 'Restaurant' } },
  flow: [link(null, GRILL, ['section', BURGERS]), link(null, FRYER, ['section', SIDES]), link(GRILL, PASS), link(FRYER, PASS), link(PASS, BOARD)],
}

let clock = Date.parse('2026-11-22T12:00:00Z')
const at = () => new Date(clock).toISOString()
function ev(type, payload, { check_id = null, staff_id = ANNA, device = 'T1', step = 1000 } = {}) {
  clock += step
  const t = at()
  return { id: ulid(clock), venue_id: VENUE, device_id: device, staff_id, check_id, type, payload, client_at: t, received_at: t }
}
const ok = r => { assert.ok(r.ok, r.error); return r }
function till() {
  let checks = {}
  let orders = {}
  return {
    get orders() { return orders },
    send(e) {
      const before = checks
      const r = ok(applyEvent(checks, e, { staffById }))
      checks = { ...checks, ...r.checks }
      orders = { ...orders, ...kitchenForCheckEvent(e, before, r.checks, orders, cfg) }
    },
    bump(orderId, station, mins) {
      const r = applyKitchenEvent(orders, ev('kitchen.bumped', { order_id: orderId, station_id: station }, { staff_id: null, device: 'K1', step: mins * 60_000 }), cfg)
      assert.ok(r.ok, r.error)
      orders = { ...orders, ...r.orders }
    },
  }
}
const line = (name, item_id, section_id) => ({ id: ulid(), item_id, section_id, name, qty: 1, unit_price: 500, modifiers: [], vat_rate: 20 })
function order(t, lines) {
  const id = ulid()
  t.send(ev('check.opened', { mode: 'table', table_id: TABLE5, revenue_stream_id: RC, order_type_id: EAT, number: 12 }, { check_id: id }))
  for (const l of lines) t.send(ev('line.added', { line: l }, { check_id: id }))
  t.send(ev('lines.sent', { send_id: ulid(), line_ids: lines.map(l => l.id), held_course_ids: [] }, { check_id: id }))
  return Object.values(t.orders).find(o => o.check_id === id)
}

test('normaliseTimers keeps tidy timers, drops ones without both ends, caps the count', () => {
  const list = normaliseTimers([
    { id: 'a', name: '  Grill   to pass ', from: GRILL, to: PASS, per: 'ticket', target_mins: 7.4, from_when: 'done' },
    { id: 'a', from: START, to: PASS, from_when: 'done', target_mins: 0 },
    { from: GRILL },
    null,
    { id: 'bad id!', from: FRYER, to: PASS, per: 'nope', target_mins: 999 },
  ])
  assert.equal(list.length, 3)
  assert.deepEqual(list[0], { id: 'a', name: 'Grill to pass', from: GRILL, from_when: 'done', to: PASS, per: 'ticket', target_mins: 7 })
  assert.notEqual(list[1].id, 'a', 'ids stay unique')
  assert.equal(list[1].from_when, 'reached', 'Orders in has only one moment')
  assert.equal(list[1].target_mins, 1)
  assert.match(list[2].id, /^tm-/)
  assert.equal(list[2].per, 'dish')
  assert.equal(list[2].target_mins, 240)
  const many = Array.from({ length: 30 }, () => ({ from: START, to: PASS }))
  assert.equal(normaliseTimers(many).length, MAX_TIMERS)
})

test('timerProblems: a timer ends at a box someone taps, in this flow, not where it starts', () => {
  assert.ok(canEndTimer('expo') && canEndTimer('prep') && canEndTimer('runner'))
  assert.ok(!canEndTimer('board') && !canEndTimer('printer') && !canEndTimer('sleeper'))
  const nodes = Object.fromEntries(Object.values(stations).map(s => [s.id, { name: s.name, kind: s.kind }]))
  assert.deepEqual(timerProblems([{ from: START, to: PASS, target_mins: 5 }, { from: GRILL, to: PASS, target_mins: 3 }], nodes), [])
  assert.match(timerProblems([{ from: START, to: PASS, target_mins: null }], nodes).join(), /needs a target/)
  assert.match(timerProblems([{ from: GRILL, to: BOARD }], nodes).join(), /must end at a box someone taps.*Board/)
  assert.match(timerProblems([{ from: uuid(), to: PASS }], nodes).join(), /starts at a box that isn't in this flow/)
  assert.match(timerProblems([{ from: GRILL, to: uuid() }], nodes).join(), /ends at a box that isn't in this flow/)
  assert.match(timerProblems([{ from: PASS, to: PASS }], nodes).join(), /same box/)
  assert.equal(timerLabel({ from: START, to: PASS }, { [PASS]: 'Pass' }), 'Orders in to Pass')
  assert.equal(timerLabel({ name: 'Ticket time', from: START, to: PASS }, {}), 'Ticket time')
})

test('resolveTimers turns a shared flow\'s boxes into the location\'s stations', () => {
  const boxG = uuid(), boxP = uuid(), boxX = uuid()
  const r = resolveTimers(
    [{ id: 'a', from: START, to: boxP }, { id: 'b', from: boxG, to: boxP }, { id: 'c', from: boxX, to: boxP }],
    { [boxG]: GRILL, [boxP]: PASS },
  )
  assert.deepEqual(r.timers.map(t => [t.id, t.from, t.to]), [['a', START, PASS], ['b', GRILL, PASS]])
  assert.deepEqual(r.missing.map(t => t.id), ['c'])
})

test('spans from real kitchen orders: Orders in, reached and done starts, per dish and per ticket', () => {
  const t = till()
  const o = order(t, [line('Burger', BURGER, BURGERS), line('Fries', FRIES, SIDES)])
  const sent = Date.parse(o.items[0].sent_at)
  t.bump(o.id, FRYER, 3) // fries done at the fryer 3 min in
  t.bump(o.id, GRILL, 5) // burger done at the grill 8 min in
  t.bump(o.id, PASS, 2) // both done at the pass 10 min in
  const live = t.orders[o.id]
  const [burger, fries] = ['Burger', 'Fries'].map(n => live.items.find(i => i.name === n))
  const mins = s => Math.round(s.seconds / 60)
  const now = at()

  assert.equal(mins(timerSpan(burger, { from: START, to: PASS }, cfg, now)), 10)
  assert.equal(timerSpan(burger, { from: START, to: PASS }, cfg, now).start, new Date(sent).toISOString())
  // Reaching the grill is the send; done at the grill is 8 minutes in.
  assert.equal(mins(timerSpan(burger, { from: GRILL, from_when: 'reached', to: PASS }, cfg, now)), 10)
  assert.equal(mins(timerSpan(burger, { from: GRILL, from_when: 'done', to: PASS }, cfg, now)), 2)
  assert.equal(mins(timerSpan(fries, { from: FRYER, from_when: 'done', to: PASS }, cfg, now)), 7)
  // The fries never pass the grill; nothing ends at a board.
  assert.equal(timerSpan(fries, { from: GRILL, to: PASS }, cfg, now), null)
  assert.equal(timerSpan(burger, { from: GRILL, to: BOARD }, cfg, now), null)
  // A start after the end in the dish's way counts nothing.
  assert.equal(timerSpan(burger, { from: PASS, to: GRILL }, cfg, now), null)

  const perDish = timerResults([live], { from: START, to: PASS, per: 'dish', target_mins: 9 }, cfg, now)
  assert.equal(perDish.count, 2)
  assert.equal(perDish.on_time, 0)
  assert.equal(perDish.slowest[0].item, 'Burger')
  const perTicket = timerResults([live], { from: START, to: PASS, per: 'ticket', target_mins: 10 }, cfg, now)
  assert.equal(perTicket.count, 1)
  assert.equal(perTicket.on_time_pct, 100)
  assert.equal(perTicket.slowest[0].item, null)
  assert.equal(perTicket.slowest[0].number, live.number)
})

test('a ticket counts once its every dish is tapped at the end; voided dishes don\'t count', () => {
  const t = till()
  const o = order(t, [line('Burger', BURGER, BURGERS), line('Fries', FRIES, SIDES)])
  t.bump(o.id, FRYER, 2)
  const halfway = t.orders[o.id]
  // Fries are through the fryer, the burger is still at the grill: nothing at the pass yet.
  assert.equal(timerResults([halfway], { from: START, to: PASS, per: 'ticket', target_mins: 10 }, cfg, at()).count, 0)
  // A dish done at the pass while another is still on its way keeps the ticket open.
  const fries = halfway.items.find(i => i.name === 'Fries')
  const burger = halfway.items.find(i => i.name === 'Burger')
  const mixed = { ...halfway, items: [{ ...fries, done: { ...fries.done, [PASS]: at() } }, burger] }
  assert.equal(timerResults([mixed], { from: START, to: PASS, per: 'ticket', target_mins: 10 }, cfg, at()).count, 0)
  assert.equal(timerResults([mixed], { from: START, to: PASS, per: 'dish', target_mins: 10 }, cfg, at()).count, 1)
  // Void the burger: the ticket is the fries alone.
  const voided = { ...mixed, items: [mixed.items[0], { ...burger, voided_at: at() }] }
  assert.equal(timerResults([voided], { from: START, to: PASS, per: 'ticket', target_mins: 10 }, cfg, at()).count, 1)
})

test('summarise: average, median and 90th as Postgres works them out, on time against the target', () => {
  const s = summarise([60, 120, 180, 240, 600].map(seconds => ({ seconds })), 3)
  assert.equal(s.count, 5)
  assert.equal(s.avg_secs, 240)
  assert.equal(s.median_secs, 180)
  assert.equal(s.p90_secs, 456)
  assert.equal(s.max_secs, 600)
  assert.equal(s.on_time, 3)
  assert.equal(s.on_time_pct, 60)
  assert.deepEqual(s.slowest.map(r => r.seconds), [600, 240, 180, 120, 60])
  const none = summarise([], 5)
  assert.deepEqual([none.count, none.avg_secs, none.median_secs, none.on_time_pct], [0, null, null, null])
})
