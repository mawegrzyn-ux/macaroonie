// The check on the left of the order screen: what's on it, grouped by course
// (or seat), what has gone to the kitchen, what is waiting, and the totals.

import { useState } from 'react'
import { Send, Hourglass, Flame, Ban, Gift, Percent, ChefHat, AlertTriangle, Layers } from 'lucide-react'
import { checkTotals, lineGross, modifierText, groupModifiers, isActiveLine } from '@shared/pos/pricing.js'
import { countParts } from '@shared/combos.js'
import { cx, money } from './ui.jsx'
import { groupByCourse, groupBySeat } from '../lib/checkOps.js'

function LineRow({ line, discountOf, comboOf, onTap }) {
  const voided = line.status === 'voided'
  const gross = lineGross(line)
  const off = discountOf(line.id)
  const mods = groupModifiers(line.modifiers)
  return (
    <button onClick={() => onTap(line)} className={cx('w-full text-left px-3 py-2.5 flex gap-3 items-start touch-manipulation active:bg-page border-b border-line/60', voided && 'opacity-50')}>
      <div className="w-8 shrink-0 font-bold tabular-nums text-right">{line.qty}</div>
      <div className="flex-1 min-w-0">
        <div className={cx('font-semibold leading-snug', voided && 'line-through')}>
          {line.name}
          {line.seat ? <span className="ml-2 text-xs font-bold text-brand bg-brand-soft rounded px-1.5 py-0.5 align-middle">S{line.seat}</span> : null}
        </div>
        {mods.length > 0 && (
          <div className="text-sm text-muted leading-snug">
            {mods.map((m, i) => <span key={i} className={cx(m.prefix === 'no' && 'text-bad')}>{i ? ', ' : ''}{modifierText(m)}{m.price ? ' +' + money(m.price) : ''}</span>)}
          </div>
        )}
        {countParts(line.combo).map(({ part: c, count }, i) => (
          <div key={i} className="text-sm text-muted leading-snug pl-3">› {count > 1 ? count + ' x ' : ''}{c.name}{c.upcharge ? ' +' + money(c.upcharge * count) : ''}{(c.modifiers || []).length ? ' (' + groupModifiers(c.modifiers).map(modifierText).join(', ') + ')' : ''}</div>
        ))}
        {comboOf(line.id) && <div className="text-xs font-bold text-brand mt-0.5">In {comboOf(line.id)}</div>}
        {line.note && <div className="text-sm text-ink italic">“{line.note}”</div>}
        {(line.allergies || []).length > 0 && (
          <div className="text-xs font-bold text-white bg-bad rounded px-1.5 py-0.5 inline-flex items-center gap-1 mt-1"><AlertTriangle size={12} />{line.allergies.join(', ')}</div>
        )}
        <div className="flex gap-2 mt-1 text-xs font-semibold">
          {line.status === 'new' && <span className="text-warn">Not sent</span>}
          {line.status === 'sent' && !line.held && <span className="text-ok flex items-center gap-1"><ChefHat size={12} />Sent</span>}
          {line.status === 'sent' && line.held && <span className="text-held flex items-center gap-1"><Hourglass size={12} />Waiting</span>}
          {voided && <span className="text-bad flex items-center gap-1"><Ban size={12} />Voided: {line.voided?.reason}</span>}
          {line.price_override && <span className="text-muted">Price changed</span>}
        </div>
      </div>
      <div className="text-right shrink-0 tabular-nums">
        <div className={cx('font-semibold', (voided || off >= gross) && 'line-through text-muted')}>{money(gross)}</div>
        {off > 0 && !voided && <div className="text-xs text-ok font-semibold">−{money(off)}</div>}
      </div>
    </button>
  )
}

export default function CheckPanel({ check, config, onLine, footer, header }) {
  const [by, setBy] = useState('course')
  const t = checkTotals(check)
  const offById = Object.fromEntries(t.lines.map(l => [l.id, l.discount]))
  // Automatic combos (shared/combos.js) found among the dishes: each dish says which.
  const comboById = {}
  for (const p of check.promotions || []) if (p.kind === 'combo') for (const id of Object.keys(p.lines || {})) comboById[id] = p.name
  const groups = by === 'seat' ? groupBySeat(check) : groupByCourse(check, config)
  const hasSeats = check.lines.some(l => l.seat)
  const fired = id => check.courses?.[id]?.fired_at

  return (
    <div className="h-full flex flex-col bg-white border-r border-line min-w-0">
      {header}
      {hasSeats && (
        <div className="flex gap-1 px-3 py-2 border-b border-line">
          <button className={cx('chip min-h-[36px]', by === 'course' && 'chip-on')} onClick={() => setBy('course')}>By course</button>
          <button className={cx('chip min-h-[36px]', by === 'seat' && 'chip-on')} onClick={() => setBy('seat')}>By seat</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {!check.lines.length && <div className="p-6 text-center text-muted">Nothing on this check yet. Tap dishes on the right.</div>}
        {groups.map(g => (
          <div key={g.id ?? 'none'}>
            {(groups.length > 1 || g.id) && (
              <div className="sticky top-0 z-[1] bg-page/95 backdrop-blur px-3 py-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted border-b border-line">
                {g.name}
                {by === 'course' && g.state?.held && !fired(g.id) && <span className="text-held flex items-center gap-1"><Hourglass size={12} />waiting to fire</span>}
                {by === 'course' && fired(g.id) && <span className="text-ok flex items-center gap-1"><Flame size={12} />fired</span>}
              </div>
            )}
            {g.lines.map(l => <LineRow key={l.id} line={l} discountOf={id => offById[id] || 0} comboOf={id => comboById[id] || null} onTap={onLine} />)}
          </div>
        ))}
      </div>
      <div className="border-t border-line px-4 py-3 space-y-1 text-[15px] shrink-0">
        <Row label="Subtotal" value={money(t.subtotal)} />
        {t.discounts.filter(d => d.amount > 0).map(d => (
          <Row key={d.id + d.name} label={<span className="flex items-center gap-1">{d.comp ? <Gift size={14} /> : d.combo ? <Layers size={14} /> : <Percent size={14} />}{d.name}</span>} value={'−' + money(d.amount)} className="text-ok" />
        ))}
        {t.service_charge > 0 && <Row label={'Service charge' + (check.service_charge?.percent ? ' ' + check.service_charge.percent + '%' : '')} value={money(t.service_charge)} />}
        <Row label={<b>Total</b>} value={<b className="text-xl">{money(t.total)}</b>} />
        {t.paid > 0 && <Row label="Paid" value={money(t.paid)} className="text-ok" />}
        {t.paid > 0 && <Row label={<b>Left to pay</b>} value={<b>{money(t.balance)}</b>} />}
      </div>
      {footer}
    </div>
  )
}

function Row({ label, value, className }) {
  return <div className={cx('flex justify-between gap-3 tabular-nums', className)}><span>{label}</span><span>{value}</span></div>
}

export function unsentCount(check) {
  return check.lines.filter(l => l.status === 'new').length
}
export { isActiveLine, Send }
