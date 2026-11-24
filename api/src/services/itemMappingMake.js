// src/services/itemMappingMake.js
//
// Item mapping, phase 3 (docs/SALES_IMPORT.md 4.5):
//
//   createMissing(ctx, { connectionId, venueId, sectionId, keys, user })
//     Create missing dishes: for chosen items still unmapped at a venue,
//     our dishes in one section of a menu the venue sells, priced as the
//     other till sells them at that venue, an item's variants as an option
//     group (Size: Regular, Large) with the dish's own price for each option,
//     then the exact rules that map them as made. The menu is changed
//     through the menus area's own routes, called in-process as the person
//     (callApi(): Menus manage is checked there): POST
//     /api/menus/variant-groups for a new group, then GET /api/menus/:id,
//     menuSaveBody() (shared/menuSave.js, every field and id kept), the new
//     dishes added to the section, and the whole-tree PATCH (rule 13). Only
//     the dishes are added: the rest of the menu goes back as it came.
//     Dishes go into the draft; publishing stays the person's.
//
//   copyPlan(tx, tenantId, connectionId, fromVenue, toVenue)
//     Copy from another venue: the source venue's own rules as rules for the
//     target venue, each target re-pointed by name onto the target venue's
//     menus (a dish or section it already sells is kept); what can't be
//     matched, and what the target venue already has a rule for, reported.
//     Writes nothing: the route saves the plan once the person confirms it.
//
// An existing option group is reused only when it has the same name, adds
// its price on top (extra) and has every value; otherwise a new one is made
// ("Size", or "Size (Muffin)" when "Size" is taken). A new group adds on
// top: the dish holds the lowest variant price and each option the
// difference, so the dish keeps the larger share when a line's net is
// spread over its parts (allocateNet()).

import { randomUUID } from 'node:crypto'
import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { callApi, ToolError } from '../ai/context.js'
import { menuSaveBody } from '../../../shared/menuSave.js'
import { normName } from '../../../shared/itemMatch.js'
import { ruleKey, normaliseRule } from '../../../shared/itemMapping.js'
import { mappingContext, openThings, venueOurs, venueMenus, queueRemap } from './itemMappingSvc.js'
import { saveRules } from '../routes/itemMapping.js'

export const MAX_CREATE = 60

const asHttp = err => (err instanceof ToolError ? httpError(err.status || 422, err.message) : err)

/** The plan: the dishes to add and the groups they need, from the chosen things. */
async function makePlan(tx, tenantId, connectionId, venueId, sectionId, keys) {
  const menus = await venueMenus(tx, tenantId, venueId)
  const [section] = await tx`
    SELECT s.id, s.title, s.menu_id FROM menu_sections s
     WHERE s.tenant_id = ${tenantId} AND s.id = ${sectionId} AND s.menu_id = ANY(${menus.map(m => m.id)}::uuid[])`
  if (!section) throw httpError(422, 'Choose a section of a menu this venue sells')
  const mc = await mappingContext(tx, tenantId, connectionId)
  const open = await openThings(tx, tenantId, connectionId, venueId, { mc })
  const chosen = open.filter(t => t.kind !== 'option' && keys.includes(t.key))
  if (!chosen.length) throw httpError(422, 'Choose items that aren\'t mapped yet')
  const groups = await tx`
    SELECT g.id, g.name, g.price_mode, COALESCE(json_agg(json_build_object('id', o.id, 'label', o.label)) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
      FROM menu_variant_groups g LEFT JOIN menu_variant_options o ON o.group_id = g.id AND o.tenant_id = g.tenant_id
     WHERE g.tenant_id = ${tenantId} GROUP BY g.id`
  const [{ names }] = await tx`
    SELECT COALESCE(array_agg(lower(mi.name)), '{}') AS names FROM menu_items mi WHERE mi.tenant_id = ${tenantId} AND mi.section_id = ${section.id}`

  // One dish per item; an item's chosen variants become its options.
  const byItem = new Map()
  for (const t of chosen) {
    if (!byItem.has(t.item_ref)) byItem.set(t.item_ref, { item_ref: t.item_ref, name: t.name, axes: t.axes, things: [] })
    byItem.get(t.item_ref).things.push(t)
  }
  const dishes = [], newGroups = new Map(), skipped = []
  for (const it of byItem.values()) {
    if (names.includes(it.name.toLowerCase())) { skipped.push({ name: it.name, why: 'A dish of that name is already in ' + section.title }); continue }
    const priced = it.things.filter(t => t.price_pence != null)
    const base = priced.length ? Math.min(...priced.map(t => t.price_pence)) : null
    const variants = it.things.filter(t => t.kind === 'variant')
    if (!variants.length) {
      dishes.push({ id: randomUUID(), name: it.name, price_pence: base, things: it.things, group: null })
      continue
    }
    const labelOf = t => (t.values.length ? t.values.join(' / ') : t.variant_name)
    const labels = [...new Set(variants.map(labelOf))]
    const groupName = (it.axes.length ? it.axes.join(' / ') : 'Options').slice(0, 80)
    const reuse = groups.find(g => g.name.toLowerCase() === groupName.toLowerCase() && g.price_mode === 'extra'
      && labels.every(l => g.options.some(o => o.label.toLowerCase() === l.toLowerCase())))
    let group
    if (reuse) group = { id: reuse.id, name: reuse.name, options: reuse.options, made: false }
    else {
      // A new group, shared by the items of this batch with the same option names.
      const key = groupName.toLowerCase()
      if (!newGroups.has(key)) {
        const taken = groups.some(g => g.name.toLowerCase() === key)
        newGroups.set(key, { id: null, name: taken ? (groupName + ' (' + it.name + ')').slice(0, 100) : groupName, labels: [], made: true })
      }
      group = newGroups.get(key)
      for (const l of labels) if (!group.labels.some(x => x.toLowerCase() === l.toLowerCase())) group.labels.push(l)
    }
    dishes.push({
      id: randomUUID(), name: it.name, price_pence: base, group,
      things: variants.map(t => ({ ...t, label: labelOf(t), extra: t.price_pence != null && base != null ? t.price_pence - base : 0 })),
    })
  }
  return { section, dishes, newGroups: [...newGroups.values()], skipped }
}

/**
 * Create missing dishes (see the top). ctx is a staff context for callApi()
 * (the person's own token: the menus routes check Menus manage). Returns {
 * dishes: [{ id, name }], groups: [{ id, name, made }], rules: { saved,
 * failed }, skipped }.
 */
export async function createMissing(ctx, { connectionId, venueId, sectionId, keys, user }) {
  const tenantId = ctx.tenantId
  const plan = await withTenant(tenantId, tx => makePlan(tx, tenantId, connectionId, venueId, sectionId, keys))
  if (!plan.dishes.length) return { dishes: [], groups: [], rules: { saved: [], failed: [] }, skipped: plan.skipped }
  try {
    // The new option groups, through the menus area's own route.
    for (const g of plan.newGroups) {
      const made = await callApi(ctx, 'POST', '/api/menus/variant-groups', {
        body: { name: g.name, price_mode: 'extra', min_select: 1, max_select: 1, options: g.labels.map((label, i) => ({ label, price_pence: 0, sort_order: i })) },
      })
      g.id = made.id
      g.options = made.options
    }
    // The dishes: the menu as it is, the new dishes added to the section, saved whole.
    const full = await callApi(ctx, 'GET', '/api/menus/' + plan.section.menu_id)
    const body = menuSaveBody(full)
    const sec = body.sections.find(s => s.id === plan.section.id)
    if (!sec) throw httpError(409, 'That section has just been removed from the menu')
    for (const d of plan.dishes) {
      const optionOf = t => d.group.options.find(o => o.label.toLowerCase() === t.label.toLowerCase())
      sec.items.push({
        id: d.id, kind: 'dish', kitchen_name: null, pos_course_id: null, pos_colour: null, combo: null,
        name: d.name, native_name: null, description: null, price_pence: d.price_pence, calories: null, notes: null,
        is_featured: false, image_url: null, sort_order: sec.items.length, is_orderable: true,
        tax: { rate: null, rules: [] }, item_type: null, sku: null, barcode: null, option_codes: [], min_order_qty: null,
        variants: [], dietary: [], allergen_levels: {},
        variant_groups: d.group ? [{
          group_id: d.group.id, sort_order: 0,
          overrides: d.things.map(t => ({ option_id: optionOf(t).id, price_pence: Math.max(0, t.extra) })),
        }] : [],
      })
    }
    await callApi(ctx, 'PATCH', '/api/menus/' + plan.section.menu_id, { body })
  } catch (err) { throw asHttp(err) }

  // The rules that map them as made.
  const rules = []
  for (const d of plan.dishes) {
    for (const t of d.things) {
      if (t.kind === 'item') rules.push({ kind: 'exact', venue_id: venueId, item_ref: t.item_ref, target_item_id: d.id })
      else {
        const opt = d.group.options.find(o => o.label.toLowerCase() === t.label.toLowerCase())
        rules.push({ kind: 'exact', venue_id: venueId, variant_ref: t.variant_ref, target_item_id: d.id, target_option_ids: [opt.id] })
      }
    }
  }
  const saved = await withTenant(tenantId, tx => saveRules(tx, tenantId, connectionId, rules, user))
  if (saved.saved.length) queueRemap(tenantId, connectionId, ctx.log)
  const groups = [...new Map(plan.dishes.filter(d => d.group).map(d => [d.group.id, { id: d.group.id, name: d.group.name, made: d.group.made }])).values()]
  return {
    dishes: plan.dishes.map(d => ({ id: d.id, name: d.name, price_pence: d.price_pence, options: d.group ? d.things.length : 0 })),
    groups, rules: { saved: saved.saved.map(s => ({ index: s.index, id: s.id })), failed: saved.failed }, skipped: plan.skipped,
  }
}

// ── Copy from another venue ─────────────────────────────────────────────────

/**
 * A venue's own rules as rules for another venue on the same connection,
 * re-pointed by name onto the target venue's menus. Returns { copy: [{
 * from_rule_id, rule, changed }], unmatched: [{ from_rule_id, why }],
 * existing: [{ from_rule_id }] }; writes nothing.
 */
export async function copyPlan(tx, tenantId, connectionId, fromVenue, toVenue) {
  if (fromVenue === toVenue) throw httpError(422, 'Choose two different venues')
  const [mc, target, sections] = await Promise.all([
    mappingContext(tx, tenantId, connectionId),
    venueOurs(tx, tenantId, toVenue),
    tx`SELECT s.id, s.title, s.menu_id FROM menu_sections s WHERE s.tenant_id = ${tenantId}`,
  ])
  const targetMenus = new Set(target.menus.map(m => m.id))
  const ownMenus = new Set(target.menus.filter(m => m.venue_id).map(m => m.id))
  const dishById = new Map(target.dishes.map(d => [d.id, d]))
  const groupById = new Map(target.groups.map(g => [g.id, g]))
  const optById = new Map(target.options.map(o => [o.id, o]))
  const [allItems, allOptions, allGroups] = await Promise.all([
    tx`SELECT id, name FROM menu_items WHERE tenant_id = ${tenantId}`,
    tx`SELECT o.id, o.label, g.name AS group_name FROM menu_variant_options o JOIN menu_variant_groups g ON g.id = o.group_id AND g.tenant_id = o.tenant_id WHERE o.tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM menu_variant_groups WHERE tenant_id = ${tenantId}`,
  ])
  const nameOf = new Map([...allItems.map(i => [i.id, i.name]), ...allGroups.map(g => [g.id, g.name])])
  const optOf = new Map(allOptions.map(o => [o.id, o]))

  const miss = []
  const dish = id => {
    if (!id) return null
    if (dishById.has(id)) return id
    const name = normName(nameOf.get(id))
    const hits = target.dishes.filter(d => normName(d.name) === name)
    const own = hits.filter(d => ownMenus.has(d.menu_id))
    const pick = own.length === 1 ? own[0] : hits.length === 1 ? hits[0] : null
    if (!pick) miss.push((nameOf.get(id) || 'A dish no longer on the menu') + (hits.length > 1 ? ' (more than one of that name)' : ' (not on its menus)'))
    return pick?.id || null
  }
  const option = id => {
    if (optById.has(id)) return id
    const o = optOf.get(id)
    const hit = o && target.options.find(x => normName(x.group_name) === normName(o.group_name) && normName(x.label) === normName(o.label))
    if (!hit) miss.push((o ? o.group_name + ': ' + o.label : 'An option no longer on the menu') + ' (no such option on its dishes)')
    return hit?.id || null
  }
  const group = id => {
    if (groupById.has(id)) return id
    const hit = target.groups.find(g => normName(g.name) === normName(nameOf.get(id)))
    if (!hit) miss.push((nameOf.get(id) || 'An option group no longer on the menu') + ' (not on its dishes)')
    return hit?.id || null
  }
  const section = id => {
    const s = sections.find(x => x.id === id)
    if (s && targetMenus.has(s.menu_id)) return id
    const hit = s && sections.find(x => targetMenus.has(x.menu_id) && normName(x.title) === normName(s.title))
    if (!hit) miss.push('Section ' + (s?.title || 'no longer on the menu') + ' (not on its menus)')
    return hit?.id || null
  }

  const existing = new Set(mc.rules.filter(r => r.venue_id === toVenue).map(ruleKey))
  const out = { copy: [], unmatched: [], existing: [], names: mc.names }
  for (const r of mc.rules.filter(x => x.venue_id === fromVenue)) {
    if (existing.has(ruleKey(r))) { out.existing.push({ from_rule_id: r.id, rule: r }); continue }
    miss.length = 0
    const rule = {
      kind: r.kind, venue_id: toVenue, item_ref: r.item_ref, variant_ref: r.variant_ref, option_ref: r.option_ref, option_refs: r.option_refs,
      axis_kind: r.axis_kind, axis_name: r.axis_name, axis_group_ref: r.axis_group_ref,
      axis_values: r.axis_values.map(v => ({ from: v.from, option_id: v.option_id ? option(v.option_id) : null })),
      target_item_id: dish(r.target_item_id), target_combo_id: dish(r.target_combo_id),
      target_item_ids: r.target_item_ids.map(dish), target_option_ids: r.target_option_ids.map(option),
      target_group_id: r.target_group_id ? group(r.target_group_id) : null,
      pattern_field: r.pattern_field, pattern_op: r.pattern_op, pattern_value: r.pattern_value,
      target_section_id: r.target_section_id ? section(r.target_section_id) : null,
      effective_from: r.effective_from, note: r.note,
    }
    if (miss.length) { out.unmatched.push({ from_rule_id: r.id, rule: r, why: [...new Set(miss)].join('; ') }); continue }
    const changed = rule.target_item_id !== r.target_item_id || rule.target_combo_id !== r.target_combo_id
      || JSON.stringify(rule.target_option_ids) !== JSON.stringify(r.target_option_ids) || rule.target_group_id !== r.target_group_id
      || rule.target_section_id !== r.target_section_id || JSON.stringify(rule.target_item_ids) !== JSON.stringify(r.target_item_ids)
    out.copy.push({ from_rule_id: r.id, rule, changed, normal: normaliseRule({ ...rule, id: 'copy-' + r.id }) })
  }
  return out
}
