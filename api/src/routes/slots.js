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

    const slots = await withTenant(venue.tenant_id, tx => tx`
      SELECT
        slot_time,
        available,
        available_covers,
        reason
      FROM get_available_slots(
        ${venue.id}::uuid,
        ${date}::date,
        ${covers}::int
      )
      ORDER BY slot_time
    `)

    return {
      venue_id:  venue.id,
      date,
      covers,
      timezone:  venue.timezone,
      slots,
    }
  })
}
