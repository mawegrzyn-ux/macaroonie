// src/pages/Customers.jsx
// Customer list with editing, manual add, CSV import, and GDPR functions.
//
// Layout: left list (search + results) | right detail panel (desktop)
//         On mobile (<1024px) the list stays full-width; detail opens as a
//         sliding overlay drawer with backdrop + close.
//
// Detail panel modes:
//   view   — contact info + booking history + GDPR actions
//   edit   — inline edit of name / email / phone / notes

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Search, User, Mail, Phone, Download, Plus, Upload,
  ShieldAlert, ChevronRight, Pencil, X, Check, FileText,
  TriangleAlert, TrendingUp, Minus, ChevronUp, ChevronDown, ArrowUpDown,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'

// ── CSV parser ────────────────────────────────────────────────
// Supports two column orderings (auto-detected from header):
//   Standard:  name, email, phone, notes, visits
//   Phone-first: name, phone, email, notes, visits  (e.g. CRM exports)
//
// Header row is detected case-insensitively and skipped automatically.
// A header is any first row whose first cell contains "name" (not a real name).
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []

  const clean = (s) => (s ?? '').trim().replace(/^"|"$/g, '').trim()

  function splitLine(line) {
    return line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? []
  }

  // Detect header row — first cell contains "name" (case-insensitive)
  const firstCells = splitLine(lines[0]).map(c => clean(c).toLowerCase())
  const hasHeader  = firstCells[0]?.includes('name') ?? false

  // Detect column order from header names if present, otherwise assume standard
  // phone-first: col[1] looks like "phone" and col[2] looks like "email"
  let phoneFirst = false
  if (hasHeader) {
    phoneFirst = firstCells[1]?.includes('phone') && firstCells[2]?.includes('email')
  }

  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines.map(line => {
    const parts  = splitLine(line)
    const visits = parseInt(clean(parts[4]), 10)
    const col1   = clean(parts[1]) || null
    const col2   = clean(parts[2]) || null
    return {
      name:        clean(parts[0]),
      email:       phoneFirst ? col2 : col1,
      phone:       phoneFirst ? col1 : col2,
      notes:       clean(parts[3]) || null,
      visit_count: isNaN(visits) ? 0 : Math.max(0, visits),
    }
  }).filter(r => r.name.length > 0)
}

// ── Main page ─────────────────────────────────────────────────
function useIsDesktop(minWidth = 1024) {
  const [ok, setOk] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(`(min-width: ${minWidth}px)`).matches)
  useEffect(() => {
    const m = window.matchMedia(`(min-width: ${minWidth}px)`)
    const fn = () => setOk(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [minWidth])
  return ok
}

export default function Customers() {
  const api = useApi()
  const qc  = useQueryClient()

  const [search,     setSearch]     = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [panelWidth, setPanelWidth] = useState(460)
  const [showAdd,    setShowAdd]    = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [sort,       setSort]       = useState({ col: 'updated_at', dir: 'desc' })
  const isDesktop = useIsDesktop()

  const isResizing    = useRef(false)
  const debounceTimer = useRef(null)
  const sentinelRef   = useRef(null)

  function onSort(col) {
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' }
    )
  }

  // Debounce search
  useEffect(() => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedQ(search), 300)
    return () => clearTimeout(debounceTimer.current)
  }, [search])

  // Resize handle
  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
    function onMove(ev) {
      if (!isResizing.current) return
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX
      setPanelWidth(Math.min(700, Math.max(320, window.innerWidth - x)))
    }
    function onUp() {
      isResizing.current = false
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

  const PAGE_SIZE = 50
  const {
    data:              infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey:         ['customers', debouncedQ, sort],
    queryFn:          ({ pageParam }) =>
      api.get(`/customers?q=${encodeURIComponent(debouncedQ)}&limit=${PAGE_SIZE}&offset=${pageParam}&sort=${sort.col}&dir=${sort.dir}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.rows.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    staleTime: 30_000,
  })

  const customers  = useMemo(() => infiniteData?.pages.flatMap(p => p.rows) ?? [], [infiniteData])
  const totalCount = infiniteData?.pages[0]?.total ?? null

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const { data: detail } = useQuery({
    queryKey: ['customers', selectedId],
    queryFn:  () => api.get(`/customers/${selectedId}`),
    enabled:  !!selectedId,
  })

  function onCustomerSaved(id) {
    qc.invalidateQueries({ queryKey: ['customers'] })
    if (id) setSelectedId(id)
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: list ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 h-14 border-b shrink-0">
          <h1 className="font-semibold text-sm">Customers</h1>
          {totalCount !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalCount.toLocaleString()}
            </span>
          )}

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email or phone…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg bg-background focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Import CSV */}
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-accent touch-manipulation"
            >
              <Upload className="w-3.5 h-3.5" />
              Import CSV
            </button>
            {/* Add customer */}
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg touch-manipulation"
            >
              <Plus className="w-3.5 h-3.5" />
              Add customer
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6">Loading…</p>
          ) : customers.length === 0 && !isFetchingNextPage ? (
            <p className="text-sm text-muted-foreground p-6">
              {debouncedQ
                ? 'No customers match your search.'
                : 'No customers yet — they appear automatically when bookings are confirmed, or add one manually.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-muted">
                  <SortableHeader col="name"        label="Name"   align="left"  sort={sort} onSort={onSort} />
                  <SortableHeader col="email"       label="Email"  align="left"  sort={sort} onSort={onSort} />
                  <SortableHeader col="phone"       label="Phone"  align="left"  sort={sort} onSort={onSort} />
                  <SortableHeader col="visit_count" label="Visits" align="right" sort={sort} onSort={onSort} />
                  <SortableHeader col="created_at"  label="Since"  align="left"  sort={sort} onSort={onSort} />
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
                      c.is_anonymised && 'opacity-50 italic',
                    )}
                  >
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.email ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-semibold tabular-nums">{c.visit_count ?? 0}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {format(parseISO(c.created_at), 'dd MMM yyyy')}
                    </td>
                    <td className="pr-3">
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
                {/* Infinite scroll sentinel + footer status */}
                <tr ref={sentinelRef}>
                  <td colSpan={6} className="py-4 text-center text-xs text-muted-foreground">
                    {isFetchingNextPage
                      ? 'Loading more…'
                      : !hasNextPage && totalCount !== null
                        ? `${customers.length.toLocaleString()} of ${totalCount.toLocaleString()} customers`
                        : null}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Desktop: docked side panel */}
      {isDesktop && (
        <>
          <div
            onMouseDown={onResizeStart}
            onTouchStart={onResizeStart}
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
            {selectedId && detail ? (
              <CustomerDetail
                key={selectedId}
                customer={detail}
                api={api}
                onUpdated={() => qc.invalidateQueries({ queryKey: ['customers'] })}
                onAnonymised={() => { qc.invalidateQueries({ queryKey: ['customers'] }); setSelectedId(null) }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <User className="w-8 h-8 opacity-30" />
                <p className="text-sm">Select a customer to view details</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Mobile: full-screen sliding drawer over the list */}
      {!isDesktop && selectedId && detail && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] z-50 bg-background border-l shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            <CustomerDetail
              key={selectedId}
              customer={detail}
              api={api}
              onClose={() => setSelectedId(null)}
              onUpdated={() => qc.invalidateQueries({ queryKey: ['customers'] })}
              onAnonymised={() => { qc.invalidateQueries({ queryKey: ['customers'] }); setSelectedId(null) }}
            />
          </div>
        </>
      )}

      {/* ── Add customer modal ──────────────────────────────── */}
      {showAdd && (
        <AddCustomerModal
          api={api}
          onClose={() => setShowAdd(false)}
          onCreated={(id) => { setShowAdd(false); onCustomerSaved(id) }}
        />
      )}

      {/* ── CSV import modal ────────────────────────────────── */}
      {showImport && (
        <ImportModal
          api={api}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); qc.invalidateQueries({ queryKey: ['customers'] }) }}
        />
      )}
    </div>
  )
}

// ── Sortable column header ────────────────────────────────────
function SortableHeader({ col, label, align = 'left', sort, onSort }) {
  const active = sort.col === col
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-xs font-medium text-muted-foreground cursor-pointer select-none touch-manipulation',
        align === 'right' && 'text-right',
      )}
      onClick={() => onSort(col)}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}
        {active
          ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </span>
    </th>
  )
}

// ── Detail panel ──────────────────────────────────────────────
function CustomerDetail({ customer, api, onUpdated, onAnonymised, onClose }) {
  const qc = useQueryClient()
  const [editing,          setEditing]          = useState(false)
  const [confirmAnonymise, setConfirmAnonymise] = useState(false)
  const [form, setForm] = useState({
    name:        customer.name        ?? '',
    email:       customer.email       ?? '',
    phone:       customer.phone       ?? '',
    notes:       customer.notes       ?? '',
    visit_count: customer.visit_count ?? 0,
  })

  // Keep form in sync if parent re-fetches the same customer
  useEffect(() => {
    setForm({
      name:        customer.name        ?? '',
      email:       customer.email       ?? '',
      phone:       customer.phone       ?? '',
      notes:       customer.notes       ?? '',
      visit_count: customer.visit_count ?? 0,
    })
    setEditing(false)
  }, [customer.id])

  // Total visits = historical adjustment + bookings in system
  const systemBookings  = customer.bookings?.length ?? 0
  const totalVisits     = (customer.visit_count ?? 0) + systemBookings

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/customers/${customer.id}`, {
      name:        form.name  || undefined,
      email:       form.email || null,
      phone:       form.phone || null,
      notes:       form.notes || null,
      visit_count: form.visit_count,
    }),
    onSuccess: () => {
      setEditing(false)
      onUpdated()
      qc.invalidateQueries({ queryKey: ['customers', customer.id] })
    },
  })

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
      <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0 gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{customer.name}</p>
          <p className="text-xs text-muted-foreground">
            Customer since {format(parseISO(customer.created_at), 'dd MMM yyyy')}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent touch-manipulation shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        )}
        {/* Analytics stat pill */}
        {!customer.is_anonymised && !editing && (
          <div className="flex items-center gap-1.5 shrink-0 ml-3 px-2.5 py-1.5 rounded-lg bg-primary/8 text-primary">
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
            <span className="text-sm font-bold tabular-nums">{totalVisits}</span>
            <span className="text-xs opacity-70">visits</span>
          </div>
        )}
        {editing ? (
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name.trim()}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg disabled:opacity-50 touch-manipulation"
            >
              <Check className="w-3.5 h-3.5" />
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-2.5 py-1.5 text-xs border rounded-lg hover:bg-accent touch-manipulation"
            >
              Cancel
            </button>
          </div>
        ) : !customer.is_anonymised && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs border rounded-lg hover:bg-accent touch-manipulation shrink-0 ml-2"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {customer.is_anonymised && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            This record has been anonymised (GDPR).
          </div>
        )}

        {editing ? (
          <div className="space-y-3">
            <EditField label="Name">
              <input className="field-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </EditField>
            <EditField label="Email">
              <input className="field-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </EditField>
            <EditField label="Phone">
              <input className="field-input" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </EditField>
            <EditField label="Notes">
              <textarea className="field-input" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </EditField>
            <EditField label="Historical visit adjustment">
              <input
                className="field-input"
                type="number"
                min={0}
                value={form.visit_count}
                onChange={e => setForm(f => ({ ...f, visit_count: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Added to system bookings for the total visits figure.</p>
            </EditField>
          </div>
        ) : (
          <>
            <Section title="Contact">
              <InfoRow icon={Mail}>{customer.email || '—'}</InfoRow>
              <InfoRow icon={Phone}>{customer.phone || '—'}</InfoRow>
              {customer.notes && (
                <InfoRow icon={FileText}>
                  <span className="whitespace-pre-wrap">{customer.notes}</span>
                </InfoRow>
              )}
            </Section>

            <Section title="Visits">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-lg font-semibold tabular-nums">{totalVisits}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-lg font-semibold tabular-nums">{systemBookings}</p>
                  <p className="text-xs text-muted-foreground">In system</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-lg font-semibold tabular-nums">{customer.visit_count ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Adjusted</p>
                </div>
              </div>
            </Section>

            {customer.bookings?.length > 0 && (
              <Section title="Recent bookings">
                <div className="space-y-2">
                  {customer.bookings.slice(0, 10).map(b => (
                    <div key={b.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{format(parseISO(b.starts_at), 'dd MMM yyyy · HH:mm')}</p>
                        <p className="text-xs text-muted-foreground">{b.covers} covers · {b.venue_name || '—'}</p>
                      </div>
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full shrink-0 ml-2',
                        STATUS_COLOURS[b.status] || 'bg-muted text-muted-foreground',
                      )}>
                        {STATUS_LABELS[b.status] || b.status}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* GDPR */}
        {!customer.is_anonymised && (
          <Section title="Privacy">
            <div className="space-y-2">
              <button
                onClick={handleExport}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-sm border rounded-lg hover:bg-accent touch-manipulation"
              >
                <Download className="w-3.5 h-3.5" /> Export data
              </button>
              {!confirmAnonymise ? (
                <button
                  onClick={() => setConfirmAnonymise(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-sm border border-destructive/40 text-destructive rounded-lg hover:bg-destructive/5 touch-manipulation"
                >
                  <ShieldAlert className="w-3.5 h-3.5" /> Anonymise (GDPR)
                </button>
              ) : (
                <div className="border border-destructive/40 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-destructive flex items-start gap-1.5">
                    <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    This permanently replaces name, email and phone with placeholders. Bookings stay linked.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => anonymiseMutation.mutate()}
                      disabled={anonymiseMutation.isPending}
                      className="flex-1 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-lg disabled:opacity-50 touch-manipulation"
                    >
                      {anonymiseMutation.isPending ? 'Working…' : 'Confirm anonymise'}
                    </button>
                    <button
                      onClick={() => setConfirmAnonymise(false)}
                      className="flex-1 py-1.5 text-sm border rounded-lg hover:bg-accent touch-manipulation"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}
      </div>
      <style>{`.field-input{width:100%;border:1px solid hsl(var(--border));border-radius:.5rem;padding:.4rem .6rem;font-size:.875rem;background:hsl(var(--background));outline:none}.field-input:focus{border-color:hsl(var(--primary))}`}</style>
    </div>
  )
}

// ── Add customer modal ────────────────────────────────────────
function AddCustomerModal({ api, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })
  const [error, setError] = useState(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/customers', {
      name:  form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
    }),
    onSuccess: (data) => onCreated(data.id),
    onError:   (err) => setError(err?.message || 'Could not create customer'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setError(null)
    mutation.mutate()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-background rounded-xl shadow-xl border w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b">
            <h2 className="font-semibold text-sm">Add customer</h2>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            <EditField label="Name *">
              <input className="field-input" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </EditField>
            <EditField label="Email">
              <input className="field-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </EditField>
            <EditField label="Phone">
              <input className="field-input" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </EditField>
            <EditField label="Notes">
              <textarea className="field-input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </EditField>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm touch-manipulation">
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50 touch-manipulation"
              >
                {mutation.isPending ? 'Saving…' : 'Add customer'}
              </button>
            </div>
          </form>
          <style>{`.field-input{width:100%;border:1px solid hsl(var(--border));border-radius:.5rem;padding:.4rem .6rem;font-size:.875rem;background:hsl(var(--background));outline:none}.field-input:focus{border-color:hsl(var(--primary))}`}</style>
        </div>
      </div>
    </>
  )
}

// ── CSV import modal ──────────────────────────────────────────
function ImportModal({ api, onClose, onImported }) {
  const [text, setText]     = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError]   = useState(null)

  const mutation = useMutation({
    mutationFn: (rows) => api.post('/customers/import', { rows }),
    onSuccess: (data) => setResult(data),
    onError:   (err) => setError(err?.message || 'Import failed'),
  })

  function handleParse() {
    setError(null)
    setResult(null)
    try {
      const rows = parseCSV(text)
      if (!rows.length) { setError('No valid rows found'); setPreview(null); return }
      setPreview(rows)
    } catch (e) {
      setError(e.message || 'Could not parse CSV')
      setPreview(null)
    }
  }

  function handleImport() {
    if (!preview?.length) return
    setError(null)
    mutation.mutate(preview)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={result ? onImported : onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-background rounded-xl shadow-xl border w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b">
            <h2 className="font-semibold text-sm">Import customers (CSV)</h2>
            <button onClick={result ? onImported : onClose} className="p-1.5 rounded hover:bg-accent">
              <X className="w-4 h-4" />
            </button>
          </div>

          {!result ? (
            <div className="p-5 space-y-3">
              <p className="text-xs text-muted-foreground">
                Columns: <code className="text-xs">name, email, phone, notes, visits</code>
                {' '}(or phone before email). Header row optional.
              </p>
              <textarea
                className="field-input font-mono text-xs"
                rows={8}
                placeholder={"name,email,phone,notes,visits\nJane Doe,jane@example.com,+447700900123,,3"}
                value={text}
                onChange={e => { setText(e.target.value); setPreview(null) }}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              {preview && (
                <p className="text-xs text-muted-foreground">{preview.length} row{preview.length !== 1 ? 's' : ''} ready to import</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleParse}
                  className="flex-1 py-2 border rounded-lg text-sm touch-manipulation"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={!preview?.length || mutation.isPending}
                  className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50 touch-manipulation"
                >
                  {mutation.isPending ? 'Importing…' : 'Import'}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-3">
              <p className="text-sm">
                Imported <strong>{result.created ?? 0}</strong> new,
                {' '}updated <strong>{result.updated ?? 0}</strong>,
                {' '}skipped <strong>{result.skipped ?? 0}</strong>.
              </p>
              {result.errors?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-destructive mb-1">{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}:</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-xs text-destructive border border-destructive/20 rounded px-2 py-1">
                        <strong>{e.name}</strong>: {e.error}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={onImported} className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm touch-manipulation">
                Done
              </button>
            </div>
          )}
          <style>{`.field-input{width:100%;border:1px solid hsl(var(--border));border-radius:.5rem;padding:.4rem .6rem;font-size:.875rem;background:hsl(var(--background));outline:none}.field-input:focus{border-color:hsl(var(--primary))}`}</style>
        </div>
      </div>
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{title}</p>
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

function EditField({ label, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  )
}
