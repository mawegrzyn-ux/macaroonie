// src/routes/venues.js

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

// ── Schemas ──────────────────────────────────────────────────

const VenueBody = z.object({
  name:             z.string().min(1).max(200),
  slug:             z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  timezone:         z.string().default('UTC'),
  currency:         z.string().length(3).default('GBP'),
  zero_cap_display: z.enum(['hidden', 'unavailable']).default('hidden'),
  is_active:        z.boolean().default(true),
})

const SectionBody = z.object({
  name:       z.string().min(1).max(100),
  sort_order: z.number().int().default(0),
  is_active:  z.boolean().default(true),
})

const TableBody = z.object({
  label:      z.string().min(1).max(50),
  section_id: z.string().uuid().nullable().optional(),
  min_covers: z.number().int().min(1).default(1),
  max_covers: z.number().int().min(1),
  sort_order: z.number().int().default(0),
  is_active:  z.boolean().default(true),
})

// ── Plugin ───────────────────────────────────────────────────

export default async function venuesRoutes(app) {

  // All routes require auth
  app.addHook('preHandler', requireAuth)

  // ── GET /venues ──────────────────────────────────────────
  app.get('/', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT v.*, 
             COUNT(DISTINCT t.id) AS table_count
        FROM venues v
        LEFT JOIN tables t ON t.venue_id = v.id AND t.is_active = true
       WHERE v.tenant_id = ${req.tenantId}
       GROUP BY v.id
       ORDER BY v.name
    `)
  })

  // ── GET /venues/:id ──────────────────────────────────────
  app.get('/:id', async (req) => {
    const rows = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM venues
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
    `)
    if (!rows.length) throw httpError(404, 'Venue not found')
    return rows[0]
  })

  // ── POST /venues ─────────────────────────────────────────
  app.post('/', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = VenueBody.parse(req.body)
    const rows = await withTenant(req.tenantId, tx => tx`
      INSERT INTO venues ${tx(body, 'name', 'slug', 'timezone', 'currency', 'zero_cap_display', 'is_active')}
      VALUES (${req.tenantId}, ${body.name}, ${body.slug}, ${body.timezone},
              ${body.currency}, ${body.zero_cap_display}, ${body.is_active})
      -- postgres.js shorthand for full row insert:
      RETURNING *
    `)
    // Rewrite using explicit insert for clarity with tenant_id
    const [venue] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO venues (tenant_id, name, slug, timezone, currency, zero_cap_display, is_active)
      VALUES (${req.tenantId}, ${body.name}, ${body.slug}, ${body.timezone},
              ${body.currency}, ${body.zero_cap_display}, ${body.is_active})
      RETURNING *
    `)
    return reply.code(201).send(venue)
  })

  // ── PATCH /venues/:id ────────────────────────────────────
  app.patch('/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = VenueBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [venue] = await withTenant(req.tenantId, tx => tx`
      UPDATE venues
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!venue) throw httpError(404, 'Venue not found')
    return venue
  })

  // ── SECTIONS ─────────────────────────────────────────────

  // GET /venues/:id/sections
  app.get('/:id/sections', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT * FROM venue_sections
       WHERE venue_id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       ORDER BY sort_order, name
    `)
  })

  // POST /venues/:id/sections
  app.post('/:id/sections', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = SectionBody.parse(req.body)
    const [section] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO venue_sections (venue_id, tenant_id, name, sort_order, is_active)
      VALUES (${req.params.id}, ${req.tenantId}, ${body.name}, ${body.sort_order}, ${body.is_active})
      RETURNING *
    `)
    return reply.code(201).send(section)
  })

  // PATCH /venues/:id/sections/:sid
  app.patch('/:id/sections/:sid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = SectionBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [section] = await withTenant(req.tenantId, tx => tx`
      UPDATE venue_sections
         SET ${tx(body, ...fields)}
       WHERE id = ${req.params.sid}
         AND venue_id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!section) throw httpError(404, 'Section not found')
    return section
  })

  // ── TABLES ───────────────────────────────────────────────

  // GET /venues/:id/tables
  app.get('/:id/tables', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT t.*, s.name AS section_name
        FROM tables t
        LEFT JOIN venue_sections s ON s.id = t.section_id
       WHERE t.venue_id = ${req.params.id}
         AND t.tenant_id = ${req.tenantId}
       ORDER BY t.sort_order, t.label
    `)
  })

  // POST /venues/:id/tables
  app.post('/:id/tables', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = TableBody.parse(req.body)
    const [table] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO tables (venue_id, tenant_id, section_id, label, min_covers, max_covers, sort_order, is_active)
      VALUES (
        ${req.params.id}, ${req.tenantId}, ${body.section_id ?? null},
        ${body.label}, ${body.min_covers}, ${body.max_covers},
        ${body.sort_order}, ${body.is_active}
      )
      RETURNING *
    `)
    return reply.code(201).send(table)
  })

  // PATCH /venues/:id/tables/:tid
  app.patch('/:id/tables/:tid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = TableBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [table] = await withTenant(req.tenantId, tx => tx`
      UPDATE tables
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.tid}
         AND venue_id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!table) throw httpError(404, 'Table not found')
    return table
  })

  // DELETE /venues/:id/tables/:tid (soft delete)
  app.delete('/:id/tables/:tid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [table] = await withTenant(req.tenantId, tx => tx`
      UPDATE tables SET is_active = false, updated_at = now()
       WHERE id = ${req.params.tid}
         AND venue_id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!table) throw httpError(404, 'Table not found')
    return { ok: true }
  })
}
