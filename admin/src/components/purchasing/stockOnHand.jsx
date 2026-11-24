// src/components/purchasing/stockOnHand.jsx
//
// Stock on hand and stock counts (Pepper-first step 8B3, migration 287), the
// Inventory page's Stock tab: each item at a venue with what is on hand (the
// last count plus what was received since: stockOnHand() in
// shared/procurement.js, worked out by the API), and a count sheet. A count
// is a list of items, not a flat form, so it is a panel here (the plain
// renderer draws only flat forms). Each line is typed in a unit that fits the
// item (kg or g for an item counted in grams); Save sends the whole count,
// the API keeps it in the item's base unit. Sales aren't taken off until
// dishes are linked to the items they use: the page says so.
//
//   StockOnHand({ onOpenItem })      the tab; API routes/stock.js

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Info, Loader2, Search } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useVenues, inputCls, ErrorNote } from '@/components/staff/shared'
import { usePurchasingMeta, NumInput, Drawer, btn } from '@/components/purchasing/shared'
import { UNITS, unitsForBase, formatBase, countToBase } from '@shared/procurement.js'

const when = at => (at ? new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

function CountSheet({ venue, items, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  // What was typed for each item: { qty, unit }; only items with a quantity are counted.
  const [lines, setLines] = useState({})
  const set = (id, patch) => setLines(l => ({ ...l, [id]: { unit: null, ...l[id], ...patch } }))
  const shown = items.filter(i => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()) || i.barcode === search.trim())
  const typed = items.filter(i => lines[i.id]?.qty != null && lines[i.id]?.qty !== '')
  const save = useMutation({
    mutationFn: () => api.post(`/stock/venues/${venue.id}/counts`, {
      note: note.trim() || null,
      lines: typed.map(i => ({ item_id: i.id, qty: Number(lines[i.id].qty), unit: lines[i.id].unit || i.base_unit })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock', venue.id] }); onClose() },
  })
  return (
    <Drawer title={'Count stock · ' + venue.name} onClose={onClose} wide
      footer={<>
        <button type="button" className={btn.primary} disabled={!typed.length || save.isPending} onClick={() => save.mutate()} data-testid="stock-count-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save count ({typed.length})
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <p className="text-sm text-muted-foreground">Type what is on the shelf now. Items left empty aren't counted and keep their last count.</p>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an item, or scan its barcode" className={cn(inputCls, 'pl-9')} />
      </div>
      <div className="divide-y border rounded-xl bg-background" data-testid="stock-count-lines">
        {shown.map(i => {
          const units = unitsForBase(i.base_unit)
          const l = lines[i.id] || {}
          const unit = l.unit || (i.base_unit === 'g' ? 'kg' : i.base_unit === 'ml' ? 'l' : 'each')
          const base = l.qty !== undefined && l.qty !== '' && l.qty != null ? countToBase(l.qty, unit, i.base_unit) : null
          return (
            <div key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="stock-count-line" data-item={i.name}>
              <span className="flex-1 min-w-[10rem] text-sm">
                <span className="font-medium">{i.name}</span>
                {i.counted != null && <span className="block text-xs text-muted-foreground">Last count {formatBase(i.counted, i.base_unit)}</span>}
              </span>
              <NumInput value={l.qty ?? null} onChange={v => set(i.id, { qty: v, unit })} className="w-28" aria-label={'Count of ' + i.name} />
              <select value={unit} onChange={e => set(i.id, { unit: e.target.value })} className={cn(inputCls, 'w-24')} aria-label="Unit">
                {units.map(u => <option key={u} value={u}>{UNITS[u].label}</option>)}
              </select>
              {base != null && unit !== i.base_unit && <span className="text-xs text-muted-foreground w-full text-right">= {formatBase(base, i.base_unit)}</span>}
            </div>
          )
        })}
        {!shown.length && <p className="p-4 text-sm text-muted-foreground">No items match.</p>}
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Note (optional), e.g. Sunday close" className={inputCls} />
      <ErrorNote error={save.error} />
    </Drawer>
  )
}

export function StockOnHand({ onOpenItem }) {
  const api = useApi()
  const { data: venues = [] } = useVenues()
  const { data: meta } = usePurchasingMeta()
  const [venueId, setVenueId] = useState('')
  const [counting, setCounting] = useState(false)
  const [search, setSearch] = useState('')
  const venue = venues.find(v => v.id === venueId) || venues[0] || null
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', venue?.id], queryFn: () => api.get('/stock/venues/' + venue.id), enabled: !!venue,
  })
  const items = useMemo(() => (data?.items || []).map(i => ({ ...i, id: i.item_id })), [data])
  const q = search.trim().toLowerCase()
  const rows = items.filter(i => !q || i.name.toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q) || i.barcode === q)
  const canCount = !!(meta?.can_order || meta?.can_setup)
  return (
    <div className="space-y-3" data-testid="stock-tab">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={venue?.id || ''} onChange={e => setVenueId(e.target.value)} className={cn(inputCls, 'w-auto')} aria-label="Venue" data-testid="stock-venue">
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code or barcode" className={cn(inputCls, 'pl-9')} />
        </div>
        {canCount && venue && (
          <button type="button" className={btn.primary} onClick={() => setCounting(true)} data-testid="stock-count-open">
            <ClipboardList className="w-4 h-4" />Count stock
          </button>
        )}
      </div>
      {data && !data.sales_counted && (
        <p className="flex items-start gap-2 text-sm rounded-lg border bg-muted/40 px-3 py-2" data-testid="stock-note">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />{data.note}
        </p>
      )}
      <ErrorNote error={error} />
      {isLoading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="bg-background border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_8rem_8rem_10rem] gap-2 px-4 py-2 section-head text-xs font-semibold">
            <span>Item</span><span className="text-right">On hand</span>
            <span className="text-right hidden sm:block">Received since</span><span className="text-right">Last count</span>
          </div>
          <div className="divide-y" data-testid="stock-rows">
            {rows.map(i => (
              <button key={i.id} type="button" onClick={() => onOpenItem?.(i.id)} data-testid="stock-row" data-item={i.name}
                className="w-full grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_8rem_8rem_10rem] gap-2 px-4 py-3 text-left text-sm hover:bg-muted/40 touch-manipulation min-h-[48px]">
                <span className="min-w-0">
                  <span className="font-medium block truncate">{i.name}</span>
                  <span className="text-xs text-muted-foreground">{[i.category_name, i.code, i.barcode].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-right tabular-nums font-medium" data-testid="stock-on-hand">{i.on_hand == null ? <span className="text-muted-foreground font-normal">Not counted</span> : formatBase(i.on_hand, i.base_unit)}</span>
                <span className="text-right tabular-nums hidden sm:block">{i.received_since ? '+' + formatBase(i.received_since, i.base_unit) : '–'}</span>
                <span className="text-right text-xs text-muted-foreground">{i.counted_at ? formatBase(i.counted, i.base_unit) + ', ' + when(i.counted_at) : 'Never'}</span>
              </button>
            ))}
            {!rows.length && <p className="p-4 text-sm text-muted-foreground">No items{q ? ' match' : ' in use yet'}.</p>}
          </div>
        </div>
      )}
      {counting && venue && <CountSheet venue={venue} items={items} onClose={() => setCounting(false)} />}
    </div>
  )
}

export default StockOnHand
