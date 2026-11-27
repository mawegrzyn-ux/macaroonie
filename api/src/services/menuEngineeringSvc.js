// src/services/menuEngineeringSvc.js
//
// Menu engineering over usage from sales (inventory phase 7a, docs/INVENTORY.md
// 8.2): what the Engineering tab (routes/menuMargins.js GET /engineering),
// Pepper's menu_engineering (through that route) and the report work
// menu_engineering (reports/work/recipes.js) read. The rule is engineer() in
// shared/engineering.js; this file only reads dish_cost_days for it.

import { engineer, withoutSales } from '../../../shared/engineering.js'

/**
 * Menu engineering over dish_cost_days (inventory phase 7a): the rows summed
 * by dish, section and whether every unit was costed, the dishes' kinds (a
 * meal deal) and their sections' menus, then engineer(). Shared by the route,
 * the report work and Pepper (through the route). { sections (each with
 * menu_id and menu), total, left_out, auto_deals, worked_out_at }; with
 * sales: false, withoutSales() of it. auto_deals: [{ name, menu }] the
 * automatic meal deals on the menus engineered (the menu named, else the
 * menus of the sections that sold): found among dishes rung up one by one,
 * they are a discount over those dishes, which count in their own sections
 * (see shared/engineering.js), so the page and Pepper say so.
 */
export async function engineeringFor(tx, tenantId, { venueIds = null, from, to, menuId = null, sales = true } = {}) {
  const rows = await tx`
    SELECT d.dish_id, d.name, d.section_id, d.section, d.left_out, (d.cost IS NOT NULL AND d.uncosted_qty = 0) AS costed,
           sum(d.qty)::float8 AS qty, sum(d.net_pence)::bigint AS net_pence, sum(d.cost)::float8 AS cost,
           sum(d.typical_qty)::float8 AS typical_qty
      FROM dish_cost_days d
     WHERE d.tenant_id = ${tenantId} AND d.day BETWEEN ${from}::date AND ${to}::date
       ${venueIds ? tx`AND d.venue_id = ANY(${venueIds}::uuid[])` : tx``}
     GROUP BY d.dish_id, d.name, d.section_id, d.section, d.left_out, 6`
  const sectionIds = [...new Set(rows.map(r => r.section_id).filter(Boolean))]
  const dishIds = [...new Set(rows.map(r => r.dish_id).filter(Boolean))]
  const [sections, dishes, [run]] = await Promise.all([
    sectionIds.length ? tx`
      SELECT s.id, s.title, m.id AS menu_id, m.name AS menu FROM menu_sections s JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id
       WHERE s.tenant_id = ${tenantId} AND s.id = ANY(${sectionIds}::uuid[])` : [],
    dishIds.length ? tx`SELECT id, kind FROM menu_items WHERE tenant_id = ${tenantId} AND id = ANY(${dishIds}::uuid[])` : [],
    tx`SELECT max(computed_at) AS at FROM stock_usage_marks WHERE tenant_id = ${tenantId} ${venueIds ? tx`AND venue_id = ANY(${venueIds}::uuid[])` : tx``}`,
  ])
  const secOf = new Map(sections.map(s => [s.id, s]))
  const kindOf = new Map(dishes.map(d => [d.id, d.kind === 'combo' ? 'deal' : 'dish']))
  // A menu named: its sections only (the draft's; a release keeps the draft's ids).
  const kept = menuId ? rows.filter(r => r.section_id && secOf.get(r.section_id)?.menu_id === menuId) : rows
  const result = engineer(kept.map(r => ({
    dish_id: r.dish_id, name: r.name, section_id: r.section_id, section: secOf.get(r.section_id)?.title ?? r.section,
    kind: r.dish_id ? (kindOf.get(r.dish_id) ?? null) : null, left_out: r.left_out,
    qty: r.qty, net_pence: Number(r.net_pence), typical_qty: r.typical_qty,
    // A row with any unit not costed is left out of GP (all its units), never priced at nil.
    cost: r.costed ? r.cost : null, uncosted_qty: r.costed ? 0 : r.qty,
  })))
  for (const s of result.sections) {
    const m = secOf.get(s.section_id)
    s.menu_id = m?.menu_id ?? null
    s.menu = m?.menu ?? null
  }
  const menuIds = menuId ? [menuId] : [...new Set(result.sections.map(s => s.menu_id).filter(Boolean))]
  const autoDeals = menuIds.length ? await tx`
    SELECT i.name, m.name AS menu
      FROM menu_items i
      JOIN menu_sections s ON s.id = i.section_id AND s.tenant_id = i.tenant_id
      JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id
     WHERE i.tenant_id = ${tenantId} AND i.kind = 'combo' AND i.combo->>'mode' = 'auto' AND s.menu_id = ANY(${menuIds}::uuid[])
     ORDER BY m.name, s.sort_order, i.sort_order, i.name` : []
  const out = { ...result, auto_deals: autoDeals.map(d => ({ name: d.name, menu: d.menu })), worked_out_at: run?.at ?? null }
  return sales ? out : withoutSales(out)
}
