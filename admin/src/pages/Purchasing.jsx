// src/pages/Purchasing.jsx
//
// Purchasing for the restaurant (/purchasing, module purchasing): order
// from the venue's order lists, then send, print and book in the purchase
// orders. Everything is in components/purchasing/ordering.jsx, shared with
// /mobile/purchasing.

import { ShoppingCart } from 'lucide-react'
import { PageHeader, VenuePicker, useVenues, useVenueChoice } from '@/components/staff/shared'
import { PurchasingApp } from '@/components/purchasing/ordering'

export default function Purchasing() {
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={ShoppingCart} title="Purchasing">
        <VenuePicker venues={venues} venueId={venueId} onChange={setVenueId} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <PurchasingApp key={venueId} venueId={venueId} />
      </div>
    </div>
  )
}
