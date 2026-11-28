// shared/calorieCheck.js
//
// Suggested calories (inventory phase 8b, migration 318; docs/INVENTORY.md
// 8.3), as a check on what each dish declares (menu_items.calories). Plain
// ESM, no database: the API loads the rows (services/allergenCheckSvc.js)
// and the Recipes page's Allergens tab, the recipe editor and the reports
// read these (rule 12).
//
// An inventory item has its energy: kcal per 100 g (per 100 ml for an item
// kept in millilitres), or per one for an item kept in each (inv_items
// kcal_per_100g, kcal_each). Of the part that goes in: a recipe line's
// quantity is what is used (the trimmed onion), so the energy is the line's
// usable quantity x the item's figure, never what is bought. A prep recipe
// gives its share of the batch (cooking loss drives water off, not energy:
// the batch's energy is shared over what it makes). One serving of a dish is
// its recipe at a scope (recipeFor() through the links) times the link's
// portions, without options (what is declared is the dish as served;
// options and extras are not counted). The walk is the cost engine's own
// (usageOf() / recipeUsage() in shared/costing.js with a trace that carries
// the usable quantity): never another one.
//
// Unknown is never a pass: an item with no energy figure, a line with no
// quantity the item knows (a unit with no size), a prep recipe that doesn't
// say how much it makes, a draft Pepper read in, a dish with no recipe: all
// are gaps, and a dish with gaps has no suggestion, only "at least" what is
// known (enough to say a declaration is too low).
//
// A dish has one declared figure on its menu, so the suggestion is the
// highest of its scopes' figures (the scopes are the allergen check's,
// dishScopes()), with the range shown; a declared figure agrees within the
// tolerance (CALORIE_TOLERANCE: 10% or 10 kcal, the app's rule of thumb for
// a figure worked out from recipes, not a legal tolerance).
//
//   energyOf(item)                 { known, per_base (kcal a base unit), per: '100 g' | '100 ml' | 'each', figure }
//   energyProblem(item, body)      why an item's energy can't be saved as sent, or null
//   energyWords(item)              "250 kcal per 100 g" / "Energy not known"
//   dishEnergy(dishId, scope, ctx) one serving's energy at a scope: { recipe, kcal, known_kcal, lines, gaps, complete }
//   recipeEnergy(recipe, ctx)      a recipe's own: a portion (a dish recipe), or one of what it makes (a prep;
//                                  per 100 g or 100 ml of one made in grams or millilitres)
//   calorieCheck(dish, results, declared, names)   the difference, the scope groups, complete
//   withinTolerance(declared, suggested)
//   calorieFingerprint(check)      what a decision is checked against (409 when it moved)
//   nextCalorieCheck(stored, check)   what to do with a stored check: insert, update, delete, keep
//   calorieMoved(fingerprint, check)  whether an open check's difference moved (a change marks it then)
//   calorieWords(check)            the difference in words

import { usageOf, recipeUsage, scopeText, recipeUnit, unitWord } from './costing.js'

export const CALORIE_TOLERANCE = { pct: 10, kcal: 10 }
export const KCAL_MAX_100G = 900
export const KCAL_MAX_EACH = 100000
export const KCAL_SOURCE_MAX = 300
export const CALORIE_KINDS = {
  missing: { label: 'No calories declared' },
  differs: { label: 'The declared figure differs' },
  under: { label: 'Declared below what is known' },
}
export const CALORIE_GAPS = {
  no_energy: 'An ingredient has no energy figure',
}
const LINES_KEPT = 12

const get = (coll, id) => (coll == null || id == null ? undefined : coll instanceof Map ? coll.get(id) : coll[id])
const num = v => (v == null || v === '' ? null : Number(v))
const round = n => (n == null ? null : Math.round(Number(n)))
const fmt = n => (n == null ? '' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: 1 }))

// ── The item ──────────────────────────────────────────────────

/**
 * An item's energy: { known, per_base (kcal a gram, a millilitre or one),
 * per ('100 g' | '100 ml' | 'each'), figure (as typed) }. A figure for the
 * other kind of unit (per 100 g on an item kept in each) is not its energy.
 */
export function energyOf(item) {
  const each = item?.base_unit === 'each'
  const per = each ? 'each' : item?.base_unit === 'ml' ? '100 ml' : '100 g'
  const figure = num(each ? item?.kcal_each : item?.kcal_per_100g)
  if (figure == null || !Number.isFinite(figure) || figure < 0) return { known: false, per_base: null, per, figure: null }
  return { known: true, per_base: each ? figure : figure / 100, per, figure }
}

/** Why an item's energy can't be saved (body: { kcal_per_100g, kcal_each }), or null. */
export function energyProblem(item, body = {}) {
  const each = item?.base_unit === 'each'
  const a = num(body.kcal_per_100g)
  const b = num(body.kcal_each)
  if (each && a != null) return (item?.name || 'This item') + ' is counted in each: give its energy for one'
  if (!each && b != null) return (item?.name || 'This item') + ' is measured in ' + (item?.base_unit === 'ml' ? 'millilitres: give its energy per 100 ml' : 'grams: give its energy per 100 g')
  if (a != null && (a < 0 || a > KCAL_MAX_100G)) return 'Energy per 100 is between 0 and ' + KCAL_MAX_100G + ' kcal (pure fat is about 900)'
  if (b != null && (b < 0 || b > KCAL_MAX_EACH)) return 'Energy for one is between 0 and ' + KCAL_MAX_EACH + ' kcal'
  return null
}

/** An item's energy in words: "250 kcal per 100 g", "90 kcal each", "Energy not known". */
export function energyWords(item) {
  const e = energyOf(item)
  if (!e.known) return 'Energy not known'
  return fmt(e.figure) + ' kcal ' + (e.per === 'each' ? 'each' : 'per ' + e.per)
}

// ── The walk ──────────────────────────────────────────────────

// usageOf()'s gaps that leave a serving's quantities unknown (its own words).
const QTY_GAPS = new Set(['no_recipe', 'not_dish', 'empty', 'no_yield', 'draft', 'missing', 'no_unit', 'cycle', 'too_deep'])

/** Entries (the trace's: { item_id, via, qty }) to energy: { kcal (known part), lines, gaps }. */
function energyOfEntries(entries, ctx) {
  const byItem = new Map()
  const gaps = []
  const noted = new Set()
  let kcal = 0
  for (const e of entries) {
    const item = get(ctx.items, e.item_id)
    if (!item) continue
    if (e.qty == null) continue
    const en = energyOf(item)
    if (!en.known) {
      if (!noted.has(item.id)) {
        noted.add(item.id)
        gaps.push({
          reason: 'no_energy', item_id: item.id, item: item.name,
          text: item.name + ' has no energy figure', fix: 'Put in its kcal per ' + en.per + ' on the Inventory page (from its label or spec sheet).',
        })
      }
      continue
    }
    const k = e.qty * en.per_base
    kcal += k
    const line = byItem.get(item.id) || { item_id: item.id, item: item.name, via: e.via, qty_base: 0, base_unit: item.base_unit, kcal: 0 }
    line.qty_base += e.qty
    line.kcal += k
    byItem.set(item.id, line)
  }
  const lines = [...byItem.values()].map(l => ({ ...l, qty_base: Math.round(l.qty_base * 100) / 100, kcal: Math.round(l.kcal * 10) / 10 }))
    .sort((a, b) => b.kcal - a.kcal || a.item.localeCompare(b.item))
  return { kcal, lines, gaps }
}

/**
 * One serving of a dish at a scope (no options): { scope, recipe ({ id, name }
 * | null), kcal (whole kcal, null unless complete), known_kcal (what is known
 * so far, whole kcal), lines: [{ item_id, item, via, qty_base, base_unit,
 * kcal }] (biggest first), gaps, complete }.
 */
export function dishEnergy(dishId, scope = {}, ctx = {}) {
  const entries = []
  const u = usageOf({ dish_id: dishId, qty: 1, options: [], typical: false }, scope, ctx, { trace: { item: e => entries.push(e) } })
  const recipe = u.recipe && u.kind === 'dish' ? { id: u.recipe.id, name: u.recipe.name } : null
  const out = energyOfEntries(entries, ctx)
  const gaps = [...u.uncosted.filter(g => QTY_GAPS.has(g.reason)).map(g => ({ reason: g.reason, text: g.text, fix: g.fix, recipe_id: g.recipe_id ?? null })), ...out.gaps]
  if (!recipe && !gaps.some(g => g.reason === 'no_recipe' || g.reason === 'not_dish')) {
    gaps.unshift({ reason: 'no_recipe', text: (get(ctx.dishes, dishId)?.name || 'The dish') + ' has no recipe linked here', fix: 'Link it to its recipe on the Recipes page, Dishes tab.' })
  }
  const complete = !!recipe && !gaps.length
  return { scope, recipe, kcal: complete ? round(out.kcal) : null, known_kcal: recipe ? round(out.kcal) : null, lines: out.lines.slice(0, LINES_KEPT), more_lines: Math.max(0, out.lines.length - LINES_KEPT), gaps, complete }
}

// A prep made in grams or millilitres is said per 100 of them, as an item's energy is (energyOf()):
// one gram's figure rounded to whole kcal would be badly wrong (1.48 kcal a gram is not 1).
const PER_100 = { g: 'per 100 g', ml: 'per 100 ml' }

/**
 * A recipe's own energy (the recipe editor): a portion of a dish recipe, or
 * of what a prep recipe makes: one (a litre, a kilo, each), or 100 g or
 * 100 ml of a prep made in grams or millilitres. { per (words: 'a portion',
 * 'a kg', 'each', 'per 100 g'), qty (how much of the recipe's unit that is),
 * kcal, known_kcal, lines, gaps, complete }.
 */
export function recipeEnergy(recipe, ctx = {}) {
  const entries = []
  const unit = recipeUnit(recipe)
  const qty = recipe?.kind === 'prep' && PER_100[unit] ? 100 : 1
  const u = recipeUsage(recipe, qty, ctx, { trace: { item: e => entries.push(e), recipe: () => {} } })
  const out = energyOfEntries(entries, ctx)
  const gaps = [...u.uncosted.filter(g => QTY_GAPS.has(g.reason)).map(g => ({ reason: g.reason, text: g.text, fix: g.fix })), ...out.gaps]
  const per = recipe?.kind === 'prep' ? (PER_100[unit] || (unit === 'each' ? 'each' : 'a ' + unitWord(unit))) : 'a portion'
  const complete = !!recipe && entries.length > 0 && !gaps.length
  return { per, qty, kcal: complete ? round(out.kcal) : null, known_kcal: round(out.kcal), lines: out.lines.slice(0, LINES_KEPT), gaps, complete }
}

// ── The check ─────────────────────────────────────────────────

/** Whether a declared figure agrees with a suggestion: within CALORIE_TOLERANCE (10%, at least 10 kcal). */
export function withinTolerance(declared, suggested) {
  if (declared == null || suggested == null) return false
  const room = Math.max(Math.abs(Number(suggested)) * CALORIE_TOLERANCE.pct / 100, CALORIE_TOLERANCE.kcal)
  return Math.abs(Number(declared) - Number(suggested)) <= room
}

/** The difference in words, as the page, Today and the reports say it. */
export function calorieWords(d) {
  if (!d) return ''
  switch (d.kind) {
    case 'missing': return 'The recipe comes to ' + fmt(d.suggested) + ' kcal; the dish declares no calories'
    case 'differs': return 'The recipe comes to ' + fmt(d.suggested) + ' kcal; the dish declares ' + fmt(d.declared) + ' kcal'
    case 'under': return 'What is known already comes to ' + fmt(d.lower) + ' kcal; the dish declares ' + fmt(d.declared) + ' kcal'
    default: return ''
  }
}

/**
 * The calorie check of a dish (rule 12): each scope's serving (results, from
 * dishEnergy()) against its declared figure. { checkable (some scope has a
 * recipe), complete (every scope known), suggested (the highest scope's
 * figure, when complete), min, max (over the scopes known), lower (at least:
 * the highest known part), declared, spread (the scopes differ by more than
 * the tolerance), difference ({ kind, suggested, declared, lower, text } |
 * null), groups (the scopes grouped by what they give), gaps (each once) }.
 */
export function calorieCheck(dish, results = [], declared = null, names = {}) {
  const withRecipe = results.filter(r => r.recipe)
  const complete = results.length > 0 && results.every(r => r.complete)
  const known = withRecipe.filter(r => r.complete).map(r => r.kcal)
  const min = known.length ? Math.min(...known) : null
  const max = known.length ? Math.max(...known) : null
  const suggested = complete ? max : null
  const lower = withRecipe.length ? Math.max(...withRecipe.map(r => r.known_kcal ?? 0)) : null
  const dec = declared == null || declared === '' ? null : Math.round(Number(declared))
  let difference = null
  if (withRecipe.length) {
    if (complete && dec == null) difference = { kind: 'missing', suggested, declared: null, lower }
    else if (complete && !withinTolerance(dec, suggested)) difference = { kind: 'differs', suggested, declared: dec, lower }
    else if (!complete && dec != null && lower != null && lower > dec && !withinTolerance(dec, lower)) difference = { kind: 'under', suggested: null, declared: dec, lower }
  }
  if (difference) difference.text = calorieWords(difference)
  // Scopes with the same recipe, figure and gaps are one group, named together.
  const groups = new Map()
  for (const r of results) {
    const sig = JSON.stringify([r.recipe?.id || null, r.kcal, r.known_kcal, r.gaps.map(g => g.reason + (g.item_id || g.recipe_id || '') + g.text).sort()])
    if (!groups.has(sig)) groups.set(sig, { recipe: r.recipe, kcal: r.kcal, known_kcal: r.known_kcal, lines: r.lines, more_lines: r.more_lines || 0, gaps: r.gaps, complete: r.complete, scopes: [] })
    groups.get(sig).scopes.push(r.scope)
  }
  const list = [...groups.values()].map(g => ({ ...g, where: g.scopes.map(s => scopeText(s, names)) }))
  const seen = new Map()
  const gaps = []
  for (const g of list) {
    for (const x of g.gaps) {
      const k = x.reason + '|' + (x.item_id || x.recipe_id || '') + '|' + x.text
      const hit = seen.get(k)
      if (hit) { for (const w of g.where) if (!hit.where.includes(w)) hit.where.push(w); continue }
      const line = { ...x, where: [...g.where] }
      seen.set(k, line)
      gaps.push(line)
    }
  }
  return {
    dish_id: dish?.id ?? null, checkable: withRecipe.length > 0, complete, suggested, min, max, lower, declared: dec,
    spread: min != null && max != null && !withinTolerance(min, max), difference, groups: list, gaps,
  }
}

/** What a decision is checked against: the difference as the person saw it. */
export function calorieFingerprint(check) {
  const d = check?.checkable ? check.difference : null
  return d ? [d.kind, d.declared ?? '', d.suggested ?? '', d.lower ?? ''].join(':') : ''
}

/**
 * What to do with a dish's stored calorie check now that it was worked out
 * again: { op: 'none' | 'insert' | 'update' | 'delete', status, reopened }.
 * No difference: no row, except an accepted one (the record of who
 * accepted). A difference: a new one is open; an open one stays open; a
 * dismissed one holds while it is the same kind, the declared figure is the
 * same and the suggestion stays within the tolerance of the figure
 * dismissed (decided_kcal), else it opens again; an accepted one with a
 * difference again opens again.
 */
export function nextCalorieCheck(stored, check) {
  const d = check?.checkable ? check.difference : null
  if (!d) {
    if (!stored) return { op: 'none', status: null, reopened: false }
    if (stored.status === 'accepted') return { op: 'update', status: 'accepted', reopened: false }
    return { op: 'delete', status: null, reopened: false }
  }
  if (!stored) return { op: 'insert', status: 'open', reopened: false }
  if (stored.status === 'open') return { op: 'update', status: 'open', reopened: false }
  if (stored.status === 'dismissed' && stored.kind === d.kind && (stored.declared_kcal ?? null) === (d.declared ?? null)
    && (stored.decided_kcal == null ? (d.suggested ?? d.lower) == null : withinTolerance(d.suggested ?? d.lower, stored.decided_kcal))) {
    return { op: 'update', status: 'dismissed', reopened: false }
  }
  return { op: 'update', status: 'open', reopened: true }
}

/**
 * Whether an open check's difference moved since it was kept (its stored
 * fingerprint): another kind, another declared figure, or the figure past
 * the tolerance of what was kept. A change marks an open check (Today) only
 * then, so a gram of salt doesn't bring a check back to Today.
 */
export function calorieMoved(storedFingerprint, check) {
  const d = check?.checkable ? check.difference : null
  if (!d) return !!storedFingerprint
  if (!storedFingerprint) return true
  const [kind, dec, sug, low] = String(storedFingerprint).split(':')
  if (kind !== d.kind || dec !== String(d.declared ?? '')) return true
  const was = sug !== '' ? Number(sug) : low !== '' ? Number(low) : null
  return !withinTolerance(d.suggested ?? d.lower, was)
}
