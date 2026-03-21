// src/pages/Customers.jsx
// Customer list with editing, manual add, CSV import, and GDPR functions.
//
// Layout: left list (search + results) | right detail panel
//
// Detail panel modes:
//   view   — contact info + booking history + GDPR actions
//   edit   — inline edit of name / email / phone / notes

import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  Search, User, Mail, Phone, Download, Plus, Upload,
  ShieldAlert, ChevronRight, Pencil, X, Check, FileText,
  TriangleAlert,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'

// ── CSV parser ────────────────────────────────────────────────
// Accepts: name,email,phone,notes  (optional header row, optional fields)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []

  // Detect and skip a header row
  const first = lines[0].toLowerCase()
  const hasHeader = first.startsWith('name') || first.startsWith('"name')
  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines.map(line => {
    // Naive CSV split — handles simple quoted fields
    const parts = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? []
    const clean  = (s) => (s ?? '').trim().replace(/^"|"$/g, '').trim()
    return {
      name:  clean(parts[0]),
      email: clean(parts[1]) || null,
      phone: clean(parts[2]) || null,
      notes: clean(parts[3]) || null,
    }
  }).filter(r => r.name.length > 0)
}

// ── Main page ─────────────────────────────────────────────────
export default function Customers() {
  const api = useApi()
  const qc  = useQueryClient()

  const [search,     setSearch]     = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [panelWidth, setPanelWidth] = useState(460)
  const [showAdd,    setShowAdd]    = useState(false)
  const [showImport, setShowImport] = useState(false)

  const isResizing    = useRef(false)
  const debounceTimer = useRef(null)

  // Debounce search
  useEffect(() => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedQ(search), 300)
    return () => clearTimeout(debounceTimer.current)
  }, [search])

  // ── Resizable panel ──────────────────────────────────────────
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
          <h1 className="font-semibold text-sm mr-2">Customers</h1>

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

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6">Loading…</p>
          ) : customers.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6">
              {debouncedQ
                ? 'No customers match your search.'
                : 'No customers yet — they appear automatically when bookings are confirmed, or add one manually.'}
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
                      c.is_anonymised && 'opacity-50 italic',
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

// ── Customer detail panel ─────────────────────────────────────
function CustomerDetail({ customer, api, onUpdated, onAnonymised }) {
  const qc = useQueryClient()
  const [editing,          setEditing]          = useState(false)
  const [confirmAnonymise, setConfirmAnonymise] = useState(false)
  const [form, setForm] = useState({
    name:  customer.name  ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    notes: customer.notes ?? '',
  })

  // Keep form in sync if parent re-fetches the same customer
  useEffect(() => {
    setForm({
      name:  customer.name  ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      notes: customer.notes ?? '',
    })
    setEditing(false)
  }, [customer.id])

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/customers/${customer.id}`, {
      name:  form.name  || undefined,
      email: form.email || null,
      phone: form.phone || null,
      notes: form.notes || null,
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
      <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
        <div className="min-w-0">
          <p className="font-semibold truncate">{customer.name}</p>
          <p className="text-xs text-muted-foreground">
            Customer since {format(parseISO(customer.created_at), 'dd MMM yyyy')}
          </p>
        </div>
        {!customer.is_anonymised && (
          editing ? (
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
                onClick={() => { setEditing(false); setForm({ name: customer.name ?? '', email: customer.email ?? '', phone: customer.phone ?? '', notes: customer.notes ?? '' }) }}
                className="p-1.5 rounded hover:bg-accent touch-manipulation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border rounded-lg hover:bg-accent touch-manipulation shrink-0 ml-2"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          )
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* Anonymised banner */}
        {customer.is_anonymised && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            This customer's data has been anonymised under GDPR.
          </div>
        )}

        {/* Contact info — view or edit */}
        <Section title="Contact">
          {editing ? (
            <div className="space-y-3">
              <EditField label="Name *">
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="field-input"
                  placeholder="Full name"
                  autoFocus
                />
              </EditField>
              <EditField label="Email">
                <input
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  type="email"
                  inputMode="email"
                  className="field-input"
                  placeholder="email@example.com"
                />
              </EditField>
              <EditField label="Phone">
                <input
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  type="tel"
                  inputMode="tel"
                  className="field-input"
                  placeholder="+44 7700 900000"
                />
              </EditField>
              <EditField label="Notes">
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="field-input min-h-[72px] resize-none"
                  placeholder="Internal notes…"
                />
              </EditField>
              {saveMutation.isError && (
                <p className="text-xs text-destructive">{saveMutation.error?.message ?? 'Save failed'}</p>
              )}
            </div>
          ) : (
            <>
              {customer.email && <InfoRow icon={Mail}>{customer.email}</InfoRow>}
              {customer.phone && <InfoRow icon={Phone}>{customer.phone}</InfoRow>}
              {customer.notes && (
                <InfoRow icon={FileText}>
                  <span className="text-muted-foreground">{customer.notes}</span>
                </InfoRow>
              )}
              {!customer.email && !customer.phone && !customer.notes && (
                <p className="text-sm text-muted-foreground">No contact details on record.</p>
              )}
            </>
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
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', STATUS_COLOURS[b.status])}>
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
        {!customer.is_anonymised && (
          <Section title="GDPR">
            <p className="text-xs text-muted-foreground mb-3">
              Export all data held for this customer, or anonymise it in response to a Right
              to Erasure request. Anonymisation replaces all personal data with placeholder
              values and cannot be undone.
            </p>

            <button
              onClick={handleExport}
              className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 touch-manipulation mb-4"
            >
              <Download className="w-4 h-4" />
              Export customer data (JSON)
            </button>

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
                  Replaces name, email, phone, and notes with placeholder values and anonymises
                  all linked booking records. Cannot be undone.
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
                  <p className="text-xs text-destructive">{anonymiseMutation.error?.message ?? 'Failed'}</p>
                )}
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}

// ── Add customer modal ────────────────────────────────────────
function AddCustomerModal({ api, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })
  const [error, setError] = useState(null)

  const createMutation = useMutation({
    mutationFn: () => api.post('/customers', {
      name:  form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
    }),
    onSuccess: (data) => onCreated(data.id),
    onError:   (e)    => setError(e.message ?? 'Failed to create customer'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setError(null)
    createMutation.mutate()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-background rounded-xl shadow-2xl w-full max-w-sm flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
            <p className="font-semibold text-sm">Add customer</p>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <EditField label="Name *">
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="field-input"
                placeholder="Full name"
                autoFocus={false}
                required
              />
            </EditField>
            <EditField label="Email">
              <input
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                type="email"
                inputMode="email"
                className="field-input"
                placeholder="email@example.com"
              />
            </EditField>
            <EditField label="Phone">
              <input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                type="tel"
                inputMode="tel"
                className="field-input"
                placeholder="+44 7700 900000"
              />
            </EditField>
            <EditField label="Notes">
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="field-input min-h-[60px] resize-none"
                placeholder="Internal notes…"
              />
            </EditField>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm touch-manipulation">
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !form.name.trim()}
                className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50 touch-manipulation"
              >
                {createMutation.isPending ? 'Adding…' : 'Add customer'}
              </button>
            </div>
          </form>
        </div>
      </div>
      <style>{`.field-input{width:100%;border:1px solid hsl(var(--border));border-radius:.5rem;padding:.4rem .6rem;font-size:.875rem;background:hsl(var(--background));outline:none}.field-input:focus{border-color:hsl(var(--primary))}`}</style>
    </>
  )
}

// ── CSV import modal ──────────────────────────────────────────
function ImportModal({ api, onClose, onImported }) {
  const [rows,    setRows]    = useState(null)  // parsed preview rows
  const [result,  setResult]  = useState(null)  // import result
  const [error,   setError]   = useState(null)
  const fileRef = useRef(null)

  const importMutation = useMutation({
    mutationFn: () => api.post('/customers/import', { customers: rows }),
    onSuccess:  (data) => setResult(data),
    onError:    (e)    => setError(e.message ?? 'Import failed'),
  })

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setResult(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result)
      if (!parsed.length) {
        setError('No valid rows found. Check your CSV format.')
        setRows(null)
      } else {
        setRows(parsed)
      }
    }
    reader.readAsText(file)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={result ? onImported : onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
            <p className="font-semibold text-sm">Import customers from CSV</p>
            <button onClick={result ? onImported : onClose} className="p-1.5 rounded hover:bg-accent">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* Format hint */}
            {!rows && !result && (
              <>
                <p className="text-sm text-muted-foreground">
                  Upload a CSV file with customer data. One row per customer.
                </p>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-semibold mb-1">Expected column order:</p>
                  <code className="text-xs text-primary">name, email, phone, notes</code>
                  <p className="text-xs text-muted-foreground mt-1">
                    Only <strong>name</strong> is required. A header row is detected and skipped automatically.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Existing customers are matched by email and updated. New emails create new records.
                  </p>
                </div>

                {/* File picker */}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  className="hidden"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center justify-center gap-2 w-full py-8 border-2 border-dashed rounded-xl hover:bg-accent transition-colors text-muted-foreground touch-manipulation"
                >
                  <Upload className="w-5 h-5" />
                  <span className="text-sm font-medium">Choose CSV file</span>
                </button>
                {error && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <TriangleAlert className="w-3.5 h-3.5 shrink-0" />{error}
                  </p>
                )}
              </>
            )}

            {/* Preview */}
            {rows && !result && (
              <>
                <p className="text-sm font-medium">{rows.length} row{rows.length !== 1 ? 's' : ''} to import</p>
                <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Email</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{r.name || <span className="text-destructive">—</span>}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.email ?? '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{r.phone ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setRows(null); setError(null); if (fileRef.current) fileRef.current.value = '' }}
                    className="flex-1 py-2 border rounded-lg text-sm touch-manipulation"
                  >
                    Choose different file
                  </button>
                  <button
                    onClick={() => importMutation.mutate()}
                    disabled={importMutation.isPending}
                    className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50 touch-manipulation"
                  >
                    {importMutation.isPending ? 'Importing…' : `Import ${rows.length} customers`}
                  </button>
                </div>
              </>
            )}

            {/* Result */}
            {result && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Created',  value: result.created,  colour: 'text-green-700 bg-green-50' },
                    { label: 'Updated',  value: result.updated,  colour: 'text-blue-700 bg-blue-50' },
                    { label: 'Skipped',  value: result.skipped,  colour: 'text-muted-foreground bg-muted/40' },
                  ].map(({ label, value, colour }) => (
                    <div key={label} className={`rounded-lg p-3 text-center ${colour}`}>
                      <p className="text-2xl font-bold">{value}</p>
                      <p className="text-xs font-medium">{label}</p>
                    </div>
                  ))}
                </div>
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
          </div>
        </div>
      </div>
      <style>{`.field-input{width:100%;border:1px solid hsl(var(--border));border-radius:.5rem;padding:.4rem .6rem;font-size:.875rem;background:hsl(var(--background));outline:none}.field-input:focus{border-color:hsl(var(--primary))}`}</style>
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
