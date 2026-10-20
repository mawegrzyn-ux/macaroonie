// src/routes/menuImport.js — mounted at /api/ai/menus
//
// A menu from a photo or PDF (Menus > New menu from a file, the venue setup
// wizard). Under /api/ai so the longer proxy timeout for Pepper applies
// (scripts/ensure-nginx-ai-timeout.sh): reading a long menu takes a minute.
//
//   POST /read     { files: [{ name?, data (base64) }], hint?, venue_id? }
//                  -> { menu: { name, tagline, service_times, sections }, notes }
//                  Pepper reads it; nothing is saved.          Menus manage + Pepper
//   POST /import   { name, venue_id?, tagline?, service_times?, sections }
//                  -> { menu_id, name, sections, dishes, new_option_groups, warnings }
//                  makes the menu (a draft, not live until published) the way
//                  Pepper's create_menu does: allergens and dietary tags matched
//                  to the group's own, option groups found or made.   Menus manage
//
// Files: JPEG, PNG, WebP or GIF photos up to 5 MB each and PDFs up to 10 MB
// (checked from their first bytes), up to 10 files and 20 MB together.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { chatConfigured } from '../ai/apiKey.js'
import { getAiSettings } from '../ai/settings.js'
import { detectFile } from '../ai/attachments.js'
import { makeContext, ToolError } from '../ai/context.js'
import { createMenuFromSections, ImportSectionIn, MAX_IMPORT_DISHES } from '../ai/tools/menus.js'
import { readMenu } from '../services/menuReadAi.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

const MAX_FILES = 10
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_PDF = 10 * 1024 * 1024
const MAX_TOTAL = 20 * 1024 * 1024
const b64 = n => Math.ceil(n / 3) * 4 + 4

const ReadBody = z.object({
  files: z.array(z.object({
    name: z.string().max(200).optional(),
    data: z.string().min(8).max(b64(MAX_PDF)).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'A file didn\'t arrive whole'),
  })).min(1, 'Add a photo or a PDF of the menu').max(MAX_FILES, 'Up to ' + MAX_FILES + ' files at a time'),
  hint: z.string().max(1000).default(''),
  venue_id: z.string().uuid().nullable().optional(),
})

const ImportBody = z.object({
  name: z.string().trim().min(1).max(120),
  venue_id: z.string().uuid().nullable().optional(),
  tagline: z.string().max(200).optional(),
  service_times: z.string().max(200).optional(),
  sections: z.array(ImportSectionIn).min(1, 'The menu has no sections').max(60),
})

const canEdit = requirePermission('menus', 'manage')

/** A tool context acting as the person (the menu routes' own permissions apply). */
function staffContext(app, req) {
  return makeContext({
    app, channel: 'staff_chat', tenantId: req.tenantId, log: req.log,
    auth: { authorization: req.headers.authorization },
    principal: { sub: req.user.sub, email: req.user.email, isPlatformAdmin: !!req.isPlatformAdmin },
    actor: req.user.email || req.user.sub,
  })
}

const asHttp = err => (err instanceof ToolError ? httpError(err.status || 422, err.message) : err)

export default async function menuImportRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/read', {
    bodyLimit: b64(MAX_TOTAL) + 64 * 1024,
    preHandler: [canEdit, requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async req => {
    const body = ReadBody.parse(req.body)
    if (!(await chatConfigured())) throw httpError(503, ASSISTANT_NAME + ' isn\'t set up on this server: a platform admin adds the AI key on the Platform page.')
    if (!(await getAiSettings(req.tenantId)).staff_enabled) throw httpError(403, ASSISTANT_NAME + ' is switched off for your group (' + ASSISTANT_NAME + ' > Settings).')

    let total = 0
    const files = body.files.map((f, i) => {
      const buffer = Buffer.from(f.data, 'base64')
      const label = f.name || 'File ' + (i + 1)
      let kind = null
      try { kind = detectFile(buffer, f.name || '') } catch { kind = null }
      if (!kind || (kind.kind !== 'image' && kind.kind !== 'pdf')) throw httpError(422, label + ' isn\'t a photo or a PDF: use JPEG, PNG, WebP, GIF or PDF.')
      if (buffer.length > (kind.kind === 'pdf' ? MAX_PDF : MAX_IMAGE)) {
        throw httpError(413, label + ' is too big: photos up to 5 MB, PDFs up to 10 MB.')
      }
      total += buffer.length
      return { media_type: kind.media_type, data: f.data }
    })
    if (total > MAX_TOTAL) throw httpError(413, 'Those files are too big together: up to 20 MB at a time.')

    const { tags, groups, currency } = await withTenant(req.tenantId, async tx => {
      const [t, g, v] = await Promise.all([
        tx`SELECT label, kind FROM menu_dietary_tags WHERE tenant_id = ${req.tenantId} ORDER BY sort_order, label`,
        tx`SELECT name FROM menu_variant_groups WHERE tenant_id = ${req.tenantId} ORDER BY name`,
        body.venue_id
          ? tx`SELECT currency FROM venues WHERE id = ${body.venue_id} AND tenant_id = ${req.tenantId}`
          : tx`SELECT currency FROM venues WHERE tenant_id = ${req.tenantId} ORDER BY created_at LIMIT 1`,
      ])
      if (body.venue_id && !v.length) throw httpError(404, 'Venue not found')
      return { tags: t, groups: g, currency: v[0]?.currency || 'GBP' }
    })
    return readMenu({
      tenantId: req.tenantId, person: { sub: req.user?.sub, email: req.user?.email },
      files, hint: body.hint, tags, groups, currency,
    })
  })

  app.post('/import', { bodyLimit: 2 * 1024 * 1024, preHandler: canEdit }, async req => {
    const body = ImportBody.parse(req.body)
    const total = body.sections.reduce((n, s) => n + s.dishes.length, 0)
    if (!total) throw httpError(422, 'The menu has no dishes')
    if (total > MAX_IMPORT_DISHES) throw httpError(422, 'A menu can be made with up to ' + MAX_IMPORT_DISHES + ' dishes at a time')
    try {
      return await createMenuFromSections(staffContext(app, req), {
        name: body.name, venue: body.venue_id || undefined,
        tagline: body.tagline || undefined, service_times: body.service_times || undefined,
        sections: body.sections,
      })
    } catch (err) {
      throw asHttp(err)
    }
  })
}
