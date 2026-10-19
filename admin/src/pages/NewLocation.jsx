// src/pages/NewLocation.jsx — /new-location and /new-location/:id
//
// Opening a new location with Pepper (migration 186, routes/storeOpenings.js).
// Describe it; Pepper scopes it area by area (copy from one of the group's
// locations, set up new, or leave for later) and asks questions only where the
// answer changes the setup; the person can change any choice, ask Pepper to
// dig into an area, or ask for a change; Pepper writes a short brief; Create
// makes the location in one go. Afterwards the page shows what was done and a
// tickable list of what is left for people to do.

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Sparkles, Store, Plus, ArrowLeft, Loader2, Check, X, Lock, Search, Printer, Trash2, ChevronDown, ChevronRight,
  AlertTriangle, CircleCheck, CircleSlash, CircleDashed, ExternalLink, MessageSquareText, RotateCcw, Pencil,
  Clock, Table2, Settings, Globe, Mail, ShoppingBag, Bike, Percent, MonitorSmartphone, ChefHat, Tablet, Wallet,
  Thermometer, ListChecks, LayoutGrid, ShoppingCart, UsersRound,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, openPicker } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { useAiStatus } from '@/components/ai/ChatView'
import { printHtml } from '@/components/purchasing/shared'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { MODE_LABELS, areaLabel } from '@shared/storeOpening.js'

const BASE = '/ai/store-openings'
const ICONS = { Clock, Table2, Settings, Globe, Mail, ShoppingBag, Bike, Percent, MonitorSmartphone, ChefHat, Tablet, Wallet, Thermometer, ListChecks, LayoutGrid, ShoppingCart, UsersRound }
const STATUS = {
  draft:     { label: 'Not scoped yet', cls: 'bg-muted text-muted-foreground' },
  questions: { label: 'Questions',      cls: 'bg-amber-100 text-amber-900' },
  ready:     { label: 'Brief ready',    cls: 'bg-sky-100 text-sky-900' },
  created:   { label: 'Created',        cls: 'bg-emerald-100 text-emerald-900' },
}
const TIMEZONES = [
  'Europe/London', 'Europe/Dublin', 'Europe/Warsaw', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Stockholm', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney',
]
const EXAMPLES = [
  'A new store in Leeds city centre like our busiest one, about 80 seats, opening 1 December. Two tills, two kiosks, takeaway and delivery.',
  'A small takeaway-only site in a shopping centre food court: counter service, no bookings, three kiosks and a kitchen screen.',
  'Same as our original restaurant but with a terrace of 20 seats, opening in spring. Copy the food safety checks and the team setup.',
]
const WORKING = [
  'Reading your locations',
  'Working out what to copy',
  'Checking what each area needs',
  'Thinking about what to ask',
  'Writing it up',
]

const btn = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg text-sm font-medium touch-manipulation disabled:opacity-50'
const primary = btn + ' bg-primary text-primary-foreground'
const outline = btn + ' border bg-background'
const inp = 'w-full min-h-[44px] border rounded-lg px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 touch-manipulation'

function Card({ title, icon: Icon, extra, children, className, bodyClass }) {
  return (
    <section className={cn('rounded-xl border bg-background overflow-hidden', className)}>
      {title && (
        <div className="section-head px-4 py-3 flex items-center gap-2 flex-wrap">
          {Icon && <Icon className="w-4 h-4 shrink-0" />}
          <h2 className="font-semibold text-sm flex-1 min-w-0">{title}</h2>
          {extra}
        </div>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  )
}

function ErrorLine({ error }) {
  if (!error) return null
  return (
    <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error.message || String(error)}
    </p>
  )
}

/** Pepper at work: a step takes up to a minute. */
function Working({ what }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI(n => Math.min(n + 1, WORKING.length - 1)), 5000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="rounded-xl border bg-background p-6 flex items-center gap-4" role="status" aria-live="polite" data-testid="nl-working">
      <span className="relative flex w-12 h-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="w-6 h-6 animate-pulse" />
      </span>
      <div className="min-w-0">
        <p className="font-medium">{what || ASSISTANT_NAME + ' is working on it'}</p>
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{WORKING[i]}…</p>
        <p className="text-xs text-muted-foreground mt-1">This can take up to a minute.</p>
      </div>
    </div>
  )
}

// ── The list ────────────────────────────────────────────────────

function OpeningList({ openings, current, onNew, canManage }) {
  return (
    <aside className="lg:w-72 shrink-0 space-y-2" data-testid="nl-list">
      {canManage && (
        <button className={cn(primary, 'w-full')} onClick={onNew} data-testid="nl-new">
          <Plus className="w-4 h-4" />New location
        </button>
      )}
      {openings.length === 0 && <p className="text-sm text-muted-foreground px-1">No openings yet.</p>}
      {openings.map(o => (
        <Link key={o.id} to={'/new-location/' + o.id} data-testid="nl-list-item"
          className={cn('block rounded-lg border bg-background px-3 py-2.5 touch-manipulation', current === o.id && 'ring-2 ring-primary')}>
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-sm truncate flex-1">{o.venue_name || o.title}</span>
            {o.busy && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('text-[11px] px-1.5 py-0.5 rounded', STATUS[o.status]?.cls)}>{STATUS[o.status]?.label}</span>
            <span className="text-[11px] text-muted-foreground truncate">{new Date(o.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          </div>
        </Link>
      ))}
    </aside>
  )
}

// ── Starting ────────────────────────────────────────────────────

function StartCard({ venues, readOnly, ai }) {
  const api = useApi()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [input, setInput] = useState('')
  const [template, setTemplate] = useState('')
  const start = useMutation({
    mutationFn: () => api.post(BASE, { input, template_venue_id: template || null }),
    onSuccess: o => {
      qc.setQueryData(['store-opening', o.id], o)
      qc.invalidateQueries({ queryKey: ['store-openings'] })
      nav('/new-location/' + o.id, { state: { error: o.error || null } })
    },
  })
  if (start.isPending) return <Working what={ASSISTANT_NAME + ' is scoping the new location'} />
  const blocked = !ai?.can_chat
  return (
    <div className="space-y-4">
      <Card title={'Open a new location with ' + ASSISTANT_NAME} icon={Sparkles}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Describe the new location in your own words: where it is, what it will be like, when it opens, anything
            that's different from your other locations. {ASSISTANT_NAME} works out what to copy and what to set up
            new, asks only what it needs to, then writes a short brief for you to check before anything is created.
          </p>
          <label className="block">
            <span className="sr-only">Describe the new location</span>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={5} disabled={readOnly || blocked}
              data-testid="nl-input" placeholder="For example: a new store in Leeds city centre like our busiest one, about 80 seats, opening 1 December…"
              className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y" />
          </label>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex, i) => (
              <button key={i} type="button" disabled={readOnly || blocked} onClick={() => setInput(ex)}
                className="text-xs text-left rounded-full border px-3 py-2 bg-muted/40 touch-manipulation max-w-full">
                {ex.length > 70 ? ex.slice(0, 68) + '…' : ex}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block flex-1 min-w-[220px]">
              <span className="text-xs font-medium text-muted-foreground">Copy from</span>
              <select value={template} onChange={e => setTemplate(e.target.value)} className={inp} disabled={readOnly || blocked} data-testid="nl-template">
                <option value="">{ASSISTANT_NAME} picks the most similar location</option>
                {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <button className={primary} disabled={readOnly || blocked || input.trim().length < 10} onClick={() => start.mutate()} data-testid="nl-start">
              <Sparkles className="w-4 h-4" />Scope it with {ASSISTANT_NAME}
            </button>
          </div>
          {blocked && ai && (
            <p className="text-sm text-muted-foreground">
              {!ai.configured ? ASSISTANT_NAME + ' isn\'t set up on this server yet.' : !ai.enabled ? ASSISTANT_NAME + ' is switched off for your group (' + ASSISTANT_NAME + ' > Settings).' : 'Your role doesn\'t have access to ' + ASSISTANT_NAME + '.'}
            </p>
          )}
          <ErrorLine error={start.error} />
        </div>
      </Card>
      <Card title="How it works" icon={Store}>
        <ol className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
          {[
            ['Describe it', 'A few sentences are enough. Mention the location it should be like.'],
            [ASSISTANT_NAME + ' scopes it', 'Area by area: copy, set up new or leave for later. You can change any of it.'],
            ['Answer a few questions', 'Only where the answer changes the setup. Leave any to ' + ASSISTANT_NAME + '.'],
            ['Check the brief, create', 'One press makes the location, then you get a list of what\'s left to do on site.'],
          ].map(([t, d], i) => (
            <li key={i} className="rounded-lg border bg-muted/30 p-3">
              <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">{i + 1}</span>
              <p className="font-medium mt-2">{t}</p>
              <p className="text-muted-foreground text-xs mt-0.5">{d}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}

// ── Steps ───────────────────────────────────────────────────────

function Stepper({ status }) {
  const steps = [['draft', 'Describe'], ['questions', 'Questions'], ['ready', 'Brief'], ['created', 'Created']]
  const at = steps.findIndex(s => s[0] === status)
  return (
    <ol className="flex items-center gap-1 text-xs overflow-x-auto" aria-label="Steps">
      {steps.map(([key, label], i) => (
        <li key={key} className="flex items-center gap-1 shrink-0">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 border',
            i < at ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : i === at ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>
            {i < at ? <Check className="w-3 h-3" /> : <span className="tabular-nums">{i + 1}</span>}{label}
          </span>
          {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        </li>
      ))}
    </ol>
  )
}

// ── Questions ───────────────────────────────────────────────────

function initialAnswers(questions) {
  return Object.fromEntries(questions.map(q => [q.id, q.suggested || '']))
}

function QuestionInput({ q, value, onChange, disabled }) {
  if (q.kind === 'choice' || q.kind === 'yesno') {
    const options = q.kind === 'yesno' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : q.options
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.text}>
        {options.map(o => {
          const on = value === o.value
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(on ? '' : o.value)}
              className={cn('min-h-[44px] px-3 rounded-lg border text-sm text-left touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
              {o.label}{q.suggested === o.value && <span className={cn('ml-1.5 text-[10px] uppercase tracking-wide', on ? 'opacity-80' : 'text-primary')}>Suggested</span>}
            </button>
          )
        })}
      </div>
    )
  }
  if (q.kind === 'multi') {
    const picked = value ? value.split(' | ') : []
    return (
      <div className="flex flex-wrap gap-2">
        {q.options.map(o => {
          const on = picked.includes(o.value)
          return (
            <button key={o.value} type="button" aria-pressed={on} disabled={disabled}
              onClick={() => onChange((on ? picked.filter(x => x !== o.value) : [...picked, o.value]).join(' | '))}
              className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation inline-flex items-center gap-1.5', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
              {on && <Check className="w-3.5 h-3.5" />}{o.label}
            </button>
          )
        })}
      </div>
    )
  }
  if (q.kind === 'date') {
    return (
      <span className="relative inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg border bg-background text-sm touch-manipulation">
        {value || 'Pick a date'}
        <input type="date" value={value || ''} onClick={openPicker} onChange={e => onChange(e.target.value)} disabled={disabled}
          aria-label={q.text} className="absolute inset-0 opacity-0 cursor-pointer" />
      </span>
    )
  }
  if (q.kind === 'time') {
    return <input type="time" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} aria-label={q.text} className={cn(inp, 'w-40')} />
  }
  if (q.kind === 'number') {
    return <input type="text" inputMode="decimal" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} aria-label={q.text} placeholder={q.suggested || ''} className={cn(inp, 'w-40')} />
  }
  return <textarea value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} aria-label={q.text} rows={2} placeholder={q.suggested || ''}
    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40" />
}

function QuestionsCard({ opening, onAnswer, readOnly }) {
  const [answers, setAnswers] = useState(() => initialAnswers(opening.questions))
  const [leave, setLeave] = useState({})
  useEffect(() => { setAnswers(initialAnswers(opening.questions)); setLeave({}) }, [opening.questions])
  const byArea = useMemo(() => {
    const m = new Map()
    for (const q of opening.questions) (m.get(q.area) || m.set(q.area, []).get(q.area)).push(q)
    return [...m.entries()]
  }, [opening.questions])
  const send = all => onAnswer(Object.fromEntries(opening.questions.map(q => [q.id, all || leave[q.id] ? '' : (answers[q.id] || '')])))
  return (
    <Card title={ASSISTANT_NAME + '\'s questions'} icon={MessageSquareText}
      extra={<span className="text-xs text-muted-foreground">Round {Math.max(1, opening.rounds)} of {opening.max_rounds}</span>}>
      <div className="space-y-5" data-testid="nl-questions">
        {byArea.map(([area, qs]) => (
          <div key={area} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{areaLabel(area)}</h3>
            {qs.map(q => (
              <div key={q.id} className="rounded-lg border p-3 space-y-2" data-testid="nl-question" data-kind={q.kind}>
                <p className="font-medium text-sm">{q.text}</p>
                {q.why && <p className="text-xs text-muted-foreground">{q.why}</p>}
                <div className={cn(leave[q.id] && 'opacity-40 pointer-events-none')}>
                  <QuestionInput q={q} value={answers[q.id]} onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))} disabled={readOnly} />
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground min-h-[32px] touch-manipulation">
                  <input type="checkbox" checked={!!leave[q.id]} disabled={readOnly} onChange={e => setLeave(l => ({ ...l, [q.id]: e.target.checked }))} className="w-4 h-4" />
                  Leave it to {ASSISTANT_NAME}
                </label>
              </div>
            ))}
          </div>
        ))}
        {!readOnly && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button className={primary} onClick={() => send(false)} data-testid="nl-send-answers"><Check className="w-4 h-4" />Send answers</button>
            <button className={outline} onClick={() => send(true)} data-testid="nl-skip-questions">Skip these: write the brief</button>
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Areas ───────────────────────────────────────────────────────

const RESULT_ICON = { done: CircleCheck, skipped: CircleDashed, no_access: CircleSlash }

function AreaCard({ area, hasTemplate, onMode, onDeepDive, readOnly, created }) {
  const Icon = ICONS[area.icon] || Store
  const r = area.result
  const RIcon = r ? RESULT_ICON[r.status] || CircleDashed : null
  return (
    <div className={cn('rounded-xl border bg-background p-3 flex flex-col gap-2', area.mode === 'skip' && !created && 'bg-muted/30')} data-testid="nl-area" data-area={area.key} data-mode={area.mode}>
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        <h3 className="font-medium text-sm flex-1 min-w-0">{area.label}</h3>
        {area.deep_dive && !created && <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-amber-100 text-amber-900">Worth a closer look</span>}
        {RIcon && <RIcon className={cn('w-4 h-4 shrink-0', r.status === 'done' ? 'text-emerald-600' : 'text-muted-foreground')} aria-label={r.status} />}
      </div>
      {!created && (
        <div className="flex rounded-lg border overflow-hidden" role="radiogroup" aria-label={area.label + ': how to set it up'}>
          {area.modes.map(m => {
            const on = area.mode === m
            const off = readOnly || !area.can_set_up || (m === 'copy' && !hasTemplate)
            return (
              <button key={m} type="button" role="radio" aria-checked={on} disabled={off || on} onClick={() => onMode(area.key, m)}
                data-testid="nl-mode" data-value={m}
                className={cn('flex-1 min-h-[40px] text-xs font-medium touch-manipulation border-l first:border-l-0', on ? 'bg-primary text-primary-foreground' : 'bg-background', off && !on && 'text-muted-foreground/60')}>
                {m === 'skip' ? 'Later' : m === 'new' ? 'New' : MODE_LABELS[m]}
              </button>
            )
          })}
        </div>
      )}
      <p className="text-sm">{created && r ? (r.lines?.length ? r.lines.join('. ') + '.' : r.status === 'skipped' ? 'Left for later.' : '') : area.preview}</p>
      {!created && area.note && <p className="text-xs text-muted-foreground flex gap-1.5"><Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />{area.note}</p>}
      {!created && !area.can_set_up && <p className="text-xs text-muted-foreground flex gap-1.5"><Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />Your role can't set this up: it's left for someone who can.</p>}
      {!created && !readOnly && area.can_set_up && area.mode !== 'skip' && (
        <button type="button" onClick={() => onDeepDive(area.key)} className="self-start text-xs text-primary inline-flex items-center gap-1 min-h-[32px] touch-manipulation" data-testid="nl-deep-dive">
          <Search className="w-3.5 h-3.5" />Ask {ASSISTANT_NAME} about this
        </button>
      )}
    </div>
  )
}

function AreaBoard({ opening, onMode, onDeepDive, readOnly }) {
  const created = opening.status === 'created'
  const counts = opening.areas.reduce((m, a) => ({ ...m, [a.mode]: (m[a.mode] || 0) + 1 }), {})
  return (
    <Card title={created ? 'What was set up' : 'Scope'} icon={LayoutGrid}
      extra={!created && <span className="text-xs text-muted-foreground">{counts.copy || 0} copied · {counts.new || 0} new · {counts.skip || 0} later</span>}>
      {opening.template && !created && (
        <p className="text-sm text-muted-foreground mb-3">Copying from <span className="font-medium text-foreground">{opening.template.name}</span>. Change any area below; your choice always wins.</p>
      )}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="nl-areas">
        {opening.areas.map(a => (
          <AreaCard key={a.key} area={a} hasTemplate={!!opening.plan.template_venue_id} onMode={onMode} onDeepDive={onDeepDive} readOnly={readOnly} created={created} />
        ))}
      </div>
    </Card>
  )
}

// ── Details ─────────────────────────────────────────────────────

function DetailsCard({ opening, venues, onSave, readOnly, saving }) {
  const p = opening.plan
  const fresh = () => ({
    name: p.venue.name, slug: p.venue.slug, timezone: p.venue.timezone, currency: p.venue.currency,
    opening_date: p.opening_date || '', template_venue_id: p.template_venue_id || '',
    ...Object.fromEntries(['address_line1', 'address_line2', 'city', 'postcode', 'country', 'phone', 'email'].map(k => [k, p.location[k] || ''])),
  })
  const [f, setF] = useState(fresh)
  useEffect(() => { setF(fresh()) }, [opening.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const before = fresh()
  const dirty = Object.keys(f).some(k => f[k] !== before[k])
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const save = () => {
    const venue = {}, location = {}, overrides = {}
    for (const k of ['name', 'slug', 'timezone', 'currency']) if (f[k] !== before[k]) venue[k] = k === 'currency' ? f[k].toUpperCase() : f[k]
    for (const k of ['address_line1', 'address_line2', 'city', 'postcode', 'country', 'phone', 'email']) if (f[k] !== before[k]) location[k] = f[k]
    if (Object.keys(venue).length) overrides.venue = venue
    if (Object.keys(location).length) overrides.location = location
    if (f.opening_date !== before.opening_date) overrides.opening_date = f.opening_date || null
    if (f.template_venue_id !== before.template_venue_id) overrides.template_venue_id = f.template_venue_id || null
    onSave({ overrides })
  }
  const field = (k, label, props = {}) => (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input value={f[k]} onChange={set(k)} disabled={readOnly} className={inp} {...props} />
    </label>
  )
  const zones = TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES]
  return (
    <Card title="The location" icon={Store}>
      <div className="grid sm:grid-cols-2 gap-3" data-testid="nl-details">
        {field('name', 'Name')}
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Web address</span>
          <input value={f.slug} onChange={set('slug')} disabled={readOnly} className={inp} />
          {p.venue.slug_final && p.venue.slug_final !== p.venue.slug && <span className="text-xs text-muted-foreground">Already used: it will be <span className="font-mono">{p.venue.slug_final}</span></span>}
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Time zone</span>
          <select value={f.timezone} onChange={set('timezone')} disabled={readOnly} className={inp}>
            {zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {field('currency', 'Currency', { maxLength: 3 })}
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Opening date</span>
            <span className="relative flex items-center gap-2 min-h-[44px] px-3 rounded-lg border bg-background text-sm touch-manipulation">
              <span className="flex-1">{f.opening_date || 'Not set'}</span>
              {f.opening_date && !readOnly && <button type="button" onClick={() => setF(x => ({ ...x, opening_date: '' }))} className="relative z-10 p-1" aria-label="Clear the date"><X className="w-4 h-4" /></button>}
              <input type="date" value={f.opening_date} onClick={openPicker} onChange={set('opening_date')} disabled={readOnly} aria-label="Opening date"
                className="absolute inset-0 opacity-0 cursor-pointer" />
            </span>
          </label>
        </div>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Copy from</span>
          <select value={f.template_venue_id} onChange={set('template_venue_id')} disabled={readOnly} className={inp} data-testid="nl-details-template">
            <option value="">Nothing: set areas up new</option>
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        {field('address_line1', 'Address')}
        {field('address_line2', 'Address line 2')}
        {field('city', 'Town or city')}
        {field('postcode', 'Postcode')}
        {field('country', 'Country')}
        {field('phone', 'Phone', { type: 'tel', inputMode: 'tel' })}
        <div className="sm:col-span-2">{field('email', 'Email', { type: 'email' })}</div>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap gap-2 mt-3">
          <button className={primary} disabled={!dirty || saving} onClick={save} data-testid="nl-details-save">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Save</button>
          {dirty && <button className={outline} onClick={() => setF(before)}>Discard</button>}
        </div>
      )}
    </Card>
  )
}

// ── Brief ───────────────────────────────────────────────────────

function List({ title, items, icon: Icon, tone }) {
  if (!items?.length) return null
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</h3>
      <ul className="space-y-1">
        {items.map((t, i) => <li key={i} className="flex gap-2 text-sm"><Icon className={cn('w-4 h-4 shrink-0 mt-0.5', tone)} />{t}</li>)}
      </ul>
    </div>
  )
}

function briefHtml(o) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const p = o.plan, b = o.brief || {}
  const addr = [p.location.address_line1, p.location.address_line2, p.location.city, p.location.postcode, p.location.country].filter(Boolean).join(', ')
  const list = (title, items) => items?.length ? '<h2>' + esc(title) + '</h2><ul>' + items.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : ''
  const created = o.status === 'created'
  const rows = o.areas.map(a => '<tr><th>' + esc(a.label) + '</th><td>' + esc(created && a.result
    ? (a.result.lines?.length ? a.result.lines.join('. ') + '.' : 'Left for later.')
    : a.preview) + '</td></tr>').join('')
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(b.headline || o.title) + '</title><style>'
    + 'body{font:13px/1.5 system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#111;margin:18mm}h1{font-size:22px;margin:0 0 4px}'
    + 'h2{font-size:14px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:#555}.meta{color:#555;margin:0 0 12px}'
    + 'table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #ddd}th{width:30%;font-weight:600}'
    + 'ul{margin:0;padding-left:18px}li{margin:2px 0}.done{color:#555}@page{margin:12mm}</style></head><body>'
    + '<h1>' + esc(b.headline || o.title) + '</h1>'
    + '<p class="meta">' + esc([p.venue.name, addr, p.opening_date ? 'Opens ' + p.opening_date : '', o.template ? 'Copied from ' + o.template.name : ''].filter(Boolean).join(' · ')) + '</p>'
    + (b.summary ? '<p>' + esc(b.summary) + '</p>' : '')
    + list('Highlights', b.highlights)
    + '<h2>' + (created ? 'What was set up' : 'What will be set up') + '</h2><table>' + rows + '</table>'
    + list('Assumptions', b.assumptions) + list('Risks', b.risks)
    + (created && o.followups?.length
      ? '<h2>Still to do</h2><ul>' + o.followups.map(f => '<li class="' + (f.done ? 'done' : '') + '">' + (f.done ? '&#10003; ' : '') + esc(f.text) + '</li>').join('') + '</ul>'
      : list('Still to do', b.followups))
    + '<p class="meta" style="margin-top:20px">Prepared with ' + esc(ASSISTANT_NAME) + ' on ' + new Date().toLocaleDateString('en-GB') + '</p>'
    + '</body></html>'
}

function BriefCard({ opening, onChange, onCreate, readOnly, creating }) {
  const [change, setChange] = useState('')
  const [confirm, setConfirm] = useState(false)
  const b = opening.brief || {}
  const counts = opening.areas.filter(a => a.mode !== 'skip' && a.can_set_up).length
  const created = opening.status === 'created'
  return (
    <Card title={created ? 'The brief' : 'Brief'} icon={Sparkles}
      extra={<button className={cn(outline, 'min-h-[36px] px-3')} onClick={() => printHtml(briefHtml(opening))} data-testid="nl-print"><Printer className="w-4 h-4" />Print</button>}>
      <div className="space-y-4" data-testid="nl-brief">
        <div>
          <p className="text-lg font-semibold leading-snug">{b.headline || opening.title}</p>
          {b.summary && <p className="text-sm text-muted-foreground mt-1">{b.summary}</p>}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <List title="Highlights" items={b.highlights} icon={Check} tone="text-emerald-600" />
          <List title="Assumptions" items={b.assumptions} icon={Sparkles} tone="text-primary" />
          <List title="Risks" items={b.risks} icon={AlertTriangle} tone="text-amber-600" />
          {!created && <List title="For people to do" items={b.followups} icon={ChevronRight} tone="text-muted-foreground" />}
        </div>
        {opening.problems?.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
            {opening.problems.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        )}
        {!created && !readOnly && (
          <>
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Ask {ASSISTANT_NAME} for a change</span>
                <textarea value={change} onChange={e => setChange(e.target.value)} rows={2} data-testid="nl-change"
                  placeholder="For example: don't copy the kitchen flows, the kitchen there is different"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </label>
              <button className={outline} disabled={change.trim().length < 3} onClick={() => { onChange(change.trim()); setChange('') }} data-testid="nl-change-send">
                <MessageSquareText className="w-4 h-4" />Ask for this change
              </button>
            </div>
            <div className="border-t pt-4">
              {!confirm ? (
                <button className={primary} disabled={!opening.can.create || creating} onClick={() => setConfirm(true)} data-testid="nl-create">
                  <Store className="w-4 h-4" />Create {opening.plan.venue.name}
                </button>
              ) : (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="nl-create-confirm">
                  <p className="text-sm">
                    Create <span className="font-semibold">{opening.plan.venue.name}</span> now and set up {counts} {counts === 1 ? 'area' : 'areas'}?
                    {opening.plan.opening_date ? ' It stays closed for bookings until ' + opening.plan.opening_date + '.' : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button className={primary} disabled={creating} onClick={onCreate} data-testid="nl-create-yes">
                      {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Yes, create it
                    </button>
                    <button className={outline} disabled={creating} onClick={() => setConfirm(false)}>Not yet</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

// ── After creating ──────────────────────────────────────────────

function CreatedCard({ opening, onTick, readOnly }) {
  const left = opening.followups.filter(f => !f.done).length
  return (
    <Card title="Still to do" icon={ListChecks} extra={<span className="text-xs text-muted-foreground">{left} of {opening.followups.length} left</span>}>
      <div className="space-y-3" data-testid="nl-followups">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 text-sm flex items-start gap-2">
          <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold">{opening.venue?.name}</span> was created
            {opening.opened_at ? ' on ' + new Date(opening.opened_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : ''}.
            {' '}It's now in every location picker. <Link to="/venues" className="underline">Venues</Link>
          </span>
        </div>
        <ul className="space-y-2">
          {opening.followups.map(f => (
            <li key={f.key} className="flex items-start gap-3 rounded-lg border px-3 py-2" data-testid="nl-followup" data-done={f.done ? '1' : '0'}>
              <button type="button" role="checkbox" aria-checked={!!f.done} disabled={readOnly} onClick={() => onTick(f.key, !f.done)}
                className={cn('w-7 h-7 shrink-0 rounded-md border flex items-center justify-center touch-manipulation', f.done && 'bg-emerald-600 border-emerald-600 text-white')}
                aria-label={(f.done ? 'Not done: ' : 'Done: ') + f.text}>
                {f.done && <Check className="w-4 h-4" />}
              </button>
              <span className={cn('text-sm flex-1', f.done && 'line-through text-muted-foreground')}>{f.text}</span>
              {f.link && <Link to={f.link} className="shrink-0 text-primary inline-flex items-center gap-1 text-xs min-h-[28px]">Open<ExternalLink className="w-3 h-3" /></Link>}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function HistoryCard({ opening }) {
  const [open, setOpen] = useState(false)
  if (!opening.history.length) return null
  const qText = new Map(opening.history.flatMap(h => h.questions.map(q => [q.id, q.text])))
  const KIND = { scope: 'First look', answers: 'Answers', deep_dive: 'Closer look', change: 'Change asked for' }
  return (
    <section className="rounded-xl border bg-background">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 min-h-[48px] text-sm font-medium touch-manipulation" aria-expanded={open}>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}How we got here
        <span className="text-xs text-muted-foreground font-normal">({opening.history.length} {opening.history.length === 1 ? 'step' : 'steps'})</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm">
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground mb-1">What was asked for</p><p className="whitespace-pre-wrap">{opening.input}</p></div>
          {opening.history.map((h, i) => (
            <div key={i} className="border-l-2 pl-3">
              <p className="text-xs text-muted-foreground">{KIND[h.kind] || h.kind}{h.area ? ': ' + areaLabel(h.area) : ''} · {new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{h.by ? ' · ' + h.by : ''}</p>
              {h.request && <p>"{h.request}"</p>}
              {h.answers && Object.entries(h.answers).map(([id, v]) => <p key={id}><span className="text-muted-foreground">{qText.get(id) || id}</span> {v || <em>left to {ASSISTANT_NAME}</em>}</p>)}
              {h.summary && <p className="text-muted-foreground italic">{h.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── One opening ─────────────────────────────────────────────────

function OpeningView({ id, venues, readOnly }) {
  const api = useApi()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [title, setTitle] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data: o, error, isLoading } = useQuery({
    queryKey: ['store-opening', id],
    queryFn: () => api.get(`${BASE}/${id}`),
    refetchInterval: q => (q.state.data?.busy ? 3000 : false),
  })
  // The first look's error, when it failed (StartCard passes it on).
  const startError = useLocation().state?.error || null
  const done = data => {
    qc.setQueryData(['store-opening', id], data)
    qc.invalidateQueries({ queryKey: ['store-openings'] })
  }
  const step = useMutation({ mutationFn: ({ path, body }) => api.post(`${BASE}/${id}/${path}`, body), onSuccess: done })
  const patch = useMutation({ mutationFn: body => api.patch(`${BASE}/${id}`, body), onSuccess: done })
  const create = useMutation({ mutationFn: () => api.post(`${BASE}/${id}/create`, {}), onSuccess: d => { done(d); qc.invalidateQueries({ queryKey: ['venues'] }); qc.invalidateQueries({ queryKey: ['me'] }) } })
  const tick = useMutation({ mutationFn: ({ key, value }) => api.patch(`${BASE}/${id}/followups/${encodeURIComponent(key)}`, { done: value }), onSuccess: done })
  const remove = useMutation({
    mutationFn: () => api.delete(`${BASE}/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-openings'] }); nav('/new-location') },
  })

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
  if (error) return <ErrorLine error={error} />
  if (!o) return null
  const working = step.isPending || o.busy
  const created = o.status === 'created'
  const lastError = step.error || patch.error || create.error

  return (
    <div className="space-y-4 min-w-0" data-testid="nl-opening" data-status={o.status}>
      <div className="rounded-xl border bg-background p-4 space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            {title === null ? (
              <h2 className="text-lg font-semibold flex items-center gap-2 flex-wrap" data-testid="nl-title">
                {o.title}
                {!created && !readOnly && <button type="button" onClick={() => setTitle(o.title)} className="p-1.5 rounded touch-manipulation" aria-label="Rename"><Pencil className="w-4 h-4 text-muted-foreground" /></button>}
              </h2>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input value={title} onChange={e => setTitle(e.target.value)} className={cn(inp, 'max-w-sm')} aria-label="Working title" autoFocus />
                <button className={primary} disabled={!title.trim()} onClick={() => patch.mutate({ title: title.trim() }, { onSuccess: () => setTitle(null) })}>Save</button>
                <button className={outline} onClick={() => setTitle(null)}>Cancel</button>
              </div>
            )}
            {o.summary && <p className="text-sm text-muted-foreground mt-1 flex gap-1.5"><Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-primary" />{o.summary}</p>}
          </div>
          <span className={cn('text-xs px-2 py-1 rounded', STATUS[o.status]?.cls)}>{STATUS[o.status]?.label}</span>
        </div>
        <Stepper status={o.status} />
      </div>

      <ErrorLine error={lastError} />
      {working && <Working what={step.variables?.path === 'deep-dive' ? ASSISTANT_NAME + ' is taking a closer look' : step.variables?.path === 'change' ? ASSISTANT_NAME + ' is making the change' : undefined} />}

      {o.status === 'draft' && !working && (
        <Card title={ASSISTANT_NAME + ' couldn\'t scope this yet'} icon={AlertTriangle}>
          <p className="text-sm mb-3">{startError || 'Something went wrong the first time.'} What was asked for:</p>
          <p className="text-sm rounded-lg bg-muted/40 p-3 whitespace-pre-wrap mb-3">{o.input}</p>
          {!readOnly && <button className={primary} onClick={() => step.mutate({ path: 'scope' })} data-testid="nl-retry"><RotateCcw className="w-4 h-4" />Try again</button>}
        </Card>
      )}

      {!working && o.status === 'questions' && (
        <QuestionsCard opening={o} readOnly={readOnly} onAnswer={answers => step.mutate({ path: 'answers', body: { answers } })} />
      )}

      {o.status !== 'draft' && (
        <>
          {created && <CreatedCard opening={o} readOnly={readOnly} onTick={(key, value) => tick.mutate({ key, value })} />}
          {(o.status === 'ready' || created) && !working && (
            <BriefCard opening={o} readOnly={readOnly} creating={create.isPending}
              onChange={request => step.mutate({ path: 'change', body: { request } })}
              onCreate={() => create.mutate()} />
          )}
          <AreaBoard opening={o} readOnly={readOnly || working}
            onMode={(key, mode) => patch.mutate({ overrides: { modes: { [key]: mode } } })}
            onDeepDive={area => step.mutate({ path: 'deep-dive', body: { area } })} />
          {!created && <DetailsCard opening={o} venues={venues} readOnly={readOnly || working} saving={patch.isPending} onSave={body => patch.mutate(body)} />}
        </>
      )}

      <HistoryCard opening={o} />

      {!created && !readOnly && (
        <div className="flex justify-end">
          {!confirmDelete ? (
            <button className={cn(outline, 'text-red-700')} onClick={() => setConfirmDelete(true)} data-testid="nl-delete"><Trash2 className="w-4 h-4" />Delete this draft</button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
              <span>Delete "{o.title}"? Nothing has been created yet.</span>
              <button className={cn(btn, 'bg-red-600 text-white')} onClick={() => remove.mutate()} data-testid="nl-delete-yes">Delete</button>
              <button className={outline} onClick={() => setConfirmDelete(false)}>Keep it</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────

export default function NewLocation() {
  const api = useApi()
  const nav = useNavigate()
  const { id } = useParams()
  const { canManage, loaded } = usePermission('venues')
  const { data: ai } = useAiStatus()
  const { data: openings = [] } = useQuery({ queryKey: ['store-openings'], queryFn: () => api.get(BASE) })
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const readOnly = loaded && !canManage
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="new-location">
      <div className="flex items-center gap-3 px-4 lg:px-6 h-14 border-b shrink-0 bg-background max-lg:notouch:pl-14">
        {id && <button type="button" onClick={() => nav('/new-location')} className="p-2 -ml-2 rounded-lg touch-manipulation lg:hidden" aria-label="All openings"><ArrowLeft className="w-5 h-5" /></button>}
        <Store className="w-5 h-5 text-primary" />
        <h1 className="font-semibold truncate">New location</h1>
        <span className="text-xs text-muted-foreground hidden sm:inline">with {ASSISTANT_NAME}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 lg:p-6 flex flex-col lg:flex-row gap-4 lg:gap-6 max-w-[1400px]">
          <div className={cn(id && 'hidden lg:block')}>
            <OpeningList openings={openings} current={id} canManage={canManage} onNew={() => nav('/new-location')} />
          </div>
          <main className="flex-1 min-w-0 space-y-4">
            {readOnly && <ReadOnlyNotice what="new locations" />}
            {id ? <OpeningView key={id} id={id} venues={venues} readOnly={readOnly} /> : <StartCard venues={venues} readOnly={readOnly} ai={ai} />}
          </main>
        </div>
      </div>
    </div>
  )
}
