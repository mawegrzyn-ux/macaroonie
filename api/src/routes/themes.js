// src/routes/themes.js — mounted at /api/ai/themes
//
// The theme maker (shared/themeKit.js, services/themeAi.js): Pepper makes
// themes from a picture and a few words. Under /api/ai so the longer proxy
// timeout for Pepper applies (scripts/ensure-nginx-ai-timeout.sh).
//
//   POST /   { target, prompt?, image?: { media_type, data (base64) },
//              palette?: [{ hex, share }], current?, like?, count? }
//            -> { kits, notes }                 the target's module manage + Pepper
//
// target: website (Website > Brand & theme), kiosk (kiosk designs), board
// (menu screens), print (printed menu designs). Nothing is saved: the
// picture isn't kept, and the designer fills its form for the person to
// save. Without Pepper the admin makes themes from the picture's colours
// alone (kitsFromPalette()), without calling this.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { chatConfigured } from '../ai/apiKey.js'
import { getAiSettings } from '../ai/settings.js'
import { detectFile } from '../ai/attachments.js'
import { suggestThemes } from '../services/themeAi.js'
import { KIT_TARGETS } from '../../../shared/themeKit.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

// Which page's Manage a theme for each target needs.
export const TARGET_MODULE = { website: 'website', kiosk: 'pos_setup', board: 'screens', print: 'menus' }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const KitLike = z.record(z.string(), z.any())
  .refine(v => JSON.stringify(v).length <= 6000, 'That theme is too big')

const Body = z.object({
  target:  z.enum(KIT_TARGETS),
  prompt:  z.string().max(1000).default(''),
  image:   z.object({
    media_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    data:       z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'The picture didn\'t arrive whole'),
  }).nullable().optional(),
  palette: z.array(z.object({
    hex:   z.string().regex(/^#[0-9a-f]{6}$/i),
    share: z.number().min(0).max(1),
  })).max(12).default([]),
  current: KitLike.nullable().optional(),
  like:    KitLike.nullable().optional(),
  count:   z.number().int().min(1).max(4).default(3),
})

// The target's own page: its Manage, as for saving the theme there.
async function canTheme(req, reply) {
  const module = TARGET_MODULE[req.body?.target]
  if (!module) return // the body check refuses it
  return requirePermission(module, 'manage')(req, reply)
}

export default async function themeRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/', { bodyLimit: 8 * 1024 * 1024, preHandler: [requirePermission('ai_assistant', 'view'), canTheme] }, async req => {
    const body = Body.parse(req.body)
    if (!body.prompt.trim() && !body.image && !body.like) {
      throw httpError(422, 'Add a picture or say what look you want.')
    }
    if (!(await chatConfigured())) throw httpError(503, ASSISTANT_NAME + ' isn\'t set up on this server: a platform admin adds the AI key on the Platform page.')
    if (!(await getAiSettings(req.tenantId)).staff_enabled) throw httpError(403, ASSISTANT_NAME + ' is switched off for your group (' + ASSISTANT_NAME + ' > Settings).')

    let image = null
    if (body.image) {
      const buffer = Buffer.from(body.image.data, 'base64')
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw httpError(413, 'That picture is too big: use one under 5 MB.')
      let kind = null
      try { kind = detectFile(buffer) } catch { kind = null }
      if (kind?.kind !== 'image') throw httpError(422, 'That isn\'t a picture we can read: use a JPEG, PNG, WebP or GIF.')
      image = { media_type: kind.media_type, data: body.image.data }
    }

    const [site] = await withTenant(req.tenantId, tx => tx`
      SELECT t.name AS tenant_name, s.site_name, s.brand_name, s.tagline
        FROM tenants t LEFT JOIN tenant_site s ON s.tenant_id = t.id
       WHERE t.id = ${req.tenantId}
    `)
    const brand = site ? { name: site.brand_name || site.site_name || site.tenant_name || '', tagline: site.tagline || '' } : null

    return suggestThemes({
      tenantId: req.tenantId,
      person: { sub: req.user.sub, email: req.user.email },
      target: body.target,
      prompt: body.prompt.trim(),
      image,
      palette: body.palette,
      current: body.current || null,
      like: body.like || null,
      brand,
      count: body.count,
    })
  })
}
