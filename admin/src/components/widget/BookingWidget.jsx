// src/components/widget/BookingWidget.jsx
// Self-contained booking widget component.
// Runs the real booking flow against the live API.
// Steps: covers → date → slot → details → [payment] → confirmation
// This is what will be ported to Ember.js for the iframe widget.

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format, parseISO, addDays } from 'date-fns'
import { useApi } from '@/lib/api'
import {
  ChevronLeft, ChevronRight, Check, Clock, Users,
  CalendarDays, Mail, Phone, User, ChevronDown, AlertCircle
} from 'lucide-react'

// Widget has its own QueryClient so it's isolated from the admin portal cache
const widgetQc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

// ── Step constants ────────────────────────────────────────────
const STEPS = { COVERS: 0, DATE: 1, SLOT: 2, DETAILS: 3, PAYMENT: 4, CONFIRM: 5 }

// ── Main widget wrapper (provides isolated query client) ──────
export default function BookingWidget(props) {
  return (
    <QueryClientProvider client={widgetQc}>
      <WidgetInner {...props} />
    </QueryClientProvider>
  )
}

// ── Widget inner ──────────────────────────────────────────────
function WidgetInner({ venueId, date: initialDate, initialCovers = 2, theme, accentHex }) {
  const api = useApi()

  // -- State --
  const [step,     setStep]     = useState(STEPS.COVERS)
  const [covers,   setCovers]   = useState(initialCovers)
  const [date,     setDate]     = useState(initialDate)
  const [slot,     setSlot]     = useState(null)
  const [hold,     setHold]     = useState(null)
  const [booking,  setBooking]  = useState(null)
  const [error,    setError]    = useState(null)
  const [countdown, setCountdown] = useState(null)

  // -- CSS custom props for theming --
  const accent    = accentHex ?? '#2563eb'
  const isDark    = theme === 'dark'
  const bg        = isDark ? '#18181b' : '#ffffff'
  const surface   = isDark ? '#27272a' : '#f8fafc'
  const border    = isDark ? '#3f3f46' : '#e2e8f0'
  const text      = isDark ? '#f4f4f5' : '#0f172a'
  const textMuted = isDark ? '#a1a1aa' : '#64748b'

  // -- Countdown timer when hold is active --
  useEffect(() => {
    if (!hold) return
    const tick = () => {
      const secs = Math.max(0, Math.floor((new Date(hold.expires_at) - Date.now()) / 1000))
      setCountdown(secs)
      if (secs === 0) {
        setHold(null); setSlot(null); setStep(STEPS.SLOT)
        setError('Your hold expired. Please select a slot again.')
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [hold])

  // -- Slot fetch --
  const { data: slotsRes, isLoading: loadingSlots, refetch: refetchSlots } = useQuery({
    queryKey: ['widget-slots', venueId, date, covers],
    queryFn:  () => api.get(`/venues/${venueId}/slots?date=${date}&covers=${covers}`),
    enabled:  step === STEPS.SLOT,
  })
  const slots = slotsRes?.slots ?? []

  // -- Hold mutation --
  const holdMutation = useMutation({
    mutationFn: (data) => api.post('/bookings/holds', data),
    onSuccess: (h) => {
      setHold(h); setError(null)
      setStep(STEPS.DETAILS)
    },
    onError: (e) => setError(e.message ?? 'Could not hold this slot. Try another.'),
  })

  // -- Confirm mutation (free booking) --
  const confirmMutation = useMutation({
    mutationFn: (guestData) => api.post('/bookings', {
      hold_id:     hold.id,
      guest_name:  guestData.name,
      guest_email: guestData.email,
      guest_phone: guestData.phone  || null,
      guest_notes: guestData.notes  || null,
    }),
    onSuccess: (b) => { setBooking(b); setStep(STEPS.CONFIRM) },
    onError:   (e) => setError(e.message ?? 'Could not confirm booking.'),
  })

  // -- Step helpers --
  function selectSlot(s) {
    setSlot(s); setError(null)
    // Find a suitable table for this slot — in real widget this would be table-aware
    // For the test widget we POST hold and let the API pick the best available table
    holdMutation.mutate({
      venue_id:  venueId,
      // Slot resolver returns either table_id (single table) or combination_id (multi-table).
      // Only one will be non-null — send whichever is present; API requires at least one.
      ...(s.table_id       ? { table_id: s.table_id }             : {}),
      ...(s.combination_id ? { combination_id: s.combination_id } : {}),
      starts_at:   s.slot_time,
      covers,
      guest_name:  'Guest',        // placeholder — updated in details step
      guest_email: 'tbc@example.com',
    })
  }

  function reset() {
    setStep(STEPS.COVERS); setSlot(null); setHold(null)
    setBooking(null); setError(null); setCountdown(null)
  }

  // ── Styles ────────────────────────────────────────────────
  const w = {
    wrap:    { background: bg, borderRadius: 16, border: `1px solid ${border}`, width: 400, fontFamily: "'DM Sans', system-ui, sans-serif", overflow: 'hidden', boxShadow: isDark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 25px 50px rgba(0,0,0,0.08)' },
    header:  { background: accent, padding: '20px 24px 18px', color: '#fff' },
    body:    { padding: '24px' },
    btn:     { background: accent, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 20px', fontWeight: 600, fontSize: 15, cursor: 'pointer', width: '100%', transition: 'opacity 0.15s' },
    btnGhost:{ background: 'transparent', color: textMuted, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 20px', fontWeight: 500, fontSize: 14, cursor: 'pointer', transition: 'all 0.15s' },
    input:   { width: '100%', border: `1px solid ${border}`, borderRadius: 10, padding: '11px 14px', fontSize: 14, background: surface, color: text, outline: 'none', boxSizing: 'border-box' },
    label:   { fontSize: 12, fontWeight: 600, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 },
    pill:    (active) => ({ padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${active ? accent : border}`, background: active ? accent : surface, color: active ? '#fff' : text, cursor: 'pointer', fontSize: 14, fontWeight: 500, transition: 'all 0.15s' }),
    slotBtn: (active, avail) => ({
      padding: '10px 8px', borderRadius: 10, border: `1.5px solid ${active ? accent : avail ? border : border}`,
      background: active ? accent : avail ? surface : isDark ? '#3f3f46' : '#f1f5f9',
      color: active ? '#fff' : avail ? text : textMuted,
      cursor: avail ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600,
      opacity: avail ? 1 : 0.5, textAlign: 'center', transition: 'all 0.15s',
    }),
  }

  // ── Progress bar ──────────────────────────────────────────
  const totalSteps = 4  // covers, date, slot, details (payment is conditional)
  const progress = Math.min((step / totalSteps) * 100, 100)

  return (
    <div style={w.wrap}>
      {/* Header */}
      <div style={w.header}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Table reservation
            </div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {step === STEPS.CONFIRM ? 'Booking confirmed!' : 'Reserve a table'}
            </div>
          </div>
          {hold && countdown !== null && (
            <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {String(Math.floor(countdown / 60)).padStart(2,'0')}:{String(countdown % 60).padStart(2,'0')}
              </div>
              <div style={{ fontSize: 10, opacity: 0.8 }}>hold</div>
            </div>
          )}
        </div>
        {/* Progress bar */}
        {step < STEPS.CONFIRM && (
          <div style={{ marginTop: 14, height: 3, background: 'rgba(255,255,255,0.25)', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#fff', borderRadius: 2, transition: 'width 0.4s ease' }} />
          </div>
        )}
      </div>

      <div style={w.body}>
        {/* Error banner */}
        {error && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            {error}
          </div>
        )}

        {/* ── Step 0: Covers ──────────────────────────────── */}
        {step === STEPS.COVERS && (
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: text, marginBottom: 4 }}>How many guests?</div>
            <div style={{ fontSize: 14, color: textMuted, marginBottom: 20 }}>Select the number of people joining you.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
              {[1,2,3,4,5,6,7,8].map(n => (
                <button
                  key={n}
                  style={{ ...w.slotBtn(covers === n, true), padding: '14px 8px', fontSize: 16 }}
                  onClick={() => setCovers(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <button style={w.btn} onClick={() => setStep(STEPS.DATE)}>
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 1: Date ─────────────────────────────────── */}
        {step === STEPS.DATE && (
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: text, marginBottom: 4 }}>When would you like to come?</div>
            <div style={{ fontSize: 14, color: textMuted, marginBottom: 20 }}>Choose your preferred date.</div>

            {/* Simple 7-day date picker */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 24 }}>
              {Array.from({ length: 14 }, (_, i) => {
                const d   = addDays(new Date(), i)
                const iso = format(d, 'yyyy-MM-dd')
                const isSelected = iso === date
                return (
                  <button
                    key={iso}
                    onClick={() => setDate(iso)}
                    style={{ ...w.slotBtn(isSelected, true), padding: '10px 4px' }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.75 }}>{format(d, 'EEE')}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{format(d, 'd')}</div>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button style={w.btnGhost} onClick={() => setStep(STEPS.COVERS)}>← Back</button>
              <button style={{ ...w.btn, flex: 1 }} onClick={() => setStep(STEPS.SLOT)}>
                See available times
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Slot selection ────────────────────────── */}
        {step === STEPS.SLOT && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              <CalendarDays size={16} color={accent} />
              <span style={{ fontSize: 14, fontWeight: 600, color: text }}>
                {format(new Date(date), 'EEEE d MMMM')} · {covers} {covers === 1 ? 'guest' : 'guests'}
              </span>
            </div>

            {loadingSlots ? (
              <SlotSkeleton />
            ) : slots.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: textMuted }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>😔</div>
                <div style={{ fontWeight: 600, color: text, marginBottom: 4 }}>No availability</div>
                <div style={{ fontSize: 14 }}>Try a different date or party size.</div>
              </div>
            ) : (
              <>
                {/* Group slots by sitting (approximate: every gap > 30min is a new group) */}
                <SlotGrid
                  slots={slots}
                  selected={slot}
                  onSelect={selectSlot}
                  loading={holdMutation.isPending}
                  styles={w}
                  accent={accent}
                  isDark={isDark}
                  text={text}
                  textMuted={textMuted}
                  surface={surface}
                  border={border}
                />
              </>
            )}

            <div style={{ marginTop: 16 }}>
              <button style={w.btnGhost} onClick={() => setStep(STEPS.DATE)}>← Change date</button>
            </div>
          </div>
        )}

        {/* ── Step 3: Guest details ─────────────────────────── */}
        {step === STEPS.DETAILS && (
          <GuestDetailsStep
            covers={covers}
            date={date}
            slot={slot}
            hold={hold}
            styles={w}
            accent={accent}
            text={text}
            textMuted={textMuted}
            surface={surface}
            border={border}
            isDark={isDark}
            onSubmit={(data) => confirmMutation.mutate(data)}
            onBack={() => {
              // Release hold and go back to slot selection
              api.delete(`/bookings/holds/${hold.id}`).catch(() => {})
              setHold(null); setSlot(null); setStep(STEPS.SLOT)
            }}
            isPending={confirmMutation.isPending}
            error={error}
          />
        )}

        {/* ── Step 5: Confirmation ──────────────────────────── */}
        {step === STEPS.CONFIRM && booking && (
          <ConfirmationStep
            booking={booking}
            covers={covers}
            styles={w}
            accent={accent}
            text={text}
            textMuted={textMuted}
            surface={surface}
            border={border}
            onReset={reset}
          />
        )}
      </div>
    </div>
  )
}

// ── Slot grid ─────────────────────────────────────────────────
function SlotGrid({ slots, selected, onSelect, loading, styles: w, accent, text, textMuted, surface, border }) {
  // Group into sittings by detecting gaps > 30 mins
  const groups = []
  let current  = []
  for (let i = 0; i < slots.length; i++) {
    if (i > 0) {
      const prev = new Date(slots[i-1].slot_time)
      const curr = new Date(slots[i].slot_time)
      if ((curr - prev) / 60000 > 45) { groups.push(current); current = [] }
    }
    current.push(slots[i])
  }
  if (current.length) groups.push(current)

  const sittingLabels = ['Lunch', 'Dinner', 'Evening', 'Late']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map((group, gi) => (
        <div key={gi}>
          {groups.length > 1 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {sittingLabels[gi] ?? `Sitting ${gi + 1}`}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {group.map(s => {
              const time     = new Date(s.slot_time)
              const timeStr  = `${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`
              const isSelected = selected?.slot_time === s.slot_time
              const isAvail  = s.available
              return (
                <button
                  key={s.slot_time}
                  onClick={() => isAvail && !loading && onSelect(s)}
                  disabled={!isAvail || loading}
                  style={w.slotBtn(isSelected, isAvail)}
                >
                  {timeStr}
                  {!isAvail && s.reason === 'full' && (
                    <div style={{ fontSize: 9, opacity: 0.7, marginTop: 2 }}>Full</div>
                  )}
                  {!isAvail && s.reason === 'unavailable' && (
                    <div style={{ fontSize: 9, opacity: 0.7, marginTop: 2 }}>N/A</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {loading && (
        <div style={{ fontSize: 13, color: textMuted, textAlign: 'center', padding: '8px 0' }}>
          Holding your slot…
        </div>
      )}
    </div>
  )
}

// ── Field wrapper — must be defined OUTSIDE GuestDetailsStep.
// If defined inside, every re-render (e.g. on each keystroke) creates a new
// function reference, React treats it as a different component, unmounts the
// old one, and the focused input loses focus immediately.
function F({ label, id, error: fieldError, children, labelStyle }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      {children}
      {fieldError && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{fieldError}</div>}
    </div>
  )
}

// ── Guest details form ────────────────────────────────────────
function GuestDetailsStep({ covers, date, slot, hold, styles: w, accent, text, textMuted, surface, border, onSubmit, onBack, isPending, error }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })
  const [errors, setErrors] = useState({})

  const slotTime = slot ? new Date(slot.slot_time) : null
  const timeStr  = slotTime ? `${String(slotTime.getHours()).padStart(2,'0')}:${String(slotTime.getMinutes()).padStart(2,'0')}` : ''

  function validate() {
    const e = {}
    if (!form.name.trim())  e.name  = 'Required'
    if (!form.email.trim()) e.email = 'Required'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (validate()) onSubmit(form)
  }

  // F is defined at module level (above GuestDetailsStep) to avoid remount on re-render

  return (
    <div>
      {/* Summary bar */}
      <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 20, display: 'flex', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: text }}>
          <CalendarDays size={14} color={accent} />
          {format(new Date(date), 'EEE d MMM')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: text }}>
          <Clock size={14} color={accent} />
          {timeStr}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: text }}>
          <Users size={14} color={accent} />
          {covers} {covers === 1 ? 'guest' : 'guests'}
        </div>
      </div>

      <div style={{ fontSize: 16, fontWeight: 700, color: text, marginBottom: 16 }}>Your details</div>

      <form onSubmit={handleSubmit}>
        <F label="Full name *" id="name" error={errors.name} labelStyle={w.label}>
          <input
            id="name" style={w.input} placeholder="Jane Smith"
            value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          />
        </F>
        <F label="Email address *" id="email" error={errors.email} labelStyle={w.label}>
          <input
            id="email" type="email" style={w.input} placeholder="jane@example.com"
            value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
          />
        </F>
        <F label="Phone number" id="phone" labelStyle={w.label}>
          <input
            id="phone" style={w.input} placeholder="+44 7700 900000"
            value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
          />
        </F>
        <F label="Special requests" id="notes" labelStyle={w.label}>
          <textarea
            id="notes" style={{ ...w.input, resize: 'none', height: 72 }}
            placeholder="Dietary requirements, celebrations, accessibility needs…"
            value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
          />
        </F>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" style={w.btnGhost} onClick={onBack}>← Back</button>
          <button type="submit" style={{ ...w.btn, flex: 1, opacity: isPending ? 0.7 : 1 }} disabled={isPending}>
            {isPending ? 'Confirming…' : 'Confirm booking'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Confirmation screen ───────────────────────────────────────
function ConfirmationStep({ booking, covers, styles: w, accent, text, textMuted, surface, border, onReset }) {
  const slotTime = new Date(booking.starts_at)

  return (
    <div style={{ textAlign: 'center' }}>
      {/* Checkmark */}
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <Check size={28} color="#fff" strokeWidth={2.5} />
      </div>

      <div style={{ fontSize: 22, fontWeight: 800, color: text, marginBottom: 6 }}>
        You're booked!
      </div>
      <div style={{ fontSize: 14, color: textMuted, marginBottom: 24 }}>
        A confirmation has been sent to {booking.guest_email}
      </div>

      {/* Booking summary card */}
      <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: '16px 20px', textAlign: 'left', marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          Booking details
        </div>
        {[
          { icon: '📅', label: format(slotTime, 'EEEE d MMMM yyyy') },
          { icon: '🕐', label: `${String(slotTime.getHours()).padStart(2,'0')}:${String(slotTime.getMinutes()).padStart(2,'0')}` },
          { icon: '👥', label: `${covers} ${covers === 1 ? 'guest' : 'guests'}` },
          { icon: '🎫', label: `Ref: ${booking.reference}` },
        ].map(({ icon, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 14, color: text }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            {label}
          </div>
        ))}
      </div>

      <button style={{ ...w.btnGhost, width: '100%' }} onClick={onReset}>
        Make another booking
      </button>
    </div>
  )
}

// ── Skeleton loader ───────────────────────────────────────────
function SlotSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} style={{ height: 40, borderRadius: 10, background: '#e2e8f0', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.05}s` }} />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  )
}
