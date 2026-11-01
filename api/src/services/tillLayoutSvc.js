// services/tillLayoutSvc.js
//
// Till layouts (migration 228; shared/pos/tillLayout.js): the layouts a
// venue's tills use, for their config, and the company's own ids check a
// saved layout goes through (sections, menus, dishes, discounts).

import { normaliseTillLayout, ownLayout, layoutIds } from '../../../shared/pos/tillLayout.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A till's own layout setting names a layout (not 'venue' or 'standard'). */
export const ownLayoutId = s => (typeof s?.till_layout === 'string' && UUID.test(s.till_layout) ? s.till_layout : null)

/**
 * The layouts a venue's tills use, by id: the venue's (pos_settings.till_layout_id)
 * and each till's own (settings.till_layout). Each is { id, name, cols, rows, zones }.
 */
export async function venueTillLayouts(tx, tenantId, settings, devices = []) {
  const ids = new Set()
  if (settings?.till_layout_id) ids.add(settings.till_layout_id)
  for (const d of devices) {
    const own = ownLayoutId(d.settings)
    if (own) ids.add(own)
  }
  if (!ids.size) return {}
  const rows = await tx`
    SELECT id, name, layout FROM pos_till_layouts WHERE tenant_id = ${tenantId} AND id = ANY(${[...ids]}::uuid[])`
  return Object.fromEntries(rows.map(r => [r.id, { id: r.id, name: r.name, ...normaliseTillLayout(r.layout) }]))
}

/** A layout as stored: normalised, naming only the company's own sections, menus, dishes and discounts. */
export async function ownTillLayout(tx, tenantId, raw) {
  const layout = normaliseTillLayout(raw)
  const ids = layoutIds(layout)
  const [sections, items, presets, menus] = await Promise.all([
    ids.sections.length ? tx`SELECT id FROM menu_sections WHERE tenant_id = ${tenantId} AND id = ANY(${ids.sections}::uuid[])` : [],
    ids.items.length ? tx`SELECT id FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids.items}::uuid[])` : [],
    ids.presets.length ? tx`SELECT id FROM pos_discounts WHERE tenant_id = ${tenantId} AND id = ANY(${ids.presets}::uuid[])` : [],
    ids.menus.length ? tx`SELECT id FROM menus WHERE tenant_id = ${tenantId} AND id = ANY(${ids.menus}::uuid[])` : [],
  ])
  return ownLayout(layout, {
    sectionIds: new Set(sections.map(r => r.id)),
    itemIds: new Set(items.map(r => r.id)),
    presetIds: new Set(presets.map(r => r.id)),
    menuIds: new Set(menus.map(r => r.id)),
  })
}

/** Where each layout is used: { [id]: { venues: [{ id, name }], tills: [{ id, name, venue_id, venue_name }] } }. */
export async function layoutUses(tx, tenantId) {
  const [venues, tills] = await Promise.all([
    tx`SELECT s.till_layout_id AS layout_id, v.id, v.name
         FROM pos_settings s JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
        WHERE s.tenant_id = ${tenantId} AND s.till_layout_id IS NOT NULL ORDER BY v.name`,
    tx`SELECT d.settings->>'till_layout' AS layout_id, d.id, d.name, d.venue_id, v.name AS venue_name
         FROM pos_devices d JOIN venues v ON v.id = d.venue_id AND v.tenant_id = d.tenant_id
        WHERE d.tenant_id = ${tenantId} AND d.kind = 'terminal' AND d.revoked_at IS NULL
          AND d.settings->>'till_layout' IS NOT NULL AND d.settings->>'till_layout' NOT IN ('venue', 'standard')
        ORDER BY v.name, d.name`,
  ])
  const out = {}
  const at = id => (out[id] ||= { venues: [], tills: [] })
  for (const v of venues) at(v.layout_id).venues.push({ id: v.id, name: v.name })
  for (const t of tills) at(t.layout_id).tills.push({ id: t.id, name: t.name, venue_id: t.venue_id, venue_name: t.venue_name })
  return out
}
