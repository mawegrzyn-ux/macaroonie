// src/reports/catalogue/purchasing.js
//
// Purchasing in the report catalogue: supplier orders and their lines, the
// invoices read when deliveries were booked in, restaurants' own orders,
// suppliers, inventory items, supplier prices and their changes.
//
// Purchasing keeps money in pounds. Prices are shown only to people who see
// purchasing prices on its pages (Purchasing setup, View): every money field
// and figure here needs that module too. A line's amounts follow
// lineAmounts() in shared/procurement.js (price times packs, rounded to the
// penny; VAT on that, rounded), so a supplier order's lines add up to its
// goods and VAT. Orders count unless cancelled; deliveries booked in without
// an order count with them. Test orders the H&S test data made are read like
// real ones, as till test sales are.

import { subject, text, number, money, percent, yesno, choice, date, moment, duration, sum, avg, count, ratio, one, many } from './define.js'

const PRICES = 'purchasing_setup'
const pounds = (src, opts = {}) => money(src, { unit: 'pounds', needs: PRICES, ...opts })
const spend = (src, opts = {}) => sum(src, { type: 'money', unit: 'pounds', needs: PRICES, ...opts })

const LIVE = "{t}.status <> 'cancelled'"
const ORDER_LIVE = "{order}.status <> 'cancelled'"
const NET = 'round({t}.price * {t}.qty, 2)'
const VAT = 'round(round({t}.price * {t}.qty, 2) * {t}.vat_rate / 100, 2)'
const RECEIVED_LATE = "({t}.status = 'received' AND ({t}.received_at AT TIME ZONE {tz})::date > {t}.delivery_date)"
const PROBLEM = "{t}.receive_status IN ('short', 'damaged', 'substituted', 'missing')"

const STORAGE = { ambient: 'Cupboard', chilled: 'Chilled', frozen: 'Frozen' }
const UNITS = { g: 'Grams', ml: 'Millilitres', each: 'Each' }
// delivery_days hold 0 (Sunday) to 6 (Saturday), as shared/procurement.js reads them.
const DAY_NAMES = "(SELECT string_agg((ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[d + 1], ', ' ORDER BY (d + 6) % 7) FROM unnest({t}.delivery_days) AS d)"
const HHMM = col => "to_char({t}." + col + ", 'HH24:MI')"
// The price before this one for the same supplier price and the same venue (or for every venue).
const BEFORE = `(SELECT h2.price FROM inv_price_history h2
                  WHERE h2.tenant_id = {t}.tenant_id AND h2.quote_id = {t}.quote_id
                    AND h2.venue_id IS NOT DISTINCT FROM {t}.venue_id
                    AND (h2.changed_at, h2.id) < ({t}.changed_at, {t}.id)
                  ORDER BY h2.changed_at DESC, h2.id DESC LIMIT 1)`

export default [
  subject({
    key: 'purchasing.orders',
    label: 'Supplier orders',
    one: 'supplier order',
    area: 'purchasing',
    module: 'purchasing',
    about: 'Every order sent to a supplier, on the day it is to be delivered, and every delivery booked in without an order. Orders count unless cancelled; money is what was ordered, with VAT and delivery charges.',
    from: 'purchase_orders',
    name: 'number',
    venue: 'venue_id',
    open: { page: '/purchasing?po=:id', module: 'purchasing' },
    date: { sql: '{t}.delivery_date', label: 'Delivery day', about: 'The day the order is to be delivered (the day it came, for a delivery booked in without an order).' },
    fields: {
      number: text({ sql: "('PO-' || lpad({t}.number::text, 5, '0'))" }, { label: 'Order number' }),
      status: choice('status', { to_send: 'To send', sent: 'Sent', received: 'Booked in', cancelled: 'Cancelled' }),
      no_order: yesno('no_order', { label: 'Booked in without an order' }),
      sent_via: choice('sent_via', { email: 'Email', print: 'Printed', excel: 'Excel file', pdf: 'PDF file', phone: 'Phone', website: 'Their website', other: 'Another way' }, { label: 'Sent as' }),
      supplier_ref: text('supplier_ref', { label: 'Their reference' }),
      notes: text('notes', { label: 'Note to the supplier' }),
      receive_notes: text('receive_notes', { label: 'Delivery notes' }),
      send_error: text('send_error', { label: 'Sending problem' }),
      sent_to: text('sent_to', { label: 'Sent to' }),
      made_at: moment('created_at', { label: 'Made at' }),
      made_by: text('created_by', { label: 'Made by' }),
      sent_at: moment('sent_at', { label: 'Sent at' }),
      sent_by: text('sent_by', { label: 'Sent by' }),
      received_at: moment('received_at', { label: 'Booked in at' }),
      received_by: text('received_by', { label: 'Booked in by' }),
      cancelled_at: moment('cancelled_at', { label: 'Cancelled at' }),
      cancelled_by: text('cancelled_by', { label: 'Cancelled by' }),
      requested_by: text('requested_by', { label: 'Asked for by' }),
      amended: yesno({ sql: '({t}.amended_at IS NOT NULL)' }, { label: 'Changed after sending' }),
      amended_at: moment('amended_at', { label: 'Changed at' }),
      amended_by: text('amended_by', { label: 'Changed by' }),
      received_late: yesno({ sql: RECEIVED_LATE }, { label: 'Booked in after its day' }),
      goods_value: pounds('subtotal', { label: 'Goods' }),
      vat_value: pounds('vat', { label: 'VAT' }),
      delivery_value: pounds('delivery_charge', { label: 'Delivery charge' }),
      total_value: pounds('total', { label: 'Total' }),
    },
    measures: {
      orders: count({ label: 'Orders', where: LIVE, about: 'Supplier orders that weren\'t cancelled, deliveries booked in without an order included.' }),
      spend: spend('total', { label: 'Spend', where: LIVE, about: 'What the orders that weren\'t cancelled came to, with VAT and delivery charges, at the prices ordered.' }),
      goods: spend('subtotal', { label: 'Goods', where: LIVE, about: 'What the orders that weren\'t cancelled came to before VAT and delivery charges.' }),
      vat: spend('vat', { label: 'VAT', where: LIVE, about: 'The VAT on the orders that weren\'t cancelled.' }),
      delivery_charges: spend('delivery_charge', { label: 'Delivery charges', where: LIVE, about: 'Suppliers\' delivery charges on the orders that weren\'t cancelled.' }),
      average_order: ratio('spend', 'orders', { type: 'money', needs: PRICES, label: 'Average order', about: 'Spend divided by the orders that weren\'t cancelled.' }),
      received: count({ label: 'Booked in', where: "{t}.status = 'received'", about: 'Orders whose delivery was booked in.' }),
      to_send: count({ label: 'Still to send', where: "{t}.status = 'to_send'", about: 'Orders placed but not sent to the supplier yet.' }),
      cancelled: count({ label: 'Cancelled', where: "{t}.status = 'cancelled'", about: 'Orders cancelled.' }),
      without_order: count({ label: 'Booked in without an order', where: '{t}.no_order', about: 'Deliveries booked in that nobody had ordered.' }),
      received_late_count: count({ label: 'Booked in after their day', where: RECEIVED_LATE, about: 'Deliveries booked in on a later day than the order was for.' }),
      changed: count({ label: 'Changed after sending', where: '{t}.amended_at IS NOT NULL', about: 'Orders changed (or split) after the supplier had them.' }),
    },
    links: {
      supplier: one('purchasing.suppliers', 'supplier_id', { label: 'Supplier' }),
      restaurant_order: one('purchasing.restaurant_orders', 'supply_order_id', { label: 'Restaurant order' }),
      split_from: one('purchasing.orders', 'split_from', { label: 'Split off from' }),
      lines: many('purchasing.order_lines', 'po_id', { label: 'Lines' }),
      invoices: many('purchasing.invoices', 'po_id', { label: 'Invoices' }),
      delivery_checks: many('safety.delivery_checks', 'purchase_order_id', { label: 'Delivery checks' }),
    },
    list: ['number', 'date', 'venue.name', 'supplier.name', 'status', 'total_value'],
    sort: [{ by: 'date', dir: 'desc' }],
    skip: ['is_generated', 'updated_at'],
  }),

  subject({
    key: 'purchasing.order_lines',
    label: 'Supplier order lines',
    one: 'line',
    area: 'purchasing',
    module: 'purchasing',
    about: 'Each product on a supplier order: what was ordered, what came, and the invoice\'s price where one was read. Figures leave out cancelled orders.',
    from: 'purchase_order_lines',
    name: 'item_name',
    venue: { sql: '{order}.venue_id' },
    open: 'order',
    date: { sql: '{order}.delivery_date', label: 'Delivery day', about: 'The day its order is to be delivered.' },
    fields: {
      item_name: text('item_name', { label: 'Item' }),
      product_name: text('product_name', { label: 'Their product name' }),
      supplier_code: text('supplier_code', { label: 'Their code' }),
      category_name: text('category_name', { label: 'Category' }),
      storage: choice('storage', STORAGE),
      base_unit: choice('base_unit', UNITS, { label: 'Measured in' }),
      pack_label: text('pack_label', { label: 'Pack' }),
      pack_base_qty: number('pack_base_qty', { label: 'Pack holds (g, ml or each)' }),
      qty: number('qty', { label: 'Packs ordered', adds: true }),
      received_qty: number('received_qty', { label: 'Packs received', adds: true }),
      packs_short: number({ sql: '(CASE WHEN {t}.received_qty IS NULL THEN NULL ELSE GREATEST({t}.qty - {t}.received_qty, 0) END)' }, { label: 'Packs short', adds: true }),
      receive_status: choice('receive_status', { ok: 'As ordered', short: 'Short', damaged: 'Damaged', substituted: 'Something else came', missing: 'Missing' }, { label: 'On arrival' }),
      receive_note: text('receive_note', { label: 'Delivery note' }),
      added_on_receipt: yesno('added_on_receipt', { label: 'Added when booked in' }),
      price: pounds('price', { label: 'Price per pack', adds: false }),
      vat_rate: percent('vat_rate', { label: 'VAT rate' }),
      goods_value: pounds({ sql: NET }, { label: 'Goods' }),
      vat_value: pounds({ sql: VAT }, { label: 'VAT' }),
      total_value: pounds({ sql: '(' + NET + ' + ' + VAT + ')' }, { label: 'Total' }),
      received_value: pounds({ sql: 'round({t}.price * COALESCE({t}.received_qty, 0), 2)' }, { label: 'Goods received' }),
      invoice_price: pounds('invoice_price', { label: 'Invoice price per pack', adds: false }),
      price_difference: pounds({ sql: '({t}.invoice_price - {t}.price)' }, { label: 'Invoice price over the order\'s', adds: false }),
      invoice_name: text('invoice_name', { label: 'Name on the invoice' }),
      invoice_code: text('invoice_code', { label: 'Code on the invoice' }),
      invoice_pack: text('invoice_pack', { label: 'Pack on the invoice' }),
      invoice_vat_rate: percent('invoice_vat_rate', { label: 'VAT rate on the invoice' }),
    },
    measures: {
      lines: count({ label: 'Lines', where: ORDER_LIVE, about: 'Lines on orders that weren\'t cancelled.' }),
      packs: sum('qty', { label: 'Packs ordered', where: ORDER_LIVE, about: 'Packs ordered, on orders that weren\'t cancelled.' }),
      packs_received: sum('received_qty', { label: 'Packs received', where: ORDER_LIVE, about: 'Packs that came, on deliveries booked in.' }),
      goods: spend({ sql: NET }, { label: 'Goods', where: ORDER_LIVE, about: 'Price per pack times packs ordered, before VAT, on orders that weren\'t cancelled.' }),
      vat: spend({ sql: VAT }, { label: 'VAT', where: ORDER_LIVE, about: 'The VAT on those lines.' }),
      spend: spend({ sql: '(' + NET + ' + ' + VAT + ')' }, { label: 'Spend', where: ORDER_LIVE, about: 'Goods and VAT on those lines (delivery charges are on the order).' }),
      problems: count({ label: 'Lines with a problem', where: PROBLEM, about: 'Lines booked in short, damaged, missing, or with something else in their place.' }),
      short: count({ label: 'Short', where: "{t}.receive_status = 'short'", about: 'Lines that came short.' }),
      damaged: count({ label: 'Damaged', where: "{t}.receive_status = 'damaged'", about: 'Lines that came damaged.' }),
      missing: count({ label: 'Missing', where: "{t}.receive_status = 'missing'", about: 'Lines that didn\'t come.' }),
      substituted: count({ label: 'Something else came', where: "{t}.receive_status = 'substituted'", about: 'Lines where the supplier sent something else.' }),
      charged_more: count({ label: 'Invoiced above the order\'s price', where: '{t}.invoice_price > {t}.price', needs: PRICES, about: 'Lines whose invoice price per pack was above the price ordered at.' }),
      invoice_difference: spend({ sql: 'round(({t}.invoice_price - {t}.price) * COALESCE({t}.received_qty, {t}.qty), 2)' }, {
        label: 'Invoice difference', where: '{t}.invoice_price IS NOT NULL',
        about: 'What the invoices charged above the prices ordered at, for the packs received (a minus is less).',
      }),
    },
    links: {
      order: one('purchasing.orders', 'po_id', { label: 'Order' }),
      item: one('purchasing.items', 'item_id', { label: 'Inventory item' }),
      price_row: one('purchasing.prices', 'quote_id', { label: 'Supplier price' }),
      invoice: one('purchasing.invoices', 'invoice_id', { label: 'Invoice' }),
    },
    list: ['date', 'order.number', 'order.supplier.name', 'item_name', 'pack_label', 'qty', 'received_qty', 'receive_status', 'goods_value'],
    sort: [{ by: 'date', dir: 'desc' }],
    skip: ['pack_spec', 'sort_order'],
  }),

  subject({
    key: 'purchasing.invoices',
    label: 'Supplier invoices',
    one: 'invoice',
    area: 'purchasing',
    module: 'purchasing',
    about: 'Invoices and delivery notes Pepper read when deliveries were booked in, as printed on them.',
    from: 'purchase_invoices',
    name: 'invoice_number',
    venue: 'venue_id',
    open: 'order',
    date: { sql: 'COALESCE({t}.invoice_date, ({t}.read_at AT TIME ZONE {tz})::date)', label: 'Invoice date', about: 'The date printed on the invoice, else the day it was read.' },
    fields: {
      invoice_number: text('invoice_number', { label: 'Invoice number' }),
      supplier_name: text('supplier_name', { label: 'Supplier on the invoice' }),
      printed_date: date('invoice_date', { label: 'Date printed' }),
      prices_include_vat: yesno('prices_include_vat', { label: 'Prices included VAT' }),
      goods_value: pounds('subtotal', { label: 'Goods' }),
      vat_value: pounds('vat', { label: 'VAT' }),
      delivery_value: pounds('delivery_charge', { label: 'Delivery charge' }),
      total_value: pounds('total', { label: 'Total' }),
      notes: text('notes', { label: 'Notes' }),
      read_at: moment('read_at', { label: 'Read at' }),
      read_by: text('read_by', { label: 'Read by' }),
      used: yesno({ sql: '({t}.applied_at IS NOT NULL)' }, { label: 'Used to book the delivery in' }),
      applied_at: moment('applied_at', { label: 'Used at' }),
      applied_by: text('applied_by', { label: 'Used by' }),
    },
    measures: {
      invoices: count({ label: 'Invoices' }),
      invoiced: spend('total', { label: 'Invoiced', about: 'What the invoices came to, as printed.' }),
      invoiced_vat: spend('vat', { label: 'VAT invoiced', about: 'The VAT printed on the invoices.' }),
    },
    links: {
      supplier: one('purchasing.suppliers', 'supplier_id', { label: 'Supplier' }),
      order: one('purchasing.orders', 'po_id', { label: 'Order' }),
      lines: many('purchasing.order_lines', 'invoice_id', { label: 'Order lines matched' }),
    },
    list: ['date', 'invoice_number', 'supplier.name', 'venue.name', 'order.number', 'total_value'],
    sort: [{ by: 'read_at', dir: 'desc' }],
    // The pictures and the lines as read: the order's lines carry what was matched.
    skip: ['files', 'lines'],
  }),

  subject({
    key: 'purchasing.restaurant_orders',
    label: 'Restaurant orders',
    one: 'restaurant order',
    area: 'purchasing',
    module: 'purchasing',
    about: 'The orders restaurants filled in from their order lists: drafts, orders waiting for approval and orders placed (each placed one became supplier orders).',
    from: 'supply_orders',
    name: 'list_name',
    venue: 'venue_id',
    open: { page: '/purchasing?order=:id', module: 'purchasing' },
    date: { sql: '({t}.created_at AT TIME ZONE {tz})::date', bound: '{t}.created_at', label: 'Day started' },
    fields: {
      list_name: text({ sql: '(SELECT l.name FROM order_lists l WHERE l.id = {t}.list_id AND l.tenant_id = {t}.tenant_id)' }, { label: 'Order list' }),
      status: choice('status', { draft: 'Being filled in', requested: 'Waiting for approval', submitted: 'Placed' }),
      notes: text('notes', { label: 'Notes' }),
      started_at: moment('created_at', { label: 'Started at' }),
      started_by: text('created_by', { label: 'Started by' }),
      requested_at: moment('requested_at', { label: 'Sent for approval at' }),
      requested_by: text('requested_by', { label: 'Sent for approval by' }),
      placed_at: moment('submitted_at', { label: 'Placed at' }),
      placed_by: text('submitted_by', { label: 'Placed by' }),
      sent_back: yesno({ sql: '({t}.returned_at IS NOT NULL)' }, { label: 'Sent back' }),
      returned_at: moment('returned_at', { label: 'Sent back at' }),
      returned_by: text('returned_by', { label: 'Sent back by' }),
      return_note: text('return_note', { label: 'Why it was sent back' }),
      waited: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.submitted_at - {t}.requested_at))' }, { label: 'Waited for approval' }),
    },
    measures: {
      orders: count({ label: 'Restaurant orders' }),
      placed: count({ label: 'Placed', where: "{t}.status = 'submitted'", about: 'Orders placed (each became one supplier order for each supplier on it).' }),
      sent_for_approval: count({ label: 'Sent for approval', where: '{t}.requested_at IS NOT NULL', about: 'Orders that went to a manager for approval.' }),
      waiting: count({ label: 'Waiting for approval', where: "{t}.status = 'requested'", about: 'Orders waiting for a manager now.' }),
      sent_back_count: count({ label: 'Sent back', where: '{t}.returned_at IS NOT NULL', about: 'Orders a manager sent back to be changed.' }),
      average_wait: avg({ sql: 'EXTRACT(EPOCH FROM ({t}.submitted_at - {t}.requested_at))' }, {
        type: 'duration', label: 'Average wait for approval', where: '{t}.submitted_at IS NOT NULL AND {t}.requested_at IS NOT NULL',
        about: 'How long orders sent for approval waited before they were placed.',
      }),
    },
    links: {
      split_from: one('purchasing.restaurant_orders', 'split_from', { label: 'Split off from' }),
      supplier_orders: many('purchasing.orders', 'supply_order_id', { label: 'Supplier orders' }),
    },
    list: ['date', 'venue.name', 'list_name', 'status', 'started_by', 'placed_at'],
    sort: [{ by: 'started_at', dir: 'desc' }],
    // What was asked for and the days wanted (the order's working copy), and
    // the purchase orders it was added to (found from those orders).
    skip: ['requested_lines', 'supplier_options', 'added_to_po_ids', 'updated_at'],
  }),

  subject({
    key: 'purchasing.suppliers',
    label: 'Suppliers',
    one: 'supplier',
    area: 'purchasing',
    module: 'purchasing_setup',
    about: 'Your suppliers, with how orders go to them and when they deliver.',
    from: 'suppliers',
    name: 'name',
    fields: {
      name: text('name'),
      contact_name: text('contact_name', { label: 'Contact', pii: true }),
      phone: text('phone'),
      email: text('email'),
      website: text('website'),
      account_ref: text('account_ref', { label: 'Your account number' }),
      send_method: choice('send_method', { email: 'Email', print: 'Printed', excel: 'Excel file', pdf: 'PDF file' }, { label: 'Orders go by' }),
      cutoff: text({ sql: HHMM('cutoff_time') }, { label: 'Order by' }),
      lead_days: number('lead_days', { label: 'Days\' notice', decimals: 0 }),
      delivery_days: text({ sql: DAY_NAMES }, { label: 'Delivery days' }),
      min_order: pounds('min_order', { label: 'Smallest order', adds: false }),
      delivery_charge: pounds('delivery_charge', { label: 'Delivery charge', adds: false }),
      ref_required: yesno('ref_required', { label: 'Needs their reference' }),
      active: yesno('is_active', { label: 'In use' }),
      notes: text('notes'),
      added_at: moment('created_at', { label: 'Added at' }),
    },
    measures: {
      suppliers: count({ label: 'Suppliers', where: '{t}.is_active', about: 'Suppliers in use.' }),
    },
    links: {
      prices: many('purchasing.prices', 'supplier_id', { label: 'Prices' }),
      orders: many('purchasing.orders', 'supplier_id', { label: 'Orders' }),
      invoices: many('purchasing.invoices', 'supplier_id', { label: 'Invoices' }),
    },
    list: ['name', 'send_method', 'cutoff', 'delivery_days', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['cc_emails', 'email_attachment', 'updated_at'],
  }),

  subject({
    key: 'purchasing.items',
    label: 'Inventory items',
    one: 'item',
    area: 'purchasing',
    module: 'purchasing_setup',
    about: 'The things you buy, each with the supplier prices it can be ordered at.',
    from: 'inv_items',
    name: 'name',
    fields: {
      name: text('name'),
      code: text('code', { label: 'Our code' }),
      base_unit: choice('base_unit', UNITS, { label: 'Measured in' }),
      storage: choice('storage', STORAGE),
      active: yesno('is_active', { label: 'In use' }),
      notes: text('notes'),
      added_at: moment('created_at', { label: 'Added at' }),
    },
    measures: {
      items: count({ label: 'Items', where: '{t}.is_active', about: 'Items in use.' }),
    },
    links: {
      category: one('purchasing.categories', 'category_id', { label: 'Category' }),
      prices: many('purchasing.prices', 'item_id', { label: 'Supplier prices' }),
      lines: many('purchasing.order_lines', 'item_id', { label: 'Order lines' }),
    },
    list: ['name', 'category.name', 'code', 'base_unit', 'storage', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['updated_at'],
  }),

  subject({
    key: 'purchasing.categories',
    label: 'Inventory categories',
    one: 'category',
    area: 'purchasing',
    module: 'purchasing_setup',
    about: 'The categories your inventory items are grouped in.',
    from: 'inv_categories',
    name: 'name',
    fields: {
      name: text('name'),
    },
    measures: { categories: count({ label: 'Categories' }) },
    links: {
      items: many('purchasing.items', 'category_id', { label: 'Items' }),
    },
    list: ['name'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at'],
  }),

  subject({
    key: 'purchasing.prices',
    label: 'Supplier prices',
    one: 'supplier price',
    area: 'purchasing',
    module: 'purchasing_setup',
    about: 'What each supplier charges for an item: the pack, the price per pack before VAT, and whether it is out of stock.',
    from: 'inv_quotes',
    name: 'product',
    fields: {
      product: text({ sql: "({item}.name || ' (' || {t}.pack_name || ')')" }, { label: 'Product' }),
      product_name: text('product_name', { label: 'Their product name' }),
      supplier_code: text('supplier_code', { label: 'Their code' }),
      pack_name: text('pack_name', { label: 'Pack' }),
      pack_count: number('pack_count', { label: 'In a pack', decimals: 0 }),
      pack_qty: number('pack_qty', { label: 'Each holds' }),
      pack_unit: text('pack_unit', { label: 'Unit' }),
      pack_base_qty: number('pack_base_qty', { label: 'Pack holds (g, ml or each)' }),
      price: pounds('price', { label: 'Price per pack', adds: false }),
      vat_rate: percent('vat_rate', { label: 'VAT rate' }),
      min_qty: number('min_qty', { label: 'Smallest order' }),
      order_multiple: number('order_multiple', { label: 'Ordered in steps of' }),
      active: yesno('is_active', { label: 'In use' }),
      notes: text('notes'),
      out_of_stock: yesno({ sql: 'COALESCE({t}.out_of_stock_until > (now() AT TIME ZONE {tz})::date, false)' }, { label: 'Out of stock now' }),
      out_of_stock_until: date('out_of_stock_until', { label: 'Out of stock until' }),
      out_of_stock_note: text('out_of_stock_note', { label: 'Out of stock note' }),
      out_of_stock_by: text('out_of_stock_by', { label: 'Marked out of stock by' }),
      out_of_stock_at: moment('out_of_stock_at', { label: 'Marked out of stock at' }),
      added_at: moment('created_at', { label: 'Added at' }),
      changed_at: moment('updated_at', { label: 'Last changed' }),
    },
    measures: {
      prices: count({ label: 'Prices', where: '{t}.is_active', about: 'Supplier prices in use.' }),
      out_of_stock_count: count({ label: 'Out of stock', where: '{t}.is_active AND {t}.out_of_stock_until > (now() AT TIME ZONE {tz})::date', about: 'Supplier prices in use marked out of stock today.' }),
    },
    links: {
      item: one('purchasing.items', 'item_id', { label: 'Item' }),
      supplier: one('purchasing.suppliers', 'supplier_id', { label: 'Supplier' }),
      changes: many('purchasing.price_changes', 'quote_id', { label: 'Price changes' }),
    },
    list: ['product', 'supplier.name', 'supplier_code', 'price', 'vat_rate', 'out_of_stock', 'active'],
    sort: [{ by: 'product', dir: 'asc' }],
  }),

  subject({
    key: 'purchasing.price_changes',
    label: 'Supplier price changes',
    one: 'price change',
    area: 'purchasing',
    module: 'purchasing_setup',
    about: 'Every time a supplier price was set: typed in, imported, or taken from an invoice, with the price before it for the same venue (or for every venue).',
    from: 'inv_price_history',
    venue: 'venue_id',
    date: { sql: '({t}.changed_at AT TIME ZONE {tz})::date', bound: '{t}.changed_at', label: 'Day changed' },
    fields: {
      price: pounds('price', { label: 'New price per pack', adds: false }),
      previous_price: pounds({ sql: BEFORE }, { label: 'Price before', adds: false }),
      change: pounds({ sql: '({t}.price - ' + BEFORE + ')' }, { label: 'Change per pack', adds: false }),
      change_rate: percent({ sql: '(({t}.price - ' + BEFORE + ') / NULLIF(' + BEFORE + ', 0))' }, { unit: 'fraction', label: 'Change' }),
      every_venue: yesno({ sql: '({t}.venue_id IS NULL)' }, { label: 'For every venue' }),
      source: choice('source', { manual: 'Typed in', import: 'Imported', invoice: 'From an invoice' }, { label: 'Set by' }),
      changed_at: moment('changed_at', { label: 'Changed at' }),
      changed_by: text('changed_by', { label: 'Changed by' }),
    },
    measures: {
      changes: count({ label: 'Price changes' }),
      rises: count({ label: 'Went up', where: '{t}.price > ' + BEFORE, about: 'Changes to a higher price than the one before.' }),
      falls: count({ label: 'Went down', where: '{t}.price < ' + BEFORE, about: 'Changes to a lower price than the one before.' }),
    },
    links: {
      price_row: one('purchasing.prices', 'quote_id', { label: 'Supplier price' }),
      order: one('purchasing.orders', 'po_id', { label: 'From the order' }),
    },
    list: ['date', 'price_row.product', 'price_row.supplier.name', 'venue.name', 'previous_price', 'price', 'change_rate', 'source'],
    sort: [{ by: 'changed_at', dir: 'desc' }],
  }),
]
