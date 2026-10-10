// src/services/guestBookingSvc.js
//
// Changing and cancelling an existing booking, shared by the guest manage
// page (routes/manageBooking.js), the AI booking tools (src/ai/tools) and
// the staff assistant. One implementation of "move this booking to another
// date / time / party size" so every channel applies the same rules:
// party-size limits, the booking cutoff (guests only), the slot grid
// (get_available_slots: sittings, doors close, caps) and table allocation
// (keep the table if it still fits and is free, else allocateBestFit with
// no displacement).

import { sql, withTenant }  from '../config/db.js'
import { httpError }        from '../middleware/error.js'
import { broadcastBooking } from './broadcastSvc.js'
import { notificationQueue } from '../jobs/queues.js'
import { allocateBestFit, combinationIsFree, tableIsFree } from './occupancySvc.js'

// A fragment per query (postgres.js fragments are built inline).
const bookingSelect = () => sql`
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
`

/** A booking with its venue and guest-permission settings, by manage token. */
export async function loadBookingByToken(token) {
  if (!token || typeof token !== 'string') return null
  const [row] = await sql`${bookingSelect()} WHERE b.manage_token = ${token} LIMIT 1`
  return row ?? null
}

/** Same shape, by booking id (callers have already checked access). */
export async function loadBookingById(id) {
  if (!id) return null
  const [row] = await sql`${bookingSelect()} WHERE b.id = ${id} LIMIT 1`
  return row ?? null
}

const CLOSED = ['cancelled', 'no_show', 'checked_out']

export function canModify(booking) {
  if (booking.allow_guest_modify === false) return false
  if (CLOSED.includes(booking.status)) return false
  return true
}

export function canCancel(booking) {
  if (booking.allow_guest_cancel === false) return false
  if (CLOSED.includes(booking.status)) return false
  const cutoffHours = booking.cancel_cutoff_hours ?? 2
  const cutoff = new Date(booking.starts_at).getTime() - cutoffHours * 3600_000
  if (Date.now() > cutoff) return false
  return true
}

/** Why a guest can't cancel, for messages; null when they can. */
export function cancelBlockReason(booking) {
  if (booking.allow_guest_cancel === false) return 'This restaurant doesn\'t allow cancelling online. Please call them.'
  if (CLOSED.includes(booking.status)) return 'This booking is already ' + booking.status.replace('_', ' ') + '.'
  if (!canCancel(booking)) {
    return 'It\'s too close to the booking time to cancel online (' + (booking.cancel_cutoff_hours ?? 2) + ' hours before). Please call the restaurant.'
  }
  return null
}

export async function venueLocalParts(startsAt, timezone) {
  const tz = timezone || 'UTC'
  const [row] = await sql`
    SELECT
      to_char(${startsAt}::timestamptz AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS local_date,
      to_char(${startsAt}::timestamptz AT TIME ZONE ${tz}, 'HH24:MI')     AS local_time
  `
  return row
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Move a booking to a new date / time / party size (each optional; the
 * rest stay as they are). `booking` comes from loadBookingByToken/ById.
 * `staff: true` skips the booking cutoff (staff can change a booking close
 * to its time); everything else applies to both. Returns the updated row.
 * Throws httpError 4xx with a message fit for the guest.
 */
export async function rescheduleBooking(booking, { date, time, covers: newCovers } = {}, { staff = false } = {}) {
  if (!date && !time && !newCovers) throw httpError(422, 'Nothing to change')
  if (CLOSED.includes(booking.status)) throw httpError(422, 'This booking is ' + booking.status.replace('_', ' ') + ' and can\'t be changed')

  const updated = await withTenant(booking.t_tenant_id, async tx => {
    const timezone = booking.venue_timezone || 'UTC'
    const durationMs = new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()
    const current = await venueLocalParts(booking.starts_at, timezone)

    const newDate = date || current.local_date
    const newTime = time || current.local_time
    const covers  = newCovers ?? booking.covers

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
    if (startsAt.getTime() < Date.now()) throw httpError(422, 'That time has already passed')
    if (!staff) {
      const cutoffMs = (rules?.cutoff_before_mins ?? 60) * 60_000
      if (Date.now() > startsAt.getTime() - cutoffMs) {
        throw httpError(422, 'Booking cutoff has passed for this slot')
      }
    }

    // Sitting / doors-close / book-ahead grid for this party size.
    const slots = await tx`
      SELECT slot_time, available, available_covers, reason
        FROM get_available_slots(${booking.t_venue_id}::uuid, ${newDate}::date, ${covers})
    `
    const slot = slots.find(s => new Date(s.slot_time).getTime() === startsAt.getTime())
    if (!slot) throw httpError(422, 'That time is not a bookable slot')

    const selfInSlot = overlaps(
      new Date(booking.starts_at), new Date(booking.ends_at),
      startsAt, endsAt,
    )
    const remaining = Number(slot.available_covers ?? 0) + (selfInSlot ? booking.covers : 0)
    if (remaining < covers) {
      throw httpError(422, slot.reason && slot.reason !== 'available'
        ? 'That slot is ' + String(slot.reason).replace('_', ' ')
        : 'That slot is no longer available for this party size')
    }

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

    const [row] = await tx`
      UPDATE bookings
         SET starts_at      = ${startsAt.toISOString()},
             ends_at        = ${endsAt.toISOString()},
             covers         = ${covers},
             table_id       = ${tableId},
             combination_id = ${combinationId},
             updated_at     = now()
       WHERE id = ${booking.id} AND tenant_id = ${booking.t_tenant_id}
      RETURNING *
    `
    return row
  })

  broadcastBooking('booking.updated', updated)
  queueBookingEmail(booking, 'modification')
  return updated
}

/** Cancel a booking (callers check canCancel / permissions first). */
export async function cancelBooking(booking) {
  const [row] = await withTenant(booking.t_tenant_id, tx => tx`
    UPDATE bookings
       SET status = 'cancelled', updated_at = now()
     WHERE id = ${booking.id} AND tenant_id = ${booking.t_tenant_id}
    RETURNING *
  `)
  if (row) broadcastBooking('booking.updated', row)
  queueBookingEmail(booking, 'cancellation')
  return row
}

/** Best-effort guest email; never blocks or fails the request. */
export function queueBookingEmail(booking, type) {
  notificationQueue.add('booking_email', {
    bookingId:  booking.id,
    tenantId:   booking.t_tenant_id || booking.tenant_id,
    venueId:    booking.t_venue_id || booking.venue_id,
    type,
    guestEmail: booking.guest_email,
  }).catch(() => {})
}
