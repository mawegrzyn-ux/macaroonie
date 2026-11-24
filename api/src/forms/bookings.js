// src/forms/bookings.js: the Bookings area's plain forms (src/forms/plain.js
// says what a definition holds), drawn from the route's own schema.

import { ExceptionBody } from '../routes/schedules.js'

export const forms = {
  closure: {
    schema: ExceptionBody,
    save: { method: 'POST', path: '/venues/:venue/schedule/exceptions' },
    saved: 'Added {name}, {date_from} to {date_to}',
    fields: {
      name:      { label: 'Name', help: 'What the dates are for, as staff see it.', examples: ['Christmas', 'Private event', 'Refurbishment'] },
      date_from: { label: 'From', help: 'The first day.' },
      date_to:   { label: 'To', help: 'The last day (the same day for one day).' },
      is_closed: { label: 'Closed to bookings', start: true, help: 'Off: the venue opens with other hours on these days, set on this page afterwards.' },
    },
    leave: {
      priority: 'Which of two overlapping exceptions wins: set on its card',
    },
  },
}
