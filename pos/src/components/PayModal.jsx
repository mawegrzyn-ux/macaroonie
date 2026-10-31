// Taking payment. Card: taken on any card machine and recorded here by hand.
// Card machine (migration 193): the till's own card machine (Store tech) is
// sent the amount through its provider, and the payment is added once the
// machine approves it (payment.added naming the attempt). Split the bill
// evenly, by items, or any amounts. Exact cash and Exact card pay the amount
// in one tap. Once it is all paid, the receipt follows the till's choice
// (receiptModeOf: ask, always print, or don't print).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, CreditCard, Ticket, Wallet, CircleDot, Check, Printer, X, Ban, Split, ListChecks, Nfc, Loader2, AlertTriangle, PenLine } from 'lucide-react'
import { ulid } from '@shared/pos/ids.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { chargeLabel } from '@shared/pos/charges.js'
import { Modal, Keypad, ReasonPicker, cx, money, poundsToPence, useApproval } from './ui.jsx'
import {
  dispatch, dispatchMany, toast, useTill, cardStart, cardCheck, cardCancel, cardSignature, cardTest, cardPayments, cardRefund,
} from '../lib/store.js'
import { receiptModeOf } from '../lib/checkOps.js'

const ICONS = { cash: Banknote, card_external: CreditCard, card_integrated: Nfc, voucher: Ticket, account: Wallet, other: CircleDot }
const CARD_FINAL = ['approved', 'declined', 'cancelled', 'failed']
const WITH_TIP = ['card_external', 'card_integrated', 'other']

const p2s = p => (p / 100).toFixed(2)

/**
 * onClosed() after the check closes. counter: send unsent items to the kitchen
 * as the check closes (counter service pays first).
 */
export default function PayModal({ check, onClose, onClosed, counter = false }) {
  const { config, online } = useTill()
  const approve = useApproval()
  const t = checkTotals(check)
  const machine = config.card_machine || null
  // Card machine only on a till that has one (Store tech, Tills).
  const tenders = (config.settings.tenders || []).filter(x => x.enabled && (x.key !== 'card_integrated' || machine))
  const [amount, setAmount] = useState(p2s(Math.max(0, t.balance)))
  const [tender, setTender] = useState(null)
  const [tendered, setTendered] = useState('')
  const [tip, setTip] = useState('')
  const [ref, setRef] = useState('')
  const [split, setSplit] = useState(null)        // { ways, done }
  const [pickLines, setPickLines] = useState(false)
  const [picked, setPicked] = useState([])
  const [voiding, setVoiding] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidBusy, setVoidBusy] = useState(false)
  // The card machine: null, { starting }, { payment } or { error }.
  const [card, setCard] = useState(null)
  const [unrecorded, setUnrecorded] = useState([])   // approved on the machine, not on the check
  const poll = useRef({ alive: true, timer: null })
  useEffect(() => () => { poll.current.alive = false; clearTimeout(poll.current.timer) }, [])

  const amountP = Math.min(poundsToPence(amount), Math.max(0, t.balance))
  const paidOff = t.balance <= 0
  const receiptMode = receiptModeOf(config)
  // One tap: the amount shown, in cash, or on the card machine (else a card recorded by hand).
  const exactCash = tenders.find(x => x.key === 'cash') || null
  const exactCard = tenders.find(x => x.key === 'card_integrated') || tenders.find(x => x.key === 'card_external') || null

  const evenShare = ways => {
    const left = Math.max(0, t.balance)
    const share = Math.ceil(left / ways)
    return Math.min(share, left)
  }

  const itemsAmount = useMemo(() => {
    if (!picked.length || !t.net) return 0
    const net = t.lines.filter(l => picked.includes(l.id)).reduce((s, l) => s + l.net, 0)
    return Math.round(net * t.total / t.net)
  }, [picked, t])

  const exact = key => {
    if (amountP <= 0) return
    if (key === 'card_integrated') return startCard(0)
    const r = dispatch('payment.added', {
      payment: { id: ulid(), tender: key, amount: amountP, tip: 0, tendered: key === 'cash' ? amountP : null, ref: null },
    }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    afterPayment(r)
  }

  const take = () => {
    if (!tender || amountP <= 0) return
    if (tender === 'card_integrated') return startCard()
    const tipP = WITH_TIP.includes(tender) ? poundsToPence(tip) : 0
    const tenderedP = tender === 'cash' && tendered ? poundsToPence(tendered) : null
    if (tenderedP != null && tenderedP < amountP) return toast('Less cash given than the amount', 'bad')
    const r = dispatch('payment.added', {
      payment: { id: ulid(), tender, amount: amountP, tip: tipP, tendered: tenderedP ?? (tender === 'cash' ? amountP : null), ref: ref.trim() || null },
    }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    const change = tenderedP != null ? tenderedP - amountP : 0
    if (change > 0) toast('Change: ' + money(change), 'ok', 8000)
    afterPayment(r)
  }

  // ── The card machine ──────────────────────────────────────────
  const follow = p => {
    if (!poll.current.alive) return
    clearTimeout(poll.current.timer)
    if (p.status === 'approved') return record(p)
    setCard({ payment: p })
    if (CARD_FINAL.includes(p.status) || p.status === 'signature') return
    poll.current.timer = setTimeout(async () => {
      const r = await cardCheck(p.id)
      follow(r.ok ? r.data : { ...p, message: r.error })
    }, 1500)
  }
  const startCard = async (tipOverride = null) => {
    const tipP = tipOverride ?? poundsToPence(tip)
    setCard({ starting: true })
    const r = await cardStart(check, amountP, tipP)
    if (!poll.current.alive) return
    if (!r.ok) {
      // Busy with a payment this till lost track of: pick it up.
      if (r.code === 'busy' && r.data?.payment_id) {
        const again = await cardCheck(r.data.payment_id)
        if (again.ok && again.data.check_id === check.id) return follow(again.data)
      }
      return setCard({ error: r.error })
    }
    follow(r.payment)
  }
  const record = p => {
    clearTimeout(poll.current.timer)
    const r = dispatch('payment.added', {
      payment: { id: p.payment_id, tender: 'card_integrated', amount: p.amount, tip: p.tip, ref: p.card_text || null, card_payment_id: p.id },
    }, { check_id: check.id })
    if (!r.ok) {
      setCard({ payment: p, recordError: r.error })
      return toast(r.error, 'bad')
    }
    setCard(null)
    setUnrecorded(list => list.filter(x => x.id !== p.id))
    toast('Card approved' + (p.card_text ? ': ' + p.card_text : '') + ' · ' + money(p.amount + p.tip), 'ok', 4000)
    afterPayment(r)
  }
  const answer = async (fn, ...args) => {
    const r = await fn(...args)
    if (!r.ok) return toast(r.error, 'bad')
    follow(r.data)
  }

  // Opened again after a reload or on another till: a payment still on the
  // card machine is followed; one approved but not on the check is offered.
  useEffect(() => {
    if (!machine || online === false) return
    cardPayments(check.id).then(r => {
      if (!r.ok || !poll.current.alive) return
      const onCheck = new Set((check.payments || []).map(x => x.card_payment_id).filter(Boolean))
      const open = r.data.find(p => p.kind === 'sale' && ['pending', 'signature'].includes(p.status))
      if (open) follow(open)
      setUnrecorded(r.data.filter(p => p.kind === 'sale' && p.status === 'approved' && !p.on_check && !onCheck.has(p.id)))
    })
  }, [])

  const afterPayment = r => {
    const nb = checkTotals(r.checks[check.id]).balance
    // All paid and the till doesn't ask: close now, printing or not as set.
    if (nb <= 0 && receiptMode !== 'ask') return close(receiptMode === 'always')
    setTender(null); setTendered(''); setTip(''); setRef(''); setPicked([]); setPickLines(false)
    if (split && nb > 0) {
      const done = split.done + 1
      setSplit({ ...split, done })
      setAmount(p2s(done >= split.ways - 1 ? nb : Math.min(nb, Math.ceil(nb / (split.ways - done)))))
    } else setAmount(p2s(Math.max(0, nb)))
  }

  const close = printReceipt => {
    const specs = []
    if (counter && check.lines.some(l => l.status === 'new')) {
      specs.push(['lines.sent', { send_id: ulid(), line_ids: check.lines.filter(l => l.status === 'new').map(l => l.id), held_course_ids: [] }, { check_id: check.id }])
    }
    specs.push(['check.closed', { print_receipt: !!printReceipt }, { check_id: check.id }])
    const r = dispatchMany(specs)
    if (!r.ok) return toast(r.error, 'bad')
    onClosed()
  }

  const voidPayment = async () => {
    const approver = await approve('void', null, 'Taking a payment off needs a manager.')
    if (approver === false) return
    let cardRefundId = null
    if (voiding.tender === 'card_integrated') {
      // The money goes back to the card first; the payment comes off once it has.
      setVoidBusy(true)
      const back = await cardRefund({ checkId: check.id, salePaymentId: voiding.card_payment_id, amount: voiding.amount + (voiding.tip || 0), approvedBy: approver, purpose: 'void' })
      setVoidBusy(false)
      if (!back.ok) return toast(back.error, 'bad', 7000)
      cardRefundId = back.refund.id
    }
    const r = dispatch('payment.voided', { payment_id: voiding.id, reason: voidReason.trim(), ...(cardRefundId ? { card_refund_id: cardRefundId } : {}) }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    setVoiding(null); setVoidReason('')
    setAmount(p2s(Math.max(0, checkTotals(r.checks[check.id]).balance)))
  }

  const payments = (check.payments || []).filter(p => !p.voided)
  const quickCash = [...new Set([amountP, Math.ceil(amountP / 500) * 500, Math.ceil(amountP / 1000) * 1000, 2000, 5000].filter(x => x >= amountP))].slice(0, 4)
  const tipBase = amountP
  const tipQuick = config.settings.tips_enabled ? [10, 12.5, 15] : []

  return (
    <Modal title={'Pay ' + money(t.total)} onClose={onClose} full>
      <div className="h-full grid md:grid-cols-[1fr_1.2fr] gap-5">
        <div className="space-y-4 min-w-0">
          <div className="card p-4 space-y-1 text-[15px]">
            <div className="flex justify-between"><span>Total</span><b className="tabular-nums">{money(t.total)}</b></div>
            {t.charges.filter(x => x.amount > 0).map(x => (
              <div key={x.id} className="flex justify-between text-muted" data-testid="pay-charge"><span>incl. {chargeLabel(x)}</span><span className="tabular-nums">{money(x.amount)}</span></div>
            ))}
            <div className="flex justify-between text-ok"><span>Paid</span><span className="tabular-nums">{money(t.paid)}</span></div>
            {t.tips > 0 && <div className="flex justify-between text-muted"><span>Tips</span><span className="tabular-nums">{money(t.tips)}</span></div>}
            <div className="flex justify-between text-2xl font-bold pt-1"><span>Left to pay</span><span className="tabular-nums">{money(Math.max(0, t.balance))}</span></div>
          </div>

          {payments.length > 0 && (
            <div className="card divide-y divide-line">
              {payments.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-3">
                  {(() => { const I = ICONS[p.tender] || CircleDot; return <I size={20} className="text-muted" /> })()}
                  <div className="flex-1">
                    <div className="font-semibold">{(config.settings.tenders || []).find(x => x.key === p.tender)?.label || p.tender}{p.change ? ' · change ' + money(p.change) : ''}</div>
                    {(p.tip || (p.tender === 'card_integrated' && p.ref)) ? <div className="text-xs text-muted">{[p.tender === 'card_integrated' ? p.ref : null, p.tip ? 'tip ' + money(p.tip) : null].filter(Boolean).join(' · ')}</div> : null}
                  </div>
                  <div className="font-bold tabular-nums">{money(p.amount)}</div>
                  <button className="btn w-12 px-0 text-bad" onClick={() => { setVoiding(p); setVoidReason('') }} aria-label="Take off"><X size={18} /></button>
                </div>
              ))}
            </div>
          )}
          {voiding && (
            <div className="rounded-xl border-2 border-bad p-4 space-y-3">
              <div className="font-semibold">Take off the {money(voiding.amount)} payment?</div>
              {voiding.tender === 'card_integrated' && <div className="text-sm">The {money(voiding.amount + (voiding.tip || 0))} goes back to the card through the card machine's provider first.</div>}
              <ReasonPicker options={['Wrong amount', 'Wrong card / tender', 'Card declined after all']} value={voidReason} onChange={setVoidReason} />
              <div className="flex gap-2">
                <button className="btn btn-bad" disabled={!voidReason.trim() || voidBusy} onClick={voidPayment} data-testid="pay-void-confirm">
                  {voidBusy ? <Loader2 size={18} className="animate-spin" /> : <Ban size={18} />} {voiding.tender === 'card_integrated' ? 'Refund the card and take it off' : 'Take it off'}
                </button>
                <button className="btn" onClick={() => setVoiding(null)}>Keep it</button>
              </div>
            </div>
          )}

          {!paidOff && (
            <div className="space-y-2">
              <div className="label">Split the bill</div>
              <div className="flex flex-wrap gap-2">
                {[2, 3, 4, 5, 6].map(n => (
                  <button key={n} className={cx('chip', split?.ways === n && 'chip-on')} onClick={() => { setSplit({ ways: n, done: 0 }); setPickLines(false); setAmount(p2s(evenShare(n))) }}>
                    <Split size={14} className="mr-1" />{n} ways
                  </button>
                ))}
                <button className={cx('chip', pickLines && 'chip-on')} onClick={() => { setPickLines(v => !v); setSplit(null); setPicked([]) }}><ListChecks size={14} className="mr-1" />By items</button>
              </div>
              {split && <div className="text-sm text-muted">Part {Math.min(split.done + 1, split.ways)} of {split.ways}: {money(evenShare(split.ways - split.done))}</div>}
              {pickLines && (
                <div className="card divide-y divide-line max-h-64 overflow-y-auto">
                  {check.lines.filter(l => l.status !== 'voided').map(l => {
                    const lt = t.lines.find(x => x.id === l.id)
                    const on = picked.includes(l.id)
                    return (
                      <button key={l.id} className={cx('w-full flex items-center gap-3 p-3 text-left', on && 'bg-brand-soft')}
                        onClick={() => {
                          const next = on ? picked.filter(x => x !== l.id) : [...picked, l.id]
                          setPicked(next)
                          const net = t.lines.filter(x => next.includes(x.id)).reduce((s, x) => s + x.net, 0)
                          setAmount(p2s(Math.min(t.balance, t.net ? Math.round(net * t.total / t.net) : 0)))
                        }}>
                        <span className={cx('w-6 h-6 rounded-md border-2 flex items-center justify-center', on ? 'bg-brand border-brand text-white' : 'border-line')}>{on && <Check size={14} />}</span>
                        <span className="flex-1">{l.qty} x {l.name}{l.seat ? ' (S' + l.seat + ')' : ''}</span>
                        <span className="tabular-nums">{money(lt?.net || 0)}</span>
                      </button>
                    )
                  })}
                  {picked.length > 0 && <div className="p-3 text-sm text-muted">With service charge: {money(itemsAmount)}</div>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0">
          {paidOff ? (
            <div className="h-full flex flex-col items-center justify-center gap-5 text-center">
              <div className="w-20 h-20 rounded-full bg-ok text-white flex items-center justify-center"><Check size={44} /></div>
              <div className="text-3xl font-bold">Paid</div>
              {payments.some(p => p.change) && <div className="text-xl">Change given: <b>{money(payments.reduce((s, p) => s + (p.change || 0), 0))}</b></div>}
              <div className="flex flex-col gap-3 w-full max-w-sm">
                <button className="btn btn-primary h-16 text-lg" onClick={() => close(true)}><Printer size={20} /> Close and print receipt</button>
                <button className="btn h-16 text-lg" onClick={() => close(false)}>Close, no receipt</button>
              </div>
            </div>
          ) : card ? (
            <CardPanel card={card} machine={machine} onCancel={() => answer(cardCancel, card.payment.id)}
              onSignature={ok => answer(cardSignature, card.payment.id, ok)} onTest={result => answer(cardTest, card.payment.id, result)}
              onRetry={() => { setCard(null); startCard(card.payment?.tip ?? null) }} onRecord={() => record(card.payment)}
              onClose={() => setCard(null)} />
          ) : (
            <div className="space-y-4">
              {unrecorded.map(p => (
                <div key={p.id} className="rounded-xl border-2 border-warn p-3 space-y-2" data-testid="pay-card-unrecorded">
                  <div className="font-semibold flex gap-2 items-center"><AlertTriangle size={18} /> {money(p.amount + p.tip)} went through on the card machine{p.card_text ? ' (' + p.card_text + ')' : ''} but isn't on the bill</div>
                  <button className="btn btn-ok" disabled={p.amount > Math.max(0, t.balance)} onClick={() => record(p)}><Check size={18} /> Add it to the bill</button>
                  {p.amount > Math.max(0, t.balance) && <div className="text-xs text-muted">It is more than is left to pay: refund it on the card machine's own app, or take another payment off first.</div>}
                </div>
              ))}
              <div>
                <div className="label">Amount</div>
                <div className="text-4xl font-bold tabular-nums py-2">£{amount || '0'}</div>
              </div>
              {!tender && (exactCash || exactCard) && amountP > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {exactCash && (
                    <button className="btn btn-ok h-16 text-lg" onClick={() => exact('cash')} data-testid="pay-exact-cash">
                      <Banknote size={22} /> Exact cash {money(amountP)}
                    </button>
                  )}
                  {exactCard && (
                    <button className="btn btn-ok h-16 text-lg" disabled={exactCard.key === 'card_integrated' && online === false} onClick={() => exact(exactCard.key)} data-testid="pay-exact-card">
                      {exactCard.key === 'card_integrated' ? <Nfc size={22} /> : <CreditCard size={22} />} Exact card {money(amountP)}
                    </button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {tenders.map(x => {
                  const I = ICONS[x.key] || CircleDot
                  return (
                    <button key={x.key} className={cx('btn h-16 text-lg', tender === x.key && 'btn-primary')} onClick={() => { setTender(x.key); setTendered(''); setTip('') }}>
                      <I size={22} /> {x.label}
                    </button>
                  )
                })}
              </div>

              {!tender && <Keypad value={amount} onChange={setAmount} decimal max={7} />}

              {tender === 'cash' && (
                <div className="space-y-3">
                  <div className="label">Cash given</div>
                  <div className="flex flex-wrap gap-2">
                    {quickCash.map(v => <button key={v} className={cx('chip text-base', poundsToPence(tendered) === v && 'chip-on')} onClick={() => setTendered(p2s(v))}>{money(v)}</button>)}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-bold tabular-nums flex-1">£{tendered || p2s(amountP)}</div>
                    {tendered && poundsToPence(tendered) > amountP && <div className="text-xl font-bold text-ok">Change {money(poundsToPence(tendered) - amountP)}</div>}
                  </div>
                  <Keypad value={tendered} onChange={setTendered} decimal max={7} />
                </div>
              )}

              {WITH_TIP.includes(tender) && (
                <div className="space-y-3">
                  {tender === 'card_external' && <div className="rounded-xl bg-brand-soft p-3 text-[15px]">Take <b>{money(amountP + poundsToPence(tip))}</b> on the card machine, then tap Done.</div>}
                  {tender === 'card_integrated' && <div className="rounded-xl bg-brand-soft p-3 text-[15px]">Sends <b>{money(amountP + poundsToPence(tip))}</b> to {machine?.name || 'the card machine'}. The payment is added when the machine approves it.</div>}
                  {tipQuick.length > 0 && (
                    <div>
                      <div className="label mb-2">Tip</div>
                      <div className="flex flex-wrap gap-2">
                        <button className={cx('chip', !tip && 'chip-on')} onClick={() => setTip('')}>No tip</button>
                        {tipQuick.map(pct => {
                          const v = Math.round(tipBase * pct / 100)
                          return <button key={pct} className={cx('chip', poundsToPence(tip) === v && 'chip-on')} onClick={() => setTip(p2s(v))}>{pct}% {money(v)}</button>
                        })}
                      </div>
                      <div className="mt-2 max-w-[280px]"><input className="input" inputMode="decimal" placeholder="Other tip £" value={tip} onChange={e => setTip(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
                    </div>
                  )}
                  {tender !== 'card_integrated' && <input className="input" placeholder="Reference (optional, e.g. last 4 digits)" value={ref} onChange={e => setRef(e.target.value)} maxLength={60} />}
                </div>
              )}

              {(tender === 'voucher' || tender === 'account') && (
                <input className="input" placeholder={tender === 'voucher' ? 'Voucher number' : 'Account / name'} value={ref} onChange={e => setRef(e.target.value)} maxLength={60} />
              )}

              {tender && (
                <div className="flex gap-2">
                  <button className="btn" onClick={() => setTender(null)}>Change amount</button>
                  {tender === 'card_integrated' ? (
                    <button className="btn btn-ok flex-1 h-16 text-lg" disabled={amountP <= 0 || online === false} onClick={take} data-testid="pay-card-send">
                      <Nfc size={22} /> {online === false ? 'Needs a connection' : 'Send to the card machine: ' + money(amountP + poundsToPence(tip))}
                    </button>
                  ) : (
                    <button className="btn btn-ok flex-1 h-16 text-lg" disabled={amountP <= 0} onClick={take}>
                      <Check size={22} /> Done: {money(amountP)}{tender === 'cash' && tendered && poundsToPence(tendered) > amountP ? ' (change ' + money(poundsToPence(tendered) - amountP) + ')' : ''}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** The card machine at work: waiting, the signature check, how it ended. */
function CardPanel({ card, machine, onCancel, onSignature, onTest, onRetry, onRecord, onClose }) {
  const p = card.payment
  const total = p ? p.amount + p.tip : 0
  if (card.starting) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center" data-testid="pay-card-panel">
        <Loader2 size={48} className="animate-spin text-brand" />
        <div className="text-xl font-semibold">Sending to {machine?.name || 'the card machine'}…</div>
      </div>
    )
  }
  if (card.error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center" data-testid="pay-card-panel">
        <AlertTriangle size={48} className="text-bad" />
        <div className="text-xl font-semibold" data-testid="pay-card-error">{card.error}</div>
        <div className="flex gap-2"><button className="btn btn-primary" onClick={onRetry}>Try again</button><button className="btn" onClick={onClose}>Another way to pay</button></div>
      </div>
    )
  }
  const ended = ['declined', 'cancelled', 'failed'].includes(p.status)
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-center" data-testid="pay-card-panel">
      <div className="text-muted">{machine?.name || 'Card machine'}</div>
      <div className="text-4xl font-bold tabular-nums">{money(total)}</div>
      {p.tip > 0 && <div className="text-sm text-muted">incl. tip {money(p.tip)}</div>}
      {p.status === 'approved' && card.recordError ? (
        <>
          <div className="text-xl font-semibold text-ok">Approved{p.card_text ? ': ' + p.card_text : ''}</div>
          <div className="text-bad">{card.recordError}</div>
          <button className="btn btn-ok h-14" onClick={onRecord}><Check size={20} /> Add it to the bill</button>
        </>
      ) : p.status === 'signature' ? (
        <>
          <PenLine size={44} className="text-warn" />
          <div className="text-xl font-semibold" data-testid="pay-card-state">Check the signature on the slip against the card</div>
          <div className="flex gap-2">
            <button className="btn btn-ok h-14" onClick={() => onSignature(true)} data-testid="pay-card-sig-ok">Signature matches</button>
            <button className="btn btn-bad h-14" onClick={() => onSignature(false)}>It doesn't match</button>
          </div>
        </>
      ) : ended ? (
        <>
          <AlertTriangle size={44} className="text-bad" />
          <div className="text-xl font-semibold" data-testid="pay-card-state">{p.status === 'declined' ? 'Declined' : p.status === 'cancelled' ? 'Cancelled' : 'It didn\'t go through'}</div>
          {p.message && <div className="text-muted">{p.message}</div>}
          <div className="flex gap-2"><button className="btn btn-primary h-14" onClick={onRetry} data-testid="pay-card-retry">Try again</button><button className="btn h-14" onClick={onClose}>Another way to pay</button></div>
        </>
      ) : (
        <>
          <Loader2 size={44} className="animate-spin text-brand" />
          <div className="text-xl font-semibold" data-testid="pay-card-state">Waiting for the card</div>
          {p.message && <div className="text-sm text-muted">{p.message}</div>}
          {machine?.can_simulate && (
            <div className="rounded-xl border p-3 space-y-2">
              <div className="text-xs text-muted">Test card machine: no money is taken</div>
              <div className="flex gap-2">
                <button className="btn btn-ok" onClick={() => onTest('approve')} data-testid="pay-card-test-approve"><Check size={18} /> Approve (test)</button>
                <button className="btn" onClick={() => onTest('decline')} data-testid="pay-card-test-decline">Decline (test)</button>
              </div>
            </div>
          )}
          <button className="btn h-14" onClick={onCancel} data-testid="pay-card-cancel"><X size={18} /> Cancel on the card machine</button>
        </>
      )}
    </div>
  )
}
