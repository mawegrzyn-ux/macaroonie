// The self-order kiosk's state (docs/POS.md section 10, shared/kiosk.js).
//
// Same shape as the till's store (src/lib/store.js) where it can be: the
// config is kept on the device (IndexedDB) so the kiosk opens straight away,
// and refreshed on a pos.config push or every few minutes. Unlike the till,
// a guest's order lives here only until it is placed (a reload starts
// again), and placing it needs a connection: the order number comes from the
// sequencer. A card payment that went through but couldn't be sent waits in
// an outbox and is sent again until it arrives. Every picture the menu can
// show is kept on the device (photos.js); the connection is watched as
// described under Connection below.
//
// Preview (Store tech > Kiosks, the design editor): the app runs from a
// signed link without pairing, takes design changes from the editor by
// postMessage and never sends anything.

import { useSyncExternalStore } from 'react'
import { ulid } from '@shared/pos/ids.js'
import {
  kioskOrder, normaliseDesign, uiText, payMethods, TK, emailHint,
  dishLevels, mergeLevels, itemLevels as sharedItemLevels, guestFit, countFits, cleanPrefs,
} from '@shared/kiosk.js'
import { soldOutMap, comboCtx, configItem } from '@shared/pos/offers.js'
import { billOps } from '@shared/pos/printing.js'
import * as idb from '../lib/idb.js'
import { createTransport, OfflineError } from '../lib/transport.js'
import { printTickets } from '../lib/print.js'
import { moveDevice, tellDisconnect, setMovedTo } from '../lib/appHost.js'
import { savePhotos } from './photos.js'

const CONFIG_KEY = 'kiosk_config'
const OUTBOX_KEY = 'kiosk_outbox'
const COUNTER_KEY = 'kiosk_local_no'

let state = {
  phase: 'loading',        // 'loading' | 'ready'
  device: null,
  config: null,
  preview: false,
  replay: false,           // playing back a recorded visit (bootReplay)
  shared: null,       // a shared preview's names (bootShare): { design, venue, company, expires_at, menu }
  online: true,            // false shows ordering paused (link 'down')
  link: 'up',              // 'up' | 'checking' (trying the server again) | 'down'
  photos: null,            // { total, saved, busy } pictures kept on the device; saved null = can't keep them here
  lang: 'en',
  screen: 'start',         // start | menu | basket | details | pay | card | placing | done | failed | allergens
  orderType: null,
  section: null,           // section id on the menu screen, 'home' for the home page, 'tiles' for the section tiles page
  basket: [],              // [{ key, item_id, selection, qty }]
  builder: null,           // { item_id, key (editing a basket entry), selection, qty }
  details: { name: '', tent: '' },
  method: null,            // 'card' | 'counter'
  result: null,            // { order_no, provisional, check, totals, pending }
  error: null,
  reach: false,
  prefs: { avoid: [], diet: [] }, // the guest's allergens and diets (allergens screen), marked on the menu
  outbox: [],
  toast: null,
  ended: null,             // { why, n }: the last restart() (journey.js ends the visit's record on it)
  doneHold: false,         // the design editor's example order done screen: no countdown
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
/** For the journey recorder (journey.js): told after every change. */
export const subscribeKiosk = subscribe
/** The kiosk's connection to the server (journey.js sends its visits through it). */
export const kioskApi = () => api

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
  startSync()
  await loadConfig()
  setState({ phase: 'ready' })
  savePhotosSoon(0)
}

/** Preview from the design editor: config from the signed link, nothing is ever sent. */
export const bootPreview = token => bootPreviewFrom('/pos-api/kiosk-preview?token=' + encodeURIComponent(token), { live: true })

/**
 * A design's shared preview (its lasting link, migration 187): the design as
 * saved, nothing is ever sent, and design changes from the page around it are
 * ignored (it is our own share page, but what is shown must be what was saved).
 */
export const bootShare = token => bootPreviewFrom('/pos-api/kiosk-share?token=' + encodeURIComponent(token), { live: false })

/**
 * Playing back a guest's visit (Store tech > Kiosk analytics, journey.js):
 * a preview link with &replay=1. The page around it sends what the kiosk
 * showed moment by moment (kiosk.replay); nothing is ever sent and the
 * kiosk's own timers (the "Are you still there?" question, the order
 * number's countdown) stay still.
 */
export const bootReplay = token => bootPreviewFrom('/pos-api/kiosk-preview?token=' + encodeURIComponent(token), { live: false, replay: true })

async function bootPreviewFrom(path, { live, replay = false }) {
  try {
    const res = await createTransport(null).get(path)
    const c = withDesign(res)
    setState({ preview: true, replay, shared: res.share || null, device: c.device, config: c, lang: c.design.languages.source, phase: 'ready', online: true })
  } catch (err) {
    setState({ preview: true, replay, phase: 'ready', config: null, error: err.message || 'The preview couldn\'t load' })
  }
  window.addEventListener('message', e => {
    if (e.source !== window.parent || !e.data || typeof e.data !== 'object') return
    // A replay takes only what the player sends (journey.js listenForReplay()).
    if (replay) return
    if (live && e.data.type === 'kiosk.design' && state.config) {
      const design = { id: state.config.design.id, name: state.config.design.name, ...normaliseDesign(e.data.design) }
      const lang = design.languages.enabled.includes(state.lang) ? state.lang : design.languages.source
      setState({ config: { ...state.config, design }, lang })
    }
    if (e.data.type === 'kiosk.restart') restart('preview')
    // The editor's Menu button: back to the menu of the order being built,
    // else a new order with the first order type.
    if (e.data.type === 'kiosk.show' && e.data.screen === 'menu' && state.config) {
      if (['menu', 'basket', 'details', 'pay', 'card'].includes(state.screen)) go('menu', { builder: null })
      else startOrder(state.config.order_types?.[0]?.id || null)
    }
    // The editor's order done screen for an order type: an example order as a
    // guest of that type would have it (a name and a tent only where the
    // revenue stream asks for them), held on the screen while it's designed.
    if (e.data.type === 'kiosk.show' && e.data.screen === 'done' && state.config) showDoneExample(e.data)
  })
  try {
    window.parent.postMessage({ type: 'kiosk.ready', ...(state.shared ? { share: { ...state.shared, screen: state.config?.design?.screen || null } } : {}), ...(!state.config ? { error: state.error } : {}) }, '*')
  } catch { /* not framed */ }
}

function showDoneExample({ order_type_id, method }) {
  const types = state.config.order_types || []
  const ty = types.find(x => x.id === order_type_id) || types[0] || null
  setState({
    screen: 'done', orderType: ty?.id || null, builder: null, method: method === 'counter' ? 'counter' : 'card',
    details: { name: ty && ty.ask_name !== 'off' ? 'Sam' : '', tent: ty && ty.ask_tent !== 'off' ? '12' : '' },
    result: { order_no: 57, provisional: (state.device?.short_code || 'KS') + '-0057', check: null, totals: null, pending: false },
    error: null, doneHold: true,
  })
}

/** Get the config (only when it changed) and note whether the server answered. */
export async function loadConfig() {
  if (state.preview) return
  if (await fetchConfig()) linkOk()
  else linkTrouble()
}

// True when the server answered (a 4xx is an answer; 5xx and no reply aren't).
async function fetchConfig(opts) {
  try {
    const v = state.config?.version
    const res = await api.get('/pos-api/config' + (v ? '?version=' + encodeURIComponent(v) : ''), opts)
    if (!res.unchanged) {
      await idb.set(CONFIG_KEY, res)
      const c = withDesign(res)
      const keep = c.design.languages.enabled.includes(state.lang)
      setState({ config: c, ...(keep ? {} : { lang: c.design.languages.source }) })
      savePhotosSoon()
    }
    return true
  } catch (err) {
    if (err instanceof OfflineError || err?.offline || err?.status >= 500) return false
    if (err?.status === 401) forget()
    else console.warn(err)
    return true
  }
}

function handleError(err) {
  if (err instanceof OfflineError || err?.offline) { linkTrouble(); return }
  if (err?.status === 401) { forget(); return }
  console.warn(err)
}

let photoTimer = null
function savePhotosSoon(ms = 3000) {
  if (state.preview) return
  clearTimeout(photoTimer)
  photoTimer = setTimeout(() => {
    if (state.config) savePhotos(state.config, photos => setState({ photos }))
  }, ms)
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
  // No sections down the side: the menu opens on the section tiles page.
  const first = config?.design?.menu?.rail === 'none' ? 'tiles' : hasHome(config) ? 'home' : kioskSections(config)[0]?.id || null
  setState({
    screen: 'menu', orderType: orderTypeId, section: first, basket: [], builder: null,
    details: { name: '', tent: '' }, method: null, result: null, error: null, doneHold: false,
  })
}

/**
 * Back to the start screen, order cleared. why (for the visit's record,
 * journey.js): 'guest' (Start again), 'timeout' (no answer to "Are you still
 * there?"), 'done' (the order number screen), 'preview' (the design editor).
 * A click passes its event: that is the guest.
 */
export function restart(why) {
  attempt = null
  setState({
    screen: 'start', orderType: null, basket: [], builder: null, details: { name: '', tent: '' },
    method: null, result: null, error: null, reach: false, prefs: { avoid: [], diet: [] }, lang: state.config?.design?.languages?.source || 'en',
    // The next guest starts on the menu's first page.
    section: null, detailStep: null, added: null, toast: null, doneHold: false,
    ended: { why: typeof why === 'string' ? why : 'guest', n: (state.ended?.n || 0) + 1 },
  })
}

/**
 * Show a moment of a recorded visit (replay mode): the view the recorder
 * kept (shared/kioskJourney.js). What the guest typed was never kept, only
 * how long it was: it shows as dots.
 */
export function replayView(v = {}) {
  const c = state.config
  const dots = n => '\u2022'.repeat(Math.max(0, Math.min(40, Number(n) || 0)))
  const langs = c?.design?.languages
  const r = v.result
  setState({
    screen: v.screen || 'start', section: v.section ?? null, orderType: v.orderType ?? null,
    lang: langs?.enabled?.includes(v.lang) ? v.lang : langs?.source || 'en',
    reach: !!v.reach, prefs: cleanPrefs(v.prefs || {}),
    basket: Array.isArray(v.basket) ? v.basket.filter(e => e && e.key && e.item_id) : [],
    builder: v.builder?.item_id ? { item_id: v.builder.item_id, key: v.builder.key || null, selection: v.builder.selection || { choices: {}, combo: {} }, qty: v.builder.qty || 1 } : null,
    details: { name: dots(v.details?.name), tent: dots(v.details?.tent) }, detailStep: v.detailStep ?? null,
    method: v.method ?? null,
    result: r ? { order_no: r.order_no ?? null, provisional: r.provisional ?? null, pending: !!r.pending, check: null, totals: { total: r.total ?? 0 } } : null,
    error: v.error ?? null, toast: v.toast ? { id: 'replay:' + v.toast, text: v.toast } : null, added: null,
    link: v.link || 'up', online: v.link !== 'down',
  })
}

export function openSection(id) { setState({ section: id, screen: 'menu' }) }

export function openBuilder(itemId, entry = null) {
  // A toast from the last add would sit over the new item.
  setState({ toast: null, builder: { item_id: itemId, key: entry?.key || null, selection: entry?.selection || { choices: {}, combo: {} }, qty: entry?.qty || 1 } })
}
export function closeBuilder() { setState({ builder: null }) }

const sameEntry = (a, b) => a.item_id === b.item_id && JSON.stringify(a.selection || {}) === JSON.stringify(b.selection || {})

/**
 * Put a dish in the basket (or raise the quantity of the same one), or
 * replace the entry being edited. flew: the dish's picture is flying into
 * the order button (fly.js), which then bounces when it lands, not now.
 */
export function addToBasket({ item_id, selection = {}, qty = 1 }, key = null, { flew = false } = {}) {
  let basket = [...state.basket]
  if (key) {
    basket = basket.map(e => (e.key === key ? { ...e, item_id, selection, qty } : e))
  } else {
    const twin = basket.find(e => sameEntry(e, { item_id, selection }))
    if (twin) basket = basket.map(e => (e === twin ? { ...e, qty: Math.min(99, e.qty + qty) } : e))
    else basket.push({ key: ulid(), item_id, selection, qty })
  }
  // `added` changes on every add: the order button gives a little bounce.
  setState({ basket, builder: null, ...(key || flew ? {} : { added: Date.now() }) })
  if (!key) toast(textsFor().ui('added'), 1600)
}

export function setQty(key, qty) {
  const basket = qty <= 0 ? state.basket.filter(e => e.key !== key) : state.basket.map(e => (e.key === key ? { ...e, qty: Math.min(99, qty) } : e))
  setState({ basket })
}

export function setDetails(patch) { setState({ details: { ...state.details, ...patch } }) }

// ── Allergens ───────────────────────────────────────────────────
// The guest's allergens and diets (the allergens screen) stay for the order
// and mark the menu; restart() clears them. Level rules: shared/kiosk.js.

const ctxCache = new WeakMap()
const ctxOf = config => { if (!ctxCache.has(config)) ctxCache.set(config, comboCtx(config)); return ctxCache.get(config) }

export { dishLevels, mergeLevels }

/** What an allergen list shows for an item (a combo: every dish it can hold). */
export const itemLevels = (config, item) => sharedItemLevels(config, item, ctxOf(config))

/** How an item suits the guest's allergens and diets (shared guestFit()), null with none picked. */
export const fitOf = (config, item, prefs = state.prefs) => guestFit(config, item, prefs, ctxOf(config))

export function setPrefs(prefs) { setState({ prefs: cleanPrefs(prefs) }) }

/** The dishes on the kiosk's menu, each once: what the allergens screen counts. */
export function kioskItemIds(config) {
  return [...new Set(kioskSections(config).flatMap(sec => sec.item_ids))]
}

/** { total, fits } for the guest's picks (sold out dishes left out). */
export const countFor = (config, prefs = state.prefs) => countFits(config, kioskItemIds(config), prefs, ctxOf(config))

/** Dishes sold out now (services/soldOut.js), from the config. */
export const soldOut = (config = state.config) => soldOutMap(config)

export function methods(config = state.config) {
  return payMethods(config.design, config.device?.settings || {})
}

// ── The card machine (migration 193) ────────────────────────────
// The server drives the kiosk's card machine through its provider; the kiosk
// starts a payment for the order's total and asks how it is going. The order
// is sent once the machine approves (placeOrder('card', { id, card_payment_id })).

async function cardCall(fn) {
  try { return await fn() } catch (err) { handleError(err); throw err }
}
export const cardStart = (paymentId, amount) => cardCall(() => api.post('/pos-api/card/payments', { payment_id: paymentId, amount }, { timeoutMs: 30000 }))
export const cardCheck = id => cardCall(() => api.get('/pos-api/card/payments/' + id, { timeoutMs: 15000 }))
export const cardCancel = id => cardCall(() => api.post('/pos-api/card/payments/' + id + '/cancel', {}, { timeoutMs: 15000 }))
export const cardTest = (id, result) => cardCall(() => api.post('/pos-api/card/payments/' + id + '/test', { result }, { timeoutMs: 15000 }))
/** While the guest is at the card machine the kiosk doesn't time out (KioskApp's idle timer). */
export const setCardWaiting = on => { if (!!state.card_waiting !== !!on) setState({ card_waiting: !!on }) }

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
    venue: { name: c.venue?.name }, settings: c.settings, printers: {}, tables: {},
    staff: { [state.device.id]: { name: state.device.name } }, courses: {},
    order_types: by((c.all_order_types || []).map(t => ({ id: t.id, name: t.name }))), devices: {},
  }, { layout: c.print_layouts?.receipt || null })])
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
    linkOk()
    setState({ screen: 'done', result: { order_no: orderNo, provisional, check, totals: r.totals, pending: false } })
    if (design.checkout.receipt === 'always') printReceipt(check)
  } catch (err) {
    handleError(err)
    if (method === 'card') return paidButNotSent(r, provisional, null)
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

// ── Receipts on the guest's phone (migration 209) ────────────────
// The order just placed has a receipt page of its own on the server: the done
// screen shows a QR code of it, or the server emails it (design.done
// receipt_qr / receipt_email). An order still waiting in the outbox isn't on
// the server yet, so it has none. A preview never asks the server.

async function receiptCall(body, timeoutMs) {
  const id = state.result?.check?.id
  if (!id || state.result?.pending) throw new Error('This order has no receipt yet')
  try {
    const out = await api.post('/pos-api/kiosk/receipts', { check_id: id, ...body }, { timeoutMs })
    linkOk()
    return out
  } catch (err) { handleError(err); throw err }
}

/** { url } of the order's receipt page. */
export async function receiptLink() {
  if (state.preview) return { url: location.origin + '/receipt/example', example: true }
  return receiptCall({}, 15000)
}

/**
 * Email the order's receipt: { url, sent_to } once sent (sent_to: the address
 * shown back, 's***@gmail.com'), or { url, sent_to: null, will_send_to } for an
 * order paid at the counter (the server sends it once the till takes payment,
 * migration 210).
 */
export async function emailReceipt(email) {
  if (state.preview) {
    await new Promise(res => setTimeout(res, 700))
    return state.method === 'card'
      ? { url: null, sent_to: emailHint(email), example: true }
      : { url: null, sent_to: null, will_send_to: emailHint(email), example: true }
  }
  return receiptCall({ email }, 25000)
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
    linkOk()
    setState({ outbox: rest })
    await idb.set(OUTBOX_KEY, rest)
  } catch (err) {
    handleError(err)
  } finally {
    flushing = false
    if (state.outbox.length) scheduleFlush(state.online ? 5000 : 15000)
  }
}

// ── Connection ───────────────────────────────────────────────────
//
// The live link (a WebSocket) brings menu changes as they happen, and its
// heartbeat notices a lost connection within seconds: a router that loses
// the internet leaves the link hanging rather than closing it. When the link
// drops, misses its heartbeat or a request gets no reply, the kiosk tries
// the server twice more, quickly; only when neither try gets through does it
// show ordering paused (link 'down'), and then it tries every few seconds
// until the server answers again.

const QUICK_TRIES_MS = [1000, 2000]   // the wait before each of the two quick tries
const CHECK_EVERY_MS = 5000           // while offline
const TRY_TIMEOUT_MS = 4000
const HEARTBEAT_MS = 15000
const HEARTBEAT_WAIT_MS = 6000

let checkTimer = null
let socketTimer = null
let beat = null
let beatWait = null

function setLink(link) {
  if (state.link !== link || state.online !== (link !== 'down')) setState({ link, online: link !== 'down' })
}

/** The server answered: online again (a link that was down comes straight back). */
function linkOk() {
  if (!started) return
  const was = state.link
  clearTimeout(checkTimer)
  checkTimer = null
  setLink('up')
  if (was === 'down') {
    clearTimeout(socketTimer)
    socketTimer = null
    socketRetry = 1000
    scheduleFlush(0)
    savePhotosSoon(0)
  }
  if (!socket && !socketTimer) connectSocket()
}

/** Something didn't get through: two quick tries before ordering pauses. */
function linkTrouble() {
  if (!started || state.link !== 'up') return
  setLink('checking')
  quickTry(0)
}

function quickTry(n) {
  clearTimeout(checkTimer)
  checkTimer = setTimeout(async () => {
    const ok = await fetchConfig({ timeoutMs: TRY_TIMEOUT_MS })
    if (!started || state.link !== 'checking') return
    if (ok) return linkOk()
    if (n + 1 < QUICK_TRIES_MS.length) return quickTry(n + 1)
    setLink('down')
    keepChecking(CHECK_EVERY_MS)
  }, QUICK_TRIES_MS[n])
}

function keepChecking(ms) {
  clearTimeout(checkTimer)
  checkTimer = setTimeout(async () => {
    const ok = await fetchConfig({ timeoutMs: TRY_TIMEOUT_MS })
    if (!started || state.link !== 'down') return
    if (ok) linkOk()
    else keepChecking(CHECK_EVERY_MS)
  }, ms)
}

function connectSocket() {
  const url = api.socketUrl()
  if (!url || socket || !started) return
  clearTimeout(socketTimer)
  socketTimer = null
  let ws
  try { ws = new WebSocket(url) } catch { return linkDropped() }
  socket = ws
  ws.onopen = () => { socketRetry = 1000; loadConfig() }
  ws.onmessage = msg => {
    heard()
    let m
    try { m = JSON.parse(msg.data) } catch { return }
    if (m.type === 'connected' && m.heartbeat) startHeartbeat(ws)
    else if (m.type === 'pos.config') loadConfig()
    else if (m.type === 'pos.revoked' && m.device_id === state.device?.id) forget()
  }
  ws.onclose = () => { if (socket === ws) { socket = null; linkDropped() } }
  ws.onerror = () => { try { ws.close() } catch { /* ignore */ } }
}

// The link closed (or failed to open, or stopped answering): try the server,
// and open the link again later (straight away once the server answers after
// being down: linkOk()).
function linkDropped() {
  stopHeartbeat()
  if (!started) return
  linkTrouble()
  if (state.link === 'down' || socketTimer) return
  socketTimer = setTimeout(() => { socketTimer = null; connectSocket() }, socketRetry)
  socketRetry = Math.min(socketRetry * 2, 30000)
}

// Only once the server said it answers pings (its 'connected' message), so a
// server without them never looks like a dead link.
function startHeartbeat(ws) {
  stopHeartbeat()
  beat = setInterval(() => {
    if (socket !== ws || ws.readyState !== 1) return
    try { ws.send('{"type":"ping"}') } catch { return }
    if (beatWait) return
    beatWait = setTimeout(() => {
      beatWait = null
      if (socket !== ws) return
      // No answer: drop the link without waiting for it to close (a hanging
      // link may take minutes to report it has gone).
      socket = null
      ws.onclose = ws.onmessage = ws.onerror = null
      try { ws.close() } catch { /* ignore */ }
      linkDropped()
    }, HEARTBEAT_WAIT_MS)
  }, HEARTBEAT_MS)
}

function heard() { clearTimeout(beatWait); beatWait = null }
function stopHeartbeat() { clearInterval(beat); beat = null; heard() }

const onBrowserOnline = () => { if (state.link === 'down') keepChecking(0); else loadConfig() }
const onBrowserOffline = () => linkTrouble()

function startSync() {
  if (started) return
  started = true
  window.addEventListener('online', onBrowserOnline)
  window.addEventListener('offline', onBrowserOffline)
  connectSocket()
  // A check every 3 minutes as well: the menu (sold out, prices) in case a
  // push was missed, and any order waiting to be sent.
  const loop = () => { pollTimer = setTimeout(() => { loadConfig(); scheduleFlush(0); loop() }, 180_000) }
  loop()
  scheduleFlush(0)
}

function stopSync() {
  started = false
  window.removeEventListener('online', onBrowserOnline)
  window.removeEventListener('offline', onBrowserOffline)
  for (const t of [pollTimer, checkTimer, socketTimer, flushTimer, photoTimer]) clearTimeout(t)
  stopHeartbeat()
  const ws = socket
  socket = null
  if (ws) {
    ws.onclose = ws.onmessage = ws.onerror = null
    try { ws.close() } catch { /* ignore */ }
  }
}

export { uiText }
