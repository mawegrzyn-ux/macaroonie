// src/components/purchasing/returns.jsx
//
// Returns to the supplier and their credit notes (inventory phase 9b,
// migration 321; docs/INVENTORY.md 6.4), on the Purchasing page and its phone
// version. Loaded lazily (React.lazy) by ordering.jsx:
//
//   PoReturns         a delivery's card under its lines once it is booked in:
//                     its returns, a damaged (or substituted) line's "Return
//                     it" filled in, and Return items
//   ReturnsTab        the Returns tab: the venue's returns, credits still owed
//                     first (those waiting 14 days or more marked), and one
//                     return opened from ?return= (Today's link)
//   ReturnModal       one return: its lines, what is expected back, and what may
//                     be done now (email it, mark it sent, the credit note,
//                     refused, cancel), the PDF and print
//
// What may be done comes from the API (can_start, can_approve and each
// return's can_* flags: returnActions() in shared/returns.js). Money (prices,
// the credit expected, the amount credited) only with show_prices. Starting
// a return takes the stock out of the venue at once; cancelling puts it back.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Undo2, Mail, Send, FileText, Printer, ReceiptText, Ban, Check, AlertTriangle, ChevronRight } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Modal, Field, inputCls, ErrorNote, Segmented, ConfirmDelete } from '@/components/staff/shared'
import { btn, money, fmtDate, DateButton, NumInput, QtyStepper, CodeTag, printHtml } from '@/components/purchasing/shared'
import { fmtNum, nowAt } from '@shared/procurement.js'
import { RETURN_REASONS, RETURN_SENT_VIA, CREDIT_OVERDUE_DAYS, returnTotals, returnLinesProblem } from '@shared/returns.js'

const STATUS_COLOURS = {
  open: 'bg-amber-100 text-amber-900',
  sent: 'bg-blue-100 text-blue-900',
  credited: 'bg-green-100 text-green-900',
  refused: 'bg-red-100 text-red-900',
  cancelled: 'bg-muted text-muted-foreground line-through',
}

export function ReturnStatusBadge({ ret }) {
  return (
    <span data-testid="return-status" data-status={ret.status}
      className={cn('text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap', STATUS_COLOURS[ret.status])}>
      {ret.status_label}
    </span>
  )
}

const when = t => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const day = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** One return in a list: its number, status, lines and what is owed. */
function ReturnRow({ ret, onOpen }) {
  return (
    <button type="button" onClick={onOpen} data-testid="return-row" data-id={ret.id}
      className={cn('w-full text-left flex items-center gap-3 px-4 py-3 min-h-[56px] touch-manipulation hover:bg-muted/50', ret.overdue && 'bg-red-50/60')}>
      <Undo2 className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{ret.label}</span>
          <span className="text-sm text-muted-foreground truncate">{ret.supplier_name}</span>
          <ReturnStatusBadge ret={ret} />
          {ret.overdue && (
            <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-red-100 text-red-900" data-testid="return-overdue">
              Waiting {ret.days_waiting} days
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground truncate">
          {ret.line_count} line{ret.line_count === 1 ? '' : 's'} · returned {day(ret.returned_at)} · from {ret.po_label}
          {ret.credit_note_number ? ' · credit note ' + ret.credit_note_number : ''}
        </span>
      </span>
      {ret.show_prices && ret.credit_expected != null && (
        <span className="text-sm tabular-nums shrink-0">{money(ret.status === 'credited' && ret.credit_amount != null ? ret.credit_amount : ret.credit_expected)}</span>
      )}
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  )
}

// ── A delivery's returns ─────────────────────────────────────────

/**
 * A booked-in delivery's returns, under its lines: each return, a damaged
 * or substituted line ready to go back (filled in), and Return items.
 */
export function PoReturns({ po }) {
  const api = useApi()
  const qc = useQueryClient()
  const key = ['po-returns', po.id]
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get(`/purchasing/pos/${po.id}/returns`) })
  const [starting, setStarting] = useState(null)
  const [openId, setOpenId] = useState(null)
  if (isLoading) return null
  if (error) return <ErrorNote error={error} />
  if (!data || (!data.returns.length && !data.can_start)) return null
  const ready = data.can_start ? data.lines.filter(l => l.prefill && l.left > 0) : []
  const left = data.lines.filter(l => l.left > 0)
  const changed = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ['returns'] })
    qc.invalidateQueries({ queryKey: ['stock'] })
  }
  return (
    <section className="rounded-xl border bg-background overflow-hidden" data-testid="po-returns">
      <div className="section-head px-4 py-2 flex flex-wrap items-center gap-2 min-h-[48px]">
        <h3 className="text-sm font-semibold flex-1">Returns to {po.supplier_name}</h3>
        {data.can_start && left.length > 0 && (
          <button type="button" className={btn.outline} onClick={() => setStarting({})} data-testid="return-start">
            <Undo2 className="w-4 h-4" />Return items
          </button>
        )}
      </div>
      {ready.length > 0 && (
        <div className="divide-y border-b">
          {ready.map(l => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-amber-50/70" data-testid="return-ready">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="flex-1 min-w-[180px] text-sm">
                {l.item_name}: {l.receive_status === 'damaged' ? 'damaged' : 'something else came'} on arrival
                {l.receive_note ? ` (${l.receive_note})` : ''}
              </span>
              <button type="button" className={btn.outline} onClick={() => setStarting({ [l.id]: l.prefill })} data-testid="return-ready-start">
                Return it
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="divide-y">
        {data.returns.map(r => <ReturnRow key={r.id} ret={r} onOpen={() => setOpenId(r.id)} />)}
        {!data.returns.length && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Nothing returned. Goods that go back come off stock at once, and the credit note is chased until it comes.
          </p>
        )}
      </div>
      {starting && (
        <StartReturnModal po={po} data={data} prefill={starting} onClose={() => setStarting(null)}
          onSaved={saved => { setStarting(null); changed(); setOpenId(saved.id) }} />
      )}
      {openId && <ReturnModal id={openId} onClose={() => setOpenId(null)} onChanged={changed} />}
    </section>
  )
}

/**
 * Return items: the delivery's lines that can still go back, each ticked
 * with its packs (no more than what is left), why and a note; a note for the
 * supplier; and whether the goods go back now or went back with the
 * delivery. prefill: { po_line_id: { qty, reason, note } } to start ticked.
 */
function StartReturnModal({ po, data, prefill = {}, onClose, onSaved }) {
  const api = useApi()
  const lines = data.lines.filter(l => l.left > 0)
  const [rows, setRows] = useState(() => Object.fromEntries(Object.entries(prefill).map(([id, p]) => [id, { qty: p.qty, reason: p.reason, note: p.note || '' }])))
  const [note, setNote] = useState('')
  const [whenBack, setWhenBack] = useState('now')
  const picked = lines.filter(l => rows[l.id])
  const body = {
    lines: picked.map(l => ({ po_line_id: l.id, qty: rows[l.id].qty, reason: rows[l.id].reason, note: rows[l.id].note.trim() || null })),
    note: note.trim() || null,
    ...(whenBack === 'delivery' && data.received_at ? { returned_at: new Date(data.received_at).toISOString() } : {}),
  }
  const problem = returnLinesProblem(body.lines, lines)
  const totals = data.show_prices ? returnTotals(picked.map(l => ({ qty: rows[l.id].qty, price: l.price, vat_rate: l.vat_rate }))) : null
  const save = useMutation({ mutationFn: () => api.post(`/purchasing/pos/${po.id}/returns`, body), onSuccess: onSaved })
  const toggle = l => setRows(r => {
    const next = { ...r }
    if (next[l.id]) delete next[l.id]
    else next[l.id] = { qty: l.left, reason: l.receive_status === 'substituted' ? 'wrong_item' : 'damaged', note: '' }
    return next
  })
  const set = (id, patch) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))
  return (
    <Modal title={'Return items to ' + po.supplier_name} onClose={onClose}
      footer={(
        <>
          <button type="button" className={btn.primary} disabled={!!problem || save.isPending} onClick={() => save.mutate()} data-testid="return-save">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Return {picked.length ? picked.length + ' line' + (picked.length === 1 ? '' : 's') : 'items'}
          </button>
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
        </>
      )}>
      <p className="text-xs text-muted-foreground">
        What goes back comes off stock at the venue now. Send the return to {po.supplier_name} next, and record their credit note when it comes.
      </p>
      <div className="space-y-2">
        {lines.map(l => {
          const row = rows[l.id]
          return (
            <div key={l.id} className={cn('rounded-lg border p-3 space-y-2', row && 'border-primary/50 bg-primary/5')} data-testid="return-line">
              <button type="button" onClick={() => toggle(l)} aria-pressed={!!row}
                className="w-full flex items-start gap-3 text-left min-h-[48px] touch-manipulation">
                <span className={cn('mt-0.5 w-6 h-6 rounded border flex items-center justify-center shrink-0', row ? 'bg-primary border-primary text-primary-foreground' : 'bg-background')}>
                  {row && <Check className="w-4 h-4" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium">{l.item_name}</span>
                  <span className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                    <CodeTag code={l.supplier_code} />{l.pack_label} · {fmtNum(l.received_qty)} arrived
                    {l.returned_qty ? ` · ${fmtNum(l.returned_qty)} already going back` : ''}
                    {l.receive_status && l.receive_status !== 'ok' ? ` · ${l.receive_status === 'substituted' ? 'something else came' : l.receive_status}` : ''}
                  </span>
                </span>
                {data.show_prices && l.price != null && <span className="text-xs tabular-nums text-muted-foreground shrink-0">{money(l.price)} each</span>}
              </button>
              {row && (
                <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                  <QtyStepper value={row.qty} onChange={v => set(l.id, { qty: v })} max={l.left} label={'Packs of ' + l.item_name + ' going back'} />
                  <select className={inputCls} value={row.reason} onChange={e => set(l.id, { reason: e.target.value })} aria-label={'Why ' + l.item_name + ' goes back'}
                    data-testid="return-reason">
                    {Object.entries(RETURN_REASONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  <input className={cn(inputCls, 'sm:col-span-2')} value={row.note} maxLength={500} onChange={e => set(l.id, { note: e.target.value })}
                    placeholder={row.reason === 'other' ? 'Say why (needed for Other)' : 'A note (optional): crushed box, use by 2 days'} aria-label={'Note on ' + l.item_name} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <Field label="When did it go back?" group>
        <Segmented value={whenBack} onChange={setWhenBack} className="w-full [&>button]:flex-1" testid="return-when"
          options={[{ value: 'now', label: 'Now' }, { value: 'delivery', label: 'With the delivery' }]} />
      </Field>
      <Field label="Note for the supplier (printed on the return)">
        <textarea className={cn(inputCls, 'min-h-[72px] py-2')} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="e.g. The driver took them back" />
      </Field>
      {totals && picked.length > 0 && (
        <p className="text-sm text-right tabular-nums" data-testid="return-expected">Credit expected {money(totals.net)} + VAT {money(totals.vat)}</p>
      )}
      {problem && picked.length > 0 && <p className="text-xs text-amber-800">{problem}.</p>}
      <ErrorNote error={save.error} />
    </Modal>
  )
}

// ── One return ─────────────────────────────────────────────────

/**
 * One return: its lines and what may be done now. mode: what is being
 * filled in (null, 'sent', 'credit', 'refuse'); each saves on its own button.
 */
export function ReturnModal({ id, onClose, onChanged }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data: ret, isLoading, error } = useQuery({ queryKey: ['return', id], queryFn: () => api.get(`/purchasing/returns/${id}`) })
  const [mode, setMode] = useState(null)
  const [via, setVia] = useState('driver')
  const [credit, setCredit] = useState({ number: '', date: null, amount: null })
  const [refuseNote, setRefuseNote] = useState('')
  const [fileErr, setFileErr] = useState(null)
  const done = saved => {
    qc.setQueryData(['return', id], saved)
    setMode(null)
    onChanged?.()
    qc.invalidateQueries({ queryKey: ['returns'] })
    qc.invalidateQueries({ queryKey: ['po-returns'] })
  }
  const act = useMutation({ mutationFn: ({ path, body }) => api.post(`/purchasing/returns/${id}/${path}`, body || {}), onSuccess: done })
  const file = async format => {
    setFileErr(null)
    try {
      if (format === 'html') printHtml(await (await api.blob(`/purchasing/returns/${id}/file?format=html`)).text())
      else await api.download(`/purchasing/returns/${id}/file?format=pdf`, `${ret.label}-${ret.supplier_name.replace(/[^\w-]+/g, '-')}.pdf`)
    } catch (e) { setFileErr(e) }
  }
  const today = useMemo(() => nowAt().date, [])
  if (isLoading || !ret) {
    return (
      <Modal title="Return" onClose={onClose}>
        <ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}
      </Modal>
    )
  }
  const prices = !!ret.show_prices
  const startCredit = () => {
    setCredit({ number: ret.credit_note_number || '', date: ret.credit_note_date || today, amount: prices ? (ret.credit_amount ?? ret.credit_expected ?? null) : null })
    setMode('credit')
  }
  return (
    <Modal title={ret.label + ' to ' + ret.supplier_name} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2" data-testid="return-detail" data-status={ret.status}>
        <ReturnStatusBadge ret={ret} />
        <span className="text-sm text-muted-foreground">From {ret.po_label} · {ret.venue_name}</span>
        {ret.overdue && <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-red-100 text-red-900">Waiting {ret.days_waiting} days for the credit note</span>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Went back</dt><dd>{when(ret.returned_at)}{ret.created_by ? ' · ' + ret.created_by : ''}</dd>
        {ret.sent_at && <><dt className="text-muted-foreground">Sent</dt><dd>{when(ret.sent_at)} · {ret.sent_via_label}{ret.sent_to ? ' to ' + ret.sent_to : ''}</dd></>}
        {ret.credit_note_number && <><dt className="text-muted-foreground">Credit note</dt><dd data-testid="return-credit-note">{ret.credit_note_number}{ret.credit_note_date ? ', ' + fmtDate(ret.credit_note_date) : ''}</dd></>}
        {ret.refuse_note && <><dt className="text-muted-foreground">Refused</dt><dd>{ret.refuse_note}</dd></>}
        {ret.cancelled_at && <><dt className="text-muted-foreground">Cancelled</dt><dd>{when(ret.cancelled_at)}{ret.cancel_note ? ' · ' + ret.cancel_note : ''}</dd></>}
        {ret.note && <><dt className="text-muted-foreground">Note</dt><dd>{ret.note}</dd></>}
      </dl>
      {ret.send_error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Email failed: {ret.send_error}</p>}

      <div className="rounded-lg border divide-y">
        {ret.lines.map(l => (
          <div key={l.id} className="flex items-start gap-3 px-3 py-2" data-testid="return-detail-line">
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium">{l.item_name}</span>
              <span className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                <CodeTag code={l.supplier_code} />{l.pack_label} · {l.reason_label}{l.note ? ': ' + l.note : ''}
              </span>
            </span>
            <span className="text-sm tabular-nums">× {fmtNum(l.qty)}</span>
            {prices && <span className="w-20 text-right text-sm tabular-nums">{money(l.credit_expected)}</span>}
          </div>
        ))}
        {prices && (
          <div className="px-3 py-2 text-sm text-right tabular-nums space-y-0.5" data-testid="return-totals">
            <p>Credit expected {money(ret.credit_expected)} + VAT {money(ret.credit_vat)} = {money(ret.credit_total)}</p>
            {ret.credit_amount != null && (
              <p className={cn(ret.credit_difference != null && Math.abs(ret.credit_difference) >= 0.005 && 'text-amber-800')}>
                Credited {money(ret.credit_amount)}{ret.credit_difference != null && Math.abs(ret.credit_difference) >= 0.005 ? ` (${ret.credit_difference > 0 ? '+' : ''}${money(ret.credit_difference)} against expected)` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {ret.can_email && ret.supplier_email && (
          <button type="button" className={btn.primary} disabled={act.isPending} onClick={() => act.mutate({ path: 'send' })} data-testid="return-email">
            {act.isPending && act.variables?.path === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {ret.status === 'sent' ? 'Email again' : 'Email to ' + ret.supplier_email}
          </button>
        )}
        {ret.can_mark_sent && <button type="button" className={btn.outline} onClick={() => setMode('sent')} data-testid="return-mark-sent"><Send className="w-4 h-4" />Mark as sent</button>}
        {ret.can_credit && <button type="button" className={btn.outline} onClick={startCredit} data-testid="return-credit"><ReceiptText className="w-4 h-4" />{ret.status === 'credited' ? 'Change the credit note' : 'Credit note came'}</button>}
        {ret.can_refuse && <button type="button" className={btn.outline} onClick={() => setMode('refuse')} data-testid="return-refuse"><Ban className="w-4 h-4" />Refused</button>}
        <button type="button" className={btn.ghost} onClick={() => file('pdf')}><FileText className="w-4 h-4" />PDF</button>
        <button type="button" className={btn.ghost} onClick={() => file('html')}><Printer className="w-4 h-4" />Print</button>
      </div>

      {mode === 'sent' && (
        <div className="rounded-lg border p-3 space-y-3" data-testid="return-sent-form">
          <Field label="How did it reach them?">
            <select className={inputCls} value={via} onChange={e => setVia(e.target.value)}>
              {Object.entries(RETURN_SENT_VIA).filter(([k]) => k !== 'email').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              <option value="email">Emailed it myself</option>
            </select>
          </Field>
          <div className="flex gap-2">
            <button type="button" className={btn.primary} disabled={act.isPending} onClick={() => act.mutate({ path: 'mark-sent', body: { via } })} data-testid="return-sent-save">Save</button>
            <button type="button" className={btn.ghost} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
      {mode === 'credit' && (
        <div className="rounded-lg border p-3 space-y-3" data-testid="return-credit-form">
          <Field label="Credit note number">
            <input className={inputCls} value={credit.number} maxLength={100} onChange={e => setCredit(c => ({ ...c, number: e.target.value }))} data-testid="return-credit-number" />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Field label="Dated">
              <DateButton value={credit.date} max={today} onChange={d => setCredit(c => ({ ...c, date: d }))} label="Credit note date" />
            </Field>
            {prices && (
              <Field label="Amount before VAT">
                <NumInput value={credit.amount} onChange={v => setCredit(c => ({ ...c, amount: v }))} className="w-32" aria-label="Credit amount before VAT" data-testid="return-credit-amount" />
              </Field>
            )}
          </div>
          {!prices && <p className="text-xs text-muted-foreground">Someone who sees purchasing prices adds the amount.</p>}
          <div className="flex gap-2">
            <button type="button" className={btn.primary} disabled={act.isPending || !credit.number.trim()} data-testid="return-credit-save"
              onClick={() => act.mutate({ path: 'credit', body: { credit_note_number: credit.number.trim(), credit_note_date: credit.date || null, ...(prices ? { credit_amount: credit.amount } : {}) } })}>
              Save
            </button>
            <button type="button" className={btn.ghost} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
      {mode === 'refuse' && (
        <div className="rounded-lg border p-3 space-y-3" data-testid="return-refuse-form">
          <Field label="Why won't they credit it?" hint="The goods stay off stock: if they are still here, cancel the return instead.">
            <textarea className={cn(inputCls, 'min-h-[72px] py-2')} value={refuseNote} maxLength={500} onChange={e => setRefuseNote(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button type="button" className={btn.primary} disabled={act.isPending || !refuseNote.trim()} onClick={() => act.mutate({ path: 'refuse', body: { note: refuseNote.trim() } })} data-testid="return-refuse-save">Save</button>
            <button type="button" className={btn.ghost} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
      <ErrorNote error={act.error || fileErr} />
      {ret.can_cancel && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Not going back after all? The stock comes back.</span>
          <ConfirmDelete label="Cancel return" confirmLabel="Yes, cancel it" disabled={act.isPending} onConfirm={() => act.mutate({ path: 'cancel', body: {} })} />
        </div>
      )}
    </Modal>
  )
}

// ── The Returns tab ────────────────────────────────────────────

/**
 * The venue's returns: credits still owed (open and sent) first, those
 * waiting CREDIT_OVERDUE_DAYS or more marked, then the rest. openId: a return
 * to open (?return=, Today's link).
 */
export function ReturnsTab({ venueId, openId, onOpen, onClose }) {
  const api = useApi()
  const [show, setShow] = useState('owed')
  const { data, isLoading, error } = useQuery({
    queryKey: ['returns', venueId, show],
    queryFn: () => api.get(`/purchasing/returns?venue_id=${venueId}${show === 'owed' ? '&owed=1' : ''}&limit=200`),
  })
  const list = data?.returns || []
  const overdue = list.filter(r => r.overdue)
  return (
    <div className="space-y-4" data-testid="returns-tab">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={show} onChange={setShow} testid="returns-show"
          options={[{ value: 'owed', label: 'Credit still owed' }, { value: 'all', label: 'All returns' }]} />
        <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
          Start a return from a delivery that was booked in (Deliveries, then the order). A credit note not in after {CREDIT_OVERDUE_DAYS} days shows on Today.
        </p>
      </div>
      <ErrorNote error={error} />
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto my-10 text-muted-foreground" /> : (
        <section className="rounded-xl border bg-background overflow-hidden">
          <div className="section-head px-4 py-2 min-h-[48px] flex items-center gap-2">
            <h3 className="text-sm font-semibold flex-1">{show === 'owed' ? 'Credit still owed' : 'Returns'} <span className="font-normal text-muted-foreground">({list.length})</span></h3>
            {overdue.length > 0 && <span className="text-xs text-red-800">{overdue.length} waiting {CREDIT_OVERDUE_DAYS} days or more</span>}
          </div>
          <div className="divide-y">
            {list.map(r => <ReturnRow key={r.id} ret={r} onOpen={() => onOpen(r.id)} />)}
            {!list.length && <p className="px-4 py-6 text-sm text-muted-foreground text-center">{show === 'owed' ? 'No credit notes owed.' : 'Nothing returned yet.'}</p>}
          </div>
        </section>
      )}
      {openId && <ReturnModal id={openId} onClose={onClose} />}
    </div>
  )
}

export default ReturnsTab
