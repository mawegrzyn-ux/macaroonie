// src/components/purchasing/ordering.jsx
//
// The restaurant side of purchasing, shared by the Purchasing page
// (/purchasing) and its phone version (/mobile/purchasing):
//
//   PurchasingApp  Order tab (orders waiting for approval, the venue's
//                  order lists, drafts) and Deliveries tab (purchase orders
//                  to send, due, received).
//   OrderForm      fill in a list: quantities (saved as they're typed),
//                  par fill, supplier switch, extra items; Place order
//                  splits it into one purchase order per supplier. Without
//                  Purchasing approval it is sent for approval instead; an
//                  approver changes the request, places it, splits it into a
//                  second order for another day or sends it back
//                  (migration 180). What may be done comes from the order
//                  itself (can_edit, can_place, can_request ...).
//   PoDetail       one purchase order: send / print / Excel / PDF / mark
//                  sent / change quantities and add the supplier's other
//                  products while it waits in To send (AddPoItemsModal) /
//                  split for another day / cancel / book the delivery in.
//   ReceiveForm    what arrived, the checks and temperatures; writes the
//                  venue's H&S delivery check. Pepper can read the invoice
//                  first (components/purchasing/invoice.jsx, migration 197):
//                  quantities and invoice prices filled in, what wasn't
//                  ordered added; then the price list can be updated.
//
// The view lives in the URL (?order=, ?po=, ?tab=) so a refresh keeps it.
// Prices show only for people with purchasing_setup view (meta.show_prices).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, Plus, Search, Printer, FileText, FileSpreadsheet, Mail, Check, AlertTriangle, Truck,
  ClipboardList, ChevronRight, ChevronDown, X, PackageCheck, Send, Repeat, Thermometer, Snowflake, Eye,
  Hourglass, Scissors, Undo2, Copy, Clock, Phone, Pencil,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, Field, inputCls, ErrorNote, Segmented, ConfirmDelete } from '@/components/staff/shared'
import { TempKeypadModal } from '@/components/foodSafety/shared'
import {
  usePurchasingMeta, QtyStepper, NumInput, DateButton, StorageBadge, PoStatusBadge, Toggle, btn, money, fmtDate,
  fmtDateLong, printHtml, IS_TOUCH, CodeTag,
} from '@/components/purchasing/shared'
import {
  fitQty, qtyProblem, packsToPar, orderTotals, lineAmounts, fmtNum, poNumberLabel, receiveStatusFor,
  deliveryTempOk, RECEIVE_STATUSES, DELIVERY_TEMP_MAX, deliveryDateChoices, addDays,
  convertQty, splitProblem, deliveryDayProblem, deadlineText, nowAt, formatBase, slotText, checkoutText,
  deadlinePassed, quickOrder, quickOrderCsv,
} from '@shared/procurement.js'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import {
  InvoiceReader, readingToForm, extraOf, extraProblem, InvoiceLineNote, ExtrasSection, PriceListModal, InvoiceList,
} from '@/components/purchasing/invoice'

const SENT_VIA = [
  { key: 'print', label: 'Printed and handed over' },
  { key: 'pdf', label: 'Sent the PDF' },
  { key: 'excel', label: 'Uploaded the Excel file' },
  { key: 'website', label: 'Ordered on their website or app' },
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
  const requests = useRequests(venueId)

  if (!venueId) return <p className="p-6 text-sm text-muted-foreground">Add a venue first.</p>
  if (orderId) {
    return <OrderForm key={orderId} orderId={orderId} meta={meta} phone={phone}
      onBack={() => go({})} onPlaced={() => go({ tab: 'deliveries' })} onOpenPo={id => go({ po: id })}
      onOpenOrder={id => go({ order: id })} />
  }
  if (poId) return <PoDetail key={poId} poId={poId} meta={meta} phone={phone} onBack={() => go({ tab: 'deliveries' })} onOpenPo={id => go({ po: id })} />
  const toApprove = meta?.can_approve ? requests.length : 0

  return (
    <div className={cn('space-y-4', phone ? 'p-3' : 'p-4 max-w-5xl mx-auto')}>
      <Segmented value={tab} onChange={t => go(t === 'order' ? {} : { tab: t })} className="w-full sm:w-auto [&>button]:flex-1"
        options={[{ value: 'order', label: toApprove ? `Order (${toApprove} to approve)` : 'Order' }, { value: 'deliveries', label: 'Deliveries' }]} />
      {tab === 'order'
        ? <OrderHome venueId={venueId} meta={meta} onOpen={id => go({ order: id })} />
        : <Deliveries venueId={venueId} meta={meta} onOpen={id => go({ po: id })} />}
    </div>
  )
}

// ── Order tab ───────────────────────────────────────────────────

/** The venue's orders waiting for approval, oldest first. */
function useRequests(venueId) {
  const api = useApi()
  const { data = [] } = useQuery({
    queryKey: ['supply-orders', venueId, 'requested'],
    queryFn: () => api.get(`/purchasing/orders?venue_id=${venueId}&status=requested`),
    enabled: !!venueId,
  })
  return data
}

const when = t => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '')

/** The delivery days a request asks for, one per supplier, earliest first. */
const askedDays = options => [...new Set(Object.values(options || {}).map(o => o?.delivery_date).filter(Boolean))].sort()

function RequestCard({ order: r, canApprove, onOpen }) {
  const days = askedDays(r.supplier_options)
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left rounded-xl border bg-background p-3 hover:shadow-sm touch-manipulation flex items-center gap-3 min-h-[64px]">
      <Hourglass className="w-5 h-5 text-amber-600 shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-semibold truncate">{r.list_name || 'Other items'}</span>
          {r.split_from && <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted">Split</span>}
        </span>
        <span className="block text-sm text-muted-foreground">
          {r.line_count} line{r.line_count === 1 ? '' : 's'}{days.length ? ` · for ${days.map(fmtDate).join(', ')}` : ''}
        </span>
        <span className="block text-xs text-muted-foreground truncate">Asked by {r.requested_by || 'someone'} · {when(r.requested_at)}</span>
      </span>
      <span className="text-sm font-medium text-primary inline-flex items-center gap-1">{canApprove ? 'Review' : 'View'}<ChevronRight className="w-4 h-4" /></span>
    </button>
  )
}

function OrderHome({ venueId, meta, onOpen }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: lists = [], isLoading } = useQuery({ queryKey: ['order-lists', venueId], queryFn: () => api.get(`/purchasing/lists?venue_id=${venueId}`) })
  const { data: drafts = [] } = useQuery({ queryKey: ['supply-orders', venueId, 'draft'], queryFn: () => api.get(`/purchasing/orders?venue_id=${venueId}&status=draft`) })
  const requests = useRequests(venueId)
  const start = useMutation({
    mutationFn: listId => api.post('/purchasing/orders', { venue_id: venueId, list_id: listId }),
    onSuccess: o => { qc.invalidateQueries({ queryKey: ['supply-orders', venueId] }); onOpen(o.id) },
  })
  const draftFor = listId => drafts.find(d => (d.list_id || null) === (listId || null))
  const canOrder = !!meta?.can_order
  const canApprove = !!meta?.can_approve

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin mx-auto my-10 text-muted-foreground" />
  return (
    <div className="space-y-3">
      {requests.length > 0 && (
        <section className="space-y-2 pb-2">
          <div>
            <h3 className="text-sm font-semibold">Waiting for approval <span className="text-muted-foreground font-normal">({requests.length})</span></h3>
            <p className="text-xs text-muted-foreground">
              {canApprove ? 'Check each one, change it if needed, then place it, split it or send it back.' : 'A manager places these, or sends them back to be changed.'}
            </p>
          </div>
          {requests.map(r => <RequestCard key={r.id} order={r} canApprove={canApprove} onOpen={() => onOpen(r.id)} />)}
        </section>
      )}
      {requests.length > 0 && lists.length > 0 && <h3 className="text-sm font-semibold">Start an order</h3>}
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
                {d && <DraftBadge draft={d} />}
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
            {draftFor(null) && <DraftBadge draft={draftFor(null)} />}
          </span>
          <Plus className="w-5 h-5 text-primary" />
        </button>
      </div>
      {!canOrder && <p className="text-xs text-muted-foreground">You can see orders but not place them.</p>}
      {canOrder && !canApprove && <p className="text-xs text-muted-foreground">Your orders go to a manager for approval before they reach suppliers.</p>}
      <ErrorNote error={start.error} />
    </div>
  )
}

function DraftBadge({ draft: d }) {
  const lines = `${d.line_count} line${d.line_count === 1 ? '' : 's'}`
  return d.return_note
    ? <span className="mt-1 inline-block text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-900">Sent back · {lines}</span>
    : <span className="mt-1 inline-block text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Draft · {lines}</span>
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

function OrderForm({ orderId, meta, phone, onBack, onPlaced, onOpenPo, onOpenOrder }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: order, isLoading, error } = useQuery({ queryKey: ['supply-order', orderId], queryFn: () => api.get(`/purchasing/orders/${orderId}`) })
  const [lines, setLines] = useState({})
  const [search, setSearch] = useState('')
  const [onlyQty, setOnlyQty] = useState(false)
  const [groupBy, setGroupBy] = useState(() => { try { return localStorage.getItem('maca_purchasing_group') || 'category' } catch { return 'category' } })
  const [switching, setSwitching] = useState(null)
  const [adding, setAdding] = useState(false)
  const [reviewing, setReviewing] = useState(null)
  const [splitting, setSplitting] = useState(false)
  const [sendingBack, setSendingBack] = useState(false)
  const [splitDone, setSplitDone] = useState(null)
  const [result, setResult] = useState(null)
  const [showing, setShowing] = useState(false)
  const [quick, setQuick] = useState(false)
  const [show, setShow] = useShowPrefs()
  const save = useAutosave(orderId)
  const prices = !!order?.show_prices
  const editable = !!order?.can_edit
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

  // After the server changed the quantities (a split): its lines win.
  const reload = fresh => {
    qc.setQueryData(['supply-order', orderId], fresh)
    setLines(Object.fromEntries(fresh.items.map(it => [it.item_id, { qty: it.qty, quote_id: it.quote?.id ?? null }])))
    qc.invalidateQueries({ queryKey: ['supply-orders'] })
  }
  const withdraw = useMutation({ mutationFn: () => api.post(`/purchasing/orders/${orderId}/withdraw`), onSuccess: reload })
  const decline = useMutation({
    mutationFn: () => api.delete(`/purchasing/orders/${orderId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['supply-orders'] }); onBack() },
  })

  const qtyOf = it => Number(lines[it.item_id]?.qty) || 0
  const pickedLive = it => it.quotes.find(q => q.id === lines[it.item_id]?.quote_id) || null
  // A line with a quantity whose price, supplier or item has been switched
  // off since it was filled in (it.gone): it waits for another price or to
  // be taken off, and is never ordered on some other price by itself.
  const goneOf = it => {
    if (!it.gone || qtyOf(it) <= 0) return null
    if (it.gone.why === 'item_off') return it.gone
    return pickedLive(it) ? null : it.gone
  }
  const quoteOf = it => pickedLive(it) || it.quote ||
    (goneOf(it) ? null : it.quotes.find(q => q.id === it.default_quote_id) || null)

  // Each quantity is saved with the price it is shown on (the line keeps it).
  const setQty = (it, qty) => {
    const q = quoteOf(it)
    setLines(l => ({ ...l, [it.item_id]: { ...l[it.item_id], qty, ...(q ? { quote_id: q.id } : {}) } }))
    save.queue({ item_id: it.item_id, qty, ...(q ? { quote_id: q.id } : {}) })
  }
  // Another supplier or pack keeps the amount: 3 x 5 kg becomes 2 x 10 kg.
  const setQuote = (it, quoteId) => {
    const from = quoteOf(it) || it.gone?.quote || null
    const to = it.quotes.find(q => q.id === quoteId)
    const qty = from && to ? convertQty(qtyOf(it), from, to) : qtyOf(it)
    setLines(l => ({ ...l, [it.item_id]: { ...l[it.item_id], qty, quote_id: quoteId } }))
    save.queue({ item_id: it.item_id, qty, quote_id: quoteId })
  }

  const fillPars = () => {
    for (const it of order.items) {
      const q = quoteOf(it)
      if (!q || it.par_base == null || qtyOf(it) > 0) continue
      const p = packsToPar(it.par_base, q)
      if (p > 0) setQty(it, p)
    }
  }
  const clearAll = () => { for (const it of order.items) if (qtyOf(it) > 0) setQty(it, 0) }
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
      if (!q || qty <= 0 || goneOf(it)) continue
      if (!m.has(q.supplier_id)) m.set(q.supplier_id, { supplier: order.suppliers[q.supplier_id] || { id: q.supplier_id, name: q.supplier_name }, lines: [] })
      m.get(q.supplier_id).lines.push({ it, q, raw: qty, qty: fitQty(qty, q), price: q.price, vat_rate: q.vat_rate })
    }
    for (const g of m.values()) g.totals = prices ? orderTotals(g.lines, g.supplier.delivery_charge) : null
    return [...m.values()]
  }, [order, lines]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !order) {
    return <div className="p-6"><ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}</div>
  }
  if (result) return <PlacedView result={result} prices={prices} phone={phone} onDone={onPlaced} onOpenPo={onOpenPo} />
  if (order.status === 'submitted') {
    return (
      <div className="p-4 space-y-3">
        <button type="button" className={btn.ghost} onClick={onBack}><ArrowLeft className="w-4 h-4" />Back</button>
        <p className="text-sm">This order was placed {order.submitted_at ? `on ${fmtDate(order.submitted_at)}` : ''}{order.submitted_by ? ` by ${order.submitted_by}` : ''}.</p>
        {order.requested_by && <p className="text-sm text-muted-foreground">Asked for by {order.requested_by}{order.requested_at ? ` on ${when(order.requested_at)}` : ''}.</p>}
        <div className="space-y-2">{(order.purchase_orders || []).map(p => <PoCard key={p.id} po={p} prices={prices} onOpen={() => onOpenPo(p.id)} />)}</div>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const now = nowAt(order.timezone)
  const visible = order.items.filter(it => (!onlyQty || qtyOf(it) > 0) && (!q || matchesSearch(it, q)))
  const groups = groupRows(visible, groupBy, order, quoteOf, now)
  const lineCount = bySupplier.reduce((n, g) => n + g.lines.length, 0)
  const goneLines = order.items.filter(goneOf)
  const grand = prices ? bySupplier.reduce((s, g) => s + g.totals.total, 0) : null
  const hasPars = order.items.some(it => it.par_base != null)
  const hasExtras = editable && order.items.some(it => !it.on_list)
  const requested = order.status === 'requested'
  const mainAction = order.can_place ? 'place' : order.can_request ? 'request' : null
  const mainLabel = mainAction === 'place' ? 'Place order' : 'Send for approval'
  const openReview = async () => { await save.flush(); setReviewing(mainAction) }

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
            <p className="text-xs text-muted-foreground truncate">
              {order.venue_name} · {requested ? 'Waiting for approval' : <SaveState state={save.state} />}
              {requested && editable && save.state !== 'saved' && <> · <SaveState state={save.state} /></>}
            </p>
          </div>
          {mainAction && (
            <button type="button" className={btn.primary} disabled={!lineCount || goneLines.length > 0} onClick={openReview}>
              {mainLabel}{lineCount ? ` (${lineCount})` : ''}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an item or a supplier's code"
              aria-label="Find an item by name or code" className={cn(inputCls, 'pl-9')} data-testid="order-search" />
          </div>
          <Segmented value={groupBy} onChange={v => { setGroupBy(v); try { localStorage.setItem('maca_purchasing_group', v) } catch { /* private */ } }}
            options={[{ value: 'category', label: 'Category' }, { value: 'supplier', label: 'Supplier' }]} />
          <button type="button" onClick={() => setOnlyQty(v => !v)}
            className={cn(btn.outline, onlyQty && 'bg-primary/10 border-primary')}>{onlyQty ? 'Showing ordered' : 'Only ordered'}</button>
          {hasPars && editable && <button type="button" className={btn.outline} onClick={fillPars}>Fill to par</button>}
          <button type="button" className={cn(btn.outline, showCount > 0 && 'bg-primary/10 border-primary')} onClick={() => setShowing(true)}>
            <Eye className="w-4 h-4" />Show{showCount ? ` (${showCount})` : ''}
          </button>
          {editable && <button type="button" className={btn.outline} onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Add item</button>}
          {lineCount > 0 && (
            <button type="button" className={btn.outline} onClick={() => setQuick(true)} data-testid="order-quick-order">
              <Copy className="w-4 h-4" />Codes
            </button>
          )}
        </div>
        <ErrorNote error={save.error} />
      </div>

      <RequestPanel order={order} phone={phone} busy={withdraw.isPending || decline.isPending}
        onSplit={async () => { await save.flush(); setSplitting(true) }}
        onSendBack={async () => { await save.flush(); setSendingBack(true) }}
        onWithdraw={() => withdraw.mutate()} onDecline={() => decline.mutate()} />
      {splitDone && (
        <div className="mx-4 mt-3 text-sm rounded-lg bg-green-50 border border-green-200 px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[200px]">Split. The second order ({splitDone.days.map(fmtDate).join(', ')}) is waiting for approval too.</span>
          <button type="button" className={btn.outline} onClick={() => onOpenOrder(splitDone.id)}>Open it</button>
        </div>
      )}
      <ErrorNote error={withdraw.error || decline.error} />
      {order.notes && <p className="mx-4 mt-3 text-sm rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">{order.notes}</p>}
      {goneLines.length > 0 && (
        <p className="mx-4 mt-3 text-sm rounded-lg bg-red-50 border border-red-200 px-3 py-2 flex items-start gap-2" data-testid="order-gone-note">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
          <span>
            {goneLines.length === 1 ? 'A line has' : `${goneLines.length} lines have`} a price or item that has been switched off
            ({goneLines.map(it => it.name).join(', ')}). Pick another price or take {goneLines.length === 1 ? 'it' : 'them'} off before {mainAction === 'request' ? 'sending it' : 'placing it'}.
          </span>
        </p>
      )}

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
                <OrderRow key={it.item_id} it={it} quote={quoteOf(it)} gone={goneOf(it)} qty={qtyOf(it)} view={view}
                  hasPars={hasPars} hasExtras={hasExtras} readOnly={!editable} asked={requested ? it.requested_qty : undefined}
                  onQty={v => setQty(it, v)} onSwitch={() => setSwitching(it)}
                  onRemove={editable && !it.on_list ? () => removeExtra.mutate(it.item_id) : null} />
              ))}
            </div>
          </section>
        ))}
        {lineCount > 0 && editable && (
          <button type="button" className={cn(btn.ghost, 'text-muted-foreground')} onClick={clearAll}>Clear all quantities</button>
        )}
      </div>

      {lineCount > 0 && (
        <div className="sticky bottom-0 z-20 mt-auto border-t bg-background px-4 py-2 flex items-center gap-3">
          <span className="flex-1 min-w-0 text-sm">
            <strong>{lineCount}</strong> line{lineCount === 1 ? '' : 's'} · {bySupplier.length} supplier{bySupplier.length === 1 ? '' : 's'}
            {prices && <> · <strong>{money(grand)}</strong> inc VAT</>}
          </span>
          {mainAction && (
            <button type="button" className={btn.primary} disabled={goneLines.length > 0} onClick={openReview}>
              {mainAction === 'place' ? 'Review & place' : 'Send for approval'}
            </button>
          )}
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
      {quick && (
        <QuickOrderModal onClose={() => setQuick(false)}
          groups={bySupplier.map(g => ({
            key: g.supplier.id, name: g.supplier.name,
            lines: g.lines.map(l => ({ code: l.q.supplier_code, name: l.q.product_name || l.it.name, qty: l.qty })),
          }))} />
      )}
      {switching && (
        <SwitchSupplierModal it={switching} current={quoteOf(switching)} gone={goneOf(switching)} qty={qtyOf(switching)}
          prices={prices} order={order} now={now}
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
        <ReviewModal order={order} groups={bySupplier} prices={prices} mode={reviewing} onClose={() => setReviewing(null)}
          onPlaced={r => { setReviewing(null); setResult(r); qc.invalidateQueries({ queryKey: ['supply-orders'] }); qc.invalidateQueries({ queryKey: ['purchase-orders'] }) }}
          onRequested={fresh => { setReviewing(null); reload(fresh) }} />
      )}
      {splitting && (
        <SplitRequestModal order={order} groups={bySupplier} onClose={() => setSplitting(false)}
          onSplit={(res, days) => { setSplitting(false); reload(res.order); setSplitDone({ id: res.new_order_id, days }) }} />
      )}
      {sendingBack && (
        <SendBackModal order={order} onClose={() => setSendingBack(false)}
          onDone={() => { setSendingBack(false); qc.invalidateQueries({ queryKey: ['supply-orders'] }); onBack() }} />
      )}
    </div>
  )
}

/**
 * Under the order's header: a request waiting for approval (who asked, the
 * days asked for, and what the approver or the person who asked can do), or
 * a draft that was sent back (why).
 */
function RequestPanel({ order, busy, onSplit, onSendBack, onWithdraw, onDecline }) {
  if (order.status === 'draft' && order.return_note) {
    return (
      <div className="mx-4 mt-3 text-sm rounded-lg bg-red-50 border border-red-200 px-3 py-2 space-y-0.5">
        <p className="font-medium flex items-center gap-1.5"><Undo2 className="w-4 h-4" />Sent back{order.returned_by ? ` by ${order.returned_by}` : ''}{order.returned_at ? ` on ${when(order.returned_at)}` : ''}</p>
        <p>{order.return_note}</p>
        {order.can_request && <p className="text-xs text-muted-foreground">Change it and send it for approval again.</p>}
      </div>
    )
  }
  if (order.status !== 'requested') return null
  const options = Object.entries(order.supplier_options || {}).filter(([, o]) => o?.delivery_date)
  return (
    <div className="mx-4 mt-3 text-sm rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 space-y-2">
      <div className="space-y-0.5">
        <p className="font-medium flex items-center gap-1.5"><Hourglass className="w-4 h-4" />Waiting for approval</p>
        <p className="text-muted-foreground">Asked for by {order.requested_by || 'someone'}{order.requested_at ? ` on ${when(order.requested_at)}` : ''}.</p>
        {options.length > 0 && (
          <p>Delivery wanted: {options.map(([sid, o]) => `${order.suppliers[sid]?.name || 'a supplier'} ${fmtDate(o.delivery_date)}`).join(' · ')}</p>
        )}
        {order.can_edit && <p className="text-xs text-muted-foreground">Change anything you need, then place it. Lines you change show what was asked for.</p>}
      </div>
      {(order.can_split || order.can_return || order.can_withdraw || order.can_delete) && (
        <div className="flex flex-wrap items-center gap-2">
          {order.can_split && <button type="button" className={btn.outline} onClick={onSplit}><Scissors className="w-4 h-4" />Split for another day</button>}
          {order.can_return && <button type="button" className={btn.outline} onClick={onSendBack}><Undo2 className="w-4 h-4" />Send back</button>}
          {order.can_withdraw && !order.can_return && (
            <button type="button" className={btn.outline} disabled={busy} onClick={onWithdraw}><Undo2 className="w-4 h-4" />Take it back to change</button>
          )}
          {order.can_delete && <ConfirmDelete label="Decline" confirmLabel="Yes, delete it" disabled={busy} onConfirm={onDecline} />}
        </div>
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

/** An order line found by its name, our code, or any supplier's product code or name for it. */
function matchesSearch(it, q) {
  if (it.name.toLowerCase().includes(q) || (it.code || '').toLowerCase().includes(q)) return true
  return (it.quotes || []).some(x => (x.supplier_code || '').toLowerCase().includes(q) || (x.product_name || '').toLowerCase().includes(q))
}

function groupRows(items, groupBy, order, quoteOf, now) {
  const m = new Map()
  for (const it of items) {
    let key, name, sort, sub
    if (groupBy === 'supplier') {
      const q = quoteOf(it)
      const s = q ? order.suppliers[q.supplier_id] : null
      key = q?.supplier_id || 'none'
      name = q ? q.supplier_name : 'No supplier'
      sort = name.toLowerCase()
      sub = s ? deliveryHint(s, now) : null
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

// The supplier's next delivery and when to order for it (its cutoff for
// that day, not just today's).
function deliveryHint(s, now) {
  return `Next delivery ${fmtDate(s.next_delivery)} · ${deadlineText(s, s.next_delivery, now)}`
}

/** Why a line can't be ordered as it is, from loadOrder()'s `gone`. */
function goneWords(gone) {
  if (gone.why === 'item_off') return 'Switched off in the inventory: take it off the order.'
  const q = gone.quote
  return gone.why === 'supplier_off'
    ? `${q.supplier_name} has been switched off. Pick another price, or take it off.`
    : `${q.supplier_name}'s price for ${q.pack_label} has been switched off. Pick another price, or take it off.`
}

function OrderRow({ it, quote, gone, qty, view, hasPars, hasExtras, readOnly, asked, onQty, onSwitch, onRemove }) {
  const problem = quote && !gone ? qtyProblem(qty, quote) : null
  // A switched-off price still shows its pack (struck through) as the
  // button that picks another.
  const shownQuote = quote || gone?.quote || null
  const canSwitch = !readOnly && gone?.why !== 'item_off' && (gone ? it.quotes.length > 0 : it.quotes.length > 1)
  const par = quote && it.par_base != null ? packsToPar(it.par_base, quote) : null
  const details = quote ? [
    view.supplier && quote.supplier_name,
    view.price && quote.price != null && `${money(quote.price)} per ${(quote.pack_name || 'pack').toLowerCase()}`,
  ].filter(Boolean).join(' · ') : ''
  const last = it.last
  const lastOtherPack = last && quote && last.pack_label !== quote.pack_label
  const parBtn = par > 0 && (
    <button type="button" onClick={() => onQty(par)} title="Set to par" disabled={readOnly}
      className={cn('h-11 px-2 rounded-lg border text-xs touch-manipulation disabled:opacity-60', qty === par ? 'bg-primary/10 border-primary' : 'hover:bg-muted')}>
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
          {!quote && !gone && <p className="text-xs text-amber-700">No supplier sells this: ask a manager</p>}
          {gone && (
            <div className="text-xs text-red-800 space-y-1" data-testid="order-line-gone">
              <p>{goneWords(gone)}</p>
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  {canSwitch && <button type="button" className={btn.outline} onClick={onSwitch}>Pick another price</button>}
                  <button type="button" className={btn.outline} onClick={() => onQty(0)}>Take it off</button>
                </div>
              )}
            </div>
          )}
          {(quote?.supplier_code || quote?.product_name) && (
            <p className="text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5"><CodeTag code={quote.supplier_code} />{quote.product_name}</p>
          )}
          {details && <p className="text-xs text-muted-foreground">{details}</p>}
          {view.last && last && (
            <p className="text-xs text-muted-foreground">
              Last {fmtNum(last.qty)}{lastOtherPack ? ` (${last.pack_label})` : ''} on {fmtDate(last.delivery_date)}
            </p>
          )}
          {problem && <p className="text-xs text-amber-700">{problem}: will order {fmtNum(fitQty(qty, quote))}</p>}
          {asked != null && asked !== qty && <p className="text-xs text-blue-800">Asked for {fmtNum(asked)}</p>}
        </div>
        {(parBtn || removeBtn) && <div className="sm:hidden flex items-center gap-1 shrink-0">{parBtn}{removeBtn}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
        {hasPars && <div className="hidden sm:flex w-16 justify-end">{parBtn}</div>}
        <PackLabel quote={shownQuote} gone={!!gone && gone.why !== 'item_off'} canSwitch={canSwitch} onSwitch={onSwitch} />
        <QtyStepper value={qty} onChange={onQty} step={quote?.order_multiple || 1} min={quote?.min_qty || 0}
          disabled={!quote || readOnly || !!gone} label={it.name} />
        {view.lastQty && <LastQty last={last} otherPack={lastOtherPack} />}
        {hasExtras && <div className="hidden sm:block w-11 shrink-0">{removeBtn}</div>}
      </div>
    </div>
  )
}

// The pack being ordered, big, next to the quantity. With more than one
// supplier it is the button that switches supplier.
function PackLabel({ quote, gone, canSwitch, onSwitch }) {
  const width = 'w-[84px] sm:w-28 shrink-0'
  if (!quote) return <span className={width} aria-hidden="true" />
  const name = quote.pack_name || quote.pack_label
  const inner = (
    <>
      <span className={cn('flex items-center justify-end gap-1 text-base font-semibold leading-tight break-words', gone && 'line-through text-muted-foreground')}>
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

/**
 * Picking the price a line is ordered on. With a quantity, each choice
 * says what it comes to in its packs (the amount is kept: convertQty()).
 */
function SwitchSupplierModal({ it, current, gone, qty, prices, order, now, onPick, onClose }) {
  const from = current || gone?.quote || null
  const amount = (n, q) => formatBase(n * Number(q.pack_base_qty || 0), it.base_unit)
  return (
    <Modal title={`Order ${it.name} from`} onClose={onClose}>
      {gone?.quote && (
        <p className="text-sm rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          Was {gone.quote.supplier_name}, {gone.quote.pack_label}: no longer offered.
        </p>
      )}
      <div className="space-y-2">
        {it.quotes.map(q => {
          const s = order.suppliers[q.supplier_id]
          const to = from && qty > 0 ? convertQty(qty, from, q) : null
          const otherPack = from && Math.abs(Number(from.pack_base_qty) - Number(q.pack_base_qty)) > 1e-9
          return (
            <button key={q.id} type="button" onClick={() => onPick(q.id)} data-testid="switch-quote"
              className={cn('w-full text-left rounded-xl border p-3 touch-manipulation min-h-[56px]', q.id === current?.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40')}>
              <span className="flex items-center gap-2">
                <span className="flex-1 font-medium text-sm">{q.supplier_name}</span>
                {q.id === it.default_quote_id && <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted">Usual</span>}
                {q.id === current?.id && <Check className="w-4 h-4 text-primary" />}
              </span>
              {q.product_name && <span className="block text-sm font-medium">{q.product_name}</span>}
              <span className="block text-sm"><CodeTag code={q.supplier_code} className="mr-1.5" />{q.pack_label}{prices && q.price != null ? ` · ${money(q.price)}` : ''}</span>
              {to != null && q.id !== current?.id && (
                <span className="block text-xs text-blue-900" data-testid="switch-qty">
                  {fmtNum(qty)} × {from.pack_label} {otherPack ? `(${amount(qty, from)}) ` : ''}becomes {fmtNum(to)} × {q.pack_label}
                  {otherPack ? ` (${amount(to, q)})` : ''}
                </span>
              )}
              {s && <span className="block text-xs text-muted-foreground">{deliveryHint(s, now)}</span>}
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
        <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code"
          aria-label="Search the inventory by name or code" autoFocus={!IS_TOUCH} />
      </div>
      {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
      <div className="rounded-xl border divide-y">
        {data.filter(i => !have.has(i.id)).map(i => {
          // A supplier's code typed in exactly: that supplier's product.
          const q = (i.matched_quote_id && i.quotes.find(x => x.id === i.matched_quote_id)) || i.quote
          return (
            <button key={i.id} type="button" onClick={() => onAdd(i, q)} data-testid="add-item-result"
              className="w-full text-left px-3 py-2 min-h-[52px] hover:bg-muted/40 touch-manipulation">
              <span className="block text-sm font-medium">{i.name} <StorageBadge storage={i.storage} /></span>
              {q && (
                <span className="block text-xs text-muted-foreground">
                  <CodeTag code={q.supplier_code} className="mr-1.5" />
                  {`${q.supplier_name} · ${q.pack_label}${prices && q.price != null ? ` · ${money(q.price)}` : ''}`}
                </span>
              )}
            </button>
          )
        })}
        {!isFetching && !data.filter(i => !have.has(i.id)).length && <p className="p-3 text-sm text-muted-foreground">Nothing found.</p>}
      </div>
    </Modal>
  )
}

/**
 * A delivery day: the date button plus the supplier's next delivery days as
 * chips. `exclude` leaves a day out of the chips (the first order's day when
 * splitting).
 */
function DeliveryDayPicker({ value, onChange, choices, min, exclude, label }) {
  const chips = choices.filter(d => d !== exclude)
  return (
    <div className="space-y-2">
      <DateButton value={value} min={min} onChange={onChange} label={label} />
      {chips.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Their delivery days:</span>
          {chips.map(d => {
            const on = value === d
            return (
              <button key={d} type="button" aria-pressed={on} onClick={() => onChange(d)}
                className={cn('h-11 px-3 rounded-lg border text-sm touch-manipulation',
                  on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted')}>
                {fmtDate(d)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Under a picked delivery day: when to order by for it, or why the
 * supplier can't make it (deliveryDayProblem(), the API's rule). A day they
 * don't deliver, or past its cutoff, can still be placed when the person
 * says it was agreed with the supplier (`agree`, a switch); a past day
 * never. In a request (`asking`) it's only a note: the approver decides.
 */
function DayCheck({ supplier: s, date, now, agreed, onAgree, asking = false }) {
  const problem = deliveryDayProblem(s, date, now, s.name)
  if (!problem) {
    return <p className="text-xs text-muted-foreground" data-testid="day-deadline">For {fmtDate(date)}: {deadlineText(s, date, now)}</p>
  }
  const past = problem.code === 'past'
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs space-y-1', past ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900')}
      data-testid="day-problem" data-problem={problem.code}>
      <p className="flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{problem.message}.</p>
      {!past && (asking
        ? <p>The manager agrees it with {s.name}, or picks another day, when placing it.</p>
        : <Toggle checked={!!agreed} onChange={onAgree} label={`Agreed with ${s.name}`} />)}
    </div>
  )
}

/** Whether a day stops the action: past, or a problem nobody agreed. */
function dayBlocked(s, date, now, agreed, asking = false) {
  const p = deliveryDayProblem(s, date, now, s.name)
  if (!p) return false
  return p.code === 'past' || (!asking && !agreed)
}

/**
 * Where an order's note for a supplier starts: what the request wrote
 * (empty when it cleared it), else the venue's driver instructions for that
 * supplier (migration 233), the same rule the API uses on placing.
 */
function noteFor(asked, supplier) {
  if (asked && Object.prototype.hasOwnProperty.call(asked, 'notes')) return asked.notes || ''
  return supplier.driver_instructions || ''
}

/**
 * The venue's open purchase order from a supplier for a day, the one the
 * API would add to: not sent yet first, then the lowest number.
 */
function openPoOn(openPos, supplierId, date) {
  const same = (openPos || []).filter(p => p.supplier_id === supplierId && p.delivery_date === date)
  return same.find(p => p.status === 'to_send') || same[0] || null
}

/** The delivery slot and phone the supplier has for this venue, when set. */
function DeliveryDetails({ supplier: s }) {
  const slot = slotText(s)
  if (!slot && !s.delivery_phone) return null
  return (
    <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5" data-testid="review-delivery-details">
      {slot && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Delivery slot {slot}</span>}
      {s.delivery_phone && <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" />Driver rings {s.delivery_phone}</span>}
    </p>
  )
}

/**
 * The venue already has an order from this supplier for the day picked:
 * add these lines to it while it waits in To send, or place a separate
 * order. Once it has gone to the supplier only a separate order is
 * possible (a second delivery or a call to them). In a request it's only a
 * note: the approver decides.
 */
function OpenPoChoice({ po, supplier: s, asking, value, onChange }) {
  const sent = po.status !== 'to_send'
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950 space-y-2"
      data-testid="review-open-po" data-status={po.status}>
      <p className="flex items-start gap-1.5">
        <ClipboardList className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          {poNumberLabel(po.number)} from {s.name} is already {sent ? 'with them' : 'waiting to be sent'} for {fmtDate(po.delivery_date)}.
          {asking ? ' The manager decides whether to add to it.' : sent ? ' Adding to it would need a call to them.' : ''}
        </span>
      </p>
      {!asking && (sent ? (
        <Toggle checked={value === 'separate'} onChange={v => onChange(v ? 'separate' : undefined)}
          label={`Place a second order with ${s.name} for that day`} />
      ) : (
        <Segmented value={value || null} onChange={onChange}
          options={[{ value: 'add', label: `Add to ${poNumberLabel(po.number)}` }, { value: 'separate', label: 'Separate order' }]} />
      ))}
      {!asking && !(value === 'separate' || (value === 'add' && !sent)) && (
        <p data-testid="review-open-po-ask">
          {sent ? 'Switch this on, or pick another day, to place the order.' : 'Pick one to place the order.'}
        </p>
      )}
    </div>
  )
}

/**
 * Placing the order (mode place) or sending it for approval (mode
 * request): a delivery day and a note per supplier. A request's days and
 * notes are where placing it starts.
 */
function ReviewModal({ order, groups, prices, mode = 'place', onClose, onPlaced, onRequested }) {
  const api = useApi()
  const qc = useQueryClient()
  const request = mode === 'request'
  const asked = order.supplier_options || {}
  // A note never written starts as the venue's driver instructions for the
  // supplier; one a request cleared stays empty (noteFor()).
  const [opts, setOpts] = useState(() => Object.fromEntries(groups.map(g => [g.supplier.id, {
    delivery_date: asked[g.supplier.id]?.delivery_date || g.supplier.next_delivery || order.today,
    notes: noteFor(asked[g.supplier.id], g.supplier),
  }])))
  const [note, setNote] = useState(order.notes || '')
  const [agreed, setAgreed] = useState({})
  // An order already open from a supplier for the picked day: add to it, or
  // place a separate one (supplier id -> 'add' | 'separate'), asked again
  // when the day changes.
  const [existing, setExisting] = useState({})
  const now = nowAt(order.timezone)
  const set = (sid, k, v) => setOpts(o => ({ ...o, [sid]: { ...o[sid], [k]: v } }))
  const sById = Object.fromEntries(groups.map(g => [g.supplier.id, g.supplier]))
  const openFor = sid => openPoOn(order.open_pos, sid, opts[sid].delivery_date)
  const suppliers = Object.fromEntries(Object.entries(opts).map(([sid, o]) => [sid, {
    delivery_date: o.delivery_date, notes: o.notes,
    ...(!request && agreed[sid] && deliveryDayProblem(sById[sid], o.delivery_date, now) ? { agreed: true } : {}),
    ...(!request && openFor(sid) && existing[sid] ? { existing: existing[sid] } : {}),
  }]))
  const blocked = groups.some(g => dayBlocked(g.supplier, opts[g.supplier.id].delivery_date, now, agreed[g.supplier.id], request))
  // Placing waits until every open order on the same day has an answer.
  const unanswered = !request && groups.some(g => {
    const open = openFor(g.supplier.id)
    const pick = existing[g.supplier.id]
    return open && !(pick === 'separate' || (pick === 'add' && open.status === 'to_send'))
  })
  const send = useMutation({
    mutationFn: () => (request
      ? api.post(`/purchasing/orders/${order.id}/request`, { suppliers, note })
      : api.post(`/purchasing/orders/${order.id}/submit`, { suppliers })),
    onSuccess: r => (request ? onRequested(r) : onPlaced(r)),
    // Someone placed or sent an order for the same day meanwhile: the order's
    // open purchase orders are read again so the question shows.
    onError: e => { if (['po_exists', 'po_sent'].includes(e?.body?.code)) qc.invalidateQueries({ queryKey: ['supply-order', order.id] }) },
  })
  return (
    <Modal title={request ? 'Send for approval' : 'Place order'} onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={send.isPending || blocked || unanswered} onClick={() => send.mutate()} data-testid="review-send">
          {send.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {request ? 'Send for approval' : `Place ${groups.length} order${groups.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Back</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        {request
          ? 'A manager checks it, can change it, then places it (or sends it back). Pick the day you\'d like each delivery.'
          : 'One purchase order per supplier. Quantities below a supplier\'s minimum or step are rounded up.'}
      </p>
      {groups.map(g => {
        const s = g.supplier
        const below = prices && s.min_order && g.totals.subtotal < s.min_order
        const wanted = asked[s.id]?.delivery_date
        return (
          <div key={s.id} className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold flex-1">{s.name}</span>
              <span className="text-sm text-muted-foreground">{g.lines.length} line{g.lines.length === 1 ? '' : 's'}</span>
              {prices && <span className="text-sm font-semibold tabular-nums">{money(g.totals.total)}</span>}
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {g.lines.map(l => (
                <li key={l.it.item_id}>
                  {fmtNum(l.qty)} × {l.it.name} <CodeTag code={l.q.supplier_code} /> <span className="opacity-75">({l.q.pack_label})</span>
                </li>
              ))}
            </ul>
            {below && <p className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Below their minimum order of {money(s.min_order)}</p>}
            <div className="flex flex-wrap items-start gap-2">
              <span className="text-sm h-11 inline-flex items-center">{request ? 'Wanted' : 'Delivery'}</span>
              <div className="flex-1 min-w-[200px]">
                <DeliveryDayPicker value={opts[s.id].delivery_date} min={order.today} choices={deliveryDateChoices(s)}
                  onChange={d => {
                    set(s.id, 'delivery_date', d)
                    setAgreed(a => ({ ...a, [s.id]: false }))
                    setExisting(x => ({ ...x, [s.id]: undefined }))
                  }} label={`Delivery date for ${s.name}`} />
              </div>
            </div>
            <DayCheck supplier={s} date={opts[s.id].delivery_date} now={now} asking={request}
              agreed={agreed[s.id]} onAgree={v => setAgreed(a => ({ ...a, [s.id]: v }))} />
            <DeliveryDetails supplier={s} />
            {openFor(s.id) && (
              <OpenPoChoice po={openFor(s.id)} supplier={s} asking={request} value={existing[s.id]}
                onChange={v => setExisting(x => ({ ...x, [s.id]: v }))} />
            )}
            {!request && wanted && wanted !== opts[s.id].delivery_date && <p className="text-xs text-blue-800">Asked for {fmtDate(wanted)}</p>}
            {!request && <p className="text-xs text-muted-foreground">{sendHint(s)}</p>}
            <Field label="Note for the supplier (optional)">
              <textarea className={cn(inputCls, 'min-h-[48px]')} rows={2} value={opts[s.id].notes} data-testid="review-note"
                onChange={e => set(s.id, 'notes', e.target.value)} placeholder="e.g. Ring the bell at the back door" />
            </Field>
            {s.driver_instructions && opts[s.id].notes !== s.driver_instructions && (
              <button type="button" className="text-xs underline text-muted-foreground min-h-[44px] touch-manipulation" data-testid="review-note-reset"
                onClick={() => set(s.id, 'notes', s.driver_instructions)}>
                Use the driver instructions again
              </button>
            )}
          </div>
        )
      })}
      {request && (
        <Field label="Note for the manager (optional)">
          <textarea className={cn(inputCls, 'min-h-[72px]')} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Busy weekend coming" />
        </Field>
      )}
      <ErrorNote error={send.error} />
    </Modal>
  )
}

/**
 * Splitting a request waiting for approval: how much of each line moves to
 * a second request, and that request's delivery day per supplier.
 */
function SplitRequestModal({ order, groups, onClose, onSplit }) {
  const api = useApi()
  const asked = order.supplier_options || {}
  const firstDay = s => asked[s.id]?.delivery_date || s.next_delivery
  const [move, setMove] = useState({})
  const [days, setDays] = useState(() => Object.fromEntries(groups.map(g => {
    const first = firstDay(g.supplier)
    return [g.supplier.id, deliveryDateChoices(g.supplier, 8).find(d => d > first) || addDays(first, 1)]
  })))
  const [agreed, setAgreed] = useState({})
  const now = nowAt(order.timezone)
  const moved = l => Number(move[l.it.item_id]) || 0
  const moving = groups.filter(g => g.lines.some(l => moved(l) > 0))
  const everything = groups.every(g => g.lines.every(l => moved(l) >= l.raw))
  const sameDay = moving.filter(g => days[g.supplier.id] === firstDay(g.supplier))
  // Both parts of a line must stay orderable: a minimum of 20 doesn't split 10 + 10.
  const splitIssue = l => splitProblem(l.raw, moved(l), l.q)
  const badSplit = groups.some(g => g.lines.some(splitIssue))
  const badDay = moving.some(g => dayBlocked(g.supplier, days[g.supplier.id], now, agreed[g.supplier.id]))
  const split = useMutation({
    mutationFn: () => api.post(`/purchasing/orders/${order.id}/split`, {
      lines: groups.flatMap(g => g.lines.filter(l => moved(l) > 0).map(l => ({ item_id: l.it.item_id, qty: moved(l) }))),
      suppliers: Object.fromEntries(moving.map(g => [g.supplier.id, {
        delivery_date: days[g.supplier.id],
        ...(agreed[g.supplier.id] && deliveryDayProblem(g.supplier, days[g.supplier.id], now) ? { agreed: true } : {}),
      }])),
    }),
    onSuccess: res => onSplit(res, [...new Set(moving.map(g => days[g.supplier.id]))].sort()),
  })
  return (
    <Modal title="Split for another day" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={split.isPending || !moving.length || everything || sameDay.length > 0 || badSplit || badDay}
          onClick={() => split.mutate()} data-testid="split-order-go">
          {split.isPending && <Loader2 className="w-4 h-4 animate-spin" />}<Scissors className="w-4 h-4" />Split into two orders
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Back</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        Pick what moves to a second order for another day. Both wait for approval and are placed one by one.
      </p>
      {groups.map(g => {
        const s = g.supplier
        const first = firstDay(s)
        const isMoving = moving.includes(g)
        return (
          <div key={s.id} className="rounded-xl border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold flex-1">{s.name}</span>
              <span className="text-xs text-muted-foreground">This order: {fmtDate(first)}</span>
            </div>
            {g.lines.map(l => (
              <div key={l.it.item_id} className="flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-[140px] text-sm">
                  {l.it.name} <CodeTag code={l.q.supplier_code} /> <span className="text-muted-foreground">({fmtNum(l.raw)} {(l.q.pack_name || 'pack').toLowerCase()})</span>
                  {splitIssue(l) && <span className="block text-xs text-red-700" data-testid="split-qty-problem">{splitIssue(l)}</span>}
                </span>
                <span className="text-xs text-muted-foreground">Move</span>
                <QtyStepper value={moved(l)} step={l.q.order_multiple || 1} max={l.raw} label={l.it.name}
                  onChange={v => setMove(m => ({ ...m, [l.it.item_id]: Math.min(v, l.raw) }))} />
                <button type="button" className={btn.ghost} onClick={() => setMove(m => ({ ...m, [l.it.item_id]: moved(l) >= l.raw ? 0 : l.raw }))}>
                  {moved(l) >= l.raw ? 'None' : 'All'}
                </button>
              </div>
            ))}
            {isMoving && (
              <div className="border-t pt-2 space-y-1">
                <p className="text-sm font-medium">Second order from {s.name}</p>
                <DeliveryDayPicker value={days[s.id]} min={order.today} choices={deliveryDateChoices(s, 8)} exclude={first}
                  onChange={d => { setDays(x => ({ ...x, [s.id]: d })); setAgreed(a => ({ ...a, [s.id]: false })) }} label={`Second delivery date for ${s.name}`} />
                {days[s.id] === first
                  ? <p className="text-xs text-amber-800">Pick another day than this order's.</p>
                  : <DayCheck supplier={s} date={days[s.id]} now={now} agreed={agreed[s.id]} onAgree={v => setAgreed(a => ({ ...a, [s.id]: v }))} />}
              </div>
            )}
          </div>
        )
      })}
      {everything && <p className="text-sm text-amber-800">That moves the whole order: change the delivery days when you place it instead.</p>}
      <ErrorNote error={split.error} />
    </Modal>
  )
}

function SendBackModal({ order, onClose, onDone }) {
  const api = useApi()
  const [note, setNote] = useState('')
  const send = useMutation({ mutationFn: () => api.post(`/purchasing/orders/${order.id}/return`, { note }), onSuccess: onDone })
  return (
    <Modal title="Send back" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={send.isPending || !note.trim()} onClick={() => send.mutate()}>
          {send.isPending && <Loader2 className="w-4 h-4 animate-spin" />}<Undo2 className="w-4 h-4" />Send back
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        It goes back to {order.requested_by || 'the person who asked'} as a draft to change and send again. Nothing reaches the suppliers.
      </p>
      <Field label="Why it's going back">
        <textarea className={cn(inputCls, 'min-h-[88px]')} value={note} onChange={e => setNote(e.target.value)}
          placeholder="e.g. We still have oil: take it off" autoFocus={!IS_TOUCH} />
      </Field>
      <ErrorNote error={send.error} />
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
  // Lines added to an order already open for the same day (migration 233)
  // are on that purchase order, not a new one.
  const addedTo = new Set(result.added_to || [])
  const fresh = result.purchase_orders.filter(p => !addedTo.has(p.id)).length
  const words = [
    fresh && `${fresh} new purchase order${fresh === 1 ? '' : 's'}`,
    addedTo.size && `added to ${addedTo.size} already open`,
  ].filter(Boolean).join(', ')
  return (
    <div className={cn('space-y-4', phone ? 'p-3' : 'p-4 max-w-3xl mx-auto')}>
      <div className="rounded-xl border bg-background p-5 text-center space-y-1">
        <PackageCheck className="w-8 h-8 mx-auto text-green-600" />
        <p className="font-semibold">Order placed</p>
        <p className="text-sm text-muted-foreground" data-testid="placed-summary">{words.charAt(0).toUpperCase() + words.slice(1)}</p>
      </div>
      {result.purchase_orders.map(p => {
        const r = result.results.find(x => x.id === p.id) || {}
        return (
          <div key={p.id} className="space-y-1">
            <PoCard po={p} prices={prices} onOpen={() => onOpenPo(p.id)} />
            {addedTo.has(p.id) && (
              <p className="text-xs text-blue-900 px-1" data-testid="placed-added">
                Added to {poNumberLabel(p.number)}, already open for {fmtDate(p.delivery_date)}.
              </p>
            )}
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

/**
 * A purchase order running late at the venue's time: one still in To send
 * once the supplier's cutoff for its day has passed ('send'), or one sent
 * whose delivery day has gone without being booked in ('book_in'). Null
 * otherwise. The same rules as Today's purchasing tasks.
 */
function poLateness(po, now = nowAt(po.venue_timezone || po.timezone)) {
  if (po.status === 'to_send' && deadlinePassed(po, po.delivery_date, now)) return 'send'
  if (po.status === 'sent' && po.delivery_date < now.date) return 'book_in'
  return null
}

function PoCard({ po, prices, onOpen }) {
  const late = poLateness(po)
  return (
    <button type="button" onClick={onOpen} data-testid="po-card" data-late={late || undefined}
      className="w-full text-left rounded-xl border bg-background p-3 hover:shadow-sm touch-manipulation flex items-center gap-3 min-h-[64px]">
      <span className="flex-1 min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold truncate">{po.supplier_name}</span>
          <PoStatusBadge status={po.status} />
          {late === 'send' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-900">Past their cutoff</span>}
          {late === 'book_in' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-900">Not booked in</span>}
          {po.amended_at && po.status === 'to_send' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-900">Changed</span>}
          {po.split_from && <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted">Split</span>}
          {po.send_error && po.status === 'to_send' && <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />}
        </span>
        <span className="block text-sm text-muted-foreground">
          {poNumberLabel(po.number)} · {fmtDate(po.delivery_date)} · {po.line_count} line{po.line_count === 1 ? '' : 's'}
          {prices && po.total != null && <> · {money(po.total)}</>}
        </span>
        {po.supplier_ref && <span className="block text-xs text-muted-foreground truncate" data-testid="po-card-ref">Their ref {po.supplier_ref}</span>}
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </button>
  )
}

function Deliveries({ venueId, meta, onOpen }) {
  const api = useApi()
  const [showDone, setShowDone] = useState(false)
  // Find an order by the supplier's reference or our PO number, whatever
  // its state.
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const { data: pos = [], isLoading, error } = useQuery({
    queryKey: ['purchase-orders', venueId, showDone],
    queryFn: () => api.get(`/purchasing/pos?venue_id=${venueId}&status=${showDone ? 'received,cancelled' : 'to_send,sent'}&limit=200`),
    enabled: !q,
  })
  const found = useQuery({
    queryKey: ['purchase-orders', venueId, 'search', q],
    queryFn: () => api.get(`/purchasing/pos?venue_id=${venueId}&q=${encodeURIComponent(q)}&limit=50`),
    enabled: !!q,
  })
  // The venue's own day, not the browser's (a late night order).
  const now = nowAt(pos[0]?.venue_timezone)
  const today = now.date
  const prices = !!meta?.show_prices
  const toSend = pos.filter(p => p.status === 'to_send')
  const sent = pos.filter(p => p.status === 'sent').sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
  const due = sent.filter(p => p.delivery_date <= today)
  const later = sent.filter(p => p.delivery_date > today)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!q && (
          <Segmented value={showDone ? 'done' : 'open'} onChange={v => setShowDone(v === 'done')}
            options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Received & cancelled' }]} />
        )}
        <label className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputCls, 'pl-9 pr-10')} value={search} onChange={e => setSearch(e.target.value)} data-testid="po-search"
            placeholder="Their reference, PO number or a product code" aria-label="Find an order by their reference, PO number or a product code" />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear the search"
              className="absolute right-0 top-0 w-11 h-11 flex items-center justify-center text-muted-foreground touch-manipulation">
              <X className="w-4 h-4" />
            </button>
          )}
        </label>
      </div>
      <ErrorNote error={q ? found.error : error} />
      {q ? (
        found.isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto my-10 text-muted-foreground" />
          : <Section title="Found" pos={found.data || []} prices={prices} onOpen={onOpen} empty={`No order with "${q}" as their reference or our PO number.`} />
      ) : isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto my-10 text-muted-foreground" /> : showDone ? (
        <Section title="Received and cancelled" pos={[...pos].sort((a, b) => b.delivery_date.localeCompare(a.delivery_date))} prices={prices} onOpen={onOpen} empty="Nothing yet." />
      ) : (
        <>
          {!pos.length && <p className="text-sm text-muted-foreground text-center py-8">No open orders. Place one from the Order tab.</p>}
          {toSend.length > 0 && <Section title="To send" hint="Placed but not with the supplier yet" pos={toSend} prices={prices} onOpen={onOpen} />}
          {due.length > 0 && <Section title="Due today or overdue" hint="Book them in when they arrive. Not booked in after their day: check whether it came" pos={due} prices={prices} onOpen={onOpen} />}
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

function PoDetail({ poId, meta, phone, onBack, onOpenPo }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: po, isLoading, error } = useQuery({ queryKey: ['purchase-order', poId], queryFn: () => api.get(`/purchasing/pos/${poId}`) })
  const [receiving, setReceiving] = useState(false)
  const [markSent, setMarkSent] = useState(false)
  // Changing the order while it waits in To send: quantities per line, and
  // the supplier's products being added ({ item, quote, qty }).
  const [editQty, setEditQty] = useState(null)
  const [added, setAdded] = useState([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(null)
  const [fileErr, setFileErr] = useState(null)
  const [splitting, setSplitting] = useState(false)
  const [splitDone, setSplitDone] = useState(null)
  const [priceList, setPriceList] = useState(false)
  // A new delivery day the supplier can't make waits here for "Agreed with
  // them" (or is dropped): { date, problem }.
  const [dateAsk, setDateAsk] = useState(null)
  const [checkout, setCheckout] = useState(false)
  const [quick, setQuick] = useState(false)
  // The supplier's order reference being typed (null = not editing).
  const [refEdit, setRefEdit] = useState(null)
  const done = saved => {
    qc.setQueryData(['purchase-order', poId], saved)
    qc.invalidateQueries({ queryKey: ['purchase-orders'] })
  }
  const send = useMutation({ mutationFn: () => api.post(`/purchasing/pos/${poId}/send`), onSuccess: done, onError: () => qc.invalidateQueries({ queryKey: ['purchase-order', poId] }) })
  const cancel = useMutation({ mutationFn: () => api.post(`/purchasing/pos/${poId}/cancel`), onSuccess: done })
  const patch = useMutation({ mutationFn: body => api.patch(`/purchasing/pos/${poId}`, body), onSuccess: saved => { done(saved); setDateAsk(null) } })
  const saveRef = useMutation({
    mutationFn: ref => api.patch(`/purchasing/pos/${poId}`, { supplier_ref: ref }),
    onSuccess: saved => { done(saved); setRefEdit(null) },
  })
  const changeDate = d => {
    if (!d || d === po.delivery_date) return
    const problem = deliveryDayProblem(po, d, nowAt(po.timezone), po.supplier_name)
    if (problem) setDateAsk({ date: d, problem })
    else patch.mutate({ delivery_date: d })
  }
  const saveQty = useMutation({
    mutationFn: () => api.put(`/purchasing/pos/${poId}/lines`, {
      lines: Object.entries(editQty).map(([id, qty]) => ({ id, qty })),
      add: added.filter(x => x.qty > 0).map(x => ({ quote_id: x.quote.id, qty: x.qty })),
    }),
    onSuccess: saved => { done(saved); setEditQty(null); setAdded([]) },
  })
  const startEdit = pick => {
    setEditQty(Object.fromEntries(po.lines.map(l => [l.id, l.qty])))
    setAdded([])
    setPicking(pick)
  }
  const cancelEdit = () => { setEditQty(null); setAdded([]); saveQty.reset() }
  const toggleAdded = (item, quote) => setAdded(a => (a.some(x => x.quote.id === quote.id)
    ? a.filter(x => x.quote.id !== quote.id)
    : [...a, { item, quote, qty: fitQty(1, quote) }]))
  const setAddedQty = (quoteId, qty) => setAdded(a => a.map(x => (x.quote.id === quoteId ? { ...x, qty } : x)))

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
  // What arrived but wasn't ordered, at the invoice's prices: shown under
  // the order's own totals, which stay as ordered.
  const notOrdered = prices ? notOrderedTotals(po.lines) : null
  // Sending, booking in and moving the day: anyone who orders or approves.
  // Changing what is ordered (quantities, split, cancel): approvers only.
  const canOrder = !!meta?.can_order || !!meta?.can_approve
  const canApprove = !!meta?.can_approve
  const open = ['to_send', 'sent'].includes(po.status)
  const editing = editQty != null
  // While changing the order, the totals it will come to.
  const editedQty = l => (editQty[l.id] == null || editQty[l.id] === l.qty ? l.qty : fitQty(editQty[l.id], l))
  const draft = editing && prices && po.total != null ? orderTotals([
    ...po.lines.filter(l => !l.added_on_receipt).map(l => ({ price: l.price, vat_rate: l.vat_rate, qty: editedQty(l) })),
    ...added.map(x => ({ price: x.quote.price, vat_rate: x.quote.vat_rate, qty: fitQty(x.qty, x.quote) })),
  ], po.delivery_charge) : null
  const shown = draft || po

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
            ? <DateButton value={po.delivery_date} min={po.today} onChange={changeDate} label="Delivery date" />
            : <span className="font-medium">{fmtDateLong(po.delivery_date)}</span>}
        </div>
        {dateAsk && (
          <div className={cn('rounded-lg border px-3 py-2 text-sm space-y-2',
            dateAsk.problem.code === 'past' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900')}
            data-testid="po-date-problem" data-problem={dateAsk.problem.code}>
            <p className="flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{dateAsk.problem.message}.</p>
            <div className="flex flex-wrap gap-2">
              {dateAsk.problem.code !== 'past' && (
                <button type="button" className={btn.primary} disabled={patch.isPending} data-testid="po-date-agreed"
                  onClick={() => patch.mutate({ delivery_date: dateAsk.date, agreed: true })}>
                  {patch.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Agreed with {po.supplier_name}: move it to {fmtDate(dateAsk.date)}
                </button>
              )}
              <button type="button" className={btn.outline} onClick={() => setDateAsk(null)}>Keep {fmtDate(po.delivery_date)}</button>
            </div>
          </div>
        )}
        <PoDeliveryDetails po={po} />
        <SupplierRefRow po={po} canEdit={canOrder && po.status !== 'cancelled'} editing={refEdit} onEdit={setRefEdit}
          onSave={() => saveRef.mutate(refEdit.trim())} saving={saveRef.isPending} error={saveRef.error} />
        <p className="text-sm text-muted-foreground">
          {po.requested_by && <>Asked for by {po.requested_by}<br /></>}
          Placed {new Date(po.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{po.created_by ? ` by ${po.created_by}` : ''}
          {po.sent_at && <><br />Sent {new Date(po.sent_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} ({SENT_VIA.find(v => v.key === po.sent_via)?.label.toLowerCase() || po.sent_via}{po.sent_to ? ` to ${po.sent_to}` : ''})</>}
          {po.received_at && <><br />Received {new Date(po.received_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{po.received_by ? ` by ${po.received_by}` : ''}</>}
        </p>
        {po.supplier_phone && <p className="text-sm">Phone <a className="underline" href={`tel:${po.supplier_phone}`}>{po.supplier_phone}</a></p>}
        {po.notes && <p className="text-sm rounded-lg bg-muted/50 px-3 py-2">Note to supplier: {po.notes}</p>}
        {po.send_error && po.status === 'to_send' && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Email failed: {po.send_error}</p>
        )}
        {po.amended_at && po.status === 'to_send' && (
          <p className="text-sm text-orange-900 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            Changed on {when(po.amended_at)}{po.amended_by ? ` by ${po.amended_by}` : ''} after it was sent. Send it again so {po.supplier_name} has the new quantities.
          </p>
        )}
        {(po.split_from_po || po.split_into?.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {po.split_from_po && (
              <button type="button" className="underline touch-manipulation min-h-[44px]" onClick={() => onOpenPo(po.split_from_po.id)}>
                Split off {poNumberLabel(po.split_from_po.number)} ({fmtDate(po.split_from_po.delivery_date)})
              </button>
            )}
            {po.split_into?.map(x => (
              <button key={x.id} type="button" className="underline touch-manipulation min-h-[44px]" onClick={() => onOpenPo(x.id)}>
                Part moved to {poNumberLabel(x.number)} ({fmtDate(x.delivery_date)})
              </button>
            ))}
          </div>
        )}
      </div>
      {splitDone && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[200px]">Split: part moved to {poNumberLabel(splitDone.new_po.number)} for {fmtDate(splitDone.new_po.delivery_date)}.</span>
            <button type="button" className={btn.outline} onClick={() => onOpenPo(splitDone.new_po.id)}>Open it</button>
          </p>
          {splitDone.results.map(r => (
            <p key={r.id} className={cn('text-xs', r.error ? 'text-red-700' : 'text-muted-foreground')}>
              {r.id === splitDone.new_po.id ? poNumberLabel(splitDone.new_po.number) : poNumberLabel(po.number)}:{' '}
              {r.emailed ? 'emailed to the supplier' : r.error ? `not emailed (${r.error}): send it again` : 'waiting in To send: send it again'}
            </p>
          ))}
          {!splitDone.was_sent && <p className="text-xs text-muted-foreground">Both wait in To send.</p>}
        </div>
      )}

      {canOrder && open && !editing && (
        <div className="flex flex-wrap gap-2">
          {po.status === 'sent' && <button type="button" className={btn.primary} onClick={() => setReceiving(true)}><PackageCheck className="w-4 h-4" />Book in delivery</button>}
          {po.status === 'to_send' && po.supplier_email && (
            <button type="button" className={btn.primary} disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}Email to {po.supplier_email}
            </button>
          )}
          {po.status === 'to_send' && <button type="button" className={po.supplier_email ? btn.outline : btn.primary} onClick={() => setMarkSent(true)}><Send className="w-4 h-4" />Mark as sent</button>}
          {po.status === 'to_send' && canApprove && (
            <>
              <button type="button" className={btn.outline} onClick={() => startEdit(false)}>Change quantities</button>
              <button type="button" className={btn.outline} onClick={() => startEdit(true)} data-testid="po-add-items">
                <Plus className="w-4 h-4" />Add items
              </button>
            </>
          )}
          {canApprove && (
            <button type="button" className={btn.outline} onClick={() => setSplitting(true)}><Scissors className="w-4 h-4" />Split for another day</button>
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
        <button type="button" className={btn.outline} onClick={() => setCheckout(true)} data-testid="po-checkout"><Copy className="w-4 h-4" />Copy for checkout</button>
        <button type="button" className={btn.outline} onClick={() => setQuick(true)} data-testid="po-quick-order"><Copy className="w-4 h-4" />Codes for quick order</button>
        {busy && <Loader2 className="w-4 h-4 animate-spin self-center" />}
      </div>
      <ErrorNote error={send.error || cancel.error || patch.error || fileErr || saveQty.error} />

      <section className="rounded-xl border bg-background overflow-hidden">
        <div className="section-head px-4 py-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold flex-1">Lines</h3>
          {editing && (
            <>
              <button type="button" className={btn.outline} onClick={() => setPicking(true)} data-testid="po-add-more"><Plus className="w-4 h-4" />Add items</button>
              <button type="button" className={btn.primary} disabled={saveQty.isPending} onClick={() => saveQty.mutate()} data-testid="po-lines-save">
                {saveQty.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
              </button>
              <button type="button" className={btn.ghost} onClick={cancelEdit}>Cancel</button>
            </>
          )}
        </div>
        {editing && (
          <p className="px-4 pt-2 text-xs text-muted-foreground">
            Set a line to 0 to take it off. Add items brings in other products from {po.supplier_name}.
          </p>
        )}
        <div className="divide-y">
          {po.lines.map(l => (
            <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5" data-testid="po-line">
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm font-medium">{l.item_name} <StorageBadge storage={l.storage} />{l.added_on_receipt && <NotOrderedBadge />}</p>
                {l.product_name && <p className="text-xs">{l.product_name}</p>}
                <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5"><CodeTag code={l.supplier_code} />{l.pack_label}</p>
                {l.invoice_name && (l.invoice_name !== l.product_name || (prices && l.invoice_price != null && Math.abs(l.invoice_price - l.price) >= 0.005)) && (
                  <p className="text-xs text-blue-900">
                    Invoiced as {l.invoice_name}{prices && l.invoice_price != null ? ` at ${money(l.invoice_price)}` : ''}
                  </p>
                )}
                {l.receive_status && l.receive_status !== 'ok' && !l.added_on_receipt && (
                  <p className="text-xs text-amber-800">
                    {RECEIVE_STATUSES.find(s => s.key === l.receive_status)?.label}: received {fmtNum(l.received_qty ?? 0)}{l.receive_note ? ` (${l.receive_note})` : ''}
                  </p>
                )}
                {editing && !((editQty[l.id] ?? l.qty) > 0) && <p className="text-xs text-red-700">Comes off the order when you save</p>}
                {editing && (editQty[l.id] ?? l.qty) !== l.qty && qtyProblem(editQty[l.id], l) && (
                  <p className="text-xs text-amber-700" data-testid="po-line-qty-problem">
                    {qtyProblem(editQty[l.id], l)}: will order {fmtNum(fitQty(editQty[l.id], l))}
                  </p>
                )}
              </div>
              {editing ? (
                <QtyStepper value={editQty[l.id] ?? l.qty} onChange={v => setEditQty(e => ({ ...e, [l.id]: v }))} label={l.item_name}
                  step={l.order_multiple || 1} min={l.min_qty || 0} />
              ) : (
                <span className="text-sm tabular-nums font-medium">× {fmtNum(l.added_on_receipt ? l.received_qty ?? 0 : l.qty)}</span>
              )}
              {prices && l.price != null && (
                <span className={cn('w-24 text-right text-sm tabular-nums', l.added_on_receipt && 'text-blue-900')}>
                  {money(lineAmounts(l.added_on_receipt ? addedAsLine(l) : editing ? { ...l, qty: editedQty(l) } : l).net)}
                </span>
              )}
              {editing && added.length > 0 && <span className="hidden sm:block w-11 shrink-0" aria-hidden="true" />}
            </div>
          ))}
          {editing && added.map(x => {
            const problem = qtyProblem(x.qty, x.quote)
            return (
              <div key={x.quote.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 bg-green-50/70" data-testid="po-new-line">
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium">{x.item.name} <StorageBadge storage={x.item.storage} /><NewLineBadge /></p>
                  {x.quote.product_name && <p className="text-xs">{x.quote.product_name}</p>}
                  <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5"><CodeTag code={x.quote.supplier_code} />{x.quote.pack_label}</p>
                  {problem && <p className="text-xs text-amber-700">{problem}: will order {fmtNum(fitQty(x.qty, x.quote))}</p>}
                </div>
                <QtyStepper value={x.qty} step={x.quote.order_multiple || 1} min={x.quote.min_qty || 0} onChange={v => setAddedQty(x.quote.id, v)} label={x.item.name} />
                {prices && x.quote.price != null && (
                  <span className="w-24 text-right text-sm tabular-nums">
                    {money(lineAmounts({ price: x.quote.price, vat_rate: x.quote.vat_rate, qty: fitQty(x.qty, x.quote) }).net)}
                  </span>
                )}
                <button type="button" onClick={() => toggleAdded(x.item, x.quote)} aria-label={`Don't add ${x.item.name}`}
                  className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted touch-manipulation">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
        {prices && po.total != null && (
          <div className="border-t px-4 py-2 text-sm space-y-0.5 text-right tabular-nums" data-testid="po-totals">
            <p>Subtotal {money(shown.subtotal)}</p>
            <p>VAT {money(shown.vat)}</p>
            {po.delivery_charge > 0 && <p>Delivery {money(po.delivery_charge)}</p>}
            <p className="font-semibold">{notOrdered ? 'Order total' : 'Total'} {money(shown.total)}</p>
            {draft && Math.abs(draft.total - po.total) >= 0.005 && (
              <p className="text-xs text-muted-foreground" data-testid="po-total-before">Before these changes {money(po.total)}</p>
            )}
            {notOrdered && (
              <p className="text-blue-900 pt-1" data-testid="po-not-ordered-total">
                Not ordered, arrived {money(notOrdered.net)} + VAT {money(notOrdered.vat)}
              </p>
            )}
          </div>
        )}
      </section>

      {po.delivery_check && <CheckSummary check={po.delivery_check} />}
      <InvoiceList invoices={po.invoices} prices={prices} />
      {meta?.can_setup && po.status === 'received' && po.price_list?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-2 text-sm" data-testid="po-price-list">
          <span className="flex-1 min-w-[200px]">
            The invoice differs from the price list on {po.price_list.length} line{po.price_list.length === 1 ? '' : 's'}.
          </span>
          <button type="button" className={btn.outline} onClick={() => setPriceList(true)}>Update the price list</button>
        </div>
      )}

      {canOrder && po.status === 'received' && (
        <button type="button" className={btn.outline} onClick={() => setReceiving(true)}>Correct the delivery</button>
      )}
      {canApprove && open && (
        <div className="flex items-center justify-end gap-2 pt-2">
          <span className="text-xs text-muted-foreground">Cancel this order</span>
          <ConfirmDelete label="Cancel order" confirmLabel="Yes, cancel it" onConfirm={() => cancel.mutate()} />
        </div>
      )}

      {markSent && (
        <MarkSentModal po={po} onClose={() => setMarkSent(false)} onSaved={saved => { done(saved); setMarkSent(false) }} />
      )}
      {checkout && <CheckoutCopyModal po={po} onClose={() => setCheckout(false)} />}
      {quick && (
        <QuickOrderModal onClose={() => setQuick(false)}
          groups={[{
            key: po.id, name: po.supplier_name,
            lines: po.lines.filter(l => !l.added_on_receipt).map(l => ({ code: l.supplier_code, name: l.product_name || l.item_name, qty: l.qty })),
          }]}
          onCsv={() => api.download(`/purchasing/pos/${poId}/file?format=csv`, `${poNumberLabel(po.number)}-${po.supplier_name.replace(/[^\w-]+/g, '-')}.csv`)} />
      )}
      {receiving && <ReceiveForm po={po} meta={meta} onClose={() => setReceiving(false)} onSaved={saved => {
        done(saved); setReceiving(false); qc.invalidateQueries({ queryKey: ['fs-deliveries'] })
        if (meta?.can_setup && saved.price_list?.length) setPriceList(true)
      }} />}
      {priceList && <PriceListModal po={po} onClose={() => setPriceList(false)} onSaved={saved => {
        done(saved); setPriceList(false); qc.invalidateQueries({ queryKey: ['inv-items'] }); qc.invalidateQueries({ queryKey: ['inv-item'] })
      }} />}
      {splitting && (
        <SplitPoModal po={po} onClose={() => setSplitting(false)}
          onSplit={res => { setSplitting(false); done(res.po); setSplitDone(res) }} />
      )}
      {picking && editing && (
        <AddPoItemsModal po={po} added={added} onToggle={toggleAdded} onClose={() => setPicking(false)} />
      )}
    </div>
  )
}

/**
 * The supplier's products to add to a purchase order waiting in To send:
 * one row per product (an item can come in more than one pack). Tapping
 * adds it to the order being changed, tapping again takes it out; products
 * already on the order are shown but can't be added again (change their
 * quantity on the order).
 */
function AddPoItemsModal({ po, added, onToggle, onClose }) {
  const api = useApi()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t) }, [search])
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['purchasing-catalog', po.venue_id, po.supplier_id, debounced],
    queryFn: () => api.get(`/purchasing/venues/${po.venue_id}/catalog?supplier_id=${po.supplier_id}&search=${encodeURIComponent(debounced)}`),
  })
  const prices = !!po.show_prices
  const onOrder = new Set(po.lines.filter(l => !l.added_on_receipt).map(l => l.quote_id))
  const picked = new Set(added.map(x => x.quote.id))
  const rows = data.flatMap(i => i.quotes.filter(q => q.supplier_id === po.supplier_id).map(q => ({ item: i, quote: q })))
  return (
    <Modal title={`Add from ${po.supplier_name}`} onClose={onClose}
      footer={<button type="button" className={btn.primary} onClick={onClose} data-testid="po-add-done">
        <Check className="w-4 h-4" />Done{added.length ? ` (${added.length} to add)` : ''}
      </button>}>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input className={cn(inputCls, 'pl-9')} value={search} onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${po.supplier_name}'s products`} aria-label="Search products" autoFocus={!IS_TOUCH} />
      </div>
      <p className="text-xs text-muted-foreground">Tap a product to add it, then set how many on the order.</p>
      <ErrorNote error={error} />
      {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
      <div className="rounded-xl border divide-y">
        {rows.map(({ item, quote }) => {
          const already = onOrder.has(quote.id)
          const on = picked.has(quote.id)
          return (
            <button key={quote.id} type="button" disabled={already} aria-pressed={on} onClick={() => onToggle(item, quote)}
              data-testid="po-product"
              className={cn('w-full text-left px-3 py-2 min-h-[56px] flex items-center gap-3 touch-manipulation disabled:opacity-60',
                on ? 'bg-primary/5' : !already && 'hover:bg-muted/40')}>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">{item.name} <StorageBadge storage={item.storage} /></span>
                {quote.product_name && <span className="block text-xs">{quote.product_name}</span>}
                <span className="block text-xs text-muted-foreground">
                  <CodeTag code={quote.supplier_code} className="mr-1.5" />
                  {[quote.pack_label, prices && quote.price != null && money(quote.price)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {already
                ? <span className="text-xs text-muted-foreground shrink-0">On the order</span>
                : on
                  ? <span className="text-xs font-medium text-primary shrink-0 inline-flex items-center gap-1"><Check className="w-4 h-4" />Added</span>
                  : <Plus className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>
          )
        })}
        {!isFetching && !rows.length && (
          <p className="p-3 text-sm text-muted-foreground">
            {debounced ? 'Nothing found.' : `${po.supplier_name} has no products with a price yet. Add them on the Inventory page.`}
          </p>
        )}
      </div>
      {data.length >= 40 && <p className="text-xs text-muted-foreground">Showing the first 40. Search to find more.</p>}
    </Modal>
  )
}

/** Splitting a purchase order: how much of each line moves, and to which day. */
function SplitPoModal({ po, onClose, onSplit }) {
  const api = useApi()
  const [move, setMove] = useState({})
  const [day, setDay] = useState(() => po.delivery_choices.find(d => d > po.delivery_date) || addDays(po.delivery_date, 1))
  const [agreed, setAgreed] = useState(false)
  const now = nowAt(po.timezone)
  const moved = l => Number(move[l.id]) || 0
  const any = po.lines.some(l => moved(l) > 0)
  const everything = po.lines.every(l => moved(l) >= l.qty)
  const sameDay = day === po.delivery_date
  // Both parts of a line must stay orderable (the supplier's minimum and steps).
  const splitIssue = l => splitProblem(l.qty, moved(l), l)
  const badSplit = po.lines.some(splitIssue)
  const settings = { ...po, name: po.supplier_name }
  const badDay = dayBlocked(settings, day, now, agreed)
  const split = useMutation({
    mutationFn: () => api.post(`/purchasing/pos/${po.id}/split`, {
      lines: po.lines.filter(l => moved(l) > 0).map(l => ({ id: l.id, qty: moved(l) })),
      delivery_date: day,
      ...(agreed && deliveryDayProblem(po, day, now) ? { agreed: true } : {}),
    }),
    onSuccess: onSplit,
  })
  const sent = po.status === 'sent'
  const how = sent
    ? (po.send_method === 'email' && po.supplier_email
      ? `${po.supplier_name} already has this order. Both are emailed to ${po.supplier_email} straight away, this one marked as amended.`
      : `${po.supplier_name} already has this order. Both go back to To send: send them again, this one as amended.`)
    : 'Both wait in To send.'
  return (
    <Modal title={`Split ${poNumberLabel(po.number)}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={split.isPending || !any || everything || sameDay || badSplit || badDay}
          onClick={() => split.mutate()} data-testid="split-po-go">
          {split.isPending && <Loader2 className="w-4 h-4 animate-spin" />}<Scissors className="w-4 h-4" />Split into two orders
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Back</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        Pick what moves to a second order from {po.supplier_name} for another day. It keeps this order's prices{po.delivery_charge > 0 ? ' and delivery charge' : ''}.
      </p>
      <div className="rounded-xl border divide-y">
        {po.lines.map(l => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="flex-1 min-w-[140px] text-sm">
              {l.item_name} <CodeTag code={l.supplier_code} /> <span className="text-muted-foreground">({fmtNum(l.qty)} × {l.pack_label})</span>
              {splitIssue(l) && <span className="block text-xs text-red-700" data-testid="split-qty-problem">{splitIssue(l)}</span>}
            </span>
            <span className="text-xs text-muted-foreground">Move</span>
            <QtyStepper value={moved(l)} label={l.item_name} step={l.order_multiple || 1} max={l.qty}
              onChange={v => setMove(m => ({ ...m, [l.id]: Math.min(v, l.qty) }))} />
            <button type="button" className={btn.ghost} onClick={() => setMove(m => ({ ...m, [l.id]: moved(l) >= l.qty ? 0 : l.qty }))}>
              {moved(l) >= l.qty ? 'None' : 'All'}
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Second order's delivery <span className="font-normal text-muted-foreground">(this one: {fmtDate(po.delivery_date)})</span></p>
        <DeliveryDayPicker value={day} min={po.today} choices={po.delivery_choices || []} exclude={po.delivery_date}
          onChange={d => { setDay(d); setAgreed(false) }} label="Second delivery date" />
        {sameDay
          ? <p className="text-xs text-amber-800">Pick another day than this order's.</p>
          : <DayCheck supplier={settings} date={day} now={now} agreed={agreed} onAgree={setAgreed} />}
      </div>
      {everything && <p className="text-sm text-amber-800">That moves the whole order: change its delivery day instead.</p>}
      <p className="text-sm text-muted-foreground">{how}</p>
      <ErrorNote error={split.error} />
    </Modal>
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

/**
 * The venue's delivery details for this supplier (Suppliers page, per
 * venue, migration 233): the slot, the phone the driver rings, and the
 * driver instructions when the order's own note doesn't already carry them.
 */
function PoDeliveryDetails({ po }) {
  const slot = slotText(po)
  const say = po.driver_instructions && po.driver_instructions !== po.notes ? po.driver_instructions : null
  if (!slot && !po.delivery_phone && !say) return null
  return (
    <div className="text-sm space-y-1" data-testid="po-delivery-details">
      {slot && <p className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-muted-foreground shrink-0" />Delivery slot {slot}</p>}
      {po.delivery_phone && (
        <p className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-muted-foreground shrink-0" />
          Driver rings <a className="underline" href={`tel:${po.delivery_phone}`}>{po.delivery_phone}</a>
        </p>
      )}
      {say && <p className="text-muted-foreground">Driver instructions: {say}</p>}
    </div>
  )
}

/**
 * The supplier's own reference for the order (from their confirmation or
 * website), set when it's marked sent or here later; changed with its own
 * Save, any time but once cancelled. Shown once it exists, or once the
 * order has gone (to add it).
 */
function SupplierRefRow({ po, canEdit, editing, onEdit, onSave, saving, error }) {
  if (editing != null) {
    return (
      <div className="space-y-2" data-testid="po-ref-edit">
        <Field label={`${po.supplier_name}'s order reference`}>
          <input className={inputCls} value={editing} maxLength={100} autoFocus={!IS_TOUCH} data-testid="po-ref-input"
            onChange={e => onEdit(e.target.value)} placeholder="e.g. S043172591" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.primary} disabled={saving || editing.trim() === (po.supplier_ref || '')} onClick={onSave} data-testid="po-ref-save">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}Save
          </button>
          <button type="button" className={btn.ghost} onClick={() => onEdit(null)}>Cancel</button>
        </div>
        {po.ref_required && !editing.trim() && po.status !== 'to_send' && (
          <p className="text-xs text-amber-800">{po.supplier_name} orders are kept with their reference: it helps when chasing or checking the invoice.</p>
        )}
        <ErrorNote error={error} />
      </div>
    )
  }
  if (!po.supplier_ref && po.status === 'to_send') return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="po-ref">
      {po.supplier_ref
        ? <span>Their reference <span className="font-medium tabular-nums" data-testid="po-ref-value">{po.supplier_ref}</span></span>
        : <span className="text-muted-foreground">No reference from {po.supplier_name}</span>}
      {canEdit && (
        <button type="button" className={cn(btn.ghost, 'h-11')} onClick={() => onEdit(po.supplier_ref || '')} data-testid="po-ref-change">
          <Pencil className="w-3.5 h-3.5" />{po.supplier_ref ? 'Change' : 'Add it'}
        </button>
      )}
    </div>
  )
}

/** Copy text to the clipboard, falling back to a selected text box. */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* the fallback below */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0' })
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}

/** Save a file made in the browser (the order form's quick order CSV). */
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const QUICK_SEP_KEY = 'maca_quick_order_sep'

/**
 * Codes for quick order: each supplier's codes and quantities (CODE:QTY,
 * quickOrder() in shared/procurement.js) to paste into the quick order box
 * on their website or app, and the same as a CSV file (code, name, qty).
 * groups = [{ key, name, lines: [{ code, name, qty }] }], quantities in the
 * supplier's packs. onCsv(group) downloads the CSV (default: made here with
 * quickOrderCsv()). Lines without a supplier code are listed to add by hand.
 */
function QuickOrderModal({ groups, onCsv, onClose }) {
  const [sep, setSepState] = useState(() => {
    try { return localStorage.getItem(QUICK_SEP_KEY) === 'line' ? 'line' : 'comma' } catch { return 'comma' }
  })
  const setSep = v => { setSepState(v); try { localStorage.setItem(QUICK_SEP_KEY, v) } catch { /* private */ } }
  const [copied, setCopied] = useState(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const built = groups.map(g => ({ ...g, ...quickOrder(g.lines, { sep: sep === 'line' ? '\n' : ',' }) }))
  const copy = async g => {
    const ok = await copyText(g.text)
    setFailed(!ok)
    if (ok) { setCopied(g.key); setTimeout(() => setCopied(c => (c === g.key ? null : c)), 2000) }
  }
  const csv = async g => {
    setBusy(g.key); setErr(null)
    try {
      if (onCsv) await onCsv(g)
      else saveBlob(new Blob([quickOrderCsv(g.lines)], { type: 'text/csv;charset=utf-8' }), `${String(g.name || 'supplier').replace(/[^\w-]+/g, '-')}-quick-order.csv`)
    } catch (e) { setErr(e) } finally { setBusy(null) }
  }
  return (
    <Modal title="Codes for quick order" onClose={onClose}
      footer={<button type="button" className={btn.outline} onClick={onClose}>Done</button>}>
      <p className="text-sm text-muted-foreground">
        For a supplier's quick order box: their product codes with how many packs, ready to paste. The CSV file has the same lines for websites that take a file.
      </p>
      <Field label="Put the codes" group>
        <Segmented value={sep} onChange={setSep}
          options={[{ value: 'comma', label: 'On one line' }, { value: 'line', label: 'One a line' }]} />
      </Field>
      {built.map(g => (
        <section key={g.key} className="rounded-xl border overflow-hidden" data-testid="quick-order-group">
          {groups.length > 1 && <div className="section-head px-3 py-2 text-sm font-semibold">{g.name}</div>}
          <div className="p-3 space-y-2">
            {g.coded.length > 0 ? (
              <textarea readOnly value={g.text} aria-label={`Codes for ${g.name}`} data-testid="quick-order-text"
                rows={sep === 'line' ? Math.min(Math.max(g.coded.length, 2), 8) : 3}
                onFocus={e => e.target.select()}
                className={cn(inputCls, 'h-auto py-2 font-mono text-sm resize-none')} />
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="quick-order-none">
                None of these lines has {g.name}'s product code yet. Add the codes to their prices on the Inventory page.
              </p>
            )}
            {g.coded.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn.primary} onClick={() => copy(g)} data-testid="quick-order-copy">
                  {copied === g.key ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied === g.key ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className={btn.outline} disabled={busy === g.key} onClick={() => csv(g)} data-testid="quick-order-csv">
                  {busy === g.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}CSV file
                </button>
              </div>
            )}
            {g.noCode.length > 0 && (
              <div className="text-sm rounded-lg bg-amber-50 border border-amber-200 px-3 py-2" data-testid="quick-order-no-code">
                <p className="font-medium">No product code, so add {g.noCode.length === 1 ? 'this' : 'these'} by hand:</p>
                <ul className="mt-1 space-y-0.5">
                  {g.noCode.map((l, i) => <li key={i}>{l.name} x {fmtNum(l.qty)}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      ))}
      {failed && <p className="text-sm text-amber-800">This browser didn't let us copy. Tap the codes, select them and copy them by hand.</p>}
      <ErrorNote error={err} />
    </Modal>
  )
}

/**
 * Copy for checkout: the delivery details a supplier's website or app
 * asks for (checkoutText(), shared/procurement.js), all at once or a line
 * at a time for checkouts with separate boxes.
 */
function CheckoutCopyModal({ po, onClose }) {
  const text = checkoutText(po, po.deliver_to)
  const lines = text.split('\n').map(l => {
    const at = l.indexOf(': ')
    return at > 0 ? { label: l.slice(0, at), value: l.slice(at + 2) } : { label: '', value: l }
  })
  const [copied, setCopied] = useState(null)
  const [failed, setFailed] = useState(false)
  const copy = async (what, key) => {
    const ok = await copyText(what)
    setFailed(!ok)
    if (ok) { setCopied(key); setTimeout(() => setCopied(c => (c === key ? null : c)), 2000) }
  }
  return (
    <Modal title="Copy for checkout" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} onClick={() => copy(text, 'all')} data-testid="checkout-copy-all">
          {copied === 'all' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied === 'all' ? 'Copied' : 'Copy all'}
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Done</button>
      </>}>
      <p className="text-sm text-muted-foreground">
        For ordering on {po.supplier_name}'s website or app: paste these into their checkout, all together or one box at a time.
      </p>
      <div className="rounded-xl border divide-y" data-testid="checkout-lines">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5">
            <div className="flex-1 min-w-0">
              {l.label && <p className="text-xs text-muted-foreground">{l.label}</p>}
              <p className="text-sm break-words">{l.value}</p>
            </div>
            <button type="button" onClick={() => copy(l.value, i)} aria-label={`Copy ${l.label || 'this line'}`}
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation">
              {copied === i ? <Check className="w-4 h-4 text-green-700" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
            </button>
          </div>
        ))}
      </div>
      {failed && <p className="text-sm text-amber-800">This browser didn't let us copy. Select the words above and copy them by hand.</p>}
      {!po.deliver_to?.address_line1 && (
        <p className="text-xs text-muted-foreground">No address for {po.venue_name} yet: add it in Website, under the location's Find us, to have it here.</p>
      )}
    </Modal>
  )
}

const SENT_AT_DAYS = 14

/**
 * Mark as sent: how the order reached the supplier, their order reference
 * (needed when the supplier is set to need it, migration 233), and when it
 * went: now, or earlier (up to 14 days back, not before it was made).
 */
function MarkSentModal({ po, onClose, onSaved }) {
  const api = useApi()
  const [via, setVia] = useState(po.send_method === 'excel' ? 'excel' : po.send_method === 'pdf' ? 'pdf' : 'print')
  const [ref, setRef] = useState(po.supplier_ref || '')
  const [earlier, setEarlier] = useState(false)
  const [at, setAt] = useState('')
  const needRef = !!po.ref_required && !ref.trim()
  const atProblem = earlier ? sentAtProblem(at, po.created_at) : null
  const save = useMutation({
    mutationFn: () => api.post(`/purchasing/pos/${po.id}/mark-sent`, {
      via, supplier_ref: ref.trim() || null, ...(earlier ? { sent_at: new Date(at).toISOString() } : {}),
    }),
    onSuccess: onSaved,
  })
  return (
    <Modal title="Mark as sent" onClose={onClose}
      footer={<>
        <button type="button" className={btn.primary} disabled={save.isPending || needRef || !!atProblem} onClick={() => save.mutate()} data-testid="mark-sent-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Mark as sent
        </button>
        <button type="button" className={btn.outline} onClick={onClose}>Cancel</button>
      </>}>
      <p className="text-sm text-muted-foreground">How did the order reach {po.supplier_name}?</p>
      <div className="space-y-2">
        {SENT_VIA.map(v => (
          <button key={v.key} type="button" onClick={() => setVia(v.key)} data-testid="mark-sent-via" data-via={v.key}
            className={cn('w-full text-left rounded-xl border px-3 min-h-[48px] text-sm touch-manipulation flex items-center gap-2', via === v.key ? 'border-primary bg-primary/5' : 'hover:bg-muted/40')}>
            <span className="flex-1">{v.label}</span>{via === v.key && <Check className="w-4 h-4 text-primary" />}
          </button>
        ))}
      </div>
      <Field label={po.ref_required ? `${po.supplier_name}'s order reference (needed)` : `${po.supplier_name}'s order reference (optional)`}>
        <input className={inputCls} value={ref} maxLength={100} onChange={e => setRef(e.target.value)} data-testid="mark-sent-ref"
          placeholder="From their confirmation, e.g. S043172591" />
      </Field>
      {needRef && <p className="text-xs text-amber-800" data-testid="mark-sent-ref-needed">{po.supplier_name} is set to need their reference: type it in from their confirmation.</p>}
      <Field group label="When it went">
        <Segmented value={earlier ? 'earlier' : 'now'} onChange={v => setEarlier(v === 'earlier')}
          options={[{ value: 'now', label: 'Just now' }, { value: 'earlier', label: 'Earlier' }]} />
      </Field>
      {earlier && (
        <div className="space-y-1">
          <input type="datetime-local" className={inputCls} value={at} onChange={e => setAt(e.target.value)} data-testid="mark-sent-at"
            aria-label="When it went" max={localInput(new Date())} min={localInput(new Date(po.created_at))} />
          {atProblem && <p className="text-xs text-amber-800" data-testid="mark-sent-at-problem">{atProblem}</p>}
        </div>
      )}
      <ErrorNote error={save.error} />
    </Modal>
  )
}

/** A Date as a datetime-local value, in the browser's time. */
function localInput(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Why an earlier send time can't be used (the API checks the same), or null. */
function sentAtProblem(value, createdAt) {
  if (!value) return 'Pick when it went'
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return 'Pick when it went'
  if (t > Date.now() + 5 * 60_000) return 'That is in the future'
  if (t < Date.now() - SENT_AT_DAYS * 86_400_000) return `It must be in the last ${SENT_AT_DAYS} days`
  // To the minute, as the API: an order made at 10:00:30 can go at 10:00.
  const made = createdAt ? new Date(createdAt) : null
  if (made) made.setSeconds(0, 0)
  if (made && t < made.getTime()) return 'That is before the order was made'
  return null
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

function ReceiveForm({ po, meta, onClose, onSaved }) {
  const api = useApi()
  const prev = po.delivery_check
  const prices = !!po.show_prices
  const canSetup = !!meta?.can_setup
  const [rows, setRows] = useState(() => Object.fromEntries(po.lines.map(l => [l.id, {
    received_qty: l.received_qty ?? (l.added_on_receipt ? 0 : l.qty), status: l.receive_status || null, note: l.receive_note || '',
  }])))
  const [chk, setChk] = useState(() => ({
    packaging_ok: prev?.packaging_ok ?? true, damage_ok: prev?.damage_ok ?? true, quality_ok: prev?.quality_ok ?? true,
    accepted: prev?.accepted ?? true, corrective_action: prev?.corrective_action || '',
    chilled_temp_c: prev?.items?.find(i => i.temp_c != null && po.lines.find(l => l.item_name === i.name)?.storage === 'chilled')?.temp_c ?? null,
    frozen_temp_c: prev?.items?.find(i => i.temp_c != null && po.lines.find(l => l.item_name === i.name)?.storage === 'frozen')?.temp_c ?? null,
  }))
  const [notes, setNotes] = useState(po.receive_notes || '')
  // The invoice Pepper read (migration 197): what it says per order line,
  // the lines that weren't ordered, the order lines it doesn't mention.
  const [reading, setReading] = useState(null)
  const [lineInv, setLineInv] = useState({})
  const [extras, setExtras] = useState([])
  const [missing, setMissing] = useState([])
  // A line the form hasn't seen (the order reloaded with lines added on
  // receipt while the form closes) reads as what was saved for it.
  const rowOf = l => rows[l.id] || { received_qty: l.received_qty ?? 0, status: l.receive_status || null, note: l.receive_note || '' }
  const setRow = (id, k, v) => setRows(r => ({ ...r, [id]: { ...r[id], [k]: v } }))
  const setC = (k, v) => setChk(c => ({ ...c, [k]: v }))

  function applyReading(res) {
    const f = readingToForm(po, res)
    setReading(res)
    setRows(r => {
      const next = { ...r }
      for (const [id, v] of Object.entries(f.rows)) next[id] = { ...next[id], ...v, note: v.note ?? next[id].note }
      return next
    })
    setLineInv(f.lineInv)
    setExtras(f.extras)
    setMissing(f.missing)
  }
  function unlink(lineId) {
    const inv = lineInv[lineId]
    if (!inv) return
    const lines = reading.invoice.lines
    setLineInv(m => { const n = { ...m }; delete n[lineId]; return n })
    setExtras(xs => [...xs, ...[inv.idx, ...(inv.others || [])].map(i => extraOf(lines[i]))])
    setRows(r => ({ ...r, [lineId]: { ...r[lineId], status: null, note: '' } }))
    setMissing(m => [...m, lineId])
  }
  // An invoice line said to have come instead of an ordered line.
  function cameInstead(lineId, x) {
    setLineInv(m => ({ ...m, [lineId]: { idx: x.idx, price: x.price, description: x.description, code: x.code, pack_text: x.pack_text, qty: x.qty, substitute: true, others: [] } }))
    setRows(r => ({ ...r, [lineId]: { ...r[lineId], received_qty: x.qty, status: 'substituted', note: 'Came as ' + x.description } }))
    setMissing(m => m.filter(id => id !== lineId))
  }

  const added = extras.filter(x => x.mode === 'add' && x.item)
  const arrived = [
    ...po.lines.filter(l => Number(rowOf(l).received_qty) > 0),
    ...added.filter(x => x.qty > 0).map(x => ({ storage: x.item.storage })),
  ]
  const hasChilled = arrived.some(l => l.storage === 'chilled')
  const hasFrozen = arrived.some(l => l.storage === 'frozen')
  const tempBad = (hasChilled && !deliveryTempOk('chilled', chk.chilled_temp_c)) || (hasFrozen && !deliveryTempOk('frozen', chk.frozen_temp_c))
  const problem = !chk.packaging_ok || !chk.damage_ok || !chk.quality_ok || tempBad || !chk.accepted
  const missingTemp = (hasChilled && chk.chilled_temp_c == null) || (hasFrozen && chk.frozen_temp_c == null)
  const undecided = extras.filter(x => extraProblem(x)).length
  const save = useMutation({
    mutationFn: () => api.post(`/purchasing/pos/${po.id}/receive`, {
      notes,
      ...(reading ? { invoice_id: reading.invoice.id } : {}),
      lines: po.lines.map(l => {
        const inv = lineInv[l.id]
        const r = rowOf(l)
        return {
          id: l.id, received_qty: Number(r.received_qty) || 0,
          status: r.status || receiveStatusFor(l.qty, r.received_qty),
          note: r.note,
          ...(inv ? { invoice_idx: inv.idx, ...(prices ? { invoice_price: inv.price } : {}) } : {}),
        }
      }),
      add: added.map(x => ({
        item_id: x.item.id, quote_id: x.quote_id || null,
        pack: x.quote_id ? null : { name: x.pack.name || 'pack', count: x.pack.count || 1, qty: x.pack.qty, unit: x.pack.unit },
        received_qty: x.qty, invoice_idx: x.idx, ...(prices ? { invoice_price: x.price } : {}),
        note: `Not ordered: invoiced as ${x.description}`.slice(0, 500),
      })),
      check: {
        packaging_ok: chk.packaging_ok, damage_ok: chk.damage_ok, quality_ok: chk.quality_ok, accepted: chk.accepted,
        chilled_temp_c: hasChilled ? chk.chilled_temp_c : null, frozen_temp_c: hasFrozen ? chk.frozen_temp_c : null,
        corrective_action: chk.corrective_action,
      },
    }),
    onSuccess: onSaved,
  })
  const inv = reading?.invoice
  const charges = reading ? reading.invoice.lines.filter(l => l.is_charge) : []
  return (
    <div className="fixed inset-0 z-40 bg-page flex flex-col" role="dialog" aria-modal="true" aria-label="Book in delivery">
      <div className="flex items-center gap-2 px-4 h-14 border-b bg-background shrink-0">
        <button type="button" onClick={onClose} className="w-11 h-11 -ml-2 flex items-center justify-center rounded-lg hover:bg-muted touch-manipulation" aria-label="Close"><X className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">Book in: {po.supplier_name}</p>
          <p className="text-xs text-muted-foreground">{poNumberLabel(po.number)} · due {fmtDate(po.delivery_date)}</p>
        </div>
        <button type="button" className={btn.primary} disabled={save.isPending || missingTemp || undecided > 0 || (problem && !chk.corrective_action.trim())} onClick={() => save.mutate()} data-testid="receive-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          <section className="rounded-xl border bg-background overflow-hidden">
            <div className="section-head px-4 py-2"><h3 className="text-sm font-semibold">Invoice or delivery note</h3></div>
            <div className="p-4 space-y-3">
              {!inv ? (
                <InvoiceReader po={po} onRead={applyReading} />
              ) : (
                <div className="space-y-2" data-testid="inv-summary">
                  <p className="text-sm">
                    {ASSISTANT_NAME} read {inv.supplier_name ? <strong>{inv.supplier_name}</strong> : 'the invoice'}
                    {inv.invoice_number ? ` no. ${inv.invoice_number}` : ''}{inv.invoice_date ? `, ${fmtDate(inv.invoice_date)}` : ''}
                    {prices && inv.total != null ? `, total ${money(inv.total)}` : ''}: {inv.lines.filter(l => !l.is_charge).length} lines.
                    {' '}Check each line below before saving.
                  </p>
                  {inv.notes && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{inv.notes}</p>}
                  {prices && charges.length > 0 && (
                    <p className="text-xs text-muted-foreground">Charges on the invoice: {charges.map(c => `${c.description}${c.line_total != null ? ' ' + money(c.line_total) : ''}`).join(', ')}</p>
                  )}
                  <button type="button" className={btn.ghost} onClick={() => { setReading(null); setLineInv({}); setExtras([]); setMissing([]) }}>Read another file</button>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border bg-background overflow-hidden">
            <div className="section-head px-4 py-2"><h3 className="text-sm font-semibold">What arrived</h3></div>
            <div className="divide-y">
              {po.lines.map(l => {
                const r = rowOf(l)
                const auto = receiveStatusFor(l.qty, r.received_qty)
                const status = r.status || auto
                return (
                  <div key={l.id} className="px-4 py-3 space-y-2" data-testid="receive-line">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[160px]">
                        <p className="text-sm font-medium">{l.item_name} <StorageBadge storage={l.storage} />{l.added_on_receipt && <NotOrderedBadge />}</p>
                        {l.product_name && <p className="text-xs">{l.product_name}</p>}
                        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5"><CodeTag code={l.supplier_code} />{l.pack_label} · ordered {fmtNum(l.qty)}</p>
                      </div>
                      <QtyStepper value={r.received_qty} onChange={v => setRow(l.id, 'received_qty', v)} label={l.item_name} />
                    </div>
                    {lineInv[l.id] && (
                      <InvoiceLineNote inv={lineInv[l.id]} line={l} prices={prices}
                        onPrice={v => setLineInv(m => ({ ...m, [l.id]: { ...m[l.id], price: v } }))}
                        onUnlink={() => unlink(l.id)} />
                    )}
                    {reading && missing.includes(l.id) && (
                      <p className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Not on the invoice: check it arrived</p>
                    )}
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

          {extras.length > 0 && (
            <ExtrasSection po={po} extras={extras} setExtras={setExtras} prices={prices} canSetup={canSetup}
              lineInv={lineInv} onCameInstead={cameInstead} />
          )}

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
              {undecided > 0 && <p className="text-sm text-amber-800" data-testid="receive-undecided">{undecided} line{undecided === 1 ? '' : 's'} on the invoice need{undecided === 1 ? 's' : ''} a decision above.</p>}
              <ErrorNote error={save.error} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function NotOrderedBadge() {
  return <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 font-normal align-middle">Not ordered</span>
}

function NewLineBadge() {
  return <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-900 font-normal align-middle">New</span>
}

/** A line added on receipt as an ordinary line: what arrived, at the invoice's price and VAT where read. */
function addedAsLine(l) {
  return {
    qty: l.received_qty ?? 0,
    price: l.invoice_price ?? l.price,
    vat_rate: l.invoice_vat_rate ?? l.vat_rate,
  }
}

/** Net and VAT of the lines that arrived without being ordered, or null when there are none. */
function notOrderedTotals(lines) {
  const added = (lines || []).filter(l => l.added_on_receipt && l.price != null)
  if (!added.length) return null
  const t = orderTotals(added.map(addedAsLine))
  return { net: t.subtotal, vat: t.vat }
}
