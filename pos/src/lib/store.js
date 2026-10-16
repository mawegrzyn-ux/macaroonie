// The till's state (docs/POS.md).
//
// Local first: every tap becomes an event that is checked with the shared
// check rules (shared/pos/checks.js), applied to the screen at once and kept
// in an outbox on the device (IndexedDB). The outbox is sent in the
// background; the sequencer's answer (cloud now, venue hub later) replaces
// the till's copy of each check. An event refused there (another till got
// there first while this one was offline) comes back as a conflict and is
// shown to the person; a manager sees them in Till reports.
//
//   confirmed  checks as the sequencer has them (last sync)
//   outbox     events not yet accepted, in order
//   checks     confirmed + outbox applied: what the screens show

import { useSyncExternalStore } from 'react'
import { applyEvent, eventProblem, CHECK_EVENTS, checksTouched } from '@shared/pos/checks.js'
import { permissionProblem } from '@shared/pos/permissions.js'
import { jobsForEvent, billOps } from '@shared/pos/printing.js'
import { hashPin } from '@shared/pos/pin.js'
import { ulid } from '@shared/pos/ids.js'
import * as idb from './idb.js'
import { createTransport, OfflineError } from './transport.js'
import { printTickets } from './print.js'

const OUTBOX_KEY = 'outbox'
const SNAPSHOT_KEY = 'snapshot'
const CONFIG_KEY = 'config'
const DEVICE_KEY = 'device'
const COUNTER_KEY = 'local_no'
const PREFS_KEY = 'maca_till_prefs'

// ── State ────────────────────────────────────────────────────────

let state = {
  phase: 'loading',        // 'loading' | 'pair' | 'ready' | 'kitchen' (a kitchen screen: src/kitchen)
  device: null,            // { id, secret, name, short_code, venue_id, venue_name }
  config: null,
  confirmed: {},
  outbox: [],
  seq: 0,
  day: null,
  presence: [],
  online: navigator.onLine,
  syncing: false,
  lastSync: null,
  staff: null,             // the signed-in person
  conflicts: [],           // refused events this session
  toasts: [],
  socket: 'closed',
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
export function useTill() { return useSyncExternalStore(subscribe, getState) }

function loadPrefs() {
  try { return { print_bills: true, print_kitchen: false, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) } }
  catch { return { print_bills: true, print_kitchen: false } }
}
export function setPrefs(patch) {
  const prefs = { ...state.prefs, ...patch }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  setState({ prefs })
}

// ── Toasts ───────────────────────────────────────────────────────

export function toast(text, kind = 'info', ms = kind === 'ok' ? 2200 : 4000) {
  const id = ulid()
  setState({ toasts: [...state.toasts, { id, text, kind }].slice(-2) })
  setTimeout(() => setState({ toasts: state.toasts.filter(t => t.id !== id) }), ms)
}

// ── Derived ──────────────────────────────────────────────────────

export function staffById(config = state.config) {
  return Object.fromEntries((config?.staff || []).map(s => [s.id, s]))
}

let derived = { confirmed: null, outbox: null, config: null, checks: {} }
/** Every check as the screens should show it. */
export function currentChecks(s = state) {
  if (derived.confirmed === s.confirmed && derived.outbox === s.outbox && derived.config === s.config) return derived.checks
  let checks = { ...s.confirmed }
  const ctx = { staffById: staffById(s.config) }
  for (const e of s.outbox) {
    if (!CHECK_EVENTS.includes(e.type)) continue
    const r = applyEvent(checks, e, ctx)
    if (r.ok) checks = { ...checks, ...r.checks }
  }
  derived = { confirmed: s.confirmed, outbox: s.outbox, config: s.config, checks }
  return checks
}
export function useChecks() {
  const s = useTill()
  return currentChecks(s)
}

export function printConfig(config = state.config, device = state.device) {
  if (!config) return {}
  const by = (rows, f = r => r) => Object.fromEntries((rows || []).map(r => [r.id, f(r)]))
  return {
    venue: { name: config.venue?.name },
    settings: config.settings,
    printers: by(config.printers),
    routes: config.routes || [],
    tables: by(config.tables, t => ({ label: t.label })),
    staff: by(config.staff, s => ({ name: s.name })),
    courses: by(config.courses),
    devices: device ? { [device.id]: { receipt_printer_id: config.device?.settings?.receipt_printer_id || null } } : {},
  }
}

// ── Startup ──────────────────────────────────────────────────────

export async function boot() {
  const device = await idb.get(DEVICE_KEY)
  if (!device?.id) { setState({ phase: 'pair' }); return }
  // Paired as a kitchen screen: the kitchen app (src/kitchen) takes over.
  if (device.kind === 'kds') { setState({ device, phase: 'kitchen' }); return }
  api = createTransport(device)
  const [config, snapshot, outbox] = await Promise.all([idb.get(CONFIG_KEY), idb.get(SNAPSHOT_KEY), idb.get(OUTBOX_KEY)])
  setState({
    device, config: config || null,
    confirmed: snapshot?.checks || {}, seq: snapshot?.seq || 0, day: snapshot?.day || null,
    outbox: outbox || [],
    phase: config ? 'ready' : 'loading',
  })
  await loadConfig()
  if (!state.config) {
    setState({ phase: 'ready' })   // shows the "can't reach" screen
    return
  }
  setState({ phase: 'ready' })
  startSync()
}

export async function pair(code) {
  const t = createTransport(null)
  const res = await t.post('/pos-api/pair', { code, app_version: '1.0.0', user_agent: navigator.userAgent.slice(0, 280) })
  const device = { id: res.device_id, secret: res.secret, name: res.name, kind: res.kind || 'terminal', short_code: res.short_code, venue_id: res.venue_id, venue_name: res.venue_name }
  await Promise.all([idb.set(DEVICE_KEY, device), idb.del(SNAPSHOT_KEY), idb.del(CONFIG_KEY), idb.set(OUTBOX_KEY, [])])
  setState({ device, confirmed: {}, outbox: [], seq: 0, config: null, phase: 'loading' })
  await boot()
}

/** Forget the pairing (the till must be paired again). Unsent events are kept on the device until then. */
export async function unpair() {
  stopSync()
  await Promise.all([idb.del(DEVICE_KEY), idb.del(CONFIG_KEY), idb.del(SNAPSHOT_KEY)])
  setState({ device: null, config: null, confirmed: {}, seq: 0, staff: null, phase: 'pair' })
}

export async function loadConfig() {
  try {
    const v = state.config?.version
    const res = await api.get('/pos-api/config' + (v ? '?version=' + encodeURIComponent(v) : ''))
    if (!res.unchanged) {
      await idb.set(CONFIG_KEY, res)
      setState({ config: res, online: true })
      // Someone signed in whose role or PIN changed: refresh them.
      if (state.staff) {
        const s = res.staff.find(x => x.id === state.staff.id)
        setState({ staff: s && s.pin_hash ? s : null })
      }
    } else {
      setState({ online: true })
    }
  } catch (err) {
    handleError(err)
  }
}

function handleError(err) {
  if (err instanceof OfflineError || err?.offline) { setState({ online: false }); return }
  if (err?.status === 401) {
    toast('This till was removed in Till setup. Pair it again.', 'bad', 8000)
    unpair()
    return
  }
  if (err?.status === 403 && err.code === 'pos_off') { toast(err.message, 'bad', 8000); return }
  console.warn(err)
}

// ── Sign in ──────────────────────────────────────────────────────

let idleTimer = null
export async function signIn(pin) {
  const s = await staffForPin(pin)
  if (!s) return { ok: false, error: 'PIN not recognised' }
  setState({ staff: s })
  touch()
  return { ok: true, staff: s }
}
export function signOut() {
  setState({ staff: null })
  setPresence(null)
}
let lastPinRefresh = 0
/**
 * The person with this PIN. A PIN this till doesn't know may have been set
 * since it last loaded its config, so on a miss it asks for the latest
 * config (when online, at most every 5 s) and looks again.
 */
export async function staffForPin(pin) {
  if (!state.config || !/^[0-9]{4,6}$/.test(pin)) return null
  const find = async cfg => {
    const hash = await hashPin(pin, cfg.pin_salt)
    return cfg.staff.find(s => s.pin_hash && s.pin_hash === hash) || null
  }
  const found = await find(state.config)
  if (found || state.online === false || Date.now() - lastPinRefresh < 5000) return found
  lastPinRefresh = Date.now()
  const before = state.config.version
  await loadConfig()
  return state.config.version !== before ? find(state.config) : null
}
/** Reset the auto sign-out timer (settings.auto_logout_secs, 0 = never). */
export function touch() {
  const secs = Number(state.config?.settings?.auto_logout_secs) || 0
  clearTimeout(idleTimer)
  if (secs > 0 && state.staff) idleTimer = setTimeout(signOut, secs * 1000)
}

// ── Making events ────────────────────────────────────────────────

function nextProvisionalNo() {
  let n = 0
  try { n = Number(localStorage.getItem(COUNTER_KEY)) || 0 } catch { /* ignore */ }
  n = n >= 9999 ? 1 : n + 1
  try { localStorage.setItem(COUNTER_KEY, String(n)) } catch { /* ignore */ }
  return (state.device?.short_code || 'T') + '-' + String(n).padStart(4, '0')
}

function makeEvent(type, payload, { check_id = null, approved_by = null, staff_id = null } = {}) {
  const p = { ...(payload || {}) }
  if (type === 'check.opened' && !p.provisional_no) p.provisional_no = nextProvisionalNo()
  return {
    id: ulid(), venue_id: state.device?.venue_id, device_id: state.device?.id,
    staff_id: staff_id || state.staff?.id, approved_by: approved_by || null,
    check_id, type, payload: p, client_at: new Date().toISOString(),
  }
}

/**
 * Make one or more events in one go: each is checked against the state the
 * ones before it leave; if any is refused, none is kept.
 * specs: [[type, payload, opts], ...]. Returns { ok, events, checks } or { ok: false, error, code }.
 */
export function dispatchMany(specs) {
  if (!state.staff) return { ok: false, error: 'Sign in first' }
  let checks = currentChecks()
  const before = checks
  const ctx = { staffById: staffById() }
  const events = []
  for (const [type, payload, opts] of specs) {
    const e = makeEvent(type, payload, opts)
    if (CHECK_EVENTS.includes(type)) {
      const r = applyEvent(checks, e, ctx)
      if (!r.ok) return { ok: false, error: r.error, code: r.code }
      checks = { ...checks, ...r.checks }
    } else {
      const why = eventProblem(e)
      if (why) return { ok: false, error: why }
      const need = type === 'drawer.opened' ? 'open_drawer' : type === 'day.closed' ? 'close_day' : null
      const no = need && permissionProblem(ctx.staffById, e, need)
      if (no) return { ok: false, error: no, code: 'permission' }
    }
    events.push(e)
  }
  const outbox = [...state.outbox, ...events]
  setState({ outbox })
  idb.set(OUTBOX_KEY, outbox)
  touch()
  printLocally(events, before, checks)
  scheduleFlush(0)
  return { ok: true, events, checks }
}

export function dispatch(type, payload, opts = {}) {
  return dispatchMany([[type, payload, opts]])
}

// Bills, receipts and (if this till prints for the kitchen) tickets, in the
// browser, from the same shared code the sequencer uses for its print jobs.
function printLocally(events, before, after) {
  const prefs = state.prefs
  if (!prefs.print_bills && !prefs.print_kitchen) return
  const cfg = printConfig()
  const tickets = []
  let prev = before
  for (const e of events) {
    const ids = checksTouched(e)
    const was = Object.fromEntries(ids.filter(id => prev[id]).map(id => [id, prev[id]]))
    const now = Object.fromEntries(ids.filter(id => after[id]).map(id => [id, after[id]]))
    if (prefs.print_bills) {
      if (e.type === 'bill.printed' && now[e.check_id]) {
        tickets.push(billOps(now[e.check_id], cfg, { preBill: now[e.check_id].status === 'open' }))
      }
      if (e.type === 'check.closed' && e.payload?.print_receipt && now[e.check_id]) tickets.push(billOps(now[e.check_id], cfg))
    }
    if (prefs.print_kitchen) {
      for (const j of jobsForEvent(e, was, now, cfg)) if (['kitchen', 'fire', 'void'].includes(j.kind)) tickets.push(j.ops)
    }
    prev = { ...prev, ...now }
  }
  printTickets(tickets)
}

/** Print the bill or receipt of a check here, without an event (reprint). */
export function printBill(check, { preBill = false } = {}) {
  printTickets([billOps(check, printConfig(), { preBill })])
}

// ── Manager approval ─────────────────────────────────────────────

/** Someone with this permission (and the right to approve) by PIN, or an error. */
export async function approverFor(pin, key, amount = null) {
  const s = await staffForPin(pin)
  if (!s) return { ok: false, error: 'PIN not recognised' }
  const fake = { staff_id: state.staff?.id, approved_by: s.id }
  if (permissionProblem(staffById(), fake, key, amount)) return { ok: false, error: s.name + ' can\'t approve this' }
  return { ok: true, staff: s }
}

// ── Sold out ─────────────────────────────────────────────────────

/** Dishes sold out now: Map(item id -> until ISO | null). From the config (services/soldOut.js). */
export function soldOutMap(config = state.config) {
  const out = new Map()
  const t = Date.now()
  for (const s of config?.sold_out || []) {
    if (!s.until || Date.parse(s.until) > t) out.set(s.item_id, s.until || null)
  }
  return out
}

/**
 * Mark a dish sold out ('today' | 'indefinite') or back on (false). Online
 * only: the website, the orders board and the menu screens change at once.
 * approvedBy = a manager's staff id when the person's role doesn't allow it.
 */
export async function setItemSoldOut(itemId, mode, approvedBy = null) {
  if (!state.staff) return { ok: false, error: 'Sign in first' }
  try {
    await api.put('/pos-api/sold-out/' + itemId, { sold_out: mode, staff_id: state.staff.id, approved_by: approvedBy || null })
    await loadConfig()
    return { ok: true }
  } catch (err) {
    if (err instanceof OfflineError || err?.offline) return { ok: false, error: 'Needs a connection: try again when the till is online' }
    return { ok: false, error: err.message || 'Couldn\'t change it' }
  }
}

export function can(key, amount = null) {
  if (!state.staff) return false
  return !permissionProblem(staffById(), { staff_id: state.staff.id }, key, amount)
}

// ── Sync ─────────────────────────────────────────────────────────

let flushTimer = null
let flushing = false
let pollTimer = null
let socket = null
let socketRetry = 1000
let pulling = null

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
    const refused = res.results.filter(r => !r.ok)
    const confirmed = { ...state.confirmed }
    for (const c of res.checks || []) confirmed[c.id] = c
    const outbox = state.outbox.filter(e => !answered.has(e.id))
    const conflicts = [...state.conflicts]
    for (const r of refused) {
      const e = batch.find(x => x.id === r.id)
      conflicts.unshift({ id: r.id, type: e?.type, check_id: e?.check_id, error: r.error, code: r.code, at: new Date().toISOString() })
      toast('Not saved: ' + r.error, 'bad', 7000)
    }
    setState({ confirmed, outbox, conflicts: conflicts.slice(0, 50), online: true })
    await idb.set(OUTBOX_KEY, outbox)
    await pull()
  } catch (err) {
    handleError(err)
    // The retry depends on the connection coming back (poll / online event).
  } finally {
    flushing = false
    setState({ syncing: false })
    if (state.outbox.length && state.online) scheduleFlush(1000)
  }
}

export async function pull() {
  if (!state.device) return
  if (pulling) return pulling
  pulling = (async () => {
    try {
      const res = await api.get('/pos-api/sync?since=' + (state.seq || 0))
      let confirmed = res.reset ? {} : { ...state.confirmed }
      for (const c of res.checks || []) confirmed[c.id] = c
      // Keep open checks, this trading day's, and any opened from Closed checks; drop older closed ones.
      const dayId = res.day?.id || null
      confirmed = Object.fromEntries(Object.entries(confirmed).filter(([id, c]) => c.status === 'open' || (dayId && c.day_id === dayId) || pinned.has(id)))
      setState({ confirmed, seq: res.seq, day: res.day, presence: res.presence || [], online: true, lastSync: Date.now() })
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
  snapTimer = setTimeout(() => idb.set(SNAPSHOT_KEY, { seq: state.seq, checks: state.confirmed, day: state.day }), 500)
}

function connectSocket() {
  const url = api.socketUrl()
  if (!url || socket) return
  try {
    socket = new WebSocket(url)
  } catch {
    socket = null
    return
  }
  setState({ socket: 'connecting' })
  socket.onopen = () => { socketRetry = 1000; setState({ socket: 'open' }) }
  socket.onmessage = msg => {
    let m
    try { m = JSON.parse(msg.data) } catch { return }
    // Kitchen-only changes (a bump on a kitchen screen) don't change checks.
    if (m.type === 'pos.seq' && m.from !== state.device?.id && (!m.kinds || m.kinds.includes('checks'))) pull()
    else if (m.type === 'pos.presence') pull()
    else if (m.type === 'pos.config') loadConfig()
    else if (m.type === 'pos.revoked' && m.device_id === state.device?.id) { toast('This till was removed in Till setup.', 'bad', 8000); unpair() }
  }
  socket.onclose = () => {
    socket = null
    setState({ socket: 'closed' })
    if (state.device) setTimeout(connectSocket, socketRetry = Math.min(socketRetry * 2, 30000))
  }
  socket.onerror = () => { try { socket?.close() } catch { /* ignore */ } }
}

function tick() {
  if (!state.device) return
  if (state.outbox.length) flush()
  else pull()
}

let started = false
export function startSync() {
  if (started) return
  started = true
  window.addEventListener('online', () => { setState({ online: true }); tick() })
  window.addEventListener('offline', () => setState({ online: false }))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); loadConfig() } })
  connectSocket()
  const loop = () => {
    // Without the push socket, ask every 4 s; with it, every 30 s as a check.
    const ms = state.socket === 'open' ? 30000 : 4000
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

// ── Presence (who has a check open) ──────────────────────────────

let presenceCheck = null
let presenceTimer = null
export function setPresence(checkId) {
  presenceCheck = checkId
  clearInterval(presenceTimer)
  const send = () => api.post('/pos-api/presence', { check_id: presenceCheck, staff_id: state.staff?.id || null })
    .then(r => setState({ presence: r.presence || [] })).catch(() => {})
  send()
  if (checkId) presenceTimer = setInterval(send, 20000)
}

/** Other tills that have this check open now. */
export function othersOn(checkId) {
  return (state.presence || []).filter(p => p.check_id === checkId && p.device_id !== state.device?.id)
}

// ── Reads the till asks the server for ───────────────────────────

const pinned = new Set()
/** Load an older closed check (reprint, reopen, refund) and keep it on this till for now. */
export async function loadCheck(id) {
  const c = await api.get('/pos-api/checks/' + id)
  pinned.add(id)
  setState({ confirmed: { ...state.confirmed, [id]: c } })
  return c
}

export const server = {
  closedChecks: () => api.get('/pos-api/checks?status=closed&limit=100'),
  check: id => api.get('/pos-api/checks/' + id),
  dayReport: dayId => api.get('/pos-api/reports/day' + (dayId ? '?day_id=' + dayId : '')),
  days: () => api.get('/pos-api/days'),
  printJobs: status => api.get('/pos-api/print-jobs?status=' + (status || 'queued')),
  printJobDone: (id, status) => api.post('/pos-api/print-jobs/' + id + '/status', { status }),
}
