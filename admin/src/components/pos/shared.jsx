// src/components/pos/shared.jsx
//
// Building blocks for the Till (POS) admin pages: Store tech, Floor plan,
// Till reports (docs/POS.md). The generic pieces (Modal, Field, sortable
// rows, delete confirm) come from the staff pages' shared file.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

export {
  PageHeader, Modal, Field, inputCls, ErrorNote, ConfirmDelete, SortableRows, Segmented,
} from '@/components/staff/shared'

export const money = p => (Number(p) < 0 ? '−' : '') + '£' + (Math.abs(Number(p) || 0) / 100).toFixed(2)
export const pct = n => (Number(n) || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 }) + '%'

/** The venue the till pages work on, remembered per browser. */
export function usePosVenue() {
  const api = useApi()
  const { data: venues = [], isLoading } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const [chosen, setChosen] = useState(() => { try { return localStorage.getItem('maca_pos_venue') || '' } catch { return '' } })
  const venueId = venues.some(v => v.id === chosen) ? chosen : (venues[0]?.id ?? '')
  function setVenueId(id) {
    setChosen(id)
    try { localStorage.setItem('maca_pos_venue', id) } catch { /* private mode */ }
  }
  return { venues, venueId, setVenueId, venue: venues.find(v => v.id === venueId), isLoading }
}

export function VenueSelect({ venues, venueId, onChange }) {
  if (venues.length < 2) return null
  return (
    <select value={venueId} onChange={e => onChange(e.target.value)} aria-label="Venue"
      className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40">
      {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  )
}

/** Everything the setup page shows for one venue (GET /pos/venues/:id/setup). */
export function usePosSetup(venueId) {
  const api = useApi()
  return useQuery({ queryKey: ['pos-setup', venueId], queryFn: () => api.get(`/pos/venues/${venueId}/setup`), enabled: !!venueId })
}

/** A white card with an accent header (design rule 12). */
export function Section({ title, hint, children, actions, bodyClass }) {
  return (
    <section className="rounded-xl border bg-background overflow-hidden">
      <div className="px-4 py-3 section-head flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
        </div>
        {actions}
      </div>
      <div className={cn('p-4 space-y-4', bodyClass)}>{children}</div>
    </section>
  )
}

export function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className={cn('flex items-start gap-3 min-h-[44px] py-1 cursor-pointer touch-manipulation', disabled && 'opacity-50')}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="w-5 h-5 mt-0.5 shrink-0" />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

export function Btn({ children, onClick, variant = 'default', disabled, type = 'button', className, title, ...rest }) {
  return (
    <button {...rest} type={type} title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={cn('inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg text-sm font-medium touch-manipulation disabled:opacity-50 shrink-0',
        variant === 'primary' ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : variant === 'danger' ? 'bg-destructive text-destructive-foreground'
            : 'border bg-background hover:bg-muted', className)}>
      {children}
    </button>
  )
}

/** A small number box that keeps what was typed while focused (empty is allowed). */
export function NumberBox({ value, onChange, decimals = 0, min = 0, max = 1e9, className, ariaLabel, placeholder }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value == null ? '' : String(value)) }, [value, focused])
  return (
    <input inputMode={decimals ? 'decimal' : 'numeric'} value={text} aria-label={ariaLabel} placeholder={placeholder}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={e => {
        const t = e.target.value.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, '')
        setText(t)
        if (t === '') return onChange(null)
        const n = Number(t)
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, decimals ? Math.round(n * 10 ** decimals) / 10 ** decimals : Math.round(n))))
      }}
      className={cn('h-11 w-24 rounded-lg border bg-background px-3 text-sm tabular-nums touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40', className)} />
  )
}

/** Colour swatches for till buttons (null = default). */
export const TILL_COLOURS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563']

export function ColourPick({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => onChange(null)} aria-label="No colour"
        className={cn('w-11 h-11 rounded-lg border text-xs touch-manipulation', !value && 'ring-2 ring-primary')}>None</button>
      {TILL_COLOURS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={'Colour ' + c}
          style={{ background: c }} className={cn('w-11 h-11 rounded-lg touch-manipulation', value === c && 'ring-2 ring-offset-2 ring-primary')} />
      ))}
    </div>
  )
}

/** "3 min ago" style time. */
export function ago(iso) {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.round(s / 60) + ' min ago'
  if (s < 86400) return Math.round(s / 3600) + ' h ago'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
