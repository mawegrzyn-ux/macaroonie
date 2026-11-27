// src/services/allergenCheckSvc.js
//
// The allergen check (inventory phase 8a, migration 316; docs/INVENTORY.md
// 8.3, decision D6): each food dish on the group's menus, its suggested
// allergens (the roll-up through its recipes at each venue's supplier
// products) against what it declares in the menu's draft, worked out when
// the Recipes page's Allergens tab or Pepper asks and stored in
// allergen_checks so a person's decision holds. The rules are
// shared/allergenCheck.js; nothing here works an allergen out itself, and
// nothing here changes a declaration (accepting goes through the menus
// area's own save route, in routes/allergenChecks.js).
//
//   loadAllergenCtx(tx, tenantId)   what the check reads, once per request:
//                                   the draft and live menus, the tags, the
//                                   venues and the cost engine's dish ctx
//   workOut(bundle, { dishIds })    each dish's check, not stored
//   storeChecks(tx, tenantId, rows, { by })   what nextCheck() says, under a
//                                   per-group lock; returns the rows with
//                                   their stored status
//   checkRows(tx, tenantId, { dishIds, store, by })  both, the list's rows
//   loadRecipeSuggestion(tx, tenantId, recipeId)     a recipe's own, per venue
//   (checks whose dish is on no menu go in the nightly recipe links sweep,
//   sweepTenantLinks() in dishCostSvc.js)

import { loadDishCosting, menusFor } from './dishCostSvc.js'
import { dishMap } from '../../../shared/costing.js'
import {
  dishScopes, scopeSuggestion, declaredOf, dishCheck, fingerprint, nextCheck, recipeSuggestion, checksDish, gapAt, ALLERGEN_KEYS,
} from '../../../shared/allergenCheck.js'

const GAPS_KEPT = 30

/** What the check reads, once per request. */
export async function loadAllergenCtx(tx, tenantId) {
  const [draft, live, tags, venues] = await Promise.all([
    menusFor(tx, tenantId, 'draft'),
    menusFor(tx, tenantId, 'live'),
    tx`SELECT id, code, label, kind, standard_key FROM menu_dietary_tags WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM venues WHERE tenant_id = ${tenantId} AND is_active ORDER BY created_at, name`,
  ])
  const ctx = await loadDishCosting(tx, tenantId, null, { menus: draft })
  return { ctx, draft, live: dishMap(live), tags, venues }
}

const sameDeclared = (a, b) => ALLERGEN_KEYS.every(k => (a?.[k] || null) === (b?.[k] || null))

/**
 * Each food dish of the draft menus (or these), checked: [{ dish_id, dish,
 * menu_id, menu, section, venue_ids, check (dishCheck()), live_declared
 * (null: not live yet), published (the live declaration is the draft's) }].
 * A menu for one venue is checked at that venue; one for every venue at each
 * active venue. A meal deal (its allergens are its dishes') and goods and
 * services (no allergens) aren't checked.
 */
export function workOut(bundle, { dishIds = null } = {}) {
  const { ctx, draft, live, tags, venues } = bundle
  const all = venues.map(v => v.id)
  const want = dishIds ? new Set(dishIds) : null
  const out = []
  for (const menu of draft) {
    const venueIds = menu.venue_id ? all.filter(v => v === menu.venue_id) : all
    for (const s of menu.sections || []) {
      for (const i of s.items || []) {
        if (want && !want.has(i.id)) continue
        const dish = ctx.dishes.get(i.id)
        if (!checksDish(dish)) continue
        const results = dishScopes(dish, ctx, venueIds).map(scope => scopeSuggestion(dish.id, scope, ctx))
        const declared = declaredOf(dish, tags)
        const check = dishCheck(dish, results, declared, ctx.names)
        const liveDish = live.get(dish.id)
        const liveDeclared = liveDish ? declaredOf(liveDish, tags) : null
        out.push({
          dish_id: dish.id, dish: dish.name, menu_id: menu.id, menu: menu.name, section: s.title ?? null, venue_ids: venueIds,
          check, live_declared: liveDeclared, published: !!liveDeclared && sameDeclared(liveDeclared, declared),
        })
      }
    }
  }
  return out
}

// What is kept of the scope groups: their words, levels, evidence and the first gaps.
const groupsKept = groups => groups.map(g => ({
  where: g.where, scopes: g.scopes, recipe: g.recipe, levels: g.levels, evidence: g.evidence,
  gaps: g.gaps.slice(0, GAPS_KEPT), more_gaps: Math.max(0, g.gaps.length - GAPS_KEPT), complete: g.complete,
}))

const decision = row => ({ status: row.status, by: row.decided_by ?? null, at: row.decided_at ?? null, note: row.note ?? null, differences: row.differences || [] })

/**
 * Keeps each worked-out check as nextCheck() says (shared/allergenCheck.js):
 * a new difference opens a check, a dismissal holds while the differences
 * are the same, an accepted check stays as the record of who accepted.
 * Under a per-group lock so two readers don't both insert. Returns the rows
 * with the stored status and decision (status null: nothing to check).
 */
export async function storeChecks(tx, tenantId, rows) {
  if (!rows.length) return []
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'allergen_checks:' + tenantId}))`
  const stored = await tx`
    SELECT id, dish_id, status, fingerprint, differences, decided_by, decided_at, note, history
      FROM allergen_checks WHERE tenant_id = ${tenantId} AND dish_id = ANY(${rows.map(r => r.dish_id)}::uuid[])`
  const byDish = new Map(stored.map(s => [s.dish_id, s]))
  const out = []
  for (const r of rows) {
    const s = byDish.get(r.dish_id) || null
    const n = nextCheck(s, r.check)
    const diffs = r.check.checkable ? r.check.differences : []
    const fields = {
      menu_id: r.menu_id, dish: r.dish, menu: r.menu, section: r.section,
      differences: tx.json(diffs), fingerprint: fingerprint(diffs), suggested: tx.json(r.check.suggested),
      declared: tx.json(r.check.declared), scopes: tx.json(groupsKept(r.check.groups)), gaps: r.check.gaps.length,
      complete: r.check.complete,
    }
    if (n.op === 'none') { out.push({ ...r, id: null, status: null, decided_by: null, decided_at: null, note: null, history: [] }); continue }
    if (n.op === 'delete') {
      await tx`DELETE FROM allergen_checks WHERE id = ${s.id} AND tenant_id = ${tenantId}`
      out.push({ ...r, id: null, status: null, decided_by: null, decided_at: null, note: null, history: s.history || [] })
      continue
    }
    if (n.op === 'insert') {
      const [row] = await tx`
        INSERT INTO allergen_checks ${tx({ tenant_id: tenantId, dish_id: r.dish_id, status: 'open', ...fields })}
        RETURNING id`
      out.push({ ...r, id: row.id, status: 'open', decided_by: null, decided_at: null, note: null, history: [] })
      continue
    }
    // Opened again: the decision goes into the history.
    const history = n.reopened ? [...(s.history || []), decision(s)] : (s.history || [])
    const keep = n.reopened ? { decided_by: null, decided_at: null, note: null } : { decided_by: s.decided_by, decided_at: s.decided_at, note: s.note }
    // An accepted check keeps what was accepted (its differences then) as the record.
    const { differences, fingerprint: fp, ...rest } = fields
    const set = n.status === 'accepted' ? rest : fields
    await tx`
      UPDATE allergen_checks SET ${tx({ ...set, status: n.status, ...keep, history: tx.json(history) })},
             worked_at = now(), updated_at = now()
       WHERE id = ${s.id} AND tenant_id = ${tenantId}`
    out.push({ ...r, id: s.id, status: n.status, ...keep, history, reopened: n.reopened, accepted: n.status === 'accepted' ? s.differences || [] : null })
  }
  return out
}

/** The list's rows: worked out now and (store) kept. */
export async function checkRows(tx, tenantId, { dishIds = null, store = true, bundle = null } = {}) {
  const b = bundle || await loadAllergenCtx(tx, tenantId)
  const rows = workOut(b, { dishIds })
  if (store) return { bundle: b, rows: await storeChecks(tx, tenantId, rows) }
  // Read only (a report run): the stored decisions, as nextCheck() would keep them.
  const stored = rows.length ? await tx`
    SELECT id, dish_id, status, fingerprint, differences, decided_by, decided_at, note, history FROM allergen_checks
     WHERE tenant_id = ${tenantId} AND dish_id = ANY(${rows.map(r => r.dish_id)}::uuid[])` : []
  const byDish = new Map(stored.map(s => [s.dish_id, s]))
  return {
    bundle: b,
    rows: rows.map(r => {
      const s = byDish.get(r.dish_id) || null
      const n = nextCheck(s, r.check)
      const kept = s && (n.op === 'update' && !n.reopened)
      return {
        ...r, id: s?.id ?? null, status: n.status, decided_by: kept ? s.decided_by : null, decided_at: kept ? s.decided_at : null, note: kept ? s.note : null,
        history: s?.history || [], accepted: n.status === 'accepted' ? s.differences || [] : null,
      }
    }),
  }
}

/** A recipe's own suggested allergens at each active venue, venues with the same answer together. */
export async function loadRecipeSuggestion(tx, tenantId, recipeId, bundle = null) {
  const b = bundle || await loadAllergenCtx(tx, tenantId)
  const recipe = b.ctx.recipes.get(recipeId)
  if (!recipe) return null
  const groups = new Map()
  for (const v of b.venues) {
    const s = recipeSuggestion(recipe, v.id, b.ctx)
    const sig = JSON.stringify([ALLERGEN_KEYS.map(k => s.levels[k] || ''), Object.values(s.evidence).flat().map(e => e.quote_id).sort(), s.gaps.map(g => g.reason + (g.item_id || '')).sort()])
    if (!groups.has(sig)) groups.set(sig, { ...s, venues: [] })
    groups.get(sig).venues.push(v.name)
  }
  // A group's gaps are its first venue's: an unknown ingredient is named at every venue of the group.
  return { recipe_id: recipe.id, name: recipe.name, groups: [...groups.values()].map(({ venue_id, ...g }) => ({ ...g, gaps: g.gaps.map(x => gapAt(x, g.venues)) })) }
}
