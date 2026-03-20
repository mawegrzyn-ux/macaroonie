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

  // PATCH /venues/:id/tables/reorder
  // Accepts { ids: [uuid, ...] } — the complete ordered list of table IDs for this venue.
  // Sets sort_order = array index for each. Tables missing from the list are left unchanged.
  // The order here drives: timeline row order, smart-allocation adjacency logic.
  app.patch('/:id/tables/reorder', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { ids } = z.object({
      ids: z.array(z.string().uuid()).min(1),
    }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      // Verify all IDs belong to this venue
      const owned = await tx`
        SELECT id FROM tables
         WHERE id = ANY(${ids}::uuid[])
           AND venue_id  = ${req.params.id}
           AND tenant_id = ${req.tenantId}
      `
      if (owned.length !== ids.length) throw httpError(404, 'One or more tables not found in this venue')

      // Assign sort_order = index position
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE tables SET sort_order = ${i}, updated_at = now()
           WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}
        `
      }
    })

    return { ok: true }
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

  // ── TABLE COMBINATIONS ───────────────────────────────────

  const CombinationBody = z.object({
    name:       z.string().min(1).max(100),
    min_covers: z.number().int().min(1).default(1),
    max_covers: z.number().int().min(1),
    table_ids:  z.array(z.string().uuid()).min(2, 'At least 2 tables required'),
    is_active:  z.boolean().default(true),
  })

  // GET /venues/:id/combinations
  app.get('/:id/combinations', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT c.*,
             COALESCE(
               json_agg(
                 json_build_object('table_id', m.table_id, 'label', t.label)
                 ORDER BY t.sort_order, t.label
               ) FILTER (WHERE m.table_id IS NOT NULL),
               '[]'
             ) AS members
        FROM table_combinations c
        LEFT JOIN table_combination_members m ON m.combination_id = c.id
        LEFT JOIN tables t ON t.id = m.table_id
       WHERE c.venue_id = ${req.params.id}
       GROUP BY c.id
       ORDER BY c.name
    `)
  })

  // POST /venues/:id/combinations
  app.post('/:id/combinations', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = CombinationBody.parse(req.body)
    const combo = await withTenant(req.tenantId, async tx => {
      const [c] = await tx`
        INSERT INTO table_combinations (venue_id, tenant_id, name, min_covers, max_covers, is_active)
        VALUES (${req.params.id}, ${req.tenantId}, ${body.name}, ${body.min_covers}, ${body.max_covers}, ${body.is_active})
        RETURNING *
      `
      await tx`
        INSERT INTO table_combination_members ${tx(body.table_ids.map(tid => ({
          combination_id: c.id,
          table_id: tid,
        })))}
      `
      return c
    })
    return reply.code(201).send(combo)
  })

  // PATCH /venues/:id/combinations/:cid
  app.patch('/:id/combinations/:cid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = CombinationBody.partial().omit({ table_ids: true }).parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [combo] = await withTenant(req.tenantId, tx => tx`
      UPDATE table_combinations
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.cid}
         AND venue_id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!combo) throw httpError(404, 'Combination not found')
    return combo
  })

  // DELETE /venues/:id/combinations/:cid
  app.delete('/:id/combinations/:cid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [combo] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM table_combinations
       WHERE id = ${req.params.cid}
         AND venue_id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!combo) throw httpError(404, 'Combination not found')
    return { ok: true }
  })

  // ── BOOKING RULES ─────────────────────────────────────────

  const BookingRulesBody = z.object({
    slot_duration_mins:        z.number().int().min(15).max(480).optional(),
    buffer_after_mins:         z.number().int().min(0).max(120).optional(),
    min_covers:                z.number().int().min(1).optional(),
    max_covers:                z.number().int().min(1).optional(),
    book_from_days:            z.number().int().min(0).optional(),
    book_until_days:           z.number().int().min(1).optional(),
    cutoff_before_mins:        z.number().int().min(0).optional(),
    hold_ttl_secs:             z.number().int().min(60).max(1800).optional(),
    allow_cross_section_combo: z.boolean().optional(),
    allow_non_adjacent_combo:  z.boolean().optional(),
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
    return rules ?? {}
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
    return rules ?? {}
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

  // ── DISALLOWED TABLE PAIRS ────────────────────────────────────
  // Pairs listed here are never considered by the smart-allocate engine,
  // whether the match comes from an existing combination or adjacency expansion.

  // GET /venues/:id/disallowed-pairs
  app.get('/:id/disallowed-pairs', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT d.id, d.table_id_a, d.table_id_b,
             a.label AS label_a, b.label AS label_b,
             d.created_at
        FROM disallowed_table_pairs d
        JOIN tables a ON a.id = d.table_id_a
        JOIN tables b ON b.id = d.table_id_b
       WHERE d.venue_id  = ${req.params.id}
         AND d.tenant_id = ${req.tenantId}
       ORDER BY a.label, b.label
    `)
  })

  // POST /venues/:id/disallowed-pairs
  app.post('/:id/disallowed-pairs', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const { table_id_a, table_id_b } = z.object({
      table_id_a: z.string().uuid(),
      table_id_b: z.string().uuid(),
    }).parse(req.body)

    if (table_id_a === table_id_b) throw httpError(422, 'A table cannot be paired with itself')

    // Verify both tables belong to this venue
    const owned = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM tables
       WHERE id = ANY(${[table_id_a, table_id_b]}::uuid[])
         AND venue_id  = ${req.params.id}
         AND tenant_id = ${req.tenantId}
    `)
    if (owned.length !== 2) throw httpError(404, 'One or both tables not found in this venue')

    // Normalise: always store the smaller UUID first (matches DB CHECK constraint)
    const [a, b] = [table_id_a, table_id_b].sort()

    const [pair] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO disallowed_table_pairs (venue_id, tenant_id, table_id_a, table_id_b)
      VALUES (${req.params.id}, ${req.tenantId}, ${a}, ${b})
      ON CONFLICT (table_id_a, table_id_b) DO NOTHING
      RETURNING *
    `)
    return reply.code(201).send(pair ?? { ok: true, note: 'pair already exists' })
  })

  // DELETE /venues/:id/disallowed-pairs/:pid
  app.delete('/:id/disallowed-pairs/:pid', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [pair] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM disallowed_table_pairs
       WHERE id        = ${req.params.pid}
         AND venue_id  = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!pair) throw httpError(404, 'Pair not found')
    return { ok: true }
  })
}
