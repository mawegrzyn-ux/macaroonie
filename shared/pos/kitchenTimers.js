// shared/pos/kitchenTimers.js
//
// Kitchen flow timers (22 Nov 2026, OUTSTANDING 44.9): a timer measures how
// long dishes take between two points of a kitchen flow, drawn in the flow
// designer as a dotted arrow. It starts when an order is sent (Orders in),
// or when a dish reaches or is done at a box, and ends when a dish is tapped
// done at a box someone taps (prep, expo or runner): "ends only on a tap".
// Per dish, every dish is one result; per ticket, one result per order: from
// its first dish to start to its last dish to end.
//
// Timers are kept on the flow (kds_flows.timers, migration 265) and worked
// out after the fact from the kitchen orders kept in kds_orders, so nothing
// changes on the tills, kitchen screens or the venue hub. A venue's own flow
// names its stations; a shared flow its boxes, matched by name at each
// location (resolveTimers()). One implementation for the designer, the API,
// the kitchen report and Pepper.
import { BUMP_KINDS, START, flowTimes } from './kitchen.js'

export const MAX_TIMERS = 20
export const TIMER_PER = ['dish', 'ticket']
export const TIMER_FROM_WHEN = ['reached', 'done']
export const DEFAULT_TIMER_TARGET = 10

const ms = v => (v ? Date.parse(v) : NaN)
const ID = /^[a-z0-9-]{1,40}$/i
const clampMins = v => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(240, Math.max(1, n)) : DEFAULT_TIMER_TARGET
}

/** A new timer's id. */
export const newTimerId = () => 'tm-' + Math.random().toString(36).slice(2, 10)

/**
 * The timers as saved: at most MAX_TIMERS, each { id, name, from, from_when,
 * to, per, target_mins }. from is START or a node id, to a node id. Timers
 * without both ends are dropped; ids are kept (or made) and unique.
 */
export function normaliseTimers(list) {
  const out = []
  const ids = new Set()
  for (const t of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_TIMERS) break
    if (!t || typeof t !== 'object' || !t.from || !t.to) continue
    let id = typeof t.id === 'string' && ID.test(t.id) ? t.id : newTimerId()
    while (ids.has(id)) id = newTimerId()
    ids.add(id)
    out.push({
      id,
      name: String(t.name || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      from: String(t.from),
      from_when: t.from === START ? 'reached' : (TIMER_FROM_WHEN.includes(t.from_when) ? t.from_when : 'reached'),
      to: String(t.to),
      per: TIMER_PER.includes(t.per) ? t.per : 'dish',
      target_mins: clampMins(t.target_mins),
    })
  }
  return out
}

/** Can a timer end at a node of this kind? Only where someone taps. */
export const canEndTimer = kind => BUMP_KINDS.includes(kind)

/**
 * A timer's words: "Orders in → Pass" with the boxes' names. names maps a node
 * id to its name (START reads "Orders in").
 */
export function timerLabel(t, names = {}) {
  const from = t.from === START ? 'Orders in' : (names[t.from] || 'a box that has gone')
  const to = names[t.to] || 'a box that has gone'
  return t.name || (from + ' to ' + to)
}

/**
 * What is wrong with a flow's timers (blocks saving): [message].
 *   nodes  { [id]: { name, kind } } the flow's boxes or stations in it
 * Saving with a timer at a box that has gone is wrong: the designer removes
 * a box's timers with the box.
 */
export function timerProblems(timers, nodes = {}) {
  const out = []
  for (const t of timers || []) {
    const label = timerLabel(t, Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, n.name])))
    if (t.from !== START && !nodes[t.from]) out.push('The timer "' + label + '" starts at a box that isn\'t in this flow.')
    if (!nodes[t.to]) { out.push('The timer "' + label + '" ends at a box that isn\'t in this flow.'); continue }
    if (!canEndTimer(nodes[t.to].kind)) out.push('The timer "' + label + '" must end at a box someone taps (a prep, expo or runner screen), not at ' + nodes[t.to].name + '.')
    if (t.from === t.to) out.push('The timer "' + label + '" starts and ends at the same box: the station\'s own times are in the kitchen report already.')
    if (!(Number(t.target_mins) >= 1)) out.push('The timer "' + label + '" needs a target in minutes.')
  }
  return out
}

/**
 * A shared flow's timers at one location: box ids turned into the location's
 * station ids (matches from resolveSharedFlow()). A timer whose box the
 * location has no station for is left out, with its name in `missing`.
 */
export function resolveTimers(timers, matches = {}) {
  const out = []
  const missing = []
  for (const t of timers || []) {
    const from = t.from === START ? START : matches[t.from]
    const to = matches[t.to]
    if (!from || !to) { missing.push(t); continue }
    out.push({ ...t, from, to })
  }
  return { timers: out, missing }
}

/** Every node before `id` on a dish's way (its route's predecessors, START included). */
function before(route, id) {
  const seen = new Set()
  const walk = [...(route[id] || [])]
  while (walk.length && seen.size < 200) {
    const p = walk.pop()
    if (seen.has(p)) continue
    seen.add(p)
    if (p !== START) walk.push(...(route[p] || []))
  }
  return seen
}

/**
 * One dish's span for a timer: { start, end, seconds } or null when the dish
 * doesn't pass both points in order, was voided, or isn't done at the end yet.
 *   cfg  { stations } as the sequencer's kitchen config (Sleepers' delays)
 *   at   the time "now" is (a Sleeper counts as done once its time is past)
 */
export function timerSpan(item, timer, cfg, at = new Date().toISOString()) {
  if (!item || item.voided_at) return null
  const route = item.route || {}
  if (!route[timer.to]) return null
  const end = item.done?.[timer.to] || null
  if (!end) return null
  let start
  if (timer.from === START) {
    if (!before(route, timer.to).has(START)) return null
    start = item.since || item.fired_at || item.fire_at || item.sent_at || null
  } else {
    if (!route[timer.from] || !before(route, timer.to).has(timer.from)) return null
    const times = flowTimes(item, cfg, at)
    start = timer.from_when === 'done' ? times.done(timer.from) : times.arrived(timer.from)
  }
  if (!start) return null
  const seconds = Math.round((ms(end) - ms(start)) / 1000)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return { start, end, seconds }
}

/**
 * A timer's results over kitchen orders (kds_orders.state, or { number,
 * created_at, items }): { count, avg_secs, median_secs, p90_secs, max_secs,
 * on_time, on_time_pct, slowest: [{ number, item, seconds, at }] }.
 * Per ticket, an order counts once its every dish that passes the timer's
 * end is done there.
 */
export function timerResults(orders, timer, cfg, at = new Date().toISOString()) {
  const rows = []
  for (const o of orders || []) {
    const spans = []
    let open = false
    for (const i of o?.items || []) {
      const s = timerSpan(i, timer, cfg, at)
      if (s) spans.push({ ...s, item: i.name || null })
      // A dish on its way to the end but not tapped there yet keeps a ticket open.
      else if (timer.per === 'ticket' && !i.voided_at && i.route?.[timer.to] && !i.done?.[timer.to]) open = true
    }
    if (!spans.length) continue
    if (timer.per === 'ticket') {
      if (open) continue
      const start = spans.reduce((a, s) => (ms(s.start) < ms(a) ? s.start : a), spans[0].start)
      const end = spans.reduce((a, s) => (ms(s.end) > ms(a) ? s.end : a), spans[0].end)
      rows.push({ number: o.number || null, item: null, seconds: Math.round((ms(end) - ms(start)) / 1000), at: end })
    } else {
      for (const s of spans) rows.push({ number: o.number || null, item: s.item, seconds: s.seconds, at: s.end })
    }
  }
  return summarise(rows, timer.target_mins)
}

/** The figures over [{ seconds, ... }]. */
export function summarise(rows, targetMins) {
  const secs = rows.map(r => r.seconds).sort((a, b) => a - b)
  const n = secs.length
  const pct = p => {
    if (!n) return null
    // As Postgres's percentile_cont: straight-line between the two nearest.
    const x = (n - 1) * p
    const lo = Math.floor(x)
    const hi = Math.ceil(x)
    return Math.round(secs[lo] + (secs[hi] - secs[lo]) * (x - lo))
  }
  const onTime = secs.filter(s => s <= clampMins(targetMins) * 60).length
  return {
    count: n,
    avg_secs: n ? Math.round(secs.reduce((a, b) => a + b, 0) / n) : null,
    median_secs: pct(0.5),
    p90_secs: pct(0.9),
    max_secs: n ? secs[n - 1] : null,
    on_time: onTime,
    on_time_pct: n ? Math.round(onTime * 100 / n) : null,
    slowest: [...rows].sort((a, b) => b.seconds - a.seconds).slice(0, 5),
  }
}
