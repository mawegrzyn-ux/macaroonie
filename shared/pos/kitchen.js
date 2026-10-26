// shared/pos/kitchen.js
//
// The kitchen screens' rules (KDS, docs/POS.md section 9). ONE implementation
// used by:
//   - the sequencer (shared/pos/sequencer.js), run by the cloud now and by
//     the venue hub later: turns till events (dishes sent, courses fired,
//     voids, moves) and kitchen events (bump, recall, remake, ...) into
//     kitchen orders, stored as a projection (kds_orders) like pos_checks
//   - the kitchen screen (pos/src/kitchen): applies its own taps at once
//     (local first) and draws tickets, the pass, the on-order counts and
//     the speed figures from the same kitchen orders
//   - the admin flow designer (checking a dish's way through the kitchen)
//
// A kitchen order is one order in the kitchen: a till check (id = check id),
// an online order (id = 'web-<orders.id>') or a GloriaFood order (id =
// 'gf-<gloriafood_orders.id>', migration 178). Its items are the dishes sent
// to the kitchen.
//
// The kitchen is a flow (Store tech > Kitchen screens > Kitchen flow):
// stations are prep (Grill, Fryer, ...), expo (the pass), runner, and order
// ready boards; links go from "Orders in" (the till and online orders) to
// stations and from station to station. A link can carry a filter (dishes,
// sections, revenue centres, order types); from each point a dish takes the
// links with the most specific filter it matches (dish, then section, then
// revenue centre, then order type, then the links with no filter), so a burger
// can go Prep 1 > Prep 2 > Expo 1 while the fries go Prep 1 > Expo 1. When the
// dish is sent its whole way (item.route: node -> the nodes before it) is
// worked out and kept on the item, so a flow changed during service only
// affects dishes sent after the change.
//
// A Splitter (station kind 'balance', migration 183) shares work between
// the stations it links to: each ticket's dishes that reach it go on to just
// one of them, the one with the fewest pieces still to cook there (the box's
// pieces list, like On order counts: an 8pc dish counts 8, a "10 Wings"
// option 10), taking turns on a tie. Smart (settings.share_mode 'speed')
// weighs those pieces by how fast each station has been bumping lately
// (stationPace(): seconds per piece), so the ticket goes where it should be
// done soonest and a station falling behind gets fewer tickets until it
// catches up. A box can share big tickets instead (settings.split_above):
// when more than that many pieces of one ticket reach it, each dish line
// goes, biggest first, to whichever station has the least to do counting
// what this ticket already put there. A busy order type rule
// (settings.rush_type_id, rush_count, rush_station_id) splits by order type
// while that type is busy: once rush_count or more orders of the type are
// waiting at the box's stations, its tickets all go to rush_station_id and
// every other ticket to the other stations. The choice is made when the
// dishes are sent (a held till course: when it's fired, balanceTicket()) and
// the box then drops out of the dish's way, so nothing after that knows it
// was there. The sequencer passes the open kitchen orders, the orders bumped
// lately (for Smart) and the box's last pick in cfg.balance; without them
// every station counts as empty and as fast as the others.
//
// A Sleeper (station kind 'sleeper', migration 200) holds the dishes that
// reach it for settings.delay_mins, then passes them on by itself: nobody
// bumps it. Which dishes it holds is decided by the links into it, like any
// station (a filter by order type, revenue stream, till, dish, section, or
// none for every dish). Its wait counts from when a dish reaches it, so its
// clock needs `at`: flowTimes() counts it done only once the time has come.
// Expo's Bump (or an order set ready from outside) wakes it at once, and a
// remade dish doesn't wait at a Sleeper it has already been through
// (item.slept).
//
// A Setter (station kind 'setter', migration 203) sets the order's status
// as a dish passes it: its name is the status (one per name at a venue), and
// how the status shows on order ready boards is in its settings (look,
// colour, words, lamp, animation). It passes dishes straight on, like a
// board. An order's status is the Setter its dishes reached last
// (orderStatus()); none reached = no status.
//
// A dish reaches a station when every station before it on its way has done
// it, and is done there when that station bumps it. Expo and runner stations
// work on whole orders: their bump also finishes what is still at earlier
// stations (when the station shows dishes before they arrive). Order ready
// boards have nothing to bump: an order is ready on a board once every dish on
// its way to that board has reached it.
//
// At the pass and runners, tapping a dish ticks it off (kitchen.item_checked,
// item.checked[station] = when): a packing check that changes nothing about
// where the dish is, so the ticket stays until READY / DONE is pressed. A dish
// still at an earlier station counts as done there once the pass ticks it off
// (it is in front of the pass). With the station's bump_when_checked on,
// ticking off the last dish bumps the ticket, as READY would. A tick goes
// when the dish is made again (remake) or sent back to an earlier station
// (undone, recalled there); READY then Prev at the pass keeps it. Prep
// stations mark dishes done instead (kitchen.item_done): each one goes on at
// once, and the last one done counts as the bump.
//
// Pure: no I/O, no clock. Times come from events (received_at, set by the
// sequencer, else client_at) or from the `now` the screen passes in.

import { modifierText, groupModifiers } from './pricing.js'
import { isId } from './ids.js'

export const KITCHEN_DEVICE_EVENTS = [
  'kitchen.item_done', 'kitchen.item_checked', 'kitchen.bumped', 'kitchen.recalled', 'kitchen.remake', 'kitchen.priority', 'kitchen.collected',
]
// Made by the server only (online and GloriaFood orders), never accepted from a device.
// kitchen.print_due (migration 191): the minute sweep's nudge when a dish's
// time has come and a kitchen printer is waiting for it (kitchenPrint.js).
export const KITCHEN_SERVER_EVENTS = ['kitchen.order_in', 'kitchen.order_status', 'kitchen.print_due']
export const KITCHEN_EVENTS = [...KITCHEN_DEVICE_EVENTS, ...KITCHEN_SERVER_EVENTS]

// Till events that change what the kitchen shows.
export const KITCHEN_CHECK_EVENTS = [
  'lines.sent', 'course.fired', 'line.voided', 'lines.moved', 'check.merged',
  'check.table_moved', 'check.renamed', 'check.covers_set', 'check.server_changed', 'check.note_set',
  'check.order_type_set', 'check.tent_set',
]

// Order types are the tenant's own (order_types, migration 170): a kitchen
// order carries the type's id (type) and name (type_name) as sent.

// Station kinds. prep: makes dishes; expo: checks whole orders (the pass);
// runner: takes orders out; board: an order ready board (no bumping);
// balance: a Splitter in the flow (shares tickets between the stations it
// links to; no screen, nothing to bump); printer: a kitchen printer
// (settings.printer_id; dishes reaching it print there, kitchenPrint.js);
// sleeper: a Sleeper (holds dishes settings.delay_mins, then passes them on);
// setter: a Setter (sets the order's status when a dish passes it).
export const STATION_KINDS = ['prep', 'expo', 'runner', 'board', 'balance', 'printer', 'sleeper', 'setter']
export const KIND_LABELS = { prep: 'Prep station', expo: 'Expo (pass)', runner: 'Runner', board: 'Order ready board', balance: 'Splitter', printer: 'Kitchen printer', sleeper: 'Sleeper', setter: 'Setter' }
export const BUMP_KINDS = ['prep', 'expo', 'runner']
export const isBumpKind = kind => BUMP_KINDS.includes(kind)
// Nodes nobody bumps: done as soon as a dish reaches them (a Sleeper: once
// its wait is over, flowTimes()).
const noBump = kind => kind === 'board' || kind === 'balance' || kind === 'printer' || kind === 'sleeper' || kind === 'setter'
const isSleeper = (cfg, id) => cfg?.stations?.[id]?.kind === 'sleeper'
export const SLEEP_MINS_MAX = 240
/** How long a Sleeper holds a dish, in ms. */
const sleepMs = (cfg, id) => Math.min(SLEEP_MINS_MAX, Math.max(0, Number(cfg?.stations?.[id]?.settings?.delay_mins) || 0)) * 60_000
export const isOrderLevel = st => st?.kind === 'expo' || st?.kind === 'runner'

// Where an item comes from before its first station.
export const START = 'start'
// What a flow link's filter can name, most specific first.
export const FLOW_TARGET_KINDS = ['item', 'section', 'device', 'revenue_stream', 'order_type', 'default']
// A till or kiosk (device) names where an order came from more closely than
// its revenue stream (a stream groups tills). A link set to Except (every dish
// but the ones its filter names) comes after every filter that names the
// dish, and before a link with no filter.
const RANK = { item: 0, section: 1, device: 2, revenue_stream: 3, order_type: 4, except: 5, default: 6 }

export const STATION_DEFAULTS = {
  target_mins: 8, late_mins: 12, show_held: true, summary_groups: [], pieces: [], split_above: null, delay_mins: 5,
  // The pass and runners: ticking off every dish bumps the ticket (off: it waits for READY / DONE).
  bump_when_checked: false,
  // A Splitter: how it shares (SHARE_MODES) and its busy order type rule (off: no rush_type_id).
  share_mode: 'pieces', rush_type_id: null, rush_count: 5, rush_station_id: null,
  // A Setter's status look (STATUS_LOOKS, STATUS_ANIMS): status_text '' = its name.
  status_look: 'text', status_colour: '#f59e0b', status_text: '', status_anim: 'none', status_lamp: 2,
}

// How a Splitter shares: 'pieces' to the station with the fewest pieces still
// to cook; 'speed' (Smart) to the one that should be done soonest, those
// pieces times its pace.
export const SHARE_MODES = ['pieces', 'speed']
// A station's pace is measured from its last few bumps in the last half hour.
export const PACE_TICKETS = 8
export const PACE_MINUTES = 30
// The busy order type rule's count: 1 to this many waiting orders.
export const RUSH_COUNT_MAX = 99

// How a Setter's status shows on an order ready board tile.
export const STATUS_LOOKS = [
  { key: 'text', label: 'Words' }, { key: 'flag', label: 'Flag' }, { key: 'border', label: 'Coloured border' },
  { key: 'light', label: 'Traffic light' }, { key: 'square', label: 'Square' }, { key: 'circle', label: 'Dot' },
]
export const STATUS_ANIMS = [
  { key: 'none', label: 'Still' }, { key: 'pulse', label: 'Pulse' }, { key: 'turn', label: 'Turn' },
  { key: 'blink', label: 'Blink' }, { key: 'bounce', label: 'Bounce' }, { key: 'shake', label: 'Shake' }, { key: 'glow', label: 'Glow' },
]
const LOOK_KEYS = STATUS_LOOKS.map(x => x.key)
const ANIM_KEYS = STATUS_ANIMS.map(x => x.key)
const HEX6 = /^#[0-9a-f]{6}$/i

/** A Setter's status as boards show it: { id, name, text, look, colour, anim, lamp }. */
export function statusOf(station) {
  const st = stationSettings(station)
  return {
    id: station.id, name: station.name,
    text: String(st.status_text || '').trim() || station.name,
    look: LOOK_KEYS.includes(st.status_look) ? st.status_look : 'text',
    colour: HEX6.test(st.status_colour || '') ? st.status_colour.toLowerCase() : STATION_DEFAULTS.status_colour,
    anim: ANIM_KEYS.includes(st.status_anim) ? st.status_anim : 'none',
    lamp: [1, 2, 3].includes(Number(st.status_lamp)) ? Number(st.status_lamp) : 2,
  }
}

/**
 * An order's status: the Setter its dishes reached last (statusOf() plus
 * at), or null. Voided dishes and dishes not fired don't count.
 */
export function orderStatus(o, cfg, at) {
  let best = null
  for (const i of liveItems(o)) {
    if (!isFired(i, at)) continue
    const f = flowTimes(i, cfg, at)
    for (const id of Object.keys(i.route || {})) {
      const station = cfg?.stations?.[id]
      if (station?.kind !== 'setter') continue
      const t = f.arrived(id)
      if (t && (!best || ms(t) > ms(best.at))) best = { station, at: t }
    }
  }
  return best ? { ...statusOf(best.station), at: best.at } : null
}

// Kitchen orders older than this drop off the screens even if nobody bumped
// them (a table left open overnight, a test order).
export const STALE_HOURS = 16

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isText = (v, max = 300) => typeof v === 'string' && v.length <= max
const optText = (v, max) => v == null || isText(v, max)
const isTime = v => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const ms = v => (v ? Date.parse(v) : NaN)
const later = (a, b) => (!a ? b : !b ? a : ms(b) > ms(a) ? b : a)

export const isOrderId = v => isId(v) || (typeof v === 'string' && /^(web|gf)-[0-9a-f-]{36}$/i.test(v))
export const onlineOrderId = orderId => 'web-' + orderId
export const gloriaFoodOrderId = orderId => 'gf-' + orderId
// Where an order made by the server came from, by its id.
const sourceOfId = id => (String(id).startsWith('gf-') ? 'gloriafood' : 'online')

/**
 * A station's settings with the defaults filled in. show_upcoming: show
 * orders before their dishes reach this station (on at the pass, off
 * elsewhere unless set).
 */
export function stationSettings(station) {
  return { ...STATION_DEFAULTS, show_upcoming: station?.kind === 'expo', ...(station?.settings || {}) }
}

// ── Shape checks ───────────────────────────────────────────────

function onlineOrderProblem(o) {
  if (!o || typeof o !== 'object') return 'order missing'
  if (!isOrderId(o.id) || isId(o.id)) return 'order.id'
  if (!isUuid(o.order_id)) return 'order.order_id'
  if (!isText(o.number || '', 20)) return 'order.number'
  if (!optText(o.guest, 80)) return 'order.guest'
  if (!optText(o.table, 20)) return 'order.table'
  if (o.type != null && !isUuid(o.type)) return 'order.type'
  if (!optText(o.type_name, 40)) return 'order.type_name'
  if (o.promised_at != null && !isTime(o.promised_at)) return 'order.promised_at'
  if (o.fire_at != null && !isTime(o.fire_at)) return 'order.fire_at'
  if (!optText(o.note, 500) || !optText(o.allergy, 500)) return 'order.note'
  if (!Array.isArray(o.items) || !o.items.length || o.items.length > 200) return 'order.items'
  for (const i of o.items) {
    if (!isText(i.id, 64) || !i.id) return 'item.id'
    if (!isText(i.name, 200) || !i.name) return 'item.name'
    if (!(Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= 999)) return 'item.qty'
    if (i.item_id != null && !isUuid(i.item_id)) return 'item.item_id'
    if (i.section_id != null && !isUuid(i.section_id)) return 'item.section_id'
    if (i.revenue_stream_id != null && !isUuid(i.revenue_stream_id)) return 'item.revenue_stream_id'
    if (i.options != null && !(Array.isArray(i.options) && i.options.every(x => x && isText(x.label || '', 120)))) return 'item.options'
    if (!optText(i.note, 300)) return 'item.note'
    // A combo's picks (shared/combos.js): each goes to its own stations.
    if (i.parts != null) {
      if (!Array.isArray(i.parts) || i.parts.length > 60) return 'item.parts'
      for (const pt of i.parts) {
        if (!pt || !isText(pt.name || '', 200) || !pt.name) return 'item.parts name'
        if (pt.item_id != null && !isUuid(pt.item_id)) return 'item.parts item_id'
        if (pt.section_id != null && !isUuid(pt.section_id)) return 'item.parts section_id'
        if (pt.options != null && !(Array.isArray(pt.options) && pt.options.every(x => x && isText(x.label || '', 120)))) return 'item.parts options'
      }
    }
  }
  return null
}

/** What is wrong with a kitchen event's shape, or null. Doesn't look at state. */
export function kitchenEventProblem(e) {
  if (!e || typeof e !== 'object') return 'Not an event'
  if (!isId(e.id)) return 'Bad event id'
  if (!KITCHEN_EVENTS.includes(e.type)) return 'Unknown event type'
  if (e.staff_id != null && !isUuid(e.staff_id)) return 'Bad staff member'
  const p = e.payload || {}
  const bad = what => 'Bad ' + e.type + ': ' + what
  if (e.type === 'kitchen.order_in') {
    const why = onlineOrderProblem(p.order)
    return why ? bad(why) : null
  }
  if (e.type === 'kitchen.print_due') return null
  if (!isOrderId(p.order_id)) return bad('order_id')
  switch (e.type) {
    case 'kitchen.item_done':
      if (!isUuid(p.station_id)) return bad('station_id')
      if (!isText(p.item_id, 64) || !p.item_id) return bad('item_id')
      return typeof p.done === 'boolean' ? null : bad('done')
    case 'kitchen.item_checked':
      if (!isUuid(p.station_id)) return bad('station_id')
      if (!isText(p.item_id, 64) || !p.item_id) return bad('item_id')
      return typeof p.checked === 'boolean' ? null : bad('checked')
    case 'kitchen.bumped':
    case 'kitchen.recalled':
      return isUuid(p.station_id) ? null : bad('station_id')
    case 'kitchen.remake':
      if (!isUuid(p.station_id)) return bad('station_id')
      if (!isText(p.item_id, 64) || !p.item_id) return bad('item_id')
      return optText(p.reason, 200) ? null : bad('reason')
    case 'kitchen.priority':
      return typeof p.on === 'boolean' ? null : bad('on')
    case 'kitchen.collected':
      return null
    case 'kitchen.order_status':
      return ['ready', 'collected', 'cancelled'].includes(p.status) ? null : bad('status')
    default:
      return null
  }
}

/** Ids of the kitchen orders a kitchen event reads or changes. */
export function kitchenOrdersTouched(e) {
  const p = e.payload || {}
  if (e.type === 'kitchen.order_in') return p.order?.id ? [p.order.id] : []
  if (e.type === 'kitchen.print_due') return []
  return p.order_id ? [p.order_id] : []
}

/** Ids of the kitchen orders a till event may change (they share the check ids). */
export function kitchenOrdersForCheckEvent(e) {
  if (!KITCHEN_CHECK_EVENTS.includes(e.type)) return []
  const p = e.payload || {}
  const ids = [e.check_id]
  if (e.type === 'lines.moved' && p.to_check_id) ids.push(p.to_check_id)
  if (e.type === 'check.merged' && p.into_check_id) ids.push(p.into_check_id)
  return [...new Set(ids.filter(Boolean))]
}

// ── The flow ───────────────────────────────────────────────────
//
// cfg.stations  { [id]: { id, name, kind, settings } }  (stations in use)
// cfg.flow      [{ id, from: stationId | null, to: stationId, targets: [{ kind, id }], exclude }]
//               from null = Orders in; targets [] = everything. exclude: the
//               link takes every dish but the ones its targets name (Except);
//               with no targets it means nothing (every dish). A shared flow
//               (resolveSharedFlow()) arrives here already in this shape.

/** Does one filter entry name the dish? */
function targetHits(x, target) {
  switch (x.kind) {
    case 'default': return true
    case 'item': return !!target.item_id && x.id === target.item_id
    case 'section': return !!target.section_id && x.id === target.section_id
    case 'device': return !!target.device_id && x.id === target.device_id
    case 'revenue_stream': return !!target.revenue_stream_id && x.id === target.revenue_stream_id
    case 'order_type': return !!target.order_type_id && x.id === target.order_type_id
    default: return false
  }
}

/** Is the link set to Except (with something to except)? */
export const isExcept = link => !!link?.exclude && (link.targets || []).length > 0

/**
 * How specifically a link's filter matches a dish (lower = more), or Infinity.
 * An Except link takes every dish none of its filters names, ranked after
 * any filter that names the dish and before a link with no filter.
 */
export function linkRank(link, target) {
  if (isExcept(link)) return link.targets.some(x => targetHits(x, target)) ? Infinity : RANK.except
  const list = link.targets && link.targets.length ? link.targets : [{ kind: 'default' }]
  let best = Infinity
  for (const x of list) {
    if (targetHits(x, target) && RANK[x.kind] < best) best = RANK[x.kind]
  }
  return best
}

/** The stations a dish goes on to from `from` (null = Orders in). */
export function nextStations(from, target, cfg) {
  const links = (cfg.flow || []).filter(l => (l.from || null) === (from || null) && cfg.stations?.[l.to])
  let best = Infinity
  const ranked = links.map(l => {
    const r = linkRank(l, target)
    if (r < best) best = r
    return [l, r]
  })
  if (best === Infinity) return []
  return [...new Set(ranked.filter(([, r]) => r === best).map(([l]) => l.to))]
}

/**
 * A dish's way through the kitchen: { [stationId]: [the nodes before it] },
 * START standing for Orders in. Empty when the flow sends it nowhere.
 *   target  { item_id, section_id, device_id, revenue_stream_id, order_type_id }
 *           (device_id: the till or kiosk that sent it; online orders none)
 */
export function itemRoute(target, cfg) {
  const route = {}
  const seen = new Set()
  const queue = [null]
  while (queue.length && seen.size < 200) {
    const node = queue.shift()
    const key = node || START
    if (seen.has(key)) continue
    seen.add(key)
    if (node && cfg.stations?.[node]?.kind === 'board') continue
    for (const next of nextStations(node, target, cfg)) {
      const preds = route[next] || (route[next] = [])
      if (!preds.includes(key)) preds.push(key)
      if (!seen.has(next)) queue.push(next)
    }
  }
  return route
}

function mergeRoutes(routes) {
  const out = {}
  for (const r of routes) {
    for (const [node, preds] of Object.entries(r || {})) {
      const list = out[node] || (out[node] = [])
      for (const p of preds) if (!list.includes(p)) list.push(p)
    }
  }
  return out
}

/** The stations on a dish's way, in the order it meets them. */
export function routeOrder(route) {
  const nodes = Object.keys(route || {})
  const depth = {}
  const d = (id, n = 0) => {
    if (depth[id] != null) return depth[id]
    if (n > 50) return 0
    const preds = (route[id] || []).filter(p => p !== START)
    depth[id] = preds.length ? Math.max(...preds.map(p => d(p, n + 1))) + 1 : 0
    return depth[id]
  }
  return nodes.sort((a, b) => d(a) - d(b))
}

/** The nodes right after `node` on a dish's way. */
export function routeNext(route, node) {
  return Object.keys(route || {}).filter(id => (route[id] || []).includes(node))
}

function descendants(route, node) {
  const out = new Set()
  const queue = [node]
  while (queue.length) {
    for (const n of routeNext(route, queue.shift())) if (!out.has(n)) { out.add(n); queue.push(n) }
  }
  return [...out]
}

function ancestors(route, node) {
  const out = new Set()
  const queue = [node]
  while (queue.length) {
    for (const p of route[queue.shift()] || []) if (p !== START && !out.has(p)) { out.add(p); queue.push(p) }
  }
  return [...out]
}

// ── Splitters ──────────────────────────────────────────────

const lower = s => String(s || '').trim().toLowerCase()

/** How many a list of dish / option members counts in some dishes (On order counts, Splitter pieces). */
function memberCount(units, members, qty) {
  let count = 0
  for (const u of units) {
    for (const m of members || []) {
      const per = Number(m.qty) || 1
      if (m.kind === 'dish' && m.id && u.item_id === m.id) count += per * qty
      if (m.kind === 'option' && m.label) {
        for (const mod of u.mods || []) if (mod.kind !== 'remove' && lower(mod.label) === lower(m.label)) count += per * qty
      }
    }
  }
  return count
}

/** The stations a Splitter shares between, in station order. */
export function balanceOutputs(boxId, cfg) {
  const order = Object.keys(cfg.stations || {})
  const outs = new Set((cfg.flow || []).filter(l => l.from === boxId && isBumpKind(cfg.stations?.[l.to]?.kind)).map(l => l.to))
  return order.filter(id => outs.has(id))
}

/**
 * The pieces one dish counts at a station, with `members` (a dish counts its
 * quantity when no member names it; a meal deal counts its parts that go
 * there).
 */
function piecesAt(i, stationId, members) {
  const qty = Number(i.qty) || 0
  const parts = i.parts ? i.parts.filter(pt => pt.route?.[stationId]) : null
  const units = parts && parts.length ? parts.map(pt => ({ item_id: pt.item_id, mods: pt.mods })) : [{ item_id: i.item_id, mods: i.mods }]
  if (parts && parts.length) units.push({ item_id: null, mods: i.mods })
  return memberCount(units, members, qty) || qty * (parts && parts.length ? parts.length : 1)
}

const toDoAt = (i, stationId, cfg, at) => {
  const s = nodeState(i, stationId, cfg, at)
  return s === 'active' || s === 'upcoming'
}

/**
 * Pieces still to cook at a station: every fired dish on its way there not
 * yet done (here or still on its way), counted with `members` (piecesAt()).
 */
export function stationLoad(orders, stationId, members, cfg, at) {
  let load = 0
  for (const o of Object.values(orders || {})) {
    if (!['active', 'ready'].includes(o.status) || isStale(o, at)) continue
    for (const i of o.items) if (toDoAt(i, stationId, cfg, at)) load += piecesAt(i, stationId, members)
  }
  return load
}

/**
 * How fast a station is getting through its work: seconds per piece over its
 * last bumps (up to PACE_TICKETS, made in the PACE_MINUTES before `at`). A
 * ticket counts from when it reached the station or the station's bump before
 * it, whichever is later, so the time it waited behind other tickets isn't
 * counted twice. Pieces as stationLoad(). null with fewer than two bumps to
 * go on; never under one second a piece.
 */
export function stationPace(orders, stationId, members, cfg, at) {
  const bumps = []
  for (const o of Object.values(orders || {})) {
    for (const b of o.bumps || []) {
      if (b.station_id !== stationId || b.recalled_at || !b.items) continue
      const t = ms(b.at)
      if (!Number.isFinite(t) || (at && t > ms(at))) continue
      let pieces = 0
      for (const [itemId, node] of b.set || []) {
        if (node !== stationId) continue
        const i = o.items.find(x => x.id === itemId)
        if (i) pieces += piecesAt(i, stationId, members)
      }
      if (pieces > 0) bumps.push({ at: t, start: ms(b.started_at), pieces })
    }
  }
  bumps.sort((x, y) => x.at - y.at)
  const from = at ? ms(at) - PACE_MINUTES * 60_000 : -Infinity
  let secs = 0
  let pieces = 0
  let n = 0
  for (let k = bumps.length - 1; k >= 0 && n < PACE_TICKETS; k--) {
    const b = bumps[k]
    if (b.at < from) break
    const prev = k > 0 ? bumps[k - 1].at : null
    const start = Number.isFinite(b.start) ? (prev != null ? Math.max(b.start, prev) : b.start) : prev
    if (start == null) continue
    secs += Math.max(0, b.at - start) / 1000
    pieces += b.pieces
    n++
  }
  return n >= 2 && pieces > 0 ? Math.max(1, secs / pieces) : null
}

/**
 * Orders of one order type with something still to cook at any of these
 * stations (the busy order type rule), leaving out the order `exceptId`.
 */
export function typeWaiting(orders, typeId, stationIds, cfg, at, exceptId = null) {
  let n = 0
  for (const o of Object.values(orders || {})) {
    if (!typeId || o.type !== typeId || o.id === exceptId) continue
    if (!['active', 'ready'].includes(o.status) || isStale(o, at)) continue
    if (o.items.some(i => stationIds.some(id => toDoAt(i, id, cfg, at)))) n++
  }
  return n
}

/**
 * The stations a ticket may go to at a Splitter. With its busy order type
 * rule on and rush_count or more orders of that type waiting at the box's
 * stations (counting this one): that type's tickets go to rush_station_id
 * only, every other ticket to the others. Otherwise (and when the box doesn't
 * link to that station) all of them.
 */
function busyTypeStations(settings, outs, ko, open, cfg, at) {
  const type = settings.rush_type_id
  const to = settings.rush_station_id
  if (!type || !to || !ko || outs.length < 2 || !outs.includes(to)) return outs
  const mine = ko.type === type
  const waiting = typeWaiting(open, type, outs, cfg, at, ko.id) + (mine ? 1 : 0)
  if (waiting < Math.max(1, Number(settings.rush_count) || 1)) return outs
  return mine ? [to] : outs.filter(id => id !== to)
}

/** Each station's pace, the unknown ones at the others' average (none known: all the same). */
function fillPaces(list) {
  const known = list.filter(p => p != null)
  const avg = known.length ? known.reduce((t, p) => t + p, 0) / known.length : 1
  return list.map(p => p ?? avg)
}

/** The Splitters in a flow, upstream ones first. */
function flowBoxes(cfg) {
  const graph = {}
  for (const l of cfg.flow || []) {
    if (!cfg.stations?.[l.to] || (l.from && !cfg.stations?.[l.from])) continue
    const preds = graph[l.to] || (graph[l.to] = [])
    preds.push(l.from || START)
  }
  return routeOrder(graph).filter(id => cfg.stations?.[id]?.kind === 'balance')
}

/** The pieces one part of a ticket counts at a Splitter (a dish its quantity when no piece names it). */
function unitPieces(u, members) {
  const qty = Number(u.item.qty) || 0
  const units = [u.part ? { item_id: u.part.item_id, mods: u.part.mods } : { item_id: u.item.item_id, mods: u.item.mods }]
  // A meal deal's own options count with its first part that reaches the box.
  if (u.part && u.first) units.push({ item_id: null, mods: u.item.mods })
  return memberCount(units, members, qty) || qty
}

/**
 * Decides every Splitter on a ticket's dishes (the dishes sent or fired
 * together; held ones are left for course.fired), changing their ways in
 * place. `ko` is the kitchen order they're on (its order type for the busy
 * order type rule). Each box sends what reaches it to the station with the
 * fewest pieces still to cook (stationLoad over cfg.balance.open) or, Smart,
 * the one that should be done soonest (those pieces plus the ticket's, times
 * stationPace over cfg.balance.recent), a tie going to the first after the
 * box's last pick (cfg.balance.last), so they take turns. With the busy order
 * type rule on, only the stations busyTypeStations() leaves count. The whole
 * ticket goes to one station unless the box shares big tickets
 * (settings.split_above = N) and more than N pieces reach it: then each dish
 * line (or meal deal part) goes, biggest first, to the station with the least
 * to do counting what this ticket has already put there. One line is never
 * split. Records each box's last pick in cfg.balance.picks for the caller to
 * keep.
 */
export function balanceTicket(items, cfg, at, ko = null) {
  const units = []
  for (const item of items || []) {
    if (item.parts && item.parts.length) item.parts.forEach(part => units.push({ item, part, route: part.route }))
    else units.push({ item, part: null, route: item.route })
  }
  if (!units.some(u => routeHasBalance(u.route, cfg))) return
  const b = cfg.balance || {}
  for (const box of flowBoxes(cfg)) {
    const here = units.filter(u => u.route && u.route[box])
    if (!here.length) continue
    const outs = balanceOutputs(box, cfg)
    if (!outs.length) {
      // Nothing to share with: the dishes go nowhere past the box.
      for (const u of here) u.route = collapseBalance(u.route, box, null)
      continue
    }
    const settings = stationSettings(cfg.stations?.[box])
    const members = settings.pieces || []
    let last = outs.indexOf(b.last?.[box] || '')
    const loads = outs.map(id => stationLoad(b.open || {}, id, members, cfg, at))
    // Smart: seconds a piece at each station; fewest pieces: all the same.
    const paces = settings.share_mode === 'speed'
      ? fillPaces(outs.map(id => stationPace(b.recent || b.open || {}, id, members, cfg, at)))
      : outs.map(() => 1)
    const allowed = busyTypeStations(settings, outs, ko, b.open || {}, cfg, at)
    // The least to do once `add` more pieces are there, a tie to the first
    // station after the last pick.
    const next = add => {
      const score = id => (loads[outs.indexOf(id)] + add) * paces[outs.indexOf(id)]
      const low = Math.min(...allowed.map(score))
      const ring = [...outs.slice(last + 1), ...outs.slice(0, last + 1)]
      const to = ring.find(id => allowed.includes(id) && score(id) - low < 1e-6)
      last = outs.indexOf(to)
      return to
    }
    const seen = new Set()
    for (const u of here) {
      u.first = !!u.part && !seen.has(u.item)
      seen.add(u.item)
      u.pieces = unitPieces(u, members)
    }
    const total = here.reduce((t, u) => t + u.pieces, 0)
    const share = allowed.length > 1 && settings.split_above != null && total > Number(settings.split_above)
    if (!share) {
      const to = next(total)
      for (const u of here) u.route = collapseBalance(u.route, box, to)
    } else {
      // Biggest first; a dish's parts keep their order among equals.
      const biggest = here.map((u, i) => [u, i]).sort((x, y) => y[0].pieces - x[0].pieces || x[1] - y[1]).map(([u]) => u)
      for (const u of biggest) {
        const to = next(u.pieces)
        loads[outs.indexOf(to)] += u.pieces
        u.route = collapseBalance(u.route, box, to)
      }
    }
    if (b.picks) b.picks[box] = outs[last]
  }
  for (const item of items) {
    const mine = units.filter(u => u.item === item)
    if (item.parts && item.parts.length) {
      for (const u of mine) u.part.route = u.route
      item.route = mergeRoutes(item.parts.map(pt => pt.route))
    } else if (mine.length) {
      item.route = mine[0].route
    }
  }
}

/** A dish's way with a Splitter taken out: its dishes go on to `to` only. */
function collapseBalance(route, box, to) {
  const out = {}
  for (const [n, preds] of Object.entries(route)) if (n !== box) out[n] = [...preds]
  const boxPreds = route[box] || []
  for (const [n, preds] of Object.entries(out)) {
    const i = preds.indexOf(box)
    if (i < 0) continue
    preds.splice(i, 1)
    if (n === to) for (const p of boxPreds) if (!preds.includes(p)) preds.push(p)
  }
  // Drop what only the stations not picked led to.
  for (let gone = true; gone;) {
    gone = false
    for (const n of Object.keys(out)) {
      if (out[n].length) continue
      delete out[n]
      gone = true
      for (const preds of Object.values(out)) { const j = preds.indexOf(n); if (j >= 0) preds.splice(j, 1) }
    }
  }
  return out
}

/** Does this way still go through a Splitter (a held course not fired yet)? */
export function routeHasBalance(route, cfg) {
  return Object.keys(route || {}).some(id => cfg.stations?.[id]?.kind === 'balance')
}

/** A dish's way with every Splitter on it decided (`pick(boxId)` -> station id | null). */
export function resolveBalances(route, cfg, pick) {
  let r = route
  for (let n = 0; n < 20; n++) {
    const box = routeOrder(r).find(id => cfg.stations?.[id]?.kind === 'balance')
    if (!box) return r
    r = collapseBalance(r, box, pick(box))
  }
  return r
}

/**
 * What is wrong with a flow (blocks saving): [message].
 *   stations  [{ id, name, kind }]
 *   links     [{ from, to, targets }]
 */
export function flowProblems(stations, links) {
  const byId = Object.fromEntries((stations || []).map(s => [s.id, s]))
  const name = id => (id ? byId[id]?.name || 'a removed station' : 'Orders in')
  const out = []
  const pairs = new Set()
  for (const l of links || []) {
    if (!byId[l.to]) { out.push('A link goes to a station that isn\'t there any more'); continue }
    if (l.from && !byId[l.from]) { out.push('A link comes from a station that isn\'t there any more'); continue }
    if (l.from && l.from === l.to) out.push(name(l.to) + ' links to itself')
    if (l.from && byId[l.from].kind === 'board') out.push(name(l.from) + ' is an order ready board: nothing goes on from it')
    if (l.from && byId[l.from].kind === 'balance') {
      if (!isBumpKind(byId[l.to].kind)) out.push(name(l.from) + ' shares dishes between kitchen stations: link it to prep stations, an expo or runners')
      if ((l.targets || []).length) out.push('Links out of ' + name(l.from) + ' take every dish it gets: remove their filters')
    }
    const key = (l.from || START) + '>' + l.to
    if (pairs.has(key)) out.push(name(l.from) + ' links to ' + name(l.to) + ' twice')
    pairs.add(key)
    for (const t of l.targets || []) {
      if (!FLOW_TARGET_KINDS.includes(t.kind)) out.push('A link has a filter the kitchen doesn\'t know')
      // Every dish but every dish: the link would take nothing.
      else if (t.kind === 'default' && isExcept(l)) out.push('A link set to Except can\'t leave out every dish')
    }
  }
  // Circles: a dish could never get out of one.
  const next = {}
  for (const l of links || []) if (l.from && byId[l.from] && byId[l.to]) (next[l.from] = next[l.from] || []).push(l.to)
  const state = {}
  const path = []
  let circle = null
  const visit = id => {
    if (circle) return
    state[id] = 1
    path.push(id)
    for (const n of next[id] || []) {
      if (state[n] === 1) { circle = [...path.slice(path.indexOf(n)), n]; return }
      if (!state[n]) visit(n)
      if (circle) return
    }
    path.pop()
    state[id] = 2
  }
  for (const id of Object.keys(next)) if (!state[id] && !circle) visit(id)
  if (circle) out.push(circle.map(name).join(' > ') + ' goes round in a circle')
  return [...new Set(out)]
}

/** Things worth knowing about a flow (don't block saving): [message]. */
export function flowWarnings(stations, links) {
  const out = []
  const live = (stations || []).filter(s => s.is_active !== false)
  if (!live.length) return out
  if (!(links || []).some(l => !l.from)) out.push('Nothing comes in yet: link Orders in to the stations that make the dishes.')
  const reach = new Set()
  const queue = [null]
  while (queue.length) {
    const n = queue.shift()
    for (const l of links || []) {
      if ((l.from || null) === n && !reach.has(l.to)) { reach.add(l.to); queue.push(l.to) }
    }
  }
  for (const s of live) if (!reach.has(s.id)) out.push(s.name + ' isn\'t on the way of any dish.')
  for (const s of live) {
    if (s.kind !== 'sleeper') continue
    if (!(links || []).some(l => l.from === s.id)) out.push(s.name + ' holds dishes but sends them nowhere: link it to the stations they go to next.')
  }
  for (const s of live) {
    if (s.kind !== 'balance') continue
    const outs = new Set((links || []).filter(l => l.from === s.id).map(l => l.to))
    if (outs.size < 2) out.push(s.name + (outs.size ? ' has only one station to share with: link it to another.' : ' shares with no stations yet: link it to two or more.'))
    // The busy order type rule sends to a station the box doesn't link to: it never applies.
    const to = s.settings?.rush_type_id && s.settings?.rush_station_id
    if (to && outs.size && !outs.has(to)) {
      const name = (stations || []).find(x => x.id === to)?.name || 'a station'
      out.push(s.name + ' sends busy orders to ' + name + ' but doesn\'t link to it: link it there, or its busy order type rule never applies.')
    }
  }
  return out
}

// ── Shared flows (migration 192) ───────────────────────────────
//
// A shared flow (kds_flows.venue_id NULL) is used by every location. Its
// boxes are named stations; at a location each box is that location's
// station with the same name (case and spaces ignored), so one flow sends
// each location's dishes to its own Grill, Fryer and Pass. Its filters name
// dishes, sections and order types by id (the company's) and revenue streams
// and tills / kiosks by name (each location has its own).
//   flow.boxes  [{ id, name, kind }]
//   flow.links  [{ id, from: boxId | null, to: boxId, targets: [{ kind, id } | { kind, name }], exclude }]

/** A station, stream or till name as matched across locations. */
export const flowName = v => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
/** Filters a shared flow keeps by name: each location's own streams and tills. */
export const NAMED_TARGET_KINDS = ['device', 'revenue_stream']

function byFlowName(list) {
  const out = {}
  for (const r of list || []) (out[flowName(r.name)] = out[flowName(r.name)] || []).push(r)
  return out
}

/**
 * A shared flow at one location: { links, matches: { [boxId]: stationId },
 * missing: [box], differs: [{ box, station }] }.
 *   place  { stations: [{ id, name, kind }], streams: [{ id, name }],
 *            devices: [{ id, name }] } (the location's)
 * Links to or from a box the location has no station for are left out, so no
 * dish goes there; a filter naming a stream or till the location doesn't
 * have matches no dish (so an Except link keeps every dish: it stays an
 * Except link, ranked as at the other locations). With two stations of one
 * name the first counts.
 */
export function resolveSharedFlow(flow, place = {}) {
  const stations = byFlowName(place.stations)
  const named = { revenue_stream: byFlowName(place.streams), device: byFlowName(place.devices) }
  const matches = {}
  const missing = []
  const differs = []
  for (const b of flow?.boxes || []) {
    const st = stations[flowName(b.name)]?.[0]
    if (!st) { missing.push(b); continue }
    matches[b.id] = st.id
    if (b.kind && st.kind !== b.kind) differs.push({ box: b, station: st })
  }
  const targets = list => (list || []).flatMap(t => {
    if (!NAMED_TARGET_KINDS.includes(t.kind)) return [t]
    const hits = named[t.kind][flowName(t.name)] || []
    // Nothing of that name here: an id of null matches no dish.
    return hits.length ? hits.map(h => ({ kind: t.kind, id: h.id })) : [{ kind: t.kind, id: null }]
  })
  const links = []
  for (const l of flow?.links || []) {
    const to = matches[l.to]
    const from = l.from ? matches[l.from] : null
    if (!to || (l.from && !from)) continue
    links.push({ id: l.id, from, to, targets: targets(l.targets), exclude: isExcept(l) })
  }
  return { links, matches, missing, differs }
}

/**
 * A location's own flow as a shared one: { boxes, links }. Its stations
 * become boxes (box id = station id) and its stream and till filters names.
 *   stations  the location's stations in the flow [{ id, name, kind }]
 *   names     { revenue_stream: { id: name }, device: { id: name } }
 * Of two stations with one name the first is kept; links to the other go,
 * and so do filters naming a stream or till that has gone (an Except link
 * left with none takes every dish).
 */
export function shareFlow(links, stations, names = {}) {
  const boxes = []
  const seen = new Set()
  for (const s of stations || []) {
    const n = flowName(s.name)
    if (!n || seen.has(n)) continue
    seen.add(n)
    boxes.push({ id: s.id, name: String(s.name).trim().replace(/\s+/g, ' '), kind: s.kind })
  }
  const ids = new Set(boxes.map(b => b.id))
  const out = []
  for (const l of links || []) {
    if (!ids.has(l.to) || (l.from && !ids.has(l.from))) continue
    const targets = []
    for (const t of l.targets || []) {
      if (!NAMED_TARGET_KINDS.includes(t.kind)) { targets.push(t); continue }
      const name = names[t.kind]?.[t.id]
      if (name && !targets.some(x => x.kind === t.kind && flowName(x.name) === flowName(name))) targets.push({ kind: t.kind, name })
    }
    // A link whose every filter has gone took only those dishes: it goes too
    // (an Except link took the rest: it now takes every dish).
    if ((l.targets || []).length && !targets.length && !isExcept(l)) continue
    out.push({ id: l.id, from: l.from || null, to: l.to, targets, exclude: isExcept(l) && targets.length > 0 })
  }
  return { boxes, links: out }
}

/** What is wrong with a shared flow's boxes (blocks saving): [message]. */
export function boxProblems(boxes) {
  const out = []
  const seen = new Set()
  for (const b of boxes || []) {
    const n = flowName(b.name)
    if (!n) out.push('Every box needs a name')
    else if (seen.has(n)) out.push('Two boxes are called ' + String(b.name).trim() + ': each location finds its station by name')
    seen.add(n)
    if (!STATION_KINDS.includes(b.kind)) out.push('A box has a kind the kitchen doesn\'t know')
  }
  return [...new Set(out)]
}

// ── Building orders and items ──────────────────────────────────

const eventTime = e => e.received_at || e.client_at || null

function kitchenMods(mods = []) {
  return groupModifiers(mods).map(m => ({
    text: modifierText(m),
    label: m.label || '',
    kind: m.prefix === 'no' ? 'remove' : m.base ? 'base' : 'add',
    depth: m.depth || 0,
  }))
}

function headerFromCheck(check, cfg) {
  const number = check.order_no != null ? String(check.order_no)
    : check.number != null ? String(check.number) : (check.provisional_no || '')
  return {
    number,
    counter: check.mode === 'counter',
    board: check.mode === 'counter',
    table: check.table_id ? (cfg.tables?.[check.table_id]?.label || null) : null,
    tab: check.table_id ? null : (check.tab_name || null),
    covers: check.covers ?? null,
    server: cfg.staff?.[check.server_id]?.name || null,
    type: check.order_type_id || null,
    type_name: cfg.order_types?.[check.order_type_id]?.name || null,
    tent: check.tent || null,
    note: check.note || null,
  }
}

function newOrder(fields, at) {
  return {
    id: null, source: 'till', check_id: null, order_id: null,
    number: '', counter: false, board: false, table: null, tab: null, guest: null,
    covers: null, server: null, type: null, type_name: null, tent: null, promised_at: null, note: null, allergy: null,
    priority: false, status: 'active',
    created_at: at, ready_at: null, ready_event: null, collected_at: null, cancelled_at: null, merged_into: null,
    items: [], bumps: [], changed_at: null, events: 0, updated_at: at,
    ...fields,
  }
}

function itemFromLine(line, check, cfg, at, held, type, deviceId) {
  const rs = line.revenue_stream_id ?? check.revenue_stream_id
  // Splitters stay on the way until balanceTicket() decides them. The
  // till or kiosk that sends the dish counts for links filtered by device.
  const way = target => itemRoute({ ...target, device_id: deviceId || null }, cfg)
  let parts = null
  let route
  if (line.combo && line.combo.length) {
    // Each pick goes where that dish goes; a typed-in choice (no dish)
    // goes where the combo itself goes, and takes the combo's section
    // (for the screens' section colours, kitchenColours.js).
    parts = line.combo.map(p => ({
      item_id: p.item_id || null, section_id: (p.item_id ? p.section_id : line.section_id) || null,
      name: p.kitchen_name || p.name, mods: kitchenMods(p.modifiers),
      route: way(p.item_id
        ? { item_id: p.item_id, section_id: p.section_id, revenue_stream_id: rs, order_type_id: type }
        : { item_id: line.item_id, section_id: line.section_id, revenue_stream_id: rs, order_type_id: type }),
    }))
    route = mergeRoutes(parts.map(p => p.route))
  } else {
    route = way({ item_id: line.item_id, section_id: line.section_id, revenue_stream_id: rs, order_type_id: type })
  }
  const course = line.course_id ? cfg.courses?.[line.course_id] : null
  return {
    id: line.id, item_id: line.item_id || null, section_id: line.section_id || null, name: line.kitchen_name || line.name, qty: line.qty,
    mods: kitchenMods(line.modifiers), parts,
    note: line.note || null, allergies: line.allergies || [], seat: line.seat ?? null,
    course_id: line.course_id || null, course: course?.name || null, course_sort: course?.sort_order ?? null,
    route,
    sent_at: at, fired_at: held ? null : at, fire_at: null, since: held ? null : at,
    done: {}, reset: {}, voided_at: null, void_reason: null, void_seen: {}, remakes: 0, added: false,
  }
}

function itemFromOnline(i, cfg, at, fireAt, type) {
  const onlineMods = opts => (opts || []).map(o => ({ text: o.label, label: o.label, kind: o.mode === 'base' ? 'base' : 'add', depth: 0 }))
  const rs = i.revenue_stream_id || null
  const own = { item_id: i.item_id, section_id: i.section_id, revenue_stream_id: rs, order_type_id: type }
  const way = target => itemRoute(target, cfg)
  // A combo's picks, each to its own stations (a typed-in choice goes with the combo).
  const parts = Array.isArray(i.parts) && i.parts.length ? i.parts.map(p => ({
    item_id: p.item_id || null, section_id: (p.item_id ? p.section_id : i.section_id) || null,
    name: p.kitchen_name || p.name, mods: onlineMods(p.options),
    route: way(p.item_id ? { item_id: p.item_id, section_id: p.section_id || null, revenue_stream_id: rs, order_type_id: type } : own),
  })) : null
  return {
    id: String(i.id), item_id: i.item_id || null, section_id: i.section_id || null, name: i.name, qty: i.qty,
    mods: onlineMods(i.options),
    parts, note: i.note || null, allergies: [], seat: null,
    course_id: null, course: null, course_sort: null,
    route: parts ? mergeRoutes(parts.map(p => p.route)) : way(own),
    sent_at: at, fired_at: fireAt ? null : at, fire_at: fireAt || null, since: fireAt ? null : at,
    done: {}, reset: {}, voided_at: null, void_reason: null, void_seen: {}, remakes: 0, added: false,
  }
}

// ── Item and order state ───────────────────────────────────────

/** Has this item been fired (sent, or its held course fired, or its time come) by `at`? */
export function isFired(item, at) {
  if (item.fired_at) return true
  return !!(item.fire_at && at && ms(item.fire_at) <= ms(at))
}

/** When this item went live in the kitchen (for timers). */
export function liveSince(item) {
  return item.since || item.fired_at || item.fire_at || item.sent_at
}

/**
 * When a dish reached / was done at each node of its way.
 *   arrived(id)  every node before it done (or Orders in: fired), else null
 *   done(id)     bumped there; a board is done when reached; a station no
 *                longer in the flow is passed straight through; a Sleeper
 *                is done its delay after the dish reached it, once `at` is
 *                that late (null before, and with no `at`)
 *   wakes(id)    a Sleeper: when the dish leaves it (arrived + delay), even
 *                if that is still to come; null elsewhere or not reached
 */
export function flowTimes(item, cfg, at) {
  const route = item.route || {}
  const fired = isFired(item, at) ? liveSince(item) : null
  const gone = id => !!cfg?.stations && !cfg.stations[id]
  const arrived = (id, n = 0) => {
    const preds = route[id] || []
    if (!preds.length || n > 60) return null
    let t = null
    for (const p of preds) {
      const pt = p === START ? fired : done(p, n + 1)
      if (!pt) return null
      t = later(t, pt)
    }
    return later(t, item.reset?.[id] || null)
  }
  const wakes = (id, n = 0) => {
    const a = arrived(id, n)
    if (!a) return null
    if (item.slept?.[id]) return a
    return new Date(ms(a) + sleepMs(cfg, id)).toISOString()
  }
  const done = (id, n = 0) => {
    if (item.done?.[id]) return item.done[id]
    if (!gone(id) && isSleeper(cfg, id)) {
      const w = wakes(id, n)
      return w && at && ms(w) <= ms(at) ? w : null
    }
    if (gone(id) || noBump(cfg?.stations?.[id]?.kind)) return arrived(id, n)
    return null
  }
  return {
    arrived: id => arrived(id),
    done: id => done(id),
    wakes: id => (isSleeper(cfg, id) && !gone(id) ? wakes(id) : null),
  }
}

/**
 * An item's state at one node:
 *   'voided' | 'held' (course not fired / order for later) | 'upcoming'
 *   (still at an earlier station) | 'active' | 'done' | 'sleeping' (a
 *   Sleeper holding it now) | null (not on its way)
 */
export function nodeState(item, nodeId, cfg, at) {
  if (!item.route?.[nodeId]) return null
  if (item.voided_at) return 'voided'
  if (!isFired(item, at)) return 'held'
  const f = flowTimes(item, cfg, at)
  if (item.done?.[nodeId]) return 'done'
  if (isSleeper(cfg, nodeId) && f.arrived(nodeId)) return f.done(nodeId) ? 'done' : 'sleeping'
  if (f.arrived(nodeId)) return noBump(cfg?.stations?.[nodeId]?.kind) ? 'done' : 'active'
  return 'upcoming'
}

/** An item's state at a station (nodeState for that station). */
export function itemState(item, station, at, cfg) {
  return nodeState(item, station?.id, cfg, at)
}

/** The stations a dish is waiting at now (reached, not done; boards left out, Sleepers holding it in). */
export function itemWhere(item, cfg, at) {
  if (item.voided_at || !isFired(item, at)) return []
  const f = flowTimes(item, cfg, at)
  return Object.keys(item.route || {}).filter(id =>
    cfg?.stations?.[id] && (!noBump(cfg.stations[id].kind) || isSleeper(cfg, id)) && f.arrived(id) && !f.done(id))
}

/** The Sleepers holding a dish now: [{ station_id, until }]. */
export function itemSleeps(item, cfg, at) {
  if (item.voided_at || !isFired(item, at)) return []
  const f = flowTimes(item, cfg, at)
  return Object.keys(item.route || {})
    .filter(id => isSleeper(cfg, id) && f.arrived(id) && !f.done(id))
    .map(id => ({ station_id: id, until: f.wakes(id) }))
}

/**
 * When a dish's work can start: when it first reached a station that makes
 * or checks dishes. Without a Sleeper on its way that is when it was fired
 * (liveSince); a dish a Sleeper still holds starts when it wakes (a time
 * still to come).
 */
export function workSince(item, cfg, at) {
  const ids = Object.keys(item.route || {})
  if (!ids.some(id => isSleeper(cfg, id))) return liveSince(item)
  const f = flowTimes(item, cfg, at)
  return minTime(ids.filter(id => isBumpKind(cfg?.stations?.[id]?.kind)).map(id => f.arrived(id)))
    || minTime(ids.map(id => f.wakes(id)).filter(w => w && (!at || ms(w) > ms(at))))
    || liveSince(item)
}

const liveItems = o => o.items.filter(i => !i.voided_at)
const kindOf = (cfg, id) => cfg?.stations?.[id]?.kind
const routeNodes = (item, cfg) => Object.keys(item.route || {}).filter(id => !cfg?.stations || cfg.stations[id])

/**
 * Where an order stands:
 *   ready        every dish has reached every board and runner on its way,
 *                and dishes with neither are done everywhere
 *   finished     every dish is done at every station on its way
 *   handedOver   finished, and every dish's way ends at a runner (the runner
 *                took it out, so nobody collects it from a board)
 */
export function orderFacts(o, cfg, at) {
  let ready = true
  let finished = true
  let runnerEnds = true
  let any = false
  for (const i of liveItems(o)) {
    if (!isFired(i, at)) { ready = false; finished = false; runnerEnds = false; continue }
    const nodes = routeNodes(i, cfg)
    if (!nodes.length) continue
    any = true
    const f = flowTimes(i, cfg, at)
    const ends = nodes.filter(id => ['board', 'runner'].includes(kindOf(cfg, id)))
    const bumpNodes = nodes.filter(id => !noBump(kindOf(cfg, id)))
    const allDone = bumpNodes.every(id => f.done(id))
    if (ends.length ? !ends.every(id => f.arrived(id)) : !allDone) ready = false
    if (!allDone) finished = false
    const endsAtRunner = nodes.some(id => kindOf(cfg, id) === 'runner' && !nodes.some(n => (i.route[n] || []).includes(id)))
    if (!endsAtRunner) runnerEnds = false
  }
  return { ready, finished, handedOver: any && finished && runnerEnds }
}

function touch(o, at) {
  o.events = (o.events || 0) + 1
  o.updated_at = at || o.updated_at
}

/**
 * Keep the order's status in step with its items.
 *   - everything voided: cancelled
 *   - not ready (new work, a remake, a dish brought back): active
 *   - ready (orderFacts): ready; handed over by a runner: collected
 */
function refreshStatus(o, cfg, at, eventId) {
  if (o.status === 'merged') return
  const live = liveItems(o)
  if (!live.length) {
    if (o.items.length && o.status !== 'cancelled') { o.status = 'cancelled'; o.cancelled_at = at }
    return
  }
  if (o.status === 'cancelled') {
    if (o.cancelled_by_server) return
    o.status = 'active'
    o.cancelled_at = null
  }
  const f = orderFacts(o, cfg, at)
  if (!f.ready) {
    if (o.status !== 'active') {
      o.status = 'active'
      o.ready_at = null
      o.ready_event = null
      o.collected_at = null
    }
    return
  }
  if (o.status === 'active') {
    o.status = 'ready'
    o.ready_at = at
    o.ready_event = eventId || null
  }
  if (o.status === 'ready' && f.handedOver) {
    o.status = 'collected'
    o.collected_at = at
    o.collected_event = eventId || null
  }
}

// ── Till events ────────────────────────────────────────────────

/**
 * Kitchen orders a sequenced till event changes.
 *   e       the event (with received_at)
 *   before  { [checkId]: check } before the event
 *   after   { [checkId]: check } the checks it changed
 *   orders  { [id]: kitchen order } the ones kitchenOrdersForCheckEvent(e) names that exist
 *   cfg     kitchen config: { enabled, stations, flow, courses, tables, staff, order_types }
 * Returns { [id]: order } (new objects; the input is never changed).
 */
export function kitchenForCheckEvent(e, before = {}, after = {}, orders = {}, cfg = {}) {
  if (!cfg.enabled || !KITCHEN_CHECK_EVENTS.includes(e.type)) return {}
  const at = eventTime(e)
  const p = e.payload || {}
  const out = {}
  const get = id => out[id] || (orders[id] ? (out[id] = clone(orders[id])) : null)
  const check = after[e.check_id] || before[e.check_id]
  if (!check) return {}

  const ensure = c => {
    const o = get(c.id)
    if (o) return o
    out[c.id] = newOrder({ id: c.id, source: 'till', check_id: c.id, ...headerFromCheck(c, cfg) }, at)
    return out[c.id]
  }
  const refreshHeader = (o, c) => {
    const h = headerFromCheck(c, cfg)
    for (const k of ['number', 'counter', 'board', 'table', 'tab', 'covers', 'server', 'type', 'type_name', 'tent', 'note']) o[k] = h[k]
  }

  switch (e.type) {
    case 'lines.sent': {
      const ids = new Set(p.line_ids)
      const was = before[e.check_id]
      const lines = check.lines.filter(l => ids.has(l.id) && l.send_id === p.send_id
        && (was?.lines.find(x => x.id === l.id)?.status ?? 'new') === 'new')
      if (!lines.length) return {}
      const o = ensure(check)
      refreshHeader(o, check)
      const hadItems = o.items.length > 0
      const sent = []
      for (const l of lines) {
        if (o.items.some(i => i.id === l.id)) continue
        const item = itemFromLine(l, check, cfg, at, l.held, o.type, e.device_id)
        item.added = hadItems
        o.items.push(item)
        sent.push(item)
      }
      // Splitters for what goes now; a held course keeps its boxes until it's fired.
      balanceTicket(sent.filter(i => i.fired_at), cfg, at, o)
      if (hadItems) o.changed_at = at
      refreshStatus(o, cfg, at, e.id)
      touch(o, at)
      break
    }

    case 'course.fired': {
      const o = get(e.check_id)
      if (!o) return {}
      const fired = []
      for (const i of o.items) {
        if (i.course_id === p.course_id && !i.fired_at && !i.voided_at) {
          i.fired_at = at
          i.since = at
          fired.push(i)
        }
      }
      if (!fired.length) return {}
      // Splitters on the course's way are decided now, with the kitchen as it is.
      balanceTicket(fired, cfg, at, o)
      o.changed_at = at
      refreshStatus(o, cfg, at, e.id)
      touch(o, at)
      break
    }

    case 'line.voided': {
      const o = get(e.check_id)
      if (!o) return {}
      const item = o.items.find(i => i.id === p.line_id)
      if (!item || item.voided_at) return {}
      const reason = String(p.reason || '').trim() || null
      if (p.qty != null && p.qty < item.qty && p.new_line_id) {
        item.qty -= p.qty
        o.items.splice(o.items.indexOf(item) + 1, 0, { ...clone(item), id: p.new_line_id, qty: p.qty, voided_at: at, void_reason: reason, void_seen: {} })
      } else {
        item.voided_at = at
        item.void_reason = reason
      }
      o.changed_at = at
      refreshStatus(o, cfg, at, e.id)
      touch(o, at)
      break
    }

    case 'lines.moved': {
      const from = get(e.check_id)
      if (!from) return {}
      const ids = new Set(p.line_ids)
      const moving = from.items.filter(i => ids.has(i.id))
      if (!moving.length) return {}
      const target = after[p.to_check_id]
      if (!target) return {}
      const to = ensure(target)
      refreshHeader(to, target)
      from.items = from.items.filter(i => !ids.has(i.id))
      to.items.push(...moving.map(i => ({ ...i, added: to.items.length > 0 })))
      from.changed_at = at
      to.changed_at = at
      if (!from.items.length) { from.status = 'merged'; from.merged_into = to.id }
      else refreshStatus(from, cfg, at, e.id)
      refreshStatus(to, cfg, at, e.id)
      touch(from, at)
      touch(to, at)
      break
    }

    case 'check.merged': {
      const from = get(e.check_id)
      if (!from || !from.items.length) return {}
      const target = after[p.into_check_id]
      if (!target) return {}
      const to = ensure(target)
      refreshHeader(to, target)
      to.items.push(...from.items.map(i => ({ ...i, added: to.items.length > 0 })))
      to.priority = to.priority || from.priority
      from.items = []
      from.status = 'merged'
      from.merged_into = to.id
      to.changed_at = at
      refreshStatus(to, cfg, at, e.id)
      touch(from, at)
      touch(to, at)
      break
    }

    default: {
      // Header changes: table moved, renamed, covers, server, note.
      const o = get(e.check_id)
      if (!o) return {}
      refreshHeader(o, check)
      touch(o, at)
    }
  }
  return out
}

// ── Kitchen events ─────────────────────────────────────────────

const fail = (error, code = 'refused') => ({ ok: false, error, code })

/** Has this station had the dish in front of it (reached it, or shows dishes early)? */
function seenAt(item, station, cfg) {
  const preds = item.route?.[station.id]
  if (!preds) return false
  if (stationSettings(station).show_upcoming || preds.includes(START)) return true
  const f = flowTimes({ ...item, voided_at: null }, cfg, item.voided_at)
  return !!f.arrived(station.id)
}

function voidsToSee(o, station, cfg) {
  return o.items.filter(i => i.voided_at && i.route?.[station.id] && !i.done[station.id] && !i.void_seen?.[station.id] && seenAt(i, station, cfg))
}

function qtyOf(items) {
  return items.reduce((s, i) => s + (Number(i.qty) || 0), 0)
}

/** When the station's work on these dishes started (the pass: the order's age;
 *  elsewhere: when the dishes reached it). */
function startedAt(items, station, cfg, at) {
  const times = items.map(i => {
    if (station.kind === 'expo') return workSince(i, cfg, at)
    return flowTimes(i, cfg, at).arrived(station.id) || liveSince(i)
  }).map(ms).filter(Number.isFinite)
  return times.length ? new Date(Math.min(...times)).toISOString() : at
}

function bumpRecord(e, station, at, set, items, cfg, extra = {}) {
  const start = startedAt(items, station, cfg, at)
  return {
    id: e.id, station_id: station.id, kind: station.kind, at, set,
    started_at: start,
    seconds: Math.max(0, Math.round((ms(at) - ms(start)) / 1000)),
    items: qtyOf(items), recalled_at: null, ...extra,
  }
}

const nameOf = (cfg, id) => cfg?.stations?.[id]?.name || 'another station'

/** Mark a dish done everywhere before `node` (it is at `node` now). */
function finishBefore(item, node, at, set) {
  for (const a of ancestors(item.route, node)) {
    if (!item.done[a]) { item.done[a] = at; set.push([item.id, a]) }
  }
}

/** Mark a dish done at `node` and, for a forced finish, everywhere before it. */
function finish(item, node, at, set, force) {
  if (force) finishBefore(item, node, at, set)
  if (!item.done[node]) { item.done[node] = at; set.push([item.id, node]) }
}

/** A dish sent back to `node` (undone, recalled) isn't ticked off after it any more. */
function untickAfter(item, node) {
  const after = item.checked ? descendants(item.route, node).filter(n => item.checked[n]) : []
  if (!after.length) return
  const checked = { ...item.checked }
  for (const n of after) delete checked[n]
  item.checked = checked
}

/**
 * The dishes a station's bump finishes: those it has now, and at the pass or
 * a runner showing dishes before they arrive, those still on their way.
 */
function bumpable(o, station, st, cfg, at) {
  const early = isOrderLevel(station) && st.show_upcoming
  return liveItems(o).filter(i => {
    if (!i.route?.[station.id]) return false
    const s = nodeState(i, station.id, cfg, at)
    return s === 'active' || (early && s === 'upcoming')
  })
}

/**
 * A station's bump (BUMP / READY / DONE, or the last dish ticked off): its
 * dishes done there (the pass's and a runner's dishes still on their way done
 * everywhere before it too), its voids seen, and a bump record. Returns null,
 * or a refusal when there is nothing to bump.
 */
function bumpStation(o, station, st, cfg, at, e, log, extra = {}) {
  const mine = liveItems(o).filter(i => i.route?.[station.id])
  const active = mine.filter(i => nodeState(i, station.id, cfg, at) === 'active')
  const upcoming = isOrderLevel(station) && st.show_upcoming
    ? mine.filter(i => nodeState(i, station.id, cfg, at) === 'upcoming') : []
  const voids = voidsToSee(o, station, cfg)
  if (!active.length && !upcoming.length && !voids.length) {
    const coming = mine.filter(i => nodeState(i, station.id, cfg, at) === 'upcoming')
    if (coming.length) return fail('Still at ' + [...new Set(coming.flatMap(i => itemWhere(i, cfg, at)))].map(id => nameOf(cfg, id)).join(', '), 'upcoming')
    return fail('Nothing to bump at ' + station.name, 'nothing')
  }
  const set = []
  for (const i of active) finish(i, station.id, at, set, false)
  for (const i of upcoming) finish(i, station.id, at, set, true)
  for (const v of voids) v.void_seen = { ...(v.void_seen || {}), [station.id]: at }
  const bumped = [...active, ...upcoming]
  const rec = bumpRecord(e, station, at, set, bumped, cfg, { voids: voids.map(v => v.id), ...extra })
  o.bumps.push(rec)
  if (bumped.length) log.push({ kind: 'bump', station, at, seconds: rec.seconds, items: rec.items })
  return null
}

/**
 * Apply one kitchen event.
 *   orders  { [id]: kitchen order } with every order kitchenOrdersTouched(e) names that exists
 *   cfg     kitchen config (stations by id, flow, ...)
 * Returns { ok: true, orders: { [id]: order }, log: [...] } (only what changed;
 * the input is never changed), or { ok: false, error, code }.
 * log rows: { kind: 'bump' | 'remake' | 'recall', ... } for kds_log.
 */
export function applyKitchenEvent(orders, e, cfg = {}) {
  const shape = kitchenEventProblem(e)
  if (shape) return fail(shape, 'invalid')
  const at = eventTime(e)
  const p = e.payload || {}
  const log = []

  // Nothing changes but the time: the sequencer prints what has come due.
  if (e.type === 'kitchen.print_due') return { ok: true, orders: {}, log }

  if (e.type === 'kitchen.order_in') {
    const src = p.order
    if (orders[src.id]) return fail('This order is already in the kitchen', 'duplicate')
    const fireAt = src.fire_at && ms(src.fire_at) > ms(at) ? src.fire_at : null
    const o = newOrder({
      id: src.id, source: sourceOfId(src.id), order_id: src.order_id, number: src.number || '',
      counter: false, board: true, guest: src.guest || null, table: src.table || null,
      type: src.type || null, type_name: src.type_name || null,
      promised_at: src.promised_at || null, note: src.note || null, allergy: src.allergy || null,
    }, at)
    o.items = src.items.map(i => itemFromOnline(i, cfg, at, fireAt, src.type))
    // Splitters are decided as the order comes in, an order for later too.
    balanceTicket(o.items, cfg, at, o)
    refreshStatus(o, cfg, at, e.id)
    touch(o, at)
    return { ok: true, orders: { [o.id]: o }, log }
  }

  const current = orders[p.order_id]
  if (!current) return fail('That order isn\'t in the kitchen', 'missing')
  const o = clone(current)
  const station = p.station_id ? cfg.stations?.[p.station_id] : null
  if (p.station_id && !station) return fail('Kitchen station not found', 'station')
  if (station && station.kind === 'board') return fail('An order ready board has nothing to bump', 'station')
  if (station && station.kind === 'balance') return fail('A Splitter has nothing to bump', 'station')
  if (station && station.kind === 'sleeper') return fail('A Sleeper passes dishes on by itself: nothing to bump', 'station')
  if (station && station.kind === 'setter') return fail('A Setter only sets the order\'s status: nothing to bump', 'station')
  const st = station ? stationSettings(station) : null

  switch (e.type) {
    case 'kitchen.item_done': {
      if (!['active', 'ready'].includes(o.status)) return fail('This order is no longer in the kitchen', 'closed')
      const item = o.items.find(i => i.id === p.item_id)
      if (!item) return fail('Dish not found on this order', 'missing')
      if (item.voided_at) return fail('This dish was voided', 'voided')
      if (!isFired(item, at)) return fail('This dish hasn\'t been fired yet', 'held')
      if (!item.route?.[station.id]) return fail('This dish doesn\'t come to ' + station.name, 'station')
      const state = nodeState(item, station.id, cfg, at)
      if (p.done) {
        if (state === 'done') return fail('Already done', 'nothing')
        if (state === 'upcoming' && !(isOrderLevel(station) && st.show_upcoming)) {
          return fail('Still at ' + itemWhere(item, cfg, at).map(id => nameOf(cfg, id)).join(', '), 'upcoming')
        }
        const set = []
        finish(item, station.id, at, set, state === 'upcoming')
        // The last dish of a ticket done one by one counts as the bump.
        const left = o.items.filter(i => {
          const s = nodeState(i, station.id, cfg, at)
          return s === 'active' || (s === 'upcoming' && st.show_upcoming)
        })
        if (!left.length) {
          const inBump = id => o.bumps.some(b => b.station_id === station.id && !b.recalled_at && b.set.some(([x, n]) => x === id && n === station.id))
          const doneHere = o.items.filter(i => i.route?.[station.id] && i.done[station.id] && !i.voided_at && !inBump(i.id))
          const pairs = [...set.filter(([, n]) => n !== station.id), ...doneHere.map(i => [i.id, station.id])]
          const rec = bumpRecord(e, station, at, pairs, doneHere, cfg, { by_items: true })
          for (const v of voidsToSee(o, station, cfg)) v.void_seen = { ...(v.void_seen || {}), [station.id]: at }
          o.bumps.push(rec)
          log.push({ kind: 'bump', station, at, seconds: rec.seconds, items: rec.items })
        }
      } else {
        if (!item.done[station.id]) return fail('Not done yet', 'nothing')
        const onward = descendants(item.route, station.id).filter(n => item.done[n])
        if (onward.length) return fail('Already moved on to ' + onward.map(id => nameOf(cfg, id)).join(', '), 'moved_on')
        delete item.done[station.id]
        untickAfter(item, station.id)
        // Undoing a dish reopens the ticket: its last bump no longer counts.
        for (const b of o.bumps) {
          if (!b.recalled_at && b.station_id === station.id && b.set.some(([id, n]) => id === item.id && n === station.id)) {
            b.recalled_at = at
            log.push({ kind: 'recall', bump_event_id: b.id })
          }
        }
      }
      refreshStatus(o, cfg, at, e.id)
      break
    }

    case 'kitchen.item_checked': {
      if (!['active', 'ready'].includes(o.status)) return fail('This order is no longer in the kitchen', 'closed')
      if (!isOrderLevel(station)) return fail('Dishes are ticked off at the pass and runners: tap a dish here to mark it done', 'station')
      const item = o.items.find(i => i.id === p.item_id)
      if (!item) return fail('Dish not found on this order', 'missing')
      if (item.voided_at) return fail('This dish was voided', 'voided')
      if (!isFired(item, at)) return fail('This dish hasn\'t been fired yet', 'held')
      if (!item.route?.[station.id]) return fail('This dish doesn\'t come to ' + station.name, 'station')
      const state = nodeState(item, station.id, cfg, at)
      if (state === 'done') return fail('Already done here: Prev brings the ticket back', 'nothing')
      const was = !!item.checked?.[station.id]
      if (p.checked === was) return fail(p.checked ? 'Already ticked off' : 'Not ticked off', 'nothing')
      if (p.checked) {
        if (state === 'upcoming' && !st.show_upcoming) {
          return fail('Still at ' + itemWhere(item, cfg, at).map(id => nameOf(cfg, id)).join(', '), 'upcoming')
        }
        // In front of the pass now: done wherever it was still waiting.
        if (state === 'upcoming') finishBefore(item, station.id, at, [])
        item.checked = { ...(item.checked || {}), [station.id]: at }
        // Every dish ticked off: the ticket waits for READY, or with
        // bump_when_checked it is bumped now.
        const left = bumpable(o, station, st, cfg, at)
        if (st.bump_when_checked && left.length && left.every(i => i.checked?.[station.id])) {
          const why = bumpStation(o, station, st, cfg, at, e, log, { by_items: true })
          if (why) return why
        }
      } else {
        const checked = { ...item.checked }
        delete checked[station.id]
        item.checked = checked
      }
      refreshStatus(o, cfg, at, e.id)
      break
    }

    case 'kitchen.bumped': {
      if (!['active', 'ready'].includes(o.status)) return fail('This order is no longer in the kitchen', 'closed')
      const why = bumpStation(o, station, st, cfg, at, e, log)
      if (why) return why
      refreshStatus(o, cfg, at, e.id)
      break
    }

    case 'kitchen.recalled': {
      const last = [...o.bumps].reverse().find(b => b.station_id === station.id && !b.recalled_at)
      if (!last) return fail('Nothing to bring back at ' + station.name, 'nothing')
      const inSet = new Set(last.set.map(([id, n]) => id + '|' + n))
      const moved = new Set()
      for (const [itemId, node] of last.set) {
        const i = o.items.find(x => x.id === itemId)
        if (!i) continue
        const onward = descendants(i.route, node).filter(n => i.done[n] && !inSet.has(itemId + '|' + n))
        if (onward.length) moved.add(itemId)
      }
      const restore = last.set.filter(([id]) => !moved.has(id))
      if (!restore.length && last.set.length) {
        const i = o.items.find(x => x.id === last.set[0][0])
        const onward = i ? descendants(i.route, station.id).filter(n => i.done[n]) : []
        return fail('Already moved on to ' + (onward.map(id => nameOf(cfg, id)).join(', ') || 'the next station'), 'moved_on')
      }
      for (const [itemId, node] of restore) {
        const i = o.items.find(x => x.id === itemId)
        if (i) { delete i.done[node]; untickAfter(i, node) }
      }
      for (const id of last.voids || []) {
        const v = o.items.find(x => x.id === id)
        if (v?.void_seen) delete v.void_seen[station.id]
      }
      last.recalled_at = at
      refreshStatus(o, cfg, at, e.id)
      log.push({ kind: 'recall', bump_event_id: last.id })
      break
    }

    case 'kitchen.remake': {
      if (['cancelled', 'merged'].includes(o.status)) return fail('This order is no longer in the kitchen', 'closed')
      const item = o.items.find(i => i.id === p.item_id)
      if (!item) return fail('Dish not found on this order', 'missing')
      if (item.voided_at) return fail('This dish was voided', 'voided')
      if (!isFired(item, at)) return fail('This dish hasn\'t been fired yet', 'held')
      if (!item.route?.[station.id]) return fail('This dish doesn\'t come to ' + station.name, 'station')
      // A remade dish doesn't wait at a Sleeper it has already been through.
      const f = flowTimes(item, cfg, at)
      const slept = Object.keys(item.route).filter(n => isSleeper(cfg, n) && f.done(n))
      if (slept.length) item.slept = { ...(item.slept || {}), ...Object.fromEntries(slept.map(n => [n, at])) }
      if (isOrderLevel(station)) {
        // From the pass or a runner: made again from the start of its way.
        item.done = {}
        item.reset = {}
        item.since = at
      } else {
        for (const n of [station.id, ...descendants(item.route, station.id)]) delete item.done[n]
        item.reset = { ...(item.reset || {}), [station.id]: at }
      }
      // A dish made again is ticked off again at the pass.
      delete item.checked
      item.remakes = (item.remakes || 0) + 1
      item.remade_at = at
      o.changed_at = at
      refreshStatus(o, cfg, at, e.id)
      log.push({ kind: 'remake', station, at, item_name: item.name, reason: String(p.reason || '').trim() || null })
      break
    }

    case 'kitchen.priority':
      if (o.priority === p.on) return fail(p.on ? 'Already a priority' : 'Not a priority', 'nothing')
      o.priority = p.on
      break

    case 'kitchen.collected':
      if (o.status !== 'ready') return fail(o.status === 'collected' ? 'Already collected' : 'This order isn\'t ready yet', 'not_ready')
      o.status = 'collected'
      o.collected_at = at
      o.collected_event = e.id
      break

    case 'kitchen.order_status': {
      if (o.status === p.status) return fail('No change', 'nothing')
      const finishAll = () => {
        for (const i of o.items) if (!i.fired_at && !i.voided_at) { i.fired_at = at; i.since = i.since || at }
        for (const i of liveItems(o)) for (const n of Object.keys(i.route || {})) if (!i.done[n] && (!noBump(kindOf(cfg, n)) || isSleeper(cfg, n))) i.done[n] = at
      }
      if (p.status === 'cancelled') {
        o.status = 'cancelled'
        o.cancelled_at = at
        o.cancelled_by_server = true
      } else if (p.status === 'ready') {
        finishAll()
        o.status = 'ready'
        o.ready_at = at
        o.ready_event = e.id
      } else if (p.status === 'collected') {
        if (o.status !== 'ready') {
          finishAll()
          o.ready_at = o.ready_at || at
        }
        o.status = 'collected'
        o.collected_at = at
      }
      break
    }

    default:
      return fail('Not handled: ' + e.type, 'invalid')
  }
  touch(o, at)
  o.last_event_id = e.id
  return { ok: true, orders: { [o.id]: o }, log }
}

// ── What the screens show ──────────────────────────────────────

const isStale = (o, now) => o.created_at && ms(now) - ms(o.created_at) > STALE_HOURS * 3600_000
const minTime = list => {
  const t = list.filter(Boolean).map(ms).filter(Number.isFinite)
  return t.length ? new Date(Math.min(...t)).toISOString() : null
}

/**
 * Tickets for one station, oldest first (priority orders first).
 * A ticket = one kitchen order at this station:
 *   { order, items, since, held, voids, elsewhere }
 * items: the order's dishes that come to this station, each with
 *   state  'active' | 'upcoming' | 'done' | 'held' | 'voided'
 *   ticked ticked off here (the pass, a runner: the packing check)
 *   where  stations an upcoming dish is at now
 *   from   stations it came from (not Orders in)
 *   next   stations it goes on to
 *   parts  meal deal parts made here (prep) / all parts (pass, runner)
 * elsewhere (pass, runner): [{ station_id, count }] dishes of the order going
 * another way (e.g. to the other expo). ticked (pass, runner): how many of
 * the dishes its bump would finish are ticked off; all_ticked: all of them.
 * A ticket shows while the station has something to do: dishes here, or
 * (show_upcoming) dishes still at earlier stations, or a void to see.
 */
export function stationTickets(orders, station, now, cfg) {
  if (!station || noBump(station.kind)) return []
  const st = stationSettings(station)
  const orderLevel = isOrderLevel(station)
  const out = []
  for (const o of Object.values(orders || {})) {
    if (!['active', 'ready'].includes(o.status) || isStale(o, now)) continue
    const mine = o.items.filter(i => i.route?.[station.id])
    if (!mine.length) continue
    const voids = voidsToSee(o, station, cfg)
    const view = mine.map(i => {
      const state = nodeState(i, station.id, cfg, now)
      const entry = (i.route[station.id] || []).includes(START)
      return {
        ...i, state,
        entry,
        ticked: !!i.checked?.[station.id],
        where: state === 'upcoming' ? itemWhere(i, cfg, now).filter(id => !isSleeper(cfg, id)) : [],
        sleeps: state === 'upcoming' ? itemSleeps(i, cfg, now) : [],
        from: (i.route[station.id] || []).filter(x => x !== START),
        next: routeNext(i.route, station.id),
        parts: i.parts ? (orderLevel ? i.parts : i.parts.filter(pt => pt.route?.[station.id])) : null,
      }
    })
    const active = view.filter(i => i.state === 'active')
    const upcoming = view.filter(i => i.state === 'upcoming')
    if (!active.length && !voids.length && !(st.show_upcoming && upcoming.length)) continue
    const items = view.filter(i => {
      if (i.state === 'voided') return voids.some(v => v.id === i.id)
      if (i.state === 'upcoming') return st.show_upcoming
      if (i.state === 'held') return st.show_held && (i.entry || orderLevel)
      return true
    })
    // The pass times the whole order; other stations from when dishes reached
    // them. Dishes a Sleeper holds count from when they wake.
    const since = station.kind === 'expo'
      ? minTime(view.filter(i => ['active', 'upcoming', 'done'].includes(i.state)).map(i => workSince(i, cfg, now)))
      : minTime(active.map(i => flowTimes(i, cfg, now).arrived(station.id))) || minTime(upcoming.map(i => workSince(i, cfg, now)))
    // Nothing to do here yet but dishes still asleep: when the first wakes.
    const asleep = upcoming.filter(i => i.sleeps.length)
    const sleeping_until = !active.length && asleep.length && asleep.length === upcoming.length
      ? minTime(asleep.flatMap(i => i.sleeps.map(x => x.until))) : null
    let elsewhere = []
    if (orderLevel) {
      const counts = new Map()
      for (const i of liveItems(o)) {
        if (i.route?.[station.id] || !isFired(i, now) || !Object.keys(i.route || {}).length) continue
        const ends = Object.keys(i.route).filter(id => isOrderLevel(cfg?.stations?.[id]))
        const key = ends[0] || Object.keys(i.route)[0]
        counts.set(key, (counts.get(key) || 0) + (Number(i.qty) || 0))
      }
      elsewhere = [...counts.entries()].map(([station_id, count]) => ({ station_id, count }))
    }
    // The packing check: the dishes READY / DONE would finish, ticked off.
    const toBump = orderLevel ? view.filter(i => i.state === 'active' || (st.show_upcoming && i.state === 'upcoming')) : []
    const ticked = toBump.filter(i => i.ticked).length
    out.push({
      order: o, items,
      since: since || minTime(voids.map(v => v.voided_at)) || o.created_at,
      held: items.filter(i => i.state === 'held').length,
      voids: voids.length,
      upcoming: upcoming.length,
      sleeping_until,
      elsewhere,
      ticked,
      all_ticked: toBump.length > 0 && ticked === toBump.length,
    })
  }
  return out.sort((a, b) => (b.order.priority ? 1 : 0) - (a.order.priority ? 1 : 0) || ms(a.since) - ms(b.since))
}


/** Orders for later (online orders with a collection time): { order, fire_at } soonest first. */
export function laterOrders(orders, now) {
  return Object.values(orders || {})
    .filter(o => o.status === 'active' && !isStale(o, now))
    .map(o => {
      const waiting = o.items.filter(i => !i.voided_at && !i.fired_at && i.fire_at && ms(i.fire_at) > ms(now))
      return waiting.length && waiting.length === liveItems(o).length ? { order: o, fire_at: minTime(waiting.map(i => i.fire_at)) } : null
    })
    .filter(Boolean)
    .sort((a, b) => ms(a.fire_at) - ms(b.fire_at))
}

/** Recently bumped tickets at a station, newest first (to bring one back). */
export function recentBumps(orders, station, now, limit = 30) {
  const out = []
  for (const o of Object.values(orders || {})) {
    if (isStale(o, now) || o.status === 'merged') continue
    const b = [...(o.bumps || [])].reverse().find(x => x.station_id === station.id && !x.recalled_at)
    if (b) out.push({ order: o, bump: b })
  }
  return out.sort((a, b) => ms(b.bump.at) - ms(a.bump.at)).slice(0, limit)
}

/**
 * Orders ready to collect that a station sees: ready, with a dish that came
 * through this station (no station: every ready counter / online order).
 * Newest first.
 */
export function readyOrders(orders, station, now) {
  const list = Object.values(orders || {}).filter(o => o.status === 'ready' && !isStale(o, now))
  const out = station
    ? list.filter(o => o.items.some(i => !i.voided_at && i.route?.[station.id]))
    : list.filter(o => o.board)
  return out.sort((a, b) => ms(b.ready_at) - ms(a.ready_at))
}

/** Ticket colour by age: 'ok' | 'warn' | 'late'. */
export function ageTone(since, now, station) {
  const st = stationSettings(station)
  const mins = (ms(now) - ms(since)) / 60000
  if (!Number.isFinite(mins)) return 'ok'
  if (mins >= st.late_mins) return 'late'
  if (mins >= st.target_mins) return 'warn'
  return 'ok'
}

/** "4:05" style elapsed time. */
export function clockSince(since, now) {
  const s = Math.max(0, Math.floor((ms(now) - ms(since)) / 1000))
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  if (m >= 100) return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0')
  return m + ':' + String(s % 60).padStart(2, '0')
}

/**
 * What is on order at a station now (the On order screen and the SUM panel):
 * dishes and options this station still has to do (here or on their way),
 * counted. With summary groups (station settings) each group adds up its
 * members (dish or option, times `qty`, e.g. "8pc Boneless" counts 8 towards
 * Boneless); without, one row per dish. Returns [{ id, name, count }].
 */
export function onOrderCounts(orders, station, now, cfg) {
  const groups = stationSettings(station).summary_groups || []
  const todo = []
  for (const o of Object.values(orders || {})) {
    if (!['active', 'ready'].includes(o.status) || isStale(o, now)) continue
    for (const i of o.items) {
      const s = nodeState(i, station.id, cfg, now)
      if (s !== 'active' && s !== 'upcoming') continue
      const parts = i.parts ? (isOrderLevel(station) ? i.parts : i.parts.filter(pt => pt.route?.[station.id])) : null
      todo.push({ item: i, parts })
    }
  }
  if (!groups.length) {
    const byName = new Map()
    for (const { item, parts } of todo) {
      const names = parts && parts.length ? parts.map(pt => pt.name) : [item.name]
      for (const n of names) byName.set(n, (byName.get(n) || 0) + (Number(item.qty) || 0))
    }
    return [...byName.entries()].map(([name, count]) => ({ id: name, name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }
  return groups.map(g => {
    let count = 0
    for (const { item, parts } of todo) {
      const qty = Number(item.qty) || 0
      const units = parts && parts.length ? parts.map(pt => ({ item_id: pt.item_id, mods: pt.mods })) : [{ item_id: item.item_id, mods: item.mods }]
      if (parts && parts.length) units.push({ item_id: null, mods: item.mods })
      count += memberCount(units, g.members, qty)
    }
    return { id: g.id, name: g.name, count }
  })
}

/**
 * Speed figures for a station from the bumps on the orders this screen has:
 *   { done, avg_secs, moving_secs (last 10), on_time_pct }
 * `from` limits to bumps at or after that time (the start of the trading day).
 */
export function stationStats(orders, station, from = null) {
  const st = stationSettings(station)
  const bumps = []
  for (const o of Object.values(orders || {})) {
    for (const b of o.bumps || []) {
      if (b.station_id !== station.id || b.recalled_at || !b.items) continue
      if (from && ms(b.at) < ms(from)) continue
      bumps.push(b)
    }
  }
  bumps.sort((a, b) => ms(a.at) - ms(b.at))
  const avg = list => (list.length ? Math.round(list.reduce((s, b) => s + b.seconds, 0) / list.length) : null)
  const onTime = bumps.filter(b => b.seconds <= st.target_mins * 60).length
  return {
    done: bumps.length,
    avg_secs: avg(bumps),
    moving_secs: avg(bumps.slice(-10)),
    on_time_pct: bumps.length ? Math.round(onTime * 100 / bumps.length) : null,
  }
}

/** "4:05" from seconds (null: "-"). */
export function clockSecs(secs) {
  if (secs == null) return '-'
  const m = Math.floor(secs / 60)
  return m + ':' + String(secs % 60).padStart(2, '0')
}

/** An order on one board: { state: 'ready' | 'preparing', at } or null (not on it). */
export function boardState(o, boardId, cfg, now) {
  const items = liveItems(o).filter(i => i.route?.[boardId])
  if (!items.length) return null
  let readyAt = null
  for (const i of items) {
    const t = flowTimes(i, cfg, now).arrived(boardId)
    if (!t) return items.some(x => isFired(x, now)) ? { state: 'preparing', at: o.created_at } : null
    readyAt = later(readyAt, t)
  }
  return { state: 'ready', at: readyAt }
}

/**
 * The numbers for an order ready board.
 *   boardId null: every counter and online order (ready = the order is ready)
 *   boardId:      the orders with dishes on their way to that board (ready
 *                 once all of them have reached it)
 *   preparing  something fired, not ready yet (oldest first)
 *   ready      ready, not collected, ready less than clearMins ago (newest first)
 */
export function boardNumbers(orders, now, { clearMins = 10, max = 30, boardId = null, cfg = null } = {}) {
  const preparing = []
  const ready = []
  const fresh = t => !clearMins || ms(now) - ms(t) < clearMins * 60000
  for (const o of Object.values(orders || {})) {
    if (!o.number || isStale(o, now) || !['active', 'ready'].includes(o.status)) continue
    if (!boardId) {
      if (!o.board) continue
      if (o.status === 'active' && o.items.some(i => !i.voided_at && isFired(i, now))) preparing.push({ o, at: o.created_at })
      else if (o.status === 'ready' && fresh(o.ready_at)) ready.push({ o, at: o.ready_at })
      continue
    }
    const b = boardState(o, boardId, cfg, now)
    if (!b) continue
    if (b.state === 'preparing') preparing.push({ o, at: o.created_at })
    else if (fresh(b.at)) ready.push({ o, at: b.at })
  }
  preparing.sort((a, b) => ms(a.at) - ms(b.at))
  ready.sort((a, b) => ms(b.at) - ms(a.at))
  // What a tile can show (shared/orderInfo.js): the guest's first name online,
  // the name typed on a till or kiosk, the tent, table and order type.
  // The order's status from the Setters in the kitchen flow (needs cfg).
  const view = ({ o, at }) => {
    const status = cfg ? orderStatus(o, cfg, now) : null
    return {
      id: o.id, number: o.number, name: o.guest || o.tab || null, tent: o.tent || null, table: o.table || null,
      type_name: o.type_name || null, source: o.source, at,
      ...(status ? { status: { name: status.name, text: status.text, look: status.look, colour: status.colour, anim: status.anim, lamp: status.lamp } } : {}),
    }
  }
  return { preparing: preparing.slice(0, max).map(view), ready: ready.slice(0, max).map(view) }
}
