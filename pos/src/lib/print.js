// Printing from the till itself, until the venue hub prints to the network
// printers (docs/POS.md). Print operations (shared/pos/tickets.js) become an
// 80mm page in a hidden frame and go to the browser's print dialog, so a
// tablet with a printer set up in Android or Windows can print bills and
// receipts now. The same operations will go to the hub as ESC/POS later.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

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

const CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  body { margin: 0; padding: 2mm; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #000; width: 72mm; }
  .pair { display: flex; justify-content: space-between; gap: 8px; }
  .pair span:first-child { flex: 1; }
  .rule { border-top: 1px dashed #000; margin: 4px 0; }
  .rule.double { border-top: 3px double #000; }
  .cut { page-break-after: always; border-bottom: 1px dotted #999; margin: 6px 0; }
  .cut:last-child { page-break-after: auto; border: 0; }
`

/** Print one or more tickets (each a list of operations). */
export function printTickets(tickets) {
  const list = (tickets || []).filter(t => t && t.length)
  if (!list.length) return
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write('<!doctype html><html><head><meta charset="utf-8"><style>' + CSS + '</style></head><body>' + list.map(opsHtml).join('') + '</body></html>')
  doc.close()
  setTimeout(() => {
    try { frame.contentWindow.focus(); frame.contentWindow.print() } catch { /* printing not available */ }
    setTimeout(() => frame.remove(), 60_000)
  }, 150)
}
