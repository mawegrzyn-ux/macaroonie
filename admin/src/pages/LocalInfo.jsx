// src/pages/LocalInfo.jsx
//
// Local info (/local-info, migration 240): what's happening around each venue
// — the weather, traffic, events and incidents the captures bring in
// (services/localInfoSvc.js), plus events typed in by hand. One venue or the
// whole group; a month as a calendar or a list; captured items hide or show,
// typed-in ones edit and delete. Captures (what is searched, where and how
// often) are set up per venue in the Captures window, with Run now. Local
// info view reads, manage changes. The rules (kinds, who sits on a day, the
// month's weeks) are shared/localInfo.js, the same the API and Pepper use.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CloudSun, Plus, Settings2, ChevronLeft, ChevronRight, Play, Loader2,
  Eye, EyeOff, Pencil, AlertTriangle,
} from 'lucide-react'
import { format } from 'date-fns'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { Modal, Segmented, ConfirmDelete, Field, DateButton } from '@/components/staff/shared'
import {
  KIND_ICONS, SEV_CHIP, SEV_DOT, dayText, useLocalInfoItems, ItemRow, DayGroups,
} from '@/components/localInfo/shared'
import { KINDS, KIND_LABELS, FREQUENCIES, frequencyText, itemOnDay, sortDayItems, monthGrid } from '@shared/localInfo.js'

const VENUE_KEY = 'maca_local_info_venue'
const VIEW_KEY = 'maca_local_info_view'
const errText = e => e?.body?.error || e?.message || 'Something went wrong'
const today = () => new Date().toISOString().slice(0, 10)

const SEV_OPTIONS = [
  { value: 'info', label: 'Info' },
  { value: 'notice', label: 'Worth knowing' },
  { value: 'warning', label: 'Warning' },
]
const FREQ_LABELS = { daily: 'Once a day', hours: 'Every few hours', weekly: 'Once a week' }
const HOUR_CHOICES = [1, 2, 3, 4, 6, 8, 12, 24]

const input = 'w-full min-h-[44px] border rounded-lg px-3 text-sm bg-background touch-manipulation'
const btn = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50'
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-50'

export default function LocalInfo() {
  const api = useApi()
  const qc = useQueryClient()
  const { canManage } = usePermission('local_info')

  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const venueNames = useMemo(() => Object.fromEntries(venues.map(v => [v.id, v.name])), [venues])
  const [venueId, setVenueId] = useState(() => { try { return localStorage.getItem(VENUE_KEY) || '' } catch { return '' } })
  useEffect(() => {
    if (venueId && venues.length && !venues.some(v => v.id === venueId)) setVenueId('')
  }, [venues, venueId])
  const pickVenue = id => { setVenueId(id); try { localStorage.setItem(VENUE_KEY, id) } catch { /* private mode */ } }

  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || 'calendar' } catch { return 'calendar' } })
  const pickView = v => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ } }
  const [month, setMonth] = useState(() => today().slice(0, 7))
  const [showHidden, setShowHidden] = useState(false)
  const [dayOpen, setDayOpen] = useState(null)         // 'YYYY-MM-DD'
  const [eventOpen, setEventOpen] = useState(null)     // { item? } | null
  const [capturesOpen, setCapturesOpen] = useState(false)
  const [pageError, setPageError] = useState(null)

  const grid = useMemo(() => monthGrid(month), [month])
  const from = grid[0].date, to = grid[grid.length - 1].date
  const itemsQ = useLocalInfoItems({ venueId: venueId || null, from, to, includeHidden: showHidden })
  const items = itemsQ.data?.items || []

  const moveMonth = n => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + n, 1))
    setMonth(d.toISOString().slice(0, 7))
  }

  const changeItem = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/local-info/items/${id}`, body),
    onSuccess: () => { setPageError(null); qc.invalidateQueries({ queryKey: ['local-info-items'] }) },
    onError: e => setPageError(errText(e)),
  })
  const deleteItem = useMutation({
    mutationFn: id => api.delete(`/local-info/items/${id}`),
    onSuccess: () => { setPageError(null); qc.invalidateQueries({ queryKey: ['local-info-items'] }) },
    onError: e => setPageError(errText(e)),
  })

  // What a row offers: captured items hide or show, typed-in ones edit and delete.
  const rowActions = it => {
    if (!canManage) return null
    if (it.source_id) {
      return (
        <button type="button" data-testid={it.hidden ? 'li-show' : 'li-hide'} onClick={() => changeItem.mutate({ id: it.id, body: { hidden: !it.hidden } })}
          className={cn(btn, 'min-h-[40px] px-2.5 text-xs')}>
          {it.hidden ? <><Eye className="w-3.5 h-3.5" />Show</> : <><EyeOff className="w-3.5 h-3.5" />Hide</>}
        </button>
      )
    }
    return (
      <>
        <button type="button" data-testid="li-edit" onClick={() => setEventOpen({ item: it })} className={cn(btn, 'min-h-[40px] px-2.5 text-xs')}>
          <Pencil className="w-3.5 h-3.5" />Edit
        </button>
        <ConfirmDelete label="Delete this event" confirmLabel="Yes, delete" onConfirm={() => deleteItem.mutate(it.id)} />
      </>
    )
  }

  const monthLabel = format(new Date(month + '-01T12:00:00'), 'MMMM yyyy')

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6 max-lg:notouch:pl-14 max-w-6xl mx-auto space-y-4" data-testid="local-info-page">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-[14rem]">
            <h1 className="text-lg font-semibold flex items-center gap-2"><CloudSun className="w-5 h-5 text-primary" /> Local info</h1>
            <p className="text-xs text-muted-foreground">Weather, traffic, events and incidents around the venues.</p>
          </div>
          <select value={venueId} onChange={e => pickVenue(e.target.value)} data-testid="li-venue" aria-label="Venue"
            className="min-h-[44px] border rounded-lg px-3 text-sm bg-background touch-manipulation">
            <option value="">Every venue</option>
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          {canManage && (
            <button type="button" className={btn} data-testid="li-captures" onClick={() => setCapturesOpen(true)}>
              <Settings2 className="w-4 h-4" /> Captures
            </button>
          )}
          {canManage && (
            <button type="button" className={btnPrimary} data-testid="li-add" onClick={() => setEventOpen({})}>
              <Plus className="w-4 h-4" /> Add an event
            </button>
          )}
        </div>

        {!canManage && <ReadOnlyNotice />}
        {pageError && (
          <p className="text-sm text-destructive flex items-center gap-1.5" data-testid="li-error"><AlertTriangle className="w-4 h-4" /> {pageError}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1">
            <button type="button" aria-label="Previous month" data-testid="li-prev" onClick={() => moveMonth(-1)} className={cn(btn, 'px-2.5')}><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold w-36 text-center tabular-nums" data-testid="li-month">{monthLabel}</span>
            <button type="button" aria-label="Next month" data-testid="li-next" onClick={() => moveMonth(1)} className={cn(btn, 'px-2.5')}><ChevronRight className="w-4 h-4" /></button>
          </div>
          {month !== today().slice(0, 7) && (
            <button type="button" className={cn(btn, 'min-h-[40px]')} data-testid="li-this-month" onClick={() => setMonth(today().slice(0, 7))}>This month</button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {canManage && (
              <button type="button" data-testid="li-show-hidden" aria-pressed={showHidden} onClick={() => setShowHidden(v => !v)}
                className={cn(btn, 'min-h-[40px] text-xs', showHidden && 'bg-muted')}>
                <EyeOff className="w-3.5 h-3.5" /> {showHidden ? 'Hidden shown' : 'Show hidden'}
              </button>
            )}
            <span data-testid="li-view" data-view={view}>
              <Segmented value={view} onChange={pickView}
                options={[{ value: 'calendar', label: 'Calendar' }, { value: 'list', label: 'List' }]} />
            </span>
          </div>
        </div>

        {itemsQ.isLoading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : view === 'calendar' ? (
          <MonthCalendar grid={grid} items={items} onOpenDay={setDayOpen} />
        ) : (
          <div className="bg-background border rounded-xl p-3 sm:p-4">
            <DayGroups items={items} from={from} to={to} venueNames={venueNames} renderActions={rowActions}
              emptyText="Nothing held for this month yet. Captures and typed-in events show here." />
          </div>
        )}

        {dayOpen && (
          <Modal title={dayText(dayOpen) + ' — ' + format(new Date(dayOpen + 'T12:00:00'), 'd MMMM yyyy')} onClose={() => setDayOpen(null)}>
            <div className="space-y-1.5" data-testid="li-day-modal" data-date={dayOpen}>
              {sortDayItems(items.filter(it => itemOnDay(it, dayOpen))).map(it => (
                <ItemRow key={it.id} item={it} venueNames={venueNames} actions={rowActions(it)} />
              ))}
              {!items.some(it => itemOnDay(it, dayOpen)) && <p className="text-sm text-muted-foreground py-4 text-center">Nothing held for this day.</p>}
            </div>
          </Modal>
        )}

        {eventOpen && (
          <EventModal api={api} venues={venues} item={eventOpen.item} defaultVenueId={venueId}
            onClose={() => setEventOpen(null)}
            onSaved={() => { setEventOpen(null); qc.invalidateQueries({ queryKey: ['local-info-items'] }) }} />
        )}

        {capturesOpen && (
          <CapturesModal api={api} venues={venues} defaultVenueId={venueId || venues[0]?.id || ''} onClose={() => setCapturesOpen(false)} />
        )}
      </div>
    </div>
  )
}

/** The month as whole weeks, Monday first: chips on big screens, dots on a phone. */
function MonthCalendar({ grid, items, onOpenDay }) {
  const byDay = useMemo(() => {
    const map = {}
    for (const cell of grid) map[cell.date] = sortDayItems(items.filter(it => itemOnDay(it, cell.date)))
    return map
  }, [grid, items])
  const now = today()
  return (
    <div className="bg-background border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className="px-1.5 py-1.5 text-[11px] font-semibold text-muted-foreground text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.map(cell => {
          const on = byDay[cell.date] || []
          return (
            <button key={cell.date} type="button" onClick={() => onOpenDay(cell.date)}
              data-testid="li-cell" data-date={cell.date} data-count={on.length}
              className={cn('min-h-[64px] sm:min-h-[96px] border-b border-r p-1 sm:p-1.5 text-left align-top touch-manipulation hover:bg-muted/40',
                !cell.inMonth && 'bg-muted/20 text-muted-foreground')}>
              <span className={cn('inline-flex items-center justify-center text-[11px] sm:text-xs font-medium w-5 h-5 rounded-full',
                cell.date === now && 'bg-primary text-primary-foreground')}>
                {Number(cell.date.slice(8, 10))}
              </span>
              <div className="hidden sm:block mt-0.5 space-y-0.5">
                {on.slice(0, 3).map(it => {
                  const Icon = KIND_ICONS[it.kind] || CloudSun
                  return (
                    <div key={it.id} data-testid="li-chip" data-kind={it.kind}
                      className={cn('flex items-center gap-1 text-[10px] leading-4 px-1 py-0.5 rounded border truncate', SEV_CHIP[it.severity] || SEV_CHIP.info, it.hidden && 'opacity-50')}>
                      <Icon className="w-3 h-3 shrink-0" /><span className="truncate">{it.title}</span>
                    </div>
                  )
                })}
                {on.length > 3 && <div className="text-[10px] text-muted-foreground px-1" data-testid="li-more">+{on.length - 3} more</div>}
              </div>
              <div className="sm:hidden mt-1 flex flex-wrap gap-0.5">
                {on.slice(0, 6).map(it => <span key={it.id} className={cn('w-1.5 h-1.5 rounded-full', SEV_DOT[it.severity] || SEV_DOT.info)} />)}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Add or edit a typed-in event (captured items only hide). */
function EventModal({ api, venues, item, defaultVenueId, onClose, onSaved }) {
  const editing = !!item
  const [f, setF] = useState(() => ({
    venue_id: editing ? (item.venue_id || '') : (defaultVenueId || ''),
    kind: item?.kind || 'events',
    title: item?.title || '',
    details: item?.details || '',
    place: item?.place || '',
    url: item?.url || '',
    starts_on: item?.starts_on || today(),
    ends_on: item?.ends_on || '',
    time_text: item?.time_text || '',
    severity: item?.severity || 'info',
  }))
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const [error, setError] = useState(null)
  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind: f.kind, title: f.title.trim(), details: f.details.trim() || null, place: f.place.trim() || null,
        url: f.url.trim() || null, starts_on: f.starts_on, ends_on: f.ends_on || null,
        time_text: f.time_text.trim() || null, severity: f.severity,
      }
      return editing
        ? api.patch(`/local-info/items/${item.id}`, body)
        : api.post('/local-info/items', { ...body, venue_id: f.venue_id || null })
    },
    onSuccess: onSaved,
    onError: e => setError(errText(e)),
  })
  return (
    <Modal title={editing ? 'Change this event' : 'Add a local event'} onClose={onClose}
      footer={<>
        <button type="button" className={btnPrimary} data-testid="li-ev-save" disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {editing ? 'Save' : 'Add it'}
        </button>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
      </>}>
      <div className="space-y-3" data-testid="li-event-modal">
        {editing ? (
          <p className="text-xs text-muted-foreground">{item.venue_id ? (venues.find(v => v.id === item.venue_id)?.name || 'One venue') : 'Every venue'}</p>
        ) : (
          <Field label="Where">
            <select value={f.venue_id} onChange={e => set('venue_id', e.target.value)} data-testid="li-ev-venue" className={input}>
              <option value="">Every venue</option>
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Kind" group>
          <Segmented value={f.kind} onChange={v => set('kind', v)} options={KINDS.map(k => ({ value: k, label: KIND_LABELS[k] }))} />
        </Field>
        <Field label="What's on">
          <input value={f.title} onChange={e => set('title', e.target.value)} maxLength={200} data-testid="li-ev-title"
            placeholder="Street market on the High Street" className={input} />
        </Field>
        <Field label="Details (optional)">
          <textarea value={f.details} onChange={e => set('details', e.target.value)} maxLength={1000} rows={2} data-testid="li-ev-details"
            className={cn(input, 'py-2 min-h-[64px]')} />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="First day" group>
            <DateButton value={f.starts_on} onChange={v => set('starts_on', v)} label="First day" />
          </Field>
          <Field label="Last day (optional)" group>
            <span className="inline-flex items-center gap-1.5">
              <DateButton value={f.ends_on} onChange={v => set('ends_on', v)} min={f.starts_on} label="Last day" />
              {f.ends_on && <button type="button" className={cn(btn, 'min-h-[40px] px-2 text-xs')} onClick={() => set('ends_on', '')}>Clear</button>}
            </span>
          </Field>
          <Field label="Time (optional)">
            <input value={f.time_text} onChange={e => set('time_text', e.target.value)} maxLength={40} data-testid="li-ev-time"
              placeholder="19:00, or all day" className={cn(input, 'w-36')} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="Place (optional)">
            <input value={f.place} onChange={e => set('place', e.target.value)} maxLength={200} data-testid="li-ev-place" className={input} />
          </Field>
          <Field label="Link (optional)">
            <input value={f.url} onChange={e => set('url', e.target.value)} maxLength={500} placeholder="https://…" data-testid="li-ev-url" className={input} />
          </Field>
        </div>
        <Field label="How loud" group>
          <Segmented value={f.severity} onChange={v => set('severity', v)} options={SEV_OPTIONS} />
        </Field>
        {error && <p className="text-sm text-destructive" data-testid="li-ev-error">{error}</p>}
      </div>
    </Modal>
  )
}

const CAP_BLANK = { kind: 'weather', place: '', site: '', query: '', frequency: 'daily', every_hours: 4, enabled: true }

/** The venue's captures: what is searched, where, how often; Run now. */
function CapturesModal({ api, venues, defaultVenueId, onClose }) {
  const qc = useQueryClient()
  const [venueId, setVenueId] = useState(defaultVenueId)
  const [mode, setMode] = useState('list')             // 'list' | 'edit'
  const [draft, setDraft] = useState(null)             // { id? , ...CAP_BLANK }
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  const q = useQuery({
    queryKey: ['local-info-sources', venueId],
    queryFn: () => api.get(`/local-info/venues/${venueId}/sources`),
    enabled: !!venueId,
    refetchInterval: 4000,
  })
  const sources = q.data?.sources || []

  // When a running capture finishes, its findings are on the page: refetch them.
  const runningRef = useRef(0)
  useEffect(() => {
    const running = sources.filter(s => s.running).length
    if (running < runningRef.current) qc.invalidateQueries({ queryKey: ['local-info-items'] })
    runningRef.current = running
  }, [sources, qc])

  const done = () => { setMode('list'); setDraft(null); setError(null); qc.invalidateQueries({ queryKey: ['local-info-sources'] }) }
  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind: draft.kind, place: draft.place.trim(), frequency: draft.frequency,
        every_hours: draft.frequency === 'hours' ? Number(draft.every_hours) || 4 : null,
        site: draft.kind === 'weather' ? null : (draft.site.trim() || null),
        query: draft.kind === 'weather' ? null : (draft.query.trim() || null),
        enabled: draft.enabled,
      }
      return draft.id ? api.patch(`/local-info/sources/${draft.id}`, body) : api.post(`/local-info/venues/${venueId}/sources`, body)
    },
    onSuccess: done,
    onError: e => setError(errText(e)),
  })
  const remove = useMutation({
    mutationFn: id => api.delete(`/local-info/sources/${id}`),
    onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ['local-info-items'] }) },
    onError: e => setError(errText(e)),
  })
  const toggle = useMutation({
    mutationFn: s => api.patch(`/local-info/sources/${s.id}`, { enabled: !s.enabled }),
    onSuccess: done,
    onError: e => setError(errText(e)),
  })
  const runNow = useMutation({
    mutationFn: id => api.post(`/local-info/sources/${id}/run`),
    onSuccess: () => { setError(null); setNotice('Running in the background — findings appear in a minute.'); qc.invalidateQueries({ queryKey: ['local-info-sources'] }) },
    onError: e => setError(errText(e)),
  })

  return (
    <Modal title={mode === 'list' ? 'Captures' : (draft?.id ? 'Change this capture' : 'Add a capture')} onClose={onClose}
      footer={mode === 'list' ? (
        <button type="button" className={btnPrimary} data-testid="li-cap-add" disabled={!venueId}
          onClick={() => { setDraft({ ...CAP_BLANK }); setMode('edit'); setError(null); setNotice(null) }}>
          <Plus className="w-4 h-4" /> Add a capture
        </button>
      ) : (
        <>
          <button type="button" className={btnPrimary} data-testid="li-cap-save" disabled={!draft?.place.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
          <button type="button" className={btn} onClick={() => { setMode('list'); setDraft(null); setError(null) }}>Back</button>
        </>
      )}>
      {mode === 'list' ? (
        <div className="space-y-3" data-testid="li-captures-modal">
          <Field label="Venue">
            <select value={venueId} onChange={e => setVenueId(e.target.value)} data-testid="li-cap-venue" className={input}>
              {!venueId && <option value="">Pick a venue</option>}
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            A capture runs on its own schedule: the weather from the forecast service, the rest a web search by Pepper.
            What it finds lands on the calendar; hide anything you don't want shown.
          </p>
          {notice && <p className="text-sm text-emerald-700" data-testid="li-cap-notice">{notice}</p>}
          {error && <p className="text-sm text-destructive" data-testid="li-cap-error">{error}</p>}
          {q.isLoading && venueId ? (
            <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No captures here yet.</p>
          ) : (
            <div className="space-y-2">
              {sources.map(s => {
                const Icon = KIND_ICONS[s.kind] || CloudSun
                return (
                  <div key={s.id} className={cn('border rounded-lg p-3 space-y-1.5', !s.enabled && 'opacity-60')} data-testid="li-cap-row" data-kind={s.kind}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-medium">{KIND_LABELS[s.kind]} — {s.place}</span>
                      {!s.enabled && <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Off</span>}
                      {s.running && <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800" data-testid="li-cap-running"><Loader2 className="w-3 h-3 animate-spin" />Running</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {frequencyText(s)}{s.site ? ' · only ' + s.site : ''}{s.query ? ' · also: ' + s.query : ''}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid="li-cap-last">
                      {s.last_run_at ? 'Last ran ' + format(new Date(s.last_run_at), 'EEE d MMM HH:mm') : 'Hasn\'t run yet'}
                      {s.enabled && s.next_run_at && !s.running ? ' · next ' + format(new Date(s.next_run_at), 'EEE d MMM HH:mm') : ''}
                    </p>
                    {s.last_error && <p className="text-xs text-destructive" data-testid="li-cap-last-error">{s.last_error}</p>}
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      <button type="button" className={cn(btn, 'min-h-[40px] px-2.5 text-xs')} data-testid="li-cap-run"
                        disabled={runNow.isPending || s.running} onClick={() => runNow.mutate(s.id)}>
                        <Play className="w-3.5 h-3.5" /> Run now
                      </button>
                      <button type="button" className={cn(btn, 'min-h-[40px] px-2.5 text-xs')} data-testid="li-cap-edit"
                        onClick={() => { setDraft({ id: s.id, kind: s.kind, place: s.place, site: s.site || '', query: s.query || '', frequency: s.frequency, every_hours: s.every_hours || 4, enabled: s.enabled }); setMode('edit'); setError(null); setNotice(null) }}>
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button type="button" className={cn(btn, 'min-h-[40px] px-2.5 text-xs')} data-testid="li-cap-toggle" onClick={() => toggle.mutate(s)}>
                        {s.enabled ? 'Turn off' : 'Turn on'}
                      </button>
                      <ConfirmDelete label="Delete" confirmLabel="Yes — it and what it captured" onConfirm={() => remove.mutate(s.id)} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="li-cap-form">
          <Field label="What to capture" group>
            <Segmented value={draft.kind} onChange={v => setDraft(p => ({ ...p, kind: v }))}
              options={KINDS.map(k => ({ value: k, label: KIND_LABELS[k] }))} />
          </Field>
          <Field label="Place">
            <input value={draft.place} onChange={e => setDraft(p => ({ ...p, place: e.target.value }))} maxLength={200} data-testid="li-cap-place"
              placeholder="Ware, Hertfordshire — or a postcode" className={input} />
          </Field>
          {draft.kind !== 'weather' && (
            <>
              <Field label="Only this site (optional)">
                <input value={draft.site} onChange={e => setDraft(p => ({ ...p, site: e.target.value }))} maxLength={100} data-testid="li-cap-site"
                  placeholder="hertfordshiremercury.co.uk" className={input} />
              </Field>
              <Field label="Also look for (optional)">
                <input value={draft.query} onChange={e => setDraft(p => ({ ...p, query: e.target.value }))} maxLength={300} data-testid="li-cap-query"
                  placeholder="markets, football matches" className={input} />
              </Field>
            </>
          )}
          <Field label="How often" group>
            <span className="inline-flex flex-wrap items-center gap-2">
              <Segmented value={draft.frequency} onChange={v => setDraft(p => ({ ...p, frequency: v }))}
                options={FREQUENCIES.map(fq => ({ value: fq, label: FREQ_LABELS[fq] }))} />
              {draft.frequency === 'hours' && (
                <select value={draft.every_hours} onChange={e => setDraft(p => ({ ...p, every_hours: Number(e.target.value) }))}
                  data-testid="li-cap-hours" aria-label="Every how many hours" className={cn(input, 'w-auto')}>
                  {HOUR_CHOICES.map(h => <option key={h} value={h}>Every {h} {h === 1 ? 'hour' : 'hours'}</option>)}
                </select>
              )}
            </span>
          </Field>
          <p className="text-xs text-muted-foreground">
            {draft.frequency === 'daily' ? 'Runs early each morning, before the day\'s trade.'
              : draft.frequency === 'weekly' ? 'Runs early on Monday mornings.'
                : 'Runs through the day, every few hours.'}
          </p>
          {error && <p className="text-sm text-destructive" data-testid="li-cap-error">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
