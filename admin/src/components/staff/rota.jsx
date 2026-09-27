// src/components/staff/rota.jsx
//
// The rota grid, the pay table and the tips table. Used by the Rota page
// (pages/Rota.jsx) and, unchanged, by the Rota dashboard widgets
// (pages/RotaDashboard.jsx), so the page and the dashboard always agree.
//
// Entry model (rota_entries, migration 106): a row is either
//   - a day-part tick: { staff_id, work_date, shift_id }, or
//   - an hourly period: { staff_id, work_date, start_time, end_time }.
// The grid edits a local draft of the week in the tenant's current mode
// (rota_settings.mode) and saves it with one whole-week PUT. Entries made
// in the other mode are shown as a notice and are replaced on save.
//
// All pay / points / tip maths is server-side (services/rotaCalc.js);
// the tables here only display GET .../pay and send overrides.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, subWeeks } from 'date-fns'
import { Loader2, Plus, Trash2, Copy, Check, AlertTriangle, ArrowRight, RotateCcw, Wallet, Printer, ImageDown } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { fmt, getMonday } from '@/pages/CashRecon'
import {
  Modal, TimeSelect, ErrorNote, hhmm, toMin, rangeMinutes, fmtHours, inputCls, useVenues, Segmented,
} from '@/components/staff/shared'
import { buildRotaSheet, printRota, saveRotaImage, visibleRotaDates, isClosedDay } from '@/components/staff/rotaExport'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

// ── Data ──────────────────────────────────────────────────────

export function useMe() {
  const api = useApi()
  return useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
}

/** { canEditRota, canSeePay, canEditPay } from /me permissions. */
export function useRotaPerms() {
  const { data: me } = useMe()
  const admin = !!me?.is_platform_admin
  const p = me?.permissions ?? {}
  return {
    canEditRota: admin || p.rota === 'manage',
    canSeePay:   admin || p.rota_pay === 'view' || p.rota_pay === 'manage',
    canEditPay:  admin || p.rota_pay === 'manage',
  }
}

export function useRotaWeek(venueId, weekStart) {
  const api = useApi()
  return useQuery({
    queryKey: ['rota-week', venueId, weekStart],
    queryFn:  () => api.get(`/rota/venues/${venueId}/weeks/${weekStart}`),
    enabled:  !!venueId && !!weekStart,
  })
}

export function useRotaPay(venueId, weekStart, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: ['rota-pay', venueId, weekStart],
    queryFn:  () => api.get(`/rota/venues/${venueId}/weeks/${weekStart}/pay`),
    enabled:  enabled && !!venueId && !!weekStart,
  })
}

// ── Entry helpers ─────────────────────────────────────────────

function isShiftEntry(e) { return !!e.shift_id }

function clean(e) {
  return e.shift_id
    ? { staff_id: e.staff_id, work_date: e.work_date, shift_id: e.shift_id }
    : { staff_id: e.staff_id, work_date: e.work_date, start_time: hhmm(e.start_time), end_time: hhmm(e.end_time) }
}

function signature(list) {
  return JSON.stringify(list.map(clean).map(e => JSON.stringify(e)).sort())
}

function spanOf(p) {
  const s = toMin(p.start_time)
  let e = toMin(p.end_time)
  if (e <= s) e += 1440
  return [s, e]
}

/** Problem with a person's periods for a day, or null. */
export function periodProblem(periods) {
  if (periods.some(p => hhmm(p.start_time) === hhmm(p.end_time))) return 'A period must end after it starts.'
  const spans = periods.map(spanOf).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] < spans[i - 1][1]) return 'Periods overlap. Adjust the times so they do not.'
  }
  return null
}

function shiftMinutes(shift) { return rangeMinutes(shift.start_time, shift.end_time) }

function entryMinutes(e, shiftById) {
  if (e.shift_id) { const s = shiftById[e.shift_id]; return s ? shiftMinutes(s) : 0 }
  return rangeMinutes(e.start_time, e.end_time)
}

// Unsaved drafts survive week / venue switching within the session.
const draftCache = new Map()

// ── Rota grid ─────────────────────────────────────────────────

/**
 * Staff as rows, days as columns. Day-parts mode splits each day into its
 * shifts with an ON/OFF toggle per cell; hourly mode shows each day's
 * periods and opens an editor for start / end times.
 */
export function RotaGrid({ venueId, weekStart, canEdit, selectedDay, onSelectDay, dense = false }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: week, isLoading, error } = useRotaWeek(venueId, weekStart)
  const { data: venues = [] } = useVenues()
  const [exportError, setExportError] = useState(null)
  const cacheKey = `${venueId}|${weekStart}`
  const mode = week?.settings?.mode ?? 'day_parts'
  const step = week?.settings?.slot_minutes ?? 30

  const serverEntries = useMemo(
    () => (week?.entries ?? []).filter(e => (mode === 'day_parts' ? isShiftEntry(e) : !isShiftEntry(e))).map(clean),
    [week, mode],
  )
  const otherModeCount = (week?.entries?.length ?? 0) - serverEntries.length

  const [draft, setDraftRaw] = useState(null)
  const loadedFor = useRef(null)
  useEffect(() => {
    if (!week) return
    const sig = `${cacheKey}|${mode}|${signature(serverEntries)}`
    if (loadedFor.current === sig) return
    loadedFor.current = sig
    const cached = draftCache.get(`${cacheKey}|${mode}`)
    setDraftRaw(cached ?? serverEntries)
  }, [week, cacheKey, mode, serverEntries])

  function setDraft(next) {
    setDraftRaw(prev => {
      const value = typeof next === 'function' ? next(prev ?? []) : next
      draftCache.set(`${cacheKey}|${mode}`, value)
      return value
    })
  }

  const entries = draft ?? serverEntries
  const dirty = draft != null && signature(draft) !== signature(serverEntries)

  const save = useMutation({
    mutationFn: () => api.put(`/rota/venues/${venueId}/weeks/${weekStart}/entries`, { entries: entries.map(clean) }),
    onSuccess: () => {
      draftCache.delete(`${cacheKey}|${mode}`)
      qc.invalidateQueries({ queryKey: ['rota-week', venueId, weekStart] })
      qc.invalidateQueries({ queryKey: ['rota-pay', venueId, weekStart] })
    },
  })
  function discard() {
    draftCache.delete(`${cacheKey}|${mode}`)
    setDraftRaw(serverEntries)
  }

  const [editingCell, setEditingCell] = useState(null) // { staff, date }

  const shifts = useMemo(() => {
    const all = week?.shifts ?? []
    const used = new Set(entries.filter(isShiftEntry).map(e => e.shift_id))
    return all.filter(s => s.is_active || used.has(s.id))
  }, [week, entries])
  const shiftById = useMemo(() => Object.fromEntries((week?.shifts ?? []).map(s => [s.id, s])), [week])

  const onSet = useMemo(() => new Set(entries.filter(isShiftEntry).map(e => `${e.staff_id}|${e.work_date}|${e.shift_id}`)), [entries])
  const periodsByCell = useMemo(() => {
    const m = {}
    for (const e of entries.filter(e => !isShiftEntry(e))) (m[`${e.staff_id}|${e.work_date}`] ??= []).push(e)
    for (const k of Object.keys(m)) m[k].sort((a, b) => toMin(a.start_time) - toMin(b.start_time))
    return m
  }, [entries])

  function toggle(staffId, date, shiftId) {
    if (!canEdit) return
    const key = `${staffId}|${date}|${shiftId}`
    setDraft(prev => onSet.has(key)
      ? prev.filter(e => !(e.shift_id === shiftId && e.staff_id === staffId && e.work_date === date))
      : [...prev, { staff_id: staffId, work_date: date, shift_id: shiftId }])
  }

  function setPeriods(staffId, date, periods) {
    setDraft(prev => [
      ...prev.filter(e => !(e.staff_id === staffId && e.work_date === date && !e.shift_id)),
      ...periods.map(p => ({ staff_id: staffId, work_date: date, start_time: p.start_time, end_time: p.end_time })),
    ])
  }

  if (isLoading || (!week && !error)) {
    return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }
  if (error) return <ErrorNote error={error} />

  const dates = visibleRotaDates({ week, entries, hideClosed: !!week.settings?.hide_closed_on_rota })
  const hiddenDays = week.dates.length - dates.length
  const staff = week.staff
  const today = format(new Date(), 'yyyy-MM-dd')
  const minutesFor = staffId => entries.filter(e => e.staff_id === staffId).reduce((s, e) => s + entryMinutes(e, shiftById), 0)

  const cellW = dense ? 'w-11 min-w-[44px]' : 'w-14 min-w-[56px]'
  const nameCol = 'sticky left-0 z-10 bg-background border-r'

  function sheet() {
    const venueName = venues.find(v => v.id === venueId)?.name ?? ''
    return buildRotaSheet({ week, entries, mode, venueName, unsaved: dirty, hideClosed: !!week.settings?.hide_closed_on_print })
  }
  async function exportImage() {
    setExportError(null)
    try { await saveRotaImage(sheet(), { preferShare: IS_TOUCH }) } catch (e) { setExportError(e) }
  }
  function exportPrint() {
    setExportError(null)
    try { printRota(sheet()) } catch (e) { setExportError(e) }
  }
  const exportButtons = staff.length > 0 && (
    <div className="flex items-center gap-2">
      <button type="button" onClick={exportPrint}
        className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
        <Printer className="w-4 h-4" /> Print / PDF
      </button>
      <button type="button" onClick={exportImage}
        className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
        <ImageDown className="w-4 h-4" /> {IS_TOUCH ? 'Share image' : 'Save image'}
      </button>
    </div>
  )

  return (
    <div className="space-y-3">
      {canEdit ? (
        <RotaToolbar venueId={venueId} weekStart={weekStart} dirty={dirty} saving={save.isPending}
          onSave={() => save.mutate()} onDiscard={discard} hasEntries={entries.length > 0}
          extra={exportButtons} />
      ) : exportButtons && (
        <div className="flex justify-end">{exportButtons}</div>
      )}
      <ErrorNote error={save.error || exportError} />
      {otherModeCount > 0 && (
        <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>
            This week also has {otherModeCount} entr{otherModeCount === 1 ? 'y' : 'ies'} made {mode === 'day_parts' ? 'by hours' : 'by day parts'}.
            They still count for pay, but saving this week replaces them.
          </span>
        </p>
      )}
      {hiddenDays > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {hiddenDays} closed day{hiddenDays === 1 ? '' : 's'} hidden (Rota setup). A closed day with someone on it still shows.
        </p>
      )}
      {staff.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No active staff for this venue. Add people on the Staff page.</p>
      ) : mode === 'day_parts' && shifts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No shifts set up yet. Add day parts on the Rota setup page.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="bg-muted">
                <th rowSpan={mode === 'day_parts' ? 2 : 1} className={cn(nameCol, 'bg-muted text-left px-3 py-2 font-medium min-w-[140px]')}>Staff</th>
                {dates.map(d => (
                  <th key={d} colSpan={mode === 'day_parts' ? shifts.length : 1}
                    className={cn('border-l px-1 py-1.5 font-medium text-center whitespace-nowrap',
                      d === today && 'text-primary', d === selectedDay && onSelectDay && 'bg-primary/10')}>
                    {onSelectDay ? (
                      <button type="button" onClick={() => onSelectDay(d)} className="min-h-[36px] w-full touch-manipulation">
                        {format(parseISO(d), 'EEE d')}
                      </button>
                    ) : format(parseISO(d), 'EEE d')}
                    {isClosedDay(week, d) && <span className="block text-[10px] font-normal text-muted-foreground">Closed</span>}
                  </th>
                ))}
                <th rowSpan={mode === 'day_parts' ? 2 : 1} className="border-l px-2 py-2 font-medium text-right whitespace-nowrap">Week</th>
              </tr>
              {mode === 'day_parts' && (
                <tr className="bg-muted/60 text-[11px] text-muted-foreground">
                  {dates.map(d => shifts.map((s, i) => (
                    <th key={`${d}${s.id}`} className={cn(cellW, 'px-0.5 py-1 font-normal truncate max-w-[56px]', i === 0 && 'border-l')} title={`${s.name} ${hhmm(s.start_time)}–${hhmm(s.end_time)}`}>
                      {s.name}
                    </th>
                  )))}
                </tr>
              )}
            </thead>
            <tbody className="divide-y">
              {staff.map(st => (
                <tr key={st.id}>
                  <td className={cn(nameCol, 'px-3 py-1')}>
                    <div className={cn('text-sm font-medium truncate max-w-[160px]', !st.is_active && 'text-muted-foreground')}>{st.name}</div>
                    {st.role_name && <div className="text-[11px] text-muted-foreground truncate max-w-[160px]">{st.role_name}</div>}
                  </td>
                  {mode === 'day_parts'
                    ? dates.map(d => shifts.map((s, i) => {
                        const on = onSet.has(`${st.id}|${d}|${s.id}`)
                        return (
                          <td key={`${d}${s.id}`} className={cn('p-0.5 text-center', i === 0 && 'border-l')}>
                            <button type="button" disabled={!canEdit} onClick={() => toggle(st.id, d, s.id)}
                              aria-pressed={on} aria-label={`${st.name} ${format(parseISO(d), 'EEE')} ${s.name} ${on ? 'on' : 'off'}`}
                              className={cn(cellW, 'h-11 rounded-md text-xs font-semibold touch-manipulation transition-colors',
                                on ? 'bg-green-600 text-white' : 'bg-muted/40 text-muted-foreground/60',
                                canEdit ? (on ? 'hover:bg-green-700' : 'hover:bg-muted') : 'cursor-default')}>
                              {on ? 'ON' : 'OFF'}
                            </button>
                          </td>
                        )
                      }))
                    : dates.map(d => {
                        const periods = periodsByCell[`${st.id}|${d}`] ?? []
                        return (
                          <td key={d} className="border-l p-0.5 align-top">
                            <button type="button" disabled={!canEdit} onClick={() => setEditingCell({ staff: st, date: d })}
                              className={cn('w-full min-w-[92px] min-h-[44px] rounded-md px-1.5 py-1 text-xs tabular-nums text-left touch-manipulation',
                                periods.length ? 'bg-green-600/10 text-green-900' : 'text-muted-foreground/60',
                                canEdit ? 'hover:bg-muted' : 'cursor-default')}>
                              {periods.length
                                ? periods.map((p, i) => <div key={i} className="whitespace-nowrap">{hhmm(p.start_time)}–{hhmm(p.end_time)}</div>)
                                : (canEdit ? <span className="flex items-center justify-center h-8"><Plus className="w-4 h-4" /></span> : null)}
                            </button>
                          </td>
                        )
                      })}
                  <td className="border-l px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap">
                    {fmtHours(minutesFor(st.id) / 60)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 text-[11px] text-muted-foreground border-t">
                <td className={cn(nameCol, 'bg-muted px-3 py-1.5 font-medium')}>{mode === 'day_parts' ? 'On shift' : 'Hours'}</td>
                {mode === 'day_parts'
                  ? dates.map(d => shifts.map((s, i) => (
                      <td key={`${d}${s.id}`} className={cn('text-center py-1.5 tabular-nums', i === 0 && 'border-l')}>
                        {staff.filter(st => onSet.has(`${st.id}|${d}|${s.id}`)).length || ''}
                      </td>
                    )))
                  : dates.map(d => {
                      const mins = entries.filter(e => e.work_date === d).reduce((s, e) => s + entryMinutes(e, shiftById), 0)
                      return <td key={d} className="border-l text-center py-1.5 tabular-nums">{mins ? fmtHours(mins / 60) : ''}</td>
                    })}
                <td className="border-l px-2 py-1.5 text-right tabular-nums font-medium">
                  {fmtHours(entries.reduce((s, e) => s + entryMinutes(e, shiftById), 0) / 60)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editingCell && (
        <PeriodEditor
          staff={editingCell.staff} date={editingCell.date} step={step}
          shifts={(week.shifts ?? []).filter(s => s.is_active)}
          initial={periodsByCell[`${editingCell.staff.id}|${editingCell.date}`] ?? []}
          onApply={periods => { setPeriods(editingCell.staff.id, editingCell.date, periods); setEditingCell(null) }}
          onClose={() => setEditingCell(null)} />
      )}
    </div>
  )
}

function RotaToolbar({ venueId, weekStart, dirty, saving, onSave, onDiscard, hasEntries, extra }) {
  const api = useApi()
  const qc = useQueryClient()
  const [copyFrom, setCopyFrom] = useState('')
  const [confirming, setConfirming] = useState(false)
  const weeks = useMemo(
    () => Array.from({ length: 8 }, (_, i) => getMonday(subWeeks(parseISO(weekStart), i + 1))),
    [weekStart],
  )
  const copy = useMutation({
    mutationFn: () => api.post(`/rota/venues/${venueId}/weeks/${weekStart}/copy`, { from_week: copyFrom }),
    onSuccess: () => {
      setConfirming(false)
      setCopyFrom('')
      qc.invalidateQueries({ queryKey: ['rota-week', venueId, weekStart] })
      qc.invalidateQueries({ queryKey: ['rota-pay', venueId, weekStart] })
    },
  })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onSave} disabled={!dirty || saving}
        className="h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center gap-1.5">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save rota
      </button>
      {dirty && (
        <>
          <button type="button" onClick={onDiscard}
            className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Discard changes</button>
          <span className="text-xs text-amber-700 font-medium">Unsaved changes</span>
        </>
      )}
      <div className="flex-1" />
      {extra}
      <select value={copyFrom} onChange={e => { setCopyFrom(e.target.value); setConfirming(false) }} disabled={dirty}
        aria-label="Copy from week"
        className="h-11 rounded-lg border bg-background px-2 text-sm touch-manipulation disabled:opacity-50">
        <option value="">Copy from week…</option>
        {weeks.map(w => <option key={w} value={w}>w/c {format(parseISO(w), 'd MMM yyyy')}</option>)}
      </select>
      {copyFrom && !confirming && (
        <button type="button" onClick={() => (hasEntries ? setConfirming(true) : copy.mutate())} disabled={copy.isPending}
          className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
          <Copy className="w-4 h-4" /> Copy
        </button>
      )}
      {confirming && (
        <span className="inline-flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Replace this week?</span>
          <button type="button" onClick={() => copy.mutate()} disabled={copy.isPending}
            className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium touch-manipulation">Yes, replace</button>
          <button type="button" onClick={() => setConfirming(false)}
            className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Cancel</button>
        </span>
      )}
      {dirty && <span className="w-full text-[11px] text-muted-foreground text-right">Save or discard before copying another week.</span>}
      <div className="w-full"><ErrorNote error={copy.error} /></div>
    </div>
  )
}

function PeriodEditor({ staff, date, step, shifts, initial, onApply, onClose }) {
  const [periods, setPeriods] = useState(() => initial.map(p => ({ start_time: hhmm(p.start_time), end_time: hhmm(p.end_time) })))
  const problem = periodProblem(periods)
  const update = (i, patch) => setPeriods(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  function addBlank() {
    const last = [...periods].sort((a, b) => toMin(a.end_time) - toMin(b.end_time)).pop()
    const start = last ? hhmm(last.end_time) : '09:00'
    const endMin = (toMin(start) + 4 * 60) % 1440
    const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
    setPeriods(ps => [...ps, { start_time: start, end_time: end }])
  }

  return (
    <Modal title={`${staff.name}, ${format(parseISO(date), 'EEEE d MMM')}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => onApply(periods)} disabled={!!problem}
          className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
          Done
        </button>
        {periods.length > 0 && (
          <button type="button" onClick={() => setPeriods([])}
            className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Clear day</button>
        )}
      </>}>
      {shifts.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Add a shift's times</p>
          <div className="flex flex-wrap gap-1.5">
            {shifts.map(s => (
              <button key={s.id} type="button"
                onClick={() => setPeriods(ps => [...ps, { start_time: hhmm(s.start_time), end_time: hhmm(s.end_time) }])}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">
                {s.name} <span className="text-xs text-muted-foreground tabular-nums">{hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Worked periods</p>
        {periods.length === 0 && <p className="text-sm text-muted-foreground">Off this day.</p>}
        {periods.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <TimeSelect value={p.start_time} step={step} onChange={v => update(i, { start_time: v })} label="Start" />
            <span className="text-muted-foreground">to</span>
            <TimeSelect value={p.end_time} step={step} onChange={v => update(i, { end_time: v })} label="End" />
            <span className="text-xs text-muted-foreground tabular-nums">
              {hhmm(p.start_time) !== hhmm(p.end_time) ? fmtHours(rangeMinutes(p.start_time, p.end_time) / 60) : ''}
            </span>
            <button type="button" onClick={() => setPeriods(ps => ps.filter((_, j) => j !== i))} aria-label="Remove period"
              className="w-11 h-11 ml-auto flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={addBlank}
          className="h-11 px-3 rounded-lg border border-dashed text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add period
        </button>
        <p className="text-[11px] text-muted-foreground">An end time at or before the start runs past midnight.</p>
      </div>
      {problem && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{problem}</p>}
    </Modal>
  )
}

// ── Today / selected day ──────────────────────────────────────

/** Who is working on one day: grouped by shift, plus hourly periods. */
export function RotaDayList({ venueId, weekStart, day }) {
  const { data: week, isLoading } = useRotaWeek(venueId, weekStart)
  if (isLoading || !week) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  const staffById = Object.fromEntries(week.staff.map(s => [s.id, s]))
  const dayEntries = week.entries.filter(e => e.work_date === day)
  const byShift = week.shifts
    .map(s => ({ shift: s, people: dayEntries.filter(e => e.shift_id === s.id).map(e => staffById[e.staff_id]).filter(Boolean) }))
    .filter(g => g.people.length)
  const periods = dayEntries.filter(e => !e.shift_id)
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time))
    .map(e => ({ ...e, person: staffById[e.staff_id] })).filter(e => e.person)

  if (!byShift.length && !periods.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Nobody on the rota for {format(parseISO(day), 'EEEE d MMM')}.</p>
  }
  return (
    <div className="space-y-3">
      {byShift.map(({ shift, people }) => (
        <div key={shift.id}>
          <p className="text-xs font-semibold text-muted-foreground mb-1">
            {shift.name} <span className="font-normal tabular-nums">{hhmm(shift.start_time)}–{hhmm(shift.end_time)}</span> · {people.length}
          </p>
          <ul className="divide-y rounded-lg border">
            {people.map(p => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 min-w-0 truncate">{p.name}</span>
                {p.role_name && <span className="text-[11px] text-muted-foreground">{p.role_name}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {periods.length > 0 && (
        <div>
          {byShift.length > 0 && <p className="text-xs font-semibold text-muted-foreground mb-1">By hours</p>}
          <ul className="divide-y rounded-lg border">
            {periods.map((e, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="tabular-nums text-xs w-[92px] shrink-0">{hhmm(e.start_time)}–{hhmm(e.end_time)}</span>
                <span className="flex-1 min-w-0 truncate">{e.person.name}</span>
                {e.person.role_name && <span className="text-[11px] text-muted-foreground">{e.person.role_name}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Pay ───────────────────────────────────────────────────────

function rostered(rows) {
  return rows.filter(r => r.entry_count > 0 || r.pay_override != null || r.points_adjustment !== 0)
}

function MoneyEdit({ value, onSave, onClear, saving, placeholder }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  return (
    <span className="inline-flex items-center gap-1">
      <input className="h-10 w-24 rounded-lg border bg-background px-2 text-sm text-right tabular-nums touch-manipulation"
        inputMode="decimal" value={v} placeholder={placeholder} autoFocus
        onChange={e => setV(e.target.value.replace(/[^0-9.]/g, ''))} />
      <button type="button" onClick={() => onSave(v === '' ? null : Number(v))} disabled={saving}
        className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium touch-manipulation disabled:opacity-50">Save</button>
      {onClear && (
        <button type="button" onClick={onClear} disabled={saving}
          className="h-10 px-2 rounded-lg border text-xs touch-manipulation hover:bg-muted">Use calculated</button>
      )}
    </span>
  )
}

/** Hours and pay per person, pay overrides, and "Fill wages" into Cash Recon. */
export function RotaPayTable({ venueId, weekStart, canEdit }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading, error } = useRotaPay(venueId, weekStart)
  const [editing, setEditing] = useState(null)
  const [confirmFill, setConfirmFill] = useState(false)
  const setPay = d => qc.setQueryData(['rota-pay', venueId, weekStart], d)

  const override = useMutation({
    mutationFn: ({ staffId, pay_override }) => api.patch(`/rota/venues/${venueId}/weeks/${weekStart}/staff/${staffId}`, { pay_override }),
    onSuccess: d => { setPay(d); setEditing(null) },
  })
  const fill = useMutation({
    mutationFn: () => api.post(`/rota/venues/${venueId}/weeks/${weekStart}/fill-wages`),
    onSuccess: () => {
      setConfirmFill(false)
      qc.invalidateQueries({ queryKey: ['cash-recon-wages', venueId] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week', venueId] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId] })
    },
  })

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  if (error) return <ErrorNote error={error} />
  const rows = rostered(data.rows)

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nobody on the rota this week.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Staff</th>
                <th className="text-left px-2 py-2 font-medium">Pay</th>
                <th className="text-right px-2 py-2 font-medium">Hours</th>
                <th className="text-right px-3 py-2 font-medium">Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.staff_id}>
                  <td className="px-3 py-1.5">
                    <div className="font-medium truncate max-w-[180px]">{r.name}</div>
                    {r.role_name && <div className="text-[11px] text-muted-foreground">{r.role_name}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                    {r.pay_type === 'hourly' ? 'Hourly' : `Fixed / ${r.pay_basis}`}
                    {r.days_worked ? ` · ${r.days_worked} day${r.days_worked === 1 ? '' : 's'}` : ''}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtHours(r.hours)}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {editing === r.staff_id ? (
                      <MoneyEdit value={r.pay_override} placeholder={String(r.computed_pay)} saving={override.isPending}
                        onSave={v => override.mutate({ staffId: r.staff_id, pay_override: v })}
                        onClear={r.pay_override != null ? () => override.mutate({ staffId: r.staff_id, pay_override: null }) : null} />
                    ) : (
                      <button type="button" disabled={!canEdit} onClick={() => setEditing(r.staff_id)}
                        className={cn('min-h-[40px] px-2 rounded-lg tabular-nums touch-manipulation', canEdit && 'hover:bg-muted underline decoration-dotted underline-offset-4')}>
                        {fmt(r.pay)}
                        {r.pay_override != null && <span className="block text-[10px] text-amber-700 no-underline">override (calc {fmt(r.computed_pay)})</span>}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={2}>Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtHours(data.totals.hours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.pay)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <ErrorNote error={override.error || fill.error} />
      {canEdit && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirmFill ? (
            <button type="button" onClick={() => setConfirmFill(true)}
              className="h-11 px-4 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted flex items-center gap-1.5">
              <Wallet className="w-4 h-4" /> Fill Cash Recon wages
            </button>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">Write {rows.length} people's pay into this week's wages?</span>
              <button type="button" onClick={() => fill.mutate()} disabled={fill.isPending}
                className="h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center gap-1.5">
                {fill.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Yes, fill wages
              </button>
              <button type="button" onClick={() => setConfirmFill(false)}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
            </>
          )}
          {fill.isSuccess && <span className="text-xs text-green-700">Wages updated: {fill.data.updated} changed, {fill.data.added} added.</span>}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Tap a pay figure to override it for this week. Filling wages updates rostered people's wage rows (a row already marked Paid stays paid) and adds anyone missing; tips are not added to wages.
      </p>
    </div>
  )
}

// ── Tips ──────────────────────────────────────────────────────

const DIST_LABEL = { points: 'By points', manual: 'Manual', house: 'Kept by house' }

function tipRows(data) {
  return data.rows.filter(r => r.entry_count > 0 || r.tip_share > 0 || r.points_adjustment !== 0 || r.tip_adjustment !== 0)
}

function moneyInput(v) {
  return v.replace(/[^0-9.]/g, '')
}

/** One pot: where its money comes from (sources, manual lines) and what happened to it. */
function PotCard({ pot, data, canEdit, base, setPay, onEditManual }) {
  const api = useApi()
  const saved = useMemo(() => Object.fromEntries(pot.lines.map(l => [l.id, l.amount ? String(l.amount) : ''])), [pot.lines])
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const dirty = pot.lines.some(l => (draft[l.id] ?? '') !== (saved[l.id] ?? ''))
  const saveLines = useMutation({
    mutationFn: () => api.put(`${base}/pot-lines`, {
      amounts: pot.lines.map(l => ({ line_id: l.id, amount: draft[l.id] === '' || draft[l.id] == null ? null : Number(draft[l.id]) })),
    }),
    onSuccess: setPay,
  })

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-muted/40">
        <span className="text-sm font-semibold flex-1 min-w-0 truncate">{pot.name}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{DIST_LABEL[pot.distribution]}</span>
        <span className="text-base font-semibold tabular-nums">{fmt(pot.total)}</span>
      </div>
      <div className="px-3 py-2 space-y-1 text-sm">
        {pot.sources.length === 0 && pot.lines.length === 0 && (
          <p className="text-xs text-muted-foreground">No sources or manual lines for this venue. Set them in Rota setup.</p>
        )}
        {pot.sources.map(src => (
          <div key={src.id} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate text-muted-foreground">{src.name} <span className="text-[11px]">(Cash Recon)</span></span>
            <span className="tabular-nums">{fmt(src.amount)}</span>
          </div>
        ))}
        {pot.lines.map(l => (
          <div key={l.id} className="flex items-center gap-2 min-h-[44px]">
            <span className="flex-1 min-w-0 truncate">{l.name}</span>
            {canEdit ? (
              <input className="h-10 w-28 rounded-lg border bg-background px-2 text-sm text-right tabular-nums touch-manipulation"
                inputMode="decimal" placeholder="0.00" aria-label={`${l.name} amount`}
                value={draft[l.id] ?? ''} onChange={e => setDraft(d => ({ ...d, [l.id]: moneyInput(e.target.value) }))} />
            ) : <span className="tabular-nums">{fmt(l.amount)}</span>}
          </div>
        ))}
        {canEdit && dirty && (
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setDraft(saved)}
              className="h-10 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Discard</button>
            <button type="button" onClick={() => saveLines.mutate()} disabled={saveLines.isPending}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium touch-manipulation disabled:opacity-50">Save amounts</button>
          </div>
        )}
        <ErrorNote error={saveLines.error} />
        {pot.surcharge > 0 && (
          <div className="pt-1 border-t mt-1 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="flex-1">Pot before deductions</span>
              <span className="tabular-nums">{fmt(pot.gross)}</span>
            </div>
            <div className="flex items-center gap-2 text-amber-800">
              <span className="flex-1">{pot.surcharge_name || 'Surcharge'} ({pot.surcharge_pct}%)</span>
              <span className="tabular-nums">−{fmt(pot.surcharge)}</span>
            </div>
            <div className="flex items-center gap-2 font-medium">
              <span className="flex-1">Available to share</span>
              <span className="tabular-nums">{fmt(pot.total)}</span>
            </div>
          </div>
        )}
        <div className="pt-1 border-t mt-1 text-xs">
          {pot.distribution === 'house' && <p className="text-muted-foreground">Kept by the house, not shared with staff.</p>}
          {pot.distribution === 'points' && (
            <p className="text-muted-foreground">
              Shared by points.{' '}
              {data.tip_rounding && (data.tip_rounding.mode === 'nearest'
                ? `Rounded to the nearest ${fmt(data.tip_rounding.to)}. `
                : `Rounded ${data.tip_rounding.mode} to a multiple of ${fmt(data.tip_rounding.to)}. `)}
              {pot.difference > 0 && <span className="text-amber-700 font-medium">Pays out {fmt(pot.difference)} more than the pot.</span>}
              {pot.difference < 0 && <span className="text-amber-700 font-medium">{fmt(-pot.difference)} left over.</span>}
            </p>
          )}
          {pot.distribution === 'manual' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('flex-1', pot.difference === 0 ? 'text-green-700' : 'text-amber-700 font-medium')}>
                Shared {fmt(pot.distributed)} of {fmt(pot.total)}
                {pot.difference < 0 && ` (${fmt(-pot.difference)} still to share)`}
                {pot.difference > 0 && ` (${fmt(pot.difference)} more than the pot)`}
              </span>
              {canEdit && (
                <button type="button" onClick={() => onEditManual(pot)}
                  className="h-10 px-3 rounded-lg border text-xs font-medium touch-manipulation hover:bg-muted">Share amounts</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ManualShareModal({ pot, data, base, setPay, onClose }) {
  const api = useApi()
  const people = data.rows
  const [amounts, setAmounts] = useState(() => Object.fromEntries(people.map(r => {
    const v = r.pot_shares[pot.id]
    return [r.staff_id, v ? String(v) : '']
  })))
  const total = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0)
  const left = Math.round((pot.total - total) * 100) / 100
  const save = useMutation({
    mutationFn: () => api.put(`${base}/pots/${pot.id}/manual`, {
      amounts: Object.entries(amounts).map(([staff_id, v]) => ({ staff_id, amount: v === '' ? null : Number(v) })),
    }),
    onSuccess: d => { setPay(d); onClose() },
  })
  function splitEvenly() {
    const withShifts = people.filter(r => r.entry_count > 0)
    const list = withShifts.length ? withShifts : people
    if (!list.length) return
    const pence = Math.round(pot.total * 100)
    const each = Math.floor(pence / list.length)
    let rest = pence - each * list.length
    setAmounts(Object.fromEntries(people.map(r => {
      if (!list.includes(r)) return [r.staff_id, '']
      const p = each + (rest-- > 0 ? 1 : 0)
      return [r.staff_id, (p / 100).toFixed(2)]
    })))
  }

  return (
    <Modal title={`Share ${pot.name}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
          className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
        <button type="button" onClick={splitEvenly}
          className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Split evenly</button>
      </>}>
      <div className={cn('rounded-lg px-3 py-2 text-sm', left === 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800')}>
        Pot {fmt(pot.total)} · shared {fmt(total)} · {left >= 0 ? `${fmt(left)} left` : `${fmt(-left)} over`}
      </div>
      <p className="text-[11px] text-muted-foreground">Split evenly shares the pot equally between everyone on the rota this week.</p>
      <div className="rounded-lg border divide-y">
        {people.map(r => (
          <div key={r.staff_id} className="flex items-center gap-2 px-3 min-h-[48px]">
            <span className="flex-1 min-w-0">
              <span className="block text-sm truncate">{r.name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {r.role_name ?? 'No role'}{r.entry_count ? ` · ${fmtHours(r.hours)}` : ' · not on the rota'}
              </span>
            </span>
            <span className="text-sm text-muted-foreground">£</span>
            <input className="h-10 w-24 rounded-lg border bg-background px-2 text-sm text-right tabular-nums touch-manipulation"
              inputMode="decimal" placeholder="0.00" aria-label={`${r.name} amount`}
              value={amounts[r.staff_id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [r.staff_id]: moneyInput(e.target.value) }))} />
          </div>
        ))}
      </div>
      <ErrorNote error={save.error} />
    </Modal>
  )
}

/** Tip pots for the week, each person's share of every pot, and point moves. */
export function RotaTipsTable({ venueId, weekStart, canEdit }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading, error } = useRotaPay(venueId, weekStart)
  const [move, setMove] = useState({ unit: null, from: '', to: '', value: '' })
  const [confirmReset, setConfirmReset] = useState(null) // null | 'points' | 'money'
  const [manualPot, setManualPot] = useState(null)
  const setPay = d => qc.setQueryData(['rota-pay', venueId, weekStart], d)
  const base = `/rota/venues/${venueId}/weeks/${weekStart}`

  const moveM = useMutation({
    mutationFn: unit => unit === 'money'
      ? api.post(`${base}/move-tips`, { from_staff_id: move.from, to_staff_id: move.to, amount: Number(move.value) })
      : api.post(`${base}/move-points`, { from_staff_id: move.from, to_staff_id: move.to, points: Number(move.value) }),
    onSuccess: d => { setPay(d); setMove(m => ({ ...m, from: '', to: '', value: '' })) },
  })
  const reset = useMutation({
    mutationFn: kind => api.post(`${base}/reset-moves`, { kind }),
    onSuccess: d => { setPay(d); setConfirmReset(null) },
  })

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  if (error) return <ErrorNote error={error} />

  const pots = data.pots ?? []
  if (!pots.length) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No tip pots set up yet. Add one in Rota setup.</p>
  }
  const sharedPots = pots.filter(p => p.distribution !== 'house')
  const hasPoints = pots.some(p => p.distribution === 'points')
  const rows = tipRows(data)
  const hasPointMoves = data.rows.some(r => r.points_adjustment !== 0)
  const hasMoneyMoves = data.rows.some(r => r.tip_adjustment !== 0)
  const showTotal = sharedPots.length > 1 || hasMoneyMoves
  const unit = move.unit ?? (hasPoints ? 'points' : 'money')
  const fromRow = data.rows.find(r => r.staff_id === move.from)
  const available = fromRow ? (unit === 'money' ? fromRow.tip_share : fromRow.points) : 0
  const moveOk = move.from && move.to && move.from !== move.to && Number(move.value) > 0 && fromRow && Number(move.value) <= available + 1e-9
  const fromOptions = data.rows.filter(r => (unit === 'money' ? r.tip_share : r.points) > 0)

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {pots.map(p => (
          <PotCard key={p.id} pot={p} data={data} canEdit={canEdit} base={base} setPay={setPay} onEditManual={setManualPot} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Tips in {fmt(data.totals.tips_in)}
        {data.totals.surcharges > 0 && ` (after ${fmt(data.totals.surcharges)} surcharges)`}
        {' '}· shared with staff {fmt(data.totals.tips_shared)}
        {data.totals.kept_by_house > 0 && ` · kept by the house ${fmt(data.totals.kept_by_house)}`}
      </p>

      {sharedPots.length > 0 && (rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nobody on the rota this week.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Staff</th>
                {hasPoints && <>
                  <th className="text-right px-2 py-2 font-medium" title="Shift points x role multiplier">Earned</th>
                  <th className="text-right px-2 py-2 font-medium">Moved</th>
                  <th className="text-right px-2 py-2 font-medium">Points</th>
                </>}
                {sharedPots.map(p => <th key={p.id} className="text-right px-2 py-2 font-medium whitespace-nowrap">{p.name}</th>)}
                {hasMoneyMoves && <th className="text-right px-2 py-2 font-medium whitespace-nowrap">Moved £</th>}
                {showTotal && <th className="text-right px-3 py-2 font-medium">Total</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.staff_id}>
                  <td className="px-3 py-1.5">
                    <div className="font-medium truncate max-w-[160px]">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.role_name ?? 'No role'}{hasPoints ? ` ×${Number(r.role_multiplier).toFixed(2)}` : ''}
                    </div>
                  </td>
                  {hasPoints && <>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.base_points}</td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', r.points_adjustment > 0 ? 'text-green-700' : r.points_adjustment < 0 ? 'text-red-600' : 'text-muted-foreground')}>
                      {r.points_adjustment > 0 ? '+' : ''}{r.points_adjustment || '–'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                      {r.points}
                      {data.totals.points > 0 && (
                        <span className="block text-[10px] font-normal text-muted-foreground">{Math.round((r.points / data.totals.points) * 1000) / 10}%</span>
                      )}
                    </td>
                  </>}
                  {sharedPots.map(p => {
                    const v = r.pot_shares[p.id] ?? 0
                    const exact = r.pot_shares_exact?.[p.id]
                    return (
                      <td key={p.id} className="px-2 py-1.5 text-right tabular-nums">
                        {v ? fmt(v) : '–'}
                        {exact != null && exact !== v && (
                          <span className="block text-[10px] text-muted-foreground">exact {fmt(exact)}</span>
                        )}
                      </td>
                    )
                  })}
                  {hasMoneyMoves && (
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', r.tip_adjustment > 0 ? 'text-green-700' : r.tip_adjustment < 0 ? 'text-red-600' : 'text-muted-foreground')}>
                      {r.tip_adjustment ? `${r.tip_adjustment > 0 ? '+' : '−'}${fmt(Math.abs(r.tip_adjustment))}` : '–'}
                    </td>
                  )}
                  {showTotal && <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmt(r.tip_share)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2">Total</td>
                {hasPoints && <><td colSpan={2} /><td className="px-2 py-2 text-right tabular-nums">{data.totals.points}</td></>}
                {sharedPots.map(p => <td key={p.id} className="px-2 py-2 text-right tabular-nums">{fmt(p.distributed)}</td>)}
                {hasMoneyMoves && <td />}
                {showTotal && <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.tips_shared)}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {canEdit && sharedPots.length > 0 && data.rows.length > 1 && (
        <div className="rounded-xl border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold flex-1">Move tips</p>
            {hasPoints && (
              <Segmented value={unit} onChange={u => setMove({ unit: u, from: '', to: '', value: '' })}
                options={[{ value: 'points', label: 'Points' }, { value: 'money', label: '£ amount' }]} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={move.from} onChange={e => setMove(m => ({ ...m, from: e.target.value }))} aria-label="Take from"
              className="h-11 rounded-lg border bg-background px-2 text-sm touch-manipulation min-w-[140px]">
              <option value="">From…</option>
              {fromOptions.map(r => (
                <option key={r.staff_id} value={r.staff_id}>{r.name} ({unit === 'money' ? fmt(r.tip_share) : r.points})</option>
              ))}
            </select>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <select value={move.to} onChange={e => setMove(m => ({ ...m, to: e.target.value }))} aria-label="Give to"
              className="h-11 rounded-lg border bg-background px-2 text-sm touch-manipulation min-w-[140px]">
              <option value="">To…</option>
              {data.rows.filter(r => r.staff_id !== move.from).map(r => <option key={r.staff_id} value={r.staff_id}>{r.name}</option>)}
            </select>
            <input className={cn(inputCls, 'w-24')} inputMode="decimal" placeholder={unit === 'money' ? '£0.00' : 'Points'}
              aria-label={unit === 'money' ? 'Amount to move' : 'Points to move'}
              value={move.value} onChange={e => setMove(m => ({ ...m, value: moneyInput(e.target.value) }))} />
            <button type="button" onClick={() => moveM.mutate(unit)} disabled={!moveOk || moveM.isPending}
              className="h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">Move</button>
          </div>
          {fromRow && Number(move.value) > available + 1e-9 && (
            <p className="text-xs text-amber-700">{fromRow.name} only has {unit === 'money' ? fmt(available) : `${available} points`}.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!confirmReset && hasPointMoves && (
              <button type="button" onClick={() => setConfirmReset('points')}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4" /> Undo point moves
              </button>
            )}
            {!confirmReset && hasMoneyMoves && (
              <button type="button" onClick={() => setConfirmReset('money')}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4" /> Undo £ moves
              </button>
            )}
            {confirmReset && (
              <>
                <span className="text-xs text-muted-foreground">
                  {confirmReset === 'points' ? 'Put everyone back to their earned points?' : 'Undo every £ move this week?'}
                </span>
                <button type="button" onClick={() => reset.mutate(confirmReset)} disabled={reset.isPending}
                  className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium touch-manipulation">Yes, undo</button>
                <button type="button" onClick={() => setConfirmReset(null)}
                  className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Cancel</button>
              </>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {unit === 'money'
              ? 'A £ move takes an amount off one person\'s total tips and gives it to another, after every pot is shared. The total stays the same.'
              : 'Moving points is zero-sum and changes everyone\'s share of every pot shared by points.'}
          </p>
        </div>
      )}
      <ErrorNote error={moveM.error || reset.error} />
      {manualPot && (
        <ManualShareModal pot={manualPot} data={data} base={base} setPay={setPay} onClose={() => setManualPot(null)} />
      )}
    </div>
  )
}
