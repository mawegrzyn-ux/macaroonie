// src/reports/starters/kitchen.js
//
// Starter reports on kitchen screens (docs/REPORTS.md 20, phase 3), by the
// Kitchen report's rules: a ticket is a bump that wasn't brought back, timed
// from reaching the station; on time and late by the station's own minutes.

import { starter, m, share } from './define.js'

const TICKET_ROWS = ['bumped_at', 'venue.name', 'station_name', 'order_number', 'order_type', 'dishes', 'ticket_time', 'on_time', 'late']

export default [
  starter({
    key: 'kitchen_ticket_times',
    name: 'Ticket times by station',
    about: 'Each kitchen station\'s tickets, how long they took on average and at the longest, and how many were on time or late by the station\'s own target and late minutes. Bumps brought back are left out.',
    period: 'last_week',
    spec: {
      subject: 'kitchen.tickets',
      rows: ['station_name'],
      values: m('tickets', 'dishes_total', 'average_time', 'longest', 'on_time_rate', 'late_count'),
      sort: [{ by: 'tickets', dir: 'desc' }],
      drill: { down: [{ field: 'bumped_at', bucket: 'hour' }, 'date', 'order_type', 'order_source'], rows: TICKET_ROWS },
      view: { kind: 'bar', x: 'station_name', y: ['average_time'], sideways: true },
    },
  }),

  starter({
    key: 'kitchen_times_by_hour',
    name: 'Ticket times by hour',
    about: 'The average ticket time at each station, hour by hour through the day: where the kitchen slows down.',
    period: 'last_week',
    spec: {
      subject: 'kitchen.tickets',
      kind: 'matrix',
      rows: [{ field: 'bumped_at', bucket: 'hour', label: 'Hour' }],
      columns: ['station_name'],
      values: m('average_time'),
      drill: { rows: TICKET_ROWS },
      view: { kind: 'heat' },
    },
  }),

  starter({
    key: 'kitchen_remakes',
    name: 'Remakes and why',
    about: 'Dishes the kitchen made again, by the reason given, with each reason\'s share of the remakes.',
    period: 'last_month',
    spec: {
      subject: 'kitchen.remakes',
      rows: ['reason'],
      values: [...m('remakes'), share('remakes', 'Share of remakes')],
      sort: [{ by: 'remakes', dir: 'desc' }],
      drill: { down: ['dish', 'station_name', { field: 'date', bucket: 'week' }], rows: ['remade_at', 'venue.name', 'station_name', 'dish', 'reason', 'order_number'] },
      view: { kind: 'bar', x: 'reason', y: ['remakes'], sideways: true },
    },
  }),
]
