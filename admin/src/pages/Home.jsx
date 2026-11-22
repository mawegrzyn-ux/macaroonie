// src/pages/Home.jsx
//
// Home (/): where the day starts, for every group and role (Pepper-first
// step 2b, reports/AI first back office strategy.md "Home: the day comes to
// the person", decision 2). From the top: the ask bar (step 2c,
// components/layout/AskBar.jsx: pages and saved reports found as you type with
// no model call, Enter hands the words to Pepper; asks to tap for the day
// under it), the person's pins (components/home/Pins.jsx), the day at a glance, what needs doing at the
// venue grouped Late / Now / Next / Later (GET /api/ops/today, worked out from
// data and rules, so it all works with Pepper switched off), each task with
// one action: a form opened right here (the same shared panels the Food
// safety and Checklists pages use, saving through the same routes) or the page
// it belongs to; then the week ahead from Local info (WeekAhead): the forecast
// for each day and the local news, for people who can see Local info.
// It replaced the Today page (/today, which now sends here) and the
// Overview's place at / (the tiles are at /overview). A full-screen chat is
// never the landing page. Step 5 adds For review under the week.
//
// The parts are exported for the phone's Today (pages/mobile/MobileToday.jsx).

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Home as HomeIcon, Sun, Sunrise, Moon, RefreshCw, Thermometer, Flame, ListChecks, AlertTriangle, Truck, Send,
  Wallet, ShoppingBag, ClipboardList, CheckCircle2, ExternalLink, ChevronRight, CalendarDays,
  Users, Loader2, Info, CloudSun, BarChart3, Pin,
} from 'lucide-react'
import { format } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePepperPage } from '@/lib/pepperPage'
import { FormSheet, Go } from '@/components/forms/FormSheet'
import PinStrip from '@/components/home/Pins'
import AskBar from '@/components/layout/AskBar'

export { FormSheet }
import { addDays } from '@shared/localInfo.js'
import { KIND_ICONS, SEV_CHIP } from '@/components/localInfo/shared'
import { WeatherIcon, HourStrip, HourLegend, hoursFrom } from '@/components/localInfo/weather'

export const VENUE_KEY = 'maca_today_venue'

const GROUPS = [
  { key: 'late',  label: 'Late',  dot: 'bg-red-500',   note: 'Past their time' },
  { key: 'now',   label: 'Now',   dot: 'bg-amber-500', note: 'Due now or some time today' },
  { key: 'next',  label: 'Next',  dot: 'bg-sky-500',   note: 'In the next two hours' },
  { key: 'later', label: 'Later', dot: 'bg-slate-400', note: 'Later today, this week or month' },
]

const KIND_ICON = {
  fridge_check: Thermometer, hold_check: Thermometer, cooking_check: Flame, corrective_action: AlertTriangle,
  checklist: ListChecks, hs_action: ClipboardList, po_to_send: Send, delivery_due: Truck, delivery_not_booked: Truck,
  orders_to_approve: ClipboardList, cash_up: Wallet, cash_week: Wallet, wages_to_pay: Users, online_orders: ShoppingBag,
  report_alert: BarChart3,
}


const AREA_NAMES = {
  food_safety: 'food safety', checklists: 'checklists', hs_actions: 'the H&S action log',
  purchasing: 'purchasing', cash: 'cash reconciliation', wages: 'wages', online_orders: 'online orders',
  report_alerts: 'report alerts',
}

export function readVenue() { try { return localStorage.getItem(VENUE_KEY) || '' } catch { return '' } }
export function keepVenue(id) { try { id ? localStorage.setItem(VENUE_KEY, id) : localStorage.removeItem(VENUE_KEY) } catch {} }

export function greeting(now) {
  const h = Number(String(now || '12:00').slice(0, 2))
  if (h < 12) return { text: 'Good morning', Icon: Sunrise }
  if (h < 18) return { text: 'Good afternoon', Icon: Sun }
  return { text: 'Good evening', Icon: Moon }
}

export function firstName(me) {
  const name = (me?.full_name || '').trim()
  if (name) return name.split(/\s+/)[0]
  const mail = (me?.email || '').split('@')[0]
  return mail ? mail.charAt(0).toUpperCase() + mail.slice(1) : ''
}

export default function Home() {
  const api = useApi()
  const qc = useQueryClient()
  const [venueId, setVenueId] = useState(readVenue)
  const [form, setForm] = useState(null)

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const feed = useQuery({
    queryKey: ['ops-today', venueId],
    queryFn: () => api.get('/ops/today' + (venueId ? '?venue_id=' + venueId : '')),
    refetchInterval: 60_000,
    retry: (n, err) => err?.status !== 404 && n < 2,
  })
  // A remembered venue that has gone (or another group's): start again from the first one.
  const gone = feed.error?.status === 404 && !!venueId
  useEffect(() => { if (gone) { keepVenue(''); setVenueId('') } }, [gone])
  const d = feed.data
  usePepperPage({ venueId: d?.venue?.id, date: d?.date })

  function pickVenue(id) { keepVenue(id); setVenueId(id) }
  function closeForm() {
    setForm(null)
    qc.invalidateQueries({ queryKey: ['ops-today'] })
  }

  const { text: hello, Icon: HelloIcon } = greeting(d?.now)
  const name = firstName(me)
  const suggestions = useMemo(() => dayAsks(d?.tasks || []), [d?.tasks])

  return (
    <div className="h-full flex flex-col overflow-hidden bg-page">
      <div className="bg-background border-b h-14 shrink-0 flex items-center gap-3 px-4 sm:px-6 max-lg:notouch:pl-14">
        <HomeIcon className="w-5 h-5 text-primary shrink-0" />
        <h1 className="font-semibold text-lg truncate">Home</h1>
        <div className="ml-auto flex items-center gap-2 min-w-0">
          {d?.venues?.length > 1 && (
            <select value={d.venue.id} onChange={e => pickVenue(e.target.value)} data-testid="today-venue" aria-label="Venue"
              className="h-12 min-w-0 max-w-[14rem] rounded-md border bg-background px-2 text-sm touch-manipulation">
              {d.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => feed.refetch()} aria-label="Refresh" data-testid="today-refresh"
            className="w-12 h-12 shrink-0 rounded-md border flex items-center justify-center hover:bg-accent touch-manipulation">
            <RefreshCw className={cn('w-4 h-4', feed.isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-testid="home">
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
          <AskBar inline suggestions={suggestions} />

          <section className="rounded-lg border bg-background overflow-hidden" data-testid="home-pins">
            <div className="section-head px-4 py-2.5 flex items-center gap-2">
              <Pin className="w-4 h-4 shrink-0" />
              <h2 className="font-semibold">Your pins</h2>
            </div>
            <PinStrip className="p-3" />
          </section>

          <div className="rounded-lg border bg-background p-4 sm:p-5" data-testid="today-greeting">
            <div className="flex items-start gap-3">
              <HelloIcon className="w-7 h-7 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-semibold leading-tight">{hello}{name ? ', ' + name : ''}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {d ? <>{d.day.replace(/,/g, '').replace(/ \d{4}$/, '')} · {d.now} · {d.venue.name}</> : 'Working out your day...'}
                </p>
              </div>
            </div>
            {d && <Glance d={d} />}
          </div>

          {feed.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading today's tasks
            </div>
          )}
          {feed.error && feed.error.status !== 404 && (
            <Note tone="red">Couldn't load today's tasks: {feed.error.message}</Note>
          )}
          {feed.error?.status === 404 && !venueId && (
            <Note tone="amber">{feed.error.message}. Add a venue first: <Link className="underline" to="/new-location">New venue</Link>.</Note>
          )}

          {d && <TaskBoard d={d} onForm={t => setForm({ ...t.action, task: t })} />}

          {d && <WeekAhead d={d} canSetUp={me?.permissions?.local_info === 'manage'} />}

          {/* Step 5 of the Pepper-first plan puts For review here: drafts and unanswered cards waiting. */}
        </div>
      </div>

      {form && d && <FormSheet form={form} venueId={d.venue.id} date={d.date} onClose={closeForm} />}
    </div>
  )
}

/** Asks to tap under the bar on Home, for what is on today (H6 of docs/CHAT_FIRST.md). */
export function dayAsks(tasks) {
  const areas = new Set(tasks.map(t => t.area))
  return [
    'Brief me on today',
    areas.has('food_safety') || areas.has('checklists') ? 'Which H&S checks are still to do today?' : null,
    areas.has('purchasing') ? 'Which supplier orders still need sending?' : null,
    'What is booked for tonight?',
    'Who is working today?',
  ].filter(Boolean).slice(0, 4)
}

/** H2: bookings, big parties, who's on, closed. */
export function Glance({ d, linkFor }) {
  const b = d.summary?.bookings
  const s = d.summary?.staff
  const chips = []
  if (d.closed) chips.push({ key: 'closed', Icon: Info, text: 'Closed today: no fridge, hold or cooking checks needed', tone: 'amber' })
  if (b) chips.push({ key: 'bookings', Icon: CalendarDays, text: b.count + (b.count === 1 ? ' booking' : ' bookings') + ' · ' + b.covers + ' covers', to: '/timeline' })
  for (const p of b?.big_parties || []) chips.push({ key: 'big' + p.time + p.guest, Icon: Users, text: 'Party of ' + p.party_size + ' at ' + p.time + (p.guest ? ' (' + p.guest + ')' : ''), tone: 'sky', to: '/bookings' })
  if (s) chips.push({ key: 'staff', Icon: Users, text: s.working + (s.working === 1 ? ' person' : ' people') + ' on the rota', to: '/rota' })
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-4" data-testid="today-glance">
      {chips.map(c => {
        const cls = cn('inline-flex items-center gap-1.5 rounded-full border px-3 min-h-[48px] text-sm touch-manipulation',
          c.tone === 'amber' ? 'bg-amber-50 border-amber-300 text-amber-900' : c.tone === 'sky' ? 'bg-sky-50 border-sky-300 text-sky-900' : 'bg-muted/50')
        const inner = <><c.Icon className="w-4 h-4 shrink-0" /><span>{c.text}</span></>
        return c.to ? <Go key={c.key} to={c.to} linkFor={linkFor} className={cn(cls, 'hover:bg-accent')}>{inner}</Go> : <span key={c.key} className={cls}>{inner}</span>
      })}
    </div>
  )
}

const WEATHER_CELL = {
  warning: 'bg-red-50 border-red-300',
  notice:  'bg-amber-50 border-amber-300',
  info:    'bg-background',
}

/**
 * The week ahead (summary.local, weekAhead() in shared/localInfo.js): the
 * forecast for each day, today's hours, and the local news, from Local info. Hidden when the
 * person can't see Local info; when nothing is held for the week, only people
 * who can set captures up see a line pointing at Local info.
 */
export function WeekAhead({ d, linkFor, canSetUp = false }) {
  const w = d.summary?.local
  if (!w) return null
  const empty = !w.weather.length && !w.headlines.length
  if (empty && !canSetUp) return null
  // Days in words from the feed's own day (the venue's), never the browser's.
  const tomorrow = addDays(d.date, 1)
  const named = (date, long) => format(new Date(date + 'T12:00:00'), long ? 'EEEE' : 'EEE')
  const dayLabel = (date, long = true) => {
    if (d.is_today && date === d.date) return 'Today'
    if (d.is_today && date === tomorrow && long) return 'Tomorrow'
    if (date >= w.from && date <= w.to) return named(date, long)
    return format(new Date(date + 'T12:00:00'), 'EEE d MMM')
  }
  // The rest of today hour by hour (from the hour before now), when today is the day shown.
  const todayHours = (d.is_today && w.weather.find(x => x.date === d.date)?.hours) || []
  // Each forecast day in its own column, so a day the forecast lacks shows as a gap.
  const column = date => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(w.from + 'T00:00:00Z')) / 86400000) + 1
  const when = h => !h.ends_on ? dayLabel(h.day)
    : h.starts_on < w.from ? 'Until ' + dayLabel(h.ends_on)
    : dayLabel(h.starts_on) + ' to ' + dayLabel(h.ends_on)
  const link = 'inline-flex items-center gap-1 min-h-[48px] min-w-[48px] touch-manipulation text-sm text-primary underline underline-offset-2'
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="today-week">
      <div className="section-head px-4 py-1 flex items-center gap-2">
        <CloudSun className="w-4 h-4 shrink-0" />
        <h2 className="font-semibold">This week</h2>
        <Go to="/local-info" linkFor={linkFor} className={cn(link, 'ml-auto justify-end')} data-testid="today-week-open">Local info</Go>
      </div>
      {empty ? (
        <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="today-week-empty">
          No weather or local news for this week yet. Set up captures in{' '}
          <Go to="/local-info" linkFor={linkFor} className="text-primary underline underline-offset-2">Local info</Go>{' '}
          to see the forecast and what&apos;s on nearby here.
        </p>
      ) : (
        <>
          {w.weather.length > 0 && (
            <div className="grid grid-cols-7 gap-1 sm:gap-2 p-2 sm:p-3" data-testid="today-weather">
              {w.weather.map(x => (
                <div key={x.date} title={x.details || x.title} data-testid="today-weather-day" data-date={x.date} data-severity={x.severity}
                  style={{ gridColumnStart: column(x.date) }}
                  className={cn('min-w-0 rounded-md border px-0.5 py-2 flex flex-col items-center gap-1 text-center', WEATHER_CELL[x.severity] || WEATHER_CELL.info)}>
                  <span className="text-xs font-medium leading-none truncate max-w-full">{dayLabel(x.date, false)}</span>
                  <WeatherIcon code={x.code} className="w-6 h-6 text-muted-foreground" />
                  <span className="text-sm font-semibold leading-none" data-testid="today-weather-max">{x.temp_max != null ? Math.round(x.temp_max) + '°' : '–'}</span>
                  <span className="text-xs text-muted-foreground leading-none">{x.temp_min != null ? Math.round(x.temp_min) + '°' : ''}</span>
                  {(x.precip_mm || 0) >= 1 && <span className="text-[11px] leading-none text-muted-foreground">{Math.round(x.precip_mm)} mm</span>}
                  <span className="sr-only">{dayLabel(x.date)}: {x.details || x.title}</span>
                </div>
              ))}
            </div>
          )}
          {todayHours.length > 0 && (
            <div className="border-t px-2 sm:px-3 py-2 space-y-1.5" data-testid="today-hours">
              <h3 className="text-xs font-semibold text-muted-foreground">Today by the hour</h3>
              <HourStrip hours={todayHours} from={hoursFrom(todayHours)} testId="today-hour-strip" />
              <HourLegend />
            </div>
          )}
          {w.headlines.length > 0 && (
            <ul className={cn('divide-y', w.weather.length > 0 && 'border-t')} data-testid="today-headlines">
              {w.headlines.map(h => {
                const Icon = KIND_ICONS[h.kind] || CalendarDays
                return (
                  <li key={h.id} className="flex items-center gap-3 pl-4 pr-2 py-1.5" data-testid="today-headline" data-kind={h.kind} data-severity={h.severity}>
                    <span className={cn('w-8 h-8 rounded-full border inline-flex items-center justify-center shrink-0', SEV_CHIP[h.severity] || SEV_CHIP.info)}>
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 py-1">
                      <p className="text-sm font-medium break-words" data-testid="today-headline-title">{h.title}</p>
                      <p className="text-xs text-muted-foreground" data-testid="today-headline-when">{[when(h), h.time_text, h.place].filter(Boolean).join(' · ')}</p>
                    </div>
                    {h.url && (
                      <a href={h.url} target="_blank" rel="noopener noreferrer" className={cn(link, 'shrink-0 justify-center px-2')} data-testid="today-headline-source">
                        Source <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {w.more > 0 && (
            <Go to="/local-info" linkFor={linkFor} data-testid="today-week-more"
              className="flex items-center justify-center gap-1 border-t min-h-[48px] text-sm text-primary hover:bg-accent touch-manipulation">
              {w.more} more in Local info <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Go>
          )}
        </>
      )}
    </section>
  )
}

/** H3 + S3: the tasks in their groups, each with one action. */
export function TaskBoard({ d, onForm, linkFor }) {
  const total = d.tasks.length
  const urgent = d.counts.late + d.counts.now
  return (
    <div className="space-y-4" data-testid="today-tasks">
      {!urgent && (
        <div className="rounded-lg border bg-background p-4 flex items-center gap-3" data-testid="today-all-done">
          <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
          <div>
            <p className="font-medium">{total ? 'Nothing late or due right now' : 'Nothing to do right now'}</p>
            <p className="text-sm text-muted-foreground">{total ? 'What comes up later today is below.' : 'New tasks show here as their time comes.'}</p>
          </div>
        </div>
      )}
      {GROUPS.filter(g => d.counts[g.key]).map(g => (
        <section key={g.key} className="rounded-lg border bg-background overflow-hidden" data-testid={'today-group-' + g.key}>
          <div className="section-head px-4 py-2.5 flex items-center gap-2">
            <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', g.dot)} />
            <h2 className="font-semibold">{g.label}</h2>
            <span className="text-sm opacity-80">{d.counts[g.key]}</span>
            <span className="ml-auto text-xs opacity-80 hidden sm:inline">{g.note}</span>
          </div>
          <ul className="divide-y">
            {d.tasks.filter(t => t.group === g.key).map(t => <TaskRow key={t.key} t={t} onForm={onForm} linkFor={linkFor} />)}
          </ul>
        </section>
      ))}
      {d.not_included?.length > 0 && (
        <p className="text-xs text-muted-foreground px-1" data-testid="today-not-included">
          Not shown, as your role can't see them: {d.not_included.map(a => AREA_NAMES[a] || a).join(', ')}.
        </p>
      )}
      {d.errors?.length > 0 && (
        <Note tone="amber">Couldn't load {d.errors.map(e => AREA_NAMES[e.area] || e.area).join(', ')} just now. The rest is up to date.</Note>
      )}
    </div>
  )
}

function TaskRow({ t, onForm, linkFor }) {
  const Icon = KIND_ICON[t.kind] || ClipboardList
  const label = t.can_act ? t.action.label : 'View'
  const btn = 'shrink-0 inline-flex items-center gap-1.5 min-h-[48px] px-4 rounded-md text-sm font-medium touch-manipulation ' +
    (t.can_act ? 'bg-primary text-primary-foreground hover:opacity-90' : 'border hover:bg-accent')
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="today-task" data-kind={t.kind} data-group={t.group}>
      <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0',
        t.kind === 'corrective_action' ? 'bg-red-100 text-red-700' : 'bg-muted text-foreground')}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-[10rem]">
        <p className="font-medium leading-snug">{t.title}</p>
        <p className="text-sm text-muted-foreground">
          {t.due && <span className="font-medium text-foreground">{t.due} · </span>}{t.detail}
        </p>
      </div>
      {t.action.form
        ? <button type="button" className={btn} onClick={() => onForm(t)} data-testid="today-task-action">{label}<ChevronRight className="w-4 h-4" /></button>
        : <Go to={t.action.path} linkFor={linkFor} className={btn} data-testid="today-task-action">{label}<ChevronRight className="w-4 h-4" /></Go>}
    </li>
  )
}

export function Note({ tone, children }) {
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm',
      tone === 'red' ? 'bg-red-50 border-red-300 text-red-900' : 'bg-amber-50 border-amber-300 text-amber-900')}>
      {children}
    </div>
  )
}
