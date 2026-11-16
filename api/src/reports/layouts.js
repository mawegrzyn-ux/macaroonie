// src/reports/layouts.js
//
// A group's layout templates (docs/REPORTS.md 11; the rules are
// shared/reports/layout.js): how its reports look on paper and in a PDF.
//
//   layoutView(row)             a layout as the admin gets it
//   listLayouts(person)         the group's layouts, its default first
//   layoutFor(person, saved)    the settings a saved report or page prints
//                               with: its own pick, else the group's default,
//                               else null (the built-in layout)

import { withTenant } from '../config/db.js'
import { normaliseLayout, layoutWords } from '../../../shared/reports/layout.js'

export const layoutView = row => ({
  id: row.id,
  name: row.name,
  is_default: row.is_default,
  settings: normaliseLayout(row.settings),
  words: layoutWords(row.settings),
  created_at: row.created_at,
  updated_at: row.updated_at,
})

export function listLayouts(p) {
  return withTenant(p.tenantId, tx => tx`
    SELECT * FROM report_layouts WHERE tenant_id = ${p.tenantId}
     ORDER BY is_default DESC, lower(name), id`)
}

export async function layoutFor(p, saved = null) {
  const pick = saved?.layout_id || null
  const rows = await withTenant(p.tenantId, tx => tx`
    SELECT id, settings, is_default FROM report_layouts
     WHERE tenant_id = ${p.tenantId} AND (is_default OR id = ${pick}::uuid)`)
  const row = rows.find(r => r.id === pick) || rows.find(r => r.is_default)
  return row ? normaliseLayout(row.settings) : null
}
