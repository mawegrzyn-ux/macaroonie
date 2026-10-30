// shared/pos/mirror.js
//
// The venue hub's copy of its venue (docs/POS.md section 11): the cloud's
// state (the base) plus the events the hub accepted that the cloud hasn't
// taken yet (pending), with the same sequencer (sequencer.js) deciding new
// events over that view. Tills, kiosks and kitchen screens on the venue
// network get their answers from here, at LAN speed, with or without the
// internet; the cloud decides every pending event again when the hub sends
// it, and stays the one record.
//
// Whenever the cloud's state moves (applyCloud()) the view is rebuilt: the
// base, then every pending event replayed on top at its own time. One that
// no longer applies (a check closed by a till that went straight to the
// cloud) is refused there and then: a conflict, as the cloud would refuse it.
//
// Devices read the view through sync() / kitchenSync(): `seq` is the hub's
// own counter of its view (rev), with `source: 'hub:<id>'`, so a device that
// moves between the hub and the cloud starts its cursor again.
//
// Pure apart from the clock passed in: the hub keeps snapshot() on disk and
// gives it back to createMirror() after a restart.

import { createSequencer } from './sequencer.js'
import { dayFigures } from './reports.js'
import { checkTotals } from './pricing.js'
import { cardNeed } from './cards.js'
import { loyaltyNeed } from '../loyalty.js'

// Cloud event ids remembered, so an event a device sends again after the
// cloud took it isn't decided twice.
const KNOWN_MAX = 20000
const REFUSED_MAX = 5000
// Kitchen orders kept for kitchen screens after they leave the kitchen (as
// the cloud's kitchenSync()).
const KITCHEN_KEEP_MS = 12 * 3600 * 1000

/**
 * The trading day the hub opens on its own (no internet): the date and how
 * many the view opened before it, so a rebuild gives it the same id again
 * and a day opened after an offline Z gets another one.
 */
export const localDayId = (date, n = 1) => 'hub-day-' + date + '-' + n

const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** An empty base: nothing heard from the cloud yet. */
export function emptyBase() {
  return { seq: 0, day: null, numbers: {}, checks: {}, kitchen: {}, kitchen_at: {}, turns: {}, presence: [] }
}

function viewStore(base, mirror) {
  const s = {
    events: new Map(),
    rejections: new Map(),
    checks: new Map(Object.entries(clone(base.checks || {}))),
    kitchen: new Map(Object.entries(clone(base.kitchen || {}))),
    kitchenAt: new Map(Object.entries(base.kitchen_at || {})),
    turns: { ...(base.turns || {}) },
    state: { last_seq: base.seq || 0, numbers: clone(base.numbers || {}), day: clone(base.day) },
    now: null,
    opened: 0,
  }
  let queue = Promise.resolve()
  const at = () => (s.now ? s.now.getTime() : Date.now())
  return {
    data: s,
    run: (_venue, fn) => (queue = queue.then(fn, fn)),
    findEvent: id => s.events.get(id) || mirror.known.get(id) || null,
    findRejection: id => s.rejections.get(id) || mirror.refused.get(id) || null,
    context: () => mirror.context,
    venueState: () => ({ last_seq: s.state.last_seq, numbers: s.state.numbers, day: s.state.day }),
    openDay: ({ business_date }) => {
      const day = { id: localDayId(business_date, ++s.opened), business_date, local: true }
      s.state.day = day
      return day
    },
    loadChecks: ids => Object.fromEntries(ids.filter(id => s.checks.has(id)).map(id => [id, clone(s.checks.get(id))])),
    openCheckCount: () => [...s.checks.values()].filter(c => c.status === 'open').length,
    saveEvent: e => { s.events.set(e.id, { id: e.id, seq: e.seq, type: e.type, check_id: e.check_id, assigned: e.assigned }) },
    saveChecks: changed => { for (const [id, c] of Object.entries(changed)) s.checks.set(id, clone(c)) },
    saveJobs: () => {},
    saveRejection: (e, error, code) => { s.rejections.set(e.id, { error, code }) },
    saveVenueState: v => {
      s.state.last_seq = v.last_seq
      if (v.numbers) s.state.numbers = v.numbers
    },
    closeDay: () => { s.state.day = null },
    loadKitchenOrders: ids => Object.fromEntries(ids.filter(id => s.kitchen.has(id)).map(id => [id, clone(s.kitchen.get(id))])),
    saveKitchenOrders: changed => {
      for (const [id, o] of Object.entries(changed)) {
        s.kitchen.set(id, clone(o))
        s.kitchenAt.set(id, new Date(at()).toISOString())
      }
    },
    saveKitchenLog: () => {},
    loadOpenKitchenOrders: () => Object.fromEntries([...s.kitchen].filter(([, o]) => o.status === 'active' || o.status === 'ready').map(([id, o]) => [id, clone(o)])),
    loadRecentKitchenOrders: minutes => {
      const from = at() - minutes * 60000
      return Object.fromEntries([...s.kitchen].filter(([id]) => Date.parse(s.kitchenAt.get(id) || 0) >= from).map(([id, o]) => [id, clone(o)]))
    },
    loadBalanceTurns: () => ({ ...s.turns }),
    saveBalanceTurns: picks => { Object.assign(s.turns, picks) },
  }
}

/**
 * A mirror. opts:
 *   hubId                  this hub's device id (the source devices see)
 *   context                the sequencer context from the cloud (GET /pos-api/hub/context)
 *   snapshot               what snapshot() returned before a restart (optional)
 */
export function createMirror({ hubId, context = null, snapshot: saved = null } = {}) {
  // (`saved`: a function below is called snapshot.)
  const snap = saved || {}
  const mirror = {
    context: context || snap.context || null,
    known: new Map(snap.known || []),
    refused: new Map(snap.refused || []),
  }
  let base = snap.base || emptyBase()
  // { event, at, acked? (cloud seq once the cloud took it), printed? }
  let pending = snap.pending || []
  // Refusals the cloud hasn't been told about yet (for its Refused changes list).
  let refusalsToSend = snap.refusals_to_send || []
  let conflicts = snap.conflicts || []
  let rev = snap.rev || 0
  let revs = { checks: snap.revs?.checks || {}, kitchen: snap.revs?.kitchen || {}, day: snap.revs?.day || 0 }
  let store = null
  let seqr = null
  let queue = Promise.resolve()
  const source = 'hub:' + hubId
  const serial = fn => (queue = queue.then(fn, fn))

  function remember(map, id, value, max) {
    map.set(id, value)
    if (map.size > max) map.delete(map.keys().next().value)
  }

  /** Bump the revs of whatever differs between two views. */
  function markChanges(before, after) {
    const ids = new Set([...before.checks.keys(), ...after.checks.keys()])
    let moved = false
    for (const id of ids) {
      if (!same(before.checks.get(id), after.checks.get(id))) { revs.checks[id] = ++rev; moved = true }
    }
    const kids = new Set([...before.kitchen.keys(), ...after.kitchen.keys()])
    for (const id of kids) {
      if (!same(before.kitchen.get(id), after.kitchen.get(id))) { revs.kitchen[id] = ++rev; moved = true }
    }
    if (!same(before.state.day, after.state.day)) { revs.day = ++rev; moved = true }
    return moved
  }

  /** The view again: the base, then every pending event at its own time. Returns the events refused now. */
  async function rebuild() {
    const before = store?.data || viewStore(emptyBase(), mirror).data
    store = viewStore(base, mirror)
    seqr = createSequencer(store)
    const keep = []
    const refused = []
    if (!mirror.context) {
      markChanges(before, store.data)
      return refused
    }
    for (const p of pending) {
      store.data.now = new Date(p.at)
      const r = await seqr.submit(clone(p.event), { now: new Date(p.at) })
      if (r.ok) keep.push(p)
      else {
        refused.push({ event: p.event, error: r.error, code: r.code })
        remember(mirror.refused, p.event.id, { error: r.error, code: r.code }, REFUSED_MAX)
        conflicts.push({ id: p.event.id, type: p.event.type, check_id: p.event.check_id || null, device_id: p.event.device_id || null, error: r.error, code: r.code, at: new Date().toISOString() })
        if (!p.acked) refusalsToSend.push({ event: p.event, error: r.error, code: r.code })
      }
    }
    store.data.now = null
    pending = keep
    if (conflicts.length > 200) conflicts = conflicts.slice(-200)
    markChanges(before, store.data)
    return refused
  }

  const ready = rebuild()

  /**
   * A device's event, decided now over the view. The answer is the
   * sequencer's ({ ok, seq, event, checks, kitchen, jobs } or { ok: false,
   * error, code }); an accepted new event is kept to send to the cloud.
   * opts.printed: the hub prints its jobs itself (the cloud records them as printed).
   */
  function submit(event, { now = new Date(), printed = true } = {}) {
    return serial(async () => {
      await ready
      if (!mirror.context) return { ok: false, error: 'The hub hasn\'t got the venue\'s set-up yet', code: 'hub_not_ready' }
      const before = { checks: new Map(store.data.checks), kitchen: new Map(store.data.kitchen), state: { day: clone(store.data.state.day) } }
      store.data.now = now
      const r = await seqr.submit(clone(event), { now })
      store.data.now = null
      if (r.ok && !r.duplicate) {
        pending.push({ event: clone(event), at: now.toISOString(), printed: !!printed && !!r.jobs?.length })
        markChanges(before, store.data)
      } else if (!r.ok && !r.duplicate) {
        remember(mirror.refused, event.id, { error: r.error, code: r.code }, REFUSED_MAX)
        refusalsToSend.push({ event: clone(event), error: r.error, code: r.code })
      }
      return r
    })
  }

  /**
   * What the cloud said (GET /pos-api/hub/sync): { seq, reset, events: [{ id, seq }],
   * event_ids (on a reset: recent ids), checks: [state], kitchen: [{ state, updated_at }],
   * day, numbers, turns, presence }. Pending events the cloud now has drop out; the
   * view is rebuilt. Returns the pending events refused on top.
   */
  function applyCloud(reply) {
    return serial(async () => {
      await ready
      const next = reply.reset ? { ...emptyBase(), presence: base.presence } : { ...base, checks: { ...base.checks }, kitchen: { ...base.kitchen }, kitchen_at: { ...base.kitchen_at } }
      for (const c of reply.checks || []) next.checks[c.id] = c
      for (const k of reply.kitchen || []) {
        const o = k.state || k
        next.kitchen[o.id] = o
        next.kitchen_at[o.id] = k.updated_at || new Date().toISOString()
      }
      next.seq = Number(reply.seq) || 0
      next.day = reply.day || null
      if (reply.numbers) next.numbers = reply.numbers
      if (reply.turns) next.turns = reply.turns
      if (reply.presence) next.presence = reply.presence
      // Old closed checks and kitchen orders out, as the cloud's own resets do.
      const dayId = next.day?.id || null
      for (const [id, c] of Object.entries(next.checks)) if (c.status !== 'open' && c.day_id !== dayId) delete next.checks[id]
      const cut = Date.now() - KITCHEN_KEEP_MS
      for (const [id, o] of Object.entries(next.kitchen)) {
        if (o.status !== 'active' && o.status !== 'ready' && Date.parse(next.kitchen_at[id] || 0) < cut) { delete next.kitchen[id]; delete next.kitchen_at[id] }
      }
      for (const e of [...(reply.events || []), ...(reply.event_ids || [])]) {
        const id = typeof e === 'string' ? e : e.id
        remember(mirror.known, id, { id, seq: Number(e.seq) || null, duplicate: true }, KNOWN_MAX)
      }
      base = next
      pending = pending.filter(p => !mirror.known.has(p.event.id))
      return rebuild()
    })
  }

  /**
   * The cloud's answers to an upload (POST /pos-api/hub/events results). A
   * taken event stays pending until the cloud's state includes it (it comes
   * back in applyCloud()); a refused one goes now, as a conflict.
   */
  function confirm(results) {
    return serial(async () => {
      await ready
      let refusedAny = false
      for (const r of results || []) {
        const p = pending.find(x => x.event.id === r.id)
        if (!p) continue
        if (r.ok) p.acked = r.seq || true
        else {
          refusedAny = true
          pending = pending.filter(x => x !== p)
          remember(mirror.refused, r.id, { error: r.error, code: r.code }, REFUSED_MAX)
          conflicts.push({ id: r.id, type: p.event.type, check_id: p.event.check_id || null, device_id: p.event.device_id || null, error: r.error, code: r.code, at: new Date().toISOString(), by: 'cloud' })
        }
      }
      if (refusedAny) await rebuild()
    })
  }

  /** New sequencer context (the venue's set-up changed): the view is decided again with it. */
  function setContext(ctx) {
    return serial(async () => {
      await ready
      mirror.context = ctx
      return rebuild()
    })
  }

  const view = () => store.data

  /** The events to send to the cloud, in order (taken ones are still waiting to come back). */
  function toSend(limit = 100) {
    return pending.filter(p => !p.acked).slice(0, limit).map(p => ({ ...clone(p.event), hub_printed: !!p.printed, hub_at: p.at }))
  }

  /** Refusals the cloud should list; drop() once sent. */
  function refusalsOut() {
    const list = refusalsToSend.slice(0, 100)
    return { list, drop: () => { refusalsToSend = refusalsToSend.slice(list.length) } }
  }

  /** What a till asks for (as GET /pos-api/sync): checks changed since its cursor, or all of them. */
  function sync({ since = 0, source: theirs = null, deviceId = null, presence = [] } = {}) {
    const v = view()
    const day = v.state.day ? { id: v.state.day.id, business_date: v.state.day.business_date } : null
    const reset = !since || theirs !== source || since > rev
    const all = [...v.checks.values()]
    const checks = reset
      ? all.filter(c => c.status === 'open' || (day && c.day_id === day.id))
      : all.filter(c => (revs.checks[c.id] || 0) > since)
    return {
      source, reset, seq: rev, events: [], checks: clone(checks), day,
      presence: [...(base.presence || []).filter(p => !presence.some(q => q.device_id === p.device_id)), ...presence],
      server_time: new Date().toISOString(),
      numbers: deviceId ? clone(v.state.numbers?.[deviceId] || null) : null,
    }
  }

  /** What a kitchen screen asks for (as GET /pos-api/kitchen/sync). */
  function kitchenSync({ since = 0, source: theirs = null } = {}) {
    const v = view()
    const reset = !since || theirs !== source || since > rev
    const orders = [...v.kitchen.values()].filter(o => reset || (revs.kitchen[o.id] || 0) > since)
    return { source, reset, seq: rev, orders: clone(orders), server_time: new Date().toISOString() }
  }

  /** The trading day's figures from the view (as GET /pos-api/reports/day, offline too). */
  function dayReport() {
    const v = view()
    const day = v.state.day
    if (!day) return { day: null, figures: dayFigures([], null), waiting: [] }
    return { day: { id: day.id, business_date: day.business_date }, figures: dayFigures([...v.checks.values()], day.id), waiting: [] }
  }

  /** Recent checks of a status (as GET /pos-api/checks): newest first, with their totals. */
  function listChecks({ status = 'closed', limit = 60 } = {}) {
    const at = c => Date.parse(c.closed_at || c.opened_at || 0) || 0
    return [...view().checks.values()].filter(c => c.status === status).sort((a, b) => at(b) - at(a)).slice(0, limit).map(c => {
      const t = checkTotals(c)
      return {
        id: c.id, number: c.number, number_code: c.number_code || null, order_no: c.order_no ?? null, mode: c.mode,
        table_id: c.table_id || null, tab_name: c.tab_name || null, covers: c.covers || null, server_id: c.server_id || null,
        status: c.status, opened_at: c.opened_at, closed_at: c.closed_at || null, total: t.total, paid: t.paid, refunded: t.refunded, day_id: c.day_id,
      }
    })
  }

  /** One check from the view (as GET /pos-api/checks/:id), or null. */
  const getCheck = id => clone(view().checks.get(id) || null)

  /** Whether this event needs the cloud to decide it (a card machine payment, a loyalty reward). */
  function needsCloud(event) {
    const checks = Object.fromEntries(view().checks)
    return !!(cardNeed(event, checks) || loyaltyNeed(event, checks))
  }

  /** The view's kitchen orders (for the order ready boards). */
  const kitchenOrders = () => clone([...view().kitchen.values()])

  function status() {
    return {
      rev,
      cloud_seq: base.seq,
      pending: pending.length,
      to_send: pending.filter(p => !p.acked).length,
      conflicts: conflicts.slice(-20),
      day: view().state.day,
    }
  }

  /** Everything to keep on disk. */
  function snapshot() {
    return {
      v: 1, base, pending, rev, revs, context: mirror.context,
      known: [...mirror.known].slice(-KNOWN_MAX), refused: [...mirror.refused].slice(-REFUSED_MAX),
      refusals_to_send: refusalsToSend, conflicts,
    }
  }

  return {
    ready, submit, applyCloud, confirm, setContext, toSend, refusalsOut, sync, kitchenSync, dayReport,
    listChecks, getCheck, needsCloud, kitchenOrders, status, snapshot, source,
    get rev() { return rev },
    get cloudSeq() { return base.seq },
    get hasContext() { return !!mirror.context },
    get context() { return mirror.context },
    idle: () => serial(() => null),
    /** fn run between two events (the hub writes its snapshot this way). */
    exclusive: fn => serial(fn),
    /** Whether the cloud already has this event, or the copy holds it waiting to go up. */
    holds: id => mirror.known.has(id) || pending.some(p => p.event.id === id),
  }
}
