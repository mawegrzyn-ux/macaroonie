// src/components/bookings/BookingDrawer.jsx
// Slide-in panel showing full booking detail.
// Allows: status change, notes edit, guest detail editing,
//         table override (individual table checkboxes only),
//         reschedule, and refund trigger.
//
// Save button is always in the drawer header next to the X close button,
// contextually labelled for whichever section is currently being edited.
//
// Touch-friendly: full-width on mobile, 420px panel on sm+.
// Action buttons have dotted borders for larger tap targets.
// Status buttons are large and pill-shaped.

import { useState, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  X, Mail, Phone, Users, Clock, CreditCard,
  Pencil, TriangleAlert, Calendar, Trash2, UserSearch,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatDateTime, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'

// All statuses an operator can manually set.
// pending_payment is excluded — it is set by Stripe, not manually.
const SELECTABLE_STATUSES = ['unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated', 'checked_out', 'no_show', 'cancelled']

// Coloured dot for each status in the dropdown list
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

export default function BookingDrawer({ booking, onClose, onUpdated, panelMode = false, inlineMode = false }) {
  const api = useApi()

  // ── Edit mode flags ───────────────────────────────────────
  const [editingNotes,    setEditingNotes]    = useState(false)
  const [editingGuest,    setEditingGuest]    = useState(false)
  const [showTablePicker, setShowTablePicker] = useState(false)
  const [showReschedule,  setShowReschedule]  = useState(false)
  const [editingEndTime,  setEditingEndTime]  = useState(false)
  const [confirmDelete,   setConfirmDelete]   = useState(false)

  // ── Operator notes ────────────────────────────────────────
  const [notes, setNotes] = useState(booking.operator_notes ?? '')

  // ── Guest fields ──────────────────────────────────────────
  const [guestFields, setGuestFields] = useState({
    guest_name:  booking.guest_name  ?? '',
    guest_email: booking.guest_email ?? '',
    guest_phone: booking.guest_phone ?? '',
    covers:      booking.covers      ?? 2,
  })

  // ── Customer search (guest edit mode) ────────────────────
  const [customerQ,    setCustomerQ]    = useState('')
  const customerQTimer = useRef(null)

  const { data: custSuggestions } = useQuery({
    queryKey: ['customers-search', customerQ],
    queryFn:  () => api.get(`/customers?q=${encodeURIComponent(customerQ)}&limit=6`),
    enabled:  editingGuest && customerQ.length >= 2,
    staleTime: 10_000,
  })

  function handleCustSearch(name, email, phone) {
    clearTimeout(customerQTimer.current)
    customerQTimer.current = setTimeout(() => {
      const q = (email?.length >= 2 ? email : null)
             ?? (name?.length  >= 2 ? name  : null)
             ?? (phone?.length >= 2 ? phone : null)
             ?? ''
      setCustomerQ(q)
    }, 300)
  }

  function handleCustomerSelect(c) {
    setGuestFields(p => ({
      ...p,
      guest_name:  c.name  ?? p.guest_name,
      guest_email: c.email ?? '',
      guest_phone: c.phone ?? '',
    }))
    setCustomerQ('')
  }

  // ── Table override: individual checkboxes only ───────────
  // Pre-populate from member_table_ids (works for both single & combo bookings)
  const [pickedTableIds, setPickedTableIds] = useState(
    () => new Set(
      Array.isArray(booking.member_table_ids) && booking.member_table_ids.length > 0
        ? booking.member_table_ids.filter(Boolean)
        : booking.table_id ? [booking.table_id] : []
    )
  )

  // ── Reschedule state ──────────────────────────────────────
  const [rescheduleDate, setRescheduleDate] = useState(() => {
    const d = new Date(booking.starts_at)
    return d.toISOString().slice(0, 10)
  })
  const [rescheduleTime, setRescheduleTime] = useState(() => {
    const d = new Date(booking.starts_at)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [endTimeValue, setEndTimeValue] = useState(() => {
    const d = new Date(booking.ends_at)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })

  // ── Venue rules — controls which statuses appear in the dropdown ─
  const { data: rules } = useQuery({
    queryKey: ['rules', booking.venue_id],
    queryFn:  () => api.get(`/venues/${booking.venue_id}/rules`),
  })

  // Build the selectable status list from the base set, filtered by enabled rules.
  // Always include a status if the booking currently has it — so operators can
  // always move away from it even if the feature was disabled after booking.
  const selectableStatuses = SELECTABLE_STATUSES.filter(s => {
    if (s === 'unconfirmed')  return (rules?.enable_unconfirmed_flow   ?? false) || booking.status === 'unconfirmed'
    if (s === 'reconfirmed')  return (rules?.enable_reconfirmed_status ?? false) || booking.status === 'reconfirmed'
    return true
  })

  // ── Data: tables for this venue (loaded when picker opens) ─
  const { data: tables = [] } = useQuery({
    queryKey: ['tables', booking.venue_id],
    queryFn:  () => api.get(`/venues/${booking.venue_id}/tables`),
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

  const durationMutation = useMutation({
    mutationFn: ({ endsAt }) => api.patch(`/bookings/${booking.id}/duration`, { ends_at: endsAt }),
    onSuccess: () => { setEditingEndTime(false); onUpdated() },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/bookings/${booking.id}`),
    onSuccess:  () => { onUpdated(); onClose() },
  })

  // ── Reschedule handler ─────────────────────────────────────
  function handleReschedule() {
    const local = new Date(`${rescheduleDate}T${rescheduleTime}:00`)
    if (isNaN(local.getTime())) return
    moveMutation.mutate({ startsAt: local.toISOString() })
  }

  // ── End time handler ──────────────────────────────────────
  function handleEndTimeSave() {
    const startDate = new Date(booking.starts_at).toISOString().slice(0, 10)
    let local       = new Date(`${startDate}T${endTimeValue}:00`)
    if (isNaN(local.getTime())) return
    // If end time is not after start (e.g. crosses midnight), bump to next day
    if (local <= new Date(booking.starts_at)) {
      local = new Date(local.getTime() + 24 * 60 * 60_000)
    }
    durationMutation.mutate({ endsAt: local.toISOString() })
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
  const currentCovers = Number(guestFields.covers ?? booking.covers)

  function toggleTable(id) {
    setPickedTableIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Combined max covers of all selected tables
  const combinedMaxCovers = [...pickedTableIds].reduce((sum, id) => {
    const t = tables.find(x => x.id === id)
    return sum + (t?.max_covers ?? 0)
  }, 0)

  function capacityWarning() {
    if (pickedTableIds.size > 0 && currentCovers > combinedMaxCovers) {
      return `Selected tables fit up to ${combinedMaxCovers} covers (booking has ${currentCovers})`
    }
    return null
  }

  function pickedLabel() {
    const ids = [...pickedTableIds]
    if (ids.length === 0) return '—'
    if (ids.length === 1) return tables.find(t => t.id === ids[0])?.label ?? '—'
    return ids.map(id => tables.find(t => t.id === id)?.label).filter(Boolean).join(' + ')
  }

  function handleTableSave() {
    if (pickedTableIds.size === 0) return
    tablesMutation.mutate({ table_ids: [...pickedTableIds] })
  }

  const canSave = pickedTableIds.size > 0
  const warning = showTablePicker ? capacityWarning() : null

  // ── Header contextual save action ─────────────────────────
  const headerAction = (() => {
    if (editingNotes)    return {
      label:    notesMutation.isPending    ? 'Saving…'   : 'Save notes',
      onClick:  () => notesMutation.mutate(),
      disabled: notesMutation.isPending,
    }
    if (editingGuest)    return {
      label:    guestMutation.isPending    ? 'Saving…'   : 'Save details',
      onClick:  handleGuestSave,
      disabled: guestMutation.isPending,
    }
    if (showTablePicker) return {
      label:    tablesMutation.isPending   ? 'Saving…'   : `Assign ${pickedLabel()}`,
      onClick:  handleTableSave,
      disabled: tablesMutation.isPending || !canSave,
    }
    if (showReschedule)  return {
      label:    moveMutation.isPending     ? 'Moving…'   : 'Move booking',
      onClick:  handleReschedule,
      disabled: moveMutation.isPending,
    }
    if (editingEndTime) return {
      label:    durationMutation.isPending ? 'Saving…'   : 'Save end time',
      onClick:  handleEndTimeSave,
      disabled: durationMutation.isPending,
    }
    return null
  })()

  return (
    <>
      {/* Backdrop — only in overlay mode */}
      {!panelMode && !inlineMode && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      )}

      {/* Drawer:
           overlay mode — fixed right panel with shadow + backdrop
           panelMode    — fixed right panel, no backdrop, no shadow
           inlineMode   — flows in normal document layout (flex child) */}
      <div className={cn(
        'relative bg-background border-l flex flex-col overflow-hidden',
        inlineMode
          ? 'w-[420px] shrink-0 h-full'
          : 'fixed right-0 top-0 bottom-0 w-full sm:w-[420px]',
        !inlineMode && (panelMode ? 'z-30' : 'z-50 shadow-xl'),
      )}>

        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 h-14 border-b shrink-0">
          <div className="min-w-0 mr-2">
            <p className="font-semibold text-sm truncate">{booking.guest_name}</p>
            <p className="text-xs text-muted-foreground">#{booking.reference}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerAction && (
              <button
                onClick={headerAction.onClick}
                disabled={headerAction.disabled}
                className="text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 whitespace-nowrap"
              >
                {headerAction.label}
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* ── Status ───────────────────────────────────── */}
          <Section title="Status">
            <div className="flex flex-wrap gap-2">
              {selectableStatuses.map(s => {
                const isActive = s === booking.status
                return (
                  <button
                    key={s}
                    onClick={() => !isActive && statusMutation.mutate(s)}
                    disabled={statusMutation.isPending}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold touch-manipulation transition-all disabled:opacity-50',
                      isActive
                        ? cn(STATUS_COLOURS[s], 'ring-2 ring-offset-1 ring-current/60 cursor-default')
                        : 'bg-muted text-muted-foreground hover:bg-muted/60',
                    )}
                  >
                    <span className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      isActive ? STATUS_DOT[s] : 'bg-current opacity-40',
                    )} />
                    {statusMutation.isPending && isActive ? 'Updating…' : STATUS_LABELS[s]}
                  </button>
                )
              })}
            </div>
            {statusMutation.isError && (
              <p className="text-xs text-destructive mt-2">
                {statusMutation.error?.message ?? 'Failed to update status'}
              </p>
            )}
          </Section>

          {/* ── Date & time + reschedule ─────────────────── */}
          <Section
            title="Date & time"
            action={
              showReschedule
                ? <ActionButton onClick={() => setShowReschedule(false)} variant="cancel">Cancel</ActionButton>
                : editingEndTime
                  ? <ActionButton onClick={() => setEditingEndTime(false)} variant="cancel">Cancel</ActionButton>
                  : <div className="flex gap-1.5">
                      <ActionButton icon={Calendar} onClick={() => setShowReschedule(true)}>Reschedule</ActionButton>
                      <ActionButton icon={Clock} onClick={() => setEditingEndTime(true)}>End time</ActionButton>
                    </div>
            }
          >
            <Row icon={Clock}>
              {formatDateTime(booking.starts_at)} → {formatDateTime(booking.ends_at)}
            </Row>

            {showReschedule && (
              <div className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground block mb-1">Date</label>
                    <input
                      type="date"
                      value={rescheduleDate}
                      onChange={e => setRescheduleDate(e.target.value)}
                      className="w-full text-sm border rounded-lg px-3 py-2 outline-none focus:border-primary touch-manipulation"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Start time</label>
                    <input
                      type="time"
                      step="900"
                      value={rescheduleTime}
                      onChange={e => setRescheduleTime(e.target.value)}
                      className="text-sm border rounded-lg px-3 py-2 outline-none focus:border-primary touch-manipulation"
                    />
                  </div>
                </div>
                {moveMutation.isError && (
                  <p className="text-xs text-destructive">{moveMutation.error?.message ?? 'Failed to move booking'}</p>
                )}
              </div>
            )}

            {editingEndTime && (
              <div className="mt-4 space-y-3">
                <div className="flex items-end gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">End time</label>
                    <input
                      type="time"
                      step="900"
                      value={endTimeValue}
                      onChange={e => setEndTimeValue(e.target.value)}
                      className="text-sm border rounded-lg px-3 py-2 outline-none focus:border-primary touch-manipulation"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground pb-2.5">Starts: {formatDateTime(booking.starts_at)}</p>
                </div>
                {durationMutation.isError && (
                  <p className="text-xs text-destructive">{durationMutation.error?.message ?? 'Failed to update end time'}</p>
                )}
              </div>
            )}
          </Section>

          {/* ── Guest details ─────────────────────────────── */}
          <Section
            title="Guest details"
            action={
              !editingGuest
                ? <ActionButton icon={Pencil} onClick={() => setEditingGuest(true)}>
                    Edit
                  </ActionButton>
                : <ActionButton onClick={() => {
                    setGuestFields({
                      guest_name:  booking.guest_name  ?? '',
                      guest_email: booking.guest_email ?? '',
                      guest_phone: booking.guest_phone ?? '',
                      covers:      booking.covers      ?? 2,
                    })
                    setEditingGuest(false)
                    setCustomerQ('')
                  }} variant="cancel">
                    Cancel
                  </ActionButton>
            }
          >
            {editingGuest ? (
              <div className="space-y-3">
                <GuestField
                  label="Name"
                  value={guestFields.guest_name}
                  onChange={v => { setGuestFields(p => ({ ...p, guest_name: v })); handleCustSearch(v, guestFields.guest_email, guestFields.guest_phone) }}
                  onBlur={() => setTimeout(() => setCustomerQ(''), 200)}
                />
                <GuestField
                  label="Email"
                  type="email"
                  value={guestFields.guest_email}
                  onChange={v => { setGuestFields(p => ({ ...p, guest_email: v })); handleCustSearch(guestFields.guest_name, v, guestFields.guest_phone) }}
                  onBlur={() => setTimeout(() => setCustomerQ(''), 200)}
                />
                <GuestField
                  label="Phone"
                  value={guestFields.guest_phone}
                  onChange={v => { setGuestFields(p => ({ ...p, guest_phone: v })); handleCustSearch(guestFields.guest_name, guestFields.guest_email, v) }}
                  onBlur={() => setTimeout(() => setCustomerQ(''), 200)}
                  placeholder="+44 7700 900000"
                />
                {/* Covers with ± buttons */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Covers</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setGuestFields(p => ({ ...p, covers: Math.max(1, Number(p.covers) - 1) }))}
                      className="w-9 h-9 rounded-lg border text-lg font-bold flex items-center justify-center hover:bg-accent active:bg-accent/80 touch-manipulation select-none"
                    >−</button>
                    <span className="w-12 text-center text-sm font-semibold">{guestFields.covers}</span>
                    <button
                      type="button"
                      onClick={() => setGuestFields(p => ({ ...p, covers: Math.min(99, Number(p.covers) + 1) }))}
                      className="w-9 h-9 rounded-lg border text-lg font-bold flex items-center justify-center hover:bg-accent active:bg-accent/80 touch-manipulation select-none"
                    >+</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <Row icon={Users}>{booking.covers} covers</Row>
                <Row icon={Mail}>{booking.guest_email}</Row>
                {booking.guest_phone && <Row icon={Phone}>{booking.guest_phone}</Row>}
                {booking.guest_notes && (
                  <div className="text-sm text-muted-foreground bg-muted rounded-lg p-3 mt-1">
                    {booking.guest_notes}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Table assignment ──────────────────────────── */}
          <Section
            title="Table assignment"
            action={
              <ActionButton
                icon={Pencil}
                onClick={() => setShowTablePicker(v => !v)}
                variant={showTablePicker ? 'cancel' : 'default'}
              >
                {showTablePicker ? 'Cancel' : 'Override'}
              </ActionButton>
            }
          >
            {!showTablePicker ? (
              <p className="text-sm font-medium">
                {booking.combination_name ?? booking.table_label ?? '—'}
              </p>
            ) : (
              <div className="space-y-3 mt-2">

                {warning && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{warning}</span>
                  </div>
                )}

                {tables.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Loading tables…</p>
                ) : (
                  <div className="space-y-1.5">
                    {tables.filter(t => t.is_active && !t.is_unallocated).map(t => {
                      const selected = pickedTableIds.has(t.id)
                      return (
                        <label
                          key={t.id}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 cursor-pointer text-sm transition-colors',
                            selected ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/50 hover:bg-muted',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary w-4 h-4 shrink-0"
                            checked={selected}
                            onChange={() => toggleTable(t.id)}
                          />
                          <span className="font-medium">{t.label}</span>
                          {t.section_name && (
                            <span className="text-xs text-muted-foreground">{t.section_name}</span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto shrink-0">
                            {t.min_covers}–{t.max_covers} cov
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}

                {pickedTableIds.size > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Combined capacity: up to {combinedMaxCovers} covers
                    {!warning && currentCovers <= combinedMaxCovers && (
                      <span className="text-green-700 ml-1">✓</span>
                    )}
                  </p>
                )}
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
                  className="mt-3 text-sm text-destructive underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {refundMutation.isPending ? 'Processing…' : 'Issue refund'}
                </button>
              )}
            </Section>
          )}

          {/* ── Operator notes ────────────────────────────── */}
          <Section
            title="Operator notes"
            action={
              !editingNotes
                ? <ActionButton icon={Pencil} onClick={() => setEditingNotes(true)}>
                    Edit
                  </ActionButton>
                : <ActionButton onClick={() => { setNotes(booking.operator_notes ?? ''); setEditingNotes(false) }} variant="cancel">
                    Cancel
                  </ActionButton>
            }
          >
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full text-sm border rounded-lg p-3 resize-none min-h-24"
                  placeholder="Internal notes…"
                  autoFocus
                />
                {notesMutation.isError && (
                  <p className="text-xs text-destructive">{notesMutation.error?.message ?? 'Failed to save'}</p>
                )}
              </div>
            ) : (
              <div
                onClick={() => setEditingNotes(true)}
                className="text-sm text-muted-foreground cursor-text min-h-10 hover:bg-muted rounded-lg p-2 -m-2"
              >
                {notes || <span className="italic">Tap to add notes…</span>}
              </div>
            )}
          </Section>

          {/* ── Delete booking ────────────────────────────── */}
          <div className="pt-2 border-t">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 touch-manipulation py-1"
              >
                <Trash2 className="w-4 h-4" />
                Delete booking
              </button>
            ) : (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                <p className="text-sm font-medium text-destructive">
                  Permanently delete this booking?
                </p>
                <p className="text-xs text-muted-foreground">
                  This cannot be undone. The booking record will be removed completely.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50 touch-manipulation"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleteMutation.isPending}
                    className="flex-1 py-2 rounded-lg border text-sm touch-manipulation"
                  >
                    Cancel
                  </button>
                </div>
                {deleteMutation.isError && (
                  <p className="text-xs text-destructive">{deleteMutation.error?.message ?? 'Delete failed'}</p>
                )}
              </div>
            )}
          </div>

        </div>

        {/* ── Customer match panel (absolutely positioned to the LEFT) ── */}
        {custSuggestions?.length > 0 && editingGuest && (
          <div className="absolute right-full top-14 w-64 bg-background rounded-xl shadow-2xl border z-50 overflow-hidden max-h-[60vh] mr-2">
            <p className="text-[10px] text-muted-foreground font-medium px-3 pt-2 pb-1 flex items-center gap-1">
              <UserSearch className="w-3 h-3" />Customer match
            </p>
            {custSuggestions.slice(0, 6).map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleCustomerSelect(c)}
                className="w-full text-left px-3 py-2 hover:bg-accent transition-colors touch-manipulation border-t border-border/40"
              >
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(' · ')}</p>
              </button>
            ))}
          </div>
        )}

      </div>
    </>
  )
}

// ── Sub-components ──────────────────────────────────────────────

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
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

// Dotted-border action button — larger tap target than a plain text link
function ActionButton({ icon: Icon, onClick, children, variant = 'default' }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-dashed transition-colors',
        variant === 'cancel'
          ? 'border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/60'
          : 'border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-foreground/40',
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      {children}
    </button>
  )
}

function GuestField({ label, value, onChange, onBlur, type = 'text', placeholder, inputClass = '' }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={cn(
          'w-full text-sm border rounded-lg px-3 py-2 outline-none focus:border-primary',
          inputClass
        )}
      />
    </div>
  )
}
