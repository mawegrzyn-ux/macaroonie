// src/pages/Timeline.jsx
// Gantt-style timeline:
//  - Rows = tables (grouped by section)
//  - Columns = time slots across the selected day
//  - Bookings rendered as draggable cards positioned by time
//  - Drag to new slot or new table → PATCH booking (admin override)
//  - Click booking → detail drawer
//  - Live WS updates via useRealtimeBookings

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO, startOfDay } from 'date-fns'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable } from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Maximize2, Minimize2, AlertTriangle } from 'lucide-react'
import { useApi } from '@/lib/api'
import { useRealtimeBookings } from '@/hooks/useRealtimeBookings'
import { cn, formatTime, STATUS_COLOURS, STATUS_LABELS } from '@/lib/utils'
import BookingDrawer from '@/components/bookings/BookingDrawer'
import NewBookingModal from '@/components/bookings/NewBookingModal'

// ── Constants ────────────────────────────────────────────────
const HOUR_WIDTH   = 80     // px per hour
const ROW_HEIGHT   = 52     // px per table row
const START_HOUR   = 9      // timeline starts at 09:00
const END_HOUR     = 24     // timeline ends at 24:00
const TOTAL_HOURS  = END_HOUR - START_HOUR
const TOTAL_WIDTH  = TOTAL_HOURS * HOUR_WIDTH

function timeToX(iso) {
  const d    = parseISO(iso)
  const hours = d.getHours() + d.getMinutes() / 60
  return (hours - START_HOUR) * HOUR_WIDTH
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
function BookingCard({ booking, onClick, isDragging, resizePreviewMs, onResizeStart, spanRows = 1 }) {
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
    // Z-order: dragging > spanning > normal. Must be above row borders (z=0) but below sticky labels (z=10).
    zIndex: isDragging ? 20 : spanRows > 1 ? 5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick(booking) }}
      className={cn(
        'timeline-slot px-2 overflow-hidden',
        booking.status,
        isDragging && 'dragging'
      )}
    >
      <p className="text-xs font-semibold truncate leading-tight mt-0.5">
        {booking.guest_name}
        {booking.combination_name && (
          <span className="font-normal text-[10px] opacity-60 ml-1">({booking.combination_name})</span>
        )}
      </p>
      <p className="text-xs text-gray-600 truncate">
        {booking.covers} covers · {formatTime(booking.starts_at)}
      </p>
      {/* Resize handle — right edge */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/40 rounded-r"
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
// isUnallocated: if true this is the system Unallocated row — bookings can be
//   dragged OUT but not dropped INTO it (rejected in handleDragEnd).
function TableRow({ table, bookings, date, onBookingClick, activeId, onResizeStart, resizeBookingId, resizePreviewMs, comboSpanMap, isUnallocated = false, onCanvasClick }) {
  const { setNodeRef, isOver } = useDroppable({
    id:   `row-${table.id}`,
    data: { tableId: table.id, isUnallocated },
  })

  const gridLines = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i)

  // If any booking in this row spawns a multi-row card, the canvas needs its own
  // stacking context (z-index) so it paints above the subsequent row dividers.
  const hasSpanningCard = bookings.some(b => {
    const si = comboSpanMap?.get(b.id)
    return si && (si.get(table.id) ?? 1) > 1
  })

  return (
    <div className="timeline-grid border-b last:border-b-0">
      {/* Table label — sticky left + z above spanning cards */}
      <div className={cn(
        'flex items-center px-3 border-r sticky left-0 z-[10] shrink-0',
        isUnallocated ? 'bg-orange-50' : 'bg-muted',
      )}>
        <div>
          {isUnallocated ? (
            <>
              <p className="text-sm font-medium text-orange-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Unallocated
              </p>
              <p className="text-xs text-orange-500">Drag to reassign</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">{table.label}</p>
              <p className="text-xs text-muted-foreground">{table.min_covers}–{table.max_covers} covers</p>
            </>
          )}
        </div>
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
        {/* Hour grid lines */}
        {gridLines.map(i => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/40"
            style={{ left: i * HOUR_WIDTH }}
          />
        ))}

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
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Timeline header (hour labels) ─────────────────────────────
function TimelineHeader() {
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
      </div>
    </div>
  )
}

// ── Main Timeline page ─────────────────────────────────────────
export default function Timeline() {
  const api         = useApi()
  const queryClient = useQueryClient()
  const [date,            setDate]          = useState(format(new Date(), 'yyyy-MM-dd'))
  const [selectedVenueId, setVenueId]       = useState(null)
  const [activeId,        setActiveId]      = useState(null)
  const [selected,        setSelected]      = useState(null)
  const [showNew,         setShowNew]       = useState(false)
  const [resizeState,     setResizeState]   = useState(null)  // { bookingId, startX, originalEndMs, originalStartMs }
  const [resizePreviewMs, setResizePreviewMs] = useState(null) // ms timestamp for live preview
  const [isFullscreen,   setIsFullscreen]   = useState(false)
  const [relocateError,  setRelocateError]  = useState(null)   // message | null
  const [newBookingPrefill, setNewBookingPrefill] = useState(null) // { time, tableId } | null

  // ── Data fetching ────────────────────────────────────────
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  // Computed venueId — avoids null during first render
  const venueId = selectedVenueId ?? venues[0]?.id ?? null

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

  // ── Fullscreen ────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }

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
    const map = {}
    for (const b of bookingsRes) {
      const tableIds = Array.isArray(b.member_table_ids) && b.member_table_ids.length > 0
        ? b.member_table_ids
        : [b.table_id]
      for (const tid of tableIds) {
        if (!map[tid]) map[tid] = []
        map[tid].push(b)
      }
    }
    return map
  }, [bookingsRes])

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

  const activeBooking = useMemo(() =>
    bookingsRes.find(b => b.id === activeId), [bookingsRes, activeId])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-14 border-b shrink-0 gap-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(format(subDays(new Date(date), 1), 'yyyy-MM-dd'))}
            className="p-1.5 rounded hover:bg-accent"><ChevronLeft className="w-4 h-4" /></button>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="text-sm border rounded px-2 py-1"
          />
          <button onClick={() => setDate(format(addDays(new Date(date), 1), 'yyyy-MM-dd'))}
            className="p-1.5 rounded hover:bg-accent"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => setDate(format(new Date(), 'yyyy-MM-dd'))}
            className="text-xs px-2 py-1 rounded border hover:bg-accent">Today</button>
        </div>

        <div className="flex items-center gap-2">
          {/* Venue selector */}
          <select
            value={venueId ?? ''}
            onChange={e => setVenueId(e.target.value)}
            className="text-sm border rounded px-2 py-1"
          >
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

          <button onClick={() => refetch()}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground">
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground"
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen
              ? <Minimize2 className="w-4 h-4" />
              : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setShowNew(true)}
            disabled={!venueId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> New booking
          </button>
        </div>
      </div>

      {/* Relocate error banner */}
      {relocateError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive shrink-0">
          <AlertTriangle className="w-4 h-4 shrink-0" />
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
              <TimelineHeader />

              {/* ── Unallocated row ─────────────────────────────────────
                  Shown only when the system has pushed bookings here because no
                  real table was available during a smart-relocate cascade.
                  Bookings can be DRAGGED OUT; dropping INTO this row is blocked. */}
              {unallocatedTable && (bookingsByTable[unallocatedTable.id]?.length ?? 0) > 0 && (
                <div>
                  <div className="px-3 py-1.5 bg-orange-50 border-b border-orange-200 sticky top-[40px] z-[9]">
                    <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" />
                      Unallocated — drag bookings to a table row to reassign
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
                  />
                </div>
              )}

              {sections.map(([sectionName, sectionTables]) => (
                <div key={sectionName}>
                  {/* Section header */}
                  <div className="px-3 py-1.5 bg-muted/50 border-b">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
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
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Drag overlay — ghost card while dragging (explicit z-index beats sticky headers) */}
            <DragOverlay style={{ zIndex: 999 }}>
              {activeBooking && (
                <div className={cn('timeline-slot px-2 w-28 shadow-xl', activeBooking.status)}>
                  <p className="text-xs font-semibold truncate">{activeBooking.guest_name}</p>
                  <p className="text-xs text-gray-600">{activeBooking.covers} covers</p>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Booking detail drawer */}
      {selected && (
        <BookingDrawer
          booking={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })}
        />
      )}

      {/* New booking modal */}
      {showNew && (
        <NewBookingModal
          venueId={venueId}
          date={date}
          prefillTime={newBookingPrefill?.time ?? null}
          prefillTableId={newBookingPrefill?.tableId ?? null}
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
