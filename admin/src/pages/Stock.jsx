// src/pages/Stock.jsx
//
// Stock (/stock, module stock; inventory phase 4a, docs/INVENTORY.md 6 and
// 10.1), loaded on demand from src/routes/stock.jsx. A venue's stock in
// tabs, each loaded on demand too:
//   On hand       every item with what is on hand, tap for its history
//                 (moved from the Inventory page's Stock tab)
//   Counts        the counts, starting one, counting by area, review, approve
//   Adjustments   stock put right with a reason (Stock manage)
//   Waste         logging waste (Stock use), a day's waste with the till's
//                 voids marked wasted, undo and reverse (phase 4b)
//   Transfers     sending stock to another venue, receiving what is on its
//                 way here, cancelling, the history (phase 4b)
//   Settings      storage areas, key-item lists, approval and blind counts,
//                 the count day, waste reasons (Stock manage; read only below it)
// The address says where it opens: ?venue= &tab= (on-hand | counts |
// adjustments | waste | transfers | settings) &count= (a count) &item= (an
// item's history) &transfer= (a transfer to receive).
// API: routes/stock.js, routes/stockCounts.js, routes/stockSetup.js,
// routes/stockWaste.js, routes/stockTransfers.js.

import { lazy, Suspense, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boxes, Loader2 } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { PageHeader, Segmented, VenuePicker, useVenues, useVenueChoice } from '@/components/staff/shared'

const OnHand = lazy(() => import('@/components/stock/OnHand'))
const Counts = lazy(() => import('@/components/stock/Counts'))
const Adjustments = lazy(() => import('@/components/stock/Adjustments'))
const StockSettings = lazy(() => import('@/components/stock/StockSettings'))
const Waste = lazy(() => import('@/components/stock/Waste'))
const Transfers = lazy(() => import('@/components/stock/Transfers'))

// The tabs, in order.
const TABS = [
  { value: 'on-hand', label: 'On hand' },
  { value: 'counts', label: 'Counts' },
  { value: 'waste', label: 'Waste' },
  { value: 'transfers', label: 'Transfers' },
  { value: 'adjustments', label: 'Adjustments' },
  { value: 'settings', label: 'Settings' },
]

export default function Stock() {
  const { canView, canManage, loaded } = usePermission('stock')
  const [params, setParams] = useSearchParams()
  const { data: venues = [] } = useVenues()
  const [venueId, setVenueId] = useVenueChoice(venues)
  const tab = TABS.some(t => t.value === params.get('tab')) ? params.get('tab') : 'on-hand'
  const set = changes => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace: true })
  }
  // ?venue= (Today, a report's row, Pepper) picks the venue once.
  const asked = params.get('venue')
  useEffect(() => {
    if (asked && venues.some(v => v.id === asked)) { setVenueId(asked); set({ venue: '' }) }
  }, [asked, venues.length])
  if (loaded && !canView) {
    return <div className="h-full overflow-y-auto bg-page p-6 text-sm text-muted-foreground">Your role can&apos;t see stock: it needs Stock view.</div>
  }
  const wait = <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  return (
    <div className="h-full overflow-y-auto bg-page" data-testid="stock-page">
      <PageHeader icon={Boxes} title="Stock">
        <VenuePicker venues={venues} venueId={venueId} onChange={id => { setVenueId(id); set({ count: '', item: '', transfer: '' }) }} />
      </PageHeader>
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="overflow-x-auto">
          <Segmented value={tab} onChange={t => set({ tab: t === 'on-hand' ? '' : t, count: '', item: '', transfer: '' })} options={TABS} testid="stock-tabs" />
        </div>
        {!venueId ? wait : (
          <Suspense fallback={wait}>
            {tab === 'on-hand' && <OnHand venueId={venueId} openItem={params.get('item')} onOpenItem={id => set({ item: id })} />}
            {tab === 'counts' && <Counts venueId={venueId} countId={params.get('count')} onOpenCount={id => set({ count: id })} />}
            {tab === 'waste' && <Waste venueId={venueId} canManage={canManage} />}
            {tab === 'transfers' && <Transfers venueId={venueId} transferId={params.get('transfer')} onOpenTransfer={id => set({ transfer: id })} />}
            {tab === 'adjustments' && <Adjustments venueId={venueId} canManage={canManage} />}
            {tab === 'settings' && <StockSettings venueId={venueId} canManage={canManage} />}
          </Suspense>
        )}
      </div>
    </div>
  )
}
