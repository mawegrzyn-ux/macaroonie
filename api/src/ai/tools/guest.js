// src/ai/tools/guest.js
//
// Booking tools for guests: the public MCP connector (any AI app, every
// restaurant on the platform that has AI booking switched on) and the chat
// on a restaurant's own website (that restaurant only). Availability,
// holds and confirmations go through the public /widget-api routes, so an
// AI booking follows exactly the rules of the booking widget. Changing or
// cancelling needs the emailed code (src/ai/codes.js), then goes through
// services/guestBookingSvc.js, same as the guest's own manage page.

import { z } from 'zod'
import { sql, withTenant } from '../../config/db.js'
import { ToolError, callApi, audit } from '../context.js'
import { requestCode, verifyCode, bookingIdForKey, GENERIC_CODE_REPLY, ACCESS_KEY_MINUTES } from '../codes.js'
import {
  loadBookingById, canModify, canCancel, cancelBlockReason, rescheduleBooking, cancelBooking,
} from '../../services/guestBookingSvc.js'
import { loadOpeningHours } from '../../services/siteDataSvc.js'
import { guestManageOrigin } from '../../jobs/emailWorker.js'
import {
  DateStr, TimeStr, PartySize, localParts, longDate, whenText, zonedInstant, reference,
  venueRules, checkBookableDate, nearestTimes, asTool,
} from './util.js'

const VenueId = z.string().uuid().describe('The restaurant\'s venue_id from find_restaurants')
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A venue a guest tool may use: active, and either this site's own
 *  (website chat) or on a tenant with AI booking switched on (MCP). */
async function guestVenue(ctx, venueId) {
  const [v] = await sql`
    SELECT v.id, v.tenant_id, v.name, v.slug, v.timezone,
           COALESCE(ts.brand_name, ts.site_name, t.name) AS brand,
           ts.subdomain_slug, ts.custom_domain, ts.custom_domain_verified, ts.is_published,
           COALESCE(s.guest_mcp_enabled, true) AS guest_mcp_enabled
      FROM venues v
      JOIN tenants t ON t.id = v.tenant_id AND t.is_active = true
      LEFT JOIN tenant_site ts ON ts.tenant_id = v.tenant_id
      LEFT JOIN ai_settings s  ON s.tenant_id  = v.tenant_id
     WHERE v.id = ${venueId} AND v.is_active = true
     LIMIT 1
  `
  const allowed = v && (ctx.channel === 'guest_chat' ? v.tenant_id === ctx.tenantId : v.guest_mcp_enabled)
  if (!allowed) throw new ToolError('Restaurant not found. Use find_restaurants to get a venue_id.', 404)
  ctx.touchedTenantId = v.tenant_id
  return v
}

function siteUrl(v) {
  if (!v.is_published) return null
  return guestManageOrigin(v) + '/locations/' + v.slug
}

/** Available HH:MM times for a date and party size (widget rules). */
async function availableTimes(ctx, venue, rules, date, partySize) {
  const slots = await callApi(ctx, 'GET',
    `/widget-api/venues/${venue.id}/slots?date=${date}&covers=${partySize}`)
  const now = localParts(new Date(Date.now() + rules.cutoff_before_mins * 60_000), venue.timezone)
  return (slots || [])
    .filter(s => s.available && s.slot_time)
    .filter(s => date > now.date || s.slot_time >= now.time)
    .map(s => s.slot_time)
}

function checkPartySize(venue, rules, partySize) {
  if (partySize < rules.min_covers || partySize > rules.max_covers) {
    throw new ToolError(venue.name + ' takes online bookings for ' + rules.min_covers + ' to ' + rules.max_covers +
      ' people. For a bigger group, the guest should call the restaurant.', 422)
  }
}

/** What a guest sees of their booking. */
async function guestBookingView(booking) {
  const local = localParts(booking.starts_at, booking.venue_timezone)
  const cancelReason = cancelBlockReason(booking)
  return {
    reference:   reference(booking.id),
    restaurant:  booking.venue_name,
    venue_id:    booking.t_venue_id,
    date:        local.date,
    time:        local.time,
    when:        whenText(booking.starts_at, booking.venue_timezone),
    party_size:  booking.covers,
    guest_name:  booking.guest_name,
    guest_email: booking.guest_email,
    status:      booking.status,
    notes:       booking.guest_notes || null,
    can_change:  canModify(booking),
    can_cancel:  canCancel(booking),
    ...(cancelReason ? { cancel_note: cancelReason } : {}),
  }
}

async function bookingForKey(ctx, accessKey) {
  const id = await bookingIdForKey(accessKey, { tenantId: ctx.channel === 'guest_chat' ? ctx.tenantId : null })
  const booking = await loadBookingById(id)
  if (!booking) throw new ToolError('Booking not found.', 404)
  ctx.touchedTenantId = booking.t_tenant_id
  return booking
}

/** A failed move, with the free times that day so the AI can offer them. */
async function withFreeTimes(ctx, err, booking, { date, time, party_size }) {
  if (!(err instanceof ToolError) || err.status >= 500) return err
  try {
    const venue = { id: booking.t_venue_id, tenant_id: booking.t_tenant_id, name: booking.venue_name, timezone: booking.venue_timezone }
    const rules = await venueRules(venue)
    const cur = localParts(booking.starts_at, venue.timezone)
    const times = await availableTimes(ctx, venue, rules, date || cur.date, party_size ?? booking.covers)
    const near = time ? nearestTimes(times, time) : times.slice(0, 8)
    return new ToolError(err.message + '. ' + (near.length ? 'Free times that day: ' + near.join(', ') + '.' : 'Nothing else is free that day.'), err.status)
  } catch {
    return err
  }
}

async function holdRow(venue, holdId) {
  const [h] = await withTenant(venue.tenant_id, tx => tx`
    SELECT id, starts_at, covers, guest_name, guest_email, guest_phone, expires_at
      FROM booking_holds
     WHERE id = ${holdId} AND venue_id = ${venue.id} AND tenant_id = ${venue.tenant_id}
  `)
  if (!h || new Date(h.expires_at).getTime() <= Date.now()) {
    throw new ToolError('That hold has expired or doesn\'t exist. Check availability and hold the table again.', 410)
  }
  return h
}

export const guestTools = [
  {
    name: 'find_restaurants',
    title: 'Find restaurants',
    description:
      'Search the restaurants that take bookings through this service, by name, area or postcode. ' +
      'Returns each restaurant\'s venue_id, which the other tools need.',
    input: z.object({
      query: z.string().max(100).optional().describe('Restaurant or brand name, town, or postcode (any part)'),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    readOnly: true,
    async run(ctx, { query, limit = 10 }) {
      const q = (query || '').trim()
      if (ctx.channel === 'guest_mcp' && q.length < 2) {
        throw new ToolError('Give at least part of a restaurant name, town or postcode.', 422)
      }
      const like = '%' + q.toLowerCase() + '%'
      const rows = await sql`
        SELECT v.id, v.name, v.slug, v.timezone, v.tenant_id,
               COALESCE(ts.brand_name, ts.site_name, t.name) AS brand,
               wc.address_line1, wc.city, wc.postcode, wc.phone,
               ts.subdomain_slug, ts.custom_domain, ts.custom_domain_verified, ts.is_published
          FROM venues v
          JOIN tenants t ON t.id = v.tenant_id AND t.is_active = true
          LEFT JOIN tenant_site ts    ON ts.tenant_id = v.tenant_id
          LEFT JOIN website_config wc ON wc.venue_id  = v.id
          LEFT JOIN ai_settings s     ON s.tenant_id  = v.tenant_id
         WHERE v.is_active = true
           AND EXISTS (SELECT 1 FROM booking_rules br WHERE br.venue_id = v.id)
           AND ${ctx.channel === 'guest_chat'
                 ? sql`v.tenant_id = ${ctx.tenantId}`
                 : sql`COALESCE(s.guest_mcp_enabled, true)`}
           AND (${q === ''} OR lower(v.name) LIKE ${like}
                OR lower(COALESCE(ts.brand_name, '')) LIKE ${like}
                OR lower(COALESCE(ts.site_name, ''))  LIKE ${like}
                OR lower(t.name) LIKE ${like}
                OR lower(COALESCE(wc.city, ''))       LIKE ${like}
                OR lower(replace(COALESCE(wc.postcode, ''), ' ', '')) LIKE ${'%' + q.toLowerCase().replace(/\s+/g, '') + '%'})
         ORDER BY v.name
         LIMIT ${limit}
      `
      return {
        restaurants: rows.map(v => ({
          venue_id: v.id,
          name:     v.name,
          brand:    v.brand,
          address:  [v.address_line1, v.city, v.postcode].filter(Boolean).join(', ') || null,
          phone:    v.phone || null,
          website:  siteUrl(v),
        })),
        ...(rows.length ? {} : { message: 'No restaurants matched. Try another name, town or postcode.' }),
      }
    },
  },

  {
    name: 'get_restaurant',
    title: 'Restaurant details',
    description:
      'Details for one restaurant: address, phone, opening hours, party sizes taken online, how far ahead ' +
      'it takes bookings, and today\'s date there (use it to work out dates like "tomorrow" or "Friday").',
    input: z.object({ venue_id: VenueId }),
    readOnly: true,
    async run(ctx, { venue_id }) {
      const venue = await guestVenue(ctx, venue_id)
      const rules = await venueRules(venue)
      const { cfg, hours } = await withTenant(venue.tenant_id, async tx => {
        const [cfg] = await tx`
          SELECT id, address_line1, address_line2, city, postcode, phone, email, opening_hours_source
            FROM website_config WHERE venue_id = ${venue.id} AND tenant_id = ${venue.tenant_id}
        `
        const hours = await loadOpeningHours(tx, venue.id, cfg)
        return { cfg, hours }
      })
      const today = localParts(new Date(), venue.timezone)
      const byDay = DAYS.map((name, i) => {
        const rows = (hours || []).filter(h => Number(h.day_of_week) === i && !h.is_closed && h.opens_at)
        return { day: name, hours: rows.length ? rows.map(h => h.opens_at + '-' + h.closes_at).join(', ') : 'closed' }
      })
      return {
        venue_id:      venue.id,
        name:          venue.name,
        brand:         venue.brand,
        address:       [cfg?.address_line1, cfg?.address_line2, cfg?.city, cfg?.postcode].filter(Boolean).join(', ') || null,
        phone:         cfg?.phone || null,
        email:         cfg?.email || null,
        website:       siteUrl(venue),
        timezone:      venue.timezone,
        today:         today.date + ' (' + today.weekday + ')',
        time_now:      today.time,
        opening_hours: byDay,
        party_size:    { min: rules.min_covers, max: rules.max_covers },
        books_up_to_days_ahead: rules.book_until_days,
        booking_length_minutes: rules.slot_duration_mins,
        online_booking: rules.requires_deposit
          ? 'This restaurant takes a deposit, which can\'t be paid here. The guest should book on the restaurant\'s website or by phone.'
          : (rules.configured ? 'available' : 'not set up'),
      }
    },
  },

  {
    name: 'check_availability',
    title: 'Check availability',
    description:
      'Times a table is free at a restaurant on a date for a party size. Give `time` to check one time; ' +
      'if it is taken, the nearest free times come back instead.',
    input: z.object({
      venue_id:   VenueId,
      date:       DateStr.describe('YYYY-MM-DD'),
      party_size: PartySize.describe('Number of people'),
      time:       TimeStr.optional().describe('HH:MM, 24-hour, restaurant local time'),
    }),
    readOnly: true,
    async run(ctx, { venue_id, date, party_size, time }) {
      const venue = await guestVenue(ctx, venue_id)
      const rules = await venueRules(venue)
      checkPartySize(venue, rules, party_size)
      checkBookableDate(date, venue, rules)
      const times = await availableTimes(ctx, venue, rules, date, party_size)
      const base = { restaurant: venue.name, date, day: longDate(date), party_size }
      if (!times.length) {
        return { ...base, available_times: [], message: 'No tables free that day for ' + party_size + '. Try another date.' }
      }
      if (time) {
        const ok = times.includes(time)
        return {
          ...base, time, available: ok,
          ...(ok ? {} : { nearest_free_times: nearestTimes(times, time) }),
        }
      }
      return { ...base, available_times: times }
    },
  },

  {
    name: 'hold_table',
    title: 'Hold a table',
    description:
      'Holds a free table for a few minutes while the guest checks the details. Needs the guest\'s name and email ' +
      '(the confirmation goes there). Then read the details back to the guest and, once they say yes, call ' +
      'confirm_booking with the hold_id before it expires. Call release_hold if they change their mind.',
    input: z.object({
      venue_id:    VenueId,
      date:        DateStr.describe('YYYY-MM-DD'),
      time:        TimeStr.describe('HH:MM, 24-hour, restaurant local time'),
      party_size:  PartySize,
      guest_name:  z.string().min(1).max(200),
      guest_email: z.string().email(),
      guest_phone: z.string().min(5).max(50).optional(),
    }),
    async run(ctx, input) {
      const venue = await guestVenue(ctx, input.venue_id)
      const rules = await venueRules(venue)
      if (rules.requires_deposit) {
        throw new ToolError(venue.name + ' takes a deposit, which can\'t be paid here. Book on their website or by phone.', 422)
      }
      checkPartySize(venue, rules, input.party_size)
      checkBookableDate(input.date, venue, rules)
      const times = await availableTimes(ctx, venue, rules, input.date, input.party_size)
      if (!times.includes(input.time)) {
        throw new ToolError(input.time + ' isn\'t free for ' + input.party_size + ' on ' + longDate(input.date) + '. ' +
          (times.length ? 'Nearest free times: ' + nearestTimes(times, input.time).join(', ') + '.' : 'Nothing is free that day.'), 409)
      }
      const startsAt = await zonedInstant(input.date, input.time, venue.timezone)
      const hold = await callApi(ctx, 'POST', `/widget-api/venues/${venue.id}/holds`, {
        body: {
          starts_at:   startsAt.toISOString(),
          covers:      input.party_size,
          guest_name:  input.guest_name,
          guest_email: input.guest_email,
          guest_phone: input.guest_phone ?? null,
        },
      })
      const minutes = Math.max(1, Math.round((new Date(hold.expires_at).getTime() - Date.now()) / 60_000))
      return {
        hold_id:     hold.id,
        venue_id:    venue.id,
        restaurant:  venue.name,
        date:        input.date,
        time:        input.time,
        when:        whenText(startsAt, venue.timezone),
        party_size:  input.party_size,
        guest_name:  input.guest_name,
        guest_email: input.guest_email,
        expires_in_minutes: minutes,
        next_step: 'Read these details back to the guest and ask them to confirm. When they say yes, call confirm_booking with this hold_id within ' + minutes + ' minutes.',
      }
    },
  },

  {
    name: 'confirm_booking',
    title: 'Confirm a booking',
    description:
      'Turns a held table into a booking. Only call this after the guest has said yes to the details. ' +
      'Add any notes the guest gave (allergies, occasion, high chair). Returns the booking reference.',
    input: z.object({
      venue_id: VenueId,
      hold_id:  z.string().uuid(),
      notes:    z.string().max(1000).optional().describe('Notes for the restaurant from the guest'),
    }),
    confirm: true,
    async describe(ctx, { venue_id, hold_id, notes }) {
      const venue = await guestVenue(ctx, venue_id)
      const h = await holdRow(venue, hold_id)
      return {
        title: 'Book this table?',
        lines: [
          venue.name,
          whenText(h.starts_at, venue.timezone),
          h.covers + (h.covers === 1 ? ' person' : ' people'),
          h.guest_name + (h.guest_email ? ' (' + h.guest_email + ')' : ''),
          ...(notes ? ['Notes: ' + notes] : []),
        ],
        confirmLabel: 'Confirm booking',
        expiresAt: h.expires_at,
      }
    },
    async run(ctx, { venue_id, hold_id, notes }) {
      const venue = await guestVenue(ctx, venue_id)
      await holdRow(venue, hold_id)
      let bk
      try {
        bk = await callApi(ctx, 'POST', `/widget-api/venues/${venue.id}/holds/${hold_id}/confirm`, {
          body: { guest_notes: notes ?? null },
        })
      } catch (err) {
        await audit(ctx, { tenantId: venue.tenant_id, tool: 'confirm_booking', input: { venue_id, hold_id }, ok: false, result: { error: err.message } })
        throw err
      }
      await withTenant(venue.tenant_id, tx => tx`
        UPDATE bookings SET source = ${ctx.channel} WHERE id = ${bk.id} AND tenant_id = ${venue.tenant_id}
      `)
      const result = {
        reference:   bk.reference,
        status:      bk.status,
        restaurant:  venue.name,
        when:        whenText(bk.starts_at, venue.timezone),
        party_size:  bk.covers,
        guest_name:  bk.guest_name,
        guest_email: bk.guest_email,
        message:
          'Booked. Reference ' + bk.reference + '. A confirmation email is on its way to ' + bk.guest_email + '. ' +
          (bk.status === 'unconfirmed' ? 'The restaurant may call to confirm. ' : '') +
          'To change or cancel later, the guest needs this reference and their email.',
      }
      await audit(ctx, { tenantId: venue.tenant_id, tool: 'confirm_booking', input: { venue_id, hold_id }, ok: true, result, bookingId: bk.id })
      return result
    },
  },

  {
    name: 'release_hold',
    title: 'Release a held table',
    description: 'Lets go of a held table when the guest doesn\'t want it after all.',
    input: z.object({ venue_id: VenueId, hold_id: z.string().uuid() }),
    async run(ctx, { venue_id, hold_id }) {
      const venue = await guestVenue(ctx, venue_id)
      await callApi(ctx, 'DELETE', `/widget-api/venues/${venue.id}/holds/${hold_id}`)
      return { released: true }
    },
  },

  {
    name: 'request_booking_code',
    title: 'Email a booking code',
    description:
      'First step to look at, change or cancel an existing booking: emails a 6-digit code to the guest. ' +
      'Needs the booking reference (8 characters, from the confirmation email) and the email the booking was made with.',
    input: z.object({
      reference: z.string().min(6).max(12).describe('Booking reference, e.g. 3F9A12BC'),
      email:     z.string().email(),
    }),
    async run(ctx, { reference: ref, email }) {
      const booking = await requestCode({
        reference: ref, email,
        tenantId: ctx.channel === 'guest_chat' ? ctx.tenantId : null,
        guestMcp: ctx.channel === 'guest_mcp',
        log: ctx.log,
      })
      if (booking) {
        ctx.touchedTenantId = booking.tenant_id
        await audit(ctx, { tenantId: booking.tenant_id, tool: 'request_booking_code', input: { reference: ref }, ok: true, bookingId: booking.id })
      }
      return { message: GENERIC_CODE_REPLY }
    },
  },

  {
    name: 'verify_booking_code',
    title: 'Check a booking code',
    description:
      'Checks the 6-digit code the guest received. Returns an access_key for that booking (valid ' + ACCESS_KEY_MINUTES +
      ' minutes) and the booking details. Pass the access_key to change_booking or cancel_booking.',
    input: z.object({
      reference: z.string().min(6).max(12),
      email:     z.string().email(),
      code:      z.string().min(6).max(10).describe('The 6-digit code from the email'),
    }),
    async run(ctx, { reference: ref, email, code }) {
      const { accessKey, bookingId, tenantId } = await verifyCode({
        reference: ref, email, code,
        tenantId: ctx.channel === 'guest_chat' ? ctx.tenantId : null,
        guestMcp: ctx.channel === 'guest_mcp',
      })
      ctx.touchedTenantId = tenantId
      const booking = await loadBookingById(bookingId)
      return { access_key: accessKey, valid_for_minutes: ACCESS_KEY_MINUTES, booking: await guestBookingView(booking) }
    },
  },

  {
    name: 'get_booking',
    title: 'Booking details',
    description: 'The details of a booking the guest has unlocked with verify_booking_code.',
    input: z.object({ access_key: z.string() }),
    readOnly: true,
    async run(ctx, { access_key }) {
      return guestBookingView(await bookingForKey(ctx, access_key))
    },
  },

  {
    name: 'change_booking',
    title: 'Change a booking',
    description:
      'Moves an unlocked booking to another date, time or party size (give only what changes; times are ' +
      'restaurant local). Check availability first. Only call this after the guest has agreed to the change.',
    input: z.object({
      access_key: z.string(),
      date:       DateStr.optional(),
      time:       TimeStr.optional(),
      party_size: PartySize.optional(),
    }),
    confirm: true,
    async describe(ctx, { access_key, date, time, party_size }) {
      const b = await bookingForKey(ctx, access_key)
      const cur = localParts(b.starts_at, b.venue_timezone)
      const newDate = date || cur.date
      const newTime = time || cur.time
      return {
        title: 'Change this booking?',
        lines: [
          b.venue_name + ', reference ' + reference(b.id),
          'Now: ' + whenText(b.starts_at, b.venue_timezone) + ', ' + b.covers + ' people',
          'New: ' + longDate(newDate) + ' at ' + newTime + ', ' + (party_size ?? b.covers) + ' people',
        ],
        confirmLabel: 'Change booking',
      }
    },
    async run(ctx, { access_key, date, time, party_size }) {
      const booking = await bookingForKey(ctx, access_key)
      if (!canModify(booking)) {
        throw new ToolError(booking.allow_guest_modify === false
          ? booking.venue_name + ' doesn\'t allow changing bookings online. The guest should call the restaurant.'
          : 'This booking is ' + booking.status.replace('_', ' ') + ' and can\'t be changed.', 422)
      }
      const input = { reference: reference(booking.id), date, time, party_size }
      try {
        await asTool(() => rescheduleBooking(booking, { date, time, covers: party_size }))
      } catch (err) {
        await audit(ctx, { tenantId: booking.t_tenant_id, tool: 'change_booking', input, ok: false, result: { error: err.message }, bookingId: booking.id })
        throw await withFreeTimes(ctx, err, booking, { date, time, party_size })
      }
      const view = await guestBookingView(await loadBookingById(booking.id))
      await audit(ctx, { tenantId: booking.t_tenant_id, tool: 'change_booking', input, ok: true, result: view, bookingId: booking.id })
      return { ...view, message: 'Changed. The guest will get an email with the new details.' }
    },
  },

  {
    name: 'cancel_booking',
    title: 'Cancel a booking',
    description: 'Cancels an unlocked booking. Only call this after the guest has clearly said to cancel.',
    input: z.object({ access_key: z.string() }),
    confirm: true,
    destructive: true,
    async describe(ctx, { access_key }) {
      const b = await bookingForKey(ctx, access_key)
      return {
        title: 'Cancel this booking?',
        lines: [b.venue_name + ', reference ' + reference(b.id), whenText(b.starts_at, b.venue_timezone) + ', ' + b.covers + ' people'],
        confirmLabel: 'Cancel booking',
        destructive: true,
      }
    },
    async run(ctx, { access_key }) {
      const booking = await bookingForKey(ctx, access_key)
      const reason = cancelBlockReason(booking)
      if (reason) throw new ToolError(reason, 422)
      await cancelBooking(booking)
      await audit(ctx, { tenantId: booking.t_tenant_id, tool: 'cancel_booking', input: { reference: reference(booking.id) }, ok: true, bookingId: booking.id })
      return { reference: reference(booking.id), status: 'cancelled', message: 'Cancelled. The guest will get an email to confirm.' }
    },
  },
]
