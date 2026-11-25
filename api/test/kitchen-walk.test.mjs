// The kitchen walkthrough on macaroonie.com/try/kitchen-flow
// (api/platform-site/kitchen-story.js, drawn by try-kitchen.js): its story
// replayed on the real kitchen rules (shared/pos/kitchenBench.js and what it
// runs), checking what a few key steps say happens. A change to the kitchen
// code that breaks the story fails here: the page's narration would no
// longer match its screens. No database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as K from '../../shared/pos/kitchen.js'
import * as Bench from '../../shared/pos/kitchenBench.js'
import * as Print from '../../shared/pos/kitchenPrint.js'
import * as Timers from '../../shared/pos/kitchenTimers.js'
import { ticketLook } from '../../shared/pos/kitchenColours.js'
import { toText } from '../../shared/pos/tickets.js'
import { kitchenStory, CHAPTERS } from '../platform-site/kitchen-story.js'

const story = kitchenStory({ K, Bench, Print, Timers })
const box = key => story.boxes.find(b => b.key === key)
const stepNo = title => {
  const s = story.steps.find(x => x.title === title)
  assert.ok(s, 'a step called ' + title)
  return s.n
}
const at = title => story.play(stepNo(title))
const tickets = (s, key) => K.stationTickets(s.orders, s.cfg.stations[box(key).id], s.at, s.cfg)
const ticketOf = (s, key, order) => tickets(s, key).find(t => t.order.id === s.ids[order])
const dish = (t, name) => t.items.find(i => i.name === name)
const boardOf = s => K.boardNumbers(s.orders, s.at, { boardId: box('board').id, cfg: s.cfg })

test('the story: chapters, steps and a flow the kitchen accepts', () => {
  assert.equal(CHAPTERS.length, 5)
  assert.ok(story.steps.length >= 15 && story.steps.length <= 20, story.steps.length + ' steps')
  for (const c of CHAPTERS) assert.ok(story.steps.some(s => s.chapter === c.id), c.id + ' has steps')
  for (const s of story.steps) {
    assert.ok(s.title && s.text.length >= 1 && s.text.length <= 3, s.n + ' has a title and two or three sentences')
    for (const k of [...(s.show || []), ...(s.lit || [])]) assert.ok(k === 'timers' || box(k), s.n + ' names a box that exists: ' + k)
    assert.ok(!/[\u2018\u2019\u201c\u201d\u00a0\ufeff]/.test(s.title + s.text.join('')), s.n + ' has no typographic quotes or invisible characters')
  }
  assert.deepEqual(K.flowProblems(story.data.stations, story.links), [])
  assert.deepEqual(K.flowWarnings(story.data.stations, story.links), [])
  assert.deepEqual(Timers.timerProblems(story.timers, Object.fromEntries(story.data.stations.map(s => [s.id, s]))), [])
})

test('every step replays from nothing, and the same way each time', () => {
  const look = s => JSON.stringify(story.boxes.filter(b => K.isBumpKind(b.kind)).map(b =>
    tickets(s, b.key).map(t => [t.order.number, t.items.map(i => i.name + ':' + i.state + (i.ticked ? '+' : ''))])))
  for (const step of story.steps) {
    const a = story.play(step.n)
    const b = story.play(step.n)
    assert.equal(a.at, b.at, step.n + ' clock')
    assert.equal(look(a), look(b), step.n + ' screens')
    assert.equal(a.printed.length, b.printed.length, step.n + ' printing')
  }
  const times = story.steps.map(s => story.play(s.n).at)
  assert.deepEqual([...times].sort(), times, 'the clock only goes forward')
})

test('the first orders: mains held, a meal deal split three ways, the fries asleep, then PREPARED', () => {
  let s = at('Table 12: starters now, mains held')
  for (const g of ['grill1', 'grill2']) assert.equal(tickets(s, g).length, 0, g + ' sees nothing of a held course')
  const pass = ticketOf(s, 'pass', 't12')
  assert.equal(dish(pass, 'Classic burger').state, 'held')
  assert.equal(dish(pass, 'Salt & pepper squid').state, 'upcoming')
  assert.ok(pass.elsewhere.some(e => e.station_id === box('bar').id && e.count === 4), 'the drinks end at the bar')
  assert.ok(s.printed.some(p => p.box === 'barPrinter' && p.title === 'Table 12'), 'the bar printer printed the drinks')

  s = at('A meal deal from the kiosk')
  assert.ok(ticketOf(s, 'grill1', 'k147'), 'the burger went to Grill 1')
  assert.ok(!ticketOf(s, 'grill2', 'k147'))
  assert.ok(ticketOf(s, 'bar', 'k147'), 'the shake to the bar')
  const sleeps = K.itemSleeps(s.orders[s.ids.k147].items[0], s.cfg, s.at)
  assert.equal(sleeps[0]?.station_id, box('sleeper').id, 'the fries sleep')
  assert.equal(boardOf(s).preparing[0]?.number, '147')

  s = at('The Sleeper wakes the fries')
  assert.equal(K.itemSleeps(s.orders[s.ids.k147].items[0], s.cfg, s.at).length, 0, 'awake by 18:34')
  assert.ok(dish(ticketOf(s, 'fryer', 'k147'), 'Burger meal'), 'the fries reached the Fryer')

  s = at('Tickets colour as they age')
  const g1 = ticketOf(s, 'grill1', 'k147')
  assert.equal(K.ageTone(g1.since, s.at, s.cfg.stations[box('grill1').id]), 'warn', 'amber past the five-minute target')
  assert.equal(ticketLook(ticketOf(s, 'pass', 't12'), s.cfg.stations[box('pass').id]).key, 'head_prepared')
  assert.equal(boardOf(s).preparing[0]?.status?.text, 'Bagging', 'the Setter gave 147 its status')

  s = at('Starters away, the first bag packed')
  assert.ok(ticketOf(s, 'floor', 't12'), 'the runners see the starters')
  assert.ok(s.printed.some(p => p.box === 'passPrinter' && p.title === 'Table 12'), 'the runner\'s chit')
  assert.deepEqual(boardOf(s).ready.map(r => r.number), ['147'])
})

test('the rush: a big ticket split between the grills, small ones whole, the allergy everywhere, a recall', () => {
  let s = at('Five orders in a minute')
  const g = s.orders[s.ids.g1]
  const grills = new Set(g.items.flatMap(i => Object.keys(i.route)).filter(id => [box('grill1').id, box('grill2').id].includes(id)))
  assert.equal(grills.size, 2, 'four burgers: shared between both grills')
  for (const k of ['w58', 'k148', 't5']) {
    const ways = new Set(s.orders[s.ids[k]].items.flatMap(i => (i.parts ? i.parts.map(p => p.route) : [i.route])).flatMap(r => Object.keys(r)).filter(id => [box('grill1').id, box('grill2').id].includes(id)))
    assert.equal(ways.size, 1, k + ' stays on one grill')
  }
  assert.equal(s.orders[s.ids.g1].source, 'gloriafood')

  s = at('The Splitter keeps the grills even')
  assert.equal(K.laterOrders(s.orders, s.at)[0]?.order.id, s.ids.w59, 'the order for 7:30 waits')
  assert.ok(story.boxes.filter(b => K.isBumpKind(b.kind)).every(b => !ticketOf(s, b.key, 'w59')), 'on no screen yet')

  s = at('An allergy stands out everywhere')
  for (const k of ['grill2', 'fryer', 'pass']) assert.match(ticketOf(s, k, 't9')?.order.allergy || '', /Gluten/, k)
  const slip = s.printed.find(p => p.box === 'barPrinter' && p.title === 'Table 9')
  assert.match(toText(slip.ops, 32), /ALLERGY: GLUTEN/, 'the bar ticket carries the flag')

  s = at('Bumped too soon')
  const grill = box(s.orders[s.ids.k150].items.some(i => i.route[box('grill2').id]) ? 'grill2' : 'grill1')
  assert.equal(grill.key, 'grill2')
  assert.ok(!ticketOf(s, 'grill2', 'k150'), 'gone from the grill')
  assert.equal(dish(ticketOf(s, 'packing', 'k150'), 'Veggie burger').state, 'active')
  s = at('Brought back')
  assert.ok(ticketOf(s, 'grill2', 'k150'), 'back on the grill')
  assert.equal(dish(ticketOf(s, 'packing', 'k150'), 'Veggie burger').state, 'upcoming')
})

test('courses and the pass: fire, assemble, remake, READY', () => {
  let s = at('Table 12: starters now, mains held')
  const before = s.orders[s.ids.t12].items.find(i => i.name === 'Classic burger')
  assert.ok(before.route[box('splitter').id], 'a held course keeps its Splitter until it is fired')
  s = at('Fire the mains')
  const burger = s.orders[s.ids.t12].items.find(i => i.name === 'Classic burger')
  assert.ok(!burger.route[box('splitter').id] && (burger.route[box('grill1').id] || burger.route[box('grill2').id]), 'fired: the Splitter chose a grill')
  assert.ok(K.itemSleeps(s.orders[s.ids.t12].items.find(i => i.name === 'Fries'), s.cfg, s.at).length, 'the table\'s fries sleep')

  s = at('The pass brings the table together')
  const pass = ticketOf(s, 'pass', 't12')
  const live = pass.items.filter(i => i.state !== 'done')
  assert.ok(live.length === 4 && live.every(i => i.state === 'active' && i.ticked), 'every main at the pass and ticked off')
  assert.equal(ticketLook(pass, s.cfg.stations[box('pass').id]).key, 'head_checked', 'all ticked: CHECKED, waiting for READY')

  s = at('A dropped plate')
  const remade = dish(ticketOf(s, 'pass', 't12'), 'Classic burger')
  assert.equal(remade.state, 'upcoming')
  assert.equal(remade.remakes, 1)
  const grill = K.itemWhere(s.orders[s.ids.t12].items.find(i => i.name === 'Classic burger'), s.cfg, s.at)
  assert.equal(grill.length, 1, 'back at its grill')

  s = at('Service!')
  assert.ok(!ticketOf(s, 'pass', 't12'), 'READY: off the pass')
  assert.ok(ticketOf(s, 'floor', 't12'), 'on the Floor screen')
  assert.equal(s.printed.filter(p => p.box === 'passPrinter' && p.title === 'Table 12').length, 2, 'a chit for the starters and one for the mains')
})

test('out the door: the packing check, the board, the timers', () => {
  let s = at('Bumped too soon')
  const packing = s.cfg.stations[box('packing').id]
  assert.equal(K.stationSettings(packing).bump_when_checked, true)

  s = at('The packing check')
  assert.ok(!ticketOf(s, 'packing', 'g1'), 'the last tick bumped the bag')
  assert.ok(boardOf(s).ready.some(r => r.number === 'G3111'))
  assert.ok(s.orders[s.ids.g1].items.every(i => i.checked?.[packing.id]), 'every dish ticked')

  s = at('The ready board')
  const b = boardOf(s)
  assert.ok(!b.ready.some(r => r.number === '147' || r.number === 'G3111'), 'collected: off the board')
  assert.deepEqual(b.ready.map(r => r.number).sort(), ['148', '150', 'W58'])
  assert.equal(b.preparing.find(r => r.number === '151')?.status?.text, 'Bagging')
  assert.ok(b.preparing.some(r => r.number === '153' && !r.status), 'a new order: preparing, no status yet')

  s = at('What the timers saw')
  const byId = Object.fromEntries(s.timers.map(t => [t.id, t.result]))
  assert.ok(byId['tm-table'].count >= 10 && byId['tm-table'].on_time_pct === 100, 'tables on time')
  assert.ok(byId['tm-bag'].count >= 5 && byId['tm-bag'].on_time_pct < 50, 'bags late')
  assert.ok(byId['tm-fries'].count >= 5)
})
