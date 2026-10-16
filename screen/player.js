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
//                the last config, with images and fonts from the cache
//                (sw.js).

import {
  boardContext, renderBoardHtml, SCREEN_LAYOUT_CSS, boardFontsUrl, boardImageUrls, itemsOnAt, localParts, clockText,
} from '/lib/screenLayout.js'

const APP_VERSION = '1.0.0'
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

const now = () => new Date(Date.now() + clockOffset)

function setServerTime(iso) {
  const t = Date.parse(iso)
  if (Number.isFinite(t)) clockOffset = t - Date.now()
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
let ws = null
let wsTimer = null
let wsDelay = 2000

function startPaired() {
  if (config) render(true)
  fetchConfig()
  connect()
  clearInterval(pollTimer); pollTimer = setInterval(fetchConfig, POLL_MS)
  clearInterval(beatTimer); beatTimer = setInterval(heartbeat, HEARTBEAT_MS)
  clearInterval(tickTimer); tickTimer = setInterval(tick, 5000)
  setTimeout(heartbeat, 5000)
}

function stopPaired() {
  clearInterval(pollTimer); clearInterval(beatTimer); clearInterval(tickTimer); clearTimeout(slotTimer); clearTimeout(wsTimer)
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
      render(true)
    } else if (!stage.firstChild && config) {
      render(true)
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
  ws.onopen = () => { wsDelay = 2000 }
  ws.onmessage = ev => {
    let m
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.type === 'screens.changed' || m.type === 'menus.live' || m.type === 'screen.removed') fetchConfig()
    else if (m.type === 'screens.sold_out' && config) {
      config = { ...config, sold_out: Array.isArray(m.item_ids) ? m.item_ids : [] }
      save(KEYS.config, config)
      render(false)
    }
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
      },
    })
    setServerTime(r.server_time)
  } catch (e) {
    if (e.offline) offlineSince = offlineSince || Date.now()
    else if (e.status === 401) unpair('This screen was removed')
  }
}

// ── Showing boards ───────────────────────────────────────────────

let slotTimer = null
let current = null       // { key, index, list }

function fontsFor(designs) {
  for (const d of designs) {
    const url = boardFontsUrl(d.layout)
    if (!url || document.querySelector('link[data-fonts="' + CSS.escape(url) + '"]')) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = url; link.dataset.fonts = url
    document.head.appendChild(link)
  }
}

// The boards to take turns now: the playlist's items on at this time, or the one board.
function activeList() {
  if (!config) return []
  if (config.playlist) {
    const parts = localParts(now(), config.venue?.timezone)
    return itemsOnAt(config.playlist.items, parts).filter(i => config.designs[i.design_id])
  }
  if (config.design_id && config.designs[config.design_id]) return [{ id: null, design_id: config.design_id, duration_secs: 0 }]
  return []
}

// fresh = start the rotation again (new config); else redraw what's showing.
function render(fresh) {
  if (!config) return
  hidePanel()
  fontsFor(Object.values(config.designs || {}))
  const list = activeList()
  const key = list.map(i => (i.id || '') + ':' + i.design_id).join('|')
  if (!list.length) {
    current = { key, index: 0, list }
    showNothing()
    return
  }
  if (fresh || !current || current.key !== key) {
    const keepId = current?.list[current.index]?.design_id
    const at = list.findIndex(i => i.design_id === keepId)
    current = { key, index: at >= 0 ? at : 0, list }
  }
  showItem(current.list[current.index])
}

function showNothing() {
  clearTimeout(slotTimer)
  showing = null
  clearBoard()
  if (!config.playlist && !config.design_id) {
    panel('<h1>' + escHtml(config.screen?.name || 'Screen') + ' (' + escHtml(config.screen?.short_code || '') + ')</h1>' +
      '<p>Paired. Pick a board or a playlist for this screen in Admin &gt; Screens.</p>')
  }
}

function nextSlot() {
  if (!current || current.list.length < 2) return
  current.index = (current.index + 1) % current.list.length
  showItem(current.list[current.index])
}

let renderSeq = 0
async function showItem(item) {
  clearTimeout(slotTimer)
  // Redrawing the board already showing (sold out, prices): no waiting.
  const sameItem = !!showing && showing.design_id === item.design_id && stage.children.length > 0
  const design = config.designs[item.design_id]
  const seq = ++renderSeq
  let html, ctx
  try {
    ctx = boardContext(design.layout, {
      menus: config.menus, sold_out: config.sold_out, tags: config.tags, allergen_notice: config.allergen_notice,
      now: now(), tz: config.venue?.timezone, width: design.width, height: design.height,
    })
    html = renderBoardHtml(ctx)
  } catch (e) {
    lastError = 'Board ' + design.name + ': ' + e.message
    console.error(e)
    return
  }
  // Images first, so the board doesn't appear half drawn (at most 4 s).
  if (!sameItem) await preload(boardImageUrls(design.layout, ctx), 4000)
  if (seq !== renderSeq) return
  const layer = document.createElement('div')
  layer.className = 'layer'
  layer.innerHTML = html
  layer.dataset.w = design.width
  layer.dataset.h = design.height
  stage.appendChild(layer)
  fit(layer)
  for (const old of [...stage.children]) if (old !== layer) old.remove()
  showing = { design_id: design.id, name: design.name, playlist_item_id: item.id || null }
  if (current && current.list.length > 1) {
    slotTimer = setTimeout(nextSlot, Math.max(3, Number(item.duration_secs) || 15) * 1000)
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

// Scale the board to the screen, turned by the screen's rotation.
function fit(layer) {
  const W = Number(layer.dataset.w), H = Number(layer.dataset.h)
  const rot = Number(config?.screen?.rotation) || 0
  const turned = rot === 90 || rot === 270
  const vw = window.innerWidth, vh = window.innerHeight
  // In the board's own axes: its width runs along the screen's height when turned.
  const alongW = turned ? vh : vw
  const alongH = turned ? vw : vh
  const fitMode = config?.screen?.fit || 'contain'
  let sx, sy
  if (fitMode === 'stretch') { sx = alongW / W; sy = alongH / H }
  else {
    const s = fitMode === 'cover' ? Math.max(alongW / W, alongH / H) : Math.min(alongW / W, alongH / H)
    sx = sy = s
  }
  layer.style.width = W + 'px'
  layer.style.height = H + 'px'
  layer.style.marginLeft = (-W / 2) + 'px'
  layer.style.marginTop = (-H / 2) + 'px'
  layer.style.transform = 'rotate(' + rot + 'deg) scale(' + sx + ',' + sy + ')'
}

function tick() {
  if (!config) return
  // A new time of day can change the playlist's boards.
  const key = activeList().map(i => (i.id || '') + ':' + i.design_id).join('|')
  if (!current || key !== current.key) { render(false); return }
  const tz = config.venue?.timezone
  for (const el of stage.querySelectorAll('[data-sl-clock]')) {
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
  version: PLAYER_VERSION,
}
