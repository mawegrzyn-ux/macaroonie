// src/components/bookings/BookingDrawer.jsx
// Redesigned booking detail panel.
//
// Layout (top to bottom):
//   Header : ref # · Cancel (when editing) · Save · ×
//   Guest  : name / email / phone — click anywhere to edit inline
//   Pills  : [Start date & time] → [End time]   (click to expand editor below)
//   Row    : − covers + · [Table ▾]             (covers triggers guest edit; table opens picker)
//   Notes  : guest note (read-only) · operator notes (click to edit)
//   Status : pill buttons
//   Payment: if applicable
//   Delete : destructive confirmation
//
// Touch-friendly: 48 px touch targets, touch-manipulation on every button.

import { useState, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  X, Users, Clock, CreditCard,
  TriangleAlert, Trash2, UserSearch, ChevronDown, Calendar,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'

// All statuses an operator can manually set.
// pending_payment is excluded — it is set by Stripe, not manually.
const SELECTABLE_STATUSES = [
  'unconfirmed', 'confirmed', 'reconfirmed', 'arrived',
  'seated', 'checked_out', 'no_show', 'cancelled',
]

const STATUS_DOT = {
  unconfirmed:     'bg-amber-500',
  confirmed:       'bg-blue-500',
  reconfirmed:     'bg-indigo-500',
  pending_payment: 'bg-yellow-500',
  arrived:         'bg-cyan-500',
  seated:          'bg-green-500',
  checked_out:     'bg-gray-400',
  cancelled:       'bg-red-500',
  no_show:         'bg-gray-400',
}

// editMode values:
//   null    — viewing
//   'guest' — editing name / email / phone / covers inline
//   'start' — editing start date + time
//   'end'   — editing end time only
//   'table' — picking table(s)
//   'notes' — editing operator notes

export default function BookingDrawer({ booking, onClose, onUpdated, panelMode = false, inlineMode = false }) {
  const api = useApi()

  const [editMode,      setEditMode]      = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // ── Guest fields ───────────────────────────────────────────
  const [guestFields, setGuestFields] = useState({
    guest_name:  booking.guest_name  ?? '',
    guest_email: booking.guest_email ?? '',
    guest_phone: booking.guest_phone ?? '',
    covers:      booking.covers      ?? 2,
  })

  // ── Operator notes ─────────────────────────────────────────
  const [notes, setNotes] = useState(booking.operator_notes ?? '')

  // ── Customer search ────────────────────────────────────────
  const [customerQ,    setCustomerQ]    = useState('')
  const customerQTimer                  = useRef(null)

  const { data: custSuggestions } = useQuery({
    queryKey: ['customers-search', customerQ],
    queryFn:  () => api.get(`/customers?q=${encodeURIComponent(customerQ)}&limit=6`),
    enabled:  editMode === 'guest' && customerQ.length >= 2,
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

  // ── Table picker ───────────────────────────────────────────
  const [pickedTableIds, setPickedTableIds] = useState(
    () => new Set(
      Array.isArray(booking.member_table_ids) && booking.member_table_ids.length > 0
        ? booking.member_table_ids.filter(Boolean)
        : booking.table_id ? [booking.table_id] : []
    )
  )

  // ── Start date / time ──────────────────────────────────────
  const [rescheduleDate, setRescheduleDate] = useState(() =>
    new Date(booking.starts_at).toISOString().slice(0, 10)
  )
  const [rescheduleTime, setRescheduleTime] = useState(() => {
    const d = new Date(booking.starts_at)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })

  // ── End time ───────────────────────────────────────────────
  const [endTimeValue, setEndTimeValue] = useState(() => {
    const d = new Date(booking.ends_at)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })

  // ── Venue rules — controls which statuses are shown ────────
  const { data: rules } = useQuery({
    queryKey: ['rules', booking.venue_id],
    queryFn:  () => api.get(`/venues/${booking.venue_id}/rules`),
  })

  const selectableStatuses = SELECTABLE_STATUSES.filter(s => {
    if (s === 'unconfirmed')  return (rules?.enable_unconfirmed_flow   ?? false) || booking.status === 'unconfirmed'
    if (s === 'reconfirmed')  return (rules?.enable_reconfirmed_status ?? false) || booking.status === 'reconfirmed'
    if (s === 'arrived')      return (rules?.enable_arrived_status     ?? true)  || booking.status === 'arrived'
    return true
  })

  // ── Tables for picker (lazy) ───────────────────────────────
  const { data: tables = [] } = useQuery({
    queryKey: ['tables', booking.venue_id],
    queryFn:  () => api.get(`/venues/${booking.venue_id}/tables`),
    enabled:  editMode === 'table',
  })

  const currentCovers      = Number(guestFields.covers ?? booking.covers)
  const combinedMaxCovers  = [...pickedTableIds].reduce((sum, id) => {
    const t = tables.find(x => x.id === id)
    return sum + (t?.max_covers ?? 0)
  }, 0)

  function capacityWarning() {
    if (editMode === 'table' && pickedTableIds.size > 0 && currentCovers > combinedMaxCovers) {
      return `Selected tables fit up to ${combinedMaxCovers} covers (booking has ${currentCovers})`
    }
    return null
  }

  function toggleTable(id) {
    setPickedTableIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Display helpers ────────────────────────────────────────
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }
  function fmtTime(iso) {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  // ── Mutations ──────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: (status) => api.patch(`/bookings/${booking.id}/status`, { status }),
    onSuccess:  onUpdated,
  })

  const notesMutation = useMutation({
    mutationFn: () => api.patch(`/bookings/${booking.id}/notes`, { operator_notes: notes }),
    onSuccess:  () => { setEditMode(null); onUpdated() },
  })

  const guestMutation = useMutation({
    mutationFn: (data) => api.patch(`/bookings/${booking.id}/guest`, data),
    onSuccess:  () => { setEditMode(null); onUpdated() },
  })

  const tablesMutation = useMutation({
    mutationFn: (data) => api.patch(`/bookings/${booking.id}/tables`, data),
    onSuccess:  () => { setEditMode(null); onUpdated() },
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
    onSuccess: () => { setEditMode(null); onUpdated() },
  })

  const durationMutation = useMutation({
    mutationFn: ({ endsAt }) => api.patch(`/bookings/${booking.id}/duration`, { ends_at: endsAt }),
    onSuccess:  () => { setEditMode(null); onUpdated() },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/bookings/${booking.id}`),
    onSuccess:  () => { onUpdated(); onClose() },
  })

  // ── Save handlers ──────────────────────────────────────────
  function handleGuestSave() {
    const payload = {}
    if (guestFields.guest_name  !== booking.guest_name)  payload.guest_name  = guestFields.guest_name
    if (guestFields.guest_email !== booking.guest_email) payload.guest_email = guestFields.guest_email
    if (guestFields.guest_phone !== (booking.guest_phone ?? ''))
      payload.guest_phone = guestFields.guest_phone || null
    if (Number(guestFields.covers) !== booking.covers)   payload.covers      = Number(guestFields.covers)
    if (!Object.keys(payload).length) { setEditMode(null); return }
    guestMutation.mutate(payload)
  }

  function handleStartSave() {
    const local = new Date(`${rescheduleDate}T${rescheduleTime}:00`)
    if (isNaN(local.getTime())) return
    moveMutation.mutate({ startsAt: local.toISOString() })
  }

  function handleEndSave() {
    const startDate = new Date(booking.starts_at).toISOString().slice(0, 10)
    let local       = new Date(`${startDate}T${endTimeValue}:00`)
    if (isNaN(local.getTime())) return
    if (local <= new Date(booking.starts_at)) local = new Date(local.getTime() + 24 * 60 * 60_000)
    durationMutation.mutate({ endsAt: local.toISOString() })
  }

  function handleTableSave() {
    if (pickedTableIds.size === 0) return
    tablesMutation.mutate({ table_ids: [...pickedTableIds] })
  }

  // ── Header save action ─────────────────────────────────────
  const headerAction = (() => {
    if (editMode === 'notes') return {
      label:    notesMutation.isPending    ? 'Saving…'  : 'Save notes',
      onClick:  () => notesMutation.mutate(),
      disabled: notesMutation.isPending,
    }
    if (editMode === 'guest') return {
      label:    guestMutation.isPending    ? 'Saving…'  : 'Save details',
      onClick:  handleGuestSave,
      disabled: guestMutation.isPending,
    }
    if (editMode === 'table') return {
      label:    tablesMutation.isPending   ? 'Saving…'  : 'Assign table',
      onClick:  handleTableSave,
      disabled: tablesMutation.isPending || pickedTableIds.size === 0,
    }
    if (editMode === 'start') return {
      label:    moveMutation.isPending     ? 'Moving…'  : 'Move booking',
      onClick:  handleStartSave,
      disabled: moveMutation.isPending,
    }
    if (editMode === 'end') return {
      label:    durationMutation.isPending ? 'Saving…'  : 'Save end time',
      onClick:  handleEndSave,
      disabled: durationMutation.isPending,
    }
    return null
  })()

  function cancelEdit() {
    setEditMode(null)
    setGuestFields({
      guest_name:  booking.guest_name  ?? '',
      guest_email: booking.guest_email ?? '',
      guest_phone: booking.guest_phone ?? '',
      covers:      booking.covers      ?? 2,
    })
    setNotes(booking.operator_notes ?? '')
    setCustomerQ('')
    const s = new Date(booking.starts_at)
    setRescheduleDate(s.toISOString().slice(0, 10))
    setRescheduleTime(`${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`)
    const e = new Date(booking.ends_at)
    setEndTimeValue(`${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`)
  }

  return (
    <>
      {/* Backdrop — overlay mode only */}
      {!panelMode && !inlineMode && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      )}

      <div className={cn(
        'relative bg-background border-l flex flex-col overflow-hidden',
        inlineMode
          ? 'w-[420px] shrink-0 h-full'
          : 'fixed right-0 top-0 bottom-0 w-full sm:w-[420px]',
        !inlineMode && (panelMode ? 'z-30' : 'z-50 shadow-xl'),
      )}>

        {/* ── Header ───────────────────────────────────────── */}
        <div className="flex items-center px-4 h-14 border-b shrink-0 gap-2">
          <p className="text-xs font-mono text-muted-foreground shrink-0 mr-auto">
            #{booking.reference}
          </p>
          {editMode && (
            <>
              <button
                onClick={cancelEdit}
                className="text-sm px-3 py-1.5 rounded-lg border text-muted-foreground touch-manipulation"
              >
                Cancel
              </button>
              {headerAction && (
                <button
                  onClick={headerAction.onClick}
                  disabled={headerAction.disabled}
                  className="text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 whitespace-nowrap touch-manipulation"
                >
                  {headerAction.label}
                </button>
              )}
            </>
          )}
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent touch-manipulation">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Guest block — click to edit ───────────────── */}
          <div
            className={cn(
              'px-5 py-4 border-b transition-colors',
              editMode === 'guest'
                ? 'bg-muted/20'
                : 'cursor-pointer hover:bg-muted/30',
            )}
            onClick={() => editMode === null && setEditMode('guest')}
          >
            {editMode === 'guest' ? (
              <div className="space-y-3" onClick={e => e.stopPropagation()}>
                <InlineInput
                  label="Name"
                  value={guestFields.guest_name}
                  autoFocus
                  onChange={v => {
                    setGuestFields(p => ({ ...p, guest_name: v }))
                    handleCustSearch(v, guestFields.guest_email, guestFields.guest_phone)
                  }}
                  onBlur={() => setTimeout(() => setCustomerQ(''), 200)}
                />
                <InlineInput
                  label="Email"
                  type="email"
                  value={guestFields.guest_email}
                  onChange={v => {
                    setGuestFields(p => ({ ...p, guest_email: v }))
                    handleCustSearch(guestFields.guest_name, v, guestFields.guest_phone)
                  }}
                  onBlur={() => setTimeout(() => setCustomerQ(''), 200)}
                />
                <InlineInput
                  label="Phone"
                  type="tel"
                  value={guestFields.guest_phone}
                  placeholder="+44 7700 900000"
                  onChange={v => {
                    setGuestFields(p => ({ ...p, guest_phone: v }))
                    handleCustSearch(guestFields.guest_name, guestFields.guest_email, v)
                  }}
                  onBlur={() => setTimeout(() => setCustomerQ(''), 200)}
                />
                {guestMutation.isError && (
                  <p className="text-xs text-destructive">
                    {guestMutation.error?.message ?? 'Failed to save'}
                  </p>
                )}
              </div>
            ) : (
              <>
                <p className="font-semibold text-base leading-tight">{booking.guest_name}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{booking.guest_email}</p>
                {booking.guest_phone && (
                  <p className="text-sm text-muted-foreground">{booking.guest_phone}</p>
                )}
              </>
            )}
          </div>

          <div className="px-5 py-4 space-y-5">

            {/* ── Start / End pill row ──────────────────────── */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Start pill */}
                <button
                  onClick={() => setEditMode(m => m === 'start' ? null : 'start')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-full text-sm border transition-colors touch-manipulation',
                    editMode === 'start'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50',
                  )}
                >
                  <Calendar className="w-3.5 h-3.5 shrink-0" />
                  {fmtDate(booking.starts_at)}, {fmtTime(booking.starts_at)}
                </button>
                <span className="text-muted-foreground text-sm select-none">→</span>
                {/* End pill */}
                <button
                  onClick={() => setEditMode(m => m === 'end' ? null : 'end')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-full text-sm border transition-colors touch-manipulation',
                    editMode === 'end'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50',
                  )}
                >
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  {fmtTime(booking.ends_at)}
                </button>
              </div>

              {/* Start editor */}
              {editMode === 'start' && (
                <div className="flex gap-3 pt-1">
                  <div className="flex-1">
                    <label className="text-[11px] text-muted-foreground block mb-1">Date</label>
                    <input
                      type="date"
                      value={rescheduleDate}
                      onChange={e => setRescheduleDate(e.target.value)}
                      onClick={e => { try { e.target.showPicker() } catch (_) {} }}
                      className="w-full text-sm border rounded-lg px-3 py-2 outline-none focus:border-primary touch-manipulation"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Time</label>
                    <input
                      type="time"
                      step="900"
                      value={rescheduleTime}
                      onChange={e => setRescheduleTime(e.target.value)}
                      className="text-sm border rounded-lg px-3 py-2 outline-none focus:border-primary touch-manipulation"
                    />
                  </div>
                  {moveMutation.isError && (
                    <p className="text-xs text-destructive self-end pb-2.5">
                      {moveMutation.error?.message ?? 'Failed to move'}
                    </p>
                  )}
                </div>
              )}

              {/* End editor */}
              {editMode === 'end' && (
                <div className="flex items-end gap-3 pt-1">
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">End time</label>
                    <input
                      type="time"
                      step="900"
                      value={endTimeValue}
                      min={rescheduleTime}
                      onChange={e => setEndTimeValue(e.target.value)}
                      className="text-sm border rounded-lg px-3 py-2 outline-none focus:border-primary touch-manipulation"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground pb-2.5">
                    Starts: {fmtTime(booking.starts_at)}
                  </p>
                  {durationMutation.isError && (
                    <p className="text-xs text-destructive pb-2.5">
                      {durationMutation.error?.message ?? 'Failed to update'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Covers stepper + Table pill ───────────────── */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Covers stepper */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setGuestFields(p => ({ ...p, covers: Math.max(1, Number(p.covers) - 1) }))
                    setEditMode('guest')
                  }}
                  className="w-10 h-10 rounded-lg border text-lg font-bold flex items-center justify-center hover:bg-accent active:bg-accent/80 touch-manipulation select-none"
                >−</button>
                <div className="flex items-center gap-1.5 text-sm min-w-0">
                  <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-semibold w-6 text-center tabular-nums">{guestFields.covers}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGuestFields(p => ({ ...p, covers: Math.min(99, Number(p.covers) + 1) }))
                    setEditMode('guest')
                  }}
                  className="w-10 h-10 rounded-lg border text-lg font-bold flex items-center justify-center hover:bg-accent active:bg-accent/80 touch-manipulation select-none"
                >+</button>
              </div>

              {/* Table pill */}
              <button
                onClick={() => setEditMode(m => m === 'table' ? null : 'table')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-full text-sm border transition-colors touch-manipulation',
                  editMode === 'table'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50',
                )}
              >
                {booking.combination_name ?? booking.table_label ?? '—'}
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>

            {/* Table picker */}
            {editMode === 'table' && (
              <div className="space-y-2">
                {capacityWarning() && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{capacityWarning()}</span>
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
                            selected
                              ? 'border-primary bg-primary/5'
                              : 'border-transparent bg-muted/50 hover:bg-muted',
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
                    Combined: up to {combinedMaxCovers} covers
                    {!capacityWarning() && <span className="text-green-700 ml-1">✓</span>}
                  </p>
                )}
                {tablesMutation.isError && (
                  <p className="text-xs text-destructive">
                    {tablesMutation.error?.message ?? 'Failed to assign table'}
                  </p>
                )}
              </div>
            )}

            {/* ── Guest note (read-only, from widget) ──────── */}
            {booking.guest_notes && (
              <div className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide mb-1">Guest note</p>
                {booking.guest_notes}
              </div>
            )}

            {/* ── Operator notes ────────────────────────────── */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes</p>
              {editMode === 'notes' ? (
                <div className="space-y-2">
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full text-sm border rounded-lg p-3 resize-none min-h-24 outline-none focus:border-primary"
                    placeholder="Internal notes…"
                    autoFocus
                  />
                  {notesMutation.isError && (
                    <p className="text-xs text-destructive">
                      {notesMutation.error?.message ?? 'Failed to save'}
                    </p>
                  )}
                </div>
              ) : (
                <div
                  onClick={() => setEditMode('notes')}
                  className="text-sm text-muted-foreground cursor-text min-h-10 hover:bg-muted rounded-lg p-2 -mx-2 transition-colors"
                >
                  {notes || <span className="italic">Tap to add notes…</span>}
                </div>
              )}
            </div>

            {/* ── Status buttons ────────────────────────────── */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Status</p>
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
            </div>

            {/* ── Payment ───────────────────────────────────── */}
            {booking.payment_id && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payment</p>
                <div className="flex items-center gap-2 text-sm">
                  <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>
                    {booking.payment_amount} {booking.payment_currency ?? ''} ·{' '}
                    <span className={cn('font-medium',
                      booking.payment_status === 'succeeded' ? 'text-green-700' : 'text-yellow-700')}>
                      {booking.payment_status}
                    </span>
                  </span>
                </div>
                {booking.payment_status === 'succeeded' && (
                  <button
                    onClick={() => refundMutation.mutate()}
                    disabled={refundMutation.isPending}
                    className="mt-2 text-sm text-destructive underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {refundMutation.isPending ? 'Processing…' : 'Issue refund'}
                  </button>
                )}
              </div>
            )}

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
                    <p className="text-xs text-destructive">
                      {deleteMutation.error?.message ?? 'Delete failed'}
                    </p>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── Customer suggestion panel (floats left) ────── */}
        {custSuggestions?.length > 0 && editMode === 'guest' && (
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

// ── Sub-components ───────────────────────────────────────────────

function InlineInput({ label, value, onChange, onBlur, type = 'text', placeholder, autoFocus = false }) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground block mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full text-sm bg-transparent border-b border-border pb-1 outline-none focus:border-primary transition-colors"
      />
    </div>
  )
}
