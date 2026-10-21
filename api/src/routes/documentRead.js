// src/routes/documentRead.js — mounted at /api/ai
//
// Pepper reads documents for forms (migration 197). Under /api/ai so the
// longer proxy timeout for Pepper applies (scripts/ensure-nginx-ai-timeout.sh).
//
//   POST /invoices/read  { po_id, files: [{ name?, data (base64) }] }
//        A supplier invoice or delivery note while a delivery is booked in.
//        The files are kept (storage kind 'invoices') with what was read in
//        purchase_invoices; the receive route applies it (invoice_id) once
//        the person has checked it. Returns { invoice, lines, catalogue }:
//        lines matched to the order's lines (match.line_id) or to the
//        supplier's other products (match.quote_id, listed in catalogue).
//        Prices only for people who see purchasing prices.
//                                  Purchasing or Purchasing approval manage + Pepper
//   POST /receipts/read  { venue_id, file: { name?, data } }
//        A petty cash receipt: { merchant, description, date, amount,
//        vat_amount, paid_by_card, category_id, notes }. Nothing is saved.
//                                  Cash reconciliation manage + Pepper
//
// Files: JPEG, PNG, WebP or GIF photos up to 5 MB each and PDFs up to 10 MB
// (checked from their first bytes); invoices up to 6 files and 20 MB together.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireAnyPermission, permissionLevel } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { chatConfigured } from '../ai/apiKey.js'
import { getAiSettings } from '../ai/settings.js'
import { detectFile } from '../ai/attachments.js'
import { getStorage } from '../services/storageSvc.js'
import { loadPo, loadPoLines, invoiceView } from '../services/purchasingSvc.js'
import { readInvoice, MAX_CATALOGUE } from '../services/invoiceReadAi.js'
import { readReceipt } from '../services/receiptReadAi.js'
import { packLabel, quotePrice } from '../../../shared/procurement.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

const MAX_IMAGE = 5 * 1024 * 1024
const MAX_PDF = 10 * 1024 * 1024
const MAX_TOTAL = 20 * 1024 * 1024
const MAX_INVOICE_FILES = 6
const b64 = n => Math.ceil(n / 3) * 4 + 4

const FileIn = z.object({
  name: z.string().max(200).optional(),
  data: z.string().min(8).max(b64(MAX_PDF)).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'A file didn\'t arrive whole'),
})

const InvoiceBody = z.object({
  po_id: z.string().uuid(),
  files: z.array(FileIn).min(1, 'Add a photo or a PDF of the invoice').max(MAX_INVOICE_FILES, 'Up to ' + MAX_INVOICE_FILES + ' files at a time'),
})

const ReceiptBody = z.object({
  venue_id: z.string().uuid(),
  file: FileIn,
})

/** Checked files: [{ name, media_type, data, buffer }] (photos and PDFs only). */
function checkFiles(list) {
  let total = 0
  const out = list.map((f, i) => {
    const buffer = Buffer.from(f.data, 'base64')
    const label = f.name || 'File ' + (i + 1)
    let kind = null
    try { kind = detectFile(buffer, f.name || '') } catch { kind = null }
    if (!kind || (kind.kind !== 'image' && kind.kind !== 'pdf')) throw httpError(422, label + ' isn\'t a photo or a PDF: use JPEG, PNG, WebP, GIF or PDF.')
    if (buffer.length > (kind.kind === 'pdf' ? MAX_PDF : MAX_IMAGE)) {
      throw httpError(413, label + ' is too big: photos up to 5 MB, PDFs up to 10 MB.')
    }
    total += buffer.length
    return { name: String(f.name || '').slice(0, 200) || null, media_type: kind.media_type, data: f.data, buffer }
  })
  if (total > MAX_TOTAL) throw httpError(413, 'Those files are too big together: up to 20 MB at a time.')
  return out
}

async function pepperOn(tenantId) {
  if (!(await chatConfigured())) throw httpError(503, ASSISTANT_NAME + ' isn\'t set up on this server: a platform admin adds the AI key on the Platform page.')
  if (!(await getAiSettings(tenantId)).staff_enabled) throw httpError(403, ASSISTANT_NAME + ' is switched off for your group (' + ASSISTANT_NAME + ' > Settings).')
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }

export default async function documentReadRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/invoices/read', {
    bodyLimit: b64(MAX_TOTAL) + 64 * 1024,
    preHandler: [requireAnyPermission(['purchasing', 'purchasing_approve'], 'manage'), requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async req => {
    const body = InvoiceBody.parse(req.body)
    await pepperOn(req.tenantId)
    const files = checkFiles(body.files)
    const prices = (await permissionLevel(req, 'purchasing_setup')) !== 'none'

    const { po, lines, catalogue, currency } = await withTenant(req.tenantId, async tx => {
      const po = await loadPo(tx, req.tenantId, body.po_id)
      if (po.status === 'cancelled') throw httpError(409, 'A cancelled order cannot be received')
      const lines = await loadPoLines(tx, req.tenantId, po.id)
      const onOrder = new Set(lines.map(l => l.quote_id).filter(Boolean))
      const quotes = await tx`
        SELECT q.id, q.item_id, q.supplier_code, q.product_name, q.pack_name, q.pack_unit,
               q.pack_count::float8 AS pack_count, q.pack_qty::float8 AS pack_qty, q.pack_base_qty::float8 AS pack_base_qty,
               q.price::float8 AS price, q.vat_rate::float8 AS vat_rate,
               COALESCE((SELECT jsonb_object_agg(vp.venue_id::text, vp.price::float8)
                           FROM inv_quote_venue_prices vp
                          WHERE vp.quote_id = q.id AND vp.tenant_id = ${req.tenantId}), '{}'::jsonb) AS venue_prices,
               i.name AS item_name, i.base_unit, i.storage
          FROM inv_quotes q
          JOIN inv_items i ON i.id = q.item_id AND i.tenant_id = ${req.tenantId}
         WHERE q.tenant_id = ${req.tenantId} AND q.supplier_id = ${po.supplier_id} AND q.is_active AND i.is_active
         ORDER BY lower(i.name)
         LIMIT ${MAX_CATALOGUE + onOrder.size}
      `
      const [v] = await tx`SELECT currency FROM venues WHERE id = ${po.venue_id} AND tenant_id = ${req.tenantId}`
      const catalogue = quotes.filter(q => !onOrder.has(q.id)).map(q => ({ ...q, pack_label: packLabel(q) }))
      return { po, lines, catalogue, currency: v?.currency || 'GBP' }
    })

    const read = await readInvoice({
      tenantId: req.tenantId, person: { sub: req.user?.sub, email: req.user?.email },
      files, po, lines, catalogue, currency,
    })

    // Keep the files with the order (the invoice is a record of what was charged).
    const stored = []
    for (const f of files) {
      const put = await getStorage().put(req.tenantId, 'invoices', EXT[f.media_type] || 'bin', f.media_type, f.buffer)
      stored.push({ name: f.name, url: put.url, media_type: f.media_type, bytes: f.buffer.length })
    }
    const h = read.header
    const row = await withTenant(req.tenantId, async tx => {
      const [r] = await tx`
        INSERT INTO purchase_invoices ${tx({
          tenant_id: req.tenantId, po_id: po.id, files: tx.json(stored),
          supplier_name: h.supplier_name, invoice_number: h.invoice_number, invoice_date: h.invoice_date,
          prices_include_vat: h.prices_include_vat, subtotal: h.subtotal, vat: h.vat,
          delivery_charge: h.delivery_charge, total: h.total, lines: tx.json(read.lines), notes: h.notes,
          read_by: req.user?.email ?? null,
        })}
        RETURNING *, invoice_date::text AS invoice_date
      `
      return r
    })

    // The supplier's other products a line was matched to, for the review.
    const used = new Set(read.lines.map(l => l.match?.kind === 'quote' && l.match.quote_id).filter(Boolean))
    return {
      invoice: invoiceView(row, prices),
      catalogue: catalogue.filter(q => used.has(q.id)).map(q => ({
        quote_id: q.id, item_id: q.item_id, item_name: q.item_name, product_name: q.product_name,
        supplier_code: q.supplier_code, pack_label: q.pack_label, base_unit: q.base_unit, storage: q.storage,
        vat_rate: q.vat_rate, ...(prices ? { price: quotePrice(q, po.venue_id) } : {}),
      })),
    }
  })

  app.post('/receipts/read', {
    bodyLimit: b64(MAX_PDF) + 16 * 1024,
    preHandler: [requirePermission('cash_recon', 'manage'), requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async req => {
    const body = ReceiptBody.parse(req.body)
    await pepperOn(req.tenantId)
    const [file] = checkFiles([body.file])
    const { categories, currency } = await withTenant(req.tenantId, async tx => {
      const [v] = await tx`SELECT currency FROM venues WHERE id = ${body.venue_id} AND tenant_id = ${req.tenantId}`
      if (!v) throw httpError(404, 'Venue not found')
      const categories = await tx`
        SELECT id, name FROM cash_expense_categories
         WHERE venue_id = ${body.venue_id} AND tenant_id = ${req.tenantId} AND is_active
         ORDER BY sort_order, created_at
      `
      return { categories, currency: v.currency || 'GBP' }
    })
    return readReceipt({
      tenantId: req.tenantId, person: { sub: req.user?.sub, email: req.user?.email },
      file, categories, currency,
    })
  })
}
