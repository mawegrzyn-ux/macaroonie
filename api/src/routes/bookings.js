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
  venue_id:    z.string().uuid(),
  table_id:    z.string().uuid(),
  starts_at:   z.string().datetime(),
  covers:      z.number().int().min(1),
  guest_name:  z.string().min(1).max(200),
  guest_email: z.string().email(),
  guest_phone: z.string().max(30).nullable().optional(),
})

const BookingBody = z.object({
  hold_id:       z.string().uuid(),
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

      // Insert hold — UNIQUE (table_id, starts_at) guard races at DB level
      const [newHold] = await tx`
        INSERT INTO booking_holds
          (venue_id, table_id, tenant_id, starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, expires_at)
        VALUES
          (${body.venue_id}, ${body.table_id}, ${req.tenantId},
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
      // confirm_hold() does the FOR UPDATE NOWAIT + conflict re-check
      const [result] = await tx`
        SELECT * FROM confirm_hold(${body.hold_id}::uuid, ${req.tenantId}::uuid)
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

      const h = result.hold

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
           ${h.starts_at}, ${h.ends_at}, ${h.covers},
           ${h.guest_name}, ${h.guest_email}, ${h.guest_phone},
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
        p.status     AS payment_status
      FROM bookings b
      JOIN tables t         ON t.id = b.table_id
      JOIN venues v         ON v.id = b.venue_id
      LEFT JOIN venue_sections s ON s.id = t.section_id
      LEFT JOIN payments p  ON p.booking_id = b.id
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
        SELECT b.*, r.slot_duration_mins, r.buffer_after_mins
          FROM bookings b
          JOIN booking_rules r ON r.venue_id = b.venue_id
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

      const newStart = new Date(starts_at)
      const newEnd   = new Date(
        newStart.getTime()
        + (booking.slot_duration_mins + booking.buffer_after_mins) * 60_000
      )

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
