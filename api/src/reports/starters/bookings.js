// src/reports/starters/bookings.js
//
// Starter reports on table bookings (docs/REPORTS.md Appendix B). "Bookings"
// and "Guests" leave out cancelled bookings and no-shows; "Bookings made"
// counts every one.

import { starter, m, share } from './define.js'

const BOOKING_ROWS = ['date', 'starts_at', 'venue.name', 'covers', 'table.name', 'status', 'source', 'reference']

export default [
  starter({
    key: 'bookings_guests_by_day',
    name: 'Guests by day and time',
    about: 'Guests booked for each day, with a column for each hour bookings start: where the busy sittings are. Cancelled bookings and no-shows are left out.',
    period: 'this_week',
    spec: {
      subject: 'bookings.bookings',
      kind: 'matrix',
      rows: ['date'],
      columns: [{ field: 'starts_at', bucket: 'hour', label: 'Starts' }],
      values: m('guests'),
      drill: { rows: BOOKING_ROWS },
      view: { kind: 'heat' },
    },
  }),

  starter({
    key: 'bookings_by_source',
    name: 'Bookings by source',
    about: 'Where bookings came from: the website and staff, or Pepper for staff and for guests. Bookings made, the ones that stood, their guests, and those cancelled or not turned up for.',
    period: 'last_month',
    spec: {
      subject: 'bookings.bookings',
      rows: ['source'],
      values: m('made', 'bookings', 'guests', 'cancelled', 'no_shows'),
      sort: [{ by: 'made', dir: 'desc' }],
      drill: { down: ['date', 'venue.name', 'status'], rows: BOOKING_ROWS },
    },
  }),

  starter({
    key: 'bookings_no_shows',
    name: 'No-shows and cancellations',
    about: 'Week by week: bookings made, how many were cancelled and how many guests didn\'t turn up for, each as a count and as a rate.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'bookings.bookings',
      rows: [{ field: 'date', bucket: 'week' }],
      values: m('made', 'cancelled', 'cancel_rate', 'no_shows', 'no_show_rate'),
      sort: [{ by: 'date:week', dir: 'asc' }],
      drill: { down: ['status', 'venue.name', { field: 'date', bucket: 'weekday' }, 'party_size'], rows: BOOKING_ROWS },
      view: { kind: 'line', x: 'date:week', y: ['cancel_rate', 'no_show_rate'] },
    },
  }),

  starter({
    key: 'bookings_lead_time',
    name: 'How far ahead people book',
    about: 'Bookings by how long before the day they were made, from the same day to more than two weeks ahead, with each band\'s share.',
    period: 'last_month',
    spec: {
      subject: 'bookings.bookings',
      rows: ['booked_ahead'],
      values: [...m('bookings', 'guests', 'average_lead'), share('bookings', 'Share of bookings')],
      drill: { down: ['venue.name', 'party_size', { field: 'date', bucket: 'weekday' }], rows: [...BOOKING_ROWS, 'created_at', 'lead_days'] },
      view: { kind: 'bar', x: 'booked_ahead', y: ['bookings'] },
    },
  }),

  starter({
    key: 'bookings_party_sizes',
    name: 'Party sizes',
    about: 'Bookings by the size of the party, with their guests and each size\'s share of bookings.',
    period: 'last_month',
    spec: {
      subject: 'bookings.bookings',
      rows: ['party_size'],
      values: [...m('bookings', 'guests'), share('bookings', 'Share of bookings')],
      drill: { down: ['venue.name', { field: 'date', bucket: 'weekday' }, { field: 'starts_at', bucket: 'hour' }], rows: BOOKING_ROWS },
      view: { kind: 'bar', x: 'party_size', y: ['bookings'] },
    },
  }),

  starter({
    key: 'bookings_deposits',
    name: 'Deposits taken and refunded',
    about: 'Deposits paid with online bookings, by the week each was paid: how many, what was taken, what was refunded and what was kept.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'bookings.deposits',
      rows: [{ field: 'date', bucket: 'week' }],
      values: m('deposits', 'taken', 'refunded_total', 'kept_total'),
      sort: [{ by: 'date:week', dir: 'asc' }],
      drill: { down: ['status', 'venue.name'], rows: ['date', 'reference', 'venue.name', 'status', 'amount', 'refunded', 'kept', 'paid_at', 'refunded_at'] },
    },
  }),

  starter({
    key: 'bookings_new_returning',
    name: 'New and returning guests',
    about: 'Bookings by whether the guest had booked before, with their guests and each kind\'s share. A booking with no customer record counts as not known.',
    period: 'last_month',
    spec: {
      subject: 'bookings.bookings',
      rows: ['guest_kind'],
      values: [...m('bookings', 'guests'), share('bookings', 'Share of bookings')],
      drill: { down: ['venue.name', 'source', { field: 'date', bucket: 'week' }], rows: BOOKING_ROWS },
      view: { kind: 'parts', x: 'guest_kind', y: ['bookings'] },
    },
  }),
]
