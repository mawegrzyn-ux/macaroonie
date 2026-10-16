// shared/pos/printing.js
//
// Which printer an item goes to, and the print jobs an event makes. ONE
// implementation for the sequencer (cloud now, venue hub later) and for the
// till's own previews and browser printing.
//
// Routing (pos_print_routes): an item goes to every printer routed at its
// most specific level that has routes: the dish, else its menu section,
// else its revenue centre, else the venue default. A meal deal's parts route
// on their own (burger to the kitchen, drink to the bar).
//
// A job: { printer_id, kind, title, ops, check_id }
//   kind: 'kitchen' | 'fire' | 'void' | 'bill' | 'receipt' | 'drawer'
//   ops:  print operations (shared/pos/tickets.js), turned into ESC/POS by
//         the hub (hub/src/escpos.js) or into a page by the till.
// The cloud stores jobs (pos_print_jobs, status 'queued'); the venue hub will
// collect and print them. Until a hub is installed the till prints bills and
// receipts in the browser.

import { kitchenTicket, receipt } from './tickets.js'
import { checkTotals, isActiveLine, modifierText } from './pricing.js'
import { TENDERS, checkLabel } from './checks.js'

const LEVELS = ['item', 'section', 'revenue_centre', 'default']

/**
 * Printer ids for something with { item_id, section_id, revenue_centre_id }.
 * Kitchen screens route the same way with key 'station_id' (kds_routes).
 */
export function routeFor(target, routes = [], key = 'printer_id') {
  for (const level of LEVELS) {
    const id = level === 'item' ? target.item_id
      : level === 'section' ? target.section_id
        : level === 'revenue_centre' ? target.revenue_centre_id : null
    const hits = routes.filter(r => r.target_kind === level && (level === 'default' || (id && r.target_id === id)))
    if (hits.length) return [...new Set(hits.map(r => r[key]))]
  }
  return []
}

function kitchenModifiers(mods = []) {
  return mods.filter(m => !m.base || m.label).map(m => ({
    kind: m.prefix === 'no' ? 'remove' : 'add', text: modifierText(m), depth: m.depth || 0,
  }))
}

/** Kitchen lines per printer for some check lines. */
function linesByPrinter(lines, check, cfg) {
  const out = new Map()
  const add = (printerId, courseId, entry) => {
    const byCourse = out.get(printerId) || new Map()
    const list = byCourse.get(courseId ?? '') || []
    list.push(entry)
    byCourse.set(courseId ?? '', list)
    out.set(printerId, byCourse)
  }
  for (const l of lines) {
    const rc = l.revenue_centre_id ?? check.revenue_centre_id
    const base = {
      seat: l.seat || null, note: l.note || null, allergies: l.allergies || [],
    }
    if (l.combo && l.combo.length) {
      // Each part goes to its own printers; the deal's name heads the parts.
      const parts = new Map()
      for (const part of l.combo) {
        for (const pid of routeFor({ item_id: part.item_id, section_id: part.section_id, revenue_centre_id: rc }, cfg.routes)) {
          const list = parts.get(pid) || []
          list.push(part)
          parts.set(pid, list)
        }
      }
      for (const [pid, list] of parts) {
        add(pid, l.course_id, {
          ...base, qty: l.qty, name: l.kitchen_name || l.name,
          modifiers: [
            ...kitchenModifiers(l.modifiers),
            ...list.flatMap(part => [
              { kind: 'part', text: part.kitchen_name || part.name },
              ...kitchenModifiers(part.modifiers).map(m => ({ ...m, depth: (m.depth || 0) + 1 })),
            ]),
          ],
        })
      }
      continue
    }
    for (const pid of routeFor({ item_id: l.item_id, section_id: l.section_id, revenue_centre_id: rc }, cfg.routes)) {
      add(pid, l.course_id, { ...base, qty: l.qty, name: l.kitchen_name || l.name, modifiers: kitchenModifiers(l.modifiers) })
    }
  }
  return out
}

function header(check, cfg, at) {
  const table = check.table_id ? (cfg.tables?.[check.table_id]?.label || null) : null
  return {
    table,
    tab: table ? null : (check.order_no != null ? 'ORDER ' + check.order_no : (check.tab_name || 'TAB ' + checkLabel(check))),
    covers: check.covers || null,
    server: cfg.staff?.[check.server_id]?.name || null,
    checkNo: checkLabel(check),
    sentAt: at ? new Date(at) : new Date(),
  }
}

function coursesFor(byCourse, cfg, flags = {}) {
  const sortOf = id => (id ? (cfg.courses?.[id]?.sort_order ?? 99) : -1)
  return [...byCourse.entries()]
    .sort((a, b) => sortOf(a[0]) - sortOf(b[0]))
    .map(([courseId, lines]) => ({
      name: courseId ? (cfg.courses?.[courseId]?.name || 'Course') : '',
      hold: !!flags.hold?.has(courseId),
      fire: !!flags.fire,
      lines,
    }))
}

function printerName(cfg, id) {
  return cfg.printers?.[id]?.name || 'Kitchen'
}

/** A line's name with its base choice: "Pad Thai (Chicken)". */
export function lineName(l) {
  const bases = (l.modifiers || []).filter(m => m.base).map(m => m.label)
  return l.name + (bases.length ? ' (' + bases.join(', ') + ')' : '')
}

/** The bill or receipt for a check, as print operations. */
export function billOps(check, cfg, { preBill = false, at = null, drawer = false } = {}) {
  const t = checkTotals(check)
  const s = cfg.settings || {}
  // The dish price on its own row; priced add-ons and meal-deal parts under it.
  const partPrice = c => (Number(c.upcharge) || 0) + (c.modifiers || []).reduce((y, m) => y + (m.base ? 0 : Number(m.price) || 0), 0)
  const lines = (check.lines || []).filter(isActiveLine).map(l => ({
    qty: l.qty, name: lineName(l), total: (Number(l.unit_price) || 0) * l.qty,
    modifiers: [
      ...(l.modifiers || []).filter(m => !m.base).map(m => ({ text: modifierText(m), price: (Number(m.price) || 0) * l.qty })),
      ...(l.combo || []).map(c => ({ text: c.name, price: partPrice(c) * l.qty })),
    ],
  }))
  const tender = k => TENDERS.find(x => x.key === k)?.label || k
  const payments = (check.payments || []).filter(p => !p.voided).map(p => ({ tender: p.label || tender(p.tender), amount: p.amount + (p.tip || 0) }))
  const change = (check.payments || []).filter(p => !p.voided).reduce((x, p) => x + (p.change || 0), 0)
  const h = header(check, cfg, at || check.closed_at || check.updated_at)
  return receipt({
    venue: { name: s.receipt_name || cfg.venue?.name || '', address: s.receipt_address || [], vatNumber: s.vat_number || null },
    table: h.table, tab: h.tab, checkNo: h.checkNo, server: h.server, covers: h.covers, at: h.sentAt, preBill,
    lines,
    discounts: t.discounts.filter(d => d.amount > 0).map(d => ({ name: d.name, amount: d.amount })),
    serviceCharge: t.service_charge ? { label: s.service_charge_label || ('Service charge' + (check.service_charge?.percent ? ' ' + check.service_charge.percent + '%' : '')), amount: t.service_charge } : null,
    total: t.total,
    vat: t.vat.map(v => ({ rate: v.rate, net: v.net, vat: v.vat })),
    payments: preBill ? [] : payments,
    change: preBill ? 0 : change,
    footer: preBill ? (s.bill_footer || null) : (s.receipt_footer || 'Thank you'),
    drawer,
  })
}

/**
 * The print jobs one sequenced event makes.
 *   e       the event
 *   before  { [id]: check } as they were
 *   after   { [id]: check } the checks the event changed
 *   cfg     { printers, routes, tables, staff, courses, settings, venue, devices }
 */
export function jobsForEvent(e, before = {}, after = {}, cfg = {}) {
  const p = e.payload || {}
  const check = after[e.check_id] || before[e.check_id]
  const jobs = []
  const receiptPrinter = p.printer_id || cfg.devices?.[e.device_id]?.receipt_printer_id || null

  if (e.type === 'lines.sent' && check) {
    const ids = new Set(p.line_ids)
    const was = before[e.check_id]
    const lines = check.lines.filter(l => ids.has(l.id) && l.send_id === p.send_id && (was?.lines.find(x => x.id === l.id)?.status ?? 'new') === 'new')
    const hold = new Set(p.held_course_ids || [])
    for (const [pid, byCourse] of linesByPrinter(lines, check, cfg)) {
      jobs.push({
        printer_id: pid, kind: 'kitchen', check_id: check.id,
        title: 'Order ' + checkLabel(check),
        ops: kitchenTicket({ ...header(check, cfg, e.client_at), station: printerName(cfg, pid), courses: coursesFor(byCourse, cfg, { hold }) }),
      })
    }
  }

  if (e.type === 'course.fired' && check) {
    const was = before[e.check_id]
    const fired = check.lines.filter(l => l.course_id === p.course_id && l.status === 'sent' && was?.lines.find(x => x.id === l.id)?.held)
    for (const [pid, byCourse] of linesByPrinter(fired, check, cfg)) {
      jobs.push({
        printer_id: pid, kind: 'fire', check_id: check.id,
        title: 'Fire ' + (cfg.courses?.[p.course_id]?.name || 'course'),
        ops: kitchenTicket({ ...header(check, cfg, e.client_at), station: printerName(cfg, pid), courses: coursesFor(byCourse, cfg, { fire: true }) }),
      })
    }
  }

  if (e.type === 'line.voided' && check) {
    const target = p.qty != null ? check.lines.find(l => l.id === p.new_line_id) : check.lines.find(l => l.id === p.line_id)
    if (target) {
      for (const [pid, byCourse] of linesByPrinter([target], check, cfg)) {
        jobs.push({
          printer_id: pid, kind: 'void', check_id: check.id, title: 'Void ' + target.name,
          ops: kitchenTicket({ ...header(check, cfg, e.client_at), void: true, station: printerName(cfg, pid), courses: coursesFor(byCourse, cfg) }),
        })
      }
    }
  }

  if (e.type === 'bill.printed' && check && receiptPrinter) {
    const preBill = check.status === 'open'
    jobs.push({
      printer_id: receiptPrinter, kind: preBill ? 'bill' : 'receipt', check_id: check.id,
      title: (preBill ? 'Bill ' : 'Receipt ') + checkLabel(check),
      ops: billOps(check, cfg, { preBill, at: e.client_at }),
    })
  }

  if (e.type === 'check.closed' && check && receiptPrinter && p.print_receipt) {
    jobs.push({ printer_id: receiptPrinter, kind: 'receipt', check_id: check.id, title: 'Receipt ' + checkLabel(check), ops: billOps(check, cfg, { at: e.client_at }) })
  }

  const cashIn = e.type === 'payment.added' && p.payment?.tender === 'cash'
  if ((cashIn || e.type === 'drawer.opened') && receiptPrinter) {
    jobs.push({ printer_id: receiptPrinter, kind: 'drawer', check_id: e.check_id || null, title: 'Open drawer', ops: [{ t: 'drawer' }] })
  }

  return jobs
}
