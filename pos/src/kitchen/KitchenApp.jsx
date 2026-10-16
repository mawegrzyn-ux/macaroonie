// The kitchen screen (KDS, docs/POS.md section 9). A device paired as a
// kitchen screen in Till setup opens here instead of the till.
//
// Tickets in columns, oldest first (rush orders first), with a timer that
// turns amber at the station's target time and red when late. Tap a dish to
// mark it done, tap a ticket to pick it, BUMP to finish it here: the dishes
// go on to the next station in the kitchen flow (Prep 1 > Prep 2 > Expo 1),
// and the expo (READY) or a runner (DONE) finishes the whole order. A
// station that shows dishes before they arrive marks them with where they
// are now ("At Prep 1"). Bump bars and keyboards work too: 1-9 / 0 pick a
// ticket, Enter or Space bumps, arrows page, R brings the last ticket back,
// S shows what is on order, P makes a ticket a rush.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Check, RotateCcw, ListOrdered, Flame, Settings, Maximize, Minimize, Clock,
  Wifi, WifiOff, X, Utensils, AlertTriangle, Keyboard, Volume2, PackageCheck,
} from 'lucide-react'
import {
  stationTickets, recentBumps, laterOrders, onOrderCounts, stationStats, ageTone, clockSince, clockSecs,
  itemState, readyOrders, isOrderLevel, stationSettings,
} from '@shared/pos/kitchen.js'
import {
  useKitchen, useOrders, useCfg, bootKitchen, nowIso, myStations, currentStation, setPrefs, bump, recall, itemDone,
  remake, priority, collected, unlockAudio, chime, loadConfig, toast,
} from './store.js'

const cx = (...p) => p.filter(Boolean).join(' ')

function useTick(ms) {
  const [, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set(n => n + 1), ms); return () => clearInterval(t) }, [ms])
}

function useWidth() {
  const [w, setW] = useState(window.innerWidth)
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  return w
}

/** Keep the screen on while the kitchen screen is open. */
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

const TEXT = {
  normal: { item: 'text-[15px]', mod: 'text-[13px]', head: 'text-[15px]' },
  large:  { item: 'text-[18px]', mod: 'text-[16px]', head: 'text-[17px]' },
  xl:     { item: 'text-[22px]', mod: 'text-[19px]', head: 'text-[20px]' },
}

// Filters: all, one per order type (the tenant's own, migration 170), online.
function filtersFor(types) {
  return [
    { key: 'all', label: 'All orders', test: () => true },
    ...(types || []).map(t => ({ key: t.id, label: t.name, test: o => o.type === t.id })),
    { key: 'online', label: 'Online', test: o => o.source === 'online' },
  ]
}
// Ticket badge colours by order type position (a type's own colour wins).
const TYPE_COLOURS = ['bg-[#9be7a1] text-black', 'bg-[#25a7a7] text-white', 'bg-[#7c5cd6] text-white', 'bg-[#e0a33a] text-black', 'bg-[#d6577c] text-white']

const REMAKE_REASONS = ['Dropped', 'Wrong dish', 'Undercooked', 'Cold', 'Sent back', 'Other']

export default function KitchenApp({ device }) {
  useEffect(() => { bootKitchen(device) }, [device])
  useWakeLock()
  const s = useKitchen()
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])
  let body
  if (s.phase === 'loading') body = <div className="h-full bg-black" />
  else if (!s.config) body = <NoConfig />
  else if (!myStations(s).length) body = <NoStations />
  else body = <Kitchen />
  return <div className="h-full bg-black text-white select-none">{body}<Toasts /></div>
}

function NoConfig() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <WifiOff className="mx-auto text-red-400" size={44} />
        <div className="text-2xl font-bold">Can't reach Macaroonie</div>
        <div className="text-white/70">This kitchen screen needs to download its setup once. Check the Wi-Fi.</div>
        <button className="h-14 px-6 rounded-xl bg-white text-black font-bold" onClick={loadConfig}>Try again</button>
      </div>
    </div>
  )
}

function NoStations() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <Utensils className="mx-auto text-white/60" size={44} />
        <div className="text-2xl font-bold">No kitchen stations yet</div>
        <div className="text-white/70">In Macaroonie, open Till setup, then Kitchen screens, and add a station (Grill, Fryer, Pass...).</div>
        <button className="h-14 px-6 rounded-xl bg-white text-black font-bold" onClick={loadConfig}>Check again</button>
      </div>
    </div>
  )
}

function Toasts() {
  const { toasts } = useKitchen()
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 space-y-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} role="status" className={cx('px-5 py-3 rounded-xl font-semibold shadow-lg', t.kind === 'bad' ? 'bg-red-600' : t.kind === 'ok' ? 'bg-green-700' : 'bg-zinc-800')}>{t.text}</div>
      ))}
    </div>
  )
}

// ── The kitchen ──────────────────────────────────────────────────

function Kitchen() {
  useTick(1000)
  const s = useKitchen()
  const orders = useOrders()
  const cfg = useCfg()
  const width = useWidth()
  const now = nowIso()
  const stations = myStations(s)
  const station = currentStation(s)
  const dev = s.config.device?.settings || {}
  const names = useMemo(() => Object.fromEntries((s.config.stations || []).map(x => [x.id, x.name])), [s.config.stations])
  const view = s.prefs.view || dev.view || 'tickets'
  const filterKey = s.prefs.filter || 'all'
  const text = TEXT[dev.text_size] || TEXT.normal
  const cols = Math.max(2, Math.min(10, dev.columns || Math.max(3, Math.floor(width / 230))))
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(null)
  const [panel, setPanel] = useState(null)   // 'recall' | 'sum' | 'later' | 'ready' | 'settings' | 'keys' | { remake }
  const [full, setFull] = useState(!!document.fullscreenElement)

  const all = useMemo(() => stationTickets(orders, station, now, cfg), [orders, station, now, cfg])
  const FILTERS = useMemo(() => filtersFor(s.config.order_types), [s.config.order_types])
  const filter = FILTERS.find(f => f.key === filterKey) || FILTERS[0]
  const tickets = all.filter(t => filter.test(t.order))
  const pages = Math.max(1, Math.ceil(tickets.length / cols))
  const pageNo = Math.min(page, pages - 1)
  const shown = tickets.slice(pageNo * cols, pageNo * cols + cols)
  const left = pageNo * cols
  const right = Math.max(0, tickets.length - left - shown.length)
  const sel = shown.find(t => t.order.id === selected) || shown[0] || null
  const later = laterOrders(orders, now)
  const orderLevel = isOrderLevel(station)
  const ready = orderLevel ? readyOrders(orders, station, now) : []

  // The trading day starts at day_starts_at (04:00): the speed figures count from then.
  const dayFrom = useMemo(() => {
    const [h, m] = String(s.config.settings?.day_starts_at || '04:00').split(':').map(Number)
    const d = new Date(Date.parse(now))
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m)
    if (start > d) start.setDate(start.getDate() - 1)
    return start.toISOString()
  }, [s.config.settings?.day_starts_at, now.slice(0, 13)]) // eslint-disable-line react-hooks/exhaustive-deps
  const stats = stationStats(orders, station, dayFrom)

  useEffect(() => { if (page !== pageNo) setPage(pageNo) }, [page, pageNo])
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])

  const doBump = t => {
    const target = t || sel
    if (!target) return
    const r = bump(target.order.id, station.id)
    if (!r.ok) { toast(r.error, 'bad'); return }
    const idx = shown.indexOf(target)
    const next = shown[idx + 1] || shown[idx - 1]
    setSelected(next ? next.order.id : null)
  }
  const doRecallLast = () => {
    const last = recentBumps(orders, station, now, 1)[0]
    if (!last) { toast('Nothing to bring back'); return }
    const r = recall(last.order.id, station.id)
    if (!r.ok) toast(r.error, 'bad')
    else toast('Brought back ' + label(last.order), 'ok')
  }
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  // Bump bars and keyboards.
  const keyState = useRef({})
  keyState.current = { shown, sel, doBump, doRecallLast, pages, pageNo, panel, station }
  useEffect(() => {
    const onKey = e => {
      const k = keyState.current
      if (e.target.closest?.('input, textarea')) return
      if (k.panel && e.key === 'Escape') { setPanel(null); return }
      if (k.panel) return
      if (/^[0-9]$/.test(e.key)) {
        const i = e.key === '0' ? 9 : Number(e.key) - 1
        if (k.shown[i]) setSelected(k.shown[i].order.id)
      } else if (e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 'b') {
        e.preventDefault(); k.doBump()
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setPage(p => Math.min(k.pages - 1, p + 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setPage(p => Math.max(0, p - 1))
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const i = k.shown.indexOf(k.sel) + (e.key === 'ArrowDown' ? 1 : -1)
        if (k.shown[i]) setSelected(k.shown[i].order.id)
      } else if (e.key.toLowerCase() === 'r') k.doRecallLast()
      else if (e.key.toLowerCase() === 's') setPanel('sum')
      else if (e.key.toLowerCase() === 'p' && k.sel) priority(k.sel.order.id, !k.sel.order.priority)
      else if (e.key === 'Home') setPage(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const counts = Object.fromEntries(FILTERS.map(f => [f.key, all.filter(t => f.test(t.order)).length]))
  const live = s.online && s.socket === 'open'
  const mode = !s.online ? { text: 'Offline', cls: 'bg-red-600 text-white' }
    : live ? { text: 'Live', cls: 'bg-[#9be7a1] text-black' }
      : { text: 'Checking every few seconds', cls: 'bg-amber-400 text-black' }

  return (
    <div className="h-full flex flex-col">
      {/* Tabs: filters and stations */}
      <div className="h-12 shrink-0 flex items-stretch bg-black border-b border-white/10">
        <div className="flex items-stretch overflow-x-auto no-scrollbar flex-1 min-w-0">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => { setPrefs({ filter: f.key }); setPage(0) }}
              className={cx('px-4 sm:px-6 font-bold whitespace-nowrap text-[15px] touch-manipulation',
                filterKey === f.key ? 'bg-[#0b6b35] text-white' : 'text-[#d8c58a]')}>
              <span className="inline-block max-w-[11rem] truncate align-bottom">{f.label}</span> ({counts[f.key]})
            </button>
          ))}
          {stations.length > 1 && <div className="w-px bg-white/20 my-2 mx-1" />}
          {stations.length > 1 && stations.map(st => (
            <button key={st.id} onClick={() => { setPrefs({ station_id: st.id }); setPage(0); setSelected(null) }}
              className={cx('px-4 font-bold whitespace-nowrap uppercase text-[14px] touch-manipulation',
                st.id === station.id ? 'bg-white text-black' : 'text-[#d8c58a]')}>
              {st.name}
            </button>
          ))}
        </div>
        {later.length > 0 && (
          <button onClick={() => setPanel('later')} className="px-3 flex items-center gap-1.5 text-[#d8c58a] font-bold whitespace-nowrap touch-manipulation">
            <Clock size={18} /> Later ({later.length})
          </button>
        )}
      </div>
      {/* Stats bar */}
      <div className="h-11 shrink-0 bg-[#0b6b35] flex items-center gap-3 sm:gap-6 px-3 text-[13px] whitespace-nowrap overflow-x-auto no-scrollbar">
        <span className="font-bold tabular-nums">{'<--'}{left}</span>
        <span className="font-bold uppercase tracking-wide">{station.name} · {filter.label}</span>
        <Stat label="Avg bump" value={clockSecs(stats.avg_secs)} />
        <Stat label="Last 10" value={clockSecs(stats.moving_secs)} />
        <Stat label="Done today" value={stats.done} />
        <span className={cx('px-3 h-8 rounded flex items-center font-bold', mode.cls)}>
          {s.online ? <Wifi size={15} className="mr-1.5" /> : <WifiOff size={15} className="mr-1.5" />}
          {mode.text}{s.outbox.length ? ' · ' + s.outbox.length + ' to send' : ''}
        </span>
        <Stat label="On time" value={stats.on_time_pct == null ? '-' : stats.on_time_pct + '%'} />
        <span className="font-bold tabular-nums ml-auto">{new Date(Date.parse(now)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="font-bold tabular-nums">{right}{'-->'}</span>
      </div>

      {/* Tickets */}
      {view === 'on_order'
        ? <OnOrderBoard orders={orders} station={station} now={now} cfg={cfg} />
        : (
          <div className="relative flex-1 min-h-0 grid gap-1.5 p-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {shown.map((t, i) => (
              <Ticket key={t.order.id} t={t} n={left + i + 1} station={station} now={now} text={text} names={names} types={s.config.order_types}
                selected={sel?.order.id === t.order.id} alert={s.alerts[t.order.id]}
                onSelect={() => setSelected(t.order.id)} />
            ))}
            {Array.from({ length: Math.max(0, cols - shown.length) }).map((_, i) => (
              <div key={'empty' + i} className="rounded bg-[#0d0d0d] border border-white/5" />
            ))}
            {!tickets.length && (
              <div className="absolute inset-x-0 top-1/2 text-center text-white/40 text-2xl font-bold pointer-events-none">
                {all.length ? 'Nothing in this view' : 'No orders. All clear.'}
              </div>
            )}
          </div>
        )}

      {/* Bottom bar: bump bar on screen */}
      <div className="h-[68px] shrink-0 bg-[#0b3d22] flex items-stretch gap-1 p-1">
        <BarBtn onClick={() => doBump()} disabled={!sel} className="bg-[#1f7a43] min-w-[88px] text-lg">
          {station.kind === 'expo' ? 'READY' : station.kind === 'runner' ? 'DONE' : 'BUMP'}
        </BarBtn>
        <div className="flex gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar">
          {Array.from({ length: cols }).map((_, i) => (
            <BarBtn key={i} onClick={() => shown[i] && setSelected(shown[i].order.id)} disabled={!shown[i]}
              className={cx('min-w-[52px] flex-1 text-xl', sel && shown[i] && sel === shown[i] ? 'bg-[#22d3ee] text-black' : 'bg-[#1f7a43]')}>
              {left + i + 1}
            </BarBtn>
          ))}
        </div>
        <BarBtn onClick={() => setPage(p => Math.max(0, p - 1))} disabled={pageNo === 0} className="bg-sky-500 w-14" title="Previous tickets on screen"><ChevronLeft size={26} /></BarBtn>
        <BarBtn onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={pageNo >= pages - 1} className="bg-sky-500 w-14" title="Next tickets on screen"><ChevronRight size={26} /></BarBtn>
        <BarBtn onClick={() => sel && priority(sel.order.id, !sel.order.priority)} disabled={!sel} className="bg-[#1f7a43] w-16" title="Rush">
          <Flame size={20} /><span className="text-[11px]">Rush</span>
        </BarBtn>
        <BarBtn onClick={() => setPanel(view === 'on_order' ? null : 'sum')} className="bg-[#1f7a43] w-16 text-sm">SUM</BarBtn>
        {orderLevel && (
          <BarBtn onClick={() => setPanel('ready')} className="bg-[#1f7a43] w-20" title="Ready to collect">
            <PackageCheck size={20} /><span className="text-[11px]">Ready ({ready.length})</span>
          </BarBtn>
        )}
        <BarBtn onClick={() => setPanel('recall')} className="bg-red-600 w-16" title="Previous tickets">
          <RotateCcw size={20} /><span className="text-[11px]">Prev</span>
        </BarBtn>
        <BarBtn onClick={() => setPanel({ remake: sel?.order.id || null })} className="bg-red-600 w-16" title="Remake a dish">
          <RotateCcw size={20} className="-scale-x-100" /><span className="text-[11px]">Remake</span>
        </BarBtn>
        <BarBtn onClick={() => setPanel('settings')} className="bg-zinc-700 w-14" title="Screen settings"><Settings size={22} /></BarBtn>
      </div>

      {panel === 'sum' && <SumPanel orders={orders} station={station} now={now} cfg={cfg} onClose={() => setPanel(null)} />}
      {panel === 'recall' && <RecallPanel orders={orders} station={station} now={now} onClose={() => setPanel(null)} />}
      {panel === 'ready' && <ReadyPanel ready={ready} now={now} onClose={() => setPanel(null)} />}
      {panel === 'later' && <LaterPanel later={later} now={now} onClose={() => setPanel(null)} />}
      {panel?.remake !== undefined && <RemakePanel orders={orders} station={station} now={now} cfg={cfg} orderId={panel.remake} onClose={() => setPanel(null)} />}
      {panel === 'settings' && (
        <SettingsPanel stations={stations} station={station} view={view} full={full} onFull={toggleFull}
          onKeys={() => setPanel('keys')} onClose={() => setPanel(null)} />
      )}
      {panel === 'keys' && <KeysPanel onClose={() => setPanel(null)} />}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <span className="flex flex-col items-center leading-tight">
      <span className="text-[10px] uppercase text-white/70">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </span>
  )
}

function BarBtn({ children, onClick, disabled, className, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className={cx('rounded flex flex-col items-center justify-center font-bold text-white touch-manipulation shrink-0 disabled:opacity-35 active:brightness-125', className)}>
      {children}
    </button>
  )
}

const label = o => o.table ? 'Table ' + o.table : o.tab ? o.tab : o.guest ? o.guest : 'Order ' + o.number

// ── A ticket ─────────────────────────────────────────────────────

function Ticket({ t, n, station, now, text, selected, alert, onSelect, names, types }) {
  const o = t.order
  const tone = ageTone(t.since, now, station)
  const fresh = alert && Date.now() - alert < 30000
  // At the expo / a runner: every dish has reached it, nothing still on its way.
  const live = t.items.filter(i => i.state !== 'voided' && i.state !== 'held')
  const allDone = isOrderLevel(station) && live.length > 0 && live.every(i => i.state === 'active' || i.state === 'done')
  // Dishes on this ticket go on different ways: label each one.
  const nextKeys = new Set(live.map(i => (i.next || []).join(',')))
  const showNext = !isOrderLevel(station) && nextKeys.size > 1
  const headBg = o.priority ? 'bg-[#b45309]' : fresh ? 'bg-[#8f8a4b]' : allDone ? 'bg-[#1d9a52]' : 'bg-[#2b7a4b]'
  const typeIndex = (types || []).findIndex(x => x.id === o.type)
  const typeColour = (types || [])[typeIndex]?.colour
  const typeCls = typeColour ? 'text-white' : TYPE_COLOURS[(typeIndex < 0 ? 2 : typeIndex) % TYPE_COLOURS.length]
  const groups = groupByCourse(t.items)
  return (
    <div onClick={onSelect} data-testid="kds-ticket" data-order={o.id}
      className={cx('min-h-0 flex flex-col rounded overflow-hidden bg-[#0d0d0d] cursor-pointer',
        selected ? 'ring-[3px] ring-[#22d3ee]' : 'ring-1 ring-white/10')}>
      <div className={cx('shrink-0 px-2 py-1.5', headBg)}>
        <div className="flex items-center gap-1.5">
          <span className={cx('font-bold truncate min-w-0 flex-1', text.head)}>{o.table ? 'Tbl ' + o.table : o.tab || o.guest || (o.source === 'online' ? 'Online' : 'Counter')}</span>
          {o.number && <span className="bg-white text-black font-black px-2 rounded tabular-nums text-[17px]">{o.number}</span>}
          <span className={cx('font-black px-1.5 rounded tabular-nums text-[17px]',
            tone === 'late' ? 'bg-red-600 text-white' : tone === 'warn' ? 'bg-amber-400 text-black' : 'bg-black/30 text-white')}
            data-testid="kds-timer">{clockSince(t.since, now)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[12px]">
          <span className="font-semibold text-white/80 tabular-nums">#{n}</span>
          {o.priority && <span className="bg-white text-[#b45309] font-black px-1.5 rounded">RUSH</span>}
          {fresh && !o.priority && <span className="font-black">NEW</span>}
          {allDone && <span className="font-black">PREPARED</span>}
          {(o.type_name || o.tent) && (
            <span className={cx('px-1.5 rounded font-bold whitespace-nowrap shrink-0', typeCls)} style={typeColour ? { background: typeColour } : undefined} data-testid="kds-type">
              {[o.type_name, o.tent ? 'Tent ' + o.tent : null].filter(Boolean).join(' · ')}
            </span>
          )}
          {o.promised_at && <span className="font-semibold">for {new Date(o.promised_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
          <span className="ml-auto min-w-0 text-white/80 truncate">{o.covers ? o.covers + ' cvr' : ''}{o.server ? ' · ' + o.server : ''}</span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        {o.allergy && <div className="bg-red-600 px-2 py-1 font-bold text-[13px]"><AlertTriangle size={14} className="inline -mt-0.5 mr-1" />Allergy: {o.allergy}</div>}
        {o.note && <div className="bg-yellow-300 text-black px-2 py-1 font-semibold text-[13px]">{o.note}</div>}
        {t.elsewhere?.length > 0 && (
          <div className="bg-zinc-800 text-white/80 px-2 py-0.5 text-[12px] font-semibold" data-testid="kds-elsewhere">
            Also on this order: {t.elsewhere.map(x => x.count + ' via ' + (names[x.station_id] || 'another station')).join(', ')}
          </div>
        )}
        {groups.map(g => (
          <div key={g.key}>
            {g.title && (
              <div className={cx('px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide', g.held ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800 text-white/80')}>
                {g.held ? 'Hold · ' : ''}{g.title}
              </div>
            )}
            {g.items.map(i => <ItemRow key={i.id} item={i} order={o} station={station} text={text} names={names} showNext={showNext} />)}
          </div>
        ))}
      </div>
    </div>
  )
}

function groupByCourse(items) {
  const map = new Map()
  for (const i of items) {
    const key = (i.state === 'held' ? 'h:' : '') + (i.course_id || '')
    if (!map.has(key)) map.set(key, { key, title: i.course || (i.state === 'held' && i.fire_at ? 'Later' : null), held: i.state === 'held', sort: i.course_sort ?? -1, items: [] })
    map.get(key).items.push(i)
  }
  return [...map.values()].sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || a.sort - b.sort)
}

function ItemRow({ item, order, station, text, names, showNext }) {
  const st = item.state
  const tap = e => {
    e.stopPropagation()
    if (st === 'voided' || st === 'held') return
    const r = itemDone(order.id, station.id, item.id, st !== 'done')
    if (!r.ok) toast(r.error, 'bad')
  }
  const parts = item.parts && item.parts.length ? item.parts : null
  const from = (item.from || []).map(id => names[id]).filter(Boolean)
  return (
    <div onClick={tap} data-testid="kds-item" data-state={st}
      className={cx('border-b border-black/60 touch-manipulation',
        st === 'voided' ? 'bg-[#3b0d0d]' : st === 'held' ? 'bg-zinc-800 text-zinc-400' : st === 'upcoming' ? 'bg-[#163d27] text-white/75' : 'bg-[#0e6b33]',
        st === 'done' && 'opacity-45')}>
      <div className={cx('flex items-start gap-1.5 px-2 py-1 font-bold', text.item, st === 'voided' && 'line-through text-red-300')}>
        <span className="tabular-nums shrink-0">{item.qty}</span>
        <span className="flex-1 min-w-0 break-words">{item.name}</span>
        {st === 'done' && <Check size={18} className="shrink-0 text-white" />}
        {st === 'voided' && <span className="no-underline text-[11px] bg-red-600 text-white px-1 rounded shrink-0">VOID</span>}
        {item.added && st !== 'voided' && <span className="text-[11px] bg-white text-black px-1 rounded shrink-0">ADD</span>}
        {item.remakes > 0 && <span className="text-[11px] bg-orange-500 text-black px-1 rounded shrink-0">REMAKE</span>}
        {item.seat != null && <span className="text-[11px] bg-black/40 px-1 rounded shrink-0">S{item.seat}</span>}
      </div>
      {st === 'upcoming' && item.where?.length > 0 && (
        <div className="px-2 pb-0.5 text-[11px] text-amber-200 font-semibold" data-testid="kds-where">At {item.where.map(id => names[id] || 'another station').join(', ')}</div>
      )}
      {st === 'active' && !isOrderLevel(station) && from.length > 0 && (
        <div className="px-2 pb-0.5 text-[11px] text-sky-200 font-semibold" data-testid="kds-from">From {from.join(', ')}</div>
      )}
      {showNext && st !== 'voided' && item.next?.length > 0 && (
        <div className="px-2 pb-0.5 text-[11px] text-white/70 font-semibold" data-testid="kds-next">Then {item.next.map(id => names[id] || 'another station').join(', ')}</div>
      )}
      <Mods mods={item.mods} text={text} depth={1} />
      {parts && parts.map((p, idx) => (
        <div key={idx}>
          <div className={cx('pl-5 pr-2 py-0.5 font-semibold', text.mod)}>{p.name}</div>
          <Mods mods={p.mods} text={text} depth={2} />
        </div>
      ))}
      {item.note && <div className={cx('pl-5 pr-2 py-0.5 bg-yellow-300 text-black font-semibold', text.mod)}>{item.note}</div>}
      {item.allergies?.length > 0 && <div className={cx('pl-5 pr-2 py-0.5 bg-red-600 font-bold', text.mod)}>Allergy: {item.allergies.join(', ')}</div>}
    </div>
  )
}

function Mods({ mods, text, depth }) {
  if (!mods || !mods.length) return null
  return mods.map((m, i) => (
    <div key={i} style={{ paddingLeft: 12 + (depth + (m.depth || 0)) * 10 }}
      className={cx('pr-2 py-0.5', text.mod,
        m.kind === 'remove' ? 'bg-white text-red-600 font-bold' : m.kind === 'add' ? 'bg-white text-[#d61fbf] font-bold' : 'text-white font-semibold')}>
      {m.text}
    </div>
  ))
}

// ── The On order board (a station's view, or the SUM panel) ──────

function OnOrderBoard({ orders, station, now, cfg }) {
  const counts = onOrderCounts(orders, station, now, cfg)
  return (
    <div className="flex-1 min-h-0 bg-[#eef0ee] text-black flex flex-col">
      <div className="bg-[#0b6b35] border-b-[6px] border-[#a29a59] text-white text-center font-black text-4xl py-3 tracking-wide">ON ORDER</div>
      <div className="flex-1 min-h-0 overflow-y-auto grid gap-6 p-8 content-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }} data-testid="kds-on-order">
        {counts.map(c => (
          <div key={c.id} className="text-center">
            <div className="text-[#0b6b35] font-black text-3xl uppercase">{c.name}</div>
            <div className="text-7xl font-black mt-4 tabular-nums">{c.count || ''}</div>
          </div>
        ))}
        {!counts.length && <div className="text-center text-black/40 text-2xl font-bold col-span-full">Nothing on order</div>}
      </div>
      <div className="border-t-[6px] border-[#a29a59] bg-[#0b6b35] h-4" />
    </div>
  )
}

// ── Panels ───────────────────────────────────────────────────────

function Panel({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex justify-end" onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={cx('h-full bg-zinc-900 flex flex-col w-full', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="h-14 shrink-0 flex items-center px-4 gap-3 border-b border-white/10">
          <div className="text-lg font-bold flex-1">{title}</div>
          <button onClick={onClose} className="w-12 h-12 flex items-center justify-center rounded-xl active:bg-white/10" aria-label="Close"><X size={24} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">{children}</div>
      </div>
    </div>
  )
}

function SumPanel({ orders, station, now, cfg, onClose }) {
  const counts = onOrderCounts(orders, station, now, cfg)
  return (
    <Panel title={'On order · ' + station.name} onClose={onClose}>
      {!counts.length && <div className="text-white/50 p-4">Nothing on order.</div>}
      {counts.map(c => (
        <div key={c.id} className="flex items-center gap-3 bg-[#0e6b33] rounded-lg px-4 h-14">
          <div className="flex-1 font-bold text-lg truncate">{c.name}</div>
          <div className="text-3xl font-black tabular-nums">{c.count}</div>
        </div>
      ))}
    </Panel>
  )
}

function RecallPanel({ orders, station, now, onClose }) {
  const list = recentBumps(orders, station, now)
  const [confirm, setConfirm] = useState(null)
  return (
    <Panel title="Previous tickets" onClose={onClose}>
      {!list.length && <div className="text-white/50 p-4">Nothing bumped here in the last hours.</div>}
      {list.map(({ order, bump: b }) => (
        <div key={order.id} className="bg-zinc-800 rounded-lg p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{label(order)}{order.number ? ' · ' + order.number : ''}</div>
            <div className="text-sm text-white/60">
              Bumped {new Date(b.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {clockSecs(b.seconds)}
              {order.items.length ? ' · ' + order.items.filter(i => b.set.some(([id]) => id === i.id)).map(i => i.qty + ' ' + i.name).join(', ') : ''}
            </div>
          </div>
          {confirm === order.id
            ? <button className="h-12 px-4 rounded-lg bg-red-600 font-bold" onClick={() => { const r = recall(order.id, station.id); if (!r.ok) toast(r.error, 'bad'); onClose() }}>Yes, bring back</button>
            : <button className="h-12 px-4 rounded-lg bg-white text-black font-bold" onClick={() => setConfirm(order.id)}>Bring back</button>}
        </div>
      ))}
    </Panel>
  )
}

function ReadyPanel({ ready, now, onClose }) {
  return (
    <Panel title="Ready to collect" onClose={onClose}>
      {!ready.length && <div className="text-white/50 p-4">No orders waiting to be collected.</div>}
      {ready.map(o => (
        <div key={o.id} className="bg-zinc-800 rounded-lg p-3 flex items-center gap-3">
          <div className="text-3xl font-black tabular-nums w-20">{o.number}</div>
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{o.guest || label(o)}</div>
            <div className="text-sm text-white/60">Ready {clockSince(o.ready_at, now)} ago</div>
          </div>
          <button className="h-12 px-4 rounded-lg bg-[#1d9a52] font-bold" onClick={() => { const r = collected(o.id); if (!r.ok) toast(r.error, 'bad') }}>Collected</button>
        </div>
      ))}
    </Panel>
  )
}

function LaterPanel({ later, onClose }) {
  return (
    <Panel title="Orders for later" onClose={onClose}>
      <div className="text-sm text-white/60 px-1">Online orders for a collection time. Each one comes onto the screen when it's time to start it.</div>
      {later.map(({ order, fire_at }) => (
        <div key={order.id} className="bg-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-black tabular-nums">{order.number}</div>
            <div className="flex-1 font-bold truncate">{order.guest || 'Online'}</div>
            <div className="text-right text-sm">
              <div>Starts {new Date(fire_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              {order.promised_at && <div className="text-white/60">for {new Date(order.promised_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>}
            </div>
          </div>
          <div className="text-sm text-white/70 mt-1">{order.items.map(i => i.qty + ' ' + i.name).join(', ')}</div>
        </div>
      ))}
    </Panel>
  )
}

function RemakePanel({ orders, station, now, cfg, orderId, onClose }) {
  const candidates = useMemo(() => {
    const list = []
    const add = o => { if (o && !list.includes(o)) list.push(o) }
    add(orders[orderId])
    for (const r of recentBumps(orders, station, now, 8)) add(r.order)
    return list.filter(Boolean)
  }, [orders, station, now, orderId])
  const [pick, setPick] = useState(null)
  const [reason, setReason] = useState(null)
  const mine = o => o.items.filter(i => !i.voided_at && i.route?.[station.id] && itemState(i, station, now, cfg) !== 'held')
  return (
    <Panel title="Remake a dish" onClose={onClose} wide>
      {!candidates.length && <div className="text-white/50 p-4">Pick a ticket first, or bump one: remakes come from what is on screen or just bumped.</div>}
      {candidates.map(o => (
        <div key={o.id} className="bg-zinc-800 rounded-lg p-3 space-y-2">
          <div className="font-bold">{label(o)}{o.number ? ' · ' + o.number : ''}</div>
          <div className="flex flex-wrap gap-2">
            {mine(o).map(i => (
              <button key={i.id} onClick={() => setPick({ order: o, item: i })}
                className={cx('min-h-[48px] px-3 rounded-lg font-semibold text-left', pick?.item.id === i.id && pick.order.id === o.id ? 'bg-white text-black' : 'bg-[#0e6b33]')}>
                {i.qty} {i.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      {pick && (
        <div className="bg-zinc-800 rounded-lg p-3 space-y-3 sticky bottom-0">
          <div className="font-bold">Why? <span className="font-normal text-white/60">(for the waste report)</span></div>
          <div className="flex flex-wrap gap-2">
            {REMAKE_REASONS.map(r => (
              <button key={r} onClick={() => setReason(r)} className={cx('min-h-[48px] px-4 rounded-full font-semibold', reason === r ? 'bg-white text-black' : 'bg-zinc-700')}>{r}</button>
            ))}
          </div>
          <button className="w-full h-14 rounded-xl bg-red-600 font-bold text-lg disabled:opacity-40" disabled={!reason}
            onClick={() => {
              const r = remake(pick.order.id, station.id, pick.item.id, reason)
              if (!r.ok) toast(r.error, 'bad')
              else toast('Remake: ' + pick.item.name, 'ok')
              onClose()
            }}>
            Remake {pick.item.qty} {pick.item.name}
          </button>
        </div>
      )}
    </Panel>
  )
}

function SettingsPanel({ stations, station, view, full, onFull, onKeys, onClose }) {
  const s = useKitchen()
  const st = stationSettings(station)
  return (
    <Panel title="This screen" onClose={onClose}>
      <div className="text-sm text-white/60 px-1">{s.config.venue?.name} · {s.config.device?.name || s.device?.name}</div>
      {stations.length > 1 && (
        <div className="space-y-2">
          <div className="text-xs uppercase font-bold text-white/60 px-1">Station</div>
          <div className="flex flex-wrap gap-2">
            {stations.map(x => (
              <button key={x.id} onClick={() => setPrefs({ station_id: x.id })}
                className={cx('min-h-[48px] px-4 rounded-lg font-bold', x.id === station.id ? 'bg-white text-black' : 'bg-zinc-700')}>{x.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <div className="text-xs uppercase font-bold text-white/60 px-1">Show</div>
        <div className="flex flex-wrap gap-2">
          {[['tickets', 'Tickets'], ['on_order', 'On order counts']].map(([k, l]) => (
            <button key={k} onClick={() => setPrefs({ view: k })}
              className={cx('min-h-[48px] px-4 rounded-lg font-bold', view === k ? 'bg-white text-black' : 'bg-zinc-700')}>{l}</button>
          ))}
        </div>
      </div>
      <button onClick={onFull} className="w-full min-h-[52px] rounded-lg bg-zinc-700 font-bold flex items-center justify-center gap-2">
        {full ? <Minimize size={20} /> : <Maximize size={20} />} {full ? 'Leave full screen' : 'Full screen'}
      </button>
      <button onClick={() => { unlockAudio(); chime() }} className="w-full min-h-[52px] rounded-lg bg-zinc-700 font-bold flex items-center justify-center gap-2">
        <Volume2 size={20} /> Test the new-order sound
      </button>
      <button onClick={onKeys} className="w-full min-h-[52px] rounded-lg bg-zinc-700 font-bold flex items-center justify-center gap-2">
        <Keyboard size={20} /> Bump bar and keyboard keys
      </button>
      <div className="text-sm text-white/60 px-1 pt-2">
        Tickets turn amber after {st.target_mins} min and red after {st.late_mins} min. Stations, timings and the kitchen flow (what goes where) are set in Macaroonie: Till setup, Kitchen screens.
      </div>
    </Panel>
  )
}

function KeysPanel({ onClose }) {
  const rows = [
    ['1 to 9, 0', 'Pick ticket 1 to 10 on the screen'],
    ['Enter, Space or B', 'Bump the picked ticket (expo: ready; runner: done)'],
    ['Left / Right, Page Up / Down', 'More tickets'],
    ['Up / Down', 'Pick the previous / next ticket'],
    ['R', 'Bring back the last ticket bumped here'],
    ['S', 'What is on order'],
    ['P', 'Rush the picked ticket'],
    ['Esc', 'Close a panel'],
  ]
  return (
    <Panel title="Bump bar and keyboard" onClose={onClose}>
      <div className="text-sm text-white/60 px-1">USB and Bluetooth bump bars type keys: set yours to send these.</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 bg-zinc-800 rounded-lg p-3">
          <div className="w-44 shrink-0 font-mono font-bold">{k}</div>
          <div className="text-white/80">{v}</div>
        </div>
      ))}
      <div className="flex items-center gap-2 text-white/50 text-sm px-1"><ListOrdered size={16} /> Tickets are numbered across the screen, left to right.</div>
    </Panel>
  )
}
