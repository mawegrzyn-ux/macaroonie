// src/components/ai/venueWords.js
//
// The venue's own words for speech (Pepper-first step 6c): fridge and hold
// station names, dishes, staff first names and suppliers, from
// GET /api/ai/venue-words (each group only where the person can see it).
//
//   const words = useVenueWords(venueId)   // null: every venue's
//   listen({ hints: words.hints, onText: t => setText(words.fix(t)) })
//
// hints go to the recogniser where it takes them (the Office app's phone
// recogniser); fix() snaps a near miss to the venue's word after it
// (shared/venueWords.js), never touching a number.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { snapToWords } from '@shared/venueWords.js'

export function useVenueWords(venueId = null) {
  const api = useApi()
  const { data } = useQuery({
    queryKey: ['venue-words', venueId || 'all'],
    queryFn: () => api.get('/ai/venue-words' + (venueId ? '?venue_id=' + venueId : '')),
    staleTime: 10 * 60_000,
    retry: false,
  })
  return useMemo(() => {
    const words = data?.words || []
    return { words, hints: words.length ? words : undefined, fix: text => (words.length ? snapToWords(text, words).text : text) }
  }, [data])
}
