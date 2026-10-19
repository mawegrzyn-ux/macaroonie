// The kitchen test bench (Till setup > Kitchen screens > Test the kitchen).
//
// Every kitchen screen of a venue on one page, scaled down, each the real
// kitchen screen app in a frame (BenchScreen.jsx). The page runs a pretend
// kitchen (shared/pos/kitchenBench.js) with the same rules as the real one:
// send test orders (made up, or built dish by dish), bump them on the
// screens, switch the kitchen flow, take a screen offline, and watch where
// each dish is on its way. Nothing reaches the real kitchen screens, the
// till, the reports or the database: the signed link only reads the setup.
//
// The screens talk to the bench through window.kdsBench.connect(screenId),
// which gives them the same calls they make to /pos-api (config, kitchen
// sync, events, flow switch) and pushes in place of the socket.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Workflow, Shuffle, Plus, Minus, Trash2, Zap, X, WifiOff, Wifi, Maximize2, Minimize2, Volume2, VolumeX,
  ChevronRight, RefreshCw, Flame, Search, ListChecks, Activity, AlertTriangle,
} from 'lucide-react'
import { createBench, benchScreens } from '@shared/pos/kitchenBench.js'
import { routeOrder, nodeState, boardNumbers, BUMP_KINDS } from '@shared/pos/kitchen.js'

const cx = (...p) => p.filter(Boolean).join(' ')

const SIZES = [
  { key: 'tablet', label: 'Tablet', w: 1280, h: 800 },
  { key: 'tv', label: 'TV', w: 1920, h: 1080 },
  { key: 'portrait', label: 'Portrait', w: 800, h: 1280 },
]
const PREFS_KEY = 'maca_kds_bench'

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {} } catch { return {} }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

const timeOf = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')

const EVENT_WORDS = {
  'kitchen.bumped': 'bumped',
  'kitchen.item_done': 'ticked a dish',
  'kitchen.recalled': 'brought back',
  'kitchen.remake': 'asked for a remake',
  'kitchen.priority': 'changed rush',
  'kitchen.collected': 'marked collected',
  'lines.sent': 'sent a till order',
  'order_in': 'sent an online order',
  'course.fired': 'fired a course',
  'line.voided': 'voided a dish',
  clear: 'cleared every order',
  flow: 'switched the kitchen flow',
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

export default function Bench({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    let gone = false
    setError(null)
    fetch('/pos-api/kitchen-test?token=' + encodeURIComponent(token))
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || 'The kitchen setup couldn\'t be loaded')
        return body
      })
      .then(d => { if (!gone) setData(d) })
      .catch(e => { if (!gone) setError(e.message) })
    return () => { gone = true }
  }, [token, loadKey])

  useEffect(() => { document.title = 'Kitchen test' + (data?.venue?.name ? ' · ' + data.venue.name : '') }, [data])

  if (error) return <Message icon={AlertTriangle} title="Can't open the kitchen test" text={error} />
  if (!data) return <div className="h-full flex items-center justify-center text-muted">Loading the kitchen setup...</div>
  if (!data.stations.some(s => BUMP_KINDS.includes(s.kind))) {
    return <Message icon={Workflow} title="No kitchen stations yet" text="Add stations (Grill, Fryer, Pass...) in Till setup, Kitchen screens, then open Test the kitchen again." />
  }
  return <BenchPage key={loadKey} data={data} token={token} onReload={() => { setData(null); setLoadKey(k => k + 1) }} />
}

function Message({ icon: Icon, title, text }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="card p-8 max-w-md text-center space-y-3">
        <Icon className="mx-auto text-muted" size={40} />
        <div className="text-xl font-bold">{title}</div>
        <div className="text-muted">{text}</div>
      </div>
    </div>
  )
}

function BenchPage({ data, token, onReload }) {
  const bench = useMemo(() => createBench(data), [data])
  const [prefs, setPrefsState] = useState(loadPrefs)
  const setPrefs = patch => setPrefsState(p => { const next = { ...p, ...patch }; savePrefs(next); return next })
  const mode = prefs.mode === 'stations' || !(data.screens || []).length ? 'stations' : 'setup'
  const size = SIZES.find(s => s.key === prefs.size) || SIZES[0]
  const sound = !!prefs.sound
  const screens = useMemo(() => benchScreens(data, mode), [data, mode])
  const [focus, setFocus] = useState(null)
  const [offline, setOffline] = useState(() => new Set())
  const [builder, setBuilder] = useState(false)
  const [tab, setTab] = useState('orders')
  const [, setVersion] = useState(0)
  const bump = useCallback(() => setVersion(v => v + 1), [])

  // ── The link the screens use (window.kdsBench) ────────────────────
  const screensRef = useRef(screens)
  screensRef.current = screens
  const offlineRef = useRef(offline)
  offlineRef.current = offline
  const soundRef = useRef(sound)
  soundRef.current = sound
  const subs = useRef(new Map())
  const frames = useRef(new Map())

  // One listener per screen: a frame that loads again replaces its old one.
  const broadcast = useCallback(msg => {
    for (const fn of subs.current.values()) {
      setTimeout(() => { try { fn(msg) } catch { /* frame gone */ } }, 0)
    }
  }, [])
  const kitchenChanged = useCallback(from => {
    broadcast({ type: 'pos.seq', seq: bench.state.seq, from, kinds: ['kitchen'] })
    bump()
  }, [bench, broadcast, bump])

  useEffect(() => {
    window.kdsBench = {
      connect(screenId) {
        const screenOf = () => screensRef.current.find(s => s.id === screenId)
        if (!screenOf()) return null
        const fail = (message, extra = {}) => Object.assign(new Error(message), extra)
        async function request(method, path, body) {
          await new Promise(r => setTimeout(r, 30))
          if (offlineRef.current.has(screenId)) throw fail('No connection', { offline: true })
          const screen = screenOf()
          if (!screen) throw fail('This screen is no longer on the bench', { status: 404 })
          const url = new URL(path, location.origin)
          if (method === 'GET' && url.pathname === '/pos-api/config') {
            const cfg = bench.screenConfig(screen, { sound: soundRef.current })
            return url.searchParams.get('version') === cfg.version ? { unchanged: true, version: cfg.version } : cfg
          }
          if (method === 'GET' && url.pathname === '/pos-api/kitchen/sync') {
            return bench.sync(Math.max(0, Number(url.searchParams.get('since')) || 0))
          }
          if (method === 'POST' && url.pathname === '/pos-api/events') {
            const res = bench.submit(screen, body?.events || [])
            if (res.results.some(r => r.ok)) kitchenChanged(screen.id)
            else bump()
            return res
          }
          if (method === 'PUT' && url.pathname === '/pos-api/kitchen/flow') {
            const res = bench.switchFlow(body?.flow_id, screen.name, screen)
            if (res.changed) { broadcast({ type: 'pos.config' }); bump() }
            return res
          }
          throw fail('Not on the bench: ' + method + ' ' + url.pathname, { status: 404 })
        }
        return {
          device: { id: screenId, venue_id: data.venue.id },
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
    return () => { delete window.kdsBench }
  }, [bench, data, broadcast, bump, kitchenChanged])

  // Sound on or off reaches the screens through their config.
  useEffect(() => { broadcast({ type: 'pos.config' }) }, [sound, broadcast])

  function setScreenOffline(id, off) {
    setOffline(prev => {
      const next = new Set(prev)
      if (off) next.add(id); else next.delete(id)
      return next
    })
    // The screen hears it as its own Wi-Fi going and coming back.
    const win = frames.current.get(id)?.contentWindow
    setTimeout(() => { try { win?.dispatchEvent(new Event(off ? 'offline' : 'online')) } catch { /* frame gone */ } }, 0)
  }

  // ── Bench actions ───────────────────────────────────────────────
  const [notice, setNotice] = useState(null)
  const say = (text, kind = 'ok') => { setNotice({ text, kind, id: Date.now() }) }
  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  function send(spec) {
    const r = bench.sendOrder(spec)
    if (!r.ok) { say(r.error, 'bad'); return false }
    kitchenChanged('bench')
    say('Order ' + r.number + ' sent')
    return true
  }
  const sendRandom = (n = 1) => {
    let sent = 0
    for (let i = 0; i < n; i++) {
      const r = bench.sendOrder(bench.randomSpec())
      if (r.ok) sent++
    }
    kitchenChanged('bench')
    say(sent === 1 ? 'A made-up order sent' : sent + ' made-up orders sent', sent ? 'ok' : 'bad')
  }
  const switchFlow = id => {
    try {
      const r = bench.switchFlow(id, 'Test bench')
      if (r.changed) { broadcast({ type: 'pos.config' }); bump(); say('Kitchen flow now: ' + r.name + '. Orders sent from now follow it.') }
    } catch (e) { say(e.message, 'bad') }
  }
  const clearAll = () => { bench.clear(); kitchenChanged('bench'); say('Every test order cleared') }

  // ── Layout ──────────────────────────────────────────────────────
  const gridRef = useRef(null)
  const gridW = useWidth(gridRef)
  const shown = focus ? screens.filter(s => s.id === focus) : screens
  const autoCols = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : 3
  const cols = focus ? 1 : Math.min(shown.length || 1, prefs.cols || autoCols)
  const gap = 12
  const cellW = Math.max(160, (gridW - gap * (cols - 1)) / cols)
  const scale = cellW / size.w
  const flows = data.flows || []
  const active = bench.activeFlow()
  const stationName = Object.fromEntries(data.stations.map(s => [s.id, s.name]))

  return (
    <div className="h-full flex flex-col bg-page select-none">
      {/* Top bar */}
      <header className="shrink-0 bg-ink text-white px-3 py-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-col leading-tight mr-2 min-w-0">
          <div className="font-bold truncate">Kitchen test · {data.venue.name}</div>
          <div className="text-xs text-white/70">Test orders stay on this page: the real kitchen screens never see them.</div>
        </div>
        <div className="flex-1" />
        <button className="btn btn-primary" onClick={() => setBuilder(true)} data-testid="bench-new-order"><Plus size={18} /> Test order</button>
        <button className="btn" onClick={() => sendRandom(1)} data-testid="bench-random"><Shuffle size={18} /> Made-up order</button>
        <button className="btn" onClick={() => sendRandom(5)} data-testid="bench-rush"><Zap size={18} /> Rush: 5 orders</button>
        <ConfirmButton onConfirm={clearAll} label="Clear all" icon={Trash2} confirmLabel="Clear every test order?" />
      </header>

      {/* Settings row */}
      <div className="shrink-0 bg-white border-b border-line px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {flows.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="label flex items-center gap-1"><Workflow size={14} /> Kitchen flow</span>
            {flows.map(f => (
              <button key={f.id} onClick={() => switchFlow(f.id)} aria-pressed={active?.id === f.id}
                className={cx('chip', active?.id === f.id && 'chip-on')}>{f.name}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label">Screens</span>
          <button className={cx('chip', mode === 'setup' && 'chip-on')} disabled={!(data.screens || []).length}
            onClick={() => { setFocus(null); setPrefs({ mode: 'setup' }) }}>
            As set up ({(data.screens || []).length})
          </button>
          <button className={cx('chip', mode === 'stations' && 'chip-on')} onClick={() => { setFocus(null); setPrefs({ mode: 'stations' }) }}>
            One per station
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label">Size</span>
          {SIZES.map(s => (
            <button key={s.key} className={cx('chip', size.key === s.key && 'chip-on')} onClick={() => setPrefs({ size: s.key })}>{s.label}</button>
          ))}
        </div>
        {!focus && screens.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="label">Across</span>
            {[1, 2, 3, 4].filter(n => n <= screens.length).map(n => (
              <button key={n} className={cx('chip px-3 min-w-[44px]', cols === n && 'chip-on')} onClick={() => setPrefs({ cols: n })}>{n}</button>
            ))}
          </div>
        )}
        <button className={cx('chip gap-2', sound && 'chip-on')} onClick={() => setPrefs({ sound: !sound })} aria-pressed={sound}>
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} Sound
        </button>
        <button className="chip gap-2" onClick={onReload} title="Load the kitchen setup again (clears the test orders)">
          <RefreshCw size={16} /> Reload setup
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Screens */}
        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          <div ref={gridRef} className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
            {gridW > 0 && shown.map(s => {
              const off = offline.has(s.id)
              const ids = s.settings?.station_ids?.length ? s.settings.station_ids : data.stations.filter(x => BUMP_KINDS.includes(x.kind)).map(x => x.id)
              return (
                <div key={s.id} className="card overflow-hidden" data-testid="bench-screen">
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{s.name}{s.short_code ? ' · ' + s.short_code : ''}</div>
                      <div className="text-xs text-muted truncate">{ids.map(id => stationName[id]).filter(Boolean).join(', ')}</div>
                    </div>
                    <button className={cx('chip gap-1.5 px-3', off && 'bg-bad text-white border-bad')} onClick={() => setScreenOffline(s.id, !off)}
                      aria-pressed={off} title={off ? 'Bring this screen back online' : 'Take this screen offline (its taps wait until it is back)'}>
                      {off ? <WifiOff size={16} /> : <Wifi size={16} />} {off ? 'Offline' : 'Online'}
                    </button>
                    <button className="chip px-3" onClick={() => setFocus(focus ? null : s.id)} aria-label={focus ? 'Show every screen' : 'Show this screen bigger'}>
                      {focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </div>
                  <div style={{ height: size.h * scale, position: 'relative', overflow: 'hidden', background: '#000' }}>
                    <iframe
                      ref={el => { if (el) frames.current.set(s.id, el); else frames.current.delete(s.id) }}
                      title={s.name}
                      src={'/?kitchen_test=' + encodeURIComponent(token) + '&screen=' + encodeURIComponent(s.id)}
                      style={{ width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, position: 'absolute', top: 0, left: 0 }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Orders and activity */}
        <aside className="w-[300px] xl:w-[340px] shrink-0 border-l border-line bg-white flex flex-col min-h-0">
          <div className="flex border-b border-line shrink-0">
            {[['orders', 'Orders', ListChecks], ['activity', 'Activity', Activity]].map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)} className={cx('flex-1 min-h-[48px] font-semibold flex items-center justify-center gap-2 touch-manipulation',
                tab === k ? 'text-ink border-b-2 border-ink' : 'text-muted')}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {tab === 'orders'
              ? <OrdersPanel bench={bench} data={data} onChange={() => kitchenChanged('bench')} say={say} />
              : <ActivityPanel log={bench.state.log} />}
          </div>
        </aside>
      </div>

      {notice && (
        <div role="status" className={cx('fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl font-semibold shadow-lg text-white',
          notice.kind === 'bad' ? 'bg-bad' : 'bg-ok')}>{notice.text}</div>
      )}
      {builder && <OrderBuilder data={data} onClose={() => setBuilder(false)} onSend={spec => { if (send(spec)) setBuilder(false) }} />}
    </div>
  )
}

function ConfirmButton({ onConfirm, label, icon: Icon, confirmLabel }) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <button className="btn" onClick={() => setAsking(true)}><Icon size={18} /> {label}</button>
  return (
    <span className="flex items-center gap-2">
      <span className="text-sm font-semibold">{confirmLabel}</span>
      <button className="btn btn-bad" onClick={() => { setAsking(false); onConfirm() }}>Yes</button>
      <button className="btn" onClick={() => setAsking(false)}>No</button>
    </span>
  )
}

// ── Orders: where every dish is ────────────────────────────────────

const STATE_STYLE = {
  done: 'bg-ok-soft text-ok border-ok/30',
  active: 'bg-warn-soft text-warn border-warn/40',
  upcoming: 'bg-page text-muted border-line',
  held: 'bg-held-soft text-held border-held/30',
  voided: 'bg-page text-muted border-line line-through',
}
const STATE_WORD = { done: 'done', active: 'now', upcoming: 'next', held: 'held', voided: 'voided' }

function OrdersPanel({ bench, data, onChange, say }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 5000); return () => clearInterval(t) }, [])
  const now = new Date().toISOString()
  const cfg = bench.cfg()
  const orders = Object.values(bench.orders()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const boards = data.stations.filter(s => s.kind === 'board')
  const courseName = Object.fromEntries((data.courses || []).map(c => [c.id, c.name]))

  if (!orders.length) {
    return <div className="p-6 text-center text-muted">No test orders yet. Send a made-up order, or build one with Test order.</div>
  }
  return (
    <div className="p-3 space-y-3">
      {boards.map(b => {
        const n = boardNumbers(bench.orders(), now, { boardId: b.id, cfg })
        return (
          <div key={b.id} className="rounded-xl border border-line p-3 text-sm">
            <div className="font-semibold">{b.name}</div>
            <div className="text-muted">Preparing: {n.preparing.map(x => x.number).join(', ') || 'none'}</div>
            <div className="text-ok font-semibold">Ready: {n.ready.map(x => x.number).join(', ') || 'none'}</div>
          </div>
        )
      })}
      {orders.map(o => {
        const held = {}
        for (const i of o.items) if (!i.fired_at && !i.fire_at && !i.voided_at && i.course_id) held[i.course_id] = true
        return (
          <div key={o.id} className="rounded-xl border border-line p-3" data-testid="bench-order">
            <div className="flex items-center gap-2">
              <div className="font-bold text-lg">#{o.number}</div>
              <div className="text-sm text-muted truncate flex-1">
                {[o.table ? 'Table ' + o.table : o.source === 'online' ? 'Online' : 'Counter', o.tent && 'Tent ' + o.tent, o.guest || o.tab, o.type_name].filter(Boolean).join(' · ')}
              </div>
              <span className={cx('text-xs font-bold px-2 py-1 rounded-full',
                o.status === 'ready' ? 'bg-ok text-white' : o.status === 'collected' ? 'bg-ink text-white' : o.status === 'cancelled' ? 'bg-bad text-white' : 'bg-page text-ink')}>
                {o.status === 'active' ? 'In the kitchen' : o.status === 'ready' ? 'Ready' : o.status === 'collected' ? 'Collected' : o.status === 'cancelled' ? 'Cancelled' : o.status}
              </span>
            </div>
            <div className="mt-2 space-y-2">
              {o.items.map(i => {
                const nodes = routeOrder(i.route)
                return (
                  <div key={i.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <div className={cx('font-semibold flex-1 min-w-0 truncate', i.voided_at && 'line-through text-muted')}>{i.qty} x {i.name}</div>
                      {!i.voided_at && o.source === 'till' && (
                        <button className="text-muted hover:text-bad p-2 -m-1 touch-manipulation" aria-label={'Void ' + i.name}
                          onClick={() => { const r = bench.voidItem(o.id, i.id); if (r.ok) onChange(); else say(r.error, 'bad') }}><X size={16} /></button>
                      )}
                    </div>
                    {i.parts?.length > 0 && <div className="text-xs text-muted">{i.parts.map(p => p.name).join(', ')}</div>}
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      {nodes.length === 0 && <span className="text-xs text-bad">Goes to no station in this flow</span>}
                      {nodes.map((n, idx) => {
                        const st = nodeState(i, n, cfg, now) || 'upcoming'
                        return (
                          <span key={n} className="flex items-center gap-1">
                            {idx > 0 && <ChevronRight size={12} className="text-muted" />}
                            <span className={cx('text-xs px-2 py-0.5 rounded-full border', STATE_STYLE[st])} title={STATE_WORD[st]}>
                              {cfg.stations[n]?.name || 'Gone'}{st === 'active' ? ' (now)' : st === 'held' ? ' (held)' : ''}
                            </span>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            {Object.keys(held).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.keys(held).map(cid => (
                  <button key={cid} className="btn btn-warn min-h-[44px]" onClick={() => { const r = bench.fireCourse(o.id, cid); if (r.ok) onChange(); else say(r.error, 'bad') }}>
                    <Flame size={16} /> Fire {courseName[cid] || 'course'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ActivityPanel({ log }) {
  if (!log.length) return <div className="p-6 text-center text-muted">Taps on the screens and orders sent show here.</div>
  return (
    <ul className="divide-y divide-line">
      {log.map((e, i) => (
        <li key={i} className="px-3 py-2 text-sm">
          <div className="flex gap-2">
            <span className="text-muted tabular-nums">{timeOf(e.at)}</span>
            <span className="font-semibold">{e.screen}</span>
          </div>
          <div className={e.ok ? '' : 'text-bad'}>
            {e.ok ? '' : 'Refused: '}{EVENT_WORDS[e.type] || e.type}{e.number ? ' #' + e.number : ''}{e.station ? ' at ' + e.station : ''}{e.flow ? ': ' + e.flow : ''}
            {!e.ok && e.error ? ' (' + e.error + ')' : ''}
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── Building a test order ──────────────────────────────────────────

function OrderBuilder({ data, onClose, onSend }) {
  const [source, setSource] = useState('till')
  const [typeId, setTypeId] = useState(data.order_types?.[0]?.id || null)
  const [streamId, setStreamId] = useState(data.streams?.[0]?.id || null)
  const [tableId, setTableId] = useState(null)
  const [tent, setTent] = useState('')
  const [name, setName] = useState('')
  const [holdCourses, setHoldCourses] = useState(false)
  const [lines, setLines] = useState([])
  const [q, setQ] = useState('')
  const items = data.items || {}
  const sections = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const m of data.menus || []) {
      for (const s of m.sections) {
        if (seen.has(s.id)) continue
        seen.add(s.id)
        out.push({ ...s, menu: m.name })
      }
    }
    return out
  }, [data.menus])
  const needle = q.trim().toLowerCase()
  const add = id => setLines(ls => {
    const have = ls.find(l => l.item_id === id)
    return have ? ls.map(l => (l === have ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { item_id: id, qty: 1 }]
  })
  const setQty = (id, qty) => setLines(ls => (qty <= 0 ? ls.filter(l => l.item_id !== id) : ls.map(l => (l.item_id === id ? { ...l, qty } : l))))
  const hasCourses = lines.some(l => items[l.item_id]?.course_id)

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-label="Test order">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <div className="font-bold text-lg flex-1">Test order</div>
          <button className="btn btn-ghost px-3" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[1fr_300px] gap-4 p-4">
          <div className="space-y-3 min-w-0">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input pl-10" placeholder="Find a dish" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            {sections.map(s => {
              const ids = s.item_ids.filter(id => items[id] && (!needle || items[id].name.toLowerCase().includes(needle)))
              if (!ids.length) return null
              return (
                <div key={s.id}>
                  <div className="label mb-1">{s.title}</div>
                  <div className="flex flex-wrap gap-2">
                    {ids.map(id => (
                      <button key={id} className="chip gap-1.5" onClick={() => add(id)}>
                        <Plus size={14} /> {items[id].name}{items[id].kind === 'combo' ? ' (combo)' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            {!sections.length && <div className="text-muted">No published menus with dishes for this venue.</div>}
          </div>
          <div className="space-y-4">
            <Group label="Comes from">
              {[['till', 'The till'], ['online', 'Online']].map(([k, label]) => (
                <button key={k} className={cx('chip', source === k && 'chip-on')} onClick={() => setSource(k)}>{label}</button>
              ))}
            </Group>
            {(data.order_types || []).length > 0 && (
              <Group label="Order type">
                {data.order_types.map(t => <button key={t.id} className={cx('chip', typeId === t.id && 'chip-on')} onClick={() => setTypeId(t.id)}>{t.name}</button>)}
              </Group>
            )}
            {(data.streams || []).length > 1 && (
              <Group label="Revenue stream">
                {data.streams.map(r => <button key={r.id} className={cx('chip', streamId === r.id && 'chip-on')} onClick={() => setStreamId(r.id)}>{r.name}</button>)}
              </Group>
            )}
            {source === 'till' && (
              <label className="block">
                <span className="label">Where</span>
                <select className="input mt-1" value={tableId || ''} onChange={e => setTableId(e.target.value || null)}>
                  <option value="">Counter (order number)</option>
                  {(data.tables || []).map(t => <option key={t.id} value={t.id}>Table {t.label}</option>)}
                </select>
              </label>
            )}
            {source === 'till' && !tableId && (
              <label className="block">
                <span className="label">Tent number</span>
                <input className="input mt-1" inputMode="numeric" maxLength={10} placeholder="None" value={tent}
                  onChange={e => setTent(e.target.value)} data-testid="bench-tent" />
              </label>
            )}
            <label className="block">
              <span className="label">Customer name</span>
              <input className="input mt-1" maxLength={60} placeholder={source === 'online' ? 'Test guest' : 'None'} value={name}
                onChange={e => setName(e.target.value)} data-testid="bench-name" />
            </label>
            {source === 'till' && hasCourses && (
              <button className={cx('chip w-full', holdCourses && 'chip-on')} aria-pressed={holdCourses} onClick={() => setHoldCourses(v => !v)}>
                Hold later courses (fire them from the order)
              </button>
            )}
            <div>
              <div className="label mb-1">Dishes</div>
              {!lines.length && <div className="text-sm text-muted">Tap dishes to add them.</div>}
              <div className="space-y-2">
                {lines.map(l => (
                  <div key={l.item_id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 text-sm font-semibold truncate">{items[l.item_id]?.name}</div>
                    <button className="chip px-3 min-w-[44px]" onClick={() => setQty(l.item_id, l.qty - 1)} aria-label="One less"><Minus size={16} /></button>
                    <span className="w-6 text-center tabular-nums font-bold">{l.qty}</span>
                    <button className="chip px-3 min-w-[44px]" onClick={() => setQty(l.item_id, l.qty + 1)} aria-label="One more"><Plus size={16} /></button>
                  </div>
                ))}
              </div>
              {lines.some(l => items[l.item_id]?.kind === 'combo') && (
                <div className="text-xs text-muted mt-2">A combo's choices are picked at random.</div>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-line">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!lines.length} data-testid="bench-send"
            onClick={() => onSend({
              source, order_type_id: typeId, revenue_stream_id: streamId, table_id: source === 'till' ? tableId : null,
              tent: source === 'till' && !tableId ? tent : null, name, hold_courses: holdCourses, lines,
            })}>
            Send to the kitchen
          </button>
        </div>
      </div>
    </div>
  )
}

function Group({ label, children }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}
