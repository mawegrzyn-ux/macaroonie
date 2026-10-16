// src/components/staff/shared.jsx
//
// Building blocks shared by the Staff, Roles, Rota setup and Rota pages
// and the Rota dashboard widgets.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, CalendarDays } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, openPicker } from '@/lib/utils'

// ── Data ──────────────────────────────────────────────────────

export function useVenues() {
  const api = useApi()
  return useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
}

/** Venue choice shared by the staff pages, remembered per browser. */
export function useVenueChoice(venues) {
  const [venueId, setVenueIdRaw] = useState(() => {
    try { return localStorage.getItem('maca_staff_venue') || '' } catch { return '' }
  })
  const valid = venues.some(v => v.id === venueId)
  const effective = valid ? venueId : (venues[0]?.id ?? '')
  function setVenueId(id) {
    setVenueIdRaw(id)
    try { localStorage.setItem('maca_staff_venue', id) } catch { /* private mode */ }
  }
  return [effective, setVenueId]
}

/** Tenant-wide rota settings, shifts and roles. */
export function useRotaSetup() {
  const api = useApi()
  return useQuery({ queryKey: ['rota-setup'], queryFn: () => api.get('/rota/setup') })
}

// ── Formatting ────────────────────────────────────────────────

export const hhmm = t => (t ? String(t).slice(0, 5) : '')

export function toMin(t) {
  const [h, m] = hhmm(t).split(':').map(Number)
  return h * 60 + (m || 0)
}

export function fromMin(min) {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "HH:MM" options across the day at the given step, e.g. 30 → 00:00, 00:30 … 23:30. */
export function timeOptions(step = 15) {
  return Array.from({ length: Math.floor(1440 / step) }, (_, i) => fromMin(i * step))
}

/** Minutes a range covers; end at or before start runs past midnight. */
export function rangeMinutes(start, end) {
  let d = toMin(end) - toMin(start)
  if (d <= 0) d += 1440
  return d
}

export function fmtHours(h) {
  const n = Number(h) || 0
  return `${Math.round(n * 100) / 100}h`
}

/** "Wed 4 Nov" from "YYYY-MM-DD" (no time zone shifts). */
export function fmtDay(d, withYear = false) {
  if (!d) return ''
  return format(parseISO(String(d).slice(0, 10)), withYear ? 'EEE d MMM yyyy' : 'EEE d MMM')
}

/** "YYYY-MM-DD" n days after `d`. */
export function addDay(d, n = 1) {
  const x = new Date(String(d).slice(0, 10) + 'T12:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

/**
 * Where a person stands on `today` (migration 164): left (past their last
 * working day), leaving (last working day today or later), and their
 * current / next off-rota period. Dates are "YYYY-MM-DD".
 */
export function staffStanding(s, today) {
  const leftOn = s.left_on ? String(s.left_on).slice(0, 10) : null
  const periods = s.off_periods ?? []
  return {
    leftOn,
    left:    !!leftOn && leftOn < today,
    leaving: !!leftOn && leftOn >= today,
    offNow:  periods.find(p => p.from_date <= today && p.to_date >= today) ?? null,
    offNext: periods.filter(p => p.from_date > today).sort((a, b) => a.from_date.localeCompare(b.from_date))[0] ?? null,
  }
}

/** One-line reason a rota day is blocked: left, or an off-rota period. */
export function offDayText(off) {
  if (!off) return ''
  if (off.kind === 'left') return `Left. Last working day ${fmtDay(off.left_on)}${off.note ? ` (${off.note})` : ''}`
  return `Off the rota ${fmtDay(off.from)} to ${fmtDay(off.until)}${off.note ? ` (${off.note})` : ''}`
}

export const PAY_BASES = [
  { value: 'week',  label: 'Per week' },
  { value: 'day',   label: 'Per day' },
  { value: 'shift', label: 'Per shift' },
]

// ── UI ────────────────────────────────────────────────────────

export function PageHeader({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 max-lg:notouch:pl-14 border-b shrink-0 min-h-[56px] bg-background">
      {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
      <h1 className="font-semibold text-sm flex-1 min-w-0 truncate">{title}</h1>
      {children}
    </div>
  )
}

export function VenuePicker({ venues, venueId, onChange }) {
  if (!venues.length) return null
  return (
    <select value={venueId} onChange={e => onChange(e.target.value)}
      aria-label="Venue"
      className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40">
      {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  )
}

export function Segmented({ value, options, onChange, disabled, className }) {
  return (
    <div className={cn('inline-flex rounded-lg border overflow-hidden', className)}>
      {options.map(o => (
        <button key={o.value} type="button" disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-11 px-3 text-sm font-medium touch-manipulation transition-colors disabled:opacity-50',
            value === o.value ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
          )}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function TimeSelect({ value, onChange, step = 15, disabled, label, className }) {
  const opts = timeOptions(step)
  const v = hhmm(value)
  const list = v && !opts.includes(v) ? [v, ...opts] : opts
  return (
    <select value={v} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.value)}
      className={cn('h-11 rounded-lg border bg-background px-2 text-sm tabular-nums touch-manipulation disabled:opacity-50', className)}>
      {list.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  )
}

/** Delete with an inline "Are you sure?" (design rule 6). */
export function ConfirmDelete({ onConfirm, label = 'Delete', confirmLabel = 'Yes, delete', disabled }) {
  const [asking, setAsking] = useState(false)
  if (asking) {
    return (
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={() => { setAsking(false); onConfirm() }} disabled={disabled}
          className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium touch-manipulation disabled:opacity-50">
          {confirmLabel}
        </button>
        <button type="button" onClick={() => setAsking(false)}
          className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">
          Cancel
        </button>
      </span>
    )
  }
  return (
    <button type="button" onClick={() => setAsking(true)} disabled={disabled} aria-label={label} title={label}
      className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation disabled:opacity-50">
      <Trash2 className="w-4 h-4" />
    </button>
  )
}

function SortableRow({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 px-2 py-1.5 bg-background">
      <button type="button" {...attributes} {...listeners} aria-label="Drag to reorder"
        className="w-11 h-11 shrink-0 flex items-center justify-center text-muted-foreground cursor-grab active:cursor-grabbing touch-manipulation">
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

/** Drag-reorder list (design rule 3). Calls onReorder(ids) after a drop. */
// `locked` (View access) shows the rows in order with no dragging.
export function SortableRows({ items, onReorder, renderItem, locked = false }) {
  const [order, setOrder] = useState(items)
  useEffect(() => setOrder(items), [items])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )
  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const next = arrayMove(order, order.findIndex(i => i.id === active.id), order.findIndex(i => i.id === over.id))
    setOrder(next)
    onReorder(next.map(i => i.id))
  }
  if (locked) {
    return (
      <div className="rounded-xl border divide-y overflow-hidden">
        {order.map(item => <div key={item.id} className="px-2 py-1">{renderItem(item)}</div>)}
      </div>
    )
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <div className="rounded-xl border divide-y overflow-hidden">
          {order.map(item => (
            <SortableRow key={item.id} id={item.id}>{renderItem(item)}</SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-lg bg-background rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <h2 className="text-sm font-semibold truncate">{title}</h2>
          <button type="button" onClick={onClose}
            className="h-11 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted touch-manipulation">Close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t flex flex-wrap gap-2">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * A labelled form row. Pass `group` when the row holds buttons (Segmented,
 * chips, colour swatches): a <label> forwards a tap on its text to the first
 * button inside it, which silently changes the setting.
 */
export function Field({ label, hint, children, group }) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block" {...(group ? { role: 'group', 'aria-label': typeof label === 'string' ? label : undefined } : {})}>
      <span className="block text-xs font-medium text-muted-foreground mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground mt-1">{hint}</span>}
    </Tag>
  )
}

/** Date as a styled button over an invisible date input (design rule 10). */
export function DateButton({ value, onChange, min, label = 'Date', placeholder = 'Pick a date', className }) {
  return (
    <span className={cn('relative inline-flex items-center gap-2 h-11 px-3 rounded-lg border bg-background text-sm touch-manipulation', className)}>
      <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className={cn('tabular-nums truncate', !value && 'text-muted-foreground')}>{value ? fmtDay(value, true) : placeholder}</span>
      <input type="date" value={value || ''} min={min} aria-label={label} onClick={openPicker}
        onChange={e => e.target.value && onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
    </span>
  )
}

export const inputCls ='h-11 w-full rounded-lg border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40'

export function ErrorNote({ error }) {
  if (!error) return null
  return <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error.message || String(error)}</p>
}
