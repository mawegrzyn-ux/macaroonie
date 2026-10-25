// The theme maker's engine (shared/themeKit.js): colour maths, a picture's
// palette, readable kits, kits made from a palette alone, and each
// designer's settings made from a kit (checked by that designer's own
// normaliser, so a kit never gives a setting the designer would drop).
// Run: node --test shared/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contrast, inkOn, readableOn, hslOf, extractPalette, normaliseKit, kitsFromPalette, KIT_COLORS,
  websiteThemeFromKit, kioskBrandFromKit, boardFromKit, printFromKit, kitFromWebsiteTheme, kitFromKioskBrand,
  kitFromBoard, kitFromPrint, kitFontsUrl, isDarkKit, PRINT_PAPER, luminance,
} from '../themeKit.js'
import { normaliseDesign } from '../kiosk.js'
import { normalizeBoard } from '../screenLayout.js'
import { normalizeLayout, pageStyle } from '../menuLayout.js'

const readable = kit => {
  const c = kit.colors
  return [
    ['text', 'background', 4.5], ['text', 'surface', 4.5], ['muted', 'background', 3], ['muted', 'surface', 3],
    ['primary_text', 'primary', 4.5], ['accent_text', 'accent', 4.5], ['primary', 'background', 3],
  ].filter(([a, b, min]) => contrast(c[a], c[b]) < min - 0.01).map(([a, b]) => a + ' on ' + b)
}

// An image as RGBA bytes: [hex, how many pixels] in rows, plus see-through pixels.
function pixelsOf(parts, transparent = 0) {
  const out = []
  for (const [hex, n] of parts) {
    const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    for (let i = 0; i < n; i++) out.push(v[0], v[1], v[2], 255)
  }
  for (let i = 0; i < transparent; i++) out.push(0, 255, 0, 0)
  return new Uint8ClampedArray(out)
}

test('colour maths: contrast, ink, readable shades keep their hue', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01)
  assert.equal(contrast('#777777', '#777777'), 1)
  assert.equal(inkOn('#ffffff'), '#111111')
  assert.equal(inkOn('#0b2545'), '#ffffff')
  const yellowOnWhite = readableOn('#ffc72c', '#ffffff', 4.5)
  assert.ok(contrast(yellowOnWhite, '#ffffff') >= 4.5)
  assert.ok(Math.abs(hslOf(yellowOnWhite)[0] - hslOf('#ffc72c')[0]) < 8, 'still a yellow-brown, not grey')
  const navyOnBlack = readableOn('#0b2545', '#111111', 3)
  assert.ok(contrast(navyOnBlack, '#111111') >= 3)
  assert.equal(readableOn('#000000', '#ffffff', 4.5), '#000000', 'already readable: unchanged')
})

test('palette: main colours of a picture, biggest first, see-through pixels ignored', () => {
  const pal = extractPalette(pixelsOf([['#c8102e', 7000], ['#ffc72c', 2000], ['#ffffff', 1000]], 50000))
  assert.ok(pal.length >= 3)
  const near = (hex, want) => contrast(hex, want) < 1.2 && Math.abs(hslOf(hex)[0] - hslOf(want)[0]) < 12
  assert.ok(near(pal[0].hex, '#c8102e'), 'red first: ' + pal[0].hex)
  assert.ok(Math.abs(pal[0].share - 0.7) < 0.05)
  assert.ok(pal.some(p => near(p.hex, '#ffc72c')), 'yellow found')
  assert.ok(pal.some(p => p.l > 0.95), 'white found')
  assert.ok(!pal.some(p => p.hex === '#00ff00'), 'transparent green never counts')
  assert.deepEqual(extractPalette(new Uint8ClampedArray(0)), [])
  assert.deepEqual(extractPalette(pixelsOf([], 100)), [], 'all see-through')
  // A smooth gradient still comes down to a handful of colours.
  const grad = []
  for (let i = 0; i < 256; i++) for (let j = 0; j < 20; j++) grad.push(i, 64, 255 - i, 255)
  const g = extractPalette(new Uint8ClampedArray(grad), { count: 6 })
  assert.ok(g.length <= 6 && g.length >= 3)
})

test('normaliseKit: bad values fixed, every pairing readable, fonts from the list', () => {
  const k = normaliseKit({
    name: '  A  very   long name that goes on and on and on forever  ',
    colors: { background: '#ffffff', surface: 'nope', text: '#eeeeee', muted: '#f0f0f0', primary: '#fff3a0', primary_text: '#ffffff', accent: '#ffd800' },
    fonts: { heading: 'Comic Sans MS', body: 'Lora', display: 'Bebas Neue', script: 'Wingdings' },
    shape: 'wobbly', heading_case: 'upper',
  })
  assert.equal(k.name.length <= 40, true)
  assert.ok(!/\s{2}/.test(k.name))
  assert.deepEqual(Object.keys(k.colors).sort(), [...KIT_COLORS].sort())
  assert.deepEqual(readable(k), [])
  assert.equal(k.fonts.heading, 'Playfair Display')
  assert.equal(k.fonts.body, 'Lora')
  assert.equal(k.fonts.display, 'Bebas Neue')
  assert.equal(k.fonts.script, 'Caveat')
  assert.equal(k.shape, 'soft')
  assert.equal(k.heading_case, 'upper')
  assert.equal(normaliseKit({}).colors.background, '#ffffff')
  assert.equal(normaliseKit(null).fonts.body, 'Inter')
  assert.equal(normaliseKit({ fonts: { display: 'Papyrus' } }).fonts.display, '')
  assert.equal(normaliseKit({}, { source: 'picture' }).source, 'picture')
  assert.equal(normaliseKit({ source: 'hack' }).source, 'ai')
})

test('kits from a palette alone: light, dark and bold, all readable', () => {
  const pal = extractPalette(pixelsOf([['#0b6b3a', 5000], ['#ffc72c', 2500], ['#f7f3ea', 2500]]))
  const kits = kitsFromPalette(pal)
  assert.equal(kits.length, 3)
  for (const k of kits) {
    assert.deepEqual(readable(k), [], k.name)
    assert.equal(k.source, 'picture')
  }
  const [light, dark, bold] = kits
  assert.ok(!isDarkKit(light))
  assert.ok(isDarkKit(dark))
  assert.ok(Math.abs(hslOf(bold.colors.background)[0] - hslOf('#0b6b3a')[0]) < 15, 'bold page in the brand colour')
  assert.ok(Math.abs(hslOf(light.colors.primary)[0] - hslOf('#0b6b3a')[0]) < 15, 'light buttons in the brand colour')
  assert.deepEqual(kitsFromPalette([]), [])
  // A black and white logo still makes kits.
  assert.equal(kitsFromPalette(extractPalette(pixelsOf([['#000000', 3000], ['#ffffff', 3000]]))).length, 3)
})

const KIT = normaliseKit({
  name: 'Lemongrass', about: 'Fresh greens.',
  colors: { background: '#fbfaf5', surface: '#eef3e6', text: '#1d2a1a', muted: '#5f6b58', border: '#d9e0cf', primary: '#ffc72c', primary_text: '#1d2a1a', accent: '#2f7d32', accent_text: '#ffffff' },
  fonts: { heading: 'Lora', body: 'Karla', script: 'Caveat', display: 'Oswald' },
  shape: 'round', heading_case: 'upper',
})

test('website: colours, fonts, corners; buttons carry white text; the rest kept', () => {
  const current = { colors: { background_image: '/uploads/bg.jpg' }, spacing: { gap_px: 30 }, typography: { base_size_px: 18 }, hero: { overlay_opacity: 0.2 } }
  const t = websiteThemeFromKit(KIT, current)
  assert.equal(t.colors.background_image, '/uploads/bg.jpg')
  assert.equal(t.spacing.gap_px, 30)
  assert.equal(t.typography.base_size_px, 18)
  assert.equal(t.hero.overlay_opacity, 0.2)
  assert.equal(t.typography.heading_font, 'Lora')
  assert.equal(t.typography.body_font, 'Karla')
  assert.ok(contrast('#ffffff', t.colors.primary) >= 4.5, 'yellow kit: green accent becomes the button colour')
  assert.equal(t.colors.primary, '#2f7d32')
  assert.equal(t.buttons.radius_px, 28)
  assert.equal(t.radii.lg_px, 28)
  assert.ok(!('primary_text' in t.colors) && !('accent_text' in t.colors), 'only the website\'s own colours')
  const back = kitFromWebsiteTheme(t)
  assert.equal(back.colors.background, KIT.colors.background)
  assert.equal(back.fonts.heading, 'Lora')
  assert.equal(back.shape, 'round')
  // Headings sit in the primary on the page: it stands out there too, even
  // on a bold page in the brand colour (a red page gets a near-black primary,
  // not an olive one).
  for (const k of kitsFromPalette(extractPalette(pixelsOf([['#c8102e', 7000], ['#ffc72c', 3000]])))) {
    const w = websiteThemeFromKit(k, {})
    assert.ok(contrast('#ffffff', w.colors.primary) >= 4.5, k.name + ': white button words')
    assert.ok(contrast(w.colors.primary, w.colors.background) >= 3, k.name + ': primary on the page ' + w.colors.primary + ' on ' + w.colors.background)
  }
})

test('kiosk: brand from a kit survives the kiosk\'s own checks', () => {
  const brand = kioskBrandFromKit(KIT, { logo_url: '/uploads/logo.png', colors: {} })
  const d = normaliseDesign({ brand })
  assert.equal(d.brand.logo_url, '/uploads/logo.png')
  assert.equal(d.brand.font_heading, 'Oswald', 'the display face on a kiosk')
  assert.equal(d.brand.font_body, 'Karla')
  assert.equal(d.brand.radius, 30)
  assert.equal(d.brand.heading_case, 'upper')
  for (const k of ['background', 'surface', 'text', 'muted', 'primary', 'primary_text', 'accent', 'accent_text']) assert.equal(d.brand.colors[k], brand.colors[k], k)
  assert.ok(contrast(d.brand.colors.primary_text, d.brand.colors.primary) >= 4.5)
  const back = kitFromKioskBrand(d.brand)
  assert.equal(back.fonts.display, 'Oswald')
  assert.equal(back.colors.primary, KIT.colors.primary)
  // The bottom bar's and side menu's own colours go: they follow the new colours again.
  const own = kioskBrandFromKit(KIT, { colors: { bar: '#c8102e', bar_text: '#ffffff', rail: '#000000', rail_text: '#ffffff' } })
  const again = normaliseDesign({ brand: own }).brand.colors
  for (const k of ['bar', 'bar_text', 'rail', 'rail_text']) assert.equal(again[k], null, k)
})

test('board: a light kit gives a deep board with light, readable words', () => {
  const layout = { blocks: [{ id: 'b1', type: 'heading', x: 0, y: 0, w: 100, h: 40, opts: {} }], grid: 20 }
  const b = boardFromKit(KIT, layout)
  const n = normalizeBoard(b, 1920, 1080)
  assert.equal(n.blocks.length, 1, 'blocks kept')
  assert.equal(n.grid, 20)
  assert.ok(luminance(n.background) < 0.2, 'deep background ' + n.background)
  assert.ok(contrast(n.text_color, n.background) >= 7)
  assert.ok(contrast(n.accent_color, n.background) >= 3)
  assert.ok(contrast(n.muted_color, n.background) >= 3)
  assert.equal(n.font_heading, 'Oswald')
  assert.equal(n.font_body, 'Karla')
  const dark = normaliseKit({ colors: { background: '#101418', primary: '#ff5a36', accent: '#ffd23f' } })
  assert.equal(boardFromKit(dark).background, '#101418', 'a dark kit keeps its own page colour')
  assert.equal(kitFromBoard(n).fonts.display, 'Oswald')
})

test('print: fonts and inks readable on the paper; the page style uses them', () => {
  const l = printFromKit(KIT, { cols: 24, pages: [{ id: 'p1', blocks: [] }] })
  const n = normalizeLayout(l)
  assert.equal(n.cols, 24)
  assert.equal(n.font_heading, 'Lora')
  assert.equal(n.ink_color, l.ink_color)
  assert.ok(contrast(n.ink_color, PRINT_PAPER) >= 7)
  assert.ok(contrast(n.accent_color, PRINT_PAPER) >= 4.5)
  assert.ok(contrast(n.muted_color, PRINT_PAPER) >= 4.5)
  const s = pageStyle(n, { primary_colour: '#000000' })
  assert.equal(s['--ink'], n.ink_color)
  assert.equal(s['--plum'], n.accent_color, 'the design\'s accent wins over the menu\'s colour')
  assert.equal(pageStyle(normalizeLayout({}), { primary_colour: '#123456' })['--plum'], '#123456', 'no accent set: the menu\'s colour')
  assert.equal(normalizeLayout({ ink_color: 'red' }).ink_color, null)
  assert.equal(kitFromPrint(n).fonts.heading, 'Lora')
})

test('fonts url: website and display faces, unknown ones left out', () => {
  const url = kitFontsUrl([KIT, normaliseKit({ fonts: { heading: 'Fraunces', display: 'Bebas Neue' } })])
  assert.match(url, /family=Lora:wght@/)
  assert.match(url, /family=Oswald:wght@300;400;500;600;700/)
  assert.match(url, /family=Bebas\+Neue:wght@400/)
  assert.equal(kitFontsUrl([]), null)
})
