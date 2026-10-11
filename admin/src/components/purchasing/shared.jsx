// src/components/purchasing/shared.jsx
//
// Building blocks for the purchasing pages (Inventory, Suppliers, Order
// lists, Purchasing and its phone version). Pack maths and prices come from
// shared/procurement.js, the same file the API uses.

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { CalendarDays, Minus, Plus, Snowflake, Thermometer, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DAY_LABELS, PO_STATUSES, perUnitLabel, unitPrice } from '@shared/procurement.js'

export const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

export const money = n => (n == null || n === '' ? '' : '£' + Number(n).toFixed(2))

/** Price per kg / litre / each, e.g. "£2.10 / kg". */
export function perUnit(price, packBase, baseUnit) {
  const p = unitPrice(price, packBase, baseUnit)
  if (p == null) return ''
  return `£${p < 1 ? p.toFixed(3) : p.toFixed(2)} / ${perUnitLabel(baseUnit)}`
}

export const fmtDate = d => (d ? format(parseISO(String(d).slice(0, 10)), 'EEE d MMM') : '')
export const fmtDateLong = d => (d ? format(parseISO(String(d).slice(0, 10)), 'EEEE d MMMM yyyy') : '')

// ── Data ──────────────────────────────────────────────────────

export function usePurchasingMeta() {
  const api = useApi()
  return useQuery({ queryKey: ['purchasing-meta'], queryFn: () => api.get('/purchasing/meta'), staleTime: 60_000 })
}

export function useCategories(enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: ['inv-categories'], queryFn: () => api.get('/inventory/categories'), enabled })
}

export function useSuppliers(enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers'), enabled })
}

// ── Inputs ────────────────────────────────────────────────────

/**
 * A number box that keeps what's typed while focused (so it can be cleared
 * and retyped) and reports a number, or null when empty, on every change.
 */
export function NumInput({ value, onChange, className, allowNegative = false, ...props }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value))
  }, [value])
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={e => { focused.current = true; props.onFocus?.(e) }}
      onBlur={e => { focused.current = false; setText(value == null ? '' : String(value)); props.onBlur?.(e) }}
      onChange={e => {
        const t = e.target.value.replace(',', '.')
        if (!(allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/).test(t)) return
        setText(t)
        const n = parseFloat(t)
        onChange(t === '' || t === '-' || Number.isNaN(n) ? null : n)
      }}
      className={cn('h-11 w-full rounded-lg border bg-background px-3 text-sm tabular-nums touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40', className)}
    />
  )
}

/** − qty + with a typed box in the middle (48px targets). */
export function QtyStepper({ value, onChange, step = 1, disabled, label, className }) {
  const v = Number(value) || 0
  return (
    <div className={cn('inline-flex items-center rounded-xl border bg-background overflow-hidden', className)}>
      <button type="button" disabled={disabled || v <= 0} aria-label={`Less ${label || ''}`}
        onClick={() => onChange(Math.max(0, Math.round((v - step) * 1000) / 1000))}
        className="w-12 h-12 flex items-center justify-center hover:bg-muted disabled:opacity-30 touch-manipulation">
        <Minus className="w-4 h-4" />
      </button>
      <NumInput value={v || null} onChange={n => onChange(n ?? 0)} disabled={disabled} placeholder="0"
        aria-label={label ? `Quantity of ${label}` : 'Quantity'}
        className={cn('w-14 h-12 rounded-none border-0 border-x px-1 text-center text-base font-semibold', v > 0 && 'bg-primary/5')} />
      <button type="button" disabled={disabled} aria-label={`More ${label || ''}`}
        onClick={() => onChange(Math.round((v + step) * 1000) / 1000)}
        className="w-12 h-12 flex items-center justify-center hover:bg-muted disabled:opacity-30 touch-manipulation">
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

/** Seven toggles, Monday first. value: int[] (0 = Sunday). */
export function DayPicker({ value, onChange, disabled }) {
  const set = new Set(value || [])
  return (
    <div className="flex flex-wrap gap-1.5">
      {[1, 2, 3, 4, 5, 6, 0].map(d => (
        <button key={d} type="button" disabled={disabled}
          onClick={() => {
            const next = new Set(set)
            next.has(d) ? next.delete(d) : next.add(d)
            onChange([...next].sort())
          }}
          className={cn('h-11 w-12 rounded-lg border text-sm font-medium touch-manipulation disabled:opacity-50',
            set.has(d) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
          {DAY_LABELS[d]}
        </button>
      ))}
    </div>
  )
}

export const daysLabel = days => (days?.length
  ? [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).map(d => DAY_LABELS[d]).join(', ')
  : 'Any day')

/** A styled date button with the OS date picker under it (design rule 10). */
export function DateButton({ value, onChange, min, className, label = 'Date' }) {
  return (
    <span className={cn('relative inline-flex items-center gap-2 h-11 px-3 rounded-lg border bg-background text-sm touch-manipulation', className)}>
      <CalendarDays className="w-4 h-4 text-muted-foreground" />
      <span className="tabular-nums">{value ? fmtDate(value) : 'Pick a date'}</span>
      <input type="date" value={value || ''} min={min} aria-label={label}
        onChange={e => e.target.value && onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer" />
    </span>
  )
}

// ── Badges ────────────────────────────────────────────────────

export function StorageBadge({ storage }) {
  if (storage === 'chilled') {
    return <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800"><Thermometer className="w-3 h-3" />Chilled</span>
  }
  if (storage === 'frozen') {
    return <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800"><Snowflake className="w-3 h-3" />Frozen</span>
  }
  return null
}

const PO_COLOURS = {
  to_send: 'bg-amber-100 text-amber-900',
  sent: 'bg-blue-100 text-blue-900',
  received: 'bg-green-100 text-green-900',
  cancelled: 'bg-muted text-muted-foreground line-through',
}

export function PoStatusBadge({ status }) {
  return <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap', PO_COLOURS[status])}>{PO_STATUSES[status] ?? status}</span>
}

// ── Layout ────────────────────────────────────────────────────

/** Right-hand panel over the page (full width on a phone), scrollable. */
export function Drawer({ title, subtitle, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="flex-1 cursor-default" onClick={onClose} />
      <div className={cn('h-full w-full bg-page shadow-2xl flex flex-col', wide ? 'sm:w-[720px]' : 'sm:w-[560px]')}>
        <div className="flex items-center gap-2 px-4 h-14 border-b bg-background shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t bg-background flex flex-wrap gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

/** White card with an accent header (design rule 12). */
export function Card({ title, actions, children, className, bodyClass }) {
  return (
    <section className={cn('rounded-xl border bg-background overflow-hidden', className)}>
      {(title || actions) && (
        <div className="section-head flex items-center gap-2 px-4 py-2.5 min-h-[48px]">
          <h3 className="text-sm font-semibold flex-1 min-w-0 truncate">{title}</h3>
          {actions}
        </div>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  )
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 min-h-[44px] touch-manipulation disabled:opacity-50">
      <span className={cn('relative w-10 h-6 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </button>
  )
}

export const btn = {
  primary: 'h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 inline-flex items-center justify-center gap-2',
  outline: 'h-11 px-4 rounded-lg border bg-background text-sm font-medium hover:bg-muted touch-manipulation disabled:opacity-50 inline-flex items-center justify-center gap-2',
  ghost: 'h-11 px-3 rounded-lg text-sm hover:bg-muted touch-manipulation disabled:opacity-50 inline-flex items-center justify-center gap-2',
}

// ── Printing ──────────────────────────────────────────────────

/** Print an HTML document through a hidden iframe. */
export function printHtml(html) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const cleanup = () => { if (frame.parentNode) frame.parentNode.removeChild(frame) }
  frame.onload = () => {
    const win = frame.contentWindow
    win.addEventListener('afterprint', () => setTimeout(cleanup, 100))
    win.focus()
    win.print()
    setTimeout(cleanup, 60_000)
  }
  frame.srcdoc = html
}

/** Read a File as base64 (no data: prefix). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
