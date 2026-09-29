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

const BundlePart = z.object({
  label:       z.string().trim().min(1).max(40),
  item_ids:    z.array(uuid).max(500).default([]),
  section_ids: z.array(uuid).max(200).default([]),
  qty:         z.number().int().min(1).max(10).default(1),
})
const Tier = z.object({
  min_pence: z.number().int().min(0).max(10000000),
  value:     z.number().int().min(1).max(1000000),
})

// A theme role name or a #hex colour; empty = default.
const BoxColour = z.string().trim().max(20)
  .regex(/^(#[0-9a-fA-F]{6}|primary|accent|background|surface|text|muted|border)?$/, 'Pick a colour from the theme')
  .nullable().optional()

const PromoBody = z.object({
  name:               z.string().trim().min(1).max(120),
  description:        z.string().trim().max(500).nullable().optional(),
  badge_text:         z.string().trim().max(30).nullable().optional(),
  is_active:          z.boolean().default(true),
  kind:               z.enum(['basket', 'item', 'bogo', 'free_item', 'bundle', 'tiered']),
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
  bundle:             z.array(BundlePart).max(8).default([]),
  bundle_price_pence: z.number().int().min(0).max(10000000).nullable().default(null),
  tiers:              z.array(Tier).max(10).default([]),
  // Promo box on the ordering page (migration 134)
  show_in_box:        z.boolean().default(false),
  box_bg:             BoxColour,
  box_text:           BoxColour,
  box_image_url:      z.string().trim().max(2000).regex(/^(https?:\/\/|\/)/, 'Use an image from the media library').nullable().optional(),
})

function clean(b) {
  const p = { ...b }
  p.description = p.description || null
  p.badge_text = p.badge_text || null
  p.code = p.apply_mode === 'code' ? (p.code || '').trim() : null
  // A code promotion never shows in the promo box: its code must not reach the page.
  if (p.apply_mode === 'code') p.show_in_box = false
  p.box_bg = p.box_bg || null
  p.box_text = p.box_text || null
  p.box_image_url = p.box_image_url || null
  if (p.apply_mode === 'code' && p.code.length < 3) throw httpError(422, 'Enter a promo code of at least 3 characters')
  if (p.kind !== 'bundle') { p.bundle = []; p.bundle_price_pence = null }
  if (p.kind !== 'tiered') p.tiers = []
  if (p.kind === 'bogo' || p.kind === 'free_item' || p.kind === 'bundle') {
    p.discount_type = 'percent'
    p.discount_value = 0
  } else if (p.kind === 'tiered') {
    p.discount_value = 0
    p.tiers = [...p.tiers].sort((a, b) => a.min_pence - b.min_pence)
    if (!p.tiers.length) throw httpError(422, 'Add at least one spend level')
    if (new Set(p.tiers.map(t => t.min_pence)).size !== p.tiers.length) throw httpError(422, 'Each spend level needs a different amount')
    if (p.discount_type === 'percent' && p.tiers.some(t => t.value > 100)) throw httpError(422, 'A percentage discount can be at most 100%')
  } else {
    if (!p.discount_value) throw httpError(422, 'Enter how much the promotion takes off')
    if (p.discount_type === 'percent' && p.discount_value > 100) throw httpError(422, 'A percentage discount can be at most 100%')
  }
  if (p.kind === 'bundle') {
    if (!p.bundle.length) throw httpError(422, 'Add the parts of the meal deal')
    if (p.bundle_price_pence == null) throw httpError(422, 'Enter the meal deal price')
    p.item_ids = []; p.section_ids = []
  }
  if (p.kind === 'basket' || p.kind === 'tiered') { p.item_ids = []; p.section_ids = [] }
  const problem = scheduleProblem(['p'], { p: p.schedule }, { p: 'This promotion' }, null)
  if (problem) throw httpError(422, problem)
  return p
}

async function codeTaken(tx, tenantId, code, exceptId = null) {
  if (!code) return false
  const [row] = await tx`
    SELECT id FROM promotions WHERE tenant_id = ${tenantId} AND lower(code) = lower(${code}) AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid) LIMIT 1
  `
  return !!row
}

const COLS = ['name', 'description', 'badge_text', 'is_active', 'kind', 'discount_type', 'discount_value',
  'item_ids', 'section_ids', 'buy_qty', 'get_qty', 'get_percent', 'min_subtotal_pence', 'required_item_ids',
  'max_discount_pence', 'apply_mode', 'code', 'max_uses', 'schedule', 'venue_ids', 'exclusive',
  'bundle', 'bundle_price_pence', 'tiers', 'show_in_box', 'box_bg', 'box_text', 'box_image_url']
const JSON_COLS = new Set(['schedule', 'bundle', 'tiers'])

function rowOf(tx, p) {
  const r = {}
  for (const c of COLS) r[c] = JSON_COLS.has(c) ? tx.json(p[c] ?? (c === 'schedule' ? {} : [])) : p[c]
  return r
}

export default async function promotionsRoutes(app) {
  app.addHook('preHandler', requireAuth)
  const view = requirePermission('promotions', 'view')
  const manage = requirePermission('promotions', 'manage')

  app.get('/', { preHandler: view }, async (req) =>
    withTenant(req.tenantId, tx => listPromotions(tx, req.tenantId)))

  app.get('/catalog', { preHandler: view }, async (req) => withTenant(req.tenantId, async tx => {
    const [menus, sections, items, venues] = await Promise.all([
      tx`SELECT id, name FROM menus WHERE tenant_id = ${req.tenantId} ORDER BY name`,
      tx`SELECT id, menu_id, title FROM menu_sections WHERE tenant_id = ${req.tenantId} ORDER BY menu_id, sort_order`,
      tx`SELECT i.id, i.section_id, i.name FROM menu_items i WHERE i.tenant_id = ${req.tenantId} ORDER BY i.section_id, i.sort_order`,
      tx`SELECT id, name FROM venues WHERE tenant_id = ${req.tenantId} AND is_active = true ORDER BY name`,
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
      if (await codeTaken(tx, req.tenantId, p.code)) throw httpError(409, 'Another promotion already uses that code')
      const [{ next }] = await tx`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM promotions WHERE tenant_id = ${req.tenantId}`
      const [r] = await tx`INSERT INTO promotions ${tx({ ...rowOf(tx, p), tenant_id: req.tenantId, sort_order: next })} RETURNING id`
      return r
    })
    return reply.code(201).send(row)
  })

  app.put('/:id', { preHandler: manage }, async (req) => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Promotion not found')
    const p = clean(PromoBody.parse(req.body || {}))
    return withTenant(req.tenantId, async tx => {
      if (await codeTaken(tx, req.tenantId, p.code, req.params.id)) throw httpError(409, 'Another promotion already uses that code')
      const [r] = await tx`UPDATE promotions SET ${tx(rowOf(tx, p))} WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id`
      if (!r) throw httpError(404, 'Promotion not found')
      return r
    })
  })

  app.patch('/:id/active', { preHandler: manage }, async (req) => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Promotion not found')
    const { is_active } = z.object({ is_active: z.boolean() }).parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const [r] = await tx`UPDATE promotions SET is_active = ${is_active} WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id, is_active`
      if (!r) throw httpError(404, 'Promotion not found')
      return r
    })
  })

  app.patch('/reorder', { preHandler: manage }, async (req) => {
    const { ids } = z.object({ ids: z.array(uuid).max(500) }).parse(req.body || {})
    await withTenant(req.tenantId, async tx => {
      for (const [i, id] of ids.entries()) await tx`UPDATE promotions SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
    })
    return { ok: true }
  })

  app.delete('/:id', { preHandler: manage }, async (req) => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Promotion not found')
    await withTenant(req.tenantId, tx => tx`DELETE FROM promotions WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`)
    return { ok: true }
  })
}
