// src/reports/starters/app.js
//
// Starter reports on running the app (docs/REPORTS.md Appendix B): the
// emails sent to guests, Pepper's use and the changes it made, the team's
// sign-ins and the issues the group logged. Pepper's usage runs on UTC days
// and months, as its allowance does; the team and the usage by month are as
// they are now, so they ask for no period. Only the emails belong to a venue.

import { starter, m } from './define.js'
import { ASSISTANT_NAME } from '../../../../shared/assistant.js'

/** Where these starters come in the list (index.js gathers this folder by it, then by file name). */
export const order = 150

export const starters = [
  starter({
    key: 'app_emails',
    name: 'Emails sent and failed',
    about: 'The emails sent to guests by kind (booking confirmations, reminders, changes, order emails): how many, how many went and how many failed or bounced. Emails that belong to no booking or order show only with every venue picked.',
    period: 'last_month',
    spec: {
      subject: 'bookings.emails',
      rows: ['type'],
      values: m('emails', 'sent', 'failed', 'failed_rate'),
      sort: [{ by: 'emails', dir: 'desc' }],
      drill: { down: ['status', 'provider', { field: 'date', bucket: 'week' }] },
    },
  }),

  starter({
    key: 'pepper_use_by_month',
    name: ASSISTANT_NAME + '\'s use by month',
    about: 'How much ' + ASSISTANT_NAME + ' was used each month (UTC): requests, the units the monthly allowance counts and web searches. Tap a month to see where: its chat, AI apps, the website chat.',
    period: false,
    venues: false,
    spec: {
      subject: 'pepper.usage',
      rows: [{ field: 'month', bucket: 'month' }],
      values: m('total_requests', 'total_units', 'total_searches', 'units_a_request'),
      sort: [{ by: 'month:month', dir: 'asc' }],
      drill: { down: ['channel'] },
      view: { kind: 'line', x: 'month:month', y: ['total_units'] },
    },
  }),

  starter({
    key: 'pepper_cost_by_model',
    name: ASSISTANT_NAME + '\'s cost by model',
    about: 'Each AI model ' + ASSISTANT_NAME + ' used: requests, tokens in and out a request, the estimated cost in dollars at its list prices, the cost of one request and how long one took. Tap a model to see what the requests were for.',
    period: 'last_month',
    venues: false,
    spec: {
      subject: 'pepper.requests',
      rows: ['model'],
      values: m('requests', 'input_a_request', 'output_a_request', 'total_cost', 'cost_a_request', 'average_time'),
      sort: [{ by: 'total_cost', dir: 'desc' }],
      drill: { down: ['use', 'channel', { field: 'date', bucket: 'week' }] },
    },
  }),

  starter({
    key: 'pepper_use_by_person',
    name: ASSISTANT_NAME + '\'s use by person',
    about: 'Each person\'s use of ' + ASSISTANT_NAME + '\'s chat: requests, the units their daily share counts, and on how many days (UTC) they used it.',
    period: 'last_month',
    venues: false,
    spec: {
      subject: 'pepper.people',
      rows: ['email'],
      values: m('total_requests', 'total_units', 'days', 'units_a_request'),
      sort: [{ by: 'total_units', dir: 'desc' }],
      drill: { down: [{ field: 'date', bucket: 'week' }] },
    },
  }),

  starter({
    key: 'pepper_changes',
    name: ASSISTANT_NAME + '\'s changes',
    about: 'The changes ' + ASSISTANT_NAME + ' made or tried to make, by what they were: how many, how many went through and how many people asked for them. What was asked and the answers aren\'t reported.',
    period: 'last_month',
    venues: false,
    spec: {
      subject: 'pepper.actions',
      rows: ['what'],
      values: m('changes', 'done', 'failed', 'done_rate', 'people'),
      sort: [{ by: 'changes', dir: 'desc' }],
      drill: { down: ['channel', 'who', { field: 'date', bucket: 'week' }] },
    },
  }),

  starter({
    key: 'group_team_sign_ins',
    name: 'Team sign-ins',
    about: 'Everyone active on the team with when they last signed in, those who never have first, then the longest since.',
    period: false,
    venues: false,
    spec: {
      subject: 'group.team',
      kind: 'list',
      rows: ['name', 'email', 'role.name', 'last_signed_in', 'days_since'],
      filters: [{ field: 'active', op: 'is', value: true }],
      sort: [{ by: 'signed_in', dir: 'asc' }, { by: 'last_signed_in', dir: 'asc' }],
    },
  }),

  starter({
    key: 'group_issues',
    name: 'Issues by priority',
    about: 'The issues the group logged, by priority: how many, how many are still open, how many were resolved and how long resolving one took on average.',
    period: { relative: 'last_n_days', n: 90 },
    venues: false,
    spec: {
      subject: 'group.issues',
      rows: ['priority'],
      values: m('issues', 'open_count', 'resolved_count', 'average_to_resolve'),
      sort: [{ by: 'priority', dir: 'asc' }],
      drill: { down: ['kind', 'status', { field: 'date', bucket: 'week' }] },
    },
  }),

  // The usage record (migration 270): the group's pages and menu searches,
  // with no person (each person's own is the subject My pages and searches).
  starter({
    key: 'usage_pages',
    name: 'Pages opened',
    about: 'Which pages of the app the group opens: times each page was opened and on how many days. Who opened them isn\'t reported.',
    period: { relative: 'last_n_days', n: 28 },
    venues: false,
    spec: {
      subject: 'usage.pages',
      rows: ['page'],
      values: m('opens', 'days'),
      sort: [{ by: 'opens', dir: 'desc' }],
      drill: { down: [{ field: 'date', bucket: 'week' }] },
    },
  }),

  starter({
    key: 'usage_searches',
    name: 'Menu searches by week',
    about: 'Week by week: searches in the menu box, how many were handed to ' + ASSISTANT_NAME + ' and their share, how many opened something and how many found no menu match. What was typed and who typed it aren\'t reported.',
    period: { relative: 'last_n_days', n: 84 },
    venues: false,
    spec: {
      subject: 'usage.searches',
      rows: [{ field: 'date', bucket: 'week' }],
      values: m('searches', 'handed', 'handed_share', 'opened_share', 'no_match'),
      sort: [{ by: 'date:week', dir: 'asc' }],
      drill: { down: ['opened', 'to_pepper'] },
      view: { kind: 'line', x: 'date:week', y: ['handed_share', 'opened_share'] },
    },
  }),
]
