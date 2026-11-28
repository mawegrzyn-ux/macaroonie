// shared/allergenCheck.js
//
// Allergens from recipes, as a check on what each dish declares (inventory
// phase 8a, migration 316; docs/INVENTORY.md 8.3, decision D6). Plain ESM,
// no database: the API loads the rows (services/allergenCheckSvc.js) and the
// Recipes page's Allergens tab, the recipe editor, Pepper's allergen_check
// and the reports all read these (rule 12).
//
// A supplier product (inv_quotes) says which of the 14 UK allergens it
// contains or may contain (STANDARD_ALLERGENS in shared/menuTags.js, the
// menus' own list), and when that was checked: unchecked is unknown, never
// free. A dish's suggestion is the union of the allergens of every item it
// can hold at a venue, revenue stream and order type: the recipe the matrix
// picks there (recipeFor()), its prep recipes inside, and what its options'
// rules add or swap in, each item at the supplier product chooseQuote()
// picks at that venue. The walk is the cost engine's own (usageOf() and
// recipeUsage() in shared/costing.js with a trace): never another one.
//
// A dish has one declaration on its menu, whichever venue sells it, so the
// check compares the declaration with the suggestion over every scope the
// dish is sold at: an allergen any scope's recipe has must be declared;
// one declared that no scope's recipe has is said only when every scope is
// fully known (no gaps), since an unknown product may hold it. Nothing here
// changes a declaration: a person accepts or dismisses each difference.
//
//   quoteAllergens(quote)          { known, levels: { key: 'contains' | 'may_contain' }, checked_at, source }
//   allergenListProblem(body)      why a product's allergens can't be saved, or null
//   dishScopes(dish, ctx, venueIds)    the scopes a dish can differ at
//   dishItems(dishId, scope, ctx)  every item the dish can hold there, with the recipes above each
//   scopeSuggestion(dishId, scope, ctx)   the suggested allergens there, with evidence and gaps
//   recipeSuggestion(recipe, venueId, ctx)   a recipe's own (the recipe editor)
//   declaredOf(dish, tags)         the dish's declared allergens by standard key
//   dishCheck(dish, results, declared, names)   the differences, the scope groups, complete
//   fingerprint(differences)       what a decision holds for
//   nextCheck(stored, check)       what to do with a stored check: insert, update, delete, keep
//   acceptedLevels(declared, differences, keys)   the declaration after accepting
//   pickedDifferences(differences, keys)   the differences ticked, of those there now
//   checkState(row)                what a dish's check says in a list (CHECK_STATES)
//   checkCounts(rows)              how many of each
//
// Phase 8b (migrations 317 and 318): a change that could alter a suggestion
// opens the affected dishes' checks again (allergensChanged() in
// services/allergenCheckSvc.js, called where each change is saved):
//   CHANGE_KINDS, changeWords(change)   what changed, in words (Today, the check)
//   optionsUsing(itemIds, recipeIds, rules)    the option rules that bring those in
//   dishesToCheck(change, ctx)     the dishes a change can alter: dishesUsing()'s index (shared/priceCreep.js)
//                                  from items and recipes to dishes, the dishes offering an option
//                                  whose rule brings one of them in, and the dishes named
//   substituteKnown(line)          whether a delivery's substitute is a product on the list
//   SUBSTITUTE_DAYS                how long a substitute delivered counts at its venue

import { STANDARD_ALLERGENS, LEVEL_LABELS } from './menuTags.js'
import { usageOf, recipeUsage, offeredOptions, scopeText, needsCheck } from './costing.js'
import { ASSISTANT_NAME } from './assistant.js'
import { chooseQuote } from './procurement.js'
import { isCombo } from './combos.js'
import { needsAllergens } from './catalogue.js'
import { dishesUsing } from './priceCreep.js'

export const ALLERGEN_KEYS = STANDARD_ALLERGENS.map(a => a.key)
export const ALLERGEN_LABELS = Object.fromEntries(STANDARD_ALLERGENS.map(a => [a.key, a.label]))
// What a product's spec says of each allergen (the spec reader's answer).
export const SPEC_LEVELS = { contains: 'Contains', may_contain: 'May contain', free: 'Free from', not_said: 'Not said' }
export const CHECK_STATUSES = { open: 'Open', accepted: 'Accepted', dismissed: 'Dismissed' }
// What differs between the suggestion and the declaration.
export const DIFFERENCE_KINDS = {
  missing:     { label: 'Not declared', suggest: 'contains' },
  missing_may: { label: 'May contain, not declared', suggest: 'may_contain' },
  weaker:      { label: 'Declared as may contain only', suggest: 'contains' },
  not_found:   { label: 'Declared, not in the recipe', suggest: null },
  stronger:    { label: 'Declared as contains, the recipe only may contain', suggest: 'may_contain' },
}
export const SOURCE_MAX = 300
export const NOTE_MAX = 1000
const EVIDENCE_MAX = 12

const RANK = { may_contain: 1, contains: 2, removable: 2 }
const rank = level => RANK[level] || 0
const get = (coll, id) => (coll == null || id == null ? undefined : coll instanceof Map ? coll.get(id) : coll[id])
const label = key => ALLERGEN_LABELS[key] || key
const lowerLabel = key => label(key).toLowerCase()

// ── The product ───────────────────────────────────────────────

/**
 * A supplier product's allergens: { known, levels: { key: 'contains' |
 * 'may_contain' }, checked_at, checked_by, source }. Not checked is not
 * known (a gap), never "free from all 14"; a key both contains and may
 * contain counts as contains.
 */
export function quoteAllergens(q) {
  if (!q || !q.allergens_checked_at) return { known: false, levels: {}, checked_at: null, checked_by: null, source: null }
  const levels = {}
  for (const k of q.allergens_may_contain || []) if (ALLERGEN_KEYS.includes(k)) levels[k] = 'may_contain'
  for (const k of q.allergens_contains || []) if (ALLERGEN_KEYS.includes(k)) levels[k] = 'contains'
  return { known: true, levels, checked_at: q.allergens_checked_at, checked_by: q.allergens_checked_by ?? null, source: q.allergens_source ?? null }
}

/** Why a product's allergens can't be saved as sent ({ contains, may_contain }), or null. */
export function allergenListProblem({ contains = [], may_contain = [] } = {}) {
  for (const k of [...contains, ...may_contain]) {
    if (!ALLERGEN_KEYS.includes(k)) return '"' + k + '" isn\'t one of the 14 allergens'
  }
  const both = contains.find(k => may_contain.includes(k))
  if (both) return label(both) + ' can\'t be both contains and may contain: pick one'
  return null
}

/** A product's allergens in words: "Contains gluten, soya. May contain sesame." / "Free from all 14" / "Not known". */
export function productWords(a) {
  if (!a?.known) return 'Allergens not known'
  const of = lvl => ALLERGEN_KEYS.filter(k => a.levels[k] === lvl).map(lowerLabel)
  const has = of('contains'), may = of('may_contain')
  if (!has.length && !may.length) return 'None of the 14 allergens'
  return [has.length ? 'Contains ' + has.join(', ') : null, may.length ? 'May contain ' + may.join(', ') : null].filter(Boolean).join('. ')
}

// ── Where a dish can differ ───────────────────────────────────

/**
 * The scopes a dish's suggestion can differ at: at each venue it is sold at
 * (venueIds), the venue on its own and each link of the dish that applies
 * there (a revenue stream's, an order type's). Any other scope picks the
 * recipe of one of these (the closest link wins), so these hold every
 * recipe the dish can be made from. [{ venue_id, revenue_stream_id, order_type_id }].
 */
export function dishScopes(dish, ctx, venueIds = []) {
  const out = []
  const seen = new Set()
  const add = s => {
    const k = [s.venue_id, s.revenue_stream_id || '', s.order_type_id || ''].join('|')
    if (!seen.has(k)) { seen.add(k); out.push(s) }
  }
  const links = (ctx.links || []).filter(l => l.dish_id === dish?.id)
  for (const v of venueIds) {
    add({ venue_id: v, revenue_stream_id: null, order_type_id: null })
    for (const l of links) {
      if (l.venue_id && l.venue_id !== v) continue
      if (!l.revenue_stream_id && !l.order_type_id) continue
      add({ venue_id: v, revenue_stream_id: l.revenue_stream_id || null, order_type_id: l.order_type_id || null })
    }
  }
  return out
}

// ── The walk ──────────────────────────────────────────────────

const DRAFT_TEXT = r => r.name + ' is a draft ' + (r.source === 'reader' ? 'read in by ' : 'made by ') + ASSISTANT_NAME + ', not checked yet: lines that weren\'t matched are in its notes, so it may be missing ingredients'

/**
 * Every item a dish can hold at a scope, on usageOf()'s own walk: its recipe
 * there with the prep recipes inside, and what each option it offers adds or
 * swaps in (by its rule). { recipe ({ id, name } | null), entries: [{
 * item_id, via (the recipes above it, the dish's first), option (the
 * option's label, null for the recipe's own) }], gaps: [{ reason, text,
 * fix, option? }] (what leaves the list unknown: no recipe, a draft Pepper
 * wrote, an option that adds with no rule) }.
 */
export function dishItems(dishId, scope = {}, ctx = {}) {
  const dish = get(ctx.dishes, dishId)
  const out = { recipe: null, entries: [], gaps: [] }
  if (!dish) return out
  const seen = new Set()
  const drafts = new Set()
  const trace = option => ({
    item: e => {
      const key = e.item_id + '|' + e.via.join('>')
      if (seen.has(key)) return
      seen.add(key)
      out.entries.push({ item_id: e.item_id, via: e.via, option: option || null })
    },
    recipe: r => {
      if (needsCheck(r) && !drafts.has(r.id)) {
        drafts.add(r.id)
        out.gaps.push({ reason: 'draft', recipe_id: r.id, text: DRAFT_TEXT(r), fix: 'Open ' + r.name + ' on the Recipes page, check it and make it live.' })
      }
    },
  })
  const base = usageOf({ dish_id: dishId, qty: 1, options: [], typical: false }, scope, ctx, { trace: trace(null) })
  for (const g of base.uncosted) {
    if (g.reason === 'no_recipe') out.gaps.push({ reason: 'no_recipe', text: dish.name + ' has no recipe linked here', fix: 'Link it to its recipe on the Recipes page, Dishes tab.' })
    else if (g.reason === 'not_dish') out.gaps.push({ reason: 'not_dish', text: g.text, fix: g.fix })
  }
  out.recipe = base.recipe ? { id: base.recipe.id, name: base.recipe.name } : null
  if (!out.recipe) return out
  // A recipe with nothing in it says nothing about allergens: unknown, never free.
  // (A prep recipe linked as the dish is a not_dish gap already: its lines aren't walked.)
  if (!out.entries.length && !out.gaps.some(g => g.reason === 'not_dish')) out.gaps.push({ reason: 'empty', recipe_id: out.recipe.id, text: out.recipe.name + ' has no ingredients yet', fix: 'Add what goes into ' + out.recipe.name + ' on the Recipes page.' })
  for (const o of offeredOptions(dish, ctx)) {
    if (o.state === 'gap') {
      out.gaps.push({ reason: 'option', option: o.label, text: o.label + ': ' + (o.default_text || 'adds to the dish with no rule saying what'), fix: 'Give ' + o.label + ' a rule on the Recipes page, Options tab.' })
      continue
    }
    const rule = o.hit?.rule
    if (!rule || !['add', 'swap', 'recipe'].includes(rule.action)) continue
    usageOf({ dish_id: dishId, qty: 1, options: [{ option_id: o.option_id }], typical: false }, scope, ctx, { trace: trace(o.label) })
  }
  return out
}

/** An item's allergens at a venue, by the product chooseQuote() picks there: { quote, allergens } or { quote: null }. */
function productAt(itemId, venueId, ctx) {
  const pick = chooseQuote(get(ctx.quotes, itemId) || [], venueId ?? null, get(ctx.preferred, itemId) || {})
  return pick ? { quote: pick.quote, how: pick.how, allergens: quoteAllergens(pick.quote) } : { quote: null, how: null, allergens: null }
}

const productName = (q, item) => (q?.product_name || item?.name || 'a product')

// Where an ingredient's allergens are unknown, in words: " at Soho, Leeds", up to three names.
const placesText = names => (!names?.length ? '' : ' at ' + (names.length <= 3 ? names.join(', ') : names.slice(0, 3).join(', ') + ' and ' + (names.length - 3) + ' more'))
const ITEM_GAPS = new Set(['no_product', 'unknown'])

/** An unknown ingredient's gap in words, at its venues: "Allergens unknown for Tamarind at Soho, Leeds (Brakes: Tamarind)". */
function itemGapText(g) {
  if (g.reason === 'no_product') return 'Allergens unknown for ' + g.item + placesText(g.venues) + ': no supplier product'
  return 'Allergens unknown for ' + g.item + placesText(g.venues) + ' (' + [g.supplier, g.product].filter(Boolean).join(': ') + ')'
}

/**
 * A gap named at these venues (an unknown ingredient's names them; other
 * gaps are as they were): when scopes at several venues share a gap, it is
 * said at every one of them, not the first's alone.
 */
export function gapAt(gap, venueNames = []) {
  if (!ITEM_GAPS.has(gap.reason)) return gap
  const venues = [...new Set(venueNames.filter(Boolean))]
  return { ...gap, venues, text: itemGapText({ ...gap, venues }) }
}

// ── A substitute on receiving (phase 8b) ──────────────────────

/** How many days a substitute delivered counts at its venue (unless the item was delivered as ordered since). */
export const SUBSTITUTE_DAYS = 14
const norm = v => String(v ?? '').trim().toLowerCase()

/**
 * Whether what a delivery line marked Substituted brought is a product on the
 * list: the line's supplier price carries the code the invoice gave (or, with
 * no code, its name), as it does once the delivery's Update the price list
 * added it (the line then points at it). Else what came isn't recorded, so
 * its allergens are unknown. line: { invoice_code, invoice_name, quote: {
 * supplier_code, product_name } | null }.
 */
export function substituteKnown(line) {
  const q = line?.quote
  if (!q) return false
  if (norm(line.invoice_code)) return norm(line.invoice_code) === norm(q.supplier_code)
  if (norm(line.invoice_name)) return norm(line.invoice_name) === norm(q.product_name)
  return false
}

const dayWords = day => {
  if (!day) return ''
  const d = new Date(String(day).slice(0, 10) + 'T12:00:00Z')
  return Number.isNaN(d.getTime()) ? String(day) : d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
}

/** The substitutes delivered lately for an item at a venue (ctx.substitutes: Map 'item|venue' -> list). */
const substitutesAt = (itemId, venueId, ctx) => (venueId ? get(ctx.substitutes, itemId + '|' + venueId) || [] : [])

/** The entries' allergens at a venue: { levels, evidence: { key: [line] }, gaps }. */
function rollUp(entries, venueId, ctx, venueName) {
  const levels = {}
  const evidence = {}
  const gaps = []
  const venues = venueName ? [venueName] : []
  for (const e of entries) {
    const item = get(ctx.items, e.item_id)
    const line = { item_id: e.item_id, item: item?.name || 'An item that is gone', via: e.via, option: e.option }
    if (!item) {
      gaps.push({ ...line, reason: 'item_gone', text: 'An ingredient of ' + (e.via[0] || 'the recipe') + ' is no longer an inventory item', fix: 'Take the line out of the recipe, or pick what it should be.' })
      continue
    }
    const p = productAt(e.item_id, venueId, ctx)
    // The product the venue orders and (phase 8b) what a delivery brought instead lately: both may be in the kitchen.
    const products = []
    if (p.quote) products.push({ quote: p.quote, allergens: p.allergens, sub: null })
    else gaps.push(gapAt({ ...line, reason: 'no_product', fix: 'Add a supplier price for ' + item.name + ' with its allergens on the Inventory page.' }, venues))
    for (const s of substitutesAt(e.item_id, venueId, ctx)) {
      if (s.known && s.quote) {
        if (!p.quote || s.quote.id !== p.quote.id) products.push({ quote: s.quote, allergens: quoteAllergens(s.quote), sub: s })
        continue
      }
      const what = [s.supplier, s.product].filter(Boolean).join(': ')
      gaps.push({
        ...line, reason: 'substitute', supplier: s.supplier ?? null, product: s.product ?? null, day: s.day ?? null, venue: venueName,
        text: 'A substitute for ' + item.name + ' was delivered' + (venueName ? ' at ' + venueName : '') + (s.day ? ' on ' + dayWords(s.day) : '') + (what ? ' (' + what + ')' : '') + ': its allergens aren\'t known',
        fix: 'Add what came as a supplier price with its allergens (the delivery\'s Update the price list, Add), or check its label. It counts for ' + SUBSTITUTE_DAYS + ' days, or until ' + item.name + ' is delivered as ordered.',
      })
    }
    for (const pr of products) {
      const product = {
        quote_id: pr.quote.id, supplier: pr.quote.supplier_name ?? null, product: productName(pr.quote, item), code: pr.quote.supplier_code ?? null,
        ...(pr.sub ? { substitute: { day: pr.sub.day ?? null } } : {}),
      }
      if (!pr.allergens.known) {
        gaps.push(gapAt({ ...line, ...product, reason: 'unknown', fix: 'Add the allergens of ' + (product.supplier ? product.supplier + '\'s ' : '') + product.product + ' on the Inventory page (from its spec sheet).' }, venues))
        continue
      }
      for (const [key, lvl] of Object.entries(pr.allergens.levels)) {
        if (rank(lvl) > rank(levels[key])) levels[key] = lvl
        ;(evidence[key] ||= []).push({ ...line, ...product, level: lvl })
      }
    }
  }
  return { levels, evidence, gaps }
}

/**
 * A dish's suggested allergens at a scope: { scope, recipe, levels: { key:
 * 'contains' | 'may_contain' }, evidence: { key: [{ item_id, item, via,
 * option, quote_id, supplier, product, code, level }] }, gaps, complete }.
 * complete: it has a recipe there and every item's product is known.
 */
export function scopeSuggestion(dishId, scope = {}, ctx = {}) {
  const walk = dishItems(dishId, scope, ctx)
  const venueName = scope.venue_id ? ctx.names?.venues?.[scope.venue_id] || null : null
  const r = rollUp(walk.entries, scope.venue_id ?? null, ctx, venueName)
  const gaps = [...walk.gaps, ...r.gaps]
  return { scope, recipe: walk.recipe, levels: r.levels, evidence: r.evidence, gaps, items: walk.entries.length, complete: !!walk.recipe && !gaps.length }
}

/**
 * A recipe's own suggested allergens at a venue (the recipe editor): its
 * lines and prep recipes inside, on recipeUsage()'s walk. { levels,
 * evidence, gaps, complete }.
 */
export function recipeSuggestion(recipe, venueId = null, ctx = {}) {
  const entries = []
  const seen = new Set()
  const gaps = []
  const drafts = new Set()
  recipeUsage(recipe, null, ctx, {
    trace: {
      item: e => {
        const key = e.item_id + '|' + e.via.join('>')
        if (!seen.has(key)) { seen.add(key); entries.push({ item_id: e.item_id, via: e.via, option: null }) }
      },
      recipe: r => {
        if (needsCheck(r) && !drafts.has(r.id)) { drafts.add(r.id); gaps.push({ reason: 'draft', recipe_id: r.id, text: DRAFT_TEXT(r), fix: 'Check it and make it live.' }) }
      },
    },
  })
  const venueName = venueId ? ctx.names?.venues?.[venueId] || null : null
  const r = rollUp(entries, venueId, ctx, venueName)
  const all = [...gaps, ...r.gaps]
  return { venue_id: venueId, levels: r.levels, evidence: r.evidence, gaps: all, items: entries.length, complete: entries.length > 0 && !all.length }
}

// ── The declaration ───────────────────────────────────────────

/**
 * A dish's declared allergens by standard key: { key: 'contains' |
 * 'may_contain' | 'removable' }, from its tag codes (dietary) and levels
 * (allergen_levels), through the group's tags (menu_dietary_tags: code,
 * standard_key). A tag that isn't one of the 14 is left out.
 */
export function declaredOf(dish, tags = []) {
  const keyOf = new Map((tags || []).filter(t => ALLERGEN_KEYS.includes(t.standard_key)).map(t => [t.code, t.standard_key]))
  const out = {}
  for (const code of dish?.dietary || []) {
    const key = keyOf.get(code)
    if (key) out[key] = (dish.allergen_levels || {})[code] || 'contains'
  }
  return out
}

/** A declared or suggested level in words: "contains", "may contain", "can be removed", "not declared". */
export const levelWords = level => (level ? (LEVEL_LABELS[level] || level).toLowerCase() : 'not declared')

// ── The check ─────────────────────────────────────────────────

const scopeKey = s => [s.venue_id || '', s.revenue_stream_id || '', s.order_type_id || ''].join('|')

// Scopes with the same suggestion, evidence and gaps are one group, named together.
function groupScopes(results, names) {
  const groups = new Map()
  for (const r of results) {
    const sig = JSON.stringify([
      r.recipe?.id || null,
      ALLERGEN_KEYS.map(k => r.levels[k] || ''),
      ALLERGEN_KEYS.map(k => (r.evidence[k] || []).map(e => e.quote_id + e.item_id).sort()),
      r.gaps.map(g => g.reason + (g.item_id || '') + (g.option || '') + (g.reason === 'substitute' ? g.text : '')).sort(),
    ])
    if (!groups.has(sig)) groups.set(sig, { ...r, scopes: [] })
    groups.get(sig).scopes.push(r.scope)
  }
  return [...groups.values()].map(g => {
    // The group's gaps are its first scope's: an unknown ingredient is named at every venue of the group.
    const venues = g.scopes.map(s => names?.venues?.[s.venue_id]).filter(Boolean)
    return {
      where: g.scopes.map(s => scopeText(s, names)),
      scopes: g.scopes,
      recipe: g.recipe,
      levels: g.levels,
      evidence: Object.fromEntries(Object.entries(g.evidence).map(([k, list]) => [k, list.slice(0, EVIDENCE_MAX)])),
      gaps: g.gaps.map(x => gapAt(x, venues)),
      complete: g.complete,
    }
  })
}

/** One line of evidence in words: "Oyster sauce in Tamarind sauce (Brakes: Lee Kum Kee oyster sauce)". */
export function evidenceWords(e) {
  const via = (e.via || []).slice(1)
  const where = e.option ? ' with ' + e.option : via.length ? ' in ' + via.join(' in ') : ''
  const product = [e.supplier, e.product && e.product !== e.item ? e.product : null].filter(Boolean).join(': ')
  // Phase 8b: a product a delivery brought instead of the one ordered.
  const sub = e.substitute ? 'a substitute delivered' + (e.substitute.day ? ' ' + dayWords(e.substitute.day) : '') : ''
  const said = [product, sub].filter(Boolean).join(', ')
  return e.item + where + (said ? ' (' + said + ')' : '') + (e.level === 'may_contain' ? ', may contain' : '')
}

/**
 * The check of a dish (rule 12): its suggestion at each scope (results, from
 * scopeSuggestion()) against its declaration (declaredOf()). Returns {
 * checkable (some scope has a recipe), complete (every scope known),
 * suggested ({ key: level }: the strongest over the scopes), declared,
 * differences: [{ allergen, label, kind, suggested, declared, where (the
 * scopes whose recipe has it, in words), evidence: [line], text }], groups
 * (the scopes grouped by what they suggest), gaps (each once) }.
 */
export function dishCheck(dish, results = [], declared = {}, names = {}) {
  const withRecipe = results.filter(r => r.recipe)
  const suggested = {}
  for (const r of withRecipe) for (const [k, lvl] of Object.entries(r.levels)) if (rank(lvl) > rank(suggested[k])) suggested[k] = lvl
  const complete = results.length > 0 && results.every(r => r.complete)
  const groups = groupScopes(results, names)
  // Each gap once, at every place it is: an unknown ingredient (the same product) named at all its venues.
  const gapSeen = new Map()
  const gaps = []
  for (const g of groups) {
    for (const x of g.gaps) {
      const k = ITEM_GAPS.has(x.reason)
        ? x.reason + '|' + x.item_id + '|' + (x.quote_id || '')
        : x.reason + '|' + (x.item_id || x.recipe_id || x.option || '') + '|' + x.text
      const hit = gapSeen.get(k)
      if (hit) {
        for (const w of g.where) if (!hit.where.includes(w)) hit.where.push(w)
        if (ITEM_GAPS.has(x.reason)) Object.assign(hit, gapAt(hit, [...(hit.venues || []), ...(x.venues || [])]))
        continue
      }
      const line = { ...x, where: [...g.where] }
      gapSeen.set(k, line)
      gaps.push(line)
    }
  }
  const differences = []
  if (withRecipe.length) {
    for (const key of ALLERGEN_KEYS) {
      const s = suggested[key] || null
      const d = declared[key] || null
      let kind = null
      if (s === 'contains' && !d) kind = 'missing'
      else if (s === 'may_contain' && !d) kind = 'missing_may'
      else if (s === 'contains' && d === 'may_contain') kind = 'weaker'
      else if (d && !s && complete) kind = 'not_found'
      else if (d === 'contains' && s === 'may_contain' && complete) kind = 'stronger'
      if (!kind) continue
      const having = groups.filter(g => g.levels[key])
      // The same line through the same product at several scope groups is one line of evidence, with all their places.
      const evidence = []
      const seen = new Map()
      for (const g of having) {
        for (const e of g.evidence[key] || []) {
          const k = [e.item_id, e.quote_id, e.via.join('>'), e.option || '', e.level].join('|')
          const hit = seen.get(k)
          if (hit) { for (const w of g.where) if (!hit.where.includes(w)) hit.where.push(w); continue }
          const line = { ...e, where: [...g.where] }
          seen.set(k, line)
          evidence.push(line)
        }
      }
      evidence.splice(EVIDENCE_MAX)
      differences.push({
        allergen: key, label: label(key), kind, suggested: s, declared: d,
        where: having.flatMap(g => g.where), evidence,
        text: differenceText(key, kind, s, d),
      })
    }
  }
  return { dish_id: dish?.id ?? null, checkable: withRecipe.length > 0, complete, suggested, declared, differences, groups, gaps }
}

/** A difference in words, as the page and Pepper say it. */
export function differenceText(key, kind, s, d) {
  const a = lowerLabel(key)
  switch (kind) {
    case 'missing': return 'The recipe has ' + a + '; the dish does not say so'
    case 'missing_may': return 'The recipe may contain ' + a + '; the dish does not say so'
    case 'weaker': return 'The recipe has ' + a + '; the dish says only may contain'
    case 'not_found': return 'The dish declares ' + a + (d && d !== 'contains' ? ' (' + levelWords(d) + ')' : '') + '; nothing in the recipe has it'
    case 'stronger': return 'The dish says it contains ' + a + '; the recipe only may contain it'
    default: return a
  }
}

/** The differences' fingerprint: a decision holds while it is the same (the evidence aside). */
export function fingerprint(differences = []) {
  return differences.map(d => [d.allergen, d.kind, d.suggested || '', d.declared || ''].join(':')).sort().join('|')
}

/**
 * What to do with a dish's stored check now that it was worked out again:
 * { op: 'none' | 'insert' | 'update' | 'delete', status, reopened }. No
 * differences: no row, except an accepted one, kept as the record of who
 * accepted. Differences: a new one is open; an open one stays open; a
 * dismissed one holds while its differences are the same (else it opens
 * again); an accepted one with differences again (the draft was put back,
 * or something changed) opens again.
 */
export function nextCheck(stored, check) {
  const diffs = check?.checkable ? check.differences : []
  if (!diffs.length) {
    if (!stored) return { op: 'none', status: null, reopened: false }
    if (stored.status === 'accepted') return { op: 'update', status: 'accepted', reopened: false }
    return { op: 'delete', status: null, reopened: false }
  }
  if (!stored) return { op: 'insert', status: 'open', reopened: false }
  if (stored.status === 'open') return { op: 'update', status: 'open', reopened: false }
  if (stored.status === 'dismissed' && stored.fingerprint === fingerprint(diffs)) return { op: 'update', status: 'dismissed', reopened: false }
  return { op: 'update', status: 'open', reopened: true }
}

/**
 * The declaration after accepting differences (all of them, or the keys
 * named): { key: level | null } for each key that changes (null: taken off).
 * A removable allergen stays removable when the recipe has it.
 */
export function acceptedLevels(declared = {}, differences = [], keys = null) {
  const out = {}
  for (const d of differences) {
    if (keys && !keys.includes(d.allergen)) continue
    out[d.allergen] = DIFFERENCE_KINDS[d.kind] ? DIFFERENCE_KINDS[d.kind].suggest : declared[d.allergen] ?? null
  }
  return out
}

/**
 * The differences ticked (keys: a Set or a list of allergen keys), of those
 * there are now: a key ticked on a check that has since changed is dropped,
 * so a person accepts only what is in front of them.
 */
export function pickedDifferences(differences = [], keys = []) {
  const want = keys instanceof Set ? keys : new Set(keys || [])
  return differences.filter(d => want.has(d.allergen))
}

/**
 * What a dish's check says in a list (rule 12: the tab, its counts and
 * Pepper): a stored decision (open, accepted, dismissed); else, with a
 * recipe, 'agree' only when every product is known, and 'incomplete' while
 * anything is unknown (nothing differs among what is known, but an unknown
 * product may hold an allergen: never a pass); 'not_checkable' with no
 * recipe anywhere. row: { checkable, complete, status } (checkView()'s).
 */
export function checkState(row) {
  if (!row?.checkable) return 'not_checkable'
  if (row.status) return row.status
  return row.complete ? 'agree' : 'incomplete'
}
export const CHECK_STATES = {
  open: 'Open', incomplete: 'Not all known', dismissed: 'Dismissed', accepted: 'Accepted', agree: 'Agrees', not_checkable: 'Can\'t check yet',
}

/** A check's counts for a list: { open, incomplete, accepted, dismissed, agree, not_checkable }. */
export function checkCounts(rows = []) {
  const c = { open: 0, incomplete: 0, accepted: 0, dismissed: 0, agree: 0, not_checkable: 0 }
  for (const r of rows) c[checkState(r)]++
  return c
}

/** Whether a dish is one the check is for: food on a menu, not a meal deal (its allergens are its dishes'). */
export const checksDish = dish => !!dish && !isCombo(dish) && needsAllergens(dish.item_type || 'food')


// ── Opened again on a change (phase 8b) ───────────────────────

/**
 * What can change a dish's suggestion (the reopened check's `change` and
 * Today's card say which). Each is called from where the change is saved
 * (allergensChanged() in services/allergenCheckSvc.js).
 */
export const CHANGE_KINDS = {
  quote: 'A supplier price added, changed or switched off',
  quote_allergens: 'A product\'s allergens saved',
  preferred: 'The usual supplier switched',
  substitute: 'A substitute delivered',
  recipe: 'A recipe changed',
  link: 'Which recipe a dish uses changed',
  option_rule: 'An option\'s rule changed',
  item: 'An inventory item changed',
  supplier: 'A supplier switched off or on',
}
export const CHANGE_KIND_KEYS = Object.keys(CHANGE_KINDS)

const few = list => {
  const l = [...new Set((list || []).filter(Boolean))]
  return l.length <= 2 ? l.join(', ') : l.slice(0, 2).join(', ') + ' and ' + (l.length - 2) + ' more'
}

/**
 * A change in words: "Oyster sauce: the usual supplier switched at Leeds",
 * "Pad thai sauce changed". change: { kind, items, recipes, dishes, options,
 * venues (names), supplier, on }. Up to two names, then "and N more".
 */
export function changeWords(change = {}) {
  const at = change.venues?.length ? ' at ' + few(change.venues) : ''
  const items = few(change.items)
  const recipes = few(change.recipes)
  switch (change.kind) {
    case 'quote': return (items ? items + ': a supplier price added, changed or switched off' : 'A supplier price changed') + at
    case 'quote_allergens': return (items ? items + ': ' : '') + 'a product\'s allergens saved' + (change.supplier ? ' (' + change.supplier + ')' : '')
    case 'preferred': return (items ? items + ': ' : '') + 'the usual supplier switched' + at
    case 'substitute': return (items ? items + ': ' : '') + 'a substitute delivered' + at
    case 'recipe': return recipes ? recipes + ' changed' : 'A recipe changed'
    case 'link': return 'Which recipe ' + (change.dishes?.length ? few(change.dishes) : 'a dish') + ' uses changed'
    case 'option_rule': return (change.options?.length ? few(change.options) + ': ' : '') + 'an option\'s rule changed'
    case 'item': return (items || 'An inventory item') + ' changed'
    case 'supplier': return (change.supplier || 'A supplier') + ' switched ' + (change.on ? 'on' : 'off')
    default: return 'Something it uses changed'
  }
}

/**
 * The option rules that bring these items or recipes into a dish (adds,
 * swaps in, is a recipe): { optionIds: Set, dishIds: Set (a rule for one
 * dish only) }. rules: recipe_option_rules rows.
 */
export function optionsUsing(itemIds = [], recipeIds = [], rules = []) {
  const items = new Set((itemIds || []).filter(Boolean))
  const recipes = new Set((recipeIds || []).filter(Boolean))
  const optionIds = new Set()
  const dishIds = new Set()
  for (const r of rules || []) {
    const hit = (r.item_id && items.has(r.item_id)) || (r.swap_item_id && items.has(r.swap_item_id))
      || (r.sub_recipe_id && recipes.has(r.sub_recipe_id)) || (r.recipe_id && recipes.has(r.recipe_id))
    if (!hit) continue
    if (r.dish_id) dishIds.add(r.dish_id)
    else if (r.option_id) optionIds.add(r.option_id)
  }
  return { optionIds, dishIds }
}

/**
 * The menu dishes a change can alter (rule 12: price creep's index, never
 * another walk): the dishes whose recipes use the items or recipes changed
 * (dishesUsing(), up through the prep recipes they sit in), the dishes
 * offering an option whose rule brings one of them in (or whose own rule
 * changed: optionIds), and the dishes named. Meal deals aren't checked
 * (their allergens are their dishes'), so dealsHolding() has nothing to add.
 * change: { itemIds, recipeIds, dishIds, optionIds }; ctx: the check's dish
 * ctx (recipes, links, rules, options, dishes). -> Set of the ctx's dish ids.
 */
export function dishesToCheck(change = {}, ctx = {}) {
  const used = dishesUsing(change.itemIds || [], ctx.recipes || new Map(), ctx.links || [], { recipeIds: change.recipeIds || [] })
  const out = new Set([...used.dishIds, ...(change.dishIds || []).filter(Boolean)])
  const opts = optionsUsing(change.itemIds || [], [...used.recipeIds], ctx.rules || [])
  for (const id of opts.dishIds) out.add(id)
  const optionIds = new Set([...opts.optionIds, ...(change.optionIds || []).filter(Boolean)])
  const dishes = ctx.dishes instanceof Map ? ctx.dishes : new Map(Object.entries(ctx.dishes || {}))
  if (optionIds.size) {
    for (const d of dishes.values()) if (offeredOptions(d, ctx).some(o => optionIds.has(o.option_id))) out.add(d.id)
  }
  return new Set([...out].filter(id => dishes.has(id)))
}
