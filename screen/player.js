// The menu screens' player (migration 166). Plain ES module, no build step:
// served with the shared files it imports by api/src/routes/screenSite.js on
// screens.<root domain>. Runs in Chrome (installed as an app, or a kiosk tab)
// and in Fully Kiosk Browser on Android.
//
//   not paired   asks /screen-api/pairings for a code, shows it big, and
//                checks every few seconds whether someone typed it into
//                Admin > Screens. The secret never leaves this device.
//   paired       downloads its config (boards, playlist, live menus, sold
//                out), keeps the last one in localStorage, and shows boards
//                with shared/screenLayout.js, the same renderer as the admin
//                board designer. Updates arrive over the WebSocket (and a
//                poll every minute as a fallback); offline it keeps showing
//                the last config, with images, videos and fonts from the
//                cache (sw.js).
//
// Screens keep in step without talking to each other (migration 167): the
// clock is set from the server (a few /screen-api/time calls, lowest round
// trip wins), which board is on comes from that clock (playlistPosition()),
// the next board is drawn hidden a few seconds early so its transition can
// start on the second, and videos are nudged to where the clock says they
// should be. A screen in a wall shows only its own part of the board
// (wallRegion()), so the wall moves as one picture.

import {
  boardContext, renderBoardHtml, SCREEN_LAYOUT_CSS, boardFontsUrl, boardImageUrls, boardVideoUrls, itemsOnAt, localParts,
  clockText, playlistPosition, replayStart, wallRegion, transitionFrames, startBoardMotion, DEFAULT_TRANSITION_MS,
  orderChanges, keepOrderChanges, ORDER_CHANGE_KEEP_MS,
} from '/lib/screenLayout.js'

const APP_VERSION = '1.2.0'
const PLAYER_VERSION = document.querySelector('meta[name="player-version"]')?.content || ''
const KEYS = { device: 'mcrn_screen_device', config: 'mcrn_screen_config', pairing: 'mcrn_screen_pairing', reloaded: 'mcrn_screen_reloaded_at' }
const POLL_MS = 60_000
const HEARTBEAT_MS = 60_000
const PAIR_POLL_MS = 3_000

const stage = document.getElementById('stage')
const identifyEl = document.getElementById('identify')
const hintEl = document.getElementById('hint')

let device = load(KEYS.device)       // { id, secret }
let config = load(KEYS.config)
let clockOffset = 0                   // server time - this device's time, ms
let clockRtt = null                   // round trip of the best time sample (null: not set from /time yet)
let offlineSince = null
let lastError = null
let showing = null                    // { design_id, name, playlist_item_id }

// ── Storage ──────────────────────────────────────────────────────

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function save(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)) } catch { /* full or private */ }
}

const nowMs = () => Date.now() + clockOffset
const now = () => new Date(nowMs())

// A rough setting from any API answer, until /time has set it properly.
function setServerTime(iso) {
  if (clockRtt != null) return
  const t = Date.parse(iso)
  if (Number.isFinite(t)) clockOffset = t - Date.now()
}

// The server's clock to a few milliseconds: five round trips, keep the
// quickest (its half-way point is when the server read its clock).
async function syncClock() {
  let best = null
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now()
    try {
      const r = await fetch('/screen-api/time', { cache: 'no-store' })
      const { now: server } = await r.json()
      const t1 = Date.now()
      if (Number.isFinite(server) && (!best || t1 - t0 < best.rtt)) best = { rtt: t1 - t0, offset: server + (t1 - t0) / 2 - t1 }
    } catch { /* offline: keep what we have */ }
    await new Promise(res => setTimeout(res, 120))
  }
  if (!best) return
  const moved = Math.abs(best.offset - clockOffset)
  clockOffset = best.offset
  clockRtt = best.rtt
  if (moved > 250 && config) schedule()
}

// ── API ──────────────────────────────────────────────────────────

async function api(path, { method = 'GET', body, auth } = {}) {
  const headers = { Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'
  if (auth) headers.Authorization = auth
  let res
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
  } catch (e) {
    const err = new Error('offline'); err.offline = true; throw err
  }
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText)
    err.status = res.status; err.code = data && data.code
    throw err
  }
  if (offlineSince) offlineSince = null
  return data
}

const screenAuth = () => 'Screen ' + device.id + '.' + device.secret

function deviceInfo() {
  return {
    width: Math.round(window.screen?.width || window.innerWidth),
    height: Math.round(window.screen?.height || window.innerHeight),
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    ua: navigator.userAgent.slice(0, 280),
    kiosk: typeof window.fully !== 'undefined',
    app_version: APP_VERSION,
  }
}

// ── Panels (pairing, messages) ───────────────────────────────────

function panel(html) {
  clearBoard()
  let el = document.getElementById('panel')
  if (!el) {
    el = document.createElement('div')
    el.id = 'panel'
    el.className = 'panel'
    document.body.appendChild(el)
  }
  el.innerHTML = '<img class="logo" src="/icon.svg" alt="">' + html
}
function hidePanel() { document.getElementById('panel')?.remove() }

const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ── Pairing ──────────────────────────────────────────────────────

let pairTimer = null

async function startPairing() {
  stopPaired()
  clearTimeout(pairTimer)
  let pairing = load(KEYS.pairing)
  if (!pairing || Date.parse(pairing.expires_at) - Date.now() < 30_000) {
    try {
      pairing = await api('/screen-api/pairings', { method: 'POST', body: { device: deviceInfo() } })
      save(KEYS.pairing, pairing)
    } catch (e) {
      panel('<h1>Can\'t reach Macaroonie</h1><p>Check this screen\'s internet connection. Trying again…</p>')
      pairTimer = setTimeout(startPairing, 10_000)
      return
    }
  }
  showCode(pairing)
  pollPairing(pairing)
}

function showCode(p) {
  const info = deviceInfo()
  const left = Math.max(0, Math.round((Date.parse(p.expires_at) - Date.now()) / 60000))
  panel(
    '<h1>Add this screen in Macaroonie</h1>' +
    '<div class="code" data-code>' + escHtml(p.code) + '</div>' +
    '<p>In the admin, open <strong>Screens</strong>, press <strong>Add screen</strong> and type this code.</p>' +
    '<p class="small">Screen ' + Math.round(info.width * info.dpr) + ' x ' + Math.round(info.height * info.dpr) + ' · code changes in about ' + Math.max(1, left) + ' min</p>'
  )
}

async function pollPairing(p) {
  clearTimeout(pairTimer)
  if (Date.parse(p.expires_at) <= Date.now()) { save(KEYS.pairing, null); startPairing(); return }
  try {
    const r = await api('/screen-api/pairings/' + p.id, { auth: 'Pairing ' + p.secret })
    if (r.status === 'paired' && r.screen_id) {
      device = { id: r.screen_id, secret: p.secret }
      save(KEYS.device, device)
      save(KEYS.pairing, null)
      save(KEYS.config, null)
      config = null
      panel('<h1>Paired</h1><p>Loading this screen\'s boards…</p>')
      startPaired()
      return
    }
    if (r.status === 'expired') { save(KEYS.pairing, null); startPairing(); return }
    showCode(p)
  } catch (e) {
    if (e.status === 404) { save(KEYS.pairing, null); startPairing(); return }
  }
  pairTimer = setTimeout(() => pollPairing(p), PAIR_POLL_MS)
}

function unpair(message) {
  save(KEYS.device, null)
  save(KEYS.config, null)
  device = null
  config = null
  stopPaired()
  if (message) panel('<h1>' + escHtml(message) + '</h1><p>Getting a new code…</p>')
  setTimeout(startPairing, message ? 2500 : 0)
}

// ── Paired ───────────────────────────────────────────────────────

let pollTimer = null
let beatTimer = null
let tickTimer = null
let clockTimer = null
let videoTimer = null
let ws = null
let wsTimer = null
// Order numbers for Order status blocks (config.needs_orders): fetched on
// start, on a kitchen.board push and every ORDERS_MS as a check.
let orders = null
let orderMoves = []
let movesTimer = null
let ordersTimer = null
let ordersSoon = null
const ORDERS_MS = 15_000
let wsDelay = 2000
let wsOpenedBefore = false

function startPaired() {
  if (config) applyConfig()
  syncClock().then(() => { if (config) schedule() })
  fetchConfig()
  connect()
  clearInterval(pollTimer); pollTimer = setInterval(fetchConfig, POLL_MS)
  clearInterval(beatTimer); beatTimer = setInterval(heartbeat, HEARTBEAT_MS)
  clearInterval(tickTimer); tickTimer = setInterval(tick, 5000)
  clearInterval(clockTimer); clockTimer = setInterval(syncClock, 10 * 60_000)
  clearInterval(videoTimer); videoTimer = setInterval(syncVideos, 1000)
  clearInterval(ordersTimer); ordersTimer = setInterval(fetchOrders, ORDERS_MS)
  setTimeout(heartbeat, 5000)
}

function stopPaired() {
  clearInterval(pollTimer); clearInterval(beatTimer); clearInterval(tickTimer); clearInterval(clockTimer); clearInterval(videoTimer)
  clearInterval(ordersTimer); clearTimeout(ordersSoon)
  clearTimeout(slotTimer); clearTimeout(prepTimer); clearTimeout(replayTimer); clearTimeout(wsTimer)
  if (ws) { ws.onclose = null; try { ws.close() } catch { /* closed */ } ws = null }
}

let fetching = false
async function fetchConfig() {
  if (!device || fetching) return
  fetching = true
  try {
    const r = await api('/screen-api/config' + (config?.version ? '?version=' + encodeURIComponent(config.version) : ''), { auth: screenAuth() })
    setServerTime(r.server_time)
    if (!r.unchanged) {
      config = r
      save(KEYS.config, r)
      if (maybeReloadForNewPlayer()) return
      applyConfig()
    } else if (!stage.firstChild && config) {
      applyConfig()
    }
    lastError = null
  } catch (e) {
    if (e.offline) { offlineSince = offlineSince || Date.now(); if (!config) panel('<h1>Can\'t reach Macaroonie</h1><p>This screen will show its boards as soon as it is back online.</p>') }
    else if (e.status === 401) unpair('This screen was removed')
    else if (e.status === 403) panel('<h1>' + escHtml(e.message) + '</h1>')
    else lastError = e.message
  } finally {
    fetching = false
  }
}

// After a deploy the config names a new player version: load it (at most
// once every five minutes, so a mismatch can't loop).
function maybeReloadForNewPlayer() {
  if (!config?.player_version || !PLAYER_VERSION || PLAYER_VERSION.startsWith('__') || config.player_version === PLAYER_VERSION) return false
  const last = Number(sessionStorage.getItem(KEYS.reloaded) || 0)
  if (Date.now() - last < 5 * 60_000) return false
  try { sessionStorage.setItem(KEYS.reloaded, String(Date.now())) } catch { /* private */ }
  location.reload()
  return true
}

function connect() {
  clearTimeout(wsTimer)
  if (!device) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  try {
    ws = new WebSocket(proto + '//' + location.host + '/ws?screen=' + encodeURIComponent(device.id) + '&secret=' + encodeURIComponent(device.secret))
  } catch { scheduleReconnect(); return }
  // Back after a drop: a change made meanwhile was pushed to nobody, so ask.
  ws.onopen = () => { wsDelay = 2000; if (wsOpenedBefore) fetchConfig(); wsOpenedBefore = true }
  ws.onmessage = ev => {
    let m
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.type === 'screens.changed' || m.type === 'menus.live' || m.type === 'screen.removed') fetchConfig()
    else if (m.type === 'screens.sold_out' && config) {
      config = { ...config, sold_out: Array.isArray(m.item_ids) ? m.item_ids : [] }
      save(KEYS.config, config)
      redraw()
    }
    else if (m.type === 'kitchen.board') { clearTimeout(ordersSoon); ordersSoon = setTimeout(fetchOrders, 250) }
    else if (m.type === 'screen.identify') identify(Number(m.seconds) || 20)
    else if (m.type === 'screen.reload') location.reload()
  }
  ws.onclose = ev => {
    ws = null
    if (ev.code === 4003) { fetchConfig() }   // refused: the config call says whether we were removed
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  clearTimeout(wsTimer)
  wsTimer = setTimeout(connect, wsDelay)
  wsDelay = Math.min(30_000, wsDelay * 2)
}

async function heartbeat() {
  if (!device) return
  try {
    const r = await api('/screen-api/heartbeat', {
      method: 'POST', auth: screenAuth(),
      body: {
        app_version: APP_VERSION, showing,
        viewport: { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) },
        error: lastError, config_version: config?.version || null,
        offline_secs: offlineSince ? Math.round((Date.now() - offlineSince) / 1000) : 0,
        clock: clockRtt == null ? null : { offset_ms: Math.round(clockOffset), rtt_ms: Math.round(clockRtt) },
      },
    })
    setServerTime(r.server_time)
  } catch (e) {
    if (e.offline) offlineSince = offlineSince || Date.now()
    else if (e.status === 401) unpair('This screen was removed')
  }
}

// ── Showing boards ───────────────────────────────────────────────

const PREP_MS = 3000      // draw the next board this long before it comes on

let slotTimer = null      // the next board
let prepTimer = null      // drawing the next board early
let replayTimer = null    // playing the block animations again
let current = null        // { key, list, index, item, startMs, endMs, design_id, html, layer, board }
let prepared = null       // the next board, drawn hidden: { key, index, startMs, layer, html, board }
let lastKey = null

function fontsFor(designs) {
  for (const d of designs) {
    const url = boardFontsUrl(d.layout)
    if (!url || document.querySelector('link[data-fonts="' + CSS.escape(url) + '"]')) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = url; link.dataset.fonts = url
    document.head.appendChild(link)
  }
}

// Every video this screen's boards play: sw.js keeps them on the device
// (and lets go of videos no board uses any more).
function cacheVideos() {
  if (!('serviceWorker' in navigator)) return
  const urls = [...new Set(Object.values(config?.designs || {}).flatMap(d => boardVideoUrls(d.layout)))]
    .map(u => new URL(u, location.href).href)
  navigator.serviceWorker.ready.then(reg => reg.active?.postMessage({ type: 'videos', urls })).catch(() => {})
}

// The order numbers (preparing / ready) the kitchen screens keep.
async function fetchOrders() {
  if (!device || !config?.needs_orders) return
  try {
    const r = await api('/screen-api/orders', { auth: screenAuth() })
    setServerTime(r.server_time)
    const next = r.orders || { preparing: [], ready: [] }
    const changed = JSON.stringify(next) !== JSON.stringify(orders)
    // Numbers that changed status, for the blocks' change animation; drawn
    // again once the animations are over (the leaving numbers go).
    const t = Math.floor(nowMs())
    orderMoves = keepOrderChanges([...orderMoves, ...orderChanges(orders, next, t)], t)
    orders = next
    if (orderMoves.length) { clearTimeout(movesTimer); movesTimer = setTimeout(redraw, ORDER_CHANGE_KEEP_MS + 50) }
    // Ready numbers also leave the board by time (clear_mins): draw again.
    const anyReady = (orders.ready || []).length || Object.values(orders.boards || {}).some(b => (b.ready || []).length)
    if (changed || anyReady) redraw()
  } catch { /* offline: keep the last numbers */ }
}

function applyConfig() {
  hidePanel()
  if (config.needs_orders && !orders) fetchOrders()
  fontsFor(Object.values(config.designs || {}))
  cacheVideos()
  schedule({ fresh: true })
  // The screen's own settings (turned, fit, its place on a wall) may have
  // changed while the board stayed the same: fit what is on screen again.
  for (const l of stage.querySelectorAll('.layer')) fit(l)
}

// The boards to take turns now: the playlist's items on at this time, or the one board.
function activeList() {
  if (!config) return []
  if (config.playlist) {
    const parts = localParts(now(), config.venue?.timezone)
    return itemsOnAt(config.playlist.items, parts).filter(i => config.designs[i.design_id])
  }
  if (config.design_id && config.designs[config.design_id]) return [{ id: null, design_id: config.design_id, duration_secs: 0, transition: 'none' }]
  return []
}
const listKey = list => list.map(i => (i.id || '') + ':' + i.design_id + ':' + i.duration_secs).join('|')

// Which board should be on now and when it came on. Several boards: from
// the clock, the same on every screen. One board: since it came on.
function positionNow(list, key) {
  if (list.length > 1) return playlistPosition(list, nowMs())
  const same = current && current.key === key && current.index === 0
  return { index: 0, startMs: same ? current.startMs : nowMs(), endMs: null }
}

/**
 * Puts the right board on (with its transition when one board follows
 * another) and sets the timers for the next one. fresh: the config
 * changed, so a board that stays on is drawn again.
 */
function schedule({ fresh = false } = {}) {
  clearTimeout(slotTimer)
  clearTimeout(prepTimer)
  if (!config) return
  const list = activeList()
  const key = listKey(list)
  lastKey = key
  if (!list.length) { showNothing(); return }
  hidePanel()
  if (fresh) dropPrepared()
  const pos = positionNow(list, key)
  const item = list[pos.index]
  const same = current && current.key === key && current.index === pos.index && current.design_id === item.design_id &&
    Math.abs(current.startMs - pos.startMs) < 1500 && current.layer?.isConnected
  if (same) {
    if (fresh) redraw()
  } else {
    show(list, key, pos, !!current?.layer?.isConnected)
  }
  if (pos.endMs) {
    slotTimer = setTimeout(() => schedule(), Math.max(50, pos.endMs - nowMs() + 30))
    prepTimer = setTimeout(() => prepareNext(list, key, pos), Math.max(0, pos.endMs - nowMs() - PREP_MS))
  }
}

// A board drawn into a layer, not yet on screen. Its videos wait for
// syncVideos() to start them at the right moment.
function buildLayer(item, { hidden = false } = {}) {
  const design = config.designs[item.design_id]
  const ctx = boardContext(design.layout, {
    menus: config.menus, sold_out: config.sold_out, tags: config.tags, allergen_notice: config.allergen_notice,
    now: now(), tz: config.venue?.timezone, width: design.width, height: design.height,
    // A real screen never shows the designer's example numbers.
    orders: { ...(orders || { preparing: [], ready: [] }), changes: keepOrderChanges(orderMoves, nowMs()) },
  })
  const html = renderBoardHtml(ctx)
  const layer = document.createElement('div')
  layer.className = 'layer' + (hidden ? ' prep' : '')
  layer.innerHTML = html
  layer.dataset.w = design.width
  layer.dataset.h = design.height
  for (const v of layer.querySelectorAll('video')) {
    v.removeAttribute('autoplay')
    v.autoplay = false
    v.addEventListener('loadedmetadata', () => { if (current?.layer === layer) syncVideos() })
  }
  return { layer, html, design, ctx, board: ctx.board }
}

function dropPrepared() {
  if (prepared?.layer) prepared.layer.remove()
  prepared = null
}

// The next board, drawn hidden a few seconds early: its images and videos
// load while the current one shows, so the change happens on the second.
function prepareNext(list, key, pos) {
  if (!config || !pos.endMs || list.length < 2) return
  const next = playlistPosition(list, pos.endMs + 1)
  if (!next) return
  dropPrepared()
  try {
    const built = buildLayer(list[next.index], { hidden: true })
    stage.appendChild(built.layer)
    fit(built.layer)
    prepared = { ...built, key, index: next.index, startMs: next.startMs }
  } catch (e) {
    lastError = 'Next board: ' + e.message
  }
}

let showSeq = 0
async function show(list, key, pos, animate) {
  const item = list[pos.index]
  const seq = ++showSeq
  let built
  if (prepared && prepared.key === key && prepared.index === pos.index && Math.abs(prepared.startMs - pos.startMs) < 1500 && prepared.layer.isConnected) {
    built = prepared
    prepared = null
  } else {
    dropPrepared()
    try {
      built = buildLayer(item, { hidden: true })
    } catch (e) {
      lastError = 'Board ' + (config.designs[item.design_id]?.name || '') + ': ' + e.message
      console.error(e)
      return
    }
    // Images first, so the board doesn't appear half drawn (shorter when
    // it is replacing another board, to stay on time).
    stage.appendChild(built.layer)
    fit(built.layer)
    await preload(boardImageUrls(built.design.layout, built.ctx), animate ? 1200 : 4000)
    if (seq !== showSeq || !built.layer.isConnected) return
  }
  const olds = [...stage.querySelectorAll('.layer')].filter(l => l !== built.layer && !l.classList.contains('prep'))
  built.layer.classList.remove('prep')
  current = {
    key, list, index: pos.index, item, startMs: pos.startMs, endMs: pos.endMs, design_id: item.design_id,
    html: built.html, layer: built.layer, board: built.board,
  }
  showing = { design_id: item.design_id, name: built.design.name, playlist_item_id: item.id || null }
  startMotion()
  syncVideos()

  const kind = animate ? (item.transition || 'fade') : 'none'
  const ms = Number(item.transition_ms ?? DEFAULT_TRANSITION_MS)
  const frames = transitionFrames(kind, built.design.width, built.design.height)
  const boardEl = built.layer.querySelector('.sl-board')
  if (frames && ms > 0 && boardEl?.animate) {
    // Every screen of a wall is at the same point of the change, whenever
    // its timer happened to fire.
    const into = Math.min(ms, Math.max(0, nowMs() - pos.startMs))
    const opts = { duration: ms, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' }
    const a = boardEl.animate(frames.in, opts)
    a.currentTime = into
    const outs = frames.out ? olds.map(o => o.querySelector('.sl-board')?.animate(frames.out, opts)).filter(Boolean) : []
    for (const o of outs) o.currentTime = into
    const done = () => { olds.forEach(o => o.remove()); try { a.cancel() } catch { /* gone */ } }
    a.finished.then(done, done)
    setTimeout(() => olds.forEach(o => o.remove()), ms + 1500)
  } else {
    olds.forEach(o => o.remove())
  }
}

// Draws the board on screen again (sold out, a changed board), in place,
// with no transition; nothing happens when it would look the same.
function redraw() {
  if (!config) return
  if (!current?.layer?.isConnected) { schedule(); return }
  if (!config.designs[current.item.design_id]) { schedule(); return }
  let built
  try { built = buildLayer(current.item) } catch (e) { lastError = e.message; return }
  if (built.html === current.html) return
  current.layer.replaceWith(built.layer)
  fit(built.layer)
  current = { ...current, html: built.html, layer: built.layer, board: built.board }
  showing = { ...(showing || {}), name: built.design.name }
  startMotion()
  syncVideos()
}

// Block animations: entrances from when the board came on (or its last
// replay), movement on the shared clock.
function startMotion() {
  clearTimeout(replayTimer)
  if (!current?.layer) return
  const t = nowMs()
  startBoardMotion(current.layer.querySelector('.sl-board'), { startMs: replayStart(current.board, current.startMs, t), nowMs: t })
  const every = (current.board?.replay_secs || 0) * 1000
  if (every) replayTimer = setTimeout(startMotion, every - (t % every) + 20)
}

/**
 * Keeps videos where the clock says: from when the board came on in a
 * playlist, else from 1 January 1970, so a wall's screens play the same
 * frame. Small differences are caught up by speeding up or slowing down
 * a little, big ones by jumping.
 */
function syncVideos() {
  if (!current?.layer || !config) return
  const vids = current.layer.querySelectorAll('video')
  if (!vids.length) return
  const t = nowMs()
  const from = current.list.length > 1 ? current.startMs : 0
  const jumpAt = config.wall ? 0.5 : 1.5
  for (const v of vids) {
    let o = {}
    try { o = JSON.parse(v.dataset.slVideo || '{}') } catch { /* defaults */ }
    const loop = o.loop !== false
    if (o.sound && v.muted && !v.dataset.soundTried) { v.dataset.soundTried = '1'; v.muted = false }
    const play = () => v.play().catch(() => { if (!v.muted) { v.muted = true; v.play().catch(() => {}) } })
    const d = v.duration
    if (!(d > 0) || !Number.isFinite(d)) { if (v.paused) play(); continue }
    const elapsed = Math.max(0, (t - from) / 1000)
    const want = loop ? elapsed % d : Math.min(elapsed, Math.max(0, d - 0.05))
    let diff = v.currentTime - want
    if (loop && Math.abs(diff) > d / 2) diff -= Math.sign(diff) * d
    if (Math.abs(diff) > jumpAt) {
      try { v.currentTime = want } catch { /* not seekable yet */ }
      v.playbackRate = 1
    } else if (Math.abs(diff) > 0.03) {
      v.playbackRate = Math.min(1.1, Math.max(0.9, 1 - diff * 0.5))
    } else if (v.playbackRate !== 1) {
      v.playbackRate = 1
    }
    if (v.paused && (loop || want < d - 0.1)) play()
  }
}

function showNothing() {
  clearTimeout(slotTimer)
  clearTimeout(prepTimer)
  clearTimeout(replayTimer)
  dropPrepared()
  current = null
  showing = null
  clearBoard()
  if (!config.playlist && !config.design_id) {
    panel('<h1>' + escHtml(config.screen?.name || 'Screen') + ' (' + escHtml(config.screen?.short_code || '') + ')</h1>' +
      '<p>Paired. Pick a board or a playlist for this screen in Admin &gt; Screens.</p>')
  }
}

function clearBoard() {
  stage.innerHTML = ''
}

function preload(urls, ms) {
  if (!urls.length) return Promise.resolve()
  return Promise.race([
    Promise.all(urls.map(u => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = u }))),
    new Promise(res => setTimeout(res, ms)),
  ])
}

/**
 * Scales the board to the screen, turned by the screen's rotation. A
 * screen in a wall shows only its part of the board (wallRegion()),
 * filling the screen with it.
 */
function fit(layer) {
  const W = Number(layer.dataset.w), H = Number(layer.dataset.h)
  const r = wallRegion(W, H, config?.wall)
  const rot = Number(config?.screen?.rotation) || 0
  const turned = rot === 90 || rot === 270
  const vw = window.innerWidth, vh = window.innerHeight
  // In the board's own axes: its width runs along the screen's height when turned.
  const alongW = turned ? vh : vw
  const alongH = turned ? vw : vh
  const fitMode = config?.screen?.fit || 'contain'
  let sx, sy
  if (fitMode === 'stretch') { sx = alongW / r.w; sy = alongH / r.h }
  else {
    const s = fitMode === 'cover' ? Math.max(alongW / r.w, alongH / r.h) : Math.min(alongW / r.w, alongH / r.h)
    sx = sy = s
  }
  const tx = W / 2 - (r.x + r.w / 2)
  const ty = H / 2 - (r.y + r.h / 2)
  layer.style.width = W + 'px'
  layer.style.height = H + 'px'
  layer.style.marginLeft = (-W / 2) + 'px'
  layer.style.marginTop = (-H / 2) + 'px'
  layer.style.transform = 'rotate(' + rot + 'deg) scale(' + sx + ',' + sy + ') translate(' + tx + 'px,' + ty + 'px)'
}

function tick() {
  if (!config) return
  // A new time of day can change the playlist's boards.
  const key = listKey(activeList())
  if (key !== lastKey || (key && !current)) { schedule(); return }
  if (!current?.layer) return
  const tz = config.venue?.timezone
  for (const el of current.layer.querySelectorAll('[data-sl-clock]')) {
    let o = {}
    try { o = JSON.parse(el.getAttribute('data-sl-clock')) } catch { /* default */ }
    const text = clockText(o, now(), tz)
    if (el.textContent !== text) el.textContent = text
  }
}

// ── Identify, full screen, wake lock, cursor ─────────────────────

let identifyTimer = null
function identify(seconds) {
  const s = config?.screen || {}
  identifyEl.querySelector('.id').textContent = s.short_code || ''
  identifyEl.querySelector('.name').textContent = s.name || ''
  identifyEl.querySelector('.meta').textContent = (config?.venue?.name || '') + ' · ' + (s.width || '') + ' x ' + (s.height || '') +
    (s.rotation ? ' · turned ' + s.rotation + '°' : '') + (showing?.name ? ' · showing ' + showing.name : '')
  identifyEl.classList.add('on')
  clearTimeout(identifyTimer)
  identifyTimer = setTimeout(() => identifyEl.classList.remove('on'), Math.min(120, seconds) * 1000)
}
identifyEl.addEventListener('click', () => identifyEl.classList.remove('on'))

let wakeLock = null
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => { wakeLock = null })
    }
  } catch { /* not allowed here (Fully Kiosk keeps the screen on itself) */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { keepAwake(); if (device) fetchConfig() }
})

const standalone = () => window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches
function offerFullscreen() {
  if (standalone() || typeof window.fully !== 'undefined' || document.fullscreenElement || !document.documentElement.requestFullscreen) return
  hintEl.classList.add('on')
  setTimeout(() => hintEl.classList.remove('on'), 12_000)
}
document.addEventListener('click', () => {
  hintEl.classList.remove('on')
  if (!document.fullscreenElement && document.documentElement.requestFullscreen && !standalone()) {
    document.documentElement.requestFullscreen().catch(() => {})
  }
  keepAwake()
})

let idleTimer = null
function wake() {
  document.body.classList.remove('idle')
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000)
}
document.addEventListener('mousemove', wake)
wake()

window.addEventListener('resize', () => { for (const l of stage.children) fit(l) })
// Fonts arriving change text widths: measure the scrolling text again.
document.fonts?.addEventListener?.('loadingdone', () => { if (current?.layer) startMotion() })
window.addEventListener('online', () => { if (device) { fetchConfig(); if (!ws) connect() } })

// ── Start ────────────────────────────────────────────────────────

const style = document.createElement('style')
style.textContent = SCREEN_LAYOUT_CSS
document.head.appendChild(style)

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

keepAwake()
offerFullscreen()
if (device?.id && device?.secret) startPaired()
else startPairing()

// For tests and support: what this screen is doing.
window.__screen = {
  get device() { return device ? { id: device.id } : null },
  get config() { return config },
  get showing() { return showing },
  get socket() { return ws ? ws.readyState : -1 },
  get clock() { return { offset_ms: clockOffset, rtt_ms: clockRtt, now: nowMs() } },
  get current() { return current ? { index: current.index, startMs: current.startMs, endMs: current.endMs, design_id: current.design_id } : null },
  get prepared() { return prepared ? { index: prepared.index, startMs: prepared.startMs } : null },
  version: PLAYER_VERSION,
}
