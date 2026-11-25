// src/pages/mobile/MobileRota.jsx
//
// The rota on a phone (/mobile/rota, `rota` module): the same week as the
// office Rota page (GET /rota/venues/:id/weeks/:week), this week first,
// previous / next by the arrows or a swipe across the page. Three views:
//   By day     each day: who's on (shifts or hours, role), who's off and
//              why (sick, holiday, ...), people off the rota, the day's hours
//   By person  each person's week in one compact row, hours at the end
//   Me         one person's own week: the signed-in person's name when it
//              matches someone on the rota, otherwise the one picked here
//              (remembered on this phone; logins aren't linked to staff)
// With rota Manage, tapping a person's day opens a sheet to set each shift
// (or hourly period) on, off, sick or holiday. Save sends the whole week
// back through the office's PUT .../weeks/:week/entries (rule 13): every
// entry of the week, both modes, with only that person's day changed, and no
// removed_staff_ids (who is off this week stays as it is). Hours are summed
// for display only, as the grid does; pay is not shown here.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, startOfWeek, addWeeks } from 'date-fns'
import { ChevronLeft, ChevronRight, Loader2, Plus, UserRound } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { useVenues, useVenueChoice, Modal, Segmented, TimeSelect, ErrorNote, hhmm, toMin, rangeMinutes, offDayText } from '@/components/staff/shared'
import { useRotaWeek, useRotaPerms, useMe, StatusBadge, periodProblem } from '@/components/staff/rota'
import { STATUS_BY_KEY, statusOf, visibleRotaDates } from '@/components/staff/rotaExport'

const ME_KEY = 'maca_rota_me'
const VIEW_KEY = 'maca_rota_view'
// What a tap can set on the phone; time off the office grid set another way
// (unpaid, absent) shows as it is and can be changed to one of these.
const CHOICES = [
  { value: 'off',  label: 'Off' },
  { value: 'on',   label: 'On' },
  { value: 'sick', label: 'Sick' },
  { value: 'pto',  label: 'Holiday' },
]
const CELL = {
  on:   'bg-green-600 text-white',
  sick: 'bg-red-600 text-white',
  pto:  'bg-sky-600 text-white',
  uto:  'bg-violet-600 text-white',
  abs:  'bg-amber-500 text-white',
}

const mondayOf = d => format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
const todayStr = () => format(new Date(), 'yyyy-MM-dd')
const keep = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const read = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }

// ── Week helpers (display only; pay and points stay on the server) ────────

function entryMinutes(e, shiftById) {
  if (e.shift_id) { const s = shiftById[e.shift_id]; return s ? rangeMinutes(s.start_time, s.end_time) : 0 }
  return rangeMinutes(e.start_time, e.end_time)
}
const workedMinutes = (list, shiftById) => list.reduce((t, e) => t + (statusOf(e) === 'on' ? entryMinutes(e, shiftById) : 0), 0)
function hoursText(min) {
  if (!min) return '0h'
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
function entryTimes(e, shiftById) {
  if (e.shift_id) {
    const s = shiftById[e.shift_id]
    return s ? `${s.name} ${hhmm(s.start_time)}–${hhmm(s.end_time)}` : 'Shift'
  }
  return `${hhmm(e.start_time)}–${hhmm(e.end_time)}`
}
const decimalHours = min => String(Math.round(min / 6) / 10)
const startOf = (e, shiftById) => toMin(e.shift_id ? shiftById[e.shift_id]?.start_time : e.start_time)
// The strongest status of a day: working wins, then whatever time off it holds.
function dayStatus(list) {
  if (!list.length) return null
  if (list.some(e => statusOf(e) === 'on')) return 'on'
  return statusOf(list[0])
}
function clean(e) {
  const status = statusOf(e)
  return e.shift_id
    ? { staff_id: e.staff_id, work_date: e.work_date, shift_id: e.shift_id, status }
    : { staff_id: e.staff_id, work_date: e.work_date, start_time: hhmm(e.start_time), end_time: hhmm(e.end_time), status }
}

export default function MobileRota() {
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [view, setViewRaw] = useState(() => read(VIEW_KEY) || 'day')
  const setView = v => { setViewRaw(v); keep(VIEW_KEY, v) }
  const { data: week, isLoading, error } = useRotaWeek(venueId, weekStart)
  const { canEditRota } = useRotaPerms()
  const { data: me } = useMe()
  const [editing, setEditing] = useState(null) // { staff, date }
  const thisWeek = mondayOf(new Date())
  const move = n => setWeekStart(w => format(addWeeks(parseISO(w), n), 'yyyy-MM-dd'))

  // Swipe left / right across the page: next / previous week.
  const touch = useRef(null)
  const onTouchStart = e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY } }
  const onTouchEnd = e => {
    const s = touch.current; touch.current = null
    if (!s || editing) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) move(dx < 0 ? 1 : -1)
  }

  const shiftById = useMemo(() => Object.fromEntries((week?.shifts ?? []).map(s => [s.id, s])), [week])
  const staff = useMemo(() => [...(week?.staff ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)), [week])
  const dates = week ? visibleRotaDates({ week, entries: week.entries, hideClosed: !!week.settings?.hide_closed_on_rota }) : []
  const entriesOf = (staffId, date) => (week?.entries ?? []).filter(e => e.staff_id === staffId && e.work_date === date)
    .sort((a, b) => startOf(a, shiftById) - startOf(b, shiftById))

  return (
    <div className="p-3 pb-10 space-y-3" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} data-testid="mrota">
      {venues.length > 1 && (
        <select value={venueId} onChange={e => setVenueId(e.target.value)} aria-label="Restaurant" data-testid="mrota-venue"
          className="w-full border rounded-lg px-3 min-h-[48px] text-sm bg-background touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => move(-1)} aria-label="Previous week" data-testid="mrota-prev"
          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg border bg-background touch-manipulation">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-semibold" data-testid="mrota-week">Week of {format(parseISO(weekStart), 'd MMM yyyy')}</p>
          {weekStart !== thisWeek
            ? <button type="button" onClick={() => setWeekStart(thisWeek)} className="text-xs text-primary underline underline-offset-2 min-h-[28px] touch-manipulation">Back to this week</button>
            : <p className="text-xs text-muted-foreground">This week</p>}
        </div>
        <button type="button" onClick={() => move(1)} aria-label="Next week" data-testid="mrota-next"
          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg border bg-background touch-manipulation">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <Segmented value={view} onChange={setView} className="w-full grid grid-cols-3" testid="mrota-view"
        options={[{ value: 'day', label: 'By day' }, { value: 'person', label: 'By person' }, { value: 'me', label: 'Me' }]} />

      {!canEditRota && week && <ReadOnlyNotice what="the rota" />}
      {error && <ErrorNote error={error} />}
      {(isLoading || (!week && !error && venueId)) && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}

      {week && view === 'day' && (
        <ByDay week={week} dates={dates} staff={staff} shiftById={shiftById} entriesOf={entriesOf}
          canEdit={canEditRota} onEdit={(s, d) => setEditing({ staff: s, date: d })} />
      )}
      {week && view === 'person' && (
        <ByPerson week={week} dates={dates} staff={staff} shiftById={shiftById} entriesOf={entriesOf}
          canEdit={canEditRota} onEdit={(s, d) => setEditing({ staff: s, date: d })} />
      )}
      {week && view === 'me' && (
        <MyWeek key={venueId} week={week} dates={dates} staff={staff} shiftById={shiftById} entriesOf={entriesOf} me={me}
          venueId={venueId} canEdit={canEditRota} onEdit={(s, d) => setEditing({ staff: s, date: d })} />
      )}

      {editing && week && (
        <DaySheet venueId={venueId} weekStart={weekStart} week={week} person={editing.staff} date={editing.date}
          shiftById={shiftById} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

// ── By day ───────────────────────────────────────────────────

function ByDay({ week, dates, staff, shiftById, entriesOf, canEdit, onEdit }) {
  const today = todayStr()
  const todayRef = useRef(null)
  const scrolledFor = useRef(null)
  useEffect(() => {
    if (scrolledFor.current === week.week_start) return
    scrolledFor.current = week.week_start
    if (todayRef.current) todayRef.current.scrollIntoView({ block: 'start' })
  }, [week.week_start])

  const jump = d => document.querySelector(`[data-testid="mrota-day"][data-date="${d}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  return (
    <div className="space-y-3">
      {/* The week's days, held at the top while the list scrolls: a tap jumps to the day. */}
      <div className="sticky top-0 z-10 -mx-3 px-3 py-1.5 bg-page grid gap-1" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }} data-testid="mrota-strip">
        {dates.map(d => {
          const on = staff.filter(s => entriesOf(s.id, d).some(e => statusOf(e) === 'on')).length
          return (
            <button key={d} type="button" onClick={() => jump(d)} aria-label={`${format(parseISO(d), 'EEEE')}: ${on} on`}
              className={cn('min-h-[48px] rounded-lg border text-center leading-tight touch-manipulation',
                d === today ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
              <span className="block text-[11px]">{format(parseISO(d), 'EEE')}</span>
              <span className="block text-sm font-semibold tabular-nums">{on}</span>
            </button>
          )
        })}
      </div>
      {dates.map(d => {
        const rows = staff.map(s => ({ s, list: entriesOf(s.id, d), off: s.off_days?.[d] ?? null }))
        const working = rows.filter(r => r.list.some(e => statusOf(e) === 'on'))
          .sort((a, b) => startOf(a.list[0], shiftById) - startOf(b.list[0], shiftById))
        const timeOff = rows.filter(r => r.list.length && !r.list.some(e => statusOf(e) === 'on'))
        const away = rows.filter(r => r.off && !r.list.length)
        const free = rows.filter(r => !r.off && !r.list.length)
        const minutes = working.reduce((t, r) => t + workedMinutes(r.list, shiftById), 0)
        const isToday = d === today
        return (
          <section key={d} ref={isToday ? todayRef : undefined} data-testid="mrota-day" data-date={d}
            className={cn('border rounded-xl bg-background overflow-hidden scroll-mt-[68px]', isToday && 'ring-2 ring-primary/50')}>
            <div className="section-head px-3 py-2 flex items-center gap-2">
              <h2 className="flex-1 min-w-0 text-sm font-semibold truncate">
                {format(parseISO(d), 'EEEE d MMM')}{isToday && <span className="ml-1.5 text-[11px] font-medium">· Today</span>}
              </h2>
              <span className="text-xs tabular-nums shrink-0" data-testid="mrota-day-total">{working.length} on · {hoursText(minutes)}</span>
            </div>
            {!working.length && !timeOff.length && !away.length && (
              <p className="px-3 py-3 text-sm text-muted-foreground">Nobody on the rota.</p>
            )}
            <ul className="divide-y">
              {[...working, ...timeOff].map(({ s, list }) => (
                <PersonDayRow key={s.id} s={s} list={list} shiftById={shiftById} canEdit={canEdit} onTap={() => onEdit(s, d)} />
              ))}
              {away.map(({ s, off }) => (
                <li key={s.id} className="flex items-center gap-2 px-3 min-h-[48px] text-sm bg-muted/30" data-testid="mrota-away">
                  <span className="flex-1 min-w-0 truncate text-muted-foreground">{s.name}</span>
                  <span className="text-[11px] text-muted-foreground text-right">{offDayText(off)}</span>
                </li>
              ))}
            </ul>
            {canEdit && free.length > 0 && <AddPerson people={free.map(r => r.s)} onPick={s => onEdit(s, d)} />}
          </section>
        )
      })}
    </div>
  )
}

function PersonDayRow({ s, list, shiftById, canEdit, onTap }) {
  const working = list.filter(e => statusOf(e) === 'on')
  const off = list.filter(e => statusOf(e) !== 'on')
  const content = (
    <>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate">{s.name}</span>
        {s.role_name && <span className="block text-[11px] text-muted-foreground truncate">{s.role_name}</span>}
      </span>
      <span className="shrink-0 text-right space-y-0.5">
        {working.map((e, i) => <span key={i} className="block text-xs tabular-nums">{entryTimes(e, shiftById)}</span>)}
        {off.map((e, i) => (
          <span key={'o' + i} className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{entryTimes(e, shiftById)}</span><StatusBadge status={statusOf(e)} />
          </span>
        ))}
      </span>
    </>
  )
  return (
    <li data-testid="mrota-person" data-name={s.name} data-status={dayStatus(list) ?? 'none'}>
      {canEdit
        ? <button type="button" onClick={onTap} className="w-full flex items-center gap-3 px-3 py-2 min-h-[52px] text-left touch-manipulation active:bg-muted">{content}</button>
        : <div className="flex items-center gap-3 px-3 py-2 min-h-[52px]">{content}</div>}
    </li>
  )
}

function AddPerson({ people, onPick }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="mrota-add"
        className="w-full flex items-center justify-center gap-1.5 min-h-[48px] border-t text-sm text-primary font-medium touch-manipulation active:bg-muted">
        <Plus className="w-4 h-4" /> Add someone
      </button>
    )
  }
  return (
    <div className="border-t p-2 flex flex-wrap gap-2" data-testid="mrota-add-list">
      {people.map(p => (
        <button key={p.id} type="button" onClick={() => { setOpen(false); onPick(p) }}
          className="min-h-[44px] px-3 rounded-full border text-sm touch-manipulation active:bg-muted">{p.name}</button>
      ))}
      <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] px-3 rounded-full text-sm text-muted-foreground touch-manipulation">Cancel</button>
    </div>
  )
}

// ── By person ────────────────────────────────────────────────

function ByPerson({ week, dates, staff, shiftById, entriesOf, canEdit, onEdit }) {
  const today = todayStr()
  if (!staff.length) return <p className="text-sm text-muted-foreground text-center py-6">Nobody on this week's rota.</p>
  const cols = { gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }
  return (
    <div className="border rounded-xl bg-background overflow-hidden">
      <div className="grid gap-1 px-2 py-1.5 section-head text-[11px] font-semibold text-center" style={cols}>
        {dates.map(d => (
          <span key={d} className={cn(d === today && 'underline underline-offset-2')}>{format(parseISO(d), 'EEE')} {format(parseISO(d), 'd')}</span>
        ))}
      </div>
      <ul className="divide-y">
        {staff.map(s => {
          const all = dates.flatMap(d => entriesOf(s.id, d))
          return (
            <li key={s.id} className="px-2 py-2 space-y-1.5" data-testid="mrota-row" data-name={s.name}>
              <div className="flex items-baseline gap-2 px-0.5">
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{s.name}
                  {s.role_name && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{s.role_name}</span>}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums" data-testid="mrota-row-hours">{hoursText(workedMinutes(all, shiftById))}</span>
              </div>
              <div className="grid gap-1" style={cols}>
                {dates.map(d => {
                  const list = entriesOf(s.id, d)
                  const st = dayStatus(list)
                  const off = s.off_days?.[d]
                  const label = off && !list.length ? '–' : st ? (st === 'on' ? decimalHours(workedMinutes(list, shiftById)) : STATUS_BY_KEY[st].label.slice(0, 1)) : ''
                  const cls = cn('h-11 rounded-md text-xs font-semibold flex items-center justify-center tabular-nums',
                    st ? CELL[st] : off ? 'bg-muted text-muted-foreground' : 'bg-muted/40 text-muted-foreground/60')
                  const name = `${s.name} ${format(parseISO(d), 'EEEE')}: ${st ? STATUS_BY_KEY[st].name : off ? offDayText(off) : 'off'}`
                  return canEdit && !off
                    ? <button key={d} type="button" className={cn(cls, 'touch-manipulation')} aria-label={name} data-testid="mrota-cell" data-date={d} data-status={st ?? 'off'} onClick={() => onEdit(s, d)}>{label}</button>
                    : <span key={d} className={cls} aria-label={name} data-testid="mrota-cell" data-date={d} data-status={st ?? 'off'}>{label}</span>
                })}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="px-3 py-2 border-t text-[11px] text-muted-foreground">
        A number is hours on. S sick, P holiday (paid time off), U unpaid, A absent, – off the rota.
      </p>
    </div>
  )
}

// ── Me ───────────────────────────────────────────────────────

function MyWeek({ week, dates, staff, shiftById, entriesOf, me, venueId, canEdit, onEdit }) {
  const stored = read(ME_KEY + ':' + venueId)
  const [picked, setPicked] = useState(stored)
  const [choosing, setChoosing] = useState(false)
  // The login's name or e-mail name, when it is exactly someone's on the rota.
  const myName = (me?.full_name || '').trim().toLowerCase()
  const matched = myName ? staff.find(s => s.name.trim().toLowerCase() === myName) : null
  const person = staff.find(s => s.id === picked) ?? (picked ? null : matched)
  function pick(id) { setPicked(id); keep(ME_KEY + ':' + venueId, id); setChoosing(false) }

  if (!staff.length) return <p className="text-sm text-muted-foreground text-center py-6">Nobody on this week's rota.</p>
  if (!person || choosing) {
    return (
      <div className="border rounded-xl bg-background p-3 space-y-3" data-testid="mrota-me-pick">
        <p className="text-sm">Which one is you? Your week shows here; this phone remembers it.</p>
        <div className="flex flex-wrap gap-2">
          {staff.map(s => (
            <button key={s.id} type="button" onClick={() => pick(s.id)}
              className={cn('min-h-[48px] px-4 rounded-full border text-sm touch-manipulation', s.id === person?.id && 'bg-primary text-primary-foreground')}>{s.name}</button>
          ))}
        </div>
      </div>
    )
  }
  const total = workedMinutes(dates.flatMap(d => entriesOf(person.id, d)), shiftById)
  const today = todayStr()
  return (
    <div className="space-y-3" data-testid="mrota-me" data-name={person.name}>
      <div className="flex items-center gap-3 border rounded-xl bg-background p-3">
        <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><UserRound className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{person.name}</span>
          <span className="block text-xs text-muted-foreground">{hoursText(total)} on this week</span>
        </span>
        <button type="button" onClick={() => setChoosing(true)} className="min-h-[44px] px-3 rounded-lg border text-xs touch-manipulation">Not you?</button>
      </div>
      <ul className="border rounded-xl bg-background divide-y overflow-hidden">
        {dates.map(d => {
          const list = entriesOf(person.id, d)
          const off = person.off_days?.[d]
          const body = (
            <>
              <span className={cn('w-20 shrink-0 text-sm', d === today && 'font-semibold')}>{format(parseISO(d), 'EEE d')}</span>
              <span className="flex-1 min-w-0 text-right text-sm">
                {off && !list.length && <span className="text-xs text-muted-foreground">{offDayText(off)}</span>}
                {!off && !list.length && <span className="text-muted-foreground">Off</span>}
                {list.map((e, i) => (
                  <span key={i} className="flex items-center justify-end gap-1 tabular-nums">
                    {entryTimes(e, shiftById)} <StatusBadge status={statusOf(e)} />
                  </span>
                ))}
              </span>
            </>
          )
          return (
            <li key={d} data-testid="mrota-me-day" data-date={d} data-status={dayStatus(list) ?? 'off'}>
              {canEdit && !off
                ? <button type="button" onClick={() => onEdit(person, d)} className="w-full flex items-center gap-2 px-3 py-2 min-h-[52px] text-left touch-manipulation active:bg-muted">{body}</button>
                : <div className="flex items-center gap-2 px-3 py-2 min-h-[52px]">{body}</div>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Setting a person's day (rota Manage) ────────────────────────

function DaySheet({ venueId, weekStart, week, person, date, shiftById, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const mode = week.settings?.mode ?? 'day_parts'
  const step = week.settings?.slot_minutes ?? 30
  const mine = week.entries.filter(e => e.staff_id === person.id && e.work_date === date)
  const inMode = e => (mode === 'day_parts' ? !!e.shift_id : !e.shift_id)
  // day_parts: shift id -> status or 'off'; hourly: a list of periods.
  const [cells, setCells] = useState(() => Object.fromEntries(mine.filter(e => e.shift_id).map(e => [e.shift_id, statusOf(e)])))
  const [periods, setPeriods] = useState(() => mine.filter(e => !e.shift_id)
    .map(e => ({ start_time: hhmm(e.start_time), end_time: hhmm(e.end_time), status: statusOf(e) }))
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time)))
  const shifts = (week.shifts ?? []).filter(s => s.is_active || cells[s.id])
  const otherMode = mine.filter(e => !inMode(e))
  const problem = mode === 'hourly' ? periodProblem(periods) : null

  const save = useMutation({
    mutationFn: () => {
      const offOn = (id, d) => week.staff.find(s => s.id === id)?.off_days?.[d]
      const rest = week.entries.filter(e => !(e.staff_id === person.id && e.work_date === date && inMode(e)))
      const mineNow = mode === 'day_parts'
        ? Object.entries(cells).filter(([, st]) => st && st !== 'off').map(([shift_id, status]) => ({ staff_id: person.id, work_date: date, shift_id, status }))
        : periods.map(p => ({ staff_id: person.id, work_date: date, start_time: p.start_time, end_time: p.end_time, status: p.status }))
      return api.put(`/rota/venues/${venueId}/weeks/${weekStart}/entries`, {
        entries: [...rest, ...mineNow].filter(e => !offOn(e.staff_id, e.work_date)).map(clean),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rota-week', venueId, weekStart] })
      qc.invalidateQueries({ queryKey: ['rota-pay', venueId, weekStart] })
      onClose()
    },
  })

  const statusButtons = (value, onChange, testid) => (
    <div className="grid grid-cols-4 gap-1.5" data-testid={testid}>
      {CHOICES.map(c => (
        <button key={c.value} type="button" aria-pressed={value === c.value} data-value={c.value} onClick={() => onChange(c.value)}
          className={cn('min-h-[48px] rounded-lg border text-sm font-medium touch-manipulation',
            value === c.value ? (c.value === 'off' ? 'bg-foreground text-background' : CELL[c.value]) : 'bg-background')}>
          {c.label}
        </button>
      ))}
    </div>
  )

  return (
    <Modal title={`${person.name} · ${format(parseISO(date), 'EEE d MMM')}`} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !!problem} data-testid="mrota-save"
            className="flex-1 min-h-[48px] rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} className="min-h-[48px] px-4 rounded-lg border text-sm touch-manipulation">Cancel</button>
        </>
      )}>
      <div data-testid="mrota-sheet" className="space-y-4">
        {mode === 'day_parts' && (shifts.length ? shifts.map(s => {
          const v = cells[s.id] ?? 'off'
          return (
            <div key={s.id} className="space-y-1.5" data-testid="mrota-shift" data-shift={s.name}>
              <p className="text-sm font-medium">{s.name} <span className="text-muted-foreground font-normal tabular-nums">{hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
                {!CHOICES.some(c => c.value === v) && <StatusBadge status={v} className="ml-1.5" />}</p>
              {statusButtons(v, st => setCells(c => ({ ...c, [s.id]: st })), 'mrota-choice')}
            </div>
          )
        }) : <p className="text-sm text-muted-foreground">No shifts are set up. Add them in Rota setup in the office.</p>)}

        {mode === 'hourly' && (
          <div className="space-y-3">
            {!periods.length && <p className="text-sm text-muted-foreground">Off this day. Add the hours they work below.</p>}
            {periods.map((p, i) => (
              <div key={i} className="border rounded-lg p-2 space-y-2" data-testid="mrota-period">
                <div className="flex items-center gap-2">
                  <TimeSelect value={p.start_time} step={step} label="Starts" onChange={v => setPeriods(ps => ps.map((x, j) => (j === i ? { ...x, start_time: v } : x)))} className="flex-1" />
                  <span className="text-muted-foreground">–</span>
                  <TimeSelect value={p.end_time} step={step} label="Ends" onChange={v => setPeriods(ps => ps.map((x, j) => (j === i ? { ...x, end_time: v } : x)))} className="flex-1" />
                </div>
                {statusButtons(p.status, st => (st === 'off'
                  ? setPeriods(ps => ps.filter((_, j) => j !== i))
                  : setPeriods(ps => ps.map((x, j) => (j === i ? { ...x, status: st } : x)))), 'mrota-choice')}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {(week.shifts ?? []).filter(s => s.is_active).map(s => (
                <button key={s.id} type="button" onClick={() => setPeriods(ps => [...ps, { start_time: hhmm(s.start_time), end_time: hhmm(s.end_time), status: 'on' }])}
                  className="min-h-[44px] px-3 rounded-full border text-sm touch-manipulation">+ {s.name}</button>
              ))}
              <button type="button" onClick={() => setPeriods(ps => [...ps, { start_time: '09:00', end_time: '17:00', status: 'on' }])}
                className="min-h-[44px] px-3 rounded-full border text-sm touch-manipulation" data-testid="mrota-add-period">+ Hours</button>
            </div>
            {problem && <p className="text-xs text-red-700">{problem}</p>}
          </div>
        )}

        {otherMode.length > 0 && (
          <p className="text-xs text-muted-foreground">
            This day also has {otherMode.length} {mode === 'day_parts' ? 'hourly' : 'shift'} {otherMode.length === 1 ? 'entry' : 'entries'} from before the rota's mode changed; they are kept as they are.
          </p>
        )}
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  )
}
