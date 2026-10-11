// src/pages/mobile/MobilePurchasing.jsx
//
// Purchasing on a phone (/mobile/purchasing): the same PurchasingApp as the
// desktop page, one column, with a venue picker when there's more than one.

import { VenuePicker, useVenues, useVenueChoice } from '@/components/staff/shared'
import { PurchasingApp } from '@/components/purchasing/ordering'

export default function MobilePurchasing() {
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  return (
    <div className="min-h-full flex flex-col">
      {venues.length > 1 && (
        <div className="px-3 pt-3">
          <VenuePicker venues={venues} venueId={venueId} onChange={setVenueId} />
        </div>
      )}
      <div className="flex-1 flex flex-col">
        <PurchasingApp key={venueId} venueId={venueId} phone />
      </div>
    </div>
  )
}
