// src/services/pdfDoc.js
//
// A tiny PDF writer for plain documents (purchase orders): A4 pages, the
// standard Helvetica / Helvetica-Bold fonts (no embedding), text, lines and
// filled boxes. Text is WinAnsi-encoded, so £, €, ×, · and Latin-1 letters
// print; anything else becomes '?'. No dependencies.
//
//   const doc = new PdfDoc()
//   doc.text(40, 60, 'Hello', { size: 18, bold: true })   // y from the TOP
//   doc.line(40, 70, 555, 70)
//   doc.newPage()
//   const buf = doc.toBuffer()

export const A4 = { w: 595.28, h: 841.89 }

// Helvetica and Helvetica-Bold advance widths (1/1000 em), chars 32-126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]

// Unicode -> WinAnsi bytes outside Latin-1.
const WIN = { 0x20AC: 0x80, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85 }

function encode(str) {
  const out = []
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0)
    if (c >= 32 && c < 127) out.push(c)
    else if (c >= 0xA0 && c <= 0xFF) out.push(c)
    else if (WIN[c]) out.push(WIN[c])
    else if (c === 0x2212) out.push(0x2D)
    else out.push(0x3F)
  }
  return out
}

function charWidth(code, bold) {
  const table = bold ? W_BOLD : W_REG
  if (code >= 32 && code <= 126) return table[code - 32]
  if (code === 0xA3 || code === 0x80) return 556 // £ €
  if (code === 0xD7) return 584 // ×
  if (code === 0xB7 || code === 0x95) return 278 // · •
  if (code === 0x96) return 556
  if (code === 0x97) return 1000
  return 556
}

export function textWidth(str, size = 10, bold = false) {
  return encode(str).reduce((s, c) => s + charWidth(c, bold), 0) * size / 1000
}

/** Cut text to fit a width, ending in "..." when cut. */
export function fitText(str, maxWidth, size = 10, bold = false) {
  const s = String(str ?? '')
  if (textWidth(s, size, bold) <= maxWidth) return s
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textWidth(s.slice(0, mid) + '...', size, bold) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return s.slice(0, lo) + '...'
}

/** Split text into lines no wider than maxWidth (breaking at spaces). */
export function wrapText(str, maxWidth, size = 10, bold = false) {
  const lines = []
  for (const para of String(str ?? '').split(/\r?\n/)) {
    let cur = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word
      if (textWidth(next, size, bold) <= maxWidth || !cur) cur = next
      else { lines.push(cur); cur = word }
    }
    lines.push(cur)
  }
  return lines.map(l => fitText(l, maxWidth, size, bold))
}

function pdfString(str) {
  const bytes = encode(str)
  let s = ''
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5C) s += '\\' + String.fromCharCode(b)
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0')
    else s += String.fromCharCode(b)
  }
  return `(${s})`
}

const f = n => (Math.round(n * 100) / 100).toString()

export class PdfDoc {
  constructor({ width = A4.w, height = A4.h } = {}) {
    this.width = width
    this.height = height
    this.pages = []
    this.newPage()
  }

  newPage() {
    this.ops = []
    this.pages.push(this.ops)
  }

  get pageCount() { return this.pages.length }

  /** Text at (x, y-from-top baseline). opts: size, bold, align left|right|center, gray 0-1. */
  text(x, y, str, { size = 10, bold = false, align = 'left', gray = 0 } = {}) {
    const w = textWidth(str, size, bold)
    const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    this.ops.push(`BT ${f(gray)} g /${bold ? 'F2' : 'F1'} ${f(size)} Tf ${f(tx)} ${f(this.height - y)} Td ${pdfString(str)} Tj ET`)
  }

  line(x1, y1, x2, y2, { width = 0.5, gray = 0.7 } = {}) {
    this.ops.push(`${f(gray)} G ${f(width)} w ${f(x1)} ${f(this.height - y1)} m ${f(x2)} ${f(this.height - y2)} l S`)
  }

  /** Filled box with its top-left at (x, y). */
  box(x, y, w, h, { gray = 0.93 } = {}) {
    this.ops.push(`${f(gray)} g ${f(x)} ${f(this.height - y - h)} ${f(w)} ${f(h)} re f`)
  }

  toBuffer() {
    const objs = []
    const add = body => { objs.push(body); return objs.length }
    const catalog = add(null)
    const pagesId = add(null)
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    const kids = []
    for (const ops of this.pages) {
      const content = ops.join('\n')
      const contentId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(this.width)} ${f(this.height)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`))
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    const offsets = []
    objs.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'))
      out += `${i + 1} 0 obj\n${body}\nendobj\n`
    })
    const xref = Buffer.byteLength(out, 'latin1')
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(out, 'latin1')
  }
}
