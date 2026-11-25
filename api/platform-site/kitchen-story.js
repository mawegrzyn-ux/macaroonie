// The kitchen walkthrough's story (macaroonie.com/try/kitchen-flow, drawn by
// try-kitchen.js): a busy Friday at Harbour & Co, Quayside (invented), told
// in chapters and steps. A module with no imports: the page passes it the
// real kitchen rules it loaded from /site/shared/<version>/ (and the unit
// test passes the same files from shared/), so every ticket, wake, split,
// print, status and timer the page shows is worked out by the kitchen's own
// code (rule 12), never by this file.
//
//   kitchenStory({ K, Bench, Print, Timers })
//     K       shared/pos/kitchen.js
//     Bench   shared/pos/kitchenBench.js (createBench: the test bench's
//             pretend kitchen, standing in for the sequencer)
//     Print   shared/pos/kitchenPrint.js (kitchenPrintJobs)
//     Timers  shared/pos/kitchenTimers.js (timerResults)
//   -> { venue, boxes, links, timers, chapters, steps, play(n) }
//
// play(n) replays steps 1..n from nothing on a fresh bench with a scripted
// clock and returns the kitchen as it stands after step n: Back is a replay
// to n - 1, never an undo, so every step always looks the same. Each step's
// `act` drives the bench the way the till, kiosk, website, GloriaFood and the
// kitchen screens' taps would. A step that the rules refuse throws, so a
// change to the kitchen code that breaks the story fails the unit test
// (api/test/kitchen-walk.test.mjs) rather than showing a wrong page.
//
// What the code doesn't model (a runner carrying plates, a guest eating) is
// in the narration only.

export const VENUE = 'Harbour & Co, Quayside'
const DAY = '2026-11-27'   // a Friday

/** The clock of the story: '18:31:20' on the day, as an ISO time. */
export const at = hms => DAY + 'T' + (hms.length === 5 ? hms + ':00' : hms) + '.000Z'
/** '18:31' from an ISO time of the story. */
export const hhmm = iso => (iso ? iso.slice(11, 16) : '')

const uid = (kind, n) => kind + '-0000-4000-8000-' + String(n).padStart(12, '0')

// ── The menu ──────────────────────────────────────────────────

const SECTION_NAMES = ['Starters', 'Burgers', 'Mains', 'Sides', 'Desserts', 'Drinks', 'Shakes', 'Meals']
const SEC = Object.fromEntries(SECTION_NAMES.map((n, i) => [n, uid('5ec70000', i + 1)]))
const COURSES = [
  { id: uid('c0a50000', 1), name: 'Starters', sort_order: 1 },
  { id: uid('c0a50000', 2), name: 'Mains', sort_order: 2 },
  { id: uid('c0a50000', 3), name: 'Desserts', sort_order: 3 },
]
const COURSE = Object.fromEntries(COURSES.map(c => [c.name, c.id]))
const DISHES = [
  ['squid', 'Salt & pepper squid', 'Starters', 'Starters'],
  ['wings', 'Buffalo wings', 'Starters', 'Starters'],
  ['burrata', 'Burrata', 'Starters', 'Starters'],
  ['classic', 'Classic burger', 'Burgers', 'Mains'],
  ['smash', 'Smash burger', 'Burgers', 'Mains'],
  ['veggie', 'Veggie burger', 'Burgers', 'Mains'],
  ['fish', 'Fish & chips', 'Mains', 'Mains'],
  ['caesar', 'Caesar salad', 'Mains', 'Mains'],
  ['fries', 'Fries', 'Sides', 'Mains'],
  ['rings', 'Onion rings', 'Sides', 'Mains'],
  ['toffee', 'Sticky toffee pudding', 'Desserts', 'Desserts'],
  ['brownie', 'Brownie sundae', 'Desserts', 'Desserts'],
  ['cola', 'Cola', 'Drinks', null],
  ['lager', 'Pint of lager', 'Drinks', null],
  ['lemonade', 'Lemonade', 'Drinks', null],
  ['choc', 'Chocolate shake', 'Shakes', null],
  ['caramel', 'Salted caramel shake', 'Shakes', null],
  ['meal', 'Burger meal', 'Meals', 'Mains', 'combo'],
]
const ITEM = Object.fromEntries(DISHES.map(([key], i) => [key, uid('d1500000', i + 1)]))
const ITEMS = Object.fromEntries(DISHES.map(([key, name, sec, course, kind], i) => [ITEM[key], {
  id: ITEM[key], name, section_id: SEC[sec], course_id: course ? COURSE[course] : null, ...(kind ? { kind } : {}),
}]))
const NAME = Object.fromEntries(DISHES.map(([key, name]) => [key, name]))
// A meal deal's picks as the till sends them (shared/combos.js parts).
const part = key => ({ item_id: ITEM[key], section_id: ITEMS[ITEM[key]].section_id, name: NAME[key], kitchen_name: null, modifiers: [] })

const TYPE_NAMES = ['Dine in', 'Takeaway', 'Collection', 'Delivery']
const TYPE = Object.fromEntries(TYPE_NAMES.map((n, i) => [n, uid('a4000000', i + 1)]))
const TABLES = ['5', '9', '12'].map((label, i) => ({ id: uid('7ab10000', i + 1), label }))
const TABLE = Object.fromEntries(TABLES.map(t => [t.label, t.id]))
const KIOSK = uid('de710000', 1)
const TILL = uid('de710000', 2)

// ── The kitchen: its boxes and the flow ───────────────────────

// x, y: the box's place on the kitchen map (a 1040 x 480 drawing).
// role: what the walkthrough calls it in one line.
export const BOX_W = 132
export const BOX_H = 52
export const MAP_W = 1040
export const MAP_H = 486
const BOXES = [
  { key: 'start', name: 'Orders in', kind: 'start', x: 8, y: 196, h: 92, role: 'Till, kiosk, website, GloriaFood' },
  { key: 'splitter', name: 'Burger splitter', kind: 'balance', x: 190, y: 55, role: 'Shares burgers', settings: { split_above: 3 } },
  { key: 'sleeper', name: 'Fries wait', kind: 'sleeper', x: 190, y: 160, role: 'Holds fries 3 min', settings: { delay_mins: 3 } },
  { key: 'barPrinter', name: 'Bar printer', kind: 'printer', x: 190, y: 420, role: 'Prints drinks' },
  { key: 'grill1', name: 'Grill 1', kind: 'prep', x: 370, y: 20, role: 'Burgers', settings: { target_mins: 5, late_mins: 8 } },
  { key: 'grill2', name: 'Grill 2', kind: 'prep', x: 370, y: 90, role: 'Burgers', settings: { target_mins: 5, late_mins: 8 } },
  { key: 'fryer', name: 'Fryer', kind: 'prep', x: 370, y: 160, role: 'Fries, squid, fish', settings: { target_mins: 5, late_mins: 8 } },
  { key: 'cold', name: 'Cold', kind: 'prep', x: 370, y: 250, role: 'Salads, desserts', settings: { target_mins: 6, late_mins: 10 } },
  { key: 'bar', name: 'Bar', kind: 'prep', x: 370, y: 340, role: 'Drinks, shakes', settings: { target_mins: 4, late_mins: 7 } },
  { key: 'pass', name: 'Pass', kind: 'expo', x: 555, y: 90, role: 'Brings tables together', settings: { target_mins: 12, late_mins: 18 } },
  { key: 'bagging', name: 'Bagging', kind: 'setter', x: 555, y: 300, role: 'Sets the status', settings: { status_text: 'Bagging', status_look: 'flag', status_colour: '#f59e0b' } },
  { key: 'floor', name: 'Floor', kind: 'runner', x: 735, y: 30, role: 'Runners take it out', settings: { target_mins: 2, late_mins: 4 } },
  { key: 'passPrinter', name: 'Pass printer', kind: 'printer', x: 735, y: 140, role: 'Prints the runner\'s chit' },
  { key: 'packing', name: 'Packing', kind: 'expo', x: 735, y: 300, role: 'The packing check', settings: { bump_when_checked: true, target_mins: 8, late_mins: 12 } },
  { key: 'board', name: 'Collection board', kind: 'board', x: 900, y: 300, role: 'Numbers to collect' },
]
const BOX_ID = Object.fromEntries(BOXES.map((b, i) => [b.key, b.kind === 'start' ? null : uid('b0c50000', i)]))
for (const b of BOXES) {
  b.id = BOX_ID[b.key]
  if (b.kind === 'printer') b.settings = { printer_id: uid('9a1e0000', BOXES.indexOf(b)) }
}

const sec = name => ({ kind: 'section', id: SEC[name] })
const item = key => ({ kind: 'item', id: ITEM[key] })
const dineIn = { kind: 'order_type', id: TYPE['Dine in'] }
let linkN = 0
const link = (from, to, targets = [], exclude = false) => ({ id: uid('11e70000', ++linkN), from: BOX_ID[from], to: BOX_ID[to], targets, exclude, always: false })
const LINKS = [
  link('start', 'splitter', [sec('Burgers')]),
  link('splitter', 'grill1'),
  link('splitter', 'grill2'),
  link('start', 'sleeper', [item('fries')]),
  link('sleeper', 'fryer'),
  link('start', 'fryer', [sec('Sides'), item('squid'), item('wings'), item('fish')]),
  link('start', 'cold', [sec('Desserts'), item('burrata'), item('caesar')]),
  link('start', 'bar', [sec('Drinks'), sec('Shakes')]),
  link('start', 'barPrinter', [sec('Drinks')]),
  ...['grill1', 'grill2', 'fryer', 'cold'].map(k => link(k, 'pass', [dineIn])),
  ...['grill1', 'grill2', 'fryer', 'cold', 'bar'].map(k => link(k, 'bagging', [dineIn], true)),
  link('bagging', 'packing'),
  link('packing', 'board'),
  link('pass', 'floor'),
  link('pass', 'passPrinter'),
]

// Flow timers (kds_flows.timers, shared/pos/kitchenTimers.js).
const TIMERS = [
  { id: 'tm-table', name: 'Fired to the pass', from: 'start', from_when: 'reached', to: BOX_ID.pass, per: 'dish', target_mins: 12 },
  { id: 'tm-bag', name: 'Order to packed bag', from: 'start', from_when: 'reached', to: BOX_ID.packing, per: 'ticket', target_mins: 10 },
  { id: 'tm-fries', name: 'Fries: out of the Sleeper to done', from: BOX_ID.sleeper, from_when: 'done', to: BOX_ID.fryer, per: 'dish', target_mins: 4 },
]

function benchData(K) {
  for (const t of TIMERS) if (t.from === 'start') t.from = K.START
  return {
    venue: { id: uid('7e000000', 1), name: VENUE },
    settings: {},
    stations: BOXES.filter(b => b.id).map(b => ({ id: b.id, name: b.name, kind: b.kind, colour: null, settings: b.settings || {} })),
    flows: [{ id: uid('f1000000', 1), name: 'Friday', links: LINKS, station_ids: BOXES.filter(b => b.id).map(b => b.id) }],
    active_flow_id: uid('f1000000', 1),
    items: ITEMS, section_items: {},
    courses: COURSES, tables: TABLES,
    order_types: TYPE_NAMES.map(n => ({ id: TYPE[n], name: n })),
    streams: [], devices: [{ id: KIOSK, name: 'Kiosk 1' }, { id: TILL, name: 'Bar till' }],
    colours: { states: {}, sections: {} },
  }
}

// ── The story ─────────────────────────────────────────────────

const line = (key, qty = 1, extra = {}) => ({ item_id: ITEM[key], qty, ...extra })
const meal = (drink = 'choc') => line('meal', 1, { parts: [part('classic'), part('fries'), part(drink)] })

// chapters: { id, title }; steps: { chapter, title, text: [sentences],
// at (the clock at the end of the step), act(w), show (the screens that
// matter, box keys), lit (boxes to light), focus (order keys to mark) }.
export const CHAPTERS = []

export const STEPS = []

// A small seeded random generator (the bench's online order ids).
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Replaying the story ───────────────────────────────────────

export function kitchenStory({ K, Bench, Print, Timers }) {
  const data = benchData(K)
  const steps = STEPS.map((s, i) => ({ ...s, n: i + 1, id: 'step-' + (i + 1) }))
  const byKey = Object.fromEntries(BOXES.map(b => [b.key, b]))
  const keyOf = Object.fromEntries(BOXES.filter(b => b.id).map(b => [b.id, b.key]))

  /** The kitchen after steps 1..n (0: before the first). */
  function play(n) {
    let clock = at('18:25')
    let eventN = 0
    const bench = Bench.createBench(data, { now: () => clock, rng: seeded(27) })
    // The night's numbers so far.
    bench.state.number = 145
    bench.state.webNumber = 57
    bench.state.gfNumber = 3110
    const ids = {}
    const printed = []
    let stepNo = 0
    const order = key => {
      const o = bench.orders()[ids[key]]
      if (!o) throw new Error('No order ' + key)
      return o
    }
    const itemOf = (key, dish) => {
      const i = order(key).items.find(x => x.item_id === ITEM[dish])
      if (!i) throw new Error('No ' + dish + ' on ' + key)
      return i
    }
    // Every printer prints what has reached it now (the sequencer does this
    // after every change, and the minute sweep for dishes a Sleeper wakes).
    const print = () => {
      for (const j of Print.kitchenPrintJobs(bench.orders(), bench.cfg(), clock).jobs) {
        printed.push({ step: stepNo, at: clock, box: keyOf[j.station_id], kind: j.kind, title: j.title, ops: j.ops })
      }
    }
    const tap = (boxKey, type, payload) => {
      const station = byKey[boxKey]
      const e = { id: ulidLike(++eventN), type, payload, client_at: clock }
      const r = bench.submit({ id: station ? station.id : 'story', name: station ? station.name : 'Story', settings: {} }, [e]).results[0]
      if (!r.ok) throw new Error('Step ' + stepNo + ': ' + type + ' refused at ' + (station?.name || 'the kitchen') + ': ' + r.error)
      print()
    }
    const send = (key, spec) => {
      const r = bench.sendOrder(spec)
      if (!r.ok) throw new Error('Step ' + stepNo + ': ' + key + ' not sent: ' + r.error)
      ids[key] = r.id
      print()
    }
    const w = {
      at(hms) { clock = at(hms); print() },
      till(key, s) {
        send(key, {
          source: 'till', order_type_id: TYPE[s.type], table_id: s.table ? TABLE[s.table] : null, covers: s.covers,
          device_id: s.kiosk ? KIOSK : TILL, name: s.name || null, hold_courses: !!s.hold, allergy: s.allergy || null, lines: s.lines,
        })
      },
      web(key, s) {
        send(key, {
          source: 'online', order_type_id: TYPE[s.type], name: s.name, lines: s.lines,
          promised_at: s.promised ? at(s.promised) : null, fire_at: s.fire ? at(s.fire) : null,
        })
      },
      gf(key, s) { send(key, { source: 'gloriafood', order_type_id: TYPE[s.type], name: s.name, lines: s.lines }) },
      fire(key, course) {
        const r = bench.fireCourse(ids[key], COURSE[course])
        if (!r.ok) throw new Error('Step ' + stepNo + ': fire ' + course + ' refused: ' + r.error)
        print()
      },
      bump: (box, key) => tap(box, 'kitchen.bumped', { order_id: ids[key], station_id: byKey[box].id }),
      recall: (box, key) => tap(box, 'kitchen.recalled', { order_id: ids[key], station_id: byKey[box].id }),
      tick: (box, key, dish) => tap(box, 'kitchen.item_checked', { order_id: ids[key], station_id: byKey[box].id, item_id: itemOf(key, dish).id, checked: true }),
      tickAll(box, key) {
        const st = bench.cfg().stations[byKey[box].id]
        const t = K.stationTickets(bench.orders(), st, clock, bench.cfg()).find(x => x.order.id === ids[key])
        if (!t) throw new Error('Step ' + stepNo + ': no ticket for ' + key + ' at ' + box)
        for (const i of t.items.filter(x => (x.state === 'active' || x.state === 'upcoming') && !x.ticked)) {
          tap(box, 'kitchen.item_checked', { order_id: ids[key], station_id: st.id, item_id: i.id, checked: true })
        }
      },
      remake: (box, key, dish, reason) => tap(box, 'kitchen.remake', { order_id: ids[key], station_id: byKey[box].id, item_id: itemOf(key, dish).id, reason }),
      collected: key => tap(null, 'kitchen.collected', { order_id: ids[key] }),
      // The grill the Splitter gave a dish (its way, decided when it was fired).
      stationOf(key, dish) { return w.stationsOf(key, dish)[0] },
      stationsOf(key, dish) {
        const i = itemOf(key, dish)
        const routes = i.parts ? i.parts.map(p => p.route) : [i.route]
        const out = [...new Set(routes.flatMap(r => Object.keys(r || {})).map(id => keyOf[id]).filter(k => k === 'grill1' || k === 'grill2'))]
        if (!out.length) throw new Error('Step ' + stepNo + ': ' + dish + ' on ' + key + ' has no grill')
        return out
      },
    }

    let before = null
    for (const s of steps.slice(0, Math.max(0, Math.min(n, steps.length)))) {
      stepNo = s.n
      if (s.n === n) before = arrivals(bench.orders(), bench.cfg(), clock)
      if (s.act) s.act(w)
      w.at(s.at)
    }
    const cfg = bench.cfg()
    const now = clock
    const after = arrivals(bench.orders(), cfg, now)
    // The ways dishes took in this step: [{ from, to, label }] (box keys).
    const moves = before ? [...after.entries()].filter(([k]) => !before.has(k)).map(([, m]) => m) : []
    return {
      n, at: now, bench, cfg, ids, printed, moves,
      orders: bench.orders(),
      timers: TIMERS.map(t => ({ ...t, result: Timers.timerResults(Object.values(bench.orders()), t, cfg, now) })),
    }
  }

  // Which dishes have reached which box, by the flow's own clock: a key per
  // dish, box and the box it came from.
  function arrivals(orders, cfg, now) {
    const out = new Map()
    for (const o of Object.values(orders)) {
      for (const i of o.items) {
        if (i.voided_at) continue
        const ways = i.parts ? i.parts.map(p => ({ route: p.route, name: p.name })) : [{ route: i.route, name: i.name }]
        const f = K.flowTimes(i, cfg, now)
        for (const way of ways) {
          for (const [node, preds] of Object.entries(way.route || {})) {
            // A part's way: arrived when every box before it on that way is done.
            const reached = i.parts
              ? preds.every(p => (p === K.START ? K.isFired(i, now) : !!f.done(p)))
              : !!f.arrived(node)
            if (!reached) continue
            for (const p of preds) {
              const from = p === K.START ? 'start' : keyOf[p]
              out.set(o.id + '|' + i.id + '|' + way.name + '|' + node + '|' + p, {
                from, to: keyOf[node], label: (i.qty > 1 && !i.parts ? i.qty + ' ' : '') + way.name, order: o.id,
              })
            }
          }
        }
      }
    }
    return out
  }

  return { venue: VENUE, boxes: BOXES, links: LINKS, timers: TIMERS, chapters: CHAPTERS, steps, play, data }
}

// Event ids: the kitchen wants a ULID-shaped id (26 characters of Crockford
// base32); the story's are numbered, so a replay always makes the same ones.
function ulidLike(n) {
  return '01KS' + String(n).padStart(22, '0')
}
