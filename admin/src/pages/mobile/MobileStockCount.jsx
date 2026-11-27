// src/pages/mobile/MobileStockCount.jsx
//
// Counting stock on a phone (/mobile/stock-count; inventory phase 4a,
// docs/INVENTORY.md 6.2), since counting happens in the walk-in: the venue's
// count being taken, area by area, one column, with the Office app's scanner
// finding the line (CountSheet with `phone`), or starting one (Stock use).
// Approving is on the Stock page's Counts tab; a submitted count shows its
// review here too. Loaded on demand from src/routes/stock.jsx.

import { lazy, Suspense, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { VenuePicker, useVenues, useVenueChoice } from '@/components/staff/shared'
import { btn } from '@/components/purchasing/shared'
import { useCounts, StartCount } from '@/components/stock/Counts'
import { CountStatus, when, COUNT_KINDS } from '@/components/stock/shared'

const CountSheet = lazy(() => import('@/components/stock/CountSheet'))

export default function MobileStockCount() {
  const { canView, canUse, loaded } = usePermission('stock')
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  const { data: counts = [], isLoading } = useCounts(venueId)
  const [openId, setOpenId] = useState(null)
  if (loaded && !canView) return <p className="p-4 text-sm text-muted-foreground">Your role can&apos;t see stock: it needs Stock view.</p>
  const draft = counts.find(c => c.status === 'draft')
  const shown = openId || draft?.id || null
  const wait = <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  return (
    <div className="min-h-full p-3 space-y-3" data-testid="mobile-stock-count">
      {venues.length > 1 && <VenuePicker venues={venues} venueId={venueId} onChange={id => { setVenueId(id); setOpenId(null) }} />}
      {isLoading ? wait : shown ? (
        <>
          {openId && openId !== draft?.id && <button type="button" className={btn.ghost + ' h-12'} onClick={() => setOpenId(null)}>Back</button>}
          <Suspense fallback={wait}>
            <CountSheet key={shown} countId={shown} venueId={venueId} phone onClose={() => setOpenId(null)} />
          </Suspense>
        </>
      ) : (
        <>
          {canUse && <StartCount venueId={venueId} onStarted={setOpenId} />}
          <div className="rounded-xl border bg-background divide-y">
            {counts.filter(c => c.status === 'submitted').map(c => (
              <button key={c.id} type="button" onClick={() => setOpenId(c.id)} className="w-full flex items-center gap-2 px-3 py-3 text-left text-sm min-h-[56px] touch-manipulation">
                <span className="flex-1">{COUNT_KINDS[c.kind]?.label} · {when(c.counted_at)}</span><CountStatus status={c.status} />
              </button>
            ))}
            {!counts.some(c => c.status === 'submitted') && <p className="p-3 text-sm text-muted-foreground">No count is being taken here now.</p>}
          </div>
        </>
      )}
    </div>
  )
}
