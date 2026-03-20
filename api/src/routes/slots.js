// src/routes/slots.js
// GET /venues/:venueId/slots?date=YYYY-MM-DD&covers=N
//
// Thin route — all logic lives in the get_available_slots() PG function.
// Used by both the admin portal (preview) and the booking widget (public).
// Widget calls are unauthenticated; admin calls carry JWT for tenant context.

import { z } from 'zod'
import { withTenant, withTx, sql } from '../config/db.js'
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
    // Widget calls pass venue slug; admin calls use UUID directly.
    // Guard UUID comparison in JS first — passing a slug to v.id = $1
    // would throw a PG cast error (22P02) before the OR branch is tried.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const isUuid = UUID_RE.test(venueId)

    const [venue] = await withTx(tx => tx`
      SELECT v.id, v.tenant_id, v.is_active, v.timezone
        FROM venues v
       WHERE ${isUuid ? sql`v.id = ${venueId}::uuid` : sql`v.slug = ${venueId}`}
       LIMIT 1
    `)
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
          -- First available individual table for these covers at this slot
          (
            SELECT t.id
              FROM tables t
             WHERE t.venue_id  = ${venue.id}
               AND t.tenant_id = ${venue.tenant_id}
               AND t.is_active = true
               AND t.max_covers >= ${covers}
               AND t.min_covers <= ${covers}
               -- No direct booking on this table
               AND NOT EXISTS (
                 SELECT 1 FROM bookings b
                  WHERE b.table_id  = t.id
                    AND b.status NOT IN ('cancelled')
                    AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND b.ends_at   > s.slot_time
               )
               -- No direct hold on this table
               AND NOT EXISTS (
                 SELECT 1 FROM booking_holds h
                  WHERE h.table_id  = t.id
                    AND h.expires_at > now()
                    AND h.starts_at  < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND h.ends_at    > s.slot_time
               )
               -- No combination booking that includes this table
               AND NOT EXISTS (
                 SELECT 1 FROM bookings bc
                  JOIN table_combination_members m ON m.combination_id = bc.combination_id
                  WHERE m.table_id = t.id
                    AND bc.combination_id IS NOT NULL
                    AND bc.status NOT IN ('cancelled')
                    AND bc.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND bc.ends_at   > s.slot_time
               )
               -- No combination hold that includes this table
               AND NOT EXISTS (
                 SELECT 1 FROM booking_holds hc
                  JOIN table_combination_members m ON m.combination_id = hc.combination_id
                  WHERE m.table_id = t.id
                    AND hc.combination_id IS NOT NULL
                    AND hc.expires_at > now()
                    AND hc.starts_at  < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND hc.ends_at    > s.slot_time
               )
             ORDER BY t.sort_order, t.label
             LIMIT 1
          ) AS table_id,
          -- First available combination for these covers at this slot
          (
            SELECT c.id
              FROM table_combinations c
             WHERE c.venue_id  = ${venue.id}
               AND c.is_active = true
               AND c.max_covers >= ${covers}
               AND c.min_covers <= ${covers}
               -- All member tables must be free
               AND NOT EXISTS (
                 SELECT 1 FROM table_combination_members m
                  JOIN tables mt ON mt.id = m.table_id
                  WHERE m.combination_id = c.id
                    AND (
                      NOT mt.is_active
                      OR EXISTS (
                        SELECT 1 FROM bookings b
                         WHERE b.table_id = mt.id
                           AND b.status NOT IN ('cancelled')
                           AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                           AND b.ends_at > s.slot_time
                      )
                      OR EXISTS (
                        SELECT 1 FROM booking_holds h
                         WHERE h.table_id = mt.id
                           AND h.expires_at > now()
                           AND h.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                           AND h.ends_at > s.slot_time
                      )
                      OR EXISTS (
                        SELECT 1 FROM bookings bc
                         JOIN table_combination_members m2 ON m2.combination_id = bc.combination_id
                         WHERE m2.table_id = mt.id
                           AND bc.combination_id IS NOT NULL
                           AND bc.status NOT IN ('cancelled')
                           AND bc.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                           AND bc.ends_at > s.slot_time
                      )
                      OR EXISTS (
                        SELECT 1 FROM booking_holds hc
                         JOIN table_combination_members m2 ON m2.combination_id = hc.combination_id
                         WHERE m2.table_id = mt.id
                           AND hc.combination_id IS NOT NULL
                           AND hc.expires_at > now()
                           AND hc.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                           AND hc.ends_at > s.slot_time
                      )
                    )
               )
             ORDER BY c.max_covers  -- prefer smallest fitting combination
             LIMIT 1
          ) AS combination_id
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
      // Prefer individual table; fall back to combination
      table_id:       s.table_id ?? null,
      combination_id: s.table_id ? null : (s.combination_id ?? null),
      available:      s.available && (s.table_id !== null || s.combination_id !== null),
      reason:         s.available && s.table_id === null && s.combination_id === null
                        ? 'no_table'
                        : s.reason,
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
