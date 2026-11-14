// src/reports/starters/guests.js
//
// Starter reports on guests (docs/REPORTS.md Appendix B): newsletter
// sign-ups and reviews. Customers are the group's, not a venue's, so the
// newsletter report asks for no venues; a review is on the day it was written.

import { starter, m } from './define.js'

export default [
  starter({
    key: 'guests_newsletter_signups',
    name: 'Newsletter sign-ups by month',
    about: 'Customers by the month they last joined the newsletter, and how many of them are still on it. Customers anonymised since aren\'t counted.',
    period: false,
    venues: false,
    spec: {
      subject: 'guests.customers',
      rows: [{ field: 'newsletter_since', bucket: 'month', label: 'Month joined' }],
      values: [{ measure: 'customers', label: 'Joined' }, { measure: 'subscribers', label: 'Still on the newsletter' }],
      filters: [{ field: 'newsletter_since', op: 'not_empty' }],
      sort: [{ by: 'newsletter_since:month', dir: 'asc' }],
      drill: { down: ['newsletter_source'] },
      view: { kind: 'bar', x: 'newsletter_since:month', y: ['customers'] },
    },
  }),

  starter({
    key: 'guests_reviews_by_month',
    name: 'Reviews by rating, site and month',
    about: 'Reviews by the month they were written and the site they are on: how many, their average stars, the five-star ones, the ones of 1 or 2 stars, and how many were replied to.',
    period: { relative: 'last_n_days', n: 365 },
    spec: {
      subject: 'website.reviews',
      rows: [{ field: 'date', bucket: 'month' }, 'site'],
      values: m('reviews', 'average_rating', 'five_stars', 'low_ratings', 'replied_to'),
      totals: { subtotals: ['date:month'] },
      sort: [{ by: 'date:month', dir: 'asc' }],
      drill: { down: ['rating', 'venue.name'] },
      view: { kind: 'bar', x: 'date:month', y: ['reviews'], stacked: true },
    },
  }),
]
