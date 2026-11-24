// shared/itemMapping.js
//
// Sales from other tills, phase 2 (docs/SALES_IMPORT.md 4.1, 4.2, 4.4): the
// one rule for what another till's lines are on our menus. Used by the sync
// (every receipt as it is normalised), the background re-map after a rule
// change, the Item mapping page's states and its Preview
// (api/src/services/itemMappingSvc.js). Plain ESM, no dependencies.
//
// A rule (ext_map_rules, migration 292):
//   { id, kind, venue_id (null = every venue on the connection),
//     item_ref, variant_ref, option_ref, option_refs, axis_kind, axis_name,
//     axis_group_ref, axis_values: [{ from, option_id }],
//     target_item_id, target_item_ids, target_option_ids, target_combo_id,
//     target_group_id, ext_sku, ext_name, effective_from: 'YYYY-MM-DD' }
//
// Applied most specific first: a rule whose refs match beats one that only
// matches by its SKU or name (kept for when the other till makes an item
// again under a new id); then a venue's rule beats the connection's; then a
// combination (item + variant + modifiers) beats an exact variant rule, which
// beats an exact item rule; then the later effective_from. Ignore and keep
// match as exact rules do. Once the dish is known, axis rules add our options
// from the variant's option values (Size: Large) and from modifier options
// in a mapped group, for the groups the dish has no option for yet. A
// modifier option that maps to nothing stays a note on the line.
//
// A rule never changes money. An item line's net (which holds its modifiers'
// money, as Loyverse records it) is spread over its parts by our list prices
// (allocateNet(), shared/externalSales.js), so the parts add up to the line.

import { allocateNet } from './externalSales.js'

export const RULE_KINDS = ['exact', 'combination', 'axis', 'ignore', 'keep']
export const AXIS_KINDS = ['variant', 'modifier']
export const MAP_STATES = ['mapped', 'ignored', 'kept', 'note', 'in_combo', 'unmapped']
export const STATE_LABELS = {
  mapped: 'Mapped', ignored: 'Ignored', kept: 'Kept as sold', note: 'Note only', in_combo: 'Part of a combination', unmapped: 'Not mapped',
}

const low = s => String(s ?? '').trim().toLowerCase()
const list = v => (Array.isArray(v) ? v : [])
const day = v => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10))
const ITEM_LINES = new Set(['item'])
const MOD_LINES = new Set(['modifier', 'condiment'])
const DECIDES = new Set(['exact', 'ignore', 'keep'])

/** A line's name as the other till sold it: "Flat white · Large / Oat". */
export const soldName = l => (l?.name || '') + (l?.variant_name ? ' · ' + l.variant_name : '')

/**
 * The match of a rule as one string: one rule per match and scope
 * (ext_map_rules.match_key). Exact, ignore and keep share one key for the
 * same thing: one decision per item, variant or modifier option.
 */
export function ruleKey(r) {
  switch (r.kind) {
    case 'combination':
      return 'c:' + (r.item_ref || '') + ':' + (r.variant_ref || '') + ':' + [...new Set(list(r.option_refs))].sort().join(',')
    case 'axis':
      return 'a:' + r.axis_kind + ':' + (r.axis_kind === 'variant' ? low(r.axis_name) : (r.axis_group_ref || '')) + ':' + (r.item_ref || '')
    default:
      return r.variant_ref ? 'v:' + r.variant_ref : r.option_ref ? 'o:' + r.option_ref : 'i:' + (r.item_ref || '')
  }
}

/** A rule with its lists and its date in the shapes used here. */
export function normaliseRule(r) {
  return {
    ...r,
    venue_id: r.venue_id || null,
    option_refs: list(r.option_refs).map(String),
    axis_values: list(r.axis_values).filter(v => v && v.from != null).map(v => ({ from: String(v.from), option_id: v.option_id || null })),
    target_item_ids: list(r.target_item_ids),
    target_option_ids: list(r.target_option_ids),
    effective_from: day(r.effective_from),
  }
}

/**
 * What a rule needs from the other till's catalogue (ext_catalog rows:
 * { kind, external_id, parent_ref, attrs, deleted_at }):
 *   itemAxes      item ref -> its variant option names ['Size', 'Milk']
 *   variantValues variant ref -> its option values ['Large', 'Oat']
 *   optionGroup   modifier option ref -> its modifier (group) ref
 *   knownRefs     refs still on the other till: a rule whose ref is there
 *                 never matches by SKU or name instead
 */
export function catalogContext(rows) {
  const ctx = { itemAxes: {}, variantValues: {}, optionGroup: {}, knownRefs: new Set() }
  for (const r of list(rows)) {
    const a = r.attrs || {}
    if (!r.deleted_at) ctx.knownRefs.add(r.kind + ':' + r.external_id)
    if (r.kind === 'item') ctx.itemAxes[r.external_id] = [a.option1_name, a.option2_name, a.option3_name].filter(x => x != null && x !== '')
    if (r.kind === 'variant') ctx.variantValues[r.external_id] = [a.option1_value, a.option2_value, a.option3_value].filter(x => x != null && x !== '')
    if (r.kind === 'modifier_option') ctx.optionGroup[r.external_id] = r.parent_ref
  }
  return ctx
}

/**
 * What allocation needs from our menus: list prices of dishes (and combos)
 * and options, with a dish's own price for an option where it has one
 * (menu_item_variant_prices).
 *   items: [{ id, price_pence, kind }], options: [{ id, group_id, price_pence }],
 *   itemOptionPrices: [{ item_id, option_id, price_pence }]
 */
export function ourContext({ items = [], options = [], itemOptionPrices = [] } = {}) {
  const ctx = { items: {}, options: {}, itemOptionPrices: {} }
  for (const i of items) ctx.items[i.id] = { price_pence: Number(i.price_pence) || 0, kind: i.kind || 'dish' }
  for (const o of options) ctx.options[o.id] = { group_id: o.group_id, price_pence: Number(o.price_pence) || 0 }
  for (const p of itemOptionPrices) (ctx.itemOptionPrices[p.item_id] ||= {})[p.option_id] = Number(p.price_pence) || 0
  return ctx
}

function inScope(r, venueId, date) {
  if (r.venue_id && r.venue_id !== venueId) return false
  if (r.effective_from && date && r.effective_from > date) return false
  return true
}

// Lower sorts first. Each candidate: { rule, key: [..numbers] }.
function best(cands) {
  if (!cands.length) return null
  cands.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]
    const da = a.rule.effective_from || '', db = b.rule.effective_from || ''
    if (da !== db) return da < db ? 1 : -1
    return String(a.rule.id || '').localeCompare(String(b.rule.id || ''))
  })
  return cands[0].rule
}

const scope = r => (r.venue_id ? 0 : 1)

/** The rule that decides an item line, or null. */
function itemRule(line, kidRefs, rules, cat) {
  const cands = []
  const known = cat?.knownRefs
  for (const r of rules) {
    if (r.kind === 'combination') {
      if (r.item_ref && r.item_ref === line.item_ref && (!r.variant_ref || r.variant_ref === line.variant_ref)
          && r.option_refs.length && r.option_refs.every(x => kidRefs.has(x))) {
        cands.push({ rule: r, key: [0, scope(r), r.variant_ref ? 0 : 1, -r.option_refs.length] })
      }
      continue
    }
    if (!DECIDES.has(r.kind) || r.option_ref) continue
    if (r.variant_ref ? r.variant_ref === line.variant_ref : (r.item_ref && r.item_ref === line.item_ref)) {
      cands.push({ rule: r, key: [0, scope(r), r.variant_ref ? 2 : 3, 0] })
      continue
    }
    // Fallback: the rule's own item is gone from the other till.
    const ref = r.variant_ref ? 'variant:' + r.variant_ref : 'item:' + r.item_ref
    if (known && known.has(ref)) continue
    if (r.ext_sku && line.sku && low(r.ext_sku) === low(line.sku)) cands.push({ rule: r, key: [1, scope(r), 4, 0] })
    else if (r.ext_name && low(r.ext_name) === low(r.variant_ref ? soldName(line) : line.name)) cands.push({ rule: r, key: [1, scope(r), 5, 0] })
  }
  return best(cands)
}

/** The rule (and option) for a modifier line: an exact rule on its option, else an axis on its group. */
function modifierRule(kid, parent, rules, cat) {
  const exact = best(rules.filter(r => DECIDES.has(r.kind) && r.option_ref && r.option_ref === kid.option_ref)
    .map(r => ({ rule: r, key: [scope(r)] })))
  if (exact) return { rule: exact }
  const group = cat?.optionGroup?.[kid.option_ref]
  if (!group) return null
  const axis = best(rules.filter(r => r.kind === 'axis' && r.axis_kind === 'modifier' && r.axis_group_ref === group
      && (!r.item_ref || r.item_ref === parent?.item_ref)
      && r.axis_values.some(v => v.from === kid.option_ref && v.option_id))
    .map(r => ({ rule: r, key: [scope(r), r.item_ref ? 0 : 1] })))
  if (!axis) return null
  return { rule: axis, option_id: axis.axis_values.find(v => v.from === kid.option_ref).option_id }
}

/** Options from variant axes: [{ option_id, rule }], for groups `taken` doesn't hold yet. */
function axisOptions(line, rules, cat, ours, taken) {
  const names = cat?.itemAxes?.[line.item_ref] || []
  if (!names.length) return []
  const values = cat?.variantValues?.[line.variant_ref] || (line.variant_name ? String(line.variant_name).split(' / ') : [])
  const out = []
  names.forEach((name, i) => {
    const value = values[i]
    if (value == null) return
    const r = best(rules.filter(x => x.kind === 'axis' && x.axis_kind === 'variant' && low(x.axis_name) === low(name)
        && (!x.item_ref || x.item_ref === line.item_ref)
        && x.axis_values.some(v => low(v.from) === low(value) && v.option_id))
      .map(x => ({ rule: x, key: [scope(x), x.item_ref ? 0 : 1] })))
    if (!r) return
    const option_id = r.axis_values.find(v => low(v.from) === low(value)).option_id
    const group = ours?.options?.[option_id]?.group_id || r.target_group_id || option_id
    if (taken.has(group)) return
    taken.add(group)
    out.push({ option_id, rule: r })
  })
  return out
}

const blank = (l, state = null) => ({
  id: l.id, state, rule_id: null, item_id: null, option_id: null, combo_id: null, allocated_net_pence: null, parts: [],
})

/**
 * Maps one check's lines. check: { venue_id, business_date, lines: [{ id,
 * line_kind, parent_id, item_ref, variant_ref, option_ref, sku, name,
 * variant_name, qty, net_pence }] }; rules as normaliseRule() gives them;
 * ctx: { catalog: catalogContext(), ours: ourContext() }.
 * Returns one result per line, in the lines' order: { id, state, rule_id,
 * item_id, option_id, combo_id, allocated_net_pence, parts }; parts (item
 * lines that map to something) are [{ part_no, role: 'main' | 'option' |
 * 'dish', item_id, option_id, combo_id, rule_id, source_line_id, qty,
 * net_pence }] and add up to the line's net_pence.
 */
export function mapCheck(check, rules, ctx = {}) {
  const date = day(check.business_date)
  const active = list(rules).filter(r => inScope(r, check.venue_id, date))
  const { catalog = null, ours = null } = ctx
  const lines = list(check.lines)
  const out = new Map(lines.map(l => [l.id, blank(l)]))
  const kidsOf = new Map()
  for (const l of lines) {
    if (MOD_LINES.has(l.line_kind) && l.parent_id) {
      if (!kidsOf.has(l.parent_id)) kidsOf.set(l.parent_id, [])
      kidsOf.get(l.parent_id).push(l)
    }
  }
  const price = id => ours?.items?.[id]?.price_pence ?? 0

  for (const line of lines) {
    if (MOD_LINES.has(line.line_kind) && !out.get(line.id).state) out.get(line.id).state = 'note'
    if (!ITEM_LINES.has(line.line_kind)) continue
    const res = out.get(line.id)
    const kids = kidsOf.get(line.id) || []
    const rule = itemRule(line, new Set(kids.map(k => k.option_ref).filter(Boolean)), active, catalog)
    const consumed = rule?.kind === 'combination' ? new Set(rule.option_refs) : new Set()

    let parts = null
    if (!rule) res.state = 'unmapped'
    else if (rule.kind === 'ignore') Object.assign(res, { state: 'ignored', rule_id: rule.id })
    else if (rule.kind === 'keep') Object.assign(res, { state: 'kept', rule_id: rule.id })
    else if (rule.target_combo_id || rule.target_item_id) {
      const combo = !!rule.target_combo_id
      const main = rule.target_combo_id || rule.target_item_id
      Object.assign(res, { state: 'mapped', rule_id: rule.id, item_id: combo ? null : main, combo_id: combo ? main : null })
      parts = [{ role: 'main', item_id: combo ? null : main, combo_id: combo ? main : null, option_id: null, rule_id: rule.id,
        source_line_id: null, weight: price(main) }]
      const optPrice = id => ours?.itemOptionPrices?.[main]?.[id] ?? ours?.options?.[id]?.price_pence ?? 0
      const taken = new Set()
      for (const id of rule.target_option_ids) {
        taken.add(ours?.options?.[id]?.group_id || id)
        parts.push({ role: 'option', item_id: null, combo_id: null, option_id: id, rule_id: rule.id, source_line_id: null, weight: optPrice(id) })
      }
      for (const id of rule.target_item_ids) {
        parts.push({ role: 'dish', item_id: id, combo_id: null, option_id: null, rule_id: rule.id, source_line_id: null, weight: price(id) })
      }
      if (!combo) {
        for (const a of axisOptions(line, active, catalog, ours, taken)) {
          parts.push({ role: 'option', item_id: null, combo_id: null, option_id: a.option_id, rule_id: a.rule.id, source_line_id: null, weight: optPrice(a.option_id) })
        }
      }
      res.optPrice = optPrice
    } else {
      res.state = 'unmapped'
    }

    // The modifiers under it.
    for (const kid of kids) {
      const k = out.get(kid.id)
      if (kid.option_ref && consumed.has(kid.option_ref)) {
        Object.assign(k, { state: 'in_combo', rule_id: rule.id })
        continue
      }
      const m = modifierRule(kid, line, active, catalog)
      if (!m) { k.state = 'note'; continue }
      const r = m.rule
      if (r.kind === 'ignore') { Object.assign(k, { state: 'ignored', rule_id: r.id }); continue }
      if (r.kind === 'keep') { Object.assign(k, { state: 'kept', rule_id: r.id }); continue }
      const optionId = m.option_id || (r.kind === 'exact' && !r.target_item_id ? r.target_option_ids[0] : null) || null
      const dishId = !optionId && r.kind === 'exact' ? r.target_item_id : null
      if (!optionId && !dishId) { k.state = 'note'; continue }
      Object.assign(k, { state: 'mapped', rule_id: r.id, option_id: optionId, item_id: dishId })
      if (parts) {
        parts.push({ role: optionId ? 'option' : 'dish', item_id: dishId, combo_id: null, option_id: optionId, rule_id: r.id,
          source_line_id: kid.id, weight: optionId ? res.optPrice(optionId) : price(dishId) })
      }
    }
    delete res.optPrice

    if (parts) {
      const shares = allocateNet(line.net_pence, parts.map(p => p.weight))
      res.parts = parts.map((p, i) => {
        const { weight, ...rest } = p
        return { part_no: i + 1, ...rest, qty: Number(line.qty) || 0, net_pence: shares[i] }
      })
      res.allocated_net_pence = shares[0]
      for (const p of res.parts) if (p.source_line_id) out.get(p.source_line_id).allocated_net_pence = p.net_pence
    }
  }
  return lines.map(l => out.get(l.id))
}

/**
 * The state of one thing on the other till's catalogue under the rules, for
 * the mapping page: an item or variant on its own, or a modifier option
 * (under `parent`, an item ref, when given). Returns mapCheck()'s result for
 * it, so the page and the sync can never disagree.
 */
export function catalogState(thing, rules, ctx = {}, { venue_id = null, date = null } = {}) {
  const base = { qty: 1, net_pence: 0, sku: thing.sku || null, name: thing.name || '', variant_name: thing.variant_name || null }
  if (thing.option_ref) {
    const lines = [
      { id: 'p', line_kind: 'item', parent_id: null, item_ref: thing.parent_item_ref || null, variant_ref: null, option_ref: null, name: '', qty: 1, net_pence: 0 },
      { ...base, id: 'k', line_kind: 'modifier', parent_id: 'p', item_ref: null, variant_ref: null, option_ref: thing.option_ref },
    ]
    return mapCheck({ venue_id, business_date: date, lines }, rules, ctx)[1]
  }
  const lines = [{ ...base, id: 'i', line_kind: 'item', parent_id: null, item_ref: thing.item_ref || null, variant_ref: thing.variant_ref || null, option_ref: null }]
  return mapCheck({ venue_id, business_date: date, lines }, rules, ctx)[0]
}
