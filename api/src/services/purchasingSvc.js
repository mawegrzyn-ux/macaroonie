// src/services/purchasingSvc.js
//
// Server side of purchasing (migration 153). Prices and pack maths come from
// shared/procurement.js; this file loads rows, picks quotes for a venue,
// numbers and builds purchase orders, renders them (HTML for print, Excel,
// PDF) and emails them. Every query filters tenant_id itself (the app's
// database role isn't held to row security).

import * as XLSX from 'xlsx'
import {
  chooseQuote, quotePrice, packLabel, packParts, orderTotals, lineAmounts, fitQty, packBaseQty,
  supplierForVenue, nextDeliveryDate, minutesToCutoff, poNumberLabel, fmtNum, round2,
} from '../../../shared/procurement.js'
import { localParts } from './orderSvc.js'
import { PdfDoc, A4, fitText, wrapText } from './pdfDoc.js'
import { sendEmail, emailCredentials } from './emailSvc.js'
import { env } from '../config/env.js'
import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'

const num = v => (v == null || v === '' ? 0 : Number(v))

// Same list migration 153 gives every tenant that existed then.
export const DEFAULT_CATEGORIES = [
  'Vegetables', 'Fruit', 'Herbs & Garnish', 'Meat & Poultry', 'Fish & Seafood', 'Dairy & Eggs', 'Dry Goods',
  'Oils, Sauces & Condiments', 'Bakery', 'Beverages', 'Cleaning Supplies', 'Packaging',
]

export async function seedInventoryCategories(tx, tenantId) {
  const [has] = await tx`SELECT 1 FROM inv_categories WHERE tenant_id = ${tenantId} LIMIT 1`
  if (has) return
  await tx`INSERT INTO inv_categories ${tx(DEFAULT_CATEGORIES.map((name, i) => ({ tenant_id: tenantId, name, sort_order: i })))}`
}

// ── Quotes ───────────────────────────────────────────────────────

/** Active quotes of active suppliers for these items: Map item_id -> quotes[]. */
export async function loadItemQuotes(tx, tenantId, itemIds) {
  const map = new Map()
  if (!itemIds.length) return map
  const rows = await tx`
    SELECT q.*, q.pack_base_qty::float8 AS pack_base_qty, q.price::float8 AS price, q.vat_rate::float8 AS vat_rate,
           q.pack_count::float8 AS pack_count, q.pack_qty::float8 AS pack_qty,
           q.min_qty::float8 AS min_qty, q.order_multiple::float8 AS order_multiple,
           s.name AS supplier_name,
           COALESCE((SELECT jsonb_object_agg(vp.venue_id::text, vp.price::float8)
                       FROM inv_quote_venue_prices vp
                      WHERE vp.quote_id = q.id AND vp.tenant_id = ${tenantId}), '{}'::jsonb) AS venue_prices
      FROM inv_quotes q
      JOIN suppliers s ON s.id = q.supplier_id AND s.tenant_id = ${tenantId}
     WHERE q.tenant_id = ${tenantId}
       AND q.item_id = ANY(${itemIds}::uuid[])
       AND q.is_active AND s.is_active
  `
  for (const r of rows) {
    if (!map.has(r.item_id)) map.set(r.item_id, [])
    map.get(r.item_id).push(r)
  }
  return map
}

/** Preferred quotes: Map item_id -> { default, venues: { venueId: quoteId } }. */
export async function loadPreferred(tx, tenantId, itemIds) {
  const map = new Map()
  if (!itemIds.length) return map
  const rows = await tx`
    SELECT item_id, venue_id, quote_id FROM inv_preferred
     WHERE tenant_id = ${tenantId} AND item_id = ANY(${itemIds}::uuid[])
  `
  for (const r of rows) {
    if (!map.has(r.item_id)) map.set(r.item_id, { default: null, venues: {} })
    const p = map.get(r.item_id)
    if (r.venue_id) p.venues[r.venue_id] = r.quote_id
    else p.default = r.quote_id
  }
  return map
}

/** The quote each item is ordered on at a venue: Map item_id -> { quote, how }. */
export async function resolveQuotes(tx, tenantId, venueId, itemIds) {
  const [quotes, preferred] = await Promise.all([
    loadItemQuotes(tx, tenantId, itemIds),
    loadPreferred(tx, tenantId, itemIds),
  ])
  const out = new Map()
  for (const id of itemIds) {
    const pick = chooseQuote(quotes.get(id) || [], venueId, preferred.get(id) || {})
    if (pick) out.set(id, pick)
  }
  return { picks: out, quotes }
}

/** What the restaurant sees for a quote (price only when allowed). */
export function quoteView(q, venueId, withPrice) {
  if (!q) return null
  return {
    id: q.id,
    supplier_id: q.supplier_id,
    supplier_name: q.supplier_name,
    supplier_code: q.supplier_code,
    product_name: q.product_name ?? null,
    pack_label: packLabel(q),
    pack_name: packParts(q).name,
    pack_size: packParts(q).size,
    pack_base_qty: num(q.pack_base_qty),
    min_qty: q.min_qty,
    order_multiple: q.order_multiple,
    vat_rate: num(q.vat_rate),
    ...(withPrice ? { price: quotePrice(q, venueId) } : {}),
  }
}

// ── Invoices (migration 197) ─────────────────────────────────────

const INVOICE_LINE_MONEY = ['unit_price', 'line_total', 'price_pack']
const INVOICE_MONEY = ['subtotal', 'vat', 'delivery_charge', 'total']

/** An invoice reading as the admin sees it (no prices without price access). */
export function invoiceView(row, prices) {
  const lines = (row.lines || []).map(l => {
    if (prices) return l
    const out = { ...l }
    for (const k of INVOICE_LINE_MONEY) delete out[k]
    return out
  })
  const head = {
    id: row.id, po_id: row.po_id, files: row.files || [], supplier_name: row.supplier_name,
    invoice_number: row.invoice_number, invoice_date: row.invoice_date, prices_include_vat: row.prices_include_vat,
    notes: row.notes, read_by: row.read_by, read_at: row.read_at, applied_by: row.applied_by, applied_at: row.applied_at,
  }
  if (prices) for (const k of INVOICE_MONEY) head[k] = row[k] == null ? null : Number(row[k])
  return { ...head, lines }
}

// ── Venues and suppliers ─────────────────────────────────────────

export async function loadVenue(tx, tenantId, venueId) {
  const [v] = await tx`
    SELECT v.id, v.name, v.timezone, v.currency,
           wc.address_line1, wc.address_line2, wc.city, wc.postcode, wc.phone, wc.email
      FROM venues v
      LEFT JOIN website_config wc ON wc.venue_id = v.id AND wc.tenant_id = ${tenantId}
     WHERE v.id = ${venueId} AND v.tenant_id = ${tenantId}
  `
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

export function venueNow(venue) {
  return localParts(new Date(), venue?.timezone || 'Europe/London')
}

/** Suppliers with their per-venue settings and next delivery date. */
export async function loadSuppliersForVenue(tx, tenantId, venue, supplierIds = null) {
  const rows = await tx`
    SELECT s.*, s.min_order::float8 AS min_order, s.delivery_charge::float8 AS delivery_charge,
           s.cutoff_time::text AS cutoff_time,
           sv.account_ref AS venue_account_ref, sv.delivery_days AS venue_delivery_days,
           sv.cutoff_time::text AS venue_cutoff_time
      FROM suppliers s
      LEFT JOIN supplier_venues sv ON sv.supplier_id = s.id AND sv.venue_id = ${venue.id} AND sv.tenant_id = ${tenantId}
     WHERE s.tenant_id = ${tenantId}
       ${supplierIds ? tx`AND s.id = ANY(${supplierIds}::uuid[])` : tx``}
  `
  const now = venueNow(venue)
  const out = {}
  for (const s of rows) {
    const eff = supplierForVenue(s, {
      account_ref: s.venue_account_ref, delivery_days: s.venue_delivery_days, cutoff_time: s.venue_cutoff_time,
    })
    out[s.id] = {
      id: s.id, name: s.name, email: s.email, phone: s.phone, website: s.website,
      send_method: s.send_method, email_attachment: s.email_attachment,
      min_order: s.min_order, delivery_charge: s.delivery_charge,
      ...eff,
      next_delivery: nextDeliveryDate(eff, now),
      minutes_to_cutoff: minutesToCutoff(eff.cutoff_time, now),
    }
  }
  return out
}

// ── Purchase orders ──────────────────────────────────────────────

/** Next PO number for the tenant (call inside the creating transaction). */
export async function nextPoNumber(tx, tenantId) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'po-number:' + tenantId}))`
  const [r] = await tx`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM purchase_orders WHERE tenant_id = ${tenantId}`
  return Number(r.n)
}

/**
 * Create one purchase order (status to_send) from lines
 * [{ item, quote, qty }] (item: { id, name, category_name, storage, base_unit }).
 */
export async function createPurchaseOrder(tx, tenantId, { venue, supplier, deliveryDate, notes, lines, supplyOrderId = null, createdBy = null, requestedBy = null }) {
  const number = await nextPoNumber(tx, tenantId)
  const snap = lines.map((l, i) => ({
    tenant_id: tenantId,
    item_id: l.item.id,
    quote_id: l.quote.id,
    item_name: l.item.name,
    category_name: l.item.category_name ?? null,
    storage: l.item.storage || 'ambient',
    base_unit: l.item.base_unit,
    supplier_code: l.quote.supplier_code ?? null,
    product_name: l.quote.product_name ?? null,
    pack_label: packLabel(l.quote),
    pack_base_qty: num(l.quote.pack_base_qty),
    price: quotePrice(l.quote, venue.id),
    vat_rate: num(l.quote.vat_rate),
    qty: num(l.qty),
    sort_order: i,
  }))
  const totals = orderTotals(snap, supplier.delivery_charge)
  const [po] = await tx`
    INSERT INTO purchase_orders (tenant_id, number, supply_order_id, venue_id, supplier_id, status, delivery_date,
                                 notes, subtotal, vat, delivery_charge, total, created_by, requested_by)
    VALUES (${tenantId}, ${number}, ${supplyOrderId}, ${venue.id}, ${supplier.id}, 'to_send', ${deliveryDate},
            ${notes ?? null}, ${totals.subtotal}, ${totals.vat}, ${totals.delivery_charge}, ${totals.total}, ${createdBy}, ${requestedBy})
    RETURNING *
  `
  if (snap.length) await tx`INSERT INTO purchase_order_lines ${tx(snap.map(l => ({ ...l, po_id: po.id })))}`
  return po
}

/** Lines of a PO, numbers as numbers. */
export async function loadPoLines(tx, tenantId, poId) {
  return tx`
    SELECT l.*, l.pack_base_qty::float8 AS pack_base_qty, l.price::float8 AS price, l.vat_rate::float8 AS vat_rate,
           l.qty::float8 AS qty, l.received_qty::float8 AS received_qty,
           l.invoice_price::float8 AS invoice_price, l.invoice_vat_rate::float8 AS invoice_vat_rate
      FROM purchase_order_lines l
     WHERE l.po_id = ${poId} AND l.tenant_id = ${tenantId}
     ORDER BY l.sort_order, l.item_name
  `
}

export async function loadPo(tx, tenantId, poId) {
  const [po] = await tx`
    SELECT po.*, po.delivery_date::text AS delivery_date,
           po.subtotal::float8 AS subtotal, po.vat::float8 AS vat, po.delivery_charge::float8 AS delivery_charge,
           po.total::float8 AS total,
           s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone, s.website AS supplier_website,
           s.send_method, s.email_attachment, s.cc_emails, s.contact_name AS supplier_contact,
           COALESCE(sv.account_ref, s.account_ref) AS account_ref,
           v.name AS venue_name,
           (SELECT p2.number FROM purchase_orders p2 WHERE p2.id = po.split_from AND p2.tenant_id = ${tenantId}) AS split_from_number,
           dc.id AS delivery_check_id, dc.accepted AS delivery_accepted
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = ${tenantId}
      JOIN venues v ON v.id = po.venue_id AND v.tenant_id = ${tenantId}
      LEFT JOIN supplier_venues sv ON sv.supplier_id = po.supplier_id AND sv.venue_id = po.venue_id AND sv.tenant_id = ${tenantId}
      LEFT JOIN fs_delivery_checks dc ON dc.purchase_order_id = po.id AND dc.tenant_id = ${tenantId}
     WHERE po.id = ${poId} AND po.tenant_id = ${tenantId}
  `
  if (!po) throw httpError(404, 'Purchase order not found')
  return po
}

// ── Documents ────────────────────────────────────────────────────

// The supplier's copy lists what was ordered: lines added when the delivery
// was booked in (added_on_receipt, ordered 0) aren't on it.
async function documentData(tenantId, poId) {
  return withTenant(tenantId, async tx => {
    const po = await loadPo(tx, tenantId, poId)
    const lines = (await loadPoLines(tx, tenantId, poId)).filter(l => !l.added_on_receipt)
    const venue = await loadVenue(tx, tenantId, po.venue_id)
    const [tenant] = await tx`SELECT name FROM tenants WHERE id = ${tenantId}`
    return { po, lines, venue, tenant }
  })
}

const money = n => '£' + num(n).toFixed(2)
const fmtDate = d => {
  if (!d) return ''
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const address = v => [v.address_line1, v.address_line2, v.city, v.postcode].filter(Boolean)
const isoOf = d => (d instanceof Date ? d.toISOString() : String(d ?? ''))

/**
 * What the supplier is told about an order that changed after they got it
 * (split, migration 180) or that was split off another: lines for the
 * document and the email. Empty for an ordinary order.
 */
export function poChangeNotes(po) {
  const out = []
  if (po.amended_at) {
    out.push(`Amended ${fmtDate(isoOf(po.amended_at))}: this replaces any earlier copy of ${poNumberLabel(po.number)}.`)
  }
  if (po.split_from_number) {
    out.push(`Split off ${poNumberLabel(po.split_from_number)} to come on another day.`)
  }
  return out
}
export const poFileName = (po, ext) => `${poNumberLabel(po.number)}-${String(po.supplier_name).replace(/[^\w-]+/g, '-').slice(0, 40)}.${ext}`

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** A line's product as the supplier knows it: their product name, else our item name. */
export const productOf = l => (l.product_name && l.product_name.trim()) || l.item_name

/** The PO as an HTML page (print, and the email body table). */
export function poHtml({ po, lines, venue, tenant }, { forEmail = false } = {}) {
  const rows = lines.map(l => {
    const a = lineAmounts(l)
    return `<tr>
      <td>${escapeHtml(l.supplier_code || '')}</td>
      <td>${escapeHtml(productOf(l))}</td>
      <td>${escapeHtml(l.pack_label)}</td>
      <td class="n">${fmtNum(l.qty)}</td>
      <td class="n">${money(l.price)}</td>
      <td class="n">${a.net ? money(a.net) : ''}</td>
    </tr>`
  }).join('')
  const addr = address(venue)
  const body = `
  <div class="po">
    <div class="head">
      <div>
        <div class="muted">${escapeHtml(tenant?.name || '')}</div>
        <h1>Purchase order ${poNumberLabel(po.number)}${po.amended_at ? ' (amended)' : ''}</h1>
        <div>Ordered ${fmtDate(String(po.created_at.toISOString?.() ?? po.created_at))}</div>
        ${poChangeNotes(po).map(t => `<div class="change">${escapeHtml(t)}</div>`).join('')}
      </div>
      <div class="right">
        <div class="label">Delivery</div>
        <div class="big">${fmtDate(po.delivery_date)}</div>
      </div>
    </div>
    <div class="parties">
      <div><div class="label">Supplier</div><strong>${escapeHtml(po.supplier_name)}</strong>${po.account_ref ? `<div>Account ${escapeHtml(po.account_ref)}</div>` : ''}</div>
      <div><div class="label">Deliver to</div><strong>${escapeHtml(venue.name)}</strong>${addr.map(a => `<div>${escapeHtml(a)}</div>`).join('')}${venue.phone ? `<div>${escapeHtml(venue.phone)}</div>` : ''}</div>
    </div>
    <table>
      <thead><tr><th>Code</th><th>Product</th><th>Pack</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="n">${money(po.subtotal)}</td></tr>
      <tr><td>VAT</td><td class="n">${money(po.vat)}</td></tr>
      ${num(po.delivery_charge) ? `<tr><td>Delivery charge</td><td class="n">${money(po.delivery_charge)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="n">${money(po.total)}</td></tr>
    </table>
    ${po.notes ? `<div class="notes"><div class="label">Notes</div>${escapeHtml(po.notes).replace(/\n/g, '<br>')}</div>` : ''}
  </div>`
  const css = `
    body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:0;padding:24px;font-size:13px}
    .po{max-width:760px;margin:0 auto}
    .head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}
    h1{font-size:22px;margin:4px 0}
    .right{text-align:right}.big{font-size:18px;font-weight:bold}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin-bottom:2px}
    .muted{color:#666}
    .change{margin-top:4px;font-weight:bold;color:#9a3412}
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>${poNumberLabel(po.number)} ${escapeHtml(po.supplier_name)}</title><style>${css}</style></head><body>${body}</body></html>`
}

/** The PO as an Excel workbook (Buffer). */
export function poXlsx({ po, lines, venue, tenant }) {
  const aoa = [
    [`Purchase order ${poNumberLabel(po.number)}${po.amended_at ? ' (amended)' : ''}`],
    ...poChangeNotes(po).map(t => [t]),
    ['From', tenant?.name || '', 'Venue', venue.name],
    ['Supplier', po.supplier_name, 'Account', po.account_ref || ''],
    ['Delivery date', po.delivery_date, 'Deliver to', address(venue).join(', ')],
    [],
    ['Code', 'Product', 'Pack', 'Qty', 'Price', 'VAT %', 'Total ex VAT'],
    ...lines.map(l => [l.supplier_code || '', productOf(l), l.pack_label, num(l.qty), num(l.price), num(l.vat_rate), lineAmounts(l).net]),
    [],
    ['', '', '', '', '', 'Subtotal', num(po.subtotal)],
    ['', '', '', '', '', 'VAT', num(po.vat)],
    ...(num(po.delivery_charge) ? [['', '', '', '', '', 'Delivery charge', num(po.delivery_charge)]] : []),
    ['', '', '', '', '', 'Total', num(po.total)],
    ...(po.notes ? [[], ['Notes', po.notes]] : []),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, poNumberLabel(po.number))
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/** The PO as a PDF (Buffer). */
export function poPdf({ po, lines, venue, tenant }) {
  const doc = new PdfDoc()
  const L = 40, R = A4.w - 40
  let y = 50
  doc.text(L, y, tenant?.name || '', { size: 10, gray: 0.4 })
  y += 22
  doc.text(L, y, `Purchase order ${poNumberLabel(po.number)}${po.amended_at ? ' (amended)' : ''}`, { size: 18, bold: true })
  doc.text(R, y - 22, 'DELIVERY', { size: 8, align: 'right', gray: 0.4 })
  doc.text(R, y, fmtDate(po.delivery_date), { size: 13, bold: true, align: 'right' })
  y += 16
  doc.text(L, y, `Ordered ${fmtDate(po.created_at instanceof Date ? po.created_at.toISOString() : po.created_at)}`, { size: 9, gray: 0.3 })
  for (const t of poChangeNotes(po)) {
    y += 13
    doc.text(L, y, fitText(t, R - L, 9, true), { size: 9, bold: true })
  }
  y += 26
  const colB = L + 260
  doc.text(L, y, 'SUPPLIER', { size: 8, gray: 0.4 })
  doc.text(colB, y, 'DELIVER TO', { size: 8, gray: 0.4 })
  y += 14
  const left = [po.supplier_name, po.account_ref ? `Account ${po.account_ref}` : null].filter(Boolean)
  const right = [venue.name, ...address(venue), venue.phone].filter(Boolean)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i]) doc.text(L, y, fitText(left[i], 240, 10, i === 0), { size: 10, bold: i === 0 })
    if (right[i]) doc.text(colB, y, fitText(right[i], R - colB, 10, i === 0), { size: 10, bold: i === 0 })
    y += 13
  }
  y += 14

  const cols = [
    { key: 'code', label: 'Code', x: L, w: 60 },
    { key: 'name', label: 'Product', x: L + 64, w: 190 },
    { key: 'pack', label: 'Pack', x: L + 258, w: 110 },
    { key: 'qty', label: 'Qty', x: L + 400, right: true },
    { key: 'price', label: 'Price', x: L + 452, right: true },
    { key: 'total', label: 'Total', x: R, right: true },
  ]
  const header = () => {
    doc.box(L - 4, y - 11, R - L + 8, 16, { gray: 0.92 })
    for (const c of cols) doc.text(c.right ? c.x : c.x, y, c.label, { size: 9, bold: true, align: c.right ? 'right' : 'left' })
    y += 16
  }
  header()
  for (const l of lines) {
    if (y > A4.h - 120) { doc.newPage(); y = 50; header() }
    const a = lineAmounts(l)
    const vals = { code: l.supplier_code || '', name: productOf(l), pack: l.pack_label, qty: fmtNum(l.qty), price: money(l.price), total: money(a.net) }
    for (const c of cols) {
      const v = c.w ? fitText(vals[c.key], c.w, 9) : vals[c.key]
      doc.text(c.x, y, v, { size: 9, align: c.right ? 'right' : 'left' })
    }
    doc.line(L - 4, y + 5, R + 4, y + 5, { gray: 0.85 })
    y += 16
  }
  y += 8
  const tot = [['Subtotal', po.subtotal], ['VAT', po.vat], ...(num(po.delivery_charge) ? [['Delivery charge', po.delivery_charge]] : []), ['Total', po.total]]
  for (const [label, v] of tot) {
    if (y > A4.h - 50) { doc.newPage(); y = 50 }
    const bold = label === 'Total'
    doc.text(R - 90, y, label, { size: 10, bold, align: 'right' })
    doc.text(R, y, money(v), { size: 10, bold, align: 'right' })
    y += 15
  }
  if (po.notes) {
    y += 12
    doc.text(L, y, 'NOTES', { size: 8, gray: 0.4 })
    y += 13
    for (const line of wrapText(po.notes, R - L, 10)) {
      if (y > A4.h - 40) { doc.newPage(); y = 50 }
      doc.text(L, y, line, { size: 10 })
      y += 13
    }
  }
  return doc.toBuffer()
}

/** A PO file: { filename, contentType, content }. format: html | xlsx | pdf. */
export async function poFile(tenantId, poId, format) {
  const data = await documentData(tenantId, poId)
  if (format === 'xlsx') {
    return { filename: poFileName(data.po, 'xlsx'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: poXlsx(data) }
  }
  if (format === 'pdf') {
    return { filename: poFileName(data.po, 'pdf'), contentType: 'application/pdf', content: poPdf(data) }
  }
  return { filename: poFileName(data.po, 'html'), contentType: 'text/html; charset=utf-8', content: Buffer.from(poHtml(data)) }
}

/**
 * Email a PO to its supplier through the venue's email provider, with the
 * supplier's chosen attachment. Marks it sent, or records the error.
 */
export async function emailPo(tenantId, poId, sentBy) {
  const data = await documentData(tenantId, poId)
  const { po, venue } = data
  if (po.status === 'cancelled') throw httpError(422, 'This order is cancelled')
  if (!po.supplier_email) throw httpError(422, `${po.supplier_name} has no order email address`)

  const settings = await withTenant(tenantId, async tx => {
    const [s] = await tx`SELECT * FROM venue_email_settings WHERE venue_id = ${po.venue_id} AND tenant_id = ${tenantId}`
    return s
  })
  const { provider, credentials } = emailCredentials(settings, env)
  const from = { name: settings?.from_name || venue.name || 'Macaroonie', email: settings?.from_email || env.EMAIL_FROM }
  const replyTo = settings?.reply_to || venue.email || null
  const cc = String(po.cc_emails || '').split(/[,;\s]+/).filter(e => e.includes('@'))
  const attachments = []
  if (po.email_attachment === 'pdf')   attachments.push({ filename: poFileName(po, 'pdf'),  contentType: 'application/pdf', content: poPdf(data) })
  if (po.email_attachment === 'excel') attachments.push({ filename: poFileName(po, 'xlsx'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: poXlsx(data) })

  const amended = !!po.amended_at
  const intro = `<p>${amended ? 'Please note our amended order' : 'Please find our order'} ${poNumberLabel(po.number)} for delivery on <strong>${fmtDate(po.delivery_date)}</strong> to ${escapeHtml(venue.name)}.${amended ? ' It replaces the copy we sent earlier: the quantities have changed.' : ''}${po.split_from_number ? ` It is part of ${poNumberLabel(po.split_from_number)}, split off to come on another day.` : ''}${replyTo ? ` Reply to this email with any questions.` : ''}</p>`
  const html = `${intro}${poHtml(data, { forEmail: true })}`
  const subject = `${amended ? 'Amended order' : 'Order'} ${poNumberLabel(po.number)} from ${venue.name} for ${fmtDate(po.delivery_date)}`

  try {
    await sendEmail({ provider, credentials, from, to: po.supplier_email, cc, replyTo, subject, html, attachments })
  } catch (err) {
    await withTenant(tenantId, tx => tx`
      UPDATE purchase_orders SET send_error = ${String(err.message || err).slice(0, 500)}, updated_at = now()
       WHERE id = ${poId} AND tenant_id = ${tenantId}
    `)
    throw httpError(422, `Email to ${po.supplier_name} failed: ${err.message || err}`)
  }
  const [row] = await withTenant(tenantId, tx => tx`
    UPDATE purchase_orders
       SET status = CASE WHEN status = 'to_send' THEN 'sent' ELSE status END,
           sent_at = now(), sent_by = ${sentBy}, sent_via = 'email', sent_to = ${po.supplier_email},
           send_error = NULL, updated_at = now()
     WHERE id = ${poId} AND tenant_id = ${tenantId}
     RETURNING id, status
  `)
  return row
}

export { packBaseQty, fitQty, round2 }
