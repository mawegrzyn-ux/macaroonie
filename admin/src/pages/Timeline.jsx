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
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Maximize2, Minimize2 } from 'lucide-react'
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
function BookingCard({ booking, onClick, isDragging, resizePreviewMs, onResizeStart }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id:   booking.id,
    data: { booking },
  })

  const x = timeToX(booking.starts_at)
  const endsAtMs = resizePreviewMs ?? new Date(booking.ends_at).getTime()
  const endsAtIso = resizePreviewMs ? new Date(resizePreviewMs).toISOString() : booking.ends_at
  const w = durationToWidth(booking.starts_at, endsAtIso)

  const style = {
    left:      x,
    width:     Math.max(w - 4, 40),
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
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
function TableRow({ table, bookings, date, onBookingClick, activeId, onResizeStart, resizeBookingId, resizePreviewMs }) {
  const { setNodeRef, isOver } = useDroppable({
    id:   `row-${table.id}`,
    data: { tableId: table.id },
  })

  // Hour grid lines
  const gridLines = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i)

  return (
    <div className="timeline-grid border-b last:border-b-0">
      {/* Table label — sticky so it stays visible while scrolling horizontally */}
      <div className="flex items-center px-3 border-r bg-muted sticky left-0 z-[2] shrink-0">
        <div>
          <p className="text-sm font-medium">{table.label}</p>
          <p className="text-xs text-muted-foreground">{table.min_covers}–{table.max_covers} covers</p>
        </div>
      </div>

      {/* Booking canvas */}
      <div
        ref={setNodeRef}
        className={cn(
          'relative overflow-hidden transition-colors',
          isOver && 'bg-blue-50'
        )}
        style={{ height: ROW_HEIGHT, width: TOTAL_WIDTH }}
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
        {bookings.map(b => (
          <BookingCard
            key={b.id}
            booking={b}
            onClick={onBookingClick}
            isDragging={b.id === activeId}
            onResizeStart={onResizeStart}
            resizePreviewMs={b.id === resizeBookingId ? resizePreviewMs : null}
          />
        ))}
      </div>
    </div>
  )
}

// ── Timeline header (hour labels) ─────────────────────────────
function TimelineHeader() {
  return (
    <div className="timeline-grid border-b sticky top-0 bg-background z-10">
      {/* Sticky label cell — stays pinned to left while scrolling horizontally */}
      <div className="border-r sticky left-0 bg-background z-[3]" style={{ height: 40 }} />
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
  const moveMutation = useMutation({
    mutationFn: ({ bookingId, tableId, startsAt }) =>
      api.patch(`/bookings/${bookingId}/move`, { table_id: tableId, starts_at: startsAt }),
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

    const booking  = active.data.current.booking
    const targetTableId = over.data.current?.tableId ?? booking.table_id

    // Calculate new start time from horizontal delta
    const deltaMins   = Math.round((delta.x / HOUR_WIDTH) * 60 / 15) * 15
    const originalStart = parseISO(booking.starts_at)
    const newStart    = new Date(originalStart.getTime() + deltaMins * 60_000)

    // Only update if something actually changed
    if (targetTableId === booking.table_id && deltaMins === 0) return

    moveMutation.mutate({
      bookingId: booking.id,
      tableId:   targetTableId,
      startsAt:  newStart.toISOString(),
    })
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
  const sections = useMemo(() => {
    const map = {}
    for (const t of tables) {
      const key = t.section_name ?? 'No section'
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    return Object.entries(map)
  }, [tables])

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
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Drag overlay — ghost card while dragging */}
            <DragOverlay>
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
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false)
            queryClient.invalidateQueries({ queryKey: ['bookings', venueId, date] })
          }}
        />
      )}
    </div>
  )
}
