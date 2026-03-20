// src/components/bookings/NewBookingModal.jsx
// Admin creates a booking on behalf of a guest.
// Flow: pick table + slot → fill guest details → confirm (bypasses payment for admin)

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, ChevronRight } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime } from '@/lib/utils'

const GuestSchema = z.object({
  guest_name:  z.string().min(1, 'Required'),
  guest_email: z.string().email('Valid email required'),
  guest_phone: z.string().optional(),
  guest_notes: z.string().optional(),
  covers:      z.coerce.number().int().min(1),
})

export default function NewBookingModal({ venueId, date, onClose, onCreated }) {
  const api = useApi()
  const [step,          setStep]    = useState('slot')
  const [tableId,       setTableId] = useState(null)
  const [combinationId, setComboId] = useState(null)
  const [selectedSlot,  setSlot]    = useState(null)
  const [covers,        setCovers]  = useState(2)
  const [holdData,      setHoldData] = useState(null)

  function selectTable(id) { setTableId(id); setComboId(null) }
  function selectCombo(id)  { setComboId(id); setTableId(null) }

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(GuestSchema),
    defaultValues: { covers: 2 },
  })

  // Fetch tables + combinations
  const { data: tables = [] } = useQuery({
    queryKey: ['tables', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/tables`),
    enabled:  !!venueId,
  })

  const { data: combinations = [] } = useQuery({
    queryKey: ['combinations', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/combinations`),
    enabled:  !!venueId,
  })

  // Fetch available slots
  const { data: slotsRes, isLoading: loadingSlots } = useQuery({
    queryKey: ['slots', venueId, date, covers],
    queryFn:  () => api.get(`/venues/${venueId}/slots?date=${date}&covers=${covers}`),
    enabled:  !!venueId && step === 'slot',
  })

  const availableSlots = slotsRes?.slots?.filter(s => s.available) ?? []

  // Create hold
  const holdMutation = useMutation({
    mutationFn: (data) => api.post('/bookings/holds', data),
    onSuccess: (hold) => { setHoldData(hold); setStep('guest') },
  })

  // Confirm booking — send full guest details so the booking record is correct
  const confirmMutation = useMutation({
    mutationFn: (guestData) => api.post('/bookings', {
      hold_id:     holdData.id,
      guest_name:  guestData.guest_name,
      guest_email: guestData.guest_email,
      guest_phone: guestData.guest_phone ?? null,
      covers:      guestData.covers,
      guest_notes: guestData.guest_notes ?? null,
    }),
    onSuccess: onCreated,
  })

  function handleSlotConfirm() {
    if ((!tableId && !combinationId) || !selectedSlot) return
    holdMutation.mutate({
      venue_id:       venueId,
      ...(tableId       ? { table_id: tableId }           : {}),
      ...(combinationId ? { combination_id: combinationId } : {}),
      starts_at:   selectedSlot.slot_time,
      covers,
      guest_name:  'TBC',
      guest_email: 'tbc@placeholder.com',
    })
  }

  function onGuestSubmit(data) {
    confirmMutation.mutate(data)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-background rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
            <div>
              <p className="font-semibold">New booking</p>
              <p className="text-xs text-muted-foreground">{date}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-accent">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1 px-5 py-3 text-xs border-b shrink-0">
            {['slot', 'guest'].map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className={cn('font-medium', step === s ? 'text-primary' : 'text-muted-foreground')}>
                  {s === 'slot' ? 'Select slot' : 'Guest details'}
                </span>
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-5">

            {/* ── Step 1: Slot selection ─────────────────── */}
            {step === 'slot' && (
              <div className="space-y-4">
                {/* Covers */}
                <div>
                  <label className="text-sm font-medium block mb-1.5">Covers</label>
                  <div className="flex gap-2">
                    {[1,2,3,4,5,6,7,8].map(n => (
                      <button
                        key={n}
                        onClick={() => setCovers(n)}
                        className={cn(
                          'w-9 h-9 rounded-full text-sm font-medium border transition-colors',
                          covers === n
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'hover:bg-accent'
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table / Combination */}
                <div>
                  <label className="text-sm font-medium block mb-1.5">Table</label>
                  <div className="grid grid-cols-3 gap-2">
                    {tables.filter(t => t.is_active && t.max_covers >= covers).map(t => (
                      <button
                        key={t.id}
                        onClick={() => selectTable(t.id)}
                        className={cn(
                          'text-sm p-2 rounded-lg border text-left transition-colors',
                          tableId === t.id
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'hover:bg-accent'
                        )}
                      >
                        <p className="font-medium">{t.label}</p>
                        <p className="text-xs text-muted-foreground">{t.min_covers}–{t.max_covers}</p>
                      </button>
                    ))}
                    {combinations.filter(c => c.is_active && c.max_covers >= covers).map(c => (
                      <button
                        key={c.id}
                        onClick={() => selectCombo(c.id)}
                        className={cn(
                          'text-sm p-2 rounded-lg border text-left transition-colors',
                          combinationId === c.id
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'hover:bg-accent'
                        )}
                      >
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.min_covers}–{c.max_covers} · combo</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Slots */}
                <div>
                  <label className="text-sm font-medium block mb-1.5">Time slot</label>
                  {loadingSlots ? (
                    <p className="text-sm text-muted-foreground">Loading slots…</p>
                  ) : availableSlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No available slots for {covers} covers on this date.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {availableSlots.map(slot => (
                        <button
                          key={slot.slot_time}
                          onClick={() => setSlot(slot)}
                          className={cn(
                            'text-sm py-2 rounded-lg border text-center font-medium transition-colors',
                            selectedSlot?.slot_time === slot.slot_time
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'hover:bg-accent'
                          )}
                        >
                          {formatTime(slot.slot_time)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 2: Guest details ──────────────────── */}
            {step === 'guest' && (
              <form id="guest-form" onSubmit={handleSubmit(onGuestSubmit)} className="space-y-4">
                <Field label="Full name" error={errors.guest_name?.message}>
                  <input {...register('guest_name')} className="input" placeholder="Jane Smith" />
                </Field>
                <Field label="Email" error={errors.guest_email?.message}>
                  <input {...register('guest_email')} type="email" className="input" placeholder="jane@example.com" />
                </Field>
                <Field label="Phone" error={errors.guest_phone?.message}>
                  <input {...register('guest_phone')} className="input" placeholder="+44 7700 900000" />
                </Field>
                <Field label="Covers">
                  <input {...register('covers')} type="number" min={1} className="input w-24" />
                </Field>
                <Field label="Guest notes (optional)">
                  <textarea {...register('guest_notes')} className="input min-h-20 resize-none"
                    placeholder="Dietary requirements, celebration, accessibility needs…" />
                </Field>
              </form>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t shrink-0">
            <button onClick={onClose} className="text-sm px-4 py-2 border rounded-lg hover:bg-accent">
              Cancel
            </button>
            {step === 'slot' && (
              <button
                onClick={handleSlotConfirm}
                disabled={(!tableId && !combinationId) || !selectedSlot || holdMutation.isPending}
                className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40"
              >
                {holdMutation.isPending ? 'Holding…' : 'Continue'}
              </button>
            )}
            {step === 'guest' && (
              <button
                type="submit"
                form="guest-form"
                disabled={confirmMutation.isPending}
                className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40"
              >
                {confirmMutation.isPending ? 'Confirming…' : 'Confirm booking'}
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`.input { width: 100%; border: 1px solid hsl(var(--border)); border-radius: 0.5rem; padding: 0.5rem 0.625rem; font-size: 0.875rem; outline: none; } .input:focus { border-color: hsl(var(--primary)); }`}</style>
    </>
  )
}

function Field({ label, error, children }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}
