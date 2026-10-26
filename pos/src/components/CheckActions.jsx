// The check's actions beyond adding dishes: send (holding later courses),
// fire a course, discounts and comps, service charge, offers, move items to
// another check (split), merge checks, move table, change server, order type
// (with the name and tent number it asks for) or revenue stream, items not on
// the menu, no sale, dishes sold out.

import { useMemo, useState } from 'react'
import {
  Users, Table2, UserRound, Building2, Percent, HandCoins, Gift, Split, Merge, Flame, StickyNote, Printer,
  Vault, PenLine, Check, Hourglass, Send, XCircle, Ban, RotateCcw, Plus, ShoppingBag, Flag, Star,
} from 'lucide-react'
import { ulid } from '@shared/pos/ids.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { heldCourses, checkLabel } from '@shared/pos/checks.js'
import { Modal, Keypad, ReasonPicker, cx, money, poundsToPence, useApproval } from './ui.jsx'
import { dispatch, dispatchMany, toast, useChecks, getState, can, soldOutMap, setItemSoldOut, serverName } from '../lib/store.js'
import {
  defaultHeld, sendCheck, streamOf, byId, addOpenItem, promotionsFor, refreshPromotions,
  streamTypes, typeOf, promptsFor, rerateLines, defaultTypeId,
} from '../lib/checkOps.js'
import { CoversModal, CheckRow } from '../screens/Floor.jsx'

export function ActionsMenu({ check, config, onPick, onClose }) {
  const held = heldCourses(check)
  const items = [
    { key: 'covers', label: 'Guests', icon: Users, hint: check.covers ? check.covers + ' covers' : 'not set' },
    { key: 'table', label: check.table_id ? 'Move table' : 'Put on a table', icon: Table2 },
    { key: 'name', label: 'Name', icon: StickyNote, hint: check.tab_name || '' },
    { key: 'type', label: 'Order type', icon: ShoppingBag, hint: [typeOf(config, check.order_type_id)?.name, check.tent ? 'Tent ' + check.tent : null].filter(Boolean).join(' · ') },
    (promptsFor(config, check.revenue_stream_id, check.order_type_id).ask_tent !== 'off' || check.tent) && { key: 'tent', label: 'Tent number', icon: Flag, hint: check.tent || 'not set' },
    { key: 'server', label: 'Server', icon: UserRound, hint: serverName(config, check.server_id) },
    (config.revenue_streams || []).length > 1 && { key: 'stream', label: 'Revenue stream', icon: Building2, hint: streamOf(config, check.revenue_stream_id)?.name },
    held.length > 0 && { key: 'fire', label: 'Fire a course', icon: Flame, hint: held.length + ' waiting' },
    { key: 'discount', label: 'Discount', icon: Percent },
    { key: 'sc', label: 'Service charge', icon: HandCoins, hint: check.service_charge && !check.service_charge.removed ? (check.service_charge.percent != null ? check.service_charge.percent + '%' : money(check.service_charge.amount)) : 'none' },
    config.loyalty && { key: 'loyalty', label: config.loyalty.name || 'Loyalty', icon: Star, hint: check.loyalty?.name || 'add a member' },
    (config.promotions || []).length > 0 && { key: 'offers', label: 'Offers', icon: Gift, hint: (check.promotions || []).length ? check.promotions.length + ' on' : '' },
    { key: 'move', label: 'Split / move items', icon: Split },
    { key: 'merge', label: 'Merge checks', icon: Merge },
    { key: 'open_item', label: 'Item not on menu', icon: PenLine },
    { key: 'bill', label: 'Print bill', icon: Printer },
    { key: 'drawer', label: 'No sale (open drawer)', icon: Vault },
    !check.lines.length && !(check.payments || []).some(p => !p.voided) && { key: 'void_check', label: 'Close empty check', icon: XCircle },
  ].filter(Boolean)
  return (
    <Modal title={'Check ' + checkLabel(check)} onClose={onClose} wide>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {items.map(it => (
          <button key={it.key} className="btn h-auto min-h-[64px] py-2 justify-start text-left" onClick={() => onPick(it.key)}>
            <it.icon size={22} className="shrink-0 text-brand" />
            <span className="flex flex-col leading-tight min-w-0"><span>{it.label}</span>{it.hint ? <span className="text-xs text-muted font-normal truncate">{it.hint}</span> : null}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

// ── Send ─────────────────────────────────────────────────────────

/** Send new items; asks which later courses should wait when there are any. */
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
    <Modal title="Send to the kitchen" onClose={onClose} footer={<button className="btn btn-primary h-14 min-w-[200px]" onClick={go}><Send size={20} /> Send</button>}>
      <div className="space-y-3">
        <div className="text-[15px]">Courses that wait are sent now with HOLD on the ticket; fire them when the table is ready.</div>
        {fresh.sort((a, b) => (courses[a]?.sort_order ?? 0) - (courses[b]?.sort_order ?? 0)).map(id => {
          const on = held.includes(id)
          return (
            <button key={id} className={cx('w-full card p-4 flex items-center gap-3 text-left', on && 'border-held bg-held-soft')} onClick={() => setHeld(on ? held.filter(x => x !== id) : [...held, id])}>
              <span className={cx('w-7 h-7 rounded-lg border-2 flex items-center justify-center', on ? 'bg-held border-held text-white' : 'border-line')}>{on && <Check size={16} />}</span>
              <span className="flex-1 font-semibold">{courses[id]?.name || 'Course'}</span>
              <span className={cx('text-sm font-semibold', on ? 'text-held' : 'text-ok')}>{on ? 'Wait (hold)' : 'Cook now'}</span>
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

// ── Discounts and service charge ─────────────────────────────────

const DISCOUNT_REASONS = ['Regular', 'Staff', 'Complaint', 'Manager decision', 'Promotion']

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
  const apply = async () => {
    const approver = await approve('discount', Math.min(100, pct), 'This discount is more than your role allows.')
    if (approver === false) return
    const r = dispatch('discount.applied', {
      discount: {
        id: ulid(), scope: lineIds ? 'line' : 'check', line_ids: lineIds || [], type,
        value: type === 'percent' ? Math.min(100, v) : v,
        name: type === 'percent' ? v + '% off' : money(v) + ' off', reason: reason.trim(),
      },
    }, { check_id: check.id, approved_by: approver })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  const existing = (check.discounts || []).filter(d => d.scope === 'check')
  return (
    <Modal title={'Discount ' + names} onClose={onClose} wide
      footer={<button className="btn btn-primary h-14 min-w-[200px]" disabled={!v || off <= 0} onClick={apply}><Percent size={18} /> Take off {money(off)}</button>}>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-4">
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
          <div className="text-sm text-muted">On {money(base)}{can('discount', pct) ? '' : ' · needs a manager above your limit'}</div>
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

export function ServiceChargeModal({ check, config, onClose }) {
  const [reason, setReason] = useState('')
  const [custom, setCustom] = useState('')
  const sc = check.service_charge
  const set = payload => {
    const r = dispatch('service_charge.set', payload, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  const rcPct = Number(streamOf(config, check.revenue_stream_id)?.service_charge_percent) || 12.5
  return (
    <Modal title="Service charge" onClose={onClose}>
      <div className="space-y-4">
        <div className="text-[15px]">Now: <b>{sc && !sc.removed ? (sc.percent != null ? sc.percent + '%' : money(sc.amount)) : 'none'}</b></div>
        <div className="flex flex-wrap gap-2">
          {[...new Set([rcPct, 10, 12.5, 15])].map(p => <button key={p} className={cx('chip', sc && !sc.removed && sc.percent === p && 'chip-on')} onClick={() => set({ percent: p })}>{p}%</button>)}
        </div>
        <div className="flex gap-2">
          <input className="input" inputMode="decimal" placeholder="Other %" value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} />
          <button className="btn" disabled={!Number(custom)} onClick={() => set({ percent: Math.min(50, Number(custom)) })}>Set</button>
        </div>
        {sc && !sc.removed && (
          <div className="rounded-xl border border-line p-3 space-y-3">
            <div className="font-semibold">Take service charge off</div>
            <ReasonPicker options={['Guest asked', 'Complaint', 'Large party agreed']} value={reason} onChange={setReason} />
            <button className="btn btn-bad" disabled={!reason.trim()} onClick={() => set({ removed: true, reason: reason.trim() })}>Take it off</button>
          </div>
        )}
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
        service_charge: check.service_charge && !check.service_charge.removed ? { percent: check.service_charge.percent ?? 0, vat_rate: check.service_charge.vat_rate || 0 } : null,
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

export function NameModal({ check, onClose }) {
  const [name, setName] = useState(check.tab_name || '')
  const save = () => {
    const r = dispatch('check.renamed', { tab_name: name.trim() || null }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  return (
    <Modal title="Name on the check" onClose={onClose} footer={<button className="btn btn-primary" onClick={save}>Save</button>}>
      <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Smith" />
    </Modal>
  )
}

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

const PROMPT_TEXT = { ask: '', required: ' (needed)' }

/** Customer name and tent number fields, as the order type asks for them. */
export function DetailFields({ prompts, name, setName, tent, setTent, autoFocus = false }) {
  return (
    <div className="space-y-3">
      {prompts.ask_name !== 'off' && (
        <label className="block">
          <span className="label">Customer name{PROMPT_TEXT[prompts.ask_name]}</span>
          <input className="input mt-1" data-testid="detail-name" autoFocus={autoFocus} value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Sam" />
        </label>
      )}
      {prompts.ask_tent !== 'off' && (
        <label className="block">
          <span className="label">Tent number{PROMPT_TEXT[prompts.ask_tent]}</span>
          <input className="input mt-1" data-testid="detail-tent" inputMode="numeric" autoFocus={autoFocus && prompts.ask_name === 'off'}
            value={tent} onChange={e => setTent(e.target.value)} maxLength={20} placeholder="e.g. 14" />
        </label>
      )}
    </div>
  )
}

/** Which required details are still empty, as words for a message. */
export function missingText(prompts, name, tent) {
  const out = []
  if (prompts.ask_name === 'required' && !name.trim()) out.push('a customer name')
  if (prompts.ask_tent === 'required' && !tent.trim()) out.push('a tent number')
  return out.length ? 'Enter ' + out.join(' and ') : null
}

/**
 * The check's order type (Eat in, Take out, ...): the types its revenue
 * stream offers, then the name and tent number the chosen one asks for.
 * Changing the type re-rates every item (tax can depend on it).
 */
export function OrderTypeModal({ check, config, onClose, focus = null }) {
  const types = streamTypes(config, check.revenue_stream_id)
  const [typeId, setTypeId] = useState(check.order_type_id || types[0]?.type.id || null)
  const [name, setName] = useState(check.tab_name || '')
  const [tent, setTent] = useState(check.tent || '')
  const prompts = promptsFor(config, check.revenue_stream_id, typeId)
  const save = () => {
    const missing = missingText(prompts, name, tent)
    if (missing) return toast(missing, 'bad')
    const payload = { order_type_id: typeId }
    if ((name.trim() || null) !== (check.tab_name || null)) payload.tab_name = name.trim() || null
    if ((tent.trim() || null) !== (check.tent || null)) payload.tent = tent.trim() || null
    if (typeId !== check.order_type_id) payload.lines = rerateLines(check, config, { order_type_id: typeId })
    if (typeId === check.order_type_id && payload.tab_name === undefined && payload.tent === undefined) return onClose()
    const r = dispatch('check.order_type_set', payload, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    onClose()
  }
  return (
    <Modal title={focus === 'tent' ? 'Tent number' : 'Order type'} onClose={onClose} footer={<button className="btn btn-primary h-14 min-w-[160px]" data-testid="type-save" onClick={save}>Save</button>}>
      <div className="space-y-4">
        {focus !== 'tent' && (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Order type">
            {types.map(({ type }) => (
              <button key={type.id} className={cx('btn h-14', type.id === typeId && 'btn-primary')} onClick={() => setTypeId(type.id)}>{type.name}</button>
            ))}
            {!types.length && <div className="text-sm text-muted col-span-2">This revenue stream has no order types switched on (Store tech, Revenue streams).</div>}
          </div>
        )}
        <DetailFields prompts={focus === 'tent' ? { ask_name: 'off', ask_tent: prompts.ask_tent === 'off' ? 'ask' : prompts.ask_tent } : prompts}
          name={name} setName={setName} tent={tent} setTent={setTent} autoFocus={focus === 'tent'} />
        {typeId !== check.order_type_id && check.lines.some(l => l.status !== 'voided') && (
          <div className="text-sm text-muted">The items already on the check take this order type's tax.</div>
        )}
      </div>
    </Modal>
  )
}

/** The revenue stream the check's sales count under. Items move with it and take its tax. */
export function StreamModal({ check, config, onClose }) {
  const set = streamId => {
    if (streamId === check.revenue_stream_id) return onClose()
    // A type the new stream doesn't offer becomes its default.
    const offered = streamTypes(config, streamId).some(x => x.type.id === check.order_type_id)
    const specs = [['check.stream_set', { revenue_stream_id: streamId, lines: rerateLines(check, config, { revenue_stream_id: streamId }) }, { check_id: check.id }]]
    if (!offered) {
      const typeId = defaultTypeId(config, streamId)
      if (typeId) specs.push(['check.order_type_set', { order_type_id: typeId, lines: rerateLines(check, config, { revenue_stream_id: streamId, order_type_id: typeId }) }, { check_id: check.id }])
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
    <CoversModal title={table ? 'Table ' + table.label : 'Check ' + checkLabel(check)} max={table?.max_covers} initial={check.covers} onClose={onClose}
      onDone={n => {
        const specs = [['check.covers_set', { covers: n }, { check_id: check.id }]]
        // A revenue stream's service charge from N guests up starts when the party reaches N.
        const rs = streamOf(config, check.revenue_stream_id)
        if (rs && Number(rs.service_charge_percent) && Number(rs.service_charge_min_covers) && n >= rs.service_charge_min_covers && !check.service_charge) {
          specs.push(['service_charge.set', { percent: Number(rs.service_charge_percent) }, { check_id: check.id }])
        }
        const r = dispatchMany(specs)
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
          <div className="flex flex-wrap gap-2">
            {(config.courses || []).map(c => <button key={c.id} className={cx('chip', course === c.id && 'chip-on')} onClick={() => setCourse(course === c.id ? null : c.id)}>{c.name}</button>)}
          </div>
          <div className="text-xs text-muted">It goes to the venue's default printer, at the venue's default VAT for this revenue centre.</div>
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
