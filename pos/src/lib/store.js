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
import { applyEvent, eventProblem, CHECK_EVENTS } from '@shared/pos/checks.js'
import { permissionProblem, managerProblem } from '@shared/pos/permissions.js'
import { billOps, receiptHere } from '@shared/pos/printing.js'
import { hashPin } from '@shared/pos/pin.js'
import { ulid } from '@shared/pos/ids.js'
import { soldOutMap as sharedSoldOutMap } from '@shared/pos/offers.js'
import * as idb from './idb.js'
import { createTransport, OfflineError, APP_VERSION } from './transport.js'
import { printTickets } from './print.js'
import { startDevicePrinting, hasOwnPrinter } from './devicePrint.js'
import { checkForUpdate } from './appUpdate.js'
import { HOST_APP, takePairCode, movedTo, setMovedTo, moveDevice, tellDisconnect } from './appHost.js'
import { withLive, pricesChanged, keepStorage, createPullTimers } from './livePull.js'
import { takeNumbers, keepServerNumbers } from './numbers.js'

const OUTBOX_KEY = 'outbox'
// v170: checks gained order types and revenue streams (migration 170); an older snapshot is dropped and pulled again.
const SNAPSHOT_KEY = 'snapshot-170'
const CONFIG_KEY = 'config'
const DEVICE_KEY = 'device'
const PREFS_KEY = 'maca_till_prefs'

// ── State ────────────────────────────────────────────────────────

let state = {
  phase: 'loading',        // 'loading' | 'pair' | 'ready' | 'kitchen' (a kitchen screen: src/kitchen) | 'kiosk' (src/kiosk)
                           // | 'moved' (this address's device moved to its own address: lib/appHost.js)
  pairCode: null,          // a code handed over by a move (#pair=), typed in by itself
  movedTo: null,
  device: null,            // { id, secret, name, short_code, venue_id, venue_name }
  config: null,
  confirmed: {},
  outbox: [],
  seq: 0,
  seqSource: null,         // where seq came from: 'cloud' or the venue hub ('hub:<id>'); another source starts again
  hub: null,               // the venue hub (hub first, lib/transport.js): true in use, false not answering, null none
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
  checked: null,           // { content, live }: when the whole config and prices / sold out were last pulled (lib/livePull.js)
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
  try { return { print_bills: true, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) } }
  catch { return { print_bills: true } }
}
export function setPrefs(patch) {
  const prefs = { ...state.prefs, ...patch }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  setState({ prefs })
}

// ── Toasts ───────────────────────────────────────────────────────

/** A short message at the bottom; `action` { label, run } adds a button (e.g. Undo). */
export function toast(text, kind = 'info', ms = kind === 'ok' ? 2200 : 4000, action = null) {
  const id = ulid()
  const dismiss = () => setState({ toasts: state.toasts.filter(t => t.id !== id) })
  const act = action ? { label: action.label, run: () => { dismiss(); action.run() } } : null
  setState({ toasts: [...state.toasts, { id, text, kind, action: act }].slice(-2) })
  setTimeout(dismiss, ms)
}

// ── Derived ──────────────────────────────────────────────────────

export function staffById(config = state.config) {
  return Object.fromEntries((config?.staff || []).map(s => [s.id, s]))
}

/** The name of whoever has a check: a person, or the kiosk that took the order. */
export function serverName(config, id) {
  if (!id) return null
  return (config?.staff || []).find(s => s.id === id)?.name
    || (config?.devices || []).find(d => d.id === id)?.name || null
}

let derived = { confirmed: null, outbox: null, config: null, checks: {} }
/** Every check as the screens should show it. */
export function currentChecks(s = state) {
  if (derived.confirmed === s.confirmed && derived.outbox === s.outbox && derived.config === s.config) return derived.checks
  let checks = { ...s.confirmed }
  const ctx = { staffById: staffById(s.config), settings: s.config?.settings || null }
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
    tables: by(config.tables, t => ({ label: t.label })),
    // A kiosk order's server is the kiosk (shared/kiosk.js).
    staff: { ...by((config.devices || []).filter(d => d.kind === 'kiosk'), d => ({ name: d.name })), ...by(config.staff, s => ({ name: s.name })) },
    courses: by(config.courses),
    order_types: by(config.order_types, t => ({ name: t.name })),
    devices: device ? { [device.id]: { receipt_printer_id: config.device?.settings?.receipt_printer_id || null } } : {},
    layouts: config.print_layouts || {},
  }
}

// ── Startup ──────────────────────────────────────────────────────

export async function boot() {
  const device = await idb.get(DEVICE_KEY)
  const handed = takePairCode()
  if (!device?.id) {
    // Moved here from another address: pair with the code it brought.
    if (handed) { setState({ phase: 'pair', pairCode: handed }); return }
    // This address's device moved to its own: an old start page still finds it.
    const to = movedTo()
    if (to && HOST_APP) { setState({ phase: 'moved', movedTo: to }); return }
    setState({ phase: 'pair' })
    return
  }
  if (openOtherApp(device)) return
  api = createTransport(device, {
    pending: () => state.outbox.length,
    hub: () => state.config?.hub || null,
    onHub: h => { setState({ hub: h.ok }); if (h.ok) pull() },
  })
  keepStorage()
  const [config, snapshot, outbox] = await Promise.all([idb.get(CONFIG_KEY), idb.get(SNAPSHOT_KEY), idb.get(OUTBOX_KEY)])
  if (config?.device?.kind && config.device.kind !== (device.kind || 'terminal')) { await relabel(device, config.device.kind); return }
  setState({
    device, config: config || null,
    confirmed: snapshot?.checks || {}, seq: snapshot?.seq || 0, seqSource: snapshot?.source || null, day: snapshot?.day || null,
    outbox: outbox || [],
    phase: config ? 'ready' : 'loading',
  })
  await loadConfig()
  if (OTHER_APPS.includes(state.phase)) return
  if (!state.config) {
    setState({ phase: 'ready' })   // shows the "can't reach" screen
    return
  }
  setState({ phase: 'ready' })
  startSync()
}

const OTHER_APPS = ['kitchen', 'kiosk', 'update']

/**
 * A device paired as a kitchen screen runs the kitchen app (src/kitchen), a
 * self-order kiosk the kiosk app (src/kiosk). A kind this copy of the app
 * doesn't know waits for a newer copy (lib/appUpdate.js): never run it as a till.
 */
function openOtherApp(device) {
  if (device.kind === 'kds') { setState({ device, phase: 'kitchen' }); return true }
  if (device.kind === 'kiosk') { setState({ device, phase: 'kiosk' }); return true }
  if (device.kind && device.kind !== 'terminal') {
    setState({ device, phase: 'update' })
    checkForUpdate()
    return true
  }
  return false
}

/**
 * The server knows this device as another kind than the one saved here (an
 * older copy of the app saved a kiosk as a till): save the right kind and
 * open its app. The till's copy of the config was that device's config.
 */
async function relabel(device, kind) {
  stopSync()
  const fixed = { ...device, kind }
  await Promise.all([idb.set(DEVICE_KEY, fixed), idb.del(CONFIG_KEY), idb.del(SNAPSHOT_KEY)])
  setState({ config: null, staff: null })
  openOtherApp(fixed)
}

/**
 * Pair with the one-time code a move brought (#pair=, POST /pos-api/move on
 * the old address). Nobody types codes: a device is set up by the code it
 * shows (requestLinkCode()). The address says what this device is
 * (lib/appHost.js); the server refuses a code for another kind.
 */
export async function pair(code) {
  const t = createTransport(null)
  const res = await t.post('/pos-api/pair', { code, app: HOST_APP || undefined, app_version: APP_VERSION, user_agent: navigator.userAgent.slice(0, 280) })
  await startPaired({ ...res, secret: res.secret })
}

async function startPaired(res) {
  setMovedTo(null)
  const device = { id: res.device_id, secret: res.secret, name: res.name, kind: res.kind || 'terminal', short_code: res.short_code, venue_id: res.venue_id, venue_name: res.venue_name }
  await Promise.all([idb.set(DEVICE_KEY, device), idb.del(SNAPSHOT_KEY), idb.del(CONFIG_KEY), idb.set(OUTBOX_KEY, [])])
  setState({ device, confirmed: {}, outbox: [], seq: 0, config: null, phase: 'loading' })
  await boot()
}

/**
 * A code this device shows (with a QR code to the installer app) until
 * someone signed in links it (migration 184): { id, code, secret,
 * expires_at, link_url }. The secret stays on this device; once linked the
 * device signs in with it.
 */
export async function requestLinkCode() {
  const t = createTransport(null)
  const device = {
    width: Math.round(window.screen?.width || window.innerWidth || 0),
    height: Math.round(window.screen?.height || window.innerHeight || 0),
    dpr: Math.min(10, Number(window.devicePixelRatio) || 1),
    ua: navigator.userAgent.slice(0, 300),
    app_version: APP_VERSION,
  }
  return t.post('/pos-api/pairings', { app: HOST_APP || undefined, device })
}

/**
 * Has the code been linked? 'waiting' | 'expired' | 'paired' (then this
 * device is set up and starts). A code the server no longer knows is expired.
 */
export async function checkLinkCode(p) {
  const t = createTransport(null)
  let res
  try {
    res = await t.get('/pos-api/pairings/' + encodeURIComponent(p.id), { headers: { Authorization: 'Pairing ' + p.secret } })
  } catch (err) {
    if (err.status === 404) return 'expired'
    throw err
  }
  if (res?.status !== 'paired') return res?.status === 'waiting' ? 'waiting' : 'expired'
  await startPaired({ ...res, secret: p.secret })
  return 'paired'
}

/** Forget the pairing: the setup screen shows a new code to link it again. Pairing again clears unsent events. */
export async function unpair() {
  stopSync()
  await Promise.all([idb.del(DEVICE_KEY), idb.del(CONFIG_KEY), idb.del(SNAPSHOT_KEY)])
  setState({ device: null, config: null, confirmed: {}, seq: 0, staff: null, phase: 'pair', pairCode: null })
}

/**
 * Disconnect this till (its settings): Macaroonie stops accepting its
 * pairing, then the till forgets it. Returns false when Macaroonie couldn't
 * be told (offline): the till still forgets itself.
 */
export async function disconnect() {
  const told = await tellDisconnect(api)
  await unpair()
  return told
}

/** Leave the "moved" screen and set this address up for a new device. */
export function stayHere() {
  setMovedTo(null)
  setState({ phase: 'pair', movedTo: null })
}

/**
 * A till paired on another device app's address moves to the till's own
 * (pos.{root}). Returns { ok: false, error } when it can't; otherwise the
 * page goes to the new address.
 */
export async function moveTill() {
  if (state.outbox.length) return { ok: false, error: state.outbox.length + ' changes haven\'t been sent yet: connect first' }
  const r = await moveDevice(api, 'terminal')
  if (!r.ok) return r
  setMovedTo(r.url)
  stopSync()
  await Promise.all([idb.del(DEVICE_KEY), idb.del(CONFIG_KEY), idb.del(SNAPSHOT_KEY)])
  r.go()
  return { ok: true }
}

export async function loadConfig() {
  try {
    const v = state.config?.version
    const res = await api.get('/pos-api/config' + (v ? '?version=' + encodeURIComponent(v) : ''))
    keepServerNumbers(state.device?.id, res.numbers)
    const kind = res.device?.kind
    if (kind && state.device && kind !== (state.device.kind || 'terminal')) { await relabel(state.device, kind); return }
    if (!res.unchanged) {
      await idb.set(CONFIG_KEY, res)
      setState({ config: res, online: true })
      pulls?.check()
      // Someone signed in whose role or PIN changed: refresh them.
      if (state.staff) {
        const s = res.staff.find(x => x.id === state.staff.id)
        setState({ staff: s && s.pin_hash ? s : null })
      }
    } else {
      setState({ online: true })
      // Unchanged, but sold out and the prices stamp travel with every reply.
      await applyLive(res, { prices: true })
      // So does the venue hub's address (hub first).
      if ('hub' in res && JSON.stringify(res.hub ?? null) !== JSON.stringify(state.config?.hub ?? null)) {
        const next = { ...state.config, hub: res.hub ?? null }
        setState({ config: next })
        await idb.set(CONFIG_KEY, next)
      }
    }
    setState({ checked: { ...state.checked, content: Date.now(), live: Date.now() } })
  } catch (err) {
    handleError(err)
  }
}

/** Lay a reply's sold out list (and prices stamp) over the config, kept on the device. */
async function applyLive(reply, opts) {
  const next = withLive(state.config, reply, opts)
  if (!next) return
  setState({ config: next })
  await idb.set(CONFIG_KEY, next)
}

/**
 * Prices and sold out (every config.pull.live, lib/livePull.js): sold out
 * changes in place; a new prices stamp fetches the config with the new prices.
 */
export async function pullLive() {
  if (!state.config || !state.device) return
  try {
    const res = await api.get('/pos-api/live', { timeoutMs: 10000 })
    const stale = pricesChanged(state.config, res)
    await applyLive(res, { prices: false })
    setState({ online: true, checked: { ...state.checked, live: Date.now() } })
    if (stale) await loadConfig()
  } catch (err) {
    handleError(err)
  }
}

function handleError(err) {
  if (err instanceof OfflineError || err?.offline) { setState({ online: false }); return }
  if (err?.status === 401) {
    toast('This till was removed in Store tech. Link it again with the code it shows.', 'bad', 8000)
    unpair()
    return
  }
  if (err?.status === 403 && err.code === 'pos_off') { toast(err.message, 'bad', 8000); return }
  console.warn(err)
}

// ── Sign in ──────────────────────────────────────────────────────

let idleTimer = null
export async function signIn(pin, opts) {
  const s = await staffForPin(pin, opts)
  if (!s) return { ok: false, error: 'PIN not recognised' }
  setState({ staff: s })
  touch()
  return { ok: true, staff: s }
}
export function signOut() {
  setState({ staff: null })
  setPresence(null)
}
// The config refresh a PIN this till doesn't know is waiting for (one at a
// time, shared by every try that misses meanwhile), and when the last ended.
let pinRefresh = null
let pinRefreshedAt = 0
export const PIN_REFRESH_GAP_MS = 1500
/**
 * The person with this PIN. A PIN this till doesn't know may have been set
 * since it last loaded its config (a push missed), so on a miss it asks for
 * the latest config when online and looks again. Tries while that request
 * is out wait for it. A quiet try (4 or 5 digits typed, the PIN may be
 * longer) asks at most every PIN_REFRESH_GAP_MS; a final one (OK, or 6
 * digits) always asks, so a PIN saved a moment ago is never turned away.
 */
export async function staffForPin(pin, { final = true } = {}) {
  if (!state.config || !/^[0-9]{4,6}$/.test(pin)) return null
  const find = async cfg => {
    const hash = await hashPin(pin, cfg.pin_salt)
    return (cfg.staff || []).find(s => s.pin_hash && s.pin_hash === hash) || null
  }
  const cfg = state.config
  const found = await find(cfg)
  if (found || state.online === false) return found
  // A newer config arrived while this PIN was being hashed.
  if (state.config !== cfg) return find(state.config)
  if (!pinRefresh) {
    if (!final && Date.now() - pinRefreshedAt < PIN_REFRESH_GAP_MS) return null
    pinRefresh = loadConfig().finally(() => { pinRefresh = null; pinRefreshedAt = Date.now() })
  }
  await pinRefresh
  return state.config !== cfg ? find(state.config) : null
}
/** Reset the auto sign-out timer (settings.auto_logout_secs, 0 = never). */
export function touch() {
  const secs = Number(state.config?.settings?.auto_logout_secs) || 0
  clearTimeout(idleTimer)
  if (secs > 0 && state.staff) idleTimer = setTimeout(signOut, secs * 1000)
}

// ── Making events ────────────────────────────────────────────────

function makeEvent(type, payload, { check_id = null, approved_by = null, staff_id = null } = {}) {
  const p = { ...(payload || {}) }
  // The till numbers its own checks (lib/numbers.js): T2-47, and a counter
  // order's number from its own range.
  if (type === 'check.opened' && p.number == null && state.device) Object.assign(p, takeNumbers(state.device, state.config, { counter: p.mode === 'counter', day: state.day?.business_date || null }))
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
  const ctx = { staffById: staffById(), settings: state.config?.settings || null }
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

// Bills and receipts in the browser, from the same shared code the
// sequencer uses for its print jobs: when this till has no receipt printer,
// or its receipt printer is plugged into it (receiptHere()). A receipt
// printer on the network or on another device gets a print job instead.
// Kitchen tickets come from the kitchen flow's printer boxes (migration 191).
function printLocally(events, before, after) {
  if (!state.prefs.print_bills) return
  const cfg = printConfig()
  if (!receiptHere(cfg, state.device?.id)) return
  const tickets = []
  for (const e of events) {
    const now = after[e.check_id]
    if (!now) continue
    if (e.type === 'bill.printed') tickets.push(billOps(now, cfg, { preBill: now.status === 'open' }))
    if (e.type === 'check.closed' && e.payload?.print_receipt) tickets.push(billOps(now, cfg))
  }
  printTickets(tickets)
}

// Printers plugged into this till (Store tech > Printers): it prints what is
// queued for them, kitchen tickets included (lib/devicePrint.js).
let devicePrinting = null
function ensureDevicePrinting() {
  if (devicePrinting || !state.device) return
  devicePrinting = startDevicePrinting({ post: (p, b, o) => api.post(p, b, o), onHub: () => api.onHub() }, () => hasOwnPrinter(state.config, state.device?.id))
}

/** Print the bill or receipt of a check here, without an event (reprint). */
export function printBill(check, { preBill = false } = {}) {
  printTickets([billOps(check, printConfig(), { preBill })])
}

// ── Manager approval ─────────────────────────────────────────────

/** What stops an event by `event.staff_id` (and its approver): the role's
 *  permission `key` (null = none) and the venue's manager switches `actions`
 *  (shared/pos/permissions.js). */
function doProblem(event, key, amount, actions = []) {
  const people = staffById()
  if (key && permissionProblem(people, event, key, amount)) return true
  return actions.some(a => managerProblem(people, event, a, state.config?.settings || null))
}

/** Someone with this permission (and the right to approve) by PIN, or an error. */
export async function approverFor(pin, key, amount = null, actions = [], opts) {
  const s = await staffForPin(pin, opts)
  if (!s) return { ok: false, error: 'PIN not recognised' }
  const fake = { staff_id: state.staff?.id, approved_by: s.id }
  if (doProblem(fake, key, amount, actions)) return { ok: false, error: s.name + ' can\'t approve this' }
  return { ok: true, staff: s }
}

// ── Sold out ─────────────────────────────────────────────────────

/** Dishes sold out now: Map(item id -> until ISO | null). From the config (services/soldOut.js). */
export function soldOutMap(config = state.config) {
  return sharedSoldOutMap(config)
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

// ── Card machine (migration 193) ─────────────────────────────────
// The server drives the till's card machine (config.card_machine) through
// its provider. Before a payment starts, the check's waiting events are sent
// so the server knows what is left to pay. A payment reaches the check as
// payment.added naming the approved attempt (card_payment_id): the
// sequencer refuses any other. Online only.

async function cardApi(method, path, body) {
  try {
    const opts = { timeoutMs: 30000 }
    const data = method === 'get' ? await api.get(path, opts) : await api.post(path, body, opts)
    return { ok: true, data }
  } catch (err) {
    if (err instanceof OfflineError || err?.offline) {
      handleError(err)
      return { ok: false, offline: true, error: 'The card machine needs a connection: take the card on another machine and use Card' }
    }
    return { ok: false, error: err.message || 'The card machine didn\'t answer', code: err.code || null, data: err.data || null }
  }
}

// ── Loyalty (migration 211) ──────────────────────────────────────────────
// Looking members up, joining and taking rewards out need the server; the
// member then goes on the check (check.member_set) and a reward's discount
// with its redemption id (discount.applied), checked by the sequencer.

async function loyaltyApi(path, body) {
  if (state.online === false) return { ok: false, offline: true, error: 'Loyalty needs a connection' }
  try {
    return { ok: true, data: await api.post(path, body, { timeoutMs: 15000 }) }
  } catch (err) {
    if (err instanceof OfflineError || err?.offline) {
      handleError(err)
      return { ok: false, offline: true, error: 'Loyalty needs a connection' }
    }
    return { ok: false, error: err.message || 'Loyalty didn\'t answer', code: err.code || null }
  }
}
/** { code } (a scanned card) or { q } (email, phone, name, member number). */
export const loyaltyLookup = body => loyaltyApi('/pos-api/loyalty/lookup', body)
export const loyaltyJoin = body => loyaltyApi('/pos-api/loyalty/members', { ...body, staff_id: state.staff?.id || null })
/** Take a reward out for this check: points come off the member now. */
export const loyaltyReserve = (check, member, reward) => loyaltyApi('/pos-api/loyalty/redemptions', {
  member_id: member.id, check_id: check.id, staff_id: state.staff?.id || null,
  ...(reward.member_reward_id ? { member_reward_id: reward.member_reward_id } : { reward_id: reward.reward_id }),
})
export const loyaltyRelease = id => loyaltyApi('/pos-api/loyalty/redemptions/' + id + '/release', {})

/** Send this check's waiting events (up to 12 s); true once none are left. */
async function sendCheck(checkId) {
  const until = Date.now() + 12000
  const waiting = () => state.outbox.some(e => e.check_id === checkId)
  while (waiting() && Date.now() < until && state.online !== false) {
    if (flushing) await new Promise(r => setTimeout(r, 200))
    else await flush()
  }
  return !waiting()
}

export async function cardStart(check, amount, tip = 0) {
  if (!state.config?.card_machine) return { ok: false, error: 'This till has no card machine' }
  if (state.online === false) return { ok: false, error: 'The card machine needs a connection: take the card on another machine and use Card' }
  if (!(await sendCheck(check.id))) return { ok: false, error: 'The check hasn\'t reached the server yet: try again in a moment' }
  const paymentId = ulid()
  const r = await cardApi('post', '/pos-api/card/payments', { check_id: check.id, payment_id: paymentId, amount, tip, staff_id: state.staff?.id || null })
  return r.ok ? { ok: true, payment: r.data } : r
}
export const cardCheck = id => cardApi('get', '/pos-api/card/payments/' + id)
export const cardCancel = id => cardApi('post', '/pos-api/card/payments/' + id + '/cancel', {})
export const cardSignature = (id, accepted) => cardApi('post', '/pos-api/card/payments/' + id + '/signature', { accepted })
export const cardTest = (id, result) => cardApi('post', '/pos-api/card/payments/' + id + '/test', { result })
export const cardPayments = checkId => cardApi('get', '/pos-api/card/payments?check_id=' + encodeURIComponent(checkId))

/** Money back to the card: purpose 'refund' (a closed check) or 'void' (taking the payment off). */
export async function cardRefund({ checkId, salePaymentId, amount, approvedBy = null, purpose = 'refund' }) {
  if (state.online === false) return { ok: false, error: 'Refunding to the card needs a connection' }
  const refundId = ulid()
  const r = await cardApi('post', '/pos-api/card/refunds', {
    sale_id: salePaymentId, check_id: checkId, refund_id: refundId, amount,
    staff_id: state.staff?.id, approved_by: approvedBy || null, purpose,
  })
  if (!r.ok) return r
  if (r.data.status !== 'approved') return { ok: false, error: r.data.message || 'The refund didn\'t go through' }
  return { ok: true, refund: r.data, refundId }
}

/** May the signed-in person do it without a manager? key: their role's
 *  permission (null = none needed); actions: the venue's manager switches. */
export function can(key, amount = null, actions = []) {
  if (!state.staff) return false
  return !doProblem({ staff_id: state.staff.id }, key, amount, actions)
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
    const viaHub = String(res.source || '').startsWith('hub:')
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
    // Through the venue hub the cloud may still be out of reach.
    setState({ confirmed, outbox, conflicts: conflicts.slice(0, 50), ...(viaHub ? {} : { online: true }) })
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
      // The cursor means something only to whoever gave it (the cloud or the
      // venue hub): asked of the other, it starts again (reset).
      const res = await api.get('/pos-api/sync?since=' + (state.seq || 0) + '&source=' + encodeURIComponent(state.seqSource || 'cloud'))
      const source = res.source || 'cloud'
      keepServerNumbers(state.device?.id, res.numbers)
      let confirmed = res.reset ? {} : { ...state.confirmed }
      for (const c of res.checks || []) confirmed[c.id] = c
      // Keep open checks, this trading day's, and any opened from Closed checks; drop older closed ones.
      const dayId = res.day?.id || null
      confirmed = Object.fromEntries(Object.entries(confirmed).filter(([id, c]) => c.status === 'open' || (dayId && c.day_id === dayId) || pinned.has(id)))
      setState({ confirmed, seq: res.seq, seqSource: source, day: res.day, presence: res.presence || [], lastSync: Date.now(), ...(source === 'cloud' ? { online: true } : {}) })
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
  snapTimer = setTimeout(() => idb.set(SNAPSHOT_KEY, { seq: state.seq, source: state.seqSource, checks: state.confirmed, day: state.day }), 500)
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
    else if (m.type === 'pos.print') devicePrinting?.nudge()
    else if (m.type === 'pos.revoked' && m.device_id === state.device?.id) { toast('This till was removed in Store tech.', 'bad', 8000); unpair() }
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
let pulls = null
export function startSync() {
  if (started) return
  started = true
  window.addEventListener('online', () => { setState({ online: true }); tick() })
  window.addEventListener('offline', () => setState({ online: false }))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); loadConfig() } })
  connectSocket()
  ensureDevicePrinting()
  const loop = () => {
    // On the venue hub, ask it every 2 s (it has no push); without the push
    // socket, ask every 4 s; with it, every 30 s as a check.
    const ms = api.onHub() ? 2000 : state.socket === 'open' ? 30000 : 4000
    pollTimer = setTimeout(() => { tick(); loop() }, ms)
  }
  loop()
  // Pushes bring changes at once; the till asks as well, so it never
  // depends on them: the whole config every few minutes, prices and sold
  // out more often (the location's times, config.pull).
  pulls = createPullTimers(() => state.config, { content: loadConfig, live: pullLive })
  tick()
}
function stopSync() {
  started = false
  devicePrinting?.stop()
  devicePrinting = null
  clearTimeout(pollTimer)
  pulls?.stop()
  pulls = null
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
  /** The venue hub (hub first): { configured, ok, url }. */
  hubStatus: () => api.hubStatus(),
}
