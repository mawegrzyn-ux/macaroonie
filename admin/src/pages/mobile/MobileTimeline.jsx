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
//
// A booking on several tables (a combination) is one box over its tables'
// rows where those rows are next to each other in the list, and one box per
// run of neighbouring rows where they are not (tableRuns(), the office
// Timeline's rule): the pieces carry a link mark, a dashed edge and "also
// T9". So the boxes are not drawn inside the rows: the rows hold the table
// names and the hour lines, and every box sits over them in one layer,
// placed by its first row and the number of rows it covers.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, TriangleAlert, Link2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime, STATUS_COLOURS } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import {
  usePhoneVenue, useDayBookings, useVenueTables, venueToday, VenueDayBar, BookingSheet, NewBookingSheet, allergyIn, useDayFigures,
} from '@/components/bookings/phone'
import { tableRuns, tableIdsOf } from '@/components/bookings/tableRuns'

const HOUR_W = 120     // px per hour: a 90 minute booking is 180 px, room for a name
const LABEL_W = 64     // the table column
const ROW_H = 56
const BOX_GAP = 4      // above and below a box in its rows: one row's box is 48 px high
const BOX_MIN_W = 48   // a short booking still takes a finger
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
  const { data: tables = [] } = useVenueTables(venueId)
  const { data: sittingsRes } = useQuery({
    queryKey: ['sittings-for-date', venueId, day],
    queryFn: () => api.get(`/venues/${venueId}/schedule/sittings-for-date?date=${day}`),
    enabled: !!venueId,
  })
  const figures = useDayFigures(bookings)
  const shown = useMemo(
    () => (showAll ? bookings : bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show')),
    [bookings, showAll])
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

  // A row per table in the tables' own order (the Tables page's drag order,
  // which is also what the booking rules call next to each other), so a
  // combination's tables are neighbours wherever the venue set them so. The
  // unallocated row only when used. Then a box per booking and run of rows.
  const [rows, boxes] = useMemo(() => {
    const used = new Set(shown.flatMap(tableIdsOf))
    const rows = [...tables]
      .filter(t => (t.is_active !== false && !t.is_unallocated) || used.has(t.id))
      .sort((a, b) => Number(b.is_unallocated) - Number(a.is_unallocated) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label, undefined, { numeric: true }))
    const rowIndex = new Map(rows.map((t, i) => [t.id, i]))
    const labelOf = id => rows[rowIndex.get(id)].label
    const boxes = []
    for (const b of shown) {
      const runs = tableRuns(tableIdsOf(b), rowIndex)
      const all = runs.flatMap(r => r.ids)
      for (const run of runs) {
        boxes.push({
          b, row: run.start, span: run.ids.length, pieces: runs.length,
          // The tables are named on a box only when there is more than one.
          own: all.length > 1 ? run.ids.map(labelOf).join(' + ') : '',
          also: all.filter(id => !run.ids.includes(id)).map(labelOf).join(' + '),
        })
      }
    }
    return [rows, boxes]
  }, [tables, shown])
  const anySplit = boxes.some(x => x.pieces > 1)

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
              <div className="relative">
                {rows.map(table => (
                  <div key={table.id} className="flex border-b last:border-b-0" style={{ height: ROW_H }} data-testid="mtl-row" data-table={table.label}>
                    <div className="sticky left-0 z-10 shrink-0 bg-background border-r px-2 flex flex-col justify-center" style={{ width: LABEL_W }}>
                      <span className="text-sm font-semibold truncate">{table.is_unallocated ? 'Unalloc.' : table.label}</span>
                      {!table.is_unallocated && <span className="text-[10px] text-muted-foreground">{table.min_covers}–{table.max_covers}</span>}
                    </div>
                    <div className="relative shrink-0" style={{ width }}>
                      {hours.map(h => <div key={h} className="absolute top-0 bottom-0 border-l border-dashed border-muted" style={{ left: (h - startH) * HOUR_W }} />)}
                    </div>
                  </div>
                ))}
                {/* The bookings, over the rows: under the table names (z-10) and the now line (z-5). */}
                {boxes.map(({ b, row, span, pieces, own, also }) => {
                  const s = hourOf(b.starts_at)
                  let e = hourOf(b.ends_at)
                  if (e <= s) e = 24
                  const split = pieces > 1
                  // A box over several rows names them; a piece in one row is in that table's row already.
                  const where = [span > 1 && own, also && 'also ' + also].filter(Boolean).join(' · ')
                  return (
                    <button key={b.id + ':' + row} type="button" onClick={() => setOpen(b)}
                      data-testid="mtl-booking" data-id={b.id} data-name={b.guest_name} data-status={b.status}
                      data-rows={span} data-pieces={pieces} data-tables={own}
                      aria-label={`${b.guest_name}, ${formatTime(b.starts_at)}, ${b.covers} covers${where ? ', ' + where : ''}`}
                      className={cn('absolute z-[2] rounded-md px-1.5 text-left overflow-hidden touch-manipulation shadow-sm flex flex-col justify-center',
                        split ? 'border-2 border-dashed border-current' : 'border border-black/10',
                        STATUS_COLOURS[b.status], ['cancelled', 'no_show'].includes(b.status) && 'opacity-60 line-through')}
                      style={{
                        left: LABEL_W + (s - startH) * HOUR_W + 1, width: Math.max(BOX_MIN_W, (e - s) * HOUR_W - 3),
                        top: row * ROW_H + BOX_GAP, height: span * ROW_H - 2 * BOX_GAP,
                      }}>
                      <span className="flex items-center gap-1 max-w-full text-xs font-semibold leading-tight">
                        {split && <Link2 className="w-3 h-3 shrink-0" aria-hidden="true" data-testid="mtl-linked" />}
                        <span className="truncate">{b.guest_name}</span>
                        {allergyIn(b) && <TriangleAlert className="w-3 h-3 shrink-0 text-red-700" aria-label="Allergy" />}
                      </span>
                      <span className="block max-w-full text-[11px] leading-tight tabular-nums truncate">
                        {formatTime(b.starts_at)} · {b.covers} cov{span === 1 && where ? ' · ' + where : ''}
                      </span>
                      {span > 1 && <span className="max-w-full text-[11px] leading-tight font-medium line-clamp-2" data-testid="mtl-tables">{where}</span>}
                    </button>
                  )
                })}
              </div>
              {nowX != null && <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-[5] pointer-events-none" style={{ left: LABEL_W + nowX }} data-testid="mtl-now" />}
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground px-1">
        Swipe the times sideways. Tap a booking for its details and status.
        {anySplit && <span data-testid="mtl-split-hint"> <Link2 className="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> The booking is on more tables further up or down.</span>}
      </p>

      {open && <BookingSheet booking={open} bookings={bookings} onClose={() => setOpen(null)} />}
      {adding && (
        <NewBookingSheet venues={venues} venueId={venueId} date={day} onClose={() => setAdding(false)}
          onCreated={(b, d, v) => { setAdding(false); if (v !== venueId) setVenueId(v); setDate(d) }} />
      )}
    </div>
  )
}
