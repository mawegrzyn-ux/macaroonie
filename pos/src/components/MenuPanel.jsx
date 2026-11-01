// The till's menu on the standard screen: the sections of the menus on now
// as tabs (lib/tillMenus.js: the menu times, or what staff picked in More >
// Menus), dishes as big buttons, a search box, and the seat / course the next
// dish goes to.
// A till with a layout (Store tech > Till layouts) draws LayoutScreen.jsx
// instead, from the same pieces (DishButton, SeatCourseBar, dishPriceText).
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

/** Tap does one thing, holding the button down another (the sold out window). */
export function useHold(onTap, onHold) {
  const timer = useRef(null)
  const held = useRef(false)
  const start = () => {
    held.current = false
    clearTimeout(timer.current)
    if (onHold) timer.current = setTimeout(() => { held.current = true; onHold() }, HOLD_MS)
  }
  const cancel = () => clearTimeout(timer.current)
  return {
    onPointerDown: start, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel,
    onContextMenu: e => e.preventDefault(),
    onClick: () => {
      if (held.current) { held.current = false; return }
      onTap()
    },
  }
}

// A dish button: tap picks it, holding it down opens the sold out window.
// fill: it takes its cell (till layouts) instead of its own height; font and
// price follow the zone (the price line can be switched off), and so does
// where the words sit (place: the zone's buttonTextStyle()).
export function DishButton({ item, colour, priceText, soldOut, onPick, onHold, fill = false, showPrice = true, place = null }) {
  const hold = useHold(() => (soldOut && onHold ? onHold(item) : onPick(item)), onHold ? () => onHold(item) : null)
  return (
    <button {...hold} data-testid="dish" data-item={item.id}
      className={cx('relative rounded-xl border p-3 flex flex-col touch-manipulation active:scale-[0.97] transition-transform overflow-hidden select-none',
        !place && 'text-left justify-between',
        fill ? 'w-full h-full py-2' : 'min-h-[84px]',
        soldOut ? 'bg-page border-line text-muted' : 'bg-white border-line')}
      style={place || undefined}>
      <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: colour, opacity: soldOut ? 0.35 : 1 }} />
      <span className={cx('leading-tight line-clamp-3 pl-1', !fill && 'font-semibold text-[15px]', soldOut && 'line-through')} data-testid="button-words">{item.name}</span>
      {(showPrice || soldOut) && (
        <span className={cx('text-muted pl-1 mt-1 tabular-nums', fill ? 'text-[0.8em] font-medium' : 'text-sm')}>
          {soldOut ? <span className="font-bold text-bad uppercase text-xs tracking-wide">Sold out</span> : priceText}
        </span>
      )}
    </button>
  )
}

export const SECTION_COLOURS = ['#2f5bd3', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f', '#a21caf']

/** "£4.50", "from £8.00", "Combo from £9.95": a dish's price as its button shows it. */
export function dishPriceText(config, id, comboRefs) {
  const t = tillItem(config, id)
  const price = fromPrice(t, t.pos_choices, comboRefs)
  return (t.kind === 'combo' ? 'Combo ' : '') + (priceVaries(t, t.pos_choices, comboRefs) ? 'from ' : '') + (price != null ? money(price) : '')
}

// The seat and course buttons: the height of the Pay button.
const BAR = 'chip shrink-0 h-16 min-w-[64px] rounded-xl px-5 text-base'

/**
 * The seat and course the next dish goes to. fill: the bar takes its zone's
 * height (till layouts), with the zone's text size. parts: both, seats or
 * courses (a layout's Seat and course zone can show just one of them).
 */
export function SeatCourseBar({ config, seat, setSeat, course, setCourse, covers, fill = false, font = null, parts = 'both' }) {
  const bar = fill ? 'chip shrink-0 h-full max-h-20 min-h-[48px] min-w-[64px] rounded-xl px-5' : BAR
  // parts: 'both' | 'seats' | 'courses' (a till layout's zone), or 'none' when
  // the check's revenue stream uses neither (seatCourseParts() in lib/checkOps.js).
  const seats = parts === 'both' || parts === 'seats'
  const courses = (parts === 'both' || parts === 'courses') && (config.courses || []).length > 0
  return (
    <div className={cx('flex items-center gap-2 scroll-x', fill ? 'h-full p-2' : 'border-t border-line bg-white p-2 shrink-0')}
      style={font ? { fontSize: font + 'px' } : undefined} data-testid="seat-course-bar" data-parts={parts}>
      {seats && <>
        <span className="label shrink-0 pl-1">Seat</span>
        <button className={cx(bar, seat == null && 'chip-on')} onClick={() => setSeat(null)} data-testid="seat-shared">Shared</button>
        {Array.from({ length: Math.max(2, Math.min(12, covers || 4)) }).map((_, i) => (
          <button key={i} className={cx(bar, 'w-16 px-0', seat === i + 1 && 'chip-on')} onClick={() => setSeat(seat === i + 1 ? null : i + 1)} data-testid="seat-chip">{i + 1}</button>
        ))}
      </>}
      {courses && <>
        <span className={cx('label shrink-0', seats ? 'ml-3' : 'pl-1')}>Course</span>
        <button className={cx(bar, course == null && 'chip-on')} onClick={() => setCourse(null)} data-testid="course-usual">Usual</button>
        {config.courses.map(c => (
          <button key={c.id} className={cx(bar, course === c.id && 'chip-on')} onClick={() => setCourse(course === c.id ? null : c.id)} data-testid="course-chip">{c.short_name || c.name}</button>
        ))}
      </>}
      {!seats && !courses && <span className="text-sm text-muted pl-1" data-testid="no-courses">{parts === 'none' ? 'This revenue stream uses no seats or courses.' : 'No courses set up at this location.'}</span>}
    </div>
  )
}

/** menus: the menus to show now (useShownMenus().shown), their sections one after another. */
/** parts: what the seat and course bar shows (seatCourseParts()); 'none' leaves the bar out. */
export default function MenuPanel({ config, menus, onPick, onHold, seat, setSeat, course, setCourse, covers, onOpenItem, parts = 'both' }) {
  const soldOut = useMemo(() => soldOutMap(config), [config])
  // Combos' dishes, for their "from" price (shared/combos.js).
  const comboRefs = useMemo(() => ({ itemsById: config.items || {}, sectionItems: config.section_items || {} }), [config])
  const [sectionId, setSectionId] = useState(null)
  const [q, setQ] = useState('')
  // Each section with its place in its menu (for its colour).
  const tabs = useMemo(() => (menus || []).flatMap(m => m.sections.map((s, i) => ({ s, i }))), [menus])
  const sections = tabs.map(t => t.s)
  const section = sections.find(s => s.id === sectionId) || sections[0]

  const items = useMemo(() => {
    if (q.trim()) {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const seen = new Set()
      const out = []
      for (const m of menus || []) for (const s of m.sections) for (const id of s.item_ids) {
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
  const sectionIndex = tabs.find(t => t.s === section)?.i ?? 0

  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="flex items-center gap-2 p-3 pb-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-10 pr-10" placeholder="Find a dish" value={q} onChange={e => setQ(e.target.value)} />
          {q && <button className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center" onClick={() => setQ('')}><X size={18} /></button>}
        </div>
        <button className="btn shrink-0" onClick={onOpenItem} title="Item not on the menu"><PenLine size={18} /><span className="hidden xl:inline">Open item</span></button>
      </div>

      {!q && (
        <div className="flex gap-2 px-3 pb-2 scroll-x shrink-0">
          {tabs.map(({ s, i }) => (
            <button key={s.id} onClick={() => setSectionId(s.id)} data-testid="section-tab" data-on={s.id === section?.id ? '1' : '0'}
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
            const colour = it.colour || (!q ? colourOf(section, sectionIndex) : '#64708a')
            return <DishButton key={it.id} item={it} colour={colour} priceText={dishPriceText(config, it.id, comboRefs)} soldOut={soldOut.has(it.id)} onPick={onPick} onHold={onHold} />
          })}
          {!items.length && <div className="text-muted p-4 col-span-full">{q ? 'No dish matches.' : sections.length ? 'This section has no dishes.' : 'No menu on this till.'}</div>}
        </div>
      </div>

      {/* As tall as the check's Pay row beside it (p-2 + h-16), so the two line up. */}
      {parts !== 'none' && <SeatCourseBar config={config} parts={parts} seat={seat} setSeat={setSeat} course={course} setCourse={setCourse} covers={covers} />}
    </div>
  )
}
