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

// x, y: the box's place on the kitchen map (a MAP_W x MAP_H drawing, boxes
// BOX_W x BOX_H, Orders in taller: h). role: what the box does, in a line.
export const BOX_W = 160
export const BOX_H = 58
export const MAP_W = 1100
export const MAP_H = 494
const BOXES = [
  { key: 'start', name: 'Orders in', kind: 'start', x: 0, y: 186, h: 110, role: 'Till, kiosk, website and GloriaFood' },
  { key: 'splitter', name: 'Burger splitter', kind: 'balance', x: 188, y: 60, role: 'Splitter: burgers', settings: { split_above: 3 } },
  { key: 'sleeper', name: 'Fries wait', kind: 'sleeper', x: 188, y: 168, role: 'Sleeper: 3 min', settings: { delay_mins: 3 } },
  { key: 'barPrinter', name: 'Bar printer', kind: 'printer', x: 188, y: 430, role: 'Prints drinks' },
  { key: 'grill1', name: 'Grill 1', kind: 'prep', x: 376, y: 20, role: 'Burgers', settings: { target_mins: 5, late_mins: 8 } },
  { key: 'grill2', name: 'Grill 2', kind: 'prep', x: 376, y: 100, role: 'Burgers', settings: { target_mins: 5, late_mins: 8 } },
  { key: 'fryer', name: 'Fryer', kind: 'prep', x: 376, y: 180, role: 'Fries, squid, fish', settings: { target_mins: 5, late_mins: 8 } },
  { key: 'cold', name: 'Cold', kind: 'prep', x: 376, y: 266, role: 'Salads, desserts', settings: { target_mins: 6, late_mins: 10 } },
  { key: 'bar', name: 'Bar', kind: 'prep', x: 376, y: 352, role: 'Drinks, shakes', settings: { target_mins: 4, late_mins: 7 } },
  { key: 'pass', name: 'Pass', kind: 'expo', x: 564, y: 100, role: 'Assembles tables', settings: { target_mins: 12, late_mins: 18 } },
  { key: 'bagging', name: 'Bagging', kind: 'setter', x: 564, y: 330, role: 'Setter: a status', settings: { status_text: 'Bagging', status_look: 'flag', status_colour: '#f59e0b' } },
  { key: 'floor', name: 'Floor', kind: 'runner', x: 752, y: 30, role: 'Runners\' screen', settings: { target_mins: 2, late_mins: 4 } },
  { key: 'passPrinter', name: 'Pass printer', kind: 'printer', x: 752, y: 140, role: 'Runners\' chits' },
  { key: 'packing', name: 'Packing', kind: 'expo', x: 752, y: 330, role: 'The packing check', settings: { bump_when_checked: true, target_mins: 8, late_mins: 12 } },
  { key: 'board', name: 'Ready board', kind: 'board', x: 940, y: 330, role: 'Collection numbers' },
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
export const CHAPTERS = [
  { id: 'kitchen', title: 'The kitchen' },
  { id: 'first', title: 'The first orders' },
  { id: 'rush', title: 'The rush' },
  { id: 'pass', title: 'Courses and the pass' },
  { id: 'out', title: 'Out the door' },
]

export const STEPS = [
  {
    chapter: 'kitchen', title: 'Friday night at Harbour & Co',
    text: [
      'It\'s 6:25 on a Friday at Harbour & Co on the Quayside. Orders come in from the till, the kiosk by the door, the website and GloriaFood for delivery: every dish starts at Orders in and follows the lines that take it.',
      'Five kitchen screens make dishes: two grills, the fryer, the cold section and the bar. The Pass brings a table\'s plates together; Packing is a second pass for bags, and the Floor screen is for the runners.',
    ],
    at: '18:25', show: ['pass', 'packing'], lit: ['start', 'grill1', 'grill2', 'fryer', 'cold', 'bar', 'pass', 'packing', 'floor'],
  },
  {
    chapter: 'kitchen', title: 'The boxes nobody taps',
    text: [
      'The Splitter shares burgers between the two grills. The Sleeper holds fries for three minutes, so they come out with the burgers. The Setter gives a bag its status on the board.',
      'Two printers print tickets: drinks at the bar, and a runner\'s chit at the pass. The collection board shows the numbers guests wait for.',
    ],
    at: '18:27', show: ['barPrinter', 'board'], lit: ['splitter', 'sleeper', 'bagging', 'barPrinter', 'passPrinter', 'board'],
  },
  {
    chapter: 'first', title: 'Table 12: starters now, mains held',
    text: [
      'Table 12, four people, order everything at once on the till: starters, mains and drinks. The server holds the mains, so only the starters and drinks go to the kitchen.',
      'The Pass sees the whole table, with the mains greyed under Hold. The grills see nothing yet, and the bar printer has printed the drinks.',
    ],
    at: '18:30:20',
    act: w => {
      w.at('18:30:00')
      w.till('t12', {
        table: '12', covers: 4, type: 'Dine in', hold: true,
        lines: [line('squid', 2), line('wings'), line('burrata'), line('classic', 2), line('veggie', 1, { modifiers: [{ label: 'Cheese', prefix: 'no' }] }), line('fish'), line('fries', 2), line('lager', 2), line('cola', 2)],
      })
    },
    show: ['pass', 'fryer', 'barPrinter'], lit: ['start', 'fryer', 'cold', 'bar', 'barPrinter', 'pass'], focus: ['t12'],
  },
  {
    chapter: 'first', title: 'A meal deal from the kiosk',
    text: [
      'Sam orders a burger meal and onion rings at the kiosk, to take away. Each part of the meal goes its own way: the burger to a grill, the fries to the Sleeper, the shake to the bar.',
      'Both grills were free, so the Splitter gave the burger to Grill 1. Packing already shows the whole bag, every dish still on its way, and the board shows 147 as preparing.',
    ],
    at: '18:31:20',
    act: w => {
      w.at('18:31:00')
      w.till('k147', { kiosk: true, type: 'Takeaway', name: 'Sam', lines: [meal('choc'), line('rings')] })
    },
    show: ['grill1', 'sleeper', 'packing'], lit: ['start', 'splitter', 'grill1', 'sleeper', 'fryer', 'bar', 'packing'], focus: ['k147'],
  },
  {
    chapter: 'first', title: 'The Sleeper wakes the fries',
    text: [
      'Fries take three minutes and a burger about six, so the fries sleep first. At 6:34 the Sleeper wakes them by itself and they land on the Fryer with the onion rings.',
      'Meanwhile the bar has poured Table 12\'s drinks and Sam\'s shake, and Cold has plated the burrata. Each tap moves a dish on: the shake to Bagging, the burrata to the Pass.',
    ],
    at: '18:34:10',
    act: w => {
      w.at('18:32:30')
      w.bump('bar', 't12')
      w.bump('bar', 'k147')
      w.at('18:33:20')
      w.bump('cold', 't12')
    },
    show: ['fryer', 'bar', 'pass'], lit: ['sleeper', 'fryer', 'bar', 'cold', 'bagging', 'pass'], focus: ['k147'],
  },
  {
    chapter: 'first', title: 'Tickets colour as they age',
    text: [
      'Every screen has its own target time. At 6:37 Sam\'s burger has been on Grill 1 for six minutes, past its five-minute target, so its timer turns amber; at eight it would go red.',
      'The Fryer has finished the starters, so every Table 12 starter is at the Pass and its ticket top turns PREPARED.',
    ],
    at: '18:37:10',
    act: w => {
      w.at('18:36:00')
      w.bump('fryer', 't12')
      w.at('18:36:40')
      w.bump('fryer', 'k147')
    },
    show: ['grill1', 'pass', 'packing'], lit: ['grill1', 'fryer', 'pass'], focus: ['t12', 'k147'],
  },
  {
    chapter: 'first', title: 'Starters away, the first bag packed',
    text: [
      'The Pass taps READY. Table 12\'s starters go to the Floor screen for the runners, and the pass printer prints their chit. A runner carries the plates out.',
      'Grill 1 finishes Sam\'s burger. At Packing each part of the meal is ticked off as it goes in the bag, and the last tick sends 147 to the board as ready.',
    ],
    at: '18:39:20',
    act: w => {
      w.at('18:37:40')
      w.bump('pass', 't12')
      w.at('18:38:30')
      w.bump('grill1', 'k147')
      w.at('18:39:00')
      w.tickAll('packing', 'k147')
    },
    show: ['floor', 'passPrinter', 'packing', 'board'], lit: ['pass', 'floor', 'passPrinter', 'grill1', 'bagging', 'packing', 'board'], focus: ['t12', 'k147'],
  },
  {
    chapter: 'rush', title: 'Five orders in a minute',
    text: [
      'At 6:40 it starts: Priya orders on the website for collection, a GloriaFood delivery for four comes in, Jo and Alex order at the kiosk and Table 5 on the till.',
      'The delivery has four burgers. The Splitter shares any ticket over three, so its burgers are split across both grills instead of landing on one cook. Smaller tickets stay whole.',
    ],
    at: '18:41:10',
    act: w => {
      w.at('18:39:50')
      w.bump('floor', 't12')
      w.at('18:40:00')
      w.web('w58', { name: 'Priya', type: 'Collection', lines: [line('smash', 2), line('fries', 2), line('caramel')] })
      w.at('18:40:15')
      w.gf('g1', { name: 'Tom', type: 'Delivery', lines: [line('classic', 3), line('smash'), line('fries', 3), line('rings'), line('cola', 2)] })
      w.at('18:40:30')
      w.till('k148', { kiosk: true, type: 'Takeaway', name: 'Jo', lines: [meal('caramel'), line('classic')] })
      w.at('18:40:45')
      w.till('t5', { table: '5', covers: 2, type: 'Dine in', lines: [line('caesar'), line('smash'), line('fries'), line('lager', 2)] })
      w.at('18:41:00')
      w.till('k150', { kiosk: true, type: 'Takeaway', name: 'Alex', lines: [line('veggie'), line('fries'), line('lemonade')] })
    },
    show: ['grill1', 'grill2', 'bar'], lit: ['start', 'splitter', 'grill1', 'grill2'], focus: ['g1'],
  },
  {
    chapter: 'rush', title: 'The Splitter keeps the grills even',
    text: [
      'Two more: Ola\'s takeaway from the till and Kai\'s website order. The Splitter sends each new burger ticket to the grill with fewer burgers still to cook; on a tie the grills take turns.',
      'Kai wants his order at 7:30, so it waits out of sight and comes onto the screens by itself at 7:15, in time to be ready.',
    ],
    at: '18:41:50',
    act: w => {
      w.at('18:41:20')
      w.till('c151', { type: 'Takeaway', name: 'Ola', lines: [line('classic', 2), line('rings')] })
      w.at('18:41:40')
      w.web('w59', { name: 'Kai', type: 'Collection', promised: '19:30', fire: '19:15', lines: [line('veggie', 2), line('fries', 2)] })
    },
    show: ['grill1', 'grill2', 'packing'], lit: ['start', 'splitter', 'grill1', 'grill2'], focus: ['c151'],
  },
  {
    chapter: 'rush', title: 'An allergy stands out everywhere',
    text: [
      'Table 9 tell their server about a gluten allergy, and the server sets the order\'s allergy flag on the till before sending it.',
      'The flag shows in red on every screen the order touches, the grill, the fryer and the pass, and it prints on the bar\'s ticket too.',
    ],
    at: '18:42:20',
    act: w => {
      w.at('18:42:00')
      w.till('t9', {
        table: '9', covers: 2, type: 'Dine in',
        allergy: { allergens: [{ code: 'gluten', name: 'Gluten' }], diets: [], note: 'Coeliac' },
        lines: [line('veggie', 1, { note: 'Gluten-free bun' }), line('fish'), line('lemonade', 2)],
      })
    },
    show: ['grill2', 'fryer', 'pass', 'barPrinter'], lit: ['grill2', 'fryer', 'pass', 'barPrinter'], focus: ['t9'],
  },
  {
    chapter: 'rush', title: 'The bar works from paper and screen',
    text: [
      'Drinks print at the bar, one ticket per order with its table or number. Shakes and drinks also sit on the bar\'s screen, and the bar clears its rush in a minute.',
      'Drinks for a table end at the bar, where the bar staff take them out. Drinks and shakes for a bag go on to Packing, and the board shows those orders as Bagging.',
    ],
    at: '18:43:00',
    act: w => {
      w.at('18:42:40')
      for (const k of ['w58', 'g1', 'k148', 't5', 'k150', 't9']) w.bump('bar', k)
    },
    show: ['barPrinter', 'packing', 'board'], lit: ['barPrinter', 'bar', 'bagging', 'packing', 'board'], focus: ['g1'],
  },
  {
    chapter: 'rush', title: 'Bumped too soon',
    text: [
      'In the rush Grill 2 bumps Alex\'s veggie burger by mistake. It vanishes from the grill, and Packing shows it as if it were cooked.',
      'Nothing is lost: every bump is kept, and the grill can bring the last one back.',
    ],
    at: '18:43:25',
    act: w => {
      w.at('18:43:20')
      w.bump(w.stationOf('k150', 'veggie'), 'k150')
    },
    show: ['grill2', 'packing'], lit: ['grill2', 'bagging', 'packing'], focus: ['k150'],
  },
  {
    chapter: 'rush', title: 'Brought back',
    text: [
      'One tap on the grill\'s recall puts Alex\'s ticket back where it was, with its clock still running from when it first arrived.',
      'At Packing the burger is on its way again, so the bag can\'t be finished without it.',
    ],
    at: '18:43:50',
    act: w => {
      w.at('18:43:40')
      w.recall(w.stationOf('k150', 'veggie'), 'k150')
    },
    show: ['grill2', 'packing'], lit: ['grill2', 'packing'], focus: ['k150'],
  },
  {
    chapter: 'pass', title: 'Fire the mains',
    text: [
      'Table 12 have finished their starters, so the server fires the mains on the till. Only now does the Splitter choose a grill for their burgers, by which grill has less to do at this moment.',
      'Table 12\'s fries go to sleep for three minutes, and the Pass shows the table\'s mains on their way.',
    ],
    at: '18:45:00',
    act: w => {
      w.at('18:44:00')
      w.bump(w.stationOf('w58', 'smash'), 'w58')
      w.at('18:44:30')
      w.fire('t12', 'Mains')
    },
    show: ['grill1', 'grill2', 'pass'], lit: ['start', 'splitter', 'grill1', 'grill2', 'sleeper', 'fryer', 'pass'], focus: ['t12'],
  },
  {
    chapter: 'pass', title: 'The pass brings the table together',
    text: [
      'The grills and the Fryer work through their tickets. Table 12\'s fish, fries and burgers arrive at the Pass one by one, and the head chef ticks each plate off as it is checked.',
      'The Pass holds the table until every plate is there: the ticket shows where each dish still is, its top turns PREPARED when nothing is missing, and CHECKED once every plate is ticked off.',
    ],
    at: '18:50:30',
    act: w => {
      w.at('18:46:00')
      w.bump(w.stationOf('k148', 'classic'), 'k148')
      w.bump(w.stationOf('t5', 'smash'), 't5')
      w.at('18:46:30')
      w.bump('fryer', 'w58')
      w.bump('fryer', 'g1')
      w.at('18:47:00')
      w.bump('cold', 't5')
      w.bump('fryer', 't5')
      w.at('18:47:30')
      w.bump(w.stationOf('k150', 'veggie'), 'k150')
      w.bump(w.stationOf('c151', 'classic'), 'c151')
      w.at('18:48:00')
      w.bump(w.stationOf('t9', 'veggie'), 't9')
      w.bump('fryer', 't9')
      w.bump('fryer', 'k148')
      w.bump('fryer', 'k150')
      w.bump('fryer', 'c151')
      w.at('18:48:20')
      w.bump('fryer', 't12')
      w.tick('pass', 't12', 'fish')
      w.tick('pass', 't12', 'fries')
      w.at('18:48:40')
      w.bump('pass', 't5')
      w.at('18:49:00')
      w.bump('pass', 't9')
      w.at('18:49:30')
      for (const s of w.stationsOf('t12', 'classic')) w.bump(s, 't12')
      w.tick('pass', 't12', 'classic')
      w.tick('pass', 't12', 'veggie')
      w.at('18:50:00')
      w.bump('floor', 't5')
    },
    show: ['pass', 'grill1', 'grill2'], lit: ['fryer', 'grill1', 'grill2', 'pass'], focus: ['t12'],
  },
  {
    chapter: 'pass', title: 'A dropped plate',
    text: [
      'A classic burger slides off its plate at the pass. The head chef taps Remake on it, with the reason Dropped.',
      'The burger goes back to the same grill marked REMAKE, the Pass shows it on its way again, and the table waits for it. The kitchen report counts every remake and why.',
    ],
    at: '18:51:00',
    act: w => {
      w.at('18:50:40')
      w.remake('pass', 't12', 'classic', 'Dropped')
      w.at('18:50:50')
      w.bump('floor', 't9')
    },
    show: ['pass', 'grill1', 'grill2'], lit: ['pass', 'grill1', 'grill2'], focus: ['t12'],
  },
  {
    chapter: 'pass', title: 'Service!',
    text: [
      'The grill sends the new burger in two minutes. Every plate is at the Pass and ticked off, so the head chef taps READY.',
      'Table 12\'s mains appear on the Floor screen and the pass printer prints the runner\'s chit. When the plates are on the table, the runner taps DONE.',
    ],
    at: '18:53:30',
    act: w => {
      w.at('18:52:00')
      w.bump(w.stationOf('g1', 'smash'), 'g1')
      w.at('18:52:50')
      w.bump(w.stationOf('t12', 'classic'), 't12')
      w.tick('pass', 't12', 'classic')
      w.at('18:53:10')
      w.bump('pass', 't12')
    },
    show: ['pass', 'floor', 'passPrinter'], lit: ['grill1', 'grill2', 'pass', 'floor', 'passPrinter'], focus: ['t12'],
  },
  {
    chapter: 'out', title: 'The packing check',
    text: [
      'Tom\'s delivery is the biggest bag of the night, and its last burgers are off the grill. At Packing every dish is ticked off as it goes in the bag.',
      'Nothing can be left out: the bag is done only when the last dish is ticked, and that tick sends it to the board for the driver.',
    ],
    at: '18:56:40',
    act: w => {
      w.at('18:54:10')
      w.bump('floor', 't12')
      w.at('18:54:30')
      w.bump(w.stationOf('g1', 'classic'), 'g1')
      w.at('18:55:20')
      w.tick('packing', 'g1', 'classic')
      w.tick('packing', 'g1', 'smash')
      w.tick('packing', 'g1', 'fries')
      w.tick('packing', 'g1', 'rings')
      w.at('18:56:20')
      w.tick('packing', 'g1', 'cola')
    },
    show: ['packing', 'board'], lit: ['grill1', 'grill2', 'bagging', 'packing', 'board'], focus: ['g1'],
  },
  {
    chapter: 'out', title: 'The ready board',
    text: [
      'More bags are packed: Priya\'s, Jo\'s and Alex\'s numbers move from Preparing to Ready on the collection board. Sam picks up 147 and Tom\'s driver takes the delivery, so both clear.',
      'Mia has just ordered at the kiosk, so 153 shows under Preparing. Ola\'s 151 is being packed, and the Setter puts Bagging beside it, so guests can see where theirs is without asking.',
    ],
    at: '18:58:30',
    act: w => {
      w.at('18:57:00')
      w.collected('k147')
      w.tickAll('packing', 'w58')
      w.at('18:57:30')
      w.tickAll('packing', 'k148')
      w.till('k153', { kiosk: true, type: 'Takeaway', name: 'Mia', lines: [meal('cola')] })
      w.at('18:58:00')
      w.tickAll('packing', 'k150')
      w.collected('g1')
    },
    show: ['board', 'packing'], lit: ['bagging', 'packing', 'board'], focus: ['w58', 'k148', 'k153'],
  },
  {
    chapter: 'out', title: 'What the timers saw',
    text: [
      'Flow timers measure the parts of the kitchen that matter: each dish from firing to the pass, each order to a packed bag, and fries from the Sleeper to done.',
      'Tonight the tables were on time but the bags were late: the food was ready before 6:50, and the bags waited while the team worked on Table 12. The kitchen report has the same figures for every night, with the slowest tickets.',
    ],
    at: '19:00:00',
    act: w => {
      w.at('18:59:00')
      w.tickAll('packing', 'c151')
    },
    show: ['timers', 'board'], lit: ['start', 'pass', 'packing', 'sleeper', 'fryer'],
  },
]

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
