// shared/themeKit.js
//
// Themes made from a picture and a few words (the theme maker: Website >
// Brand & theme, the kiosk designer, the menu screen designer and the
// printed menu designer). A kit is one look every designer can take:
//
//   {
//     name, about,                      a short name and one line on the look
//     colors: { background, surface, text, muted, border,
//               primary, primary_text, accent, accent_text },
//     fonts:  { heading, body, script,  from the website's list (shared/fonts.js)
//               display },              a bold face for big screens (kiosks,
//                                       menu boards); '' = the heading font
//     shape:  'square' | 'soft' | 'round',
//     heading_case: 'upper' | 'normal',
//     source: 'ai' | 'picture' | 'current' | 'recent',
//   }
//
// normaliseKit() is the only way a kit is made: it checks every value and
// makes text readable on what it sits on. The *FromKit() mappers turn a kit
// into each designer's own settings (keeping everything a kit doesn't
// cover), and kitFrom*() describe a designer's current look as a kit (sent
// to Pepper so "make it warmer" has something to start from). Plain ESM, no
// DOM: extractPalette() takes the pixels the browser read from a canvas.

import { FONT_OPTIONS, FONT_WEIGHTS } from './fonts.js'

export const KIT_COLORS = ['background', 'surface', 'text', 'muted', 'border', 'primary', 'primary_text', 'accent', 'accent_text']
export const KIT_SHAPES = ['square', 'soft', 'round']
export const HEADING_CASES = ['upper', 'normal']
// Bold faces kiosks and menu boards can use on top of the website's list.
export const DISPLAY_FONT_WEIGHTS = {
  'Oswald':           '300;400;500;600;700',
  'Bebas Neue':       '400',
  'Anton':            '400',
  'Barlow Condensed': '300;400;500;600;700;800',
  'Archivo Black':    '400',
}
export const DISPLAY_FONTS = Object.keys(DISPLAY_FONT_WEIGHTS)
export const KIT_TARGETS = ['website', 'kiosk', 'board', 'print']
// The paper a printed menu is drawn on (shared/menuLayout.js MENU_LAYOUT_CSS).
export const PRINT_PAPER = '#faf6ef'

const DEFAULT_KIT_COLORS = {
  background: '#ffffff', surface: '#f6f4f1', text: '#1a1a1a', muted: '#666666', border: '#e5e2dc',
  primary: '#630812', primary_text: '#ffffff', accent: '#e8a87c', accent_text: '#1a1a1a',
}

// ── Colour maths ────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function isHexColour(v) { return typeof v === 'string' && HEX.test(v.trim()) }

/** '#abc' / '#aabbcc' -> [r, g, b] (0-255), or null. */
export function rgbOf(hex) {
  if (!isHexColour(hex)) return null
  let h = hex.trim().slice(1)
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function hexOf(rgb) {
  return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** Lower-case #rrggbb, or the fallback. */
export function cleanHex(v, fallback = null) {
  const rgb = rgbOf(v)
  return rgb ? hexOf(rgb) : fallback
}

/** WCAG relative luminance (0 black - 1 white). */
export function luminance(hex) {
  const rgb = rgbOf(hex) || [0, 0, 0]
  const c = rgb.map(v => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** WCAG contrast ratio of two colours (1 - 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** a with t (0-1) of b mixed in. */
export function mix(a, b, t) {
  const x = rgbOf(a) || [0, 0, 0], y = rgbOf(b) || [0, 0, 0]
  return hexOf(x.map((v, i) => v + (y[i] - v) * t))
}

/** Near-black or white, whichever reads better on bg. */
export function inkOn(bg) {
  return contrast('#111111', bg) >= contrast('#ffffff', bg) ? '#111111' : '#ffffff'
}

/** [h 0-360, s 0-1, l 0-1] */
export function hslOf(hex) {
  const [r, g, b] = (rgbOf(hex) || [0, 0, 0]).map(v => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

export function hexFromHsl(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360
  const sat = Math.max(0, Math.min(1, s)), lig = Math.max(0, Math.min(1, l))
  if (sat === 0) return hexOf([lig * 255, lig * 255, lig * 255])
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat
  const p = 2 * lig - q
  const f = t => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return hexOf([f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255])
}

/** The same colour lighter or darker (keeps its hue). */
export function withLightness(hex, l) {
  const [h, s] = hslOf(hex)
  return hexFromHsl(h, s, l)
}

/**
 * fg moved lighter or darker, keeping its hue, until it reaches `min` to 1
 * against bg; near-black or white when no shade of it does.
 */
export function readableOn(fg, bg, min = 4.5) {
  const col = cleanHex(fg, '#111111')
  if (contrast(col, bg) >= min) return col
  const [h, s, l] = hslOf(col)
  const darker = luminance(bg) > 0.18
  for (let i = 1; i <= 50; i++) {
    const next = hexFromHsl(h, s, darker ? l - i * 0.02 : l + i * 0.02)
    if (contrast(next, bg) >= min) return next
  }
  const ink = inkOn(bg)
  return contrast(ink, bg) >= min ? ink : (darker ? '#000000' : '#ffffff')
}

const hueGap = (a, b) => {
  const d = Math.abs(hslOf(a)[0] - hslOf(b)[0]) % 360
  return d > 180 ? 360 - d : d
}

// ── Palette from a picture ──────────────────────────────────────

/**
 * The main colours of a picture: pixels as RGBA bytes (a canvas's
 * ImageData.data). Median cut into up to 16 groups, near colours merged,
 * biggest first: [{ hex, share (0-1), h, s, l }]. Transparent pixels (a
 * logo's background) don't count.
 */
export function extractPalette(pixels, { count = 8, maxSamples = 16000 } = {}) {
  const total = Math.floor((pixels?.length || 0) / 4)
  if (!total) return []
  const step = Math.max(1, Math.floor(total / maxSamples))
  const pts = []
  for (let i = 0; i < total; i += step) {
    const o = i * 4
    if (pixels[o + 3] < 128) continue
    pts.push([pixels[o], pixels[o + 1], pixels[o + 2]])
  }
  if (!pts.length) return []
  const rangeOf = box => {
    let best = 0, ch = 0
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0
      for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c] }
      if (hi - lo > best) { best = hi - lo; ch = c }
    }
    return { range: best, ch }
  }
  let boxes = [pts]
  while (boxes.length < 16) {
    let pick = -1, score = 0, chan = 0
    boxes.forEach((b, i) => {
      if (b.length < 2) return
      const { range, ch } = rangeOf(b)
      const s = range * Math.sqrt(b.length)
      if (range > 8 && s > score) { score = s; pick = i; chan = ch }
    })
    if (pick < 0) break
    const box = boxes[pick].slice().sort((a, b) => a[chan] - b[chan])
    const mid = box.length >> 1
    boxes = [...boxes.slice(0, pick), box.slice(0, mid), box.slice(mid), ...boxes.slice(pick + 1)]
  }
  let groups = boxes.filter(b => b.length).map(b => {
    const sum = [0, 0, 0]
    for (const p of b) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2] }
    return { rgb: sum.map(v => v / b.length), n: b.length }
  })
  // Merge colours closer than ~6% of the RGB cube.
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 26
  const merged = []
  for (const g of groups.sort((a, b) => b.n - a.n)) {
    const into = merged.find(m => near(m.rgb, g.rgb))
    if (!into) { merged.push({ ...g }); continue }
    const n = into.n + g.n
    into.rgb = into.rgb.map((v, i) => (v * into.n + g.rgb[i] * g.n) / n)
    into.n = n
  }
  groups = merged.sort((a, b) => b.n - a.n).slice(0, count)
  return groups.map(g => {
    const hex = hexOf(g.rgb)
    const [h, s, l] = hslOf(hex)
    return { hex, share: Math.round((g.n / pts.length) * 1000) / 1000, h: Math.round(h), s: Math.round(s * 100) / 100, l: Math.round(l * 100) / 100 }
  })
}

// ── Kits ────────────────────────────────────────────────────────

const text = (v, n) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '')
const oneOf = (v, list, d) => (list.includes(v) ? v : d)

/**
 * A kit with every value checked and readable colours: text on the page and
 * on cards at least 4.5 to 1, quiet text 3 to 1, button and highlight text
 * 4.5 to 1 on their colours, buttons 3 to 1 against the page.
 */
export function normaliseKit(raw, { source } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const rc = r.colors && typeof r.colors === 'object' ? r.colors : {}
  const c = {}
  for (const k of KIT_COLORS) c[k] = cleanHex(rc[k], null)
  c.background = c.background || DEFAULT_KIT_COLORS.background
  c.surface = c.surface || mix(c.background, inkOn(c.background), 0.05)
  c.primary = c.primary || DEFAULT_KIT_COLORS.primary
  c.accent = c.accent || mix(c.primary, c.background, 0.45)
  c.text = readableOn(c.text || inkOn(c.background), c.background, 4.5)
  if (contrast(c.text, c.surface) < 4.5) c.text = readableOn(c.text, c.surface, 4.5)
  c.muted = readableOn(c.muted || mix(c.text, c.background, 0.4), c.background, 3)
  if (contrast(c.muted, c.surface) < 3) c.muted = readableOn(c.muted, c.surface, 3)
  c.border = c.border || mix(c.text, c.background, 0.85)
  c.primary = readableOn(c.primary, c.background, 3)
  c.primary_text = readableOn(c.primary_text || inkOn(c.primary), c.primary, 4.5)
  c.accent_text = readableOn(c.accent_text || inkOn(c.accent), c.accent, 4.5)

  const f = r.fonts && typeof r.fonts === 'object' ? r.fonts : {}
  const heading = oneOf(f.heading, FONT_OPTIONS, 'Playfair Display')
  return {
    name: text(r.name, 40) || 'Theme',
    about: text(r.about, 200),
    colors: c,
    fonts: {
      heading,
      body: oneOf(f.body, FONT_OPTIONS, 'Inter'),
      script: oneOf(f.script, FONT_OPTIONS, 'Caveat'),
      display: f.display && (DISPLAY_FONTS.includes(f.display) || FONT_OPTIONS.includes(f.display)) ? f.display : '',
    },
    shape: oneOf(r.shape, KIT_SHAPES, 'soft'),
    heading_case: oneOf(r.heading_case, HEADING_CASES, 'normal'),
    source: oneOf(source || r.source, ['ai', 'picture', 'current', 'recent'], 'ai'),
  }
}

/** Is the kit's page dark? */
export function isDarkKit(kit) { return luminance(kit.colors.background) < 0.2 }

/** Google Fonts stylesheet for kits' fonts (null when none can load). */
export function kitFontsUrl(kits) {
  const names = [...new Set((kits || []).flatMap(k => [k?.fonts?.heading, k?.fonts?.body, k?.fonts?.script, k?.fonts?.display]))]
    .filter(n => n && (FONT_WEIGHTS[n] || DISPLAY_FONT_WEIGHTS[n]))
  if (!names.length) return null
  return 'https://fonts.googleapis.com/css2?' + names.map(n =>
    'family=' + encodeURIComponent(n).replace(/%20/g, '+') + ':wght@' + (FONT_WEIGHTS[n] || DISPLAY_FONT_WEIGHTS[n])).join('&') + '&display=swap'
}

/**
 * Three kits from a picture's palette alone (no AI): light, dark and bold.
 * Used when Pepper isn't available, and as a first look while it works.
 */
export function kitsFromPalette(palette) {
  const list = (palette || []).filter(p => isHexColour(p.hex))
  if (!list.length) return []
  const info = list.map(p => {
    const [h, s, l] = hslOf(p.hex)
    return { hex: cleanHex(p.hex), share: p.share || 0, h, s, l }
  })
  const vivid = info.filter(p => p.s >= 0.22 && p.l >= 0.12 && p.l <= 0.86)
    .sort((a, b) => (Math.sqrt(b.share) * b.s) - (Math.sqrt(a.share) * a.s))
  const darkest = info.slice().sort((a, b) => a.l - b.l)[0]
  const brand = vivid[0]?.hex || (darkest.l < 0.9 ? darkest.hex : '#334155')
  const second = vivid.find(p => hueGap(p.hex, brand) >= 30)?.hex
    || hexFromHsl(hslOf(brand)[0] + 35, Math.max(0.45, hslOf(brand)[1]), 0.6)
  const pale = info.find(p => p.l >= 0.92 && p.s < 0.35)?.hex
  const [bh, bs] = hslOf(brand)

  const lightBg = pale || mix('#ffffff', brand, 0.03)
  const lightButton = contrast(brand, '#ffffff') >= 4.5 ? brand : readableOn(brand, '#ffffff', 4.5)
  const light = normaliseKit({
    name: 'Light from your picture',
    about: 'A light page with your picture\'s main colour on buttons and headings.',
    colors: {
      background: lightBg, surface: mix(lightBg, brand, 0.06), text: hexFromHsl(bh, Math.min(bs, 0.3), 0.12),
      primary: lightButton, accent: second,
    },
    fonts: { heading: 'Playfair Display', body: 'Inter', script: 'Caveat', display: '' },
    shape: 'soft', heading_case: 'normal',
  }, { source: 'picture' })

  const darkBg = darkest.l <= 0.16 ? darkest.hex : hexFromHsl(bh, Math.min(bs, 0.35), 0.09)
  const dark = normaliseKit({
    name: 'Dark from your picture',
    about: 'A dark, moody page; your colours stand out on it.',
    colors: {
      background: darkBg, surface: withLightness(darkBg, Math.min(0.24, hslOf(darkBg)[2] + 0.06)),
      text: hexFromHsl(bh, 0.12, 0.95), primary: brand, accent: second,
    },
    fonts: { heading: 'Montserrat', body: 'Inter', script: 'Caveat', display: 'Oswald' },
    shape: 'square', heading_case: 'upper',
  }, { source: 'picture' })

  const boldBg = luminance(brand) < 0.18 ? brand : hexFromHsl(bh, Math.max(bs, 0.5), 0.3)
  const boldInk = inkOn(boldBg)
  const bold = normaliseKit({
    name: 'Bold from your picture',
    about: 'Your main colour across the whole page, for a loud, confident look.',
    colors: {
      background: boldBg, surface: mix(boldBg, boldInk, 0.1), text: boldInk === '#ffffff' ? '#fffaf2' : '#111111',
      primary: second, accent: mix(second, boldInk, 0.35),
    },
    fonts: { heading: 'Poppins', body: 'DM Sans', script: 'Caveat', display: 'Bebas Neue' },
    shape: 'round', heading_case: 'upper',
  }, { source: 'picture' })
  return [light, dark, bold]
}

// ── Kits into each designer ─────────────────────────────────────

const WEBSITE_RADII = { square: { sm_px: 0, md_px: 2, lg_px: 4 }, soft: { sm_px: 4, md_px: 8, lg_px: 16 }, round: { sm_px: 8, md_px: 16, lg_px: 28 } }
const WEBSITE_BUTTON_RADIUS = { square: 0, soft: 6, round: 28 }
const KIOSK_RADIUS = { square: 4, soft: 18, round: 30 }

const shapeOfRadius = (px, soft, round) => (px <= 2 ? 'square' : px < round ? 'soft' : 'round')

/**
 * The website's buttons are always white text on the primary colour and its
 * headings sit in the primary colour on the page, so the primary carries
 * white text and, when any shade can, stands out from the page (3 to 1):
 * the kit's primary or accent as they are, else the nearest darker shade of
 * either, else the nearest shade that carries white text.
 */
function websitePrimary(c) {
  const white = x => contrast('#ffffff', x) >= 4.5
  const both = x => white(x) && contrast(x, c.background) >= 3
  const shades = hex => {
    const [h, s, l] = hslOf(hex)
    const out = []
    for (let i = 1; i <= 50 && l - i * 0.02 >= 0; i++) out.push(hexFromHsl(h, s, l - i * 0.02))
    return out
  }
  return [c.primary, c.accent].find(both)
    || [...shades(c.primary), ...shades(c.accent)].find(both)
    || [c.primary, ...shades(c.primary)].find(white)
    || '#333333'
}

/** A kit as Website > Brand & theme (theme JSONB), keeping the rest. */
export function websiteThemeFromKit(kit, current = {}) {
  const k = normaliseKit(kit, { source: kit?.source })
  const c = k.colors
  const cur = current || {}
  return {
    ...cur,
    colors: {
      ...(cur.colors || {}),
      primary: websitePrimary(c), accent: c.accent, background: c.background, surface: c.surface,
      text: c.text, muted: c.muted, border: c.border,
    },
    typography: { ...(cur.typography || {}), heading_font: k.fonts.heading, body_font: k.fonts.body },
    radii: { ...(cur.radii || {}), ...WEBSITE_RADII[k.shape] },
    buttons: { ...(cur.buttons || {}), radius_px: WEBSITE_BUTTON_RADIUS[k.shape] },
  }
}

/** A kit as a kiosk design's brand (colours, fonts, corners, capitals). */
export function kioskBrandFromKit(kit, brand = {}) {
  const k = normaliseKit(kit, { source: kit?.source })
  const c = k.colors
  return {
    ...brand,
    colors: {
      background: c.background, surface: c.surface, text: c.text, muted: c.muted,
      primary: c.primary, primary_text: c.primary_text, accent: c.accent, accent_text: c.accent_text,
    },
    font_heading: k.fonts.display || k.fonts.heading,
    font_body: k.fonts.body,
    radius: KIOSK_RADIUS[k.shape],
    heading_case: k.heading_case,
  }
}

/**
 * A kit as a menu board's colours and fonts. Boards are seen from across a
 * room, so a light kit's board takes a deep colour (the brand colour when
 * it is dark enough, else the kit's text colour) with light words on it.
 */
export function boardFromKit(kit, layout = {}) {
  const k = normaliseKit(kit, { source: kit?.source })
  const c = k.colors
  const bg = isDarkKit(k) ? c.background : luminance(c.primary) < 0.12 ? c.primary : c.text
  const words = contrast(c.background, bg) >= 7 ? c.background : readableOn(inkOn(bg), bg, 7)
  const pick = [c.accent, c.primary, c.accent_text].find(x => contrast(x, bg) >= 3 && x !== bg)
  const accent = pick || readableOn(c.accent, bg, 3)
  return {
    ...layout,
    background: bg,
    text_color: words,
    accent_color: accent,
    muted_color: readableOn(mix(words, bg, 0.3), bg, 3),
    font_heading: k.fonts.display || k.fonts.heading,
    font_body: k.fonts.body,
    font_script: k.fonts.script,
  }
}

/** A kit as a printed menu design's fonts and ink colours (paper stays). */
export function printFromKit(kit, layout = {}) {
  const k = normaliseKit(kit, { source: kit?.source })
  const c = k.colors
  return {
    ...layout,
    font_heading: k.fonts.heading,
    font_body: k.fonts.body,
    font_script: k.fonts.script,
    ink_color: readableOn(c.text, PRINT_PAPER, 7),
    accent_color: readableOn(c.primary, PRINT_PAPER, 4.5),
    muted_color: readableOn(c.muted, PRINT_PAPER, 4.5),
  }
}

/** Into the designer named by target. */
export function applyKit(target, kit, current) {
  if (target === 'website') return websiteThemeFromKit(kit, current)
  if (target === 'kiosk') return kioskBrandFromKit(kit, current)
  if (target === 'board') return boardFromKit(kit, current)
  if (target === 'print') return printFromKit(kit, current)
  return current
}

// ── A designer's current look as a kit ──────────────────────────

const websiteFont = (v, d) => (FONT_OPTIONS.includes(v) ? v : d)

export function kitFromWebsiteTheme(theme = {}) {
  const c = theme.colors || {}
  const t = theme.typography || {}
  return normaliseKit({
    name: 'Your website', about: 'The website\'s Brand & theme now.',
    colors: { ...c, primary_text: '#ffffff' },
    fonts: { heading: websiteFont(t.heading_font, 'Inter'), body: websiteFont(t.body_font, 'Inter') },
    shape: shapeOfRadius(theme.buttons?.radius_px ?? 4, 6, 16),
    heading_case: 'normal',
  }, { source: 'current' })
}

export function kitFromKioskBrand(brand = {}) {
  const c = brand.colors || {}
  const h = brand.font_heading
  return normaliseKit({
    name: 'This kiosk design', about: 'The design\'s colours and fonts now.',
    colors: c,
    fonts: {
      heading: websiteFont(h, 'Montserrat'), body: websiteFont(brand.font_body, 'Inter'),
      display: DISPLAY_FONTS.includes(h) ? h : '',
    },
    shape: shapeOfRadius(Number(brand.radius ?? 18), 10, 26),
    heading_case: brand.heading_case,
  }, { source: 'current' })
}

export function kitFromBoard(layout = {}) {
  const bg = cleanHex(layout.background, '#141414')
  const h = layout.font_heading
  return normaliseKit({
    name: 'This board', about: 'The board\'s colours and fonts now.',
    colors: {
      background: bg, surface: mix(bg, cleanHex(layout.text_color, '#ffffff'), 0.08),
      text: layout.text_color, muted: layout.muted_color, primary: layout.accent_color, accent: layout.accent_color,
    },
    fonts: {
      heading: websiteFont(h, 'Montserrat'), body: websiteFont(layout.font_body, 'Inter'),
      script: websiteFont(layout.font_script, 'Caveat'), display: DISPLAY_FONTS.includes(h) ? h : '',
    },
    shape: 'square', heading_case: 'upper',
  }, { source: 'current' })
}

export function kitFromPrint(layout = {}) {
  return normaliseKit({
    name: 'This printed menu', about: 'The design\'s fonts and colours now.',
    colors: {
      background: PRINT_PAPER, surface: '#f3ead8', text: layout.ink_color || '#2a1c1a',
      muted: layout.muted_color || '#7a6b62', primary: layout.accent_color || '#630812',
    },
    fonts: {
      heading: websiteFont(layout.font_heading, 'Fraunces'), body: websiteFont(layout.font_body, 'Inter'),
      script: websiteFont(layout.font_script, 'Caveat'),
    },
    shape: 'soft', heading_case: 'normal',
  }, { source: 'current' })
}

/** The current look of the designer named by target, as a kit. */
export function kitFromCurrent(target, current) {
  if (target === 'website') return kitFromWebsiteTheme(current)
  if (target === 'kiosk') return kitFromKioskBrand(current)
  if (target === 'board') return kitFromBoard(current)
  if (target === 'print') return kitFromPrint(current)
  return null
}
