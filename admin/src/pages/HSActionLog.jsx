// src/pages/HSActionLog.jsx
// Standalone H&S Action Log page — see HSActionLogPanel in
// components/hsActionLog/shared.jsx for the actual implementation, which
// is also reused by the H&S Dashboard's action_log widget.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { useApi } from '@/lib/api'
import { HSActionLogPanel } from '@/components/hsActionLog/shared'

export default function HSActionLog() {
  const api = useApi()
  const [venueId, setVenueId] = useState('')

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })

  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id)
  }, [venues, venueId])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" /> Action log
        </h1>
        {venues.length > 1 && (
          <select value={venueId} onChange={e => setVenueId(e.target.value)}
            className="border rounded px-3 py-2 text-sm bg-background min-h-[44px]">
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </div>

      {!venueId ? (
        <p className="text-muted-foreground text-sm py-12 text-center">Select a venue to begin.</p>
      ) : (
        <HSActionLogPanel venueId={venueId} />
      )}
    </div>
  )
}
