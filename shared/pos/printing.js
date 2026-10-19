// shared/pos/printing.js
//
// The print jobs a till event makes (bills, receipts, the cash drawer) and
// the bill / receipt itself. ONE implementation for the sequencer and for the
// till's and kiosk's own browser printing.
//
// Kitchen tickets come from the kitchen flow: printer boxes in it
// (shared/pos/kitchenPrint.js, migration 191). This file makes the till's
// own jobs: bills, receipts and the cash drawer.
//
// A job: { printer_id, kind, title, ops, check_id }
//   kind: 'bill' | 'receipt' | 'drawer' here; 'kitchen' | 'fire' | 'void' from kitchenPrint.js
//   ops:  print operations (shared/pos/tickets.js), turned into ESC/POS by
//         the hub (hub/src/escpos.js) or into a page by the till.
// The cloud stores jobs (pos_print_jobs, status 'queued'); whoever prints for
// that printer collects them: the venue hub for a network printer, a till or
// kitchen screen for a printer plugged into it (pos_printers.connection).
// A device prints its own bills and receipts straight away, in its browser,
// when its receipt printer is plugged into it (or it has none): no job is
// queued for those (printsHere()).

import { receipt } from './tickets.js'
import { checkTotals, isActiveLine, modifierText, groupModifiers } from './pricing.js'
import { countParts } from '../combos.js'
import { TENDERS, checkLabel } from './checks.js'

function header(check, cfg, at) {
  const table = check.table_id ? (cfg.tables?.[check.table_id]?.label || null) : null
  return {
    table,
    tab: table ? null : (check.order_no != null ? 'ORDER ' + check.order_no : (check.tab_name || 'TAB ' + checkLabel(check))),
    // Counter orders show their number big; the name taken goes under it.
    name: table || check.order_no == null ? null : (check.tab_name || null),
    // For designs that pick the order number, tent, table or name (ticketLayout.js).
    number: check.order_no ?? null,
    tabName: check.tab_name || null,
    type: cfg.order_types?.[check.order_type_id]?.name || null,
    tent: check.tent || null,
    covers: check.covers || null,
    server: cfg.staff?.[check.server_id]?.name || null,
    checkNo: checkLabel(check),
    sentAt: at ? new Date(at) : new Date(),
  }
}

/** A line's name with its base choice: "Pad Thai (Chicken)". */
export function lineName(l) {
  const bases = (l.modifiers || []).filter(m => m.base).map(m => m.label)
  return l.name + (bases.length ? ' (' + bases.join(', ') + ')' : '')
}

/**
 * The bill or receipt for a check, as print operations: the location's
 * receipt design (cfg.layouts.receipt), or `layout` (a kiosk's).
 */
export function billOps(check, cfg, { preBill = false, at = null, drawer = false, layout = null } = {}) {
  const t = checkTotals(check)
  const s = cfg.settings || {}
  // The dish price on its own row; priced add-ons and meal-deal parts under it.
  const partPrice = c => (Number(c.upcharge) || 0) + (c.modifiers || []).reduce((y, m) => y + (m.base ? 0 : Number(m.price) || 0), 0)
  const lines = (check.lines || []).filter(isActiveLine).map(l => ({
    qty: l.qty, name: lineName(l), total: (Number(l.unit_price) || 0) * l.qty,
    modifiers: [
      ...groupModifiers(l.modifiers).filter(m => !m.base).map(m => ({ text: modifierText(m), price: (Number(m.price) || 0) * l.qty })),
      ...countParts(l.combo).map(({ part: c, count }) => ({ text: (count > 1 ? count + ' x ' : '') + c.name, price: partPrice(c) * count * l.qty })),
    ],
  }))
  const tender = k => TENDERS.find(x => x.key === k)?.label || k
  const payments = (check.payments || []).filter(p => !p.voided).map(p => ({ tender: p.label || tender(p.tender), amount: p.amount + (p.tip || 0) }))
  const change = (check.payments || []).filter(p => !p.voided).reduce((x, p) => x + (p.change || 0), 0)
  const h = header(check, cfg, at || check.closed_at || check.updated_at)
  return receipt({
    venue: { name: s.receipt_name || cfg.venue?.name || '', address: s.receipt_address || [], vatNumber: s.vat_number || null },
    table: h.table, tab: h.tab, name: h.name, tabName: h.tabName, number: h.number, type: h.type, tent: h.tent,
    checkNo: h.checkNo, server: h.server, covers: h.covers, at: h.sentAt, preBill,
    lines,
    discounts: t.discounts.filter(d => d.amount > 0).map(d => ({ name: d.name, amount: d.amount })),
    serviceCharge: t.service_charge ? { label: s.service_charge_label || ('Service charge' + (check.service_charge?.percent ? ' ' + check.service_charge.percent + '%' : '')), amount: t.service_charge } : null,
    total: t.total,
    vat: t.vat.map(v => ({ rate: v.rate, net: v.net, vat: v.vat })),
    payments: preBill ? [] : payments,
    change: preBill ? 0 : change,
    drawer,
  }, layout || cfg.layouts?.receipt)
}

/**
 * Whether a device prints this printer's tickets itself: the printer is
 * plugged into it (connection 'device'). A device with no receipt printer
 * prints its bills in its browser too (receiptHere()).
 */
export function printsHere(cfg, deviceId, printerId) {
  const pr = cfg.printers?.[printerId]
  return !!(pr && deviceId && pr.connection === 'device' && pr.device_id === deviceId)
}

/** Whether a device prints its own bills and receipts (in its browser). */
export function receiptHere(cfg, deviceId) {
  const pid = cfg.devices?.[deviceId]?.receipt_printer_id || null
  return !pid || printsHere(cfg, deviceId, pid)
}

/**
 * The print jobs one sequenced event makes.
 *   e       the event
 *   before  { [id]: check } as they were
 *   after   { [id]: check } the checks the event changed
 *   cfg     { printers, tables, staff, courses, settings, venue, devices, layouts: { receipt, kiosk_receipt } }
 */
export function jobsForEvent(e, before = {}, after = {}, cfg = {}) {
  const p = e.payload || {}
  const check = after[e.check_id] || before[e.check_id]
  const jobs = []
  const picked = p.printer_id || cfg.devices?.[e.device_id]?.receipt_printer_id || null
  // Printed by the device itself, in its browser (no job).
  const receiptPrinter = picked && !printsHere(cfg, e.device_id, picked) ? picked : null
  // A kiosk's receipts print in the kiosk receipt design.
  const receiptLayout = cfg.devices?.[e.device_id]?.kiosk ? cfg.layouts?.kiosk_receipt || null : null

  if (e.type === 'bill.printed' && check && receiptPrinter) {
    const preBill = check.status === 'open'
    jobs.push({
      printer_id: receiptPrinter, kind: preBill ? 'bill' : 'receipt', check_id: check.id,
      title: (preBill ? 'Bill ' : 'Receipt ') + checkLabel(check),
      ops: billOps(check, cfg, { preBill, at: e.client_at, layout: receiptLayout }),
    })
  }

  if (e.type === 'check.closed' && check && receiptPrinter && p.print_receipt) {
    jobs.push({ printer_id: receiptPrinter, kind: 'receipt', check_id: check.id, title: 'Receipt ' + checkLabel(check), ops: billOps(check, cfg, { at: e.client_at, layout: receiptLayout }) })
  }

  const cashIn = e.type === 'payment.added' && p.payment?.tender === 'cash'
  if ((cashIn || e.type === 'drawer.opened') && receiptPrinter) {
    jobs.push({ printer_id: receiptPrinter, kind: 'drawer', check_id: e.check_id || null, title: 'Open drawer', ops: [{ t: 'drawer' }] })
  }

  return jobs
}
