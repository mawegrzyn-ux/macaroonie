// src/reports/starters/cash.js
//
// Starter reports on cash reconciliation (docs/REPORTS.md 20, phase 3b):
// each day's and week's variance by the Cash Recon page's own rule, what the
// payment channels took, expenses by category and the wage lists. A week's
// variance counts cash wages paid on no reported day once, in the week, so it
// can differ from its days' variances added up.

import { starter, m, share } from './define.js'

const DAY_ROWS = ['date', 'venue.name', 'status', 'income', 'takings', 'expenses', 'wages_paid', 'variance']
const WAGE_ROWS = ['date', 'venue.name', 'name', 'pay_type', 'hours', 'wage', 'bank', 'cash', 'unpaid', 'paid_on']

export default [
  starter({
    key: 'cash_variance_by_day',
    name: 'Cash variance by day',
    about: 'Each day\'s Cash Recon by the page\'s own rule: income, takings, cash paid out of the till, and the variance (counted less expected; a minus is short).',
    period: 'last_week',
    spec: {
      subject: 'cash.days',
      rows: ['date'],
      values: m('income_total', 'takings_total', 'expenses_total', 'wages_paid_total', 'variance_total'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['venue.name', 'status'], rows: DAY_ROWS },
      view: { kind: 'bar', x: 'date', y: ['variance_total'] },
    },
  }),

  starter({
    key: 'cash_variance_by_week',
    name: 'Cash variance by week',
    about: 'Each week\'s Cash Recon (Monday to Sunday): its days added up, the week\'s cash wages, and the variance, with cash wages paid on no reported day counted once in the week.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'cash.weeks',
      rows: ['date'],
      values: m('days_total', 'income_total', 'takings_total', 'expenses_total', 'cash_wages_total', 'variance_total'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['venue.name'], rows: ['date', 'venue.name', 'days', 'income', 'takings', 'expenses', 'cash_wages', 'wages_off_days', 'variance'] },
      view: { kind: 'bar', x: 'date', y: ['variance_total'] },
    },
  }),

  starter({
    key: 'cash_variance_by_venue',
    name: 'Cash variance by venue',
    about: 'Each venue\'s reported days: how many were short or over, what the short days and the over days came to, and the variance added up.',
    period: 'last_month',
    spec: {
      subject: 'cash.days',
      rows: ['venue.name'],
      values: m('days', 'days_short', 'days_over', 'shortfall', 'surplus', 'variance_total', 'average_variance'),
      sort: [{ by: 'variance_total', dir: 'asc' }],
      drill: { down: [{ field: 'date', bucket: 'week' }, 'status'], rows: DAY_ROWS },
    },
  }),

  starter({
    key: 'cash_days_short',
    name: 'Days the cash was short',
    about: 'Every reported day whose variance was a minus (counted less than expected), shortest first, with what was expected and counted.',
    period: 'last_month',
    spec: {
      subject: 'cash.days',
      kind: 'list',
      rows: ['date', 'venue.name', 'status', 'expected', 'counted', 'variance', 'submitted_by'],
      filters: [{ field: 'variance', op: 'lt', value: 0 }],
      sort: [{ by: 'variance', dir: 'asc' }],
    },
  }),

  starter({
    key: 'cash_income_against_takings',
    name: 'Income against takings',
    about: 'Income that counts in reconciliation beside what the payment channels took, day by day.',
    period: { relative: 'last_n_days', n: 28 },
    spec: {
      subject: 'cash.days',
      rows: ['date'],
      values: m('income_total', 'takings_total', 'service_charges_total'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['venue.name'], rows: DAY_ROWS },
      view: { kind: 'line', x: 'date', y: ['income_total', 'takings_total'] },
    },
  }),

  starter({
    key: 'cash_takings_by_channel',
    name: 'Takings by payment channel',
    about: 'What each payment channel took, how much of it counts as cash, and each channel\'s share of the takings. Channels switched off are left out.',
    period: 'last_month',
    spec: {
      subject: 'cash.takings',
      rows: ['channel.name'],
      values: [...m('takings_counted', 'cash_takings'), share('takings_counted', 'Share of takings')],
      filters: [{ field: 'counts', op: 'is', value: true }],
      sort: [{ by: 'takings_counted', dir: 'desc' }],
      drill: { down: [{ field: 'date', bucket: 'week' }, 'venue.name'] },
      view: { kind: 'parts', x: 'channel.name', y: ['takings_counted'] },
    },
  }),

  starter({
    key: 'cash_expenses_by_category',
    name: 'Expenses by category',
    about: 'Cash Recon expenses by category: how many, what came out of the till and what was paid by card, and the VAT on them.',
    period: 'last_month',
    spec: {
      subject: 'cash.expenses',
      rows: ['category_name'],
      values: m('count_all', 'cash_spend', 'card_spend', 'vat_total'),
      sort: [{ by: 'cash_spend', dir: 'desc' }],
      drill: { down: ['description', 'venue.name', { field: 'date', bucket: 'week' }] },
      view: { kind: 'bar', x: 'category_name', y: ['cash_spend', 'card_spend'], stacked: true, sideways: true },
    },
  }),

  starter({
    key: 'cash_wages_by_week',
    name: 'Wages by week',
    about: 'Each week\'s wage lists: wages, what was paid by bank and in cash, and what is still to pay (what isn\'t paid by bank is due in cash).',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'cash.wages',
      rows: ['date'],
      values: m('people', 'hours_total', 'wages_total', 'bank_total', 'cash_total', 'unpaid_total'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['name', 'venue.name'], rows: WAGE_ROWS },
      view: { kind: 'bar', x: 'date', y: ['bank_total', 'cash_total', 'unpaid_total'], stacked: true },
    },
  }),
]
