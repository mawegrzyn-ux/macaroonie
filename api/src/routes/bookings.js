// src/routes/bookings.js
// POST   /holds                     create hold (widget + admin)
// DELETE /holds/:holdId             release hold (cancel)
// POST   /bookings                  confirm free booking
// GET    /bookings                  list (admin timeline query)
// GET    /bookings/:id              single booking
// PATCH  /bookings/:id/status       admin: update status
// PATCH  /bookings/:id/notes        admin: update operator notes
// POST   /bookings/:id/cancel       cancel + optional refund trigger

import { z } from 'zod'
import { withTenant, sql } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { notificationQueue } from '../jobs/queues.js'
import { broadcastBooking } from '../services/broadcastSvc.js'

// ── Schemas ──────────────────────────────────────────────────

const HoldBody = z.object({
  venue_id:       z.string().uuid(),
  table_id:       z.string().uuid().optional(),
  combination_id: z.string().uuid().optional(),
  starts_at:      z.string().datetime(),
  covers:         z.number().int().min(1),
  guest_name:     z.string().min(1).max(200),
  guest_email:    z.string().email(),
  guest_phone:    z.string().max(30).nullable().optional(),
}).refine(d => d.table_id || d.combination_id, {
  message: 'Either table_id or combination_id is required',
})

const BookingBody = z.object({
  hold_id:       z.string().uuid(),
  guest_name:    z.string().min(1).optional(),
  guest_email:   z.string().email().optional(),
  guest_phone:   z.string().optional().nullable(),
  covers:        z.coerce.number().int().min(1).optional(),
  guest_notes:   z.string().max(1000).nullable().optional(),
})

const StatusBody = z.object({
  status: z.enum(['confirmed', 'cancelled', 'no_show', 'completed']),
})

const ListQuery = z.object({
  venue_id: z.string().uuid().optional(),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status:   z.enum(['pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed']).optional(),
  limit:    z.coerce.number().int().min(1).max(200).default(100),
  offset:   z.coerce.number().int().min(0).default(0),
})

export default async function bookingsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── POST /holds ─────────────────────────────────────────
  // Creates a temporary lock on a slot.
  // Available to any authenticated user (operator booking on behalf of guest).
  app.post('/holds', async (req, reply) => {
    const body = HoldBody.parse(req.body)

    const hold = await withTenant(req.tenantId, async tx => {
      // Load booking rules for this venue
      const [rules] = await tx`
        SELECT r.hold_ttl_secs, r.slot_duration_mins, r.min_covers, r.max_covers,
               r.cutoff_before_mins
          FROM booking_rules r
         WHERE r.venue_id = ${body.venue_id}
      `
      if (!rules) throw httpError(404, 'Venue booking rules not configured')

      // Covers check
      if (body.covers < rules.min_covers || body.covers > rules.max_covers) {
        throw httpError(422, `Covers must be between ${rules.min_covers} and ${rules.max_covers}`)
      }

      const startsAt  = new Date(body.starts_at)
      const endsAt    = new Date(startsAt.getTime() + rules.slot_duration_mins * 60_000)
      const expiresAt = new Date(Date.now() + rules.hold_ttl_secs * 1_000)

      // Cutoff check
      const cutoffMs = rules.cutoff_before_mins * 60_000
      if (Date.now() > startsAt.getTime() - cutoffMs) {
        throw httpError(422, 'Booking cutoff has passed for this slot')
      }

      // For combination holds: resolve the first member table to use as
      // canonical table_id (keeps UNIQUE (table_id, starts_at) guard intact).
      // combination_id is stored for reference; the slot query blocks all
      // member tables via JOIN to table_combination_members.
      let tableId = body.table_id ?? null
      if (body.combination_id) {
        const [firstMember] = await tx`
          SELECT m.table_id FROM table_combination_members m
            JOIN tables t ON t.id = m.table_id
           WHERE m.combination_id = ${body.combination_id}
           ORDER BY t.sort_order, t.label
           LIMIT 1
        `
        if (!firstMember) throw httpError(404, 'Combination not found or has no tables')
        tableId = firstMember.table_id
      }

      // Insert hold — UNIQUE (table_id, starts_at) guards races at DB level
      const [newHold] = await tx`
        INSERT INTO booking_holds
          (venue_id, table_id, combination_id, tenant_id, starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, expires_at)
        VALUES
          (${body.venue_id}, ${tableId}, ${body.combination_id ?? null}, ${req.tenantId},
           ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${body.covers},
           ${body.guest_name}, ${body.guest_email}, ${body.guest_phone ?? null},
           ${expiresAt.toISOString()})
        RETURNING *
      `
      return newHold
    })

    return reply.code(201).send(hold)
  })

  // ── DELETE /holds/:holdId ────────────────────────────────
  // Guest cancels during payment flow → slot freed immediately.
  app.delete('/holds/:holdId', async (req) => {
    const [hold] = await withTenant(req.tenantId, async tx => {
      // Also cancel Stripe PI if one was attached
      const [h] = await tx`
        SELECT id, stripe_pi_id FROM booking_holds
         WHERE id = ${req.params.holdId}
           AND tenant_id = ${req.tenantId}
      `
      if (!h) throw httpError(404, 'Hold not found')

      if (h.stripe_pi_id) {
        // Import lazily to avoid circular dep
        const { cancelPaymentIntent } = await import('../services/paymentService.js')
        await cancelPaymentIntent(h.stripe_pi_id)
      }

      return tx`
        DELETE FROM booking_holds
         WHERE id = ${req.params.holdId}
           AND tenant_id = ${req.tenantId}
        RETURNING id
      `
    })
    if (!hold) throw httpError(404, 'Hold not found')
    return { ok: true }
  })

  // ── POST /bookings ────────────────────────────────────────
  // Confirm a FREE booking (no deposit required).
  // Payment path goes through /payments/intent → Stripe webhook → auto-confirm.
  app.post('/', async (req, reply) => {
    const body = BookingBody.parse(req.body)

    const booking = await withTenant(req.tenantId, async tx => {
      // confirm_hold() does the FOR UPDATE NOWAIT + conflict re-check.
      // Only select is_valid + reason — the `hold` column is a composite type
      // which postgres.js returns as a raw string, not a parsed object.
      const [result] = await tx`
        SELECT is_valid, reason FROM confirm_hold(${body.hold_id}::uuid, ${req.tenantId}::uuid)
      `

      if (!result.is_valid) {
        const reasons = {
          hold_not_found: [404, 'Hold not found or already used'],
          hold_expired:   [422, 'Hold has expired — please start again'],
          slot_conflict:  [409, 'Slot conflict detected — please try again'],
        }
        const [code, msg] = reasons[result.reason] ?? [409, 'Could not confirm booking']
        throw httpError(code, msg)
      }

      // Fetch hold data as a plain row (composite type from confirm_hold is unparseable)
      const [h] = await tx`
        SELECT * FROM booking_holds WHERE id = ${body.hold_id}
      `
      if (!h) throw httpError(404, 'Hold not found after confirmation')

      // Verify venue does not require deposit
      const [deposit] = await tx`
        SELECT requires_deposit FROM deposit_rules WHERE venue_id = ${h.venue_id}
      `
      if (deposit?.requires_deposit) {
        throw httpError(422, 'This venue requires a deposit — use the payment flow')
      }

      const [booking] = await tx`
        INSERT INTO bookings
          (venue_id, table_id, tenant_id, starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, guest_notes, status)
        VALUES
          (${h.venue_id}, ${h.table_id}, ${req.tenantId},
           ${h.starts_at}, ${h.ends_at}, ${body.covers ?? h.covers},
           ${body.guest_name ?? h.guest_name}, ${body.guest_email ?? h.guest_email}, ${body.guest_phone ?? h.guest_phone ?? null},
           ${body.guest_notes ?? null}, 'confirmed')
        RETURNING *
      `

      await tx`DELETE FROM booking_holds WHERE id = ${body.hold_id}`

      return booking
    })

    // Enqueue confirmation email
    await notificationQueue.add('confirmation', {
      bookingId: booking.id,
      tenantId:  req.tenantId,
      type:      'confirmation',
    })
    broadcastBooking('booking.created', booking)

    return reply.code(201).send(booking)
  })

  // ── GET /bookings ─────────────────────────────────────────
  // Admin timeline query — filter by venue + date + status.
  app.get('/', async (req) => {
    const q = ListQuery.parse(req.query)

    return withTenant(req.tenantId, tx => tx`
      SELECT
        b.*,
        t.label      AS table_label,
        t.section_id,
        s.name       AS section_name,
        v.name       AS venue_name,
        v.timezone   AS venue_timezone,
        p.id         AS payment_id,
        p.amount     AS payment_amount,
        p.status     AS payment_status,
        -- All member table IDs for combination bookings (for timeline row expansion)
        CASE WHEN b.combination_id IS NOT NULL THEN (
          SELECT json_agg(m.table_id ORDER BY t2.sort_order, t2.label)
            FROM table_combination_members m
            JOIN tables t2 ON t2.id = m.table_id
           WHERE m.combination_id = b.combination_id
        ) END AS member_table_ids,
        -- Combination name for display
        tc.name      AS combination_name
      FROM bookings b
      JOIN tables t         ON t.id = b.table_id
      JOIN venues v         ON v.id = b.venue_id
      LEFT JOIN venue_sections s        ON s.id = t.section_id
      LEFT JOIN payments p              ON p.booking_id = b.id
      LEFT JOIN table_combinations tc   ON tc.id = b.combination_id
     WHERE b.tenant_id = ${req.tenantId}
       AND (${q.venue_id ?? null}::uuid IS NULL OR b.venue_id = ${q.venue_id ?? null}::uuid)
       AND (${q.date ?? null}::date    IS NULL OR b.starts_at::date = ${q.date ?? null}::date)
       AND (${q.status ?? null}::text  IS NULL OR b.status = ${q.status ?? null}::booking_status)
     ORDER BY b.starts_at
     LIMIT  ${q.limit}
     OFFSET ${q.offset}
    `)
  })

  // ── GET /bookings/:id ─────────────────────────────────────
  app.get('/:id', async (req) => {
    const [booking] = await withTenant(req.tenantId, tx => tx`
      SELECT b.*, t.label AS table_label, v.name AS venue_name,
             v.timezone AS venue_timezone
        FROM bookings b
        JOIN tables t ON t.id = b.table_id
        JOIN venues v ON v.id = b.venue_id
       WHERE b.id = ${req.params.id}
         AND b.tenant_id = ${req.tenantId}
    `)
    if (!booking) throw httpError(404, 'Booking not found')
    return booking
  })

  // ── PATCH /bookings/:id/status ────────────────────────────
  app.patch('/:id/status', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const { status } = StatusBody.parse(req.body)

    const [booking] = await withTenant(req.tenantId, tx => tx`
      UPDATE bookings
         SET status = ${status}::booking_status, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!booking) throw httpError(404, 'Booking not found')

    // Enqueue notifications for certain transitions
    if (status === 'cancelled') {
      await notificationQueue.add('cancellation', {
        bookingId: booking.id,
        tenantId:  req.tenantId,
        type:      'cancellation',
      })
    }
    broadcastBooking('booking.updated', booking)

    return booking
  })

  // ── PATCH /bookings/:id/move ──────────────────────────────
  // Admin drag-and-drop reschedule from the timeline.
  app.patch('/:id/move', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const { table_id, starts_at } = z.object({
      table_id:  z.string().uuid(),
      starts_at: z.string().datetime(),
    }).parse(req.body)

    const updated = await withTenant(req.tenantId, async tx => {
      const [booking] = await tx`
        SELECT b.*
          FROM bookings b
         WHERE b.id        = ${req.params.id}
           AND b.tenant_id = ${req.tenantId}
           AND b.status NOT IN ('cancelled')
      `
      if (!booking) throw httpError(404, 'Booking not found')

      const [table] = await tx`
        SELECT id FROM tables
         WHERE id        = ${table_id}
           AND venue_id  = ${booking.venue_id}
           AND tenant_id = ${req.tenantId}
           AND is_active = true
      `
      if (!table) throw httpError(404, 'Table not found in this venue')

      // Preserve the booking's actual duration (may differ from slot_duration_mins
      // if the end time was manually extended via the resize handle).
      const originalDurationMs = new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()
      const newStart = new Date(starts_at)
      const newEnd   = new Date(newStart.getTime() + originalDurationMs)

      const [conflict] = await tx`
        SELECT id FROM bookings
         WHERE table_id  = ${table_id}
           AND tenant_id = ${req.tenantId}
           AND id       != ${req.params.id}
           AND status NOT IN ('cancelled')
           AND starts_at < ${newEnd.toISOString()}
           AND ends_at   > ${newStart.toISOString()}
        LIMIT 1
      `
      if (conflict) throw httpError(409, 'Slot conflict — another booking exists at the target time')

      const [holdConflict] = await tx`
        SELECT id FROM booking_holds
         WHERE table_id  = ${table_id}
           AND tenant_id = ${req.tenantId}
           AND expires_at > now()
           AND starts_at  < ${newEnd.toISOString()}
           AND ends_at    > ${newStart.toISOString()}
        LIMIT 1
      `
      if (holdConflict) throw httpError(409, 'Slot conflict — a hold exists at the target time')

      const [row] = await tx`
        UPDATE bookings
           SET table_id   = ${table_id},
               starts_at  = ${newStart.toISOString()},
               ends_at    = ${newEnd.toISOString()},
               updated_at = now()
         WHERE id        = ${req.params.id}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      return row
    })
    broadcastBooking('booking.updated', updated)
    return updated
  })

  // ── PATCH /bookings/:id/guest ────────────────────────────
  // Edit guest name, email, phone, covers.
  app.patch('/:id/guest', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const body = z.object({
      guest_name:  z.string().min(1).max(200).optional(),
      guest_email: z.string().email().optional(),
      guest_phone: z.string().max(30).nullable().optional(),
      covers:      z.coerce.number().int().min(1).optional(),
    }).parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [booking] = await withTenant(req.tenantId, tx => tx`
      UPDATE bookings SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!booking) throw httpError(404, 'Booking not found')
    broadcastBooking('booking.updated', booking)
    return booking
  })

  // ── PATCH /bookings/:id/duration ──────────────────────────
  // Admin override: change ends_at (resize from timeline or drawer).
  app.patch('/:id/duration', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const { ends_at } = z.object({ ends_at: z.string().datetime() }).parse(req.body)

    const booking = await withTenant(req.tenantId, async tx => {
      const [b] = await tx`
        SELECT starts_at FROM bookings
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      `
      if (!b) throw httpError(404, 'Booking not found')
      if (new Date(ends_at) <= new Date(b.starts_at)) throw httpError(422, 'ends_at must be after starts_at')
      const [row] = await tx`
        UPDATE bookings SET ends_at = ${ends_at}, updated_at = now()
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      return row
    })
    broadcastBooking('booking.updated', booking)
    return booking
  })

  // ── PATCH /bookings/:id/tables ────────────────────────────
  // Admin override: reassign to a different table or combination.
  // Accepts:
  //   { table_id }              — single table
  //   { combination_id }        — pre-configured combination
  //   { table_ids: [id, id…] }  — ad-hoc multi-table: finds matching combo or auto-creates one
  app.patch('/:id/tables', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const body = z.object({
      table_id:       z.string().uuid().optional(),
      combination_id: z.string().uuid().nullable().optional(),
      table_ids:      z.array(z.string().uuid()).min(1).optional(),
    }).refine(
      d => d.table_id || d.combination_id || (d.table_ids && d.table_ids.length > 0),
      'Provide table_id, combination_id, or table_ids'
    ).parse(req.body)

    const booking = await withTenant(req.tenantId, async tx => {
      let tableId = body.table_id ?? null
      let comboId = body.combination_id ?? null

      // ── Multi-table ad-hoc path ───────────────────────────
      if (body.table_ids && body.table_ids.length > 0) {
        if (body.table_ids.length === 1) {
          // Single item in the array — treat as a plain table assignment
          tableId = body.table_ids[0]
          comboId = null
        } else {
          // Multiple tables: find or create a matching combination
          const sorted = [...new Set(body.table_ids)].sort()

          // Verify all tables belong to this tenant
          const owned = await tx`
            SELECT id FROM tables
             WHERE id = ANY(${sorted}::uuid[]) AND tenant_id = ${req.tenantId}
          `
          if (owned.length !== sorted.length) throw httpError(404, 'One or more tables not found')

          // Look for existing combination with exactly this member set
          const [existing] = await tx`
            SELECT c.id FROM table_combinations c
             WHERE c.tenant_id = ${req.tenantId}
               AND c.is_active = true
               AND (SELECT COUNT(*) FROM table_combination_members m
                     WHERE m.combination_id = c.id) = ${sorted.length}
               AND (SELECT COUNT(*) FROM table_combination_members m
                     WHERE m.combination_id = c.id
                       AND m.table_id = ANY(${sorted}::uuid[])) = ${sorted.length}
             LIMIT 1
          `

          if (existing) {
            comboId = existing.id
          } else {
            // Auto-create an ad-hoc combination under the booking's venue
            const tableRows = await tx`
              SELECT id, label, min_covers, max_covers, sort_order
                FROM tables
               WHERE id = ANY(${sorted}::uuid[]) AND tenant_id = ${req.tenantId}
               ORDER BY sort_order, label
            `
            const [bk] = await tx`SELECT venue_id FROM bookings WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
            if (!bk) throw httpError(404, 'Booking not found')

            const name       = tableRows.map(t => t.label).join(' + ')
            const minCovers  = Math.min(...tableRows.map(t => t.min_covers))
            const maxCovers  = tableRows.reduce((s, t) => s + t.max_covers, 0)

            const [newCombo] = await tx`
              INSERT INTO table_combinations (venue_id, tenant_id, name, min_covers, max_covers)
              VALUES (${bk.venue_id}, ${req.tenantId}, ${name}, ${minCovers}, ${maxCovers})
              RETURNING id
            `
            // Insert members in DB sort order
            for (const t of tableRows) {
              await tx`INSERT INTO table_combination_members (combination_id, table_id) VALUES (${newCombo.id}, ${t.id})`
            }
            comboId = newCombo.id
          }

          // Use first member table as canonical table_id
          const [first] = await tx`
            SELECT m.table_id FROM table_combination_members m
              JOIN tables t ON t.id = m.table_id
             WHERE m.combination_id = ${comboId}
             ORDER BY t.sort_order, t.label LIMIT 1
          `
          tableId = first.table_id
        }
      }

      // ── combination_id with no table_id ──────────────────
      if (comboId && !tableId) {
        const [first] = await tx`
          SELECT m.table_id FROM table_combination_members m
            JOIN tables t ON t.id = m.table_id
           WHERE m.combination_id = ${comboId}
           ORDER BY t.sort_order, t.label LIMIT 1
        `
        if (!first) throw httpError(404, 'Combination not found')
        tableId = first.table_id
      }

      const [row] = await tx`
        UPDATE bookings
           SET table_id = ${tableId}, combination_id = ${comboId}, updated_at = now()
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      if (!row) throw httpError(404, 'Booking not found')
      return row
    })
    broadcastBooking('booking.updated', booking)
    return booking
  })

  // ── PATCH /bookings/:id/notes ─────────────────────────────
  app.patch('/:id/notes', async (req) => {
    const { operator_notes } = z.object({
      operator_notes: z.string().max(2000),
    }).parse(req.body)

    const [booking] = await withTenant(req.tenantId, tx => tx`
      UPDATE bookings
         SET operator_notes = ${operator_notes}, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING id, operator_notes, updated_at
    `)
    if (!booking) throw httpError(404, 'Booking not found')
    return booking
  })
}
