// src/routes/widgetApi.js
//
// Public booking-widget API. Mounted at /widget-api.
//
// No auth — these endpoints are called by the embeddable widget on
// tenant marketing sites (different origin, no JWT). Authorisation is
// venue-scoped: the venueId in the URL determines which tenant + venue
// the request operates on. Aggressive rate limit per IP.
//
// Routes:
//   GET    /venues/:venueId                         — public venue info + booking rules
//   GET    /venues/:venueId/slots?date=&covers=     — available slots
//   POST   /venues/:venueId/holds                   — create a hold
//   DELETE /venues/:venueId/holds/:holdId           — cancel a hold
//   POST   /venues/:venueId/holds/:holdId/confirm   — confirm a free booking
//
// Mirrors the auth'd /api/bookings + /api/venues/:id/slots endpoints
// but resolves tenant_id from the venue, not from a JWT.

import { z } from 'zod'
import { sql, withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { broadcastBooking } from '../services/broadcastSvc.js'
import { upsertCustomer } from '../routes/customers.js'
import { notificationQueue } from '../jobs/queues.js'
import { env } from '../config/env.js'

const HoldBody = z.object({
  starts_at:     z.string(),                // ISO 8601
  covers:        z.number().int().min(1).max(50),
  table_id:      z.string().uuid().nullable().optional(),
  combination_id: z.string().uuid().nullable().optional(),
  guest_name:    z.string().min(1).max(200),
  guest_email:   z.string().email().nullable().optional(),
  guest_phone:   z.string().min(1).max(50).nullable().optional(),
})

const ConfirmBody = z.object({
  guest_name:    z.string().min(1).max(200).optional(),
  guest_email:   z.string().email().nullable().optional(),
  guest_phone:   z.string().min(1).max(50).nullable().optional(),
  guest_notes:   z.string().max(2000).nullable().optional(),
  covers:        z.number().int().min(1).max(50).optional(),
})

async function resolveTenant(venueId) {
  const [venue] = await sql`
    SELECT v.id, v.tenant_id, v.name, v.timezone, v.currency
      FROM venues v
      JOIN tenants t ON t.id = v.tenant_id AND t.is_active = true
     WHERE v.id = ${venueId} AND v.is_active = true
     LIMIT 1
  `
  return venue ?? null
}

export default async function widgetApiRoutes(app) {
  // Tighter rate limit on widget endpoints — public, abuse-prone.
  app.addHook('onRequest', async (req, reply) => {
    // Allow embedding from anywhere — these are public booking pages.
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
  })

  // Preflight
  app.options('/*', async (req, reply) => reply.code(204).send())

  // ── GET /venues/:venueId ────────────────────────────────
  app.get('/venues/:venueId', async (req) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')

    // Theme + branding now come from tenant_site (one site per tenant);
    // per-venue website_config holds only location-page content.
    const [extras] = await withTenant(venue.tenant_id, tx => tx`
      SELECT br.slot_duration_mins, br.min_covers, br.max_covers,
             br.book_until_days, br.cutoff_before_mins, br.hold_ttl_secs,
             dr.requires_deposit, dr.amount_pence, dr.currency,
             ts.primary_colour, ts.secondary_colour, ts.font_family,
             ts.theme, ts.site_name
        FROM venues v
        LEFT JOIN booking_rules br ON br.venue_id  = v.id
        LEFT JOIN deposit_rules dr ON dr.venue_id  = v.id
        LEFT JOIN tenant_site   ts ON ts.tenant_id = v.tenant_id
       WHERE v.id = ${req.params.venueId}
    `)

    return {
      id:       venue.id,
      name:     venue.name,
      timezone: venue.timezone,
      currency: venue.currency,
      site_name: extras?.site_name || venue.name,
      slot_duration_mins: extras?.slot_duration_mins ?? 90,
      min_covers:         extras?.min_covers ?? 1,
      max_covers:         extras?.max_covers ?? 8,
      booking_window_days: extras?.book_until_days ?? 30,
      hold_ttl_secs:       extras?.hold_ttl_secs ?? 300,
      requires_deposit:    !!extras?.requires_deposit,
      deposit_amount_pence: extras?.amount_pence || null,
      deposit_currency:     extras?.currency || venue.currency,
      // Theme: prefer explicit theme JSONB → primary colour → tenant default
      primary_colour: extras?.primary_colour || extras?.theme?.colors?.primary || '#2563eb',
      font_family:    extras?.font_family    || extras?.theme?.typography?.body_font || 'system-ui',
    }
  })

  // ── GET /venues/:venueId/schedule-summary ───────────────
  // Lightweight schedule shape so the widget calendar knows which
  // days-of-week the venue is open. The widget greys out closed
  // days BEFORE the user clicks, instead of greeting them with
  // "no service on this date" after a wasted slot fetch.
  //
  // Returns:
  //   { openDaysOfWeek: number[]  // ISO Sun=0..Sat=6
  //     bookingWindowDays: number // how far ahead bookings allowed
  //   }
  //
  // Computed from the venue's weekly template only — exception /
  // override schedules still work at slot-fetch time, but for the
  // calendar's at-a-glance view the weekly template is enough.
  app.get('/venues/:venueId/schedule-summary', async (req) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')

    const rows = await withTenant(venue.tenant_id, tx => tx`
      SELECT DISTINCT t.day_of_week
        FROM venue_schedule_templates t
        JOIN venue_sittings           s ON s.template_id = t.id
       WHERE t.venue_id = ${venue.id}
       ORDER BY t.day_of_week
    `)

    const [rules] = await withTenant(venue.tenant_id, tx => tx`
      SELECT book_until_days
        FROM booking_rules
       WHERE venue_id = ${venue.id}
       LIMIT 1
    `)

    return {
      openDaysOfWeek:    rows.map(r => r.day_of_week),
      bookingWindowDays: rules?.book_until_days ?? 30,
    }
  })

  // ── GET /venues/:venueId/slots ──────────────────────────
  app.get('/venues/:venueId/slots', async (req) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')

    const date   = String(req.query.date || '')
    const covers = Math.max(1, Math.min(50, Number(req.query.covers) || 2))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Invalid date — expected YYYY-MM-DD')

    const slots = await withTenant(venue.tenant_id, tx => tx`
      SELECT * FROM get_available_slots(${req.params.venueId}::uuid, ${date}::date, ${covers}::int)
    `)
    /* Migration 020 changed slot_result.slot_time from `time` to
       `timestamptz`, so postgres.js deserialises it to a Date — calling
       `.slice()` on it threw `s.slot_time.slice is not a function`.
       Convert it to the venue's local HH:MM string here so the widget
       (which builds `${date}T${slot_time}:00`) keeps working unchanged. */
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: venue.timezone || 'UTC',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    function toLocalHHMM(v) {
      if (!v) return null
      const d = v instanceof Date ? v : new Date(v)
      if (Number.isNaN(d.getTime())) return null
      // Intl returns "HH:MM" with the en-GB locale + 24-hour clock.
      return fmt.format(d)
    }
    return slots.map(s => ({
      ...s,
      slot_time: toLocalHHMM(s.slot_time),
    })).filter(s => s.reason !== 'unavailable' && s.slot_time)
  })

  // ── POST /venues/:venueId/holds ─────────────────────────
  app.post('/venues/:venueId/holds', async (req, reply) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')
    const body = HoldBody.parse(req.body)

    const hold = await withTenant(venue.tenant_id, async tx => {
      const [rules] = await tx`
        SELECT slot_duration_mins, hold_ttl_secs, min_covers, max_covers,
               cutoff_before_mins
          FROM booking_rules
         WHERE venue_id = ${venue.id}
      `
      if (!rules) throw httpError(404, 'Venue booking rules not configured')
      if (body.covers < rules.min_covers || body.covers > rules.max_covers) {
        throw httpError(422, `Covers must be between ${rules.min_covers} and ${rules.max_covers}`)
      }

      const startsAt  = new Date(body.starts_at)
      const endsAt    = new Date(startsAt.getTime() + rules.slot_duration_mins * 60_000)
      const expiresAt = new Date(Date.now() + rules.hold_ttl_secs * 1_000)

      const cutoffMs = rules.cutoff_before_mins * 60_000
      if (Date.now() > startsAt.getTime() - cutoffMs) {
        throw httpError(422, 'Booking cutoff has passed for this slot')
      }

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

      const [newHold] = await tx`
        INSERT INTO booking_holds
          (venue_id, table_id, combination_id, tenant_id, starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, expires_at)
        VALUES
          (${venue.id}, ${tableId}, ${body.combination_id ?? null}, ${venue.tenant_id},
           ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${body.covers},
           ${body.guest_name}, ${body.guest_email ?? null}, ${body.guest_phone ?? null},
           ${expiresAt.toISOString()})
        RETURNING *
      `
      return newHold
    })

    return reply.code(201).send(hold)
  })

  // ── DELETE /venues/:venueId/holds/:holdId ───────────────
  app.delete('/venues/:venueId/holds/:holdId', async (req) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')

    await withTenant(venue.tenant_id, tx => tx`
      DELETE FROM booking_holds
       WHERE id = ${req.params.holdId} AND tenant_id = ${venue.tenant_id}
    `)
    return { ok: true }
  })

  // ── POST /venues/:venueId/holds/:holdId/confirm ─────────
  // Free booking only. Stripe deposit flow is a follow-up.
  app.post('/venues/:venueId/holds/:holdId/confirm', async (req, reply) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')
    const body = ConfirmBody.parse(req.body)

    const booking = await withTenant(venue.tenant_id, async tx => {
      // Block deposit-required venues from this path
      const [deposit] = await tx`SELECT requires_deposit FROM deposit_rules WHERE venue_id = ${venue.id}`
      if (deposit?.requires_deposit) {
        throw httpError(422, 'This venue requires a deposit — payment flow not yet wired into the public widget')
      }

      // confirm_hold validates and locks
      const [result] = await tx`
        SELECT is_valid, reason FROM confirm_hold(${req.params.holdId}::uuid, ${venue.tenant_id}::uuid)
      `
      if (!result.is_valid) {
        const reasons = {
          hold_not_found: [404, 'Hold not found or already used'],
          hold_expired:   [422, 'Hold has expired — please start again'],
          slot_conflict:  [409, 'Slot just got taken — try another time'],
        }
        const [code, msg] = reasons[result.reason] ?? [409, 'Could not confirm booking']
        throw httpError(code, msg)
      }

      const [h] = await tx`SELECT * FROM booking_holds WHERE id = ${req.params.holdId}`
      if (!h) throw httpError(404, 'Hold not found after confirmation')

      const [bookingRules] = await tx`SELECT enable_unconfirmed_flow FROM booking_rules WHERE venue_id = ${h.venue_id}`
      const initialStatus = bookingRules?.enable_unconfirmed_flow ? 'unconfirmed' : 'confirmed'

      const [bk] = await tx`
        INSERT INTO bookings
          (venue_id, table_id, combination_id, tenant_id, starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, guest_notes, status)
        VALUES
          (${h.venue_id}, ${h.table_id}, ${h.combination_id ?? null}, ${venue.tenant_id},
           ${h.starts_at}, ${h.ends_at}, ${body.covers ?? h.covers},
           ${body.guest_name ?? h.guest_name},
           ${body.guest_email || h.guest_email || null},
           ${body.guest_phone ?? h.guest_phone ?? null},
           ${body.guest_notes ?? null},
           ${initialStatus}::booking_status)
        RETURNING *
      `

      await tx`DELETE FROM booking_holds WHERE id = ${req.params.holdId}`
      return bk
    })

    // Customer upsert + emails (fire-and-forget)
    withTenant(venue.tenant_id, async tx => {
      const customerId = await upsertCustomer(tx, venue.tenant_id, {
        name:  booking.guest_name,
        email: booking.guest_email,
        phone: booking.guest_phone,
      })
      if (customerId) {
        await tx`UPDATE bookings SET customer_id = ${customerId} WHERE id = ${booking.id}`
      }
    }).catch(() => {})

    notificationQueue.add('booking_email', {
      bookingId: booking.id, tenantId: venue.tenant_id,
      venueId:   booking.venue_id, type: 'confirmation',
    }).catch(() => {})

    broadcastBooking('booking.created', booking)

    // Strip server-only fields before returning to the public widget.
    return reply.code(201).send({
      id:           booking.id,
      reference:    booking.id.slice(0, 8).toUpperCase(),
      manage_token: booking.manage_token,
      starts_at:    booking.starts_at,
      covers:       booking.covers,
      guest_name:   booking.guest_name,
      guest_email:  booking.guest_email,
      status:       booking.status,
    })
  })
}
