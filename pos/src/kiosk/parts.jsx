// Small pieces the kiosk's screens share: flags, order type icons, photos
// with a stand-in, heat levels, the quantity stepper, sheets, the on-screen
// keyboard and number pad (kiosk browsers often hide the device's own).

import { Children, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { UtensilsCrossed, ShoppingBag, Bike, Flame, Star, Circle, Minus, Plus, Delete, ArrowLeft } from 'lucide-react'
import { hexLayout, cornerWidths, bundleLayout, bundleBox, fitLayout } from '@shared/kiosk.js'
import { useClear } from './clear.js'

export const cx = (...p) => p.filter(Boolean).join(' ')

/**
 * Every screen's way back: a solid button at the left of the screen's bottom
 * bar, beside the main button, never at the top (out of reach on a tall
 * kiosk, and missed by guests looking at the bottom for what to do next).
 * With the design's icons-only buttons the words hide (.k-icons) and stay
 * the button's name for screen readers.
 */
export function BackButton({ onClick, label, testId = 'k-back' }) {
  return (
    <button className="k-btn k-btn-big k-btn-back" onClick={onClick} data-testid={testId} aria-label={label}>
      <ArrowLeft /><span className="k-btn-label">{label}</span>
    </button>
  )
}

const PORTRAIT = '(orientation: portrait)'

/** True on a screen taller than it is wide; follows the screen being turned. */
export function usePortrait() {
  const [portrait, setPortrait] = useState(() => window.matchMedia?.(PORTRAIT).matches ?? true)
  useEffect(() => {
    const m = window.matchMedia?.(PORTRAIT)
    if (!m) return
    const on = () => setPortrait(m.matches)
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [])
  return portrait
}

// ── Flags (drawn, no emoji) ──────────────────────────────────────

const STRIPES = {
  es: { dir: 'h', parts: [['#AA151B', 1], ['#F1BF00', 2], ['#AA151B', 1]] },
  fr: { dir: 'v', parts: [['#002654', 1], ['#FFFFFF', 1], ['#CE1126', 1]] },
  it: { dir: 'v', parts: [['#009246', 1], ['#FFFFFF', 1], ['#CE2B37', 1]] },
  de: { dir: 'h', parts: [['#000000', 1], ['#DD0000', 1], ['#FFCE00', 1]] },
  nl: { dir: 'h', parts: [['#AE1C28', 1], ['#FFFFFF', 1], ['#21468B', 1]] },
  pl: { dir: 'h', parts: [['#FFFFFF', 1], ['#DC143C', 1]] },
  ca: { dir: 'h', parts: [['#FCDD09', 1], ['#DA121A', 1], ['#FCDD09', 1], ['#DA121A', 1], ['#FCDD09', 1], ['#DA121A', 1], ['#FCDD09', 1], ['#DA121A', 1], ['#FCDD09', 1]] },
  pt: { dir: 'v', parts: [['#006600', 2], ['#FF0000', 3]] },
}

export function Flag({ code }) {
  const id = useId().replace(/:/g, '')
  if (code === 'en') {
    return (
      <svg className="k-flag" viewBox="0 0 60 30" preserveAspectRatio="none" aria-hidden="true">
        <clipPath id={'s' + id}><path d="M0,0 v30 h60 v-30 z" /></clipPath>
        <clipPath id={'t' + id}><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
        <g clipPath={'url(#s' + id + ')'}>
          <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" clipPath={'url(#t' + id + ')'} stroke="#C8102E" strokeWidth="4" />
          <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
          <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
        </g>
      </svg>
    )
  }
  const f = STRIPES[code]
  if (!f) return <span className="k-flag" style={{ background: '#ccc' }} />
  const total = f.parts.reduce((s, p) => s + p[1], 0)
  let at = 0
  return (
    <svg className="k-flag" viewBox="0 0 60 40" preserveAspectRatio="none" aria-hidden="true">
      {f.parts.map(([fill, n], i) => {
        const size = (n / total) * (f.dir === 'h' ? 40 : 60)
        const r = f.dir === 'h' ? <rect key={i} x="0" y={at} width="60" height={size + 0.5} fill={fill} /> : <rect key={i} x={at} y="0" width={size + 0.5} height="40" fill={fill} />
        at += size
        return r
      })}
      {code === 'pt' && <circle cx="24" cy="20" r="7" fill="#FFCC29" stroke="#fff" strokeWidth="1" />}
    </svg>
  )
}

// ── Order types ──────────────────────────────────────────────────

export function TypeIcon({ icon, size = 48 }) {
  if (icon === 'eat_in') return <UtensilsCrossed size={size} strokeWidth={1.6} />
  if (icon === 'take_away') return <ShoppingBag size={size} strokeWidth={1.6} />
  if (icon === 'delivery') return <Bike size={size} strokeWidth={1.6} />
  return null
}

/** A guess at an icon from an order type's name, when the design doesn't pick one. */
export function guessTypeIcon(name) {
  const n = String(name || '').toLowerCase()
  if (/deliver/.test(n)) return 'delivery'
  if (/take|away|out|collect|go\b/.test(n)) return 'take_away'
  if (/eat|in\b|stay|dine|table/.test(n)) return 'eat_in'
  return 'none'
}

// ── Photos ───────────────────────────────────────────────────────

const initials = s => String(s || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

/**
 * A kiosk picture. One with see-through parts (a cut-out PNG) gets k-clear:
 * no picture background, frame or badge behind it, shown whole (clear.js).
 */
export function Pic({ src, className, lazy = false, ...rest }) {
  const clear = useClear(src)
  return <img src={src} alt="" draggable={false} loading={lazy ? 'lazy' : undefined} className={cx(className, clear && 'k-clear')}
    data-clear={clear ? '1' : undefined} {...rest} />
}

// The design colour behind a whole picture (fitLayout() .bg).
const FIT_BG = { surface: 'var(--k-surface)', primary: 'var(--k-primary)', accent: 'var(--k-accent)', text: 'var(--k-text)' }

/**
 * A design picture or video (banner, featured tile, start screen, reach
 * band) in its space as the design's `fit` says (fitLayout() in
 * shared/kiosk.js): filling it with the chosen part in view, or whole,
 * sized and placed, on a design colour. Automatic shows a picture with a
 * see-through background whole. Covers its parent, which sets the size.
 */
export function FitPicture({ src, fit, video = false, className, ...rest }) {
  const clear = useClear(video ? null : src)
  const l = fitLayout(fit, clear)
  const media = { className: cx('block shrink-0', !video && clear && 'k-clear'), style: l.media, ...rest }
  return (
    <span className={cx('absolute inset-0 flex overflow-hidden', className)} style={{ ...l.box, background: l.bg ? FIT_BG[l.bg] : undefined }}
      data-testid="k-fit" data-whole={l.whole ? '1' : '0'} data-focus={l.media.objectPosition}>
      {video
        ? <video src={src} {...media} />
        : <img src={src} alt="" draggable={false} data-clear={clear ? '1' : undefined} {...media} />}
    </span>
  )
}

export function Photo({ src, label, className, phClassName }) {
  if (src) return <Pic src={src} className={className} lazy />
  return <div className={phClassName} aria-hidden="true">{initials(label)}</div>
}

// ── Split photo ──────────────────────────────────────────────────
// The pictures of the guest's picks side by side (shared/kiosk.js
// pickImages() .split): each one covers the whole photo and shows only its own
// part (left, middle, right), with a torn paper edge between the parts.

// The same tear every time for the same number of parts.
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pct = ([x, y]) => x.toFixed(2) + '% ' + y.toFixed(2) + '%'

/** clip-paths for n parts: { slices: [n], tears: [n - 1] } (percent polygons). */
function splitShapes(n) {
  const tears = []
  for (let k = 1; k < n; k++) {
    const rnd = seeded(k * 7919 + n * 104729)
    const x = (k / n) * 100
    const line = []
    for (let y = -2; y <= 102; y += 3.25) {
      const jag = (rnd() - 0.5) * 4.2 + (rnd() < 0.18 ? (rnd() - 0.5) * 5 : 0)
      // The paper's width varies along the tear.
      line.push({ x: x + jag, y, w: 0.55 + rnd() * 0.9 })
    }
    tears.push(line)
  }
  // Neighbouring parts overlap a little under the paper, so no gap shows.
  const edge = (k, side) => (k < 0 || k >= tears.length
    ? [[side < 0 ? -2 : 102, -2], [side < 0 ? -2 : 102, 102]]
    : tears[k].map(p => [p.x + side * 0.4, p.y]))
  const slices = []
  for (let i = 0; i < n; i++) {
    const left = edge(i - 1, -1)
    const right = edge(i, 1)
    slices.push('polygon(' + [...right, ...left.slice().reverse()].map(pct).join(', ') + ')')
  }
  const bands = tears.map(line => 'polygon(' + [
    ...line.map(p => [p.x + p.w, p.y]),
    ...line.slice().reverse().map(p => [p.x - p.w * 0.8, p.y]),
  ].map(pct).join(', ') + ')')
  return { slices, bands }
}

export function SplitPhoto({ srcs, className }) {
  const n = srcs.length
  const shapes = useMemo(() => splitShapes(n), [n])
  return (
    <div className={cx('k-split', className)} data-testid="k-split" data-parts={n}>
      {srcs.map((src, i) => (
        <Pic key={i + ':' + src} src={src} style={{ clipPath: shapes.slices[i] }} />
      ))}
      <div className="k-split-tears" aria-hidden="true">
        {shapes.bands.map((b, i) => <span key={i} style={{ clipPath: b }} />)}
      </div>
    </div>
  )
}

/**
 * The dish's photo with the picks' pictures (shared/kiosk.js pickImages():
 * { split, corner }, each group or step saying which). split: one pick's
 * picture in place of the photo, two or more sharing it (SplitPhoto). corner:
 * small in the photo's corner, on top of whatever the photo is (CornerPicks),
 * so the flavours can split the photo and the dip sit in the corner. No
 * picks: the photo.
 */
export function PickPhoto({ picks, src, label, className, phClassName, splitClassName }) {
  const split = picks?.split || []
  const corner = picks?.corner || []
  const base = split.length >= 2
    ? <SplitPhoto srcs={split} className={corner.length ? cx('k-corner-main', 'w-full h-full') : (splitClassName || className)} />
    : <Photo src={split.length ? split[0] : src} label={label}
        className={corner.length ? cx('k-corner-main', className) : className} phClassName={corner.length ? cx('k-corner-main', phClassName) : phClassName} />
  if (!corner.length) return base
  return <CornerPicks picks={corner} className={splitClassName}>{base}</CornerPicks>
}

/**
 * Pictures small in the bottom corner of what's inside (the dish's photo),
 * in pick order, each framed in its choices' picture style (data-tiles: its
 * group's look, a step's the design's) and as big as its group or step says
 * (cornerWidths()).
 *   picks  [{ src, scale, tiles }] (pickImages() .corner)
 */
export function CornerPicks({ picks, className, children }) {
  const widths = cornerWidths(picks)
  return (
    <div className={cx('k-corner', className)} data-testid="k-corner" data-parts={picks.length}>
      {children}
      <span className="k-corner-picks" aria-hidden="true">
        {picks.map((c, i) => <Pic key={i + ':' + c.src} src={c.src} className="k-corner-pick" style={{ width: widths[i] + '%' }} data-scale={c.scale ?? undefined} data-tiles={c.tiles || 'cards'} />)}
      </span>
    </div>
  )
}

/**
 * A meal deal's picture put together from its picks (design.layout
 * .combo_build; shared/kiosk.js bundleParts(), bundleLayout()): each part's
 * picture in its own square, cut-out pictures as they are, photos in a small
 * frame. A part that wasn't there the last time the picture showed (a new
 * pick, or a dish whose own picks changed) pops in; the others slide over to
 * make room.
 *   parts   bundleParts()
 *   tiles   the dishes' picture style: the box's shape (bundleBox())
 *   seen    { current: Map sig -> when first shown } kept by the builder
 *           across its pages, so back on the deal's picture only what's new
 *           pops in; none = nothing pops (an order line)
 *   square  a square box whatever the style (an order line)
 */
export function BundlePhoto({ parts, tiles = 'cards', seen = null, square = false, className }) {
  const places = bundleLayout(parts, bundleBox(tiles, square))
  const now = Date.now()
  return (
    <div className={cx('k-bundle', className)} data-testid="k-bundle" data-parts={parts.length}>
      {parts.map((p, i) => {
        let fresh = false
        if (seen) {
          if (!seen.current.has(p.sig)) seen.current.set(p.sig, now)
          fresh = now - seen.current.get(p.sig) < 900
        }
        const at = places[i]
        return (
          <span key={p.sig} className={cx('k-bundle-part', fresh && 'k-bundle-new')} data-testid="k-bundle-part" data-size={p.size}
            data-item={p.item_id || undefined} data-new={fresh ? '1' : undefined}
            style={{ left: at.left + '%', top: at.top + '%', width: at.width + '%', height: at.height + '%', zIndex: at.z }}>
            <PickPhoto picks={{ split: p.split, corner: [] }} src={p.src} label="" className="k-bundle-pic" splitClassName="k-bundle-pic" />
          </span>
        )
      })}
    </div>
  )
}

// ── Hexagons ─────────────────────────────────────────────────────
// The design's hexagon tiles (design.layout.tiles 'hexagon'): pointy-top
// hexagons fitting together like a honeycomb.

function useWidth(ref) {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/**
 * Hexagons that lock together like a honeycomb (hexLayout()). cols: a
 * number, or 'auto' (as many as fit at about `target` px wide), at least 2.
 * The menu fills the width; compact (choices) keeps each hexagon at most
 * `maxCell` px wide and keeps a few choices together in two rows; center puts
 * that narrower honeycomb in the middle of the width. Each child is one
 * hexagon (HexTile).
 */
export function HexGrid({ children, cols = 'auto', target = 240, gap = 10, testId, compact = false, maxCell = Infinity, center = false }) {
  const ref = useRef(null)
  const width = useWidth(ref)
  const list = Children.toArray(children)
  const n = Math.max(2, Math.min(8, cols === 'auto' ? Math.floor(width / target) : Number(cols) || 2))
  const layout = hexLayout(list.length, n, compact)
  const w = compact ? Math.min(width * 2 / layout.width, maxCell) : width / n
  const h = w / 0.8660254
  const cells = []
  let i = 0
  layout.rows.forEach((starts, r) => starts.forEach(start => {
    const child = list[i++]
    cells.push(
      <div key={child.key} className="k-hex-cell" data-row={r} data-start={start}
        style={{ gridColumn: start + ' / span 2', gridRow: r + 1, height: h, marginBottom: -h / 4, padding: gap / 2, fontSize: Math.round(Math.max(12, Math.min(26, w * 0.075))) }}>
        {child}
      </div>,
    )
  }))
  const columns = compact ? 'repeat(' + layout.width + ', ' + w / 2 + 'px)' : 'repeat(' + n * 2 + ', minmax(0, 1fr))'
  return (
    <div ref={ref} className="k-hexgrid" style={{ gridTemplateColumns: columns, paddingBottom: h / 4, justifyContent: center ? 'center' : null }}
      data-testid={testId} data-cols={n} data-rows={layout.rows.length} data-center={center ? '1' : undefined}>
      {width > 0 && cells}
    </div>
  )
}

/**
 * One hexagon: the photo fills it, the words sit in a band near the bottom.
 * words: no picture at all, the words in the middle (choices shown words
 * only). on: picked (a ring in the button colour); off: greyed (sold out, or
 * nothing more can be picked). top: small things at the top (dietary marks);
 * extra: buttons beside the hexagon (quick add, one less), outside its shape.
 */
export function HexTile({ src, label, words = false, on = false, off = false, onClick, disabled, testId, attrs = null, pressed, top = null, extra = null, children }) {
  return (
    <>
      <div className={cx('k-hex-ring', on && 'k-hex-on', off && 'k-opt-dis')}>
        <button className={cx('k-hex', words ? 'k-hex-words' : !src && 'k-hex-noimg')} onClick={onClick} disabled={disabled} data-testid={testId} aria-pressed={pressed} {...(attrs || {})}>
          {words ? null : src ? <Pic src={src} lazy className="k-hex-img" /> : <span className="k-hex-ph" aria-hidden="true">{initials(label)}</span>}
          {top && <span className="k-hex-top">{top}</span>}
          <span className="k-hex-band">{children}</span>
        </button>
      </div>
      {extra}
    </>
  )
}

// ── Levels (heat) ────────────────────────────────────────────────

// Flames get hotter with the level (amber to red), whatever the brand colours.
const HEAT = ['#f59f00', '#f59f00', '#f76707', '#f03e3e', '#d6336c']

export function Levels({ level, icon = 'flame', max = 5, size = 16 }) {
  if (level == null) return null
  const Icon = icon === 'star' ? Star : icon === 'dot' ? Circle : Flame
  const on = icon === 'flame' ? HEAT[Math.max(0, Math.min(HEAT.length - 1, level - 1))] : icon === 'dot' ? 'var(--k-primary)' : 'var(--k-accent)'
  return (
    <span className="inline-flex items-center gap-[2px]" aria-label={level + ' / ' + max}>
      {Array.from({ length: max }).map((_, i) => (
        <Icon key={i} size={size} strokeWidth={2.2}
          style={{ color: i < level ? on : 'var(--k-line)', fill: i < level ? on : 'transparent' }} />
      ))}
    </span>
  )
}

/**
 * Scroll only the nearest kiosk scroll box (k-scroll, or k-hscroll for
 * axis 'x') so el sits in its middle. Unlike scrollIntoView() this never
 * moves the kiosk frame itself.
 */
export function bringIntoView(el, axis = 'y') {
  const box = el?.parentElement?.closest(axis === 'x' ? '.k-hscroll' : '.k-scroll')
  if (!box) return
  const r = box.getBoundingClientRect()
  const b = el.getBoundingClientRect()
  if (axis === 'x') box.scrollBy({ left: b.left + b.width / 2 - (r.left + r.width / 2), behavior: 'smooth' })
  else box.scrollBy({ top: b.top - r.top - Math.max(0, (r.height - b.height) / 2), behavior: 'smooth' })
}

// ── Quantity ─────────────────────────────────────────────────────

export function Stepper({ value, onChange, min = 1, max = 99, labels = {} }) {
  return (
    <div className="inline-flex items-center gap-3">
      <button className="k-btn k-btn-round" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={labels.less || 'One less'}><Minus /></button>
      <span className="k-head text-[1.5em] min-w-[1.6em] text-center tabular-nums" data-testid="qty">{value}</span>
      <button className="k-btn k-btn-round" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={labels.more || 'One more'}><Plus /></button>
    </div>
  )
}

// ── Sheets ───────────────────────────────────────────────────────

// A tap on the dim background closes it: on click, not pointerdown, so the
// tap can't fall through to whatever is under the sheet once it has gone.
export function Sheet({ children, onClose, wide = false }) {
  return (
    <div className="k-overlay k-fade" onClick={e => { if (e.target === e.currentTarget && onClose) onClose() }}>
      <div className="k-sheet" style={wide ? { maxWidth: 1000 } : null}>{children}</div>
    </div>
  )
}

// ── Keyboard and number pad ──────────────────────────────────────

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']
const EXTRA = {
  es: 'ÑÁÉÍÓÚÜ', ca: 'ÇÀÈÉÍÏÒÓÚ', fr: 'ÉÈÊÀÇÔÙË', de: 'ÄÖÜß', it: 'ÀÈÉÌÒÙ', pt: 'ÃÁÂÀÇÉÊÍÓÔÕÚ', nl: 'ËÏÉ', pl: 'ĄĆĘŁŃÓŚŹŻ',
}

/** Letters for a name: value is the text, onChange gets the new text. */
export function Keyboard({ value, onChange, lang = 'en', max = 40, labels = {} }) {
  const type = ch => {
    if (value.length >= max) return
    const next = value + (value && !/\s$/.test(value) ? ch.toLowerCase() : ch)
    onChange(next)
  }
  const extra = EXTRA[lang]
  return (
    // data-jprivate: a touch here is recorded at the keyboard's middle, never on a key (journey.js).
    <div className="k-keys" data-testid="keyboard" data-jprivate="">
      {extra && <div className="k-keys-row">{[...extra].map(c => <button key={c} className="k-key" onClick={() => type(c)}>{c}</button>)}</div>}
      {ROWS.map(r => (
        <div key={r} className="k-keys-row">{[...r].map(c => <button key={c} className="k-key" onClick={() => type(c)}>{c}</button>)}</div>
      ))}
      <div className="k-keys-row">
        <button className="k-key" onClick={() => type('-')}>-</button>
        <button className="k-key k-key-wide" onClick={() => value && !/\s$/.test(value) && value.length < max && onChange(value + ' ')}>{labels.space || 'Space'}</button>
        <button className="k-key" onClick={() => onChange(value.slice(0, -1))} aria-label={labels.delete || 'Delete'}><Delete className="mx-auto" /></button>
      </div>
    </div>
  )
}

const MAIL_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const MAIL_ENDS = ['@gmail.com', '@hotmail.com', '@outlook.com', '@icloud.com', '.com', '.co.uk']

/** Keys for an email address: lower case letters, digits, @ and the usual endings. */
export function EmailKeyboard({ value, onChange, max = 120, labels = {} }) {
  const type = txt => { if ((value + txt).length <= max) onChange(value + txt) }
  const at = value.includes('@')
  return (
    // data-jprivate: a touch here is recorded at the keyboard's middle, never on a key (journey.js).
    <div className="k-keys" data-testid="email-keyboard" data-jprivate="">
      {MAIL_ROWS.map(r => (
        <div key={r} className="k-keys-row">{[...r].map(c => <button key={c} className="k-key" onClick={() => type(c)}>{c}</button>)}</div>
      ))}
      <div className="k-keys-row">
        {['@', '.', '-', '_'].map(c => <button key={c} className="k-key" disabled={c === '@' && at} onClick={() => type(c)} data-key={c}>{c}</button>)}
        <button className="k-key" onClick={() => onChange(value.slice(0, -1))} aria-label={labels.delete || 'Delete'}><Delete className="mx-auto" /></button>
      </div>
      <div className="k-keys-row flex-wrap">
        {MAIL_ENDS.filter(e => (e.startsWith('@') ? !at : at)).map(e => (
          <button key={e} className="k-key k-key-wide" onClick={() => type(e)} data-key={e}>{e}</button>
        ))}
      </div>
    </div>
  )
}

export function NumberPad({ value, onChange, max = 4, labels = {} }) {
  const press = k => {
    if (k === 'del') return onChange(value.slice(0, -1))
    if (k === 'clear') return onChange('')
    if (value.length >= max) return
    onChange(value + k)
  }
  return (
    <div className="k-numpad" data-testid="numpad" data-jprivate="">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'].map(k => (
        <button key={k} className="k-key" onClick={() => press(k)} aria-label={k === 'del' ? labels.delete || 'Delete' : undefined} data-key={k}>
          {k === 'del' ? <Delete className="mx-auto" size={30} /> : k === 'clear' ? labels.clear || 'Clear' : <span className="k-numpad-digit">{k}</span>}
        </button>
      ))}
    </div>
  )
}
