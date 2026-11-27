// src/components/stock/WasteForm.jsx
//
// Logging waste (inventory phase 4b, docs/INVENTORY.md 6.3): an inventory
// item, a prep batch (a prep recipe) or a menu dish, how much, why (the
// group's reasons in WRAP's three kinds) and a note, with a photo on the
// phone (the Office app's camera where it has one: photoCapture()). Before it
// is saved the API says what it takes off stock (POST .../waste/preview: a
// batch or a dish broken into its items by its recipe, the value with Costing
// view, and what it couldn't break in, e.g. a draft Pepper read in and nobody
// checked); Save logs it (Stock use). Used by the Stock page's Waste tab and
// the phone's waste page (MobileStockWaste); loaded with them, on demand.
//
//   WasteForm({ venueId, phone, onSaved })
//   useWastePickers(venueId)   GET /api/stock/venues/:id/waste/pickers

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Loader2, Search, ScanLine, X } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Field, inputCls, ErrorNote, Segmented } from '@/components/staff/shared'
import { NumInput, btn } from '@/components/purchasing/shared'
import { canScan, scanBarcode, photoCapture } from '@/lib/officeApp'
import { matchItem, qty, pounds } from '@/components/stock/shared'
import { WASTE_KINDS, WASTE_KIND_KEYS } from '@shared/stock.js'

export { KindBadge } from '@/components/stock/shared'

export function useWastePickers(venueId) {
  const api = useApi()
  return useQuery({
    queryKey: ['stock', venueId, 'waste-pickers'], queryFn: () => api.get(`/stock/venues/${venueId}/waste/pickers`),
    enabled: !!venueId, staleTime: 60_000,
  })
}

const WHAT = [
  { value: 'item', label: 'An item' },
  { value: 'recipe', label: 'A prep batch' },
  { value: 'dish', label: 'A dish' },
]

/** The list a thing is picked from, by what it is. */
function choicesOf(p, what) {
  if (!p) return []
  if (what === 'item') return p.items
  if (what === 'recipe') return p.recipes
  return p.dishes
}

export default function WasteForm({ venueId, phone = false, onSaved }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: p, isLoading, error } = useWastePickers(venueId)
  const [what, setWhat] = useState('item')
  const [search, setSearch] = useState('')
  const [pickedId, setPickedId] = useState('')
  const [amount, setAmount] = useState(null)
  const [unit, setUnit] = useState('')
  const [typeId, setTypeId] = useState('')
  const [streamId, setStreamId] = useState('')
  const [reasonId, setReasonId] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState(null)
  const fileRef = useRef(null)
  useEffect(() => () => { if (photo?.preview) URL.revokeObjectURL(photo.preview) }, [photo])
  const list = useMemo(() => choicesOf(p, what), [p, what])
  const picked = list.find(x => x.id === pickedId) || null
  const found = search.trim() ? list.filter(x => (what === 'item' ? matchItem(x, search) : x.name.toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 8) : []
  const units = what === 'item' ? (picked?.units || []).map(u => ({ key: u.key, label: u.label })) : what === 'recipe' ? (picked?.units || []).map(u => ({ key: u, label: u })) : []
  const unitNow = unit || (what === 'item' ? picked?.default_unit : what === 'recipe' ? picked?.unit : null)
  const body = picked && amount > 0 && reasonId ? {
    what, [what === 'item' ? 'item_id' : what === 'recipe' ? 'recipe_id' : 'dish_id']: picked.id, qty: Number(amount),
    ...(what !== 'dish' && unitNow ? { unit: unitNow } : {}),
    ...(what === 'dish' && typeId ? { order_type_id: typeId } : {}),
    ...(what === 'dish' && streamId ? { revenue_stream_id: streamId } : {}),
    reason_id: reasonId, note: note.trim() || null,
  } : null
  // What it takes off stock, before it is saved (a batch or a dish through its recipe).
  const preview = useQuery({
    queryKey: ['stock', venueId, 'waste-preview', body], queryFn: () => api.post(`/stock/venues/${venueId}/waste/preview`, body),
    enabled: !!body, staleTime: 30_000, retry: false,
  })
  const reset = () => {
    setPickedId(''); setAmount(null); setUnit(''); setNote(''); setSearch(''); setTypeId(''); setStreamId('')
    if (fileRef.current) fileRef.current.value = ''
    setPhoto(null)
  }
  const save = useMutation({
    mutationFn: async () => {
      const e = await api.post(`/stock/venues/${venueId}/waste`, body)
      if (photo?.file) {
        try { await api.upload(`/stock/waste/${e.id}/photo`, photo.file) } catch { /* the entry stands without its photo */ }
      }
      return e
    },
    onSuccess: e => { reset(); qc.invalidateQueries({ queryKey: ['stock', venueId] }); onSaved?.(e) },
  })
  const choose = v => { setWhat(v); setPickedId(''); setUnit(''); setSearch('') }
  const reasons = p?.reasons || []
  const pv = preview.data
  if (isLoading) return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
  return (
    <div className="space-y-3" data-testid="waste-form">
      <ErrorNote error={error} />
      <Segmented value={what} onChange={choose} options={WHAT} testid="waste-what" className={phone ? 'w-full' : ''} />
      {!picked ? (
        <Field label={what === 'item' ? 'Which item' : what === 'recipe' ? 'Which prep batch' : 'Which dish'}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={what === 'item' ? 'Name, code or barcode' : 'Name'}
                className={cn(inputCls, 'pl-9 h-12')} data-testid="waste-search" />
            </div>
            {what === 'item' && canScan() && (
              <button type="button" className={cn(btn.outline, 'h-12 w-12 px-0')} aria-label="Scan a barcode"
                onClick={async () => { const code = await scanBarcode().catch(() => null); if (code) setSearch(code) }}>
                <ScanLine className="w-4 h-4" />
              </button>
            )}
          </div>
          {found.length > 0 && (
            <div className="mt-1 rounded-lg border divide-y bg-background">
              {found.map(x => (
                <button key={x.id} type="button" onClick={() => { setPickedId(x.id); setUnit(''); setSearch('') }} data-testid="waste-pick"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted min-h-[48px] touch-manipulation">
                  {x.name}
                  {x.menu && <span className="text-xs text-muted-foreground"> · {x.menu}{x.section ? ', ' + x.section : ''}</span>}
                  {x.status === 'draft' && <span className="text-xs text-muted-foreground"> · draft</span>}
                </button>
              ))}
            </div>
          )}
          {search.trim() && !found.length && <p className="mt-1 text-xs text-muted-foreground">Nothing matches.</p>}
        </Field>
      ) : (
        <div className="flex items-center gap-2 text-sm rounded-lg border bg-background px-3 py-2">
          <span className="font-medium flex-1" data-testid="waste-picked">{picked.name}</span>
          <button type="button" className={btn.ghost} onClick={() => setPickedId('')}>Change</button>
        </div>
      )}
      {picked && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={what === 'dish' ? 'How many' : 'How much'}>
              <NumInput value={amount} onChange={setAmount} className="w-28 h-12 text-base" aria-label="Quantity" data-testid="waste-qty" />
            </Field>
            {units.length > 0 && (
              <Field label="Unit">
                <select value={unitNow || ''} onChange={e => setUnit(e.target.value)} aria-label="Unit" data-testid="waste-unit"
                  className="h-12 min-w-[7rem] max-w-[14rem] rounded-lg border bg-background px-2 text-sm touch-manipulation">
                  {units.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                </select>
              </Field>
            )}
            {what === 'dish' && (p?.order_types || []).length > 0 && (
              <Field label="Order type">
                <select value={typeId} onChange={e => setTypeId(e.target.value)} aria-label="Order type" data-testid="waste-order-type"
                  className="h-12 min-w-[8rem] rounded-lg border bg-background px-2 text-sm touch-manipulation">
                  <option value="">Any</option>
                  {p.order_types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            )}
            {what === 'dish' && (p?.streams || []).length > 0 && (
              <Field label="Revenue stream">
                <select value={streamId} onChange={e => setStreamId(e.target.value)} aria-label="Revenue stream"
                  className="h-12 min-w-[8rem] rounded-lg border bg-background px-2 text-sm touch-manipulation">
                  <option value="">Any</option>
                  {p.streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Why" group>
            <div className="space-y-2" data-testid="waste-reasons">
              {WASTE_KIND_KEYS.map(k => {
                const of = reasons.filter(r => r.kind === k)
                if (!of.length) return null
                return (
                  <div key={k} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">{WASTE_KINDS[k].label}</span>
                    {of.map(r => (
                      <button key={r.id} type="button" onClick={() => setReasonId(r.id)} aria-pressed={reasonId === r.id} data-testid="waste-reason" data-reason={r.name}
                        className={cn('h-12 px-3 rounded-lg border text-sm touch-manipulation', reasonId === r.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                )
              })}
              {!reasons.length && <p className="text-sm text-muted-foreground">No waste reasons are switched on: someone with Stock manage adds them on Settings.</p>}
            </div>
          </Field>
          <Field label="Note (optional)">
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} className={cn(inputCls, 'h-12')} data-testid="waste-note" />
          </Field>
          <div>
            <input type="file" accept="image/*" capture={photoCapture()} ref={fileRef} className="hidden" data-testid="waste-photo-input"
              onChange={e => { const f = e.target.files?.[0]; if (f) setPhoto({ file: f, preview: URL.createObjectURL(f) }) }} />
            {photo ? (
              <div className="flex items-center gap-2">
                <img src={photo.preview} alt="The waste" className="h-16 w-16 rounded-lg object-cover border" />
                <button type="button" className={btn.ghost} onClick={() => { if (fileRef.current) fileRef.current.value = ''; setPhoto(null) }}><X className="w-4 h-4" />Remove the photo</button>
              </div>
            ) : (
              <button type="button" className={btn.outline + ' h-12'} onClick={() => fileRef.current?.click()} data-testid="waste-photo"><Camera className="w-4 h-4" />Add a photo</button>
            )}
          </div>
          {body && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm space-y-1" data-testid="waste-preview">
              {preview.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : pv ? (
                <>
                  <p className="font-medium">Takes off stock{pv.value != null ? ', worth ' + pounds(pv.value) : ''}:</p>
                  {pv.items.length ? (
                    <ul className="text-xs text-muted-foreground">
                      {pv.items.map(i => <li key={i.item_id}>{i.name}: {qty(i.qty_base, i.base_unit)}{i.value != null ? ' · ' + pounds(i.value) : ''}</li>)}
                    </ul>
                  ) : <p className="text-xs text-muted-foreground">Nothing: it can&apos;t be broken into items yet.</p>}
                  {pv.recipe && what === 'dish' && <p className="text-xs text-muted-foreground">By the recipe {pv.recipe.name}.</p>}
                  {pv.gaps.map(g => <p key={g} className="text-xs text-amber-800" data-testid="waste-gap">{g}</p>)}
                </>
              ) : <ErrorNote error={preview.error} />}
            </div>
          )}
          <button type="button" className={btn.primary + ' h-12' + (phone ? ' w-full' : '')} disabled={!body || save.isPending} onClick={() => save.mutate()} data-testid="waste-save">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Log waste
          </button>
        </>
      )}
      <ErrorNote error={save.error} />
    </div>
  )
}
