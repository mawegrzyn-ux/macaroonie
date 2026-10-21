// src/components/purchasing/invoice.jsx
//
// Supplier invoices on receiving (migration 197), used by ReceiveForm and
// PoDetail in ordering.jsx:
//
//   InvoiceReader    photos or a PDF of the invoice, read by Pepper
//                    (POST /api/ai/invoices/read); the reading is kept with
//                    the order and applied when the delivery is saved.
//   readingToForm()  what the reading means for the form: received
//                    quantities and invoice prices per order line, the
//                    invoice lines that weren't ordered (extras), the order
//                    lines the invoice doesn't mention, charges.
//   InvoiceLineNote  under an order line: what the invoice said for it.
//   ExtrasSection    invoice lines that weren't ordered: add one of the
//                    supplier's products, an inventory item packed as
//                    invoiced (or a new item, with Purchasing setup), call it
//                    what came instead of an ordered line, or leave it out.
//   PriceListModal   after saving (Purchasing setup manage): update the
//                    supplier prices from the invoice (company or this
//                    venue), add new products or substitutes as supplier
//                    prices with the supplier's own product name.
//   InvoiceList      the invoices kept with an order.
//
// Prices show only for people with purchasing_setup view (po.show_prices).

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Sparkles, Camera, Upload, FileText, X, Search, AlertTriangle, Plus, Receipt } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, Field, inputCls, ErrorNote, Segmented } from '@/components/staff/shared'
import { FileDropArea } from '@/components/FileDropArea'
import { useAiStatus } from '@/components/ai/ChatView'
import { prepareFile, sizeText } from '@/components/ai/attachments'
import { NumInput, StorageBadge, btn, money, fmtDate, fileToBase64, useCategories, IS_TOUCH } from '@/components/purchasing/shared'
import { UNITS, unitsForBase, packBaseQty, fmtNum, formatBase } from '@shared/procurement.js'
import { ASSISTANT_NAME } from '@shared/assistant.js'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf,.pdf'
const MAX_FILES = 6
const errText = e => e?.body?.error || e?.message || 'Something went wrong'
let nextKey = 1

function useElapsed(on) {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!on) { setS(0); return undefined }
    const t0 = Date.now()
    const id = setInterval(() => setS(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [on])
  return s
}

// ── Reading ─────────────────────────────────────────────────────

export function InvoiceReader({ po, onRead, disabled }) {
  const api = useApi()
  const { data: ai } = useAiStatus()
  const [files, setFiles] = useState([])   // { key, file, preview }
  const [reading, setReading] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const camRef = useRef(null)
  const elapsed = useElapsed(reading)
  useEffect(() => () => files.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), []) // eslint-disable-line react-hooks/exhaustive-deps

  if (ai && !ai.can_chat) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="inv-no-ai">
        Reading the invoice needs {ASSISTANT_NAME}, which isn&apos;t available
        {ai.configured === false ? ' on this server' : !ai.enabled ? ' (switched off for your group)' : ' to your role'}. Fill in what arrived below.
      </p>
    )
  }

  async function add(list) {
    setError(null)
    const room = MAX_FILES - files.length
    if (room <= 0) { setError('Up to ' + MAX_FILES + ' files at a time.'); return }
    const next = []
    for (const f of [...list].slice(0, room)) {
      if (!/^image\//.test(f.type) && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setError(f.name + ' isn\'t a photo or a PDF.'); continue }
      const ready = await prepareFile(f)
      next.push({ key: 'f' + nextKey++, file: ready, preview: /^image\//.test(ready.type) ? URL.createObjectURL(ready) : null })
    }
    setFiles(fs => [...fs, ...next])
  }

  async function read() {
    setReading(true)
    setError(null)
    try {
      const payload = []
      for (const f of files) payload.push({ name: f.file.name, data: await fileToBase64(f.file) })
      const res = await api.post('/ai/invoices/read', { po_id: po.id, files: payload })
      if (!res?.invoice?.lines) throw new Error(ASSISTANT_NAME + '\'s answer didn\'t arrive. Try again.')
      onRead(res)
    } catch (e) {
      setError(errText(e))
    } finally {
      setReading(false)
    }
  }

  const pick = e => { const l = [...(e.target.files || [])]; e.target.value = ''; add(l) }
  return (
    <div className="space-y-3" data-testid="inv-reader">
      <FileDropArea onFiles={add} onRefused={setError} disabled={reading || disabled} kinds={['image', 'pdf']} label="Drop to add">
        <div className="rounded-lg border border-dashed bg-muted/20 p-3">
          {files.length === 0 ? (
            <div className="h-20 flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-1">
              <Receipt className="w-5 h-5" />
              <span>Photograph the invoice or delivery note, or drop a PDF of it here</span>
            </div>
          ) : (
            <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2" data-testid="inv-file-list">
              {files.map((f, i) => (
                <li key={f.key} className="relative rounded-md border bg-background overflow-hidden aspect-[3/4] flex items-center justify-center">
                  {f.preview
                    ? <img src={f.preview} alt={'Page ' + (i + 1)} className="w-full h-full object-cover" draggable={false} />
                    : <span className="text-xs text-center px-1 break-all"><FileText className="w-5 h-5 mx-auto mb-1" />{f.file.name}</span>}
                  <span className="absolute left-1 bottom-1 text-[10px] bg-background/90 rounded px-1">{i + 1} · {sizeText(f.file.size)}</span>
                  <button type="button" onClick={() => setFiles(fs => fs.filter(x => x.key !== f.key))} aria-label={'Remove ' + f.file.name} disabled={reading}
                    className="absolute top-1 right-1 w-8 h-8 rounded-full bg-background/90 border flex items-center justify-center touch-manipulation">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FileDropArea>
      <input ref={fileRef} type="file" accept={ACCEPT} multiple className="sr-only" data-testid="inv-file-input" onChange={pick} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
      <div className="flex flex-wrap items-center gap-2 relative">
        {IS_TOUCH && <button type="button" className={btn.outline} onClick={() => camRef.current?.click()} disabled={reading || disabled}><Camera className="w-4 h-4" />Take a photo</button>}
        <button type="button" className={btn.outline} onClick={() => fileRef.current?.click()} disabled={reading || disabled}><Upload className="w-4 h-4" />Choose files</button>
        <button type="button" className={cn(btn.primary, 'ml-auto')} onClick={read} disabled={!files.length || reading || disabled} data-testid="inv-read">
          {reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {reading ? `${ASSISTANT_NAME} is reading it… ${elapsed}s` : `Read it with ${ASSISTANT_NAME}`}
        </button>
      </div>
      {error && <p className="text-sm text-destructive" role="alert" data-testid="inv-error">{error}</p>}
    </div>
  )
}

/**
 * What a reading means for the receive form:
 *   rows     { lineId: { received_qty, status, note } } to set
 *   lineInv  { lineId: { idx, price, description, code, pack_text, qty, substitute } }
 *   extras   invoice products not on the order (see ExtrasSection)
 *   missing  order line ids the invoice doesn't mention
 *   charges  delivery charges, deposits, discounts
 */
export function readingToForm(po, res) {
  const lines = res.invoice.lines
  const byLine = new Map()
  const extras = []
  const charges = []
  const cat = new Map((res.catalogue || []).map(q => [q.quote_id, q]))
  for (const l of lines) {
    if (l.is_charge) { charges.push(l); continue }
    const m = l.match
    if (m?.kind === 'line' && po.lines.some(x => x.id === m.line_id)) {
      if (!byLine.has(m.line_id)) byLine.set(m.line_id, [])
      byLine.get(m.line_id).push(l)
    } else if (m?.kind === 'quote' && cat.has(m.quote_id)) {
      const q = cat.get(m.quote_id)
      extras.push(extraOf(l, {
        mode: 'add',
        item: { id: q.item_id, name: q.item_name, base_unit: q.base_unit, storage: q.storage },
        quote_id: q.quote_id, quote_label: [q.product_name, q.pack_label].filter(Boolean).join(' · '),
      }))
    } else {
      extras.push(extraOf(l))
    }
  }
  const rows = {}
  const lineInv = {}
  for (const [lineId, ls] of byLine) {
    const first = ls[0]
    const qty = ls.reduce((n, l) => n + (Number(l.qty_packs) || 0), 0)
    const sub = ls.some(l => l.match.substitute)
    rows[lineId] = { received_qty: qty, ...(sub ? { status: 'substituted', note: 'Came as ' + first.description } : { status: null }) }
    lineInv[lineId] = {
      idx: first.idx, price: first.price_pack ?? null, description: first.description, code: first.code,
      pack_text: first.pack_text, qty, substitute: sub, others: ls.slice(1).map(l => l.idx),
    }
  }
  const missing = po.lines.filter(l => !l.added_on_receipt && !byLine.has(l.id)).map(l => l.id)
  return { rows, lineInv, extras, missing, charges }
}

export function extraOf(l, patch = {}) {
  return {
    key: 'x' + l.idx, idx: l.idx, description: l.description, code: l.code, pack_text: l.pack_text,
    qty: Number(l.qty_packs) > 0 ? Number(l.qty_packs) : 1, price: l.price_pack ?? null, vat_rate: l.vat_rate,
    mode: null, item: null, quote_id: null, quote_label: '', line_id: null,
    pack: l.pack ? { name: 'pack', ...l.pack } : null,
    ...patch,
  }
}

/** Why an extra can't be saved yet, or null. */
export function extraProblem(x) {
  if (!x.mode) return 'Choose what this is'
  if (x.mode === 'skip') return null
  if (x.mode === 'line') return x.line_id ? null : 'Pick the ordered line it came instead of'
  if (!x.item) return 'Pick the inventory item'
  if (!(x.qty > 0)) return 'Enter how many arrived'
  if (x.quote_id) return null
  if (!x.pack?.unit || !x.pack?.qty) return 'Say how it came packed'
  if (!packBaseQty({ pack_count: x.pack.count || 1, pack_qty: x.pack.qty, pack_unit: x.pack.unit }, x.item.base_unit)) {
    return `A ${UNITS[x.pack.unit]?.label || x.pack.unit} pack doesn't fit ${x.item.name}`
  }
  return null
}

// ── Under an order line ─────────────────────────────────────────

export function InvoiceLineNote({ inv, line, prices, onPrice, onUnlink }) {
  const differs = prices && inv.price != null && line.price != null && Math.abs(inv.price - line.price) >= 0.005
  return (
    <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs space-y-1.5" data-testid="inv-line-note">
      <p className="flex flex-wrap items-start gap-x-2">
        <span className="flex-1 min-w-[160px]">
          On the invoice: <strong>{inv.description}</strong>{inv.code ? ` (${inv.code})` : ''}{inv.pack_text ? ` · ${inv.pack_text}` : ''} · {fmtNum(inv.qty)}
          {inv.others?.length ? ` (over ${inv.others.length + 1} lines)` : ''}
        </span>
        {onUnlink && (
          <button type="button" className="underline touch-manipulation min-h-[32px]" onClick={onUnlink}>Not this line</button>
        )}
      </p>
      {prices && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Invoice price per pack</span>
          <NumInput value={inv.price} onChange={onPrice} className="h-9 w-24 text-xs" aria-label={'Invoice price of ' + line.item_name} />
          {differs && (
            <span className={cn('px-1.5 py-0.5 rounded font-medium', inv.price > line.price ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-900')}>
              ordered at {money(line.price)} ({inv.price > line.price ? '+' : ''}{Math.round(((inv.price - line.price) / (line.price || 1)) * 100)}%)
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Invoice lines not on the order ──────────────────────────────

export function PackFields({ value, onChange, baseUnit }) {
  const v = value || { name: 'pack', count: 1, qty: null, unit: unitsForBase(baseUnit)[0] }
  const units = baseUnit ? unitsForBase(baseUnit) : Object.keys(UNITS)
  const set = (k, x) => onChange({ ...v, [k]: x })
  const pbq = baseUnit ? packBaseQty({ pack_count: v.count || 1, pack_qty: v.qty, pack_unit: v.unit }, baseUnit) : null
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1.3fr_0.7fr_auto_0.9fr_auto] gap-2 items-center">
        <input className={cn(inputCls, 'h-10')} value={v.name || ''} onChange={e => set('name', e.target.value)} aria-label="Pack name" placeholder="Case" />
        <NumInput value={v.count} onChange={x => set('count', x)} className="h-10" aria-label="How many in the pack" />
        <span className="text-sm text-muted-foreground">×</span>
        <NumInput value={v.qty} onChange={x => set('qty', x)} className="h-10" aria-label="Size of each" placeholder="Size" />
        <select className={cn(inputCls, 'h-10 w-auto')} value={units.includes(v.unit) ? v.unit : ''} onChange={e => set('unit', e.target.value)} aria-label="Unit">
          {!units.includes(v.unit) && <option value="">Unit…</option>}
          {units.map(u => <option key={u} value={u}>{UNITS[u].label}</option>)}
        </select>
      </div>
      {baseUnit && <p className="text-xs text-muted-foreground">{pbq ? `One ${v.name || 'pack'} = ${formatBase(pbq, baseUnit)}` : 'Enter the pack size'}</p>}
    </div>
  )
}

const MODES = [
  { value: 'add', label: 'Add it' },
  { value: 'line', label: 'Came instead' },
  { value: 'skip', label: 'Leave out' },
]

export function ExtrasSection({ po, extras, setExtras, prices, canSetup, lineInv, onCameInstead }) {
  const [picking, setPicking] = useState(null)   // extra key
  const set = (key, patch) => setExtras(xs => xs.map(x => (x.key === key ? { ...x, ...patch } : x)))
  const ordered = po.lines.filter(l => !l.added_on_receipt)
  return (
    <section className="rounded-xl border bg-background overflow-hidden" data-testid="inv-extras">
      <div className="section-head px-4 py-2">
        <h3 className="text-sm font-semibold">On the invoice, not ordered</h3>
      </div>
      <div className="divide-y">
        {extras.map(x => {
          const problem = extraProblem(x)
          return (
            <div key={x.key} className="px-4 py-3 space-y-2" data-testid="inv-extra">
              <div className="flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-medium">{x.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {[x.code, x.pack_text, `${fmtNum(x.qty)} on the invoice`, prices && x.price != null ? `${money(x.price)} each` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Segmented value={x.mode || ''} onChange={m => set(x.key, { mode: m })} options={MODES} />
              </div>

              {x.mode === 'add' && (
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {x.item ? (
                      <span className="flex-1 min-w-[160px] text-sm">
                        <strong>{x.item.name}</strong> <StorageBadge storage={x.item.storage} />
                        <span className="block text-xs text-muted-foreground">{x.quote_id ? x.quote_label : 'Packed as invoiced (not in the price list yet)'}</span>
                      </span>
                    ) : <span className="flex-1 min-w-[160px] text-sm text-amber-800">Which inventory item is it?</span>}
                    <button type="button" className={btn.outline} onClick={() => setPicking(x.key)}>
                      <Search className="w-4 h-4" />{x.item ? 'Change' : 'Pick the item'}
                    </button>
                  </div>
                  {x.item && !x.quote_id && <PackFields value={x.pack} baseUnit={x.item.base_unit} onChange={pack => set(x.key, { pack })} />}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">Arrived</span>
                    <NumInput value={x.qty} onChange={q => set(x.key, { qty: q })} className="h-10 w-24" aria-label={'How many ' + x.description + ' arrived'} />
                    {prices && (
                      <>
                        <span className="text-sm">Price per pack</span>
                        <NumInput value={x.price} onChange={p => set(x.key, { price: p })} className="h-10 w-24" aria-label={'Invoice price of ' + x.description} />
                      </>
                    )}
                  </div>
                </div>
              )}

              {x.mode === 'line' && (
                <Field label="It came instead of">
                  <select className={inputCls} value={x.line_id || ''} onChange={e => { const id = e.target.value || null; set(x.key, { line_id: id }); if (id) onCameInstead(id, x) }}>
                    <option value="">Choose the ordered line…</option>
                    {ordered.map(l => (
                      <option key={l.id} value={l.id}>{l.item_name} ({l.pack_label}){lineInv[l.id] && lineInv[l.id].idx !== x.idx ? ' · already on the invoice' : ''}</option>
                    ))}
                  </select>
                </Field>
              )}

              {problem && <p className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{problem}</p>}
            </div>
          )
        })}
      </div>
      {picking && (
        <ItemPickModal po={po} canSetup={canSetup} prices={prices} initialName={extras.find(x => x.key === picking)?.description || ''}
          onClose={() => setPicking(null)}
          onPick={(item, quote) => {
            const x = extras.find(e => e.key === picking)
            set(picking, {
              item, quote_id: quote?.id || null,
              quote_label: quote ? [quote.product_name, quote.pack_label].filter(Boolean).join(' · ') : '',
              pack: quote ? null : (x?.pack && unitsForBase(item.base_unit).includes(x.pack.unit) ? x.pack : { name: 'pack', count: 1, qty: null, unit: unitsForBase(item.base_unit)[0] }),
            })
            setPicking(null)
          }} />
      )}
    </section>
  )
}

/** Pick the inventory item an invoice line is: one of this supplier's prices, packed as invoiced, or a new item. */
function ItemPickModal({ po, canSetup, prices, initialName, onPick, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  // The invoice's first real word ("Lemons unwaxed 5kg" -> "Lemons"): an inventory name is usually shorter.
  const [search, setSearch] = useState(() => (initialName.match(/[A-Za-z]{3,}/) || [''])[0])
  const [debounced, setDebounced] = useState(search)
  const [making, setMaking] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t) }, [search])
  const { data = [], isFetching } = useQuery({
    queryKey: ['purchasing-catalog-all', po.venue_id, debounced],
    queryFn: () => api.get(`/purchasing/venues/${po.venue_id}/catalog?all=1&search=${encodeURIComponent(debounced)}`),
  })
  if (making) {
    return <NewItemModal name={initialName} onClose={() => setMaking(false)}
      onMade={item => { qc.invalidateQueries({ queryKey: ['purchasing-catalog-all'] }); onPick(item, null) }} />
  }
  return (
    <Modal title="Which inventory item is it?" onClose={onClose}
      footer={canSetup ? <button type="button" className={btn.outline} onClick={() => setMaking(true)}><Plus className="w-4 h-4" />New inventory item</button> : null}>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the inventory" autoFocus={!IS_TOUCH} />
      </div>
      {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
      <div className="space-y-2">
        {data.map(i => {
          const mine = (i.quotes || []).filter(q => q.supplier_id === po.supplier_id)
          return (
            <div key={i.id} className="rounded-xl border overflow-hidden" data-testid="inv-pick-item">
              <p className="px-3 pt-2 text-sm font-medium">{i.name} <StorageBadge storage={i.storage} /></p>
              <div className="p-2 flex flex-wrap gap-1.5">
                {mine.map(q => (
                  <button key={q.id} type="button" onClick={() => onPick(i, q)}
                    className="text-left rounded-lg border px-3 py-1.5 min-h-[44px] text-xs hover:bg-muted touch-manipulation">
                    {[q.product_name, q.pack_label].filter(Boolean).join(' · ')}{prices && q.price != null ? ` · ${money(q.price)}` : ''}
                  </button>
                ))}
                <button type="button" onClick={() => onPick(i, null)}
                  className="rounded-lg border border-dashed px-3 py-1.5 min-h-[44px] text-xs hover:bg-muted touch-manipulation">
                  {mine.length ? 'Another pack' : 'Packed as invoiced'}
                </button>
              </div>
            </div>
          )
        })}
        {!isFetching && !data.length && <p className="text-sm text-muted-foreground">Nothing found.{canSetup ? ' Make it a new inventory item.' : ' Ask a manager to add it to the inventory.'}</p>}
      </div>
    </Modal>
  )
}

function NewItemModal({ name, onClose, onMade }) {
  const api = useApi()
  const { data: categories = [] } = useCategories(true)
  const [f, setF] = useState({ name: name.slice(0, 200), category_id: '', base_unit: 'each', storage: 'ambient' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const make = useMutation({
    mutationFn: () => api.post('/inventory/items', { ...f, category_id: f.category_id || null }),
    onSuccess: item => onMade({ id: item.id, name: item.name, base_unit: item.base_unit, storage: item.storage }),
  })
  return (
    <Modal title="New inventory item" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={!f.name.trim() || make.isPending} onClick={() => make.mutate()}>
          {make.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Add it
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Back</button>
      </>}>
      <Field label="Name" hint="What staff order it as; the supplier's own name goes on its supplier price.">
        <input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} />
      </Field>
      <Field label="Category">
        <select className={inputCls} value={f.category_id} onChange={e => set('category_id', e.target.value)}>
          <option value="">None</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Counted in" group>
        <Segmented value={f.base_unit} onChange={v => set('base_unit', v)}
          options={[{ value: 'g', label: 'Weight' }, { value: 'ml', label: 'Volume' }, { value: 'each', label: 'Each' }]} />
      </Field>
      <Field label="Storage" group>
        <Segmented value={f.storage} onChange={v => set('storage', v)}
          options={[{ value: 'ambient', label: 'Ambient' }, { value: 'chilled', label: 'Chilled' }, { value: 'frozen', label: 'Frozen' }]} />
      </Field>
      <ErrorNote error={make.error} />
    </Modal>
  )
}

// ── Price list ──────────────────────────────────────────────────

const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : 0)

/** Default choice per row: update where the price changed, add new products, leave substitutes. */
function defaultChoice(r) {
  if (r.kind === 'price') return r.quote?.venue_price != null ? 'venue' : 'company'
  if (r.kind === 'new') return 'add'
  return 'keep'
}

export function PriceListModal({ po, onClose, onSaved }) {
  const api = useApi()
  const rows = po.price_list || []
  const [choice, setChoice] = useState(() => Object.fromEntries(rows.map(r => [r.line_id, defaultChoice(r)])))
  const [details, setDetails] = useState(() => Object.fromEntries(rows.map(r => [r.line_id, {
    product_name: r.invoice_name || '', supplier_code: r.invoice_code || '', usual: null,
    pack: r.pack_spec || (r.quote?.pack ? { ...r.quote.pack } : null),
  }])))
  const setD = (id, patch) => setDetails(d => ({ ...d, [id]: { ...d[id], ...patch } }))
  const changes = rows.filter(r => choice[r.line_id] && choice[r.line_id] !== 'keep').map(r => {
    const c = choice[r.line_id]
    if (c !== 'add') return { line_id: r.line_id, action: c }
    const d = details[r.line_id]
    return {
      line_id: r.line_id, action: 'add', product_name: d.product_name.trim() || null, supplier_code: d.supplier_code.trim() || null,
      pack: d.pack ? { name: d.pack.name || 'pack', count: d.pack.count || 1, qty: d.pack.qty, unit: d.pack.unit } : null, usual: d.usual,
    }
  })
  const bad = changes.some(c => c.action === 'add' && !(c.pack?.qty > 0 && c.pack?.unit))
  const save = useMutation({ mutationFn: () => api.post(`/purchasing/pos/${po.id}/price-list`, { changes }), onSuccess: onSaved })
  return (
    <Modal title="Update the price list from the invoice" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={!changes.length || bad || save.isPending} onClick={() => save.mutate()} data-testid="pl-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save {changes.length || ''} change{changes.length === 1 ? '' : 's'}
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Not now</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        The invoice from {po.supplier_name} differs from the price list. Pick what to change; the order itself keeps its prices.
      </p>
      <div className="space-y-3">
        {rows.map(r => {
          const c = choice[r.line_id]
          const d = details[r.line_id]
          const current = r.quote ? (r.quote.venue_price ?? r.quote.price) : null
          return (
            <div key={r.line_id} className="rounded-xl border p-3 space-y-2" data-testid="pl-row">
              <div>
                <p className="text-sm font-medium">{r.item_name}</p>
                {r.kind === 'price' && (
                  <p className="text-xs text-muted-foreground">
                    Price list {money(r.quote.price)}{r.quote.venue_price != null ? `, ${po.venue_name} ${money(r.quote.venue_price)}` : ''} · invoice <strong className="text-foreground">{money(r.invoice_price)}</strong>
                    {current != null ? ` (${r.invoice_price > current ? '+' : ''}${pct(r.invoice_price, current)}%)` : ''} per {r.pack_label}
                  </p>
                )}
                {r.kind === 'new' && <p className="text-xs text-muted-foreground">Not in the price list from {po.supplier_name}: invoiced as {r.invoice_name} at {money(r.invoice_price)}.</p>}
                {r.kind === 'product' && (
                  <p className="text-xs text-muted-foreground">
                    {po.supplier_name} sent {r.invoice_name}{r.invoice_code ? ` (${r.invoice_code})` : ''} at {money(r.invoice_price)} instead of {r.quote.product_name || r.item_name}{r.quote.supplier_code ? ` (${r.quote.supplier_code})` : ''}.
                  </p>
                )}
              </div>
              <Segmented value={c} onChange={v => setChoice(x => ({ ...x, [r.line_id]: v }))}
                options={r.kind === 'price'
                  ? [{ value: 'company', label: 'Everywhere' }, { value: 'venue', label: `${po.venue_name} only` }, { value: 'keep', label: 'Keep' }]
                  : [{ value: 'add', label: r.kind === 'new' ? 'Add to price list' : `Add as another ${r.item_name}` }, { value: 'keep', label: r.kind === 'new' ? 'Not now' : 'Just this time' }]} />
              {c === 'add' && (
                <div className="space-y-2 rounded-lg bg-muted/20 p-2">
                  <div className="grid sm:grid-cols-[1fr_9rem] gap-2">
                    <Field label="Supplier's product name">
                      <input className={cn(inputCls, 'h-10')} value={d.product_name} onChange={e => setD(r.line_id, { product_name: e.target.value })} placeholder={r.item_name} />
                    </Field>
                    <Field label="Code">
                      <input className={cn(inputCls, 'h-10')} value={d.supplier_code} onChange={e => setD(r.line_id, { supplier_code: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Pack" group><PackFields value={d.pack} onChange={pack => setD(r.line_id, { pack })} /></Field>
                  <Field label="Order this one from now on" group>
                    <Segmented value={d.usual || 'none'} onChange={v => setD(r.line_id, { usual: v === 'none' ? null : v })}
                      options={[{ value: 'none', label: 'No' }, { value: 'venue', label: `At ${po.venue_name}` }, { value: 'company', label: 'Everywhere' }]} />
                  </Field>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {bad && <p className="text-xs text-amber-800">Give the pack size for each product being added.</p>}
      <ErrorNote error={save.error} />
    </Modal>
  )
}

// ── On the order ────────────────────────────────────────────────

export function InvoiceList({ invoices, prices }) {
  if (!invoices?.length) return null
  return (
    <section className="rounded-xl border bg-background p-4 space-y-2 text-sm" data-testid="po-invoices">
      <p className="font-semibold flex items-center gap-2"><Receipt className="w-4 h-4" />Invoice{invoices.length > 1 ? 's' : ''}</p>
      {invoices.map(inv => (
        <div key={inv.id} className="space-y-1">
          <p>
            {[inv.invoice_number && `No. ${inv.invoice_number}`, inv.invoice_date && fmtDate(inv.invoice_date), prices && inv.total != null && `total ${money(inv.total)}`].filter(Boolean).join(' · ') || 'Invoice'}
            <span className="text-xs text-muted-foreground"> · read {new Date(inv.read_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{inv.read_by ? ` by ${inv.read_by}` : ''}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {inv.files.map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className={cn(btn.outline, 'h-9 text-xs')}>
                <FileText className="w-3.5 h-3.5" />{f.name || `Page ${i + 1}`}
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
