// src/pages/mobile/MobileWages.jsx
//
// Phone Wages view: venue picker and week navigator over the shared
// WeekWagesEditor (components/cashRecon/WagesTable.jsx), the same Name,
// Total, Paid, Paid on, Notes editor as the Cash Recon Wages page and the
// Cash Dashboard wage widgets, always as one card per person here. The
// phone hides Bank transfer (still filled from each person's pay method)
// and Paid on for all: entering an amount or Full sets Paid on to today
// when the week is this week. Edits save with Save; wages are not
// submitted (the days are).

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addWeeks, subWeeks, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useApi } from '@/lib/api'
import { getMonday } from '@/pages/CashRecon'
import { WeekWagesEditor } from '@/components/cashRecon/WagesTable'

export default function MobileWages() {
  const api = useApi()
  const [venueId,   setVenueId]   = useState('')
  const [weekStart, setWeekStart] = useState(getMonday(new Date()))

  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  useEffect(() => { if (!venueId && venues.length) setVenueId(venues[0].id) }, [venues, venueId])

  const isThisWeek = weekStart === getMonday(new Date())

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

      {venueId && <WeekWagesEditor venueId={venueId} weekStart={weekStart} layout="cards" showWeekNotes showBank={false} hidePaidOnForAll />}
    </div>
  )
}
