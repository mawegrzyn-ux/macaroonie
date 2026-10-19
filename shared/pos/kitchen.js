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
// The kitchen is a flow (Till setup > Kitchen screens > Kitchen flow):
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
// A Balance box (station kind 'balance', migration 183) shares work between
// the stations it links to: each ticket's dishes that reach it go on to just
// one of them, the one with the fewest pieces still to cook there (the box's
// pieces list, like On order counts: an 8pc dish counts 8, a "10 Wings"
// option 10), taking turns on a tie. A box can share big tickets instead
// (settings.split_above): when more than that many pieces of one ticket reach
// it, each dish line goes, biggest first, to whichever station has the fewest
// pieces counting what this ticket already put there. The choice is made when
// the dishes are sent (a held till course: when it's fired, balanceTicket())
// and the box then drops out of the dish's way, so nothing after that knows
// it was there. The sequencer passes the open kitchen orders and the box's
// last pick in cfg.balance; without them every station counts as empty.
//
// A dish reaches a station when every station before it on its way has done
// it, and is done there when that station bumps it. Expo and runner stations
// work on whole orders: their bump also finishes what is still at earlier
// stations (when the station shows dishes before they arrive). Order ready
// boards have nothing to bump: an order is ready on a board once every dish on
// its way to that board has reached it.
//
// Pure: no I/O, no clock. Times come from events (received_at, set by the
// sequencer, else client_at) or from the `now` the screen passes in.

import { modifierText, groupModifiers } from './pricing.js'
import { isId } from './ids.js'

export const KITCHEN_DEVICE_EVENTS = [
  'kitchen.item_done', 'kitchen.bumped', 'kitchen.recalled', 'kitchen.remake', 'kitchen.priority', 'kitchen.collected',
]
// Made by the server only (online and GloriaFood orders), never accepted from a device.
export const KITCHEN_SERVER_EVENTS = ['kitchen.order_in', 'kitchen.order_status']
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
// balance: a Balance box in the flow (shares tickets between the stations it
// links to; no screen, nothing to bump).
export const STATION_KINDS = ['prep', 'expo', 'runner', 'board', 'balance']
export const KIND_LABELS = { prep: 'Prep station', expo: 'Expo (pass)', runner: 'Runner', board: 'Order ready board', balance: 'Balance box' }
export const BUMP_KINDS = ['prep', 'expo', 'runner']
export const isBumpKind = kind => BUMP_KINDS.includes(kind)
// Nodes nobody bumps: done as soon as a dish reaches them.
const noBump = kind => kind === 'board' || kind === 'balance'
export const isOrderLevel = st => st?.kind === 'expo' || st?.kind === 'runner'

// Where an item comes from before its first station.
export const START = 'start'
// What a flow link's filter can name, most specific first.
export const FLOW_TARGET_KINDS = ['item', 'section', 'revenue_stream', 'order_type', 'default']
const RANK = { item: 0, section: 1, revenue_stream: 2, order_type: 3, default: 4 }

export const STATION_DEFAULTS = { target_mins: 8, late_mins: 12, show_held: true, summary_groups: [], pieces: [], split_above: null }

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
  if (!isOrderId(p.order_id)) return bad('order_id')
  switch (e.type) {
    case 'kitchen.item_done':
      if (!isUuid(p.station_id)) return bad('station_id')
      if (!isText(p.item_id, 64) || !p.item_id) return bad('item_id')
      return typeof p.done === 'boolean' ? null : bad('done')
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
// cfg.flow      [{ id, from: stationId | null, to: stationId, targets: [{ kind, id }] }]
//               from null = Orders in; targets [] = everything

/** How specifically a link's filter matches a dish (lower = more), or Infinity. */
export function linkRank(link, target) {
  const list = link.targets && link.targets.length ? link.targets : [{ kind: 'default' }]
  let best = Infinity
  for (const x of list) {
    let hit = false
    switch (x.kind) {
      case 'default': hit = true; break
      case 'item': hit = !!target.item_id && x.id === target.item_id; break
      case 'section': hit = !!target.section_id && x.id === target.section_id; break
      case 'revenue_stream': hit = !!target.revenue_stream_id && x.id === target.revenue_stream_id; break
      case 'order_type': hit = !!target.order_type_id && x.id === target.order_type_id; break
      default: hit = false
    }
    if (hit && RANK[x.kind] < best) best = RANK[x.kind]
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
 *   target  { item_id, section_id, revenue_stream_id, order_type_id }
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

// ── Balance boxes ──────────────────────────────────────────────

const lower = s => String(s || '').trim().toLowerCase()

/** How many a list of dish / option members counts in some dishes (On order counts, Balance box pieces). */
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

/** The stations a Balance box shares between, in station order. */
export function balanceOutputs(boxId, cfg) {
  const order = Object.keys(cfg.stations || {})
  const outs = new Set((cfg.flow || []).filter(l => l.from === boxId && isBumpKind(cfg.stations?.[l.to]?.kind)).map(l => l.to))
  return order.filter(id => outs.has(id))
}

/**
 * Pieces still to cook at a station: every fired dish on its way there not
 * yet done (here or still on its way), counted with `members` (a dish counts
 * its quantity when no member names it; a meal deal counts its parts that go
 * there).
 */
export function stationLoad(orders, stationId, members, cfg, at) {
  let load = 0
  for (const o of Object.values(orders || {})) {
    if (!['active', 'ready'].includes(o.status) || isStale(o, at)) continue
    for (const i of o.items) {
      const s = nodeState(i, stationId, cfg, at)
      if (s !== 'active' && s !== 'upcoming') continue
      const qty = Number(i.qty) || 0
      const parts = i.parts ? i.parts.filter(pt => pt.route?.[stationId]) : null
      const units = parts && parts.length ? parts.map(pt => ({ item_id: pt.item_id, mods: pt.mods })) : [{ item_id: i.item_id, mods: i.mods }]
      if (parts && parts.length) units.push({ item_id: null, mods: i.mods })
      load += memberCount(units, members, qty) || qty * (parts && parts.length ? parts.length : 1)
    }
  }
  return load
}

/** The Balance boxes in a flow, upstream ones first. */
function flowBoxes(cfg) {
  const graph = {}
  for (const l of cfg.flow || []) {
    if (!cfg.stations?.[l.to] || (l.from && !cfg.stations?.[l.from])) continue
    const preds = graph[l.to] || (graph[l.to] = [])
    preds.push(l.from || START)
  }
  return routeOrder(graph).filter(id => cfg.stations?.[id]?.kind === 'balance')
}

/** The pieces one part of a ticket counts at a Balance box (a dish its quantity when no piece names it). */
function unitPieces(u, members) {
  const qty = Number(u.item.qty) || 0
  const units = [u.part ? { item_id: u.part.item_id, mods: u.part.mods } : { item_id: u.item.item_id, mods: u.item.mods }]
  // A meal deal's own options count with its first part that reaches the box.
  if (u.part && u.first) units.push({ item_id: null, mods: u.item.mods })
  return memberCount(units, members, qty) || qty
}

/**
 * Decides every Balance box on a ticket's dishes (the dishes sent or fired
 * together; held ones are left for course.fired), changing their ways in
 * place. Each box sends what reaches it to the station with the fewest pieces
 * still to cook (stationLoad over cfg.balance.open), a tie going to the first
 * after the box's last pick (cfg.balance.last), so they take turns. The whole
 * ticket goes to one station unless the box shares big tickets
 * (settings.split_above = N) and more than N pieces reach it: then each dish
 * line (or meal deal part) goes, biggest first, to the station with the fewest
 * pieces counting what this ticket has already put there. One line is never
 * split. Records each box's last pick in cfg.balance.picks for the caller to
 * keep.
 */
export function balanceTicket(items, cfg, at) {
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
    // Lowest load, a tie to the first station after the last pick.
    const next = () => {
      const low = Math.min(...loads)
      const ring = [...outs.slice(last + 1), ...outs.slice(0, last + 1)]
      const to = ring.find(id => loads[outs.indexOf(id)] === low)
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
    const share = outs.length > 1 && settings.split_above != null && total > Number(settings.split_above)
    if (!share) {
      const to = next()
      for (const u of here) u.route = collapseBalance(u.route, box, to)
    } else {
      // Biggest first; a dish's parts keep their order among equals.
      const order = here.map((u, i) => [u, i]).sort((x, y) => y[0].pieces - x[0].pieces || x[1] - y[1]).map(([u]) => u)
      for (const u of order) {
        const to = next()
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

/** A dish's way with a Balance box taken out: its dishes go on to `to` only. */
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

/** Does this way still go through a Balance box (a held course not fired yet)? */
export function routeHasBalance(route, cfg) {
  return Object.keys(route || {}).some(id => cfg.stations?.[id]?.kind === 'balance')
}

/** A dish's way with every Balance box on it decided (`pick(boxId)` -> station id | null). */
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
    if (s.kind !== 'balance') continue
    const outs = new Set((links || []).filter(l => l.from === s.id).map(l => l.to))
    if (outs.size < 2) out.push(s.name + (outs.size ? ' has only one station to share with: link it to another.' : ' shares with no stations yet: link it to two or more.'))
  }
  return out
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

function itemFromLine(line, check, cfg, at, held, type) {
  const rs = line.revenue_stream_id ?? check.revenue_stream_id
  // Balance boxes stay on the way until balanceTicket() decides them.
  const way = target => itemRoute(target, cfg)
  let parts = null
  let route
  if (line.combo && line.combo.length) {
    // Each pick goes where that dish goes; a typed-in choice (no dish)
    // goes where the combo itself goes.
    parts = line.combo.map(p => ({
      item_id: p.item_id || null, name: p.kitchen_name || p.name, mods: kitchenMods(p.modifiers),
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
    id: line.id, item_id: line.item_id || null, name: line.kitchen_name || line.name, qty: line.qty,
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
    item_id: p.item_id || null, name: p.kitchen_name || p.name, mods: onlineMods(p.options),
    route: way(p.item_id ? { item_id: p.item_id, section_id: p.section_id || null, revenue_stream_id: rs, order_type_id: type } : own),
  })) : null
  return {
    id: String(i.id), item_id: i.item_id || null, name: i.name, qty: i.qty,
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
 *                longer in the flow is passed straight through
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
  const done = (id, n = 0) => {
    if (item.done?.[id]) return item.done[id]
    if (gone(id) || noBump(cfg?.stations?.[id]?.kind)) return arrived(id, n)
    return null
  }
  return { arrived: id => arrived(id), done: id => done(id) }
}

/**
 * An item's state at one node:
 *   'voided' | 'held' (course not fired / order for later) | 'upcoming'
 *   (still at an earlier station) | 'active' | 'done' | null (not on its way)
 */
export function nodeState(item, nodeId, cfg, at) {
  if (!item.route?.[nodeId]) return null
  if (item.voided_at) return 'voided'
  if (!isFired(item, at)) return 'held'
  const f = flowTimes(item, cfg, at)
  if (item.done?.[nodeId]) return 'done'
  if (f.arrived(nodeId)) return noBump(cfg?.stations?.[nodeId]?.kind) ? 'done' : 'active'
  return 'upcoming'
}

/** An item's state at a station (nodeState for that station). */
export function itemState(item, station, at, cfg) {
  return nodeState(item, station?.id, cfg, at)
}

/** The stations a dish is waiting at now (reached, not done; boards left out). */
export function itemWhere(item, cfg, at) {
  if (item.voided_at || !isFired(item, at)) return []
  const f = flowTimes(item, cfg, at)
  return Object.keys(item.route || {}).filter(id =>
    cfg?.stations?.[id] && !noBump(cfg.stations[id].kind) && f.arrived(id) && !f.done(id))
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
        const item = itemFromLine(l, check, cfg, at, l.held, o.type)
        item.added = hadItems
        o.items.push(item)
        sent.push(item)
      }
      // Balance boxes for what goes now; a held course keeps its boxes until it's fired.
      balanceTicket(sent.filter(i => i.fired_at), cfg, at)
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
      // Balance boxes on the course's way are decided now, with the kitchen as it is.
      balanceTicket(fired, cfg, at)
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
    if (station.kind === 'expo') return liveSince(i)
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

/** Mark a dish done at `node` and, for a forced finish, everywhere before it. */
function finish(item, node, at, set, force) {
  if (force) {
    for (const a of ancestors(item.route, node)) {
      if (!item.done[a]) { item.done[a] = at; set.push([item.id, a]) }
    }
  }
  if (!item.done[node]) { item.done[node] = at; set.push([item.id, node]) }
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
    // Balance boxes are decided as the order comes in, an order for later too.
    balanceTicket(o.items, cfg, at)
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
  if (station && station.kind === 'balance') return fail('A Balance box has nothing to bump', 'station')
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

    case 'kitchen.bumped': {
      if (!['active', 'ready'].includes(o.status)) return fail('This order is no longer in the kitchen', 'closed')
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
      const rec = bumpRecord(e, station, at, set, bumped, cfg, { voids: voids.map(v => v.id) })
      o.bumps.push(rec)
      if (bumped.length) log.push({ kind: 'bump', station, at, seconds: rec.seconds, items: rec.items })
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
        if (i) delete i.done[node]
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
      if (isOrderLevel(station)) {
        // From the pass or a runner: made again from the start of its way.
        item.done = {}
        item.reset = {}
        item.since = at
      } else {
        for (const n of [station.id, ...descendants(item.route, station.id)]) delete item.done[n]
        item.reset = { ...(item.reset || {}), [station.id]: at }
      }
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
        for (const i of liveItems(o)) for (const n of Object.keys(i.route || {})) if (!i.done[n] && !noBump(kindOf(cfg, n))) i.done[n] = at
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
 *   where  stations an upcoming dish is at now
 *   from   stations it came from (not Orders in)
 *   next   stations it goes on to
 *   parts  meal deal parts made here (prep) / all parts (pass, runner)
 * elsewhere (pass, runner): [{ station_id, count }] dishes of the order going
 * another way (e.g. to the other expo).
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
        where: state === 'upcoming' ? itemWhere(i, cfg, now) : [],
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
    // The pass times the whole order; other stations from when dishes reached them.
    const since = station.kind === 'expo'
      ? minTime(view.filter(i => ['active', 'upcoming', 'done'].includes(i.state)).map(liveSince))
      : minTime(active.map(i => flowTimes(i, cfg, now).arrived(station.id))) || minTime(upcoming.map(liveSince))
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
    out.push({
      order: o, items,
      since: since || minTime(voids.map(v => v.voided_at)) || o.created_at,
      held: items.filter(i => i.state === 'held').length,
      voids: voids.length,
      upcoming: upcoming.length,
      elsewhere,
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
  const view = ({ o, at }) => ({
    id: o.id, number: o.number, name: o.guest || o.tab || null, tent: o.tent || null, table: o.table || null,
    type_name: o.type_name || null, source: o.source, at,
  })
  return { preparing: preparing.slice(0, max).map(view), ready: ready.slice(0, max).map(view) }
}
