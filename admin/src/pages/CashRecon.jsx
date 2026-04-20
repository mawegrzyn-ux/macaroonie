// src/pages/CashRecon.jsx
//
// Cash Reconciliation — daily declaration, weekly wages, and config management.
//
// View state machine:
//   'week'     — week overview grid (default)
//   'day'      — daily declaration form for a specific date
//   'wages'    — weekly wages form
//   'settings' — config management (income sources, payment channels, SC, staff)

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  format, addWeeks, subWeeks, startOfISOWeek, addDays, parseISO,
} from 'date-fns'
import {
  ArrowLeft, Settings, ChevronLeft, ChevronRight,
  Plus, Trash2, Pencil, Check, Camera, X, Loader2,
  ChevronUp, ChevronDown, Lock, MessageSquare, Table2,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useTimelineSettings } from '@/contexts/TimelineSettingsContext'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount) {
  if (amount == null || amount === '' || isNaN(Number(amount))) return '—'
  return `£${Number(amount).toFixed(2)}`
}

function parseNum(v) {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

function getMonday(date) {
  // returns YYYY-MM-DD string for Monday of the ISO week containing `date`
  return format(startOfISOWeek(date instanceof Date ? date : new Date(date)), 'yyyy-MM-dd')
}

function isoWeekDates(weekStartStr) {
  const start = parseISO(weekStartStr)
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
}

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

// ── Shared UI primitives ─────────────────────────────────────────────────────

function SectionCard({ title, children, action }) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm mb-4 overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function StatusBadge({ status }) {
  if (!status || status === 'none') {
    return <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">—</span>
  }
  if (status === 'draft') {
    return <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">Draft</span>
  }
  if (status === 'submitted') {
    return <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">Submitted</span>
  }
  return <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">{status}</span>
}

function TypeBadge({ type }) {
  // Keys are DB values (lowercase/underscore); labels come from TYPE_LABELS map
  const colours = {
    pos:             'bg-blue-100 text-blue-700',
    delivery:        'bg-purple-100 text-purple-700',
    cash:            'bg-green-100 text-green-700',
    card:            'bg-indigo-100 text-indigo-700',
    voucher:         'bg-yellow-100 text-yellow-700',
    online:          'bg-cyan-100 text-cyan-700',
    tips:            'bg-pink-100 text-pink-700',
    service_charge:  'bg-orange-100 text-orange-700',
    other:           'bg-gray-100 text-gray-600',
  }
  const label = TYPE_LABELS[type] ?? type
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', colours[type] ?? 'bg-muted text-muted-foreground')}>
      {label}
    </span>
  )
}

function SaveIndicator({ saving, saved, error }) {
  if (saving) return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>
  if (error)  return <span className="text-xs text-destructive">Save failed</span>
  if (saved)  return <span className="flex items-center gap-1 text-xs text-green-600"><Check className="w-3 h-3" /> Saved</span>
  return null
}

function AmountInput({ value, onChange, onBlur, placeholder = '0.00', className }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.01"
      min="0"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      className={cn(
        'h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
        className
      )}
    />
  )
}

function TextInput({ value, onChange, onBlur, placeholder, className }) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      className={cn(
        'h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
        className
      )}
    />
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer touch-manipulation select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 rounded-full transition-colors touch-manipulation',
          checked ? 'bg-primary' : 'bg-muted'
        )}
      >
        <span className={cn(
          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0'
        )} />
      </button>
      {label && <span className="text-sm">{label}</span>}
    </label>
  )
}

function IconBtn({ onClick, disabled, title, className, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex items-center justify-center w-10 h-10 rounded-xl touch-manipulation',
        'hover:bg-muted transition-colors disabled:opacity-40',
        className
      )}
    >
      {children}
    </button>
  )
}

// ── Notes modal ─────────────────────────────────────────────────────────────

function NoteModal({ label, value, onSave, onClose }) {
  const [draft, setDraft] = useState(value ?? '')
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-background rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-base">Note{label ? ` — ${label}` : ''}</span>
          <IconBtn onClick={onClose}><X className="w-5 h-5" /></IconBtn>
        </div>
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a note for this entry…"
          rows={4}
          className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm resize-none touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-xl border text-sm font-medium touch-manipulation hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { onSave(draft); onClose() }}
            className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation hover:bg-primary/90"
          >
            Save Note
          </button>
        </div>
      </div>
    </div>
  )
}

function NoteButton({ label, value, onSave }) {
  const [open, setOpen] = useState(false)
  const hasNote = !!(value && value.trim())
  return (
    <>
      <button
        type="button"
        title={hasNote ? value : 'Add note'}
        onClick={() => setOpen(true)}
        className={cn(
          'mt-1 h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center touch-manipulation transition-colors',
          hasNote
            ? 'bg-amber-50 border-amber-300 text-amber-600 hover:bg-amber-100'
            : 'bg-background text-muted-foreground hover:bg-muted'
        )}
      >
        <MessageSquare className="w-4 h-4" />
      </button>
      {open && (
        <NoteModal
          label={label}
          value={value}
          onClose={() => setOpen(false)}
          onSave={onSave}
        />
      )}
    </>
  )
}

// ── Venue selector ───────────────────────────────────────────────────────────

function VenueSelector({ venues, venueId, setVenueId }) {
  return (
    <select
      value={venueId ?? ''}
      onChange={e => setVenueId(e.target.value)}
      className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      {venues.map(v => (
        <option key={v.id} value={v.id}>{v.name}</option>
      ))}
    </select>
  )
}

// ── SPREADSHEET VIEW ──────────────────────────────────────────────────────────

function SpreadsheetView({ venueId, venues, setVenueId, weekStart, setWeekStart, onSelectDay, onSelectWages, onSettings, onToggleMode }) {
  const api = useApi()
  const qc  = useQueryClient()

  const { data: config } = useQuery({
    queryKey: ['cash-recon-config', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/config`),
    enabled:  !!venueId,
  })

  const { data: detail, isLoading } = useQuery({
    queryKey: ['cash-recon-week-detail', venueId, weekStart],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/week-detail/${weekStart}`),
    enabled:  !!venueId && !!weekStart,
    staleTime: 0,
  })

  // Per-cell local overrides (uncommitted edits)
  const [overrides,     setOverrides]     = useState({})
  const [editCell,      setEditCell]      = useState(null)   // { date, cat, id }
  const [editVal,       setEditVal]       = useState('')
  const [saving,        setSaving]        = useState({})      // { date: bool }
  const [submittingAll, setSubmittingAll] = useState(false)

  const allowBulkSubmit = config?.venue_settings?.allow_bulk_submit ?? false

  useEffect(() => { setOverrides({}); setEditCell(null) }, [weekStart])

  const dates        = detail?.dates     ?? isoWeekDates(weekStart)
  const visibleDates = detail?.open_dates ?? dates   // only days the venue is open

  const activeSources  = useMemo(() => (config?.income_sources   ?? []).filter(s => s.is_active), [config])
  const activeSc       = useMemo(() => (config?.sc_sources       ?? []).filter(s => s.is_active), [config])
  const activeChannels = useMemo(() => (config?.payment_channels ?? []).filter(s => s.is_active), [config])

  // Get cell value: local override → loaded data → ''
  function getCellVal(date, cat, id) {
    const ov = overrides[date]?.[cat]?.[id]
    if (ov != null) return ov
    const day = detail?.days?.[date]
    if (!day) return ''
    if (cat === 'income')  return String(day.income.find(r => r.source_id  === id)?.gross_amount ?? '')
    if (cat === 'sc')      return String(day.sc.find(r => r.source_id      === id)?.amount       ?? '')
    if (cat === 'takings') return String(day.takings.find(r => r.channel_id === id)?.amount      ?? '')
    return ''
  }

  function cellNum(date, cat, id) { return parseNum(getCellVal(date, cat, id)) }

  // Day totals
  function dayTotal(date, cat) {
    if (cat === 'income')  return activeSources.filter(s => !s.exclude_from_recon).reduce((s, r) => s + cellNum(date, 'income', r.id), 0)
    if (cat === 'sc')      return activeSc.reduce((s, r) => s + cellNum(date, 'sc', r.id), 0)
    if (cat === 'takings') return activeChannels.reduce((s, r) => s + cellNum(date, 'takings', r.id), 0)
    return 0
  }

  function dayExpenses(date) { return parseNum(detail?.days?.[date]?.total_expenses ?? 0) }

  function variance(date) {
    const scInc = activeSc.filter(s => s.included_in_takings).reduce((s, r) => s + cellNum(date, 'sc', r.id), 0)
    return dayTotal(date, 'income') + scInc - dayTotal(date, 'takings')
  }

  function netCash(date) { return dayTotal(date, 'takings') - dayExpenses(date) }

  // Week totals
  function weekTotal(cat, id) {
    return visibleDates.reduce((s, d) => s + cellNum(d, cat, id), 0)
  }
  function weekDayTotal(cat) { return visibleDates.reduce((s, d) => s + dayTotal(d, cat), 0) }
  function weekExpenses()    { return visibleDates.reduce((s, d) => s + dayExpenses(d), 0) }
  function weekNetCash()     { return weekDayTotal('takings') - weekExpenses() }
  function weekNetPosition() {
    const wages = parseNum(detail?.wages_total ?? 0)
    return weekNetCash() - wages
  }

  function startEdit(date, cat, id) {
    if (detail?.days?.[date]?.status === 'submitted') return
    setEditCell({ date, cat, id })
    setEditVal(getCellVal(date, cat, id))
  }

  async function commitEdit(date, cat, id, val) {
    const next = { ...overrides, [date]: { ...(overrides[date] ?? {}), [cat]: { ...(overrides[date]?.[cat] ?? {}), [id]: val } } }
    setOverrides(next)
    setEditCell(null)
    await saveDay(date, next)
  }

  async function saveDay(date, ovr = overrides) {
    setSaving(p => ({ ...p, [date]: true }))
    try {
      const day = detail?.days?.[date]

      const getV = (cat, id) => parseNum(ovr[date]?.[cat]?.[id] ?? getCellVal(date, cat, id))

      const income = activeSources.map(s => {
        const gross = getV('income', s.id)
        const vr    = parseNum(s.vat_rate ?? 0) / 100
        let vat = 0, net = gross
        if (vr > 0) {
          if (s.vat_inclusive) { vat = gross - gross / (1 + vr); net = gross / (1 + vr) }
          else                 { vat = gross * vr }
        }
        const iNotes = day?.income.find(r => r.source_id === s.id)?.notes ?? ''
        return { source_id: s.id, gross_amount: gross, vat_amount: +(vat.toFixed(2)), net_amount: +(net.toFixed(2)), notes: iNotes }
      })

      const sc = activeSc.map(s => ({
        source_id: s.id,
        amount: getV('sc', s.id),
        notes: day?.sc.find(r => r.source_id === s.id)?.notes ?? '',
      }))

      const takings = activeChannels.map(c => ({
        channel_id: c.id,
        amount: getV('takings', c.id),
        notes: day?.takings.find(r => r.channel_id === c.id)?.notes ?? '',
      }))

      const expenses = (day?.expenses ?? []).map(e => ({
        id: e.id, description: e.description, category: e.category ?? null,
        category_id: e.category_id ?? null, amount: parseFloat(e.amount ?? 0), notes: e.notes ?? null,
      }))

      await api.put(`/venues/${venueId}/cash-recon/daily/${date}`, { income, sc, takings, expenses })
      qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId, weekStart] })
      qc.invalidateQueries({ queryKey: ['cash-recon-daily', venueId, date] })
    } catch {}
    setSaving(p => ({ ...p, [date]: false }))
  }

  // Submit all open days in one shot
  async function handleSubmitAll() {
    if (submittingAll) return
    setSubmittingAll(true)
    try {
      for (const date of visibleDates) {
        const day = detail?.days?.[date]
        if (day?.status === 'submitted') continue          // already done
        if (!day && !allowBulkSubmit) continue             // no data + bulk not enabled

        // Build full payload (same logic as saveDay, no intermediate invalidation)
        const getV = (cat, id) => parseNum(overrides[date]?.[cat]?.[id] ?? getCellVal(date, cat, id))

        const income = activeSources.map(s => {
          const gross = getV('income', s.id)
          const vr    = parseNum(s.vat_rate ?? 0) / 100
          let vat = 0, net = gross
          if (vr > 0) {
            if (s.vat_inclusive) { vat = gross - gross / (1 + vr); net = gross / (1 + vr) }
            else                 { vat = gross * vr }
          }
          return { source_id: s.id, gross_amount: gross, vat_amount: +(vat.toFixed(2)), net_amount: +(net.toFixed(2)), notes: day?.income.find(r => r.source_id === s.id)?.notes ?? '' }
        })
        const sc = activeSc.map(s => ({
          source_id: s.id, amount: getV('sc', s.id),
          notes: day?.sc.find(r => r.source_id === s.id)?.notes ?? '',
        }))
        const takings = activeChannels.map(c => ({
          channel_id: c.id, amount: getV('takings', c.id),
          notes: day?.takings.find(r => r.channel_id === c.id)?.notes ?? '',
        }))
        const expenses = (day?.expenses ?? []).map(e => ({
          id: e.id, description: e.description, category: e.category ?? null,
          category_id: e.category_id ?? null, amount: parseFloat(e.amount ?? 0), notes: e.notes ?? null,
        }))

        // PUT creates the report if it doesn't exist yet; also flushes any overrides
        if (overrides[date] || !day) {
          await api.put(`/venues/${venueId}/cash-recon/daily/${date}`, { income, sc, takings, expenses })
        }
        await api.post(`/venues/${venueId}/cash-recon/daily/${date}/submit`)
      }
      setOverrides({})
      qc.invalidateQueries({ queryKey: ['cash-recon-week-detail', venueId, weekStart] })
    } catch { /* individual day failures are silently skipped */ }
    setSubmittingAll(false)
  }

  // Days still needing submission (used to disable the button when done)
  const pendingCount = visibleDates.filter(date => {
    const day = detail?.days?.[date]
    if (day?.status === 'submitted') return false
    return allowBulkSubmit ? true : !!day
  }).length

  // ── Cell renderers ────────────────────────────────────────────────────────

  function EditableCell({ date, cat, id }) {
    const isEdit = editCell?.date === date && editCell?.cat === cat && editCell?.id === id
    const submitted = detail?.days?.[date]?.status === 'submitted'
    const val = getCellVal(date, cat, id)
    const num = parseNum(val)

    if (isEdit) {
      return (
        <td className="px-1.5 py-0 border-r border-border/60 w-[86px] min-w-[86px]">
          <input
            autoFocus
            type="number"
            step="0.01"
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={() => commitEdit(date, cat, id, editVal)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.currentTarget.blur() }
              if (e.key === 'Escape') { setEditCell(null) }
            }}
            className="w-full h-7 bg-primary/10 border border-primary rounded px-1.5 text-xs text-right focus:outline-none"
          />
        </td>
      )
    }

    return (
      <td
        onClick={() => !submitted && startEdit(date, cat, id)}
        className={cn(
          'px-2 py-1 text-xs text-right border-r border-border/60 w-[86px] min-w-[86px] tabular-nums',
          !submitted && 'cursor-pointer hover:bg-muted/60',
          submitted && 'text-muted-foreground',
          num === 0 && 'text-muted-foreground/40'
        )}
      >
        {num !== 0 ? fmt(num) : '—'}
      </td>
    )
  }

  function TotalCell({ value, highlight }) {
    const n = parseNum(value)
    return (
      <td className={cn(
        'px-2 py-1 text-xs text-right font-semibold border-r border-border/60 w-[86px] min-w-[86px] tabular-nums',
        highlight === 'pos' && n > 0 && 'text-green-700',
        highlight === 'neg' && n < 0 && 'text-red-600',
        highlight === 'var' && (n > 0 ? 'text-amber-600' : n < 0 ? 'text-red-600' : 'text-green-700'),
        n === 0 && 'text-muted-foreground/40'
      )}>
        {n !== 0 ? fmt(n) : '—'}
      </td>
    )
  }

  function SectionRow({ label }) {
    return (
      <tr className="bg-muted/70 border-y border-border">
        <td className="sticky left-0 bg-muted px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground z-10 min-w-[150px]">
          {label}
        </td>
        {visibleDates.map(d => <td key={d} className="border-r border-border/60 w-[86px] min-w-[86px]" />)}
        <td className="w-[86px] min-w-[86px]" />
      </tr>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading && !detail) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background border-b px-4 py-2 flex items-center gap-2 shrink-0">
        <VenueSelector venues={venues} venueId={venueId} setVenueId={setVenueId} />
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setWeekStart(getMonday(subWeeks(parseISO(weekStart), 1)))}
            className="flex items-center justify-center w-8 h-8 rounded-lg touch-manipulation hover:bg-muted"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-medium px-1 whitespace-nowrap">
            {format(parseISO(weekStart), 'd MMM')}–{format(addDays(parseISO(weekStart), 6), 'd MMM yyyy')}
          </span>
          <button type="button" onClick={() => setWeekStart(getMonday(addWeeks(parseISO(weekStart), 1)))}
            className="flex items-center justify-center w-8 h-8 rounded-lg touch-manipulation hover:bg-muted"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={handleSubmitAll}
              disabled={submittingAll}
              className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold touch-manipulation hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
            >
              {submittingAll
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Submitting…</>
                : <><Check className="w-3 h-3" /> Submit Week</>
              }
            </button>
          )}
          <button type="button" onClick={onToggleMode} title="Card view"
            className="flex items-center justify-center w-9 h-9 rounded-xl touch-manipulation hover:bg-muted">
            <ChevronDown className="w-4 h-4 rotate-0" />
          </button>
          <button type="button" onClick={onSettings}
            className="flex items-center justify-center w-9 h-9 rounded-xl touch-manipulation hover:bg-muted">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-max border-collapse text-sm">
          {/* Column headers */}
          <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
            <tr>
              <th className="sticky left-0 bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground border-r border-b border-border min-w-[150px] z-20" />
              {visibleDates.map((date) => {
                const day = detail?.days?.[date]
                const isToday = date === todayStr()
                return (
                  <th key={date}
                    onClick={() => onSelectDay(date)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && onSelectDay(date)}
                    className={cn(
                      'px-2 py-2.5 text-center border-r border-b border-border w-[86px] min-w-[86px]',
                      'cursor-pointer select-none touch-manipulation transition-colors',
                      'hover:bg-primary/10 active:bg-primary/20',
                      isToday && 'bg-primary/5'
                    )}
                  >
                    <div className="text-xs font-semibold">{format(parseISO(date), 'EEE')}</div>
                    <div className="text-[10px] text-muted-foreground">{format(parseISO(date), 'd MMM')}</div>
                    <div className="mt-0.5">
                      {saving[date]
                        ? <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground"><Loader2 className="w-2.5 h-2.5 animate-spin" /></span>
                        : day?.status === 'submitted'
                          ? <span className="inline-block rounded-full px-1.5 py-px text-[9px] font-medium bg-green-100 text-green-700">Subm</span>
                          : day?.status === 'draft'
                            ? <span className="inline-block rounded-full px-1.5 py-px text-[9px] font-medium bg-amber-100 text-amber-700">Draft</span>
                            : <span className="text-[9px] text-muted-foreground/40">—</span>
                      }
                    </div>
                  </th>
                )
              })}
              <th className="px-2 py-2 text-center border-b border-border w-[86px] min-w-[86px] bg-muted/30">
                <div className="text-xs font-bold text-muted-foreground">WEEK</div>
              </th>
            </tr>
          </thead>

          <tbody>
            {/* ── INCOME ── */}
            <SectionRow label="Income" />
            {activeSources.map(s => (
              <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20">
                <td className="sticky left-0 bg-background px-3 py-1 text-xs border-r border-border/60 min-w-[150px] z-10 whitespace-nowrap">
                  <span className="font-medium">{s.name}</span>
                  {s.exclude_from_recon && <span className="ml-1 text-[10px] text-muted-foreground">(excl.)</span>}
                </td>
                {visibleDates.map(date => <EditableCell key={date} date={date} cat="income" id={s.id} />)}
                <td className="px-2 py-1 text-xs text-right font-semibold bg-muted/20 tabular-nums w-[86px] min-w-[86px]">
                  {weekTotal('income', s.id) !== 0 ? fmt(weekTotal('income', s.id)) : '—'}
                </td>
              </tr>
            ))}
            <tr className="border-b border-border bg-muted/10">
              <td className="sticky left-0 bg-background px-3 py-1.5 text-xs font-bold border-r border-border/60 min-w-[150px] z-10">Total Income</td>
              {visibleDates.map(d => <TotalCell key={d} value={dayTotal(d, 'income')} />)}
              <td className="px-2 py-1.5 text-xs text-right font-bold bg-muted/30 tabular-nums">{fmt(weekDayTotal('income'))}</td>
            </tr>

            {/* ── SERVICE CHARGES ── */}
            {activeSc.length > 0 && <>
              <SectionRow label="Service Charges" />
              {activeSc.map(s => (
                <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20">
                  <td className="sticky left-0 bg-background px-3 py-1 text-xs border-r border-border/60 min-w-[150px] z-10 whitespace-nowrap">
                    <span className="font-medium">{s.name}</span>
                    {s.included_in_takings && <span className="ml-1 text-[10px] text-amber-600">↳ takings</span>}
                    {s.included_in_sales    && <span className="ml-1 text-[10px] text-emerald-600">↳ sales</span>}
                  </td>
                  {visibleDates.map(date => <EditableCell key={date} date={date} cat="sc" id={s.id} />)}
                  <td className="px-2 py-1 text-xs text-right font-semibold bg-muted/20 tabular-nums w-[86px] min-w-[86px]">
                    {weekTotal('sc', s.id) !== 0 ? fmt(weekTotal('sc', s.id)) : '—'}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-border bg-muted/10">
                <td className="sticky left-0 bg-background px-3 py-1.5 text-xs font-bold border-r border-border/60 min-w-[150px] z-10">Total SC</td>
                {visibleDates.map(d => <TotalCell key={d} value={activeSc.reduce((s, r) => s + cellNum(d, 'sc', r.id), 0)} />)}
                <td className="px-2 py-1.5 text-xs text-right font-bold bg-muted/30 tabular-nums">{fmt(visibleDates.reduce((s, d) => s + activeSc.reduce((s2, r) => s2 + cellNum(d, 'sc', r.id), 0), 0))}</td>
              </tr>
            </>}

            {/* ── TAKINGS ── */}
            <SectionRow label="Takings" />
            {activeChannels.map(c => (
              <tr key={c.id} className="border-b border-border/40 hover:bg-muted/20">
                <td className="sticky left-0 bg-background px-3 py-1 text-xs border-r border-border/60 min-w-[150px] z-10 whitespace-nowrap">
                  <span className="font-medium">{c.name}</span>
                </td>
                {visibleDates.map(date => <EditableCell key={date} date={date} cat="takings" id={c.id} />)}
                <td className="px-2 py-1 text-xs text-right font-semibold bg-muted/20 tabular-nums w-[86px] min-w-[86px]">
                  {weekTotal('takings', c.id) !== 0 ? fmt(weekTotal('takings', c.id)) : '—'}
                </td>
              </tr>
            ))}
            <tr className="border-b border-border bg-muted/10">
              <td className="sticky left-0 bg-background px-3 py-1.5 text-xs font-bold border-r border-border/60 min-w-[150px] z-10">Total Takings</td>
              {visibleDates.map(d => <TotalCell key={d} value={dayTotal(d, 'takings')} />)}
              <td className="px-2 py-1.5 text-xs text-right font-bold bg-muted/30 tabular-nums">{fmt(weekDayTotal('takings'))}</td>
            </tr>

            {/* ── EXPENSES ── */}
            <SectionRow label="Expenses" />
            <tr className="border-b border-border/40">
              <td className="sticky left-0 bg-background px-3 py-1 text-xs font-medium border-r border-border/60 min-w-[150px] z-10">
                Total Expenses
              </td>
              {visibleDates.map(d => (
                <td key={d}
                  onClick={() => onSelectDay(d)}
                  className="px-2 py-1 text-xs text-right border-r border-border/60 w-[86px] min-w-[86px] tabular-nums cursor-pointer hover:bg-muted/60">
                  {dayExpenses(d) !== 0 ? fmt(dayExpenses(d)) : '—'}
                </td>
              ))}
              <td className="px-2 py-1 text-xs text-right font-semibold bg-muted/20 tabular-nums">{fmt(weekExpenses())}</td>
            </tr>

            {/* ── SUMMARY ── */}
            <SectionRow label="Summary" />
            <tr className="border-b border-border/40">
              <td className="sticky left-0 bg-background px-3 py-1 text-xs font-medium border-r border-border/60 min-w-[150px] z-10">Variance</td>
              {visibleDates.map(d => <TotalCell key={d} value={variance(d)} highlight="var" />)}
              <td className="px-2 py-1 text-xs text-right font-semibold bg-muted/20 tabular-nums">
                <span className={cn(visibleDates.reduce((s, d) => s + variance(d), 0) > 0 ? 'text-amber-600' : visibleDates.reduce((s, d) => s + variance(d), 0) < 0 ? 'text-red-600' : 'text-green-700')}>
                  {fmt(visibleDates.reduce((s, d) => s + variance(d), 0))}
                </span>
              </td>
            </tr>
            <tr className="border-b border-border/40">
              <td className="sticky left-0 bg-background px-3 py-1 text-xs font-medium border-r border-border/60 min-w-[150px] z-10">Net Cash</td>
              {visibleDates.map(d => <TotalCell key={d} value={netCash(d)} />)}
              <td className="px-2 py-1 text-xs text-right font-semibold bg-muted/20 tabular-nums">{fmt(weekNetCash())}</td>
            </tr>
            <tr className="border-b border-border/40">
              <td className="sticky left-0 bg-background px-3 py-1 text-xs font-medium border-r border-border/60 min-w-[150px] z-10">
                <span className="flex items-center gap-1">
                  Wages
                  {detail?.wages_status && (
                    <span className={cn('text-[10px] rounded-full px-1.5 py-px', detail.wages_status === 'submitted' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                      {detail.wages_status === 'submitted' ? 'Subm' : 'Draft'}
                    </span>
                  )}
                </span>
              </td>
              {visibleDates.map(d => <td key={d} className="px-2 py-1 text-xs text-right text-muted-foreground/40 border-r border-border/60 w-[86px] min-w-[86px]">—</td>)}
              <td
                onClick={onSelectWages}
                className="px-2 py-1 text-xs text-right font-semibold bg-muted/20 tabular-nums cursor-pointer hover:bg-muted/40">
                {detail?.wages_total ? fmt(detail.wages_total) : '—'}
              </td>
            </tr>
            <tr className="border-b-2 border-border">
              <td className="sticky left-0 bg-background px-3 py-2 text-xs font-bold border-r border-border/60 min-w-[150px] z-10">Net Position</td>
              {visibleDates.map(d => <td key={d} className="border-r border-border/60 w-[86px] min-w-[86px]" />)}
              <td className="px-2 py-2 text-xs text-right font-bold bg-muted/20 tabular-nums">{fmt(weekNetPosition())}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── WEEK VIEW ────────────────────────────────────────────────────────────────

function WeekView({ venueId, venues, setVenueId, weekStart, setWeekStart, onSelectDay, onSelectWages, onSettings, onToggleMode }) {
  const api = useApi()

  const { data: weekData } = useQuery({
    queryKey: ['cash-recon-week', venueId, weekStart],
    queryFn: () => api.get(`/venues/${venueId}/cash-recon/week/${weekStart}`),
    enabled: !!venueId && !!weekStart,
  })

  const days = isoWeekDates(weekStart)
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const today = todayStr()

  function getDayData(dateStr) {
    return weekData?.days?.find(d => d.date === dateStr)
  }

  function getWagesData() {
    return weekData?.wages
  }

  const isThisWeek = weekStart === getMonday(new Date())

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-2">
        <VenueSelector venues={venues} venueId={venueId} setVenueId={setVenueId} />
        <div className="flex items-center gap-1 ml-auto">
          <IconBtn onClick={() => setWeekStart(format(subWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd'))} title="Previous week">
            <ChevronLeft className="w-4 h-4" />
          </IconBtn>
          <button
            type="button"
            className="h-10 px-3 rounded-xl border text-sm font-medium touch-manipulation hover:bg-muted transition-colors whitespace-nowrap"
          >
            {format(parseISO(weekStart), 'dd MMM yyyy')}
          </button>
          <IconBtn onClick={() => setWeekStart(format(addWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd'))} title="Next week">
            <ChevronRight className="w-4 h-4" />
          </IconBtn>
        </div>
        {!isThisWeek && (
          <button
            type="button"
            onClick={() => setWeekStart(getMonday(new Date()))}
            className="h-10 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation"
          >
            This week
          </button>
        )}
        <button type="button" onClick={onToggleMode} title="Spreadsheet view"
          className="flex items-center justify-center w-10 h-10 rounded-xl touch-manipulation hover:bg-muted transition-colors">
          <Table2 className="w-5 h-5" />
        </button>
        <IconBtn onClick={onSettings} title="Settings">
          <Settings className="w-4 h-4" />
        </IconBtn>
      </div>

      <div className="p-4 space-y-3">
        {/* Week label */}
        <p className="text-xs text-muted-foreground">Week of {format(parseISO(weekStart), 'EEEE d MMMM yyyy')}</p>

        {/* 7 day cards — single column on mobile, 2-col sm, 7-col xl */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
          {days.map((dateStr, i) => {
            const d = getDayData(dateStr)
            const isToday = dateStr === today
            const variance = d ? (parseNum(d.total_income) + parseNum(d.total_sc_in_takings)) - parseNum(d.total_takings) : null
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => onSelectDay(dateStr)}
                className={cn(
                  'rounded-2xl border bg-card shadow-sm p-4 text-left touch-manipulation transition-colors hover:border-primary/60',
                  isToday && 'ring-2 ring-primary/30'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{dayNames[i]}</span>
                  <StatusBadge status={d?.status ?? 'none'} />
                </div>
                <div className="text-xs text-muted-foreground mb-1">{format(parseISO(dateStr), 'd MMM')}</div>
                {d?.total_income != null ? (
                  <>
                    <div className="text-base font-bold">{fmt(d.total_income)}</div>
                    {variance !== null && variance !== 0 && (
                      <div className={cn('text-xs mt-1', variance < 0 ? 'text-red-600' : 'text-amber-600')}>
                        {variance > 0 ? '+' : ''}{fmt(variance)} variance
                      </div>
                    )}
                    {variance === 0 && (
                      <div className="text-xs mt-1 text-green-600 flex items-center gap-0.5"><Check className="w-3 h-3" /> Balanced</div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground mt-1">No report</div>
                )}
              </button>
            )
          })}
        </div>

        {/* Wages card */}
        {(() => {
          const w = getWagesData()
          return (
            <button
              type="button"
              onClick={onSelectWages}
              className="w-full rounded-2xl border bg-card shadow-sm p-4 text-left touch-manipulation transition-colors hover:border-primary/60"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold">Wages — Week of {format(parseISO(weekStart), 'd MMM')}</span>
                <StatusBadge status={w?.status ?? 'none'} />
              </div>
              {w?.total_wages != null
                ? <div className="text-base font-bold">{fmt(w.total_wages)}</div>
                : <div className="text-xs text-muted-foreground">No wages recorded</div>
              }
            </button>
          )
        })()}
      </div>
    </div>
  )
}

// ── DAY VIEW ─────────────────────────────────────────────────────────────────

function DayView({ venueId, date, onBack }) {
  const api = useApi()
  const qc  = useQueryClient()

  const [saving, setSaving]   = useState(false)
  const [saved,  setSaved]    = useState(false)
  const [saveErr, setSaveErr] = useState(false)
  const saveTimerRef = useRef(null)

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['cash-recon-config', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/config`),
    enabled:  !!venueId,
  })

  const { data: daily, isLoading: dailyLoading } = useQuery({
    queryKey: ['cash-recon-daily', venueId, date],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/daily/${date}`),
    enabled:  !!venueId && !!date,
  })

  // Local form state
  const [incomeValues,  setIncomeValues]  = useState({})
  const [incomeNotes,   setIncomeNotes]   = useState({})
  const [scValues,      setScValues]      = useState({})
  const [scNotes,       setScNotes]       = useState({})
  const [takingsValues, setTakingsValues] = useState({})
  const [takingsNotes,  setTakingsNotes]  = useState({})
  const [expenses,      setExpenses]      = useState([])
  const [addExpOpen,    setAddExpOpen]    = useState(false)
  const [editExpId,     setEditExpId]     = useState(null)

  // Populate from server data
  // NOTE: loadDailyReport returns income_entries / sc_entries / takings_entries (not income/sc/takings)
  useEffect(() => {
    if (!daily) return
    const inc = {}; const incN = {}
    ;(daily.income_entries ?? []).forEach(r => { inc[r.source_id] = r.gross_amount ?? ''; incN[r.source_id] = r.notes ?? '' })
    setIncomeValues(inc); setIncomeNotes(incN)

    const sc = {}; const scN = {}
    ;(daily.sc_entries ?? []).forEach(r => { sc[r.source_id] = r.amount ?? ''; scN[r.source_id] = r.notes ?? '' })
    setScValues(sc); setScNotes(scN)

    const tak = {}; const takN = {}
    ;(daily.takings_entries ?? []).forEach(r => { tak[r.channel_id] = r.amount ?? ''; takN[r.channel_id] = r.notes ?? '' })
    setTakingsValues(tak); setTakingsNotes(takN)

    setExpenses(daily.expenses ?? [])
  }, [daily])

  const activeSources   = useMemo(() => (config?.income_sources    ?? []).filter(s => s.is_active), [config])
  const activeSc        = useMemo(() => (config?.sc_sources        ?? []).filter(s => s.is_active), [config])
  const activeChannels  = useMemo(() => (config?.payment_channels  ?? []).filter(s => s.is_active), [config])

  // VAT computation
  function computeVat(source, rawAmount) {
    const amount = parseNum(rawAmount)
    if (!source.vat_rate || source.vat_rate === 0) return { net: amount, vat: 0 }
    if (source.vat_inclusive) {
      const net = amount / (1 + source.vat_rate / 100)
      return { net: parseFloat(net.toFixed(2)), vat: parseFloat((amount - net).toFixed(2)) }
    } else {
      const vat = amount * (source.vat_rate / 100)
      return { net: amount, vat: parseFloat(vat.toFixed(2)) }
    }
  }

  // Totals — excluded sources don't count toward reconciliation.
  // SC sources with included_in_sales=true are ALSO added to the
  // "Total Income / Sales" figure so the same money shows as revenue
  // (sales KPI) AND — if included_in_takings=true — as expected
  // reconciliation cash.  The two flags are independent.
  const totalScInSales = useMemo(() =>
    activeSc.filter(s => s.included_in_sales).reduce((sum, s) => sum + parseNum(scValues[s.id] ?? 0), 0),
    [activeSc, scValues]
  )

  const totalIncome = useMemo(() => {
    const base = activeSources
      .filter(s => !s.exclude_from_recon)
      .reduce((sum, s) => sum + parseNum(incomeValues[s.id] ?? 0), 0)
    return base + totalScInSales
  }, [activeSources, incomeValues, totalScInSales])

  const totalScIncluded = useMemo(() =>
    activeSc.filter(s => s.included_in_takings).reduce((sum, s) => sum + parseNum(scValues[s.id] ?? 0), 0),
    [activeSc, scValues]
  )

  const totalSc = useMemo(() =>
    activeSc.reduce((sum, s) => sum + parseNum(scValues[s.id] ?? 0), 0),
    [activeSc, scValues]
  )

  const totalTakings = useMemo(() =>
    activeChannels.reduce((sum, c) => sum + parseNum(takingsValues[c.id] ?? 0), 0),
    [activeChannels, takingsValues]
  )

  const totalExpenses = useMemo(() =>
    expenses.reduce((sum, e) => sum + parseNum(e.amount ?? 0), 0),
    [expenses]
  )

  // Variance math must NOT double-count SC that's flagged for BOTH
  // sales and takings — include_in_sales inflates totalIncome for
  // the KPI display, but for the reconciliation side we use the raw
  // income (no SC) plus totalScIncluded so each SC amount only
  // affects the expected-till figure once.
  const varianceIncomeBase = totalIncome - totalScInSales
  const variance = (varianceIncomeBase + totalScIncluded) - totalTakings
  const netCash  = totalTakings - totalExpenses

  // Auto-save on blur (debounced 800ms)
  function triggerSave(data) {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true); setSaved(false); setSaveErr(false)
      try {
        await api.put(`/venues/${venueId}/cash-recon/daily/${date}`, data)
        qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } catch {
        setSaveErr(true)
      } finally {
        setSaving(false)
      }
    }, 800)
  }

  function buildPayload({ iNotesOvr, sNotesOvr, tNotesOvr } = {}) {
    const iNotes = iNotesOvr ?? incomeNotes
    const sNotes = sNotesOvr ?? scNotes
    const tNotes = tNotesOvr ?? takingsNotes
    const sourceById = Object.fromEntries(
      (config?.income_sources ?? []).map(s => [s.id, s])
    )
    return {
      income: activeSources.map(s => {
        const gross   = parseNum(incomeValues[s.id] ?? 0)
        const src     = sourceById[s.id] ?? {}
        const vatRate = parseNum(src.vat_rate ?? 0) / 100
        let vat = 0, net = gross
        if (vatRate > 0) {
          if (src.vat_inclusive) {
            vat = gross - gross / (1 + vatRate)
            net = gross / (1 + vatRate)
          } else {
            vat = gross * vatRate
            net = gross
          }
        }
        return {
          source_id:    s.id,
          gross_amount: gross,
          vat_amount:   Math.round(vat * 100) / 100,
          net_amount:   Math.round(net * 100) / 100,
          notes:        iNotes[s.id] ?? '',
        }
      }),
      sc: activeSc.map(s => ({
        source_id: s.id,
        amount:    parseNum(scValues[s.id] ?? 0),
        notes:     sNotes[s.id] ?? '',
      })),
      takings: activeChannels.map(c => ({
        channel_id: c.id,
        amount:     parseNum(takingsValues[c.id] ?? 0),
        notes:      tNotes[c.id] ?? '',
      })),
      expenses: expenses,
    }
  }

  // Submit / unsubmit
  const submitMutation = useMutation({
    mutationFn: async (action) => {
      clearTimeout(saveTimerRef.current) // cancel any pending debounce
      // Only flush a save when submitting — unsubmit must NOT save first (report is locked)
      if (action === 'submit') {
        await api.put(`/venues/${venueId}/cash-recon/daily/${date}`, buildPayload())
      }
      return api.post(`/venues/${venueId}/cash-recon/daily/${date}/${action}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-recon-daily', venueId, date] })
      qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
    },
  })

  const currentStatus = daily?.status ?? 'none'
  const isSubmitted = currentStatus === 'submitted'

  if (configLoading || dailyLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <IconBtn onClick={onBack} title="Back to week"><ArrowLeft className="w-5 h-5" /></IconBtn>
        <div>
          <div className="text-sm font-semibold">{format(parseISO(date), 'EEEE d MMMM yyyy')}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusBadge status={currentStatus} />
            <SaveIndicator saving={saving} saved={saved} error={saveErr} />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!isSubmitted && (
            <button
              type="button"
              disabled={submitMutation.isPending}
              onClick={() => submitMutation.mutate('submit')}
              className="h-10 px-4 rounded-xl bg-green-600 text-white text-sm font-medium touch-manipulation hover:bg-green-700 disabled:opacity-50"
            >
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Declaration'}
            </button>
          )}
          {isSubmitted && (
            <button
              type="button"
              disabled={submitMutation.isPending}
              onClick={() => submitMutation.mutate('unsubmit')}
              className="h-10 px-4 rounded-xl border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50"
            >
              Unsubmit
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-0 pb-32">

        {/* Section 1: Income */}
        <SectionCard title="Income">
          <div className="space-y-3">
            {activeSources.length === 0 && (
              <p className="text-sm text-muted-foreground">No income sources configured. Add them in Settings.</p>
            )}
            {activeSources.map(source => {
              const { net, vat } = computeVat(source, incomeValues[source.id] ?? '')
              const hasVat = source.vat_rate > 0
              const excluded = !!source.exclude_from_recon
              return (
                <div key={source.id} className={cn('flex items-start gap-2', excluded && 'opacity-70')}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{source.name}</span>
                      <TypeBadge type={source.type} />
                      {excluded && (
                        <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
                          Excluded from recon
                        </span>
                      )}
                    </div>
                    {source.tooltip && (
                      <div className="text-xs text-muted-foreground mt-0.5">{source.tooltip}</div>
                    )}
                    {hasVat && parseNum(incomeValues[source.id]) > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        incl. VAT @{source.vat_rate}%
                        {source.vat_inclusive ? ` — Net: ${fmt(net)}, VAT: ${fmt(vat)}` : ` — VAT: ${fmt(vat)}, Total: ${fmt(net + vat)}`}
                      </div>
                    )}
                  </div>
                  <NoteButton
                    label={source.name}
                    value={incomeNotes[source.id] ?? ''}
                    onSave={draft => {
                      setIncomeNotes(prev => {
                        const next = { ...prev, [source.id]: draft }
                        triggerSave(buildPayload({ iNotesOvr: next }))
                        return next
                      })
                    }}
                  />
                  <div className="w-28 shrink-0">
                    <AmountInput
                      value={incomeValues[source.id] ?? ''}
                      onChange={v => setIncomeValues(p => ({ ...p, [source.id]: v }))}
                      onBlur={() => triggerSave(buildPayload())}
                    />
                  </div>
                </div>
              )
            })}
            <div className="flex justify-between items-center pt-2 border-t text-sm font-semibold">
              <span className="flex items-center gap-1.5">
                Total Income
                {activeSources.some(s => s.exclude_from_recon) && (
                  <span className="text-xs font-normal text-muted-foreground">(excl. excluded sources)</span>
                )}
              </span>
              <span>{fmt(totalIncome)}</span>
            </div>
          </div>
        </SectionCard>

        {/* Section 2: Service Charges & Tips */}
        <SectionCard title="Service Charges & Tips">
          <div className="space-y-3">
            {activeSc.length === 0 && (
              <p className="text-sm text-muted-foreground">No service charge sources configured.</p>
            )}
            {activeSc.map(source => (
              <div key={source.id} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{source.name}</span>
                    <TypeBadge type={source.type} />
                    {source.included_in_takings && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">Included in takings</span>
                    )}
                    {source.included_in_sales && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700">Included in sales</span>
                    )}
                  </div>
                  {source.tooltip && (
                    <div className="text-xs text-muted-foreground mt-0.5">{source.tooltip}</div>
                  )}
                </div>
                <NoteButton
                  label={source.name}
                  value={scNotes[source.id] ?? ''}
                  onSave={draft => {
                    setScNotes(prev => {
                      const next = { ...prev, [source.id]: draft }
                      triggerSave(buildPayload({ sNotesOvr: next }))
                      return next
                    })
                  }}
                />
                <div className="w-28 shrink-0">
                  <AmountInput
                    value={scValues[source.id] ?? ''}
                    onChange={v => setScValues(p => ({ ...p, [source.id]: v }))}
                    onBlur={() => triggerSave(buildPayload())}
                  />
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 border-t text-sm font-semibold">
              <span>Total</span>
              <span>{fmt(totalSc)}</span>
            </div>
          </div>
        </SectionCard>

        {/* Section 3: Takings */}
        <SectionCard title="Takings">
          <div className="space-y-3">
            {activeChannels.length === 0 && (
              <p className="text-sm text-muted-foreground">No payment channels configured.</p>
            )}
            {activeChannels.map(channel => (
              <div key={channel.id} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{channel.name}</span>
                    <TypeBadge type={channel.type} />
                  </div>
                  {channel.tooltip && (
                    <div className="text-xs text-muted-foreground mt-0.5">{channel.tooltip}</div>
                  )}
                </div>
                <NoteButton
                  label={channel.name}
                  value={takingsNotes[channel.id] ?? ''}
                  onSave={draft => {
                    setTakingsNotes(prev => {
                      const next = { ...prev, [channel.id]: draft }
                      triggerSave(buildPayload({ tNotesOvr: next }))
                      return next
                    })
                  }}
                />
                <div className="w-28 shrink-0">
                  <AmountInput
                    value={takingsValues[channel.id] ?? ''}
                    onChange={v => setTakingsValues(p => ({ ...p, [channel.id]: v }))}
                    onBlur={() => triggerSave(buildPayload())}
                  />
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 border-t text-sm font-semibold">
              <span>Total Takings</span>
              <span>{fmt(totalTakings)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Should balance with total income{totalScIncluded > 0 ? ' + included service charges' : ''}.</p>
          </div>
        </SectionCard>

        {/* Section 4: Petty Cash Expenses */}
        <ExpensesSection
          venueId={venueId}
          date={date}
          expenses={expenses}
          setExpenses={setExpenses}
          onSaved={() => qc.invalidateQueries({ queryKey: ['cash-recon-week'] })}
          config={config}
        />

        {/* Summary */}
        <div className="rounded-2xl border bg-card shadow-sm p-4 space-y-2">
          <h3 className="text-sm font-semibold mb-3">Summary</h3>
          <div className="flex justify-between text-sm"><span>Total Income</span><span className="font-medium">{fmt(totalIncome)}</span></div>
          {totalScInSales > 0 && (
            <div className="flex justify-between text-xs text-emerald-700"><span className="pl-3">incl. SC in sales</span><span>{fmt(totalScInSales)}</span></div>
          )}
          {totalScIncluded > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground"><span>SC included in takings</span><span>{fmt(totalScIncluded)}</span></div>
          )}
          <div className="flex justify-between text-sm"><span>Total Takings</span><span className="font-medium">{fmt(totalTakings)}</span></div>
          <div className={cn('flex justify-between text-sm font-semibold pt-1 border-t', variance === 0 ? 'text-green-600' : 'text-red-600')}>
            <span>Variance</span>
            <span className="flex items-center gap-1">
              {variance === 0 ? <Check className="w-4 h-4" /> : null}
              {variance === 0 ? 'Balanced' : `${variance > 0 ? '+' : ''}${fmt(variance)}`}
            </span>
          </div>
          <div className="flex justify-between text-sm pt-1"><span>Total Expenses</span><span className="font-medium">{fmt(totalExpenses)}</span></div>
          <div className="flex justify-between text-sm font-bold pt-1 border-t">
            <span>Net Cash Position</span>
            <span>{fmt(netCash)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Expenses section (extracted for clarity) ─────────────────────────────────

function ExpensesSection({ venueId, date, expenses, setExpenses, onSaved, config }) {
  const api = useApi()
  const [addOpen,   setAddOpen]   = useState(false)
  const [editId,    setEditId]    = useState(null)
  const [newForm,   setNewForm]   = useState({ description: '', category_id: null, amount: '', notes: '' })
  const [newPhoto,  setNewPhoto]  = useState(null)   // { file, preview }
  const [editForm,  setEditForm]  = useState({})
  const [editPhoto, setEditPhoto] = useState(null)   // { file, preview }
  const [uploading, setUploading] = useState({})
  const newFileRef  = useRef(null)
  const editFileRef = useRef(null)
  const fileInputRefs = useRef({})

  const categories = useMemo(
    () => (config?.expense_categories ?? []).filter(c => c.is_active),
    [config]
  )

  function pickPhoto(file, setSetter) {
    if (!file) return
    const preview = URL.createObjectURL(file)
    setSetter({ file, preview })
  }

  async function handleAdd() {
    if (!newForm.description || !newForm.amount) return
    try {
      const created = await api.post(`/venues/${venueId}/cash-recon/expenses`, { ...newForm, date })
      // upload photo if selected
      if (newPhoto?.file) {
        setUploading(p => ({ ...p, [created.id]: true }))
        try {
          const result = await api.upload(`/venues/${venueId}/cash-recon/expenses/${created.id}/receipt`, newPhoto.file)
          created.receipt_url = result.url
        } catch {}
        setUploading(p => ({ ...p, [created.id]: false }))
      }
      setExpenses(p => [...p, created])
      setNewForm({ description: '', category_id: null, amount: '', notes: '' })
      if (newPhoto?.preview) URL.revokeObjectURL(newPhoto.preview)
      setNewPhoto(null)
      setAddOpen(false)
      onSaved?.()
    } catch {}
  }

  async function handleEditSave(expId) {
    try {
      const updated = await api.put(`/venues/${venueId}/cash-recon/expenses/${expId}`, editForm)
      let final = updated
      if (editPhoto?.file) {
        setUploading(p => ({ ...p, [expId]: true }))
        try {
          const result = await api.upload(`/venues/${venueId}/cash-recon/expenses/${expId}/receipt`, editPhoto.file)
          final = { ...final, receipt_url: result.url }
        } catch {}
        setUploading(p => ({ ...p, [expId]: false }))
      }
      setExpenses(p => p.map(e => e.id === expId ? final : e))
      if (editPhoto?.preview) URL.revokeObjectURL(editPhoto.preview)
      setEditPhoto(null)
      setEditId(null)
      onSaved?.()
    } catch {}
  }

  async function handleDelete(expId) {
    const exp = expenses.find(e => e.id === expId)
    if (exp?.receipt_url) {
      alert('Delete the receipt first before deleting this expense.')
      return
    }
    try {
      await api.delete(`/venues/${venueId}/cash-recon/expenses/${expId}`)
      setExpenses(p => p.filter(e => e.id !== expId))
      onSaved?.()
    } catch {}
  }

  async function handleDeleteReceipt(expId) {
    try {
      await api.delete(`/venues/${venueId}/cash-recon/expenses/${expId}/receipt`)
      setExpenses(p => p.map(e => e.id === expId ? { ...e, receipt_url: null } : e))
      onSaved?.()
    } catch {}
  }

  async function handleReceiptUpload(expId, file) {
    setUploading(p => ({ ...p, [expId]: true }))
    try {
      const result = await api.upload(`/venues/${venueId}/cash-recon/expenses/${expId}/receipt`, file)
      setExpenses(p => p.map(e => e.id === expId ? { ...e, receipt_url: result.url } : e))
      onSaved?.()
    } catch {}
    setUploading(p => ({ ...p, [expId]: false }))
  }

  function CategoryChips({ selected, onSelect }) {
    if (categories.length === 0) return null
    return (
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => {
          const active = selected === cat.id
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(active ? null : cat.id)}
              style={active && cat.colour ? { backgroundColor: cat.colour + '33', borderColor: cat.colour, color: cat.colour } : {}}
              className={cn(
                'h-8 px-3 rounded-full text-xs font-medium border touch-manipulation transition-colors',
                active
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              )}
            >
              {cat.name}
            </button>
          )
        })}
      </div>
    )
  }

  function PhotoInput({ photo, setPhoto, fileRef, label = 'Add photo' }) {
    return (
      <div>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          ref={fileRef}
          className="hidden"
          onChange={e => pickPhoto(e.target.files[0], setPhoto)}
        />
        {photo?.preview ? (
          <div className="relative inline-block">
            <img src={photo.preview} alt="Preview" className="h-20 w-20 object-cover rounded-xl border" />
            <button
              type="button"
              onClick={() => { URL.revokeObjectURL(photo.preview); setPhoto(null) }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center touch-manipulation"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 h-10 px-3 rounded-xl border text-sm text-muted-foreground touch-manipulation hover:bg-muted"
          >
            <Camera className="w-4 h-4" /> {label}
          </button>
        )}
      </div>
    )
  }

  const catById = useMemo(() => Object.fromEntries((config?.expense_categories ?? []).map(c => [c.id, c])), [config])

  return (
    <SectionCard title="Petty Cash Expenses">
      <div className="space-y-3">
        {expenses.length === 0 && !addOpen && (
          <p className="text-sm text-muted-foreground">No expenses recorded.</p>
        )}

        {expenses.map(exp => {
          const cat = catById[exp.category_id]
          if (editId === exp.id) {
            return (
              <div key={exp.id} className="rounded-xl border p-3 bg-muted/20 space-y-2">
                <TextInput placeholder="Description *" value={editForm.description ?? ''} onChange={v => setEditForm(p => ({ ...p, description: v }))} />
                <CategoryChips selected={editForm.category_id ?? null} onSelect={id => setEditForm(p => ({ ...p, category_id: id }))} />
                <AmountInput placeholder="Amount" value={editForm.amount ?? ''} onChange={v => setEditForm(p => ({ ...p, amount: v }))} />
                <TextInput placeholder="Notes" value={editForm.notes ?? ''} onChange={v => setEditForm(p => ({ ...p, notes: v }))} />
                <PhotoInput photo={editPhoto} setPhoto={setEditPhoto} fileRef={editFileRef} label={exp.receipt_url ? 'Replace photo' : 'Add photo'} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleEditSave(exp.id)}
                    disabled={uploading[exp.id]}
                    className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 flex items-center justify-center gap-2">
                    {uploading[exp.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </button>
                  <button type="button" onClick={() => { setEditId(null); setEditPhoto(null) }}
                    className="flex-1 h-10 rounded-xl border text-sm touch-manipulation hover:bg-muted">Cancel</button>
                </div>
              </div>
            )
          }

          return (
            <div key={exp.id} className="rounded-xl border p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{exp.description}</div>
                  {cat && (
                    <span
                      style={cat.colour ? { backgroundColor: cat.colour + '22', borderColor: cat.colour + '88', color: cat.colour } : {}}
                      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium border bg-muted/40 text-muted-foreground mt-0.5"
                    >
                      {cat.name}
                    </span>
                  )}
                  {!cat && exp.category && <div className="text-xs text-muted-foreground">{exp.category}</div>}
                  {exp.notes && <div className="text-xs text-muted-foreground mt-0.5">{exp.notes}</div>}
                </div>
                <div className="text-sm font-semibold shrink-0">{fmt(exp.amount)}</div>
              </div>

              {/* Receipt thumbnail */}
              {exp.receipt_url && (
                <a href={exp.receipt_url} target="_blank" rel="noopener noreferrer" className="block">
                  <img src={exp.receipt_url} alt="Receipt" className="h-16 w-16 object-cover rounded-lg border" />
                </a>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {!exp.receipt_url && (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      ref={el => { fileInputRefs.current[exp.id] = el }}
                      className="hidden"
                      onChange={e => { if (e.target.files[0]) handleReceiptUpload(exp.id, e.target.files[0]) }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRefs.current[exp.id]?.click()}
                      disabled={uploading[exp.id]}
                      className="flex items-center gap-1 h-8 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted disabled:opacity-50"
                    >
                      {uploading[exp.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                      Add receipt
                    </button>
                  </>
                )}
                {exp.receipt_url && (
                  <button type="button" onClick={() => handleDeleteReceipt(exp.id)}
                    className="text-xs text-destructive touch-manipulation hover:underline">
                    Remove receipt
                  </button>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <IconBtn onClick={() => {
                    setEditId(exp.id)
                    setEditPhoto(null)
                    setEditForm({ description: exp.description, category_id: exp.category_id ?? null, amount: exp.amount ?? '', notes: exp.notes ?? '' })
                  }} title="Edit">
                    <Pencil className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn onClick={() => handleDelete(exp.id)} title="Delete" className="text-destructive hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4" />
                  </IconBtn>
                </div>
              </div>
            </div>
          )
        })}

        {/* Add expense form */}
        {addOpen ? (
          <div className="rounded-xl border p-3 bg-muted/20 space-y-2">
            <TextInput placeholder="Description *" value={newForm.description} onChange={v => setNewForm(p => ({ ...p, description: v }))} />
            <CategoryChips selected={newForm.category_id} onSelect={id => setNewForm(p => ({ ...p, category_id: id }))} />
            <AmountInput placeholder="Amount *" value={newForm.amount} onChange={v => setNewForm(p => ({ ...p, amount: v }))} />
            <TextInput placeholder="Notes" value={newForm.notes} onChange={v => setNewForm(p => ({ ...p, notes: v }))} />
            <PhotoInput photo={newPhoto} setPhoto={setNewPhoto} fileRef={newFileRef} />
            <div className="flex gap-2">
              <button type="button" onClick={handleAdd}
                className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation">Save</button>
              <button type="button" onClick={() => {
                setAddOpen(false)
                setNewForm({ description: '', category_id: null, amount: '', notes: '' })
                if (newPhoto?.preview) URL.revokeObjectURL(newPhoto.preview)
                setNewPhoto(null)
              }} className="flex-1 h-10 rounded-xl border text-sm touch-manipulation hover:bg-muted">Cancel</button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="w-full h-12 rounded-xl border-2 border-dashed text-sm text-muted-foreground touch-manipulation hover:border-primary/60 hover:text-foreground transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add expense
          </button>
        )}
      </div>
    </SectionCard>
  )
}

// ── WAGES VIEW ───────────────────────────────────────────────────────────────

function WagesView({ venueId, weekStart, onBack }) {
  const api = useApi()
  const qc  = useQueryClient()

  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [saveErr, setSaveErr] = useState(false)
  const saveTimerRef = useRef(null)

  const { data: config } = useQuery({
    queryKey: ['cash-recon-config', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/config`),
    enabled:  !!venueId,
  })

  const { data: wagesData, isLoading } = useQuery({
    queryKey: ['cash-recon-wages', venueId, weekStart],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/wages/${weekStart}`),
    enabled:  !!venueId && !!weekStart,
  })

  const [entries,  setEntries]  = useState([])
  const [notes,    setNotes]    = useState('')
  const [addOpen,  setAddOpen]  = useState(false)
  const [addMode,  setAddMode]  = useState('template') // 'template' | 'adhoc'
  const [addStaff, setAddStaff] = useState('')
  const [addAdhoc, setAddAdhoc] = useState('')

  const activeStaff = useMemo(() => (config?.staff ?? []).filter(s => s.is_active), [config])

  // Track which week we've already initialised so refetching config doesn't wipe entered data
  const initializedWeek = useRef(null)

  useEffect(() => {
    if (!wagesData || !config) return
    // Reset initialised flag when week changes
    if (initializedWeek.current !== weekStart) {
      initializedWeek.current = weekStart
      setNotes(wagesData.notes ?? '')
      const serverEntries = wagesData.entries ?? []
      if (serverEntries.length > 0) {
        // Week has saved entries — load them
        setEntries(serverEntries)
      } else if (activeStaff.length > 0) {
        // New week — auto-populate from staff template
        setEntries(activeStaff.map(s => ({
          staff_id:    s.id,
          name:        s.name,
          entry_type:  'fixed',
          hours:       '',
          rate:        '',
          total:       s.default_rate != null ? String(s.default_rate) : '',
          cash_amount: '',
          notes:       '',
        })))
      } else {
        setEntries([])
      }
    }
  }, [wagesData, config, weekStart, activeStaff])

  const totalWages     = useMemo(() => entries.reduce((s, e) => s + parseNum(e.total ?? (parseNum(e.hours) * parseNum(e.rate))), 0), [entries])
  const totalCashWages = useMemo(() => entries.reduce((s, e) => s + parseNum(e.cash_amount ?? 0), 0), [entries])

  function triggerSave(data) {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true); setSaved(false); setSaveErr(false)
      try {
        await api.put(`/venues/${venueId}/cash-recon/wages/${weekStart}`, data)
        qc.invalidateQueries({ queryKey: ['cash-recon-week'] })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } catch {
        setSaveErr(true)
      } finally {
        setSaving(false)
      }
    }, 800)
  }

  function buildPayload() {
    return { entries: entries.map(e => {
      const et = e.entry_type ?? 'fixed'
      return {
        staff_id:    e.staff_id ?? null,
        name:        e.name,
        entry_type:  et,
        hours:       et === 'fixed' ? null : parseNum(e.hours),
        rate:        et === 'fixed' ? null : parseNum(e.rate),
        total:       parseNum(e.total ?? (et === 'hourly' ? parseNum(e.hours) * parseNum(e.rate) : 0)),
        cash_amount: parseNum(e.cash_amount ?? 0),
        notes:       e.notes ?? '',
      }
    }), notes }
  }

  function handleEntryBlur() {
    triggerSave(buildPayload())
  }

  function updateEntry(idx, field, value) {
    setEntries(p => p.map((e, i) => {
      if (i !== idx) return e
      const updated = { ...e, [field]: value }
      if (field === 'hours' || field === 'rate') {
        const h = parseNum(field === 'hours' ? value : e.hours)
        const r = parseNum(field === 'rate'  ? value : e.rate)
        if (h > 0 && r > 0) updated.total = (h * r).toFixed(2)
      }
      return updated
    }))
  }

  function addFromTemplate() {
    const member = activeStaff.find(s => s.id === addStaff)
    if (!member) return
    const newEntry = {
      staff_id: member.id, name: member.name, entry_type: 'fixed',
      hours: '', rate: '', total: member.default_rate != null ? String(member.default_rate) : '', cash_amount: '', notes: '',
    }
    setEntries(p => [...p, newEntry])
    setAddStaff('')
    setAddOpen(false)
    triggerSave({ entries: [...entries, { staff_id: member.id, name: member.name, entry_type: 'fixed', hours: null, rate: null, total: parseNum(member.default_rate), cash_amount: 0, notes: '' }], notes })
  }

  function addAdhocEntry() {
    if (!addAdhoc.trim()) return
    const newEntry = { staff_id: null, name: addAdhoc.trim(), entry_type: 'fixed', hours: '', rate: '', total: '', cash_amount: '', notes: '' }
    setEntries(p => [...p, newEntry])
    setAddAdhoc('')
    setAddOpen(false)
    triggerSave({ entries: [...entries, { staff_id: null, name: addAdhoc.trim(), entry_type: 'fixed', hours: null, rate: null, total: 0, cash_amount: 0, notes: '' }], notes })
  }

  function removeEntry(idx) {
    const next = entries.filter((_, i) => i !== idx)
    setEntries(next)
    triggerSave({ entries: next.map(e => ({ ...e, hours: parseNum(e.hours), rate: parseNum(e.rate), total: parseNum(e.total), cash_amount: parseNum(e.cash_amount) })), notes })
  }

  const submitMutation = useMutation({
    mutationFn: (action) => api.post(`/venues/${venueId}/cash-recon/wages/${weekStart}/${action}`, buildPayload()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['cash-recon-wages', venueId, weekStart] }); qc.invalidateQueries({ queryKey: ['cash-recon-week'] }) },
  })

  const currentStatus = wagesData?.status ?? 'none'
  const isSubmitted   = currentStatus === 'submitted'

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <IconBtn onClick={onBack} title="Back"><ArrowLeft className="w-5 h-5" /></IconBtn>
        <div>
          <div className="text-sm font-semibold">Wages — Week of {format(parseISO(weekStart), 'd MMMM yyyy')}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusBadge status={currentStatus} />
            <SaveIndicator saving={saving} saved={saved} error={saveErr} />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!isSubmitted && (
            <button type="button" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate('submit')}
              className="h-10 px-4 rounded-xl bg-green-600 text-white text-sm font-medium touch-manipulation hover:bg-green-700 disabled:opacity-50">
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
            </button>
          )}
          {isSubmitted && (
            <button type="button" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate('unsubmit')}
              className="h-10 px-4 rounded-xl border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50">
              Unsubmit
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-0 pb-32">
        <SectionCard
          title="Staff Wages"
          action={
            activeStaff.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (entries.length > 0 && !window.confirm('This will replace existing entries with staff template. Continue?')) return
                  initializedWeek.current = null  // allow re-init
                  setEntries(activeStaff.map(s => ({
                    staff_id: s.id, name: s.name, entry_type: 'fixed',
                    hours: '', rate: '',
                    total: s.default_rate != null ? String(s.default_rate) : '',
                    cash_amount: '', notes: '',
                  })))
                }}
                className="text-xs text-primary touch-manipulation hover:underline"
              >
                Load template
              </button>
            )
          }
        >
          <div className="space-y-3">
            {entries.length === 0 && !addOpen && (
              <p className="text-sm text-muted-foreground">No staff entries yet. {activeStaff.length > 0 ? 'Click "Load template" to pre-fill from your staff list.' : 'Add staff in Settings first.'}</p>
            )}

            {entries.map((entry, idx) => (
              <div key={idx} className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{entry.name}</span>
                  <IconBtn onClick={() => removeEntry(idx)} title="Remove" className="text-destructive hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4" />
                  </IconBtn>
                </div>
                <div className="flex gap-1 mb-2">
                  {['fixed', 'hourly'].map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => updateEntry(idx, 'entry_type', mode)}
                      className={cn(
                        'px-3 h-8 rounded-lg text-xs font-medium touch-manipulation transition-colors',
                        (entry.entry_type ?? 'fixed') === mode
                          ? 'bg-primary text-primary-foreground'
                          : 'border text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {mode === 'hourly' ? '⏱ Hourly' : '£ Fixed'}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(entry.entry_type ?? 'fixed') === 'hourly' && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Hours</label>
                        <AmountInput
                          value={entry.hours}
                          onChange={v => updateEntry(idx, 'hours', v)}
                          onBlur={handleEntryBlur}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Rate (£/hr)</label>
                        <AmountInput
                          value={entry.rate}
                          onChange={v => updateEntry(idx, 'rate', v)}
                          onBlur={handleEntryBlur}
                          placeholder="0.00"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Total (£)</label>
                    <AmountInput
                      value={entry.total}
                      onChange={v => updateEntry(idx, 'total', v)}
                      onBlur={handleEntryBlur}
                      placeholder="auto"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Cash paid (£)</label>
                    <AmountInput
                      value={entry.cash_amount}
                      onChange={v => updateEntry(idx, 'cash_amount', v)}
                      onBlur={handleEntryBlur}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <TextInput
                  placeholder="Notes (optional)"
                  value={entry.notes ?? ''}
                  onChange={v => updateEntry(idx, 'notes', v)}
                  onBlur={handleEntryBlur}
                />
              </div>
            ))}

            {/* Add staff */}
            {addOpen ? (
              <div className="rounded-xl border p-3 bg-muted/20 space-y-2">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAddMode('template')}
                    className={cn('flex-1 h-9 rounded-lg text-sm touch-manipulation border transition-colors', addMode === 'template' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                    From staff list
                  </button>
                  <button type="button" onClick={() => setAddMode('adhoc')}
                    className={cn('flex-1 h-9 rounded-lg text-sm touch-manipulation border transition-colors', addMode === 'adhoc' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                    Ad-hoc
                  </button>
                </div>
                {addMode === 'template' ? (
                  <>
                    <select
                      value={addStaff}
                      onChange={e => setAddStaff(e.target.value)}
                      className="h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="">Select staff member…</option>
                      {activeStaff.map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.default_rate ? ` (£${s.default_rate}/hr)` : ''}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button type="button" onClick={addFromTemplate} disabled={!addStaff}
                        className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">Add</button>
                      <button type="button" onClick={() => setAddOpen(false)}
                        className="flex-1 h-10 rounded-xl border text-sm touch-manipulation hover:bg-muted">Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <TextInput placeholder="Name *" value={addAdhoc} onChange={setAddAdhoc} />
                    <div className="flex gap-2">
                      <button type="button" onClick={addAdhocEntry} disabled={!addAdhoc.trim()}
                        className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">Add</button>
                      <button type="button" onClick={() => setAddOpen(false)}
                        className="flex-1 h-10 rounded-xl border text-sm touch-manipulation hover:bg-muted">Cancel</button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setAddOpen(true)}
                className="w-full h-12 rounded-xl border-2 border-dashed text-sm text-muted-foreground touch-manipulation hover:border-primary/60 hover:text-foreground transition-colors flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" /> Add staff member
              </button>
            )}
          </div>
        </SectionCard>

        {/* Notes */}
        <SectionCard title="Notes">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => triggerSave(buildPayload())}
            rows={3}
            placeholder="Any notes for this week's wages…"
            className="w-full rounded-xl border bg-background px-3 py-2.5 text-base touch-manipulation resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </SectionCard>

        {/* Summary */}
        <div className="rounded-2xl border bg-card shadow-sm p-4 space-y-2">
          <h3 className="text-sm font-semibold mb-2">Summary</h3>
          <div className="flex justify-between text-sm"><span>Total wages</span><span className="font-bold">{fmt(totalWages)}</span></div>
          <div className="flex justify-between text-sm"><span>Total cash wages</span><span className="font-bold">{fmt(totalCashWages)}</span></div>
        </div>
      </div>
    </div>
  )
}

// ── SETTINGS VIEW ─────────────────────────────────────────────────────────────

// Option arrays: value = what the API/DB stores, label = what the UI shows
const INCOME_TYPES  = [
  { value: 'pos',      label: 'POS' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'other',    label: 'Other' },
]
const CHANNEL_TYPES = [
  { value: 'cash',    label: 'Cash' },
  { value: 'card',    label: 'Card' },
  { value: 'voucher', label: 'Voucher' },
  { value: 'online',  label: 'Online' },
  { value: 'other',   label: 'Other' },
]
const SC_TYPES = [
  { value: 'tips',           label: 'Tips' },
  { value: 'service_charge', label: 'Service Charge' },
]
const SC_DIST = [
  { value: 'house', label: 'Kept by House' },
  { value: 'staff', label: 'Distributed to Staff' },
  { value: 'split', label: 'Split' },
]

// Maps from DB value → display label (used in TypeBadge)
const TYPE_LABELS = Object.fromEntries([
  ...INCOME_TYPES, ...CHANNEL_TYPES, ...SC_TYPES, ...SC_DIST,
].map(o => [o.value, o.label]))

function SettingsView({ venueId, onBack }) {
  const [tab, setTab] = useState('general')
  const api = useApi()
  const qc  = useQueryClient()

  const { data: config, isLoading } = useQuery({
    queryKey: ['cash-recon-config', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/config`),
    enabled:  !!venueId,
  })

  function refetchConfig() {
    qc.invalidateQueries({ queryKey: ['cash-recon-config', venueId] })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const TABS = [
    { key: 'general',  label: 'General' },
    { key: 'income',   label: 'Income Sources' },
    { key: 'channels', label: 'Payment Channels' },
    { key: 'sc',       label: 'Service Charges' },
    { key: 'staff',    label: 'Staff' },
    { key: 'expenses', label: 'Categories' },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <IconBtn onClick={onBack} title="Back"><ArrowLeft className="w-5 h-5" /></IconBtn>
        <span className="text-sm font-semibold">Cash Recon Settings</span>
      </div>

      {/* Tabs */}
      <div className="border-b px-4">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'py-3 px-3 text-sm font-medium whitespace-nowrap border-b-2 touch-manipulation transition-colors',
                tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {tab === 'general'  && <GeneralTab           venueId={venueId} venueSettings={config?.venue_settings} onRefetch={refetchConfig} api={api} />}
        {tab === 'income'   && <IncomeSourcesTab     venueId={venueId} items={config?.income_sources      ?? []} onRefetch={refetchConfig} api={api} />}
        {tab === 'channels' && <PaymentChannelsTab   venueId={venueId} items={config?.payment_channels  ?? []} onRefetch={refetchConfig} api={api} />}
        {tab === 'sc'       && <ScSourcesTab         venueId={venueId} items={config?.sc_sources        ?? []} onRefetch={refetchConfig} api={api} />}
        {tab === 'staff'    && <StaffTab             venueId={venueId} items={config?.staff             ?? []} onRefetch={refetchConfig} api={api} />}
        {tab === 'expenses' && <ExpenseCategoriesTab venueId={venueId} items={config?.expense_categories ?? []} onRefetch={refetchConfig} api={api} />}
      </div>
    </div>
  )
}

// ── General settings tab ──────────────────────────────────────────────────────

function GeneralTab({ venueId, venueSettings, onRefetch, api }) {
  const [saving, setSaving] = useState(false)
  const allowBulk = venueSettings?.allow_bulk_submit ?? false

  async function toggle(val) {
    setSaving(true)
    try {
      await api.patch(`/venues/${venueId}/cash-recon/settings`, { allow_bulk_submit: val })
      onRefetch()
    } catch {}
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Week Submission">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Allow bulk week submission</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              When <strong>on</strong>, the "Submit Week" button submits every open day — including days
              with no data yet (creates an empty report and marks it submitted).
              When <strong>off</strong>, only days that already have draft data are submitted.
            </p>
          </div>
          <div className="shrink-0 mt-0.5">
            {saving
              ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              : <Toggle checked={allowBulk} onChange={toggle} />
            }
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

// ── Generic list manager for settings tabs ────────────────────────────────────

function SettingsListManager({ items, onMove, onToggleActive, onDelete, onSave, renderForm, emptyLabel, addLabel }) {
  const [editId,  setEditId]  = useState(null)
  const [editVals, setEditVals] = useState({})
  const [addOpen, setAddOpen] = useState(false)
  const [newVals, setNewVals] = useState({})
  const [saving,  setSaving]  = useState(false)

  async function handleSave(id, vals) {
    setSaving(true)
    try {
      await onSave(id, vals)
      setEditId(null)
    } catch {}
    setSaving(false)
  }

  async function handleAdd(vals) {
    setSaving(true)
    try {
      await onSave(null, vals)
      setAddOpen(false)
      setNewVals({})
    } catch {}
    setSaving(false)
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && !addOpen && (
        <p className="text-sm text-muted-foreground py-4 text-center">{emptyLabel}</p>
      )}

      {items.map((item, idx) => {
        if (editId === item.id) {
          return (
            <div key={item.id} className="rounded-xl border p-3 bg-muted/20 space-y-3">
              {renderForm({
                vals: editVals,
                setVals: setEditVals,
              })}
              <div className="flex gap-2">
                <button type="button" onClick={() => handleSave(item.id, editVals)} disabled={saving}
                  className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Save'}
                </button>
                <button type="button" onClick={() => setEditId(null)}
                  className="flex-1 h-10 rounded-xl border text-sm touch-manipulation hover:bg-muted">Cancel</button>
              </div>
            </div>
          )
        }

        return (
          <div key={item.id} className={cn('rounded-xl border p-3 flex items-center gap-2', !item.is_active && 'opacity-60')}>
            {/* Up/down order controls */}
            <div className="flex flex-col gap-0.5 shrink-0">
              <button type="button" onClick={() => onMove(idx, -1)} disabled={idx === 0}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted touch-manipulation disabled:opacity-30">
                <ChevronUp className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => onMove(idx, 1)} disabled={idx === items.length - 1}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted touch-manipulation disabled:opacity-30">
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{item.name}</span>
                {item.type && <TypeBadge type={item.type} />}
              </div>
            </div>

            <Toggle checked={item.is_active} onChange={() => onToggleActive(item.id, !item.is_active)} />
            <IconBtn onClick={() => { setEditId(item.id); setEditVals({ ...item }) }} title="Edit">
              <Pencil className="w-4 h-4" />
            </IconBtn>
            <IconBtn onClick={() => onDelete(item.id)} title="Delete" className="text-destructive hover:bg-destructive/10">
              <Trash2 className="w-4 h-4" />
            </IconBtn>
          </div>
        )
      })}

      {addOpen ? (
        <div className="rounded-xl border p-3 bg-muted/20 space-y-3">
          {renderForm({ vals: newVals, setVals: setNewVals })}
          <div className="flex gap-2">
            <button type="button" onClick={() => handleAdd(newVals)} disabled={saving}
              className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Add'}
            </button>
            <button type="button" onClick={() => { setAddOpen(false); setNewVals({}) }}
              className="flex-1 h-10 rounded-xl border text-sm touch-manipulation hover:bg-muted">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAddOpen(true)}
          className="w-full h-12 rounded-xl border-2 border-dashed text-sm text-muted-foreground touch-manipulation hover:border-primary/60 hover:text-foreground transition-colors flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> {addLabel}
        </button>
      )}
    </div>
  )
}

// ── Income Sources tab ───────────────────────────────────────────────────────

function IncomeSourcesTab({ venueId, items, onRefetch, api }) {
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  async function handleSave(id, vals) {
    if (id) {
      await api.put(`/venues/${venueId}/cash-recon/config/income-sources/${id}`, vals)
    } else {
      await api.post(`/venues/${venueId}/cash-recon/config/income-sources`, { ...vals, sort_order: localItems.length })
    }
    onRefetch()
  }

  async function handleDelete(id) {
    await api.delete(`/venues/${venueId}/cash-recon/config/income-sources/${id}`)
    onRefetch()
  }

  async function handleToggleActive(id, val) {
    await api.patch(`/venues/${venueId}/cash-recon/config/income-sources/${id}`, { is_active: val })
    onRefetch()
  }

  async function handleMove(idx, dir) {
    const next = [...localItems]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setLocalItems(next)
    await api.put(`/venues/${venueId}/cash-recon/config/income-sources/reorder`, { ids: next.map(i => i.id) })
    onRefetch()
  }

  function renderForm({ vals, setVals }) {
    return (
      <>
        <TextInput placeholder="Name *" value={vals.name ?? ''} onChange={v => setVals(p => ({ ...p, name: v }))} />
        <select value={vals.type ?? ''} onChange={e => setVals(p => ({ ...p, type: e.target.value }))}
          className="h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="">Select type…</option>
          {INCOME_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">VAT Rate %</label>
          <AmountInput placeholder="0" value={vals.vat_rate ?? '0'} onChange={v => setVals(p => ({ ...p, vat_rate: v }))} />
        </div>
        {parseNum(vals.vat_rate) > 0 && (
          <Toggle checked={!!vals.vat_inclusive} onChange={v => setVals(p => ({ ...p, vat_inclusive: v }))} label="VAT Inclusive (tax already in price)" />
        )}
        <Toggle checked={!!vals.exclude_from_recon} onChange={v => setVals(p => ({ ...p, exclude_from_recon: v }))} label="Exclude from reconciliation totals" />
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Description / tooltip shown in daily view</label>
          <TextInput placeholder="e.g. Net sales from POS terminal" value={vals.tooltip ?? ''} onChange={v => setVals(p => ({ ...p, tooltip: v || null }))} />
        </div>
        <Toggle checked={vals.is_active !== false} onChange={v => setVals(p => ({ ...p, is_active: v }))} label="Active" />
      </>
    )
  }

  return (
    <SettingsListManager
      items={localItems}
      onMove={handleMove}
      onToggleActive={handleToggleActive}
      onDelete={handleDelete}
      onSave={handleSave}
      renderForm={renderForm}
      emptyLabel="No income sources yet."
      addLabel="Add income source"
    />
  )
}

// ── Payment Channels tab ─────────────────────────────────────────────────────

function PaymentChannelsTab({ venueId, items, onRefetch, api }) {
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  async function handleSave(id, vals) {
    if (id) {
      await api.put(`/venues/${venueId}/cash-recon/config/payment-channels/${id}`, vals)
    } else {
      await api.post(`/venues/${venueId}/cash-recon/config/payment-channels`, { ...vals, sort_order: localItems.length })
    }
    onRefetch()
  }

  async function handleDelete(id) {
    await api.delete(`/venues/${venueId}/cash-recon/config/payment-channels/${id}`)
    onRefetch()
  }

  async function handleToggleActive(id, val) {
    await api.patch(`/venues/${venueId}/cash-recon/config/payment-channels/${id}`, { is_active: val })
    onRefetch()
  }

  async function handleMove(idx, dir) {
    const next = [...localItems]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setLocalItems(next)
    await api.put(`/venues/${venueId}/cash-recon/config/payment-channels/reorder`, { ids: next.map(i => i.id) })
    onRefetch()
  }

  function renderForm({ vals, setVals }) {
    return (
      <>
        <TextInput placeholder="Name *" value={vals.name ?? ''} onChange={v => setVals(p => ({ ...p, name: v }))} />
        <select value={vals.type ?? ''} onChange={e => setVals(p => ({ ...p, type: e.target.value }))}
          className="h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="">Select type…</option>
          {CHANNEL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Description / tooltip shown in daily view</label>
          <TextInput placeholder="e.g. Till 1 card machine" value={vals.tooltip ?? ''} onChange={v => setVals(p => ({ ...p, tooltip: v || null }))} />
        </div>
        <Toggle checked={vals.is_active !== false} onChange={v => setVals(p => ({ ...p, is_active: v }))} label="Active" />
      </>
    )
  }

  return (
    <SettingsListManager
      items={localItems}
      onMove={handleMove}
      onToggleActive={handleToggleActive}
      onDelete={handleDelete}
      onSave={handleSave}
      renderForm={renderForm}
      emptyLabel="No payment channels yet."
      addLabel="Add payment channel"
    />
  )
}

// ── Service Charges tab ──────────────────────────────────────────────────────

function ScSourcesTab({ venueId, items, onRefetch, api }) {
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  async function handleSave(id, vals) {
    if (id) {
      await api.put(`/venues/${venueId}/cash-recon/config/sc-sources/${id}`, vals)
    } else {
      await api.post(`/venues/${venueId}/cash-recon/config/sc-sources`, { ...vals, sort_order: localItems.length })
    }
    onRefetch()
  }

  async function handleDelete(id) {
    await api.delete(`/venues/${venueId}/cash-recon/config/sc-sources/${id}`)
    onRefetch()
  }

  async function handleToggleActive(id, val) {
    await api.patch(`/venues/${venueId}/cash-recon/config/sc-sources/${id}`, { is_active: val })
    onRefetch()
  }

  async function handleMove(idx, dir) {
    const next = [...localItems]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setLocalItems(next)
    await api.put(`/venues/${venueId}/cash-recon/config/sc-sources/reorder`, { ids: next.map(i => i.id) })
    onRefetch()
  }

  function renderForm({ vals, setVals }) {
    return (
      <>
        <TextInput placeholder="Name *" value={vals.name ?? ''} onChange={v => setVals(p => ({ ...p, name: v }))} />
        <select value={vals.type ?? ''} onChange={e => setVals(p => ({ ...p, type: e.target.value }))}
          className="h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="">Select type…</option>
          {SC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <Toggle checked={!!vals.included_in_takings} onChange={v => setVals(p => ({ ...p, included_in_takings: v }))} label="Included in Takings" />
        <Toggle checked={!!vals.included_in_sales}   onChange={v => setVals(p => ({ ...p, included_in_sales:   v }))} label="Included in Sales" />
        <select value={vals.distribution ?? ''} onChange={e => setVals(p => ({ ...p, distribution: e.target.value }))}
          className="h-12 w-full rounded-xl border bg-background px-3 text-base touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="">Distribution…</option>
          {SC_DIST.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Description / tooltip shown in daily view</label>
          <TextInput placeholder="e.g. 12.5% added to all covers" value={vals.tooltip ?? ''} onChange={v => setVals(p => ({ ...p, tooltip: v || null }))} />
        </div>
        <Toggle checked={vals.is_active !== false} onChange={v => setVals(p => ({ ...p, is_active: v }))} label="Active" />
      </>
    )
  }

  return (
    <SettingsListManager
      items={localItems}
      onMove={handleMove}
      onToggleActive={handleToggleActive}
      onDelete={handleDelete}
      onSave={handleSave}
      renderForm={renderForm}
      emptyLabel="No service charge sources yet."
      addLabel="Add service charge source"
    />
  )
}

// ── Staff tab ────────────────────────────────────────────────────────────────

function StaffTab({ venueId, items, onRefetch, api }) {
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  async function handleSave(id, vals) {
    if (id) {
      await api.put(`/venues/${venueId}/cash-recon/config/staff/${id}`, vals)
    } else {
      await api.post(`/venues/${venueId}/cash-recon/config/staff`, vals)
    }
    onRefetch()
  }

  async function handleDelete(id) {
    await api.delete(`/venues/${venueId}/cash-recon/config/staff/${id}`)
    onRefetch()
  }

  async function handleToggleActive(id, val) {
    await api.patch(`/venues/${venueId}/cash-recon/config/staff/${id}`, { is_active: val })
    onRefetch()
  }

  async function handleMove(idx, dir) {
    const next = [...localItems]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setLocalItems(next)
    onRefetch()
  }

  function renderForm({ vals, setVals }) {
    return (
      <>
        <TextInput placeholder="Name *" value={vals.name ?? ''} onChange={v => setVals(p => ({ ...p, name: v }))} />
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Default Rate (£/hr, optional)</label>
          <AmountInput placeholder="0.00" value={vals.default_rate ?? ''} onChange={v => setVals(p => ({ ...p, default_rate: v }))} />
        </div>
        <Toggle checked={vals.is_active !== false} onChange={v => setVals(p => ({ ...p, is_active: v }))} label="Active" />
      </>
    )
  }

  return (
    <SettingsListManager
      items={localItems}
      onMove={handleMove}
      onToggleActive={handleToggleActive}
      onDelete={handleDelete}
      onSave={handleSave}
      renderForm={renderForm}
      emptyLabel="No staff templates yet."
      addLabel="Add staff member"
    />
  )
}

// ── Expense Categories tab ────────────────────────────────────────────────────

function ExpenseCategoriesTab({ venueId, items, onRefetch, api }) {
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  async function handleSave(id, vals) {
    if (id) {
      await api.put(`/venues/${venueId}/cash-recon/config/expense-categories/${id}`, vals)
    } else {
      await api.post(`/venues/${venueId}/cash-recon/config/expense-categories`, { ...vals, sort_order: localItems.length })
    }
    onRefetch()
  }

  async function handleDelete(id) {
    await api.delete(`/venues/${venueId}/cash-recon/config/expense-categories/${id}`)
    onRefetch()
  }

  async function handleToggleActive(id, val) {
    await api.patch(`/venues/${venueId}/cash-recon/config/expense-categories/${id}`, { is_active: val })
    onRefetch()
  }

  async function handleMove(idx, dir) {
    const next = [...localItems]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setLocalItems(next)
    await api.put(`/venues/${venueId}/cash-recon/config/expense-categories/reorder`, { ids: next.map(i => i.id) })
    onRefetch()
  }

  function renderForm({ vals, setVals }) {
    const PRESET_COLOURS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280']
    return (
      <>
        <TextInput placeholder="Category name *" value={vals.name ?? ''} onChange={v => setVals(p => ({ ...p, name: v }))} />
        <div>
          <label className="text-xs text-muted-foreground block mb-2">Colour</label>
          <div className="flex flex-wrap gap-2 items-center">
            {PRESET_COLOURS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setVals(p => ({ ...p, colour: p.colour === c ? null : c }))}
                style={{ backgroundColor: c }}
                className={cn(
                  'w-8 h-8 rounded-full border-2 touch-manipulation transition-transform',
                  vals.colour === c ? 'border-foreground scale-110' : 'border-transparent'
                )}
              />
            ))}
            <button
              type="button"
              onClick={() => setVals(p => ({ ...p, colour: null }))}
              className={cn(
                'h-8 px-2 rounded-full border text-xs touch-manipulation',
                !vals.colour ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              None
            </button>
          </div>
        </div>
        <Toggle checked={vals.is_active !== false} onChange={v => setVals(p => ({ ...p, is_active: v }))} label="Active" />
      </>
    )
  }

  return (
    <SettingsListManager
      items={localItems}
      onMove={handleMove}
      onToggleActive={handleToggleActive}
      onDelete={handleDelete}
      onSave={handleSave}
      renderForm={renderForm}
      emptyLabel="No expense categories yet."
      addLabel="Add category"
    />
  )
}

// ── ROOT PAGE ────────────────────────────────────────────────────────────────

export default function CashRecon() {
  const api = useApi()
  const { venueId: tlVenueId, setVenueId: setTlVenueId } = useTimelineSettings()

  const [view,       setView]      = useState('week')
  const [weekStart,  setWeekStart] = useState(getMonday(new Date()))
  const [dayDate,    setDayDate]   = useState(null)
  const [venueId,    setVenueIdL]  = useState(tlVenueId ?? null)
  const [spreadMode, setSpreadMode] = useState(true)

  // Keep local venueId in sync with TimelineSettings context
  function setVenueId(id) {
    setVenueIdL(id)
    setTlVenueId(id)
  }

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  // Auto-select first venue when list loads
  useEffect(() => {
    if (!venueId && venues.length > 0) {
      setVenueId(venues[0].id)
    }
  }, [venues, venueId])

  function goDay(date) {
    setDayDate(date)
    setView('day')
  }

  function goWages() {
    setView('wages')
  }

  function goSettings() {
    setView('settings')
  }

  function goBack() {
    setView('week')
  }

  if (!venueId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {view === 'week' && (
        spreadMode
          ? <SpreadsheetView
              venueId={venueId}
              venues={venues}
              setVenueId={setVenueId}
              weekStart={weekStart}
              setWeekStart={setWeekStart}
              onSelectDay={goDay}
              onSelectWages={goWages}
              onSettings={goSettings}
              onToggleMode={() => setSpreadMode(false)}
            />
          : <WeekView
              venueId={venueId}
              venues={venues}
              setVenueId={setVenueId}
              weekStart={weekStart}
              setWeekStart={setWeekStart}
              onSelectDay={goDay}
              onSelectWages={goWages}
              onSettings={goSettings}
              onToggleMode={() => setSpreadMode(true)}
            />
      )}
      {view === 'day' && dayDate && (
        <DayView
          venueId={venueId}
          date={dayDate}
          onBack={goBack}
        />
      )}
      {view === 'wages' && (
        <WagesView
          venueId={venueId}
          weekStart={weekStart}
          onBack={goBack}
        />
      )}
      {view === 'settings' && (
        <SettingsView
          venueId={venueId}
          onBack={goBack}
        />
      )}
    </div>
  )
}
