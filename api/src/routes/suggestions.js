// src/routes/suggestions.js
//
// Home's suggestions (Pepper-first step 7a, services/suggestions.js),
// mounted at /api/suggestions. The suggestions themselves come with the
// Today feed (GET /api/ops/today); here is what a person does to them.
// Open to everyone signed in to a group: each person only ever changes
// their own.
//
//   POST /hide   { key }   dismiss one: off the person's Home for HIDE_DAYS
//                          (a team suggestion, 'team:<id>', for good) -> 204
//
// The Team signal (step 7b, migration 283): a page suggested to a role.
// Navigation (nav_designer) governs the menu everyone sees, so it governs
// this too: View lists, Manage adds and removes (an owner by default).
//
//   GET    /team                 -> { suggestions: [{ id, role_id, role_label,
//                                     path, label, venue_id, venue_name, tab,
//                                     note, by_label, created_at }], can_manage }
//   POST   /team                 { role_id, path, venue_id?, tab?, note?,
//                                   sign_as: 'name' | 'role' } -> 201 the row.
//                                 The page must be in the maker's own menu;
//                                 a venue and a tab only where the page takes
//                                 them (cleanPin()); the role and the venue
//                                 the group's own (404 otherwise); the same
//                                 page, venue and tab to a role once (409).
//   DELETE /team/:suggestionId   -> 204 (404: not one of the group's)

import { z } from 'zod'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { FREE } from '../middleware/sharedDevice.js'
import { httpError } from '../middleware/error.js'
import { withTenant } from '../config/db.js'
import { permissionAtLeast } from '../config/modules.js'
import { hideSuggestion, NOTE_MAX } from '../services/suggestions.js'
import { navTreeFor, navLinksOf } from '../services/navTree.js'
import { effectiveRoleId } from '../services/roles.js'
import { personName } from '../services/opsTasks.js'
import { cleanPin } from './pins.js'
import { ROUTE_CATALOG } from '../../../shared/nav/index.js'

const PAGE_LABEL = new Map(ROUTE_CATALOG.map(r => [r.route, r.label]))
const UUID = z.string().uuid()
const TeamSuggestion = z.object({
  role_id:  UUID,
  path:     z.string().trim().min(1).max(100),
  venue_id: UUID.nullable().optional(),
  tab:      z.string().trim().max(40).nullable().optional(),
  note:     z.string().max(NOTE_MAX * 2).nullable().optional(),
  sign_as:  z.enum(['name', 'role']).default('name'),
})

// A suggestion's key: a page ('/rota', '/food-safety#holds'), 'report:<ref>',
// 'setup:<gap>' or 'team:<id>'.
const Key = z.string().trim().min(1).max(200).regex(/^(\/[a-z0-9/_-]*(#[a-z0-9_-]+)?|(report|setup|team):[A-Za-z0-9:_-]+)$/)

export default async function suggestionRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // A person's own preference, like the usage record: no person switch needed on a shared device.
  app.post('/hide', { config: { sharedDevice: FREE } }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
    const parsed = z.object({ key: Key }).safeParse(req.body ?? {})
    if (!parsed.success) throw httpError(422, 'That isn\'t a suggestion.')
    await hideSuggestion(req.tenantId, req.user.sub, parsed.data.key)
    return reply.code(204).send()
  })

  // ── The Team signal ──────────────────────────────────────
  const listTeam = (tenantId, id = null) => withTenant(tenantId, tx => tx`
    SELECT s.id, s.role_id, r.label AS role_label, s.path, s.venue_id, v.name AS venue_name, s.tab, s.note,
           s.by_label, s.created_at
      FROM team_suggestions s
      JOIN tenant_roles r ON r.id = s.role_id AND r.tenant_id = s.tenant_id
 LEFT JOIN venues v ON v.id = s.venue_id AND v.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${tenantId} ${id ? tx`AND s.id = ${id}` : tx``}
     ORDER BY r.sort_order, r.label, s.created_at DESC`)
  const view = row => ({ ...row, label: PAGE_LABEL.get(row.path) || row.path })

  app.get('/team', { preHandler: requirePermission('nav_designer', 'view') }, async req => {
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
    const levels = await permissionLevels(req, ['nav_designer'])
    return {
      suggestions: (await listTeam(req.tenantId)).map(view),
      can_manage: !!req.isPlatformAdmin || permissionAtLeast(levels.nav_designer, 'manage'),
    }
  })

  app.post('/team', { preHandler: requirePermission('nav_designer', 'manage') }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
    const parsed = TeamSuggestion.safeParse(req.body ?? {})
    if (!parsed.success) throw httpError(422, parsed.error.issues[0].path.join('.') + ': ' + parsed.error.issues[0].message)
    const b = parsed.data
    const note = String(b.note ?? '').replace(/\s+/g, ' ').trim()
    if (note.length > NOTE_MAX) throw httpError(422, 'A note is ' + NOTE_MAX + ' characters at most.')
    const routes = new Set(navLinksOf(await navTreeFor(req)).map(l => l.route))
    if (!routes.has(b.path) || b.path === '/') throw httpError(400, 'Suggest a page of the menu: ' + b.path)
    const pin = cleanPin(b)
    const row = await withTenant(req.tenantId, async tx => {
      const [role] = await tx`SELECT id, label FROM tenant_roles WHERE id = ${b.role_id} AND tenant_id = ${req.tenantId}`
      if (!role) throw httpError(404, 'Role not found')
      if (pin.venue_id) {
        const [v] = await tx`SELECT id FROM venues WHERE id = ${pin.venue_id} AND tenant_id = ${req.tenantId}`
        if (!v) throw httpError(404, 'Venue not found')
      }
      let byLabel
      if (b.sign_as === 'role') {
        const myRole = await effectiveRoleId(req)
        const [r] = myRole ? await tx`SELECT label FROM tenant_roles WHERE id = ${myRole} AND tenant_id = ${req.tenantId}` : []
        byLabel = r?.label || 'your manager'
      } else {
        const [u] = await tx`SELECT full_name, email FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} LIMIT 1`
        byLabel = personName(u || { email: req.user.email })
      }
      const [made] = await tx`
        INSERT INTO team_suggestions (tenant_id, role_id, path, venue_id, tab, note, by_sub, by_label)
        VALUES (${req.tenantId}, ${role.id}, ${pin.path}, ${pin.venue_id}, ${pin.tab}, ${note || null}, ${req.user.sub}, ${byLabel.slice(0, 80)})
        ON CONFLICT DO NOTHING
        RETURNING id`
      if (!made) throw httpError(409, 'That page is already suggested to ' + role.label + '.')
      return made
    })
    const [out] = await listTeam(req.tenantId, row.id)
    return reply.code(201).send(view(out))
  })

  app.delete('/team/:suggestionId', { preHandler: requirePermission('nav_designer', 'manage') }, async (req, reply) => {
    const id = UUID.safeParse(req.params.suggestionId)
    if (!id.success) throw httpError(404, 'Suggestion not found')
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
    const gone = await withTenant(req.tenantId, async tx => {
      const rows = await tx`DELETE FROM team_suggestions WHERE id = ${id.data} AND tenant_id = ${req.tenantId} RETURNING id`
      // Its dismissals (kept for good) go with it.
      if (rows.length) await tx`DELETE FROM home_suggestion_hides WHERE tenant_id = ${req.tenantId} AND key = ${'team:' + id.data}`
      return rows
    })
    if (!gone.length) throw httpError(404, 'Suggestion not found')
    return reply.code(204).send()
  })
}
