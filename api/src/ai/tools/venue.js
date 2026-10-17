// src/ai/tools/venue.js
//
// Customers and a venue's booking setup for Pepper (staff assistant and
// staff MCP). Permissions are the pages':
//
//   find_customers        search customers by name, email or phone       customers, view
//   customer_details      a customer's profile, newsletter and bookings  customers, view
//   update_customer       name, email, phone, notes                      customers, manage
//   unsubscribe_customer  take a customer off the newsletter             customers, manage
//   anonymise_customer    GDPR erasure (can't be undone)                 customers, manage
//   opening_times         weekly booking times, closures, one-off days   schedule, view
//   close_dates           close the venue for dates (a closure)          schedule, manage
//   remove_closure        reopen: remove a closure                       schedule, manage
//   list_tables           tables by section, covers, combinations        tables, view
//   booking_rules         party sizes, booking window, lengths, ...      rules, view
//   update_booking_rules  change those                                   rules, manage
//
// Everything goes through the admin routes (callApi). The customer routes
// filter by tenant themselves; venue setup routes check the venue is the
// caller's (middleware/venue.js). Closing dates warns about bookings
// already in them: the bookings stay, nothing is cancelled.

import { z } from 'zod'
import { withTenant } from '../../config/db.js'
import { ToolError, callApi, requireStaffPermission } from '../context.js'
import {
  DateStr, VenueText, venueFor, venueToday, longDate, shortDate, localParts, zonedInstant, addDays,
  plural, pickByName, audited, realEmail,
} from './util.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hhmm = t => (t ? String(t).slice(0, 5) : null)
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// Statuses that no longer hold a table (same as the slot resolver's).
const INACTIVE = ['cancelled', 'no_show', 'checked_out']

// ── Customers ───────────────────────────────────────────────

const CustomerText = z.string().trim().min(2).max(200).describe('Name, email or phone (or customer id)')

async function searchCustomers(ctx, q, limit = 10) {
  const res = await callApi(ctx, 'GET', '/api/customers?q=' + encodeURIComponent(q) + '&offset=0&limit=' + limit)
  return res.rows
}

const customerLabel = c => c.name + (realEmail(c.email) ? ' (' + c.email + ')' : c.phone ? ' (' + c.phone + ')' : '')

/** One customer for the text: an id, else the only search hit, else the only exact name. */
async function pickCustomer(ctx, text) {
  const raw = String(text).trim()
  if (UUID_RE.test(raw)) return callApi(ctx, 'GET', '/api/customers/' + raw)
  const rows = await searchCustomers(ctx, raw, 15)
  if (!rows.length) throw new ToolError('No customer matches "' + raw + '".', 404)
  let hit = rows.length === 1 ? rows[0] : null
  if (!hit) {
    const exact = rows.filter(r => [r.name, r.email, r.phone].some(v => v && v.toLowerCase() === raw.toLowerCase()))
    if (exact.length === 1) hit = exact[0]
  }
  if (!hit) throw new ToolError('More than one customer matches "' + raw + '": ' + rows.map(customerLabel).join('; ') + '. Which one (email or phone)?', 409)
  return callApi(ctx, 'GET', '/api/customers/' + hit.id)
}

function customerView(c, tz) {
  const now = new Date()
  const bookings = c.bookings || []
  const upcoming = bookings.filter(b => new Date(b.starts_at) >= now && !INACTIVE.includes(b.status))
  const past = bookings.filter(b => !upcoming.includes(b))
  const line = b => {
    const p = localParts(b.starts_at, tz)
    return shortDate(p.date) + ' ' + p.time + ', ' + plural(b.covers, 'guest') + ', ' + b.venue_name + ' (' + b.status + ')' + (b.table_label ? ', table ' + b.table_label : '')
  }
  return {
    customer_id: c.id,
    name: c.name,
    email: realEmail(c.email),
    phone: c.phone || null,
    visits: c.visit_count,
    newsletter: c.marketing_opt_in ? 'subscribed' + (c.marketing_opt_in_at ? ' since ' + shortDate(String(c.marketing_opt_in_at).slice(0, 10)) : '') : 'not subscribed',
    ...(c.notes ? { notes: c.notes } : {}),
    upcoming_bookings: upcoming.reverse().map(line),
    past_bookings: past.slice(0, 10).map(line),
    ...(past.length > 10 ? { older_bookings: past.length - 10 } : {}),
  }
}

// ── Opening times ───────────────────────────────────────────

function sittingText(s) {
  return (s.name ? s.name + ' ' : '') + hhmm(s.opens_at) + '-' + hhmm(s.closes_at) + ' (last booking ' + hhmm(s.closes_at) + ')' +
    (s.doors_close_time ? ', doors close ' + hhmm(s.doors_close_time) : '') +
    (s.default_max_covers != null ? ', up to ' + s.default_max_covers + ' covers a slot' : '')
}

async function closurePlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const to = input.to || input.from
  if (to < input.from) throw new ToolError('The end date is before the start date.', 422)
  if (input.from < venueToday(venue)) throw new ToolError('That date has already passed.', 422)
  const start = await zonedInstant(input.from, '00:00', venue.timezone)
  const end = await zonedInstant(addDays(to, 1), '00:00', venue.timezone)
  const [{ n }] = await withTenant(ctx.tenantId, tx => tx`
    SELECT count(*)::int AS n FROM bookings
     WHERE tenant_id = ${ctx.tenantId} AND venue_id = ${venue.id}
       AND starts_at >= ${start} AND starts_at < ${end}
       AND status <> ALL(${INACTIVE})
  `)
  const existing = await callApi(ctx, 'GET', `/api/venues/${venue.id}/schedule/exceptions`)
  const overlap = existing.filter(e => String(e.date_from).slice(0, 10) <= to && String(e.date_to).slice(0, 10) >= input.from)
  return { venue, to, bookings: n, overlap }
}

// ── Booking rules ───────────────────────────────────────────

const RULES = {
  min_covers:          { label: 'Smallest party', unit: n => plural(n, 'guest') },
  max_covers:          { label: 'Largest party', unit: n => plural(n, 'guest') },
  book_until_days:     { label: 'Book up to', unit: n => plural(n, 'day') + ' ahead' },
  book_from_days:      { label: 'Book at least', unit: n => plural(n, 'day') + ' ahead' },
  cutoff_before_mins:  { label: 'Online bookings close', unit: n => plural(n, 'minute') + ' before' },
  slot_duration_mins:  { label: 'Booking length', unit: n => plural(n, 'minute') },
  buffer_after_mins:   { label: 'Gap after a booking', unit: n => plural(n, 'minute') },
  hold_ttl_secs:       { label: 'Table held while booking online', unit: n => plural(Math.round(n / 60), 'minute') },
  allow_cross_section_combo:               { label: 'Join tables across sections', flag: true },
  allow_non_adjacent_combo:                { label: 'Join tables that aren\'t next to each other', flag: true },
  allow_widget_bookings_after_doors_close: { label: 'Online bookings that end after doors close', flag: true },
  enable_unconfirmed_flow:                 { label: 'Unconfirmed status', flag: true },
  enable_reconfirmed_status:               { label: 'Re-confirmed status', flag: true },
  enable_arrived_status:                   { label: 'Arrived status', flag: true },
}
const ruleText = (key, v) => {
  const r = RULES[key]
  if (v == null) return 'not set'
  return r.flag ? (v ? 'on' : 'off') : r.unit(Number(v))
}
// The rules a venue gets when none were ever saved (routes/venues.js POST defaults).
const RULE_DEFAULTS = {
  slot_duration_mins: 90, buffer_after_mins: 0, min_covers: 1, max_covers: 20, book_from_days: 0,
  book_until_days: 90, cutoff_before_mins: 60, hold_ttl_secs: 300, allow_cross_section_combo: false,
  allow_non_adjacent_combo: false, allow_widget_bookings_after_doors_close: false,
  enable_unconfirmed_flow: false, enable_reconfirmed_status: false, enable_arrived_status: true,
}

const RuleInput = {
  min_covers: z.number().int().min(1).max(300).optional(),
  max_covers: z.number().int().min(1).max(300).optional(),
  book_until_days: z.number().int().min(1).max(730).optional(),
  book_from_days: z.number().int().min(0).max(365).optional(),
  cutoff_before_mins: z.number().int().min(0).max(10080).optional(),
  slot_duration_mins: z.number().int().min(15).max(480).optional(),
  buffer_after_mins: z.number().int().min(0).max(120).optional(),
  hold_minutes: z.number().int().min(1).max(30).optional().describe('How long a table is held while a guest books online'),
  allow_cross_section_combo: z.boolean().optional(),
  allow_non_adjacent_combo: z.boolean().optional(),
  allow_widget_bookings_after_doors_close: z.boolean().optional(),
  enable_unconfirmed_flow: z.boolean().optional(),
  enable_reconfirmed_status: z.boolean().optional(),
  enable_arrived_status: z.boolean().optional(),
}

async function rulesPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const current = await callApi(ctx, 'GET', `/api/venues/${venue.id}/rules`)
  const exists = !!current?.venue_id
  const changes = {}
  for (const key of Object.keys(RULES)) if (input[key] !== undefined) changes[key] = input[key]
  if (input.hold_minutes !== undefined) changes.hold_ttl_secs = input.hold_minutes * 60
  if (!Object.keys(changes).length) throw new ToolError('Nothing to change.', 422)
  const now = { ...RULE_DEFAULTS, ...(exists ? current : {}) }
  const next = { ...now, ...changes }
  if (Number(next.min_covers) > Number(next.max_covers)) throw new ToolError('The smallest party can\'t be bigger than the largest.', 422)
  const lines = [venue.name, ...Object.keys(changes).map(k => RULES[k].label + ': ' + ruleText(k, now[k]) + ' → ' + ruleText(k, next[k]))]
  return { venue, exists, changes, next, lines }
}

export const venueTools = [
  {
    name: 'find_customers',
    section: 'customers',
    title: 'Find customers',
    description:
      'Searches customers by name, email or phone (at least 2 characters): name, email, phone, visits, newsletter and their next booking. ' +
      'customer_details gives a customer\'s notes and booking history.',
    input: z.object({
      search: z.string().trim().min(2).max(200),
      newsletter_only: z.boolean().default(false).describe('Only customers subscribed to the newsletter'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'customers', 'view')
      const res = await callApi(ctx, 'GET', '/api/customers?q=' + encodeURIComponent(input.search) + '&offset=0&limit=25' + (input.newsletter_only ? '&newsletter=1' : ''))
      const ids = res.rows.map(c => c.id)
      const next = ids.length ? await withTenant(ctx.tenantId, tx => tx`
        SELECT DISTINCT ON (b.customer_id) b.customer_id, b.starts_at, b.covers, v.name AS venue_name, v.timezone
          FROM bookings b JOIN venues v ON v.id = b.venue_id AND v.tenant_id = b.tenant_id
         WHERE b.tenant_id = ${ctx.tenantId} AND b.customer_id = ANY(${ids}::uuid[])
           AND b.starts_at >= now() AND b.status <> ALL(${INACTIVE})
         ORDER BY b.customer_id, b.starts_at
      `) : []
      const nextBy = new Map(next.map(b => {
        const p = localParts(b.starts_at, b.timezone)
        return [b.customer_id, shortDate(p.date) + ' ' + p.time + ', ' + plural(b.covers, 'guest') + ', ' + b.venue_name]
      }))
      return {
        customers: res.rows.map(c => ({
          customer_id: c.id, name: c.name, email: realEmail(c.email), phone: c.phone || null,
          visits: c.visit_count, newsletter: c.marketing_opt_in ? 'subscribed' : 'no',
          next_booking: nextBy.get(c.id) || null,
        })),
        total: res.total,
        ...(res.total > res.rows.length ? { note: 'Showing ' + res.rows.length + ' of ' + res.total + '. Search more precisely.' } : {}),
      }
    },
  },

  {
    name: 'customer_details',
    section: 'customers',
    title: 'Customer details',
    description: 'One customer\'s profile: contact details, visits, newsletter, staff notes, upcoming bookings and the last 10 bookings.',
    input: z.object({ customer: CustomerText }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'customers', 'view')
      const c = await pickCustomer(ctx, input.customer)
      const venues = await withTenant(ctx.tenantId, tx => tx`SELECT timezone FROM venues WHERE tenant_id = ${ctx.tenantId} LIMIT 1`)
      return customerView(c, venues[0]?.timezone || 'Europe/London')
    },
  },

  {
    name: 'update_customer',
    section: 'customers',
    title: 'Change a customer',
    description: 'Changes a customer\'s name, email, phone or staff notes (notes are for staff, never shown to the guest). Only what is given changes; null clears.',
    input: z.object({
      customer: CustomerText,
      name: z.string().trim().min(1).max(200).optional(),
      email: z.string().trim().email().nullable().optional(),
      phone: z.string().trim().max(30).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'customers', 'manage')
      const p = await customerEditPlan(ctx, input)
      return { title: 'Change ' + p.c.name + '?', lines: p.lines, confirmLabel: 'Save' }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'customers', 'manage')
      return audited(ctx, 'update_customer', input, async () => {
        const p = await customerEditPlan(ctx, input)
        const row = await callApi(ctx, 'PATCH', '/api/customers/' + p.c.id, { body: p.body })
        return { customer_id: row.id, name: row.name, message: 'Saved.' }
      })
    },
  },

  {
    name: 'unsubscribe_customer',
    section: 'customers',
    title: 'Unsubscribe from the newsletter',
    description: 'Takes a customer off the newsletter. Only the guest can sign up again (when they order online).',
    input: z.object({ customer: CustomerText }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'customers', 'manage')
      const c = await pickCustomer(ctx, input.customer)
      if (!c.marketing_opt_in) throw new ToolError(c.name + ' isn\'t subscribed.', 422)
      return {
        title: 'Unsubscribe ' + c.name + '?', lines: [customerLabel(c)],
        warningTitle: 'Only they can undo it', warnings: ['Staff can\'t sign anyone up: only the guest can, when ordering online.'],
        confirmLabel: 'Unsubscribe',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'customers', 'manage')
      return audited(ctx, 'unsubscribe_customer', input, async () => {
        const c = await pickCustomer(ctx, input.customer)
        await callApi(ctx, 'POST', '/api/customers/' + c.id + '/unsubscribe', { body: {} })
        return { name: c.name, message: 'Unsubscribed.' }
      })
    },
  },

  {
    name: 'anonymise_customer',
    section: 'customers',
    title: 'Anonymise a customer (GDPR)',
    description:
      'Erases a customer\'s personal details for a GDPR erasure request: name, email, phone and notes on the profile, their ' +
      'bookings and online orders are replaced with placeholders. Figures and history stay. It can\'t be undone, so only when ' +
      'the staff member asks for it.',
    input: z.object({ customer: CustomerText }),
    confirm: true,
    destructive: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'customers', 'manage')
      const c = await pickCustomer(ctx, input.customer)
      return {
        title: 'Anonymise ' + c.name + '?',
        lines: [customerLabel(c), plural((c.bookings || []).length, 'booking') + ' with their details'],
        warningTitle: 'Can\'t be undone',
        warnings: ['Their name, email, phone and notes are erased everywhere. Use this for a GDPR erasure request only.'],
        confirmLabel: 'Anonymise',
        destructive: true,
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'customers', 'manage')
      const c = await pickCustomer(ctx, input.customer)
      // Audited by id: the erasure has just removed their name from the audit.
      return audited(ctx, 'anonymise_customer', { customer_id: c.id }, async () => {
        await callApi(ctx, 'POST', '/api/customers/' + c.id + '/anonymise', { body: {} })
        return { customer_id: c.id, message: 'Anonymised.' }
      })
    },
  },

  {
    name: 'opening_times',
    section: 'venue',
    title: 'Opening times',
    description:
      'A venue\'s booking times: each weekday\'s sittings (times, last booking, doors close, covers), closures and other ' +
      'schedule changes coming up, and one-off day changes. These are the times bookings can be made for.',
    input: z.object({ venue: VenueText }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'schedule', 'view')
      const venue = await venueFor(ctx, input.venue)
      const today = venueToday(venue)
      const [week, exceptions, overrides] = await Promise.all([
        callApi(ctx, 'GET', `/api/venues/${venue.id}/schedule`),
        callApi(ctx, 'GET', `/api/venues/${venue.id}/schedule/exceptions`),
        callApi(ctx, 'GET', `/api/venues/${venue.id}/schedule/overrides?from=${today}`),
      ])
      const byDow = new Map(week.map(t => [t.day_of_week, t]))
      const order = [1, 2, 3, 4, 5, 6, 0]
      return {
        venue: venue.name,
        ...(week.length ? {} : { note: 'No weekly schedule is set up: the venue takes no bookings until one is (Schedule page).' }),
        week: order.map(d => {
          const t = byDow.get(d)
          if (!t || !t.is_open) return DAYS[d] + ': closed'
          return DAYS[d] + ': ' + (t.sittings.length ? t.sittings.map(sittingText).join('; ') : 'open, no sittings') + ' (every ' + t.slot_interval_mins + ' min)'
        }),
        coming_up: exceptions.filter(e => String(e.date_to).slice(0, 10) >= today).map(e => {
          const from = String(e.date_from).slice(0, 10), to = String(e.date_to).slice(0, 10)
          return e.name + ': ' + shortDate(from) + (to !== from ? ' to ' + shortDate(to) : '') + ' ' + (e.is_closed ? 'closed' : 'different times')
        }),
        one_off_days: overrides.map(o => shortDate(String(o.override_date).slice(0, 10)) + ': ' +
          (o.is_open ? o.sittings.map(sittingText).join('; ') || 'open' : 'closed') + (o.label ? ' (' + o.label + ')' : '')),
      }
    },
  },

  {
    name: 'close_dates',
    section: 'venue',
    title: 'Close for dates',
    description:
      'Closes a venue for bookings on a date or dates (e.g. Christmas, a private event, a refit): no new bookings can be made ' +
      'for them. Bookings already made stay as they are: the card says how many there are.',
    input: z.object({
      venue: VenueText,
      name: z.string().trim().min(1).max(200).describe('What it is, e.g. "Christmas"'),
      from: DateStr,
      to: DateStr.optional().describe('Last closed day; default the same day'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'schedule', 'manage')
      const p = await closurePlan(ctx, input)
      const warnings = [
        ...(p.bookings ? [plural(p.bookings, 'booking') + ' already in these dates: they stay booked. Cancel or move them yourself if needed (find_bookings).'] : []),
        ...p.overlap.map(e => 'Overlaps "' + e.name + '" (' + shortDate(String(e.date_from).slice(0, 10)) + ' to ' + shortDate(String(e.date_to).slice(0, 10)) + ').'),
      ]
      return {
        title: 'Close ' + p.venue.name + '?',
        lines: [input.name + ': ' + longDate(input.from) + (p.to !== input.from ? ' to ' + longDate(p.to) : '')],
        ...(warnings.length ? { warningTitle: 'Check', warnings } : {}),
        confirmLabel: 'Close',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'schedule', 'manage')
      return audited(ctx, 'close_dates', input, async () => {
        const p = await closurePlan(ctx, input)
        const row = await callApi(ctx, 'POST', `/api/venues/${p.venue.id}/schedule/exceptions`, {
          body: { name: input.name, date_from: input.from, date_to: p.to, is_closed: true, priority: 10 },
        })
        return { closure_id: row.id, venue: p.venue.name, closed: input.from + (p.to !== input.from ? ' to ' + p.to : ''), bookings_already_in_those_dates: p.bookings, message: 'Closed for bookings.' }
      })
    },
  },

  {
    name: 'remove_closure',
    section: 'venue',
    title: 'Remove a closure',
    description: 'Removes a closure or other schedule change (named, or the one covering a date), so the usual weekly times apply again.',
    input: z.object({ venue: VenueText, closure: z.string().trim().min(1).max(200).describe('Its name, or a date in it (YYYY-MM-DD)') }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'schedule', 'manage')
      const p = await removeClosurePlan(ctx, input)
      return {
        title: 'Remove "' + p.exc.name + '"?',
        lines: [p.venue.name + ': ' + shortDate(p.from) + (p.to !== p.from ? ' to ' + shortDate(p.to) : '') + ', ' + (p.exc.is_closed ? 'closed' : 'different times'), 'The usual weekly times apply again.'],
        confirmLabel: 'Remove', destructive: true,
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'schedule', 'manage')
      return audited(ctx, 'remove_closure', input, async () => {
        const p = await removeClosurePlan(ctx, input)
        await callApi(ctx, 'DELETE', `/api/venues/${p.venue.id}/schedule/exceptions/${p.exc.id}`)
        return { removed: p.exc.name, message: 'Removed.' }
      })
    },
  },

  {
    name: 'list_tables',
    section: 'venue',
    title: 'Tables',
    description: 'A venue\'s tables by section: covers (smallest and largest party), switched off ones, and table combinations.',
    input: z.object({ venue: VenueText }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'tables', 'view')
      const venue = await venueFor(ctx, input.venue)
      const [tables, combos] = await Promise.all([
        callApi(ctx, 'GET', `/api/venues/${venue.id}/tables`),
        callApi(ctx, 'GET', `/api/venues/${venue.id}/combinations`),
      ])
      const real = tables.filter(t => !t.is_unallocated)
      const sections = new Map()
      for (const t of real) {
        const key = t.section_name || 'No section'
        if (!sections.has(key)) sections.set(key, [])
        sections.get(key).push(t.label + ' (' + t.min_covers + '-' + t.max_covers + ')' + (t.is_active ? '' : ' switched off'))
      }
      return {
        venue: venue.name,
        sections: Object.fromEntries(sections),
        seats: real.filter(t => t.is_active).reduce((s, t) => s + Number(t.max_covers || 0), 0),
        combinations: (combos || []).map(c => (c.name || (c.members || []).map(m => m.label).join('+')) + ' (' + c.min_covers + '-' + c.max_covers + ')'),
      }
    },
  },

  {
    name: 'booking_rules',
    section: 'venue',
    title: 'Booking rules',
    description: 'A venue\'s booking rules: party sizes, how far ahead, when online bookings close, booking length, gaps, table joining and statuses.',
    input: z.object({ venue: VenueText }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rules', 'view')
      const venue = await venueFor(ctx, input.venue)
      const r = await callApi(ctx, 'GET', `/api/venues/${venue.id}/rules`)
      const now = { ...RULE_DEFAULTS, ...(r?.venue_id ? r : {}) }
      return {
        venue: venue.name,
        ...(r?.venue_id ? {} : { note: 'No rules saved yet: these are the defaults.' }),
        rules: Object.fromEntries(Object.keys(RULES).map(k => [RULES[k].label, ruleText(k, now[k])])),
      }
    },
  },

  {
    name: 'update_booking_rules',
    section: 'venue',
    title: 'Change booking rules',
    description: 'Changes a venue\'s booking rules (only what is given): party sizes, how far ahead, online cut-off, booking length, gap after, hold time, table joining, statuses.',
    input: z.object({ venue: VenueText, ...RuleInput }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'rules', 'manage')
      const p = await rulesPlan(ctx, input)
      return { title: 'Change booking rules?', lines: p.lines, confirmLabel: 'Save' }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'rules', 'manage')
      return audited(ctx, 'update_booking_rules', input, async () => {
        const p = await rulesPlan(ctx, input)
        if (p.exists) await callApi(ctx, 'PATCH', `/api/venues/${p.venue.id}/rules`, { body: p.changes })
        else {
          const body = Object.fromEntries(Object.keys(RULE_DEFAULTS).map(k => [k, p.next[k]]))
          await callApi(ctx, 'POST', `/api/venues/${p.venue.id}/rules`, { body })
          // POST doesn't take the table-joining flags; PATCH them.
          const joins = ['allow_cross_section_combo', 'allow_non_adjacent_combo'].filter(k => p.changes[k] !== undefined)
          if (joins.length) await callApi(ctx, 'PATCH', `/api/venues/${p.venue.id}/rules`, { body: Object.fromEntries(joins.map(k => [k, p.changes[k]])) })
        }
        return { venue: p.venue.name, changed: p.lines.slice(1), message: 'Saved.' }
      })
    },
  },
]

async function customerEditPlan(ctx, input) {
  const c = await pickCustomer(ctx, input.customer)
  if (c.is_anonymised) throw new ToolError('This customer is anonymised.', 422)
  const body = {}
  const lines = [customerLabel(c)]
  for (const k of ['name', 'email', 'phone', 'notes']) {
    if (input[k] === undefined) continue
    const was = k === 'email' ? realEmail(c.email) : c[k]
    if ((was ?? null) === (input[k] ?? null)) continue
    body[k] = input[k]
    lines.push(k[0].toUpperCase() + k.slice(1) + ': ' + (was || '(none)') + ' → ' + (input[k] || '(none)'))
  }
  if (!Object.keys(body).length) throw new ToolError('Nothing to change.', 422)
  return { c, body, lines }
}

async function removeClosurePlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const list = (await callApi(ctx, 'GET', `/api/venues/${venue.id}/schedule/exceptions`))
    .map(e => ({ ...e, from: String(e.date_from).slice(0, 10), to: String(e.date_to).slice(0, 10) }))
  const raw = input.closure.trim()
  let exc
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const hits = list.filter(e => e.from <= raw && e.to >= raw)
    if (!hits.length) throw new ToolError('No closure covers ' + shortDate(raw) + '.', 404)
    if (hits.length > 1) throw new ToolError('More than one covers ' + shortDate(raw) + ': ' + hits.map(e => e.name).join(', ') + '. Which one?', 409)
    exc = hits[0]
  } else {
    exc = pickByName(list, raw, e => e.name, 'closure', 'There are no closures or schedule changes.')
  }
  return { venue, exc, from: exc.from, to: exc.to }
}
