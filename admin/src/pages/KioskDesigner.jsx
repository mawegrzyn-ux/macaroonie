// src/pages/KioskDesigner.jsx
//
// One self-order kiosk design (Till setup > Kiosks > Kiosk designs > Edit;
// /pos/kiosk-designs/:id; docs/POS.md section 10). Settings on the left in
// folding cards; on the right the kiosk app itself in a frame
// (pos.<domain>/?kiosk_preview=<signed link>, from
// POST /pos/kiosk-designs/:id/preview). The frame shows the unsaved design as
// it changes: once it says 'kiosk.ready' the page posts the design to it
// ('kiosk.design') after every change. The preview never sends an order.
// Explicit Save (PUT /pos/kiosk-designs/:id) and Discard. normaliseDesign()
// (shared/kiosk.js) checks every value here, in the frame and in the API.
//
// Text fields edit the raw draft (so a space typed at the end stays while
// typing); everything else reads the normalised design, which is what the
// kiosk gets and what Save stores.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, Save, RotateCcw, Palette, Home, Languages, LayoutGrid, List, SlidersHorizontal,
  Disc3, CreditCard, Timer, ChevronDown, Image as ImageIcon, Video, Plus, X, UtensilsCrossed,
  ShoppingBag, Bike, Sparkles, AlertTriangle, Flame, Star, CircleDot, RectangleVertical,
  RectangleHorizontal, Wand2, BookOpen, LayoutDashboard, Hexagon, Circle, Square, Share2, Copy, Check, ExternalLink,
} from 'lucide-react'
import { qrSvg } from '@shared/qr.js'
import {
  normaliseDesign, designProblems, KIOSK_FONTS, KIOSK_EXTRA_FONTS, SYSTEM_FONT, COLOR_LABELS,
  DESIGN_COLORS, KIOSK_LANGUAGES, DISPLAY_LABELS, KIOSK_DISPLAYS, uiText, TILE_STYLES, TILE_LABELS,
} from '@shared/kiosk.js'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'
import { PicturePick } from '@/components/media/PicturePick'
import { FontPicker } from '@/components/website-builder/FontPicker'
import { ColourPicker, useThemeColours, inkOn } from '@/components/ColourPicker'
import {
  usePosVenue, usePosSetup, VenueSelect, Field, inputCls, ErrorNote, Segmented, SortableRows, Toggle, NumberBox, Btn,
} from '@/components/pos/shared'
import { kioskDesign } from '@/components/pos/KiosksSection'

const FONTS = [SYSTEM_FONT, ...KIOSK_FONTS]
const PREVIEW_SIZE = { portrait: [1080, 1920], landscape: [1920, 1080] }
const ORIENT_KEY = 'maca_kiosk_preview'
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// The kiosk's own display fonts aren't in the website font list the font
// picker loads, so the page loads them itself.
const EXTRA_FONTS_HREF = 'https://fonts.googleapis.com/css2?' + Object.entries(KIOSK_EXTRA_FONTS)
  .map(([n, w]) => 'family=' + encodeURIComponent(n).replace(/%20/g, '+') + ':wght@' + w).join('&') + '&display=swap'

const PRESETS = [
  { name: 'Fresh', colors: DESIGN_COLORS },
  { name: 'Red and gold', colors: { background: '#fff8ef', surface: '#ffffff', text: '#1f1a17', muted: '#6b625b', primary: '#c8102e', primary_text: '#ffffff', accent: '#ffc72c', accent_text: '#1f1a17' } },
  { name: 'Night', colors: { background: '#121212', surface: '#1f1f1f', text: '#f5f5f5', muted: '#a3a3a3', primary: '#ffc72c', primary_text: '#121212', accent: '#2f9e44', accent_text: '#ffffff' } },
  { name: 'Ocean', colors: { background: '#eef4f8', surface: '#ffffff', text: '#0f2233', muted: '#56687a', primary: '#0a5c8a', primary_text: '#ffffff', accent: '#ff7a59', accent_text: '#1b1b1b' } },
  { name: 'Plain', colors: { background: '#ffffff', surface: '#f4f4f5', text: '#111111', muted: '#5f5f66', primary: '#111111', primary_text: '#ffffff', accent: '#e4e4e7', accent_text: '#111111' } },
]

// Kiosk words are big, so WCAG's large-text level (3:1) is the line.
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const CONTRAST_PAIRS = [
  ['text', 'background', 'Text on the page'],
  ['text', 'surface', 'Text on cards'],
  ['muted', 'surface', 'Quiet text on cards'],
  ['primary_text', 'primary', 'Button text on buttons'],
  ['accent_text', 'accent', 'Highlight text on highlights'],
]

const DISPLAY_INFO = {
  grid: { icon: LayoutGrid, text: 'Picture tiles, several to a row. Good for most groups.' },
  list: { icon: List, text: 'One row per choice with a picture, words and price. Good for long names.' },
  slider: { icon: SlidersHorizontal, text: 'Big cards to swipe through, with a scale for choices that have a level (heat, size).' },
  wheel: { icon: Disc3, text: 'Choices round a wheel: turn it, flick it or press Spin. Fun for flavours.' },
}
const LEVEL_ICONS = [
  { value: 'flame', label: 'Flames', icon: Flame },
  { value: 'star', label: 'Stars', icon: Star },
  { value: 'dot', label: 'Dots', icon: CircleDot },
]
const TYPE_ICON_CHOICES = [
  { value: 'none', label: 'From the name', icon: Wand2 },
  { value: 'eat_in', label: 'Eat in', icon: UtensilsCrossed },
  { value: 'take_away', label: 'Take away', icon: ShoppingBag },
  { value: 'delivery', label: 'Delivery', icon: Bike },
]

// ── Small parts ─────────────────────────────────────────────────

function Thumb({ url, video, contain }) {
  return (
    <span className="w-16 h-12 rounded-md border bg-muted overflow-hidden shrink-0 flex items-center justify-center">
      {!url ? <ImageIcon className="w-4 h-4 text-muted-foreground" />
        : video ? <video src={url} muted preload="metadata" className="w-full h-full object-cover" />
          : <img src={url} alt="" draggable={false} className={cn('w-full h-full', contain ? 'object-contain' : 'object-cover')} />}
    </span>
  )
}

function IconBtn({ onClick, title, children, testId }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} data-testid={testId}
      className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground touch-manipulation disabled:opacity-50">
      {children}
    </button>
  )
}

// View access: pictures can't be dropped either (a fieldset doesn't stop drops).
const LockedCtx = createContext(false)

/** One picture from the Media library (or dropped from the computer). */
function ImagePick({ value, onChange, label = 'picture', contain, testId }) {
  const locked = useContext(LockedCtx)
  return (
    <div className="flex items-center gap-3 min-w-0" data-testid={testId}>
      <PicturePick url={value || null} onChange={onChange} scope="kiosk" size="wide" contain={contain} label={label} disabled={locked} />
      {!locked && <span className="text-[11px] text-muted-foreground">{value ? 'Tap to change it, or drop another on it.' : 'Tap to pick one from Media, or drop one on it.'}</span>}
    </div>
  )
}

function ColourRow({ name, label, value, onChange }) {
  return <ColourPicker label={label} value={value} onChange={onChange} testId={'kd-colour-' + name} />
}

// The website theme as a starting set: its colours, with black or white
// text on the buttons and highlights.
function websiteColours(theme) {
  const by = Object.fromEntries(theme.map(s => [s.key, s.hex]))
  if (!by.primary) return null
  const colors = { ...DESIGN_COLORS }
  for (const k of ['background', 'surface', 'text', 'muted', 'primary', 'accent']) if (by[k]) colors[k] = by[k]
  colors.primary_text = inkOn(colors.primary)
  colors.accent_text = inkOn(colors.accent)
  return { name: 'Website colours', colors }
}

/** Opens what: nothing, a section or a dish of this venue's menus. */
function LinkSelect({ value, onChange, setup, venueName }) {
  const sections = setup?.sections || []
  const items = setup?.items || []
  const menuName = id => setup?.menus?.find(m => m.id === id)?.name
  const manyMenus = (setup?.menus?.length || 0) > 1
  const v = value?.kind && value.kind !== 'none' && value.id ? value.kind + ':' + value.id : ''
  const known = !v || (value.kind === 'section' ? sections.some(s => s.id === value.id) : items.some(i => i.id === value.id))
  return (
    <select className={inputCls} value={v} aria-label="Opens"
      onChange={e => {
        const [kind, id] = e.target.value.split(':')
        onChange(kind ? { kind, id } : { kind: 'none', id: null })
      }}>
      <option value="">Opens nothing</option>
      {!known && <option value={v}>{value.kind === 'section' ? 'A section' : 'A dish'} not on {venueName || 'this venue'}'s menus</option>}
      {!!sections.length && (
        <optgroup label="Opens a section">
          {sections.map(s => <option key={s.id} value={'section:' + s.id}>{s.title}{manyMenus ? ' (' + menuName(s.menu_id) + ')' : ''}</option>)}
        </optgroup>
      )}
      {sections.map(s => {
        const list = items.filter(i => i.section_id === s.id)
        return list.length ? (
          <optgroup key={s.id} label={'Opens a dish: ' + s.title}>
            {list.map(i => <option key={i.id} value={'item:' + i.id}>{i.name}</option>)}
          </optgroup>
        ) : null
      })}
    </select>
  )
}

/** A select listing this venue's dishes by section, for adding one. */
function DishAdder({ setup, exclude, onAdd, label = 'Add a dish' }) {
  const sections = setup?.sections || []
  const items = (setup?.items || []).filter(i => !exclude.includes(i.id))
  return (
    <select className={inputCls} value="" aria-label={label} onChange={e => e.target.value && onAdd(e.target.value)} data-testid="kd-dish-adder">
      <option value="">{label}…</option>
      {sections.map(s => {
        const list = items.filter(i => i.section_id === s.id)
        return list.length ? <optgroup key={s.id} label={s.title}>{list.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup> : null
      })}
    </select>
  )
}

/** A folding card; the header stays usable with View access. */
function Panel({ id, icon: Icon, title, summary, open, onToggle, canManage, children }) {
  return (
    <section className="rounded-xl border bg-background overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} data-testid={'kd-panel-' + id}
        className="w-full flex items-center gap-3 px-4 min-h-[52px] py-2 section-head text-left touch-manipulation">
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {summary && !open && <span className="block text-[11px] text-muted-foreground truncate">{summary}</span>}
        </span>
        <ChevronDown className={cn('w-4 h-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <LockedCtx.Provider value={!canManage}>
          <ReadOnlyFieldset disabled={!canManage}>
            <div className="p-4 space-y-5">{children}</div>
          </ReadOnlyFieldset>
        </LockedCtx.Provider>
      )}
    </section>
  )
}

function Note({ children, tone = 'muted' }) {
  return (
    <p className={cn('text-xs rounded-lg px-3 py-2 flex gap-2 items-start',
      tone === 'warn' ? 'text-amber-900 bg-amber-50 border border-amber-200' : 'text-muted-foreground bg-muted/50')}>
      {tone === 'warn' && <AlertTriangle className="w-4 h-4 shrink-0" />}
      <span>{children}</span>
    </p>
  )
}

// ── Panels ──────────────────────────────────────────────────────

function BrandPanel({ d, set }) {
  const c = d.brand.colors
  const poor = CONTRAST_PAIRS.filter(([a, b]) => contrast(c[a], c[b]) < 3)
  const theme = useThemeColours()
  const sets = useMemo(() => [websiteColours(theme), ...PRESETS].filter(Boolean), [theme])
  return (
    <>
      <Field group label="Logo" hint="On the start screen and at the top of the menu. A PNG or SVG with a see-through background looks best.">
        <ImagePick value={d.brand.logo_url} onChange={v => set('brand', { logo_url: v })} label="logo" contain testId="kd-logo" />
      </Field>
      <Field group label="Colours" hint="Tap a set to start from, then change any colour: your website's colours, or a custom one.">
        <div className="flex flex-wrap gap-2 mb-3">
          {sets.map(p => (
            <button key={p.name} type="button" onClick={() => set('brand', { colors: { ...p.colors } })} data-testid="kd-preset"
              className="h-11 pl-1.5 pr-3 rounded-lg border bg-background hover:bg-muted text-xs font-medium inline-flex items-center gap-2 touch-manipulation">
              <span className="w-8 h-8 rounded-md overflow-hidden grid grid-cols-2 border shrink-0" aria-hidden="true">
                <span style={{ background: p.colors.primary }} /><span style={{ background: p.colors.accent }} />
                <span style={{ background: p.colors.background }} /><span style={{ background: p.colors.surface }} />
              </span>
              {p.name}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {Object.keys(DESIGN_COLORS).map(k => (
            <ColourRow key={k} name={k} label={COLOR_LABELS[k]} value={c[k]}
              onChange={v => set('brand', b => ({ colors: { ...b.colors, [k]: v } }))} />
          ))}
        </div>
      </Field>
      {poor.map(([a, b, what]) => (
        <Note key={a + b} tone="warn">{what}: hard to read ({contrast(c[a], c[b]).toFixed(1)} to 1). Make one of them lighter or darker.</Note>
      ))}
      <Field group label="Headings font">
        <FontPicker value={d.brand.font_heading} onChange={v => set('brand', { font_heading: v })} fonts={FONTS} />
      </Field>
      <Field group label="Text font">
        <FontPicker value={d.brand.font_body} onChange={v => set('brand', { font_body: v })} fonts={FONTS} />
      </Field>
      <Toggle label="Headings in capitals" checked={d.brand.heading_case === 'upper'}
        onChange={v => set('brand', { heading_case: v ? 'upper' : 'normal' })} />
      <Field label={'Rounded corners: ' + d.brand.radius + ' px'} hint="0 is square.">
        <input type="range" min={0} max={32} step={1} value={d.brand.radius} className="w-full h-11 touch-manipulation"
          onChange={e => set('brand', { radius: Number(e.target.value) })} />
      </Field>
    </>
  )
}

function MediaList({ items, onChange, max, locked }) {
  const [adding, setAdding] = useState(null) // 'image' | 'video'
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <SortableRows items={items} locked={locked} onReorder={ids => onChange(ids.map(id => items.find(x => x.id === id)))}
          renderItem={m => (
            <div className="flex items-center gap-3" data-testid="kd-media">
              <Thumb url={m.url} video={m.type === 'video'} />
              <span className="flex-1 min-w-0 text-sm truncate">{m.type === 'video' ? 'Video' : 'Picture'}</span>
              {!locked && <IconBtn onClick={() => onChange(items.filter(x => x.id !== m.id))} title="Remove"><X className="w-4 h-4" /></IconBtn>}
            </div>
          )} />
      )}
      {!locked && items.length < max && (
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => setAdding('image')}><ImageIcon className="w-4 h-4" /> Add a picture</Btn>
          <Btn onClick={() => setAdding('video')}><Video className="w-4 h-4" /> Add a video</Btn>
        </div>
      )}
      {adding && (
        <MediaLibraryModal open mode="picker" kind={adding} scope="kiosk" onClose={() => setAdding(null)}
          onPick={url => { onChange([...items, { id: newId('m'), type: adding, url }]); setAdding(null) }} />
      )}
    </div>
  )
}

function StartPanel({ s, d, set, setup, stream, canManage }) {
  const src = d.languages.source
  const types = (setup?.order_types || []).filter(t => t.is_active)
  const offered = new Set((stream?.order_types || []).filter(x => x.enabled).map(x => x.order_type_id))
  const setCard = (id, patch) => set('start', st => ({ type_cards: { ...st.type_cards, [id]: { ...(st.type_cards?.[id] || {}), ...patch } } }))
  return (
    <>
      <Field group label="Layout" hint={d.start.layout === 'full'
        ? 'Pictures fill the screen and the buttons sit at the bottom.'
        : 'Pictures above the buttons on an upright screen, beside them on a wide one.'}>
        <Segmented value={d.start.layout} onChange={v => set('start', { layout: v })}
          options={[{ value: 'split', label: 'Pictures apart' }, { value: 'full', label: 'Pictures behind' }]} />
      </Field>
      <Field group label="Pictures and videos" hint="They take turns, in this order. Videos play to the end with no sound. Up to 8.">
        <MediaList items={s.start.media || []} onChange={media => set('start', { media })} max={8} locked={!canManage} />
      </Field>
      <Field label="Each picture shows for (seconds)">
        <NumberBox value={d.start.media_secs} min={3} max={30} onChange={v => set('start', { media_secs: v })} ariaLabel="Seconds per picture" />
      </Field>
      <Field label="Headline" hint="Leave empty for the kiosk's own words, which come in every language. Words you type are translated on Menus > Translations.">
        <input className={inputCls} maxLength={60} value={s.start.headline || ''} placeholder={uiText(src, 'order_here')}
          onChange={e => set('start', { headline: e.target.value })} data-testid="kd-headline" />
      </Field>
      <Field label="Question" hint="Above the order type buttons, when the kiosk offers more than one order type.">
        <input className={inputCls} maxLength={60} value={s.start.question || ''} placeholder={uiText(src, 'staying_or_going')}
          onChange={e => set('start', { question: e.target.value })} />
      </Field>
      <Field group label="Order type buttons" hint="Which order types a kiosk offers comes from its revenue stream (Till setup > Revenue streams). Empty words use the order type's name.">
        {!types.length && <p className="text-xs text-muted-foreground">No order types yet.</p>}
        <div className="space-y-3">
          {types.map(t => {
            const card = s.start.type_cards?.[t.id] || {}
            const icon = d.start.type_cards[t.id]?.icon || 'none'
            return (
              <div key={t.id} className="rounded-xl border p-3 space-y-2" data-testid="kd-type-card">
                <p className="text-sm font-medium">
                  {t.name}
                  {stream && !offered.has(t.id) && <span className="ml-2 text-[11px] font-normal text-muted-foreground">(not offered by {stream.name})</span>}
                </p>
                <input className={inputCls} maxLength={40} value={card.label || ''} placeholder={t.name} aria-label={t.name + ' button words'}
                  onChange={e => setCard(t.id, { label: e.target.value })} />
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.name + ' icon'}>
                  {TYPE_ICON_CHOICES.map(o => (
                    <button key={o.value} type="button" aria-pressed={icon === o.value} onClick={() => setCard(t.id, { icon: o.value })}
                      className={cn('h-11 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 touch-manipulation',
                        icon === o.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                      <o.icon className="w-4 h-4" /> {o.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Picture instead of the icon:</span>
                  <ImagePick value={d.start.type_cards[t.id]?.image_url || null} onChange={v => setCard(t.id, { image_url: v })} contain />
                </div>
              </div>
            )
          })}
        </div>
      </Field>
      <Toggle label="Allergens button" hint="Guests can look up dishes by allergen before they start."
        checked={d.start.show_allergens} onChange={v => set('start', { show_allergens: v })} />
    </>
  )
}

function LanguagesPanel({ d, set }) {
  const { source, enabled } = d.languages
  return (
    <>
      <Field label="Your menu is written in" hint="Your dishes and the words you type here are in this language. Guests start in it.">
        <select className={inputCls} value={source} data-testid="kd-source-lang"
          onChange={e => set('languages', l => ({ source: e.target.value, enabled: [...new Set([e.target.value, ...(l.enabled || [])])] }))}>
          {KIOSK_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </Field>
      <Field group label="Languages guests can pick" hint="Shown as flags on the start screen when there is more than one. The kiosk's own words come in every language.">
        <div className="flex flex-wrap gap-1.5">
          {KIOSK_LANGUAGES.map(l => {
            const on = enabled.includes(l.code)
            return (
              <button key={l.code} type="button" aria-pressed={on} disabled={l.code === source} data-testid="kd-lang" data-lang={l.code}
                onClick={() => set('languages', x => ({ enabled: on ? (x.enabled || []).filter(c => c !== l.code) : [...(x.enabled || []), l.code] }))}
                className={cn('h-11 px-3 rounded-lg border text-sm touch-manipulation disabled:opacity-100',
                  on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                {l.name}
              </button>
            )
          })}
        </div>
      </Field>
      <Note>
        Your dishes, options and the words you type show as written until they are translated.{' '}
        <Link to="/menus/translations" className="underline font-medium text-foreground">Menus &gt; Translations</Link> lists them all, with an AI first draft.
      </Note>
    </>
  )
}

function BannerList({ items, onChange, setup, venueName, locked }) {
  const patch = (id, p) => onChange(items.map(x => (x.id === id ? { ...x, ...p } : x)))
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <SortableRows items={items} locked={locked} onReorder={ids => onChange(ids.map(id => items.find(x => x.id === id)))}
          renderItem={b => (
            <div className="space-y-2 py-1" data-testid="kd-banner">
              <div className="flex items-center gap-2">
                <ImagePick value={b.image_url || null} onChange={v => patch(b.id, { image_url: v })} />
                <span className="flex-1" />
                {!locked && <IconBtn onClick={() => onChange(items.filter(x => x.id !== b.id))} title="Remove this banner"><X className="w-4 h-4" /></IconBtn>}
              </div>
              {!b.image_url && <p className="text-[11px] text-amber-800">Not shown or saved until it has a picture.</p>}
              <input className={inputCls} maxLength={80} value={b.title || ''} placeholder="Words over the picture (optional)" aria-label="Banner words"
                onChange={e => patch(b.id, { title: e.target.value })} />
              <LinkSelect value={b.link} onChange={link => patch(b.id, { link })} setup={setup} venueName={venueName} />
            </div>
          )} />
      )}
      {!locked && items.length < 10 && (
        <Btn onClick={() => onChange([...items, { id: newId('b'), image_url: null, title: '', link: { kind: 'none', id: null } }])}>
          <Plus className="w-4 h-4" /> Add a banner
        </Btn>
      )}
    </div>
  )
}

function FeaturedList({ items, onChange, setup, venueName, locked }) {
  const patch = (id, p) => onChange(items.map(x => (x.id === id ? { ...x, ...p } : x)))
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <SortableRows items={items} locked={locked} onReorder={ids => onChange(ids.map(id => items.find(x => x.id === id)))}
          renderItem={f => (
            <div className="space-y-2 py-1" data-testid="kd-featured">
              <div className="flex items-center gap-2 flex-wrap">
                <ImagePick value={f.image_url || null} onChange={v => patch(f.id, { image_url: v })} />
                <span className="flex-1" />
                <Segmented value={f.size || 'normal'} onChange={v => patch(f.id, { size: v })}
                  options={[{ value: 'normal', label: 'Half' }, { value: 'wide', label: 'Full width' }]} />
                {!locked && <IconBtn onClick={() => onChange(items.filter(x => x.id !== f.id))} title="Remove this tile"><X className="w-4 h-4" /></IconBtn>}
              </div>
              <input className={inputCls} maxLength={60} value={f.title || ''} placeholder="Title" aria-label="Tile title"
                onChange={e => patch(f.id, { title: e.target.value })} />
              <input className={inputCls} maxLength={80} value={f.subtitle || ''} placeholder="Second line (optional)" aria-label="Tile second line"
                onChange={e => patch(f.id, { subtitle: e.target.value })} />
              <LinkSelect value={f.link} onChange={link => patch(f.id, { link })} setup={setup} venueName={venueName} />
            </div>
          )} />
      )}
      {!locked && items.length < 12 && (
        <Btn onClick={() => onChange([...items, { id: newId('f'), image_url: null, title: '', subtitle: '', size: 'normal', link: { kind: 'none', id: null } }])}>
          <Plus className="w-4 h-4" /> Add a tile
        </Btn>
      )}
    </div>
  )
}

// Picture styles, set apart for dishes (Menu panel) and choices (Choices panel).
const TILE_ICONS = { cards: Square, round: Circle, oval: Circle, hexagon: Hexagon }
const TILE_TEXT = {
  dishes: {
    cards: 'The photo on top of a card, the words under it.',
    round: 'Photos in circles, the words under them on the page. No cards.',
    oval: 'Photos in ovals, the words under them on the page. No cards.',
    hexagon: 'Hexagons that lock together like a honeycomb. Buttons, chips and cards across the kiosk take the hexagon look too.',
  },
  choices: {
    cards: 'The photo on top of a card, the words under it.',
    round: 'Photos in circles, the words under them. No cards.',
    oval: 'Photos in ovals, the words under them. No cards.',
    hexagon: 'A grid of choices locks together like a honeycomb, even with only a few. The list, slider and wheel show hexagon photos.',
  },
}

function PictureStyle({ value, onChange, kind, testId }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {TILE_STYLES.map(k => {
        const Icon = TILE_ICONS[k]
        const on = value === k
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onChange(k)} data-testid={testId} data-tiles={k}
            className={cn('rounded-xl border p-3 text-left flex flex-col gap-1.5 touch-manipulation min-h-[96px]',
              on ? 'border-primary ring-2 ring-primary/40 bg-primary/5' : 'bg-background hover:bg-muted')}>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Icon className={cn('w-5 h-5', k === 'oval' && 'scale-x-125')} /> {TILE_LABELS[k]}
            </span>
            <span className="text-[11px] text-muted-foreground leading-snug">{TILE_TEXT[kind][k]}</span>
          </button>
        )
      })}
    </div>
  )
}

function LayoutPanel({ d, set }) {
  const y = d.layout
  return (
    <>
      <p className="text-xs text-muted-foreground">How pictures are drawn is set apart for dishes (Menu) and for choices (Choices).</p>
      <Toggle label="Bar along the top" hint="The logo (or the venue's name) and the language button. Off: more room for the menu, and the language button moves to the bottom bar."
        checked={y.header} onChange={v => set('layout', { header: v })} />
      <Field group label="Back and Start again" hint="In each screen's bottom bar. Start again asks first when the order has something in it.">
        <Segmented value={y.icon_buttons ? 'icons' : 'words'} onChange={v => set('layout', { icon_buttons: v === 'icons' })}
          options={[{ value: 'words', label: 'Icon and words' }, { value: 'icons', label: 'Icons only' }]} />
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground" aria-hidden="true">
          <span className="h-10 px-3 rounded-lg bg-foreground text-background inline-flex items-center gap-1.5 font-semibold"><ArrowLeft className="w-4 h-4" />{!y.icon_buttons && 'Back'}</span>
          <span className="h-10 px-3 rounded-lg border-2 border-foreground/40 inline-flex items-center gap-1.5 font-semibold text-foreground"><RotateCcw className="w-4 h-4" />{!y.icon_buttons && 'Start again'}</span>
        </div>
      </Field>
    </>
  )
}

/**
 * The section tiles page (no sections down the side): every section the
 * kiosk shows, in the design's order, each with a picture, words and a
 * width. Sections not listed yet follow in menu order.
 */
function SectionTilesList({ s, d, set, setup, locked }) {
  const off = new Set(d.menu.hidden_section_ids)
  const sections = (setup?.sections || []).filter(x => !off.has(x.id))
  const saved = (s.menu.section_tiles || []).filter(t => sections.some(x => x.id === t.section_id))
  const rows = [...saved, ...sections.filter(x => !saved.some(t => t.section_id === x.id)).map(x => ({ section_id: x.id, image_url: null, title: '', size: 'normal' }))]
    .map(t => ({ ...t, id: t.section_id }))
  const title = id => sections.find(x => x.id === id)?.title || 'Section'
  const save = list => set('menu', { section_tiles: list.map(({ id, ...t }) => t) })
  const patch = (id, p) => save(rows.map(x => (x.id === id ? { ...x, ...p } : x)))
  if (!rows.length) return <p className="text-xs text-muted-foreground">No sections on this venue's menus yet.</p>
  return (
    <SortableRows items={rows} locked={locked} onReorder={ids => save(ids.map(id => rows.find(x => x.id === id)))}
      renderItem={t => (
        <div className="space-y-2 py-1" data-testid="kd-section-tile" data-section={t.section_id}>
          <div className="flex items-center gap-2 flex-wrap">
            <ImagePick value={t.image_url || null} onChange={v => patch(t.id, { image_url: v })} />
            <span className="flex-1" />
            {d.layout.tiles !== 'hexagon' && d.layout.tiles !== 'round' && (
              <Segmented value={t.size || 'normal'} onChange={v => patch(t.id, { size: v })}
                options={[{ value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Two wide' }]} />
            )}
          </div>
          <input className={inputCls} maxLength={60} value={t.title || ''} placeholder={title(t.section_id)} aria-label={'Words on the ' + title(t.section_id) + ' tile'}
            onChange={e => patch(t.id, { title: e.target.value })} />
          {!t.image_url && <p className="text-[11px] text-muted-foreground">No picture: the section's own, else its first dish's.</p>}
        </div>
      )} />
  )
}

function SectionsShown({ setup, hidden, onChange }) {
  const menus = setup?.menus || []
  const sections = setup?.sections || []
  if (!sections.length) return <p className="text-xs text-muted-foreground">No sections on this venue's menus yet.</p>
  const off = new Set(hidden)
  return (
    <div className="space-y-3">
      {menus.map(m => {
        const list = sections.filter(s => s.menu_id === m.id)
        if (!list.length) return null
        return (
          <div key={m.id} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{m.name}{!m.is_published && ' (not published)'}</p>
            <div className="rounded-xl border divide-y">
              {list.map(s => (
                <label key={s.id} className="flex items-center gap-3 px-3 min-h-[44px] text-sm cursor-pointer touch-manipulation">
                  <input type="checkbox" className="w-5 h-5 shrink-0" checked={!off.has(s.id)} data-testid="kd-section-shown" data-section={s.id}
                    onChange={e => onChange(e.target.checked ? hidden.filter(x => x !== s.id) : [...hidden, s.id])} />
                  <span className="flex-1 min-w-0 truncate">{s.title}</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MenuPanel({ s, d, set, setup, venueName, canManage }) {
  const m = d.menu
  return (
    <>
      <Field group label="Dish pictures" hint="The menu's dishes, the section tiles, the dish's own photo and the basket. Choices have their own (Choices).">
        <PictureStyle kind="dishes" value={d.layout.tiles} onChange={k => set('layout', { tiles: k })} testId="kd-tiles" />
      </Field>
      <Toggle label="Home page" hint="First in the list of sections, with the banners and tiles below. Shown when it has at least one."
        checked={m.home} onChange={v => set('menu', { home: v })} />
      {m.home && (
        <>
          <Field group label="Banners" hint="Wide pictures at the top of the home page, taking turns. Up to 10.">
            <BannerList items={s.menu.banners || []} onChange={banners => set('menu', { banners })} setup={setup} venueName={venueName} locked={!canManage} />
          </Field>
          <Field label="Each banner shows for (seconds)">
            <NumberBox value={m.banner_secs} min={3} max={20} onChange={v => set('menu', { banner_secs: v })} ariaLabel="Seconds per banner" />
          </Field>
          <Field group label="Featured tiles" hint="Pictures with words under the banners, e.g. a deal or a new dish. Up to 12.">
            <FeaturedList items={s.menu.featured || []} onChange={featured => set('menu', { featured })} setup={setup} venueName={venueName} locked={!canManage} />
          </Field>
        </>
      )}
      <Field group label="Sections down the side" hint={m.rail === 'none' ? 'The menu opens on a page of section tiles (with the home page\'s banners and tiles above them); a section has a Back button in the bottom bar.' : null}>
        <Segmented value={m.rail} onChange={v => set('menu', { rail: v })}
          options={[{ value: 'images', label: 'With pictures' }, { value: 'text', label: 'Words only' }, { value: 'none', label: 'None: section tiles' }]} />
      </Field>
      {m.rail === 'none' && (
        <Field group label="Section tiles" hint="Drag into order. Words left empty show the section's name, translated on the Translations page when typed in.">
          <SectionTilesList s={s} d={d} set={set} setup={setup} locked={!canManage} />
        </Field>
      )}
      <Field group label="Dishes per row" hint="Fit the screen: two on an upright screen, three or four on a wide one.">
        <Segmented value={String(m.columns)} onChange={v => set('menu', { columns: v === 'auto' ? 'auto' : Number(v) })}
          options={[{ value: 'auto', label: 'Fit the screen' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]} />
      </Field>
      <div className="space-y-1">
        <Toggle label="Descriptions" checked={m.show_descriptions} onChange={v => set('menu', { show_descriptions: v })} />
        <Toggle label="Calories" checked={m.show_calories} onChange={v => set('menu', { show_calories: v })} />
        <Toggle label="Dietary badges" hint="Vegan, vegetarian and the like." checked={m.show_tags} onChange={v => set('menu', { show_tags: v })} />
        <Toggle label="Quick add" hint="A + on dishes with nothing to choose, to add them without opening them."
          checked={m.quick_add} onChange={v => set('menu', { quick_add: v })} />
      </div>
      <Field group label="Sections on the kiosk" hint="Untick a section to leave it off the kiosk (it stays on the tills and online). Which menus a kiosk shows comes from its revenue stream.">
        <SectionsShown setup={setup} hidden={m.hidden_section_ids} onChange={ids => set('menu', { hidden_section_ids: ids })} />
      </Field>
    </>
  )
}

function ChoicesPanel({ d, set }) {
  return (
    <>
      <Field group label="How choices are shown" hint="For option groups and combo steps that don't pick their own (Menus > Variant groups, and each step of a combo).">
        <div className="grid grid-cols-2 gap-2">
          {KIOSK_DISPLAYS.map(k => {
            const info = DISPLAY_INFO[k]
            const on = d.options.display === k
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => set('options', { display: k })} data-testid="kd-display" data-display={k}
                className={cn('rounded-xl border p-3 text-left flex flex-col gap-1.5 touch-manipulation min-h-[96px]',
                  on ? 'border-primary ring-2 ring-primary/40 bg-primary/5' : 'bg-background hover:bg-muted')}>
                <span className="flex items-center gap-2 text-sm font-semibold"><info.icon className="w-5 h-5" /> {DISPLAY_LABELS[k]}</span>
                <span className="text-[11px] text-muted-foreground leading-snug">{info.text}</span>
              </button>
            )
          })}
        </div>
      </Field>
      <Field group label="Choice pictures" hint="Option groups and combo steps. Dishes have their own (Menu).">
        <PictureStyle kind="choices" value={d.layout.option_tiles} onChange={k => set('layout', { option_tiles: k })} testId="kd-option-tiles" />
      </Field>
      <Field group label="Spin wheel">
        <div className="space-y-1">
          <Toggle label="Spin button" hint="Turns the wheel two turns or more and stops on a choice at random."
            checked={d.options.wheel_spin} onChange={v => set('options', { wheel_spin: v })} />
          {d.options.wheel_spin && (
            <Toggle label="A spin picks the choice it stops on" hint="Off: the guest still taps Pick. On: the wheel only stops on a choice that can be picked and picks it."
              checked={d.options.wheel_spin_picks} onChange={v => set('options', { wheel_spin_picks: v })} />
          )}
        </div>
      </Field>
      <Field group label="Level marks" hint="On choices with a level (Menus > Variant groups, e.g. 1 to 5 for heat) and on the slider's scale.">
        <div className="flex flex-wrap gap-1.5">
          {LEVEL_ICONS.map(o => (
            <button key={o.value} type="button" aria-pressed={d.options.level_icon === o.value} onClick={() => set('options', { level_icon: o.value })}
              className={cn('h-11 px-3 rounded-lg border text-sm inline-flex items-center gap-1.5 touch-manipulation',
                d.options.level_icon === o.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
              <o.icon className="w-4 h-4" /> {o.label}
            </button>
          ))}
        </div>
      </Field>
    </>
  )
}

function CheckoutPanel({ s, d, set, setup, canManage }) {
  const c = d.checkout
  const src = d.languages.source
  const itemName = id => setup?.items?.find(i => i.id === id)?.name
  const upsell = c.upsell_item_ids.map(id => ({ id }))
  return (
    <>
      <div className="space-y-1">
        <Toggle label="Pay by card on the kiosk" hint="Needs a card reader on the kiosk (Till setup > Kiosks > Edit)."
          checked={c.pay_card} onChange={v => set('checkout', { pay_card: v })} />
        <Toggle label="Pay at the counter" hint="The order goes to the tills' Counter list with its number; staff take payment there."
          checked={c.pay_counter} onChange={v => set('checkout', { pay_counter: v })} />
        {c.pay_counter && (
          <Toggle label="Start pay-at-counter orders straight away" hint="On: the kitchen gets the order as soon as it's placed. Off: when staff take payment."
            checked={c.send_counter} onChange={v => set('checkout', { send_counter: v })} />
        )}
      </div>
      {c.pay_counter && (
        <Field label="Pay at the counter note" hint="On the order number screen. Leave empty for the kiosk's own words.">
          <textarea className={cn(inputCls, 'h-auto py-2 min-h-[72px]')} maxLength={200} rows={2} value={s.checkout.counter_note || ''}
            placeholder={uiText(src, c.send_counter ? 'counter_note_sent' : 'counter_note')}
            onChange={e => set('checkout', { counter_note: e.target.value })} />
        </Field>
      )}
      <Toggle label={'Ask "Anything else?"'} hint="Dishes offered on the order page before paying, left out when already in the order or sold out."
        checked={c.upsell} onChange={v => set('checkout', { upsell: v })} />
      {c.upsell && (
        <>
          <Field label="Heading">
            <input className={inputCls} maxLength={60} value={s.checkout.upsell_title || ''} placeholder={uiText(src, 'anything_else')}
              onChange={e => set('checkout', { upsell_title: e.target.value })} />
          </Field>
          <Field group label="Dishes to offer" hint="Up to 8, in this order. Drinks, sides and desserts work well.">
            <div className="space-y-2">
              {upsell.length > 0 && (
                <SortableRows items={upsell} locked={!canManage} onReorder={ids => set('checkout', { upsell_item_ids: ids })}
                  renderItem={x => (
                    <div className="flex items-center gap-2" data-testid="kd-upsell">
                      <span className="flex-1 min-w-0 text-sm truncate">{itemName(x.id) || 'A dish not on this venue\'s menus'}</span>
                      {canManage && <IconBtn onClick={() => set('checkout', { upsell_item_ids: c.upsell_item_ids.filter(i => i !== x.id) })} title="Remove"><X className="w-4 h-4" /></IconBtn>}
                    </div>
                  )} />
              )}
              {canManage && c.upsell_item_ids.length < 8 && (
                <DishAdder setup={setup} exclude={c.upsell_item_ids} onAdd={id => set('checkout', { upsell_item_ids: [...c.upsell_item_ids, id] })} />
              )}
            </div>
          </Field>
        </>
      )}
      <Field group label="Receipts" hint="Print on the kiosk's receipt printer (Till setup > Kiosks > Edit).">
        <Segmented value={c.receipt} onChange={v => set('checkout', { receipt: v })}
          options={[{ value: 'off', label: 'None' }, { value: 'ask', label: 'Guest can print one' }, { value: 'always', label: 'Always' }]} />
      </Field>
      <Field label="Heading over the order number">
        <input className={inputCls} maxLength={60} value={s.checkout.thanks || ''} placeholder={uiText(src, 'thank_you')}
          onChange={e => set('checkout', { thanks: e.target.value })} />
      </Field>
    </>
  )
}

function TimingPanel({ d, set }) {
  const h = d.behaviour
  return (
    <>
      <Field label="Start again when nobody taps for (seconds)" hint="20 to 600. The kiosk asks if the guest is still there, then clears the order.">
        <NumberBox value={h.idle_secs} min={20} max={600} onChange={v => set('behaviour', { idle_secs: v })} ariaLabel="Seconds before starting again" />
      </Field>
      <Field label={'"Still there?" waits for (seconds)'} hint="5 to 60.">
        <NumberBox value={h.warn_secs} min={5} max={60} onChange={v => set('behaviour', { warn_secs: v })} ariaLabel="Seconds the question waits" />
      </Field>
      <Field label="The order number shows for (seconds)" hint="5 to 120. Then the start screen comes back.">
        <NumberBox value={h.done_secs} min={5} max={120} onChange={v => set('behaviour', { done_secs: v })} ariaLabel="Seconds the order number shows" />
      </Field>
      <Toggle label="Reach button" hint="Lets a guest who can't reach the top of the screen bring everything down to the lower half."
        checked={h.reach} onChange={v => set('behaviour', { reach: v })} />
    </>
  )
}

// ── Preview ─────────────────────────────────────────────────────

function Preview({ designId, design, venueId, setup, streams, stream, onStream }) {
  const api = useApi()
  const [orientation, setOrientation] = useState(() => {
    try { return localStorage.getItem(ORIENT_KEY) === 'landscape' ? 'landscape' : 'portrait' } catch { return 'portrait' }
  })
  function turn(o) {
    setOrientation(o)
    try { localStorage.setItem(ORIENT_KEY, o) } catch { /* private mode */ }
  }
  const link = useQuery({
    queryKey: ['kiosk-preview', designId, venueId, stream?.id || null],
    queryFn: () => api.post(`/pos/kiosk-designs/${designId}/preview`, { venue_id: venueId, revenue_stream_id: stream?.id || null }),
    enabled: !!venueId && !!setup,
    staleTime: 6 * 3600_000,
    refetchOnWindowFocus: false,
  })
  const url = link.data?.url
  const origin = useMemo(() => { try { return new URL(url).origin } catch { return null } }, [url])

  // Messages go to the frame's own origin, as its 'kiosk.ready' came from it
  // (only our frame's window is listened to).
  const frame = useRef(null)
  const frameOrigin = useRef(null)
  const [ready, setReady] = useState(false)
  const latest = useRef(design)
  latest.current = design
  useEffect(() => {
    function onMessage(e) {
      if (!frame.current || e.source !== frame.current.contentWindow || e.data?.type !== 'kiosk.ready') return
      frameOrigin.current = e.origin
      setReady(true)
      e.source.postMessage({ type: 'kiosk.design', design: latest.current }, e.origin)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  // A frame that never says it's ready (the till address doesn't open, or
  // refuses to be framed) gets a note instead of a spinner for ever.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setReady(false)
    setSlow(false)
    if (!url) return
    const t = setTimeout(() => setSlow(true), 15000)
    return () => clearTimeout(t)
  }, [url])
  const post = msg => { if (ready && frameOrigin.current) frame.current?.contentWindow?.postMessage(msg, frameOrigin.current) }
  useEffect(() => { post({ type: 'kiosk.design', design }) }, [design, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const box = useRef(null)
  const [W, H] = PREVIEW_SIZE[orientation]
  const [scale, setScale] = useState(0.3)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.max(0.12, Math.min(1, (el.clientWidth - 32) / W, (el.clientHeight - 32) / H)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H])

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-background">
        <Btn onClick={() => post({ type: 'kiosk.restart' })} title="Show the start screen"><RotateCcw className="w-4 h-4" /> <span className="hidden xl:inline">Start screen</span></Btn>
        <Btn onClick={() => post({ type: 'kiosk.show', screen: 'menu' })} title="Show the menu"><BookOpen className="w-4 h-4" /> <span className="hidden xl:inline">Menu</span></Btn>
        <div className="inline-flex rounded-lg border overflow-hidden" role="group" aria-label="Screen shape">
          {[['portrait', RectangleVertical, 'Upright'], ['landscape', RectangleHorizontal, 'Wide']].map(([o, Icon, label]) => (
            <button key={o} type="button" onClick={() => turn(o)} aria-pressed={orientation === o} title={label + ' screen'} data-testid={'kd-orient-' + o}
              className={cn('h-11 px-3 text-sm inline-flex items-center gap-1.5 touch-manipulation', orientation === o ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
              <Icon className="w-4 h-4" /> <span className="hidden xl:inline">{label}</span>
            </button>
          ))}
        </div>
        {streams.length > 1 && (
          <select value={stream?.id || ''} onChange={e => onStream(e.target.value)} aria-label="Revenue stream for the preview"
            className="h-11 rounded-lg border bg-background px-2 text-sm touch-manipulation max-w-[200px]" data-testid="kd-stream">
            {streams.map(r => <option key={r.id} value={r.id}>As {r.name}</option>)}
          </select>
        )}
        <span className="text-[11px] text-muted-foreground flex-1 min-w-[140px]">Use it like the kiosk. Orders aren't sent.</span>
      </div>
      <div ref={box} className="flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-muted/40 p-4">
        {link.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {link.error && <div className="max-w-sm"><ErrorNote error={link.error} /></div>}
        {url && (
          <div className="relative shrink-0 rounded-xl overflow-hidden bg-black ring-[6px] ring-neutral-800 shadow-xl" style={{ width: W * scale, height: H * scale }}>
            <iframe ref={frame} key={url} src={url} title="Kiosk preview" data-testid="kd-preview"
              className="absolute left-0 top-0 border-0" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center">
                {slow
                  ? <p className="text-white text-sm max-w-[260px]">The preview hasn't started. Check that the till address opens: <span className="break-all">{origin}</span></p>
                  : <Loader2 className="w-6 h-6 animate-spin text-white" />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sharing (migration 187) ─────────────────────────────────────
// A lasting link for people outside the group: the design as saved, with one
// location's menu, at kiosk.<domain>/?kiosk_share=<token>. Making, moving and
// stopping it need Manage; anyone who can see the design can copy it.

function ShareDialog({ designId, share, dirty, venues, defaultVenueId, canManage, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [venueId, setVenueId] = useState(share?.venue_id || defaultVenueId || '')
  const [streamId, setStreamId] = useState(share?.revenue_stream_id || '')
  const [until, setUntil] = useState(share?.expires_at ? String(share.expires_at).slice(0, 10) : '')
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState(null) // 'new' | 'stop'
  const { data: setup } = usePosSetup(venueId || null)
  const streams = (setup?.revenue_streams || []).filter(r => r.is_active)
  const done = () => { qc.invalidateQueries({ queryKey: ['kiosk-designs'] }); setConfirm(null) }
  const save = useMutation({
    mutationFn: () => api.put(`/pos/kiosk-designs/${designId}/share`, { venue_id: venueId, revenue_stream_id: streamId || null, expires_on: until || null }),
    onSuccess: done,
  })
  const renew = useMutation({ mutationFn: () => api.post(`/pos/kiosk-designs/${designId}/share/new-link`, {}), onSuccess: done })
  const stop = useMutation({ mutationFn: () => api.delete(`/pos/kiosk-designs/${designId}/share`), onSuccess: done })
  const qr = useMemo(() => { try { return share?.url ? qrSvg(share.url, { margin: 2, title: 'QR code of the preview link' }) : '' } catch { return '' } }, [share?.url])
  const changed = share && (venueId !== share.venue_id || (streamId || null) !== (share.revenue_stream_id || null) || (until || null) !== (share.expires_at ? String(share.expires_at).slice(0, 10) : null))
  const copy = async () => {
    try { await navigator.clipboard.writeText(share.url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the field can be copied by hand */ }
  }
  const today = new Date().toISOString().slice(0, 10)
  const err = save.error || renew.error || stop.error
  const settings = (
    <div className="space-y-3">
      <Field label="Menu and prices from">
        <select className={inputCls} value={venueId} onChange={e => { setVenueId(e.target.value); setStreamId('') }} disabled={!canManage} data-testid="kd-share-venue">
          {!venueId && <option value="">Pick a location</option>}
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      {streams.length > 1 && (
        <Field label="Order as" hint="The revenue stream decides which menus and order types it shows.">
          <select className={inputCls} value={streamId} onChange={e => setStreamId(e.target.value)} disabled={!canManage} data-testid="kd-share-stream">
            <option value="">{streams[0].name} (the first)</option>
            {streams.slice(1).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Works until" hint="Leave empty for a link that works until you stop sharing it.">
        <span className="flex items-center gap-2">
          <span className="relative inline-flex items-center h-11 px-3 rounded-lg border bg-background text-sm min-w-[160px] touch-manipulation">
            {until || 'No end date'}
            <input type="date" min={today} value={until} onChange={e => setUntil(e.target.value)} disabled={!canManage} aria-label="Works until"
              onClick={e => { try { e.currentTarget.showPicker?.() } catch { /* already open */ } }} className="absolute inset-0 opacity-0 cursor-pointer" data-testid="kd-share-until" />
          </span>
          {until && canManage && <Btn onClick={() => setUntil('')}>No end date</Btn>}
        </span>
      </Field>
    </div>
  )
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-background shadow-xl" role="dialog" aria-label="Share a preview" data-testid="kd-share-dialog">
        <div className="section-head px-4 py-3 flex items-center gap-2">
          <Share2 className="w-4 h-4" /><h2 className="font-semibold text-sm flex-1">Share a preview</h2>
          <button type="button" onClick={onClose} className="p-2 -m-2 rounded-lg touch-manipulation" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            A link anyone can open to try this kiosk, no sign-in needed: send it to a brand team, a partner or a designer. It shows the
            design as saved, with the menu and prices of the location you pick. Nothing is ordered or paid.
          </p>
          {share ? (
            <>
              {share.expired && <Note tone="warn">This link has run out: pick a later end date, or none, and save.</Note>}
              {dirty && <Note tone="warn">Changes you haven't saved aren't in the shared preview yet.</Note>}
              <div className="flex gap-3 items-start">
                <div className="flex-1 min-w-0 space-y-2">
                  <input readOnly value={share.url} onFocus={e => e.target.select()} className={cn(inputCls, 'font-mono text-xs')} aria-label="Preview link" data-testid="kd-share-url" />
                  <div className="flex flex-wrap gap-2">
                    <Btn variant="primary" onClick={copy} data-testid="kd-share-copy">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy link'}</Btn>
                    <a href={share.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 h-11 px-3 rounded-lg border text-sm touch-manipulation hover:bg-muted"><ExternalLink className="w-4 h-4" />Open</a>
                  </div>
                  <p className="text-xs text-muted-foreground" data-testid="kd-share-stats">
                    Opened {share.views} {share.views === 1 ? 'time' : 'times'}{share.last_viewed_at ? ', last on ' + new Date(share.last_viewed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}.
                    {share.created_at ? ' Made ' + new Date(share.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + (share.created_by ? ' by ' + share.created_by : '') + '.' : ''}
                  </p>
                </div>
                {qr && <div className="w-24 h-24 shrink-0 rounded-lg border bg-white p-1" dangerouslySetInnerHTML={{ __html: qr }} />}
              </div>
              {settings}
              {canManage && (
                <div className="space-y-2 border-t pt-3">
                  {changed && <Btn variant="primary" disabled={!venueId || save.isPending} onClick={() => save.mutate()} data-testid="kd-share-save">{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save</Btn>}
                  {confirm === 'new' ? (
                    <div className="rounded-lg border p-3 space-y-2 text-sm" data-testid="kd-share-renew-confirm">
                      <p>Make a new link? The current one stops working straight away, for everyone you sent it to.</p>
                      <div className="flex gap-2"><Btn variant="primary" onClick={() => renew.mutate()} data-testid="kd-share-renew-yes">New link</Btn><Btn onClick={() => setConfirm(null)}>Keep this one</Btn></div>
                    </div>
                  ) : confirm === 'stop' ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2 text-sm" data-testid="kd-share-stop-confirm">
                      <p>Stop sharing? The link stops working straight away.</p>
                      <div className="flex gap-2"><button type="button" className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium touch-manipulation" onClick={() => stop.mutate()} data-testid="kd-share-stop-yes">Stop sharing</button><Btn onClick={() => setConfirm(null)}>Keep sharing</Btn></div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Btn onClick={() => setConfirm('new')} data-testid="kd-share-renew"><RotateCcw className="w-4 h-4" />New link</Btn>
                      <Btn onClick={() => setConfirm('stop')} data-testid="kd-share-stop"><X className="w-4 h-4" />Stop sharing</Btn>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : canManage ? (
            <>
              {settings}
              <Btn variant="primary" disabled={!venueId || save.isPending} onClick={() => save.mutate()} data-testid="kd-share-make">
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}Make a link
              </Btn>
            </>
          ) : (
            <p className="text-sm">This design isn't shared. Someone who can change Till setup can make a link.</p>
          )}
          {err && <ErrorNote error={err} />}
        </div>
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────

const PANELS = [
  { id: 'brand', title: 'Brand', icon: Palette },
  { id: 'layout', title: 'Layout', icon: LayoutDashboard },
  { id: 'start', title: 'Start screen', icon: Home },
  { id: 'languages', title: 'Languages', icon: Languages },
  { id: 'menu', title: 'Menu', icon: LayoutGrid },
  { id: 'choices', title: 'Choices', icon: Sparkles },
  { id: 'checkout', title: 'Paying', icon: CreditCard },
  { id: 'timing', title: 'Timing and access', icon: Timer },
]

function summaryOf(id, d) {
  if (id === 'brand') return d.brand.font_heading + ' / ' + d.brand.font_body
  if (id === 'layout') return [d.layout.header ? 'Top bar' : 'No top bar', d.layout.icon_buttons ? 'icon buttons' : null].filter(Boolean).join(', ')
  if (id === 'start') return (d.start.media.length ? d.start.media.length + ' picture' + (d.start.media.length === 1 ? '' : 's') : 'No pictures') + ', ' + (d.start.layout === 'full' ? 'pictures behind' : 'pictures apart')
  if (id === 'languages') return d.languages.enabled.map(c => KIOSK_LANGUAGES.find(l => l.code === c)?.name).join(', ')
  if (id === 'menu') return TILE_LABELS[d.layout.tiles] + ', ' + (d.menu.rail === 'none' ? 'section tiles, ' : '') + (d.menu.home ? d.menu.banners.length + ' banners, ' + d.menu.featured.length + ' tiles' : 'No home page') + (d.menu.hidden_section_ids.length ? ', ' + d.menu.hidden_section_ids.length + ' sections left off' : '')
  if (id === 'choices') return DISPLAY_LABELS[d.options.display] + ', ' + TILE_LABELS[d.layout.option_tiles].toLowerCase() + (d.options.wheel_spin_picks ? ', a spin picks' : '')
  if (id === 'checkout') return [d.checkout.pay_card && 'Card', d.checkout.pay_counter && 'At the counter'].filter(Boolean).join(' and ') || 'No way to pay'
  if (id === 'timing') return 'Starts again after ' + d.behaviour.idle_secs + ' s'
  return ''
}

export default function KioskDesigner() {
  const { id } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const qc = useQueryClient()
  const { canManage } = usePermission('pos_setup')
  const { venues, venueId, setVenueId, venue } = usePosVenue()
  const { data: setup } = usePosSetup(venueId)
  const { data: designs, isLoading, error } = useQuery({ queryKey: ['kiosk-designs'], queryFn: () => api.get('/pos/kiosk-designs') })
  const row = designs?.find(x => x.id === id)

  const [draft, setDraft] = useState(null) // { name, settings } as typed
  const saved = useRef(null)
  const [savedKey, setSavedKey] = useState('')
  const keyOf = x => JSON.stringify({ name: x.name.trim(), settings: normaliseDesign(x.settings) })
  const loadedFor = useRef(null)
  useEffect(() => {
    if (!row || loadedFor.current === row.id) return
    loadedFor.current = row.id
    const x = { name: row.name, settings: normaliseDesign(row.settings) }
    saved.current = x
    setDraft(x)
    setSavedKey(keyOf(x))
  }, [row])

  const design = useMemo(() => (draft ? normaliseDesign(draft.settings) : null), [draft?.settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && keyOf(draft) !== savedKey
  const set = (part, patch) => setDraft(x => {
    const cur = x.settings[part] || {}
    return { ...x, settings: { ...x.settings, [part]: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } } }
  })

  const save = useMutation({
    mutationFn: () => api.put('/pos/kiosk-designs/' + id, { name: draft.name.trim(), settings: design }),
    onSuccess: out => {
      const x = { name: out.name, settings: out.settings }
      saved.current = x
      setSavedKey(keyOf(x))
      qc.invalidateQueries({ queryKey: ['kiosk-designs'] })
      qc.invalidateQueries({ queryKey: ['pos-setup'] })
    },
  })
  function discard() {
    setDraft(JSON.parse(JSON.stringify(saved.current)))
    save.reset()
  }

  const [open, setOpen] = useState(() => new Set(['brand']))
  const toggle = p => setOpen(o => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const [pane, setPane] = useState('settings') // phones: one pane at a time
  const [leaving, setLeaving] = useState(false)
  const [streamId, setStreamId] = useState('') // the preview's revenue stream ('' = the first)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = EXTRA_FONTS_HREF
    document.head.appendChild(link)
    return () => link.remove()
  }, [])

  const back = () => navigate('/pos?tab=kiosks')

  if (isLoading) return <div className="h-full flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  if (error) return <div className="p-6 max-w-lg"><ErrorNote error={error} /></div>
  if (!row) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm">This kiosk design doesn't exist any more.</p>
        <Btn onClick={back}><ArrowLeft className="w-4 h-4" /> Kiosks</Btn>
      </div>
    )
  }
  if (!draft || !design) return null

  const problems = designProblems(design)
  const kiosks = (setup?.devices || []).filter(k => k.kind === 'kiosk' && !k.revoked_at && kioskDesign(setup, k)?.id === id)
  const kioskProblems = problems.length ? [] : kiosks.flatMap(k => designProblems(design, k.settings || {}).map(p => k.name + ': ' + p))
  // The preview orders as a kiosk using this design would (its stream decides
  // the menus and order types), else as the first stream.
  const streams = (setup?.revenue_streams || []).filter(r => r.is_active)
  const kioskStream = kiosks.map(k => k.settings?.revenue_stream_id).find(sid => streams.some(r => r.id === sid))
  const stream = streams.find(r => r.id === (streamId || kioskStream)) || streams[0] || null

  const panelProps = { s: draft.settings, d: design, set, setup, venueName: venue?.name, canManage, stream }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-page" data-testid="kiosk-designer">
      <div className="shrink-0 min-h-[56px] border-b bg-background flex flex-wrap items-center gap-2 px-4 py-2 max-lg:notouch:pl-14">
        {leaving ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs">Leave without saving?</span>
            <button type="button" onClick={back} className="h-11 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium touch-manipulation">Leave</button>
            <button type="button" onClick={() => setLeaving(false)} className="h-11 px-3 rounded-lg border text-xs touch-manipulation hover:bg-muted">Stay</button>
          </span>
        ) : (
          <button type="button" onClick={() => (dirty ? setLeaving(true) : back())} data-testid="kd-back"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-[44px] px-2 touch-manipulation">
            <ArrowLeft className="w-4 h-4" /> Kiosks
          </button>
        )}
        <div className="min-w-[150px] flex-1">
          <p className="text-sm font-semibold truncate">{draft.name.trim() || 'Kiosk design'}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            Kiosk design · {kiosks.length ? 'used by ' + kiosks.map(k => k.name).join(', ') : 'no kiosk at ' + (venue?.name || 'this venue') + ' uses it'}
          </p>
        </div>
        <VenueSelect venues={venues} venueId={venueId} onChange={setVenueId} />
        <Btn onClick={() => setSharing(true)} data-testid="kd-share">
          <Share2 className="w-4 h-4" /> <span className="hidden sm:inline">{row.share ? 'Shared' : 'Share'}</span>
        </Btn>
        {canManage ? (
          <>
            {dirty && <Btn onClick={discard}>Discard</Btn>}
            <Btn variant="primary" disabled={!dirty || !draft.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} <span data-testid="kd-save">{dirty ? 'Save' : 'Saved'}</span>
            </Btn>
          </>
        ) : <span className="text-xs text-muted-foreground px-2">View only</span>}
      </div>
      {save.isError && <div className="shrink-0 bg-destructive/10 text-destructive text-sm px-4 py-2 border-b">Save failed: {save.error?.message || String(save.error)}</div>}
      {sharing && <ShareDialog designId={id} share={row.share} dirty={dirty} venues={venues} defaultVenueId={venueId} canManage={canManage} onClose={() => setSharing(false)} />}

      <div className="md:hidden shrink-0 px-4 py-2 border-b bg-background">
        <Segmented value={pane} onChange={setPane} className="w-full [&>button]:flex-1"
          options={[{ value: 'settings', label: 'Settings' }, { value: 'preview', label: 'Preview' }]} />
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className={cn('md:w-[360px] lg:w-[420px] xl:w-[460px] shrink-0 md:border-r overflow-y-auto w-full', pane !== 'settings' && 'max-md:hidden')}>
          <div className="p-4 space-y-3">
            {!canManage && <ReadOnlyNotice what="kiosk designs" />}
            <ReadOnlyFieldset disabled={!canManage}>
              <Field label="Design name" hint="Shown in Till setup when picking a kiosk's design.">
                <input className={inputCls} maxLength={80} value={draft.name} onChange={e => setDraft(x => ({ ...x, name: e.target.value }))} data-testid="kd-name" />
              </Field>
            </ReadOnlyFieldset>
            {[...problems, ...kioskProblems].map(p => <Note key={p} tone="warn">{p}</Note>)}
            {PANELS.map(p => (
              <Panel key={p.id} id={p.id} icon={p.icon} title={p.title} summary={summaryOf(p.id, design)}
                open={open.has(p.id)} onToggle={() => toggle(p.id)} canManage={canManage}>
                {p.id === 'brand' && <BrandPanel {...panelProps} />}
                {p.id === 'layout' && <LayoutPanel {...panelProps} />}
                {p.id === 'start' && <StartPanel {...panelProps} />}
                {p.id === 'languages' && <LanguagesPanel {...panelProps} />}
                {p.id === 'menu' && <MenuPanel {...panelProps} />}
                {p.id === 'choices' && <ChoicesPanel {...panelProps} />}
                {p.id === 'checkout' && <CheckoutPanel {...panelProps} />}
                {p.id === 'timing' && <TimingPanel {...panelProps} />}
              </Panel>
            ))}
          </div>
        </div>
        <div className={cn('flex-1 min-w-0 flex', pane !== 'preview' && 'max-md:hidden')}>
          {venueId
            ? <Preview designId={id} design={design} venueId={venueId} setup={setup} streams={streams} stream={stream} onStream={setStreamId} />
            : <p className="m-auto text-sm text-muted-foreground p-6">Add a venue to see the preview.</p>}
        </div>
      </div>
    </div>
  )
}
