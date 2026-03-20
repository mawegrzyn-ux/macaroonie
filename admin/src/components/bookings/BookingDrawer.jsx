// src/components/bookings/BookingDrawer.jsx
// Slide-in panel showing full booking detail.
// Allows: status change, notes edit, refund trigger,
//         guest detail editing, table/combination override.

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  X, Mail, Phone, Users, Clock, CreditCard,
  Pencil, AlertTriangle, Calendar,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatDateTime, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'

const NEXT_STATUSES = {
  confirmed:       ['completed', 'no_show', 'cancelled'],
  pending_payment: ['confirmed', 'cancelled'],
  completed:       [],
  no_show:         [],
  cancelled:       [],
}

export default function BookingDrawer({ booking, onClose, onUpdated }) {
  const api = useApi()
  const [notes,        setNotes]        = useState(booking.operator_notes ?? '')
  const [editingNotes, setEditingNotes] = useState(false)
  const [editingGuest, setEditingGuest] = useState(false)
  const [guestFields,  setGuestFields]  = useState({
    guest_name:  booking.guest_name  ?? '',
    guest_email: booking.guest_email ?? '',
    guest_phone: booking.guest_phone ?? '',
    covers:      booking.covers      ?? 2,
  })
  const [showTablePicker,  setShowTablePicker]  = useState(false)
  // Individual tables: Set of table ids (multi-select)
  const [pickedTableIds,   setPickedTableIds]   = useState(
    () => new Set(booking.combination_id ? [] : (booking.table_id ? [booking.table_id] : []))
  )
  // Combination: single id or null (radio — mutually exclusive with table checkboxes)
  const [pickedComboId,    setPickedComboId]    = useState(booking.combination_id ?? null)

  // ── Reschedule state ──────────────────────────────────────
  const [showReschedule, setShowReschedule] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState(() => {
    const d = new Date(booking.starts_at)
    return d.toISOString().slice(0, 10)
  })
  const [rescheduleTime, setRescheduleTime] = useState(() => {
    const d = new Date(booking.starts_at)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })

  // ── Data: tables + combinations for this venue ───────────
  const { data: tables = [] } = useQuery({
    queryKey: ['tables', booking.venue_id],
    queryFn:  () => api.get(`/venues/${booking.venue_id}/tables`),
    enabled:  showTablePicker,
  })
  const { data: combinations = [] } = useQuery({
    queryKey: ['combinations', booking.venue_id],
    queryFn:  () => api.get(`/venues/${booking.venue_id}/combinations`),
    enabled:  showTablePicker,
  })

  // ── Mutations ─────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: (status) => api.patch(`/bookings/${booking.id}/status`, { status }),
    onSuccess:  onUpdated,
  })

  const notesMutation = useMutation({
    mutationFn: () => api.patch(`/bookings/${booking.id}/notes`, { operator_notes: notes }),
    onSuccess:  () => { setEditingNotes(false); onUpdated() },
  })

  const guestMutation = useMutation({
    mutationFn: (data) => api.patch(`/bookings/${booking.id}/guest`, data),
    onSuccess:  () => { setEditingGuest(false); onUpdated() },
  })

  const tablesMutation = useMutation({
    mutationFn: (data) => api.patch(`/bookings/${booking.id}/tables`, data),
    onSuccess:  () => { setShowTablePicker(false); onUpdated() },
  })

  const refundMutation = useMutation({
    mutationFn: () => api.post(`/payments/${booking.payment_id}/refund`, {}),
    onSuccess:  onUpdated,
  })

  const moveMutation = useMutation({
    mutationFn: ({ startsAt }) =>
      api.patch(`/bookings/${booking.id}/move`, {
        table_id:  booking.table_id,
        starts_at: startsAt,
      }),
    onSuccess: () => { setShowReschedule(false); onUpdated() },
  })

  function handleReschedule() {
    // Build ISO from date + time inputs, treating them as local time
    const local   = new Date(`${rescheduleDate}T${rescheduleTime}:00`)
    if (isNaN(local.getTime())) return
    moveMutation.mutate({ startsAt: local.toISOString() })
  }

  // ── Guest edit helpers ────────────────────────────────────
  function handleGuestSave() {
    const payload = {}
    if (guestFields.guest_name  !== booking.guest_name)  payload.guest_name  = guestFields.guest_name
    if (guestFields.guest_email !== booking.guest_email) payload.guest_email = guestFields.guest_email
    if (guestFields.guest_phone !== (booking.guest_phone ?? ''))
      payload.guest_phone = guestFields.guest_phone || null
    if (Number(guestFields.covers) !== booking.covers)   payload.covers      = Number(guestFields.covers)
    if (!Object.keys(payload).length) { setEditingGuest(false); return }
    guestMutation.mutate(payload)
  }

  // ── Table override helpers ────────────────────────────────
  const currentCovers = guestFields.covers ?? booking.covers

  function toggleTable(id) {
    setPickedComboId(null)   // deselect any combo when toggling tables
    setPickedTableIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectCombo(id) {
    setPickedTableIds(new Set())   // deselect all individual tables when picking a combo
    setPickedComboId(id)
  }

  // Combined max covers of all selected individual tables
  const combinedMaxCovers = [...pickedTableIds].reduce((sum, id) => {
    const t = tables.find(x => x.id === id)
    return sum + (t?.max_covers ?? 0)
  }, 0)

  function capacityWarning() {
    if (pickedComboId) {
      const c = combinations.find(x => x.id === pickedComboId)
      if (c && (currentCovers < c.min_covers || currentCovers > c.max_covers)) {
        return `${c.name} fits ${c.min_covers}–${c.max_covers} covers (booking has ${currentCovers})`
      }
    } else if (pickedTableIds.size > 0) {
      if (currentCovers > combinedMaxCovers) {
        return `Selected tables fit up to ${combinedMaxCovers} covers (booking has ${currentCovers})`
      }
    }
    return null
  }

  function pickedLabel() {
    if (pickedComboId) return combinations.find(c => c.id === pickedComboId)?.name ?? 'combo'
    if (pickedTableIds.size === 1) return tables.find(t => t.id === [...pickedTableIds][0])?.label ?? '—'
    if (pickedTableIds.size > 1)  return [...pickedTableIds].map(id => tables.find(t => t.id === id)?.label).filter(Boolean).join(' + ')
    return '—'
  }

  function handleTableSave() {
    if (pickedComboId) {
      tablesMutation.mutate({ combination_id: pickedComboId })
    } else if (pickedTableIds.size > 0) {
      tablesMutation.mutate({ table_ids: [...pickedTableIds] })
    }
  }

  const canSave   = pickedComboId || pickedTableIds.size > 0
  const warning   = showTablePicker ? capacityWarning() : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-background border-l shadow-xl z-50 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b shrink-0">
          <div>
            <p className="font-semibold text-sm">{booking.guest_name}</p>
            <p className="text-xs text-muted-foreground">#{booking.reference}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Status badge */}
          <div>
            <span className={cn('inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium',
              STATUS_COLOURS[booking.status])}>
              {STATUS_LABELS[booking.status]}
            </span>
          </div>

          {/* ── Booking time + reschedule ────────────────── */}
          <Section
            title="Date & time"
            action={
              !showReschedule
                ? <button
                    onClick={() => setShowReschedule(true)}
                    className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <Calendar className="w-3 h-3" /> Reschedule
                  </button>
                : null
            }
          >
            <Row icon={Clock}>
              {formatDateTime(booking.starts_at)} → {formatDateTime(booking.ends_at)}
            </Row>

            {showReschedule && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground block mb-0.5">Date</label>
                    <input
                      type="date"
                      value={rescheduleDate}
                      onChange={e => setRescheduleDate(e.target.value)}
                      className="w-full text-sm border rounded px-2 py-1.5 outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-0.5">Time</label>
                    <input
                      type="time"
                      step="900"
                      value={rescheduleTime}
                      onChange={e => setRescheduleTime(e.target.value)}
                      className="text-sm border rounded px-2 py-1.5 outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleReschedule}
                    disabled={moveMutation.isPending}
                    className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
                  >
                    {moveMutation.isPending ? 'Moving…' : 'Move booking'}
                  </button>
                  <button
                    onClick={() => setShowReschedule(false)}
                    className="text-xs px-3 py-1.5 border rounded"
                  >Cancel</button>
                </div>
                {moveMutation.isError && (
                  <p className="text-xs text-destructive">{moveMutation.error?.message ?? 'Failed to move booking'}</p>
                )}
              </div>
            )}
          </Section>

          {/* ── Guest details (editable) ──────────────────── */}
          <Section
            title="Guest details"
            action={
              !editingGuest
                ? <button
                    onClick={() => setEditingGuest(true)}
                    className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                : null
            }
          >
            {editingGuest ? (
              <div className="space-y-2">
                <GuestField
                  label="Name"
                  value={guestFields.guest_name}
                  onChange={v => setGuestFields(p => ({ ...p, guest_name: v }))}
                />
                <GuestField
                  label="Email"
                  type="email"
                  value={guestFields.guest_email}
                  onChange={v => setGuestFields(p => ({ ...p, guest_email: v }))}
                />
                <GuestField
                  label="Phone"
                  value={guestFields.guest_phone}
                  onChange={v => setGuestFields(p => ({ ...p, guest_phone: v }))}
                  placeholder="+44 7700 900000"
                />
                <GuestField
                  label="Covers"
                  type="number"
                  value={guestFields.covers}
                  onChange={v => setGuestFields(p => ({ ...p, covers: v }))}
                  inputClass="w-20"
                />
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleGuestSave}
                    disabled={guestMutation.isPending}
                    className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
                  >
                    {guestMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setGuestFields({
                        guest_name:  booking.guest_name  ?? '',
                        guest_email: booking.guest_email ?? '',
                        guest_phone: booking.guest_phone ?? '',
                        covers:      booking.covers      ?? 2,
                      })
                      setEditingGuest(false)
                    }}
                    className="text-xs px-3 py-1.5 border rounded"
                  >Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Row icon={Users}>{booking.covers} covers</Row>
                <Row icon={Mail}>{booking.guest_email}</Row>
                {booking.guest_phone && <Row icon={Phone}>{booking.guest_phone}</Row>}
                {booking.guest_notes && (
                  <div className="text-sm text-muted-foreground bg-muted rounded p-2 mt-1">
                    {booking.guest_notes}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Table / combination override ─────────────── */}
          <Section
            title="Table assignment"
            action={
              <button
                onClick={() => setShowTablePicker(v => !v)}
                className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="w-3 h-3" />
                {showTablePicker ? 'Cancel' : 'Override'}
              </button>
            }
          >
            {!showTablePicker ? (
              <p className="text-sm">
                {booking.combination_name
                  ? <span className="font-medium">{booking.combination_name}</span>
                  : <span className="font-medium">{booking.table_label ?? '—'}</span>}
                {booking.combination_name && (
                  <span className="text-xs text-muted-foreground ml-1">(combination)</span>
                )}
              </p>
            ) : (
              <div className="space-y-3">

                {/* Warning */}
                {warning && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{warning}</span>
                  </div>
                )}

                {/* Individual tables — multi-select checkboxes */}
                {tables.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">
                      Individual tables
                      <span className="font-normal ml-1">(select one or more)</span>
                    </p>
                    <div className="space-y-1">
                      {tables.filter(t => t.is_active).map(t => {
                        const selected = pickedTableIds.has(t.id)
                        const singleFits = currentCovers >= t.min_covers && currentCovers <= t.max_covers
                        return (
                          <label
                            key={t.id}
                            className={cn(
                              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors',
                              selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="accent-primary w-3.5 h-3.5"
                              checked={selected}
                              onChange={() => toggleTable(t.id)}
                            />
                            <span className="font-medium">{t.label}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{t.min_covers}–{t.max_covers} cov</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Combinations — single radio select */}
                {combinations.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Preset combinations</p>
                    <div className="space-y-1">
                      {combinations.filter(c => c.is_active).map(c => {
                        const fits = currentCovers >= c.min_covers && currentCovers <= c.max_covers
                        const selected = pickedComboId === c.id
                        return (
                          <label
                            key={c.id}
                            className={cn(
                              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors',
                              selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                              !fits && 'opacity-60'
                            )}
                          >
                            <input
                              type="radio"
                              name="combo-pick"
                              className="accent-primary"
                              checked={selected}
                              onChange={() => selectCombo(c.id)}
                            />
                            <span className="font-medium">{c.name}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{c.min_covers}–{c.max_covers} cov</span>
                            {!fits && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleTableSave}
                  disabled={tablesMutation.isPending || !canSave}
                  className="w-full text-sm py-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-40"
                >
                  {tablesMutation.isPending ? 'Saving…' : `Assign to ${pickedLabel()}`}
                </button>
              </div>
            )}
          </Section>

          {/* ── Payment ───────────────────────────────────── */}
          {booking.payment_id && (
            <Section title="Payment">
              <Row icon={CreditCard}>
                {booking.payment_amount} {booking.payment_currency ?? ''} ·{' '}
                <span className={cn('font-medium',
                  booking.payment_status === 'succeeded' ? 'text-green-700' : 'text-yellow-700')}>
                  {booking.payment_status}
                </span>
              </Row>
              {booking.payment_status === 'succeeded' && (
                <button
                  onClick={() => refundMutation.mutate()}
                  disabled={refundMutation.isPending}
                  className="mt-2 text-xs text-destructive underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {refundMutation.isPending ? 'Processing…' : 'Issue refund'}
                </button>
              )}
            </Section>
          )}

          {/* ── Operator notes ────────────────────────────── */}
          <Section title="Operator notes">
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full text-sm border rounded p-2 resize-none min-h-20"
                  placeholder="Internal notes…"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => notesMutation.mutate()}
                    disabled={notesMutation.isPending}
                    className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
                  >
                    {notesMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setNotes(booking.operator_notes ?? ''); setEditingNotes(false) }}
                    className="text-xs px-3 py-1.5 border rounded"
                  >Cancel</button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setEditingNotes(true)}
                className="text-sm text-muted-foreground cursor-text min-h-8 hover:bg-muted rounded p-1.5 -m-1.5"
              >
                {notes || <span className="italic">Click to add notes…</span>}
              </div>
            )}
          </Section>
        </div>

        {/* Footer: status actions */}
        {NEXT_STATUSES[booking.status]?.length > 0 && (
          <div className="p-4 border-t shrink-0 space-y-2">
            <p className="text-xs font-medium text-muted-foreground mb-2">Change status</p>
            <div className="flex flex-wrap gap-2">
              {NEXT_STATUSES[booking.status].map(s => (
                <button
                  key={s}
                  onClick={() => statusMutation.mutate(s)}
                  disabled={statusMutation.isPending}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-full border font-medium transition-colors disabled:opacity-50',
                    s === 'cancelled' && 'border-destructive text-destructive hover:bg-destructive/10',
                    s === 'completed' && 'border-green-600 text-green-700 hover:bg-green-50',
                    s === 'no_show'   && 'border-gray-400 text-gray-600 hover:bg-gray-50',
                    s === 'confirmed' && 'border-blue-500 text-blue-700 hover:bg-blue-50',
                  )}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function Row({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </div>
  )
}

function Section({ title, action, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

function GuestField({ label, value, onChange, type = 'text', placeholder, inputClass = '' }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full text-sm border rounded px-2 py-1.5 outline-none focus:border-primary',
          inputClass
        )}
      />
    </div>
  )
}
