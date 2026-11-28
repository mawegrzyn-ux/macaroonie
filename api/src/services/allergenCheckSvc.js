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
//
// Phase 8b (migration 317): opened again when something changes.
//   allergensChanged(tx, req, change)   the hook, called where each change
//       that could alter a suggestion is saved, in its transaction (a
//       savepoint: a failure never stops the save): the dishes it can alter
//       (dishesToCheck(): price creep's index from items and recipes to
//       dishes, and the options whose rules bring them in) worked out again
//       and kept; a check it opens, opens again or changes is marked with
//       when and what changed (changed_at, change), which Today shows.
//       change: { kind (CHANGE_KINDS), itemIds, quoteIds, recipeIds, dishIds,
//       optionIds, venueIds, words }
//   checksToReview(tx, tenantId, venueId)   the marked open checks at a
//       venue (Today's "Allergen checks to review")
//   loadSubstitutes(tx, tenantId)   what deliveries brought instead lately

import { loadDishCosting, menusFor } from './dishCostSvc.js'
import { dishMap } from '../../../shared/costing.js'
import {
  dishScopes, scopeSuggestion, declaredOf, dishCheck, fingerprint, nextCheck, recipeSuggestion, checksDish, gapAt, ALLERGEN_KEYS,
  dishesToCheck, changeWords, substituteKnown, SUBSTITUTE_DAYS, CHANGE_KIND_KEYS,
} from '../../../shared/allergenCheck.js'

const GAPS_KEPT = 30

/**
 * What deliveries brought instead of what was ordered lately (phase 8b): at
 * each venue, an item whose latest delivery in the last SUBSTITUTE_DAYS days
 * was marked Substituted, with the product the line now points at (its own
 * supplier price once the delivery's price list added it) and whether that
 * is what came (substituteKnown()). Map 'item|venue' -> [{ known, quote,
 * supplier, product, day, number }].
 */
export async function loadSubstitutes(tx, tenantId) {
  const rows = await tx`
    SELECT DISTINCT ON (po.venue_id, pl.item_id)
           po.venue_id, pl.item_id, pl.receive_status, pl.invoice_code, pl.invoice_name, pl.product_name AS ordered_name,
           po.number, (po.received_at AT TIME ZONE COALESCE(v.timezone, 'Europe/London'))::date::text AS day,
           s.name AS supplier_name,
           q.id AS q_id, q.supplier_code AS q_code, q.product_name AS q_name, q.allergens_contains, q.allergens_may_contain,
           q.allergens_checked_at, q.allergens_checked_by, q.allergens_source, qs.name AS q_supplier
      FROM purchase_order_lines pl
      JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
      JOIN venues v ON v.id = po.venue_id AND v.tenant_id = po.tenant_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
      LEFT JOIN inv_quotes q ON q.id = pl.quote_id AND q.tenant_id = pl.tenant_id
      LEFT JOIN suppliers qs ON qs.id = q.supplier_id AND qs.tenant_id = q.tenant_id
     WHERE pl.tenant_id = ${tenantId} AND pl.item_id IS NOT NULL AND pl.received_qty > 0
       AND po.status = 'received' AND po.received_at >= now() - make_interval(days => ${SUBSTITUTE_DAYS})
     ORDER BY po.venue_id, pl.item_id, po.received_at DESC, pl.id`
  const out = new Map()
  for (const r of rows) {
    if (r.receive_status !== 'substituted') continue
    const quote = r.q_id ? {
      id: r.q_id, supplier_code: r.q_code, product_name: r.q_name, supplier_name: r.q_supplier,
      allergens_contains: r.allergens_contains, allergens_may_contain: r.allergens_may_contain,
      allergens_checked_at: r.allergens_checked_at, allergens_checked_by: r.allergens_checked_by, allergens_source: r.allergens_source,
    } : null
    const known = substituteKnown({ invoice_code: r.invoice_code, invoice_name: r.invoice_name, quote })
    out.set(r.item_id + '|' + r.venue_id, [{
      known, quote: known ? quote : null, supplier: r.supplier_name ?? null,
      product: known ? quote.product_name || null : r.invoice_name || null, day: r.day, number: r.number,
    }])
  }
  return out
}

/** What the check reads, once per request. */
export async function loadAllergenCtx(tx, tenantId) {
  const [draft, live, tags, venues, substitutes] = await Promise.all([
    menusFor(tx, tenantId, 'draft'),
    menusFor(tx, tenantId, 'live'),
    tx`SELECT id, code, label, kind, standard_key FROM menu_dietary_tags WHERE tenant_id = ${tenantId}`,
    tx`SELECT id, name FROM venues WHERE tenant_id = ${tenantId} AND is_active ORDER BY created_at, name`,
    loadSubstitutes(tx, tenantId),
  ])
  const ctx = await loadDishCosting(tx, tenantId, null, { menus: draft })
  return { ctx: { ...ctx, substitutes }, draft, live: dishMap(live), tags, venues }
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
 * cause (phase 8b, the change hook): a check this opens, opens again, or
 * whose open differences this changes is marked with when and what changed
 * (changed_at, change: Today's item); a check read on the tab is never
 * marked, and a mark stays until someone decides.
 */
export async function storeChecks(tx, tenantId, rows, { cause = null } = {}) {
  if (!rows.length) return []
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'allergen_checks:' + tenantId}))`
  const stored = await tx`
    SELECT id, dish_id, status, fingerprint, differences, decided_by, decided_at, note, history, changed_at, change
      FROM allergen_checks WHERE tenant_id = ${tenantId} AND dish_id = ANY(${rows.map(r => r.dish_id)}::uuid[])`
  const byDish = new Map(stored.map(s => [s.dish_id, s]))
  const mark = cause ? { change: String(cause).slice(0, 500), changed_at: new Date() } : null
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
    const venues = r.venue_ids || []
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
      await tx`
        UPDATE allergen_checks SET venue_ids = ${venues}::uuid[]
               ${mark ? tx`, changed_at = now(), change = ${mark.change}` : tx``}
         WHERE id = ${row.id} AND tenant_id = ${tenantId}`
      out.push({ ...r, id: row.id, status: 'open', decided_by: null, decided_at: null, note: null, history: [], ...(mark ? { ...mark, marked: true } : {}) })
      continue
    }
    // Opened again: the decision goes into the history.
    const history = n.reopened ? [...(s.history || []), decision(s)] : (s.history || [])
    const keep = n.reopened ? { decided_by: null, decided_at: null, note: null } : { decided_by: s.decided_by, decided_at: s.decided_at, note: s.note }
    // An accepted check keeps what was accepted (its differences then) as the record.
    const { differences, fingerprint: fp, ...rest } = fields
    const set = n.status === 'accepted' ? rest : fields
    // A change opened it again, or changed what an open one says.
    const marked = !!mark && n.status === 'open' && (n.reopened || s.fingerprint !== fingerprint(diffs))
    await tx`
      UPDATE allergen_checks SET ${tx({ ...set, status: n.status, ...keep, history: tx.json(history) })},
             venue_ids = ${venues}::uuid[], worked_at = now(), updated_at = now()
             ${marked ? tx`, changed_at = now(), change = ${mark.change}` : tx``}
       WHERE id = ${s.id} AND tenant_id = ${tenantId}`
    out.push({
      ...r, id: s.id, status: n.status, ...keep, history, reopened: n.reopened, accepted: n.status === 'accepted' ? s.differences || [] : null,
      change: marked ? mark.change : s.change ?? null, changed_at: marked ? mark.changed_at : s.changed_at ?? null, marked,
    })
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

// ── Opened again on a change (phase 8b, migration 317) ────────

const names = (rows, key = 'name') => [...new Set(rows.map(r => r[key]).filter(Boolean))]

/**
 * The hook (phase 8b): called where a change that could alter a dish's
 * suggested allergens (or, migration 318, its calories) is saved, in that
 * transaction. In a savepoint, so a failure is logged and the change is
 * still saved (the check is worked out again when the tab is opened). Works
 * out the dishes the change can alter (dishesToCheck()), keeps their checks
 * (storeChecks() with the change in words: a check opened, opened again or
 * changed by it goes on Today) and returns { worked: [dish ids], marked:
 * [dish ids] }. Never call it in a dry run.
 */
export async function allergensChanged(tx, req, change = {}) {
  try {
    return await tx.savepoint(sp => recheck(sp, req.tenantId, change))
  } catch (err) {
    req.log?.warn?.({ err: err?.message }, 'Allergen checks not worked out again')
    return { worked: [], marked: [], failed: true }
  }
}

async function recheck(tx, tenantId, change) {
  const kind = CHANGE_KIND_KEYS.includes(change.kind) ? change.kind : null
  const quoteIds = [...new Set((change.quoteIds || []).filter(Boolean))]
  const fromQuotes = quoteIds.length
    ? await tx`SELECT DISTINCT item_id FROM inv_quotes WHERE tenant_id = ${tenantId} AND id = ANY(${quoteIds}::uuid[])` : []
  const itemIds = [...new Set([...(change.itemIds || []), ...fromQuotes.map(r => r.item_id)].filter(Boolean))]
  const want = { itemIds, recipeIds: change.recipeIds || [], dishIds: change.dishIds || [], optionIds: change.optionIds || [] }
  if (!want.itemIds.length && !want.recipeIds.length && !want.dishIds.length && !want.optionIds.length) return { worked: [], marked: [] }
  const bundle = await loadAllergenCtx(tx, tenantId)
  const dishIds = dishesToCheck(want, bundle.ctx)
  if (!dishIds.size) return { worked: [], marked: [] }
  // What changed, in words, with the names it is about.
  let cause = change.words || null
  if (!cause) {
    const items = itemIds.map(id => bundle.ctx.items.get(id)?.name).filter(Boolean)
    const missing = itemIds.filter(id => !bundle.ctx.items.has(id))
    const more = missing.length ? names(await tx`SELECT name FROM inv_items WHERE tenant_id = ${tenantId} AND id = ANY(${missing}::uuid[])`) : []
    const venueNames = (change.venueIds || []).map(id => bundle.venues.find(v => v.id === id)?.name).filter(Boolean)
    const recipes = (change.recipeIds || []).map(id => bundle.ctx.recipes.get(id)?.name).filter(Boolean)
    const dishes = (change.dishIds || []).map(id => bundle.ctx.dishes.get(id)?.name).filter(Boolean)
    const options = (change.optionIds || []).map(id => bundle.ctx.options?.get?.(id)?.label).filter(Boolean)
    cause = changeWords({ kind, items: [...items, ...more], venues: venueNames, recipes: [...recipes, ...(change.recipeNames || [])], dishes, options, supplier: change.supplier, on: change.on })
  }
  const rows = workOut(bundle, { dishIds: [...dishIds] })
  const kept = await storeChecks(tx, tenantId, rows, { cause })
  return { worked: [...dishIds], marked: kept.filter(r => r.marked).map(r => r.dish_id), cause }
}

/**
 * The open checks a change marked (Today's "Allergen checks to review"), at
 * a venue (the dish sold there) or every venue: [{ id, dish_id, dish, menu,
 * change, changed_at }], newest change first.
 */
export function checksToReview(tx, tenantId, venueId = null) {
  return tx`
    SELECT id, dish_id, dish, menu, change, changed_at FROM allergen_checks
     WHERE tenant_id = ${tenantId} AND status = 'open' AND changed_at IS NOT NULL
       ${venueId ? tx`AND ${venueId}::uuid = ANY(venue_ids)` : tx``}
     ORDER BY changed_at DESC, dish`
}
