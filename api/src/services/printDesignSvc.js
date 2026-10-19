// src/services/printDesignSvc.js
//
// Print designs (migration 190; shared/pos/ticketLayout.js): which design a
// location prints its kitchen tickets, till receipts and kiosk receipts in,
// with that location's words and hidden blocks applied. tillConfig(),
// kioskConfig() and the sequencer's printConfig() carry the result so tills,
// kiosks and the venue hub draw tickets with shared/pos/tickets.js.

import { normaliseLayout, normaliseVariation, applyVariation, USE_KEYS } from '../../../shared/pos/ticketLayout.js'

export function designView(row) {
  return {
    id: row.id, kind: row.kind, name: row.name,
    layout: normaliseLayout(row.kind, row.layout),
    created_at: row.created_at, created_by: row.created_by ?? null,
    updated_at: row.updated_at, updated_by: row.updated_by ?? null,
  }
}

/** Design ids per use: { company: { use: id }, venues: { venueId: { use: id } } }. */
export async function loadUses(tx, tenantId, venueId = null) {
  const rows = venueId
    ? await tx`SELECT venue_id, use, design_id FROM print_design_uses WHERE tenant_id = ${tenantId} AND (venue_id IS NULL OR venue_id = ${venueId})`
    : await tx`SELECT venue_id, use, design_id FROM print_design_uses WHERE tenant_id = ${tenantId}`
  const out = { company: {}, venues: {} }
  for (const r of rows) {
    if (!r.venue_id) out.company[r.use] = r.design_id
    else (out.venues[r.venue_id] ||= {})[r.use] = r.design_id
  }
  return out
}

/** The design id each use prints in at a location (venue, else company; kiosk receipts fall back to receipts). */
export function resolveUses(uses, venueId) {
  const own = uses.venues?.[venueId] || {}
  const pick = use => own[use] || uses.company?.[use] || null
  const ids = Object.fromEntries(USE_KEYS.map(u => [u, pick(u)]))
  ids.kiosk_receipt ||= ids.receipt
  return ids
}

/**
 * The layouts a location prints: { kitchen, receipt, kiosk_receipt }, each a
 * layout with the location's words and hidden blocks applied, or null for
 * the built-in one.
 */
export async function printLayouts(tx, tenantId, venueId) {
  const ids = resolveUses(await loadUses(tx, tenantId, venueId), venueId)
  const want = [...new Set(Object.values(ids).filter(Boolean))]
  const out = Object.fromEntries(USE_KEYS.map(u => [u, null]))
  if (!want.length) return out
  const [designs, variations] = await Promise.all([
    tx`SELECT id, kind, layout FROM print_designs WHERE tenant_id = ${tenantId} AND id = ANY(${want})`,
    tx`SELECT design_id, texts, hidden FROM print_design_variations WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND design_id = ANY(${want})`,
  ])
  for (const use of USE_KEYS) {
    const d = designs.find(x => x.id === ids[use])
    if (!d) continue
    const layout = normaliseLayout(d.kind, d.layout)
    const v = variations.find(x => x.design_id === d.id)
    out[use] = applyVariation(layout, v ? normaliseVariation(layout, v) : null)
  }
  return out
}
