// src/components/stock/ItemHistory.jsx
//
// One item's history at a venue (inventory phase 4a): its ledger from
// loadStockMoves(), newest first, each delivery, approved count and
// adjustment with the change it made and the balance after it
// (runningBalance() in shared/stock.js, worked out by the API), and with
// Costing view each move's value (a delivery's, its supplier's price, with
// purchasing prices as well: the API leaves it out otherwise). A count's
// change is what it found over what was expected. From a day, picked with
// the date button.
//
//   ItemHistory({ venueId, item, onClose })
//   API GET /api/stock/venues/:venueId/items/:itemId/moves?from=

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DateButton, ErrorNote } from '@/components/staff/shared'
import { Drawer, btn } from '@/components/purchasing/shared'
import { qty, signedBase, when, pounds } from '@/components/stock/shared'

const KIND_CLS = { delivery: 'bg-emerald-100 text-emerald-900', count: 'bg-sky-100 text-sky-900', adjustment: 'bg-amber-100 text-amber-900' }

export default function ItemHistory({ venueId, item, onClose }) {
  const api = useApi()
  const [from, setFrom] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', venueId, 'moves', item.item_id, from],
    queryFn: () => api.get(`/stock/venues/${venueId}/items/${item.item_id}/moves` + (from ? '?from=' + from : '')),
  })
  const unit = item.base_unit
  return (
    <Drawer title={item.name} subtitle="Stock history" onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2" data-testid="stock-history">
        <span className="text-sm">On hand <strong data-testid="stock-history-on-hand">{data?.on_hand?.on_hand == null ? 'not counted' : qty(data.on_hand.on_hand, unit)}</strong></span>
        <span className="flex-1" />
        <DateButton value={from} onChange={setFrom} label="From" placeholder="Every move" />
        {from && <button type="button" className={btn.ghost} onClick={() => setFrom('')}>All</button>}
      </div>
      {data?.note && <p className="text-xs text-muted-foreground">{data.note}</p>}
      <ErrorNote error={error} />
      {isLoading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <div className="rounded-xl border bg-background divide-y overflow-hidden" data-testid="stock-history-rows">
          {(data?.moves || []).map((m, n) => (
            <div key={n} className="px-3 py-2.5 text-sm grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5" data-testid="stock-history-row" data-kind={m.kind}>
              <span className="min-w-0">
                <span className={cn('mr-2 rounded px-1.5 py-0.5 text-[11px] font-medium', KIND_CLS[m.kind])}>{m.kind_label}</span>
                <span className="text-muted-foreground">{when(m.at)}</span>
                <span className="block truncate">{m.source?.label}{m.by ? <span className="text-muted-foreground"> · {m.by}</span> : null}</span>
              </span>
              <span className="text-right tabular-nums">
                <span className="block font-medium" data-testid="stock-history-change">
                  {m.sets ? 'Counted ' + qty(m.qty_base, unit) : signedBase(m.change, unit)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {m.sets && m.change != null ? signedBase(m.change, unit) + ' on expected · ' : ''}
                  {m.balance == null ? 'before the first count' : 'balance ' + qty(m.balance, unit)}
                </span>
                {m.value != null && <span className="block text-xs">{pounds(m.value)}</span>}
              </span>
            </div>
          ))}
          {!data?.moves?.length && <p className="p-4 text-sm text-muted-foreground">Nothing moved {item.name} here{from ? ' since then' : ' yet'}.</p>}
        </div>
      )}
      {data?.showing && <p className="text-xs text-muted-foreground">The latest {data.showing} of {data.of} moves.</p>}
    </Drawer>
  )
}
