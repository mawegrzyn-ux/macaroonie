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
// It only reads: the screens run view only (store.js), so a tap that would
// change an order or the kitchen flow says so and changes nothing. Any screen
// can go full screen: the Fullscreen API on its card (webkit-prefixed on an
// iPad), else the card fills the window; the screen inside then lays itself
// out at that size, as a kitchen screen of that size would. &full=<screen>
// in the address opens with that screen filling the window.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize, Minimize2, Volume2, VolumeX, Wifi, WifiOff, RefreshCw, AlertTriangle, Workflow, Clock, MonitorOff } from 'lucide-react'
import { benchScreens } from '@shared/pos/kitchenBench.js'
import { BUMP_KINDS, STALE_HOURS } from '@shared/pos/kitchen.js'

const cx = (...p) => p.filter(Boolean).join(' ')

const SIZES = [
  { key: 'tablet', label: 'Tablet', w: 1280, h: 800 },
  { key: 'tv', label: 'TV', w: 1920, h: 1080 },
  { key: 'portrait', label: 'Portrait', w: 800, h: 1280 },
]
const PREFS_KEY = 'maca_kds_live'
// A device that asked within this long is on (it asks every 20 s; last seen is written once a minute).
const ON_MS = 3 * 60_000
const VIEW_ONLY = 'This is the live view: nothing changes from here. Tap on the kitchen screen itself.'

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

async function getJson(url) {
  let res
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch {
    throw Object.assign(new Error('No connection'), { offline: true })
  }
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) throw new LinkGone(body.error || 'This live view has run out')
  if (!res.ok) throw Object.assign(new Error(body.error || 'Macaroonie didn\'t answer'), { status: res.status })
  return body
}

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
      setData(prev => (prev && JSON.stringify(prev.screens) === JSON.stringify(d.screens) && prev.config.version === d.config.version && prev.expires_at === d.expires_at ? prev : d))
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

  // The socket says when kitchen orders or the setup change.
  const socketOpen = useRef(false)
  useEffect(() => {
    let ws = null
    let retry = 1000
    let timer = null
    let closed = false
    const connect = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      try { ws = new WebSocket(proto + '//' + location.host + '/ws?kitchen_live=' + tokenQ) } catch { ws = null; timer = setTimeout(connect, retry); return }
      setLink(l => ({ ...l, socket: 'connecting' }))
      ws.onopen = () => { retry = 1000; socketOpen.current = true; setLink(l => ({ ...l, socket: 'open' })); pull() }
      ws.onmessage = msg => {
        let m
        try { m = JSON.parse(msg.data) } catch { return }
        if (m.type === 'pos.seq' && (!m.kinds || m.kinds.includes('kitchen'))) pull()
        else if (m.type === 'pos.config' || m.type === 'pos.revoked') cb.current.onConfig?.()
      }
      ws.onclose = () => {
        ws = null
        socketOpen.current = false
        setLink(l => ({ ...l, socket: 'closed' }))
        if (!closed) timer = setTimeout(connect, retry = Math.min(retry * 2, 30000))
      }
      ws.onerror = () => { try { ws?.close() } catch { /* ignore */ } }
    }
    connect()
    return () => { closed = true; clearTimeout(timer); try { ws?.close() } catch { /* ignore */ } }
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

  return { feed, ready, link }
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
  const { feed, ready, link } = useKitchenFeed(token, {
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
            return { results: (body?.events || []).map(e => ({ id: e.id, ok: false, error: VIEW_ONLY, code: 'view_only' })), kitchen: [] }
          }
          throw fail(method === 'PUT' ? VIEW_ONLY : 'Not in the live view: ' + method + ' ' + url.pathname, { status: method === 'PUT' ? 403 : 404 })
        }
        return {
          device: { id: screenId, venue_id: dataRef.current.venue.id },
          viewOnly: true,
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
  }, [feed, playChime])

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
  // A screen taken out of the setup while full: back to every screen.
  useEffect(() => { if (full && !screens.some(s => s.id === full)) exitFull() }, [full, screens]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="text-xs text-white/70">The real kitchen screens with the orders as they are now. Nothing changes from here.</div>
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
        {!hasScreens && <span className="text-sm text-muted">No kitchen screens set up at this venue yet: each station shows as its own screen.</span>}
        {setupError && <span className="text-sm text-bad">Couldn't check for setup changes: {setupError}</span>}
      </div>

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
        </div>
      </div>
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
