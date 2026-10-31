// src/routes/tillLayouts.js
//
// Till layouts, /api/pos (migration 228; shared/pos/tillLayout.js,
// services/tillLayoutSvc.js): how a till's order screen is arranged,
// company wide. Which layout a venue's tills use is a venue setting
// (PATCH /api/pos/venues/:id/settings till_layout_id) and a till's own
// (PATCH /api/pos/devices/:id settings.till_layout). Store tech view to
// read, manage to change.
//
//   GET    /till-layouts             the company's layouts, where each is used, the templates
//   POST   /till-layouts             { name, template? | copy_from? }
//   GET    /till-layouts/:id         a layout, its problems and warnings, where it is used
//   PUT    /till-layouts/:id         { name, layout } (422 code 'layout' with the problems)
//   DELETE /till-layouts/:id         venues using it go back to the standard screen, tills to their venue's
//
// A change tells every till of the company to download its config again.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { broadcast } from '../config/ws.js'
import { LAYOUT_TEMPLATES, templateLayout, normaliseTillLayout, layoutProblems, layoutWarnings } from '../../../shared/pos/tillLayout.js'
import { ownTillLayout, layoutUses } from '../services/tillLayoutSvc.js'

const canView = requirePermission('pos_setup', 'view')
const canManage = requirePermission('pos_setup', 'manage')
const UUID = z.string().uuid()
const MAX_LAYOUTS = 30
const Name = z.string().trim().min(1).max(60)
const Layout = z.object({ zones: z.array(z.any()).max(40) }).passthrough()

async function ownLayoutRow(tx, tenantId, id) {
  const [l] = await tx`SELECT * FROM pos_till_layouts WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!l) throw httpError(404, 'Till layout not found')
  return l
}

/** Every till of the company downloads its config again. */
async function companyChanged(tx, tenantId) {
  const rows = await tx`SELECT id FROM venues WHERE tenant_id = ${tenantId}`
  return () => rows.forEach(r => broadcast('pos:' + r.id, { type: 'pos.config' }))
}

const view = (l, uses = {}) => {
  const layout = normaliseTillLayout(l.layout)
  return {
    id: l.id, name: l.name, layout, updated_at: l.updated_at,
    problems: layoutProblems(layout), warnings: layoutWarnings(layout),
    used_by: uses[l.id] || { venues: [], tills: [] },
  }
}

export default async function tillLayoutRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/till-layouts', { preHandler: canView }, async req => {
    return withTenant(req.tenantId, async tx => {
      const rows = await tx`SELECT * FROM pos_till_layouts WHERE tenant_id = ${req.tenantId} ORDER BY lower(name), created_at`
      const uses = await layoutUses(tx, req.tenantId)
      return {
        layouts: rows.map(l => {
          const v = view(l, uses)
          return { id: v.id, name: v.name, updated_at: v.updated_at, zones: v.layout.zones.length, problems: v.problems.length, used_by: v.used_by }
        }),
        templates: LAYOUT_TEMPLATES,
      }
    })
  })

  app.post('/till-layouts', { preHandler: canManage }, async (req, reply) => {
    const b = z.object({
      name: Name,
      template: z.enum(LAYOUT_TEMPLATES.map(t => t.key)).optional(),
      copy_from: UUID.nullable().optional(),
    }).parse(req.body || {})
    const row = await withTenant(req.tenantId, async tx => {
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM pos_till_layouts WHERE tenant_id = ${req.tenantId}`
      if (n >= MAX_LAYOUTS) throw httpError(422, 'A company can have up to ' + MAX_LAYOUTS + ' till layouts')
      const layout = b.copy_from
        ? normaliseTillLayout((await ownLayoutRow(tx, req.tenantId, b.copy_from)).layout)
        : templateLayout(b.template || 'standard')
      const [l] = await tx`
        INSERT INTO pos_till_layouts (tenant_id, name, layout)
        VALUES (${req.tenantId}, ${b.name}, ${tx.json(layout)}) RETURNING *`
      return l
    })
    reply.code(201)
    return view(row)
  })

  app.get('/till-layouts/:id', { preHandler: canView }, async req => {
    const id = UUID.parse(req.params.id)
    return withTenant(req.tenantId, async tx => view(await ownLayoutRow(tx, req.tenantId, id), await layoutUses(tx, req.tenantId)))
  })

  app.put('/till-layouts/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    const b = z.object({ name: Name, layout: Layout }).parse(req.body || {})
    let tell
    const out = await withTenant(req.tenantId, async tx => {
      await ownLayoutRow(tx, req.tenantId, id)
      const layout = await ownTillLayout(tx, req.tenantId, b.layout)
      const problems = layoutProblems(layout)
      if (problems.length) throw httpError(422, problems[0].message, { code: 'layout', problems })
      const [l] = await tx`
        UPDATE pos_till_layouts SET name = ${b.name}, layout = ${tx.json(layout)}, updated_at = now()
         WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      tell = await companyChanged(tx, req.tenantId)
      return view(l, await layoutUses(tx, req.tenantId))
    })
    tell()
    return out
  })

  app.delete('/till-layouts/:id', { preHandler: canManage }, async req => {
    const id = UUID.parse(req.params.id)
    let tell
    await withTenant(req.tenantId, async tx => {
      await ownLayoutRow(tx, req.tenantId, id)
      // Tills that picked it go back to their venue's layout; venues go back
      // to the standard screen through the foreign key.
      await tx`
        UPDATE pos_devices SET settings = settings - 'till_layout'
         WHERE tenant_id = ${req.tenantId} AND settings->>'till_layout' = ${id}`
      await tx`DELETE FROM pos_till_layouts WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      tell = await companyChanged(tx, req.tenantId)
    })
    tell()
    return { ok: true }
  })
}
