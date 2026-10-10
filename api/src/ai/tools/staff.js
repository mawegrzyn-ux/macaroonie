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
//
// override_limits (create_booking, change_booking): staff can book past the
// venue's guest limits, the party-size range in booking_rules and a time
// slot's covers limit, the way the timeline's manual allocation can. Without
// it the tool refuses and says which limit is in the way, so the assistant
// asks first; with it the Confirm card lists the limits being overridden.
// A new booking past the limits goes in through POST /bookings/admin-override
// on the best free table that fits, or the Unallocated row if none does.
// Times outside the booking times, or blocked in the schedule, still fail.

import { z } from 'zod'
import { sql, withTenant } from '../../config/db.js'
import { ToolError, callApi, audit, requireStaffPermission } from '../context.js'
import { loadBookingById, rescheduleBooking, partySizeLimit, coversLimit } from '../../services/guestBookingSvc.js'
import { allocateBestFit } from '../../services/occupancySvc.js'
import {
  DateStr, TimeStr, StaffPartySize, localParts, longDate, whenText, reference, realEmail,
  venueRules, nearestTimes, asTool,
} from './util.js'

const STATUSES = ['unconfirmed', 'confirmed', 'reconfirmed', 'arrived', 'seated', 'checked_out', 'cancelled', 'no_show']
const STATUS_LABELS = {
  unconfirmed: 'Unconfirmed', confirmed: 'Confirmed', reconfirmed: 'Re-confirmed', arrived: 'Arrived',
  seated: 'Seated', checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
}
const BookingRef = z.string().min(6).max(40).describe('booking_id, or the 8-character reference')

/** An active venue of this tenant (shared with the H&S tools). */
export async function staffVenue(ctx, venueId) {
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

const people = n => n + (n === 1 ? ' person' : ' people')

const OVERRIDE_HINT = ' If the staff member wants it anyway, call the tool again with override_limits: true' +
  ' (they see the limits on the Confirm card).'

/**
 * How a new booking would go in. Inside the venue's guest limits with a
 * free table: { slot } (the normal hold + confirm path). Past the party-size
 * range or the time's covers limit: { limits, startsAt, tableIds, table }
 * where limits are the overridden limits as text and tableIds the best free
 * fit (empty = the Unallocated row). Throws when the time can't be booked
 * here at all, or when the only problem is that no table is free.
 */
async function newBookingPlan(ctx, venue, rules, { date, time, party_size }) {
  const outside = party_size < rules.min_covers || party_size > rules.max_covers
  if (!outside) {
    const slot = (await bookableSlots(ctx, venue, date, party_size)).find(s => s.local === time)
    if (slot) return { slot, limits: [] }
  }

  const res = await callApi(ctx, 'GET', `/api/venues/${venue.id}/slots?date=${date}&covers=${party_size}`)
  const rows = (res?.slots || []).map(s => ({ ...s, local: localParts(s.slot_time, venue.timezone).time }))
  const row = rows.find(s => s.local === time)
  if (!row) {
    throw new ToolError(rows.length
      ? time + ' isn\'t one of ' + venue.name + '\'s booking times on ' + longDate(date) +
        ' (they run ' + rows[0].local + ' to ' + rows[rows.length - 1].local + '). For other times use the timeline.'
      : venue.name + ' isn\'t taking bookings on ' + longDate(date) +
        ' (closed, too far ahead, or too close to the time). For that, use the timeline.', 422)
  }
  if (row.reason === 'unavailable') {
    throw new ToolError(time + ' is blocked in ' + venue.name + '\'s schedule on ' + longDate(date) + '. To book it anyway, use the timeline.', 422)
  }

  const limits = []
  if (outside) limits.push(partySizeLimit(party_size, rules))
  if (row.reason === 'full') limits.push(coversLimit(time, Number(row.available_covers ?? 0)))
  if (!limits.length) {
    const free = rows.filter(s => s.available).map(s => s.local)
    throw new ToolError(time + ' has no free table for ' + party_size + '. ' +
      (free.length ? 'Nearest free times: ' + nearestTimes(free, time).join(', ') + '. ' : '') +
      'To book it anyway, use the timeline.', 409)
  }

  const startsAt = new Date(row.slot_time)
  const windowEnd = new Date(startsAt.getTime() + (rules.slot_duration_mins + rules.buffer_after_mins) * 60_000)
  const fit = await withTenant(ctx.tenantId, async tx => {
    const alloc = await allocateBestFit(tx, {
      venueId: venue.id, covers: party_size, startsAt, windowEnd, ignoreMinCovers: true,
    })
    if (!alloc) return { tableIds: [], table: null }
    if (!alloc.combinationId) return { tableIds: [alloc.tableId], table: alloc.label }
    const members = await tx`
      SELECT m.table_id FROM table_combination_members m
        JOIN table_combinations c ON c.id = m.combination_id
       WHERE m.combination_id = ${alloc.combinationId} AND c.tenant_id = ${ctx.tenantId}
    `
    return { tableIds: members.map(m => m.table_id), table: alloc.label }
  })
  return { limits, startsAt, ...fit }
}

/** "Over the usual limits" card lines for a table plan. */
const tableLine = plan => plan.table
  ? 'Table: ' + plan.table
  : 'No free table fits: it goes on the Unallocated row to seat on the timeline'

/** Free times on a day, for a failed move. */
async function freeTimesNote(ctx, venue, date, partySize, time) {
  const times = (await bookableSlots(ctx, venue, date, partySize).catch(() => [])).map(s => s.local)
  const near = time ? nearestTimes(times, time) : times.slice(0, 8)
  return near.length ? 'Free times that day: ' + near.join(', ') + '. ' : ''
}

/** What a move would need: the limits it goes past ([] = none) and where it
 *  would sit. Runs the real move as a dry run, so the card matches. */
async function moveCheck(ctx, b, { date, time, party_size }) {
  return asTool(() => rescheduleBooking(b, { date, time, covers: party_size }, { staff: true, overrideLimits: true, dryRun: true }))
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
    description:
      'Times with a free table at a venue on a date for a party size (restaurant local times). ' +
      'Also says when the party is outside the venue\'s usual party sizes.',
    input: z.object({
      venue_id:   z.string().uuid(),
      date:       DateStr,
      party_size: StaffPartySize,
      time:       TimeStr.optional(),
    }),
    readOnly: true,
    async run(ctx, { venue_id, date, party_size, time }) {
      await requireStaffPermission(ctx, 'bookings', 'view')
      const venue = await staffVenue(ctx, venue_id)
      const rules = await venueRules(venue)
      const base = { venue: venue.name, date, day: longDate(date), party_size }
      if (party_size < rules.min_covers || party_size > rules.max_covers) {
        const res = await callApi(ctx, 'GET', `/api/venues/${venue.id}/slots?date=${date}&covers=${party_size}`)
        const times = (res?.slots || []).filter(s => s.reason !== 'unavailable').map(s => localParts(s.slot_time, venue.timezone).time)
        return {
          ...base,
          usual_party_sizes: rules.min_covers + ' to ' + rules.max_covers,
          booking_times: times,
          message: partySizeLimit(party_size, rules) + ', so no time is free in the normal way.' +
            (times.length ? OVERRIDE_HINT.replace('call the tool again', 'book it') : ' The venue has no booking times that day.'),
        }
      }
      const times = (await bookableSlots(ctx, venue, date, party_size)).map(s => s.local)
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
      'Read the details back and only call this once the staff member has agreed them. ' +
      'If the party is outside the venue\'s usual party sizes or the time is over its covers limit, it refuses ' +
      'and says why: tell the staff member, and only if they still want it set override_limits: true.',
    input: z.object({
      venue_id:    z.string().uuid(),
      date:        DateStr,
      time:        TimeStr,
      party_size:  StaffPartySize,
      guest_name:  z.string().min(1).max(200),
      guest_email: z.string().email().optional(),
      guest_phone: z.string().max(30).optional(),
      notes:       z.string().max(1000).optional().describe('Notes from the guest (allergies, occasion)'),
      status:      z.enum(['unconfirmed', 'confirmed', 'reconfirmed']).optional(),
      override_limits: z.boolean().optional()
        .describe('Book past the usual party sizes or the time\'s covers limit. Only when the staff member has asked for it.'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const venue = await staffVenue(ctx, input.venue_id)
      const rules = await venueRules(venue)
      if (rules.requires_deposit) {
        throw new ToolError(venue.name + ' takes a deposit, so bookings there need the payment flow. Use the booking widget.', 422)
      }
      const plan = await newBookingPlan(ctx, venue, rules, input)
      if (plan.limits.length && !input.override_limits) throw new ToolError(plan.limits.join('. ') + '.' + OVERRIDE_HINT, 409)
      const over = plan.limits.length > 0
      return {
        title: over ? 'Book past the usual limits?' : 'Make this booking?',
        lines: [
          venue.name,
          longDate(input.date) + ' at ' + input.time,
          people(input.party_size),
          input.guest_name + [input.guest_email, input.guest_phone].filter(Boolean).map(s => ', ' + s).join(''),
          ...(input.notes ? ['Notes: ' + input.notes] : []),
          ...(input.status ? ['Status: ' + STATUS_LABELS[input.status]] : []),
          ...(over ? [tableLine(plan)] : []),
        ],
        ...(over ? { warningTitle: 'Past the usual limits', warnings: plan.limits } : {}),
        confirmLabel: over ? 'Book anyway' : 'Make booking',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const venue = await staffVenue(ctx, input.venue_id)
      const rules = await venueRules(venue)
      if (rules.requires_deposit) {
        throw new ToolError(venue.name + ' takes a deposit, so bookings there need the payment flow. Use the booking widget.', 422)
      }
      const audited = { ...input }
      try {
        const plan = await newBookingPlan(ctx, venue, rules, input)
        if (plan.limits.length && !input.override_limits) throw new ToolError(plan.limits.join('. ') + '.' + OVERRIDE_HINT, 409)

        let bk
        if (plan.slot) {
          const hold = await callApi(ctx, 'POST', '/api/bookings/holds', {
            body: {
              venue_id:  venue.id,
              ...(plan.slot.table_id ? { table_id: plan.slot.table_id } : { combination_id: plan.slot.combination_id }),
              starts_at: new Date(plan.slot.slot_time).toISOString(),
              covers:    input.party_size,
              guest_name:  input.guest_name,
              guest_email: input.guest_email || 'tbc@placeholder.com',
              guest_phone: input.guest_phone ?? null,
            },
          })
          bk = await callApi(ctx, 'POST', '/api/bookings', {
            body: {
              hold_id: hold.id,
              guest_phone: input.guest_phone ?? null,
              guest_notes: input.notes ?? null,
              ...(input.status ? { status: input.status } : {}),
            },
          })
        } else {
          // Past the usual limits: straight in, like the timeline's manual allocation.
          bk = await callApi(ctx, 'POST', '/api/bookings/admin-override', {
            body: {
              venue_id:    venue.id,
              starts_at:   plan.startsAt.toISOString(),
              covers:      input.party_size,
              table_ids:   plan.tableIds,
              guest_name:  input.guest_name,
              guest_email: input.guest_email || 'tbc@placeholder.com',
              guest_phone: input.guest_phone ?? null,
              guest_notes: input.notes ?? null,
              ...(input.status ? { status: input.status } : {}),
            },
          })
        }
        await sql`UPDATE bookings SET source = ${ctx.channel} WHERE id = ${bk.id} AND tenant_id = ${ctx.tenantId}`
        const [row] = await bookingRows(ctx, sql`b.id = ${bk.id}`, 1)
        const view = staffView(row)
        const result = plan.limits.length ? { ...view, overridden_limits: plan.limits } : view
        await audit(ctx, { tool: 'create_booking', input: audited, ok: true, result, bookingId: bk.id })
        const message = 'Booked' + (plan.limits.length ? ' past the usual limits' : '') + '. Reference ' + view.reference + '.' +
          (plan.limits.length && !plan.tableIds.length ? ' It is on the Unallocated row: seat it on the timeline.' : '')
        return { ...result, message }
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
      'Moves a booking to another date, time or party size (give only what changes). It must be one of the venue\'s ' +
      'booking times with a free table; keeps the table when it can. The guest is emailed the new details. ' +
      'If the new party size is outside the usual party sizes or the time is over its covers limit, it refuses and ' +
      'says why: tell the staff member, and only if they still want it set override_limits: true.',
    input: z.object({
      booking:    BookingRef,
      date:       DateStr.optional(),
      time:       TimeStr.optional(),
      party_size: StaffPartySize.optional(),
      override_limits: z.boolean().optional()
        .describe('Move it past the usual party sizes or the time\'s covers limit. Only when the staff member has asked for it.'),
    }),
    confirm: true,
    async describe(ctx, { booking, date, time, party_size, override_limits }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      const cur = localParts(b.starts_at, b.venue_timezone)
      const plan = await moveCheck(ctx, b, { date, time, party_size })
      if (plan.limits.length && !override_limits) throw new ToolError(plan.limits.join('. ') + '.' + OVERRIDE_HINT, 409)
      const over = plan.limits.length > 0
      return {
        title: over ? 'Move it past the usual limits?' : 'Move this booking?',
        lines: [
          b.guest_name + ', ' + b.venue_name + ' (' + reference(b.id) + ')',
          'Now: ' + whenText(b.starts_at, b.venue_timezone) + ', ' + people(b.covers),
          'New: ' + longDate(date || cur.date) + ' at ' + (time || cur.time) + ', ' + people(party_size ?? b.covers),
          ...(over ? [tableLine(plan)] : []),
        ],
        ...(over ? { warningTitle: 'Past the usual limits', warnings: plan.limits } : {}),
        confirmLabel: over ? 'Move anyway' : 'Move booking',
      }
    },
    async run(ctx, { booking, date, time, party_size, override_limits }) {
      await requireStaffPermission(ctx, 'bookings', 'manage')
      const b = await staffBooking(ctx, booking)
      const input = { booking: reference(b.id), date, time, party_size, ...(override_limits ? { override_limits } : {}) }
      let moved
      try {
        moved = await asTool(() => rescheduleBooking(b, { date, time, covers: party_size }, { staff: true, overrideLimits: !!override_limits }))
      } catch (err) {
        await audit(ctx, { tool: 'change_booking', input, ok: false, result: { error: err.message }, bookingId: b.id })
        if (!(err instanceof ToolError)) throw err
        // Would it go through past the limits? Then say so instead of only listing times.
        if (!override_limits) {
          const plan = await moveCheck(ctx, b, { date, time, party_size }).catch(() => null)
          if (plan?.limits.length) throw new ToolError(plan.limits.join('. ') + '.' + OVERRIDE_HINT, err.status)
        }
        const venue = { id: b.t_venue_id, tenant_id: b.t_tenant_id, name: b.venue_name, timezone: b.venue_timezone }
        const cur = localParts(b.starts_at, venue.timezone)
        throw new ToolError(err.message + '. ' + await freeTimesNote(ctx, venue, date || cur.date, party_size ?? b.covers, time) +
          'For anything outside the booking times, use the timeline.', err.status)
      }
      const [row] = await bookingRows(ctx, sql`b.id = ${b.id}`, 1)
      const view = staffView(row)
      const over = moved?.limits?.length > 0
      const result = over ? { ...view, overridden_limits: moved.limits } : view
      await audit(ctx, { tool: 'change_booking', input, ok: true, result, bookingId: b.id })
      return {
        ...result,
        message: over
          ? 'Moved past the usual limits.' + (moved.unallocated ? ' It is on the Unallocated row: seat it on the timeline.' : '')
          : 'Moved.',
      }
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
