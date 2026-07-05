// src/routes/testData.js
//
// Dev/test-data tooling for pre-prod QA:
//   - POST /:venueId/test-data/seed  — generate dummy bookings across a date
//     range at a target occupancy level, so operators can populate a month
//     of realistic-looking data to exercise Timeline/Bookings without
//     manually creating dozens of bookings.
//   - POST /:venueId/test-data/clear — bulk-delete bookings for a date
//     range or the whole venue. Supports dry_run to preview a count before
//     the destructive call (the UI double-confirms + requires typed
//     confirmation on top of this).
//
// Bookings are inserted directly (bypassing holds/Stripe/slot-cap checks),
// same bypass precedent as POST /bookings/admin-override. Table assignment
// is a simple per-sitting random subset of active tables sized to the
// requested occupancy — it does not replicate get_available_slots()'s full
// allocation logic, which is unnecessary for synthetic test data.
//
// Mounted at /api/venues (see app.js) — same prefix as venues/schedules/cashRecon.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS  = 86_400_000
const MAX_RANGE_DAYS = 92 // ~3 months — keeps generation inside one request/transaction

const SEED_STATUSES = z.enum(['unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated', 'checked_out'])

// Resolves the day's sittings using the same Priority 1→2→3 cascade as
// GET /venues/:venueId/schedule/sittings-for-date (schedules.js) and
// get_available_slots(): named exception → single-date override → weekly
// template. Only opens_at/closes_at are needed here (no slot-cap or
// doors-close nuance — synthetic bookings don't go through slot resolution).
async function resolveSittingsForDate(tx, venueId, date) {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay()

  const [exception] = await tx`
    SELECT id, is_closed FROM schedule_exceptions
     WHERE venue_id = ${venueId} AND ${date}::date BETWEEN date_from AND date_to
     ORDER BY priority DESC, (date_to - date_from) ASC LIMIT 1
  `
  if (exception) {
    if (exception.is_closed) return []
    const [excTemplate] = await tx`
      SELECT id, is_open FROM exception_day_templates
       WHERE exception_id = ${exception.id} AND day_of_week = ${dow}
    `
    if (excTemplate) {
      if (!excTemplate.is_open) return []
      return tx`
        SELECT opens_at, closes_at FROM exception_sittings
         WHERE template_id = ${excTemplate.id} ORDER BY opens_at
      `
    }
    // Exception found but no DOW template configured — fall through.
  }

  const [override] = await tx`
    SELECT id, is_open FROM schedule_date_overrides
     WHERE venue_id = ${venueId} AND override_date = ${date}::date
  `
  if (override) {
    if (!override.is_open) return []
    return tx`
      SELECT opens_at, closes_at FROM override_sittings
       WHERE override_id = ${override.id} ORDER BY opens_at
    `
  }

  const [template] = await tx`
    SELECT id, is_open FROM venue_schedule_templates
     WHERE venue_id = ${venueId} AND day_of_week = ${dow}
  `
  if (!template || !template.is_open) return []
  return tx`
    SELECT opens_at, closes_at FROM venue_sittings
     WHERE template_id = ${template.id} ORDER BY opens_at
  `
}

function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default async function testDataRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── POST /:venueId/test-data/seed ──────────────────────────
  app.post('/:venueId/test-data/seed', { preHandler: requirePermission('test_data', 'manage') }, async (req) => {
    const { venueId } = req.params
    const body = z.object({
      date_from:     z.string().regex(DATE_RE),
      date_to:       z.string().regex(DATE_RE),
      occupancy_pct: z.number().int().min(1).max(100),
      status:        SEED_STATUSES.optional().default('confirmed'),
    }).parse(req.body)

    const dateFrom = new Date(body.date_from + 'T00:00:00Z')
    const dateTo   = new Date(body.date_to   + 'T00:00:00Z')
    if (dateTo < dateFrom) throw httpError(422, 'date_to must be on or after date_from')
    const dayCount = Math.round((dateTo - dateFrom) / DAY_MS) + 1
    if (dayCount > MAX_RANGE_DAYS) throw httpError(422, `Range too large — max ${MAX_RANGE_DAYS} days at a time`)

    return withTenant(req.tenantId, async tx => {
      const [venue] = await tx`SELECT id FROM venues WHERE id = ${venueId}`
      if (!venue) throw httpError(404, 'Venue not found')

      const [rules] = await tx`SELECT slot_duration_mins FROM booking_rules WHERE venue_id = ${venueId}`
      const durationMins = rules?.slot_duration_mins ?? 90

      const tables = await tx`
        SELECT id, min_covers, max_covers FROM tables
         WHERE venue_id = ${venueId} AND is_active = true AND is_unallocated = false
         ORDER BY sort_order
      `
      if (tables.length === 0) throw httpError(422, 'This venue has no active tables configured')

      let created  = 0
      let daysOpen = 0
      let guestSeq = 0

      for (let i = 0; i < dayCount; i++) {
        const dateStr = new Date(dateFrom.getTime() + i * DAY_MS).toISOString().slice(0, 10)

        const sittings = await resolveSittingsForDate(tx, venueId, dateStr)
        if (sittings.length === 0) continue
        daysOpen++

        for (const sitting of sittings) {
          // opens_at/closes_at are `time` columns → 'HH:MM:SS' strings.
          // Same server-local-time construction as admin-override — fine
          // here since this is synthetic data, not guest-facing input.
          const windowStart = new Date(`${dateStr}T${sitting.opens_at}`)
          const windowEnd   = new Date(`${dateStr}T${sitting.closes_at}`)
          const windowMins  = Math.round((windowEnd - windowStart) / 60_000)
          if (windowMins < 15) continue

          const targetCount = Math.round(tables.length * body.occupancy_pct / 100)
          const picked = shuffled(tables).slice(0, targetCount)

          for (const table of picked) {
            const slotSteps = Math.max(1, Math.floor(windowMins / 15))
            const startsAt  = new Date(windowStart.getTime() + Math.floor(Math.random() * slotSteps) * 15 * 60_000)
            const endsAt    = new Date(startsAt.getTime() + durationMins * 60_000)
            const covers    = table.min_covers + Math.floor(Math.random() * (table.max_covers - table.min_covers + 1))

            guestSeq++
            await tx`
              INSERT INTO bookings
                (venue_id, table_id, tenant_id, starts_at, ends_at, covers,
                 guest_name, guest_email, guest_notes, status)
              VALUES
                (${venueId}, ${table.id}, ${req.tenantId},
                 ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${covers},
                 ${'Test Guest ' + guestSeq}, ${'seed+test' + guestSeq + '@macaroonie.test'},
                 'Seeded test booking — generated by test data tool', ${body.status}::booking_status)
            `
            created++
          }
        }
      }

      return { created, daysOpen, daysTotal: dayCount }
    })
  })

  // ── POST /:venueId/test-data/clear ─────────────────────────
  // dry_run: true previews the count with no deletion (no confirm needed).
  // dry_run: false requires confirm: true and actually deletes.
  app.post('/:venueId/test-data/clear', { preHandler: requirePermission('test_data', 'manage') }, async (req) => {
    const { venueId } = req.params
    const body = z.object({
      mode:      z.enum(['range', 'all']),
      date_from: z.string().regex(DATE_RE).optional(),
      date_to:   z.string().regex(DATE_RE).optional(),
      dry_run:   z.boolean().optional().default(false),
      confirm:   z.boolean().optional().default(false),
    }).parse(req.body)

    if (body.mode === 'range' && (!body.date_from || !body.date_to)) {
      throw httpError(422, 'date_from and date_to are required for range mode')
    }
    if (!body.dry_run && body.confirm !== true) {
      throw httpError(422, 'confirm must be true to delete (or use dry_run to preview)')
    }

    return withTenant(req.tenantId, async tx => {
      const [venue] = await tx`SELECT id FROM venues WHERE id = ${venueId}`
      if (!venue) throw httpError(404, 'Venue not found')

      const rows = body.mode === 'all'
        ? await tx`SELECT id FROM bookings WHERE venue_id = ${venueId}`
        : await tx`
            SELECT id FROM bookings
             WHERE venue_id  = ${venueId}
               AND starts_at >= ${body.date_from}::date
               AND starts_at <  (${body.date_to}::date + interval '1 day')
          `
      const ids = rows.map(r => r.id)

      if (body.dry_run || ids.length === 0) {
        return { count: ids.length, deleted: 0 }
      }

      // payments.booking_id is ON DELETE RESTRICT — clear dependents first.
      await tx`DELETE FROM payments WHERE booking_id = ANY(${ids}::uuid[])`
      await tx`DELETE FROM bookings WHERE id = ANY(${ids}::uuid[])`

      return { count: ids.length, deleted: ids.length }
    })
  })
}
