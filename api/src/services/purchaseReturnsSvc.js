// src/services/purchaseReturnsSvc.js
//
// Returns to the supplier and their credit notes (inventory phase 9b,
// migration 321; docs/INVENTORY.md 6.4): loading them, what of a delivery can
// still go back, the supplier's copy (HTML for print, a PDF through
// pdfDoc.js) and emailing it, as a purchase order is emailed (emailPo() in
// purchasingSvc.js: after the transaction that checks it, the error kept on
// the return when the email fails). The rules are shared/returns.js; the
// routes are routes/purchaseReturns.js; the stock move each line makes is the
// stock area's (returnMoves in services/stockSvc.js).
//
// Every query filters tenant_id itself. Money is stripped by returnView()
// for people who don't see purchasing prices; the supplier's copy always
// carries it (it is the document the supplier gets, as a purchase order is).

import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { env } from '../config/env.js'
import { loadVenue, loadPoLines, productOf } from './purchasingSvc.js'
import { PdfDoc, A4, fitText, wrapText } from './pdfDoc.js'
import { sendEmail, emailCredentials } from './emailSvc.js'
import { poNumberLabel, fmtNum } from '../../../shared/procurement.js'
import {
  returnNumberLabel, returnedOf, returnableLines, returnPrefill, returnActions, creditOwed, creditOverdue, daysWaiting,
  creditDifference, RETURN_REASONS, RETURN_STATUSES, RETURN_SENT_VIA,
} from '../../../shared/returns.js'

const num = v => (v == null || v === '' ? 0 : Number(v))

// A return with what its lists need: the supplier, the venue, the delivery's number and day.
const RETURN_SELECT = `
  r.id, r.number, r.venue_id, r.po_id, r.supplier_id, r.status, r.note, r.returned_at, r.created_at, r.created_by,
  r.credit_expected::float8 AS credit_expected, r.credit_vat::float8 AS credit_vat,
  r.sent_at, r.sent_by, r.sent_via, r.sent_to, r.send_error,
  r.credit_note_number, r.credit_note_date::text AS credit_note_date, r.credit_amount::float8 AS credit_amount,
  r.credited_at, r.credited_by, r.refused_at, r.refused_by, r.refuse_note,
  r.cancelled_at, r.cancelled_by, r.cancel_note, r.history, r.updated_at,
  s.name AS supplier_name, s.email AS supplier_email, v.name AS venue_name,
  po.number AS po_number, po.delivery_date::text AS po_delivery_date, po.received_at AS po_received_at,
  (SELECT count(*)::int FROM purchase_return_lines rl WHERE rl.return_id = r.id AND rl.tenant_id = r.tenant_id) AS line_count`

/**
 * Returns by what is asked: ids, a delivery (poId), a venue, statuses, those
 * whose credit is still owed (owed) or owed since before `overdueBefore`
 * (a moment), newest first; limit at most 500.
 */
export async function loadReturns(tx, tenantId, { ids = null, poId = null, venueId = null, supplierId = null, statuses = null, owed = false, overdueBefore = null, limit = 200, lock = false } = {}) {
  return tx`
    SELECT ${tx.unsafe(RETURN_SELECT)}
      FROM purchase_returns r
      JOIN suppliers s ON s.id = r.supplier_id AND s.tenant_id = r.tenant_id
      JOIN venues v ON v.id = r.venue_id AND v.tenant_id = r.tenant_id
      JOIN purchase_orders po ON po.id = r.po_id AND po.tenant_id = r.tenant_id
     WHERE r.tenant_id = ${tenantId}
       ${ids ? tx`AND r.id = ANY(${ids}::uuid[])` : tx``}
       ${poId ? tx`AND r.po_id = ${poId}` : tx``}
       ${venueId ? tx`AND r.venue_id = ${venueId}` : tx``}
       ${supplierId ? tx`AND r.supplier_id = ${supplierId}` : tx``}
       ${statuses?.length ? tx`AND r.status = ANY(${statuses}::text[])` : tx``}
       ${owed || overdueBefore ? tx`AND r.status IN ('open', 'sent')` : tx``}
       ${overdueBefore ? tx`AND r.returned_at <= ${overdueBefore}` : tx``}
     ORDER BY r.returned_at DESC, r.number DESC
     LIMIT ${Math.min(Math.max(Number(limit) || 200, 1), 500)}
     ${lock ? tx`FOR UPDATE OF r` : tx``}`
}

/** One return of the group, or 404. */
export async function loadReturn(tx, tenantId, id, { lock = false } = {}) {
  const [r] = await loadReturns(tx, tenantId, { ids: [id], limit: 1, lock })
  if (!r) throw httpError(404, 'Return not found')
  return r
}

/** The lines of these returns: Map(return_id -> [line]). */
export async function loadReturnLines(tx, tenantId, returnIds) {
  if (!returnIds.length) return new Map()
  const rows = await tx`
    SELECT rl.id, rl.return_id, rl.po_line_id, rl.item_id, rl.item_name, rl.product_name, rl.supplier_code, rl.pack_label,
           rl.base_unit, rl.pack_base_qty::float8 AS pack_base_qty, rl.qty::float8 AS qty, rl.qty_base::float8 AS qty_base,
           rl.price::float8 AS price, rl.vat_rate::float8 AS vat_rate, rl.credit_expected::float8 AS credit_expected,
           rl.reason, rl.note, rl.sort_order
      FROM purchase_return_lines rl
     WHERE rl.tenant_id = ${tenantId} AND rl.return_id = ANY(${returnIds}::uuid[])
     ORDER BY rl.return_id, rl.sort_order, rl.item_name`
  const out = new Map()
  for (const l of rows) {
    if (!out.has(l.return_id)) out.set(l.return_id, [])
    out.get(l.return_id).push(l)
  }
  return out
}

/**
 * Packs of each line of a delivery already going back on returns not
 * cancelled (returnedOf()), the return `except` left out.
 */
export async function returnedOnPo(tx, tenantId, poId, { except = null } = {}) {
  const rows = await tx`
    SELECT rl.po_line_id, rl.qty::float8 AS qty, r.status
      FROM purchase_return_lines rl
      JOIN purchase_returns r ON r.id = rl.return_id AND r.tenant_id = rl.tenant_id
     WHERE rl.tenant_id = ${tenantId} AND r.po_id = ${poId} AND r.status <> 'cancelled'
       AND (${except}::uuid IS NULL OR r.id <> ${except}::uuid)`
  return returnedOf(rows)
}

/**
 * What of a delivery can still go back: returnableLines() over its lines,
 * each with returnPrefill() (a damaged line as damaged, a substituted one as
 * the wrong item). prices: whether the price paid may be shown.
 */
export async function returnableFor(tx, tenantId, poId, { prices = false } = {}) {
  const [lines, returned] = await Promise.all([loadPoLines(tx, tenantId, poId), returnedOnPo(tx, tenantId, poId)])
  return returnableLines(lines, returned).map(l => {
    const row = {
      id: l.id, item_id: l.item_id, item_name: l.item_name, product_name: l.product_name ?? null, supplier_code: l.supplier_code ?? null,
      pack_label: l.pack_label, base_unit: l.base_unit, pack_base_qty: l.pack_base_qty, storage: l.storage,
      received_qty: l.received_qty, returned_qty: l.returned_qty, left: l.left,
      receive_status: l.receive_status ?? null, receive_note: l.receive_note ?? null, added_on_receipt: !!l.added_on_receipt,
      prefill: returnPrefill(l),
    }
    if (prices) {
      row.price = l.invoice_price ?? l.price
      row.vat_rate = l.invoice_vat_rate ?? l.vat_rate
    }
    return row
  })
}

const MONEY_LINE = ['price', 'vat_rate', 'credit_expected']

/**
 * A return as the routes send it: its lines, what may be done with it
 * (returnActions()), whether its credit is still owed and overdue, and money
 * only for people who see purchasing prices.
 */
export function returnView(r, lines = [], { prices = false, canStart = false, canApprove = false, now = new Date() } = {}) {
  const view = {
    id: r.id, number: r.number, label: returnNumberLabel(r.number), status: r.status, status_label: RETURN_STATUSES[r.status] || r.status,
    venue_id: r.venue_id, venue_name: r.venue_name, po_id: r.po_id, po_number: r.po_number, po_label: poNumberLabel(r.po_number),
    po_delivery_date: r.po_delivery_date, po_received_at: r.po_received_at,
    supplier_id: r.supplier_id, supplier_name: r.supplier_name, supplier_email: r.supplier_email ?? null,
    note: r.note ?? null, returned_at: r.returned_at, created_at: r.created_at, created_by: r.created_by,
    sent_at: r.sent_at, sent_by: r.sent_by, sent_via: r.sent_via, sent_via_label: r.sent_via ? RETURN_SENT_VIA[r.sent_via] : null,
    sent_to: r.sent_to, send_error: r.send_error,
    credit_note_number: r.credit_note_number, credit_note_date: r.credit_note_date, credited_at: r.credited_at, credited_by: r.credited_by,
    refused_at: r.refused_at, refused_by: r.refused_by, refuse_note: r.refuse_note,
    cancelled_at: r.cancelled_at, cancelled_by: r.cancelled_by, cancel_note: r.cancel_note,
    history: r.history || [], line_count: lines.length || r.line_count || 0,
    owed: creditOwed(r), overdue: creditOverdue(r, now), days_waiting: creditOwed(r) ? daysWaiting(r, now) : null,
    lines: lines.map(l => {
      const out = { ...l, reason_label: RETURN_REASONS[l.reason] || l.reason }
      if (!prices) for (const k of MONEY_LINE) delete out[k]
      return out
    }),
    ...returnActions(r, { canStart, canApprove }),
    show_prices: prices,
  }
  if (prices) {
    view.credit_expected = r.credit_expected
    view.credit_vat = r.credit_vat
    view.credit_total = Math.round((num(r.credit_expected) + num(r.credit_vat)) * 100) / 100
    view.credit_amount = r.credit_amount
    view.credit_difference = creditDifference(r)
  }
  return view
}

/** Returns with their lines, as returnView()s. */
export async function returnViews(tx, tenantId, rows, opts) {
  const lines = await loadReturnLines(tx, tenantId, rows.map(r => r.id))
  return rows.map(r => returnView(r, lines.get(r.id) || [], opts))
}

/** The group's next return number, under its lock (the transaction's). */
export async function nextReturnNumber(tx, tenantId) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'purchase_return:' + tenantId}))`
  const [{ next }] = await tx`SELECT COALESCE(max(number), 0)::int + 1 AS next FROM purchase_returns WHERE tenant_id = ${tenantId}`
  return next
}

// ── The supplier's copy ──────────────────────────────────────────

const money = n => '£' + num(n).toFixed(2)
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const address = v => [v.address_line1, v.address_line2, v.city, v.postcode].filter(Boolean)
const dayText = d => {
  if (!d) return ''
  const iso = d instanceof Date ? d.toISOString() : String(d)
  const [y, m, day] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const momentDay = (at, tz) => {
  try {
    return new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz || 'Europe/London' })
  } catch {
    return String(at).slice(0, 10)
  }
}
export const returnFileName = (r, ext) => `${returnNumberLabel(r.number)}-${String(r.supplier_name).replace(/[^\w-]+/g, '-').slice(0, 40)}.${ext}`

/** What the supplier's copy needs: the return, its lines, the venue, the group, the supplier's account and cc. */
async function documentData(tenantId, id) {
  return withTenant(tenantId, async tx => {
    const ret = await loadReturn(tx, tenantId, id)
    const lines = (await loadReturnLines(tx, tenantId, [id])).get(id) || []
    const venue = await loadVenue(tx, tenantId, ret.venue_id)
    const [tenant] = await tx`SELECT name FROM tenants WHERE id = ${tenantId}`
    const [sup] = await tx`
      SELECT s.cc_emails, COALESCE(sv.account_ref, s.account_ref) AS account_ref
        FROM suppliers s
        LEFT JOIN supplier_venues sv ON sv.supplier_id = s.id AND sv.venue_id = ${ret.venue_id} AND sv.tenant_id = s.tenant_id
       WHERE s.id = ${ret.supplier_id} AND s.tenant_id = ${tenantId}`
    return { ret, lines, venue, tenant, account_ref: sup?.account_ref ?? null, cc_emails: sup?.cc_emails ?? null }
  })
}

/** The return as an HTML page (print, and the email's table). */
export function returnHtml({ ret, lines, venue, tenant, account_ref }, { forEmail = false } = {}) {
  const rows = lines.map(l => `<tr>
      <td>${escapeHtml(l.supplier_code || '')}</td>
      <td>${escapeHtml(productOf(l))}</td>
      <td>${escapeHtml(l.pack_label)}</td>
      <td class="n">${fmtNum(l.qty)}</td>
      <td>${escapeHtml(RETURN_REASONS[l.reason] || l.reason)}${l.note ? ': ' + escapeHtml(l.note) : ''}</td>
      <td class="n">${money(l.price)}</td>
      <td class="n">${money(l.credit_expected)}</td>
    </tr>`).join('')
  const addr = address(venue)
  const body = `
  <div class="po">
    <div class="head">
      <div>
        <div class="muted">${escapeHtml(tenant?.name || '')}</div>
        <h1>Return ${returnNumberLabel(ret.number)}</h1>
        <div>Returned ${momentDay(ret.returned_at, venue.timezone)}</div>
        <div>From our order ${poNumberLabel(ret.po_number)}, delivered ${dayText(ret.po_delivery_date)}</div>
      </div>
    </div>
    <div class="parties">
      <div><div class="label">Supplier</div><strong>${escapeHtml(ret.supplier_name)}</strong>${account_ref ? `<div>Account ${escapeHtml(account_ref)}</div>` : ''}</div>
      <div><div class="label">From</div><strong>${escapeHtml(venue.name)}</strong>${addr.map(a => `<div>${escapeHtml(a)}</div>`).join('')}${venue.phone ? `<div>${escapeHtml(venue.phone)}</div>` : ''}</div>
    </div>
    <table>
      <thead><tr><th>Code</th><th>Product</th><th>Pack</th><th class="n">Qty</th><th>Why</th><th class="n">Price</th><th class="n">Credit</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Credit before VAT</td><td class="n">${money(ret.credit_expected)}</td></tr>
      <tr><td>VAT</td><td class="n">${money(ret.credit_vat)}</td></tr>
      <tr class="grand"><td>Credit expected</td><td class="n">${money(num(ret.credit_expected) + num(ret.credit_vat))}</td></tr>
    </table>
    <div class="notes">Please send a credit note for these items, quoting ${returnNumberLabel(ret.number)}.${ret.note ? '<br>' + escapeHtml(ret.note).replace(/\n/g, '<br>') : ''}</div>
  </div>`
  const css = `
    body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:0;padding:24px;font-size:13px}
    .po{max-width:760px;margin:0 auto}
    .head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}
    h1{font-size:22px;margin:4px 0}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin-bottom:2px}
    .muted{color:#666}
    .parties{display:flex;gap:40px;margin-bottom:18px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
    th{background:#f2f2f2;font-size:12px}
    .n{text-align:right;white-space:nowrap}
    .totals{width:auto;margin-left:auto;margin-top:12px}
    .totals td{border:none;padding:3px 8px}
    .grand td{font-weight:bold;border-top:2px solid #111}
    .notes{margin-top:18px;padding:10px;border:1px solid #ddd}
    @page{size:A4;margin:14mm}
    @media print{body{padding:0}}`
  if (forEmail) return `<div style="font-family:Helvetica,Arial,sans-serif"><style>${css}</style>${body}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${returnNumberLabel(ret.number)} ${escapeHtml(ret.supplier_name)}</title><style>${css}</style></head><body>${body}</body></html>`
}

/** The return as a PDF (Buffer), through pdfDoc.js. */
export function returnPdf({ ret, lines, venue, tenant, account_ref }) {
  const doc = new PdfDoc()
  const L = 40, R = A4.w - 40
  let y = 50
  doc.text(L, y, tenant?.name || '', { size: 10, gray: 0.4 })
  y += 22
  doc.text(L, y, `Return ${returnNumberLabel(ret.number)}`, { size: 18, bold: true })
  doc.text(R, y - 22, 'RETURNED', { size: 8, align: 'right', gray: 0.4 })
  doc.text(R, y, momentDay(ret.returned_at, venue.timezone), { size: 13, bold: true, align: 'right' })
  y += 16
  doc.text(L, y, fitText(`From our order ${poNumberLabel(ret.po_number)}, delivered ${dayText(ret.po_delivery_date)}`, R - L, 9), { size: 9, gray: 0.3 })
  y += 26
  const colB = L + 260
  doc.text(L, y, 'SUPPLIER', { size: 8, gray: 0.4 })
  doc.text(colB, y, 'FROM', { size: 8, gray: 0.4 })
  y += 14
  const left = [ret.supplier_name, account_ref ? `Account ${account_ref}` : null].filter(Boolean)
  const right = [venue.name, ...address(venue), venue.phone].filter(Boolean)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i]) doc.text(L, y, fitText(left[i], 240, 10, i === 0), { size: 10, bold: i === 0 })
    if (right[i]) doc.text(colB, y, fitText(right[i], R - colB, 10, i === 0), { size: 10, bold: i === 0 })
    y += 13
  }
  y += 14
  const cols = [
    { key: 'code', label: 'Code', x: L, w: 52 },
    { key: 'name', label: 'Product', x: L + 56, w: 150 },
    { key: 'pack', label: 'Pack', x: L + 210, w: 80 },
    { key: 'qty', label: 'Qty', x: L + 318, right: true },
    { key: 'why', label: 'Why', x: L + 326, w: 70 },
    { key: 'price', label: 'Price', x: L + 450, right: true },
    { key: 'credit', label: 'Credit', x: R, right: true },
  ]
  const header = () => {
    doc.box(L - 4, y - 11, R - L + 8, 16, { gray: 0.92 })
    for (const c of cols) doc.text(c.x, y, c.label, { size: 9, bold: true, align: c.right ? 'right' : 'left' })
    y += 16
  }
  header()
  for (const l of lines) {
    if (y > A4.h - 140) { doc.newPage(); y = 50; header() }
    const vals = {
      code: l.supplier_code || '', name: productOf(l), pack: l.pack_label, qty: fmtNum(l.qty),
      why: RETURN_REASONS[l.reason] || l.reason, price: money(l.price), credit: money(l.credit_expected),
    }
    for (const c of cols) doc.text(c.x, y, c.w ? fitText(vals[c.key], c.w, 9) : vals[c.key], { size: 9, align: c.right ? 'right' : 'left' })
    if (l.note) {
      y += 12
      doc.text(L + 56, y, fitText(l.note, R - L - 60, 8), { size: 8, gray: 0.35 })
    }
    doc.line(L - 4, y + 5, R + 4, y + 5, { gray: 0.85 })
    y += 16
  }
  y += 8
  const tot = [['Credit before VAT', ret.credit_expected], ['VAT', ret.credit_vat], ['Credit expected', num(ret.credit_expected) + num(ret.credit_vat)]]
  for (const [label, v] of tot) {
    if (y > A4.h - 50) { doc.newPage(); y = 50 }
    const bold = label === 'Credit expected'
    doc.text(R - 90, y, label, { size: 10, bold, align: 'right' })
    doc.text(R, y, money(v), { size: 10, bold, align: 'right' })
    y += 15
  }
  y += 12
  const notes = [`Please send a credit note for these items, quoting ${returnNumberLabel(ret.number)}.`, ret.note].filter(Boolean).join('\n')
  for (const line of wrapText(notes, R - L, 10)) {
    if (y > A4.h - 40) { doc.newPage(); y = 50 }
    doc.text(L, y, line, { size: 10 })
    y += 13
  }
  return doc.toBuffer()
}

/** A return file: { filename, contentType, content }. format: pdf | html. */
export async function returnFile(tenantId, id, format) {
  const data = await documentData(tenantId, id)
  if (format === 'html') return { filename: returnFileName(data.ret, 'html'), contentType: 'text/html; charset=utf-8', content: Buffer.from(returnHtml(data)) }
  return { filename: returnFileName(data.ret, 'pdf'), contentType: 'application/pdf', content: returnPdf(data) }
}

const historyEntry = (action, by, note = null) => ({ action, by, at: new Date().toISOString(), ...(note ? { note } : {}) })
export { historyEntry }

/**
 * Email a return to its supplier through the venue's email provider (the
 * supplier's order email, their cc list), with the PDF. Marks an open
 * return sent, or keeps the error on it; a sent one is emailed again.
 * Called after the transaction that checked the caller may: never inside one.
 */
export async function emailReturn(tenantId, id, sentBy) {
  const data = await documentData(tenantId, id)
  const { ret, venue } = data
  if (!['open', 'sent'].includes(ret.status)) throw httpError(409, 'This return is ' + RETURN_STATUSES[ret.status].toLowerCase() + ', so it isn\'t sent', { code: 'return_status' })
  if (!ret.supplier_email) throw httpError(422, `${ret.supplier_name} has no email address: add it on the Suppliers page, or mark the return sent`, { code: 'no_email' })

  const settings = await withTenant(tenantId, async tx => {
    const [s] = await tx`SELECT * FROM venue_email_settings WHERE venue_id = ${ret.venue_id} AND tenant_id = ${tenantId}`
    return s
  })
  const { provider, credentials } = emailCredentials(settings, env)
  const from = { name: settings?.from_name || venue.name || 'Macaroonie', email: settings?.from_email || env.EMAIL_FROM }
  const replyTo = settings?.reply_to || venue.email || null
  const cc = String(data.cc_emails || '').split(/[,;\s]+/).filter(e => e.includes('@'))
  const attachments = [{ filename: returnFileName(ret, 'pdf'), contentType: 'application/pdf', content: returnPdf(data) }]
  const intro = `<p>Please find our return ${returnNumberLabel(ret.number)} from ${escapeHtml(venue.name)}: goods from our order ${poNumberLabel(ret.po_number)}, delivered ${dayText(ret.po_delivery_date)}. Please send a credit note for them, quoting ${returnNumberLabel(ret.number)}.${replyTo ? ' Reply to this email with any questions.' : ''}</p>`
  const html = `${intro}${returnHtml(data, { forEmail: true })}`
  const subject = `Return ${returnNumberLabel(ret.number)} from ${venue.name}: credit note please`

  try {
    await sendEmail({ provider, credentials, from, to: ret.supplier_email, cc, replyTo, subject, html, attachments })
  } catch (err) {
    await withTenant(tenantId, tx => tx`
      UPDATE purchase_returns SET send_error = ${String(err.message || err).slice(0, 500)}, updated_at = now()
       WHERE id = ${id} AND tenant_id = ${tenantId}`)
    throw httpError(422, `Email to ${ret.supplier_name} failed: ${err.message || err}`, { code: 'email_failed' })
  }
  await withTenant(tenantId, tx => tx`
    UPDATE purchase_returns
       SET status = CASE WHEN status = 'open' THEN 'sent' ELSE status END,
           sent_at = now(), sent_by = ${sentBy}, sent_via = 'email', sent_to = ${ret.supplier_email}, send_error = NULL,
           history = history || ${tx.json([historyEntry('emailed', sentBy, 'to ' + ret.supplier_email)])}::jsonb, updated_at = now()
     WHERE id = ${id} AND tenant_id = ${tenantId} AND status IN ('open', 'sent')`)
}
