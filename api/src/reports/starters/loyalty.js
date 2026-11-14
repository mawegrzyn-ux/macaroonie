// src/reports/starters/loyalty.js
//
// Starter reports on the loyalty programme (docs/REPORTS.md 20, phase 3).
// Members are the group's, not a venue's, so the members starter doesn't ask
// for venues. The points starters do, and say what a venue picked leaves
// out: staff changes, expired points and filled cards belong to no venue.

import { starter, m } from './define.js'

export default [
  starter({
    key: 'loyalty_members_joined',
    name: 'Members joined by week',
    about: 'People who joined the loyalty programme each week, and how many of them are members still (not closed or erased since).',
    period: { relative: 'last_n_days', n: 84 },
    venues: false,
    spec: {
      subject: 'loyalty.members',
      rows: [{ field: 'date', bucket: 'week' }],
      values: m('joined', 'members'),
      sort: [{ by: 'date:week', dir: 'asc' }],
      drill: { down: ['joined_through', 'joined_venue.name'], rows: ['joined_at', 'member_no', 'joined_through', 'joined_venue.name', 'status', 'points'] },
      view: { kind: 'bar', x: 'date:week', y: ['joined'] },
    },
  }),

  starter({
    key: 'loyalty_points',
    name: 'Points given and spent',
    about: 'Week by week: points members earned on sales, welcome points, points changed by staff, points spent on rewards, points that expired, and the change in the points members hold. A venue picked shows only what happened there: staff changes, expired points and anything done on the loyalty web app belong to no venue, so they show with every venue.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'loyalty.ledger',
      rows: [{ field: 'date', bucket: 'week' }],
      values: m('earned', 'welcome', 'adjusted', 'spent', 'expired', 'net'),
      sort: [{ by: 'date:week', dir: 'asc' }],
      drill: { down: ['kind', 'venue.name', 'channel'], rows: ['at', 'member.member_no', 'kind', 'points', 'venue.name', 'channel', 'note', 'by'] },
      view: { kind: 'line', x: 'date:week', y: ['earned', 'spent'] },
    },
  }),

  starter({
    key: 'loyalty_rewards_used',
    name: 'Rewards used',
    about: 'Each reward: how many times it was used, the points spent on it, the discount it gave, and how many were given back (taken off an order or never used).',
    period: 'last_month',
    spec: {
      subject: 'loyalty.redemptions',
      rows: ['name'],
      values: m('used', 'points_spent', 'discount_given', 'given_back'),
      sort: [{ by: 'used', dir: 'desc' }],
      drill: { down: ['venue.name', 'channel', { field: 'date', bucket: 'week' }], rows: ['held_at', 'name', 'member.member_no', 'venue.name', 'channel', 'status', 'points', 'discount'] },
    },
  }),

  starter({
    key: 'loyalty_stamp_cards',
    name: 'Stamp cards: stamps and cards filled',
    about: 'Each stamp card: the stamps members collected on it and the cards they filled. A venue picked shows the stamps collected there; a filled card belongs to no venue, so cards filled show with every venue.',
    period: 'last_month',
    spec: {
      subject: 'loyalty.ledger',
      rows: ['stamp_card.name'],
      values: m('stamps_given', 'cards_filled'),
      filters: [{ field: 'kind', op: 'in', value: ['stamps', 'card_full'] }],
      sort: [{ by: 'stamps_given', dir: 'desc' }],
      drill: { down: [{ field: 'date', bucket: 'week' }, 'venue.name'], rows: ['at', 'member.member_no', 'stamp_card.name', 'kind', 'stamps', 'venue.name'] },
    },
  }),
]
