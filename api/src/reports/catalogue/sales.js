// src/reports/catalogue/sales.js
//
// Sales, every till (docs/SALES_IMPORT.md 3.5 and 6, sales import phase 4):
// our own till's checks, dishes and payments beside the sales imported from
// other tills (Loyverse now), each row with its `source`. A UNION ALL of our
// till's projections (pos_checks, pos_check_lines, pos_payments) with the
// stored sales (ext_checks, ext_line_parts, ext_check_lines,
// ext_check_payments), as online.sales puts web and GloriaFood orders
// together. The till.* subjects stay our till only.
//
//   sales.checks    every check or receipt, on its trading day
//   sales.dishes    what was sold: our till's lines; another till's lines as
//                   our dishes where the item mapping has them (one row per
//                   part, its share of the line's net, so the parts add up to
//                   the receipt), under their own name as sold where they
//                   aren't mapped, and counted under our section where a
//                   category bucket has them. Mapping coverage is a figure
//   sales.tenders   payments and refunds by tender
//
// Money is in pence as each till recorded it. What counts follows our till's
// rules (catalogue/till.js): sales are closed checks (another till's
// receipts that weren't cancelled), dishes those of closed checks not voided,
// payments on the day taken. Another till's refund receipt is a row of its
// own on the day it was made, never taken off sales: its money is counted
// apart (Refunded), as our till counts refunds apart on its payments.
// Ignored lines (the item mapping's "not a sale": a gift card) count as no
// dish.

import { subject, text, number, money, yesno, choice, moment, sum, count, countDistinct, ratio, one } from './define.js'
import { TENDERS } from '../../../../shared/pos/checks.js'
import { SALE_SOURCES } from '../../../../shared/externalSales.js'
import { STATE_LABELS, COVERAGE_DECIDED, COVERAGE_LEFT_OUT } from '../../../../shared/itemMapping.js'

const MODULE = 'pos_reports'
const DAY = { sql: '{t}.day', label: 'Trading day', about: 'The trading day: our till\'s day (ended by the Z report), or the day another till\'s receipt falls on by the venue\'s trading day start.' }

// Lists from code become SQL only as plain words.
const word = v => {
  const s = String(v)
  if (!/^[A-Za-z0-9_: ]+$/.test(s)) throw new Error('Report catalogue: "' + s + '" can\'t be written into SQL')
  return "'" + s + "'"
}
const inList = list => '(' + list.map(word).join(', ') + ')'

const OURS = "'macaroonie'::text"
// A line's name as the other till sold it (soldName() in shared/itemMapping.js).
const SOLD_AS = "(l.name || COALESCE(' · ' || NULLIF(l.variant_name, ''), ''))"
const OUR_NUMBER = "(CASE WHEN c.number IS NULL THEN NULL WHEN c.number_code IS NOT NULL THEN c.number_code || '-' || c.number::text ELSE c.number::text END)"
const TENDER_NAME = '(CASE p.tender ' + TENDERS.map(t => 'WHEN ' + word(t.key) + ' THEN ' + word(t.label)).join(' ') + ' ELSE p.tender END)'
const OTHER = 'JOIN pos_connections pc ON pc.id = e.connection_id AND pc.tenant_id = e.tenant_id'

const ALL_CHECKS = `(
  SELECT c.id, c.tenant_id, c.venue_id, ${OURS} AS source, d.business_date AS day, ${OUR_NUMBER} AS number,
         'sale'::text AS kind, c.status, (c.status = 'closed') AS counted, (c.cancel_value IS NOT NULL) AS cancelled,
         c.opened_at, c.closed_at, c.covers,
         c.subtotal AS gross_pence, c.discount AS discount_pence, c.service_charge AS charge_pence,
         c.vat AS tax_pence, c.tips AS tip_pence, c.total AS total_pence
    FROM pos_checks c
    LEFT JOIN pos_days d ON d.id = c.day_id AND d.tenant_id = c.tenant_id
  UNION ALL
  SELECT e.id::text, e.tenant_id, e.venue_id, pc.system, e.business_date, e.number,
         e.kind, (CASE WHEN e.cancelled THEN 'cancelled' ELSE 'closed' END), (e.kind = 'sale' AND NOT e.cancelled), e.cancelled,
         e.opened_at, e.closed_at, NULL::int,
         e.gross_pence, e.discount_pence, e.charge_pence, e.tax_pence, e.tip_pence, e.total_pence
    FROM ext_checks e ${OTHER}
)`

const ALL_DISHES = `(
  SELECT l.id, l.tenant_id, l.venue_id, ${OURS} AS source, d.business_date AS day, l.check_id,
         'sale'::text AS kind, false AS cancelled, (c.status = 'closed' AND l.status <> 'voided') AS counted,
         'dish'::text AS part, 'own'::text AS mapping, l.name, l.name AS sold_as, NULL::text AS option_name,
         l.item_id, l.section_id, l.qty::numeric AS qty, l.gross AS gross_pence, l.discount AS discount_pence, l.net AS net_pence
    FROM pos_check_lines l
    JOIN pos_checks c ON c.id = l.check_id AND c.tenant_id = l.tenant_id
    LEFT JOIN pos_days d ON d.id = l.day_id AND d.tenant_id = l.tenant_id
  UNION ALL
  SELECT p.id::text, p.tenant_id, e.venue_id, pc.system, e.business_date, e.id::text,
         e.kind, e.cancelled, (e.kind = 'sale' AND NOT e.cancelled),
         (CASE p.role WHEN 'main' THEN 'dish' WHEN 'dish' THEN 'extra' ELSE 'option' END), 'mapped'::text,
         COALESCE(mi.name, ${SOLD_AS}), ${SOLD_AS}, o.label,
         t.item_id, mi.section_id, p.qty,
         (CASE WHEN p.role = 'main' THEN l.gross_pence ELSE 0 END), (CASE WHEN p.role = 'main' THEN l.discount_pence ELSE 0 END), p.net_pence
    FROM ext_line_parts p
    JOIN ext_check_lines l ON l.id = p.line_id AND l.tenant_id = p.tenant_id
    JOIN ext_checks e ON e.id = p.check_id AND e.tenant_id = p.tenant_id
    ${OTHER}
    LEFT JOIN ext_line_parts m ON m.line_id = p.line_id AND m.tenant_id = p.tenant_id AND m.role = 'main'
    CROSS JOIN LATERAL (SELECT (CASE WHEN p.role = 'option' THEN COALESCE(m.item_id, m.combo_id) ELSE COALESCE(p.item_id, p.combo_id) END) AS item_id) t
    LEFT JOIN menu_items mi ON mi.id = t.item_id AND mi.tenant_id = p.tenant_id
    LEFT JOIN menu_variant_options o ON o.id = p.option_id AND o.tenant_id = p.tenant_id
  UNION ALL
  SELECT l.id::text, l.tenant_id, e.venue_id, pc.system, e.business_date, e.id::text,
         e.kind, e.cancelled, (e.kind = 'sale' AND NOT e.cancelled AND l.map_state IS DISTINCT FROM 'ignored'),
         (CASE WHEN l.map_state = 'bucket' THEN 'section' ELSE 'as_sold' END), COALESCE(l.map_state, 'unmapped'),
         ${SOLD_AS}, ${SOLD_AS}, NULL::text,
         NULL::uuid, l.section_id, l.qty, l.gross_pence, l.discount_pence, l.net_pence
    FROM ext_check_lines l
    JOIN ext_checks e ON e.id = l.check_id AND e.tenant_id = l.tenant_id
    ${OTHER}
   WHERE l.line_kind = 'item'
     AND NOT EXISTS (SELECT 1 FROM ext_line_parts x WHERE x.line_id = l.id AND x.tenant_id = l.tenant_id)
)`

// Another till's payment holds the receipt's tip: it goes on the receipt's
// biggest payment as its tip, so Taken leaves tips out on every till.
const ALL_TENDERS = `(
  SELECT p.id, p.tenant_id, p.venue_id, ${OURS} AS source, d.business_date AS day, p.check_id,
         p.kind, ${TENDER_NAME} AS tender, p.amount AS amount_pence, p.tip AS tip_pence, p.voided, p.at
    FROM pos_payments p
    LEFT JOIN pos_days d ON d.id = p.day_id AND d.tenant_id = p.tenant_id
  UNION ALL
  SELECT x.id::text, x.tenant_id, e.venue_id, pc.system, e.business_date, e.id::text,
         (CASE WHEN e.kind = 'refund' THEN 'refund' ELSE 'payment' END), x.name,
         (CASE WHEN e.kind = 'refund' THEN abs(x.amount_pence) ELSE x.amount_pence - tp.tip END), tp.tip,
         e.cancelled, COALESCE(x.paid_at, e.closed_at)
    FROM ext_check_payments x
    JOIN ext_checks e ON e.id = x.check_id AND e.tenant_id = x.tenant_id
    ${OTHER}
    CROSS JOIN LATERAL (SELECT (CASE WHEN e.kind = 'sale' AND x.id = (
      SELECT y.id FROM ext_check_payments y WHERE y.check_id = x.check_id AND y.tenant_id = x.tenant_id
       ORDER BY y.amount_pence DESC, y.id LIMIT 1) THEN e.tip_pence ELSE 0 END) AS tip) tp
)`

const COUNTED = '{t}.counted'
const REFUND = "{t}.kind = 'refund' AND NOT {t}.cancelled"
const DISHES = "{t}.part <> 'option'"
const OTHER_TILL = "{t}.source <> 'macaroonie' AND {t}.kind = 'sale' AND NOT {t}.cancelled"

const SOURCE = choice('source', SALE_SOURCES, { label: 'Till', about: 'Which till sold it: Macaroonie (our own) or another till linked on the Integrations page.',
  synonyms: ['source', 'pos', 'system'] })
const STATUS = { open: 'Open', closed: 'Closed', void: 'Void', merged: 'Merged into another', cancelled: 'Cancelled' }
const KINDS = { sale: 'Sale', refund: 'Refund' }
const PARTS = { dish: 'Dish', option: 'Option', extra: 'Extra dish', as_sold: 'As sold', section: 'In a section' }
const MAPPING = { own: 'Our own till', ...STATE_LABELS }

/** Where these subjects come in the catalogue (index.js gathers this folder by it, then by file name). */
export const order = 25

export const subjects = [
  subject({
    key: 'sales.checks',
    label: 'Sales, every till',
    one: 'check or receipt',
    area: 'till',
    module: MODULE,
    about: 'Every check on our till and every receipt from another till (Loyverse), with which till it came from. Sales count closed checks and receipts that weren\'t cancelled; another till\'s refunds are receipts of their own, counted apart.',
    from: { sql: ALL_CHECKS, tables: ['pos_checks', 'pos_days', 'ext_checks', 'pos_connections'] },
    idType: 'text',
    name: 'number',
    venue: 'venue_id',
    open: { page: '/pos/reports?check=:id&venue=:venue', module: MODULE, id: { sql: "(CASE WHEN {t}.source = 'macaroonie' THEN {t}.id END)" }, with: { venue: 'venue_id' } },
    date: DAY,
    fields: {
      source: SOURCE,
      number: text('number', { label: 'Check or receipt' }),
      kind: choice('kind', KINDS, { label: 'Sale or refund' }),
      status: choice('status', STATUS),
      counted: yesno('counted', { label: 'Counts as a sale' }),
      opened_at: moment('opened_at', { label: 'Opened' }),
      closed_at: moment('closed_at', { label: 'Closed' }),
      covers: number('covers', { label: 'Guests', adds: true, decimals: 0, about: 'Typed on our till; other tills don\'t send it.' }),
      gross: money('gross_pence', { label: 'Gross', about: 'Its dishes at full price, before discounts.' }),
      discount: money('discount_pence', { label: 'Discount' }),
      net: money({ sql: '({t}.gross_pence - {t}.discount_pence)' }, { label: 'Net' }),
      charges: money('charge_pence', { label: 'Charges', about: 'Service charges, or another till\'s surcharges.' }),
      tax: money('tax_pence', { label: 'VAT or tax' }),
      tips: money('tip_pence', { label: 'Tips' }),
      total: money('total_pence', { label: 'Total' }),
    },
    measures: {
      checks: count({ label: 'Checks', where: COUNTED, about: 'Closed checks and receipts that weren\'t cancelled, every till.' }),
      guests: sum('covers', { label: 'Guests', where: COUNTED, about: 'Guests on closed checks (our till only: other tills don\'t send them).' }),
      gross_sales: sum('gross_pence', { type: 'money', label: 'Gross sales', where: COUNTED, about: 'Dishes at full price, before discounts, every till.' }),
      discounts: sum('discount_pence', { type: 'money', label: 'Discounts', where: COUNTED, about: 'Discounts on sales, every till.' }),
      net_sales: sum({ sql: '({t}.gross_pence - {t}.discount_pence)' }, { type: 'money', label: 'Net sales', where: COUNTED,
        about: 'Gross sales less discounts, every till, before refunds (counted apart).',
        synonyms: ['sales every till', 'sales on all tills', 'loyverse sales', 'combined sales'],
        instructions: 'Our till and other tills (Loyverse) together; group by Till to tell them apart. For our till alone use Checks.' }),
      charges_total: sum('charge_pence', { type: 'money', label: 'Charges', where: COUNTED }),
      total_sales: sum('total_pence', { type: 'money', label: 'Total', where: COUNTED, about: 'Check and receipt totals, every till.' }),
      tax_total: sum('tax_pence', { type: 'money', label: 'VAT or tax', where: COUNTED }),
      tips_total: sum('tip_pence', { type: 'money', label: 'Tips', where: COUNTED }),
      average_check: ratio('total_sales', 'checks', { type: 'money', label: 'Average check', about: 'Total divided by the checks and receipts that count.' }),
      refunds: count({ label: 'Refund receipts', where: REFUND, about: 'Another till\'s refund receipts, on the day they were made. Our till\'s refunds are payments (Payments, every till).' }),
      refunded: sum({ sql: 'abs({t}.total_pence)' }, { type: 'money', label: 'Refunded', where: REFUND, about: 'What another till\'s refund receipts gave back.' }),
    },
    list: ['date', 'source', 'number', 'venue.name', 'kind', 'status', 'net', 'total'],
    sort: [{ by: 'closed_at', dir: 'desc' }],
  }),

  subject({
    key: 'sales.dishes',
    label: 'Dishes sold, every till',
    one: 'dish sold on any till',
    area: 'till',
    module: MODULE,
    about: 'What every till sold: our till\'s dishes, and another till\'s items as our dishes where the item mapping has them (each part with its share of the line, so they add up to the receipt), under their own name where they aren\'t mapped, and under our section where a category is counted there.',
    from: { sql: ALL_DISHES, tables: ['pos_check_lines', 'pos_checks', 'pos_days', 'ext_line_parts', 'ext_check_lines', 'ext_checks', 'pos_connections', 'menu_items', 'menu_variant_options'] },
    idType: 'text',
    name: 'name',
    venue: 'venue_id',
    open: 'check',
    date: DAY,
    fields: {
      source: SOURCE,
      name: text('name', { label: 'Dish', about: 'Our dish where it is mapped (an option counts with its dish), else the name it was sold under.' }),
      sold_as: text('sold_as', { label: 'Sold as', about: 'The name on the till that sold it.' }),
      option: text('option_name', { label: 'Option' }),
      part: choice('part', PARTS, { label: 'Part' }),
      mapping: choice('mapping', MAPPING, { label: 'Mapping' }),
      kind: choice('kind', KINDS, { label: 'Sale or refund' }),
      counted: yesno('counted', { label: 'Counts as sold' }),
      qty: number('qty', { label: 'Quantity', adds: true, decimals: 0 }),
      gross: money('gross_pence', { label: 'Gross', about: 'At full price; on another till\'s mapped line it sits on the main dish.' }),
      discount: money('discount_pence', { label: 'Discount' }),
      net: money('net_pence', { label: 'Net' }),
    },
    measures: {
      qty_sold: sum('qty', { label: 'Quantity sold', where: COUNTED + ' AND ' + DISHES, about: 'How many were sold, every till (options aren\'t counted again).',
        synonyms: ['dishes sold every till', 'items sold on loyverse', 'product mix all tills'] }),
      gross_sales: sum('gross_pence', { type: 'money', label: 'Gross sales', where: COUNTED }),
      discounts: sum('discount_pence', { type: 'money', label: 'Discounts', where: COUNTED }),
      net_sales: sum('net_pence', { type: 'money', label: 'Net sales', where: COUNTED, about: 'Dishes after discounts, every till; refunds are counted apart.',
        instructions: 'Group by Dish for sales by our dish across tills, by Till to compare.' }),
      checks: countDistinct('check_id', { label: 'Checks', where: COUNTED }),
      average_price: ratio('net_sales', 'qty_sold', { type: 'money', label: 'Average price' }),
      qty_refunded: sum({ sql: 'abs({t}.qty)' }, { label: 'Quantity refunded', where: REFUND + ' AND ' + DISHES + " AND {t}.mapping <> 'ignored'", about: 'On another till\'s refund receipts.' }),
      refunded: sum({ sql: 'abs({t}.net_pence)' }, { type: 'money', label: 'Refunded', where: REFUND + " AND {t}.mapping <> 'ignored'", about: 'Another till\'s refunded items, after discounts.' }),
      mapped_value: sum('net_pence', { type: 'money', label: 'Mapped sales', where: OTHER_TILL + ' AND {t}.mapping IN ' + inList(COVERAGE_DECIDED),
        about: 'Another till\'s sales mapped to our dishes, kept as sold or counted under a section.' }),
      other_till_sales: sum('net_pence', { type: 'money', label: 'Other till sales', where: OTHER_TILL + ' AND {t}.mapping NOT IN ' + inList(COVERAGE_LEFT_OUT),
        about: 'Another till\'s item sales, ignored lines left out.' }),
      mapping_coverage: ratio('mapped_value', 'other_till_sales', { type: 'percent', label: 'Mapping coverage',
        about: 'Mapped sales out of another till\'s item sales: the Item mapping page\'s coverage, over the report\'s days.',
        synonyms: ['coverage', 'how much is mapped', 'unmapped share'] }),
    },
    links: {
      check: one('sales.checks', 'check_id', { label: 'Check or receipt' }),
      item: one('menu.dishes', 'item_id', { label: 'Menu dish' }),
      section: one('menu.sections', 'section_id', { label: 'Section' }),
    },
    list: ['date', 'source', 'name', 'sold_as', 'qty', 'net', 'mapping', 'section.name'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'sales.tenders',
    label: 'Payments, every till',
    one: 'payment on any till',
    area: 'till',
    module: MODULE,
    about: 'Every payment and refund on our till and on other tills (Loyverse), by tender as each till names it, on the day it was taken. Another till\'s tip goes on the receipt\'s biggest payment.',
    from: { sql: ALL_TENDERS, tables: ['pos_payments', 'pos_days', 'ext_check_payments', 'ext_checks', 'pos_connections'] },
    idType: 'text',
    venue: 'venue_id',
    open: 'check',
    date: DAY,
    fields: {
      source: SOURCE,
      kind: choice('kind', { payment: 'Payment', refund: 'Refund' }, { label: 'Payment or refund' }),
      tender: text('tender', { label: 'Tender' }),
      amount: money('amount_pence', { label: 'Amount', adds: false }),
      tip: money('tip_pence', { label: 'Tip', adds: false }),
      voided: yesno('voided', { label: 'Taken off', about: 'Voided on our till, or on a cancelled receipt.' }),
      at: moment('at', { label: 'Time' }),
    },
    measures: {
      payments: count({ label: 'Payments', where: "{t}.kind = 'payment' AND NOT {t}.voided" }),
      taken: sum('amount_pence', { type: 'money', label: 'Taken', where: "{t}.kind = 'payment' AND NOT {t}.voided", about: 'Payments before tips and refunds, every till.' }),
      tips: sum('tip_pence', { type: 'money', label: 'Tips', where: "{t}.kind = 'payment' AND NOT {t}.voided" }),
      refunds: count({ label: 'Refunds', where: "{t}.kind = 'refund' AND NOT {t}.voided" }),
      refunded: sum('amount_pence', { type: 'money', label: 'Refunded', where: "{t}.kind = 'refund' AND NOT {t}.voided" }),
      takings: sum({ sql: "(CASE WHEN {t}.voided THEN 0 WHEN {t}.kind = 'refund' THEN -{t}.amount_pence ELSE {t}.amount_pence + {t}.tip_pence END)" }, { type: 'money', label: 'Takings',
        about: 'Payments and tips less refunds, every till.',
        synonyms: ['takings every till', 'loyverse takings', 'cash and card all tills'] }),
    },
    links: {
      check: one('sales.checks', 'check_id', { label: 'Check or receipt' }),
    },
    list: ['date', 'at', 'source', 'check.number', 'kind', 'tender', 'amount', 'tip'],
    sort: [{ by: 'at', dir: 'desc' }],
  }),
]
