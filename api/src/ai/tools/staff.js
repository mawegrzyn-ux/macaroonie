// src/ai/tools/staff.js
//
// Booking tools for restaurant staff: the admin assistant panel and the
// staff MCP connector (/mcp/staff/:tenantSlug). Every tool works inside the
// caller's own tenant and checks the caller's Bookings permission (view to
// read, manage to change), the same permission the admin portal uses.
// Making a booking, changing its status, guest details and notes go through
// the admin booking routes in-process (callApi with the caller's own
// login), so the route's role checks and side effects are the admin's.
// Reads are direct SQL with an explicit tenant filter. Moving a booking to
// another date / time / party size uses services/guestBookingSvc.js (the
// same rules as the guest manage page, without the booking cutoff).

import { z } from 'zod'
import { sql, withTenant } from '../../config/db.js'
import { ToolError, callApi, audit, requireStaffPermission } from '../context.js'
import { loadBookingById, rescheduleBooking } from '../../services/guestBookingSvc.js'
import {
  DateStr, TimeStr, PartySize, localParts, longDate, whenText, reference, realEmail,
  venueRules, nearestTimes, asTool,
} from './util.js'

const STATUSES = ['unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated', 'checked_out', 'cancelled', 'no_show']
const STATUS_LABELS = {
  unconfirmed: 'Unconfirmed', confirmed: 'Confirmed', reconfirmed: 'Re-confirmed', arrived: 'Arrived',
  seated: 'Seated', checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
}
const BookingRef = z.string().min(6).max(40).describe('booking_id, or the 8-character reference')

async function staffVenue(ctx, venueId) {
  const [v] = await sql`
    SELECT id, tenant_id, name, timezone FROM venues
     WHERE id = ${venueId} AND tenant_id = ${ctx.tenantId} AND is_active = true
  `
  if (!v) throw new ToolError('Venue not found. Use list_venues.', 404)
  return v
}

/** Booking by id or 8-character reference, in this tenant only. */
async function staffBooking(ctx, idOrRef) {
  const key = String(idOrRef || '').trim().replace(/^#/, '')
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  const ref = key.toUpperCase()
  if (!isId && !/^[0-9A-F]{8}$/.test(ref)) throw new ToolError('Give a booking_id or an 8-character reference.', 422)
  const rows = await sql`
    SELECT b.id FROM bookings b
     WHERE b.tenant_id = ${ctx.tenantId}
       AND ${isId ? sql`b.id = ${key}::uuid` : sql`upper(left(b.id::text, 8)) = ${ref}`}
     LIMIT 2
  `
  if (!rows.length) throw new ToolError('Booking not found.', 404)
  if (rows.length > 1) throw new ToolError('More than one booking has that reference. Use find_bookings and the booking_id.', 409)
  const booking = await loadBookingById(rows[0].id)
  if (!booking || booking.t_tenant_id !== ctx.tenantId) throw new ToolError('Booking not found.', 404)
  return booking
}

/** What staff see of a booking. */
function staffView(b) {
  const tz = b.venue_timezone || b.timezone
  const start = localParts(b.starts_at, tz)
  const end = localParts(b.ends_at, tz)
  return {
    booking_id:  b.id,
    reference:   reference(b.id),
    venue:       b.venue_name,
    date:        start.date,
    time:        start.time,
    ends:        end.time,
    party_size:  b.covers,
    status:      b.status,
    guest_name:  b.guest_name,
    guest_email: realEmail(b.guest_email),
    guest_phone: b.guest_phone || null,
    table:       b.combination_name || (b.table_is_unallocated ? 'Unallocated' : (b.table_label || null)),
    guest_notes: b.guest_notes || null,
    staff_notes: b.operator_notes || null,
    ...(b.source ? { made_by: b.source.replace('_', ' ') } : {}),
  }
}

const bookingRows = (ctx, where, limit) => sql`
  SELECT b.*, v.name AS venue_name, v.timezone AS venue_timezone,
         t.label AS table_label, t.is_unallocated AS table_is_unallocated, tc.name AS combination_name
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id
    LEFT JOIN tables t ON t.id = b.table_id
    LEFT JOIN table_combinations tc ON tc.id = b.combination_id
   WHERE b.tenant_id = ${ctx.tenantId} AND ${where}
   ORDER BY b.starts_at
   LIMIT ${limit}
`

/** Bookable HH:MM times from the admin slots route (a free table or
 *  combination, not only sitting capacity), with the slot rows. */
async function bookableSlots(ctx, venue, date, partySize) {
  const res = await callApi(ctx, 'GET', `/api/venues/${venue.id}/slots?date=${date}&covers=${partySize}`)
  const slots = (res?.slots || [])
    .filter(s => s.available && (s.table_id || s.combination_id))
    .map(s => ({ ...s, local: localParts(s.slot_time, venue.timezone).time }))
  return slots
}

const ACTIVE = sql`b.status NOT IN ('cancelled', 'no_show')`

export const staffTools = [
  {
    name: 'list_venues',
    title: 'List venues',
    description: 'The restaurant\'s venues (locations) with their venue_id and today\'s date at each.',
    input: z.object({}),
    readOnly: true,
    async run(ctx) {
      await requireStaffPermission(ctx, 'bookings', 'view')
      const rows = await sql`
        SELECT id, name, timezone FROM venues
         WHERE tenant_id = ${ctx.tenantId} AND is_active = true ORDER BY name
      `
      return {
        venues: rows.map(v => {
          const now = localParts(new Date(), v.timezone)
          return { venue_id: v.id, name: v.name, today: now.date + ' (' + now.weekday + ')', time_now: now.time }
        }),
      }
    },
  },

  {
    name: 'find_bookings',
    title: 'Find bookings',
    description:
      'Search bookings by date, guest name, email, phone or reference. Without a date it looks from today on ' +
      '(set include_past to search older ones). Dates are the venue\'s local dates.',
    input: z.object({
      venue_id:     z.string().uuid().optional(),
      date:         DateStr.optional(),
      search:       z.string().max(100).optional().describe('Part of the guest\'s name, email or phone, or a reference'),
      status:       z.enum(STATUSES).optional(),
      include_past: z.boolean().optional(),
      limit:        z.number().int().min(1).max(50).optional(),
    }),
    readOnly: true,
    async run(ctx, { venue_id, date, search, status, include_past, limit = 20 }) {
      await requireStaffPermission(ctx, 'bookings', 'view')
      const q = (search || '').trim().toLowerCase()
      const like = '%' + q + '%'
      const conds = [sql`true`]
      if (venue_id) conds.push(sql`b.venue_id = ${venue_id}`)
      if (date) conds.push(sql`(b.starts_at AT TIME ZONE v.timezone)::date = ${date}::date`)
      else if (!include_past) conds.push(sql`b.starts_at >= date_trunc('day', now() AT TIME ZONE v.timezone) AT TIME ZONE v.timezone`)
      if (status) conds.push(sql`b.status = ${status}::booking_status`)
      if (q) {
        conds.push(sql`(lower(b.guest_name) LIKE ${like}
                    OR lower(COALESCE(b.guest_email, '')) LIKE ${like}
                    OR replace(COALESCE(b.guest_phone, ''), ' ', '') LIKE ${'%' + q.replace(/\s+/g, '') + '%'}
                    OR lower(left(b.id::text, 8)) = ${q.replace(/^#/, '')})`)
      }
      const where = conds.reduce((acc, c) => sql`${acc} AND ${c}`)
      const rows = await bookingRows(ctx, where, limit)
      return {
        count: rows.length,
        bookings: rows.map(staffView),
        ...(rows.length === limit ? { note: 'Showing the first ' + limit + '. Narrow the search for more.' } : {}),
      }
    },
  },

  {
    name: 'get_booking',
    title: 'Booking details',
    description: 'Full details of one booking.',
    input: z.object({ booking: BookingRef }),
    readOnly: true,
    async run(ctx, { booking }) {
      await requireStaffPermission(ctx, 'bookings', 'view')
      const b = await staffBooking(ctx, booking)
      const [row] = await bookingRows(ctx, sql`b.id = ${b.id}`, 1)
      return staffView(row)
    },
  },

  {
    name: 'day_overview',
    title: 'Day overview',
    description: 'A venue\'s day: bookings, covers, a count per status and per hour, and the list of bookings.',
    input: z.object({ venue_id: z.string().uuid(), date: DateStr }),
    readOnly: true,
    async run(ctx, { venue_id, date }) {
      await requireStaffPermission(ctx, 'bookings', 'view')
      const venue = await staffVenue(ctx, venue_id)
      const rows = await bookingRows(ctx,
        sql`b.venue_id = ${venue.id} AND (b.starts_at AT TIME ZONE v.timezone)::date = ${date}::date`, 300)
      const active = rows.filter(r => r.status !== 'cancelled' && r.status !== 'no_show')
      const byStatus = {}
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1
      const byHour = {}
      for (const r of active) {
        const h = localParts(r.starts_at, venue.timezone).time.slice(0, 2) + ':00'
        byHour[h] = byHour[h] || { bookings: 0, covers: 0 }
        byHour[h].bookings += 1
        byHour[h].covers += r.covers
      }
      return {
        venue: venue.name,
        date, day: longDate(date),
        bookings: active.length,
        covers: active.reduce((s, r) => s + r.covers, 0),
        by_status: byStatus,
        by_hour: byHour,
        list: rows.slice(0, 100).map(r => {
          const v = staffView(r)
          return { reference: v.reference, booking_id: v.booking_id, time: v.time, guest_name: v.guest_name, party_size: v.party_size, table: v.table, status: v.status }
        }),
      }
    },
  },

  {
    name: 'check_availability',
    title: 'Check availability',
    description: 'Times with a free table at a venue on a date for a party size (restaurant local times).',
    input: z.object({
      venue_id:   z.string().uuid(),
      date:       DateStr,
      party_size: PartySize,
      time:       TimeStr.optional(),
    }),
    readOnly: true,
    async run(ctx, { venue_id, date, party_size, time }) {
      await requireStaffPermission(ctx, 'bookings', 'view')
      const venue = await staffVenue(ctx, venue_id)
      const times = (await bookableSlots(ctx, venue, date, party_size)).map(s => s.local)
      const base = { venue: venue.name, date, day: longDate(date), party_size }
      if (time) {
        const ok = times.includes(time)
        return { ...base, time, available: ok, ...(ok ? {} : { nearest_free_times: nearestTimes(times, time) }) }
      }
      return { ...base, available_times: times, ...(times.length ? {} : { message: 'Nothing free for that party size.' }) }
    },
  },

  {
    name: 'create_booking',
    title: 'Make a booking',
    description:
      'Books a table at a free time (check_availability first). Email and phone are optional. ' +
      'Read the details back and only call this once the staff member has agreed them.',
    input: z.object({
      venue_id:    z.string().uuid(),
      date:        DateStr,
      time:        TimeStr,
      party_size:  PartySize,
      guest_name:  z.string().min(1).max(200),
      guest_email: z.string().email().optional(),
      guest_phone: z.string().max(30).optional(),
      notes:       z.string().max(1000).optional().describe('Notes from the guest (allergies, occasion)'),
      status:      z.enum(['unconfirmed', 'confirmed', 'reconfirmed']).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const venue = await staffVenue(ctx, input.venue_id)
      return {
        title: 'Make this booking?',
        lines: [
          venue.name,
          longDate(input.date) + ' at ' + input.time,
          input.party_size + (input.party_size === 1 ? ' person' : ' people'),
          input.guest_name + [input.guest_email, input.guest_phone].filter(Boolean).map(s => ', ' + s).join(''),
          ...(input.notes ? ['Notes: ' + input.notes] : []),
          ...(input.status ? ['Status: ' + STATUS_LABELS[input.status]] : []),
        ],
        confirmLabel: 'Make booking',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const venue = await staffVenue(ctx, input.venue_id)
      const rules = await venueRules(venue)
      if (rules.requires_deposit) {
        throw new ToolError(venue.name + ' takes a deposit, so bookings there need the payment flow. Use the booking widget.', 422)
      }
      const slots = await bookableSlots(ctx, venue, input.date, input.party_size)
      const slot = slots.find(s => s.local === input.time)
      if (!slot) {
        const times = slots.map(s => s.local)
        throw new ToolError(input.time + ' has no free table for ' + input.party_size + '. ' +
          (times.length ? 'Nearest free times: ' + nearestTimes(times, input.time).join(', ') + '. ' : '') +
          'To book outside the normal slots, use the timeline.', 409)
      }
      const audited = { ...input }
      try {
        const hold = await callApi(ctx, 'POST', '/api/bookings/holds', {
          body: {
            venue_id:  venue.id,
            ...(slot.table_id ? { table_id: slot.table_id } : { combination_id: slot.combination_id }),
            starts_at: new Date(slot.slot_time).toISOString(),
            covers:    input.party_size,
            guest_name:  input.guest_name,
            guest_email: input.guest_email || 'tbc@placeholder.com',
            guest_phone: input.guest_phone ?? null,
          },
        })
        const bk = await callApi(ctx, 'POST', '/api/bookings', {
          body: {
            hold_id: hold.id,
            guest_phone: input.guest_phone ?? null,
            guest_notes: input.notes ?? null,
            ...(input.status ? { status: input.status } : {}),
          },
        })
        await sql`UPDATE bookings SET source = ${ctx.channel} WHERE id = ${bk.id} AND tenant_id = ${ctx.tenantId}`
        const [row] = await bookingRows(ctx, sql`b.id = ${bk.id}`, 1)
        const view = staffView(row)
        await audit(ctx, { tool: 'create_booking', input: audited, ok: true, result: view, bookingId: bk.id })
        return { ...view, message: 'Booked. Reference ' + view.reference + '.' }
      } catch (err) {
        await audit(ctx, { tool: 'create_booking', input: audited, ok: false, result: { error: err.message } })
        throw err
      }
    },
  },

  {
    name: 'change_booking',
    title: 'Move a booking',
    description:
      'Moves a booking to another date, time or party size (give only what changes). It must fit a normal slot ' +
      'with a free table; keeps the table when it can. The guest is emailed the new details.',
    input: z.object({
      booking:    BookingRef,
      date:       DateStr.optional(),
      time:       TimeStr.optional(),
      party_size: PartySize.optional(),
    }),
    confirm: true,
    async describe(ctx, { booking, date, time, party_size }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      const cur = localParts(b.starts_at, b.venue_timezone)
      return {
        title: 'Move this booking?',
        lines: [
          b.guest_name + ', ' + b.venue_name + ' (' + reference(b.id) + ')',
          'Now: ' + whenText(b.starts_at, b.venue_timezone) + ', ' + b.covers + ' people',
          'New: ' + longDate(date || cur.date) + ' at ' + (time || cur.time) + ', ' + (party_size ?? b.covers) + ' people',
        ],
        confirmLabel: 'Move booking',
      }
    },
    async run(ctx, { booking, date, time, party_size }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      const input = { booking: reference(b.id), date, time, party_size }
      try {
        await asTool(() => rescheduleBooking(b, { date, time, covers: party_size }, { staff: true }))
      } catch (err) {
        await audit(ctx, { tool: 'change_booking', input, ok: false, result: { error: err.message }, bookingId: b.id })
        if (!(err instanceof ToolError)) throw err
        const venue = { id: b.t_venue_id, tenant_id: b.t_tenant_id, name: b.venue_name, timezone: b.venue_timezone }
        const cur = localParts(b.starts_at, venue.timezone)
        const times = (await bookableSlots(ctx, venue, date || cur.date, party_size ?? b.covers).catch(() => [])).map(s => s.local)
        const near = time ? nearestTimes(times, time) : times.slice(0, 8)
        throw new ToolError(err.message + '. ' + (near.length ? 'Free times that day: ' + near.join(', ') + '. ' : '') +
          'For anything outside the normal slots, use the timeline.', err.status)
      }
      const [row] = await bookingRows(ctx, sql`b.id = ${b.id}`, 1)
      const view = staffView(row)
      await audit(ctx, { tool: 'change_booking', input, ok: true, result: view, bookingId: b.id })
      return { ...view, message: 'Moved.' }
    },
  },

  {
    name: 'set_booking_status',
    title: 'Set booking status',
    description:
      'Sets a booking\'s status: unconfirmed, confirmed, reconfirmed, arrived, seated, checked_out, cancelled or no_show. ' +
      'Cancelling emails the guest.',
    input: z.object({ booking: BookingRef, status: z.enum(STATUSES) }),
    confirm: true,
    async describe(ctx, { booking, status }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      return {
        title: status === 'cancelled' ? 'Cancel this booking?' : 'Change the status?',
        lines: [
          b.guest_name + ', ' + whenText(b.starts_at, b.venue_timezone) + ', ' + b.covers + ' people (' + reference(b.id) + ')',
          STATUS_LABELS[b.status] + ' to ' + STATUS_LABELS[status],
        ],
        confirmLabel: status === 'cancelled' ? 'Cancel booking' : 'Set to ' + STATUS_LABELS[status],
        destructive: status === 'cancelled' || status === 'no_show',
      }
    },
    async run(ctx, { booking, status }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      try {
        await callApi(ctx, 'PATCH', `/api/bookings/${b.id}/status`, { body: { status } })
      } catch (err) {
        await audit(ctx, { tool: 'set_booking_status', input: { booking: reference(b.id), status }, ok: false, result: { error: err.message }, bookingId: b.id })
        throw err
      }
      await audit(ctx, { tool: 'set_booking_status', input: { booking: reference(b.id), status }, ok: true, bookingId: b.id })
      return { reference: reference(b.id), status, message: 'Status set to ' + STATUS_LABELS[status] + '.' }
    },
  },

  {
    name: 'update_guest_details',
    title: 'Update guest details',
    description: 'Changes the guest\'s name, email or phone on a booking (party size: use change_booking).',
    input: z.object({
      booking:     BookingRef,
      guest_name:  z.string().min(1).max(200).optional(),
      guest_email: z.string().email().optional(),
      guest_phone: z.string().max(30).optional(),
    }),
    confirm: true,
    async describe(ctx, { booking, ...fields }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      const lines = [b.guest_name + ', ' + whenText(b.starts_at, b.venue_timezone) + ' (' + reference(b.id) + ')']
      if (fields.guest_name)  lines.push('Name: ' + fields.guest_name)
      if (fields.guest_email) lines.push('Email: ' + fields.guest_email)
      if (fields.guest_phone) lines.push('Phone: ' + fields.guest_phone)
      return { title: 'Update the guest details?', lines, confirmLabel: 'Update' }
    },
    async run(ctx, { booking, ...fields }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
      if (!Object.keys(body).length) throw new ToolError('Nothing to change.', 422)
      await callApi(ctx, 'PATCH', `/api/bookings/${b.id}/guest`, { body })
      await audit(ctx, { tool: 'update_guest_details', input: { booking: reference(b.id), ...body }, ok: true, bookingId: b.id })
      const [row] = await bookingRows(ctx, sql`b.id = ${b.id}`, 1)
      return { ...staffView(row), message: 'Updated.' }
    },
  },

  {
    name: 'add_booking_note',
    title: 'Add a staff note',
    description: 'Adds a line to a booking\'s staff notes (kept with the earlier notes; guests never see them).',
    input: z.object({ booking: BookingRef, note: z.string().min(1).max(500) }),
    confirm: true,
    async describe(ctx, { booking, note }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      return {
        title: 'Add this note?',
        lines: [b.guest_name + ', ' + whenText(b.starts_at, b.venue_timezone) + ' (' + reference(b.id) + ')', note],
        confirmLabel: 'Add note',
      }
    },
    async run(ctx, { booking, note }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      const next = (b.operator_notes ? b.operator_notes + '\n' : '') + note
      if (next.length > 2000) throw new ToolError('The staff notes would be over 2000 characters. Edit them in the booking instead.', 422)
      await callApi(ctx, 'PATCH', `/api/bookings/${b.id}/notes`, { body: { operator_notes: next } })
      await audit(ctx, { tool: 'add_booking_note', input: { booking: reference(b.id), note }, ok: true, bookingId: b.id })
      return { reference: reference(b.id), staff_notes: next, message: 'Note added.' }
    },
  },

  {
    name: 'find_customer',
    title: 'Find a customer',
    description: 'Looks up guests in the customer list by name, email or phone, with their visit count and next booking.',
    input: z.object({ query: z.string().min(2).max(100) }),
    readOnly: true,
    async run(ctx, { query }) {
      await requireStaffPermission(ctx, 'customers', 'view')
      const q = query.trim().toLowerCase()
      const like = '%' + q + '%'
      const rows = await sql`
        SELECT c.id, c.name, c.email, c.phone, c.visit_count, c.notes,
               (SELECT min(b.starts_at) FROM bookings b
                 WHERE b.customer_id = c.id AND b.tenant_id = c.tenant_id
                   AND b.starts_at >= now() AND ${ACTIVE}) AS next_booking_at
          FROM customers c
         WHERE c.tenant_id = ${ctx.tenantId}
           AND c.is_anonymised = false
           AND (lower(c.name) LIKE ${like} OR lower(COALESCE(c.email, '')) LIKE ${like}
                OR replace(COALESCE(c.phone, ''), ' ', '') LIKE ${'%' + q.replace(/\s+/g, '') + '%'})
         ORDER BY c.name
         LIMIT 10
      `
      const [venue] = await sql`SELECT timezone FROM venues WHERE tenant_id = ${ctx.tenantId} ORDER BY created_at LIMIT 1`
      return {
        customers: rows.map(c => ({
          name: c.name, email: realEmail(c.email), phone: c.phone || null,
          visits: c.visit_count ?? 0, notes: c.notes || null,
          next_booking: c.next_booking_at ? whenText(c.next_booking_at, venue?.timezone) : null,
        })),
      }
    },
  },
]
