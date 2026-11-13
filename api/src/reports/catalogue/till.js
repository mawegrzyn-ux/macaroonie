// src/reports/catalogue/till.js
//
// The till (POS) in the report catalogue. Every figure here must equal the
// till's own day report (dayFigures() in shared/pos/reports.js), so the
// measures follow its rules to the letter:
//
//   sales       closed checks, on the trading day the check was opened
//   dishes      lines of closed checks that aren't voided
//   payments    on the day each payment was taken (whatever the check's
//               state); refunds on the day they were made
//   voids       on the day of the void; cancelled orders on the day they
//               were cancelled
//   discounts, charges, VAT by rate
//               rows stored beside each check by checkBreakdowns() from
//               the till's own totals (never worked out again here)
//
// api/test/reports-till.test.mjs holds every one of them against
// dayFigures() for the same day.

import { subject, text, number, money, percent, yesno, choice, moment, duration, sum, count, countDistinct, ratio, one, many } from './define.js'
import { TENDERS } from '../../../../shared/pos/checks.js'

const TENDER_LABELS = Object.fromEntries(TENDERS.map(t => [t.key, t.label]))
const MODES = { table: 'Table', tab: 'Tab', counter: 'Counter' }
const DAY = { sql: '{day}.business_date', label: 'Trading day', about: 'The trading day, which ends when the day is closed on the till (the Z report), not at midnight.' }

// T2-47, or 47 for checks numbered before each till had its own code.
const CHECK_NUMBER = "(CASE WHEN {t}.number IS NULL THEN NULL WHEN {t}.number_code IS NOT NULL THEN {t}.number_code || '-' || {t}.number::text ELSE {t}.number::text END)"

const CLOSED = "{t}.status = 'closed'"
const ON_CLOSED = "{check}.status = 'closed'"
const SOLD = ON_CLOSED + " AND {t}.status <> 'voided'"
const TAKEN = "{t}.kind = 'payment' AND NOT {t}.voided"
const REFUND = "{t}.kind = 'refund'"

const takers = (col, label) => one('till.takers', col, { label })

export default [
  // ── Who and what the till groups by ────────────────────────

  subject({
    key: 'till.takers',
    label: 'Staff and kiosks',
    one: 'person or kiosk',
    area: 'till',
    module: 'pos_reports',
    about: 'Who an order was taken by: a member of staff, or a self-order kiosk (a kiosk\'s orders name the kiosk).',
    from: {
      sql: `(SELECT s.id, s.tenant_id, s.venue_id, s.name, 'staff'::text AS kind, s.is_active AS active FROM cash_staff s
             UNION ALL
             SELECT d.id, d.tenant_id, d.venue_id, d.name, 'kiosk'::text AS kind, (d.revoked_at IS NULL) AS active FROM pos_devices d WHERE d.kind = 'kiosk')`,
      tables: ['cash_staff', 'pos_devices'],
    },
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      kind: choice('kind', { staff: 'Staff', kiosk: 'Kiosk' }, { label: 'Staff or kiosk' }),
      active: yesno('active', { label: 'In use' }),
    },
    measures: {
      people: count({ label: 'Staff and kiosks' }),
    },
    list: ['name', 'kind', 'venue.name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
  }),

  subject({
    key: 'till.streams',
    label: 'Revenue streams',
    one: 'revenue stream',
    area: 'till',
    module: 'pos_reports',
    about: 'The revenue streams tills group sales under (Restaurant, Bar, Takeaway).',
    from: 'pos_revenue_streams',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { streams: count({ label: 'Revenue streams' }) },
    list: ['name', 'venue.name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['default_order_type_id', 'menu_ids', 'colour', 'sort_order', 'created_at', 'covers', 'courses'],
  }),

  subject({
    key: 'till.order_types',
    label: 'Order types',
    one: 'order type',
    area: 'till',
    module: 'pos_reports',
    about: 'Eat in, Take out, Delivery, Collection and any order types of your own.',
    from: 'order_types',
    name: 'name',
    fields: {
      name: text('name'),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { order_types: count({ label: 'Order types' }) },
    list: ['name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['colour', 'sort_order', 'created_at'],
  }),

  subject({
    key: 'till.courses',
    label: 'Courses',
    one: 'course',
    area: 'till',
    module: 'pos_reports',
    about: 'Starters, Mains, Desserts: the courses dishes are sent to the kitchen in.',
    from: 'pos_courses',
    name: 'name',
    fields: {
      name: text('name'),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { courses: count({ label: 'Courses' }) },
    list: ['name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['short_name', 'hold_by_default', 'colour', 'sort_order', 'created_at'],
  }),

  // ── Trading days ───────────────────────────────────────────

  subject({
    key: 'till.days',
    label: 'Trading days',
    one: 'trading day',
    area: 'till',
    module: 'pos_reports',
    about: 'One row for each trading day of each venue: when it opened and closed, its Z number, and the cash counted against the cash the till expected.',
    from: 'pos_days',
    name: 'date',
    venue: 'venue_id',
    open: { page: '/pos/reports?day=:id&venue=:venue', module: 'pos_reports', with: { venue: 'venue_id' } },
    date: { sql: '{t}.business_date', label: 'Trading day' },
    fields: {
      z_number: number('z_number', { label: 'Z number', decimals: 0 }),
      opened_at: moment('opened_at', { label: 'Opened' }),
      closed_at: moment('closed_at', { label: 'Closed' }),
      closed: yesno({ sql: '({t}.closed_at IS NOT NULL)' }, { label: 'Closed', title: 'Day closed' }),
      cash_counted: money('declared_cash', { label: 'Cash counted' }),
      cash_expected: money({ sql: "({t}.figures->>'cash_expected')::numeric" }, { label: 'Cash expected', about: 'Cash payments and tips less cash refunds, from the day\'s Z report.' }),
      cash_difference: money({ sql: "({t}.declared_cash - ({t}.figures->>'cash_expected')::numeric)" }, { label: 'Over or short', about: 'Cash counted less cash expected: a minus is short.' }),
      notes: text('close_notes', { label: 'Closing notes' }),
      recon_filled_at: moment('recon_filled_at', { label: 'Cash Recon filled' }),
      recon_error: text('recon_error', { label: 'Cash Recon problem' }),
    },
    measures: {
      days: count({ label: 'Trading days' }),
      days_closed: count({ label: 'Days closed', where: '{t}.closed_at IS NOT NULL', about: 'Trading days closed on the till (with a Z report).' }),
      counted_total: sum('declared_cash', { type: 'money', label: 'Cash counted', about: 'The cash counted in the till when each day was closed.' }),
      expected_total: sum({ sql: "({t}.figures->>'cash_expected')::numeric" }, { type: 'money', label: 'Cash expected', about: 'The cash the till took each day: cash payments and their tips, less cash refunds.' }),
      difference_total: sum({ sql: "({t}.declared_cash - ({t}.figures->>'cash_expected')::numeric)" }, { type: 'money', label: 'Over or short', about: 'Cash counted less the cash expected: a minus is short.' }),
    },
    links: {
      closed_by: takers('closed_by', 'Closed by'),
    },
    list: ['date', 'venue.name', 'z_number', 'cash_expected', 'cash_counted', 'cash_difference', 'closed_by.name'],
    sort: [{ by: 'date', dir: 'desc' }],
    // Test days made on the Test data page (migration 245) are read like real ones on purpose.
    skip: ['is_generated'],
  }),

  // ── Checks ─────────────────────────────────────────────────

  subject({
    key: 'till.checks',
    label: 'Checks',
    one: 'check',
    area: 'till',
    module: 'pos_reports',
    about: 'Every check opened on a till or kiosk: a table\'s bill, a tab or a counter order. Sales count once the check is closed, on the trading day it was opened, as on the till\'s own reports.',
    from: 'pos_checks',
    idType: 'text',
    name: 'number',
    venue: 'venue_id',
    open: { page: '/pos/reports?check=:id&venue=:venue', module: 'pos_reports', with: { venue: 'venue_id' } },
    date: DAY,
    fields: {
      number: text({ sql: CHECK_NUMBER }, { label: 'Check' }),
      order_no: number('order_no', { label: 'Order number', decimals: 0 }),
      mode: choice('mode', MODES, { label: 'Service' }),
      status: choice('status', { open: 'Open', closed: 'Closed', void: 'Void', merged: 'Merged into another' }),
      tab_name: text('tab_name', { label: 'Name on the order', pii: true }),
      tent: text('tent', { label: 'Tent number' }),
      covers: number('covers', { label: 'Guests', adds: true, decimals: 0 }),
      opened_at: moment('opened_at', { label: 'Opened' }),
      closed_at: moment('closed_at', { label: 'Closed' }),
      time_open: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.closed_at - {t}.opened_at))' }, { label: 'Time open' }),
      gross: money('subtotal', { label: 'Gross', about: 'Its dishes at full price, before discounts.' }),
      discount: money('discount', { label: 'Discount' }),
      net: money({ sql: '({t}.subtotal - {t}.discount)' }, { label: 'Net' }),
      service_charge: money('service_charge', { label: 'Charges' }),
      total: money('total'),
      vat: money('vat', { label: 'VAT' }),
      paid: money('paid'),
      tips: money('tips'),
      refunded: money('refunded'),
    },
    measures: {
      checks: count({ label: 'Checks', where: CLOSED, about: 'Closed checks.' }),
      guests: sum('covers', { label: 'Guests', where: CLOSED, about: 'Guests (covers) on closed checks.' }),
      gross_sales: sum('subtotal', { type: 'money', label: 'Gross sales', where: CLOSED, about: 'Dishes at full price, before discounts.' }),
      discounts: sum('discount', { type: 'money', label: 'Discounts', where: CLOSED, about: 'Discounts given on closed checks.' }),
      net_sales: sum({ sql: '({t}.subtotal - {t}.discount)' }, { type: 'money', label: 'Net sales', where: CLOSED, about: 'Gross sales less discounts. VAT is included; charges and tips are not.' }),
      charges: sum('service_charge', { type: 'money', label: 'Charges', where: CLOSED, about: 'Service charges and other charges on closed checks; a charge taken off counts nothing.' }),
      total_sales: sum('total', { type: 'money', label: 'Total', where: CLOSED, about: 'Net sales plus charges.' }),
      vat_total: sum('vat', { type: 'money', label: 'VAT', where: CLOSED, about: 'The VAT in closed checks\' sales and charges.' }),
      average_check: ratio('total_sales', 'checks', { type: 'money', label: 'Average check', about: 'Total (net sales plus charges) divided by the number of closed checks.' }),
      per_guest: ratio('total_sales', 'guests', { type: 'money', label: 'Spend per guest', about: 'Total (net sales plus charges) divided by the guests on closed checks.' }),
      open_checks: count({ label: 'Checks still open', where: "{t}.status = 'open'", about: 'Checks not paid and closed yet (cancelled orders aren\'t counted).' }),
    },
    links: {
      day: one('till.days', 'day_id', { label: 'Trading day' }),
      server: takers('server_id', 'Server'),
      stream: one('till.streams', 'revenue_stream_id', { label: 'Revenue stream' }),
      order_type: one('till.order_types', 'order_type_id', { label: 'Order type' }),
      table: one('bookings.tables', 'table_id', { label: 'Table' }),
      lines: many('till.lines', 'check_id', { label: 'Dishes sold' }),
      payments: many('till.payments', 'check_id', { label: 'Payments' }),
      discounts_given: many('till.discounts', 'check_id', { label: 'Discounts' }),
      charges_added: many('till.charges', 'check_id', { label: 'Charges' }),
    },
    list: ['number', 'date', 'venue.name', 'mode', 'server.name', 'covers', 'net', 'service_charge', 'total', 'status'],
    sort: [{ by: 'opened_at', dir: 'desc' }],
    // state is the check as the till keeps it; the columns beside it are what reports read.
    // is_generated marks test sales made on the Test data page (migration 245),
    // which reports read like real sales on purpose (the till reports do too).
    skip: ['loyalty_member_id', 'state', 'last_seq', 'proj_v', 'updated_at', 'loyalty_settled_key', 'is_generated'],
  }),

  subject({
    key: 'till.lines',
    label: 'Dishes sold',
    one: 'dish sold',
    area: 'till',
    module: 'pos_reports',
    about: 'Each dish on a check, with what it sold for after discounts. A dish counts as sold once its check is closed; voided dishes are left out of the figures.',
    from: 'pos_check_lines',
    idType: 'text',
    name: 'name',
    venue: 'venue_id',
    open: 'check',
    date: DAY,
    fields: {
      name: text('name', { label: 'Dish', about: 'The name the dish had when it was sold.' }),
      qty: number('qty', { label: 'Quantity', adds: true, decimals: 0 }),
      gross: money('gross', { about: 'At full price, with its options.' }),
      discount: money('discount'),
      net: money('net'),
      vat: money('vat', { label: 'VAT' }),
      vat_rate: percent('vat_rate', { label: 'VAT rate' }),
      seat: number('seat', { decimals: 0 }),
      status: choice('status', { new: 'Not sent', sent: 'Sent', voided: 'Voided' }),
      sent_at: moment('sent_at', { label: 'Sent to the kitchen' }),
    },
    measures: {
      qty_sold: sum('qty', { label: 'Quantity sold', where: SOLD, about: 'How many were sold, on closed checks. Voided dishes are left out.' }),
      gross_sales: sum('gross', { type: 'money', label: 'Gross sales', where: SOLD, about: 'Dishes at full price, before discounts, on closed checks. Voided dishes are left out.' }),
      discounts: sum('discount', { type: 'money', label: 'Discounts', where: SOLD, about: 'The discounts on these dishes (a check\'s discount is shared over its dishes), on closed checks.' }),
      net_sales: sum('net', { type: 'money', label: 'Net sales', where: SOLD, about: 'Dishes after discounts, VAT included, on closed checks. Voided dishes are left out; charges and tips aren\'t dishes.' }),
      vat_total: sum('vat', { type: 'money', label: 'VAT', where: SOLD, about: 'The VAT in these dishes\' sales, on closed checks. Voided dishes are left out.' }),
      lines: count({ label: 'Lines', where: SOLD, about: 'Lines on checks (a dish with its choices, any quantity), on closed checks. Voided ones are left out.' }),
      checks: countDistinct('check_id', { label: 'Checks', where: SOLD, about: 'How many different checks these dishes were on.' }),
      average_price: ratio('net_sales', 'qty_sold', { type: 'money', label: 'Average price', about: 'Net sales divided by the quantity sold: what one went for, after discounts.' }),
    },
    links: {
      day: one('till.days', 'day_id', { label: 'Trading day' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      item: one('menu.dishes', 'item_id', { label: 'Menu dish' }),
      section: one('menu.sections', 'section_id', { label: 'Section' }),
      stream: one('till.streams', 'revenue_stream_id', { label: 'Revenue stream' }),
      course: one('till.courses', 'course_id', { label: 'Course' }),
      added_by: takers('added_by', 'Added by'),
    },
    list: ['date', 'check.number', 'name', 'qty', 'gross', 'discount', 'net', 'section.name', 'check.server.name'],
    sort: [{ by: 'date', dir: 'desc' }],
    skip: ['tax_rate_id'],
  }),

  subject({
    key: 'till.voids',
    label: 'Voids',
    one: 'void',
    area: 'till',
    module: 'pos_reports',
    about: 'Dishes voided after they were sent to the kitchen, with who voided them, who approved it and why. A void counts on the day it happened.',
    from: 'pos_check_lines',
    where: "{t}.status = 'voided'",
    idType: 'text',
    name: 'name',
    venue: 'venue_id',
    open: 'check',
    date: { sql: '{void_day}.business_date', label: 'Trading day' },
    fields: {
      name: text('name', { label: 'Dish' }),
      qty: number('qty', { label: 'Quantity', adds: true, decimals: 0 }),
      value: money('gross', { label: 'Value' }),
      reason: text('void_reason'),
      wasted: yesno('void_waste', { label: 'Wasted', about: 'Whether the dish had been made (waste) or not.' }),
      voided_at: moment('voided_at', { label: 'Voided at' }),
    },
    measures: {
      voids: count({ label: 'Voids', about: 'Dishes voided after they were sent to the kitchen, Cancel order\'s voids included.' }),
      qty_voided: sum('qty', { label: 'Quantity voided', about: 'How many of the dishes were voided.' }),
      value_voided: sum('gross', { type: 'money', label: 'Value voided', about: 'What the voided dishes came to at full price.' }),
    },
    links: {
      void_day: one('till.days', 'void_day_id', { label: 'Trading day' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      voided_by: takers('voided_by', 'Voided by'),
      approved_by: takers('void_approved_by', 'Approved by'),
      item: one('menu.dishes', 'item_id', { label: 'Menu dish' }),
      section: one('menu.sections', 'section_id', { label: 'Section' }),
    },
    list: ['date', 'check.number', 'name', 'qty', 'value', 'reason', 'wasted', 'voided_by.name', 'approved_by.name'],
    sort: [{ by: 'voided_at', dir: 'desc' }],
  }),

  subject({
    key: 'till.cancelled',
    label: 'Cancelled orders',
    one: 'cancelled order',
    area: 'till',
    module: 'pos_reports',
    about: 'Orders called off with Cancel order, with what each was worth, who cancelled it and why.',
    from: 'pos_checks',
    where: '{t}.cancel_value IS NOT NULL',
    idType: 'text',
    name: 'number',
    venue: 'venue_id',
    open: { page: '/pos/reports?check=:id&venue=:venue', module: 'pos_reports', with: { venue: 'venue_id' } },
    date: { sql: '{cancel_day}.business_date', label: 'Trading day' },
    fields: {
      number: text({ sql: CHECK_NUMBER }, { label: 'Check' }),
      order_no: number('order_no', { label: 'Order number', decimals: 0 }),
      mode: choice('mode', MODES, { label: 'Service' }),
      reason: text('cancel_reason'),
      value: money('cancel_value', { label: 'Value' }),
      cancelled_at: moment('cancelled_at', { label: 'Cancelled at' }),
    },
    measures: {
      cancelled: count({ label: 'Cancelled orders', about: 'Orders cancelled on the till with Cancel order.' }),
      value_cancelled: sum('cancel_value', { type: 'money', label: 'Value cancelled', about: 'What the orders came to when they were cancelled.' }),
    },
    links: {
      cancel_day: one('till.days', 'cancel_day_id', { label: 'Trading day' }),
      cancelled_by: takers('cancelled_by', 'Cancelled by'),
      approved_by: takers('cancel_approved_by', 'Approved by'),
      server: takers('server_id', 'Server'),
      order_type: one('till.order_types', 'order_type_id', { label: 'Order type' }),
    },
    list: ['date', 'number', 'mode', 'value', 'reason', 'cancelled_by.name', 'approved_by.name'],
    sort: [{ by: 'cancelled_at', dir: 'desc' }],
  }),

  // ── Money in ───────────────────────────────────────────────

  subject({
    key: 'till.payments',
    label: 'Till payments',
    one: 'payment',
    area: 'till',
    module: 'pos_reports',
    about: 'Every payment and refund taken on a till or kiosk, by tender. Each counts on the trading day it was taken, which can be later than its check\'s day.',
    from: 'pos_payments',
    idType: 'text',
    venue: 'venue_id',
    open: 'check',
    date: DAY,
    fields: {
      kind: choice('kind', { payment: 'Payment', refund: 'Refund' }, { label: 'Payment or refund' }),
      tender: choice('tender', TENDER_LABELS),
      // Not added up in a list: payments, refunds and payments taken off sit
      // side by side there. The figures below add them the right way round.
      amount: money('amount', { adds: false }),
      tip: money('tip', { adds: false }),
      voided: yesno('voided', { label: 'Taken off' }),
      reason: text('reason'),
      at: moment('at', { label: 'Time' }),
    },
    measures: {
      payments: count({ label: 'Payments', where: TAKEN, about: 'Payments taken; voided payments are left out, refunds are counted apart.' }),
      taken: sum('amount', { type: 'money', label: 'Taken', where: TAKEN, about: 'Payments, before tips and refunds.' }),
      tips: sum('tip', { type: 'money', label: 'Tips', where: TAKEN, about: 'Tips on payments; voided payments are left out.' }),
      refunds: count({ label: 'Refunds', where: REFUND, about: 'Refunds given on the till.' }),
      refunded: sum('amount', { type: 'money', label: 'Refunded', where: REFUND, about: 'Money refunded on the till.' }),
      net_taken: sum({ sql: "(CASE WHEN {t}.kind = 'refund' THEN -{t}.amount WHEN {t}.voided THEN 0 ELSE {t}.amount END)" }, { type: 'money', label: 'Net taken', about: 'Payments less refunds.' }),
      takings: sum({ sql: "(CASE WHEN {t}.kind = 'refund' THEN -{t}.amount WHEN {t}.voided THEN 0 ELSE {t}.amount + {t}.tip END)" }, { type: 'money', label: 'Takings', about: 'Payments and tips less refunds: the money that should be there.' }),
    },
    links: {
      day: one('till.days', 'day_id', { label: 'Trading day' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      staff: takers('staff_id', 'Taken by'),
      approved_by: takers('approved_by', 'Approved by'),
    },
    list: ['date', 'at', 'check.number', 'kind', 'tender', 'amount', 'tip', 'staff.name', 'reason'],
    sort: [{ by: 'at', dir: 'desc' }],
  }),

  // ── What the till stores beside each check ─────────────────

  subject({
    key: 'till.discounts',
    label: 'Discounts and comps',
    one: 'discount',
    area: 'till',
    module: 'pos_reports',
    about: 'Each discount, comp, promotion, meal deal saving and loyalty reward on a check, with what it took off, who gave it and why. Counted with its check, once the check is closed.',
    from: 'pos_check_discounts',
    id: { sql: "({t}.check_id || ':' || {t}.idx::text)" },
    idType: 'text',
    name: 'name',
    venue: 'venue_id',
    open: 'check',
    date: DAY,
    fields: {
      name: text('name', { label: 'Discount' }),
      kind: choice('kind', { discount: 'Discount', comp: 'Comp', promotion: 'Promotion', combo: 'Meal deal', reward: 'Loyalty reward' }),
      scope: choice('scope', { check: 'The whole check', line: 'Some dishes' }, { label: 'Taken off' }),
      amount: money('amount'),
      reason: text('reason'),
      applied_at: moment('applied_at', { label: 'Given at' }),
    },
    measures: {
      times_given: count({ label: 'Times given', where: ON_CLOSED, about: 'How many times a discount was given, on closed checks.' }),
      amount_given: sum('amount', { type: 'money', label: 'Discount given', where: ON_CLOSED, about: 'What the discounts took off, on closed checks.' }),
    },
    links: {
      day: one('till.days', 'day_id', { label: 'Trading day' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      applied_by: takers('applied_by', 'Given by'),
      approved_by: takers('approved_by', 'Approved by'),
    },
    list: ['date', 'check.number', 'kind', 'name', 'amount', 'reason', 'applied_by.name', 'approved_by.name'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'till.charges',
    label: 'Charges',
    one: 'charge',
    area: 'till',
    module: 'pos_reports',
    about: 'Service charges and other charges on checks: what each came to, and the ones taken off with who took them off and why.',
    from: 'pos_check_charges',
    id: { sql: "({t}.check_id || ':' || {t}.idx::text)" },
    idType: 'text',
    name: 'name',
    venue: 'venue_id',
    open: 'check',
    date: DAY,
    fields: {
      name: text('name', { label: 'Charge' }),
      kind: choice('kind', { percent: 'A percentage', amount: 'An amount' }),
      optional: yesno('optional', { label: 'Optional' }),
      amount: money('amount', { about: 'What it came to on the check: nothing when taken off.' }),
      would_be: money('would_be', { label: 'Would have been' }),
      removed: yesno('removed', { label: 'Taken off' }),
      waiting: yesno('waiting', { label: 'Waiting for more guests', about: 'A charge that starts from a number of guests the check hasn\'t reached.' }),
      remove_reason: text('remove_reason', { label: 'Why taken off' }),
      vat_rate: percent('vat_rate', { label: 'VAT rate' }),
    },
    measures: {
      times_charged: count({ label: 'Times charged', where: ON_CLOSED + ' AND {t}.amount > 0', about: 'How many times a charge came to more than nothing, on closed checks.' }),
      amount_charged: sum('amount', { type: 'money', label: 'Charged', where: ON_CLOSED, about: 'What the charges came to on closed checks; one taken off counts nothing.' }),
      times_removed: count({ label: 'Times taken off', where: ON_CLOSED + ' AND {t}.removed AND {t}.would_be > 0', about: 'How many times a charge was taken off a closed check.' }),
      amount_removed: sum('would_be', { type: 'money', label: 'Taken off', where: ON_CLOSED + ' AND {t}.removed', about: 'What the charges taken off would have come to.' }),
    },
    links: {
      day: one('till.days', 'day_id', { label: 'Trading day' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      removed_by: takers('removed_by', 'Taken off by'),
      approved_by: takers('approved_by', 'Approved by'),
    },
    list: ['date', 'check.number', 'name', 'amount', 'removed', 'remove_reason', 'removed_by.name'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'till.vat',
    label: 'VAT on till sales',
    one: 'VAT line',
    area: 'till',
    module: 'pos_reports',
    about: 'Each check\'s sales split by VAT rate (net, VAT and gross), charges included, as the till worked it out.',
    from: 'pos_check_vat',
    id: { sql: "({t}.check_id || ':' || {t}.rate::text)" },
    idType: 'text',
    venue: 'venue_id',
    open: 'check',
    date: DAY,
    fields: {
      rate: percent('rate', { label: 'VAT rate' }),
      net: money('net', { label: 'Net of VAT' }),
      vat: money('vat', { label: 'VAT' }),
      gross: money('gross', { label: 'With VAT' }),
    },
    measures: {
      net_of_vat: sum('net', { type: 'money', label: 'Net of VAT', where: ON_CLOSED, about: 'Closed checks\' sales and charges without their VAT.' }),
      vat_total: sum('vat', { type: 'money', label: 'VAT', where: ON_CLOSED, about: 'The VAT in closed checks\' sales and charges.' }),
      with_vat: sum('gross', { type: 'money', label: 'With VAT', where: ON_CLOSED, about: 'Closed checks\' sales and charges with their VAT.' }),
    },
    links: {
      day: one('till.days', 'day_id', { label: 'Trading day' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
    },
    list: ['date', 'check.number', 'rate', 'net', 'vat', 'gross'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),
]
