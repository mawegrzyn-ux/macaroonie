// hub/src/escpos.js
//
// Turns a ticket (print operations from shared/pos/tickets.js) into ESC/POS
// bytes for Epson printers and ESC/POS clones. Text goes out in code page
// WPC1252 (ESC t 16), so £ is the single byte 0xA3.

import { DEFAULT_COLS, wrap, pairLines } from '../../shared/pos/tickets.js'

const ESC = 0x1b
const GS = 0x1d

export const CMD = {
  init:      [ESC, 0x40],
  codePage:  [ESC, 0x74, 16],             // WPC1252
  align:     n => [ESC, 0x61, n],         // 0 left, 1 centre, 2 right
  bold:      on => [ESC, 0x45, on ? 1 : 0],
  size:      (wide, tall) => [GS, 0x21, ((wide ? 1 : 0) << 4) | (tall ? 1 : 0)],
  invert:    on => [GS, 0x42, on ? 1 : 0],
  feed:      n => [ESC, 0x64, Math.max(0, Math.min(255, n))],
  cut:       [GS, 0x56, 0x42, 0x00],      // feed to the cutter, partial cut
  drawer:    [ESC, 0x70, 0x00, 0x19, 0xfa], // pin 2, 50ms on, 500ms off
}

// Windows-1252 bytes 0x80-0x9F that differ from Latin-1.
const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

/** Encode text for code page 1252; characters it can't show become '?'. */
export function encode(text) {
  const out = []
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c)
    else if (CP1252[ch] != null) out.push(CP1252[ch])
    else out.push(0x3f)
  }
  return out
}

const ALIGN = { left: 0, center: 1, right: 2 }

/** Render print operations to a Buffer. `cols` = characters per line in normal width. */
export function render(ops, { cols = DEFAULT_COLS } = {}) {
  const b = [...CMD.init, ...CMD.codePage]
  const line = (text, { align = 'left', bold = false, wide = false, tall = false, invert = false } = {}) => {
    b.push(...CMD.align(ALIGN[align] ?? 0), ...CMD.bold(bold), ...CMD.size(wide, tall), ...CMD.invert(invert))
    b.push(...encode(text), 0x0a)
    b.push(...CMD.bold(false), ...CMD.size(false, false), ...CMD.invert(false), ...CMD.align(0))
  }
  for (const op of ops) {
    const width = op.wide ? Math.floor(cols / 2) : cols
    if (op.t === 'text') {
      const indent = ' '.repeat(op.indent || 0)
      for (const l of wrap(op.text, width - (op.indent || 0))) line(indent + l, op)
    } else if (op.t === 'pair') {
      for (const l of pairLines(op.left, op.right, width)) line(l, { bold: op.bold, tall: op.tall })
    } else if (op.t === 'rule') {
      line((op.char || '-').repeat(cols))
    } else if (op.t === 'feed') {
      b.push(...CMD.feed(op.lines || 1))
    } else if (op.t === 'cut') {
      b.push(...CMD.feed(3), ...CMD.cut)
    } else if (op.t === 'drawer') {
      b.push(...CMD.drawer)
    }
  }
  return Buffer.from(b)
}
