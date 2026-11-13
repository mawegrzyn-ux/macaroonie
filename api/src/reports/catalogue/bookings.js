// src/reports/catalogue/bookings.js
//
// Table bookings in the report catalogue. A booking sits on the day it is
// for, at its venue's own time. Guests and bookings count unless the
// booking was cancelled or a no-show (the bookings page's own rule for its
// figures); cancellations and no-shows have their own measures.

import { subject, text, number, money, yesno, choice, moment, duration, sum, avg, count, ratio, one, many } from './define.js'

const DAY = '({t}.starts_at AT TIME ZONE {tz})::date'
const LIVE = "{t}.status NOT IN ('cancelled', 'no_show')"
const PAID = "{t}.status IN ('succeeded', 'refunded', 'partially_refunded')"
const LEAD = '((' + DAY + ') - ({t}.created_at AT TIME ZONE {tz})::date)'

export default [
  subject({
    key: 'bookings.sections',
    label: 'Table sections',
    one: 'section',
    area: 'bookings',
    module: 'bookings',
    about: 'The sections your tables are grouped in (Main room, Terrace).',
    from: 'venue_sections',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { sections: count({ label: 'Sections' }) },
    list: ['name', 'venue.name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at'],
  }),

  subject({
    key: 'bookings.tables',
    label: 'Tables',
    one: 'table',
    area: 'bookings',
    module: 'bookings',
    about: 'Your tables, with how many each seats.',
    from: 'tables',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('label'),
      min_covers: number('min_covers', { label: 'Seats at least', decimals: 0 }),
      max_covers: number('max_covers', { label: 'Seats at most', decimals: 0 }),
      active: yesno('is_active', { label: 'In use' }),
      unallocated: yesno('is_unallocated', { label: 'The Unallocated row' }),
    },
    measures: {
      tables: count({ label: 'Tables', where: '{t}.is_active AND NOT {t}.is_unallocated', about: 'Tables in use (the Unallocated row isn\'t a table).' }),
      seats: sum('max_covers', { label: 'Seats', where: '{t}.is_active AND NOT {t}.is_unallocated', about: 'The most guests the tables in use take.' }),
    },
    links: {
      section: one('bookings.sections', 'section_id', { label: 'Section' }),
    },
    list: ['name', 'venue.name', 'section.name', 'min_covers', 'max_covers', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    // Where a table sits on the till's floor plan isn't something to report on.
    skip: ['floor_area_id', 'sort_order', 'created_at', 'updated_at', 'pos_x', 'pos_y', 'pos_w', 'pos_h', 'shape', 'rotation'],
  }),

  subject({
    key: 'bookings.bookings',
    label: 'Bookings',
    one: 'booking',
    area: 'bookings',
    module: 'bookings',
    about: 'Every table booking, on the day it is for. Bookings and guests count unless the booking was cancelled or a no-show.',
    from: 'bookings',
    name: 'reference',
    venue: 'venue_id',
    open: { page: '/bookings?booking=:id', module: 'bookings' },
    date: { sql: DAY, bound: '{t}.starts_at', label: 'Day', about: 'The day the booking is for, at the venue.' },
    fields: {
      reference: text('reference'),
      status: choice({ sql: '{t}.status::text' }, {
        unconfirmed: 'Unconfirmed', confirmed: 'Confirmed', reconfirmed: 'Re-confirmed', arrived: 'Arrived',
        seated: 'Seated', checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No-show', pending_payment: 'Waiting for payment',
      }),
      covers: number('covers', { label: 'Guests', adds: true, decimals: 0 }),
      party_size: choice({ sql: "(CASE WHEN {t}.covers <= 2 THEN '1_2' WHEN {t}.covers <= 4 THEN '3_4' WHEN {t}.covers <= 6 THEN '5_6' WHEN {t}.covers <= 8 THEN '7_8' ELSE '9_up' END)" },
        { '1_2': '1 or 2', '3_4': '3 or 4', '5_6': '5 or 6', '7_8': '7 or 8', '9_up': '9 or more' }, { label: 'Party size' }),
      starts_at: moment('starts_at', { label: 'Starts' }),
      ends_at: moment('ends_at', { label: 'Ends' }),
      length: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.ends_at - {t}.starts_at))' }, { label: 'Length' }),
      created_at: moment('created_at', { label: 'Booked at' }),
      lead_days: number({ sql: LEAD }, { label: 'Days booked ahead', decimals: 0 }),
      booked_ahead: choice({ sql: `(CASE WHEN ${LEAD} <= 0 THEN 'same_day' WHEN ${LEAD} = 1 THEN 'day_before' WHEN ${LEAD} <= 6 THEN 'week' WHEN ${LEAD} <= 13 THEN 'two_weeks' ELSE 'longer' END)` },
        { same_day: 'On the day', day_before: 'The day before', week: '2 to 6 days ahead', two_weeks: '1 to 2 weeks ahead', longer: 'More than 2 weeks ahead' }, { label: 'Booked ahead' }),
      source: choice({ sql: "COALESCE({t}.source, 'direct')" },
        { direct: 'The website or staff', staff_chat: 'Pepper, for staff', staff_mcp: 'A staff AI app', guest_chat: 'The website chat', guest_mcp: 'A guest AI app' }, { label: 'Booked through' }),
      guest_kind: choice({ sql: `(CASE WHEN {t}.customer_id IS NULL THEN 'unknown'
              WHEN EXISTS (SELECT 1 FROM bookings b2
                            WHERE b2.customer_id = {t}.customer_id AND b2.tenant_id = {t}.tenant_id
                              AND b2.starts_at < {t}.starts_at AND b2.status NOT IN ('cancelled', 'no_show')) THEN 'returning'
              ELSE 'new' END)` },
        { new: 'New guest', returning: 'Returning guest', unknown: 'No customer record' }, { label: 'New or returning', about: 'Returning: the same customer has an earlier booking that wasn\'t cancelled or a no-show.' }),
      guest_name: text('guest_name', { label: 'Guest name', pii: true }),
      guest_email: text('guest_email', { label: 'Guest email', pii: true }),
      guest_phone: text('guest_phone', { label: 'Guest phone', pii: true }),
      guest_notes: text('guest_notes', { label: 'Guest notes', pii: true }),
      staff_notes: text('operator_notes', { label: 'Staff notes', pii: true }),
      table_locked: yesno('table_locked', { label: 'Table locked' }),
      reminder_sent_at: moment('reminder_sent_at', { label: 'Reminder sent' }),
    },
    measures: {
      bookings: count({ label: 'Bookings', where: LIVE, about: 'Not counting cancelled bookings and no-shows.' }),
      guests: sum('covers', { label: 'Guests', where: LIVE, about: 'Guests booked, not counting cancelled bookings and no-shows.' }),
      made: count({ label: 'Bookings made', about: 'Every booking, cancelled ones and no-shows included.' }),
      cancelled: count({ label: 'Cancelled', where: "{t}.status = 'cancelled'", about: 'Bookings cancelled.' }),
      no_shows: count({ label: 'No-shows', where: "{t}.status = 'no_show'", about: 'Bookings marked as no-shows.' }),
      expected: count({ label: 'Bookings not cancelled', where: "{t}.status <> 'cancelled'", about: 'Every booking but the cancelled ones; no-shows included.' }),
      no_show_rate: ratio('no_shows', 'expected', { type: 'percent', label: 'No-show rate', about: 'No-shows out of the bookings that weren\'t cancelled.' }),
      cancel_rate: ratio('cancelled', 'made', { type: 'percent', label: 'Cancelled rate', about: 'Cancelled bookings out of every booking made.' }),
      average_party: ratio('guests', 'bookings', { label: 'Average party', decimals: 1, about: 'Guests divided by bookings, not counting cancelled bookings and no-shows.' }),
      average_lead: avg({ sql: LEAD }, { label: 'Average days ahead', decimals: 1, where: LIVE, about: 'How many days before their day bookings were made, on average; cancelled bookings and no-shows left out.' }),
    },
    links: {
      table: one('bookings.tables', 'table_id', { label: 'Table' }),
      customer: one('guests.customers', 'customer_id', { label: 'Customer', needs: 'customers' }),
      deposits: many('bookings.deposits', 'booking_id', { label: 'Deposits' }),
    },
    list: ['date', 'starts_at', 'venue.name', 'guest_name', 'covers', 'table.name', 'status', 'reference'],
    sort: [{ by: 'starts_at', dir: 'desc' }],
    // manage_token is the guest's key to their booking: never offered.
    skip: ['combination_id', 'updated_at', 'manage_token'],
  }),

  subject({
    key: 'bookings.deposits',
    label: 'Booking deposits',
    one: 'deposit',
    area: 'bookings',
    module: 'bookings',
    about: 'Deposits guests paid with their bookings, on the day each was paid, with what was refunded.',
    from: 'payments',
    name: 'reference',
    venue: { sql: '{booking}.venue_id' },
    open: 'booking',
    date: { sql: '({t}.created_at AT TIME ZONE {tz})::date', bound: '{t}.created_at', label: 'Day paid' },
    fields: {
      reference: text({ sql: '{booking}.reference' }, { label: 'Booking' }),
      status: choice({ sql: '{t}.status::text' }, { pending: 'Not paid yet', succeeded: 'Paid', failed: 'Failed', refunded: 'Refunded', partially_refunded: 'Partly refunded' }),
      amount: money('amount', { unit: 'pounds' }),
      refunded: money('refunded_amount', { unit: 'pounds' }),
      kept: money({ sql: '({t}.amount - {t}.refunded_amount)' }, { unit: 'pounds', label: 'Kept' }),
      paid_at: moment('created_at', { label: 'Paid at' }),
      refunded_at: moment('refunded_at', { label: 'Refunded at' }),
      refund_hours: number('refund_hours_before', { label: 'Refunded if cancelled this many hours before', decimals: 0 }),
    },
    measures: {
      deposits: count({ label: 'Deposits', where: PAID, about: 'Deposits paid (refunded ones included).' }),
      taken: sum('amount', { type: 'money', unit: 'pounds', label: 'Deposits taken', where: PAID, about: 'What the deposits paid came to, before refunds.' }),
      refunded_total: sum('refunded_amount', { type: 'money', unit: 'pounds', label: 'Refunded', where: PAID, about: 'What was given back of the deposits.' }),
      kept_total: sum({ sql: '({t}.amount - {t}.refunded_amount)' }, { type: 'money', unit: 'pounds', label: 'Kept', where: PAID, about: 'Deposits taken less what was refunded.' }),
    },
    links: {
      booking: one('bookings.bookings', 'booking_id', { label: 'Booking' }),
    },
    list: ['date', 'reference', 'booking.guest_name', 'status', 'amount', 'refunded', 'kept'],
    sort: [{ by: 'paid_at', dir: 'desc' }],
    // Stripe's own ids and account, and the currency (a venue's currency is the one reports use).
    skip: ['stripe_pi_id', 'stripe_account', 'refund_ids', 'currency', 'updated_at'],
  }),
]
