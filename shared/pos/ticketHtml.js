// shared/pos/ticketHtml.js
//
// Print operations (shared/pos/tickets.js) as HTML: opsHtml() for printing
// from a till's or kiosk's browser (pos/src/lib/print.js), and
// previewHtml() for the print designer, which lays the ticket out in exactly
// the columns a receipt printer uses (the same wrapping as toText(), with
// bold, double height, double width and white-on-black drawn).

import { wrap, pairLines, DEFAULT_COLS } from './tickets.js'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** A ticket as a page for the browser's print dialog (80mm). */
export function opsHtml(ops) {
  const out = []
  for (const op of ops) {
    if (op.t === 'text') {
      const style = [
        'text-align:' + (op.align || 'left'),
        op.bold ? 'font-weight:700' : '',
        op.tall ? 'font-size:1.45em' : '',
        op.wide ? 'letter-spacing:0.25em' : '',
        op.invert ? 'background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact' : '',
        op.indent ? 'padding-left:' + op.indent + 'ch' : '',
      ].filter(Boolean).join(';')
      out.push('<div style="' + style + '">' + esc(op.text) + '</div>')
    } else if (op.t === 'pair') {
      out.push('<div class="pair" style="' + (op.bold ? 'font-weight:700;' : '') + (op.tall ? 'font-size:1.3em' : '') + '"><span>' + esc(op.left) + '</span><span>' + esc(op.right) + '</span></div>')
    } else if (op.t === 'rule') {
      out.push('<div class="rule' + (op.char === '=' ? ' double' : '') + '"></div>')
    } else if (op.t === 'feed') {
      out.push('<div style="height:' + (op.lines || 1) + 'em"></div>')
    } else if (op.t === 'cut') {
      out.push('<div class="cut"></div>')
    }
  }
  return out.join('')
}

export const PRINT_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  body { margin: 0; padding: 2mm; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #000; width: 72mm; }
  .pair { display: flex; justify-content: space-between; gap: 8px; }
  .pair span:first-child { flex: 1; }
  .rule { border-top: 1px dashed #000; margin: 4px 0; }
  .rule.double { border-top: 3px double #000; }
  .cut { page-break-after: always; border-bottom: 1px dotted #999; margin: 6px 0; }
  .cut:last-child { page-break-after: auto; border: 0; }
`

/**
 * A ticket laid out as the receipt printer prints it, `cols` characters wide.
 * Each printed line is a row; a double-width character takes two columns,
 * a double-height line two rows. -> HTML (no outer element) for
 * PREVIEW_CSS inside an element with class "tk".
 */
export function previewHtml(ops, cols = DEFAULT_COLS) {
  const rows = []
  const row = (text, op = {}, pad = 0) => {
    const sx = op.wide ? 2 : 1
    const sy = op.tall ? 2 : 1
    const cls = ['tk-l', op.tall && 'tk-tall', op.wide && 'tk-wide', op.bold && 'tk-b', op.invert && 'tk-inv'].filter(Boolean).join(' ')
    rows.push('<div class="' + cls + '"><span style="margin-left:' + pad + 'ch;width:' + Math.ceil(text.length) + 'ch' + (sx > 1 || sy > 1 ? ';transform:scale(' + sx + ',' + sy + ')' : '') + '">' + esc(text) + '</span></div>')
  }
  for (const op of ops) {
    const width = op.wide ? Math.floor(cols / 2) : cols
    if (op.t === 'text') {
      const indent = op.indent || 0
      for (const line of wrap(op.text, width - indent)) {
        const chars = (indent + line.length) * (op.wide ? 2 : 1)
        const pad = op.align === 'center' ? Math.floor((cols - chars) / 2) : op.align === 'right' ? cols - chars : 0
        row(' '.repeat(indent) + line, op, Math.max(0, pad))
      }
    } else if (op.t === 'pair') {
      for (const line of pairLines(op.left, op.right, width)) row(line, op)
    } else if (op.t === 'rule') {
      row((op.char || '-').repeat(cols))
    } else if (op.t === 'feed') {
      for (let i = 0; i < (op.lines || 1); i++) row('')
    } else if (op.t === 'cut') {
      rows.push('<div class="tk-cut"></div>')
    } else if (op.t === 'drawer') {
      rows.push('<div class="tk-note">Opens the cash drawer</div>')
    }
  }
  return rows.join('')
}

export const PREVIEW_CSS = `
  .tk { font: 13px/1.25 ui-monospace, Menlo, Consolas, "Courier New", monospace; color: #111; background: #fff; padding: 12px 10px; }
  .tk-l { height: 1.25em; white-space: pre; overflow: visible; }
  .tk-l > span { display: inline-block; transform-origin: 0 0; }
  .tk-tall { height: 2.5em; }
  .tk-b { font-weight: 700; }
  .tk-inv > span { background: #111; color: #fff; }
  .tk-cut { border-top: 2px dashed #9ca3af; margin: 10px -10px 0; }
  .tk-note { font-size: 11px; color: #6b7280; text-align: center; padding: 4px 0; }
`
