// src/components/bookings/BookingDrawer.jsx
// Slide-in panel showing full booking detail.
// Allows: status change, notes edit, refund trigger.

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { X, Mail, Phone, Users, Clock, CreditCard, StickyNote } from 'lucide-react'
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
  const [notes, setNotes] = useState(booking.operator_notes ?? '')
  const [editingNotes, setEditingNotes] = useState(false)

  const statusMutation = useMutation({
    mutationFn: (status) => api.patch(`/bookings/${booking.id}/status`, { status }),
    onSuccess:  onUpdated,
  })

  const notesMutation = useMutation({
    mutationFn: () => api.patch(`/bookings/${booking.id}/notes`, { operator_notes: notes }),
    onSuccess:  () => { setEditingNotes(false); onUpdated() },
  })

  const refundMutation = useMutation({
    mutationFn: () => api.post(`/payments/${booking.payment_id}/refund`, {}),
    onSuccess:  onUpdated,
  })

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

          {/* Booking details */}
          <div className="space-y-2.5">
            <Row icon={Clock}>
              {formatDateTime(booking.starts_at)} → {formatDateTime(booking.ends_at)}
            </Row>
            <Row icon={Users}>
              {booking.covers} covers · {booking.venue_name} / {booking.table_label}
            </Row>
            <Row icon={Mail}>{booking.guest_email}</Row>
            {booking.guest_phone && <Row icon={Phone}>{booking.guest_phone}</Row>}
            {booking.guest_notes && (
              <div className="text-sm text-muted-foreground bg-muted rounded p-2">
                {booking.guest_notes}
              </div>
            )}
          </div>

          {/* Payment */}
          {booking.payment_id && (
            <Section title="Payment">
              <Row icon={CreditCard}>
                {booking.payment_amount} {booking.payment_currency ?? ''} · {' '}
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

          {/* Operator notes */}
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
                  >
                    Cancel
                  </button>
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
                    s === 'cancelled'  && 'border-destructive text-destructive hover:bg-destructive/10',
                    s === 'completed'  && 'border-green-600 text-green-700 hover:bg-green-50',
                    s === 'no_show'    && 'border-gray-400 text-gray-600 hover:bg-gray-50',
                    s === 'confirmed'  && 'border-blue-500 text-blue-700 hover:bg-blue-50',
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

function Row({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  )
}
