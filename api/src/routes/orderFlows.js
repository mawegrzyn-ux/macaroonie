// src/routes/orderFlows.js
//
// Order flows, /api/pos (migrations 235, 236; shared/pos/orderFlows.js,
// services/orderFlowSvc.js): rules that act on an order by themselves,
// company wide (a prompt offering a dish, or dishes and charges put on by
// themselves), each on tills, kiosks and online ordering, at every location
// or the ones it names, on every till / kiosk there or the ones it names.
// Store tech view to read, manage to change.
//
//   GET    /order-flows            the company's flows, in their order, with their words
//   GET    /order-flows/catalog    what a flow can name: dishes by menu and section
//                                  (needs_choices: one with options to pick; image_url
//                                  for the prompt's look in the designer), channels
//                                  (revenue streams by name), order types, charges,
//                                  locations, tills, kiosks, and the themes a prompt's
//                                  look picks colours from (themes.brand: tills and
//                                  online ordering; themes.kiosk: each kiosk design,
//                                  most used first)
//   POST   /order-flows            { name, kind, copy_from? } a new flow, switched off
//   GET    /order-flows/:id        one flow, its problems and warnings
//   PUT    /order-flows/:id        the whole flow (422 code 'flow' with the problems
//                                  when it is switched on and can't run)
//   PATCH  /order-flows/:id        { on } switched on or off
//   PUT    /order-flows/order      { ids } the list's order (the order flows act in)
//   DELETE /order-flows/:id        checks keep what it put on
//
// A change tells every till and kiosk of the company to download its config
// again (online ordering reads the flows with each order); the sequencer and
// the venue hub read the flows with the rest of the venue's settings (they
// judge a flow's charges by them).

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { tillsMayNeedConfig } from '../services/posNotify.js'
import { loadCharges } from '../services/posSvc.js'
import { brandColours } from '../services/themeColours.js'
import { normaliseDesign } from '../../../shared/kiosk.js'
import { flowOfRow, ownOrderFlow, flowNames } from '../services/orderFlowSvc.js'
import {
  FLOWS_MAX, FLOW_NAME_MAX, newOrderFlow, normaliseOrderFlow, flowProblems, flowWarnings,
  flowSummary, flowWhereText, channelKey,
} from '../../../shared/pos/orderFlows.js'

const canView = requirePermission('pos_setup', 'view')
const canManage = requirePermission('pos_setup', 'manage')
const UUID = z.string().uuid()
const Name = z.string().trim().min(1).max(FLOW_NAME_MAX)
const FlowBody = z.object({ name: Name, on: z.boolean().optional() }).passthrough()

/** What goes in pos_order_flows.flow: everything but the columns. */
const stored = f => ({
  kind: f.kind, trigger: f.trigger, apps: f.apps,
  venue_ids: f.venue_ids, till_ids: f.till_ids, kiosk_ids: f.kiosk_ids,
  match: f.match, ask: f.ask, adds: f.adds,
})

/** The company's dishes that have options to pick (or are meal deals): a Set of ids. */
async function dishesWithChoices(tx, tenantId) {
  const rows = await tx`
    SELECT i.id FROM menu_items i
     WHERE i.tenant_id = ${tenantId}
       AND (i.kind = 'combo'
            OR EXISTS (SELECT 1 FROM menu_item_variant_groups g WHERE g.item_id = i.id AND g.tenant_id = i.tenant_id)
            OR EXISTS (SELECT 1 FROM menu_item_variants v WHERE v.item_id = i.id AND v.tenant_id = i.tenant_id))`
  return new Set(rows.map(r => r.id))
}

/**
 * Each kiosk design's colours as a prompt's theme (the designer's swatches
 * and preview) with how many kiosks use it, most used first; the standard
 * design when there are none. A kiosk with no design of its own (or one
 * since deleted) uses the first design (kioskSvc.js loadDesign()).
 */
function kioskThemes(designs, kiosks) {
  const used = {}
  for (const k of kiosks) {
    const id = designs.some(d => d.id === k.design_id) ? k.design_id : designs[0]?.id
    if (id) used[id] = (used[id] || 0) + 1
  }
  const list = (designs.length ? designs : [null]).map(d => {
    const c = normaliseDesign(d?.settings).brand.colors
    return {
      id: d?.id || null, name: d?.name || 'Standard kiosk design', used_by: d ? used[d.id] || 0 : kiosks.length,
      colours: { primary: c.primary, accent: c.accent, background: c.background, surface: c.surface, text: c.text, muted: c.muted },
    }
  })
  return list.sort((a, b) => b.used_by - a.used_by)
}

async function ownFlowRow(tx, tenantId, id) {
  const [r] = await tx`SELECT * FROM pos_order_flows WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!r) throw httpError(404, 'Order flow not found')
  return r
}

/**
 * What the company has, for the warnings: channels by name, where each till
 * and kiosk is, the dishes with options to pick, and the charges (their
 * guest counts).
 */
async function places(tx, tenantId) {
  const [streams, devices, choices, charges] = await Promise.all([
    tx`SELECT venue_id, name FROM pos_revenue_streams WHERE tenant_id = ${tenantId} AND is_active`,
    tx`SELECT id, venue_id, kind FROM pos_devices WHERE tenant_id = ${tenantId} AND kind IN ('terminal', 'kiosk') AND revoked_at IS NULL`,
    dishesWithChoices(tx, tenantId),
    tx`SELECT id, name, min_covers FROM pos_charges WHERE tenant_id = ${tenantId}`,
  ])
  const channels = {}
  for (const s of streams) (channels[channelKey(s.name)] ||= []).push(s.venue_id)
  const at = kind => Object.fromEntries(devices.filter(d => d.kind === kind).map(d => [d.id, d.venue_id]))
  return {
    channels, tills: at('terminal'), kiosks: at('kiosk'), choices,
    charges: Object.fromEntries(charges.map(c => [c.id, { name: c.name, min_covers: c.min_covers }])),
  }
}

function view(r, names, where) {
  const f = flowOfRow(r)
  return {
    ...f, updated_at: r.updated_at,
    problems: flowProblems(f), warnings: flowWarnings(f, { ...where, names }),
    summary: flowSummary(f, names), where: flowWhereText(f, names),
  }
}

export default async function orderFlowRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/order-flows', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const [rows, names, where] = await Promise.all([
      tx`SELECT * FROM pos_order_flows WHERE tenant_id = ${req.tenantId} ORDER BY sort_order, lower(name), created_at`,
      flowNames(tx, req.tenantId),
      places(tx, req.tenantId),
    ])
    return { flows: rows.map(r => view(r, names, where)), max: FLOWS_MAX }
  }))

  // Everything a flow can name, for the designer's pickers.
  app.get('/order-flows/catalog', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const [menus, sections, items, streams, types, charges, venues, devices, choices, designs, brand] = await Promise.all([
      tx`SELECT id, name FROM menus WHERE tenant_id = ${req.tenantId} ORDER BY name`,
      tx`SELECT id, menu_id, title FROM menu_sections WHERE tenant_id = ${req.tenantId} ORDER BY menu_id, sort_order`,
      tx`SELECT id, section_id, name, price_pence, kind, image_url FROM menu_items WHERE tenant_id = ${req.tenantId} ORDER BY section_id, sort_order`,
      tx`SELECT s.name, s.venue_id, v.name AS venue_name FROM pos_revenue_streams s
           JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
          WHERE s.tenant_id = ${req.tenantId} AND s.is_active ORDER BY v.name, s.sort_order, s.name`,
      tx`SELECT id, name, is_active FROM order_types WHERE tenant_id = ${req.tenantId} ORDER BY is_active DESC, sort_order, name`,
      loadCharges(tx, req.tenantId),
      tx`SELECT id, name FROM venues WHERE tenant_id = ${req.tenantId} ORDER BY name`,
      tx`SELECT id, name, venue_id, short_code, kind, settings->>'design_id' AS design_id FROM pos_devices
          WHERE tenant_id = ${req.tenantId} AND kind IN ('terminal', 'kiosk') AND revoked_at IS NULL ORDER BY name`,
      dishesWithChoices(tx, req.tenantId),
      tx`SELECT id, name, settings FROM kiosk_designs WHERE tenant_id = ${req.tenantId} ORDER BY created_at`,
      brandColours(tx, req.tenantId),
    ])
    const bySection = {}
    for (const i of items) {
      (bySection[i.section_id] ||= []).push({ id: i.id, name: i.name, price_pence: i.price_pence, kind: i.kind, image_url: i.image_url || null, needs_choices: choices.has(i.id) })
    }
    const byMenu = {}
    for (const sct of sections) (byMenu[sct.menu_id] ||= []).push({ id: sct.id, title: sct.title, items: bySection[sct.id] || [] })
    // Channels by name: each location has its own streams, a flow names them by name.
    const channels = new Map()
    for (const s of streams) {
      const k = channelKey(s.name)
      if (!channels.has(k)) channels.set(k, { name: s.name, venues: [] })
      const c = channels.get(k)
      if (!c.venues.some(v => v.id === s.venue_id)) c.venues.push({ id: s.venue_id, name: s.venue_name })
    }
    return {
      menus: menus.map(m => ({ id: m.id, name: m.name, sections: byMenu[m.id] || [] })),
      channels: [...channels.values()],
      order_types: types,
      charges: charges.map(c => ({ id: c.id, name: c.name, kind: c.kind, value: c.value, optional: c.optional, min_covers: c.min_covers || 0 })),
      venues,
      tills: devices.filter(d => d.kind === 'terminal').map(({ kind, design_id, ...d }) => d),
      kiosks: devices.filter(d => d.kind === 'kiosk').map(({ kind, design_id, ...d }) => d),
      themes: { brand, kiosk: kioskThemes(designs, devices.filter(d => d.kind === 'kiosk')) },
    }
  }))

  app.post('/order-flows', { preHandler: canManage }, async (req, reply) => {
    const b = z.object({
      name: Name,
      kind: z.enum(['ask', 'add']).default('ask'),
      copy_from: UUID.nullable().optional(),
    }).parse(req.body || {})
    const out = await withTenant(req.tenantId, async tx => {
      const [{ n, count }] = await tx`
        SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n, count(*)::int AS count
          FROM pos_order_flows WHERE tenant_id = ${req.tenantId}`
      if (count >= FLOWS_MAX) throw httpError(422, 'A company can have up to ' + FLOWS_MAX + ' order flows')
      // A new flow, or a copy, starts switched off: it runs once switched on.
      const from = b.copy_from ? flowOfRow(await ownFlowRow(tx, req.tenantId, b.copy_from)) : null
      const f = normaliseOrderFlow({ ...(from || newOrderFlow(randomUUID(), b.kind)), id: randomUUID(), name: b.name, on: false })
      const [r] = await tx`
        INSERT INTO pos_order_flows (id, tenant_id, name, is_active, sort_order, flow)
        VALUES (${f.id}, ${req.tenantId}, ${f.name}, false, ${n}, ${tx.json(stored(f))}) RETURNING *`
      return view(r, await flowNames(tx, req.tenantId), await places(tx, req.tenantId))
    })
    reply.code(201)
    return out
  })

  app.get('/order-flows/:id', { preHandler: canView }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => view(await ownFlowRow(tx, req.tenantId, id), await flowNames(tx, req.tenantId), await places(tx, req.tenantId)))
  })

  app.put('/order-flows/order', { preHandler: canManage }, async req => {
    const { ids } = z.object({ ids: z.array(UUID).max(FLOWS_MAX * 2) }).parse(req.body || {})
    await withTenant(req.tenantId, async tx => {
      for (const [i, id] of [...new Set(ids)].entries()) {
        await tx`UPDATE pos_order_flows SET sort_order = ${i}, updated_at = now() WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      }
    })
    tillsMayNeedConfig(req.tenantId, req.log)
    return { ok: true }
  })

  // The whole flow in one save; only the company's own ids are kept. A flow
  // switched on must be able to run (no problems); one switched off may be
  // saved half done.
  app.put('/order-flows/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const b = FlowBody.parse(req.body || {})
    const out = await withTenant(req.tenantId, async tx => {
      const row = await ownFlowRow(tx, req.tenantId, id)
      const on = b.on ?? row.is_active
      const f = await ownOrderFlow(tx, req.tenantId, { ...b, id, on })
      const problems = flowProblems(f)
      if (on && problems.length) throw httpError(422, problems[0].message, { code: 'flow', problems })
      const [r] = await tx`
        UPDATE pos_order_flows SET name = ${f.name}, is_active = ${on}, flow = ${tx.json(stored(f))}, updated_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return view(r, await flowNames(tx, req.tenantId), await places(tx, req.tenantId))
    })
    tillsMayNeedConfig(req.tenantId, req.log)
    return out
  })

  app.patch('/order-flows/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const { on } = z.object({ on: z.boolean() }).parse(req.body || {})
    const out = await withTenant(req.tenantId, async tx => {
      const row = await ownFlowRow(tx, req.tenantId, id)
      const problems = flowProblems(flowOfRow(row))
      if (on && problems.length) throw httpError(422, problems[0].message, { code: 'flow', problems })
      const [r] = await tx`
        UPDATE pos_order_flows SET is_active = ${on}, updated_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return view(r, await flowNames(tx, req.tenantId), await places(tx, req.tenantId))
    })
    tillsMayNeedConfig(req.tenantId, req.log)
    return out
  })

  app.delete('/order-flows/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    await withTenant(req.tenantId, async tx => {
      await ownFlowRow(tx, req.tenantId, id)
      await tx`DELETE FROM pos_order_flows WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    tillsMayNeedConfig(req.tenantId, req.log)
    return { ok: true }
  })
}
