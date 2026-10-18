// The self-order kiosk's state (docs/POS.md section 10, shared/kiosk.js).
//
// Same shape as the till's store (src/lib/store.js) where it can be: the
// config is kept on the device (IndexedDB) so the kiosk opens straight away,
// and refreshed on a pos.config push or every few minutes. Unlike the till,
// a guest's order lives here only until it is placed (a reload starts
// again), and placing it needs a connection: the order number comes from the
// sequencer. A card payment that went through but couldn't be sent waits in
// an outbox and is sent again until it arrives.
//
// Preview (Till setup > Kiosks, the design editor): the app runs from a
// signed link without pairing, takes design changes from the editor by
// postMessage and never sends anything.

import { useSyncExternalStore } from 'react'
import { ulid } from '@shared/pos/ids.js'
import { kioskOrder, normaliseDesign, uiText, payMethods, TK } from '@shared/kiosk.js'
import { soldOutMap, comboCtx, configItem } from '@shared/pos/offers.js'
import { comboItemIds } from '@shared/combos.js'
import { billOps } from '@shared/pos/printing.js'
import * as idb from '../lib/idb.js'
import { createTransport, OfflineError } from '../lib/transport.js'
import { printTickets } from '../lib/print.js'
import { moveDevice, tellDisconnect, setMovedTo } from '../lib/appHost.js'

const CONFIG_KEY = 'kiosk_config'
const OUTBOX_KEY = 'kiosk_outbox'
const COUNTER_KEY = 'kiosk_local_no'

let state = {
  phase: 'loading',        // 'loading' | 'ready'
  device: null,
  config: null,
  preview: false,
  online: navigator.onLine,
  lang: 'en',
  screen: 'start',         // start | menu | basket | details | pay | card | placing | done | failed | allergens
  orderType: null,
  section: null,           // section id on the menu screen, 'home' for the home page
  basket: [],              // [{ key, item_id, selection, qty }]
  builder: null,           // { item_id, key (editing a basket entry), selection, qty }
  details: { name: '', tent: '' },
  method: null,            // 'card' | 'counter'
  result: null,            // { order_no, provisional, check, totals, pending }
  error: null,
  reach: false,
  outbox: [],
  toast: null,
}
const listeners = new Set()
let api = createTransport(null)

function setState(patch) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
export const getState = () => state
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
export function useKiosk() { return useSyncExternalStore(subscribe, getState) }

let toastTimer = null
export function toast(text, ms = 2200) {
  clearTimeout(toastTimer)
  setState({ toast: { id: ulid(), text } })
  toastTimer = setTimeout(() => setState({ toast: null }), ms)
}

// ── Words ────────────────────────────────────────────────────────

/** The guest's language's words: t() for the menu's own words, ui() for the kiosk's. */
export function textsFor(s = state) {
  const design = s.config?.design
  const source = design?.languages?.source || 'en'
  const lang = s.lang || source
  const dict = s.config?.translations?.[lang] || {}
  const t = (key, fallback) => (lang !== source && dict[key]) || fallback || ''
  const ui = (key, vars) => uiText(lang, key, vars, dict)
  // narrowSymbol: '7,50 £' in Spanish, not '7,50 GBP'.
  const fmt = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang, { style: 'currency', currency: 'GBP', currencyDisplay: 'narrowSymbol' })
  const money = pence => fmt.format((Number(pence) || 0) / 100)
  const itemName = it => t(TK.item(it.id, 'name'), it.name)
  return { lang, source, t, ui, money, itemName, dict }
}

// ── Start ────────────────────────────────────────────────────────

function withDesign(config) {
  if (!config) return config
  return { ...config, design: { id: config.design?.id ?? null, name: config.design?.name, ...normaliseDesign(config.design) } }
}

export async function bootKiosk(device) {
  api = createTransport(device)
  const [config, outbox] = await Promise.all([idb.get(CONFIG_KEY), idb.get(OUTBOX_KEY)])
  const c = withDesign(config || null)
  setState({ device, config: c, outbox: outbox || [], lang: c?.design?.languages?.source || 'en', phase: c ? 'ready' : 'loading' })
  await loadConfig()
  setState({ phase: 'ready' })
  startSync()
}

/** Preview from the design editor: config from the signed link, nothing is ever sent. */
export async function bootPreview(token) {
  try {
    const res = await createTransport(null).get('/pos-api/kiosk-preview?token=' + encodeURIComponent(token))
    const c = withDesign(res)
    setState({ preview: true, device: c.device, config: c, lang: c.design.languages.source, phase: 'ready', online: true })
  } catch (err) {
    setState({ preview: true, phase: 'ready', config: null, error: err.message || 'The preview couldn\'t load' })
  }
  window.addEventListener('message', e => {
    if (e.source !== window.parent || !e.data || typeof e.data !== 'object') return
    if (e.data.type === 'kiosk.design' && state.config) {
      const design = { id: state.config.design.id, name: state.config.design.name, ...normaliseDesign(e.data.design) }
      const lang = design.languages.enabled.includes(state.lang) ? state.lang : design.languages.source
      setState({ config: { ...state.config, design }, lang })
    }
    if (e.data.type === 'kiosk.restart') restart()
    // The editor's Menu button: back to the menu of the order being built,
    // else a new order with the first order type.
    if (e.data.type === 'kiosk.show' && e.data.screen === 'menu' && state.config) {
      if (['menu', 'basket', 'details', 'pay', 'card'].includes(state.screen)) go('menu', { builder: null })
      else startOrder(state.config.order_types?.[0]?.id || null)
    }
  })
  try { window.parent.postMessage({ type: 'kiosk.ready' }, '*') } catch { /* not framed */ }
}

export async function loadConfig() {
  if (state.preview) return
  try {
    const v = state.config?.version
    const res = await api.get('/pos-api/config' + (v ? '?version=' + encodeURIComponent(v) : ''))
    if (!res.unchanged) {
      await idb.set(CONFIG_KEY, res)
      const c = withDesign(res)
      const keep = c.design.languages.enabled.includes(state.lang)
      setState({ config: c, online: true, ...(keep ? {} : { lang: c.design.languages.source }) })
    } else {
      setState({ online: true })
    }
  } catch (err) {
    handleError(err)
  }
}

function handleError(err) {
  if (err instanceof OfflineError || err?.offline) { setState({ online: false }); return }
  if (err?.status === 401) { forget(); return }
  console.warn(err)
}

async function forget() {
  stopSync()
  await Promise.all([idb.del('device'), idb.del(CONFIG_KEY)])
  setTimeout(() => location.reload(), 2000)
}

// ── Disconnect, move (lib/appHost.js) ────────────────────────────

/** Send what is waiting (paid orders); true when nothing is left. */
async function sendWaiting() {
  for (let i = 0; i < 20 && state.outbox.length; i++) {
    const before = state.outbox.length
    await flush()
    if (state.outbox.length >= before) break
  }
  return !state.outbox.length
}

const waitingError = () => ({
  ok: false,
  error: state.outbox.length + (state.outbox.length === 1 ? ' paid order hasn\'t' : ' paid orders haven\'t') + ' reached the till yet: check the Wi-Fi first',
})

async function clearDevice() {
  stopSync()
  await Promise.all([idb.del('device'), idb.del(CONFIG_KEY), idb.del(OUTBOX_KEY)])
}

/**
 * Disconnect this kiosk (its staff panel): never while paid orders are
 * still waiting to reach the till. Macaroonie stops accepting its pairing,
 * the kiosk forgets it and shows the pairing screen.
 */
export async function disconnect() {
  if (state.preview) return { ok: false, error: 'Not in a preview' }
  if (!(await sendWaiting())) return waitingError()
  const told = await tellDisconnect(api)
  await clearDevice()
  setTimeout(() => location.reload(), told ? 300 : 6000)
  return { ok: true, told }
}

/** A kiosk paired on the till's address moves to kiosk.{root}, waiting orders sent first. */
export async function moveKiosk() {
  if (state.preview) return { ok: false, error: 'Not in a preview' }
  if (!(await sendWaiting())) return waitingError()
  const r = await moveDevice(api, 'kiosk')
  if (!r.ok) return r
  setMovedTo(r.url)
  await clearDevice()
  r.go()
  return { ok: true }
}

// ── Guest's way through ─────────────────────────────────────────

export function setLang(lang) {
  if (state.config?.design?.languages?.enabled?.includes(lang)) setState({ lang })
}

export function setReach(reach) { setState({ reach }) }

/** To another screen; an "Added" toast from the menu doesn't follow the guest there. */
export function go(screen, patch = {}) { setState({ screen, error: null, ...(screen !== state.screen ? { toast: null } : {}), ...patch }) }

/** The menu's sections the kiosk shows, in order, with dishes it can sell. */
export function kioskSections(config) {
  const hidden = new Set(config?.design?.menu?.hidden_section_ids || [])
  const out = []
  const seen = new Set()
  for (const m of config?.menus || []) {
    for (const s of m.sections || []) {
      if (hidden.has(s.id) || seen.has(s.id)) continue
      const ids = (s.item_ids || []).filter(id => config.items?.[id])
      if (!ids.length) continue
      seen.add(s.id)
      out.push({ ...s, item_ids: ids })
    }
  }
  return out
}

export function hasHome(config) {
  const m = config?.design?.menu
  return !!(m?.home && (m.banners.length || m.featured.length))
}

/** Start an order: the order type picked on the start screen. */
export function startOrder(orderTypeId) {
  const config = state.config
  const first = hasHome(config) ? 'home' : kioskSections(config)[0]?.id || null
  setState({
    screen: 'menu', orderType: orderTypeId, section: first, basket: [], builder: null,
    details: { name: '', tent: '' }, method: null, result: null, error: null,
  })
}

/** Back to the start screen, order cleared. */
export function restart() {
  attempt = null
  setState({
    screen: 'start', orderType: null, basket: [], builder: null, details: { name: '', tent: '' },
    method: null, result: null, error: null, reach: false, lang: state.config?.design?.languages?.source || 'en',
    // The next guest starts on the menu's first page.
    section: null, detailStep: null, added: null, toast: null,
  })
}

export function openSection(id) { setState({ section: id, screen: 'menu' }) }

export function openBuilder(itemId, entry = null) {
  // A toast from the last add would sit over the new item.
  setState({ toast: null, builder: { item_id: itemId, key: entry?.key || null, selection: entry?.selection || { choices: {}, combo: {} }, qty: entry?.qty || 1 } })
}
export function closeBuilder() { setState({ builder: null }) }

const sameEntry = (a, b) => a.item_id === b.item_id && JSON.stringify(a.selection || {}) === JSON.stringify(b.selection || {})

/** Put a dish in the basket (or raise the quantity of the same one), or replace the entry being edited. */
export function addToBasket({ item_id, selection = {}, qty = 1 }, key = null) {
  let basket = [...state.basket]
  if (key) {
    basket = basket.map(e => (e.key === key ? { ...e, item_id, selection, qty } : e))
  } else {
    const twin = basket.find(e => sameEntry(e, { item_id, selection }))
    if (twin) basket = basket.map(e => (e === twin ? { ...e, qty: Math.min(99, e.qty + qty) } : e))
    else basket.push({ key: ulid(), item_id, selection, qty })
  }
  // `added` changes on every add: the order button gives a little bounce.
  setState({ basket, builder: null, ...(key ? {} : { added: Date.now() }) })
  if (!key) toast(textsFor().ui('added'), 1600)
}

export function setQty(key, qty) {
  const basket = qty <= 0 ? state.basket.filter(e => e.key !== key) : state.basket.map(e => (e.key === key ? { ...e, qty: Math.min(99, qty) } : e))
  setState({ basket })
}

export function setDetails(patch) { setState({ details: { ...state.details, ...patch } }) }

// ── Allergens ───────────────────────────────────────────────────

const LEVEL_RANK = { removable: 1, may_contain: 2, contains: 3 }
const ctxCache = new WeakMap()
const ctxOf = config => { if (!ctxCache.has(config)) ctxCache.set(config, comboCtx(config)); return ctxCache.get(config) }

/** A dish's tags with their level: { code: 'contains' | 'may_contain' | 'removable' }. */
export function dishLevels(item) {
  const out = {}
  for (const code of item?.dietary || []) out[code] = (item.allergen_levels || {})[code] || 'contains'
  return out
}

/** Several dishes' tags together, each at its strongest level. */
export function mergeLevels(list) {
  const out = {}
  for (const levels of list) for (const [code, lv] of Object.entries(levels)) if (!out[code] || LEVEL_RANK[lv] > LEVEL_RANK[out[code]]) out[code] = lv
  return out
}

/**
 * What an allergen list shows for an item: a dish's own tags; a combo's are
 * every dish it can hold (its own tags carry nothing about its parts).
 */
export function itemLevels(config, item) {
  if (item?.kind !== 'combo') return dishLevels(item)
  return mergeLevels([dishLevels(item), ...comboItemIds(item, ctxOf(config)).map(id => dishLevels(configItem(config, id)))])
}

/** Dishes sold out now (services/soldOut.js), from the config. */
export const soldOut = (config = state.config) => soldOutMap(config)

export function methods(config = state.config) {
  return payMethods(config.design, config.device?.settings || {})
}

// ── Placing the order ────────────────────────────────────────────

function nextProvisionalNo() {
  let n = 0
  try { n = Number(localStorage.getItem(COUNTER_KEY)) || 0 } catch { /* ignore */ }
  n = n >= 9999 ? 1 : n + 1
  try { localStorage.setItem(COUNTER_KEY, String(n)) } catch { /* ignore */ }
  return (state.device?.short_code || 'KS') + '-' + String(n).padStart(4, '0')
}

function printReceipt(check) {
  const c = state.config
  const by = rows => Object.fromEntries((rows || []).map(r => [r.id, r]))
  printTickets([billOps(check, {
    venue: { name: c.venue?.name }, settings: c.settings, printers: {}, routes: [], tables: {},
    staff: { [state.device.id]: { name: state.device.name } }, courses: {},
    order_types: by((c.all_order_types || []).map(t => ({ id: t.id, name: t.name }))), devices: {},
  })])
}

/**
 * Place the guest's order. method 'card' (payment: { ref, label } from the
 * card reader, already taken) or 'counter'. Goes to 'done', or 'failed' with
 * the basket kept (nothing was sent), or 'done' with pending: true when a
 * card payment went through but the order couldn't be sent yet.
 */
// The last order sent that didn't come back (pay at the counter): trying
// again sends the very same events, so if the first try did reach the
// server the till doesn't get the order twice (the server skips events it
// already has).
let attempt = null

export async function placeOrder(method, payment = null) {
  const { config, device, basket, details, orderType } = state
  const design = config.design
  const key = method === 'counter' ? JSON.stringify([basket, details, orderType]) : null
  const again = key && attempt?.key === key ? attempt : null
  const provisional = again ? again.provisional : nextProvisionalNo()
  const r = again ? again.r : kioskOrder(config, basket, {
    device, checkId: ulid(), newId: () => ulid(), order_type_id: orderType,
    name: details.name, tent: details.tent, provisional_no: provisional,
    payment: method === 'card' ? payment || { ref: null } : null,
    send: method === 'counter' && design.checkout.send_counter,
    receipt: false,
  })
  if (!r.ok) {
    setState({ screen: 'failed', error: r.error, method })
    return
  }
  attempt = key ? { key, r, provisional } : null
  setState({ screen: 'placing', method })
  if (state.preview) {
    await new Promise(res => setTimeout(res, 600))
    setState({ screen: 'done', result: { order_no: 7, provisional, check: r.check, totals: r.totals, pending: false } })
    return
  }
  try {
    const res = await api.post('/pos-api/events', { events: r.events }, { timeoutMs: 20000 })
    const refused = res.results.filter(x => !x.ok && !x.duplicate)
    if (refused.length) {
      if (method === 'card') return paidButNotSent(r, provisional, refused[0].error)
      setState({ screen: 'failed', error: refused[0].error })
      return
    }
    attempt = null
    // A resent order's first event comes back as a duplicate: its number is on the check.
    const sent = (res.checks || []).find(c => c.id === r.check.id)
    const orderNo = res.results[0]?.assigned?.order_no ?? sent?.order_no ?? null
    const check = sent || { ...r.check, order_no: orderNo }
    setState({ screen: 'done', online: true, result: { order_no: orderNo, provisional, check, totals: r.totals, pending: false } })
    if (design.checkout.receipt === 'always') printReceipt(check)
  } catch (err) {
    if (method === 'card') return paidButNotSent(r, provisional, null)
    handleError(err)
    setState({ screen: 'failed', error: null })
  }
}

// The card was charged: the order must reach the till. Keep it and send it
// again until it is accepted; the guest shows the kiosk's own number at the counter.
async function paidButNotSent(r, provisional, error) {
  const outbox = [...state.outbox, { at: new Date().toISOString(), provisional, events: r.events, error }]
  setState({ outbox, screen: 'done', result: { order_no: null, provisional, check: r.check, totals: r.totals, pending: true } })
  await idb.set(OUTBOX_KEY, outbox)
  scheduleFlush(3000)
}

export function printResultReceipt() {
  if (state.result?.check) printReceipt({ ...state.result.check, order_no: state.result.order_no })
}

// ── Sync: config pushes, the outbox ──────────────────────────────

let flushTimer = null
let flushing = false
let socket = null
let socketRetry = 1000
let started = false
let pollTimer = null

function scheduleFlush(ms) {
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, ms)
}

async function flush() {
  if (flushing || !state.outbox.length || state.preview) return
  flushing = true
  try {
    const [first, ...rest] = state.outbox
    const res = await api.post('/pos-api/events', { events: first.events }, { timeoutMs: 20000 })
    // Sent (or refused: then it is listed in Till reports as a conflict, and
    // sending it again would only be refused again).
    if (res.results.some(x => !x.ok && !x.duplicate)) console.warn('kiosk order refused', res.results.filter(x => !x.ok))
    setState({ outbox: rest, online: true })
    await idb.set(OUTBOX_KEY, rest)
  } catch (err) {
    handleError(err)
  } finally {
    flushing = false
    if (state.outbox.length) scheduleFlush(state.online ? 5000 : 15000)
  }
}

function connectSocket() {
  const url = api.socketUrl()
  if (!url || socket) return
  try { socket = new WebSocket(url) } catch { socket = null; return }
  socket.onopen = () => { socketRetry = 1000; setState({ online: true }); loadConfig() }
  socket.onmessage = msg => {
    let m
    try { m = JSON.parse(msg.data) } catch { return }
    if (m.type === 'pos.config') loadConfig()
    else if (m.type === 'pos.revoked' && m.device_id === state.device?.id) forget()
  }
  socket.onclose = () => {
    socket = null
    if (started) setTimeout(connectSocket, socketRetry = Math.min(socketRetry * 2, 30000))
  }
  socket.onerror = () => { try { socket?.close() } catch { /* ignore */ } }
}

function startSync() {
  if (started) return
  started = true
  window.addEventListener('online', () => { setState({ online: true }); loadConfig(); scheduleFlush(0) })
  window.addEventListener('offline', () => setState({ online: false }))
  connectSocket()
  // A check every 3 minutes: the connection (for the "ordering paused"
  // notice), the menu (sold out, prices) and any order waiting to be sent.
  const loop = () => { pollTimer = setTimeout(() => { loadConfig(); scheduleFlush(0); loop() }, 180_000) }
  loop()
  scheduleFlush(0)
}

function stopSync() {
  started = false
  clearTimeout(pollTimer)
  try { socket?.close() } catch { /* ignore */ }
  socket = null
}

export { uiText }
