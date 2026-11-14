// src/reports/starters/staff.js
//
// Starter reports on staff and the rota (docs/REPORTS.md 20, phase 3b):
// hours, pay and tips as the Rota page works them out, time off, the tip
// pots, and rota pay beside the Cash Recon wage list. Pay belongs to a week:
// day-by-day reports show hours, never pay.
//
// Every starter keeps a figure a role with only Rota can see (hours), so
// someone without Rota pay or Rota tips gets the hours with notes saying
// what is left out, never a refusal.

import { starter, m } from './define.js'

const WEEK_ROWS = ['date', 'venue.name', 'name', 'role', 'hours', 'paid_hours', 'pay', 'tip_share']
const DAY_ROWS = ['date', 'venue.name', 'person.name', 'kind', 'hours', 'time_off_hours']

export default [
  starter({
    key: 'rota_hours_pay_by_person',
    name: 'Hours and pay by person',
    about: 'Each person\'s hours on the rota, hours paid, pay and tips, worked out as the Rota page works them out.',
    period: 'last_week',
    spec: {
      subject: 'rota.staff_weeks',
      rows: ['name'],
      values: m('hours_total', 'paid_hours_total', 'pay_total', 'tip_share_total'),
      sort: [{ by: 'name', dir: 'asc' }],
      drill: { down: [{ field: 'date', bucket: 'week' }, 'venue.name'], rows: WEEK_ROWS },
    },
  }),

  starter({
    key: 'rota_pay_by_week',
    name: 'Rota pay by week',
    about: 'Each week\'s hours and pay at the venues (Monday to Sunday), with what is paid by bank and what in cash.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'rota.weeks',
      rows: ['date'],
      values: m('hours_total', 'paid_hours_total', 'pay_total', 'pay_bank_total', 'pay_cash_total'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['venue.name'], rows: ['date', 'venue.name', 'people', 'hours', 'paid_hours', 'pay', 'pay_bank', 'pay_cash'] },
      view: { kind: 'bar', x: 'date', y: ['pay_bank_total', 'pay_cash_total'], stacked: true },
    },
  }),

  starter({
    key: 'rota_hours_by_day',
    name: 'Hours on the rota by day',
    about: 'Hours worked each day, how many people worked, and hours of time off. Pay belongs to the week, so it isn\'t split into days.',
    period: 'last_week',
    spec: {
      subject: 'rota.days',
      rows: ['date'],
      values: m('hours_total', 'days_worked', 'time_off_hours_total'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['person.name', 'venue.name'], rows: DAY_ROWS },
      view: { kind: 'bar', x: 'date', y: ['hours_total'] },
    },
  }),

  starter({
    key: 'rota_time_off_by_person',
    name: 'Time off by person',
    about: 'Days and hours each person was off sick, on paid or unpaid time off, or absent, from the rota.',
    period: 'last_month',
    spec: {
      subject: 'rota.days',
      rows: ['person.name'],
      values: m('sick_days', 'pto_days', 'uto_days', 'abs_days', 'time_off_hours_total'),
      filters: [{ field: 'time_off_hours', op: 'gt', value: 0 }],
      sort: [{ by: 'time_off_hours_total', dir: 'desc' }],
      drill: { down: ['kind', { field: 'date', bucket: 'week' }], rows: DAY_ROWS },
    },
  }),

  starter({
    key: 'rota_tips_by_person_pot',
    name: 'Tips by person and pot',
    about: 'Each person\'s share of each tip pot, with a column for every pot (before tips moved, adjusted or tapped on the Rota page).',
    period: 'last_week',
    spec: {
      subject: 'rota.tip_shares',
      kind: 'matrix',
      rows: ['person.name'],
      columns: ['pot.name'],
      values: m('share_total'),
      drill: { rows: ['date', 'venue.name', 'person.name', 'pot.name', 'share'] },
    },
  }),

  starter({
    key: 'rota_tip_pots_by_week',
    name: 'Tip pots by week',
    about: 'What went into the tip pots each week, what their surcharges took off, what was shared and what the house kept.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'rota.pot_weeks',
      rows: ['date'],
      values: m('gross_total', 'surcharge_total', 'to_share_total', 'distributed_total', 'kept_by_house_total'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['name', 'venue.name'], rows: ['date', 'venue.name', 'name', 'gross', 'surcharge', 'total', 'distributed', 'kept_by_house'] },
      view: { kind: 'bar', x: 'date', y: ['to_share_total'] },
    },
  }),

  starter({
    key: 'rota_pay_against_wages',
    name: 'Rota pay against the wage list',
    about: 'What the rota says each week\'s pay comes to beside the Cash Recon wage list, and the difference: a week someone forgot to fill the wages from the rota stands out.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'rota.staff_weeks',
      rows: ['date'],
      values: [
        ...m('hours_total', 'pay_total', 'wage_total', 'wage_unpaid_total'),
        { key: 'wage_less_pay', calc: 'wage_total - pay_total', label: 'Wage list less rota pay', format: 'money' },
      ],
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['name', 'venue.name'], rows: ['date', 'venue.name', 'name', 'hours', 'pay', 'on_wage_list', 'wage', 'wage_unpaid'] },
    },
  }),

  // The till's net sales beside the rota's weeks (phase 3c): counted on
  // their own and lined up by week.
  starter({
    key: 'rota_labour_against_sales',
    name: 'Labour against sales by week',
    about: 'Each week\'s hours and pay on the rota beside the till\'s net sales that week, with pay as a share of net sales and net sales for each hour worked.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'rota.weeks',
      rows: ['date'],
      also: [{ key: 'till', subject: 'till.checks', label: 'Till', filters: [{ field: 'status', op: 'is', value: 'closed' }] }],
      values: [
        ...m('hours_total', 'pay_total'),
        { key: 'net_sales', measure: 'net_sales', from: 'till' },
        { key: 'pay_share', calc: 'pay_total / net_sales', label: 'Pay as a share of net sales', format: 'percent', decimals: 1 },
        { key: 'sales_per_hour', calc: 'net_sales / hours_total', label: 'Net sales per hour worked', format: 'money' },
      ],
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['venue.name'] },
      view: { kind: 'line', x: 'date', y: ['net_sales', 'pay_total'] },
    },
  }),
]
