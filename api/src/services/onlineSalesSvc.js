// src/services/onlineSalesSvc.js
//
// The online sales transactions report: every online order of a venue over
// a range of days, from Macaroonie's own online ordering (orders +
// order_payments) and from GloriaFood (gloriafood_orders), each with its
// tender (how it was paid), plus totals by tender and by source. One
// implementation for the Online orders page's Transactions tab and its CSV
// (GET /api/orders/transactions[.csv]).
//
// Days: own orders by service_date (the venue-local day they were for);
// GloriaFood orders by the venue's GloriaFood link (fulfil or accepted time,
// trading day starting at day_starts_at), the same day Cash Recon's Fill
// from GloriaFood puts them on.
//
// Counted: own orders that were placed (rejected, cancelled, unpaid and
// expired left out of the totals; rejected and cancelled still listed, as
// "not counted"); GloriaFood orders that are accepted and not GloriaFood test
// orders (countsInRecon()). Sales = counted orders' totals (tips included,
// discounts taken off); net = sales less refunds on them.
//
// No guest names, emails or phones: the report and its CSV are about money.

import { tradingDay } from './loyverseSvc.js'
import { localParts } from './orderSvc.js'
import { getGateway, COUNTER_METHODS } from './paymentGateways/index.js'
import { paymentLabel, typeLabel, countsInRecon } from '../../../shared/gloriafood.js'
import { statusLabel } from './gloriafoodSvc.js'

export const MAX_DAYS = 366
const MAX_ROWS = 20000   // per source; more sets `truncated`

// One list of tenders across both sources, so "Cash" is one line whichever
// system took it.
const TENDERS = {
  cash:         'Cash',
  card_counter: 'Card at the counter',
  card_phone:   'Card by phone',
  online:       'Paid online',
  test:         'Test payment (no money moves)',
  unpaid:       'Not marked paid yet',
}

export const SOURCES = { web: 'Online ordering', gloriafood: 'GloriaFood' }

const OWN_STATUS = {
  placed: 'Placed', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready',
  completed: 'Collected', rejected: 'Rejected', cancelled: 'Cancelled',
}
const OWN_COUNTED = new Set(['placed', 'accepted', 'preparing', 'ready', 'completed'])
const OWN_FULFILMENT = { collection: 'Collection', delivery: 'Delivery', eat_in: 'Eat in' }

/** Our own payment method (gateway or counter method) as a tender key. */
export function ownTenderKey(gateway) {
  if (gateway === 'cash') return 'cash'
  if (gateway === 'card_terminal') return 'card_counter'
  if (gateway === 'demo') return 'test'
  const g = getGateway(gateway)
  if (g?.online) return 'online'
  return 'other:' + gateway
}

const ownMethodLabel = gateway =>
  COUNTER_METHODS[gateway] || getGateway(gateway)?.adminLabel || gateway

/**
 * A GloriaFood payment as a tender key. The API sends codes (CASH, CARD,
 * CARD_PHONE, ONLINE); orders imported from GloriaFood's export keep the
 * export's wording, so plain words are matched too.
 */
export function gfTenderKey(payment) {
  const p = String(payment || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (p === 'CASH') return 'cash'
  if (p === 'CARD') return 'card_counter'
  if (p === 'CARD_PHONE' || p === 'CARD_BY_PHONE') return 'card_phone'
  if (p === 'ONLINE' || p === 'PAID_ONLINE') return 'online'
  if (!p) return 'other:unknown'
  return 'other:' + String(payment).trim()
}

const tenderLabel = key => TENDERS[key] || (key === 'other:unknown' ? 'Unknown' : key.replace(/^other:/, ''))

const ymdNext = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10)
function daysBetween(from, to) {
  const out = []
  for (let d = from; d <= to && out.length <= MAX_DAYS; d = ymdNext(d)) out.push(d)
  return out
}

/** The trading day (from `windows`, sorted) an instant falls in, or null. */
function dayOf(windows, at) {
  const t = +new Date(at)
  let lo = 0, hi = windows.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const w = windows[mid]
    if (t < +w.start) hi = mid - 1
    else if (t >= +w.end) lo = mid + 1
    else return w.date
  }
  return null
}

/**
 * Every online order of the venue from `from` to `to` (venue-local days,
 * inclusive), newest first, with totals. Filters: source ('web' |
 * 'gloriafood'), tender (a tender key), countedOnly. `tenders` and `sources`
 * list what the range holds whatever the filters, for the page's pickers.
 */
export async function onlineTransactions(tx, { tenantId, venue, from, to, source = null, tender = null, countedOnly = false }) {
  const tz = venue.timezone || 'Europe/London'
  const dates = daysBetween(from, to)
  const rows = []
  let truncated = false

  // ── Macaroonie online ordering ─────────────────────────────
  const own = await tx`
    SELECT id, order_number, service_date::text AS service_date, status, fulfilment, channel,
           placed_at, created_at, promised_at, payment_method, payment_status,
           subtotal_pence, discount_pence, tip_pence, vat_pence, total_pence, refunded_pence
      FROM orders
     WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id}
       AND service_date BETWEEN ${from} AND ${to}
       AND status NOT IN ('pending_payment', 'expired')
     ORDER BY service_date, order_number
     LIMIT ${MAX_ROWS + 1}`
  if (own.length > MAX_ROWS) { truncated = true; own.length = MAX_ROWS }
  const ids = own.map(o => o.id)
  const pays = ids.length
    ? await tx`
        SELECT order_id, gateway, amount_pence, refunded_pence
          FROM order_payments
         WHERE tenant_id = ${tenantId} AND order_id = ANY(${ids}::uuid[])
           AND status IN ('succeeded', 'partially_refunded', 'refunded')
         ORDER BY created_at`
    : []
  const paysByOrder = {}
  for (const p of pays) (paysByOrder[p.order_id] ||= []).push(p)

  for (const o of own) {
    const taken = paysByOrder[o.id] || []
    let key, detail = null
    if (taken.length) {
      // The biggest payment decides the tender; any others are named.
      const main = taken.reduce((a, b) => (b.amount_pence > a.amount_pence ? b : a))
      key = ownTenderKey(main.gateway)
      const methods = [...new Set(taken.map(p => ownMethodLabel(p.gateway)))]
      detail = methods.length > 1 ? 'Paid: ' + methods.join(' + ') : ownMethodLabel(main.gateway)
    } else {
      key = 'unpaid'
      detail = ownMethodLabel(o.payment_method)
    }
    const counted = OWN_COUNTED.has(o.status)
    rows.push({
      id: o.id,
      source: 'web',
      source_label: SOURCES.web,
      date: o.service_date,
      at: o.placed_at || o.created_at,
      ready_at: o.promised_at,
      number: String(o.order_number),
      type_label: OWN_FULFILMENT[o.fulfilment] || o.fulfilment,
      status: o.status,
      status_label: OWN_STATUS[o.status] || o.status,
      counted,
      note: counted ? null : (o.status === 'rejected' ? 'Rejected' : 'Cancelled'),
      tender: key,
      tender_label: tenderLabel(key),
      tender_detail: detail,
      total_pence: o.total_pence,
      tip_pence: o.tip_pence,
      discount_pence: o.discount_pence,
      fees_pence: 0,
      tax_pence: o.vat_pence,
      refunded_pence: o.refunded_pence,
    })
  }

  // ── GloriaFood ─────────────────────────────────────────────
  const [link] = await tx`
    SELECT day_basis, day_starts_at FROM gloriafood_venue_links
     WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id}`
  const basis = link?.day_basis === 'accepted' ? 'accepted_at' : 'fulfill_at'
  const windows = dates.map(d => ({ date: d, ...tradingDay(d, tz, link?.day_starts_at || '00:00') }))
  const gf = windows.length
    ? await tx`
        SELECT id, gf_order_id, status, source, order_type, payment, used_payment_methods, card_type,
               received_via, accepted_at, fulfill_at, ${tx(basis)} AS at,
               total_pence, discount_pence, delivery_fee_pence, tip_pence, service_fee_pence, tax_pence
          FROM gloriafood_orders
         WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id}
           AND ${tx(basis)} >= ${windows[0].start} AND ${tx(basis)} < ${windows[windows.length - 1].end}
         ORDER BY ${tx(basis)}, gf_order_id
         LIMIT ${MAX_ROWS + 1}`
    : []
  if (gf.length > MAX_ROWS) { truncated = true; gf.length = MAX_ROWS }
  for (const r of gf) {
    const date = dayOf(windows, r.at)
    if (!date) continue
    const counted = countsInRecon(r)
    const cancelled = r.status === 'canceled' || r.status === 'cancelled'
    const key = gfTenderKey(r.payment)
    const used = (r.used_payment_methods || []).filter(Boolean)
    const parts = []
    if (used.length > 1) parts.push('Split: ' + used.map(paymentLabel).join(' + '))
    if (r.card_type) parts.push(r.card_type)
    if (r.received_via === 'import') parts.push('Imported')
    rows.push({
      id: r.id,
      source: 'gloriafood',
      source_label: SOURCES.gloriafood,
      date,
      at: r.accepted_at || r.at,
      ready_at: r.fulfill_at,
      number: String(r.gf_order_id),
      type_label: typeLabel(r.order_type),
      status: cancelled ? 'cancelled' : r.status,
      status_label: statusLabel(r.status),
      counted,
      note: counted ? null : (cancelled ? 'Cancelled' : r.source === 'admin' ? 'GloriaFood test order' : 'Not accepted'),
      tender: key,
      tender_label: tenderLabel(key),
      tender_detail: parts.length ? parts.join(' · ') : null,
      total_pence: r.total_pence,
      tip_pence: r.tip_pence,
      discount_pence: r.discount_pence,
      fees_pence: (r.delivery_fee_pence || 0) + (r.service_fee_pence || 0),
      tax_pence: r.tax_pence,
      refunded_pence: 0,
    })
  }

  for (const r of rows) r.net_pence = r.counted ? r.total_pence - r.refunded_pence : 0

  // What the range holds, for the pickers (whatever the filters).
  const tenderSet = new Map()
  for (const r of rows) if (!tenderSet.has(r.tender)) tenderSet.set(r.tender, r.tender_label)
  const tenders = [...tenderSet].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label))
  const sources = Object.keys(SOURCES).filter(k => rows.some(r => r.source === k)).map(k => ({ key: k, label: SOURCES[k] }))

  const shown = rows
    .filter(r => (!source || r.source === source) && (!tender || r.tender === tender) && (!countedOnly || r.counted))
    .sort((a, b) => (a.date === b.date ? new Date(b.at) - new Date(a.at) : (a.date < b.date ? 1 : -1)))

  const totals = { orders: 0, not_counted: 0, sales_pence: 0, refunded_pence: 0, net_pence: 0, tip_pence: 0, discount_pence: 0, fees_pence: 0, tax_pence: 0 }
  const byTender = new Map()
  const bySource = new Map()
  for (const r of shown) {
    if (!r.counted) { totals.not_counted++; continue }
    totals.orders++
    totals.sales_pence += r.total_pence
    totals.refunded_pence += r.refunded_pence
    totals.net_pence += r.net_pence
    totals.tip_pence += r.tip_pence
    totals.discount_pence += r.discount_pence
    totals.fees_pence += r.fees_pence
    totals.tax_pence += r.tax_pence
    const t = byTender.get(r.tender) || { key: r.tender, label: r.tender_label, orders: 0, sales_pence: 0, refunded_pence: 0, net_pence: 0, web: { orders: 0, net_pence: 0 }, gloriafood: { orders: 0, net_pence: 0 } }
    t.orders++; t.sales_pence += r.total_pence; t.refunded_pence += r.refunded_pence; t.net_pence += r.net_pence
    t[r.source].orders++; t[r.source].net_pence += r.net_pence
    byTender.set(r.tender, t)
    const s = bySource.get(r.source) || { key: r.source, label: r.source_label, orders: 0, sales_pence: 0, refunded_pence: 0, net_pence: 0 }
    s.orders++; s.sales_pence += r.total_pence; s.refunded_pence += r.refunded_pence; s.net_pence += r.net_pence
    bySource.set(r.source, s)
  }
  totals.average_pence = totals.orders ? Math.round(totals.sales_pence / totals.orders) : 0

  return {
    venue: { id: venue.id, name: venue.name, timezone: tz },
    currency: venue.currency || 'GBP',
    from, to,
    gloriafood: link ? { day_basis: link.day_basis, day_starts_at: link.day_starts_at } : null,
    totals,
    by_tender: [...byTender.values()].sort((a, b) => b.net_pence - a.net_pence),
    by_source: [...bySource.values()].sort((a, b) => b.net_pence - a.net_pence),
    tenders,
    sources,
    rows: shown,
    truncated,
  }
}

// ── CSV ───────────────────────────────────────────────────────

const pounds = p => (Number(p || 0) / 100).toFixed(2)

// Text cells: quoted when needed, and a leading = + - @ made harmless so a
// spreadsheet never runs it as a formula.
function textCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export const CSV_COLUMNS = [
  'Date', 'Time', 'Ready for', 'Source', 'Order', 'Type', 'Status', 'Counted', 'Tender', 'Tender detail',
  'Total', 'Tips', 'Discounts', 'Delivery and fees', 'VAT / tax', 'Refunded', 'Net',
]

/** The report's rows as CSV (money in pounds, times at the venue). */
export function transactionsCsv(report) {
  const tz = report.venue.timezone
  const when = v => (v ? localParts(new Date(v), tz) : null)
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of report.rows) {
    const at = when(r.at)
    const ready = when(r.ready_at)
    lines.push([
      textCell(r.date), textCell(at?.time ?? ''), textCell(ready ? ready.date + ' ' + ready.time : ''),
      textCell(r.source_label), textCell(r.number), textCell(r.type_label), textCell(r.status_label),
      textCell(r.counted ? 'yes' : 'no' + (r.note ? ' (' + r.note + ')' : '')),
      textCell(r.tender_label), textCell(r.tender_detail ?? ''),
      pounds(r.total_pence), pounds(r.tip_pence), pounds(r.discount_pence), pounds(r.fees_pence),
      pounds(r.tax_pence), pounds(r.refunded_pence), pounds(r.net_pence),
    ].join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
