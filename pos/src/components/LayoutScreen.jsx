// The order screen drawn from a till layout (Store tech > Till layouts,
// migration 228; shared/pos/tillLayout.js): a grid of zones, each with its
// own grid of buttons (ZoneGrid.jsx).
//
//   check       what the host gives (the check panel, or the counter's New order and waiting orders)
//   categories  the sections of the menus on now (lib/tillMenus.js: the menu times, or what
//               staff picked in More > Menus): the ones picked in the designer, in that
//               order (with none of them on a menu on now, every one picked), else every
//               section of those menus
//   menus       the till's menus as buttons (the ones picked in the designer, in that
//               order, else all): tapping one changes what the till shows, as More >
//               Menus does (switchMenus() in shared/menuTimes.js); a Menu times button
//               goes back to following the menu times
//   items       the dishes of the section picked in the Categories zone it follows
//               (categoriesZoneOf(): its own pick, else the first), or every dish
//               when the layout has no categories; a search box on top if the zone
//               has one. Several Categories zones each keep their own open category.
//   category    the dishes of the one section the designer picked (from the menus on
//               now, else any of the till's menus), whatever the categories show
// The dishes and category zones leave out the dishes the designer took out of
// them (hide_item_ids, shownDishIds()), in the search too.
//   buttons     the designer's buttons: a dish, or a function (onButton)
//   modifiers   the dish being added's choices (LayoutChoices.jsx), over other zones
//               or the whole screen while it is being added
//   seats       the seat and course bar
//   popup       buttons that show only when a button opens them (open_popup),
//               over the cells they were placed on, the rest of the screen
//               covered behind them until they close: their X (window
//               controls), a Close button among them (close_popup), a tap
//               outside (close_outside) or any of their buttons (close_on_tap)
//
// Which category is open, each zone's page and the pop-up open stay while the
// till runs, so opening an order (the counter's first dish) doesn't lose the
// place: a pop-up stays open until it is closed.
//
// Phone layouts (12 Nov 2026). Any of the other zones can be a pop-up too
// (show: 'popup'; isPopup() in the shared rules): the order, the categories,
// the menus, the dishes, a category's dishes or the seat and course show only
// when a button opens them, over their own cells or the whole screen (cover:
// 'screen'), and close after they are used when set to (close_on_tap: a
// category, a menu, a dish, a seat or course tapped). A button that opens the
// order says its items and total, one that opens the categories the category
// open, one that opens the seat and course what is picked. The order as a
// pop-up closes by itself when its order leaves the screen (paid, cancelled,
// another one opened). A zone with buttons can be a list (view: 'list'): one
// column of rows, the words on the left and the second line on the right.
//
// Take one off (a till's setting, with the dish counts on): a dish already on
// the order comes off one at a time from its own button, by a long press on a
// button or a swipe left on a list's row (useDishPress() in MenuPanel.jsx;
// takeOff from Check.jsx).

import { useEffect, useMemo, useState } from 'react'
import { Search, X, ChevronRight } from 'lucide-react'
import {
  choiceZones, overlaps, buttonLabel, actionOf, buttonTextStyle, menuZoneMenus, shownDishIds, floats, isPopup, isList, popupTitle,
  categoriesZoneOf,
} from '@shared/pos/tillLayout.js'
import { switchMenus } from '@shared/menuTimes.js'
import { discountList } from '@shared/pos/discounts.js'
import { checkTotals } from '@shared/pos/pricing.js'
import { cx, inkOn, money } from './ui.jsx'
import ZoneGrid from './ZoneGrid.jsx'
import { DishButton, SeatCourseBar, SECTION_COLOURS, dishPriceText, useDishPress } from './MenuPanel.jsx'
import { useChoiceBuilder, ChoiceZone } from './LayoutChoices.jsx'
import { soldOutMap } from '../lib/store.js'
import { menuTimesText } from '../lib/tillMenus.js'
import { listCharges, seatCourseParts, defaultStreamId } from '../lib/checkOps.js'

// The category and the pop-up open in each layout, kept while the till app
// runs. Each layout has its own (the key names it): when the till's layout
// changes while a screen is up, the value follows the key, so the counter and
// the order screen (two screens, one layout) never disagree about it.
const placeMemo = new Map()
function useRemembered(key, initial) {
  const kept = () => (placeMemo.has(key) ? placeMemo.get(key) : initial)
  const [state, set] = useState(() => ({ key, v: kept() }))
  const v = state.key === key ? state.v : kept()
  return [v, x => { placeMemo.set(key, x); set({ key, v: x }) }]
}

const area = z => ({ gridColumn: `${z.x + 1} / span ${z.w}`, gridRow: `${z.y + 1} / span ${z.h}` })

// The words and the second line of a button in a list (a row): the words take
// the room, the second line keeps its own.
const WORDS = 'flex-1 min-w-0'
const SECOND = 'shrink-0'

/**
 * A category button: filled in its colour when it is the one open. place:
 * where its words sit (buttonTextStyle() of the zone). list: a row in a list.
 */
function SectionButton({ label, colour, on, onTap, testid, place, list = false }) {
  return (
    <button onClick={onTap} data-testid={testid} data-on={on ? '1' : '0'}
      className={cx('w-full h-full rounded-xl py-1 leading-tight border-2 touch-manipulation flex flex-col', list ? 'px-3' : 'px-2')}
      style={{ ...place, ...(on ? { background: colour, borderColor: colour, color: '#fff' } : { borderColor: colour, color: colour, background: '#fff' }) }}>
      <span className={cx('line-clamp-2 break-words', list && WORDS)} data-testid="button-words">{label}</span>
      {list && <ChevronRight size={18} className={cx(SECOND, 'opacity-60')} aria-hidden="true" />}
    </button>
  )
}

/**
 * A button from the designer: its colour (or white), its words (where the
 * zone puts them: place), greyed while it can't be used. sub: a second line
 * (Sold out); note: what the pop-up it opens holds (the order's items and
 * total, the category open, the seat picked). list: a row in a list. item: the
 * dish a dish button adds (its count and Take one off: useDishPress()).
 */
function LayoutButton({ b, label, disabled, sub = null, note = null, onTap, onHold, place, list = false, count = 0, item = null, takeOff = null }) {
  const press = useDishPress({ item, count, takeOff, list, onTap, onHold })
  const fill = b.colour ? { background: b.colour, borderColor: b.colour, color: inkOn(b.colour) } : null
  return press.wrap(
    <button {...press.handlers} disabled={disabled} data-testid="layout-button" data-action={b.action} data-button={b.id} data-popup={b.popup_id || undefined}
      data-hold={item ? press.hold || undefined : undefined}
      className={cx('relative w-full h-full rounded-xl border-2 py-1 flex flex-col leading-tight touch-manipulation active:scale-[0.97] transition-transform select-none',
        list ? 'px-3' : 'px-2', !fill && 'bg-white border-line', disabled && 'opacity-40')}
      style={{ ...place, ...fill, ...press.style }}>
      <span className={cx('break-words', list ? 'line-clamp-2 ' + WORDS : 'line-clamp-3', count > 0 && !list && 'pr-7')} data-testid="button-words">{label}</span>
      {count > 0 && (
        <span className={cx('min-w-[26px] h-[26px] px-1.5 rounded-full bg-brand text-white text-sm font-bold tabular-nums flex items-center justify-center',
          list ? 'shrink-0 ml-2' : 'absolute top-1 right-1')} data-testid="dish-count" aria-label={count + ' on the order'}>{count}</span>
      )}
      {sub && <span className={cx('text-[0.75em] font-semibold opacity-80', list ? SECOND : 'mt-0.5')}>{sub}</span>}
      {note && !sub && <span className={cx('text-[0.85em] font-semibold opacity-90 tabular-nums', list ? SECOND : 'mt-0.5 line-clamp-1')} data-testid="button-note">{note}</span>}
    </button>
  )
}

function CategoriesZone({ zone, layoutId, sections, sectionId, setSectionId, resetKey }) {
  const place = buttonTextStyle(zone)
  const list = isList(zone)
  return (
    <ZoneGrid zone={zone} memoKey={'cats:' + layoutId + ':' + zone.id} resetKey={resetKey} moreTitle="Categories"
      empty="No categories on the menus on now." testid="zone-categories"
      cells={sections.map(c => ({
        key: 's:' + c.s.id,
        node: <SectionButton label={c.s.title} colour={c.s.colour || SECTION_COLOURS[c.i % SECTION_COLOURS.length]} on={c.s.id === sectionId} testid="category"
          place={place} list={list} onTap={() => setSectionId(c.s.id)} />,
      }))} />
  )
}

/** A menu (or Menu times) button: filled while it is what the till shows. */
function MenuButton({ label, sub, on, onTap, testid, menuId = null, place, list = false }) {
  return (
    <button onClick={onTap} data-testid={testid} data-menu={menuId || undefined} data-on={on ? '1' : '0'} aria-pressed={on}
      className={cx('w-full h-full rounded-xl border-2 py-1 flex flex-col leading-tight touch-manipulation active:scale-[0.97] transition-transform',
        list ? 'px-3' : 'px-2', on ? 'bg-brand border-brand text-white' : 'bg-white border-line')}
      style={place}>
      <span className={cx('line-clamp-2 break-words', list && WORDS)} data-testid="button-words">{label}</span>
      {sub && <span className={cx('text-[0.75em] font-semibold opacity-80 line-clamp-1', list ? SECOND + ' max-w-[55%]' : 'mt-0.5')} data-testid="menu-times">{sub}</span>}
    </button>
  )
}

/**
 * The Menus zone: shown is useShownMenus() of the screen (lib/tillMenus.js).
 * A menu is filled while the till shows it; Menu times while the till
 * follows the menu times by itself.
 */
function MenusZone({ zone, layoutId, shown, onUsed = null }) {
  const place = buttonTextStyle(zone)
  const rows = isList(zone)
  const list = menuZoneMenus(zone, shown.menus)
  // onUsed: the zone is a pop-up that closes after a menu is tapped.
  const tap = id => {
    const next = switchMenus(shown, id, zone.tap)
    if (next?.follow) shown.follow()
    else if (next) shown.pick(next.ids)
    onUsed?.()
  }
  const cells = []
  if (zone.times_button) {
    cells.push({
      key: 'times',
      node: <MenuButton label="Menu times" testid="zone-menu-times" place={place} list={rows} on={shown.auto} onTap={() => { shown.follow(); onUsed?.() }}
        sub={zone.show_times ? (shown.auto ? (shown.none ? 'No menu on now' : 'Following') : 'Back to the times') : null} />,
    })
  }
  for (const m of list) {
    cells.push({
      key: 'm:' + m.id,
      node: <MenuButton label={m.name} menuId={m.id} testid="zone-menu" place={place} list={rows} on={shown.ids.includes(m.id)} onTap={() => tap(m.id)}
        sub={zone.show_times ? menuTimesText(m) : null} />,
    })
  }
  return <ZoneGrid zone={zone} cells={cells} memoKey={'menus:' + layoutId + ':' + zone.id} moreTitle="Menus" empty="The till has no menus." testid="zone-menus" />
}

function ItemsZone({ zone, layoutId, config, menus, section, sectionIndex, hasCategories, soldOut, comboRefs, onDish, onHold, counts = null, takeOff = null }) {
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    const seen = new Set()
    const out = []
    // Dishes the designer left out of this zone never show in it.
    const hidden = new Set(zone.hide_item_ids || [])
    const add = id => {
      const it = config.items?.[id]
      if (!it || seen.has(id) || hidden.has(id)) return
      seen.add(id)
      out.push(it)
    }
    if (q.trim()) {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      for (const m of menus) for (const s of m.sections) for (const id of s.item_ids) {
        const it = config.items?.[id]
        if (it && words.every(w => (it.name + ' ' + (it.kitchen_name || '')).toLowerCase().includes(w))) add(id)
      }
      return out.slice(0, 60)
    }
    // No categories zone: every dish of the menus on now, in menu order.
    if (!hasCategories) {
      for (const m of menus) for (const s of m.sections) for (const id of s.item_ids) add(id)
      return out
    }
    ;(section?.item_ids || []).forEach(add)
    return out
  }, [q, menus, section, config, hasCategories, zone.hide_item_ids])
  const colour = section && !q ? section.colour || SECTION_COLOURS[sectionIndex % SECTION_COLOURS.length] : '#64708a'
  const place = buttonTextStyle(zone)
  return (
    <div className="h-full flex flex-col min-h-0">
      {zone.search && (
        <div className="relative shrink-0 mb-2">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-10 pr-10" placeholder="Find a dish" value={q} onChange={e => setQ(e.target.value)} data-testid="zone-search" />
          {q && <button className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center" onClick={() => setQ('')} aria-label="Clear"><X size={18} /></button>}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ZoneGrid zone={zone} memoKey={'items:' + layoutId + ':' + zone.id} resetKey={(section?.id || '') + '|' + q.trim()} moreTitle={section?.title || 'Dishes'}
          empty={q ? 'No dish matches.' : hasCategories ? 'This category has no dishes.' : 'No dishes on the menus on now.'} testid="zone-items"
          cells={items.map(it => ({
            key: it.id,
            node: <DishButton fill place={place} list={isList(zone)} item={it} colour={it.colour || colour} priceText={dishPriceText(config, it.id, comboRefs)}
              showPrice={zone.price} soldOut={soldOut.has(it.id)} onPick={onDish} onHold={onHold} count={counts?.[it.id] || 0} takeOff={takeOff} />,
          }))} />
      </div>
    </div>
  )
}

/**
 * A category's dishes zone: the dishes of the section the designer picked,
 * found on the menus on now, else on any of the till's menus, less the ones
 * left out of it.
 */
function CategoryZone({ zone, layoutId, config, menus, tillMenus, soldOut, comboRefs, onDish, onHold, counts = null, takeOff = null }) {
  const found = useMemo(() => {
    for (const list of [menus, tillMenus]) {
      for (const m of list || []) {
        const i = m.sections.findIndex(s => s.id === zone.section_id)
        if (i >= 0) return { s: m.sections[i], i }
      }
    }
    return null
  }, [menus, tillMenus, zone.section_id])
  const items = shownDishIds(zone, found?.s.item_ids).map(id => config.items?.[id]).filter(Boolean)
  const colour = found ? found.s.colour || SECTION_COLOURS[found.i % SECTION_COLOURS.length] : '#64708a'
  const place = buttonTextStyle(zone)
  return (
    <ZoneGrid zone={zone} memoKey={'category:' + layoutId + ':' + zone.id} resetKey={zone.section_id || ''} moreTitle={found?.s.title || 'Dishes'}
      empty={!zone.section_id ? 'No category picked for this zone.' : !found ? 'This category isn\'t on this till\'s menus.' : 'No dishes to show here.'}
      testid="zone-category"
      cells={items.map(it => ({
        key: it.id,
        node: <DishButton fill place={place} list={isList(zone)} item={it} colour={it.colour || colour} priceText={dishPriceText(config, it.id, comboRefs)}
          showPrice={zone.price} soldOut={soldOut.has(it.id)} onPick={onDish} onHold={onHold} count={counts?.[it.id] || 0} takeOff={takeOff} />,
      }))} />
  )
}

/**
 * A Buttons zone, or an open pop-up's buttons (zone.type popup). popups: the
 * layout's pop-ups, for an Open a pop-up button's words (the pop-up's name);
 * notes: what each pop-up holds, said on the button that opens it ({ [popup
 * id]: 'words' }); idle: the pop-ups with nothing to show now (their buttons
 * are greyed).
 */
function ButtonsZone({ zone, layoutId, config, check, soldOut, onDish, onHold, onButton, canBack, popups = [], notes = {}, idle = null, counts = null, takeOff = null }) {
  const presets = discountList(config.settings)
  const tenders = config.settings?.tenders || []
  const charges = listCharges(config)
  const place = buttonTextStyle(zone)
  const list = isList(zone)
  const inPopup = zone.type === 'popup'
  const cells = zone.buttons.map(b => {
    const item = b.action === 'item' ? config.items?.[b.item_id] : null
    const action = actionOf(b.action)
    const missing = (b.action === 'item' && !item) || (b.action === 'discount_preset' && !presets.some(p => p.id === b.preset_id))
      || (b.action === 'tender' && !tenders.some(t => t.key === b.tender && t.enabled))
      || (b.action === 'charge' && !charges.some(x => x.id === b.charge_id))
    const disabled = missing || (action?.check && !check) || (b.action === 'back' && !canBack) || (b.action === 'open_popup' && !!idle?.has(b.popup_id))
    const sold = item && soldOut.has(item.id)
    return {
      key: b.id, w: b.w, h: b.h,
      node: <LayoutButton b={b} disabled={disabled} place={place} list={list} label={buttonLabel(b, { items: config.items || {}, presets, tenders, charges, popups })}
        sub={sold ? 'Sold out' : null} note={b.action === 'open_popup' ? notes[b.popup_id] || null : null} count={item ? counts?.[item.id] || 0 : 0}
        item={item} takeOff={takeOff}
        onTap={() => (item ? (sold ? onHold(item) : onDish(item)) : onButton(b))}
        onHold={item ? () => onHold(item) : null} />,
    }
  })
  return <ZoneGrid zone={zone} cells={cells} memoKey={'buttons:' + layoutId + ':' + zone.id} moreTitle={inPopup ? zone.title : 'Buttons'}
    empty={inPopup ? 'No buttons in this pop-up yet.' : 'No buttons in this zone yet.'} testid={inPopup ? 'popup-buttons' : 'zone-buttons'} />
}

/**
 * An open pop-up over the cells it was placed on, or over the whole screen
 * (cover: 'screen'), the rest of the screen covered behind it (a tap there
 * closes it when it is set to; nothing is outside one that takes the whole
 * screen). frame: its border and shadow; controls: a bar with its name
 * (title) and an X. flush: what it holds brings its own padding (the order,
 * the seat and course bar).
 */
function Popup({ zone, title, flush = false, onClose, children }) {
  const whole = zone.cover === 'screen'
  const outside = zone.close_outside && !whole
  return (
    <>
      <div className="absolute inset-0 z-[24]" data-testid="popup-cover" data-closes={outside ? '1' : '0'}
        onClick={() => { if (outside) onClose() }} />
      <div style={whole ? undefined : area(zone)} role="dialog" aria-label={title}
        className={cx('z-[25] bg-white min-w-0 min-h-0 flex flex-col overflow-hidden', whole ? 'absolute inset-0' : 'relative',
          zone.frame && !whole && 'rounded-xl shadow-2xl ring-2 ring-brand')}
        data-testid="popup" data-popup-id={zone.id} data-popup-type={zone.type} data-cover={whole ? 'screen' : 'zone'}
        data-frame={zone.frame && !whole ? '1' : '0'} data-controls={zone.controls ? '1' : '0'}>
        {zone.controls && (
          <div className="shrink-0 flex items-center gap-2 pl-3 border-b border-line bg-page" data-testid="popup-bar">
            <span className="flex-1 min-w-0 truncate font-bold" data-testid="popup-title">{title}</span>
            <button onClick={onClose} className="w-12 h-12 shrink-0 flex items-center justify-center touch-manipulation" aria-label={'Close ' + title} data-testid="popup-close">
              <X size={22} />
            </button>
          </div>
        )}
        <div className={cx('flex-1 min-h-0', !flush && 'p-2')}>{children}</div>
      </div>
    </>
  )
}

/**
 * layout: the till's layout (lib/tillLayout.js tillLayoutOf). checkZone: the
 * node for the Order zone. check: the open check (null at the counter before
 * an order). menus: the menus shown; tillMenus: all of the till's;
 * shownMenus: useShownMenus() itself (the Menus zone switches with it). onDish(item): a dish tapped (zones or dish buttons). onHold(item):
 * held, or a sold out dish tapped. onButton(button): any other button.
 * choosing: { item, initial, key } while a dish's choices are in the Dish
 * choices zones (the host starts it); onChosen(result), onCancelChoosing(),
 * onMoreChoices({ selection, qty }). noOrderNote: what the button that opens
 * the order says with no order on screen (the counter: "2 waiting").
 * takeOff: the order screen's Take one off ({ run(item), label(item) }, or
 * null), for the dishes on the order.
 */
export default function LayoutScreen({
  layout, config, check = null, checkZone, menus, tillMenus = menus, shownMenus = null, covers = null, counts = null, takeOff = null,
  seat, setSeat, course, setCourse,
  onDish, onHold, onButton, canBack = true, noOrderNote = null,
  choosing = null, onChosen, onCancelChoosing, onMoreChoices,
}) {
  const layoutId = layout.id || 'layout'
  const soldOut = useMemo(() => soldOutMap(config), [config])
  const comboRefs = useMemo(() => ({ itemsById: config.items || {}, sectionItems: config.section_items || {} }), [config])
  // The category open in each Categories zone ({ [zone id]: section id }).
  const [sectionPicks, setSectionPicks] = useRemembered(layoutId + ':sections', {})
  const setSectionId = (zoneId, id) => setSectionPicks({ ...sectionPicks, [zoneId]: id })
  // The categories each Categories zone shows: { [zone id]: [{ s, i (its
  // place in its menu, for the colour) }] }.
  const catSections = useMemo(() => {
    const list = ms => {
      const out = []
      ms.forEach(m => m.sections.forEach((s, i) => out.push({ s, i })))
      return out
    }
    const shown = list(menus)
    const all = list(tillMenus)
    return Object.fromEntries(layout.zones.filter(z => z.type === 'categories').map(c => {
      if (!c.sections) return [c.id, shown]
      const pick = from => c.sections.map(id => from.find(x => x.s.id === id)).filter(Boolean)
      const on = pick(shown)
      return [c.id, on.length ? on : pick(all)]
    }))
  }, [menus, tillMenus, layout])
  // The category open in a Categories zone: the one picked, else the first it shows.
  const openIn = c => {
    if (!c) return null
    const list = catSections[c.id] || []
    return list.find(x => x.s.id === sectionPicks[c.id]) || list[0] || null
  }
  const shownKey = menus.map(m => m.id).join(',')

  const zones = choiceZones(layout)
  // The zones always on screen; the rest float over them (a pop-up while it
  // is open, a dish's choices while it is being added).
  const solid = layout.zones.filter(z => !floats(z))
  const mods = layout.zones.filter(z => z.type === 'modifiers')
  const popups = layout.zones.filter(isPopup)
  // The pop-up open (kept while the till runs, like the category).
  const [openPick, setOpenPick] = useRemembered(layoutId + ':popup', null)
  const popup = popups.find(p => p.id === openPick) || null
  const closePopup = () => setOpenPick(null)
  // A pop-up taken out of the layout while open is forgotten, so it doesn't
  // open by itself should it come back.
  const popupKey = popups.map(p => p.id).join(',')
  useEffect(() => { if (openPick && !popup) setOpenPick(null) }, [openPick, popupKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // The order as a pop-up closes when the order it showed leaves the screen
  // (paid, cancelled, another one opened): back to the dishes for the next
  // one. Opened with no order on screen (the counter's waiting orders), it
  // stays for the order picked there.
  const [orderFor, setOrderFor] = useRemembered(layoutId + ':orderFor', null)
  const orderOpen = popup?.type === 'check'
  const checkId = check?.id || null
  useEffect(() => {
    if (!orderOpen) { if (orderFor) setOrderFor(null); return }
    if (orderFor && orderFor !== checkId) { setOrderFor(null); setOpenPick(null); return }
    if (checkId && orderFor !== checkId) setOrderFor(checkId)
  }, [orderOpen, checkId]) // eslint-disable-line react-hooks/exhaustive-deps
  // A pop-up closes after it is used when it is set to.
  const used = z => { if (isPopup(z) && z.close_on_tap) closePopup() }
  // A button: pop-ups open and close here, the rest go to the host. from: the
  // pop-up the button is in, which closes after it when it is set to.
  const press = (b, from = null) => {
    if (b.action === 'open_popup') {
      if (popups.some(p => p.id === b.popup_id)) setOpenPick(b.popup_id)
      return null
    }
    if (b.action === 'close_popup') return closePopup()
    if (from) used(from)
    return onButton(b)
  }
  const dishFrom = z => item => {
    used(z)
    return onDish(item)
  }

  // What the seat and course zone has to pick from on this order's revenue stream.
  const streamId = check?.revenue_stream_id || defaultStreamId(config)
  const seatParts = z => seatCourseParts(config, streamId, z.parts)
  // What each pop-up holds, for the button that opens it: the order's items
  // and total, the category open, the seat and course picked.
  const orderNote = useMemo(() => {
    if (!check) return noOrderNote
    const t = checkTotals(check)
    return t.items + (t.items === 1 ? ' item' : ' items') + ' · ' + money(t.total)
  }, [check, noOrderNote])
  const noteOf = z => {
    if (z.type === 'check') return orderNote
    if (z.type === 'categories') return openIn(z)?.s.title || null
    if (z.type === 'seats') {
      const parts = seatParts(z)
      const bits = [parts !== 'courses' && parts !== 'none' && seat ? 'Seat ' + seat : null,
        parts !== 'seats' && parts !== 'none' && course ? (config.courses || []).find(c => c.id === course)?.name : null]
      return bits.filter(Boolean).join(' · ') || null
    }
    return null
  }
  const notes = Object.fromEntries(popups.map(z => [z.id, noteOf(z)]))
  // A seat and course pop-up with nothing to pick: its button is greyed.
  const idle = new Set(popups.filter(z => z.type === 'seats' && seatParts(z) === 'none').map(z => z.id))
  // A pop-up's name on its bar: its own; else the category open (the dishes),
  // the category it shows (a category's dishes), or what it is.
  const sectionTitle = id => {
    for (const list of [menus, tillMenus]) for (const m of list || []) { const s = m.sections.find(x => x.id === id); if (s) return s.title }
    return null
  }
  const titleOf = z => z.title
    || (z.type === 'items' ? openIn(categoriesZoneOf(layout, z))?.s.title || null : null)
    || (z.type === 'category' && z.section_id ? sectionTitle(z.section_id) : null)
    || popupTitle(z)

  const zoneBody = z => {
    if (z.type === 'check') return checkZone
    if (z.type === 'categories') {
      return <CategoriesZone zone={z} layoutId={layoutId} sections={catSections[z.id] || []} sectionId={openIn(z)?.s.id || null} resetKey={shownKey}
        setSectionId={id => { setSectionId(z.id, id); used(z) }} />
    }
    if (z.type === 'menus') {
      return shownMenus ? <MenusZone zone={z} layoutId={layoutId} shown={shownMenus} onUsed={() => used(z)} /> : null
    }
    if (z.type === 'items') {
      // The Categories zone it follows, and the category open there.
      const c = categoriesZoneOf(layout, z)
      const open = openIn(c)
      return <ItemsZone zone={z} layoutId={layoutId} config={config} menus={menus} section={open?.s || null} sectionIndex={open?.i || 0}
        hasCategories={!!c} soldOut={soldOut} comboRefs={comboRefs} onDish={dishFrom(z)} onHold={onHold} counts={counts} takeOff={takeOff} />
    }
    if (z.type === 'category') {
      return <CategoryZone zone={z} layoutId={layoutId} config={config} menus={menus} tillMenus={tillMenus} soldOut={soldOut}
        comboRefs={comboRefs} onDish={dishFrom(z)} onHold={onHold} counts={counts} takeOff={takeOff} />
    }
    if (z.type === 'buttons' || z.type === 'popup') {
      const from = z.type === 'popup' ? z : null
      return <ButtonsZone zone={z} layoutId={layoutId} config={config} check={check} soldOut={soldOut} onDish={dishFrom(from)} onHold={onHold}
        onButton={b => press(b, from)} canBack={canBack} popups={popups} notes={notes} idle={idle} counts={counts} takeOff={takeOff} />
    }
    if (z.type === 'seats') {
      // What the zone shows, as far as the check's revenue stream uses seats and courses.
      return <SeatCourseBar fill wrap={isPopup(z)} font={z.font} parts={seatParts(z)} config={config} covers={covers}
        seat={seat} setSeat={v => { setSeat(v); used(z) }} course={course} setCourse={v => { setCourse(v); used(z) }} />
    }
    return null
  }

  return (
    <div className="h-full grid gap-px bg-line relative min-w-0" data-testid="layout-screen" data-layout={layout.id || ''}
      style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }}>
      {solid.map(z => (
        <div key={z.id} style={area(z)} className={cx('bg-white min-w-0 min-h-0 overflow-hidden', z.type !== 'check' && z.type !== 'seats' && 'p-2')}
          data-zone={z.type} data-zone-id={z.id}>
          {zoneBody(z)}
        </div>
      ))}
      {/* An open pop-up, over everything but a dish's choices (it comes back after them). */}
      {popup && !choosing && (
        <Popup key={popup.id} zone={popup} title={titleOf(popup)} flush={popup.type === 'check' || popup.type === 'seats'} onClose={closePopup}>
          {zoneBody(popup)}
        </Popup>
      )}
      {choosing
        ? <Choosing key={choosing.key} layout={layout} config={config} choosing={choosing} zones={zones} mods={mods}
            onChosen={onChosen} onCancel={onCancelChoosing} onMore={onMoreChoices} />
        : mods.filter(m => m.cover === 'zone' && !solid.some(z => overlaps(z, m))).map(m => (
          // A Dish choices zone with its own space waits there, empty.
          <div key={m.id} style={area(m)} className="bg-white min-w-0 min-h-0 flex items-center justify-center text-sm text-muted p-3 text-center" data-zone="modifiers" data-zone-id={m.id}>
            A dish's choices show here.
          </div>
        ))}
    </div>
  )
}

/**
 * The Dish choices zones while a dish is being added, or a line's options
 * changed (choosing.edit: the line's id; its picks in choosing.initial,
 * Update changes that line, nothing is added on a tap and the picks never
 * make more dishes).
 */
function Choosing({ config, choosing, zones, mods, onChosen, onCancel, onMore }) {
  const bar = zones.required
  const edit = !!choosing.edit
  // Add on the tap that completes the dish (the must-pick zone's auto_add),
  // or more picks, more dishes (its split_picks; never both).
  const build = useChoiceBuilder(choosing.item, config, choosing.initial || null, {
    onAutoAdd: !edit && bar?.auto_add && !bar?.split_picks ? onChosen : null,
    split: !edit && !!bar?.split_picks,
  })
  // One zone for everything when there is one, or when the must-pick zone covers the screen.
  const together = !zones.optional || zones.optional === bar || bar.cover === 'screen'
  const need = build.cells.filter(c => c.need)
  const rest = build.cells.filter(c => !c.need)
  const show = []
  show.push({ zone: bar, cells: together ? build.cells : need, bar: true })
  if (!together && rest.length) show.push({ zone: zones.optional, cells: rest, bar: false })
  return show.map(({ zone, cells, bar: hasBar }) => (
    <div key={zone.id} data-zone="modifiers" data-zone-id={zone.id} data-cover={zone.cover}
      className={cx('bg-white min-w-0 min-h-0 overflow-hidden shadow-2xl ring-2 ring-brand', zone.cover === 'screen' ? 'absolute inset-0 z-30' : 'relative z-20')}
      style={zone.cover === 'screen' ? undefined : area(zone)}>
      <ChoiceZone zone={zone} build={build} cells={cells} bar={hasBar} buildKey={choosing.key} action={edit ? 'Update' : 'Add'}
        onAdd={() => onChosen(build.result())} onCancel={onCancel}
        onMore={() => onMore({ selection: build.result().selection, qty: build.qty })} />
    </div>
  ))
}
