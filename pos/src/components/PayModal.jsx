// Taking payment. Card payments are taken on the venue's card machine and
// recorded here (integrated card machines come later through one payment
// adapter: docs/POS.md). Split the bill evenly, by items, or any amounts.

import { useMemo, useState } from 'react'
import { Banknote, CreditCard, Ticket, Wallet, CircleDot, Check, Printer, X, Ban, Split, ListChecks } from 'lucide-react'
import { ulid } from '@shared/pos/ids.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { Modal, Keypad, ReasonPicker, cx, money, poundsToPence, useApproval } from './ui.jsx'
import { dispatch, dispatchMany, toast, useTill } from '../lib/store.js'

const ICONS = { cash: Banknote, card_external: CreditCard, voucher: Ticket, account: Wallet, other: CircleDot }

const p2s = p => (p / 100).toFixed(2)

/**
 * onClosed() after the check closes. counter: send unsent items to the kitchen
 * as the check closes (counter service pays first).
 */
export default function PayModal({ check, onClose, onClosed, counter = false }) {
  const { config } = useTill()
  const approve = useApproval()
  const t = checkTotals(check)
  const tenders = (config.settings.tenders || []).filter(x => x.enabled)
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

  const amountP = Math.min(poundsToPence(amount), Math.max(0, t.balance))
  const paidOff = t.balance <= 0

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

  const take = () => {
    if (!tender || amountP <= 0) return
    const tipP = tender === 'card_external' || tender === 'other' ? poundsToPence(tip) : 0
    const tenderedP = tender === 'cash' && tendered ? poundsToPence(tendered) : null
    if (tenderedP != null && tenderedP < amountP) return toast('Less cash given than the amount', 'bad')
    const r = dispatch('payment.added', {
      payment: { id: ulid(), tender, amount: amountP, tip: tipP, tendered: tenderedP ?? (tender === 'cash' ? amountP : null), ref: ref.trim() || null },
    }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    const change = tenderedP != null ? tenderedP - amountP : 0
    if (change > 0) toast('Change: ' + money(change), 'ok', 8000)
    const nb = checkTotals(r.checks[check.id]).balance
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
    const r = dispatch('payment.voided', { payment_id: voiding.id, reason: voidReason.trim() }, { check_id: check.id, approved_by: approver })
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
            {t.service_charge > 0 && <div className="flex justify-between text-muted"><span>incl. service charge</span><span className="tabular-nums">{money(t.service_charge)}</span></div>}
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
                    <div className="font-semibold">{tenders.find(x => x.key === p.tender)?.label || p.tender}{p.change ? ' · change ' + money(p.change) : ''}</div>
                    {p.tip ? <div className="text-xs text-muted">tip {money(p.tip)}</div> : null}
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
              <ReasonPicker options={['Wrong amount', 'Wrong card / tender', 'Card declined after all']} value={voidReason} onChange={setVoidReason} />
              <div className="flex gap-2">
                <button className="btn btn-bad" disabled={!voidReason.trim()} onClick={voidPayment}><Ban size={18} /> Take it off</button>
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
          ) : (
            <div className="space-y-4">
              <div>
                <div className="label">Amount</div>
                <div className="text-4xl font-bold tabular-nums py-2">£{amount || '0'}</div>
              </div>
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

              {(tender === 'card_external' || tender === 'other') && (
                <div className="space-y-3">
                  {tender === 'card_external' && <div className="rounded-xl bg-brand-soft p-3 text-[15px]">Take <b>{money(amountP + poundsToPence(tip))}</b> on the card machine, then tap Done.</div>}
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
                  <input className="input" placeholder="Reference (optional, e.g. last 4 digits)" value={ref} onChange={e => setRef(e.target.value)} maxLength={60} />
                </div>
              )}

              {(tender === 'voucher' || tender === 'account') && (
                <input className="input" placeholder={tender === 'voucher' ? 'Voucher number' : 'Account / name'} value={ref} onChange={e => setRef(e.target.value)} maxLength={60} />
              )}

              {tender && (
                <div className="flex gap-2">
                  <button className="btn" onClick={() => setTender(null)}>Change amount</button>
                  <button className="btn btn-ok flex-1 h-16 text-lg" disabled={amountP <= 0} onClick={take}>
                    <Check size={22} /> Done: {money(amountP)}{tender === 'cash' && tendered && poundsToPence(tendered) > amountP ? ' (change ' + money(poundsToPence(tendered) - amountP) + ')' : ''}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
