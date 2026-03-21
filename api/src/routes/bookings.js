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
import { upsertCustomer } from './customers.js'

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

const BOOKING_STATUSES = z.enum(['unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated', 'checked_out', 'cancelled', 'no_show'])

const BookingBody = z.object({
  hold_id:       z.string().uuid(),
  guest_name:    z.string().min(1).optional(),
  guest_email:   z.string().email().optional(),
  guest_phone:   z.string().optional().nullable(),
  covers:        z.coerce.number().int().min(1).optional(),
  guest_notes:   z.string().max(1000).nullable().optional(),
  status:        BOOKING_STATUSES.optional(),
})

const StatusBody = z.object({
  status: z.enum(['unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated', 'checked_out', 'cancelled', 'no_show']),
})

const ListQuery = z.object({
  venue_id: z.string().uuid().optional(),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status:   z.enum(['pending_payment', 'unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated', 'checked_out', 'cancelled', 'no_show']).optional(),
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

      // Determine initial status: unconfirmed when the venue has the call-to-confirm flow enabled
      const [bookingRules] = await tx`
        SELECT enable_unconfirmed_flow FROM booking_rules WHERE venue_id = ${h.venue_id}
      `
      const defaultStatus = bookingRules?.enable_unconfirmed_flow ? 'unconfirmed' : 'confirmed'
      const initialStatus = body.status ?? defaultStatus

      const [booking] = await tx`
        INSERT INTO bookings
          (venue_id, table_id, combination_id, tenant_id, starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, guest_notes, status)
        VALUES
          (${h.venue_id}, ${h.table_id}, ${h.combination_id ?? null}, ${req.tenantId},
           ${h.starts_at}, ${h.ends_at}, ${body.covers ?? h.covers},
           ${body.guest_name ?? h.guest_name}, ${body.guest_email || h.guest_email || null}, ${body.guest_phone ?? h.guest_phone ?? null},
           ${body.guest_notes ?? null}, ${initialStatus}::booking_status)
        RETURNING *
      `

      await tx`DELETE FROM booking_holds WHERE id = ${body.hold_id}`

      return booking
    })

    // Auto-upsert customer record (fire-and-forget — never block the response)
    withTenant(req.tenantId, async tx => {
      const customerId = await upsertCustomer(tx, req.tenantId, {
        name:  body.guest_name  ?? booking.guest_name,
        email: body.guest_email ?? booking.guest_email,
        phone: body.guest_phone ?? booking.guest_phone,
      })
      if (customerId) {
        await tx`UPDATE bookings SET customer_id = ${customerId} WHERE id = ${booking.id}`
      }
    }).catch(e => req.log.warn({ err: e }, 'customer upsert failed — booking created without customer link'))

    // Enqueue confirmation email (fire-and-forget — never block the response)
    notificationQueue.add('confirmation', { bookingId: booking.id, tenantId: req.tenantId, type: 'confirmation' })
      .catch(e => req.log.warn({ err: e }, 'notification queue unavailable — confirmation email skipped'))
    broadcastBooking('booking.created', booking)

    return reply.code(201).send(booking)
  })

  // ── POST /bookings/admin-override ────────────────────────
  // Admin creates a booking directly, bypassing slot availability, booking
  // window, and capacity checks. Table assignment is explicit (one table,
  // multi-table auto-combo, or unallocated row).
  // Requires operator+ role.
  app.post('/admin-override', { preHandler: requireRole('operator', 'admin', 'owner') }, async (req, reply) => {
    const body = z.object({
      venue_id:    z.string().uuid(),
      starts_at:   z.string().min(1),                          // YYYY-MM-DDTHH:MM:SS (server-local TZ)
      covers:      z.number().int().min(1),
      table_ids:   z.array(z.string().uuid()).default([]),      // empty → unallocated row
      guest_name:  z.string().min(1).max(200),
      guest_email: z.string().email(),
      guest_phone: z.string().max(30).nullable().optional(),
      guest_notes: z.string().max(1000).nullable().optional(),
      status:      BOOKING_STATUSES.optional(),
    }).parse(req.body)

    const booking = await withTenant(req.tenantId, async tx => {
      const [rules] = await tx`
        SELECT slot_duration_mins, enable_unconfirmed_flow
          FROM booking_rules WHERE venue_id = ${body.venue_id}
      `
      const durationMins  = rules?.slot_duration_mins ?? 90
      const defaultStatus = rules?.enable_unconfirmed_flow ? 'unconfirmed' : 'confirmed'
      const initialStatus = body.status ?? defaultStatus
      const startsAt = new Date(body.starts_at)
      const endsAt   = new Date(startsAt.getTime() + durationMins * 60_000)

      // ── Resolve table / combination ──────────────────────
      let tableId       = null
      let combinationId = null

      if (body.table_ids.length === 0) {
        // Unallocated — use the venue's designated unallocated table row
        const [unalloc] = await tx`
          SELECT id FROM tables
           WHERE venue_id = ${body.venue_id} AND is_unallocated = true
           LIMIT 1
        `
        if (!unalloc) throw httpError(422, 'No unallocated table row configured for this venue')
        tableId = unalloc.id

      } else if (body.table_ids.length === 1) {
        tableId = body.table_ids[0]

      } else {
        // Multiple tables — find an existing combination or auto-create one
        const sortedIds = [...body.table_ids].sort()

        const [existing] = await tx`
          SELECT tc.id
            FROM table_combinations tc
           WHERE tc.venue_id = ${body.venue_id}
             AND (
               SELECT array_agg(m.table_id ORDER BY m.table_id)
                 FROM table_combination_members m
                WHERE m.combination_id = tc.id
             ) = ${sortedIds}::uuid[]
           LIMIT 1
        `

        if (existing) {
          combinationId = existing.id
        } else {
          const tableRows = await tx`
            SELECT id, label, min_covers, max_covers
              FROM tables
             WHERE id = ANY(${body.table_ids}::uuid[])
               AND venue_id = ${body.venue_id}
          `
          const maxCovers = tableRows.reduce((s, t) => s + Number(t.max_covers), 0)
          const minCovers = Math.max(1, maxCovers - 1)
          const comboName = tableRows.map(t => t.label).join(' + ')

          const [newCombo] = await tx`
            INSERT INTO table_combinations (venue_id, tenant_id, name, min_covers, max_covers)
            VALUES (${body.venue_id}, ${req.tenantId}, ${comboName}, ${minCovers}, ${maxCovers})
            RETURNING id
          `
          combinationId = newCombo.id

          for (const tid of body.table_ids) {
            await tx`
              INSERT INTO table_combination_members (combination_id, table_id)
              VALUES (${combinationId}, ${tid})
              ON CONFLICT DO NOTHING
            `
          }
        }

        // Canonical table_id = first member (keeps timeline JOIN intact)
        const [first] = await tx`
          SELECT m.table_id FROM table_combination_members m
            JOIN tables t ON t.id = m.table_id
           WHERE m.combination_id = ${combinationId}
           ORDER BY t.sort_order, t.label LIMIT 1
        `
        tableId = first.table_id
      }

      const [bk] = await tx`
        INSERT INTO bookings
          (venue_id, table_id, combination_id, tenant_id,
           starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, guest_notes, status)
        VALUES
          (${body.venue_id}, ${tableId}, ${combinationId ?? null}, ${req.tenantId},
           ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${body.covers},
           ${body.guest_name}, ${body.guest_email},
           ${body.guest_phone ?? null}, ${body.guest_notes ?? null},
           ${initialStatus}::booking_status)
        RETURNING *
      `
      return bk
    })

    // Auto-upsert customer record (fire-and-forget — never block the response)
    withTenant(req.tenantId, async tx => {
      const customerId = await upsertCustomer(tx, req.tenantId, {
        name:  body.guest_name,
        email: body.guest_email,
        phone: body.guest_phone,
      })
      if (customerId) {
        await tx`UPDATE bookings SET customer_id = ${customerId} WHERE id = ${booking.id}`
      }
    }).catch(e => req.log.warn({ err: e }, 'customer upsert failed — booking created without customer link'))

    // Fire-and-forget — never block the response
    notificationQueue.add('confirmation', { bookingId: booking.id, tenantId: req.tenantId, type: 'confirmation' })
      .catch(e => req.log.warn({ err: e }, 'notification queue unavailable — booking created but confirmation email skipped'))
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
        t.label          AS table_label,
        t.max_covers     AS table_max_covers,
        t.section_id,
        t.is_unallocated AS table_is_unallocated,
        s.name           AS section_name,
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
        -- Combination name + capacity for display
        tc.name       AS combination_name,
        tc.max_covers AS combination_max_covers
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

    // Enqueue notifications for certain transitions (fire-and-forget — never block the response)
    if (status === 'cancelled') {
      notificationQueue.add('cancellation', { bookingId: booking.id, tenantId: req.tenantId, type: 'cancellation' })
        .catch(e => req.log.warn({ err: e }, 'notification queue unavailable — cancellation email skipped'))
    }
    broadcastBooking('booking.updated', booking)

    return booking
  })

  // ── DELETE /bookings/:id ──────────────────────────────────
  // Hard-delete a booking. Restricted to admin/owner only.
  // Broadcasts booking.deleted so the timeline removes the card immediately.
  app.delete('/:id', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const [booking] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM bookings
       WHERE id        = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!booking) throw httpError(404, 'Booking not found')

    broadcastBooking('booking.deleted', booking)
    return reply.code(204).send()
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
            const maxCovers  = tableRows.reduce((s, t) => s + Number(t.max_covers), 0)
            // min = total capacity minus 1: the combo is only appropriate when
            // the party is too large for any single member table alone.
            const minCovers  = Math.max(1, maxCovers - 1)

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

  // ── PATCH /bookings/:id/relocate ─────────────────────────────
  // Smart drag-to-table from the timeline.
  //
  // Algorithm:
  //   1. Try single table if target alone fits covers
  //   2. Try smallest combination that contains target table and fits covers
  //   3. Fall back to physically-adjacent tables (expand outward by sort_order)
  //   4. For any bookings that conflict with the new allocation:
  //      a. Try to move each conflicted booking to a free single table
  //      b. If none available → assign to venue's Unallocated table (auto-created)
  //   5. Execute all moves atomically; broadcast every change
  //
  // Returns: { moved: Booking, displaced: Booking[] }
  app.patch('/:id/relocate', { preHandler: requireRole('admin', 'owner', 'operator') }, async (req) => {
    const body = z.object({
      target_table_id: z.string().uuid(),
      starts_at:       z.string().datetime().optional(),
    }).parse(req.body)

    const result = await withTenant(req.tenantId, async tx => {

      // ── 1. Load booking ──────────────────────────────────────
      const [booking] = await tx`
        SELECT b.* FROM bookings b
         WHERE b.id        = ${req.params.id}
           AND b.tenant_id = ${req.tenantId}
           AND b.status NOT IN ('cancelled')
      `
      if (!booking) throw httpError(404, 'Booking not found')

      const durationMs = new Date(booking.ends_at) - new Date(booking.starts_at)
      const newStart   = new Date(body.starts_at ?? booking.starts_at)
      const newEnd     = new Date(newStart.getTime() + durationMs)

      // ── 2. Verify target table ───────────────────────────────
      const [targetTable] = await tx`
        SELECT * FROM tables
         WHERE id             = ${body.target_table_id}
           AND venue_id       = ${booking.venue_id}
           AND tenant_id      = ${req.tenantId}
           AND is_active      = true
           AND is_unallocated = false
      `
      if (!targetTable) throw httpError(404, 'Target table not found')

      // ── 2b. Load allocation rules & disallowed pairs ─────────
      const [allocRules] = await tx`
        SELECT allow_cross_section_combo, allow_non_adjacent_combo
          FROM booking_rules
         WHERE venue_id = ${booking.venue_id} AND tenant_id = ${req.tenantId}
      `
      const crossSection = allocRules?.allow_cross_section_combo ?? false
      const nonAdjacent  = allocRules?.allow_non_adjacent_combo  ?? false

      const disallowedPairs = await tx`
        SELECT table_id_a, table_id_b FROM disallowed_table_pairs
         WHERE venue_id = ${booking.venue_id} AND tenant_id = ${req.tenantId}
      `
      const hasDisallowedPair = (ids) => {
        const s = new Set(ids)
        return disallowedPairs.some(p => s.has(p.table_id_a) && s.has(p.table_id_b))
      }

      // Load all active tables once — used for adjacency checks in 3b and expansion in 3c
      const allTables = await tx`
        SELECT id, max_covers, sort_order, section_id FROM tables
         WHERE venue_id       = ${booking.venue_id}
           AND tenant_id      = ${req.tenantId}
           AND is_active      = true
           AND is_unallocated = false
         ORDER BY sort_order, label
      `
      const tableIndexMap = new Map(allTables.map((t, i) => [t.id, i]))
      const isAdjacentSet = (ids) => {
        const indices = ids.map(id => tableIndexMap.get(id)).filter(i => i !== undefined)
        if (indices.length !== ids.length) return false
        indices.sort((a, b) => a - b)
        return indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1)
      }

      // ── 3. Choose allocation (list of table IDs to occupy) ───
      let allocationTableIds = null   // string[]
      let allocationComboId  = null   // string | null

      // 3a. Single table — target alone is sufficient
      if (targetTable.max_covers >= booking.covers) {
        allocationTableIds = [body.target_table_id]
        allocationComboId  = null
      }

      // 3b. Smallest existing combination containing target table that fits covers
      if (!allocationTableIds) {
        const combos = await tx`
          SELECT c.id, c.max_covers,
                 array_agg(m.table_id   ORDER BY t2.sort_order, t2.label) AS table_ids,
                 array_agg(t2.section_id ORDER BY t2.sort_order, t2.label) AS section_ids
            FROM table_combinations c
            JOIN table_combination_members m ON m.combination_id = c.id
            JOIN tables t2                   ON t2.id = m.table_id
           WHERE c.tenant_id  = ${req.tenantId}
             AND c.venue_id   = ${booking.venue_id}
             AND c.is_active  = true
             AND c.max_covers >= ${booking.covers}
             AND EXISTS (
                   SELECT 1 FROM table_combination_members
                    WHERE combination_id = c.id
                      AND table_id       = ${body.target_table_id}
                 )
           GROUP BY c.id, c.max_covers
           ORDER BY c.max_covers ASC
        `
        for (const combo of combos) {
          // Cross-section rule: all members must share the same section as the target
          if (!crossSection && combo.section_ids.some(s => s !== targetTable.section_id)) continue
          // Non-adjacent rule: members must form a contiguous run by sort_order index
          if (!nonAdjacent && !isAdjacentSet(combo.table_ids)) continue
          // Disallowed pairs: skip if any member pair is blocked
          if (hasDisallowedPair(combo.table_ids)) continue

          allocationTableIds = combo.table_ids
          allocationComboId  = combo.id
          break
        }
      }

      // 3c. Adjacency expansion — build contiguous run outward from target by sort_order
      // Respects cross-section and disallowed-pair rules; always stays physically contiguous.
      if (!allocationTableIds) {
        const targetIdx = allTables.findIndex(t => t.id === body.target_table_id)
        if (targetIdx !== -1) {
          let lo = targetIdx, hi = targetIdx
          let total = Number(allTables[targetIdx].max_covers)
          let expandHi = true  // alternate direction each iteration

          const tryExpandHi = () => {
            if (hi >= allTables.length - 1) return false
            const candidate = allTables[hi + 1]
            if (!crossSection && candidate.section_id !== targetTable.section_id) return false
            const newIds = allTables.slice(lo, hi + 2).map(t => t.id)
            if (hasDisallowedPair(newIds)) return false
            hi++; total += Number(candidate.max_covers)
            return true
          }

          const tryExpandLo = () => {
            if (lo <= 0) return false
            const candidate = allTables[lo - 1]
            if (!crossSection && candidate.section_id !== targetTable.section_id) return false
            const newIds = allTables.slice(lo - 1, hi + 1).map(t => t.id)
            if (hasDisallowedPair(newIds)) return false
            lo--; total += Number(candidate.max_covers)
            return true
          }

          while (total < booking.covers) {
            const expanded = expandHi
              ? (tryExpandHi() || tryExpandLo())
              : (tryExpandLo() || tryExpandHi())
            if (!expanded) break
            expandHi = !expandHi
          }

          if (total >= booking.covers) {
            allocationTableIds = allTables.slice(lo, hi + 1).map(t => t.id)
            allocationComboId  = null
          }
        }
      }

      if (!allocationTableIds || allocationTableIds.length === 0) {
        throw httpError(422, 'No suitable table arrangement found for this booking size')
      }

      // ── 4. Find existing combination for multi-table (never auto-create) ─────
      // Adjacency expansion finds a table set but no combo ID.
      // Only use a combo_id if a pre-configured combination already exists.
      // If none exists, fall back to the single target table rather than creating one.
      if (allocationTableIds.length > 1 && !allocationComboId) {
        const sorted = [...allocationTableIds].sort()
        const [existing] = await tx`
          SELECT c.id FROM table_combinations c
           WHERE c.tenant_id = ${req.tenantId}
             AND c.is_active = true
             AND (SELECT COUNT(*) FROM table_combination_members m WHERE m.combination_id = c.id) = ${sorted.length}
             AND (SELECT COUNT(*) FROM table_combination_members m
                   WHERE m.combination_id = c.id
                     AND m.table_id = ANY(${sorted}::uuid[])) = ${sorted.length}
           LIMIT 1
        `
        if (existing) {
          allocationComboId = existing.id
        } else {
          // Step 3a already confirmed the target table alone is insufficient.
          // No pre-configured combination covers this table set, so there is no
          // valid allocation — surface a clear error rather than silently booking
          // onto a table that can't hold the party.
          throw httpError(422,
            'No table combination is configured for the required tables. ' +
            'Go to Tables → Table combinations and create one first, then try again.'
          )
        }
      }

      // Resolve canonical table_id (first member by sort order, or the single table)
      let canonicalTableId
      if (allocationComboId) {
        const [first] = await tx`
          SELECT m.table_id FROM table_combination_members m
            JOIN tables t ON t.id = m.table_id
           WHERE m.combination_id = ${allocationComboId}
           ORDER BY t.sort_order, t.label LIMIT 1
        `
        canonicalTableId = first.table_id
      } else {
        canonicalTableId = allocationTableIds[0]
      }

      // ── 5. Find conflicts at the new time for all allocated tables ─
      const conflicts = await tx`
        SELECT b.id, b.table_id, b.combination_id, b.covers,
               b.starts_at, b.ends_at, b.guest_name
          FROM bookings b
         WHERE b.tenant_id = ${req.tenantId}
           AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
           AND b.id     != ${req.params.id}
           AND b.starts_at < ${newEnd.toISOString()}
           AND b.ends_at   > ${newStart.toISOString()}
           AND (
                 b.table_id = ANY(${allocationTableIds}::uuid[])
                 OR (b.combination_id IS NOT NULL AND EXISTS (
                       SELECT 1 FROM table_combination_members m
                        WHERE m.combination_id = b.combination_id
                          AND m.table_id = ANY(${allocationTableIds}::uuid[])
                     ))
               )
      `

      // ── 6. Resolve each conflict — free table, free combo, or unallocated ─
      // usedTableIds tracks all tables committed in this transaction so we
      // don't move two conflicts to the same table or overlapping combinations.
      const usedTableIds = new Set(allocationTableIds)
      const resolutions  = []

      for (const conflict of conflicts) {
        const usedArr = [...usedTableIds]

        // 6a. Try smallest free single table that fits.
        // Exclude both the conflict booking AND the primary booking being moved
        // (req.params.id) — the primary is vacating its table in this transaction,
        // so that table must be treated as free when finding a home for the conflict.
        const excludeIds = [conflict.id, req.params.id]
        const [freeTable] = await tx`
          SELECT t.id FROM tables t
           WHERE t.venue_id       = ${booking.venue_id}
             AND t.tenant_id      = ${req.tenantId}
             AND t.is_active      = true
             AND t.is_unallocated = false
             AND t.max_covers     >= ${conflict.covers}
             AND t.id != ALL(${usedArr}::uuid[])
             AND NOT EXISTS (
                   SELECT 1 FROM bookings b2
                    WHERE b2.table_id  = t.id
                      AND b2.tenant_id = ${req.tenantId}
                      AND b2.id != ALL(${excludeIds}::uuid[])
                      AND b2.status NOT IN ('cancelled', 'no_show')
                      AND b2.starts_at < ${conflict.ends_at}
                      AND b2.ends_at   > ${conflict.starts_at}
                 )
           ORDER BY t.max_covers ASC
           LIMIT 1
        `
        if (freeTable) {
          usedTableIds.add(freeTable.id)
          resolutions.push({ conflict, newTableId: freeTable.id, comboId: null, unallocated: false })
          continue
        }

        // 6b. No single table — try smallest free combination that fits
        const [freeCombo] = await tx`
          SELECT c.id,
                 (SELECT array_agg(m2.table_id)
                    FROM table_combination_members m2
                   WHERE m2.combination_id = c.id) AS member_table_ids
            FROM table_combinations c
           WHERE c.tenant_id  = ${req.tenantId}
             AND c.venue_id   = ${booking.venue_id}
             AND c.is_active  = true
             AND c.max_covers >= ${conflict.covers}
             -- None of the combination's member tables are already claimed
             AND NOT EXISTS (
                   SELECT 1 FROM table_combination_members m2
                    WHERE m2.combination_id = c.id
                      AND m2.table_id = ANY(${usedArr}::uuid[])
                 )
             -- None of the combination's member tables have a conflicting booking.
             -- Exclude both the conflict and the primary booking being moved (its
             -- table is vacating in this transaction so must be treated as free).
             AND NOT EXISTS (
                   SELECT 1 FROM table_combination_members m3
                    JOIN bookings b2 ON b2.table_id = m3.table_id
                   WHERE m3.combination_id = c.id
                     AND b2.tenant_id = ${req.tenantId}
                     AND b2.status NOT IN ('cancelled', 'no_show')
                     AND b2.id != ALL(${excludeIds}::uuid[])
                     AND b2.starts_at < ${conflict.ends_at}
                     AND b2.ends_at   > ${conflict.starts_at}
                 )
           ORDER BY c.max_covers ASC
           LIMIT 1
        `
        if (freeCombo) {
          for (const tid of freeCombo.member_table_ids) usedTableIds.add(tid)
          resolutions.push({ conflict, newTableId: null, comboId: freeCombo.id, unallocated: false })
        } else {
          // 6c. No table or combo available — send to Unallocated
          resolutions.push({ conflict, newTableId: null, comboId: null, unallocated: true })
        }
      }

      // ── 7. Get or create Unallocated table if needed ─────────
      let unallocatedTableId = null
      if (resolutions.some(r => r.unallocated)) {
        const [existing] = await tx`
          SELECT id FROM tables
           WHERE venue_id       = ${booking.venue_id}
             AND tenant_id      = ${req.tenantId}
             AND is_unallocated = true
           LIMIT 1
        `
        if (existing) {
          unallocatedTableId = existing.id
        } else {
          const [created] = await tx`
            INSERT INTO tables
              (venue_id, tenant_id, label, min_covers, max_covers,
               is_active, is_unallocated, sort_order)
            VALUES
              (${booking.venue_id}, ${req.tenantId}, 'Unallocated',
               1, 9999, true, true, -999)
            RETURNING id
          `
          unallocatedTableId = created.id
        }
      }

      // ── 8. Execute all moves ─────────────────────────────────
      const displaced = []
      for (const { conflict, newTableId, comboId, unallocated } of resolutions) {
        let destTableId, destComboId

        if (unallocated) {
          destTableId = unallocatedTableId
          destComboId = null
        } else if (comboId) {
          // Resolve canonical table_id for the destination combination
          const [firstMember] = await tx`
            SELECT m.table_id FROM table_combination_members m
              JOIN tables t ON t.id = m.table_id
             WHERE m.combination_id = ${comboId}
             ORDER BY t.sort_order, t.label LIMIT 1
          `
          destTableId = firstMember.table_id
          destComboId = comboId
        } else {
          destTableId = newTableId
          destComboId = null
        }

        const [updated] = await tx`
          UPDATE bookings
             SET table_id       = ${destTableId},
                 combination_id = ${destComboId},
                 updated_at     = now()
           WHERE id        = ${conflict.id}
             AND tenant_id = ${req.tenantId}
          RETURNING *
        `
        displaced.push(updated)
      }

      // Move the primary booking
      const [moved] = await tx`
        UPDATE bookings
           SET table_id       = ${canonicalTableId},
               combination_id = ${allocationComboId},
               starts_at      = ${newStart.toISOString()},
               ends_at        = ${newEnd.toISOString()},
               updated_at     = now()
         WHERE id        = ${req.params.id}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      return { moved, displaced }
    })

    // Broadcast all changes over WebSocket
    broadcastBooking('booking.updated', result.moved)
    for (const d of result.displaced) broadcastBooking('booking.updated', d)

    return result
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
