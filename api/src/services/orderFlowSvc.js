// services/orderFlowSvc.js
//
// Order flows (migration 235; shared/pos/orderFlows.js): the flows a
// venue's tills get in settings.flows (tillConfig(), the sequencer's
// printConfig() and so the venue hub), and the company's own ids check a
// saved flow goes through (dishes, sections, order types, charges,
// locations, tills).

import { normaliseOrderFlow, flowIds, ownFlow } from '../../../shared/pos/orderFlows.js'

/** A stored row as one flow (normaliseOrderFlow()), or null. */
export const flowOfRow = r => normaliseOrderFlow({ ...(r.flow || {}), id: r.id, name: r.name, on: r.is_active, sort_order: r.sort_order })

/**
 * The flows that run at a venue, switched on, in their order (sort_order,
 * then name). Each till then keeps the ones naming it, or every till.
 */
export async function loadOrderFlows(tx, tenantId, venueId) {
  const rows = await tx`
    SELECT id, name, is_active, sort_order, flow FROM pos_order_flows
     WHERE tenant_id = ${tenantId} AND is_active
     ORDER BY sort_order, lower(name), created_at`
  return rows.map(flowOfRow).filter(f => f && (f.venue_ids == null || f.venue_ids.includes(venueId)))
}

/** A flow as stored: normalised, naming only the company's own dishes, sections, order types, charges, locations and tills. */
export async function ownOrderFlow(tx, tenantId, raw) {
  const f = normaliseOrderFlow(raw)
  if (!f) return null
  const ids = flowIds(f)
  const q = (list, query) => (list.length ? query() : [])
  const [items, sections, types, charges, venues, devices] = await Promise.all([
    q(ids.items, () => tx`SELECT id FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids.items}::uuid[])`),
    q(ids.sections, () => tx`SELECT id FROM menu_sections WHERE tenant_id = ${tenantId} AND id = ANY(${ids.sections}::uuid[])`),
    q(ids.types, () => tx`SELECT id FROM order_types WHERE tenant_id = ${tenantId} AND id = ANY(${ids.types}::uuid[])`),
    q(ids.charges, () => tx`SELECT id FROM pos_charges WHERE tenant_id = ${tenantId} AND id = ANY(${ids.charges}::uuid[])`),
    q(ids.venues, () => tx`SELECT id FROM venues WHERE tenant_id = ${tenantId} AND id = ANY(${ids.venues}::uuid[])`),
    q(ids.devices, () => tx`
      SELECT id FROM pos_devices WHERE tenant_id = ${tenantId} AND kind = 'terminal' AND revoked_at IS NULL
         AND id = ANY(${ids.devices}::uuid[])`),
  ])
  const set = rows => new Set(rows.map(r => r.id))
  return ownFlow(f, {
    items: set(items), sections: set(sections), types: set(types),
    charges: set(charges), venues: set(venues), devices: set(devices),
  })
}

/**
 * What a flow's ids are called, for the designer and the list's words
 * (flowSummary() and the rest): { items, sections, types, charges, venues,
 * devices }, each { [id]: name }.
 */
export async function flowNames(tx, tenantId) {
  const [items, sections, types, charges, venues, devices] = await Promise.all([
    tx`SELECT id, name FROM menu_items WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, title AS name FROM menu_sections WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM pos_charges WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM venues WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM pos_devices WHERE tenant_id = ${tenantId} AND kind = 'terminal' AND revoked_at IS NULL`,
  ])
  const by = rows => Object.fromEntries(rows.map(r => [r.id, r.name]))
  return {
    items: by(items), sections: by(sections), types: by(types),
    charges: by(charges), venues: by(venues), devices: by(devices),
  }
}
