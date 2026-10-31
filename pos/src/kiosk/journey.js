// Kiosk journeys (migration 208, shared/kioskJourney.js): the kiosk records
// each guest's visit as it happens, so Store tech > Kiosk analytics can sum
// visits up and play one back on the kiosk mock-up.
//
// Recording: after every change in the store (store.js) the recorder works
// out the flat view (what the kiosk shows) and keeps the difference; screens
// keep what is theirs alone (the dish being built, a combo's page, a sheet
// that is open) through useJourneyState(), which reports it here. Touches,
// drags and scrolling are kept with their place on the screen. A visit
// starts at the first touch (or an order starting) and ends when the kiosk
// is back on its start screen (restart(): Start again, timed out, the order
// number's countdown) or the start screen is left untouched for a while.
// Nothing typed is kept: the name and tent number only as lengths, a touch
// on the keyboard at the keyboard's middle. Finished visits wait in this
// device's storage and are sent with POST /pos-api/kiosk/journeys, again
// until they arrive (a visit the page was closed in the middle of is sent
// as cut short the next time the kiosk opens). The design can switch it off
// (behaviour.record_journeys). Previews never record.
//
// Replay: the kiosk opened with &replay=1 (store.js bootReplay()) takes the
// player's kiosk.replay messages: the view goes into the store
// (replayView()), screens' own state comes back through useJourneyState(),
// and scrolling boxes are put where they were. Touches are drawn by the
// player over the frame.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ulid } from '@shared/pos/ids.js'
import { diffView } from '@shared/kioskJourney.js'
import { basketCheck, KIOSK_LANGUAGES, kioskBox } from '@shared/kiosk.js'
import { configItem } from '@shared/pos/offers.js'
import { APP_VERSION } from '../lib/transport.js'
import { getState, subscribeKiosk, kioskApi, kioskSections, replayView } from './store.js'

const QUEUE_KEY = 'kiosk_journeys'        // finished visits waiting to be sent
const OPEN_KEY = 'kiosk_journey_open'     // the visit being recorded, if the page closes mid-way
const MAX_EVENTS = 6000                   // past this a visit keeps its view changes only
const MAX_QUEUE = 40
const MAX_QUEUE_CHARS = 2_500_000
const START_IDLE_MS = 45_000              // the start screen untouched this long: the guest has gone
const SWIPE_PX = 24
const SCROLL_MS = 150
const BATCH = 5
const BATCH_CHARS = 1_500_000

// ── Screens' own state ───────────────────────────────────────────

const ui = {}                // key -> value (JSON) of mounted components
let replayUi = null          // replay: the frame's ui values; null when not replaying
const replayListeners = new Set()
const subscribeReplay = fn => { replayListeners.add(fn); return () => replayListeners.delete(fn) }
const getReplayUi = () => replayUi
let replayBox = null         // replay: the kiosk's box as recorded ([x, y, w, h]), or null
const getReplayBox = () => replayBox

/** A replay's recorded box for the kiosk (viewport.js useKioskBox()), or null. */
export const useReplayBox = () => useSyncExternalStore(subscribeReplay, getReplayBox)
const noop = () => {}

/**
 * useState for something a screen keeps to itself that changes what the
 * guest sees (a dish being built, a sheet that is open): recorded with the
 * visit, and in a replay the value the visit had. save / load turn the value
 * into JSON and back (a Set as a list). A key that is null isn't recorded.
 */
export function useJourneyState(key, init, { save = null, load = null } = {}) {
  const frame = useSyncExternalStore(subscribeReplay, getReplayUi)
  const [value, setValue] = useState(init)
  const saved = key && !frame ? JSON.stringify(save ? save(value) : value) : null
  useEffect(() => {
    if (saved != null) setUi(key, JSON.parse(saved))
  }, [key, saved])
  useEffect(() => () => { if (key) setUi(key, undefined) }, [key])
  // A frame's raw value turned back once per frame (a Set stays the same Set).
  const memo = useRef({ raw: undefined, val: undefined })
  if (frame && key) {
    if (!(key in frame)) return [typeof init === 'function' ? init() : init, noop]
    if (memo.current.raw !== frame[key]) memo.current = { raw: frame[key], val: load ? load(frame[key]) : frame[key] }
    return [memo.current.val, noop]
  }
  return [value, setValue]
}

function setUi(key, value) {
  if (value === undefined) delete ui[key]
  else ui[key] = value
  if (rec) note()
}

// ── The view ─────────────────────────────────────────────────────

let valueCache = { basket: null, type: null, value: 0 }

function basketValue(s) {
  if (!s.basket.length || !s.config) return 0
  if (valueCache.basket === s.basket && valueCache.type === s.orderType) return valueCache.value
  let value = 0
  try {
    const r = basketCheck(s.config, s.basket, { device: s.device, order_type_id: s.orderType })
    value = r.ok ? r.totals.total : 0
  } catch { value = 0 }
  valueCache = { basket: s.basket, type: s.orderType, value }
  return value
}

/** What the kiosk shows, flat (shared/kioskJourney.js describes the keys). */
export function viewOf(s) {
  const r = s.result
  const view = {
    screen: s.screen,
    section: s.section ?? null,
    orderType: s.orderType ?? null,
    lang: s.lang,
    reach: !!s.reach,
    prefs: { avoid: [...(s.prefs?.avoid || [])], diet: [...(s.prefs?.diet || [])] },
    basket: (s.basket || []).map(e => ({ key: e.key, item_id: e.item_id, qty: e.qty, selection: e.selection || {} })),
    builder: s.builder ? { item_id: s.builder.item_id, key: s.builder.key || null, qty: s.builder.qty || 1, selection: s.builder.selection || {} } : null,
    details: { name: (s.details?.name || '').length, tent: (s.details?.tent || '').length },
    detailStep: s.detailStep ?? null,
    method: s.method ?? null,
    result: r ? { order_no: r.order_no ?? null, provisional: r.provisional ?? null, pending: !!r.pending, total: r.totals?.total ?? null, check: r.check?.id ?? null } : null,
    error: s.error ?? null,
    toast: s.toast?.text ?? null,
    link: s.link || 'up',
    value: basketValue(s),
  }
  for (const [k, v] of Object.entries(ui)) view['ui:' + k] = v
  return view
}

// Names of what the visit touches, in the menu's own language, for the
// report and the step list (dishes, sections, order types, tags, languages).
function addNames(r, view, s) {
  const c = s.config
  if (!c) return
  const put = (key, name) => { if (key && name && r.names[key] !== name) r.names[key] = String(name).slice(0, 120) }
  const item = id => { if (id && !r.names[id]) put(id, configItem(c, id)?.name) }
  item(view.builder?.item_id)
  for (const e of view.basket) item(e.item_id)
  if (view.section && !r.names[view.section]) put(view.section, kioskSections(c, null).find(x => x.id === view.section)?.title)
  if (view.orderType && !r.names[view.orderType]) put(view.orderType, (c.order_types || c.all_order_types || []).find(t => t.id === view.orderType)?.name)
  for (const code of [...view.prefs.avoid, ...view.prefs.diet]) {
    if (!r.names['tag:' + code]) put('tag:' + code, (c.dietary_tags || []).find(t => t.code === code)?.label)
  }
  if (view.lang && !r.names['lang:' + view.lang]) put('lang:' + view.lang, KIOSK_LANGUAGES.find(l => l.code === view.lang)?.name)
}

// ── The visit being recorded ─────────────────────────────────────

let rec = null               // { id, t0, started_at, events, view, names, meta, full }
let enabled = false
let lastEnded = null
let lastTouch = 0
let saveTimer = null

const now = () => Date.now()
const allowed = s => !!(s.config && s.phase === 'ready' && !s.preview && s.config.design?.behaviour?.record_journeys !== false)

function open(s) {
  const view = viewOf(s)
  rec = {
    id: ulid(),
    t0: now(),
    started_at: new Date().toISOString(),
    events: [vpEvent(0), { t: 0, k: 'v', p: view }],
    view,
    names: {},
    full: false,
    meta: {
      design_id: s.config?.design?.id || null,
      stream_id: s.config?.stream?.id || null,
      config_version: s.config?.version ? String(s.config.version).slice(0, 80) : null,
      app_version: APP_VERSION,
    },
  }
  addNames(rec, view, s)
  saveSoon()
}

function push(ev) {
  if (!rec) return
  const last = rec.events[rec.events.length - 1]
  if (last && ev.t < last.t) ev.t = last.t
  if (rec.events.length >= MAX_EVENTS) {
    // A very long visit keeps what the kiosk showed, not every touch.
    if (ev.k !== 'v' && ev.k !== 'end') { rec.full = true; return }
  }
  rec.events.push(ev)
  saveSoon()
}

function note() {
  const s = getState()
  const view = viewOf(s)
  const diff = diffView(rec.view, view)
  if (!diff) return
  push({ t: now() - rec.t0, k: 'v', ...diff })
  rec.view = view
  addNames(rec, view, s)
}

function end(why) {
  if (!rec) return
  note()
  push({ t: now() - rec.t0, k: 'end', why })
  const visit = finish(rec)
  rec = null
  clearTimeout(saveTimer)
  store.del(OPEN_KEY)
  enqueue(visit)
  flushSoon(1000)
}

function finish(r) {
  const last = r.events[r.events.length - 1]?.t || 0
  return {
    id: r.id,
    started_at: r.started_at,
    ended_at: new Date(new Date(r.started_at).getTime() + last).toISOString(),
    ...r.meta,
    names: r.names,
    truncated: !!r.full,
    events: r.events,
  }
}

function onStore() {
  const s = getState()
  if (!allowed(s)) {
    // Switched off (or not a kiosk any more): the visit isn't kept.
    if (rec) { rec = null; store.del(OPEN_KEY) }
    lastEnded = s.ended?.n ?? lastEnded
    return
  }
  const restarted = (s.ended?.n ?? null) !== lastEnded
  lastEnded = s.ended?.n ?? null
  if (restarted && rec) { end(s.ended.why); return }
  if (!rec) {
    if (s.screen !== 'start' || s.builder) open(s)
    return
  }
  note()
}

// ── Touches, drags, scrolling ────────────────────────────────────

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [role="slider"], [role="tab"]'
let down = null
const scrollTimers = new Map()

/** Not part of the guest's visit: the staff panel and its corner. */
function staffTouch(target) {
  if (!(target instanceof Element)) return true
  if (target.closest('[data-testid="k-corner"]')) return true
  return !!document.querySelector('[data-testid="k-staff"]')
}

const clean = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60)

/** What a touch landed on: { el (in words), id (test id), ref (the dish, section ... it is for), hit }. */
export function describeTouch(target) {
  if (!(target instanceof Element)) return { el: 'the screen', id: null, ref: null, hit: 0 }
  // The keyboard and number pad: where on it would say what was typed.
  const priv = target.closest('[data-jprivate]')
  if (priv) {
    const r = priv.getBoundingClientRect()
    return { el: 'keyboard', id: 'keyboard', ref: null, hit: 1, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }
  const el = target.closest(INTERACTIVE)
  if (!el) {
    // The grey around an open sheet closes it.
    if (target.closest('.k-overlay') && !target.closest('.k-sheet')) return { el: 'outside the window', id: 'k-overlay', ref: null, hit: 1 }
    const near = target.closest('[data-testid]')
    const words = near?.dataset.testid ? near.dataset.testid.replace(/^k-/, '').replace(/-/g, ' ') : 'the screen'
    return { el: words, id: near?.dataset.testid || null, ref: refOf(target), hit: 0 }
  }
  const off = el.disabled || el.getAttribute('aria-disabled') === 'true'
  return {
    // The words as written (innerText would take the design's capitals).
    el: clean(el.getAttribute('aria-label') || el.textContent || el.dataset.testid),
    id: el.dataset.testid || null,
    ref: refOf(el),
    hit: off ? 2 : 1,
  }
}

function refOf(el) {
  const host = el.closest('[data-item], [data-section], [data-type], [data-lang], [data-code], [data-group], [data-step]')
  if (!host) return null
  const d = host.dataset
  return (d.item || d.section || d.type || d.lang || d.code || d.group || d.step || '').slice(0, 60) || null
}

function onDown(e) {
  lastTouch = now()
  if (!enabled || staffTouch(e.target)) { down = null; return }
  if (!rec) {
    const s = getState()
    if (!allowed(s)) return
    open(s)
  }
  down = { x: e.clientX, y: e.clientY, at: now(), target: e.target, id: e.pointerId }
}

function onUp(e) {
  const d = down
  if (!d || !rec || e.pointerId !== d.id) return
  down = null
  const info = describeTouch(d.target)
  const t = now() - rec.t0
  const x = Math.round(info.x ?? d.x)
  const y = Math.round(info.y ?? d.y)
  delete info.x
  delete info.y
  if (info.el !== 'keyboard' && Math.hypot(e.clientX - d.x, e.clientY - d.y) > SWIPE_PX) {
    push({ t, k: 'swipe', x, y, x2: Math.round(e.clientX), y2: Math.round(e.clientY), ms: now() - d.at, el: info.el, id: info.id })
  } else {
    push({ t, k: 'tap', x, y, ...info })
  }
}

/** A scrolling box's place in the kiosk: its child numbers from the kiosk's root ("0/1/2"). */
export function boxPath(el, root = document.querySelector('.k-root')) {
  if (!root || !(el instanceof Element) || el === root || !root.contains(el)) return null
  const parts = []
  let node = el
  while (node && node !== root) {
    const parent = node.parentElement
    if (!parent) return null
    parts.unshift([...parent.children].indexOf(node))
    node = parent
  }
  return parts.join('/')
}

export function boxAt(path, root = document.querySelector('.k-root')) {
  let node = root
  for (const i of String(path).split('/')) {
    node = node?.children?.[Number(i)]
    if (!node) return null
  }
  return node
}

function onScroll(e) {
  if (!rec || !enabled) return
  const el = e.target
  if (!(el instanceof Element) || staffTouch(el)) return
  const path = boxPath(el)
  if (!path) return
  const fire = () => {
    scrollTimers.delete(path)
    if (rec) push({ t: now() - rec.t0, k: 'scroll', s: path, y: Math.round(el.scrollTop), x: Math.round(el.scrollLeft) })
  }
  if (!scrollTimers.has(path)) scrollTimers.set(path, setTimeout(fire, SCROLL_MS))
}

// The window and the kiosk's box in it (viewport.js: bars when the screen
// isn't the design's shape), so a replay draws both as they were.
function vpEvent(t) {
  const b = kioskBox(window.innerWidth, window.innerHeight, getState().config?.design?.screen)
  return { t, k: 'vp', w: window.innerWidth, h: window.innerHeight, b: [b.x, b.y, b.w, b.h] }
}

function onResize() {
  if (rec) push(vpEvent(now() - rec.t0))
}

// ── Kept on the device, sent when it can be ──────────────────────

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false } },
  del(key) { try { localStorage.removeItem(key) } catch { /* ignore */ } },
}

function saveSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveOpen, 3000)
}
function saveOpen() { if (rec) store.set(OPEN_KEY, rec) }

function enqueue(visit) {
  let queue = [...store.get(QUEUE_KEY, []), visit]
  // Oldest go first when the device is short of room (offline for days).
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
  while (queue.length > 1 && JSON.stringify(queue).length > MAX_QUEUE_CHARS) queue.shift()
  if (!store.set(QUEUE_KEY, queue)) store.set(QUEUE_KEY, queue.slice(-5))
}

/** A visit the page closed in the middle of: kept as cut short (the next time the kiosk opens). */
function recoverOpen() {
  const r = store.get(OPEN_KEY, null)
  store.del(OPEN_KEY)
  if (!r?.id || !Array.isArray(r.events) || r.events.length < 2) return
  const last = r.events[r.events.length - 1]?.t || 0
  r.events.push({ t: last, k: 'end', why: 'interrupted' })
  enqueue(finish(r))
}

let sending = false
let flushTimer = null
function flushSoon(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms) }

export async function flush() {
  if (sending) return
  const queue = store.get(QUEUE_KEY, [])
  if (!queue.length) return
  const batch = []
  let size = 0
  for (const v of queue) {
    const n = JSON.stringify(v).length
    if (batch.length && (batch.length >= BATCH || size + n > BATCH_CHARS)) break
    batch.push(v)
    size += n
  }
  sending = true
  try {
    const res = await kioskApi().post('/pos-api/kiosk/journeys', { sessions: batch }, { timeoutMs: 20000 })
    const done = new Set(res?.accepted || batch.map(v => v.id))
    store.set(QUEUE_KEY, store.get(QUEUE_KEY, []).filter(v => !done.has(v.id)))
    if (store.get(QUEUE_KEY, []).length) flushSoon(1000)
  } catch (err) {
    // A batch the server can't take (too big, malformed) would block every
    // later one: dropped. Offline, a server error or not paired: kept.
    if (err?.status === 400 || err?.status === 413) store.set(QUEUE_KEY, store.get(QUEUE_KEY, []).filter(v => !batch.some(b => b.id === v.id)))
  } finally {
    sending = false
  }
}

/** Start recording (a paired kiosk, KioskApp): returns the clean-up. */
export function startJourneys() {
  recoverOpen()
  const s = getState()
  lastEnded = s.ended?.n ?? null
  enabled = allowed(s)
  const unsub = subscribeKiosk(() => { enabled = allowed(getState()); onStore() })
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerup', onUp, true)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
  const onHide = () => saveOpen()
  window.addEventListener('pagehide', onHide)
  // The start screen left untouched with a visit open: the guest walked away.
  const idle = setInterval(() => {
    const st = getState()
    if (rec && st.screen === 'start' && !st.builder && now() - Math.max(lastTouch, rec.t0) > START_IDLE_MS) end('left')
  }, 5000)
  const every = setInterval(flush, 60_000)
  flushSoon(5000)
  return () => {
    unsub()
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('pagehide', onHide)
    clearInterval(idle)
    clearInterval(every)
    saveOpen()
  }
}

// ── Replay ───────────────────────────────────────────────────────

/** Replay mode (KioskApp with replay): show each moment the player sends. */
export function listenForReplay() {
  const onMessage = e => {
    if (e.source !== window.parent || e.data?.type !== 'kiosk.replay') return
    const view = e.data.view || {}
    const frame = {}
    for (const [k, v] of Object.entries(view)) if (k.startsWith('ui:')) frame[k.slice(3)] = v
    replayUi = frame
    const b = e.data.box
    replayBox = Array.isArray(b) && b.length === 4 && b.every(n => Number.isFinite(n)) ? (replayBox?.join() === b.join() ? replayBox : b) : null
    replayView(view)
    for (const l of replayListeners) l()
    // Scrolling boxes where they were, once the screen is drawn.
    const scroll = e.data.scroll || {}
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const [path, at] of Object.entries(scroll)) {
        const el = boxAt(path)
        if (el) { el.scrollTop = at.y || 0; el.scrollLeft = at.x || 0 }
      }
      const c = getState().config
      const missing = [view.builder?.item_id, ...(view.basket || []).map(x => x.item_id)].filter(id => id && !configItem(c, id))
      try { e.source.postMessage({ type: 'kiosk.replayed', missing: [...new Set(missing)] }, e.origin) } catch { /* gone */ }
    }))
  }
  replayUi = {}
  for (const l of replayListeners) l()
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
