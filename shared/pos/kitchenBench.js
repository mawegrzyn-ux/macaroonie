// shared/pos/kitchenBench.js
//
// The kitchen test bench's pretend kitchen (Till setup > Kitchen screens >
// Test the kitchen; pos/src/kitchen/Bench.jsx). It stands in for the
// sequencer and /pos-api for the screens on the bench page: test orders go
// in as till checks (lines.sent, course.fired, line.voided) or online orders
// (kitchen.order_in), the screens' taps come back as kitchen events, and
// everything runs through the same rules as the real kitchen
// (shared/pos/kitchen.js). Nothing leaves the page.
//
//   createBench(data, { now, rng })   data = GET /pos-api/kitchen-test
//     .cfg()                 the kitchen config of the flow in use
//     .screenConfig(screen)  what GET /pos-api/config gives that screen
//     .sync(since)           GET /pos-api/kitchen/sync
//     .submit(screen, events) POST /pos-api/events (kitchen events only)
//     .switchFlow(flowId, by, screen)  PUT /pos-api/kitchen/flow (screen null: the bench itself)
//     .sendOrder(spec)       a test order into the kitchen
//     .randomSpec()          a test order made up from the menu
//     .fireCourse(orderId, courseId) / .voidItem(orderId, itemId) / .clear()
//
// Pure apart from the clock and random numbers it is given.

import { applyKitchenEvent, kitchenForCheckEvent, stationSettings, KITCHEN_DEVICE_EVENTS, BUMP_KINDS } from './kitchen.js'
import { resolveSteps, isCombo } from '../combos.js'
import { ulid } from './ids.js'

function uuid(rng) {
  const hex = n => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join('')
  return hex(8) + '-' + hex(4) + '-4' + hex(3) + '-' + ['8', '9', 'a', 'b'][Math.floor(rng() * 4)] + hex(3) + '-' + hex(12)
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)]
const clip = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null)

/** The screens on the bench: the venue's kitchen screens, or one per station. */
export function benchScreens(data, mode = 'setup') {
  const bumpable = (data.stations || []).filter(s => BUMP_KINDS.includes(s.kind))
  if (mode === 'setup' && (data.screens || []).length) return data.screens.map(s => ({ ...s, settings: s.settings || {} }))
  return bumpable.map(s => ({ id: s.id, name: s.name, short_code: null, settings: { station_ids: [s.id] }, per_station: true }))
}

/**
 * A combo's picks made up at random: every step that needs a pick gets one
 * of its choices (conditions follow the picks, as on the till). Returns the
 * kitchen parts [{ item_id, section_id, name, kitchen_name, modifiers }].
 */
export function randomComboParts(item, ctx, rng = Math.random) {
  let picks = {}
  for (let n = 0; n < 40; n++) {
    const r = resolveSteps(item, picks, ctx)
    picks = r.picks
    const need = r.steps.find(s => s.shown && (picks[s.step.id] || []).length < s.step.min && s.choices.some(c => !c.sold_out))
    if (!need) break
    const c = pick(need.choices.filter(x => !x.sold_out), rng)
    picks = { ...picks, [need.step.id]: [...(picks[need.step.id] || []), { option_id: c.option_id, item_id: c.item_id, choices: {} }] }
  }
  const parts = []
  for (const s of resolveSteps(item, picks, ctx).steps) {
    if (!s.shown) continue
    for (const e of picks[s.step.id] || []) {
      const c = s.choices.find(x => x.option_id === e.option_id && (x.item_id || null) === (e.item_id || null))
      if (c) parts.push({ item_id: c.item_id || null, section_id: c.section_id || null, name: c.label, kitchen_name: c.kitchen_name || null, modifiers: [] })
    }
  }
  return parts
}

export function createBench(data, { now = () => new Date().toISOString(), rng = Math.random } = {}) {
  const st = {
    orders: {},
    lastSeq: {},
    checks: {},
    seq: 0,
    resetSeq: 0,
    activeFlowId: (data.flows || []).some(f => f.id === data.active_flow_id) ? data.active_flow_id : data.flows?.[0]?.id || null,
    switchedAt: null,
    switchedBy: null,
    eventIds: new Set(),
    log: [],
    number: 0,
    webNumber: 0,
    balanceLast: {},   // each Splitter's last pick (the sequencer keeps it in kds_balance_turns)
  }
  const by = (rows, f) => Object.fromEntries((rows || []).map(r => [r.id, f(r)]))
  const ctx = { itemsById: data.items || {}, sectionItems: data.section_items || {} }
  let cfgCache = null

  function activeFlow() {
    return (data.flows || []).find(f => f.id === st.activeFlowId) || null
  }

  function cfg() {
    if (cfgCache && cfgCache.flow_id === st.activeFlowId) return cfgCache
    const stations = by(data.stations, s => ({ id: s.id, name: s.name, kind: s.kind, colour: s.colour, settings: stationSettings(s) }))
    cfgCache = {
      enabled: (data.stations || []).some(s => ['prep', 'expo', 'runner'].includes(s.kind)),
      stations,
      flow: activeFlow()?.links || [],
      flow_id: st.activeFlowId,
      courses: by(data.courses, c => ({ name: c.name, sort_order: c.sort_order })),
      tables: by(data.tables, t => ({ label: t.label })),
      staff: {},
      order_types: by(data.order_types, t => ({ name: t.name })),
    }
    return cfgCache
  }

  // The config with what Splitters need: the bench's orders and their last picks.
  const withBalance = c => ({ ...c, balance: { open: st.orders, last: st.balanceLast, picks: st.balanceLast } })

  function note(entry) {
    st.log = [{ at: now(), ...entry }, ...st.log].slice(0, 80)
  }

  function store(changed) {
    if (!Object.keys(changed).length) return
    st.seq++
    for (const [id, o] of Object.entries(changed)) {
      st.orders[id] = o
      st.lastSeq[id] = st.seq
    }
  }

  function screenConfig(screen, { sound = false } = {}) {
    const flow = activeFlow()
    const device = { id: screen.id, kind: 'kds', name: screen.name, short_code: screen.short_code || null, settings: { ...(screen.settings || {}), sound } }
    return {
      kind: 'kds',
      bench: true,
      venue: data.venue,
      settings: data.settings,
      stations: data.stations,
      flow: flow?.links || [],
      flows: (data.flows || []).map(f => ({ id: f.id, name: f.name, station_ids: f.station_ids || [] })),
      active_flow_id: st.activeFlowId,
      flow_switched_at: st.switchedAt,
      flow_switched_by: st.switchedBy,
      courses: data.courses || [],
      order_types: data.order_types || [],
      version: 'bench.' + st.activeFlowId + '.' + (st.switchedAt || '') + '.' + screen.id + '.' + sound,
      device,
    }
  }

  function sync(since) {
    const server_time = now()
    const fresh = Object.keys(st.orders)
    if (!since || since > st.seq || since < st.resetSeq) {
      return { reset: true, seq: st.seq, orders: fresh.map(id => st.orders[id]), server_time }
    }
    return { seq: st.seq, orders: fresh.filter(id => st.lastSeq[id] > since).map(id => st.orders[id]), server_time }
  }

  function submit(screen, events) {
    const results = []
    const kitchen = {}
    for (const raw of events || []) {
      if (st.eventIds.has(raw.id)) { results.push({ id: raw.id, ok: false, error: 'Already received', code: 'duplicate', duplicate: true }); continue }
      if (!KITCHEN_DEVICE_EVENTS.includes(raw.type)) { results.push({ id: raw.id, ok: false, error: 'Not allowed from a kitchen screen', code: 'invalid' }); continue }
      const e = { ...raw, received_at: now() }
      const r = applyKitchenEvent(st.orders, e, cfg())
      const order = st.orders[raw.payload?.order_id]
      if (!r.ok) {
        results.push({ id: raw.id, ok: false, error: r.error, code: r.code })
        note({ screen: screen.name, type: raw.type, number: order?.number || null, ok: false, error: r.error })
        continue
      }
      st.eventIds.add(raw.id)
      store(r.orders)
      Object.assign(kitchen, r.orders)
      results.push({ id: raw.id, ok: true, seq: st.seq })
      const station = raw.payload?.station_id ? data.stations.find(s => s.id === raw.payload.station_id) : null
      note({ screen: screen.name, type: raw.type, number: order?.number || null, station: station?.name || null, ok: true })
    }
    return { results, seq: st.seq, checks: [], kitchen: Object.values(kitchen) }
  }

  /** Put another flow in use. screen: the kitchen screen that asked, or null (the bench). Throws { status, message }. */
  function switchFlow(flowId, byName, screen = null) {
    if (screen && screen.settings?.can_switch_flow === false) {
      throw Object.assign(new Error('This screen can\'t switch the kitchen flow: it can be allowed in Till setup, Kitchen screens'), { status: 403 })
    }
    const flow = (data.flows || []).find(f => f.id === flowId)
    if (!flow) throw Object.assign(new Error('Kitchen flow not found'), { status: 404 })
    const changed = st.activeFlowId !== flow.id
    if (changed) {
      st.activeFlowId = flow.id
      st.switchedAt = now()
      st.switchedBy = byName || null
      note({ screen: byName || 'Test bench', type: 'flow', flow: flow.name, ok: true })
    }
    return { flow_id: flow.id, name: flow.name, switched_at: st.switchedAt, switched_by: st.switchedBy, changed }
  }

  // ── Test orders ──────────────────────────────────────────────

  /**
   * A test order into the kitchen. spec:
   *   source      'till' | 'online'
   *   order_type_id, revenue_stream_id
   *   device_id   the till or kiosk it is sent from (till orders; flow links
   *               can be for one till)
   *   table_id    a table (till orders), else a counter order with a number
   *   tent        a tent number (till counter orders)
   *   name        the customer's name (a till order's name, an online guest)
   *   hold_courses  dishes in later courses wait to be fired
   *   note
   *   lines       [{ item_id, qty, note, parts }] (parts: a combo's picks;
   *               made up when missing)
   * Returns { ok, id, number } or { ok: false, error }.
   */
  function sendOrder(spec) {
    const c = cfg()
    if (!c.enabled) return { ok: false, error: 'The venue has no kitchen stations to send to' }
    const items = data.items || {}
    const lines = (spec.lines || []).filter(l => items[l.item_id] && l.qty > 0)
    if (!lines.length) return { ok: false, error: 'Add a dish first' }
    const at = now()
    const typeId = spec.order_type_id || null
    const streamId = spec.revenue_stream_id || null
    const partsOf = l => (isCombo(items[l.item_id]) ? (l.parts || randomComboParts(items[l.item_id], ctx, rng)) : null)

    if (spec.source === 'online') {
      st.webNumber++
      const orderId = uuid(rng)
      const type = (data.order_types || []).find(t => t.id === typeId)
      const order = {
        id: 'web-' + orderId, order_id: orderId, number: 'W' + st.webNumber, guest: clip(spec.name, 80) || 'Test guest',
        table: null, type: typeId, type_name: type?.name || null, note: spec.note || null,
        items: lines.map((l, i) => {
          const it = items[l.item_id]
          const parts = partsOf(l)
          return {
            id: 'i' + (i + 1), name: it.kitchen_name || it.name, qty: l.qty, item_id: it.id, section_id: it.section_id || null,
            revenue_stream_id: streamId, options: [], note: l.note || null,
            ...(parts ? { parts: parts.map(p => ({ name: p.kitchen_name || p.name, item_id: p.item_id, section_id: p.section_id, options: [] })) } : {}),
          }
        }),
      }
      const r = applyKitchenEvent(st.orders, { id: ulid(), type: 'kitchen.order_in', payload: { order }, received_at: at }, withBalance(c))
      if (!r.ok) return { ok: false, error: r.error }
      store(r.orders)
      note({ screen: 'Test bench', type: 'order_in', number: order.number, ok: true })
      return { ok: true, id: order.id, number: order.number }
    }

    st.number++
    const checkId = ulid()
    const sendId = ulid()
    const table = spec.table_id ? (data.tables || []).find(t => t.id === spec.table_id) : null
    const sorts = lines.map(l => {
      const cid = items[l.item_id].course_id
      return cid ? (c.courses[cid]?.sort_order ?? 0) : null
    }).filter(v => v != null)
    const first = sorts.length ? Math.min(...sorts) : null
    const check = {
      id: checkId, mode: table ? 'table' : 'counter', number: st.number, order_no: table ? null : st.number,
      table_id: table?.id || null, tab_name: clip(spec.name, 60), covers: table ? 2 : null, server_id: null,
      order_type_id: typeId, tent: table ? null : clip(spec.tent, 10), note: spec.note || null, revenue_stream_id: streamId,
      lines: lines.map(l => {
        const it = items[l.item_id]
        const sort = it.course_id ? (c.courses[it.course_id]?.sort_order ?? 0) : null
        return {
          id: ulid(), item_id: it.id, section_id: it.section_id || null, name: it.name, kitchen_name: it.kitchen_name || null,
          qty: l.qty, modifiers: [], note: l.note || null, allergies: [], seat: null,
          course_id: it.course_id || null, combo: partsOf(l), revenue_stream_id: streamId,
          send_id: sendId, status: 'sent', held: !!(spec.hold_courses && sort != null && sort > first),
        }
      }),
    }
    const device = spec.device_id && (data.devices || []).some(d => d.id === spec.device_id) ? spec.device_id : null
    const e = { id: ulid(), type: 'lines.sent', check_id: checkId, device_id: device, payload: { line_ids: check.lines.map(l => l.id), send_id: sendId }, received_at: at }
    const out = kitchenForCheckEvent(e, {}, { [checkId]: check }, {}, withBalance(c))
    if (!out[checkId]) return { ok: false, error: 'Nothing went to the kitchen' }
    st.checks[checkId] = check
    store(out)
    note({ screen: 'Test bench', type: 'lines.sent', number: out[checkId].number, ok: true })
    return { ok: true, id: checkId, number: out[checkId].number }
  }

  function tillEvent(orderId, type, payload) {
    const check = st.checks[orderId]
    if (!check) return { ok: false, error: 'Only a till order can do this' }
    const e = { id: ulid(), type, check_id: orderId, payload, received_at: now() }
    const out = kitchenForCheckEvent(e, { [orderId]: check }, { [orderId]: check }, { [orderId]: st.orders[orderId] }, withBalance(cfg()))
    if (!out[orderId]) return { ok: false, error: 'Nothing changed' }
    store(out)
    note({ screen: 'Test bench', type, number: out[orderId].number, ok: true })
    return { ok: true }
  }

  const fireCourse = (orderId, courseId) => tillEvent(orderId, 'course.fired', { course_id: courseId })
  const voidItem = (orderId, itemId) => tillEvent(orderId, 'line.voided', { line_id: itemId, reason: 'Test' })

  /** Every order off the bench (the screens start again from nothing). */
  function clear() {
    st.orders = {}
    st.lastSeq = {}
    st.checks = {}
    st.seq++
    st.resetSeq = st.seq
    note({ screen: 'Test bench', type: 'clear', ok: true })
  }

  /** A test order made up from the menu: 1 to 4 dishes, a type, a table or the counter (some with a tent). */
  function randomSpec({ source = null } = {}) {
    const ids = Object.keys(data.items || {})
    const lines = []
    const count = 1 + Math.floor(rng() * Math.min(4, Math.max(1, ids.length)))
    for (let i = 0; i < count && ids.length; i++) {
      const id = pick(ids, rng)
      const have = lines.find(l => l.item_id === id)
      if (have) have.qty++
      else lines.push({ item_id: id, qty: rng() < 0.2 ? 2 : 1 })
    }
    const tables = data.tables || []
    const spec = {
      source: source || (rng() < 0.15 ? 'online' : 'till'),
      order_type_id: (data.order_types || []).length ? pick(data.order_types, rng).id : null,
      revenue_stream_id: (data.streams || []).length ? pick(data.streams, rng).id : null,
      table_id: tables.length && rng() < 0.5 ? pick(tables, rng).id : null,
      hold_courses: rng() < 0.3,
      lines,
    }
    if (spec.source === 'till' && !spec.table_id && rng() < 0.4) spec.tent = String(1 + Math.floor(rng() * 30))
    return spec
  }

  return {
    state: st,
    cfg,
    activeFlow,
    screenConfig,
    sync,
    submit,
    switchFlow,
    sendOrder,
    fireCourse,
    voidItem,
    clear,
    randomSpec,
    orders: () => st.orders,
  }
}
