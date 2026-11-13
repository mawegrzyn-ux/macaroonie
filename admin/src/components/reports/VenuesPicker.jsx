// src/components/reports/VenuesPicker.jsx
//
// Which venues a report is run for: all of the group's, or the ones ticked.
//
//   venues    the group's venues ([{ id, name }])
//   value     'all' | [venue id]
//   onChange  called with 'all' or the ids ticked (never an empty list)

import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { Modal } from '@/components/staff/shared'
import { cn } from '@/lib/utils'

export function venuesText(venues, value) {
  if (value === 'all' || !Array.isArray(value)) return 'All venues'
  const names = value.map(id => venues.find(v => v.id === id)?.name).filter(Boolean)
  if (!names.length) return 'All venues'
  if (names.length <= 2) return names.join(' and ')
  return names.length + ' venues'
}

export default function VenuesPicker({ venues, value, onChange, label = 'Venues' }) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(true)
  const [ticked, setTicked] = useState([])
  // Opening the window starts from the venues showing.
  useEffect(() => {
    if (!open) return
    const ids = Array.isArray(value) ? value.filter(id => venues.some(v => v.id === id)) : []
    setAll(!ids.length)
    setTicked(ids)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = id => {
    setAll(false)
    setTicked(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]))
  }
  const ok = all || ticked.length > 0
  const apply = () => {
    if (!ok) return
    // In the venues' own order, so the same choice is always the same list.
    onChange(all ? 'all' : venues.filter(v => ticked.includes(v.id)).map(v => v.id))
    setOpen(false)
  }

  const row = 'flex items-center gap-3 min-h-[48px] px-3 rounded-lg border touch-manipulation cursor-pointer'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label + ': ' + venuesText(venues, value)} data-testid="venues-button"
        className="inline-flex items-center gap-2 min-h-[48px] px-3 py-1.5 rounded-lg border bg-background text-sm text-left touch-manipulation hover:bg-muted max-w-full">
        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="min-w-0">
          <span className="block text-[11px] leading-tight text-muted-foreground">{label}</span>
          <span className="block font-medium leading-tight break-words">{venuesText(venues, value)}</span>
        </span>
      </button>

      {open && (
        <Modal title={label} onClose={() => setOpen(false)}
          footer={(
            <>
              <button type="button" onClick={apply} disabled={!ok} data-testid="venues-apply"
                className="h-12 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
                Show
              </button>
              {!ok && <span className="self-center text-xs text-muted-foreground">Tick at least one venue.</span>}
            </>
          )}>
          <label className={cn(row, all ? 'bg-primary/10 border-primary' : 'bg-background hover:bg-muted')}>
            <input type="checkbox" checked={all} onChange={e => { setAll(e.target.checked); if (e.target.checked) setTicked([]) }}
              className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">All venues</span>
          </label>
          <div className="space-y-2" role="group" aria-label="Only these venues">
            <p className="text-xs font-medium text-muted-foreground">Or only these</p>
            {venues.map(v => {
              const on = !all && ticked.includes(v.id)
              return (
                <label key={v.id} className={cn(row, on ? 'bg-primary/10 border-primary' : 'bg-background hover:bg-muted')}>
                  <input type="checkbox" checked={on} onChange={() => toggle(v.id)} className="w-5 h-5 shrink-0" />
                  <span className="text-sm break-words min-w-0">{v.name}</span>
                </label>
              )
            })}
          </div>
        </Modal>
      )}
    </>
  )
}
