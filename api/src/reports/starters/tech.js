// src/reports/starters/tech.js
//
// Starter reports on the venue's kit (Store tech): card machines, printers
// and menu screens. Card machine payments are on the day they started,
// tickets on the day they were queued. A screen's Online now is as at the
// moment the report runs.

import { starter, m } from './define.js'

export default [
  starter({
    key: 'tech_card_machines',
    name: 'Card machine payments by machine',
    about: 'Each card machine\'s payments: how many were tried, approved and declined, what was taken, and how long a payment took on average. A payment still waiting or one that never finished counts as tried.',
    spec: {
      subject: 'till.card_payments',
      rows: ['reader.name'],
      values: m('attempts', 'approved', 'declined', 'approval_rate', 'taken', 'average_time'),
      sort: [{ by: 'attempts', dir: 'desc' }],
      drill: { down: ['status', 'device.name', 'date'] },
    },
  }),

  starter({
    key: 'tech_printing',
    name: 'Tickets printed by printer',
    about: 'Each printer\'s tickets (kitchen tickets, bills and receipts): how many were queued, printed and failed, how many are still waiting, and how long one waited to print on average.',
    spec: {
      subject: 'till.print_jobs',
      rows: ['printer.name'],
      values: m('jobs', 'printed', 'failed', 'waiting', 'average_wait'),
      sort: [{ by: 'jobs', dir: 'desc' }],
      drill: { down: ['kind', 'status', 'date'] },
    },
  }),

  starter({
    key: 'tech_screens_offline',
    name: 'Menu screens offline',
    about: 'Every menu screen that isn\'t connected now, with what it should be showing and when it was last seen. A screen that has never connected is listed with no last seen.',
    period: false,
    spec: {
      subject: 'screens.screens',
      kind: 'list',
      rows: ['venue.name', 'name', 'code', 'shows', 'last_seen_at'],
      filters: [{ field: 'online', op: 'is', value: false }],
      sort: [{ by: 'venue.name', dir: 'asc' }, { by: 'name', dir: 'asc' }],
    },
  }),
]
