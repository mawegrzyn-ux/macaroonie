// src/reports/work/recipes.js
//
// What each recipe costs at each venue, worked out in code for a report run
// (inventory phase 1), merged into WORKS in work/index.js: one row per recipe
// per venue of the report (every venue when it names none), by the Recipes
// page's own rule (loadCosting() in services/costingSvc.js, recipeCost() in
// shared/costing.js) at the venue's standard supplier prices. Money is in
// pounds, before VAT; the catalogue keeps it behind Costing view.
//
// Dish margins (phase 2): one row per live menu dish at each venue (of its
// menu's venues) and each active order type, by the Menu margins page's own
// rule (menuMargins() in shared/costing.js on loadDishCosting()'s ctx): the
// menu price and the price net of VAT in pence, the cost in pounds, GP in
// pence, cost % and its band against the targets.
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

  dish_margins: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['menu_id', 'uuid'], ['dish_id', 'uuid'], ['order_type_id', 'uuid'],
      ['dish', 'text'], ['menu', 'text'], ['section', 'text'], ['kind', 'text'], ['order_type', 'text'],
      ['recipe', 'text'], ['why', 'text'], ['has_recipe', 'boolean'],
      ['price_pence', 'int'], ['net_pence', 'int'], ['vat_rate', 'numeric'],
      ['cost', 'numeric'], ['cost_low', 'numeric'], ['cost_high', 'numeric'], ['gp_pence', 'int'], ['cost_pct', 'numeric'],
      ['band', 'text'], ['target_pct', 'numeric'], ['coverage', 'text'], ['gaps', 'int'],
    ],
    async fill(tx, { tenantId, venueIds }) {
      // Loaded when a run asks for it: the menu and dish loaders reach the menus' own files.
      const { loadDishCosting, loadCostingSettings, menusFor } = await import('../../services/dishCostSvc.js')
      const { loadTaxRates } = await import('../../services/taxSvc.js')
      const { menuMargins } = await import('../../../../shared/costing.js')
      const venues = venueIds
        ? (await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId} AND id = ANY(${venueIds}::uuid[]) ORDER BY created_at`)
        : (await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId} AND is_active ORDER BY created_at`)
      const menus = await menusFor(tx, tenantId, 'live')
      if (!venues.length || !menus.length) return []
      const [types, rates, settings, recipes] = await Promise.all([
        tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`,
        loadTaxRates(tx, tenantId), loadCostingSettings(tx, tenantId), loadRecipes(tx, tenantId),
      ])
      const rows = []
      for (const { id: venueId } of venues) {
        const ctx = await loadDishCosting(tx, tenantId, venueId, { recipes })
        for (const menu of menus.filter(m => !m.venue_id || m.venue_id === venueId)) {
          for (const t of types) {
            for (const r of menuMargins(menu, { venue_id: venueId, revenue_stream_id: null, order_type_id: t.id }, ctx, { rates, settings, withOptions: false })) {
              rows.push({
                tenant_id: tenantId, id: [r.dish_id, venueId, t.id].join('|'), venue_id: venueId, menu_id: menu.id, dish_id: r.dish_id,
                order_type_id: t.id, dish: r.name, menu: menu.name, section: r.section, kind: r.kind, order_type: t.name,
                recipe: r.recipe?.name ?? null, why: r.why, has_recipe: !!r.recipe,
                price_pence: r.price_pence, net_pence: r.net_pence, vat_rate: r.vat_rate,
                cost: r.cost, cost_low: r.cost_min ?? null, cost_high: r.cost_max ?? null,
                gp_pence: r.gp_pence ?? null, cost_pct: r.kind === 'deal' ? r.cost_pct_max : r.cost_pct,
                band: r.band, target_pct: r.thresholds.target_pct, coverage: r.coverage, gaps: r.gaps.length,
              })
            }
          }
        }
      }
      return rows
    },
  },
}
