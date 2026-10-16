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
//
// A kitchen order is one order in the kitchen: a till check (id = check id)
// or an online order (id = 'web-<orders.id>'). Its items are the dishes sent
// to the kitchen; each item goes to zero or more prep stations (kds_routes:
// dish, else section, else revenue centre, else default) and is done at each
// one separately. The pass (expo station) sees every item and marks the
// order ready; with no expo station an order is ready once every station has
// done its part.
//
// Pure: no I/O, no clock. Times come from events (received_at, set by the
// sequencer, else client_at) or from the `now` the screen passes in.

import { routeFor } from './printing.js'
import { modifierText } from './pricing.js'
import { isId } from './ids.js'

export const KITCHEN_DEVICE_EVENTS = [
  'kitchen.item_done', 'kitchen.bumped', 'kitchen.recalled', 'kitchen.remake', 'kitchen.priority', 'kitchen.collected',
]
// Made by the server only (online orders), never accepted from a device.
export const KITCHEN_SERVER_EVENTS = ['kitchen.order_in', 'kitchen.order_status']
export const KITCHEN_EVENTS = [...KITCHEN_DEVICE_EVENTS, ...KITCHEN_SERVER_EVENTS]

// Till events that change what the kitchen shows.
export const KITCHEN_CHECK_EVENTS = [
  'lines.sent', 'course.fired', 'line.voided', 'lines.moved', 'check.merged',
  'check.table_moved', 'check.renamed', 'check.covers_set', 'check.server_changed', 'check.note_set',
]

export const ORDER_TYPES = ['eat_in', 'takeaway', 'collection', 'delivery']
export const TYPE_LABELS = { eat_in: 'Eat in', takeaway: 'Takeaway', collection: 'Collection', delivery: 'Delivery' }

export const STATION_DEFAULTS = { target_mins: 8, late_mins: 12, show_held: true, summary_groups: [] }

// Kitchen orders older than this drop off the screens even if nobody bumped
// them (a table left open overnight, a test order).
export const STALE_HOURS = 16

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isText = (v, max = 300) => typeof v === 'string' && v.length <= max
const optText = (v, max) => v == null || isText(v, max)
const isTime = v => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const ms = v => (v ? Date.parse(v) : NaN)

export const isOrderId = v => isId(v) || (typeof v === 'string' && /^web-[0-9a-f-]{36}$/i.test(v))
export const onlineOrderId = orderId => 'web-' + orderId

/** A station's settings with the defaults filled in. */
export function stationSettings(station) {
  return { ...STATION_DEFAULTS, ...(station?.settings || {}) }
}

// ── Shape checks ───────────────────────────────────────────────

function onlineOrderProblem(o) {
  if (!o || typeof o !== 'object') return 'order missing'
  if (!isOrderId(o.id) || !o.id.startsWith('web-')) return 'order.id'
  if (!isUuid(o.order_id)) return 'order.order_id'
  if (!isText(o.number || '', 20)) return 'order.number'
  if (!optText(o.guest, 80)) return 'order.guest'
  if (!ORDER_TYPES.includes(o.type)) return 'order.type'
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
    if (i.options != null && !(Array.isArray(i.options) && i.options.every(x => x && isText(x.label || '', 120)))) return 'item.options'
    if (!optText(i.note, 300)) return 'item.note'
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

// ── Building orders and items ──────────────────────────────────

const eventTime = e => e.received_at || e.client_at || null

/** Prep station ids for a dish (routing), active prep stations only. */
export function prepStations(target, cfg) {
  const ids = routeFor(target, cfg.routes || [], 'station_id')
  return ids.filter(id => cfg.stations?.[id] && cfg.stations[id].kind !== 'expo')
}

function kitchenMods(mods = []) {
  return (mods || []).map(m => ({
    text: modifierText(m),
    label: m.label || '',
    kind: m.prefix === 'no' ? 'remove' : m.base ? 'base' : 'add',
    depth: m.depth || 0,
  }))
}

function headerFromCheck(check, cfg) {
  const rc = cfg.revenue_centres?.[check.revenue_centre_id]
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
    type: rc?.vat_mode === 'takeaway' ? 'takeaway' : 'eat_in',
    note: check.note || null,
  }
}

function newOrder(fields, at) {
  return {
    id: null, source: 'till', check_id: null, order_id: null,
    number: '', counter: false, board: false, table: null, tab: null, guest: null,
    covers: null, server: null, type: 'eat_in', promised_at: null, note: null, allergy: null,
    priority: false, status: 'active',
    created_at: at, ready_at: null, ready_event: null, collected_at: null, cancelled_at: null, merged_into: null,
    items: [], bumps: [], changed_at: null, events: 0, updated_at: at,
    ...fields,
  }
}

function itemFromLine(line, check, cfg, at, held) {
  const rc = line.revenue_centre_id ?? check.revenue_centre_id
  let parts = null
  let stations
  if (line.combo && line.combo.length) {
    parts = line.combo.map(p => ({
      item_id: p.item_id || null, name: p.kitchen_name || p.name, mods: kitchenMods(p.modifiers),
      stations: prepStations({ item_id: p.item_id, section_id: p.section_id, revenue_centre_id: rc }, cfg),
    }))
    stations = [...new Set(parts.flatMap(p => p.stations))]
  } else {
    stations = prepStations({ item_id: line.item_id, section_id: line.section_id, revenue_centre_id: rc }, cfg)
  }
  const course = line.course_id ? cfg.courses?.[line.course_id] : null
  return {
    id: line.id, item_id: line.item_id || null, name: line.kitchen_name || line.name, qty: line.qty,
    mods: kitchenMods(line.modifiers), parts,
    note: line.note || null, allergies: line.allergies || [], seat: line.seat ?? null,
    course_id: line.course_id || null, course: course?.name || null, course_sort: course?.sort_order ?? null,
    stations,
    sent_at: at, fired_at: held ? null : at, fire_at: null, since: held ? null : at,
    done: {}, voided_at: null, void_reason: null, void_seen: {}, remakes: 0, added: false,
  }
}

function itemFromOnline(i, cfg, at, fireAt) {
  return {
    id: String(i.id), item_id: i.item_id || null, name: i.name, qty: i.qty,
    mods: (i.options || []).map(o => ({ text: o.label, label: o.label, kind: o.mode === 'base' ? 'base' : 'add', depth: 0 })),
    parts: null, note: i.note || null, allergies: [], seat: null,
    course_id: null, course: null, course_sort: null,
    stations: prepStations({ item_id: i.item_id, section_id: i.section_id, revenue_centre_id: null }, cfg),
    sent_at: at, fired_at: fireAt ? null : at, fire_at: fireAt || null, since: fireAt ? null : at,
    done: {}, voided_at: null, void_reason: null, void_seen: {}, remakes: 0, added: false,
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
 * An item's state at one station:
 *   'voided' | 'held' (course not fired / order for later) | 'done' | 'active'
 * At the pass (expo) 'done' means done at every prep station it goes to.
 */
export function itemState(item, station, at) {
  if (item.voided_at) return 'voided'
  if (!isFired(item, at)) return 'held'
  if (station?.kind === 'expo') return item.stations.every(s => item.done[s]) ? 'done' : 'active'
  return item.done[station?.id] ? 'done' : 'active'
}

const liveItems = o => o.items.filter(i => !i.voided_at)

/** Work still to do in the kitchen (fired, not voided, not done at a station). */
function pendingWork(o, at) {
  return liveItems(o).some(i => isFired(i, at) && i.stations.some(s => !i.done[s]))
}

function touch(o, at) {
  o.events = (o.events || 0) + 1
  o.updated_at = at || o.updated_at
}

/**
 * Keep the order's status in step with its items.
 *   - everything voided: cancelled
 *   - new work after ready / collected: active again
 *   - no pass (expo) station: ready once nothing is left to do
 */
function refreshStatus(o, cfg, at, eventId) {
  if (o.status === 'merged') return
  const live = liveItems(o)
  if (!live.length) {
    if (o.items.length && o.status !== 'cancelled') { o.status = 'cancelled'; o.cancelled_at = at }
    return
  }
  if (o.status === 'cancelled' && !o.cancelled_by_server) { o.status = 'active'; o.cancelled_at = null }
  const pending = pendingWork(o, at)
  if (pending && o.status !== 'active' && o.status !== 'cancelled') {
    o.status = 'active'
    o.ready_at = null
    o.ready_event = null
    o.collected_at = null
    return
  }
  if (!cfg.expo && !pending && o.status === 'active' && live.some(i => isFired(i, at))) {
    o.status = 'ready'
    o.ready_at = at
    o.ready_event = eventId || null
  }
}

// ── Till events ────────────────────────────────────────────────

/**
 * Kitchen orders a sequenced till event changes.
 *   e       the event (with received_at)
 *   before  { [checkId]: check } before the event
 *   after   { [checkId]: check } the checks it changed
 *   orders  { [id]: kitchen order } the ones kitchenOrdersForCheckEvent(e) names that exist
 *   cfg     kitchen config: { enabled, stations, routes, expo, courses, tables, staff, revenue_centres }
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
    for (const k of ['number', 'counter', 'board', 'table', 'tab', 'covers', 'server', 'type', 'note']) o[k] = h[k]
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
      for (const l of lines) {
        if (o.items.some(i => i.id === l.id)) continue
        const item = itemFromLine(l, check, cfg, at, l.held)
        item.added = hadItems
        o.items.push(item)
      }
      if (hadItems) o.changed_at = at
      refreshStatus(o, cfg, at, e.id)
      touch(o, at)
      break
    }

    case 'course.fired': {
      const o = get(e.check_id)
      if (!o) return {}
      let fired = 0
      for (const i of o.items) {
        if (i.course_id === p.course_id && !i.fired_at && !i.voided_at) {
          i.fired_at = at
          i.since = at
          fired++
        }
      }
      if (!fired) return {}
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

function liveAt(o, station, at) {
  return o.items.filter(i => i.stations.includes(station.id) && itemState(i, station, at) === 'active')
}
function voidsToSee(o, station) {
  return o.items.filter(i => i.voided_at && i.stations.includes(station.id) && !i.done[station.id] && !i.void_seen?.[station.id])
}

function qtyOf(items) {
  return items.reduce((s, i) => s + (Number(i.qty) || 0), 0)
}

function bumpRecord(e, station, at, set, items, extra = {}) {
  const started = items.map(liveSince).filter(Boolean).map(ms).filter(Number.isFinite)
  const startedAt = started.length ? new Date(Math.min(...started)).toISOString() : at
  return {
    id: e.id, station_id: station.id, kind: station.kind, at, set,
    started_at: startedAt,
    seconds: Math.max(0, Math.round((ms(at) - ms(startedAt)) / 1000)),
    items: qtyOf(items), recalled_at: null, ...extra,
  }
}

/**
 * Apply one kitchen event.
 *   orders  { [id]: kitchen order } with every order kitchenOrdersTouched(e) names that exists
 *   cfg     kitchen config (stations by id, expo, routes, ...)
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
      id: src.id, source: 'online', order_id: src.order_id, number: src.number || '',
      counter: false, board: true, guest: src.guest || null, type: src.type,
      promised_at: src.promised_at || null, note: src.note || null, allergy: src.allergy || null,
    }, at)
    o.items = src.items.map(i => itemFromOnline(i, cfg, at, fireAt))
    refreshStatus(o, cfg, at, e.id)
    touch(o, at)
    return { ok: true, orders: { [o.id]: o }, log }
  }

  const current = orders[p.order_id]
  if (!current) return fail('That order isn\'t in the kitchen', 'missing')
  const o = clone(current)
  const station = p.station_id ? cfg.stations?.[p.station_id] : null
  if (p.station_id && !station) return fail('Kitchen station not found', 'station')

  switch (e.type) {
    case 'kitchen.item_done': {
      if (!['active', 'ready'].includes(o.status)) return fail('This order is no longer in the kitchen', 'closed')
      const item = o.items.find(i => i.id === p.item_id)
      if (!item) return fail('Dish not found on this order', 'missing')
      if (item.voided_at) return fail('This dish was voided', 'voided')
      if (!isFired(item, at)) return fail('This dish hasn\'t been fired yet', 'held')
      const targets = station.kind === 'expo' ? item.stations : [station.id]
      if (station.kind !== 'expo' && !item.stations.includes(station.id)) return fail('This dish isn\'t made here', 'station')
      if (p.done) {
        const set = []
        for (const s of targets) if (!item.done[s]) { item.done[s] = at; set.push([item.id, s]) }
        if (!set.length && station.kind !== 'expo') return fail('Already done', 'nothing')
        // The last dish of a ticket done one by one counts as the bump.
        if (station.kind !== 'expo' && set.length && !liveAt(o, station, at).length) {
          const doneHere = o.items.filter(i => i.stations.includes(station.id) && i.done[station.id] && !i.voided_at
            && !o.bumps.some(b => b.station_id === station.id && !b.recalled_at && b.set.some(([id]) => id === i.id)))
          const rec = bumpRecord(e, station, at, doneHere.map(i => [i.id, station.id]), doneHere, { by_items: true })
          for (const v of voidsToSee(o, station)) v.void_seen = { ...(v.void_seen || {}), [station.id]: at }
          o.bumps.push(rec)
          log.push({ kind: 'bump', station, at, seconds: rec.seconds, items: rec.items })
        }
      } else {
        let undone = 0
        for (const s of targets) if (item.done[s]) { delete item.done[s]; undone++ }
        if (!undone) return fail('Not done yet', 'nothing')
        // Undoing a dish reopens the ticket: its last bump no longer counts.
        for (const b of o.bumps) {
          if (!b.recalled_at && targets.includes(b.station_id) && b.set.some(([id]) => id === item.id)) {
            b.recalled_at = at
            log.push({ kind: 'recall', bump_event_id: b.id })
          }
        }
      }
      refreshStatus(o, cfg, at, e.id)
      break
    }

    case 'kitchen.bumped': {
      if (station.kind === 'expo') {
        if (o.status !== 'active') return fail(o.status === 'ready' ? 'Already ready' : 'This order is no longer in the kitchen', 'closed')
        const fired = liveItems(o).filter(i => isFired(i, at))
        if (!fired.length) return fail('Nothing has been fired for this order yet', 'held')
        const set = []
        for (const i of fired) for (const s of i.stations) if (!i.done[s]) { i.done[s] = at; set.push([i.id, s]) }
        const fromAt = o.bumps.filter(b => b.kind === 'expo' && !b.recalled_at).map(b => ms(b.at))
        const since = fromAt.length ? Math.max(...fromAt) : 0
        const roundItems = fired.filter(i => ms(liveSince(i)) >= since)
        const rec = bumpRecord(e, station, at, set, roundItems.length ? roundItems : fired)
        o.bumps.push(rec)
        o.status = 'ready'
        o.ready_at = at
        o.ready_event = e.id
        log.push({ kind: 'bump', station, at, seconds: rec.seconds, items: rec.items })
        break
      }
      const todo = liveAt(o, station, at)
      const voids = voidsToSee(o, station)
      if (!todo.length && !voids.length) return fail('Nothing to bump at ' + station.name, 'nothing')
      for (const i of todo) i.done[station.id] = at
      for (const v of voids) v.void_seen = { ...(v.void_seen || {}), [station.id]: at }
      const rec = bumpRecord(e, station, at, todo.map(i => [i.id, station.id]), todo, { voids: voids.map(v => v.id) })
      o.bumps.push(rec)
      if (todo.length) log.push({ kind: 'bump', station, at, seconds: rec.seconds, items: rec.items })
      refreshStatus(o, cfg, at, e.id)
      break
    }

    case 'kitchen.recalled': {
      const last = [...o.bumps].reverse().find(b => b.station_id === station.id && !b.recalled_at)
      if (!last) return fail('Nothing to bring back at ' + station.name, 'nothing')
      for (const [itemId, s] of last.set) {
        const i = o.items.find(x => x.id === itemId)
        if (i) delete i.done[s]
      }
      for (const id of last.voids || []) {
        const v = o.items.find(x => x.id === id)
        if (v?.void_seen) delete v.void_seen[station.id]
      }
      last.recalled_at = at
      if (station.kind === 'expo' && ['ready', 'collected'].includes(o.status)) {
        o.status = 'active'
        o.ready_at = null
        o.ready_event = null
        o.collected_at = null
      }
      if (['ready', 'collected'].includes(o.status) && pendingWork(o, at)) refreshStatus(o, cfg, at, e.id)
      log.push({ kind: 'recall', bump_event_id: last.id })
      break
    }

    case 'kitchen.remake': {
      if (['cancelled', 'merged'].includes(o.status)) return fail('This order is no longer in the kitchen', 'closed')
      const item = o.items.find(i => i.id === p.item_id)
      if (!item) return fail('Dish not found on this order', 'missing')
      if (item.voided_at) return fail('This dish was voided', 'voided')
      if (!isFired(item, at)) return fail('This dish hasn\'t been fired yet', 'held')
      const targets = station.kind === 'expo' ? item.stations : [station.id]
      for (const s of targets) delete item.done[s]
      item.remakes = (item.remakes || 0) + 1
      item.since = at
      item.remade_at = at
      if (o.status !== 'active') {
        o.status = 'active'
        o.ready_at = null
        o.ready_event = null
        o.collected_at = null
      }
      o.changed_at = at
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
      if (p.status === 'cancelled') {
        o.status = 'cancelled'
        o.cancelled_at = at
        o.cancelled_by_server = true
      } else if (p.status === 'ready') {
        for (const i of liveItems(o)) for (const s of i.stations) if (!i.done[s]) i.done[s] = at
        for (const i of o.items) if (!i.fired_at && !i.voided_at) { i.fired_at = at; i.since = i.since || at }
        o.status = 'ready'
        o.ready_at = at
        o.ready_event = e.id
      } else if (p.status === 'collected') {
        if (o.status !== 'ready') {
          for (const i of liveItems(o)) for (const s of i.stations) if (!i.done[s]) i.done[s] = at
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
  const t = list.map(ms).filter(Number.isFinite)
  return t.length ? new Date(Math.min(...t)).toISOString() : null
}

/**
 * Tickets for one station, oldest first (priority orders first).
 * A ticket = one kitchen order at this station:
 *   { order, items: [{ ...item, state, parts (only this station's) }], since, held, voids }
 * Prep: shown while it has something to make (or a void to see).
 * Expo: shown while the order is active and something has been fired.
 */
export function stationTickets(orders, station, now) {
  const list = Object.values(orders || {})
  const st = stationSettings(station)
  const out = []
  for (const o of list) {
    if (o.status !== 'active' || isStale(o, now)) continue
    if (station.kind === 'expo') {
      const fired = o.items.filter(i => !i.voided_at && isFired(i, now))
      if (!fired.length) continue
      const items = o.items
        .map(i => ({ ...i, state: itemState(i, station, now) }))
        .filter(i => st.show_held || i.state !== 'held')
      out.push({ order: o, items, since: minTime(fired.map(liveSince)), held: items.filter(i => i.state === 'held').length })
      continue
    }
    const mine = o.items.filter(i => i.stations.includes(station.id))
    const active = mine.filter(i => itemState(i, station, now) === 'active')
    const voids = voidsToSee(o, station)
    if (!active.length && !voids.length) continue
    const items = mine
      .map(i => ({ ...i, state: itemState(i, station, now), parts: i.parts ? i.parts.filter(pt => pt.stations.includes(station.id)) : null }))
      .filter(i => i.state !== 'voided' || voids.some(v => v.id === i.id))
      .filter(i => st.show_held || i.state !== 'held')
    out.push({ order: o, items, since: minTime(active.map(liveSince)) || minTime(voids.map(v => v.voided_at)), held: items.filter(i => i.state === 'held').length, voids: voids.length })
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
 * dishes and options still to make, counted. With summary groups (station
 * settings) each group adds up its members (dish or option, times `qty`,
 * e.g. "8pc Boneless" counts 8 towards Boneless); without, one row per dish.
 * Returns [{ id, name, count }].
 */
export function onOrderCounts(orders, station, now) {
  const groups = stationSettings(station).summary_groups || []
  const todo = []
  for (const o of Object.values(orders || {})) {
    if (o.status !== 'active' || isStale(o, now)) continue
    for (const i of o.items) {
      if (station.kind !== 'expo' && !i.stations.includes(station.id)) continue
      if (itemState(i, station, now) !== 'active') continue
      const parts = i.parts ? (station.kind === 'expo' ? i.parts : i.parts.filter(pt => pt.stations.includes(station.id))) : null
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
  const lower = s => String(s || '').trim().toLowerCase()
  return groups.map(g => {
    let count = 0
    for (const { item, parts } of todo) {
      const qty = Number(item.qty) || 0
      const units = parts && parts.length ? parts.map(pt => ({ item_id: pt.item_id, mods: pt.mods })) : [{ item_id: item.item_id, mods: item.mods }]
      if (parts && parts.length) units.push({ item_id: null, mods: item.mods })
      for (const u of units) {
        for (const m of g.members || []) {
          const per = Number(m.qty) || 1
          if (m.kind === 'dish' && m.id && u.item_id === m.id) count += per * qty
          if (m.kind === 'option' && m.label) {
            for (const mod of u.mods || []) if (mod.kind !== 'remove' && lower(mod.label) === lower(m.label)) count += per * qty
          }
        }
      }
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

/**
 * The numbers for an order-ready board: counter and online orders.
 *   preparing  something fired, not ready yet (oldest first)
 *   ready      ready, not collected, ready less than clearMins ago (newest first)
 */
export function boardNumbers(orders, now, { clearMins = 10, max = 30 } = {}) {
  const preparing = []
  const ready = []
  for (const o of Object.values(orders || {})) {
    if (!o.board || !o.number || isStale(o, now)) continue
    if (o.status === 'active' && o.items.some(i => !i.voided_at && isFired(i, now))) preparing.push(o)
    else if (o.status === 'ready' && (!clearMins || ms(now) - ms(o.ready_at) < clearMins * 60000)) ready.push(o)
  }
  preparing.sort((a, b) => ms(a.created_at) - ms(b.created_at))
  ready.sort((a, b) => ms(b.ready_at) - ms(a.ready_at))
  const view = o => ({ id: o.id, number: o.number, name: o.guest || null, source: o.source, at: o.ready_at || o.created_at })
  return { preparing: preparing.slice(0, max).map(view), ready: ready.slice(0, max).map(view) }
}
