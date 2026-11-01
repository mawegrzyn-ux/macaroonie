// The check's actions beyond adding dishes: send (holding later courses),
// fire a course, discounts and comps (typed in, or from the company's list,
// shared/pos/discounts.js), charges (the location's matrix of revenue
// streams by order types, from the company's list, or typed in;
// shared/pos/charges.js), offers, move items to
// another check (split), merge checks, move table, change server, order type
// (with the name and tent number it asks for) or revenue stream, items not on
// the menu, no sale, dishes sold out.

import { useEffect, useState } from 'react'
import {
  Users, Table2, UserRound, Building2, Percent, HandCoins, Gift, Split, Merge, Flame, StickyNote, Printer,
  Vault, PenLine, Check, Hourglass, Send, XCircle, Ban, RotateCcw, Plus, ShoppingBag, Flag, Star, ShieldCheck, AlertTriangle, BookOpen,
} from 'lucide-react'
import { ulid } from '@shared/pos/ids.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { heldCourses, checkLabel } from '@shared/pos/checks.js'
import { MANAGER_ALWAYS } from '@shared/pos/permissions.js'
import { chargeLabel, chargeValueText, chargeOnText, copyOfCharge, onDishes, CHARGE_PERCENT_MAX, CHARGE_AMOUNT_MAX } from '@shared/pos/charges.js'
import { discountList, fitsScope, discountValueText } from '@shared/pos/discounts.js'
import { allergyText, allergyOn } from '@shared/pos/allergy.js'
import { Modal, Keypad, ReasonPicker, cx, money, poundsToPence, useApproval } from './ui.jsx'
import OrderPrompt from './OrderPrompt.jsx'
import { useTillNav, TillMenuSection } from './TillMenu.jsx'
import { dispatch, dispatchMany, toast, useChecks, getState, can, soldOutMap, setItemSoldOut, serverName } from '../lib/store.js'
import {
  defaultHeld, sendCheck, streamOf, byId, addOpenItem, promotionsFor, refreshPromotions,
  streamTypes, typeOf, checkPrompts, rerateLines, defaultTypeId, chargesFor, orderPromptOf,
  listCharges, listCharge, chargeNames, coversOf, coursesOn,
} from '../lib/checkOps.js'
import { CoversModal, CheckRow } from '../screens/Floor.jsx'

/** The Charges button's line: what is on, e.g. "Service charge 12.5%" or "2 on, 1 off". */
// "Service charge 12.5%", "2 on, 1 off", "1 waiting" (a charge for parties
// that the check hasn't the guests for yet).
function chargesHint(check) {
  const list = checkTotals(check).charges
  if (!list.length) return 'none'
  const on = list.filter(x => !x.removed && !x.waiting)
  const off = list.filter(x => x.removed).length
  const waiting = list.filter(x => x.waiting).length
  return [
    on.length === 1 ? chargeLabel(on[0]) : on.length ? on.length + ' on' : null,
    off ? off + ' off' : null,
    waiting ? waiting + ' waiting' : null,
  ].filter(Boolean).join(', ')
}

export function ActionsMenu({ check, config, menus = null, onPick, onClose }) {
  const held = heldCourses(check)
  const items = [
    menus && menus.menus.length > 1 && { key: 'menus', label: 'Menus', icon: BookOpen, hint: menusHint(menus) },
    // The revenue stream may take no covers (Store tech > Revenue streams).
    (coversOf(config, check.revenue_stream_id) !== 'off' || check.covers) && { key: 'covers', label: 'Guests', icon: Users, hint: check.covers ? check.covers + ' covers' : 'not set' },
    { key: 'table', label: check.table_id ? 'Move table' : 'Put on a table', icon: Table2 },
    { key: 'name', label: 'Name', icon: StickyNote, hint: check.tab_name || '' },
    { key: 'type', label: 'Order type', icon: ShoppingBag, hint: [typeOf(config, check.order_type_id)?.name, check.tent ? 'Tent ' + check.tent : null].filter(Boolean).join(' · ') },
    (checkPrompts(config, check).ask_tent !== 'off' || check.tent) && { key: 'tent', label: 'Tent number', icon: Flag, hint: check.tent || 'not set' },
    { key: 'allergy', label: 'Allergy', icon: AlertTriangle, hint: allergyText(check.allergy) || 'none on this order', bad: allergyOn(check.allergy) },
    { key: 'server', label: 'Server', icon: UserRound, hint: serverName(config, check.server_id) },
    (config.revenue_streams || []).length > 1 && { key: 'stream', label: 'Revenue stream', icon: Building2, hint: streamOf(config, check.revenue_stream_id)?.name },
    held.length > 0 && { key: 'fire', label: 'Fire a course', icon: Flame, hint: held.length + ' waiting' },
    { key: 'discount', label: 'Discount', icon: Percent },
    { key: 'sc', label: 'Charges', icon: HandCoins, hint: chargesHint(check) },
    config.loyalty && { key: 'loyalty', label: config.loyalty.name || 'Loyalty', icon: Star, hint: check.loyalty?.name || 'add a member' },
    (config.promotions || []).length > 0 && { key: 'offers', label: 'Offers', icon: Gift, hint: (check.promotions || []).length ? check.promotions.length + ' on' : '' },
    { key: 'move', label: 'Split / move items', icon: Split },
    { key: 'merge', label: 'Merge checks', icon: Merge },
    { key: 'open_item', label: 'Item not on menu', icon: PenLine },
    { key: 'bill', label: 'Print bill', icon: Printer },
    { key: 'drawer', label: 'No sale (open drawer)', icon: Vault },
    !check.lines.length && !(check.payments || []).some(p => !p.voided) && { key: 'void_check', label: 'Close empty check', icon: XCircle },
    check.lines.length > 0 && { key: 'cancel', label: 'Cancel order', icon: Ban, hint: 'void it all, with a reason', bad: true },
  ].filter(Boolean)
  // A layout without the till's top bar: the till menu is here too.
  const { hideBar } = useTillNav()
  return (
    <Modal title={'Check ' + checkLabel(check)} onClose={onClose} wide>
      {hideBar && (
        <div className="mb-4 pb-4 border-b border-line space-y-2">
          <div className="label px-1">Till</div>
          <TillMenuSection onDone={onClose} />
          <div className="label px-1 pt-2">This order</div>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {items.map(it => (
          <button key={it.key} className={cx('btn h-auto min-h-[64px] py-2 justify-start text-left', it.bad && 'text-bad')} onClick={() => onPick(it.key)} data-testid={'action-' + it.key}>
            <it.icon size={22} className={cx('shrink-0', it.bad ? 'text-bad' : 'text-brand')} />
            <span className="flex flex-col leading-tight min-w-0"><span>{it.label}</span>{it.hint ? <span className="text-xs text-muted font-normal truncate">{it.hint}</span> : null}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

/** "Lunch, Drinks" or "Lunch, Drinks (picked)": what the till shows now (lib/tillMenus.js). */
export function menusHint(m) {
  const names = m.shown.map(x => x.name).join(', ')
  return m.auto ? (m.none ? 'every menu (none on now)' : names) : names + ' (picked)'
}

// ── Send ─────────────────────────────────────────────────────────

/**
 * Send new items; asks which later courses should wait when there are any.
 * Each course is one big button that switches it between Cook now (green
 * outline and background: what the kitchen starts on) and Wait (a plain
 * row with a bold Wait (hold) label).
 */
export function SendModal({ check, config, onClose, onSent }) {
  const courses = byId(config.courses)
  const fresh = [...new Set(check.lines.filter(l => l.status === 'new' && l.course_id).map(l => l.course_id))]
  const [held, setHeld] = useState(defaultHeld(check, config))
  const go = () => {
    const r = sendCheck(check, held)
    if (!r.ok) return toast(r.error, 'bad')
    onSent()
  }
  return (
    <Modal title="Send to the kitchen" onClose={onClose} footer={<button className="btn btn-primary h-14 min-w-[200px]" onClick={go} data-testid="send-go"><Send size={20} /> Send</button>}>
      <div className="space-y-3">
        <div className="text-[15px]">
          Tap a course to switch it between <span className="font-semibold text-ok">Cook now</span> and <span className="font-semibold text-held">Wait</span>.
          Courses that wait go on the ticket with HOLD; fire them when the table is ready.
        </div>
        {fresh.sort((a, b) => (courses[a]?.sort_order ?? 0) - (courses[b]?.sort_order ?? 0)).map(id => {
          const on = held.includes(id)
          return (
            <button key={id} data-testid="send-course" data-course={id} data-held={on ? '1' : '0'} aria-pressed={!on}
              className={cx('w-full min-h-[64px] rounded-2xl border-2 px-4 py-3 flex items-center gap-3 text-left touch-manipulation active:scale-[0.99] transition-transform',
                on ? 'bg-white border-line' : 'bg-ok-soft border-ok')}
              onClick={() => setHeld(on ? held.filter(x => x !== id) : [...held, id])}>
              <span className="flex-1 min-w-0 font-semibold text-lg truncate">{courses[id]?.name || 'Course'}</span>
              {on
                ? <span className="shrink-0 inline-flex items-center gap-2 rounded-full bg-held text-white px-4 h-11 text-base font-bold" data-testid="send-wait"><Hourglass size={18} /> Wait (hold)</span>
                : <span className="shrink-0 inline-flex items-center gap-2 text-ok text-base font-bold px-1" data-testid="send-now"><Flame size={18} /> Cook now</span>}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

export function needsSendChoice(check, config) {
  const ids = new Set(check.lines.filter(l => l.status === 'new' && l.course_id).map(l => l.course_id))
  const courses = byId(config.courses)
  return ids.size > 1 || [...ids].some(id => courses[id]?.hold_by_default) || defaultHeld(check, config).length > 0
}

export function FireModal({ check, config, onClose }) {
  const courses = byId(config.courses)
  const held = heldCourses(check).sort((a, b) => (courses[a]?.sort_order ?? 0) - (courses[b]?.sort_order ?? 0))
  return (
    <Modal title="Fire a course" onClose={onClose}>
      <div className="space-y-2">
        {held.map(id => (
          <button key={id} className="btn btn-primary w-full h-16 text-lg" onClick={() => {
            const r = dispatch('course.fired', { course_id: id }, { check_id: check.id })
            if (!r.ok) return toast(r.error, 'bad')
            toast('Fired ' + (courses[id]?.name || 'course'), 'ok')
            onClose()
          }}><Flame size={22} /> Fire {courses[id]?.name || 'course'} ({check.lines.filter(l => l.course_id === id && l.held).length})</button>
        ))}
        {!held.length && <div className="text-muted">Nothing is waiting.</div>}
      </div>
    </Modal>
  )
}

// ── Cancel the whole order ───────────────────────────────────────

const CANCEL_REASONS = ['Guest left', 'Guest changed their mind', 'Wrong order', 'Kitchen can\'t make it', 'Test order']

/**
 * Cancel order: every item the kitchen has is voided (VOID tickets go to
 * it), the rest taken off, and the check closes as cancelled, with a reason.
 * Payments come off first (Pay). A manager may be needed: for voiding sent
 * items, and when the venue says so (Store tech, Receipts and payments).
 */
export function CancelOrderModal({ check, onClose, onCancelled }) {
  const approve = useApproval()
  const [reason, setReason] = useState('')
  const [waste, setWaste] = useState(true)
  const sent = check.lines.filter(l => l.status === 'sent')
  const fresh = check.lines.filter(l => l.status === 'new')
  const paid = (check.payments || []).filter(p => !p.voided)
  const go = async () => {
    const actions = ['cancel_order']
    if (sent.length) actions.push('void_sent')
    if (fresh.length) actions.push('delete_unsent')
    const approver = await approve(sent.length ? 'void' : null, null, 'Cancelling this order needs a manager.', actions)
    if (approver === false) return
    const why = reason.trim()
    const at = { check_id: check.id, approved_by: approver }
    const r = dispatchMany([
      ...sent.map(l => ['line.voided', { line_id: l.id, reason: why, waste, cancel: true }, at]),
      ...fresh.map(l => ['line.deleted', { line_id: l.id, cancel: true }, at]),
      ['check.closed', { cancel_reason: why }, at],
    ])
    if (!r.ok) return toast(r.error, 'bad')
    toast('Order cancelled', 'ok')
    onCancelled()
  }
  return (
    <Modal title={'Cancel order ' + checkLabel(check)} onClose={onClose}
      footer={<button className="btn btn-bad h-14 min-w-[200px]" disabled={!reason.trim() || paid.length > 0} onClick={go} data-testid="cancel-order-go"><Ban size={18} /> Cancel the order</button>}>
      <div className="space-y-4">
        {paid.length > 0 ? (
          <div className="rounded-xl bg-warn-soft text-warn p-3 font-semibold" data-testid="cancel-order-paid">
            This order has {paid.length === 1 ? 'a payment' : paid.length + ' payments'} ({money(paid.reduce((s, p) => s + p.amount, 0))}). Take {paid.length === 1 ? 'it' : 'them'} off in Pay first.
          </div>
        ) : (
          <div className="text-[15px]">
            {sent.length > 0 && <>The kitchen gets a VOID ticket for the {sent.reduce((s, l) => s + l.qty, 0)} item{sent.reduce((s, l) => s + l.qty, 0) === 1 ? '' : 's'} it has. </>}
            {fresh.length > 0 && <>{fresh.reduce((s, l) => s + l.qty, 0)} item{fresh.reduce((s, l) => s + l.qty, 0) === 1 ? '' : 's'} not sent yet come{fresh.reduce((s, l) => s + l.qty, 0) === 1 ? 's' : ''} off. </>}
            The order shows as cancelled in the day's report.
          </div>
        )}
        <ReasonPicker options={CANCEL_REASONS} value={reason} onChange={setReason} />
        {sent.length > 0 && (
          <div className="flex gap-2">
            <button className={cx('chip', waste && 'chip-on')} onClick={() => setWaste(true)}>Made: waste</button>
            <button className={cx('chip', !waste && 'chip-on')} onClick={() => setWaste(false)}>Not made</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Discounts and service charge ─────────────────────────────────

const DISCOUNT_REASONS = ['Regular', 'Staff', 'Complaint', 'Manager decision', 'Promotion']

/**
 * A discount from the company's list (Store tech > Discounts) on the check,
 * or on some of its items: asks for a manager first when the discount says
 * so. Returns the dispatch result, { ok: false, error }, or { ok: false,
 * cancelled: true } when nobody approved. Used by the Discount window and a
 * till layout's discount button.
 */
export async function applyDiscountPreset(check, preset, approve, lineIds = null) {
  const t = checkTotals(check)
  const base = lineIds ? t.lines.filter(l => lineIds.includes(l.id)).reduce((s, l) => s + l.net, 0) : t.net
  const off = preset.kind === 'percent' ? Math.round(base * preset.value / 100) : Math.min(base, preset.value)
  if (off <= 0) return { ok: false, error: 'Nothing left to discount' }
  // Marked in Store tech: a manager every time; otherwise anyone may use it.
  const approver = preset.needs_manager ? await approve(null, null, preset.name + ' needs a manager every time.', [MANAGER_ALWAYS]) : null
  if (approver === false) return { ok: false, cancelled: true }
  return dispatch('discount.applied', {
    discount: { id: ulid(), scope: lineIds ? 'line' : 'check', line_ids: lineIds || [], type: preset.kind, value: preset.value, name: preset.name, reason: '', preset_id: preset.id },
  }, { check_id: check.id, approved_by: approver })
}

export function DiscountModal({ check, config, lineIds = null, onClose }) {
  const approve = useApproval()
  const [type, setType] = useState('percent')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const t = checkTotals(check)
  const base = lineIds ? t.lines.filter(l => lineIds.includes(l.id)).reduce((s, l) => s + l.net, 0) : t.net
  const v = type === 'percent' ? Number(value) || 0 : poundsToPence(value)
  const off = type === 'percent' ? Math.round(base * Math.min(100, v) / 100) : Math.min(base, v)
  const pct = type === 'percent' ? v : (base ? Math.ceil(v * 100 / base) : 100)
  const names = lineIds ? check.lines.filter(l => lineIds.includes(l.id)).map(l => l.name).join(', ') : 'the whole check'
  const scope = lineIds ? 'line' : 'check'
  // The company's list (Store tech > Discounts) for what is picked.
  const presets = discountList(config?.settings).filter(p => fitsScope(p, scope))
  const presetOff = p => (p.kind === 'percent' ? Math.round(base * p.value / 100) : Math.min(base, p.value))
  const put = (discount, approver) => {
    const r = dispatch('discount.applied', { discount: { id: ulid(), scope, line_ids: lineIds || [], ...discount } }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  const usePreset = async p => {
    const r = await applyDiscountPreset(check, p, approve, lineIds)
    if (r.cancelled) return
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  const apply = async () => {
    const msg = can('discount', Math.min(100, pct)) ? 'Discounts typed in on the till need a manager here.' : 'This discount is more than your role allows.'
    const approver = await approve('discount', Math.min(100, pct), msg, ['custom_discount'])
    if (approver === false) return
    put({
      type, value: type === 'percent' ? Math.min(100, v) : v,
      name: type === 'percent' ? v + '% off' : money(v) + ' off', reason: reason.trim(),
    }, approver)
  }
  const existing = (check.discounts || []).filter(d => d.scope === 'check')
  return (
    <Modal title={'Discount ' + names} onClose={onClose} wide
      footer={<button className="btn btn-primary h-14 min-w-[200px]" disabled={!v || off <= 0} onClick={apply} data-testid="discount-typed"><Percent size={18} /> Take off {money(off)}</button>}>
      {presets.length > 0 && (
        <div className="mb-5" data-testid="discount-presets">
          <div className="label mb-2">Discounts</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {presets.map(p => (
              <button key={p.id} className="btn h-auto min-h-[64px] py-2 justify-start text-left" onClick={() => usePreset(p)} data-testid="discount-preset" data-name={p.name}>
                {p.needs_manager ? <ShieldCheck size={20} className="shrink-0 text-warn" aria-label="Needs a manager" /> : <Percent size={20} className="shrink-0 text-brand" />}
                <span className="flex flex-col leading-tight min-w-0">
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-muted font-normal">{discountValueText(p)} · {money(presetOff(p))} off{p.needs_manager ? ' · manager' : ''}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-4">
          {presets.length > 0 && <div className="label">Or type a discount</div>}
          <div className="flex gap-2">
            <button className={cx('chip flex-1', type === 'percent' && 'chip-on')} onClick={() => { setType('percent'); setValue('') }}>Percent</button>
            <button className={cx('chip flex-1', type === 'amount' && 'chip-on')} onClick={() => { setType('amount'); setValue('') }}>Amount £</button>
          </div>
          {type === 'percent' && (
            <div className="flex flex-wrap gap-2">
              {[10, 15, 20, 25, 50, 100].map(n => <button key={n} className={cx('chip', Number(value) === n && 'chip-on')} onClick={() => setValue(String(n))}>{n}%</button>)}
            </div>
          )}
          <div className="text-3xl font-bold tabular-nums">{type === 'amount' ? '£' : ''}{value || '0'}{type === 'percent' ? '%' : ''}</div>
          <div className="text-sm text-muted">On {money(base)}{can('discount', pct, ['custom_discount']) ? '' : can('discount', pct) ? ' · needs a manager' : ' · needs a manager above your limit'}</div>
          <ReasonPicker options={DISCOUNT_REASONS} value={reason} onChange={setReason} />
          {existing.length > 0 && !lineIds && (
            <div className="space-y-2">
              <div className="label">On this check</div>
              {existing.map(d => (
                <div key={d.id} className="flex items-center gap-2 rounded-xl bg-ok-soft p-2 pl-3">
                  <span className="flex-1 font-semibold">{d.name}{d.reason ? ' · ' + d.reason : ''}</span>
                  <button className="btn min-h-[40px]" onClick={() => { const r = dispatch('discount.removed', { discount_id: d.id }, { check_id: check.id }); if (!r.ok) toast(r.error, 'bad') }}>Take off</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <Keypad value={value} onChange={setValue} decimal={type === 'amount'} max={type === 'percent' ? 3 : 7} />
      </div>
    </Modal>
  )
}

/**
 * The check's charges (shared/pos/charges.js): the ones the location gives
 * its revenue stream and order type (Store tech > Charges), ones added here
 * from the company's list, and any typed in here. Optional ones anyone takes
 * off (unless the venue's switch says a manager); ones that aren't optional
 * need a manager every time.
 */
export function ChargesModal({ check, config, onClose }) {
  const approve = useApproval()
  const t = checkTotals(check)
  const list = listCharges(config)
  const names = chargeNames(config)
  const onIds = new Set((check.charges || []).map(x => x.id))
  const offer = list.filter(x => !onIds.has(x.id))
  const [typing, setTyping] = useState(!list.length)
  const [taking, setTaking] = useState(null)
  const [reason, setReason] = useState('')
  const [kind, setKind] = useState('percent')
  const [value, setValue] = useState('')
  const [name, setName] = useState('Service charge')
  const send = (type, payload, approver = null) => {
    const r = dispatch(type, payload, { check_id: check.id, approved_by: approver })
    if (!r.ok) { toast(r.error, 'bad'); return false }
    return true
  }
  const takeOff = async x => {
    const action = x.optional ? 'remove_charge' : MANAGER_ALWAYS
    const approver = await approve(null, null, x.optional ? 'Taking a charge off needs a manager here.' : x.name + ' isn\'t optional: a manager can take it off.', [action])
    if (approver === false) return
    if (send('charge.removed', { charge_id: x.id, reason: reason.trim() }, approver)) { setTaking(null); setReason('') }
  }
  const amount = kind === 'percent' ? Number(value) || 0 : poundsToPence(value)
  const tooMuch = kind === 'percent' ? amount > CHARGE_PERCENT_MAX : amount > CHARGE_AMOUNT_MAX
  const add = () => {
    const ok = send('charge.added', { charge: { id: ulid(), name: name.trim() || 'Service charge', kind, value: kind === 'percent' ? Math.round(amount * 100) / 100 : amount } })
    if (ok) { setValue(''); toast((name.trim() || 'Service charge') + ' added', 'ok') }
  }
  // From the company's list, as it is there (the sequencer checks it is).
  const addFromList = x => {
    if (send('charge.added', { charge: listCharge(config, x) })) toast(x.name + ' added', 'ok')
  }
  const listWords = x => [
    chargeValueText(x),
    onDishes(x) ? 'on ' + chargeOnText(x, names) : null,
    x.optional ? 'optional' : null,
    x.min_covers ? 'from ' + x.min_covers + ' guests' : null,
  ].filter(Boolean).join(' · ')
  const reasonOf = x => check.charges.find(y => y.id === x.id)?.reason || ''
  return (
    <Modal title="Charges" onClose={onClose} wide>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-2" data-testid="charges-list">
          {!t.charges.length && <div className="text-sm text-muted">No charges on this check. The location's charges for its revenue stream and order type go on by themselves (Store tech, Charges); add one here from the list, or type one in.</div>}
          {t.charges.map(x => (
            <div key={x.id} className={cx('rounded-xl border p-3 space-y-2', x.removed ? 'border-line bg-panel' : 'border-ok bg-ok-soft')} data-testid="charge-row" data-name={x.name}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className={cx('font-semibold', x.removed && 'line-through text-muted')}>{chargeLabel(x)}</div>
                  <div className="text-xs text-muted">
                    {x.removed ? 'Taken off' + (reasonOf(x) ? ': ' + reasonOf(x) : '')
                      : x.waiting ? 'From ' + x.min_covers + ' guests' + (check.covers ? ' (' + check.covers + ' now)' : '')
                        : x.basis === 'dishes' && !x.count ? 'None of its dishes on the check yet'
                          : money(x.amount)}
                    {x.basis === 'dishes' ? ' · on ' + chargeOnText(check.charges.find(y => y.id === x.id) || x, names) : ''}
                    {!x.optional && !x.removed ? ' · not optional' : ''}{x.added ? ' · added on the till' : ''}
                  </div>
                </div>
                {x.removed
                  ? <button className="btn min-h-[44px]" data-testid="charge-restore" onClick={() => send('charge.restored', { charge_id: x.id })}><RotateCcw size={16} /> Put back</button>
                  : taking !== x.id && <button className="btn min-h-[44px]" data-testid="charge-off" onClick={() => { setTaking(x.id); setReason('') }}>{x.optional ? 'Take off' : <><ShieldCheck size={16} className="text-warn" /> Take off</>}</button>}
              </div>
              {taking === x.id && !x.removed && (
                <div className="space-y-3 pt-1">
                  <ReasonPicker options={['Guest asked', 'Complaint', 'Large party agreed']} value={reason} onChange={setReason} />
                  <div className="flex gap-2">
                    <button className="btn btn-bad flex-1" disabled={!reason.trim()} data-testid="charge-off-confirm" onClick={() => takeOff(x)}>Take it off</button>
                    <button className="btn" onClick={() => setTaking(null)}>Keep it</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {t.service_charge > 0 && <div className="text-sm text-muted pt-1">Charges on this check: <b className="text-ink">{money(t.service_charge)}</b></div>}
        </div>
        <div className="space-y-3">
          {list.length > 0 && (
            <div className="space-y-2" data-testid="charges-from-list">
              <div className="label">Add from the list</div>
              {!offer.length && <div className="text-sm text-muted">Every charge on the list is on this check.</div>}
              {offer.map(x => (
                <button key={x.id} className="btn w-full h-auto min-h-[56px] py-2 justify-between text-left" data-testid="charge-list-add" data-name={x.name} onClick={() => addFromList(x)}>
                  <span className="flex flex-col leading-tight min-w-0">
                    <span className="font-semibold">{x.name}</span>
                    <span className="text-xs text-muted font-normal truncate">{listWords(x)}</span>
                  </span>
                  <Plus size={18} className="shrink-0 text-brand" />
                </button>
              ))}
              {!typing && <button className="btn btn-ghost w-full" data-testid="charge-type-in" onClick={() => setTyping(true)}><PenLine size={16} /> Type a charge in</button>}
            </div>
          )}
          {typing && (
            <div className="space-y-3" data-testid="charge-typed">
              <div className="label">{list.length ? 'Type a charge in' : 'Add a charge'}</div>
              <input className="input" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Service charge" aria-label="Charge name" />
              <div className="flex gap-2">
                <button className={cx('chip flex-1', kind === 'percent' && 'chip-on')} onClick={() => { setKind('percent'); setValue('') }}>Percent</button>
                <button className={cx('chip flex-1', kind === 'amount' && 'chip-on')} onClick={() => { setKind('amount'); setValue('') }}>Amount £</button>
              </div>
              {kind === 'percent' && (
                <div className="flex flex-wrap gap-2">
                  {[10, 12.5, 15].map(n => <button key={n} className={cx('chip', Number(value) === n && 'chip-on')} onClick={() => setValue(String(n))}>{n}%</button>)}
                </div>
              )}
              <div className="text-2xl font-bold tabular-nums">{kind === 'amount' ? '£' : ''}{value || '0'}{kind === 'percent' ? '%' : ''}</div>
              <Keypad value={value} onChange={setValue} decimal max={kind === 'percent' ? 5 : 7} />
              {tooMuch && <div className="text-sm text-bad">{kind === 'percent' ? 'At most ' + CHARGE_PERCENT_MAX + '%' : 'At most ' + money(CHARGE_AMOUNT_MAX)}</div>}
              <button className="btn btn-primary w-full h-14" disabled={!amount || tooMuch} data-testid="charge-add" onClick={add}><Plus size={18} /> Add {kind === 'percent' ? (value || 0) + '%' : money(amount)}</button>
              <div className="text-xs text-muted">A charge typed in here is on the whole check, optional and without VAT: it can be taken off again like any optional charge.</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export function OffersModal({ check, config, onClose }) {
  const manual = (config.promotions || []).filter(p => p.apply_mode !== 'auto')
  const on = new Set((check.promotions || []).map(p => p.promotion_id))
  const [code, setCode] = useState('')
  const preview = promotionsFor(check)
  const toggle = p => {
    const x = promotionsFor(check, on.has(p.id) ? { remove: p.id } : { add: p.id })
    if (!x) return
    const r = dispatch('promotions.set', x.payload, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    if (!on.has(p.id) && !x.payload.promotions.some(q => q.promotion_id === p.id)) toast(p.name + " doesn't apply to this check", 'bad')
  }
  const byCode = () => {
    const p = manual.find(x => x.apply_mode === 'code' && String(x.code || '').toLowerCase() === code.trim().toLowerCase())
    if (!p) return toast('No offer has that code', 'bad')
    toggle(p)
    setCode('')
  }
  return (
    <Modal title="Offers" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm text-muted">Automatic offers and combos apply by themselves as dishes are added, and again when the bill is printed or paid.</div>
        {(check.promotions || []).map(p => (
          <div key={p.promotion_id} className="rounded-xl bg-ok-soft p-3 font-semibold flex justify-between">
            <span>{p.kind === 'combo' ? 'Combo: ' : ''}{p.name}{p.count > 1 ? ' x ' + p.count : ''}</span><span>−{money(Object.values(p.lines || {}).reduce((s, x) => s + x, 0))}</span>
          </div>
        ))}
        <button className="btn w-full" onClick={() => { refreshPromotions(check.id); onClose() }}>Check automatic offers now</button>
        {manual.filter(p => p.apply_mode === 'manual').map(p => (
          <button key={p.id} className={cx('w-full card p-3 text-left flex items-center gap-3', on.has(p.id) && 'border-ok bg-ok-soft')} onClick={() => toggle(p)}>
            <Gift size={20} className="text-brand" />
            <span className="flex-1"><span className="font-semibold">{p.name}</span>{p.description ? <span className="block text-xs text-muted">{p.description}</span> : null}</span>
            <span className="text-sm font-semibold">{on.has(p.id) ? 'On' : 'Apply'}</span>
          </button>
        ))}
        {manual.some(p => p.apply_mode === 'code') && (
          <div className="flex gap-2">
            <input className="input uppercase" placeholder="Promo code" value={code} onChange={e => setCode(e.target.value)} />
            <button className="btn" disabled={!code.trim()} onClick={byCode}>Apply</button>
          </div>
        )}
        {preview?.offers?.length > 0 && <div className="text-xs text-muted">Also available: {preview.offers.map(o => o.name).join(', ')}</div>}
      </div>
    </Modal>
  )
}

// ── Move, split, merge ───────────────────────────────────────────

/** Move items to a new check (split) or another open check. */
export function MoveModal({ check, config, preselect = [], onClose, onOpen }) {
  const approve = useApproval()
  const checks = useChecks()
  const [picked, setPicked] = useState(preselect)
  const [target, setTarget] = useState('new')
  const others = Object.values(checks).filter(c => c.status === 'open' && c.id !== check.id)
  const lines = check.lines.filter(l => l.status !== 'voided')
  const move = async () => {
    const approver = await approve('transfer', null, 'Moving items between checks needs a manager.')
    if (approver === false) return
    let toId = target
    const specs = []
    if (target === 'new') {
      toId = ulid()
      specs.push(['check.opened', {
        mode: check.mode === 'counter' ? 'counter' : check.table_id ? 'table' : 'tab',
        table_id: check.table_id, tab_name: check.tab_name ? check.tab_name + ' (split)' : null,
        covers: null, revenue_stream_id: check.revenue_stream_id, order_type_id: check.order_type_id, tent: check.tent || null,
        from_check_id: check.id,
        // The charges still on the check go with the split (taken off ones stay off).
        charges: (check.charges || []).filter(x => !x.removed).map(copyOfCharge),
      }, { check_id: toId }])
    }
    specs.push(['lines.moved', { to_check_id: toId, line_ids: picked }, { check_id: check.id, approved_by: approver }])
    const r = dispatchMany(specs)
    if (!r.ok) return toast(r.error, 'bad')
    toast('Moved ' + picked.length + ' item' + (picked.length > 1 ? 's' : ''), 'ok')
    onClose()
    if (target === 'new') onOpen(toId)
  }
  const seats = [...new Set(lines.map(l => l.seat).filter(Boolean))].sort((a, b) => a - b)
  return (
    <Modal title="Split / move items" onClose={onClose} wide
      footer={<button className="btn btn-primary h-14 min-w-[220px]" disabled={!picked.length || (target !== 'new' && !others.some(o => o.id === target))} onClick={move}><Split size={18} /> Move {picked.length || ''} item{picked.length === 1 ? '' : 's'}</button>}>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="label flex-1">Items</div>
            {seats.map(s => <button key={s} className="chip min-h-[36px]" onClick={() => setPicked(lines.filter(l => l.seat === s).map(l => l.id))}>Seat {s}</button>)}
          </div>
          <div className="card divide-y divide-line max-h-[50vh] overflow-y-auto">
            {lines.map(l => {
              const on = picked.includes(l.id)
              return (
                <button key={l.id} className={cx('w-full flex items-center gap-3 p-3 text-left', on && 'bg-brand-soft')} onClick={() => setPicked(on ? picked.filter(x => x !== l.id) : [...picked, l.id])}>
                  <span className={cx('w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0', on ? 'bg-brand border-brand text-white' : 'border-line')}>{on && <Check size={14} />}</span>
                  <span className="flex-1">{l.qty} x {l.name}{l.seat ? ' · S' + l.seat : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="space-y-2">
          <div className="label">Move to</div>
          <button className={cx('w-full card p-4 text-left font-semibold', target === 'new' && 'ring-2 ring-brand')} onClick={() => setTarget('new')}>A new check{check.table_id ? ' on this table' : ''}</button>
          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {others.map(o => <CheckRow key={o.id} check={o} config={config} active={target === o.id} onClick={() => setTarget(o.id)} />)}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Bring another check into this one. */
export function MergeModal({ check, config, onClose }) {
  const approve = useApproval()
  const checks = useChecks()
  const others = Object.values(checks).filter(c => c.status === 'open' && c.id !== check.id)
  const merge = async other => {
    const approver = await approve('transfer', null, 'Merging checks needs a manager.')
    if (approver === false) return
    const r = dispatch('check.merged', { into_check_id: check.id }, { check_id: other.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    toast('Merged into this check', 'ok')
    onClose()
  }
  return (
    <Modal title={'Merge into check ' + checkLabel(check)} onClose={onClose}>
      <div className="space-y-2">
        <div className="text-sm text-muted">Tap a check to bring all its items here. A check with payments can't be merged: move its items instead.</div>
        {others.map(o => <CheckRow key={o.id} check={o} config={config} onClick={() => merge(o)} />)}
        {!others.length && <div className="text-muted">No other open checks.</div>}
      </div>
    </Modal>
  )
}

// ── Table, name, server, revenue centre, guests ──────────────────

export function TableModal({ check, config, onClose }) {
  const checks = useChecks()
  const busy = new Set(Object.values(checks).filter(c => c.status === 'open' && c.table_id && c.id !== check.id).map(c => c.table_id))
  const move = tableId => {
    const r = dispatch('check.table_moved', { table_id: tableId }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  return (
    <Modal title="Move to a table" onClose={onClose} wide>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
        {(config.tables || []).map(t => (
          <button key={t.id} className={cx('btn h-20 flex-col gap-0', t.id === check.table_id && 'btn-primary', busy.has(t.id) && t.id !== check.table_id && 'border-warn')} onClick={() => move(t.id)}>
            <span className="text-xl">{t.label}</span>
            <span className="text-xs font-normal">{busy.has(t.id) ? 'in use' : t.max_covers + ' seats'}</span>
          </button>
        ))}
      </div>
      {check.table_id && <button className="btn w-full mt-4" onClick={() => move(null)}>Make it a tab (no table)</button>}
    </Modal>
  )
}

/** The name on the check (a tab's, the customer's): typed on the till's own keys. */
export function NameModal({ check, onClose }) {
  const save = ({ name }) => {
    if ((name || null) === (check.tab_name || null)) return onClose()
    const r = dispatch('check.renamed', { tab_name: name || null }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  return (
    <OrderPrompt title="Name on the check" name={check.tab_name || ''} doneLabel="Save"
      promptsOf={() => ONLY_NAME} onDone={save} onClose={onClose} />
  )
}
const ONLY_NAME = { ask_name: 'ask', ask_tent: 'off' }

export function ServerModal({ check, config, onClose }) {
  const approve = useApproval()
  const pick = async staffId => {
    let approver = null
    if (check.server_id !== getState().staff?.id) {
      approver = await approve('take_over', null, "Taking over someone else's check needs a manager.")
      if (approver === false) return
    }
    const r = dispatch('check.server_changed', { server_id: staffId }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  return (
    <Modal title="Who is serving this check?" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {(config.staff || []).filter(s => s.pin_hash).map(s => (
          <button key={s.id} className={cx('btn h-14', s.id === check.server_id && 'btn-primary')} onClick={() => pick(s.id)}>{s.name}</button>
        ))}
      </div>
    </Modal>
  )
}

/**
 * The check's order type (Eat in, Take out, ...): the types its revenue
 * stream offers, then the name and tent number the chosen one asks for, on
 * the order prompt (components/OrderPrompt.jsx: one screen or two steps, as
 * the till is set). Changing the type re-rates every item (tax can depend on
 * it) and swaps the charges. focus 'tent': the tent number alone; start
 * 'details': straight to what the check is missing (two steps).
 */
export function OrderTypeModal({ check, config, onClose, focus = null, start = 'type' }) {
  const types = streamTypes(config, check.revenue_stream_id)
  // A stream with no order types switched on: say why there is nothing to pick
  // (the prompt still asks what the check's own type asks, or closes).
  useEffect(() => {
    if (focus !== 'tent' && !types.length) toast('This revenue stream has no order types switched on (Store tech, Revenue streams)', 'info')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = ({ typeId, name, tent }) => {
    const payload = { order_type_id: typeId }
    if ((name || null) !== (check.tab_name || null)) payload.tab_name = name || null
    if ((tent || null) !== (check.tent || null)) payload.tent = tent || null
    // The new type's tax for every item, and its charges.
    if (typeId !== check.order_type_id) {
      payload.lines = rerateLines(check, config, { order_type_id: typeId })
      payload.charges = chargesFor(config, { streamId: check.revenue_stream_id, typeId })
    }
    if (typeId === check.order_type_id && payload.tab_name === undefined && payload.tent === undefined) return onClose()
    const r = dispatch('check.order_type_set', payload, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  if (focus === 'tent') {
    // At a table nobody takes a tent number (checkPrompts); asked for here, it is typed anyway.
    const ask = checkPrompts(config, check).ask_tent
    return (
      <OrderPrompt title="Tent number" typeId={check.order_type_id} name={check.tab_name || ''} tent={check.tent || ''}
        promptsOf={() => ({ ask_name: 'off', ask_tent: ask === 'off' ? 'ask' : ask })} doneLabel="Save" onDone={save} onClose={onClose} />
    )
  }
  const noteFor = id => {
    if (id === check.order_type_id) return null
    const words = []
    if (check.lines.some(l => l.status !== 'voided')) words.push('The items already on the check take this order type\'s tax.')
    const charges = chargesFor(config, { streamId: check.revenue_stream_id, typeId: id })
    if (charges.length) words.push('Charges: ' + charges.map(chargeLabel).join(', ') + '.')
    else if ((check.charges || []).some(x => !x.added)) words.push('No charges for this order type here: the check\'s come off.')
    return words.join(' ') || null
  }
  return (
    <OrderPrompt title="Order type" types={types} typeId={check.order_type_id || types[0]?.type.id || null}
      promptsOf={id => checkPrompts(config, check, id)} name={check.tab_name || ''} tent={check.tent || ''}
      style={orderPromptOf(config)} start={start} doneLabel="Save" noteFor={noteFor} onDone={save} onClose={onClose} />
  )
}

/** The revenue stream the check's sales count under. Items move with it and take its tax. */
export function StreamModal({ check, config, onClose }) {
  const set = streamId => {
    if (streamId === check.revenue_stream_id) return onClose()
    // A type the new stream doesn't offer becomes its default. The charges
    // follow the new stream and type (the location's matrix): with the
    // stream when the type stays, else with the new type.
    const offered = streamTypes(config, streamId).some(x => x.type.id === check.order_type_id)
    const typeId = offered ? check.order_type_id : defaultTypeId(config, streamId)
    const stream = { revenue_stream_id: streamId, lines: rerateLines(check, config, { revenue_stream_id: streamId }) }
    if (offered || !typeId) stream.charges = chargesFor(config, { streamId, typeId: check.order_type_id })
    const specs = [['check.stream_set', stream, { check_id: check.id }]]
    if (!offered && typeId) {
      specs.push(['check.order_type_set', { order_type_id: typeId, lines: rerateLines(check, config, { revenue_stream_id: streamId, order_type_id: typeId }), charges: chargesFor(config, { streamId, typeId }) }, { check_id: check.id }])
    }
    const r = dispatchMany(specs)
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  return (
    <Modal title="Revenue stream" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm text-muted">The check's sales count towards the stream picked here.</div>
        {(config.revenue_streams || []).map(rs => (
          <button key={rs.id} className={cx('btn w-full h-14 justify-between', rs.id === check.revenue_stream_id && 'btn-primary')} onClick={() => set(rs.id)}>
            <span>{rs.name}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

export function GuestsModal({ check, config, onClose }) {
  const table = (config.tables || []).find(t => t.id === check.table_id)
  return (
    <CoversModal title={table ? 'Table ' + table.label : 'Check ' + checkLabel(check)} max={table?.max_covers} initial={check.covers} onClose={onClose} doneLabel="Save"
      onDone={n => {
        // A charge for parties of N counts by itself once the party reaches N.
        const r = dispatch('check.covers_set', { covers: n }, { check_id: check.id })
        if (!r.ok) return toast(r.error, 'bad')
        onClose()
      }} />
  )
}

export function OpenItemModal({ check, config, onClose }) {
  const approve = useApproval()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [course, setCourse] = useState(null)
  const add = async () => {
    const approver = await approve('price_override', null, 'Typing a price needs a manager.')
    if (approver === false) return
    const r = addOpenItem(check, { name, unit_price: poundsToPence(price), course, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  return (
    <Modal title="Item not on the menu" onClose={onClose} wide
      footer={<button className="btn btn-primary h-14" disabled={!name.trim() || !poundsToPence(price)} onClick={add}>Add {price ? '£' + price : ''}</button>}>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <input className="input" autoFocus placeholder="What is it?" value={name} onChange={e => setName(e.target.value)} maxLength={120} />
          <div className="text-3xl font-bold tabular-nums">£{price || '0'}</div>
          {coursesOn(config, check.revenue_stream_id) && (
            <div className="flex flex-wrap gap-2">
              {(config.courses || []).map(c => <button key={c.id} className={cx('chip', course === c.id && 'chip-on')} onClick={() => setCourse(course === c.id ? null : c.id)}>{c.name}</button>)}
            </div>
          )}
          <div className="text-xs text-muted">It goes to the venue's default printer, at the venue's default VAT for this revenue stream.</div>
        </div>
        <Keypad value={price} onChange={setPrice} decimal max={7} />
      </div>
    </Modal>
  )
}

export function NoSale({ onClose }) {
  const approve = useApproval()
  const [reason, setReason] = useState('')
  const go = async () => {
    const approver = await approve('open_drawer', null, 'Opening the drawer without a sale needs a manager.')
    if (approver === false) return
    const r = dispatch('drawer.opened', { reason: reason.trim() }, { approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    toast('Drawer opened (recorded)', 'ok')
    onClose()
  }
  return (
    <Modal title="No sale" onClose={onClose} footer={<button className="btn btn-primary" disabled={!reason.trim()} onClick={go}><Vault size={18} /> Open drawer</button>}>
      <ReasonPicker options={['Change for the float', 'Wrong change given', 'Count the drawer']} value={reason} onChange={setReason} />
    </Modal>
  )
}

// A dish sold out (or back on). Changes the website, online orders and the
// menu screens too, so it needs a connection.
export function SoldOutModal({ item, config, onClose, onAdd }) {
  const approve = useApproval()
  const [busy, setBusy] = useState(null)
  const sold = soldOutMap(config)
  const isSold = sold.has(item.id)
  const until = sold.get(item.id)
  const set = async mode => {
    const approver = await approve('sold_out', null, 'Marking dishes sold out needs a manager.')
    if (approver === false) return
    setBusy(String(mode))
    const r = await setItemSoldOut(item.id, mode, approver)
    setBusy(null)
    if (!r.ok) return toast(r.error, 'bad')
    toast(mode === false ? item.name + ' is back on' : item.name + ' is sold out', 'ok')
    onClose()
  }
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="space-y-3">
        {isSold && (
          <div className="rounded-xl bg-bad-soft text-bad p-3 text-sm font-semibold">
            Sold out {until ? 'until the end of today' : 'until someone puts it back on'}.
          </div>
        )}
        <p className="text-sm text-muted">Sold out shows on the website, online orders and the menu screens straight away.</p>
        {isSold ? (
          <button className="btn btn-ok w-full h-14" disabled={!!busy} onClick={() => set(false)}>
            <RotateCcw size={18} /> {busy === 'false' ? 'Saving…' : 'Back on sale'}
          </button>
        ) : (
          <>
            <button className="btn w-full h-14" disabled={!!busy} onClick={() => set('today')}>
              <Ban size={18} /> {busy === 'today' ? 'Saving…' : 'Sold out for today'}
            </button>
            <button className="btn w-full h-14" disabled={!!busy} onClick={() => set('indefinite')}>
              <Ban size={18} /> {busy === 'indefinite' ? 'Saving…' : 'Sold out until I put it back'}
            </button>
          </>
        )}
        {isSold && onAdd && (
          <button className="btn w-full h-14" onClick={() => { onClose(); onAdd(item) }}>
            <Plus size={18} /> Add it to the check anyway
          </button>
        )}
      </div>
    </Modal>
  )
}

export { Hourglass }
