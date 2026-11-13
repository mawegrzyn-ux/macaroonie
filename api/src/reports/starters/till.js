// src/reports/starters/till.js
//
// Starter reports on till sales (docs/REPORTS.md Appendix B). Sales figures
// count closed checks, as the till's own X and Z reports do: each report
// that adds them up leaves open, cancelled and merged checks out of its rows
// too, so no row is all noughts.

import { starter, m, share } from './define.js'

const CLOSED = { field: 'status', op: 'is', value: 'closed' }
const ON_CLOSED = { field: 'check.status', op: 'is', value: 'closed' }
const CHECK_ROWS = ['number', 'date', 'venue.name', 'mode', 'server.name', 'order_type.name', 'covers', 'net', 'service_charge', 'total']
const LINE_ROWS = ['date', 'check.number', 'name', 'qty', 'gross', 'discount', 'net', 'section.name', 'check.server.name']

export default [
  starter({
    key: 'till_sales_by_day',
    name: 'Sales by day',
    about: 'Each trading day\'s closed checks: guests, gross and net sales, discounts, charges, the total and VAT.',
    period: { relative: 'last_n_days', n: 28 },
    spec: {
      subject: 'till.checks',
      rows: ['date'],
      values: m('checks', 'guests', 'gross_sales', 'discounts', 'net_sales', 'charges', 'total_sales', 'vat_total', 'average_check'),
      filters: [CLOSED],
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['venue.name', 'server.name', 'order_type.name', 'stream.name'], rows: CHECK_ROWS },
      view: { kind: 'bar', x: 'date', y: ['net_sales'] },
    },
  }),

  starter({
    key: 'till_sales_by_hour_weekday',
    name: 'Sales by hour and weekday',
    about: 'Net sales of closed checks by the hour each check was opened, across the days of the week: when the venue is busiest.',
    period: { relative: 'last_n_days', n: 28 },
    spec: {
      subject: 'till.checks',
      kind: 'matrix',
      rows: [{ field: 'opened_at', bucket: 'hour', label: 'Hour opened' }],
      columns: [{ field: 'date', bucket: 'weekday' }],
      values: m('net_sales'),
      filters: [CLOSED],
      drill: { rows: CHECK_ROWS },
      view: { kind: 'heat' },
    },
  }),

  starter({
    key: 'till_sales_by_dish',
    name: 'Sales by dish',
    about: 'Dishes sold on closed checks, best seller first: quantity, sales before and after discounts, the average price and each dish\'s share of net sales.',
    spec: {
      subject: 'till.lines',
      rows: ['name'],
      values: [...m('qty_sold', 'gross_sales', 'discounts', 'net_sales', 'average_price'), share('net_sales', 'Share of net sales')],
      sort: [{ by: 'net_sales', dir: 'desc' }],
      limit: { top: 50, rest_as: 'Every other dish' },
      drill: { down: ['section.name', 'date', 'check.server.name', 'venue.name'], rows: LINE_ROWS },
      view: { kind: 'bar', x: 'name', y: ['net_sales'], sideways: true },
    },
  }),

  starter({
    key: 'till_sales_by_section',
    name: 'Sales by section',
    about: 'Dishes sold on closed checks by menu section, with each section\'s share of net sales. Open a section to see its dishes.',
    spec: {
      subject: 'till.lines',
      rows: ['section.name'],
      values: [...m('qty_sold', 'gross_sales', 'discounts', 'net_sales'), share('net_sales', 'Share of net sales')],
      sort: [{ by: 'net_sales', dir: 'desc' }],
      drill: { down: ['name', 'date', 'venue.name'], rows: LINE_ROWS },
      view: { kind: 'pie', x: 'section.name', y: ['net_sales'] },
    },
  }),

  starter({
    key: 'till_sales_by_server',
    name: 'Sales by server',
    about: 'Closed checks by the person (or kiosk) who served them: checks, guests, net sales, charges, the total, and the average per check and per guest.',
    spec: {
      subject: 'till.checks',
      rows: ['server.name'],
      values: m('checks', 'guests', 'net_sales', 'charges', 'total_sales', 'average_check', 'per_guest'),
      filters: [CLOSED],
      sort: [{ by: 'net_sales', dir: 'desc' }],
      drill: { down: ['date', 'order_type.name', 'venue.name'], rows: CHECK_ROWS },
    },
  }),

  starter({
    key: 'till_sales_by_type_stream',
    name: 'Sales by order type and revenue stream',
    about: 'Closed checks by order type (eat in, take out, delivery) and, within each, by revenue stream.',
    spec: {
      subject: 'till.checks',
      rows: ['order_type.name', 'stream.name'],
      values: m('checks', 'guests', 'net_sales', 'charges', 'total_sales', 'average_check'),
      filters: [CLOSED],
      totals: { subtotals: ['order_type.name'] },
      drill: { down: ['date', 'server.name', 'venue.name'], rows: CHECK_ROWS },
    },
  }),

  starter({
    key: 'till_payments_by_tender',
    name: 'Payments by tender',
    about: 'What was taken by cash, each kind of card, vouchers and accounts: payments, tips, refunds, and takings (payments and tips less refunds).',
    spec: {
      subject: 'till.payments',
      rows: ['tender'],
      values: m('payments', 'taken', 'tips', 'refunds', 'refunded', 'takings'),
      sort: [{ by: 'takings', dir: 'desc' }],
      drill: { down: ['date', 'staff.name', 'venue.name'], rows: ['date', 'at', 'check.number', 'kind', 'tender', 'amount', 'tip', 'staff.name', 'reason'] },
    },
  }),

  starter({
    key: 'till_discounts',
    name: 'Discounts and comps, by whom and why',
    about: 'Discounts, comps, promotions, meal deal savings and loyalty rewards on closed checks: who gave them, what kind, and the reason written down.',
    spec: {
      subject: 'till.discounts',
      rows: ['applied_by.name', 'kind', 'reason'],
      values: m('times_given', 'amount_given'),
      filters: [ON_CLOSED],
      totals: { subtotals: ['applied_by.name'] },
      drill: { down: ['name', 'approved_by.name', 'date'], rows: ['date', 'check.number', 'kind', 'name', 'amount', 'reason', 'applied_by.name', 'approved_by.name'] },
    },
  }),

  starter({
    key: 'till_voids',
    name: 'Voids, by whom and why',
    about: 'Dishes voided after they were sent to the kitchen, counted on the day they were voided: who voided them, the reason, how many and what they were worth.',
    spec: {
      subject: 'till.voids',
      rows: ['voided_by.name', 'reason'],
      values: m('voids', 'qty_voided', 'value_voided'),
      totals: { subtotals: ['voided_by.name'] },
      drill: { down: ['name', 'approved_by.name', 'date', 'wasted'], rows: ['date', 'check.number', 'name', 'qty', 'value', 'reason', 'wasted', 'voided_by.name', 'approved_by.name'] },
    },
  }),

  starter({
    key: 'till_cancelled',
    name: 'Cancelled orders, by whom and why',
    about: 'Whole orders cancelled on the till, counted on the day they were cancelled: who cancelled them, the reason, and what they were worth.',
    spec: {
      subject: 'till.cancelled',
      rows: ['cancelled_by.name', 'reason'],
      values: m('cancelled', 'value_cancelled'),
      totals: { subtotals: ['cancelled_by.name'] },
      drill: { down: ['approved_by.name', 'date', 'mode'], rows: ['date', 'number', 'mode', 'value', 'reason', 'cancelled_by.name', 'approved_by.name'] },
    },
  }),

  starter({
    key: 'till_charges',
    name: 'Charges added and taken off',
    about: 'Service charges, deposits and other charges on closed checks, by name: how often each was charged and for how much, and how often it was taken off.',
    spec: {
      subject: 'till.charges',
      rows: ['name'],
      values: m('times_charged', 'amount_charged', 'times_removed', 'amount_removed'),
      filters: [ON_CLOSED],
      sort: [{ by: 'amount_charged', dir: 'desc' }],
      drill: { down: ['date', 'remove_reason', 'removed_by.name'], rows: ['date', 'check.number', 'name', 'amount', 'removed', 'remove_reason', 'removed_by.name'] },
    },
  }),

  starter({
    key: 'till_tips',
    name: 'Tips, by who took the payment',
    about: 'Tips added to till payments, by the person who took the payment, with tips as a share of what they took.',
    spec: {
      subject: 'till.payments',
      rows: ['staff.name'],
      values: [...m('payments', 'taken', 'tips'), { key: 'tip_rate', calc: 'tips / taken', label: 'Tips as a share', format: 'percent', decimals: 1 }],
      filters: [{ field: 'kind', op: 'is', value: 'payment' }, { field: 'voided', op: 'is', value: false }],
      sort: [{ by: 'tips', dir: 'desc' }],
      drill: { down: ['tender', 'date'], rows: ['date', 'at', 'check.number', 'tender', 'amount', 'tip', 'staff.name'] },
    },
  }),

  starter({
    key: 'till_average_spend',
    name: 'Average spend per check and per guest',
    about: 'What a closed check and a guest came to on average at each venue, against the period before.',
    spec: {
      subject: 'till.checks',
      rows: ['venue.name'],
      values: m('average_check', 'per_guest'),
      filters: [CLOSED],
      compare: { with: 'previous_period' },
      drill: { down: ['order_type.name', 'date', 'server.name'], rows: CHECK_ROWS },
    },
  }),

  starter({
    key: 'till_vat_by_rate',
    name: 'VAT by rate',
    about: 'Sales on closed checks at each VAT rate: the amount without VAT, the VAT, and the two together. Charges are included at their own rates.',
    spec: {
      subject: 'till.vat',
      rows: ['rate'],
      values: m('net_of_vat', 'vat_total', 'with_vat'),
      filters: [ON_CLOSED],
      sort: [{ by: 'rate', dir: 'desc' }],
      drill: { down: ['date', 'venue.name'], rows: ['date', 'check.number', 'rate', 'net', 'vat', 'gross'] },
    },
  }),

  starter({
    key: 'till_trading_days',
    name: 'Trading days: cash counted against expected',
    about: 'Every trading day that has been closed: its Z number, the cash the till expected, the cash counted, and how far over or short it was.',
    period: { relative: 'last_n_days', n: 28 },
    spec: {
      subject: 'till.days',
      kind: 'list',
      rows: ['date', 'venue.name', 'z_number', 'cash_expected', 'cash_counted', 'cash_difference', 'closed_by.name', 'notes'],
      filters: [{ field: 'closed', op: 'is', value: true }],
      sort: [{ by: 'date', dir: 'desc' }],
    },
  }),
]
