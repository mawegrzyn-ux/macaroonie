// src/components/stock/Adjustments.jsx
//
// The Stock page's Adjustments tab (inventory phase 4a, docs/INVENTORY.md
// 6.4): stock put right for what fits no other record, always with a reason
// (Stock manage). A quantity in one of the item's units, minus to take stock
// off; Save sends it. An adjustment is never edited or deleted: Reverse adds
// the same quantity the other way (asked twice), dated at the adjustment it
// reverses so a count since then keeps its figure. Values with Costing view.
// Below Stock manage the tab is read only.
//
//   Adjustments({ venueId, canManage })
//   API GET/POST /api/stock/venues/:venueId/adjustments, POST /api/stock/adjustments/:id/reverse

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search, Undo2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, Segmented } from '@/components/staff/shared'
import { Card, NumInput, btn } from '@/components/purchasing/shared'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { useStockList, matchItem, signedBase, when, pounds, qty } from '@/components/stock/shared'

const REASONS = ['Found in another area', 'Damaged in storage', 'Used for staff food', 'Sample or tasting', 'Correction of a mistake']

function NewAdjustment({ venueId }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data } = useStockList(venueId)
  const [search, setSearch] = useState('')
  const [itemId, setItemId] = useState('')
  const [sign, setSign] = useState('off')
  const [amount, setAmount] = useState(null)
  const [unit, setUnit] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const items = useMemo(() => data?.items || [], [data])
  const item = items.find(i => i.item_id === itemId) || null
  const found = search.trim() ? items.filter(i => matchItem(i, search)).slice(0, 8) : []
  const save = useMutation({
    mutationFn: () => api.post(`/stock/venues/${venueId}/adjustments`, {
      item_id: itemId, qty: (sign === 'off' ? -1 : 1) * Number(amount), unit: unit || item.default_unit, reason: reason.trim(), note: note.trim() || null,
    }),
    onSuccess: () => {
      setItemId(''); setAmount(null); setReason(''); setNote(''); setSearch('')
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
  })
  const ready = item && amount > 0 && reason.trim()
  return (
    <Card title="Adjust stock">
      <div className="space-y-3" data-testid="stock-adjust-form">
        {!item ? (
          <Field label="Item">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find the item" className={cn(inputCls, 'pl-9 h-12')} data-testid="stock-adjust-search" />
            </div>
            {found.length > 0 && (
              <div className="mt-1 rounded-lg border divide-y">
                {found.map(i => (
                  <button key={i.item_id} type="button" onClick={() => { setItemId(i.item_id); setUnit(i.default_unit) }} data-testid="stock-adjust-pick"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted min-h-[48px] touch-manipulation">
                    {i.name} <span className="text-xs text-muted-foreground">on hand {qty(i.on_hand, i.base_unit)}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium flex-1">{item.name} <span className="text-xs text-muted-foreground">on hand {qty(item.on_hand, item.base_unit)}</span></span>
            <button type="button" className={btn.ghost} onClick={() => setItemId('')}>Change</button>
          </div>
        )}
        {item && (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <Segmented value={sign} onChange={setSign} options={[{ value: 'off', label: 'Take off' }, { value: 'on', label: 'Add' }]} testid="stock-adjust-sign" />
              <NumInput value={amount} onChange={setAmount} className="w-28 h-12 text-base" aria-label="Quantity" data-testid="stock-adjust-qty" />
              <select value={unit || item.default_unit} onChange={e => setUnit(e.target.value)} aria-label="Unit"
                className="h-12 rounded-lg border bg-background px-2 text-sm touch-manipulation">
                {item.units.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
              </select>
            </div>
            <Field label="Reason (needed)">
              <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} list="stock-adjust-reasons" className={cn(inputCls, 'h-12')} data-testid="stock-adjust-reason" />
              <datalist id="stock-adjust-reasons">{REASONS.map(r => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="Note (optional)">
              <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} className={cn(inputCls, 'h-12')} />
            </Field>
            <button type="button" className={btn.primary + ' h-12'} disabled={!ready || save.isPending} onClick={() => save.mutate()} data-testid="stock-adjust-save">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save adjustment
            </button>
          </>
        )}
        <ErrorNote error={save.error} />
      </div>
    </Card>
  )
}

export default function Adjustments({ venueId, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const [asking, setAsking] = useState(null)
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['stock', venueId, 'adjustments'], queryFn: () => api.get(`/stock/venues/${venueId}/adjustments`), enabled: !!venueId,
  })
  const reverse = useMutation({
    mutationFn: id => api.post(`/stock/adjustments/${id}/reverse`, {}),
    onSuccess: () => { setAsking(null); qc.invalidateQueries({ queryKey: ['stock'] }) },
  })
  const values = rows.some(r => 'value' in r)
  return (
    <div className="space-y-4" data-testid="stock-adjustments">
      {canManage ? <NewAdjustment venueId={venueId} /> : <ReadOnlyNotice what="the adjustments" />}
      <Card title="Adjustments" bodyClass="p-0">
        <ErrorNote error={error || reverse.error} />
        {isLoading ? <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
          <div className="divide-y" data-testid="stock-adjust-rows">
            {rows.map(r => (
              <div key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm" data-testid="stock-adjust-row" data-item={r.item_name}>
                <span className="flex-1 min-w-[12rem]">
                  <span className="font-medium">{r.item_name}</span> <span className="tabular-nums">{signedBase(r.qty_base, r.base_unit)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.reason}{r.note ? ' · ' + r.note : ''} · {when(r.adjusted_at)}{r.adjusted_by ? ' · ' + r.adjusted_by : ''}
                    {r.reverses_id && r.created_at ? ' · reversed ' + when(r.created_at) + ', dated as the adjustment it reverses' : ''}
                  </span>
                </span>
                {values && <span className="tabular-nums">{r.value == null ? '–' : pounds(r.value)}</span>}
                {r.reversed && <span className="text-xs text-muted-foreground">Reversed</span>}
                {canManage && !r.reversed && !r.reverses_id && (asking === r.id ? (
                  <span className="inline-flex gap-1">
                    <button type="button" className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs" onClick={() => reverse.mutate(r.id)} data-testid="stock-adjust-reverse-yes">Yes, reverse it</button>
                    <button type="button" className={btn.outline} onClick={() => setAsking(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className={btn.ghost} onClick={() => setAsking(r.id)} data-testid="stock-adjust-reverse"><Undo2 className="w-4 h-4" />Reverse</button>
                ))}
              </div>
            ))}
            {!rows.length && <p className="p-4 text-sm text-muted-foreground">No adjustments at this venue.</p>}
          </div>
        )}
      </Card>
    </div>
  )
}
