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
import { X, ChevronRight, Calendar, UserSearch, TriangleAlert, Zap } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime, STATUS_LABELS, STATUS_COLOURS } from '@/lib/utils'

// Statuses an operator can assign when creating a booking
const NEW_BOOKING_STATUSES = ['unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated']

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

export default function NewBookingModal({ venueId, date: initialDate, prefillTime = null, prefillTableId = null, openManual = false, onClose, onCreated }) {
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
  const [showManualAlloc, setShowManualAlloc] = useState(openManual)
  const [displaceAlloc,   setDisplaceAlloc]   = useState(null)   // { date, time, tableIds }
  const [bookingStatus,   setBookingStatus]   = useState('confirmed')

  // Customer search — debounced query driven by guest form fields
  const [customerQ,    setCustomerQ]    = useState('')
  const customerQTimer = useRef(null)

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
  const formCovers   = watch('covers')      ?? covers
  const watchedName  = watch('guest_name')  ?? ''
  const watchedEmail = watch('guest_email') ?? ''
  const watchedPhone = watch('guest_phone') ?? ''

  // Sync covers into guest form whenever step changes to 'guest'
  useEffect(() => {
    if (step === 'guest') reset(v => ({ ...v, covers }))
  }, [step])

  // Track which guest field the operator is currently typing in.
  // Search fires only for the active field — ignoring whatever is in the others.
  const [activeSearchField, setActiveSearchField] = useState(null)

  useEffect(() => {
    if (step !== 'guest' || !activeSearchField) return
    const term = activeSearchField === 'email' ? watchedEmail
               : activeSearchField === 'phone' ? watchedPhone
               : watchedName
    clearTimeout(customerQTimer.current)
    customerQTimer.current = setTimeout(() => setCustomerQ(term.length >= 2 ? term : ''), 300)
    return () => clearTimeout(customerQTimer.current)
  }, [watchedEmail, watchedName, watchedPhone, step, activeSearchField])

  const { data: customerSuggestions = [] } = useQuery({
    queryKey: ['customers', 'search', customerQ],
    queryFn:  () => api.get(`/customers?q=${encodeURIComponent(customerQ)}&limit=8`),
    enabled:  customerQ.length >= 2 && step === 'guest',
    staleTime: 10_000,
  })

  function handleCustomerSelect(customer) {
    setValue('guest_name',  customer.name,         { shouldValidate: true })
    setValue('guest_email', customer.email ?? '',  { shouldValidate: true })
    setValue('guest_phone', customer.phone ?? '',  { shouldValidate: true })
    setCustomerQ('')
    setActiveSearchField(null)
  }

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

  const { data: rulesRes } = useQuery({
    queryKey: ['booking-rules', venueId],
    queryFn:  () => api.get(`/venues/${venueId}/rules`),
    enabled:  !!venueId,
  })
  const slotDuration = rulesRes?.slot_duration_mins ?? 90

  const availableSlots = slotsRes?.slots?.filter(s => s.available) ?? []
  const displaceSlots  = useMemo(
    () => slotsRes?.slots?.filter(s => !s.available && s.displace_candidate != null) ?? [],
    [slotsRes]
  )

  // Refs for Walk-In-from-slot-step flow (avoids async state issues):
  //   walkInModeRef   — when true, holdMutation.onSuccess auto-confirms as Walk In instead of advancing to guest step
  //   walkInDisplaceRef — stores displacement alloc data synchronously so confirmDisplaceMutation reads it before React re-renders
  //   holdDataRef     — sync mirror of holdData state so confirmMutation can read hold.id the same tick holdMutation.onSuccess fires
  const walkInModeRef    = useRef(false)
  const walkInDisplaceRef = useRef(null)
  const holdDataRef      = useRef(null)

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

  // Release the active hold (fire-and-forget DELETE) — called on Close, Cancel, and Back
  function releaseHold() {
    if (holdData) {
      api.delete(`/bookings/holds/${holdData.id}`).catch(() => {})
      setHoldData(null)
    }
  }

  // Wrap onClose so any active hold is always released before the modal unmounts
  function handleClose() {
    releaseHold()
    onClose()
  }

  // Create hold
  const holdMutation = useMutation({
    mutationFn: (data) => api.post('/bookings/holds', data),
    onSuccess: (hold) => {
      holdDataRef.current = hold
      setHoldData(hold)
      if (walkInModeRef.current) {
        // Walk In clicked from slot step — confirm immediately without going to guest step
        walkInModeRef.current = false
        confirmMutation.mutate({
          guest_name: 'Walk In', guest_email: 'walkin@walkin.com',
          covers, guest_notes: '', guest_phone: null, status: 'seated',
        })
      } else {
        setStep('guest')
      }
    },
  })

  // Confirm booking — send full guest details so the booking record is correct
  const confirmMutation = useMutation({
    mutationFn: (guestData) => api.post('/bookings', {
      hold_id:     (holdDataRef.current ?? holdData).id,
      guest_name:  guestData.guest_name,
      guest_email: guestData.guest_email,
      guest_phone: guestData.guest_phone ?? null,
      covers:      guestData.covers,
      guest_notes: guestData.guest_notes ?? null,
      status:      guestData.status ?? bookingStatus,
    }),
    // Hold consumed by confirm_hold() — clear so handleClose doesn't try to delete it again
    onSuccess: () => { holdDataRef.current = null; setHoldData(null); onCreated(bookingDate) },
  })

  // Admin override — bypasses slot resolver, capacity, and booking window checks.
  // starts_at: convert local time string → UTC ISO so the server (UTC) stores the correct time
  // regardless of what timezone the browser is in (e.g. BST = UTC+1 in summer).
  const confirmOverrideMutation = useMutation({
    mutationFn: (guestData) => api.post('/bookings/admin-override', {
      venue_id:    venueId,
      starts_at:   new Date(`${manualAlloc.date}T${manualAlloc.time}:00`).toISOString(),
      covers:      guestData.covers,
      table_ids:   manualAlloc.tableIds,
      unallocated: manualAlloc.unallocated ?? false,
      guest_name:  guestData.guest_name,
      guest_email: guestData.guest_email,
      guest_phone: guestData.guest_phone ?? null,
      guest_notes: guestData.guest_notes ?? null,
      status:      guestData.status ?? bookingStatus,
    }),
    onSuccess: () => onCreated(manualAlloc.date),
  })

  // Displacement booking — calls admin-override with displace_conflicts:true.
  // Atomically moves blocking bookings off the target combination, then inserts this one.
  // walkInDisplaceRef is read synchronously (state not yet updated when called from slot step).
  const confirmDisplaceMutation = useMutation({
    mutationFn: (guestData) => {
      const dAlloc = walkInDisplaceRef.current ?? displaceAlloc
      return api.post('/bookings/admin-override', {
        venue_id:           venueId,
        starts_at:          new Date(`${dAlloc.date}T${dAlloc.time}:00`).toISOString(),
        covers:             guestData.covers,
        table_ids:          dAlloc.tableIds ?? [],
        displace_conflicts: true,
        guest_name:         guestData.guest_name,
        guest_email:        guestData.guest_email,
        guest_phone:        guestData.guest_phone ?? null,
        guest_notes:        guestData.guest_notes ?? null,
        status:             guestData.status ?? bookingStatus,
      })
    },
    onSuccess: () => {
      const date = (walkInDisplaceRef.current ?? displaceAlloc)?.date ?? bookingDate
      walkInDisplaceRef.current = null
      onCreated(date)
    },
  })

  function handleSlotConfirm() {
    if (!selectedSlot) return

    // Displacement slot — skip hold creation, go straight to guest details
    if (selectedSlot.displace_candidate && !selectedSlot.available) {
      const dc   = selectedSlot.displace_candidate
      const d    = new Date(selectedSlot.slot_time)
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      setDisplaceAlloc({ date: bookingDate, time, tableIds: dc.member_table_ids })
      setStep('guest')
      return
    }

    // Regular slot flow — create a hold first
    const assignedTableId = selectedSlot.table_id ?? null
    const assignedComboId = selectedSlot.combination_id ?? null
    if (!assignedTableId && !assignedComboId) return
    holdMutation.mutate({
      venue_id:       venueId,
      ...(assignedTableId ? { table_id: assignedTableId }       : {}),
      ...(assignedComboId ? { combination_id: assignedComboId } : {}),
      starts_at:   selectedSlot.slot_time,
      covers,
      guest_name:  'TBC',
      guest_email: 'tbc@placeholder.com',
    })
  }

  function onGuestSubmit(data) {
    if (displaceAlloc)    confirmDisplaceMutation.mutate(data)
    else if (manualAlloc) confirmOverrideMutation.mutate(data)
    else                  confirmMutation.mutate(data)
  }

  // Walk-in: skip all guest details, book immediately as Walk In (status: seated)
  // Works from both the slot step (no hold yet) and the guest step (hold / manual / displace already set).
  function handleWalkIn() {
    const walkInData = {
      guest_name: 'Walk In', guest_email: 'walkin@walkin.com',
      covers, guest_notes: '', guest_phone: null, status: 'seated',
    }

    if (displaceAlloc) {
      confirmDisplaceMutation.mutate(walkInData)
    } else if (manualAlloc) {
      confirmOverrideMutation.mutate(walkInData)
    } else if (holdData) {
      // Guest step — hold already exists
      confirmMutation.mutate(walkInData)
    } else if (selectedSlot?.displace_candidate && !selectedSlot?.available) {
      // Displacement slot chosen in slot step — derive alloc data and trigger directly.
      // Use ref (not setState) so mutationFn reads fresh data the same render tick.
      const dc   = selectedSlot.displace_candidate
      const d    = new Date(selectedSlot.slot_time)
      const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      walkInDisplaceRef.current = { date: bookingDate, time, tableIds: dc.member_table_ids }
      confirmDisplaceMutation.mutate(walkInData)
    } else if (selectedSlot) {
      // Regular slot in slot step — create hold first, then auto-confirm in holdMutation.onSuccess
      walkInModeRef.current = true
      handleSlotConfirm()
    }
  }

  const showSuggestions = step === 'guest' && customerSuggestions.length > 0

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={handleClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Relative wrapper — modal stays centred; suggestions panel anchors to its right edge */}
        <div className="relative w-full max-w-md">
        <div className="bg-background rounded-xl shadow-2xl w-full flex flex-col max-h-[85vh]">

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
                  onClick={e => { try { e.target.showPicker() } catch (_) {} }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded hover:bg-accent">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1 px-5 py-3 text-xs border-b shrink-0">
            <span className={cn('font-medium', step === 'slot' ? 'text-primary' : 'text-muted-foreground')}>
              {manualAlloc ? 'Manual allocation' : displaceAlloc ? 'Reassign & book' : 'Select slot'}
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
                  {/* Displacement slots — combination is blocked but only by unlocked bookings */}
                  {displaceSlots.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-xs font-medium text-amber-700">Available with table reassignment</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {displaceSlots.map(slot => {
                          const dc = slot.displace_candidate
                          const comboName = combinations.find(c => c.id === dc.combination_id)?.name
                            ?? (dc.member_table_ids ?? []).map(id => tables.find(t => t.id === id)?.label ?? '').filter(Boolean).join('+')
                          return (
                            <button
                              key={`d-${slot.slot_time}`}
                              onClick={() => setSlot(slot)}
                              title={`Moves: ${(dc.conflicts ?? []).map(c => c.guest_name || `${c.covers} cov`).join(', ')}`}
                              className={cn(
                                'text-sm py-2 px-1 rounded-lg border text-center transition-colors touch-manipulation',
                                selectedSlot?.slot_time === slot.slot_time && selectedSlot?.displace_candidate
                                  ? 'bg-amber-500 text-white border-amber-500'
                                  : 'border-amber-300 bg-amber-50/60 text-amber-900 hover:bg-amber-100 active:bg-amber-200'
                              )}
                            >
                              <p className="font-medium">{formatTime(slot.slot_time)}</p>
                              {comboName && <p className="text-[10px] opacity-70 leading-tight">{comboName}</p>}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[11px] text-amber-600 mt-1">Existing bookings will be reassigned to free tables.</p>
                    </div>
                  )}

                  {selectedSlot && (() => {
                    const slotEndMs   = new Date(selectedSlot.slot_time).getTime() + slotDuration * 60_000
                    const slotEnd     = new Date(slotEndMs)
                    const endHHMM     = `${String(slotEnd.getHours()).padStart(2,'0')}:${String(slotEnd.getMinutes()).padStart(2,'0')}`
                    const closesAt    = selectedSlot.sitting_closes_at?.slice(0, 5)
                    const doorsClose  = selectedSlot.sitting_doors_close?.slice(0, 5)
                    const overLastOrder = closesAt   && endHHMM > closesAt
                    const overDoors     = doorsClose && endHHMM > doorsClose
                    return (
                      <>
                        <p className="text-xs text-muted-foreground mt-2">
                          Table:{' '}
                          <span className="font-medium text-foreground">
                            {selectedSlot.combination_id
                              ? (combinations.find(c => c.id === selectedSlot.combination_id)?.name ?? 'combo')
                              : (tables.find(t => t.id === selectedSlot.table_id)?.label ?? '—')}
                          </span>
                        </p>
                        {overDoors && (
                          <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                            <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>This booking ends at <strong>{endHHMM}</strong>, after doors close ({doorsClose}).</span>
                          </div>
                        )}
                        {!overDoors && overLastOrder && (
                          <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                            <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>This booking ends at <strong>{endHHMM}</strong>, after last orders ({closesAt}).</span>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* ── Step 2: Guest details ──────────────────── */}
            {step === 'guest' && (
              <form id="guest-form" onSubmit={handleSubmit(onGuestSubmit)} className="space-y-4">
                {/* Booking status */}
                <div>
                  <label className="text-sm font-medium block mb-2">Booking status</label>
                  <div className="flex flex-wrap gap-2">
                    {NEW_BOOKING_STATUSES.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setBookingStatus(s)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-semibold touch-manipulation transition-all',
                          bookingStatus === s
                            ? cn(STATUS_COLOURS[s], 'ring-2 ring-offset-1 ring-current/50')
                            : 'bg-muted text-muted-foreground hover:bg-muted/60',
                        )}
                      >
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="Full name" error={errors.guest_name?.message}>
                  {/* autoFocus only on desktop — on iOS/Android it would instantly pop the keyboard */}
                  <input {...register('guest_name')} onFocus={() => setActiveSearchField('name')} className="input" placeholder="Jane Smith" autoFocus={!IS_TOUCH} />
                </Field>
                <Field label="Email" error={errors.guest_email?.message}>
                  <input {...register('guest_email')} onFocus={() => setActiveSearchField('email')} type="email" inputMode="email" className="input" placeholder="jane@example.com" />
                </Field>

                {/* A3: Phone — type="tel" triggers numeric keypad on iOS/Android */}
                <Field label="Phone" error={errors.guest_phone?.message}>
                  <input
                    {...register('guest_phone')}
                    onFocus={() => setActiveSearchField('phone')}
                    type="tel"
                    inputMode="tel"
                    className="input"
                    placeholder="+44 7700 900000"
                  />
                </Field>

                {/* Mobile customer suggestions — shown inline below fields on small screens */}
                {showSuggestions && (
                  <div className="sm:hidden border rounded-lg overflow-hidden bg-background">
                    <div className="flex items-center gap-2 px-3 py-2 border-b">
                      <UserSearch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs font-medium text-muted-foreground flex-1">Matching customers</span>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setCustomerQ(''); setActiveSearchField(null) }}
                        className="p-0.5 rounded hover:bg-accent touch-manipulation"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {customerSuggestions.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => handleCustomerSelect(c)}
                          className="w-full text-left px-3 py-2.5 hover:bg-accent border-b last:border-b-0 touch-manipulation transition-colors"
                        >
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                          {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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
              // Guest step: Back + Confirm
              <>
                <button
                  onClick={() => { releaseHold(); setStep('slot'); setManualAlloc(null); setDisplaceAlloc(null) }}
                  className="text-sm px-4 py-2 border rounded-lg hover:bg-accent touch-manipulation"
                >
                  Back
                </button>
                <button
                  type="submit"
                  form="guest-form"
                  disabled={confirmMutation.isPending || confirmOverrideMutation.isPending || confirmDisplaceMutation.isPending}
                  className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 touch-manipulation"
                >
                  {(confirmMutation.isPending || confirmOverrideMutation.isPending || confirmDisplaceMutation.isPending) ? 'Confirming…' : 'Confirm booking'}
                </button>
              </>
            ) : (
              // Slot step: Cancel + Manual allocation + Walk In + Continue
              <>
                <button onClick={handleClose} className="text-sm px-4 py-2 border rounded-lg hover:bg-accent touch-manipulation">
                  Cancel
                </button>
                <button
                  onClick={() => setShowManualAlloc(true)}
                  className="text-sm px-4 py-2 border border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg touch-manipulation"
                >
                  Manual allocation
                </button>
                <button
                  type="button"
                  onClick={handleWalkIn}
                  disabled={!selectedSlot || holdMutation.isPending || confirmMutation.isPending || confirmDisplaceMutation.isPending}
                  className="text-sm px-4 py-2 border border-green-500 text-green-700 bg-green-50 hover:bg-green-100 rounded-lg disabled:opacity-40 touch-manipulation"
                >
                  {(holdMutation.isPending && walkInModeRef.current) || confirmMutation.isPending || confirmDisplaceMutation.isPending ? 'Confirming…' : 'Walk In'}
                </button>
                <button
                  onClick={handleSlotConfirm}
                  disabled={!selectedSlot || holdMutation.isPending || (!selectedSlot?.table_id && !selectedSlot?.combination_id && !selectedSlot?.displace_candidate)}
                  className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 touch-manipulation"
                >
                  {holdMutation.isPending && !walkInModeRef.current ? 'Holding…' : 'Continue'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Customer suggestions — desktop/tablet: panel to the right of the modal.
            Hidden on mobile (sm:hidden screens use the inline panel inside the form). */}
        {showSuggestions && (
          <div className="hidden sm:flex absolute left-[calc(100%+12px)] top-0 bg-background rounded-xl shadow-2xl border w-64 flex-col overflow-hidden max-h-[70vh]">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
              <UserSearch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">Matching customers</span>
            </div>
            <div className="overflow-y-auto">
              {customerSuggestions.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleCustomerSelect(c)}
                  className="w-full text-left px-3 py-2.5 hover:bg-accent border-b last:border-b-0 touch-manipulation transition-colors"
                >
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                  {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                </button>
              ))}
            </div>
          </div>
        )}

        </div>{/* end relative wrapper */}
      </div>

      <style>{`.input { width: 100%; border: 1px solid hsl(var(--border)); border-radius: 0.5rem; padding: 0.5rem 0.625rem; font-size: 0.875rem; outline: none; background: hsl(var(--background)); } .input:focus { border-color: hsl(var(--primary)); }`}</style>

      {/* Manual allocation modal — sits above the booking modal (z-[60]) */}
      {showManualAlloc && (
        <ManualAllocModal
          venueId={venueId}
          initialDate={bookingDate}
          initialTime={selectedSlot ? (() => { const d = new Date(selectedSlot.slot_time); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` })() : prefillTime ?? '12:00'}
          initialTableIds={prefillTableId ? [prefillTableId] : []}
          covers={covers}
          tables={tables}
          api={api}
          onClose={() => { setShowManualAlloc(false); if (openManual) onClose() }}
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
function ManualAllocModal({ venueId, initialDate, initialTime, initialTableIds = [], covers, tables, api, onConfirm, onClose }) {
  const [date,        setDate]        = useState(initialDate)
  const [time,        setTime]        = useState(initialTime || '12:00')
  const [selTableIds, setSelTableIds] = useState(new Set(initialTableIds))
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
