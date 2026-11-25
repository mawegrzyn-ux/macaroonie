// src/pages/mobile/MobileTimeline.jsx
//
// The booking timeline on a phone (/mobile/timeline, `bookings` module).
// One row per table, its bookings as blocks along a time axis that scrolls
// sideways (the table names stay put), so a host sees at a glance which
// table is free when; the guest list (/mobile/guest-list) is the same day
// as a list by time. The office Timeline's time slots down and tables
// across is too wide for 390 px. The day runs from the venue's first
// sitting (or first booking) to its last; today opens at the current time,
// with a red line at now. Tap a block for the booking: its details and
// status (components/bookings/phone.jsx, the office's routes). Cancelled
// and no-show bookings are hidden unless asked for. + makes a booking.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, TriangleAlert } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime, STATUS_COLOURS } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import {
  usePhoneVenue, useDayBookings, venueToday, VenueDayBar, BookingSheet, NewBookingSheet, allergyIn, useDayFigures,
} from '@/components/bookings/phone'

const HOUR_W = 120     // px per hour: a 90 minute booking is 180 px, room for a name
const LABEL_W = 64     // the table column
const ROW_H = 56
const hourOf = iso => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60 }
const toH = t => { const [h, m] = String(t).split(':').map(Number); return h + (m || 0) / 60 }

export default function MobileTimeline() {
  const api = useApi()
  const [venueId, setVenueId, venues, venue] = usePhoneVenue()
  const today = venueToday(venue?.timezone)
  const [date, setDate] = useState(null)
  const day = date ?? today
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const { canManage } = usePermission('bookings')

  const { data: bookings = [], isLoading } = useDayBookings(venueId, day)
  const { data: tables = [] } = useQuery({
    queryKey: ['tables', venueId], queryFn: () => api.get(`/venues/${venueId}/tables`), enabled: !!venueId,
  })
  const { data: sittingsRes } = useQuery({
    queryKey: ['sittings-for-date', venueId, day],
    queryFn: () => api.get(`/venues/${venueId}/schedule/sittings-for-date?date=${day}`),
    enabled: !!venueId,
  })
  const figures = useDayFigures(bookings)
  const shown = showAll ? bookings : bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show')
  const hidden = bookings.length - shown.length

  // The hours the day spans: sittings and bookings, whole hours either side.
  const [startH, endH] = useMemo(() => {
    const sit = sittingsRes?.sittings ?? []
    const starts = [...sit.map(s => toH(s.opens_at)), ...bookings.map(b => hourOf(b.starts_at))]
    const ends = [...sit.map(s => toH(s.closes_at) + 1.5), ...bookings.map(b => {
      const e = hourOf(b.ends_at); return e < hourOf(b.starts_at) ? 24 : e
    })]
    if (!starts.length) return [11, 23]
    return [Math.max(0, Math.floor(Math.min(...starts))), Math.min(24, Math.ceil(Math.max(...ends)))]
  }, [sittingsRes, bookings])
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i)
  const width = (endH - startH) * HOUR_W

  // A row per table (sort order), each booking on its table and, for a
  // combination, on every table of it. The unallocated row only when used.
  const rows = useMemo(() => {
    const byTable = new Map()
    for (const b of shown) {
      for (const id of b.member_table_ids?.length ? b.member_table_ids : [b.table_id]) {
        if (!byTable.has(id)) byTable.set(id, [])
        byTable.get(id).push(b)
      }
    }
    return [...tables]
      .filter(t => (t.is_active !== false && !t.is_unallocated) || byTable.has(t.id))
      .sort((a, b) => Number(b.is_unallocated) - Number(a.is_unallocated) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label, undefined, { numeric: true }))
      .map(t => ({ table: t, list: byTable.get(t.id) ?? [] }))
  }, [tables, shown])

  // Open at now (today) or the first booking, an hour before.
  const scroller = useRef(null)
  const placed = useRef(null)
  useEffect(() => {
    const key = venueId + day
    if (!scroller.current || placed.current === key || !sittingsRes) return
    placed.current = key
    const now = new Date()
    const at = day === today ? now.getHours() + now.getMinutes() / 60 : (shown[0] ? hourOf(shown[0].starts_at) : startH)
    scroller.current.scrollLeft = Math.max(0, (at - 1 - startH) * HOUR_W)
  }, [venueId, day, today, sittingsRes, shown, startH])

  const [nowX, setNowX] = useState(null)
  useEffect(() => {
    if (day !== today) { setNowX(null); return }
    const tick = () => { const n = new Date(); const h = n.getHours() + n.getMinutes() / 60; setNowX(h >= startH && h <= endH ? (h - startH) * HOUR_W : null) }
    tick()
    const t = setInterval(tick, 30_000)
    return () => clearInterval(t)
  }, [day, today, startH, endH])

  return (
    <div className="p-3 pb-10 space-y-3" data-testid="mtl">
      <VenueDayBar venues={venues} venueId={venueId} setVenueId={id => { setVenueId(id); setDate(null) }}
        date={day} setDate={setDate} today={today} canAdd={canManage} onNew={() => setAdding(true)} />
      {!canManage && <ReadOnlyNotice what="the bookings" />}

      <div className="flex flex-wrap items-center justify-between gap-x-2 text-sm">
        <span className="whitespace-nowrap" data-testid="mtl-figures"><b>{figures.bookings}</b> bookings · <b>{figures.covers}</b> covers · {figures.in} in</span>
        {(hidden > 0 || showAll) && (
          <button type="button" onClick={() => setShowAll(v => !v)} className="min-h-[44px] px-2 text-xs text-primary underline underline-offset-2 touch-manipulation" data-testid="mtl-show-all">
            {showAll ? 'Hide cancelled' : `Show ${hidden} cancelled / no-show`}
          </button>
        )}
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
      {!isLoading && !rows.length && <p className="text-sm text-muted-foreground text-center py-8">No tables set up for this restaurant.</p>}

      {rows.length > 0 && (
        <div className="border rounded-xl bg-background overflow-hidden">
          <div ref={scroller} className="overflow-x-auto overscroll-x-contain" data-testid="mtl-scroll">
            <div className="relative" style={{ width: LABEL_W + width }}>
              {/* Hours along the top */}
              <div className="flex h-9 border-b section-head sticky top-0 z-20">
                <div className="sticky left-0 z-30 shrink-0 bg-background border-r text-[11px] font-semibold flex items-center px-2" style={{ width: LABEL_W }}>Table</div>
                {hours.map(h => (
                  <div key={h} className="shrink-0 border-l text-[11px] font-semibold px-1 flex items-center tabular-nums" style={{ width: HOUR_W }}>{String(h).padStart(2, '0')}:00</div>
                ))}
              </div>
              {rows.map(({ table, list }) => (
                <div key={table.id} className="flex border-b last:border-b-0 relative" style={{ height: ROW_H }} data-testid="mtl-row" data-table={table.label}>
                  <div className="sticky left-0 z-10 shrink-0 bg-background border-r px-2 flex flex-col justify-center" style={{ width: LABEL_W }}>
                    <span className="text-sm font-semibold truncate">{table.is_unallocated ? 'Unalloc.' : table.label}</span>
                    {!table.is_unallocated && <span className="text-[10px] text-muted-foreground">{table.min_covers}–{table.max_covers}</span>}
                  </div>
                  <div className="relative shrink-0" style={{ width }}>
                    {hours.map(h => <div key={h} className="absolute top-0 bottom-0 border-l border-dashed border-muted" style={{ left: (h - startH) * HOUR_W }} />)}
                    {list.map(b => {
                      const s = hourOf(b.starts_at)
                      let e = hourOf(b.ends_at)
                      if (e <= s) e = 24
                      const left = (s - startH) * HOUR_W
                      const w = Math.max(40, (e - s) * HOUR_W - 3)
                      return (
                        <button key={b.id} type="button" onClick={() => setOpen(b)} data-testid="mtl-booking" data-name={b.guest_name} data-status={b.status}
                          className={cn('absolute top-1 bottom-1 rounded-md px-1.5 text-left overflow-hidden touch-manipulation border border-black/10 shadow-sm',
                            STATUS_COLOURS[b.status], ['cancelled', 'no_show'].includes(b.status) && 'opacity-60 line-through')}
                          style={{ left: left + 1, width: w }}>
                          <span className="flex items-center gap-1 text-xs font-semibold leading-tight">
                            <span className="truncate">{b.guest_name}</span>
                            {allergyIn(b) && <TriangleAlert className="w-3 h-3 shrink-0 text-red-700" aria-label="Allergy" />}
                          </span>
                          <span className="block text-[11px] leading-tight tabular-nums truncate">{formatTime(b.starts_at)} · {b.covers} cov</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {nowX != null && <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-[5] pointer-events-none" style={{ left: LABEL_W + nowX }} data-testid="mtl-now" />}
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground px-1">Swipe the times sideways. Tap a booking for its details and status.</p>

      {open && <BookingSheet booking={open} bookings={bookings} onClose={() => setOpen(null)} />}
      {adding && (
        <NewBookingSheet venues={venues} venueId={venueId} date={day} onClose={() => setAdding(false)}
          onCreated={(b, d, v) => { setAdding(false); if (v !== venueId) setVenueId(v); setDate(d) }} />
      )}
    </div>
  )
}
