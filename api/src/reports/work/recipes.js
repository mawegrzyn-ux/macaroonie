// src/reports/work/recipes.js
//
// What each recipe costs at each venue, worked out in code for a report run
// (inventory phase 1), merged into WORKS in work/index.js: one row per recipe
// per venue of the report (every venue when it names none), by the Recipes
// page's own rule (loadCosting() in services/costingSvc.js, recipeCost() in
// shared/costing.js) at the venue's standard supplier prices. Money is in
// pounds, before VAT; the catalogue keeps it behind Costing view.
//
// Not by period: a cost is today's prices. A report's venues narrow the rows.

import { loadRecipes, loadCosting } from '../../services/costingSvc.js'
import { recipeCost } from '../../../../shared/costing.js'

export const RECIPE_WORKS = {
  recipe_costs: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['recipe_id', 'uuid'],
      ['name', 'text'], ['kind', 'text'], ['category', 'text'], ['status', 'text'], ['active', 'boolean'],
      ['cost', 'numeric'], ['per_unit', 'numeric'], ['unit', 'text'], ['makes', 'numeric'],
      ['coverage', 'text'], ['gaps', 'int'], ['lines', 'int'], ['costed_lines', 'int'],
    ],
    async fill(tx, { tenantId, venueIds }) {
      const venues = venueIds || (await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId} ORDER BY created_at`).map(v => v.id)
      const recipes = await loadRecipes(tx, tenantId)
      if (!recipes.size) return []
      const rows = []
      for (const venueId of venues) {
        const ctx = await loadCosting(tx, tenantId, venueId, { recipes })
        for (const r of recipes.values()) {
          const c = recipeCost(r, ctx)
          rows.push({
            tenant_id: tenantId, id: r.id + '|' + venueId, venue_id: venueId, recipe_id: r.id,
            name: r.name, kind: r.kind, category: r.category, status: r.status, active: r.is_active,
            cost: c.cost, per_unit: c.per_unit, unit: c.unit, makes: c.makes,
            coverage: c.coverage, gaps: c.gaps.length, lines: c.lines.length, costed_lines: c.lines.filter(l => l.cost != null).length,
          })
        }
      }
      return rows
    },
  },
}
