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

import { subject, text, number, money, percent, yesno, choice, moment, duration, sum, avg, count, countDistinct, ratio, one, many } from './define.js'
import { TENDERS, CHECK_EVENTS, VENUE_EVENTS } from '../../../../shared/pos/checks.js'
import { PROVIDERS } from '../../services/cardMachines/index.js'

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

// What each till change is called (the event types in shared/pos/checks.js;
// kitchen events are the kitchen's subjects). The catalogue test checks
// every type has its words.
export const EVENT_LABELS = {
  'check.opened': 'Order opened',
  'check.covers_set': 'Guests changed',
  'check.table_moved': 'Moved to another table',
  'check.server_changed': 'Server changed',
  'check.stream_set': 'Revenue stream changed',
  'check.order_type_set': 'Order type changed',
  'check.tent_set': 'Tent number set',
  'check.renamed': 'Name changed',
  'check.note_set': 'Note changed',
  'check.allergy_set': 'Allergy flag changed',
  'check.member_set': 'Loyalty member changed',
  'check.flow_asked': 'Order flow question answered',
  'line.added': 'Dish added',
  'line.changed': 'Dish changed',
  'line.deleted': 'Dish taken off',
  'lines.sent': 'Sent to the kitchen',
  'course.fired': 'Course fired',
  'line.voided': 'Dish voided',
  'discount.applied': 'Discount given',
  'discount.removed': 'Discount taken off',
  'promotions.set': 'Offers worked out',
  'charge.added': 'Charge added',
  'charge.removed': 'Charge taken off',
  'charge.restored': 'Charge put back',
  'lines.moved': 'Dishes moved to another check',
  'check.merged': 'Checks merged',
  'bill.printed': 'Bill printed',
  'payment.added': 'Payment taken',
  'payment.voided': 'Payment taken off',
  'check.closed': 'Order closed',
  'check.reopened': 'Order reopened',
  'refund.added': 'Refund given',
  'drawer.opened': 'Drawer opened (no sale)',
  'day.closed': 'Trading day closed',
}
// Kept beside the list the till itself uses, so a new event type can't go unnamed.
export const TILL_EVENT_TYPES = [...CHECK_EVENTS, ...VENUE_EVENTS]

const DEVICE_KINDS = { terminal: 'Till', kds: 'Kitchen screen', kiosk: 'Self-order kiosk', hub: 'Venue hub' }
const CARD_PROVIDERS = Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, p.label]))
const CARD_STATUS = { pending: 'Waiting for the card', signature: 'Waiting for a signature check', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled', failed: 'Failed' }
const PRINT_KINDS = { kitchen: 'Kitchen ticket', fire: 'Fire ticket', void: 'Void ticket', allergy: 'Allergy update', bill: 'Bill', receipt: 'Receipt', drawer: 'Drawer kick' }
const PRINT_STATUS = { queued: 'Waiting', printing: 'Printing', printed: 'Printed', failed: 'Failed', cancelled: 'Cancelled' }

// A device id kept as text (tills send their own; a kitchen tap from the live
// kitchen view is "live:<screen>"): only a real device's id leads to it.
const DEVICE_OF = col => ({ sql: "(CASE WHEN {t}." + col + " ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN {t}." + col + "::uuid END)" })
const DAY_AT = (col, label = 'Day') => ({ sql: '({t}.' + col + ' AT TIME ZONE {tz})::date', bound: '{t}.' + col, label })

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
    skip: ['default_order_type_id', 'menu_ids', 'colour', 'sort_order', 'created_at', 'covers', 'courses', 'seats'],
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

  subject({
    key: 'till.roles',
    label: 'Till roles',
    one: 'till role',
    area: 'till',
    module: 'pos_setup',
    about: 'What people may do on the till (Server, Supervisor, Manager), set up in Store tech.',
    from: 'pos_roles',
    name: 'name',
    fields: {
      name: text('name'),
    },
    measures: { roles: count({ label: 'Till roles' }) },
    links: {
      people: many('staff.people', 'pos_role_id', { label: 'People with it' }),
    },
    list: ['name'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['permissions', 'sort_order', 'created_at'],
  }),

  subject({
    key: 'till.floor_areas',
    label: 'Floor areas',
    one: 'floor area',
    area: 'till',
    module: 'pos_setup',
    about: 'The rooms of each venue\'s floor plan on the till (Restaurant, Terrace), with the revenue stream a room sells in.',
    from: 'floor_areas',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
    },
    measures: { areas: count({ label: 'Floor areas' }) },
    links: {
      stream: one('till.streams', 'revenue_stream_id', { label: 'Revenue stream' }),
      tables: many('bookings.tables', 'floor_area_id', { label: 'Tables' }),
    },
    list: ['name', 'venue.name', 'stream.name'],
    sort: [{ by: 'name', dir: 'asc' }],
    // Its size and drawing on the floor plan.
    skip: ['width', 'height', 'decor', 'sort_order', 'created_at'],
  }),

  subject({
    key: 'till.devices',
    label: 'Devices',
    one: 'device',
    area: 'tech',
    module: 'pos_setup',
    about: 'The tills, kitchen screens, self-order kiosks and venue hubs set up in Store tech, with when each last talked to us. Removed ones stay, so their sales keep a name.',
    from: 'pos_devices',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      kind: choice('kind', DEVICE_KINDS, { label: 'Kind of device' }),
      code: text('short_code', { label: 'Short code', about: 'The code its check numbers start with (T2 in T2-47).' }),
      app_version: text('app_version', { label: 'App version' }),
      linked_at: moment('paired_at', { label: 'Linked' }),
      last_seen_at: moment('last_seen_at', { label: 'Last seen' }),
      removed: yesno({ sql: '({t}.revoked_at IS NOT NULL)' }, { label: 'Removed' }),
      removed_at: moment('revoked_at', { label: 'Removed at' }),
      added_at: moment('created_at', { label: 'Added' }),
    },
    measures: {
      devices: count({ label: 'Devices', where: '{t}.revoked_at IS NULL', about: 'Devices set up and not removed.' }),
      removed_devices: count({ label: 'Removed', where: '{t}.revoked_at IS NOT NULL', about: 'Devices removed in Store tech.' }),
    },
    list: ['name', 'kind', 'venue.name', 'code', 'last_seen_at', 'app_version', 'removed'],
    sort: [{ by: 'name', dir: 'asc' }],
    // How it signs in, its settings and what it last reported: none of it a figure.
    skip: ['secret_hash', 'pairing_code_hash', 'pairing_expires_at', 'user_agent', 'settings', 'created_by', 'info', 'info_at', 'update_requested_at', 'pending_changes', 'pending_at'],
  }),

  subject({
    key: 'till.card_readers',
    label: 'Card machines',
    one: 'card machine',
    area: 'tech',
    module: 'pos_setup',
    about: 'The card machines tills and kiosks take payments on, set up in Store tech.',
    from: 'pos_card_readers',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      provider: choice('provider', CARD_PROVIDERS),
      model: text('model'),
      serial: text('serial', { label: 'Serial number' }),
      online: yesno('online', { label: 'Online when last checked' }),
      checked_at: moment('status_at', { label: 'Last checked' }),
      removed: yesno({ sql: '({t}.removed_at IS NOT NULL)' }, { label: 'Removed' }),
      added_at: moment('created_at', { label: 'Added' }),
    },
    measures: {
      machines: count({ label: 'Card machines', where: '{t}.removed_at IS NULL', about: 'Card machines set up and not removed.' }),
    },
    links: {
      payments: many('till.card_payments', 'reader_id', { label: 'Payments' }),
    },
    list: ['name', 'provider', 'venue.name', 'model', 'online', 'checked_at'],
    sort: [{ by: 'name', dir: 'asc' }],
    // The provider's own ids and the account it is reached through.
    skip: ['account_id', 'provider_reader_id'],
  }),

  subject({
    key: 'till.printers',
    label: 'Printers',
    one: 'printer',
    area: 'tech',
    module: 'pos_setup',
    about: 'The receipt and kitchen printers set up in Store tech: on the network (printed by the venue hub) or plugged into a till, kitchen screen or hub.',
    from: 'pos_printers',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      kind: choice('kind', { station: 'Kitchen printer', receipt: 'Receipt printer' }, { label: 'Kind of printer' }),
      connection: choice('connection', { hub: 'On the network', device: 'Plugged into a device' }),
      address: text('host', { label: 'Network address' }),
      columns: number('columns', { label: 'Characters a line', decimals: 0 }),
      active: yesno('is_active', { label: 'In use' }),
      checked_at: moment('status_at', { label: 'Last checked' }),
    },
    measures: {
      printers: count({ label: 'Printers', where: '{t}.is_active', about: 'Printers in use.' }),
    },
    links: {
      backup: one('till.printers', 'backup_printer_id', { label: 'Backup printer' }),
      device: one('till.devices', 'device_id', { label: 'Plugged into' }),
      jobs: many('till.print_jobs', 'printer_id', { label: 'Print jobs' }),
    },
    list: ['name', 'kind', 'venue.name', 'connection', 'device.name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['port', 'status', 'local_id', 'sort_order', 'created_at'],
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
      tax_rate: one('menu.tax_rates', 'tax_rate_id', { label: 'Tax rate' }),
    },
    list: ['date', 'check.number', 'name', 'qty', 'gross', 'discount', 'net', 'section.name', 'check.server.name'],
    sort: [{ by: 'date', dir: 'desc' }],
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

  // ── What happened on the tills ─────────────────────────────

  subject({
    key: 'till.activity',
    label: 'Till activity',
    one: 'change',
    area: 'till',
    module: 'pos_reports',
    about: 'Every change made on a till or kiosk, in order: what it was, on which check and device, by whom and who approved it. What a change held (dishes, amounts) is in the till\'s other subjects.',
    from: 'pos_events',
    // The kitchen's taps are the kitchen's subjects.
    where: "{t}.type NOT LIKE 'kitchen.%'",
    idType: 'text',
    venue: 'venue_id',
    open: 'check',
    date: DAY,
    fields: {
      type: choice('type', EVENT_LABELS, { label: 'Change' }),
      made_at: moment({ sql: 'COALESCE({t}.client_at, {t}.created_at)' }, { label: 'Time', about: 'When the change was made on the till.' }),
      received_at: moment('created_at', { label: 'Reached us', about: 'When the change reached the cloud: later than it was made when the till or the venue hub was offline.' }),
      sent_after: duration({ sql: 'GREATEST(EXTRACT(EPOCH FROM ({t}.created_at - {t}.client_at)), 0)' }, { label: 'Reached us after', about: 'How long after it was made the change reached the cloud.' }),
      approved: yesno({ sql: '({t}.approved_by IS NOT NULL)' }, { label: 'A manager approved it' }),
    },
    measures: {
      changes: count({ label: 'Changes' }),
      checks: countDistinct('check_id', { label: 'Checks', about: 'How many different checks the changes were on.' }),
      approvals: count({ label: 'Approved by a manager', where: '{t}.approved_by IS NOT NULL', about: 'Changes that needed a manager\'s PIN.' }),
      sent_late: count({ label: 'Sent later', where: "{t}.created_at - {t}.client_at > interval '2 minutes'", about: 'Changes that reached the cloud more than two minutes after they were made: the till or the venue was offline.' }),
    },
    links: {
      day: one('till.days', 'day_id', { label: 'Trading day' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      staff: takers('staff_id', 'By'),
      approved_by: takers('approved_by', 'Approved by'),
      device: one('till.devices', DEVICE_OF('device_id'), { label: 'Device' }),
      hub: one('till.devices', 'hub_id', { label: 'Through the venue hub' }),
    },
    list: ['made_at', 'type', 'check.number', 'staff.name', 'approved_by.name', 'device.name'],
    sort: [{ by: 'made_at', dir: 'desc' }],
    // What the change held, and the order the cloud put it in.
    skip: ['payload', 'assigned', 'seq'],
  }),

  subject({
    key: 'till.refusals',
    label: 'Changes refused',
    one: 'refused change',
    area: 'tech',
    module: 'pos_reports',
    about: 'Changes a till or kiosk made that the cloud refused when they reached it (a check changed elsewhere meanwhile, a manager needed), with why and whether someone sorted it out.',
    from: 'pos_event_rejections',
    // As Till reports' Conflicts list: the kitchen's are the kitchen's.
    where: "{t}.type NOT LIKE 'kitchen.%'",
    idType: 'text',
    venue: 'venue_id',
    open: 'check',
    date: DAY_AT('created_at'),
    fields: {
      type: choice('type', EVENT_LABELS, { label: 'Change' }),
      reason: text('error', { label: 'Why refused' }),
      code: text('code', { label: 'Reason code' }),
      made_at: moment('client_at', { label: 'Made' }),
      refused_at: moment('created_at', { label: 'Refused' }),
      sorted: yesno({ sql: '({t}.resolved_at IS NOT NULL)' }, { label: 'Sorted out' }),
      sorted_at: moment('resolved_at', { label: 'Sorted out at' }),
      sorted_by: text('resolved_by', { label: 'Sorted out by' }),
      resolution: text('resolution', { label: 'What was done' }),
    },
    measures: {
      refusals: count({ label: 'Changes refused' }),
      not_sorted: count({ label: 'Not sorted out', where: '{t}.resolved_at IS NULL', about: 'Refused changes nobody has sorted out yet.' }),
      checks: countDistinct('check_id', { label: 'Checks', about: 'How many different checks had a change refused.' }),
    },
    links: {
      check: one('till.checks', 'check_id', { label: 'Check' }),
      staff: takers('staff_id', 'By'),
      device: one('till.devices', DEVICE_OF('device_id'), { label: 'Device' }),
      hub: one('till.devices', 'hub_id', { label: 'Through the venue hub' }),
    },
    list: ['refused_at', 'type', 'check.number', 'reason', 'staff.name', 'device.name', 'sorted'],
    sort: [{ by: 'refused_at', dir: 'desc' }],
    skip: ['payload'],
  }),

  subject({
    key: 'till.receipts',
    label: 'Receipts by link',
    one: 'receipt',
    area: 'kiosks',
    module: 'pos_reports',
    about: 'Receipts a guest got from a self-order kiosk by its QR code or by email: how often each was opened and emailed. Addresses are never kept here.',
    from: 'pos_receipts',
    venue: 'venue_id',
    open: 'check',
    date: DAY_AT('created_at'),
    fields: {
      made_at: moment('created_at', { label: 'Made' }),
      views: number('views', { label: 'Times opened', adds: true, decimals: 0 }),
      last_viewed_at: moment('last_viewed_at', { label: 'Last opened' }),
      emails: number('emails', { label: 'Times emailed', adds: true, decimals: 0 }),
      emailed_at: moment('emailed_at', { label: 'Last emailed' }),
      waiting: yesno({ sql: '({t}.email_wanted_at IS NOT NULL)' }, { label: 'Email waiting for payment', about: 'A guest asked for it by email and the order hasn\'t been paid at the counter yet.' }),
    },
    measures: {
      receipts: count({ label: 'Receipts' }),
      opened: count({ label: 'Opened', where: '{t}.views > 0', about: 'Receipts opened at least once.' }),
      emailed: count({ label: 'Emailed', where: '{t}.emails > 0', about: 'Receipts emailed at least once.' }),
      times_opened: sum('views', { label: 'Times opened' }),
      emails_sent: sum('emails', { label: 'Emails sent' }),
    },
    links: {
      check: one('till.checks', 'check_id', { label: 'Check' }),
      device: one('till.devices', 'device_id', { label: 'Kiosk' }),
    },
    list: ['made_at', 'check.number', 'device.name', 'views', 'emails'],
    sort: [{ by: 'made_at', dir: 'desc' }],
    // The link's key and the address an email waits for (sealed).
    skip: ['token', 'email_hint', 'email_to', 'email_claimed_at', 'email_tries', 'email_error'],
  }),

  subject({
    key: 'till.card_payments',
    label: 'Card machine payments',
    one: 'card machine payment',
    area: 'tech',
    module: 'pos_reports',
    about: 'Every sale and refund started on a card machine from a till or kiosk, approved or not: declines, cancellations and payments never put on a bill included.',
    from: 'pos_card_payments',
    venue: 'venue_id',
    open: 'check',
    date: DAY_AT('created_at'),
    fields: {
      kind: choice('kind', { sale: 'Sale', refund: 'Refund' }, { label: 'Sale or refund' }),
      provider: choice('provider', CARD_PROVIDERS),
      status: choice('status', CARD_STATUS),
      amount: money('amount', { adds: false }),
      tip: money('tip', { adds: false }),
      refunded: money('refunded', { label: 'Refunded since', adds: false }),
      card: text('card_brand', { label: 'Card' }),
      message: text('message', { label: 'What the machine said' }),
      // As the payments list on Store tech's Card machines page: a payment is on a
      // bill once the event that put it there is known.
      on_bill: yesno({ sql: '({t}.used_event_id IS NOT NULL)' }, { label: 'On a bill' }),
      started_at: moment('created_at', { label: 'Started' }),
      finished_at: moment('finished_at', { label: 'Finished' }),
      took: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.finished_at - {t}.created_at))' }, { label: 'Took' }),
    },
    measures: {
      attempts: count({ label: 'Attempts' }),
      approved: count({ label: 'Approved', where: "{t}.status = 'approved'" }),
      declined: count({ label: 'Declined', where: "{t}.status = 'declined'" }),
      not_finished: count({ label: 'Cancelled or failed', where: "{t}.status IN ('cancelled', 'failed')" }),
      approval_rate: ratio('approved', 'attempts', { type: 'percent', label: 'Approved (%)', about: 'Approved out of every attempt.' }),
      taken: sum('amount', { type: 'money', label: 'Taken', where: "{t}.kind = 'sale' AND {t}.status = 'approved'", about: 'Approved sales, before tips.' }),
      tips: sum('tip', { type: 'money', label: 'Tips', where: "{t}.kind = 'sale' AND {t}.status = 'approved'", about: 'Tips on approved sales.' }),
      refunds: sum('amount', { type: 'money', label: 'Refunded', where: "{t}.kind = 'refund' AND {t}.status = 'approved'", about: 'Approved refunds to cards.' }),
      not_on_bill: count({ label: 'Approved, not on a bill', where: "{t}.kind = 'sale' AND {t}.status = 'approved' AND {t}.used_event_id IS NULL", about: 'Card payments that went through but were never put on a bill: money taken that no check shows.' }),
      average_time: avg({ sql: 'EXTRACT(EPOCH FROM ({t}.finished_at - {t}.created_at))' }, { type: 'duration', label: 'Average time', about: 'From starting on the till to the machine\'s answer.' }),
    },
    links: {
      reader: one('till.card_readers', 'reader_id', { label: 'Card machine' }),
      device: one('till.devices', 'device_id', { label: 'Till or kiosk' }),
      staff: takers('staff_id', 'Taken by'),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      payment: one('till.payments', 'payment_id', { label: 'Payment on the bill' }),
      sale: one('till.card_payments', 'sale_id', { label: 'Sale refunded' }),
    },
    list: ['started_at', 'kind', 'status', 'amount', 'tip', 'card', 'reader.name', 'device.name', 'check.number'],
    sort: [{ by: 'started_at', dir: 'desc' }],
    // The provider's references, the card's last digits and bookkeeping.
    skip: ['account_id', 'provider_ref', 'provider_ref2', 'card_last4', 'reference', 'checked_at', 'updated_at'],
  }),

  subject({
    key: 'till.print_jobs',
    label: 'Print jobs',
    one: 'print job',
    area: 'tech',
    module: 'pos_setup',
    about: 'Every kitchen ticket, bill and receipt sent to a printer: when it printed, how long it waited, and the ones that failed.',
    from: 'pos_print_jobs',
    venue: 'venue_id',
    open: 'check',
    date: DAY_AT('created_at'),
    fields: {
      kind: choice('kind', PRINT_KINDS, { label: 'What it printed' }),
      title: text('title'),
      status: choice('status', PRINT_STATUS),
      tries: number('attempts', { label: 'Tries', decimals: 0 }),
      error: text('error', { label: 'Problem' }),
      queued_at: moment('created_at', { label: 'Sent to print' }),
      collected_at: moment('claimed_at', { label: 'Collected' }),
      printed_at: moment('printed_at', { label: 'Printed' }),
      waited: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.printed_at - {t}.created_at))' }, { label: 'Waited', about: 'From being sent to print until it printed.' }),
    },
    measures: {
      jobs: count({ label: 'Print jobs' }),
      printed: count({ label: 'Printed', where: "{t}.status = 'printed'" }),
      failed: count({ label: 'Failed', where: "{t}.status = 'failed'" }),
      waiting: count({ label: 'Still waiting', where: "{t}.status IN ('queued', 'printing')" }),
      average_wait: avg({ sql: 'EXTRACT(EPOCH FROM ({t}.printed_at - {t}.created_at))' }, { type: 'duration', label: 'Average wait', where: "{t}.status = 'printed'", about: 'From being sent to print until it printed, for jobs that printed.' }),
    },
    links: {
      printer: one('till.printers', 'printer_id', { label: 'Printer' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      station: one('kitchen.stations', 'station_id', { label: 'Kitchen station' }),
      kitchen_order: one('kitchen.orders', 'kitchen_order_id', { label: 'Kitchen order' }),
      collected_by: one('till.devices', 'claimed_by', { label: 'Collected by' }),
    },
    list: ['queued_at', 'kind', 'title', 'printer.name', 'status', 'waited', 'error'],
    sort: [{ by: 'queued_at', dir: 'desc' }],
    // What was printed, line by line, and the change that made it.
    skip: ['ops', 'event_id'],
  }),
]
