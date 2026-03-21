// src/pages/Bookings.jsx
// Guestplan-style daily booking list.
// Layout: date nav + stats bar + filter bar + time-grouped rows | BookingDrawer panel
//
// List row: covers · name · phone · Ends badge · table · section · status pill (clickable)
// Clicking status pill opens an inline dropdown to change it.
// Clicking a row opens BookingDrawer in panel mode on the right.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Download, Search, ChevronDown, Eye, EyeOff, TriangleAlert } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'
import BookingDrawer from '@/components/bookings/BookingDrawer'

// All statuses the operator can manually set (pending_payment is Stripe-only)
const SELECTABLE_STATUSES = ['unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated', 'checked_out', 'no_show', 'cancelled']

const STATUS_DOT = {
  unconfirmed:     'bg-amber-500',
  confirmed:       'bg-blue-500',
  reconfirmed:     'bg-indigo-500',
  pending_payment: 'bg-yellow-500',
  arrived:         'bg-cyan-500',
  seated:          'bg-green-500',
  checked_out:     'bg-green-300',
  cancelled:       'bg-red-500',
  no_show:         'bg-gray-400',
}

export default function Bookings() {
  const api = useApi()
  const qc  = useQueryClient()

  const [date,             setDate]         = useState(format(new Date(), 'yyyy-MM-dd'))
  const [selectedVenueId,  setVenueId]      = useState(null)
  const [selected,         setSelected]     = useState(null)
  const [search,           setSearch]       = useState('')
  const [statusFilter,     setStatusFilter] = useState('')
  const [statusDropdownId, setStatusDropdownId] = useState(null) // booking.id with open dropdown
  const [panelWidth,       setPanelWidth]       = useState(420)  // px — draggable
  const [hideInactive,     setHideInactive]     = useState(true) // hide cancelled/no_show/checked_out by default
  const isResizing = useRef(false)

  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev) {
      if (!isResizing.current) return
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX
      const newWidth = window.innerWidth - clientX
      setPanelWidth(Math.min(700, Math.max(280, newWidth)))
    }
    function onUp() {
      isResizing.current = false
      document.body.style.cursor = ''
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

  // ── Data ────────────────────────────────────────────────────
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  const venueId = selectedVenueId ?? venues[0]?.id ?? null

  // Venue rules (for filtering selectable statuses in dropdown)
  const { data: rules } = useQuery({
    queryKey: ['rules', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/rules`),
    enabled:  !!venueId,
  })

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['bookings', venueId, date],
    queryFn:  () => api.get(`/bookings?venue_id=${venueId}&date=${date}`),
    enabled:  !!venueId,
  })

  // ── Inline status mutation ───────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/bookings/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings', venueId, date] }),
  })

  // ── Filter / sort ────────────────────────────────────────────
  const INACTIVE_STATUSES = new Set(['cancelled', 'no_show', 'checked_out'])

  const filtered = useMemo(() => {
    let list = [...bookings].sort((a, b) =>
      new Date(a.starts_at) - new Date(b.starts_at)
    )
    if (hideInactive && !statusFilter) list = list.filter(b => !INACTIVE_STATUSES.has(b.status))
    if (statusFilter) list = list.filter(b => b.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(b =>
        (b.guest_name  ?? '').toLowerCase().includes(q) ||
        (b.guest_email ?? '').toLowerCase().includes(q) ||
        (b.guest_phone ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [bookings, statusFilter, search, hideInactive])

  // ── Stats ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = bookings.filter(b => !['cancelled', 'no_show'].includes(b.status))
    const tableSet = new Set(active.map(b => b.table_id).filter(Boolean))
    const guests   = active.reduce((s, b) => s + (b.covers ?? 0), 0)
    return { reservations: active.length, tables: tableSet.size, guests }
  }, [bookings])

  // ── Group filtered bookings by start time ────────────────────
  const grouped = useMemo(() => {
    const map = new Map()
    for (const b of filtered) {
      const key = formatTime(b.starts_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(b)
    }
    return [...map.entries()]
  }, [filtered])

  // ── Selectable statuses for the inline dropdown ──────────────
  function selectableFor(booking) {
    return SELECTABLE_STATUSES.filter(s => {
      if (s === booking.status) return false
      if (s === 'unconfirmed') return (rules?.enable_unconfirmed_flow ?? false) || booking.status === 'unconfirmed'
      if (s === 'reconfirmed') return (rules?.enable_reconfirmed_status ?? false) || booking.status === 'reconfirmed'
      return true
    })
  }

  // ── CSV export ───────────────────────────────────────────────
  function exportCSV() {
    const headers = ['Guest', 'Phone', 'Email', 'Covers', 'Date', 'Start', 'End', 'Table', 'Section', 'Status']
    const rows = filtered.map(b => [
      b.guest_name, b.guest_phone ?? '', b.guest_email ?? '',
      b.covers, date, formatTime(b.starts_at), b.ends_at ? formatTime(b.ends_at) : '',
      b.table_label, b.section_name ?? '', b.status,
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `bookings-${date}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Date navigation ──────────────────────────────────────────
  const isToday = date === format(new Date(), 'yyyy-MM-dd')
  function goDay(delta) {
    setDate(format(delta > 0 ? addDays(parseISO(date), 1) : subDays(parseISO(date), 1), 'yyyy-MM-dd'))
    setSelected(null)
  }

  // Close status dropdown on outside click
  const listRef = useRef(null)
  useEffect(() => {
    if (!statusDropdownId) return
    function handle(e) {
      if (listRef.current && !listRef.current.contains(e.target)) setStatusDropdownId(null)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [statusDropdownId])

  // Keep selected booking fresh after status update
  useEffect(() => {
    if (!selected) return
    const fresh = bookings.find(b => b.id === selected.id)
    if (fresh) setSelected(fresh)
  }, [bookings])

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Top bar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 h-14 border-b shrink-0">
        {/* Venue selector */}
        {venues.length > 1 && (
          <select
            value={venueId ?? ''}
            onChange={e => { setVenueId(e.target.value); setSelected(null) }}
            className="text-sm border rounded-lg px-2 py-1.5 bg-background"
          >
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}

        {/* Date navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => goDay(-1)}
            className="p-1.5 rounded hover:bg-accent touch-manipulation"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="relative">
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-accent touch-manipulation min-w-[140px] text-center">
              {isToday ? 'Today' : format(parseISO(date), 'EEE d MMM yyyy')}
            </button>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setSelected(null) }}
              className="absolute inset-0 opacity-0 cursor-pointer w-full"
            />
          </div>
          <button
            onClick={() => goDay(1)}
            className="p-1.5 rounded hover:bg-accent touch-manipulation"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isToday && (
            <button
              onClick={() => { setDate(format(new Date(), 'yyyy-MM-dd')); setSelected(null) }}
              className="text-xs px-2.5 py-1.5 rounded-lg border hover:bg-accent touch-manipulation ml-1"
            >
              Today
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground ml-2">
          <span><span className="font-semibold text-foreground">{stats.reservations}</span> reservations</span>
          <span><span className="font-semibold text-foreground">{stats.tables}</span> tables</span>
          <span><span className="font-semibold text-foreground">{stats.guests}</span> guests</span>
        </div>

        {/* Spacer + Export */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg hover:bg-accent touch-manipulation"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b bg-muted/20 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Name, email or phone…"
            className="pl-8 pr-3 py-1.5 text-sm border rounded-lg w-52 bg-background focus:outline-none focus:border-primary"
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border rounded-lg px-2 py-1.5 bg-background"
        >
          <option value="">All statuses</option>
          {SELECTABLE_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>

        {(search || statusFilter) && (
          <button
            onClick={() => { setSearch(''); setStatusFilter('') }}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Clear
          </button>
        )}

        {/* Hide inactive toggle */}
        <button
          onClick={() => setHideInactive(v => !v)}
          title={hideInactive ? 'Show cancelled, no-show & checked-out' : 'Hide cancelled, no-show & checked-out'}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border touch-manipulation transition-colors',
            hideInactive
              ? 'text-muted-foreground border-border hover:bg-accent'
              : 'bg-primary/10 text-primary border-primary/30',
          )}
        >
          {hideInactive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">Inactive</span>
        </button>

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} booking{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Main content ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Booking list */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Loading…
            </div>
          ) : grouped.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No bookings for this date
            </div>
          ) : (
            grouped.map(([time, rows]) => (
              <div key={time}>
                {/* Time header */}
                <div className="px-5 py-2 bg-muted/30 border-b border-t sticky top-0 z-10">
                  <span className="text-sm font-semibold">{time}</span>
                </div>

                {/* Booking rows */}
                {rows.map(b => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    isSelected={selected?.id === b.id}
                    statusDropdownOpen={statusDropdownId === b.id}
                    selectableStatuses={selectableFor(b)}
                    onRowClick={() => setSelected(b)}
                    onStatusClick={(e) => {
                      e.stopPropagation()
                      setStatusDropdownId(v => v === b.id ? null : b.id)
                    }}
                    onStatusSelect={(newStatus) => {
                      statusMutation.mutate({ id: b.id, status: newStatus })
                      setStatusDropdownId(null)
                    }}
                    onDropdownClose={() => setStatusDropdownId(null)}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onResizeStart}
          onTouchStart={onResizeStart}
          className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors touch-manipulation"
        />

        {/* Permanent right panel */}
        <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: panelWidth }}>
          {selected ? (
            <BookingDrawer
              booking={selected}
              inlineMode
              onClose={() => setSelected(null)}
              onUpdated={() => qc.invalidateQueries({ queryKey: ['bookings', venueId, date] })}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <p className="text-sm">Select a booking to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Booking row ───────────────────────────────────────────────
function BookingRow({ booking: b, isSelected, statusDropdownOpen, selectableStatuses, onRowClick, onStatusClick, onStatusSelect, onDropdownClose }) {
  const endTime = b.ends_at ? formatTime(b.ends_at) : null
  const maxCovers = b.combination_max_covers ?? b.table_max_covers ?? null
  const overCapacity = maxCovers !== null && b.covers > maxCovers

  return (
    <div
      onClick={onRowClick}
      className={cn(
        'flex items-center gap-4 px-5 py-3 border-b cursor-pointer transition-colors hover:bg-accent/40 touch-manipulation',
        isSelected && 'bg-primary/5 border-l-2 border-l-primary',
      )}
    >
      {/* Covers — orange if over capacity */}
      <div className="w-12 shrink-0 text-center relative">
        <span className={cn('text-base font-semibold', overCapacity && 'text-orange-600')}>{b.covers}</span>
        <span className="text-xs text-muted-foreground"> p.</span>
        {overCapacity && (
          <TriangleAlert className="absolute -top-1 -right-1 w-3.5 h-3.5 text-orange-500" title={`${b.covers} covers exceeds table capacity (${maxCovers})`} />
        )}
      </div>

      {/* Name + phone */}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{b.guest_name}</p>
        {b.guest_phone && (
          <p className="text-xs text-muted-foreground truncate">{b.guest_phone}</p>
        )}
      </div>

      {/* Ends badge */}
      {endTime && (
        <span className="shrink-0 text-xs text-muted-foreground border rounded px-1.5 py-0.5 whitespace-nowrap">
          Ends: {endTime}
        </span>
      )}

      {/* Table + section */}
      <div className="shrink-0 text-right hidden sm:block">
        <p className="text-sm font-medium">{b.combination_name ?? b.table_label}</p>
        {b.section_name && (
          <p className="text-xs text-muted-foreground">{b.section_name}</p>
        )}
      </div>

      {/* Status pill — clickable dropdown */}
      <div className="shrink-0 relative" onClick={e => e.stopPropagation()}>
        <button
          onClick={onStatusClick}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold touch-manipulation',
            STATUS_COLOURS[b.status]
          )}
        >
          {STATUS_LABELS[b.status]}
          <ChevronDown className="w-3 h-3 opacity-70" />
        </button>

        {statusDropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={onDropdownClose} />
            <div className="absolute right-0 top-full mt-1 w-44 bg-background rounded-xl border shadow-lg z-20 overflow-hidden py-1">
              {selectableStatuses.map(s => (
                <button
                  key={s}
                  onClick={() => onStatusSelect(s)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left hover:bg-muted transition-colors touch-manipulation"
                >
                  <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_DOT[s])} />
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
