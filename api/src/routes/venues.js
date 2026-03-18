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

  // ── BOOKING RULES ─────────────────────────────────────────

  const BookingRulesBody = z.object({
    slot_duration_mins:  z.number().int().min(15).max(480).optional(),
    buffer_after_mins:   z.number().int().min(0).max(120).optional(),
    min_covers:          z.number().int().min(1).optional(),
    max_covers:          z.number().int().min(1).optional(),
    book_from_days:      z.number().int().min(0).optional(),
    book_until_days:     z.number().int().min(1).optional(),
    cutoff_before_mins:  z.number().int().min(0).optional(),
    hold_ttl_secs:       z.number().int().min(60).max(1800).optional(),
  })

  const DepositRulesBody = z.object({
    requires_deposit:    z.boolean().optional(),
    deposit_type:        z.enum(['fixed', 'per_cover']).nullable().optional(),
    deposit_amount:      z.number().positive().nullable().optional(),
    currency:            z.string().length(3).optional(),
    refund_hours_before: z.number().int().min(0).nullable().optional(),
  })

  // GET /venues/:id/rules
  app.get('/:id/rules', async (req) => {
    const [rules] = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM booking_rules
       WHERE venue_id  = ${req.params.id}
         AND tenant_id = ${req.tenantId}
    `)
    if (!rules) throw httpError(404, 'Booking rules not configured for this venue')
    return rules
  })

  // POST /venues/:id/rules
  app.post('/:id/rules', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = BookingRulesBody.required().parse(req.body)
    const [rules] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO booking_rules
        (venue_id, tenant_id, slot_duration_mins, buffer_after_mins,
         min_covers, max_covers, book_from_days, book_until_days,
         cutoff_before_mins, hold_ttl_secs)
      VALUES
        (${req.params.id}, ${req.tenantId},
         ${body.slot_duration_mins  ?? 90},
         ${body.buffer_after_mins   ?? 0},
         ${body.min_covers          ?? 1},
         ${body.max_covers          ?? 20},
         ${body.book_from_days      ?? 0},
         ${body.book_until_days     ?? 90},
         ${body.cutoff_before_mins  ?? 60},
         ${body.hold_ttl_secs       ?? 300})
      ON CONFLICT (venue_id) DO UPDATE
         SET slot_duration_mins = EXCLUDED.slot_duration_mins,
             buffer_after_mins  = EXCLUDED.buffer_after_mins,
             min_covers         = EXCLUDED.min_covers,
             max_covers         = EXCLUDED.max_covers,
             book_from_days     = EXCLUDED.book_from_days,
             book_until_days    = EXCLUDED.book_until_days,
             cutoff_before_mins = EXCLUDED.cutoff_before_mins,
             hold_ttl_secs      = EXCLUDED.hold_ttl_secs,
             updated_at         = now()
      RETURNING *
    `)
    return reply.code(201).send(rules)
  })

  // PATCH /venues/:id/rules
  app.patch('/:id/rules', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body   = BookingRulesBody.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    if (body.min_covers && body.max_covers && body.min_covers > body.max_covers) {
      throw httpError(422, 'min_covers cannot exceed max_covers')
    }

    const [rules] = await withTenant(req.tenantId, tx => tx`
      UPDATE booking_rules
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE venue_id  = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!rules) throw httpError(404, 'Booking rules not found — POST to create them first')
    return rules
  })

  // ── DEPOSIT RULES ─────────────────────────────────────────

  // GET /venues/:id/deposit-rules
  app.get('/:id/deposit-rules', async (req) => {
    const [rules] = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM deposit_rules
       WHERE venue_id  = ${req.params.id}
         AND tenant_id = ${req.tenantId}
    `)
    if (!rules) throw httpError(404, 'Deposit rules not configured for this venue')
    return rules
  })

  // POST /venues/:id/deposit-rules
  app.post('/:id/deposit-rules', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = DepositRulesBody.parse(req.body)
    if (body.requires_deposit && (!body.deposit_type || !body.deposit_amount)) {
      throw httpError(422, 'deposit_type and deposit_amount are required when requires_deposit is true')
    }
    const [rules] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO deposit_rules
        (venue_id, tenant_id, requires_deposit, deposit_type,
         deposit_amount, currency, refund_hours_before)
      VALUES
        (${req.params.id}, ${req.tenantId},
         ${body.requires_deposit    ?? false},
         ${body.deposit_type        ?? null},
         ${body.deposit_amount      ?? null},
         ${body.currency            ?? 'GBP'},
         ${body.refund_hours_before ?? null})
      ON CONFLICT (venue_id) DO UPDATE
         SET requires_deposit    = EXCLUDED.requires_deposit,
             deposit_type        = EXCLUDED.deposit_type,
             deposit_amount      = EXCLUDED.deposit_amount,
             currency            = EXCLUDED.currency,
             refund_hours_before = EXCLUDED.refund_hours_before,
             updated_at          = now()
      RETURNING *
    `)
    return reply.code(201).send(rules)
  })

  // PATCH /venues/:id/deposit-rules
  app.patch('/:id/deposit-rules', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body   = DepositRulesBody.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    if (body.requires_deposit === true) {
      const [existing] = await withTenant(req.tenantId, tx => tx`
        SELECT deposit_type, deposit_amount FROM deposit_rules
         WHERE venue_id = ${req.params.id} AND tenant_id = ${req.tenantId}
      `)
      const type   = body.deposit_type   ?? existing?.deposit_type
      const amount = body.deposit_amount ?? existing?.deposit_amount
      if (!type || !amount) {
        throw httpError(422, 'deposit_type and deposit_amount must be set before enabling deposit requirement')
      }
    }

    const [rules] = await withTenant(req.tenantId, tx => tx`
      UPDATE deposit_rules
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE venue_id  = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!rules) throw httpError(404, 'Deposit rules not found — POST to create them first')
    return rules
  })
}
