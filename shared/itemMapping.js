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
// Phase 3 (migration 293): pattern rules ({ kind: 'pattern', pattern_field,
// pattern_op, pattern_value } + an exact rule's targets) and the category
// fallback ({ kind: 'bucket', pattern_value: a category ref,
// target_section_id }) decide an item line no rule matches by ref (nor by
// its SKU or name fallback), most specific first: code equals, code starts
// with (the longer first), name contains (the longer first), category, then
// the bucket; a venue's before the connection's at each step. A bucket line
// is counted under our section, not as a dish. learnOffers() turns a group
// of accepted rules with the same shape into one rule to offer.
//
// A rule never changes money. An item line's net (which holds its modifiers'
// money, as Loyverse records it) is spread over its parts by our list prices
// (allocateNet(), shared/externalSales.js), so the parts add up to the line.

import { allocateNet } from './externalSales.js'
import { nameScore } from './itemMatch.js'

export const RULE_KINDS = ['exact', 'combination', 'axis', 'ignore', 'keep', 'pattern', 'bucket']
export const AXIS_KINDS = ['variant', 'modifier']
export const PATTERN_FIELDS = ['code', 'name', 'category']
export const PATTERN_OPS = { code: ['equals', 'starts_with'], name: ['contains'], category: ['equals'] }
export const PATTERN_LABELS = {
  'code:equals': 'Code is', 'code:starts_with': 'Code starts with', 'name:contains': 'Name contains', 'category:equals': 'Category is',
}
export const MAP_STATES = ['mapped', 'ignored', 'kept', 'note', 'in_combo', 'bucket', 'unmapped']
export const STATE_LABELS = {
  mapped: 'Mapped', ignored: 'Ignored', kept: 'Kept as sold', note: 'Note only', in_combo: 'Part of a combination',
  bucket: 'In a section', unmapped: 'Not mapped',
}
// How many accepted rules with the same shape make an offer.
export const LEARN_MIN = 3

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
    case 'pattern':
      return 'p:' + r.pattern_field + ':' + r.pattern_op + ':' + (r.pattern_field === 'category' ? r.pattern_value : low(r.pattern_value))
    case 'bucket':
      return 'b:' + (r.pattern_value || '')
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
 *   itemCategory  item ref -> its category ref (pattern and bucket rules)
 *   variantBarcode variant ref -> its barcode (code patterns)
 *   itemSkus      item ref -> its variants' SKUs (learning)
 *   knownRefs     refs still on the other till: a rule whose ref is there
 *                 never matches by SKU or name instead
 */
export function catalogContext(rows) {
  const ctx = { itemAxes: {}, variantValues: {}, optionGroup: {}, itemCategory: {}, variantBarcode: {}, itemSkus: {}, knownRefs: new Set() }
  for (const r of list(rows)) {
    const a = r.attrs || {}
    if (!r.deleted_at) ctx.knownRefs.add(r.kind + ':' + r.external_id)
    if (r.kind === 'item') {
      ctx.itemAxes[r.external_id] = [a.option1_name, a.option2_name, a.option3_name].filter(x => x != null && x !== '')
      if (r.category_ref) ctx.itemCategory[r.external_id] = r.category_ref
    }
    if (r.kind === 'variant') {
      ctx.variantValues[r.external_id] = [a.option1_value, a.option2_value, a.option3_value].filter(x => x != null && x !== '')
      if (a.barcode) ctx.variantBarcode[r.external_id] = String(a.barcode)
      if (r.sku && !r.deleted_at && r.parent_ref) (ctx.itemSkus[r.parent_ref] ||= []).push(r.sku)
    }
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
  if (cands.length) return best(cands)
  // Nothing matched by ref, SKU or name: the pattern rules, then the bucket.
  for (const r of rules) {
    const level = patternLevel(r, line, cat)
    if (level != null) cands.push({ rule: r, key: [2, level, scope(r), -String(r.pattern_value || '').length] })
  }
  return best(cands)
}

/** Where a pattern or bucket rule ranks for an item line (0 = most specific), or null when it doesn't match. */
function patternLevel(r, line, cat) {
  if (r.kind !== 'pattern' && r.kind !== 'bucket') return null
  const v = low(r.pattern_value)
  if (!v) return null
  const category = cat?.itemCategory?.[line.item_ref]
  if (r.kind === 'bucket') return category && category === r.pattern_value ? 5 : null
  if (r.pattern_field === 'code') {
    const codes = [line.sku, cat?.variantBarcode?.[line.variant_ref]].filter(Boolean).map(low)
    if (r.pattern_op === 'equals') return codes.includes(v) ? 0 : null
    if (r.pattern_op === 'starts_with') return codes.some(c => c.startsWith(v)) ? 1 : null
    return null
  }
  if (r.pattern_field === 'name') return r.pattern_op === 'contains' && low(soldName(line)).includes(v) ? 2 : null
  if (r.pattern_field === 'category') return category && category === r.pattern_value ? 3 : null
  return null
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
  id: l.id, state, rule_id: null, item_id: null, option_id: null, combo_id: null, section_id: null, allocated_net_pence: null, parts: [],
})

/**
 * Maps one check's lines. check: { venue_id, business_date, lines: [{ id,
 * line_kind, parent_id, item_ref, variant_ref, option_ref, sku, name,
 * variant_name, qty, net_pence }] }; rules as normaliseRule() gives them;
 * ctx: { catalog: catalogContext(), ours: ourContext() }.
 * Returns one result per line, in the lines' order: { id, state, rule_id,
 * item_id, option_id, combo_id, section_id (a bucket's), allocated_net_pence, parts }; parts (item
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
    else if (rule.kind === 'bucket') Object.assign(res, { state: 'bucket', rule_id: rule.id, section_id: rule.target_section_id || null })
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

const commonPrefix = strs => strs.reduce((p, s) => { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; return p.slice(0, i) })
const wordsOf = s => low(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3)

/**
 * Learning (docs/SALES_IMPORT.md 4.3): a group of rules with the same shape
 * offered as one rule. added: the rules just saved (normalised, with ids);
 * rules: every rule on the connection now (added among them); cat:
 * catalogContext() of the connection's catalogue with skus (catalogRows'
 * variants: { item ref: [sku] } as cat.itemSkus); options: our options by
 * id { group_id, group_name, label }. Two shapes, each needing LEARN_MIN
 * rules at one scope, at least one of them just added:
 *   - variants with the same value of the same variant option (Size:
 *     Large) whose targets hold the same option of ours -> an axis rule for
 *     every item (merged into the scope's rule for that option name when
 *     there is one: `replaces` is its id);
 *   - items or variants mapped to the same dish (and options) whose codes
 *     share a prefix of two characters or more, else whose names share a
 *     word, else that share a category -> a pattern rule.
 * Returns [{ key, kind, count, title, rule (a body for the rule save),
 * replaces }]; never one the rules already have.
 */
export function learnOffers(added, rules, cat, options = {}) {
  const addedIds = new Set(list(added).map(r => r.id))
  const all = list(rules)
  const exact = all.filter(r => r.kind === 'exact' && !r.option_ref && (r.item_ref || r.variant_ref) && (r.target_item_id || r.target_combo_id))
  const optLabel = id => (options[id] ? options[id].group_name + ': ' + options[id].label : '?')
  const has = (venueId, key) => all.some(r => (r.venue_id || null) === (venueId || null) && ruleKey(r) === key)
  const offers = []

  // 1. The same value of the same variant option to the same option of ours.
  const pairs = new Map()
  for (const r of exact) {
    if (!r.variant_ref || !r.target_option_ids.length) continue
    const names = cat?.itemAxes?.[r.item_ref] || []
    const values = cat?.variantValues?.[r.variant_ref] || []
    names.forEach((name, i) => {
      const value = values[i]
      if (value == null || value === '') return
      let pick = null, score = 0
      for (const id of r.target_option_ids) {
        const s = nameScore(value, options[id]?.label || '')
        if (s > score) { score = s; pick = id }
      }
      if (!pick || score < 0.5) return
      const key = (r.venue_id || '') + '|' + low(name) + '|' + low(value) + '|' + pick
      if (!pairs.has(key)) pairs.set(key, { venue_id: r.venue_id || null, name, value, option_id: pick, rules: [] })
      pairs.get(key).rules.push(r)
    })
  }
  for (const p of pairs.values()) {
    if (p.rules.length < LEARN_MIN || !p.rules.some(r => addedIds.has(r.id))) continue
    const group = options[p.option_id]?.group_id
    if (!group) continue
    const existing = all.find(r => r.kind === 'axis' && r.axis_kind === 'variant' && !r.item_ref && (r.venue_id || null) === p.venue_id && low(r.axis_name) === low(p.name))
    if (existing && (existing.target_group_id !== group || existing.axis_values.some(v => low(v.from) === low(p.value)))) continue
    offers.push({
      key: 'axis:' + (p.venue_id || '') + ':' + low(p.name) + ':' + low(p.value), kind: 'axis', count: p.rules.length,
      title: p.rules.length + ' variants with ' + p.name + ' ' + p.value + ' are mapped to ' + optLabel(p.option_id)
        + ': make it a rule for every item with ' + p.name + ' ' + p.value + '?',
      rule: {
        kind: 'axis', venue_id: p.venue_id, axis_kind: 'variant', axis_name: existing?.axis_name || p.name, item_ref: null,
        target_group_id: group, axis_values: [...(existing?.axis_values || []), { from: p.value, option_id: p.option_id }],
        ...(existing ? { effective_from: existing.effective_from, note: existing.note || null } : {}),
      },
      replaces: existing?.id || null,
    })
  }

  // 2. The same target, with something in common on the other till.
  const groups = new Map()
  for (const r of exact) {
    const key = (r.venue_id || '') + '|' + (r.target_combo_id || r.target_item_id) + '|' + [...r.target_option_ids].sort().join(',') + '|' + [...r.target_item_ids].sort().join(',')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  for (const g of groups.values()) {
    if (g.length < LEARN_MIN || !g.some(r => addedIds.has(r.id))) continue
    const r0 = g[0]
    const skus = g.map(r => r.ext_sku || (cat?.itemSkus?.[r.item_ref]?.length === 1 ? cat.itemSkus[r.item_ref][0] : '') || '')
    let pattern = null, why = ''
    if (skus.every(Boolean)) {
      const prefix = commonPrefix(skus.map(s => s.toUpperCase()))
      if (prefix.length >= 2 && new Set(skus).size > 1) { pattern = { pattern_field: 'code', pattern_op: 'starts_with', pattern_value: prefix }; why = 'codes start ' + prefix }
    }
    if (!pattern) {
      const sets = g.map(r => new Set(wordsOf(r.ext_name)))
      const shared = [...sets[0]].filter(w => sets.every(s => s.has(w))).sort((a, b) => b.length - a.length)
      if (shared.length) { pattern = { pattern_field: 'name', pattern_op: 'contains', pattern_value: shared[0] }; why = 'names contain "' + shared[0] + '"' }
    }
    if (!pattern) {
      const cats = new Set(g.map(r => cat?.itemCategory?.[r.item_ref] || ''))
      const [c] = [...cats]
      if (cats.size === 1 && c) { pattern = { pattern_field: 'category', pattern_op: 'equals', pattern_value: c }; why = 'they share a category' }
    }
    if (!pattern) continue
    const rule = {
      kind: 'pattern', venue_id: r0.venue_id || null, ...pattern,
      target_item_id: r0.target_combo_id ? null : r0.target_item_id, target_combo_id: r0.target_combo_id || null,
      target_option_ids: [...r0.target_option_ids], target_item_ids: [...r0.target_item_ids],
    }
    if (has(rule.venue_id, ruleKey(rule))) continue
    offers.push({
      key: 'pattern:' + ruleKey(rule) + ':' + (rule.venue_id || ''), kind: 'pattern', count: g.length,
      title: g.length + ' items mapped to the same dish and ' + why + ': make it a rule for every one?', rule, replaces: null,
    })
  }
  return offers
}
