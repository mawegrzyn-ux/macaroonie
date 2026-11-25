// src/pages/mobile/MobileGuestList.jsx
//
// The day's guest list on a phone (/mobile/guest-list, `bookings` module):
// every booking by time with its covers, table, status and notes, a red flag
// when the notes mention an allergy, search by name or phone, a filter by
// status (still to come by default: cancelled, no-show and checked out are
// under All), and Arrived / Seated on the row for the host stand (bookings
// Manage, the statuses the venue offers). Tap a row for the booking's sheet.
// Same day, same routes and same cache as the phone timeline and the office
// Bookings page (components/bookings/phone.jsx).

import { useMemo, useState } from 'react'
import { Search, TriangleAlert, StickyNote, Loader2, X } from 'lucide-react'
import { cn, formatTime, STATUS_LABELS } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { statusChoices, INACTIVE_STATUSES } from '@/components/bookings/statuses'
import {
  usePhoneVenue, useDayBookings, useBookingRules, useSetStatus, venueToday, VenueDayBar, BookingSheet,
  StatusPill, tableText, allergyIn, useDayFigures,
} from '@/components/bookings/phone'

// The host stand's two taps, in the order a guest goes through them.
const QUICK = ['arrived', 'seated']
const BEFORE = { arrived: ['unconfirmed', 'confirmed', 'reconfirmed', 'pending_payment'], seated: ['unconfirmed', 'confirmed', 'reconfirmed', 'pending_payment', 'arrived'] }

export default function MobileGuestList() {
  const [venueId, setVenueId, venues, venue] = usePhoneVenue()
  const today = venueToday(venue?.timezone)
  const [date, setDate] = useState(null)
  const day = date ?? today
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('coming')
  const [open, setOpen] = useState(null)
  const { canManage } = usePermission('bookings')
  const { data: bookings = [], isLoading } = useDayBookings(venueId, day)
  const { data: rules } = useBookingRules(venueId)
  const setStatus = useSetStatus()
  const figures = useDayFigures(bookings)

  const counts = useMemo(() => {
    const c = {}
    for (const b of bookings) c[b.status] = (c[b.status] ?? 0) + 1
    return c
  }, [bookings])
  const filters = [
    { key: 'coming', label: 'Still to come', n: bookings.filter(b => !INACTIVE_STATUSES.has(b.status)).length },
    { key: 'all', label: 'All', n: bookings.length },
    ...Object.keys(STATUS_LABELS).filter(s => counts[s]).map(s => ({ key: s, label: STATUS_LABELS[s], n: counts[s] })),
  ]
  const list = useMemo(() => {
    const words = q.trim().toLowerCase()
    const digits = words.replace(/\D/g, '')
    return [...bookings]
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      .filter(b => filter === 'all' || (filter === 'coming' ? !INACTIVE_STATUSES.has(b.status) : b.status === filter))
      .filter(b => !words || (b.guest_name ?? '').toLowerCase().includes(words)
        || (digits.length >= 3 && (b.guest_phone ?? '').replace(/\D/g, '').includes(digits)))
  }, [bookings, q, filter])

  const quickFor = b => (canManage ? statusChoices(rules, b.status).filter(s => QUICK.includes(s) && BEFORE[s].includes(b.status)) : [])

  return (
    <div className="p-3 pb-10 space-y-3" data-testid="mgl">
      <VenueDayBar venues={venues} venueId={venueId} setVenueId={id => { setVenueId(id); setDate(null) }}
        date={day} setDate={setDate} today={today} />
      {!canManage && <ReadOnlyNotice what="the bookings" />}

      <div className="grid grid-cols-3 gap-2 text-center" data-testid="mgl-figures">
        <Figure label="Bookings" value={figures.bookings} />
        <Figure label="Covers" value={figures.covers} />
        <Figure label="In" value={figures.in} />
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or phone" type="search" data-testid="mgl-search"
          className="w-full h-12 rounded-lg border bg-background pl-9 pr-12 text-base" />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Clear search"
            className="absolute right-0 top-0 w-12 h-12 flex items-center justify-center text-muted-foreground touch-manipulation"><X className="w-4 h-4" /></button>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-1" data-testid="mgl-filters">
        {filters.map(f => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} data-filter={f.key}
            className={cn('shrink-0 min-h-[44px] px-3 rounded-full border text-sm whitespace-nowrap touch-manipulation',
              filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
            {f.label} <span className="tabular-nums opacity-75">{f.n}</span>
          </button>
        ))}
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
      {!isLoading && !list.length && (
        <p className="text-sm text-muted-foreground text-center py-8" data-testid="mgl-empty">
          {bookings.length ? 'No bookings match.' : 'No bookings on this day.'}
        </p>
      )}

      <ul className="space-y-2">
        {list.map(b => {
          const quick = quickFor(b)
          return (
            <li key={b.id} className="border rounded-xl bg-background overflow-hidden" data-testid="mgl-row" data-name={b.guest_name} data-status={b.status}>
              <button type="button" onClick={() => setOpen(b)} className="w-full flex items-start gap-3 p-3 text-left touch-manipulation active:bg-muted">
                <span className="w-12 shrink-0 text-base font-semibold tabular-nums">{formatTime(b.starts_at)}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold truncate">{b.guest_name}</span>
                    {allergyIn(b) && <TriangleAlert className="w-4 h-4 shrink-0 text-red-600" aria-label="Allergy in the notes" data-testid="mgl-allergy" />}
                  </span>
                  <span className="block text-xs text-muted-foreground">{b.covers} {b.covers === 1 ? 'cover' : 'covers'}{tableText(b) ? ' · ' + tableText(b) : ''}</span>
                  {(b.guest_notes || b.operator_notes) && (
                    <span className={cn('mt-1 flex items-start gap-1 text-xs', allergyIn(b) ? 'text-red-700' : 'text-muted-foreground')}>
                      <StickyNote className="w-3 h-3 mt-0.5 shrink-0" /><span className="line-clamp-2">{[b.guest_notes, b.operator_notes].filter(Boolean).join(' · ')}</span>
                    </span>
                  )}
                </span>
                <StatusPill status={b.status} className="shrink-0 mt-0.5" />
              </button>
              {quick.length > 0 && (
                <div className="grid border-t" style={{ gridTemplateColumns: `repeat(${quick.length}, minmax(0, 1fr))` }}>
                  {quick.map((s, i) => (
                    <button key={s} type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: b.id, status: s })}
                      data-testid={'mgl-' + s} className={cn('min-h-[48px] text-sm font-semibold text-primary touch-manipulation active:bg-muted disabled:opacity-50', i > 0 && 'border-l')}>
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {setStatus.error && <p className="text-xs text-red-700">{setStatus.error.message}</p>}

      {open && <BookingSheet booking={open} bookings={bookings} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Figure({ label, value }) {
  return (
    <div className="rounded-xl border bg-background py-2">
      <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
