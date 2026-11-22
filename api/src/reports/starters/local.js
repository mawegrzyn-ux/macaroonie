// src/reports/starters/local.js
//
// Starter reports on local info: what the captures found and staff typed in
// around each venue. Weather forecasts are their own subject (local.weather),
// read beside sales in Sales against the weather.

import { starter, m } from './define.js'

export default [
  starter({
    key: 'local_coming_up',
    name: 'Local events and incidents coming up',
    about: 'Traffic, events and incidents around each venue over the next two weeks, soonest first, as on the Local info page: items someone hid are left out, and one for the whole group shows only with every venue picked.',
    period: { relative: 'next_n_days', n: 14 },
    spec: {
      subject: 'local.items',
      kind: 'list',
      rows: ['date', 'last_day', 'venue.name', 'kind', 'severity', 'title', 'place', 'time'],
      sort: [{ by: 'date', dir: 'asc' }],
    },
  }),

  starter({
    key: 'local_weather_by_hour',
    name: 'Weather by the hour',
    about: 'The temperature at each venue hour by hour across the days, as recorded once an hour has passed and forecast before: when it was warm, cold or wet. Change the value to rain, wind or wet hours.',
    period: { relative: 'last_n_days', n: 7 },
    spec: {
      subject: 'local.weather_hours',
      kind: 'matrix',
      rows: ['date'],
      columns: ['hour'],
      values: m('average_temp'),
      drill: { rows: ['date', 'hour', 'venue.name', 'conditions', 'temp', 'rain', 'chance_of_rain', 'wind', 'recorded'] },
      view: { kind: 'heat' },
    },
  }),
]
