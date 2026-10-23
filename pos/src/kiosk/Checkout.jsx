// The kiosk's way from the order to the order number: the basket (change
// quantities, edit, offers that apply, "Anything else?"), the guest's name
// and table number when the order type asks for them (Till setup > revenue
// streams), how to pay, the card reader, sending, and the order number.

import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, Pencil, Trash2, CreditCard, Store, Printer, Check, AlertTriangle, ShoppingBag } from 'lucide-react'
import { lineGross, groupModifiers } from '@shared/pos/pricing.js'
import { countParts } from '@shared/combos.js'
import { configItem, comboCtx } from '@shared/pos/offers.js'
import { TK, pickImages } from '@shared/kiosk.js'
import {
  useKiosk, textsFor, go, openBuilder, setQty, addToBasket, setDetails, placeOrder, methods, restart, soldOut, printResultReceipt,
  getState as getFresh, cardStart, cardCheck, cardCancel, cardTest, setCardWaiting,
} from './store.js'
import { ulid } from '@shared/pos/ids.js'
import { cx, Photo, PickPhoto, Keyboard, NumberPad, BackButton, usePortrait } from './parts.jsx'
import { TopBar, useBasketTotals, RestartButton, LanguageButton } from './Menu.jsx'
import { priceLabel } from './Builder.jsx'

// ── Where the order goes next ───────────────────────────────────

function promptsFor(s) {
  const ty = (s.config.order_types || []).find(x => x.id === s.orderType)
  return { ask_name: ty?.ask_name || 'off', ask_tent: ty?.ask_tent || 'off' }
}

export function toPayment(s) {
  const m = methods(s.config)
  if (m.length > 1) return go('pay')
  if (m[0] === 'card') return go('card')
  return placeOrder('counter')
}

export function afterBasket(s) {
  const p = promptsFor(s)
  if (p.ask_name !== 'off') return go('details', { detailStep: 'name' })
  if (p.ask_tent !== 'off') return go('details', { detailStep: 'tent' })
  return toPayment(s)
}

// ── Lines in the guest's language ───────────────────────────────

function modText(m, itemId, texts) {
  const label = m.group_id === 'variants' ? texts.t(TK.variant(itemId, m.label), m.label) : texts.t(TK.option(m.option_id, 'label'), m.label)
  return (m.count > 1 ? m.count + ' x ' : '') + label
}

function LineDetail({ line, texts }) {
  const mods = groupModifiers(line.modifiers || [])
  const parts = countParts(line.combo || [])
  return (
    <div className="k-muted text-[.85em] flex flex-col">
      {mods.map((m, i) => <span key={i} style={{ paddingLeft: (m.depth || 0) + 'em' }}>{modText(m, line.item_id, texts)}</span>)}
      {parts.map(({ part, count }, i) => {
        const name = part.item_id ? texts.t(TK.item(part.item_id, 'name'), part.name) : texts.t(TK.choice(line.item_id, part.option_id), part.name)
        const pm = groupModifiers(part.modifiers || [])
        return (
          <span key={i}>
            {(count > 1 ? count + ' x ' : '') + name}
            {pm.length > 0 && <span> ({pm.map(m => modText(m, part.item_id, texts)).join(', ')})</span>}
          </span>
        )
      })}
    </div>
  )
}

// ── Basket ──────────────────────────────────────────────────────

export function Basket() {
  const s = useKiosk()
  const { config } = s
  const texts = textsFor(s)
  const { ui, money } = texts
  const ctx = useMemo(() => comboCtx(config), [config])
  const { totals, check, error } = useBasketTotals(s)
  const sold = soldOut(config)
  const inBasket = new Set(s.basket.map(e => e.item_id))
  const upsell = config.design.checkout.upsell
    ? config.design.checkout.upsell_item_ids.map(id => configItem(config, id)).filter(it => it && !sold.has(it.id) && !inBasket.has(it.id))
    : []
  const upsellTitle = config.design.checkout.upsell_title ? texts.t(TK.design(config.design.id, 'upsell_title'), config.design.checkout.upsell_title) : ui('anything_else')
  const offers = (totals?.discounts || []).filter(d => d.amount > 0)
  const offerName = d => (d.combo ? texts.t(TK.item(d.id, 'name'), d.name) : d.name)
  const portrait = usePortrait()
  const upsellBlock = upsell.length > 0 && (
    <div className="flex flex-col gap-[var(--k-gap)]" data-testid="k-upsell">
      <h3 className="k-head text-[1.5em] m-0">{upsellTitle}</h3>
      <div className={portrait ? 'k-hscroll flex gap-[var(--k-gap)] pb-[.4em]' : 'grid grid-cols-2 gap-[var(--k-gap)]'}>
        {upsell.map(it => (
          <button key={it.id} className={cx('k-card k-item', portrait && 'shrink-0 w-[min(34vmin,230px)]')} data-testid="k-upsell-item"
            onClick={() => {
              if (it.kind === 'combo' || (it.pos_choices || []).length) openBuilder(it.id)
              else addToBasket({ item_id: it.id, selection: {}, qty: 1 })
            }}>
            <Photo src={it.image_url} label={texts.itemName(it)} className="k-item-img" phClassName="k-item-ph" />
            <span className="k-item-body">
              <span className="k-head">{texts.itemName(it)}</span>
              <span className="flex items-center justify-between gap-[.4em]">
                <span className="k-price">{priceLabel(it, config, ctx, texts)}</span>
                <span className="k-plus"><Plus /></span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
  const totalsBlock = totals && (
    <div className="k-card p-[var(--k-pad)] flex flex-col gap-[.4em]" data-testid="k-totals">
      {offers.length > 0 && (
        <>
          <div className="flex justify-between"><span>{ui('subtotal')}</span><span>{money(totals.subtotal)}</span></div>
          {offers.map(d => (
            <div key={d.id} className="flex justify-between text-[var(--k-primary)] font-semibold" data-testid="k-offer">
              <span>{offerName(d)}</span><span>-{money(d.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-[var(--k-primary)] font-bold"><span>{ui('you_save')}</span><span>{money(totals.discount)}</span></div>
        </>
      )}
      <div className="flex justify-between k-head text-[1.6em]"><span>{ui('total')}</span><span data-testid="k-total">{money(totals.total)}</span></div>
    </div>
  )
  // Portrait: one column. Landscape: the order on the left, total and
  // "Anything else?" in a column of their own on the right.
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="k-basket">
      <TopBar texts={texts} config={config} />
      <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 min-h-0 k-scroll p-[var(--k-pad)] flex flex-col gap-[var(--k-gap)]">
        <h2 className="k-head text-[2.2em] m-0">{ui('your_order')}</h2>
        {!s.basket.length && <div className="k-card p-[var(--k-pad)] text-center k-muted">{ui('empty_order')}</div>}
        {s.basket.map((e, i) => {
          const it = configItem(config, e.item_id)
          const line = check?.lines?.[i]
          if (!it) return null
          return (
            <div key={e.key} className="k-card p-[.7em] flex gap-[.8em] items-start" data-testid="k-line">
              <span className="k-thumb w-[4.6em] h-[4.6em] shrink-0 rounded-[calc(var(--k-radius)/1.5)] overflow-hidden">
                <PickPhoto picks={pickImages(config, it, e.selection)} src={it.image_url} label={texts.itemName(it)} className="w-full h-full object-cover"
                  phClassName="k-item-ph h-full aspect-auto text-[1.2em]" splitClassName="w-full h-full" />
              </span>
              <div className="flex-1 min-w-0 flex flex-col gap-[.3em]">
                <div className="flex items-start gap-[.6em]">
                  <span className="k-head text-[1.15em] flex-1">{texts.itemName(it)}</span>
                  <span className="k-price">{line ? money(lineGross(line)) : ''}</span>
                </div>
                {line && <LineDetail line={line} texts={texts} />}
                <div className="flex items-center gap-[.5em] flex-wrap mt-[.2em]">
                  <button className="k-btn k-btn-round" onClick={() => setQty(e.key, e.qty - 1)} aria-label={e.qty > 1 ? ui('one_less') : ui('remove')} data-testid="k-line-less">
                    {e.qty > 1 ? <Minus /> : <Trash2 />}
                  </button>
                  <span className="k-head text-[1.3em] w-[1.6em] text-center tabular-nums">{e.qty}</span>
                  <button className="k-btn k-btn-round" onClick={() => setQty(e.key, e.qty + 1)} aria-label={ui('one_more')} data-testid="k-line-more"><Plus /></button>
                  {(it.kind === 'combo' || (it.pos_choices || []).length > 0) && (
                    <button className="k-btn k-btn-ghost ml-auto" onClick={() => openBuilder(it.id, e)} data-testid="k-line-edit"><Pencil /> {ui('edit')}</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {error && <div className="k-card p-[.8em] flex gap-[.6em] items-center"><AlertTriangle /> {error}</div>}
        {portrait && upsellBlock && <div className="mt-[var(--k-gap)]">{upsellBlock}</div>}
        {portrait && totalsBlock && <div className="mt-[var(--k-gap)]">{totalsBlock}</div>}
      </div>
      {!portrait && (totalsBlock || upsellBlock) && (
        <aside className="w-[38%] max-w-[560px] shrink-0 k-scroll p-[var(--k-pad)] flex flex-col gap-[var(--k-pad)] bg-[var(--k-surface)] border-l-2 border-[var(--k-line)]">
          {totalsBlock}
          {upsellBlock}
        </aside>
      )}
      </div>
      <div className="k-bar shrink-0">
        <BackButton onClick={() => go('menu')} label={ui('add_more')} testId="k-add-more" />
        <RestartButton s={s} texts={texts} />
        {!config.design.layout.header && <LanguageButton config={config} texts={texts} onBar />}
        <div className="flex-1" />
        <button className="k-btn k-btn-accent k-btn-big" disabled={!s.basket.length || !!error} onClick={() => afterBasket(s)} data-testid="k-checkout">
          {ui('checkout')}{totals ? ' · ' + money(totals.total) : ''}
        </button>
      </div>
    </div>
  )
}

// ── Name and tent (or table) number ─────────────────────────────

export function Details() {
  const s = useKiosk()
  const texts = textsFor(s)
  const { ui } = texts
  const p = promptsFor(s)
  const step = s.detailStep || 'name'
  const isName = step === 'name'
  const need = isName ? p.ask_name : p.ask_tent
  const value = isName ? s.details.name : s.details.tent
  const next = () => {
    if (isName && p.ask_tent !== 'off') return go('details', { detailStep: 'tent' })
    return toPayment(getFresh())
  }
  const back = () => (!isName && p.ask_name !== 'off' ? go('details', { detailStep: 'name' }) : go('basket'))
  const ok = need !== 'required' || value.trim().length > 0
  const tent = s.config.design.checkout.number_kind !== 'table'
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="k-details" data-step={step}>
      <div className="flex-1 min-h-0 k-scroll p-[var(--k-pad)] flex flex-col">
        <div className="m-auto w-full flex flex-col items-center gap-[var(--k-pad)]">
          <h2 className="k-head text-[2.2em] m-0 text-center">{isName ? ui('your_name') : ui(tent ? 'tent_number' : 'table_number')}</h2>
          <div className="k-muted text-center max-w-[760px]" data-testid="k-details-hint">{isName ? ui('name_hint') : ui(tent ? 'tent_hint' : 'table_hint')}</div>
          <div className={cx('k-card w-full min-h-[2.4em] px-[.6em] flex items-center justify-center k-head text-[2.2em]', isName ? 'max-w-[720px]' : 'max-w-[11em]')} data-testid="k-details-value">
            <span data-testid="k-details-text">{value}</span><span className="k-caret" aria-hidden="true" />
          </div>
          <div className="w-full max-w-[1000px]">
            {isName
              ? <Keyboard value={value} onChange={v => setDetails({ name: v })} lang={texts.lang} labels={{ space: ui('space'), delete: ui('remove') }} />
              : <NumberPad value={value} onChange={v => setDetails({ tent: v })} labels={{ clear: ui('clear'), delete: ui('remove') }} />}
          </div>
        </div>
      </div>
      <div className="k-bar shrink-0">
        <BackButton onClick={back} label={ui('back')} />
        <RestartButton s={s} texts={texts} />
        <div className="flex-1" />
        {need === 'ask' && <button className="k-btn k-btn-big" style={{ background: 'transparent', color: 'inherit' }} onClick={() => { setDetails(isName ? { name: '' } : { tent: '' }); next() }} data-testid="k-details-skip">{ui('skip')}</button>}
        <button className="k-btn k-btn-accent k-btn-big" disabled={!ok} onClick={next} data-testid="k-details-next">{ui('next')}</button>
      </div>
    </div>
  )
}

// ── How to pay ──────────────────────────────────────────────────

export function Pay() {
  const s = useKiosk()
  const texts = textsFor(s)
  const { ui, money } = texts
  const { totals } = useBasketTotals(s)
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="k-pay">
      <div className="flex-1 min-h-0 k-scroll p-[var(--k-pad)] flex flex-col items-center justify-center gap-[calc(var(--k-pad)*1.4)]">
        <h2 className="k-head text-[2.2em] m-0 text-center">{ui('how_to_pay')}</h2>
        <div className="k-head text-[2.6em]">{totals ? money(totals.total) : ''}</div>
        <div className="grid grid-cols-2 gap-[var(--k-pad)] w-full max-w-[900px]">
          <button className="k-card flex flex-col items-center gap-[.6em] p-[calc(var(--k-pad)*1.4)] border-0" style={{ background: 'var(--k-primary)', color: 'var(--k-primary-text)' }}
            onClick={() => go('card')} data-testid="k-pay-card">
            <CreditCard size={72} strokeWidth={1.4} />
            <span className="k-head text-[1.5em]">{ui('pay_card')}</span>
            <span>{ui('pay_card_hint')}</span>
          </button>
          <button className="k-card flex flex-col items-center gap-[.6em] p-[calc(var(--k-pad)*1.4)] border-0" onClick={() => placeOrder('counter')} data-testid="k-pay-counter">
            <Store size={72} strokeWidth={1.4} />
            <span className="k-head text-[1.5em]">{ui('pay_counter')}</span>
            <span className="k-muted">{ui('pay_counter_hint')}</span>
          </button>
        </div>
      </div>
      <div className="k-bar shrink-0">
        <BackButton onClick={() => go('basket')} label={ui('back')} />
        <RestartButton s={s} texts={texts} />
      </div>
    </div>
  )
}

// ── The card reader ─────────────────────────────────────────────
// A real card machine (config.card_machine, migration 193): the kiosk asks
// the server to take the total on it, waits, and sends the order once it is
// approved. Previews take no money: Approve and Decline stand in for the card.

const CARD_FINAL = ['approved', 'declined', 'cancelled', 'failed']

export function Card() {
  const s = useKiosk()
  return s.config.card_machine && !s.preview ? <MachineCard /> : <PretendCard />
}

function CardFrame({ children, onBack }) {
  const s = useKiosk()
  const { ui } = textsFor(s)
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="k-card">
      <div className="flex-1 min-h-0 k-scroll p-[var(--k-pad)] flex flex-col items-center justify-center gap-[var(--k-pad)] text-center">
        {children}
      </div>
      <div className="k-bar shrink-0">
        <BackButton onClick={onBack || (() => go(methods(s.config).length > 1 ? 'pay' : 'basket'))} label={ui('back')} />
      </div>
    </div>
  )
}

function Declined({ title, onRetry }) {
  const s = useKiosk()
  const { ui } = textsFor(s)
  const counter = methods(s.config).includes('counter')
  return (
    <>
      <AlertTriangle size={80} />
      <h2 className="k-head text-[2em] m-0" data-testid="k-card-declined">{title || ui('card_declined')}</h2>
      <div className="flex gap-[var(--k-gap)] flex-wrap justify-center">
        <button className="k-btn k-btn-primary k-btn-big" onClick={onRetry} data-testid="k-card-retry">{ui('try_again')}</button>
        {counter && <button className="k-btn k-btn-big" onClick={() => placeOrder('counter')}>{ui('pay_counter')}</button>}
      </div>
    </>
  )
}

function AmountDue({ totals, children }) {
  const { ui, money } = textsFor(useKiosk())
  return (
    <>
      <CreditCard size={110} strokeWidth={1.2} className="text-[var(--k-primary)]" />
      <div className="k-muted font-semibold">{ui('card_amount')}</div>
      <div className="k-head text-[3em]" data-testid="k-card-amount">{totals ? money(totals.total) : ''}</div>
      {children}
    </>
  )
}

function PretendCard() {
  const s = useKiosk()
  const { ui } = textsFor(s)
  const { totals } = useBasketTotals(s)
  const [declined, setDeclined] = useState(false)
  return (
    <CardFrame>
      {declined ? <Declined onRetry={() => setDeclined(false)} /> : (
        <AmountDue totals={totals}>
          <h2 className="k-head text-[1.7em] m-0 max-w-[700px]">{ui('card_present')}</h2>
          <div className="k-card p-[var(--k-pad)] flex flex-col gap-[.6em] items-center mt-[var(--k-pad)]">
            <div className="k-muted text-[.85em]">{ui('test_reader')}</div>
            <div className="flex gap-[var(--k-gap)] flex-wrap justify-center">
              <button className="k-btn k-btn-primary" onClick={() => placeOrder('card', { ref: 'TEST-' + Date.now().toString(36).toUpperCase(), label: 'Test card' })} data-testid="k-card-approve">
                <Check /> {ui('approve_test')}
              </button>
              <button className="k-btn" onClick={() => setDeclined(true)} data-testid="k-card-decline">{ui('decline_test')}</button>
            </div>
          </div>
        </AmountDue>
      )}
    </CardFrame>
  )
}

function MachineCard() {
  const s = useKiosk()
  const { ui } = textsFor(s)
  const { totals } = useBasketTotals(s)
  const machine = s.config.card_machine
  const [round, setRound] = useState(0)          // Try again starts a new payment
  const [pay, setPay] = useState(null)           // the attempt from the server
  const [failed, setFailed] = useState(null)     // 'declined' | 'unavailable'
  const total = totals?.total || 0

  // Start a payment for the total, then ask how it goes until it ends.
  useEffect(() => {
    if (!total) return
    let alive = true
    let current = null
    let timer = null
    const paymentId = ulid()
    setPay(null); setFailed(null)
    setCardWaiting(true)
    const follow = p => {
      if (!alive) return
      current = p
      setPay(p)
      setCardWaiting(!CARD_FINAL.includes(p.status))
      if (p.status === 'approved') {
        current = null
        placeOrder('card', { id: paymentId, card_payment_id: p.id, ref: p.card_text || null, label: machine.name })
        return
      }
      if (CARD_FINAL.includes(p.status)) { current = null; setFailed('declined'); return }
      timer = setTimeout(() => cardCheck(p.id).then(follow, () => { timer = setTimeout(() => follow(p), 1500) }), 1500)
    }
    cardStart(paymentId, total).then(follow, err => {
      if (!alive) return
      // The machine is still busy with an earlier payment from this kiosk: cancel that one first.
      if (err?.code === 'busy' && err.data?.payment_id) cardCancel(err.data.payment_id).catch(() => {})
      setCardWaiting(false)
      setFailed('unavailable')
    })
    return () => {
      alive = false
      clearTimeout(timer)
      setCardWaiting(false)
      // Left the card step (Back, idle, start again): stop the machine waiting.
      if (current && !CARD_FINAL.includes(current.status)) cardCancel(current.id).catch(() => {})
    }
  }, [round, total])

  if (failed) {
    return (
      <CardFrame>
        <Declined title={failed === 'unavailable' ? ui('card_unavailable') : null} onRetry={() => setRound(n => n + 1)} />
      </CardFrame>
    )
  }
  return (
    <CardFrame>
      <AmountDue totals={totals}>
        <h2 className="k-head text-[1.7em] m-0 max-w-[700px]" data-testid="k-card-state">{pay ? ui('card_present') : ui('card_starting')}</h2>
        {!pay && <div className="k-spinner" />}
        {pay && machine.can_simulate && (
          <div className="k-card p-[var(--k-pad)] flex flex-col gap-[.6em] items-center mt-[var(--k-pad)]">
            <div className="k-muted text-[.85em]">{ui('test_reader')}</div>
            <div className="flex gap-[var(--k-gap)] flex-wrap justify-center">
              <button className="k-btn k-btn-primary" onClick={() => cardTest(pay.id, 'approve').catch(() => {})} data-testid="k-card-approve"><Check /> {ui('approve_test')}</button>
              <button className="k-btn" onClick={() => cardTest(pay.id, 'decline').catch(() => {})} data-testid="k-card-decline">{ui('decline_test')}</button>
            </div>
          </div>
        )}
      </AmountDue>
    </CardFrame>
  )
}

// ── Sending, done, failed ───────────────────────────────────────

export function Placing() {
  const texts = textsFor(useKiosk())
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--k-pad)]" data-testid="k-placing">
      <div className="k-spinner" />
      <div className="k-head text-[1.8em]">{texts.ui('sending')}</div>
    </div>
  )
}

export function Done() {
  const s = useKiosk()
  const texts = textsFor(s)
  const { ui, t } = texts
  const d = s.config.design
  const r = s.result || {}
  const [left, setLeft] = useState(d.behaviour.done_secs)
  useEffect(() => {
    const id = setInterval(() => setLeft(n => n - 1), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => { if (left <= 0) restart() }, [left])
  const note = r.pending ? ui('paid_pending')
    : s.method === 'card' ? ui('paid_note')
      : d.checkout.counter_note ? t(TK.design(d.id, 'counter_note'), d.checkout.counter_note)
        : d.checkout.send_counter ? ui('counter_note_sent') : ui('counter_note')
  const thanks = d.checkout.thanks ? t(TK.design(d.id, 'thanks'), d.checkout.thanks) : ui('thank_you')
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--k-pad)] p-[var(--k-pad)] text-center k-fade" data-testid="k-done">
      <div className="w-[6em] h-[6em] rounded-full bg-[var(--k-primary)] text-[var(--k-primary-text)] flex items-center justify-center"><Check size={64} strokeWidth={3} /></div>
      <h1 className="k-head text-[3em] m-0">{thanks}</h1>
      <div className="k-muted font-semibold text-[1.2em]">{ui('order_number')}</div>
      <div className="k-head text-[7em] leading-none text-[var(--k-primary)]" data-testid="k-order-number">{r.order_no ?? r.provisional ?? ''}</div>
      <div className="max-w-[760px] text-[1.2em]" data-testid="k-done-note">{note}</div>
      {d.checkout.number_kind !== 'table' && s.details?.tent && (
        <div className="max-w-[760px] text-[1.2em] font-semibold" data-testid="k-done-tent">{ui('tent_done', { n: s.details.tent })}</div>
      )}
      <div className="flex gap-[var(--k-gap)] flex-wrap justify-center mt-[var(--k-pad)]">
        {d.checkout.receipt === 'ask' && !r.pending && <button className="k-btn k-btn-big" onClick={printResultReceipt} data-testid="k-receipt"><Printer /> {ui('print_receipt')}</button>}
        <button className="k-btn k-btn-primary k-btn-big" onClick={restart} data-testid="k-done-button">{ui('done')} ({Math.max(0, left)})</button>
      </div>
    </div>
  )
}

export function Failed() {
  const s = useKiosk()
  const texts = textsFor(s)
  const { ui } = texts
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--k-pad)] p-[var(--k-pad)] text-center" data-testid="k-failed">
      <AlertTriangle size={90} />
      <h1 className="k-head text-[2.4em] m-0">{ui('failed_title')}</h1>
      <div className="text-[1.2em] max-w-[700px]">{ui('failed_body')}</div>
      {s.error && <div className="k-muted max-w-[700px]">{s.error}</div>}
      <div className="flex gap-[var(--k-gap)] flex-wrap justify-center">
        <button className="k-btn k-btn-big" onClick={() => go('basket')}><ShoppingBag /> {ui('your_order')}</button>
        <button className="k-btn k-btn-primary k-btn-big" onClick={() => afterBasket(s)} data-testid="k-failed-retry">{ui('try_again')}</button>
      </div>
    </div>
  )
}
