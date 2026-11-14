// src/pages/OpsToday.jsx
//
// Today (/today): the chat-first front door (docs/CHAT_FIRST.md). A greeting,
// the day at a glance, what needs doing grouped Late / Now / Next / Later
// (GET /api/ops/today, worked out from data and rules, so it all works with
// Pepper switched off), each task with one action: a form opened right here
// (the same shared panels the Food safety and Checklists pages use, saving
// through the same routes) or the page it belongs to. The modules as tiles,
// the ones with something to do first, and Pepper beside it all. Below the
// greeting, the week ahead from Local info (WeekAhead): the forecast for each
// day and the local news, for people who can see Local info.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as LucideIcons from 'lucide-react'
import {
  Sun, Sunrise, Moon, RefreshCw, Thermometer, Flame, ListChecks, AlertTriangle, Truck, Send,
  Wallet, ShoppingBag, ClipboardList, CheckCircle2, ExternalLink, X, ChevronRight, CalendarDays,
  Users, Plus, Sparkles, Loader2, Info, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow,
  CloudLightning,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePepperPage } from '@/lib/pepperPage'
import ChatView, { useAiStatus } from '@/components/ai/ChatView'
import { useRememberedConversation } from '@/components/ai/AssistantDrawer'
import { TempChecksTable, HoldChecksTable, CookingChecksPanel } from '@/components/foodSafety/shared'
import { ChecklistRunPanel } from '@/components/checklists/shared'
import { DayView, StatusBadge, SaveIndicator } from '@/pages/CashRecon'
import { WeekWagesEditor } from '@/components/cashRecon/WagesTable'
import { usePermission } from '@/hooks/usePermission'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { addDays } from '@shared/localInfo.js'
import { KIND_ICONS, SEV_CHIP } from '@/components/localInfo/shared'

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
  orders_to_approve: ClipboardList, cash_up: Wallet, wages_to_pay: Users, online_orders: ShoppingBag,
}

// The full page behind each form (F8).
const FORMS = {
  temps:     { title: 'Fridge and freezer checks', path: '/food-safety' },
  holds:     { title: 'Hot and cold hold checks',  path: '/food-safety' },
  cooking:   { title: 'Cooking checks',            path: '/food-safety' },
  checklist: { title: 'Checklist',                 path: '/checklists' },
  cash_up:   { title: 'Cash-up',                   path: '/cash-recon' },
  wages:     { title: 'Wages',                     path: '/cash-recon', phone: '/mobile/wages' },
}

// Which menu pages an area's tasks belong to: tiles with something to do go first.
const AREA_ROUTES = {
  food_safety: ['/food-safety', '/hs-dashboard'], checklists: ['/checklists'], hs_actions: ['/hs-action-log'],
  purchasing: ['/purchasing'], cash: ['/cash-recon'], wages: ['/cash-recon'], online_orders: ['/orders'],
}

const AREA_NAMES = {
  food_safety: 'food safety', checklists: 'checklists', hs_actions: 'the H&S action log',
  purchasing: 'purchasing', cash: 'cash reconciliation', wages: 'wages', online_orders: 'online orders',
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

export default function OpsToday() {
  const api = useApi()
  const qc = useQueryClient()
  const [venueId, setVenueId] = useState(readVenue)
  const [form, setForm] = useState(null)
  const [showAllTiles, setShowAllTiles] = useState(false)

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
  const canPepper = (me?.permissions?.ai_assistant || 'none') !== 'none'

  return (
    <div className="h-full flex flex-col overflow-hidden bg-page">
      <div className="bg-background border-b h-14 shrink-0 flex items-center gap-3 px-4 sm:px-6 max-lg:notouch:pl-14">
        <Sun className="w-5 h-5 text-primary shrink-0" />
        <h1 className="font-semibold text-lg truncate">Today</h1>
        <div className="ml-auto flex items-center gap-2 min-w-0">
          {d?.venues?.length > 1 && (
            <select value={d.venue.id} onChange={e => pickVenue(e.target.value)} data-testid="today-venue"
              className="h-10 min-w-0 max-w-[14rem] rounded-md border bg-background px-2 text-sm touch-manipulation">
              {d.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => feed.refetch()} aria-label="Refresh" data-testid="today-refresh"
            className="w-11 h-11 shrink-0 rounded-md border flex items-center justify-center hover:bg-accent touch-manipulation">
            <RefreshCw className={cn('w-4 h-4', feed.isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
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

            {d && <WeekAhead d={d} canSetUp={me?.permissions?.local_info === 'manage'} />}

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

            {me && <ModuleTiles me={me} tasks={d?.tasks || []} all={showAllTiles} onAll={() => setShowAllTiles(v => !v)} />}

            {canPepper && (
              <div className="lg:hidden rounded-lg border bg-background overflow-hidden h-[70vh] flex flex-col" data-testid="today-pepper-inline">
                <PepperPanel tasks={d?.tasks || []} />
              </div>
            )}
          </div>
        </div>

        {canPepper && (
          <aside className="hidden lg:flex w-[400px] shrink-0 border-l bg-background flex-col min-h-0" data-testid="today-pepper">
            <PepperPanel tasks={d?.tasks || []} />
          </aside>
        )}
      </div>

      {form && d && <FormSheet form={form} venueId={d.venue.id} date={d.date} onClose={closeForm} />}
    </div>
  )
}

/** A page link; linkFor (the phone app) may send it to another path or host. */
function Go({ to, linkFor, ...rest }) {
  const dest = linkFor ? linkFor(to) : { to }
  return dest.href ? <a href={dest.href} {...rest} /> : <Link to={dest.to} {...rest} />
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
        const cls = cn('inline-flex items-center gap-1.5 rounded-full border px-3 min-h-[36px] text-sm touch-manipulation',
          c.tone === 'amber' ? 'bg-amber-50 border-amber-300 text-amber-900' : c.tone === 'sky' ? 'bg-sky-50 border-sky-300 text-sky-900' : 'bg-muted/50')
        const inner = <><c.Icon className="w-4 h-4 shrink-0" /><span>{c.text}</span></>
        return c.to ? <Go key={c.key} to={c.to} linkFor={linkFor} className={cn(cls, 'hover:bg-accent')}>{inner}</Go> : <span key={c.key} className={cls}>{inner}</span>
      })}
    </div>
  )
}

// Open-Meteo's WMO weather codes as a picture.
function WeatherIcon({ code, className }) {
  const c = Number(code)
  const Icon = c === 0 ? Sun : c <= 2 ? CloudSun : c === 3 ? Cloud : c <= 48 ? CloudFog
    : c <= 57 ? CloudDrizzle : (c <= 67 || (c >= 80 && c <= 82)) ? CloudRain
    : (c <= 77 || c === 85 || c === 86) ? CloudSnow : c >= 95 ? CloudLightning : Cloud
  return <Icon className={className} aria-hidden="true" />
}

const WEATHER_CELL = {
  warning: 'bg-red-50 border-red-300',
  notice:  'bg-amber-50 border-amber-300',
  info:    'bg-background',
}

/**
 * The week ahead (summary.local, weekAhead() in shared/localInfo.js): the
 * forecast for each day and the local news, from Local info. Hidden when the
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

/** The sheet's title: the task's own for a checklist, the day or week for Cash Recon. */
function formTitle(form, meta) {
  if (form.form === 'checklist') return form.task.title
  if (form.form === 'cash_up') return 'Cash-up for ' + format(parseISO(form.ref.date), 'EEEE d MMMM')
  if (form.form === 'wages') return 'Wages for the week of ' + format(parseISO(form.ref.week), 'd MMMM')
  return meta.title
}

/** F1-F9: the form for a task, the same panel its page uses, saving through the same routes. */
export function FormSheet({ form, venueId, date, onClose, linkFor }) {
  const qc = useQueryClient()
  const { canManage: cashManage } = usePermission('cash_recon')
  const meta = FORMS[form.form] || { title: form.task.title, path: '/' }
  const title = formTitle(form, meta)
  // The full page: on the phone a form may have a phone page of its own.
  const page = linkFor && meta.phone ? { to: meta.phone, linkFor: null } : { to: meta.path, linkFor }
  // A cash-up's state from DayView (status, saving, Submit): shown in the foot.
  const [day, setDay] = useState(null)
  const submitted = !!day?.isSubmitted
  useEffect(() => { if (submitted) qc.invalidateQueries({ queryKey: ['ops-today'] }) }, [submitted, qc])
  const cashUp = form.form === 'cash_up' && day?.ready
  // The wages editor saves only on Save: closing with changes waiting asks
  // first, so Done never throws a payment away without a word.
  const [wages, setWages] = useState(null)
  const unsaved = form.form === 'wages' && !!wages?.dirty
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (!unsaved) setAsking(false) }, [unsaved])
  const close = () => (unsaved ? setAsking(true) : onClose())
  const saveAndClose = async () => { if (await wages.save()) onClose() }
  const footBtn = 'min-h-[48px] px-5 rounded-md font-medium touch-manipulation disabled:opacity-50'
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={close} data-testid="today-form" data-form={form.form}>
      <div className="bg-background w-full sm:max-w-4xl max-h-[85vh] overflow-y-auto rounded-t-xl sm:rounded-xl shadow-xl"
        onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sticky top-0 z-10 bg-background border-b px-4 h-14 flex items-center gap-2">
          <h2 className="font-semibold truncate" data-testid="today-form-title">{title}</h2>
          <Go to={page.to} linkFor={page.linkFor} className="ml-auto shrink-0 inline-flex items-center gap-1 text-sm text-primary min-h-[48px] px-2 touch-manipulation" data-testid="today-form-page">
            Open the full page <ExternalLink className="w-3.5 h-3.5" />
          </Go>
          <button type="button" onClick={close} aria-label="Close" data-testid="today-form-close"
            className="w-12 h-12 rounded-md flex items-center justify-center hover:bg-accent touch-manipulation">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-3 sm:p-4">
          {form.form === 'temps' && <TempChecksTable venueId={venueId} date={date} />}
          {form.form === 'holds' && <HoldChecksTable venueId={venueId} date={date} />}
          {form.form === 'cooking' && <CookingChecksPanel venueId={venueId} date={date} />}
          {form.form === 'checklist' && <ChecklistRunPanel template={form.ref.template} date={date} />}
          {form.form === 'cash_up' && <DayView venueId={venueId} date={form.ref.date} hideHeader onStateChange={setDay} />}
          {form.form === 'wages' && (
            <WeekWagesEditor venueId={venueId} weekStart={form.ref.week} readOnly={!cashManage}
              showBank={!linkFor} hidePaidOnForAll={!!linkFor} onStateChange={setWages} />
          )}
        </div>
        <div className="sticky bottom-0 bg-background border-t px-4 py-3 flex flex-wrap items-center justify-end gap-2">
          {asking ? (
            <>
              <p className="mr-auto text-sm font-medium" data-testid="today-unsaved">The changes to the wages aren't saved.</p>
              <button type="button" onClick={() => setAsking(false)} data-testid="today-unsaved-stay"
                className={cn(footBtn, 'border hover:bg-accent')}>Keep editing</button>
              <button type="button" onClick={onClose} data-testid="today-unsaved-discard"
                className={cn(footBtn, 'border text-destructive hover:bg-destructive/10')}>Close without saving</button>
              <button type="button" onClick={saveAndClose} disabled={wages?.saving} data-testid="today-unsaved-save"
                className={cn(footBtn, 'bg-primary text-primary-foreground')}>
                {wages?.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save and close'}
              </button>
            </>
          ) : (
            <>
              {cashUp && (
                <div className="mr-auto flex items-center gap-2 min-w-0" data-testid="today-cash-state" data-status={day.status}>
                  <StatusBadge status={day.status} />
                  <SaveIndicator saving={day.saving} saved={day.saved} error={day.saveErr} />
                </div>
              )}
              {cashUp && !day.isSubmitted && day.canSubmit && (
                <button type="button" onClick={day.submit} disabled={day.submitPending} data-testid="today-cash-submit"
                  className={cn(footBtn, 'bg-green-600 text-white hover:bg-green-700')}>
                  {day.submitPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
                </button>
              )}
              {cashUp && day.isSubmitted && day.canUnsubmit && (
                <button type="button" onClick={day.unsubmit} disabled={day.submitPending} data-testid="today-cash-unsubmit"
                  className={cn(footBtn, 'border hover:bg-accent')}>
                  {day.submitPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unsubmit'}
                </button>
              )}
              <button type="button" onClick={close} data-testid="today-form-done"
                className="min-h-[48px] px-6 rounded-md bg-primary text-primary-foreground font-medium touch-manipulation">Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** H5 + N2: the person's own menu as tiles, the ones with something to do first. */
function ModuleTiles({ me, tasks, all, onAll }) {
  const tiles = useMemo(() => {
    const links = []
    const walk = nodes => { for (const n of nodes || []) { if (n.kind === 'link' && n.route && n.route !== '/today') links.push(n); walk(n.children) } }
    walk(me.nav_tree)
    const seen = new Set()
    const unique = links.filter(l => !seen.has(l.route) && seen.add(l.route))
    const busy = new Map()
    for (const t of tasks) for (const r of AREA_ROUTES[t.area] || []) busy.set(r, (busy.get(r) || 0) + 1)
    return unique.map((l, i) => ({ ...l, count: busy.get(l.route) || 0, i }))
      .sort((a, b) => (b.count ? 1 : 0) - (a.count ? 1 : 0) || a.i - b.i)
  }, [me, tasks])
  if (!tiles.length) return null
  const shown = all ? tiles : tiles.slice(0, 8)
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="today-modules">
      <div className="section-head px-4 py-2.5 flex items-center">
        <h2 className="font-semibold">Go to</h2>
        {tiles.length > 8 && (
          <button type="button" onClick={onAll} className="ml-auto text-sm underline min-h-[36px] px-2 touch-manipulation" data-testid="today-modules-all">
            {all ? 'Fewer' : 'Everything (' + tiles.length + ')'}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        {shown.map(t => {
          const Icon = LucideIcons[t.icon] || LucideIcons.Circle
          return (
            <Link key={t.route} to={t.route} data-testid="today-tile"
              className="relative flex flex-col items-center justify-center gap-1.5 rounded-lg border min-h-[84px] p-2 text-center hover:bg-accent touch-manipulation">
              <Icon className="w-6 h-6 text-primary" />
              <span className="text-sm leading-tight">{t.label}</span>
              {t.count > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-amber-500 text-white text-xs font-semibold flex items-center justify-center">{t.count}</span>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/** H4 + H6: Pepper, with suggestions for what is on today. */
function PepperPanel({ tasks }) {
  const [conversationId, setConversationId] = useRememberedConversation()
  const status = useAiStatus()
  const suggestions = useMemo(() => {
    const areas = new Set(tasks.map(t => t.area))
    return [
      'Brief me on today',
      areas.has('food_safety') || areas.has('checklists') ? 'Which H&S checks are still to do today?' : null,
      areas.has('purchasing') ? 'Which supplier orders still need sending?' : null,
      'What is booked for tonight?',
      'Who is working today?',
      'What can you do?',
    ].filter(Boolean).slice(0, 5)
  }, [tasks])
  return (
    <>
      <div className="section-head px-4 h-12 shrink-0 flex items-center gap-2">
        <Sparkles className="w-4 h-4" />
        <h2 className="font-semibold">{ASSISTANT_NAME}</h2>
        {conversationId && (
          <button type="button" onClick={() => setConversationId(null)} data-testid="today-new-chat"
            className="ml-auto inline-flex items-center gap-1 text-sm min-h-[40px] px-2 rounded-md hover:bg-black/5 touch-manipulation">
            <Plus className="w-4 h-4" /> New chat
          </button>
        )}
      </div>
      {status.data && !status.data.can_chat ? (
        <div className="p-4 text-sm text-muted-foreground" data-testid="today-pepper-off">
          {ASSISTANT_NAME} isn't available for you right now{status.data.configured === false ? ' (not set up for the platform yet)' : status.data.enabled === false ? ' (switched off for your group)' : ''}.
          Everything on the left works without it.
        </div>
      ) : (
        <ChatView key={conversationId || 'new'} conversationId={conversationId} onConversationId={setConversationId}
          className="flex-1 min-h-0" pageAware suggestions={suggestions} />
      )}
    </>
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
