// Order flows (migration 235, shared/pos/orderFlows.js): prompts that offer
// dishes when a dish is added or at checkout, and dishes and charges an add
// flow puts on by itself while the order matches, with the check rules
// (shared/pos/checks.js) the till, the cloud's sequencer and the venue hub
// all apply to them.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../ids.js'
import { applyEvent, replay } from '../checks.js'
import { checkTotals } from '../pricing.js'
import { chargeFromList, switchCharges, chargesWhere } from '../charges.js'
import {
  normaliseOrderFlow, orderFlowList, newOrderFlow, flowProblems, flowWarnings, flowRunsHere, flowsHere,
  orderDishes, addedDishes, flowMatches, askFlowsFor, askChoices, addKey, flowAddsFor, flowSyncPlan, planEmpty,
  flowChargeAdd, flowIds, ownFlow, flowSummary, flowIfLines, flowThenLines, flowWhereText, flowWhenText, orList,
} from '../orderFlows.js'

const uuid = () => globalThis.crypto.randomUUID()
const VENUE = uuid(), OTHER_VENUE = uuid()
const TILL = uuid(), BAR_TILL = uuid()
const SERVER = uuid(), SUPER = uuid()
const staffById = {
  // May void sent items, can't approve.
  [SERVER]: { id: SERVER, name: 'Anna', permissions: { void: true } },
  [SUPER]: { id: SUPER, name: 'Ben', permissions: { void: true, manager: true } },
}
const RESTAURANT = uuid(), BAR = uuid()
const EAT_IN = uuid(), TAKE_OUT = uuid()
const BURGERS = uuid(), DRINKS = uuid(), SIDES = uuid()
const BURGER = uuid(), COKE = uuid(), WATER = uuid(), FRIES = uuid(), BAG_ITEM = uuid(), MEAL = uuid()
const BAG_CHARGE = { id: uuid(), name: 'Bag', kind: 'amount', value: 10, optional: false, min_covers: 0, tax_rate_id: null }
const SERVICE = { id: uuid(), name: 'Service charge', kind: 'percent', value: 12.5, optional: true, min_covers: 0, tax_rate_id: null }

let clock = Date.parse('2026-11-03T12:00:00Z')
function ev(type, payload, { check_id = null, staff_id = SERVER, approved_by = null, device_id = TILL } = {}) {
  clock += 1000
  return { id: ulid(clock), venue_id: VENUE, device_id, staff_id, approved_by, check_id, type, payload, client_at: new Date(clock).toISOString(), assigned: { day_id: 'day-1' } }
}
const dish = (item_id, section_id, name, price, extra = {}) => ({
  id: ulid(), item_id, section_id, name, qty: 1, unit_price: price, modifiers: [], combo: null, vat_rate: 20, ...extra,
})
const here = { venueId: VENUE, deviceId: TILL, app: 'till', streams: { [RESTAURANT]: 'Restaurant', [BAR]: 'Bar' } }

// Ask "Add a drink?" when a burger is added, offering Coke and Water.
const DRINK_ASK = normaliseOrderFlow({
  id: uuid(), name: 'Drink with a burger', kind: 'ask', trigger: 'dish_added',
  match: { section_ids: [BURGERS] },
  ask: { title: 'Add a drink?', item_ids: [COKE, WATER], pick: 'one' },
})
// At checkout, take out orders without a side are offered fries.
const FRIES_ASK = normaliseOrderFlow({
  id: uuid(), name: 'Fries at checkout', kind: 'ask', trigger: 'checkout',
  match: { type_ids: [TAKE_OUT], not_section_ids: [SIDES] },
  ask: { title: 'Any fries?', item_ids: [FRIES], pick: 'several', skip_if_has: false },
})
// Take out at the restaurant: a paper bag nobody may take off, and the bag charge.
const BAG_FLOW = normaliseOrderFlow({
  id: uuid(), name: 'Take out bag', kind: 'add',
  match: { stream_names: ['Restaurant'], type_ids: [TAKE_OUT] },
  adds: [
    { kind: 'dish', item_id: BAG_ITEM, qty: 1, removable: false },
    { kind: 'charge', charge_id: BAG_CHARGE.id, removable: false },
  ],
})
// Eat in: the (optional) service charge, but one staff may not take off when a flow puts it on.
const SERVICE_FLOW = normaliseOrderFlow({
  id: uuid(), name: 'Service by itself', kind: 'add', match: { type_ids: [EAT_IN] },
  adds: [{ kind: 'charge', charge_id: SERVICE.id, removable: false }],
})
const FLOWS = [DRINK_ASK, FRIES_ASK, BAG_FLOW, SERVICE_FLOW]
const settings = { charges: [BAG_CHARGE, SERVICE], flows: FLOWS }

function open({ type = EAT_IN, stream = RESTAURANT, lines = [] } = {}) {
  const id = ulid()
  const events = [
    ev('check.opened', { mode: 'counter', revenue_stream_id: stream, order_type_id: type }, { check_id: id }),
    ...lines.map(l => ev('line.added', { line: l }, { check_id: id })),
  ]
  const r = replay({}, events, { staffById, settings })
  assert.equal(r.refused.length, 0, JSON.stringify(r.refused))
  return { id, checks: r.checks, check: r.checks[id] }
}
const apply = (checks, e, s = settings) => applyEvent(checks, e, { staffById, settings: s })
const ok = r => { assert.ok(r.ok, r.error); return r }

// The till's sync (pos/src/lib/orderFlows.js) as events: what flowSyncPlan says, in order.
function syncEvents(check, flows = FLOWS, h = here) {
  const plan = flowSyncPlan(check, flowAddsFor(flows, check, h))
  const out = []
  for (const w of plan.addDishes) {
    out.push(ev('line.added', { line: { ...dish(w.item_id, SIDES, 'Paper bag', 0), qty: w.qty, flow: { id: w.flow_id, key: w.key, removable: w.removable } } }, { check_id: check.id }))
  }
  for (const id of plan.removeLines) out.push(ev('line.deleted', { line_id: id, by_flow: true }, { check_id: check.id }))
  for (const w of plan.addCharges) {
    const x = settings.charges.find(c => c.id === w.charge_id)
    out.push(ev('charge.added', { charge: { ...chargeFromList(x, VENUE, []), list: true, optional: w.removable, flow: { id: w.flow_id, key: w.key } } }, { check_id: check.id }))
  }
  for (const id of plan.dropCharges) out.push(ev('charge.removed', { charge_id: id, by_flow: true }, { check_id: check.id }))
  return out
}
function sync(checks, id, flows = FLOWS) {
  let state = checks
  for (const e of syncEvents(state[id], flows)) state = { ...state, ...ok(apply(state, e)).checks }
  return state
}

test('a flow\'s shape: kinds, triggers, defaults, limits, rows from the API', () => {
  const id = uuid()
  const f = normaliseOrderFlow({ id, name: '  Drinks  ', kind: 'ask', trigger: 'nope', ask: { title: ' Add a drink? ', item_ids: [COKE, COKE, 'x', WATER] } })
  assert.equal(f.name, 'Drinks')
  assert.equal(f.trigger, 'dish_added', 'an unknown trigger is a dish being added')
  assert.deepEqual(f.ask.item_ids, [COKE, WATER], 'the same dish once, bad ids dropped')
  assert.equal(f.ask.pick, 'one')
  assert.equal(f.ask.skip_if_has, true, 'not when the order has one already, unless switched off')
  assert.deepEqual(f.apps, ['till'])
  assert.equal(f.venue_ids, null)
  assert.equal(f.device_ids, null)
  assert.deepEqual(f.adds, [])
  assert.equal(f.on, true)
  // An add flow is always "as soon as the order matches", never asks.
  const a = normaliseOrderFlow({
    id, kind: 'add', trigger: 'checkout', ask: { title: 'x' },
    adds: [{ kind: 'dish', item_id: BAG_ITEM, qty: 99 }, { kind: 'dish', item_id: BAG_ITEM, qty: 2 }, { kind: 'charge', charge_id: 'x' }, { kind: 'charge', charge_id: SERVICE.id, removable: false }],
  })
  assert.equal(a.trigger, 'match')
  assert.equal(a.ask, null)
  assert.deepEqual(a.adds, [
    { kind: 'dish', item_id: BAG_ITEM, qty: 20, removable: true },
    { kind: 'charge', charge_id: SERVICE.id, removable: false },
  ], 'the same dish once, quantities up to 20, bad charges dropped')
  // The API's row: name / is_active / sort_order as columns, the rest in flow.
  const row = normaliseOrderFlow({ id, name: 'Row', is_active: false, sort_order: 3, flow: { kind: 'add', adds: [{ kind: 'dish', item_id: FRIES }] } })
  assert.equal(row.on, false)
  assert.equal(row.sort_order, 3)
  assert.equal(row.kind, 'add')
  assert.equal(row.adds[0].item_id, FRIES)
  assert.equal(normaliseOrderFlow({ id: 'x' }), null)
  assert.equal(normaliseOrderFlow(null), null)
  assert.equal(orderFlowList([DRINK_ASK, null, { id: 'bad' }]).length, 1)
  const fresh = newOrderFlow(uuid(), 'add')
  assert.equal(fresh.kind, 'add')
  assert.equal(fresh.name, 'Add by itself')
})

test('what stops a flow being saved, and what is only worth knowing', () => {
  assert.deepEqual(flowProblems(DRINK_ASK), [])
  assert.deepEqual(flowProblems(BAG_FLOW), [])
  const codes = f => flowProblems(f).map(p => p.code)
  assert.deepEqual(codes({ ...DRINK_ASK, name: '' }), ['name'])
  assert.deepEqual(codes({ ...DRINK_ASK, ask: { ...DRINK_ASK.ask, title: '', item_ids: [] } }), ['ask_title', 'ask_choices'])
  assert.deepEqual(codes({ ...BAG_FLOW, adds: [] }), ['adds'])
  assert.deepEqual(codes({ ...BAG_FLOW, venue_ids: [], device_ids: [] }), ['devices', 'venues'])
  const warn = f => flowWarnings(f).map(p => p.code)
  assert.deepEqual(warn({ ...BAG_FLOW, match: normaliseOrderFlow({ id: uuid() }).match }), ['every_order'])
  assert.deepEqual(warn({ ...FRIES_ASK, match: normaliseOrderFlow({ id: uuid() }).match }), ['every_checkout'])
  assert.deepEqual(warn({ ...DRINK_ASK, match: { ...DRINK_ASK.match, item_ids: [COKE] }, ask: { ...DRINK_ASK.ask, skip_if_has: false } }), ['offers_itself'])
  assert.deepEqual(warn({ ...DRINK_ASK, on: false }), ['off'])
})

test('where a flow runs: switched on, its locations, its tills, its apps', () => {
  assert.ok(flowRunsHere(DRINK_ASK, here))
  assert.ok(!flowRunsHere({ ...DRINK_ASK, on: false }, here))
  assert.ok(!flowRunsHere({ ...DRINK_ASK, venue_ids: [OTHER_VENUE] }, here))
  assert.ok(flowRunsHere({ ...DRINK_ASK, venue_ids: [OTHER_VENUE, VENUE] }, here))
  assert.ok(!flowRunsHere({ ...DRINK_ASK, device_ids: [BAR_TILL] }, here))
  assert.ok(flowRunsHere({ ...DRINK_ASK, device_ids: [BAR_TILL] }, { ...here, deviceId: BAR_TILL }))
  assert.ok(!flowRunsHere(DRINK_ASK, { ...here, app: 'kiosk' }), 'tills only for now')
  assert.deepEqual(flowsHere([DRINK_ASK, { ...BAG_FLOW, on: false }], here).map(f => f.id), [DRINK_ASK.id])
})

test('the order\'s dishes: active lines and meal deal parts, flow dishes left out', () => {
  const meal = dish(MEAL, BURGERS, 'Burger meal', 900, { combo: [{ item_id: BURGER, section_id: BURGERS, name: 'Burger' }, { item_id: COKE, section_id: DRINKS, name: 'Coke' }] })
  const { check } = open({ lines: [meal, dish(FRIES, SIDES, 'Fries', 300, { flow: { id: BAG_FLOW.id, key: BAG_FLOW.id + ':dish:' + FRIES, removable: true } })] })
  assert.deepEqual(orderDishes(check).map(d => d.item_id), [MEAL, BURGER, COKE])
  assert.deepEqual(orderDishes(check, { flowLines: true }).map(d => d.item_id), [MEAL, BURGER, COKE, FRIES])
  assert.deepEqual(addedDishes(meal).map(d => d.item_id), [MEAL, BURGER, COKE])
  assert.deepEqual(addedDishes({ id: BURGER, section_id: BURGERS }), [{ item_id: BURGER, section_id: BURGERS }], 'a till item works too')
})

test('If: channel, order type, the dish added or the order\'s dishes, none of, and the dishes offered', () => {
  const burger = dish(BURGER, BURGERS, 'Burger', 1000)
  const { check } = open({ type: TAKE_OUT, lines: [burger] })
  // A dish added: the burger is from Burgers; Coke isn't.
  assert.ok(flowMatches(DRINK_ASK, check, { added: addedDishes(burger) }))
  assert.ok(!flowMatches(DRINK_ASK, check, { added: addedDishes(dish(COKE, DRINKS, 'Coke', 300)) }))
  assert.ok(!flowMatches(DRINK_ASK, check, {}), 'no dish added, nothing to match')
  // A meal deal holding a burger counts as a burger added.
  assert.ok(flowMatches(DRINK_ASK, check, { added: addedDishes(dish(MEAL, null, 'Meal', 900, { combo: [{ item_id: BURGER, section_id: BURGERS }] })) }))
  // The dishes offered: the order has a Coke already, so it isn't asked.
  const withCoke = open({ type: TAKE_OUT, lines: [burger, dish(COKE, DRINKS, 'Coke', 300)] }).check
  assert.ok(!flowMatches(DRINK_ASK, withCoke, { added: addedDishes(burger) }))
  // ...unless the flow says to ask anyway.
  assert.ok(flowMatches({ ...DRINK_ASK, ask: { ...DRINK_ASK.ask, skip_if_has: false } }, withCoke, { added: addedDishes(burger) }))
  // Order type and none of: take out without a side.
  assert.ok(flowMatches(FRIES_ASK, check))
  assert.ok(!flowMatches(FRIES_ASK, open({ type: EAT_IN, lines: [burger] }).check), 'eat in')
  assert.ok(!flowMatches(FRIES_ASK, open({ type: TAKE_OUT, lines: [burger, dish(FRIES, SIDES, 'Fries', 300)] }).check), 'has a side')
  // A side a flow put on doesn't count.
  const flowSide = dish(FRIES, SIDES, 'Fries', 0, { flow: { id: BAG_FLOW.id, key: BAG_FLOW.id + ':dish:x', removable: true } })
  assert.ok(flowMatches(FRIES_ASK, open({ type: TAKE_OUT, lines: [burger, flowSide] }).check))
  // A voided side doesn't count either: it isn't on the order.
  // Channel (revenue stream, by name): the restaurant's take out gets the bag, the bar's doesn't.
  assert.ok(flowMatches(BAG_FLOW, check, { streams: here.streams }))
  assert.ok(!flowMatches(BAG_FLOW, open({ type: TAKE_OUT, stream: BAR }).check, { streams: here.streams }))
  assert.ok(!flowMatches(BAG_FLOW, check), 'a channel the till can\'t name doesn\'t match')
  // Every kind given must hold, any entry of a kind will do.
  const both = normaliseOrderFlow({ ...BAG_FLOW, match: { stream_names: ['bar', ' RESTAURANT '], type_ids: [EAT_IN, TAKE_OUT], item_ids: [BURGER] } })
  assert.ok(flowMatches(both, check, { streams: here.streams }), 'channel names in any case')
  assert.deepEqual(both.match.stream_names, ['bar', 'RESTAURANT'])
  assert.deepEqual(normaliseOrderFlow({ ...BAG_FLOW, match: { stream_names: ['Bar', 'BAR', ' bar '] } }).match.stream_names, ['Bar'], 'the same channel once')
  assert.ok(!flowMatches(both, open({ type: TAKE_OUT }).check), 'no burger')
})

test('which prompts show: their trigger, once per order unless every time, open orders only', () => {
  const burger = dish(BURGER, BURGERS, 'Burger', 1000)
  const { id, checks, check } = open({ type: TAKE_OUT, lines: [burger] })
  const added = addedDishes(burger)
  assert.deepEqual(askFlowsFor(FLOWS, check, { trigger: 'dish_added', here, added }).map(f => f.id), [DRINK_ASK.id])
  assert.deepEqual(askFlowsFor(FLOWS, check, { trigger: 'checkout', here }).map(f => f.id), [FRIES_ASK.id])
  // Asked: not again on this order.
  const asked = ok(apply(checks, ev('check.flow_asked', { flow_id: DRINK_ASK.id, answer: 'declined' }, { check_id: id }))).checks
  assert.deepEqual(asked[id].flows_asked[DRINK_ASK.id].answer, 'declined')
  assert.deepEqual(askFlowsFor(FLOWS, asked[id], { trigger: 'dish_added', here, added }), [])
  // Every time: asked for each burger.
  const every = [{ ...DRINK_ASK, ask: { ...DRINK_ASK.ask, every_time: true } }]
  assert.equal(askFlowsFor(every, asked[id], { trigger: 'dish_added', here, added }).length, 1)
  // Not at another till, not on a closed order.
  assert.deepEqual(askFlowsFor([{ ...DRINK_ASK, device_ids: [BAR_TILL] }], check, { trigger: 'dish_added', here, added }), [])
  assert.deepEqual(askFlowsFor(FLOWS, { ...check, status: 'closed' }, { trigger: 'checkout', here }), [])
})

test('the dishes a prompt offers: known to the till, not sold out, on the menus shown', () => {
  const items = { [COKE]: { id: COKE, name: 'Coke' }, [WATER]: { id: WATER, name: 'Water' } }
  assert.deepEqual(askChoices(DRINK_ASK, items).map(i => i.id), [COKE, WATER])
  assert.deepEqual(askChoices(DRINK_ASK, items, { soldOut: { [COKE]: true } }).map(i => i.id), [WATER])
  assert.deepEqual(askChoices(DRINK_ASK, items, { shownIds: new Set([COKE]) }).map(i => i.id), [COKE])
  assert.deepEqual(askChoices(DRINK_ASK, { [WATER]: items[WATER] }).map(i => i.id), [WATER], 'a dish the till doesn\'t know is left out')
})

test('add flows: put on as the order matches, off as it stops, what staff took off stays off', () => {
  // Eat in: the service charge goes on by itself, as the flow says (not removable).
  let { id, checks } = open({ type: EAT_IN, lines: [dish(BURGER, BURGERS, 'Burger', 1000)] })
  checks = sync(checks, id)
  let c = checks[id]
  assert.deepEqual(c.charges.map(x => [x.id, x.optional, x.flow?.key]), [[SERVICE.id, false, addKey(SERVICE_FLOW.id, SERVICE_FLOW.adds[0])]])
  assert.equal(checkTotals(c).service_charge, 125)
  assert.ok(planEmpty(flowSyncPlan(c, flowAddsFor(FLOWS, c, here))), 'nothing more to do')
  // Take out: the bag and its charge come on, the service charge comes off altogether.
  checks = { ...checks, ...ok(apply(checks, ev('check.order_type_set', { order_type_id: TAKE_OUT }, { check_id: id }))).checks }
  checks = sync(checks, id)
  c = checks[id]
  assert.deepEqual(c.lines.filter(l => l.flow).map(l => [l.item_id, l.qty, l.flow.removable]), [[BAG_ITEM, 1, false]])
  assert.deepEqual(c.charges.map(x => x.id), [BAG_CHARGE.id])
  // Staff can't take the bag off without a manager.
  const bag = c.lines.find(l => l.flow)
  const no = apply(checks, ev('line.deleted', { line_id: bag.id }, { check_id: id }))
  assert.equal(no.ok, false)
  assert.equal(no.code, 'manager')
  const noCharge = apply(checks, ev('charge.removed', { charge_id: BAG_CHARGE.id, reason: 'Own bag' }, { check_id: id }))
  assert.equal(noCharge.code, 'manager')
  // Back to eat in before it goes to the kitchen: the bag and its charge come off by themselves.
  checks = { ...checks, ...ok(apply(checks, ev('check.order_type_set', { order_type_id: EAT_IN }, { check_id: id }))).checks }
  checks = sync(checks, id)
  c = checks[id]
  assert.deepEqual(c.lines.filter(l => l.flow), [])
  assert.deepEqual(c.charges.map(x => x.id), [SERVICE.id])
  assert.equal(c.flows_off, undefined, 'taken off by the flow: nothing remembered')
})

test('a removable dish staff take off stays off; a sent one stays on when the order stops matching', () => {
  const removable = normaliseOrderFlow({ ...BAG_FLOW, adds: [{ kind: 'dish', item_id: BAG_ITEM, qty: 2, removable: true }] })
  const flows = [removable]
  let { id, checks } = open({ type: TAKE_OUT })
  checks = sync(checks, id, flows)
  let bag = checks[id].lines.find(l => l.flow)
  assert.equal(bag.qty, 2)
  checks = { ...checks, ...ok(apply(checks, ev('line.deleted', { line_id: bag.id }, { check_id: id }))).checks }
  assert.deepEqual(checks[id].flows_off, { [addKey(removable.id, removable.adds[0])]: true })
  assert.ok(planEmpty(flowSyncPlan(checks[id], flowAddsFor(flows, checks[id], here))), 'not put back')
  // Another order: the bag goes to the kitchen, then the order type changes.
  ;({ id, checks } = open({ type: TAKE_OUT }))
  checks = sync(checks, id, flows)
  bag = checks[id].lines.find(l => l.flow)
  checks = { ...checks, ...ok(apply(checks, ev('lines.sent', { send_id: ulid(), line_ids: [bag.id] }, { check_id: id }))).checks }
  checks = { ...checks, ...ok(apply(checks, ev('check.order_type_set', { order_type_id: EAT_IN }, { check_id: id }))).checks }
  const plan = flowSyncPlan(checks[id], flowAddsFor(flows, checks[id], here))
  assert.deepEqual(plan.removeLines, [], 'made already: it stays, staff void it if they must')
  // The flow can't take a dish it didn't put on off by itself, nor a sent one.
  const own = checks[id]
  const plain = apply(checks, ev('line.added', { line: dish(BURGER, BURGERS, 'Burger', 1000) }, { check_id: id }))
  const burger = plain.checks[id].lines.at(-1)
  assert.equal(apply(plain.checks, ev('line.deleted', { line_id: burger.id, by_flow: true }, { check_id: id })).code, 'flow')
  assert.equal(apply({ [id]: own }, ev('line.deleted', { line_id: bag.id, by_flow: true }, { check_id: id })).code, 'sent')
})

test('voiding a sent dish a flow put on: a manager when it can\'t be taken off; it stays off', () => {
  let { id, checks } = open({ type: TAKE_OUT })
  checks = sync(checks, id)
  const bag = checks[id].lines.find(l => l.flow)
  checks = { ...checks, ...ok(apply(checks, ev('lines.sent', { send_id: ulid(), line_ids: [bag.id] }, { check_id: id }))).checks }
  const staffVoid = { line_id: bag.id, reason: 'Own bag' }
  assert.equal(apply(checks, ev('line.voided', staffVoid, { check_id: id })).code, 'manager')
  checks = { ...checks, ...ok(apply(checks, ev('line.voided', staffVoid, { check_id: id, approved_by: SUPER }))).checks }
  assert.ok(checks[id].flows_off[bag.flow.key])
  const plan = flowSyncPlan(checks[id], flowAddsFor(FLOWS, checks[id], here))
  assert.deepEqual(plan.addDishes, [], 'not put back after the void')
  // With a manager, a dish that can't be taken off comes off (and stays off).
  ;({ id, checks } = open({ type: TAKE_OUT }))
  checks = sync(checks, id)
  const bag2 = checks[id].lines.find(l => l.flow)
  checks = { ...checks, ...ok(apply(checks, ev('line.deleted', { line_id: bag2.id }, { check_id: id, approved_by: SUPER }))).checks }
  assert.ok(checks[id].flows_off[bag2.flow.key])
  // Cancel order takes it off with the rest, without a manager for the bag.
  ;({ id, checks } = open({ type: TAKE_OUT }))
  checks = sync(checks, id)
  const bag3 = checks[id].lines.find(l => l.flow)
  ok(apply(checks, ev('line.deleted', { line_id: bag3.id, cancel: true }, { check_id: id })))
})

test('two tills putting the same dish on at once: the second comes off; fewer of a fixed dish needs a manager', () => {
  let { id, checks } = open({ type: TAKE_OUT })
  // Both tills work out the same sync from the same order and send it.
  const first = syncEvents(checks[id])
  const second = syncEvents(checks[id]).filter(e => e.type === 'line.added')
  for (const e of [...first, ...second]) checks = { ...checks, ...ok(apply(checks, e)).checks }
  assert.equal(checks[id].lines.filter(l => l.flow).length, 2)
  const plan = flowSyncPlan(checks[id], flowAddsFor(FLOWS, checks[id], here))
  assert.deepEqual(plan.removeLines, [checks[id].lines.filter(l => l.flow)[1].id], 'the later one comes off')
  assert.deepEqual(plan.addDishes, [])
  checks = sync(checks, id)
  assert.equal(checks[id].lines.filter(l => l.flow).length, 1)
  assert.ok(planEmpty(flowSyncPlan(checks[id], flowAddsFor(FLOWS, checks[id], here))))
  // Two bags nobody may take off: fewer needs a manager every time, more doesn't.
  const fixed = normaliseOrderFlow({ ...BAG_FLOW, adds: [{ kind: 'dish', item_id: BAG_ITEM, qty: 2, removable: false }] })
  ;({ id, checks } = open({ type: TAKE_OUT }))
  checks = sync(checks, id, [fixed])
  const bag = checks[id].lines.find(l => l.flow)
  assert.equal(bag.qty, 2)
  assert.equal(apply(checks, ev('line.changed', { line_id: bag.id, qty: 1 }, { check_id: id })).code, 'manager')
  ok(apply(checks, ev('line.changed', { line_id: bag.id, qty: 1 }, { check_id: id, approved_by: SUPER })))
  ok(apply(checks, ev('line.changed', { line_id: bag.id, qty: 3 }, { check_id: id })))
  // A removable one: fewer is fine (the venue's switch aside).
  const soft = normaliseOrderFlow({ ...fixed, adds: [{ ...fixed.adds[0], removable: true }] })
  ;({ id, checks } = open({ type: TAKE_OUT }))
  checks = sync(checks, id, [soft])
  ok(apply(checks, ev('line.changed', { line_id: checks[id].lines.find(l => l.flow).id, qty: 1 }, { check_id: id })))
})

test('the designer\'s warnings: a channel no location has, tills elsewhere, a prompt for every dish', () => {
  const channels = { restaurant: [VENUE], bar: [OTHER_VENUE] }
  const tills = { [TILL]: VENUE, [BAR_TILL]: OTHER_VENUE }
  const warn = (f, ctx) => flowWarnings(f, ctx).map(w => w.code)
  // Restaurant runs at VENUE: fine anywhere, and at VENUE only.
  assert.deepEqual(warn(BAG_FLOW, { channels, tills }), [])
  assert.deepEqual(warn({ ...BAG_FLOW, venue_ids: [VENUE] }, { channels, tills }), [])
  // Only at OTHER_VENUE, which has no Restaurant channel.
  assert.deepEqual(warn({ ...BAG_FLOW, venue_ids: [OTHER_VENUE] }, { channels, tills }), ['no_channel'])
  assert.deepEqual(warn({ ...BAG_FLOW, match: { ...BAG_FLOW.match, stream_names: ['Delivery'] } }, { channels, tills }), ['no_channel'])
  // A till at another location than the ones it runs at.
  assert.deepEqual(warn({ ...BAG_FLOW, venue_ids: [VENUE], device_ids: [TILL, BAR_TILL] }, { channels, tills }), ['tills_elsewhere'])
  // Without the company's places nothing is said about them.
  assert.deepEqual(warn({ ...BAG_FLOW, venue_ids: [OTHER_VENUE], device_ids: [BAR_TILL] }), [])
  // A prompt when any dish is added, every time.
  const every = { ...DRINK_ASK, match: normaliseOrderFlow({ id: uuid() }).match }
  assert.deepEqual(warn(every, { channels, tills }), ['every_dish'])
})

test('charges a flow puts on: optional as the flow says only when the flows say so', () => {
  const { id, checks } = open({ type: EAT_IN })
  const key = addKey(SERVICE_FLOW.id, SERVICE_FLOW.adds[0])
  const charge = (extra = {}) => ({ ...chargeFromList(SERVICE, VENUE, []), list: true, ...extra })
  // The flow says not optional: it goes on not optional.
  const r = ok(apply(checks, ev('charge.added', { charge: charge({ optional: false, flow: { id: SERVICE_FLOW.id, key } }) }, { check_id: id })))
  assert.equal(r.checks[id].charges[0].optional, false)
  assert.deepEqual(r.checks[id].charges[0].flow, { id: SERVICE_FLOW.id, key })
  // A flow the venue doesn't have: judged as the list has it.
  const stranger = uuid()
  assert.equal(apply(checks, ev('charge.added', { charge: charge({ optional: false, flow: { id: stranger, key: stranger + ':charge:' + SERVICE.id } }) }, { check_id: id })).code, 'charge')
  ok(apply(checks, ev('charge.added', { charge: charge({ flow: { id: stranger, key: stranger + ':charge:' + SERVICE.id } }) }, { check_id: id })))
  // Without the venue's flows (an old runner): as the list has it.
  assert.equal(apply(checks, ev('charge.added', { charge: charge({ optional: false, flow: { id: SERVICE_FLOW.id, key } }) }, { check_id: id }), { charges: settings.charges }).code, 'charge')
  // A key that isn't the flow's own is refused as a shape.
  assert.equal(apply(checks, ev('charge.added', { charge: charge({ flow: { id: SERVICE_FLOW.id, key: 'nope' } }) }, { check_id: id })).code, 'invalid')
  assert.equal(flowChargeAdd(FLOWS, { id: SERVICE.id, optional: true, flow: { id: SERVICE_FLOW.id, key } }), null, 'removable differs')
  assert.ok(flowChargeAdd(FLOWS, { id: SERVICE.id, optional: false, flow: { id: SERVICE_FLOW.id, key } }))
  assert.equal(flowChargeAdd([{ ...SERVICE_FLOW, on: false }], { id: SERVICE.id, optional: false, flow: { id: SERVICE_FLOW.id, key } }), null, 'switched off')
  // Taken off by the flow: gone altogether, no reason needed; a charge it didn't put on can't be.
  const off = ok(apply(r.checks, ev('charge.removed', { charge_id: SERVICE.id, by_flow: true }, { check_id: id })))
  assert.deepEqual(off.checks[id].charges, [])
  const plainCheck = ok(apply(checks, ev('charge.added', { charge: charge() }, { check_id: id }))).checks
  assert.equal(apply(plainCheck, ev('charge.removed', { charge_id: SERVICE.id, by_flow: true }, { check_id: id })).code, 'flow')
  assert.equal(apply(plainCheck, ev('charge.removed', { charge_id: SERVICE.id }, { check_id: id })).code, 'invalid', 'staff give a reason')
  // A removable flow charge staff take off stays off (and isn't put back).
  const soft = normaliseOrderFlow({ ...SERVICE_FLOW, adds: [{ kind: 'charge', charge_id: SERVICE.id, removable: true }] })
  const softKey = addKey(soft.id, soft.adds[0])
  const s2 = { charges: settings.charges, flows: [soft] }
  const on = ok(apply(checks, ev('charge.added', { charge: charge({ optional: true, flow: { id: soft.id, key: softKey } }) }, { check_id: id }), s2)).checks
  const taken = ok(apply(on, ev('charge.removed', { charge_id: SERVICE.id, reason: 'Unhappy' }, { check_id: id }), s2)).checks
  assert.ok(taken[id].flows_off[softKey])
  assert.deepEqual(flowAddsFor([soft], taken[id], here), [])
  // Taken off by staff, it stays on the check taken off: the flow doesn't drop it.
  assert.deepEqual(flowSyncPlan(taken[id], flowAddsFor([soft], taken[id], here)).dropCharges, [])
  // Put back: the flow looks after it again (and takes it off when the order stops matching).
  const back = ok(apply(taken, ev('charge.restored', { charge_id: SERVICE.id }, { check_id: id }), s2)).checks
  assert.equal(back[id].flows_off[softKey], undefined)
  assert.deepEqual(flowSyncPlan(back[id], []).dropCharges, [SERVICE.id])
})

test('a flow\'s charge gives way to the same charge from the location\'s matrix', () => {
  const key = addKey(SERVICE_FLOW.id, SERVICE_FLOW.adds[0])
  const flowCharge = { ...chargeFromList(SERVICE, VENUE, []), list: true, added: true, optional: false, flow: { id: SERVICE_FLOW.id, key } }
  const matrix = chargesWhere([{ ...SERVICE, where: [{ stream: RESTAURANT, type: TAKE_OUT }] }], { streamId: RESTAURANT, typeId: TAKE_OUT }, VENUE, [])
  const next = switchCharges([flowCharge], matrix, {})
  assert.equal(next.charges.length, 1)
  assert.equal(next.charges[0].flow, undefined, 'the matrix\'s own now')
  assert.equal(next.charges[0].optional, true)
  // Taken off while the flow's, it comes in taken off.
  const off = switchCharges([{ ...flowCharge, removed: true, reason: 'No' }], matrix, {})
  assert.equal(off.charges[0].removed, true)
  // Not in the matrix: the flow's stays (its flow takes it off if it must).
  assert.deepEqual(switchCharges([flowCharge], [], {}).charges.map(x => x.flow?.key), [key])
})

test('prompts asked: kept on the order, refused on closed ones and when malformed', () => {
  const { id, checks } = open({})
  const twice = ok(apply(ok(apply(checks, ev('check.flow_asked', { flow_id: DRINK_ASK.id, answer: 'added', item_ids: [COKE] }, { check_id: id }))).checks,
    ev('check.flow_asked', { flow_id: DRINK_ASK.id, answer: 'declined' }, { check_id: id }))).checks
  assert.equal(twice[id].flows_asked[DRINK_ASK.id].n, 2)
  assert.equal(twice[id].flows_asked[DRINK_ASK.id].answer, 'declined')
  assert.equal(apply(checks, ev('check.flow_asked', { flow_id: DRINK_ASK.id, answer: 'maybe' }, { check_id: id })).code, 'invalid')
  assert.equal(apply(checks, ev('check.flow_asked', { flow_id: 'x', answer: 'added' }, { check_id: id })).code, 'invalid')
  const closed = ok(apply(checks, ev('check.closed', {}, { check_id: id }))).checks
  assert.equal(apply(closed, ev('check.flow_asked', { flow_id: DRINK_ASK.id, answer: 'added' }, { check_id: id })).code, 'closed')
  // A line's flow mark must be whole.
  const bad = apply(checks, ev('line.added', { line: dish(BAG_ITEM, null, 'Bag', 0, { flow: { id: BAG_FLOW.id, key: BAG_FLOW.id + ':dish:x' } }) }, { check_id: id }))
  assert.equal(bad.code, 'invalid', 'removable missing')
})

test('the company\'s own ids only', () => {
  const ids = flowIds(BAG_FLOW)
  assert.deepEqual(ids.items, [BAG_ITEM])
  assert.deepEqual(ids.charges, [BAG_CHARGE.id])
  assert.deepEqual(ids.types, [TAKE_OUT])
  const f = normaliseOrderFlow({ ...DRINK_ASK, venue_ids: [VENUE, OTHER_VENUE], device_ids: [TILL], match: { section_ids: [BURGERS, DRINKS], not_item_ids: [FRIES] } })
  const own = ownFlow(f, {
    items: new Set([COKE]), sections: new Set([BURGERS]), venues: new Set([VENUE]), devices: new Set(), streams: new Set(), types: new Set(), charges: new Set(),
  })
  assert.deepEqual(own.venue_ids, [VENUE])
  assert.deepEqual(own.device_ids, [])
  assert.deepEqual(own.match.section_ids, [BURGERS])
  assert.deepEqual(own.match.not_item_ids, [])
  assert.deepEqual(own.ask.item_ids, [COKE])
  const adds = ownFlow(BAG_FLOW, { items: new Set(), charges: new Set([BAG_CHARGE.id]), types: new Set([TAKE_OUT]) })
  assert.deepEqual(adds.adds.map(a => a.kind), ['charge'])
  assert.deepEqual(adds.match.stream_names, ['Restaurant'], 'channel names are kept')
})

test('in words: when, if, then, where and the one-line summary', () => {
  const names = {
    items: { [COKE]: 'Coke', [WATER]: 'Water', [FRIES]: 'Fries', [BAG_ITEM]: 'Paper bag' },
    sections: { [BURGERS]: 'Burgers', [SIDES]: 'Sides' },
    types: { [TAKE_OUT]: 'Take out', [EAT_IN]: 'Eat in' },
    charges: { [BAG_CHARGE.id]: 'Bag', [SERVICE.id]: 'Service charge' },
    venues: { [VENUE]: 'Ware' }, devices: { [TILL]: 'Front till' },
  }
  assert.equal(orList(['A']), 'A')
  assert.equal(orList(['A', 'B', 'C']), 'A, B or C')
  assert.equal(flowWhenText(DRINK_ASK), 'When a dish is added')
  assert.equal(flowWhenText(FRIES_ASK), 'At checkout, before payment')
  assert.equal(flowWhenText(BAG_FLOW), 'As soon as the order matches')
  assert.deepEqual(flowIfLines(DRINK_ASK, names), ['The dish added is a dish from Burgers', 'Not when the order has one of the dishes offered'])
  assert.deepEqual(flowIfLines(FRIES_ASK, names), ['The order type is Take out', 'Not when the order has a dish from Sides'])
  assert.deepEqual(flowIfLines(BAG_FLOW, names), ['The channel is Restaurant', 'The order type is Take out'])
  assert.deepEqual(flowThenLines(DRINK_ASK, names), ['Ask "Add a drink?"', 'Offer Coke or Water (one of them)'])
  assert.deepEqual(flowThenLines(FRIES_ASK, names), ['Ask "Any fries?"', 'Offer Fries (any of them)'])
  assert.deepEqual(flowThenLines(BAG_FLOW, names), ['Add Paper bag (can\'t be taken off)', 'Add Bag (can\'t be taken off)'])
  assert.equal(flowWhereText(BAG_FLOW, names), 'Every location · every till')
  assert.equal(flowWhereText({ ...BAG_FLOW, venue_ids: [VENUE], device_ids: [TILL] }, names), 'Ware · Front till')
  assert.match(flowSummary(FRIES_ASK, names), /^At checkout, before payment, if the order type is Take out and not when the order has a dish from Sides: Ask "Any fries\?"/)
  assert.deepEqual(flowThenLines({ ...BAG_FLOW, adds: [{ kind: 'dish', item_id: uuid(), qty: 2, removable: true }] }, names), ['Add 2 x a dish no longer on the menu'])
})
