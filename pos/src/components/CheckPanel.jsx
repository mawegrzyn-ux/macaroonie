// The check on the left of the order screen: what's on it, grouped by course
// (or seat), what has gone to the kitchen, what is waiting, and the totals.
//
// Swipe an item to the left: its button shows (Delete before it is sent,
// Void once the kitchen has it); a long swipe does it straight away. Drag an
// item by its grip to another course (items not sent yet) or, grouped by
// seat, to another seat.

import { useEffect, useRef, useState } from 'react'
import { Send, Hourglass, Flame, Ban, Gift, Percent, ChefHat, AlertTriangle, Layers, GripVertical, Trash2 } from 'lucide-react'
import { checkTotals, lineGross, modifierText, groupModifiers, isActiveLine } from '@shared/pos/pricing.js'
import { countParts } from '@shared/combos.js'
import { chargeLabel } from '@shared/pos/charges.js'
import { cx, money } from './ui.jsx'
import { groupByCourse, groupBySeat, canRegroup } from '../lib/checkOps.js'

const ACTION_W = 104   // the button a swipe shows
const SWIPE_START = 12 // px sideways before a press counts as a swipe
const EDGE = 64        // px from the list's top or bottom that scrolls it while dragging

function LineBody({ line, discountOf, comboOf }) {
  const voided = line.status === 'voided'
  const gross = lineGross(line)
  const off = discountOf(line.id)
  const mods = groupModifiers(line.modifiers)
  return (
    <>
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
    </>
  )
}

function LineRow({ line, discountOf, comboOf, swipe, dragOn, grip, dragging, onTap, onAction }) {
  const voided = line.status === 'voided'
  const shift = swipe.shiftOf(line.id)
  const sent = line.status !== 'new'
  return (
    <div className={cx('relative overflow-hidden border-b border-line/60', dragging && 'opacity-30')} data-line={line.id}>
      {!voided && (
        <button className="absolute inset-y-0 right-0 bg-bad text-white font-semibold flex flex-col items-center justify-center gap-1 touch-manipulation"
          style={{ width: ACTION_W }} tabIndex={-1} aria-hidden={shift === 0}
          data-testid="line-swipe-action" onClick={() => onAction(line)}>
          {sent ? <Ban size={20} /> : <Trash2 size={20} />}<span className="text-sm">{sent ? 'Void' : 'Delete'}</span>
        </button>
      )}
      <div className={cx('relative bg-white flex items-stretch', voided && 'opacity-50')}
        style={{ transform: shift ? `translateX(${shift}px)` : undefined, transition: swipe.isMoving(line.id) ? 'none' : 'transform 160ms ease-out' }}>
        {dragOn && (
          grip
            ? <span className="w-9 shrink-0 flex items-center justify-center text-muted cursor-grab" style={{ touchAction: 'none' }}
                data-testid="line-grip" aria-label={'Move ' + line.name} onPointerDown={e => grip(e, line)}><GripVertical size={18} /></span>
            : <span className="w-9 shrink-0" />
        )}
        <button
          onPointerDown={e => swipe.down(e, line, !voided)}
          onClick={() => { if (swipe.swallow(line.id)) return; onTap(line) }}
          style={{ touchAction: 'pan-y' }}
          className={cx('flex-1 min-w-0 text-left py-2.5 pr-3 flex gap-3 items-start touch-manipulation active:bg-page select-none', !dragOn && 'pl-3')}>
          <LineBody line={line} discountOf={discountOf} comboOf={comboOf} />
        </button>
      </div>
    </div>
  )
}

/** Swiping rows sideways: one row at a time shows its button. */
function useSwipe({ onAction }) {
  const [open, setOpen] = useState(null)       // line id showing its button
  const [moving, setMoving] = useState(null)   // { id, dx } while a finger moves it
  const g = useRef(null)
  const swallowed = useRef(null)
  const end = useRef(null)
  useEffect(() => () => end.current?.(), [])

  const down = (e, line, enabled) => {
    if (e.button > 0) return
    if (open && open !== line.id) { setOpen(null); swallowed.current = line.id; return }
    if (!enabled) return
    const row = e.currentTarget.closest('[data-line]')
    const s = { line, x: e.clientX, y: e.clientY, pid: e.pointerId, swiping: false, base: open === line.id ? -ACTION_W : 0, width: row?.offsetWidth || 400, target: e.currentTarget }
    g.current = s
    const move = ev => {
      if (ev.pointerId !== s.pid || g.current !== s) return
      const dx = ev.clientX - s.x
      const dy = ev.clientY - s.y
      if (!s.swiping) {
        if (Math.abs(dy) > SWIPE_START && Math.abs(dy) >= Math.abs(dx)) return finish()
        if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < Math.abs(dy) * 1.2) return
        s.swiping = true
        try { s.target.setPointerCapture(s.pid) } catch { /* not every pointer can be captured */ }
      }
      setMoving({ id: line.id, dx: Math.max(-s.width * 0.9, Math.min(0, s.base + dx)) })
    }
    const up = ev => {
      if (ev.pointerId !== s.pid) return
      if (s.swiping) {
        swallowed.current = line.id
        const off = Math.max(-s.width, Math.min(0, s.base + (ev.clientX - s.x)))
        setMoving(null)
        if (-off > s.width * 0.5) { setOpen(null); onAction(line) }
        else setOpen(-off > ACTION_W / 2 ? line.id : null)
      } else if (open === line.id) {
        // A tap on a row showing its button closes it.
        swallowed.current = line.id
        setOpen(null)
      }
      finish()
    }
    const cancel = ev => { if (ev.pointerId === s.pid) { setMoving(null); finish() } }
    function finish() {
      if (g.current === s) g.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      end.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    end.current = finish
  }
  return {
    down,
    shiftOf: id => (moving?.id === id ? moving.dx : open === id ? -ACTION_W : 0),
    isMoving: id => moving?.id === id,
    // The click a swipe or a closing tap ends with isn't a tap on the item.
    swallow: id => { if (swallowed.current === id) { swallowed.current = null; return true } return false },
    close: () => setOpen(null),
  }
}

/** Dragging an item by its grip to another group; the list scrolls near its edges. */
function useDrag({ listRef, by, onDrop }) {
  const [drag, setDrag] = useState(null) // { line, from, x, y, dx, dy, w, over }
  const last = useRef(null)
  useEffect(() => {
    if (!drag) return
    const t = setInterval(() => {
      const list = listRef.current
      const p = last.current
      if (!list || !p) return
      const r = list.getBoundingClientRect()
      if (p.y < r.top + EDGE) list.scrollTop -= 12
      else if (p.y > r.bottom - EDGE) list.scrollTop += 12
    }, 16)
    return () => clearInterval(t)
  }, [!!drag]) // eslint-disable-line react-hooks/exhaustive-deps

  const targetAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-drop]')?.getAttribute('data-drop') ?? null

  const start = (e, line, from) => {
    if (e.button > 0) return
    e.preventDefault()
    e.stopPropagation()
    const row = e.currentTarget.closest('[data-line]')
    const r = row.getBoundingClientRect()
    const el = e.currentTarget
    const pid = e.pointerId
    try { el.setPointerCapture(pid) } catch { /* not every pointer can be captured */ }
    const state = { line, from, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, over: from }
    last.current = state
    setDrag(state)
    navigator.vibrate?.(10)
    const move = ev => {
      if (ev.pointerId !== pid) return
      ev.preventDefault()
      const next = { ...last.current, x: ev.clientX, y: ev.clientY, over: targetAt(ev.clientX, ev.clientY) ?? last.current.over }
      last.current = next
      setDrag(next)
    }
    const up = ev => {
      if (ev.pointerId !== pid) return
      const over = targetAt(ev.clientX, ev.clientY)
      stop()
      if (over != null && over !== from) onDrop(line, { by, id: over })
    }
    const stop = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', stop)
      last.current = null
      setDrag(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', stop)
  }
  return { drag, start }
}

/**
 * onLine(line): an item tapped. onAction(line): its swipe button (Delete or
 * Void). onRegroup(line, { by: 'course' | 'seat', id }): dragged to another
 * course (id = course id, '' for none) or seat ('0' = shared).
 */
export default function CheckPanel({ check, config, onLine, onAction, onRegroup, footer, header }) {
  const [by, setBy] = useState('course')
  const listRef = useRef(null)
  const t = checkTotals(check)
  const offById = Object.fromEntries(t.lines.map(l => [l.id, l.discount]))
  // Automatic combos (shared/combos.js) found among the dishes: each dish says which.
  const comboById = {}
  for (const p of check.promotions || []) if (p.kind === 'combo') for (const id of Object.keys(p.lines || {})) comboById[id] = p.name
  const swipe = useSwipe({ onAction: line => onAction?.(line) })
  const { drag, start } = useDrag({ listRef, by, onDrop: (line, to) => onRegroup?.(line, to) })
  const hasSeats = check.lines.some(l => l.seat)
  const maxSeat = Math.max(2, Number(check.covers) || 0, ...check.lines.map(l => l.seat || 0))
  // While dragging, every course (or seat) is there to drop on, empty or not.
  const groups = by === 'seat' ? groupBySeat(check, { upTo: drag ? maxSeat : 0 }) : groupByCourse(check, config, { all: !!drag })
  const groupKey = g => (by === 'seat' ? g.id : g.id || '')
  const fired = id => check.courses?.[id]?.fired_at
  const canDrag = !!onRegroup && (by === 'seat' || (config.courses || []).length > 0)
  const dragOn = canDrag && check.lines.some(l => canRegroup(l, by))

  return (
    <div className="h-full flex flex-col bg-white border-r border-line min-w-0">
      {header}
      {hasSeats && (
        <div className="flex gap-1 px-3 py-2 border-b border-line">
          <button className={cx('chip min-h-[36px]', by === 'course' && 'chip-on')} onClick={() => setBy('course')}>By course</button>
          <button className={cx('chip min-h-[36px]', by === 'seat' && 'chip-on')} onClick={() => setBy('seat')}>By seat</button>
        </div>
      )}
      <div ref={listRef} className="flex-1 overflow-y-auto" data-testid="check-lines">
        {!check.lines.length && <div className="p-6 text-center text-muted">Nothing on this check yet. Tap dishes on the right.</div>}
        {groups.map(g => {
          const key = groupKey(g)
          const over = drag && drag.over === key
          const isFrom = drag && drag.from === key
          return (
            <div key={key || 'none'} data-drop={drag ? key : undefined} data-testid={drag ? 'drop-' + (g.name || '').toLowerCase().replace(/\s+/g, '-') : undefined}
              className={cx(drag && 'transition-colors', over && !isFrom && 'bg-brand-soft')}>
              {(groups.length > 1 || g.id) && (
                <div className={cx('sticky top-0 z-[1] px-3 py-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide border-b border-line',
                  over && !isFrom ? 'bg-brand text-white' : 'bg-page/95 backdrop-blur text-muted')}>
                  {g.name}
                  {by === 'course' && g.state?.held && !fired(g.id) && <span className="text-held flex items-center gap-1"><Hourglass size={12} />waiting to fire</span>}
                  {by === 'course' && fired(g.id) && <span className="text-ok flex items-center gap-1"><Flame size={12} />fired</span>}
                </div>
              )}
              {g.lines.map(l => (
                <LineRow key={l.id} line={l} discountOf={id => offById[id] || 0} comboOf={id => comboById[id] || null}
                  swipe={swipe} dragOn={dragOn} dragging={drag?.line.id === l.id}
                  grip={canDrag && canRegroup(l, by) ? (e, line) => { swipe.close(); start(e, line, key) } : null}
                  onTap={onLine} onAction={line => { swipe.close(); onAction?.(line) }} />
              ))}
              {drag && !g.lines.length && (
                <div className={cx('m-2 rounded-xl border-2 border-dashed min-h-[52px] flex items-center justify-center text-sm font-semibold', over ? 'border-brand text-brand' : 'border-line text-muted')}>
                  Drop here
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-t border-line px-4 py-3 space-y-1 text-[15px] shrink-0">
        <Row label="Subtotal" value={money(t.subtotal)} />
        {t.discounts.filter(d => d.amount > 0).map(d => (
          <Row key={d.id + d.name} label={<span className="flex items-center gap-1">{d.comp ? <Gift size={14} /> : d.combo ? <Layers size={14} /> : <Percent size={14} />}{d.name}</span>} value={'−' + money(d.amount)} className="text-ok" />
        ))}
        {t.charges.filter(x => x.amount > 0).map(x => (
          <Row key={x.id} label={chargeLabel(x)} value={money(x.amount)} />
        ))}
        <Row label={<b>Total</b>} value={<b className="text-xl">{money(t.total)}</b>} />
        {t.paid > 0 && <Row label="Paid" value={money(t.paid)} className="text-ok" />}
        {t.paid > 0 && <Row label={<b>Left to pay</b>} value={<b>{money(t.balance)}</b>} />}
      </div>
      {footer}
      {drag && (
        <div className="fixed z-[70] pointer-events-none rounded-xl bg-white shadow-2xl border-2 border-brand px-3 py-2.5 flex gap-3 items-center"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }} data-testid="line-drag-ghost">
          <GripVertical size={18} className="text-brand" />
          <span className="font-bold tabular-nums">{drag.line.qty}</span>
          <span className="font-semibold truncate flex-1">{drag.line.name}</span>
        </div>
      )}
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
