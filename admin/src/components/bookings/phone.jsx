// src/components/bookings/phone.jsx
//
// The parts the phone's booking pages share (pages/mobile/MobileTimeline.jsx,
// MobileGuestList.jsx): the venue and day bar, the day's bookings, a
// booking's sheet with its status buttons, and the new booking sheet. Every
// read and change goes through the routes the office uses:
//   GET   /bookings?venue_id=&date=     the day (query key ['bookings', venue, date],
//                                       the Timeline's and Bookings page's, so the
//                                       booking socket refreshes all of them)
//   PATCH /bookings/:id/status          a status (statuses.js: what the venue offers)
// The phone's venue: the one picked on these pages, else the venue this device
// is shared for, else the Today page's, else the first.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, addDays } from 'date-fns'
import { ChevronLeft, ChevronRight, CalendarDays, Phone, Mail, TriangleAlert, X, Plus, StickyNote } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn, formatTime, STATUS_LABELS, STATUS_COLOURS, openPicker } from '@/lib/utils'
import { sharedDevice } from '@/lib/sharedDevice'
import { useRealtimeBookings } from '@/hooks/useRealtimeBookings'
import { usePermission } from '@/hooks/usePermission'
import { statusChoices } from '@/components/bookings/statuses'

const VENUE_KEY = 'maca_phone_bookings_venue'
const TODAY_VENUE_KEY = 'maca_today_venue' // the Today page's venue (pages/Home.jsx VENUE_KEY)
const read = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const keep = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
// Addresses the staff path puts on a booking with none (the hold's, a walk-in's).
const STAND_IN_EMAILS = new Set(['tbc@placeholder.com', 'walkin@walkin.com'])
export const realEmail = e => (e && !STAND_IN_EMAILS.has(e.toLowerCase()) ? e : '')

/** "YYYY-MM-DD" today at a venue (its time zone). */
export function venueToday(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** [venueId, setVenueId, venues, venue] for the phone's booking pages. */
export function usePhoneVenue() {
  const api = useApi()
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const [picked, setPicked] = useState(() => read(VENUE_KEY))
  const ok = id => !!id && venues.some(v => v.id === id)
  const venueId = [picked, sharedDevice()?.venue_id, read(TODAY_VENUE_KEY)].find(ok) ?? venues[0]?.id ?? ''
  function setVenueId(id) { setPicked(id); keep(VENUE_KEY, id) }
  return [venueId, setVenueId, venues, venues.find(v => v.id === venueId)]
}

/** The day's bookings at a venue, kept fresh by the booking socket (and a minute's poll). */
export function useDayBookings(venueId, date) {
  const api = useApi()
  useRealtimeBookings(venueId)
  return useQuery({
    queryKey: ['bookings', venueId, date],
    queryFn: () => api.get(`/bookings?venue_id=${venueId}&date=${date}`),
    enabled: !!venueId && !!date,
    refetchInterval: 60_000,
  })
}

export function useBookingRules(venueId) {
  const api = useApi()
  return useQuery({ queryKey: ['rules', venueId], queryFn: () => api.get(`/venues/${venueId}/rules`), enabled: !!venueId })
}

/** A status change, refreshing every list of that day. */
export function useSetStatus() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }) => api.patch(`/bookings/${id}/status`, { status }),
    onSuccess: b => qc.invalidateQueries({ queryKey: ['bookings', b.venue_id] }),
  })
}

// Words in a guest's notes that need the kitchen told: the 14 allergens and
// the usual ways guests write about allergies and intolerances.
const ALLERGY_RE = /\b(allerg\w*|anaphyla\w*|epi-?pen|coeliac|celiac|intoleran\w*|gluten|wheat|nuts?|peanuts?|tree ?nuts?|dairy|lactose|milk|eggs?|fish|shellfish|crustaceans?|molluscs?|sesame|soya?|mustard|celery|lupin|sulphites?|sulfites?)\b/i
/** Whether a booking's notes mention an allergy or intolerance. */
export function allergyIn(booking) {
  return ALLERGY_RE.test(booking?.guest_notes || '') || ALLERGY_RE.test(booking?.operator_notes || '')
}

export function StatusPill({ status, className }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', STATUS_COLOURS[status], className)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

/** Covers and the table (or tables) a booking sits at. */
export function tableText(b) {
  if (b.table_is_unallocated) return 'Unallocated'
  return b.combination_name || b.table_label || ''
}

// ── The venue and day bar ──────────────────────────────────────

export function VenueDayBar({ venues, venueId, setVenueId, date, setDate, today, onNew, canAdd }) {
  const step = n => setDate(format(addDays(parseISO(date), n), 'yyyy-MM-dd'))
  return (
    <div className="space-y-2">
      {venues.length > 1 && (
        <select value={venueId} onChange={e => setVenueId(e.target.value)} aria-label="Restaurant" data-testid="mbk-venue"
          className="w-full border rounded-lg px-3 min-h-[48px] text-sm bg-background touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} aria-label="Previous day" data-testid="mbk-prev"
          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg border bg-background touch-manipulation">
          <ChevronLeft className="w-5 h-5" />
        </button>
        {/* The day as a button over an invisible date input: a tap opens the phone's own picker. */}
        <label className="relative flex-1 min-w-0 h-12 flex items-center justify-center gap-1.5 rounded-lg border bg-background text-sm font-semibold touch-manipulation">
          <CalendarDays className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="truncate" data-testid="mbk-date">{date === today ? 'Today, ' : ''}{format(parseISO(date), 'EEE d MMM')}</span>
          <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} onClick={openPicker}
            aria-label="Day" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        </label>
        <button type="button" onClick={() => step(1)} aria-label="Next day" data-testid="mbk-next"
          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg border bg-background touch-manipulation">
          <ChevronRight className="w-5 h-5" />
        </button>
        {canAdd && (
          <button type="button" onClick={onNew} aria-label="New booking" data-testid="mbk-new"
            className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg bg-primary text-primary-foreground touch-manipulation">
            <Plus className="w-5 h-5" />
          </button>
        )}
      </div>
      {date !== today && (
        <button type="button" onClick={() => setDate(today)} className="w-full min-h-[40px] text-xs text-primary underline underline-offset-2 touch-manipulation">Back to today</button>
      )}
    </div>
  )
}

// ── A booking ─────────────────────────────────────────────────

// Statuses that end the booking for the day, so a tap asks twice (rule 6).
const ASK_TWICE = new Set(['cancelled', 'no_show'])

export function BookingSheet({ booking: initial, bookings, onClose }) {
  // The open booking follows the day's list, so a change shows straight away.
  const booking = bookings?.find(b => b.id === initial.id) ?? initial
  const { canManage } = usePermission('bookings')
  const { data: rules } = useBookingRules(booking.venue_id)
  const setStatus = useSetStatus()
  const [asking, setAsking] = useState(null)
  const choices = statusChoices(rules, booking.status)
  const email = realEmail(booking.guest_email)
  function tap(s) {
    if (s === booking.status) return
    if (ASK_TWICE.has(s) && asking !== s) { setAsking(s); return }
    setAsking(null)
    setStatus.mutate({ id: booking.id, status: s })
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={booking.guest_name}
      onClick={e => e.target === e.currentTarget && onClose()} data-testid="mbk-sheet">
      <div className="w-full max-w-lg bg-background rounded-t-2xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate" data-testid="mbk-sheet-name">{booking.guest_name}</h2>
            <p className="text-xs text-muted-foreground">{format(parseISO(booking.starts_at), 'EEE d MMM')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Fact label="Time" value={`${formatTime(booking.starts_at)}–${formatTime(booking.ends_at)}`} />
            <Fact label="Covers" value={booking.covers} />
            <Fact label="Table" value={tableText(booking) || '–'} />
          </div>
          <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Status</span><StatusPill status={booking.status} /></div>
          {(booking.guest_phone || email) && (
            <div className="flex flex-wrap gap-2">
              {booking.guest_phone && (
                <a href={'tel:' + booking.guest_phone} className="inline-flex items-center gap-1.5 min-h-[48px] px-3 rounded-lg border text-sm touch-manipulation">
                  <Phone className="w-4 h-4" /> {booking.guest_phone}
                </a>
              )}
              {email && (
                <a href={'mailto:' + email} className="inline-flex items-center gap-1.5 min-h-[48px] px-3 rounded-lg border text-sm touch-manipulation min-w-0">
                  <Mail className="w-4 h-4 shrink-0" /> <span className="truncate">{email}</span>
                </a>
              )}
            </div>
          )}
          {allergyIn(booking) && (
            <p className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm font-medium" data-testid="mbk-allergy">
              <TriangleAlert className="w-4 h-4 shrink-0" /> Allergy or intolerance in the notes
            </p>
          )}
          {booking.guest_notes && <Note label="Guest's notes" text={booking.guest_notes} />}
          {booking.operator_notes && <Note label="Staff notes" text={booking.operator_notes} />}
          {booking.payment_amount != null && (
            <p className="text-sm text-muted-foreground">Deposit {(Number(booking.payment_amount) / 100).toFixed(2)} {booking.payment_currency?.toUpperCase()} ({booking.payment_status})</p>
          )}
          {canManage && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Change status</p>
              <div className="grid grid-cols-2 gap-2" data-testid="mbk-statuses">
                {choices.map(s => (
                  <button key={s} type="button" onClick={() => tap(s)} disabled={setStatus.isPending} data-status={s} aria-pressed={s === booking.status}
                    className={cn('min-h-[48px] rounded-lg border text-sm font-medium touch-manipulation disabled:opacity-60',
                      s === booking.status ? cn(STATUS_COLOURS[s], 'ring-2 ring-current/40') : asking === s ? 'bg-red-600 text-white border-red-600' : 'bg-background')}>
                    {asking === s ? 'Tap again: ' + STATUS_LABELS[s] : STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              {setStatus.error && <p className="text-xs text-red-700">{setStatus.error.message}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div className="rounded-lg border px-2 py-2 min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums truncate">{value}</p>
    </div>
  )
}

function Note({ label, text }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1"><StickyNote className="w-3 h-3" /> {label}</p>
      <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
    </div>
  )
}

/** Bookings that still count for the day (not cancelled, not a no-show). */
export function activeOf(list) {
  return list.filter(b => b.status !== 'cancelled' && b.status !== 'no_show')
}

/** The day's figures: bookings and covers still on, and how many are in. */
export function useDayFigures(list) {
  return useMemo(() => {
    const active = activeOf(list)
    return {
      bookings: active.length,
      covers: active.reduce((t, b) => t + (b.covers ?? 0), 0),
      in: active.filter(b => ['arrived', 'seated'].includes(b.status)).length,
    }
  }, [list])
}
