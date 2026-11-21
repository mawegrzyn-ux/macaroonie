// src/components/reports/ScheduleWindow.jsx
//
// Emailing a report: ScheduleWindow sets up (or changes) a schedule that
// sends it by itself (POST /reports/:id/schedules, PATCH
// /reports/schedules/:id), SendWindow sends it once, now (POST
// /reports/:id/send). Both are checked by the server as the sweep checks a
// schedule (api src/reports/send.js prepareSend()); the rules for timings,
// what the email holds, when it sends and who gets it are the ones the
// server uses (shared/reports/schedule.js), so the window says what is wrong
// before Save and the server refuses the same things.
//
// A schedule sends as its owner, with what the owner's role sees, checked at
// every run. People it is sent to see what is in it, whatever their own
// access: the window says so beside who gets it.
//
// The next email is worked out here with the server's rule, on the clock of
// the report's venues (venueScope(), with the venues in the order the server
// takes them: created first first), so the time shown is the time it sends.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, X, AlertTriangle, Clock, Users } from 'lucide-react'
import { useApi } from '@/lib/api'
import { useVenues, Modal, Field, Segmented, TimeSelect, inputCls } from '@/components/staff/shared'
import ParamInputs, { showsInputs } from '@/components/reports/ParamInputs'
import { Problems, retryUnlessRefused } from '@/components/reports/shared'
import {
  normaliseTiming, timingProblem, timingText, nextRunAt, normaliseDelivery, deliveryProblem, deliveryText,
  normaliseCondition, conditionProblem, conditionText, recipientsProblem, periodProblem, isEmail,
  ATTACH, ATTACH_LABELS, WEEKS, OP_WORDS, OPS, MAX_RECIPIENTS, DEFAULT_TIME,
} from '@shared/reports/schedule.js'
import { paramInputs, valueName, valueType, shownNumber, storedNumber } from '@shared/reports/build.js'
import { normaliseReport, resolveParams, venueScope } from '@shared/reports/spec.js'
import { todayIn } from '@shared/reports/period.js'
import { WEEKDAYS, WEEKDAYS_LONG, NUMERIC_TYPES } from '@shared/reports/format.js'
import { cn } from '@/lib/utils'

const primaryBtn = 'inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation hover:opacity-90 disabled:opacity-50'
const plainBtn = 'inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg border bg-background text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50'
const checkRow = 'flex items-center gap-3 min-h-[48px] touch-manipulation cursor-pointer'
const box = 'w-5 h-5 shrink-0 accent-[hsl(var(--primary))]'

/* ------------------------------------------------------------------ words */

const browserZone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { return null }
})()

/** A time zone's place name: "London" for Europe/London. */
export const zoneName = tz => String(tz || '').split('/').pop().replace(/_/g, ' ')

/**
 * A moment as people read it, on a clock: "Mon 16 Nov at 08:00", with the
 * year when it isn't this year, and the place when the clock isn't the
 * browser's ("Mon 16 Nov at 08:00, London time").
 */
export function whenText(at, tz) {
  if (!at) return null
  const d = at instanceof Date ? at : new Date(at)
  if (!Number.isFinite(d.getTime())) return null
  const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  let zone = tz || undefined
  let parts
  try { parts = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: zone }).formatToParts(d) } catch {
    zone = undefined
    parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(d)
  }
  const get = (list, t) => list.find(p => p.type === t)?.value || ''
  let year = ''
  try {
    const now = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: zone }).formatToParts(new Date())
    if (get(now, 'year') !== get(parts, 'year')) year = ' ' + get(parts, 'year')
  } catch { /* the year then stays off */ }
  const text = get(parts, 'weekday') + ' ' + get(parts, 'day') + ' ' + get(parts, 'month') + year + ' at ' + get(parts, 'hour') + ':' + get(parts, 'minute')
  return zone && browserZone && zone !== browserZone ? text + ', ' + zoneName(zone) + ' time' : text
}

const ordinal = n => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'
  return n + s
}
const WEEK_LABELS = { first: 'First', second: 'Second', third: 'Third', fourth: 'Fourth', last: 'Last' }
const plural = (n, one, many) => (n === 1 ? '1 ' + one : n + ' ' + many)

function Note({ tone = 'amber', children, testid, icon = true }) {
  return (
    <p data-testid={testid}
      className={cn('flex gap-2 rounded-lg px-3 py-2 text-xs',
        tone === 'amber' ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'bg-muted/50 text-muted-foreground border')}>
      {icon && <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
      <span>{children}</span>
    </p>
  )
}

function Part({ title, children, testid }) {
  return (
    <section className="space-y-2" data-testid={testid}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

/* --------------------------------------------------------------- loading */

// The report, who it can go to, and (for a schedule) the catalogue and the
// venues. The window waits for them all: its form starts from them.
function useBasics(reportId, { full }) {
  const api = useApi()
  const ref = encodeURIComponent(reportId || '')
  const reportQ = useQuery({ queryKey: ['report', reportId], queryFn: () => api.get('/reports/' + ref), enabled: !!reportId, retry: retryUnlessRefused })
  const catQ = useQuery({ queryKey: ['report-catalogue'], queryFn: () => api.get('/reports/catalogue'), enabled: full, staleTime: 5 * 60_000, retry: retryUnlessRefused })
  const recQ = useQuery({ queryKey: ['report-recipients'], queryFn: () => api.get('/reports/recipients'), staleTime: 60_000, retry: retryUnlessRefused })
  const venuesQ = useVenues()
  const error = reportQ.error || recQ.error || (full ? catQ.error : null)
  const ready = !!reportQ.data?.report && !!recQ.data && (!full || (!!catQ.data && !venuesQ.isLoading))
  return { report: reportQ.data?.report || null, catalogue: catQ.data || null, rec: recQ.data || null, venues: venuesQ.data || [], error, ready }
}

// The venues in the order the server takes them (created first first), each
// with a clock: the first venue's clock is the report's (venueScope()).
const inServerOrder = venues => [...venues]
  .map(v => ({ ...v, timezone: v.timezone || 'Europe/London', currency: String(v.currency || '').trim() || 'GBP' }))
  .sort((a, b) => {
    const x = String(a.created_at || ''), y = String(b.created_at || '')
    if (x !== y) return x < y ? -1 : 1
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
  })

/* ---------------------------------------------------------------- timing */

function TimingPicker({ timing, onChange, tz, paused }) {
  const t = timing
  const every = t.every || 'day'
  const days = Array.isArray(t.days) ? t.days : []
  const on = t.on || {}
  const byWeekday = on.week != null || on.weekday != null
  const set = patch => onChange({ ...t, ...patch })
  const pickEvery = v => {
    if (v === every) return
    if (v === 'day') onChange({ every: 'day', time: t.time })
    else if (v === 'week') onChange({ every: 'week', days: [1, 2, 3, 4, 5], time: t.time })
    else onChange({ every: 'month', on: { day: 1 }, time: t.time })
  }
  const toggleDay = d => set({ days: days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b) })
  const problem = timingProblem(t)
  const next = problem ? null : nextRunAt(normaliseTiming(t), new Date(), tz)
  const otherClock = tz && browserZone && tz !== browserZone

  return (
    <Part title="When it sends" testid="sched-timing">
      <Segmented value={every} onChange={pickEvery} testid="sched-every" className="w-full [&>button]:h-12 [&>button]:flex-1"
        options={[{ value: 'day', label: 'Every day' }, { value: 'week', label: 'Chosen days' }, { value: 'month', label: 'Every month' }]} />

      {every === 'week' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Days of the week" data-testid="sched-days">
            {WEEKDAYS.map((w, i) => {
              const d = i + 1
              const onIt = days.includes(d)
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)} aria-pressed={onIt} aria-label={WEEKDAYS_LONG[i]}
                  data-testid="sched-day" data-day={d}
                  className={cn('h-12 min-w-[48px] px-3 rounded-lg border text-sm font-medium touch-manipulation',
                    onIt ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                  {w}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => set({ days: [1, 2, 3, 4, 5] })} data-testid="sched-weekdays" className={plainBtn}>Weekdays</button>
            <button type="button" onClick={() => set({ days: [6, 7] })} data-testid="sched-weekends" className={plainBtn}>Weekends</button>
          </div>
        </div>
      )}

      {every === 'month' && (
        <div className="space-y-2">
          <Segmented value={byWeekday ? 'weekday' : 'date'} testid="sched-month-mode" className="w-full [&>button]:h-12 [&>button]:flex-1"
            onChange={v => set({ on: v === 'weekday' ? { week: 'first', weekday: 1 } : { day: 1 } })}
            options={[{ value: 'date', label: 'On a date' }, { value: 'weekday', label: 'On a weekday' }]} />
          {!byWeekday ? (
            <Field label="Day of the month"
              hint={typeof on.day === 'number' && on.day > 28 ? 'In a month without a ' + ordinal(on.day) + ', it sends on the month\'s last day.' : null}>
              <select value={String(on.day ?? 1)} onChange={e => set({ on: { day: e.target.value === 'last' ? 'last' : Number(e.target.value) } })}
                data-testid="sched-month-day" className={cn(inputCls, 'h-12')}>
                {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{ordinal(i + 1)}</option>)}
                <option value="last">The last day</option>
              </select>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Which one">
                <select value={on.week || 'first'} onChange={e => set({ on: { week: e.target.value, weekday: on.weekday ?? 1 } })}
                  data-testid="sched-month-week" className={cn(inputCls, 'h-12')}>
                  {WEEKS.map(w => <option key={w} value={w}>{WEEK_LABELS[w]}</option>)}
                </select>
              </Field>
              <Field label="Day">
                <select value={String(on.weekday ?? 1)} onChange={e => set({ on: { week: on.week || 'first', weekday: Number(e.target.value) } })}
                  data-testid="sched-month-weekday" className={cn(inputCls, 'h-12')}>
                  {WEEKDAYS_LONG.map((w, i) => <option key={w} value={String(i + 1)}>{w}</option>)}
                </select>
              </Field>
            </div>
          )}
        </div>
      )}

      <Field label="Time" hint={otherClock ? 'On the venue\'s clock: ' + zoneName(tz) + ' time.' : null}>
        <span data-testid="sched-time" className="block">
          <TimeSelect value={t.time || DEFAULT_TIME} onChange={v => set({ time: v })} label="Time" className="h-12 w-32" />
        </span>
      </Field>

      {problem && <Note testid="sched-timing-problem">{problem}</Note>}
      {!problem && (
        <p className="flex items-center gap-2 text-sm" data-testid="sched-next">
          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
          <span>
            {timingText(normaliseTiming(t))}.{' '}
            {paused
              ? 'It is paused: nothing is sent until it is resumed.'
              : next ? 'Next email ' + whenText(next, tz) + '.' : 'It never comes round.'}
          </span>
        </p>
      )}
    </Part>
  )
}

/* -------------------------------------------------------------- delivery */

function DeliveryPicker({ delivery, onChange, tid }) {
  const d = normaliseDelivery(delivery)
  const set = patch => onChange({ ...d, ...patch })
  const problem = deliveryProblem(d)
  return (
    <Part title="What the email holds" testid={tid + '-delivery'}>
      <label className={checkRow}>
        <input type="checkbox" checked={d.in_message} onChange={e => set({ in_message: e.target.checked })} className={box} data-testid={tid + '-in-message'} />
        <span className="text-sm">Put the report in the email</span>
      </label>
      <Field label="Attach a file" group>
        <Segmented value={d.attach} testid={tid + '-attach'} className="w-full [&>button]:h-12 [&>button]:flex-1"
          onChange={v => set({ attach: v, keep_file: v === 'none' ? false : d.keep_file })}
          options={ATTACH.map(a => ({ value: a, label: ATTACH_LABELS[a] }))} />
      </Field>
      {d.attach !== 'none' && (
        <label className={checkRow}>
          <input type="checkbox" checked={d.keep_file} onChange={e => set({ keep_file: e.target.checked })} className={box} data-testid={tid + '-keep'} />
          <span className="text-sm">
            Keep the file in Past runs
            <span className="block text-[11px] text-muted-foreground">Kept for you for 30 days, 7 if it holds people's details.</span>
          </span>
        </label>
      )}
      {problem && <Note testid={tid + '-delivery-problem'}>{problem}</Note>}
    </Part>
  )
}

/* ------------------------------------------------------------- condition */

const unitOf = (type, currency) => {
  if (type === 'money') return { before: currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency + ' ' }
  if (type === 'percent') return { after: '%' }
  if (type === 'duration') return { after: 'minutes' }
  return {}
}

function ConditionPicker({ condition, onChange, thanText, setThanText, watch, kind, hasTotal, currency }) {
  const c = condition
  const figureOk = kind === 'summary' && watch.length > 0
  const watched = watch.find(w => w.key === c.value) || null
  const type = watched?.type || 'number'
  const pick = when => {
    if (when === c.when) return
    if (when !== 'figure') return onChange({ when })
    onChange({
      when,
      value: watched ? watched.key : watch[0]?.key || null,
      op: OPS.includes(c.op) ? c.op : 'over',
      scope: c.scope === 'total' && hasTotal ? 'total' : 'any',
    })
  }
  const full = c.when === 'figure' ? { ...c, than: storedNumber(type, thanText) } : c
  const problem = conditionProblem(full, kind, watch)
  const unit = unitOf(type, currency)
  const choices = [
    { value: 'always', label: 'Every time', hint: 'It sends at every time it comes round.' },
    { value: 'rows', label: 'Only when there are rows', hint: 'Nothing to report, nothing sent.' },
    ...(figureOk || c.when === 'figure' ? [{ value: 'figure', label: 'Only when a figure...', hint: 'Over, under or more than a figure you set.' }] : []),
  ]
  return (
    <Part title="Send it" testid="sched-condition">
      <div className="space-y-2" role="group" aria-label="Send it" data-testid="sched-when">
        {choices.map(o => (
          <button key={o.value} type="button" onClick={() => pick(o.value)} aria-pressed={c.when === o.value} data-value={o.value}
            className={cn('w-full min-h-[48px] px-3 py-2 rounded-lg border text-left touch-manipulation',
              c.when === o.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-background hover:bg-muted')}>
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
          </button>
        ))}
      </div>
      {c.when === 'figure' && (
        <div className="space-y-2 rounded-lg border p-3" data-testid="sched-figure-part">
          <Field label="The figure">
            <select value={c.value || ''} onChange={e => onChange({ ...c, value: e.target.value || null })}
              data-testid="sched-figure" className={cn(inputCls, 'h-12')}>
              {!watched && <option value="">Pick a figure</option>}
              {watch.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Is">
              <select value={c.op} onChange={e => onChange({ ...c, op: e.target.value })} data-testid="sched-op" className={cn(inputCls, 'h-12')}>
                {OPS.map(op => <option key={op} value={op}>{OP_WORDS[op].replace(/^is /, '') + (op === 'outside' ? ' (either way)' : '')}</option>)}
              </select>
            </Field>
            <Field label="Than">
              <span className="flex items-center gap-2">
                {unit.before && <span className="text-sm text-muted-foreground">{unit.before}</span>}
                <input type="text" inputMode="decimal" value={thanText} onChange={e => setThanText(e.target.value)}
                  data-testid="sched-than" className={cn(inputCls, 'h-12')} placeholder="0" />
                {unit.after && <span className="text-sm text-muted-foreground shrink-0">{unit.after}</span>}
              </span>
            </Field>
          </div>
          {(hasTotal || c.scope === 'total') ? (
            <Field label="Where" group>
              <Segmented value={c.scope === 'total' ? 'total' : 'any'} onChange={v => onChange({ ...c, scope: v })} testid="sched-scope"
                className="w-full [&>button]:h-12 [&>button]:flex-1"
                options={[{ value: 'any', label: 'On any row' }, { value: 'total', label: 'In total' }]} />
            </Field>
          ) : null}
          {!hasTotal && (
            <p className="text-[11px] text-muted-foreground" data-testid="sched-total-hint">
              {c.scope === 'total'
                ? 'This report has no total row, so "In total" never matches: pick "On any row", or turn its total on in the builder.'
                : 'It watches each row: this report has no total row.'}
            </p>
          )}
          {!problem && <p className="text-sm" data-testid="sched-condition-text">{conditionText(full, watched ? { label: watched.label, type } : null, currency)}.</p>}
        </div>
      )}
      {problem && <Note testid="sched-condition-problem">{problem}</Note>}
    </Part>
  )
}

/* ------------------------------------------------------------ recipients */

/**
 * Who it goes to: people on the team by their user id, and (owners and
 * admins with Manage) addresses outside it. `people` is the list sent.
 */
function RecipientsPicker({ rec, people, setPeople, personal, setPersonal, known, tid }) {
  const meId = rec.me?.user_id || null
  const max = rec.max || MAX_RECIPIENTS
  const team = useMemo(() => {
    const list = (rec.team || []).slice()
    const i = list.findIndex(u => u.user_id === meId)
    if (i > 0) list.unshift(...list.splice(i, 1))
    return list
  }, [rec.team, meId])
  const teamIds = useMemo(() => new Set(team.map(u => u.user_id)), [team])
  const byEmail = useMemo(() => new Map(team.map(u => [u.email, u])), [team])
  const [filter, setFilter] = useState('')
  const [typed, setTyped] = useState('')
  const [typedProblem, setTypedProblem] = useState(null)

  const ids = new Set(people.filter(p => p.user_id).map(p => p.user_id))
  const outside = people.filter(p => p.email)
  const extra = people.filter(p => p.user_id && !teamIds.has(p.user_id))
  const full = people.length >= max
  const shown = filter.trim()
    ? team.filter(u => (String(u.name || '') + ' ' + u.email).toLowerCase().includes(filter.trim().toLowerCase()))
    : team
  const toggle = u => setPeople(ids.has(u.user_id) ? people.filter(p => p.user_id !== u.user_id) : [...people, { user_id: u.user_id }])
  const add = () => {
    const email = typed.trim().toLowerCase()
    if (!email) return
    if (!isEmail(email)) { setTypedProblem('That isn\'t an email address'); return }
    const member = byEmail.get(email)
    if (member) {
      if (!ids.has(member.user_id) && !full) setPeople([...people, { user_id: member.user_id }])
    } else if (!outside.some(p => p.email === email) && !full) {
      setPeople([...people, { email }])
    }
    setTyped('')
    setTypedProblem(null)
  }
  const nameOf = id => {
    const k = known.get(id)
    return k ? (k.name || k.email || 'Someone on the team') : 'Someone on the team'
  }
  const problem = recipientsProblem(people)

  return (
    <Part title="Who gets it" testid={tid + '-recipients'}>
      <p className="flex gap-2 text-xs text-muted-foreground" data-testid={tid + '-who-note'}>
        <Users className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>People it's sent to see what is in it, whatever their own access.</span>
      </p>

      {!rec.can_others ? (
        <p className="text-sm" data-testid={tid + '-just-you'}>It goes to you{rec.me?.email ? ' (' + rec.me.email + ')' : ''}.</p>
      ) : (
        <>
          {team.length > 8 && (
            <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find someone on the team"
              aria-label="Find someone on the team" data-testid={tid + '-filter'} className={cn(inputCls, 'h-12')} />
          )}
          <div className="max-h-64 overflow-y-auto rounded-lg border divide-y" data-testid={tid + '-team'}>
            {shown.map(u => {
              const checked = ids.has(u.user_id)
              return (
                <label key={u.user_id} className={cn(checkRow, 'px-3', full && !checked && 'opacity-50')} data-testid={tid + '-person'} data-id={u.user_id}>
                  <input type="checkbox" checked={checked} disabled={full && !checked} onChange={() => toggle(u)} className={box} />
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{u.name || u.email}{u.user_id === meId ? ' (you)' : ''}</span>
                    {u.name && <span className="block text-[11px] text-muted-foreground truncate">{u.email}</span>}
                  </span>
                </label>
              )
            })}
            {!shown.length && <p className="px-3 py-3 text-sm text-muted-foreground">Nobody on the team matches.</p>}
          </div>
          {extra.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {extra.map(p => (
                <span key={p.user_id} className="inline-flex items-center gap-1 rounded-lg border bg-muted/30 pl-3 text-sm" data-testid={tid + '-extra'} data-id={p.user_id}>
                  {nameOf(p.user_id)}
                  <button type="button" onClick={() => setPeople(people.filter(x => x.user_id !== p.user_id))} aria-label={'Take ' + nameOf(p.user_id) + ' off'}
                    className="h-12 min-w-[48px] inline-flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation"><X className="w-4 h-4" /></button>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {rec.can_outside && (
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">An address outside the team</span>
          <div className="flex gap-2">
            <input type="email" value={typed} onChange={e => { setTyped(e.target.value); setTypedProblem(null) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
              placeholder="name@example.com" aria-label="An address outside the team" disabled={full}
              data-testid={tid + '-add-email'} className={cn(inputCls, 'h-12')} />
            <button type="button" onClick={add} disabled={!typed.trim() || full} data-testid={tid + '-add'} className={plainBtn}>Add</button>
          </div>
          {typedProblem && <p className="text-xs text-red-700" data-testid={tid + '-email-problem'}>{typedProblem}</p>}
        </div>
      )}

      {outside.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid={tid + '-outside-list'}>
          {outside.map(p => (
            <span key={p.email} className="inline-flex items-center gap-1 rounded-lg border bg-muted/30 pl-3 text-sm break-all" data-testid={tid + '-outside'} data-email={p.email}>
              {p.email}
              <button type="button" onClick={() => setPeople(people.filter(x => x.email !== p.email))} aria-label={'Take ' + p.email + ' off'}
                data-testid={tid + '-outside-remove'}
                className="h-12 min-w-[48px] inline-flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation"><X className="w-4 h-4" /></button>
            </span>
          ))}
        </div>
      )}

      {outside.length > 0 && !rec.can_outside && (
        <Note testid={tid + '-outside-blocked'}>Only an owner or an admin can send reports to addresses outside the team. Take these off to save.</Note>
      )}

      {outside.length > 0 && (
        <label className={cn(checkRow, !rec.can_personal_outside && !personal && 'opacity-50')}>
          <input type="checkbox" checked={personal} disabled={!rec.can_personal_outside && !personal} onChange={e => setPersonal(e.target.checked)}
            className={box} data-testid={tid + '-personal'} />
          <span className="text-sm">
            Include people's details for addresses outside the team
            <span className="block text-[11px] text-muted-foreground">
              When off, copies to addresses outside the team leave out people's details (names, emails, phone numbers), and a report grouped by them isn't sent to those addresses.
            </span>
          </span>
        </label>
      )}
      {outside.length > 0 && personal && !rec.can_personal_outside && (
        <Note testid={tid + '-personal-blocked'}>Only an owner or an admin can send people's details outside the team: untick it to save.</Note>
      )}

      {full && <p className="text-xs text-muted-foreground" data-testid={tid + '-full'}>It can go to {max} people at most.</p>}
      {problem && <Note testid={tid + '-recipients-problem'}>{problem}</Note>}
    </Part>
  )
}

// Who a schedule goes to when the window opens: a new one to the person
// opening it; an existing one to the people it went to who are still on the
// team, and its addresses outside the team. Without Manage it can only go to
// the person themselves.
function startingPeople(schedule, rec) {
  const me = rec.me ? (rec.me.user_id ? { user_id: rec.me.user_id } : rec.me.email ? { email: rec.me.email } : null) : null
  if (!schedule) return { list: me ? [me] : [], gone: 0, others: 0 }
  let gone = 0
  let list = []
  for (const r of schedule.recipients || []) {
    if (r.outside) list.push({ email: r.email })
    else if (r.on_team && r.user_id) list.push({ user_id: r.user_id })
    else gone++
  }
  let others = 0
  if (!rec.can_others) {
    const mine = list.filter(p => (me?.user_id && p.user_id === me.user_id) || (me?.email && p.email === me.email))
    others = list.length - mine.length
    list = mine.length ? mine : me ? [me] : []
  }
  return { list, gone, others }
}

const knownPeople = (rec, schedule) => {
  const m = new Map()
  for (const u of rec.team || []) m.set(u.user_id, u)
  if (rec.me?.user_id) m.set(rec.me.user_id, rec.me)
  for (const r of schedule?.recipients || []) if (r.user_id && !m.has(r.user_id)) m.set(r.user_id, r)
  return m
}

/* ----------------------------------------------------------- the windows */

/** Schedule a report (`schedule` null) or change a schedule. Calls onSaved(schedule) once saved. */
export function ScheduleWindow({ reportId, schedule = null, given = {}, onSaved, onClose }) {
  const b = useBasics(reportId, { full: true })
  const title = schedule ? 'Change the schedule' : 'Schedule this report'
  if (!b.ready) {
    return (
      <Modal title={title} onClose={onClose}>
        {b.error
          ? <Problems error={b.error} title="The schedule can't be set up" />
          : <p className="text-sm text-muted-foreground" data-testid="sched-loading">Loading…</p>}
      </Modal>
    )
  }
  return <ScheduleForm {...b} title={title} reportId={reportId} schedule={schedule} given={given} onSaved={onSaved} onClose={onClose} />
}

function ScheduleForm({ report, catalogue, rec, venues, title, reportId, schedule, given, onSaved, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const spec = useMemo(() => normaliseReport(report.spec), [report])
  const inputs = useMemo(() => paramInputs(catalogue, spec), [catalogue, spec])
  const ordered = useMemo(() => inServerOrder(venues), [venues])
  const known = useMemo(() => knownPeople(rec, schedule), [rec, schedule])
  const start = useMemo(() => startingPeople(schedule, rec), [schedule, rec])

  // The figures it can watch: the report's numeric values, by key.
  const watch = useMemo(() => (spec.values || [])
    .map(v => ({ key: v.key, label: valueName(catalogue, spec, v), type: valueType(catalogue, spec, v) }))
    .filter(v => NUMERIC_TYPES.includes(v.type)), [catalogue, spec])
  // "In total" reads the total row, which a summary has when it has no
  // groupings (its one row) or keeps its grand total.
  const hasTotal = !(spec.rows || []).length || spec.totals?.grand !== false

  const [name, setName] = useState(() => schedule?.name || '')
  const [message, setMessage] = useState(() => schedule?.message || '')
  const [timing, setTiming] = useState(() => (schedule ? normaliseTiming(schedule.timing) : { every: 'day', time: DEFAULT_TIME }))
  const [picked, setPicked] = useState(() => {
    const keys = new Set(spec.params.map(p => p.key))
    const from = schedule ? schedule.params : given
    return Object.fromEntries(Object.entries(from && typeof from === 'object' ? from : {}).filter(([k]) => keys.has(k)))
  })
  const [delivery, setDelivery] = useState(() => normaliseDelivery(schedule?.delivery || { in_message: true, attach: 'none' }))
  const [condition, setCondition] = useState(() => {
    const c = normaliseCondition(schedule?.condition)
    return c.when === 'figure' ? { when: c.when, value: c.value, op: c.op, scope: c.scope } : c
  })
  const [thanText, setThanText] = useState(() => {
    const c = normaliseCondition(schedule?.condition)
    if (c.when !== 'figure' || c.than == null) return ''
    const w = watch.find(x => x.key === c.value)
    const shown = shownNumber(w?.type || 'number', c.than)
    return shown == null ? '' : String(shown)
  })
  const [people, setPeople] = useState(() => start.list)
  const [personal, setPersonal] = useState(() => !!schedule?.personal_outside)
  const [pushUrl, setPushUrl] = useState(() => schedule?.push_url || '')
  const [newSecret, setNewSecret] = useState(false)
  const [secret, setSecret] = useState(null)   // { value, schedule }: shown once after saving
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const pushOn = !!pushUrl.trim()
  const pushProblem = pushOn && !/^https:\/\/[^\s/]+/i.test(pushUrl.trim()) ? 'The web address must start with https://' : null

  const values = Object.fromEntries(spec.params.map(p => [p.key, p.key in picked ? picked[p.key] : p.default]))
  const scope = venueScope(ordered, spec, resolveParams(spec, picked))
  const tz = scope.tz
  const today = todayIn(tz)
  const currency = scope.scope[0]?.currency || 'GBP'
  const watched = watch.find(w => w.key === condition.value) || null
  const fullCondition = condition.when === 'figure' ? { ...condition, than: storedNumber(watched?.type || 'number', thanText) } : { when: condition.when }
  const outside = people.filter(p => p.email)
  const noTeam = !rec.me?.user_id
  const paused = !!schedule && !schedule.enabled

  const problems = [
    noTeam && 'A schedule sends as someone on the group\'s team, and you aren\'t on it',
    timingProblem(timing),
    periodProblem(spec, picked, today),
    conditionProblem(fullCondition, spec.kind, watch),
    deliveryProblem(delivery),
    !(pushOn && !people.length) && recipientsProblem(people),
    outside.length > 0 && !rec.can_outside && 'Only an owner or an admin can send reports to addresses outside the team',
    outside.length > 0 && personal && !rec.can_personal_outside && 'Only an owner or an admin can send people\'s details outside the team',
    pushProblem,
    pushOn && !rec.can_push && 'Only an owner or an admin with Manage on Reports can post a report to a web address',
  ].filter(Boolean)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const body = {
        name: name.trim() || null,
        message: message.trim() || null,
        timing: normaliseTiming(timing),
        params: picked,
        delivery: normaliseDelivery(delivery),
        condition: fullCondition,
        recipients: people,
        personal_outside: (outside.length > 0 || pushOn) && personal,
        ...(rec.can_push || schedule?.push_url ? { push_url: pushUrl.trim() || null } : {}),
        ...(newSecret && pushOn ? { new_push_secret: true } : {}),
      }
      const out = schedule
        ? await api.patch('/reports/schedules/' + encodeURIComponent(schedule.id), body)
        : await api.post('/reports/' + encodeURIComponent(reportId) + '/schedules', body)
      qc.invalidateQueries({ queryKey: ['report-schedules'] })
      setSaving(false)
      if (out.push_secret) setSecret({ value: out.push_secret, schedule: out.schedule })
      else onSaved?.(out.schedule)
    } catch (e) {
      setError(e)
      setSaving(false)
    }
  }

  if (secret) {
    return (
      <Modal title={title} onClose={() => onSaved?.(secret.schedule)}
        footer={<button type="button" onClick={() => onSaved?.(secret.schedule)} data-testid="sched-secret-done" className={primaryBtn}>Done</button>}>
        <div className="space-y-3" data-testid="sched-secret">
          <p className="text-sm font-medium">Saved. Copy the signing secret now: it isn't shown again.</p>
          <p className="text-xs text-muted-foreground">
            Each post carries an X-Macaroonie-Signature header: t=the time,v1=an HMAC-SHA256 of the time, a dot and the body, made with this secret. Check it before trusting a post.
          </p>
          <code className="block break-all rounded border bg-background px-2 py-1 text-xs" data-testid="sched-secret-text">{secret.value}</code>
          <button type="button" onClick={() => navigator.clipboard?.writeText(secret.value).catch(() => {})} data-testid="sched-secret-copy" className={plainBtn}>Copy the secret</button>
        </div>
      </Modal>
    )
  }

  const footer = (
    <>
      {problems.length > 0 && <p className="w-full text-xs text-amber-800" data-testid="sched-blocked">{problems[0]}.</p>}
      <button type="button" onClick={save} disabled={saving || problems.length > 0} data-testid="sched-save" className={primaryBtn}>
        {saving ? 'Saving…' : schedule ? 'Save the schedule' : 'Schedule it'}
      </button>
      <button type="button" onClick={onClose} data-testid="sched-cancel" className={plainBtn}>Cancel</button>
    </>
  )

  return (
    <Modal title={title} onClose={onClose} footer={footer}>
      <div className="space-y-5" data-testid="schedule-window">
        <p className="text-sm text-muted-foreground">
          Emails <span className="font-medium text-foreground">{report.name || 'this report'}</span> by itself, with what your role sees in it at the time it sends.
        </p>
        {schedule?.takes_over && (
          <Note testid="sched-takes-over">
            This is {schedule.owner_email || 'someone else'}'s schedule. Saving makes it yours: it then sends what your role sees, from you.
          </Note>
        )}
        {noTeam && <Note testid="sched-no-team">A schedule sends as someone on the group's team, and you aren't on it.</Note>}
        {start.gone > 0 && (
          <Note testid="sched-dropped-gone">{plural(start.gone, 'person', 'people')} it went to {start.gone === 1 ? 'isn\'t' : 'aren\'t'} on the team any more and {start.gone === 1 ? 'was' : 'were'} taken off.</Note>
        )}
        {start.others > 0 && (
          <Note testid="sched-dropped-others">
            It also went to {plural(start.others, 'other person', 'other people')}. Sending to others needs Manage on Reports, so saving sends it to you only.
          </Note>
        )}

        <TimingPicker timing={timing} onChange={setTiming} tz={tz} paused={paused} />

        {showsInputs(inputs, venues) && (
          <Part title="Its choices" testid="sched-choices-part">
            <div className="flex flex-wrap items-center gap-2" data-testid="sched-choices">
              <ParamInputs catalogue={catalogue} inputs={inputs} values={values} venues={venues} today={today} currency={currency}
                onChange={(key, v) => setPicked(g => ({ ...g, [key]: v }))} />
              {Object.keys(picked).length > 0 && (
                <button type="button" onClick={() => setPicked({})} data-testid="sched-choices-reset"
                  className="h-12 px-3 rounded-lg text-sm text-muted-foreground touch-manipulation hover:bg-muted">
                  The report's usual choices
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">A period like yesterday or last week moves on with each email.</p>
            {periodProblem(spec, picked, today) && <Note testid="sched-period-problem">{periodProblem(spec, picked, today)}</Note>}
          </Part>
        )}

        <ConditionPicker condition={condition} onChange={setCondition} thanText={thanText} setThanText={setThanText}
          watch={watch} kind={spec.kind} hasTotal={hasTotal} currency={currency} />

        <DeliveryPicker delivery={delivery} onChange={setDelivery} tid="sched" />

        <RecipientsPicker rec={rec} people={people} setPeople={setPeople} personal={personal} setPersonal={setPersonal} known={known} tid="sched" />

        {(rec.can_push || schedule?.push_url) && (
          <Part title="Post to a web address" testid="sched-push">
            <Field label="Web address (optional)" hint="Another app gets the figures as JSON each time it sends, signed so it can check they came from here. Left blank, nothing is posted.">
              <input type="url" value={pushUrl} onChange={e => setPushUrl(e.target.value)} maxLength={500} placeholder="https://"
                disabled={!rec.can_push} data-testid="sched-push-url" className={cn(inputCls, 'h-12')} />
            </Field>
            {schedule?.push_url && pushOn && rec.can_push && (
              <label className={checkRow}>
                <input type="checkbox" checked={newSecret} onChange={e => setNewSecret(e.target.checked)} data-testid="sched-push-new-secret" className="w-5 h-5" />
                <span className="text-sm">Make a new signing secret (the old one stops working)</span>
              </label>
            )}
            {pushOn && !people.length && <p className="text-[11px] text-muted-foreground" data-testid="sched-push-only">Nobody is emailed: the post is the whole send.</p>}
            {pushOn && outside.length === 0 && (
              <label className={cn(checkRow, !rec.can_personal_outside && !personal && 'opacity-50')}>
                <input type="checkbox" checked={personal} disabled={!rec.can_personal_outside && !personal} onChange={e => setPersonal(e.target.checked)}
                  data-testid="sched-push-personal" className="w-5 h-5" />
                <span className="text-sm">Include people's details (names, emails, phones) in the post. A report that shows them can only be posted with this on.</span>
              </label>
            )}
            {pushProblem && <Note testid="sched-push-problem">{pushProblem}</Note>}
          </Part>
        )}

        <Part title="The email" testid="sched-email">
          <Field label="Title of the email" hint="Left blank, it is the report's name.">
            <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder={report.name || ''}
              data-testid="sched-name" className={cn(inputCls, 'h-12')} />
          </Field>
          <Field label="A note at the top of the email">
            <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} rows={3}
              data-testid="sched-message" className={cn(inputCls, 'h-auto py-2 min-h-[96px]')} />
          </Field>
        </Part>

        <Problems error={error} title="The schedule wasn't saved" />
      </div>
    </Modal>
  )
}

/** Email a report once, now, with the choices picked on the page. */
export function SendWindow({ reportId, given = {}, drilled = false, onClose }) {
  const b = useBasics(reportId, { full: false })
  if (!b.ready) {
    return (
      <Modal title="Email it now" onClose={onClose}>
        {b.error
          ? <Problems error={b.error} title="It can't be emailed" />
          : <p className="text-sm text-muted-foreground" data-testid="send-loading">Loading…</p>}
      </Modal>
    )
  }
  return <SendForm {...b} reportId={reportId} given={given} drilled={drilled} onClose={onClose} />
}

function SendForm({ report, rec, reportId, given, drilled, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const known = useMemo(() => knownPeople(rec, null), [rec])
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [delivery, setDelivery] = useState(() => normaliseDelivery({ in_message: true, attach: 'none' }))
  const [people, setPeople] = useState(() => startingPeople(null, rec).list)
  const [personal, setPersonal] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const outside = people.filter(p => p.email)

  const problems = [
    deliveryProblem(delivery),
    recipientsProblem(people),
    outside.length > 0 && !rec.can_outside && 'Only an owner or an admin can send reports to addresses outside the team',
    outside.length > 0 && personal && !rec.can_personal_outside && 'Only an owner or an admin can send people\'s details outside the team',
  ].filter(Boolean)

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const out = await api.post('/reports/' + encodeURIComponent(reportId) + '/send', {
        name: name.trim() || null,
        message: message.trim() || null,
        params: given || {},
        delivery: normaliseDelivery(delivery),
        recipients: people,
        personal_outside: outside.length > 0 && personal,
      })
      qc.invalidateQueries({ queryKey: ['report-runs'] })
      setResult(out)
    } catch (e) {
      setError(e)
    }
    setSending(false)
  }

  if (result) {
    const partly = result.status === 'partly'
    return (
      <Modal title="Email it now" onClose={onClose}
        footer={<button type="button" onClick={onClose} data-testid="send-done" className={primaryBtn}>Done</button>}>
        <div className="space-y-3" data-testid="send-result" data-status={result.status}>
          <p className="flex items-center gap-2 text-sm font-medium" data-testid="send-sent">
            <CheckCircle2 className={cn('w-5 h-5 shrink-0', partly ? 'text-amber-600' : 'text-green-600')} />
            {partly ? 'Sent to ' + result.sent + ' of ' + result.to : 'Sent to ' + plural(result.sent, 'person', 'people')}
          </p>
          {partly && result.error && <Note testid="send-partly">{result.error}</Note>}
          {result.kept && <p className="text-sm text-muted-foreground" data-testid="send-kept">The file is kept for you on Past runs.</p>}
          <Link to={'/reports/runs?report=' + encodeURIComponent(reportId)} data-testid="send-runs-link"
            className="inline-flex items-center h-12 text-sm font-medium underline underline-offset-2 hover:text-primary touch-manipulation">
            See it in Past runs
          </Link>
        </div>
      </Modal>
    )
  }

  const footer = (
    <>
      {problems.length > 0 && <p className="w-full text-xs text-amber-800" data-testid="send-blocked">{problems[0]}.</p>}
      <button type="button" onClick={send} disabled={sending || problems.length > 0} data-testid="send-go" className={primaryBtn}>
        {sending ? 'Sending…' : 'Send it now'}
      </button>
      <button type="button" onClick={onClose} data-testid="send-cancel" className={plainBtn}>Cancel</button>
    </>
  )

  return (
    <Modal title="Email it now" onClose={onClose} footer={footer}>
      <div className="space-y-5" data-testid="send-window">
        <p className="text-sm text-muted-foreground">
          Emails <span className="font-medium text-foreground">{report.name || 'this report'}</span> once, now, with the choices picked on the page.
        </p>
        {drilled && <Note tone="muted" testid="send-drilled">Rows you opened up aren't sent: it goes with the choices picked on the page.</Note>}
        <DeliveryPicker delivery={delivery} onChange={setDelivery} tid="send" />
        <RecipientsPicker rec={rec} people={people} setPeople={setPeople} personal={personal} setPersonal={setPersonal} known={known} tid="send" />
        <Part title="The email" testid="send-email">
          <Field label="Title of the email" hint="Left blank, it is the report's name.">
            <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder={report.name || ''}
              data-testid="send-name" className={cn(inputCls, 'h-12')} />
          </Field>
          <Field label="A note at the top of the email">
            <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} rows={3}
              data-testid="send-message" className={cn(inputCls, 'h-auto py-2 min-h-[96px]')} />
          </Field>
        </Part>
        <Problems error={error} title="It wasn't sent" />
      </div>
    </Modal>
  )
}
