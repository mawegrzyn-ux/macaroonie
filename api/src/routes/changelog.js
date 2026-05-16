// src/routes/changelog.js
//
// Platform changelog — admins write, all tenants read.
// Mounted at /api/changelog in app.js.

import { z }          from 'zod'
import { sql }        from '../config/db.js'
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'

// ── Schemas ───────────────────────────────────────────────────

const ChangelogBody = z.object({
  title:           z.string().min(1).max(300),
  version:         z.string().max(50).nullable().optional(),
  body:            z.string().nullable().optional(),
  type:            z.enum(['feature','fix','improvement','security','breaking','maintenance']).default('feature'),
  backlog_item_ids: z.array(z.string().uuid()).default([]),
})

const ChangelogPatch = z.object({
  title:            z.string().min(1).max(300).optional(),
  version:          z.string().max(50).nullable().optional(),
  body:             z.string().nullable().optional(),
  type:             z.enum(['feature','fix','improvement','security','breaking','maintenance']).optional(),
  backlog_item_ids: z.array(z.string().uuid()).optional(),
  is_published:     z.boolean().optional(),
})

// ── Plugin ────────────────────────────────────────────────────

export default async function changelogRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET /changelog ────────────────────────────────────────
  // Non-platform-admins: only published entries, published_at DESC.
  // Platform admins: all entries, created_at DESC.
  app.get('/', async (req) => {
    if (req.isPlatformAdmin) {
      return sql`
        SELECT * FROM changelog_entries
         ORDER BY created_at DESC
         LIMIT 200
      `
    }

    return sql`
      SELECT * FROM changelog_entries
       WHERE is_published = true
       ORDER BY published_at DESC
       LIMIT 200
    `
  })

  // ── POST /changelog ───────────────────────────────────────
  app.post('/', { preHandler: requirePlatformAdmin }, async (req) => {
    const body = ChangelogBody.parse(req.body)

    const [entry] = await sql`
      INSERT INTO changelog_entries
        (title, version, body, type, backlog_item_ids)
      VALUES
        (${body.title}, ${body.version ?? null}, ${body.body ?? null},
         ${body.type}, ${body.backlog_item_ids})
      RETURNING *
    `
    return entry
  })

  // ── PATCH /changelog/:id ──────────────────────────────────
  app.patch('/:id', { preHandler: requirePlatformAdmin }, async (req) => {
    const body   = ChangelogPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [entry] = await sql`
      UPDATE changelog_entries
         SET ${sql(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id}
       RETURNING *
    `
    if (!entry) throw httpError(404, 'Changelog entry not found')
    return entry
  })

  // ── DELETE /changelog/:id ─────────────────────────────────
  app.delete('/:id', { preHandler: requirePlatformAdmin }, async (req) => {
    const [row] = await sql`
      DELETE FROM changelog_entries WHERE id = ${req.params.id} RETURNING id
    `
    if (!row) throw httpError(404, 'Changelog entry not found')
    return { deleted: true }
  })

  // ── PATCH /changelog/:id/publish ──────────────────────────
  // Idempotent publish: sets is_published=true, published_at=now() (if not set).
  app.patch('/:id/publish', { preHandler: requirePlatformAdmin }, async (req) => {
    const [entry] = await sql`
      UPDATE changelog_entries
         SET is_published  = true,
             published_at  = COALESCE(published_at, now()),
             updated_at    = now()
       WHERE id = ${req.params.id}
       RETURNING *
    `
    if (!entry) throw httpError(404, 'Changelog entry not found')
    return entry
  })
}
