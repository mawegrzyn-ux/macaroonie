// src/pages/mobile/MobileStockWaste.jsx
//
// Logging waste on a phone (/mobile/stock-waste; inventory phase 4b,
// docs/INVENTORY.md 6.3), beside the counting page: the waste form in one
// column with a photo (the Office app's camera where it has one), and the
// day's waste at the venue under it, the till's voids marked wasted among it
// (read only), each with Undo for whoever logged it on the day. The Stock
// page's Waste tab has the rest (another day, the week's summary). Loaded on
// demand from src/routes/stock.jsx; ?venue= picks the venue once (Today, Pepper).

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { VenuePicker, useVenues, useVenueChoice } from '@/components/staff/shared'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { ErrorNote } from '@/components/staff/shared'
import WasteForm from '@/components/stock/WasteForm'
import { WasteList, useWasteDay } from '@/components/stock/Waste'
import { pounds } from '@/components/stock/shared'

export default function MobileStockWaste() {
  const { canView, canUse, loaded } = usePermission('stock')
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  const [params, setParams] = useSearchParams()
  const [saved, setSaved] = useState(null)
  const asked = params.get('venue')
  useEffect(() => {
    if (!asked || !venues.some(v => v.id === asked)) return
    setVenueId(asked)
    setParams(new URLSearchParams(), { replace: true })
  }, [asked, venues.length])
  const { data, isLoading, error } = useWasteDay(venueId, null)
  if (loaded && !canView) return <p className="p-4 text-sm text-muted-foreground">Your role can&apos;t see stock: it needs Stock view.</p>
  return (
    <div className="min-h-full p-3 space-y-3" data-testid="mobile-stock-waste">
      {venues.length > 1 && <VenuePicker venues={venues} venueId={venueId} onChange={setVenueId} />}
      {/* View only says why there is no form (rule 6); a shared device logs only at its own venue. */}
      {loaded && !canUse && <ReadOnlyNotice what="waste" />}
      {canUse && data?.venue_problem && <p className="rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground" data-testid="waste-venue-problem">{data.venue_problem}</p>}
      {canUse && venueId && !data?.venue_problem && (
        <div className="rounded-xl border bg-background p-3">
          <h2 className="text-sm font-semibold mb-2">Log waste</h2>
          <WasteForm venueId={venueId} phone onSaved={e => setSaved(e)} />
          {saved && <p className="mt-2 text-sm text-emerald-800" data-testid="waste-saved">Logged: {saved.name}. Undo it below if it was a mistake.</p>}
        </div>
      )}
      <div className="rounded-xl border bg-background overflow-hidden">
        <div className="section-head flex items-center gap-2 px-3 py-2.5 min-h-[48px]">
          <h2 className="text-sm font-semibold flex-1">Today&apos;s waste</h2>
          {data?.value != null && <span className="text-sm tabular-nums">{pounds(data.value)}</span>}
        </div>
        <ErrorNote error={error} />
        {isLoading || !venueId ? <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : data && <WasteList venueId={venueId} data={data} phone />}
      </div>
    </div>
  )
}
