// The kitchen screen's state (KDS, docs/POS.md section 9).
//
// Same shape as the till's store (src/lib/store.js), for kitchen orders:
//   confirmed  kitchen orders as the sequencer has them (last sync)
//   outbox     this screen's taps (bump, done, recall ...) not yet accepted
//   orders     confirmed + outbox applied with shared/pos/kitchen.js: what
//              the screen shows
// A tap shows at once and is kept on the device (IndexedDB) until the
// sequencer (cloud now, venue hub later: lib/transport.js tries the hub
// first) accepts or refuses it. Another screen's tap reaches this one through
// the socket (pos.seq with kinds ['kitchen']) or the poll.
//
// Bench mode (the kitchen test bench, Bench.jsx): the screen runs inside the
// bench page and talks to the bench's pretend kitchen instead of the server
// (bench.transport, bench.subscribe in place of the socket). Nothing is kept
// on the device: no IndexedDB, and its choices (station, filter) only last
// for the browser tab, so a test never touches a real kitchen screen's data.

import { useSyncExternalStore } from 'react'
import { applyKitchenEvent, stationSettings, nodeState, STALE_HOURS, BUMP_KINDS } from '@shared/pos/kitchen.js'
import { ulid } from '@shared/pos/ids.js'
import * as idb from '../lib/idb.js'
import { createTransport, OfflineError } from '../lib/transport.js'
import { moveDevice, tellDisconnect, setMovedTo } from '../lib/appHost.js'

const CONFIG_KEY = 'kds_config'
const SNAPSHOT_KEY = 'kds_snapshot'
const OUTBOX_KEY = 'kds_outbox'
const PREFS_KEY = 'maca_kds_prefs'

let bench = null
let prefsKey = PREFS_KEY
// The device's own storage, left alone in bench mode.
const keep = {
  get: k => (bench ? Promise.resolve(null) : idb.get(k)),
  set: (k, v) => (bench ? Promise.resolve() : idb.set(k, v)),
  del: k => (bench ? Promise.resolve() : idb.del(k)),
}
const prefsStore = () => (bench ? sessionStorage : localStorage)

let state = {
  phase: 'loading',       // 'loading' | 'ready'
  device: null,
  config: null,
  confirmed: {},
  outbox: [],
  seq: 0,
  online: navigator.onLine,
  socket: 'closed',
  syncing: false,
  lastSync: null,
  offset: 0,              // server clock minus this device's clock (ms)
  toasts: [],
  alerts: {},             // ticket key -> time it arrived (flash + beep)
  prefs: loadPrefs(),
}
const listeners = new Set()
let api = createTransport(null)

function setState(patch) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
export const getState = () => state
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
export function useKitchen() { return useSyncExternalStore(subscribe, getState) }

/** Now, on the server's clock (timers and taps use it, so every screen agrees). */
export const nowIso = () => new Date(Date.now() + (state.offset || 0)).toISOString()

function loadPrefs() {
  try { return { ...(JSON.parse(prefsStore().getItem(prefsKey)) || {}) } } catch { return {} }
}
export function setPrefs(patch) {
  const prefs = { ...state.prefs, ...patch }
  try { prefsStore().setItem(prefsKey, JSON.stringify(prefs)) } catch { /* private mode */ }
  setState({ prefs })
}

export function toast(text, kind = 'info', ms = 3500) {
  const id = ulid()
  setState({ toasts: [...state.toasts, { id, text, kind }].slice(-3) })
  setTimeout(() => setState({ toasts: state.toasts.filter(t => t.id !== id) }), ms)
}

// ── Config ───────────────────────────────────────────────────────

/** Stations this screen may show (device settings), in setup order. Order
 *  ready boards have nothing to bump: they show on menu screens instead. */
export function myStations(s = state) {
  const all = (s.config?.stations || []).filter(x => BUMP_KINDS.includes(x.kind))
  const ids = s.config?.device?.settings?.station_ids || []
  const mine = ids.length ? all.filter(x => ids.includes(x.id)) : all
  return mine.length ? mine : all
}

/** The station on screen now (remembered per device). */
export function currentStation(s = state) {
  const list = myStations(s)
  return list.find(x => x.id === s.prefs.station_id) || list[0] || null
}

/**
 * The kitchen config the shared rules need on this screen: the stations (a
 * dish's way through the kitchen is worked out when it is sent and kept on
 * the dish, item.route) and the flow (for showing where dishes go).
 */
let cfgCache = { config: null, cfg: null }
export function kitchenCfg(config = state.config) {
  if (cfgCache.config === config && cfgCache.cfg) return cfgCache.cfg
  const stations = Object.fromEntries((config?.stations || []).map(x => [x.id, { ...x, settings: stationSettings(x) }]))
  const cfg = { enabled: true, stations, flow: config?.flow || [] }
  cfgCache = { config, cfg }
  return cfg
}
export function useCfg() {
  return kitchenCfg(useKitchen().config)
}

let derived = { confirmed: null, outbox: null, config: null, orders: {} }
/** Every kitchen order as the screen should show it. */
export function currentOrders(s = state) {
  if (derived.confirmed === s.confirmed && derived.outbox === s.outbox && derived.config === s.config) return derived.orders
  let orders = { ...s.confirmed }
  const cfg = kitchenCfg(s.config)
  for (const e of s.outbox) {
    const r = applyKitchenEvent(orders, e, cfg)
    if (r.ok) orders = { ...orders, ...r.orders }
  }
  derived = { confirmed: s.confirmed, outbox: s.outbox, config: s.config, orders }
  return orders
}
export function useOrders() {
  const s = useKitchen()
  return currentOrders(s)
}

// ── Start ────────────────────────────────────────────────────────

/**
 * Start the screen. benchLink (bench mode only): { transport, subscribe }
 * from the kitchen test bench.
 */
export async function bootKitchen(device, benchLink = null) {
  if (benchLink) {
    bench = benchLink
    prefsKey = 'maca_kds_bench_' + device.id
    api = benchLink.transport
  } else {
    api = createTransport(device)
  }
  const [config, snapshot, outbox] = await Promise.all([keep.get(CONFIG_KEY), keep.get(SNAPSHOT_KEY), keep.get(OUTBOX_KEY)])
  setState({
    prefs: bench ? loadPrefs() : state.prefs,
    device, config: config || null,
    confirmed: snapshot?.orders || {}, seq: snapshot?.seq || 0, offset: snapshot?.offset || 0,
    outbox: outbox || [], phase: 'ready',
  })
  await loadConfig()
  startSync()
}

export async function loadConfig() {
  try {
    const v = state.config?.version
    const res = await api.get('/pos-api/config' + (v ? '?version=' + encodeURIComponent(v) : ''))
    if (!res.unchanged) {
      const before = state.config
      await keep.set(CONFIG_KEY, res)
      setState({ config: res, online: true })
      flowNotice(before, res)
    } else setState({ online: true })
  } catch (err) {
    handleError(err)
  }
}

// ── Kitchen flows (migration 177) ────────────────────────────────

/** The flow in use (config.flows / active_flow_id), or null with fewer than two flows. */
export function activeFlow(config = state.config) {
  const flows = config?.flows || []
  if (flows.length < 2) return null
  return flows.find(f => f.id === config.active_flow_id) || flows[0]
}

// This screen's own switch: no "flow changed" notice for it.
let ownSwitch = null

/** Another screen (or Till setup) put another flow in use: say so here. */
function flowNotice(before, after) {
  if (!before || !after?.active_flow_id || before.active_flow_id === after.active_flow_id) return
  if (ownSwitch && ownSwitch.flowId === after.active_flow_id && Date.now() < ownSwitch.until) return
  const f = activeFlow(after)
  if (f) toast('Kitchen flow now: ' + f.name + (after.flow_switched_by ? ' (' + after.flow_switched_by + ')' : ''), 'ok', 8000)
}

/**
 * Put another kitchen flow in use (the flow button). Online only: the
 * sequencer routes dishes, so a switch made offline would mean nothing.
 * Returns { ok } or { ok: false, error }.
 */
export async function switchFlow(flowId) {
  ownSwitch = { flowId, until: Date.now() + 20000 }
  try {
    const res = await api.put('/pos-api/kitchen/flow', { flow_id: flowId })
    if (state.config) {
      setState({ online: true, config: { ...state.config, active_flow_id: res.flow_id, flow_switched_at: res.switched_at, flow_switched_by: res.switched_by } })
    }
    loadConfig()
    return { ok: true, name: res.name }
  } catch (err) {
    ownSwitch = null
    if (err instanceof OfflineError || err?.offline) {
      setState({ online: false })
      return { ok: false, error: 'No connection: the kitchen flow can only be switched online' }
    }
    if (err?.status === 401) handleError(err)
    return { ok: false, error: err?.message || 'The flow wasn\'t switched' }
  }
}

function handleError(err) {
  if (err instanceof OfflineError || err?.offline) { setState({ online: false }); return }
  if (err?.status === 401) { forget('This screen was removed in Till setup. Pair it again.'); return }
  if (err?.status === 403 && err.code === 'pos_off') { toast(err.message, 'bad', 8000); return }
  console.warn(err)
}

async function forget(message) {
  toast(message, 'bad', 10000)
  if (bench) return
  stopSync()
  await Promise.all([keep.del('device'), keep.del(CONFIG_KEY), keep.del(SNAPSHOT_KEY)])
  setTimeout(() => location.reload(), 3000)
}

// ── Disconnect, move (lib/appHost.js) ────────────────────────────

/** On the kitchen test bench (no pairing to disconnect or move). */
export const inBench = () => !!bench

async function clearDevice() {
  stopSync()
  await Promise.all([keep.del('device'), keep.del(CONFIG_KEY), keep.del(SNAPSHOT_KEY), keep.del(OUTBOX_KEY)])
}

/**
 * Disconnect this screen (its settings): Macaroonie stops accepting its
 * pairing, the screen forgets it and shows the pairing screen. Taps not sent
 * yet are dropped (the caller warns first).
 */
export async function disconnect() {
  if (bench) return { ok: false, error: 'Not on the test page' }
  const told = await tellDisconnect(api)
  await clearDevice()
  if (!told) toast('Disconnected here. Macaroonie couldn\'t be told (offline): remove the screen in Till setup, or make it a new code.', 'bad', 8000)
  setTimeout(() => location.reload(), told ? 300 : 4000)
  return { ok: true, told }
}

/**
 * A kitchen screen paired on the till's address moves to kitchen.{root}:
 * waiting taps are sent first, then the new address pairs with a one-time code.
 */
export async function moveScreen() {
  if (bench) return { ok: false, error: 'Not on the test page' }
  if (state.outbox.length) await flush()
  if (state.outbox.length) return { ok: false, error: state.outbox.length + ' taps haven\'t been sent yet: check the Wi-Fi first' }
  const r = await moveDevice(api, 'kds')
  if (!r.ok) return r
  setMovedTo(r.url)
  await clearDevice()
  r.go()
  return { ok: true }
}

// ── Taps ─────────────────────────────────────────────────────────

/**
 * A kitchen tap: checked with the shared rules against what the screen
 * shows, applied at once, sent in the background. Returns { ok } or
 * { ok: false, error }.
 */
export function kitchen(type, payload) {
  const e = {
    id: ulid(), venue_id: state.device?.venue_id, device_id: state.device?.id, staff_id: null,
    type, payload, client_at: nowIso(),
  }
  const r = applyKitchenEvent(currentOrders(), e, kitchenCfg(state.config))
  if (!r.ok) return { ok: false, error: r.error, code: r.code }
  const outbox = [...state.outbox, e]
  setState({ outbox })
  keep.set(OUTBOX_KEY, outbox)
  scheduleFlush(0)
  return { ok: true }
}

export const bump = (orderId, stationId) => kitchen('kitchen.bumped', { order_id: orderId, station_id: stationId })
export const recall = (orderId, stationId) => kitchen('kitchen.recalled', { order_id: orderId, station_id: stationId })
export const itemDone = (orderId, stationId, itemId, done) => kitchen('kitchen.item_done', { order_id: orderId, station_id: stationId, item_id: itemId, done })
export const remake = (orderId, stationId, itemId, reason) => kitchen('kitchen.remake', { order_id: orderId, station_id: stationId, item_id: itemId, reason: reason || null })
export const priority = (orderId, on) => kitchen('kitchen.priority', { order_id: orderId, on })
export const collected = orderId => kitchen('kitchen.collected', { order_id: orderId })

// ── Sync ─────────────────────────────────────────────────────────

let flushTimer = null
let flushing = false
let pollTimer = null
let socket = null
let socketRetry = 1000
let pulling = null
let started = false

function scheduleFlush(ms = 400) {
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, ms)
}

export async function flush() {
  if (flushing || !state.outbox.length || !state.device) return
  flushing = true
  setState({ syncing: true })
  try {
    const batch = state.outbox.slice(0, 100)
    const res = await api.post('/pos-api/events', { events: batch }, { timeoutMs: 20000 })
    const answered = new Set(res.results.map(r => r.id))
    const confirmed = { ...state.confirmed }
    for (const o of res.kitchen || []) confirmed[o.id] = o
    for (const r of res.results.filter(x => !x.ok)) {
      // Another screen got there first: nothing to tell the cook.
      if (['nothing', 'duplicate'].includes(r.code)) continue
      toast('Not saved: ' + r.error, 'bad', 6000)
    }
    const outbox = state.outbox.filter(e => !answered.has(e.id))
    setState({ confirmed, outbox, online: true })
    await keep.set(OUTBOX_KEY, outbox)
    await pull()
  } catch (err) {
    handleError(err)
  } finally {
    flushing = false
    setState({ syncing: false })
    if (state.outbox.length && state.online) scheduleFlush(1500)
  }
}

const isFresh = (o, now) => o.status === 'active' || (Date.parse(now) - Date.parse(o.updated_at || o.created_at || 0) < STALE_HOURS * 3600_000)

/**
 * Orders with dishes new to this station (for the beep and flash): sent
 * straight here, passed on from an earlier station, or (when it shows them)
 * newly on their way.
 */
function newArrivals(before, after) {
  const cur = currentStation()
  if (!cur) return []
  const cfg = kitchenCfg()
  const st = cfg.stations[cur.id] || cur
  const early = stationSettings(st).show_upcoming
  const now = nowIso()
  const here = o => new Set((o?.items || []).filter(i => {
    const s = nodeState(i, st.id, cfg, now)
    return s === 'active' || (early && s === 'upcoming')
  }).map(i => i.id))
  const out = []
  for (const o of Object.values(after)) {
    if (o.status !== 'active') continue
    const was = here(before[o.id])
    if ([...here(o)].some(id => !was.has(id))) out.push(o.id)
  }
  return out
}

export async function pull() {
  if (!state.device) return
  if (pulling) return pulling
  pulling = (async () => {
    const sent = Date.now()
    try {
      const res = await api.get('/pos-api/kitchen/sync?since=' + (state.seq || 0))
      const rtt = Date.now() - sent
      const offset = res.server_time ? Date.parse(res.server_time) + rtt / 2 - Date.now() : state.offset
      let confirmed = res.reset ? {} : { ...state.confirmed }
      for (const o of res.orders || []) confirmed[o.id] = o
      const now = new Date(Date.now() + offset).toISOString()
      confirmed = Object.fromEntries(Object.entries(confirmed).filter(([, o]) => isFresh(o, now)))
      const arrivals = state.lastSync ? newArrivals(state.confirmed, confirmed) : []
      const alerts = { ...state.alerts }
      for (const id of arrivals) alerts[id] = Date.now()
      setState({ confirmed, seq: res.seq, offset, online: true, lastSync: Date.now(), alerts })
      if (arrivals.length) chime()
      saveSnapshot()
    } catch (err) {
      handleError(err)
    } finally {
      pulling = null
    }
  })()
  return pulling
}

let snapTimer = null
function saveSnapshot() {
  clearTimeout(snapTimer)
  snapTimer = setTimeout(() => keep.set(SNAPSHOT_KEY, { seq: state.seq, orders: state.confirmed, offset: state.offset }), 600)
}

function onMessage(m) {
  if (m.type === 'pos.seq' && m.from !== state.device?.id && (!m.kinds || m.kinds.includes('kitchen'))) pull()
  else if (m.type === 'pos.config') loadConfig()
  else if (m.type === 'pos.revoked' && m.device_id === state.device?.id) forget('This screen was removed in Till setup.')
}

function connectSocket() {
  if (bench) {
    // The bench tells its screens about changes straight away.
    bench.subscribe(onMessage)
    setState({ socket: 'open' })
    return
  }
  const url = api.socketUrl()
  if (!url || socket) return
  try { socket = new WebSocket(url) } catch { socket = null; return }
  setState({ socket: 'connecting' })
  socket.onopen = () => { socketRetry = 1000; setState({ socket: 'open' }); pull() }
  socket.onmessage = msg => {
    let m
    try { m = JSON.parse(msg.data) } catch { return }
    onMessage(m)
  }
  socket.onclose = () => {
    socket = null
    setState({ socket: 'closed' })
    if (state.device && started) setTimeout(connectSocket, socketRetry = Math.min(socketRetry * 2, 30000))
  }
  socket.onerror = () => { try { socket?.close() } catch { /* ignore */ } }
}

function tick() {
  if (!state.device) return
  if (state.outbox.length) flush()
  else pull()
}

function startSync() {
  if (started) return
  started = true
  window.addEventListener('online', () => { setState({ online: true }); tick() })
  window.addEventListener('offline', () => setState({ online: false }))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); loadConfig() } })
  connectSocket()
  const loop = () => {
    // Without the socket ask every 3 s; with it every 20 s as a check.
    const ms = state.socket === 'open' ? 20000 : 3000
    pollTimer = setTimeout(() => { tick(); loop() }, ms)
  }
  loop()
  setInterval(loadConfig, 10 * 60 * 1000)
  tick()
}

function stopSync() {
  started = false
  clearTimeout(pollTimer)
  try { socket?.close() } catch { /* ignore */ }
  socket = null
}

// ── Sound ────────────────────────────────────────────────────────

let audio = null
/** Browsers only play sound after a tap: the first tap on the screen unlocks it. */
export function unlockAudio() {
  if (audio) return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) audio = new Ctx()
  } catch { audio = null }
}

export function chime() {
  if (state.config?.device?.settings?.sound === false || !audio) return
  try {
    const t = audio.currentTime
    for (const [i, f] of [880, 1320].entries()) {
      const o = audio.createOscillator()
      const g = audio.createGain()
      o.frequency.value = f
      o.type = 'sine'
      g.gain.setValueAtTime(0.0001, t + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.4, t + i * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16)
      o.connect(g).connect(audio.destination)
      o.start(t + i * 0.18)
      o.stop(t + i * 0.18 + 0.18)
    }
  } catch { /* no sound */ }
}
