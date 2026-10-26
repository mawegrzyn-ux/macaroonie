// node --test shared/test/kioskJourney.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPatch, diffView, frameAt, journeySteps, summariseJourney, aggregateJourneys, outcomeOf, journeyLength, STAGES,
} from '../kioskJourney.js'

const BURGER = '11111111-1111-4111-8111-111111111111'
const FRIES = '22222222-2222-4222-8222-222222222222'
const MAINS = '33333333-3333-4333-8333-333333333333'
const EAT_IN = '44444444-4444-4444-8444-444444444444'
const names = { [BURGER]: 'Classic burger', [FRIES]: 'Fries', [MAINS]: 'Mains', [EAT_IN]: 'Eat in', 'tag:milk': 'Milk', 'lang:es': 'Español' }

// A journey written as views at times, with taps and scrolls between: the
// events a kiosk records (diffView between views, as journey.js does).
function record(script) {
  const events = []
  let view = {}
  for (const step of script) {
    if (step.view) {
      const next = { ...view, ...step.view }
      for (const k of step.drop || []) delete next[k]
      const diff = events.length ? diffView(view, next) : { p: next }
      if (diff) events.push({ t: step.t, k: 'v', ...diff })
      view = next
    } else events.push({ t: step.t, ...step.ev })
  }
  return events
}

const START = { screen: 'start', section: null, orderType: null, lang: 'en', reach: false, prefs: { avoid: [], diet: [] }, basket: [], builder: null, details: { name: 0, tent: 0 }, value: 0, result: null }

function orderedJourney() {
  return record([
    { t: 0, ev: { k: 'vp', w: 1080, h: 1920 } },
    { t: 0, view: START },
    { t: 10, ev: { k: 'tap', x: 540, y: 1500, el: 'Eat in', id: 'k-type', ref: EAT_IN, hit: 1 } },
    { t: 200, view: { screen: 'menu', orderType: EAT_IN, section: MAINS } },
    { t: 3000, ev: { k: 'tap', x: 300, y: 600, el: 'Classic burger £8.50', id: 'k-item', ref: BURGER, hit: 1 } },
    { t: 3100, view: { builder: { item_id: BURGER, key: null, qty: 1, selection: { choices: {} } } } },
    { t: 5000, ev: { k: 'tap', x: 100, y: 100, el: 'photo', id: null, hit: 0 } },
    { t: 7000, ev: { k: 'tap', x: 500, y: 1200, el: 'Cheese +£0.50', id: 'k-option', hit: 1 } },
    { t: 7050, view: { 'ui:dish.sel': { choices: { g: [{ id: 'cheese' }] } } } },
    { t: 9000, ev: { k: 'tap', x: 900, y: 1850, el: 'Add to order · £9.00', id: 'k-add', hit: 1 } },
    { t: 9050, view: { builder: null, basket: [{ key: 'A', item_id: BURGER, qty: 1, selection: { choices: { g: [{ id: 'cheese' }] } } }], value: 900 }, drop: ['ui:dish.sel'] },
    { t: 11000, ev: { k: 'scroll', s: '0/1/0/1', y: 400, x: 0 } },
    { t: 11200, ev: { k: 'scroll', s: '0/1/0/1', y: 800, x: 0 } },
    { t: 12000, view: { builder: { item_id: FRIES, key: null, qty: 1, selection: { choices: {} } } } },
    { t: 15000, view: { builder: null } },
    { t: 16000, view: { screen: 'basket' } },
    { t: 19000, view: { screen: 'details', detailStep: 'name' } },
    { t: 19500, ev: { k: 'tap', x: 540, y: 1400, el: 'keyboard', hit: 1 } },
    { t: 19700, ev: { k: 'tap', x: 540, y: 1400, el: 'keyboard', hit: 1 } },
    { t: 19900, ev: { k: 'tap', x: 540, y: 1400, el: 'keyboard', hit: 1 } },
    { t: 19950, view: { details: { name: 3, tent: 0 } } },
    { t: 21000, view: { screen: 'card' } },
    { t: 22000, view: { 'ui:card': 'declined' } },
    { t: 23000, view: { 'ui:card': null } },
    { t: 24000, view: { screen: 'placing' } },
    { t: 24600, view: { screen: 'done', result: { order_no: 42, provisional: 'K1-0007', pending: false, total: 900, check: 'CHK1' } } },
    { t: 30000, view: { ...START } },
    { t: 30000, ev: { k: 'end', why: 'done' } },
  ])
}

test('views: a patch and a diff round trip', () => {
  const a = { screen: 'menu', basket: [], x: 1 }
  const b = { screen: 'basket', basket: [{ key: 'A' }], y: 2 }
  const d = diffView(a, b)
  assert.deepEqual(d.d, ['x'])
  assert.deepEqual(applyPatch(a, d), b)
  assert.equal(diffView(b, { ...b }), null)
  // Values equal by content are not a change.
  assert.equal(diffView({ basket: [{ key: 'A' }] }, { basket: [{ key: 'A' }] }), null)
})

test('frameAt: the view, scroll since the last screen change, the viewport and recent taps', () => {
  const ev = orderedJourney()
  const at = frameAt(ev, 9000)
  assert.equal(at.view.screen, 'menu')
  assert.equal(at.view.builder.item_id, BURGER)
  assert.deepEqual(at.view['ui:dish.sel'], { choices: { g: [{ id: 'cheese' }] } })
  assert.deepEqual(at.vp, { w: 1080, h: 1920 })
  assert.equal(at.taps.length, 1)
  assert.equal(at.taps[0].id, 'k-add')
  assert.equal(at.taps[0].age, 0)
  // A window of another shape: the kiosk's box (bars) comes with it, the latest one at a time.
  const turned = [...ev.slice(0, 2), { t: 5, k: 'vp', w: 768, h: 1024, b: [96, 0, 576, 1024] }, ...ev.slice(2)]
  assert.deepEqual(frameAt(turned, 9000).vp, { w: 768, h: 1024, b: [96, 0, 576, 1024] })
  assert.deepEqual(frameAt(turned, 2).vp, { w: 1080, h: 1920 })
  // The scroll counts while on the menu, not once the next dish opens.
  assert.deepEqual(frameAt(ev, 11500).scroll, { '0/1/0/1': { x: 0, y: 800 } })
  assert.deepEqual(frameAt(ev, 12500).scroll, {})
  // Before anything: nothing shown.
  assert.deepEqual(frameAt(ev, -1).view, {})
  // v counts the view changes so far (the player redraws on a new number).
  assert.ok(frameAt(ev, 9100).v > frameAt(ev, 9000).v)
})

test('steps: what the guest did, with taps joined to what they caused and dwell times', () => {
  const ev = orderedJourney()
  const steps = journeySteps(ev, names)
  const labels = steps.map(s => s.label)
  assert.deepEqual(labels, [
    'Start screen',
    'Menu', 'Opened Mains', 'Picked Eat in',
    'Opened Classic burger',
    'Touched nothing that answers (photo)',
    'Touched “Cheese +£0.50”',
    'Added Classic burger',
    'Scrolled',
    'Opened Fries', 'Left Fries without adding it',
    'Your order',
    'Name',
    'Typed on the keyboard (3 keys)',
    'Card machine',
    'Card declined',
    'Sending the order',
    'Order number 42', 'Order placed (42)',
    'Start screen',
    'Ended: ordered',
  ])
  // The type tap caused the menu opening: joined, not its own step.
  const menu = steps.find(s => s.label === 'Menu')
  assert.equal(menu.tap.id, 'k-type')
  const add = steps.find(s => s.kind === 'add')
  assert.equal(add.tap.id, 'k-add')
  assert.equal(add.item_id, BURGER)
  // The dead tap stays a step of its own, marked.
  const dead = steps.find(s => s.dead)
  assert.equal(dead.kind, 'tap')
  // Dwell: until the next step; the last one ends the visit.
  const opened = steps.find(s => s.label === 'Opened Classic burger')
  assert.equal(opened.dwell, 5000 - 3100)
  assert.equal(steps.at(-1).dwell, 0)
  assert.equal(steps.reduce((n, s) => n + s.dwell, 0), journeyLength(ev) - steps[0].t)
})

test('summary: outcome, how far, time per screen and dish, cancels, taps', () => {
  const s = summariseJourney(orderedJourney(), { names })
  assert.equal(s.outcome, 'ordered')
  assert.equal(s.duration_ms, 30000)
  assert.deepEqual(s.stages, ['start', 'menu', 'item', 'added', 'basket', 'details', 'pay', 'ordered'])
  assert.equal(s.furthest, 'ordered')
  assert.equal(s.last_screen, 'done')
  assert.equal(s.order.order_no, 42)
  assert.equal(s.order.total, 900)
  assert.equal(s.order.check_id, 'CHK1')
  assert.equal(s.basket_value, 900)
  assert.equal(s.items_added, 1)
  assert.equal(s.first_add_ms, 9050)
  assert.equal(s.order_ms, 24600)
  // A dish being built counts as its own screen.
  assert.equal(s.screens.dish, (9050 - 3100) + (15000 - 12000))
  assert.equal(s.screens.menu, (3100 - 200) + (12000 - 9050) + (16000 - 15000))
  assert.equal(s.screens.basket, 3000)
  assert.equal(s.screens.start, 200 + 0)
  assert.equal(s.sections[MAINS], s.screens.menu)
  assert.deepEqual(s.items[BURGER], { views: 1, view_ms: 5950, adds: 1, qty: 1, removed: 0, left: 0 })
  assert.deepEqual(s.items[FRIES], { views: 1, view_ms: 3000, adds: 0, qty: 0, removed: 0, left: 1 })
  assert.equal(s.cancels.left_items, 1)
  assert.equal(s.cancels.card_declined, 1)
  assert.equal(s.cancels.started_again, 0)
  assert.equal(s.taps, 8)
  assert.equal(s.dead_taps, 1)
  assert.equal(s.scrolls, 2)
})

test('summary: a guest who started again with a full basket, and one who timed out on a dish', () => {
  const restarted = record([
    { t: 0, view: START },
    { t: 500, view: { screen: 'menu', section: MAINS } },
    { t: 1000, view: { basket: [{ key: 'A', item_id: FRIES, qty: 2, selection: {} }], value: 600 } },
    { t: 1500, view: { basket: [{ key: 'A', item_id: FRIES, qty: 1, selection: {} }], value: 300 } },
    { t: 2000, view: { 'ui:restart.ask': true } },
    { t: 2500, view: { ...START }, drop: ['ui:restart.ask'] },
    { t: 2500, ev: { k: 'end', why: 'guest' } },
  ])
  const a = summariseJourney(restarted)
  assert.equal(a.outcome, 'started_again')
  assert.equal(a.last_screen, 'menu')
  assert.equal(a.basket_value, 300)
  assert.equal(a.cancels.removed, 1)
  assert.equal(a.cancels.started_again, 1)
  assert.equal(a.cancels.restart_asked, 1)
  assert.equal(a.cancels.kept_ordering, 0)
  assert.equal(a.items[FRIES].qty, 2)
  assert.equal(a.items[FRIES].removed, 1)
  assert.ok(journeySteps(restarted, names).some(s => s.label === 'Took off Fries (now 1)'))

  const timedOut = record([
    { t: 0, view: START },
    { t: 500, view: { screen: 'menu' } },
    { t: 900, view: { builder: { item_id: BURGER, key: null, qty: 1, selection: {} } } },
    { t: 60000, view: { 'ui:idle': 20 } },
    { t: 61000, view: { 'ui:idle': 19 } },
    { t: 80000, view: { ...START }, drop: ['ui:idle'] },
    { t: 80000, ev: { k: 'end', why: 'timeout' } },
  ])
  const b = summariseJourney(timedOut)
  assert.equal(b.outcome, 'timed_out')
  assert.equal(b.last_screen, 'dish')
  assert.equal(b.cancels.idle_asked, 1)
  assert.equal(b.cancels.idle_answered, 0)
  // The visit ending on a dish isn't "left the dish".
  assert.equal(b.items[BURGER].left, 0)
  const steps = journeySteps(timedOut, names)
  assert.equal(steps.filter(s => s.kind === 'idle').length, 1)
  assert.equal(steps.at(-1).label, 'Ended: timed out')
})

test('steps: a touch on nothing stays its own step, scrolling doesn\'t take a touch', () => {
  const ev = record([
    { t: 0, view: START },
    { t: 100, ev: { k: 'tap', x: 5, y: 5, el: 'photo', hit: 0 } },
    { t: 300, ev: { k: 'scroll', s: '0/1', y: 200 } },
    { t: 400, ev: { k: 'tap', x: 9, y: 9, el: 'photo', hit: 0 } },
    { t: 500, view: { screen: 'menu' } },
    { t: 1000, ev: { k: 'tap', x: 50, y: 50, el: 'Burgers', hit: 1 } },
    { t: 1100, ev: { k: 'scroll', s: '0/1', y: 0 } },
    { t: 1200, view: { section: MAINS } },
  ])
  const steps = journeySteps(ev, names)
  assert.deepEqual(steps.map(s => s.kind), ['screen', 'tap', 'scroll', 'tap', 'screen', 'scroll', 'section'])
  assert.equal(steps.find(s => s.kind === 'section').tap.el, 'Burgers')
  assert.ok(steps.filter(s => s.kind === 'tap').every(s => s.dead))
})

test('outcome: a paid order still waiting to reach the till counts as ordered; no end = cut short', () => {
  const pending = [{ t: 0, k: 'v', p: { screen: 'done', result: { order_no: null, provisional: 'K1-0003', pending: true } } }]
  assert.equal(outcomeOf(pending), 'ordered')
  assert.equal(outcomeOf([{ t: 0, k: 'v', p: START }]), 'interrupted')
  assert.equal(outcomeOf([{ t: 0, k: 'v', p: START }, { t: 9, k: 'end', why: 'left' }]), 'left')
  assert.equal(outcomeOf([{ t: 0, k: 'v', p: START }, { t: 9, k: 'end', why: 'done' }]), 'left')
})

test('steps: language, reach, allergens and answering the idle question', () => {
  const ev = record([
    { t: 0, view: START },
    { t: 100, view: { lang: 'es' } },
    { t: 200, view: { screen: 'allergens' } },
    { t: 300, view: { prefs: { avoid: ['milk'], diet: [] } } },
    { t: 400, view: { screen: 'menu', reach: true } },
    { t: 500, view: { 'ui:idle': 20 } },
    { t: 600, view: {}, drop: ['ui:idle'] },
  ])
  const labels = journeySteps(ev, names).map(s => s.label)
  assert.ok(labels.includes('Language: Español'))
  assert.ok(labels.includes('Allergens'))
  assert.ok(labels.includes('Allergens and diets: Milk'))
  assert.ok(labels.includes('Moved the screen down (reach)'))
  assert.ok(labels.includes('Answered “I\'m here”'))
  const s = summariseJourney(ev)
  assert.equal(s.reach, true)
  assert.equal(s.allergens, true)
  assert.deepEqual(s.langs, ['en', 'es'])
  assert.equal(s.cancels.idle_answered, 1)
})

test('aggregate: conversion, funnel, where guests gave up, dishes, hours and kiosks', () => {
  const ordered = summariseJourney(orderedJourney())
  const bounce = summariseJourney([{ t: 0, k: 'v', p: START }, { t: 4000, k: 'end', why: 'left' }])
  const abandoned = summariseJourney(record([
    { t: 0, view: START },
    { t: 500, view: { screen: 'menu' } },
    { t: 900, view: { basket: [{ key: 'B', item_id: BURGER, qty: 1, selection: {} }], value: 850 } },
    { t: 3000, view: { screen: 'basket' } },
    { t: 9000, view: { ...START } },
    { t: 9000, ev: { k: 'end', why: 'timeout' } },
  ]))
  const rows = [
    { summary: ordered, outcome: ordered.outcome, duration_ms: ordered.duration_ms, total_pence: 900, device_id: 'D1', hour: 12, names: { [BURGER]: 'Classic burger' } },
    { summary: bounce, outcome: bounce.outcome, duration_ms: bounce.duration_ms, device_id: 'D1', hour: 12 },
    { summary: abandoned, outcome: abandoned.outcome, duration_ms: abandoned.duration_ms, basket_value_pence: 850, device_id: 'D2', hour: 18 },
  ]
  const a = aggregateJourneys(rows)
  assert.equal(a.sessions, 3)
  assert.equal(a.ordered, 1)
  assert.equal(Math.round(a.conversion * 100), 33)
  assert.equal(a.revenue, 900)
  assert.equal(a.avg_order, 900)
  assert.equal(a.abandoned, 2)
  assert.equal(a.abandoned_value, 850)
  assert.equal(a.abandoned_with_basket, 1)
  assert.equal(a.bounced, 1)
  assert.deepEqual(a.funnel.map(f => f.sessions), [3, 2, 2, 2, 2, 1, 1, 1])
  assert.deepEqual(a.funnel.map(f => f.stage), STAGES)
  assert.deepEqual(a.gave_up.map(g => [g.screen, g.count]), [['start', 1], ['basket', 1]].sort((x, y) => y[1] - x[1] || 0))
  assert.equal(a.outcomes.ordered, 1)
  assert.equal(a.outcomes.left, 1)
  assert.equal(a.outcomes.timed_out, 1)
  const burger = a.items.find(x => x.id === BURGER)
  assert.equal(burger.name, 'Classic burger')
  assert.equal(burger.qty, 2)
  assert.equal(burger.sessions, 2)
  assert.equal(a.by_hour[12].sessions, 2)
  assert.equal(a.by_hour[12].ordered, 1)
  assert.equal(a.by_hour[18].sessions, 1)
  assert.deepEqual(a.by_device.map(d => [d.device_id, d.sessions, d.ordered]), [['D1', 2, 1], ['D2', 1, 0]])
  assert.equal(a.cancels.timed_out, 1)
  assert.ok(a.dead_tap_share > 0 && a.dead_tap_share < 1)
  assert.equal(aggregateJourneys([]).sessions, 0)
  assert.equal(aggregateJourneys([]).conversion, 0)
})
