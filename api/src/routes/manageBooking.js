// src/routes/manageBooking.js
//
// Public guest-facing booking management.
//
// No auth — the manage_token UUID IS the authentication.
// Registered at /manage in app.js.
//
//   GET  /manage/:token        → SSR page showing booking details
//   POST /manage/:token/modify → reschedule (date, time, covers)
//   POST /manage/:token/cancel → cancel the booking

import { z }                from 'zod'
import { sql, withTenant }  from '../config/db.js'
import { env }              from '../config/env.js'
import { httpError }        from '../middleware/error.js'
import { broadcastBooking } from '../services/broadcastSvc.js'
import { allocateBestFit, combinationIsFree, tableIsFree } from '../services/occupancySvc.js'

async function loadBookingByToken(token) {
  if (!token || typeof token !== 'string') return null

  // Global lookup — no RLS (we're resolving by manage_token, not tenant).
  const [row] = await sql`
    SELECT b.*,
           t.id        AS t_tenant_id,
           t.name      AS tenant_name,
           v.id        AS t_venue_id,
           v.name      AS venue_name,
           v.slug      AS venue_slug,
           v.timezone  AS venue_timezone,
           tbl.label   AS table_label,
           ts.primary_colour,
           ts.site_name,
           ts.logo_url,
           ts.subdomain_slug,
           ves.allow_guest_modify,
           ves.allow_guest_cancel,
           ves.cancel_cutoff_hours
      FROM bookings b
      JOIN tenants t ON t.id = b.tenant_id AND t.is_active = true
      JOIN venues  v ON v.id = b.venue_id  AND v.is_active = true
      LEFT JOIN tables tbl ON tbl.id = b.table_id
      LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
      LEFT JOIN venue_email_settings ves ON ves.venue_id = v.id AND ves.tenant_id = t.id
     WHERE b.manage_token = ${token}
     LIMIT 1
  `
  return row ?? null
}

function canModify(booking) {
  if (booking.allow_guest_modify === false) return false
  if (['cancelled', 'no_show', 'checked_out'].includes(booking.status)) return false
  return true
}

function canCancel(booking) {
  if (booking.allow_guest_cancel === false) return false
  if (['cancelled', 'no_show', 'checked_out'].includes(booking.status)) return false
  const cutoffHours = booking.cancel_cutoff_hours ?? 2
  const cutoff = new Date(booking.starts_at).getTime() - cutoffHours * 3600_000
  if (Date.now() > cutoff) return false
  return true
}

export default async function manageBookingRoutes(app) {

  // ── GET /manage/:token — SSR page ───────────────────────
  app.get('/:token', async (req, reply) => {
    const booking = await loadBookingByToken(req.params.token)
    if (!booking) return reply.code(404).view('site/not-found.eta', {
      message: 'Booking not found or link has expired.',
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
    })

    const startDate = new Date(booking.starts_at)
    const endDate   = booking.ends_at ? new Date(booking.ends_at) : null

    return reply.view('manage/index.eta', {
      booking,
      startDate,
      endDate,
      canModify: canModify(booking),
      canCancel: canCancel(booking),
      token:     req.params.token,
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
      flash:     req.query.flash || null,
    })
  })

  // ── POST /manage/:token/modify ──────────────────────────
  app.post('/:token/modify', async (req, reply) => {
    const booking = await loadBookingByToken(req.params.token)
    if (!booking) throw httpError(404, 'Booking not found')
    if (!canModify(booking)) throw httpError(403, 'This booking cannot be modified')

    const body = z.object({
      date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      time:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
      covers: z.coerce.number().int().min(1).max(50).optional(),
    }).parse(req.body)

    // At least one field must change
    if (!body.date && !body.time && !body.covers) {
      throw httpError(422, 'Nothing to change')
    }

    await withTenant(booking.t_tenant_id, async tx => {
      const timezone = booking.venue_timezone || 'UTC'
      const durationMs = new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()

      const [{ local_date, local_time }] = await tx`
        SELECT
          to_char(${booking.starts_at}::timestamptz AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS local_date,
          to_char(${booking.starts_at}::timestamptz AT TIME ZONE ${timezone}, 'HH24:MI')     AS local_time
      `
      const newDate = body.date  || local_date
      const newTime = body.time  || local_time
      const covers  = body.covers ?? booking.covers

      const localStr = newDate + ' ' + newTime + ':00'
      const [{ ts: startsAt }] = await tx`
        SELECT (${localStr}::timestamp AT TIME ZONE ${timezone}) AS ts
      `
      const endsAt = new Date(startsAt.getTime() + durationMs)

      const [rules] = await tx`
        SELECT min_covers, max_covers, cutoff_before_mins
          FROM booking_rules WHERE venue_id = ${booking.t_venue_id}
      `
      if (rules && (covers < rules.min_covers || covers > rules.max_covers)) {
        throw httpError(422, `Party size must be between ${rules.min_covers} and ${rules.max_covers}`)
      }
      const cutoffMs = (rules?.cutoff_before_mins ?? 60) * 60_000
      if (Date.now() > startsAt.getTime() - cutoffMs) {
        throw httpError(422, 'Booking cutoff has passed for this slot')
      }

      const daySlots = await tx`
        SELECT 1 FROM get_available_slots(${booking.t_venue_id}::uuid, ${newDate}::date, 1)
         LIMIT 1
      `
      if (!daySlots.length) {
        throw httpError(422, 'The venue is closed or outside the booking window on that date')
      }

      const [onGrid] = await tx`
        SELECT 1 FROM get_available_slots(${booking.t_venue_id}::uuid, ${newDate}::date, 1) s
         WHERE s.slot_time = ${startsAt.toISOString()}::timestamptz
         LIMIT 1
      `
      if (!onGrid) throw httpError(422, 'That time is not a bookable slot')

      let tableId       = booking.table_id
      let combinationId = booking.combination_id
      let keep          = false

      if (combinationId) {
        const [combo] = await tx`
          SELECT min_covers, max_covers, is_active
            FROM table_combinations WHERE id = ${combinationId}
        `
        if (combo?.is_active && covers >= combo.min_covers && covers <= combo.max_covers) {
          keep = await combinationIsFree(tx, combinationId, startsAt, endsAt, {
            excludeBookingId: booking.id, lock: true,
          })
        }
      } else if (tableId) {
        const [tbl] = await tx`
          SELECT min_covers, max_covers, is_unallocated, is_active
            FROM tables WHERE id = ${tableId}
        `
        if (tbl && !tbl.is_unallocated && tbl.is_active
            && covers >= tbl.min_covers && covers <= tbl.max_covers) {
          keep = await tableIsFree(tx, tableId, startsAt, endsAt, {
            excludeBookingId: booking.id, lock: true,
          })
        }
      }

      if (!keep) {
        const alloc = await allocateBestFit(tx, {
          venueId: booking.t_venue_id,
          covers,
          startsAt,
          windowEnd: endsAt,
          excludeBookingId: booking.id,
          allowDisplace: false,
        })
        if (!alloc) {
          throw httpError(409, 'No tables available for the new time — please pick another slot')
        }
        tableId       = alloc.tableId
        combinationId = alloc.combinationId
      }

      const [updated] = await tx`
        UPDATE bookings
           SET starts_at      = ${startsAt.toISOString()},
               ends_at        = ${endsAt.toISOString()},
               covers         = ${covers},
               table_id       = ${tableId},
               combination_id = ${combinationId},
               updated_at     = now()
         WHERE id = ${booking.id}
        RETURNING *
      `
      broadcastBooking('booking.updated', updated)
    })

    try {
      const { notificationQueue } = await import('../jobs/queues.js')
      await notificationQueue.add('booking_email', {
        bookingId:  booking.id,
        tenantId:   booking.t_tenant_id,
        venueId:    booking.t_venue_id,
        type:       'modification',
        guestEmail: booking.guest_email,
      })
    } catch { /* best-effort */ }

    // Redirect back to manage page with flash
    reply.redirect(`/manage/${req.params.token}?flash=modified`)
  })

  // ── POST /manage/:token/cancel ──────────────────────────
  app.post('/:token/cancel', async (req, reply) => {
    const booking = await loadBookingByToken(req.params.token)
    if (!booking) throw httpError(404, 'Booking not found')
    if (!canCancel(booking)) throw httpError(403, 'This booking can no longer be cancelled')

    await withTenant(booking.t_tenant_id, tx => tx`
      UPDATE bookings
         SET status = 'cancelled', updated_at = now()
       WHERE id = ${booking.id}
    `)

    // Queue cancellation email
    try {
      const { notificationQueue } = await import('../jobs/queues.js')
      await notificationQueue.add('booking_email', {
        bookingId:  booking.id,
        tenantId:   booking.t_tenant_id,
        venueId:    booking.t_venue_id,
        type:       'cancellation',
        guestEmail: booking.guest_email,
      })
    } catch { /* best-effort */ }

    reply.redirect(`/manage/${req.params.token}?flash=cancelled`)
  })
}
