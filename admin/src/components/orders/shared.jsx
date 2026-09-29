// src/components/orders/shared.jsx
//
// Web ordering (migration 122): the orders board and its pieces, shared
// by the Online orders page (pages/Orders.jsx) and the mobile module
// (pages/mobile/MobileOrders.jsx). One implementation of each: the board,
// the order detail with its actions, the sold-out panel, ticket printing.
//
// Every action goes through /api/orders (routes/orders.js); the board
// refreshes on the venue WebSocket (order.created / order.updated) and
// every 30 seconds as a fallback.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth0 } from '@auth0/auth0-react'
import {
  X, Clock, Phone, Mail, AlertTriangle, Printer, CheckCircle2, ChefHat, PackageCheck,
  Ban, RotateCcw, Loader2, Volume2, VolumeX, ChevronDown, ChevronUp, Banknote, CreditCard,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatPence } from '@shared/orderPricing.js'

export const STATUS = {
  pending_payment: { label: 'Awaiting payment', cls: 'bg-gray-100 text-gray-700' },
  placed:          { label: 'New',              cls: 'bg-amber-100 text-amber-800' },
  accepted:        { label: 'Accepted',         cls: 'bg-sky-100 text-sky-800' },
  preparing:       { label: 'Preparing',        cls: 'bg-indigo-100 text-indigo-800' },
  ready:           { label: 'Ready',            cls: 'bg-emerald-100 text-emerald-800' },
  completed:       { label: 'Collected',        cls: 'bg-gray-100 text-gray-600' },
  rejected:        { label: 'Rejected',         cls: 'bg-red-100 text-red-700' },
  cancelled:       { label: 'Cancelled',        cls: 'bg-red-100 text-red-700' },
  expired:         { label: 'Expired',          cls: 'bg-gray-100 text-gray-500' },
}

const PAYMENT = {
  unpaid: 'Not paid', pending: 'Payment pending', paid: 'Paid', failed: 'Payment failed',
  partially_refunded: 'Partly refunded', refunded: 'Refunded',
}

export const COLUMNS = [
  { key: 'new',      label: 'New',         statuses: ['placed'] },
  { key: 'progress', label: 'In progress', statuses: ['accepted', 'preparing'] },
  { key: 'ready',    label: 'Ready',       statuses: ['ready'] },
  { key: 'done',     label: 'Done',        statuses: ['completed', 'rejected', 'cancelled', 'expired', 'pending_payment'] },
]

export const money = (p, cur = 'GBP') => formatPence(p, cur)

export function timeOf(iso, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

export function todayIn(tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return p
}

// ── Realtime ─────────────────────────────────────────────────

export function useRealtimeOrders(venueId) {
  const qc = useQueryClient()
  const { getAccessTokenSilently } = useAuth0()
  useEffect(() => {
    if (!venueId) return
    let ws
    let timer
    let closed = false
    async function connect() {
      try {
        const token = await getAccessTokenSilently()
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        ws = new WebSocket(`${proto}://${window.location.host}/ws?venue=${venueId}&token=${token}`)
        ws.onmessage = e => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type?.startsWith('order.')) {
              qc.invalidateQueries({ queryKey: ['orders', venueId] })
              qc.invalidateQueries({ queryKey: ['order'] })
            } else if (msg.type?.startsWith('ordering.')) {
              qc.invalidateQueries({ queryKey: ['orders', venueId] })
              qc.invalidateQueries({ queryKey: ['order-availability', venueId] })
            }
          } catch {}
        }
        ws.onclose = () => { if (!closed) timer = setTimeout(connect, 3000) }
        ws.onerror = () => ws.close()
      } catch {
        if (!closed) timer = setTimeout(connect, 5000)
      }
    }
    connect()
    return () => { closed = true; clearTimeout(timer); ws?.close() }
  }, [venueId, getAccessTokenSilently, qc])
}

export function useOrders(venueId, date, { includeUnpaid = false } = {}) {
  const api = useApi()
  return useQuery({
    queryKey: ['orders', venueId, date, includeUnpaid],
    queryFn: () => api.get(`/orders?venue_id=${venueId}${date ? `&date=${date}` : ''}${includeUnpaid ? '&include_unpaid=1' : ''}`),
    enabled: !!venueId,
    refetchInterval: 30_000,
  })
}

// A short two-tone chime for new orders. Browsers only allow sound after
// a tap on the page, so the board has a "Sound on" button that unlocks it.
function useChime() {
  const ctxRef = useRef(null)
  const [on, setOn] = useState(false)
  const enable = () => {
    try {
      ctxRef.current = ctxRef.current || new (window.AudioContext || window.webkitAudioContext)()
      ctxRef.current.resume()
      setOn(true)
    } catch { setOn(false) }
  }
  const play = () => {
    const ctx = ctxRef.current
    if (!on || !ctx) return
    ;[0, 0.25].forEach((t, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = i ? 1046 : 784
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + t)
      o.stop(ctx.currentTime + t + 0.4)
    })
  }
  return { on, enable, disable: () => setOn(false), play }
}

// ── Mutations ────────────────────────────────────────────────

export function useOrderActions(venueId) {
  const api = useApi()
  const qc = useQueryClient()
  const done = data => {
    qc.invalidateQueries({ queryKey: ['orders', venueId] })
    const id = data?.order?.id ?? data?.id
    if (id) qc.setQueryData(['order', id], data.order ?? data)
  }
  return {
    status: useMutation({ mutationFn: ({ id, ...body }) => api.post(`/orders/${id}/status`, body), onSuccess: done }),
    promised: useMutation({ mutationFn: ({ id, promised_at }) => api.post(`/orders/${id}/promised`, { promised_at }), onSuccess: done }),
    markPaid: useMutation({ mutationFn: ({ id, method }) => api.post(`/orders/${id}/mark-paid`, { method }), onSuccess: done }),
    refund: useMutation({ mutationFn: ({ id, ...body }) => api.post(`/orders/${id}/refund`, body), onSuccess: done }),
  }
}

// ── Ticket printing ──────────────────────────────────────────
// An 80mm-wide kitchen/counter ticket through the browser print dialog
// (hidden iframe, same approach as the rota print). Direct Epson printing
// comes with the POS printer layer.

export function printTicket(order, venue) {
  const tz = venue?.timezone || 'Europe/London'
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = (order.items || []).map(i => `
    <div class="l"><div><b>${i.qty} x ${esc(i.name)}</b>${(i.options || []).length ? `<div class="o">${esc(i.options.map(o => o.label).join(', '))}</div>` : ''}${i.note ? `<div class="o">Note: ${esc(i.note)}</div>` : ''}</div><div>${money(i.line_total_pence, order.currency)}</div></div>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Order ${order.order_number}</title><style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 13px; width: 72mm; margin: 0; }
    h1 { font-size: 26px; margin: 0; } .big { font-size: 18px; font-weight: 700; margin: 4px 0; }
    .l { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #999; }
    .o { font-size: 12px; } .al { border: 2px solid #000; padding: 4px; margin: 6px 0; font-weight: 700; }
    .t { display: flex; justify-content: space-between; font-weight: 700; margin-top: 6px; }
  </style></head><body>
    <div>${esc(venue?.name || '')}</div>
    <h1>#${order.order_number}</h1>
    <div class="big">${order.is_asap ? 'ASAP' : 'Collect'} ${timeOf(order.promised_at, tz)}</div>
    <div>${esc(order.guest_name)} · ${esc(order.guest_phone || '')}</div>
    ${order.allergy_note ? `<div class="al">ALLERGY: ${esc(order.allergy_note)}</div>` : ''}
    ${order.notes ? `<div>Note: ${esc(order.notes)}</div>` : ''}
    <div style="margin-top:6px;">${lines}</div>
    ${(order.promotions || []).map(p => `<div class="l"><div>${esc(p.name)}${p.code ? ' (' + esc(p.code) + ')' : ''}</div><div>-${money(p.discount_pence, order.currency)}</div></div>`).join('')}
    ${order.tip_pence > 0 ? `<div class="l"><div>Tip</div><div>${money(order.tip_pence, order.currency)}</div></div>` : ''}
    <div class="t"><span>Total</span><span>${money(order.total_pence, order.currency)}</span></div>
    <div>${PAYMENT[order.payment_status] || ''}</div>
  </body></html>`
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)
  frame.contentDocument.open()
  frame.contentDocument.write(html)
  frame.contentDocument.close()
  setTimeout(() => {
    frame.contentWindow.focus()
    frame.contentWindow.print()
    setTimeout(() => frame.remove(), 1000)
  }, 250)
}

// ── Board ────────────────────────────────────────────────────

export function OrderBoard({ venueId, date, compact = false, showUnpaid = false }) {
  const q = useOrders(venueId, date, { includeUnpaid: showUnpaid })
  const actions = useOrderActions(venueId)
  const chime = useChime()
  const [openId, setOpenId] = useState(null)
  const [tab, setTab] = useState('new')
  const [showDone, setShowDone] = useState(false)
  const seen = useRef(null)
  useRealtimeOrders(venueId)

  const orders = q.data?.orders || []
  const venue = q.data?.venue
  const tz = venue?.timezone || 'Europe/London'

  // Chime when a new order arrives (not on first load).
  useEffect(() => {
    const ids = new Set(orders.filter(o => o.status === 'placed').map(o => o.id))
    if (seen.current) {
      for (const id of ids) if (!seen.current.has(id)) { chime.play(); break }
    }
    seen.current = ids
  }, [orders]) // eslint-disable-line react-hooks/exhaustive-deps

  const byCol = useMemo(() => Object.fromEntries(COLUMNS.map(c => [c.key, orders.filter(o => c.statuses.includes(o.status))])), [orders])
  const open = orders.find(o => o.id === openId)

  if (q.isLoading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  if (q.isError) return <p className="text-sm text-destructive py-8 text-center">{q.error.message}</p>

  const quick = o => {
    const next = { placed: 'accepted', accepted: 'ready', preparing: 'ready', ready: 'completed' }[o.status]
    if (!next) return null
    const label = { accepted: 'Accept', ready: 'Ready', completed: 'Collected' }[next]
    return (
      <button
        onClick={e => { e.stopPropagation(); actions.status.mutate({ id: o.id, to: next }) }}
        disabled={actions.status.isPending}
        className="min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-50">
        {label}
      </button>
    )
  }

  const card = o => (
    <div key={o.id} role="button" tabIndex={0} onClick={() => setOpenId(o.id)}
      onKeyDown={e => { if (e.key === 'Enter') setOpenId(o.id) }}
      className={cn('rounded-lg border bg-background p-3 text-left cursor-pointer touch-manipulation hover:border-primary/50',
        o.status === 'placed' && 'border-amber-400 ring-1 ring-amber-300')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">#{o.order_number}</span>
            <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', STATUS[o.status]?.cls)}>{STATUS[o.status]?.label}</span>
          </div>
          <div className="text-sm font-medium truncate">{o.guest_name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 justify-end text-sm font-semibold"><Clock className="w-3.5 h-3.5" />{o.is_asap ? 'ASAP ' : ''}{timeOf(o.promised_at, tz)}</div>
          <div className="text-sm">{money(o.total_pence, o.currency)}</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground line-clamp-2">
        {o.items.map(i => `${i.qty}x ${i.name}`).join(', ')}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          <span className={cn('text-[11px] px-2 py-0.5 rounded', o.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700')}>{PAYMENT[o.payment_status]}</span>
          {o.allergy_note && <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Allergy</span>}
        </div>
        {quick(o)}
      </div>
    </div>
  )

  const soundBtn = (
    <button onClick={chime.on ? chime.disable : chime.enable}
      className={cn('inline-flex items-center gap-1.5 text-sm border rounded-md px-3 min-h-[44px] touch-manipulation', chime.on && 'bg-primary/10 border-primary/40')}>
      {chime.on ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />} {chime.on ? 'Sound on' : 'Sound off'}
    </button>
  )

  const actionError = actions.status.error?.message

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {orders.filter(o => !['rejected', 'cancelled', 'expired', 'pending_payment'].includes(o.status)).length} orders ·{' '}
          {money(orders.filter(o => !['rejected', 'cancelled', 'expired', 'pending_payment'].includes(o.status)).reduce((s, o) => s + o.total_pence, 0))}
        </p>
        {soundBtn}
      </div>
      {actionError && <p className="text-sm text-destructive mb-2">{actionError}</p>}

      {compact ? (
        <>
          <div className="grid grid-cols-4 gap-1 mb-3">
            {COLUMNS.map(c => (
              <button key={c.key} onClick={() => setTab(c.key)}
                className={cn('min-h-[44px] rounded-md text-xs font-medium border touch-manipulation', tab === c.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
                {c.label} {byCol[c.key].length ? `(${byCol[c.key].length})` : ''}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {byCol[tab].length ? byCol[tab].map(card) : <p className="text-sm text-muted-foreground text-center py-10">Nothing here.</p>}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COLUMNS.slice(0, 3).map(c => (
            <div key={c.key} className="rounded-lg bg-muted/40 p-3 min-h-[200px]">
              <h3 className="text-sm font-semibold mb-2">{c.label} <span className="text-muted-foreground font-normal">{byCol[c.key].length || ''}</span></h3>
              <div className="space-y-2">
                {byCol[c.key].length ? byCol[c.key].map(card) : <p className="text-xs text-muted-foreground py-6 text-center">None</p>}
              </div>
            </div>
          ))}
          <div className="md:col-span-3">
            <button onClick={() => setShowDone(s => !s)} className="inline-flex items-center gap-1 text-sm font-medium min-h-[44px] touch-manipulation">
              {showDone ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} Done ({byCol.done.length})
            </button>
            {showDone && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">{byCol.done.map(card)}</div>}
          </div>
        </div>
      )}

      {open && <OrderDetailModal order={open} venue={venue} venueId={venueId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

// ── Detail ───────────────────────────────────────────────────

const PREP = [0, 10, 15, 20, 30, 45]

export function OrderDetailModal({ order: summary, venue, venueId, onClose }) {
  const api = useApi()
  const detail = useQuery({ queryKey: ['order', summary.id], queryFn: () => api.get(`/orders/${summary.id}`) })
  const o = detail.data || summary
  const actions = useOrderActions(venueId)
  const tz = venue?.timezone || 'Europe/London'
  const [confirm, setConfirm] = useState(null)   // 'reject' | 'cancel' | 'refund'
  const [reason, setReason] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const busy = actions.status.isPending || actions.markPaid.isPending || actions.refund.isPending || actions.promised.isPending
  const err = actions.status.error || actions.markPaid.error || actions.refund.error || actions.promised.error

  const setStatus = (to, extra = {}) => actions.status.mutate({ id: o.id, to, ...extra }, { onSuccess: () => { setConfirm(null); setReason('') } })
  const refundable = o.paid_pence - o.refunded_pence
  const open = ['placed', 'accepted', 'preparing', 'ready'].includes(o.status)
  const vatByRate = {}
  for (const i of o.items || []) if (Number(i.vat_rate) > 0) vatByRate[i.vat_rate] = (vatByRate[i.vat_rate] || 0) + i.vat_pence

  const pushTime = mins => {
    const base = Math.max(Date.now(), new Date(o.promised_at).getTime())
    actions.promised.mutate({ id: o.id, promised_at: new Date(base + mins * 60000).toISOString() })
  }

  const Btn = ({ onClick, children, tone = 'default', disabled }) => (
    <button onClick={onClick} disabled={busy || disabled}
      className={cn('inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-md text-sm font-semibold touch-manipulation disabled:opacity-50',
        tone === 'primary' && 'bg-primary text-primary-foreground',
        tone === 'danger' && 'bg-destructive/10 text-destructive',
        tone === 'default' && 'border bg-background')}>
      {children}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 h-14 border-b flex items-center justify-between sticky top-0 bg-background z-10">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-lg">#{o.order_number}</h2>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS[o.status]?.cls)}>{STATUS[o.status]?.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => printTicket(o, venue)} className="w-11 h-11 flex items-center justify-center rounded hover:bg-accent touch-manipulation" title="Print ticket"><Printer className="w-5 h-5" /></button>
            <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded hover:bg-accent touch-manipulation"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {err && <p className="text-sm text-destructive">{err.message}</p>}

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">{o.is_asap ? 'ASAP, ready by' : 'Collect at'}</div>
              <div className="text-2xl font-bold">{timeOf(o.promised_at, tz)}</div>
            </div>
            {open && (
              <div className="flex gap-1">
                {[10, 15, 30].map(m => <Btn key={m} onClick={() => pushTime(m)}>+{m}m</Btn>)}
              </div>
            )}
          </div>

          <div className="space-y-1 text-sm">
            <div className="font-semibold text-base">{o.guest_name}</div>
            {o.guest_phone && <a href={`tel:${o.guest_phone}`} className="flex items-center gap-2 text-primary min-h-[32px]"><Phone className="w-4 h-4" />{o.guest_phone}</a>}
            {o.guest_email && <a href={`mailto:${o.guest_email}`} className="flex items-center gap-2 text-muted-foreground min-h-[32px] break-all"><Mail className="w-4 h-4 shrink-0" />{o.guest_email}</a>}
            {o.data_consent_at && (
              <div className="text-xs text-muted-foreground">
                Agreed to order-only use of their details{o.marketing_opt_in ? ' · Subscribed to the newsletter' : ' · No newsletter'}
              </div>
            )}
          </div>

          {o.allergy_note && (
            <div className="rounded-md bg-red-50 border border-red-200 text-red-800 p-3 text-sm flex gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" /><div><strong>Allergy:</strong> {o.allergy_note}</div>
            </div>
          )}
          {o.notes && <div className="rounded-md bg-muted p-3 text-sm"><strong>Note:</strong> {o.notes}</div>}

          <div>
            {(o.items || []).map(i => (
              <div key={i.id} className="flex justify-between gap-3 py-2 border-b last:border-0 text-sm">
                <div className="min-w-0">
                  <div><strong>{i.qty} x</strong> {i.name}</div>
                  {i.options?.length > 0 && <div className="text-xs text-muted-foreground">{i.options.map(x => x.label).join(', ')}</div>}
                  {i.note && <div className="text-xs text-muted-foreground">Note: {i.note}</div>}
                </div>
                <div className="shrink-0">{money(i.line_total_pence, o.currency)}</div>
              </div>
            ))}
            <div className="flex justify-between text-sm pt-2"><span>Subtotal</span><span>{money(o.subtotal_pence, o.currency)}</span></div>
            {(o.promotions || []).map((p, n) => (
              <div key={n}className="flex justify-between text-sm text-emerald-700">
                <span>{p.name}{p.code ? ` (${p.code})` : ''}</span><span>-{money(p.discount_pence, o.currency)}</span>
              </div>
            ))}
            {o.tip_pence > 0 && <div className="flex justify-between text-sm"><span>Tip</span><span>{money(o.tip_pence, o.currency)}</span></div>}
            <div className="flex justify-between font-bold"><span>Total</span><span>{money(o.total_pence, o.currency)}</span></div>
            {Object.entries(vatByRate).map(([r, v]) => (
              <div key={r} className="flex justify-between text-xs text-muted-foreground"><span>Includes VAT at {Number(r)}%</span><span>{money(v, o.currency)}</span></div>
            ))}
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-semibold">{PAYMENT[o.payment_status]}</span>
              <span className="text-muted-foreground">{o.payment_method === 'pay_at_venue' ? 'Pay at the counter' : o.payment_method}</span>
            </div>
            {o.paid_pence > 0 && <div className="text-xs text-muted-foreground">Paid {money(o.paid_pence, o.currency)}{o.refunded_pence ? ` · refunded ${money(o.refunded_pence, o.currency)}` : ''}</div>}
            {open && o.paid_pence < o.total_pence && o.status !== 'pending_payment' && (
              <div className="grid grid-cols-2 gap-2">
                <Btn onClick={() => actions.markPaid.mutate({ id: o.id, method: 'cash' })}><Banknote className="w-4 h-4" />Paid cash</Btn>
                <Btn onClick={() => actions.markPaid.mutate({ id: o.id, method: 'card_terminal' })}><CreditCard className="w-4 h-4" />Paid card</Btn>
              </div>
            )}
            {refundable > 0 && confirm !== 'refund' && <Btn onClick={() => { setConfirm('refund'); setRefundAmount((refundable / 100).toFixed(2)) }}><RotateCcw className="w-4 h-4" />Refund</Btn>}
            {confirm === 'refund' && (
              <div className="space-y-2 bg-muted/50 rounded p-2">
                <label className="block text-xs font-medium">Amount (£, up to {money(refundable, o.currency)})
                  <input value={refundAmount} onChange={e => setRefundAmount(e.target.value)} inputMode="decimal"
                    className="mt-1 w-full border rounded px-3 min-h-[44px] bg-background" />
                </label>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)"
                  className="w-full border rounded px-3 min-h-[44px] bg-background text-sm" />
                <p className="text-xs text-muted-foreground">Online payments go back to the card. Cash or card-terminal payments are only recorded: give the money back at the counter.</p>
                <div className="flex gap-2">
                  <Btn tone="danger" onClick={() => actions.refund.mutate({ id: o.id, amount_pence: Math.round(Number(refundAmount) * 100), reason: reason || null }, { onSuccess: () => { setConfirm(null); setReason('') } })}
                    disabled={!(Number(refundAmount) > 0)}>Yes, refund {money(Math.round(Number(refundAmount) * 100) || 0, o.currency)}</Btn>
                  <Btn onClick={() => setConfirm(null)}>Cancel</Btn>
                </div>
              </div>
            )}
          </div>

          {o.status === 'placed' && confirm !== 'reject' && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Accept and set the ready time</div>
              <div className="grid grid-cols-3 gap-2">
                {PREP.map(m => (
                  <Btn key={m} tone={m === 0 ? 'primary' : 'default'} onClick={() => setStatus('accepted', m ? { prep_minutes: m } : {})}>
                    <CheckCircle2 className="w-4 h-4" />{m ? `${m} min` : 'Accept'}
                  </Btn>
                ))}
              </div>
              <Btn tone="danger" onClick={() => setConfirm('reject')}><Ban className="w-4 h-4" />Reject</Btn>
            </div>
          )}
          {['accepted'].includes(o.status) && <Btn onClick={() => setStatus('preparing')}><ChefHat className="w-4 h-4" />Preparing</Btn>}
          {['accepted', 'preparing'].includes(o.status) && <Btn tone="primary" onClick={() => setStatus('ready')}><PackageCheck className="w-4 h-4" />Ready to collect</Btn>}
          {o.status === 'ready' && <Btn tone="primary" onClick={() => setStatus('completed')}><CheckCircle2 className="w-4 h-4" />Collected</Btn>}
          {['accepted', 'preparing', 'ready'].includes(o.status) && confirm !== 'cancel' && (
            <Btn tone="danger" onClick={() => setConfirm('cancel')}><Ban className="w-4 h-4" />Cancel order</Btn>
          )}
          {(confirm === 'reject' || confirm === 'cancel') && (
            <div className="rounded-md border border-destructive/40 p-3 space-y-2">
              <p className="text-sm font-semibold">{confirm === 'reject' ? 'Reject this order?' : 'Cancel this order?'}</p>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for the guest (optional)"
                className="w-full border rounded px-3 min-h-[44px] bg-background text-sm" />
              {refundable > 0 && <p className="text-xs text-muted-foreground">{money(refundable, o.currency)} paid will be refunded.</p>}
              <div className="flex gap-2">
                <Btn tone="danger" onClick={() => setStatus(confirm === 'reject' ? 'rejected' : 'cancelled', { reason: reason || null })}>Yes, {confirm}</Btn>
                <Btn onClick={() => setConfirm(null)}>Keep it</Btn>
              </div>
            </div>
          )}

          {detail.data?.events && (
            <div>
              <button onClick={() => setShowHistory(s => !s)} className="text-sm font-medium inline-flex items-center gap-1 min-h-[44px] touch-manipulation">
                {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} History
              </button>
              {showHistory && (
                <ul className="text-xs space-y-1">
                  {detail.data.events.map(e => (
                    <li key={e.id} className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">{timeOf(e.created_at, tz)}</span>
                      <span>{eventLabel(e, o.currency)}{e.actor && e.actor !== 'system' ? ` · ${e.actor}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function eventLabel(e, cur) {
  if (e.type === 'status') return STATUS[e.to_status]?.label + (e.detail?.reason ? ` (${e.detail.reason})` : '') + (e.detail?.auto ? ' automatically' : '')
  if (e.type === 'payment') return e.detail?.method ? `Paid ${e.detail.method === 'cash' ? 'cash' : 'by card'} ${money(e.detail.amount_pence, cur)}` : `Payment ${e.detail?.status}`
  if (e.type === 'refund') return `Refunded ${money(e.detail?.amount_pence || 0, cur)}${e.detail?.reason ? ` (${e.detail.reason})` : ''}${e.detail?.error ? ` · failed: ${e.detail.error}` : ''}`
  if (e.type === 'time') return 'Ready time changed'
  return e.detail?.message || e.type
}

// ── Sold out ─────────────────────────────────────────────────

export function AvailabilityModal({ venueId, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['order-availability', venueId], queryFn: () => api.get(`/orders/availability/${venueId}`) })
  const set = useMutation({
    mutationFn: ({ itemId, sold_out }) => api.put(`/orders/availability/${venueId}/${itemId}`, { sold_out }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order-availability', venueId] }),
  })
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 h-14 border-b flex items-center justify-between sticky top-0 bg-background">
          <h2 className="font-semibold">Sold out</h2>
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          <p className="text-xs text-muted-foreground mb-3">Sold out dishes stay on the online menu but can't be ordered. "Today" turns back on at midnight.</p>
          {set.error && <p className="text-sm text-destructive mb-2">{set.error.message}</p>}
          {q.isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
          {(q.data?.menus || []).map(m => (
            <div key={m.id} className="mb-4">
              {q.data.menus.length > 1 && <h3 className="text-sm font-semibold mb-1">{m.name}</h3>}
              {m.sections.map(s => (
                <div key={s.id} className="mb-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{s.title}</div>
                  {s.items.map(i => (
                    <div key={i.id} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0">
                      <span className={cn('text-sm', i.sold_out && 'line-through text-muted-foreground')}>{i.name}</span>
                      <div className="flex gap-1 shrink-0">
                        {i.sold_out ? (
                          <button onClick={() => set.mutate({ itemId: i.id, sold_out: false })}
                            className="min-h-[44px] px-3 rounded-md border text-sm font-medium touch-manipulation">Back on</button>
                        ) : (
                          <>
                            <button onClick={() => set.mutate({ itemId: i.id, sold_out: 'today' })}
                              className="min-h-[44px] px-3 rounded-md bg-destructive/10 text-destructive text-sm font-medium touch-manipulation">Today</button>
                            <button onClick={() => set.mutate({ itemId: i.id, sold_out: 'indefinite' })}
                              className="min-h-[44px] px-3 rounded-md border text-sm touch-manipulation">Until back on</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {q.data && !q.data.menus.length && <p className="text-sm text-muted-foreground">No menus are set up for online ordering yet (Ordering setup).</p>}
        </div>
      </div>
    </div>
  )
}

// ── Pause ────────────────────────────────────────────────────

export function PauseButton({ venueId, ordering }) {
  const api = useApi()
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [msg, setMsg] = useState('')
  const m = useMutation({
    mutationFn: body => api.post(`/orders/pause/${venueId}`, body),
    onSuccess: () => { setAsking(false); qc.invalidateQueries({ queryKey: ['orders', venueId] }) },
  })
  if (!ordering) return null
  if (ordering.is_paused) {
    return (
      <button onClick={() => m.mutate({ paused: false })} disabled={m.isPending}
        className="min-h-[44px] px-4 rounded-md bg-amber-500 text-white text-sm font-semibold touch-manipulation">
        Paused: resume orders
      </button>
    )
  }
  if (asking) {
    return (
      <div className="flex gap-2 items-center flex-wrap">
        <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Message for guests (optional)"
          className="border rounded px-3 min-h-[44px] text-sm bg-background" />
        <button onClick={() => m.mutate({ paused: true, message: msg || null })}
          className="min-h-[44px] px-4 rounded-md bg-amber-500 text-white text-sm font-semibold touch-manipulation">Pause</button>
        <button onClick={() => setAsking(false)} className="min-h-[44px] px-3 rounded-md border text-sm touch-manipulation">Cancel</button>
      </div>
    )
  }
  return (
    <button onClick={() => setAsking(true)} className="min-h-[44px] px-4 rounded-md border text-sm font-medium touch-manipulation">
      Pause orders
    </button>
  )
}
