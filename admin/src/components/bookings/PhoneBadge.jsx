// src/components/bookings/PhoneBadge.jsx
//
// The phone hub's Guest list tile badge (admin/src/mobile/registry.js
// `Badge`): today's bookings still on at the phone's venue, from the same
// query (and cache) as the phone's booking pages. Nothing when there are none.

import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { usePhoneVenue, venueToday, activeOf } from '@/components/bookings/phone'

export function TodayBookingsBadge() {
  const api = useApi()
  const [venueId, , , venue] = usePhoneVenue()
  const date = venueToday(venue?.timezone)
  const { data = [] } = useQuery({
    queryKey: ['bookings', venueId, date],
    queryFn: () => api.get(`/bookings?venue_id=${venueId}&date=${date}`),
    enabled: !!venueId,
    staleTime: 60_000,
  })
  const n = activeOf(data).length
  if (!n) return null
  return (
    <span data-testid="mobile-tile-count" aria-label={n + ' bookings today'}
      className="absolute top-2.5 right-2.5 min-w-[26px] h-[26px] px-1.5 rounded-full bg-[#0f5c4f] text-white text-xs font-bold flex items-center justify-center tabular-nums">
      {n}
    </span>
  )
}
