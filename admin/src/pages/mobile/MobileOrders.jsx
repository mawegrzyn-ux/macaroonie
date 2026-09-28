// src/pages/mobile/MobileOrders.jsx
//
// Online orders on a phone (/mobile/orders): the same board as the Online
// orders page (components/orders/shared.jsx), one column with status
// tabs, plus pause and sold out.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban } from 'lucide-react'
import { useApi } from '@/lib/api'
import { OrderBoard, AvailabilityModal, PauseButton, useOrders, todayIn } from '@/components/orders/shared'

export default function MobileOrders() {
  const api = useApi()
  const [venueId, setVenueId] = useState(() => { try { return localStorage.getItem('maca_orders_venue') || '' } catch { return '' } })
  const [soldOut, setSoldOut] = useState(false)
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  useEffect(() => {
    if (venues.length && !venues.some(v => v.id === venueId)) setVenueId(venues[0].id)
  }, [venues, venueId])
  const venue = venues.find(v => v.id === venueId)
  const date = todayIn(venue?.timezone)
  const board = useOrders(venueId, date)

  return (
    <div className="p-3 space-y-3">
      {venues.length > 1 && (
        <select value={venueId} onChange={e => setVenueId(e.target.value)} className="w-full border rounded-md px-3 min-h-[44px] text-sm bg-background">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      <div className="flex gap-2">
        <button onClick={() => setSoldOut(true)} className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-md border text-sm font-medium touch-manipulation">
          <Ban className="w-4 h-4" /> Sold out
        </button>
        <PauseButton venueId={venueId} ordering={board.data?.ordering} />
      </div>
      {board.data?.ordering?.is_paused && (
        <div className="rounded-md bg-amber-100 text-amber-900 p-3 text-sm font-medium">Orders are paused.</div>
      )}
      {venueId && <OrderBoard venueId={venueId} date={date} compact />}
      {soldOut && <AvailabilityModal venueId={venueId} onClose={() => setSoldOut(false)} />}
    </div>
  )
}
