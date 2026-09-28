// src/pages/Orders.jsx
//
// Online orders (/orders, web_orders module): the live orders board for a
// venue and day, pause / sold out, and a sales report. The board and its
// pieces live in components/orders/shared.jsx (also used by the mobile
// module).

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ShoppingBag, ChevronLeft, ChevronRight, Settings2, Ban, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { OrderBoard, AvailabilityModal, PauseButton, useOrders, money, todayIn } from '@/components/orders/shared'

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function dayLabel(date, today) {
  if (date === today) return 'Today'
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
}

export default function Orders() {
  const api = useApi()
  const [venueId, setVenueId] = useState(() => { try { return localStorage.getItem('maca_orders_venue') || '' } catch { return '' } })
  const [tab, setTab] = useState('board')
  const [soldOut, setSoldOut] = useState(false)
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })

  useEffect(() => {
    if (venues.length && !venues.some(v => v.id === venueId)) setVenueId(venues[0].id)
  }, [venues, venueId])
  useEffect(() => { try { if (venueId) localStorage.setItem('maca_orders_venue', venueId) } catch {} }, [venueId])

  const venue = venues.find(v => v.id === venueId)
  const today = todayIn(venue?.timezone)
  const [date, setDate] = useState(today)
  useEffect(() => { setDate(todayIn(venue?.timezone)) }, [venue?.timezone])

  const board = useOrders(venueId, date)
  const ordering = board.data?.ordering

  return (
    <div className="p-4 md:p-6 max-lg:notouch:pl-14">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingBag className="w-6 h-6 text-primary" /> Online orders</h1>
        <div className="flex flex-wrap items-center gap-2">
          {venues.length > 1 && (
            <select value={venueId} onChange={e => setVenueId(e.target.value)}
              className="border rounded-md px-3 min-h-[44px] text-sm bg-background">
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <Link to="/orders/settings" className="inline-flex items-center gap-1.5 border rounded-md px-3 min-h-[44px] text-sm touch-manipulation">
            <Settings2 className="w-4 h-4" /> Setup
          </Link>
        </div>
      </div>

      {ordering && !ordering.is_enabled && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm">
          Online ordering is switched off for this venue. Turn it on in <Link to="/orders/settings" className="underline">Ordering setup</Link>.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-1">
          {[['board', 'Orders'], ['report', 'Report']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn('min-h-[44px] px-4 rounded-md text-sm font-medium touch-manipulation', tab === k ? 'bg-primary text-primary-foreground' : 'border bg-background')}>
              {l}
            </button>
          ))}
        </div>
        {tab === 'board' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <button onClick={() => setDate(d => addDays(d, -1))} className="w-11 h-11 border rounded-md flex items-center justify-center touch-manipulation"><ChevronLeft className="w-4 h-4" /></button>
              <div className="relative">
                <span className="inline-flex items-center justify-center min-h-[44px] w-48 border rounded-md text-sm font-medium">{dayLabel(date, today)}</span>
                <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Choose a day" />
              </div>
              <button onClick={() => setDate(d => addDays(d, 1))} className="w-11 h-11 border rounded-md flex items-center justify-center touch-manipulation"><ChevronRight className="w-4 h-4" /></button>
              {date !== today && <button onClick={() => setDate(today)} className="min-h-[44px] px-3 border rounded-md text-sm touch-manipulation">Today</button>}
            </div>
            <button onClick={() => setSoldOut(true)} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-md border text-sm font-medium touch-manipulation">
              <Ban className="w-4 h-4" /> Sold out
            </button>
            <PauseButton venueId={venueId} ordering={ordering} />
          </div>
        )}
      </div>

      {ordering?.is_paused && tab === 'board' && (
        <div className="mb-4 rounded-md bg-amber-100 text-amber-900 p-3 text-sm font-medium">
          Orders are paused: guests can see the menu but can't order.{ordering.pause_message ? ` Message: "${ordering.pause_message}"` : ''}
        </div>
      )}

      {!venueId ? null : tab === 'board'
        ? <OrderBoard venueId={venueId} date={date} />
        : <OrdersReport venueId={venueId} today={today} />}

      {soldOut && <AvailabilityModal venueId={venueId} onClose={() => setSoldOut(false)} />}
    </div>
  )
}

const METHOD_LABEL = { pay_at_venue: 'Pay at the counter', demo: 'Test payments', cash: 'Cash at the counter', card_terminal: 'Card at the counter' }

function OrdersReport({ venueId, today }) {
  const api = useApi()
  const [range, setRange] = useState(7)
  const from = addDays(today, -(range - 1))
  const q = useQuery({
    queryKey: ['orders-report', venueId, from, today],
    queryFn: () => api.get(`/orders/report?venue_id=${venueId}&from=${from}&to=${today}`),
  })
  const r = q.data
  const max = useMemo(() => Math.max(1, ...(r?.days || []).map(d => d.total_pence)), [r])

  return (
    <div className="space-y-5">
      <div className="flex gap-1">
        {[[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']].map(([n, l]) => (
          <button key={n} onClick={() => setRange(n)}
            className={cn('min-h-[44px] px-4 rounded-md text-sm touch-manipulation', range === n ? 'bg-primary text-primary-foreground' : 'border bg-background')}>{l}</button>
        ))}
      </div>
      {q.isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
      {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
      {r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Orders', r.totals.orders],
              ['Sales', money(r.totals.total_pence)],
              ['Average order', money(r.totals.average_pence)],
              ['Tips', money(r.totals.tip_pence)],
              ['Refunded', money(r.totals.refunded_pence)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="text-xl font-bold">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Sales count placed, accepted, ready and collected orders (tips included); rejected, cancelled and unpaid orders are left out. VAT included in sales: {money(r.totals.vat_pence)}.</p>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold mb-3 text-sm">By day</h3>
              {!r.days.length && <p className="text-sm text-muted-foreground">No orders.</p>}
              {r.days.map(d => (
                <div key={d.date} className="flex items-center gap-3 text-sm py-1">
                  <span className="w-24 shrink-0">{d.date.slice(5)}</span>
                  <div className="flex-1 h-3 bg-muted rounded"><div className="h-3 bg-primary rounded" style={{ width: `${(d.total_pence / max) * 100}%` }} /></div>
                  <span className="w-24 text-right">{money(d.total_pence)}</span>
                  <span className="w-10 text-right text-muted-foreground">{d.orders}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold mb-3 text-sm">By payment</h3>
              {!r.by_method.length && <p className="text-sm text-muted-foreground">No payments.</p>}
              {r.by_method.map(m => (
                <div key={m.method} className="flex justify-between text-sm py-1 border-b last:border-0">
                  <span>{METHOD_LABEL[m.method] || m.method}</span>
                  <span>{money(m.paid_pence - m.refunded_pence)} <span className="text-muted-foreground">({m.orders})</span></span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground mt-2">Money taken, less refunds. Pay-at-counter orders appear once staff mark them paid.</p>
              <h3 className="font-semibold mt-5 mb-3 text-sm">Top dishes</h3>
              {r.top_items.map(i => (
                <div key={i.name} className="flex justify-between text-sm py-1 border-b last:border-0">
                  <span>{i.qty} x {i.name}</span><span>{money(i.total_pence)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
