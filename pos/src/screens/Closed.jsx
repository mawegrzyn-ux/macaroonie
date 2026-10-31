// Closed checks: look one up, print the receipt again, reopen it, or give a
// refund. Today's are on the till; older ones come from Macaroonie.

import { useEffect, useMemo, useState } from 'react'
import { Printer, RotateCcw, Undo2, Search, RefreshCw, Loader2 } from 'lucide-react'
import { ulid } from '@shared/pos/ids.js'
import { checkTotals, modifierText, groupModifiers } from '@shared/pos/pricing.js'
import { checkLabel, TENDERS } from '@shared/pos/checks.js'
import { numberText } from '@shared/pos/numbers.js'
import { useTill, useChecks, dispatch, toast, printBill, server, loadCheck, cardRefund, serverName } from '../lib/store.js'
import { Modal, Keypad, ReasonPicker, cx, money, poundsToPence, useApproval } from '../components/ui.jsx'

export default function Closed() {
  const { config, online } = useTill()
  const checks = useChecks()
  const [remote, setRemote] = useState([])
  const [selected, setSelected] = useState(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    try { setRemote(await server.closedChecks()) } catch { /* offline: today's are local */ }
    setBusy(false)
  }
  useEffect(() => { load() }, [])

  const list = useMemo(() => {
    const local = Object.values(checks).filter(c => c.status === 'closed' || c.status === 'void')
    const ids = new Set(local.map(c => c.id))
    const rows = [
      ...local.map(c => ({ id: c.id, number: c.number, number_code: c.number_code, order_no: c.order_no, table_id: c.table_id, tab_name: c.tab_name, closed_at: c.closed_at, total: checkTotals(c).total, status: c.status, cancelled: !!c.cancelled, local: true })),
      ...remote.filter(r => !ids.has(r.id)),
    ].sort((a, b) => String(b.closed_at || '').localeCompare(String(a.closed_at || '')))
    const term = q.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(r => checkLabel(r).toLowerCase().includes(term) || (numberText(r) || '').toLowerCase().includes(term) || (r.tab_name || '').toLowerCase().includes(term)
      || ((config.tables || []).find(t => t.id === r.table_id)?.label || '').toLowerCase() === term)
  }, [checks, remote, q, config])

  const open = async row => {
    if (!checks[row.id]) {
      try { await loadCheck(row.id) } catch { return toast(online ? 'Could not load that check' : 'Offline: only today\'s checks are on this till', 'bad') }
    }
    setSelected(row.id)
  }
  const check = selected ? checks[selected] : null

  return (
    <div className="h-full flex">
      <div className="w-[380px] shrink-0 border-r border-line bg-white flex flex-col">
        <div className="p-3 flex gap-2 border-b border-line">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-10" placeholder="Check no., table or name" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <button className="btn w-12 px-0" onClick={load} disabled={busy} aria-label="Refresh"><RefreshCw size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-line">
          {list.map(r => {
            const table = (config.tables || []).find(t => t.id === r.table_id)
            return (
              <button key={r.id} className={cx('w-full p-3 flex items-center gap-3 text-left', selected === r.id && 'bg-brand-soft')} onClick={() => open(r)}>
                <div className="w-16 font-bold">{checkLabel(r)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{table ? 'Table ' + table.label : r.tab_name || 'Tab'}{r.status === 'void' ? (r.cancelled ? ' (cancelled)' : ' (empty)') : ''}</div>
                  <div className="text-xs text-muted">{r.closed_at ? new Date(r.closed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                </div>
                <div className="font-bold tabular-nums">{money(r.total)}</div>
              </button>
            )
          })}
          {!list.length && <div className="p-6 text-muted text-center">No closed checks.</div>}
        </div>
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto p-5">
        {check ? <ClosedDetail check={check} config={config} /> : <div className="text-muted">Pick a check.</div>}
      </div>
    </div>
  )
}

function ClosedDetail({ check, config }) {
  const approve = useApproval()
  const [mode, setMode] = useState(null)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [tender, setTender] = useState('cash')
  const t = checkTotals(check)
  const table = (config.tables || []).find(x => x.id === check.table_id)
  const reopen = async () => {
    const approver = await approve('reopen', null, 'Reopening a closed check needs a manager.')
    if (approver === false) return
    const r = dispatch('check.reopened', { reason: reason.trim() }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    toast('Reopened: find it on the floor or in Counter', 'ok')
    setMode(null)
  }
  // Card machine payments on this check: a refund to the card goes back through its provider.
  const cardSales = (check.payments || []).filter(p => !p.voided && p.tender === 'card_integrated' && p.card_payment_id)
  const [sale, setSale] = useState(null)
  const [busy, setBusy] = useState(false)
  const refund = async () => {
    const approver = await approve('refund', null, 'Refunds need a manager.', ['refund'])
    if (approver === false) return
    let cardRefundId = null
    if (tender === 'card_integrated') {
      const from = cardSales.find(p => p.id === sale) || cardSales[0]
      if (!from) return toast('There is no card machine payment on this check', 'bad')
      setBusy(true)
      const back = await cardRefund({ checkId: check.id, salePaymentId: from.card_payment_id, amount: poundsToPence(amount), approvedBy: approver })
      setBusy(false)
      if (!back.ok) return toast(back.error, 'bad', 7000)
      cardRefundId = back.refund.id
    }
    const r = dispatch('refund.added', { refund: { id: ulid(), tender, amount: poundsToPence(amount), reason: reason.trim(), ...(cardRefundId ? { card_refund_id: cardRefundId } : {}) } }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    toast((cardRefundId ? 'Refunded to the card: ' : 'Refunded ') + money(poundsToPence(amount)), 'ok')
    setMode(null)
  }
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-2xl font-bold flex-1">Check {checkLabel(check)} · {table ? 'Table ' + table.label : check.tab_name || 'Tab'}</div>
        <button className="btn" onClick={() => printBill(check)}><Printer size={18} /> Receipt</button>
        {check.status === 'closed' && <>
          <button className="btn" onClick={() => { setMode('reopen'); setReason('') }}><RotateCcw size={18} /> Reopen</button>
          <button className="btn" onClick={() => { setMode('refund'); setReason(''); setAmount((Math.max(0, t.paid - t.refunded) / 100).toFixed(2)) }}><Undo2 size={18} /> Refund</button>
        </>}
        {check.status === 'open' && <div className="chip chip-on">Open again</div>}
      </div>
      {check.status === 'void' && check.cancelled && (
        <div className="rounded-xl bg-bad-soft text-bad p-3 font-semibold" data-testid="closed-cancelled">
          Order cancelled: {check.cancelled.reason}{check.cancelled.approved_by ? ' · approved by ' + serverName(config, check.cancelled.approved_by) : ''}
        </div>
      )}
      {mode === 'reopen' && (
        <div className="card p-4 space-y-3 border-warn border-2">
          <div className="font-semibold">Reopen check {checkLabel(check)}?</div>
          <ReasonPicker options={['Missed an item', 'Wrong payment', 'Guest came back']} value={reason} onChange={setReason} />
          <div className="flex gap-2"><button className="btn btn-warn" disabled={!reason.trim()} onClick={reopen}>Reopen</button><button className="btn" onClick={() => setMode(null)}>Cancel</button></div>
        </div>
      )}
      {mode === 'refund' && (
        <div className="card p-4 space-y-3 border-bad border-2">
          <div className="font-semibold">Refund on check {checkLabel(check)} (paid {money(t.paid)}{t.refunded ? ', refunded ' + money(t.refunded) : ''})</div>
          <div className="flex gap-2 flex-wrap">
            {TENDERS.filter(x => (config.settings.tenders || []).find(y => y.key === x.key)?.enabled && (x.key !== 'card_integrated' || cardSales.length)).map(x => (
              <button key={x.key} className={cx('chip', tender === x.key && 'chip-on')} onClick={() => setTender(x.key)} data-testid={'refund-tender-' + x.key}>{(config.settings.tenders || []).find(y => y.key === x.key)?.label || x.label}</button>
            ))}
          </div>
          {tender === 'card_integrated' && (
            <div className="space-y-2">
              <div className="text-sm">The money goes back to the card the guest paid with, through the card machine's provider.</div>
              {cardSales.length > 1 && (
                <div className="flex gap-2 flex-wrap">
                  {cardSales.map(p => (
                    <button key={p.id} className={cx('chip', (sale || cardSales[0].id) === p.id && 'chip-on')} onClick={() => setSale(p.id)}>{p.ref || 'Card'} · {money(p.amount + (p.tip || 0))}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-3xl font-bold tabular-nums">£{amount || '0'}</div>
              <ReasonPicker options={['Food quality', 'Overcharged', 'Item not served']} value={reason} onChange={setReason} />
            </div>
            <Keypad value={amount} onChange={setAmount} decimal max={7} />
          </div>
          <div className="flex gap-2"><button className="btn btn-bad" disabled={!reason.trim() || !poundsToPence(amount) || busy} onClick={refund} data-testid="refund-confirm">{busy ? <Loader2 size={18} className="animate-spin" /> : <Undo2 size={18} />} Refund {money(poundsToPence(amount))}{tender === 'card_integrated' ? ' to the card' : ''}</button><button className="btn" onClick={() => setMode(null)}>Cancel</button></div>
        </div>
      )}
      <div className="card divide-y divide-line">
        {check.lines.map(l => (
          <div key={l.id} className={cx('p-3 flex gap-3', l.status === 'voided' && 'opacity-50 line-through')}>
            <div className="w-8 font-bold">{l.qty}</div>
            <div className="flex-1">{l.name}<div className="text-sm text-muted">{groupModifiers(l.modifiers).map(modifierText).join(', ')}</div></div>
          </div>
        ))}
      </div>
      <div className="card p-4 space-y-1">
        <div className="flex justify-between"><span>Total</span><b>{money(t.total)}</b></div>
        {(check.payments || []).filter(p => !p.voided).map(p => (
          <div key={p.id} className="flex justify-between text-sm"><span>{TENDERS.find(x => x.key === p.tender)?.label}{p.tender === 'card_integrated' && p.ref ? ' · ' + p.ref : ''}{p.tip ? ' (tip ' + money(p.tip) + ')' : ''}</span><span>{money(p.amount)}</span></div>
        ))}
        {(check.refunds || []).map(r => (
          <div key={r.id} className="flex justify-between text-sm text-bad"><span>Refund · {r.reason}</span><span>−{money(r.amount)}</span></div>
        ))}
      </div>
    </div>
  )
}
