// src/pages/Timeline.jsx
// Gantt-style timeline:
//  - Rows = tables (grouped by section)
//  - Columns = time slots across the selected day
//  - Bookings rendered as draggable cards positioned by time
//  - Drag to new slot or new table → PATCH booking (admin override)
//  - Click booking → detail drawer
//  - Live WS updates via useRealtimeBookings
//
// B1: Grey background strips on fully-unavailable slots (covers=1 overlay)
// B2: Inline "Confirm" button on unconfirmed cards when enable_unconfirmed_flow is on

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO, startOfDay } from 'date-fns'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable } from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { ChevronLeft, ChevronRight, Plus, TriangleAlert } from 'lucide-react'
import { useApi } from '@/lib/api'
import { useRealtimeBookings } from '@/hooks/useRealtimeBookings'
import { cn, formatTime, STATUS_COLOURS, STATUS_LABELS } from '@/lib/utils'
import BookingDrawer from '@/components/bookings/BookingDrawer'
import NewBookingModal from '@/components/bookings/NewBookingModal'
import { useTimelineSettings } from '@/contexts/TimelineSettingsContext'

// ── Constants ────────────────────────────────────────────────
const HOUR_WIDTH   = 80     // px per hour
const ROW_HEIGHT   = 32     // px per table row (compact single-line)
const START_HOUR   = 9      // timeline starts at 09:00
const END_HOUR     = 24     // timeline ends at 24:00
const TOTAL_HOURS  = END_HOUR - START_HOUR
const TOTAL_WIDTH  = TOTAL_HOURS * HOUR_WIDTH

function timeToX(iso) {
  const d    = parseISO(iso)
  const hours = d.getHours() + d.getMinutes() / 60
  return (hours - START_HOUR) * HOUR_WIDTH
}

// Convert a Postgres TIME string ('HH:MM' or 'HH:MM:SS') to canvas x position.
// Used to convert sitting opens_at/closes_at (not full timestamps) to pixels.
function sittingTimeToX(t) {
  const [h, m] = t.split(':').map(Number)
  return (h + m / 60 - START_HOUR) * HOUR_WIDTH
}

function durationToWidth(startIso, endIso) {
  const start = parseISO(startIso)
  const end   = parseISO(endIso)
  const mins  = (end - start) / 60_000
  return (mins / 60) * HOUR_WIDTH
}

// ── Draggable booking card ────────────────────────────────────
// spanRows: 1 = normal single-row card
//           N = spans N consecutive table rows (height multiplied)
// enableUnconfirmedFlow: show Confirm button when status === 'unconfirmed'
function BookingCard({ booking, onClick, isDragging, resizePreviewMs, onResizeStart, spanRows = 1, enableUnconfirmedFlow = false, onConfirm, overCapacity = false }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id:   booking.id,
    data: { booking },
  })

  const x        = timeToX(booking.starts_at)
  const endsAtIso = resizePreviewMs ? new Date(resizePreviewMs).toISOString() : booking.ends_at
  const w        = durationToWidth(booking.starts_at, endsAtIso)

  const style = {
    left:      x,
    width:     Math.max(w - 4, 40),
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    // Spanning cards use explicit height; normal cards use CSS bottom:4px
    ...(spanRows > 1 ? { height: ROW_HEIGHT * spanRows - 8, bottom: 'auto' } : {}),
    // Z-order: dragging > spanning > active > inactive.
    // Inactive (cancelled/no_show) render below active bookings so when a new
    // booking occupies the same slot, the active card always shows on top.
    zIndex: isDragging ? 20 : spanRows > 1 ? 5 : (['cancelled','no_show','checked_out'].includes(booking.status) ? 0 : 1),
  }

  const showConfirmBtn = enableUnconfirmedFlow && booking.status === 'unconfirmed'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick(booking) }}
      className={cn(
        'timeline-slot overflow-hidden',
        booking.status,
        isDragging && 'dragging'
      )}
    >
      {/* Single compact row: covers · name */}
      <div className="flex items-center h-full pl-1.5 pr-[18px] gap-1 min-w-0">
        {/* Covers badge */}
        <span className="text-[10px] font-bold tabular-nums shrink-0 opacity-70 leading-none">
          {booking.covers}
        </span>
        {overCapacity && <TriangleAlert className="w-2.5 h-2.5 text-orange-600 shrink-0" />}
        {/* Guest name — truncates if card is too narrow */}
        <span className="text-[11px] font-semibold truncate leading-none">
          {booking.guest_name}
        </span>
        {/* B2: Quick-confirm — tiny inline tick when unconfirmed flow is on */}
        {showConfirmBtn && (
          <button
            onClick={(e) => { e.stopPropagation(); onConfirm(booking.id) }}
            className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-amber-500 hover:bg-amber-600
              text-white font-bold leading-none touch-manipulation"
          >
            ✓
          </button>
        )}
      </div>

      {/* Resize handle — kept at right: 8px so it falls inside the arrow clip polygon at all heights */}
      <div
        className="absolute right-[8px] top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/10"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onResizeStart(booking, e.clientX)
        }}
      />
    </div>
  )
}

// ── Droppable table row ───────────────────────────────────────
// comboSpanMap: Map<bookingId, Map<tableId, spanRows>>
//   spanRows > 1  → this row is the "primary" of a contiguous group; render tall card
//   spanRows === 0 → this row is "secondary" (covered by a spanning card above); skip
//   undefined     → normal single-table booking; render normally
//
// unavailableStrips: { x: number, width: number }[] — grey background bands
//
// isUnallocated: if true this is the system Unallocated row — bookings can be
//   dragged OUT but not dropped INTO it (rejected in handleDragEnd).
function TableRow({ table, bookings, date, onBookingClick, activeId, onResizeStart, resizeBookingId, resizePreviewMs, comboSpanMap, isUnallocated = false, onCanvasClick, unavailableStrips = [], enableUnconfirmedFlow = false, onConfirm, nowX, overCapacityIds = new Set() }) {
  const { setNodeRef, isOver } = useDroppable({
    id:   `row-${table.id}`,
    data: { tableId: table.id, isUnallocated },
  })

  // If any booking in this row spawns a multi-row card, the canvas needs its own
  // stacking context (z-index) so it paints above the subsequent row dividers.
  const hasSpanningCard = bookings.some(b => {
    const si = comboSpanMap?.get(b.id)
    return si && (si.get(table.id) ?? 1) > 1
  })

  // For secondary combo rows (spanRows === 0), a spanning card rendered in
  // the primary row above visually covers part of this canvas. Grey strips
  // must be clipped to exclude ONLY that booking's time window — outside the
  // booking the row should show the same grey as every other row so time
  // columns remain visually consistent (no partial-column grey).
  //
  // We split each strip around covered ranges rather than dropping the whole
  // strip, so a booking that starts mid-strip (e.g. inside the pre-sitting
  // grey) doesn't wipe grey on either side of the card.
  const clippedStrips = (() => {
    const coveredRanges = bookings
      .filter(b => { const si = comboSpanMap?.get(b.id); return si && si.get(table.id) === 0 })
      .map(b => ({
        startX: timeToX(b.starts_at),
        endX:   timeToX(b.starts_at) + durationToWidth(b.starts_at, b.ends_at),
      }))
    if (!coveredRanges.length) return unavailableStrips

    const result = []
    for (const strip of unavailableStrips) {
      // Start with the full strip then subtract each covered range
      let segments = [{ x: strip.x, width: strip.width }]
      for (const c of coveredRanges) {
        const next = []
        for (const seg of segments) {
          const segEnd = seg.x + seg.width
          if (c.startX >= segEnd || c.endX <= seg.x) {
            next.push(seg)                                      // no overlap — keep
          } else {
            if (seg.x < c.startX)                              // left remainder
              next.push({ x: seg.x, width: c.startX - seg.x })
            if (segEnd > c.endX)                               // right remainder
              next.push({ x: c.endX, width: segEnd - c.endX })
            // portion inside covered range is discarded
          }
        }
        segments = next
      }
      result.push(...segments)
    }
    return result
  })()

  return (
    <div className="timeline-grid border-b last:border-b-0">
      {/* Table label — sticky left + z above spanning cards */}
      <div className={cn(
        'flex items-center justify-between px-2 border-r sticky left-0 z-[10] shrink-0',
        isUnallocated ? 'bg-orange-50' : 'bg-muted',
      )}>
        {isUnallocated ? (
          <span className="text-[10px] font-semibold text-orange-700 flex items-center gap-0.5 truncate">
            <TriangleAlert className="w-2.5 h-2.5 shrink-0" /> Unalloc.
          </span>
        ) : (
          <>
            <span className="text-xs font-semibold truncate">{table.label}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 ml-1">
              {table.max_covers}
            </span>
          </>
        )}
      </div>

      {/* Booking canvas — overflow:visible so spanning cards can extend into adjacent rows */}
      <div
        ref={setNodeRef}
        className={cn(
          'relative transition-colors',
          isUnallocated
            ? 'bg-orange-50/40 border-b border-orange-200'
            : isOver ? 'bg-blue-50' : 'cursor-cell',
        )}
        style={{
          height: ROW_HEIGHT,
          width:  TOTAL_WIDTH,
          // Elevate stacking context so spanning cards render above subsequent rows
          ...(hasSpanningCard ? { zIndex: 3 } : {}),
        }}
        onClick={isUnallocated || !onCanvasClick ? undefined : (e) => onCanvasClick(e, table)}
      >
        {/* B1: Unavailable / out-of-session strips.
            Clipped for secondary combo rows so the spanning card's own time
            window is excluded but the rest of the row stays consistent. */}
        {clippedStrips.map(({ x, width }, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 bg-zinc-100 pointer-events-none"
            style={{ left: Math.max(0, x), width, zIndex: 0 }}
          />
        ))}

        {/* Hour grid lines */}
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/40"
            style={{ left: i * HOUR_WIDTH }}
          />
        ))}

        {/* Current-time vertical line — only in today's view */}
        {nowX != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-400 pointer-events-none"
            style={{ left: nowX, zIndex: 15 }}
          />
        )}

        {/* Bookings */}
        {bookings.map(b => {
          const spanInfo = comboSpanMap?.get(b.id)
          const spanRows = spanInfo ? (spanInfo.get(table.id) ?? 1) : 1
          // Skip secondary rows — the primary row above renders a tall spanning card
          if (spanRows === 0) return null
          return (
            <BookingCard
              key={b.id}
              booking={b}
              onClick={onBookingClick}
              isDragging={b.id === activeId}
              onResizeStart={onResizeStart}
              resizePreviewMs={b.id === resizeBookingId ? resizePreviewMs : null}
              spanRows={spanRows}
              enableUnconfirmedFlow={enableUnconfirmedFlow}
              onConfirm={onConfirm}
              overCapacity={overCapacityIds.has(b.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Timeline header (hour labels + optional now marker) ────────
function TimelineHeader({ nowX, nowLabel }) {
  return (
    <div className="timeline-grid border-b sticky top-0 bg-background z-10">
      {/* Sticky label cell — z-[12] keeps it above spanning cards (z=5) and canvas stacking contexts (z=3) */}
      <div className="border-r sticky left-0 bg-background z-[12]" style={{ height: 40 }} />
      <div className="relative overflow-hidden" style={{ width: TOTAL_WIDTH, height: 40 }}>
        {Array.from({ length: TOTAL_HOURS }, (_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 flex items-center border-l border-border/40"
            style={{ left: i * HOUR_WIDTH, width: HOUR_WIDTH }}
          >
            <span className="text-xs text-muted-foreground pl-1">
              {String(START_HOUR + i).padStart(2, '0')}:00
            </span>
          </div>
        ))}

        {/* Current-time marker: label at top, line down, dot at bottom */}
        {nowX != null && (
          <div
            className="absolute inset-y-0 flex flex-col items-center pointer-events-none z-20"
            style={{ left: nowX, transform: 'translateX(-50%)' }}
          >
            <span className="text-[10px] font-bold text-red-500 leading-none bg-background px-0.5 pt-0.5 shrink-0">
              {nowLabel}
            </span>
            <div className="flex-1 w-0.5 bg-red-400" />
            <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Timeline page ─────────────────────────────────────────
export default function Timeline() {
  const api         = useApi()
  const queryClient = useQueryClient()

  // View settings shared with AppShell sidebar (panelMode now lives in context)
  const tlSettings = useTimelineSettings()
  const { hideInactive, groupBySections, panelMode, refetchTrigger } = tlSettings

  const [date,            setDate]          = useState(format(new Date(), 'yyyy-MM-dd'))
  const [activeId,        setActiveId]      = useState(null)
  const [selected,        setSelected]      = useState(null)
  const [showNew,         setShowNew]       = useState(false)
  const [resizeState,     setResizeState]   = useState(null)  // { bookingId, startX, originalEndMs, originalStartMs }
  const [resizePreviewMs, setResizePreviewMs] = useState(null) // ms timestamp for live preview
  const [relocateError,  setRelocateError]  = useState(null)   // message | null
  const [newBookingPrefill, setNewBookingPrefill] = useState(null) // { time, tableId } | null
  const [panelWidth,       setPanelWidth]       = useState(420)    // px — resizable when docked
  const [nowMs,            setNowMs]            = useState(() => Date.now())
  const isPanelResizing = useRef(false)

  const onPanelResizeStart = useCallback((e) => {
    e.preventDefault()
    isPanelResizing.current = true
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
    function onMove(ev) {
      if (!isPanelResizing.current) return
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX
      setPanelWidth(Math.min(700, Math.max(280, window.innerWidth - x)))
    }
    function onUp() {
      isPanelResizing.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend',  onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend',  onUp)
  }, [])

  // ── Current-time indicator ───────────────────────────────
  // Update every 30 seconds. Only shown when the selected date is today.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const today = format(new Date(), 'yyyy-MM-dd')
  const nowX = useMemo(() => {
    if (date !== today) return null
    const now   = new Date(nowMs)
    const hours = now.getHours() + now.getMinutes() / 60
    const x     = (hours - START_HOUR) * HOUR_WIDTH
    return x >= 0 && x <= TOTAL_WIDTH ? x : null
  }, [date, today, nowMs])

  const nowLabel = useMemo(() => {
    const d = new Date(nowMs)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }, [nowMs])

  // ── Data fetching ────────────────────────────────────────
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  // Computed venueId — AppShell venue selector writes to context; fall back to first venue
  const venueId = tlSettings.venueId ?? venues[0]?.id ?? null

  useRealtimeBookings(venueId)

  // Mouse: drag activates after 8px movement (immediate feel on desktop)
  // Touch: drag activates after 250ms hold (tap → click, hold → drag on mobile)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  const { data: tables = [] } = useQuery({
    queryKey: ['tables', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/tables`),
    enabled:  !!venueId,
  })

  const { data: bookingsRes = [], isLoading, refetch } = useQuery({
    queryKey: ['bookings', venueId, date],
    queryFn:  () => api.get(`/bookings?venue_id=${venueId}&date=${date}`),
    enabled:  !!venueId,
    refetchInterval: 60_000,
  })

  // B1a: Resolved sittings for the selected date — used for precise grey boundaries.
  // Applies Priority 1→2→3 resolution server-side; returns exact opens_at/closes_at
  // strings ('HH:MM:SS') unaffected by slot_duration_mins filtering.
  const { data: sittingsForDate } = useQuery({
    queryKey: ['sittings-for-date', venueId, date],
    queryFn:  () => api.get(`/venues/${venueId}/schedule/sittings-for-date?date=${date}`),
    enabled:  !!venueId,
  })

  // B1b: Slot overlay — used only to detect cap=0 slots (reason='unavailable').
  const { data: slotsOverlay } = useQuery({
    queryKey: ['slots-overlay', venueId, date],
    queryFn:  () => api.get(`/venues/${venueId}/slots?date=${date}&covers=1`),
    enabled:  !!venueId,
  })

  // Refresh triggered from the AppShell sidebar button
  useEffect(() => {
    if (refetchTrigger > 0) refetch()
  }, [refetchTrigger])

  // B2: Booking rules — check enable_unconfirmed_flow
  const { data: rulesData } = useQuery({
    queryKey: ['rules', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/rules`),
    enabled:  !!venueId,
  })
  const enableUnconfirmedFlow = rulesData?.enable_unconfirmed_flow ?? false

  // B1: Compute grey strips.
  //
  // Grey rules (exactly two):
  //   1. Hours outside sitting open→close times → grey
  //      Uses exact opens_at/closes_at from the resolved sittings endpoint,
  //      so slot_duration_mins has no effect on where grey starts/ends.
  //   2. Slot cap explicitly set to 0 (reason='unavailable') → grey
  //
  // Fully-booked slots (reason='full') are NOT greyed — they stay white.
  const unavailableStrips = useMemo(() => {
    const sittings = sittingsForDate?.sittings ?? null
    const slots    = slotsOverlay?.slots        ?? []

    // Not loaded yet — show nothing (avoid flash of full-grey before data arrives)
    if (sittings === null) return []

    // No sittings on this date → entire timeline grey
    if (sittings.length === 0) return [{ x: 0, width: TOTAL_WIDTH }]

    const strips = []

    // Rule 1: outside sitting hours
    const sorted = [...sittings].sort((a, b) => a.opens_at.localeCompare(b.opens_at))

    // Before first sitting
    const firstOpenX = sittingTimeToX(sorted[0].opens_at)
    if (firstOpenX > 0) strips.push({ x: 0, width: firstOpenX })

    // Gaps between sittings + after last sitting
    for (let i = 0; i < sorted.length; i++) {
      const closeX    = sittingTimeToX(sorted[i].closes_at)
      const nextOpenX = i < sorted.length - 1
        ? sittingTimeToX(sorted[i + 1].opens_at)
        : TOTAL_WIDTH   // grey from last sitting close to right edge of canvas
      if (nextOpenX > closeX) {
        strips.push({ x: closeX, width: nextOpenX - closeX })
      }
    }

    // Rule 2: cap=0 slots within sittings
    if (slots.length > 1) {
      let intervalMs = Infinity
      for (let i = 1; i < slots.length; i++) {
        const gap = new Date(slots[i].slot_time) - new Date(slots[i - 1].slot_time)
        if (gap < intervalMs) intervalMs = gap
      }
      const intervalPx = (intervalMs / 3_600_000) * HOUR_WIDTH
      for (const slot of slots) {
        if (slot.reason === 'unavailable') {
          strips.push({ x: timeToX(slot.slot_time), width: intervalPx })
        }
      }
    }

    return strips
  }, [sittingsForDate, slotsOverlay])

  // ── Resize handlers ───────────────────────────────────────
  const resizeMutation = useMutation({
    mutationFn: ({ bookingId, endsAt }) =>
      api.patch(`/bookings/${bookingId}/duration`, { ends_at: endsAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })
    },
  })

  function handleResizeStart(booking, clientX) {
    setResizeState({
      bookingId:       booking.id,
      startX:          clientX,
      originalEndMs:   new Date(booking.ends_at).getTime(),
      originalStartMs: new Date(booking.starts_at).getTime(),
    })
  }

  useEffect(() => {
    if (!resizeState) return
    function handleMove(e) {
      const deltaPx = e.clientX - resizeState.startX
      const deltaMs = (deltaPx / HOUR_WIDTH) * 60 * 60 * 1000
      const rawMs   = resizeState.originalEndMs + deltaMs
      const minEnd  = resizeState.originalStartMs + 15 * 60 * 1000
      setResizePreviewMs(
        Math.round(Math.max(rawMs, minEnd) / (15 * 60 * 1000)) * (15 * 60 * 1000)
      )
    }
    function handleUp(e) {
      const deltaPx = e.clientX - resizeState.startX
      const deltaMs = (deltaPx / HOUR_WIDTH) * 60 * 60 * 1000
      const rawMs   = resizeState.originalEndMs + deltaMs
      const minEnd  = resizeState.originalStartMs + 15 * 60 * 1000
      const snapped = Math.round(Math.max(rawMs, minEnd) / (15 * 60 * 1000)) * (15 * 60 * 1000)
      resizeMutation.mutate({
        bookingId: resizeState.bookingId,
        endsAt:    new Date(snapped).toISOString(),
      })
      setResizeState(null)
      setResizePreviewMs(null)
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup',   handleUp)
    return () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup',   handleUp)
    }
  }, [resizeState])

  // ── Drag handlers ─────────────────────────────────────────
  // PATCH /move  — same-table time-only shift (lightweight, no conflict cascade)
  const moveMutation = useMutation({
    mutationFn: ({ bookingId, tableId, startsAt }) =>
      api.patch(`/bookings/${bookingId}/move`, { table_id: tableId, starts_at: startsAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })
    },
  })

  // PATCH /relocate — cross-table drop (finds best allocation, cascades conflicts)
  const relocateMutation = useMutation({
    mutationFn: ({ bookingId, targetTableId, startsAt }) =>
      api.patch(`/bookings/${bookingId}/relocate`, {
        target_table_id: targetTableId,
        ...(startsAt ? { starts_at: startsAt } : {}),
      }),
    onSuccess: () => {
      // Refresh bookings AND tables (Unallocated table may have been auto-created)
      queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })
      queryClient.invalidateQueries({ queryKey: ['tables', venueId] })
      setRelocateError(null)
    },
    onError: (err) => {
      // Surface the API error message so the operator knows what to fix
      const msg = err?.response?.data?.message ?? err?.message ?? 'Could not relocate booking'
      setRelocateError(msg)
      // Also refresh to make sure the UI is in sync with server state
      queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })
    },
  })

  // B2: Quick-confirm unconfirmed booking
  const confirmStatusMutation = useMutation({
    mutationFn: (bookingId) =>
      api.patch(`/bookings/${bookingId}/status`, { status: 'confirmed' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })
    },
  })

  function handleDragStart({ active }) {
    setActiveId(active.id)
  }

  function handleDragEnd({ active, over, delta }) {
    setActiveId(null)
    if (!over) return

    const booking = active.data.current.booking

    // Never allow dropping onto the Unallocated row (pick-up only)
    if (over.data.current?.isUnallocated) return

    const targetTableId = over.data.current?.tableId ?? booking.table_id

    // Determine all table IDs currently occupied by this booking
    // (combo bookings have multiple member tables — any of them is "same table")
    const currentTableIds = Array.isArray(booking.member_table_ids) && booking.member_table_ids.length > 0
      ? booking.member_table_ids
      : [booking.table_id]

    const tableChanged = !currentTableIds.includes(targetTableId)

    // Calculate new start time from horizontal delta (snapped to 15 min)
    const deltaMins = Math.round((delta.x / HOUR_WIDTH) * 60 / 15) * 15
    const newStart  = new Date(parseISO(booking.starts_at).getTime() + deltaMins * 60_000)

    if (tableChanged) {
      // Cross-table drop → smart relocate with conflict cascade
      relocateMutation.mutate({
        bookingId:     booking.id,
        targetTableId,
        startsAt: deltaMins !== 0 ? newStart.toISOString() : undefined,
      })
    } else {
      // Same-table drop → simple time shift
      if (deltaMins === 0) return
      moveMutation.mutate({
        bookingId: booking.id,
        tableId:   booking.table_id,   // always canonical table_id, not a secondary member
        startsAt:  newStart.toISOString(),
      })
    }
  }

  // ── Click on empty canvas slot → open new booking at that time ─
  function handleCanvasClick(e, table) {
    const rect     = e.currentTarget.getBoundingClientRect()
    const x        = e.clientX - rect.left
    // Convert pixel offset → minutes since START_HOUR, snapped to 15 min
    const rawMins  = (x / HOUR_WIDTH) * 60 + START_HOUR * 60
    // Clamp to valid timeline range so clicks at the edge never produce 24:xx or 28:xx
    const snapped  = Math.min(
      (END_HOUR * 60) - 15,          // latest valid slot: 23:45
      Math.max(START_HOUR * 60, Math.round(rawMins / 15) * 15)
    )
    const h        = Math.floor(snapped / 60)
    const m        = snapped % 60
    const timeStr  = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    setNewBookingPrefill({ time: timeStr, tableId: table.id })
    setShowNew(true)
  }

  // ── Group bookings by table ────────────────────────────────
  // Combination bookings appear on ALL member table rows (not just the primary)
  const bookingsByTable = useMemo(() => {
    const INACTIVE = new Set(['cancelled', 'no_show', 'checked_out'])
    const source = hideInactive ? bookingsRes.filter(b => !INACTIVE.has(b.status)) : bookingsRes
    const map = {}
    for (const b of source) {
      const tableIds = Array.isArray(b.member_table_ids) && b.member_table_ids.length > 0
        ? b.member_table_ids
        : [b.table_id]
      for (const tid of tableIds) {
        if (!map[tid]) map[tid] = []
        map[tid].push(b)
      }
    }
    return map
  }, [bookingsRes, hideInactive])

  // ── Group tables by section ────────────────────────────────
  // NOTE: must be computed BEFORE comboSpanMap (which depends on sections)
  // Unallocated table is excluded from sections — rendered separately at top.
  const sections = useMemo(() => {
    const map = {}
    for (const t of tables) {
      if (t.is_unallocated) continue
      const key = t.section_name ?? 'No section'
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    return Object.entries(map)
  }, [tables])

  // The single "Unallocated" system table for this venue (may not exist yet)
  const unallocatedTable = useMemo(
    () => tables.find(t => t.is_unallocated) ?? null,
    [tables],
  )

  // ── Combination span map ───────────────────────────────────
  // For each combination booking, determines which table row renders the card
  // and how tall it should be (spanRows), based on row adjacency in the timeline.
  //
  // Result: Map<bookingId, Map<tableId, spanRows>>
  //   spanRows  > 1  → primary row; render a card spanning this many rows
  //   spanRows === 0 → secondary row covered by the card above; render nothing
  //   not in map     → normal single-table booking
  const comboSpanMap = useMemo(() => {
    // Build the full ordered list of table IDs as they appear top-to-bottom
    const orderedIds = sections.flatMap(([, ts]) => ts.map(t => t.id))
    const rowIndex   = new Map(orderedIds.map((id, i) => [id, i]))
    const result     = new Map()

    for (const b of bookingsRes) {
      if (!Array.isArray(b.member_table_ids) || b.member_table_ids.length < 2) continue

      // Sort member tables by their position in the rendered timeline
      const sorted = b.member_table_ids
        .filter(id => rowIndex.has(id))
        .map(id => ({ id, i: rowIndex.get(id) }))
        .sort((a, c) => a.i - c.i)

      if (sorted.length < 2) continue

      // Split into contiguous groups (gap in row index = new group = separate tile)
      const groups = []
      let group = [sorted[0]]
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k].i === sorted[k - 1].i + 1) {
          group.push(sorted[k])
        } else {
          groups.push(group)
          group = [sorted[k]]
        }
      }
      groups.push(group)

      // First table of each group → spanRows = group size; rest → 0 (hidden)
      const spanInfo = new Map()
      for (const g of groups) {
        spanInfo.set(g[0].id, g.length)
        for (let k = 1; k < g.length; k++) spanInfo.set(g[k].id, 0)
      }
      result.set(b.id, spanInfo)
    }
    return result
  }, [bookingsRes, sections])

  // Set of booking IDs where covers exceeds the table/combination capacity
  const overCapacityIds = useMemo(() => {
    const ids = new Set()
    for (const b of bookingsRes) {
      const max = b.combination_max_covers ?? b.table_max_covers ?? null
      if (max !== null && b.covers > max) ids.add(b.id)
    }
    return ids
  }, [bookingsRes])

  const activeBooking = useMemo(() =>
    bookingsRes.find(b => b.id === activeId), [bookingsRes, activeId])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar — date navigation only; view controls are in AppShell sidebar */}
      <div className="flex items-center px-4 h-14 border-b shrink-0 gap-2">
        <button onClick={() => setDate(format(subDays(new Date(date), 1), 'yyyy-MM-dd'))}
          className="p-1.5 rounded hover:bg-accent touch-manipulation"><ChevronLeft className="w-4 h-4" /></button>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="text-sm border rounded px-2 py-1"
        />
        <button onClick={() => setDate(format(addDays(new Date(date), 1), 'yyyy-MM-dd'))}
          className="p-1.5 rounded hover:bg-accent touch-manipulation"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => setDate(format(new Date(), 'yyyy-MM-dd'))}
          className="text-xs px-2 py-1 rounded border hover:bg-accent touch-manipulation">Today</button>
      </div>

      {/* Body row — timeline + optional docked panel */}
      <div className="flex-1 flex min-h-0">

      {/* Left column: error banner + scrollable timeline */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">

      {/* Relocate error banner */}
      {relocateError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive shrink-0">
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <span className="flex-1">{relocateError}</span>
          <button
            onClick={() => setRelocateError(null)}
            className="text-xs underline opacity-70 hover:opacity-100 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading…
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            modifiers={[restrictToWindowEdges]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div style={{ minWidth: 160 + TOTAL_WIDTH }}>
              <TimelineHeader nowX={nowX} nowLabel={nowLabel} />

              {/* ── Unallocated row ─────────────────────────────────────
                  Shown only when the system has pushed bookings here because no
                  real table was available during a smart-relocate cascade.
                  Bookings can be DRAGGED OUT; dropping INTO this row is blocked. */}
              {unallocatedTable && (bookingsByTable[unallocatedTable.id]?.length ?? 0) > 0 && (
                <div>
                  <div className="px-3 py-1 bg-orange-50 border-b border-orange-200 sticky top-[40px] z-[9]">
                    <span className="text-[10px] font-semibold text-orange-700 uppercase tracking-wider flex items-center gap-1">
                      <TriangleAlert className="w-2.5 h-2.5" />
                      Unallocated — drag to reassign
                    </span>
                  </div>
                  <TableRow
                    table={unallocatedTable}
                    bookings={bookingsByTable[unallocatedTable.id] ?? []}
                    date={date}
                    onBookingClick={setSelected}
                    activeId={activeId}
                    onResizeStart={handleResizeStart}
                    resizeBookingId={resizeState?.bookingId}
                    resizePreviewMs={resizePreviewMs}
                    comboSpanMap={comboSpanMap}
                    isUnallocated={true}
                    enableUnconfirmedFlow={enableUnconfirmedFlow}
                    onConfirm={confirmStatusMutation.mutate}
                    nowX={nowX}
                    overCapacityIds={overCapacityIds}
                  />
                </div>
              )}

              {groupBySections ? (
                /* ── Grouped: section header + rows ─────────────── */
                sections.map(([sectionName, sectionTables]) => (
                  <div key={sectionName}>
                    <div className="px-3 py-1 bg-muted/50 border-b sticky top-[40px] z-[9]">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {sectionName}
                      </span>
                    </div>
                    {sectionTables.map(table => (
                      <TableRow
                        key={table.id}
                        table={table}
                        bookings={bookingsByTable[table.id] ?? []}
                        date={date}
                        onBookingClick={setSelected}
                        activeId={activeId}
                        onResizeStart={handleResizeStart}
                        resizeBookingId={resizeState?.bookingId}
                        resizePreviewMs={resizePreviewMs}
                        comboSpanMap={comboSpanMap}
                        onCanvasClick={handleCanvasClick}
                        unavailableStrips={unavailableStrips}
                        enableUnconfirmedFlow={enableUnconfirmedFlow}
                        onConfirm={confirmStatusMutation.mutate}
                        nowX={nowX}
                        overCapacityIds={overCapacityIds}
                      />
                    ))}
                  </div>
                ))
              ) : (
                /* ── Flat: all tables in sort order, no dividers ─── */
                sections.flatMap(([, ts]) => ts).map(table => (
                  <TableRow
                    key={table.id}
                    table={table}
                    bookings={bookingsByTable[table.id] ?? []}
                    date={date}
                    onBookingClick={setSelected}
                    activeId={activeId}
                    onResizeStart={handleResizeStart}
                    resizeBookingId={resizeState?.bookingId}
                    resizePreviewMs={resizePreviewMs}
                    comboSpanMap={comboSpanMap}
                    onCanvasClick={handleCanvasClick}
                    unavailableStrips={unavailableStrips}
                    enableUnconfirmedFlow={enableUnconfirmedFlow}
                    onConfirm={confirmStatusMutation.mutate}
                    nowX={nowX}
                    overCapacityIds={overCapacityIds}
                  />
                ))
              )}
            </div>

            {/* Drag overlay — ghost card while dragging (explicit z-index beats sticky headers) */}
            <DragOverlay style={{ zIndex: 999 }}>
              {activeBooking && (
                <div className={cn('timeline-slot w-28 shadow-xl', activeBooking.status)}
                  style={{ height: ROW_HEIGHT - 4 }}>
                  <div className="flex items-center h-full pl-1.5 pr-4 gap-1">
                    <span className="text-[10px] font-bold opacity-70 shrink-0">{activeBooking.covers}</span>
                    <span className="text-[11px] font-semibold truncate">{activeBooking.guest_name}</span>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      {/* end timeline scroll */}
      </div>

      {/* FAB — New booking, anchored to the timeline content column */}
      <button
        onClick={() => setShowNew(true)}
        disabled={!venueId}
        className="absolute bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center disabled:opacity-50 touch-manipulation hover:bg-primary/90 transition-colors"
        title="New booking"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* end left column */}

      {/* ── Right panel (docked) ─────────────────────────────
           Always present when panelMode=true so h-full works correctly.
           Shows a placeholder when no booking is selected, drawer when one is. */}
      {panelMode && (
        <>
        {/* Resize handle */}
        <div
          onMouseDown={onPanelResizeStart}
          onTouchStart={onPanelResizeStart}
          className="relative w-3 shrink-0 cursor-col-resize group touch-manipulation select-none"
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-primary/30 transition-colors" />
          <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2 flex flex-col gap-[3px]">
            {[0,1,2,3,4].map(i => (
              <div key={i} className="w-1 h-1 rounded-full bg-muted-foreground/40 group-hover:bg-primary/60 transition-colors" />
            ))}
          </div>
        </div>
        <div className="shrink-0 flex flex-col overflow-hidden border-l" style={{ width: panelWidth }}>
          {selected ? (() => {
            const liveBooking = bookingsRes.find(b => b.id === selected.id) ?? selected
            return (
              <BookingDrawer
                key={liveBooking.id}
                booking={liveBooking}
                onClose={() => setSelected(null)}
                onUpdated={() => queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })}
                inlineMode={true}
              />
            )
          })() : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <p className="text-sm">Select a booking to view details</p>
            </div>
          )}
        </div>
        </>
      )}

      </div>
      {/* end body row */}

      {/* Overlay drawer — floating, only when panelMode is off */}
      {!panelMode && selected && (() => {
        const liveBooking = bookingsRes.find(b => b.id === selected.id) ?? selected
        return (
          <BookingDrawer
            key={liveBooking.id}
            booking={liveBooking}
            onClose={() => setSelected(null)}
            onUpdated={() => queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })}
          />
        )
      })()}

      {/* New booking modal */}
      {showNew && (
        <NewBookingModal
          venueId={venueId}
          date={date}
          prefillTime={newBookingPrefill?.time ?? null}
          prefillTableId={newBookingPrefill?.tableId ?? null}
          openManual={!!newBookingPrefill}
          onClose={() => { setShowNew(false); setNewBookingPrefill(null) }}
          onCreated={(createdDate) => {
            setShowNew(false)
            setNewBookingPrefill(null)
            // Navigate the timeline to whatever date the booking was made on
            // (may differ from current date if the operator changed it in the modal)
            setDate(createdDate)
            queryClient.invalidateQueries({ queryKey: ['bookings', venueId, createdDate] })
          }}
        />
      )}
    </div>
  )
}
