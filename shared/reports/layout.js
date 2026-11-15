// shared/reports/layout.js
//
// A layout template: how a report looks on paper (docs/REPORTS.md 11).
// Settings, not a canvas. One set of rules for the API (the print page,
// api/src/reports/export/print.js), the admin's layout editor and its lists.
//
//   normaliseLayout(raw)      the one known shape from anything; never throws
//   BUILT_IN                  the layout a group has before it makes one: the
//                             print page exactly as it was before layouts
//   paperBox(page)            the room a table has, upright and on its side:
//                             { portrait: { fit, mm }, landscape: { fit, mm } }
//                             (fit: px to measure columns against; mm: the
//                             sheet's width on screen)
//   pageRule(page, way)       { size, margin } for the @page rule
//   negativeText(text, how)   a negative as the layout writes it
//   isNegative(text)          whether a cell's words are a negative figure
//   cssString(text)           words as a CSS string for a page's margin box
//   layoutWords(layout)       the layout in a line, for lists
//
// The paper: 'auto' leaves the paper to the print window (the page only says
// which way round it is) and measures against the narrower of A4 and Letter
// each way, so a table that fits prints on either.

export const PAPER_SIZES = ['auto', 'a4', 'letter']
export const PAPER_LABELS = { auto: 'The printer\'s own', a4: 'A4', letter: 'Letter' }
export const WAYS = ['auto', 'portrait', 'landscape']
export const WAY_LABELS = { auto: 'Whichever fits', portrait: 'Upright', landscape: 'On its side' }
export const MARGINS = ['narrow', 'normal', 'wide']
export const MARGIN_LABELS = { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' }
export const MARGIN_MM = {
  narrow: { top: 8, side: 6, bottom: 10 },
  normal: { top: 12, side: 10, bottom: 14 },
  wide: { top: 18, side: 16, bottom: 20 },
}
export const DENSITIES = ['compact', 'normal', 'roomy']
export const DENSITY_LABELS = { compact: 'Compact', normal: 'Normal', roomy: 'Roomy' }
export const NEGATIVES = ['minus', 'brackets', 'red']
export const NEGATIVE_LABELS = { minus: 'With a minus: -£12.50', brackets: 'In brackets: (£12.50)', red: 'In red: -£12.50' }
export const HEADER_PARTS = ['logo', 'group', 'about', 'period', 'choices', 'run']
export const HEADER_LABELS = {
  logo: 'Logo',
  group: 'The group\'s name',
  about: 'The report\'s description',
  period: 'The period',
  choices: 'Venues, other choices and how many rows',
  run: 'When the figures were read, and who printed it',
}
export const LAYOUT_LIMITS = { name: 60, footer: 160, front: 1200, layouts: 20 }

// Whole millimetres: A4 is 210 x 297, Letter 215.9 x 279.4.
const PAPER_MM = { a4: { w: 210, h: 297 }, letter: { w: 216, h: 279 } }
const PX_PER_MM = 96 / 25.4

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback)
const flag = (v, fallback) => (typeof v === 'boolean' ? v : fallback)
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
// Words someone typed, on one line or a few: no control characters.
function words(v, max, lines = false) {
  if (typeof v !== 'string') return ''
  const s = lines
    ? v.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n')
    : v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ')
  return s.trim().slice(0, max).trim()
}

export function normaliseLayout(raw) {
  const r = obj(raw)
  const page = obj(r.page), header = obj(r.header), footer = obj(r.footer), style = obj(r.style), front = obj(r.front)
  const text = words(front.text, LAYOUT_LIMITS.front, true)
  return {
    page: {
      size: pick(page.size, PAPER_SIZES, 'auto'),
      way: pick(page.way, WAYS, 'auto'),
      margin: pick(page.margin, MARGINS, 'normal'),
    },
    header: Object.fromEntries(HEADER_PARTS.map(k => [k, flag(header[k], true)])),
    footer: { numbers: flag(footer.numbers, true), text: words(footer.text, LAYOUT_LIMITS.footer) },
    style: {
      brand: flag(style.brand, false),
      density: pick(style.density, DENSITIES, 'normal'),
      stripes: flag(style.stripes, false),
      negatives: pick(style.negatives, NEGATIVES, 'minus'),
    },
    front: { on: flag(front.on, false), text },
  }
}

export const BUILT_IN = Object.freeze(normaliseLayout({}))

/** The room a table has each way round, for a layout's page (normalised). */
export function paperBox(page) {
  const m = MARGIN_MM[page.margin] || MARGIN_MM.normal
  const of = size => ({ portrait: PAPER_MM[size].w, landscape: PAPER_MM[size].h })
  const a4 = of('a4'), letter = of('letter')
  const box = way => {
    const paper = page.size === 'auto' ? Math.min(a4[way], letter[way]) : of(page.size)[way]
    const sheet = page.size === 'auto' ? a4[way] : paper
    return { fit: Math.round((paper - 2 * m.side) * PX_PER_MM), mm: sheet - 2 * m.side }
  }
  return { portrait: box('portrait'), landscape: box('landscape') }
}

/** The @page rule's size and margin for a layout's page, a given way round. */
export function pageRule(page, way) {
  const m = MARGIN_MM[page.margin] || MARGIN_MM.normal
  const round = way === 'landscape' ? 'landscape' : 'portrait'
  return {
    size: page.size === 'auto' ? round : (page.size === 'a4' ? 'A4 ' : 'letter ') + round,
    margin: m.top + 'mm ' + m.side + 'mm ' + m.bottom + 'mm',
  }
}

const MINUS = /^[-\u2212]/

/** Whether a cell's words are a negative figure (a hyphen or a real minus sign in front of a digit or a currency sign). */
export const isNegative = text => typeof text === 'string' && MINUS.test(text) && /[\d£$€]/.test(text.slice(1, 3))

/** A negative as the layout writes it: brackets take the sign off, the others leave the words alone. */
export function negativeText(text, how) {
  return how === 'brackets' && isNegative(text) ? '(' + text.slice(1) + ')' : text
}

/** Words as a CSS string (double-quoted) that can't end the string, the rule or the style element. */
export function cssString(text) {
  return '"' + String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\"<>&]/g, ch => '\\' + ch.codePointAt(0).toString(16) + ' ') + '"'
}

/** The layout in a line: "A4, upright · no logo · striped · negatives in brackets". */
export function layoutWords(raw) {
  const l = normaliseLayout(raw)
  const out = []
  const paper = l.page.size === 'auto' ? null : PAPER_LABELS[l.page.size]
  const way = l.page.way === 'auto' ? null : WAY_LABELS[l.page.way].toLowerCase()
  if (paper || way) out.push([paper, way].filter(Boolean).join(', '))
  if (l.page.margin !== 'normal') out.push(MARGIN_LABELS[l.page.margin].toLowerCase() + ' margins')
  const off = HEADER_PARTS.filter(k => !l.header[k])
  if (off.length) out.push('header without ' + off.length + (off.length === 1 ? ' part' : ' parts'))
  if (l.front.on) out.push('front page')
  if (l.style.brand) out.push('brand colour')
  if (l.style.density !== 'normal') out.push(DENSITY_LABELS[l.style.density].toLowerCase() + ' rows')
  if (l.style.stripes) out.push('striped')
  if (l.style.negatives === 'brackets') out.push('negatives in brackets')
  if (l.style.negatives === 'red') out.push('negatives in red')
  if (l.footer.text) out.push('footer words')
  if (!l.footer.numbers) out.push('no page numbers')
  return out.length ? out.join(' · ').replace(/^./, c => c.toUpperCase()) : 'As reports print without a layout'
}
