// src/services/gloriafoodSvc.js
//
// GloriaFood online orders (migration 159): storing the accepted orders
// GloriaFood sends (push webhook or minute-by-minute poll), reading them back
// as trading-day figures for Cash Reconciliation, and the board's view of
// them. The figure maths lives in shared/gloriafood.js (also used by the
// admin).
//
// GloriaFood Accepted Orders API v2:
//   push  POST to our URL with { count, orders: [...] } (JSON); we must answer
//         within 15 seconds; the same order can arrive twice.
//   poll  POST {GLORIAFOOD_API_URL}/pos/order/pop with the venue's key in
//         Authorization, Accept: application/json, Glf-Api-Version: 2. Each
//         accepted order is handed over once, so it must be stored at once.
// There is no way to read old orders back: only orders accepted after the
// link is set up ever reach us.

import crypto from 'node:crypto'
import { sql, withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { broadcast } from '../config/ws.js'
import { tradingDay } from './loyverseSvc.js'
import { zonedToUtc } from './orderSvc.js'
import {
  orderFromPayload, summariseOrders, paymentLabel, typeLabel,
} from '../../../shared/gloriafood.js'

export class GloriaFoodError extends Error {
  constructor(message, { keyProblem = false } = {}) {
    super(message)
    this.status = 422            // 4xx so nginx passes the message through
    this.keyProblem = keyProblem
  }
}

const TIMEOUT_MS = 20000
const MAX_ORDERS = 500           // in one push or one pop
export const PERSONAL_DAYS = 30  // guest name, phone, address kept this long

export const keyHint = key => String(key).slice(-4)
export const newPushToken = () => crypto.randomBytes(24).toString('base64url')

/** Pop the accepted orders GloriaFood has waiting for this key. Throws GloriaFoodError. */
export async function popOrders(key) {
  const url = env.GLORIAFOOD_API_URL.replace(/\/+$/, '') + '/pos/order/pop'
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authorization: key, accept: 'application/json', 'glf-api-version': '2' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new GloriaFoodError(e?.name === 'TimeoutError'
      ? 'GloriaFood didn\'t answer in time. It will be tried again in a minute.'
      : 'Couldn\'t reach GloriaFood. It will be tried again in a minute.')
  }
  if (res.status === 401 || res.status === 403) {
    throw new GloriaFoodError('GloriaFood rejected the poll key. In GloriaFood open Setup > Integrations, add (or open) the "Poll Accepted Order v2" integration for this restaurant and paste its key in Cash reconciliation settings > GloriaFood.', { keyProblem: true })
  }
  if (res.status === 429) throw new GloriaFoodError('GloriaFood is limiting requests. It will be tried again in a minute.')
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.message || body?.error || ''
    } catch { /* not JSON */ }
    throw new GloriaFoodError('GloriaFood returned an error (' + res.status + ')' + (detail ? ': ' + String(detail).slice(0, 200) : '') + '.')
  }
  let body
  try {
    const raw = await res.text()
    body = raw.trim() ? JSON.parse(raw) : { orders: [] }
  } catch {
    throw new GloriaFoodError('GloriaFood sent an answer that couldn\'t be read.')
  }
  return ordersOf(body)
}

/** The orders in a push or pop body: { orders: [...] }, an array, or one order. */
export function ordersOf(body) {
  if (Array.isArray(body)) return body.slice(0, MAX_ORDERS)
  if (Array.isArray(body?.orders)) return body.orders.slice(0, MAX_ORDERS)
  if (body && typeof body === 'object' && body.id != null && Array.isArray(body.items)) return [body]
  return []
}

/**
 * Store orders for a venue inside `tx` (tenant context set, the link row
 * locked by the caller or here). Upserts by GloriaFood order id, never going
 * back to an older version of an order. The first order sets which GloriaFood
 * restaurant the venue is linked to; orders from any other restaurant are
 * refused. Returns { stored, updated, refused, skipped, link }.
 */
export async function ingestWithTx(tx, { tenantId, venueId, orders, via }) {
  const [link] = await tx`
    SELECT * FROM gloriafood_venue_links
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
     FOR UPDATE`
  if (!link) return { stored: 0, updated: 0, refused: 0, skipped: orders.length, link: null }

  let restaurantId = link.gf_restaurant_id != null ? Number(link.gf_restaurant_id) : null
  let restaurantName = link.gf_restaurant_name
  let stored = 0, updated = 0, refused = 0, skipped = 0
  let refusedFrom = null

  for (const payload of orders) {
    const row = orderFromPayload(payload)
    if (!row) { skipped++; continue }
    if (row.gf_restaurant_id != null) {
      if (restaurantId == null) {
        restaurantId = row.gf_restaurant_id
        restaurantName = row.restaurant_name
        await tx`
          UPDATE gloriafood_venue_links
             SET gf_restaurant_id = ${restaurantId}, gf_restaurant_name = ${restaurantName}, updated_at = now()
           WHERE id = ${link.id} AND tenant_id = ${tenantId}`
      } else if (row.gf_restaurant_id !== restaurantId) {
        refused++
        refusedFrom = row
        continue
      }
    }
    const [r] = await tx`
      INSERT INTO gloriafood_orders (
        tenant_id, venue_id, gf_order_id, gf_restaurant_id, restaurant_name, status, order_type, source,
        payment, used_payment_methods, card_type, gateway_type, currency,
        total_pence, subtotal_pence, items_pence, discount_pence, delivery_fee_pence, tip_pence,
        service_fee_pence, tax_pence, accepted_at, fulfill_at, gf_updated_at, for_later,
        client_name, client_phone, client_address, instructions, table_number, persons,
        items, payload, received_via
      ) VALUES (
        ${tenantId}, ${venueId}, ${row.gf_order_id}, ${row.gf_restaurant_id}, ${row.restaurant_name}, ${row.status},
        ${row.order_type}, ${row.source}, ${row.payment}, ${row.used_payment_methods}, ${row.card_type},
        ${row.gateway_type}, ${row.currency}, ${row.total_pence}, ${row.subtotal_pence}, ${row.items_pence},
        ${row.discount_pence}, ${row.delivery_fee_pence}, ${row.tip_pence}, ${row.service_fee_pence},
        ${row.tax_pence}, ${row.accepted_at}, ${row.fulfill_at}, ${row.gf_updated_at}, ${row.for_later},
        ${row.client_name}, ${row.client_phone}, ${row.client_address}, ${row.instructions},
        ${row.table_number}, ${row.persons}, ${tx.json(row.items)}, ${tx.json(row.payload)}, ${via}
      )
      ON CONFLICT (tenant_id, gf_order_id) DO UPDATE SET
        status = EXCLUDED.status, order_type = EXCLUDED.order_type, source = EXCLUDED.source,
        payment = EXCLUDED.payment, used_payment_methods = EXCLUDED.used_payment_methods,
        card_type = EXCLUDED.card_type, gateway_type = EXCLUDED.gateway_type, currency = EXCLUDED.currency,
        total_pence = EXCLUDED.total_pence, subtotal_pence = EXCLUDED.subtotal_pence,
        items_pence = EXCLUDED.items_pence, discount_pence = EXCLUDED.discount_pence,
        delivery_fee_pence = EXCLUDED.delivery_fee_pence, tip_pence = EXCLUDED.tip_pence,
        service_fee_pence = EXCLUDED.service_fee_pence, tax_pence = EXCLUDED.tax_pence,
        accepted_at = EXCLUDED.accepted_at, fulfill_at = EXCLUDED.fulfill_at,
        gf_updated_at = EXCLUDED.gf_updated_at, for_later = EXCLUDED.for_later,
        client_name = EXCLUDED.client_name, client_phone = EXCLUDED.client_phone,
        client_address = EXCLUDED.client_address, instructions = EXCLUDED.instructions,
        table_number = EXCLUDED.table_number, persons = EXCLUDED.persons,
        items = EXCLUDED.items, payload = EXCLUDED.payload, updated_at = now()
      WHERE gloriafood_orders.venue_id = EXCLUDED.venue_id
        AND gloriafood_orders.tenant_id = EXCLUDED.tenant_id
        AND (gloriafood_orders.gf_updated_at IS NULL OR EXCLUDED.gf_updated_at IS NULL
             OR EXCLUDED.gf_updated_at >= gloriafood_orders.gf_updated_at)
      RETURNING (xmax = 0) AS inserted
    `
    if (!r) skipped++
    else if (r.inserted) stored++
    else updated++
  }

  const error = refused
    ? `${refused} ${refused === 1 ? 'order' : 'orders'} from GloriaFood restaurant "${refusedFrom.restaurant_name || refusedFrom.gf_restaurant_id}" ${refused === 1 ? 'was' : 'were'} refused: this venue is linked to "${restaurantName || restaurantId}". Check which restaurant's integration uses this venue's address or key.`
    : null
  await tx`
    UPDATE gloriafood_venue_links
       SET last_order_at = CASE WHEN ${stored + updated > 0} THEN now() ELSE last_order_at END,
           last_error    = CASE WHEN ${!!error} THEN ${error} ELSE last_error END,
           last_error_at = CASE WHEN ${!!error} THEN now() ELSE last_error_at END,
           updated_at    = now()
     WHERE id = ${link.id} AND tenant_id = ${tenantId}`
  return { stored, updated, refused, skipped, link }
}

/** Store orders and tell open boards (when the venue shows them there). */
export async function ingestOrders({ tenantId, venueId, orders, via }) {
  const res = await withTenant(tenantId, tx => ingestWithTx(tx, { tenantId, venueId, orders, via }))
  announce(venueId, res)
  return res
}

function announce(venueId, res) {
  if (res.link?.show_on_board && res.stored + res.updated > 0) {
    broadcast(venueId, { type: res.stored ? 'order.created' : 'order.updated', source: 'gloriafood' })
  }
}

/**
 * Poll one venue: pop its waiting orders and store them in the same
 * transaction, under an advisory lock so two API processes never pop the same
 * key at once. Records last_poll_at / last_error. Returns the ingest result,
 * or { busy: true } when another process is polling this venue right now.
 * Throws GloriaFoodError (after recording it).
 */
export async function pollVenue(tenantId, venueId, log) {
  let popped = null
  try {
    const res = await withTenant(tenantId, async tx => {
      const [link] = await tx`
        SELECT id, method, poll_key FROM gloriafood_venue_links
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
      if (!link || link.method !== 'poll' || !link.poll_key) return { skipped: 'not_polling' }
      const [{ locked }] = await tx`SELECT pg_try_advisory_xact_lock(hashtextextended('gloriafood:' || ${link.id}::text, 0)) AS locked`
      if (!locked) return { busy: true }
      popped = await popOrders(link.poll_key)
      const r = popped.length
        ? await ingestWithTx(tx, { tenantId, venueId, orders: popped, via: 'poll' })
        : { stored: 0, updated: 0, refused: 0, skipped: 0, link: null }
      await tx`
        UPDATE gloriafood_venue_links
           SET last_poll_at = now(),
               last_error = CASE WHEN ${r.refused > 0} THEN last_error ELSE NULL END
         WHERE id = ${link.id} AND tenant_id = ${tenantId}`
      return r
    })
    if (res.link) announce(venueId, res)
    return res
  } catch (e) {
    // Orders popped but not stored would be lost: put them in the log so
    // they can be recovered by hand.
    if (popped?.length && !(e instanceof GloriaFoodError)) {
      log?.error({ err: e, venueId, orders: popped }, 'GloriaFood orders popped but not stored')
    }
    const message = e instanceof GloriaFoodError ? e.message : 'Storing GloriaFood orders failed: ' + (e?.message || e)
    await withTenant(tenantId, tx => tx`
      UPDATE gloriafood_venue_links
         SET last_poll_at = now(), last_error = ${message}, last_error_at = now()
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`).catch(() => {})
    throw e instanceof GloriaFoodError ? e : new GloriaFoodError(message)
  }
}

/**
 * The minute job: poll every venue set to poll, then clear guest details
 * from orders older than PERSONAL_DAYS. Errors are recorded per venue and
 * never stop the others.
 */
export async function pollAll(log) {
  const links = await sql`
    SELECT tenant_id, venue_id FROM gloriafood_venue_links
     WHERE method = 'poll' AND poll_key IS NOT NULL`
  let stored = 0
  for (const l of links) {
    try {
      const r = await pollVenue(l.tenant_id, l.venue_id, log)
      stored += (r.stored || 0) + (r.updated || 0)
    } catch (e) {
      log?.warn({ venueId: l.venue_id, err: e?.message }, 'GloriaFood poll failed')
    }
  }
  const tenants = await sql`SELECT DISTINCT tenant_id FROM gloriafood_venue_links`
  for (const { tenant_id } of tenants) {
    await withTenant(tenant_id, tx => tx`
      UPDATE gloriafood_orders
         SET client_name = NULL, client_phone = NULL, client_address = NULL
       WHERE tenant_id = ${tenant_id}
         AND COALESCE(fulfill_at, received_at) < now() - make_interval(days => ${PERSONAL_DAYS})
         AND (client_name IS NOT NULL OR client_phone IS NOT NULL OR client_address IS NOT NULL)`).catch(e => {
      log?.warn({ tenantId: tenant_id, err: e?.message }, 'GloriaFood guest details cleanup failed')
    })
  }
  return { venues: links.length, stored }
}

/**
 * Day figures for each date (consecutive 'YYYY-MM-DD', oldest first) from the
 * venue's stored orders: { [date]: figures } (see summariseOrders()). An
 * order's day comes from its fulfil time (or accepted time, per the link) in
 * the venue's time zone, with the trading day starting at day_starts_at.
 */
export async function venueDays(tx, { tenantId, venueId, timezone, link, dates }) {
  const windows = dates.map(d => ({ date: d, ...tradingDay(d, timezone || 'UTC', link.day_starts_at) }))
  const first = windows[0].start
  const last  = windows[windows.length - 1].end
  const col = link.day_basis === 'accepted' ? 'accepted_at' : 'fulfill_at'
  const rows = await tx`
    SELECT status, source, payment, used_payment_methods, order_type, currency, ${tx(col)} AS at,
           total_pence, subtotal_pence, items_pence, discount_pence, delivery_fee_pence,
           tip_pence, service_fee_pence, tax_pence
      FROM gloriafood_orders
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
       AND ${tx(col)} >= ${first} AND ${tx(col)} < ${last}
  `
  const byDate = Object.fromEntries(dates.map(d => [d, []]))
  let currency = null
  for (const r of rows) {
    const at = new Date(r.at)
    const w = windows.find(x => at >= x.start && at < x.end)
    if (w) byDate[w.date].push(r)
    if (!currency && r.currency) currency = r.currency
  }
  const figures = Object.fromEntries(dates.map(d => [d, summariseOrders(byDate[d])]))
  return { figures, currency }
}

/** The payment methods and order types the venue's orders have used (mapping picker). */
export async function seenValues(tx, tenantId, venueId) {
  const [payments, types] = await Promise.all([
    tx`SELECT DISTINCT payment AS v FROM gloriafood_orders
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND payment IS NOT NULL`,
    tx`SELECT DISTINCT order_type AS v FROM gloriafood_orders
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND order_type IS NOT NULL`,
  ])
  return { payments: payments.map(r => r.v), order_types: types.map(r => r.v) }
}

// ── The board ────────────────────────────────────────────────

/** A stored order in the shape the Online orders board shows. */
export function boardOrder(r) {
  const cancelled = r.status === 'canceled' || r.status === 'cancelled'
  return {
    id: r.id,
    source: 'gloriafood',
    order_number: String(r.gf_order_id),
    status: cancelled ? 'cancelled' : r.board_status,
    gf_status: r.status,
    is_test: r.source === 'admin',
    guest_name: r.client_name || 'GloriaFood customer',
    guest_phone: r.client_phone,
    guest_email: null,
    address: r.client_address,
    notes: r.instructions,
    allergy_note: null,
    table_number: r.table_number,
    persons: r.persons,
    order_type: r.order_type,
    type_label: typeLabel(r.order_type),
    promised_at: r.fulfill_at,
    accepted_at: r.accepted_at,
    is_asap: !r.for_later,
    currency: r.currency || 'GBP',
    payment: r.payment,
    payment_label: paymentLabel(r.payment),
    used_payment_methods: r.used_payment_methods || [],
    paid_online: r.payment === 'ONLINE',
    items: (r.items || []).map((d, i) => ({
      id: String(i),
      qty: d.qty,
      name: d.name,
      options: (d.options || []).map(o => ({ label: (o.qty > 1 ? o.qty + ' x ' : '') + o.name })),
      note: d.note,
      line_total_pence: d.total_pence,
    })),
    subtotal_pence: r.subtotal_pence,
    items_pence: r.items_pence,
    discount_pence: r.discount_pence,
    delivery_fee_pence: r.delivery_fee_pence,
    tip_pence: r.tip_pence,
    service_fee_pence: r.service_fee_pence,
    tax_pence: r.tax_pence,
    total_pence: r.total_pence,
    restaurant_name: r.restaurant_name,
    board_status_by: r.board_status_by,
    board_status_at: r.board_status_at,
  }
}

/** The venue's GloriaFood orders for a board day (venue-local calendar day of the fulfil time). */
export async function boardOrders(tx, { tenantId, venueId, date, timezone }) {
  const start = zonedToUtc(date, '00:00', timezone || 'UTC')
  const next = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1)).toISOString().slice(0, 10)
  const end = zonedToUtc(next, '00:00', timezone || 'UTC')
  const rows = await tx`
    SELECT * FROM gloriafood_orders
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
       AND fulfill_at >= ${start} AND fulfill_at < ${end}
       AND status IN ('accepted', 'canceled', 'cancelled')
     ORDER BY fulfill_at, gf_order_id
  `
  return rows.map(boardOrder)
}

