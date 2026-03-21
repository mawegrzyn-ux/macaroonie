// src/components/bookings/NewBookingModal.jsx
// Admin creates a booking on behalf of a guest.
// Flow: pick table + slot → fill guest details → confirm (bypasses payment for admin)
//
// Touch-optimised:
//  A1. Date rendered as a prominent button (overlay trick) — taps open OS date picker
//  A2. Covers buttons are 48px (finger-sized) with `touch-manipulation`
//  A3. Phone field uses type="tel" / inputMode="tel" for numeric keypad on tablets
//  A4. Covers in guest form: +/− stepper; tapping the value shows a custom numeric
//      keypad popup (touch devices only, inputMode="none" suppresses native keyboard)

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, ChevronRight, Calendar } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime } from '@/lib/utils'

// Detect touch-capable device (tablet / phone) once at module load.
// navigator.maxTouchPoints > 0 is true on every iOS/Android device.
const IS_TOUCH = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

const GuestSchema = z.object({
  guest_name:  z.string().min(1, 'Required'),
  guest_email: z.string().email('Valid email required').or(z.literal('')).optional(),
  guest_phone: z.string().optional(),
  guest_notes: z.string().optional(),
  covers:      z.coerce.number().int().min(1),
})

export default function NewBookingModal({ venueId, date: initialDate, prefillTime = null, prefillTableId = null, onClose, onCreated }) {
  const api = useApi()
  const [step,          setStep]       = useState('slot')
  const [bookingDate,   setBookingDate] = useState(initialDate)
  const [tableId,       setTableId]   = useState(null)
  const [combinationId, setComboId]   = useState(null)
  const [selectedSlot,  setSlot]      = useState(null)
  const [covers,        setCovers]    = useState(2)
  const [holdData,      setHoldData]  = useState(null)
  // Manual allocation state — set when admin bypasses the slot resolver
  const [manualAlloc,     setManualAlloc]     = useState(null)  // { date, time, tableIds, unallocated }
  const [showManualAlloc, setShowManualAlloc] = useState(false)

  function selectTable(id) { setTableId(id); setComboId(null) }
  function selectCombo(id)  { setComboId(id); setTableId(null) }

  // When the operator picks a different date, clear any selected slot so
  // the slot list refreshes for the new date.
  function handleDateChange(newDate) {
    setBookingDate(newDate)
    setSlot(null)
    autoSelectedRef.current = false
  }

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(GuestSchema),
    defaultValues: { covers },
  })
  const formCovers = watch('covers') ?? covers

  // Sync covers into guest form whenever step changes to 'guest'
  useEffect(() => {
    if (step === 'guest') reset(v => ({ ...v, covers }))
  }, [step])

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
  // IMPORTANT: this must be declared BEFORE the auto-select useEffect below,
  // because the dep array [availableSlots, …] is evaluated during render and
  // referencing a const before its declaration is a TDZ error.
  const { data: slotsRes, isLoading: loadingSlots } = useQuery({
    queryKey: ['slots', venueId, bookingDate, covers],
    queryFn:  () => api.get(`/venues/${venueId}/slots?date=${bookingDate}&covers=${covers}`),
    enabled:  !!venueId && step === 'slot',
  })

  const availableSlots = slotsRes?.slots?.filter(s => s.available) ?? []

  // Auto-select the slot matching prefillTime when slots arrive (canvas click flow)
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (!prefillTime || autoSelectedRef.current || !availableSlots.length || selectedSlot) return
    const match = availableSlots.find(s => {
      const d = new Date(s.slot_time)
      const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      return t === prefillTime
    })
    if (match) {
      autoSelectedRef.current = true
      setSlot(match)
    }
  }, [availableSlots, prefillTime, selectedSlot])

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
    // Pass bookingDate back so the Timeline can navigate to it if it differs
    onSuccess: () => onCreated(bookingDate),
  })

  // Admin override — bypasses slot resolver, capacity, and booking window checks.
  const confirmOverrideMutation = useMutation({
    mutationFn: (guestData) => api.post('/bookings/admin-override', {
      venue_id:    venueId,
      starts_at:   `${manualAlloc.date}T${manualAlloc.time}:00`,
      covers:      guestData.covers,
      table_ids:   manualAlloc.tableIds,
      guest_name:  guestData.guest_name,
      guest_email: guestData.guest_email,
      guest_phone: guestData.guest_phone ?? null,
      guest_notes: guestData.guest_notes ?? null,
    }),
    onSuccess: () => onCreated(manualAlloc.date),
  })

  function handleSlotConfirm() {
    if (!selectedSlot) return
    // Use the table/combination the slot resolver already assigned
    const assignedTableId = selectedSlot.table_id ?? null
    const assignedComboId = selectedSlot.combination_id ?? null
    if (!assignedTableId && !assignedComboId) return
    holdMutation.mutate({
      venue_id:       venueId,
      ...(assignedTableId ? { table_id: assignedTableId }           : {}),
      ...(assignedComboId ? { combination_id: assignedComboId }     : {}),
      starts_at:   selectedSlot.slot_time,
      covers,
      guest_name:  'TBC',
      guest_email: 'tbc@placeholder.com',
    })
  }

  function onGuestSubmit(data) {
    if (manualAlloc) {
      confirmOverrideMutation.mutate(data)
    } else {
      confirmMutation.mutate(data)
    }
  }

  // Walk-in: skip all guest details, book immediately as "Walk In"
  function handleWalkIn() {
    const walkInData = { guest_name: 'Walk In', guest_email: '', covers, guest_notes: '' }
    if (manualAlloc) {
      confirmOverrideMutation.mutate(walkInData)
    } else {
      confirmMutation.mutate(walkInData)
    }
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

              {/* A1: Date as a prominent, finger-sized button.
                  An invisible <input type="date"> overlays the styled label so the
                  OS date picker opens on tap (iOS/Android) and on desktop click. */}
              <label className="relative mt-1 inline-flex items-center gap-2 px-3 py-2
                rounded-lg border border-border hover:bg-accent transition-colors cursor-pointer">
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium">{bookingDate}</span>
                <input
                  type="date"
                  value={bookingDate}
                  onChange={e => handleDateChange(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
            </div>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-accent">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1 px-5 py-3 text-xs border-b shrink-0">
            <span className={cn('font-medium', step === 'slot' ? 'text-primary' : 'text-muted-foreground')}>
              {manualAlloc ? 'Manual allocation' : 'Select slot'}
            </span>
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
            <span className={cn('font-medium', step === 'guest' ? 'text-primary' : 'text-muted-foreground')}>
              Guest details
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-5">

            {/* ── Step 1: Slot selection ─────────────────── */}
            {step === 'slot' && (
              <div className="space-y-4">

                {/* Prefill hint when opened via canvas click */}
                {prefillTime && (
                  <div className="flex items-center gap-2 text-xs text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                    <span className="font-medium">Clicked time:</span>
                    <span className="font-mono">{prefillTime}</span>
                    {!selectedSlot && (
                      <span className="text-muted-foreground ml-auto italic">
                        {availableSlots.some(s => {
                          const d = new Date(s.slot_time)
                          return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` === prefillTime
                        }) ? 'Auto-selected ↓' : 'No slot at this time'}
                      </span>
                    )}
                  </div>
                )}

                {/* A2: Covers — 48px (finger-sized) circular buttons */}
                <div>
                  <label className="text-sm font-medium block mb-2">Covers</label>
                  <div className="flex gap-2 flex-wrap">
                    {[1,2,3,4,5,6,7,8].map(n => (
                      <button
                        key={n}
                        onClick={() => setCovers(n)}
                        className={cn(
                          'w-12 h-12 rounded-full text-base font-medium border transition-colors touch-manipulation',
                          covers === n
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'hover:bg-accent active:bg-accent/70'
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Slots — table is auto-assigned by the slot resolver */}
                <div>
                  <label className="text-sm font-medium block mb-1.5">Time slot</label>
                  {loadingSlots ? (
                    <p className="text-sm text-muted-foreground">Loading slots…</p>
                  ) : availableSlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No available slots for {covers} covers on this date.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {availableSlots.map(slot => {
                        const label = slot.combination_id
                          ? (combinations.find(c => c.id === slot.combination_id)?.name ?? 'combo')
                          : (tables.find(t => t.id === slot.table_id)?.label ?? '')
                        return (
                          <button
                            key={slot.slot_time}
                            onClick={() => setSlot(slot)}
                            title={label ? `Table: ${label}` : undefined}
                            className={cn(
                              'text-sm py-2 px-1 rounded-lg border text-center transition-colors touch-manipulation',
                              selectedSlot?.slot_time === slot.slot_time
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'hover:bg-accent active:bg-accent/70'
                            )}
                          >
                            <p className="font-medium">{formatTime(slot.slot_time)}</p>
                            {label && <p className="text-[10px] opacity-70 leading-tight">{label}</p>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {selectedSlot && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Table:{' '}
                      <span className="font-medium text-foreground">
                        {selectedSlot.combination_id
                          ? (combinations.find(c => c.id === selectedSlot.combination_id)?.name ?? 'combo')
                          : (tables.find(t => t.id === selectedSlot.table_id)?.label ?? '—')}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 2: Guest details ──────────────────── */}
            {step === 'guest' && (
              <form id="guest-form" onSubmit={handleSubmit(onGuestSubmit)} className="space-y-4">
                <Field label="Full name" error={errors.guest_name?.message}>
                  <input {...register('guest_name')} className="input" placeholder="Jane Smith" autoFocus />
                </Field>
                <Field label="Email" error={errors.guest_email?.message}>
                  <input {...register('guest_email')} type="email" inputMode="email" className="input" placeholder="jane@example.com" />
                </Field>

                {/* A3: Phone — type="tel" triggers numeric keypad on iOS/Android */}
                <Field label="Phone" error={errors.guest_phone?.message}>
                  <input
                    {...register('guest_phone')}
                    type="tel"
                    inputMode="tel"
                    className="input"
                    placeholder="+44 7700 900000"
                  />
                </Field>

                {/* A4: Covers stepper — +/− buttons flanking a tappable value.
                    On touch devices the value opens a custom numeric keypad
                    (inputMode="none" inside CoversInput suppresses the native keyboard). */}
                <Field label="Covers" error={errors.covers?.message}>
                  <CoversInput
                    value={Number(formCovers) || 1}
                    onChange={v => setValue('covers', v, { shouldValidate: true })}
                  />
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
            {step === 'guest' ? (
              // Guest step: Back + Walk In + Confirm
              <>
                <button
                  onClick={() => { setStep('slot'); setManualAlloc(null); setHoldData(null) }}
                  className="text-sm px-4 py-2 border rounded-lg hover:bg-accent touch-manipulation"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleWalkIn}
                  disabled={confirmMutation.isPending || confirmOverrideMutation.isPending}
                  className="text-sm px-4 py-2 border border-green-500 text-green-700 bg-green-50 hover:bg-green-100 rounded-lg disabled:opacity-40 touch-manipulation"
                >
                  Walk In
                </button>
                <button
                  type="submit"
                  form="guest-form"
                  disabled={confirmMutation.isPending || confirmOverrideMutation.isPending}
                  className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 touch-manipulation"
                >
                  {(confirmMutation.isPending || confirmOverrideMutation.isPending) ? 'Confirming…' : 'Confirm booking'}
                </button>
              </>
            ) : (
              // Slot step: Cancel + Manual allocation + Continue
              <>
                <button onClick={onClose} className="text-sm px-4 py-2 border rounded-lg hover:bg-accent touch-manipulation">
                  Cancel
                </button>
                <button
                  onClick={() => setShowManualAlloc(true)}
                  className="text-sm px-4 py-2 border border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg touch-manipulation"
                >
                  Manual allocation
                </button>
                <button
                  onClick={handleSlotConfirm}
                  disabled={!selectedSlot || (!selectedSlot?.table_id && !selectedSlot?.combination_id) || holdMutation.isPending}
                  className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 touch-manipulation"
                >
                  {holdMutation.isPending ? 'Holding…' : 'Continue'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`.input { width: 100%; border: 1px solid hsl(var(--border)); border-radius: 0.5rem; padding: 0.5rem 0.625rem; font-size: 0.875rem; outline: none; background: hsl(var(--background)); } .input:focus { border-color: hsl(var(--primary)); }`}</style>

      {/* Manual allocation modal — sits above the booking modal (z-[60]) */}
      {showManualAlloc && (
        <ManualAllocModal
          venueId={venueId}
          initialDate={bookingDate}
          initialTime={selectedSlot ? (() => { const d = new Date(selectedSlot.slot_time); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` })() : prefillTime ?? '12:00'}
          covers={covers}
          tables={tables}
          api={api}
          onClose={() => setShowManualAlloc(false)}
          onConfirm={(alloc) => {
            setManualAlloc(alloc)
            setShowManualAlloc(false)
            setStep('guest')
          }}
        />
      )}
    </>
  )
}

// ── Covers stepper (+/− with custom keypad on touch) ──────────
function CoversInput({ value, onChange }) {
  const [showKeypad, setShowKeypad] = useState(false)

  return (
    <div className="relative inline-block">
      <div className="flex items-center gap-3">
        {/* Decrement */}
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          className="w-12 h-12 rounded-full border text-2xl font-light flex items-center justify-center
            hover:bg-accent active:bg-accent/70 touch-manipulation select-none transition-colors"
        >
          −
        </button>

        {/* Value — tap to open keypad on touch devices; plain input on desktop */}
        {IS_TOUCH ? (
          <button
            type="button"
            onClick={() => setShowKeypad(true)}
            className="w-16 h-12 rounded-lg border text-xl font-semibold flex items-center justify-center
              bg-background hover:bg-accent touch-manipulation transition-colors"
          >
            {value}
          </button>
        ) : (
          <input
            type="number"
            value={value}
            onChange={e => {
              const n = parseInt(e.target.value, 10)
              if (!isNaN(n) && n >= 1 && n <= 99) onChange(n)
            }}
            className="w-16 h-12 rounded-lg border text-xl font-semibold text-center bg-background
              focus:outline-none focus:border-primary"
            min={1}
            max={99}
          />
        )}

        {/* Increment */}
        <button
          type="button"
          onClick={() => onChange(Math.min(99, value + 1))}
          className="w-12 h-12 rounded-full border text-2xl font-light flex items-center justify-center
            hover:bg-accent active:bg-accent/70 touch-manipulation select-none transition-colors"
        >
          +
        </button>
      </div>

      {/* Custom numeric keypad popup (touch only) */}
      {showKeypad && (
        <>
          {/* Tap-outside dismisses */}
          <div className="fixed inset-0 z-[60]" onClick={() => setShowKeypad(false)} />
          <div className="absolute left-0 bottom-full mb-2 z-[70] bg-background border rounded-2xl shadow-2xl p-4 w-56">
            <NumericKeypad
              initialValue={value}
              onConfirm={v => { onChange(v); setShowKeypad(false) }}
              onClose={() => setShowKeypad(false)}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Numeric keypad (3×4 grid) ──────────────────────────────────
// Keys: 1-9, backspace, 0, confirm
function NumericKeypad({ initialValue, onConfirm, onClose }) {
  const [draft, setDraft] = useState(String(initialValue))

  function press(key) {
    if (key === '⌫') {
      setDraft(v => v.length > 1 ? v.slice(0, -1) : '')
    } else if (key === '✓') {
      const n = parseInt(draft, 10)
      onConfirm(isNaN(n) || n < 1 ? 1 : Math.min(n, 99))
    } else {
      // digit
      setDraft(v => {
        const next = v === '' ? key : v + key
        return parseInt(next, 10) > 99 ? v : next
      })
    }
  }

  const keys = ['1','2','3','4','5','6','7','8','9','⌫','0','✓']

  return (
    <>
      {/* Current value display */}
      <div className="text-center text-3xl font-bold mb-3 py-2 rounded-xl bg-muted/40 min-h-[3rem] flex items-center justify-center">
        {draft !== '' ? draft : <span className="text-muted-foreground text-2xl">—</span>}
      </div>

      {/* Key grid */}
      <div className="grid grid-cols-3 gap-2">
        {keys.map(k => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className={cn(
              'h-14 rounded-xl text-xl font-medium border transition-all active:scale-95 touch-manipulation select-none',
              k === '✓'
                ? 'bg-primary text-primary-foreground border-primary text-base'
                : k === '⌫'
                  ? 'text-destructive hover:bg-destructive/10 border-border'
                  : 'hover:bg-accent border-border'
            )}
          >
            {k}
          </button>
        ))}
      </div>
    </>
  )
}

// ── Generic labelled field ─────────────────────────────────────
function Field({ label, error, children }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}

// ── Manual allocation modal ─────────────────────────────────────
// Lets admins pick any date, time, and tables (or unallocated) without
// being constrained by schedule, capacity, or booking-window rules.
function ManualAllocModal({ venueId, initialDate, initialTime, covers, tables, api, onConfirm, onClose }) {
  const [date,        setDate]        = useState(initialDate)
  const [time,        setTime]        = useState(initialTime || '12:00')
  const [selTableIds, setSelTableIds] = useState(new Set())
  const [unallocated, setUnallocated] = useState(false)

  // Fetch same-day bookings to show "Booked" indicator on each table
  const { data: dayBookings = [] } = useQuery({
    queryKey: ['bookings-manualalloc', venueId, date],
    queryFn:  () => api.get(`/bookings?venue_id=${venueId}&date=${date}`),
    enabled:  !!venueId && !!date,
  })

  // Fetch rules for slot duration (needed for overlap window)
  const { data: rules } = useQuery({
    queryKey: ['booking-rules', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/rules`),
    enabled:  !!venueId,
  })
  const slotDuration = rules?.slot_duration_mins ?? 90

  // Group real tables by section (exclude the virtual unallocated row)
  const sections = useMemo(() => {
    const real = tables.filter(t => !t.is_unallocated)
    const map  = new Map()
    real.forEach(t => {
      const sec = t.section_name || 'Tables'
      if (!map.has(sec)) map.set(sec, [])
      map.get(sec).push(t)
    })
    return [...map.entries()]
  }, [tables])

  function isBooked(table) {
    if (!date || !time || !dayBookings.length) return false
    const start = new Date(`${date}T${time}:00`)
    const end   = new Date(start.getTime() + slotDuration * 60_000)
    return dayBookings.some(b => {
      const uses = b.table_id === table.id ||
                   (Array.isArray(b.member_table_ids) && b.member_table_ids.includes(table.id))
      return uses && new Date(b.starts_at) < end && new Date(b.ends_at) > start
    })
  }

  function toggleTable(id) {
    if (unallocated) return
    setSelTableIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const canConfirm = date && time && (unallocated || selTableIds.size > 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold">Manual allocation</h2>
            <p className="text-xs text-amber-600 mt-0.5">Bypasses schedule, capacity, and booking-window rules</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Time</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Tables */}
          <div>
            <label className="text-sm font-medium block mb-2">Tables</label>
            <div className="space-y-4">
              {sections.map(([sectionName, sectionTables]) => (
                <div key={sectionName}>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    {sectionName}
                  </p>
                  <div className="space-y-1.5">
                    {sectionTables.map(table => {
                      const booked  = isBooked(table)
                      const checked = selTableIds.has(table.id)
                      return (
                        <label
                          key={table.id}
                          onClick={(e) => { e.preventDefault(); toggleTable(table.id) }}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer select-none transition-colors',
                            checked ? 'border-primary bg-primary/5' : 'border-border',
                            unallocated && 'pointer-events-none opacity-40',
                            !unallocated && !checked && 'hover:bg-muted/50',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            readOnly
                            className="w-4 h-4 shrink-0 pointer-events-none"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">{table.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {table.min_covers}–{table.max_covers} covers
                            </span>
                          </div>
                          {booked && (
                            <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                              Booked
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Unallocated option */}
            <div className="mt-3 pt-3 border-t">
              <label
                onClick={() => {
                  setUnallocated(v => !v)
                  if (!unallocated) setSelTableIds(new Set())
                }}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer select-none transition-colors',
                  unallocated ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                )}
              >
                <input
                  type="checkbox"
                  checked={unallocated}
                  readOnly
                  className="w-4 h-4 shrink-0 pointer-events-none"
                />
                <div>
                  <p className="text-sm font-medium">Unallocated</p>
                  <p className="text-xs text-muted-foreground">No specific table — assign from timeline later</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t shrink-0">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 border rounded-lg hover:bg-accent touch-manipulation"
          >
            Cancel
          </button>
          <button
            onClick={() => canConfirm && onConfirm({ date, time, tableIds: [...selTableIds], unallocated })}
            disabled={!canConfirm}
            className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 touch-manipulation"
          >
            Continue to guest details
          </button>
        </div>
      </div>
    </div>
  )
}
