// src/components/home/TaskActions.jsx
//
// The task store on Home and the phone's Today (Pepper-first step 5b,
// migration 278, POST /api/ops/tasks): under a task, More opens its actions,
// each with its own Save (Standard Design Rule 5):
//   Assign   pick a team member who can do it (GET /api/ops/tasks/people)
//   Snooze   a preset (shared/todayTasks.js SNOOZE_PRESETS) or a time today
//   Skip     a reason is required: one of SKIP_REASONS or the person's own
//            words (decision 7)
//   Done     only the kinds the feed can't see finish (MANUAL_DONE_KINDS)
// SetAside lists what is off today's list (skipped, snoozed, done by hand)
// with Bring back. SkippedToday is Home's small card of the day's skips by
// site for managers (GET /api/ops/skips; never who skipped: decision 8).

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, UserRound, AlarmClock, SkipForward, CheckCircle2, X, Loader2, Undo2, Ban } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SNOOZE_PRESETS, SKIP_REASONS, MANUAL_DONE_KINDS, REASON_MAX } from '@shared/todayTasks.js'

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-md text-sm font-medium touch-manipulation'
const CHIP = 'inline-flex items-center min-h-[48px] px-3 rounded-full border text-sm touch-manipulation'

/** Sends one change to a task and refreshes the feed. */
function useTaskChange(d) {
  const api = useApi()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function send(body) {
    setBusy(true); setError(null)
    try {
      await api.post('/ops/tasks', { venue_id: d.venue.id, date: d.date, ...body })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['ops-today'] }),
        qc.invalidateQueries({ queryKey: ['ops-skips'] }),
      ])
      return true
    } catch (e) {
      setError(e?.message || 'Couldn\'t save that')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { send, busy, error }
}

/** Who a task is given to, on its row. */
export function TaskOwner({ owner }) {
  if (!owner) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs rounded-full border bg-muted/50 px-2 py-0.5 mt-1" data-testid="today-task-owner">
      <UserRound className="w-3.5 h-3.5" aria-hidden="true" /> {owner.me ? 'You' : owner.name}
    </span>
  )
}

/** The More button on a task row; `open` and `onToggle` come from the row. */
export function TaskMoreButton({ open, onToggle }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label="More for this task" data-testid="today-task-more"
      className={cn('w-12 h-12 shrink-0 rounded-md border flex items-center justify-center hover:bg-accent touch-manipulation', open && 'bg-accent')}>
      <MoreHorizontal className="w-5 h-5" />
    </button>
  )
}

/** The actions under a task: Assign, Snooze, Skip (and Done where it applies), each saved on its own. */
export function TaskActions({ t, d, onClose }) {
  const [mode, setMode] = useState(null)
  const manualDone = MANUAL_DONE_KINDS.includes(t.kind)
  const change = useTaskChange(d)
  const tabs = [
    { key: 'assign', label: 'Assign', Icon: UserRound },
    ...(d.is_today ? [{ key: 'snooze', label: 'Snooze', Icon: AlarmClock }] : []),
    { key: 'skip', label: 'Skip', Icon: SkipForward },
    ...(manualDone ? [{ key: 'done', label: 'Mark done', Icon: CheckCircle2 }] : []),
  ]
  const finish = ok => { if (ok) onClose() }
  return (
    <div className="w-full rounded-md border bg-muted/30 p-3 space-y-3" data-testid="today-task-actions">
      <div className="flex flex-wrap gap-2">
        {tabs.map(x => (
          <button key={x.key} type="button" onClick={() => setMode(mode === x.key ? null : x.key)} data-testid={'today-task-' + x.key}
            aria-pressed={mode === x.key}
            className={cn(BTN, 'border', mode === x.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
            <x.Icon className="w-4 h-4" /> {x.label}
          </button>
        ))}
        <button type="button" onClick={onClose} aria-label="Close" className={cn(BTN, 'ml-auto px-3 hover:bg-accent')}>
          <X className="w-4 h-4" />
        </button>
      </div>
      {mode === 'assign' && <AssignForm t={t} d={d} change={change} onDone={finish} />}
      {mode === 'snooze' && <SnoozeForm t={t} change={change} onDone={finish} />}
      {mode === 'skip' && <SkipForm t={t} change={change} onDone={finish} />}
      {mode === 'done' && <DoneForm t={t} change={change} onDone={finish} />}
      {change.error && <p className="text-sm text-red-700" role="alert" data-testid="today-task-error">{change.error}</p>}
    </div>
  )
}

function SaveButton({ busy, disabled, onClick, label = 'Save', testId }) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} data-testid={testId}
      className={cn(BTN, 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50')}>
      {busy && <Loader2 className="w-4 h-4 animate-spin" />} {label}
    </button>
  )
}

function AssignForm({ t, d, change, onDone }) {
  const api = useApi()
  const people = useQuery({
    queryKey: ['ops-task-people', d.venue.id, d.date, t.key],
    queryFn: () => api.get('/ops/tasks/people?venue_id=' + d.venue.id + '&date=' + d.date + '&key=' + encodeURIComponent(t.key)),
    staleTime: 60_000,
  })
  const [pick, setPick] = useState(t.owner?.id || '')
  const list = people.data?.people || []
  return (
    <div className="space-y-2" data-testid="today-assign">
      <label className="block text-sm font-medium" htmlFor={'assign-' + t.key}>Who does it</label>
      {people.isLoading ? <p className="text-sm text-muted-foreground">Loading the team...</p> : (
        <select id={'assign-' + t.key} value={pick} onChange={e => setPick(e.target.value)} data-testid="today-assign-pick"
          className="w-full h-12 rounded-md border bg-background px-2 text-sm touch-manipulation">
          <option value="">Nobody (clear)</option>
          {list.map(p => <option key={p.id} value={p.id}>{p.me ? p.name + ' (you)' : p.name}</option>)}
        </select>
      )}
      {people.error && <p className="text-sm text-red-700">{people.error.message}</p>}
      <p className="text-xs text-muted-foreground">Only people whose role can do this task are listed.</p>
      <SaveButton busy={change.busy} disabled={pick === (t.owner?.id || '')} testId="today-assign-save"
        onClick={async () => onDone(await change.send({ key: t.key, action: 'assign', owner_id: pick || null }))} />
    </div>
  )
}

function SnoozeForm({ t, change, onDone }) {
  const [preset, setPreset] = useState(null)
  const [until, setUntil] = useState('')
  const ready = !!preset || /^\d{2}:\d{2}$/.test(until)
  return (
    <div className="space-y-2" data-testid="today-snooze">
      <p className="text-sm font-medium">Hide it from today&apos;s list for</p>
      <div className="flex flex-wrap gap-2">
        {SNOOZE_PRESETS.map(p => (
          <button key={p.key} type="button" aria-pressed={preset === p.key} data-testid={'today-snooze-' + p.key}
            onClick={() => { setPreset(preset === p.key ? null : p.key); setUntil('') }}
            className={cn(CHIP, preset === p.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span>or until</span>
        <input type="time" value={until} onChange={e => { setUntil(e.target.value); setPreset(null) }} data-testid="today-snooze-until"
          className="h-12 rounded-md border bg-background px-2 text-sm touch-manipulation" />
      </label>
      <SaveButton busy={change.busy} disabled={!ready} label="Snooze" testId="today-snooze-save"
        onClick={async () => {
          const p = SNOOZE_PRESETS.find(x => x.key === preset)
          onDone(await change.send({ key: t.key, action: 'snooze', ...(p ? { minutes: p.minutes } : { until }) }))
        }} />
    </div>
  )
}

function SkipForm({ t, change, onDone }) {
  const [choice, setChoice] = useState(null)
  const [own, setOwn] = useState('')
  const reason = (choice === 'own' ? own : choice || '').replace(/\s+/g, ' ').trim()
  return (
    <div className="space-y-2" data-testid="today-skip">
      <p className="text-sm font-medium">Why is it being skipped today? {t.compliance && <span className="text-muted-foreground font-normal">(kept with the day&apos;s records)</span>}</p>
      <div className="flex flex-wrap gap-2">
        {[...SKIP_REASONS, 'own'].map(r => (
          <button key={r} type="button" aria-pressed={choice === r} data-testid="today-skip-reason"
            onClick={() => setChoice(choice === r ? null : r)}
            className={cn(CHIP, choice === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
            {r === 'own' ? 'Something else' : r}
          </button>
        ))}
      </div>
      {choice === 'own' && (
        <textarea value={own} onChange={e => setOwn(e.target.value)} maxLength={REASON_MAX} rows={2} data-testid="today-skip-own"
          placeholder="Say why" className="w-full rounded-md border bg-background px-3 py-2 text-sm touch-manipulation" />
      )}
      <SaveButton busy={change.busy} disabled={!reason} label="Skip for today" testId="today-skip-save"
        onClick={async () => onDone(await change.send({ key: t.key, action: 'skip', reason }))} />
    </div>
  )
}

function DoneForm({ t, change, onDone }) {
  return (
    <div className="space-y-2" data-testid="today-done">
      <p className="text-sm">Mark it done for today. It comes back if it is still there tomorrow.</p>
      <SaveButton busy={change.busy} label="Mark done" testId="today-done-save"
        onClick={async () => onDone(await change.send({ key: t.key, action: 'done' }))} />
    </div>
  )
}

const ASIDE_WORDS = { skipped: 'Skipped', snoozed: 'Snoozed', done: 'Done' }
const UNDO = { skipped: 'unskip', snoozed: 'unsnooze', done: 'undone' }

/** What is off today's list: skipped (with why), snoozed (until when), done by hand; each can be brought back. */
export function SetAside({ d }) {
  const change = useTaskChange(d)
  const [open, setOpen] = useState(false)
  const list = d.aside || []
  if (!list.length) return null
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="today-aside">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="today-aside-toggle"
        className="w-full section-head px-4 min-h-[48px] flex items-center gap-2 text-left touch-manipulation">
        <Ban className="w-4 h-4 shrink-0" />
        <h2 className="font-semibold">Off today&apos;s list</h2>
        <span className="text-sm opacity-80">{list.length}</span>
        <span className="ml-auto text-xs opacity-80">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="divide-y">
          {list.map(t => (
            <li key={t.key} className="flex flex-wrap items-center gap-3 px-4 py-2" data-testid="today-aside-task" data-state={t.state}>
              <div className="flex-1 min-w-[10rem]">
                <p className="font-medium leading-snug">{t.title}</p>
                <p className="text-sm text-muted-foreground">
                  {ASIDE_WORDS[t.state]}{t.state === 'snoozed' && t.until_text ? ' ' + t.until_text : ''}{t.reason ? ': ' + t.reason : ''}
                </p>
              </div>
              {t.can_change && (
                <button type="button" disabled={change.busy} onClick={() => change.send({ key: t.key, action: UNDO[t.state] })}
                  data-testid="today-aside-back" className={cn(BTN, 'border hover:bg-accent')}>
                  <Undo2 className="w-4 h-4" /> Bring back
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {change.error && <p className="px-4 pb-2 text-sm text-red-700" role="alert">{change.error}</p>}
    </section>
  )
}

/** Home's "Skipped today": the day's skips with their reasons, by site, for managers (decision 8: never by person). */
export function SkippedToday() {
  const api = useApi()
  const q = useQuery({ queryKey: ['ops-skips'], queryFn: () => api.get('/ops/skips'), staleTime: 60_000, refetchInterval: 120_000 })
  const s = q.data
  if (!s?.can_see) return null
  return (
    <section className="rounded-lg border bg-background overflow-hidden" data-testid="home-skipped">
      <div className="section-head px-4 py-2.5 flex items-center gap-2">
        <SkipForward className="w-4 h-4 shrink-0" />
        <h2 className="font-semibold">Skipped today</h2>
        <span className="text-sm opacity-80">{s.total}</span>
      </div>
      {!s.total ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nothing skipped today at your sites.</p>
      ) : (
        <ul className="divide-y">
          {s.sites.map(site => (
            <li key={site.venue_id} className="px-4 py-2" data-testid="home-skipped-site">
              <p className="text-sm font-semibold">{site.venue_name}</p>
              <ul className="mt-1 space-y-1">
                {site.skips.map(k => (
                  <li key={k.key} className="text-sm" data-testid="home-skipped-task">
                    <span className="font-medium">{k.title}</span>
                    <span className="text-muted-foreground">: {k.reason}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
