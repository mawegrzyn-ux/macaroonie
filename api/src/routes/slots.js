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
    const isAdminCall = !!req.user

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
          s.sitting_closes_at,
          s.sitting_doors_close,
          -- First available individual table for these covers at this slot
          (
            SELECT t.id
              FROM tables t
             WHERE t.venue_id       = ${venue.id}
               AND t.tenant_id      = ${venue.tenant_id}
               AND t.is_active      = true
               AND t.is_unallocated = false
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
          ) AS combination_id,
          -- Combination blocked only by unlocked bookings — displacement candidate for admins
          (
            SELECT json_build_object(
              'combination_id', c.id,
              'member_table_ids', (
                SELECT array_agg(m2.table_id ORDER BY m2.table_id)
                  FROM table_combination_members m2
                 WHERE m2.combination_id = c.id
              ),
              'conflicts', (
                SELECT json_agg(json_build_object(
                  'id', b.id,
                  'guest_name', b.guest_name,
                  'covers', b.covers
                ))
                  FROM table_combination_members m3
                  JOIN bookings b ON b.table_id = m3.table_id
                 WHERE m3.combination_id = c.id
                   AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                   AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                   AND b.ends_at   > s.slot_time
              )
            )
              FROM table_combinations c
             WHERE c.venue_id  = ${venue.id}
               AND c.is_active = true
               AND c.max_covers >= ${covers}
               AND c.min_covers <= ${covers}
               -- Has at least one conflicting booking at this time
               AND EXISTS (
                     SELECT 1 FROM table_combination_members m
                      JOIN bookings b ON b.table_id = m.table_id
                     WHERE m.combination_id = c.id
                       AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                       AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                       AND b.ends_at   > s.slot_time
                   )
               -- None of the conflicting bookings are locked
               AND NOT EXISTS (
                     SELECT 1 FROM table_combination_members m
                      JOIN bookings b ON b.table_id = m.table_id
                     WHERE m.combination_id = c.id
                       AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                       AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                       AND b.ends_at   > s.slot_time
                       AND b.table_locked = true
                   )
             ORDER BY c.max_covers
             LIMIT 1
          ) AS displace_candidate
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
      table_id:           s.table_id ?? null,
      combination_id:     s.table_id ? null : (s.combination_id ?? null),
      available:          s.available && (s.table_id !== null || s.combination_id !== null),
      // Only expose to admin calls — widget ignores displacement candidates
      displace_candidate: isAdminCall && !s.table_id && !s.combination_id
                            ? (s.displace_candidate ?? null)
                            : null,
      reason:             s.available && s.table_id === null && s.combination_id === null
                            ? 'no_table'
                            : s.reason,
    }))

    // ── Widget filtering: hide slots past per-sitting doors_close_time ─
    // Admin calls carry req.user (JWT validated). Widget calls are anonymous.
    // When allow_widget_bookings_after_doors_close = false, each slot is
    // matched to its sitting and filtered against that sitting's doors_close_time.
    let filtered = enriched

    if (!isAdminCall) {
      const [doorRule] = await withTenant(venue.tenant_id, tx => tx`
        SELECT allow_widget_bookings_after_doors_close FROM booking_rules
         WHERE venue_id = ${venue.id}
      `)

      const allowPastDoors = doorRule?.allow_widget_bookings_after_doors_close ?? false

      if (!allowPastDoors) {
        const dayOfWeek = new Date(date).getDay() // 0=Sun, 6=Sat
        let sittings = []

        // Mirror the same priority chain the PG slot resolver uses:
        // 1. schedule_exceptions  2. date overrides  3. weekly template

        const [exception] = await withTenant(venue.tenant_id, tx => tx`
          SELECT id, is_closed FROM schedule_exceptions
           WHERE venue_id = ${venue.id}
             AND ${date}::date BETWEEN date_from AND date_to
           ORDER BY priority DESC, (date_to - date_from) ASC
           LIMIT 1
        `)

        if (exception && !exception.is_closed) {
          const [excTemplate] = await withTenant(venue.tenant_id, tx => tx`
            SELECT id FROM exception_day_templates
             WHERE exception_id = ${exception.id}
               AND day_of_week  = ${dayOfWeek}
               AND is_open      = true
          `)
          if (excTemplate) {
            sittings = await withTenant(venue.tenant_id, tx => tx`
              SELECT opens_at, closes_at, doors_close_time
                FROM exception_sittings WHERE template_id = ${excTemplate.id}
            `)
          }
        }

        if (sittings.length === 0) {
          const [override] = await withTenant(venue.tenant_id, tx => tx`
            SELECT id FROM schedule_date_overrides
             WHERE venue_id      = ${venue.id}
               AND override_date = ${date}::date
               AND is_open       = true
             LIMIT 1
          `)
          if (override) {
            sittings = await withTenant(venue.tenant_id, tx => tx`
              SELECT opens_at, closes_at, doors_close_time
                FROM override_sittings WHERE override_id = ${override.id}
            `)
          }
        }

        if (sittings.length === 0) {
          sittings = await withTenant(venue.tenant_id, tx => tx`
            SELECT s.opens_at, s.closes_at, s.doors_close_time
              FROM venue_sittings s
              JOIN venue_schedule_templates t ON t.id = s.template_id
             WHERE t.venue_id    = ${venue.id}
               AND t.day_of_week = ${dayOfWeek}
          `)
        }

        if (sittings.some(s => s.doors_close_time)) {
          filtered = enriched.filter(slot => {
            const d = new Date(slot.slot_time)
            const slotHHMM = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`

            const sitting = sittings.find(s => {
              const opHHMM = String(s.opens_at).slice(0, 5)
              const clHHMM = String(s.closes_at).slice(0, 5)
              return slotHHMM >= opHHMM && slotHHMM < clHHMM
            })

            if (!sitting?.doors_close_time) return true
            return slotHHMM < String(sitting.doors_close_time).slice(0, 5)
          })
        }
      }
    }

    return {
      venue_id:  venue.id,
      date,
      covers,
      timezone:  venue.timezone,
      slots:     filtered,
    }
  })
}
