// src/routes/allergenChecks.js — mounted at /api/allergen-checks
//
// The allergen check (inventory phase 8a, migration 316; docs/INVENTORY.md
// 8.3, decision D6): each food dish's declared allergens (the menu's draft)
// against what its recipes suggest at each venue's supplier products
// (shared/allergenCheck.js, services/allergenCheckSvc.js). Worked out on each
// read and stored, so a decision holds: a dismissal until the differences
// change. Nothing here changes a declaration by itself: accepting writes the
// dish's allergens through the menus area's own save route (PUT
// /api/menus/:id/allergens, the Allergen matrix's, as the person: Menus
// manage), into the menu's draft; publishing stays a separate step.
//
//   GET  /                         every dish's check, open first      Recipes view
//        ?venue_id=                 dishes sold at that venue
//   GET  /dishes/:dishId           one dish's check, with its evidence Recipes view
//   POST /dishes/:dishId/accept    { fingerprint, allergens? }: the differences
//                                  (or those allergens) into the declaration
//                                                  Recipes manage + Menus manage
//   POST /dishes/:dishId/dismiss   { fingerprint, note }: kept as declared, with
//                                  why; holds until the differences change
//                                                  Recipes manage + Menus manage
//   POST /dishes/:dishId/reopen    a dismissal taken back
//                                                  Recipes manage + Menus manage
//   GET  /recipes/:recipeId        a recipe's own suggestion at each venue
//                                  (the recipe editor)                 Recipes view
//
// fingerprint: what the person saw (the check's `fingerprint`); a check that
// changed since is refused (409 changed), so nobody accepts what they didn't see.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { permissionAtLeast } from '../config/modules.js'
import { httpError } from '../middleware/error.js'
import { makeContext, callApi, staffAuthOf, staffPrincipalOf, ToolError } from '../ai/context.js'
import { checkRows, loadAllergenCtx, loadRecipeSuggestion } from '../services/allergenCheckSvc.js'
import { acceptedLevels, checkCounts, fingerprint, ALLERGEN_KEYS, NOTE_MAX, ALLERGEN_LABELS } from '../../../shared/allergenCheck.js'

const uuid = z.string().uuid()
const ListQuery = z.object({ venue_id: uuid.optional() })
const AcceptBody = z.object({
  fingerprint: z.string().max(2000),
  allergens: z.array(z.enum(ALLERGEN_KEYS)).min(1).max(14).optional(),
}).strict()
const DismissBody = z.object({
  fingerprint: z.string().max(2000),
  note: z.string().trim().min(1, 'Say why the declaration stays as it is').max(NOTE_MAX),
}).strict()

const who = req => req.user?.email ?? req.user?.sub ?? null
const asHttp = err => (err instanceof ToolError ? httpError(err.status || 422, err.message) : err)
const ORDER = { open: 0, dismissed: 2, accepted: 3 }
const rank = r => (!r.check.checkable ? 5 : r.status in ORDER ? ORDER[r.status] : 4)

/** One dish's check as the page and Pepper read it. */
export function checkView(r, venueNames = {}) {
  const c = r.check
  return {
    id: r.id ?? null, dish_id: r.dish_id, dish: r.dish, menu_id: r.menu_id, menu: r.menu, section: r.section,
    venues: (r.venue_ids || []).map(v => venueNames[v]).filter(Boolean),
    status: c.checkable && (r.status || c.differences.length) ? (r.status || 'open') : null,
    checkable: c.checkable, complete: c.complete, suggested: c.suggested, declared: c.declared,
    live_declared: r.live_declared, published: r.published,
    differences: c.checkable ? c.differences : [], fingerprint: fingerprint(c.checkable ? c.differences : []),
    groups: c.groups, gaps: c.gaps,
    decided_by: r.decided_by ?? null, decided_at: r.decided_at ?? null, note: r.note ?? null, history: r.history || [],
    // What was accepted into the declaration (an accepted check's record).
    accepted: r.status === 'accepted' ? r.accepted || [] : [],
    reopened: !!r.reopened,
  }
}

const venueNamesOf = bundle => Object.fromEntries(bundle.venues.map(v => [v.id, v.name]))

export default async function allergenCheckRoutes(app) {
  app.addHook('preHandler', requireAuth)
  const canView = requirePermission('recipes', 'view')
  const canManage = requirePermission('recipes', 'manage')

  /** Accepting and dismissing change what a dish declares or why it stays: Menus manage too. */
  async function mayDecide(req) {
    const lv = await permissionLevels(req, ['recipes', 'menus'])
    return permissionAtLeast(lv.recipes, 'manage') && permissionAtLeast(lv.menus, 'manage')
  }
  async function needDecide(req) {
    if (!(await mayDecide(req))) throw httpError(403, 'Deciding an allergen check changes what a dish declares: it needs Recipes manage and Menus manage.')
  }
  const staffCtx = req => makeContext({
    app, channel: 'staff_chat', tenantId: req.tenantId, log: req.log,
    auth: staffAuthOf(req), principal: staffPrincipalOf(req), actor: who(req),
  })

  /** One dish's check, worked out and kept: { bundle, row }, 404 for a dish on none of the group's menus. */
  async function oneCheck(tx, req, dishId) {
    const { bundle, rows } = await checkRows(tx, req.tenantId, { dishIds: [dishId] })
    if (!rows.length) throw httpError(404, 'That dish isn\'t on one of your menus as food')
    return { bundle, row: rows[0] }
  }
  function sameAsSeen(row, seen) {
    if (fingerprint(row.check.checkable ? row.check.differences : []) !== seen) {
      throw httpError(409, 'The check changed since you opened it: look at it again before deciding', { code: 'changed' })
    }
  }

  app.get('/', { preHandler: canView }, async req => {
    const q = ListQuery.parse(req.query || {})
    const out = await withTenant(req.tenantId, async tx => {
      const { bundle, rows } = await checkRows(tx, req.tenantId)
      if (q.venue_id && !bundle.venues.some(v => v.id === q.venue_id)) throw httpError(404, 'Venue not found')
      const names = venueNamesOf(bundle)
      const list = rows
        .filter(r => !q.venue_id || r.venue_ids.includes(q.venue_id))
        .sort((a, b) => rank(a) - rank(b) || b.check.differences.length - a.check.differences.length
          || String(a.menu).localeCompare(String(b.menu)) || String(a.dish).localeCompare(String(b.dish)))
        .map(r => checkView(r, names))
      return { rows: list, venues: bundle.venues.map(v => ({ id: v.id, name: v.name })) }
    })
    return {
      ...out,
      counts: checkCounts(out.rows),
      can_decide: await mayDecide(req),
      allergens: ALLERGEN_KEYS.map(k => ({ key: k, label: ALLERGEN_LABELS[k] })),
      worked_at: new Date().toISOString(),
    }
  })

  app.get('/dishes/:dishId', { preHandler: canView }, async req => {
    const dishId = uuid.parse(req.params.dishId)
    const view = await withTenant(req.tenantId, async tx => {
      const { bundle, row } = await oneCheck(tx, req, dishId)
      return checkView(row, venueNamesOf(bundle))
    })
    return { ...view, can_decide: await mayDecide(req) }
  })

  app.post('/dishes/:dishId/accept', { preHandler: canManage }, async req => {
    const dishId = uuid.parse(req.params.dishId)
    const body = AcceptBody.parse(req.body || {})
    await needDecide(req)
    const { row } = await withTenant(req.tenantId, tx => oneCheck(tx, req, dishId))
    sameAsSeen(row, body.fingerprint)
    const diffs = row.check.checkable ? row.check.differences : []
    if (!diffs.length) throw httpError(409, 'Nothing differs: there is nothing to accept', { code: 'nothing' })
    const change = acceptedLevels(row.check.declared, diffs, body.allergens || null)
    if (!Object.keys(change).length) throw httpError(422, 'None of those allergens differs on this dish', { code: 'nothing' })
    // The dish's whole allergens and diet tags from the menu's draft, as the Allergen matrix saves them (rule 13).
    let matrix
    try { matrix = await callApi(staffCtx(req), 'GET', '/api/menus/' + row.menu_id + '/allergens') } catch (err) { throw asHttp(err) }
    const dish = (matrix.sections || []).flatMap(s => s.items || []).find(i => i.id === dishId)
    if (!dish) throw httpError(409, 'The dish isn\'t on its menu\'s draft any more: reload the check', { code: 'changed' })
    const levels = { ...(dish.levels || {}) }
    for (const [key, level] of Object.entries(change)) {
      const tag = (matrix.tags || []).find(t => t.kind === 'allergen' && t.standard_key === key)
      if (!tag) {
        throw httpError(422, 'Your menus have no ' + ALLERGEN_LABELS[key] + ' allergen yet: add the 14 standard allergens on Menus, Allergens and diet, then accept again.', { code: 'no_tag' })
      }
      if (level) levels[tag.id] = level
      else delete levels[tag.id]
    }
    try {
      await callApi(staffCtx(req), 'PUT', '/api/menus/' + row.menu_id + '/allergens', { body: { items: [{ item_id: dishId, levels }] } })
    } catch (err) { throw asHttp(err) }
    // Kept as accepted (who, when, what), then worked out again on the changed draft: what wasn't accepted stays open.
    const view = await withTenant(req.tenantId, async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'allergen_checks:' + req.tenantId}))`
      const accepted = diffs.filter(d => change[d.allergen] !== undefined)
      const [had] = await tx`SELECT id FROM allergen_checks WHERE tenant_id = ${req.tenantId} AND dish_id = ${dishId}`
      if (had) {
        await tx`
          UPDATE allergen_checks SET status = 'accepted', decided_by = ${who(req)}, decided_at = now(), note = NULL,
                 differences = ${tx.json(accepted)}, fingerprint = ${fingerprint(accepted)}, updated_at = now()
           WHERE id = ${had.id} AND tenant_id = ${req.tenantId}`
      }
      const { bundle, row: again } = await oneCheck(tx, req, dishId)
      return { ...checkView(again, venueNamesOf(bundle)), just_accepted: accepted.map(d => d.allergen) }
    })
    return view
  })

  app.post('/dishes/:dishId/dismiss', { preHandler: canManage }, async req => {
    const dishId = uuid.parse(req.params.dishId)
    const body = DismissBody.parse(req.body || {})
    await needDecide(req)
    const view = await withTenant(req.tenantId, async tx => {
      const { bundle, row } = await oneCheck(tx, req, dishId)
      sameAsSeen(row, body.fingerprint)
      if (!row.id || !row.check.differences.length) throw httpError(409, 'Nothing differs: there is nothing to dismiss', { code: 'nothing' })
      const [saved] = await tx`
        UPDATE allergen_checks SET status = 'dismissed', decided_by = ${who(req)}, decided_at = now(), note = ${body.note}, updated_at = now()
         WHERE id = ${row.id} AND tenant_id = ${req.tenantId}
         RETURNING status, decided_by, decided_at, note`
      return checkView({ ...row, ...saved }, venueNamesOf(bundle))
    })
    return view
  })

  app.post('/dishes/:dishId/reopen', { preHandler: canManage }, async req => {
    const dishId = uuid.parse(req.params.dishId)
    await needDecide(req)
    const view = await withTenant(req.tenantId, async tx => {
      const { bundle, row } = await oneCheck(tx, req, dishId)
      if (!row.id || row.status !== 'dismissed') throw httpError(409, 'Only a dismissed check can be opened again', { code: 'not_dismissed' })
      const history = [...(row.history || []), { status: row.status, by: row.decided_by, at: row.decided_at, note: row.note, differences: row.check.differences }]
      const [saved] = await tx`
        UPDATE allergen_checks SET status = 'open', decided_by = NULL, decided_at = NULL, note = NULL, history = ${tx.json(history)}, updated_at = now()
         WHERE id = ${row.id} AND tenant_id = ${req.tenantId}
         RETURNING status, decided_by, decided_at, note, history`
      return checkView({ ...row, ...saved }, venueNamesOf(bundle))
    })
    return view
  })

  app.get('/recipes/:recipeId', { preHandler: canView }, async req => {
    const recipeId = uuid.parse(req.params.recipeId)
    const out = await withTenant(req.tenantId, async tx => loadRecipeSuggestion(tx, req.tenantId, recipeId, await loadAllergenCtx(tx, req.tenantId)))
    if (!out) throw httpError(404, 'Recipe not found')
    return out
  })
}
