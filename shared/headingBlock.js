// shared/headingBlock.js
//
// The website Heading block: one implementation of its styles, used by
// the live site (api/src/views/site/blocks/heading.eta, through
// siteRenderer.js's `siteBlocks` helper) and the page-builder canvas
// (admin HeadingCanvas in canvas/blockCanvas.jsx), so the preview can't
// drift from what publishes. Plain ESM, no dependencies.
//
// Block data (defaults in HEADING_DEFAULTS):
//   heading, eyebrow (small line above), subheading (line below)
//   level        h1 | h2 | h3 | h4       the HTML tag (page outline / SEO)
//   size         auto | sm | md | lg | xl | xxl   auto = by level
//   align        left | center | right
//   font_family  '' = theme heading font, '@body' = theme body font,
//                or a Google Font name from shared/fonts.js
//   font_weight  '' = theme heading weight, or 300..900
//   italic, uppercase   booleans
//   colour, sub_colour, decoration_colour, background   theme role names
//                ('' = default for each)
//   decoration   none | bar | rules
//   spacing      sm | md | lg            space above and below
//   container, boxed_step                shared with every sectional block

import { fontStack } from './fonts.js'

export const HEADING_DEFAULTS = {
  heading: 'Section heading',
  eyebrow: '',
  subheading: '',
  level: 'h2',
  size: 'auto',
  align: 'center',
  font_family: '',
  font_weight: '',
  italic: false,
  uppercase: false,
  colour: '',
  sub_colour: '',
  decoration: 'none',
  decoration_colour: '',
  background: '',
  spacing: 'md',
  container: 'boxed',
}

export const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4']

// Theme role -> CSS variable. The page defines --c-bg, not --c-background.
const ROLE_VAR = {
  primary: '--c-primary', accent: '--c-accent', background: '--c-bg',
  surface: '--c-surface', text: '--c-text', muted: '--c-muted', border: '--c-border',
}
function roleColour(v, fallback) {
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return v
  return ROLE_VAR[v] ? 'var(' + ROLE_VAR[v] + ')' : fallback
}

// Large sizes shrink on narrow screens (vw cap) so a long word still fits.
const SIZE = {
  sm:  'var(--fs-h3, 24px)',
  md:  'var(--fs-h2, 32px)',
  lg:  'min(var(--fs-h1, 40px), 9vw)',
  xl:  'min(calc(var(--fs-h1, 40px) * 1.35), 11vw)',
  xxl: 'min(calc(var(--fs-h1, 40px) * 1.8), 13vw)',
}
const AUTO_SIZE = { h1: 'lg', h2: 'md', h3: 'sm', h4: null }
const H4_SIZE = 'calc(var(--fs-base, 16px) * 1.15)'
const SPACING = { sm: '24px', md: '48px', lg: '80px' }
const CONTAINER_MAX = { boxed: 'var(--cw)', wide: '1400px', full: 'none' }
const WEIGHTS = new Set(['300', '400', '500', '600', '700', '800', '900'])

/** The Google Font the block itself needs loaded, or null. */
export function headingFont(d) {
  const f = String(d?.font_family || '').trim()
  return f && f !== '@body' ? f : null
}

/**
 * Everything needed to render the block, as plain objects of CSS
 * properties (kebab-case) plus the tag and a few flags. `styleString()`
 * turns one into an inline style attribute, `styleObject()` into a React
 * style prop.
 */
export function headingLayout(data) {
  const d = { ...HEADING_DEFAULTS, ...(data || {}) }
  const level = HEADING_LEVELS.includes(d.level) ? d.level : 'h2'
  const align = ['left', 'center', 'right'].includes(d.align) ? d.align : 'center'
  const sizeKey = d.size && d.size !== 'auto' ? d.size : AUTO_SIZE[level]
  const fontSize = SIZE[sizeKey] || H4_SIZE
  const custom = headingFont(d)
  const fontFamily = custom ? fontStack(custom)
    : d.font_family === '@body' ? 'var(--f-body)' : 'var(--f-heading)'
  const colour = roleColour(d.colour, 'var(--c-primary)')
  const decoColour = roleColour(d.decoration_colour, 'var(--c-accent)')
  const bg = roleColour(d.background, null)
  const pad = d.boxed_step ? 'var(--boxed-step-' + Number(d.boxed_step) + ')' : 'var(--boxed-pad, 24px)'
  const spaceY = SPACING[d.spacing] || SPACING.md
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
  const decoration = ['bar', 'rules'].includes(d.decoration) ? d.decoration : 'none'

  const section = {
    'padding-top': spaceY, 'padding-bottom': spaceY,
    ...(bg ? { background: bg } : {}),
  }
  const inner = d.container === 'full'
    ? { width: '100%', 'padding-left': pad, 'padding-right': pad, 'box-sizing': 'border-box' }
    : { 'max-width': CONTAINER_MAX[d.container] || CONTAINER_MAX.boxed, margin: '0 auto',
        'padding-left': pad, 'padding-right': pad, 'box-sizing': 'border-box' }
  inner['text-align'] = align

  const heading = {
    'font-family': fontFamily,
    'font-size': fontSize,
    'font-weight': WEIGHTS.has(String(d.font_weight)) ? String(d.font_weight) : 'var(--fw-heading, 700)',
    'font-style': d.italic ? 'italic' : 'normal',
    'text-transform': d.uppercase ? 'uppercase' : 'none',
    'letter-spacing': d.uppercase ? '0.04em' : 'normal',
    'line-height': '1.15',
    color: colour,
    margin: '0',
    'overflow-wrap': 'break-word',
    ...(decoration === 'rules' ? { flex: '0 1 auto' } : {}),
  }
  const eyebrow = {
    'font-family': 'var(--f-body)', 'font-size': '0.8rem', 'font-weight': '700',
    'letter-spacing': '0.14em', 'text-transform': 'uppercase',
    color: roleColour(d.decoration_colour, 'var(--c-accent)'), margin: '0 0 10px',
  }
  const sub = {
    'font-family': 'var(--f-body)', 'font-size': 'calc(var(--fs-base, 16px) * 1.15)',
    'line-height': '1.5', color: roleColour(d.sub_colour, 'var(--c-muted)'),
    margin: '14px 0 0',
    ...(align === 'center' ? { 'max-width': '680px', 'margin-left': 'auto', 'margin-right': 'auto' } : {}),
    ...(align === 'right' ? { 'max-width': '680px', 'margin-left': 'auto' } : {}),
  }
  const bar = {
    width: '56px', height: '3px', background: decoColour, 'border-radius': '2px',
    'margin-top': '16px',
    'margin-left': align === 'left' ? '0' : 'auto',
    'margin-right': align === 'right' ? '0' : 'auto',
  }
  const rulesRow = { display: 'flex', 'align-items': 'center', gap: '20px', 'justify-content': justify }
  const rule = { flex: '1 1 0', 'min-width': '24px', height: '1px', background: decoColour }

  return {
    tag: level, align, decoration,
    ruleLeft: decoration === 'rules' && align !== 'left',
    ruleRight: decoration === 'rules' && align !== 'right',
    font: custom,
    styles: { section, inner, heading, eyebrow, sub, bar, rulesRow, rule },
  }
}

/** { 'font-size': '2rem' } -> "font-size:2rem;" */
export function styleString(obj) {
  return Object.entries(obj || {}).map(([k, v]) => k + ':' + v + ';').join('')
}

/** { 'font-size': '2rem' } -> { fontSize: '2rem' } */
export function styleObject(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) out[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v
  return out
}
