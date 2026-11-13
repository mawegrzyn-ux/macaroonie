// src/reports/starters/online.js
//
// Starter reports on online orders (docs/REPORTS.md Appendix B). An order
// counts as a sale unless it was rejected or cancelled, as the Online
// orders report and its Transactions tab count them.

import { starter, m } from './define.js'

const COUNTED = { field: 'counted', op: 'is', value: true }
const ORDER_COUNTED = { field: 'order.counted', op: 'is', value: true }
const ORDER_ROWS = ['date', 'number', 'venue.name', 'status', 'fulfilment', 'tender', 'total', 'refunded', 'placed_at']

export default [
  starter({
    key: 'online_by_day_channel',
    name: 'Online orders and sales by day and channel',
    about: 'Orders that count as sales, day by day, with a pair of columns for each way they were ordered: how many, and what they came to.',
    period: { relative: 'last_n_days', n: 28 },
    spec: {
      subject: 'online.orders',
      kind: 'matrix',
      rows: ['date'],
      columns: ['channel'],
      values: m('orders', 'sales'),
      filters: [COUNTED],
      drill: { rows: ORDER_ROWS },
    },
  }),

  starter({
    key: 'online_top_dishes',
    name: 'Top dishes online',
    about: 'The dishes ordered online most, on orders that count as sales: quantity, sales before and after discounts, and how many orders had them.',
    spec: {
      subject: 'online.items',
      rows: ['name'],
      values: m('qty_sold', 'gross_sales', 'discounts', 'net_sales', 'orders'),
      filters: [ORDER_COUNTED],
      sort: [{ by: 'qty_sold', dir: 'desc' }],
      limit: { top: 25, rest_as: 'Every other dish' },
      drill: { down: ['date', 'venue.name'], rows: ['date', 'order.number', 'name', 'qty', 'line_total', 'discount', 'note'] },
      view: { kind: 'bar', x: 'name', y: ['qty_sold'], sideways: true },
    },
  }),

  starter({
    key: 'online_promotions',
    name: 'Promotions used online',
    about: 'Each promotion and automatic meal deal used on online orders that count as sales: how often, on how many orders, and the discount it gave.',
    spec: {
      subject: 'online.promotions',
      rows: ['name', 'kind', 'code'],
      values: m('times_used', 'orders', 'discount_given'),
      filters: [ORDER_COUNTED],
      sort: [{ by: 'discount_given', dir: 'desc' }],
      drill: { down: ['date', 'venue.name'], rows: ['date', 'order.number', 'name', 'kind', 'code', 'discount'] },
    },
  }),

  starter({
    key: 'online_times',
    name: 'Online orders: time to accept and to get ready',
    about: 'How long orders waited to be accepted, and how long from accepted to ready, on average for each day.',
    period: { relative: 'last_n_days', n: 28 },
    spec: {
      subject: 'online.orders',
      rows: ['date'],
      values: m('orders', 'average_accept', 'average_ready'),
      filters: [COUNTED],
      sort: [{ by: 'date', dir: 'asc' }],
      drill: {
        down: ['venue.name', { field: 'placed_at', bucket: 'hour' }],
        rows: ['date', 'number', 'venue.name', 'placed_at', 'accepted_at', 'ready_at', 'time_to_accept', 'time_to_ready', 'time_to_collect'],
      },
      view: { kind: 'line', x: 'date', y: ['average_accept', 'average_ready'] },
    },
  }),

  starter({
    key: 'online_refunds',
    name: 'Online refunds',
    about: 'Every online order with money refunded: what it came to, what went back, and what was kept.',
    period: { relative: 'last_n_days', n: 28 },
    spec: {
      subject: 'online.orders',
      kind: 'list',
      rows: ['date', 'number', 'venue.name', 'status', 'tender', 'total', 'refunded', 'net', 'cancel_reason'],
      filters: [{ field: 'refunded', op: 'gt', value: 0 }],
      sort: [{ by: 'date', dir: 'desc' }],
    },
  }),

  starter({
    key: 'online_sources',
    name: 'GloriaFood beside your own ordering',
    about: 'Online sales week by week from your own ordering page and from GloriaFood, side by side: orders that count, and what they came to.',
    period: { relative: 'last_n_days', n: 84 },
    spec: {
      subject: 'online.sales',
      kind: 'matrix',
      rows: [{ field: 'date', bucket: 'week' }],
      columns: ['source'],
      values: m('orders', 'sales'),
      filters: [COUNTED],
      drill: { rows: ['date', 'at', 'source', 'number', 'type', 'status', 'tender', 'total', 'refunded', 'net'] },
    },
  }),
]
