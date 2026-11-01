// src/components/purchasing/stock.jsx
//
// A supplier price out of stock until a date (migration 234). The date is
// the first day it can be delivered again, so a date that has passed means
// it's back; outOfStock() in shared/procurement.js is the one rule.
//
//   StockBadge    "Out of stock at Brakes until Tue 10 Nov" where a price
//                 can't come on the day in question (order lines, purchase
//                 order lines, pickers).
//   StockNote     the lines of one delivery that can't come that day (Place
//                 order, splits).
//   StockControl  what the supplier said about one price, with Out of
//                 stock? / Back in stock / Change for anyone who orders,
//                 approves or keeps the catalogue (meta.can_mark_stock;
//                 PUT /api/purchasing/quotes/:id/stock).
//
// Nothing moves an order to another price by itself: staff pick another
// price, another day, or order it anyway.

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, PackageX } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { inputCls, ErrorNote } from '@/components/staff/shared'
import { addDays, dayText, outOfStock, outOfStockText } from '@shared/procurement.js'
import { DateButton, btn, fmtDate } from '@/components/purchasing/shared'

const noteText = note => (note ? ` (${note})` : '')

/** "Out of stock at Brakes until Tue 10 Nov" when the price can't come on `date`; else nothing. */
export function StockBadge({ quote, date, supplierName, className }) {
  const o = outOfStock(quote, date)
  if (!o) return null
  return (
    <span data-testid="stock-badge" data-until={o.until}
      className={cn('inline-flex items-start gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-900', className)}>
      <PackageX className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>{outOfStockText(quote, date, supplierName)}{noteText(o.note)}</span>
    </span>
  )
}

/**
 * The lines of one delivery that can't come on `date` because the supplier
 * said they're out of stock: lines = [{ key, name, quote }]. Says how to
 * deal with it; never stops anything.
 */
export function StockNote({ lines, date, supplierName, hint, className, testId = 'stock-note' }) {
  const out = lines.map(l => ({ ...l, o: outOfStock(l.quote, date) })).filter(l => l.o)
  if (!out.length) return null
  const latest = out.reduce((m, l) => (l.o.until > m ? l.o.until : m), '')
  return (
    <div className={cn('rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-1', className)}
      data-testid={testId} data-until={latest}>
      <p className="flex items-start gap-1.5">
        <PackageX className="w-4 h-4 shrink-0" />
        <span>
          {supplierName || 'The supplier'} said {out.length === 1 ? 'this is' : 'these are'} out of stock for {fmtDate(date)}:
        </span>
      </p>
      <ul className="pl-6 list-disc">
        {out.map(l => <li key={l.key}>{l.name}: back {fmtDate(l.o.until)}{noteText(l.o.note)}</li>)}
      </ul>
      {hint !== false && (
        <p>{hint || `Deliver on ${fmtDate(latest)} or later, order ${out.length === 1 ? 'it' : 'them'} from another supplier, or order anyway.`}</p>
      )}
    </div>
  )
}

/**
 * What the supplier said about one price: out of stock until a date (with
 * Back in stock and Change), or a button to say so. `today` is the venue's
 * date: a date on or before it means the price is back. Shows nothing for
 * a price in stock when `canMark` is off.
 */
export function StockControl({ quote, today, canMark, onChanged, className }) {
  const api = useApi()
  // What was just saved, until the page's own data catches up.
  const [local, setLocal] = useState(null)
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { setLocal(null) }, [quote.id, quote.out_of_stock_until, quote.out_of_stock_at])
  const shown = local ? { ...quote, ...local } : quote
  const until = shown.out_of_stock_until && String(shown.out_of_stock_until).slice(0, 10) > today
    ? String(shown.out_of_stock_until).slice(0, 10) : null
  const save = useMutation({
    mutationFn: body => api.put(`/purchasing/quotes/${quote.id}/stock`, body),
    onSuccess: res => { setLocal(res); setEditing(false); onChanged?.(res) },
  })
  if (!until && !editing && !canMark) return null
  const tomorrow = addDays(today, 1)
  const open = () => {
    setDate(until || '')
    setNote(until ? shown.out_of_stock_note || '' : '')
    save.reset()
    setEditing(true)
  }
  const quick = [
    ['Tomorrow', tomorrow], ['In a week', addDays(today, 7)], ['In 2 weeks', addDays(today, 14)], ['In 4 weeks', addDays(today, 28)],
  ]
  const by = [shown.out_of_stock_by && `by ${shown.out_of_stock_by}`, shown.out_of_stock_at && `on ${fmtDate(shown.out_of_stock_at)}`]
    .filter(Boolean).join(' ')
  return (
    <div className={cn('space-y-2', className)} data-testid="stock-control">
      {until && !editing && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm space-y-1.5" data-testid="stock-state" data-until={until}>
          <p className="flex items-start gap-1.5 text-amber-900">
            <PackageX className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Out of stock until {dayText(until)}: it can be delivered again from then.{shown.out_of_stock_note ? ` "${shown.out_of_stock_note}"` : ''}</span>
          </p>
          {by && <p className="text-xs text-muted-foreground">Marked {by}</p>}
          {canMark && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn.outline} disabled={save.isPending} onClick={() => save.mutate({ until: null })} data-testid="stock-back">
                {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Back in stock
              </button>
              <button type="button" className={btn.ghost} onClick={open} data-testid="stock-change">Change</button>
            </div>
          )}
        </div>
      )}
      {!until && !editing && canMark && (
        <button type="button" className={cn(btn.ghost, 'border')} onClick={open} data-testid="stock-mark">
          <PackageX className="w-4 h-4" />Out of stock?
        </button>
      )}
      {editing && (
        <div className="rounded-lg border bg-muted/30 px-3 py-3 space-y-3" data-testid="stock-form">
          <p className="text-sm font-medium">The first day it can be delivered again</p>
          <div className="flex flex-wrap items-center gap-2">
            <DateButton value={date} min={tomorrow} onChange={setDate} label="First day it can be delivered again" />
            {quick.map(([label, d]) => (
              <button key={label} type="button" onClick={() => setDate(d)} data-testid="stock-quick"
                className={cn('h-11 px-3 rounded-lg border text-sm touch-manipulation', date === d ? 'bg-primary/10 border-primary' : 'hover:bg-muted')}>
                {label}
              </button>
            ))}
          </div>
          <input className={inputCls} value={note} maxLength={500} onChange={e => setNote(e.target.value)} data-testid="stock-note-input"
            placeholder="What they said (optional)" aria-label="What the supplier said (optional)" />
          <p className="text-xs text-muted-foreground">
            Orders for a day before it say it's out of stock, at every venue. Nothing moves to another supplier by itself.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={!date || date <= today || save.isPending} data-testid="stock-save"
              onClick={() => save.mutate({ until: date, note: note.trim() || null })}>
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save
            </button>
            <button type="button" className={btn.ghost} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
      <ErrorNote error={save.error} />
    </div>
  )
}
