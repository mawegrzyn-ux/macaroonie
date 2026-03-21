// src/pages/Customers.jsx
// Customer list with GDPR functions.
//
// Layout: left list (search + results) | right detail panel
//
// Detail panel:
//   - Customer info (name, email, phone, joined date)
//   - Booking history (date, venue, table, covers, status)
//   - GDPR: Export data (JSON download)
//   - GDPR: Anonymise all data (double confirmation inline)

import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Search, User, Mail, Phone, Download,
  ShieldAlert, ChevronRight,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'

export default function Customers() {
  const api = useApi()
  const qc  = useQueryClient()

  const [search,       setSearch]       = useState('')
  const [debouncedQ,   setDebouncedQ]   = useState('')
  const [selectedId,   setSelectedId]   = useState(null)
  const [panelWidth,   setPanelWidth]   = useState(460)
  const isResizing = useRef(false)
  const debounceTimer = useRef(null)

  // Debounce the search input
  useEffect(() => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedQ(search), 300)
    return () => clearTimeout(debounceTimer.current)
  }, [search])

  // ── Resizable panel ──────────────────────────────────────────
  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev) {
      if (!isResizing.current) return
      const clientX  = ev.touches ? ev.touches[0].clientX : ev.clientX
      const newWidth = window.innerWidth - clientX
      setPanelWidth(Math.min(700, Math.max(320, newWidth)))
    }
    function onUp() {
      isResizing.current = false
      document.body.style.cursor    = ''
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

  // ── Data ─────────────────────────────────────────────────────
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', debouncedQ],
    queryFn:  () => api.get(`/customers?q=${encodeURIComponent(debouncedQ)}&limit=50`),
    staleTime: 30_000,
  })

  const { data: detail } = useQuery({
    queryKey: ['customers', selectedId],
    queryFn:  () => api.get(`/customers/${selectedId}`),
    enabled:  !!selectedId,
  })

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: list ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
          <h1 className="font-semibold text-sm">Customers</h1>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email or phone…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg bg-background focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6">Loading…</p>
          ) : customers.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6">
              {debouncedQ ? 'No customers match your search.' : 'No customers yet — they appear automatically when bookings are confirmed.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Phone</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Since</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      'border-b cursor-pointer hover:bg-accent/50 transition-colors touch-manipulation',
                      selectedId === c.id && 'bg-accent',
                    )}
                  >
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.email ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {format(parseISO(c.created_at), 'dd MMM yyyy')}
                    </td>
                    <td className="pr-3">
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Resize handle ──────────────────────────────────── */}
      <div
        onMouseDown={onResizeStart}
        onTouchStart={onResizeStart}
        className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors touch-manipulation"
      />

      {/* ── Right: detail panel ────────────────────────────── */}
      <div className="shrink-0 flex flex-col overflow-hidden border-l" style={{ width: panelWidth }}>
        {selectedId && detail ? (
          <CustomerDetail
            customer={detail}
            api={api}
            onAnonymised={() => {
              qc.invalidateQueries({ queryKey: ['customers'] })
              setSelectedId(null)
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <User className="w-8 h-8 opacity-30" />
            <p className="text-sm">Select a customer to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Customer detail panel ─────────────────────────────────────────────────────

function CustomerDetail({ customer, api, onAnonymised }) {
  const qc = useQueryClient()
  const [confirmAnonymise, setConfirmAnonymise] = useState(false)

  const anonymiseMutation = useMutation({
    mutationFn: () => api.post(`/customers/${customer.id}/anonymise`, {}),
    onSuccess:  onAnonymised,
  })

  function handleExport() {
    const filename = `customer-${customer.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`
    api.download(`/customers/${customer.id}/export`, filename)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-5 py-4 border-b shrink-0">
        <p className="font-semibold">{customer.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Customer since {format(parseISO(customer.created_at), 'dd MMM yyyy')}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* Contact info */}
        <Section title="Contact">
          {customer.email && (
            <InfoRow icon={Mail}>{customer.email}</InfoRow>
          )}
          {customer.phone && (
            <InfoRow icon={Phone}>{customer.phone}</InfoRow>
          )}
          {!customer.email && !customer.phone && (
            <p className="text-sm text-muted-foreground">No contact details on record.</p>
          )}
        </Section>

        {/* Booking history */}
        <Section title={`Bookings (${customer.bookings?.length ?? 0})`}>
          {!customer.bookings?.length ? (
            <p className="text-sm text-muted-foreground">No bookings linked yet.</p>
          ) : (
            <div className="space-y-2">
              {customer.bookings.map(b => (
                <div key={b.id} className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {format(parseISO(b.starts_at), 'EEE d MMM yyyy, HH:mm')}
                    </span>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium shrink-0',
                      STATUS_COLOURS[b.status],
                    )}>
                      {STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {b.venue_name} · {b.table_label ?? 'Unallocated'} · {b.covers} covers
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">#{b.reference}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* GDPR */}
        <Section title="GDPR">
          <p className="text-xs text-muted-foreground mb-3">
            Under GDPR, customers may request a copy of their data or ask for all personal
            information to be removed. Anonymisation replaces all identifying fields with
            placeholder values — the booking record itself is retained for audit purposes.
          </p>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 touch-manipulation mb-4"
          >
            <Download className="w-4 h-4" />
            Export customer data (JSON)
          </button>

          {/* Anonymise — two-step */}
          {!confirmAnonymise ? (
            <button
              onClick={() => setConfirmAnonymise(true)}
              className="flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 touch-manipulation"
            >
              <ShieldAlert className="w-4 h-4" />
              Anonymise all personal data
            </button>
          ) : (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm font-medium text-destructive">Anonymise {customer.name}?</p>
              <p className="text-xs text-muted-foreground">
                This will replace the customer's name, email, phone, and notes with placeholder
                values, and anonymise all linked booking records. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => anonymiseMutation.mutate()}
                  disabled={anonymiseMutation.isPending}
                  className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50 touch-manipulation"
                >
                  {anonymiseMutation.isPending ? 'Processing…' : 'Yes, anonymise'}
                </button>
                <button
                  onClick={() => setConfirmAnonymise(false)}
                  disabled={anonymiseMutation.isPending}
                  className="flex-1 py-2 rounded-lg border text-sm touch-manipulation"
                >
                  Cancel
                </button>
              </div>
              {anonymiseMutation.isError && (
                <p className="text-xs text-destructive">
                  {anonymiseMutation.error?.message ?? 'Failed to anonymise'}
                </p>
              )}
            </div>
          )}
        </Section>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </p>
      {children}
    </div>
  )
}

function InfoRow({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-2.5 text-sm mb-2">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}
