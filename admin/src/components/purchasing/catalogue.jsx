// src/components/purchasing/catalogue.jsx
//
// Tidying the purchasing catalogue on the Inventory page (1 Nov 2026):
//   - CatalogueCheckModal: GET /inventory/check (one supplier code on two
//     products, two items with one name, items nobody sells, prices
//     without a product code), each item opening its panel;
//   - SwitchItemsModal: several items switched off or on at once
//     (POST /inventory/items/bulk, a dry run first naming items on open
//     orders and codes another item already uses);
//   - PriceUpdateModal: one supplier's prices from a file or pasted lines,
//     matched by their product code (POST /inventory/price-update, a dry run
//     first, then Update), with their prices now as a CSV to edit.

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertTriangle, Check, Download } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, Field, inputCls, ErrorNote } from '@/components/staff/shared'
import { btn, money, fileToBase64, CodeTag } from '@/components/purchasing/shared'

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** An item named in a list, opening its panel. */
function ItemButton({ id, children, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(id)}
      className="w-full text-left px-3 py-2 min-h-[48px] flex items-center gap-2 hover:bg-muted/40 touch-manipulation">
      {children}
    </button>
  )
}

function CheckSection({ title, hint, count, testid, children }) {
  return (
    <section className="rounded-xl border overflow-hidden" data-testid={testid}>
      <div className="section-head px-3 py-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold flex-1">{title}</h3>
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', count ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800')}>
          {count || 'None'}
        </span>
      </div>
      {count > 0 && <p className="px-3 pt-2 text-xs text-muted-foreground">{hint}</p>}
      {count > 0 && <div className="divide-y">{children}</div>}
    </section>
  )
}

/**
 * The catalogue check: what to tidy up. onOpenItem(id) opens an item's
 * panel (the window closes first).
 */
export function CatalogueCheckModal({ onOpenItem, onClose }) {
  const api = useApi()
  // Always what the catalogue holds now: a check from a minute ago, before
  // a code was fixed, would send someone to fix it again.
  const { data, isLoading, error } = useQuery({
    queryKey: ['inv-check'], queryFn: () => api.get('/inventory/check'), staleTime: 0, gcTime: 0,
  })
  const open = id => { onClose(); onOpenItem(id) }
  const clean = data && !data.duplicate_codes.length && !data.duplicate_names.length && !data.no_price.length
  return (
    <Modal title="Catalogue check" onClose={onClose}
      footer={<button type="button" className={btn.outline} onClick={onClose}>Done</button>}>
      <ErrorNote error={error} />
      {isLoading && <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
      {data && (
        <>
          {clean && (
            <p className="text-sm rounded-lg bg-green-50 border border-green-200 px-3 py-2 flex items-center gap-2" data-testid="check-clean">
              <Check className="w-4 h-4 text-green-700" />No codes on two products, no items with the same name, and every item has a price.
            </p>
          )}
          <CheckSection title="One code on two products" count={data.duplicate_codes.length} testid="check-codes"
            hint="A supplier's code names one product, so orders by code and quick orders can't tell these apart. Change one of the codes, or switch the price that is wrong off.">
            {data.duplicate_codes.map(g => (
              <div key={g.supplier_id + g.code} className="py-1" data-testid="check-code-group">
                <p className="px-3 pt-1 text-sm font-medium">{g.supplier_name} <CodeTag code={g.code} className="ml-1" /></p>
                {g.quotes.map(q => (
                  <ItemButton key={q.quote_id} id={q.item_id} onOpen={open}>
                    <span className="text-sm flex-1 min-w-0 truncate">{q.item_name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{q.pack_label}</span>
                  </ItemButton>
                ))}
              </div>
            ))}
          </CheckSection>
          <CheckSection title="Two items with one name" count={data.duplicate_names.length} testid="check-names"
            hint="Staff can't tell them apart on an order. Rename one, or keep one: add the other's supplier prices to it and switch the other off.">
            {data.duplicate_names.map(g => (
              <div key={g.name} className="py-1" data-testid="check-name-group">
                {g.items.map(i => (
                  <ItemButton key={i.item_id} id={i.item_id} onOpen={open}>
                    <span className="text-sm flex-1 min-w-0 truncate">{i.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {[i.category_name, plural(i.prices, 'price')].filter(Boolean).join(' · ')}
                    </span>
                  </ItemButton>
                ))}
              </div>
            ))}
          </CheckSection>
          <CheckSection title="Items nobody sells" count={data.no_price.length} testid="check-no-price"
            hint="No price from a supplier that is switched on, so they can't be ordered. Add a supplier price, or switch them off.">
            {data.no_price.map(i => (
              <ItemButton key={i.item_id} id={i.item_id} onOpen={open}>
                <span className="text-sm flex-1 min-w-0 truncate">{i.name}</span>
                {i.category_name && <span className="text-xs text-muted-foreground shrink-0">{i.category_name}</span>}
              </ItemButton>
            ))}
          </CheckSection>
          <CheckSection title="Prices without a product code" count={data.no_code.reduce((n, s) => n + s.count, 0)} testid="check-no-code"
            hint="Fine to leave, but they can't be found by the supplier's code, and quick orders list them to add by hand.">
            {data.no_code.map(s => (
              <div key={s.supplier_id} className="px-3 py-2 text-sm">
                <p className="font-medium">{s.supplier_name}: {s.count}</p>
                <p className="text-xs text-muted-foreground">{s.items.join(', ')}{s.count > s.items.length ? ` and ${s.count - s.items.length} more` : ''}</p>
              </div>
            ))}
          </CheckSection>
        </>
      )}
    </Modal>
  )
}

/**
 * Switch several items off or on. The dry run says what will change, which
 * items are on open orders (their lines then ask to be taken off) and
 * which codes another item already uses (switching on is then refused).
 */
export function SwitchItemsModal({ ids, on, onClose, onDone }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: preview, isLoading, error } = useQuery({
    queryKey: ['inv-bulk-preview', on, ids],
    queryFn: () => api.post('/inventory/items/bulk', { ids, is_active: on, dry_run: true }),
    // Worked out again each time the window opens (a code fixed meanwhile).
    staleTime: 0, gcTime: 0,
  })
  const run = useMutation({
    mutationFn: () => api.post('/inventory/items/bulk', { ids, is_active: on }),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['inv-items'] })
      qc.invalidateQueries({ queryKey: ['inv-item'] })
      qc.invalidateQueries({ queryKey: ['inv-check'] })
      onDone(r)
    },
  })
  const n = preview?.updated ?? 0
  const blocked = on && preview?.code_conflicts?.length > 0
  return (
    <Modal title={on ? 'Switch items on' : 'Switch items off'} onClose={onClose}
      footer={<>
        <button type="button" className={on ? btn.primary : cn(btn.primary, 'bg-red-600 text-white')} data-testid="switch-items-go"
          disabled={!preview || !n || blocked || run.isPending} onClick={() => run.mutate()}>
          {run.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {on ? `Switch ${plural(n, 'item')} on` : `Switch ${plural(n, 'item')} off`}
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <ErrorNote error={error || run.error} />
      {isLoading && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
      {preview && (
        <div className="space-y-3 text-sm" data-testid="switch-items-preview">
          <p>
            {n ? `${plural(n, 'item')} will be switched ${on ? 'on' : 'off'}.` : `Nothing to change: ${ids.length === 1 ? 'it is' : 'they are all'} ${on ? 'on' : 'off'} already.`}
            {preview.unchanged > 0 && n > 0 && ` ${plural(preview.unchanged, 'item is', 'items are')} ${on ? 'on' : 'off'} already.`}
          </p>
          {!on && n > 0 && (
            <p className="text-muted-foreground">
              Switched-off items aren't offered on orders or lists, and keep their prices and history: switch them on again any time.
            </p>
          )}
          {preview.on_open_orders?.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2" data-testid="switch-items-open">
              <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-amber-700" />On open orders</p>
              <ul className="mt-1 space-y-0.5">
                {preview.on_open_orders.map(o => <li key={o.item_id}>{o.item_name}: {o.venues.join(', ')}</li>)}
              </ul>
              <p className="mt-1 text-xs">Those lines will say the item is switched off, and have to be taken off before the order can be placed.</p>
            </div>
          )}
          {preview.code_conflicts?.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2" data-testid="switch-items-conflicts">
              <p className="font-medium">A product code another item already uses</p>
              <ul className="mt-1 space-y-0.5">
                {preview.code_conflicts.map((c, i) => (
                  <li key={i}>{c.item_name}: {c.supplier_name}'s <CodeTag code={c.code} /> is {c.other_item_name}'s</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Change one of the codes first, or switch the other price off.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

const pct = v => `${v > 0 ? '+' : ''}${Math.round(v)}%`

/**
 * Update one supplier's prices by their product code: a CSV or Excel file
 * (code and price columns; their prices now come as one to edit) or lines
 * pasted in (code, price). Check shows what would change; Update applies it.
 */
export function PriceUpdateModal({ suppliers, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const active = suppliers.filter(s => s.is_active)
  const [supplierId, setSupplierId] = useState(active.length === 1 ? active[0].id : '')
  const [file, setFile] = useState(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(null)
  const [fileErr, setFileErr] = useState(null)
  const supplier = suppliers.find(s => s.id === supplierId)
  const reset = () => { setPreview(null); setDone(null) }
  const body = async () => ({ supplier_id: supplierId, ...(file ? { file: await fileToBase64(file) } : { text }) })
  const run = useMutation({
    mutationFn: async dry => api.post('/inventory/price-update', { ...(await body()), dry_run: dry }),
    onSuccess: (r, dry) => {
      if (dry) { setPreview(r); return }
      setDone(r)
      qc.invalidateQueries({ queryKey: ['inv-items'] })
      qc.invalidateQueries({ queryKey: ['inv-item'] })
    },
  })
  const download = async () => {
    setFileErr(null)
    try {
      await api.download(`/inventory/price-update/template?supplier_id=${supplierId}`, `${(supplier?.name || 'supplier').replace(/[^\w-]+/g, '-')}-prices.csv`)
    } catch (e) { setFileErr(e) }
  }
  const result = done || preview
  const ready = supplierId && (file || text.trim())
  // Bring the outcome into view in the window's own scroll area (never the page's).
  const resultRef = useRef(null)
  useEffect(() => {
    const el = resultRef.current
    const box = el?.closest('.overflow-y-auto')
    if (!el || !box) return
    box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8, behavior: 'smooth' })
  }, [result])
  return (
    <Modal title="Update prices by product code" onClose={onClose}
      footer={done ? <button type="button" className={btn.primary} onClick={onClose}>Done</button> : <>
        {!preview ? (
          <button type="button" className={btn.primary} disabled={!ready || run.isPending} onClick={() => run.mutate(true)} data-testid="price-update-check">
            {run.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Check
          </button>
        ) : (
          <button type="button" className={btn.primary} disabled={!preview.changes.length || run.isPending} onClick={() => run.mutate(false)}
            data-testid="price-update-apply">
            {run.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Update {plural(preview.changes.length, 'price')}
          </button>
        )}
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        A supplier's new prices matched to their prices here by product code: the price per pack before VAT. Prices
        without a code, and venues' own prices, stay as they are. Each change goes into the price's History.
      </p>
      {!done && (
        <>
          <Field label="Supplier">
            <select className={inputCls} value={supplierId} onChange={e => { setSupplierId(e.target.value); reset() }} data-testid="price-update-supplier">
              <option value="">Choose a supplier</option>
              {active.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {supplierId && (
            <button type="button" className={btn.outline} onClick={download} data-testid="price-update-template">
              <Download className="w-4 h-4" />{supplier?.name}'s prices now (CSV to edit)
            </button>
          )}
          <Field label="A CSV or Excel file with a code and a price column">
            <input type="file" accept=".csv,.xlsx,.xls,.txt,text/csv" className="block text-sm" data-testid="price-update-file"
              onChange={e => { setFile(e.target.files?.[0] || null); reset() }} />
          </Field>
          {!file && (
            <Field label="Or paste lines: code, price">
              <textarea className={cn(inputCls, 'h-auto py-2 font-mono text-sm')} rows={5} value={text} data-testid="price-update-text"
                placeholder={'MEA161, 31.50\nPOR106, 42.00'} onChange={e => { setText(e.target.value); reset() }} />
            </Field>
          )}
        </>
      )}
      <ErrorNote error={run.error || fileErr} />
      {result && <div ref={resultRef}><PriceUpdateResult result={result} done={!!done} /></div>}
    </Modal>
  )
}

function PriceUpdateResult({ result, done }) {
  const r = result
  const quiet = [
    r.unchanged > 0 && `${plural(r.unchanged, 'price')} unchanged`,
  ].filter(Boolean)
  return (
    <div className="space-y-3 text-sm" data-testid="price-update-result">
      {done ? (
        <p className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 flex items-center gap-2" data-testid="price-update-done">
          <Check className="w-4 h-4 text-green-700" />Updated {plural(r.changes.length, 'price')} from {r.supplier.name}.
        </p>
      ) : (
        <p className="font-medium">{r.changes.length ? `${plural(r.changes.length, 'price')} would change:` : 'No price would change.'}{quiet.length ? ` (${quiet.join(', ')})` : ''}</p>
      )}
      {r.changes.length > 0 && (
        <div className="rounded-xl border divide-y" data-testid="price-update-changes">
          {r.changes.map(c => (
            <div key={c.quote_id} className={cn('px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1', c.big && 'bg-amber-50')} data-testid="price-update-change">
              <span className="flex-1 min-w-[160px]">
                <CodeTag code={c.code} className="mr-1.5" />{c.item_name}
                <span className="block text-xs text-muted-foreground">{[c.product_name, c.pack_label].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="tabular-nums">{money(c.old_price)} to <strong>{money(c.new_price)}</strong></span>
              <span className={cn('text-xs tabular-nums w-12 text-right', c.big ? 'text-amber-800 font-semibold' : 'text-muted-foreground')}>
                {c.pct == null ? 'was £0' : pct(c.pct)}
              </span>
            </div>
          ))}
        </div>
      )}
      {r.changes.some(c => c.big) && !done && (
        <p className="text-xs text-amber-800 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Changes of 20% or more are marked: check them before updating.</p>
      )}
      {r.unknown.length > 0 && (
        <Problems title={`Not found at ${r.supplier.name}`} testid="price-update-unknown"
          note="No price here has these codes. Add them to the item's supplier price on the Inventory page first.">
          {r.unknown.map(u => <li key={u.row}>Row {u.row}: <CodeTag code={u.code} /></li>)}
        </Problems>
      )}
      {r.switched_off.length > 0 && (
        <Problems title="Switched off, left as they are" testid="price-update-off">
          {r.switched_off.map(u => <li key={u.row}>Row {u.row}: <CodeTag code={u.code} /> {u.item_name}</li>)}
        </Problems>
      )}
      {r.ambiguous.length > 0 && (
        <Problems title="On more than one product" testid="price-update-ambiguous"
          note="Fix the code on one of them first (Catalogue check lists them).">
          {r.ambiguous.map(u => <li key={u.row}>Row {u.row}: <CodeTag code={u.code} /> {u.items.join(', ')}</li>)}
        </Problems>
      )}
      {r.errors.length > 0 && (
        <Problems title="Rows left out" testid="price-update-errors">
          {r.errors.map(u => <li key={u.row}>Row {u.row}{u.code ? <> (<CodeTag code={u.code} />)</> : ''}: {u.error}</li>)}
        </Problems>
      )}
      {r.collection_ignored && (
        <p className="text-xs text-muted-foreground">The collection prices in the file were left out: a supplier price here is the delivered price per pack.</p>
      )}
    </div>
  )
}

function Problems({ title, note, testid, children }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2" data-testid={testid}>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 space-y-0.5">{children}</ul>
      {note && <p className="mt-1 text-xs">{note}</p>}
    </div>
  )
}
