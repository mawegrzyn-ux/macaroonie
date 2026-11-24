// src/routes/itemMapping.js
//
// The Item mapping page (sales from other tills, phase 2,
// docs/SALES_IMPORT.md 4, migration 292). Mounted at
// /api/integrations/mapping.
//
//   GET    /:connectionId?venue_id=            the other till's catalogue (categories, items,
//                                              variants, modifiers and their options), each
//                                              with its state under the rules and its sales
//                                              in the last 30 days; the venues; the rules;
//                                              remap_pending while a re-map waits or runs
//   GET    /:connectionId/menu?venue_id=       our menus the venue sells (every menu without
//                                              a venue): dishes, combos, their option groups,
//                                              and the option group library
//   GET    /:connectionId/coverage?venue_id=   the share of the last 30 days' item sales
//                                              mapped, by venue, and the unmapped items
//   POST   /:connectionId/preview              { venue_id?, rules: [draft], remove: [rule ids] }:
//                                              what the last 30 days' lines would become
//                                              under the saved rules with these changes;
//                                              nothing written
//   POST   /:connectionId/rules                a rule
//   PUT    /:connectionId/rules/:ruleId        a rule changed (the whole rule)
//   DELETE /:connectionId/rules/:ruleId
//
// A saved or deleted rule re-maps the connection's stored lines from its
// effective_from in the background (itemMappingSvc.requestRemap()). Reads
// and Preview need Cash reconciliation view; rules need manage. Every id is
// checked as the tenant's (rule 4): the connection, the venue (linked to
// it), the other till's refs (in its catalogue), and the target dishes,
// combos, options and option group (ours; a venue's rule only a dish or
// combo on a menu that venue sells).

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import {
  mappingContext, requestRemap, queueRemap, previewMapping, coverage, venueMenus, RECENT_DAYS,
} from '../services/itemMappingSvc.js'
import { catalogState, ruleKey, RULE_KINDS, AXIS_KINDS, STATE_LABELS } from '../../../shared/itemMapping.js'

const UUID = z.string().uuid()
const canView   = [requirePermission('cash_recon', 'view')]
const canManage = [requirePermission('cash_recon', 'manage')]
const by = req => req.user?.email ?? req.user?.sub ?? null

const Ref = z.string().trim().min(1).max(200)
const RuleBody = z.object({
  kind:              z.enum(RULE_KINDS),
  venue_id:          UUID.nullable().optional(),
  item_ref:          Ref.nullable().optional(),
  variant_ref:       Ref.nullable().optional(),
  option_ref:        Ref.nullable().optional(),
  option_refs:       z.array(Ref).max(20).optional(),
  axis_kind:         z.enum(AXIS_KINDS).nullable().optional(),
  axis_name:         z.string().trim().min(1).max(100).nullable().optional(),
  axis_group_ref:    Ref.nullable().optional(),
  axis_values:       z.array(z.object({ from: z.string().trim().min(1).max(200), option_id: UUID.nullable().optional() })).max(100).optional(),
  target_item_id:    UUID.nullable().optional(),
  target_item_ids:   z.array(UUID).max(20).optional(),
  target_option_ids: z.array(UUID).max(20).optional(),
  target_combo_id:   UUID.nullable().optional(),
  target_group_id:   UUID.nullable().optional(),
  effective_from:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note:              z.string().trim().max(500).nullable().optional(),
})
const PreviewBody = z.object({
  venue_id: UUID.nullable().optional(),
  rules:    z.array(RuleBody.extend({ id: UUID.nullable().optional() })).max(50).default([]),
  remove:   z.array(UUID).max(50).default([]),
})
const VenueQuery = z.object({ venue_id: UUID.optional() })

async function ownConnection(tx, tenantId, id) {
  if (!UUID.safeParse(id).success) throw httpError(404, 'Connection not found')
  const [c] = await tx`SELECT id, system, name FROM pos_connections WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!c) throw httpError(404, 'Connection not found')
  return c
}

async function linkedVenues(tx, tenantId, connectionId) {
  return tx`
    SELECT l.venue_id, v.name AS venue_name, l.location_name
      FROM pos_connection_venues l JOIN venues v ON v.id = l.venue_id AND v.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} AND l.connection_id = ${connectionId} ORDER BY v.name`
}

async function ownLinkedVenue(tx, tenantId, connectionId, venueId) {
  if (!venueId) return null
  const [v] = await tx`
    SELECT l.venue_id FROM pos_connection_venues l JOIN venues v ON v.id = l.venue_id AND v.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId} AND l.connection_id = ${connectionId} AND l.venue_id = ${venueId}`
  if (!v) throw httpError(422, 'That venue isn\'t linked to this connection')
  return v.venue_id
}

const dedupe = a => [...new Set((a || []).filter(Boolean))]

/**
 * A rule body checked and made whole for storing: what each kind needs,
 * the other till's refs in this connection's catalogue, and every target
 * the tenant's own (a venue's rule: a dish or combo on a menu the venue
 * sells). Fills ext_sku / ext_name from the catalogue, effective_from (the
 * first stored day when not given) and match_key.
 */
export async function cleanRule(tx, tenantId, connectionId, body) {
  const b = RuleBody.parse(body)
  const r = {
    kind: b.kind, venue_id: b.venue_id || null,
    item_ref: b.item_ref || null, variant_ref: b.variant_ref || null, option_ref: b.option_ref || null,
    option_refs: dedupe(b.option_refs), axis_kind: null, axis_name: null, axis_group_ref: null, axis_values: [],
    target_item_id: null, target_item_ids: [], target_option_ids: [], target_combo_id: null, target_group_id: null,
    effective_from: b.effective_from || null, note: b.note || null, ext_sku: null, ext_name: null,
  }
  const fail = m => { throw httpError(422, m) }
  r.venue_id = await ownLinkedVenue(tx, tenantId, connectionId, r.venue_id)

  // The other till's refs, from this connection's catalogue.
  const refs = dedupe([r.item_ref, r.variant_ref, r.option_ref, ...r.option_refs, b.axis_group_ref])
  const cat = refs.length ? await tx`
    SELECT kind, external_id, parent_ref, name, sku FROM ext_catalog
     WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND external_id = ANY(${refs}::text[])` : []
  const find = (kind, ref) => cat.find(c => c.kind === kind && c.external_id === ref)
  const variant = r.variant_ref ? find('variant', r.variant_ref) || fail('That variant isn\'t in this till\'s catalogue') : null
  if (variant) {
    if (r.item_ref && r.item_ref !== variant.parent_ref) fail('That variant belongs to another item')
    r.item_ref = variant.parent_ref
  }
  const item = r.item_ref ? find('item', r.item_ref) || (await tx`
    SELECT kind, external_id, name, sku FROM ext_catalog
     WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND kind = 'item' AND external_id = ${r.item_ref}`)[0]
    || fail('That item isn\'t in this till\'s catalogue') : null
  const option = r.option_ref ? find('modifier_option', r.option_ref) || fail('That modifier option isn\'t in this till\'s catalogue') : null
  for (const ref of r.option_refs) if (!find('modifier_option', ref)) fail('A modifier option isn\'t in this till\'s catalogue')

  if (b.kind === 'axis') {
    r.axis_kind = b.axis_kind || fail('Choose a variant option or a modifier group')
    if (r.axis_kind === 'variant') r.axis_name = b.axis_name || fail('Name the variant option (Size, Milk)')
    else r.axis_group_ref = (b.axis_group_ref && find('modifier', b.axis_group_ref)?.external_id) || fail('That modifier group isn\'t in this till\'s catalogue')
    r.option_ref = null; r.variant_ref = null; r.option_refs = []
    r.target_group_id = b.target_group_id || fail('Choose one of our option groups')
    r.axis_values = (b.axis_values || []).filter(v => v.option_id).map(v => ({ from: v.from, option_id: v.option_id }))
    if (!r.axis_values.length) fail('Match at least one value to one of our options')
    const [g] = await tx`SELECT id FROM menu_variant_groups WHERE id = ${r.target_group_id} AND tenant_id = ${tenantId}`
    if (!g) fail('That option group isn\'t one of yours')
    const ids = dedupe(r.axis_values.map(v => v.option_id))
    const found = await tx`SELECT id FROM menu_variant_options WHERE tenant_id = ${tenantId} AND group_id = ${r.target_group_id} AND id = ANY(${ids}::uuid[])`
    if (found.length !== ids.length) fail('Every value must go to an option of that group')
    if (r.axis_kind === 'modifier') {
      const opts = await tx`
        SELECT external_id FROM ext_catalog WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId}
           AND kind = 'modifier_option' AND parent_ref = ${r.axis_group_ref}`
      const mine = new Set(opts.map(o => o.external_id))
      if (r.axis_values.some(v => !mine.has(v.from))) fail('Every value must be an option of that modifier group')
    }
  } else {
    if (b.kind === 'combination') {
      if (!r.item_ref) fail('Choose the item')
      if (!r.option_refs.length) fail('Choose the modifiers that make the combination')
      r.option_ref = null
    } else {
      if (!r.item_ref && !r.option_ref) fail('Choose an item, a variant or a modifier option')
      if (r.option_ref) { r.item_ref = null; r.variant_ref = null }
      r.option_refs = []
    }
    if (b.kind === 'exact' || b.kind === 'combination') {
      r.target_item_id = b.target_item_id || null
      r.target_combo_id = b.target_combo_id || null
      r.target_option_ids = dedupe(b.target_option_ids)
      r.target_item_ids = dedupe(b.target_item_ids)
      if (r.option_ref) {
        if (r.target_combo_id || r.target_item_ids.length) fail('A modifier option becomes one of our options or one dish')
        if (!!r.target_item_id === !!r.target_option_ids.length || r.target_option_ids.length > 1) fail('Choose one of our options or one dish for it')
      } else {
        if (!!r.target_item_id === !!r.target_combo_id) fail('Choose a dish or a combo')
        if (r.target_combo_id && (r.target_option_ids.length || r.target_item_ids.length)) fail('A combo takes no options or extra dishes here')
      }
      const dishIds = dedupe([r.target_item_id, r.target_combo_id, ...r.target_item_ids])
      if (dishIds.length) {
        const found = await tx`
          SELECT mi.id, mi.kind FROM menu_items mi
            JOIN menu_sections s ON s.id = mi.section_id AND s.tenant_id = mi.tenant_id
            JOIN menus m ON m.id = s.menu_id AND m.tenant_id = mi.tenant_id
           WHERE mi.tenant_id = ${tenantId} AND mi.id = ANY(${dishIds}::uuid[])
             AND (${r.venue_id}::uuid IS NULL OR m.venue_id IS NULL OR m.venue_id = ${r.venue_id}::uuid)`
        const kindOf = new Map(found.map(f => [f.id, f.kind]))
        for (const id of dishIds) if (!kindOf.has(id)) fail(r.venue_id ? 'That dish isn\'t on a menu this venue sells' : 'That dish isn\'t one of yours')
        if (r.target_combo_id && kindOf.get(r.target_combo_id) !== 'combo') fail('That isn\'t a combo')
        for (const id of [r.target_item_id, ...r.target_item_ids].filter(Boolean)) if (kindOf.get(id) === 'combo') fail('Choose a combo as the combo, not as a dish')
      }
      if (r.target_option_ids.length) {
        const found = await tx`SELECT id FROM menu_variant_options WHERE tenant_id = ${tenantId} AND id = ANY(${r.target_option_ids}::uuid[])`
        if (found.length !== r.target_option_ids.length) fail('That option isn\'t one of yours')
      }
    }
  }

  // The fallback by SKU and name, from the catalogue as it is now.
  if (b.kind !== 'axis') {
    if (r.option_ref) r.ext_name = option.name
    else if (variant) { r.ext_sku = variant.sku || null; r.ext_name = item.name + (variant.name && variant.name !== 'Default' ? ' · ' + variant.name : '') }
    else if (item) r.ext_name = item.name
  }
  if (!r.effective_from) {
    const [f] = await tx`
      SELECT COALESCE(min(business_date), current_date)::text AS d FROM ext_checks
       WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId}
         AND (${r.venue_id}::uuid IS NULL OR venue_id = ${r.venue_id}::uuid)`
    r.effective_from = f.d
  }
  r.match_key = ruleKey(r)
  return r
}

async function saveRule(tx, tenantId, connectionId, r, user, id = null) {
  const [dupe] = await tx`
    SELECT id FROM ext_map_rules
     WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND venue_id IS NOT DISTINCT FROM ${r.venue_id}::uuid
       AND match_key = ${r.match_key} AND id IS DISTINCT FROM ${id}::uuid`
  if (dupe) throw httpError(409, 'There is already a rule for this at this scope: change that one instead', { rule_id: dupe.id })
  const cols = {
    venue_id: r.venue_id, kind: r.kind, item_ref: r.item_ref, variant_ref: r.variant_ref, option_ref: r.option_ref,
    option_refs: r.option_refs, axis_kind: r.axis_kind, axis_name: r.axis_name, axis_group_ref: r.axis_group_ref,
    axis_values: tx.json(r.axis_values), target_item_id: r.target_item_id, target_item_ids: r.target_item_ids,
    target_option_ids: r.target_option_ids, target_combo_id: r.target_combo_id, target_group_id: r.target_group_id,
    ext_sku: r.ext_sku, ext_name: r.ext_name, match_key: r.match_key, effective_from: r.effective_from, note: r.note,
  }
  if (id) {
    const [row] = await tx`
      UPDATE ext_map_rules SET ${tx(cols)}, updated_at = now()
       WHERE id = ${id} AND tenant_id = ${tenantId} AND connection_id = ${connectionId}
      RETURNING id, effective_from::text AS effective_from`
    return row
  }
  const [row] = await tx`
    INSERT INTO ext_map_rules ${tx({ ...cols, tenant_id: tenantId, connection_id: connectionId, created_by: user })}
    RETURNING id, effective_from::text AS effective_from`
  return row
}

async function ownRule(tx, tenantId, connectionId, ruleId) {
  if (!UUID.safeParse(ruleId).success) throw httpError(404, 'Rule not found')
  const [r] = await tx`
    SELECT id, effective_from::text AS effective_from FROM ext_map_rules
     WHERE id = ${ruleId} AND tenant_id = ${tenantId} AND connection_id = ${connectionId}`
  if (!r) throw httpError(404, 'Rule not found')
  return r
}

const earlier = (a, b) => (!a ? b : !b ? a : a < b ? a : b)

/** A rule's target in words, from our names. */
function targetLabel(r, names) {
  if (r.kind === 'ignore') return 'Ignored (not a sale)'
  if (r.kind === 'keep') return 'Kept as sold'
  if (r.kind === 'axis') return r.axis_values.map(v => v.from + ' → ' + (names[v.option_id] || '?')).join(', ')
  const gone = 'Something no longer on the menu'
  const main = r.target_combo_id || r.target_item_id
  return [main && (names[main] || gone), ...r.target_option_ids.map(id => names[id] || gone), ...r.target_item_ids.map(id => names[id] || gone)]
    .filter(Boolean).join(' + ')
}

/** The catalogue page's data: the other till's catalogue with states and sales, the rules, the venues. */
async function mappingView(tx, tenantId, conn, venueId) {
  const [mc, venues, [{ today, remap_pending }], sales, optionSales] = await Promise.all([
    mappingContext(tx, tenantId, conn.id),
    linkedVenues(tx, tenantId, conn.id),
    tx`SELECT current_date::text AS today, remap_from IS NOT NULL AS remap_pending FROM pos_connections WHERE id = ${conn.id} AND tenant_id = ${tenantId}`,
    tx`
      SELECT l.item_ref, l.variant_ref, count(*)::int AS lines, COALESCE(sum(l.qty), 0)::float8 AS qty, COALESCE(sum(l.net_pence), 0)::bigint AS net_pence
        FROM ext_checks c JOIN ext_check_lines l ON l.check_id = c.id AND l.tenant_id = c.tenant_id AND l.line_kind = 'item'
       WHERE c.tenant_id = ${tenantId} AND c.connection_id = ${conn.id} AND c.kind = 'sale' AND NOT c.cancelled
         AND c.business_date >= current_date - ${RECENT_DAYS}::int AND (${venueId}::uuid IS NULL OR c.venue_id = ${venueId}::uuid)
       GROUP BY l.item_ref, l.variant_ref`,
    tx`
      SELECT l.option_ref, count(*)::int AS lines, COALESCE(sum(l.qty), 0)::float8 AS qty, COALESCE(sum(l.net_pence), 0)::bigint AS net_pence
        FROM ext_checks c JOIN ext_check_lines l ON l.check_id = c.id AND l.tenant_id = c.tenant_id AND l.line_kind IN ('modifier', 'condiment')
       WHERE c.tenant_id = ${tenantId} AND c.connection_id = ${conn.id} AND c.kind = 'sale' AND NOT c.cancelled
         AND c.business_date >= current_date - ${RECENT_DAYS}::int AND (${venueId}::uuid IS NULL OR c.venue_id = ${venueId}::uuid)
       GROUP BY l.option_ref`,
  ])
  const scope = { venue_id: venueId, date: today }
  const state = thing => {
    const s = catalogState(thing, mc.rules, mc.ctx, scope)
    return {
      state: s.state, label: STATE_LABELS[s.state] || '', rule_id: s.rule_id,
      target: s.state === 'mapped'
        ? (s.parts.length ? s.parts.map(p => mc.names[p.combo_id || p.item_id || p.option_id] || '?').join(' + ') : mc.names[s.option_id || s.item_id] || '')
        : null,
    }
  }
  const money = rows => ({ lines: rows.reduce((n, r) => n + r.lines, 0), qty: rows.reduce((n, r) => n + Number(r.qty), 0), net_pence: rows.reduce((n, r) => n + Number(r.net_pence), 0) })
  const live = mc.catalogRows.filter(r => !r.deleted_at)
  const categories = Object.fromEntries(live.filter(r => r.kind === 'category').map(r => [r.external_id, r.name]))
  const items = live.filter(r => r.kind === 'item').map(it => {
    const variants = live.filter(v => v.kind === 'variant' && v.parent_ref === it.external_id).map(v => {
      const a = v.attrs || {}
      return {
        ref: v.external_id, name: v.name, sku: v.sku, price_pence: v.price_pence,
        values: [a.option1_value, a.option2_value, a.option3_value].filter(x => x != null && x !== ''),
        sales: money(sales.filter(s => s.item_ref === it.external_id && s.variant_ref === v.external_id)),
        state: state({ item_ref: it.external_id, variant_ref: v.external_id, sku: v.sku, name: it.name, variant_name: v.name }),
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
    const a = it.attrs || {}
    return {
      ref: it.external_id, name: it.name, category_ref: it.category_ref, category: categories[it.category_ref] || 'No category',
      axes: [a.option1_name, a.option2_name, a.option3_name].filter(x => x != null && x !== ''),
      modifier_refs: Array.isArray(a.modifier_ids) ? a.modifier_ids : [],
      variants,
      sales: money(sales.filter(s => s.item_ref === it.external_id)),
      state: state({ item_ref: it.external_id, name: it.name }),
    }
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  const modifiers = live.filter(r => r.kind === 'modifier').map(m => ({
    ref: m.external_id, name: m.name,
    options: live.filter(o => o.kind === 'modifier_option' && o.parent_ref === m.external_id).map(o => ({
      ref: o.external_id, name: o.name, price_pence: o.price_pence,
      sales: money(optionSales.filter(s => s.option_ref === o.external_id)),
      state: state({ option_ref: o.external_id, name: o.name }),
    })),
  })).sort((a, b) => a.name.localeCompare(b.name))
  return {
    connection: { id: conn.id, name: conn.name, system: conn.system },
    venues, venue_id: venueId, today, days: RECENT_DAYS, remap_pending,
    items, modifiers,
    rules: mc.rules.map(r => ({ ...r, target: targetLabel(r, mc.names) })),
  }
}

/** Our side for the editor: the menus the venue sells, their dishes and combos, and the option groups. */
async function menuView(tx, tenantId, venueId) {
  const menus = await venueMenus(tx, tenantId, venueId)
  const menuIds = menus.map(m => m.id)
  const sections = menuIds.length ? await tx`
    SELECT id, menu_id, title FROM menu_sections WHERE tenant_id = ${tenantId} AND menu_id = ANY(${menuIds}::uuid[]) ORDER BY sort_order` : []
  const sectionIds = sections.map(s => s.id)
  const items = sectionIds.length ? await tx`
    SELECT id, section_id, name, kind, price_pence, sku FROM menu_items
     WHERE tenant_id = ${tenantId} AND section_id = ANY(${sectionIds}::uuid[]) ORDER BY sort_order` : []
  const itemIds = items.map(i => i.id)
  const [links, groups, options] = await Promise.all([
    itemIds.length ? tx`SELECT item_id, group_id FROM menu_item_variant_groups WHERE tenant_id = ${tenantId} AND item_id = ANY(${itemIds}::uuid[]) ORDER BY sort_order` : [],
    tx`SELECT id, name FROM menu_variant_groups WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
    tx`SELECT id, group_id, label, price_pence FROM menu_variant_options WHERE tenant_id = ${tenantId} ORDER BY sort_order`,
  ])
  return {
    menus: menus.map(m => ({
      id: m.id, name: m.name, venue_id: m.venue_id,
      sections: sections.filter(s => s.menu_id === m.id).map(s => ({
        id: s.id, title: s.title,
        items: items.filter(i => i.section_id === s.id).map(i => ({
          id: i.id, name: i.name, kind: i.kind, price_pence: i.price_pence, sku: i.sku,
          group_ids: links.filter(l => l.item_id === i.id).map(l => l.group_id),
        })),
      })),
    })),
    groups: groups.map(g => ({ id: g.id, name: g.name, options: options.filter(o => o.group_id === g.id).map(o => ({ id: o.id, label: o.label, price_pence: o.price_pence })) })),
  }
}

export default async function itemMappingRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/:connectionId', { preHandler: canView }, async req => {
    const q = VenueQuery.parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const conn = await ownConnection(tx, req.tenantId, req.params.connectionId)
      const venueId = q.venue_id ? await ownLinkedVenue(tx, req.tenantId, conn.id, q.venue_id) : null
      return mappingView(tx, req.tenantId, conn, venueId)
    })
  })

  app.get('/:connectionId/menu', { preHandler: canView }, async req => {
    const q = VenueQuery.parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const conn = await ownConnection(tx, req.tenantId, req.params.connectionId)
      const venueId = q.venue_id ? await ownLinkedVenue(tx, req.tenantId, conn.id, q.venue_id) : null
      return menuView(tx, req.tenantId, venueId)
    })
  })

  app.get('/:connectionId/coverage', { preHandler: canView }, async req => {
    const q = VenueQuery.parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const conn = await ownConnection(tx, req.tenantId, req.params.connectionId)
      const venueId = q.venue_id ? await ownLinkedVenue(tx, req.tenantId, conn.id, q.venue_id) : null
      return coverage(tx, req.tenantId, conn.id, { venueId })
    })
  })

  // Read only: View may preview. The draft is checked as a save would be.
  app.post('/:connectionId/preview', { preHandler: canView }, async req => {
    const body = PreviewBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const conn = await ownConnection(tx, req.tenantId, req.params.connectionId)
      const venueId = body.venue_id ? await ownLinkedVenue(tx, req.tenantId, conn.id, body.venue_id) : null
      const saved = await tx`SELECT id FROM ext_map_rules WHERE tenant_id = ${req.tenantId} AND connection_id = ${conn.id}`
      const savedIds = new Set(saved.map(r => r.id))
      for (const id of body.remove) if (!savedIds.has(id)) throw httpError(404, 'Rule not found')
      const changed = []
      for (const [i, d] of body.rules.entries()) {
        if (d.id && !savedIds.has(d.id)) throw httpError(404, 'Rule not found')
        const { id, ...rest } = d
        changed.push({ ...(await cleanRule(tx, req.tenantId, conn.id, rest)), id: id || 'draft-' + i })
      }
      const { rules } = await mappingContext(tx, req.tenantId, conn.id)
      const replaced = new Set([...body.remove, ...changed.map(r => r.id)])
      const draft = [...rules.filter(r => !replaced.has(r.id)), ...changed]
      return previewMapping(tx, req.tenantId, conn.id, { venueId, draft })
    })
  })

  app.post('/:connectionId/rules', { preHandler: canManage }, async (req, reply) => {
    const row = await withTenant(req.tenantId, async tx => {
      const conn = await ownConnection(tx, req.tenantId, req.params.connectionId)
      const r = await cleanRule(tx, req.tenantId, conn.id, req.body || {})
      const saved = await saveRule(tx, req.tenantId, conn.id, r, by(req))
      await requestRemap(tx, req.tenantId, conn.id, saved.effective_from)
      return saved
    })
    queueRemap(req.tenantId, req.params.connectionId, req.log)
    return reply.code(201).send(row)
  })

  app.put('/:connectionId/rules/:ruleId', { preHandler: canManage }, async req => {
    const saved = await withTenant(req.tenantId, async tx => {
      const conn = await ownConnection(tx, req.tenantId, req.params.connectionId)
      const old = await ownRule(tx, req.tenantId, conn.id, req.params.ruleId)
      const r = await cleanRule(tx, req.tenantId, conn.id, req.body || {})
      const row = await saveRule(tx, req.tenantId, conn.id, r, by(req), old.id)
      await requestRemap(tx, req.tenantId, conn.id, earlier(old.effective_from, row.effective_from))
      return row
    })
    queueRemap(req.tenantId, req.params.connectionId, req.log)
    return saved
  })

  app.delete('/:connectionId/rules/:ruleId', { preHandler: canManage }, async req => {
    await withTenant(req.tenantId, async tx => {
      const conn = await ownConnection(tx, req.tenantId, req.params.connectionId)
      const old = await ownRule(tx, req.tenantId, conn.id, req.params.ruleId)
      await tx`DELETE FROM ext_map_rules WHERE id = ${old.id} AND tenant_id = ${req.tenantId}`
      await requestRemap(tx, req.tenantId, conn.id, old.effective_from)
    })
    queueRemap(req.tenantId, req.params.connectionId, req.log)
    return { ok: true }
  })
}
