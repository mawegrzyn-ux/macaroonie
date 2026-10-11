// shared/pos/tickets.js
//
// POS tickets as a list of print operations, so one layout feeds the hub's
// ESC/POS printer output (hub/src/escpos.js) and on-screen previews
// (toText() here, an admin preview later). Money is in pence.
//
// Operations:
//   { t: 'text', text, align: 'left'|'center'|'right', bold, tall, wide, invert, indent }
//   { t: 'pair', left, right, bold, tall }       left text, right text flush right
//   { t: 'rule', char }                          a full-width line
//   { t: 'feed', lines }
//   { t: 'cut' }
//   { t: 'drawer' }                              open the cash drawer (receipt printer)

export const DEFAULT_COLS = 42 // 80mm paper, Font A: TM-T88 = 42, TM-m30 = 48

export function money(pence) {
  const v = Math.round(Number(pence) || 0)
  const sign = v < 0 ? '-' : ''
  return sign + '£' + (Math.abs(v) / 100).toFixed(2)
}

function hhmm(at) {
  const d = at instanceof Date ? at : new Date(at)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function dateLabel(at) {
  const d = at instanceof Date ? at : new Date(at)
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
}

/**
 * Kitchen / bar ticket for one send.
 * send: { station, table, tab, covers, server, checkNo, sentAt, reprint, void,
 *         courses: [{ name, hold, lines: [{ qty, name, seat, modifiers: [{ kind: 'add'|'remove'|'note', text }], note, allergies }] }] }
 */
export function kitchenTicket(send) {
  const ops = []
  if (send.void) ops.push({ t: 'text', text: ' VOID ', align: 'center', bold: true, tall: true, wide: true, invert: true })
  if (send.reprint) ops.push({ t: 'text', text: '** REPRINT **', align: 'center', bold: true })
  ops.push({ t: 'text', text: (send.station || 'KITCHEN').toUpperCase(), align: 'center', bold: true })
  ops.push({ t: 'text', text: send.table ? 'TABLE ' + send.table : (send.tab || 'TAB'), align: 'center', bold: true, tall: true, wide: true })
  const info = [send.covers ? send.covers + ' covers' : null, send.server, send.checkNo ? '#' + send.checkNo : null].filter(Boolean).join('  ')
  if (info) ops.push({ t: 'text', text: info, align: 'center' })
  ops.push({ t: 'text', text: (send.void ? 'Voided ' : 'Sent ') + hhmm(send.sentAt || new Date()), align: 'center' })

  for (const course of send.courses || []) {
    ops.push({ t: 'rule', char: '=' })
    const name = (course.name || '').toUpperCase()
    const head = course.fire ? ' FIRE ' + name + ' ' : name + (course.hold ? '  - HOLD' : '')
    ops.push({ t: 'text', text: head, align: 'center', bold: true, invert: !!(course.hold || course.fire), tall: !!course.fire })
    for (const line of course.lines || []) {
      const seat = line.seat ? '  S' + line.seat : ''
      ops.push({ t: 'text', text: line.qty + ' x ' + line.name + seat, bold: true, tall: true })
      for (const m of line.modifiers || []) {
        const mark = m.kind === 'remove' ? '- ' : m.kind === 'note' ? '* ' : m.kind === 'part' ? '> ' : '+ '
        ops.push({ t: 'text', text: mark + m.text, indent: m.kind === 'part' ? 2 : 4 + (m.depth || 0) * 2, tall: true, bold: m.kind === 'part' })
      }
      if (line.note) ops.push({ t: 'text', text: '* ' + line.note, indent: 4, tall: true })
      if (line.allergies?.length) {
        ops.push({ t: 'text', text: ' ALLERGY: ' + line.allergies.join(', ').toUpperCase() + ' ', indent: 4, bold: true, invert: true })
      }
    }
  }
  ops.push({ t: 'rule', char: '=' })
  ops.push({ t: 'cut' })
  return ops
}

/**
 * Customer receipt (or pre-bill with bill.preBill).
 * bill: { venue: { name, address: [], vatNumber }, table, tab, checkNo, server, covers, at, preBill,
 *         lines: [{ qty, name, total, modifiers: [{ text, price }] }],   total = dish x qty, add-ons priced separately
 *         discounts: [{ name, amount }], serviceCharge: { label, amount },
 *         vat: [{ rate, net, vat }], total, payments: [{ tender, amount }], change, footer, drawer }
 */
export function receipt(bill) {
  const ops = []
  const v = bill.venue || {}
  ops.push({ t: 'text', text: v.name || '', align: 'center', bold: true, tall: true, wide: true })
  for (const a of v.address || []) ops.push({ t: 'text', text: a, align: 'center' })
  if (v.vatNumber) ops.push({ t: 'text', text: 'VAT no. ' + v.vatNumber, align: 'center' })
  ops.push({ t: 'feed', lines: 1 })
  if (bill.preBill) ops.push({ t: 'text', text: 'BILL - NOT A RECEIPT', align: 'center', bold: true })
  const where = bill.table ? 'Table ' + bill.table : (bill.tab || '')
  ops.push({ t: 'pair', left: where, right: bill.checkNo ? 'Check ' + bill.checkNo : '' })
  ops.push({ t: 'pair', left: bill.server ? 'Served by ' + bill.server : '', right: bill.covers ? bill.covers + ' covers' : '' })
  ops.push({ t: 'pair', left: dateLabel(bill.at || new Date()), right: hhmm(bill.at || new Date()) })
  ops.push({ t: 'rule', char: '-' })
  for (const l of bill.lines || []) {
    ops.push({ t: 'pair', left: l.qty + ' ' + l.name, right: money(l.total) })
    for (const m of l.modifiers || []) {
      ops.push({ t: 'pair', left: '   ' + m.text, right: m.price ? money(m.price) : '' })
    }
  }
  ops.push({ t: 'rule', char: '-' })
  ops.push({ t: 'pair', left: 'Subtotal', right: money(billSubtotal(bill.lines)) })
  for (const d of bill.discounts || []) ops.push({ t: 'pair', left: d.name, right: money(-Math.abs(d.amount)) })
  if (bill.serviceCharge?.amount) ops.push({ t: 'pair', left: bill.serviceCharge.label || 'Service charge', right: money(bill.serviceCharge.amount) })
  ops.push({ t: 'pair', left: 'TOTAL', right: money(bill.total), bold: true, tall: true })
  if (bill.vat?.length) {
    ops.push({ t: 'feed', lines: 1 })
    for (const r of bill.vat) {
      ops.push({ t: 'pair', left: 'VAT ' + r.rate + '% on ' + money(r.net), right: money(r.vat) })
    }
  }
  if (bill.payments?.length) {
    ops.push({ t: 'rule', char: '-' })
    for (const p of bill.payments) ops.push({ t: 'pair', left: p.tender, right: money(p.amount) })
    if (bill.change) ops.push({ t: 'pair', left: 'Change', right: money(bill.change), bold: true })
  }
  ops.push({ t: 'feed', lines: 1 })
  if (bill.footer) ops.push({ t: 'text', text: bill.footer, align: 'center' })
  if (bill.drawer) ops.push({ t: 'drawer' })
  ops.push({ t: 'cut' })
  return ops
}

/** Lines plus their priced add-ons, in pence. */
export function billSubtotal(lines = []) {
  return lines.reduce((s, l) => s + (l.total || 0) + (l.modifiers || []).reduce((m, x) => m + (x.price || 0), 0), 0)
}

/** Split text into lines no longer than `width`, breaking at spaces where it can. */
export function wrap(text, width) {
  const out = []
  let rest = String(text ?? '')
  if (width < 1) return [rest]
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width)
    if (cut <= 0) cut = width
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  out.push(rest)
  return out
}

/**
 * Lay a pair out on one line (left, gap, right), wrapping the left side when
 * both don't fit. Returns lines of exactly `width` characters or fewer.
 */
export function pairLines(left, right, width) {
  const l = String(left ?? '')
  const r = String(right ?? '')
  if (!r) return wrap(l, width)
  if (l.length + 1 + r.length <= width) return [l + ' '.repeat(width - l.length - r.length) + r]
  const lines = wrap(l, Math.max(1, width - r.length - 1))
  const last = lines.pop()
  return [...lines, last + ' '.repeat(Math.max(1, width - last.length - r.length)) + r]
}

/** Plain-text preview of a ticket (for screens, logs and tests). Double width halves the line. */
export function toText(ops, cols = DEFAULT_COLS) {
  const out = []
  for (const op of ops) {
    const width = op.wide ? Math.floor(cols / 2) : cols
    if (op.t === 'text') {
      const indent = ' '.repeat(op.indent || 0)
      for (const line of wrap(op.text, width - (op.indent || 0))) {
        // Double-width characters take two columns: shown spaced out.
        const body = op.wide ? [...(indent + line)].join(' ') : indent + line
        const pad = op.align === 'center' ? Math.floor((cols - body.length) / 2)
          : op.align === 'right' ? cols - body.length : 0
        out.push(' '.repeat(Math.max(0, pad)) + body)
      }
    } else if (op.t === 'pair') {
      out.push(...pairLines(op.left, op.right, width))
    } else if (op.t === 'rule') {
      out.push((op.char || '-').repeat(cols))
    } else if (op.t === 'feed') {
      for (let i = 0; i < (op.lines || 1); i++) out.push('')
    } else if (op.t === 'cut') {
      out.push('~'.repeat(cols) + '  (cut)')
    } else if (op.t === 'drawer') {
      out.push('[open drawer]')
    }
  }
  return out.join('\n')
}
