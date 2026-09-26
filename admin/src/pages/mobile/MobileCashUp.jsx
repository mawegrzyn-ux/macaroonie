// src/pages/mobile/MobileCashUp.jsx
//
// Phone-first Cash Reconciliation — a plain vertical list of the week's 7
// days (status, income, variance), tapping a day opens the full daily
// declaration (CashRecon.jsx's DayView, reused verbatim — it already
// renders as a single scrollable column with its own back button, exactly
// the "list, then full-page detail on select" shape the other /mobile
// modules use). A "Week total" tile sits below the list, summing the same
// figures across the days that have a report. Reuses the desktop page's
// GET /venues/:id/cash-recon/week/:week_start endpoint — no new backend
// surface.

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addWeeks, subWeeks, parseISO } from 'date-fns'
import { ArrowLeft, ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { fmt, getMonday, isoWeekDates, StatusBadge, SaveIndicator, DayView } from '@/pages/CashRecon'
import { useHideMobileHeader, MobileLogoutButton } from '@/components/mobile/MobileShell'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Full-page daily declaration — hides MobileShell's own header and renders
// one unified header instead (back to the day list, short date + status,
// Submit/Unsubmit, sign out), rather than stacking DayView's own header
// underneath the shell's.
function MobileDayDeclaration({ venueId, date, onBack }) {
  useHideMobileHeader()
  const [dayState, setDayState] = useState({})

  return (
    <div className="h-full flex flex-col">
      <header
        className="shrink-0 flex items-center gap-2 border-b px-3 bg-background z-10"
        style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))', paddingBottom: '0.625rem' }}
      >
        <button type="button" onClick={onBack}
          className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-accent shrink-0 touch-manipulation"
          aria-label="Back to Cash Up">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{format(parseISO(date), 'd MMM')}</h1>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={dayState.status ?? 'none'} />
            <SaveIndicator saving={dayState.saving} saved={dayState.saved} error={dayState.saveErr} />
          </div>
        </div>
        {!dayState.isSubmitted ? (
          <button type="button" disabled={dayState.submitPending} onClick={dayState.submit}
            className="h-10 px-3 rounded-lg bg-green-600 text-white text-sm font-medium touch-manipulation hover:bg-green-700 disabled:opacity-50 shrink-0">
            {dayState.submitPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
          </button>
        ) : (
          <button type="button" disabled={dayState.submitPending} onClick={dayState.unsubmit}
            className="h-10 px-3 rounded-lg border text-sm font-medium touch-manipulation hover:bg-muted disabled:opacity-50 shrink-0">
            {dayState.submitPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unsubmit'}
          </button>
        )}
        <MobileLogoutButton />
      </header>
      <div className="flex-1 min-h-0">
        <DayView venueId={venueId} date={date} hideHeader onStateChange={setDayState} />
      </div>
    </div>
  )
}

export default function MobileCashUp() {
  const api = useApi()

  const [venueId, setVenueId] = useState('')
  const [weekStart, setWeekStart] = useState(getMonday(new Date()))
  const [selectedDate, setSelectedDate] = useState(null)

  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  useEffect(() => { if (!venueId && venues.length) setVenueId(venues[0].id) }, [venues, venueId])

  const { data: weekData } = useQuery({
    queryKey: ['cash-recon-week', venueId, weekStart],
    queryFn:  () => api.get(`/venues/${venueId}/cash-recon/week/${weekStart}`),
    enabled:  !!venueId && !!weekStart,
  })

  if (selectedDate) {
    return <MobileDayDeclaration venueId={venueId} date={selectedDate} onBack={() => setSelectedDate(null)} />
  }

  const dates = isoWeekDates(weekStart)
  const today = format(new Date(), 'yyyy-MM-dd')
  const isThisWeek = weekStart === getMonday(new Date())

  function getDay(dateStr) {
    return weekData?.days?.find(d => d.date === dateStr)
  }

  const weekTotals = dates.reduce((acc, dateStr) => {
    const d = getDay(dateStr)
    if (d?.total_income != null) {
      acc.income  += d.total_income
      acc.takings += d.total_takings
    }
    return acc
  }, { income: 0, takings: 0 })
  const weekVariance = weekTotals.takings - weekTotals.income

  return (
    <div className="p-3 pb-8 space-y-3">
      {venues.length > 0 && (
        <select value={venueId} onChange={e => setVenueId(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-background min-h-[44px] touch-manipulation">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setWeekStart(format(subWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd'))}
          className="w-11 h-11 flex items-center justify-center rounded-lg border touch-manipulation" aria-label="Previous week">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center text-sm font-medium">Week of {format(parseISO(weekStart), 'd MMM yyyy')}</div>
        <button type="button" onClick={() => setWeekStart(format(addWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd'))}
          className="w-11 h-11 flex items-center justify-center rounded-lg border touch-manipulation" aria-label="Next week">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      {!isThisWeek && (
        <button type="button" onClick={() => setWeekStart(getMonday(new Date()))}
          className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation">
          This week
        </button>
      )}

      <div className="space-y-2">
        {dates.map((dateStr, i) => {
          const d = getDay(dateStr)
          const isToday = dateStr === today
          const variance = d?.total_income != null ? d.variance : null
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => setSelectedDate(dateStr)}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl border bg-card px-3 py-3 text-left touch-manipulation min-h-[64px]',
                isToday && 'ring-2 ring-primary/30',
              )}
            >
              <div className="w-14 shrink-0">
                <div className="text-sm font-semibold">{DAY_NAMES[i]}</div>
                <div className="text-xs text-muted-foreground">{format(parseISO(dateStr), 'd MMM')}</div>
              </div>
              <div className="flex-1 min-w-0">
                {d?.total_income != null
                  ? <div className="text-sm font-semibold">{fmt(d.total_income)}</div>
                  : <div className="text-xs text-muted-foreground">No report</div>}
              </div>
              <div className="text-right shrink-0">
                <StatusBadge status={d?.status ?? 'none'} />
                {variance != null && (
                  variance === 0 ? (
                    <div className="text-xs text-green-600 mt-1 flex items-center justify-end gap-0.5">
                      <Check className="w-3 h-3" /> Balanced
                    </div>
                  ) : (
                    <div className={cn('text-xs mt-1', variance < 0 ? 'text-red-600' : 'text-amber-600')}>
                      {variance > 0 ? '+' : ''}{fmt(variance)}
                    </div>
                  )
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="rounded-2xl border bg-card shadow-sm p-4 space-y-2">
        <h3 className="text-sm font-semibold mb-1">Week total</h3>
        <div className="flex justify-between text-sm"><span>Income</span><span className="font-medium">{fmt(weekTotals.income)}</span></div>
        <div className="flex justify-between text-sm"><span>Takings</span><span className="font-medium">{fmt(weekTotals.takings)}</span></div>
        <div className={cn(
          'flex justify-between text-sm font-semibold pt-1 border-t',
          weekVariance === 0 ? 'text-green-600' : weekVariance < 0 ? 'text-red-600' : 'text-amber-600',
        )}>
          <span>Variance</span>
          <span>{weekVariance === 0 ? 'Balanced' : `${weekVariance > 0 ? '+' : ''}${fmt(weekVariance)}`}</span>
        </div>
      </div>
    </div>
  )
}
