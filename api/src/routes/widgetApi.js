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
//   GET    /openapi.json                                — OpenAPI spec for AI agents / ChatGPT Actions
//   GET    /venues/lookup?slug=                        — resolve site slug → venue list
//   GET    /venues/:venueId                            — public venue info + booking rules
//   GET    /venues/:venueId/schedule-summary           — open days of week
//   GET    /venues/:venueId/slots?date=&covers=        — available slots (table-availability aware)
//   POST   /venues/:venueId/book                       — AI one-shot booking (no hold step)
//   POST   /venues/:venueId/holds                      — create a hold (widget multi-step flow)
//   DELETE /venues/:venueId/holds/:holdId              — cancel a hold
//   POST   /venues/:venueId/holds/:holdId/confirm      — confirm a free booking

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

// Used by the AI one-shot booking endpoint POST /venues/:venueId/book
const BookBody = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time:        z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM in venue local time'),
  covers:      z.number().int().min(1).max(50),
  guest_name:  z.string().min(1).max(200),
  guest_email: z.string().email().nullable().optional(),
  guest_phone: z.string().max(50).nullable().optional(),
  notes:       z.string().max(2000).nullable().optional(),
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

// Auto-displace conflicting bookings to free the best-fit combination.
// Returns { tableId, combinationId, displacedIds } or null if impossible.
// Constraints: only individual table destinations (no Unallocated, no new combos).
// Locked and arrived/seated bookings are never displaced.
async function tryWidgetDisplace(tx, venueId, covers, startsAt, windowEnd) {
  // Find combinations that fit the party and have only displaceable conflicts
  const combos = await tx`
    SELECT c.id
      FROM table_combinations c
     WHERE c.venue_id   = ${venueId}
       AND c.is_active  = true
       AND c.min_covers <= ${covers}
       AND c.max_covers >= ${covers}
       AND EXISTS (
         SELECT 1 FROM table_combination_members m
          JOIN bookings b ON b.table_id = m.table_id
         WHERE m.combination_id = c.id
           AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
           AND b.starts_at < ${windowEnd.toISOString()}
           AND b.ends_at   > ${startsAt.toISOString()}
       )
       AND NOT EXISTS (
         SELECT 1 FROM table_combination_members m
          JOIN bookings b ON b.table_id = m.table_id
         WHERE m.combination_id = c.id
           AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
           AND (b.table_locked = true OR b.status IN ('arrived', 'seated'))
           AND b.starts_at < ${windowEnd.toISOString()}
           AND b.ends_at   > ${startsAt.toISOString()}
       )
     ORDER BY c.max_covers
     LIMIT 5
  `

  for (const combo of combos) {
    const result = await tryDisplaceCombo(tx, venueId, combo.id, startsAt, windowEnd)
    if (result) return result
  }
  return null
}

// Try to displace all conflicts on a specific combination.
// Returns { tableId, combinationId, displacedIds } or null.
// Destinations tried in order: free individual table, then free combination.
async function tryDisplaceCombo(tx, venueId, combinationId, startsAt, windowEnd) {
  const members = await tx`
    SELECT m.table_id FROM table_combination_members m
      JOIN tables t ON t.id = m.table_id
     WHERE m.combination_id = ${combinationId}
     ORDER BY t.sort_order, t.label
  `
  if (!members.length) return null
  const memberIds = members.map(m => m.table_id)

  const conflicts = await tx`
    SELECT b.id, b.covers, b.starts_at, b.ends_at
      FROM bookings b
      JOIN table_combination_members m ON m.table_id = b.table_id
     WHERE m.combination_id = ${combinationId}
       AND b.status NOT IN ('cancelled', 'no_show', 'checked_out', 'arrived', 'seated')
       AND b.table_locked = false
       AND b.starts_at < ${windowEnd.toISOString()}
       AND b.ends_at   > ${startsAt.toISOString()}
  `
  if (!conflicts.length) return null

  // Greedy allocation: claim tables/combos one conflict at a time.
  // claimedTableIds starts with the combo's own members (those need to be freed).
  const claimedTableIds = new Set(memberIds)
  const displacements   = []

  for (const conflict of conflicts) {
    const claimedArr = [...claimedTableIds]
    const cStart = new Date(conflict.starts_at).toISOString()
    const cEnd   = new Date(conflict.ends_at).toISOString()

    // 1. Try a free individual table first (cheapest option).
    const [freeTable] = await tx`
      SELECT t.id FROM tables t
       WHERE t.venue_id       = ${venueId}
         AND t.is_active      = true
         AND t.is_unallocated = false
         AND t.min_covers    <= ${conflict.covers}
         AND t.max_covers    >= ${conflict.covers}
         AND t.id != ALL(${claimedArr}::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM bookings b2
            WHERE b2.table_id = t.id
              AND b2.status NOT IN ('cancelled', 'no_show', 'checked_out')
              AND b2.starts_at < ${cEnd}
              AND b2.ends_at   > ${cStart}
         )
         AND NOT EXISTS (
           SELECT 1 FROM booking_holds bh
            WHERE bh.table_id = t.id
              AND bh.expires_at > now()
              AND bh.starts_at  < ${cEnd}
              AND bh.ends_at    > ${cStart}
         )
       ORDER BY t.max_covers ASC
       LIMIT 1
    `
    if (freeTable) {
      claimedTableIds.add(freeTable.id)
      displacements.push({ bookingId: conflict.id, newTableId: freeTable.id, newComboId: null })
      continue
    }

    // 2. No individual table — try a free existing combination as destination.
    const memberIdsArr = Array.from(memberIds)
    const [freeCombo] = await tx`
      SELECT c.id,
             (SELECT m2.table_id FROM table_combination_members m2
                JOIN tables t2 ON t2.id = m2.table_id
               WHERE m2.combination_id = c.id
               ORDER BY t2.sort_order, t2.label LIMIT 1) AS first_table_id
        FROM table_combinations c
       WHERE c.venue_id   = ${venueId}
         AND c.is_active  = true
         AND c.min_covers <= ${conflict.covers}
         AND c.max_covers >= ${conflict.covers}
         -- Must not share any tables with the combination we are freeing
         AND NOT EXISTS (
           SELECT 1 FROM table_combination_members mcx
            WHERE mcx.combination_id = c.id
              AND mcx.table_id = ANY(${memberIdsArr}::uuid[])
         )
         -- All member tables of the destination combo must be free (not claimed,
         -- not booked/held) during the conflict booking's own time window.
         AND NOT EXISTS (
           SELECT 1 FROM table_combination_members mc2
            JOIN tables mt2 ON mt2.id = mc2.table_id
           WHERE mc2.combination_id = c.id
             AND (
               NOT mt2.is_active
               OR mt2.id = ANY(${claimedArr}::uuid[])
               OR EXISTS (
                 SELECT 1 FROM bookings b2
                  WHERE b2.table_id = mt2.id
                    AND b2.status NOT IN ('cancelled', 'no_show', 'checked_out')
                    AND b2.starts_at < ${cEnd}
                    AND b2.ends_at   > ${cStart}
               )
               OR EXISTS (
                 SELECT 1 FROM booking_holds bh2
                  WHERE bh2.table_id = mt2.id
                    AND bh2.expires_at > now()
                    AND bh2.starts_at  < ${cEnd}
                    AND bh2.ends_at    > ${cStart}
               )
             )
         )
       ORDER BY c.max_covers
       LIMIT 1
    `
    if (!freeCombo) return null  // This conflict has nowhere to go — give up

    // Claim all member tables of the destination combo so no subsequent
    // conflict in this loop can also target them.
    const comboMembers = await tx`
      SELECT table_id FROM table_combination_members WHERE combination_id = ${freeCombo.id}
    `
    for (const m of comboMembers) claimedTableIds.add(m.table_id)
    displacements.push({ bookingId: conflict.id, newTableId: freeCombo.first_table_id, newComboId: freeCombo.id })
  }

  // All conflicts can be displaced — apply
  for (const { bookingId, newTableId, newComboId } of displacements) {
    await tx`
      UPDATE bookings
         SET table_id       = ${newTableId},
             combination_id = ${newComboId ?? null},
             updated_at     = now()
       WHERE id = ${bookingId}
    `
  }

  return {
    tableId:      members[0].table_id,
    combinationId,
    displacedIds: displacements.map(d => d.bookingId),
  }
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

  // ── GET /openapi.json ───────────────────────────────────
  // Machine-readable API spec. Paste the URL into a ChatGPT Custom Action
  // or any OpenAPI-compatible AI tool. Server URL is derived from the
  // incoming Host header so it works on any tenant subdomain.
  app.get('/openapi.json', async (req) => {
    const host = req.headers.host || ('api.' + env.PUBLIC_ROOT_DOMAIN)
    const serverUrl = 'https://' + host + '/widget-api'
    return {
      openapi: '3.1.0',
      info: {
        title: 'Macaroonie Restaurant Booking API',
        version: '1.0.0',
        description:
          'Use this API to check restaurant availability and make table reservations on behalf of guests. ' +
          'Typical flow: (1) call /venues/lookup with the restaurant slug to get a venueId, ' +
          '(2) call /venues/{venueId}/schedule-summary to find open days, ' +
          '(3) call /venues/{venueId}/slots to get available times for the chosen date and party size, ' +
          '(4) confirm details with the guest, then (5) call /venues/{venueId}/book to complete the reservation.',
      },
      servers: [{ url: serverUrl, description: 'Booking API' }],
      paths: {
        '/venues/lookup': {
          get: {
            operationId: 'lookupVenue',
            summary: 'Find a venue by site slug',
            description:
              'Look up a restaurant by its site slug — the subdomain part of its macaroonie.com URL. ' +
              'For example, "hai" for hai.macaroonie.com. Returns venue IDs, names, and party size limits. ' +
              'Call this first to get the venueId required by all other endpoints.',
            parameters: [
              {
                name: 'slug', in: 'query', required: true,
                description: 'Site slug, e.g. "hai" from hai.macaroonie.com',
                schema: { type: 'string' },
              },
            ],
            responses: {
              200: {
                description: 'Venue list for this site',
                content: { 'application/json': { schema: {
                  type: 'object',
                  properties: {
                    slug:      { type: 'string' },
                    site_name: { type: 'string' },
                    venues: {
                      type: 'array',
                      items: { type: 'object', properties: {
                        id:         { type: 'string', description: 'venueId — use this in all other endpoints' },
                        name:       { type: 'string' },
                        timezone:   { type: 'string', description: 'IANA timezone, e.g. Europe/London' },
                        currency:   { type: 'string' },
                        min_covers: { type: 'integer', description: 'Minimum party size accepted' },
                        max_covers: { type: 'integer', description: 'Maximum party size accepted' },
                      }},
                    },
                  },
                }}},
              },
              404: { description: 'No venue found for this slug' },
            },
          },
        },
        '/venues/{venueId}/schedule-summary': {
          get: {
            operationId: 'getScheduleSummary',
            summary: 'Get open days of the week',
            description:
              'Returns which days of the week the venue is open and how many days ahead bookings are allowed. ' +
              'Use this to rule out closed days before loading individual slot lists.',
            parameters: [
              { name: 'venueId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            ],
            responses: {
              200: {
                description: 'Schedule summary',
                content: { 'application/json': { schema: {
                  type: 'object',
                  properties: {
                    openDaysOfWeek:    { type: 'array', items: { type: 'integer' }, description: '0=Sunday … 6=Saturday' },
                    bookingWindowDays: { type: 'integer', description: 'How many days ahead bookings can be made' },
                  },
                }}},
              },
            },
          },
        },
        '/venues/{venueId}/slots': {
          get: {
            operationId: 'getAvailableSlots',
            summary: 'List available time slots for a date and party size',
            description:
              'Returns bookable time slots for the given date and number of guests. ' +
              'Only returns slots where a real table is physically free — no ghost availability. ' +
              'Use the returned slot_time values as the "time" field in /book.',
            parameters: [
              { name: 'venueId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
              { name: 'date',   in: 'query', required: true,  description: 'YYYY-MM-DD in venue local time', schema: { type: 'string', example: '2026-06-01' } },
              { name: 'covers', in: 'query', required: true,  description: 'Number of guests',              schema: { type: 'integer', minimum: 1, maximum: 50 } },
            ],
            responses: {
              200: {
                description: 'Available slots',
                content: { 'application/json': { schema: {
                  type: 'array',
                  items: { type: 'object', properties: {
                    slot_time:       { type: 'string', description: 'HH:MM in venue local time — pass as "time" to /book' },
                    available:       { type: 'boolean' },
                    available_covers: { type: 'integer', nullable: true },
                  }},
                }}},
              },
            },
          },
        },
        '/venues/{venueId}/book': {
          post: {
            operationId: 'makeBooking',
            summary: 'Make a table reservation in one step',
            description:
              'Creates a confirmed booking and automatically assigns the best available table for the party size. ' +
              'Always confirm the booking details (date, time, covers, name) with the guest before calling this endpoint. ' +
              'Returns a short reference code and a manage URL the guest can use to modify or cancel.',
            parameters: [
              { name: 'venueId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            ],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: {
                type: 'object',
                required: ['date', 'time', 'covers', 'guest_name'],
                properties: {
                  date:        { type: 'string', description: 'YYYY-MM-DD', example: '2026-06-01' },
                  time:        { type: 'string', description: 'HH:MM in venue local time — use slot_time from /slots', example: '19:00' },
                  covers:      { type: 'integer', description: 'Number of guests', minimum: 1 },
                  guest_name:  { type: 'string', description: 'Full name of the lead guest' },
                  guest_email: { type: 'string', format: 'email', description: 'Email for confirmation (strongly recommended)', nullable: true },
                  guest_phone: { type: 'string', description: 'Phone number (optional)', nullable: true },
                  notes:       { type: 'string', description: 'Special requests, dietary needs, occasion (optional)', nullable: true },
                },
              }}},
            },
            responses: {
              201: {
                description: 'Booking confirmed',
                content: { 'application/json': { schema: {
                  type: 'object',
                  properties: {
                    booking_id: { type: 'string' },
                    reference:  { type: 'string', description: 'Short reference code, e.g. A1B2C3D4' },
                    status:     { type: 'string', enum: ['confirmed', 'unconfirmed'] },
                    venue:      { type: 'string' },
                    table:      { type: 'string' },
                    date:       { type: 'string' },
                    time:       { type: 'string' },
                    covers:     { type: 'integer' },
                    guest_name: { type: 'string' },
                    guest_email:{ type: 'string', nullable: true },
                    manage_url: { type: 'string', description: 'Guest uses this to view, modify or cancel' },
                    message:    { type: 'string', description: 'Human-readable confirmation to relay to the guest' },
                  },
                }}},
              },
              409: { description: 'No tables available for this time — ask the guest to choose a different slot' },
              422: { description: 'Validation error, booking cutoff passed, or deposit required' },
            },
          },
        },
      },
    }
  })

  // ── GET /venues/lookup?slug= ────────────────────────────
  // Cross-tenant lookup — uses sql directly (no withTenant) so it can
  // see all tenant sites. Same pattern as resolveTenant().
  app.get('/venues/lookup', async (req) => {
    const slug = String(req.query.slug || '').toLowerCase().trim()
    if (!slug) throw httpError(400, 'slug query parameter is required')

    const rows = await sql`
      SELECT v.id, v.name, v.timezone, v.currency,
             COALESCE(ts.site_name, t.slug) AS site_name,
             br.min_covers, br.max_covers
        FROM tenant_site ts
        JOIN tenants     t  ON t.id  = ts.tenant_id  AND t.is_active = true
        JOIN venues      v  ON v.tenant_id = t.id    AND v.is_active = true
        LEFT JOIN booking_rules br ON br.venue_id = v.id
       WHERE ts.subdomain_slug = ${slug}
       ORDER BY v.name
    `
    if (!rows.length) throw httpError(404, 'No venue found for slug "' + slug + '"')

    return {
      slug,
      site_name: rows[0].site_name,
      venues: rows.map(v => ({
        id:         v.id,
        name:       v.name,
        timezone:   v.timezone,
        currency:   v.currency,
        min_covers: v.min_covers ?? 1,
        max_covers: v.max_covers ?? 8,
      })),
    }
  })

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
  // Mirrors the logic in the admin slots.js endpoint exactly:
  //   • individual-table availability (4 conflict types)
  //   • combination availability (all member tables free, 4 conflict types)
  //   • buffer_after_mins respected in the conflict window
  //   • doors_close filtering using the 3-level priority chain
  // A slot is available only when a real table OR combination is free.
  app.get('/venues/:venueId/slots', async (req) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')

    const date   = String(req.query.date || '')
    const covers = Math.max(1, Math.min(50, Number(req.query.covers) || 2))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Invalid date — expected YYYY-MM-DD')

    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: venue.timezone || 'UTC',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    function toLocalHHMM(v) {
      if (!v) return null
      const d = v instanceof Date ? v : new Date(v)
      if (Number.isNaN(d.getTime())) return null
      return fmt.format(d)
    }

    return withTenant(venue.tenant_id, async tx => {
      const [rules] = await tx`
        SELECT slot_duration_mins, buffer_after_mins,
               allow_widget_bookings_after_doors_close
          FROM booking_rules WHERE venue_id = ${venue.id} LIMIT 1
      `
      const durationMins   = rules?.slot_duration_mins ?? 90
      const bufferMins     = rules?.buffer_after_mins  ?? 0
      const windowMins     = durationMins + bufferMins
      const allowPastDoors = rules?.allow_widget_bookings_after_doors_close ?? false

      // Single SQL query — correlated subqueries resolve table_id and
      // combination_id per slot, matching the admin /slots endpoint exactly.
      const rawSlots = await tx`
        SELECT
          s.slot_time,
          s.available,
          s.available_covers,
          s.reason,
          s.sitting_closes_at,
          s.sitting_doors_close,
          (
            SELECT t.id
              FROM tables t
             WHERE t.venue_id       = ${venue.id}
               AND t.is_active      = true
               AND t.is_unallocated = false
               AND t.max_covers    >= ${covers}
               AND t.min_covers    <= ${covers}
               AND NOT EXISTS (
                 SELECT 1 FROM bookings b
                  WHERE b.table_id = t.id
                    AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                    AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND b.ends_at   > s.slot_time
               )
               AND NOT EXISTS (
                 SELECT 1 FROM booking_holds h
                  WHERE h.table_id = t.id
                    AND h.expires_at > now()
                    AND h.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND h.ends_at   > s.slot_time
               )
               AND NOT EXISTS (
                 SELECT 1 FROM bookings bc
                  JOIN table_combination_members m ON m.combination_id = bc.combination_id
                 WHERE m.table_id = t.id
                   AND bc.combination_id IS NOT NULL
                   AND bc.status NOT IN ('cancelled', 'no_show', 'checked_out')
                   AND bc.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                   AND bc.ends_at   > s.slot_time
               )
               AND NOT EXISTS (
                 SELECT 1 FROM booking_holds hc
                  JOIN table_combination_members m ON m.combination_id = hc.combination_id
                 WHERE m.table_id = t.id
                   AND hc.combination_id IS NOT NULL
                   AND hc.expires_at > now()
                   AND hc.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                   AND hc.ends_at   > s.slot_time
               )
             ORDER BY t.sort_order, t.label
             LIMIT 1
          ) AS table_id,
          (
            SELECT c.id
              FROM table_combinations c
             WHERE c.venue_id   = ${venue.id}
               AND c.is_active  = true
               AND c.max_covers >= ${covers}
               AND c.min_covers <= ${covers}
               AND NOT EXISTS (
                 SELECT 1 FROM table_combination_members m
                  JOIN tables mt ON mt.id = m.table_id
                 WHERE m.combination_id = c.id
                   AND (
                     NOT mt.is_active
                     OR EXISTS (
                       SELECT 1 FROM bookings b
                        WHERE b.table_id = mt.id
                          AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                          AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                          AND b.ends_at   > s.slot_time
                     )
                     OR EXISTS (
                       SELECT 1 FROM booking_holds h
                        WHERE h.table_id = mt.id
                          AND h.expires_at > now()
                          AND h.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                          AND h.ends_at   > s.slot_time
                     )
                     OR EXISTS (
                       SELECT 1 FROM bookings bc
                        JOIN table_combination_members m2 ON m2.combination_id = bc.combination_id
                       WHERE m2.table_id = mt.id
                         AND bc.combination_id IS NOT NULL
                         AND bc.status NOT IN ('cancelled', 'no_show', 'checked_out')
                         AND bc.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                         AND bc.ends_at   > s.slot_time
                     )
                     OR EXISTS (
                       SELECT 1 FROM booking_holds hc
                        JOIN table_combination_members m2 ON m2.combination_id = hc.combination_id
                       WHERE m2.table_id = mt.id
                         AND hc.combination_id IS NOT NULL
                         AND hc.expires_at > now()
                         AND hc.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                         AND hc.ends_at   > s.slot_time
                     )
                   )
               )
             ORDER BY c.max_covers
             LIMIT 1
          ) AS combination_id,
          -- Displacement candidate: a combination where every conflict can be moved
          -- to either a free individual table OR a free existing combination.
          -- Only combinations with no locked/arrived/seated conflicts qualify.
          (
            SELECT c.id
              FROM table_combinations c
             WHERE c.venue_id   = ${venue.id}
               AND c.is_active  = true
               AND c.max_covers >= ${covers}
               AND c.min_covers <= ${covers}
               AND EXISTS (
                 SELECT 1 FROM table_combination_members m
                  JOIN bookings b ON b.table_id = m.table_id
                 WHERE m.combination_id = c.id
                   AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                   AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                   AND b.ends_at   > s.slot_time
               )
               AND NOT EXISTS (
                 SELECT 1 FROM table_combination_members m
                  JOIN bookings b ON b.table_id = m.table_id
                 WHERE m.combination_id = c.id
                   AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                   AND (b.table_locked = true OR b.status IN ('arrived', 'seated'))
                   AND b.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                   AND b.ends_at   > s.slot_time
               )
               -- Every displaceable conflict must have EITHER a free individual table
               -- OR a free existing combination it can move into.
               AND NOT EXISTS (
                 SELECT 1
                   FROM table_combination_members mc
                   JOIN bookings bc ON bc.table_id = mc.table_id
                  WHERE mc.combination_id = c.id
                    AND bc.status NOT IN ('cancelled', 'no_show', 'checked_out', 'arrived', 'seated')
                    AND bc.table_locked = false
                    AND bc.starts_at < s.slot_time + (${windowMins} || ' minutes')::interval
                    AND bc.ends_at   > s.slot_time
                    AND NOT EXISTS (
                      -- Free individual table for this conflict
                      SELECT 1 FROM tables t
                       WHERE t.venue_id       = ${venue.id}
                         AND t.is_active      = true
                         AND t.is_unallocated = false
                         AND t.min_covers    <= bc.covers
                         AND t.max_covers    >= bc.covers
                         AND NOT EXISTS (
                           SELECT 1 FROM table_combination_members mcx
                            WHERE mcx.combination_id = c.id AND mcx.table_id = t.id
                         )
                         AND NOT EXISTS (
                           SELECT 1 FROM bookings b2
                            WHERE b2.table_id = t.id
                              AND b2.status NOT IN ('cancelled', 'no_show', 'checked_out')
                              AND b2.starts_at < bc.ends_at
                              AND b2.ends_at   > bc.starts_at
                         )
                         AND NOT EXISTS (
                           SELECT 1 FROM booking_holds bh2
                            WHERE bh2.table_id = t.id
                              AND bh2.expires_at > now()
                              AND bh2.starts_at  < bc.ends_at
                              AND bh2.ends_at    > bc.starts_at
                         )
                    )
                    AND NOT EXISTS (
                      -- Free existing combination for this conflict
                      SELECT 1 FROM table_combinations c2
                       WHERE c2.venue_id   = ${venue.id}
                         AND c2.is_active  = true
                         AND c2.min_covers <= bc.covers
                         AND c2.max_covers >= bc.covers
                         AND NOT EXISTS (
                           SELECT 1 FROM table_combination_members mcx2
                            WHERE mcx2.combination_id = c2.id
                              AND mcx2.table_id IN (
                                SELECT table_id FROM table_combination_members
                                 WHERE combination_id = c.id
                              )
                         )
                         AND NOT EXISTS (
                           SELECT 1 FROM table_combination_members mc3
                            JOIN tables mt3 ON mt3.id = mc3.table_id
                           WHERE mc3.combination_id = c2.id
                             AND (
                               NOT mt3.is_active
                               OR EXISTS (
                                 SELECT 1 FROM bookings b3
                                  WHERE b3.table_id = mt3.id
                                    AND b3.status NOT IN ('cancelled', 'no_show', 'checked_out')
                                    AND b3.starts_at < bc.ends_at
                                    AND b3.ends_at   > bc.starts_at
                               )
                               OR EXISTS (
                                 SELECT 1 FROM booking_holds bh3
                                  WHERE bh3.table_id = mt3.id
                                    AND bh3.expires_at > now()
                                    AND bh3.starts_at  < bc.ends_at
                                    AND bh3.ends_at    > bc.starts_at
                               )
                             )
                         )
                    )
               )
             ORDER BY c.max_covers
             LIMIT 1
          ) AS displace_combination_id
        FROM get_available_slots(${venue.id}::uuid, ${date}::date, ${covers}::int) s
        ORDER BY s.slot_time
      `

      // Available = sitting cap allows it AND a free table, free combo, OR
      // a combination whose conflicts can be displaced to free individual tables.
      let available = rawSlots
        .filter(s => s.reason === 'available' && (s.table_id || s.combination_id || s.displace_combination_id))
        .map(s => ({
          slot_time:        toLocalHHMM(s.slot_time),
          available:        true,
          available_covers: s.available_covers,
          table_id:         s.table_id ?? null,
          // Prefer free combo; fall back to displace candidate (both handled
          // the same way at hold time — hold creation detects conflicts and displaces).
          combination_id:   s.table_id ? null : (s.combination_id ?? s.displace_combination_id ?? null),
        }))

      // Doors-close filtering — same 3-level priority chain as the admin endpoint.
      if (!allowPastDoors) {
        const dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay()
        let sittings = []

        const [exception] = await tx`
          SELECT id, is_closed FROM schedule_exceptions
           WHERE venue_id = ${venue.id}
             AND ${date}::date BETWEEN date_from AND date_to
           ORDER BY priority DESC, (date_to - date_from) ASC
           LIMIT 1
        `
        if (exception && !exception.is_closed) {
          const [excTemplate] = await tx`
            SELECT id FROM exception_day_templates
             WHERE exception_id = ${exception.id}
               AND day_of_week  = ${dayOfWeek}
               AND is_open      = true
          `
          if (excTemplate) {
            sittings = await tx`
              SELECT opens_at, closes_at, doors_close_time
                FROM exception_sittings WHERE template_id = ${excTemplate.id}
            `
          }
        }

        if (sittings.length === 0) {
          const [override] = await tx`
            SELECT id FROM schedule_date_overrides
             WHERE venue_id      = ${venue.id}
               AND override_date = ${date}::date
               AND is_open       = true
             LIMIT 1
          `
          if (override) {
            sittings = await tx`
              SELECT opens_at, closes_at, doors_close_time
                FROM override_sittings WHERE override_id = ${override.id}
            `
          }
        }

        if (sittings.length === 0) {
          sittings = await tx`
            SELECT s.opens_at, s.closes_at, s.doors_close_time
              FROM venue_sittings s
              JOIN venue_schedule_templates t ON t.id = s.template_id
             WHERE t.venue_id    = ${venue.id}
               AND t.day_of_week = ${dayOfWeek}
          `
        }

        if (sittings.some(s => s.doors_close_time)) {
          available = available.filter(slot => {
            const sitting = sittings.find(s => {
              const op = String(s.opens_at).slice(0, 5)
              const cl = String(s.closes_at).slice(0, 5)
              return slot.slot_time >= op && slot.slot_time < cl
            })
            if (!sitting?.doors_close_time) return true
            return slot.slot_time < String(sitting.doors_close_time).slice(0, 5)
          })
        }
      }

      return available
    })
  })

  // ── POST /venues/:venueId/book ─────────────────────────
  // One-shot booking for AI agents. Skips the hold → confirm two-step
  // flow. Atomically assigns a table and creates the booking in a
  // single transaction. Always confirm details with the guest before
  // calling this endpoint.
  app.post('/venues/:venueId/book', async (req, reply) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')
    const body = BookBody.parse(req.body)

    const { booking: bk, tableLabel } = await withTenant(venue.tenant_id, async tx => {
      const [rules] = await tx`
        SELECT slot_duration_mins, buffer_after_mins, min_covers, max_covers,
               cutoff_before_mins, enable_unconfirmed_flow
          FROM booking_rules
         WHERE venue_id = ${venue.id}
      `
      if (!rules) throw httpError(404, 'Venue booking rules not configured')
      if (body.covers < rules.min_covers || body.covers > rules.max_covers) {
        throw httpError(422, 'Covers must be between ' + rules.min_covers + ' and ' + rules.max_covers)
      }

      const [deposit] = await tx`SELECT requires_deposit FROM deposit_rules WHERE venue_id = ${venue.id}`
      if (deposit?.requires_deposit) {
        throw httpError(422, 'This venue requires a deposit — online payment not available through this channel')
      }

      // Convert venue-local date+time to a UTC timestamp via PostgreSQL so
      // the server's local timezone is irrelevant.
      const localStr = body.date + ' ' + body.time + ':00'
      const [{ ts: startsAt }] = await tx`
        SELECT (${localStr}::timestamp AT TIME ZONE ${venue.timezone}) AS ts
      `
      const endsAt    = new Date(startsAt.getTime() + rules.slot_duration_mins * 60_000)
      const windowEnd = new Date(startsAt.getTime() + (rules.slot_duration_mins + (rules.buffer_after_mins ?? 0)) * 60_000)

      const cutoffMs = rules.cutoff_before_mins * 60_000
      if (Date.now() > startsAt.getTime() - cutoffMs) {
        throw httpError(422, 'Booking cutoff has passed for this slot')
      }

      // Auto-allocate: try individual table first, then combination.
      let allocTableId      = null
      let allocCombinationId = null
      let allocLabel        = null

      const [autoTable] = await tx`
        SELECT t.id, t.label
          FROM tables t
         WHERE t.venue_id       = ${venue.id}
           AND t.is_active      = true
           AND t.is_unallocated = false
           AND t.min_covers    <= ${body.covers}
           AND t.max_covers    >= ${body.covers}
           AND NOT EXISTS (
             SELECT 1 FROM bookings b
              WHERE b.table_id = t.id
                AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                AND b.starts_at < ${windowEnd.toISOString()}
                AND b.ends_at   > ${startsAt.toISOString()}
           )
           AND NOT EXISTS (
             SELECT 1 FROM booking_holds bh
              WHERE bh.table_id = t.id
                AND bh.expires_at > now()
                AND bh.starts_at  < ${windowEnd.toISOString()}
                AND bh.ends_at    > ${startsAt.toISOString()}
           )
           AND NOT EXISTS (
             SELECT 1 FROM bookings bc
              JOIN table_combination_members m ON m.combination_id = bc.combination_id
             WHERE m.table_id = t.id
               AND bc.combination_id IS NOT NULL
               AND bc.status NOT IN ('cancelled', 'no_show', 'checked_out')
               AND bc.starts_at < ${windowEnd.toISOString()}
               AND bc.ends_at   > ${startsAt.toISOString()}
           )
           AND NOT EXISTS (
             SELECT 1 FROM booking_holds hc
              JOIN table_combination_members m ON m.combination_id = hc.combination_id
             WHERE m.table_id = t.id
               AND hc.combination_id IS NOT NULL
               AND hc.expires_at > now()
               AND hc.starts_at  < ${windowEnd.toISOString()}
               AND hc.ends_at    > ${startsAt.toISOString()}
           )
         ORDER BY t.sort_order, t.max_covers
         LIMIT 1
      `
      if (autoTable) {
        allocTableId = autoTable.id
        allocLabel   = autoTable.label
      } else {
        const [autoCombo] = await tx`
          SELECT c.id, c.name,
                 (SELECT m.table_id FROM table_combination_members m
                    JOIN tables t ON t.id = m.table_id
                   WHERE m.combination_id = c.id
                   ORDER BY t.sort_order, t.label LIMIT 1) AS first_table_id
            FROM table_combinations c
           WHERE c.venue_id   = ${venue.id}
             AND c.is_active  = true
             AND c.min_covers <= ${body.covers}
             AND c.max_covers >= ${body.covers}
             AND NOT EXISTS (
               SELECT 1 FROM table_combination_members m
                JOIN tables mt ON mt.id = m.table_id
               WHERE m.combination_id = c.id
                 AND (
                   NOT mt.is_active
                   OR EXISTS (
                     SELECT 1 FROM bookings b
                      WHERE b.table_id = mt.id
                        AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                        AND b.starts_at < ${windowEnd.toISOString()}
                        AND b.ends_at   > ${startsAt.toISOString()}
                   )
                   OR EXISTS (
                     SELECT 1 FROM booking_holds bh
                      WHERE bh.table_id = mt.id
                        AND bh.expires_at > now()
                        AND bh.starts_at  < ${windowEnd.toISOString()}
                        AND bh.ends_at    > ${startsAt.toISOString()}
                   )
                   OR EXISTS (
                     SELECT 1 FROM bookings bc
                      JOIN table_combination_members m2 ON m2.combination_id = bc.combination_id
                     WHERE m2.table_id = mt.id
                       AND bc.combination_id IS NOT NULL
                       AND bc.status NOT IN ('cancelled', 'no_show', 'checked_out')
                       AND bc.starts_at < ${windowEnd.toISOString()}
                       AND bc.ends_at   > ${startsAt.toISOString()}
                   )
                   OR EXISTS (
                     SELECT 1 FROM booking_holds hc
                      JOIN table_combination_members m2 ON m2.combination_id = hc.combination_id
                     WHERE m2.table_id = mt.id
                       AND hc.combination_id IS NOT NULL
                       AND hc.expires_at > now()
                       AND hc.starts_at  < ${windowEnd.toISOString()}
                       AND hc.ends_at    > ${startsAt.toISOString()}
                   )
                 )
             )
           ORDER BY c.max_covers
           LIMIT 1
        `
        if (autoCombo) {
          allocTableId       = autoCombo.first_table_id
          allocCombinationId = autoCombo.id
          allocLabel         = autoCombo.name
        } else {
          // Displacement fallback
          const disp = await tryWidgetDisplace(tx, venue.id, body.covers, startsAt, windowEnd)
          if (!disp) {
            throw httpError(409, 'No tables available for this time — please suggest an alternative slot to the guest')
          }
          // Fetch the combination name for the response label
          const [comboRow] = await tx`SELECT name FROM table_combinations WHERE id = ${disp.combinationId}`
          allocTableId       = disp.tableId
          allocCombinationId = disp.combinationId
          allocLabel         = comboRow?.name ?? 'Combined table'
          // Broadcast displaced bookings (fire-and-forget)
          ;(async () => {
            const rows = await tx`SELECT * FROM bookings WHERE id = ANY(${disp.displacedIds}::uuid[])`
            for (const row of rows) broadcastBooking('booking.updated', row)
          })().catch(() => {})
        }
      }

      const initialStatus = rules.enable_unconfirmed_flow ? 'unconfirmed' : 'confirmed'

      const [booking] = await tx`
        INSERT INTO bookings
          (venue_id, table_id, combination_id, tenant_id, starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, guest_notes, status)
        VALUES
          (${venue.id}, ${allocTableId}, ${allocCombinationId}, ${venue.tenant_id},
           ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${body.covers},
           ${body.guest_name}, ${body.guest_email ?? null}, ${body.guest_phone ?? null},
           ${body.notes ?? null}, ${initialStatus}::booking_status)
        RETURNING *
      `
      return { booking, tableLabel: allocLabel }
    })

    const reference = bk.id.slice(0, 8).toUpperCase()
    const manageUrl = 'https://' + (req.headers.host || env.PUBLIC_ROOT_DOMAIN) +
                      '/manage/' + bk.manage_token

    // Customer upsert + confirmation email (fire-and-forget)
    withTenant(venue.tenant_id, async tx => {
      const customerId = await upsertCustomer(tx, venue.tenant_id, {
        name:  bk.guest_name,
        email: bk.guest_email,
        phone: bk.guest_phone,
      })
      if (customerId) {
        await tx`UPDATE bookings SET customer_id = ${customerId} WHERE id = ${bk.id}`
      }
    }).catch(() => {})

    notificationQueue.add('booking_email', {
      bookingId: bk.id, tenantId: venue.tenant_id,
      venueId:   bk.venue_id, type: 'confirmation',
    }).catch(() => {})

    broadcastBooking('booking.created', bk)

    const dateLabel = new Intl.DateTimeFormat('en-GB', {
      timeZone: venue.timezone, dateStyle: 'full', timeStyle: 'short',
    }).format(new Date(bk.starts_at))

    return reply.code(201).send({
      booking_id:  bk.id,
      reference,
      status:      bk.status,
      venue:       venue.name,
      table:       tableLabel,
      date:        body.date,
      time:        body.time,
      covers:      bk.covers,
      guest_name:  bk.guest_name,
      guest_email: bk.guest_email,
      manage_url:  manageUrl,
      message:     'Booking confirmed! ' + bk.guest_name + ', your table is reserved for ' +
                   body.covers + ' at ' + venue.name + ' on ' + dateLabel +
                   '. Reference: ' + reference +
                   '. The guest can view or modify at: ' + manageUrl,
    })
  })

  // ── POST /venues/:venueId/holds ─────────────────────────
  app.post('/venues/:venueId/holds', async (req, reply) => {
    const venue = await resolveTenant(req.params.venueId)
    if (!venue) throw httpError(404, 'Venue not found')
    const body = HoldBody.parse(req.body)

    const holdResult = await withTenant(venue.tenant_id, async tx => {
      const [rules] = await tx`
        SELECT slot_duration_mins, buffer_after_mins, hold_ttl_secs,
               min_covers, max_covers, cutoff_before_mins
          FROM booking_rules
         WHERE venue_id = ${venue.id}
      `
      if (!rules) throw httpError(404, 'Venue booking rules not configured')
      if (body.covers < rules.min_covers || body.covers > rules.max_covers) {
        throw httpError(422, `Covers must be between ${rules.min_covers} and ${rules.max_covers}`)
      }

      const startsAt   = new Date(body.starts_at)
      const endsAt     = new Date(startsAt.getTime() + rules.slot_duration_mins * 60_000)
      const windowEnd  = new Date(startsAt.getTime() + (rules.slot_duration_mins + (rules.buffer_after_mins ?? 0)) * 60_000)
      const expiresAt  = new Date(Date.now() + rules.hold_ttl_secs * 1_000)

      const cutoffMs = rules.cutoff_before_mins * 60_000
      if (Date.now() > startsAt.getTime() - cutoffMs) {
        throw httpError(422, 'Booking cutoff has passed for this slot')
      }

      let tableId          = body.table_id ?? null
      let combinationId    = body.combination_id ?? null
      let displacedHoldIds = []

      if (tableId) {
        // Explicit table_id from a free slot — use as-is.

      } else if (combinationId) {
        // Combination from slot selection. Could be genuinely free or a
        // displacement candidate; detect by checking for active conflicts.
        const conflicts = await tx`
          SELECT b.id FROM bookings b
           JOIN table_combination_members m ON m.table_id = b.table_id
          WHERE m.combination_id = ${combinationId}
            AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
            AND b.starts_at < ${windowEnd.toISOString()}
            AND b.ends_at   > ${startsAt.toISOString()}
          LIMIT 1
        `
        if (!conflicts.length) {
          // Free — resolve first member table
          const [firstMember] = await tx`
            SELECT m.table_id FROM table_combination_members m
              JOIN tables t ON t.id = m.table_id
             WHERE m.combination_id = ${combinationId}
             ORDER BY t.sort_order, t.label LIMIT 1
          `
          if (!firstMember) throw httpError(404, 'Combination not found or has no tables')
          tableId = firstMember.table_id
        } else {
          // Conflicts exist — try displacement
          const disp = await tryDisplaceCombo(tx, venue.id, combinationId, startsAt, windowEnd)
          if (!disp) throw httpError(409, 'No tables available for this time — please choose another slot')
          tableId          = disp.tableId
          displacedHoldIds = disp.displacedIds
        }

      } else {
        // Auto-allocate: free individual table → free combination → displace combination.
        const [autoTable] = await tx`
          SELECT t.id
            FROM tables t
           WHERE t.venue_id       = ${venue.id}
             AND t.is_active      = true
             AND t.is_unallocated = false
             AND t.min_covers    <= ${body.covers}
             AND t.max_covers    >= ${body.covers}
             AND NOT EXISTS (
               SELECT 1 FROM bookings b
                WHERE b.table_id = t.id
                  AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
                  AND b.starts_at < ${windowEnd.toISOString()}
                  AND b.ends_at   > ${startsAt.toISOString()}
             )
             AND NOT EXISTS (
               SELECT 1 FROM booking_holds bh
                WHERE bh.table_id = t.id
                  AND bh.expires_at > now()
                  AND bh.starts_at  < ${windowEnd.toISOString()}
                  AND bh.ends_at    > ${startsAt.toISOString()}
             )
             AND NOT EXISTS (
               SELECT 1 FROM bookings bc
                JOIN table_combination_members m ON m.combination_id = bc.combination_id
               WHERE m.table_id = t.id
                 AND bc.combination_id IS NOT NULL
                 AND bc.status NOT IN ('cancelled', 'no_show', 'checked_out')
                 AND bc.starts_at < ${windowEnd.toISOString()}
                 AND bc.ends_at   > ${startsAt.toISOString()}
             )
             AND NOT EXISTS (
               SELECT 1 FROM booking_holds hc
                JOIN table_combination_members m ON m.combination_id = hc.combination_id
               WHERE m.table_id = t.id
                 AND hc.combination_id IS NOT NULL
                 AND hc.expires_at > now()
                 AND hc.starts_at  < ${windowEnd.toISOString()}
                 AND hc.ends_at    > ${startsAt.toISOString()}
             )
           ORDER BY t.sort_order, t.max_covers
           LIMIT 1
        `
        if (autoTable) {
          tableId = autoTable.id
        } else {
          // Free combination
          const [autoCombo] = await tx`
            SELECT c.id,
                   (SELECT m.table_id FROM table_combination_members m
                      JOIN tables t ON t.id = m.table_id
                     WHERE m.combination_id = c.id
                     ORDER BY t.sort_order, t.label LIMIT 1) AS first_table_id
              FROM table_combinations c
             WHERE c.venue_id   = ${venue.id}
               AND c.is_active  = true
               AND c.min_covers <= ${body.covers}
               AND c.max_covers >= ${body.covers}
               AND NOT EXISTS (
                 SELECT 1 FROM table_combination_members m
                  JOIN tables mt ON mt.id = m.table_id
                 WHERE m.combination_id = c.id
                   AND (
                     NOT mt.is_active
                     OR EXISTS (SELECT 1 FROM bookings b WHERE b.table_id = mt.id AND b.status NOT IN ('cancelled', 'no_show', 'checked_out') AND b.starts_at < ${windowEnd.toISOString()} AND b.ends_at > ${startsAt.toISOString()})
                     OR EXISTS (SELECT 1 FROM booking_holds bh WHERE bh.table_id = mt.id AND bh.expires_at > now() AND bh.starts_at < ${windowEnd.toISOString()} AND bh.ends_at > ${startsAt.toISOString()})
                     OR EXISTS (SELECT 1 FROM bookings bc JOIN table_combination_members m2 ON m2.combination_id = bc.combination_id WHERE m2.table_id = mt.id AND bc.combination_id IS NOT NULL AND bc.status NOT IN ('cancelled', 'no_show', 'checked_out') AND bc.starts_at < ${windowEnd.toISOString()} AND bc.ends_at > ${startsAt.toISOString()})
                     OR EXISTS (SELECT 1 FROM booking_holds hc JOIN table_combination_members m2 ON m2.combination_id = hc.combination_id WHERE m2.table_id = mt.id AND hc.combination_id IS NOT NULL AND hc.expires_at > now() AND hc.starts_at < ${windowEnd.toISOString()} AND hc.ends_at > ${startsAt.toISOString()})
                   )
               )
             ORDER BY c.max_covers
             LIMIT 1
          `
          if (autoCombo) {
            tableId       = autoCombo.first_table_id
            combinationId = autoCombo.id
          } else {
            // Displacement fallback
            const disp = await tryWidgetDisplace(tx, venue.id, body.covers, startsAt, windowEnd)
            if (!disp) throw httpError(409, 'No tables available for this time — please choose another slot')
            tableId          = disp.tableId
            combinationId    = disp.combinationId
            displacedHoldIds = disp.displacedIds
          }
        }
      }

      const [newHold] = await tx`
        INSERT INTO booking_holds
          (venue_id, table_id, combination_id, tenant_id, starts_at, ends_at, covers,
           guest_name, guest_email, guest_phone, expires_at)
        VALUES
          (${venue.id}, ${tableId}, ${combinationId}, ${venue.tenant_id},
           ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${body.covers},
           ${body.guest_name}, ${body.guest_email ?? null}, ${body.guest_phone ?? null},
           ${expiresAt.toISOString()})
        RETURNING *
      `
      return { hold: newHold, displacedIds: displacedHoldIds }
    })

    const { hold, displacedIds } = holdResult

    // Broadcast displaced bookings so the Timeline updates immediately.
    if (displacedIds.length) {
      withTenant(venue.tenant_id, async tx => {
        const rows = await tx`SELECT * FROM bookings WHERE id = ANY(${displacedIds}::uuid[])`
        for (const row of rows) broadcastBooking('booking.updated', row)
      }).catch(() => {})
    }

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

      // Hold always has a table assigned (set at hold-creation time).
      // Guard against stale null-table holds from before this fix.
      if (!h.table_id) throw httpError(409, 'This hold has no table — please start a new booking')

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
