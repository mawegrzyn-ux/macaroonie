// src/routes/promotions.js
//
// Promotions for online ordering (migration 131), mounted at /api/promotions.
// The discount rules are shared/promotions.js; the ordering API applies
// them (services/orderSvc.js createOrder, routes/orderApi.js).
//
//   GET    /                 every promotion, with uses and total discount so far
//   GET    /catalog          dishes, sections and venues for the editor's pickers
//   POST   /                 create
//   PUT    /:id              replace (the editor sends the whole promotion)
//   PATCH  /:id/active       { is_active } switch on / off from the list
//   PATCH  /reorder          { ids } list order = priority
//   DELETE /:id              delete (orders keep their copy of the name)
//
// Module 'promotions' (web_ordering group): view to list, manage to change.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { listPromotions } from '../services/promoSvc.js'
import { MenuSchedule } from './orders.js'
import { scheduleProblem } from '../../../shared/menuSchedule.js'

const uuid = z.string().uuid()

const PromoBody = z.object({
  name:               z.string().trim().min(1).max(120),
  description:        z.string().trim().max(500).nullable().optional(),
  badge_text:         z.string().trim().max(30).nullable().optional(),
  is_active:          z.boolean().default(true),
  kind:               z.enum(['basket', 'item', 'bogo']),
  discount_type:      z.enum(['percent', 'amount']).default('percent'),
  discount_value:     z.number().int().min(0).max(1000000).default(0),
  item_ids:           z.array(uuid).max(500).default([]),
  section_ids:        z.array(uuid).max(200).default([]),
  buy_qty:            z.number().int().min(1).max(20).default(1),
  get_qty:            z.number().int().min(1).max(20).default(1),
  get_percent:        z.number().int().min(1).max(100).default(100),
  min_subtotal_pence: z.number().int().min(0).max(10000000).default(0),
  required_item_ids:  z.array(uuid).max(200).default([]),
  max_discount_pence: z.number().int().min(1).max(10000000).nullable().default(null),
  apply_mode:         z.enum(['auto', 'manual', 'code']).default('auto'),
  code:               z.string().trim().max(40).regex(/^[A-Za-z0-9_-]*$/, 'Codes can use letters, numbers, - and _ only').nullable().optional(),
  max_uses:           z.number().int().min(1).max(1000000).nullable().default(null),
  schedule:           MenuSchedule.default({ times: [] }),
  venue_ids:          z.array(uuid).max(200).default([]),
  exclusive:          z.boolean().default(false),
})

function clean(b) {
  const p = { ...b }
  p.description = p.description || null
  p.badge_text = p.badge_text || null
  p.code = p.apply_mode === 'code' ? (p.code || '').trim() : null
  if (p.apply_mode === 'code' && p.code.length < 3) throw httpError(422, 'Enter a promo code of at least 3 characters')
  if (p.kind === 'bogo') {
    p.discount_type = 'percent'
    p.discount_value = 0
  } else {
    if (!p.discount_value) throw httpError(422, 'Enter how much the promotion takes off')
    if (p.discount_type === 'percent' && p.discount_value > 100) throw httpError(422, 'A percentage discount can be at most 100%')
  }
  if (p.kind === 'basket') { p.item_ids = []; p.section_ids = [] }
  const problem = scheduleProblem(['p'], { p: p.schedule }, { p: 'This promotion' }, null)
  if (problem) throw httpError(422, problem)
  return p
}

async function codeTaken(tx, code, exceptId = null) {
  if (!code) return false
  const [row] = await tx`
    SELECT id FROM promotions WHERE lower(code) = lower(${code}) AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid) LIMIT 1
  `
  return !!row
}

const COLS = ['name', 'description', 'badge_text', 'is_active', 'kind', 'discount_type', 'discount_value',
  'item_ids', 'section_ids', 'buy_qty', 'get_qty', 'get_percent', 'min_subtotal_pence', 'required_item_ids',
  'max_discount_pence', 'apply_mode', 'code', 'max_uses', 'schedule', 'venue_ids', 'exclusive']

function rowOf(tx, p) {
  const r = {}
  for (const c of COLS) r[c] = c === 'schedule' ? tx.json(p.schedule || {}) : p[c]
  return r
}

export default async function promotionsRoutes(app) {
  app.addHook('preHandler', requireAuth)
  const view = requirePermission('promotions', 'view')
  const manage = requirePermission('promotions', 'manage')

  app.get('/', { preHandler: view }, async (req) =>
    withTenant(req.tenantId, tx => listPromotions(tx)))

  app.get('/catalog', { preHandler: view }, async (req) => withTenant(req.tenantId, async tx => {
    const [menus, sections, items, venues] = await Promise.all([
      tx`SELECT id, name FROM menus ORDER BY name`,
      tx`SELECT id, menu_id, title FROM menu_sections ORDER BY menu_id, sort_order`,
      tx`SELECT i.id, i.section_id, i.name FROM menu_items i ORDER BY i.section_id, i.sort_order`,
      tx`SELECT id, name FROM venues WHERE is_active = true ORDER BY name`,
    ])
    const bySection = {}
    for (const i of items) (bySection[i.section_id] ||= []).push({ id: i.id, name: i.name })
    const byMenu = {}
    for (const s of sections) (byMenu[s.menu_id] ||= []).push({ id: s.id, title: s.title, items: bySection[s.id] || [] })
    return { menus: menus.map(m => ({ id: m.id, name: m.name, sections: byMenu[m.id] || [] })), venues }
  }))

  app.post('/', { preHandler: manage }, async (req, reply) => {
    const p = clean(PromoBody.parse(req.body || {}))
    const row = await withTenant(req.tenantId, async tx => {
      if (await codeTaken(tx, p.code)) throw httpError(409, 'Another promotion already uses that code')
      const [{ next }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM promotions`
      const [r] = await tx`INSERT INTO promotions ${tx({ ...rowOf(tx, p), tenant_id: req.tenantId, sort_order: next })} RETURNING id`
      return r
    })
    return reply.code(201).send(row)
  })

  app.put('/:id', { preHandler: manage }, async (req) => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Promotion not found')
    const p = clean(PromoBody.parse(req.body || {}))
    return withTenant(req.tenantId, async tx => {
      if (await codeTaken(tx, p.code, req.params.id)) throw httpError(409, 'Another promotion already uses that code')
      const [r] = await tx`UPDATE promotions SET ${tx(rowOf(tx, p))} WHERE id = ${req.params.id} RETURNING id`
      if (!r) throw httpError(404, 'Promotion not found')
      return r
    })
  })

  app.patch('/:id/active', { preHandler: manage }, async (req) => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Promotion not found')
    const { is_active } = z.object({ is_active: z.boolean() }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const [r] = await tx`UPDATE promotions SET is_active = ${is_active} WHERE id = ${req.params.id} RETURNING id, is_active`
      if (!r) throw httpError(404, 'Promotion not found')
      return r
    })
  })

  app.patch('/reorder', { preHandler: manage }, async (req) => {
    const { ids } = z.object({ ids: z.array(uuid).max(500) }).parse(req.body || {})
    await withTenant(req.tenantId, async tx => {
      for (const [i, id] of ids.entries()) await tx`UPDATE promotions SET sort_order = ${i} WHERE id = ${id}`
    })
    return { ok: true }
  })

  app.delete('/:id', { preHandler: manage }, async (req) => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Promotion not found')
    await withTenant(req.tenantId, tx => tx`DELETE FROM promotions WHERE id = ${req.params.id}`)
    return { ok: true }
  })
}
