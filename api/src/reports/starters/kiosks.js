// src/reports/starters/kiosks.js
//
// Starter reports on self-order kiosk visits (docs/REPORTS.md 20, phase 3),
// by Kiosk analytics' own rules: a visit ordered when it ended with an
// order; one that didn't gave up on the screen it ended on.

import { starter, m, share } from './define.js'

const VISIT_ROWS = ['started_at', 'venue.name', 'kiosk.name', 'outcome', 'furthest', 'last_screen', 'length', 'basket_value', 'total']

export default [
  starter({
    key: 'kiosks_visits_by_day',
    name: 'Kiosk visits and orders by day',
    about: 'Visits to the self-order kiosks each day: how many ordered and what they spent, and how many gave up and what they left in their baskets.',
    period: 'last_week',
    spec: {
      subject: 'kiosks.visits',
      rows: ['date'],
      values: m('visits', 'orders', 'conversion', 'sales', 'average_order', 'gave_up', 'left_in_baskets'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['kiosk.name', { field: 'started_at', bucket: 'hour' }, 'design.name'], rows: VISIT_ROWS },
      view: { kind: 'bar', x: 'date', y: ['visits', 'orders'] },
    },
  }),

  starter({
    key: 'kiosks_gave_up',
    name: 'Where kiosk guests gave up',
    about: 'Visits that ended without an order, by the screen they ended on, with what was left in their baskets and how many left without opening a dish.',
    period: 'last_month',
    spec: {
      subject: 'kiosks.visits',
      rows: ['last_screen'],
      values: [...m('gave_up', 'left_in_baskets', 'bounced'), share('gave_up', 'Share of visits that gave up')],
      filters: [{ field: 'outcome', op: 'is_not', value: 'ordered' }],
      sort: [{ by: 'gave_up', dir: 'desc' }],
      drill: { down: ['outcome', 'kiosk.name', { field: 'date', bucket: 'week' }], rows: VISIT_ROWS },
      view: { kind: 'bar', x: 'last_screen', y: ['gave_up'], sideways: true },
    },
  }),
]
