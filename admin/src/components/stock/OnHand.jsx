// src/components/stock/OnHand.jsx
//
// The Stock page's On hand tab (inventory phase 4a; moved from the Inventory
// page's Stock tab, purchasing/stockOnHand.jsx, migration 287): each active
// item at the venue with what is on hand (the last approved count plus the
// deliveries, adjustments, waste, transfers and sales since: stockOnHand() in
// shared/stock.js, worked out by the API), its last count, what came in and
// went since, its storage areas, below par, and with Costing view its value.
// Tapping an item opens its history (ItemHistory: the ledger with the running
// balance). Sales are taken off by usage from sales (phase 5) up to its last
// run: the tab says up to when.
//
//   OnHand({ venueId, openItem, onOpenItem })   API GET /api/stock/venues/:id

import { lazy, Suspense, useMemo, useState } from 'react'
import { Info, Loader2, Search, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inputCls, ErrorNote } from '@/components/staff/shared'
import { btn } from '@/components/purchasing/shared'
import { canScan, scanBarcode } from '@/lib/officeApp'
import { useStockList, matchItem, qty, when, pounds } from '@/components/stock/shared'

const ItemHistory = lazy(() => import('@/components/stock/ItemHistory'))

export default function OnHand({ venueId, openItem, onOpenItem }) {
  const { data, isLoading, error } = useStockList(venueId)
  const [search, setSearch] = useState('')
  const items = useMemo(() => data?.items || [], [data])
  const rows = items.filter(i => matchItem(i, search))
  const values = !!data?.sees_values
  const cols = values ? 'sm:grid-cols-[1fr_8rem_8rem_10rem_6rem]' : 'sm:grid-cols-[1fr_8rem_8rem_10rem]'
  const opened = openItem ? items.find(i => i.item_id === openItem) : null
  return (
    <div className="space-y-3" data-testid="stock-on-hand">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code or barcode"
            className={cn(inputCls, 'pl-9 h-12')} data-testid="stock-search" />
        </div>
        {canScan() && (
          <button type="button" className={cn(btn.outline, 'h-12 w-12 px-0')} aria-label="Scan a barcode" data-testid="stock-scan"
            onClick={async () => { const code = await scanBarcode().catch(() => null); if (code) setSearch(code) }}>
            <ScanLine className="w-4 h-4" />
          </button>
        )}
        {values && data?.total_value != null && (
          <span className="text-sm text-muted-foreground" data-testid="stock-total-value">Stock value <strong className="text-foreground">{pounds(data.total_value)}</strong></span>
        )}
      </div>
      {data?.note && (
        <p className="flex items-start gap-2 text-sm rounded-lg border bg-background px-3 py-2" data-testid="stock-note">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />{data.note}
        </p>
      )}
      <ErrorNote error={error} />
      {isLoading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="bg-background border rounded-xl overflow-hidden">
          <div className={cn('grid grid-cols-[1fr_auto] gap-2 px-4 py-2 section-head text-xs font-semibold', cols)}>
            <span>Item</span><span className="text-right">On hand</span>
            <span className="text-right hidden sm:block">Moved since the count</span><span className="text-right hidden sm:block">Last count</span>
            {values && <span className="text-right hidden sm:block">Value</span>}
          </div>
          <div className="divide-y" data-testid="stock-rows">
            {rows.map(i => (
              <button key={i.item_id} type="button" onClick={() => onOpenItem(i.item_id)} data-testid="stock-row" data-item={i.name}
                className={cn('w-full grid grid-cols-[1fr_auto] gap-2 px-4 py-3 text-left text-sm hover:bg-muted/40 touch-manipulation min-h-[48px]', cols)}>
                <span className="min-w-0">
                  <span className="font-medium block truncate">{i.name}</span>
                  <span className="text-xs text-muted-foreground block truncate">{[i.category_name, i.areas?.join(', '), i.code].filter(Boolean).join(' · ')}</span>
                  {i.low && <span className="mt-0.5 block w-fit rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-900" data-testid="stock-low">Below par ({qty(i.par_base, i.base_unit)})</span>}
                </span>
                <span className="text-right tabular-nums font-medium" data-testid="stock-on-hand-qty">
                  {i.on_hand == null ? <span className="text-muted-foreground font-normal">Not counted</span> : qty(i.on_hand, i.base_unit)}
                </span>
                <span className="text-right tabular-nums hidden sm:block text-muted-foreground">
                  {[
                    i.received_since ? '+' + qty(i.received_since, i.base_unit) : null,
                    i.adjusted_since ? (i.adjusted_since > 0 ? '+' : '-') + qty(Math.abs(i.adjusted_since), i.base_unit) + ' adj.' : null,
                    i.wasted_since ? '-' + qty(Math.abs(i.wasted_since), i.base_unit) + ' waste' : null,
                    i.transferred_since ? (i.transferred_since > 0 ? '+' : '-') + qty(Math.abs(i.transferred_since), i.base_unit) + ' moved' : null,
                    i.used_since ? (i.used_since > 0 ? '+' : '-') + qty(Math.abs(i.used_since), i.base_unit) + ' sold' : null,
                  ].filter(Boolean).join(' ') || '–'}
                </span>
                <span className="text-right text-xs text-muted-foreground hidden sm:block">{i.counted_at ? qty(i.counted, i.base_unit) + ', ' + when(i.counted_at) : 'Never'}</span>
                {values && <span className="text-right tabular-nums hidden sm:block">{i.value == null ? '–' : pounds(i.value)}</span>}
              </button>
            ))}
            {!rows.length && <p className="p-4 text-sm text-muted-foreground">No items{search ? ' match' : ' in use yet'}.</p>}
          </div>
        </div>
      )}
      {opened && (
        <Suspense fallback={null}>
          <ItemHistory venueId={venueId} item={opened} onClose={() => onOpenItem(null)} />
        </Suspense>
      )}
    </div>
  )
}
