// src/pages/mobile/MobileOrders.jsx
//
// Online orders on a phone (/mobile/orders): the same board as the Online
// orders page (components/orders/shared.jsx), one column with status
// tabs. Sold out, pause, today's hours and sound share one row of buttons.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban } from 'lucide-react'
import { useApi } from '@/lib/api'
import { OrderBoard, AvailabilityModal, PauseButton, HoursButton, HoursNotice, useOrders, todayIn } from '@/components/orders/shared'
import { usePermission } from '@/hooks/usePermission'

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
  const ordering = board.data?.ordering
  const { canManage } = usePermission('web_orders')

  const tools = canManage && (
    <>
      <button onClick={() => setSoldOut(true)} data-testid="orders-sold-out"
        className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 min-h-[48px] rounded-md border bg-background text-sm font-medium touch-manipulation">
        <Ban className="w-4 h-4 shrink-0" /> Sold out
      </button>
      <PauseButton venueId={venueId} ordering={ordering} iconOnly />
      <HoursButton venueId={venueId} ordering={ordering} iconOnly />
    </>
  )
  const banner = (
    <>
      {ordering?.is_paused && (
        <div className="rounded-md bg-amber-100 text-amber-900 p-3 text-sm font-medium mb-2">Orders are paused.</div>
      )}
      <HoursNotice ordering={ordering} />
    </>
  )

  return (
    <div className="p-3 space-y-3">
      {venues.length > 1 && (
        <select value={venueId} onChange={e => setVenueId(e.target.value)} className="w-full border rounded-md px-3 min-h-[48px] text-sm bg-background">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      {venueId && <OrderBoard venueId={venueId} date={date} compact tools={tools} banner={banner} />}
      {soldOut && <AvailabilityModal venueId={venueId} onClose={() => setSoldOut(false)} />}
    </div>
  )
}
