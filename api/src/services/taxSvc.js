// src/services/taxSvc.js
//
// Tax rates and order types (migration 170). The rule that turns a dish's
// tax settings into a rate is shared/tax.js; this file loads what it needs
// and checks settings before they are saved.
//
//   ensureTaxDefaults(tx, tenantId)   Standard 20% (default) + Zero 0% and
//                                     the four order types, for a tenant
//                                     with none (new tenants; safe to repeat)
//   loadTaxRates(tx, tenantId)        every rate (inactive too, so old
//                                     settings still resolve) with its
//                                     per-location values
//   loadOrderTypes(tx, tenantId)      every order type, active first
//   taxLookups(tx, tenantId)          rates, order types, streams, venues:
//                                     what a setting may name
//   checkTaxSetting(tax, lookups, label)  throws 422 with the first problem
//   saleContext(...)                  { venue_id, order_type_id, revenue_stream_id }

import { httpError } from '../middleware/error.js'
import { taxProblems, cleanTax, normTax } from '../../../shared/tax.js'

export const DEFAULT_ORDER_TYPES = ['Eat in', 'Take out', 'Delivery', 'Collection']

export async function ensureTaxDefaults(tx, tenantId) {
  const [{ rates, types }] = await tx`
    SELECT (SELECT count(*)::int FROM tax_rates WHERE tenant_id = ${tenantId}) AS rates,
           (SELECT count(*)::int FROM order_types WHERE tenant_id = ${tenantId}) AS types`
  if (!rates) {
    await tx`INSERT INTO tax_rates (tenant_id, name, rate, is_default, sort_order) VALUES
      (${tenantId}, 'Standard', 20, true, 0), (${tenantId}, 'Zero', 0, false, 1)`
  }
  if (!types) {
    for (const [i, name] of DEFAULT_ORDER_TYPES.entries()) {
      await tx`INSERT INTO order_types (tenant_id, name, sort_order) VALUES (${tenantId}, ${name}, ${i})`
    }
  }
}

export async function loadTaxRates(tx, tenantId) {
  const [rates, values] = await Promise.all([
    tx`SELECT id, name, rate::float8 AS rate, is_default, is_active, sort_order
         FROM tax_rates WHERE tenant_id = ${tenantId} ORDER BY is_active DESC, sort_order, name`,
    tx`SELECT tax_rate_id, venue_id, rate::float8 AS rate FROM tax_rate_values WHERE tenant_id = ${tenantId}`,
  ])
  return rates.map(r => ({
    ...r,
    values: Object.fromEntries(values.filter(v => v.tax_rate_id === r.id).map(v => [v.venue_id, v.rate])),
  }))
}

export async function loadOrderTypes(tx, tenantId) {
  return tx`SELECT id, name, colour, sort_order, is_active FROM order_types
             WHERE tenant_id = ${tenantId} ORDER BY is_active DESC, sort_order, name`
}

/**
 * A venue's revenue streams with their order type settings:
 *   { id, name, menu_ids, service_charge_percent, service_charge_min_covers,
 *     colour, sort_order, is_active, default_order_type_id,
 *     order_types: [{ order_type_id, enabled, ask_name, ask_tent }] }
 * A type with no row is off for the stream.
 */
export async function loadStreams(tx, tenantId, venueId, { activeOnly = false } = {}) {
  const [streams, settings] = await Promise.all([
    tx`SELECT id, name, menu_ids, service_charge_percent::float8 AS service_charge_percent, service_charge_min_covers,
              colour, sort_order, is_active, default_order_type_id
         FROM pos_revenue_streams
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ${activeOnly ? tx`AND is_active` : tx``}
        ORDER BY sort_order, name`,
    tx`SELECT x.stream_id, x.order_type_id, x.enabled, x.ask_name, x.ask_tent
         FROM pos_stream_order_types x
         JOIN pos_revenue_streams s ON s.id = x.stream_id AND s.tenant_id = x.tenant_id
        WHERE x.tenant_id = ${tenantId} AND s.venue_id = ${venueId}`,
  ])
  return streams.map(s => ({
    ...s,
    order_types: settings.filter(x => x.stream_id === s.id)
      .map(x => ({ order_type_id: x.order_type_id, enabled: x.enabled, ask_name: x.ask_name, ask_tent: x.ask_tent })),
  }))
}

/** What a tax setting may name, for checkTaxSetting(). */
export async function taxLookups(tx, tenantId) {
  const [rates, types, streams, venues] = await Promise.all([
    tx`SELECT id FROM tax_rates WHERE tenant_id = ${tenantId}`,
    tx`SELECT id FROM order_types WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, venue_id FROM pos_revenue_streams WHERE tenant_id = ${tenantId}`,
    tx`SELECT id FROM venues WHERE tenant_id = ${tenantId}`,
  ])
  return { rates, types, streams, venues }
}

/**
 * A setting from a request, cleaned, or a 422 naming the first problem.
 * Removed (inactive) rates still count as the tenant's: a menu restored
 * from an old release may name one. The pickers only offer active ones.
 */
export function checkTaxSetting(tax, lookups, label = 'Tax') {
  const clean = cleanTax(tax)
  const problems = taxProblems(clean, lookups)
  if (problems.length) throw httpError(422, label + ': ' + problems[0])
  return clean
}

/** Every rate id a setting names. */
export function taxRateIds(tax) {
  const t = normTax(tax)
  return [t.rate, ...t.rules.map(r => r.rate)].filter(Boolean)
}

/** A setting trimmed to what matters at one location (rules for other locations dropped). */
export function taxForVenue(tax, venueId, streamIds) {
  const t = normTax(tax)
  return {
    rate: t.rate,
    rules: t.rules.filter(r => (!r.venues.length || r.venues.includes(venueId))
      && (!r.streams.length || r.streams.some(id => streamIds.has(id)))),
  }
}

export function saleContext(venueId, orderTypeId = null, streamId = null) {
  return { venue_id: venueId, order_type_id: orderTypeId || null, revenue_stream_id: streamId || null }
}
