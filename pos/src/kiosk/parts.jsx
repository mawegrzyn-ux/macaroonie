// Small pieces the kiosk's screens share: flags, order type icons, photos
// with a stand-in, heat levels, the quantity stepper, sheets, the on-screen
// keyboard and number pad (kiosk browsers often hide the device's own).

import { useEffect, useId, useState } from 'react'
import { UtensilsCrossed, ShoppingBag, Bike, Flame, Star, Circle, Minus, Plus, Delete } from 'lucide-react'

export const cx = (...p) => p.filter(Boolean).join(' ')

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

export function Photo({ src, label, className, phClassName }) {
  if (src) return <img src={src} alt="" className={className} loading="lazy" draggable={false} />
  return <div className={phClassName} aria-hidden="true">{initials(label)}</div>
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
    <div className="k-keys" data-testid="keyboard">
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

export function NumberPad({ value, onChange, max = 4, labels = {} }) {
  const press = k => {
    if (k === 'del') return onChange(value.slice(0, -1))
    if (k === 'clear') return onChange('')
    if (value.length >= max) return
    onChange(value + k)
  }
  return (
    <div className="k-numpad" data-testid="numpad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'].map(k => (
        <button key={k} className="k-key" onClick={() => press(k)} aria-label={k === 'del' ? labels.delete || 'Delete' : undefined} data-key={k}>
          {k === 'del' ? <Delete className="mx-auto" size={30} /> : k === 'clear' ? labels.clear || 'Clear' : <span className="k-numpad-digit">{k}</span>}
        </button>
      ))}
    </div>
  )
}
