// src/reports/catalogue/online.js
//
// Online ordering in the report catalogue.
//
//   online.orders      your own online ordering's orders, in detail
//   online.items       the dishes on them
//   online.promotions  the promotions and meal deal savings they used
//   online.sales       every online order whatever it came through (your
//                      own ordering and GloriaFood), with its tender: the
//                      Online orders page's Transactions list as a subject
//
// What counts as a sale, which day a GloriaFood order is on and how an
// order was paid are the rules of services/onlineSalesSvc.js
// (onlineTransactions()), written here as SQL from that file's own lists.
// api/test/reports-online.test.mjs holds the two against each other.

import { subject, text, number, money, percent, yesno, choice, moment, duration, sum, avg, count, countDistinct, ratio, one, many } from './define.js'
import { TENDERS, SOURCES, OWN_STATUS, OWN_COUNTED, OWN_FULFILMENT, ownTenderKey } from '../../services/onlineSalesSvc.js'
import { listGateways } from '../../services/paymentGateways/index.js'
import { TYPE_LABELS } from '../../../../shared/gloriafood.js'

// Lists from code become SQL only as plain words (letters, digits, _ : and spaces).
const word = v => {
  const s = String(v)
  if (!/^[A-Za-z0-9_: ]+$/.test(s)) throw new Error('Report catalogue: "' + s + '" can\'t be written into SQL')
  return "'" + s + "'"
}
const inList = list => '(' + [...list].map(word).join(', ') + ')'

const COUNTED_LIST = inList(OWN_COUNTED)
const COUNTED = '{t}.status IN ' + COUNTED_LIST
const ORDER_COUNTED = '{order}.status IN ' + COUNTED_LIST
const LISTED = "{t}.status NOT IN ('pending_payment', 'expired')"

// How an order was paid: its biggest successful payment's method as a
// tender (ownTenderKey()); none yet = unpaid. `o` is the order's alias.
const strip = key => key.replace(/^other:/, '')
function ownTender(o) {
  const keys = [...new Set(['cash', 'card_terminal', 'demo', ...listGateways().map(g => g.key)])]
  const cases = keys.map(k => 'WHEN ' + word(k) + ' THEN ' + word(strip(ownTenderKey(k)))).join(' ')
  return `COALESCE((SELECT CASE p.gateway ${cases} ELSE p.gateway END
                      FROM order_payments p
                     WHERE p.order_id = ${o}.id AND p.tenant_id = ${o}.tenant_id
                       AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
                     ORDER BY p.amount_pence DESC, p.created_at
                     LIMIT 1), 'unpaid')`
}
// A GloriaFood payment as a tender (gfTenderKey()).
const GF_TENDER = `(CASE upper(regexp_replace(btrim(COALESCE(g.payment, '')), '[[:space:]-]+', '_', 'g'))
                      WHEN 'CASH' THEN 'cash' WHEN 'CARD' THEN 'card_counter'
                      WHEN 'CARD_PHONE' THEN 'card_phone' WHEN 'CARD_BY_PHONE' THEN 'card_phone'
                      WHEN 'ONLINE' THEN 'online' WHEN 'PAID_ONLINE' THEN 'online'
                      WHEN '' THEN 'unknown' ELSE btrim(g.payment) END)`

const TENDER_LABELS = { ...TENDERS, unknown: 'Unknown' }
// What a guest can pick at checkout, as the Ordering setup page names it.
const PAY_LABELS = Object.fromEntries(listGateways().map(g => [g.key, g.adminLabel]))
const STATUS_LABELS = { ...OWN_STATUS, missed: 'Missed', pending: 'Pending' }
const TYPE_ALL = { ...OWN_FULFILMENT, ...TYPE_LABELS }

// A GloriaFood order's day: the venue's link says whether it goes by the
// accepted or the fulfil time, and when the trading day starts.
const GF_AT = "(CASE WHEN l.day_basis = 'accepted' THEN g.accepted_at ELSE g.fulfill_at END)"
const GF_DAY = `((${GF_AT} AT TIME ZONE COALESCE(v.timezone, 'Europe/London')) - COALESCE(NULLIF(l.day_starts_at, ''), '00:00')::interval)::date`

const ALL_SALES = `(
  SELECT o.id, o.tenant_id, o.venue_id, 'web'::text AS source, o.service_date AS day,
         COALESCE(o.placed_at, o.created_at) AS at, o.promised_at AS ready_at,
         o.order_number::text AS number, o.fulfilment AS type, o.status,
         (o.status IN ${COUNTED_LIST}) AS counted, ${ownTender('o')} AS tender,
         o.total_pence, o.tip_pence, o.discount_pence, 0 AS fees_pence, o.vat_pence AS tax_pence, o.refunded_pence
    FROM orders o
   WHERE o.status NOT IN ('pending_payment', 'expired')
  UNION ALL
  SELECT g.id, g.tenant_id, g.venue_id, 'gloriafood'::text AS source, ${GF_DAY} AS day,
         COALESCE(g.accepted_at, ${GF_AT}) AS at, g.fulfill_at AS ready_at,
         g.gf_order_id::text AS number, g.order_type AS type,
         (CASE WHEN g.status IN ('canceled', 'cancelled') THEN 'cancelled' ELSE g.status END) AS status,
         (g.status = 'accepted' AND g.source IS DISTINCT FROM 'admin') AS counted, ${GF_TENDER} AS tender,
         g.total_pence, g.tip_pence, g.discount_pence,
         (COALESCE(g.delivery_fee_pence, 0) + COALESCE(g.service_fee_pence, 0)) AS fees_pence, g.tax_pence, 0 AS refunded_pence
    FROM gloriafood_orders g
    JOIN venues v ON v.id = g.venue_id AND v.tenant_id = g.tenant_id
    LEFT JOIN gloriafood_venue_links l ON l.venue_id = g.venue_id AND l.tenant_id = g.tenant_id
)`

export default [
  subject({
    key: 'online.orders',
    label: 'Online orders',
    one: 'online order',
    area: 'online',
    module: 'web_orders',
    about: 'Orders placed through your own online ordering, on the day they were for. An order counts as a sale once it is placed; rejected and cancelled orders are listed but not counted. Unpaid and expired checkouts are left out.',
    from: 'orders',
    where: LISTED,
    name: 'number',
    venue: 'venue_id',
    open: { page: '/orders?order=:id', module: 'web_orders' },
    date: { sql: '{t}.service_date', label: 'Day', about: 'The day the order was for, at the venue.' },
    fields: {
      number: text({ sql: '{t}.order_number::text' }, { label: 'Order' }),
      status: choice('status', OWN_STATUS),
      counted: yesno({ sql: '(' + COUNTED + ')' }, { label: 'Counts as a sale' }),
      fulfilment: choice('fulfilment', OWN_FULFILMENT, { label: 'Type' }),
      tender: choice({ sql: ownTender('{t}') }, TENDER_LABELS, { label: 'Paid by' }),
      payment_status: choice('payment_status', { unpaid: 'Not paid', pending: 'Payment started', paid: 'Paid', failed: 'Payment failed', partially_refunded: 'Partly refunded', refunded: 'Refunded' }, { label: 'Payment' }),
      asap: yesno('is_asap', { label: 'As soon as possible' }),
      placed_at: moment('placed_at', { label: 'Placed' }),
      accepted_at: moment('accepted_at', { label: 'Accepted' }),
      promised_at: moment('promised_at', { label: 'Promised for' }),
      ready_at: moment('ready_at', { label: 'Ready' }),
      completed_at: moment('completed_at', { label: 'Collected' }),
      cancelled_at: moment('cancelled_at', { label: 'Cancelled' }),
      cancel_reason: text('cancel_reason', { label: 'Why cancelled' }),
      time_to_accept: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.accepted_at - {t}.placed_at))' }, { label: 'Placed to accepted' }),
      time_to_ready: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.ready_at - {t}.accepted_at))' }, { label: 'Accepted to ready' }),
      time_to_collect: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.completed_at - {t}.ready_at))' }, { label: 'Ready to collected' }),
      guest_name: text('guest_name', { label: 'Guest name', pii: true }),
      guest_email: text('guest_email', { label: 'Guest email', pii: true }),
      guest_phone: text('guest_phone', { label: 'Guest phone', pii: true }),
      subtotal: money('subtotal_pence', { label: 'Dishes', about: 'Before discounts, charges and tips.' }),
      discount: money('discount_pence'),
      charges: money('charges_pence'),
      tip: money('tip_pence'),
      total: money('total_pence'),
      vat: money('vat_pence', { label: 'VAT' }),
      refunded: money('refunded_pence'),
      net: money({ sql: '({t}.total_pence - {t}.refunded_pence)' }, { label: 'Net', about: 'Total less refunds.' }),
      platform_fee: money('platform_fee_pence', { label: 'Platform fee' }),
      platform_fee_rate: percent('platform_fee_percent', { label: 'Platform fee rate' }),
      paid: money('paid_pence', { label: 'Paid' }),
      channel: choice('channel', { web: 'The website', pos: 'A till', table_qr: 'A table\'s QR code' }, { label: 'Ordered through' }),
      chose_to_pay: choice('payment_method', PAY_LABELS, { label: 'Chose to pay by', about: 'What the guest picked at checkout. Paid by says how the order was paid in the end.' }),
      requested_for: moment('requested_for', { label: 'Asked for' }),
      note: text('notes', { label: 'Order note', pii: true }),
      allergy_note: text('allergy_note', { label: 'Allergy note', pii: true }),
      joined_newsletter: yesno('marketing_opt_in', { label: 'Joined the newsletter' }),
    },
    measures: {
      orders: count({ label: 'Orders', where: COUNTED, about: 'Orders that count as sales: placed, and not rejected or cancelled.' }),
      sales: sum('total_pence', { type: 'money', label: 'Sales', where: COUNTED, about: 'Order totals: tips included, discounts taken off.' }),
      refunded_total: sum('refunded_pence', { type: 'money', label: 'Refunded', where: COUNTED, about: 'Money refunded on orders that count as sales.' }),
      net_sales: sum({ sql: '({t}.total_pence - {t}.refunded_pence)' }, { type: 'money', label: 'Net sales', where: COUNTED, about: 'Sales less refunds.' }),
      dishes_total: sum('subtotal_pence', { type: 'money', label: 'Dishes before discounts', where: COUNTED, about: 'The dishes at full price, on orders that count as sales.' }),
      discounts: sum('discount_pence', { type: 'money', label: 'Discounts', where: COUNTED, about: 'What meal deals, promotions and loyalty rewards took off orders that count as sales.' }),
      charges_total: sum('charges_pence', { type: 'money', label: 'Charges', where: COUNTED, about: 'Charges on orders that count as sales (a bag, a cup deposit).' }),
      tips: sum('tip_pence', { type: 'money', label: 'Tips', where: COUNTED, about: 'Tips on orders that count as sales.' }),
      vat_total: sum('vat_pence', { type: 'money', label: 'VAT', where: COUNTED, about: 'The VAT in orders that count as sales.' }),
      platform_fees: sum('platform_fee_pence', { type: 'money', label: 'Platform fees', where: COUNTED, about: 'Macaroonie\'s fee on orders that count as sales.' }),
      average_order: ratio('sales', 'orders', { type: 'money', label: 'Average order', about: 'Sales divided by the orders that count as sales.' }),
      refunded_orders: count({ label: 'Orders refunded', where: COUNTED + ' AND {t}.refunded_pence > 0', about: 'Orders that count as sales with any of their money refunded.' }),
      not_counted: count({ label: 'Rejected or cancelled', where: 'NOT (' + COUNTED + ')', about: 'Orders rejected or cancelled (not counted as sales).' }),
      average_accept: avg({ sql: 'EXTRACT(EPOCH FROM ({t}.accepted_at - {t}.placed_at))' }, { type: 'duration', label: 'Average placed to accepted', where: COUNTED, about: 'How long orders waited to be accepted, on average.' }),
      average_ready: avg({ sql: 'EXTRACT(EPOCH FROM ({t}.ready_at - {t}.accepted_at))' }, { type: 'duration', label: 'Average accepted to ready', where: COUNTED, about: 'How long orders took from accepted to ready, on average.' }),
    },
    links: {
      customer: one('guests.customers', 'customer_id', { label: 'Customer', needs: 'customers' }),
      order_type: one('till.order_types', 'order_type_id', { label: 'Order type' }),
      stream: one('till.streams', 'revenue_stream_id', { label: 'Revenue stream' }),
      items: many('online.items', 'order_id', { label: 'Dishes ordered' }),
      promotions: many('online.promotions', 'order_id', { label: 'Promotions used' }),
    },
    list: ['date', 'number', 'venue.name', 'status', 'fulfilment', 'tender', 'total', 'refunded', 'placed_at'],
    sort: [{ by: 'placed_at', dir: 'desc' }],
    skip: [
      'loyalty_member_id',
      // The guest's link to their order, and what they agreed to when ordering.
      'public_token', 'consent', 'data_consent_at',
      // Charges and flows in full (their total is the Charges field); bookkeeping.
      'charges', 'flows', 'currency', 'created_at', 'updated_at', 'loyalty_settled_key',
    ],
  }),

  subject({
    key: 'online.items',
    label: 'Dishes ordered online',
    one: 'dish ordered online',
    area: 'online',
    module: 'web_orders',
    about: 'Each dish on an online order, on the order\'s day. Dishes on rejected and cancelled orders are left out of the figures.',
    from: 'order_items',
    where: "{order}.status NOT IN ('pending_payment', 'expired')",
    name: 'name',
    venue: { sql: '{order}.venue_id' },
    open: 'order',
    date: { sql: '{order}.service_date', label: 'Day' },
    fields: {
      name: text('name', { label: 'Dish' }),
      qty: number('qty', { label: 'Quantity', adds: true, decimals: 0 }),
      unit_price: money('unit_price_pence', { label: 'Price each', adds: false }),
      line_total: money('line_total_pence', { label: 'Line total', about: 'Before discounts.' }),
      discount: money('discount_pence'),
      vat: money('vat_pence', { label: 'VAT' }),
      note: text('note'),
      vat_rate: percent('vat_rate', { label: 'VAT rate' }),
      from_flow: yesno({ sql: '({t}.flow IS NOT NULL)' }, { label: 'Added by an order flow' }),
    },
    measures: {
      qty_sold: sum('qty', { label: 'Quantity sold', where: ORDER_COUNTED, about: 'How many were sold, on orders that count as sales.' }),
      gross_sales: sum('line_total_pence', { type: 'money', label: 'Sales before discounts', where: ORDER_COUNTED, about: 'The dishes at their price with their options, on orders that count as sales.' }),
      discounts: sum('discount_pence', { type: 'money', label: 'Discounts', where: ORDER_COUNTED, about: 'What meal deals, promotions and loyalty rewards took off these dishes, on orders that count as sales.' }),
      net_sales: sum({ sql: '({t}.line_total_pence - {t}.discount_pence)' }, { type: 'money', label: 'Net sales', where: ORDER_COUNTED, about: 'The dishes after discounts, on orders that count as sales.' }),
      orders: countDistinct('order_id', { label: 'Orders', where: ORDER_COUNTED, about: 'How many different orders these dishes were on.' }),
    },
    links: {
      order: one('online.orders', 'order_id', { label: 'Order' }),
      item: one('menu.dishes', 'menu_item_id', { label: 'Menu dish' }),
    },
    list: ['date', 'order.number', 'name', 'qty', 'line_total', 'discount', 'note'],
    sort: [{ by: 'date', dir: 'desc' }],
    // A dish's options and a meal deal's parts are lists inside the row.
    skip: ['options', 'parts', 'sort_order'],
  }),

  subject({
    key: 'online.promotions',
    label: 'Promotions used online',
    one: 'promotion used',
    area: 'online',
    module: 'web_orders',
    about: 'Each promotion or meal deal saving on an online order, with the discount it gave.',
    from: 'order_promotions',
    where: "{order}.status NOT IN ('pending_payment', 'expired')",
    name: 'name',
    venue: { sql: '{order}.venue_id' },
    open: 'order',
    date: { sql: '{order}.service_date', label: 'Day' },
    fields: {
      name: text('name', { label: 'Promotion' }),
      code: text('code', { label: 'Code used' }),
      kind: choice({ sql: "(CASE WHEN {t}.combo_item_id IS NOT NULL THEN 'combo' ELSE 'promotion' END)" }, { promotion: 'Promotion', combo: 'Meal deal' }),
      discount: money('discount_pence'),
    },
    measures: {
      times_used: count({ label: 'Times used', where: ORDER_COUNTED, about: 'How many times the promotion was used, on orders that count as sales.' }),
      discount_given: sum('discount_pence', { type: 'money', label: 'Discount given', where: ORDER_COUNTED, about: 'What the promotion took off, on orders that count as sales.' }),
      orders: countDistinct('order_id', { label: 'Orders', where: ORDER_COUNTED, about: 'How many different orders used the promotion.' }),
    },
    links: {
      order: one('online.orders', 'order_id', { label: 'Order' }),
    },
    list: ['date', 'order.number', 'name', 'kind', 'code', 'discount'],
    sort: [{ by: 'date', dir: 'desc' }],
    skip: ['promotion_id', 'created_at'],
  }),

  subject({
    key: 'online.sales',
    label: 'Online sales, every source',
    one: 'online sale',
    area: 'online',
    module: 'web_orders',
    about: 'Every online order whatever it came through: your own online ordering and GloriaFood, each with how it was paid. GloriaFood orders sit on the trading day their Cash Recon link puts them on. The same list as Online orders, Transactions.',
    from: { sql: ALL_SALES, tables: ['orders', 'order_payments', 'gloriafood_orders', 'gloriafood_venue_links'] },
    name: 'number',
    venue: 'venue_id',
    open: { page: '/orders?order=:id', module: 'web_orders', id: { sql: "(CASE WHEN {t}.source = 'web' THEN {t}.id END)" }, label: 'Open the order' },
    date: { sql: '{t}.day', label: 'Day' },
    fields: {
      source: choice('source', SOURCES, { label: 'Source' }),
      number: text('number', { label: 'Order' }),
      type: choice('type', TYPE_ALL),
      status: choice('status', STATUS_LABELS),
      counted: yesno('counted', { label: 'Counts as a sale' }),
      tender: choice('tender', TENDER_LABELS, { label: 'Paid by' }),
      at: moment('at', { label: 'Time' }),
      ready_at: moment('ready_at', { label: 'Ready for' }),
      total: money('total_pence'),
      tip: money('tip_pence'),
      discount: money('discount_pence'),
      fees: money('fees_pence', { label: 'Delivery and fees' }),
      tax: money('tax_pence', { label: 'VAT or tax' }),
      refunded: money('refunded_pence'),
      net: money({ sql: '(CASE WHEN {t}.counted THEN {t}.total_pence - {t}.refunded_pence ELSE 0 END)' }, { label: 'Net' }),
    },
    measures: {
      orders: count({ label: 'Orders', where: '{t}.counted', about: 'Orders that count as sales: your own orders placed and not rejected or cancelled, and GloriaFood orders accepted (test orders left out).' }),
      sales: sum('total_pence', { type: 'money', label: 'Sales', where: '{t}.counted', about: 'Order totals, tips included, on orders that count as sales.' }),
      refunded_total: sum('refunded_pence', { type: 'money', label: 'Refunded', where: '{t}.counted', about: 'Money refunded on orders that count as sales.' }),
      net_sales: sum({ sql: '({t}.total_pence - {t}.refunded_pence)' }, { type: 'money', label: 'Net sales', where: '{t}.counted', about: 'Sales less refunds.' }),
      tips: sum('tip_pence', { type: 'money', label: 'Tips', where: '{t}.counted', about: 'Tips on orders that count as sales.' }),
      discounts: sum('discount_pence', { type: 'money', label: 'Discounts', where: '{t}.counted', about: 'Discounts on orders that count as sales.' }),
      fees_total: sum('fees_pence', { type: 'money', label: 'Delivery and fees', where: '{t}.counted', about: 'Delivery and other fees on orders that count as sales.' }),
      tax_total: sum('tax_pence', { type: 'money', label: 'VAT or tax', where: '{t}.counted', about: 'The VAT or tax in orders that count as sales.' }),
      average_order: ratio('sales', 'orders', { type: 'money', label: 'Average order', about: 'Sales divided by the orders that count as sales (your own and GloriaFood).' }),
      not_counted: count({ label: 'Not counted', where: 'NOT {t}.counted', about: 'Orders that don\'t count as sales: your own rejected or cancelled orders, and GloriaFood orders not accepted or sent as tests.' }),
    },
    list: ['date', 'at', 'source', 'number', 'type', 'status', 'tender', 'total', 'refunded', 'net'],
    sort: [{ by: 'at', dir: 'desc' }],
  }),
]
