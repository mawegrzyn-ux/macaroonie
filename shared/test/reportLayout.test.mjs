import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normaliseLayout, BUILT_IN, paperBox, pageRule, isNegative, negativeText, cssString, layoutWords,
  HEADER_PARTS, LAYOUT_LIMITS, MARGIN_MM,
} from '../reports/layout.js'

test('a layout comes back in one known shape from anything', () => {
  for (const junk of [null, undefined, 7, 'a4', [], { page: 'a4', header: [], footer: 3, style: null, front: 'x' }]) {
    assert.deepEqual(normaliseLayout(junk), BUILT_IN)
  }
  assert.deepEqual(BUILT_IN, {
    page: { size: 'auto', way: 'auto', margin: 'normal' },
    header: { logo: true, group: true, about: true, period: true, choices: true, run: true },
    footer: { numbers: true, text: '' },
    style: { brand: false, density: 'normal', stripes: false, negatives: 'minus' },
    front: { on: false, text: '' },
  })
  assert.throws(() => { BUILT_IN.page = {} }, TypeError)
  const l = normaliseLayout({
    page: { size: 'letter', way: 'landscape', margin: 'wide', bleed: 3 },
    header: { logo: false, run: 'no', extra: false },
    footer: { numbers: false, text: '  In   confidence\n\tfor the board  ' },
    style: { brand: true, density: 'roomy', stripes: true, negatives: 'brackets', font: 'Comic Sans' },
    front: { on: true, text: 'Monthly pack\r\n\r\n\r\n\r\nFor the board' },
  })
  assert.deepEqual(l.page, { size: 'letter', way: 'landscape', margin: 'wide' })
  assert.deepEqual(l.header, { logo: false, group: true, about: true, period: true, choices: true, run: true })
  assert.deepEqual(l.footer, { numbers: false, text: 'In confidence for the board' })
  assert.deepEqual(l.style, { brand: true, density: 'roomy', stripes: true, negatives: 'brackets' })
  assert.deepEqual(l.front, { on: true, text: 'Monthly pack\n\nFor the board' })
  // Values it doesn't know fall back one by one, and it is the same the second time round.
  assert.deepEqual(normaliseLayout({ page: { size: 'a3', way: 'sideways', margin: 'none' }, style: { density: 'tiny', negatives: 'blue' } }), BUILT_IN)
  assert.deepEqual(normaliseLayout(l), l)
  assert.equal(HEADER_PARTS.length, 6)
})

test('words someone typed are kept short and on their lines', () => {
  const footer = normaliseLayout({ footer: { text: 'x'.repeat(500) } }).footer.text
  assert.equal(footer.length, LAYOUT_LIMITS.footer)
  const front = normaliseLayout({ front: { text: 'y'.repeat(5000) } }).front.text
  assert.equal(front.length, LAYOUT_LIMITS.front)
  assert.equal(normaliseLayout({ footer: { text: 'a\u0000b\u0007c' } }).footer.text, 'a b c')
  assert.equal(normaliseLayout({ front: { text: 'one\u0000\n two \u0007' } }).front.text, 'one\n two')
  assert.equal(normaliseLayout({ footer: { text: 12 } }).footer.text, '')
})

test('the built-in layout gives a table the room the print page always had', () => {
  const box = paperBox(BUILT_IN.page)
  // The narrower of A4 and Letter each way round, less the margins.
  assert.deepEqual(box.portrait, { fit: 718, mm: 190 })
  assert.deepEqual(box.landscape, { fit: 979, mm: 277 })
  assert.deepEqual(pageRule(BUILT_IN.page, 'portrait'), { size: 'portrait', margin: '12mm 10mm 14mm' })
  assert.deepEqual(pageRule(BUILT_IN.page, 'landscape'), { size: 'landscape', margin: '12mm 10mm 14mm' })
})

test('a named paper and other margins change the room and the page rule', () => {
  const a4 = paperBox({ size: 'a4', way: 'auto', margin: 'normal' })
  assert.deepEqual(a4.portrait, { fit: 718, mm: 190 })
  assert.deepEqual(a4.landscape, { fit: 1047, mm: 277 })
  const letter = paperBox({ size: 'letter', way: 'auto', margin: 'narrow' })
  assert.deepEqual(letter.portrait, { fit: 771, mm: 204 })
  assert.deepEqual(letter.landscape, { fit: 1009, mm: 267 })
  const wide = paperBox({ size: 'a4', way: 'auto', margin: 'wide' })
  assert.equal(wide.portrait.mm, 210 - 2 * MARGIN_MM.wide.side)
  assert.ok(wide.portrait.fit < a4.portrait.fit)
  assert.deepEqual(pageRule({ size: 'a4', margin: 'narrow' }, 'landscape'), { size: 'A4 landscape', margin: '8mm 6mm 10mm' })
  assert.deepEqual(pageRule({ size: 'letter', margin: 'wide' }, 'portrait'), { size: 'letter portrait', margin: '18mm 16mm 20mm' })
  // Anything but landscape is upright; a margin it doesn't know is the normal one.
  assert.deepEqual(pageRule({ size: 'a4', margin: 'huge' }, 'auto'), { size: 'A4 portrait', margin: '12mm 10mm 14mm' })
})

test('a negative figure is told from other words, and written as the layout says', () => {
  for (const yes of ['-12', '-£12.50', '\u2212£12.50', '-$3', '-€4', '-0.5%']) assert.equal(isNegative(yes), true, yes)
  for (const no of ['12', '£12.50', '-', '- none', '-abc', 'Refunds -3', '', null, -12, undefined]) assert.equal(isNegative(no), false, String(no))
  assert.equal(negativeText('-£12.50', 'brackets'), '(£12.50)')
  assert.equal(negativeText('\u2212£12.50', 'brackets'), '(£12.50)')
  assert.equal(negativeText('-£12.50', 'minus'), '-£12.50')
  assert.equal(negativeText('-£12.50', 'red'), '-£12.50')
  assert.equal(negativeText('£12.50', 'brackets'), '£12.50')
  assert.equal(negativeText('- none', 'brackets'), '- none')
})

test('words in a page margin can\'t end their string, their rule or the style element', () => {
  assert.equal(cssString('In confidence'), '"In confidence"')
  const s = cssString('a"b\\c</style><x>&\n}')
  assert.equal(s[0], '"')
  assert.equal(s.at(-1), '"')
  const inside = s.slice(1, -1)
  assert.ok(!/["<>&\n]/.test(inside), inside)
  assert.ok(!/\\(?![0-9a-f]+ )/.test(inside), 'every backslash starts an escape: ' + inside)
  assert.equal(cssString(null), '""')
  assert.equal(cssString(undefined), '""')
})

test('a layout said in a line', () => {
  assert.equal(layoutWords(null), 'As reports print without a layout')
  assert.equal(layoutWords(BUILT_IN), 'As reports print without a layout')
  assert.equal(layoutWords({ page: { size: 'a4', way: 'portrait' } }), 'A4, upright')
  assert.equal(layoutWords({ page: { way: 'landscape' } }), 'On its side')
  assert.equal(layoutWords({ page: { size: 'letter' } }), 'Letter')
  assert.equal(
    layoutWords({
      page: { size: 'a4', way: 'landscape', margin: 'narrow' }, header: { logo: false, run: false }, front: { on: true },
      style: { brand: true, density: 'compact', stripes: true, negatives: 'brackets' }, footer: { text: 'In confidence', numbers: false },
    }),
    ['A4, on its side', 'narrow margins', 'header without 2 parts', 'front page', 'brand colour', 'compact rows', 'striped',
      'negatives in brackets', 'footer words', 'no page numbers'].join(' · '),
  )
  assert.equal(layoutWords({ header: { about: false }, style: { negatives: 'red' } }), 'Header without 1 part \u00b7 negatives in red')
})
