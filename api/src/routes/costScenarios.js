// src/routes/costScenarios.js
//
// Cost scenarios (inventory phase 7a, docs/INVENTORY.md 8.2; migration 314),
// mounted at /api/cost-scenarios, for Menu margins' Scenarios tab and
// Pepper's save_scenario. A scenario is a menu at a venue (and revenue
// stream) and order type, the days its mix is read over, and changes in
// order: a price or a cost by a figure or a percentage, or set, for a dish,
// a section or every dish. Its figures are worked out on each read by
// scenarioFigures() in shared/scenarios.js on the menu's DRAFT (what Push
// prices changes): every dish before and after, and the weighted cost % and
// GP at the real mix (units sold from dish_cost_days, usage from sales).
//
//   GET    /                  the group's scenarios (newest first)
//   POST   /preview           an unsaved scenario's figures (the builder)
//   GET    /:id               a scenario with its figures
//   POST   /                  a new scenario                       Manage
//   PUT    /:id               the whole scenario (rule 13)         Manage
//   POST   /:id/copy          a copy, "(copy)" after its name      Manage
//   DELETE /:id                                                     Manage
//   POST   /:id/push/preview  every price Push prices would write into the
//                             menu's draft, where the menu is sold, and what
//                             the draft already holds that isn't live; with a
//                             stamp of the list                    Manage + Menus manage
//   POST   /:id/push          { stamp } writes those prices into the DRAFT
//                             through the menus area's own routes as the
//                             person (GET /api/menus/:id, menuSaveBody() with
//                             every field, the whole-tree PATCH): never
//                             publishes. Refused (409) when the draft changed
//                             since the preview                    Manage + Menus manage
//
// Reading needs Costing view (a cost tells what suppliers charge); saving,
// copying and deleting Costing manage. Net sales and GP at the mix are the
// till's sales in pounds: they need till reports view as well (as the Sold
// tab), and are left out without it (sees_sales false); per-dish prices,
// costs, GP per dish and cost % are the menu's and need Costing view only.
// Every id is the group's (rule 4): the menu, venue, stream (its venue's),
// order type, and each change's section and dish (the menu draft's own).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { permissionAtLeast } from '../config/modules.js'
import { httpError } from '../middleware/error.js'
import { loadMenuVersion, publishStatus } from '../services/menuReleases.js'
import { loadDishCosting, loadScopes, loadCostingSettings } from '../services/dishCostSvc.js'
import { loadPickMix } from '../services/recipeCoverageSvc.js'
import { loadTaxRates } from '../services/taxSvc.js'
import { makeContext, callApi, staffAuthOf, staffPrincipalOf, ToolError } from '../ai/context.js'
import { pickMix, scopeText } from '../../../shared/costing.js'
import { isCombo } from '../../../shared/combos.js'
import { resolveItemTypes } from '../../../shared/catalogue.js'
import { menuSaveBody } from '../../../shared/menuSave.js'
import {
  scenarioFigures, pushPrices, priceStamp, changeProblem, changeWords, MAX_CHANGES, MIX_DAYS, ROUND_TO, ROUND_MODES,
} from '../../../shared/scenarios.js'

const uuid = z.string().uuid()
export const Change = z.object({
  what: z.enum(['price', 'cost']),
  applies: z.enum(['all', 'section', 'dish']),
  section_id: uuid.nullable().optional(),
  dish_id: uuid.nullable().optional(),
  how: z.enum(['percent', 'amount', 'set']),
  value: z.number().finite(),
  round_to: z.number().int().refine(v => ROUND_TO.includes(v), 'Round to 1, 5, 10, 50 or 100 pence').nullable().optional(),
  round: z.enum(ROUND_MODES).nullable().optional(),
}).strict()
// The whole scenario: every field, also on a change (rule 13).
export const ScenarioBody = z.object({
  name: z.string().trim().min(1).max(120),
  menu_id: uuid,
  venue_id: uuid.nullable(),
  revenue_stream_id: uuid.nullable(),
  order_type_id: uuid.nullable(),
  mix_days: z.number().int().min(1).max(93),
  changes: z.array(Change).max(MAX_CHANGES),
  notes: z.string().max(1000).nullable(),
}).strict()
const PreviewBody = ScenarioBody.extend({ name: z.string().trim().max(120).optional(), notes: z.string().max(1000).nullable().optional() })
const PushBody = z.object({ stamp: z.string().min(1).max(80) }).strict()

const canView = requirePermission('costing', 'view')
const canManage = requirePermission('costing', 'manage')
// Push prices changes a menu: Menus manage as well (the menus routes check it again, as the person).
const canPush = [canManage, requirePermission('menus', 'manage')]
const who = req => req.user?.email ?? req.user?.sub ?? null
const COLS = 'id, name, menu_id, venue_id, revenue_stream_id, order_type_id, mix_days, changes, notes, created_by, updated_by, pushed_at, pushed_by, created_at, updated_at'

/** A change kept as it means: the ids its target needs, rounding for prices only. */
const clean = c => ({
  what: c.what, applies: c.applies,
  section_id: c.applies === 'section' ? c.section_id : null,
  dish_id: c.applies === 'dish' ? c.dish_id : null,
  how: c.how, value: c.value,
  round_to: c.what === 'price' && c.how !== 'set' ? (c.round_to ?? 1) : null,
  round: c.what === 'price' && c.how !== 'set' ? (c.round ?? 'nearest') : null,
})

/** The menu draft's sections and dishes (names by id), for the checks and the words. */
async function menuNames(tx, tenantId, menuId) {
  const [sections, dishes] = await Promise.all([
    tx`SELECT id, title FROM menu_sections WHERE tenant_id = ${tenantId} AND menu_id = ${menuId}`,
    tx`SELECT i.id, i.name FROM menu_items i JOIN menu_sections s ON s.id = i.section_id AND s.tenant_id = i.tenant_id
        WHERE i.tenant_id = ${tenantId} AND s.menu_id = ${menuId}`,
  ])
  return { sections: Object.fromEntries(sections.map(s => [s.id, s.title])), dishes: Object.fromEntries(dishes.map(d => [d.id, d.name])) }
}

/** Every id the body names is the group's (rule 4), and each change says what it does; the changes cleaned. */
async function checkBody(tx, tenantId, b) {
  const [menu] = await tx`SELECT id, name, venue_id FROM menus WHERE id = ${b.menu_id} AND tenant_id = ${tenantId}`
  if (!menu) throw httpError(404, 'Menu not found')
  const scopes = await loadScopes(tx, tenantId)
  if (b.venue_id && !scopes.venues.some(v => v.id === b.venue_id)) throw httpError(404, 'Venue not found')
  const stream = b.revenue_stream_id ? scopes.streams.find(s => s.id === b.revenue_stream_id) : null
  if (b.revenue_stream_id && !stream) throw httpError(404, 'Revenue stream not found')
  if (stream && stream.venue_id !== b.venue_id) throw httpError(422, stream.name + ' is another venue\'s revenue stream', { code: 'stream_venue' })
  if (b.order_type_id && !scopes.types.some(t => t.id === b.order_type_id)) throw httpError(404, 'Order type not found')
  const names = await menuNames(tx, tenantId, b.menu_id)
  const changes = b.changes.map(clean)
  for (const c of changes) {
    const problem = changeProblem(c)
    if (problem) throw httpError(422, problem, { code: 'change' })
    if (c.applies === 'section' && !names.sections[c.section_id]) throw httpError(404, 'A change names a section that isn\'t on this menu')
    if (c.applies === 'dish' && !names.dishes[c.dish_id]) throw httpError(404, 'A change names a dish that isn\'t on this menu')
  }
  return { menu, scopes, names, changes }
}

const sideMoney = ['net_pence', 'gp_pence']
/** Figures without the sales at the mix (net and GP in pounds) for people without till reports view. */
function withoutSales(fig) {
  const side = s => Object.fromEntries(Object.entries(s).filter(([k]) => !sideMoney.includes(k)))
  const agg = a => ({ ...a, before: side(a.before), after: side(a.after), change: { ...a.change, gp_pence: undefined } })
  return { ...fig, sections: fig.sections.map(agg), total: agg(fig.total) }
}

/**
 * A scenario's figures: the menu's draft at the scope's prices and VAT, the
 * units sold over the last mix_days up to yesterday at the scope (every
 * venue when it names none; its stream and order type when it names them),
 * the meal deals' typical picks from the same days. scenarioFigures() does
 * the rest. { figures, mix: { from, to, days }, menu, where, words }.
 */
export async function scenarioView(tx, tenantId, s, { sales = true, scopes = null, names = null } = {}) {
  const loaded = await loadMenuVersion(tx, s.menu_id, tenantId, { version: 'draft' })
  if (!loaded) throw httpError(404, 'Menu not found')
  const menu = resolveItemTypes(loaded)
  const sc = scopes || await loadScopes(tx, tenantId)
  const stream = s.revenue_stream_id ? sc.streams.find(x => x.id === s.revenue_stream_id) : null
  const scope = { venue_id: stream?.venue_id || s.venue_id || null, revenue_stream_id: s.revenue_stream_id || null, order_type_id: s.order_type_id || null }
  const dishIds = (menu.sections || []).flatMap(x => (x.items || []).map(i => i.id))
  const dealIds = (menu.sections || []).flatMap(x => (x.items || []).filter(isCombo).map(i => i.id))
  const [[range], [ctx, rates, settings]] = await Promise.all([
    tx`SELECT (current_date - ${s.mix_days}::int)::text AS from, (current_date - 1)::text AS to`,
    Promise.all([loadDishCosting(tx, tenantId, scope.venue_id, { menus: [] }), loadTaxRates(tx, tenantId), loadCostingSettings(tx, tenantId)]),
  ])
  const [sold, picks] = await Promise.all([
    dishIds.length ? tx`
      SELECT d.dish_id, sum(d.qty)::float8 AS qty FROM dish_cost_days d
       WHERE d.tenant_id = ${tenantId} AND d.day BETWEEN ${range.from}::date AND ${range.to}::date
         AND d.dish_id = ANY(${dishIds}::uuid[]) AND d.left_out IS NULL
         ${scope.venue_id ? tx`AND d.venue_id = ${scope.venue_id}` : tx``}
         ${scope.revenue_stream_id ? tx`AND d.revenue_stream_id = ${scope.revenue_stream_id}` : tx``}
         ${scope.order_type_id ? tx`AND d.order_type_id = ${scope.order_type_id}` : tx``}
       GROUP BY d.dish_id` : [],
    dealIds.length ? loadPickMix(tx, tenantId, dealIds, { from: range.from, to: range.to }) : [],
  ])
  ctx.pickMix = pickMix(picks)
  const units = Object.fromEntries(sold.map(r => [r.dish_id, r.qty]))
  const figures = scenarioFigures(menu, scope, ctx, { rates, settings, changes: s.changes || [], units })
  const n = names || await menuNames(tx, tenantId, s.menu_id)
  return {
    figures: sales ? figures : withoutSales(figures),
    mix: { from: range.from, to: range.to, days: s.mix_days },
    menu: { id: menu.id, name: menu.name, venue_id: menu.venue_id ?? null, version: 'draft' },
    scope, where: scopeText(scope, ctx.names),
    words: (s.changes || []).map(c => changeWords(c, n)),
    settings,
  }
}

async function oneScenario(tx, tenantId, id) {
  const [s] = await tx`SELECT ${tx.unsafe(COLS)} FROM cost_scenarios WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!s) throw httpError(404, 'Scenario not found')
  return s
}

const asHttp = err => (err instanceof ToolError ? httpError(err.status || 422, err.message) : err)

/** Where a menu is sold, in words: its venue (or every venue) and the revenue streams that sell it. */
async function soldAt(tx, tenantId, menu) {
  const [venue] = menu.venue_id ? await tx`SELECT name FROM venues WHERE id = ${menu.venue_id} AND tenant_id = ${tenantId}` : [null]
  const streams = await tx`
    SELECT r.name, v.name AS venue FROM pos_revenue_streams r JOIN venues v ON v.id = r.venue_id AND v.tenant_id = r.tenant_id
     WHERE r.tenant_id = ${tenantId} AND ${menu.id} = ANY(r.menu_ids) AND r.is_active ORDER BY v.name, r.sort_order, r.name`
  return { venue: venue?.name ?? null, streams: streams.map(r => r.name + ' (' + r.venue + ')') }
}

export default async function costScenarioRoutes(app) {
  app.addHook('preHandler', requireAuth)

  const salesFor = async req => permissionAtLeast((await permissionLevels(req, ['pos_reports'])).pos_reports, 'view')

  app.get('/', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const rows = await tx`
      SELECT s.id, s.name, s.menu_id, m.name AS menu, s.venue_id, v.name AS venue, s.revenue_stream_id, r.name AS stream,
             s.order_type_id, o.name AS order_type, s.mix_days, jsonb_array_length(s.changes) AS changes,
             s.updated_by, s.updated_at, s.pushed_at, s.pushed_by
        FROM cost_scenarios s
        JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id
        LEFT JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
        LEFT JOIN pos_revenue_streams r ON r.id = s.revenue_stream_id AND r.tenant_id = s.tenant_id
        LEFT JOIN order_types o ON o.id = s.order_type_id AND o.tenant_id = s.tenant_id
       WHERE s.tenant_id = ${req.tenantId}
       ORDER BY s.updated_at DESC, s.name`
    return { scenarios: rows }
  }))

  app.post('/preview', { preHandler: canView }, async req => {
    const b = PreviewBody.parse(req.body || {})
    const sales = await salesFor(req)
    return withTenant(req.tenantId, async tx => {
      const { scopes, names, changes } = await checkBody(tx, req.tenantId, b)
      return { ...(await scenarioView(tx, req.tenantId, { ...b, changes }, { sales, scopes, names })), sees_sales: sales }
    })
  })

  app.get('/:id', { preHandler: canView }, async req => {
    const id = uuid.parse(req.params.id)
    const sales = await salesFor(req)
    return withTenant(req.tenantId, async tx => {
      const s = await oneScenario(tx, req.tenantId, id)
      return { scenario: s, ...(await scenarioView(tx, req.tenantId, s, { sales })), sees_sales: sales }
    })
  })

  // The reply is sent after withTenant() has committed: a reply sent inside
  // the transaction reaches the client before COMMIT, and its next request
  // (open or save the new scenario) can miss the row and answer 404.
  app.post('/', { preHandler: canManage }, async (req, reply) => {
    const b = ScenarioBody.parse(req.body || {})
    const s = await withTenant(req.tenantId, async tx => {
      const { changes } = await checkBody(tx, req.tenantId, b)
      const [row] = await tx`
        INSERT INTO cost_scenarios (tenant_id, name, menu_id, venue_id, revenue_stream_id, order_type_id, mix_days, changes, notes, created_by, updated_by)
        VALUES (${req.tenantId}, ${b.name}, ${b.menu_id}, ${b.venue_id}, ${b.revenue_stream_id}, ${b.order_type_id}, ${b.mix_days},
                ${tx.json(changes)}, ${b.notes}, ${who(req)}, ${who(req)})
        RETURNING ${tx.unsafe(COLS)}`
      return row
    })
    return reply.code(201).send(s)
  })

  app.put('/:id', { preHandler: canManage }, async req => {
    const id = uuid.parse(req.params.id)
    const b = ScenarioBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      await oneScenario(tx, req.tenantId, id)
      const { changes } = await checkBody(tx, req.tenantId, b)
      const [s] = await tx`
        UPDATE cost_scenarios SET name = ${b.name}, menu_id = ${b.menu_id}, venue_id = ${b.venue_id}, revenue_stream_id = ${b.revenue_stream_id},
               order_type_id = ${b.order_type_id}, mix_days = ${b.mix_days}, changes = ${tx.json(changes)}, notes = ${b.notes},
               updated_by = ${who(req)}, updated_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId}
        RETURNING ${tx.unsafe(COLS)}`
      return s
    })
  })

  app.post('/:id/copy', { preHandler: canManage }, async (req, reply) => {
    const id = uuid.parse(req.params.id)
    const copy = await withTenant(req.tenantId, async tx => {
      const s = await oneScenario(tx, req.tenantId, id)
      const [row] = await tx`
        INSERT INTO cost_scenarios (tenant_id, name, menu_id, venue_id, revenue_stream_id, order_type_id, mix_days, changes, notes, created_by, updated_by)
        VALUES (${req.tenantId}, ${(s.name + ' (copy)').slice(0, 120)}, ${s.menu_id}, ${s.venue_id}, ${s.revenue_stream_id}, ${s.order_type_id},
                ${s.mix_days}, ${tx.json(s.changes)}, ${s.notes}, ${who(req)}, ${who(req)})
        RETURNING ${tx.unsafe(COLS)}`
      return row
    })
    return reply.code(201).send(copy)
  })

  app.delete('/:id', { preHandler: canManage }, async req => {
    const id = uuid.parse(req.params.id)
    return withTenant(req.tenantId, async tx => {
      const [gone] = await tx`DELETE FROM cost_scenarios WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING id`
      if (!gone) throw httpError(404, 'Scenario not found')
      return { deleted: true }
    })
  })

  // ── Push prices (into the menu's draft only) ────────────────

  const staffCtx = req => makeContext({
    app, channel: 'staff_chat', tenantId: req.tenantId, log: req.log,
    auth: staffAuthOf(req), principal: staffPrincipalOf(req), actor: who(req),
  })

  /** The saved scenario's price changes on the menu's draft as it is now, through the menus area's own route. */
  async function pushPlan(req, id) {
    const s = await withTenant(req.tenantId, tx => oneScenario(tx, req.tenantId, id))
    let full
    try { full = await callApi(staffCtx(req), 'GET', '/api/menus/' + s.menu_id) } catch (err) { throw asHttp(err) }
    const plan = pushPrices(full, s.changes || [])
    return { s, full, plan }
  }

  app.post('/:id/push/preview', { preHandler: canPush }, async req => {
    const id = uuid.parse(req.params.id)
    const { s, full, plan } = await pushPlan(req, id)
    return withTenant(req.tenantId, async tx => {
      const [where, status] = await Promise.all([soldAt(tx, req.tenantId, full), publishStatus(tx, req.tenantId, s.menu_id)])
      return {
        scenario: { id: s.id, name: s.name }, menu: { id: full.id, name: full.name, venue_id: full.venue_id ?? null },
        prices: plan.prices, skipped: plan.skipped, stamp: priceStamp(plan.prices),
        sold_at: where,
        // What the draft already holds that isn't live: publishing later puts that live too.
        unpublished: status.in_sync ? 0 : status.changes.length, live: !!status.live,
        publish_page: '/menus?edit=' + full.id,
      }
    })
  })

  app.post('/:id/push', { preHandler: canPush }, async req => {
    const id = uuid.parse(req.params.id)
    const b = PushBody.parse(req.body || {})
    const { s, plan } = await pushPlan(req, id)
    if (!plan.prices.length) throw httpError(422, 'No price changes: this scenario changes no price on the menu\'s draft', { code: 'nothing' })
    if (priceStamp(plan.prices) !== b.stamp) {
      throw httpError(409, 'The menu\'s draft changed since the preview: look at the prices again before pushing them', { code: 'changed' })
    }
    // The whole tree goes back with every field (rule 13); the menus route checks Menus manage again, as the person.
    try {
      await callApi(staffCtx(req), 'PATCH', '/api/menus/' + s.menu_id, { body: menuSaveBody(plan.full) })
    } catch (err) { throw asHttp(err) }
    await withTenant(req.tenantId, tx => tx`
      UPDATE cost_scenarios SET pushed_at = now(), pushed_by = ${who(req)} WHERE id = ${id} AND tenant_id = ${req.tenantId}`)
    return {
      pushed: plan.prices.length, prices: plan.prices, menu: { id: s.menu_id },
      message: 'The new prices are in the menu\'s draft. Nothing is live until the menu is published.',
      publish_page: '/menus?edit=' + s.menu_id,
    }
  })
}
