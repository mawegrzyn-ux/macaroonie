// src/components/pos/PromptLook.jsx
//
// An order flow prompt's look in the designer (ask.look, shared/pos/
// orderFlows.js): the Look panel, which edits one channel at a time (the
// header, the background, the dishes, the colours), and the preview drawn
// in that channel's look. Each channel the flow runs on has a look of its
// own: tills, kiosks and online ordering look different, so one prompt can
// be a band of the brand colour on the website and plain on the till.
//
// Colours are picked from the channel's theme: tills and online ordering
// take the brand's (Brand & theme; a location with its own Brand & theme
// uses its own), kiosks their kiosk design's. A theme colour is stored as
// its name, so it follows the theme; a colour of its own is stored as a
// code. The catalogue (GET /pos/order-flows/catalog) sends the themes:
// themes.brand and themes.kiosk (each design's colours, most used first).

import { useEffect, useState } from 'react'
import { Check, Copy, RotateCcw, MessageSquarePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Section, Field, Segmented, Toggle, Btn, inputCls, money } from '@/components/pos/shared'
import { ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { PicturePick } from '@/components/media/PicturePick'
import { CHECKER, inkOn } from '@/components/ColourPicker'
import {
  promptLook, hasOwnLook, promptStyle, promptBackground, promptColourText,
  PROMPT_ROLES, PROMPT_ROLE_NAMES, PROMPT_SHADE_MAX, APP_NAMES, FLOW_APPS,
} from '@shared/pos/orderFlows.js'

const HEX = /^#[0-9a-f]{6}$/i
const isHex = v => HEX.test(v || '')

const HEADERS = [
  { value: 'plain', label: 'Plain' },
  { value: 'band', label: 'Band of colour' },
  { value: 'picture', label: 'Picture' },
]
const ALIGNS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centred' },
]
const DISHES = [
  { value: 'cards', label: 'Cards' },
  { value: 'rows', label: 'Rows' },
]
const HEADER_WORDS = { plain: 'plain header', band: 'a band of colour', picture: 'a picture on top' }
const lower = s => s.charAt(0).toLowerCase() + s.slice(1)

/** The channels whose look can be set: the ones the flow runs on (all three while none is picked). */
export const lookApps = f => (f?.apps?.length ? f.apps : FLOW_APPS)

/**
 * A channel's theme in the designer: { theme (the colours as codes),
 * standard (its prompt's own background), words (its standard text
 * colour), source (where the colours come from, in words) }.
 */
export function channelTheme(app, themes, kioskId = null) {
  if (app === 'kiosk') {
    const list = themes?.kiosk || []
    const d = list.find(x => x.id === kioskId) || list[0] || null
    const c = d?.colours || {}
    const sheet = c.surface === 'transparent' ? c.background : c.surface
    return {
      theme: c, standard: isHex(sheet) ? sheet : '#ffffff', words: isHex(c.text) ? c.text : '#1f2937',
      source: d ? 'the kiosk design ' + d.name : 'the kiosk design',
    }
  }
  const b = themes?.brand || {}
  return {
    theme: b,
    standard: app === 'online' && isHex(b.background) ? b.background : '#ffffff',
    words: app === 'online' && isHex(b.text) ? b.text : '#0f172a',
    source: 'the brand (Brand & theme)',
  }
}

/** The Look box's lines: each channel's look in words. */
export function lookLines(f) {
  return lookApps(f).map(app => {
    if (!hasOwnLook(f, app)) return APP_NAMES[app] + ': the standard look'
    const l = promptLook(f, app)
    const bits = [HEADER_WORDS[l.header.style], l.dishes === 'cards' ? 'dishes as cards' : 'dishes in rows', l.pictures ? 'with pictures' : 'no pictures']
    if (l.background.image_url) bits.push('a picture behind')
    else if (l.colours.window) bits.push('its own background')
    return APP_NAMES[app] + ': ' + bits.join(', ')
  })
}

/** Pick which channel's look to edit or preview (outside any read-only fieldset: viewers can look at each). */
export function ChannelSwitch({ f, app, setApp, testid = 'look-app' }) {
  const apps = lookApps(f)
  if (apps.length < 2) return null
  return (
    <div className="inline-flex flex-wrap rounded-lg border overflow-hidden" role="group" aria-label="Channel" data-testid={testid}>
      {apps.map(a => (
        <button key={a} type="button" aria-pressed={app === a} onClick={() => setApp(a)} data-app={a}
          className={cn('h-12 px-3 text-sm font-medium touch-manipulation transition-colors',
            app === a ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
          {APP_NAMES[a]}
        </button>
      ))}
    </div>
  )
}

/** Which kiosk design's colours the swatches and the preview show (several designs). */
export function KioskDesignPick({ themes, kioskId, setKioskId }) {
  const list = themes?.kiosk || []
  if (list.length < 2) return null
  const value = list.some(d => d.id === kioskId) ? kioskId : list[0].id
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1">Kiosk design to show</span>
      <select className={cn(inputCls, 'h-12')} value={value || ''} onChange={e => setKioskId(e.target.value || null)} data-testid="look-kiosk-design">
        {list.map(d => (
          <option key={d.id || 'standard'} value={d.id || ''}>
            {d.name}{d.used_by ? ' (' + d.used_by + ' kiosk' + (d.used_by === 1 ? '' : 's') + ')' : ''}
          </option>
        ))}
      </select>
      <span className="block text-[11px] text-muted-foreground mt-1">Each kiosk shows theme colours from its own design.</span>
    </label>
  )
}

/** One colour of the look: Standard, a theme colour (follows the theme) or a code of its own. */
function LookColour({ label, value, onChange, theme, standardLabel = 'Standard', testid }) {
  const custom = isHex(value) ? value.toLowerCase() : null
  const [text, setText] = useState(custom || '')
  useEffect(() => { setText(custom || '') }, [custom])
  return (
    <div role="group" aria-label={label} data-testid={testid}>
      <p className="text-xs font-medium text-muted-foreground mb-1">
        {label}: <span className="text-foreground" data-testid={testid + '-value'}>{value == null ? standardLabel : promptColourText(value)}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={value == null} onClick={() => onChange(null)} data-testid={testid + '-standard'}
          className={cn('h-12 px-3 rounded-lg border text-xs font-medium touch-manipulation',
            value == null ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
          {standardLabel}
        </button>
        {PROMPT_ROLES.map(r => {
          const hex = isHex(theme?.[r]) ? theme[r].toLowerCase() : null
          const on = value === r
          return (
            <button key={r} type="button" aria-pressed={on} onClick={() => onChange(r)} data-testid={testid + '-' + r}
              aria-label={PROMPT_ROLE_NAMES[r]} title={PROMPT_ROLE_NAMES[r] + (hex ? ' (' + hex + ')' : ' (see-through)')}
              className={cn('relative w-12 h-12 rounded-lg border touch-manipulation flex items-center justify-center shrink-0',
                on ? 'ring-2 ring-primary ring-offset-1' : 'hover:ring-1 hover:ring-primary/40')}
              style={{ background: hex || CHECKER }}>
              {on && <Check className="w-4 h-4" style={{ color: hex ? inkOn(hex) : '#000000' }} />}
            </button>
          )
        })}
        <span className={cn('relative shrink-0 rounded-lg', custom && 'ring-2 ring-primary ring-offset-1')}>
          <input type="color" value={custom || '#000000'} onChange={e => onChange(e.target.value.toLowerCase())}
            aria-label={label + ': a colour of its own'} title="A colour of its own" data-testid={testid + '-custom'}
            className="block w-12 h-12 rounded-lg border bg-background p-1 cursor-pointer touch-manipulation" />
        </span>
        <input value={text} maxLength={7} spellCheck={false} placeholder="#rrggbb" aria-label={label + ' code'} data-testid={testid + '-code'}
          onChange={e => { const t = e.target.value.trim(); setText(t); if (isHex(t)) onChange(t.toLowerCase()) }}
          className="w-24 h-12 rounded-lg border bg-background px-2 text-sm font-mono touch-manipulation" />
      </div>
    </div>
  )
}

/**
 * The Look panel: one channel's look at a time (app). set: the designer's
 * patch setter; the draft is normalised on every change, so a look put back
 * to the channel's standard one stops being stored by itself.
 */
export function LookPanel({ f, set, app, setApp, themes, kioskId, setKioskId, readOnly }) {
  const apps = lookApps(f)
  const own = hasOwnLook(f, app)
  const l = promptLook(f, app)
  const { theme, source } = channelTheme(app, themes, kioskId)
  const put = (a, part) => set({ ask: { ...f.ask, look: { ...(f.ask.look || {}), [a]: part } } })
  const change = patch => put(app, { ...l, ...patch })
  const header = patch => change({ header: { ...l.header, ...patch } })
  const background = patch => change({ background: { ...l.background, ...patch } })
  const colour = k => v => change({ colours: { ...l.colours, [k]: v } })
  const others = apps.filter(a => a !== app)
  const name = lower(APP_NAMES[app])
  return (
    <Section title={'Look on ' + name} hint="How the prompt looks. Each channel it runs on has a look of its own.">
      <div className="space-y-3">
        <ChannelSwitch f={f} app={app} setApp={setApp} testid="look-panel-app" />
        {app === 'kiosk' && <KioskDesignPick themes={themes} kioskId={kioskId} setKioskId={setKioskId} />}
        <p className={cn('text-sm rounded-lg px-3 py-2', own ? 'bg-rose-50 text-rose-900' : 'bg-muted/50 text-muted-foreground')} data-testid="look-state" data-own={own ? '1' : '0'}>
          {own
            ? 'This prompt has its own look on ' + name + '.'
            : 'The standard look on ' + name + '. Change anything below to give this prompt its own.'}
        </p>
      </div>
      <ReadOnlyFieldset disabled={readOnly}>
        <div className="space-y-4">
          <Field group label="Header">
            <Segmented value={l.header.style} options={HEADERS} onChange={v => header({ style: v })} className="flex-wrap" />
          </Field>
          {l.header.style === 'picture' && (
            <div className="flex items-center gap-3" data-testid="look-header-picture">
              <PicturePick url={l.header.image_url} onChange={v => header({ image_url: v || null })} scope="order-flows" size="wide" label="header picture" />
              <span className="text-xs text-muted-foreground">
                {l.header.image_url ? 'Across the top, three times as wide as it is tall.' : 'Pick a picture: until then the prompt has a plain header.'}
              </span>
            </div>
          )}
          {l.header.style === 'band' && (
            <LookColour label="The band" value={l.colours.header} onChange={colour('header')} theme={theme} standardLabel="Main colour" testid="look-colour-header" />
          )}
          <Field group label="The question and the line under it">
            <Segmented value={l.header.align} options={ALIGNS} onChange={v => header({ align: v })} />
          </Field>

          <LookColour label="Background" value={l.colours.window} onChange={colour('window')} theme={theme} testid="look-colour-window" />
          <div className="flex items-center gap-3" data-testid="look-background-picture">
            <PicturePick url={l.background.image_url} onChange={v => background({ image_url: v || null })} scope="order-flows" size="wide" label="background picture" />
            <span className="text-xs text-muted-foreground">
              {l.background.image_url ? 'Behind the prompt, under a veil of its background colour.' : 'A picture behind the prompt (optional).'}
            </span>
          </div>
          {l.background.image_url && (
            <label className="block" data-testid="look-shade">
              <span className="block text-xs font-medium text-muted-foreground mb-1">
                The background colour over the picture: <span className="text-foreground tabular-nums">{l.background.shade}%</span>
              </span>
              <input type="range" min={0} max={PROMPT_SHADE_MAX} step={5} value={l.background.shade}
                onChange={e => background({ shade: Number(e.target.value) })} aria-label="The background colour over the picture"
                className="w-full h-12 touch-manipulation" />
              <span className="block text-[11px] text-muted-foreground">More keeps the words readable; 0 shows the picture as it is.</span>
            </label>
          )}

          <Field group label="Dishes">
            <Segmented value={l.dishes} options={DISHES} onChange={v => change({ dishes: v })} />
          </Field>
          <Toggle label="The dishes' pictures" checked={l.pictures} onChange={v => change({ pictures: v })}
            hint={l.dishes === 'cards' ? 'On top of each card, big.' : 'Small, beside each name.'} />

          <LookColour label="The question" value={l.colours.title} onChange={colour('title')} theme={theme} testid="look-colour-title" />
          <LookColour label="Words" value={l.colours.text} onChange={colour('text')} theme={theme} testid="look-colour-text" />
          <LookColour label="Dishes" value={l.colours.cards} onChange={colour('cards')} theme={theme} testid="look-colour-cards" />
          <LookColour label="No thanks / Done" value={l.colours.button} onChange={colour('button')} theme={theme} testid="look-colour-button" />
          <p className="text-xs text-muted-foreground">
            Theme colours come from {source} and follow it when it changes. Words on a colour are picked to read well.
          </p>

          {!readOnly && (own || others.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {own && (
                <Btn onClick={() => put(app, null)} data-testid="look-standard"><RotateCcw className="w-4 h-4" /> Standard look</Btn>
              )}
              {own && others.map(a => (
                <Btn key={a} onClick={() => put(a, l)} data-testid={'look-copy-' + a}><Copy className="w-4 h-4" /> Same look on {lower(APP_NAMES[a])}</Btn>
              ))}
            </div>
          )}
        </div>
      </ReadOnlyFieldset>
    </Section>
  )
}

/** The prompt drawn in a channel's look (approximately: each channel has its own fonts and spacing). */
export function PromptPreview({ f, names, app, setApp, themes, kioskId, setKioskId }) {
  const { theme, standard, words, source } = channelTheme(app, themes, kioskId)
  const st = promptStyle(f, app, theme)
  const bg = promptBackground(st, standard) || standard
  const band = st.header.style === 'band'
  const picture = st.header.style === 'picture' && st.header.picture
  const rows = st.dishes === 'rows'
  const centre = st.header.align === 'center'
  const ink = st.text || words
  const muted = isHex(theme.muted) && !st.window ? theme.muted : null
  const dishes = f.ask.item_ids
  const standardCard = app === 'till' ? '#ffffff' : app === 'kiosk' ? (isHex(theme.surface) ? theme.surface : theme.background) : null
  const cardStyle = st.cards
    ? { background: st.cards, color: st.cards_ink }
    : { background: standardCard || 'transparent', color: ink }
  const cardEdge = app === 'kiosk' ? 'shadow-md border-transparent' : 'border-slate-200'
  const head = (
    <div className={cn(centre && 'text-center')}>
      <p className="text-lg font-semibold leading-tight" style={{ color: st.title || undefined }} data-testid="preview-title">{f.ask.title || 'Your question'}</p>
      {f.ask.message && (
        <p className="text-sm mt-0.5" style={{ color: st.message || muted || undefined, opacity: st.message || muted ? undefined : 0.7 }} data-testid="preview-message">{f.ask.message}</p>
      )}
    </div>
  )
  return (
    <Section title="The prompt" hint={'How it looks on ' + lower(APP_NAMES[app]) + ' (near enough: each has its own fonts and sizes).'}>
      {/* In the body, not the header's actions: on a phone the header would squeeze the title into a sliver. */}
      <ChannelSwitch f={f} app={app} setApp={setApp} testid="preview-app" />
      {app === 'kiosk' && <KioskDesignPick themes={themes} kioskId={kioskId} setKioskId={setKioskId} />}
      <div className="rounded-2xl bg-slate-900 p-4">
        <div className="rounded-2xl overflow-hidden shadow-xl" style={{ background: bg, color: ink }} data-testid="preview-prompt"
          data-app={app} data-look={st.own ? 'own' : 'standard'} data-header={st.header.style} data-dishes={st.dishes} data-pictures={st.pictures ? '1' : '0'}>
          {band && <div className="px-4 py-3" style={{ background: st.band }} data-testid="preview-band">{head}</div>}
          {picture && <img src={picture} alt="" className="block w-full aspect-[3/1] object-cover" data-testid="preview-picture" />}
          <div className="p-4 space-y-3">
            {!band && (
              <div className="flex items-start gap-3">
                {app === 'till' && !picture && !centre && (
                  <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><MessageSquarePlus className="w-5 h-5" /></span>
                )}
                <div className="flex-1 min-w-0">{head}</div>
              </div>
            )}
            <div className={cn('grid gap-2', rows ? 'grid-cols-1' : 'grid-cols-2')}>
              {dishes.map(id => {
                const pic = st.pictures ? names.images?.[id] || null : null
                const letter = (names.items[id] || '?').trim().charAt(0).toUpperCase()
                return (
                  <div key={id} className={cn('rounded-xl border-2 overflow-hidden', cardEdge, rows ? 'flex items-center gap-2 p-2 min-h-[56px]' : 'flex flex-col min-h-[64px]')}
                    style={cardStyle} data-testid="preview-dish">
                    {st.pictures && rows && pic && <img src={pic} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" data-testid="preview-dish-picture" />}
                    {st.pictures && !rows && (pic
                      ? <img src={pic} alt="" className="block w-full aspect-[4/3] object-cover" data-testid="preview-dish-picture" />
                      : app !== 'till' && <span className="w-full aspect-[4/3] bg-black/5 flex items-center justify-center text-2xl font-bold opacity-50">{letter}</span>)}
                    <span className={cn('flex flex-col justify-between min-w-0', rows ? 'flex-1' : 'p-2 flex-1')}>
                      <span className="text-sm font-medium leading-tight">{names.items[id] || 'A dish no longer on the menu'}</span>
                      {names.prices[id] != null && <span className="text-xs tabular-nums opacity-75">{money(names.prices[id])}</span>}
                    </span>
                  </div>
                )
              })}
              {!dishes.length && <p className="col-span-2 text-sm opacity-70">The dishes it offers show here.</p>}
            </div>
            <div className="flex justify-center">
              <span className="flex-1 h-12 rounded-xl border flex items-center justify-center text-sm font-medium" data-testid="preview-done"
                style={st.button ? { background: st.button, color: st.button_ink, borderColor: st.button } : { borderColor: 'currentColor', opacity: 0.85 }}>
                No thanks
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="preview-hint">
        {f.ask.pick === 'several' && dishes.length > 1
          ? 'Each tap adds one of that dish (the count shows on it); No thanks becomes Done once one is added.'
          : 'Tapping a dish adds it and closes the prompt.'}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="preview-theme">
        Theme colours here come from {source}{app !== 'kiosk' ? '; a location with its own Brand & theme uses its own' : ''}.
      </p>
    </Section>
  )
}
