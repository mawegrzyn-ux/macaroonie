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
//
// Recipe coverage (phase 3): one row per dish sold on a trading day at a
// venue (and revenue stream, order type, channel) in the report's period
// (the last 30 days when it has none), from the Recipes page's own reading
// (loadSold() in services/recipeCoverageSvc.js: till, kiosk, online and
// imported sales, test till sales left out) and judged by its rule
// (salesCoverage() in shared/costing.js): costed or not, and why, at
// today's recipes and prices.
//
// Menu engineering (phase 7a): one row per dish sold in each menu section
// over the report's period (the last 28 days to yesterday when it has none;
// a comparison period is left out), the report's venues together, by the
// Engineering tab's own rule (engineer() in shared/engineering.js over
// dish_cost_days, read by services/menuEngineeringSvc.js): its class, units,
// share, GP per unit against the section's average, total GP and cost %.

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

  recipe_coverage: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['date', 'date'], ['dish_id', 'uuid'],
      ['dish', 'text'], ['menu', 'text'], ['channel', 'text'], ['where_sold', 'text'],
      ['sales_pence', 'bigint'], ['qty', 'numeric'], ['state', 'text'], ['costed', 'boolean'],
      ['fix_kind', 'text'], ['why', 'text'], ['recipe', 'text'],
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      // Loaded when a run asks for it: the sales and menu loaders reach other areas' files.
      const { loadSold, coverageCtx, lastDays } = await import('../../services/recipeCoverageSvc.js')
      const { salesCoverage, LEFT_OUT_WHY } = await import('../../../../shared/costing.js')
      const span = ranges?.length
        ? { from: ranges.map(r => r.from).sort()[0], to: ranges.map(r => r.to).sort().at(-1) }
        : await lastDays(tx)
      const rows = await loadSold(tx, tenantId, { venueIds, from: span.from, to: span.to, byDay: true })
      if (!rows.length) return []
      const { ctxFor } = await coverageCtx(tx, tenantId)
      const judged = []
      salesCoverage(rows, ctxFor, { judged })
      return judged.map(({ row: r, state: st }, i) => ({
        tenant_id: tenantId, id: [r.day, r.venue_id, r.dish_id || r.name, r.revenue_stream_id, r.order_type_id, r.channel, i].join('|'),
        venue_id: r.venue_id, date: r.day, dish_id: r.dish_id, dish: st.dish?.name || r.name, menu: st.dish?.menu ?? null,
        channel: r.channel, where_sold: st.where, sales_pence: r.sales_pence, qty: r.qty, state: st.state, costed: st.state === 'costed',
        fix_kind: st.fixes[0]?.kind ?? null,
        why: st.state === 'left_out' ? LEFT_OUT_WHY[st.reason] : st.fixes.map(f => f.text).join(' ') || null,
        recipe: st.recipe?.name ?? null,
      }))
    },
  },

  menu_engineering: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['date', 'date'], ['menu_id', 'uuid'], ['section_id', 'uuid'], ['dish_id', 'uuid'],
      ['dish', 'text'], ['section', 'text'], ['menu', 'text'], ['kind', 'text'], ['class', 'text'], ['popular', 'boolean'], ['profitable', 'boolean'],
      ['units', 'numeric'], ['share_pct', 'numeric'], ['popular_pct', 'numeric'], ['costed_units', 'numeric'], ['uncosted_units', 'numeric'],
      ['net_pence', 'bigint'], ['cost_pence', 'bigint'], ['gp_pence', 'bigint'], ['gp_per_unit_pence', 'numeric'], ['avg_gp_per_unit_pence', 'numeric'],
      ['cost_pct', 'numeric'], ['suggestion', 'text'],
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      // Loaded when a run asks for it: the reading of usage from sales sits with the recipes area's services.
      const { engineeringFor } = await import('../../services/menuEngineeringSvc.js')
      const { classWords } = await import('../../../../shared/engineering.js')
      const [last] = await tx`SELECT (current_date - 28)::text AS from, (current_date - 1)::text AS to`
      const span = ranges?.length ? ranges[0] : last
      const e = await engineeringFor(tx, tenantId, { venueIds, from: span.from, to: span.to })
      const rows = []
      for (const s of e.sections) {
        for (const d of s.dishes) {
          rows.push({
            tenant_id: tenantId, id: s.section_id + '|' + d.dish_id, date: span.to, menu_id: s.menu_id, section_id: s.section_id, dish_id: d.dish_id,
            dish: d.name, section: s.section, menu: s.menu, kind: d.kind || 'dish', class: d.class || 'not_costed', popular: d.popular, profitable: d.profitable,
            units: d.units, share_pct: d.share_pct, popular_pct: s.popular_pct, costed_units: d.costed_units, uncosted_units: d.uncosted_units,
            net_pence: d.net_pence, cost_pence: d.cost_pence, gp_pence: d.gp_pence, gp_per_unit_pence: d.gp_per_unit_pence,
            avg_gp_per_unit_pence: s.avg_gp_per_unit_pence, cost_pct: d.cost_pct, suggestion: classWords(d.class).suggestion,
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
