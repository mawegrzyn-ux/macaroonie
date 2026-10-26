// src/pages/KioskAnalytics.jsx
//
// Kiosk analytics (/pos/kiosk-analytics, Till reports view, migration 208):
// guests' visits to a venue's self-order kiosks, recorded on the kiosks
// (pos/src/kiosk/journey.js). Overview: how many visits ordered, how far the
// others got and where they gave up, time on each screen, dishes opened,
// added and left, changes of mind, hours and kiosks (aggregateJourneys() in
// shared/kioskJourney.js, worked out by the API). Visits: the list; a visit
// opens the journey player (?visit=<id>): the kiosk itself in a frame at the
// kiosk's own size (its preview link with &replay=1), driven moment by
// moment from the recording (frameAt()), the guest's touches drawn over it,
// and the visit as steps with how long each took (journeySteps()).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, Loader2, CalendarDays, ChevronLeft, Play, Pause, SkipBack, SkipForward, AlertTriangle, MousePointerClick,
  Hand, ScrollText, ShoppingBag, Clock, Info,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, openPicker } from '@/lib/utils'
import {
  frameAt, journeySteps, journeyLength, OUTCOME_LABELS, SCREEN_LABELS, OUTCOMES,
} from '@shared/kioskJourney.js'
import { PageHeader, VenueSelect, usePosVenue, ErrorNote, Btn, Segmented, money } from '@/components/pos/shared'

const isoDate = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const pct = n => Math.round((Number(n) || 0) * 100) + '%'
const when = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** 75 s -> "1 min 15 s". */
export function dur(ms) {
  const s = Math.round((Number(ms) || 0) / 1000)
  if (s < 60) return s + ' s'
  const m = Math.floor(s / 60)
  return m + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '')
}
const clock = ms => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

const OUTCOME_TONE = {
  ordered: 'bg-emerald-100 text-emerald-800',
  started_again: 'bg-amber-100 text-amber-900',
  timed_out: 'bg-red-100 text-red-800',
  left: 'bg-slate-200 text-slate-800',
  interrupted: 'bg-slate-100 text-slate-700',
}

function OutcomeBadge({ outcome }) {
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold', OUTCOME_TONE[outcome])} data-outcome={outcome}>{OUTCOME_LABELS[outcome] || outcome}</span>
}

function Card({ title, children, actions, className }) {
  return (
    <section className={cn('rounded-xl border bg-background overflow-hidden', className)}>
      <div className="px-4 py-3 section-head flex items-center gap-3">
        <h2 className="text-sm font-semibold flex-1">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Tile({ label, value, sub, testId }) {
  return (
    <div className="rounded-xl border bg-background p-4" data-testid={testId}>
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  )
}

function DateBox({ label, value, onChange }) {
  return (
    <label className="relative inline-flex items-center gap-2 h-11 px-3 rounded-lg border bg-background text-sm touch-manipulation cursor-pointer">
      <CalendarDays className="w-4 h-4 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{dayLabel(value)}</span>
      <input type="date" value={value} onChange={e => e.target.value && onChange(e.target.value)} onClick={openPicker}
        className="absolute inset-0 opacity-0 cursor-pointer" aria-label={label} />
    </label>
  )
}

const RANGES = [
  { value: '1', label: 'Today' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
]
const selectCls = 'h-11 rounded-lg border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40'

// ── Overview ─────────────────────────────────────────────────────

function Bar({ value, max, tone = 'bg-primary' }) {
  const w = max ? Math.max(value ? 2 : 0, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-2.5 rounded-full bg-muted overflow-hidden flex-1 min-w-[60px]">
      <div className={cn('h-full rounded-full', tone)} style={{ width: w + '%' }} />
    </div>
  )
}

const CANCEL_ROWS = [
  ['started_again', 'Started again (Start again button)'],
  ['timed_out', 'Timed out (nobody answered “Are you still there?”)'],
  ['left_items', 'Dishes opened and left without adding'],
  ['removed', 'Dishes taken out of the order'],
  ['restart_asked', 'Asked to start again with an order'],
  ['kept_ordering', '… and kept ordering'],
  ['idle_asked', 'Asked “Are you still there?”'],
  ['idle_answered', '… and answered'],
  ['card_declined', 'Cards declined'],
  ['card_unavailable', 'Card machine not available'],
]

function Overview({ data }) {
  const o = data.overview
  const [allDishes, setAllDishes] = useState(false)
  const devices = new Map((data.devices || []).map(d => [d.id, d]))
  if (!o.sessions) {
    return (
      <Card title="No visits yet">
        <p className="text-sm text-muted-foreground" data-testid="ka-empty">
          No guest used this venue's kiosks in these days. Kiosks record each visit as it happens (the design's Record guests' visits switch, on unless turned off) and send it once the kiosk is back on its start screen.
        </p>
      </Card>
    )
  }
  const top = o.funnel[0]?.sessions || 1
  const dishes = allDishes ? o.items : o.items.slice(0, 15)
  const maxHour = Math.max(1, ...o.by_hour.map(h => h.sessions))
  const hours = o.by_hour.filter(h => h.sessions)
  const firstHour = hours.length ? hours[0].hour : 0
  const lastHour = hours.length ? hours[hours.length - 1].hour : 23
  const maxScreen = Math.max(1, ...o.screens.map(x => x.avg_ms))
  return (
    <div className="space-y-4" data-testid="ka-overview">
      {data.truncated && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">There are more visits than the report adds up at once: it counts the latest 20,000. Pick fewer days.</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Visits" value={o.sessions} sub={o.bounced ? o.bounced + ' touched and left without opening a dish' : null} testId="ka-visits" />
        <Tile label="Ordered" value={o.ordered} sub={pct(o.conversion) + ' of visits'} testId="ka-ordered" />
        <Tile label="Orders taken" value={money(o.revenue)} sub={o.ordered ? 'average ' + money(o.avg_order) : null} testId="ka-revenue" />
        <Tile label="Time to order" value={o.ordered ? dur(o.avg_order_ms) : '-'} sub={'a visit lasts ' + dur(o.avg_duration_ms) + ' on average'} testId="ka-time" />
        <Tile label="Gave up with an order started" value={o.abandoned_with_basket} sub={o.abandoned_value ? money(o.abandoned_value) + ' left in the basket' : null} testId="ka-abandoned" />
        <Tile label="Touches per visit" value={o.taps_per_session.toFixed(1)} sub={pct(o.dead_tap_share) + ' on nothing that answers'} testId="ka-taps" />
        <Tile label="Used the allergens screen" value={o.allergen_sessions} sub={o.sessions ? pct(o.allergen_sessions / o.sessions) + ' of visits' : null} />
        <Tile label="Used the reach button" value={o.reach_sessions} sub={Object.keys(o.langs || {}).length > 1 ? Object.entries(o.langs).map(([l, n]) => l.toUpperCase() + ' ' + n).join(', ') : null} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="How far guests got">
          <div className="space-y-2" data-testid="ka-funnel">
            {o.funnel.map((f, i) => {
              const prev = i ? o.funnel[i - 1].sessions : f.sessions
              const lost = prev - f.sessions
              return (
                <div key={f.stage} className="flex items-center gap-3 text-sm" data-stage={f.stage}>
                  <span className="w-40 shrink-0">{f.label}</span>
                  <Bar value={f.sessions} max={top} />
                  <span className="w-20 text-right tabular-nums font-semibold">{f.sessions} <span className="text-xs text-muted-foreground font-normal">{pct(f.sessions / top)}</span></span>
                  <span className="w-16 text-right tabular-nums text-xs text-red-700">{i && lost > 0 ? '−' + lost : ''}</span>
                </div>
              )
            })}
          </div>
        </Card>
        <Card title="How visits ended">
          <div className="space-y-2" data-testid="ka-outcomes">
            {OUTCOMES.filter(k => o.outcomes[k]).map(k => (
              <div key={k} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0"><OutcomeBadge outcome={k} /></span>
                <Bar value={o.outcomes[k]} max={o.sessions} tone={k === 'ordered' ? 'bg-emerald-600' : k === 'timed_out' ? 'bg-red-500' : 'bg-slate-400'} />
                <span className="w-20 text-right tabular-nums font-semibold">{o.outcomes[k]}</span>
              </div>
            ))}
          </div>
          {o.gave_up.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-muted-foreground mt-4 mb-2">Where the guests who didn't order were last</h3>
              <div className="space-y-1.5" data-testid="ka-gave-up">
                {o.gave_up.map(g => (
                  <div key={g.screen} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0">{g.label}</span>
                    <Bar value={g.count} max={o.abandoned} tone="bg-amber-500" />
                    <span className="w-20 text-right tabular-nums">{g.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Time on each screen">
          <table className="w-full text-sm" data-testid="ka-screens">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-2">Screen</th><th className="py-1.5 pr-2 text-right">Visits</th><th className="py-1.5 pr-2">Average</th><th className="py-1.5 text-right">In all</th></tr></thead>
            <tbody className="divide-y">
              {o.screens.map(x => (
                <tr key={x.screen}>
                  <td className="py-1.5 pr-2">{x.label}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{x.visits}</td>
                  <td className="py-1.5 pr-2"><div className="flex items-center gap-2"><Bar value={x.avg_ms} max={maxScreen} /><span className="tabular-nums w-20 text-right">{dur(x.avg_ms)}</span></div></td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{dur(x.total_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Changes of mind">
          <dl className="divide-y text-sm" data-testid="ka-cancels">
            {CANCEL_ROWS.filter(([k]) => o.cancels[k]).map(([k, label]) => (
              <div key={k} className="flex justify-between gap-3 py-1.5" data-cancel={k}><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums font-semibold">{o.cancels[k]}</dd></div>
            ))}
            {!CANCEL_ROWS.some(([k]) => o.cancels[k]) && <p className="text-muted-foreground">None.</p>}
          </dl>
        </Card>
      </div>

      <Card title="Dishes" actions={o.items.length > 15 && <button type="button" className="text-xs font-medium underline touch-manipulation" onClick={() => setAllDishes(v => !v)}>{allDishes ? 'Show fewer' : 'Show all ' + o.items.length}</button>}>
        {!o.items.length ? <p className="text-sm text-muted-foreground">No dish was opened or added.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]" data-testid="ka-dishes">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3">Dish</th><th className="py-1.5 pr-3 text-right">Opened</th><th className="py-1.5 pr-3 text-right">Time looking</th>
                  <th className="py-1.5 pr-3 text-right">Added</th><th className="py-1.5 pr-3 text-right">Left without adding</th><th className="py-1.5 text-right">Taken out</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dishes.map(x => (
                  <tr key={x.id} data-item={x.id}>
                    <td className="py-1.5 pr-3 font-medium">{x.name || 'A dish no longer on the menu'}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{x.views}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{x.views ? dur(x.avg_view_ms) : '-'}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums font-semibold">{x.qty}</td>
                    <td className={cn('py-1.5 pr-3 text-right tabular-nums', x.left > 0 && 'text-amber-800 font-semibold')}>{x.left}</td>
                    <td className="py-1.5 text-right tabular-nums">{x.removed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3">Opened: the dish's own page (a dish added straight from the menu with + isn't opened). Time looking: the average time its page stayed open.</p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="By hour">
          <div className="flex items-end gap-1 h-32" data-testid="ka-hours">
            {o.by_hour.filter(h => h.hour >= firstHour && h.hour <= lastHour).map(h => (
              <div key={h.hour} className="flex-1 min-w-[14px] flex flex-col items-center justify-end h-full" title={`${h.hour}:00 · ${h.sessions} visits · ${h.ordered} ordered`}>
                <span className="text-[10px] tabular-nums text-muted-foreground">{h.sessions || ''}</span>
                <div className="w-full rounded-t bg-muted relative" style={{ height: Math.round((h.sessions / maxHour) * 100) + '%' }}>
                  <div className="absolute inset-x-0 bottom-0 rounded-t bg-primary" style={{ height: h.sessions ? Math.round((h.ordered / h.sessions) * 100) + '%' : 0 }} />
                </div>
                <span className="text-[10px] text-muted-foreground mt-0.5">{h.hour}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Visits by the hour they started (venue time); the darker part ordered.</p>
        </Card>
        <Card title="By kiosk">
          <table className="w-full text-sm" data-testid="ka-kiosks">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-2">Kiosk</th><th className="py-1.5 pr-2 text-right">Visits</th><th className="py-1.5 pr-2 text-right">Ordered</th><th className="py-1.5 pr-2 text-right">Orders</th><th className="py-1.5 text-right">Average visit</th></tr></thead>
            <tbody className="divide-y">
              {o.by_device.map(d => (
                <tr key={d.device_id || 'none'}>
                  <td className="py-1.5 pr-2">{devices.get(d.device_id)?.name || 'A removed kiosk'}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{d.sessions}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{d.ordered} <span className="text-xs text-muted-foreground">{pct(d.ordered / d.sessions)}</span></td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{money(d.revenue)}</td>
                  <td className="py-1.5 text-right tabular-nums">{dur(d.avg_duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}

// ── Visits ───────────────────────────────────────────────────────

function Visits({ venueId, query, onOpen }) {
  const api = useApi()
  const [outcome, setOutcome] = useState('')
  const [pages, setPages] = useState(1)
  const limit = 50 * pages
  const q = query + (outcome ? '&outcome=' + outcome : '') + '&limit=' + Math.min(200, limit)
  const { data, isLoading, error } = useQuery({
    queryKey: ['kiosk-visits', venueId, q],
    queryFn: () => api.get(`/pos/kiosk-analytics/venues/${venueId}/sessions?${q}`),
  })
  const rows = data?.sessions || []
  return (
    <div className="space-y-3" data-testid="ka-visits-list">
      <div className="flex flex-wrap items-center gap-2">
        <select value={outcome} onChange={e => { setOutcome(e.target.value); setPages(1) }} className={selectCls} aria-label="How the visit ended" data-testid="ka-outcome-filter">
          <option value="">Every visit</option>
          {OUTCOMES.map(k => <option key={k} value={k}>{OUTCOME_LABELS[k]}</option>)}
        </select>
        {data && <span className="text-sm text-muted-foreground">{data.total} {data.total === 1 ? 'visit' : 'visits'}</span>}
      </div>
      <ErrorNote error={error} />
      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />}
      {data && !rows.length && <p className="text-sm text-muted-foreground">No visits in these days.</p>}
      <div className="rounded-xl border bg-background divide-y overflow-hidden">
        {rows.map(r => (
          <button key={r.id} type="button" onClick={() => onOpen(r.id)} data-testid="ka-visit" data-id={r.id}
            className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-muted/50 touch-manipulation min-h-[56px]">
            <span className="w-36 shrink-0 text-sm font-medium tabular-nums">{when(r.started_at)}</span>
            <span className="w-28 shrink-0 text-sm text-muted-foreground truncate">{r.device_name || 'A removed kiosk'}</span>
            <OutcomeBadge outcome={r.outcome} />
            <span className="text-sm tabular-nums">{dur(r.duration_ms)}</span>
            <span className="text-sm text-muted-foreground flex-1 min-w-[140px]">
              {r.outcome === 'ordered'
                ? 'Order ' + (r.order_no || '') + (r.total_pence != null ? ' · ' + money(r.total_pence) : '')
                : r.basket_value_pence ? money(r.basket_value_pence) + ' in the basket, last on ' + (SCREEN_LABELS[r.last_screen] || r.last_screen) : 'Last on ' + (SCREEN_LABELS[r.last_screen] || r.last_screen)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{r.taps} touches{r.dead_taps ? ', ' + r.dead_taps + ' on nothing' : ''}</span>
            {!r.has_events && <span className="text-xs text-muted-foreground">(summary only)</span>}
          </button>
        ))}
      </div>
      {data && rows.length < data.total && limit < 200 && <Btn onClick={() => setPages(p => p + 1)}>Show more</Btn>}
    </div>
  )
}

// ── The journey player ───────────────────────────────────────────

const SPEEDS = [1, 2, 4, 8]
const LONG_PAUSE_MS = 2500

const STEP_ICONS = { tap: MousePointerClick, swipe: Hand, scroll: ScrollText, add: ShoppingBag, ordered: ShoppingBag }

export function VisitPlayer({ id, onBack }) {
  const api = useApi()
  const { data, isLoading, error } = useQuery({
    queryKey: ['kiosk-visit', id], queryFn: () => api.get(`/pos/kiosk-analytics/sessions/${id}`),
  })
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={onBack} data-testid="ka-back"><ChevronLeft className="w-4 h-4" /> Visits</Btn>
        {data && (
          <h2 className="text-base font-semibold flex-1 min-w-[200px] flex flex-wrap items-center gap-2">
            {when(data.session.started_at)} · {data.session.device_name || 'A removed kiosk'}
            <OutcomeBadge outcome={data.session.outcome} />
          </h2>
        )}
      </div>
      <ErrorNote error={error} />
      {data && <Player data={data} />}
    </div>
  )
}

function Player({ data }) {
  const events = data.events
  const length = journeyLength(events)
  const steps = useMemo(() => journeySteps(events, data.names), [events, data.names])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [skip, setSkip] = useState(true)
  const timeRef = useRef(0)
  timeRef.current = time
  const frameData = useMemo(() => frameAt(events, time), [events, time])
  const vp = frameData.vp || data.viewport || { w: 1080, h: 1920 }

  // Playing: time moves on with the clock (faster with speed); long pauses
  // shortened when Skip long pauses is on.
  useEffect(() => {
    if (!playing) return undefined
    let raf = 0
    let last = performance.now()
    const tick = now => {
      const dt = (now - last) * speed
      last = now
      let t = timeRef.current + dt
      if (skip) {
        const next = events.find(e => e.t > timeRef.current)
        if (next && next.t - timeRef.current > LONG_PAUSE_MS && t < next.t - 600) t = Math.max(t, next.t - 600)
      }
      if (t >= length) { setTime(length); setPlaying(false); return }
      setTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, skip, events, length])

  const current = useMemo(() => {
    let i = -1
    for (let j = 0; j < steps.length; j++) if (steps[j].t <= time) i = j
    return i
  }, [steps, time])
  const seek = t => setTime(Math.max(0, Math.min(length, t)))
  const playPause = () => {
    if (!playing && time >= length) setTime(0)
    setPlaying(p => !p)
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
      <div className="space-y-3 min-w-0">
        {data.notes?.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm p-3 space-y-1" data-testid="ka-notes">
            {data.notes.map((n, i) => <p key={i} className="flex gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" />{n}</p>)}
          </div>
        )}
        {data.replay
          ? <KioskFrame url={data.replay.url} vp={vp} frame={frameData} />
          : <div className="rounded-xl border bg-background p-6 text-sm text-muted-foreground text-center" data-testid="ka-no-replay">The visit can't be played back on the kiosk: its steps are on the right.</div>}
        <div className="rounded-xl border bg-background p-3 space-y-3" data-testid="ka-controls">
          <div className="flex items-center gap-3">
            <span className="text-sm tabular-nums w-12" data-testid="ka-time">{clock(time)}</span>
            <input type="range" min={0} max={Math.max(1, length)} step="any" value={time} onChange={e => seek(Number(e.target.value))}
              className="flex-1 accent-[hsl(var(--primary))] h-11 touch-manipulation" aria-label="Time in the visit" data-testid="ka-scrub" />
            <span className="text-sm tabular-nums w-12 text-right text-muted-foreground">{clock(length)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => { setPlaying(false); seek(steps[Math.max(0, current - 1)]?.t ?? 0) }} title="Step before" data-testid="ka-prev"><SkipBack className="w-4 h-4" /></Btn>
            <Btn variant="primary" onClick={playPause} data-testid="ka-play" className="min-w-[110px]">
              {playing ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Play</>}
            </Btn>
            <Btn onClick={() => { setPlaying(false); seek(steps[Math.min(steps.length - 1, current + 1)]?.t ?? length) }} title="Next step" data-testid="ka-next"><SkipForward className="w-4 h-4" /></Btn>
            <Segmented value={String(speed)} options={SPEEDS.map(s => ({ value: String(s), label: s + 'x' }))} onChange={v => setSpeed(Number(v))} />
            <label className="inline-flex items-center gap-2 h-11 px-3 text-sm touch-manipulation cursor-pointer">
              <input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} className="w-5 h-5" data-testid="ka-skip" />
              Skip long pauses
            </label>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <Card title={'Steps (' + steps.length + ')'}>
          <StepList steps={steps} current={current} onPick={t => { setPlaying(false); seek(t) }} />
        </Card>
        <Card title="This visit">
          <dl className="divide-y text-sm" data-testid="ka-visit-summary">
            {[
              ['Ended', OUTCOME_LABELS[data.summary.outcome]],
              ['Length', dur(data.session.duration_ms)],
              data.summary.order ? ['Order', (data.session.order_no || '') + (data.summary.order.total != null ? ' · ' + money(data.summary.order.total) : '')] : null,
              !data.summary.order && data.summary.basket_value ? ['Left in the basket', money(data.summary.basket_value)] : null,
              ['Dishes added', data.summary.items_added],
              data.summary.first_add_ms != null ? ['First dish added after', dur(data.summary.first_add_ms)] : null,
              ['Touches', data.summary.taps + (data.summary.dead_taps ? ' (' + data.summary.dead_taps + ' on nothing that answers)' : '')],
              ['Language', (data.summary.langs || []).join(', ').toUpperCase() || '-'],
              data.session.truncated ? ['Recording', 'Very long visit: later touches not kept'] : null,
            ].filter(Boolean).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  )
}

function StepList({ steps, current, onPick }) {
  const list = useRef(null)
  useEffect(() => {
    const el = list.current?.querySelector('[data-current="1"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [current])
  return (
    <ol ref={list} className="max-h-[60vh] overflow-y-auto -mx-2" data-testid="ka-steps">
      {steps.map((s, i) => {
        const Icon = STEP_ICONS[s.kind] || (s.kind === 'end' ? Clock : s.dead ? AlertTriangle : null)
        return (
          <li key={i}>
            <button type="button" onClick={() => onPick(s.t)} data-current={i === current ? '1' : undefined} data-kind={s.kind} data-dead={s.dead ? '1' : undefined}
              className={cn('w-full text-left flex items-start gap-2 px-2 py-2 rounded-lg touch-manipulation min-h-[44px]',
                i === current ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/60')}>
              <span className="text-xs tabular-nums text-muted-foreground w-10 shrink-0 pt-0.5">{clock(s.t)}</span>
              <span className={cn('flex-1 text-sm', s.dead && 'text-red-700')}>
                {Icon && <Icon className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}
                {s.label}
              </span>
              {s.dwell >= 1000 && <span className={cn('text-xs tabular-nums shrink-0 pt-0.5', s.dwell >= 15000 ? 'text-amber-800 font-semibold' : 'text-muted-foreground')}>{dur(s.dwell)}</span>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The kiosk itself, at the size the visit's screen had, scaled to fit, with
 * the guest's touches drawn over it. The kiosk (in replay mode) is sent each
 * moment's view and scroll places when they change.
 */
function KioskFrame({ url, vp, frame }) {
  const box = useRef(null)
  const iframe = useRef(null)
  const [scale, setScale] = useState(0.3)
  const [ready, setReady] = useState(false)
  const [missing, setMissing] = useState([])
  const origin = useRef(null)
  const sent = useRef({ v: -1, scroll: '' })
  const expected = useMemo(() => { try { return new URL(url).origin } catch { return null } }, [url])

  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const fit = () => {
      const maxH = Math.max(320, window.innerHeight - 300)
      setScale(Math.max(0.1, Math.min(1, (el.clientWidth - 8) / vp.w, maxH / vp.h)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    window.addEventListener('resize', fit)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [vp.w, vp.h])

  useEffect(() => {
    const onMessage = e => {
      if (!iframe.current || e.source !== iframe.current.contentWindow) return
      if (expected && e.origin !== expected) return
      if (e.data?.type === 'kiosk.ready') {
        origin.current = e.origin
        sent.current = { v: -1, scroll: '' }
        setReady(!e.data.error)
      }
      if (e.data?.type === 'kiosk.replayed') setMissing(e.data.missing || [])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [expected])

  // Only what changed goes to the kiosk.
  useEffect(() => {
    if (!ready || !origin.current) return
    const scroll = JSON.stringify(frame.scroll)
    const box = frame.vp?.b ? frame.vp.b.join() : ''
    if (sent.current.v === frame.v && sent.current.scroll === scroll && sent.current.box === box) return
    sent.current = { v: frame.v, scroll, box }
    // The kiosk's box as recorded (bars on a screen of another shape), so it sits where the guest saw it.
    iframe.current?.contentWindow?.postMessage({ type: 'kiosk.replay', view: frame.view, scroll: frame.scroll, box: frame.vp?.b || null }, origin.current)
  }, [ready, frame])

  return (
    <div ref={box} className="flex flex-col items-center gap-2" data-testid="ka-frame-box">
      <div className="relative shrink-0 rounded-2xl overflow-hidden bg-black ring-[6px] ring-neutral-700 shadow-xl" style={{ width: vp.w * scale, height: vp.h * scale }}>
        <iframe ref={iframe} src={url} title="The kiosk, playing the visit back" data-testid="ka-frame"
          className="absolute left-0 top-0 border-0 pointer-events-none" style={{ width: vp.w, height: vp.h, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
        <svg className="absolute inset-0 pointer-events-none" width={vp.w * scale} height={vp.h * scale} data-testid="ka-touches">
          {frame.taps.map((t, i) => {
            const a = 1 - t.age / 900
            const r = 14 + (t.age / 900) * 22
            const dead = t.hit === 0 || t.hit === 2
            if (t.k === 'swipe') {
              return <line key={i} x1={t.x * scale} y1={t.y * scale} x2={t.x2 * scale} y2={t.y2 * scale} stroke="#2563eb" strokeWidth={6} strokeLinecap="round" opacity={a} />
            }
            return (
              <g key={i} opacity={a} data-touch={dead ? 'dead' : 'hit'}>
                <circle cx={t.x * scale} cy={t.y * scale} r={r * Math.max(0.5, scale * 2)} fill={dead ? 'rgba(220,38,38,.25)' : 'rgba(37,99,235,.25)'} stroke={dead ? '#dc2626' : '#2563eb'} strokeWidth={3} />
                <circle cx={t.x * scale} cy={t.y * scale} r={5} fill={dead ? '#dc2626' : '#2563eb'} />
              </g>
            )
          })}
        </svg>
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
            <Loader2 className="animate-spin" size={28} />
          </div>
        )}
      </div>
      {missing.length > 0 && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1" data-testid="ka-missing">
          {missing.length === 1 ? 'A dish in this moment is no longer on the menu' : missing.length + ' dishes in this moment are no longer on the menu'}: they don't show.
        </div>
      )}
    </div>
  )
}

// ── The page ─────────────────────────────────────────────────────

export default function KioskAnalytics() {
  const api = useApi()
  const { venues, venueId, setVenueId, isLoading } = usePosVenue()
  const [params, setParams] = useSearchParams()
  const visit = params.get('visit')
  const tab = params.get('tab') === 'visits' ? 'visits' : 'overview'
  const today = new Date()
  const [range, setRange] = useState('7')
  const [from, setFrom] = useState(isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)))
  const [to, setTo] = useState(isoDate(today))
  const [deviceId, setDeviceId] = useState('')
  const [designId, setDesignId] = useState('')
  const pickRange = v => {
    setRange(v)
    const d = new Date()
    setTo(isoDate(d))
    setFrom(isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (Number(v) - 1))))
  }
  const query = 'from=' + from + '&to=' + to + (deviceId ? '&device_id=' + deviceId : '') + (designId ? '&design_id=' + designId : '')
  const { data, isLoading: loading, error } = useQuery({
    queryKey: ['kiosk-analytics', venueId, query],
    queryFn: () => api.get(`/pos/kiosk-analytics/venues/${venueId}?${query}`),
    enabled: !!venueId && !visit,
  })
  const setTab = t => setParams(p => { const n = new URLSearchParams(p); n.delete('visit'); if (t === 'visits') n.set('tab', 'visits'); else n.delete('tab'); return n })
  const open = id => setParams(p => { const n = new URLSearchParams(p); n.set('visit', id); n.set('tab', 'visits'); return n })
  const close = () => setParams(p => { const n = new URLSearchParams(p); n.delete('visit'); return n })
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Activity} title="Kiosk analytics">
        <VenueSelect venues={venues} venueId={venueId} onChange={setVenueId} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 space-y-4">
          {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />}
          {!isLoading && !venues.length && <p className="text-sm text-muted-foreground">Add a venue first.</p>}
          {visit && <VisitPlayer key={visit} id={visit} onBack={close} />}
          {venueId && !visit && (
            <>
              <div className="flex flex-wrap items-center gap-2" data-testid="ka-filters">
                <Segmented value={tab} options={[{ value: 'overview', label: 'Overview' }, { value: 'visits', label: 'Visits' }]} onChange={setTab} />
                <Segmented value={range} options={RANGES} onChange={pickRange} />
                <DateBox label="From" value={from} onChange={v => { setRange(''); setFrom(v); if (v > to) setTo(v) }} />
                <DateBox label="To" value={to} onChange={v => { setRange(''); setTo(v); if (v < from) setFrom(v) }} />
                {(data?.devices?.length || 0) > 1 && (
                  <select value={deviceId} onChange={e => setDeviceId(e.target.value)} className={selectCls} aria-label="Kiosk" data-testid="ka-device-filter">
                    <option value="">Every kiosk</option>
                    {data.devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                )}
                {(data?.designs?.length || 0) > 1 && (
                  <select value={designId} onChange={e => setDesignId(e.target.value)} className={selectCls} aria-label="Design" data-testid="ka-design-filter">
                    <option value="">Every design</option>
                    {data.designs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                )}
              </div>
              <ErrorNote error={error} />
              {tab === 'overview' && loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-10" />}
              {tab === 'overview' && data && <Overview data={data} />}
              {tab === 'visits' && <Visits venueId={venueId} query={query} onOpen={open} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
