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
//   items       the dishes of the section picked, or every dish when the layout has no
//               categories; a search box on top if the zone has one
//   buttons     the designer's buttons: a dish, or a function (onButton)
//   modifiers   the dish being added's choices (LayoutChoices.jsx), over other zones
//               or the whole screen while it is being added
//   seats       the seat and course bar
//
// Which category is open, and each zone's page, stay while the till runs, so
// opening an order (the counter's first dish) doesn't lose the place.

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { choiceZones, overlaps, buttonLabel, actionOf, buttonTextStyle, menuZoneMenus } from '@shared/pos/tillLayout.js'
import { switchMenus } from '@shared/menuTimes.js'
import { discountList } from '@shared/pos/discounts.js'
import { cx, inkOn } from './ui.jsx'
import ZoneGrid from './ZoneGrid.jsx'
import { DishButton, SeatCourseBar, SECTION_COLOURS, dishPriceText, useHold } from './MenuPanel.jsx'
import { useChoiceBuilder, ChoiceZone } from './LayoutChoices.jsx'
import { soldOutMap } from '../lib/store.js'
import { menuTimesText } from '../lib/tillMenus.js'
import { listCharges, seatCourseParts, defaultStreamId } from '../lib/checkOps.js'

// The category and menu open in each layout, kept while the till app runs.
const placeMemo = new Map()
function useRemembered(key, initial) {
  const [v, set] = useState(() => (placeMemo.has(key) ? placeMemo.get(key) : initial))
  return [v, x => { placeMemo.set(key, x); set(x) }]
}

const area = z => ({ gridColumn: `${z.x + 1} / span ${z.w}`, gridRow: `${z.y + 1} / span ${z.h}` })

/**
 * A category button: filled in its colour when it is the one open. place:
 * where its words sit (buttonTextStyle() of the zone).
 */
function SectionButton({ label, colour, on, onTap, testid, place }) {
  return (
    <button onClick={onTap} data-testid={testid} data-on={on ? '1' : '0'}
      className="w-full h-full rounded-xl px-2 py-1 leading-tight border-2 touch-manipulation flex flex-col"
      style={{ ...place, ...(on ? { background: colour, borderColor: colour, color: '#fff' } : { borderColor: colour, color: colour, background: '#fff' }) }}>
      <span className="line-clamp-2 break-words" data-testid="button-words">{label}</span>
    </button>
  )
}

/**
 * A button from the designer: its colour (or white), its words (where the
 * zone puts them: place), greyed while it can't be used.
 */
function LayoutButton({ b, label, disabled, sub = null, onTap, onHold, place }) {
  const hold = useHold(onTap, onHold)
  const fill = b.colour ? { background: b.colour, borderColor: b.colour, color: inkOn(b.colour) } : null
  return (
    <button {...hold} disabled={disabled} data-testid="layout-button" data-action={b.action} data-button={b.id}
      className={cx('w-full h-full rounded-xl border-2 px-2 py-1 flex flex-col leading-tight touch-manipulation active:scale-[0.97] transition-transform select-none',
        !fill && 'bg-white border-line', disabled && 'opacity-40')}
      style={{ ...place, ...fill }}>
      <span className="line-clamp-3 break-words" data-testid="button-words">{label}</span>
      {sub && <span className="text-[0.75em] font-semibold opacity-80 mt-0.5">{sub}</span>}
    </button>
  )
}

function CategoriesZone({ zone, layoutId, sections, sectionId, setSectionId, resetKey }) {
  const place = buttonTextStyle(zone)
  return (
    <ZoneGrid zone={zone} memoKey={'cats:' + layoutId + ':' + zone.id} resetKey={resetKey} moreTitle="Categories"
      empty="No categories on the menus on now." testid="zone-categories"
      cells={sections.map(c => ({
        key: 's:' + c.s.id,
        node: <SectionButton label={c.s.title} colour={c.s.colour || SECTION_COLOURS[c.i % SECTION_COLOURS.length]} on={c.s.id === sectionId} testid="category"
          place={place} onTap={() => setSectionId(c.s.id)} />,
      }))} />
  )
}

/** A menu (or Menu times) button: filled while it is what the till shows. */
function MenuButton({ label, sub, on, onTap, testid, menuId = null, place }) {
  return (
    <button onClick={onTap} data-testid={testid} data-menu={menuId || undefined} data-on={on ? '1' : '0'} aria-pressed={on}
      className={cx('w-full h-full rounded-xl border-2 px-2 py-1 flex flex-col leading-tight touch-manipulation active:scale-[0.97] transition-transform',
        on ? 'bg-brand border-brand text-white' : 'bg-white border-line')}
      style={place}>
      <span className="line-clamp-2 break-words" data-testid="button-words">{label}</span>
      {sub && <span className="text-[0.75em] font-semibold opacity-80 mt-0.5 line-clamp-1" data-testid="menu-times">{sub}</span>}
    </button>
  )
}

/**
 * The Menus zone: shown is useShownMenus() of the screen (lib/tillMenus.js).
 * A menu is filled while the till shows it; Menu times while the till
 * follows the menu times by itself.
 */
function MenusZone({ zone, layoutId, shown }) {
  const place = buttonTextStyle(zone)
  const list = menuZoneMenus(zone, shown.menus)
  const tap = id => {
    const next = switchMenus(shown, id, zone.tap)
    if (!next) return
    if (next.follow) shown.follow()
    else shown.pick(next.ids)
  }
  const cells = []
  if (zone.times_button) {
    cells.push({
      key: 'times',
      node: <MenuButton label="Menu times" testid="zone-menu-times" place={place} on={shown.auto} onTap={() => shown.follow()}
        sub={zone.show_times ? (shown.auto ? (shown.none ? 'No menu on now' : 'Following') : 'Back to the times') : null} />,
    })
  }
  for (const m of list) {
    cells.push({
      key: 'm:' + m.id,
      node: <MenuButton label={m.name} menuId={m.id} testid="zone-menu" place={place} on={shown.ids.includes(m.id)} onTap={() => tap(m.id)}
        sub={zone.show_times ? menuTimesText(m) : null} />,
    })
  }
  return <ZoneGrid zone={zone} cells={cells} memoKey={'menus:' + layoutId + ':' + zone.id} moreTitle="Menus" empty="The till has no menus." testid="zone-menus" />
}

function ItemsZone({ zone, layoutId, config, menus, section, sectionIndex, hasCategories, soldOut, comboRefs, onDish, onHold }) {
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    const seen = new Set()
    const out = []
    const add = id => {
      const it = config.items?.[id]
      if (!it || seen.has(id)) return
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
  }, [q, menus, section, config, hasCategories])
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
            node: <DishButton fill place={place} item={it} colour={it.colour || colour} priceText={dishPriceText(config, it.id, comboRefs)}
              showPrice={zone.price} soldOut={soldOut.has(it.id)} onPick={onDish} onHold={onHold} />,
          }))} />
      </div>
    </div>
  )
}

function ButtonsZone({ zone, layoutId, config, check, soldOut, onDish, onHold, onButton, canBack }) {
  const presets = discountList(config.settings)
  const tenders = config.settings?.tenders || []
  const charges = listCharges(config)
  const place = buttonTextStyle(zone)
  const cells = zone.buttons.map(b => {
    const item = b.action === 'item' ? config.items?.[b.item_id] : null
    const action = actionOf(b.action)
    const missing = (b.action === 'item' && !item) || (b.action === 'discount_preset' && !presets.some(p => p.id === b.preset_id))
      || (b.action === 'tender' && !tenders.some(t => t.key === b.tender && t.enabled))
      || (b.action === 'charge' && !charges.some(x => x.id === b.charge_id))
    const disabled = missing || (action?.check && !check) || (b.action === 'back' && !canBack)
    const sold = item && soldOut.has(item.id)
    return {
      key: b.id, w: b.w, h: b.h,
      node: <LayoutButton b={b} disabled={disabled} place={place} label={buttonLabel(b, { items: config.items || {}, presets, tenders, charges })}
        sub={sold ? 'Sold out' : null}
        onTap={() => (item ? (sold ? onHold(item) : onDish(item)) : onButton(b))}
        onHold={item ? () => onHold(item) : null} />,
    }
  })
  return <ZoneGrid zone={zone} cells={cells} memoKey={'buttons:' + layoutId + ':' + zone.id} moreTitle="Buttons" empty="No buttons in this zone yet." testid="zone-buttons" />
}

/**
 * layout: the till's layout (lib/tillLayout.js tillLayoutOf). checkZone: the
 * node for the Order zone. check: the open check (null at the counter before
 * an order). menus: the menus shown; tillMenus: all of the till's;
 * shownMenus: useShownMenus() itself (the Menus zone switches with it). onDish(item): a dish tapped (zones or dish buttons). onHold(item):
 * held, or a sold out dish tapped. onButton(button): any other button.
 * choosing: { item, initial, key } while a dish's choices are in the Dish
 * choices zones (the host starts it); onChosen(result), onCancelChoosing(),
 * onMoreChoices({ selection, qty }).
 */
export default function LayoutScreen({
  layout, config, check = null, checkZone, menus, tillMenus = menus, shownMenus = null, covers = null,
  seat, setSeat, course, setCourse,
  onDish, onHold, onButton, canBack = true,
  choosing = null, onChosen, onCancelChoosing, onMoreChoices,
}) {
  const layoutId = layout.id || 'layout'
  const soldOut = useMemo(() => soldOutMap(config), [config])
  const comboRefs = useMemo(() => ({ itemsById: config.items || {}, sectionItems: config.section_items || {} }), [config])
  const [sectionPick, setSectionId] = useRemembered(layoutId + ':section', null)
  const cats = layout.zones.find(z => z.type === 'categories')
  // The categories the zone shows: { s, i (its place in its menu, for the colour) }.
  const sections = useMemo(() => {
    const list = ms => {
      const out = []
      ms.forEach(m => m.sections.forEach((s, i) => out.push({ s, i })))
      return out
    }
    const shown = list(menus)
    if (!cats?.sections) return shown
    const pick = from => cats.sections.map(id => from.find(x => x.s.id === id)).filter(Boolean)
    const on = pick(shown)
    return on.length ? on : pick(list(tillMenus))
  }, [menus, tillMenus, cats])
  // The category open: the one picked, else the first the categories zone shows.
  const open = sections.find(x => x.s.id === sectionPick) || sections[0] || null
  const shownKey = menus.map(m => m.id).join(',')

  const zones = choiceZones(layout)
  const solid = layout.zones.filter(z => z.type !== 'modifiers')
  const mods = layout.zones.filter(z => z.type === 'modifiers')

  const zoneBody = z => {
    if (z.type === 'check') return checkZone
    if (z.type === 'categories') {
      return <CategoriesZone zone={z} layoutId={layoutId} sections={sections} sectionId={open?.s.id || null} setSectionId={setSectionId} resetKey={shownKey} />
    }
    if (z.type === 'menus') {
      return shownMenus ? <MenusZone zone={z} layoutId={layoutId} shown={shownMenus} /> : null
    }
    if (z.type === 'items') {
      return <ItemsZone zone={z} layoutId={layoutId} config={config} menus={menus} section={open?.s || null} sectionIndex={open?.i || 0}
        hasCategories={!!cats} soldOut={soldOut} comboRefs={comboRefs} onDish={onDish} onHold={onHold} />
    }
    if (z.type === 'buttons') {
      return <ButtonsZone zone={z} layoutId={layoutId} config={config} check={check} soldOut={soldOut} onDish={onDish} onHold={onHold} onButton={onButton} canBack={canBack} />
    }
    if (z.type === 'seats') {
      // What the zone shows, as far as the check's revenue stream uses seats and courses.
      const parts = seatCourseParts(config, check?.revenue_stream_id || defaultStreamId(config), z.parts)
      return <SeatCourseBar fill font={z.font} parts={parts} config={config} seat={seat} setSeat={setSeat} course={course} setCourse={setCourse} covers={covers} />
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

/** The Dish choices zones while a dish is being added. */
function Choosing({ config, choosing, zones, mods, onChosen, onCancel, onMore }) {
  const bar = zones.required
  // Add on the tap that completes the dish (the must-pick zone's auto_add),
  // or more picks, more dishes (its split_picks; never both).
  const build = useChoiceBuilder(choosing.item, config, choosing.initial || null, {
    onAutoAdd: bar?.auto_add && !bar?.split_picks ? onChosen : null,
    split: !!bar?.split_picks,
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
      <ChoiceZone zone={zone} build={build} cells={cells} bar={hasBar} buildKey={choosing.key}
        onAdd={() => onChosen(build.result())} onCancel={onCancel}
        onMore={() => onMore({ selection: build.result().selection, qty: build.qty })} />
    </div>
  ))
}
