// src/routes/reportLayouts.js
//
// Layout templates (docs/REPORTS.md 11, migration 253), mounted at
// /api/reports beside the report routes. How a report looks on paper:
// settings, not a canvas. The rules are shared/reports/layout.js and the
// drawing src/reports/export/print.js; which layout a report prints with is
// layoutFor() (src/reports/layouts.js): the report's own pick, else the
// group's default, else the built-in one.
//
//   GET    /layouts             the group's layouts, its default first (View:
//                               a report's layout pick lists them)
//   POST   /layouts             a new one (Manage)
//   PUT    /layouts/:layoutId   its name, its settings, whether it is the
//                               group's default (Manage)
//   DELETE /layouts/:layoutId   delete it; reports that picked it print with
//                               the group's default again (Manage)
//   PUT    /:id/layout          the layout a saved report or page prints
//                               with, { layout_id | null } (whoever may
//                               change the report)
//
// A layout is tried out with real data through the report's print link
// (POST /:id/print-link with `layout` and `preview`, src/routes/reports.js).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { reportPerson, rightsOn } from '../reports/access.js'
import { starterOf, savedRow, reportNotFound } from '../reports/target.js'
import { layoutView, listLayouts } from '../reports/layouts.js'
import { normaliseLayout, LAYOUT_LIMITS } from '../../../shared/reports/layout.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Name = z.string().trim().min(1).max(LAYOUT_LIMITS.name)
// Tidied by normaliseLayout(), not by its shape here.
const Settings = z.record(z.any())
const NewLayout = z.object({ name: Name, settings: Settings.optional(), is_default: z.boolean().optional() })
const EditLayout = z.object({ name: Name.optional(), settings: Settings.optional(), is_default: z.boolean().optional() })
const Pick = z.object({ layout_id: z.string().uuid().nullable() })

const notFound = () => httpError(404, 'Layout not found')
const NAME_TAKEN = 'Another layout has that name'

// One writer at a time for a group's layouts: a name and the one default are
// checked and then written.
const lock = (tx, p) => tx`SELECT pg_advisory_xact_lock(hashtext(${'report-layouts:' + p.tenantId}))`

export default async function reportLayoutRoutes(app) {
  app.addHook('preHandler', requireAuth)

  const view = { preHandler: requirePermission('reports', 'view') }
  const use = { preHandler: requirePermission('reports', 'use') }
  const manage = { preHandler: requirePermission('reports', 'manage') }

  app.get('/layouts', view, async req => {
    const p = await reportPerson(req)
    return { layouts: (await listLayouts(p)).map(layoutView), can_manage: p.canManage, limit: LAYOUT_LIMITS.layouts }
  })

  app.post('/layouts', manage, async (req, reply) => {
    const body = NewLayout.parse(req.body)
    const p = await reportPerson(req)
    const row = await withTenant(p.tenantId, async tx => {
      await lock(tx, p)
      const [{ n, taken }] = await tx`
        SELECT count(*)::int AS n, count(*) FILTER (WHERE lower(name) = lower(${body.name}))::int AS taken
          FROM report_layouts WHERE tenant_id = ${p.tenantId}`
      if (taken) throw httpError(409, NAME_TAKEN)
      if (n >= LAYOUT_LIMITS.layouts) throw httpError(422, 'A group can keep ' + LAYOUT_LIMITS.layouts + ' layouts. Delete one first')
      if (body.is_default) await tx`UPDATE report_layouts SET is_default = false WHERE tenant_id = ${p.tenantId} AND is_default`
      const [r] = await tx`
        INSERT INTO report_layouts (tenant_id, name, settings, is_default, created_by)
        VALUES (${p.tenantId}, ${body.name}, ${tx.json(normaliseLayout(body.settings))}, ${!!body.is_default}, ${p.email})
        RETURNING *`
      return r
    })
    return reply.code(201).send({ layout: layoutView(row) })
  })

  app.put('/layouts/:layoutId', manage, async req => {
    const body = EditLayout.parse(req.body)
    const p = await reportPerson(req)
    const id = String(req.params.layoutId)
    if (!UUID_RE.test(id)) throw notFound()
    const row = await withTenant(p.tenantId, async tx => {
      await lock(tx, p)
      const [before] = await tx`SELECT * FROM report_layouts WHERE tenant_id = ${p.tenantId} AND id = ${id}`
      if (!before) throw notFound()
      if (body.name) {
        const twin = await tx`
          SELECT 1 FROM report_layouts
           WHERE tenant_id = ${p.tenantId} AND id <> ${id} AND lower(name) = lower(${body.name})`
        if (twin.length) throw httpError(409, NAME_TAKEN)
      }
      if (body.is_default && !before.is_default) {
        await tx`UPDATE report_layouts SET is_default = false WHERE tenant_id = ${p.tenantId} AND is_default`
      }
      const [r] = await tx`
        UPDATE report_layouts
           SET name = ${body.name ?? before.name},
               settings = ${tx.json(normaliseLayout(body.settings ?? before.settings))},
               is_default = ${body.is_default ?? before.is_default},
               updated_at = now()
         WHERE tenant_id = ${p.tenantId} AND id = ${id}
         RETURNING *`
      return r
    })
    return { layout: layoutView(row) }
  })

  app.delete('/layouts/:layoutId', manage, async (req, reply) => {
    const p = await reportPerson(req)
    const id = String(req.params.layoutId)
    if (!UUID_RE.test(id)) throw notFound()
    const gone = await withTenant(p.tenantId, tx => tx`
      DELETE FROM report_layouts WHERE tenant_id = ${p.tenantId} AND id = ${id} RETURNING id`)
    if (!gone.length) throw notFound()
    return reply.code(204).send()
  })

  // The layout a saved report or page prints with (null: the group's default).
  app.put('/:id/layout', use, async req => {
    const body = Pick.parse(req.body)
    const p = await reportPerson(req)
    if (starterOf(req.params.id)) {
      throw httpError(422, 'This starter report comes with Macaroonie and prints with the group\'s default layout. Make a copy to pick another')
    }
    return withTenant(p.tenantId, async tx => {
      const row = await savedRow(tx, String(req.params.id), p)
      if (!row) throw reportNotFound()
      if (!rightsOn(row, p).edit) throw httpError(403, 'Only the person who made this report, or someone with Manage on Reports, can change its layout')
      if (body.layout_id) {
        const [layout] = await tx`SELECT id FROM report_layouts WHERE tenant_id = ${p.tenantId} AND id = ${body.layout_id}`
        if (!layout) throw notFound()
      }
      await tx`UPDATE reports SET layout_id = ${body.layout_id}, updated_at = now() WHERE tenant_id = ${p.tenantId} AND id = ${row.id}`
      return { id: row.id, layout_id: body.layout_id }
    })
  })
}
