// src/pages/Purchasing.jsx
//
// Purchasing for the restaurant (/purchasing, module purchasing): order
// from the venue's order lists, then send, print and book in the purchase
// orders. Everything is in components/purchasing/ordering.jsx, shared with
// /mobile/purchasing. Settings (Purchasing setup manage) is here only:
// components/purchasing/noOrder.jsx.

import { ShoppingCart } from 'lucide-react'
import { PageHeader, VenuePicker, useVenues, useVenueChoice } from '@/components/staff/shared'
import { PurchasingApp } from '@/components/purchasing/ordering'
import { PurchasingSettingsButton } from '@/components/purchasing/noOrder'
import { usePurchasingMeta } from '@/components/purchasing/shared'

export default function Purchasing() {
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  const { data: meta } = usePurchasingMeta()
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={ShoppingCart} title="Purchasing">
        <VenuePicker venues={venues} venueId={venueId} onChange={setVenueId} />
        <PurchasingSettingsButton meta={meta} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <PurchasingApp key={venueId} venueId={venueId} />
      </div>
    </div>
  )
}
