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

import { orderInfo } from '../orderInfo.js'
import { defaultLayout } from './ticketLayout.js'

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

// How big a line prints: normal, tall (double height) or big (double height and width).
const SIZE_STYLE = { normal: {}, tall: { bold: true, tall: true }, big: { bold: true, tall: true, wide: true } }
const SMALLER = { big: 'tall', tall: 'normal', normal: 'normal' }
const sized = size => SIZE_STYLE[size] || {}

/** The big line of a ticket (title block): what shared/orderInfo.js picks, else null for the usual one. */
function titleText(main, o) {
  if (!main || main === 'auto') return null
  const info = orderInfo(o, { main })
  if (info.key !== main || !info.value) return null
  if (main === 'number') return 'ORDER ' + info.value
  if (main === 'tent') return 'TENT ' + info.value
  if (main === 'table') return 'TABLE ' + info.value
  return info.value
}

function textLines(ops, text, style) {
  for (const line of String(text || '').split('\n')) if (line.trim()) ops.push({ t: 'text', text: line, ...style })
}

/**
 * Kitchen / bar ticket for one send, drawn from a layout (shared/pos/ticketLayout.js;
 * none = the built-in one).
 * send: { station, table, tab, name, tabName, number, type, tent, covers, server, checkNo, sentAt, reprint, void,
 *         allergy, allergyUpdate,
 *         courses: [{ name, hold, lines: [{ qty, name, seat, modifiers: [{ kind: 'add'|'remove'|'note', text }], note, allergies }] }] }
 * allergy: the order's allergy flag as one line (shared/pos/allergy.js), printed
 * at the top of the dishes on every ticket; allergyUpdate: a ticket of its own
 * saying the flag changed (shared/pos/kitchenPrint.js).
 */
export function kitchenTicket(send, layout = null) {
  const L = layout?.blocks ? layout : defaultLayout('kitchen')
  const ops = []
  if (send.void) ops.push({ t: 'text', text: ' VOID ', align: 'center', bold: true, tall: true, wide: true, invert: true })
  if (send.reprint) ops.push({ t: 'text', text: '** REPRINT **', align: 'center', bold: true })
  if (send.allergyUpdate) ops.push({ t: 'text', text: ' ALLERGY UPDATE ', align: 'center', bold: true, tall: true, wide: true, invert: true })
  const who = { number: send.number, tent: send.tent, table: send.table, name: send.tabName ?? send.name, type_name: send.type }
  for (const b of L.blocks) {
    const o = b.opts || {}
    if (b.type === 'station') {
      ops.push({ t: 'text', text: (send.station || 'KITCHEN').toUpperCase(), align: 'center', bold: true, ...sized(o.size) })
    } else if (b.type === 'title') {
      const own = titleText(o.main, who)
      if (own) {
        ops.push({ t: 'text', text: own, align: 'center', bold: true, ...sized(o.size), ...(o.invert ? { invert: true } : {}) })
      } else {
        ops.push({ t: 'text', text: send.table ? 'TABLE ' + send.table : (send.tab || 'TAB'), align: 'center', bold: true, ...sized(o.size), ...(o.invert ? { invert: true } : {}) })
        if (send.name) ops.push({ t: 'text', text: send.name, align: 'center', bold: true, ...sized(SMALLER[o.size] || 'normal') })
      }
    } else if (b.type === 'details') {
      const value = k => ({
        type: send.type,
        tent: send.tent ? 'TENT ' + send.tent : null,
        table: send.table ? 'TABLE ' + send.table : null,
        name: who.name,
        number: send.number != null ? 'ORDER ' + send.number : null,
        covers: send.covers ? send.covers + ' covers' : null,
        server: send.server,
        check: send.checkNo ? '#' + send.checkNo : null,
        time: (send.void ? 'Voided ' : 'Sent ') + hhmm(send.sentAt || new Date()),
      })[k]
      const parts = (o.fields || []).map(value).filter(Boolean)
      if (!parts.length) continue
      if (o.style === 'band') ops.push({ t: 'text', text: ' ' + parts.join('  ').toUpperCase() + ' ', align: 'center', bold: true, ...sized(o.size), invert: true })
      else ops.push({ t: 'text', text: parts.join('  '), align: 'center', ...sized(o.size) })
    } else if (b.type === 'items') {
      const tall = o.size !== 'normal'
      // The order's allergy flag, on every ticket (the dishes block can't be left out).
      if (send.allergy) {
        ops.push({ t: 'rule', char: '=' })
        ops.push({ t: 'text', text: ' ALLERGY: ' + send.allergy.toUpperCase() + ' ', align: 'center', bold: true, tall: true, invert: true })
      } else if (send.allergyUpdate) {
        ops.push({ t: 'rule', char: '=' })
        ops.push({ t: 'text', text: 'ALLERGY FLAG TAKEN OFF', align: 'center', bold: true, tall: true })
      }
      for (const course of send.courses || []) {
        ops.push({ t: 'rule', char: '=' })
        const name = (course.name || '').toUpperCase()
        const head = course.fire ? ' FIRE ' + name + ' ' : name + (course.hold ? '  - HOLD' : '')
        ops.push({ t: 'text', text: head, align: 'center', bold: true, invert: !!(course.hold || course.fire), tall: !!course.fire })
        for (const line of course.lines || []) {
          const seat = o.seats !== false && line.seat ? '  S' + line.seat : ''
          ops.push({ t: 'text', text: line.qty + ' x ' + line.name + seat, bold: true, tall })
          for (const m of line.modifiers || []) {
            const mark = m.kind === 'remove' ? '- ' : m.kind === 'note' ? '* ' : m.kind === 'part' ? '> ' : '+ '
            ops.push({ t: 'text', text: mark + m.text, indent: m.kind === 'part' ? 2 : 4 + (m.depth || 0) * 2, tall, bold: m.kind === 'part' })
          }
          if (line.note) ops.push({ t: 'text', text: '* ' + line.note, indent: 4, tall })
          if (line.allergies?.length) {
            ops.push({ t: 'text', text: ' ALLERGY: ' + line.allergies.join(', ').toUpperCase() + ' ', indent: 4, bold: true, invert: true })
          }
        }
      }
      ops.push({ t: 'rule', char: '=' })
    } else {
      commonBlock(ops, b)
    }
  }
  ops.push({ t: 'cut' })
  return ops
}

/** Text, line and space blocks, the same on every kind of ticket. */
function commonBlock(ops, b) {
  const o = b.opts || {}
  if (b.type === 'text') textLines(ops, o.text, { align: o.align || 'center', ...sized(o.size), ...(o.bold ? { bold: true } : {}) })
  else if (b.type === 'rule') ops.push({ t: 'rule', char: o.char || '-' })
  else if (b.type === 'space') ops.push({ t: 'feed', lines: o.lines || 1 })
}

/**
 * Customer receipt (or pre-bill with bill.preBill), drawn from a layout
 * (shared/pos/ticketLayout.js; none = the built-in one).
 * bill: { venue: { name, address: [], vatNumber }, table, tab, name, tabName, number, type, tent, checkNo, server, covers, at, preBill,
 *         lines: [{ qty, name, total, modifiers: [{ text, price }] }],   total = dish x qty, add-ons priced separately
 *         discounts: [{ name, amount }], charges: [{ label, amount }],
 *         vat: [{ rate, net, vat }], total, payments: [{ tender, amount }], change, drawer }
 */
export function receipt(bill, layout = null) {
  const L = layout?.blocks ? layout : defaultLayout('receipt')
  const ops = []
  const v = bill.venue || {}
  const who = { number: bill.number, tent: bill.tent, table: bill.table, name: bill.tabName ?? bill.name, type_name: bill.type }
  const pair = (left, right, extra = {}) => { if (left || right) ops.push({ t: 'pair', left: left || '', right: right || '', ...extra }) }
  for (const b of L.blocks) {
    const o = b.opts || {}
    if (b.type === 'venue') {
      if (o.name !== false && v.name) ops.push({ t: 'text', text: v.name, align: 'center', bold: true, ...sized(o.size) })
      if (o.address !== false) for (const a of v.address || []) ops.push({ t: 'text', text: a, align: 'center' })
      if (o.vat !== false && v.vatNumber) ops.push({ t: 'text', text: 'VAT no. ' + v.vatNumber, align: 'center' })
    } else if (b.type === 'heading') {
      textLines(ops, bill.preBill ? o.bill_text : o.receipt_text, { align: 'center', bold: true, ...sized(o.size) })
    } else if (b.type === 'title') {
      const own = titleText(o.main, who)
        || (o.main === 'auto' || !o.main ? (bill.number != null ? 'ORDER ' + bill.number : bill.table ? 'TABLE ' + bill.table : null) : null)
      if (own) ops.push({ t: 'text', text: own, align: 'center', bold: true, ...sized(o.size), ...(o.invert ? { invert: true } : {}) })
    } else if (b.type === 'details') {
      const f = new Set(o.fields || [])
      const at = bill.at || new Date()
      pair(f.has('where') ? (bill.table ? 'Table ' + bill.table : (bill.tab || '')) : '', f.has('check') && bill.checkNo ? 'Check ' + bill.checkNo : '')
      pair(f.has('server') && bill.server ? 'Served by ' + bill.server : '', f.has('covers') && bill.covers ? bill.covers + ' covers' : '')
      pair(f.has('type') ? [bill.type, bill.name].filter(Boolean).join(' - ') : '', f.has('tent') && bill.tent ? 'Tent ' + bill.tent : '')
      if (f.has('date')) pair(dateLabel(at), hhmm(at))
    } else if (b.type === 'items') {
      for (const l of bill.lines || []) {
        if (o.extras === false) {
          pair(l.qty + ' ' + l.name, money((l.total || 0) + (l.modifiers || []).reduce((x, m) => x + (m.price || 0), 0)))
          continue
        }
        pair(l.qty + ' ' + l.name, money(l.total))
        for (const m of l.modifiers || []) pair('   ' + m.text, m.price ? money(m.price) : '')
      }
    } else if (b.type === 'totals') {
      if (o.subtotal !== false) pair('Subtotal', money(billSubtotal(bill.lines)))
      for (const d of bill.discounts || []) pair(d.name, money(-Math.abs(d.amount)))
      for (const x of bill.charges || []) if (x.amount) pair(x.label || 'Service charge', money(x.amount))
      ops.push({ t: 'pair', left: 'TOTAL', right: money(bill.total), bold: true, tall: o.size !== 'normal' })
    } else if (b.type === 'vat') {
      if (bill.vat?.length) {
        ops.push({ t: 'feed', lines: 1 })
        for (const r of bill.vat) pair('VAT ' + r.rate + '% on ' + money(r.net), money(r.vat))
      }
    } else if (b.type === 'payments') {
      if (bill.payments?.length) {
        ops.push({ t: 'rule', char: '-' })
        for (const p of bill.payments) pair(p.tender, money(p.amount))
        if (bill.change) pair('Change', money(bill.change), { bold: true })
      }
    } else if (b.type === 'footer') {
      textLines(ops, bill.preBill ? o.bill_text : o.receipt_text, { align: 'center' })
    } else {
      commonBlock(ops, b)
    }
  }
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

/**
 * X or Z report (shared/pos/reports.js dayFigures) as a ticket.
 * meta: { venue, kind: 'X' | 'Z', number, date, printedAt, declaredCash, names: { staff, revenue_streams, order_types } }
 */
export function dayReportTicket(f, meta = {}) {
  const ops = []
  const names = meta.names || {}
  ops.push({ t: 'text', text: meta.venue || '', align: 'center', bold: true })
  ops.push({ t: 'text', text: (meta.kind === 'Z' ? 'Z REPORT' : 'X REPORT') + (meta.number ? ' #' + meta.number : ''), align: 'center', bold: true, tall: true, wide: true })
  if (meta.date) ops.push({ t: 'text', text: 'Trading day ' + meta.date, align: 'center' })
  ops.push({ t: 'text', text: 'Printed ' + dateLabel(meta.printedAt || new Date()) + ' ' + hhmm(meta.printedAt || new Date()), align: 'center' })
  ops.push({ t: 'rule', char: '=' })
  const pair = (l, r, bold) => ops.push({ t: 'pair', left: l, right: r, bold })
  pair('Checks', String(f.counts?.closed || 0))
  pair('Covers', String(f.covers || 0))
  pair('Sales before discounts', money(f.sales?.gross))
  pair('Discounts', money(-(f.sales?.discounts || 0)))
  // Each charge by name (shared/pos/charges.js), else the one total.
  const charges = (f.charges || []).filter(x => x.amount)
  if (charges.length) for (const x of charges) pair(x.name, money(x.amount))
  else if (f.sales?.service_charge) pair('Charges', money(f.sales.service_charge))
  pair('TOTAL SALES', money(f.sales?.total), true)
  pair('Average check', money(f.sales?.average_check))
  ops.push({ t: 'rule' })
  ops.push({ t: 'text', text: 'VAT', bold: true })
  for (const v of f.vat || []) pair(v.rate + '% on ' + money(v.net), money(v.vat))
  if ((f.revenue_streams || []).length) {
    ops.push({ t: 'rule' })
    ops.push({ t: 'text', text: 'REVENUE STREAMS', bold: true })
    for (const r of f.revenue_streams) pair(names.revenue_streams?.[r.id] || 'Other', money(r.net))
  }
  if ((f.order_types || []).length) {
    ops.push({ t: 'rule' })
    ops.push({ t: 'text', text: 'ORDER TYPES', bold: true })
    for (const r of f.order_types) pair((names.order_types?.[r.id] || 'Other') + ' (' + r.checks + ')', money(r.net))
  }
  ops.push({ t: 'rule' })
  ops.push({ t: 'text', text: 'TAKINGS', bold: true })
  for (const t of f.tenders || []) {
    pair(t.label + ' (' + t.count + ')', money(t.amount + t.tips - t.refunds))
    if (t.tips) pair('  of which tips', money(t.tips))
    if (t.refunds) pair('  less refunds', money(-t.refunds))
  }
  pair('TOTAL TAKEN', money(f.takings), true)
  ops.push({ t: 'rule' })
  pair('Cash expected', money(f.cash_expected), true)
  if (meta.declaredCash != null) {
    pair('Cash counted', money(meta.declaredCash))
    pair('Over / short', money(meta.declaredCash - (f.cash_expected || 0)), true)
  }
  ops.push({ t: 'rule' })
  pair('Voids (' + (f.voids?.count || 0) + ')', money(f.voids?.value))
  pair('Refunds (' + (f.refunds?.count || 0) + ')', money(f.refunds?.amount))
  for (const d of f.discounts || []) pair('  ' + d.name + ' x' + d.count, money(-d.amount))
  if ((f.open_checks || []).length) pair('Checks still open', String(f.open_checks.length), true)
  if ((f.staff || []).length) {
    ops.push({ t: 'rule' })
    ops.push({ t: 'text', text: 'STAFF', bold: true })
    for (const s of f.staff) if (s.checks || s.tips) pair((names.staff?.[s.id] || 'Unknown') + (s.checks ? ' (' + s.checks + ')' : ''), money(s.total) + (s.tips ? ' +' + money(s.tips) : ''))
  }
  ops.push({ t: 'feed', lines: 1 })
  ops.push({ t: 'cut' })
  return ops
}
