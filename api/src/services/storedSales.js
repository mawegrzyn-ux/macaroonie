// src/services/storedSales.js
//
// Sales from other tills, phase 4 (docs/SALES_IMPORT.md 3.5, 6): reading a
// venue's stored sales (ext_checks and its lines and payments) by trading
// day. The Cash Recon fill (routes/loyverse.js), the stored day route that
// Pepper's till_day and Today read (routes/integrations.js) use it, so a
// day's figures are summed once: dayFiguresFromStored() in
// shared/externalSales.js. Nothing here asks the other till.
//
//   venueLink(tx, tenantId, venueId)   the venue's link to another till with
//                                      its connection's sync marks, or null
//   storedDays(tx, tenantId, link, dates, { categories })
//                                      { [date]: figures + { checks,
//                                      covered, not_synced } }

import { tradingDay } from './loyverseSvc.js'
import { dayFiguresFromStored, dayCovered } from '../../../shared/externalSales.js'

/** The venue's link to another till's location, with what the sync has reached. */
export async function venueLink(tx, tenantId, venueId) {
  const [link] = await tx`
    SELECT l.venue_id, l.connection_id, l.location_id, l.location_name, l.day_starts_at, l.mappings,
           l.history_from, l.history_to, l.history_next_from, l.history_done_at,
           c.system, c.name AS connection_name, c.currency, c.status, c.sales_synced_to, c.last_sync_ok_at,
           v.name AS venue_name, v.timezone
      FROM pos_connection_venues l
      JOIN pos_connections c ON c.id = l.connection_id AND c.tenant_id = l.tenant_id
      JOIN venues v ON v.id = l.venue_id AND v.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} AND l.venue_id = ${venueId}`
  return link || null
}

/**
 * Each date's figures from the stored checks of the link's connection at
 * the venue (dayFiguresFromStored()), with `checks` (how many are stored,
 * cancelled ones too), `covered` (dayCovered(): the sync has passed the
 * day's end) and `not_synced` (nothing stored and not covered: the day
 * hasn't come in yet, so its zeros mean nothing). categories: also read
 * each item's category from the stored catalogue (for category terms).
 */
export async function storedDays(tx, tenantId, link, dates, { categories = false } = {}) {
  const where = { venue: link.venue_id, conn: link.connection_id }
  const [checks, lines, payments, cats] = await Promise.all([
    tx`SELECT id, business_date::text AS date, kind, cancelled, discount_pence, tax_pence, tip_pence, charge_pence, total_pence
         FROM ext_checks
        WHERE tenant_id = ${tenantId} AND venue_id = ${where.venue} AND connection_id = ${where.conn}
          AND business_date = ANY(${dates}::date[])`,
    tx`SELECT l.check_id, l.line_kind, l.item_ref, l.name, l.gross_pence, l.net_pence
         FROM ext_check_lines l
         JOIN ext_checks c ON c.id = l.check_id AND c.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId} AND l.line_kind = 'item'
          AND c.venue_id = ${where.venue} AND c.connection_id = ${where.conn} AND c.business_date = ANY(${dates}::date[])
        ORDER BY l.check_id, l.line_no`,
    tx`SELECT p.check_id, p.payment_type_ref, p.name, p.amount_pence
         FROM ext_check_payments p
         JOIN ext_checks c ON c.id = p.check_id AND c.tenant_id = p.tenant_id
        WHERE p.tenant_id = ${tenantId}
          AND c.venue_id = ${where.venue} AND c.connection_id = ${where.conn} AND c.business_date = ANY(${dates}::date[])`,
    categories
      ? tx`SELECT external_id, category_ref FROM ext_catalog
            WHERE tenant_id = ${tenantId} AND connection_id = ${where.conn} AND kind = 'item' AND category_ref IS NOT NULL`
      : null,
  ])
  const byCheck = new Map(checks.map(c => [c.id, { ...c, lines: [], payments: [] }]))
  for (const l of lines) byCheck.get(l.check_id)?.lines.push(l)
  for (const p of payments) byCheck.get(p.check_id)?.payments.push(p)
  const itemCategory = cats ? Object.fromEntries(cats.map(r => [r.external_id, r.category_ref])) : null
  const cover = {
    synced_to: link.sales_synced_to, history_from: link.history_from, history_to: link.history_to,
    history_next_from: link.history_next_from, history_done_at: link.history_done_at,
  }
  const out = {}
  for (const date of dates) {
    const list = [...byCheck.values()].filter(c => c.date === date)
    const covered = dayCovered(cover, tradingDay(date, link.timezone || 'Europe/London', link.day_starts_at || '00:00'))
    out[date] = { ...dayFiguresFromStored(list, itemCategory), checks: list.length, covered, not_synced: !list.length && !covered }
  }
  return out
}
