// src/components/purchasing/suggest.jsx
//
// The order form's Suggest (inventory phase 9a, docs/INVENTORY.md 9): for
// one supplier, the stock area's forecast of what each line will use until
// the delivery after next, plus the group's buffer, less what is on hand and
// on order, in packs up to the price's minimum (POST
// /api/purchasing/orders/:id/suggest; the rule is shared/forecast.js). The
// suggested quantities go on their lines marked, as Pepper's do, and are
// saved only when the person presses OK (or OK all) or changes them; what
// was suggested is kept on each line on the server either way, so the
// report Suggested orders can judge it against what was ordered.
//
//   SuggestModal     the order's suppliers, each with when the order would
//                    arrive and what it has to last until, and its Suggest
//   SuggestMark      a line's mark while its suggestion waits for OK
//   SuggestWorking   a line's suggestion in a sentence, the working behind a tap
//   SUGGEST_CLASS    the marked line's look
//
// It reads what is on hand, so it shows only with Stock view (the order's
// sees_stock), and only to someone who can change the order.

import { useState } from 'react'
import { Loader2, Wand2, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal, ErrorNote } from '@/components/staff/shared'
import { btn, fmtDate } from '@/components/purchasing/shared'
import { fmtNum } from '@shared/procurement.js'
import { deliveryAfter, suggestionPacks, SUGGEST_BASES } from '@shared/forecast.js'

export const SUGGEST_CLASS = 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'

// A moment's day where the page is open ('YYYY-MM-DD').
const localDay = at => {
  const d = new Date(at)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

/**
 * The suppliers whose prices the order's lines are on, each with the day a
 * Suggest works out for (`arrives`): the delivery day the order already asks
 * of it when that is today or later, else its next delivery there (as the
 * server does).
 */
export function orderSuppliers(order, quoteOf) {
  const m = new Map()
  for (const it of order?.items || []) {
    const q = quoteOf(it)
    if (!q || m.has(q.supplier_id)) continue
    const s = order.suppliers?.[q.supplier_id]
    if (!s) continue
    const asked = order.supplier_options?.[q.supplier_id]?.delivery_date
    m.set(q.supplier_id, { ...s, arrives: asked && (!order.today || asked >= order.today) ? asked : s.next_delivery })
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Pick a supplier to suggest for. busy: the supplier id being suggested for;
 * onSuggest(supplier) does the asking (the order form keeps the result).
 */
export function SuggestModal({ suppliers, busy, error, onSuggest, onClose }) {
  return (
    <Modal title="Suggest quantities" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        For each line from the supplier: what sales used on the same weekdays over the last four weeks, scaled by the covers booked,
        until the delivery after next, plus the buffer, less what is on hand and already on order, in whole packs. Lines sales never used are
        filled up to their par. The quantities are marked for you to check; nothing is saved until you OK them.
      </p>
      {!suppliers.length && <p className="text-sm text-muted-foreground">No line has a supplier price yet.</p>}
      <div className="divide-y rounded-lg border" data-testid="suggest-suppliers">
        {suppliers.map(s => {
          const arrives = s.arrives || s.next_delivery
          const after = deliveryAfter(s, arrives)
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-[180px]">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">Arrives {fmtDate(arrives)}, to last until {fmtDate(after)}</p>
              </div>
              <button type="button" className={cn(btn.outline, 'min-h-[48px]')} disabled={!!busy} onClick={() => onSuggest(s)} data-testid="suggest-supplier">
                {busy === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}Suggest
              </button>
            </div>
          )
        })}
      </div>
      <ErrorNote error={error} />
    </Modal>
  )
}

/** A line's suggestion waiting for the person: what it is from, and OK. */
export function SuggestMark({ basis, onAccept }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-800" data-testid="suggest-mark">
      <Wand2 className="w-3 h-3" /> {basis === 'par' ? 'Suggested up to par' : 'Suggested from sales'}
      <button type="button" onClick={onAccept} data-testid="suggest-ok"
        className="ml-1 inline-flex items-center justify-center gap-0.5 rounded border border-sky-300 bg-background px-3 min-h-[48px] min-w-[48px] text-sky-800 hover:bg-sky-100 touch-manipulation">
        <Check className="w-3 h-3" /> OK
      </button>
    </span>
  )
}

/**
 * A line's suggestion in a sentence (the working's summary), the steps
 * behind How. kept: the one kept on the line (not waiting): with when it was
 * made, and Use when the line's quantity is another. quote: the price the
 * line is on now (quotes: the line's prices), so Use orders the amount
 * suggested in the line's own packs, whatever price it was worked out on
 * (suggestionPacks()).
 */
export function SuggestWorking({ s, kept = false, qty, quote = null, quotes = [], readOnly, onUse }) {
  const [open, setOpen] = useState(false)
  if (!s?.summary) return null
  const packs = suggestionPacks(s, quote, quotes)
  const otherPack = !!quote && !!s.quote_id && s.quote_id !== quote.id
  const differs = kept && packs != null && Number(qty) !== packs
  return (
    <div className="text-xs text-sky-900 space-y-1" data-testid="suggest-working">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex-1 min-w-[180px]">
          {kept && <>Suggested {fmtNum(s.qty)}{otherPack && s.pack_label ? ` x ${s.pack_label}` : ''}{s.at ? ` on ${fmtDate(localDay(s.at))}` : ''}: </>}{s.summary}
        </span>
        {s.words?.length > 0 && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="suggest-how"
            className="inline-flex items-center gap-1 min-h-[48px] px-2 rounded-lg hover:bg-sky-50 touch-manipulation">
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}How
          </button>
        )}
        {differs && !readOnly && onUse && (
          <button type="button" className={cn(btn.outline, 'min-h-[48px] text-xs')} onClick={() => onUse(packs)} data-testid="suggest-use">
            Use {fmtNum(packs)}
          </button>
        )}
      </div>
      {open && (
        <ul className="list-disc pl-5 space-y-0.5 text-sky-900/90" data-testid="suggest-steps">
          {s.words.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      {open && s.basis && <p className="text-[11px] text-muted-foreground">{SUGGEST_BASES[s.basis]?.hint}</p>}
    </div>
  )
}
