// src/routes/allergenRead.js — mounted at /api/ai/allergens
//
// Pepper reads a supplier product's allergens off its spec sheet (inventory
// phase 8a, docs/INVENTORY.md 8.3). Under /api/ai so the longer proxy
// timeout for Pepper applies (scripts/ensure-nginx-ai-timeout.sh).
//
//   POST /read   { quote_id, files: [{ name?, data (base64) }] }  a PDF or
//                photos of the spec sheet or label -> { allergens: { key: {
//                level: contains | may_contain | free | not_said, words } },
//                product_name, notes, said, quote: { id, item, supplier,
//                product } }. Nothing is saved: the person checks the reading
//                and saves it with PUT /api/inventory/quotes/:id/allergens.
//                The file isn't kept.          Purchasing setup manage + Pepper
//
// Photos up to 5 MB each, PDFs up to 10 MB (checked from their first bytes),
// up to 4 files and 20 MB together.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { pepperOn } from '../services/aiJson.js'
import { readSpec } from '../services/allergenReadAi.js'
import { photoOrPdf } from './recipeRead.js'

const MAX_FILES = 4
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_DOC = 10 * 1024 * 1024
const MAX_TOTAL = 20 * 1024 * 1024
const b64 = n => Math.ceil(n / 3) * 4 + 4

const ReadBody = z.object({
  quote_id: z.string().uuid(),
  files: z.array(z.object({
    name: z.string().max(200).optional(),
    data: z.string().min(8).max(b64(MAX_DOC)).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'A file didn\'t arrive whole'),
  })).min(1, 'Add the product\'s spec sheet: a PDF or a photo').max(MAX_FILES, 'Up to ' + MAX_FILES + ' files at a time'),
})

/** The files as the model reads them: photos and PDFs only, checked from their first bytes. */
export function specFiles(list) {
  let total = 0
  return list.map((f, i) => {
    const buffer = Buffer.from(f.data, 'base64')
    const label = f.name || 'File ' + (i + 1)
    total += buffer.length
    if (total > MAX_TOTAL) throw httpError(413, 'Those files are too big together: up to 20 MB at a time.')
    const kind = photoOrPdf(buffer)
    if (!kind) throw httpError(422, label + ' isn\'t a photo or a PDF: use JPEG, PNG, WebP, GIF or PDF.')
    if (buffer.length > (kind.kind === 'pdf' ? MAX_DOC : MAX_IMAGE)) throw httpError(413, label + ' is too big: photos up to 5 MB, PDFs up to 10 MB.')
    return { media_type: kind.media_type, data: f.data }
  })
}

export default async function allergenReadRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/read', {
    bodyLimit: b64(MAX_TOTAL) + 64 * 1024,
    preHandler: [requirePermission('purchasing_setup', 'manage'), requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async req => {
    const body = ReadBody.parse(req.body || {})
    // The product must be the group's: its names go to the model as data.
    const [q] = await withTenant(req.tenantId, tx => tx`
      SELECT q.id, q.product_name, q.supplier_code, i.name AS item, s.name AS supplier
        FROM inv_quotes q
        JOIN inv_items i ON i.id = q.item_id AND i.tenant_id = q.tenant_id
        JOIN suppliers s ON s.id = q.supplier_id AND s.tenant_id = q.tenant_id
       WHERE q.id = ${body.quote_id} AND q.tenant_id = ${req.tenantId}`)
    if (!q) throw httpError(404, 'Supplier price not found')
    await pepperOn(req.tenantId)
    const files = specFiles(body.files)
    const spec = await readSpec({
      tenantId: req.tenantId, person: { sub: req.user?.sub, email: req.user?.email }, files,
      product: { item: q.item, supplier: q.supplier, product: q.product_name },
    })
    return { ...spec, quote: { id: q.id, item: q.item, supplier: q.supplier, product: q.product_name || q.item } }
  })
}
