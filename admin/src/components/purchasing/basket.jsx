// src/components/purchasing/basket.jsx
//
// Bringing a supplier's basket into an order (1 Nov 2026): what someone put
// in the supplier's own website basket, or the supplier's quick order,
// pasted (CODE:QTY, one a line, or the basket's rows with their headings)
// or as a CSV / Excel file. It is matched to the supplier's prices here by
// product code (POST /purchasing/orders/:id/reconcile): first what would
// change, then Apply. Quantities go up to a price's minimum and steps, as
// placing does. Codes not found here can be added from the window by people
// with Purchasing setup (meta.can_setup): an existing price of the supplier
// gets the code, or a new price for an inventory item; then it checks again.
//
//   BasketModal   the window, opened from the order form's Import basket.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Check, AlertTriangle, Plus, ArrowRight } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, Field, inputCls, ErrorNote } from '@/components/staff/shared'
import { NumInput, Toggle, CodeTag, btn, fileToBase64 } from '@/components/purchasing/shared'
import { ItemPickModal, PackFields } from '@/components/purchasing/invoice'
import { fmtNum, packBaseQty } from '@shared/procurement.js'

const MAX_FILE = 2_900_000   // the route takes up to 4 MB of base64
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** The supplier with the most lines on the order (the likely basket), when it is the only one. */
function likelySupplier(order, suppliers) {
  const ids = new Set(order.items.filter(i => i.qty > 0 && i.quote).map(i => i.quote.supplier_id))
  if (ids.size === 1) {
    const [only] = ids
    if (suppliers.some(s => s.id === only)) return only
  }
  return suppliers.length === 1 ? suppliers[0].id : ''
}

export function BasketModal({ order, meta, onClose, onApplied }) {
  const api = useApi()
  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['basket-suppliers', order.venue_id],
    queryFn: () => api.get(`/purchasing/venues/${order.venue_id}/suppliers`),
  })
  const [supplierId, setSupplierId] = useState(null)
  const [file, setFile] = useState(null)
  const [text, setText] = useState('')
  const [removeMissing, setRemoveMissing] = useState(true)
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(null)
  const [fileErr, setFileErr] = useState(null)
  const [adding, setAdding] = useState(null)
  const list = suppliers || []
  const chosen = supplierId ?? (suppliers ? likelySupplier(order, list) : '')
  const supplier = list.find(s => s.id === chosen)
  const reset = () => { setPreview(null); setDone(null) }

  const body = async () => ({
    supplier_id: chosen, remove_missing: removeMissing,
    ...(file ? { file: await fileToBase64(file) } : { text }),
  })
  const run = useMutation({
    mutationFn: async dry => api.post(`/purchasing/orders/${order.id}/reconcile`, { ...(await body()), dry_run: dry }),
    onSuccess: (r, dry) => {
      if (dry) { setPreview(r); return }
      setDone(r)
      onApplied(r.order)
    },
  })
  const pickFile = f => {
    setFileErr(null); reset()
    if (f && f.size > MAX_FILE) { setFile(null); setFileErr(new Error('That file is too big: up to 2.9 MB. Save just the basket as a CSV.')); return }
    setFile(f || null)
  }
  const result = done || preview
  const changes = result ? result.added.length + result.changed.length + result.removed.length : 0
  const ready = !!chosen && (file || text.trim())

  // Bring the outcome into view in the window's own scroll area.
  const resultRef = useRef(null)
  useEffect(() => {
    const el = resultRef.current
    const box = el?.closest('.overflow-y-auto')
    if (!el || !box) return
    box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8, behavior: 'smooth' })
  }, [result])

  if (adding) {
    return <AddCodeModal order={order} supplier={supplier} entry={adding} onClose={() => setAdding(null)}
      onAdded={() => { setAdding(null); run.mutate(true) }} />
  }

  return (
    <Modal title="Import a supplier's basket" onClose={onClose}
      footer={done ? <button type="button" className={btn.primary} onClick={onClose} data-testid="basket-done">Done</button> : <>
        {!preview ? (
          <button type="button" className={btn.primary} disabled={!ready || run.isPending} onClick={() => run.mutate(true)} data-testid="basket-check">
            {run.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Check
          </button>
        ) : (
          <button type="button" className={btn.primary} disabled={!changes || run.isPending} onClick={() => run.mutate(false)} data-testid="basket-apply">
            {run.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{changes ? `Apply ${plural(changes, 'change')}` : 'Nothing to change'}
          </button>
        )}
        {preview && <button type="button" className={btn.outline} onClick={reset} data-testid="basket-edit">Change the basket</button>}
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      {!done && (
        <>
          <p className="text-sm text-muted-foreground">
            Ordered on a supplier's own website? Bring their basket in and this order is set to match it, by their
            product codes: lines added, quantities changed, and their lines that aren't in the basket taken off.
            Nothing goes to the supplier.
          </p>
          <Field label="Supplier">
            <select className={inputCls} value={chosen} disabled={isLoading || !!preview} data-testid="basket-supplier"
              onChange={e => { setSupplierId(e.target.value); reset() }}>
              <option value="">{isLoading ? 'Loading…' : 'Choose a supplier'}</option>
              {list.map(s => (
                <option key={s.id} value={s.id} disabled={!s.codes}>
                  {s.name}{s.codes ? '' : ' (no product codes here yet)'}
                </option>
              ))}
            </select>
          </Field>
          {!preview && (
            <>
              <Field label="A CSV, Excel or text file of the basket">
                <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/plain" className="block text-sm" data-testid="basket-file"
                  onChange={e => pickFile(e.target.files?.[0])} />
              </Field>
              {!file && (
                <Field label="Or paste it: code and quantity"
                  hint="MEA161:20, POR106:7 on one line or one a line (MEA161 20, MEA161 x 20 and 20 x MEA161 work too), or the basket's rows with their headings.">
                  <textarea className={cn(inputCls, 'h-auto py-2 font-mono text-sm')} rows={6} value={text} data-testid="basket-text"
                    placeholder={'MEA161:20\nPOR106:7'} onChange={e => { setText(e.target.value); reset() }} />
                </Field>
              )}
              <div>
                <Toggle checked={removeMissing} onChange={v => { setRemoveMissing(v); reset() }}
                  label={`Take off ${supplier?.name || 'their'} lines that aren't in the basket`} />
                <p className="text-xs text-muted-foreground pl-12">
                  Off: only what is in the basket changes; their other lines stay.
                </p>
              </div>
            </>
          )}
        </>
      )}
      <ErrorNote error={run.error || fileErr} />
      {result && (
        <div ref={resultRef}>
          <BasketResult result={result} done={!!done} canAdd={!!meta?.can_setup && !done} onAdd={setAdding} />
        </div>
      )}
    </Modal>
  )
}

function Section({ title, count, tone = 'plain', testid, children }) {
  if (!count) return null
  return (
    <section className="rounded-xl border overflow-hidden" data-testid={testid}>
      <div className={cn('px-3 py-1.5 text-xs font-semibold',
        tone === 'warn' ? 'bg-amber-50 text-amber-900' : tone === 'off' ? 'bg-red-50 text-red-900' : 'section-head')}>
        {title} ({count})
      </div>
      <div className="divide-y">{children}</div>
    </section>
  )
}

const rowsText = rows => (rows?.length ? (rows.length === 1 ? `line ${rows[0]}` : `lines ${rows.join(', ')}`) : '')

function BasketResult({ result: r, done, canAdd, onAdd }) {
  const lineCls = 'px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'
  const qtyNote = x => x.qty_problem && (
    <span className="basis-full text-xs text-amber-800" data-testid="basket-qty-note">
      {fmtNum(x.basket_qty)} in the basket: {x.qty_problem.toLowerCase()} here, so {fmtNum(x.qty)}
    </span>
  )
  const changes = r.added.length + r.changed.length + r.removed.length
  return (
    <div className="space-y-3" data-testid="basket-result">
      {done ? (
        <p className="text-sm rounded-lg bg-green-50 border border-green-200 px-3 py-2 flex items-center gap-2" data-testid="basket-done-note">
          <Check className="w-4 h-4 text-green-700 shrink-0" />
          The order now matches {r.supplier.name}'s basket: {[
            r.added.length && `${r.added.length} added`, r.changed.length && `${r.changed.length} changed`,
            r.removed.length && `${r.removed.length} taken off`,
          ].filter(Boolean).join(', ')}. Nothing has gone to {r.supplier.name}.
        </p>
      ) : (
        <p className="text-sm font-medium" data-testid="basket-summary">
          {changes ? `${plural(changes, 'change')} to the order` : 'Nothing on the order would change'}
          {r.unchanged ? ` (${plural(r.unchanged, 'line')} already as in the basket)` : ''}
        </p>
      )}
      <Section title="Add" count={r.added.length} testid="basket-added">
        {r.added.map(a => (
          <div key={a.item_id} className={lineCls} data-testid="basket-line">
            <span className="flex-1 min-w-[160px]"><CodeTag code={a.code} className="mr-1.5" />{a.item_name}
              <span className="block text-xs text-muted-foreground">{a.pack}</span></span>
            <strong className="tabular-nums">{fmtNum(a.qty)}</strong>
            {qtyNote(a)}
          </div>
        ))}
      </Section>
      <Section title="Change" count={r.changed.length} testid="basket-changed">
        {r.changed.map(c => (
          <div key={c.item_id} className={lineCls} data-testid="basket-line">
            <span className="flex-1 min-w-[160px]"><CodeTag code={c.code} className="mr-1.5" />{c.item_name}
              <span className="block text-xs text-muted-foreground">
                {c.pack}{c.from ? ` · was ${c.from.supplier_name}${c.from.code ? ` ${c.from.code}` : ''}, ${c.from.pack}` : ''}
              </span></span>
            <span className="tabular-nums inline-flex items-center gap-1.5">{fmtNum(c.from_qty)}<ArrowRight className="w-3.5 h-3.5" /><strong>{fmtNum(c.qty)}</strong></span>
            {qtyNote(c)}
          </div>
        ))}
      </Section>
      <Section title="Take off" count={r.removed.length} testid="basket-removed">
        {r.removed.map(x => (
          <div key={x.item_id} className={lineCls} data-testid="basket-line">
            <span className="flex-1 min-w-[160px]"><CodeTag code={x.code} className="mr-1.5" />{x.item_name}
              <span className="block text-xs text-muted-foreground">{x.pack}</span></span>
            <span className="tabular-nums text-muted-foreground line-through">{fmtNum(x.qty)}</span>
          </div>
        ))}
      </Section>
      <Section title={`Not found at ${r.supplier.name}`} count={r.unknown.length} tone="warn" testid="basket-unknown">
        {r.unknown.map(u => (
          <div key={u.code} className={lineCls} data-testid="basket-unknown-line">
            <span className="flex-1 min-w-[160px]"><CodeTag code={u.code} className="mr-1.5" />{u.name || 'Not in the catalogue here'}
              <span className="block text-xs text-muted-foreground">{fmtNum(u.qty)} in the basket, {rowsText(u.rows)}</span></span>
            {canAdd && (
              <button type="button" className={btn.outline} onClick={() => onAdd(u)} data-testid="basket-add-code">
                <Plus className="w-4 h-4" />Add it
              </button>
            )}
          </div>
        ))}
        {!canAdd && !done && (
          <p className="px-3 py-2 text-xs text-muted-foreground">Left out. Someone with Purchasing setup can add these codes to {r.supplier.name}'s prices.</p>
        )}
      </Section>
      <Section title="Switched off here, left out" count={r.switched_off.length} tone="off" testid="basket-switched-off">
        {r.switched_off.map(u => (
          <div key={u.code} className={lineCls}><span><CodeTag code={u.code} className="mr-1.5" />{u.item_name}</span></div>
        ))}
      </Section>
      <Section title="On two products here, left out" count={r.ambiguous.length} tone="off" testid="basket-ambiguous">
        {r.ambiguous.map(u => (
          <div key={u.code} className={lineCls}><span><CodeTag code={u.code} className="mr-1.5" />{u.items.join(', ')}</span></div>
        ))}
      </Section>
      <Section title="Couldn't be read, left out" count={r.errors.length} tone="off" testid="basket-errors">
        {r.errors.map((e, i) => (
          <div key={i} className={lineCls}>
            <span className="flex-1 min-w-[160px]">
              <span className="text-xs text-muted-foreground mr-1.5">{e.row ? `Line ${e.row}` : rowsText(e.rows)}</span>
              {e.text ? <code className="text-xs">{e.text}</code> : e.code ? <CodeTag code={e.code} /> : null}
              <span className="block text-xs text-red-800">{e.error}</span>
            </span>
          </div>
        ))}
      </Section>
      {!done && r.added.concat(r.changed).some(x => x.qty_problem) && (
        <p className="text-xs text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />Quantities below a minimum, or not in its steps, go up to what can be ordered, as placing the order does.
        </p>
      )}
    </div>
  )
}

/**
 * A basket code not found here: pick the inventory item it is, then give one
 * of the supplier's prices for it the code, or make a new price with it.
 */
function AddCodeModal({ order, supplier, entry, onClose, onAdded }) {
  const api = useApi()
  const qc = useQueryClient()
  const [item, setItem] = useState(null)
  const [f, setF] = useState({ product_name: entry.name || '', pack: null, price: null })
  const setCode = useMutation({
    mutationFn: q => api.patch(`/inventory/quotes/${q.id}`, { supplier_code: entry.code }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inv-items'] }); onAdded() },
  })
  const pbq = useMemo(() => (item && f.pack ? packBaseQty({ pack_count: f.pack.count || 1, pack_qty: f.pack.qty, pack_unit: f.pack.unit }, item.base_unit) : null), [item, f.pack])
  const add = useMutation({
    mutationFn: () => api.post(`/inventory/items/${item.id}/quotes`, {
      supplier_id: supplier.id, supplier_code: entry.code, product_name: f.product_name.trim() || null,
      pack_name: f.pack.name || 'pack', pack_count: f.pack.count || 1, pack_qty: f.pack.qty, pack_unit: f.pack.unit, price: f.price,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inv-items'] }); onAdded() },
  })
  if (!item) {
    return (
      <ItemPickModal po={{ venue_id: order.venue_id, supplier_id: supplier.id }} canSetup prices initialName={entry.name || entry.code}
        title={`Which inventory item is ${entry.code}?`} newLabel="A new price"
        onPick={(it, q) => { if (q) setCode.mutate(q); else setItem(it) }} onClose={onClose} />
    )
  }
  const ready = pbq && f.price != null && f.price >= 0
  return (
    <Modal title={`${entry.code}: a new ${supplier.name} price`} onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={!ready || add.isPending} onClick={() => add.mutate()} data-testid="basket-new-price-save">
          {add.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Add the price
        </button>
        <button type="button" className={btn.outline} onClick={() => setItem(null)}>Back</button>
      </>}>
      <p className="text-sm">
        For <strong>{item.name}</strong>, from {supplier.name}, with their code <CodeTag code={entry.code} />.
      </p>
      <Field label="Their name for it" hint="Optional: their product name or brand, printed with the code on orders.">
        <input className={inputCls} value={f.product_name} onChange={e => setF(x => ({ ...x, product_name: e.target.value }))} />
      </Field>
      <Field label="Their pack" group>
        <PackFields value={f.pack} baseUnit={item.base_unit} onChange={pack => setF(x => ({ ...x, pack }))} />
      </Field>
      <Field label="Price per pack, before VAT">
        <NumInput value={f.price} onChange={v => setF(x => ({ ...x, price: v }))} data-testid="basket-new-price" />
      </Field>
      <ErrorNote error={add.error || setCode.error} />
    </Modal>
  )
}
