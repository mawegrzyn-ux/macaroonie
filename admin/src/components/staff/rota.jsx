// src/components/staff/rota.jsx
//
// The rota grid, the pay table and the tips table. Used by the Rota page
// (pages/Rota.jsx) and, unchanged, by the Rota dashboard widgets
// (pages/RotaDashboard.jsx), so the page and the dashboard always agree.
//
// Entry model (rota_entries, migration 106): a row is either
//   - a day-part tick: { staff_id, work_date, shift_id }, or
//   - an hourly period: { staff_id, work_date, start_time, end_time }.
// Each carries a status (migration 129): on, sick, pto, uto or abs. The
// square button next to each name picks what a tap puts in for that person
// (ON/OFF, SICK/OFF, ...); a tap flicks a cell between that and OFF.
// The grid edits a local draft of the week in the tenant's current mode
// (rota_settings.mode) and saves it with one whole-week PUT. Entries made
// in the other mode are shown as a notice and are replaced on save.
//
// All pay / points / tip maths is server-side (services/rotaCalc.js);
// the tables here only display GET .../pay and send overrides.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, subWeeks } from 'date-fns'
import { Loader2, Plus, Minus, Trash2, Copy, Check, AlertTriangle, ArrowRight, RotateCcw, Wallet, Printer, ImageDown, ChevronDown, Eraser } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { fmt, getMonday } from '@/pages/CashRecon'
import {
  Modal, TimeSelect, ErrorNote, hhmm, toMin, rangeMinutes, fmtHours, inputCls, useVenues, Segmented, ConfirmDelete,
} from '@/components/staff/shared'
import {
  buildRotaSheet, printRota, saveRotaImage, visibleRotaDates, isClosedDay, ENTRY_STATUSES, STATUS_BY_KEY, statusOf,
} from '@/components/staff/rotaExport'

const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

// ── Data ──────────────────────────────────────────────────────

export function useMe() {
  const api = useApi()
  return useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
}

/** Rota permissions from /me: rota (grid), rota_pay (hours and pay), rota_tips (tips). */
export function useRotaPerms() {
  const { data: me } = useMe()
  const admin = !!me?.is_platform_admin
  const p = me?.permissions ?? {}
  return {
    canEditRota: admin || p.rota === 'manage',
    canSeePay:   admin || p.rota_pay === 'view' || p.rota_pay === 'manage',
    canEditPay:  admin || p.rota_pay === 'manage',
    canSeeTips:  admin || p.rota_tips === 'view' || p.rota_tips === 'manage',
    canEditTips: admin || p.rota_tips === 'manage',
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
  const status = statusOf(e)
  return e.shift_id
    ? { staff_id: e.staff_id, work_date: e.work_date, shift_id: e.shift_id, status }
    : { staff_id: e.staff_id, work_date: e.work_date, start_time: hhmm(e.start_time), end_time: hhmm(e.end_time), status }
}

// Grid colours per status (print colours live in rotaExport.js).
const STATUS_CLS = {
  on:   'bg-green-600 text-white hover:bg-green-700',
  sick: 'bg-red-600 text-white hover:bg-red-700',
  pto:  'bg-sky-600 text-white hover:bg-sky-700',
  uto:  'bg-violet-600 text-white hover:bg-violet-700',
  abs:  'bg-amber-500 text-white hover:bg-amber-600',
}
const STATUS_SOFT = {
  on:   'bg-green-600/10 text-green-900',
  sick: 'bg-red-600/10 text-red-900',
  pto:  'bg-sky-600/10 text-sky-900',
  uto:  'bg-violet-600/10 text-violet-900',
  abs:  'bg-amber-500/15 text-amber-900',
}

export function StatusBadge({ status, className }) {
  const st = STATUS_BY_KEY[status]
  if (!st || status === 'on') return null
  return <span className={cn('inline-block rounded px-1 text-[10px] font-semibold', STATUS_CLS[status], className)} title={st.name}>{st.label}</span>
}

// The per-person tap mode, kept across weeks for the session.
const modeCache = new Map()

/**
 * Square button next to a name: picks what a tap on that person's cells
 * puts in (ON/OFF, SICK/OFF, PTO/OFF, UTO/OFF, ABS/OFF). The menu is fixed
 * positioned and portalled to <body> so the grid's scroll box and the
 * sticky name cells (their own stacking contexts) don't clip or cover it.
 */
function ModeButton({ value, onChange, name }) {
  const [open, setOpen] = useState(null) // { top, left } when open
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const st = STATUS_BY_KEY[value] ?? STATUS_BY_KEY.on

  useEffect(() => {
    if (!open) return
    const close = e => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(null)
    }
    const shut = () => setOpen(null)
    document.addEventListener('pointerdown', close)
    window.addEventListener('resize', shut)
    window.addEventListener('scroll', shut, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', shut)
      window.removeEventListener('scroll', shut, true)
    }
  }, [open])

  function toggleMenu() {
    if (open) { setOpen(null); return }
    const r = btnRef.current.getBoundingClientRect()
    const menuH = ENTRY_STATUSES.length * 48 + 12
    const top = r.bottom + 4 + menuH > window.innerHeight ? Math.max(8, r.top - 4 - menuH) : r.bottom + 4
    setOpen({ top, left: Math.min(r.left, window.innerWidth - 228) })
  }

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggleMenu}
        aria-haspopup="menu" aria-expanded={!!open} aria-label={`What a tap puts in for ${name}: ${st.label} / OFF`}
        title={`Tap puts in: ${st.name}`}
        className={cn('relative w-11 h-11 shrink-0 rounded-lg border-2 flex flex-col items-center justify-center touch-manipulation text-[10px] font-bold leading-none',
          value === 'on' ? 'border-green-600 text-green-700 bg-green-50' : cn('border-transparent', STATUS_CLS[value]))}>
        {st.label}
        <ChevronDown className="w-3 h-3 mt-0.5" />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ top: open.top, left: open.left }}
          className="fixed z-50 w-[220px] rounded-xl border bg-background shadow-xl p-1.5">
          {ENTRY_STATUSES.map(s => (
            <button key={s.key} type="button" role="menuitemradio" aria-checked={value === s.key}
              onClick={() => { onChange(s.key); setOpen(null) }}
              className={cn('w-full h-11 px-2 rounded-lg flex items-center gap-2 text-sm touch-manipulation hover:bg-muted',
                value === s.key && 'bg-muted')}>
              <span className={cn('w-12 h-7 rounded-md text-[11px] font-bold flex items-center justify-center', STATUS_CLS[s.key])}>{s.label}</span>
              <span className="text-xs text-muted-foreground">/ OFF</span>
              <span className="flex-1 text-left text-xs truncate">{s.name}</span>
              {value === s.key && <Check className="w-4 h-4 text-primary" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
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

/** Minutes worked (status on); time off doesn't count as hours on the grid. */
function workedMinutes(e, shiftById) {
  return statusOf(e) === 'on' ? entryMinutes(e, shiftById) : 0
}

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
  const [modes, setModes] = useState(() => Object.fromEntries(modeCache))
  const modeFor = staffId => modes[staffId] ?? 'on'
  function setMode(staffId, value) {
    modeCache.set(staffId, value)
    setModes(m => ({ ...m, [staffId]: value }))
  }

  const shifts = useMemo(() => {
    const all = week?.shifts ?? []
    const used = new Set(entries.filter(isShiftEntry).map(e => e.shift_id))
    return all.filter(s => s.is_active || used.has(s.id))
  }, [week, entries])
  const shiftById = useMemo(() => Object.fromEntries((week?.shifts ?? []).map(s => [s.id, s])), [week])

  // staff|date|shift -> status, for day-part cells
  const cellStatus = useMemo(() => new Map(entries.filter(isShiftEntry).map(e => [`${e.staff_id}|${e.work_date}|${e.shift_id}`, statusOf(e)])), [entries])
  const periodsByCell = useMemo(() => {
    const m = {}
    for (const e of entries.filter(e => !isShiftEntry(e))) (m[`${e.staff_id}|${e.work_date}`] ??= []).push(e)
    for (const k of Object.keys(m)) m[k].sort((a, b) => toMin(a.start_time) - toMin(b.start_time))
    return m
  }, [entries])

  // A tap flicks the cell between OFF and the person's mode; a cell holding
  // another status (e.g. ON while the mode is SICK) switches to the mode.
  function toggle(staffId, date, shiftId) {
    if (!canEdit) return
    const mode = modeFor(staffId)
    const match = e => e.shift_id === shiftId && e.staff_id === staffId && e.work_date === date
    setDraft(prev => {
      const current = prev.find(match)
      if (!current) return [...prev, { staff_id: staffId, work_date: date, shift_id: shiftId, status: mode }]
      if (statusOf(current) === mode) return prev.filter(e => !match(e))
      return prev.map(e => (match(e) ? { ...e, status: mode } : e))
    })
  }

  function setPeriods(staffId, date, periods) {
    setDraft(prev => [
      ...prev.filter(e => !(e.staff_id === staffId && e.work_date === date && !e.shift_id)),
      ...periods.map(p => ({ staff_id: staffId, work_date: date, start_time: p.start_time, end_time: p.end_time, status: statusOf(p) })),
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
  const minutesFor = staffId => entries.filter(e => e.staff_id === staffId).reduce((s, e) => s + workedMinutes(e, shiftById), 0)

  const cellW = dense ? 'w-11 min-w-[44px]' : 'w-14 min-w-[56px]'
  const nameCol = 'sticky left-0 z-10 bg-background border-r'

  function sheet() {
    const venueName = venues.find(v => v.id === venueId)?.name ?? ''
    return buildRotaSheet({ week, entries, mode, venueName, unsaved: dirty,
      hideClosed: !!week.settings?.hide_closed_on_print, hideTotals: !!week.settings?.hide_totals_on_print })
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
          onClear={() => setDraft([])}
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
                <th rowSpan={mode === 'day_parts' ? 2 : 1} className={cn(nameCol, 'bg-muted text-left px-3 py-2 font-medium', canEdit ? 'min-w-[190px]' : 'min-w-[140px]')}>Staff</th>
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
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={cn('text-sm font-medium truncate max-w-[160px]', !st.is_active && 'text-muted-foreground')}>{st.name}</div>
                        {st.role_name && <div className="text-[11px] text-muted-foreground truncate max-w-[160px]">{st.role_name}</div>}
                      </div>
                      {canEdit && <ModeButton value={modeFor(st.id)} onChange={v => setMode(st.id, v)} name={st.name} />}
                    </div>
                  </td>
                  {mode === 'day_parts'
                    ? dates.map(d => shifts.map((s, i) => {
                        const status = cellStatus.get(`${st.id}|${d}|${s.id}`)
                        const label = status ? STATUS_BY_KEY[status].label : 'OFF'
                        return (
                          <td key={`${d}${s.id}`} className={cn('p-0.5 text-center', i === 0 && 'border-l')}>
                            <button type="button" disabled={!canEdit} onClick={() => toggle(st.id, d, s.id)}
                              aria-pressed={!!status} aria-label={`${st.name} ${format(parseISO(d), 'EEE')} ${s.name} ${status ? STATUS_BY_KEY[status].name : 'off'}`}
                              className={cn(cellW, 'h-11 rounded-md font-semibold touch-manipulation transition-colors',
                                label.length > 3 ? 'text-[10px]' : 'text-xs',
                                status ? STATUS_CLS[status] : 'bg-muted/40 text-muted-foreground/60',
                                canEdit ? (!status && 'hover:bg-muted') : 'cursor-default')}>
                              {label}
                            </button>
                          </td>
                        )
                      }))
                    : dates.map(d => {
                        const periods = periodsByCell[`${st.id}|${d}`] ?? []
                        const tone = periods.some(p => statusOf(p) === 'on') ? 'on' : (periods[0] ? statusOf(periods[0]) : null)
                        return (
                          <td key={d} className="border-l p-0.5 align-top">
                            <button type="button" disabled={!canEdit} onClick={() => setEditingCell({ staff: st, date: d })}
                              className={cn('w-full min-w-[92px] min-h-[44px] rounded-md px-1.5 py-1 text-xs tabular-nums text-left touch-manipulation',
                                tone ? STATUS_SOFT[tone] : 'text-muted-foreground/60',
                                canEdit ? 'hover:bg-muted' : 'cursor-default')}>
                              {periods.length
                                ? periods.map((p, i) => (
                                    <div key={i} className="whitespace-nowrap flex items-center gap-1">
                                      {hhmm(p.start_time)}–{hhmm(p.end_time)} <StatusBadge status={statusOf(p)} />
                                    </div>
                                  ))
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
                        {staff.filter(st => cellStatus.get(`${st.id}|${d}|${s.id}`) === 'on').length || ''}
                      </td>
                    )))
                  : dates.map(d => {
                      const mins = entries.filter(e => e.work_date === d).reduce((s, e) => s + workedMinutes(e, shiftById), 0)
                      return <td key={d} className="border-l text-center py-1.5 tabular-nums">{mins ? fmtHours(mins / 60) : ''}</td>
                    })}
                <td className="border-l px-2 py-1.5 text-right tabular-nums font-medium">
                  {fmtHours(entries.reduce((s, e) => s + workedMinutes(e, shiftById), 0) / 60)}
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
          defaultStatus={modeFor(editingCell.staff.id)}
          onApply={periods => { setPeriods(editingCell.staff.id, editingCell.date, periods); setEditingCell(null) }}
          onClose={() => setEditingCell(null)} />
      )}
    </div>
  )
}

function RotaToolbar({ venueId, weekStart, dirty, saving, onSave, onDiscard, onClear, hasEntries, extra }) {
  const api = useApi()
  const qc = useQueryClient()
  const [copyFrom, setCopyFrom] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
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
      {/* Clearing only empties the draft; nothing is removed until Save. */}
      {!confirmClear ? (
        <button type="button" onClick={() => setConfirmClear(true)} disabled={!hasEntries}
          className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted disabled:opacity-50 flex items-center gap-1.5">
          <Eraser className="w-4 h-4" /> Clear rota
        </button>
      ) : (
        <span className="inline-flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Clear everyone this week?</span>
          <button type="button" onClick={() => { onClear(); setConfirmClear(false) }}
            className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium touch-manipulation">Yes, clear</button>
          <button type="button" onClick={() => setConfirmClear(false)}
            className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Cancel</button>
        </span>
      )}
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

function PeriodEditor({ staff, date, step, shifts, initial, defaultStatus = 'on', onApply, onClose }) {
  const [periods, setPeriods] = useState(() => initial.map(p => ({ start_time: hhmm(p.start_time), end_time: hhmm(p.end_time), status: statusOf(p) })))
  const problem = periodProblem(periods)
  const update = (i, patch) => setPeriods(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  function addBlank() {
    const last = [...periods].sort((a, b) => toMin(a.end_time) - toMin(b.end_time)).pop()
    const start = last ? hhmm(last.end_time) : '09:00'
    const endMin = (toMin(start) + 4 * 60) % 1440
    const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
    setPeriods(ps => [...ps, { start_time: start, end_time: end, status: defaultStatus }])
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
                onClick={() => setPeriods(ps => [...ps, { start_time: hhmm(s.start_time), end_time: hhmm(s.end_time), status: defaultStatus }])}
                className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">
                {s.name} <span className="text-xs text-muted-foreground tabular-nums">{hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Periods (working or time off)</p>
        {periods.length === 0 && <p className="text-sm text-muted-foreground">Off this day.</p>}
        {periods.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <TimeSelect value={p.start_time} step={step} onChange={v => update(i, { start_time: v })} label="Start" />
            <span className="text-muted-foreground">to</span>
            <TimeSelect value={p.end_time} step={step} onChange={v => update(i, { end_time: v })} label="End" />
            <span className="text-xs text-muted-foreground tabular-nums">
              {hhmm(p.start_time) !== hhmm(p.end_time) ? fmtHours(rangeMinutes(p.start_time, p.end_time) / 60) : ''}
            </span>
            <select value={statusOf(p)} onChange={e => update(i, { status: e.target.value })} aria-label="Working or time off"
              className={cn('h-11 rounded-lg border px-2 text-xs font-semibold touch-manipulation', STATUS_SOFT[statusOf(p)])}>
              {ENTRY_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label} · {s.name}</option>)}
            </select>
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
  const allDay = week.entries.filter(e => e.work_date === day)
  const dayEntries = allDay.filter(e => statusOf(e) === 'on')
  // One line per person off that day, with every kind of time off they have.
  const away = Object.values(allDay.filter(e => statusOf(e) !== 'on').reduce((m, e) => {
    const person = staffById[e.staff_id]
    if (!person) return m
    const row = (m[e.staff_id] ??= { person, statuses: new Set() })
    row.statuses.add(statusOf(e))
    return m
  }, {}))
  const byShift = week.shifts
    .map(s => ({ shift: s, people: dayEntries.filter(e => e.shift_id === s.id).map(e => staffById[e.staff_id]).filter(Boolean) }))
    .filter(g => g.people.length)
  const periods = dayEntries.filter(e => !e.shift_id)
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time))
    .map(e => ({ ...e, person: staffById[e.staff_id] })).filter(e => e.person)

  const awayList = away.length > 0 && (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-1">Off · {away.length}</p>
      <ul className="divide-y rounded-lg border">
        {away.map(({ person, statuses }) => (
          <li key={person.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="flex-1 min-w-0 truncate">{person.name}</span>
            {[...statuses].map(k => <StatusBadge key={k} status={k} />)}
          </li>
        ))}
      </ul>
    </div>
  )
  if (!byShift.length && !periods.length) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground py-4 text-center">Nobody working on {format(parseISO(day), 'EEEE d MMM')}.</p>
        {awayList}
      </div>
    )
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
      {awayList}
    </div>
  )
}

// ── Pay ───────────────────────────────────────────────────────

function rostered(rows) {
  return rows.filter(r => r.entry_count > 0 || r.pay_override != null || r.adjustments?.length > 0 || r.carried_owed > 0)
}

// Pay adjustments (rota_pay_adjustments, migration 137). A cash advance is
// paid now (added to this week's pay, so it goes in this week's wages and
// the till) and comes off next week's pay as an "advance repaid" line the
// API creates with it. "Owed from last week" is not stored: it's what last
// week's Cash Recon wage row left unpaid.
const ADJ_KINDS = [
  { value: 'extra',     label: 'Extra pay',    sign: 1 },
  { value: 'deduction', label: 'Deduction',    sign: -1 },
  { value: 'advance',   label: 'Cash advance', sign: 1 },
]
const ADJ_LABEL = { extra: 'Extra pay', deduction: 'Deduction', advance: 'Cash advance', advance_repay: 'Advance repaid' }
const ADJ_SIGN = { extra: 1, deduction: -1, advance: 1, advance_repay: -1 }

function adjustmentsNet(r) {
  const sum = (r.adjustments ?? []).reduce((s, a) => s + ADJ_SIGN[a.kind] * a.amount, 0)
  return Math.round((sum + (r.carried_owed ?? 0)) * 100) / 100
}

function signed(n) {
  return `${n < 0 ? '−' : '+'}${fmt(Math.abs(n))}`
}

function AdjustmentLine({ a, canEdit, busy, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(a.amount))
  const [note, setNote] = useState(a.note ?? '')
  const sign = ADJ_SIGN[a.kind]
  if (editing) {
    return (
      <div className="rounded-lg border p-2 space-y-2">
        <div className="text-xs font-medium">{ADJ_LABEL[a.kind]}</div>
        <div className="flex gap-2">
          <input className={cn(inputCls, 'w-28')} inputMode="decimal" value={amount} aria-label="Amount"
            onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          <input className={inputCls} value={note} placeholder="Note" aria-label="Note" onChange={e => setNote(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy || !(Number(amount) > 0)}
            onClick={() => onSave({ amount: Number(amount), note: note.trim() || null }, () => setEditing(false))}
            className="h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">Save</button>
          <button type="button" onClick={() => { setEditing(false); setAmount(String(a.amount)); setNote(a.note ?? '') }}
            className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={!canEdit} onClick={() => setEditing(true)}
        className={cn('flex-1 min-w-0 min-h-[44px] rounded-lg px-2 text-left touch-manipulation', canEdit && 'hover:bg-muted')}>
        <span className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{ADJ_LABEL[a.kind]}</span>
          <span className={cn('tabular-nums shrink-0', sign < 0 ? 'text-red-700' : 'text-green-700')}>{signed(sign * a.amount)}</span>
        </span>
        {(a.note || a.kind === 'advance' || a.kind === 'advance_repay') && (
          <span className="block text-[11px] text-muted-foreground truncate">
            {a.note}
            {a.kind === 'advance' && `${a.note ? ' · ' : ''}comes off next week's pay`}
            {a.kind === 'advance_repay' && `${a.note ? ' · ' : ''}advance given last week`}
          </span>
        )}
      </button>
      {canEdit && <ConfirmDelete onConfirm={onDelete} disabled={busy} label={`Remove ${ADJ_LABEL[a.kind]}`} confirmLabel="Remove" />}
    </div>
  )
}

function PayAdjustModal({ venueId, weekStart, row, canEdit, setPay, onClose }) {
  const api = useApi()
  const [kind, setKind] = useState('extra')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const base = `/rota/venues/${venueId}/weeks/${weekStart}/pay-adjustments`
  const add = useMutation({
    mutationFn: () => api.post(base, { staff_id: row.staff_id, kind, amount: Number(amount), note: note.trim() || null }),
    onSuccess: d => { setPay(d); setAmount(''); setNote('') },
  })
  const patch = useMutation({
    mutationFn: ({ id, body }) => api.patch(`${base}/${id}`, body),
    onSuccess: d => setPay(d),
  })
  const del = useMutation({
    mutationFn: id => api.delete(`${base}/${id}`),
    onSuccess: d => setPay(d),
  })
  const busy = add.isPending || patch.isPending || del.isPending
  const hint = kind === 'advance'
    ? 'Paid now from the till: added to this week\'s pay, and taken off next week\'s pay automatically.'
    : kind === 'deduction' ? 'Taken off this week\'s pay.' : 'Added to this week\'s pay.'

  return createPortal(
    <Modal title={`Pay: ${row.name}`} onClose={onClose}>
      <div className="rounded-xl border divide-y">
        <div className="flex items-center justify-between px-3 py-2 text-sm">
          <span>Rota pay{row.pay_override != null ? ' (override)' : ''}</span>
          <span className="tabular-nums">{fmt(row.base_pay)}</span>
        </div>
        {(row.adjustments ?? []).length > 0 && (
          <div className="px-1 py-1 space-y-1">
            {row.adjustments.map(a => (
              <AdjustmentLine key={a.id} a={a} canEdit={canEdit} busy={busy}
                onSave={(body, done) => patch.mutate({ id: a.id, body }, { onSuccess: done })}
                onDelete={() => del.mutate(a.id)} />
            ))}
          </div>
        )}
        {row.carried_owed > 0 && (
          <div className="px-3 py-2">
            <div className="flex items-center justify-between text-sm">
              <span>Owed from last week</span>
              <span className="tabular-nums text-green-700">{signed(row.carried_owed)}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">Last week's wages weren't paid in full in Cash Recon. Pay it there to remove this.</div>
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold bg-muted/40">
          <span>Total pay</span>
          <span className="tabular-nums">{fmt(row.pay)}</span>
        </div>
      </div>
      {row.pay_shortfall > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Deductions are {fmt(row.pay_shortfall)} more than this week's pay, so pay is £0.00. The rest isn't carried over.
        </p>
      )}

      {canEdit && (
        <div className="rounded-xl border p-3 space-y-2">
          <div className="text-sm font-medium">Add</div>
          <Segmented value={kind} options={ADJ_KINDS} onChange={setKind} className="w-full [&>button]:flex-1" />
          <div className="flex gap-2">
            <label className="flex items-center gap-1 h-11 w-32 shrink-0 rounded-lg border bg-background px-2 text-sm focus-within:ring-2 focus-within:ring-primary/40">
              <span className="text-muted-foreground">£</span>
              <input inputMode="decimal" value={amount} placeholder="0.00" aria-label="Amount"
                onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none touch-manipulation" />
            </label>
            <input className={inputCls} value={note} placeholder="Note (optional)" aria-label="Note" onChange={e => setNote(e.target.value)} />
          </div>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
          <button type="button" onClick={() => add.mutate()} disabled={busy || !(Number(amount) > 0)}
            className="h-11 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
            {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add {ADJ_KINDS.find(k => k.value === kind).label.toLowerCase()}
          </button>
        </div>
      )}
      <ErrorNote error={add.error || patch.error || del.error} />
    </Modal>,
    document.body,
  )
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
/**
 * showSplit: true shows Bank and Cash columns (each person's total split by
 * their pay method, from the API's bank_pay / cash_pay); 'auto' shows them
 * when anyone this week has a bank part.
 */
export function RotaPayTable({ venueId, weekStart, canEdit, showSplit = 'auto' }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading, error } = useRotaPay(venueId, weekStart)
  const [editing, setEditing] = useState(null)
  const [adjusting, setAdjusting] = useState(null)
  const [confirmFill, setConfirmFill] = useState(false)
  const setPay = d => {
    qc.setQueryData(['rota-pay', venueId, weekStart], d)
    // An advance also changes next week's pay.
    qc.invalidateQueries({ queryKey: ['rota-pay', venueId], predicate: q => q.queryKey[2] !== weekStart })
  }

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
  const split = showSplit === 'auto' ? rows.some(r => r.bank_pay > 0) : !!showSplit

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
                <th className="text-right px-2 py-2 font-medium">Rota pay</th>
                <th className="text-right px-2 py-2 font-medium">Adjustments</th>
                <th className="text-right px-3 py-2 font-medium">Total pay</th>
                {split && <th className="text-right px-2 py-2 font-medium">Bank</th>}
                {split && <th className="text-right px-3 py-2 font-medium">Cash</th>}
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
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {fmtHours(r.hours)}
                    {ENTRY_STATUSES.slice(1).filter(s => r.absence_hours?.[s.key] > 0).map(s => (
                      <div key={s.key} className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {s.label} {fmtHours(r.absence_hours[s.key])}{s.key === 'pto' ? ' paid' : ''}
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {editing === r.staff_id ? (
                      <MoneyEdit value={r.pay_override} placeholder={String(r.computed_pay)} saving={override.isPending}
                        onSave={v => override.mutate({ staffId: r.staff_id, pay_override: v })}
                        onClear={r.pay_override != null ? () => override.mutate({ staffId: r.staff_id, pay_override: null }) : null} />
                    ) : (
                      <button type="button" disabled={!canEdit} onClick={() => setEditing(r.staff_id)}
                        className={cn('min-h-[44px] px-2 rounded-lg tabular-nums touch-manipulation', canEdit && 'hover:bg-muted underline decoration-dotted underline-offset-4')}>
                        {fmt(r.base_pay)}
                        {r.pay_override != null && <span className="block text-[10px] text-amber-700 no-underline">override (calc {fmt(r.computed_pay)})</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {(() => {
                      const net = adjustmentsNet(r)
                      const has = (r.adjustments?.length ?? 0) > 0 || r.carried_owed > 0
                      if (!has && !canEdit) return <span className="text-muted-foreground">—</span>
                      return (
                        <button type="button" onClick={() => setAdjusting(r.staff_id)}
                          className="min-h-[44px] px-2 rounded-lg touch-manipulation hover:bg-muted text-right">
                          {has ? (
                            <>
                              <span className={cn('block tabular-nums', net < 0 ? 'text-red-700' : net > 0 ? 'text-green-700' : '')}>{net === 0 ? fmt(0) : signed(net)}</span>
                              <span className="block text-[10px] text-muted-foreground">
                                {[
                                  r.extra_pay > 0 && 'extra',
                                  r.deductions > 0 && 'deduction',
                                  r.advance > 0 && 'advance',
                                  r.advance_repay > 0 && 'advance repaid',
                                  r.carried_owed > 0 && 'owed',
                                ].filter(Boolean).join(', ')}
                              </span>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Plus className="w-3.5 h-3.5" /> Add</span>
                          )}
                        </button>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums font-medium">
                    {fmt(r.pay)}
                    {r.pay_shortfall > 0 && (
                      <span className="flex items-center justify-end gap-1 text-[10px] font-normal text-amber-700">
                        <AlertTriangle className="w-3 h-3" /> {fmt(r.pay_shortfall)} short
                      </span>
                    )}
                  </td>
                  {split && (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                      {r.bank_pay > 0 ? fmt(r.bank_pay) : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  {split && (
                    <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                      {r.cash_pay > 0 ? fmt(r.cash_pay) : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={2}>Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtHours(data.totals.hours)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(rows.reduce((s, r) => s + (r.base_pay ?? 0), 0))}</td>
                <td className="px-2 py-2 text-right tabular-nums">{signed(Math.round(rows.reduce((s, r) => s + adjustmentsNet(r), 0) * 100) / 100)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.pay)}</td>
                {split && <td className="px-2 py-2 text-right tabular-nums">{fmt(data.totals.pay_bank ?? 0)}</td>}
                {split && <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.pay_cash ?? 0)}</td>}
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
        Hours are hours worked. Paid time off (PTO) is paid like the shift; SICK, UTO and ABS are unpaid, and none of them earn tip points.
        Tap a rota pay figure to override it for this week. Tap Adjustments to add extra pay, a deduction or a cash advance (paid now, taken off next week's pay).
        Wages not paid in full last week in Cash Recon are added as Owed from last week.
        Filling wages writes each person's total pay into this week's wage rows (a row already paid in full stays paid) and adds anyone missing; tips are not added to wages.
      </p>
      {adjusting && data.rows.find(r => r.staff_id === adjusting) && (
        <PayAdjustModal venueId={venueId} weekStart={weekStart} canEdit={canEdit} setPay={setPay}
          row={data.rows.find(r => r.staff_id === adjusting)} onClose={() => setAdjusting(null)} />
      )}
    </div>
  )
}

// ── Tips ──────────────────────────────────────────────────────

const DIST_LABEL = { points: 'By points', manual: 'Manual', house: 'Kept by house' }

export function tipRows(data) {
  return data.rows.filter(r => r.entry_count > 0 || r.tip_share > 0 || r.points_adjustment !== 0 || r.tip_adjustment !== 0
    || r.tip_unallocated !== 0 || (r.tip_cash ?? 0) !== 0 || (r.tip_bank ?? 0) !== 0)
}

/** Whether any pot pays by bank or to specific people, so Bank / Cash columns are worth showing. */
function hasPayoutSplit(pots) {
  return pots.some(p => p.distribution !== 'house' && (p.payout_method === 'bank' || p.payout_to === 'people'))
}

/** How a pot is paid out (migration 143), with the people picker for a 'people' pot. */
function PotPayout({ pot, data, canEdit, onPickPayees }) {
  const how = pot.payout_method === 'bank' ? 'By bank transfer' : 'In cash'
  if (pot.payout_to !== 'people') {
    return <p className="text-muted-foreground">{how}, to each person's share.</p>
  }
  const carried = pot.payees_week && pot.payees_week !== data.week_start
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-0">
        {pot.no_payees ? (
          <p className="text-amber-700 font-medium">{how} to specific people: nobody picked, so it is paid as shares.</p>
        ) : (
          <>
            <p>
              <span className="text-muted-foreground">{how} to </span>
              {pot.payees.map((x, i) => (
                <span key={x.staff_id} className="font-medium">
                  {i > 0 && ', '}{x.name}{pot.payees.length > 1 && <span className="font-normal text-muted-foreground"> {fmt(x.amount)}</span>}
                </span>
              ))}
              {pot.payees.length === 1 && <span className="tabular-nums"> {fmt(pot.payees[0].amount)}</span>}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Everyone else's tips are adjusted in {data.tip_settled_in === 'bank' ? 'their bank transfer' : 'cash'} so each person still gets their share.
              {carried && ` Picked in the week of ${format(parseISO(pot.payees_week), 'd MMM')}.`}
            </p>
          </>
        )}
      </div>
      {canEdit && (
        <button type="button" onClick={() => onPickPayees(pot)}
          className="h-10 px-3 rounded-lg border text-xs font-medium touch-manipulation hover:bg-muted">
          {pot.no_payees ? 'Pick people' : 'Change'}
        </button>
      )}
    </div>
  )
}

/** Pick who a 'people' pot is paid to this week (and on, until changed). */
function PayeesModal({ pot, data, base, setPay, onClose }) {
  const api = useApi()
  const [picked, setPicked] = useState(() => new Set(pot.payees.map(x => x.staff_id)))
  const save = useMutation({
    mutationFn: () => api.put(`${base}/pots/${pot.id}/payees`, { staff_ids: [...picked] }),
    onSuccess: d => { setPay(d); onClose() },
  })
  const toggle = id => setPicked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  return (
    <Modal title={`Who is ${pot.name} paid to?`} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
          className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
        <button type="button" onClick={onClose} className="h-11 px-4 rounded-lg border text-sm touch-manipulation hover:bg-muted">Cancel</button>
      </>}>
      <p className="text-xs text-muted-foreground">
        The whole pot ({fmt(pot.total)}) is paid {pot.payout_method === 'bank' ? 'by bank transfer' : 'in cash'} to the people
        you tick, split equally. Everyone's other tips are adjusted so each person still gets their share. This choice is
        kept for the following weeks until you change it. Untick everyone to pay the pot as shares.
      </p>
      <div className="rounded-lg border divide-y">
        {data.rows.map(r => (
          <label key={r.staff_id} className="flex items-center gap-3 px-3 min-h-[48px] touch-manipulation cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={picked.has(r.staff_id)} onChange={() => toggle(r.staff_id)} />
            <span className="flex-1 min-w-0 truncate text-sm">{r.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">share {fmt(r.tip_share)}</span>
          </label>
        ))}
      </div>
      <ErrorNote error={save.error} />
    </Modal>
  )
}

/** A person's tips bank or cash figure; below 0 means they hand that much on to others. */
export function TipMoneyCell({ value }) {
  if (value < 0) {
    return <span className="text-red-700 font-medium" title="Paid more than their share through a pot paid to them: hands this much on">hands on {fmt(-value)}</span>
  }
  return value ? fmt(value) : '–'
}

function moneyInput(v) {
  return v.replace(/[^0-9.]/g, '')
}

/** Like moneyInput but keeps a leading minus (pot lines can be deductions). */
function signedInput(v) {
  const neg = v.trim().startsWith('-')
  const n = v.replace(/[^0-9.]/g, '')
  return neg ? `-${n}` : n
}

/** Flip the sign of a typed value; tablets' decimal keypads have no minus key. */
function flipSign(v) {
  const s = String(v ?? '')
  return s.startsWith('-') ? s.slice(1) : `-${s}`
}

function pctLabel(n) {
  return `${n > 0 ? '+' : ''}${n}%`
}

/** One pot: where its money comes from (sources, manual lines) and what happened to it. */
function PotCard({ pot, data, canEdit, base, setPay, onEditManual, onPickPayees }) {
  const api = useApi()
  const saved = useMemo(() => Object.fromEntries(pot.lines.map(l => [l.id, l.amount ? String(l.amount) : ''])), [pot.lines])
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const dirty = pot.lines.some(l => (draft[l.id] ?? '') !== (saved[l.id] ?? ''))
  const lineProblem = pot.lines.find(l => {
    const n = Number(draft[l.id])
    return l.kind === 'percent' && draft[l.id] && !Number.isNaN(n) && (n < -100 || n > 100)
  })
  const saveLines = useMutation({
    mutationFn: () => api.put(`${base}/pot-lines`, {
      amounts: pot.lines.map(l => {
        const v = draft[l.id]
        const n = v === '' || v === '-' || v == null ? null : Number(v)
        return { line_id: l.id, amount: n == null || Number.isNaN(n) ? null : n }
      }),
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
        {pot.lines.map(l => {
          const pct = l.kind === 'percent'
          const neg = String(draft[l.id] ?? '').startsWith('-')
          return (
            <div key={l.id} className="flex items-center gap-2 min-h-[44px]">
              <span className="flex-1 min-w-0 truncate">
                {l.name}
                {pct && l.amount !== 0 && (
                  <span className={cn('ml-1 text-[11px] tabular-nums', l.value < 0 ? 'text-red-700' : 'text-muted-foreground')}>
                    = {fmt(l.value)}
                  </span>
                )}
              </span>
              {canEdit ? (
                <>
                  <button type="button" onClick={() => setDraft(d => ({ ...d, [l.id]: flipSign(d[l.id]) }))}
                    aria-label={neg ? `Make ${l.name} an addition` : `Make ${l.name} a deduction`}
                    className={cn('h-10 w-11 rounded-lg border text-sm font-semibold touch-manipulation shrink-0',
                      neg ? 'bg-red-50 border-red-300 text-red-700' : 'hover:bg-muted')}>
                    {neg ? '−' : '+'}
                  </button>
                  <div className="relative shrink-0">
                    <input className={cn('h-10 w-28 rounded-lg border bg-background pl-2 text-sm text-right tabular-nums touch-manipulation',
                      pct ? 'pr-6' : 'pr-2', neg && 'text-red-700')}
                      inputMode="decimal" placeholder={pct ? '0' : '0.00'} aria-label={`${l.name} ${pct ? 'percent' : 'amount'}`}
                      value={draft[l.id] ?? ''} onChange={e => setDraft(d => ({ ...d, [l.id]: signedInput(e.target.value) }))} />
                    {pct && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>}
                  </div>
                </>
              ) : (
                <span className={cn('tabular-nums', l.value < 0 && 'text-red-700')}>{pct ? pctLabel(l.amount) : fmt(l.amount)}</span>
              )}
            </div>
          )
        })}
        {canEdit && dirty && (
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setDraft(saved)}
              className="h-10 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Discard</button>
            <button type="button" onClick={() => saveLines.mutate()} disabled={saveLines.isPending || !!lineProblem}
              className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium touch-manipulation disabled:opacity-50">Save amounts</button>
          </div>
        )}
        {canEdit && dirty && lineProblem && (
          <p className="text-xs text-red-700">{lineProblem.name}: enter a percentage between -100 and 100.</p>
        )}
        <ErrorNote error={saveLines.error} />
        {pot.surcharge > 0 && (
          <div className="pt-1 border-t mt-1 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="flex-1">Pot before deductions</span>
              <span className="tabular-nums">{fmt(pot.gross)}</span>
            </div>
            {pot.surcharges.filter(s => s.amount > 0).map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-amber-800">
                <span className="flex-1">{s.name || 'Fee'} ({s.pct}%{i > 0 ? ' of what is left' : ''})</span>
                <span className="tabular-nums">−{fmt(s.amount)}</span>
              </div>
            ))}
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
        {pot.distribution !== 'house' && (
          <div className="pt-1 border-t mt-1 text-xs">
            <PotPayout pot={pot} data={data} canEdit={canEdit} onPickPayees={onPickPayees} />
          </div>
        )}
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

// ── Tip moves ──────────────────────────────────────────────────
//
// A move takes points or £ from one person and gives it to one or more
// people. An "add" gives people extra (a bonus) and a "take out" removes an
// amount from people, neither passing it on (migration 117); both need a
// reason. The split (equally, by amount, by %) is worked out here and sent as
// final amounts per recipient, in hundredths, so the lines always add up to
// exactly what the giver loses.

const toHundredths = v => Math.round(Number(v || 0) * 100)

/** Split `total` into `n` parts (hundredths), remainder to the first parts. */
export function splitEvenly(total, n) {
  const t = toHundredths(total)
  if (n <= 0 || t <= 0) return []
  const base = Math.floor(t / n)
  return Array.from({ length: n }, (_, i) => (base + (i < t - base * n ? 1 : 0)) / 100)
}

/** Split `total` by percentages (should add up to 100); rounding lands on the largest share. */
export function splitByPercent(total, pcts) {
  const t = toHundredths(total)
  const raw = pcts.map(p => Math.floor((t * Number(p || 0)) / 100))
  const diff = t - raw.reduce((s, v) => s + v, 0)
  if (raw.length && diff !== 0) {
    const i = raw.indexOf(Math.max(...raw))
    raw[i] += diff
  }
  return raw.map(v => v / 100)
}

const MOVE_ACTIONS = [
  { value: 'move',   label: 'Move' },
  { value: 'add',    label: 'Add' },
  { value: 'remove', label: 'Take out' },
]

function TipMoveModal({ data, base, setPay, hasPoints, onClose }) {
  const api = useApi()
  const [action, setAction] = useState('move')
  const [kind, setKind] = useState('money')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState([])            // recipient staff ids, in tap order
  const [split, setSplit] = useState('equal') // equal | amount | percent
  const [total, setTotal] = useState('')
  const [amounts, setAmounts] = useState({})  // by amount: staff_id -> value
  const [pcts, setPcts] = useState({})        // by %: staff_id -> value
  const [note, setNote] = useState('')

  const unitLabel = kind === 'money' ? '£' : 'points'
  const valueOf = r => (kind === 'money' ? r.tip_share : r.points)
  const fromRow = data.rows.find(r => r.staff_id === from)
  const available = fromRow ? valueOf(fromRow) : 0
  const fromOptions = data.rows.filter(r => valueOf(r) > 0)
  const isMove = action === 'move'
  const people = isMove ? data.rows.filter(r => r.staff_id !== from)
    : action === 'remove' ? data.rows.filter(r => valueOf(r) > 0 || to.includes(r.staff_id))
    : data.rows
  const show = v => (kind === 'money' ? fmt(v) : `${Math.round(v * 100) / 100} pts`)
  const verb = isMove ? 'Move' : action === 'add' ? 'Add' : 'Take out'

  const lines = useMemo(() => {
    if (!to.length) return []
    if (split === 'equal') return splitEvenly(total, to.length).map((a, i) => ({ to_staff_id: to[i], amount: a }))
    if (split === 'percent') return splitByPercent(total, to.map(id => pcts[id])).map((a, i) => ({ to_staff_id: to[i], amount: a }))
    return to.map(id => ({ to_staff_id: id, amount: toHundredths(amounts[id]) / 100 }))
  }, [to, split, total, amounts, pcts])
  const sum = lines.reduce((s, l) => s + toHundredths(l.amount), 0) / 100
  const pctSum = to.reduce((s, id) => s + Number(pcts[id] || 0), 0)

  const shortRow = action === 'remove'
    ? lines.map(l => data.rows.find(r => r.staff_id === l.to_staff_id)).find((r, i) => r && lines[i].amount > valueOf(r) + 1e-9)
    : null

  let problem = null
  if (isMove && !from) problem = 'Pick who to take from.'
  else if (!to.length) problem = isMove || action === 'add' ? 'Pick at least one person to give to.' : 'Pick at least one person to take from.'
  else if (split === 'percent' && Math.abs(pctSum - 100) > 0.001) problem = `Percentages add up to ${Math.round(pctSum * 100) / 100}%, not 100%.`
  else if (lines.some(l => !(l.amount > 0))) problem = 'Every person needs an amount of at least 0.01.'
  else if (isMove && sum > available + 1e-9) problem = `${fromRow.name} only has ${show(available)}.`
  else if (shortRow) problem = `${shortRow.name} only has ${show(valueOf(shortRow))}.`
  else if (!isMove && !note.trim()) problem = 'Enter a reason.'

  function toggle(id) {
    setTo(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]))
  }

  const save = useMutation({
    mutationFn: () => api.post(`${base}/tip-moves`, {
      kind, action, from_staff_id: isMove ? from : null, lines, note: note.trim() || null,
    }),
    onSuccess: d => { setPay(d); onClose() },
  })

  return (
    <Modal title={isMove ? 'Move tips' : action === 'add' ? 'Add to tips' : 'Take out of tips'} onClose={onClose}
      footer={<>
        <button type="button" onClick={() => save.mutate()} disabled={!!problem || save.isPending}
          className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-1.5">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {verb} {sum > 0 ? show(sum) : ''}
        </button>
      </>}>
      <Segmented value={action} options={MOVE_ACTIONS} className="w-full [&>button]:flex-1"
        onChange={a => { setAction(a); setFrom(''); setTo([]) }} />
      {hasPoints && (
        <Segmented value={kind} onChange={k => { setKind(k); setFrom(''); setTo([]) }}
          options={[{ value: 'money', label: '£ amount' }, { value: 'points', label: 'Points' }]} />
      )}
      <p className="text-xs text-muted-foreground">
        {isMove && (kind === 'money'
          ? 'Takes a £ amount off one person\'s total tips after every pot is shared, and gives it to the people you pick.'
          : 'Takes points off one person and gives them to the people you pick. Changes everyone\'s share of every pot shared by points.')}
        {action === 'add' && (kind === 'money'
          ? 'Gives the people you pick an extra £ amount on top of their tips, e.g. a bonus. Nobody else loses anything.'
          : 'Gives the people you pick extra points. Everyone else\'s share of pots shared by points goes down a little.')}
        {action === 'remove' && (kind === 'money'
          ? 'Takes a £ amount off the people you pick. It is not passed to anyone else.'
          : 'Takes points off the people you pick. Everyone else\'s share of pots shared by points goes up a little.')}
      </p>

      {isMove && <label className="block">
        <span className="block text-xs font-medium text-muted-foreground mb-1">Take from</span>
        <select value={from} onChange={e => { setFrom(e.target.value); setTo(t => t.filter(x => x !== e.target.value)) }}
          className="h-11 w-full rounded-lg border bg-background px-2 text-sm touch-manipulation">
          <option value="">Choose…</option>
          {fromOptions.map(r => <option key={r.staff_id} value={r.staff_id}>{r.name} ({show(valueOf(r))})</option>)}
        </select>
      </label>}

      {(!isMove || from) && <>
        <div>
          <span className="block text-xs font-medium text-muted-foreground mb-1">
            {action === 'remove' ? 'Take from' : 'Give to'} ({to.length} picked)
          </span>
          <div className="rounded-lg border divide-y max-h-56 overflow-y-auto">
            {people.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Nobody has any {kind === 'money' ? 'tips' : 'points'} this week.</p>}
            {people.map(r => {
              const on = to.includes(r.staff_id)
              return (
                <button key={r.staff_id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(r.staff_id)}
                  className="w-full min-h-[44px] flex items-center gap-3 px-3 text-left text-sm touch-manipulation hover:bg-muted">
                  <span className={cn('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0', on ? 'bg-primary border-primary text-primary-foreground' : 'bg-background')}>
                    {on && <Check className="w-3.5 h-3.5" />}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{show(valueOf(r))}</span>
                </button>
              )
            })}
          </div>
        </div>

        {to.length > 0 && <>
          <Segmented value={split} onChange={setSplit}
            options={[
              { value: 'equal', label: 'Equally' },
              { value: 'amount', label: kind === 'money' ? 'By £' : 'By points' },
              { value: 'percent', label: 'By %' },
            ]} />

          {split !== 'amount' && (
            <label className="block">
              <span className="block text-xs font-medium text-muted-foreground mb-1">
                {isMove ? `Total to move (${unitLabel}, up to ${show(available)})` : `Total to ${action === 'add' ? 'add' : 'take out'} (${unitLabel})`}
              </span>
              <div className="flex gap-2">
                <input className={cn(inputCls, 'flex-1')} inputMode="decimal" placeholder="0.00"
                  value={total} onChange={e => setTotal(moneyInput(e.target.value))} />
                {isMove && (
                  <button type="button" onClick={() => setTotal(String(available))}
                    className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">All</button>
                )}
              </div>
            </label>
          )}

          <div className="rounded-lg border divide-y">
            {to.map((id, i) => {
              const r = data.rows.find(x => x.staff_id === id)
              const amount = lines[i]?.amount ?? 0
              return (
                <div key={id} className="flex items-center gap-2 px-3 py-1.5 min-h-[48px]">
                  <span className="flex-1 min-w-0 truncate text-sm">{r?.name}</span>
                  {split === 'amount' && (
                    <input className="h-10 w-24 rounded-lg border bg-background px-2 text-sm text-right tabular-nums touch-manipulation"
                      inputMode="decimal" placeholder="0.00" aria-label={`${r?.name} amount`}
                      value={amounts[id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [id]: moneyInput(e.target.value) }))} />
                  )}
                  {split === 'percent' && <>
                    <input className="h-10 w-20 rounded-lg border bg-background px-2 text-sm text-right tabular-nums touch-manipulation"
                      inputMode="decimal" placeholder="0" aria-label={`${r?.name} percent`}
                      value={pcts[id] ?? ''} onChange={e => setPcts(p => ({ ...p, [id]: moneyInput(e.target.value) }))} />
                    <span className="text-sm text-muted-foreground">%</span>
                  </>}
                  {split !== 'amount' && <span className="w-20 text-right text-sm tabular-nums">{amount > 0 ? show(amount) : '–'}</span>}
                </div>
              )
            })}
            <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold bg-muted/40">
              <span>Total</span>
              <span className="tabular-nums">{show(sum)}{split === 'percent' && ` · ${Math.round(pctSum * 100) / 100}%`}</span>
            </div>
          </div>
          {split === 'percent' && (
            <button type="button" onClick={() => setPcts(Object.fromEntries(to.map((id, i) => [id, String(splitEvenly(100, to.length)[i])])))}
              className="h-10 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Split % evenly</button>
          )}
        </>}

        <label className="block">
          <span className="block text-xs font-medium text-muted-foreground mb-1">{isMove ? 'Note (optional)' : 'Reason'}</span>
          <input className={inputCls} value={note} maxLength={300} onChange={e => setNote(e.target.value)}
            placeholder={isMove ? 'e.g. covered the late shift' : action === 'add' ? 'e.g. employee of the month bonus' : 'e.g. till shortage'} />
        </label>
      </>}

      {problem && (from || to.length > 0) && <p className="text-xs text-amber-700">{problem}</p>}
      <ErrorNote error={save.error} />
    </Modal>
  )
}

/** The week's tip moves, newest last, each deletable on its own. */
function TipMovesList({ moves, base, setPay, canEdit }) {
  const api = useApi()
  const remove = useMutation({
    mutationFn: id => api.delete(`${base}/tip-moves/${id}`),
    onSuccess: setPay,
  })
  return (
    <div className="space-y-1.5">
      {moves.map(m => (
        <div key={m.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
          <div className="flex-1 min-w-0 text-sm">
            <div className="flex flex-wrap items-center gap-x-1.5">
              {m.action === 'move' || !m.action ? <>
                <span className="font-medium">{m.from_name}</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
              </> : (
                <span className={cn('text-[11px] font-semibold px-1.5 py-0.5 rounded',
                  m.action === 'add' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>
                  {m.action === 'add' ? 'Added' : 'Taken out'}
                </span>
              )}
              <span className="text-muted-foreground">
                {m.lines.map(l => `${l.name} ${m.kind === 'money' ? fmt(l.amount) : `${l.amount} pts`}`).join(', ')}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {m.kind === 'money' ? fmt(m.total) : `${m.total} points`}{' '}
              {m.action === 'add' ? 'added' : m.action === 'remove' ? 'taken out' : 'moved'}
              {' · '}{format(new Date(m.created_at), 'EEE d MMM HH:mm')}
              {m.note && ` · ${m.note}`}
            </div>
          </div>
          {canEdit && <ConfirmDelete label="Delete this entry" confirmLabel="Yes, undo" onConfirm={() => remove.mutate(m.id)} disabled={remove.isPending} />}
        </div>
      ))}
      <ErrorNote error={remove.error} />
    </div>
  )
}

const NUDGE_STEP = 0.5

/**
 * One figure in the tips table: the number, then a small second line (always
 * there, blank when there's nothing to say) so every figure in a row sits on
 * the same line as the person's name, whichever cells have a second line.
 */
function TipNum({ children, sub, subClass, className }) {
  return (
    <span className={cn('block tabular-nums whitespace-nowrap', className)}>
      {children}
      <span className={cn('block text-[10px] leading-4 font-normal', subClass ?? 'text-muted-foreground')}>{sub || ' '}</span>
    </span>
  )
}

/**
 * A person's tip total as table cells. With edit rights the -/+ buttons
 * (move 0.50 to / from the unallocated pot) get a column each, so the total
 * lines up under the Total heading and with the footer total.
 */
function NudgeCells({ row, unallocated, canEdit, busy, onNudge }) {
  const btn = 'w-11 h-11 rounded-lg border flex items-center justify-center touch-manipulation hover:bg-muted disabled:opacity-30 disabled:pointer-events-none'
  const total = (
    <TipNum className="font-semibold"
      sub={row.tip_unallocated !== 0 && `${row.tip_unallocated > 0 ? '+' : '−'}${fmt(Math.abs(row.tip_unallocated))}`}
      subClass={row.tip_unallocated > 0 ? 'text-green-700' : 'text-red-600'}>
      {fmt(row.tip_share)}
    </TipNum>
  )
  if (!canEdit) return <td className="px-3 py-1.5 text-right">{total}</td>
  return <>
    <td className="pl-2 py-1.5 w-11">
      <button type="button" aria-label={`Take ${fmt(NUDGE_STEP)} from ${row.name} into unallocated`}
        disabled={busy || row.tip_share < NUDGE_STEP} onClick={() => onNudge(row.staff_id, 'minus')} className={btn}>
        <Minus className="w-4 h-4" />
      </button>
    </td>
    <td className="px-2 py-1.5 text-right">{total}</td>
    <td className="pr-3 py-1.5 w-11">
      <button type="button" aria-label={`Give ${row.name} ${fmt(NUDGE_STEP)} from unallocated`}
        disabled={busy || unallocated < NUDGE_STEP} onClick={() => onNudge(row.staff_id, 'plus')} className={btn}>
        <Plus className="w-4 h-4" />
      </button>
    </td>
  </>
}

/**
 * Tip pots for the week, each person's share of every pot, and tip moves.
 * `sections` picks which parts render (the Rota dashboard widget's options);
 * the Rota page shows all three.
 */
const ALL_TIP_SECTIONS = { pots: true, shares: true, moves: true }
export function RotaTipsTable({ venueId, weekStart, canEdit, sections = ALL_TIP_SECTIONS }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading, error } = useRotaPay(venueId, weekStart)
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(null) // null | 'points' | 'money'
  const [manualPot, setManualPot] = useState(null)
  const [payeesPot, setPayeesPot] = useState(null)
  const [confirmHandBack, setConfirmHandBack] = useState(false)
  const setPay = d => qc.setQueryData(['rota-pay', venueId, weekStart], d)
  const base = `/rota/venues/${venueId}/weeks/${weekStart}`

  const nudge = useMutation({
    mutationFn: b => api.post(`${base}/tip-nudge`, b),
    onSuccess: setPay,
  })
  const handBack = useMutation({
    mutationFn: () => api.post(`${base}/reset-unallocated`, {}),
    onSuccess: d => { setPay(d); setConfirmHandBack(false) },
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
  const moves = data.moves ?? []
  const hasPointMoves = moves.some(m => m.kind === 'points')
  const hasMoneyMoves = data.rows.some(r => r.tip_adjustment !== 0)
  const unallocated = data.totals.tips_unallocated ?? 0
  const hasNudges = data.rows.some(r => r.tip_unallocated !== 0)
  const showTotal = sharedPots.length > 1 || hasMoneyMoves || hasNudges || canEdit
  const showPayout = hasPayoutSplit(pots)
  const onNudge = (staff_id, direction) => nudge.mutate({ staff_id, direction })

  if (!sections.pots && !sections.shares && !sections.moves) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Every part of this widget is hidden. Turn one back on in Edit layout.</p>
  }

  return (
    <div className="space-y-3">
      {sections.pots && <>
      {/* Columns follow the space the table actually has (a narrow dashboard
          widget, a phone), not the screen width: as many pots side by side as
          fit at the minimum card width. */}
      <div className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${canEdit ? 250 : 180}px), 1fr))` }}>
        {pots.map(p => (
          <PotCard key={p.id} pot={p} data={data} canEdit={canEdit} base={base} setPay={setPay} onEditManual={setManualPot} onPickPayees={setPayeesPot} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Tips in {fmt(data.totals.tips_in)}
        {data.totals.surcharges > 0 && ` (after ${fmt(data.totals.surcharges)} surcharges)`}
        {' '}· shared with staff {fmt(data.totals.tips_shared)}
        {data.totals.kept_by_house > 0 && ` · kept by the house ${fmt(data.totals.kept_by_house)}`}
        {data.totals.tips_added > 0 && ` · added ${fmt(data.totals.tips_added)}`}
        {data.totals.tips_taken_out > 0 && ` · taken out ${fmt(data.totals.tips_taken_out)}`}
        {unallocated > 0 && ` · unallocated ${fmt(unallocated)}`}
      </p>
      {showPayout && (
        <p className="text-xs">
          <span className="font-medium">Pay out:</span> {fmt(data.totals.tips_bank)} by bank transfer, {fmt(data.totals.tips_cash)} in cash
          {data.totals.tips_handed_on > 0 && (
            <span className="text-red-700 font-medium"> · {fmt(data.totals.tips_handed_on)} to be handed on by people paid more than their share</span>
          )}
        </p>
      )}
      </>}

      {sections.shares && sharedPots.length > 0 && rows.length > 0 && (canEdit || hasNudges) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Unallocated <span className="tabular-nums">{fmt(unallocated)}</span></p>
            <p className="text-[11px] text-muted-foreground">
              {canEdit
                ? `Tap − next to someone's total to put ${fmt(NUDGE_STEP)} of their tips here, + to give ${fmt(NUDGE_STEP)} from here to them. Anything left stays unallocated.`
                : 'Tips taken off people and not given to anyone else.'}
            </p>
          </div>
          {canEdit && hasNudges && !confirmHandBack && (
            <button type="button" onClick={() => setConfirmHandBack(true)}
              className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4" /> Undo all
            </button>
          )}
          {confirmHandBack && (
            <>
              <span className="text-xs text-muted-foreground">Put every +/− back as it was?</span>
              <button type="button" onClick={() => handBack.mutate()} disabled={handBack.isPending}
                className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium touch-manipulation">Yes, undo</button>
              <button type="button" onClick={() => setConfirmHandBack(false)}
                className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Cancel</button>
            </>
          )}
          {(nudge.error || handBack.error) && <div className="basis-full"><ErrorNote error={nudge.error || handBack.error} /></div>}
        </div>
      )}

      {sections.shares && sharedPots.length > 0 && (rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nobody on the rota this week.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              {/* Headings sit on the bottom line, so a pot name that wraps
                  (kept narrow so long names don't stretch the column) still
                  lines up with the one-line headings. */}
              <tr className="align-bottom">
                <th className="text-left px-3 py-2 font-medium">Staff</th>
                {hasPoints && <>
                  <th className="text-right px-2 py-2 font-medium" title="Shift points x role multiplier">Earned</th>
                  <th className="text-right px-2 py-2 font-medium">Moved</th>
                  <th className="text-right px-2 py-2 font-medium">Points</th>
                </>}
                {sharedPots.map(p => (
                  <th key={p.id} className="text-right px-2 py-2 font-medium leading-tight">
                    <span className="inline-block w-max max-w-[7rem]">{p.name}</span>
                  </th>
                ))}
                {hasMoneyMoves && <th className="text-right px-2 py-2 font-medium whitespace-nowrap">Adjusted £</th>}
                {showTotal && (canEdit
                  ? <><th /><th className="text-right px-2 py-2 font-medium">Total</th><th /></>
                  : <th className="text-right px-3 py-2 font-medium">Total</th>)}
                {showPayout && <>
                  <th className="text-right px-2 py-2 font-medium whitespace-nowrap">Bank</th>
                  <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Cash</th>
                </>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.staff_id}>
                  <td className="px-3 py-1.5">
                    <div className="font-medium truncate max-w-[160px]">{r.name}</div>
                    <div className="text-[11px] leading-4 text-muted-foreground whitespace-nowrap">
                      {r.role_name ?? 'No role'}{hasPoints ? ` ×${Number(r.role_multiplier).toFixed(2)}` : ''}
                    </div>
                  </td>
                  {hasPoints && <>
                    <td className="px-2 py-1.5 text-right"><TipNum>{r.base_points}</TipNum></td>
                    <td className="px-2 py-1.5 text-right">
                      <TipNum className={r.points_adjustment > 0 ? 'text-green-700' : r.points_adjustment < 0 ? 'text-red-600' : 'text-muted-foreground'}>
                        {r.points_adjustment > 0 ? '+' : ''}{r.points_adjustment || '–'}
                      </TipNum>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <TipNum className="font-medium"
                        sub={data.totals.points > 0 && `${Math.round((r.points / data.totals.points) * 1000) / 10}%`}>
                        {r.points}
                      </TipNum>
                    </td>
                  </>}
                  {sharedPots.map(p => {
                    const v = r.pot_shares[p.id] ?? 0
                    const exact = r.pot_shares_exact?.[p.id]
                    return (
                      <td key={p.id} className="px-2 py-1.5 text-right">
                        <TipNum sub={exact != null && exact !== v && `exact ${fmt(exact)}`}>{v ? fmt(v) : '–'}</TipNum>
                      </td>
                    )
                  })}
                  {hasMoneyMoves && (
                    <td className="px-2 py-1.5 text-right">
                      <TipNum className={r.tip_adjustment > 0 ? 'text-green-700' : r.tip_adjustment < 0 ? 'text-red-600' : 'text-muted-foreground'}>
                        {r.tip_adjustment ? `${r.tip_adjustment > 0 ? '+' : '−'}${fmt(Math.abs(r.tip_adjustment))}` : '–'}
                      </TipNum>
                    </td>
                  )}
                  {showTotal && (
                    <NudgeCells row={r} unallocated={unallocated} canEdit={canEdit} busy={nudge.isPending} onNudge={onNudge} />
                  )}
                  {showPayout && <>
                    <td className="px-2 py-1.5 text-right"><TipNum><TipMoneyCell value={r.tip_bank} /></TipNum></td>
                    <td className="px-3 py-1.5 text-right"><TipNum><TipMoneyCell value={r.tip_cash} /></TipNum></td>
                  </>}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2">Total</td>
                {hasPoints && <><td colSpan={2} /><td className="px-2 py-2 text-right tabular-nums">{data.totals.points}</td></>}
                {sharedPots.map(p => <td key={p.id} className="px-2 py-2 text-right tabular-nums">{fmt(p.distributed)}</td>)}
                {hasMoneyMoves && <td />}
                {showTotal && (canEdit
                  ? <><td /><td className="px-2 py-2 text-right tabular-nums">{fmt(data.totals.tips_shared)}</td><td /></>
                  : <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.tips_shared)}</td>)}
                {showPayout && <>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(data.totals.tips_bank)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.tips_cash)}</td>
                </>}
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {sections.moves && sharedPots.length > 0 && (moves.length > 0 || (canEdit && data.rows.length > 0)) && (
        <div className="rounded-xl border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold flex-1">Tip moves and adjustments{moves.length > 0 ? ` (${moves.length})` : ''}</p>
            {canEdit && data.rows.length > 0 && (
              <button type="button" onClick={() => setMoveOpen(true)}
                className="h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> New
              </button>
            )}
          </div>
          {moves.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Move points or £ from one person to others, add extra (e.g. a bonus) or take an amount out, split equally, by amount or by %. Each entry is kept here and can be undone on its own.
            </p>
          ) : (
            <TipMovesList moves={moves} base={base} setPay={setPay} canEdit={canEdit} />
          )}
          {canEdit && moves.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              {!confirmReset && hasPointMoves && (
                <button type="button" onClick={() => setConfirmReset('points')}
                  className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4" /> Undo all point entries
                </button>
              )}
              {!confirmReset && moves.some(m => m.kind === 'money') && (
                <button type="button" onClick={() => setConfirmReset('money')}
                  className="h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4" /> Undo all £ entries
                </button>
              )}
              {confirmReset && (
                <>
                  <span className="text-xs text-muted-foreground">
                    {confirmReset === 'points' ? 'Delete every point move and adjustment this week?' : 'Delete every £ move and adjustment this week?'}
                  </span>
                  <button type="button" onClick={() => reset.mutate(confirmReset)} disabled={reset.isPending}
                    className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium touch-manipulation">Yes, undo</button>
                  <button type="button" onClick={() => setConfirmReset(null)}
                    className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Cancel</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {moveOpen && (
        <TipMoveModal data={data} base={base} setPay={setPay} hasPoints={hasPoints} onClose={() => setMoveOpen(false)} />
      )}
      <ErrorNote error={reset.error} />
      {manualPot && (
        <ManualShareModal pot={manualPot} data={data} base={base} setPay={setPay} onClose={() => setManualPot(null)} />
      )}
      {payeesPot && (
        <PayeesModal pot={payeesPot} data={data} base={base} setPay={setPay} onClose={() => setPayeesPot(null)} />
      )}
    </div>
  )
}
