// src/pages/Bookings.jsx
// Filterable, searchable bookings list.
// Clicking a row opens BookingDrawer (same component as timeline).

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Filter, Download } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatDateTime, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'
import BookingDrawer from '@/components/bookings/BookingDrawer'

const STATUSES = ['', 'confirmed', 'pending_payment', 'cancelled', 'no_show', 'completed']

function StatusBadge({ status }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      STATUS_COLOURS[status]
    )}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export default function Bookings() {
  const api = useApi()
  const qc  = useQueryClient()

  const [search,   setSearch]   = useState('')
  const [status,   setStatus]   = useState('')
  const [venueId,  setVenueId]  = useState('')
  const [date,     setDate]     = useState('')
  const [selected, setSelected] = useState(null)
  const [page,     setPage]     = useState(0)
  const LIMIT = 50

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn:  () => api.get('/venues'),
  })

  // Build query string
  const params = new URLSearchParams()
  if (venueId) params.set('venue_id', venueId)
  if (date)    params.set('date', date)
  if (status)  params.set('status', status)
  params.set('limit',  LIMIT)
  params.set('offset', page * LIMIT)

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['bookings-list', venueId, date, status, page],
    queryFn:  () => api.get(`/bookings?${params}`),
  })

  // Client-side search filter (name / email / reference)
  const filtered = useMemo(() => {
    if (!search.trim()) return bookings
    const q = search.toLowerCase()
    return bookings.filter(b =>
      b.guest_name.toLowerCase().includes(q)  ||
      b.guest_email.toLowerCase().includes(q) ||
      b.reference.toLowerCase().includes(q)
    )
  }, [bookings, search])

  function resetFilters() {
    setSearch(''); setStatus(''); setVenueId(''); setDate(''); setPage(0)
  }

  // CSV export of current filtered view
  function exportCSV() {
    const headers = ['Reference','Guest','Email','Phone','Covers','Venue','Table','Start','End','Status','Payment']
    const rows = filtered.map(b => [
      b.reference, b.guest_name, b.guest_email, b.guest_phone ?? '',
      b.covers, b.venue_name, b.table_label,
      b.starts_at, b.ends_at, b.status,
      b.payment_amount ? `${b.payment_amount} ${b.payment_currency}` : '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `bookings-${date || 'all'}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <h1 className="font-semibold">Bookings</h1>
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg hover:bg-accent"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-muted/30 shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Name, email or ref…"
            className="pl-8 pr-3 py-1.5 text-sm border rounded-lg w-52 bg-background"
          />
        </div>

        {/* Venue */}
        <select
          value={venueId}
          onChange={e => { setVenueId(e.target.value); setPage(0) }}
          className="text-sm border rounded-lg px-2 py-1.5 bg-background"
        >
          <option value="">All venues</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>

        {/* Date */}
        <input
          type="date"
          value={date}
          onChange={e => { setDate(e.target.value); setPage(0) }}
          className="text-sm border rounded-lg px-2 py-1.5 bg-background"
        />

        {/* Status */}
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0) }}
          className="text-sm border rounded-lg px-2 py-1.5 bg-background"
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{s ? STATUS_LABELS[s] : 'All statuses'}</option>
          ))}
        </select>

        {(search || status || venueId || date) && (
          <button onClick={resetFilters} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Clear filters
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} booking{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No bookings found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b">
              <tr>
                {['Ref','Guest','Date & time','Venue / table','Covers','Status','Payment'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(b => (
                <tr
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className="hover:bg-accent/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted-foreground">{b.reference}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{b.guest_name}</p>
                    <p className="text-xs text-muted-foreground">{b.guest_email}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDateTime(b.starts_at)}
                  </td>
                  <td className="px-4 py-3">
                    <p>{b.venue_name}</p>
                    <p className="text-xs text-muted-foreground">{b.table_label}</p>
                  </td>
                  <td className="px-4 py-3 text-center">{b.covers}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3">
                    {b.payment_amount
                      ? <span className={cn(
                          'text-xs font-medium',
                          b.payment_status === 'succeeded' ? 'text-green-700' : 'text-yellow-700'
                        )}>
                          {b.payment_amount} {b.payment_currency}
                        </span>
                      : <span className="text-xs text-muted-foreground">—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {bookings.length === LIMIT && (
        <div className="flex items-center justify-between px-6 py-3 border-t shrink-0">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-sm px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-accent"
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground">Page {page + 1}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            className="text-sm px-3 py-1.5 border rounded-lg hover:bg-accent"
          >
            Next
          </button>
        </div>
      )}

      {/* Booking drawer */}
      {selected && (
        <BookingDrawer
          booking={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            qc.invalidateQueries({ queryKey: ['bookings-list'] })
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}
