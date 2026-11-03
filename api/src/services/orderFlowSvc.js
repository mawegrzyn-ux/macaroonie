// services/orderFlowSvc.js
//
// Order flows (migrations 235, 236; shared/pos/orderFlows.js): the flows a
// venue's tills get in settings.flows (tillConfig(), the sequencer's
// printConfig() and so the venue hub), the ones its kiosks get
// (kioskConfig()) and the ones online ordering runs (onlineFlows()), and the
// company's own ids check a saved flow goes through (dishes, sections, order
// types, charges, locations, tills, kiosks).

import { normaliseOrderFlow, flowIds, ownFlow } from '../../../shared/pos/orderFlows.js'
import { normaliseCharge, chargeFromList } from '../../../shared/pos/charges.js'
import { loadTaxRates } from './taxSvc.js'

/** A stored row as one flow (normaliseOrderFlow()), or null. */
export const flowOfRow = r => normaliseOrderFlow({ ...(r.flow || {}), id: r.id, name: r.name, on: r.is_active, sort_order: r.sort_order })

/**
 * The flows that run at a venue, switched on, in their order (sort_order,
 * then name), on any app. Each till and kiosk then keeps the ones naming it,
 * or every till / kiosk. app: only the flows that run on it.
 */
export async function loadOrderFlows(tx, tenantId, venueId, { app = null } = {}) {
  const rows = await tx`
    SELECT id, name, is_active, sort_order, flow FROM pos_order_flows
     WHERE tenant_id = ${tenantId} AND is_active
     ORDER BY sort_order, lower(name), created_at`
  return rows.map(flowOfRow)
    .filter(f => f && (f.venue_ids == null || f.venue_ids.includes(venueId)) && (!app || f.apps.includes(app)))
}

/**
 * Order flows on online ordering at a venue, as shared/orderPricing.js
 * priceBasket() takes them (flows), or null when none runs there: the
 * flows, where online ordering is (its channel: the revenue stream Ordering
 * setup picks), the order's stream and order type (collection), and the
 * charges they put on as the list has them at this venue (with their VAT).
 */
export async function onlineFlows(tx, venue, settings) {
  const list = await loadOrderFlows(tx, venue.tenant_id, venue.id, { app: 'online' })
  if (!list.length) return null
  const streamId = settings?.revenue_stream_id || null
  const [stream] = streamId
    ? await tx`SELECT id, name FROM pos_revenue_streams WHERE id = ${streamId} AND tenant_id = ${venue.tenant_id}`
    : []
  const chargeIds = [...new Set(list.flatMap(f => f.adds.filter(a => a.kind === 'charge').map(a => a.charge_id)))]
  const charges = {}
  if (chargeIds.length) {
    const [rows, rates] = await Promise.all([
      tx`SELECT id, name, kind, value::float8 AS value, optional, min_covers, tax_rate_id, basis, per, item_ids, section_ids
           FROM pos_charges WHERE tenant_id = ${venue.tenant_id} AND id = ANY(${chargeIds}::uuid[])`,
      loadTaxRates(tx, venue.tenant_id),
    ])
    for (const r of rows) {
      const x = normaliseCharge(r)
      if (x) charges[x.id] = chargeFromList(x, venue.id, rates)
    }
  }
  return {
    list,
    here: { venueId: venue.id, app: 'online', streams: stream ? { [stream.id]: stream.name } : {} },
    revenue_stream_id: stream?.id || null,
    order_type_id: settings?.order_type_ids?.collection || null,
    charges,
  }
}

/** The dishes a list of flows can put on by themselves: [id]. */
export const flowDishIds = f => [...new Set((f?.list || []).flatMap(x => x.adds.filter(a => a.kind === 'dish').map(a => a.item_id)))]

/**
 * What the guest ordering page gets of onlineFlows(): the same, without
 * the flows' names (staff words) and the places only the server needs.
 */
export function publicFlows(f) {
  if (!f) return null
  return {
    ...f,
    list: f.list.map(x => ({ ...x, name: '', venue_ids: null, till_ids: null, kiosk_ids: null, sort_order: undefined })),
  }
}

/** A flow as stored: normalised, naming only the company's own dishes, sections, order types, charges, locations, tills and kiosks. */
export async function ownOrderFlow(tx, tenantId, raw) {
  const f = normaliseOrderFlow(raw)
  if (!f) return null
  const ids = flowIds(f)
  const q = (list, query) => (list.length ? query() : [])
  const [items, sections, types, charges, venues, tills, kiosks] = await Promise.all([
    q(ids.items, () => tx`SELECT id FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids.items}::uuid[])`),
    q(ids.sections, () => tx`SELECT id FROM menu_sections WHERE tenant_id = ${tenantId} AND id = ANY(${ids.sections}::uuid[])`),
    q(ids.types, () => tx`SELECT id FROM order_types WHERE tenant_id = ${tenantId} AND id = ANY(${ids.types}::uuid[])`),
    q(ids.charges, () => tx`SELECT id FROM pos_charges WHERE tenant_id = ${tenantId} AND id = ANY(${ids.charges}::uuid[])`),
    q(ids.venues, () => tx`SELECT id FROM venues WHERE tenant_id = ${tenantId} AND id = ANY(${ids.venues}::uuid[])`),
    q(ids.tills, () => tx`
      SELECT id FROM pos_devices WHERE tenant_id = ${tenantId} AND kind = 'terminal' AND revoked_at IS NULL
         AND id = ANY(${ids.tills}::uuid[])`),
    q(ids.kiosks, () => tx`
      SELECT id FROM pos_devices WHERE tenant_id = ${tenantId} AND kind = 'kiosk' AND revoked_at IS NULL
         AND id = ANY(${ids.kiosks}::uuid[])`),
  ])
  const set = rows => new Set(rows.map(r => r.id))
  return ownFlow(f, {
    items: set(items), sections: set(sections), types: set(types),
    charges: set(charges), venues: set(venues), tills: set(tills), kiosks: set(kiosks),
  })
}

/**
 * What a flow's ids are called, for the designer and the list's words
 * (flowSummary() and the rest): { items, sections, types, charges, venues,
 * tills, kiosks }, each { [id]: name }.
 */
export async function flowNames(tx, tenantId) {
  const [items, sections, types, charges, venues, devices] = await Promise.all([
    tx`SELECT id, name FROM menu_items WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, title AS name FROM menu_sections WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM pos_charges WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM venues WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name, kind FROM pos_devices WHERE tenant_id = ${tenantId} AND kind IN ('terminal', 'kiosk') AND revoked_at IS NULL`,
  ])
  const by = rows => Object.fromEntries(rows.map(r => [r.id, r.name]))
  return {
    items: by(items), sections: by(sections), types: by(types),
    charges: by(charges), venues: by(venues),
    tills: by(devices.filter(d => d.kind === 'terminal')), kiosks: by(devices.filter(d => d.kind === 'kiosk')),
  }
}
