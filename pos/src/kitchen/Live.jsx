// The live kitchen view (Store tech > Kitchen screens > Live view).
//
// Every real kitchen screen of a venue on one page, scaled down, each the
// real kitchen screen app in a frame (BenchScreen.jsx with host kdsLive),
// showing the venue's kitchen orders as they are now. The page follows the
// orders once for every frame: the socket (/ws?kitchen_live=, the venue's
// till room) says when they change, and it asks /pos-api/kitchen-live/sync
// then (every 20 s as a check, every 3 s while the socket is down). The
// frames make the same calls they make to /pos-api (config, kitchen sync)
// through window.kdsLive.connect(screenId), answered from what the page has.
//
// It watches: the screens run view only (store.js asks the link at every
// tap), so a tap that would change an order says so and changes nothing.
// With a link made by someone with Store tech manage (can_bump), the Allow
// bumping switch lets taps through: off at every visit, it asks before it
// goes on, and while on the screens send their taps to
// /pos-api/kitchen-live/events (the same kitchen events a kitchen screen
// sends). The kitchen flow is never switched from here. Any screen
// can go full screen: the Fullscreen API on its card (webkit-prefixed on an
// iPad), else the card fills the window; the screen inside then lays itself
// out at that size, as a kitchen screen of that size would. &full=<screen>
// in the address opens with that screen filling the window.
//
// Below them, the venue's order ready boards: each the real menu screen
// player (screen/player.js in live mode) in a frame on the screens' address,
// ?board_live=<this link>&screen=<id> for a menu screen that shows an Order
// status block, as it shows now, or &board=<board station | all> for a plain
// board of those numbers. As set up: the menu screens (plain boards when
// there are none); One per station: a plain board per board station. The
// frames follow the numbers themselves (/screen-api/live/*, their own
// socket); full screen works as for the kitchen screens.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize, Minimize2, Volume2, VolumeX, Wifi, WifiOff, RefreshCw, AlertTriangle, Workflow, Clock, MonitorOff, Hand } from 'lucide-react'
import { benchScreens } from '@shared/pos/kitchenBench.js'
import { BUMP_KINDS, STALE_HOURS } from '@shared/pos/kitchen.js'

const cx = (...p) => p.filter(Boolean).join(' ')

// The tallest a board's frame is drawn in the grid (a portrait board is fitted inside).
const BOARD_MAX_H = 560

const SIZES = [
  { key: 'tablet', label: 'Tablet', w: 1280, h: 800 },
  { key: 'tv', label: 'TV', w: 1920, h: 1080 },
  { key: 'portrait', label: 'Portrait', w: 800, h: 1280 },
]
const PREFS_KEY = 'maca_kds_live'
// A device that asked within this long is on (it asks every 20 s; last seen is written once a minute).
const ON_MS = 3 * 60_000
const VIEW_ONLY = 'This is the live view: nothing changes from here. Tap on the kitchen screen itself.'
const BUMPING_OFF = 'Bumping is off in the live view: switch on Allow bumping at the top of the page first.'
const WATCH_ONLY = 'Watch only: this link can\'t bump. Open Live view again from Store tech (with Manage) to get one that can.'
// The socket's heartbeat (see the socket effect in useKitchenFeed).
const PING_EVERY_MS = 25000
const PONG_WAIT_MS = 10000
// How long the orange bar shows after bumping goes on.
const BUMP_NOTE_MS = 8000

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {} } catch { return {} }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

const hhmm = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')
function untilText(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = d.toDateString() === new Date().toDateString()
  return today ? hhmm(iso) : d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

// A short stamp of a screen's own settings, so a change reaches its frame (config version).
function stamp(v) {
  const s = JSON.stringify(v)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function useWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return undefined
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** Keep the screen on while the live view is open (a monitor or TV on the wall). */
function useWakeLock() {
  useEffect(() => {
    let lock = null
    const get = async () => { try { lock = await navigator.wakeLock?.request('screen') } catch { lock = null } }
    get()
    const onVis = () => { if (!document.hidden) get() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); try { lock?.release() } catch { /* ignore */ } }
  }, [])
}

class LinkGone extends Error {}

async function getJson(url, init = {}) {
  let res
  try {
    res = await fetch(url, { cache: 'no-store', ...init })
  } catch {
    throw Object.assign(new Error('No connection'), { offline: true })
  }
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) throw new LinkGone(body.error || 'This live view has run out')
  if (!res.ok) throw Object.assign(new Error(body.error || 'Macaroonie didn\'t answer'), { status: res.status, code: body.code })
  return body
}
const postJson = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Every tap of a batch refused with the same words (the screen drops them and says so). */
const refuseAll = (events, error, code = 'view_only') => ({ results: (events || []).map(e => ({ id: e.id, ok: false, error, code })), kitchen: [] })

export default function Live({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [gone, setGone] = useState(null)
  const [loadKey, setLoadKey] = useState(0)
  const tokenQ = encodeURIComponent(token)
  const hadData = useRef(false)
  hadData.current = !!data

  // The setup (screens, stations, flows, colours). Loaded again on a
  // pos.config push and every few minutes; the frames then ask for theirs.
  const reloadSetup = useCallback(async () => {
    try {
      const d = await getJson('/pos-api/kitchen-live?token=' + tokenQ)
      setData(prev => (prev && JSON.stringify(prev.screens) === JSON.stringify(d.screens) && JSON.stringify(prev.boards) === JSON.stringify(d.boards) &&
        prev.config.version === d.config.version && prev.expires_at === d.expires_at ? prev : d))
      setError(null)
      return d
    } catch (e) {
      if (e instanceof LinkGone) setGone(true)
      // After the first load the page carries on with what it has.
      else setError({ text: e.message, kept: hadData.current })
      return null
    }
  }, [tokenQ])

  useEffect(() => { setData(null); setError(null); reloadSetup() }, [reloadSetup, loadKey])
  useEffect(() => { document.title = 'Live kitchen' + (data?.venue?.name ? ' · ' + data.venue.name : '') }, [data])

  if (gone) {
    return <Message icon={Clock} title="This live view has run out" text="Open it again from Store tech, Kitchen screens: a live view link works for 12 hours." />
  }
  if (!data && error) {
    return <Message icon={AlertTriangle} title="Can't open the live view" text={error.text} action={<button className="btn btn-primary" onClick={() => setLoadKey(k => k + 1)}><RefreshCw size={18} /> Try again</button>} />
  }
  if (!data) return <div className="h-full flex items-center justify-center text-muted">Loading the kitchen...</div>
  if (!data.config.stations.some(s => BUMP_KINDS.includes(s.kind))) {
    return <Message icon={Workflow} title="No kitchen stations yet" text="Add stations (Grill, Fryer, Pass...) in Store tech, Kitchen screens, then open the live view again." />
  }
  return <LivePage data={data} token={token} reloadSetup={reloadSetup} onGone={() => setGone(true)} setupError={error?.kept ? error.text : null} />
}

function Message({ icon: Icon, title, text, action }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="card p-8 max-w-md text-center space-y-3" data-testid="live-message">
        <Icon className="mx-auto text-muted" size={40} />
        <div className="text-xl font-bold">{title}</div>
        <div className="text-muted">{text}</div>
        {action}
      </div>
    </div>
  )
}

/**
 * The venue's kitchen orders, followed for every frame. Returns the feed
 * (a ref: { seq, resetSeq, orders, lastSeq, offset }), whether the first
 * sync is in, the link's state and when it last synced.
 */
function useKitchenFeed(token, { onChange, onConfig, onGone }) {
  const feed = useRef({ seq: 0, resetSeq: 0, orders: {}, lastSeq: {}, offset: 0 })
  const [ready, setReady] = useState(false)
  const [link, setLink] = useState({ socket: 'closed', ok: true, at: null })
  const cb = useRef({ onChange, onConfig, onGone })
  cb.current = { onChange, onConfig, onGone }
  const tokenQ = encodeURIComponent(token)

  const pull = useMemo(() => {
    let running = null
    let again = false
    let stopped = false
    async function once() {
      const f = feed.current
      const sent = Date.now()
      try {
        const res = await getJson('/pos-api/kitchen-live/sync?token=' + tokenQ + '&since=' + (f.seq || 0))
        const rtt = Date.now() - sent
        if (res.server_time) f.offset = Date.parse(res.server_time) + rtt / 2 - Date.now()
        let changed = false
        if (res.reset) {
          f.orders = {}
          f.lastSeq = {}
          f.resetSeq = res.seq
          changed = true
        }
        for (const o of res.orders || []) {
          f.orders[o.id] = o
          f.lastSeq[o.id] = res.seq
          changed = true
        }
        // Orders long finished drop off, as they do on the screens.
        const now = Date.now() + f.offset
        for (const [id, o] of Object.entries(f.orders)) {
          if (o.status !== 'active' && now - Date.parse(o.updated_at || o.created_at || 0) > STALE_HOURS * 3600_000) {
            delete f.orders[id]
            delete f.lastSeq[id]
          }
        }
        if (res.seq !== f.seq) changed = true
        f.seq = res.seq
        setLink(l => ({ ...l, ok: true, at: Date.now() }))
        setReady(true)
        if (changed) cb.current.onChange?.()
      } catch (e) {
        if (e instanceof LinkGone) { stopped = true; cb.current.onGone?.(); return }
        setLink(l => ({ ...l, ok: false }))
      }
    }
    async function pullNow() {
      if (stopped) return
      if (running) { again = true; return running }
      running = (async () => {
        do { again = false; await once() } while (again && !stopped)
      })()
      try { await running } finally { running = null }
    }
    return pullNow
  }, [tokenQ])

  // The socket says when kitchen orders or the setup change. A ping every
  // PING_EVERY_MS (answered by config/ws.js) keeps it open through proxies
  // that close quiet connections, and no answer within PONG_WAIT_MS means the
  // link hangs: it is dropped and opened again (as the kiosk's heartbeat).
  const socketOpen = useRef(false)
  useEffect(() => {
    let ws = null
    let retry = 1000
    let timer = null
    let closed = false
    let beat = null
    let beatWait = null
    const heard = () => { clearTimeout(beatWait); beatWait = null }
    const stopBeat = () => { clearInterval(beat); beat = null; heard() }
    const dropped = sock => {
      if (ws !== sock) return
      ws = null
      stopBeat()
      socketOpen.current = false
      setLink(l => ({ ...l, socket: 'closed' }))
      if (!closed) timer = setTimeout(connect, retry = Math.min(retry * 2, 30000))
    }
    // Only once the server said it answers pings (its 'connected' message).
    const startBeat = sock => {
      stopBeat()
      beat = setInterval(() => {
        if (ws !== sock || sock.readyState !== 1) return
        try { sock.send('{"type":"ping"}') } catch { return }
        if (beatWait) return
        beatWait = setTimeout(() => {
          beatWait = null
          if (ws !== sock) return
          // Not waiting for it to close: a hanging link may take minutes to say so.
          sock.onclose = sock.onmessage = sock.onerror = null
          try { sock.close() } catch { /* ignore */ }
          dropped(sock)
        }, PONG_WAIT_MS)
      }, PING_EVERY_MS)
    }
    const connect = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      let sock
      try { sock = new WebSocket(proto + '//' + location.host + '/ws?kitchen_live=' + tokenQ) } catch { timer = setTimeout(connect, retry); return }
      ws = sock
      setLink(l => ({ ...l, socket: 'connecting' }))
      sock.onopen = () => { retry = 1000; socketOpen.current = true; setLink(l => ({ ...l, socket: 'open' })); pull() }
      sock.onmessage = msg => {
        heard()
        let m
        try { m = JSON.parse(msg.data) } catch { return }
        if (m.type === 'connected' && m.heartbeat) startBeat(sock)
        else if (m.type === 'pos.seq' && (!m.kinds || m.kinds.includes('kitchen'))) pull()
        else if (m.type === 'pos.config' || m.type === 'pos.revoked') cb.current.onConfig?.()
      }
      sock.onclose = () => dropped(sock)
      sock.onerror = () => { try { sock.close() } catch { /* ignore */ } }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      stopBeat()
      const sock = ws
      ws = null
      if (sock) { sock.onclose = sock.onmessage = sock.onerror = null; try { sock.close() } catch { /* ignore */ } }
    }
  }, [tokenQ, pull])

  // A check every 20 s with the socket open, every 3 s without it.
  useEffect(() => {
    let t = null
    const loop = () => { t = setTimeout(() => { pull(); loop() }, socketOpen.current ? 20000 : 3000) }
    pull()
    loop()
    const onVis = () => { if (!document.hidden) pull() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis) }
  }, [pull])

  return { feed, ready, link, pull }
}

function LivePage({ data, token, reloadSetup, onGone, setupError }) {
  useWakeLock()
  const [prefs, setPrefsState] = useState(loadPrefs)
  const setPrefs = patch => setPrefsState(p => { const next = { ...p, ...patch }; savePrefs(next); return next })
  const hasScreens = (data.screens || []).length > 0
  const mode = prefs.mode === 'stations' || !hasScreens ? 'stations' : 'setup'
  const size = SIZES.find(s => s.key === prefs.size) || SIZES[0]
  const sound = !!prefs.sound
  const screens = useMemo(() => benchScreens({ screens: data.screens, stations: data.config.stations }, mode), [data, mode])
  const boards = useMemo(() => boardCards(data.boards, mode), [data.boards, mode])
  const [, setVersion] = useState(0)
  const bump = useCallback(() => setVersion(v => v + 1), [])

  // ── The link the frames use (window.kdsLive) ─────────────────────
  const subs = useRef(new Map())
  const broadcast = useCallback(msg => {
    for (const fn of subs.current.values()) {
      setTimeout(() => { try { fn(msg) } catch { /* frame gone */ } }, 0)
    }
  }, [])
  const configTimer = useRef(null)
  const onConfig = useCallback(() => {
    // Several changes at once (a flow switch, a station edit): load once.
    clearTimeout(configTimer.current)
    configTimer.current = setTimeout(() => { reloadSetup() }, 800)
  }, [reloadSetup])
  const { feed, ready, link, pull: pullFeed } = useKitchenFeed(token, {
    onChange: () => { broadcast({ type: 'pos.seq', seq: feed.current.seq, kinds: ['kitchen'] }); bump() },
    onConfig,
    onGone,
  })

  const dataRef = useRef(data)
  dataRef.current = data
  const screensRef = useRef(screens)
  screensRef.current = screens
  const soundRef = useRef(sound)
  soundRef.current = sound

  // ── Bumping: off at every visit; turning it on asks first ──────────
  const canBump = !!data.can_bump
  const [bumping, setBumpingState] = useState(false)
  const [askBump, setAskBump] = useState(false)
  // The orange bar says what bumping does once, as it goes on, for
  // BUMP_NOTE_MS (or until OK); then the switch and each screen's badge say
  // it is on.
  const [bumpNote, setBumpNote] = useState(false)
  const bumpingRef = useRef(false)
  const setBumping = useCallback(on => {
    bumpingRef.current = !!on
    setBumpingState(!!on)
    setAskBump(false)
    setBumpNote(!!on)
  }, [])
  useEffect(() => {
    if (!bumpNote) return undefined
    const t = setTimeout(() => setBumpNote(false), BUMP_NOTE_MS)
    return () => clearTimeout(t)
  }, [bumpNote])
  const canBumpRef = useRef(canBump)
  canBumpRef.current = canBump
  useEffect(() => { if (!canBump && bumpingRef.current) setBumping(false) }, [canBump, setBumping])
  const tokenQ = encodeURIComponent(token)
  const onGoneRef = useRef(onGone)
  onGoneRef.current = onGone
  // New dishes beep here, once for every screen they reach at the same time:
  // browsers only play sound in a frame after a tap in that frame, and the
  // Sound button is a tap on this page.
  const audio = useRef(null)
  const lastChime = useRef(0)
  const unlockSound = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!audio.current && Ctx) audio.current = new Ctx()
      audio.current?.resume?.()
    } catch { audio.current = null }
  }
  // Sound left on from an earlier visit starts with the first tap on this page.
  useEffect(() => {
    const f = () => { if (soundRef.current) unlockSound() }
    window.addEventListener('pointerdown', f)
    return () => window.removeEventListener('pointerdown', f)
  }, [])
  const playChime = useCallback(() => {
    const a = audio.current
    if (!soundRef.current || !a || Date.now() - lastChime.current < 1500) return
    lastChime.current = Date.now()
    try {
      const t = a.currentTime
      for (const [i, f] of [880, 1320].entries()) {
        const o = a.createOscillator()
        const g = a.createGain()
        o.frequency.value = f
        o.type = 'sine'
        g.gain.setValueAtTime(0.0001, t + i * 0.18)
        g.gain.exponentialRampToValueAtTime(0.4, t + i * 0.18 + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16)
        o.connect(g).connect(a.destination)
        o.start(t + i * 0.18)
        o.stop(t + i * 0.18 + 0.18)
      }
    } catch { /* no sound */ }
  }, [])

  useEffect(() => {
    window.kdsLive = {
      connect(screenId) {
        const screenOf = () => screensRef.current.find(s => s.id === screenId)
        if (!screenOf()) return null
        const fail = (message, extra = {}) => Object.assign(new Error(message), extra)
        async function request(method, path, body) {
          const screen = screenOf()
          if (!screen) throw fail('This screen is no longer in the live view', { status: 404 })
          const url = new URL(path, location.origin)
          if (method === 'GET' && url.pathname === '/pos-api/config') {
            const base = dataRef.current.config
            const device = { id: screen.id, kind: 'kds', name: screen.name, short_code: screen.short_code || null, settings: { ...(screen.settings || {}), sound: soundRef.current } }
            const version = 'live.' + base.version + '.' + stamp(device)
            if (url.searchParams.get('version') === version) return { unchanged: true, version }
            return { ...base, live: true, hub: null, device, version }
          }
          if (method === 'GET' && url.pathname === '/pos-api/kitchen/sync') {
            const f = feed.current
            const since = Math.max(0, Number(url.searchParams.get('since')) || 0)
            const server_time = new Date(Date.now() + f.offset).toISOString()
            if (!since || since > f.seq || since < f.resetSeq) {
              return { reset: true, seq: f.seq, orders: Object.values(f.orders), server_time, source: 'cloud' }
            }
            const changed = Object.keys(f.orders).filter(id => f.lastSeq[id] > since).map(id => f.orders[id])
            return { seq: f.seq, orders: changed, server_time, source: 'cloud' }
          }
          if (method === 'POST' && url.pathname === '/pos-api/events') {
            const events = body?.events || []
            if (!bumpingRef.current) return refuseAll(events, canBumpRef.current ? BUMPING_OFF : VIEW_ONLY)
            try {
              const res = await postJson('/pos-api/kitchen-live/events?token=' + tokenQ, { screen_id: screen.id, events })
              // Every frame hears it at once (the socket says so too).
              pullFeed()
              return res
            } catch (e) {
              if (e instanceof LinkGone) { onGoneRef.current?.(); return refuseAll(events, e.message, 'link') }
              // Refused as a whole (the link can only watch, a screen gone): the taps are dropped.
              if (e.status >= 400 && e.status < 500) return refuseAll(events, e.message, e.code || 'view_only')
              throw e
            }
          }
          throw fail(method === 'PUT' ? VIEW_ONLY : 'Not in the live view: ' + method + ' ' + url.pathname, { status: method === 'PUT' ? 403 : 404 })
        }
        return {
          device: { id: screenId, venue_id: dataRef.current.venue.id },
          live: true,
          // Asked at every tap (store.js): view only until Allow bumping is on.
          viewOnly: () => !bumpingRef.current,
          viewOnlyText: () => (canBumpRef.current ? BUMPING_OFF : VIEW_ONLY),
          switchFlows: false,
          prefsPrefix: 'maca_kds_live_',
          chime: playChime,
          transport: {
            get: p => request('GET', p),
            post: (p, b) => request('POST', p, b),
            put: (p, b) => request('PUT', p, b),
            socketUrl: () => null,
          },
          subscribe(fn) {
            subs.current.set(screenId, fn)
            return () => { if (subs.current.get(screenId) === fn) subs.current.delete(screenId) }
          },
        }
      },
    }
    return () => { delete window.kdsLive }
  }, [feed, playChime, pullFeed, tokenQ])

  // A new setup (or the sound) reaches the frames through their config.
  useEffect(() => { broadcast({ type: 'pos.config' }) }, [data, sound, broadcast])
  // The setup again every few minutes (the location's whole-config time), in case a push was missed.
  useEffect(() => {
    const secs = Math.max(60, Number(data.config.pull?.content) || 180)
    const t = setInterval(() => reloadSetup(), secs * 1000)
    return () => clearInterval(t)
  }, [data.config.pull?.content, reloadSetup])

  // ── Full screen ─────────────────────────────────────────────────
  const [full, setFull] = useState(() => new URLSearchParams(location.search).get('full'))
  const [pseudo, setPseudo] = useState(() => !!new URLSearchParams(location.search).get('full'))
  const cards = useRef(new Map())
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null
  const remember = id => {
    const q = new URLSearchParams(location.search)
    if (id) q.set('full', id); else q.delete('full')
    try { history.replaceState(null, '', location.pathname + '?' + q.toString()) } catch { /* ignore */ }
  }
  async function enterFull(id) {
    const el = cards.current.get(id)
    setFull(id)
    remember(id)
    const req = el && (el.requestFullscreen || el.webkitRequestFullscreen)
    if (!req) { setPseudo(true); return }
    try {
      const p = req.call(el)
      if (p && typeof p.then === 'function') { await p; setPseudo(false) }
      // The webkit call answers nothing: look a moment later.
      else setTimeout(() => { if (!fsElement()) setPseudo(true) }, 400)
    } catch {
      setPseudo(true)
    }
  }
  function exitFull() {
    if (fsElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen
      try { const p = exit?.call(document); p?.catch?.(() => {}) } catch { /* ignore */ }
    }
    setFull(null)
    setPseudo(false)
    remember(null)
  }
  const pseudoRef = useRef(pseudo)
  pseudoRef.current = pseudo
  useEffect(() => {
    const onChange = () => { if (!fsElement() && !pseudoRef.current) { setFull(null); remember(null) } }
    const onKey = e => { if (e.key === 'Escape' && pseudoRef.current) { setFull(null); setPseudo(false); remember(null) } }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  // A screen or board taken out of the setup while full: back to every screen.
  useEffect(() => { if (full && !screens.some(s => s.id === full) && !boards.some(b => b.id === full)) exitFull() }, [full, screens, boards]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Layout ──────────────────────────────────────────────────────
  const gridRef = useRef(null)
  const gridW = useWidth(gridRef)
  // On a phone one across; else two for up to four screens, three for more.
  const autoCols = (gridW && gridW < 700) || screens.length <= 1 ? 1 : screens.length <= 4 ? 2 : 3
  const cols = Math.min(screens.length || 1, prefs.cols || autoCols)
  const gap = 12
  const cellW = Math.max(160, (gridW - gap * (cols - 1)) / cols)
  const scale = cellW / size.w
  const stationName = Object.fromEntries(data.config.stations.map(s => [s.id, s.name]))
  const bumpable = data.config.stations.filter(x => BUMP_KINDS.includes(x.kind)).map(x => x.id)
  const open = Object.values(feed.current.orders).filter(o => o.status === 'active').length
  const state = !link.ok
    ? { text: 'Can\'t reach Macaroonie: trying again', cls: 'bg-bad text-white', icon: WifiOff }
    : link.socket === 'open'
      ? { text: 'Live', cls: 'bg-ok text-white', icon: Wifi }
      : { text: 'Checking every few seconds', cls: 'bg-warn text-white', icon: Wifi }

  return (
    <div className="h-full flex flex-col bg-page select-none">
      <header className="shrink-0 bg-ink text-white px-3 py-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-col leading-tight mr-2 min-w-0">
          <div className="font-bold truncate" data-testid="live-title">Live kitchen · {data.venue.name}</div>
          <div className="text-xs text-white/70" data-testid="live-subtitle">
            {bumping ? 'The real kitchen screens with the orders as they are now. Bumping is on: taps here change them.' : 'The real kitchen screens with the orders as they are now. Nothing changes from here.'}
          </div>
        </div>
        <div className="flex-1" />
        <span className="text-sm font-semibold tabular-nums" data-testid="live-open">{open === 1 ? '1 order in the kitchen' : open + ' orders in the kitchen'}</span>
        <span className={cx('h-9 px-3 rounded-lg flex items-center gap-1.5 text-sm font-bold', state.cls)} data-testid="live-link" data-state={!link.ok ? 'down' : link.socket}>
          <state.icon size={16} /> {state.text}{link.at && link.ok ? ' · ' + new Date(link.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
        </span>
        <span className="text-xs text-white/70" data-testid="live-until">Link works until {untilText(data.expires_at)}</span>
      </header>

      <div className="shrink-0 bg-white border-b border-line px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label">Screens</span>
          <button className={cx('chip min-h-[48px]', mode === 'setup' && 'chip-on')} disabled={!hasScreens} aria-pressed={mode === 'setup'}
            onClick={() => { exitFull(); setPrefs({ mode: 'setup' }) }} data-testid="live-mode-setup">
            As set up ({(data.screens || []).length})
          </button>
          <button className={cx('chip min-h-[48px]', mode === 'stations' && 'chip-on')} aria-pressed={mode === 'stations'}
            onClick={() => { exitFull(); setPrefs({ mode: 'stations' }) }} data-testid="live-mode-stations">
            One per station
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label">Size</span>
          {SIZES.map(s => (
            <button key={s.key} className={cx('chip min-h-[48px]', size.key === s.key && 'chip-on')} aria-pressed={size.key === s.key} onClick={() => setPrefs({ size: s.key })}>{s.label}</button>
          ))}
        </div>
        {screens.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="label">Across</span>
            {[1, 2, 3, 4].filter(n => n <= screens.length).map(n => (
              <button key={n} className={cx('chip px-3 min-h-[48px] min-w-[48px]', cols === n && 'chip-on')} aria-pressed={cols === n} onClick={() => setPrefs({ cols: n })}>{n}</button>
            ))}
          </div>
        )}
        <button className={cx('chip min-h-[48px] gap-2', sound && 'chip-on')} onClick={() => { if (!sound) unlockSound(); setPrefs({ sound: !sound }) }} aria-pressed={sound} data-testid="live-sound">
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} Sound
        </button>
        {canBump
          ? <BumpSwitch on={bumping} asking={askBump} onTap={() => (bumping ? setBumping(false) : setAskBump(a => !a))} />
          : <span className="text-sm text-muted" data-testid="live-watch-only">{WATCH_ONLY}</span>}
        {!hasScreens && <span className="text-sm text-muted">No kitchen screens set up at this venue yet: each station shows as its own screen.</span>}
        {setupError && <span className="text-sm text-bad">Couldn't check for setup changes: {setupError}</span>}
      </div>
      {askBump && !bumping && <BumpConfirm onYes={() => setBumping(true)} onNo={() => setAskBump(false)} />}
      {bumping && bumpNote && (
        <div className="shrink-0 bg-warn text-white px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="live-bump-banner" role="status">
          <Hand size={18} className="shrink-0" />
          <div className="flex-1 min-w-[12rem] font-semibold">Bumping is on: taps on these screens bump and tick off dishes for real, as on the kitchen screens.</div>
          <button className="btn bg-white/15 text-white border-white/60 min-h-[48px] min-w-[48px]" onClick={() => setBumpNote(false)} data-testid="live-bump-note-ok">OK</button>
          <button className="btn bg-white text-ink border-white min-h-[48px]" onClick={() => setBumping(false)} data-testid="live-bump-off">Turn bumping off</button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div ref={gridRef}>
          {!ready
            ? <div className="py-16 text-center text-muted" data-testid="live-loading">{link.ok ? 'Getting the orders...' : 'Can\'t reach Macaroonie: trying again'}</div>
            : (
            <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
              {gridW > 0 && screens.map(s => {
                const ids = s.settings?.station_ids?.length ? s.settings.station_ids.filter(id => bumpable.includes(id)) : bumpable
                const big = full === s.id
                return (
                  <div key={s.id} ref={el => { if (el) cards.current.set(s.id, el); else cards.current.delete(s.id) }}
                    className={cx(big ? 'bg-black text-white flex flex-col' : 'card overflow-hidden', big && pseudo && 'fixed inset-0 z-50')}
                    data-testid="live-screen" data-screen={s.id} data-full={big ? (pseudo ? 'window' : 'screen') : undefined}>
                    <div className={cx('flex items-center gap-2 px-3', big ? 'py-1 bg-ink' : 'py-1.5 border-b border-line')}>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate" data-testid="live-screen-name">{s.name}{s.short_code ? ' · ' + s.short_code : ''}</div>
                        <div className={cx('text-xs truncate', big ? 'text-white/70' : 'text-muted')}>{ids.map(id => stationName[id]).filter(Boolean).join(', ') || 'Every station'}</div>
                      </div>
                      <DeviceState screen={s} dark={big} />
                      {bumping && (
                        <button className="min-h-[48px] px-3 rounded-full bg-warn text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
                          onClick={() => setBumping(false)} data-testid="live-bump-badge" aria-label="Bumping is on: turn it off">
                          <Hand size={14} /><span>Bumping on<span className="hidden sm:inline">: turn off</span></span>
                        </button>
                      )}
                      {big
                        ? (
                          <button className="btn bg-white text-ink border-white" onClick={exitFull} data-testid="live-exit-full">
                            <Minimize2 size={18} /> Leave full screen
                          </button>
                        )
                        : (
                          <button className="chip min-h-[48px] gap-1.5 px-3" onClick={() => enterFull(s.id)} data-testid="live-full" aria-label={'Show ' + s.name + ' full screen'}>
                            <Maximize size={16} /> Full screen
                          </button>
                        )}
                    </div>
                    <div className={big ? 'flex-1 min-h-0 relative' : undefined}
                      style={big ? { background: '#000' } : { height: size.h * scale, position: 'relative', overflow: 'hidden', background: '#000' }}>
                      <iframe
                        title={s.name}
                        src={'/?kitchen_live=' + encodeURIComponent(token) + '&screen=' + encodeURIComponent(s.id)}
                        style={big
                          ? { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }
                          : { width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, position: 'absolute', top: 0, left: 0 }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            )}
          {ready && gridW > 0 && boards.length > 0 && (
            <BoardsSection boards={boards} data={data} token={token} gridW={gridW} gap={gap} full={full} pseudo={pseudo}
              cards={cards} onFull={enterFull} onExit={exitFull} />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The order ready boards to show: As set up, the venue's menu screens with an
 * Order status block (plain boards when there are none); One per station, a
 * plain board per board station. A plain board with no board station shows
 * every counter and online order, as an Order status block with no board picked.
 */
function boardCards(b, mode) {
  const list = b || { screens: [], stations: [] }
  const plain = (list.stations || []).length
    ? list.stations.map(st => ({ id: 'board-' + st.id, kind: 'board', name: st.name, query: '&board=' + encodeURIComponent(st.id), width: 1920, height: 1080, key: st.name }))
    : [{ id: 'board-all', kind: 'board', name: 'Every order', query: '&board=all', width: 1920, height: 1080, all: true, key: 'all' }]
  if (mode === 'setup' && (list.screens || []).length) {
    return list.screens.map(s => ({
      id: 'orb-' + s.id, kind: 'screen', name: s.name, short_code: s.short_code, query: '&screen=' + encodeURIComponent(s.id),
      width: s.width || 1920, height: s.height || 1080, screen: s, key: s.id,
    }))
  }
  return plain
}

function boardLine(b) {
  if (b.kind === 'board') return b.all ? 'Every counter and online order' : 'Board station: the numbers sent to it'
  const s = b.screen
  return [s.showing ? 'Showing ' + s.showing : null, s.wall ? 'On the wall ' + s.wall.name : null, b.width + ' x ' + b.height].filter(Boolean).join(' · ')
}

function BoardsSection({ boards, data, token, gridW, gap, full, pseudo, cards, onFull, onExit }) {
  const cols = gridW < 700 || boards.length <= 1 ? 1 : boards.length <= 4 ? 2 : 3
  const cellW = Math.max(160, (gridW - gap * (cols - 1)) / cols)
  const plainOnly = boards.every(b => b.kind === 'board')
  const noBoards = !(data.boards?.screens || []).length && !(data.boards?.stations || []).length
  const src = b => (data.boards?.address || '') + '/?board_live=' + encodeURIComponent(token) + b.query
  return (
    <section className="mt-6" data-testid="live-boards">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <h2 className="text-lg font-bold">Order ready boards</h2>
        <span className="text-sm text-muted">
          {noBoards
            ? 'No order ready board set up at this venue yet: this is every counter and online order, as a board shows them.'
            : plainOnly
              ? 'The numbers each board station gets, on a plain board.'
              : 'The menu screens showing order numbers, as they show now.'}
        </span>
      </div>
      {/* Each card keeps its own height: a wide board beside an upright one isn't stretched. */}
      <div className="grid items-start" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
        {boards.map(b => {
          const big = full === b.id
          // Drawn in the screen's own shape, as wide as the card or BOARD_MAX_H tall.
          const h = Math.min(cellW * b.height / b.width, BOARD_MAX_H)
          const w = h * b.width / b.height
          return (
            <div key={b.id} ref={el => { if (el) cards.current.set(b.id, el); else cards.current.delete(b.id) }}
              className={cx(big ? 'bg-black text-white flex flex-col' : 'card overflow-hidden', big && pseudo && 'fixed inset-0 z-50')}
              data-testid="live-board" data-board={b.id} data-kind={b.kind} data-full={big ? (pseudo ? 'window' : 'screen') : undefined}>
              <div className={cx('flex items-center gap-2 px-3', big ? 'py-1 bg-ink' : 'py-1.5 border-b border-line')}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate" data-testid="live-board-name">{b.name}{b.short_code ? ' · ' + b.short_code : ''}</div>
                  <div className={cx('text-xs truncate', big ? 'text-white/70' : 'text-muted')}>{boardLine(b)}</div>
                </div>
                <DeviceState screen={b.screen || { per_station: true }} dark={big} />
                {big
                  ? (
                    <button className="btn bg-white text-ink border-white" onClick={onExit} data-testid="live-exit-full">
                      <Minimize2 size={18} /> Leave full screen
                    </button>
                  )
                  : (
                    <button className="chip min-h-[48px] gap-1.5 px-3" onClick={() => onFull(b.id)} data-testid="live-board-full" aria-label={'Show ' + b.name + ' full screen'}>
                      <Maximize size={16} /> Full screen
                    </button>
                  )}
              </div>
              <div className={big ? 'flex-1 min-h-0 relative' : 'flex justify-center'} style={{ background: '#000' }}>
                <iframe
                  key={b.key}
                  title={'Order ready board ' + b.name}
                  src={src(b)}
                  data-testid="live-board-frame"
                  style={big
                    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }
                    : { width: w, height: h, border: 0, display: 'block' }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The Allow bumping switch: off at every visit. Turning it on opens the
 * confirm below the bar (BumpConfirm); turning it off is one tap.
 */
function BumpSwitch({ on, asking, onTap }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onTap} data-testid="live-bump" data-on={on ? 'true' : 'false'}
      className={cx('min-h-[48px] px-3 rounded-full border flex items-center gap-2.5 font-semibold touch-manipulation',
        on ? 'bg-warn border-warn text-white' : asking ? 'bg-warn-soft border-warn text-ink' : 'bg-white border-line text-ink')}>
      <span aria-hidden className={cx('relative inline-block w-10 h-6 rounded-full transition-colors', on ? 'bg-white/40' : 'bg-line')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full shadow transition-all', on ? 'left-[18px] bg-white' : 'left-0.5 bg-white')} />
      </span>
      <Hand size={16} /> Allow bumping
    </button>
  )
}

/** Asked before bumping goes on: what changes, and the way back to watching. */
function BumpConfirm({ onYes, onNo }) {
  return (
    <div className="shrink-0 bg-warn-soft border-b border-warn px-3 py-3 flex flex-wrap items-center gap-3" role="alertdialog" aria-labelledby="live-bump-q" data-testid="live-bump-confirm">
      <AlertTriangle className="text-warn shrink-0" size={22} />
      <div className="flex-1 min-w-[14rem]">
        <div className="font-bold" id="live-bump-q">Allow bumping from this page?</div>
        <div className="text-sm">
          Taps on these screens will bump, tick off, recall and remake dishes for real, as on the kitchen screens, until you turn it off or close this page. Switching the kitchen flow stays on the kitchen screens.
        </div>
      </div>
      <button className="btn btn-warn min-h-[48px]" onClick={onYes} data-testid="live-bump-yes">Yes, allow bumping</button>
      <button className="btn min-h-[48px]" onClick={onNo} data-testid="live-bump-no">Keep watching only</button>
    </div>
  )
}

/** Whether the real device of a screen is on (Store tech links it). */
function DeviceState({ screen, dark }) {
  if (screen.per_station) return null
  const seen = screen.last_seen_at ? Date.parse(screen.last_seen_at) : 0
  const on = screen.linked && seen && Date.now() - seen < ON_MS
  const text = !screen.linked ? 'No device linked' : on ? 'Device on' : seen ? 'Device not seen since ' + untilText(screen.last_seen_at) : 'Device not seen yet'
  const Icon = on ? Wifi : MonitorOff
  return (
    <span className={cx('hidden sm:flex items-center gap-1 text-xs font-semibold whitespace-nowrap px-2 py-1 rounded-full',
      on ? 'bg-ok-soft text-ok' : dark ? 'bg-white/10 text-white/80' : 'bg-page text-muted')} data-testid="live-device" data-on={on ? 'true' : 'false'}>
      <Icon size={14} /> {text}
    </span>
  )
}
