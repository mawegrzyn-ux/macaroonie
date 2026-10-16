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

import { useSyncExternalStore } from 'react'
import { applyKitchenEvent, stationSettings, STALE_HOURS } from '@shared/pos/kitchen.js'
import { ulid } from '@shared/pos/ids.js'
import * as idb from '../lib/idb.js'
import { createTransport, OfflineError } from '../lib/transport.js'

const CONFIG_KEY = 'kds_config'
const SNAPSHOT_KEY = 'kds_snapshot'
const OUTBOX_KEY = 'kds_outbox'
const PREFS_KEY = 'maca_kds_prefs'

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
  try { return { ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) } } catch { return {} }
}
export function setPrefs(patch) {
  const prefs = { ...state.prefs, ...patch }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  setState({ prefs })
}

export function toast(text, kind = 'info', ms = 3500) {
  const id = ulid()
  setState({ toasts: [...state.toasts, { id, text, kind }].slice(-3) })
  setTimeout(() => setState({ toasts: state.toasts.filter(t => t.id !== id) }), ms)
}

// ── Config ───────────────────────────────────────────────────────

/** Stations this screen may show (device settings), in setup order. */
export function myStations(s = state) {
  const all = s.config?.stations || []
  const ids = s.config?.device?.settings?.station_ids || []
  const mine = ids.length ? all.filter(x => ids.includes(x.id)) : all
  return mine.length ? mine : all
}

/** The station on screen now (remembered per device). */
export function currentStation(s = state) {
  const list = myStations(s)
  return list.find(x => x.id === s.prefs.station_id) || list[0] || null
}

/** The kitchen config the shared rules need for this screen's own taps. */
function kitchenCfg(config) {
  const stations = Object.fromEntries((config?.stations || []).map(x => [x.id, { ...x, settings: stationSettings(x) }]))
  return { enabled: true, expo: (config?.stations || []).some(x => x.kind === 'expo'), stations, routes: [] }
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

export async function bootKitchen(device) {
  api = createTransport(device)
  const [config, snapshot, outbox] = await Promise.all([idb.get(CONFIG_KEY), idb.get(SNAPSHOT_KEY), idb.get(OUTBOX_KEY)])
  setState({
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
      await idb.set(CONFIG_KEY, res)
      setState({ config: res, online: true })
    } else setState({ online: true })
  } catch (err) {
    handleError(err)
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
  stopSync()
  await Promise.all([idb.del('device'), idb.del(CONFIG_KEY), idb.del(SNAPSHOT_KEY)])
  setTimeout(() => location.reload(), 3000)
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
  idb.set(OUTBOX_KEY, outbox)
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
    await idb.set(OUTBOX_KEY, outbox)
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

/** Keys of tickets this station hasn't seen yet (for the beep and flash). */
function newArrivals(before, after) {
  const st = currentStation()
  if (!st) return []
  const key = o => o.id + ':' + o.items.filter(i => st.kind === 'expo' || i.stations.includes(st.id)).length + ':' + (o.items.filter(i => i.fired_at).length)
  const out = []
  for (const o of Object.values(after)) {
    if (o.status !== 'active') continue
    const was = before[o.id]
    if (!was || key(was) !== key(o)) {
      const mine = o.items.some(i => st.kind === 'expo' || i.stations.includes(st.id))
      if (mine) out.push(o.id)
    }
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
  snapTimer = setTimeout(() => idb.set(SNAPSHOT_KEY, { seq: state.seq, orders: state.confirmed, offset: state.offset }), 600)
}

function connectSocket() {
  const url = api.socketUrl()
  if (!url || socket) return
  try { socket = new WebSocket(url) } catch { socket = null; return }
  setState({ socket: 'connecting' })
  socket.onopen = () => { socketRetry = 1000; setState({ socket: 'open' }); pull() }
  socket.onmessage = msg => {
    let m
    try { m = JSON.parse(msg.data) } catch { return }
    if (m.type === 'pos.seq' && m.from !== state.device?.id && (!m.kinds || m.kinds.includes('kitchen'))) pull()
    else if (m.type === 'pos.config') loadConfig()
    else if (m.type === 'pos.revoked' && m.device_id === state.device?.id) forget('This screen was removed in Till setup.')
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
