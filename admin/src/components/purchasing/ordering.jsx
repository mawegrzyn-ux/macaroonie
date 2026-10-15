// src/components/purchasing/ordering.jsx
//
// The restaurant side of purchasing, shared by the Purchasing page
// (/purchasing) and its phone version (/mobile/purchasing):
//
//   PurchasingApp  Order tab (the venue's order lists, drafts) and
//                  Deliveries tab (purchase orders to send, due, received).
//   OrderForm      fill in a list: quantities (saved as they're typed),
//                  par fill, supplier switch, extra items; Place order
//                  splits it into one purchase order per supplier.
//   PoDetail       one purchase order: send / print / Excel / PDF / mark
//                  sent / change quantities / cancel / book the delivery in.
//   ReceiveForm    what arrived, the checks and temperatures; writes the
//                  venue's H&S delivery check.
//
// The view lives in the URL (?order=, ?po=, ?tab=) so a refresh keeps it.
// Prices show only for people with purchasing_setup view (meta.show_prices).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, Plus, Search, Printer, FileText, FileSpreadsheet, Mail, Check, AlertTriangle, Truck,
  ClipboardList, ChevronRight, ChevronDown, X, PackageCheck, Clock, Send, Repeat, Thermometer, Snowflake, Eye,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, Field, inputCls, ErrorNote, Segmented, ConfirmDelete, hhmm } from '@/components/staff/shared'
import { TempKeypadModal } from '@/components/foodSafety/shared'
import {
  usePurchasingMeta, QtyStepper, NumInput, DateButton, StorageBadge, PoStatusBadge, Toggle, btn, money, fmtDate,
  fmtDateLong, printHtml, IS_TOUCH,
} from '@/components/purchasing/shared'
import {
  fitQty, qtyProblem, packsToPar, orderTotals, lineAmounts, fmtNum, poNumberLabel, receiveStatusFor,
  deliveryTempOk, RECEIVE_STATUSES, DELIVERY_TEMP_MAX, deliveryDateChoices,
} from '@shared/procurement.js'

const SENT_VIA = [
  { key: 'print', label: 'Printed and handed over' },
  { key: 'pdf', label: 'Sent the PDF' },
  { key: 'excel', label: 'Uploaded the Excel file' },
  { key: 'phone', label: 'Phoned it in' },
  { key: 'email', label: 'Emailed it myself' },
  { key: 'other', label: 'Other' },
]

// ── App shell ───────────────────────────────────────────────────

export function PurchasingApp({ venueId, phone = false }) {
  const [params, setParams] = useSearchParams()
  const orderId = params.get('order')
  const poId = params.get('po')
  const tab = params.get('tab') === 'deliveries' ? 'deliveries' : 'order'
  const go = useCallback(next => setParams(next, { replace: false }), [setParams])
  const { data: meta } = usePurchasingMeta()

  if (!venueId) return <p className="p-6 text-sm text-muted-foreground">Add a venue first.</p>
  if (orderId) {
    return <OrderForm key={orderId} orderId={orderId} meta={meta} phone={phone}
      onBack={() => go({})} onPlaced={() => go({ tab: 'deliveries' })} onOpenPo={id => go({ po: id })} />
  }
  if (poId) return <PoDetail key={poId} poId={poId} meta={meta} phone={phone} onBack={() => go({ tab: 'deliveries' })} />

  return (
    <div className={cn('space-y-4', phone ? 'p-3' : 'p-4 max-w-5xl mx-auto')}>
      <Segmented value={tab} onChange={t => go(t === 'order' ? {} : { tab: t })} className="w-full sm:w-auto [&>button]:flex-1"
        options={[{ value: 'order', label: 'Order' }, { value: 'deliveries', label: 'Deliveries' }]} />
      {tab === 'order'
        ? <OrderHome venueId={venueId} meta={meta} onOpen={id => go({ order: id })} />
        : <Deliveries venueId={venueId} meta={meta} onOpen={id => go({ po: id })} />}
    </div>
  )
}

// ── Order tab ───────────────────────────────────────────────────

function OrderHome({ venueId, meta, onOpen }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: lists = [], isLoading } = useQuery({ queryKey: ['order-lists', venueId], queryFn: () => api.get(`/purchasing/lists?venue_id=${venueId}`) })
  const { data: drafts = [] } = useQuery({ queryKey: ['supply-orders', venueId, 'draft'], queryFn: () => api.get(`/purchasing/orders?venue_id=${venueId}&status=draft`) })
  const start = useMutation({
    mutationFn: listId => api.post('/purchasing/orders', { venue_id: venueId, list_id: listId }),
    onSuccess: o => { qc.invalidateQueries({ queryKey: ['supply-orders', venueId] }); onOpen(o.id) },
  })
  const draftFor = listId => drafts.find(d => (d.list_id || null) === (listId || null))
  const canOrder = !!meta?.can_order

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin mx-auto my-10 text-muted-foreground" />
  return (
    <div className="space-y-3">
      {!lists.length && (
        <div className="rounded-xl border bg-background p-6 text-center text-sm text-muted-foreground space-y-1">
          <ClipboardList className="w-7 h-7 mx-auto" />
          <p className="font-medium text-foreground">No order lists for this venue yet</p>
          <p>{meta?.can_setup ? 'Set them up under Purchasing → Order lists.' : 'Ask a manager to set up an order list for this venue.'}</p>
        </div>
      )}
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))]">
        {lists.map(l => {
          const d = draftFor(l.id)
          return (
            <button key={l.id} type="button" disabled={!canOrder || start.isPending} onClick={() => start.mutate(l.id)}
              className="text-left rounded-xl border bg-background p-4 min-h-[96px] hover:shadow-sm touch-manipulation disabled:opacity-60 flex items-center gap-3">
              <span className="flex-1 min-w-0">
                <span className="block font-semibold">{l.name}</span>
                <span className="block text-sm text-muted-foreground">{l.item_count} item{l.item_count === 1 ? '' : 's'}</span>
                {d && <span className="mt-1 inline-block text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Draft · {d.line_count} line{d.line_count === 1 ? '' : 's'}</span>}
              </span>
              <span className="text-sm font-medium text-primary inline-flex items-center gap-1">{d ? 'Continue' : 'Start'}<ChevronRight className="w-4 h-4" /></span>
            </button>
          )
        })}
        <button type="button" disabled={!canOrder || start.isPending} onClick={() => start.mutate(null)}
          className="text-left rounded-xl border border-dashed bg-background p-4 min-h-[96px] hover:shadow-sm touch-manipulation disabled:opacity-60 flex items-center gap-3">
          <span className="flex-1">
            <span className="block font-semibold">Something else</span>
            <span className="block text-sm text-muted-foreground">Search the inventory for what you need</span>
            {draftFor(null) && <span className="mt-1 inline-block text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Draft · {draftFor(null).line_count} lines</span>}
          </span>
          <Plus className="w-5 h-5 text-primary" />
        </button>
      </div>
      {!canOrder && <p className="text-xs text-muted-foreground">You can see orders but not place them.</p>}
      <ErrorNote error={start.error} />
    </div>
  )
}

// ── Order form ──────────────────────────────────────────────────

// What each order line shows beyond the item, pack and quantity. All off
// until switched on with Show; remembered on this device.
const SHOW_KEY = 'maca_purchasing_show'
const SHOW_OPTIONS = [
  { key: 'supplier', label: 'Supplier', hint: 'Under each item (the group heading says it when grouped by supplier).' },
  { key: 'price', label: 'Price', hint: 'Price per pack, under each item.', prices: true },
  { key: 'last', label: 'Last order', hint: 'How many were ordered last time and when, under each item.' },
  { key: 'last_qty', label: 'Last quantity column', hint: 'How many were ordered last time, in a column at the end of each line.' },
]

function useShowPrefs() {
  const [show, setShow] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SHOW_KEY)) || {} } catch { return {} }
  })
  const set = useCallback((key, on) => setShow(prev => {
    const next = { ...prev, [key]: on }
    try { localStorage.setItem(SHOW_KEY, JSON.stringify(next)) } catch { /* private */ }
    return next
  }), [])
  return [show, set]
}

function useAutosave(orderId) {
  const api = useApi()
  const pending = useRef(new Map())
  const timer = useRef(null)
  const [state, setState] = useState('saved')
  const [error, setError] = useState(null)
  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (!pending.current.size) return
    const lines = [...pending.current.values()]
    pending.current = new Map()
    setState('saving')
    try {
      await api.put(`/purchasing/orders/${orderId}/lines`, { lines })
      setState(pending.current.size ? 'pending' : 'saved'); setError(null)
    } catch (e) {
      for (const l of lines) if (!pending.current.has(l.item_id)) pending.current.set(l.item_id, l)
      setState('error'); setError(e)
    }
  }, [api, orderId]) // eslint-disable-line react-hooks/exhaustive-deps
  const queue = useCallback(line => {
    const prev = pending.current.get(line.item_id) || {}
    pending.current.set(line.item_id, { ...prev, ...line })
    setState('pending')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(), 700)
  }, [flush])
  useEffect(() => () => { clearTimeout(timer.current) }, [])
  return { queue, flush, state, error }
}

function OrderForm({ orderId, meta, phone, onBack, onPlaced, onOpenPo }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: order, isLoading, error } = useQuery({ queryKey: ['supply-order', orderId], queryFn: () => api.get(`/purchasing/orders/${orderId}`) })
  const [lines, setLines] = useState({})
  const [search, setSearch] = useState('')
  const [onlyQty, setOnlyQty] = useState(false)
  const [groupBy, setGroupBy] = useState(() => { try { return localStorage.getItem('maca_purchasing_group') || 'category' } catch { return 'category' } })
  const [switching, setSwitching] = useState(null)
  const [adding, setAdding] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [result, setResult] = useState(null)
  const [showing, setShowing] = useState(false)
  const [show, setShow] = useShowPrefs()
  const save = useAutosave(orderId)
  const prices = !!order?.show_prices
  const view = {
    supplier: !!show.supplier && groupBy !== 'supplier',
    price: prices && !!show.price,
    last: !!show.last,
    lastQty: !!show.last_qty,
  }
  const showOptions = SHOW_OPTIONS.filter(o => !o.prices || prices)
  const showCount = showOptions.filter(o => show[o.key]).length

  useEffect(() => {
    if (!order) return
    setLines(prev => {
      const next = { ...prev }
      for (const it of order.items) if (!(it.item_id in next)) next[it.item_id] = { qty: it.qty, quote_id: it.quote?.id ?? null }
      return next
    })
  }, [order])

  const setQty = (itemId, qty) => {
    setLines(l => ({ ...l, [itemId]: { ...l[itemId], qty } }))
    save.queue({ item_id: itemId, qty })
  }
  const setQuote = (it, quoteId) => {
    const qty = lines[it.item_id]?.qty ?? 0
    setLines(l => ({ ...l, [it.item_id]: { ...l[it.item_id], quote_id: quoteId } }))
    save.queue({ item_id: it.item_id, qty, quote_id: quoteId })
  }
  const quoteOf = it => it.quotes.find(q => q.id === lines[it.item_id]?.quote_id) || it.quote
  const qtyOf = it => Number(lines[it.item_id]?.qty) || 0

  const fillPars = () => {
    for (const it of order.items) {
      const q = quoteOf(it)
      if (!q || it.par_base == null || qtyOf(it) > 0) continue
      const p = packsToPar(it.par_base, q)
      if (p > 0) setQty(it.item_id, p)
    }
  }
  const clearAll = () => { for (const it of order.items) if (qtyOf(it) > 0) setQty(it.item_id, 0) }
  const removeExtra = useMutation({
    mutationFn: itemId => api.delete(`/purchasing/orders/${orderId}/lines/${itemId}`),
    onSuccess: (_, itemId) => { setLines(l => { const n = { ...l }; delete n[itemId]; return n }); qc.invalidateQueries({ queryKey: ['supply-order', orderId] }) },
  })

  // Per supplier: lines with a quantity, totals, the supplier's settings.
  const bySupplier = useMemo(() => {
    const m = new Map()
    for (const it of order?.items || []) {
      const q = quoteOf(it)
      const qty = qtyOf(it)
      if (!q || qty <= 0) continue
      if (!m.has(q.supplier_id)) m.set(q.supplier_id, { supplier: order.suppliers[q.supplier_id] || { id: q.supplier_id, name: q.supplier_name }, lines: [] })
      m.get(q.supplier_id).lines.push({ it, q, qty: fitQty(qty, q), price: q.price, vat_rate: q.vat_rate })
    }
    for (const g of m.values()) g.totals = prices ? orderTotals(g.lines, g.supplier.delivery_charge) : null
    return [...m.values()]
  }, [order, lines]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !order) {
    return <div className="p-6"><ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}</div>
  }
  if (result) return <PlacedView result={result} prices={prices} phone={phone} onDone={onPlaced} onOpenPo={onOpenPo} />
  if (order.status !== 'draft') {
    return (
      <div className="p-4 space-y-3">
        <button type="button" className={btn.ghost} onClick={onBack}><ArrowLeft className="w-4 h-4" />Back</button>
        <p className="text-sm">This order was placed {order.submitted_at ? `on ${fmtDate(order.submitted_at)}` : ''}.</p>
        <div className="space-y-2">{(order.purchase_orders || []).map(p => <PoCard key={p.id} po={p} prices={prices} onOpen={() => onOpenPo(p.id)} />)}</div>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const visible = order.items.filter(it => (!onlyQty || qtyOf(it) > 0) && (!q || it.name.toLowerCase().includes(q) || (it.code || '').toLowerCase().includes(q)))
  const groups = groupRows(visible, groupBy, order, quoteOf)
  const lineCount = bySupplier.reduce((n, g) => n + g.lines.length, 0)
  const grand = prices ? bySupplier.reduce((s, g) => s + g.totals.total, 0) : null
  const hasPars = order.items.some(it => it.par_base != null)
  const hasExtras = order.items.some(it => !it.on_list)

  return (
    <div className="flex flex-col min-h-full">
      <div className={cn('sticky top-0 z-10 bg-background border-b', phone ? 'px-3 py-2' : 'px-4 py-2')}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={async () => { await save.flush(); qc.invalidateQueries({ queryKey: ['supply-orders'] }); onBack() }}
            className="w-11 h-11 -ml-2 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{order.list_name || 'Other items'}</p>
            <p className="text-xs text-muted-foreground truncate">{order.venue_name} · <SaveState state={save.state} /></p>
          </div>
          <button type="button" className={btn.primary} disabled={!lineCount || !meta?.can_order}
            onClick={async () => { await save.flush(); setReviewing(true) }}>
            Place order{lineCount ? ` (${lineCount})` : ''}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an item" className={cn(inputCls, 'pl-9')} />
          </div>
          <Segmented value={groupBy} onChange={v => { setGroupBy(v); try { localStorage.setItem('maca_purchasing_group', v) } catch { /* private */ } }}
            options={[{ value: 'category', label: 'Category' }, { value: 'supplier', label: 'Supplier' }]} />
          <button type="button" onClick={() => setOnlyQty(v => !v)}
            className={cn(btn.outline, onlyQty && 'bg-primary/10 border-primary')}>{onlyQty ? 'Showing ordered' : 'Only ordered'}</button>
          {hasPars && <button type="button" className={btn.outline} onClick={fillPars}>Fill to par</button>}
          <button type="button" className={cn(btn.outline, showCount > 0 && 'bg-primary/10 border-primary')} onClick={() => setShowing(true)}>
            <Eye className="w-4 h-4" />Show{showCount ? ` (${showCount})` : ''}
          </button>
          <button type="button" className={btn.outline} onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Add item</button>
        </div>
        <ErrorNote error={save.error} />
      </div>

      {order.notes && <p className="mx-4 mt-3 text-sm rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">{order.notes}</p>}

      <div className={cn('flex-1', phone ? 'px-3 py-3' : 'px-4 py-4 max-w-5xl w-full mx-auto', 'space-y-4')}>
        {!order.items.length && <p className="text-sm text-muted-foreground text-center py-8">Nothing here yet. Add items to order.</p>}
        {groups.map(g => (
          <section key={g.key} className="rounded-xl border bg-background overflow-hidden">
            <div className="section-head px-4 py-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold flex-1">{g.name}</h3>
              {g.sub && <span className="text-xs text-muted-foreground">{g.sub}</span>}
            </div>
            <div className="divide-y">
              {g.items.map(it => (
                <OrderRow key={it.item_id} it={it} quote={quoteOf(it)} qty={qtyOf(it)} view={view}
                  hasPars={hasPars} hasExtras={hasExtras}
                  onQty={v => setQty(it.item_id, v)} onSwitch={() => setSwitching(it)}
                  onRemove={!it.on_list ? () => removeExtra.mutate(it.item_id) : null} />
              ))}
            </div>
          </section>
        ))}
        {lineCount > 0 && (
          <button type="button" className={cn(btn.ghost, 'text-muted-foreground')} onClick={clearAll}>Clear all quantities</button>
        )}
      </div>

      {lineCount > 0 && (
        <div className="sticky bottom-0 z-20 mt-auto border-t bg-background px-4 py-2 flex items-center gap-3">
          <span className="flex-1 min-w-0 text-sm">
            <strong>{lineCount}</strong> line{lineCount === 1 ? '' : 's'} · {bySupplier.length} supplier{bySupplier.length === 1 ? '' : 's'}
            {prices && <> · <strong>{money(grand)}</strong> inc VAT</>}
          </span>
          <button type="button" className={btn.primary} disabled={!meta?.can_order} onClick={async () => { await save.flush(); setReviewing(true) }}>Review &amp; place</button>
        </div>
      )}

      {showing && (
        <Modal title="Show on each line" onClose={() => setShowing(false)}>
          <div className="space-y-3">
            {showOptions.map(o => (
              <div key={o.key}>
                <Toggle checked={!!show[o.key]} onChange={v => setShow(o.key, v)} label={o.label} />
                <p className="text-xs text-muted-foreground pl-12">{o.hint}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Remembered on this device. To order from another supplier, tap the pack next to the quantity.
          </p>
        </Modal>
      )}
      {switching && (
        <SwitchSupplierModal it={switching} current={quoteOf(switching)} prices={prices} order={order}
          onPick={qid => { setQuote(switching, qid); setSwitching(null) }} onClose={() => setSwitching(null)} />
      )}
      {adding && (
        <AddItemModal order={order} prices={prices} onClose={() => setAdding(false)}
          onAdd={async (item, quote) => {
            setAdding(false)
            setLines(l => ({ ...l, [item.id]: { qty: 1, quote_id: quote?.id ?? null } }))
            await api.put(`/purchasing/orders/${orderId}/lines`, { lines: [{ item_id: item.id, qty: 1, quote_id: quote?.id ?? null }] })
            qc.invalidateQueries({ queryKey: ['supply-order', orderId] })
          }} />
      )}
      {reviewing && (
        <ReviewModal order={order} groups={bySupplier} prices={prices} onClose={() => setReviewing(false)}
          onPlaced={r => { setReviewing(false); setResult(r); qc.invalidateQueries({ queryKey: ['supply-orders'] }); qc.invalidateQueries({ queryKey: ['purchase-orders'] }) }} />
      )}
    </div>
  )
}

function SaveState({ state }) {
  if (state === 'saving') return <span>Saving…</span>
  if (state === 'pending') return <span>Editing…</span>
  if (state === 'error') return <span className="text-red-700">Not saved</span>
  return <span>Saved</span>
}

function groupRows(items, groupBy, order, quoteOf) {
  const m = new Map()
  for (const it of items) {
    let key, name, sort, sub
    if (groupBy === 'supplier') {
      const q = quoteOf(it)
      const s = q ? order.suppliers[q.supplier_id] : null
      key = q?.supplier_id || 'none'
      name = q ? q.supplier_name : 'No supplier'
      sort = name.toLowerCase()
      sub = s ? deliveryHint(s) : null
    } else {
      key = it.category_name || 'none'
      name = it.category_name || 'Other'
      sort = String(it.category_sort ?? 9999).padStart(6, '0')
    }
    if (!m.has(key)) m.set(key, { key, name, sort, sub, items: [] })
    m.get(key).items.push(it)
  }
  for (const g of m.values()) g.items.sort((a, b) => (a.list_sort - b.list_sort) || a.name.localeCompare(b.name))
  return [...m.values()].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
}

function deliveryHint(s) {
  const parts = [`Next delivery ${fmtDate(s.next_delivery)}`]
  if (s.cutoff_time && s.minutes_to_cutoff != null) {
    parts.push(s.minutes_to_cutoff > 0 ? `order by ${hhmm(s.cutoff_time)}` : `today's cutoff ${hhmm(s.cutoff_time)} has passed`)
  }
  return parts.join(' · ')
}

function OrderRow({ it, quote, qty, view, hasPars, hasExtras, onQty, onSwitch, onRemove }) {
  const problem = quote ? qtyProblem(qty, quote) : null
  const par = quote && it.par_base != null ? packsToPar(it.par_base, quote) : null
  const details = quote ? [
    view.supplier && quote.supplier_name,
    view.price && quote.price != null && `${money(quote.price)} per ${(quote.pack_name || 'pack').toLowerCase()}`,
  ].filter(Boolean).join(' · ') : ''
  const last = it.last
  const lastOtherPack = last && quote && last.pack_label !== quote.pack_label
  const parBtn = par > 0 && (
    <button type="button" onClick={() => onQty(par)} title="Set to par"
      className={cn('h-11 px-2 rounded-lg border text-xs touch-manipulation', qty === par ? 'bg-primary/10 border-primary' : 'hover:bg-muted')}>
      Par {fmtNum(par)}
    </button>
  )
  const removeBtn = onRemove && (
    <button type="button" onClick={onRemove} aria-label={`Remove ${it.name}`}
      className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation"><X className="w-4 h-4" /></button>
  )
  // Below sm the item text gets a line of its own, so Par and remove sit
  // beside the name and the pack, quantity and last figure fit one line.
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-3', qty > 0 && 'bg-primary/[0.03]')}>
      <div className="flex-1 min-w-[180px] flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{it.name} <StorageBadge storage={it.storage} /></p>
          {!quote && <p className="text-xs text-amber-700">No supplier sells this: ask a manager</p>}
          {details && <p className="text-xs text-muted-foreground">{details}</p>}
          {view.last && last && (
            <p className="text-xs text-muted-foreground">
              Last {fmtNum(last.qty)}{lastOtherPack ? ` (${last.pack_label})` : ''} on {fmtDate(last.delivery_date)}
            </p>
          )}
          {problem && <p className="text-xs text-amber-700">{problem}: will order {fmtNum(fitQty(qty, quote))}</p>}
        </div>
        {(parBtn || removeBtn) && <div className="sm:hidden flex items-center gap-1 shrink-0">{parBtn}{removeBtn}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
        {hasPars && <div className="hidden sm:flex w-16 justify-end">{parBtn}</div>}
        <PackLabel quote={quote} canSwitch={it.quotes.length > 1} onSwitch={onSwitch} />
        <QtyStepper value={qty} onChange={onQty} step={quote?.order_multiple || 1} disabled={!quote} label={it.name} />
        {view.lastQty && <LastQty last={last} otherPack={lastOtherPack} />}
        {hasExtras && <div className="hidden sm:block w-11 shrink-0">{removeBtn}</div>}
      </div>
    </div>
  )
}

// The pack being ordered, big, next to the quantity. With more than one
// supplier it is the button that switches supplier.
function PackLabel({ quote, canSwitch, onSwitch }) {
  const width = 'w-[84px] sm:w-28 shrink-0'
  if (!quote) return <span className={width} aria-hidden="true" />
  const name = quote.pack_name || quote.pack_label
  const inner = (
    <>
      <span className="flex items-center justify-end gap-1 text-base font-semibold leading-tight break-words">
        {name}{canSwitch && <ChevronDown className="w-4 h-4 text-primary shrink-0" />}
      </span>
      {quote.pack_size && <span className="block text-xs text-muted-foreground leading-tight">{quote.pack_size}</span>}
    </>
  )
  if (!canSwitch) return <div className={cn(width, 'text-right px-1 sm:px-2')}>{inner}</div>
  return (
    <button type="button" onClick={onSwitch} aria-label={`${name} ${quote.pack_size || ''}: order from another supplier`}
      className={cn(width, 'min-h-[48px] text-right rounded-lg px-1 sm:px-2 hover:bg-muted touch-manipulation')}>
      {inner}
    </button>
  )
}

function LastQty({ last, otherPack }) {
  return (
    <div className="w-12 sm:w-14 shrink-0 text-center leading-tight"
      title={last ? `Last ordered ${fmtNum(last.qty)} × ${last.pack_label} on ${fmtDate(last.delivery_date)}` : 'Not ordered before'}>
      <span className="block text-base font-semibold tabular-nums">{last ? fmtNum(last.qty) : '-'}</span>
      <span className="block text-[11px] text-muted-foreground truncate">
        {otherPack ? last.pack_label.split(' · ')[0].toLowerCase() : 'last'}
      </span>
    </div>
  )
}

function SwitchSupplierModal({ it, current, prices, order, onPick, onClose }) {
  return (
    <Modal title={`Order ${it.name} from`} onClose={onClose}>
      <div className="space-y-2">
        {it.quotes.map(q => {
          const s = order.suppliers[q.supplier_id]
          return (
            <button key={q.id} type="button" onClick={() => onPick(q.id)}
              className={cn('w-full text-left rounded-xl border p-3 touch-manipulation min-h-[56px]', q.id === current?.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40')}>
              <span className="flex items-center gap-2">
                <span className="flex-1 font-medium text-sm">{q.supplier_name}</span>
                {q.id === it.default_quote_id && <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted">Usual</span>}
                {q.id === current?.id && <Check className="w-4 h-4 text-primary" />}
              </span>
              <span className="block text-sm">{q.pack_label}{prices && q.price != null ? ` · ${money(q.price)}` : ''}</span>
              {s && <span className="block text-xs text-muted-foreground">{deliveryHint(s)}</span>}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

function AddItemModal({ order, prices, onClose, onAdd }) {
  const api = useApi()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t) }, [search])
  const { data = [], isFetching } = useQuery({
    queryKey: ['purchasing-catalog', order.venue_id, debounced],
    queryFn: () => api.get(`/purchasing/venues/${order.venue_id}/catalog?search=${encodeURIComponent(debounced)}`),
  })
  const have = new Set(order.items.map(i => i.item_id))
  return (
    <Modal title="Add an item" onClose={onClose}>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the inventory" autoFocus={!IS_TOUCH} />
      </div>
      {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
      <div className="rounded-xl border divide-y">
        {data.filter(i => !have.has(i.id)).map(i => (
          <button key={i.id} type="button" onClick={() => onAdd(i, i.quote)}
            className="w-full text-left px-3 py-2 min-h-[52px] hover:bg-muted/40 touch-manipulation">
            <span className="block text-sm font-medium">{i.name} <StorageBadge storage={i.storage} /></span>
            <span className="block text-xs text-muted-foreground">
              {i.quote ? `${i.quote.supplier_name} · ${i.quote.pack_label}${prices && i.quote.price != null ? ` · ${money(i.quote.price)}` : ''}` : ''}
            </span>
          </button>
        ))}
        {!isFetching && !data.filter(i => !have.has(i.id)).length && <p className="p-3 text-sm text-muted-foreground">Nothing found.</p>}
      </div>
    </Modal>
  )
}

function ReviewModal({ order, groups, prices, onClose, onPlaced }) {
  const api = useApi()
  const [opts, setOpts] = useState(() => Object.fromEntries(groups.map(g => [g.supplier.id, { delivery_date: g.supplier.next_delivery || order.today, notes: '' }])))
  const set = (sid, k, v) => setOpts(o => ({ ...o, [sid]: { ...o[sid], [k]: v } }))
  const place = useMutation({
    mutationFn: () => api.post(`/purchasing/orders/${order.id}/submit`, {
      suppliers: Object.fromEntries(Object.entries(opts).map(([sid, o]) => [sid, { delivery_date: o.delivery_date, notes: o.notes }])),
    }),
    onSuccess: onPlaced,
  })
  return (
    <Modal title="Place order" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={place.isPending} onClick={() => place.mutate()}>
          {place.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Place {groups.length} order{groups.length === 1 ? '' : 's'}
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Back</button>
      </>}>
      <p className="text-sm text-muted-foreground">One purchase order per supplier. Quantities below a supplier's minimum or step are rounded up.</p>
      {groups.map(g => {
        const s = g.supplier
        const below = prices && s.min_order && g.totals.subtotal < s.min_order
        const late = s.cutoff_time && s.minutes_to_cutoff != null && s.minutes_to_cutoff <= 0
        const choices = deliveryDateChoices(s)
        return (
          <div key={s.id} className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold flex-1">{s.name}</span>
              <span className="text-sm text-muted-foreground">{g.lines.length} line{g.lines.length === 1 ? '' : 's'}</span>
              {prices && <span className="text-sm font-semibold tabular-nums">{money(g.totals.total)}</span>}
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {g.lines.map(l => <li key={l.it.item_id}>{fmtNum(l.qty)} × {l.it.name} <span className="opacity-75">({l.q.pack_label})</span></li>)}
            </ul>
            {below && <p className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Below their minimum order of {money(s.min_order)}</p>}
            {late && <p className="text-xs text-amber-800 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Past today's {hhmm(s.cutoff_time)} cutoff, so the first delivery offered is {fmtDate(s.next_delivery)}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Delivery</span>
              <DateButton value={opts[s.id].delivery_date} min={order.today} onChange={d => set(s.id, 'delivery_date', d)} label={`Delivery date for ${s.name}`} />
              <span className="text-xs text-muted-foreground">{sendHint(s)}</span>
            </div>
            {choices.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Their delivery days:</span>
                {choices.map(d => {
                  const on = opts[s.id].delivery_date === d
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => set(s.id, 'delivery_date', d)}
                      className={cn('h-11 px-3 rounded-lg border text-sm touch-manipulation',
                        on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                      {fmtDate(d)}
                    </button>
                  )
                })}
              </div>
            )}
            <input className={inputCls} value={opts[s.id].notes} onChange={e => set(s.id, 'notes', e.target.value)} placeholder="Note for the supplier (optional)" />
          </div>
        )
      })}
      <ErrorNote error={place.error} />
    </Modal>
  )
}

function sendHint(s) {
  if (s.send_method === 'email') return s.email ? `Emailed to ${s.email}` : 'No email address: send it yourself'
  if (s.send_method === 'print') return 'You print it'
  if (s.send_method === 'excel') return 'You send the Excel file'
  return 'You send the PDF'
}

function PlacedView({ result, prices, phone, onDone, onOpenPo }) {
  return (
    <div className={cn('space-y-4', phone ? 'p-3' : 'p-4 max-w-3xl mx-auto')}>
      <div className="rounded-xl border bg-background p-5 text-center space-y-1">
        <PackageCheck className="w-8 h-8 mx-auto text-green-600" />
        <p className="font-semibold">Order placed</p>
        <p className="text-sm text-muted-foreground">{result.purchase_orders.length} purchase order{result.purchase_orders.length === 1 ? '' : 's'}</p>
      </div>
      {result.purchase_orders.map(p => {
        const r = result.results.find(x => x.id === p.id) || {}
        return (
          <div key={p.id} className="space-y-1">
            <PoCard po={p} prices={prices} onOpen={() => onOpenPo(p.id)} />
            {r.emailed && <p className="text-xs text-green-700 px-1">Emailed to the supplier.</p>}
            {r.error && <p className="text-xs text-red-700 px-1">Not emailed: {r.error}. Open it to try again or send it another way.</p>}
            {!r.emailed && !r.error && p.status === 'to_send' && <p className="text-xs text-amber-800 px-1">Open it to print or download it, then mark it as sent.</p>}
            {r.below_minimum && <p className="text-xs text-amber-800 px-1">Below the supplier's minimum order.</p>}
          </div>
        )
      })}
      <button type="button" className={cn(btn.primary, 'w-full')} onClick={onDone}>See deliveries</button>
    </div>
  )
}

// ── Deliveries tab ──────────────────────────────────────────────

function PoCard({ po, prices, onOpen }) {
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left rounded-xl border bg-background p-3 hover:shadow-sm touch-manipulation flex items-center gap-3 min-h-[64px]">
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-semibold truncate">{po.supplier_name}</span>
          <PoStatusBadge status={po.status} />
          {po.send_error && po.status === 'to_send' && <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />}
        </span>
        <span className="block text-sm text-muted-foreground">
          {poNumberLabel(po.number)} · {fmtDate(po.delivery_date)} · {po.line_count} line{po.line_count === 1 ? '' : 's'}
          {prices && po.total != null && <> · {money(po.total)}</>}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </button>
  )
}

function Deliveries({ venueId, meta, onOpen }) {
  const api = useApi()
  const [showDone, setShowDone] = useState(false)
  const { data: pos = [], isLoading, error } = useQuery({
    queryKey: ['purchase-orders', venueId, showDone],
    queryFn: () => api.get(`/purchasing/pos?venue_id=${venueId}&status=${showDone ? 'received,cancelled' : 'to_send,sent'}&limit=200`),
  })
  const today = new Date().toISOString().slice(0, 10)
  const prices = !!meta?.show_prices
  const toSend = pos.filter(p => p.status === 'to_send')
  const sent = pos.filter(p => p.status === 'sent').sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
  const due = sent.filter(p => p.delivery_date <= today)
  const later = sent.filter(p => p.delivery_date > today)
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Segmented value={showDone ? 'done' : 'open'} onChange={v => setShowDone(v === 'done')}
          options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Received & cancelled' }]} />
      </div>
      <ErrorNote error={error} />
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto my-10 text-muted-foreground" /> : showDone ? (
        <Section title="Received and cancelled" pos={[...pos].sort((a, b) => b.delivery_date.localeCompare(a.delivery_date))} prices={prices} onOpen={onOpen} empty="Nothing yet." />
      ) : (
        <>
          {!pos.length && <p className="text-sm text-muted-foreground text-center py-8">No open orders. Place one from the Order tab.</p>}
          {toSend.length > 0 && <Section title="To send" hint="Placed but not with the supplier yet" pos={toSend} prices={prices} onOpen={onOpen} />}
          {due.length > 0 && <Section title="Due today or overdue" hint="Book them in when they arrive" pos={due} prices={prices} onOpen={onOpen} />}
          {later.length > 0 && <Section title="Coming up" pos={later} prices={prices} onOpen={onOpen} />}
        </>
      )}
    </div>
  )
}

function Section({ title, hint, pos, prices, onOpen, empty }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title} <span className="text-muted-foreground font-normal">({pos.length})</span></h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {!pos.length && empty && <p className="text-sm text-muted-foreground">{empty}</p>}
      {pos.map(p => <PoCard key={p.id} po={p} prices={prices} onOpen={() => onOpen(p.id)} />)}
    </section>
  )
}

// ── Purchase order ──────────────────────────────────────────────

function PoDetail({ poId, meta, phone, onBack }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: po, isLoading, error } = useQuery({ queryKey: ['purchase-order', poId], queryFn: () => api.get(`/purchasing/pos/${poId}`) })
  const [receiving, setReceiving] = useState(false)
  const [markSent, setMarkSent] = useState(false)
  const [editQty, setEditQty] = useState(null)
  const [busy, setBusy] = useState(null)
  const [fileErr, setFileErr] = useState(null)
  const done = saved => {
    qc.setQueryData(['purchase-order', poId], saved)
    qc.invalidateQueries({ queryKey: ['purchase-orders'] })
  }
  const send = useMutation({ mutationFn: () => api.post(`/purchasing/pos/${poId}/send`), onSuccess: done, onError: () => qc.invalidateQueries({ queryKey: ['purchase-order', poId] }) })
  const cancel = useMutation({ mutationFn: () => api.post(`/purchasing/pos/${poId}/cancel`), onSuccess: done })
  const patch = useMutation({ mutationFn: body => api.patch(`/purchasing/pos/${poId}`, body), onSuccess: done })
  const saveQty = useMutation({
    mutationFn: () => api.put(`/purchasing/pos/${poId}/lines`, { lines: Object.entries(editQty).map(([id, qty]) => ({ id, qty })) }),
    onSuccess: saved => { done(saved); setEditQty(null) },
  })

  const file = async format => {
    setBusy(format); setFileErr(null)
    try {
      if (format === 'html') {
        const blob = await api.blob(`/purchasing/pos/${poId}/file?format=html`)
        printHtml(await blob.text())
      } else {
        await api.download(`/purchasing/pos/${poId}/file?format=${format}`, `${poNumberLabel(po.number)}-${po.supplier_name.replace(/[^\w-]+/g, '-')}.${format}`)
      }
    } catch (e) { setFileErr(e) } finally { setBusy(null) }
  }

  if (isLoading || !po) return <div className="p-6"><ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}</div>
  const prices = !!po.show_prices
  const canOrder = !!meta?.can_order
  const open = ['to_send', 'sent'].includes(po.status)

  return (
    <div className={cn('space-y-4', phone ? 'p-3' : 'p-4 max-w-4xl mx-auto')}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="w-11 h-11 -ml-2 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation" aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{po.supplier_name} <span className="font-normal text-muted-foreground">{poNumberLabel(po.number)}</span></p>
          <p className="text-xs text-muted-foreground truncate">{po.venue_name}{po.account_ref ? ` · account ${po.account_ref}` : ''}</p>
        </div>
        <PoStatusBadge status={po.status} />
      </div>

      <div className="rounded-xl border bg-background p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Delivery</span>
          {open && canOrder
            ? <DateButton value={po.delivery_date} onChange={d => patch.mutate({ delivery_date: d })} label="Delivery date" />
            : <span className="font-medium">{fmtDateLong(po.delivery_date)}</span>}
        </div>
        <p className="text-sm text-muted-foreground">
          Placed {new Date(po.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{po.created_by ? ` by ${po.created_by}` : ''}
          {po.sent_at && <><br />Sent {new Date(po.sent_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} ({SENT_VIA.find(v => v.key === po.sent_via)?.label.toLowerCase() || po.sent_via}{po.sent_to ? ` to ${po.sent_to}` : ''})</>}
          {po.received_at && <><br />Received {new Date(po.received_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{po.received_by ? ` by ${po.received_by}` : ''}</>}
        </p>
        {po.supplier_phone && <p className="text-sm">Phone <a className="underline" href={`tel:${po.supplier_phone}`}>{po.supplier_phone}</a></p>}
        {po.notes && <p className="text-sm rounded-lg bg-muted/50 px-3 py-2">Note to supplier: {po.notes}</p>}
        {po.send_error && po.status === 'to_send' && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Email failed: {po.send_error}</p>
        )}
      </div>

      {canOrder && open && (
        <div className="flex flex-wrap gap-2">
          {po.status === 'sent' && <button type="button" className={btn.primary} onClick={() => setReceiving(true)}><PackageCheck className="w-4 h-4" />Book in delivery</button>}
          {po.status === 'to_send' && po.supplier_email && (
            <button type="button" className={btn.primary} disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}Email to {po.supplier_email}
            </button>
          )}
          {po.status === 'to_send' && <button type="button" className={po.supplier_email ? btn.outline : btn.primary} onClick={() => setMarkSent(true)}><Send className="w-4 h-4" />Mark as sent</button>}
          {po.status === 'to_send' && editQty == null && (
            <button type="button" className={btn.outline} onClick={() => setEditQty(Object.fromEntries(po.lines.map(l => [l.id, l.qty])))}>Change quantities</button>
          )}
          {po.status === 'sent' && po.supplier_email && (
            <button type="button" className={btn.outline} disabled={send.isPending} onClick={() => send.mutate()}><Repeat className="w-4 h-4" />Email again</button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.outline} disabled={!!busy} onClick={() => file('html')}><Printer className="w-4 h-4" />Print</button>
        <button type="button" className={btn.outline} disabled={!!busy} onClick={() => file('pdf')}><FileText className="w-4 h-4" />PDF</button>
        <button type="button" className={btn.outline} disabled={!!busy} onClick={() => file('xlsx')}><FileSpreadsheet className="w-4 h-4" />Excel</button>
        {busy && <Loader2 className="w-4 h-4 animate-spin self-center" />}
      </div>
      <ErrorNote error={send.error || cancel.error || patch.error || fileErr || saveQty.error} />

      <section className="rounded-xl border bg-background overflow-hidden">
        <div className="section-head px-4 py-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold flex-1">Lines</h3>
          {editQty && (
            <>
              <button type="button" className={btn.primary} disabled={saveQty.isPending} onClick={() => saveQty.mutate()}>Save</button>
              <button type="button" className={btn.ghost} onClick={() => setEditQty(null)}>Cancel</button>
            </>
          )}
        </div>
        <div className="divide-y">
          {po.lines.map(l => (
            <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm font-medium">{l.item_name} <StorageBadge storage={l.storage} /></p>
                <p className="text-xs text-muted-foreground">{[l.supplier_code, l.pack_label].filter(Boolean).join(' · ')}</p>
                {l.receive_status && l.receive_status !== 'ok' && (
                  <p className="text-xs text-amber-800">
                    {RECEIVE_STATUSES.find(s => s.key === l.receive_status)?.label}: received {fmtNum(l.received_qty ?? 0)}{l.receive_note ? ` (${l.receive_note})` : ''}
                  </p>
                )}
              </div>
              {editQty ? (
                <QtyStepper value={editQty[l.id]} onChange={v => setEditQty(e => ({ ...e, [l.id]: v }))} label={l.item_name} />
              ) : (
                <span className="text-sm tabular-nums font-medium">× {fmtNum(l.qty)}</span>
              )}
              {prices && l.price != null && <span className="w-24 text-right text-sm tabular-nums">{money(lineAmounts(l).net)}</span>}
            </div>
          ))}
        </div>
        {prices && po.total != null && (
          <div className="border-t px-4 py-2 text-sm space-y-0.5 text-right tabular-nums">
            <p>Subtotal {money(po.subtotal)}</p>
            <p>VAT {money(po.vat)}</p>
            {po.delivery_charge > 0 && <p>Delivery {money(po.delivery_charge)}</p>}
            <p className="font-semibold">Total {money(po.total)}</p>
          </div>
        )}
      </section>

      {po.delivery_check && <CheckSummary check={po.delivery_check} />}

      {canOrder && po.status === 'received' && (
        <button type="button" className={btn.outline} onClick={() => setReceiving(true)}>Correct the delivery</button>
      )}
      {canOrder && open && (
        <div className="flex items-center justify-end gap-2 pt-2">
          <span className="text-xs text-muted-foreground">Cancel this order</span>
          <ConfirmDelete label="Cancel order" confirmLabel="Yes, cancel it" onConfirm={() => cancel.mutate()} />
        </div>
      )}

      {markSent && (
        <MarkSentModal po={po} onClose={() => setMarkSent(false)} onSaved={saved => { done(saved); setMarkSent(false) }} />
      )}
      {receiving && <ReceiveForm po={po} onClose={() => setReceiving(false)} onSaved={saved => { done(saved); setReceiving(false); qc.invalidateQueries({ queryKey: ['fs-deliveries'] }) }} />}
    </div>
  )
}

function CheckSummary({ check }) {
  const ok = check.packaging_ok && check.damage_ok && check.quality_ok && check.temp_ok
  return (
    <section className={cn('rounded-xl border p-4 space-y-1 text-sm', ok && check.accepted ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200')}>
      <p className="font-semibold flex items-center gap-2"><Truck className="w-4 h-4" />Delivery check (Food safety)</p>
      <p>{[!check.packaging_ok && 'packaging', !check.damage_ok && 'damage', !check.quality_ok && 'quality', !check.temp_ok && 'temperature'].filter(Boolean).join(', ') ? `Problems: ${[!check.packaging_ok && 'packaging', !check.damage_ok && 'damage', !check.quality_ok && 'quality', !check.temp_ok && 'temperature'].filter(Boolean).join(', ')}` : 'All checks passed'}{check.product_temp_c != null ? ` · ${check.product_temp_c}°C` : ''}</p>
      <p>{check.accepted ? 'Accepted' : 'Not accepted'}{check.corrective_action ? ` · ${check.corrective_action}` : ''}</p>
      <p className="text-xs text-muted-foreground">Recorded {fmtDate(check.delivery_date)}{check.recorded_by ? ` by ${check.recorded_by}` : ''}</p>
    </section>
  )
}

function MarkSentModal({ po, onClose, onSaved }) {
  const api = useApi()
  const [via, setVia] = useState(po.send_method === 'excel' ? 'excel' : po.send_method === 'pdf' ? 'pdf' : 'print')
  const save = useMutation({ mutationFn: () => api.post(`/purchasing/pos/${po.id}/mark-sent`, { via }), onSuccess: onSaved })
  return (
    <Modal title="Mark as sent" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={save.isPending} onClick={() => save.mutate()}>Mark as sent</button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <p className="text-sm text-muted-foreground">How did the order reach {po.supplier_name}?</p>
      <div className="space-y-2">
        {SENT_VIA.map(v => (
          <button key={v.key} type="button" onClick={() => setVia(v.key)}
            className={cn('w-full text-left rounded-xl border px-3 min-h-[48px] text-sm touch-manipulation flex items-center gap-2', via === v.key ? 'border-primary bg-primary/5' : 'hover:bg-muted/40')}>
            <span className="flex-1">{v.label}</span>{via === v.key && <Check className="w-4 h-4 text-primary" />}
          </button>
        ))}
      </div>
      <ErrorNote error={save.error} />
    </Modal>
  )
}

// ── Receiving ───────────────────────────────────────────────────

function YesNo({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-sm">{label}</span>
      <Segmented value={value ? 'yes' : 'no'} onChange={v => onChange(v === 'yes')}
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
    </div>
  )
}

function TempField({ label, icon: Icon, value, onChange, max }) {
  const [keypad, setKeypad] = useState(false)
  const bad = value != null && value > max
  return (
    <Field label={<span className="inline-flex items-center gap-1"><Icon className="w-3.5 h-3.5" />{label} (°C, at or below {max})</span>}>
      {IS_TOUCH ? (
        <button type="button" onClick={() => setKeypad(true)}
          className={cn(inputCls, 'text-left tabular-nums', bad && 'border-red-400 bg-red-50')}>{value != null ? `${value}°C` : 'Tap to enter'}</button>
      ) : (
        <NumInput value={value} onChange={onChange} allowNegative className={cn(bad && 'border-red-400 bg-red-50')} />
      )}
      {keypad && <TempKeypadModal label={label} initialValue={value} onClose={() => setKeypad(false)} onConfirm={v => { onChange(v); setKeypad(false) }} />}
    </Field>
  )
}

function ReceiveForm({ po, onClose, onSaved }) {
  const api = useApi()
  const prev = po.delivery_check
  const [rows, setRows] = useState(() => Object.fromEntries(po.lines.map(l => [l.id, {
    received_qty: l.received_qty ?? l.qty, status: l.receive_status || null, note: l.receive_note || '',
  }])))
  const [chk, setChk] = useState(() => ({
    packaging_ok: prev?.packaging_ok ?? true, damage_ok: prev?.damage_ok ?? true, quality_ok: prev?.quality_ok ?? true,
    accepted: prev?.accepted ?? true, corrective_action: prev?.corrective_action || '',
    chilled_temp_c: prev?.items?.find(i => i.temp_c != null && po.lines.find(l => l.item_name === i.name)?.storage === 'chilled')?.temp_c ?? null,
    frozen_temp_c: prev?.items?.find(i => i.temp_c != null && po.lines.find(l => l.item_name === i.name)?.storage === 'frozen')?.temp_c ?? null,
  }))
  const [notes, setNotes] = useState(po.receive_notes || '')
  const setRow = (id, k, v) => setRows(r => ({ ...r, [id]: { ...r[id], [k]: v } }))
  const setC = (k, v) => setChk(c => ({ ...c, [k]: v }))
  const arrived = po.lines.filter(l => Number(rows[l.id].received_qty) > 0)
  const hasChilled = arrived.some(l => l.storage === 'chilled')
  const hasFrozen = arrived.some(l => l.storage === 'frozen')
  const tempBad = (hasChilled && !deliveryTempOk('chilled', chk.chilled_temp_c)) || (hasFrozen && !deliveryTempOk('frozen', chk.frozen_temp_c))
  const problem = !chk.packaging_ok || !chk.damage_ok || !chk.quality_ok || tempBad || !chk.accepted
  const missingTemp = (hasChilled && chk.chilled_temp_c == null) || (hasFrozen && chk.frozen_temp_c == null)
  const save = useMutation({
    mutationFn: () => api.post(`/purchasing/pos/${po.id}/receive`, {
      notes,
      lines: po.lines.map(l => ({
        id: l.id, received_qty: Number(rows[l.id].received_qty) || 0,
        status: rows[l.id].status || receiveStatusFor(l.qty, rows[l.id].received_qty),
        note: rows[l.id].note,
      })),
      check: {
        packaging_ok: chk.packaging_ok, damage_ok: chk.damage_ok, quality_ok: chk.quality_ok, accepted: chk.accepted,
        chilled_temp_c: hasChilled ? chk.chilled_temp_c : null, frozen_temp_c: hasFrozen ? chk.frozen_temp_c : null,
        corrective_action: chk.corrective_action,
      },
    }),
    onSuccess: onSaved,
  })
  return (
    <div className="fixed inset-0 z-40 bg-page flex flex-col" role="dialog" aria-modal="true" aria-label="Book in delivery">
      <div className="flex items-center gap-2 px-4 h-14 border-b bg-background shrink-0">
        <button type="button" onClick={onClose} className="w-11 h-11 -ml-2 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation" aria-label="Close"><X className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">Book in: {po.supplier_name}</p>
          <p className="text-xs text-muted-foreground">{poNumberLabel(po.number)} · due {fmtDate(po.delivery_date)}</p>
        </div>
        <button type="button" className={btn.primary} disabled={save.isPending || missingTemp || (problem && !chk.corrective_action.trim())} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          <section className="rounded-xl border bg-background overflow-hidden">
            <div className="section-head px-4 py-2"><h3 className="text-sm font-semibold">What arrived</h3></div>
            <div className="divide-y">
              {po.lines.map(l => {
                const r = rows[l.id]
                const auto = receiveStatusFor(l.qty, r.received_qty)
                const status = r.status || auto
                return (
                  <div key={l.id} className="px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[160px]">
                        <p className="text-sm font-medium">{l.item_name} <StorageBadge storage={l.storage} /></p>
                        <p className="text-xs text-muted-foreground">{l.pack_label} · ordered {fmtNum(l.qty)}</p>
                      </div>
                      <QtyStepper value={r.received_qty} onChange={v => setRow(l.id, 'received_qty', v)} label={l.item_name} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {RECEIVE_STATUSES.map(s => (
                        <button key={s.key} type="button" onClick={() => setRow(l.id, 'status', s.key === auto ? null : s.key)}
                          className={cn('h-9 px-3 rounded-full border text-xs touch-manipulation', status === s.key ? (s.key === 'ok' ? 'bg-green-600 text-white border-green-600' : 'bg-amber-500 text-white border-amber-500') : 'hover:bg-muted')}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                    {status !== 'ok' && (
                      <input className={inputCls} value={r.note} onChange={e => setRow(l.id, 'note', e.target.value)}
                        placeholder={status === 'substituted' ? 'What came instead?' : 'Note (e.g. credit requested)'} />
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border bg-background overflow-hidden">
            <div className="section-head px-4 py-2"><h3 className="text-sm font-semibold">Checks</h3></div>
            <div className="p-4 space-y-3">
              <YesNo label="Packaging intact and clean" value={chk.packaging_ok} onChange={v => setC('packaging_ok', v)} />
              <YesNo label="No damage" value={chk.damage_ok} onChange={v => setC('damage_ok', v)} />
              <YesNo label="Quality and dates OK" value={chk.quality_ok} onChange={v => setC('quality_ok', v)} />
              {(hasChilled || hasFrozen) && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {hasChilled && <TempField label="Chilled goods" icon={Thermometer} value={chk.chilled_temp_c} max={DELIVERY_TEMP_MAX.chilled} onChange={v => setC('chilled_temp_c', v)} />}
                  {hasFrozen && <TempField label="Frozen goods" icon={Snowflake} value={chk.frozen_temp_c} max={DELIVERY_TEMP_MAX.frozen} onChange={v => setC('frozen_temp_c', v)} />}
                </div>
              )}
              <Toggle checked={chk.accepted} onChange={v => setC('accepted', v)} label="Delivery accepted" />
              {problem && (
                <Field label="What was done about it" hint="Needed when a check fails or the delivery isn't accepted">
                  <input className={cn(inputCls, !chk.corrective_action.trim() && 'border-amber-400')} value={chk.corrective_action}
                    onChange={e => setC('corrective_action', e.target.value)} placeholder="e.g. Rejected, credit requested" />
                </Field>
              )}
              <Field label="Notes"><input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
              <p className="text-xs text-muted-foreground">Saving records the delivery check under Food safety → Deliveries for {fmtDate(new Date().toISOString())}.</p>
              <ErrorNote error={save.error} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
