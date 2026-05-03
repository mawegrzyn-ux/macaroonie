// src/routes/media.js
//
// Per-tenant media library API. Mounted at /api/media.
//
//   Categories:
//     GET    /categories
//     POST   /categories
//     PATCH  /categories/:id
//     DELETE /categories/:id
//
//   Items:
//     GET    /items                     — list with filters
//     GET    /items/scopes              — distinct scope values seen in this tenant (drives form filter)
//     GET    /items/check-duplicate     — pre-upload check (filename + hash within scope)
//     POST   /items/upload              — multipart upload, creates item
//     PATCH  /items/:id                 — rename / change category / change scope
//     DELETE /items/:id                 — delete file + record
//     POST   /items/bulk                — bulk move / delete

import crypto from 'node:crypto'
import { z }  from 'zod'

// sharp is loaded lazily — it's a native module that occasionally fails to
// install on minimal containers. If it's missing we skip dimension extraction
// rather than crash the entire API.
let _sharp = null
async function loadSharp() {
  if (_sharp !== null) return _sharp
  try {
    const mod = await import('sharp')
    _sharp = mod.default || mod
  } catch {
    _sharp = false   // sentinel: tried, not available
  }
  return _sharp
}
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { getStorage } from '../services/storageSvc.js'

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
])
const MAX_BYTES = 12 * 1024 * 1024  // 12 MB per file

const CategoryBody = z.object({
  name: z.string().min(1).max(100).trim(),
})

const ItemPatch = z.object({
  filename:    z.string().min(1).max(255).optional(),
  category_id: z.string().uuid().nullable().optional(),
  scope:       z.string().min(1).max(100).optional(),
})

const BulkBody = z.object({
  action:      z.enum(['delete', 'move-category', 'move-scope']),
  ids:         z.array(z.string().uuid()).min(1).max(500),
  category_id: z.string().uuid().nullable().optional(),
  scope:       z.string().min(1).max(100).optional(),
})

function extFromMime(mime) {
  switch (mime) {
    case 'image/jpeg':    return 'jpg'
    case 'image/png':     return 'png'
    case 'image/webp':    return 'webp'
    case 'image/gif':     return 'gif'
    case 'image/svg+xml': return 'svg'
    default:              return 'bin'
  }
}

export default async function mediaRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Categories ────────────────────────────────────────────

  app.get('/categories', async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    return withTenant(req.tenantId, tx => tx`
      SELECT mc.id, mc.name, mc.sort_order, mc.created_at,
             COUNT(mi.id)::int AS item_count
        FROM media_categories mc
        LEFT JOIN media_items mi ON mi.category_id = mc.id
       WHERE mc.tenant_id = ${req.tenantId}
       GROUP BY mc.id
       ORDER BY mc.sort_order, lower(mc.name)
    `)
  })

  app.post('/categories', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body = CategoryBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO media_categories (tenant_id, name)
      VALUES (${req.tenantId}, ${body.name})
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  app.patch('/categories/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body = CategoryBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE media_categories
         SET name = ${body.name}, updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Category not found')
    return row
  })

  app.delete('/categories/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    // ON DELETE SET NULL on media_items.category_id handles orphans automatically
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM media_categories
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Category not found')
    return { ok: true }
  })

  // ── Items: scope dropdown ─────────────────────────────────
  // Returns the distinct scope values present for this tenant — used by
  // the form-filter dropdown. Always includes 'shared' as the first entry.
  app.get('/items/scopes', async (req) => {
    if (!req.tenantId) return ['shared']
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT DISTINCT scope FROM media_items
       WHERE tenant_id = ${req.tenantId}
       ORDER BY scope
    `)
    const scopes = rows.map(r => r.scope)
    if (!scopes.includes('shared')) scopes.unshift('shared')
    return scopes
  })

  // ── Items: list ──────────────────────────────────────────
  app.get('/items', async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const limit  = Math.min(Number(req.query.limit) || 200, 500)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const search = (req.query.search || '').trim().toLowerCase()
    const scope  = req.query.scope || null            // 'shared' | '<form_key>' | null (all)
    const categoryId = req.query.category_id || null  // uuid | 'none' | null (all)

    return withTenant(req.tenantId, tx => tx`
      SELECT mi.*, mc.name AS category_name
        FROM media_items mi
   LEFT JOIN media_categories mc ON mc.id = mi.category_id
       WHERE mi.tenant_id = ${req.tenantId}
         ${scope ? tx`AND mi.scope = ${scope}` : tx``}
         ${categoryId === 'none'
            ? tx`AND mi.category_id IS NULL`
            : categoryId
              ? tx`AND mi.category_id = ${categoryId}`
              : tx``}
         ${search ? tx`AND lower(mi.filename) LIKE ${'%' + search + '%'}` : tx``}
       ORDER BY mi.created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `)
  })

  // ── Items: duplicate pre-check ───────────────────────────
  // Body: { filename, hash?, scope? }
  app.post('/items/check-duplicate', async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const { filename, hash, scope = 'shared' } = z.object({
      filename: z.string().min(1),
      hash:     z.string().optional(),
      scope:    z.string().optional(),
    }).parse(req.body)

    return withTenant(req.tenantId, tx => tx`
      SELECT id, filename, url, scope, created_at
        FROM media_items
       WHERE tenant_id = ${req.tenantId}
         AND scope = ${scope}
         AND (lower(filename) = lower(${filename}) ${hash ? tx`OR hash = ${hash}` : tx``})
       LIMIT 5
    `)
  })

  // ── Items: upload ────────────────────────────────────────
  // Form fields: file, scope (default 'shared'), category_id (optional)
  app.post('/items/upload', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    if (!req.isMultipart()) throw httpError(400, 'Expected multipart/form-data')

    let scope = 'shared'
    let categoryId = null
    let fileData = null

    for await (const part of req.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'scope')       scope = String(part.value || 'shared').slice(0, 100)
        if (part.fieldname === 'category_id') categoryId = part.value && part.value !== 'null' ? String(part.value) : null
      } else if (part.type === 'file' && part.fieldname === 'file') {
        if (!ALLOWED_MIMES.has(part.mimetype)) {
          throw httpError(422, `Unsupported file type: ${part.mimetype}`)
        }
        const chunks = []
        let total = 0
        for await (const chunk of part.file) {
          total += chunk.length
          if (total > MAX_BYTES) throw httpError(413, `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit`)
          chunks.push(chunk)
        }
        fileData = {
          buffer:   Buffer.concat(chunks),
          mimetype: part.mimetype,
          filename: part.filename || `image.${extFromMime(part.mimetype)}`,
        }
      }
    }
    if (!fileData) throw httpError(400, 'No file provided')

    // Validate category belongs to this tenant
    if (categoryId) {
      const [exists] = await withTenant(req.tenantId, tx => tx`
        SELECT id FROM media_categories WHERE id = ${categoryId} AND tenant_id = ${req.tenantId}
      `)
      if (!exists) throw httpError(422, 'Invalid category_id')
    }

    // Hash + dimensions
    const hash = crypto.createHash('sha256').update(fileData.buffer).digest('hex')
    let width = null, height = null
    const sharp = await loadSharp()
    if (sharp) {
      try {
        const meta = await sharp(fileData.buffer).metadata()
        width  = meta.width  || null
        height = meta.height || null
      } catch { /* SVG/gif may not yield metadata; non-fatal */ }
    }

    const ext = extFromMime(fileData.mimetype)
    const storage = getStorage()
    const result = await storage.put(req.tenantId, 'media', ext, fileData.mimetype, fileData.buffer)

    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO media_items
        (tenant_id, category_id, scope, filename, url, storage_key,
         mimetype, bytes, width, height, hash)
      VALUES
        (${req.tenantId}, ${categoryId}, ${scope}, ${fileData.filename},
         ${result.url}, ${result.key}, ${fileData.mimetype},
         ${fileData.buffer.length}, ${width}, ${height}, ${hash})
      RETURNING *
    `)

    return reply.code(201).send(row)
  })

  // ── Items: replace file content (used by image editor) ──
  // Multipart upload that REPLACES the file behind an existing item.
  // The DB row keeps its id (so anywhere referencing the item by id
  // continues to work). url + storage_key + bytes + dimensions + hash
  // are updated. The OLD file is deleted from storage best-effort.
  // Form fields: file (required)
  app.post('/items/:id/replace', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    if (!req.isMultipart()) throw httpError(400, 'Expected multipart/form-data')

    const [existing] = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM media_items WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
    `)
    if (!existing) throw httpError(404, 'Item not found')

    let fileData = null
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        if (!ALLOWED_MIMES.has(part.mimetype)) {
          throw httpError(422, `Unsupported file type: ${part.mimetype}`)
        }
        const chunks = []
        let total = 0
        for await (const chunk of part.file) {
          total += chunk.length
          if (total > MAX_BYTES) throw httpError(413, `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit`)
          chunks.push(chunk)
        }
        fileData = { buffer: Buffer.concat(chunks), mimetype: part.mimetype, filename: part.filename || existing.filename }
      }
    }
    if (!fileData) throw httpError(400, 'No file provided')

    const hash = crypto.createHash('sha256').update(fileData.buffer).digest('hex')
    let width = null, height = null
    const sharp = await loadSharp()
    if (sharp) {
      try {
        const meta = await sharp(fileData.buffer).metadata()
        width  = meta.width  || null
        height = meta.height || null
      } catch { /* non-fatal */ }
    }

    const ext = extFromMime(fileData.mimetype)
    const storage = getStorage()
    const result  = await storage.put(req.tenantId, 'media', ext, fileData.mimetype, fileData.buffer)

    const [updated] = await withTenant(req.tenantId, tx => tx`
      UPDATE media_items
         SET url = ${result.url},
             storage_key = ${result.key},
             mimetype = ${fileData.mimetype},
             bytes = ${fileData.buffer.length},
             width = ${width},
             height = ${height},
             hash  = ${hash},
             updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING *
    `)

    // Delete old file (best-effort — the DB row already points at the new file)
    if (existing.url) {
      try { await storage.delete(existing.url) } catch (e) { req.log.warn({ err: e?.message }, 'Old file delete failed') }
    }

    return reply.code(200).send(updated)
  })

  // ── Items: patch (rename, recategorize, rescope) ──────────
  app.patch('/items/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body = ItemPatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    if (body.category_id) {
      const [exists] = await withTenant(req.tenantId, tx => tx`
        SELECT id FROM media_categories WHERE id = ${body.category_id} AND tenant_id = ${req.tenantId}
      `)
      if (!exists) throw httpError(422, 'Invalid category_id')
    }

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE media_items
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Item not found')
    return row
  })

  // ── Items: delete ─────────────────────────────────────────
  app.delete('/items/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')

    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM media_items
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING url, storage_key
    `)
    if (!row) throw httpError(404, 'Item not found')

    // Best-effort storage cleanup (don't fail the request if backend removal fails)
    try { await getStorage().delete(row.url) } catch (e) { req.log.warn({ err: e?.message }, 'Storage delete failed') }

    return { ok: true }
  })

  // ── Items: bulk ───────────────────────────────────────────
  app.post('/items/bulk', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body = BulkBody.parse(req.body)

    if (body.action === 'delete') {
      const rows = await withTenant(req.tenantId, tx => tx`
        DELETE FROM media_items
         WHERE id = ANY(${body.ids}::uuid[]) AND tenant_id = ${req.tenantId}
        RETURNING url, storage_key
      `)
      // Fire-and-forget storage deletes
      const storage = getStorage()
      Promise.allSettled(rows.map(r => storage.delete(r.url))).catch(() => {})
      return { ok: true, count: rows.length }
    }

    if (body.action === 'move-category') {
      const targetCat = body.category_id ?? null
      if (targetCat) {
        const [exists] = await withTenant(req.tenantId, tx => tx`
          SELECT id FROM media_categories WHERE id = ${targetCat} AND tenant_id = ${req.tenantId}
        `)
        if (!exists) throw httpError(422, 'Invalid category_id')
      }
      const rows = await withTenant(req.tenantId, tx => tx`
        UPDATE media_items
           SET category_id = ${targetCat}, updated_at = now()
         WHERE id = ANY(${body.ids}::uuid[]) AND tenant_id = ${req.tenantId}
        RETURNING id
      `)
      return { ok: true, count: rows.length }
    }

    if (body.action === 'move-scope') {
      if (!body.scope) throw httpError(400, 'scope required for move-scope action')
      const rows = await withTenant(req.tenantId, tx => tx`
        UPDATE media_items
           SET scope = ${body.scope}, updated_at = now()
         WHERE id = ANY(${body.ids}::uuid[]) AND tenant_id = ${req.tenantId}
        RETURNING id
      `)
      return { ok: true, count: rows.length }
    }

    throw httpError(400, 'Unknown action')
  })
}
