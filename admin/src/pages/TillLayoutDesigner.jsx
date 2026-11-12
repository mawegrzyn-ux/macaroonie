// src/pages/TillLayoutDesigner.jsx
//
// A till layout (/pos/layouts/:id, migration 228; shared/pos/tillLayout.js):
// the till's order screen as a grid of cells holding zones (the order,
// categories, dishes, your own buttons, a dish's choices, seats). Drag a zone
// to move it and its corner to resize it, or set its place with the steps
// in the panel; each zone has its own grid of buttons, text size and what
// happens when more than fits. The canvas draws each zone's buttons with
// packCells(), as the till does, using the dishes, discounts, tenders and
// charges of the venue picked at the top. Explicit Save; a layout with problems (no
// Order zone, zones overlapping) can't be saved.
//
// Each zone with buttons sets where the words sit on them (across, and up
// and down); the preview places them with buttonTextStyle(), as the till does.
//
// The Menus zone switches the menu the till shows (as More > Menus does):
// all of the till's menus or the ones picked, in their order, with a Menu
// times button and each menu's times on the tills (setup menus' till_times,
// Menus > Menu times; a menu off on the tills never shows there).
//
// Dish choices zones are drawn as outlines over the zones under them (they
// only fill while a dish is being added: Show a dish being added fills them),
// so the zones under them stay in sight and can be tapped. The page keeps
// room for its scrollbar (scrollbar-gutter): the canvas takes its size from
// the width, and a scrollbar coming and going would otherwise resize it in a
// loop (the shake). A tall screen (upright tablet) is fitted to the window's
// height.
//
// A category's dishes zone (up to 8) shows the dishes of the one category
// picked in its panel, always, whatever the Categories zone shows; it and the
// Dishes zone can leave dishes out (hide_item_ids: tapped off in the
// category's list, or picked for the Dishes zone). The preview leaves them out
// too (shownDishIds()).
//
// Pop-ups (dashed purple, their name tab at the bottom left) are drawn as
// outlines too: on the till they show only when a button opens them (Open a
// pop-up), over their own cells with the rest of the screen covered behind
// them. Selected, one fills to show how it looks: its border and shadow, its
// window controls (name and X) and its own buttons (one can be Close).
//
// Phone layouts (12 Nov 2026). Made for: a tablet or bigger screen, or a
// phone (layout.phone; a phone-sized till draws only phone layouts, and the
// preview offers phone screens). Any zone but Buttons and Dish choices can
// show As a pop-up (zone.show): it leaves the screen and is drawn as a dashed
// purple outline like a Pop-up zone, with the same settings (name, border,
// window controls, how it closes, the buttons that open it) plus what it
// covers: its own space or the whole screen. The Order zone as a pop-up needs
// a button that opens it (a problem until it has one); that button says the
// order's items and total on the till. A zone with buttons can be laid out as
// a list (zone.view): one button a row, its words on the left and its second
// line (a price, a menu's times) on the right. Pop-ups that share a corner
// (a phone layout's Order and Categories often cover the same cells) stack
// their name tabs, so each can be tapped. Words typed into the layout (a
// pop-up's name, a button's words) go through WordsInput, which keeps a space
// typed at the end while the box has the focus (the layout is tidied, and so
// trimmed, on every change).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, Save, PanelsTopLeft, Plus, Minus, Eye, EyeOff, AlertTriangle, Info, X,
  AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  LayoutGrid, List, Smartphone, Tablet,
} from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import {
  PageHeader, Section, Field, Btn, Toggle, Segmented, ErrorNote, ConfirmDelete, SortableRows, inputCls,
  usePosVenue, usePosSetup, VenueSelect, ColourPick, money,
} from '@/components/pos/shared'
import { usedByText } from '@/components/pos/TillLayoutsSection'
import {
  ZONE_TYPES, zoneLabel, GRID_ZONES, OVERFLOWS, CHOICE_KINDS, COVERS, BUTTON_ACTIONS, actionOf, CHECK_BUTTONS,
  normaliseTillLayout, layoutProblems, layoutWarnings, packCells, buttonLabel, choiceZones, overlaps, buttonTextStyle,
  ALIGNS, VALIGNS, SEAT_PARTS, LAYOUT_COLS, LAYOUT_ROWS, ZONE_GRID, FONT, MAX_ZONES, MAX_BUTTONS, LABEL_MAX,
  MENU_TAPS, MAX_MENUS, popupCloseProblem, shownDishIds, MAX_HIDDEN,
  floats, isPopup, isList, popupTitle, popupOpeners, POPUP_ZONES, gridDefaults, SHOWS, VIEWS,
} from '@shared/pos/tillLayout.js'
import { chargeValueText } from '@shared/pos/charges.js'
import { timesLabel } from '@shared/menuTimes.js'

// Screens to preview on: the till's top bar takes 64 px, the layout the rest.
// A layout made for a phone previews on the phone screens (upright: a
// phone-sized till is one up to 639 px wide), any other on the rest.
const SCREENS = [
  { key: '1280x800', w: 1280, h: 800, label: 'Tablet, 1280 x 800' },
  { key: '1024x768', w: 1024, h: 768, label: 'Tablet, 1024 x 768' },
  { key: '1920x1080', w: 1920, h: 1080, label: 'Screen, 1920 x 1080' },
  { key: '800x1280', w: 800, h: 1280, label: 'Upright tablet, 800 x 1280' },
  { key: '390x844', w: 390, h: 844, label: 'Phone, 390 x 844', phone: true },
  { key: '360x740', w: 360, h: 740, label: 'Small phone, 360 x 740', phone: true },
  { key: '430x932', w: 430, h: 932, label: 'Big phone, 430 x 932', phone: true },
]
const screensFor = phone => SCREENS.filter(s => !!s.phone === !!phone)
// The screen last previewed on, kept apart for phone layouts.
const screenStore = phone => (phone ? 'maca_layout_screen_phone' : 'maca_layout_screen')
const storedScreen = phone => { try { return localStorage.getItem(screenStore(phone)) } catch { return null } }
const TOP_BAR = 64
const TINTS = { check: '#e0e7ff', categories: '#dcfce7', menus: '#ffedd5', items: '#fef3c7', category: '#ecfccb', buttons: '#fce7f3', modifiers: '#e0f2fe', seats: '#ede9fe', popup: '#fae8ff' }
const NEEDS_TARGET = { item: 'item_id', discount_preset: 'preset_id', tender: 'tender', charge: 'charge_id', open_popup: 'popup_id' }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function freshId(taken, base) {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(base + n)) return base + n
}
const ZONE_BASE = { check: 'order', categories: 'cats', menus: 'menus', items: 'dishes', category: 'category', buttons: 'buttons', modifiers: 'choices', seats: 'seats', popup: 'popup' }

/** How a zone is named in lists and notes: Pop-up: Drinks, Dish choices: Must pick, Buttons 2, Order (pop-up). */
function zoneName(z, layout, names = null) {
  if (z.type === 'popup') return 'Pop-up: ' + z.title
  // A zone shown as a pop-up says so (and its own name, when it has one).
  const pop = isPopup(z) ? ' (pop-up' + (z.title ? ': ' + z.title : '') + ')' : ''
  if (z.type === 'category' && z.section_id && names?.sections.get(z.section_id)) return 'Dishes: ' + names.sections.get(z.section_id).title + pop
  if (z.type === 'modifiers') return zoneLabel(z.type) + ': ' + (CHOICE_KINDS.find(k => k.key === z.kind)?.label || '')
  const same = (layout?.zones || []).filter(x => x.type === z.type)
  return zoneLabel(z.type) + (same.length > 1 ? ' ' + (same.indexOf(z) + 1) : '') + pop
}

/** A pop-up as a button's target names it: its name, and the zone it is when it isn't a Pop-up zone. */
const popupOption = z => popupTitle(z) + (z.type === 'popup' ? '' : ' (the ' + zoneLabel(z.type) + ' zone)')

/**
 * What the button that opens a pop-up says under its words on the till, as
 * an example: the order's items and total, the category open.
 */
function openerNote(popup, { setup, names, layout }) {
  if (!popup) return null
  if (popup.type === 'check') return '3 items · £19.50'
  if (popup.type === 'categories') {
    const first = popup.sections?.[0] || (setup?.sections || [])[0]?.id
    return names.sections.get(first)?.title || null
  }
  return null
}

/** Where a new zone goes: a free rectangle as near the wanted size as there is. */
function placeZone(layout, type) {
  const { cols, rows, zones } = layout
  const solid = zones.filter(z => !floats(z))
  // A pop-up opens over the middle of the screen, over whatever is there.
  if (type === 'popup') return { x: Math.floor(cols / 4), y: Math.floor(rows / 4), w: Math.max(1, Math.round(cols / 2)), h: Math.max(1, Math.round(rows / 2)) }
  if (type === 'modifiers') {
    const over = zones.find(z => z.type === 'items') || zones.find(z => z.type === 'categories')
    if (over) return { x: over.x, y: over.y, w: over.w, h: over.h }
  }
  const want = {
    check: { w: Math.round(cols / 3), h: rows },
    categories: { w: Math.round(cols / 2), h: 1 },
    menus: { w: Math.round(cols / 2), h: 1 },
    items: { w: Math.round(cols / 2), h: Math.max(2, rows - 2) },
    category: { w: Math.round(cols / 2), h: 2 },
    buttons: { w: Math.round(cols / 2), h: 2 },
    modifiers: { w: Math.round(cols / 2), h: Math.round(rows / 2) },
    seats: { w: Math.round(cols / 2), h: 1 },
  }[type]
  const free = r => type === 'modifiers' || !solid.some(z => overlaps(z, r))
  for (let h = Math.min(rows, want.h); h >= 1; h--) {
    for (let w = Math.min(cols, want.w); w >= 1; w--) {
      for (let y = 0; y + h <= rows; y++) for (let x = 0; x + w <= cols; x++) if (free({ x, y, w, h })) return { x, y, w, h }
    }
  }
  return { x: 0, y: 0, w: 1, h: 1 }
}

function useWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return w
}

function useWindowHeight() {
  const [h, setH] = useState(() => window.innerHeight)
  useEffect(() => {
    const on = () => setH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return h
}

export default function TillLayoutDesigner() {
  const { id } = useParams()
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { canManage } = usePermission('pos_setup')
  const { venues, venueId, setVenueId } = usePosVenue()
  const { data: setup } = usePosSetup(venueId)
  const { data: discounts = [] } = useQuery({ queryKey: ['pos-discounts'], queryFn: () => api.get('/pos/discounts') })
  const { data: saved, error, isLoading } = useQuery({ queryKey: ['till-layout', id], queryFn: () => api.get('/pos/till-layouts/' + id) })
  const [draft, setDraft] = useState(null)
  const [selId, setSelId] = useState(null)
  // The button being edited in the selected zone: its page shows in the preview.
  const [selB, setSelB] = useState(null)
  // Dish choices zones are outlines until this fills them (a dish being added).
  const [showChoices, setShowChoices] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // The screen previewed on: one remembered for phone layouts, one for the rest.
  const [screenKeys, setScreenKeys] = useState(() => ({ false: storedScreen(false), true: storedScreen(true) }))

  useEffect(() => { if (saved) setDraft({ name: saved.name, layout: normaliseTillLayout(saved.layout) }) }, [saved])
  useEffect(() => setSelB(null), [selId])

  const save = useMutation({
    mutationFn: () => api.put('/pos/till-layouts/' + id, { name: draft.name.trim() || saved.name, layout: draft.layout }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['till-layout', id] })
      qc.invalidateQueries({ queryKey: ['till-layouts'] })
      qc.invalidateQueries({ queryKey: ['pos-setup'] })
    },
  })

  // The venue's sections and dishes by id, for the preview and the pickers.
  const names = useMemo(() => {
    const sections = new Map((setup?.sections || []).map(s => [s.id, s]))
    const items = Object.fromEntries((setup?.items || []).map(i => [i.id, i]))
    return { sections, items }
  }, [setup])

  if (isLoading || !draft) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader icon={PanelsTopLeft} title="Till layout" />
        <div className="p-6"><ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}</div>
      </div>
    )
  }

  const layout = draft.layout
  const dirty = JSON.stringify(draft) !== JSON.stringify({ name: saved.name, layout: normaliseTillLayout(saved.layout) })
  const problems = layoutProblems(layout)
  const warnings = layoutWarnings(layout)
  const sel = layout.zones.find(z => z.id === selId) || null
  const setLayout = fn => setDraft(d => ({ ...d, layout: normaliseTillLayout(fn(d.layout)) }))
  const patchZone = (zid, patch) => setLayout(l => ({ ...l, zones: l.zones.map(z => (z.id === zid ? { ...z, ...patch } : z)) }))
  const addZone = type => {
    const taken = new Set(layout.zones.map(z => z.id))
    const zid = freshId(taken, ZONE_BASE[type])
    const base = { id: zid, type, ...placeZone(layout, type) }
    if (type === 'modifiers') {
      const kinds = layout.zones.filter(z => z.type === 'modifiers').map(z => z.kind)
      base.kind = kinds.includes('required') ? 'optional' : kinds.includes('optional') ? 'required' : kinds.includes('all') ? 'optional' : 'all'
    }
    if (type === 'popup') {
      const titles = new Set(layout.zones.filter(z => z.type === 'popup').map(z => z.title))
      let n = titles.size + 1
      while (titles.has('Pop-up ' + n)) n++
      base.title = 'Pop-up ' + n
    }
    setLayout(l => ({ ...l, zones: [...l.zones, base] }))
    setSelId(zid)
  }
  // A pop-up taken out takes the buttons that open it with it (normaliseTillLayout drops them).
  const removeZone = zid => { setLayout(l => ({ ...l, zones: l.zones.filter(z => z.id !== zid) })); setSelId(null) }
  const screens = screensFor(layout.phone)
  const screen = screens.find(s => s.key === screenKeys[!!layout.phone]) || screens[0]
  const pickScreen = k => {
    setScreenKeys(v => ({ ...v, [!!layout.phone]: k }))
    try { localStorage.setItem(screenStore(layout.phone), k) } catch { /* private mode */ }
  }
  const back = () => (dirty ? setLeaving(true) : navigate('/pos/layouts'))
  const tenders = setup?.settings?.tenders || []
  const charges = setup?.charges || []
  const ctx = { setup, names, discounts, tenders, charges, layout }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={PanelsTopLeft} title={'Till layout: ' + saved.name}>
        <Btn onClick={back} data-testid="tl-back"><ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Till layouts</span></Btn>
        <VenueSelect venues={venues} venueId={venueId} onChange={setVenueId} />
        {canManage && (
          <>
            <Btn disabled={!dirty || save.isPending} onClick={() => { setDraft({ name: saved.name, layout: normaliseTillLayout(saved.layout) }); save.reset() }} data-testid="tl-discard">Discard</Btn>
            <Btn variant="primary" disabled={!dirty || save.isPending || problems.length > 0} onClick={() => save.mutate()} data-testid="tl-save"
              title={problems.length ? 'Fix the problems first' : undefined}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {dirty ? 'Save' : 'Saved'}
            </Btn>
          </>
        )}
      </PageHeader>
      {leaving && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-amber-50 text-amber-900 text-sm" role="alert" data-testid="tl-leave">
          <span className="flex-1 min-w-[200px]">Leave without saving your changes?</span>
          <Btn variant="danger" onClick={() => navigate('/pos/layouts')}>Leave</Btn>
          <Btn onClick={() => setLeaving(false)}>Stay</Btn>
        </div>
      )}
      {/* Room for the scrollbar always: the canvas sizes from the width, so a
          scrollbar coming and going would resize it in a loop (a shake). */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }} data-testid="tl-scroller">
        <div className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] items-start max-w-[1600px] mx-auto">
          <div className="space-y-3 min-w-0">
            {!canManage && <ReadOnlyNotice what="till layouts" />}
            <ErrorNote error={save.error} />
            <div className="flex flex-wrap items-center gap-2">
              <select value={screen.key} onChange={e => pickScreen(e.target.value)} aria-label="Screen to preview on" data-testid="tl-screen"
                className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation">
                {screens.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              {layout.zones.some(z => z.type === 'modifiers') && (
                <Btn onClick={() => setShowChoices(v => !v)} aria-pressed={showChoices} data-testid="tl-show-choices">
                  {showChoices ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showChoices ? 'Back to the screen between dishes' : 'Show a dish being added'}
                </Btn>
              )}
              <span className="text-xs text-muted-foreground">Dishes, discounts, tenders and charges from {setup?.venue?.name || 'the venue'}.</span>
            </div>
            <Canvas layout={layout} screen={screen} selId={selId} onSelect={setSelId} showChoices={showChoices}
              canEdit={canManage} onMove={patchZone} ctx={ctx} focus={selB}
              bad={new Set(problems.flatMap(p => p.zones))} />
            <p className="text-xs text-muted-foreground">
              Tap a zone to change it. {canManage ? 'Drag it to move it, its corner to resize it. ' : ''}Dish choices zones (dashed blue) show on the till only while a dish is being added, and pop-ups (dashed purple: a Pop-up zone, or any zone shown as a pop-up) only when a button opens them, over the zones under them or the whole screen: tap a dashed zone's name to change it.
            </p>
          </div>

          <div className="space-y-4 min-w-0 lg:sticky lg:top-0" data-testid="tl-panel">
            {sel
              ? <ZonePanel zone={sel} ctx={ctx} canManage={canManage} onBack={() => setSelId(null)} selB={selB} setSelB={setSelB}
                  onChange={patch => patchZone(sel.id, patch)} onRemove={() => removeZone(sel.id)} onPatchZone={patchZone} onPick={setSelId} />
              : (
                <>
                  <ReadOnlyFieldset disabled={!canManage}>
                    <Section title="Layout">
                      <Field label="Name">
                        <input className={inputCls} value={draft.name} maxLength={60} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} data-testid="tl-name" />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Stepper label="Cells across" value={layout.cols} min={LAYOUT_COLS.min} max={LAYOUT_COLS.max} testid="tl-cols"
                          onChange={v => setLayout(l => ({ ...l, cols: v }))} />
                        <Stepper label="Cells down" value={layout.rows} min={LAYOUT_ROWS.min} max={LAYOUT_ROWS.max} testid="tl-rows"
                          onChange={v => setLayout(l => ({ ...l, rows: v }))} />
                      </div>
                      <p className="text-xs text-muted-foreground">The screen is split into this grid; each zone takes a block of its cells.</p>
                      <Field group label="Made for">
                        <div className="grid grid-cols-2 gap-2" data-testid="tl-made-for">
                          {[{ phone: false, label: 'Tablet or screen', Icon: Tablet }, { phone: true, label: 'Phone', Icon: Smartphone }].map(o => (
                            <button key={o.label} type="button" aria-pressed={layout.phone === o.phone} data-k={o.phone ? 'phone' : 'tablet'}
                              onClick={() => setLayout(l => ({ ...l, phone: o.phone }))}
                              className={cn('min-h-[48px] px-2 rounded-lg border text-sm touch-manipulation inline-flex items-center justify-center gap-2',
                                layout.phone === o.phone ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                              <o.Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> {o.label}
                            </button>
                          ))}
                        </div>
                      </Field>
                      <p className="text-xs text-muted-foreground -mt-1" data-testid="tl-made-for-hint">
                        {layout.phone
                          ? 'A phone held upright. A till on a phone-sized screen draws this layout when it is the one picked for it; tablets and bigger screens can use it too. Keep few zones on screen: show the order (and anything else) as a pop-up, and lay dishes out as a list.'
                          : 'Tablets and bigger screens. A till on a phone-sized screen doesn\'t draw it: it shows the built-in phone screen instead (or a layout made for a phone, when that is the one picked for it).'}
                      </p>
                      <Toggle label="The till's top bar on the order screen" checked={layout.top_bar !== false} onChange={v => setLayout(l => ({ ...l, top_bar: v }))} />
                      <p className="text-xs text-muted-foreground -mt-1" data-testid="tl-top-bar-hint">
                        {layout.top_bar !== false
                          ? 'The bar with Floor, Counter, Closed, Reports, Till and sign out stays across the top.'
                          : 'Off: the layout takes the whole screen. The till\'s pages, sign out and its details are in More (and on the counter\'s New order panel); the other pages keep the bar.'}
                      </p>
                    </Section>
                  </ReadOnlyFieldset>
                  <Section title="Zones" hint="Tap one to change it.">
                    <div className="space-y-1.5" data-testid="tl-zones">
                      {layout.zones.map(z => (
                        <button key={z.id} type="button" onClick={() => setSelId(z.id)} data-testid="tl-zone-row" data-zone-id={z.id}
                          className="w-full min-h-[44px] flex items-center gap-2 px-3 rounded-lg border bg-background hover:bg-muted text-left touch-manipulation">
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: TINTS[z.type] }} />
                          <span className="text-sm font-medium flex-1 min-w-0 truncate">{zoneName(z, layout, names)}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{z.w} x {z.h}</span>
                        </button>
                      ))}
                    </div>
                    {canManage && (
                      <label className="flex items-center gap-2">
                        <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                        <select className={cn(inputCls, 'flex-1')} value="" disabled={layout.zones.length >= MAX_ZONES}
                          onChange={e => e.target.value && addZone(e.target.value)} aria-label="Add a zone" data-testid="tl-add-zone">
                          <option value="">Add a zone…</option>
                          {ZONE_TYPES.map(t => {
                            const full = layout.zones.filter(z => z.type === t.key).length >= t.max
                            return <option key={t.key} value={t.key} disabled={full}>{t.label}{full ? (t.max === 1 ? ' (has one)' : ' (has ' + t.max + ')') : ''}</option>
                          })}
                        </select>
                      </label>
                    )}
                  </Section>
                  <Notes problems={problems} warnings={warnings} onPick={setSelId} />
                  <p className="text-xs text-muted-foreground" data-testid="tl-used-by">{usedByText(saved.used_by, venues)}.</p>
                </>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** What stops a save (red) and what is worth knowing (amber). */
function Notes({ problems, warnings, onPick }) {
  if (!problems.length && !warnings.length) return null
  return (
    <div className="space-y-2" data-testid="tl-notes">
      {problems.map((p, i) => (
        <button key={'p' + i} type="button" onClick={() => p.zones[0] && onPick(p.zones[0])} data-testid="tl-problem" data-code={p.code}
          className="w-full text-left flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm touch-manipulation">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {p.message}
        </button>
      ))}
      {warnings.map((w, i) => (
        <button key={'w' + i} type="button" onClick={() => w.zones[0] && onPick(w.zones[0])} data-testid="tl-warning" data-code={w.code}
          className="w-full text-left flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-sm touch-manipulation">
          <Info className="w-4 h-4 shrink-0 mt-0.5" /> {w.message}
        </button>
      ))}
    </div>
  )
}

/** A number with − and + (48 px), for places, sizes and grids. */
function Stepper({ label, value, min, max, step = 1, onChange, testid }) {
  return (
    <Field group label={label}>
      <div className="flex items-center gap-1" data-testid={testid}>
        <button type="button" className="w-12 h-12 rounded-lg border bg-background hover:bg-muted flex items-center justify-center touch-manipulation disabled:opacity-40"
          disabled={value <= min} onClick={() => onChange(clamp(value - step, min, max))} aria-label={label + ': less'}><Minus className="w-4 h-4" /></button>
        <span className="w-10 text-center text-sm font-semibold tabular-nums" data-value={value}>{value}</span>
        <button type="button" className="w-12 h-12 rounded-lg border bg-background hover:bg-muted flex items-center justify-center touch-manipulation disabled:opacity-40"
          disabled={value >= max} onClick={() => onChange(clamp(value + step, min, max))} aria-label={label + ': more'}><Plus className="w-4 h-4" /></button>
      </div>
    </Field>
  )
}

/**
 * A text box for words kept in the layout (a pop-up's name, a button's
 * words). The layout is tidied on every change, which trims its words, so the
 * box keeps what was typed while it has the focus: a space at the end of a
 * word would otherwise go as it is typed ("Hot drinks" came out "Hotdrinks").
 * Give it a key per thing it edits, so it starts again for another one.
 */
function WordsInput({ value, onChange, ...rest }) {
  const [typed, setTyped] = useState(null)
  return (
    <input className={inputCls} maxLength={LABEL_MAX} {...rest} value={typed ?? value ?? ''}
      onChange={e => { setTyped(e.target.value); onChange(e.target.value) }} onBlur={() => setTyped(null)} />
  )
}

// ── The canvas ─────────────────────────────────────────────────────

function Canvas({ layout, screen, selId, onSelect, showChoices, canEdit, onMove, ctx, bad, focus = null }) {
  const ref = useRef(null)
  const avail = useWidth(ref)
  // As wide as the column, but a tall screen (upright tablet) fits the window's height.
  const fitH = Math.max(320, useWindowHeight() - 200)
  const scale = avail ? Math.min(avail / screen.w, fitH / screen.h) : 0
  const width = Math.floor(screen.w * scale)
  const topBar = layout.top_bar !== false
  const barH = topBar ? TOP_BAR * scale : 0
  const height = (screen.h - (topBar ? TOP_BAR : 0)) * scale
  const cw = width / layout.cols
  const rh = height / layout.rows
  const drag = useRef(null)
  const [ghost, setGhost] = useState(null)
  const ghostRef = useRef(null)
  const setG = g => { ghostRef.current = g; setGhost(g) }

  const start = (e, z, mode) => {
    e.stopPropagation()
    onSelect(z.id)
    if (!canEdit) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { z, mode, sx: e.clientX, sy: e.clientY }
    setG({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h })
  }
  const move = e => {
    const d = drag.current
    if (!d || !cw || !rh) return
    const dx = Math.round((e.clientX - d.sx) / cw)
    const dy = Math.round((e.clientY - d.sy) / rh)
    if (d.mode === 'move') {
      setG({ id: d.z.id, w: d.z.w, h: d.z.h, x: clamp(d.z.x + dx, 0, layout.cols - d.z.w), y: clamp(d.z.y + dy, 0, layout.rows - d.z.h) })
    } else {
      setG({ id: d.z.id, x: d.z.x, y: d.z.y, w: clamp(d.z.w + dx, 1, layout.cols - d.z.x), h: clamp(d.z.h + dy, 1, layout.rows - d.z.y) })
    }
  }
  const end = () => {
    const d = drag.current
    const g = ghostRef.current
    drag.current = null
    setG(null)
    if (d && g && (g.x !== d.z.x || g.y !== d.z.y || g.w !== d.z.w || g.h !== d.z.h)) onMove(d.z.id, { x: g.x, y: g.y, w: g.w, h: g.h })
  }

  const at = z => (ghost?.id === z.id ? { ...z, ...ghost } : z)
  const solid = layout.zones.filter(z => !floats(z))
  const bar = choiceZones(layout).required
  // Every zone is drawn; the selected one on top, so its handle can always be reached.
  const drawn = [...layout.zones].sort((a, b) => (a.id === selId) - (b.id === selId))
  // A pop-up's tab: its name (the dashed purple outline says it is a pop-up);
  // a zone shown as a pop-up says which zone it is too.
  const whole = z => (z.cover === 'screen' ? ' · whole screen' : '')
  const label = z => (z.type === 'popup' ? z.title + whole(z)
    : z.type === 'modifiers' ? zoneLabel(z.type) + ' · ' + CHOICE_KINDS.find(k => k.key === z.kind)?.label + whole(z)
      : isPopup(z) ? zoneLabel(z.type) + (z.title ? ': ' + z.title : '') + ' · pop-up' + whole(z)
        : zoneLabel(z.type))
  // Name tabs that would sit on the same corner stack, so each can be tapped:
  // pop-ups from the bottom left up, Dish choices from the top right down (a
  // phone layout's Order and Categories pop-ups often share their space).
  const TAB_STEP = 22
  const corner = o => (o.type === 'modifiers' ? (o.x + o.w) + ':' + o.y : o.x + ':' + (o.y + o.h))
  const placed = layout.zones.map(at)
  const tabOffset = z => {
    const same = placed.filter(o => floats(o) && (o.type === 'modifiers') === (z.type === 'modifiers') && corner(o) === corner(z))
    const slot = Math.max(0, same.findIndex(o => o.id === z.id))
    // Never past the zone's own height (its outline clips what is outside it).
    const room = Math.max(0, Math.floor((z.h * rh - 12) / TAB_STEP) - 1)
    return 4 + Math.min(slot, room) * TAB_STEP
  }

  return (
    <div ref={ref} className="w-full" data-testid="tl-canvas-wrap">
      <div className="mx-auto rounded-xl border bg-white overflow-hidden select-none" data-testid="tl-canvas" data-top-bar={topBar ? '1' : '0'}
        style={{ touchAction: 'none', width: width || undefined }} onPointerDown={() => onSelect(null)}>
        {topBar && (
          <div style={{ height: barH }} className="bg-slate-800 text-white/70 flex items-center px-2 overflow-hidden" data-testid="tl-top-bar"
            aria-hidden="true"><span style={{ fontSize: Math.max(8, 14 * scale) }}>The till's top bar</span></div>
        )}
        <div className="relative" style={{ height }}>
          {/* The cells. */}
          <div className="absolute inset-0 grid" aria-hidden="true"
            style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}>
            {Array.from({ length: layout.cols * layout.rows }).map((_, i) => <div key={i} className="border border-dashed border-slate-200" />)}
          </div>
          {width > 0 && drawn.map(z0 => {
            const z = at(z0)
            const isSel = z.id === selId
            const isMod = z.type === 'modifiers'
            // A Pop-up zone, or any zone shown as a pop-up.
            const isPop = isPopup(z)
            const floating = isMod || isPop
            // A Dish choices zone or a pop-up is an outline over the zones under it
            // (they stay in sight and can be tapped); selected (or a Dish choices
            // zone with a dish being added) it fills. An outline sits above even
            // a selected zone, so its name tab can always be tapped (taps
            // anywhere else go through it).
            const outline = floating && !isSel && !(isMod && showChoices)
            const clash = ghost?.id === z.id && !floating && solid.some(o => o.id !== z.id && overlaps(o, z))
            return (
              <div key={z.id} data-testid="tl-zone" data-zone-id={z.id} data-type={z.type} data-selected={isSel ? '1' : '0'} data-outline={outline ? '1' : undefined}
                data-popup={isPop ? '1' : undefined} data-cover={floating ? z.cover : undefined}
                data-x={z.x} data-y={z.y} data-w={z.w} data-h={z.h}
                onPointerDown={outline ? undefined : e => start(e, z0, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                className={cn('absolute rounded-md overflow-hidden', outline ? 'pointer-events-none' : canEdit ? 'cursor-move' : 'cursor-pointer',
                  isSel ? 'ring-4 ring-primary z-30' : outline ? 'z-40' : floating ? 'z-20' : 'z-10',
                  (bad.has(z.id) || clash) && 'ring-4 ring-red-500')}
                style={{
                  left: z.x * cw + 2, top: z.y * rh + 2, width: z.w * cw - 4, height: z.h * rh - 4,
                  background: outline ? 'transparent' : isMod ? 'rgba(224, 242, 254, 0.94)' : isPop ? 'rgba(250, 232, 255, 0.96)' : TINTS[z.type],
                  border: isMod ? '2px dashed #0284c7' : isPop ? '2px dashed #c026d3' : '1px solid rgba(15, 23, 42, 0.15)',
                }}>
                {floating ? (
                  // The name tab (Dish choices top right, pop-ups bottom left: clear of the
                  // zone under it and of each other): tap or drag it. A drag that starts on
                  // the tab keeps the tab's pointer (capture) as the zone fills.
                  <span onPointerDown={outline ? e => start(e, z0, 'move') : undefined} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                    data-testid="tl-zone-tab" data-type={z.type} data-zone-id={z.id}
                    style={isPop ? { bottom: tabOffset(z) } : { top: tabOffset(z) }}
                    className={cn('absolute z-10 rounded px-1.5 py-0.5 text-[10px] font-semibold border pointer-events-auto cursor-pointer max-w-[90%] truncate',
                      isPop ? 'left-1 border-fuchsia-600 bg-fuchsia-50 text-fuchsia-800' : 'right-1 border-sky-600 bg-sky-50 text-sky-800')}>
                    {label(z)}
                  </span>
                ) : (
                  <span className="absolute left-1 top-1 z-10 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 pointer-events-none">{label(z)}</span>
                )}
                {!outline && (
                  <div className="absolute inset-0 p-1 pt-6 pointer-events-none">
                    <ZonePreview zone={z} scale={scale} ctx={ctx} hasBar={bar?.id === z.id} focus={isSel ? focus : null} />
                  </div>
                )}
                {isSel && canEdit && (
                  <span onPointerDown={e => start(e, z0, 'size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                    data-testid="tl-resize" aria-label={'Resize ' + zoneLabel(z.type)}
                    className="absolute right-0 bottom-0 w-11 h-11 flex items-end justify-end cursor-nwse-resize touch-none">
                    <span className="w-5 h-5 m-1 rounded-sm bg-primary border-2 border-white shadow" />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// What a zone shows, drawn small: the same packing as the till. A pop-up (a
// Pop-up zone, or any zone shown as one) is drawn in its window: its border
// and shadow (none when it takes the whole screen), its window controls.
function ZonePreview({ zone, scale, ctx, hasBar, focus = null }) {
  const body = <ZoneBodyPreview zone={zone} scale={scale} ctx={ctx} hasBar={hasBar} focus={focus} />
  if (!isPopup(zone)) return body
  const framed = zone.frame && zone.cover !== 'screen'
  return (
    <div className={cn('h-full flex flex-col min-h-0 bg-white', framed && 'rounded-lg ring-2 ring-primary shadow-lg')}
      data-testid="tl-popup-preview" data-frame={framed ? '1' : '0'} data-controls={zone.controls ? '1' : '0'} data-cover={zone.cover}>
      {zone.controls && (
        <div className="shrink-0 flex items-center gap-1 px-1 border-b font-bold" style={{ fontSize: Math.max(7, 15 * scale) }} data-testid="tl-popup-bar">
          <span className="flex-1 min-w-0 truncate">{popupTitle(zone)}</span><X className="shrink-0" style={{ width: Math.max(8, 20 * scale), height: Math.max(8, 20 * scale) }} />
        </div>
      )}
      <div className="flex-1 min-h-0 p-0.5">{body}</div>
    </div>
  )
}

function ZoneBodyPreview({ zone, scale, ctx, hasBar, focus = null }) {
  const font = Math.max(7, (zone.font || FONT.default) * scale)
  if (zone.type === 'check') return <CheckPreview scale={scale} zone={zone} />
  if (zone.type === 'popup') return <GridPreview zone={zone} cells={previewCells(zone, ctx)} font={font} focus={focus} />
  if (zone.type === 'seats') {
    const seats = zone.parts !== 'courses'
    const courses = zone.parts !== 'seats'
    const chips = (list, on = 0) => list.map((s, i) => <span key={s} className={cn('rounded border px-1.5 bg-white', i === on && 'bg-slate-800 text-white')}>{s}</span>)
    // As a pop-up: the seats, then the courses, each under its heading.
    if (isPopup(zone)) {
      return (
        <div className="h-full overflow-hidden space-y-1 p-0.5" style={{ fontSize: font }} data-testid="tl-seats-preview" data-parts={zone.parts || 'both'} data-wrap="1">
          {seats && <div><div className="opacity-60">Seat</div><div className="flex flex-wrap gap-1">{chips(['Shared', '1', '2', '3', '4'])}</div></div>}
          {courses && <div><div className="opacity-60">Course</div><div className="flex flex-wrap gap-1">{chips(['Usual', 'Starters', 'Mains'])}</div></div>}
        </div>
      )
    }
    return (
      <div className="h-full flex items-center gap-1 overflow-hidden" style={{ fontSize: font }} data-testid="tl-seats-preview" data-parts={zone.parts || 'both'}>
        {seats && <>
          <span className="opacity-60">Seat</span>
          {chips(['Shared', '1', '2', '3', '4'])}
        </>}
        {courses && <>
          <span className={cn('opacity-60', seats && 'ml-1')}>Course</span>
          {chips(['Usual', 'Starters', 'Mains'])}
        </>}
      </div>
    )
  }
  const cells = previewCells(zone, ctx)
  return (
    <div className="h-full flex flex-col min-h-0">
      {zone.type === 'items' && zone.search && <div className="shrink-0 rounded border bg-white px-1 mb-0.5 text-slate-400" style={{ fontSize: Math.max(7, 12 * scale) }}>Find a dish</div>}
      {zone.type === 'modifiers' && hasBar && zone.show_name !== false && <div className="shrink-0 font-bold truncate" style={{ fontSize: Math.max(7, 16 * scale) }}>A dish's name</div>}
      <div className="flex-1 min-h-0"><GridPreview zone={zone} cells={cells} font={font} focus={focus} /></div>
      {zone.type === 'modifiers' && hasBar && (
        <div className="shrink-0 flex gap-0.5 mt-0.5" style={{ fontSize: Math.max(7, 12 * scale) }}>
          <span className="rounded border bg-white px-1">− 1 +</span>
          <span className="rounded border bg-white px-1">Cancel</span>
          <span className="flex-1 rounded bg-primary text-primary-foreground text-center">Add</span>
        </div>
      )}
    </div>
  )
}

function CheckPreview({ scale, zone }) {
  const f = Math.max(7, (zone.font || 16) * 0.8 * scale)
  const shown = ['more', 'send', 'bill', 'pay'].filter(k => !zone.hide?.includes(k))
  const words = { more: 'More', send: 'Send', bill: 'Bill', pay: 'Pay' }
  const colour = k => zone.colours?.[k] || (k === 'pay' ? '#16a34a' : k === 'send' ? '#334155' : null)
  return (
    <div className="h-full flex flex-col bg-white rounded" style={{ fontSize: f }} data-testid="tl-check-preview">
      <div className="border-b px-1 font-bold flex items-center gap-1">
        {!zone.hide?.includes('back') && <span>‹</span>}
        <span className="flex-1">Order #101</span>
        {!zone.hide?.includes('cancel') && <span className="font-semibold" style={{ color: zone.colours?.cancel || '#dc2626' }}>Cancel</span>}
      </div>
      <div className="flex-1 px-1 space-y-0.5 overflow-hidden">
        {['Pad Thai', 'Spring rolls', 'Cola'].map(n => <div key={n} className="flex justify-between"><span>1 {n}</span><span>£6.50</span></div>)}
      </div>
      {shown.length > 0 && (
        <div className="grid gap-0.5 p-0.5" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
          {shown.map(k => {
            const c = colour(k)
            return <span key={k} data-k={k} className="rounded border text-center" style={c ? { background: c, color: inkOn(c), borderColor: c } : undefined}>{words[k]}</span>
          })}
        </div>
      )}
    </div>
  )
}

/** A menu's times on the tills, in words: setup menus' till_times (false = off there). */
function tillTimesText(m) {
  if (m?.till_times === false) return 'Off on the tills'
  return timesLabel(m?.till_times ?? null)
}

/** The cells a zone holds, from the venue's menus and the zone's buttons. */
function previewCells(zone, { setup, names, discounts, tenders, charges, layout }) {
  if (zone.type === 'menus') {
    // The menus the tills have (a menu off on the tills never shows there).
    const menus = (setup?.menus || []).filter(m => m.till_times !== false)
    const picked = zone.menu_ids ? zone.menu_ids.map(id => menus.find(m => m.id === id)).filter(Boolean) : []
    const list = picked.length ? picked : menus
    return [
      ...(zone.times_button ? [{ key: 'times', label: 'Menu times', sub: zone.show_times ? 'Following' : null, colour: '#2f5bd3' }] : []),
      ...list.map(m => ({ key: m.id, label: m.name, sub: zone.show_times ? tillTimesText(m) : null })),
    ]
  }
  if (zone.type === 'categories') {
    const ids = zone.sections || (setup?.sections || []).map(s => s.id)
    return ids.map(sid => names.sections.get(sid)).filter(Boolean).map(s => ({ key: s.id, label: s.title }))
  }
  if (zone.type === 'items' || zone.type === 'category') {
    const cats = layout.zones.find(z => z.type === 'categories')
    const first = cats?.sections?.[0] || (setup?.sections || [])[0]?.id
    const all = setup?.items || []
    const list = zone.type === 'category' ? all.filter(i => i.section_id === zone.section_id)
      : cats ? all.filter(i => i.section_id === first) : all
    const shown = new Set(shownDishIds(zone, list.map(i => i.id)))
    return list.filter(i => shown.has(i.id))
      .map(i => ({ key: i.id, label: i.name, sub: zone.price ? (i.price_pence != null ? money(i.price_pence) : '£') : null }))
  }
  if (zone.type === 'buttons' || zone.type === 'popup') {
    const popups = layout.zones.filter(isPopup)
    return zone.buttons.map(b => ({
      key: b.id, w: b.w, h: b.h, colour: b.colour,
      label: buttonLabel(b, { items: names.items, presets: discounts, tenders, charges, popups }),
      // What the till says on a button that opens a pop-up (the order's items and total, the category open).
      sub: b.action === 'open_popup' ? openerNote(popups.find(z => z.id === b.popup_id), { setup, names, layout }) : null,
    }))
  }
  if (zone.type === 'modifiers') {
    const head = t => ({ key: t, label: t, w: zone.cols, head: true })
    // Every other choice with an extra price, to show where prices go.
    const opts = (p, n) => Array.from({ length: n }).map((_, i) => ({
      key: p + i, label: 'Choice ' + (i + 1), sub: zone.show_prices !== false && i % 2 === 1 ? '+£0.50' : null,
    }))
    if (zone.kind === 'required') return [head('Must pick'), ...opts('r', 4)]
    if (zone.kind === 'optional') return [head('Optional'), ...opts('o', 4)]
    return [head('Must pick'), ...opts('r', 3), head('Optional'), ...opts('o', 3)]
  }
  return []
}

function inkOn(hex) {
  const n = parseInt(String(hex).slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#111827' : '#ffffff'
}

function GridPreview({ zone, cells, font, focus = null }) {
  const packed = packCells(cells.map(c => ({ w: c.w || 1, h: c.h || 1 })), zone)
  // The button being edited: the page that holds it, outlined; behind More, More is.
  const fi = focus ? cells.findIndex(c => c.key === focus) : -1
  const at = fi < 0 ? 0 : Math.max(0, packed.pages.findIndex(pg => pg.some(p => p.i === fi)))
  const inMore = fi >= 0 && packed.rest.includes(fi)
  const page = (packed.pages[at] || []).filter(p => p.x < zone.cols && p.y < zone.rows)
  const scrolls = zone.overflow === 'scroll' && (packed.rows > zone.rows || packed.cols > zone.cols)
  // Where the words sit on the buttons, as on the till (a list: a row each,
  // the words on the left and the second line on the right).
  const place = buttonTextStyle(zone)
  const list = isList(zone)
  if (!cells.length) return <div className="h-full flex items-center justify-center text-center text-slate-500 text-[10px]">Nothing here yet</div>
  return (
    <div className="h-full flex flex-col min-h-0" style={{ fontSize: font, fontWeight: zone.bold === false ? 500 : 700 }} data-testid="tl-grid" data-view={list ? 'list' : 'grid'}
      data-pages={packed.pages.length} data-rest={packed.rest.length} data-hidden={packed.hidden} data-scrolls={scrolls ? '1' : '0'}>
      <div className="flex-1 min-h-0 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${zone.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${zone.rows}, minmax(0, 1fr))` }}>
        {page.map(p => {
          const c = cells[p.i]
          return (
            <div key={c.key} className={cn('min-w-0 min-h-0 rounded-sm overflow-hidden leading-tight', list ? 'px-1' : 'px-0.5', c.head ? 'text-slate-600' : 'border bg-white flex flex-col')}
              style={{
                gridColumn: `${p.x + 1} / span ${Math.min(p.w, zone.cols - p.x)}`, gridRow: `${p.y + 1} / span ${Math.min(p.h, zone.rows - p.y)}`,
                ...(c.head ? {} : place),
                ...(c.colour ? { background: c.colour, color: inkOn(c.colour), borderColor: c.colour } : {}),
                ...(p.i === fi ? { outline: '2px solid #0284c7', outlineOffset: '-2px' } : {}),
              }}
              data-testid="tl-cell" data-focus={p.i === fi ? '1' : undefined}>
              <span className={cn('line-clamp-2 break-words', list && !c.head && 'flex-1 min-w-0')} data-testid="tl-cell-words">{c.label}</span>
              {c.sub && <span className={cn('opacity-70 font-medium', list && 'shrink-0')} style={{ fontSize: '0.8em' }} data-testid="tl-cell-sub">{c.sub}</span>}
            </div>
          )
        })}
        {packed.rest.length > 0 && (
          <div className="rounded-sm border border-dashed border-primary text-primary flex items-center justify-center text-center" data-focus={inMore ? '1' : undefined}
            style={{ gridColumn: `${zone.cols} / span 1`, gridRow: `${zone.rows} / span 1`, ...(inMore ? { outline: '2px solid #0284c7', outlineOffset: '-2px' } : {}) }}>
            More ({packed.rest.length})
          </div>
        )}
      </div>
      {(packed.pages.length > 1 || scrolls || packed.hidden > 0) && (
        <div className="shrink-0 text-center text-[9px] font-semibold text-slate-600 leading-tight">
          {packed.pages.length > 1 ? '‹ ' + (at + 1) + ' / ' + packed.pages.length + ' ›' : scrolls ? (packed.cols > zone.cols ? 'scrolls across' : 'scrolls down') : packed.hidden + ' left out'}
        </div>
      )}
    </div>
  )
}

// ── A zone's settings ──────────────────────────────────────────────

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight }
const VALIGN_ICONS = { top: AlignVerticalJustifyStart, middle: AlignVerticalJustifyCenter, bottom: AlignVerticalJustifyEnd }
// What Top means for the second line of a zone's buttons.
const PLACE_HINTS = {
  menus: 'At the top, a menu\'s times (when they show) stay at the bottom of the button.',
  items: 'At the top, the price stays at the bottom of the button; in the middle or at the bottom it goes under the dish\'s name.',
  modifiers: 'At the top, a price stays at the bottom of the button; in the middle or at the bottom it goes under the choice. The group headings stay on the left.',
  buttons: 'At the top, a dish button\'s Sold out line stays at the bottom of the button.',
  popup: 'At the top, a dish button\'s Sold out line stays at the bottom of the button.',
}
// What a zone shown as a pop-up does on the till.
const SHOW_BACK = ' Back to Always, the buttons that open it are taken out.'
const SHOW_HINTS = {
  check: 'The order leaves the screen and opens from a button, which says its items and total under its words (or how many orders wait). It closes by itself when its order is paid, cancelled or left.' + SHOW_BACK,
  categories: 'The categories open from a button, which says the category that is open under its words.' + SHOW_BACK,
  menus: 'The menus open from a button.' + SHOW_BACK,
  items: 'The dishes open from a button.' + SHOW_BACK,
  category: 'This category\'s dishes open from a button.' + SHOW_BACK,
  seats: 'The seat and course open from a button, which says the ones picked under its words.' + SHOW_BACK,
}
// What a list's rows hold.
const LIST_HINTS = {
  categories: 'One category a row.',
  menus: 'One menu a row, its times (when they show) on the right.',
  items: 'One dish a row: its name on the left, its price on the right.',
  category: 'One dish a row: its name on the left, its price on the right.',
  buttons: 'One button a row: its words on the left, what it says under them in a grid (an order\'s total, Sold out) on the right.',
  modifiers: 'One choice a row: its name on the left, its price on the right. The group headings stay above their choices.',
  popup: 'One button a row: its words on the left, what it says under them in a grid on the right.',
}
// A pop-up that closes after it is used: what "used" is for each zone.
const AFTER_USE = {
  popup: 'After any of its buttons is used',
  categories: 'After a category is picked',
  menus: 'After a menu is picked',
  items: 'After a dish is tapped',
  category: 'After a dish is tapped',
  seats: 'After a seat or course is picked',
}

/** One of the two rows of Words on the buttons: three buttons, an icon and a word each. */
function PlaceRow({ label, value, options, icons, onChange, testid }) {
  return (
    <div className="flex items-center gap-2" data-testid={testid}>
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex-1 grid grid-cols-3 gap-1.5">
        {options.map(o => {
          const Icon = icons[o.key]
          const on = value === o.key
          return (
            <button key={o.key} type="button" aria-pressed={on} data-k={o.key} onClick={() => onChange(o.key)}
              className={cn('min-h-[48px] px-1.5 rounded-lg border text-sm touch-manipulation inline-flex items-center justify-center gap-1 min-w-0',
                on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /><span className="truncate">{o.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ZonePanel({ zone, ctx, canManage, onBack, onChange, onRemove, onPatchZone = () => {}, onPick = () => {}, selB = null, setSelB = () => {} }) {
  const t = ZONE_TYPES.find(x => x.key === zone.type)
  const { layout } = ctx
  // A pop-up's openers go with it when it is taken out (or shown always again).
  const pop = isPopup(zone)
  const openers = pop ? popupOpeners(layout, zone.id) : []
  const list = isList(zone)
  // As a pop-up, a phone layout's order takes the whole screen; everything
  // else starts over its own cells. Back to Always, its openers go.
  const setShow = show => onChange(show === 'popup'
    ? { show, ...(zone.type === 'check' && layout.phone ? { cover: 'screen' } : {}) }
    : { show })
  // A list: a row for each cell of the zone's height to start with. Back to a
  // grid: the zone type's usual buttons across (a list has one).
  const setView = view => onChange(view === 'list'
    ? { view, rows: clamp(zone.h, ZONE_GRID.min, ZONE_GRID.max) }
    : { view, cols: zone.cols > 1 ? zone.cols : gridDefaults(zone.type).cols })
  return (
    <Section title={t.label} hint={t.hint}
      actions={<Btn onClick={onBack} data-testid="tl-zone-back"><ArrowLeft className="w-4 h-4" /> Layout</Btn>}>
      <ReadOnlyFieldset disabled={!canManage}>
        <div className="space-y-4" data-testid="tl-zone-panel" data-zone-id={zone.id} data-type={zone.type}>
          <div className="grid grid-cols-2 gap-3">
            <Stepper label="From the left" value={zone.x} min={0} max={layout.cols - zone.w} onChange={v => onChange({ x: v })} testid="tl-x" />
            <Stepper label="From the top" value={zone.y} min={0} max={layout.rows - zone.h} onChange={v => onChange({ y: v })} testid="tl-y" />
            <Stepper label="Wide" value={zone.w} min={1} max={layout.cols - zone.x} onChange={v => onChange({ w: v })} testid="tl-w" />
            <Stepper label="High" value={zone.h} min={1} max={layout.rows - zone.y} onChange={v => onChange({ h: v })} testid="tl-h" />
          </div>
          {pop && zone.cover === 'screen' && (
            <p className="text-xs text-muted-foreground -mt-2" data-testid="tl-whole-screen-note">
              On the till it takes the whole screen while it is open. Its place here is only where its outline sits in the designer.
            </p>
          )}
          {POPUP_ZONES.includes(zone.type) && (
            <>
              <Field group label="On the screen">
                <div className="grid grid-cols-2 gap-2" data-testid="tl-show">
                  {SHOWS.map(o => (
                    <button key={o.key} type="button" aria-pressed={zone.show === o.key} data-k={o.key} onClick={() => zone.show !== o.key && setShow(o.key)}
                      className={cn('min-h-[48px] px-2 rounded-lg border text-sm touch-manipulation', zone.show === o.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </Field>
              <p className="text-xs text-muted-foreground -mt-2" data-testid="tl-show-hint">
                {pop ? SHOW_HINTS[zone.type]
                  : 'Always there, in its own space. As a pop-up it leaves the screen and shows only when a button opens it, over the zones under it or the whole screen: the way to fit a phone.'}
              </p>
            </>
          )}
          {pop && zone.type !== 'popup' && <PopupOptions zone={zone} layout={layout} openers={openers} canManage={canManage} onChange={onChange} onPatchZone={onPatchZone} onPick={onPick} />}
          {GRID_ZONES.includes(zone.type) && (
            <>
              <Field group label="Laid out as">
                <div className="grid grid-cols-2 gap-2" data-testid="tl-view">
                  {VIEWS.map(o => {
                    const Icon = o.key === 'list' ? List : LayoutGrid
                    const on = (zone.view || 'grid') === o.key
                    return (
                      <button key={o.key} type="button" aria-pressed={on} data-k={o.key} onClick={() => !on && setView(o.key)}
                        className={cn('min-h-[48px] px-2 rounded-lg border text-sm touch-manipulation inline-flex items-center justify-center gap-2', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> {o.label}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <p className="text-xs text-muted-foreground -mt-2" data-testid="tl-view-hint">
                {list ? LIST_HINTS[zone.type] || LIST_HINTS.buttons
                  : 'Buttons side by side. A list is one button a row, its words on the left: easier on a narrow screen.'}
              </p>
              {list ? (
                <>
                  <Stepper label="Rows showing" value={zone.rows} min={ZONE_GRID.min} max={ZONE_GRID.max} onChange={v => onChange({ rows: v })} testid="tl-zone-rows" />
                  <p className="text-xs text-muted-foreground -mt-2">The rows take their height from this: fewer makes them taller. On the till a row is never under 48 px, so a list that scrolls may show fewer.</p>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Stepper label="Buttons across" value={zone.cols} min={ZONE_GRID.min} max={ZONE_GRID.max} onChange={v => onChange({ cols: v })} testid="tl-zone-cols" />
                    <Stepper label="Buttons down" value={zone.rows} min={ZONE_GRID.min} max={ZONE_GRID.max} onChange={v => onChange({ rows: v })} testid="tl-zone-rows" />
                  </div>
                  <p className="text-xs text-muted-foreground -mt-2">The buttons take their size from these: fewer across and down makes them bigger.</p>
                </>
              )}
              <div className="grid grid-cols-2 gap-3 items-end">
                <Stepper label="Text size" value={zone.font} min={FONT.min} max={FONT.max} onChange={v => onChange({ font: v })} testid="tl-font" />
                <Toggle label="Bold" checked={zone.bold} onChange={v => onChange({ bold: v })} />
              </div>
              {!list && (
                <>
                  <Field group label="Words on the buttons">
                    <div className="space-y-2">
                      <PlaceRow label="Across" value={zone.align} options={ALIGNS} icons={ALIGN_ICONS} onChange={v => onChange({ align: v })} testid="tl-align" />
                      <PlaceRow label="Up and down" value={zone.valign} options={VALIGNS} icons={VALIGN_ICONS} onChange={v => onChange({ valign: v })} testid="tl-valign" />
                    </div>
                  </Field>
                  {PLACE_HINTS[zone.type] && <p className="text-xs text-muted-foreground -mt-2" data-testid="tl-place-hint">{PLACE_HINTS[zone.type]}</p>}
                </>
              )}
              <Field group label="When more than fits">
                <div className="grid grid-cols-2 gap-2" data-testid="tl-overflow">
                  {OVERFLOWS.map(o => (
                    <button key={o.key} type="button" aria-pressed={zone.overflow === o.key} data-k={o.key} onClick={() => onChange({ overflow: o.key })}
                      className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation', zone.overflow === o.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </Field>
              <p className="text-xs text-muted-foreground -mt-2">{OVERFLOW_HINTS[zone.overflow]}</p>
            </>
          )}
          {zone.type === 'categories' && <CategoriesPicker zone={zone} ctx={ctx} onChange={onChange} />}
          {zone.type === 'menus' && <MenusZoneOptions zone={zone} ctx={ctx} onChange={onChange} />}
          {zone.type === 'items' && (
            <>
              <div className="space-y-1">
                <Toggle label="Search box on top" checked={zone.search} onChange={v => onChange({ search: v })} />
                <Toggle label="Prices on the buttons" checked={zone.price} onChange={v => onChange({ price: v })} />
              </div>
              <LeftOutDishes zone={zone} ctx={ctx} onChange={onChange} />
            </>
          )}
          {zone.type === 'category' && <CategoryZoneOptions zone={zone} ctx={ctx} onChange={onChange} />}
          {zone.type === 'popup' && <PopupOptions zone={zone} layout={layout} openers={openers} canManage={canManage} onChange={onChange} onPatchZone={onPatchZone} onPick={onPick} />}
          {(zone.type === 'buttons' || zone.type === 'popup') && <ButtonsEditor zone={zone} ctx={ctx} canManage={canManage} onChange={onChange} selB={selB} setSelB={setSelB} />}
          {zone.type === 'modifiers' && (
            <>
              <Field group label="Shows">
                <Segmented value={zone.kind} options={CHOICE_KINDS.map(k => ({ value: k.key, label: k.label }))} onChange={v => onChange({ kind: v })} />
              </Field>
              <p className="text-xs text-muted-foreground -mt-2">
                Must pick: the choices a dish needs (a size, a sauce). Optional: the extras. With one zone for each, the till splits them; the Add button goes with the must-pick ones.
              </p>
              <Field group label="Draws over">
                <Segmented value={zone.cover} options={COVERS.map(c => ({ value: c.key, label: c.label }))} onChange={v => onChange({ cover: v })} />
              </Field>
              <p className="text-xs text-muted-foreground -mt-2">
                {zone.cover === 'screen' ? 'Over the whole screen while a dish is being added: every choice shows here.' : 'Over the zones under its own space while a dish is being added.'}
              </p>
              <ChoiceZoneOptions zone={zone} layout={layout} onChange={onChange} />
            </>
          )}
          {zone.type === 'check' && <CheckZoneOptions zone={zone} layout={layout} onChange={onChange} />}
          {zone.type === 'seats' && (
            <>
              <Field group label="Shows">
                <div className="grid grid-cols-3 gap-1.5" data-testid="tl-seat-parts">
                  {SEAT_PARTS.map(p => (
                    <button key={p.key} type="button" aria-pressed={zone.parts === p.key} data-k={p.key} onClick={() => onChange({ parts: p.key })}
                      className={cn('min-h-[48px] px-2 rounded-lg border text-sm touch-manipulation', zone.parts === p.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </Field>
              <p className="text-xs text-muted-foreground -mt-2">
                {zone.parts === 'seats' ? 'Dishes go to their usual course; staff pick only the seat.'
                  : zone.parts === 'courses' ? 'Dishes go to the whole table (Shared); staff pick only the course.'
                    : 'Staff pick the seat and the course the next dish goes to.'}
              </p>
              <Stepper label="Text size" value={zone.font} min={FONT.min} max={FONT.max} onChange={v => onChange({ font: v })} testid="tl-font" />
            </>
          )}
        </div>
      </ReadOnlyFieldset>
      {canManage && (
        <div className="pt-2 border-t">
          <ConfirmDelete label={(zone.type === 'popup' ? 'Take out the pop-up' : 'Take out the ' + t.label + ' zone')
              + (openers.length ? (openers.length === 1 ? ' and the button that opens it' : ' and the ' + openers.length + ' buttons that open it') : '')}
            confirmLabel="Yes, take it out" onConfirm={onRemove} />
        </div>
      )}
    </Section>
  )
}

/**
 * What to say under a pop-up's Opened by list when some of its buttons can't
 * be tapped on the till (popupOpeners(): left out of a full zone that hides
 * what doesn't fit, or in a pop-up nothing opens): { text, why, none } or
 * null. none: no button works, so nothing opens it (for the Order zone, the
 * layout can't be saved).
 */
function openersNote(openers, zone) {
  const bad = openers.filter(o => !o.works)
  if (!bad.length) return null
  const what = zone.type === 'check' ? 'the order' : 'it'
  const out = bad.filter(o => o.left_out && !o.shut)
  if (bad.length < openers.length) {
    return {
      none: false, why: 'some',
      text: (out.length === bad.length ? 'A button marked "doesn\'t fit" is left out of its zone on the till' : 'A button marked in red can\'t be tapped on the till')
        + '; another one still opens ' + what + '.',
    }
  }
  const room = 'fewer or smaller buttons, more across or down, or another When more than fits.'
  // A button that doesn't fit is the one to fix first: making room is all it takes.
  if (out.length) {
    return {
      none: true, why: 'left_out',
      text: bad.length === 1
        ? 'That button doesn\'t fit in its zone and is left out (When more than fits: Hide the rest): on the till nothing opens ' + what + '. Tap it to make room there: ' + room
        : 'None of these buttons can be tapped on the till, so nothing opens ' + what + '. Make room for one marked "doesn\'t fit" in its zone: ' + room,
    }
  }
  return {
    none: true, why: 'shut',
    text: (bad.length === 1 ? 'That button is in a pop-up nothing opens' : 'These buttons are in pop-ups nothing opens')
      + ': on the till nothing opens ' + what + '. Add a button that opens ' + (bad.length === 1 ? 'that pop-up' : 'one of those pop-ups') + ', or one for ' + what + ' in a Buttons zone.',
  }
}

/**
 * A pop-up (a Pop-up zone, or any zone shown as one): its name, what it
 * covers (its own space or the whole screen), its look (border and shadow,
 * window controls), how it closes, and the buttons that open it (with a
 * quick way to add one to a Buttons zone). A Pop-up zone's own buttons are
 * edited below (ButtonsEditor).
 */
function PopupOptions({ zone, layout, openers, canManage, onChange, onPatchZone, onPick }) {
  const own = zone.type === 'popup'
  const whole = zone.cover === 'screen'
  const stuck = popupCloseProblem(zone)
  // What it is called when it has no name of its own (Order, Categories ...).
  const usual = popupTitle({ ...zone, title: null })
  const holders = layout.zones.filter(z => z.id !== zone.id && (z.type === 'buttons' || z.type === 'popup'))
  const [to, setTo] = useState('')
  const target = holders.find(z => z.id === to) || holders[0] || null
  const note = openersNote(openers, zone)
  const addOpener = () => {
    if (!target) return
    const taken = new Set(target.buttons.map(b => b.id))
    const bid = freshId(taken, 'open-' + zone.id)
    onPatchZone(target.id, { buttons: [...target.buttons, { id: bid, action: 'open_popup', popup_id: zone.id, w: 1, h: 1 }] })
  }
  return (
    <div className="space-y-4" data-testid="tl-popup-options" data-type={zone.type}>
      <Field label="Name" hint={(own ? '' : 'Empty: ' + usual + '. ') + 'On its window controls and on the buttons that open it (unless they have their own words).'}>
        <WordsInput key={zone.id} value={zone.title || ''} placeholder={own ? undefined : usual} onChange={v => onChange({ title: v })} data-testid="tl-popup-title" />
      </Field>
      <Field group label="Covers">
        <div data-testid="tl-popup-cover">
          <Segmented value={zone.cover} options={COVERS.map(c => ({ value: c.key, label: c.label }))} onChange={v => onChange({ cover: v })} />
        </div>
      </Field>
      <p className="text-xs text-muted-foreground -mt-2" data-testid="tl-popup-cover-hint">
        {whole
          ? 'Takes over the whole screen while it is open. Nothing is outside it to tap, so it closes with its X' + (zone.type === 'check' ? '.' : ', or after it is used.')
          : 'Opens over the cells it is placed on; the rest of the screen waits behind it.'}
      </p>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Looks</p>
        {!whole && <div data-testid="tl-popup-frame"><Toggle label="Border and shadow" checked={zone.frame} onChange={v => onChange({ frame: v })} /></div>}
        <div data-testid="tl-popup-controls"><Toggle label="Window controls: its name and a close X" checked={zone.controls} onChange={v => onChange({ controls: v })} /></div>
        {!whole && <p className="text-xs text-muted-foreground">{own ? 'Both off, its buttons sit on the screen as if they were part of it.' : 'Both off, it sits on the screen as if it were part of it.'}</p>}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Closes</p>
        {!whole && <div data-testid="tl-popup-outside"><Toggle label="With a tap outside it" checked={zone.close_outside} onChange={v => onChange({ close_outside: v })} /></div>}
        {zone.type !== 'check' && <div data-testid="tl-popup-after"><Toggle label={AFTER_USE[zone.type]} checked={zone.close_on_tap} onChange={v => onChange({ close_on_tap: v })} /></div>}
        <p className="text-xs text-muted-foreground">
          {own
            ? <>While it is open the rest of the screen waits behind it. Add a <strong>Close the pop-up</strong> button below to close it by hand; a button that opens another pop-up shows that one instead.</>
            : zone.type === 'check'
              ? 'While it is open the rest of the screen waits behind it. It closes by itself when its order is paid, cancelled or left.'
              : 'While it is open the rest of the screen waits behind it.'}
        </p>
        {stuck && <p className="text-xs rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2" data-testid="tl-popup-stuck">{stuck}</p>}
      </div>
      <div className="space-y-2" data-testid="tl-popup-openers">
        <p className="text-xs font-medium text-muted-foreground">Opened by</p>
        {openers.length
          ? openers.map(({ zone: z, button: b, left_out: out, shut, works }) => (
            // Not a <button>: View users (a disabled fieldset) can still go to it.
            <div key={z.id + ':' + b.id} role="button" tabIndex={0} onClick={() => onPick(z.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(z.id) } }}
              data-testid="tl-popup-opener" data-zone-id={z.id} data-left-out={out ? '1' : '0'} data-shut={shut ? '1' : '0'} data-works={works ? '1' : '0'}
              className={cn('w-full min-h-[48px] flex items-center gap-2 px-3 rounded-lg border bg-background hover:bg-muted text-left text-sm cursor-pointer touch-manipulation', !works && 'border-red-300')}>
              <span className="flex-1 min-w-0 truncate">{b.label || popupTitle(zone)}</span>
              {out && <span className="text-xs font-semibold text-red-700 shrink-0">doesn't fit</span>}
              {shut && <span className="text-xs font-semibold text-red-700 shrink-0">can't be reached</span>}
              <span className="text-xs text-muted-foreground shrink-0">in {zoneName(z, layout)}</span>
            </div>
          ))
          : zone.type === 'check'
            // The order has to be reachable: without a button the layout can't be saved.
            ? <p className="text-xs rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2" data-testid="tl-popup-no-opener">No button opens the order yet: add one, or the layout can't be saved.</p>
            : <p className="text-sm text-muted-foreground" data-testid="tl-popup-no-opener">No button opens it yet.</p>}
        {/* A button that can't be tapped on the till opens nothing: say so where it was added. */}
        {note && (
          <p className={cn('text-xs rounded-lg border px-3 py-2', note.none ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900')}
            data-testid="tl-popup-opener-out" data-why={note.why}>
            {note.text}
          </p>
        )}
        {canManage && holders.length > 0 && (
          <div className="flex items-center gap-2">
            {holders.length > 1 && (
              <select className={cn(inputCls, 'flex-1 min-w-0')} value={target?.id || ''} onChange={e => setTo(e.target.value)} aria-label="Where the new button goes" data-testid="tl-popup-opener-zone">
                {holders.map(z => <option key={z.id} value={z.id}>{zoneName(z, layout)}</option>)}
              </select>
            )}
            <Btn onClick={addOpener} data-testid="tl-popup-add-opener" className={holders.length > 1 ? 'shrink-0' : 'w-full'}>
              <Plus className="w-4 h-4" /> {holders.length > 1 ? 'Add a button that opens it' : 'Add a button that opens it to ' + zoneName(target, layout)}
            </Btn>
          </div>
        )}
        {canManage && !holders.length && <p className="text-xs text-muted-foreground">Add a Buttons zone to put a button that opens it on the screen.</p>}
      </div>
    </div>
  )
}

/** A Dish choices zone: what it shows, and adding the dish on its last must-pick tap. */
function ChoiceZoneOptions({ zone, layout, onChange }) {
  // The dish's name, description and Add bar are on the zone with the must-pick choices.
  const hasBar = choiceZones(layout).required?.id === zone.id
  return (
    <div className="space-y-1" data-testid="tl-choice-options">
      <p className="text-xs font-medium text-muted-foreground">Shows</p>
      {hasBar && <Toggle label="The dish's name" checked={zone.show_name !== false} onChange={v => onChange({ show_name: v })} />}
      {hasBar && <Toggle label="The dish's description" checked={zone.show_description !== false} onChange={v => onChange({ show_description: v })} />}
      <Toggle label="Prices on the choices" checked={zone.show_prices !== false} onChange={v => onChange({ show_prices: v })} />
      <p className="text-xs text-muted-foreground">{hasBar ? 'The Add button still shows the total.' : 'The dish\'s name and the Add button are on the Must pick zone.'}</p>
      {hasBar && (
        <>
          {/* The two can't go together: one adds on the first tap, the other waits for more. */}
          <Toggle label="Add the dish on its last must-pick tap" checked={!!zone.auto_add} onChange={v => onChange({ auto_add: v, ...(v ? { split_picks: false } : {}) })} />
          <p className="text-xs text-muted-foreground" data-testid="tl-auto-add-hint">
            When a must-pick choice takes one pick (a size, a sauce) and nothing else is left to pick, tapping it puts the dish on the order: no Add tap. Optional choices tapped before it go on with it.
          </p>
          <div data-testid="tl-split-picks">
            <Toggle label="More picks, more dishes" checked={!!zone.split_picks} onChange={v => onChange({ split_picks: v, ...(v ? { auto_add: false } : {}) })} />
          </div>
          <p className="text-xs text-muted-foreground" data-testid="tl-split-picks-hint">
            A choice that takes one pick (a protein, a size) can take more, each one more dish: Pad Thai, Chicken and Prawn adds two Pad Thai, one of each. Tapping a choice again adds another; the minus takes one off. Turns off adding on the last tap.
          </p>
        </>
      )}
    </div>
  )
}

/** The Order zone: its text size, which of its own buttons show, their colours. */
function CheckZoneOptions({ zone, layout, onChange }) {
  const shown = CHECK_BUTTONS.filter(b => !zone.hide.includes(b.key))
  const colourable = shown.filter(b => b.colour)
  const [colourFor, setColourFor] = useState('pay')
  const target = colourable.find(b => b.key === colourFor) || colourable[0] || null
  const left = layoutWarnings(layout).filter(w => w.code === 'hidden_button')
  const toggle = key => onChange({ hide: zone.hide.includes(key) ? zone.hide.filter(k => k !== key) : [...zone.hide, key] })
  return (
    <div className="space-y-4" data-testid="tl-check-options">
      <Stepper label="Text size of the order" value={zone.font} min={FONT.min} max={FONT.max} onChange={v => onChange({ font: v })} testid="tl-check-font" />
      <Field group label="Its own buttons">
        <div className="grid grid-cols-3 gap-2" data-testid="tl-check-buttons">
          {CHECK_BUTTONS.map(b => {
            const on = !zone.hide.includes(b.key)
            return (
              <button key={b.key} type="button" aria-pressed={on} data-k={b.key} onClick={() => toggle(b.key)}
                className={cn('min-h-[44px] px-2 rounded-lg border text-sm touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted text-muted-foreground line-through')}>
                {b.label}
              </button>
            )
          })}
        </div>
      </Field>
      <p className="text-xs text-muted-foreground -mt-2">Tap one to leave it out: a Buttons zone can do its job instead (Back, Cancel order, More, Send, Print bill and Pay are all button actions).</p>
      {left.map(w => (
        <p key={w.button} className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2" data-testid="tl-check-left-out" data-k={w.button}>{w.message}</p>
      ))}
      {target && (
        <div className="space-y-2" data-testid="tl-check-colours">
          <Field group label="Colours">
            <Segmented value={target.key} options={colourable.map(b => ({ value: b.key, label: b.label }))} onChange={setColourFor} />
          </Field>
          <ColourPick value={zone.colours?.[target.key] || null} onChange={v => onChange({ colours: { ...zone.colours, [target.key]: v } })} />
          <p className="text-xs text-muted-foreground">None: the button's usual look.</p>
        </div>
      )}
    </div>
  )
}

const OVERFLOW_HINTS = {
  scroll: 'The rest carries on: down, or across in a zone one button high.',
  pages: 'The rest goes on more pages, with arrows under the zone.',
  more: 'The last button becomes More: it opens a window with the rest.',
  hide: 'The rest isn\'t shown.',
}

function CategoriesPicker({ zone, ctx, onChange }) {
  const { setup, names } = ctx
  const sections = setup?.sections || []
  const menus = setup?.menus || []
  const picked = zone.sections
  const rest = sections.filter(s => !(picked || []).includes(s.id))
  const menuName = mid => menus.find(m => m.id === mid)?.name || ''
  return (
    <div className="space-y-3" data-testid="tl-sections">
      <Field group label="Which categories">
        <Segmented value={picked ? 'pick' : 'all'} options={[{ value: 'all', label: 'All of the till\'s menus' }, { value: 'pick', label: 'Pick them' }]}
          onChange={v => onChange({ sections: v === 'pick' ? sections.map(s => s.id) : null })} />
      </Field>
      {!picked && <p className="text-xs text-muted-foreground">Every section of the menus the till's revenue stream offers, in menu order.</p>}
      {picked && (
        <>
          <p className="text-xs text-muted-foreground">In this order on the till. Drag to change it. A section that isn't on a till's menus doesn't show there.</p>
          <SortableRows items={picked.map(sid => ({ id: sid }))} onReorder={ids => onChange({ sections: ids })}
            renderItem={r => (
              <div className="flex items-center gap-2 min-h-[44px]" data-testid="tl-section" data-id={r.id}>
                <span className="flex-1 min-w-0 text-sm truncate">
                  {names.sections.get(r.id)?.title || 'A section on another venue\'s menus'}
                  {names.sections.get(r.id) && <span className="text-xs text-muted-foreground"> · {menuName(names.sections.get(r.id).menu_id)}</span>}
                </span>
                <button type="button" onClick={() => onChange({ sections: picked.filter(x => x !== r.id) })} aria-label={'Take out ' + (names.sections.get(r.id)?.title || 'section')}
                  className="w-11 h-11 rounded-lg border bg-background hover:bg-muted flex items-center justify-center touch-manipulation"><X className="w-4 h-4" /></button>
              </div>
            )} />
          {rest.length > 0 && (
            <label className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
              <select className={cn(inputCls, 'flex-1')} value="" onChange={e => e.target.value && onChange({ sections: [...picked, e.target.value] })} aria-label="Add a category" data-testid="tl-add-section">
                <option value="">Add a category…</option>
                {menus.map(m => (
                  <optgroup key={m.id} label={m.name}>
                    {rest.filter(s => s.menu_id === m.id).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  )
}

/**
 * A category's dishes zone: the category (a section of the venue's menus,
 * picked from the list, grouped by menu), prices on the buttons, and each of
 * its dishes shown or left out (tap to switch).
 */
function CategoryZoneOptions({ zone, ctx, onChange }) {
  const { setup, names } = ctx
  const menus = setup?.menus || []
  const sections = setup?.sections || []
  const dishes = (setup?.items || []).filter(i => i.section_id === zone.section_id)
  const hidden = new Set(zone.hide_item_ids)
  const shown = dishes.filter(i => !hidden.has(i.id)).length
  const toggle = id => onChange({ hide_item_ids: hidden.has(id) ? zone.hide_item_ids.filter(x => x !== id) : [...zone.hide_item_ids, id] })
  const known = zone.section_id ? names.sections.get(zone.section_id) : null
  return (
    <div className="space-y-3" data-testid="tl-category-options">
      <Field label="Category">
        <select className={inputCls} value={zone.section_id || ''} data-testid="tl-category-section"
          onChange={e => onChange({ section_id: e.target.value || null, hide_item_ids: [] })}>
          <option value="">Pick a category…</option>
          {zone.section_id && !known && <option value={zone.section_id}>A category on another venue's menus</option>}
          {menus.map(m => (
            <optgroup key={m.id} label={m.name}>
              {sections.filter(x => x.menu_id === m.id).map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <p className="text-xs text-muted-foreground -mt-1">
        Its dishes are always on screen here, whatever the Categories zone shows. A till whose menus don't have this category shows the zone empty.
      </p>
      <Toggle label="Prices on the buttons" checked={zone.price} onChange={v => onChange({ price: v })} />
      {zone.section_id && known && (
        <Field group label={`Dishes in it (${shown} of ${dishes.length} shown)`}>
          {dishes.length ? (
            <div className="flex flex-wrap gap-1.5" data-testid="tl-category-dishes">
              {dishes.map(i => {
                const out = hidden.has(i.id)
                return (
                  <button key={i.id} type="button" aria-pressed={!out} data-id={i.id} onClick={() => toggle(i.id)} data-testid="tl-category-dish"
                    className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation inline-flex items-center gap-1.5',
                      out ? 'bg-background text-muted-foreground line-through hover:bg-muted' : 'bg-primary/10 border-primary/40 hover:bg-primary/15')}>
                    {out ? <EyeOff className="w-3.5 h-3.5 shrink-0" /> : <Eye className="w-3.5 h-3.5 shrink-0" />}{i.name}
                  </button>
                )
              })}
            </div>
          ) : <p className="text-sm text-muted-foreground">This category has no dishes yet.</p>}
          <p className="text-xs text-muted-foreground mt-1">
            Tap a dish to leave it out of this zone (crossed out), and again to put it back. It stays on the menu everywhere else.
            {hidden.size > 0 && (
              <> <button type="button" className="underline min-h-[44px] touch-manipulation" onClick={() => onChange({ hide_item_ids: [] })} data-testid="tl-category-show-all">Show them all</button></>
            )}
          </p>
        </Field>
      )}
    </div>
  )
}

/**
 * The Dishes zone's dishes left out: never shown in the zone (its search
 * included), picked from the venue's dishes by category.
 */
function LeftOutDishes({ zone, ctx, onChange }) {
  const { setup, names } = ctx
  const menus = setup?.menus || []
  const sections = setup?.sections || []
  const items = setup?.items || []
  const hidden = zone.hide_item_ids
  const rest = items.filter(i => !hidden.includes(i.id))
  return (
    <Field group label="Dishes left out">
      <div className="space-y-2" data-testid="tl-left-out">
        {!hidden.length && <p className="text-xs text-muted-foreground">None: every dish of the category picked shows.</p>}
        {hidden.map(id => (
          <div key={id} className="flex items-center gap-2 min-h-[44px]" data-testid="tl-left-out-dish" data-id={id}>
            <EyeOff className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="flex-1 min-w-0 text-sm truncate">{names.items[id]?.name || 'A dish not on this venue\'s menus'}</span>
            <button type="button" onClick={() => onChange({ hide_item_ids: hidden.filter(x => x !== id) })} aria-label={'Put back ' + (names.items[id]?.name || 'the dish')}
              className="w-11 h-11 rounded-lg border bg-background hover:bg-muted flex items-center justify-center touch-manipulation"><X className="w-4 h-4" /></button>
          </div>
        ))}
        {rest.length > 0 && hidden.length < MAX_HIDDEN && (
          <label className="flex items-center gap-2">
            <EyeOff className="w-4 h-4 text-muted-foreground shrink-0" />
            <select className={cn(inputCls, 'flex-1')} value="" aria-label="Leave out a dish" data-testid="tl-leave-out"
              onChange={e => e.target.value && onChange({ hide_item_ids: [...hidden, e.target.value] })}>
              <option value="">Leave out a dish…</option>
              {menus.map(m => sections.filter(x => x.menu_id === m.id).map(x => {
                const list = rest.filter(i => i.section_id === x.id)
                return list.length ? (
                  <optgroup key={x.id} label={m.name + ' · ' + x.title}>
                    {list.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </optgroup>
                ) : null
              }))}
            </select>
          </label>
        )}
        <p className="text-xs text-muted-foreground">A dish left out never shows in this zone, its search included. It stays on the menu everywhere else.</p>
      </div>
    </Field>
  )
}

/**
 * The Menus zone: which menus it offers (all of the till's, or picked and
 * sorted), what a tap does, the Menu times button and the times on each.
 */
function MenusZoneOptions({ zone, ctx, onChange }) {
  const menus = ctx.setup?.menus || []
  const byId = new Map(menus.map(m => [m.id, m]))
  const picked = zone.menu_ids
  const rest = menus.filter(m => !(picked || []).includes(m.id))
  const off = menus.filter(m => m.till_times === false)
  return (
    <div className="space-y-4" data-testid="tl-menus-options">
      <div className="space-y-3" data-testid="tl-menus">
        <Field group label="Which menus">
          <Segmented value={picked ? 'pick' : 'all'} options={[{ value: 'all', label: 'All of the till\'s menus' }, { value: 'pick', label: 'Pick them' }]}
            onChange={v => onChange({ menu_ids: v === 'pick' ? menus.filter(m => m.till_times !== false).map(m => m.id).slice(0, MAX_MENUS) : null })} />
        </Field>
        {!picked && <p className="text-xs text-muted-foreground">Every menu the till's revenue stream offers, in menu order.</p>}
        {picked && (
          <>
            <p className="text-xs text-muted-foreground">In this order on the till. Drag to change it. A menu the till's revenue stream doesn't offer doesn't show there; with none of these on a till, it shows all of its menus.</p>
            <SortableRows items={picked.map(id => ({ id }))} onReorder={ids => onChange({ menu_ids: ids })}
              renderItem={r => {
                const m = byId.get(r.id)
                return (
                  <div className="flex items-center gap-2 min-h-[44px]" data-testid="tl-menu" data-id={r.id}>
                    <span className="flex-1 min-w-0 text-sm">
                      <span className="block truncate">{m?.name || 'A menu this venue doesn\'t have'}</span>
                      {m && <span className={cn('block text-xs', m.till_times === false ? 'text-amber-700' : 'text-muted-foreground')} data-testid="tl-menu-times">{tillTimesText(m)}</span>}
                    </span>
                    <button type="button" onClick={() => onChange({ menu_ids: picked.filter(x => x !== r.id) })} aria-label={'Take out ' + (m?.name || 'menu')}
                      className="w-11 h-11 rounded-lg border bg-background hover:bg-muted flex items-center justify-center touch-manipulation"><X className="w-4 h-4" /></button>
                  </div>
                )
              }} />
            {rest.length > 0 && picked.length < MAX_MENUS && (
              <label className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                <select className={cn(inputCls, 'flex-1')} value="" onChange={e => e.target.value && onChange({ menu_ids: [...picked, e.target.value] })} aria-label="Add a menu" data-testid="tl-add-menu">
                  <option value="">Add a menu…</option>
                  {rest.map(m => <option key={m.id} value={m.id}>{m.name}{m.till_times === false ? ' (off on the tills)' : ''}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {off.length > 0 && (
          <p className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2" data-testid="tl-menus-off">
            {off.map(m => m.name).join(', ')} {off.length === 1 ? 'is' : 'are'} off on the tills (Menus → Menu times), so {off.length === 1 ? 'it doesn\'t' : 'they don\'t'} show here.
          </p>
        )}
      </div>
      <Field group label="Tapping a menu">
        <Segmented value={zone.tap} options={MENU_TAPS.map(t => ({ value: t.key, label: t.label }))} onChange={v => onChange({ tap: v })} />
      </Field>
      <p className="text-xs text-muted-foreground -mt-2" data-testid="tl-menus-tap-hint">
        {zone.tap === 'several'
          ? 'A tap puts the menu on the till or takes it off: several can show at once (their categories one after another). One always stays.'
          : 'A tap shows just that menu, as picking it in More → Menus does.'}
        {' '}The pick holds until the menus on now change (lunch ends), then the till follows the menu times again.
      </p>
      <div className="space-y-1">
        <Toggle label="Menu times button first" checked={zone.times_button} onChange={v => onChange({ times_button: v })} />
        <p className="text-xs text-muted-foreground">Goes back to the menus on now (Menus → Menu times). Lit while the till follows them.</p>
        <Toggle label="Each menu's times under its name" checked={zone.show_times} onChange={v => onChange({ show_times: v })} />
      </div>
    </div>
  )
}

const ACTION_GROUPS = [...new Set(BUTTON_ACTIONS.map(a => a.group))]

/** The dish, discount, tender or charge a button points at. */
function TargetPick({ action, value, ctx, onChange, zoneId = null }) {
  const { setup, discounts, tenders, charges, layout } = ctx
  if (action === 'open_popup') {
    // Any of the layout's pop-ups (Pop-up zones, and zones shown as pop-ups) but the one the button is in.
    const list = layout.zones.filter(z => isPopup(z) && z.id !== zoneId)
    return (
      <Field label="Pop-up" hint={list.length
        ? 'Shows it over its own part of the screen, or the whole screen when it takes it over. From a pop-up, it shows in its place.'
        : 'No other pop-up yet: add a Pop-up zone, or show a zone (the order, the categories) as a pop-up first.'}>
        <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)} data-testid="tl-target" disabled={!list.length}>
          <option value="">Pick a pop-up…</option>
          {list.map(z => <option key={z.id} value={z.id}>{popupOption(z)}</option>)}
        </select>
      </Field>
    )
  }
  if (action === 'item') {
    const sections = setup?.sections || []
    return (
      <Field label="Dish">
        <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)} data-testid="tl-target">
          <option value="">Pick a dish…</option>
          {sections.map(s => (
            <optgroup key={s.id} label={s.title}>
              {(setup?.items || []).filter(i => i.section_id === s.id).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
    )
  }
  if (action === 'discount_preset') {
    return (
      <Field label="Discount" hint="From the company's list (Store tech → Discounts). One that needs a manager still asks for one.">
        <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)} data-testid="tl-target">
          <option value="">Pick a discount…</option>
          {discounts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
    )
  }
  if (action === 'tender') {
    return (
      <Field label="Pays by" hint="Opens Pay with this one picked.">
        <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)} data-testid="tl-target">
          <option value="">Pick a tender…</option>
          {tenders.map(t => <option key={t.key} value={t.key} disabled={!t.enabled}>{t.label}{t.enabled ? '' : ' (switched off)'}</option>)}
        </select>
      </Field>
    )
  }
  if (action === 'charge') {
    return (
      <Field label="Charge" hint="From the company's list (Store tech → Charges). Tapped on an order, it goes on (or back on, if it was taken off).">
        <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)} data-testid="tl-target">
          <option value="">Pick a charge…</option>
          {charges.map(x => <option key={x.id} value={x.id}>{x.name} ({chargeValueText(x)})</option>)}
        </select>
      </Field>
    )
  }
  return null
}

function ButtonsEditor({ zone, ctx, canManage, onChange, selB, setSelB }) {
  const [adding, setAdding] = useState(null)   // { action, target }
  const { names, discounts, tenders, charges, layout } = ctx
  const b = zone.buttons.find(x => x.id === selB) || null
  const popups = layout.zones.filter(isPopup)
  const label = x => buttonLabel(x, { items: names.items, presets: discounts, tenders, charges, popups })
  // Close the pop-up only in a pop-up (a Buttons zone is behind an open one).
  const offered = a => a.key !== 'close_popup' || zone.type === 'popup'
  const setButtons = list => onChange({ buttons: list })
  const patchB = (bid, patch) => setButtons(zone.buttons.map(x => (x.id === bid ? { ...x, ...patch } : x)))
  const addButton = (action, target = null) => {
    const taken = new Set(zone.buttons.map(x => x.id))
    const bid = freshId(taken, 'b' + (zone.buttons.length + 1))
    const nb = { id: bid, action, w: 1, h: 1 }
    if (NEEDS_TARGET[action]) nb[NEEDS_TARGET[action]] = target
    setButtons([...zone.buttons, nb])
    setAdding(null)
    setSelB(bid)
  }
  return (
    <div className="space-y-3" data-testid="tl-buttons">
      <p className="text-xs font-medium text-muted-foreground">Buttons, in order (drag to change it)</p>
      {!zone.buttons.length && <p className="text-sm text-muted-foreground">No buttons yet.</p>}
      <SortableRows items={zone.buttons} locked={!canManage} onReorder={ids => setButtons(ids.map(i => zone.buttons.find(x => x.id === i)))}
        renderItem={x => (
          <button type="button" onClick={() => setSelB(selB === x.id ? null : x.id)} aria-pressed={selB === x.id} data-testid="tl-button" data-id={x.id} data-action={x.action}
            className={cn('w-full min-h-[44px] flex items-center gap-2 px-2 rounded-lg text-left touch-manipulation', selB === x.id ? 'bg-primary/10 ring-2 ring-primary/40' : 'hover:bg-muted')}>
            <span className="w-4 h-4 rounded shrink-0 border" style={{ background: x.colour || '#fff' }} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium truncate">{label(x)}</span>
              <span className="block text-xs text-muted-foreground truncate">{actionOf(x.action)?.label}{x.w > 1 || x.h > 1 ? ' · ' + x.w + ' x ' + x.h : ''}</span>
            </span>
          </button>
        )} />
      {b && (
        <div className="rounded-xl border p-3 space-y-3" data-testid="tl-button-edit" data-id={b.id}>
          <Field label="Does">
            <select className={inputCls} value={b.action} data-testid="tl-button-action"
              onChange={e => {
                const action = e.target.value
                const keep = { id: b.id, action, label: b.label, colour: b.colour, w: b.w, h: b.h }
                // A function that needs a dish, discount or tender keeps the old one only if it is the same kind.
                if (NEEDS_TARGET[action]) keep[NEEDS_TARGET[action]] = action === b.action ? b[NEEDS_TARGET[action]] : null
                if (NEEDS_TARGET[action] && !keep[NEEDS_TARGET[action]]) return setAdding({ action, target: null, replace: b.id })
                setButtons(zone.buttons.map(x => (x.id === b.id ? keep : x)))
              }}>
              {ACTION_GROUPS.map(g => (
                <optgroup key={g} label={g}>
                  {BUTTON_ACTIONS.filter(a => a.group === g && (offered(a) || a.key === b.action)).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          {NEEDS_TARGET[b.action] && (
            <TargetPick action={b.action} value={b[NEEDS_TARGET[b.action]]} ctx={ctx} zoneId={zone.id}
              onChange={v => v && patchB(b.id, { [NEEDS_TARGET[b.action]]: v })} />
          )}
          <Field label="Words on the button" hint="Empty: the dish's or discount's name, or what it does.">
            <WordsInput key={b.id} value={b.label || ''} placeholder={label({ ...b, label: null })} data-testid="tl-button-label"
              onChange={v => patchB(b.id, { label: v || null })} />
          </Field>
          <Field group label="Colour"><ColourPick value={b.colour} onChange={v => patchB(b.id, { colour: v })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Stepper label="Wide (buttons)" value={b.w} min={1} max={zone.cols} onChange={v => patchB(b.id, { w: v })} testid="tl-button-w" />
            <Stepper label="High (buttons)" value={b.h} min={1} max={zone.rows} onChange={v => patchB(b.id, { h: v })} testid="tl-button-h" />
          </div>
          {canManage && <ConfirmDelete label="Take this button out" confirmLabel="Yes, take it out" onConfirm={() => { setButtons(zone.buttons.filter(x => x.id !== b.id)); setSelB(null) }} />}
        </div>
      )}
      {canManage && !adding && zone.buttons.length < MAX_BUTTONS && (
        <label className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
          <select className={cn(inputCls, 'flex-1')} value="" aria-label="Add a button" data-testid="tl-add-button"
            onChange={e => { const a = e.target.value; if (!a) return; if (NEEDS_TARGET[a]) setAdding({ action: a, target: null }); else addButton(a) }}>
            <option value="">Add a button…</option>
            {ACTION_GROUPS.map(g => (
              <optgroup key={g} label={g}>
                {BUTTON_ACTIONS.filter(a => a.group === g && offered(a)).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      {adding && (
        <div className="rounded-xl border border-primary/40 p-3 space-y-3" data-testid="tl-adding">
          <p className="text-sm font-medium">{adding.replace ? 'Change to: ' : 'New button: '}{actionOf(adding.action)?.label}</p>
          {NEEDS_TARGET[adding.action] && <TargetPick action={adding.action} value={adding.target} ctx={ctx} zoneId={zone.id} onChange={v => setAdding(a => ({ ...a, target: v }))} />}
          <div className="flex gap-2">
            <Btn variant="primary" className="flex-1" disabled={!!NEEDS_TARGET[adding.action] && !adding.target} data-testid="tl-adding-ok"
              onClick={() => {
                if (adding.replace) {
                  setButtons(zone.buttons.map(x => (x.id === adding.replace ? { id: x.id, action: adding.action, label: x.label, colour: x.colour, w: x.w, h: x.h, [NEEDS_TARGET[adding.action]]: adding.target } : x)))
                  setAdding(null)
                } else addButton(adding.action, adding.target)
              }}>
              {adding.replace ? 'Change it' : 'Add it'}
            </Btn>
            <Btn onClick={() => setAdding(null)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  )
}
