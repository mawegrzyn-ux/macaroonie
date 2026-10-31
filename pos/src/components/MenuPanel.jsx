// The till's menu: menus and sections as tabs, dishes as big buttons, a
// search box, and the seat / course the next dish goes to. The layout comes
// from the menu builder for now; a till layout designer (docs/POS.md
// Phase 7) will be able to arrange the buttons.
//
// Holding a dish down (or tapping one that is sold out) calls onHold: the
// sold out window (CheckActions.jsx SoldOutModal).

import { useMemo, useRef, useState } from 'react'
import { Search, X, PenLine } from 'lucide-react'
import { fromPrice, priceVaries } from '@shared/orderPricing.js'
import { cx, money } from './ui.jsx'
import { tillItem } from '../lib/checkOps.js'
import { soldOutMap } from '../lib/store.js'

const HOLD_MS = 550

// A dish button: tap picks it, holding it down opens the sold out window.
function DishButton({ item, colour, priceText, soldOut, onPick, onHold }) {
  const timer = useRef(null)
  const held = useRef(false)
  const start = () => {
    held.current = false
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { held.current = true; onHold?.(item) }, HOLD_MS)
  }
  const cancel = () => clearTimeout(timer.current)
  return (
    <button
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onContextMenu={e => e.preventDefault()}
      onClick={() => {
        if (held.current) { held.current = false; return }
        if (soldOut && onHold) return onHold(item)
        onPick(item)
      }}
      className={cx('relative rounded-xl border min-h-[84px] p-3 text-left flex flex-col justify-between touch-manipulation active:scale-[0.97] transition-transform overflow-hidden select-none',
        soldOut ? 'bg-page border-line text-muted' : 'bg-white border-line')}>
      <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: colour, opacity: soldOut ? 0.35 : 1 }} />
      <span className={cx('font-semibold leading-tight text-[15px] line-clamp-3 pl-1', soldOut && 'line-through')}>{item.name}</span>
      <span className="text-sm text-muted pl-1 mt-1 tabular-nums">
        {soldOut ? <span className="font-bold text-bad uppercase text-xs tracking-wide">Sold out</span> : priceText}
      </span>
    </button>
  )
}

const SECTION_COLOURS = ['#2f5bd3', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f', '#a21caf']
// The seat and course buttons: the height of the Pay button.
const BAR = 'chip shrink-0 h-16 min-w-[64px] rounded-xl px-5 text-base'

export default function MenuPanel({ config, menuIds = null, onPick, onHold, seat, setSeat, course, setCourse, covers, onOpenItem }) {
  const soldOut = useMemo(() => soldOutMap(config), [config])
  // Combos' dishes, for their "from" price (shared/combos.js).
  const comboRefs = useMemo(() => ({ itemsById: config.items || {}, sectionItems: config.section_items || {} }), [config])
  const menus = useMemo(() => {
    const all = config.menus || []
    const only = menuIds?.length ? all.filter(m => menuIds.includes(m.id)) : all
    return only.length ? only : all
  }, [config, menuIds])
  const [menuId, setMenuId] = useState(menus[0]?.id)
  const menu = menus.find(m => m.id === menuId) || menus[0]
  const [sectionId, setSectionId] = useState(null)
  const [q, setQ] = useState('')
  const sections = menu?.sections || []
  const section = sections.find(s => s.id === sectionId) || sections[0]

  const items = useMemo(() => {
    if (q.trim()) {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const seen = new Set()
      const out = []
      for (const m of menus) for (const s of m.sections) for (const id of s.item_ids) {
        const it = config.items[id]
        if (!it || seen.has(id)) continue
        const hay = (it.name + ' ' + (it.kitchen_name || '')).toLowerCase()
        if (words.every(w => hay.includes(w))) { seen.add(id); out.push(it) }
      }
      return out.slice(0, 60)
    }
    return (section?.item_ids || []).map(id => config.items[id]).filter(Boolean)
  }, [q, menus, section, config])

  const colourOf = (s, i) => s?.colour || SECTION_COLOURS[i % SECTION_COLOURS.length]
  const sectionIndex = sections.indexOf(section)

  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="flex items-center gap-2 p-3 pb-2">
        {menus.length > 1 && (
          <div className="flex gap-1 scroll-x shrink-0 max-w-[45%]">
            {menus.map(m => (
              <button key={m.id} className={cx('chip shrink-0', m.id === menu?.id && 'chip-on')} onClick={() => { setMenuId(m.id); setSectionId(null) }}>{m.name}</button>
            ))}
          </div>
        )}
        <div className="relative flex-1 min-w-[140px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-10 pr-10" placeholder="Find a dish" value={q} onChange={e => setQ(e.target.value)} />
          {q && <button className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center" onClick={() => setQ('')}><X size={18} /></button>}
        </div>
        <button className="btn shrink-0" onClick={onOpenItem} title="Item not on the menu"><PenLine size={18} /><span className="hidden xl:inline">Open item</span></button>
      </div>

      {!q && (
        <div className="flex gap-2 px-3 pb-2 scroll-x shrink-0">
          {sections.map((s, i) => (
            <button key={s.id} onClick={() => setSectionId(s.id)}
              className={cx('shrink-0 rounded-xl px-4 min-h-[48px] font-semibold border-2 touch-manipulation', s.id === section?.id ? 'text-white' : 'bg-white')}
              style={s.id === section?.id ? { background: colourOf(s, i), borderColor: colourOf(s, i) } : { borderColor: colourOf(s, i), color: colourOf(s, i) }}>
              {s.title}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>
          {items.map(it => {
            const t = tillItem(config, it.id)
            const price = fromPrice(t, t.pos_choices, comboRefs)
            const colour = it.colour || (!q ? colourOf(section, sectionIndex) : '#64708a')
            const priceText = (t.kind === 'combo' ? 'Combo ' : '') + (priceVaries(t, t.pos_choices, comboRefs) ? 'from ' : '') + (price != null ? money(price) : '')
            return <DishButton key={it.id} item={it} colour={colour} priceText={priceText} soldOut={soldOut.has(it.id)} onPick={onPick} onHold={onHold} />
          })}
          {!items.length && <div className="text-muted p-4 col-span-full">{q ? 'No dish matches.' : 'This section has no dishes.'}</div>}
        </div>
      </div>

      {/* As tall as the check's Pay row beside it (p-2 + h-16), so the two line up. */}
      <div className="border-t border-line bg-white p-2 flex items-center gap-2 scroll-x shrink-0" data-testid="seat-course-bar">
        <span className="label shrink-0 pl-1">Seat</span>
        <button className={cx(BAR, seat == null && 'chip-on')} onClick={() => setSeat(null)}>Shared</button>
        {Array.from({ length: Math.max(2, Math.min(12, covers || 4)) }).map((_, i) => (
          <button key={i} className={cx(BAR, 'w-16 px-0', seat === i + 1 && 'chip-on')} onClick={() => setSeat(seat === i + 1 ? null : i + 1)}>{i + 1}</button>
        ))}
        {(config.courses || []).length > 0 && <>
          <span className="label shrink-0 ml-3">Course</span>
          <button className={cx(BAR, course == null && 'chip-on')} onClick={() => setCourse(null)}>Usual</button>
          {config.courses.map(c => (
            <button key={c.id} className={cx(BAR, course === c.id && 'chip-on')} onClick={() => setCourse(course === c.id ? null : c.id)}>{c.short_name || c.name}</button>
          ))}
        </>}
      </div>
    </div>
  )
}
