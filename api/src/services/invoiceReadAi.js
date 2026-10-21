// src/services/invoiceReadAi.js
//
// Pepper reads a supplier's invoice (or delivery note) while a delivery is
// booked in: photos or a PDF become the invoice's lines, each matched to the
// purchase order line it is for, or to another product we already buy from
// that supplier, or left as new. The order's lines go to the model as L1,
// L2 ... and the supplier's other products as C1, C2 ... so it answers with
// those short refs, which are turned back into ids here (never trusted as
// ids). Nothing is saved here: routes/invoiceRead.js stores the reading in
// purchase_invoices, and the receive route applies it once the person has
// checked it.
//
//   readInvoice({ tenantId, person, files, po, lines, catalogue, currency })
//     files:     [{ media_type, data (base64) }] images and / or PDFs
//     lines:     the order's lines (loadPoLines())
//     catalogue: the supplier's other active quotes
//                [{ id, item_id, item_name, product_name, supplier_code, pack_label }]
//     Returns { header, lines } (see toInvoice()).

import { askForJson, fileBlocks, obj, str, bool, arr, oneOf, clip, readAmount } from './aiJson.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'
import { fmtNum, round2 } from '../../../shared/procurement.js'
import { httpError } from '../middleware/error.js'

const PACK_UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'each', '']
export const MAX_CATALOGUE = 300

export const INVOICE_SCHEMA = obj({
  supplier_name: str,
  invoice_number: str,
  invoice_date: str,
  prices_include_vat: bool,
  lines: arr(obj({
    description: str,
    product_code: str,
    pack: str,
    pack_count: str,
    pack_size: str,
    pack_unit: oneOf(PACK_UNITS),
    qty: str,
    unit_price: str,
    vat_rate: str,
    line_total: str,
    is_charge: bool,
    order_line: str,
    catalogue: str,
    substitute: bool,
    qty_in_packs: str,
    price_per_pack: str,
  })),
  subtotal: str,
  vat: str,
  delivery_charge: str,
  total: str,
  notes: str,
})

export const SYSTEM_PROMPT = `You are ${ASSISTANT_NAME}, the assistant in Macaroonie, a platform restaurant groups run their restaurants on. A restaurant is booking in a delivery. You read the supplier's invoice or delivery note from photos or a PDF and write it out as data, matching each line to what the restaurant ordered. The person checks everything before it is saved.

Read every line as printed:
- description, product_code (the supplier's code or SKU, else '') and pack (the pack as printed, e.g. "6 x 2.5kg", "Case 24 x 330ml", else '') exactly as printed; fix only obvious OCR mistakes. Never invent lines, quantities or prices.
- pack_count, pack_size, pack_unit: the pack broken down. "6 x 2.5kg" is 6, 2.5, kg; "5kg" is 1, 5, kg; "24 x 330ml" is 24, 330, ml; "Tray of 30" or "30 each" is 30, 1, each. '' (and pack_unit '') when the invoice doesn't say.
- qty: the quantity invoiced, as a plain number. unit_price: the price per invoiced unit as a plain number ("12.50", no currency sign). line_total: the line's amount. vat_rate: the line's VAT % when shown ("20", "0"), else ''.
- prices_include_vat: true only when the invoice's line prices include VAT; usually they don't.
- Delivery charges, deposits, surcharges, fuel charges, discounts and credits are lines with is_charge true (a credit or discount with a minus sign). Everything else is a product.
- Totals: subtotal (before VAT), vat, delivery_charge (a separate delivery charge, else ''), total (the amount due), as plain numbers, '' when not shown. invoice_number and invoice_date (YYYY-MM-DD) when printed, else ''. supplier_name as printed.

Match each product line, using the lists in the message:
- order_line: the ref (L1, L2 ...) of the order line this invoice line is for: the same product, or what the supplier sent instead of it (then substitute true). Use each order line for the invoice line that delivers it; '' when none fits.
- catalogue: when it isn't on the order but is one of the supplier's products listed in catalogue, that product's ref (C1, C2 ...); else ''. Never both.
- Match on the product code first when both have one, else on what the product is. A different brand or variety of what was ordered is a substitute, not a new product. When unsure, leave it unmatched.
- qty_in_packs and price_per_pack: when you matched a line or a catalogue product, the quantity and the price per pack ex VAT in THAT product's pack (convert when the invoice counts in another unit: 12 x 1 kg invoiced against a 6 x 1 kg case is 2 cases); '' when unmatched or you can't convert.
- notes: one or two plain sentences on anything you couldn't read or weren't sure of (a blurred price, a page cut off, an invoice from another supplier); '' when everything was clear.

Write in plain British English.`

const keyOf = v => String(v ?? '').trim().toLowerCase()
const round4 = n => Math.round(Number(n) * 10000) / 10000

/** "2026-10-21" (or "21/10/2026") -> "2026-10-21"; anything else -> null. */
export function readDate(v) {
  const t = String(v ?? '').trim()
  let y, m, d
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (mt) [, y, m, d] = mt
  else if ((mt = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t))) [, d, m, y] = mt
  else return null
  const dt = new Date(Date.UTC(+y, +m - 1, +d))
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null
  return dt.toISOString().slice(0, 10)
}

/** The model's answer as the stored reading: numbers parsed, refs turned into ids, codes matched when the model left a line unmatched. */
export function toInvoice(raw, { lines = [], catalogue = [] } = {}) {
  const orderRef = new Map(lines.map((l, i) => ['L' + (i + 1), l]))
  const catRef = new Map(catalogue.map((q, i) => ['C' + (i + 1), q]))
  const byCode = new Map()
  const byName = new Map()
  for (const l of lines) {
    if (l.supplier_code) byCode.set(keyOf(l.supplier_code), { kind: 'line', l })
    for (const n of [l.item_name, l.product_name]) if (n && !byName.has(keyOf(n))) byName.set(keyOf(n), { kind: 'line', l })
  }
  for (const q of catalogue) {
    if (q.supplier_code && !byCode.has(keyOf(q.supplier_code))) byCode.set(keyOf(q.supplier_code), { kind: 'quote', q })
    for (const n of [q.item_name, q.product_name]) if (n && !byName.has(keyOf(n))) byName.set(keyOf(n), { kind: 'quote', q })
  }
  const incVat = raw?.prices_include_vat === true

  const out = []
  for (const r of (Array.isArray(raw?.lines) ? raw.lines : []).slice(0, 400)) {
    const description = clip(r?.description, 300)
    if (!description) continue
    const isCharge = r?.is_charge === true
    const vat = readAmount(r?.vat_rate, { max: 100 })
    const exVat = n => (n === undefined ? undefined : incVat && vat !== undefined ? n / (1 + vat / 100) : n)
    const qty = readAmount(r?.qty, { negative: isCharge, max: 100000 })
    const unit = exVat(readAmount(r?.unit_price, { negative: isCharge }))
    const total = exVat(readAmount(r?.line_total, { negative: isCharge }))
    const count = readAmount(r?.pack_count, { max: 100000 })
    const size = readAmount(r?.pack_size)
    const pu = PACK_UNITS.includes(r?.pack_unit) && r.pack_unit ? r.pack_unit : null
    const code = clip(r?.product_code, 100)

    let match = null
    if (!isCharge) {
      const ol = orderRef.get(String(r?.order_line || '').trim().toUpperCase())
      const cq = !ol ? catRef.get(String(r?.catalogue || '').trim().toUpperCase()) : null
      if (ol) match = { kind: 'line', line_id: ol.id, item_id: ol.item_id ?? null, quote_id: ol.quote_id ?? null, substitute: r?.substitute === true, how: 'pepper' }
      else if (cq) match = { kind: 'quote', line_id: null, item_id: cq.item_id, quote_id: cq.id, substitute: false, how: 'pepper' }
      else {
        const hit = (code && byCode.get(keyOf(code))) || byName.get(keyOf(description))
        if (hit?.kind === 'line') match = { kind: 'line', line_id: hit.l.id, item_id: hit.l.item_id ?? null, quote_id: hit.l.quote_id ?? null, substitute: false, how: code && byCode.get(keyOf(code)) ? 'code' : 'name' }
        else if (hit?.kind === 'quote') match = { kind: 'quote', line_id: null, item_id: hit.q.item_id, quote_id: hit.q.id, substitute: false, how: code && byCode.get(keyOf(code)) ? 'code' : 'name' }
      }
    }
    const packsQty = match ? readAmount(r?.qty_in_packs, { max: 100000 }) : undefined
    const packPrice = match ? exVat(readAmount(r?.price_per_pack)) : undefined
    const unitPrice = unit !== undefined ? unit : total !== undefined && qty ? total / qty : undefined
    out.push({
      idx: out.length,
      description,
      code: code || null,
      pack_text: clip(r?.pack, 120) || null,
      pack: pu && (size || pu === 'each') ? { count: count || 1, qty: size || 1, unit: pu } : null,
      qty: qty ?? null,
      unit_price: unitPrice !== undefined ? round4(unitPrice) : null,
      vat_rate: vat ?? null,
      line_total: total !== undefined ? round2(total) : null,
      is_charge: isCharge,
      match,
      qty_packs: packsQty ?? (qty !== undefined && qty >= 0 ? qty : null),
      price_pack: packPrice !== undefined ? round4(packPrice) : unitPrice !== undefined ? round4(unitPrice) : null,
    })
  }
  return {
    header: {
      supplier_name: clip(raw?.supplier_name, 200) || null,
      invoice_number: clip(raw?.invoice_number, 60) || null,
      invoice_date: readDate(raw?.invoice_date),
      prices_include_vat: incVat,
      subtotal: readAmount(raw?.subtotal, { negative: true }) ?? null,
      vat: readAmount(raw?.vat, { negative: true }) ?? null,
      delivery_charge: readAmount(raw?.delivery_charge, { negative: true }) ?? null,
      total: readAmount(raw?.total, { negative: true }) ?? null,
      notes: clip(raw?.notes, 600) || null,
    },
    lines: out,
  }
}

export async function readInvoice({ tenantId, person, files, po, lines, catalogue = [], currency = 'GBP' }) {
  const cat = catalogue.slice(0, MAX_CATALOGUE)
  const content = fileBlocks(files)
  content.push({
    type: 'text',
    text: (files.length === 1 ? 'The invoice is above.' : 'The invoice is above, ' + files.length + ' files in order.') + '\n' + JSON.stringify({
      supplier: po.supplier_name,
      currency,
      order: lines.map((l, i) => ({
        ref: 'L' + (i + 1),
        item: l.item_name,
        ...(l.product_name ? { product: l.product_name } : {}),
        ...(l.supplier_code ? { code: l.supplier_code } : {}),
        pack: l.pack_label,
        ordered: fmtNum(l.qty),
      })),
      catalogue: cat.map((q, i) => ({
        ref: 'C' + (i + 1),
        item: q.item_name,
        ...(q.product_name ? { product: q.product_name } : {}),
        ...(q.supplier_code ? { code: q.supplier_code } : {}),
        pack: q.pack_label,
      })),
    }),
  })
  const raw = await askForJson({ tenantId, person, system: SYSTEM_PROMPT, schema: INVOICE_SCHEMA, content, maxTokens: 32000, what: 'invoice' })
  if (!Array.isArray(raw.lines)) throw httpError(502, ASSISTANT_NAME + '\'s answer couldn\'t be read. Try again.')
  const read = toInvoice(raw, { lines, catalogue: cat })
  if (!read.lines.length) throw httpError(422, ASSISTANT_NAME + ' couldn\'t find any lines in that. Try a clearer photo or a PDF of the invoice.')
  return read
}
