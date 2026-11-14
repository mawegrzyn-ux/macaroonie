// src/reports/starters/purchasing.js
//
// Starter reports on purchasing (docs/REPORTS.md 20, phase 3): what was
// spent with each supplier and on what, how deliveries came, invoices
// against the prices ordered at, price changes and what is out of stock.
// Spend leaves out cancelled orders and counts deliveries booked in without
// an order. Money needs Purchasing setup: people without it see the counts,
// with a note saying what was left out.

import { starter, m, share } from './define.js'

const ORDER_ROWS = ['date', 'number', 'venue.name', 'supplier.name', 'status', 'total_value']
const LINE_ROWS = ['date', 'order.number', 'order.supplier.name', 'item_name', 'pack_label', 'qty', 'received_qty', 'receive_status', 'receive_note']

export default [
  starter({
    key: 'purchasing_spend_by_supplier',
    name: 'Spend by supplier',
    about: 'Each supplier\'s orders and what they came to: goods, VAT and delivery charges, with each supplier\'s share of the spend. Cancelled orders are left out; deliveries booked in without an order count.',
    period: 'last_month',
    spec: {
      subject: 'purchasing.orders',
      rows: ['supplier.name'],
      values: [...m('orders', 'goods', 'vat', 'delivery_charges', 'spend'), share('spend', 'Share of spend')],
      sort: [{ by: 'spend', dir: 'desc' }],
      drill: { down: [{ field: 'date', bucket: 'week' }, 'venue.name', 'status'], rows: ORDER_ROWS },
      view: { kind: 'bar', x: 'supplier.name', y: ['spend'], sideways: true },
    },
  }),

  starter({
    key: 'purchasing_spend_by_month',
    name: 'Spend by month',
    about: 'Supplier orders month by month this year, and what they came to before and after VAT and delivery charges. Cancelled orders are left out.',
    period: 'year_to_date',
    spec: {
      subject: 'purchasing.orders',
      rows: [{ field: 'date', bucket: 'month' }],
      values: m('orders', 'goods', 'spend'),
      sort: [{ by: 'date:month', dir: 'asc' }],
      drill: { down: ['supplier.name', 'venue.name'], rows: ORDER_ROWS },
      view: { kind: 'bar', x: 'date:month', y: ['spend'] },
    },
  }),

  starter({
    key: 'purchasing_spend_by_category',
    name: 'Spend by category',
    about: 'What was ordered by inventory category: lines, packs, goods and spend with VAT (delivery charges are on the orders, not the lines), with each category\'s share. Lines on cancelled orders are left out.',
    period: 'last_month',
    spec: {
      subject: 'purchasing.order_lines',
      rows: ['category_name'],
      values: [...m('lines', 'packs', 'goods', 'spend'), share('spend', 'Share of spend')],
      sort: [{ by: 'spend', dir: 'desc' }],
      drill: { down: ['item_name', 'order.supplier.name', 'venue.name'], rows: LINE_ROWS },
      view: { kind: 'parts', x: 'category_name', y: ['spend'] },
    },
  }),

  starter({
    key: 'purchasing_delivery_problems',
    name: 'Delivery problems by supplier',
    about: 'Lines each supplier delivered short, damaged or missing, or with something else in their place, beside every line ordered from them.',
    period: 'last_month',
    spec: {
      subject: 'purchasing.order_lines',
      rows: ['order.supplier.name'],
      values: [
        ...m('lines', 'problems'),
        { key: 'problem_rate', calc: 'problems / lines', label: 'Lines with a problem (%)', format: 'percent', decimals: 1 },
        ...m('short', 'damaged', 'missing', 'substituted'),
      ],
      sort: [{ by: 'problems', dir: 'desc' }],
      drill: { down: ['item_name', { field: 'date', bucket: 'week' }, 'venue.name'], rows: LINE_ROWS },
    },
  }),

  starter({
    key: 'purchasing_orders_sent_late',
    name: 'Orders sent late',
    about: 'Each supplier\'s orders for delivery in the period and how many went after the order deadline for their delivery day (the supplier\'s cutoff and days\' notice for the venue), judged when each order first went. Orders the supplier agreed to take late count as late; cancelled orders and deliveries booked in without an order are left out.',
    period: 'last_month',
    spec: {
      subject: 'purchasing.orders',
      rows: ['supplier.name'],
      values: m('sent_orders', 'sent_late_count', 'late_rate', 'average_late_by'),
      sort: [{ by: 'sent_late_count', dir: 'desc' }],
      drill: {
        down: ['venue.name', { field: 'date', bucket: 'week' }, 'sent_by'],
        rows: ['date', 'number', 'venue.name', 'supplier.name', 'deadline_at', 'first_sent_at', 'late_by', 'sent_by', 'sent_via'],
      },
    },
  }),

  starter({
    key: 'purchasing_invoice_prices',
    name: 'Invoices above the price ordered',
    about: 'Each supplier\'s lines whose invoice price per pack was above the price they were ordered at, and what the invoices came to over the orders. Needs Purchasing setup to see prices.',
    period: 'last_month',
    spec: {
      subject: 'purchasing.order_lines',
      rows: ['order.supplier.name'],
      values: m('lines', 'charged_more', 'invoice_difference'),
      sort: [{ by: 'charged_more', dir: 'desc' }],
      drill: { down: ['item_name', 'order.number'], rows: ['date', 'order.number', 'order.supplier.name', 'item_name', 'pack_label', 'qty', 'price', 'invoice_price', 'price_difference'] },
    },
  }),

  starter({
    key: 'purchasing_price_changes',
    name: 'Price changes',
    about: 'Every supplier price set in the period, with the price before it for the same venue (or for every venue), how much it changed and whether it was typed in, imported or taken from an invoice. A venue picked shows the prices set for that venue alone.',
    period: 'last_month',
    spec: {
      subject: 'purchasing.price_changes',
      kind: 'list',
      rows: ['date', 'price_row.product', 'price_row.supplier.name', 'venue.name', 'previous_price', 'price', 'change', 'change_rate', 'source', 'changed_by'],
      sort: [{ by: 'date', dir: 'desc' }],
    },
  }),

  starter({
    key: 'purchasing_out_of_stock',
    name: 'Products out of stock',
    about: 'Supplier prices in use that are marked out of stock today: the product, the supplier, when it is back and the note left.',
    period: false,
    venues: false,
    spec: {
      subject: 'purchasing.prices',
      kind: 'list',
      rows: ['product', 'supplier.name', 'pack_name', 'supplier_code', 'out_of_stock_until', 'out_of_stock_note', 'out_of_stock_by'],
      filters: [{ field: 'out_of_stock', op: 'is', value: true }, { field: 'active', op: 'is', value: true }],
      sort: [{ by: 'out_of_stock_until', dir: 'asc' }],
    },
  }),
]
