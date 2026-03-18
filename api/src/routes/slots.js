// src/routes/slots.js
// GET /venues/:venueId/slots?date=YYYY-MM-DD&covers=N
//
// Thin route — all logic lives in the get_available_slots() PG function.
// Used by both the admin portal (preview) and the booking widget (public).
// Widget calls are unauthenticated; admin calls carry JWT for tenant context.

import { z } from 'zod'
import { withTenant, sql } from '../config/db.js'
import { httpError } from '../middleware/error.js'

const QuerySchema = z.object({
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  covers: z.coerce.number().int().min(1).default(1),
})

export default async function slotsRoutes(app) {

  // ── GET /venues/:venueId/slots ──────────────────────────
  // Public endpoint — no auth required.
  // For admin preview calls the JWT is validated upstream but not required here.
  app.get('/:venueId/slots', async (req) => {
    const { date, covers } = QuerySchema.parse(req.query)
    const { venueId } = req.params

    // Resolve tenant from venue slug or direct venueId.
    // Widget calls pass venue slug via query; admin calls use UUID directly.
    // Here we accept UUID and resolve tenant so we can set RLS context.
    const [venue] = await sql`
      SELECT v.id, v.tenant_id, v.is_active, v.timezone
        FROM venues v
       WHERE v.id = ${venueId}
          OR v.slug = ${venueId}
       LIMIT 1
    `
    if (!venue) throw httpError(404, 'Venue not found')
    if (!venue.is_active) throw httpError(404, 'Venue not found')

    const slots = await withTenant(venue.tenant_id, async tx => {
      const [rules] = await tx`
        SELECT slot_duration_mins, buffer_after_mins
          FROM booking_rules
         WHERE venue_id = ${venue.id}
      `
      const slotMins   = rules?.slot_duration_mins ?? 90
      const bufferMins = rules?.buffer_after_mins  ?? 0
      const windowMins = slotMins + bufferMins

      return tx`
        SELECT
          s.slot_time,
          s.available,
          s.available_covers,
          s.reason,
          (
            SELECT t.id
              FROM tables t
             WHERE t.venue_id  = ${venue.id}
               AND t.tenant_id = ${venue.tenant_id}
               AND t.is_active = true
               AND t.max_covers >= ${covers}
               AND t.min_covers <= ${covers}
               AND NOT EXISTS (
                 SELECT 1 FROM bookings b
                  WHERE b.table_id  = t.id
                    AND b.status NOT IN ('cancelled')
                    AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND b.ends_at   > s.slot_time
               )
               AND NOT EXISTS (
                 SELECT 1 FROM booking_holds h
                  WHERE h.table_id  = t.id
                    AND h.expires_at > now()
                    AND h.starts_at  < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND h.ends_at    > s.slot_time
               )
             ORDER BY t.sort_order, t.label
             LIMIT 1
          ) AS table_id
        FROM get_available_slots(
          ${venue.id}::uuid,
          ${date}::date,
          ${covers}::int
        ) s
        ORDER BY s.slot_time
      `
    })

    const enriched = slots.map(s => ({
      ...s,
      available: s.available && s.table_id !== null,
      reason:    s.available && s.table_id === null ? 'no_table' : s.reason,
    }))

    return {
      venue_id:  venue.id,
      date,
      covers,
      timezone:  venue.timezone,
      slots:     enriched,
    }
  })
}
