// src/components/stock/shared.jsx
//
// What the Stock page's tabs and the phone's count page share (inventory
// phase 4a): the person's stock levels (GET /api/stock/meta), the venue's
// stock list (GET /api/stock/venues/:id: every active item with its on hand
// and the units it is counted in), quantity words, a count's status badge,
// and the editor for a line typed in several units (2 cases + 3 each +
// 400 g). Every figure is the API's (shared/stock.js); nothing is worked
// out here but the preview of a line's total, by the same entriesToBase().

import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { NumInput } from '@/components/purchasing/shared'
import { formatBase } from '@shared/procurement.js'
import { entriesToBase, signedBase, MAX_ENTRIES, COUNT_STATUSES, COUNT_KINDS } from '@shared/stock.js'
import { pounds } from '@shared/costing.js'

export { formatBase, signedBase, pounds, COUNT_STATUSES, COUNT_KINDS }

export function useStockMeta() {
  const api = useApi()
  return useQuery({ queryKey: ['stock', 'meta'], queryFn: () => api.get('/stock/meta'), staleTime: 60_000 })
}

/** The venue's stock list: every active item with on hand and its count units. */
export function useStockList(venueId, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: ['stock', venueId], queryFn: () => api.get('/stock/venues/' + venueId), enabled: !!venueId && enabled,
  })
}

export const when = at => (at ? new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
export const dayWords = at => (at ? new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
export const qty = (n, unit) => (n == null ? '–' : formatBase(n, unit))

const STATUS_CLS = {
  draft: 'bg-sky-100 text-sky-900', submitted: 'bg-amber-100 text-amber-900',
  approved: 'bg-emerald-100 text-emerald-900', cancelled: 'bg-muted text-muted-foreground',
}
export function CountStatus({ status }) {
  return (
    <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', STATUS_CLS[status])} data-testid="stock-count-status" data-status={status}>
      {COUNT_STATUSES[status] || status}
    </span>
  )
}

/** A name, code or barcode search over stock items (a scan types the barcode in). */
export function matchItem(i, q) {
  const t = String(q || '').trim().toLowerCase()
  if (!t) return true
  const scan = t.replace(/\s+/g, '')
  return i.name.toLowerCase().includes(t) || (i.code || '').toLowerCase().includes(t) || i.barcode === scan || (i.quote_barcodes || []).includes(scan)
}

/**
 * A line typed in several units: each entry a quantity and one of the
 * item's units (standard, its own, its packs), up to MAX_ENTRIES; the total
 * in the item's base unit below. onChange(entries) on every change.
 */
export function EntriesEditor({ item, entries, onChange, disabled, testid = 'stock-entries' }) {
  const units = item.units || []
  const list = entries?.length ? entries : [{ qty: null, unit: item.default_unit }]
  const set = (i, patch) => onChange(list.map((e, n) => (n === i ? { ...e, ...patch } : e)))
  const total = entriesToBase(list.filter(e => e.qty != null), units, item)
  const several = list.length > 1 || (list[0] && list[0].unit !== item.base_unit)
  return (
    <div className="space-y-1.5" data-testid={testid}>
      {list.map((e, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <NumInput value={e.qty ?? null} onChange={v => set(i, { qty: v })} disabled={disabled} className="w-24 h-12 text-base"
            aria-label={'Count of ' + item.name + (i ? ' (' + (i + 1) + ')' : '')} data-testid="stock-entry-qty" />
          <select value={e.unit || item.default_unit} onChange={ev => set(i, { unit: ev.target.value })} disabled={disabled}
            aria-label="Unit" data-testid="stock-entry-unit"
            className="h-12 min-w-0 flex-1 max-w-[14rem] rounded-lg border bg-background px-2 text-sm touch-manipulation">
            {units.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
          {list.length > 1 && !disabled && (
            <button type="button" onClick={() => onChange(list.filter((_, n) => n !== i))} aria-label="Take this unit off"
              className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        {!disabled && list.length < MAX_ENTRIES && (
          <button type="button" onClick={() => onChange([...list, { qty: null, unit: units.find(u => u.key !== list.at(-1)?.unit)?.key || item.default_unit }])}
            className="h-12 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1 hover:bg-muted touch-manipulation" data-testid="stock-entry-add">
            <Plus className="w-3.5 h-3.5" />Another unit
          </button>
        )}
        {several && total.qty_base != null && (
          <span className="text-xs text-muted-foreground" data-testid="stock-entry-total">= {formatBase(total.qty_base, item.base_unit)}</span>
        )}
        {total.problem && <span className="text-xs text-red-700">{total.problem}</span>}
      </div>
    </div>
  )
}
