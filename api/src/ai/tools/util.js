// src/ai/tools/util.js — small helpers shared by the guest and staff tools.

import { z } from 'zod'
import { sql, withTenant } from '../../config/db.js'
import { ToolError } from '../context.js'

export const DateStr  = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
export const TimeStr  = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24-hour, restaurant local time)')
export const PartySize = z.number().int().min(1).max(50)
// Staff can book past the venue's usual party sizes (override_limits), so
// their tools take bigger parties than the guest tools.
export const StaffPartySize = z.number().int().min(1).max(300)

const PLACEHOLDER_EMAILS = new Set(['walkin@walkin.com', 'tbc@placeholder.com', 'tbc@example.com'])
export const realEmail = e => (e && !PLACEHOLDER_EMAILS.has(String(e).toLowerCase())) ? e : null

/** { date: 'YYYY-MM-DD', time: 'HH:MM', weekday } of an instant in a time zone. */
export function localParts(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
  }).formatToParts(d).map(p => [p.type, p.value]))
  const hour = parts.hour === '24' ? '00' : parts.hour
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}`, weekday: parts.weekday }
}

/** "Friday 12 October 2026" for a YYYY-MM-DD date. */
export function longDate(dateStr) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(dateStr + 'T12:00:00Z'))
}

/** "Friday 12 October 2026 at 19:00" for an instant in a venue's zone. */
export function whenText(instant, tz) {
  const p = localParts(instant, tz)
  return longDate(p.date) + ' at ' + p.time
}

/** UTC instant of a venue-local date + time (the database does the zone maths). */
export async function zonedInstant(date, time, tz) {
  const [{ ts }] = await sql`SELECT (${date + ' ' + time + ':00'}::timestamp AT TIME ZONE ${tz || 'UTC'}) AS ts`
  return ts
}

export const reference = id => String(id).slice(0, 8).toUpperCase()

/** Booking rules a tool checks before calling a route. */
export async function venueRules(venue) {
  const [r] = await withTenant(venue.tenant_id, tx => tx`
    SELECT br.min_covers, br.max_covers, br.book_until_days, br.cutoff_before_mins,
           br.slot_duration_mins, br.buffer_after_mins, br.hold_ttl_secs,
           COALESCE(dr.requires_deposit, false) AS requires_deposit
      FROM venues v
      LEFT JOIN booking_rules br ON br.venue_id = v.id
      LEFT JOIN deposit_rules dr ON dr.venue_id = v.id
     WHERE v.id = ${venue.id} AND v.tenant_id = ${venue.tenant_id}
  `)
  return {
    configured:         r?.min_covers != null,
    min_covers:         r?.min_covers ?? 1,
    max_covers:         r?.max_covers ?? 8,
    book_until_days:    r?.book_until_days ?? 30,
    cutoff_before_mins: r?.cutoff_before_mins ?? 60,
    slot_duration_mins: r?.slot_duration_mins ?? 90,
    buffer_after_mins:  r?.buffer_after_mins ?? 0,
    hold_ttl_secs:      r?.hold_ttl_secs ?? 300,
    requires_deposit:   !!r?.requires_deposit,
  }
}

/** Checks a date is today or later and inside the booking window. */
export function checkBookableDate(date, venue, rules) {
  const today = localParts(new Date(), venue.timezone).date
  if (date < today) throw new ToolError('That date has already passed. Today at ' + venue.name + ' is ' + longDate(today) + '.', 422)
  const last = new Date(today + 'T12:00:00Z')
  last.setUTCDate(last.getUTCDate() + rules.book_until_days)
  const lastStr = last.toISOString().slice(0, 10)
  if (date > lastStr) {
    throw new ToolError(venue.name + ' takes bookings up to ' + rules.book_until_days + ' days ahead (until ' + longDate(lastStr) + ').', 422)
  }
  return today
}

/** The nearest few times to `time` from a list of HH:MM strings. */
export function nearestTimes(times, time, n = 4) {
  const mins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return [...times].sort((a, b) => Math.abs(mins(a) - mins(time)) - Math.abs(mins(b) - mins(time))).slice(0, n).sort()
}

/** Run fn, turning a route/service 4xx (httpError, statusCode) into a ToolError. */
export async function asTool(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ToolError) throw err
    const status = err?.statusCode ?? err?.status
    if (status && status < 500) throw new ToolError(err.message, status)
    if (err?.code === '23P01' || err?.code === '55P03' || err?.code === '23505') {
      throw new ToolError('That table was just taken. Check availability again.', 409)
    }
    throw err
  }
}
